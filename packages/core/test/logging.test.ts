import { describe, expect, it } from 'vitest';
import {
  createLogger,
  isLogLevel,
  LOG_LEVELS,
  LOGGING_DEFAULTS,
  LOGGING_SETTINGS,
  type LogRecord,
  type LogSink,
  levelEnabled,
  MAX_FIELD_LENGTH,
  noopLogger,
  resolveLoggingSettings,
} from '../src/index.js';

const fixedClock = () => new Date('2026-10-21T10:00:00.000Z');

function collector(level?: 'error' | 'warn' | 'info' | 'debug'): LogSink & { records: LogRecord[] } {
  const records: LogRecord[] = [];
  return { ...(level === undefined ? {} : { level }), records, write: (record) => void records.push(record) };
}

describe('levels', () => {
  it('orders error before debug', () => {
    expect(LOG_LEVELS).toEqual(['error', 'warn', 'info', 'debug']);
    expect(levelEnabled('error', 'warn')).toBe(true);
    expect(levelEnabled('debug', 'info')).toBe(false);
    expect(levelEnabled('info', 'info')).toBe(true);
  });

  it('recognises only the four names', () => {
    expect(isLogLevel('warn')).toBe(true);
    expect(isLogLevel('trace')).toBe(false);
    expect(isLogLevel(3)).toBe(false);
  });
});

describe('createLogger', () => {
  it('writes the time from the injected clock, the pid and no empty parts', () => {
    const sink = collector();
    createLogger({ sinks: [sink], clock: fixedClock, pid: 42 }).info('engine.run', 'run started');
    expect(sink.records).toEqual([
      {
        time: '2026-10-21T10:00:00.000Z',
        level: 'info',
        component: 'engine.run',
        message: 'run started',
        pid: 42,
      },
    ]);
  });

  it('drops a record below the minimum level before any sink sees it', () => {
    const sink = collector();
    const log = createLogger({ sinks: [sink], clock: fixedClock });
    log.debug('a', 'quiet');
    log.info('a', 'kept');
    expect(sink.records.map((r) => r.message)).toEqual(['kept']);
    const loud = collector();
    createLogger({ sinks: [loud], clock: fixedClock, level: 'debug' }).debug('a', 'now kept');
    expect(loud.records).toHaveLength(1);
  });

  it('gives a sink its own minimum', () => {
    const everything = collector();
    const warningsOnly = collector('warn');
    const log = createLogger({ sinks: [everything, warningsOnly], clock: fixedClock, level: 'debug' });
    log.debug('a', 'd');
    log.error('a', 'e');
    expect(everything.records).toHaveLength(2);
    expect(warningsOnly.records.map((r) => r.message)).toEqual(['e']);
  });

  it('keeps strings, numbers and booleans in fields and replaces anything else by its type', () => {
    const sink = collector();
    createLogger({ sinks: [sink], clock: fixedClock }).info('a', 'm', {
      text: 'x',
      count: 3,
      ok: true,
      nested: { a: 1 },
      nothing: null,
      missing: undefined,
      huge: Number.POSITIVE_INFINITY,
    });
    expect(sink.records[0]?.fields).toEqual({
      text: 'x',
      count: 3,
      ok: true,
      nested: 'object',
      nothing: 'null',
      missing: 'undefined',
      huge: 'Infinity',
    });
  });

  it('shortens a long string field', () => {
    const sink = collector();
    createLogger({ sinks: [sink], clock: fixedClock }).info('a', 'm', {
      long: 'x'.repeat(MAX_FIELD_LENGTH + 50),
    });
    const kept = sink.records[0]?.fields?.long;
    expect(typeof kept === 'string' && kept.length < MAX_FIELD_LENGTH + 50).toBe(true);
    expect(String(kept).endsWith('[truncated]')).toBe(true);
  });

  it('redacts the message, the component, the keys, the string fields and the context before any sink', () => {
    const sink = collector();
    const secret = ['sk', 'live', '12345'].join('-');
    const redact = (text: string) => text.split(secret).join('[redacted]');
    createLogger({ sinks: [sink], clock: fixedClock, redact })
      .child({ runId: `run-${secret}` })
      .info(`c-${secret}`, `m ${secret}`, { [`k-${secret}`]: `v ${secret}`, n: 1 });
    expect(JSON.stringify(sink.records)).not.toContain(secret);
    expect(sink.records[0]?.context).toEqual({ runId: 'run-[redacted]' });
  });

  it('adds the context of a child on top of its parent, and the parent is unchanged', () => {
    const sink = collector();
    const log = createLogger({ sinks: [sink], clock: fixedClock });
    const run = log.child({ runId: 'r1' });
    run.child({ stepId: 's1' }).info('a', 'step');
    run.info('a', 'run');
    log.info('a', 'plain');
    expect(sink.records.map((r) => r.context)).toEqual([
      { runId: 'r1', stepId: 's1' },
      { runId: 'r1' },
      undefined,
    ]);
  });

  it('drops a sink that throws, tells the others once, and never throws itself', () => {
    const failing: LogSink = {
      write: () => {
        throw new Error('disk full');
      },
    };
    const ok = collector();
    const log = createLogger({ sinks: [failing, ok], clock: fixedClock });
    expect(() => {
      log.info('a', 'first');
      log.info('a', 'second');
    }).not.toThrow();
    expect(ok.records.map((r) => r.message)).toEqual([
      'a log sink failed and was dropped',
      'first',
      'second',
    ]);
  });

  it('survives every sink failing', () => {
    const failing: LogSink = {
      write: () => {
        throw new Error('no');
      },
    };
    const log = createLogger({ sinks: [failing, failing], clock: fixedClock });
    expect(() => log.error('a', 'm')).not.toThrow();
  });

  it('produces the same records in the same order for the same inputs', () => {
    const run = () => {
      const sink = collector();
      const log = createLogger({ sinks: [sink], clock: fixedClock, pid: 1 }).child({ runId: 'r' });
      log.info('a', 'one', { n: 1 });
      log.warn('b', 'two');
      return sink.records;
    };
    expect(run()).toEqual(run());
  });

  it('flushes the sinks that can and ignores the ones that cannot or fail', async () => {
    let flushed = 0;
    const flushable: LogSink = { write: () => undefined, flush: () => Promise.resolve(void flushed++) };
    const broken: LogSink = { write: () => undefined, flush: () => Promise.reject(new Error('gone')) };
    const plain: LogSink = { write: () => undefined };
    await expect(
      createLogger({ sinks: [flushable, broken, plain], clock: fixedClock }).flush(),
    ).resolves.toBeUndefined();
    expect(flushed).toBe(1);
  });
});

