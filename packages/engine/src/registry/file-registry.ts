import { createHash } from 'node:crypto';
import { lstat, realpath, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';
import {
  type Logger,
  noopLogger,
  type RegistryAnnotation,
  type RegistryCopy,
  type RegistryEntry,
  RegistryError,
  type RegistryScanReport,
  type RegistryValidation,
  type RunSummary,
  type WorkflowDefinition,
  type WorkflowRegistry,
  WorkflowValidationError,
} from '@indaba/core';
import { WorkflowDocument } from '../editor/document.js';
import { sanitize } from '../trace/sanitize.js';
import { TraceReader } from '../trace/trace-reader.js';
import {
  DEFAULT_WORKFLOW,
  isInside,
  isWorkflowFileName,
  posixPath,
  readWorkflowFile,
  regularFileSize,
  scanWorkflowFiles,
  tooLarge,
  UnreadableWorkflow,
} from './files.js';
import { readIndex, type StoredEntry, writeIndex } from './index-file.js';

export interface FileWorkflowRegistryOptions {
  /** Absolute folders. */
  readonly roots: readonly string[];
  /** Parses a workflow as `indaba validate` does; throws `WorkflowValidationError` with its problems. */
  readonly parse: (source: string) => WorkflowDefinition;
  readonly clock: () => Date;
  /** Sixteen hexadecimal characters, new at each call. */
  readonly ids: () => string;
  readonly logger?: Logger;
}

/** What a read of one file gave; undefined when the file is gone. */
interface ReadFile {
  readonly hash: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly workflowName: string | null;
  readonly validation: RegistryValidation;
}

/** A copy's file name: letters, digits, `.`, `-` and `_`, starting with a letter or a digit. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** The first line of a sentence, cleaned and cut, as an index keeps a message. */
const oneLine = (text: string): string =>
  sanitize(text.split('\n')[0] ?? '')
    .trim()
    .slice(0, 300);

/** A file's name without its workflow suffix: `site.workflow.ai.yml` is `site`. */
export const fileStem = (path: string): string =>
  basename(path).replace(/\.workflow\.ai\.ya?ml$|\.ya?ml$/, '') || basename(path);

/** Whether a scan lists this path again (spec C-08): by its name, or as the project's default workflow. */
const scanFinds = (path: string): boolean => path === DEFAULT_WORKFLOW || isWorkflowFileName(basename(path));

function tagsOf(tags: readonly string[]): readonly string[] {
  const kept: string[] = [];
  for (const tag of tags) {
    const clean = oneLine(tag).slice(0, 60);
    if (clean !== '' && !kept.includes(clean)) {
      kept.push(clean);
    }
  }
  return kept;
}

/**
 * The places of a workflow a person usually changes when it is copied for another project (spec C-05), read from its
 * text whether or not it is valid. Nothing is rewritten.
 */
export function placesToReview(text: string): readonly string[] {
  let doc: WorkflowDocument;
  try {
    doc = WorkflowDocument.parse(text);
  } catch {
    return [];
  }
  const places: string[] = [];
  const line = (where: string, value: unknown): void => {
    if (typeof value === 'string' && value.trim() !== '') {
      places.push(`${where}: ${oneLine(value)}`);
    }
  };
  const list = (where: string, value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        line(`${where}[${i}]`, v);
      });
    }
  };
  const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  line('name', doc.get(['name']));
  const artifacts = doc.get(['artifacts']);
  if (isRecord(artifacts)) {
    for (const [key, value] of Object.entries(artifacts)) {
      line(`artifacts.${key}`, value);
    }
  }
  const steps = doc.get(['steps']);
  if (Array.isArray(steps)) {
    steps.forEach((step, i) => {
      if (!isRecord(step)) {
        return;
      }
      const at = `steps[${i}]`;
      list(`${at}.input_artifacts`, step.input_artifacts);
      list(`${at}.outputs`, step.outputs);
      const fs =
        isRecord(step.permissions) && isRecord(step.permissions.fs) ? step.permissions.fs : undefined;
      list(`${at}.permissions.fs.read`, fs?.read);
      list(`${at}.permissions.fs.write`, fs?.write);
      if (Array.isArray(step.guards)) {
        step.guards.forEach((guard, g) => {
          list(`${at}.guards[${g}].paths`, isRecord(guard) ? guard.paths : undefined);
        });
      }
      list(`${at}.commands`, step.commands);
    });
  }
  return places;
}

