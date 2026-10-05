import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  GuardType,
  PermissionMode,
  RunnerError,
  RunnerUnavailableError,
  RunResult,
  SpanEnded,
  type WorkflowDefinition,
} from '@indaba/core';
import { describe, expect, it } from 'vitest';
import {
  DiffWithinScopeGuard,
  effectiveGuards,
  JsonlSpanExporter,
  parseWorkflow,
  WorkflowParser,
  WorkflowStatus,
  WorkflowValidator,
} from '../src/index.js';
import { FakeRunner, harness, makeGitRepo, makeTempDir } from './support.js';

const ok = (output = 'ok'): RunResult => new RunResult({ exitCode: 0, output });
const unavailable = (name: string): FakeRunner =>
  new FakeRunner(name, () => {
    throw new RunnerUnavailableError(`${name} cannot start`);
  });

function oneStep(extra: string, roles = '', top = ''): string {
  return `
version: "1.0"
name: t
${top}
roles:
${roles}  worker: {runner: [api, acp, cli]}
steps:
  - id: work
    role: worker
    goal: do it
${extra}`;
}

describe('parsing runner lists', () => {
  it('reads a name as before', () => {
    const wf = parseWorkflow(oneStep('', '  solo: {runner: api}\n'));
    expect(wf.roles.solo?.runner).toBe('api');
    expect(wf.roles.solo?.fallbackRunners).toBeUndefined();
  });

  it('reads a list as a primary and its fallbacks, on a role and on a step', () => {
    const wf = parseWorkflow(oneStep('    runner: [x, y]\n'));
    expect(wf.roles.worker).toMatchObject({ runner: 'api', fallbackRunners: ['acp', 'cli'] });
    expect(wf.steps[0]).toMatchObject({ runner: 'x', fallbackRunners: ['y'] });
  });

  it.each([
    ['an empty list', '[]', 'must not be an empty list'],
    ['a duplicate', '[a, b, a]', 'lists the same runner twice'],
    ['a non-string entry', '[a, 3]', 'must be a non-empty string'],
    ['a blank name', '" "', 'must be a non-empty string'],
  ])('rejects %s', (_label, value, message) => {
    expect(() => parseWorkflow(oneStep(`    runner: ${value}\n`))).toThrow(message);
  });

  it('rejects an unknown runner only when a lookup is given', () => {
    const source = oneStep('    runner: [api, nope]\n');
    expect(() => new WorkflowParser().parse(source)).not.toThrow();
    const known = new Set(['api', 'acp', 'cli']);
    expect(() =>
      new WorkflowParser(undefined, undefined, { has: (n) => known.has(n) }).parse(source),
    ).toThrow('steps[0].runner "nope" is not a known runner');
  });
});

describe('parsing agent and permissions', () => {
  it('reads an agent as a preset name or a literal command', () => {
    const named = parseWorkflow(oneStep('    agent: claude\n'));
    expect(named.steps[0]?.agent).toEqual({ preset: 'claude' });
    const literal = parseWorkflow(oneStep('    agent: {command: [my-agent, --acp]}\n'));
    expect(literal.steps[0]?.agent).toEqual({ command: ['my-agent', '--acp'] });
  });

  it('rejects an agent mapping without a command', () => {
    expect(() => parseWorkflow(oneStep('    agent: {command: []}\n'))).toThrow('needs a preset name');
    expect(() => parseWorkflow(oneStep('    agent: 7\n'))).toThrow('must be a name or a mapping');
  });

  it('reads permissions, and denies the terminal unless it is allowed', () => {
    const wf = parseWorkflow(
      oneStep(`    permissions:
      fs:
        read: ["src/**"]
        write: ["src/**", "docs/**"]
`),
    );
    expect(wf.steps[0]?.permissions).toEqual({
      fsRead: ['src/**'],
      fsWrite: ['src/**', 'docs/**'],
      terminal: PermissionMode.Deny,
    });
    const open = parseWorkflow(oneStep('    permissions: {terminal: allow}\n'));
    expect(open.steps[0]?.permissions).toEqual({ fsRead: [], fsWrite: [], terminal: PermissionMode.Allow });
  });

  it('rejects an unknown terminal mode', () => {
    expect(() => parseWorkflow(oneStep('    permissions: {terminal: maybe}\n'))).toThrow(
      'must be "allow" or "deny"',
    );
  });

  it('leaves a step without a permissions block with none', () => {
    expect(parseWorkflow(oneStep('')).steps[0]?.permissions).toBeUndefined();
  });
});

