import { describe, expect, it } from 'vitest';
import {
  Blackboard,
  DagBuilder,
  defineStep,
  isTerminalStatus,
  McpPolicy,
  type McpServerDefinition,
  type Runner,
  RunnerParticipant,
  type RunRequest,
  RunResult,
  SimpleEventDispatcher,
  Span,
  SpanStatus,
  StepStatus,
  TokenUsage,
  Tracer,
  type WorkflowDefinition,
} from '../src/index.js';

function workflow(deps: Record<string, string[]>): WorkflowDefinition {
  return {
    version: '1.0',
    name: 't',
    artifacts: {},
    roles: {},
    steps: Object.entries(deps).map(([id, dependsOn]) => defineStep({ id, runner: 'shell', dependsOn })),
    mcpServers: {},
    defaultMcpPolicy: McpPolicy.Required,
  };
}

describe('SimpleEventDispatcher', () => {
  class Ping {}
  class Pong {}

  it('drops a listener failure by default and keeps dispatching', async () => {
    const dispatcher = new SimpleEventDispatcher();
    const seen: string[] = [];
    dispatcher.addListener(Ping, () => {
      throw new Error('listener bug');
    });
    dispatcher.addListener(Ping, () => seen.push('second'));

    await expect(dispatcher.dispatch(new Ping())).resolves.toBeUndefined();

    expect(seen).toEqual(['second']);
  });

  it('only reaches listeners of the event type', async () => {
    const dispatcher = new SimpleEventDispatcher();
    const seen: string[] = [];
    dispatcher.addListener(Pong, () => seen.push('pong'));

    await dispatcher.dispatch(new Ping());

    expect(seen).toEqual([]);
  });

  it('ignores events that are not objects', async () => {
    const dispatcher = new SimpleEventDispatcher((e) => {
      throw new Error(`should not be called: ${String(e)}`);
    });
    dispatcher.addListener(Ping, () => {
      throw new Error('should not run');
    });

    await dispatcher.dispatch('text');
    await dispatcher.dispatch(null);
    await dispatcher.dispatch(42);
  });
});

describe('step statuses', () => {
  it('knows which statuses end a step', () => {
    expect(isTerminalStatus(StepStatus.Completed)).toBe(true);
    expect(isTerminalStatus(StepStatus.Escalated)).toBe(true);
    expect(isTerminalStatus(StepStatus.Pending)).toBe(false);
    expect(isTerminalStatus(StepStatus.Failed)).toBe(false);
  });
});

describe('DagBuilder reachability', () => {
  const dag = new DagBuilder();

  it('has no ancestors for a step it does not know', () => {
    expect(dag.ancestorsOf(workflow({ a: [] }), 'ghost')).toEqual([]);
  });

  it('ignores unknown dependencies and visits a shared ancestor once', () => {
    const wf = workflow({ root: [], left: ['root'], right: ['root'], tip: ['left', 'right', 'ghost'] });

    expect([...dag.ancestorsOf(wf, 'tip')].sort()).toEqual(['left', 'right', 'root']);
    expect(dag.descendantsOf(wf, 'root')).toEqual(['left', 'right', 'tip']);
  });
});

describe('Tracer usage and spans', () => {
  const clock = { now: () => new Date(0) };
  const ids = { next: (n: number) => 'a'.repeat(n) };

  it('records tokens but no cost for a model without a price', async () => {
    const tracer = new Tracer(clock, new SimpleEventDispatcher(), ids);
    const span = await tracer.startTrace('t');

    tracer.recordUsage(span, 'provider', 'unpriced/model', new TokenUsage(3, 4));

    expect(span.attributes[Tracer.ATTR_INPUT_TOKENS]).toBe(3);
    expect(span.attributes[Tracer.ATTR_OUTPUT_TOKENS]).toBe(4);
    expect(span.attributes[Tracer.ATTR_COST_USD]).toBeUndefined();
  });

  it('has no duration until it ends, then the elapsed time', () => {
    const span = new Span('t', 's', undefined, 'n', new Date(1000));

    expect(span.durationMs()).toBeUndefined();
    expect(span.isEnded()).toBe(false);

    span.end(new Date(1500), SpanStatus.Ok);

    expect(span.durationMs()).toBe(500);
    expect(span.isEnded()).toBe(true);
  });
});

describe('RunnerParticipant requests', () => {
  it('passes the model and the servers it was given to the runner', async () => {
    const seen: RunRequest[] = [];
    const runner: Runner = {
      name: 'r',
      run: async (request) => {
        seen.push(request);
        return new RunResult({ exitCode: 0, output: 'AGREEMENT: ok' });
      },
    };
    const server: McpServerDefinition = { name: 'docs', command: 'run', args: [], env: {} };
    const participant = new RunnerParticipant({
      role: 'a',
      runner,
      workdir: '/w',
      model: 'm1',
      mcpServers: [server],
    });

    await participant.respond('topic', new Blackboard(), 1);

    expect(seen[0]?.model).toBe('m1');
    expect(seen[0]?.mcpServers).toEqual([server]);
  });
});
