import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import {
  type ApiError,
  type ContractResponse,
  type DiscussionResponse,
  LOGGING_SETTINGS,
  type Logger,
  type LoggingSettings,
  type LoggingSettingsCheckResponse,
  type LoggingSettingsResponse,
  noopLogger,
  type RunListResponse,
  type RunResponse,
  resolveLoggingSettings,
  SINK_DEFAULTS,
  type SinkSettings,
  type SinkTestResponse,
} from '@indaba/core';
import { DISCUSSION_DIRECTORY, DiscussionStore } from '@indaba/engine';
import { bearerOf, hostAllowed, originAllowed, SECURITY_HEADERS, tokenMatches } from './checks.js';
import { RunSource, stepOf } from './runs.js';
import { defaultSleep, type Sleep, streamRun, streamServer } from './sse.js';
import { readStatic } from './static.js';

/** The contract between the page and the server; the major is what the page checks. */
export const CONTRACT_VERSION = '1.0.0';

const API = '/api/v1';
const SETTINGS_PATH = `${API}/settings/logging`;
const SINK_TEST_PATH = `${SETTINGS_PATH}/test`;
const SETTINGS_CHECK_PATH = `${SETTINGS_PATH}/check`;

function described(state: LoggingSettingsState): LoggingSettingsResponse {
  return { ...state, descriptions: LOGGING_SETTINGS, sinkDefaults: SINK_DEFAULTS };
}

/**
 * The largest body the server reads, for the one resource it writes. The logging section of a project is a few hundred
 * bytes; this keeps a hostile body from filling memory. A starting value, not a measurement.
 */
export const MAX_BODY_BYTES = 64 * 1024;

/**
 * What the server may do with the logging settings of the project it was started in (specs/logging, AC-20, AC-21):
 * the command line supplies it, with the file, the environment and the sinks that are its own. Without it the server
 * only reads, as in delivery step 1, and the settings answer 404.
 */
/** What the backend knows of the project; the server adds the description of the settings from `@indaba/core`. */
export type LoggingSettingsState = Omit<LoggingSettingsResponse, 'descriptions' | 'sinkDefaults'>;

export interface LoggingSettingsBackend {
  read(): Promise<LoggingSettingsState>;
  /** Writes `indaba.config` through the same writer as `indaba settings`; rejects when it cannot. */
  save(settings: LoggingSettings): Promise<LoggingSettingsState>;
  /** Sends one test record through a sink built from these settings. */
  test(sink: SinkSettings): Promise<SinkTestResponse>;
}
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
  /**
   * The logging settings of the project, readable and writable from the page. This is the one thing the server writes,
   * through one resource (`PUT /api/v1/settings/logging`, and `POST .../test` for a test record), with the token, the
   * `Host` check and the same-origin check; every other request is still read-only.
   */
  readonly loggingSettings?: LoggingSettingsBackend;
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

class BodyProblem extends Error {
  constructor(
    readonly status: number,
    readonly error: ApiError,
  ) {
    super(error.code);
  }
}

/** Reads a JSON body of at most {@link MAX_BODY_BYTES}; anything else is a problem with its own status. */
async function readJson(req: IncomingMessage): Promise<unknown> {
  const type = String(req.headers['content-type'] ?? '')
    .split(';')[0]
    ?.trim()
    .toLowerCase();
  if (type !== 'application/json') {
    throw new BodyProblem(415, { code: 'unsupported_media_type', message: 'Send the settings as JSON.' });
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new BodyProblem(413, { code: 'too_large', message: 'The settings sent are too large.' });
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new BodyProblem(400, { code: 'bad_request', message: 'The settings sent are not valid JSON.' });
  }
}

function fieldOf(body: unknown, key: string): unknown {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Readonly<Record<string, unknown>>)[key]
    : undefined;
}

