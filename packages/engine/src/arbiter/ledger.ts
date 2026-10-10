import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { IndabaError, type Verdict } from '@indaba/core';
import { Git } from '../workspace/git.js';

/** Where the ledger lives, relative to the project. It is committed, unlike `.indaba/`. */
export const LEDGER_DIRECTORY = '.indaba-decisions';

/** Indaba's own runtime state. Neither it nor the ledger makes a checkout "dirty" or changes its fingerprint. */
const OWN_DIRECTORIES = ['.indaba', LEDGER_DIRECTORY] as const;

export interface LedgerEntry {
  /** Absent when the checkout could not be fingerprinted: the ruling is history, never reused. */
  readonly key?: string;
  readonly workflow: string;
  readonly stepId: string;
  /** The name of the adjudicator that ruled. */
  readonly kind: string;
  readonly verdict: Verdict;
  readonly note: string;
  readonly outcome: string;
  readonly rounds: number;
  /** `HEAD` when the ruling was made. Informational: the key does not depend on it. */
  readonly commit?: string;
  readonly decidedAt: string;
}

/** Whether a ruling may be looked up for this question, and under which key. */
export type MemoKey = { readonly key: string; readonly commit: string } | { readonly skipped: string };

export interface DecisionLedgerOptions {
  readonly git?: Git;
}

/**
 * The committed files outside Indaba's own directories. `ls-tree -z` prints `<mode> <type> <sha> TAB <path>` separated by NUL;
 * it takes no exclusion pathspec, so the filter is applied here.
 */
function ownFilesDropped(listing: string): string {
  return listing
    .split(String.fromCharCode(0))
    .filter((record) => {
      const path = record.slice(record.indexOf(String.fromCharCode(9)) + 1);
      return record !== '' && !OWN_DIRECTORIES.some((dir) => path.startsWith(`${dir}/`));
    })
    .join(String.fromCharCode(0));
}

function fileNameOf(workflow: string): string {
  const safe = workflow.replace(/[^A-Za-z0-9_-]/g, '_');
  return `${safe === '' ? 'workflow' : safe}.jsonl`;
}

/** Length-prefixed, so no field can spill into its neighbour. */
function digest(parts: readonly string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(`${Buffer.byteLength(part)}:`);
    hash.update(part);
  }
  return hash.digest('hex');
}

function isVerdict(value: unknown): value is Verdict {
  return value === 'accept' || value === 'reject';
}

function parseEntry(line: string, where: string): LedgerEntry {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    throw new IndabaError(`${where} is not valid JSON.`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new IndabaError(`${where} is not an object.`);
  }
  const text = (name: string): string | undefined => {
    const value: unknown = Reflect.get(raw, name);
    return typeof value === 'string' ? value : undefined;
  };
  const verdict: unknown = Reflect.get(raw, 'verdict');
  const rounds: unknown = Reflect.get(raw, 'rounds');
  const workflow = text('workflow');
  const stepId = text('stepId');
  const kind = text('kind');
  const note = text('note');
  const outcome = text('outcome');
  const decidedAt = text('decidedAt');
  if (
    workflow === undefined ||
    stepId === undefined ||
    kind === undefined ||
    note === undefined ||
    outcome === undefined ||
    decidedAt === undefined ||
    !isVerdict(verdict) ||
    typeof rounds !== 'number'
  ) {
    throw new IndabaError(`${where} does not have the shape of a ruling.`);
  }
  const key = text('key');
  const commit = text('commit');
  return {
    ...(key !== undefined ? { key } : {}),
    workflow,
    stepId,
    kind,
    verdict,
    note,
    outcome,
    rounds,
    ...(commit !== undefined ? { commit } : {}),
    decidedAt,
  };
}

/**
 * The rulings of a project's arbiters, one JSON object per line, appended and never rewritten. It is committed
 * with the project so decisions can be reviewed, and it lets an identical question on identical code be answered
 * from what was decided before.
 */
export class DecisionLedger {
  private readonly git: Git;

  constructor(
    private readonly projectDir: string,
    options: DecisionLedgerOptions = {},
  ) {
    this.git = options.git ?? new Git();
  }

  pathOf(workflow: string): string {
    return join(this.projectDir, LEDGER_DIRECTORY, fileNameOf(workflow));
  }

  /**
   * The key of a question, or why there is none. The key covers the workflow, the step, the question and every
   * committed file outside Indaba's own directories, so any change to the code is a different question. A
   * checkout with uncommitted changes, or no git, has no key: what is being judged is not fixed.
   */
  async memoKey(workflow: string, stepId: string, topic: string): Promise<MemoKey> {
    const excludes = OWN_DIRECTORIES.map((dir) => `:(exclude)${dir}`);
    try {
      const dirty = await this.git.run(['status', '--porcelain', '--', '.', ...excludes], this.projectDir);
      if (dirty.trim() !== '') {
        return { skipped: 'the working tree has uncommitted changes' };
      }
      const commit = (await this.git.run(['rev-parse', 'HEAD'], this.projectDir)).trim();
      const listing = ownFilesDropped(await this.git.run(['ls-tree', '-r', '-z', 'HEAD'], this.projectDir));
      return { key: digest([workflow, stepId, topic, listing]), commit };
    } catch {
      return { skipped: 'the project is not a git repository with a commit' };
    }
  }

  /** The newest ruling recorded under `key`. A malformed line anywhere in the file is an error, not a miss. */
  async lookup(workflow: string, key: string): Promise<LedgerEntry | undefined> {
    const entries = await this.read(workflow);
    return entries.findLast((entry) => entry.key === key);
  }

  async append(entry: LedgerEntry): Promise<void> {
    const path = this.pathOf(entry.workflow);
    try {
      await mkdir(join(this.projectDir, LEDGER_DIRECTORY), { recursive: true });
      // One whole line in one write, so an interrupted run cannot leave half an entry that still parses.
      await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new IndabaError(`Could not write the decision ledger ${path}: ${reason}`, { cause: error });
    }
  }

  private async read(workflow: string): Promise<readonly LedgerEntry[]> {
    const path = this.pathOf(workflow);
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') {
        return [];
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new IndabaError(`Could not read the decision ledger ${path}: ${reason}`, { cause: error });
    }
    const entries: LedgerEntry[] = [];
    for (const [index, line] of text.split('\n').entries()) {
      if (line.trim() !== '') {
        entries.push(parseEntry(line, `Decision ledger ${path}, line ${index + 1}`));
      }
    }
    return entries;
  }
}
