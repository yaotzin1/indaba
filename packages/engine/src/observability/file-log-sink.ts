import { appendFile, mkdir, readdir, realpath, stat, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { IndabaError, type LogLevel, type LogRecord, type LogSink } from '@indaba/core';

export interface FileLogSinkOptions {
  /** The project root the command already confined. A relative `folder` must stay inside it. */
  readonly root: string;
  /**
   * The folder of the files. Relative: resolved against `root` and confined to it. Absolute: accepted, because the only
   * places it can come from are the person's own options and configuration (never a workflow, an agent or a request).
   */
  readonly folder: string;
  readonly maxFileBytes: number;
  readonly maxFiles: number;
  readonly level?: LogLevel;
  /** Told once, when the folder cannot be created or written. The sink is off from then on. */
  readonly onError?: (folder: string, error: unknown) => void;
}

/** `indaba-<yyyy-mm-dd>.log.jsonl`, then `indaba-<yyyy-mm-dd>.<n>.log.jsonl` once a day's file is full. */
const FILE_NAME = /^indaba-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.log\.jsonl$/;
const DAY = /^(\d{4}-\d{2}-\d{2})T/;

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function fileName(day: string, index: number): string {
  return index === 0 ? `indaba-${day}.log.jsonl` : `indaba-${day}.${index}.log.jsonl`;
}

async function sizeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

/**
 * Writes one JSON record per line to `<folder>/indaba-<date>.log.jsonl` (specs/logging, AC-06). The date comes from the
 * record's time, which the logger took from the injected clock; nothing in a path comes from input. A file that would
 * pass `maxFileBytes` is closed and the next one started; beyond `maxFiles`, the oldest of the sink's own files are
 * deleted. Every record is one append of a whole line, so two processes writing the same file interleave lines but never
 * cut one. `write` never throws and never waits: records are appended in order in the background, and `flush` waits for
 * them.
 */
export class FileLogSink implements LogSink {
  readonly level?: LogLevel;
  /** The folder in use, resolved. */
  readonly folder: string;
  private readonly root: string;
  private readonly confined: boolean;
  private readonly maxFileBytes: number;
  private readonly maxFiles: number;
  private readonly onError: ((folder: string, error: unknown) => void) | undefined;
  private pending: Promise<void> = Promise.resolve();
  private stopped = false;
  private ready = false;
  private day: string | undefined;
  private index = 0;
  private bytes = 0;

  constructor(options: FileLogSinkOptions) {
    if (!Number.isInteger(options.maxFileBytes) || options.maxFileBytes < 1) {
      throw new IndabaError('maxFileBytes must be a whole number of at least 1.');
    }
    if (!Number.isInteger(options.maxFiles) || options.maxFiles < 1) {
      throw new IndabaError('maxFiles must be a whole number of at least 1.');
    }
    if (options.folder.trim() === '' || /[\0\r\n]/.test(options.folder)) {
      throw new IndabaError('The log folder must be a folder path.');
    }
    this.root = resolve(options.root);
    this.confined = !isAbsolute(options.folder);
    this.folder = resolve(this.root, options.folder);
    if (this.confined && !isInside(this.root, this.folder)) {
      throw new IndabaError('A relative log folder must stay inside the project.');
    }
    this.maxFileBytes = options.maxFileBytes;
    this.maxFiles = options.maxFiles;
    this.onError = options.onError;
    if (options.level !== undefined) {
      this.level = options.level;
    }
  }

  write(record: LogRecord): void {
    if (this.stopped) {
      return;
    }
    const line = `${JSON.stringify(record)}\n`;
    this.pending = this.pending.then(() => this.append(record, line));
  }

  flush(): Promise<void> {
    return this.pending;
  }

  private async append(record: LogRecord, line: string): Promise<void> {
    if (this.stopped) {
      return;
    }
    try {
      await this.prepare();
      const day = record.time.match(DAY)?.[1] ?? this.day ?? 'undated';
      const size = Buffer.byteLength(line);
      if (day !== this.day) {
        await this.open(day, 0);
      } else if (this.bytes > 0 && this.bytes + size > this.maxFileBytes) {
        await this.open(day, this.index + 1);
      }
      await appendFile(join(this.folder, fileName(day, this.index)), line);
      this.bytes += size;
    } catch (error) {
      this.stopped = true;
      try {
        this.onError?.(this.folder, error);
      } catch {
        // The one who was told could not hear it; the run must not hear about it either (AC-11).
      }
    }
  }

  /** Creates the folder once and checks that a relative one did not leave the project through a link. */
  private async prepare(): Promise<void> {
    if (this.ready) {
      return;
    }
    await mkdir(this.folder, { recursive: true });
    if (this.confined && !isInside(await realpath(this.root), await realpath(this.folder))) {
      throw new IndabaError('The log folder leaves the project through a link.');
    }
    this.ready = true;
  }

  /** Starts on the first file of `day` from `from` that is not full yet, then keeps only `maxFiles` files. */
  private async open(day: string, from: number): Promise<void> {
    let index = from;
    let bytes = await sizeOf(join(this.folder, fileName(day, index)));
    while (bytes >= this.maxFileBytes) {
      index += 1;
      bytes = await sizeOf(join(this.folder, fileName(day, index)));
    }
    this.day = day;
    this.index = index;
    this.bytes = bytes;
    await this.prune();
  }

  private async prune(): Promise<void> {
    const current = fileName(this.day ?? '', this.index);
    const files = (await readdir(this.folder))
      .map((name) => ({ name, match: name.match(FILE_NAME) }))
      .filter((f): f is { name: string; match: RegExpMatchArray } => f.match !== null)
      .map((f) => ({ name: f.name, day: f.match[1] ?? '', index: Number(f.match[2] ?? '0') }))
      // The file about to be written counts even before it exists.
      .filter((f) => f.name !== current);
    files.push({ name: current, day: this.day ?? '', index: this.index });
    files.sort((a, b) => (a.day === b.day ? a.index - b.index : a.day < b.day ? -1 : 1));
    for (const old of files.slice(0, Math.max(0, files.length - this.maxFiles))) {
      if (old.name !== current) {
        await unlink(join(this.folder, old.name)).catch(() => undefined);
      }
    }
  }
}
