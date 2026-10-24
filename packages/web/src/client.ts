import type {
  ApiError,
  CatalogPermissionsView,
  ContractResponse,
  DiscussionView,
  EditorCatalog,
  EditorResponse,
  FullAccessStep,
  JsonObject,
  JsonValue,
  LoggingSettingsResponse,
  RegistryAddRootResponse,
  RegistryAnnotateRequest,
  RegistryCopyRequest,
  RegistryCopyResponse,
  RegistryEntryView,
  RegistryListResponse,
  RegistryResolveRootResponse,
  RegistryRootView,
  RegistryScanReportView,
  RegistryScanResponse,
  RunSnapshot,
  RunSummary,
  RunSummaryOfUse,
  ServerStreamEvent,
  SinkTestResponse,
  StartStatusResponse,
  WorkflowEdit,
  WorkflowListResponse,
  WorkflowProblem,
  WorkflowSourceResponse,
  WorkflowSummary,
} from '@indaba/core';
import { SseParser } from './sse.js';

/** The contract major this page speaks (`specs/web-app/api-surface.md`). A server with a newer one is refused. */
export const CONTRACT_MAJOR = 1;

export const API = '/api/v1';

/** What went wrong, in the terms the page shows: each kind has one screen and one next action. */
export type Failure =
  | { readonly kind: 'unauthorized' }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'newer_contract' }
  | { readonly kind: 'not_found'; readonly message: string }
  | { readonly kind: 'server'; readonly message: string };

export class ApiFailure extends Error {
  constructor(readonly failure: Failure) {
    super(failure.kind);
    this.name = 'ApiFailure';
  }
}

/** The state of a stream, for the badge in the header and the banner of a dropped connection. */
export type StreamState = 'connecting' | 'live' | 'reconnecting' | 'unavailable' | 'ended';

export interface StreamHandlers<T> {
  onEvent(event: T): void;
  onState(state: StreamState): void;
  /** A failure retrying cannot fix (the token, a missing run); the stream stops. */
  onFailure(failure: Failure): void;
}

export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

export interface ClientOptions {
  readonly token: string;
  readonly fetch: typeof fetch;
  /** Waits between reconnects; tests replace it. */
  readonly sleep?: Sleep;
  /** The first wait after a drop; doubled up to {@link MAX_RETRY_MS}. Default 500. */
  readonly retryMs?: number;
  /** Failed attempts in a row after which the stream stops asking and reports `unavailable`. Default {@link MAX_FAILED_ATTEMPTS}. */
  readonly giveUpAfter?: number;
}

export const MAX_RETRY_MS = 5000;

/**
 * Failed attempts in a row after which a stream stops asking a server that is not there (specs/web-app, the health
 * answer of 2026-10-21). A starting value, not a measurement: with the waits above it is about half a minute.
 */
export const MAX_FAILED_ATTEMPTS = 8;

/** A run as the page opens it: its snapshot, and whether this server may stop it (contract 1.1). */
export interface RunView {
  readonly run: RunSnapshot;
  readonly canStop: boolean;
}

/** What asking to start a run gave: started, a confirmation to show first, or a refusal by its code. */
export type StartAnswer =
  | { readonly kind: 'started'; readonly startId: string }
  | { readonly kind: 'confirm'; readonly contentHash: string; readonly use: RunSummaryOfUse }
  | { readonly kind: 'full_access'; readonly contentHash: string; readonly steps: readonly FullAccessStep[] }
  | { readonly kind: 'refused'; readonly code: string; readonly problems: readonly string[] };

/** What saving a workflow's text gave: saved, a conflict with the version on disk, or a refusal by its code. */
export type SaveSourceAnswer =
  | { readonly kind: 'saved'; readonly contentHash: string; readonly problems: readonly WorkflowProblem[] }
  | { readonly kind: 'changed'; readonly current: { readonly text: string; readonly contentHash: string } }
  | { readonly kind: 'refused'; readonly code: string };

/** What an edit of a draft gave: the new text and value, a text the form cannot read, or one edit refused. */
export type EditAnswer =
  | {
      readonly kind: 'edited';
      readonly text: string;
      readonly value: JsonObject;
      readonly problems: readonly WorkflowProblem[];
    }
  | { readonly kind: 'not_editable'; readonly message: string }
  | { readonly kind: 'refused'; readonly message: string; readonly index: number };

/** What asking to stop a run gave. */
export type StopAnswer =
  | { readonly kind: 'stopping' }
  | { readonly kind: 'ended' }
  | { readonly kind: 'refused'; readonly code: string };

