import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BoardRecorded,
  type Runner,
  RunResult,
  SimpleEventDispatcher,
  SpanEnded,
  SpanStarted,
  StepOutput,
  StepStatusChanged,
  Tracer,
} from '@indaba/core';
import { describe, expect, it } from 'vitest';
import {
  GitWorktreeManager,
  GuardRegistry,
  JsonlSpanExporter,
  parseWorkflow,
  RunEventWriter,
  StepExecutor,
  WorkflowEngine,
  WorkflowStatus,
} from '../src/index.js';
import { FakeRegistry, FakeRunner, FixedClock, makeGitRepo, makeTempDir, SequenceIds } from './support.js';

// AC-27 and AC-31 (specs/run-blackboard): a workflow without `board` fields runs exactly as it did before the feature.
// The golden files in fixtures/no-board were written by the code as it was before the board existed (the commit on
// main this branch started from), not by the code under test. To write them again, on purpose, from that older code:
// INDABA_WRITE_GOLDEN=1 pnpm vitest run packages/engine/test/board-regression.test.ts
const GOLDEN = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'no-board');

const WORKFLOW = `
version: "1.0"
name: regression
roles:
  worker: {runner: agent}
steps:
  - id: build
    role: worker
    goal: build it
    on_failure: {action: retry_step, target: build, max_retries: 1}
  - id: check
    role: worker
    goal: check it
    depends_on: [build]
    on_failure: {action: retry_step, target: build, max_retries: 1}
  - id: verify
    depends_on: [check]
    runner: shell
    commands: ["echo ok"]
`;

interface Captured {
  readonly status: WorkflowStatus;
  readonly trace: string;
  readonly events: string;
  readonly prompts: string;
  readonly boardRecords: number;
}

/** One deterministic run: the first check fails once, so the retry path, its feedback and its resets are in it. */
async function capture(): Promise<Captured> {
  const repo = await makeGitRepo();
  const traceDir = await makeTempDir();
  const events = new SimpleEventDispatcher();
  const exporter = new JsonlSpanExporter(traceDir);
  const writer = new RunEventWriter({ directory: traceDir, clock: new FixedClock() });
  events.addListener(SpanEnded, (e) => exporter.onSpanEnded(e));
  events.addListener(SpanStarted, (e) => writer.onSpanStarted(e));
  events.addListener(SpanEnded, (e) => writer.onSpanEnded(e));
  events.addListener(StepStatusChanged, (e) => writer.onStepStatus(e));
  events.addListener(StepOutput, (e) => writer.onOutput(e));
  let boardRecords = 0;
  events.addListener(BoardRecorded, () => {
    boardRecords += 1;
  });

  let checks = 0;
  const agent = new FakeRunner('agent', (request) => {
    request.onOutput?.('working\n');
    if (request.prompt.includes('check it')) {
      checks += 1;
      return new RunResult({
        exitCode: checks === 1 ? 1 : 0,
        output: 'checked BOARD note: ignored without the field',
      });
    }
    return new RunResult({ exitCode: 0, output: 'built' });
  });
  const shell = new FakeRunner('shell', (request) => {
    request.onOutput?.('ok\n');
    return new RunResult({ exitCode: 0, output: 'ok' });
  });
  const runners: Runner[] = [agent, shell];

  const ids = new SequenceIds();
  const tracer = new Tracer(new FixedClock(), events, ids);
  const engine = new WorkflowEngine({
    executor: new StepExecutor({
      runners: new FakeRegistry(runners),
      guards: GuardRegistry.withDefaults(),
      tracer,
      events,
    }),
    tracer,
    events,
    workspaces: new GitWorktreeManager(repo),
    projectDir: repo,
    ids,
  });
  const result = await engine.run(parseWorkflow(WORKFLOW), { taskId: 'task-1' });
  await writer.flush();
  const [first, second] = [`${result.traceId}.jsonl`, `${result.traceId}.events.jsonl`];
  const prompts = [...agent.requests, ...shell.requests].map((r) => ({ prompt: r.prompt }));
  return {
    status: result.status,
    // the repository path of a temporary checkout is not part of what is being pinned
    trace: (await readFile(join(traceDir, first), 'utf8')).split(repo).join('<repo>'),
    events: (await readFile(join(traceDir, second), 'utf8')).split(repo).join('<repo>'),
    prompts: `${JSON.stringify(prompts, null, 2).split(repo).join('<repo>')}\n`,
    boardRecords,
  };
}

describe('a workflow without board fields (AC-27, AC-31)', () => {
  it('runs the same twice, so the golden comparison is about the code and not about luck', async () => {
    const [a, b] = [await capture(), await capture()];
    expect(b.trace).toBe(a.trace);
    expect(b.events).toBe(a.events);
    expect(b.prompts).toBe(a.prompts);
  });

  it('keeps the trace file, the event stream and every prompt byte for byte as the code before the board wrote them', async () => {
    const run = await capture();
    expect(run.status).toBe(WorkflowStatus.Completed);
    if (process.env.INDABA_WRITE_GOLDEN === '1') {
      await mkdir(GOLDEN, { recursive: true });
      await writeFile(join(GOLDEN, 'trace.jsonl'), run.trace);
      await writeFile(join(GOLDEN, 'events.jsonl'), run.events);
      await writeFile(join(GOLDEN, 'prompts.json'), run.prompts);
      return;
    }
    expect(run.trace).toBe(await readFile(join(GOLDEN, 'trace.jsonl'), 'utf8'));
    expect(run.events).toBe(await readFile(join(GOLDEN, 'events.jsonl'), 'utf8'));
    expect(run.prompts).toBe(await readFile(join(GOLDEN, 'prompts.json'), 'utf8'));
  });

  it('still passes every board record through the dispatcher, and posts nothing but the start record', async () => {
    const run = await capture();
    // the start record only: no step reads or posts, and there is no debate
    expect(run.boardRecords).toBe(1);
  });
});
