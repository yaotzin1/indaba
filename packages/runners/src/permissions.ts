import {
  EnforcementMode,
  EnforcementScope,
  MAX_DENIAL_WINDOW,
  type PermissionCapability,
  PermissionLevel,
} from '@indaba/core';

/** One row of a runner's table (specs/agent-permissions, C-03). */
export function capability(
  level: PermissionLevel,
  mode: EnforcementMode,
  scope: EnforcementScope,
  note: string,
): PermissionCapability {
  return { level, mode, scope, note };
}

/** The level cannot be honoured; the note says why in a fixed id the front end turns into words. */
export function unsupported(level: PermissionLevel, note: string): PermissionCapability {
  return capability(level, EnforcementMode.Unsupported, EnforcementScope.None, note);
}

/** `full` for a command-line runner: the agent's own switch removes every limit, and Indaba holds none. */
export function fullAccess(note: string): PermissionCapability {
  return capability(PermissionLevel.Full, EnforcementMode.Native, EnforcementScope.None, note);
}

/** `read` or `edit` through the agent's own mode; the globs and `terminal: deny` are held by the scope guard after the step. */
export function nativeWithGuard(level: PermissionLevel, note: string): PermissionCapability {
  return capability(level, EnforcementMode.Native, EnforcementScope.Guard, note);
}

/** The runner has no mode for the level; only the scope guard checks, after the step. */
export function afterOnly(level: PermissionLevel, note: string): PermissionCapability {
  return capability(level, EnforcementMode.After, EnforcementScope.Guard, note);
}

/**
 * AC-07: when a level is written, an embedder's `extraArgs` may not carry a permission flag of the agent, because the
 * level's own arguments are the only ones allowed to say how much the agent may do. `valued` flags take the next
 * argument with them (`--permission-mode plan`, `--mode=plan`); `bare` flags stand alone.
 */
export function withoutPermissionFlags(
  args: readonly string[],
  flags: { readonly valued: readonly string[]; readonly bare: readonly string[] },
): readonly string[] {
  const kept: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';
    const name = arg.split('=')[0] ?? arg;
    if (flags.bare.includes(name)) {
      continue;
    }
    if (flags.valued.includes(name)) {
      if (!arg.includes('=')) {
        i += 1;
      }
      continue;
    }
    kept.push(arg);
  }
  return kept;
}

/**
 * The first and the last `MAX_DENIAL_WINDOW` characters of an output: where a refusal message sits (C-07). Bounded, so a
 * hostile or huge output costs the same to scan.
 */
export function denialWindows(output: string): readonly string[] {
  if (output.length <= MAX_DENIAL_WINDOW * 2) {
    return [output];
  }
  return [output.slice(0, MAX_DENIAL_WINDOW), output.slice(-MAX_DENIAL_WINDOW)];
}