describe('validator warnings', () => {
  const warnings = (extra: string, roles?: string): string[] =>
    new WorkflowValidator().warnings(parseWorkflow(oneStep(extra, roles)));

  it('is quiet for an ordinary workflow', () => {
    expect(warnings('')).toEqual([]);
  });

  it('warns about permissions without isolation, and without an acp runner', () => {
    const found = warnings('    permissions: {fs: {write: ["src/**"]}}\n    runner: [api]\n');
    expect(found.some((w) => w.includes('has no isolation'))).toBe(true);
    expect(found.some((w) => w.includes('no acp runner'))).toBe(true);
  });

  it('does not warn about the acp runner when it is in the chain, or when isolated', () => {
    const found = warnings('    isolation: git_worktree\n    permissions: {fs: {write: ["src/**"]}}\n');
    expect(found).toEqual([]);
  });

  it('warns when a step runner overrides a different role runner', () => {
    expect(
      warnings('    runner: other\n').some((w) => w.includes('takes precedence over role "worker"')),
    ).toBe(true);
    expect(warnings('    runner: [api, acp, cli]\n')).toEqual([]);
  });
});

describe('effective guards', () => {
  it('adds a scope guard for a permissions block, once', () => {
    const wf = parseWorkflow(oneStep('    permissions: {fs: {write: ["src/**"]}}\n'));
    const step = wf.steps[0];
    expect(step).toBeDefined();
    if (step === undefined) {
      return;
    }
    expect(effectiveGuards(step)).toEqual([{ type: GuardType.DiffWithinScope, paths: ['src/**'] }]);
    const explicit = { ...step, guards: [{ type: GuardType.DiffWithinScope, paths: ['docs/**'] }] };
    expect(effectiveGuards(explicit)).toEqual([{ type: GuardType.DiffWithinScope, paths: ['docs/**'] }]);
  });

  it('adds nothing without permissions', () => {
    const step = parseWorkflow(oneStep('')).steps[0];
    expect(step === undefined ? [] : effectiveGuards(step)).toEqual([]);
  });
});

