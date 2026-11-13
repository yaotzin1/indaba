import type {
  FullAccessStep,
  RunSummaryOfUse,
  StartRunRequest,
  StartRunResponse,
  StartStatusResponse,
  StopRunResponse,
  WorkflowListResponse,
  WorkflowSummary,
} from '@indaba/engine';
import type { KeyName } from './ui-state.js';

/**
 * What the terminal application needs of the control that starts and stops runs (specs/tui-run-control). Declared here,
 * from wire types the engine re-exports, because `@indaba/tui` imports no CLI module; the command line satisfies it.
 */
export interface RunControlPort {
  list(): Promise<WorkflowListResponse>;
  start(request: StartRunRequest): Promise<StartRunResponse>;
  startStatus(startId: string): StartStatusResponse | undefined;
  stop(runId: string): StopRunResponse | undefined;
  isAlive(runId: string): boolean;
  /** Lets every live run carry on without this screen; stops none. Idempotent. */
  detach(): void;
  /** Stops every live run and waits for them. May reject. */
  stopAll(): Promise<void>;
}

export interface RunControlRefusal extends Error {
  readonly code: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

/**
 * A refusal of the control is an `Error` named `RunControlError` with a string `code`. It is recognised by its name and
 * shape, as the server does, because two copies of a package would defeat `instanceof` and the CLI is not imported here.
 */
export function isRunControlError(error: unknown): error is RunControlRefusal {
  return (
    error instanceof Error &&
    error.name === 'RunControlError' &&
    typeof (error as { code?: unknown }).code === 'string'
  );
}

/** The longest filter a person can type. */
export const MAX_FILTER = 40;
/** Polls of a start before it is called lost: 60 seconds at the component's 500 ms. */
export const MAX_START_POLLS = 120;
/** Polls of a stop before the screen stops waiting for it: 20 seconds at 500 ms. */
export const MAX_STOP_POLLS = 40;

/** What the component must do once for a state: the state is pure, the doing is not. */
export type FlowEffect =
  | { readonly type: 'list' }
  | { readonly type: 'start'; readonly request: StartRunRequest }
  | { readonly type: 'poll'; readonly startId: string }
  | { readonly type: 'stop'; readonly runId: string }
  | { readonly type: 'pollStop'; readonly runId: string };

interface Base {
  /** Rises each time a new effect is asked for, so the component runs each exactly once. */
  readonly seq: number;
  readonly effect: FlowEffect | undefined;
}

export interface Picking extends Base {
  readonly kind: 'picking';
  readonly loading: boolean;
  readonly workflows: readonly WorkflowSummary[];
  readonly truncated: boolean;
  readonly error: string | undefined;
  readonly filter: string;
  /** Keys are typed into the filter. */
  readonly editing: boolean;
  readonly showHidden: boolean;
  readonly selected: number;
}
export interface Requesting extends Base {
  readonly kind: 'requesting';
  readonly workflowId: string;
  readonly name: string;
  /** What was sent, to tell a changed file from a first answer. */
  readonly sent: StartRunRequest;
}
export interface Confirming extends Base {
  readonly kind: 'confirming';
  readonly workflowId: string;
  readonly name: string;
  readonly hash: string;
  readonly use: RunSummaryOfUse;
  /** The file changed after an earlier confirmation, so this one is asked again. */
  readonly changed: boolean;
}
export interface FullAccess extends Base {
  readonly kind: 'fullAccess';
  readonly workflowId: string;
  readonly name: string;
  readonly hash: string;
  readonly steps: readonly FullAccessStep[];
  readonly changed: boolean;
}
export interface Starting extends Base {
  readonly kind: 'starting';
  readonly startId: string;
  readonly name: string;
  readonly polls: number;
}
export interface Failed extends Base {
  readonly kind: 'failed';
  readonly message: string;
}
export interface StopConfirm extends Base {
  readonly kind: 'stopConfirm';
  readonly runId: string;
}
export interface Stopping extends Base {
  readonly kind: 'stopping';
  readonly runId: string;
  readonly polls: number;
}

export type FlowState =
  | Picking
  | Requesting
  | Confirming
  | FullAccess
  | Starting
  | Failed
  | StopConfirm
  | Stopping;

export type FlowEvent =
  | { readonly press: KeyName }
  | { readonly listed: WorkflowListResponse }
  | { readonly listFailed: string }
  | { readonly started: StartRunResponse }
  | { readonly refused: RunControlRefusal }
  | { readonly threw: string }
  | { readonly status: StartStatusResponse | undefined }
  | { readonly stopped: StopRunResponse | undefined }
  | { readonly stopThrew: string }
  | { readonly alive: boolean };

export interface FlowStep {
  /** The next state; undefined closes the flow and gives the screen back to Home. */
  readonly state: FlowState | undefined;
  /** A run the flow started and that is ready to be shown. */
  readonly opened?: string;
  /** One line for Home to show. */
  readonly notice?: string;
}

/** Text that came from the control or a file, safe for one line: no control character, and bounded. */
export function plain(text: string, limit = 200): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? ' ' : char;
  }
  const flat = out.replace(/ {2,}/g, ' ').trim();
  return Array.from(flat).length > limit
    ? `${Array.from(flat)
        .slice(0, limit - 1)
        .join('')}…`
    : flat;
}

