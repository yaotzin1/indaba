import { describe, expect, it } from 'vitest';
import {
  createLogger,
  createRedactor,
  defaultLoggingSettings,
  type LoggingSettings,
  type LogRecord,
  type LogSink,
  loggingSettingsToConfig,
  REDACTED,
  resolveLoggingSettings,
  secretValuesOf,
} from '../src/index.js';

// Every hostile value is built from fragments, so this file never holds something shaped like a credential
// (scripts/security-audit.mjs scans tests too).
const join = (...parts: string[]): string => parts.join('');
const alnum = (n: number): string => 'aB3dE5gH7jK9mN1pQ2rS4tU6vW8xY0z'.repeat(4).slice(0, n);

const fixedClock = () => new Date('2026-10-21T10:00:00.000Z');

function collector(): LogSink & { records: LogRecord[] } {
  const records: LogRecord[] = [];
  return { records, write: (record) => void records.push(record) };
}

describe('createRedactor: the environment', () => {
  it('removes the values of variables named like a credential, four characters or longer', () => {
    const redact = createRedactor({
      environment: {
        OPENROUTER_API_KEY: 'value-one-xyz',
        GH_TOKEN: 'abcd',
        DEBUG: '1',
        PASS_SHORT_KEY: 'ab',
      },
    });
    expect(redact('a value-one-xyz and abcd, flag 1, ab')).toBe(`a ${REDACTED} and ${REDACTED}, flag 1, ab`);
  });

  it('keeps the values of variables with ordinary names', () => {
    const redact = createRedactor({ environment: { HOME: '/home/someone', GIT_AUTHOR_NAME: 'Some One' } });
    expect(redact('/home/someone by Some One')).toBe('/home/someone by Some One');
  });

  it('removes extra values whatever their variable is called, longest first', () => {
    const redact = createRedactor({ environment: { MY_SECRET: 'part' }, values: ['partition-key-value'] });
    expect(redact('partition-key-value / part')).toBe(`${REDACTED} / ${REDACTED}`);
  });

  it('lists the secret values longest first', () => {
    expect(secretValuesOf({ A_KEY: 'four', B_TOKEN: 'longer-one', C: 'other', D_SECRET: undefined })).toEqual(
      ['longer-one', 'four'],
    );
  });
});

describe('createRedactor: shapes', () => {
  const redact = createRedactor();

  it.each([
    ['an OpenAI-style key', join('s', 'k-', alnum(24))],
    ['a project key', join('s', 'k-proj-', alnum(30))],
    ['a GitHub token', join('gh', 'p_', alnum(36))],
    ['a fine-grained GitHub token', join('github', '_pat_', alnum(40))],
    ['a GitLab token', join('gl', 'pat-', alnum(20))],
    ['a Slack token', join('xo', 'xb-', alnum(12), '-', alnum(12))],
    ['an AWS key id', join('AK', 'IA', 'ABCDEFGHIJKLMNOP')],
    ['a Google key', join('AI', 'za', alnum(35))],
    ['a JWT', join('ey', 'J', alnum(12), '.', 'ey', 'J', alnum(12), '.', alnum(20))],
  ])('removes %s', (_name, secret) => {
    const out = redact(`before ${secret} after`);
    expect(out).toBe(`before ${REDACTED} after`);
    expect(out).not.toContain(secret);
  });

  it('removes a private key block', () => {
    const dashes = '-'.repeat(5);
    const block = join(
      dashes,
      'BEGIN ',
      'RSA PRIVATE KEY',
      dashes,
      '\n',
      alnum(40),
      '\n',
      dashes,
      'END ',
      'RSA PRIVATE KEY',
      dashes,
    );
    expect(redact(`key: ${block} done`)).toBe(`key: ${REDACTED} done`);
  });

  it('keeps the scheme of an Authorization header and removes the credential', () => {
    const token = alnum(24);
    expect(redact(`Authorization: Bearer ${token}`)).toBe(`Authorization: Bearer ${REDACTED}`);
    expect(redact(`{"authorization":"Basic ${token}"}`)).toBe(`{"authorization":"Basic ${REDACTED}"}`);
    expect(redact(`authorization=${token}`)).toBe(`authorization=${REDACTED}`);
  });

  it('removes a bare bearer token but leaves the word alone', () => {
    const token = alnum(20);
    expect(redact(`sent bearer ${token} then`)).toBe(`sent bearer ${REDACTED} then`);
    expect(redact('the Bearer scheme')).toBe('the Bearer scheme');
  });

  it('removes a token in a URL fragment or query, keeping the name', () => {
    const token = alnum(32);
    expect(redact(`http://127.0.0.1:4100/#token=${token}`)).toBe(`http://127.0.0.1:4100/#token=${REDACTED}`);
    expect(redact(`https://x.test/a?access_token=${token}&page=2`)).toBe(
      `https://x.test/a?access_token=${REDACTED}&page=2`,
    );
    expect(redact(`https://x.test/a?api_key=${token}`)).toBe(`https://x.test/a?api_key=${REDACTED}`);
  });

  it("removes the password of a URL's user information", () => {
    const password = alnum(12);
    expect(redact(join('postgres', '://', 'app:', password, '@db.test/x'))).toBe(
      join('postgres', '://app:', REDACTED, '@db.test/x'),
    );
  });

  it('leaves ordinary text, paths and short words alone', () => {
    const text = 'step build failed: exit 1 in /tmp/sk-test (key: value, token count 42)';
    expect(redact(text)).toBe(text);
  });
});

