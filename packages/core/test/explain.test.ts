import { describe, expect, it } from 'vitest';
import {
  AgentMessage,
  ConsensusArbiter,
  ConsensusOutcome,
  DEFAULT_MAX_ROUNDS,
  DEFAULT_TIMEOUT_SECONDS,
  defineStep,
  type ExplainedSetting,
  type ExplainedStep,
  type ExplainFacts,
  effectiveGuards,
  explainPlan,
  GuardType,
  type OriginMap,
  type Participant,
  type RoleDefinition,
  SETTING_ORDER,
  type SettingKey,
  type StepDefinition,
  type StepPermissions,
  stepTimeoutSeconds,
  type WorkflowDefinition,
} from '../src/index.js';

const facts: ExplainFacts = {
  timeoutSeconds: { value: DEFAULT_TIMEOUT_SECONDS, by: 'engine' },
  debateRounds: { value: DEFAULT_MAX_ROUNDS, by: 'engine' },
  runnerDefault: (runner) => (runner === 'claude-code' ? 'edits are accepted without asking' : undefined),
};
const noOrigins: OriginMap = new Map();

function workflow(
  steps: readonly StepDefinition[],
  extra: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  return {
    version: '1',
    name: 'w',
    artifacts: {},
    roles: {},
    steps,
    mcpServers: {},
    defaultMcpPolicy: 'required',
    ...extra,
  };
}

function role(name: string, extra: Partial<RoleDefinition> = {}): RoleDefinition {
  return { name, runner: 'claude-code', mcp: [], ...extra };
}

const edit: StepPermissions = { level: 'edit', fsRead: [], fsWrite: ['src/**'], terminal: 'deny' };
const full: StepPermissions = { level: 'full', fsRead: [], fsWrite: [], terminal: 'allow' };

function one(
  step: StepDefinition,
  extra: Partial<WorkflowDefinition> = {},
  map: OriginMap = noOrigins,
): ExplainedStep {
  const [explained] = explainPlan(workflow([step], extra), map, facts).steps;
  if (explained === undefined) {
    throw new Error('no step explained');
  }
  return explained;
}

function setting(step: ExplainedStep, key: SettingKey): ExplainedSetting | undefined {
  return step.settings.find((s) => s.key === key);
}

describe('DEFAULT_MAX_ROUNDS (C-07)', () => {
  // Different critiques every round, so neither quorum nor ping-pong ends the debate before the budget does.
  const critic = (role: string): Participant => ({
    role,
    respond: (_topic, _board, round) =>
      Promise.resolve(AgentMessage.fromReply(role, `CRITIQUE: point ${role} ${round}`, round)),
  });

  it('is the bound of an arbiter given no option: both stop after the same number of rounds', async () => {
    const people = [critic('a'), critic('b')];
    const bare = await new ConsensusArbiter().deliberate('t', people);
    const named = await new ConsensusArbiter({ maxRounds: DEFAULT_MAX_ROUNDS }).deliberate('t', people);
    expect(DEFAULT_MAX_ROUNDS).toBe(4);
    expect(bare.outcome).toBe(ConsensusOutcome.MaxRoundsExceeded);
    expect(bare.rounds).toBe(DEFAULT_MAX_ROUNDS);
    expect(named.rounds).toBe(bare.rounds);
    expect(named.outcome).toBe(bare.outcome);
  });
});

