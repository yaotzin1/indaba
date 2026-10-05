import { lstat, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { matchesAny, PermissionMode, type StepPermissions } from '@indaba/core';
import { AcpRpcError, INVALID_PARAMS } from './acp-connection.js';

export type PermissionDecision = 'allowed' | 'rejected';

export interface PermissionOption {
  readonly optionId: string;
  readonly kind: string;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PATH_LENGTH = 4096;
/** Never served, to or from: a hook planted in `.git` runs code outside the step's scope. */
const FORBIDDEN_SEGMENTS = new Set(['.git', '.indaba']);

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** A path as it appears to a glob: relative to the working directory, `/` separated. Undefined if outside it. */
export function relativeToWorkdir(workdir: string, path: string): string | undefined {
  const absolute = isAbsolute(path) ? resolve(path) : resolve(workdir, path);
  if (!isInside(workdir, absolute)) {
    return undefined;
  }
  return relative(workdir, absolute).replaceAll('\\', '/');
}

function allInside(
  workdir: string,
  locations: readonly string[] | undefined,
  patterns: readonly string[],
): boolean {
  if (locations === undefined || locations.length === 0) {
    return false; // nothing to check the request against: refused, not assumed fine
  }
  return locations.every((location) => {
    const rel = relativeToWorkdir(workdir, location);
    return rel !== undefined && matchesAny(patterns, rel);
  });
}

/**
 * Whether the agent may do what it asks. Without a `permissions` block anything that changes
 * something (edit, delete, move, execute) is refused; reads, searches, fetches and thinking are not.
 * An empty `fs.read` list leaves reads unrestricted: scope is about what the step may change.
 */
export function decidePermission(
  kind: string,
  locations: readonly string[] | undefined,
  permissions: StepPermissions | undefined,
  workdir: string,
): PermissionDecision {
  switch (kind) {
    case 'edit':
    case 'delete':
    case 'move':
      return permissions !== undefined && allInside(workdir, locations, permissions.fsWrite)
        ? 'allowed'
        : 'rejected';
    case 'execute':
      return permissions?.terminal === PermissionMode.Allow ? 'allowed' : 'rejected';
    case 'read':
      if (permissions === undefined || permissions.fsRead.length === 0) {
        return 'allowed';
      }
      return allInside(workdir, locations, permissions.fsRead) ? 'allowed' : 'rejected';
    case 'search':
    case 'fetch':
    case 'think':
    case 'switch_mode':
    case 'other':
      return 'allowed';
    default:
      return 'rejected';
  }
}

/**
 * The option to select for a decision, or undefined when the agent offered none that is safe, which
 * is answered as cancelled. A `*_always` option is never selected: it would outlive the step.
 */
export function selectOption(
  options: readonly PermissionOption[],
  decision: PermissionDecision,
): string | undefined {
  const wanted = decision === 'allowed' ? 'allow_once' : 'reject_once';
  return options.find((option) => option.kind === wanted)?.optionId;
}

/** Reads the options of a permission request defensively; anything malformed is dropped. */
export function parseOptions(value: unknown): PermissionOption[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const options: PermissionOption[] = [];
  for (const item of value as unknown[]) {
    if (typeof item === 'object' && item !== null && 'optionId' in item && 'kind' in item) {
      const { optionId, kind } = item;
      if (typeof optionId === 'string' && typeof kind === 'string') {
        options.push({ optionId, kind });
      }
    }
  }
  return options;
}

function refuse(message: string): AcpRpcError {
  return new AcpRpcError(INVALID_PARAMS, message);
}

/**
 * Serves the agent's file requests inside the working directory and the step's globs, nothing else.
 * Every path is canonicalised and its symlinks followed before any file is touched.
 */
export class AcpFileServer {
  private constructor(
    private readonly base: string,
    private readonly permissions: StepPermissions,
  ) {}

  static async create(workdir: string, permissions: StepPermissions): Promise<AcpFileServer> {
    return new AcpFileServer(await realpath(workdir), permissions);
  }

  /** Where the path really is, or a refusal. Never returns a path outside the working directory. */
  private async confine(requested: unknown): Promise<{ absolute: string; relativePath: string }> {
    if (typeof requested !== 'string' || requested === '' || requested.length > MAX_PATH_LENGTH) {
      throw refuse('A file path is required.');
    }
    if (requested.includes('\0') || !isAbsolute(requested)) {
      throw refuse('The path must be absolute.');
    }
    const absolute = resolve(requested);
    const relativePath = relative(this.base, absolute);
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw refuse('The path is outside the working directory.');
    }
    const segments = relativePath.split(/[\\/]/).map((s) => s.toLowerCase());
    if (segments.some((s) => FORBIDDEN_SEGMENTS.has(s))) {
      throw refuse('The path is not available to an agent.');
    }

    // The deepest part that exists decides where this really points.
    let existing = absolute;
    for (;;) {
      try {
        if (!isInside(this.base, await realpath(existing))) {
          throw refuse('The path leads outside the working directory.');
        }
        break;
      } catch (error) {
        if (error instanceof AcpRpcError) {
          throw error;
        }
        const parent = dirname(existing);
        if (parent === existing) {
          throw refuse('The path cannot be resolved.');
        }
        existing = parent;
      }
    }
    return { absolute, relativePath: relativePath.replaceAll('\\', '/') };
  }

  async read(params: unknown): Promise<{ content: string }> {
    const p = typeof params === 'object' && params !== null ? params : {};
    const { absolute, relativePath } = await this.confine('path' in p ? p.path : undefined);
    if (this.permissions.fsRead.length > 0 && !matchesAny(this.permissions.fsRead, relativePath)) {
      throw refuse('Reading this path is outside the step scope.');
    }
    let size: number;
    try {
      size = (await stat(absolute)).size;
    } catch {
      throw refuse('The file cannot be read.');
    }
    if (size > MAX_FILE_BYTES) {
      throw refuse('The file is too large.');
    }
    const text = await readFile(absolute, 'utf8').catch(() => {
      throw refuse('The file cannot be read.');
    });
    const line = 'line' in p && typeof p.line === 'number' && p.line >= 1 ? Math.floor(p.line) : undefined;
    const limit =
      'limit' in p && typeof p.limit === 'number' && p.limit >= 0 ? Math.floor(p.limit) : undefined;
    if (line === undefined && limit === undefined) {
      return { content: text };
    }
    const lines = text.split('\n').slice((line ?? 1) - 1);
    return { content: (limit === undefined ? lines : lines.slice(0, limit)).join('\n') };
  }

  async write(params: unknown): Promise<null> {
    const p = typeof params === 'object' && params !== null ? params : {};
    const { absolute, relativePath } = await this.confine('path' in p ? p.path : undefined);
    if (!matchesAny(this.permissions.fsWrite, relativePath)) {
      throw refuse('Writing this path is outside the step scope.');
    }
    const content = 'content' in p ? p.content : undefined;
    if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_FILE_BYTES) {
      throw refuse('The content is missing or too large.');
    }
    // Never write through a link: it could point anywhere the check above did not look.
    try {
      if ((await lstat(absolute)).isSymbolicLink()) {
        throw refuse('The path is a symbolic link.');
      }
    } catch (error) {
      if (error instanceof AcpRpcError) {
        throw error;
      }
    }
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content, 'utf8');
    return null;
  }
}