describe('createLogger with the redaction', () => {
  it('redacts the message, the fields, their names and the context before any sink', () => {
    const sink = collector();
    const secret = join('s', 'k-', alnum(24));
    const logger = createLogger({
      sinks: [sink],
      clock: fixedClock,
      redact: createRedactor({ environment: { X_TOKEN: 'env-value-1' } }),
    });
    logger.child({ runId: 'env-value-1' }).info('test', 'message', { [secret]: `Bearer ${alnum(20)}` });
    const text = JSON.stringify(sink.records);
    expect(text).not.toContain(secret);
    expect(text).not.toContain('env-value-1');
    expect(text).not.toContain(alnum(20));
  });
});

describe('addSink', () => {
  it('reaches a sink added after the logger was built, through every child', () => {
    const first = collector();
    const late = collector();
    const logger = createLogger({ sinks: [first], clock: fixedClock });
    const child = logger.child({ runId: 'r1' });
    logger.info('test', 'before');
    logger.addSink(late);
    logger.addSink(late);
    child.info('test', 'after');
    expect(first.records.map((r) => r.message)).toEqual(['before', 'after']);
    expect(late.records.map((r) => r.message)).toEqual(['after']);
  });

  it('drops a late sink that throws, with one warning to the others', async () => {
    const good = collector();
    const logger = createLogger({ sinks: [good], clock: fixedClock });
    let calls = 0;
    logger.addSink({
      write: () => {
        calls += 1;
        throw new Error('broken');
      },
      flush: () => Promise.reject(new Error('still broken')),
    });
    logger.info('test', 'one');
    logger.info('test', 'two');
    await logger.flush();
    expect(calls).toBe(1);
    expect(good.records.map((r) => r.message)).toEqual(['one', 'a log sink failed and was dropped', 'two']);
  });
});

describe('loggingSettingsToConfig', () => {
  it('writes nothing for the defaults', () => {
    expect(loggingSettingsToConfig(defaultLoggingSettings())).toEqual({});
  });

  it('keeps only what differs from the defaults, and reads back to the same settings', () => {
    const settings: LoggingSettings = {
      level: 'debug',
      sinks: [
        { type: 'file', level: 'info', folder: 'logs', maxFileBytes: 2048, maxFiles: 3 },
        { type: 'stderr', level: 'error' },
        {
          type: 'gelf',
          level: 'warn',
          address: 'udp://graylog.test:12201',
          secretEnv: 'GRAYLOG_TOKEN',
          queueLength: 50,
          timeoutSeconds: 2,
          retries: 1,
        },
        {
          type: 'http-json',
          level: 'info',
          address: 'https://logs.test/in',
          queueLength: 1000,
          timeoutSeconds: 5,
          retries: 3,
        },
      ],
    };
    const config = loggingSettingsToConfig(settings);
    expect(config).toEqual({
      level: 'debug',
      sinks: [
        { type: 'file', level: 'info', folder: 'logs', maxFileBytes: 2048, maxFiles: 3 },
        { type: 'stderr', level: 'error' },
        {
          type: 'gelf',
          level: 'warn',
          address: 'udp://graylog.test:12201',
          secretEnv: 'GRAYLOG_TOKEN',
          queueLength: 50,
          timeoutSeconds: 2,
          retries: 1,
        },
        { type: 'http-json', address: 'https://logs.test/in' },
      ],
    });
    const back = resolveLoggingSettings(config);
    expect(back.problems).toEqual([]);
    expect(back.settings).toEqual(settings);
  });

  it('writes the sinks when only their list differs', () => {
    const config = loggingSettingsToConfig({ level: 'info', sinks: [{ type: 'stderr', level: 'warn' }] });
    expect(config).toEqual({ sinks: [{ type: 'stderr' }] });
  });
});