/**
 * What a change to the registry gave: its answer, or a refusal by its code (the page words it). A server that does not
 * offer the registry is `unavailable`.
 */
export type RegistryAnswer<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'refused'; readonly code: string }
  | { readonly kind: 'unavailable' };

export interface Client {
  contract(): Promise<ContractResponse>;
  runs(): Promise<readonly RunSummary[]>;
  run(id: string): Promise<RunView>;
  /** The workflows the server can start, or undefined when it does not start runs (specs/web-app-actions). */
  workflows(): Promise<WorkflowListResponse | undefined>;
  /**
   * Asks to start a workflow by its id; with the hash of a confirmation the person gave, confirms that content. The
   * second hash says the person saw the steps with full access listed for that content (specs/agent-permissions, AC-05).
   */
  startRun(
    workflowId: string,
    confirmedHash?: string,
    fullAccessConfirmedHash?: string,
  ): Promise<StartAnswer>;
  /** Where a start is: starting, running with its trace id, or failed with its reason. */
  startStatus(startId: string): Promise<StartStatusResponse>;
  /** Asks a run this server started to stop, as Ctrl+C would. */
  stopRun(runId: string): Promise<StopAnswer>;
  /**
   * Every entry of the workflow registry and the folders it covers, or undefined when this server does not offer it
   * (specs/web-app-registry).
   */
  registry(): Promise<RegistryListResponse | undefined>;
  /** Scans every folder now and says what changed. */
  scanRegistry(): Promise<RegistryAnswer<RegistryScanResponse>>;
  annotateEntry(id: string, request: RegistryAnnotateRequest): Promise<RegistryAnswer<RegistryEntryView>>;
  copyEntry(id: string, request: RegistryCopyRequest): Promise<RegistryAnswer<RegistryCopyResponse>>;
  /** Takes an entry off the list; never deletes the file. */
  removeEntry(id: string): Promise<RegistryAnswer<null>>;
  /** What a typed path resolves to; nothing is added. */
  resolveFolder(path: string): Promise<RegistryAnswer<RegistryResolveRootResponse>>;
  /** Adds the folder the person confirmed, exactly as `resolveFolder` showed it. */
  addFolder(folder: string): Promise<RegistryAnswer<RegistryAddRootResponse>>;
  /** The text of a workflow file (specs/web-app-editing-core). A refusal is an `ApiFailure` with the server's words. */
  workflowSource(workflowId: string): Promise<WorkflowSourceResponse>;
  /** Saves the text against the hash it was read with. */
  saveWorkflowSource(workflowId: string, text: string, baseHash: string): Promise<SaveSourceAnswer>;
  /** The problems of a draft, or undefined when this server does not open workflow files. Nothing is saved. */
  checkWorkflow(text: string): Promise<readonly WorkflowProblem[] | undefined>;
  /** The schema and catalog of the form, or undefined when this server does not edit as a form (specs/web-app-editing-forms). */
  editor(): Promise<EditorResponse | undefined>;
  /** Applies edits to a draft; nothing is saved. */
  editWorkflow(text: string, edits: readonly WorkflowEdit[]): Promise<EditAnswer>;
  /** Follows one run until it ends or `signal` aborts, resuming after a drop with the last event id. */
  followRun(id: string, handlers: StreamHandlers<RunSnapshot>, signal: AbortSignal): Promise<void>;
  /** Follows the server-wide stream: a run started or ended. */
  followServer(handlers: StreamHandlers<ServerStreamEvent>, signal: AbortSignal): Promise<void>;
  /** The output of a step as the server keeps it, as plain text. */
  stepLog(runId: string, stepId: string): Promise<string>;
  /** The kept messages of a debate step, or undefined when the run kept none. */
  discussion(runId: string, stepId: string): Promise<DiscussionView | undefined>;
  /** The logging settings of the project, or undefined when this server does not offer them (specs/logging, AC-20). */
  loggingSettings(): Promise<LoggingSettingsResponse | undefined>;
  /** The problems of a draft `logging:` section, by the server's own rules; nothing is saved. */
  checkLoggingSettings(logging: unknown): Promise<readonly string[]>;
  /** Saves a `logging:` section; refused settings come back as their problems. */
  saveLoggingSettings(logging: unknown): Promise<SettingsAnswer>;
  /** Sends one test record through a sink entry. */
  testLogSink(sink: unknown): Promise<SinkTestResponse>;
}