describe('the runner chain', () => {
  async function run(
    source: string,
    runners: FakeRunner[],
  ): Promise<{
    result: Awaited<ReturnType<ReturnType<typeof harness>['engine']['run']>>;
    spans: SpanEnded[];
  }> {
    const repo = await makeGitRepo();
    const h = harness(repo, runners);
    const spans: SpanEnded[] = [];
    h.events.addListener(SpanEnded, (e) => {
      spans.push(e);
    });
    const workflow: WorkflowDefinition = parseWorkflow(source);
    const result = await h.engine.run(workflow, { taskId: 'T' });
    return { result, spans };
  }

  it('uses the primary and never touches the rest when it runs', async () => {
    const api = new FakeRunner('api', () => ok());
    const acp = new FakeRunner('acp', () => ok());
    const { result } = await run(oneStep(''), [api, acp, unavailable('cli')]);
    expect(result.status).toBe(WorkflowStatus.Completed);
    expect(api.requests).toHaveLength(1);
    expect(acp.requests).toHaveLength(0);
  });

  it('falls back when a runner could not run, with the original prompt, and records why', async () => {
    const acp = new FakeRunner('acp', () => ok());
    const { result, spans } = await run(oneStep(''), [unavailable('api'), acp, unavailable('cli')]);

    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    expect(acp.requests).toHaveLength(1);
    expect(acp.requests[0]?.prompt).toContain('do it');
    expect(acp.requests[0]?.prompt).not.toContain('cannot start');

    const events = spans.flatMap((e) => e.span.events);
    expect(events).toEqual([
      {
        name: 'indaba.runner.skipped',
        attributes: { 'indaba.runner': 'api', 'indaba.runner.skip_reason': 'api cannot start' },
      },
    ]);
    const invoked = spans.map((e) => e.span.name).filter((n) => n.startsWith('invoke_agent'));
    expect(invoked).toEqual(['invoke_agent api', 'invoke_agent acp']);
  });

  it('skips a runner the registry does not know', async () => {
    const acp = new FakeRunner('acp', () => ok());
    const { result } = await run(oneStep(''), [acp]);
    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
  });

  it('does not fall back when the runner ran and failed', async () => {
    const api = new FakeRunner(
      'api',
      () => new RunResult({ exitCode: 1, output: '', errorOutput: 'tests red' }),
    );
    const acp = new FakeRunner('acp', () => ok());
    const { result } = await run(oneStep(''), [api, acp]);
    expect(result.status).toBe(WorkflowStatus.Failed);
    expect(result.failureReason).toContain('tests red');
    expect(acp.requests).toHaveLength(0);
  });

  it('does not fall back on a plain RunnerError, which may have happened after the prompt was sent', async () => {
    const api = new FakeRunner('api', () => {
      throw new RunnerError('stream dropped halfway');
    });
    const acp = new FakeRunner('acp', () => ok());
    const { result } = await run(oneStep(''), [api, acp]);
    expect(result.status).toBe(WorkflowStatus.Failed);
    expect(result.failureReason).toContain('stream dropped halfway');
    expect(acp.requests).toHaveLength(0);
  });

  it('fails naming every runner when none could run', async () => {
    const { result } = await run(oneStep(''), [unavailable('api'), unavailable('acp'), unavailable('cli')]);
    expect(result.status).toBe(WorkflowStatus.Failed);
    for (const name of ['api', 'acp', 'cli']) {
      expect(result.failureReason).toContain(`${name}: ${name} cannot start`);
    }
  });

  it('prefers the runner written on the step over the role', async () => {
    const api = new FakeRunner('api', () => ok());
    const other = new FakeRunner('other', () => ok());
    const { result } = await run(oneStep('    runner: other\n'), [api, other]);
    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    expect(other.requests).toHaveLength(1);
    expect(api.requests).toHaveLength(0);
  });

  it('hands the permissions and the agent to the runner', async () => {
    const api = new FakeRunner('api', () => ok());
    const { result } = await run(
      oneStep('    agent: gemini\n    isolation: git_worktree\n    permissions: {fs: {read: ["src/**"]}}\n'),
      [api],
    );
    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    expect(api.requests[0]?.agent).toEqual({ preset: 'gemini' });
    expect(api.requests[0]?.permissions).toEqual({
      fsRead: ['src/**'],
      fsWrite: [],
      terminal: PermissionMode.Deny,
    });
  });

  it('applies the same chain to a consensus participant', async () => {
    const source = `
version: "1.0"
name: t
roles:
  a: {runner: [api, acp]}
  b: {runner: [api, acp]}
steps:
  - id: decide
    role: a
    consensus_with: [b]
    decision_type: consensus
    goal: decide
`;
    const acp = new FakeRunner('acp', () => ok('AGREEMENT: fine'));
    const { result } = await run(source, [unavailable('api'), acp]);
    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    expect(acp.requests.length).toBeGreaterThanOrEqual(2);
  });
});

describe('the scope guard in a run', () => {
  const scoped = (paths: string): string =>
    oneStep(`    isolation: git_worktree\n    permissions: {fs: {write: [${paths}]}}\n`, '', '');

  it('passes when the step only changed files inside its scope', async () => {
    const repo = await makeGitRepo();
    const api = new FakeRunner('api', async (request) => {
      await writeFile(join(request.workdir, 'src', 'app.txt'), 'v2\n');
      return ok();
    });
    const result = await harness(repo, [api]).engine.run(parseWorkflow(scoped('"src/**"')), { taskId: 'S1' });
    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
  });

  it('fails the step, whatever the runner, when it changed something outside', async () => {
    const repo = await makeGitRepo();
    const api = new FakeRunner('api', async (request) => {
      await writeFile(join(request.workdir, 'secrets.txt'), 'oops\n');
      return ok();
    });
    const result = await harness(repo, [api]).engine.run(parseWorkflow(scoped('"src/**"')), { taskId: 'S2' });
    expect(result.status).toBe(WorkflowStatus.Failed);
    expect(result.failureReason).toContain('diff_within_scope');
    expect(result.failureReason).toContain('secrets.txt');
  });
});

