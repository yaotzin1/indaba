import { describe, expect, it } from 'vitest';
import {
  AcpClosedError,
  AcpConnection,
  type AcpHandlers,
  AcpProtocolError,
  AcpRpcError,
  INTERNAL_ERROR,
  METHOD_NOT_FOUND,
} from '../src/acp-connection.js';
import type { ProcessSession } from '../src/index.js';
import { LineQueue } from './acp-support.js';

function pipe(
  handlers: Partial<AcpHandlers> = {},
  options: { maxMessages?: number; maxLineLength?: number } = {},
) {
  const queue = new LineQueue();
  const written: Record<string, unknown>[] = [];
  const session: ProcessSession = {
    lines: queue,
    stderrTail: () => '',
    exited: new Promise(() => undefined),
    write: async (line) => {
      written.push(JSON.parse(line) as Record<string, unknown>);
    },
    kill: async () => undefined,
  };
  const connection = new AcpConnection({
    session,
    handlers: {
      notification: handlers.notification ?? (() => undefined),
      request: handlers.request ?? (async () => null),
    },
    ...options,
  });
  const reading = connection.start();
  const feed = (message: Record<string, unknown>): void =>
    queue.push(JSON.stringify({ jsonrpc: '2.0', ...message }));
  return { connection, queue, written, feed, reading };
}

describe('AcpConnection', () => {
  it('correlates a response with its request', async () => {
    const { connection, feed, written } = pipe();
    const answer = connection.request('ping', { a: 1 });
    await Promise.resolve();
    expect(written[0]).toMatchObject({ jsonrpc: '2.0', id: 1, method: 'ping', params: { a: 1 } });
    feed({ id: 1, result: { ok: true } });
    await expect(answer).resolves.toEqual({ ok: true });
  });

  it('turns an error response into an AcpRpcError with its code', async () => {
    const { connection, feed } = pipe();
    const answer = connection.request('ping', {});
    feed({ id: 1, error: { code: -32000, message: 'Authentication required' } });
    await expect(answer).rejects.toMatchObject({
      name: 'AcpRpcError',
      code: -32000,
      message: 'Authentication required',
    });
  });

  it('ignores a response to a request nobody made', async () => {
    const { connection, feed } = pipe();
    const answer = connection.request('ping', {});
    feed({ id: 99, result: 'stray' });
    feed({ id: 1, result: 'real' });
    await expect(answer).resolves.toBe('real');
  });

  it('hands notifications to the handler in order, before a later response resolves', async () => {
    const seen: string[] = [];
    const { connection, feed } = pipe({
      notification: async (method) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        seen.push(method);
      },
    });
    const answer = connection.request('prompt', {});
    feed({ method: 'one' });
    feed({ method: 'two' });
    feed({ id: 1, result: 'done' });
    await answer;
    expect(seen).toEqual(['one', 'two']);
  });

  it('answers a request from the agent with the handler result', async () => {
    const { feed, written, queue } = pipe({
      request: async (method, params) => ({ echoed: method, params }),
    });
    feed({ id: 'a1', method: 'fs/read_text_file', params: { path: '/x' } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(written[0]).toEqual({
      jsonrpc: '2.0',
      id: 'a1',
      result: { echoed: 'fs/read_text_file', params: { path: '/x' } },
    });
    queue.close();
  });

  it('answers with the code of an AcpRpcError the handler threw', async () => {
    const { feed, written } = pipe({
      request: async () => {
        throw new AcpRpcError(METHOD_NOT_FOUND, 'Method not found.');
      },
    });
    feed({ id: 1, method: 'terminal/create' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(written[0]).toMatchObject({
      id: 1,
      error: { code: METHOD_NOT_FOUND, message: 'Method not found.' },
    });
  });

  it('keeps the text of an internal failure to itself', async () => {
    const { feed, written } = pipe({
      request: async () => {
        throw new Error('ENOENT: /home/someone/.ssh/id_rsa');
      },
    });
    feed({ id: 1, method: 'fs/read_text_file' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(written[0]).toMatchObject({ error: { code: INTERNAL_ERROR, message: 'Internal error' } });
    expect(JSON.stringify(written)).not.toContain('id_rsa');
  });

  it('fails everything pending, and everything after, on a line that is not JSON', async () => {
    const { connection, queue } = pipe();
    const answer = connection.request('ping', {});
    queue.push('Welcome to the agent!');
    await expect(answer).rejects.toBeInstanceOf(AcpProtocolError);
    await expect(connection.request('again', {})).rejects.toBeInstanceOf(AcpProtocolError);
  });

  it.each([
    ['not an object', '[1,2]'],
    ['no jsonrpc version', '{"id":1,"result":1}'],
    ['the wrong version', '{"jsonrpc":"1.0","id":1,"result":1}'],
    ['a response with an object id', '{"jsonrpc":"2.0","id":{},"result":1}'],
    ['a request with an object id', '{"jsonrpc":"2.0","id":{},"method":"x"}'],
  ])('rejects a message that is %s', async (_label, line) => {
    const { connection, queue } = pipe();
    const answer = connection.request('ping', {});
    queue.push(line);
    await expect(answer).rejects.toBeInstanceOf(AcpProtocolError);
  });

  it('stops a flood: more messages than allowed fails the connection', async () => {
    const { connection, feed } = pipe({}, { maxMessages: 5 });
    const answer = connection.request('ping', {});
    for (let i = 0; i < 6; i++) {
      feed({ method: 'noise' });
    }
    await expect(answer).rejects.toThrow('more messages');
  });

  it('refuses a message over the length limit', async () => {
    const { connection, feed } = pipe({}, { maxLineLength: 100 });
    const answer = connection.request('ping', {});
    feed({ method: 'big', params: { blob: 'x'.repeat(500) } });
    await expect(answer).rejects.toThrow('longer than the limit');
  });

  it('rejects a pending request when the agent goes away', async () => {
    const { connection, queue } = pipe();
    const answer = connection.request('ping', {});
    queue.close();
    await expect(answer).rejects.toBeInstanceOf(AcpClosedError);
    await expect(connection.request('later', {})).rejects.toBeInstanceOf(AcpClosedError);
  });

  it('does not throw when notifying a connection that is closed', async () => {
    const { connection, queue, reading } = pipe();
    queue.close();
    await reading;
    await expect(connection.notify('session/cancel', {})).resolves.toBeUndefined();
  });

  it('skips blank lines', async () => {
    const { connection, queue, feed } = pipe();
    const answer = connection.request('ping', {});
    queue.push('');
    queue.push('   ');
    feed({ id: 1, result: 1 });
    await expect(answer).resolves.toBe(1);
  });
});
