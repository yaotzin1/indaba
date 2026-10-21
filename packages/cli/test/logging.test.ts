import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LogRecord } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { main } from '../src/index.js';
import { chooseLevel, extractLogOptions, formatForTerminal, openCommandLogger } from '../src/log.js';
import { captureIo, makeTempDir } from './support.js';

const example = fileURLToPath(new URL('../../../examples/task-pipeline.workflow.ai.yml', import.meta.url));
const NOW = '2026-10-21T08:00:00.000Z';
const LOG_FILE = 'indaba-2026-10-21.log.jsonl';

async function command(args: string[], cwd: string, env: Record<string, string | undefined> = {}) {
  const captured = captureIo(cwd, env);
  const code = await main(args, { ...captured.io, clock: () => new Date(NOW), pid: 4242 });
  return { code, out: captured.stdout(), err: captured.stderr() };
}

async function records(folder: string): Promise<LogRecord[]> {
  const text = await readFile(join(folder, LOG_FILE), 'utf8');
  return text
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as LogRecord);
}

async function exists(path: string): Promise<boolean> {
  return readdir(path).then(
    () => true,
    () => false,
  );
}

describe('the log of a command', () => {
  it('writes process.start and process.end to .indaba/logs with no setup, and prints nothing more', async () => {
    const dir = await makeTempDir();
    const plain = await command(['validate', example], await makeTempDir());
    const r = await command(['validate', example], dir);
    expect(r.code).toBe(0);
    expect(r.out).toBe(plain.out);
    expect(r.err).toBe('');

    const [start, end, ...rest] = await records(join(dir, '.indaba', 'logs'));
    expect(rest).toEqual([]);
    expect(start).toMatchObject({
      time: NOW,
      level: 'info',
      component: 'cli.process',
      message: 'process.start',
      pid: 4242,
      fields: {
        command: 'validate',
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      },
    });
    expect(typeof start?.fields?.indabaVersion).toBe('string');
    expect(end).toMatchObject({ message: 'process.end', fields: { exitCode: 0 } });
  });

  it('never records the arguments, only the command name', async () => {
    const dir = await makeTempDir();
    await command(['validate', 'a-file-named-like-a-secret.yml'], dir);
    const text = await readFile(join(dir, '.indaba', 'logs', LOG_FILE), 'utf8');
    expect(text).not.toContain('a-file-named-like-a-secret');
    expect((await records(join(dir, '.indaba', 'logs')))[1]?.fields?.exitCode).toBe(1);
  });

  it('writes the log of a run into the project of --workdir', async () => {
    const cwd = await makeTempDir();
    const project = await makeTempDir();
    const r = await command(['run', '-w', project, 'missing.yml'], cwd);
    expect(r.code).toBe(1);
    expect(await exists(join(cwd, '.indaba', 'logs'))).toBe(false);
    expect((await records(join(project, '.indaba', 'logs'))).map((x) => x.message)).toEqual([
      'process.start',
      'process.end',
    ]);
  });

  it('logs watch too, and still accepts its own options', async () => {
    const dir = await makeTempDir();
    const r = await command(['watch', '--log-level', 'debug', '--plain'], dir);
    expect(r.err).not.toContain('Unknown option');
    expect((await records(join(dir, '.indaba', 'logs')))[0]?.fields?.command).toBe('watch');
  });
});

describe('--log-level and INDABA_LOG_LEVEL', () => {
  it('drops what is below the level: at warn, a clean command writes no file', async () => {
    const dir = await makeTempDir();
    expect((await command(['validate', example, '--log-level', 'warn'], dir)).code).toBe(0);
    expect(await exists(join(dir, '.indaba', 'logs'))).toBe(false);
  });

  it('takes the variable, and the option wins over it', async () => {
    const quiet = await makeTempDir();
    await command(['validate', example], quiet, { INDABA_LOG_LEVEL: 'error' });
    expect(await exists(join(quiet, '.indaba', 'logs'))).toBe(false);

    const loud = await makeTempDir();
    await command(['validate', example, '--log-level=info'], loud, { INDABA_LOG_LEVEL: 'error' });
    expect(await records(join(loud, '.indaba', 'logs'))).toHaveLength(2);
  });

  it.each([
    [['validate', example, '--log-level', 'loud'], {}, '--log-level must be one of error, warn, info, debug'],
    [['validate', example], { INDABA_LOG_LEVEL: 'verbose' }, 'INDABA_LOG_LEVEL must be one of error, warn'],
    [['plan', example, '--log-level'], {}, '--log-level needs a value'],
    [['plan', example, '--log-dir', '--log-level', 'info'], {}, '--log-dir needs a value'],
    [['watch', '--log-level=nope'], {}, '--log-level must be one of'],
  ])('is a usage error naming the levels: %j', async (args, env, message) => {
    const dir = await makeTempDir();
    const r = await command(args, dir, env);
    expect(r.code).toBe(2);
    expect(r.err).toContain(message);
    expect(await exists(join(dir, '.indaba', 'logs'))).toBe(false);
  });

  it('lists the logging options in the help', async () => {
    const dir = await makeTempDir();
    expect((await command(['--help'], dir)).out).toContain('--log-level <level>');
    expect((await command(['run', '--help'], dir)).out).toContain('--log-dir <dir>');
  });
});

