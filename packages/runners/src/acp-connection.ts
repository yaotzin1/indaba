import { RunnerError } from '@indaba/core';
import type { ProcessSession } from './streaming-process.js';

/** The peer answered a request with a JSON-RPC error. */
export class AcpRpcError extends RunnerError {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'AcpRpcError';
  }
}

/** The peer broke the protocol: not JSON, not JSON-RPC, or too much of it. */
export class AcpProtocolError extends RunnerError {
  constructor(message: string) {
    super(message);
    this.name = 'AcpProtocolError';
  }
}

/** The peer went away while a request was waiting. */
export class AcpClosedError extends RunnerError {
  constructor(message = 'The agent closed the connection.') {
    super(message);
    this.name = 'AcpClosedError';
  }
}

export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

export interface AcpHandlers {
  /** A message from the agent that expects no answer. Runs in arrival order. */
  notification(method: string, params: unknown): void | Promise<void>;
  /** A request from the agent. Throw AcpRpcError to answer with an error; any other throw is an internal error. */
  request(method: string, params: unknown): Promise<unknown>;
}

export interface AcpConnectionOptions {
  readonly session: ProcessSession;
  readonly handlers: AcpHandlers;
  /** A longer line is a protocol violation. */
  readonly maxLineLength?: number;
  /** More messages than this in one connection is a protocol violation (a flood). */
  readonly maxMessages?: number;
}

export const DEFAULT_MAX_LINE_LENGTH = 8 * 1024 * 1024;
export const DEFAULT_MAX_MESSAGES = 200_000;

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type Id = number | string;

function isId(value: unknown): value is Id {
  return typeof value === 'number' || typeof value === 'string';
}

/**
 * JSON-RPC 2.0 over a line-oriented process: one message per line. Everything the agent sends is
 * untrusted: it is size-bounded, parsed defensively and never reaches a shell, a path or a log here.
 * Messages from the agent are handled one at a time, in order, so a prompt's answer can never
 * overtake the updates that preceded it.
 */
export class AcpConnection {
  private nextId = 1;
  private readonly pending = new Map<Id, Pending>();
  private closedWith: Error | undefined;
  private readonly maxLine: number;
  private readonly maxMessages: number;
  private reading: Promise<void> | undefined;

  constructor(private readonly options: AcpConnectionOptions) {
    this.maxLine = options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
    this.maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES;
  }

  /** Starts reading. Resolves when the agent's output has ended or the connection failed. */
  start(): Promise<void> {
    this.reading ??= this.readLoop();
    return this.reading;
  }

  async request(method: string, params: unknown): Promise<unknown> {
    if (this.closedWith !== undefined) {
      throw this.closedWith;
    }
    const id = this.nextId++;
    const answer = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    try {
      await this.options.session.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    } catch (error) {
      this.pending.delete(id);
      throw new AcpClosedError(error instanceof Error ? error.message : 'Cannot write to the agent.');
    }
    return await answer;
  }

  async notify(method: string, params: unknown): Promise<void> {
    if (this.closedWith !== undefined) {
      return;
    }
    await this.options.session
      .write(JSON.stringify({ jsonrpc: '2.0', method, params }))
      .catch(() => undefined);
  }

  private async readLoop(): Promise<void> {
    let count = 0;
    try {
      for await (const line of this.options.session.lines) {
        if (line.trim() === '') {
          continue;
        }
        count += 1;
        if (count > this.maxMessages) {
          throw new AcpProtocolError('The agent sent more messages than a run may have.');
        }
        if (line.length > this.maxLine) {
          throw new AcpProtocolError('The agent sent a message longer than the limit.');
        }
        await this.handle(line);
      }
      this.close(new AcpClosedError());
    } catch (error) {
      this.close(error instanceof Error ? error : new AcpClosedError());
    }
  }

  private close(error: Error): void {
    this.closedWith ??= error;
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      pending.reject(this.closedWith);
    }
  }

  private async handle(line: string): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      throw new AcpProtocolError('The agent sent something that is not JSON on its output.');
    }
    if (!isRecord(message) || message.jsonrpc !== '2.0') {
      throw new AcpProtocolError('The agent sent something that is not a JSON-RPC 2.0 message.');
    }

    const { id, method } = message;
    if (typeof method === 'string') {
      if (id === undefined) {
        await this.options.handlers.notification(method, message.params);
        return;
      }
      if (!isId(id)) {
        throw new AcpProtocolError('The agent sent a request with an invalid id.');
      }
      await this.answer(id, method, message.params);
      return;
    }

    if (!isId(id)) {
      throw new AcpProtocolError('The agent sent a response with an invalid id.');
    }
    const pending = this.pending.get(id);
    if (pending === undefined) {
      return; // an answer to nothing we asked: ignored, not trusted
    }
    this.pending.delete(id);
    if (isRecord(message.error)) {
      const { code, message: text } = message.error;
      pending.reject(
        new AcpRpcError(
          typeof code === 'number' ? code : INTERNAL_ERROR,
          typeof text === 'string' ? text : 'Error',
        ),
      );
    } else {
      pending.resolve(message.result);
    }
  }

  private async answer(id: Id, method: string, params: unknown): Promise<void> {
    let reply: Record<string, unknown>;
    try {
      reply = { jsonrpc: '2.0', id, result: (await this.options.handlers.request(method, params)) ?? null };
    } catch (error) {
      const code = error instanceof AcpRpcError ? error.code : INTERNAL_ERROR;
      // The text of an internal failure is ours to keep: it may name a path, so only rpc errors are echoed.
      const text = error instanceof AcpRpcError ? error.message : 'Internal error';
      reply = { jsonrpc: '2.0', id, error: { code, message: text } };
    }
    await this.options.session.write(JSON.stringify(reply)).catch(() => undefined);
  }
}