/** What saving settings gave: the settings now in use, or the problems that kept them from being saved. */
export type SettingsAnswer =
  | { readonly saved: true; readonly settings: LoggingSettingsResponse }
  | { readonly saved: false; readonly message: string; readonly problems: readonly string[] };

const defaultSleep: Sleep = (ms, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isApiError(value: unknown): value is ApiError {
  return isRecord(value) && typeof value.code === 'string' && typeof value.message === 'string';
}

/** Whether a value has the shape of a run snapshot well enough to render; the server built it, but it crossed a wire. */
export function isRunSnapshot(value: unknown): value is RunSnapshot {
  return (
    isRecord(value) &&
    typeof value.status === 'string' &&
    Array.isArray(value.steps) &&
    Array.isArray(value.notes) &&
    isRecord(value.cost)
  );
}

function isDiscussion(value: unknown): value is DiscussionView {
  return (
    isRecord(value) &&
    typeof value.outcome === 'string' &&
    typeof value.rounds === 'number' &&
    Array.isArray(value.messages) &&
    value.messages.every(
      (m: unknown) =>
        isRecord(m) &&
        typeof m.round === 'number' &&
        typeof m.sender === 'string' &&
        typeof m.type === 'string' &&
        typeof m.content === 'string',
    )
  );
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** A cost the page can show: a sum of dollars that is a real number, and counts that are whole and not negative. */
function isRunCost(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.usd === 'number' &&
    Number.isFinite(value.usd) &&
    value.usd >= 0 &&
    isCount(value.unknown) &&
    isCount(value.calls)
  );
}

/** Settings the page can show; the server built them, but they crossed a wire. */
export function isSettingsResponse(value: unknown): value is LoggingSettingsResponse {
  return (
    isRecord(value) &&
    isRecord(value.settings) &&
    typeof value.settings.level === 'string' &&
    Array.isArray(value.settings.sinks) &&
    value.settings.sinks.every((sink: unknown) => isRecord(sink) && typeof sink.type === 'string') &&
    typeof value.path === 'string' &&
    typeof value.present === 'boolean' &&
    isRecord(value.variables) &&
    Array.isArray(value.descriptions) &&
    isRecord(value.sinkDefaults)
  );
}

function problemsOf(value: unknown): readonly string[] {
  const list: unknown = isRecord(value) ? value.problems : undefined;
  return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : [];
}

export function isRunSummary(value: unknown): value is RunSummary {
  return (
    isRecord(value) &&
    typeof value.runId === 'string' &&
    typeof value.status === 'string' &&
    isRunCost(value.cost)
  );
}

const isStrings = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isCount0 = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

function isRegistryEntry(value: unknown): value is RegistryEntryView {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.project !== 'string' ||
    !isStrings(value.tags) ||
    typeof value.hidden !== 'boolean' ||
    typeof value.path !== 'string' ||
    typeof value.rootId !== 'string' ||
    typeof value.removable !== 'boolean' ||
    !['scanned', 'added', 'created', 'copied'].includes(String(value.origin)) ||
    (value.lastRun !== undefined && !isRunSummary(value.lastRun))
  ) {
    return false;
  }
  const validation = value.validation;
  if (!isRecord(validation)) {
    return false;
  }
  return (
    validation.state === 'valid' ||
    (validation.state === 'invalid' && typeof validation.message === 'string') ||
    (validation.state === 'missing' && typeof validation.reason === 'string')
  );
}

const isRegistryRoot = (value: unknown): value is RegistryRootView =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.name === 'string' &&
  typeof value.folder === 'string' &&
  typeof value.readable === 'boolean';

const isScanReport = (value: unknown): value is RegistryScanReportView =>
  isRecord(value) &&
  typeof value.rootId === 'string' &&
  [value.found, value.added, value.changed, value.moved, value.missing, value.invalid].every(isCount0) &&
  typeof value.truncated === 'boolean' &&
  typeof value.recovered === 'boolean';

/** A write to the registry that was not answered with its result: a refusal by its code, or a server without it. */
function registryRefusal(answer: { readonly status: number; readonly body: unknown }): {
  readonly kind: 'refused' | 'unavailable';
  readonly code: string;
} {
  if (
    answer.status === 405 ||
    (answer.status === 404 && isApiError(answer.body) && answer.body.code === 'registry_unavailable')
  ) {
    return { kind: 'unavailable', code: 'registry_unavailable' };
  }
  return { kind: 'refused', code: isApiError(answer.body) ? answer.body.code : 'other' };
}

