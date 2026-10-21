import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import {
  type ApiError,
  type ContractResponse,
  type DiscussionResponse,
  type Logger,
  noopLogger,
  type RunListResponse,
  type RunResponse,
} from '@indaba/core';
import { DISCUSSION_DIRECTORY, DiscussionStore } from '@indaba/engine';
import { bearerOf, hostAllowed, SECURITY_HEADERS, tokenMatches } from './checks.js';
import { RunSource, stepOf } from './runs.js';
import { defaultSleep, type Sleep, streamRun, streamServer } from './sse.js';
import { readStatic } from './static.js';

/** The contract between the page and the server; the major is what the page checks. */
export const CONTRACT_VERSION = '1.0.0';

const API = '/api/v1';
const DEFAULT_POLL_MS = 1000;
const DEFAULT_COALESCE_MS = 50;

export interface ServerOptions {
  /** Project roots whose `.indaba/traces` the server reads. */
  readonly roots: readonly string[];
  /** Folders to look in for the kept messages of debates, besides `<root>/.indaba/discussions` of each root. */
  readonly discussionDirectories?: readonly string[];
  /** The folder of the built page, served without the token. */
  readonly staticDir: string;
  /** Default: a free port. */
  readonly port?: number;
  /** The only accepted value in this version. */
  readonly host?: '127.0.0.1';
  /** Default: a random token, chosen at each start. A test passes its own. */
  readonly token?: string;
  /** How often the server-wide stream and a followed run look for news. Default 1000 and 100 ms. */
  readonly pollMs?: number;
  /** Replaces the wait between polls. Tests inject one. */
  readonly sleep?: Sleep;
  /** Events of one run that arrive within this many ms are sent as one snapshot. Default 50. */
  readonly coalesceMs?: number;
  /**
   * Where the server says what it did (specs/logging, AC-09): starting and stopping, each refused request, each stream
   * opening and closing, a request that failed. Never the token, a request body, the `Authorization` header or a query.
   * Default: a logger that records nothing.
   */
  readonly logger?: Logger;
}

