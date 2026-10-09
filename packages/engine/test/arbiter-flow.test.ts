import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type Adjudicator,
  AdjudicatorRegistry,
  DecisionType,
  Isolation,
  McpPolicy,
  Ruling,
  type RulingRequest,
  RunResult,
  SimpleEventDispatcher,
  type StepDefinition,
  Tracer,
  Verdict,
  type WorkflowDefinition,
} from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { DecisionLedger, GuardRegistry, LEDGER_DIRECTORY, StepExecutor } from '../src/index.js';
import { FakeRegistry, FakeRunner, FixedClock, makeGitRepo, SequenceIds } from './support.js';

const SECRET = ['sk', 'live', '0123456789'].join('-');
const redact = (text: string): string => text.split(SECRET).join('[redacted]');

const critic = (): FakeRunner =>
  new FakeRunner('agent', () => new RunResult({ exitCode: 0, output: `CRITIQUE: fix the loop ${SECRET}` }));

function debate(overrides: Partial<StepDefinition> = {}): StepDefinition {
  return {
    id: 'debate',
    role: 'a',
    goal: 'Is src fine?',
    dependsOn: [],
    inputArtifacts: [],
    outputs: [],
    commands: [],
    guards: [],
    isolation: Isolation.None,
    consensusWith: [],
    decisionType: DecisionType.Consensus,
    arbiter: 'human',
    mcp: [],
    ...overrides,
  };
}

function withoutArbiter(): StepDefinition {
  const { arbiter: _named, ...rest } = debate();
  return rest;
}

const workflow: WorkflowDefinition = {
  version: '1.0',
  name: 'review',
  artifacts: {},
  roles: { a: { name: 'a', runner: 'agent', mcp: [] } },
  steps: [],
  mcpServers: {},
  defaultMcpPolicy: McpPolicy.Required,
};

class Scripted implements Adjudicator {
  readonly requests: RulingRequest[] = [];

  constructor(private readonly answer: () => Ruling | null | Promise<Ruling | null>) {}

  async rule(request: RulingRequest): Promise<Ruling | null> {
    this.requests.push(request);
    return await this.answer();
  }
}

async function fixture(options: { human?: Adjudicator; agent?: FakeRunner; repo?: string } = {}) {
  const repo = options.repo ?? (await makeGitRepo());
  const agent = options.agent ?? critic();
  const adjudicators = new AdjudicatorRegistry();
  if (options.human !== undefined) {
    adjudicators.register('human', options.human);
  }
  const ledger = new DecisionLedger(repo);
  const tracer = new Tracer(new FixedClock(), new SimpleEventDispatcher(), new SequenceIds());
  const executor = new StepExecutor({
    runners: new FakeRegistry([agent]),
    guards: new GuardRegistry(),
    tracer,
    adjudicators,
    ledger,
    clock: new FixedClock(),
    redact,
  });
  const span = await tracer.startTrace('root');
  const run = (step = debate(), signal?: AbortSignal) =>
    executor.run(step, workflow, repo, span, signal === undefined ? {} : { signal });
  return { repo, agent, ledger, span, run };
}

const accept = (note = 'good enough'): Scripted => new Scripted(() => new Ruling(Verdict.Accept, note));

describe('a debate with an arbiter that reaches consensus', () => {
  it('never consults the arbiter, but still leaves the transcript', async () => {
    const human = accept();
    const agreeing = new FakeRunner('agent', () => new RunResult({ exitCode: 0, output: 'AGREEMENT: fine' }));
    const { run, repo, span } = await fixture({ human, agent: agreeing });

    expect((await run()).ok).toBe(true);
    expect(human.requests).toHaveLength(0);
    expect(Object.keys(span.attributes).filter((k) => k.startsWith('indaba.arbiter'))).toEqual([]);
    expect(await readFile(join(repo, '.indaba', 'artifacts', 'debate.transcript.md'), 'utf8')).toContain(
      'AGREEMENT',
    );
  });
});

describe('a debate without an arbiter that fails', () => {
  it('escalates as it always did and writes the transcript, redacted', async () => {
    const { run, repo, ledger } = await fixture();
    const outcome = await run(withoutArbiter());

    expect(outcome.escalate).toBe(true);
    expect(outcome.feedback).toContain('No consensus');
    const transcript = await readFile(join(repo, '.indaba', 'artifacts', 'debate.transcript.md'), 'utf8');
    expect(transcript).toContain('## Round 1: a (CRITIQUE)');
    expect(transcript).toContain('fix the loop [redacted]');
    expect(transcript).not.toContain(SECRET);
    await expect(readFile(ledger.pathOf('review'), 'utf8')).rejects.toThrow();
  });
});

