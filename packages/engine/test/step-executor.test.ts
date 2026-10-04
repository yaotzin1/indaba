import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DecisionType,
  GuardResult,
  Isolation,
  McpPolicy,
  type Runner,
  RunnerError,
  type RunRequest,
  RunResult,
  SimpleEventDispatcher,
  type Span,
  type StepDefinition,
  TokenUsage,
  Tracer,
  type WorkflowDefinition,
} from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { GuardRegistry, StepExecutor, StepOutcome } from '../src/index.js';
import { FakeRegistry, FakeRunner, FixedClock, makeTempDir, SequenceIds } from './support.js';

const ok = (output = 'ok'): RunResult => new RunResult({ exitCode: 0, output });

function step(overrides: Partial<StepDefinition> & { id: string }): StepDefinition {
  return {
    goal: '',
    dependsOn: [],
    inputArtifacts: [],
    outputs: [],
    commands: [],
    guards: [],
    isolation: Isolation.None,
    consensusWith: [],
    mcp: [],
    ...overrides,
  };
}

function workflow(steps: StepDefinition[], extra: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    version: '1.0',
    name: 't',
    artifacts: {},
    roles: {
      a: { name: 'a', runner: 'agent', mcp: [] },
      b: { name: 'b', runner: 'other', model: 'm-b', mcp: [] },
    },
    steps,
    mcpServers: {},
    defaultMcpPolicy: McpPolicy.Required,
    ...extra,
  };
}

async function fixture(runners: readonly Runner[], guards = new GuardRegistry()) {
  const tracer = new Tracer(new FixedClock(), new SimpleEventDispatcher(), new SequenceIds());
  const executor = new StepExecutor({ runners: new FakeRegistry(runners), guards, tracer });
  const span = await tracer.startTrace('root');
  return { executor, tracer, span };
}

function capable(
  name: string,
  capability: string,
  seen: RunRequest[] = [],
): Runner & { mcpCapability(): string } {
  return {
    name,
    mcpCapability: () => capability,
    run: async (request) => {
      seen.push(request);
      return ok('AGREEMENT: fine');
    },
  };
}

