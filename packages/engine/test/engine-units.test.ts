import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  GuardType,
  Isolation,
  McpCapability,
  McpPolicy,
  type Runner,
  RunResult,
  Span,
  SpanEnded,
  type StepDefinition,
  type WorkflowDefinition,
  WorkspaceError,
} from '@indaba/core';
import { describe, expect, it } from 'vitest';
import {
  Git,
  GitDiffEmptyGuard,
  GitWorktreeManager,
  JsonlSpanExporter,
  McpPlanner,
  PatchService,
  PromptBuilder,
} from '../src/index.js';
import { FakeRegistry, FakeRunner, makeGitRepo, makeTempDir } from './support.js';

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

const docs = { name: 'docs', command: 'run', args: [], env: {} };

function workflow(steps: StepDefinition[], extra: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    version: '1.0',
    name: 't',
    artifacts: {},
    roles: {
      a: { name: 'a', runner: 'plain', mcp: ['docs'] },
      b: { name: 'b', runner: 'plain', mcp: [] },
    },
    steps,
    mcpServers: { docs },
    defaultMcpPolicy: McpPolicy.Required,
    ...extra,
  };
}

const plain = new FakeRunner('plain', () => new RunResult({ exitCode: 0, output: '' }));
const injected: Runner & { mcpCapability(): string } = {
  name: 'inj',
  mcpCapability: () => McpCapability.Injected,
  run: async () => new RunResult({ exitCode: 0, output: '' }),
};

/** A Git whose every command fails with a chosen error. */
class FailingGit extends Git {
  constructor(private readonly error: Error) {
    super();
  }

  override async run(): Promise<string> {
    throw this.error;
  }
}

describe('McpPlanner resolution', () => {
  const planner = new McpPlanner(new FakeRegistry([plain, injected]));

  it('uses only the step servers when the role is unknown or absent', () => {
    const s = step({ id: 's', mcp: ['docs'] });

    expect(planner.resolve(workflow([s]), s, 'ghost', injected).injected).toEqual([docs]);
    expect(planner.resolve(workflow([s]), s, undefined, injected).injected).toEqual([docs]);
  });

  it('merges role and step servers without duplicates', () => {
    const s = step({ id: 's', mcp: ['docs'] });

    expect(planner.resolve(workflow([s]), s, 'a', injected).injected).toEqual([docs]);
  });

  it('returns an empty resolution when nothing is wanted', () => {
    const s = step({ id: 's' });

    expect(planner.resolve(workflow([s]), s, 'b', injected)).toEqual({
      injected: [],
      assumed: [],
      skipped: [],
      missing: [],
    });
  });

  it('fails closed on a server the workflow does not define', () => {
    const s = step({ id: 's', mcp: ['ghost'] });

    expect(planner.resolve(workflow([s]), s, undefined, injected).missing).toEqual(['ghost']);
  });
});

describe('McpPlanner speakers and preflight', () => {
  const planner = new McpPlanner(new FakeRegistry([plain, injected]));

  it('names the step runner when there is no role', () => {
    const s = step({ id: 's', runner: 'plain' });

    expect(planner.speakers(workflow([s]), s)).toEqual([[undefined, 'plain']]);
    expect(planner.speakers(workflow([step({ id: 'n' })]), step({ id: 'n' }))).toEqual([[undefined, '']]);
  });

  it('lists every role of a consensus once, skipping roles that do not exist', () => {
    const s = step({ id: 's', role: 'a', consensusWith: ['a', 'b', 'ghost'] });
    const withoutRole = step({ id: 'r', consensusWith: ['b'] });

    expect(planner.speakers(workflow([s]), s)).toEqual([
      ['a', 'plain'],
      ['b', 'plain'],
    ]);
    expect(planner.speakers(workflow([withoutRole]), withoutRole)).toEqual([['b', 'plain']]);
  });

  it('skips a step whose runner is unknown instead of failing the preflight', () => {
    const s = step({ id: 's', runner: 'nobody', mcp: ['docs'] });

    expect(planner.preflight(workflow([s]))).toEqual([]);
  });

  it('rethrows what is not a missing runner', () => {
    const exploding = new McpPlanner({
      get: () => {
        throw new TypeError('registry bug');
      },
    });
    const s = step({ id: 's', runner: 'plain' });

    expect(() => exploding.preflight(workflow([s]))).toThrow(TypeError);
  });
});

