import type { Runner } from '../runner/index.js';
import { PermissionLevel, type StepPermissions } from '../workflow/model.js';

/** Ordered by how much the agent may do; `lowerLevel` and the run option use it (specs/agent-permissions, AC-12). */
export const PERMISSION_ORDER: readonly PermissionLevel[] = [
  PermissionLevel.Read,
  PermissionLevel.Edit,
  PermissionLevel.Full,
];

/** What makes a level true while the agent works. */
export const EnforcementMode = {
  /** The agent's own command line refuses. */
  Native: 'native',
  /** Indaba's permission gate answers the agent's requests. */
  Acp: 'acp',
  /** The runner has no mode of its own for the level; only the scope guard checks, after the step. */
  After: 'after',
  /** Nothing limits the agent: the level `full`. */
  None: 'none',
  /** The runner cannot honour the level. */
  Unsupported: 'unsupported',
} as const;
export type EnforcementMode = (typeof EnforcementMode)[keyof typeof EnforcementMode];

/** What holds the `fs.write` globs and `terminal`. */
export const EnforcementScope = {
  /** The gate refuses a request outside them as it is asked (over ACP only; the guard also holds). */
  Acp: 'acp',
  /** A check of the working tree after the step. */
  Guard: 'guard',
  /** At `full`. */
  None: 'none',
} as const;
export type EnforcementScope = (typeof EnforcementScope)[keyof typeof EnforcementScope];

export interface PermissionCapability {
  readonly level: PermissionLevel;
  readonly mode: EnforcementMode;
  readonly scope: EnforcementScope;
  /** A fixed id a front end turns into words (C-10), for example `commands_not_limited`. */
  readonly note: string;
}

/** The characters at each end of an agent's output that `permissionDenied` may read (C-07: a design choice, not measured). */
export const MAX_DENIAL_WINDOW = 4096;

/** Implemented by runners that can say what each level means for them. Same pattern as `McpCapable`. */
export interface PermissionCapable {
  /** One entry per level; a level that is absent is `unsupported`. */
  permissionCapabilities(): readonly PermissionCapability[];
  /**
   * Whether the agent's final output says it was refused a permission it needed (AC-11). Pure and bounded: it
   * reads the first and the last `MAX_DENIAL_WINDOW` characters and returns a boolean, never the text.
   */
  permissionDenied(output: string): boolean;
  /** False when the runner cannot tell a refusal from success. */
  readonly canRecogniseDenial: boolean;
}

export function isPermissionCapable(runner: Runner): runner is Runner & PermissionCapable {
  return (
    'permissionCapabilities' in runner &&
    typeof runner.permissionCapabilities === 'function' &&
    'permissionDenied' in runner &&
    typeof runner.permissionDenied === 'function'
  );
}

/** A runner that does not implement `PermissionCapable` supports no level (C-04). Never throws. */
export function permissionCapabilitiesOf(runner: Runner): readonly PermissionCapability[] {
  if (!isPermissionCapable(runner)) {
    return [];
  }
  try {
    const declared: unknown = runner.permissionCapabilities();
    return Array.isArray(declared) ? declared.filter(isCapability) : [];
  } catch {
    return [];
  }
}

function isCapability(value: unknown): value is PermissionCapability {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    PERMISSION_ORDER.includes(v.level as PermissionLevel) &&
    Object.values(EnforcementMode).includes(v.mode as EnforcementMode) &&
    Object.values(EnforcementScope).includes(v.scope as EnforcementScope) &&
    typeof v.note === 'string'
  );
}

/**
 * AC-01: the effective block is the step's, else the role's, else `defaults`'s, whole. Pure; it never merges (the
 * parser cannot tell an absent `fs` from an empty one, and a weaker layer must never widen a stronger one).
 */
export function resolvePermissions(layers: {
  readonly step?: StepPermissions;
  readonly role?: StepPermissions;
  readonly defaults?: StepPermissions;
}): StepPermissions | undefined {
  return layers.step ?? layers.role ?? layers.defaults;
}

export type EffectiveLevel =
  | { readonly kind: 'written'; readonly level: PermissionLevel }
  | { readonly kind: 'default'; readonly impliedLevel: PermissionLevel };