/**
 * The built-in workflow registry (specs/workflow-registry): one index per root, kept current by a scan, holding a
 * cache of what each file was and the person's annotations, never the definition.
 */
export class FileWorkflowRegistry implements WorkflowRegistry {
  private readonly log: Logger;

  constructor(private readonly options: FileWorkflowRegistryOptions) {
    this.log = options.logger ?? noopLogger;
  }

  roots(): readonly string[] {
    return this.options.roots;
  }

  /** Reads one file: its bytes, confined to its root, hashed and parsed. Undefined when it is gone. */
  private async readOne(root: string, path: string): Promise<ReadFile | undefined> {
    const file = join(root, ...path.split('/'));
    let mtimeMs: number;
    try {
      mtimeMs = (await lstat(file)).mtimeMs;
    } catch {
      return undefined;
    }
    let buffer: Buffer;
    try {
      buffer = await readWorkflowFile(root, file);
    } catch (error) {
      if (error instanceof UnreadableWorkflow && error.reason === 'too_large') {
        const size = (await regularFileSize(file)) ?? 0;
        return {
          hash: '',
          size,
          mtimeMs,
          workflowName: null,
          validation: { state: 'invalid', message: tooLarge() },
        };
      }
      return undefined;
    }
    const hash = createHash('sha256').update(buffer).digest('hex');
    const base = { hash, size: buffer.length, mtimeMs };
    try {
      const workflow = this.options.parse(buffer.toString('utf8'));
      return { ...base, workflowName: oneLine(workflow.name), validation: { state: 'valid' } };
    } catch (error) {
      const message =
        error instanceof WorkflowValidationError
          ? (error.problems[0] ?? error.message)
          : error instanceof Error
            ? error.message
            : String(error);
      return { ...base, workflowName: null, validation: { state: 'invalid', message: oneLine(message) } };
    }
  }

  private now(): string {
    return this.options.clock().toISOString();
  }

  private stored(
    path: string,
    read: ReadFile,
    origin: StoredEntry['origin'],
    copiedFrom?: string,
  ): StoredEntry {
    return {
      id: this.options.ids(),
      path,
      origin,
      ...(copiedFrom === undefined ? {} : { copiedFrom }),
      ...read,
      readAt: this.now(),
      name: null,
      project: null,
      tags: [],
      hidden: false,
    };
  }

  private refreshed(entry: StoredEntry, read: ReadFile): StoredEntry {
    return { ...entry, ...read, readAt: this.now() };
  }

  private entryOf(root: string, stored: StoredEntry, lastRun: RunSummary | undefined): RegistryEntry {
    return {
      id: stored.id,
      root,
      path: stored.path,
      name: stored.name ?? stored.workflowName ?? fileStem(stored.path),
      project: stored.project ?? basename(root),
      tags: stored.tags,
      hidden: stored.hidden,
      hash: stored.hash,
      validation: stored.validation,
      readAt: stored.readAt,
      origin: stored.origin,
      ...(stored.copiedFrom === undefined ? {} : { copiedFrom: stored.copiedFrom }),
      ...(lastRun === undefined ? {} : { lastRun }),
    };
  }

  async scan(options: { readonly signal?: AbortSignal } = {}): Promise<readonly RegistryScanReport[]> {
    const { signal } = options;
    signal?.throwIfAborted();
    const walk = await scanWorkflowFiles(this.options.roots);
    const reports: RegistryScanReport[] = [];
    for (const [rootIndex, root] of this.options.roots.entries()) {
      signal?.throwIfAborted();
      reports.push(await this.scanRoot(root, rootIndex, walk.files, walk.truncated, signal));
    }
    return reports;
  }

