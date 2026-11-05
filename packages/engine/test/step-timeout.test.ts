import {
  RunResult,
  SimpleEventDispatcher,
  type Span,
  SpanEnded,
  Tracer,
  WorkflowValidationError,
} from '@indaba/core';
import { describe, expect, it } from 'vitest';
import {
  GitWorktreeManager,
  GuardRegistry,
  parseWorkflow,
  StepExecutor,
  WorkflowEngine,
  WorkflowStatus,
} from '../src/index.js';
import { FakeRegistry, FakeRunner, FixedClock, makeGitRepo, SequenceIds } from './support.js';

// specs/step-stalls, release 1: a step's own timeout_seconds.

const HEAD = 'version: "1.0"\nname: t\nroles:\n  w: {runner: work}\n  c: {runner: work}\n';

async function run(workflow: string, globalSeconds?: number, exitCode = 0) {
  const repo = await makeGitRepo();
  const events = new SimpleEventDispatcher();
  const spans: Span[] = [];
  events.addListener(SpanEnded, (e) => {
    spans.push(e.span);
  });
  const work = new FakeRunner(
    'work',
    (request) =>
      new RunResult({
        exitCode,
        output: 'AGREEMENT: ok',
        ...(exitCode === 124 ? { errorOutput: `\nTimed out after ${request.timeoutSeconds} seconds.` } : {}),
      }),
  );
  const shell = new FakeRunner('shell', () => new RunResult({ exitCode: 0, output: '' }));
  const ids = new SequenceIds();
  const tracer = new Tracer(new FixedClock(), events, ids);
  const engine = new WorkflowEngine({
    executor: new StepExecutor({
      runners: new FakeRegistry([work, shell]),
      guards: GuardRegistry.withDefaults(),
      tracer,
      events,
      ...(globalSeconds === undefined ? {} : { timeoutSeconds: globalSeconds }),
    }),
    tracer,
    events,
    workspaces: new GitWorktreeManager(repo),
    projectDir: repo,
    ids,
  });
  const result = await engine.run(parseWorkflow(workflow));
  return { result, work, shell, spans };
}

function problems(yaml: string): string {
  try {
    parseWorkflow(yaml);
  } catch (error) {
    if (error instanceof WorkflowValidationError) {
      return error.problems.join('\n');
    }
    throw error;
  }
  return '';
}

const step = (extra: string) => `${HEAD}steps:\n  - id: a\n    role: w\n    goal: g\n${extra}`;

describe('timeout_seconds in the file (AC-01)', () => {
  it('reads a whole number from 1 to 86400', () => {
    expect(parseWorkflow(step('    timeout_seconds: 1\n')).steps[0]?.timeoutSeconds).toBe(1);
    expect(parseWorkflow(step('    timeout_seconds: 86400\n')).steps[0]?.timeoutSeconds).toBe(86400);
  });

  it('leaves the field absent, not undefined, when the step does not set it', () => {
    expect(Object.hasOwn(parseWorkflow(step('')).steps[0] ?? {}, 'timeoutSeconds')).toBe(false);
    expect(
      Object.hasOwn(parseWorkflow(step('    timeout_seconds:\n')).steps[0] ?? {}, 'timeoutSeconds'),
    ).toBe(false);
  });

  it.each(['0', '86401', '-5', '1.5', '"10"', '[1]', '.nan', '.inf', 'true'])(
    'refuses %s with the contract message',
    (value) => {
      expect(problems(step(`    timeout_seconds: ${value}\n`))).toBe(
        'step "a": timeout_seconds must be a whole number from 1 to 86400',
      );
    },
  );

  it('is accepted on a shell step and on a debate step (AC-14)', () => {
    expect(
      parseWorkflow(`${HEAD}steps:\n  - {id: s, runner: shell, commands: [x], timeout_seconds: 5}\n`).steps[0]
        ?.timeoutSeconds,
    ).toBe(5);
    expect(
      parseWorkflow(`${HEAD}steps:\n  - {id: d, role: w, consensus_with: [c], timeout_seconds: 7}\n`).steps[0]
        ?.timeoutSeconds,
    ).toBe(7);
  });

  it('keeps the refusal of permissions.timeout_seconds as it was (C-01)', () => {
    expect(problems(step('    permissions: {timeout_seconds: 5}\n'))).toContain(
      'timeout_seconds is not supported',
    );
  });
});

describe('the limit a call receives (AC-01, AC-02, AC-14, AC-20)', () => {
  it('sends the step own number to an agent call, ahead of the run one', async () => {
    const { result, work } = await run(step('    timeout_seconds: 42\n'), 600);
    expect(result.status).toBe(WorkflowStatus.Completed);
    expect(work.requests[0]?.timeoutSeconds).toBe(42);
  });

  it('falls back to the run timeout, then to 900, when the step sets none', async () => {
    expect((await run(step(''), 600)).work.requests[0]?.timeoutSeconds).toBe(600);
    expect((await run(step(''))).work.requests[0]?.timeoutSeconds).toBe(900);
  });

  it('applies to each command of a shell step', async () => {
    const { shell } = await run(
      `${HEAD}steps:\n  - {id: s, runner: shell, commands: [one, two], timeout_seconds: 9}\n`,
      600,
    );
    expect(shell.requests.map((r) => r.timeoutSeconds)).toEqual([9, 9]);
  });

  it('applies to each participant call of a debate, and a debate without it sends none (as before)', async () => {
    const debate = (extra: string) =>
      `${HEAD}steps:\n  - {id: d, role: w, consensus_with: [c], decision_type: consensus, goal: g${extra}}\n`;
    const limited = await run(debate(', timeout_seconds: 30'), 600);
    expect(limited.work.requests.length).toBeGreaterThan(1);
    expect(limited.work.requests.every((r) => r.timeoutSeconds === 30)).toBe(true);
    const plain = await run(debate(''), 600);
    expect(plain.work.requests.every((r) => !Object.hasOwn(r, 'timeoutSeconds'))).toBe(true);
  });

  it('fails a step the runner reports as timed out, with the number it was given (AC-03)', async () => {
    const { result } = await run(step('    timeout_seconds: 3\n'), undefined, 124);
    expect(result.status).toBe(WorkflowStatus.Failed);
    expect(JSON.stringify(result)).toContain('Timed out after 3 seconds.');
  });
});

describe('the step span (events.md, R1)', () => {
  it('carries indaba.step.timeout_seconds only when the step sets it', async () => {
    const set = await run(step('    timeout_seconds: 42\n'));
    expect(set.spans.find((s) => s.name === 'step a')?.attributes['indaba.step.timeout_seconds']).toBe(42);
    const unset = await run(step(''));
    const attributes = unset.spans.find((s) => s.name === 'step a')?.attributes ?? {};
    expect(Object.hasOwn(attributes, 'indaba.step.timeout_seconds')).toBe(false);
  });
});
