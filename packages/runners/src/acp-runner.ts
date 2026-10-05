import { resolve } from 'node:path';
import type { AgentSpec, McpCapable, McpServerDefinition, Runner, SpanAttributes } from '@indaba/core';
import {
  DEFAULT_TIMEOUT_SECONDS,
  McpCapability,
  RunnerUnavailableError,
  type RunRequest,
  RunResult,
} from '@indaba/core';
import {
  AcpConnection,
  type AcpHandlers,
  AcpRpcError,
  INVALID_PARAMS,
  METHOD_NOT_FOUND,
} from './acp-connection.js';
import { AcpFileServer, decidePermission, parseOptions, selectOption } from './acp-policy.js';
import {
  NodeStreamingProcessSpawner,
  type ProcessSession,
  type StreamingProcessSpawner,
} from './streaming-process.js';

/** The ACP protocol version this runner speaks. Any other agreed version is a runner that cannot run. */
export const ACP_PROTOCOL_VERSION = 1;

export interface AcpAgentPreset {
  /** The program and its arguments. Never run through a shell. */
  readonly command: readonly string[];
  /** Environment variables with these prefixes are passed on, besides the baseline. */
  readonly envPrefixes?: readonly string[];
}

/**
 * Agents whose own repository documents how to start them in ACP mode. `npx` downloads code when it
 * runs and, on Windows, is a `.cmd` shim that Indaba does not start: use `agent: { command: [...] }`
 * with a native executable there, or when a pinned or locally installed copy is wanted.
 */
export const ACP_AGENT_PRESETS: Readonly<Record<'claude' | 'codex' | 'gemini', AcpAgentPreset>> = {
  claude: {
    command: ['npx', '--yes', '@agentclientprotocol/claude-agent-acp'],
    envPrefixes: ['ANTHROPIC_', 'CLAUDE_'],
  },
  codex: {
    command: ['npx', '--yes', '@agentclientprotocol/codex-acp'],
    envPrefixes: ['OPENAI_', 'CODEX_'],
  },
  gemini: { command: ['gemini', '--acp'], envPrefixes: ['GEMINI_', 'GOOGLE_'] },
};

/** One way an agent offers to log in, as it lists them in its `initialize` answer. */
export interface AuthMethodInfo {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

/**
 * Asked when an agent offers ways to log in and the workflow named none. Returns the id to
 * authenticate with, or undefined to go on without (the agent may already be logged in). A terminal
 * front end asks the person; with none, the runner never asks.
 */
export type AuthChooser = (agent: string, methods: readonly AuthMethodInfo[]) => Promise<string | undefined>;

export interface AcpRunnerOptions {
  readonly spawner?: StreamingProcessSpawner;
  /** Lets a person pick how to log in when the workflow does not say. */
  readonly chooseAuthMethod?: AuthChooser;
  /** Replaces the built-in presets (a composition root can add its own). */
  readonly presets?: Readonly<Record<string, AcpAgentPreset>>;
  /** The environment the agent's own is taken from; only an allowlist of it is passed on. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Extra variables to pass on: exact names, or a prefix ending in `*`. */
  readonly passEnv?: readonly string[];
  /** How long a cancelled agent gets to answer before it is stopped. */
  readonly cancelGraceMs?: number;
}

const BASELINE_NAMES = new Set(
  [
    'PATH',
    'HOME',
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'APPDATA',
    'LOCALAPPDATA',
    'PROGRAMDATA',
    'PROGRAMFILES',
    'SYSTEMROOT',
    'SYSTEMDRIVE',
    'COMSPEC',
    'PATHEXT',
    'TEMP',
    'TMP',
    'TMPDIR',
    'LANG',
    'LANGUAGE',
    'TERM',
    'SHELL',
    'USER',
    'USERNAME',
    'LOGNAME',
    'TZ',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'ALL_PROXY',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
    'NODE_EXTRA_CA_CERTS',
  ].map((name) => name.toUpperCase()),
);
const BASELINE_PREFIXES = ['XDG_', 'LC_', 'NPM_CONFIG_'];
const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH/i;
const MIN_SECRET_LENGTH = 8;
const STDERR_IN_MESSAGE = 300;

function startsWithAny(name: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => name.startsWith(prefix.toUpperCase()));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

type Trip = 'timeout' | 'abort';

/**
 * Drives any agent that speaks the Agent Client Protocol over stdio. The agent is configuration (a
 * preset, or `command` and `args`), not a class. Indaba is the client: it answers the agent's
 * permission requests and, when the step declares `permissions`, serves its file requests, inside the
 * step's scope and nowhere else.
 *
 * Throws RunnerUnavailableError only before the prompt has been written to the agent (it did not
 * start, speaks another protocol version, or needs a login). From then on every outcome is a result.
 */
export class AcpRunner implements Runner, McpCapable {
  readonly name = 'acp';
  private readonly spawner: StreamingProcessSpawner;
  private readonly presets: Readonly<Record<string, AcpAgentPreset>>;
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly passEnv: readonly string[];
  private readonly cancelGraceMs: number;
  private readonly chooseAuthMethod: AuthChooser | undefined;