export function openPicker(): Picking {
  return {
    kind: 'picking',
    loading: true,
    workflows: [],
    truncated: false,
    error: undefined,
    filter: '',
    editing: false,
    showHidden: false,
    selected: 0,
    seq: 1,
    effect: { type: 'list' },
  };
}

export function openStop(runId: string): StopConfirm {
  return { kind: 'stopConfirm', runId, seq: 0, effect: undefined };
}

/** The workflows the picker shows: hidden ones only when asked, and those that match the filter. */
export function visibleWorkflows(state: Picking): readonly WorkflowSummary[] {
  const needle = state.filter.toLowerCase();
  return state.workflows.filter((w) => {
    if (w.hidden === true && !state.showHidden) {
      return false;
    }
    if (needle === '') {
      return true;
    }
    const haystack = [w.name, w.project, w.path, ...(w.tags ?? [])].join('\n').toLowerCase();
    return haystack.includes(needle);
  });
}

const clampIndex = (value: number, count: number): number =>
  Math.min(Math.max(value, 0), Math.max(0, count - 1));

/** A state with a new effect to run. */
function doing<T extends FlowState>(
  previous: FlowState,
  next: Omit<T, 'seq' | 'effect'>,
  effect: FlowEffect,
): T {
  return { ...next, seq: previous.seq + 1, effect } as T;
}
/** A state with nothing to run. */
function resting<T extends FlowState>(previous: FlowState, next: Omit<T, 'seq' | 'effect'>): T {
  return { ...next, seq: previous.seq, effect: undefined } as T;
}

const REFUSALS: Readonly<Record<string, string>> = {
  too_many_runs: 'Too many runs are going already; wait for one to end',
  workflow_not_found: 'That workflow is no longer there',
  workflow_invalid: 'That workflow is not valid',
  not_saved: 'The confirmation could not be saved',
  start_failed: 'The run could not be started',
};

function refusalText(refusal: RunControlRefusal): string {
  const known = REFUSALS[refusal.code];
  const head = known ?? 'The run could not be started';
  const problems = refusal.detail?.problems;
  const list = Array.isArray(problems)
    ? problems
        .filter((p): p is string => typeof p === 'string')
        .slice(0, 3)
        .map((p) => plain(p, 120))
        .join('; ')
    : '';
  const why = known === undefined || refusal.code === 'too_many_runs' ? plain(refusal.message) : '';
  return [head, list, why].filter((part) => part !== '').join(': ');
}

function asUse(value: unknown): RunSummaryOfUse | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const v = value as Record<string, unknown>;
  const strings = (x: unknown): readonly string[] =>
    Array.isArray(x) ? x.filter((i): i is string => typeof i === 'string') : [];
  return {
    runners: strings(v.runners),
    commands: strings(v.commands),
    permissions: strings(v.permissions),
    needsPerson: strings(v.needsPerson),
    fullAccessSteps: asSteps(v.fullAccessSteps),
  };
}

function asSteps(value: unknown): readonly FullAccessStep[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): FullAccessStep[] => {
    if (typeof item !== 'object' || item === null) {
      return [];
    }
    const { stepId, runners } = item as { stepId?: unknown; runners?: unknown };
    return typeof stepId === 'string'
      ? [
          {
            stepId,
            runners: Array.isArray(runners) ? runners.filter((r): r is string => typeof r === 'string') : [],
          },
        ]
      : [];
  });
}