function isWorkflowSummary(value: unknown): value is WorkflowSummary {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.path === 'string' &&
    typeof value.project === 'string' &&
    typeof value.valid === 'boolean' &&
    isStrings(value.problems)
  );
}

function isFullAccessStep(value: unknown): value is FullAccessStep {
  return isRecord(value) && typeof value.stepId === 'string' && isStrings(value.runners);
}

function isFullAccessSteps(value: unknown): value is readonly FullAccessStep[] {
  return Array.isArray(value) && value.every(isFullAccessStep);
}

/** A server older than the list of full-access steps sends none: that reads as no step at full access. */
function summaryOfUse(value: unknown): RunSummaryOfUse | undefined {
  if (
    !isRecord(value) ||
    !isStrings(value.runners) ||
    !isStrings(value.commands) ||
    !isStrings(value.permissions) ||
    !isStrings(value.needsPerson) ||
    (value.fullAccessSteps !== undefined && !isFullAccessSteps(value.fullAccessSteps))
  ) {
    return undefined;
  }
  return {
    runners: value.runners,
    commands: value.commands,
    permissions: value.permissions,
    needsPerson: value.needsPerson,
    fullAccessSteps: value.fullAccessSteps ?? [],
  };
}

function isProblem(value: unknown): value is WorkflowProblem {
  return (
    isRecord(value) &&
    typeof value.message === 'string' &&
    (value.path === undefined || typeof value.path === 'string') &&
    (value.line === undefined || isCount(value.line)) &&
    (value.column === undefined || isCount(value.column))
  );
}

/** Whether a value is JSON: it came from `response.json()`, so this tells the compiler more than it checks. */
function isJson(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    typeof value === 'number'
  ) {
    return true;
  }
  return Array.isArray(value) ? value.every(isJson) : isRecord(value) && Object.values(value).every(isJson);
}

const isJsonObject = (value: unknown): value is JsonObject => isRecord(value) && isJson(value);

const isEntries = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.every((e) => isRecord(e) && typeof e.name === 'string' && typeof e.description === 'string');

function isCatalog(value: unknown): value is EditorCatalog {
  if (!isRecord(value) || value.catalog !== 1 || !isRecord(value.values)) {
    return false;
  }
  const lists = ['runners', 'guards', 'arbiters', 'voters', 'prompts'];
  const values = ['decisionTypes', 'isolation', 'failureActions', 'mcpPolicies', 'promptAdditions'];
  const of = value.values;
  return lists.every((key) => isEntries(value[key])) && values.every((key) => isStrings(of[key]));
}

const MODES: readonly unknown[] = ['native', 'acp', 'after', 'none', 'unsupported'];
const SCOPES: readonly unknown[] = ['acp', 'guard', 'none'];

function isPermissionView(value: unknown): boolean {
  return (
    isRecord(value) &&
    MODES.includes(value.mode) &&
    SCOPES.includes(value.scope) &&
    typeof value.note === 'string'
  );
}

/**
 * What the catalog says of the levels of a runner (specs/agent-permissions, AC-16), or nothing when it is not all three
 * levels in the shape of the contract: the form then refuses nothing, rather than act on a map it cannot read.
 */
function permissionsOf(value: unknown): CatalogPermissionsView | undefined {
  if (
    !isRecord(value) ||
    !isPermissionView(value.read) ||
    !isPermissionView(value.edit) ||
    !isPermissionView(value.full)
  ) {
    return undefined;
  }
  return value as unknown as CatalogPermissionsView;
}

/** The catalog as the page uses it: each runner keeps its permission map only when the map can be read. */
function readCatalog(value: EditorCatalog): EditorCatalog {
  return {
    ...value,
    runners: value.runners.map((entry) => {
      const permissions = permissionsOf((entry as { permissions?: unknown }).permissions);
      return permissions === undefined
        ? { name: entry.name, description: entry.description }
        : { name: entry.name, description: entry.description, permissions };
    }),
  };
}

const problemsIn = (value: unknown): readonly WorkflowProblem[] =>
  Array.isArray(value) ? value.filter(isProblem) : [];

function isSource(value: unknown): value is WorkflowSourceResponse {
  return (
    isRecord(value) &&
    isWorkflowSummary(value.workflow) &&
    typeof value.text === 'string' &&
    typeof value.contentHash === 'string' &&
    Array.isArray(value.problems)
  );
}

