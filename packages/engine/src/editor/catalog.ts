import {
  type CatalogPermission,
  type CatalogPermissions,
  DecisionType,
  type Described,
  EnforcementMode,
  EnforcementScope,
  FailureAction,
  Isolation,
  McpPolicy,
  NOT_OFFERED_NOTE,
  type PermissionLevel,
} from '@indaba/core';
import { sanitize } from '../trace/sanitize.js';

/** The longest description a catalog carries; longer is cut (api-surface, "Defaults introduced"). */
export const MAX_DESCRIPTION = 200;
/** The longest permission note id a catalog carries (a plugin's is cut). */
const MAX_NOTE = 64;

/**
 * What this installation offers a workflow (specs/workflow-editor, AC-12): the names a wizard can choose from, plugins
 * included, each with one line, and the enumerated values of the format. `catalog` is the shape's version; a change of
 * shape is a major for its readers and raises it; an optional member does not (specs/agent-permissions, C-11).
 */
export interface Catalog {
  readonly catalog: 1;
  readonly runners: readonly DescribedEntry[];
  readonly guards: readonly Described[];
  readonly arbiters: readonly Described[];
  /** Empty until specs/voter-arbiter (spec C-01). */
  readonly voters: readonly Described[];
  /** Empty until specs/debate-findings (spec C-01). */
  readonly prompts: readonly Described[];
  readonly values: {
    readonly decisionTypes: readonly string[];
    readonly isolation: readonly string[];
    readonly failureActions: readonly string[];
    readonly mcpPolicies: readonly string[];
    /** Empty until specs/debate-findings (spec C-01). */
    readonly promptAdditions: readonly string[];
  };
}

/** A name and line, and for a runner what each permission level means for it (AC-16). */
export interface DescribedEntry extends Described {
  readonly permissions?: CatalogPermissions;
}

/** Anything that can list what it holds: the registries of an engine bundle. */
export interface Describes {
  describe(): readonly DescribedEntry[];
}

/**
 * What `catalogOf` reads: an engine bundle's registries. A structural type, so the command line's `EngineBundle` (or a
 * server's own) passes as it is.
 */
export interface CatalogSources {
  readonly runners: Describes;
  readonly guards: Describes;
  readonly adjudicators: Describes;
}

/** A name and line from a plugin, as a screen may show them: no control sequence, one line, a bounded length. */
function clean(entry: DescribedEntry): DescribedEntry {
  const line = sanitize(entry.description).replace(/\s+/g, ' ').trim();
  const base = {
    name: sanitize(entry.name),
    description: line.length > MAX_DESCRIPTION ? `${line.slice(0, MAX_DESCRIPTION - 1)}…` : line,
  };
  return entry.permissions === undefined
    ? base
    : { ...base, permissions: cleanPermissions(entry.permissions) };
}

const MODES: readonly string[] = Object.values(EnforcementMode);
const SCOPES: readonly string[] = Object.values(EnforcementScope);

/** What a plugin says of its levels, rebuilt: only the known words and a note that is one clean token (a plugin is not trusted). */
function cleanPermissions(permissions: CatalogPermissions): CatalogPermissions {
  const one = (level: PermissionLevel): CatalogPermission => {
    const given: CatalogPermission | undefined = permissions[level];
    if (given === undefined || !MODES.includes(given.mode) || !SCOPES.includes(given.scope)) {
      return { mode: EnforcementMode.Unsupported, scope: EnforcementScope.None, note: NOT_OFFERED_NOTE };
    }
    const note = sanitize(given.note)
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, MAX_NOTE);
    return { mode: given.mode, scope: given.scope, note: note === '' ? NOT_OFFERED_NOTE : note };
  };
  return { read: one('read'), edit: one('edit'), full: one('full') };
}

/** The catalog of what `sources` hold, for `indaba catalog` or a server that calls it in-process (AC-13). */
export function catalogOf(sources: CatalogSources): Catalog {
  return {
    catalog: 1,
    runners: sources.runners.describe().map(clean),
    guards: sources.guards.describe().map(clean),
    arbiters: sources.adjudicators.describe().map(clean),
    voters: [],
    prompts: [],
    values: {
      decisionTypes: Object.values(DecisionType),
      isolation: Object.values(Isolation),
      failureActions: Object.values(FailureAction),
      mcpPolicies: Object.values(McpPolicy),
      promptAdditions: [],
    },
  };
}