  private async scanRoot(
    root: string,
    rootIndex: number,
    files: readonly { readonly rootIndex: number; readonly path: string; readonly size: number }[],
    truncated: boolean,
    signal: AbortSignal | undefined,
  ): Promise<RegistryScanReport> {
    const counts = { found: 0, added: 0, changed: 0, moved: 0 };
    let isFolder = false;
    try {
      isFolder = (await lstat(root)).isDirectory();
    } catch {
      isFolder = false;
    }
    if (!isFolder) {
      // Its index lived in it: nothing to read or write. The command line says which root it is.
      return { root, ...counts, missing: 0, invalid: 0, truncated, recovered: false };
    }
    const { entries, recovered } = await readIndex(root, true);
    const byPath = new Map(entries.map((e) => [e.path, e]));
    const listed = files.filter((f) => f.rootIndex === rootIndex);
    counts.found = listed.length;
    const kept: StoredEntry[] = [];
    const fresh: { path: string; read: ReadFile }[] = [];
    const gone: StoredEntry[] = [];

    const keepOrRead = async (entry: StoredEntry, size: number | undefined): Promise<boolean> => {
      if (entry.validation.state !== 'missing' && size === entry.size) {
        const mtimeMs = await lstat(join(root, ...entry.path.split('/'))).then(
          (info) => info.mtimeMs,
          () => undefined,
        );
        if (mtimeMs === entry.mtimeMs) {
          kept.push(entry);
          return true;
        }
      }
      const read = await this.readOne(root, entry.path);
      if (read === undefined) {
        return false;
      }
      if (read.hash !== entry.hash || entry.validation.state === 'missing') {
        counts.changed += 1;
      }
      kept.push(this.refreshed(entry, read));
      return true;
    };

    const seen = new Set<string>();
    for (const file of listed) {
      seen.add(file.path);
      const entry = byPath.get(file.path);
      if (entry !== undefined) {
        if (!(await keepOrRead(entry, file.size))) {
          gone.push(entry);
        }
        continue;
      }
      const read = await this.readOne(root, file.path);
      if (read !== undefined) {
        fresh.push({ path: file.path, read });
      }
    }
    // An entry the walk did not list: still there (added by path, or past a limit), or gone.
    for (const entry of entries) {
      if (seen.has(entry.path)) {
        continue;
      }
      const file = join(root, ...entry.path.split('/'));
      const size = (await isInside(root, file)) ? await regularFileSize(file) : undefined;
      if (size === undefined || !(await keepOrRead(entry, size))) {
        gone.push(entry);
      }
    }
    // A new file with the bytes of a gone entry is that entry, moved (spec AC-07).
    const candidates = [...gone].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    for (const { path, read } of fresh) {
      const at = read.hash === '' ? -1 : candidates.findIndex((c) => c.hash === read.hash);
      const moved = at >= 0 ? candidates.splice(at, 1)[0] : undefined;
      if (moved !== undefined) {
        counts.moved += 1;
        kept.push({ ...this.refreshed(moved, read), path });
      } else {
        counts.added += 1;
        kept.push(this.stored(path, read, 'scanned'));
      }
    }
    for (const entry of candidates) {
      kept.push(
        entry.validation.state === 'missing'
          ? entry
          : { ...entry, validation: { state: 'missing', reason: 'the file is gone' } },
      );
    }
    kept.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    signal?.throwIfAborted();
    await writeIndex(root, kept);
    const report: RegistryScanReport = {
      root,
      ...counts,
      missing: kept.filter((e) => e.validation.state === 'missing').length,
      invalid: kept.filter((e) => e.validation.state === 'invalid').length,
      truncated,
      recovered,
    };
    this.log.info('engine.registry', 'scan finished', { ...report });
    if (recovered) {
      this.log.warn('engine.registry', 'index set aside', { root });
    }
    return report;
  }

  /** The stored entries of a root, as they are; a root that cannot be read lists its last entries as missing. */
  private async storedOf(root: string): Promise<readonly StoredEntry[]> {
    let isFolder = false;
    try {
      isFolder = (await lstat(root)).isDirectory();
    } catch {
      isFolder = false;
    }
    if (!isFolder) {
      return [];
    }
    return (await readIndex(root, false)).entries;
  }

