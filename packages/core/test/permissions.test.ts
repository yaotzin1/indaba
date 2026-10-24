import { describe, expect, it } from 'vitest';
import {
  applyBound,
  describeEnforcement,
  EnforcementMode,
  EnforcementScope,
  effectiveLevel,
  isPermissionCapable,
  lowerLevel,
  NOT_OFFERED_NOTE,
  type PermissionCapability,
  PermissionLevel,
  permissionCapabilitiesOf,
  permissionMapOf,
  type Runner,
  RunResult,
  resolvePermissions,
  type StepPermissions,
  unsupportedBy,
} from '../src/index.js';

const edit: StepPermissions = { level: 'edit', fsRead: [], fsWrite: ['src/**'], terminal: 'deny' };
const noLevelWithWrite: StepPermissions = { fsRead: [], fsWrite: ['src/**'], terminal: 'allow' };
const full: StepPermissions = { level: 'full', fsRead: [], fsWrite: [], terminal: 'deny' };

function runner(extra: object = {}): Runner {
  return {
    name: 'r',
    description: 'r',
    run: () => Promise.resolve(new RunResult({ exitCode: 0, output: '' })),
    ...extra,
  } as unknown as Runner;
}

describe('resolvePermissions', () => {
  it('takes the step, else the role, else the defaults, whole and never merged', () => {
    const role: StepPermissions = { level: 'read', fsRead: [], fsWrite: [], terminal: 'deny' };
    expect(resolvePermissions({ step: edit, role, defaults: full })).toBe(edit);
    expect(resolvePermissions({ role, defaults: full })).toBe(role);
    expect(resolvePermissions({ defaults: full })).toBe(full);
    expect(resolvePermissions({})).toBeUndefined();
  });
});

describe('effectiveLevel', () => {
  it('reports a written level', () => {
    expect(effectiveLevel(edit)).toEqual({ kind: 'written', level: 'edit' });
  });

  it('keeps a block with no level as the runner default and only describes it', () => {
    expect(effectiveLevel(noLevelWithWrite)).toEqual({ kind: 'default', impliedLevel: 'edit' });
    expect(effectiveLevel({ fsRead: [], fsWrite: [], terminal: 'deny' })).toEqual({
      kind: 'default',
      impliedLevel: 'read',
    });
    expect(effectiveLevel(undefined)).toEqual({ kind: 'default', impliedLevel: 'read' });
  });
});

describe('lowerLevel and applyBound', () => {
  it('orders read < edit < full', () => {
    expect(lowerLevel('full', 'read')).toBe('read');
    expect(lowerLevel('edit', 'full')).toBe('edit');
    expect(lowerLevel('read', 'read')).toBe('read');
  });

  it('never raises a written level', () => {
    const result = applyBound(edit, PermissionLevel.Full);
    expect(result.changed).toBe(false);
    expect(result.permissions).toBe(edit);
    expect(result.level).toBe('edit');
  });

  it('lowers edit to read and drops fs.write so the implied guard allows no change', () => {
    const result = applyBound(edit, PermissionLevel.Read);
    expect(result.changed).toBe(true);
    expect(result.level).toBe('read');
    expect(result.permissions).toEqual({ level: 'read', fsRead: [], fsWrite: [], terminal: 'deny' });
  });

  it('lowers full to read, because full names no folders for edit', () => {
    expect(applyBound(full, PermissionLevel.Edit).level).toBe('read');
    expect(applyBound(full, PermissionLevel.Read).level).toBe('read');
  });

  it('gives a step with no level the read arguments only for a bound of read', () => {
    const read = applyBound(undefined, PermissionLevel.Read);
    expect(read.changed).toBe(true);
    expect(read.level).toBe('read');
    for (const bound of [PermissionLevel.Edit, PermissionLevel.Full]) {
      const result = applyBound(noLevelWithWrite, bound);
      expect(result.changed).toBe(false);
      expect(result.level).toBeUndefined();
      expect(result.permissions).toBe(noLevelWithWrite);
    }
  });
});

