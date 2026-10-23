import type {
  Adjudicator,
  AdjudicatorRegistry,
  Guard,
  Logger,
  LogSink,
  LogSinkRegistry,
  PluginHost,
  Runner,
  SimpleEventDispatcher,
  WorkflowRegistry,
} from '@indaba/core';
import type { GuardRegistry } from '@indaba/engine';
import type { RunnerRegistry } from '@indaba/runners';

/**
 * The only thing a plugin receives. It forwards to the same public registries the built-ins join,
 * so an extension has no less access than a built-in and no more.
 */
export class RegistryPluginHost implements PluginHost {
  /** The workflow registry a plugin registered, the last one (specs/workflow-registry, AC-13). */
  private workflowRegistry: WorkflowRegistry | undefined;

  constructor(
    private readonly runners: RunnerRegistry,
    private readonly guards: GuardRegistry,
    private readonly events: SimpleEventDispatcher,
    private readonly adjudicators: AdjudicatorRegistry,
    readonly logger: Logger,
    private readonly sinks?: LogSinkRegistry,
  ) {}

  /** The sink joins the command's logger through the same door the built-ins' records go out of (AC-10). */
  registerLogSink(sink: LogSink): void {
    if (this.sinks === undefined) {
      this.logger.debug('cli.plugin', 'a log sink was offered and this front end takes none');
      return;
    }
    this.sinks.addSink(sink);
  }

  registerRegistry(registry: WorkflowRegistry): void {
    this.workflowRegistry = registry;
  }

  /** The registry a plugin registered, or undefined for the built-in one. */
  registeredRegistry(): WorkflowRegistry | undefined {
    return this.workflowRegistry;
  }

  registerRunner(runner: Runner): void {
    this.runners.register(runner);
  }

  registerGuard(guard: Guard): void {
    this.guards.register(guard);
  }

  registerAdjudicator(name: string, adjudicator: Adjudicator): void {
    this.adjudicators.register(name, adjudicator);
  }

  addListener<E extends object>(
    type: abstract new (...args: never[]) => E,
    listener: (event: E) => unknown,
  ): void {
    this.events.addListener(type, listener);
  }
}
