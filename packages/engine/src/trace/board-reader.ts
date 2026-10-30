import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { BOARD_FILE_SUFFIX, type BoardFileRecord, parseBoardRecord } from './board-records.js';
import { isRunId } from './records.js';
import { completeLines, defaultSleep, isMissing, readRange, sizeOf } from './trace-reader.js';

export interface BoardReaderOptions {
  /** How often `follow` looks for new lines. */
  readonly pollMs?: number;
  /** Replaces the wait between polls; resolves early when the signal aborts. Tests inject one. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const DEFAULT_POLL_MS = 100;

/**
 * Reads and follows a run's board file (specs/run-blackboard/data-model.md). No UI imports: `watch --plain`, the
 * terminal UI and the later web view all read through it. A line it does not know becomes an `unknown` record, and
 * a half-written last line waits until it is complete.
 */
export class BoardReader {
  private readonly pollMs: number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(
    private readonly directory: string,
    options: BoardReaderOptions = {},
  ) {
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    this.sleep = options.sleep ?? defaultSleep;
  }

  private file(runId: string): string {
    if (!isRunId(runId)) {
      throw new RangeError('A run id is lowercase hexadecimal.');
    }
    return join(this.directory, `${runId}${BOARD_FILE_SUFFIX}`);
  }

  /** Whether the run has a board file. A run that never posted and never read has none. */
  async exists(runId: string): Promise<boolean> {
    return (await sizeOf(this.file(runId))) !== undefined;
  }

  /** Every complete line written so far; none for a run with no file. */
  async readAll(runId: string): Promise<BoardFileRecord[]> {
    const file = this.file(runId);
    try {
      return completeLines(await readFile(file, 'utf8')).map(parseBoardRecord);
    } catch (error) {
      if (isMissing(error)) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Records as they are written, from the first one, until the signal aborts: a board has no end marker of its own,
   * so whoever follows it also follows the run and stops it. A file that does not exist yet is waited for.
   */
  async *follow(runId: string, signal: AbortSignal): AsyncGenerator<BoardFileRecord> {
    const file = this.file(runId);
    const decoder = new StringDecoder('utf8');
    let offset = 0;
    let tail = '';

    while (!signal.aborted) {
      const size = await sizeOf(file);
      if (size !== undefined && size < offset) {
        offset = 0; // the file was replaced by a shorter one: start over
        tail = '';
      }
      if (size !== undefined && size > offset) {
        const chunk = await readRange(file, offset, size);
        offset = size;
        const lines = (tail + decoder.write(chunk)).split('\n');
        tail = lines.pop() ?? '';
        for (const line of lines) {
          if (line !== '') {
            yield parseBoardRecord(line);
          }
        }
        continue; // more may have arrived while this was read
      }
      await this.sleep(this.pollMs, signal);
    }
  }
}
