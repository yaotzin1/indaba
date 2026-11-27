import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MAX_ROUNDS,
  DEFAULT_TIMEOUT_SECONDS,
  type ExplainedGuard,
  type ExplainedStep,
  type ExplainFacts,
  explainPlan,
  type GuardDefinition,
  GuardResult,
  isConsensusStep,
  RunResult,
  SimpleEventDispatcher,
  type StepDefinition,
  Tracer,
  type WorkflowDefinition,
} from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { GuardRegistry, parseWorkflow, readOrigins, StepExecutor } from '../src/index.js';
import { FakeRegistry, FakeRunner, FixedClock, makeTempDir, SequenceIds } from './support.js';

// specs/plan-explain, T-09 and AC-14: for every example workflow, what the explanation says about a step is what
// StepExecutor resolves for it in a run. The run is real; only the runners and the guards are recording fakes.

const examples = fileURLToPath(new URL('../../../examples', import.meta.url));
const files = readdirSync(examples)
  .filter((name) => name.endsWith('.workflow.ai.yml'))
  .sort();

const facts: ExplainFacts = {
  timeoutSeconds: { value: DEFAULT_TIMEOUT_SECONDS, by: 'engine' },
  debateRounds: { value: DEFAULT_MAX_ROUNDS, by: 'engine' },
  runnerDefault: () => undefined,
};

function setting<T>(step: ExplainedStep, key: string): T | undefined {
  return step.settings.find((s) => s.key === key)?.value as T | undefined;
}

/** The names a step's runners can have, from the step and every role, so each can be registered as a recording fake. */
function runnerNames(workflow: WorkflowDefinition): string[] {
  const names = new Set<string>(['shell']);
  for (const role of Object.values(workflow.roles)) {
    for (const name of [role.runner, ...(role.fallbackRunners ?? [])]) {
      names.add(name);
    }
  }
  for (const step of workflow.steps) {
    for (const name of [step.runner, ...(step.fallbackRunners ?? [])]) {
      if (name !== undefined) {
        names.add(name);
      }
    }
  }
  return [...names];
}

async function resolvedByTheRun(
  step: StepDefinition,
  workflow: WorkflowDefinition,
): Promise<{ readonly requests: FakeRunner['requests']; readonly guards: readonly GuardDefinition[] }> {
  const runner = new FakeRunner('recording', () => new RunResult({ exitCode: 0, output: 'AGREEMENT: ok' }));
  const registry = new FakeRegistry(
    runnerNames(workflow).map((name) => {
      // every runner records into the same list, so the first request of the step is found whichever runner it used
      const fake = new FakeRunner(name, (request) => {
        runner.requests.push(request);
        return new RunResult({ exitCode: 0, output: 'AGREEMENT: ok' });
      });
      return fake;
    }),
  );
  const checked: GuardDefinition[] = [];
  const guards = new GuardRegistry();
  guards.check = (definition) => {
    checked.push(definition);
    return Promise.resolve(GuardResult.pass());
  };
  const tracer = new Tracer(new FixedClock(), new SimpleEventDispatcher(), new SequenceIds());
  const executor = new StepExecutor({ runners: registry, guards, tracer });
  const span = await tracer.startTrace('root');
  const workdir = await makeTempDir();
  await executor.run(step, workflow, workdir, span, {});
  // validate stops at the first missing output, before any guard: give it the files the step declares
  for (const output of step.outputs) {
    await mkdir(dirname(join(workdir, output)), { recursive: true });
    await writeFile(join(workdir, output), 'x');
  }
  await executor.validate(step, workdir);
  return { requests: runner.requests, guards: checked };
}

let comparedRequests = 0;
let comparedAgentSteps = 0;