function request(previous: FlowState, workflowId: string, name: string, sent: StartRunRequest): Requesting {
  return doing<Requesting>(
    previous,
    { kind: 'requesting', workflowId, name, sent },
    { type: 'start', request: sent },
  );
}

function failed(previous: FlowState, message: string): Failed {
  return resting<Failed>(previous, { kind: 'failed', message });
}

function answerToStart(state: Requesting, event: FlowEvent): FlowStep {
  if ('started' in event) {
    return {
      state: doing<Starting>(
        state,
        { kind: 'starting', startId: event.started.startId, name: state.name, polls: 0 },
        { type: 'poll', startId: event.started.startId },
      ),
    };
  }
  if ('threw' in event) {
    return { state: failed(state, plain(event.threw)) };
  }
  if (!('refused' in event)) {
    return { state };
  }
  const refusal = event.refused;
  const hash = refusal.detail?.contentHash;
  if (refusal.code === 'confirmation_required' && typeof hash === 'string') {
    const use = asUse(refusal.detail?.use);
    if (use !== undefined) {
      return {
        state: resting<Confirming>(state, {
          kind: 'confirming',
          workflowId: state.workflowId,
          name: state.name,
          hash,
          use,
          // we had sent a confirmation and the control still asks: what was confirmed is not what is there now
          changed: state.sent.confirmedHash !== undefined,
        }),
      };
    }
  }
  if (refusal.code === 'full_access_required' && typeof hash === 'string') {
    return {
      state: resting<FullAccess>(state, {
        kind: 'fullAccess',
        workflowId: state.workflowId,
        name: state.name,
        hash,
        steps: asSteps(refusal.detail?.steps),
        changed: state.sent.fullAccessConfirmedHash !== undefined,
      }),
    };
  }
  return { state: failed(state, refusalText(refusal)) };
}

function pressInPicker(state: Picking, press: KeyName): FlowStep {
  const char = typeof press === 'object' ? press.char : undefined;
  if (state.editing) {
    if (press === 'enter' || press === 'escape') {
      return { state: { ...state, editing: false } };
    }
    if (press === 'backspace') {
      return { state: { ...state, filter: Array.from(state.filter).slice(0, -1).join(''), selected: 0 } };
    }
    if (char !== undefined && char.length > 0) {
      const printable = Array.from(char).every((c) => (c.codePointAt(0) ?? 0) >= 0x20 && c !== '\u007f');
      if (printable && Array.from(state.filter).length < MAX_FILTER) {
        return { state: { ...state, filter: state.filter + char, selected: 0 } };
      }
    }
    return { state };
  }
  const shown = visibleWorkflows(state);
  const move = (to: number): FlowStep => ({ state: { ...state, selected: clampIndex(to, shown.length) } });
  if (press === 'escape') {
    return { state: undefined };
  }
  if (press === 'up' || char === 'k') {
    return move(state.selected - 1);
  }
  if (press === 'down' || char === 'j') {
    return move(state.selected + 1);
  }
  if (press === 'home' || char === 'g') {
    return move(0);
  }
  if (press === 'end' || char === 'G') {
    return move(shown.length - 1);
  }
  if (char === '/') {
    return { state: { ...state, editing: true } };
  }
  if (char === 'h') {
    return { state: { ...state, showHidden: !state.showHidden, selected: 0 } };
  }
  if (char === 'r' && !state.loading) {
    return { state: doing<Picking>(state, { ...state, loading: true, error: undefined }, { type: 'list' }) };
  }
  if (press === 'enter') {
    const chosen = shown[clampIndex(state.selected, shown.length)];
    if (chosen === undefined || state.loading) {
      return { state };
    }
    if (!chosen.valid) {
      return { state: { ...state, error: `${plain(chosen.name, 60)} is not valid and cannot be started` } };
    }
    return { state: request(state, chosen.id, plain(chosen.name, 60), { workflowId: chosen.id }) };
  }
  return { state };
}

