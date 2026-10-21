import { mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger, IndabaError, type LogRecord } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { FileLogSink } from '../src/index.js';
import { makeTempDir } from './support.js';

const record = (time: string, message = 'a record', fields?: LogRecord['fields']): LogRecord => ({
  time,
  level: 'info',
  component: 'test',
  message,
  ...(fields === undefined ? {} : { fields }),
});

const DAY_ONE = '2026-10-21T08:00:00.000Z';
const DAY_TWO = '2026-10-22T08:00:00.000Z';

async function lines(path: string): Promise<unknown[]> {
  const text = await readFile(path, 'utf8');
  return text
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line));
}

function sink(
  root: string,
  overrides: Partial<ConstructorParameters<typeof FileLogSink>[0]> = {},
): FileLogSink {
  return new FileLogSink({ root, folder: '.indaba/logs', maxFileBytes: 10_000, maxFiles: 10, ...overrides });
}

describe('FileLogSink', () => {
  it('appends one JSON record per line, in order, to the file of the record date', async () => {
    const root = await makeTempDir();
    const file = sink(root);
    file.write(record(DAY_ONE, 'first', { n: 1 }));
    file.write(record(DAY_ONE, 'second'));
    await file.flush();

    expect(file.folder).toBe(join(root, '.indaba', 'logs'));
    const written = await lines(join(root, '.indaba', 'logs', 'indaba-2026-10-21.log.jsonl'));
    expect(written).toEqual([record(DAY_ONE, 'first', { n: 1 }), record(DAY_ONE, 'second')]);
  });

  it('starts a new file on a new day', async () => {
    const root = await makeTempDir();
    const file = sink(root);
    file.write(record(DAY_ONE));
    file.write(record(DAY_TWO));
    await file.flush();
    expect((await readdir(file.folder)).sort()).toEqual([
      'indaba-2026-10-21.log.jsonl',
      'indaba-2026-10-22.log.jsonl',
    ]);
  });

  it('starts the next file of the day when a record would pass maxFileBytes, never cutting a line', async () => {
    const root = await makeTempDir();
    const one = `${JSON.stringify(record(DAY_ONE))}\n`;
    const file = sink(root, { maxFileBytes: Buffer.byteLength(one) * 2 });
    for (let n = 0; n < 5; n += 1) {
      file.write(record(DAY_ONE));
    }
    await file.flush();

    expect((await readdir(file.folder)).sort()).toEqual([
      'indaba-2026-10-21.1.log.jsonl',
      'indaba-2026-10-21.2.log.jsonl',
      'indaba-2026-10-21.log.jsonl',
    ]);
    expect(await lines(join(file.folder, 'indaba-2026-10-21.log.jsonl'))).toHaveLength(2);
    expect(await lines(join(file.folder, 'indaba-2026-10-21.1.log.jsonl'))).toHaveLength(2);
    expect(await lines(join(file.folder, 'indaba-2026-10-21.2.log.jsonl'))).toHaveLength(1);
  });

  it('writes a record larger than maxFileBytes whole, in a file of its own', async () => {
    const root = await makeTempDir();
    const file = sink(root, { maxFileBytes: 10 });
    file.write(record(DAY_ONE, 'long enough to pass the cap'));
    file.write(record(DAY_ONE, 'and another'));
    await file.flush();
    expect(await lines(join(file.folder, 'indaba-2026-10-21.log.jsonl'))).toHaveLength(1);
    expect(await lines(join(file.folder, 'indaba-2026-10-21.1.log.jsonl'))).toHaveLength(1);
  });

  it('continues a file of the day that is not full and skips the ones that are', async () => {
    const root = await makeTempDir();
    const folder = join(root, '.indaba', 'logs');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'indaba-2026-10-21.log.jsonl'), 'x'.repeat(100));
    await writeFile(
      join(folder, 'indaba-2026-10-21.1.log.jsonl'),
      `${JSON.stringify(record(DAY_ONE, 'old'))}\n`,
    );

    const file = sink(root, { maxFileBytes: 100 });
    file.write(record(DAY_ONE, 'new'));
    await file.flush();
    const written = await lines(join(folder, 'indaba-2026-10-21.1.log.jsonl'));
    expect(written).toEqual([record(DAY_ONE, 'old'), record(DAY_ONE, 'new')]);
  });

  it('keeps only maxFiles of its own files, deleting the oldest, and leaves other files alone', async () => {
    const root = await makeTempDir();
    const folder = join(root, '.indaba', 'logs');
    await mkdir(folder, { recursive: true });
    for (const name of [
      'indaba-2026-10-18.log.jsonl',
      'indaba-2026-10-19.log.jsonl',
      'indaba-2026-10-19.1.log.jsonl',
      'indaba-2026-10-20.log.jsonl',
      'notes.txt',
    ]) {
      await writeFile(join(folder, name), '{}\n');
    }

    const file = sink(root, { maxFiles: 3 });
    file.write(record(DAY_ONE));
    await file.flush();
    expect((await readdir(folder)).sort()).toEqual([
      'indaba-2026-10-19.1.log.jsonl',
      'indaba-2026-10-20.log.jsonl',
      'indaba-2026-10-21.log.jsonl',
      'notes.txt',
    ]);
  });

  it('accepts an absolute folder the person typed, outside the project', async () => {
    const root = await makeTempDir();
    const elsewhere = join(await makeTempDir(), 'my-logs');
    const file = sink(root, { folder: elsewhere });
    file.write(record(DAY_ONE));
    await file.flush();
    expect(await readdir(elsewhere)).toEqual(['indaba-2026-10-21.log.jsonl']);
  });

  it('refuses a relative folder that leaves the project', async () => {
    const root = await makeTempDir();
    expect(() => sink(root, { folder: '../outside' })).toThrow(IndabaError);
    expect(() => sink(root, { folder: 'logs/../../outside' })).toThrow('inside the project');
  });

  it('refuses settings that are not whole numbers or a folder path', async () => {
    const root = await makeTempDir();
    expect(() => sink(root, { maxFileBytes: 0 })).toThrow('maxFileBytes');
    expect(() => sink(root, { maxFileBytes: 1.5 })).toThrow('maxFileBytes');
    expect(() => sink(root, { maxFiles: 0 })).toThrow('maxFiles');
    expect(() => sink(root, { folder: ' ' })).toThrow('folder path');
    expect(() => sink(root, { folder: 'logs\nmore' })).toThrow('folder path');
  });

  it('carries its own level', async () => {
    const root = await makeTempDir();
    expect(sink(root, { level: 'warn' }).level).toBe('warn');
    expect(sink(root).level).toBeUndefined();
  });

  it('says once when the folder cannot be created, then stays off without throwing', async () => {
    const root = await makeTempDir();
    await writeFile(join(root, 'blocked'), 'a file where the folder should be');
    const errors: string[] = [];
    const file = sink(root, { folder: 'blocked/logs', onError: (folder) => errors.push(folder) });

    file.write(record(DAY_ONE));
    file.write(record(DAY_ONE));
    await file.flush();
    file.write(record(DAY_ONE));
    await file.flush();
    expect(errors).toEqual([join(root, 'blocked', 'logs')]);
  });

  it('stops when a relative folder leaves the project through a link', async () => {
    const root = await makeTempDir();
    const outside = await makeTempDir();
    // A junction needs no privilege on Windows; elsewhere the type is ignored.
    await symlink(outside, join(root, 'link'), 'junction');
    const errors: unknown[] = [];
    const file = sink(root, { folder: 'link/logs', onError: (_folder, error) => errors.push(error) });
    file.write(record(DAY_ONE));
    await file.flush();
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain('through a link');
    expect(await readdir(outside)).toEqual(['logs']);
    expect(await readdir(join(outside, 'logs'))).toEqual([]);
  });

  it('survives an error callback that throws', async () => {
    const root = await makeTempDir();
    await writeFile(join(root, 'blocked'), '');
    const file = sink(root, {
      folder: 'blocked/logs',
      onError: () => {
        throw new Error('the listener broke');
      },
    });
    file.write(record(DAY_ONE));
    await expect(file.flush()).resolves.toBeUndefined();
  });

  it('keeps writing to the current file when a record carries no date', async () => {
    const root = await makeTempDir();
    const file = sink(root);
    file.write(record(DAY_ONE));
    file.write(record('not a time'));
    await file.flush();
    expect(await lines(join(file.folder, 'indaba-2026-10-21.log.jsonl'))).toHaveLength(2);
  });

  it('receives what createLogger delivers, with the injected clock deciding the file', async () => {
    const root = await makeTempDir();
    const file = sink(root);
    const logger = createLogger({ sinks: [file], clock: () => new Date(DAY_TWO), pid: 42 });
    logger.child({ runId: 'r1' }).info('cli', 'process.start', { command: 'run' });
    await logger.flush();
    expect(await lines(join(file.folder, 'indaba-2026-10-22.log.jsonl'))).toEqual([
      {
        time: DAY_TWO,
        level: 'info',
        component: 'cli',
        message: 'process.start',
        fields: { command: 'run' },
        context: { runId: 'r1' },
        pid: 42,
      },
    ]);
  });
});
