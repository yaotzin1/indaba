import { join } from 'node:path';
import {
  type Adjudicator,
  AdjudicatorRegistry,
  IndabaError,
  type Logger,
  type LogSinkRegistry,
  noopLogger,
  type Plugin,
  PricingTable,
  SimpleEventDispatcher,
  SpanEnded,
  SpanStarted,
  StepOutput,
  StepStatusChanged,
  Tracer,
} from '@indaba/core';
import {
  DecisionLedger,
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
  readonly events: SimpleEventDispatcher;
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
  });

  return {
    engine,
    parser: new WorkflowParser(guards, undefined, runners),
    planner: new McpPlanner(runners),
    runners,
    guards,
    events,
  };
}