describe('noopLogger', () => {
  it('does nothing and returns itself for a child', async () => {
    noopLogger.error('a', 'm');
    noopLogger.warn('a', 'm');
    noopLogger.info('a', 'm');
    noopLogger.debug('a', 'm');
    expect(noopLogger.child({ runId: 'x' })).toBe(noopLogger);
    await expect(noopLogger.flush()).resolves.toBeUndefined();
  });
});

describe('resolveLoggingSettings', () => {
  it('gives the defaults for nothing', () => {
    for (const raw of [undefined, null]) {
      const { settings, problems } = resolveLoggingSettings(raw);
      expect(problems).toEqual([]);
      expect(settings.level).toBe('info');
      expect(settings.sinks.map((s) => s.type)).toEqual(['file', 'stderr']);
    }
    const file = resolveLoggingSettings(undefined).settings.sinks[0];
    expect(file).toMatchObject({ folder: '.indaba/logs', maxFileBytes: 10 * 1024 * 1024, maxFiles: 10 });
  });

  it('describes every setting with a default and a label', () => {
    expect(LOGGING_SETTINGS.length).toBeGreaterThan(5);
    for (const setting of LOGGING_SETTINGS) {
      expect(setting.label).not.toBe('');
      expect(setting.help).not.toBe('');
    }
    expect(LOGGING_SETTINGS.find((s) => s.key === 'file.maxFiles')?.default).toBe(
      LOGGING_DEFAULTS.file.maxFiles,
    );
    expect(LOGGING_SETTINGS.filter((s) => s.secret).map((s) => s.key)).toEqual(['remote.secretEnv']);
  });

  it('reads a full configuration', () => {
    const { settings, problems } = resolveLoggingSettings({
      level: 'debug',
      sinks: [
        { type: 'file', folder: 'logs', maxFiles: 3, maxFileBytes: 2048, level: 'info' },
        { type: 'stderr', level: 'error' },
        {
          type: 'gelf',
          address: 'udp://graylog.example.invalid:12201',
          secretEnv: 'GRAYLOG_TOKEN',
          retries: 0,
        },
        {
          type: 'http-json',
          address: 'https://logs.example.invalid/ingest',
          queueLength: 5,
          timeoutSeconds: 2,
        },
      ],
    });
    expect(problems).toEqual([]);
    expect(settings.level).toBe('debug');
    expect(settings.sinks).toHaveLength(4);
    expect(settings.sinks[0]).toMatchObject({
      folder: 'logs',
      maxFiles: 3,
      maxFileBytes: 2048,
      level: 'info',
    });
    expect(settings.sinks[2]).toMatchObject({
      type: 'gelf',
      secretEnv: 'GRAYLOG_TOKEN',
      retries: 0,
      queueLength: LOGGING_DEFAULTS.remote.queueLength,
    });
    expect(settings.sinks[3]).toMatchObject({ queueLength: 5, timeoutSeconds: 2 });
  });

  it('names the key of every problem and ignores nothing', () => {
    const { problems } = resolveLoggingSettings({
      lvl: 'info',
      level: 'loud',
      sinks: [
        'file',
        { type: 'syslog' },
        { type: 'file', folder: '', maxFiles: 0, maxFileBytes: 1.5, colour: true, level: 'x' },
        { type: 'stderr', extra: 1 },
        { type: 'gelf', address: 'ftp://host', secretEnv: 'my secret value' },
        { type: 'http-json', address: 'tcp://host:1' },
      ],
    });
    const text = problems.join('\n');
    for (const key of [
      'lvl',
      'level must',
      'sinks[0]',
      'sinks[1].type',
      'sinks[2].folder',
      'sinks[2].maxFiles',
      'sinks[2].maxFileBytes',
      'sinks[2].colour',
      'sinks[2].level',
      'sinks[3].extra',
      'sinks[4].address',
      'sinks[4].secretEnv',
      'sinks[5].address',
    ]) {
      expect(text).toContain(key);
    }
  });

  it('falls back to the defaults when the shape is wrong', () => {
    expect(resolveLoggingSettings('nope').problems).toEqual(['logging must be a mapping']);
    expect(resolveLoggingSettings([]).problems).toEqual(['logging must be a mapping']);
    const notList = resolveLoggingSettings({ sinks: 'file' });
    expect(notList.problems).toEqual(['sinks must be a list']);
    expect(notList.settings.sinks.map((s) => s.type)).toEqual(['file', 'stderr']);
  });

  it('refuses a folder with a control character and keeps the default', () => {
    const bad = ['logs', String.fromCharCode(0), 'x'].join('');
    const { settings, problems } = resolveLoggingSettings({ sinks: [{ type: 'file', folder: bad }] });
    expect(problems.join()).toContain('folder');
    expect(settings.sinks[0]).toMatchObject({ folder: '.indaba/logs' });
  });
});