describe('explainPlan: settings and origins', () => {
  it('gives a short agent step its fallbacks and no invented settings', () => {
    const step = one(defineStep({ id: 'a', runner: 'claude-code' }));
    expect(step.kind).toBe('agent');
    expect(step.settings.map((s) => s.key)).toEqual(['runner', 'isolation', 'timeout_seconds']);
    expect(setting(step, 'runner')).toEqual({
      key: 'runner',
      value: ['claude-code'],
      origin: { kind: 'file' },
    });
    expect(setting(step, 'isolation')?.origin).toEqual({ kind: 'fallback', by: 'engine' });
    expect(setting(step, 'timeout_seconds')).toEqual({
      key: 'timeout_seconds',
      value: 900,
      origin: { kind: 'fallback', by: 'engine' },
    });
  });

  it('names the flag a run timeout came from and keeps the step own limit as a file origin', () => {
    const flagged: ExplainFacts = { ...facts, timeoutSeconds: { value: 120, by: 'flag:--timeout' } };
    const w = workflow([
      defineStep({ id: 'a', runner: 'r' }),
      defineStep({ id: 'b', runner: 'r', timeoutSeconds: 30 }),
    ]);
    const [a, b] = explainPlan(w, noOrigins, flagged).steps;
    expect(a && setting(a, 'timeout_seconds')).toMatchObject({
      value: 120,
      origin: { kind: 'fallback', by: 'flag:--timeout' },
    });
    expect(b && setting(b, 'timeout_seconds')).toMatchObject({ value: 30, origin: { kind: 'file' } });
  });

  it('puts every setting in the fixed order', () => {
    const step = one(
      defineStep({
        id: 'a',
        runner: 'claude-code',
        fallbackRunners: ['codex'],
        permissions: edit,
        isolation: 'git_worktree',
        timeoutSeconds: 60,
        stall: { afterSeconds: 120, retries: 1 },
        onFailure: { action: 'retry_step', target: 'a', maxRetries: 2 },
        mcp: ['srv'],
        mcpPolicy: 'optional',
      }),
    );
    const keys = step.settings.map((s) => s.key);
    expect(keys).toEqual(SETTING_ORDER.filter((k) => keys.includes(k)));
    expect(keys).toEqual([
      'runner',
      'permissions.level',
      'permissions.fs.write',
      'permissions.terminal',
      'isolation',
      'timeout_seconds',
      'stall',
      'on_failure',
      'guards',
      'mcp_policy',
    ]);
    expect(setting(step, 'runner')?.value).toEqual(['claude-code', 'codex']);
    expect(setting(step, 'stall')?.value).toEqual({ afterSeconds: 120, retries: 1 });
    expect(setting(step, 'on_failure')?.value).toEqual({ action: 'retry_step', target: 'a', maxRetries: 2 });
  });

  it('takes the runner from the role when the step has none, and the role is the origin', () => {
    const w = workflow([defineStep({ id: 'a', role: 'writer' })], {
      roles: { writer: role('writer', { runner: 'codex' }) },
    });
    const map: OriginMap = new Map([['$.roles.writer.runner', { line: 3, column: 5 }]]);
    const [step] = explainPlan(w, map, facts).steps;
    expect(step && setting(step, 'runner')).toEqual({
      key: 'runner',
      value: ['codex'],
      origin: { kind: 'role', ref: 'writer', line: 3, column: 5 },
    });
  });

  it('puts a line on a file origin only when the map has one', () => {
    const w = workflow([defineStep({ id: 'a', runner: 'r', isolation: 'git_worktree' })]);
    const map: OriginMap = new Map([['$.steps[0].isolation', { line: 6, column: 5 }]]);
    const [withLine] = explainPlan(w, map, facts).steps;
    const [without] = explainPlan(w, noOrigins, facts).steps;
    expect(withLine && setting(withLine, 'isolation')?.origin).toEqual({ kind: 'file', line: 6, column: 5 });
    expect(without && setting(without, 'isolation')?.origin).toEqual({ kind: 'file' });
  });

  it('tells a written isolation: none from an absent one by the source', () => {
    const map: OriginMap = new Map([['$.steps[0].isolation', { line: 4, column: 5 }]]);
    const written = one(defineStep({ id: 'a', runner: 'r' }), {}, map);
    expect(setting(written, 'isolation')?.origin).toEqual({ kind: 'file', line: 4, column: 5 });
  });

  it('gives permissions the origin of the layer whose block is in force, whole', () => {
    const roleBlock: StepPermissions = { level: 'read', fsRead: [], fsWrite: [], terminal: 'deny' };
    const defaultsBlock: StepPermissions = {
      level: 'edit',
      fsRead: [],
      fsWrite: ['docs/**'],
      terminal: 'deny',
    };
    const own: StepPermissions = { level: 'edit', fsRead: [], fsWrite: ['src/**'], terminal: 'allow' };
    const w = workflow(
      [
        defineStep({ id: 'own', runner: 'r', permissions: own }),
        defineStep({ id: 'viaRole', role: 'reader', permissions: roleBlock }),
        defineStep({ id: 'viaDefaults', runner: 'r', permissions: defaultsBlock }),
      ],
      { roles: { reader: role('reader', { permissions: roleBlock }) }, defaultPermissions: defaultsBlock },
    );
    const map: OriginMap = new Map([
      ['$.steps[0].permissions', { line: 10, column: 7 }],
      ['$.roles.reader.permissions', { line: 3, column: 5 }],
      ['$.defaults.permissions', { line: 20, column: 3 }],
    ]);
    const steps = explainPlan(w, map, facts).steps;
    const origins = steps.map((s) => setting(s, 'permissions.level')?.origin);
    expect(origins).toEqual([
      { kind: 'file', line: 10, column: 7 },
      { kind: 'role', ref: 'reader', line: 3, column: 5 },
      { kind: 'workflow_defaults', line: 20, column: 3 },
    ]);
    // never merged: the value is that of the one block
    expect(setting(steps[2] as ExplainedStep, 'permissions.fs.write')?.value).toEqual(['docs/**']);
  });

  it('shows the guard a write scope adds with the origin of the permissions block, and a declared one with the file', () => {
    const implied = one(defineStep({ id: 'a', runner: 'r', permissions: edit }));
    expect(setting(implied, 'guards')).toEqual({
      key: 'guards',
      value: [{ type: GuardType.DiffWithinScope, paths: ['src/**'], source: 'implied' }],
      origin: { kind: 'file' },
    });
    const declared = one(
      defineStep({ id: 'a', runner: 'r', guards: [{ type: GuardType.GitDiffEmpty, paths: [] }] }),
    );
    expect(setting(declared, 'guards')?.value).toEqual([
      { type: 'git_diff_empty', paths: [], source: 'declared' },
    ]);
    const roleOnly = one(defineStep({ id: 'a', role: 'w', permissions: edit }), {
      roles: { w: role('w', { permissions: edit }) },
    });
    expect(setting(roleOnly, 'guards')?.origin).toMatchObject({ kind: 'role', ref: 'w' });
  });

  it('leaves out what does not apply: a shell step has no permissions, stall or mcp policy', () => {
    const shell = one(
      defineStep({
        id: 's',
        runner: 'shell',
        commands: ['true'],
        permissions: edit,
        stall: { afterSeconds: 90, retries: 0 },
        mcp: ['x'],
      }),
    );
    expect(shell.kind).toBe('shell');
    expect(shell.settings.map((s) => s.key)).toEqual(['runner', 'isolation', 'timeout_seconds', 'guards']);
    const viaRole = one(defineStep({ id: 's', role: 'sh' }), {
      roles: { sh: role('sh', { runner: 'shell' }) },
    });
    expect(viaRole.kind).toBe('shell');
  });

  it('explains a debate: decision type, arbiter and the rounds of the default arbiter, read from the constant', () => {
    const debate = one(
      defineStep({
        id: 'd',
        runner: 'claude-code',
        consensusWith: ['x'],
        decisionType: 'majority',
        arbiter: 'human',
      }),
    );
    expect(debate.kind).toBe('debate');
    expect(setting(debate, 'decision_type')).toEqual({
      key: 'decision_type',
      value: 'majority',
      origin: { kind: 'file' },
    });
    expect(setting(debate, 'arbiter')?.value).toBe('human');
    expect(setting(debate, 'rounds')).toEqual({
      key: 'rounds',
      value: DEFAULT_MAX_ROUNDS,
      origin: { kind: 'fallback', by: 'engine' },
    });
    expect(debate.gaps.map((g) => g.code)).toEqual(['failure_stops_run']);
  });

  it('says unknown, with the reason, for the rounds of an arbiter that declares no bound, and falls back to consensus', () => {
    const w = workflow([defineStep({ id: 'd', runner: 'r', consensusWith: ['x'] })]);
    const [debate] = explainPlan(w, noOrigins, {
      timeoutSeconds: facts.timeoutSeconds,
      runnerDefault: () => undefined,
    }).steps;
    expect(debate && setting(debate, 'rounds')?.value).toMatchObject({
      unknown: expect.stringContaining('no bound'),
    });
    expect(debate && setting(debate, 'decision_type')).toMatchObject({
      value: 'consensus',
      origin: { kind: 'fallback', by: 'engine' },
    });
  });

  it('gives the mcp policy of the workflow defaults, or the engine, when the step writes none', () => {
    const step = defineStep({ id: 'a', runner: 'r', mcp: ['s'] });
    expect(setting(one(step), 'mcp_policy')).toEqual({
      key: 'mcp_policy',
      value: 'required',
      origin: { kind: 'fallback', by: 'engine' },
    });
    expect(setting(one(step, { defaultMcpPolicy: 'optional' }), 'mcp_policy')?.origin.kind).toBe(
      'workflow_defaults',
    );
    const map: OriginMap = new Map([['$.defaults.mcp_policy', { line: 2, column: 3 }]]);
    expect(setting(one(step, {}, map), 'mcp_policy')?.origin).toEqual({
      kind: 'workflow_defaults',
      line: 2,
      column: 3,
    });
  });

  it('uses the order of plan: dependencies first, with the declaration index kept for origins', () => {
    const w = workflow([
      defineStep({ id: 'second', runner: 'r', dependsOn: ['first'], isolation: 'git_worktree' }),
      defineStep({ id: 'first', runner: 'r' }),
    ]);
    const map: OriginMap = new Map([['$.steps[0].isolation', { line: 9, column: 5 }]]);
    const steps = explainPlan(w, map, facts).steps;
    expect(steps.map((s) => s.id)).toEqual(['first', 'second']);
    expect(setting(steps[1] as ExplainedStep, 'isolation')?.origin).toMatchObject({ line: 9 });
    expect(setting(steps[0] as ExplainedStep, 'isolation')?.origin).toEqual({
      kind: 'fallback',
      by: 'engine',
    });
  });
});

