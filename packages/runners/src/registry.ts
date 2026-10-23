import type { Described, Logger, Runner } from '@indaba/core';
import { RunnerUnavailableError } from '@indaba/core';
import { AcpRunner, type AuthChooser } from './acp-runner.js';
import { AntigravityRunner } from './antigravity-runner.js';
import { ClaudeRunner } from './claude-runner.js';
import { CodexRunner } from './codex-runner.js';
import { CommandRunner } from './command-runner.js';
import { CursorRunner } from './cursor-runner.js';
import { LoggingProcessSpawner, LoggingStreamingSpawner, loggingFetch } from './logging.js';
import { OpenCodeRunner } from './opencode-runner.js';
import { type FetchFunction, OpenRouterRunner } from './openrouter-runner.js';
import { NodeProcessSpawner, type ProcessSpawner } from './process.js';
import { ShellRunner } from './shell-runner.js';
import { NodeStreamingProcessSpawner, type StreamingProcessSpawner } from './streaming-process.js';

export interface DefaultRunnerOptions {
  readonly fetch?: FetchFunction;
  readonly spawner?: ProcessSpawner;
  /** For the `acp` runner; tests inject a fake. */
  readonly streamingSpawner?: StreamingProcessSpawner;
  /**
   * The environment the `acp` agent's own is taken from (only an allowlist of it is passed on).
   * Defaults to `env`, which is too small for an agent that needs PATH and HOME.
   */
  readonly hostEnv?: Readonly<Record<string, string | undefined>>;
  /** Lets a person pick how an `acp` agent logs in; only a terminal front end supplies one. */
  readonly chooseAuthMethod?: AuthChooser;
  /**
   * Where the built-in runners record the processes they start and the requests they send (specs/logging, T-09).
   * Without one nothing is recorded and the runners behave exactly as before.
   */
  readonly logger?: Logger;
}

/**
 * Maps runner names to runners. Names are open strings and any Runner may be registered at
 * runtime; the built-ins join through the same public `register`, with no privileged path.
 */
export class RunnerRegistry {
  private readonly runners = new Map<string, Runner>();

  register(runner: Runner): this {
    this.runners.set(runner.name, runner);
    return this;
  }

  has(name: string): boolean {
    return this.runners.has(name);
  }

  get(name: string): Runner {
    const runner = this.runners.get(name);
    if (runner === undefined) {
      const known = this.names().join(', ');
      throw new RunnerUnavailableError(
        `Unknown runner "${name}". Registered: ${known === '' ? 'none' : known}.`,
      );
    }
    return runner;
  }

  names(): string[] {
    return [...this.runners.keys()];
  }

  /** Each runner's name with its description, `""` when it has none, in the order they were registered. */
  describe(): Described[] {
    return [...this.runners.values()].map((runner) => ({
      name: runner.name,
      description: runner.description ?? '',
    }));
  }

  /**
   * Built-in runners: shell, claude-code, codex, antigravity, cursor, opencode, openrouter and acp.
   *
   * @param env INDABA_CODEX_CMD and INDABA_ANTIGRAVITY_CMD replace the built-in command line
   *   (space separated, `{prompt}` and `{model}` mark where those go); OPENROUTER_API_KEY is the
   *   key of the openrouter runner. The map is the composition root's; nothing else reads the
   *   process environment for these. INDABA_ACP_PASS_ENV lists extra variables (comma separated
   *   names, or a prefix ending in `*`) the `acp` runner passes on to its agent.
   */
  static withDefaults(
    env: Readonly<Record<string, string | undefined>> = {},
    options: DefaultRunnerOptions = {},
  ): RunnerRegistry {
    const logger = options.logger;
    const spawner =
      logger === undefined
        ? options.spawner
        : new LoggingProcessSpawner(options.spawner ?? new NodeProcessSpawner(), logger);
    const streamingSpawner =
      logger === undefined
        ? options.streamingSpawner
        : new LoggingStreamingSpawner(options.streamingSpawner ?? new NodeStreamingProcessSpawner(), logger);
    const fetchFn =
      logger === undefined
        ? options.fetch
        : loggingFetch(options.fetch ?? ((input, init) => fetch(input, init)), logger);
    const cli = spawner === undefined ? {} : { spawner };
    const registry = new RunnerRegistry();
    return registry
      .register(new ShellRunner(cli))
      .register(new ClaudeRunner(cli))
      .register(templateRunner('codex', env.INDABA_CODEX_CMD, cli) ?? new CodexRunner(cli))
      .register(templateRunner('antigravity', env.INDABA_ANTIGRAVITY_CMD, cli) ?? new AntigravityRunner(cli))
      .register(new CursorRunner(cli))
      .register(new OpenCodeRunner(cli))
      .register(
        new OpenRouterRunner({
          apiKey: env.OPENROUTER_API_KEY ?? '',
          ...(fetchFn === undefined ? {} : { fetch: fetchFn }),
        }),
      )
      .register(
        new AcpRunner({
          env: options.hostEnv ?? env,
          ...(options.chooseAuthMethod === undefined ? {} : { chooseAuthMethod: options.chooseAuthMethod }),
          passEnv: (env.INDABA_ACP_PASS_ENV ?? '')
            .split(',')
            .map((name) => name.trim())
            .filter((name) => name !== ''),
          ...(streamingSpawner === undefined ? {} : { spawner: streamingSpawner }),
        }),
      );
  }
}

function templateRunner(
  name: string,
  override: string | undefined,
  cli: { spawner?: ProcessSpawner },
): CommandRunner | undefined {
  if (override === undefined || override.trim() === '') {
    return undefined;
  }
  return new CommandRunner(
    name,
    override.split(' ').filter((arg) => arg !== ''),
    cli,
  );
}
