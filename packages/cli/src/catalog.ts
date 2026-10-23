import { parseArgs } from 'node:util';
import type { Adjudicator, Logger, Plugin } from '@indaba/core';
import { type Catalog, type CatalogSources, catalogOf } from '@indaba/engine';
import { HUMAN_ARBITER_DESCRIPTION } from './arbiter-prompt.js';

export const CATALOG_USAGE = `Usage: indaba catalog [--json] [--plugin <specifier>]...

Print what this installation offers a workflow: its runners, guard types, arbiters (and, once they exist, voters and
prompts), each with one line, and the values a workflow field may take. --plugin loads plugins first, so what they add
is listed. --json prints it for a program; its "catalog" field is the version of that shape.

Options:
      --json              Print JSON instead of text
      --plugin <spec>     Load a plugin; repeatable
`;

export class CatalogUsageError extends Error {}

export interface CatalogOptions {
  readonly json: boolean;
  readonly plugins: readonly string[];
  readonly help: boolean;
}

export function parseCatalog(args: readonly string[]): CatalogOptions {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(args);
  } catch (error) {
    throw new CatalogUsageError(error instanceof Error ? error.message : String(error));
  }
  if (parsed.positionals.length > 0) {
    throw new CatalogUsageError(`Unexpected argument: ${parsed.positionals[0] ?? ''}.`);
  }
  return {
    json: parsed.values.json === true,
    plugins: parsed.values.plugin ?? [],
    help: parsed.values.help === true,
  };
}

function parse(args: readonly string[]) {
  return parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: 'boolean' },
      plugin: { type: 'string', multiple: true },
      help: { type: 'boolean', short: 'h' },
    },
  });
}

/**
 * The arbiter `human` without a terminal: it is in the catalog because a workflow can name it, and it never rules here,
 * since nothing runs.
 */
export const LISTED_HUMAN_ARBITER: Adjudicator = {
  description: HUMAN_ARBITER_DESCRIPTION,
  rule: async () => null,
};

function section(title: string, entries: Catalog['runners'], none: string): string {
  if (entries.length === 0) {
    return `${title}\n  ${none}\n`;
  }
  const width = Math.min(24, Math.max(...entries.map((entry) => entry.name.length)) + 2);
  return `${title}\n${entries
    .map((entry) => `  ${entry.name.padEnd(width)}${entry.description}`.trimEnd())
    .join('\n')}\n`;
}

/** The catalog as a person reads it. */
export function catalogText(catalog: Catalog): string {
  const { values } = catalog;
  return [
    section('Runners', catalog.runners, '(none)'),
    section('Guard types', catalog.guards, '(none)'),
    section('Arbiters', catalog.arbiters, '(none)'),
    section('Voters', catalog.voters, '(none yet)'),
    section('Prompts', catalog.prompts, '(none yet)'),
    `Values\n  decision_type      ${values.decisionTypes.join(', ')}\n  isolation          ${values.isolation.join(', ')}\n  on_failure.action  ${values.failureActions.join(', ')}\n  mcp_policy         ${values.mcpPolicies.join(', ')}\n`,
  ].join('\n');
}

export interface CatalogDeps {
  readonly loadPlugins: (specifiers: readonly string[]) => Promise<Plugin[]>;
  readonly sources: (plugins: readonly Plugin[]) => Promise<CatalogSources>;
  readonly logger: Logger;
}

/** `indaba catalog`: 0, 1 when a plugin fails to load (as validate does), 2 for a usage error (the caller's). */
export async function catalogCommand(
  options: CatalogOptions,
  io: { readonly stdout: { write(text: string): void } },
  deps: CatalogDeps,
): Promise<number> {
  const plugins = await deps.loadPlugins(options.plugins);
  const catalog = catalogOf(await deps.sources(plugins));
  io.stdout.write(options.json ? `${JSON.stringify(catalog, null, 2)}\n` : catalogText(catalog));
  deps.logger.info('cli.catalog', 'the catalog was printed', {
    runners: catalog.runners.length,
    guards: catalog.guards.length,
    arbiters: catalog.arbiters.length,
    plugins: plugins.length,
  });
  return 0;
}
