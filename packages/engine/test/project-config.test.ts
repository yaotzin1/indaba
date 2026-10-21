import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultLoggingSettings, IndabaError, type LoggingSettings } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import {
  PROJECT_CONFIG_FILE,
  parseProjectConfig,
  readProjectConfig,
  writeLoggingConfig,
} from '../src/index.js';
import { makeTempDir } from './support.js';

const changed: LoggingSettings = {
  level: 'debug',
  sinks: [
    { type: 'file', level: 'debug', folder: 'logs', maxFileBytes: 4096, maxFiles: 2 },
    { type: 'stderr', level: 'warn' },
    {
      type: 'gelf',
      level: 'warn',
      address: 'udp://graylog.test:12201',
      queueLength: 1000,
      timeoutSeconds: 5,
      retries: 3,
    },
  ],
};

describe('readProjectConfig', () => {
  it('gives the defaults with no file, and says it is absent', async () => {
    const root = await makeTempDir();
    const config = await readProjectConfig(root);
    expect(config.present).toBe(false);
    expect(config.problems).toEqual([]);
    expect(config.logging.settings).toEqual(defaultLoggingSettings());
    expect(config.path).toBe(join(root, PROJECT_CONFIG_FILE));
  });

  it('reads the logging section', async () => {
    const root = await makeTempDir();
    await writeFile(
      join(root, PROJECT_CONFIG_FILE),
      'logging:\n  level: debug\n  sinks:\n    - type: stderr\n      level: error\n',
    );
    const config = await readProjectConfig(root);
    expect(config.present).toBe(true);
    expect(config.problems).toEqual([]);
    expect(config.logging.settings).toEqual({ level: 'debug', sinks: [{ type: 'stderr', level: 'error' }] });
  });

  it('names every problem by its key', () => {
    const config = parseProjectConfig(
      'sandbox: {}\nlogging:\n  level: loud\n  sinks:\n    - type: gelf\n      address: ftp://x\n      colour: red\n',
    );
    expect(config.problems).toEqual([
      'sandbox is not a section of indaba.config (allowed: logging)',
      'logging.level must be one of error, warn, info, debug',
      'logging.sinks[0].colour is not a logging setting (allowed: type, level, address, secretEnv, queueLength, timeoutSeconds, retries)',
      'logging.sinks[0].address must be an address starting with http:// or https:// or tcp:// or udp://',
    ]);
  });

  it('reports YAML it cannot read, two documents and a file that is not a mapping', () => {
    expect(parseProjectConfig('logging: [unclosed\n').problems[0]).toMatch(/^invalid YAML/);
    expect(parseProjectConfig('a: 1\n---\nb: 2\n').problems).toEqual([
      'invalid YAML: the file holds exactly one document',
    ]);
    expect(parseProjectConfig('- one\n').problems).toEqual([
      'indaba.config must be a mapping of sections (logging)',
    ]);
    expect(parseProjectConfig('').problems).toEqual([]);
    expect(parseProjectConfig('logging: 3\n').problems).toEqual(['logging.logging must be a mapping']);
  });

  it('refuses a file that is a link out of the project', async () => {
    const root = await makeTempDir();
    const outside = await makeTempDir();
    await writeFile(join(outside, 'elsewhere'), 'logging: {}\n');
    try {
      await symlink(join(outside, 'elsewhere'), join(root, PROJECT_CONFIG_FILE), 'file');
    } catch {
      return; // Creating a file link needs a privilege on Windows; the rule is the same there.
    }
    await expect(readProjectConfig(root)).rejects.toThrow(/leaves the project/);
  });

  it('says a folder in its place cannot be read', async () => {
    const root = await makeTempDir();
    await mkdir(join(root, PROJECT_CONFIG_FILE));
    await expect(readProjectConfig(root)).rejects.toThrow(IndabaError);
  });
});

describe('writeLoggingConfig', () => {
  it('writes only what differs from the defaults, and reads back the same', async () => {
    const root = await makeTempDir();
    await writeLoggingConfig(root, changed);
    const text = await readFile(join(root, PROJECT_CONFIG_FILE), 'utf8');
    expect(text).not.toContain('maxFiles: 10');
    expect(text).toContain('maxFiles: 2');
    const back = await readProjectConfig(root);
    expect(back.problems).toEqual([]);
    expect(back.logging.settings).toEqual(changed);
  });

  it('keeps comments and other keys, and removes the section when everything is default again', async () => {
    const root = await makeTempDir();
    await writeFile(
      join(root, PROJECT_CONFIG_FILE),
      '# the project configuration\nlogging:\n  # louder for now\n  level: debug\n',
    );
    await writeLoggingConfig(root, { ...changed, level: 'warn' });
    let text = await readFile(join(root, PROJECT_CONFIG_FILE), 'utf8');
    expect(text).toContain('# the project configuration');
    expect(text).toContain('level: warn');
    await writeLoggingConfig(root, defaultLoggingSettings());
    text = await readFile(join(root, PROJECT_CONFIG_FILE), 'utf8');
    expect(text).toContain('# the project configuration');
    expect(text).not.toContain('logging');
  });

  it('starts a file with only comments, and leaves an empty file empty', async () => {
    const root = await makeTempDir();
    await writeFile(join(root, PROJECT_CONFIG_FILE), '# nothing yet\n');
    await writeLoggingConfig(root, { ...defaultLoggingSettings(), level: 'error' });
    const text = await readFile(join(root, PROJECT_CONFIG_FILE), 'utf8');
    expect(text).toContain('# nothing yet');
    expect(text).toContain('level: error');
    const empty = await makeTempDir();
    await writeLoggingConfig(empty, defaultLoggingSettings());
    expect(await readFile(join(empty, PROJECT_CONFIG_FILE), 'utf8')).toBe('');
  });

  it('refuses settings that are not valid, and a file that is not valid YAML or not a mapping', async () => {
    const root = await makeTempDir();
    await expect(
      writeLoggingConfig(root, {
        level: 'info',
        sinks: [
          { type: 'stderr', level: 'warn' },
          {
            type: 'http-json',
            level: 'info',
            address: 'tcp://x:1',
            queueLength: 1,
            timeoutSeconds: 1,
            retries: 0,
          },
        ],
      }),
    ).rejects.toThrow(/not valid/);
    await writeFile(join(root, PROJECT_CONFIG_FILE), 'logging: [unclosed\n');
    await expect(writeLoggingConfig(root, changed)).rejects.toThrow(/not valid YAML/);
    await writeFile(join(root, PROJECT_CONFIG_FILE), '- a list\n');
    await expect(writeLoggingConfig(root, changed)).rejects.toThrow(/mapping/);
  });

  it('says a folder it cannot write into', async () => {
    await expect(writeLoggingConfig(join(await makeTempDir(), 'missing'), changed)).rejects.toThrow(
      /cannot be written/,
    );
  });
});