export interface ServerHandle {
  /** The address to open, with the token in the fragment (a fragment is never sent to a server). */
  readonly url: string;
  readonly port: number;
  /** Closes the listener and every open stream. */
  close(): Promise<void>;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function sendError(res: ServerResponse, status: number, error: ApiError): void {
  sendJson(res, status, error);
}

const NOT_FOUND: ApiError = { code: 'not_found', message: 'There is nothing at this address.' };

/** The longest path a record keeps; a longer one is cut, so a hostile address cannot fill the log. */
const MAX_LOGGED_PATH = 200;

/**
 * The path of a request as a record may carry it: no query and no fragment (a token never travels in either, but a
 * mistaken link might), cut to a bounded length. The logger removes escape sequences and redacts what is left.
 */
export function loggedPath(url: string | undefined): string {
  let path: string;
  try {
    path = new URL(url ?? '/', 'http://localhost').pathname;
  } catch {
    return '(not a valid address)';
  }
  return path.length > MAX_LOGGED_PATH ? `${path.slice(0, MAX_LOGGED_PATH)}…` : path;
}

function lastEventId(req: IncomingMessage): number {
  const header = req.headers['last-event-id'];
  const value = Array.isArray(header) ? header[0] : header;
  const parsed = value === undefined ? 0 : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * Starts the local server on 127.0.0.1. It reads files and serves them: it starts nothing and writes nothing. Every
 * `/api/v1` request needs the token; the files of the page do not, because a browser navigation cannot send a
 * header. Every request must carry a `Host` the server owns (DNS rebinding) and only `GET` is served.
 */
export async function startServer(options: ServerOptions): Promise<ServerHandle> {
  const token = options.token ?? randomBytes(32).toString('base64url');
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const sleep = options.sleep ?? defaultSleep;
  const coalesceMs = options.coalesceMs ?? DEFAULT_COALESCE_MS;
  const source = new RunSource(options.roots, { sleep, pollMs: Math.max(10, Math.min(pollMs, 100)) });
  const discussions = [
    ...options.roots.map((root) => join(root, DISCUSSION_DIRECTORY)),
    ...(options.discussionDirectories ?? []),
  ].map((directory) => new DiscussionStore(directory));
  const open = new Set<AbortController>();
  const log = options.logger ?? noopLogger;
  let port = 0;

  /**
   * A request the server turned away. `info`, not `warn`: a page left open after a restart asks with its old token until
   * it gives up, and that is no reason to write in the person's terminal. The file keeps it.
   */
  const refuse = (req: IncomingMessage, res: ServerResponse, status: number, error: ApiError): void => {
    log.info('server.http', 'request refused', {
      method: req.method ?? '?',
      path: loggedPath(req.url),
      status,
      reason: error.code,
    });
    sendError(res, status, error);
  };

  /** Nothing at this address: an ordinary answer (a debate with no kept messages is one), so `debug` only. */
  const missing = (req: IncomingMessage, res: ServerResponse, error: ApiError): void => {
    log.debug('server.http', 'nothing found', {
      method: req.method ?? '?',
      path: loggedPath(req.url),
      reason: error.code,
    });
    sendError(res, 404, error);
  };

  const handleApi = async (req: IncomingMessage, res: ServerResponse, path: string): Promise<void> => {
    if (!tokenMatches(bearerOf(req.headers.authorization), token)) {
      refuse(req, res, 401, {
        code: 'unauthorized',
        message: 'This page needs the address that indaba ui printed, with its token.',
        nextAction: 'Start it again with indaba ui.',
      });
      return;
    }
    const parts = path
      .slice(API.length)
      .split('/')
      .filter((part) => part !== '');
    const [head, runId, tail, stepId] = parts;

    if (head === 'contract' && parts.length === 1) {
      const body: ContractResponse = { contractVersion: CONTRACT_VERSION };
      sendJson(res, 200, body);
      return;
    }
    if (head === 'events' && parts.length === 1) {
      await stream(res, { stream: 'server' }, (signal) => streamServer(source, res, signal, pollMs, sleep));
      return;
    }
    if (head !== 'runs') {
      missing(req, res, NOT_FOUND);
      return;
    }
    if (runId === undefined) {
      const body: RunListResponse = { runs: await source.list() };
      sendJson(res, 200, body);
      return;
    }
    const reader = await source.find(runId);
    if (reader === undefined) {
      missing(req, res, { code: 'run_not_found', message: 'No run has this id.' });
      return;
    }
    if (tail === undefined && parts.length === 2) {
      const run = await source.read(runId);
      if (run === undefined) {
        missing(req, res, { code: 'run_not_found', message: 'No run has this id.' });
        return;
      }
      const body: RunResponse = { run };
      sendJson(res, 200, body);
      return;
    }
    if (tail === 'events' && parts.length === 3) {
      const resume = lastEventId(req);
      await stream(res, { stream: 'run', runId, resumedFrom: resume }, (signal) =>
        streamRun(reader, runId, res, signal, { lastEventId: resume, coalesceMs }),
      );
      return;
    }
    if (tail === 'steps' && stepId !== undefined && parts.length === 5 && parts[4] === 'discussion') {
      for (const store of discussions) {
        const discussion = await store.read(runId, stepId);
        if (discussion !== undefined) {
          const body: DiscussionResponse = { discussion };
          sendJson(res, 200, body);
          return;
        }
      }
      missing(req, res, {
        code: 'discussion_not_found',
        message: 'No messages were kept for this step of this run.',
      });
      return;
    }
    if (tail === 'steps' && stepId !== undefined && parts.length === 5 && parts[4] === 'log') {
      const run = await source.read(runId);
      const step = run === undefined ? undefined : stepOf(run, stepId);
      if (step === undefined) {
        missing(req, res, { code: 'step_not_found', message: 'This run has no step with this id.' });
        return;
      }
      const text = `${step.output.join('\n')}${step.partialLine === '' ? '' : `\n${step.partialLine}`}\n`;
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(text);
      return;
    }
    missing(req, res, NOT_FOUND);
  };

  const stream = async (
    res: ServerResponse,
    what: Readonly<Record<string, string | number>>,
    run: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> => {
    const controller = new AbortController();
    open.add(controller);
    res.on('close', () => controller.abort());
    log.info('server.stream', 'stream opened', what);
    try {
      await run(controller.signal);
    } finally {
      open.delete(controller);
      // Ended means the run ended and the server said so; dropped means the page went away or the server closed.
      log.info('server.stream', 'stream closed', { ...what, ended: !controller.signal.aborted });
    }
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!hostAllowed(req.headers.host, port)) {
      refuse(req, res, 421, {
        code: 'host_not_allowed',
        message: 'This server answers only to its own address.',
      });
      return;
    }
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      refuse(req, res, 405, { code: 'method_not_allowed', message: 'This server only reads.' });
      return;
    }
    let path: string;
    try {
      path = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      refuse(req, res, 400, { code: 'bad_request', message: 'The address is not valid.' });
      return;
    }
    if (path === API || path.startsWith(`${API}/`)) {
      await handleApi(req, res, path);
      return;
    }
    const file = await readStatic(options.staticDir, path);
    if (file === undefined) {
      missing(req, res, NOT_FOUND);
      return;
    }
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': file.type,
      'Content-Length': file.body.length,
      'Cache-Control': 'no-cache',
    });
    res.end(file.body);
  };

  const server: Server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      // A fault of the server, not of the request: `error`, so the person sees it, with what the error said. The
      // response names no path; the record may, because it stays on this machine and passes the redaction.
      log.error('server.http', 'request failed', {
        method: req.method ?? '?',
        path: loggedPath(req.url),
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
      if (!res.headersSent) {
        sendError(res, 500, { code: 'internal', message: 'The server could not answer this request.' });
      } else {
        res.end();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  port = (server.address() as AddressInfo).port;
  // The address without its token: the token is the one thing a log must never hold.
  log.info('server.http', 'server started', {
    address: `http://127.0.0.1:${port}/`,
    roots: options.roots.length,
  });

  return {
    url: `http://127.0.0.1:${port}/#token=${token}`,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const controller of open) {
          controller.abort();
        }
        server.close(() => {
          log.info('server.http', 'server stopped', { port });
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}
