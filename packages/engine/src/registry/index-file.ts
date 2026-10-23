import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RegistryError, type RegistryOrigin, type RegistryValidation } from '@indaba/core';

/**
 * The index of one root (specs/workflow-registry, AC-03): a cache of the folder plus the person's annotations, at
 * `.indaba/registry/index.json`, written whole and renamed into place. Only `FileWorkflowRegistry` reads it.
 */

/** Where a root's index is, relative to the root. */
export const REGISTRY_INDEX = '.indaba/registry/index.json';
/** The version of the index's shape; another one is read as unreadable and set aside. */
const INDEX_VERSION = 1;

export interface StoredEntry {
  readonly id: string;
  readonly path: string;
  readonly origin: RegistryOrigin;
  readonly copiedFrom?: string;
  readonly hash: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly readAt: string;
  /** The workflow's own `name`, when it parsed. */
  readonly workflowName: string | null;
  readonly validation: RegistryValidation;
  /** The person's values; `null` when not set. */
  readonly name: string | null;
  readonly project: string | null;
  readonly tags: readonly string[];
  readonly hidden: boolean;
}

const ID = /^[0-9a-f]{16}$/;
const HASH = /^(?:[0-9a-f]{64})?$/;
const ORIGINS: readonly RegistryOrigin[] = ['scanned', 'added', 'created', 'copied'];
const isOrigin = (value: unknown): value is RegistryOrigin => ORIGINS.some((o) => o === value);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isStringOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

/** A relative path with `/` separators that stays inside its root. */
export function isSafeRelative(path: string): boolean {
  return (
    path !== '' &&
    !path.startsWith('/') &&
    !/^[A-Za-z]:/.test(path) &&
    !path.includes('\\') &&
    !path.split('/').some((part) => part === '' || part === '.' || part === '..')
  );
}

function validationOf(value: unknown): RegistryValidation | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (value.state === 'valid') {
    return { state: 'valid' };
  }
  if (value.state === 'invalid' && typeof value.message === 'string') {
    return { state: 'invalid', message: value.message };
  }
  if (value.state === 'missing' && typeof value.reason === 'string') {
    return { state: 'missing', reason: value.reason };
  }
  return undefined;
}

/** One entry as written, or undefined when a field is missing or of the wrong type (the next scan finds it again). */
export function storedEntryOf(value: unknown): StoredEntry | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const {
    id,
    path,
    origin,
    copiedFrom,
    hash,
    size,
    mtimeMs,
    readAt,
    workflowName,
    name,
    project,
    tags,
    hidden,
  } = value;
  const validation = validationOf(value.validation);
  if (
    typeof id !== 'string' ||
    !ID.test(id) ||
    typeof path !== 'string' ||
    !isSafeRelative(path) ||
    !isOrigin(origin) ||
    (copiedFrom !== undefined && (typeof copiedFrom !== 'string' || !ID.test(copiedFrom))) ||
    typeof hash !== 'string' ||
    !HASH.test(hash) ||
    typeof size !== 'number' ||
    typeof mtimeMs !== 'number' ||
    typeof readAt !== 'string' ||
    !isStringOrNull(workflowName) ||
    !isStringOrNull(name) ||
    !isStringOrNull(project) ||
    !Array.isArray(tags) ||
    !tags.every((t) => typeof t === 'string') ||
    typeof hidden !== 'boolean' ||
    validation === undefined
  ) {
    return undefined;
  }
  return {
    id,
    path,
    origin,
    ...(copiedFrom === undefined ? {} : { copiedFrom }),
    hash,
    size,
    mtimeMs,
    readAt,
    workflowName,
    validation,
    name,
    project,
    tags: tags.filter((t): t is string => typeof t === 'string'),
    hidden,
  };
}

/** Whether a path is a folder that is not a link, or nothing yet; a link would steer a write out of the root. */
async function folderOrAbsent(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    return info.isDirectory() && !info.isSymbolicLink();
  } catch {
    return true;
  }
}

/** The folders of the index, refused when one is a link or a file (a write must not leave the root). */
async function indexFolders(root: string): Promise<{ readonly folder: string; readonly file: string }> {
  const indaba = join(root, '.indaba');
  const folder = join(indaba, 'registry');
  if (!(await folderOrAbsent(indaba)) || !(await folderOrAbsent(folder))) {
    throw new RegistryError(
      'store_failed',
      'the folder of the registry is a link or a file, so it is not written',
    );
  }
  return { folder, file: join(folder, 'index.json') };
}

export interface ReadIndex {
  readonly entries: readonly StoredEntry[];
  /** The file could not be read; with `recover`, it was set aside as `index.json.bak`. */
  readonly recovered: boolean;
}

/**
 * The entries of a root's index. A file that is not one (corrupt, truncated, another version) reads as empty; with
 * `recover` it is set aside first, so the next write does not destroy what a person might want back.
 */
export async function readIndex(root: string, recover: boolean): Promise<ReadIndex> {
  const { file } = await indexFolders(root);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return { entries: [], recovered: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (!isRecord(parsed) || parsed.registry !== INDEX_VERSION || !Array.isArray(parsed.entries)) {
    if (recover) {
      await rename(file, `${file}.bak`).catch(() => undefined);
    }
    return { entries: [], recovered: true };
  }
  const seen = new Set<string>();
  const entries: StoredEntry[] = [];
  for (const raw of parsed.entries) {
    const entry = storedEntryOf(raw);
    // A second entry with an id or a path already seen is dropped: an index is one list.
    if (entry !== undefined && !seen.has(entry.id) && !seen.has(`path:${entry.path}`)) {
      seen.add(entry.id);
      seen.add(`path:${entry.path}`);
      entries.push(entry);
    }
  }
  return { entries, recovered: false };
}

let writes = 0;

/** Writes a root's index whole: a new temporary file beside it (`wx`), then a rename, and the `.gitignore` once. */
export async function writeIndex(root: string, entries: readonly StoredEntry[]): Promise<void> {
  const { folder, file } = await indexFolders(root);
  try {
    await mkdir(folder, { recursive: true });
    // The registry stays on the machine (spec C-02), also in a project that does not ignore `.indaba/`.
    await writeFile(join(folder, '.gitignore'), '*\n', { flag: 'wx' }).catch((error: unknown) => {
      if ((error as { code?: unknown }).code !== 'EEXIST') {
        throw error;
      }
    });
  } catch {
    throw new RegistryError('store_failed', 'the folder of the registry could not be written');
  }
  writes += 1;
  const temporary = `${file}.${process.pid}.${writes}.tmp`;
  const body = `${JSON.stringify({ registry: INDEX_VERSION, entries }, null, 2)}\n`;
  try {
    await writeFile(temporary, body, { flag: 'wx' });
    await rename(temporary, file);
  } catch {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw new RegistryError('store_failed', 'the index of the registry could not be written');
  }
}
