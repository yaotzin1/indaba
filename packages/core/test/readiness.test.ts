import { describe, expect, it } from 'vitest';
import {
  type AttentionItem,
  analyzeReadiness,
  defineStep,
  Isolation,
  type ReadinessProbe,
  type Requirement,
  type WorkflowDefinition,
} from '../src/index.js';

const SECRET_VALUE = ['sk', 'or', 'fake', 'value', '12345'].join('-');

function probe(over: Partial<ReadinessProbe> = {}): ReadinessProbe {
  return {
    isEnvSet: () => true,
    fileState: () => 'file',
    hasExecutable: () => true,
    isRunnerRegistered: () => true,
    envNamesOf: () => [],
    workspaceKind: () => 'git',
    ...over,
  };
}

function workflow(over: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    version: '1',
    name: 'w',
    artifacts: {},
    roles: {},
    steps: [],
    mcpServers: {},
    defaultMcpPolicy: 'required',
    ...over,
  } as WorkflowDefinition;
}

const real = (report: { readonly items: readonly AttentionItem[] }): readonly AttentionItem[] =>
  report.items.filter((item) => item.kind !== 'workspace');

const NONE: ReadonlySet<string> = new Set();
const INPUTS: ReadonlyMap<string, unknown> = new Map();

describe('analyzeReadiness', () => {
  it('reports a runner as ready or missing, once per step in step order (AC-01, C-07)', () => {
    const w = workflow({
      steps: [defineStep({ id: 'a', runner: 'codex' }), defineStep({ id: 'b', runner: 'claude-code' })],
    });
    const report = analyzeReadiness(w, INPUTS, probe({ isRunnerRegistered: (t) => t === 'codex' }), NONE);
    expect(real(report).map((i) => [i.id, i.state])).toEqual([
      ['runner:b:claude-code', 'missing'],
      ['runner:a:codex', 'ready'],
    ]);
    expect(report.criticalMissing).toBe(1);
    expect(real(report)[0]?.critical).toBe(true);
  });

  it('skips a shell step and checks a role runner and its fallbacks', () => {
    const w = workflow({
      roles: { dev: { name: 'dev', runner: 'codex', fallbackRunners: ['opencode'], mcp: [] } },
      steps: [defineStep({ id: 'x', runner: 'shell' }), defineStep({ id: 'y', role: 'dev' })],
    });
    const report = analyzeReadiness(w, INPUTS, probe(), NONE);
    expect(real(report).map((i) => i.id)).toEqual(['runner:y:codex', 'runner:y:opencode']);
  });

  it('reports a variable by name and state and never by value (AC-02)', () => {
    const w = workflow({ steps: [defineStep({ id: 'a', runner: 'openrouter' })] });
    const env: Record<string, string> = { OPENROUTER_API_KEY: SECRET_VALUE };
    const report = analyzeReadiness(
      w,
      INPUTS,
      probe({ envNamesOf: () => ['OPENROUTER_API_KEY'], isEnvSet: (n) => (env[n] ?? '') !== '' }),
      NONE,
    );
    const secret = report.items.find((i) => i.kind === 'secret');
    expect(secret?.state).toBe('ready');
    const text = JSON.stringify(report);
    expect(text).not.toContain(SECRET_VALUE);
    expect(text).not.toContain(String(SECRET_VALUE.length));
    env.OPENROUTER_API_KEY = '';
    const again = analyzeReadiness(
      w,
      INPUTS,
      probe({ envNamesOf: () => ['OPENROUTER_API_KEY'], isEnvSet: (n) => (env[n] ?? '') !== '' }),
      NONE,
    );
    expect(again.items.find((i) => i.kind === 'secret')?.state).toBe('missing');
  });

  it('checks an input artifact that no earlier step produces (AC-04)', () => {
    const w = workflow({
      steps: [
        defineStep({ id: 'a', runner: 'shell', outputs: ['out.md'] }),
        defineStep({ id: 'b', runner: 'shell', inputArtifacts: ['out.md', 'brief.md', '/etc/x'] }),
      ],
    });
    const state = (p: string): 'file' | 'missing' | 'outside' =>
      p === 'brief.md' ? 'missing' : p === '/etc/x' ? 'outside' : 'file';
    const report = analyzeReadiness(w, INPUTS, probe({ fileState: state }), NONE);
    expect(real(report).map((i) => [i.id, i.state])).toEqual([
      ['artifact:b:brief.md', 'missing'],
      ['artifact:b:/etc/x', 'missing'],
    ]);
    expect(real(report)[1]?.message).toContain('outside the project');
    expect(report.criticalMissing).toBe(0);
  });

  it('says what isolation is wanted and missing only without git (AC-05)', () => {
    const w = workflow({
      steps: [defineStep({ id: 'a', runner: 'shell', isolation: Isolation.GitWorktree })],
    });
    expect(analyzeReadiness(w, INPUTS, probe(), NONE).items[0]?.state).toBe('ready');
    expect(analyzeReadiness(w, INPUTS, probe({ workspaceKind: () => 'plain' }), NONE).items[0]?.state).toBe(
      'missing',
    );
    expect(real(analyzeReadiness(workflow(), INPUTS, probe(), NONE))).toEqual([]);
  });

  it('lists a non-default permission as ready information (AC-06)', () => {
    const w = workflow({
      steps: [
        defineStep({
          id: 'a',
          runner: 'shell',
          permissions: { level: 'edit', fsRead: [], fsWrite: [], terminal: 'deny' } as never,
        }),
      ],
    });
    const item = analyzeReadiness(w, INPUTS, probe(), NONE).items[0];
    expect(item).toMatchObject({ kind: 'permission', state: 'ready', critical: false });
  });

  describe('declared requirements (AC-08)', () => {
    const needs: readonly Requirement[] = [
      { kind: 'env', name: 'TOKEN', description: 'a token', critical: true },
      { kind: 'file', name: 'docs/x.md', description: 'the file' },
      { kind: 'tool', name: 'jq', description: 'json tool' },
      { kind: 'account', name: 'Google', description: 'an OAuth client', how: 'Create one' },
      { kind: 'decision', name: 'plan', description: 'chosen plan' },
      { kind: 'asset', name: 'mockup', description: 'the mockup' },
    ];

    it('checks env, file and tool, and asks the person about the rest', () => {
      const report = analyzeReadiness(
        workflow({ requires: needs }),
        INPUTS,
        probe({ isEnvSet: () => false, fileState: () => 'missing', hasExecutable: () => false }),
        NONE,
      );
      const byKind = Object.fromEntries(report.items.map((i) => [i.kind, i.state]));
      expect(byKind).toMatchObject({
        env: 'missing',
        file: 'missing',
        tool: 'missing',
        account: 'needs-confirmation',
        decision: 'needs-confirmation',
        asset: 'needs-confirmation',
      });
      expect(report.needsConfirmation).toBe(3);
      expect(report.criticalMissing).toBe(1);
    });

    it('a confirmation by id turns it confirmed, and ids are stable (AC-12)', () => {
      const w = workflow({ requires: needs });
      const first = analyzeReadiness(w, INPUTS, probe(), NONE);
      const id = first.items.find((i) => i.kind === 'account')?.id;
      expect(id).toBe('account:-:Google');
      const second = analyzeReadiness(w, INPUTS, probe(), new Set([id ?? '']));
      expect(second.items.find((i) => i.kind === 'account')?.state).toBe('confirmed');
      expect(second.needsConfirmation).toBe(2);
    });
  });

  it('orders critical missing, needs confirmation, other missing, then the rest (AC-10)', () => {
    const w = workflow({
      steps: [defineStep({ id: 'a', runner: 'shell', inputArtifacts: ['gone.md'] })],
      requires: [
        { kind: 'tool', name: 'git', description: 'git' },
        { kind: 'decision', name: 'd', description: 'd' },
        { kind: 'env', name: 'K', description: 'k', critical: true },
      ],
    });
    const run = () =>
      analyzeReadiness(w, INPUTS, probe({ isEnvSet: () => false, fileState: () => 'missing' }), NONE)
        .items.filter((i) => i.kind !== 'workspace')
        .map((i) => i.id);
    expect(run()).toEqual(['env:-:K', 'decision:-:d', 'artifact:a:gone.md', 'tool:-:git']);
    expect(run()).toEqual(run());
  });

  it('a probe that throws gives unknown and never throws (C-03)', () => {
    const boom = (): never => {
      throw new Error('EACCES');
    };
    const w = workflow({
      steps: [
        defineStep({ id: 'a', runner: 'codex', inputArtifacts: ['f'], isolation: Isolation.GitWorktree }),
      ],
      requires: [
        { kind: 'env', name: 'E', description: 'e' },
        { kind: 'file', name: 'F', description: 'f' },
        { kind: 'tool', name: 'T', description: 't' },
      ],
    });
    const report = analyzeReadiness(
      w,
      INPUTS,
      probe({
        isEnvSet: boom,
        fileState: boom,
        hasExecutable: boom,
        isRunnerRegistered: boom,
        envNamesOf: boom,
        workspaceKind: boom,
      }),
      NONE,
    );
    expect(report.items.length).toBeGreaterThan(0);
    expect(report.items.every((i) => i.state === 'unknown')).toBe(true);
    expect(report.criticalMissing).toBe(0);
    expect(JSON.stringify(report)).not.toContain('EACCES');
  });
});

describe('review corrections', () => {
  it('says the isolation on every run, and shows no permission item for the workflow default', () => {
    const plain = analyzeReadiness(
      workflow({ steps: [defineStep({ id: 'a', runner: 'shell' })] }),
      INPUTS,
      probe(),
      NONE,
    );
    expect(plain.items.map((i) => i.id)).toEqual(['workspace:-:isolation']);
    const w = workflow({
      defaultPermissions: { level: 'edit', fsRead: [], fsWrite: [], terminal: 'deny' } as never,
      steps: [
        defineStep({
          id: 'a',
          runner: 'shell',
          permissions: { level: 'edit', fsRead: [], fsWrite: [], terminal: 'deny' } as never,
        }),
      ],
    });
    expect(analyzeReadiness(w, INPUTS, probe(), NONE).items.some((i) => i.kind === 'permission')).toBe(false);
  });

  it('drops an empty how', () => {
    const w = workflow({ requires: [{ kind: 'env', name: 'E', description: 'd', how: '  ' }] });
    expect(analyzeReadiness(w, INPUTS, probe({ isEnvSet: () => false }), NONE).items[0]?.how).toBeUndefined();
  });
});
