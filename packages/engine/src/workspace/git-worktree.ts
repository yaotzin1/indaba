import { access, readFile, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { WorkspaceError } from '@indaba/core';
import type { Git } from './git.js';
import type {
  ConflictHunk,
  ForkableWorkspace,
  LandResult,
  RestorableWorkspace,
  Workspace,
  WorkspaceCheckpoint,
} from './workspace.js';

/** How teardown copes with a folder that something still holds open (common on Windows). */
export interface TeardownOptions {
  /** Tries of `git worktree remove` before the folder is deleted directly. At least 1. Default 4. */
  readonly attempts?: number;
  /** Wait before the second try; it doubles each time. Default 250 ms. */
  readonly delayMs?: number;
  /** Injected so a test needs no real wait. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** A full object id: 40 hexadecimal characters (SHA-1) or 64 (SHA-256), lower case. Nothing else reaches a git command. */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

const defaultSleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** Committed on a detached head of a worktree that is removed: no hook runs, nothing reaches a branch. */
const COMMIT_ARGS = [
  '-c',
  'user.name=indaba',
  '-c',
  'user.email=indaba@localhost',
  '-c',
  'commit.gpgsign=false',
  'commit',
  '--no-verify',
  '--allow-empty',
  '-q',
  '-m',
  'indaba fork base',
];
/** Bounds on what a conflict puts in front of an agent: per side of a hunk, hunks per file, files per landing. */
const MAX_SIDE_CHARS = 2_000;
const MAX_HUNKS_PER_FILE = 20;
const MAX_CONFLICT_FILES = 50;

export class GitWorktree implements RestorableWorkspace, ForkableWorkspace {
  private destroyed = false;
  private landings = 0;

  constructor(
    private readonly projectDir: string,
    private readonly worktreePath: string,
    private readonly git: Git,
    private readonly teardown: TeardownOptions = {},
  ) {}

  path(): string {
    return this.worktreePath;
  }

  async diff(): Promise<string> {
    if (this.destroyed) {
      throw new WorkspaceError('The workspace has been destroyed.');
    }
    // Stage everything (a worktree's index is private to it) so new files are included.
    // .indaba holds runtime state, never part of a change.
    await this.git.run(['add', '-A', '--', '.', ':(exclude).indaba'], this.worktreePath);
    return await this.git.run(['diff', '--cached', '--binary', 'HEAD'], this.worktreePath);
  }

  /**
   * Records the commit and a tree object holding every file now in the worktree, tracked or not (ignored files and `.indaba`
   * excluded), so a later `restore` can put back exactly this, including what earlier steps wrote and nobody committed.
   * Staging is the worktree's own private index, as `diff()` already does.
   */
  async checkpoint(): Promise<WorkspaceCheckpoint> {
    this.assertLive();
    const head = (await this.git.run(['rev-parse', '--verify', 'HEAD'], this.worktreePath)).trim();
    await this.stageAll();
    const tree = (await this.git.run(['write-tree'], this.worktreePath)).trim();
    return { head, tree };
  }

  /**
   * HEAD goes back to where it was (an attempt may have committed), everything the attempt created, changed or deleted is
   * staged so nothing is overlooked, and the index and the files become the checkpoint's tree. Both values are checked
   * against the shape of an object id before they reach git, which then gets them as arguments, never as a shell string.
   */
  async restore(checkpoint: WorkspaceCheckpoint): Promise<void> {
    this.assertLive();
    const { head, tree } = checkpoint;
    if (head === undefined || tree === undefined || !OBJECT_ID.test(head) || !OBJECT_ID.test(tree)) {
      throw new WorkspaceError('The checkpoint is not one this workspace made.');
    }
    await this.git.run(['reset', '--soft', head, '--'], this.worktreePath);
    await this.stageAll();
    await this.git.run(['read-tree', '--reset', '-u', tree], this.worktreePath);
  }

  /**
   * A worktree at this one's `HEAD` carrying this one's current change as a commit, so the fork's own `diff()` is only what
   * its step changes. The directory is `<this>-<name>` beside this one, which is inside the confined worktree root.
   */
  async fork(name: string): Promise<Workspace> {
    this.assertLive();
    if (!SAFE_NAME.test(name) || name.includes('..')) {
      throw new WorkspaceError(`Unsafe fork name "${name}".`);
    }
    const root = dirname(this.worktreePath);
    const path = join(root, `${basename(this.worktreePath)}-${name}`);
    const rel = relative(root, resolve(path));
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new WorkspaceError(`Unsafe fork name "${name}".`);
    }
    if (await pathExists(path)) {
      throw new WorkspaceError(`Worktree path already exists: ${path}`);
    }
    const change = await this.diff();
    const head = (await this.git.run(['rev-parse', '--verify', 'HEAD'], this.worktreePath)).trim();
    await this.git.run(['worktree', 'add', '--detach', path, head], this.projectDir);
    const child = new GitWorktree(this.projectDir, path, this.git, this.teardown);
    try {
      if (change.trim() !== '') {
        await this.git.run(['apply', '--binary', '--index', '-'], path, { stdin: change });
      }
      await this.git.run([...COMMIT_ARGS], path);
    } catch (error) {
      await child.destroy().catch(() => undefined);
      throw error;
    }
    return child;
  }

  /**
   * Three-way applies the child's change in a fresh fork of this workspace. Clean: the result lands here and the fork is
   * removed. Conflicted: this workspace is untouched and the fork, which holds both sides, goes back to the caller. The
   * caller serialises landings; nothing else changes this workspace while one runs.
   */
  async land(child: Workspace): Promise<LandResult> {
    this.assertLive();
    const change = await child.diff();
    if (change.trim() === '') {
      return { ok: true };
    }
    this.landings += 1;
    const landing = await this.fork(`land-${this.landings}`);
    try {
      let unmerged: readonly string[] = [];
      try {
        await this.git.run(['apply', '--3way', '--index', '--binary', '-'], landing.path(), {
          stdin: change,
        });
      } catch (error) {
        unmerged = await this.unmerged(landing.path());
        if (unmerged.length === 0) {
          throw error;
        }
      }
      if (unmerged.length === 0) {
        const merged = await landing.diff();
        await this.stageAll();
        if (merged.trim() !== '') {
          await this.git.run(['apply', '--binary', '--index', '-'], this.worktreePath, { stdin: merged });
        }
        await landing.destroy();
        return { ok: true };
      }
      return { ok: false, conflicts: await conflictHunks(landing.path(), unmerged), workspace: landing };
    } catch (error) {
      await landing.destroy().catch(() => undefined);
      throw error;
    }
  }

  private async unmerged(cwd: string): Promise<readonly string[]> {
    const out = await this.git.run(['diff', '--name-only', '--diff-filter=U', '-z'], cwd);
    return out.split('\0').filter((entry) => entry !== '');
  }

  private assertLive(): void {
    if (this.destroyed) {
      throw new WorkspaceError('The workspace has been destroyed.');
    }
  }

  /** .indaba holds runtime state, never part of a change or of a restore. */
  private async stageAll(): Promise<void> {
    await this.git.run(['add', '-A', '--', '.', ':(exclude).indaba'], this.worktreePath);
  }

  /**
   * Removes the worktree. A handle another process still holds can make `git worktree remove` fail for a moment, so it
   * is tried a few times with a growing wait. If it keeps failing, the folder (which this class created, under the
   * confined worktree root) is deleted directly and the registration pruned. Only when that fails too does it throw.
   */
  async destroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    const attempts = Math.max(1, this.teardown.attempts ?? 4);
    const sleep = this.teardown.sleep ?? defaultSleep;
    let wait = this.teardown.delayMs ?? 250;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await this.git.run(['worktree', 'remove', '--force', this.worktreePath], this.projectDir);
        await this.git.run(['worktree', 'prune'], this.projectDir);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          await sleep(wait);
          wait *= 2;
        }
      }
    }
    try {
      await rm(this.worktreePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      await this.git.run(['worktree', 'prune'], this.projectDir);
    } catch {
      // Report the git failure, which names the folder and says why; the second error adds nothing.
      throw lastError instanceof Error
        ? lastError
        : new WorkspaceError('The workspace could not be removed.');
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Text from a file git or an agent wrote: control characters out (newline and tab stay), cut to the bound. */
function clean(text: string): string {
  let plain = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const control = code < 0x20 ? code !== 0x09 && code !== 0x0a : code === 0x7f;
    if (!control) {
      plain += char;
    }
  }
  return plain.length > MAX_SIDE_CHARS ? `${plain.slice(0, MAX_SIDE_CHARS)}\n[cut]` : plain;
}

function shownPath(rel: string): string {
  return rel.split('\\').join('/');
}

/**
 * The conflicted regions of the landing worktree's files. A path that would leave the worktree is skipped, a binary file
 * is named without its content, and the sizes are bounded so a large conflict cannot flood a prompt.
 */
async function conflictHunks(root: string, paths: readonly string[]): Promise<readonly ConflictHunk[]> {
  const hunks: ConflictHunk[] = [];
  for (const path of paths.slice(0, MAX_CONFLICT_FILES)) {
    const full = resolve(root, path);
    const rel = relative(root, full);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      continue;
    }
    const shown = shownPath(rel);
    let text: string;
    try {
      text = await readFile(full, 'utf8');
    } catch {
      hunks.push({ path: shown, ours: '[unreadable]', theirs: '[unreadable]' });
      continue;
    }
    if (text.includes('\0')) {
      hunks.push({ path: shown, ours: '[binary file]', theirs: '[binary file]' });
      continue;
    }
    const found = parseMarkers(text).slice(0, MAX_HUNKS_PER_FILE);
    if (found.length === 0) {
      hunks.push({ path: shown, ours: '[changed on both sides]', theirs: '[changed on both sides]' });
    }
    for (const hunk of found) {
      hunks.push({ path: shown, ours: clean(hunk.ours), theirs: clean(hunk.theirs) });
    }
  }
  return hunks;
}

function parseMarkers(text: string): readonly { readonly ours: string; readonly theirs: string }[] {
  const found: { ours: string; theirs: string }[] = [];
  let side: 'none' | 'ours' | 'theirs' = 'none';
  let ours: string[] = [];
  let theirs: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('<<<<<<< ')) {
      side = 'ours';
      ours = [];
      theirs = [];
    } else if (side === 'ours' && line.startsWith('=======')) {
      side = 'theirs';
    } else if (side === 'theirs' && line.startsWith('>>>>>>> ')) {
      found.push({ ours: ours.join('\n'), theirs: theirs.join('\n') });
      side = 'none';
    } else if (side === 'ours') {
      ours.push(line);
    } else if (side === 'theirs') {
      theirs.push(line);
    }
  }
  return found;
}