/** One step of the flow: the next state, and what Home should know. Pure. */
export function reduceFlow(state: FlowState, event: FlowEvent): FlowStep {
  switch (state.kind) {
    case 'picking': {
      if ('listed' in event) {
        return {
          state: {
            ...state,
            loading: false,
            workflows: event.listed.workflows,
            truncated: event.listed.truncated,
            error: undefined,
            selected: 0,
            effect: undefined,
          },
        };
      }
      if ('listFailed' in event) {
        return { state: { ...state, loading: false, error: plain(event.listFailed), effect: undefined } };
      }
      return 'press' in event ? pressInPicker(state, event.press) : { state };
    }
    case 'requesting':
      // a second Enter while a start is in flight is ignored: the answer decides what happens next
      return answerToStart(state, event);
    case 'confirming': {
      if (!('press' in event)) {
        return { state };
      }
      const char = typeof event.press === 'object' ? event.press.char : undefined;
      if (char === 'y') {
        return {
          state: request(state, state.workflowId, state.name, {
            workflowId: state.workflowId,
            confirmedHash: state.hash,
          }),
        };
      }
      return event.press === 'escape' || char === 'n' ? { state: undefined } : { state };
    }
    case 'fullAccess': {
      if (!('press' in event)) {
        return { state };
      }
      const char = typeof event.press === 'object' ? event.press.char : undefined;
      if (char === 'a') {
        return {
          state: request(state, state.workflowId, state.name, {
            workflowId: state.workflowId,
            confirmedHash: state.hash,
            fullAccessConfirmedHash: state.hash,
          }),
        };
      }
      return event.press === 'escape' || char === 'n' ? { state: undefined } : { state };
    }
    case 'starting': {
      if ('threw' in event) {
        return { state: failed(state, plain(event.threw)) };
      }
      if (!('status' in event)) {
        return { state };
      }
      const status = event.status;
      if (status === undefined) {
        return { state: failed(state, 'The start was lost: the control no longer knows it') };
      }
      if (status.state === 'running' && status.runId !== undefined) {
        return { state: undefined, opened: status.runId };
      }
      if (status.state === 'failed') {
        const reason =
          status.failure === undefined ? 'The run ended before it started' : plain(status.failure);
        return { state: failed(state, reason) };
      }
      if (state.polls + 1 >= MAX_START_POLLS) {
        return { state: failed(state, 'The run did not start in time') };
      }
      return {
        state: doing<Starting>(
          state,
          { kind: 'starting', startId: state.startId, name: state.name, polls: state.polls + 1 },
          { type: 'poll', startId: state.startId },
        ),
      };
    }
    case 'failed':
      return 'press' in event ? { state: undefined } : { state };
    case 'stopConfirm': {
      if ('press' in event) {
        const char = typeof event.press === 'object' ? event.press.char : undefined;
        if (char === 'y') {
          return {
            state: doing<Stopping>(
              state,
              { kind: 'stopping', runId: state.runId, polls: 0 },
              { type: 'stop', runId: state.runId },
            ),
          };
        }
        return event.press === 'escape' || char === 'n' ? { state: undefined } : { state };
      }
      return { state };
    }
    case 'stopping': {
      if ('stopThrew' in event) {
        return { state: failed(state, plain(event.stopThrew)) };
      }
      if ('stopped' in event) {
        if (event.stopped === undefined) {
          return {
            state: failed(state, 'That run was not started from this screen, so it cannot be stopped here'),
          };
        }
        if (event.stopped.state === 'ended') {
          return { state: undefined, notice: 'That run had already finished' };
        }
        return {
          state: doing<Stopping>(state, { ...state, polls: 0 }, { type: 'pollStop', runId: state.runId }),
        };
      }
      if ('alive' in event) {
        if (!event.alive) {
          return { state: undefined, notice: 'The run was stopped' };
        }
        if (state.polls + 1 >= MAX_STOP_POLLS) {
          return { state: undefined, notice: 'The run was asked to stop and is still ending' };
        }
        return {
          state: doing<Stopping>(
            state,
            { ...state, polls: state.polls + 1 },
            { type: 'pollStop', runId: state.runId },
          ),
        };
      }
      return { state };
    }
  }
}

/** A flow in which Home must not be left: a start is being made, and a child might appear after the screen is gone. */
export function isBusy(state: FlowState | undefined): boolean {
  return state?.kind === 'requesting' || state?.kind === 'starting';
}
