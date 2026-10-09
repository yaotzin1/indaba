import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import {
  type Adjudicator,
  AgentMessage,
  MessageType,
  Ruling,
  type RulingRequest,
  RunResult,
  Verdict,
} from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { terminalAdjudicator } from '../src/arbiter-prompt.js';
import { createEngine } from '../src/index.js';
import { makeGitRepo } from './support.js';

const REQUEST: RulingRequest = {
  stepId: 'debate',
  topic: 'Is it fine?',
  outcome: 'max_rounds_exceeded',
  rounds: 4,
  transcript: [
    new AgentMessage('claude', MessageType.Critique, 'First finding.\u001b[31m red \u001b[0m', 1),
    new AgentMessage('antigravity', MessageType.Critique, 'x'.repeat(3500), 1),
  ],
};

async function ask(
  answers: string[],
  options: { request?: RulingRequest; signal?: AbortSignal; endAfter?: boolean } = {},
): Promise<{ ruling: Ruling | null; shown: string }> {
  const input = new PassThrough();
  const output = new PassThrough();
  let shown = '';
  output.on('data', (chunk: Buffer) => {
    shown += chunk.toString('utf8');
  });
  const pending = terminalAdjudicator(input, output).rule(options.request ?? REQUEST, options.signal);
  for (const answer of answers) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    input.write(`${answer}\n`);
  }
  if (answers.length === 0 || options.endAfter === true) {
    input.end();
  }
  return { ruling: await pending, shown };
}

describe('terminalAdjudicator', () => {
  it('shows the debate with escape sequences removed and long messages cut', async () => {
    const { shown } = await ask(['a', '']);
    expect(shown).toContain('step "debate" ended without consensus (max_rounds_exceeded after 4 round(s))');
    expect(shown).toContain('--- round 1: claude (CRITIQUE)');
    expect(shown).toContain('First finding. red');
    expect(shown).not.toContain('\u001b');
    expect(shown).toContain('(cut; the rest is in the transcript file)');
    expect(shown).not.toContain('x'.repeat(3100));
  });

  it.each([
    ['a', Verdict.Accept],
    ['accept', Verdict.Accept],
    ['ACCEPT', Verdict.Accept],
    ['r', Verdict.Reject],
    ['  Reject ', Verdict.Reject],
  ])('takes %j as %s, then a note', async (answer, verdict) => {
    const { ruling } = await ask([answer, '  the note  ']);
    expect(ruling?.verdict).toBe(verdict);
    expect(ruling?.note).toBe('the note');
    expect(ruling?.source).toBe('asked');
  });

  it('accepts with no note', async () => {
    expect((await ask(['accept', ''])).ruling?.note).toBe('');
  });

  it('keeps only the first 2000 characters of a note', async () => {
    expect((await ask(['a', 'n'.repeat(5000)])).ruling?.note).toHaveLength(2000);
  });

  it('asks again after something that is neither answer', async () => {
    const { ruling, shown } = await ask(['maybe', '', 'r', 'because']);
    expect(ruling?.verdict).toBe('reject');
    expect(shown.match(/Answer "accept"/g)).toHaveLength(2);
  });

  it('gives up after three bad answers', async () => {
    expect((await ask(['x', 'y', 'z'])).ruling).toBeNull();
  });

  it('returns null when the input closes before an answer', async () => {
    expect((await ask([])).ruling).toBeNull();
  });

  it('returns null when the input closes before the note', async () => {
    expect((await ask(['a'], { endAfter: true })).ruling).toBeNull();
  });

  it('returns null without asking when the run is already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const { ruling, shown } = await ask([], { signal: controller.signal });
    expect(ruling).toBeNull();
    expect(shown).toBe('');
  });

  it('returns null when the run is cancelled while it waits', async () => {
    const controller = new AbortController();
    const input = new PassThrough();
    const output = new PassThrough();
    const pending = terminalAdjudicator(input, output).rule(REQUEST, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    expect(await pending).toBeNull();
  });
});

describe('an adjudicator supplied to the engine', () => {
  const WORKFLOW = `version: "1.0"
name: judged
roles:
  critic:
    runner: fake
steps:
  - id: debate
    role: critic
    goal: Is it fine?
    decision_type: consensus
    arbiter: judge
`;

  function plugin(judge: Adjudicator) {
    return {
      name: 'judging',
      register(host: {
        registerRunner(runner: unknown): void;
        registerAdjudicator(name: string, adjudicator: Adjudicator): void;
      }) {
        host.registerRunner({
          name: 'fake',
          run: () => Promise.resolve(new RunResult({ exitCode: 0, output: 'CRITIQUE: not yet' })),
        });
        host.registerAdjudicator('judge', judge);
      },
    };
  }

  it('lets a plugin register an arbiter that settles a failed debate, and keeps the ruling', async () => {
    const repo = await makeGitRepo();
    const judge: Adjudicator = { rule: () => Promise.resolve(new Ruling(Verdict.Accept, 'by a plugin')) };
    const { engine, parser } = await createEngine({ projectDir: repo, plugins: [plugin(judge)] });

    const result = await engine.run(parser.parse(WORKFLOW));

    expect(result.status).toBe('COMPLETED');
    const ledger = await readFile(join(repo, '.indaba-decisions', 'judged.jsonl'), 'utf8');
    expect(ledger).toContain('"kind":"judge"');
    expect(ledger).toContain('"note":"by a plugin"');
  });

  it('registers the terminal adjudicator as "human" when the front end has one', async () => {
    const repo = await makeGitRepo();
    const human: Adjudicator = { rule: () => Promise.resolve(new Ruling(Verdict.Reject, 'person says no')) };
    const { engine, parser } = await createEngine({
      projectDir: repo,
      humanAdjudicator: human,
      plugins: [plugin({ rule: () => Promise.resolve(null) })],
    });

    const result = await engine.run(parser.parse(WORKFLOW.replace('arbiter: judge', 'arbiter: human')));

    expect(result.status).toBe('ESCALATED');
    expect(result.failureReason).toContain('Rejected by the arbiter "human": person says no');
  });

  it('escalates as before when the workflow names "human" and nobody is at a terminal', async () => {
    const repo = await makeGitRepo();
    const { engine, parser } = await createEngine({
      projectDir: repo,
      plugins: [plugin({ rule: () => Promise.resolve(null) })],
    });

    const result = await engine.run(parser.parse(WORKFLOW.replace('arbiter: judge', 'arbiter: human')));

    expect(result.status).toBe('ESCALATED');
    expect(result.failureReason).toContain('The arbiter "human" is not available');
  });
});
