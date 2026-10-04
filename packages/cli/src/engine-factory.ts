import { join } from 'node:path';
import {
  IndabaError,
  type Plugin,
  PricingTable,
  SimpleEventDispatcher,
  SpanEnded,
  Tracer,
} from '@indaba/core';
import {
  GitWorktreeManager,
  GuardRegistry,
  JsonlSpanExporter,
  McpPlanner,
  RandomIdGenerator,
  StepExecutor,
  SystemClock,
  WorkflowEngine,
  WorkflowParser,
} from '@indaba/engine';
import { RunnerRegistry } from '@indaba/runners';
import { RegistryPluginHost } from './plugin-host.js';

/** The environment values the built-in runners read. Nothing else is forwarded. */
const RUNNER_ENV_KEYS = ['OPENROUTER_API_KEY', 'INDABA_CODEX_CMD', 'INDABA_ANTIGRAVITY_CMD'] as const;

export interface CreateEngineOptions {
  /** The project the workflow runs against; traces go under `<projectDir>/.indaba/traces`. */
  readonly projectDir: string;
  /** The only source of configuration and secrets; never logged. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly plugins?: readonly Plugin[];
  /** Per-step timeout in seconds. */
  readonly stepTimeoutSeconds?: number;
  /** Receives what a failing event listener threw; by default it is dropped. */
  readonly onListenerError?: (error: unknown) => void;
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
  const exporter = new JsonlSpanExporter(join(options.projectDir, '.indaba', 'traces'));
  events.addListener(SpanEnded, (event) => exporter.onSpanEnded(event));

  const ids = new RandomIdGenerator();
  const tracer = new Tracer(new SystemClock(), events, ids, PricingTable.defaults());
  const runners = RunnerRegistry.withDefaults(env);
  const guards = GuardRegistry.withDefaults();

  const host = new RegistryPluginHost(runners, guards, events);
  for (const plugin of options.plugins ?? []) {
    try {
      await plugin.register(host);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new IndabaError(`Plugin "${plugin.name}" failed to register: ${reason}`, { cause: error });
    }
  }

  const executor = new StepExecutor({
    runners,
    guards,
    tracer,
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
    parser: new WorkflowParser(guards),
    planner: new McpPlanner(runners),
    runners,
    guards,
    events,
  };
}