  constructor(options: AcpRunnerOptions = {}) {
    this.chooseAuthMethod = options.chooseAuthMethod;
    this.spawner = options.spawner ?? new NodeStreamingProcessSpawner();
    this.presets = options.presets ?? ACP_AGENT_PRESETS;
    this.env = options.env ?? {};
    this.passEnv = options.passEnv ?? [];
    this.cancelGraceMs = options.cancelGraceMs ?? 3000;
  }

  mcpCapability(): McpCapability {
    return McpCapability.Injected;
  }

  async run(request: RunRequest, signal?: AbortSignal): Promise<RunResult> {
    const agent = this.resolveAgent(request.agent);
    const workdir = resolve(request.workdir);
    const permissions = request.permissions;
    const emit = (name: string, attributes?: SpanAttributes): void => request.onEvent?.(name, attributes);

    let files: AcpFileServer | undefined;
    if (permissions !== undefined) {
      try {
        files = await AcpFileServer.create(workdir, permissions);
      } catch {
        throw new RunnerUnavailableError('The working directory does not exist.');
      }
    }

    const env = this.environmentFor(agent, request.env);
    const redact = redactor(env);
    const started = performance.now();
    const session: ProcessSession = await this.spawner.start(
      { command: agent.command, cwd: workdir, env },
      signal,
    );

    let output = '';
    let stopReason: string | undefined;
    let sessionId: string | undefined;
    let promptSent = false;
    let costUsd: number | undefined;
    /** An update repeats only the id of its tool call, so the kind is remembered from the call itself. */
    const toolKinds = new Map<string, string>();

    const handlers: AcpHandlers = {
      notification: (method, params) => {
        if (method !== 'session/update' || !isRecord(params) || !isRecord(params.update)) {
          return;
        }
        const update = params.update;
        switch (str(update.sessionUpdate)) {
          case 'agent_message_chunk': {
            const content = update.content;
            const text = isRecord(content) && content.type === 'text' ? str(content.text) : undefined;
            if (text !== undefined && text !== '') {
              output += text;
              request.onOutput?.(text);
            }
            break;
          }
          case 'tool_call':
          case 'tool_call_update': {
            const status = str(update.status);
            const id = str(update.toolCallId);
            const kind = str(update.kind) ?? (id === undefined ? undefined : toolKinds.get(id)) ?? 'other';
            if (id !== undefined && toolKinds.size < 10_000) {
              toolKinds.set(id, kind);
            }
            if (str(update.sessionUpdate) === 'tool_call' || status !== undefined) {
              emit('indaba.acp.tool_call', {
                'acp.tool.kind': kind,
                'acp.tool.status': status ?? 'pending',
              });
            }
            break;
          }
          case 'plan':
            emit('indaba.acp.plan', {
              'acp.plan.entries': Array.isArray(update.entries) ? update.entries.length : 0,
            });
            break;
          case 'usage_update': {
            const used = update.used;
            const size = update.size;
            if (typeof used === 'number' && typeof size === 'number') {
              emit('indaba.acp.usage', { 'acp.context.used': used, 'acp.context.size': size });
            }
            const cost = update.cost;
            // Only what the agent itself reported, and only in a currency we do not have to convert.
            if (isRecord(cost) && cost.currency === 'USD' && typeof cost.amount === 'number') {
              costUsd = cost.amount;
            }
            break;
          }
          default:
            break;
        }
      },
      request: async (method, params) => {
        switch (method) {
          case 'session/request_permission':
            return this.permissionAnswer(params, permissions, workdir, emit);
          case 'fs/read_text_file':
            if (files === undefined) {
              throw new AcpRpcError(METHOD_NOT_FOUND, 'File access was not offered.');
            }
            return await files.read(params);
          case 'fs/write_text_file':
            if (files === undefined) {
              throw new AcpRpcError(METHOD_NOT_FOUND, 'File access was not offered.');
            }
            return await files.write(params);
          default:
            throw new AcpRpcError(METHOD_NOT_FOUND, 'Method not found.');
        }
      },
    };
    const connection = new AcpConnection({ session, handlers });
    void connection.start();

    const timeoutSeconds = request.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
    let wake: (trip: Trip) => void = () => undefined;
    const tripPromise = new Promise<Trip>((resolveTrip) => {
      wake = resolveTrip;
    });
    const trip = (reason: Trip): void => wake(reason);
    const timer = setTimeout(() => trip('timeout'), Math.max(0, timeoutSeconds * 1000));
    const onAbort = (): void => trip('abort');
    if (signal?.aborted === true) {
      trip('abort');
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    const finish = (exitCode: number, errorOutput = ''): RunResult =>
      new RunResult({
        exitCode,
        output,
        errorOutput: redact(errorOutput),
        durationMs: performance.now() - started,
        ...(costUsd !== undefined ? { reportedCostUsd: costUsd } : {}),
      });

    const conversation = async (): Promise<unknown> => {
      const advertised = permissions !== undefined;
      const init = await connection.request('initialize', {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: advertised, writeTextFile: advertised },
          terminal: false,
        },
        clientInfo: { name: 'indaba', version: '0.1.0-alpha.0' },
      });
      if (!isRecord(init) || init.protocolVersion !== ACP_PROTOCOL_VERSION) {
        throw new RunnerUnavailableError(
          `The agent does not speak ACP protocol version ${ACP_PROTOCOL_VERSION}.`,
        );
      }
      emit('indaba.acp.session', { 'acp.protocol_version': ACP_PROTOCOL_VERSION });
      await this.authenticate(connection, init, request.agent?.auth, emit);
      const httpMcp =
        isRecord(init.agentCapabilities) &&
        isRecord(init.agentCapabilities.mcpCapabilities) &&
        init.agentCapabilities.mcpCapabilities.http === true;

      const created = await connection.request('session/new', {
        cwd: workdir,
        mcpServers: mcpServersFor(request.mcpServers ?? [], httpMcp),
      });
      sessionId = isRecord(created) ? str(created.sessionId) : undefined;
      if (sessionId === undefined) {
        throw new RunnerUnavailableError('The agent did not open a session.');
      }

      promptSent = true;
      return await connection.request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: request.prompt }],
      });
    };
    const conversing = conversation().then(
      (response) => ({ kind: 'answered' as const, response }),
      (error: unknown) => ({ kind: 'failed' as const, error }),
    );

    try {
      const first = await Promise.race([
        conversing,
        tripPromise.then((reason) => ({ kind: 'tripped' as const, reason })),
      ]);

      if (first.kind === 'tripped') {
        if (promptSent && sessionId !== undefined) {
          await connection.notify('session/cancel', { sessionId });
          await Promise.race([conversing, sleep(this.cancelGraceMs)]);
        }
        return first.reason === 'timeout'
          ? finish(124, `\nTimed out after ${timeoutSeconds} seconds.`)
          : finish(130, '\nAborted.');
      }

      if (first.kind === 'failed') {
        const detail = redact(first.error instanceof Error ? first.error.message : 'unknown error');
        if (!promptSent) {
          if (first.error instanceof RunnerUnavailableError) {
            throw first.error;
          }
          throw new RunnerUnavailableError(
            `The agent could not start a session: ${detail}${tailOf(session, redact)}`,
          );
        }
        return finish(1, `The agent failed: ${detail}${tailOf(session, redact)}`);
      }

      stopReason = isRecord(first.response) ? str(first.response.stopReason) : undefined;
      emit('indaba.acp.completion', { 'acp.stop_reason': stopReason ?? 'missing' });
      switch (stopReason) {
        case 'end_turn':
          return finish(0);
        case 'cancelled':
          return finish(130, '\nThe agent reported the turn as cancelled.');
        case 'max_tokens':
        case 'max_turn_requests':
        case 'refusal':
          return finish(1, `The agent stopped: ${stopReason}.`);
        default:
          return finish(1, 'The agent ended the turn without a valid stop reason.');
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      await session.kill();
    }
  }

  /**
   * Logs in the way the workflow names, or the way the person picks, when the agent offers any. An agent
   * that lists methods may still accept a session without one and then fail at its first model call, so
   * this is done up front. A failed login is a runner that could not run: nothing has been prompted yet.
   */
  private async authenticate(
    connection: AcpConnection,
    init: Record<string, unknown>,
    configured: string | undefined,
    emit: (name: string, attributes?: SpanAttributes) => void,
  ): Promise<void> {
    const methods = parseAuthMethods(init.authMethods);
    if (methods.length === 0) {
      return;
    }
    let methodId = configured;
    if (methodId !== undefined && !methods.some((m) => m.id === methodId)) {
      throw new RunnerUnavailableError(
        `The agent has no login method "${methodId}". It offers: ${methods.map((m) => m.id).join(', ')}.`,
      );
    }
    if (methodId === undefined && this.chooseAuthMethod !== undefined) {
      const info = isRecord(init.agentInfo) ? init.agentInfo : {};
      const label = str(info.title) ?? str(info.name) ?? 'The agent';
      methodId = await this.chooseAuthMethod(label, methods);
      if (methodId !== undefined && !methods.some((m) => m.id === methodId)) {
        throw new RunnerUnavailableError(
          `The chosen login method "${methodId}" is not one the agent offers.`,
        );
      }
    }
    if (methodId === undefined) {
      return;
    }
    emit('indaba.acp.authenticate', { 'acp.auth.method': methodId });
    try {
      await connection.request('authenticate', { methodId });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown error';
      throw new RunnerUnavailableError(`The agent could not log in with "${methodId}": ${detail}`);
    }
  }

  private permissionAnswer(
    params: unknown,
    permissions: RunRequest['permissions'],
    workdir: string,
    emit: (name: string, attributes?: SpanAttributes) => void,
  ): unknown {
    if (!isRecord(params) || !isRecord(params.toolCall)) {
      throw new AcpRpcError(INVALID_PARAMS, 'A tool call is required.');
    }
    const tool = params.toolCall;
    const kind = str(tool.kind) ?? 'other';
    const locations = Array.isArray(tool.locations)
      ? (tool.locations as unknown[]).flatMap((location) =>
          isRecord(location) && typeof location.path === 'string' ? [location.path] : [],
        )
      : undefined;

    const decision = decidePermission(kind, locations, permissions, workdir);
    const optionId = selectOption(parseOptions(params.options), decision);
    emit('indaba.acp.permission', {
      'acp.tool.kind': kind,
      'acp.permission.decision': decision === 'allowed' && optionId !== undefined ? 'allowed' : 'rejected',
    });
    // An option of the right kind that the agent did not offer is answered as cancelled: never as a guess.
    if (optionId === undefined) {
      return { outcome: { outcome: 'cancelled' } };
    }
    return { outcome: { outcome: 'selected', optionId } };
  }

  private resolveAgent(spec: AgentSpec | undefined): AcpAgentPreset {
    if (spec?.command !== undefined && spec.command.length > 0) {
      return { command: spec.command };
    }
    const name = spec?.preset;
    const preset = name !== undefined && Object.hasOwn(this.presets, name) ? this.presets[name] : undefined;
    if (preset === undefined) {
      const known = Object.keys(this.presets).join(', ');
      throw new RunnerUnavailableError(
        name === undefined
          ? `The acp runner needs an agent: set \`agent\` to a preset (${known}) or to { command: [...] }.`
          : `Unknown ACP agent preset "${name}". Presets: ${known}.`,
      );
    }
    return preset;
  }

  /** Only an allowlist of the host environment reaches the agent, so an unrelated API key does not. */
  private environmentFor(
    agent: AcpAgentPreset,
    extra: Readonly<Record<string, string>> | undefined,
  ): Record<string, string> {
    const exact = new Set(this.passEnv.filter((p) => !p.endsWith('*')).map((p) => p.toUpperCase()));
    const prefixes = [
      ...BASELINE_PREFIXES,
      ...(agent.envPrefixes ?? []),
      ...this.passEnv.filter((p) => p.endsWith('*')).map((p) => p.slice(0, -1)),
    ];
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(this.env)) {
      const upper = name.toUpperCase();
      if (
        value !== undefined &&
        (BASELINE_NAMES.has(upper) || exact.has(upper) || startsWithAny(upper, prefixes))
      ) {
        env[name] = value;
      }
    }
    return { ...env, ...(extra ?? {}) };
  }
}