describe('Git environment and cancellation', () => {
  it('drops variables that redirect git and variables without a value', async () => {
    const repo = await makeGitRepo();
    const other = await makeTempDir();
    const git = new Git({
      env: {
        PATH: process.env.PATH,
        GIT_DIR: join(other, 'nowhere'),
        GIT_WORK_TREE: other,
        UNSET: undefined,
      },
    });

    expect((await git.run(['rev-parse', '--show-toplevel'], repo)).trim().toLowerCase()).toBe(
      repo.replaceAll('\\', '/').toLowerCase(),
    );
  });

  it('rejects with a WorkspaceError when the signal is already aborted', async () => {
    const repo = await makeGitRepo();

    await expect(new Git().run(['status'], repo, { signal: AbortSignal.abort() })).rejects.toBeInstanceOf(
      WorkspaceError,
    );
  });

  it('reports a failing command with its arguments and directory', async () => {
    const repo = await makeGitRepo();

    await expect(new Git().run(['rev-parse', '--verify', 'no-such-ref'], repo)).rejects.toThrow(
      /git rev-parse --verify no-such-ref failed in/,
    );
  });

  it('rejects when git cannot start in that directory', async () => {
    await expect(new Git().run(['status'], join(await makeTempDir(), 'missing'))).rejects.toBeInstanceOf(
      WorkspaceError,
    );
  });
});

describe('services that wrap git', () => {
  it('the guard checks the whole tree when given no paths', async () => {
    const repo = await makeGitRepo();
    await writeFile(join(repo, 'stray.txt'), 'x');

    const result = await new GitDiffEmptyGuard().check({ type: GuardType.GitDiffEmpty, paths: [] }, repo);

    expect(result.passed).toBe(false);
    expect(result.message).toContain('Changes are not allowed under .');
    expect(result.message).toContain('stray.txt');
  });

  it('the guard rethrows what is not a workspace error', async () => {
    const guard = new GitDiffEmptyGuard(new FailingGit(new TypeError('bug')));

    await expect(guard.check({ type: GuardType.GitDiffEmpty, paths: [] }, '.')).rejects.toThrow(TypeError);
  });

  it('the patch service answers false for a workspace error and rethrows anything else', async () => {
    const refusing = new PatchService(new FailingGit(new WorkspaceError('no')));
    const exploding = new PatchService(new FailingGit(new TypeError('bug')));

    expect(await refusing.canApply('diff', '.')).toBe(false);
    await expect(exploding.canApply('diff', '.')).rejects.toThrow(TypeError);
    await expect(refusing.apply('   ', '.')).resolves.toBeUndefined();
    await expect(refusing.apply('diff', '.')).rejects.toBeInstanceOf(WorkspaceError);
  });

  it('the worktree manager reports a root it cannot create and refuses unsafe names', async () => {
    const repo = await makeGitRepo();
    await writeFile(join(repo, '.indaba'), 'a file where the directory should be');
    const manager = new GitWorktreeManager(repo);

    await expect(manager.create('t')).rejects.toThrow(/Cannot create/);
    await expect(manager.create('../escape')).rejects.toThrow(/Unsafe task or variant name/);
    await expect(manager.create('ok', 'a..b')).rejects.toThrow(/Unsafe task or variant name/);
  });
});

describe('JsonlSpanExporter with an unfinished span', () => {
  it('writes nulls for what is not known yet', async () => {
    const dir = await makeTempDir();
    const span = new Span('abc123', 'def456', undefined, 'open', new Date(0));

    await new JsonlSpanExporter(dir).onSpanEnded(new SpanEnded(span));

    const record = JSON.parse((await readFile(join(dir, 'abc123.jsonl'), 'utf8')).trim());
    expect(record.end).toBeNull();
    expect(record.duration_ms).toBeNull();
    expect(record.parent_span_id).toBeNull();
    expect(record.status_message).toBeNull();
  });

  it('refuses a trace directory it cannot create', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, 'file'), 'x');
    const span = new Span('abc123', 'def456', undefined, 'open', new Date(0));

    await expect(
      new JsonlSpanExporter(join(dir, 'file', 'traces')).onSpanEnded(new SpanEnded(span)),
    ).rejects.toThrow(/Cannot create trace directory/);
  });
});

describe('PromptBuilder', () => {
  const builder = new PromptBuilder();

  it('omits empty sections and ignores blank feedback', () => {
    const prompt = builder.build(step({ id: 's', goal: 'g' }), '   ');

    expect(prompt).toBe('# Role: agent\n\n## Goal\ng');
  });

  it('lists artifacts, outputs and the tail of the feedback for a role', () => {
    const prompt = builder.build(
      step({ id: 's', role: 'dev', goal: 'g', inputArtifacts: ['in.md'], outputs: ['out.md'] }),
      'failure text',
    );

    expect(prompt).toContain('# Role: dev');
    expect(prompt).toContain('- in.md');
    expect(prompt).toContain('- out.md');
    expect(prompt).toContain('failure text');
  });
});
