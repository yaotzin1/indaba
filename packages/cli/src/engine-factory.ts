import { join } from 'node:path';
import {
  type Adjudicator,
  AdjudicatorRegistry,
  BoardRecorded,
  IndabaError,
  type Logger,
  type LogSinkRegistry,
  noopLogger,
  type Plugin,
  PricingTable,
  SimpleEventDispatcher,
  type Span,
  SpanEnded,
  SpanStarted,
  StepOutput,
  StepStatusChanged,
  Tracer,
  type WorkflowRegistry,
} from '@indaba/core';
import {
  BoardWriter,
  DecisionLedger,
  DISCUSSION_DIRECTORY,
  DiscussionStore,
  GitWorktreeManager,
  GuardRegistry,
  JsonlSpanExporter,
  logEngineEvents,
  McpPlanner,
  RandomIdGenerator,
  RunEventWriter,
  StepExecutor,
  SystemClock,
  WorkflowEngine,
  WorkflowParser,
} from '@indaba/engine';
import { type AuthChooser, loggingFetch, openAiCompatibleFromEnv, RunnerRegistry } from '@indaba/runners';
import { RegistryPluginHost } from './plugin-host.js';
import { redact } from './redact.js';

const registryOf = (registry: WorkflowRegistry | undefined): { workflowRegistry?: WorkflowRegistry } =>
  registry === undefined ? {} : { workflowRegistry: registry };

/** The environment values the built-in runners read. Nothing else is forwarded. */
const RUNNER_ENV_KEYS = [
  'OPENROUTER_API_KEY',
  'INDABA_CODEX_CMD',
  'INDABA_ANTIGRAVITY_CMD',
  'INDABA_ACP_PASS_ENV',
] as const;

/** Endpoints configured as `INDABA_OPENAI_COMPAT_<NAME>_*`, and the variables their keys are read from. */
function compatibleEndpointEnv(source: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && name.startsWith('INDABA_OPENAI_COMPAT_')) {
      picked[name] = value;
      if (name.endsWith('_KEY_ENV')) {
        const keyValue = source[value];
        if (keyValue !== undefined) {
          picked[value] = keyValue;
        }
      }
    }
  }
  return picked;
}

export interface CreateEngineOptions {
  /** The project the workflow runs against; traces go under `<projectDir>/.indaba/traces`. */
  readonly projectDir: string;
  /** The only source of configuration and secrets; never logged. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly plugins?: readonly Plugin[];
  /** Lets a person pick how an ACP agent logs in. Only an interactive front end passes one. */
  readonly chooseAuthMethod?: AuthChooser;
  /** Lets a person rule on a debate that failed, as the arbiter "human". Only an interactive front end passes one. */
  readonly humanAdjudicator?: Adjudicator;
  /** Where the messages of each debate are kept for a viewer. Default `<projectDir>/.indaba/discussions`. */
  readonly discussionDirectory?: string;
  /** Per-step timeout in seconds. */
  readonly stepTimeoutSeconds?: number;
  /** Receives what a failing event listener threw; by default it is dropped. */
  readonly onListenerError?: (error: unknown) => void;
  /**
   * Where Indaba logs (specs/logging). The engine's events are turned into records, and plugins receive it as
   * `host.logger`. Without one nothing is logged.
   */
  readonly logger?: Logger;
  /**
   * Where a plugin's log sinks join (`Plugin.logSinks`, `PluginHost.registerLogSink`): the command's logger. Without
   * one a plugin's sink is not added.
   */
  readonly logSinks?: LogSinkRegistry;
}

export interface EngineBundle {
  readonly engine: WorkflowEngine;
  /** Validates against the same guard registry the engine uses, so plugin guard types are valid. */
  readonly parser: WorkflowParser;
  readonly planner: McpPlanner;
  readonly runners: RunnerRegistry;
  readonly guards: GuardRegistry;
  /** The arbiters a step's `arbiter` can name, for the catalog (specs/workflow-editor, T2). */
  readonly adjudicators: AdjudicatorRegistry;
  readonly events: SimpleEventDispatcher;
  /** A workflow registry a plugin registered, which replaces the built-in one (specs/workflow-registry, AC-13). */
  readonly workflowRegistry?: WorkflowRegistry;
}

