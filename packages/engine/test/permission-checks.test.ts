import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  EnforcementMode,
  EnforcementScope,
  type PermissionCapability,
  type PermissionCapable,
  PermissionLevel,
  type Runner,
  RunResult,
  SpanEnded,
  stepOf,
} from '@indaba/core';
import { describe, expect, it } from 'vitest';
import {
  applyRunBounds,
  checkPermissions,
  effectiveGuards,
  fullAccessSteps,
  parseRunBound,
  parseWorkflow,
  WorkflowStatus,
} from '../src/index.js';
import { FakeRunner, harness, makeGitRepo } from './support.js';

const table = (modes: Partial<Record<PermissionLevel, EnforcementMode>>): PermissionCapability[] =>
  (['read', 'edit', 'full'] as const).map((level) => ({
    level,
    mode: modes[level] ?? EnforcementMode.Unsupported,
    scope: level === 'full' ? EnforcementScope.None : EnforcementScope.Guard,
    note: `${level}-note`,
  }));

class CapableRunner extends FakeRunner implements PermissionCapable {
  constructor(
    name: string,
    private readonly rows: PermissionCapability[],
    handler: ConstructorParameters<typeof FakeRunner>[1] = () => new RunResult({ exitCode: 0, output: 'ok' }),
    private readonly denial: (output: string) => boolean = () => false,
    readonly canRecogniseDenial = true,
  ) {
    super(name, handler);
  }

  permissionCapabilities(): readonly PermissionCapability[] {
    return this.rows;
  }

  permissionDenied(output: string): boolean {
    return this.denial(output);
  }
}

function lookup(...runners: Runner[]) {
  const map = new Map(runners.map((r) => [r.name, r]));
  return {
    has: (name: string) => map.has(name),
    get: (name: string) => {
      const runner = map.get(name);
      if (runner === undefined) {
        throw new Error(`no ${name}`);
      }
      return runner;
    },
  };
}

const all = table({ read: 'native', edit: 'native', full: 'native' });
const editOnly = table({ edit: 'after' });

function workflowOf(permissions: string, extra = ''): string {
  return `version: "1.0"
name: p
roles:
  w:
    runner: ${extra === '' ? 'cap' : extra}
steps:
  - id: s
    role: w
    goal: g
${permissions}`;
}

describe('checkPermissions (specs/agent-permissions AC-07, AC-08, AC-18)', () => {
  it('names the runner, the level and the note when a runner of the chain cannot honour a written level', () => {
    const wf = parseWorkflow(workflowOf('    permissions:\n      level: read\n', '[cap, weak]'));
    const findings = checkPermissions(
      wf,
      lookup(new CapableRunner('cap', all), new CapableRunner('weak', editOnly)),
    );
    expect(findings).toContainEqual({
      severity: 'error',
      code: 'unsupported',
      stepId: 's',
      runner: 'weak',
      level: 'read',
      note: 'read-note',
    });
    expect(findings.filter((f) => f.severity === 'error')).toHaveLength(1);
  });

  it('states the runner default for a step that writes no level, and nothing else', () => {
    const wf = parseWorkflow(workflowOf(''));
    expect(checkPermissions(wf, lookup(new CapableRunner('cap', all)))).toEqual([
      { severity: 'fact', code: 'default', stepId: 's', runner: 'cap' },
    ]);
  });

  it('lists a full step and the runners of its chain', () => {
    const wf = parseWorkflow(workflowOf('    permissions:\n      level: full\n'));
    const runners = lookup(new CapableRunner('cap', all));
    expect(fullAccessSteps(wf, runners)).toEqual([{ stepId: 's', runners: ['cap'] }]);
    expect(checkPermissions(wf, runners)).toContainEqual({
      severity: 'fact',
      code: 'full',
      stepId: 's',
      runners: ['cap'],
    });
  });

  it('describes how an after-only level is enforced and that a refusal cannot be recognised', () => {
    const wf = parseWorkflow(
      workflowOf('    permissions:\n      level: edit\n      fs:\n        write: ["a/**"]\n'),
    );
    const findings = checkPermissions(
      wf,
      lookup(new CapableRunner('cap', editOnly, undefined, undefined, false)),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'enforcement',
        description: expect.objectContaining({ mode: 'after', checkedOnlyAfter: true, note: 'edit-note' }),
      }),
    );
    expect(findings).toContainEqual({
      severity: 'note',
      code: 'denial_unrecognised',
      stepId: 's',
      runner: 'cap',
    });
  });

  it('refuses a read-only step that is given an MCP server, and notes it at edit', () => {
    const base = (level: string) =>
      `version: "1.0"
name: p
mcp_servers:
  fs: {command: server}
roles:
  w: {runner: cap}
steps:
  - id: s
    role: w
    goal: g
    mcp: [fs]
    permissions:
      level: ${level}
${level === 'edit' ? '      fs:\n        write: ["a/**"]\n' : ''}`;
    const runners = lookup(new CapableRunner('cap', all));
    expect(checkPermissions(parseWorkflow(base('read')), runners)).toContainEqual({
      severity: 'error',
      code: 'read_with_mcp',
      stepId: 's',
    });
    expect(checkPermissions(parseWorkflow(base('edit')), runners)).toContainEqual({
      severity: 'note',
      code: 'edit_with_mcp',
      stepId: 's',
    });
  });

  it('skips shell and debate steps, and a runner that is not registered', () => {
    const wf = parseWorkflow(`version: "1.0"
name: p
roles:
  a: {runner: cap}
  b: {runner: cap}
steps:
  - id: sh
    runner: shell
    commands: ["echo"]
  - id: d
    role: a
    consensus_with: [b]
    decision_type: consensus
    goal: g
`);
    expect(checkPermissions(wf, lookup())).toEqual([]);
  });
});