describe('--log-dir', () => {
  it('writes into a relative folder inside the project', async () => {
    const dir = await makeTempDir();
    await command(['validate', example, '--log-dir', 'my/logs'], dir);
    expect(await records(join(dir, 'my', 'logs'))).toHaveLength(2);
  });

  it('accepts an absolute folder the person typed', async () => {
    const dir = await makeTempDir();
    const elsewhere = join(await makeTempDir(), 'logs');
    await command(['validate', example, `--log-dir=${elsewhere}`], dir);
    expect(await records(elsewhere)).toHaveLength(2);
  });

  it('refuses a relative folder that leaves the project', async () => {
    const dir = await makeTempDir();
    const r = await command(['validate', example, '--log-dir', '../away'], dir);
    expect(r.code).toBe(2);
    expect(r.err).toContain('--log-dir: A relative log folder must stay inside the project.');
  });

  it('says once on standard error when the folder cannot be written, and the command goes on', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, 'blocked'), 'a file, not a folder');
    const r = await command(['validate', example, '--log-dir', 'blocked/logs'], dir);
    expect(r.code).toBe(0);
    expect(r.out).toContain('is valid');
    expect(r.err).toBe(
      `warn: the log folder cannot be written; this command logs no file folder=${join(dir, 'blocked', 'logs')}\n`,
    );
  });
});

describe('the logger of the command line', () => {
  it('redacts the secret values of the environment before the file sees them', async () => {
    const dir = await makeTempDir();
    const secret = ['sk', 'live', 'abcdef123456'].join('-');
    const logger = openCommandLogger({
      root: dir,
      level: 'debug',
      dir: undefined,
      stderr: { write: () => undefined },
      environment: { SERVICE_API_KEY: secret },
      clock: () => new Date(NOW),
      pid: 1,
    });
    logger.debug('test', 'a record', { header: `Bearer ${secret}` });
    await logger.flush();
    const text = await readFile(join(dir, '.indaba', 'logs', LOG_FILE), 'utf8');
    expect(text).not.toContain(secret);
    expect(text).toContain('[redacted]');
  });

  it('writes warn and above on standard error, and info and debug to the file only', async () => {
    const dir = await makeTempDir();
    let err = '';
    const logger = openCommandLogger({
      root: dir,
      level: 'debug',
      dir: undefined,
      stderr: { write: (text) => (err += text) },
      environment: {},
      clock: () => new Date(NOW),
      pid: 1,
    });
    logger.debug('t', 'quiet');
    logger.info('t', 'quiet too');
    logger.warn('t', 'heard', { path: 'a b' });
    logger.error('t', 'heard too');
    await logger.flush();
    expect(err).toBe('warn: heard path="a b"\nerror: heard too\n');
    expect(await records(join(dir, '.indaba', 'logs'))).toHaveLength(4);
  });

  it('prints a record as one plain line with nothing a terminal would act on', () => {
    const esc = String.fromCharCode(0x1b);
    const line = formatForTerminal({
      time: NOW,
      level: 'warn',
      component: 'x',
      message: 'refused',
      fields: { path: `/a${esc}[2J\nb`, empty: '', count: 3, ok: false, quote: 'say "hi"' },
      context: { runId: 'r1' },
    });
    expect(line).toBe('warn: refused path="/a b" empty="" count=3 ok=false quote="say \\"hi\\"" runId=r1\n');
  });

  it('takes the logging options out of the arguments and leaves the rest alone', () => {
    expect(extractLogOptions(['a', '--log-level', 'debug', '-w', 'x', '--log-dir=d', '--other'])).toEqual({
      args: ['a', '-w', 'x', '--other'],
      level: 'debug',
      dir: 'd',
    });
    expect(extractLogOptions(['--', '--log-level', 'nope']).args).toEqual(['--', '--log-level', 'nope']);
    expect(extractLogOptions(['--log-levels']).args).toEqual(['--log-levels']);
    expect(() => extractLogOptions(['--log-dir='])).toThrow('--log-dir needs a value');
  });

  it('chooses the option, then the variable, then the default', () => {
    expect(chooseLevel('debug', 'error')).toBe('debug');
    expect(chooseLevel(undefined, 'error')).toBe('error');
    expect(chooseLevel(undefined, '')).toBe('info');
    expect(chooseLevel(undefined, undefined)).toBe('info');
  });
});
