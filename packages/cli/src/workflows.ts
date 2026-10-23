import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  type Logger,
  type RegistryAnnotation,
  type RegistryEntry,
  RegistryError,
  type RegistryScanReport,
  type WorkflowRegistry,
} from '@indaba/core';
import { sanitize } from '@indaba/engine';

/** `indaba workflows`: the workflow registry from the command line (specs/workflow-registry, AC-09 to AC-13). */

export const WORKFLOWS_USAGE = `Usage: indaba workflows <list | scan | add | annotate | remove | copy> [options]

The workflows of this folder and of the folders you added, with their state and last run. The files stay the
workflows: the list only points at them, and nothing here deletes or rewrites one.

  list [--all] [--json]             Scan, then list them (--all shows hidden ones)
  scan [--json]                     Look at every folder again and say what changed
  add <folder-or-file>              Add a folder to look in, or list one file with another name
  annotate <id> [--name <n>] [--project <p>] [--tag <t>]... [--no-tags] [--hide | --show]
                [--clear-name] [--clear-project]
                                    Your name, project, tags, or hidden flag for an entry; the file is untouched
  remove <id>                       Take an entry out of the list (a missing file, or one added by path)
  copy <id> --to <folder> [--name <n>]
                                    Copy the file into a folder, never over another, and say what to review

An <id> is the start of an entry's id, as list shows it. --plugin <spec> (repeatable) loads plugins first, so a
registry a plugin registers is the one used.
`;

export class WorkflowsUsageError extends Error {}

/** The per-user list of added folders, in the user's configuration folder, beside the confirmations of indaba ui. */
export const WORKFLOW_ROOTS_FILE = join('indaba', 'workflow-roots.json');

const SUBCOMMANDS = ['list', 'scan', 'add', 'annotate', 'remove', 'copy'] as const;
export type WorkflowsSubcommand = (typeof SUBCOMMANDS)[number];

export interface WorkflowsOptions {
  readonly subcommand: WorkflowsSubcommand;
  /** The folder, file or id the subcommand is about. */
  readonly target: string | undefined;
  readonly json: boolean;
  readonly all: boolean;
  readonly to: string | undefined;
  readonly name: string | undefined;
  readonly project: string | undefined;
  readonly tags: readonly string[];
  readonly noTags: boolean;
  readonly hide: boolean;
  readonly show: boolean;
  readonly clearName: boolean;
  readonly clearProject: boolean;
  readonly plugins: readonly string[];
  readonly help: boolean;
}

const isSubcommand = (value: string | undefined): value is WorkflowsSubcommand =>
  SUBCOMMANDS.some((s) => s === value);

/** The options of `indaba workflows`, or a usage error naming what is wrong. */
export function parseWorkflows(args: readonly string[]): WorkflowsOptions {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(args);
  } catch (error) {
    throw new WorkflowsUsageError(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  const help = values.help === true;
  const [sub, target, ...extra] = positionals;
  if (sub === undefined && help) {
    return { ...EMPTY, help: true };
  }
  if (!isSubcommand(sub)) {
    throw new WorkflowsUsageError(
      sub === undefined
        ? 'Name what to do: list, scan, add, annotate, remove or copy.'
        : `Unknown subcommand: ${sub}.`,
    );
  }
  if (extra.length > 0) {
    throw new WorkflowsUsageError(`Unexpected argument: ${extra[0] ?? ''}.`);
  }
  const needsTarget = sub === 'add' || sub === 'annotate' || sub === 'remove' || sub === 'copy';
  if (!help && needsTarget && target === undefined) {
    throw new WorkflowsUsageError(
      sub === 'add' ? 'Name a folder or a file to add.' : 'Name the entry by its id.',
    );
  }
  if (!help && !needsTarget && target !== undefined) {
    throw new WorkflowsUsageError(`Unexpected argument: ${target}.`);
  }
  if (!help && sub === 'copy' && values.to === undefined) {
    throw new WorkflowsUsageError('Name the folder to copy into with --to <folder>.');
  }
  if (values.hide === true && values.show === true) {
    throw new WorkflowsUsageError('--hide and --show cannot be given together.');
  }
  const annotating =
    values.name !== undefined ||
    values.project !== undefined ||
    (values.tag ?? []).length > 0 ||
    values['no-tags'] === true ||
    values.hide === true ||
    values.show === true ||
    values['clear-name'] === true ||
    values['clear-project'] === true;
  if (!help && sub === 'annotate' && !annotating) {
    throw new WorkflowsUsageError(
      'Say what to change: --name, --project, --tag, --no-tags, --hide or --show.',
    );
  }
  return {
    subcommand: sub,
    target,
    json: values.json === true,
    all: values.all === true,
    to: values.to,
    name: values.name,
    project: values.project,
    tags: values.tag ?? [],
    noTags: values['no-tags'] === true,
    hide: values.hide === true,
    show: values.show === true,
    clearName: values['clear-name'] === true,
    clearProject: values['clear-project'] === true,
    plugins: values.plugin ?? [],
    help,
  };
}

const EMPTY: WorkflowsOptions = {
  subcommand: 'list',
  target: undefined,
  json: false,
  all: false,
  to: undefined,
  name: undefined,
  project: undefined,
  tags: [],
  noTags: false,
  hide: false,
  show: false,
  clearName: false,
  clearProject: false,
  plugins: [],
  help: false,
};

function parse(args: readonly string[]) {
  return parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: 'boolean' },
      all: { type: 'boolean' },
      to: { type: 'string' },
      name: { type: 'string' },
      project: { type: 'string' },
      tag: { type: 'string', multiple: true },
      'no-tags': { type: 'boolean' },
      hide: { type: 'boolean' },
      show: { type: 'boolean' },
      'clear-name': { type: 'boolean' },
      'clear-project': { type: 'boolean' },
      plugin: { type: 'string', multiple: true },
      help: { type: 'boolean', short: 'h' },
    },
  });
}