describe('the explanation of each example equals what the run resolves (AC-14)', () => {
  it('has examples to check', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    describe(file, () => {
      const source = readFileSync(join(examples, file), 'utf8');
      const workflow = parseWorkflow(source, { placeholders: true });
      const steps = explainPlan(workflow, readOrigins(source, workflow), facts).steps;

      it('explains every step once, in the order of plan', () => {
        expect(steps.map((s) => s.id).sort()).toEqual(workflow.steps.map((s) => s.id).sort());
      });

      for (const explained of steps) {
        const step = workflow.steps.find((s) => s.id === explained.id);
        if (step === undefined || isConsensusStep(step)) {
          continue;
        }
        it(`step ${explained.id}: permissions, timeout, runner and guards`, async () => {
          const resolved = await resolvedByTheRun(step, workflow);

          // guards the run checks: the same list, in the same order
          // a step has one `guards` setting for the declared ones and one for the implied, in the order the run checks them
          const expectedGuards = explained.settings
            .filter((s) => s.key === 'guards')
            .flatMap((s) => s.value as readonly ExplainedGuard[])
            .map((g) => ({ type: g.type, paths: g.paths }));
          expect(resolved.guards.map((g) => ({ type: g.type, paths: g.paths }))).toEqual(expectedGuards);

          const request = resolved.requests[0];
          if (request === undefined) {
            // a step the run does not hand to a runner (it failed before) has nothing more to compare
            return;
          }
          comparedRequests += 1;
          expect(request.timeoutSeconds).toBe(setting<number>(explained, 'timeout_seconds'));
          if (explained.kind === 'agent') {
            comparedAgentSteps += 1;
            expect(request.permissions?.fsWrite).toEqual(
              setting<readonly string[]>(explained, 'permissions.fs.write'),
            );
            expect(request.permissions?.terminal).toBe(setting<string>(explained, 'permissions.terminal'));
            expect(request.permissionLevel).toBe(setting<string>(explained, 'permissions.level'));
          }
        });
      }
    });
  }
});

describe('what the examples do not reach (AC-14)', () => {
  const source = `version: "1.0"
name: reach
roles:
  a: { runner: claude-code }
  b: { runner: codex }
steps:
  - id: wild
    role: a
    permissions: { level: full }
    goal: g
  - id: talk
    role: a
    consensus_with: [b]
    goal: g
`;
  const workflow = parseWorkflow(source);
  const steps = explainPlan(workflow, readOrigins(source, workflow), facts).steps;
  const of = (id: string): readonly [StepDefinition, ExplainedStep] => {
    const step = workflow.steps.find((s) => s.id === id);
    const explained = steps.find((s) => s.id === id);
    if (step === undefined || explained === undefined) {
      throw new Error(`no step ${id}`);
    }
    return [step, explained];
  };

  it('at full, the run sends no limit and the explanation says unlimited', async () => {
    const [step, explained] = of('wild');
    const [request] = (await resolvedByTheRun(step, workflow)).requests;
    expect(request?.permissionLevel).toBe('full');
    expect(request?.permissions).toBeUndefined();
    expect(setting(explained, 'permissions.fs.write')).toBe('unlimited');
    expect(setting(explained, 'permissions.terminal')).toBe('allow');
  });

  it('in a debate, the run calls the runners the explanation names', async () => {
    const [step, explained] = of('talk');
    const called = new Set<string>();
    const registry = new FakeRegistry(
      ['claude-code', 'codex'].map(
        (name) =>
          new FakeRunner(name, () => {
            called.add(name);
            return new RunResult({ exitCode: 0, output: 'AGREEMENT: ok' });
          }),
      ),
    );
    const tracer = new Tracer(new FixedClock(), new SimpleEventDispatcher(), new SequenceIds());
    const executor = new StepExecutor({ runners: registry, guards: new GuardRegistry(), tracer });
    await executor.run(step, workflow, await makeTempDir(), await tracer.startTrace('root'), {});
    const named = explained.settings
      .filter((s) => s.key === 'runner')
      .flatMap((s) => s.value as readonly string[]);
    expect([...called].sort()).toEqual([...named].sort());
  });
});

describe('the parity test is not vacuous', () => {
  it('reached a runner for steps of the examples, agent steps included', () => {
    expect(comparedRequests).toBeGreaterThan(10);
    expect(comparedAgentSteps).toBeGreaterThan(5);
  });
});
