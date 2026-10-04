import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Clock, IdGenerator, Runner, RunRequest } from '@indaba/core';
import { RunnerError, type RunResult, SimpleEventDispatcher, StepStatusChanged, Tracer } from '@indaba/core';
import { afterEach } from 'vitest';
import {
  Git,
  GitWorktreeManager,
  GuardRegistry,
  type RunnerLookup,
  StepExecutor,
  WorkflowEngine,
} from '../src/index.js';

const tempDirs: string[] = [];

afterEach(async () => {
  const dirs = tempDirs.splice(0);
  for (const dir of dirs) {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

export async function makeTempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'indaba-')));
  tempDirs.push(dir);
  return dir;
}

const IDENTITY = [
  '-c',
  'user.name=Indaba Test',
  '-c',
  'user.email=test@example.invalid',
  '-c',
  'commit.gpgsign=false',
];

export async function makeGitRepo(): Promise<string> {
  const dir = await makeTempDir();
  await mkdir(join(dir, 'src'));
  await writeFile(join(dir, 'src', 'app.txt'), 'v1\n');
  const git = new Git();
  await git.run(['init', '-q', '-b', 'main'], dir);
  await git.run(['config', 'core.autocrlf', 'false'], dir);
  await git.run(['add', '-A'], dir);
  await git.run([...IDENTITY, 'commit', '-q', '-m', 'init'], dir);
  return dir;
}

export class FixedClock implements Clock {
  now(): Date {
    return new Date('2026-01-01T00:00:00.000Z');
  }
}

export class SequenceIds implements IdGenerator {
  private n = 0;

  next(hexLength: number): string {
    this.n += 1;
    return this.n.toString(16).padStart(hexLength, '0');
  }
}

export type Handler = (
  request: RunRequest,
  call: number,
  signal?: AbortSignal,
) => Promise<RunResult> | RunResult;

export class FakeRunner implements Runner {
  readonly requests: RunRequest[] = [];

  constructor(
    readonly name: string,
    private readonly handler: Handler,
  ) {}

  async run(request: RunRequest, signal?: AbortSignal): Promise<RunResult> {
    this.requests.push(request);
    return await this.handler(request, this.requests.length, signal);
  }
}

export class FakeRegistry implements RunnerLookup {
  private readonly runners = new Map<string, Runner>();

  constructor(runners: readonly Runner[]) {
    for (const runner of runners) {
      this.runners.set(runner.name, runner);
    }
  }

  get(name: string): Runner {
    const runner = this.runners.get(name);
    if (runner === undefined) {
      throw new RunnerError(`Unknown runner "${name}".`);
    }
    return runner;
  }
}

export interface Harness {
  readonly engine: WorkflowEngine;
  readonly events: SimpleEventDispatcher;
  readonly transitions: StepStatusChanged[];
}

export function harness(
  repo: string,
  runners: readonly Runner[],
  onListenerError?: (e: unknown) => void,
): Harness {
  const events = new SimpleEventDispatcher(onListenerError);
  const transitions: StepStatusChanged[] = [];
  events.addListener(StepStatusChanged, (e) => {
    transitions.push(e);
  });
  const ids = new SequenceIds();
  const tracer = new Tracer(new FixedClock(), events, ids);
  const registry = new FakeRegistry(runners);
  const executor = new StepExecutor({ runners: registry, guards: GuardRegistry.withDefaults(), tracer });
  const engine = new WorkflowEngine({
    executor,
    tracer,
    events,
    workspaces: new GitWorktreeManager(repo),
    projectDir: repo,
    ids,
  });
  return { engine, events, transitions };
}
