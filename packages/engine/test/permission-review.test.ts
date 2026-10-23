import {
  EnforcementMode,
  EnforcementScope,
  type PermissionCapability,
  type PermissionCapable,
  PermissionLevel,
  RunResult,
  WorkflowValidationError,
} from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { applyRunBounds, parseWorkflow, WorkflowValidator } from '../src/index.js';
import { FakeRunner, harness, makeGitRepo } from './support.js';

const rows = (modes: Partial<Record<PermissionLevel, EnforcementMode>>): PermissionCapability[] =>
  (['read', 'edit', 'full'] as const).map((level) => ({
    level,
    mode: modes[level] ?? EnforcementMode.Unsupported,
    scope: level === 'full' ? EnforcementScope.None : EnforcementScope.Guard,
    note: 'n',
  }));

class Capable extends FakeRunner implements PermissionCapable {
  readonly canRecogniseDenial = true;

  constructor(
    name: string,
    private readonly table: PermissionCapability[],
    handler: ConstructorParameters<typeof FakeRunner>[1] = () => new RunResult({ exitCode: 0, output: 'ok' }),
    private readonly refusal = '',
  ) {
    super(name, handler);
  }

  permissionCapabilities(): readonly PermissionCapability[] {
    return this.table;
  }

  permissionDenied(output: string): boolean {
    return this.refusal !== '' && output.includes(this.refusal);
  }
}

const everything = rows({ read: 'native', edit: 'native', full: 'native' });

const workflowWith = (permissions: string): string => `version: "1.0"
name: r
roles:
  w: {runner: cap}
steps:
  - id: s
    role: w
    goal: g
${permissions}`;

describe('the engine enforces AC-05 and AC-07 itself, whoever calls it', () => {
  it('refuses to start a step at full that nobody acknowledged', async () => {
    const runner = new Capable('cap', everything);
    const h = harness(await makeGitRepo(), [runner]);
    await expect(
      h.engine.run(parseWorkflow(workflowWith('    permissions:\n      level: full\n'))),
    ).rejects.toThrow('need an acknowledgement');
    expect(runner.requests).toEqual([]);
  });

  it('refuses a level the runner of the chain cannot hold, and never starts it', async () => {
    const runner = new Capable('cap', rows({ edit: 'after' }));
    const h = harness(await makeGitRepo(), [runner]);
    await expect(
      h.engine.run(parseWorkflow(workflowWith('    permissions:\n      level: read\n'))),
    ).rejects.toThrow('level "read" on cap');
    expect(runner.requests).toEqual([]);
  });

  it('runs a step with no level exactly as before, with no acknowledgement', async () => {
    const runner = new Capable('cap', everything);
    const result = await harness(await makeGitRepo(), [runner]).engine.run(parseWorkflow(workflowWith('')));
    expect(result.status).toBe('COMPLETED');
    expect(runner.requests[0]?.permissionLevel).toBeUndefined();
  });
});

describe('AC-11 does not apply at full', () => {
  it('does not fail a step at full that quotes a refusal and produced no output', async () => {
    const runner = new Capable(
      'cap',
      everything,
      () => new RunResult({ exitCode: 0, output: 'REFUSED' }),
      'REFUSED',
    );
    const result = await harness(await makeGitRepo(), [runner]).engine.run(
      parseWorkflow(workflowWith('    permissions:\n      level: full\n    outputs: [a.txt]\n')),
      { fullAccessAcknowledged: 'run_option' },
    );
    // the declared output is missing, so the step fails, but for that reason and not as a refused permission
    expect(result.failureReason).toContain('Expected output');
    expect(result.failureReason).not.toContain('refused a permission');
  });
});

describe('run bounds: every bound applies and the lowest wins (AC-12)', () => {
  const wf = parseWorkflow(`version: "1.0"
name: b
roles:
  w: {runner: cap}
steps:
  - id: s
    role: w
    goal: g
    permissions:
      level: edit
      fs:
        write: ["a/**"]
  - id: t
    role: w
    goal: g
`);
  const lookup = {
    has: (name: string) => name === 'cap',
    get: () => new Capable('cap', everything),
  };

  it('a step bound and a global bound never raise each other', () => {
    const lowered = applyRunBounds(
      wf,
      [{ step: 's', level: PermissionLevel.Edit }, { level: PermissionLevel.Read }],
      lookup,
    );
    expect(lowered.workflow.steps[0]?.permissions?.level).toBe('read');
    const kept = applyRunBounds(
      wf,
      [{ step: 's', level: PermissionLevel.Read }, { level: PermissionLevel.Full }],
      lookup,
    );
    expect(kept.workflow.steps[0]?.permissions?.level).toBe('read');
  });

  it('says a bound changed nothing once, and only for a step it could not affect', () => {
    const result = applyRunBounds(
      wf,
      [{ step: 't', level: PermissionLevel.Edit }, { level: PermissionLevel.Edit }],
      lookup,
    );
    expect(result.findings.filter((f) => f.stepId === 't')).toEqual([
      { severity: 'note', code: 'bound_no_effect', stepId: 't' },
    ]);
    const read = applyRunBounds(
      wf,
      [{ step: 't', level: PermissionLevel.Edit }, { level: PermissionLevel.Read }],
      lookup,
    );
    expect(read.findings.filter((f) => f.stepId === 't')).toEqual([]);
  });

  it('lowers full to read when asked for edit, because full names no folders for edit', () => {
    const full = parseWorkflow(workflowWith('    permissions:\n      level: full\n'));
    const result = applyRunBounds(full, [{ level: PermissionLevel.Edit }], lookup);
    expect(result.workflow.steps[0]?.permissions?.level).toBe('read');
  });
});

describe('a shell role (AC-03)', () => {
  const body = (extra: string): string => `version: "1.0"
name: sh
roles:
  runner_role:
    runner: shell
${extra}steps:
  - id: s
    role: runner_role
    commands: ["echo hi"]
`;

  it('rejects a level written on the step whose role runs shell', () => {
    const text = body('').replace(
      '    commands: ["echo hi"]',
      '    commands: ["echo hi"]\n    permissions:\n      level: read',
    );
    expect(() => parseWorkflow(text)).toThrow(WorkflowValidationError);
    expect(() => parseWorkflow(text)).toThrow('runs shell commands');
  });

  it('rejects a level written on a shell role', () => {
    expect(() => parseWorkflow(body('    permissions:\n      level: read\n'))).toThrow('shell role');
  });
});

describe('the validator at full', () => {
  it('does not advise isolation or an acp runner for a step at full, which has no scope guard', () => {
    const wf = parseWorkflow(workflowWith('    permissions:\n      level: full\n'));
    expect(new WorkflowValidator().warnings(wf)).toEqual([]);
    const edit = parseWorkflow(
      workflowWith('    permissions:\n      level: edit\n      fs:\n        write: ["a/**"]\n'),
    );
    expect(new WorkflowValidator().warnings(edit).length).toBeGreaterThan(0);
  });
});