/** The folders a person added, from the per-user file; a file that is not a list of strings reads as empty. */
export async function readRoots(file: string): Promise<readonly string[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === 'string') : [];
}

/** Writes the per-user list of folders whole, through a temporary file. */
export async function writeRoots(file: string, roots: readonly string[], pid: number): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(roots, null, 2)}\n`, { flag: 'w' });
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

const isFolder = (path: string): Promise<boolean> =>
  stat(path).then(
    (info) => info.isDirectory(),
    () => false,
  );

export interface WorkflowsIo {
  readonly stdout: { write(text: string): unknown };
  readonly stderr: { write(text: string): unknown };
}

export interface WorkflowsDeps {
  /** The folder the command runs in: always a root. */
  readonly cwd: string;
  /** The per-user list of added folders. */
  readonly rootsFile: string;
  readonly pid: number;
  /** The registry over these roots: the one a plugin registered, else the built-in file store. */
  readonly registry: (roots: readonly string[]) => Promise<WorkflowRegistry>;
  readonly logger: Logger;
}

/** The shortest start of each id, of at least eight characters, that names it alone among `ids`. */
export function shortIds(ids: readonly string[]): ReadonlyMap<string, string> {
  const short = new Map<string, string>();
  for (const id of ids) {
    let length = Math.min(8, id.length);
    while (length < id.length && ids.some((other) => other !== id && other.startsWith(id.slice(0, length)))) {
      length += 1;
    }
    short.set(id, id.slice(0, length));
  }
  return short;
}

const STATE_WORDS = { valid: 'valid', invalid: 'invalid', missing: 'missing' } as const;

function entryLine(entry: RegistryEntry, id: string): string {
  const clean = (text: string): string => sanitize(text).replace(/\s+/g, ' ').trim();
  const run =
    entry.lastRun === undefined
      ? 'no run yet'
      : `last run ${clean(entry.lastRun.status)}${entry.lastRun.startedAt === undefined ? '' : ` ${entry.lastRun.startedAt.slice(0, 10)}`}`;
  const tags = entry.tags.length === 0 ? '' : `  [${entry.tags.map(clean).join(', ')}]`;
  const hidden = entry.hidden ? '  (hidden)' : '';
  const why =
    entry.validation.state === 'invalid'
      ? `\n           ${clean(entry.validation.message)}`
      : entry.validation.state === 'missing'
        ? `\n           ${clean(entry.validation.reason)}`
        : '';
  return `${id.padEnd(9)} ${STATE_WORDS[entry.validation.state].padEnd(8)} ${clean(entry.name)}  (${clean(entry.project)}: ${clean(entry.path)})  ${run}${tags}${hidden}${why}\n`;
}

function reportLine(report: RegistryScanReport): string {
  const notes = [
    report.truncated ? 'a limit stopped the scan, so some files may be missing: add a smaller folder' : '',
    report.recovered
      ? 'the index could not be read; it was kept as index.json.bak and the list started again'
      : '',
  ].filter((n) => n !== '');
  return `${report.root}\n  found ${report.found}, new ${report.added}, changed ${report.changed}, moved ${report.moved}, missing ${report.missing}, invalid ${report.invalid}\n${notes.map((n) => `  ${n}\n`).join('')}`;
}

/** A refusal of a registry, also one from a plugin's copy of `@indaba/core`, recognised by name and code. */
function isRegistryError(
  error: unknown,
): error is Error & { readonly code: string; readonly candidates?: readonly string[] } {
  return (
    error instanceof RegistryError ||
    (error instanceof Error &&
      error.name === 'RegistryError' &&
      typeof (error as { code?: unknown }).code === 'string')
  );
}

/** `indaba workflows`: 0, 1 for a refusal or a store that failed, 2 for a usage error (the caller's). */
export async function workflowsCommand(
  options: WorkflowsOptions,
  io: WorkflowsIo,
  deps: WorkflowsDeps,
): Promise<number> {
  const saved = await readRoots(deps.rootsFile);
  const roots: string[] = [deps.cwd];
  for (const root of saved) {
    if (roots.includes(root)) {
      continue;
    }
    if (await isFolder(root)) {
      roots.push(root);
    } else {
      io.stderr.write(`Skipped a folder that is not there any more: ${sanitize(root)}\n`);
    }
  }
  const outcome = (code: string): void => {
    deps.logger.info('cli.workflows', 'workflows', { subcommand: options.subcommand, outcome: code });
  };
  try {
    const code = await run(options, io, deps, roots, saved);
    outcome('ok');
    return code;
  } catch (error) {
    if (isRegistryError(error)) {
      const candidates = error.candidates ?? [];
      io.stderr.write(
        `${sanitize(error.message)}${candidates.length === 0 ? '' : `: ${candidates.map(sanitize).join(', ')}`}\n`,
      );
      outcome(error.code);
      return 1;
    }
    throw error;
  }
}

async function run(
  options: WorkflowsOptions,
  io: WorkflowsIo,
  deps: WorkflowsDeps,
  roots: readonly string[],
  saved: readonly string[],
): Promise<number> {
  const target = options.target ?? '';
  switch (options.subcommand) {
    case 'list': {
      const registry = await deps.registry(roots);
      await registry.scan();
      const entries = await registry.list({ includeHidden: options.all });
      if (options.json) {
        io.stdout.write(`${JSON.stringify({ registry: 1, entries }, null, 2)}\n`);
        return 0;
      }
      if (entries.length === 0) {
        io.stdout.write(
          'No workflow found. Indaba lists files named *.workflow.ai.yml (or .yaml) and .indaba/workflow.ai.yml; add a folder with indaba workflows add <folder>.\n',
        );
        return 0;
      }
      const short = shortIds(entries.map((e) => e.id));
      for (const entry of entries) {
        io.stdout.write(entryLine(entry, short.get(entry.id) ?? entry.id));
      }
      return 0;
    }
    case 'scan': {
      const reports = await (await deps.registry(roots)).scan();
      io.stdout.write(
        options.json
          ? `${JSON.stringify({ registry: 1, reports }, null, 2)}\n`
          : reports.map(reportLine).join(''),
      );
      return 0;
    }
    case 'add': {
      const path = resolve(deps.cwd, target);
      if (await isFolder(path)) {
        if (!roots.includes(path)) {
          await writeRoots(deps.rootsFile, [...saved, path], deps.pid);
        }
        const registry = await deps.registry(roots.includes(path) ? roots : [...roots, path]);
        const report = (await registry.scan()).find((r) => r.root === path);
        io.stdout.write(`Added ${sanitize(path)}: ${report?.found ?? 0} workflow files.\n`);
        return 0;
      }
      const entry = await (await deps.registry(roots)).add(path);
      io.stdout.write(entryLine(entry, entry.id));
      return 0;
    }
    case 'annotate': {
      const annotation: RegistryAnnotation = {
        ...(options.clearName ? { name: null } : options.name === undefined ? {} : { name: options.name }),
        ...(options.clearProject
          ? { project: null }
          : options.project === undefined
            ? {}
            : { project: options.project }),
        ...(options.noTags ? { tags: [] } : options.tags.length === 0 ? {} : { tags: options.tags }),
        ...(options.hide ? { hidden: true } : options.show ? { hidden: false } : {}),
      };
      const entry = await (await deps.registry(roots)).annotate(target, annotation);
      io.stdout.write(entryLine(entry, entry.id));
      return 0;
    }
    case 'remove': {
      const registry = await deps.registry(roots);
      const entry = await registry.get(target);
      await registry.remove(target);
      io.stdout.write(
        `Removed ${sanitize(entry?.path ?? target)} from the list. The file, if it is there, is untouched.\n`,
      );
      return 0;
    }
    case 'copy': {
      const copy = await (await deps.registry(roots)).copy(target, {
        folder: resolve(deps.cwd, options.to ?? ''),
        ...(options.name === undefined ? {} : { name: options.name }),
      });
      io.stdout.write(`Copied to ${sanitize(copy.entry.path)} (${copy.entry.id}).\n`);
      if (copy.toReview.length > 0) {
        io.stdout.write(
          `Before running it, look at what may differ in this project:\n${copy.toReview.map((p) => `  ${sanitize(p)}\n`).join('')}`,
        );
      }
      return 0;
    }
  }
}