  /** The newest run of each workflow name that only one entry of the root has (spec C-06). */
  private async lastRuns(root: string, entries: readonly StoredEntry[]): Promise<Map<string, RunSummary>> {
    const names = new Map<string, number>();
    for (const entry of entries) {
      if (entry.workflowName !== null) {
        names.set(entry.workflowName, (names.get(entry.workflowName) ?? 0) + 1);
      }
    }
    let runs: readonly RunSummary[] = [];
    try {
      runs = await new TraceReader(join(root, '.indaba', 'traces')).listRuns();
    } catch {
      runs = [];
    }
    const found = new Map<string, RunSummary>();
    for (const run of runs) {
      if (run.workflow !== undefined && names.get(run.workflow) === 1 && !found.has(run.workflow)) {
        found.set(run.workflow, run);
      }
    }
    return found;
  }

  async list(options: { readonly includeHidden?: boolean } = {}): Promise<readonly RegistryEntry[]> {
    const all: RegistryEntry[] = [];
    for (const root of this.options.roots) {
      const entries = await this.storedOf(root);
      const runs = await this.lastRuns(root, entries);
      for (const stored of entries) {
        if (stored.hidden && options.includeHidden !== true) {
          continue;
        }
        const run = stored.workflowName === null ? undefined : runs.get(stored.workflowName);
        all.push(this.entryOf(root, stored, run));
      }
    }
    return all;
  }

  async get(idOrPrefix: string): Promise<RegistryEntry | undefined> {
    return (await this.find(idOrPrefix, false))?.entry;
  }

  /** The entry an id or the start of one names, with its root's stored list. */
  private async find(
    idOrPrefix: string,
    required: boolean,
  ): Promise<{ readonly entry: RegistryEntry; readonly root: string } | undefined> {
    const wanted = idOrPrefix.trim().toLowerCase();
    const all = wanted === '' ? [] : await this.list({ includeHidden: true });
    const exact = all.find((e) => e.id === wanted);
    const matches = exact === undefined ? all.filter((e) => e.id.startsWith(wanted)) : [exact];
    if (matches.length > 1) {
      throw new RegistryError(
        'ambiguous',
        `${matches.length} entries begin with ${JSON.stringify(oneLine(idOrPrefix))}`,
        matches.map((e) => e.id),
      );
    }
    const entry = matches[0];
    if (entry === undefined) {
      if (required) {
        throw new RegistryError('not_found', `no entry has the id ${JSON.stringify(oneLine(idOrPrefix))}`);
      }
      return undefined;
    }
    return { entry, root: entry.root };
  }

  /** Changes one stored entry of a root and writes the index. */
  private async update(root: string, id: string, change: (entry: StoredEntry) => StoredEntry | undefined) {
    const { entries } = await readIndex(root, true);
    const next: StoredEntry[] = [];
    let result: StoredEntry | undefined;
    for (const entry of entries) {
      if (entry.id === id) {
        result = change(entry);
        if (result !== undefined) {
          next.push(result);
        }
      } else {
        next.push(entry);
      }
    }
    await writeIndex(root, next);
    return result;
  }

  async annotate(idOrPrefix: string, annotation: RegistryAnnotation): Promise<RegistryEntry> {
    const found = await this.find(idOrPrefix, true);
    if (found === undefined) {
      throw new RegistryError('not_found', 'no entry has this id');
    }
    const value = (given: string | null | undefined, current: string | null): string | null => {
      if (given === undefined) {
        return current;
      }
      const clean = given === null ? '' : oneLine(given).slice(0, 120);
      return clean === '' ? null : clean;
    };
    const stored = await this.update(found.root, found.entry.id, (entry) => ({
      ...entry,
      name: value(annotation.name, entry.name),
      project: value(annotation.project, entry.project),
      tags: annotation.tags === undefined ? entry.tags : tagsOf(annotation.tags),
      hidden: annotation.hidden ?? entry.hidden,
    }));
    if (stored === undefined) {
      throw new RegistryError('not_found', 'the entry is no longer in the list');
    }
    return this.entryOf(found.root, stored, found.entry.lastRun);
  }

  async remove(idOrPrefix: string): Promise<void> {
    const found = await this.find(idOrPrefix, true);
    if (found === undefined) {
      throw new RegistryError('not_found', 'no entry has this id');
    }
    const { entry, root } = found;
    const file = join(root, ...entry.path.split('/'));
    const there = (await regularFileSize(file)) !== undefined && (await isInside(root, file));
    if (there && scanFinds(entry.path)) {
      throw new RegistryError(
        'would_return',
        'the next scan would list this file again; hide it instead, or move the file out of the project',
      );
    }
    await this.update(root, entry.id, () => undefined);
  }