describe('--permissions bounds (AC-12)', () => {
  const wf = parseWorkflow(`version: "1.0"
name: p
roles:
  w: {runner: cap}
steps:
  - id: writer
    role: w
    goal: g
    permissions:
      level: edit
      fs:
        write: ["src/**"]
  - id: plain
    role: w
    goal: g
  - id: sh
    runner: shell
    commands: ["echo"]
`);
  const runners = lookup(new CapableRunner('cap', all));

  it('parses a bound with and without a step, and refuses the rest', () => {
    expect(parseRunBound('read')).toEqual({ level: 'read' });
    expect(parseRunBound('writer=edit')).toEqual({ step: 'writer', level: 'edit' });
    expect(parseRunBound('ask')).toHaveProperty('error');
    expect(parseRunBound('=read')).toHaveProperty('error');
    expect(parseRunBound('x=nope')).toHaveProperty('error');
  });

  it('lowers a written level to read and makes the implied guard allow no change', () => {
    const result = applyRunBounds(wf, [{ level: PermissionLevel.Read }], runners);
    expect(result.errors).toEqual([]);
    const writer = result.workflow.steps.find((s) => s.id === 'writer');
    expect(writer?.permissions).toEqual({ level: 'read', fsRead: [], fsWrite: [], terminal: 'deny' });
    expect(effectiveGuards(writer ?? stepOf(wf, 'writer'))).toEqual([
      { type: 'diff_within_scope', paths: [] },
    ]);
    // a step with no level gets the read arguments, and the shell step is untouched
    expect(result.workflow.steps.find((s) => s.id === 'plain')?.permissions?.level).toBe('read');
    expect(result.workflow.steps.find((s) => s.id === 'sh')).toBe(wf.steps[2]);
  });

  it('never raises: a higher bound changes nothing and says so for a step with no level', () => {
    const result = applyRunBounds(wf, [{ level: PermissionLevel.Full }], runners);
    expect(result.workflow.steps[0]).toBe(wf.steps[0]);
    expect(result.workflow.steps[1]).toBe(wf.steps[1]);
    expect(result.findings).toEqual([{ severity: 'note', code: 'bound_no_effect', stepId: 'plain' }]);
  });

  it('is a usage error for a missing step, a shell step, or a level a runner cannot hold', () => {
    expect(applyRunBounds(wf, [{ step: 'nope', level: PermissionLevel.Read }], runners).errors[0]).toContain(
      'no step "nope"',
    );
    expect(applyRunBounds(wf, [{ step: 'sh', level: PermissionLevel.Read }], runners).errors[0]).toContain(
      'not an agent step',
    );
    const weak = lookup(new CapableRunner('cap', editOnly));
    expect(applyRunBounds(wf, [{ level: PermissionLevel.Read }], weak).errors.join('\n')).toContain(
      'cannot hold the level "read"',
    );
  });
});