describe('explainPlan: gaps', () => {
  const codes = (step: ExplainedStep): string[] => step.gaps.map((g) => g.code);

  it('reports the four gaps of a bare agent step, in a fixed order, with the runner default in words', () => {
    const step = one(defineStep({ id: 'a', runner: 'claude-code' }));
    expect(codes(step)).toEqual([
      'no_permission_level',
      'no_write_scope',
      'no_check_on_result',
      'failure_stops_run',
    ]);
    expect(step.gaps[0]?.text).toContain(
      'built-in default of the claude-code runner applies (edits are accepted without asking)',
    );
  });

  it('says it cannot describe a runner that declares nothing, and does not guess', () => {
    const step = one(defineStep({ id: 'a', runner: 'plugin-runner' }));
    expect(step.gaps[0]?.text).toContain('Indaba cannot describe what it allows');
  });

  it('has no gap for a step that writes a level, a scope, a check and an on_failure', () => {
    const step = one(
      defineStep({
        id: 'a',
        runner: 'claude-code',
        permissions: edit,
        isolation: 'git_worktree',
        onFailure: { action: 'fail', maxRetries: 0 },
      }),
    );
    expect(step.gaps).toEqual([]);
  });

  it('counts a declared guard as a check and as a limit on what changed', () => {
    const step = one(
      defineStep({
        id: 'a',
        runner: 'claude-code',
        guards: [{ type: GuardType.GitDiffEmpty, paths: [] }],
        onFailure: { action: 'fail', maxRetries: 0 },
      }),
    );
    expect(codes(step)).toEqual(['no_permission_level']);
  });

  it('reports no_write_scope only for a step that works in the project folder', () => {
    const inFolder = one(
      defineStep({ id: 'a', runner: 'r', permissions: { fsRead: [], fsWrite: [], terminal: 'deny' } }),
    );
    // a block with no level still implies a scope guard, so nothing is missing
    expect(codes(inFolder)).not.toContain('no_write_scope');
    const isolated = one(defineStep({ id: 'a', runner: 'r', isolation: 'git_worktree' }));
    expect(codes(isolated)).not.toContain('no_write_scope');
    expect(codes(one(defineStep({ id: 'a', runner: 'r' })))).toContain('no_write_scope');
  });

  it('lists the shell steps that depend on a step with no check, and no others', () => {
    const w = workflow([
      defineStep({ id: 'build', runner: 'claude-code' }),
      defineStep({ id: 'review', runner: 'claude-code', dependsOn: ['build'] }),
      defineStep({ id: 'test', runner: 'shell', commands: ['pnpm test'], dependsOn: ['review'] }),
      defineStep({ id: 'other', runner: 'shell', commands: ['true'] }),
    ]);
    const steps = explainPlan(w, noOrigins, facts).steps;
    const build = steps.find((s) => s.id === 'build');
    const gap = build?.gaps.find((g) => g.code === 'no_check_on_result');
    expect(gap?.mitigatedBy).toEqual(['test']);
    expect(steps.find((s) => s.id === 'other')?.gaps.map((g) => g.code)).toEqual(['failure_stops_run']);
  });

  it('names full access with the same sentence the permission report uses', () => {
    const step = one(
      defineStep({ id: 'a', runner: 'claude-code', fallbackRunners: ['codex'], permissions: full }),
    );
    const gap = step.gaps.find((g) => g.code === 'full_access');
    expect(gap?.text).toBe(
      "FULL ACCESS: this step's agent can change anything and run anything and nobody approves it (runners: claude-code, codex)",
    );
    expect(codes(step)).not.toContain('no_permission_level');
  });

  it('reports failure_stops_run for any kind of step without on_failure', () => {
    expect(codes(one(defineStep({ id: 's', runner: 'shell', commands: ['true'] })))).toEqual([
      'failure_stops_run',
    ]);
    expect(
      codes(
        one(
          defineStep({
            id: 's',
            runner: 'shell',
            commands: ['true'],
            onFailure: { action: 'fail', maxRetries: 0 },
          }),
        ),
      ),
    ).toEqual([]);
  });
});