function isStartStatus(value: unknown): value is StartStatusResponse {
  return (
    isRecord(value) &&
    (value.state === 'starting' || value.state === 'running' || value.state === 'failed') &&
    (value.runId === undefined || typeof value.runId === 'string') &&
    (value.failure === undefined || typeof value.failure === 'string')
  );
}

/** The major of a version such as `1.2.0`; NaN when it has none. */
export function majorOf(version: string): number {
  return Number.parseInt(version.split('.')[0] ?? '', 10);
}

async function failureOf(response: Response): Promise<Failure> {
  if (response.status === 401) {
    return { kind: 'unauthorized' };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const message = isApiError(body) ? body.message : `The server answered ${response.status}.`;
  return response.status === 404 ? { kind: 'not_found', message } : { kind: 'server', message };
}

export function createClient(options: ClientOptions): Client {
  const sleep = options.sleep ?? defaultSleep;
  const firstRetry = options.retryMs ?? 500;
  const giveUpAfter = options.giveUpAfter ?? MAX_FAILED_ATTEMPTS;
  const headers = (extra: Readonly<Record<string, string>> = {}): Record<string, string> => ({
    Authorization: `Bearer ${options.token}`,
    ...extra,
  });

  const request = async (path: string, signal?: AbortSignal): Promise<Response> => {
    let response: Response;
    try {
      response = await options.fetch(`${API}${path}`, { headers: headers(), ...(signal ? { signal } : {}) });
    } catch {
      throw new ApiFailure({ kind: 'unreachable' });
    }
    if (!response.ok) {
      throw new ApiFailure(await failureOf(response));
    }
    return response;
  };

  /** A write: JSON in, JSON out. A 422 is an answer (the problems), not a failure. */
  const send = async (
    method: 'PUT' | 'POST',
    path: string,
    body: unknown,
  ): Promise<{ readonly status: number; readonly body: unknown }> => {
    let response: Response;
    try {
      response = await options.fetch(`${API}${path}`, {
        method,
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
    } catch {
      throw new ApiFailure({ kind: 'unreachable' });
    }
    if (!response.ok && response.status !== 422) {
      throw new ApiFailure(await failureOf(response));
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new ApiFailure({ kind: 'server', message: 'The server sent something this page cannot read.' });
    }
    return { status: response.status, body: parsed };
  };

  /**
   * A write whose every answer is one the page shows (a refusal has a code, never a status): only a missing token and an
   * unreachable server are failures.
   */
  const post = async (
    path: string,
    body?: unknown,
    method: 'POST' | 'PUT' = 'POST',
  ): Promise<{ readonly status: number; readonly body: unknown }> => {
    let response: Response;
    try {
      response = await options.fetch(`${API}${path}`, {
        method,
        headers: headers(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiFailure({ kind: 'unreachable' });
    }
    if (response.status === 401) {
      throw new ApiFailure({ kind: 'unauthorized' });
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      parsed = undefined;
    }
    return { status: response.status, body: parsed };
  };

  const json = async (path: string): Promise<unknown> => {
    const response = await request(path);
    try {
      return await response.json();
    } catch {
      throw new ApiFailure({ kind: 'server', message: 'The server sent something this page cannot read.' });
    }
  };

  /** One stream, reconnecting after a drop until it ends, fails for good or is aborted. */
  const follow = async <T>(
    path: string,
    read: (event: string, data: unknown) => T | undefined,
    resume: boolean,
    handlers: StreamHandlers<T>,
    signal: AbortSignal,
  ): Promise<void> => {
    let lastId = 0;
    let failures = 0;
    let wait = firstRetry;
    let first = true;
    while (!signal.aborted) {
      handlers.onState(first ? 'connecting' : 'reconnecting');
      first = false;
      let response: Response | undefined;
      try {
        response = await options.fetch(`${API}${path}`, {
          headers: headers(resume && lastId > 0 ? { 'Last-Event-ID': String(lastId) } : {}),
          signal,
        });
      } catch {
        response = undefined;
      }
      if (signal.aborted) {
        return;
      }
      if (response !== undefined && (response.status === 401 || response.status === 404)) {
        handlers.onFailure(await failureOf(response));
        return;
      }
      if (response?.ok === true && response.body !== null) {
        handlers.onState('live');
        wait = firstRetry;
        failures = 0;
        const parser = new SseParser();
        const decoder = new TextDecoder();
        const reader = response.body.getReader();
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) {
              break;
            }
            for (const event of parser.push(decoder.decode(value, { stream: true }))) {
              if (event.event === 'end') {
                handlers.onState('ended');
                return;
              }
              let data: unknown;
              try {
                data = JSON.parse(event.data);
              } catch {
                continue;
              }
              const item = read(event.event, data);
              if (item !== undefined) {
                lastId = event.id ?? lastId;
                handlers.onEvent(item);
              }
            }
          }
        } catch {
          // The connection dropped mid-stream: reconnect below.
        }
      }
      if (signal.aborted) {
        return;
      }
      failures += 1;
      if (failures >= giveUpAfter) {
        handlers.onState('unavailable');
        return;
      }
      handlers.onState('reconnecting');
      await sleep(wait, signal);
      wait = Math.min(wait * 2, MAX_RETRY_MS);
    }
  };

  return {
    async contract() {
      const body = await json('/contract');
      if (!isRecord(body) || typeof body.contractVersion !== 'string') {
        throw new ApiFailure({ kind: 'server', message: 'The server did not say which contract it speaks.' });
      }
      if (majorOf(body.contractVersion) > CONTRACT_MAJOR) {
        throw new ApiFailure({ kind: 'newer_contract' });
      }
      return { contractVersion: body.contractVersion };
    },

    async runs() {
      const body = await json('/runs');
      const list: unknown = isRecord(body) ? body.runs : undefined;
      const items: readonly unknown[] = Array.isArray(list) ? list : [];
      return items.filter(isRunSummary);
    },

    async run(id) {
      const body = await json(`/runs/${encodeURIComponent(id)}`);
      const run: unknown = isRecord(body) ? body.run : undefined;
      if (!isRunSnapshot(run)) {
        throw new ApiFailure({ kind: 'server', message: 'The server sent a run this page cannot read.' });
      }
      // A server of contract 1.0 does not say; it cannot stop runs either.
      return { run, canStop: isRecord(body) && body.canStop === true };
    },

    async workflows() {
      let body: unknown;
      try {
        body = await json('/workflows');
      } catch (error) {
        if (error instanceof ApiFailure && error.failure.kind === 'not_found') {
          return undefined;
        }
        throw error;
      }
      const list: unknown = isRecord(body) ? body.workflows : undefined;
      if (!Array.isArray(list)) {
        throw new ApiFailure({ kind: 'server', message: 'The server sent a list this page cannot read.' });
      }
      return {
        workflows: list.filter(isWorkflowSummary),
        truncated: isRecord(body) && body.truncated === true,
      };
    },

    async startRun(workflowId, confirmedHash, fullAccessConfirmedHash) {
      const answer = await post('/runs', {
        workflowId,
        ...(confirmedHash === undefined ? {} : { confirmedHash }),
        ...(fullAccessConfirmedHash === undefined ? {} : { fullAccessConfirmedHash }),
      });
      const body = answer.body;
      if (answer.status === 202 && isRecord(body) && typeof body.startId === 'string') {
        return { kind: 'started', startId: body.startId };
      }
      const use = isRecord(body) ? summaryOfUse(body.use) : undefined;
      if (
        isRecord(body) &&
        body.code === 'confirmation_required' &&
        typeof body.contentHash === 'string' &&
        use !== undefined
      ) {
        return { kind: 'confirm', contentHash: body.contentHash, use };
      }
      if (
        isRecord(body) &&
        body.code === 'full_access_required' &&
        typeof body.contentHash === 'string' &&
        isFullAccessSteps(body.steps)
      ) {
        return { kind: 'full_access', contentHash: body.contentHash, steps: body.steps };
      }
      return { kind: 'refused', code: isApiError(body) ? body.code : 'other', problems: problemsOf(body) };
    },

    async startStatus(startId) {
      const body = await json(`/starts/${encodeURIComponent(startId)}`);
      if (!isStartStatus(body)) {
        throw new ApiFailure({ kind: 'server', message: 'The server sent a start this page cannot read.' });
      }
      return body;
    },

    async workflowSource(workflowId) {
      const body = await json(`/workflows/${encodeURIComponent(workflowId)}/source`);
      if (!isSource(body)) {
        throw new ApiFailure({ kind: 'server', message: 'The server sent a file this page cannot read.' });
      }
      return { ...body, problems: problemsIn(body.problems) };
    },

    async saveWorkflowSource(workflowId, text, baseHash) {
      const answer = await post(
        `/workflows/${encodeURIComponent(workflowId)}/source`,
        { text, baseHash },
        'PUT',
      );
      const body = answer.body;
      if (answer.status === 200 && isRecord(body) && typeof body.contentHash === 'string') {
        return { kind: 'saved', contentHash: body.contentHash, problems: problemsIn(body.problems) };
      }
      const current: unknown = isRecord(body) ? body.current : undefined;
      if (
        isRecord(body) &&
        body.code === 'changed_on_disk' &&
        isRecord(current) &&
        typeof current.text === 'string' &&
        typeof current.contentHash === 'string'
      ) {
        return { kind: 'changed', current: { text: current.text, contentHash: current.contentHash } };
      }
      return { kind: 'refused', code: isApiError(body) ? body.code : 'other' };
    },

    async checkWorkflow(text) {
      const answer = await post('/workflows/check', { text });
      if (answer.status === 404 || answer.status === 405) {
        return undefined;
      }
      return problemsIn(isRecord(answer.body) ? answer.body.problems : undefined);
    },

    async editor() {
      let body: unknown;
      try {
        body = await json('/editor');
      } catch (error) {
        if (error instanceof ApiFailure && error.failure.kind === 'not_found') {
          return undefined;
        }
        throw error;
      }
      if (!isRecord(body) || !isJsonObject(body.schema) || !isCatalog(body.catalog)) {
        throw new ApiFailure({ kind: 'server', message: 'The server sent a form this page cannot read.' });
      }
      return { schema: body.schema, catalog: readCatalog(body.catalog) };
    },

    async editWorkflow(text, edits) {
      const answer = await post('/workflows/edit', { text, edits });
      const body = answer.body;
      if (
        answer.status === 200 &&
        isRecord(body) &&
        typeof body.text === 'string' &&
        isJsonObject(body.value)
      ) {
        return { kind: 'edited', text: body.text, value: body.value, problems: problemsIn(body.problems) };
      }
      if (answer.status === 422 && isApiError(body) && body.code === 'not_editable') {
        return { kind: 'not_editable', message: body.message };
      }
      const index: unknown = isRecord(body) ? body.index : undefined;
      if (answer.status === 422 && isApiError(body) && body.code === 'edit_refused' && isCount(index)) {
        return { kind: 'refused', message: body.message, index };
      }
      throw new ApiFailure({
        kind: 'server',
        message: isApiError(body) ? body.message : 'The server did not apply the change.',
      });
    },

    async stopRun(runId) {
      const answer = await post(`/runs/${encodeURIComponent(runId)}/stop`);
      const state = isRecord(answer.body) ? answer.body.state : undefined;
      if (answer.status === 202 && state === 'stopping') {
        return { kind: 'stopping' };
      }
      if (answer.status === 200 && state === 'ended') {
        return { kind: 'ended' };
      }
      return { kind: 'refused', code: isApiError(answer.body) ? answer.body.code : 'other' };
    },

    async registry() {
      let body: unknown;
      try {
        body = await json('/registry');
      } catch (error) {
        if (error instanceof ApiFailure && error.failure.kind === 'not_found') {
          return undefined;
        }
        throw error;
      }
      if (
        !isRecord(body) ||
        !Array.isArray(body.entries) ||
        !body.entries.every(isRegistryEntry) ||
        !Array.isArray(body.roots) ||
        !body.roots.every(isRegistryRoot) ||
        typeof body.truncated !== 'boolean'
      ) {
        throw new ApiFailure({ kind: 'server', message: 'The server sent a list this page cannot read.' });
      }
      return { entries: body.entries, roots: body.roots, truncated: body.truncated };
    },

    async scanRegistry() {
      const answer = await post('/registry/scan');
      const body = answer.body;
      if (
        answer.status === 200 &&
        isRecord(body) &&
        Array.isArray(body.reports) &&
        body.reports.every(isScanReport)
      ) {
        return { kind: 'ok', value: { reports: body.reports } };
      }
      return registryRefusal(answer);
    },

    async annotateEntry(id, request) {
      const answer = await post(`/registry/${encodeURIComponent(id)}/annotate`, request);
      return answer.status === 200 && isRegistryEntry(answer.body)
        ? { kind: 'ok', value: answer.body }
        : registryRefusal(answer);
    },

    async copyEntry(id, request) {
      const answer = await post(`/registry/${encodeURIComponent(id)}/copy`, request);
      const body = answer.body;
      if (
        answer.status === 200 &&
        isRecord(body) &&
        isRegistryEntry(body.entry) &&
        isStrings(body.toReview)
      ) {
        return { kind: 'ok', value: { entry: body.entry, toReview: body.toReview } };
      }
      return registryRefusal(answer);
    },

    async removeEntry(id) {
      const answer = await post(`/registry/${encodeURIComponent(id)}/remove`);
      return answer.status === 204 ? { kind: 'ok', value: null } : registryRefusal(answer);
    },

    async resolveFolder(path) {
      const answer = await post('/registry/roots/resolve', { path });
      const body = answer.body;
      if (
        answer.status === 200 &&
        isRecord(body) &&
        typeof body.folder === 'string' &&
        typeof body.name === 'string' &&
        typeof body.alreadyCovered === 'boolean' &&
        isCount0(body.found) &&
        typeof body.atLeast === 'boolean'
      ) {
        return {
          kind: 'ok',
          value: {
            folder: body.folder,
            name: body.name,
            alreadyCovered: body.alreadyCovered,
            found: body.found,
            atLeast: body.atLeast,
          },
        };
      }
      return registryRefusal(answer);
    },

    async addFolder(folder) {
      const answer = await post('/registry/roots', { folder });
      const body = answer.body;
      if (
        answer.status === 200 &&
        isRecord(body) &&
        isRegistryRoot(body.root) &&
        typeof body.alreadyCovered === 'boolean' &&
        isScanReport(body.report)
      ) {
        return {
          kind: 'ok',
          value: { root: body.root, alreadyCovered: body.alreadyCovered, report: body.report },
        };
      }
      return registryRefusal(answer);
    },

    followRun(id, handlers, signal) {
      return follow<RunSnapshot>(
        `/runs/${encodeURIComponent(id)}/events`,
        (event, data) => {
          const run: unknown = event === 'snapshot' && isRecord(data) ? data.run : undefined;
          return isRunSnapshot(run) ? run : undefined;
        },
        true,
        handlers,
        signal,
      );
    },

    followServer(handlers, signal) {
      return follow<ServerStreamEvent>(
        '/events',
        (event, data) => {
          if (event !== 'run' || !isRecord(data) || typeof data.id !== 'number' || !isRunSummary(data.run)) {
            return undefined;
          }
          const { id, kind, run } = data;
          return kind === 'run_started' || kind === 'run_ended' ? { id, kind, run } : undefined;
        },
        false,
        handlers,
        signal,
      );
    },

    async discussion(runId, stepId) {
      let body: unknown;
      try {
        body = await json(
          `/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/discussion`,
        );
      } catch (error) {
        if (error instanceof ApiFailure && error.failure.kind === 'not_found') {
          return undefined;
        }
        throw error;
      }
      const found: unknown = isRecord(body) ? body.discussion : undefined;
      if (!isDiscussion(found)) {
        throw new ApiFailure({
          kind: 'server',
          message: 'The server sent a discussion this page cannot read.',
        });
      }
      return found;
    },

    async loggingSettings() {
      let body: unknown;
      try {
        body = await json('/settings/logging');
      } catch (error) {
        if (error instanceof ApiFailure && error.failure.kind === 'not_found') {
          return undefined;
        }
        throw error;
      }
      if (!isSettingsResponse(body)) {
        throw new ApiFailure({ kind: 'server', message: 'The server sent settings this page cannot read.' });
      }
      return body;
    },

    async checkLoggingSettings(logging) {
      return problemsOf((await send('POST', '/settings/logging/check', { logging })).body);
    },

    async saveLoggingSettings(logging) {
      const answer = await send('PUT', '/settings/logging', { logging });
      if (answer.status === 422) {
        const message = isApiError(answer.body) ? answer.body.message : 'The settings were not saved.';
        return { saved: false, message, problems: problemsOf(answer.body) };
      }
      if (!isSettingsResponse(answer.body)) {
        throw new ApiFailure({ kind: 'server', message: 'The server sent settings this page cannot read.' });
      }
      return { saved: true, settings: answer.body };
    },

    async testLogSink(sink) {
      const answer = await send('POST', '/settings/logging/test', { sink });
      if (answer.status === 422) {
        const problems = problemsOf(answer.body);
        return { ok: false, text: problems[0] ?? 'This sink cannot be tested until its problems are fixed.' };
      }
      const body = answer.body;
      return isRecord(body) && typeof body.ok === 'boolean' && typeof body.text === 'string'
        ? { ok: body.ok, text: body.text }
        : { ok: false, text: 'The server sent an answer this page cannot read.' };
    },

    async stepLog(runId, stepId) {
      const response = await request(
        `/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/log`,
      );
      return response.text();
    },
  };
}