describe('DiffWithinScopeGuard', () => {
  const definition = (paths: string[]): { type: string; paths: string[] } => ({
    type: GuardType.DiffWithinScope,
    paths,
  });

  it('passes on a clean tree', async () => {
    const repo = await makeGitRepo();
    expect((await new DiffWithinScopeGuard().check(definition(['src/**']), repo)).passed).toBe(true);
  });

  it('passes for a modified and an untracked file inside the scope', async () => {
    const repo = await makeGitRepo();
    await writeFile(join(repo, 'src', 'app.txt'), 'v2\n');
    await writeFile(join(repo, 'src', 'new file.txt'), 'x\n');
    expect((await new DiffWithinScopeGuard().check(definition(['src/**']), repo)).passed).toBe(true);
  });

  it('fails for an untracked file outside the scope and names it', async () => {
    const repo = await makeGitRepo();
    await writeFile(join(repo, 'outside.txt'), 'x\n');
    const verdict = await new DiffWithinScopeGuard().check(definition(['src/**']), repo);
    expect(verdict.passed).toBe(false);
    expect(verdict.message).toContain('outside.txt');
    expect(verdict.message).toContain('src/**');
  });

  it('fails when a file is moved out of the scope, naming both ends', async () => {
    const repo = await makeGitRepo();
    await rename(join(repo, 'src', 'app.txt'), join(repo, 'moved.txt'));
    const git = new (await import('../src/index.js')).Git();
    await git.run(['add', '-A'], repo);
    const verdict = await new DiffWithinScopeGuard().check(definition(['src/**']), repo);
    expect(verdict.passed).toBe(false);
    expect(verdict.message).toContain('moved.txt');
  });

  it('allows nothing when the list is empty', async () => {
    const repo = await makeGitRepo();
    await writeFile(join(repo, 'src', 'app.txt'), 'v2\n');
    const verdict = await new DiffWithinScopeGuard().check(definition([]), repo);
    expect(verdict.passed).toBe(false);
    expect(verdict.message).toContain('nothing');
  });

  it("ignores Indaba's own runtime directory", async () => {
    const repo = await makeGitRepo();
    await mkdir(join(repo, '.indaba', 'artifacts'), { recursive: true });
    await writeFile(join(repo, '.indaba', 'artifacts', 'spec.md'), '# spec');
    expect((await new DiffWithinScopeGuard().check(definition([]), repo)).passed).toBe(true);
  });

  it('fails closed outside a git repository', async () => {
    const dir = await makeTempDir();
    const verdict = await new DiffWithinScopeGuard().check(definition(['**']), dir);
    expect(verdict.passed).toBe(false);
    expect(verdict.message).toContain('Cannot inspect git state');
  });

  it('measures paths from the working directory when it is a subdirectory', async () => {
    const repo = await makeGitRepo();
    await writeFile(join(repo, 'src', 'app.txt'), 'v2\n');
    await writeFile(join(repo, 'top.txt'), 'x\n');
    const inSrc = await new DiffWithinScopeGuard().check(definition(['**']), join(repo, 'src'));
    expect(inSrc.passed).toBe(false);
    expect(inSrc.message).toContain('outside the working directory');
  });
});

describe('span events in the trace file', () => {
  it('are written only for spans that have them', async () => {
    const dir = await makeTempDir();
    const exporter = new JsonlSpanExporter(dir);
    const { Span, SpanStatus } = await import('@indaba/core');
    const plain = new Span('aa', '01', undefined, 'plain', new Date(0));
    plain.end(new Date(1), SpanStatus.Ok);
    const rich = new Span('aa', '02', undefined, 'rich', new Date(0));
    rich.addEvent('indaba.runner.skipped', { 'indaba.runner': 'api' });
    rich.end(new Date(1), SpanStatus.Ok);
    await exporter.onSpanEnded(new SpanEnded(plain));
    await exporter.onSpanEnded(new SpanEnded(rich));

    const lines = (await readFile(join(dir, 'aa.jsonl'), 'utf8')).trim().split('\n');
    const [first, second] = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(first).not.toHaveProperty('events');
    expect(second?.events).toEqual([
      { name: 'indaba.runner.skipped', attributes: { 'indaba.runner': 'api' } },
    ]);
  });
});