describe('StepExecutor.run', () => {
  it('runs shell commands, streaming output, and reports the failing one', async () => {
    const chunks: string[] = [];
    const shell = new FakeRunner('shell', (request) => {
      request.onOutput?.(`ran ${request.prompt}`);
      return request.prompt === 'bad'
        ? new RunResult({ exitCode: 3, output: '', errorOutput: 'boom' })
        : ok();
    });
    const { executor, span } = await fixture([shell]);
    const wf = workflow([]);

    const good = await executor.run(step({ id: 's', runner: 'shell', commands: ['one'] }), wf, '.', span, {
      onOutput: (c) => chunks.push(c),
    });
    const bad = await executor.run(
      step({ id: 's', runner: 'shell', commands: ['one', 'bad', 'never'] }),
      wf,
      '.',
      span,
    );

    expect(good.ok).toBe(true);
    expect(chunks).toEqual(['ran one']);
    expect(bad.ok).toBe(false);
    expect(bad.feedback).toContain('`bad` exited with code 3');
    expect(bad.feedback).toContain('boom');
    expect(shell.requests.map((r) => r.prompt)).toEqual(['one', 'one', 'bad']);
  });

  it('runs an agent step through a plain runner without a role', async () => {
    const agent = new FakeRunner('plain', () => ok());
    const { executor, span } = await fixture([agent]);

    const outcome = await executor.run(
      step({ id: 's', runner: 'plain', goal: 'g' }),
      workflow([]),
      '.',
      span,
    );

    expect(outcome.ok).toBe(true);
    expect(agent.requests[0]?.model).toBeUndefined();
    expect(agent.requests[0]?.prompt).toContain('# Role: agent');
  });

  it('fails an agent step that names neither role nor runner', async () => {
    const { executor, span } = await fixture([]);

    const outcome = await executor.run(step({ id: 's' }), workflow([]), '.', span);

    expect(outcome.ok).toBe(false);
    expect(outcome.feedback).toContain('neither role nor runner');
  });

  it('fails when a role names an unknown runner', async () => {
    const { executor, span } = await fixture([]);

    const outcome = await executor.run(step({ id: 's', role: 'a' }), workflow([]), '.', span);

    expect(outcome.ok).toBe(false);
    expect(outcome.feedback).toContain('Unknown runner "agent"');
  });

  it('reports a failing agent with the tail of its error', async () => {
    const agent = new FakeRunner(
      'agent',
      () => new RunResult({ exitCode: 9, output: '', errorOutput: 'it broke' }),
    );
    const { executor, span } = await fixture([agent]);

    const outcome = await executor.run(step({ id: 's', role: 'a' }), workflow([]), '.', span);

    expect(outcome.ok).toBe(false);
    expect(outcome.feedback).toContain('Runner agent exited with code 9.');
    expect(outcome.feedback).toContain('it broke');
  });

  it('records usage against the role model, preferring the model the runner reports', async () => {
    const usage = new TokenUsage(10, 5);
    const first = new FakeRunner('other', () => new RunResult({ exitCode: 0, output: '', usage }));
    const second = new FakeRunner(
      'agent',
      () => new RunResult({ exitCode: 0, output: '', usage, model: 'reported' }),
    );
    const third = new FakeRunner('plain', () => new RunResult({ exitCode: 0, output: '', usage }));
    const spans: Span[] = [];
    const tracer = new Tracer(new FixedClock(), new SimpleEventDispatcher(), new SequenceIds());
    const original = tracer.endSpan.bind(tracer);
    tracer.endSpan = async (span, status, message) => {
      spans.push(span);
      await original(span, status, message);
    };
    const executor = new StepExecutor({
      runners: new FakeRegistry([first, second, third]),
      guards: new GuardRegistry(),
      tracer,
    });
    const root = await tracer.startTrace('root');
    const wf = workflow([]);

    await executor.run(step({ id: 's', role: 'b' }), wf, '.', root);
    await executor.run(step({ id: 's', role: 'a' }), wf, '.', root);
    await executor.run(step({ id: 's', runner: 'plain' }), wf, '.', root);

    expect(spans[0]?.attributes[Tracer.ATTR_MODEL]).toBe('m-b');
    expect(spans[1]?.attributes[Tracer.ATTR_MODEL]).toBe('reported');
    expect(spans[2]?.attributes[Tracer.ATTR_MODEL]).toBeUndefined();
    expect(spans[2]?.attributes[Tracer.ATTR_INPUT_TOKENS]).toBeUndefined();
    expect(spans[0]?.attributes['indaba.exit_code']).toBe(0);
  });

  it('rethrows what is not an Indaba error and reports cancellation when aborted', async () => {
    const exploding = new FakeRunner('agent', () => {
      throw new TypeError('bug');
    });
    const { executor, span } = await fixture([exploding]);
    const wf = workflow([]);

    await expect(executor.run(step({ id: 's', role: 'a' }), wf, '.', span)).rejects.toThrow(TypeError);

    const controller = new AbortController();
    controller.abort();
    const cancelled = await executor.run(step({ id: 's', role: 'a' }), wf, '.', span, {
      signal: controller.signal,
    });
    expect(cancelled.cancelled).toBe(true);
    expect(exploding.requests).toHaveLength(1);
  });

  it('turns an Indaba error from the runner into a failed step', async () => {
    const failing = new FakeRunner('agent', () => {
      throw new RunnerError('cannot start');
    });
    const { executor, span } = await fixture([failing]);

    const outcome = await executor.run(step({ id: 's', role: 'a' }), workflow([]), '.', span);

    expect(outcome.feedback).toBe('cannot start');
  });

  it('fails a step before running it when a required MCP server is unavailable', async () => {
    const bare = new FakeRunner('agent', () => ok());
    const { executor, span } = await fixture([bare]);
    const wf = workflow([], { mcpServers: { docs: { name: 'docs', command: 'run', args: [], env: {} } } });

    const outcome = await executor.run(step({ id: 's', role: 'a', mcp: ['docs'] }), wf, '.', span);

    expect(outcome.ok).toBe(false);
    expect(outcome.feedback).toContain('Required MCP server(s) unavailable for runner agent: docs');
    expect(bare.requests).toHaveLength(0);
  });

  it('records MCP names on the span, appending across calls and never the definition', async () => {
    const seen: RunRequest[] = [];
    const { executor, span } = await fixture([
      capable('agent', 'injected', seen),
      capable('other', 'agent_managed'),
    ]);
    const docs = { name: 'docs', command: 'run', args: [], env: { K: 'v' } };
    const wf = workflow([], { mcpServers: { docs, more: { ...docs, name: 'more' } } });

    await executor.run(step({ id: 's', role: 'a', mcp: ['docs'] }), wf, '.', span);
    await executor.run(step({ id: 's', role: 'a', mcp: ['more'] }), wf, '.', span);
    await executor.run(step({ id: 's', role: 'b', mcp: ['docs'] }), wf, '.', span);

    expect(span.attributes['indaba.mcp.servers']).toBe('docs,more');
    expect(span.attributes['indaba.mcp.assumed']).toBe('docs');
    expect(JSON.stringify(span.attributes)).not.toContain('"v"');
    expect(seen[0]?.mcpServers?.map((d) => d.name)).toEqual(['docs']);
  });
});

