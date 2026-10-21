import { createSocket } from 'node:dgram';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { type AddressInfo, createServer as createTcpServer, type Socket } from 'node:net';
import { IndabaError, type LogRecord } from '@indaba/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  authorizationOf,
  GelfLogSink,
  gelfDatagrams,
  HttpJsonLogSink,
  parseCollectorAddress,
  RemoteLogSink,
  type RemoteLogTrouble,
  toGelf,
} from '../src/index.js';

const record = (
  message: string,
  level: LogRecord['level'] = 'info',
  fields?: LogRecord['fields'],
): LogRecord => ({
  time: '2026-10-21T10:00:00.500Z',
  level,
  component: 'test.remote',
  message,
  pid: 42,
  context: { runId: 'run-1', stepId: 'build' },
  ...(fields === undefined ? {} : { fields }),
});

const quick = { queueLength: 10, timeoutSeconds: 1, retries: 2, retryDelayMs: 0 } as const;

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('RemoteLogSink', () => {
  it('sends every record in order, and write never waits', async () => {
    const sent: string[] = [];
    const sink = new RemoteLogSink(async (r) => void sent.push(r.message), quick);
    sink.write(record('one'));
    sink.write(record('two'));
    expect(sent).toEqual([]);
    await sink.flush();
    expect(sent).toEqual(['one', 'two']);
  });

  it('retries a failing record, then sends it', async () => {
    let attempts = 0;
    const sent: string[] = [];
    const troubles: RemoteLogTrouble[] = [];
    const sink = new RemoteLogSink(
      async (r) => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error('not yet');
        }
        sent.push(r.message);
      },
      { ...quick, onTrouble: (t) => troubles.push(t) },
    );
    sink.write(record('one'));
    await sink.flush();
    expect(attempts).toBe(3);
    expect(sent).toEqual(['one']);
    expect(troubles).toEqual([]);
  });

  it('costs one warning per outage, tries once while down, and says when it is back', async () => {
    let up = false;
    let attempts = 0;
    const sent: string[] = [];
    const troubles: RemoteLogTrouble[] = [];
    const sink = new RemoteLogSink(
      async (r) => {
        attempts += 1;
        if (!up) {
          throw new Error('connection refused');
        }
        sent.push(r.message);
      },
      { ...quick, onTrouble: (t) => troubles.push(t) },
    );
    for (const message of ['a', 'b', 'c']) {
      sink.write(record(message));
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    // a: 1 + 2 retries; b and c: once each, the collector being down.
    expect(attempts).toBe(5);
    up = true;
    sink.write(record('d'));
    await sink.flush();
    expect(sent).toEqual(['d']);
    expect(troubles).toEqual([
      { kind: 'unreachable', reason: 'connection refused' },
      { kind: 'dropped', count: 3 },
      { kind: 'reachable-again' },
    ]);
  });

  it('drops the oldest debug record first when the queue is full, and counts it once', async () => {
    const gate = deferred();
    const sent: string[] = [];
    const troubles: RemoteLogTrouble[] = [];
    const sink = new RemoteLogSink(
      async (r) => {
        await gate.promise;
        sent.push(r.message);
      },
      { ...quick, queueLength: 2, onTrouble: (t) => troubles.push(t) },
    );
    sink.write(record('in flight'));
    await Promise.resolve();
    await Promise.resolve();
    sink.write(record('info 1'));
    sink.write(record('debug 1', 'debug'));
    sink.write(record('info 2'));
    sink.write(record('info 3'));
    gate.resolve();
    await sink.flush();
    expect(sent).toEqual(['in flight', 'info 2', 'info 3']);
    expect(troubles).toEqual([{ kind: 'dropped', count: 2 }]);
  });

  it('gives up on an attempt after the timeout', async () => {
    const troubles: RemoteLogTrouble[] = [];
    const sink = new RemoteLogSink(() => new Promise<void>(() => undefined), {
      ...quick,
      retries: 0,
      onTrouble: (t) => troubles.push(t),
    });
    sink.write(record('never answered'));
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(troubles[0]).toEqual({ kind: 'unreachable', reason: 'the collector did not answer in time' });
    await sink.flush();
  });

  it('waits at most one timeout in flush, and counts what it leaves behind', async () => {
    const troubles: RemoteLogTrouble[] = [];
    const sink = new RemoteLogSink(() => new Promise<void>(() => undefined), {
      ...quick,
      onTrouble: (t) => troubles.push(t),
    });
    sink.write(record('one'));
    sink.write(record('two'));
    const started = performance.now();
    await sink.flush();
    expect(performance.now() - started).toBeLessThan(1500);
    expect(troubles).toContainEqual({ kind: 'dropped', count: 1 });
    sink.write(record('after close'));
  });

  it('swallows a throw of whoever is told', async () => {
    const sink = new RemoteLogSink(
      async () => {
        throw new Error('down');
      },
      {
        ...quick,
        retries: 0,
        onTrouble: () => {
          throw new Error('cannot hear');
        },
      },
    );
    sink.write(record('one'));
    await expect(sink.flush()).resolves.toBeUndefined();
  });

  it('refuses limits that are not whole numbers', () => {
    const deliver = async (): Promise<void> => undefined;
    expect(() => new RemoteLogSink(deliver, { ...quick, queueLength: 0 })).toThrow(IndabaError);
    expect(() => new RemoteLogSink(deliver, { ...quick, timeoutSeconds: 1.5 })).toThrow(/timeoutSeconds/);
    expect(() => new RemoteLogSink(deliver, { ...quick, retries: -1 })).toThrow(/retries/);
  });
});

