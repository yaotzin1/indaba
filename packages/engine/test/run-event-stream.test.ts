import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
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
  type RunRecord,
  StepExecutor,
  TraceReader,
  WorkflowEngine,
  WorkflowStatus,
} from '../src/index.js';
import { FakeRegistry, FakeRunner, FixedClock, makeGitRepo, makeTempDir, SequenceIds } from './support.js';

const WORKFLOW = `
version: "1.0"
name: stream
roles:
  worker: {runner: agent}
steps:
  - id: build
    role: worker
    goal: build it
  - id: verify
    depends_on: [build]
    runner: shell
    commands: ["echo ok"]
`;

const ok = (): RunResult => new RunResult({ exitCode: 0, output: 'done' });

function runners(): Runner[] {
  return [
    new FakeRunner('agent', (request) => {
      request.onOutput?.('thinking...\n');
      request.onOutput?.('built\n');
      return ok();
    }),
    new FakeRunner('shell', (request) => {
      request.onOutput?.('ok\n');
      return ok();
    }),
  ];
}

interface Run {
  readonly traceDir: string;
  readonly status: WorkflowStatus;
  readonly traceId: string;
}

/** Runs the workflow once, deterministically, writing the trace file and, when asked, the event stream. */
async function runOnce(withEvents: boolean): Promise<Run> {
  const repo = await makeGitRepo();
  const traceDir = await makeTempDir();
  const events = new SimpleEventDispatcher();
  const exporter = new JsonlSpanExporter(traceDir);
  events.addListener(SpanEnded, (e) => exporter.onSpanEnded(e));

  if (withEvents) {
    const writer = new RunEventWriter({ directory: traceDir, clock: new FixedClock() });
    events.addListener(SpanStarted, (e) => writer.onSpanStarted(e));
    events.addListener(SpanEnded, (e) => writer.onSpanEnded(e));
    events.addListener(StepStatusChanged, (e) => writer.onStepStatus(e));
    events.addListener(StepOutput, (e) => writer.onOutput(e));
  }

  const ids = new SequenceIds();
  const tracer = new Tracer(new FixedClock(), events, ids);
  const executor = new StepExecutor({
    runners: new FakeRegistry(runners()),
    guards: GuardRegistry.withDefaults(),
    tracer,
    ...(withEvents ? { events } : {}),
  });
  const engine = new WorkflowEngine({
    executor,
    tracer,
    events,
    workspaces: new GitWorktreeManager(repo),
    projectDir: repo,
    ids,
  });
  const result = await engine.run(parseWorkflow(WORKFLOW), { taskId: 'task-1' });
  return { traceDir, status: result.status, traceId: result.traceId };
}

describe('the event stream and the trace file', () => {
  it('leaves the trace file byte for byte the same, with the writer on or off', async () => {
    const without = await runOnce(false);
    const withWriter = await runOnce(true);

    expect(without.traceId).toBe(withWriter.traceId);
    const plain = await readFile(join(without.traceDir, `${without.traceId}.jsonl`), 'utf8');
    const same = await readFile(join(withWriter.traceDir, `${withWriter.traceId}.jsonl`), 'utf8');
    expect(same).toBe(plain);
    expect(plain.length).toBeGreaterThan(0);
  });

  it('writes the event file only when the writer is on, and nothing else beside the trace', async () => {
    const without = await runOnce(false);
    const withWriter = await runOnce(true);

    expect(await readdir(without.traceDir)).toEqual([`${without.traceId}.jsonl`]);
    expect((await readdir(withWriter.traceDir)).sort()).toEqual([
      `${withWriter.traceId}.events.jsonl`,
      `${withWriter.traceId}.jsonl`,
    ]);
  });

  it('records the whole run: starts, step changes, output, ends and the final status', async () => {
    const run = await runOnce(true);
    const records = await new TraceReader(run.traceDir).readAll(run.traceId);

    expect(run.status).toBe(WorkflowStatus.Completed);
    const names = records.flatMap((r) => (r.type === 'span_started' ? [r.name] : []));
    expect(names).toEqual([
      'indaba.task stream',
      'step build',
      'invoke_agent agent',
      'step verify',
      'execute_tool shell',
    ]);

    const changes = records.flatMap((r) =>
      r.type === 'step_status' ? [`${r.stepId}:${r.from}->${r.to}`] : [],
    );
    expect(changes).toEqual([
      'build:PENDING->RUNNING',
      'build:RUNNING->VALIDATING',
      'build:VALIDATING->COMPLETED',
      'verify:PENDING->RUNNING',
      'verify:RUNNING->VALIDATING',
      'verify:VALIDATING->COMPLETED',
    ]);

    const text = (spanName: string): string => {
      const span = records.find((r) => r.type === 'span_started' && r.name === spanName);
      return records
        .flatMap((r) =>
          r.type === 'output' && r.spanId === (span?.type === 'span_started' ? span.spanId : '')
            ? [r.text]
            : [],
        )
        .join('');
    };
    expect(text('invoke_agent agent')).toBe('thinking...\nbuilt\n');
    expect(text('execute_tool shell')).toBe('ok\n');

    const last = records.at(-1);
    expect(last).toMatchObject({ type: 'span_ended', attributes: { 'indaba.workflow.status': 'COMPLETED' } });
  });

  it('puts every record in order: a span starts before its output and its end', async () => {
    const run = await runOnce(true);
    const records = await new TraceReader(run.traceDir).readAll(run.traceId);

    const position = (predicate: (r: RunRecord) => boolean): number => records.findIndex(predicate);
    const agentSpan = records.find((r) => r.type === 'span_started' && r.name === 'invoke_agent agent');
    const id = agentSpan?.type === 'span_started' ? agentSpan.spanId : '';
    const started = position((r) => r.type === 'span_started' && r.spanId === id);
    const firstOutput = position((r) => r.type === 'output' && r.spanId === id);
    const ended = position((r) => r.type === 'span_ended' && r.spanId === id);
    expect(started).toBeGreaterThanOrEqual(0);
    expect(firstOutput).toBeGreaterThan(started);
    expect(ended).toBeGreaterThan(firstOutput);
  });

  it('can be followed to the end with the reader, and agrees with reading it all at once', async () => {
    const run = await runOnce(true);
    const reader = new TraceReader(run.traceDir);
    const followed: RunRecord[] = [];
    for await (const record of reader.follow(run.traceId)) {
      followed.push(record);
    }
    expect(followed).toEqual(await reader.readAll(run.traceId));
    expect(followed.at(-1)?.type).toBe('span_ended');
  });

  it('shows up as a finished run in the listing, with its status', async () => {
    const run = await runOnce(true);
    const [summary] = await new TraceReader(run.traceDir).listRuns();
    expect(summary).toMatchObject({ runId: run.traceId, status: 'completed' });
  });
});