/** The agent's list of login methods, read defensively; anything malformed is dropped. */
function parseAuthMethods(value: unknown): AuthMethodInfo[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const methods: AuthMethodInfo[] = [];
  for (const item of value as unknown[]) {
    if (isRecord(item) && typeof item.id === 'string' && item.id !== '') {
      const description = str(item.description);
      methods.push({
        id: item.id,
        name: str(item.name) ?? item.id,
        ...(description !== undefined ? { description } : {}),
      });
    }
  }
  return methods;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms).unref();
  });
}

/** Replaces the value of any secret-looking variable we passed on, wherever it shows up in a message. */
function redactor(env: Readonly<Record<string, string>>): (text: string) => string {
  const secrets = Object.entries(env)
    .filter(([name, value]) => SECRET_NAME.test(name) && value.length >= MIN_SECRET_LENGTH)
    .map(([, value]) => value);
  return (text) => secrets.reduce((acc, secret) => acc.replaceAll(secret, '[redacted]'), text);
}

function tailOf(session: ProcessSession, redact: (text: string) => string): string {
  const tail = redact(session.stderrTail().trim());
  return tail === '' ? '' : ` (agent said: ${tail.slice(-STDERR_IN_MESSAGE)})`;
}

/** Indaba's server definitions in ACP's shape. A server only reachable over http, for an agent that cannot, is a runner that cannot run. */
function mcpServersFor(servers: readonly McpServerDefinition[], httpSupported: boolean): unknown[] {
  return servers.map((server) => {
    if (server.command !== undefined) {
      return {
        name: server.name,
        command: server.command,
        args: [...server.args],
        env: Object.entries(server.env).map(([name, value]) => ({ name, value })),
      };
    }
    if (server.url !== undefined && httpSupported) {
      return { type: 'http', name: server.name, url: server.url, headers: [] };
    }
    throw new RunnerUnavailableError(
      `The agent cannot use the MCP server "${server.name}" (it needs http support).`,
    );
  });
}