describe('collector addresses', () => {
  it('takes http, https, tcp and udp with a port', () => {
    expect(parseCollectorAddress('https://logs.test/gelf', ['https'])).toMatchObject({
      host: 'logs.test',
      port: 443,
    });
    expect(parseCollectorAddress('http://logs.test/gelf', ['http'])).toMatchObject({ port: 80 });
    expect(parseCollectorAddress('tcp://[::1]:12201', ['tcp'])).toMatchObject({ host: '::1', port: 12201 });
    expect(parseCollectorAddress('udp://127.0.0.1:12201', ['udp'])).toMatchObject({ scheme: 'udp' });
  });

  it.each([
    ['not a URL', 'nothing here'],
    ['another scheme', 'file:///etc/passwd'],
    ['a scheme the sink does not speak', 'udp://logs.test:1'],
    ['no port for a socket', 'tcp://logs.test'],
    ['a user name and password', ['http://user', ':pw@logs.test/'].join('')],
  ])('refuses %s', (_name, address) => {
    expect(() => parseCollectorAddress(address, ['http', 'https', 'tcp'])).toThrow(IndabaError);
  });

  it('sends a bare credential as a bearer token and one with a scheme as it is', () => {
    expect(authorizationOf('abc')).toBe('Bearer abc');
    expect(authorizationOf('Basic abc=')).toBe('Basic abc=');
  });
});

