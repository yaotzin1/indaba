import type { Runner } from '@indaba/core';
import { RunnerError } from '@indaba/core';
import { AntigravityRunner } from './antigravity-runner.js';
import { ClaudeRunner } from './claude-runner.js';
import { CodexRunner } from './codex-runner.js';
import { CommandRunner } from './command-runner.js';
import { CursorRunner } from './cursor-runner.js';
import { type FetchFunction, OpenRouterRunner } from './openrouter-runner.js';
import type { ProcessSpawner } from './process.js';
import { ShellRunner } from './shell-runner.js';

export interface DefaultRunnerOptions {
  readonly fetch?: FetchFunction;
  readonly spawner?: ProcessSpawner;
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
      throw new RunnerError(`Unknown runner "${name}". Registered: ${known === '' ? 'none' : known}.`);
    }
    return runner;
  }

  names(): string[] {
    return [...this.runners.keys()];
  }

  /**
   * Built-in runners: shell, claude-code, codex, antigravity, cursor and openrouter.
   *
   * @param env INDABA_CODEX_CMD and INDABA_ANTIGRAVITY_CMD replace the built-in command line
   *   (space separated, `{prompt}` and `{model}` mark where those go); OPENROUTER_API_KEY is the
   *   key of the openrouter runner. The map is the composition root's; nothing else reads the
   *   process environment for these.
   */
  static withDefaults(
    env: Readonly<Record<string, string | undefined>> = {},
    options: DefaultRunnerOptions = {},
  ): RunnerRegistry {
    const cli = options.spawner === undefined ? {} : { spawner: options.spawner };
    const registry = new RunnerRegistry();
    return registry
      .register(new ShellRunner(cli))
      .register(new ClaudeRunner(cli))
      .register(templateRunner('codex', env.INDABA_CODEX_CMD, cli) ?? new CodexRunner(cli))
      .register(templateRunner('antigravity', env.INDABA_ANTIGRAVITY_CMD, cli) ?? new AntigravityRunner(cli))
      .register(new CursorRunner(cli))
      .register(
        new OpenRouterRunner({
          apiKey: env.OPENROUTER_API_KEY ?? '',
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
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