/**
 * AC-08, AC-13: a step that writes a level runs at it. A step that writes none has no level in force: it keeps its
 * runner's behaviour, and the implied level (`edit` if `fs.write` is non-empty, else `read`) only describes it.
 */
export function effectiveLevel(permissions: StepPermissions | undefined): EffectiveLevel {
  if (permissions?.level !== undefined) {
    return { kind: 'written', level: permissions.level };
  }
  return {
    kind: 'default',
    impliedLevel:
      permissions !== undefined && permissions.fsWrite.length > 0
        ? PermissionLevel.Edit
        : PermissionLevel.Read,
  };
}

/** AC-12: the lower of two levels. */
export function lowerLevel(a: PermissionLevel, b: PermissionLevel): PermissionLevel {
  return PERMISSION_ORDER.indexOf(a) <= PERMISSION_ORDER.indexOf(b) ? a : b;
}

export interface BoundResult {
  readonly permissions: StepPermissions | undefined;
  /** The level the step runs at afterwards, or undefined when it still has none. */
  readonly level: PermissionLevel | undefined;
  /** False when the bound changed nothing (a step with no level and a bound above `read`). */
  readonly changed: boolean;
}

/**
 * AC-12: apply a run bound to a step's effective block. A written level is lowered (`edit` to `read` drops `fs.write`,
 * so the implied guard then allows no change). A step with no level takes only a bound of `read`; any other bound over
 * it changes nothing. It can never raise a level.
 */
export function applyBound(permissions: StepPermissions | undefined, bound: PermissionLevel): BoundResult {
  const current = effectiveLevel(permissions);
  if (current.kind === 'default') {
    if (bound === PermissionLevel.Read) {
      return {
        permissions: {
          level: PermissionLevel.Read,
          fsRead: permissions?.fsRead ?? [],
          fsWrite: [],
          terminal: 'deny',
        },
        level: PermissionLevel.Read,
        changed: true,
      };
    }
    return { permissions, level: undefined, changed: false };
  }
  const lowered = lowerLevel(current.level, bound);
  if (lowered === current.level || permissions === undefined) {
    return { permissions, level: current.level, changed: false };
  }
  if (lowered === PermissionLevel.Read) {
    return {
      permissions: { level: PermissionLevel.Read, fsRead: permissions.fsRead, fsWrite: [], terminal: 'deny' },
      level: lowered,
      changed: true,
    };
  }
  // full -> edit: the author wrote no folders at `full`, so there is nothing for `edit` to name; read is the only safe lower level.
  return {
    permissions: { level: PermissionLevel.Read, fsRead: permissions.fsRead, fsWrite: [], terminal: 'deny' },
    level: PermissionLevel.Read,
    changed: true,
  };
}

export interface ChainEntry {
  readonly name: string;
  readonly capabilities: readonly PermissionCapability[];
}

/** AC-07: what a step's chain of runners cannot honour. Empty means every runner in the chain honours the level. */
export function unsupportedBy(
  level: PermissionLevel,
  chain: readonly ChainEntry[],
): readonly { readonly runner: string; readonly capability: PermissionCapability | undefined }[] {
  const out: { readonly runner: string; readonly capability: PermissionCapability | undefined }[] = [];
  for (const entry of chain) {
    const capability = entry.capabilities.find((c) => c.level === level);
    if (capability === undefined || capability.mode === EnforcementMode.Unsupported) {
      out.push({ runner: entry.name, capability });
    }
  }
  return out;
}

/** AC-07, AC-17, C-10: a structured description for the CLI and the page to render in their own words. No English here. */
export interface EnforcementDescription {
  readonly runner: string;
  readonly level: PermissionLevel;
  readonly mode: EnforcementMode;
  readonly scope: EnforcementScope;
  readonly note: string;
  /** The mode or the scope is only a check after the step. */
  readonly checkedOnlyAfter: boolean;
}

export function describeEnforcement(
  runner: string,
  capability: PermissionCapability,
): EnforcementDescription {
  return {
    runner,
    level: capability.level,
    mode: capability.mode,
    scope: capability.scope,
    note: capability.note,
    checkedOnlyAfter:
      capability.mode === EnforcementMode.After || capability.scope === EnforcementScope.Guard,
  };
}