describe('GELF', () => {
  it('maps a record to GELF 1.1 with its own time and syslog level', () => {
    const gelf = toGelf(
      record('a step failed', 'warn', { id: 'x', 'bad key!': 1, host: 'field' }),
      'machine',
    );
    expect(gelf).toEqual({
      version: '1.1',
      host: 'machine',
      short_message: 'a step failed',
      timestamp: 1792576800.5,
      level: 4,
      _component: 'test.remote',
      _level_name: 'warn',
      _pid: 42,
      _runId: 'run-1',
      _stepId: 'build',
      _field_id: 'x',
      _bad_key_: 1,
      _host: 'field',
    });
  });

  it('keeps a message that fits one datagram whole, and chunks a larger one', () => {
    const id = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(gelfDatagrams(new Uint8Array(100), id)).toHaveLength(1);
    const chunks = gelfDatagrams(new Uint8Array(20_000), id);
    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => [c[0], c[1], c[10], c[11]])).toEqual([
      [0x1e, 0x0f, 0, 3],
      [0x1e, 0x0f, 1, 3],
      [0x1e, 0x0f, 2, 3],
    ]);
    expect([...(chunks[1]?.subarray(2, 10) ?? [])]).toEqual([...id]);
    expect(chunks.reduce((n, c) => n + c.byteLength - 12, 0)).toBe(20_000);
    expect(() => gelfDatagrams(new Uint8Array(8180 * 129), id)).toThrow(/too large/);
  });

  it('posts over HTTP with the credential as the Authorization header', async () => {
    const bodies: { auth: string | undefined; body: unknown }[] = [];
    const url = await httpCollector((req, res, body) => {
      bodies.push({ auth: req.headers.authorization, body: JSON.parse(body) });
      res.writeHead(202).end();
    });
    const sink = new GelfLogSink({
      ...quick,
      address: `${url}/gelf`,
      source: 'machine',
      credential: 'tok-1',
    });
    sink.write(record('over http'));
    await sink.flush();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.auth).toBe('Bearer tok-1');
    expect(bodies[0]?.body).toMatchObject({ short_message: 'over http', host: 'machine', level: 6 });
  });

  it('sends zero-terminated frames over one TCP connection', async () => {
    const received: Buffer[] = [];
    let connections = 0;
    const done = deferred();
    const server = createTcpServer((socket: Socket) => {
      connections += 1;
      socket.on('data', (data) => {
        received.push(data);
        if (Buffer.concat(received).filter((b) => b === 0).length === 2) {
          done.resolve();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const { port } = server.address() as AddressInfo;
    const sink = new GelfLogSink({ ...quick, address: `tcp://127.0.0.1:${port}`, source: 'machine' });
    sink.write(record('first'));
    sink.write(record('second'));
    await done.promise;
    await sink.flush();
    const frames = Buffer.concat(received)
      .toString('utf8')
      .split('\0')
      .filter((f) => f !== '');
    expect(frames.map((f) => JSON.parse(f).short_message)).toEqual(['first', 'second']);
    expect(connections).toBe(1);
  });

  it('sends a datagram over UDP', async () => {
    const socket = createSocket('udp4');
    const got = new Promise<Buffer>((resolve) => socket.once('message', resolve));
    await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise<void>((resolve) => socket.close(() => resolve())));
    const sink = new GelfLogSink({
      ...quick,
      address: `udp://127.0.0.1:${socket.address().port}`,
      source: 'machine',
      pid: 7,
    });
    sink.write(record('over udp'));
    const message = await got;
    await sink.flush();
    expect(JSON.parse(message.toString('utf8'))).toMatchObject({ short_message: 'over udp' });
  });

  it('treats a refused TCP connection as an outage', async () => {
    const server = createTcpServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const troubles: RemoteLogTrouble[] = [];
    const sink = new GelfLogSink({
      ...quick,
      retries: 0,
      address: `tcp://127.0.0.1:${port}`,
      source: 'machine',
      onTrouble: (t) => troubles.push(t),
    });
    sink.write(record('nobody listens'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    await sink.flush();
    expect(troubles[0]?.kind).toBe('unreachable');
  });
});

describe('HttpJsonLogSink', () => {
  it('posts the record as it is', async () => {
    const bodies: unknown[] = [];
    const url = await httpCollector((_req, res, body) => {
      bodies.push(JSON.parse(body));
      res.writeHead(200).end('ok');
    });
    const sink = new HttpJsonLogSink({ ...quick, address: `${url}/in` });
    sink.write(record('as json'));
    await sink.flush();
    expect(bodies).toEqual([record('as json')]);
  });

  it('counts a refusal or a redirect as a failure and never follows it', async () => {
    let hits = 0;
    const url = await httpCollector((_req, res) => {
      hits += 1;
      res.writeHead(hits === 1 ? 302 : 500, { location: 'http://elsewhere.test/' }).end();
    });
    const troubles: RemoteLogTrouble[] = [];
    const sink = new HttpJsonLogSink({
      ...quick,
      retries: 1,
      address: url,
      onTrouble: (t) => troubles.push(t),
    });
    sink.write(record('refused'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    await sink.flush();
    expect(hits).toBe(2);
    expect(troubles[0]).toEqual({ kind: 'unreachable', reason: 'the collector answered 500' });
  });

  it('refuses a socket address', () => {
    expect(() => new HttpJsonLogSink({ ...quick, address: 'tcp://logs.test:1' })).toThrow(IndabaError);
  });
});

async function httpCollector(
  handle: (req: IncomingMessage, res: ServerResponse, body: string) => void,
): Promise<string> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => handle(req, res, Buffer.concat(chunks).toString('utf8')));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