describe('an arbiter that accepts', () => {
  it('completes the step, records the ruling and leaves the ruling file', async () => {
    const human = accept(`ship it, key ${SECRET}`);
    const { run, repo, ledger, span } = await fixture({ human });

    const outcome = await run();

    expect(outcome.ok).toBe(true);
    expect(human.requests).toHaveLength(1);
    expect(human.requests[0]?.stepId).toBe('debate');
    expect(human.requests[0]?.topic).toBe('Is src fine?');
    expect(human.requests[0]?.transcript.length).toBeGreaterThan(0);
    expect(span.attributes['indaba.arbiter.kind']).toBe('human');
    expect(span.attributes['indaba.arbiter.verdict']).toBe('accept');
    expect(span.attributes['indaba.arbiter.source']).toBe('asked');

    const lines = (await readFile(ledger.pathOf('review'), 'utf8')).split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    const saved: Record<string, unknown> = JSON.parse(lines[0] ?? '');
    expect(saved).toMatchObject({
      workflow: 'review',
      stepId: 'debate',
      kind: 'human',
      verdict: 'accept',
      note: 'ship it, key [redacted]',
      decidedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(typeof saved.key).toBe('string');
    expect(typeof saved.commit).toBe('string');

    const ruling = await readFile(join(repo, '.indaba', 'artifacts', 'debate.ruling.md'), 'utf8');
    expect(ruling).toContain('Verdict: accept');
    expect(ruling).toContain('ship it, key [redacted]');
    expect(ruling).not.toContain(SECRET);
  });

  it('puts neither the transcript nor the note in a span attribute', async () => {
    const { run, span } = await fixture({ human: accept('a distinctive note') });
    await run();
    const attributes = JSON.stringify(span.attributes);
    expect(attributes).not.toContain('a distinctive note');
    expect(attributes).not.toContain('fix the loop');
    expect(attributes).not.toContain(SECRET);
  });
});

describe('an arbiter that rejects', () => {
  it('escalates with the note, and records the ruling', async () => {
    const human = new Scripted(() => new Ruling(Verdict.Reject, 'not yet'));
    const { run, span, ledger } = await fixture({ human });

    const outcome = await run();

    expect(outcome.ok).toBe(false);
    expect(outcome.escalate).toBe(true);
    expect(outcome.feedback).toContain('Rejected by the arbiter "human": not yet');
    expect(outcome.feedback).toContain('No consensus');
    expect(span.attributes['indaba.arbiter.verdict']).toBe('reject');
    expect(await readFile(ledger.pathOf('review'), 'utf8')).toContain('"verdict":"reject"');
  });

  it('says so when no note was given', async () => {
    const { run } = await fixture({ human: new Scripted(() => new Ruling(Verdict.Reject, '')) });
    expect((await run()).feedback).toContain('(no note)');
  });
});

describe('an arbiter that cannot answer', () => {
  it('escalates and records nothing when it returns null', async () => {
    const human = new Scripted(() => null);
    const { run, span, ledger, repo } = await fixture({ human });

    const outcome = await run();

    expect(outcome.escalate).toBe(true);
    expect(outcome.feedback).toContain('could not answer');
    expect(span.attributes['indaba.arbiter.verdict']).toBe('unavailable');
    await expect(readFile(ledger.pathOf('review'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(repo, '.indaba', 'artifacts', 'debate.ruling.md'), 'utf8')).rejects.toThrow();
  });

  it('escalates when nothing is registered under the name', async () => {
    const { run, span } = await fixture();
    const outcome = await run(debate({ arbiter: 'robot' }));
    expect(outcome.escalate).toBe(true);
    expect(outcome.feedback).toContain('The arbiter "robot" is not available');
    expect(span.attributes['indaba.arbiter.verdict']).toBe('unavailable');
  });

  it('fails, not escalates, when the arbiter itself throws, and redacts the reason', async () => {
    const human = new Scripted(() => Promise.reject(new Error(`broke with ${SECRET}`)));
    const { run } = await fixture({ human });

    const outcome = await run();

    expect(outcome.escalate).toBe(false);
    expect(outcome.ok).toBe(false);
    expect(outcome.feedback).toBe('The arbiter "human" failed: broke with [redacted]');
  });

  it('reports a non-Error throw too', async () => {
    const human = new Scripted(() => Promise.reject('plain text'));
    const { run } = await fixture({ human });
    expect((await run()).feedback).toBe('The arbiter "human" failed: plain text');
  });

  it('cancels, and writes no ruling, when the run is aborted while it waits', async () => {
    const controller = new AbortController();
    const human = new Scripted(() => {
      controller.abort();
      return new Ruling(Verdict.Accept, 'too late');
    });
    const { run, ledger } = await fixture({ human });

    const outcome = await run(debate(), controller.signal);

    expect(outcome.cancelled).toBe(true);
    await expect(readFile(ledger.pathOf('review'), 'utf8')).rejects.toThrow();
  });

  it('cancels when the arbiter throws because the run was aborted', async () => {
    const controller = new AbortController();
    const human = new Scripted(() => {
      controller.abort();
      return Promise.reject(new Error('stopped'));
    });
    const { run } = await fixture({ human });
    expect((await run(debate(), controller.signal)).cancelled).toBe(true);
  });
});

describe('remembering a ruling', () => {
  it('answers the same question on the same files from the ledger, without a new debate', async () => {
    const first = accept('fine');
    const { run, agent, repo } = await fixture({ human: first });
    expect((await run()).ok).toBe(true);
    const spoken = agent.requests.length;
    expect(spoken).toBeGreaterThan(0);

    const second = accept('should not be asked');
    const again = await fixture({ human: second, agent, repo });
    const outcome = await again.run();

    expect(outcome.ok).toBe(true);
    expect(second.requests).toHaveLength(0);
    expect(agent.requests).toHaveLength(spoken);
    expect(again.span.attributes['indaba.arbiter.source']).toBe('memo');
    expect(again.span.attributes['indaba.arbiter.verdict']).toBe('accept');
    expect(again.span.attributes['indaba.arbiter.kind']).toBe('human');
    expect(again.span.attributes['indaba.consensus.outcome']).toBeUndefined();
  });

  it('reuses a rejection as well, and says it was decided before', async () => {
    const first = new Scripted(() => new Ruling(Verdict.Reject, 'no'));
    const { run, agent, repo } = await fixture({ human: first });
    await run();

    const again = await fixture({ human: accept(), agent, repo });
    const outcome = await again.run();

    expect(outcome.escalate).toBe(true);
    expect(outcome.feedback).toContain('Rejected by the arbiter "human": no');
    expect(outcome.feedback).toContain('Ruled earlier');
  });

  it('cleans what a hand-edited ledger says before it reaches the reason or a span', async () => {
    const { run, ledger, repo } = await fixture({ human: accept() });
    const memo = await ledger.memoKey('review', 'debate', 'Is src fine?');
    if (!('key' in memo)) {
      throw new Error('expected a key');
    }
    await ledger.append({
      key: memo.key,
      workflow: 'review',
      stepId: 'debate',
      kind: `hu\u001b[2Jman ${SECRET}`,
      verdict: Verdict.Reject,
      note: `\u001b]0;owned\u0007no, ${SECRET}`,
      outcome: 'stalled',
      rounds: 2,
      decidedAt: '2026-01-01T00:00:00.000Z',
    });

    const outcome = await run();

    expect(outcome.feedback).toContain('Rejected by the arbiter "human [redacted]": no, [redacted]');
    expect(outcome.feedback).not.toContain('\u001b');
    expect(outcome.feedback).not.toContain(SECRET);
  });

  it('asks again when the question changed', async () => {
    const { run, agent, repo } = await fixture({ human: accept() });
    await run();

    const second = accept('again');
    const again = await fixture({ human: second, agent, repo });
    await again.run(debate({ goal: 'A different question' }));

    expect(second.requests).toHaveLength(1);
    expect(again.span.attributes['indaba.arbiter.source']).toBe('asked');
  });

  it('asks again when a file changed, and does not remember while the tree is dirty', async () => {
    const { run, agent, repo } = await fixture({ human: accept() });
    await run();

    await writeFile(join(repo, 'src', 'app.txt'), 'edited\n');
    const second = accept('after the edit');
    const again = await fixture({ human: second, agent, repo });
    await again.run();

    expect(second.requests).toHaveLength(1);
    expect(again.span.attributes['indaba.arbiter.memo']).toBe('skipped');
    const lines = (await readFile(again.ledger.pathOf('review'), 'utf8')).split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1] ?? '')).not.toHaveProperty('key');
  });

  it('does not look anything up for a step without an arbiter', async () => {
    const { run, span } = await fixture();
    await run(withoutArbiter());
    expect(span.attributes['indaba.arbiter.memo']).toBeUndefined();
  });

  it('fails, naming the line, when the ledger is damaged', async () => {
    const { run, ledger, repo } = await fixture({ human: accept() });
    await mkdir(join(repo, LEDGER_DIRECTORY), { recursive: true });
    await writeFile(ledger.pathOf('review'), 'garbage\n');

    const outcome = await run();

    expect(outcome.ok).toBe(false);
    expect(outcome.escalate).toBe(false);
    expect(outcome.feedback).toContain('line 1 is not valid JSON');
  });

  it('works without a ledger at all', async () => {
    const repo = await makeGitRepo();
    const human = accept();
    const tracer = new Tracer(new FixedClock(), new SimpleEventDispatcher(), new SequenceIds());
    const adjudicators = new AdjudicatorRegistry();
    adjudicators.register('human', human);
    const executor = new StepExecutor({
      runners: new FakeRegistry([critic()]),
      guards: new GuardRegistry(),
      tracer,
      adjudicators,
    });
    const span = await tracer.startTrace('root');

    const outcome = await executor.run(debate(), workflow, repo, span);

    expect(outcome.ok).toBe(true);
    expect(human.requests).toHaveLength(1);
    await expect(readFile(join(repo, LEDGER_DIRECTORY, 'review.jsonl'), 'utf8')).rejects.toThrow();
  });
});
