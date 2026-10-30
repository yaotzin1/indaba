import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { BoardRecorded } from '@indaba/core';
import { BOARD_FILE_SUFFIX, serializeBoardRecord } from './board-records.js';
import { isRunId } from './records.js';

export interface BoardWriterOptions {
  /** Where `<traceId>.board.jsonl` goes, next to the trace file. */
  readonly directory: string;
  /** Told about the first failure to write, once. The run is never affected by it. */
  readonly onError?: (error: unknown) => void;
}

/**
 * Appends the run board to `<traceId>.board.jsonl` (specs/run-blackboard/data-model.md): register `onRecorded` as a
 * listener of `BoardRecorded`. Every line is written whole, in the order the records arrived, through one queue.
 * The board has already cleaned, redacted and limited what it records, so the writer stores each record as it is.
 * It never throws into the run and never truncates a file.
 */
export class BoardWriter {
  private readonly directory: string;
  private readonly onError: (error: unknown) => void;
  private queue: Promise<void> = Promise.resolve();
  private directoryReady = false;
  private reported = false;

  constructor(options: BoardWriterOptions) {
    this.directory = options.directory;
    this.onError = options.onError ?? (() => undefined);
  }

  onRecorded(event: BoardRecorded): Promise<void> {
    if (!isRunId(event.traceId)) {
      return this.queue; // the id names a file: anything but plain hexadecimal is refused
    }
    let line: string;
    try {
      line = `${serializeBoardRecord(event.record)}\n`;
    } catch (error) {
      this.fail(error);
      return this.queue;
    }
    const file = join(this.directory, `${event.traceId}${BOARD_FILE_SUFFIX}`);
    this.queue = this.queue.then(async () => {
      try {
        if (!this.directoryReady) {
          await mkdir(this.directory, { recursive: true });
          this.directoryReady = true;
        }
        await appendFile(file, line);
      } catch (error) {
        this.fail(error);
      }
    });
    return this.queue;
  }

  /** Resolves when everything handed to the writer so far is on disk (or has failed). */
  flush(): Promise<void> {
    return this.queue;
  }

  private fail(error: unknown): void {
    if (!this.reported) {
      this.reported = true;
      this.onError(error);
    }
  }
}