describe('StepExecutor consensus', () => {
  it('debates with the declared topic, artifacts and a model per role', async () => {
    const a = new FakeRunner('agent', () => ok('AGREEMENT: fine'));
    const b = new FakeRunner('other', () => ok('AGREEMENT: fine'));
    const { executor, span } = await fixture([a, b]);

    const outcome = await executor.run(
      step({
        id: 's',
        role: 'a',
        goal: 'Decide X',
        consensusWith: ['b'],
        inputArtifacts: ['spec.md', 'plan.md'],
        decisionType: DecisionType.Consensus,
      }),
      workflow([]),
      '.',
      span,
    );

    expect(outcome.ok).toBe(true);
    expect(a.requests[0]?.prompt).toContain('Decide X');
    expect(a.requests[0]?.prompt).toContain('Relevant artifacts:\n- spec.md\n- plan.md');
    expect(a.requests[0]?.model).toBeUndefined();
    expect(b.requests[0]?.model).toBe('m-b');
    expect(span.attributes['indaba.consensus.rounds']).toBeGreaterThan(0);
  });

  it('uses a default topic, defaults the decision type and works without a step role', async () => {
    const b = new FakeRunner('other', () => ok('AGREEMENT: fine'));
    const { executor, span } = await fixture([b]);

    const outcome = await executor.run(step({ id: 's', consensusWith: ['b'] }), workflow([]), '.', span);

    expect(outcome.ok).toBe(true);
    expect(b.requests[0]?.prompt).toContain('Review the work produced so far');
    expect(b.requests[0]?.prompt).not.toContain('Relevant artifacts');
  });

  it('escalates when no consensus is reached', async () => {
    const a = new FakeRunner('agent', () => ok('OBJECTION: no'));
    const { executor, span } = await fixture([a]);

    const outcome = await executor.run(
      step({ id: 's', role: 'a', decisionType: DecisionType.Consensus }),
      workflow([]),
      '.',
      span,
    );

    expect(outcome.escalate).toBe(true);
    expect(outcome.feedback).toContain('No consensus');
  });

  it('fails the step when a participant needs an MCP server its runner cannot provide', async () => {
    const a = new FakeRunner('agent', () => ok('AGREEMENT: fine'));
    const { executor, span } = await fixture([a]);
    const wf = workflow([], { mcpServers: { docs: { name: 'docs', command: 'run', args: [], env: {} } } });

    const outcome = await executor.run(
      step({ id: 's', role: 'a', mcp: ['docs'], decisionType: DecisionType.Consensus }),
      wf,
      '.',
      span,
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.feedback).toContain('step "s", role "a": docs');
  });
});

describe('StepExecutor.validate and resolvePath', () => {
  it('passes with the outputs present and every guard satisfied', async () => {
    const dir = await makeTempDir();
    await mkdir(join(dir, 'out'));
    await writeFile(join(dir, 'out', 'a.txt'), 'x');
    const guards = new GuardRegistry().register({ type: 'pass', check: async () => GuardResult.pass() });
    const { executor } = await fixture([], guards);

    const outcome = await executor.validate(
      step({ id: 's', outputs: ['out/a.txt', '/out\\a.txt'], guards: [{ type: 'pass', paths: [] }] }),
      dir,
    );

    expect(outcome.ok).toBe(true);
  });

  it('names the guard that failed, with its message', async () => {
    const dir = await makeTempDir();
    const guards = new GuardRegistry().register({
      type: 'deny',
      check: async () => GuardResult.fail('nope'),
    });
    const { executor } = await fixture([], guards);

    const outcome = await executor.validate(step({ id: 's', guards: [{ type: 'deny', paths: [] }] }), dir);

    expect(outcome).toEqual(StepOutcome.failed('Guard deny failed: nope'));
  });

  it('refuses outputs that are missing, directories, escaping or poisoned', async () => {
    const dir = await makeTempDir();
    await mkdir(join(dir, 'folder'));
    const { executor } = await fixture([]);

    for (const output of ['missing.txt', 'folder', '../outside.txt', `bad${String.fromCharCode(0)}name`]) {
      const outcome = await executor.validate(step({ id: 's', outputs: [output] }), dir);
      expect(outcome.ok, output).toBe(false);
    }
  });

  it('resolves nothing for a working directory that does not exist', async () => {
    const dir = await makeTempDir();
    const { executor } = await fixture([]);

    expect(await executor.resolvePath(join(dir, 'gone'), 'a.txt')).toBeUndefined();
    expect(await executor.resolvePath(dir, 'new/a.txt')).toBe(join(dir, 'new', 'a.txt'));
  });

  it('refuses a symlink that leads out of the working directory', async () => {
    const dir = await makeTempDir();
    const outside = await makeTempDir();
    await writeFile(join(outside, 'secret.txt'), 'x');
    try {
      await symlink(outside, join(dir, 'link'), 'junction');
    } catch {
      return; // the platform does not allow creating links here
    }
    const { executor } = await fixture([]);

    expect(await executor.resolvePath(dir, 'link/secret.txt')).toBeUndefined();
  });
});