describe('explainPlan: what it never contains', () => {
  it('leaves out goals, commands and input values, and is the same value when run twice', () => {
    const secretLooking = `key-${'sk'}-${'live'}-123`;
    const w = workflow([
      defineStep({
        id: 'a',
        runner: 'claude-code',
        goal: `use ${secretLooking} on \${{ inputs.token }}`,
        commands: [secretLooking],
      }),
      defineStep({ id: 'b', runner: 'shell', commands: [secretLooking], dependsOn: ['a'] }),
    ]);
    const first = explainPlan(w, noOrigins, facts);
    expect(JSON.stringify(first)).not.toContain(secretLooking);
    expect(JSON.stringify(first)).not.toContain('inputs.token');
    expect(JSON.stringify(explainPlan(w, noOrigins, facts))).toBe(JSON.stringify(first));
  });
});

describe('shared resolvers (AC-04)', () => {
  it('stepTimeoutSeconds is the step limit, else the run limit', () => {
    expect(stepTimeoutSeconds(defineStep({ id: 'a', timeoutSeconds: 5 }), 900)).toBe(5);
    expect(stepTimeoutSeconds(defineStep({ id: 'a' }), 120)).toBe(120);
  });

  it('effectiveGuards adds the scope guard of a block and not at full', () => {
    expect(effectiveGuards(defineStep({ id: 'a', permissions: edit }))).toEqual([
      { type: GuardType.DiffWithinScope, paths: ['src/**'] },
    ]);
    expect(effectiveGuards(defineStep({ id: 'a', permissions: full }))).toEqual([]);
    expect(effectiveGuards(defineStep({ id: 'a' }))).toEqual([]);
  });
});