  /** The root a path belongs to, by resolved paths: the path is the root itself or inside it. */
  private async rootOf(
    path: string,
    folder: boolean,
  ): Promise<{ root: string; relative: string } | undefined> {
    let real: string;
    try {
      real = await realpath(path);
    } catch {
      return undefined;
    }
    for (const root of this.options.roots) {
      let realRoot: string;
      try {
        realRoot = await realpath(root);
      } catch {
        continue;
      }
      const rel = relative(realRoot, real);
      if ((rel === '' && folder) || (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel))) {
        return { root, relative: posixPath(rel) };
      }
    }
    return undefined;
  }

  async add(file: string): Promise<RegistryEntry> {
    const place = await this.rootOf(file, false);
    if (place === undefined) {
      throw new RegistryError('outside_roots', 'the file is not inside a root of the registry');
    }
    const { root, relative: path } = place;
    const size = await regularFileSize(join(root, ...path.split('/')));
    if (size === undefined) {
      throw new RegistryError('not_a_workflow', 'it is not a regular file');
    }
    const { entries } = await readIndex(root, true);
    const existing = entries.find((e) => e.path === path);
    if (existing !== undefined) {
      return this.entryOf(root, existing, undefined);
    }
    const read = await this.readOne(root, path);
    if (read === undefined) {
      throw new RegistryError('not_a_workflow', 'the file could not be read');
    }
    const entry = this.stored(path, read, scanFinds(path) ? 'scanned' : 'added');
    await writeIndex(
      root,
      [...entries, entry].sort((a, b) => (a.path < b.path ? -1 : 1)),
    );
    return this.entryOf(root, entry, undefined);
  }

  async copy(
    idOrPrefix: string,
    to: { readonly folder: string; readonly name?: string },
  ): Promise<RegistryCopy> {
    const found = await this.find(idOrPrefix, true);
    if (found === undefined) {
      throw new RegistryError('not_found', 'no entry has this id');
    }
    const source = found.entry;
    const name = to.name ?? fileStem(source.path);
    if (!SAFE_NAME.test(name)) {
      throw new RegistryError(
        'not_a_workflow',
        'a name is letters, digits, ".", "-" and "_", starting with a letter or a digit',
      );
    }
    const place = await this.rootOf(to.folder, true);
    if (place === undefined) {
      throw new RegistryError(
        'outside_roots',
        'the folder does not exist or is not inside a root of the registry',
      );
    }
    if (
      place.relative
        .split('/')
        .some((part) => part === '.indaba' || part === '.git' || part === 'node_modules')
    ) {
      throw new RegistryError('outside_roots', 'a copy does not go under .indaba, .git or node_modules');
    }
    let bytes: Buffer;
    try {
      bytes = await readWorkflowFile(source.root, join(source.root, ...source.path.split('/')));
    } catch {
      throw new RegistryError('not_found', 'the file of this entry cannot be read');
    }
    const fileName = `${name}.workflow.ai.yml`;
    const path = place.relative === '' ? fileName : `${place.relative}/${fileName}`;
    const target = join(place.root, ...path.split('/'));
    try {
      await writeFile(target, bytes, { flag: 'wx' });
    } catch (error) {
      if ((error as { code?: unknown }).code === 'EEXIST') {
        throw new RegistryError('exists', `${path} exists; it is not overwritten`);
      }
      throw new RegistryError('store_failed', 'the copy could not be written');
    }
    const read = await this.readOne(place.root, path);
    if (read === undefined) {
      throw new RegistryError('store_failed', 'the copy could not be read back');
    }
    const { entries } = await readIndex(place.root, true);
    const entry = this.stored(path, read, 'copied', source.id);
    await writeIndex(
      place.root,
      [...entries.filter((e) => e.path !== path), entry].sort((a, b) => (a.path < b.path ? -1 : 1)),
    );
    this.log.info('engine.registry', 'entry copied', { from: source.id, to: entry.id });
    return {
      entry: this.entryOf(place.root, entry, undefined),
      toReview: placesToReview(bytes.toString('utf8')),
    };
  }
}