/** The methods a path accepts. Everything is read-only but the logging settings, and only when the backend exists. */
function methodsOf(path: string, settings: boolean): readonly string[] {
  if (settings && path === SETTINGS_PATH) {
    return ['GET', 'PUT'];
  }
  if (settings && (path === SINK_TEST_PATH || path === SETTINGS_CHECK_PATH)) {
    return ['POST'];
  }
  return ['GET'];
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
 * header. Every request must carry a `Host` the server owns (DNS rebinding) and only `GET` is served, except for the
 * logging settings when `loggingSettings` is given: `PUT` of that one resource and `POST` of its test.
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
    if (head === 'settings' && [SETTINGS_PATH, SINK_TEST_PATH, SETTINGS_CHECK_PATH].includes(path)) {
      await handleSettings(req, res, path);
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

  const handleSettings = async (req: IncomingMessage, res: ServerResponse, path: string): Promise<void> => {
    const backend = options.loggingSettings;
    if (backend === undefined) {
      missing(req, res, {
        code: 'settings_unavailable',
        message: 'This server does not offer the settings.',
      });
      return;
    }
    if (req.method === 'GET') {
      sendJson(res, 200, described(await backend.read()));
      return;
    }
    let body: unknown;
    try {
      body = await readJson(req);
    } catch (error) {
      if (error instanceof BodyProblem) {
        refuse(req, res, error.status, error.error);
        return;
      }
      throw error;
    }
    if (path === SETTINGS_CHECK_PATH) {
      // What saving would say, without saving: the page checks a draft as the person types.
      const checked: LoggingSettingsCheckResponse = {
        problems: resolveLoggingSettings(fieldOf(body, 'logging')).problems,
      };
      sendJson(res, 200, checked);
      return;
    }
    if (path === SINK_TEST_PATH) {
      const checked = resolveLoggingSettings({ sinks: [fieldOf(body, 'sink')] });
      const sink = checked.settings.sinks[0];
      if (checked.problems.length > 0 || sink === undefined) {
        refuse(req, res, 422, {
          code: 'invalid_settings',
          message: 'This sink cannot be tested until its problems are fixed.',
          problems: checked.problems.map((p) => p.replace(/^sinks\[0\]\./, '')),
        });
        return;
      }
      const result = await backend.test(sink);
      log.info('server.settings', 'a test record was sent', { sink: sink.type, ok: result.ok });
      sendJson(res, 200, result);
      return;
    }
    const checked = resolveLoggingSettings(fieldOf(body, 'logging'));
    if (checked.problems.length > 0) {
      refuse(req, res, 422, {
        code: 'invalid_settings',
        message: 'The settings were not saved: fix the problems shown.',
        problems: checked.problems,
      });
      return;
    }
    let saved: LoggingSettingsState;
    try {
      saved = await backend.save(checked.settings);
    } catch (error) {
      log.info('server.settings', 'the settings could not be saved', {
        reason: error instanceof Error ? error.message : String(error),
      });
      refuse(req, res, 409, {
        code: 'not_saved',
        message:
          'indaba.config could not be written. It may not be valid YAML, or the folder may be read-only.',
        nextAction: 'Run indaba settings in a terminal to see why.',
      });
      return;
    }
    log.info('server.settings', 'the logging settings were saved', { sinks: saved.settings.sinks.length });
    sendJson(res, 200, described(saved));
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
    let path: string;
    try {
      path = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      refuse(req, res, 400, { code: 'bad_request', message: 'The address is not valid.' });
      return;
    }
    const allowed = methodsOf(path, options.loggingSettings !== undefined);
    if (!allowed.includes(req.method ?? '')) {
      res.setHeader('Allow', allowed.join(', '));
      refuse(req, res, 405, {
        code: 'method_not_allowed',
        message:
          allowed.length === 1 && allowed[0] === 'GET'
            ? 'This server only reads.'
            : 'This address does not take that.',
      });
      return;
    }
    // A write must come from the page itself: a browser names the page that sent it, and another one is refused even
    // with the token (which another page cannot have; this is a second lock on the same door).
    if (req.method !== 'GET' && !originAllowed(req.headers.origin, port)) {
      refuse(req, res, 403, {
        code: 'origin_not_allowed',
        message: 'Only the page of this server can change settings.',
      });
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