/** The composition root: the one place that wires concrete implementations and reads configuration. */
export async function createEngine(options: CreateEngineOptions): Promise<EngineBundle> {
  const env: Record<string, string> = {};
  for (const key of RUNNER_ENV_KEYS) {
    const value = options.env?.[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  const events = new SimpleEventDispatcher(options.onListenerError);
  const logger = options.logger ?? noopLogger;
  logEngineEvents(events, logger);
  const traceDirectory = join(options.projectDir, '.indaba', 'traces');
  const exporter = new JsonlSpanExporter(traceDirectory);
  events.addListener(SpanEnded, (event) => exporter.onSpanEnded(event));

  const clock = new SystemClock();
  // What a run does, as it does it, for anything that wants to follow it. Output passes through the same
  // credential redaction the command line applies to its own messages before it is stored.
  const secrets = options.env ?? {};
  const stream = new RunEventWriter({
    directory: traceDirectory,
    clock,
    redact: (text) => redact(text, secrets),
    ...(options.onListenerError === undefined ? {} : { onError: options.onListenerError }),
  });
  events.addListener(SpanStarted, (event) => stream.onSpanStarted(event));
  events.addListener(SpanEnded, (event) => stream.onSpanEnded(event));
  events.addListener(StepStatusChanged, (event) => stream.onStepStatus(event));
  events.addListener(StepOutput, (event) => stream.onOutput(event));

  // The notes between steps (specs/run-blackboard): one file per run beside the other two. The board redacts with the
  // function above, which it has no default for. A file that cannot be written does not fail the run: the root span says so,
  // by the class of the error only (its message can hold a path), and the in-memory board keeps serving.
  const rootSpans = new Map<string, Span>();
  events.addListener(SpanStarted, (event) => {
    if (event.span.parentSpanId === undefined) {
      rootSpans.set(event.span.traceId, event.span);
    }
  });
  events.addListener(SpanEnded, (event) => {
    if (event.span.parentSpanId === undefined) {
      rootSpans.delete(event.span.traceId);
    }
  });
  const board = new BoardWriter({
    directory: traceDirectory,
    onError: (error, traceId) => {
      rootSpans.get(traceId)?.addEvent('indaba.board.degraded', {
        'indaba.board.error': error instanceof Error ? error.constructor.name : typeof error,
      });
      options.onListenerError?.(error);
    },
  });
  events.addListener(BoardRecorded, (event) => board.onRecorded(event));

  const ids = new RandomIdGenerator();
  const tracer = new Tracer(clock, events, ids, PricingTable.defaults());
  const runners = RunnerRegistry.withDefaults(env, {
    ...(options.env === undefined ? {} : { hostEnv: options.env }),
    ...(options.chooseAuthMethod === undefined ? {} : { chooseAuthMethod: options.chooseAuthMethod }),
    ...(options.logger === undefined ? {} : { logger }),
  });
  const guards = GuardRegistry.withDefaults();

  const adjudicators = new AdjudicatorRegistry();
  const host = new RegistryPluginHost(runners, guards, events, adjudicators, logger, options.logSinks);
  if (options.humanAdjudicator !== undefined) {
    host.registerAdjudicator('human', options.humanAdjudicator);
  }
  // Endpoints from the environment join through the same door a plugin's runners use.
  const endpoints = openAiCompatibleFromEnv(compatibleEndpointEnv(options.env ?? {}), {
    reserved: runners.names(),
    ...(options.logger === undefined
      ? {}
      : { fetch: loggingFetch((input, init) => fetch(input, init), logger) }),
  });
  for (const endpoint of endpoints) {
    host.registerRunner(endpoint);
  }
  for (const plugin of options.plugins ?? []) {
    try {
      for (const sink of plugin.logSinks ?? []) {
        host.registerLogSink(sink);
      }
      await plugin.register(host);
      logger.info('cli.plugin', 'a plugin registered', {
        plugin: plugin.name,
        logSinks: plugin.logSinks?.length ?? 0,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.info('cli.plugin', 'a plugin failed to register', { plugin: plugin.name, reason });
      throw new IndabaError(`Plugin "${plugin.name}" failed to register: ${reason}`, { cause: error });
    }
  }

  const executor = new StepExecutor({
    runners,
    guards,
    tracer,
    events,
    adjudicators,
    ledger: new DecisionLedger(options.projectDir),
    discussions: new DiscussionStore(
      options.discussionDirectory ?? join(options.projectDir, DISCUSSION_DIRECTORY),
    ),
    clock,
    redact: (text) => redact(text, secrets),
    ...(options.stepTimeoutSeconds === undefined ? {} : { timeoutSeconds: options.stepTimeoutSeconds }),
  });
  const engine = new WorkflowEngine({
    executor,
    tracer,
    events,
    workspaces: new GitWorktreeManager(options.projectDir),
    projectDir: options.projectDir,
    ids,
    board: { redact: (text) => redact(text, secrets) },
  });

  return {
    engine,
    parser: new WorkflowParser(guards, undefined, runners),
    planner: new McpPlanner(runners),
    runners,
    guards,
    adjudicators,
    events,
    ...registryOf(host.registeredRegistry()),
  };
}