describe('PermissionCapable', () => {
  const capability: PermissionCapability = {
    level: 'read',
    mode: EnforcementMode.Native,
    scope: EnforcementScope.Guard,
    note: 'n',
  };

  it('treats a runner without the contract as supporting no level and never throws', () => {
    expect(isPermissionCapable(runner())).toBe(false);
    expect(permissionCapabilitiesOf(runner())).toEqual([]);
    const throwing = runner({
      permissionCapabilities: () => {
        throw new Error('boom');
      },
      permissionDenied: () => false,
    });
    expect(permissionCapabilitiesOf(throwing)).toEqual([]);
  });

  it('drops malformed entries a plugin declares', () => {
    const odd = runner({
      permissionCapabilities: () => [
        capability,
        { level: 'nope', mode: 'native', scope: 'guard', note: 'x' },
        7,
      ],
      permissionDenied: () => false,
      canRecogniseDenial: false,
    });
    expect(isPermissionCapable(odd)).toBe(true);
    expect(permissionCapabilitiesOf(odd)).toEqual([capability]);
    const notAList = runner({ permissionCapabilities: () => 'x', permissionDenied: () => false });
    expect(permissionCapabilitiesOf(notAList)).toEqual([]);
  });
});

describe('unsupportedBy and describeEnforcement', () => {
  const ok: PermissionCapability = { level: 'edit', mode: 'native', scope: 'guard', note: 'a' };
  const no: PermissionCapability = { level: 'read', mode: 'unsupported', scope: 'none', note: 'b' };

  it('names every runner of the chain that cannot honour the level', () => {
    const chain = [
      { name: 'a', capabilities: [ok] },
      { name: 'b', capabilities: [no] },
      { name: 'c', capabilities: [] },
    ];
    expect(unsupportedBy('edit', chain).map((x) => x.runner)).toEqual(['b', 'c']);
    expect(unsupportedBy('read', chain).map((x) => x.runner)).toEqual(['a', 'b', 'c']);
    expect(unsupportedBy('read', [])).toEqual([]);
  });

  it('flags a check that happens only after the step, with no English', () => {
    expect(describeEnforcement('a', ok).checkedOnlyAfter).toBe(true);
    const native = describeEnforcement('a', { ...ok, scope: 'acp' });
    expect(native).toEqual({
      runner: 'a',
      level: 'edit',
      mode: 'native',
      scope: 'acp',
      note: 'a',
      checkedOnlyAfter: false,
    });
    expect(describeEnforcement('a', { ...ok, mode: 'after', scope: 'acp' }).checkedOnlyAfter).toBe(true);
  });
});

describe('permissionMapOf (the catalog map, AC-16)', () => {
  it('lists all three levels, and a level the runner does not declare is unsupported', () => {
    const read: PermissionCapability = {
      level: 'read',
      mode: 'native',
      scope: 'guard',
      note: 'cli_confines_workspace_only',
    };
    const map = permissionMapOf(
      runner({
        permissionCapabilities: () => [read],
        permissionDenied: () => false,
        canRecogniseDenial: false,
      }),
    );
    expect(map.read).toEqual({ mode: 'native', scope: 'guard', note: 'cli_confines_workspace_only' });
    expect(map.edit).toEqual({ mode: 'unsupported', scope: 'none', note: NOT_OFFERED_NOTE });
    expect(map.full).toEqual({ mode: 'unsupported', scope: 'none', note: NOT_OFFERED_NOTE });
  });

  it('gives a runner without the contract no level, and never throws', () => {
    const map = permissionMapOf(runner());
    expect(Object.values(map).every((entry) => entry.mode === 'unsupported')).toBe(true);
    const broken = runner({
      permissionCapabilities: () => {
        throw new Error('boom');
      },
      permissionDenied: () => false,
    });
    expect(permissionMapOf(broken).read.mode).toBe('unsupported');
  });
});
