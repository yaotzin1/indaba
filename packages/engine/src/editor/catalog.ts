import { DecisionType, type Described, FailureAction, Isolation, McpPolicy } from '@indaba/core';
import { sanitize } from '../trace/sanitize.js';

/** The longest description a catalog carries; longer is cut (api-surface, "Defaults introduced"). */
export const MAX_DESCRIPTION = 200;

/**
 * What this installation offers a workflow (specs/workflow-editor, AC-12): the names a wizard can choose from, plugins
 * included, each with one line, and the enumerated values of the format. `catalog` is the shape's version; a change of
 * shape is a major for its readers and raises it.
 */
export interface Catalog {
  readonly catalog: 1;
  readonly runners: readonly Described[];
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

/** Anything that can list what it holds: the registries of an engine bundle. */
export interface Describes {
  describe(): readonly Described[];
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
function clean(entry: Described): Described {
  const line = sanitize(entry.description).replace(/\s+/g, ' ').trim();
  return {
    name: sanitize(entry.name),
    description: line.length > MAX_DESCRIPTION ? `${line.slice(0, MAX_DESCRIPTION - 1)}…` : line,
  };
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