describe('running steps with a level (AC-04, AC-11, AC-14, AC-15)', () => {
  async function run(source: string, runner: FakeRunner) {
    const repo = await makeGitRepo();
    const h = harness(repo, [runner]);
    const spans: SpanEnded[] = [];
    h.events.addListener(SpanEnded, (e) => {
      spans.push(e);
    });
    const result = await h.engine.run(parseWorkflow(source), { taskId: 'L' });
    return { result, spans };
  }

  const ask = (permissions: string): string =>
    `version: "1.0"\nname: p\nroles:\n  w: {runner: cap}\nsteps:\n  - id: s\n    role: w\n    goal: g\n${permissions}`;

  it('sends the level and the block at edit, only the level at full, and neither with no level', async () => {
    const edit = new CapableRunner('cap', all);
    await run(ask('    permissions:\n      level: edit\n      fs:\n        write: ["src/**"]\n'), edit);
    expect(edit.requests[0]?.permissionLevel).toBe('edit');
    expect(edit.requests[0]?.permissions?.fsWrite).toEqual(['src/**']);

    const full = new CapableRunner('cap', all);
    await run(ask('    permissions:\n      level: full\n'), full);
    expect(full.requests[0]?.permissionLevel).toBe('full');
    expect(full.requests[0]?.permissions).toBeUndefined();

    const none = new CapableRunner('cap', all);
    await run(ask(''), none);
    expect(none.requests[0]?.permissionLevel).toBeUndefined();
    expect(none.requests[0]?.permissions).toBeUndefined();
  });

  it('records the level, mode and scope on the span, or "default"', async () => {
    const { spans } = await run(ask('    permissions:\n      level: read\n'), new CapableRunner('cap', all));
    const attributes = spans.map((s) => s.span.attributes ?? {});
    expect(
      attributes.some(
        (a) =>
          a['indaba.permissions.level'] === 'read' &&
          a['indaba.permissions.mode'] === 'native' &&
          a['indaba.permissions.scope'] === 'guard',
      ),
    ).toBe(true);
    const plain = await run(ask(''), new CapableRunner('cap', all));
    expect(plain.spans.some((s) => s.span.attributes?.['indaba.permissions.level'] === 'default')).toBe(true);
  });

  const refusal = 'REFUSED-MARKER';

  it('fails with a fixed reason when the runner recognises a refusal and a declared output is missing', async () => {
    const runner = new CapableRunner(
      'cap',
      all,
      () => new RunResult({ exitCode: 0, output: `the agent says ${refusal}` }),
      (output) => output.includes(refusal),
    );
    const { result } = await run(
      `${ask('    permissions:\n      level: edit\n      fs:\n        write: ["out/**"]\n    outputs: [out/a.txt]\n')}`,
      runner,
    );
    expect(result.status).toBe(WorkflowStatus.Failed);
    expect(result.failureReason).toContain('was refused a permission it needed');
    expect(result.failureReason).toContain('"edit"');
    expect(result.failureReason).not.toContain(refusal);
  });

  it('passes a reviewer that only quotes the message but produced its output', async () => {
    const runner = new CapableRunner(
      'cap',
      all,
      async (request) => {
        await writeFile(join(request.workdir, 'a.txt'), 'x');
        return new RunResult({ exitCode: 0, output: refusal });
      },
      (output) => output.includes(refusal),
    );
    const { result } = await run(
      ask('    permissions:\n      level: edit\n      fs:\n        write: ["a.txt"]\n    outputs: [a.txt]\n'),
      runner,
    );
    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
  });

  it('with no outputs declared, fails only when the working tree is unchanged', async () => {
    const quiet = new CapableRunner(
      'cap',
      all,
      () => new RunResult({ exitCode: 0, output: refusal }),
      (output) => output.includes(refusal),
    );
    const failed = await run(ask('    permissions:\n      level: read\n'), quiet);
    expect(failed.result.status).toBe(WorkflowStatus.Failed);
    expect(failed.result.failureReason).toContain('refused a permission');

    const worked = new CapableRunner(
      'cap',
      all,
      async (request) => {
        await writeFile(join(request.workdir, 'changed.txt'), 'x');
        return new RunResult({ exitCode: 0, output: refusal });
      },
      (output) => output.includes(refusal),
    );
    const ok = await run(
      ask('    permissions:\n      level: edit\n      fs:\n        write: ["**"]\n'),
      worked,
    );
    expect(ok.result.status, ok.result.failureReason).toBe(WorkflowStatus.Completed);
  });

  it('names the runner default when no level was written', async () => {
    const runner = new CapableRunner(
      'cap',
      all,
      () => new RunResult({ exitCode: 0, output: refusal }),
      (output) => output.includes(refusal),
    );
    const { result } = await run(ask('    outputs: [a.txt]\n'), runner);
    expect(result.failureReason).toContain('built-in default of the cap runner');
  });

  it('does not fail a runner that cannot recognise a refusal', async () => {
    const runner = new CapableRunner(
      'cap',
      all,
      () => new RunResult({ exitCode: 0, output: refusal }),
      () => false,
      false,
    );
    const { result } = await run(ask('    permissions:\n      level: read\n'), runner);
    expect(result.status).toBe(WorkflowStatus.Completed);
  });

  it('adds the implied scope guard alongside a loose declared guard at edit, and none at full', () => {
    const wf = parseWorkflow(
      ask(
        '    permissions:\n      level: edit\n      fs:\n        write: ["src/**"]\n    guards:\n      - type: diff_within_scope\n        paths: ["**"]\n',
      ),
    );
    const guards = effectiveGuards(stepOf(wf, 's'));
    expect(guards.map((g) => g.paths)).toEqual([['**'], ['src/**']]);
    const full = parseWorkflow(ask('    permissions:\n      level: full\n'));
    expect(effectiveGuards(stepOf(full, 's'))).toEqual([]);
  });
});
