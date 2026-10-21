import { basename } from 'node:path';
import type { Logger } from '@indaba/core';
import type { FetchFunction } from './openrouter-runner.js';
import type { ProcessOutcome, ProcessSpawner, ProcessSpec } from './process.js';
import type { ProcessSession, StreamingProcessSpawner, StreamingProcessSpec } from './streaming-process.js';

/**
 * The runners' side of logging (specs/logging, AC-03, T-09): every process a runner starts and every HTTP request it
 * sends is recorded where it happens, by wrapping the one seam each kind of runner already goes through. What is
 * recorded is chosen for a report: the program's name, never its arguments (they carry the prompt) or its environment
 * (it carries keys); the host and path of a request, never its query, headers or body.
 */

function program(command: readonly string[]): string {
  const file = command[0];
  return file === undefined ? '' : basename(file);
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Records the start and the end of every process a CLI or shell runner runs. */
export class LoggingProcessSpawner implements ProcessSpawner {
  constructor(
    private readonly inner: ProcessSpawner,
    private readonly logger: Logger,
  ) {}

  async run(spec: ProcessSpec, signal?: AbortSignal): Promise<ProcessOutcome> {
    const name = program(spec.command);
    this.logger.info('runner.process', 'a process started', {
      program: name,
      cwd: spec.cwd,
      pty: spec.usePty,
      timeoutSeconds: spec.timeoutSeconds,
    });
    let outcome: ProcessOutcome;
    try {
      outcome = await this.inner.run(spec, signal);
    } catch (error) {
      this.logger.info('runner.process', 'a process could not start', {
        program: name,
        reason: reasonOf(error),
      });
      throw error;
    }
    if (spec.usePty && outcome.mode === 'piped') {
      this.logger.debug('runner.process', 'a pseudo-terminal was asked for and pipes were used', {
        program: name,
      });
    }
    this.logger.info('runner.process', 'a process ended', {
      program: name,
      exitCode: outcome.exitCode,
      mode: outcome.mode,
      timedOut: outcome.timedOut,
      aborted: outcome.aborted,
    });
    return outcome;
  }
}

/** Records the start and the exit of a protocol agent's process (the `acp` runner). */
export class LoggingStreamingSpawner implements StreamingProcessSpawner {
  constructor(
    private readonly inner: StreamingProcessSpawner,
    private readonly logger: Logger,
  ) {}

  async start(spec: StreamingProcessSpec, signal?: AbortSignal): Promise<ProcessSession> {
    const name = program(spec.command);
    let session: ProcessSession;
    try {
      session = await this.inner.start(spec, signal);
    } catch (error) {
      this.logger.info('runner.process', 'a process could not start', {
        program: name,
        reason: reasonOf(error),
      });
      throw error;
    }
    this.logger.info('runner.process', 'a process started', { program: name, cwd: spec.cwd, protocol: true });
    session.exited.then(
      (exitCode) => this.logger.info('runner.process', 'a process ended', { program: name, exitCode }),
      () => undefined,
    );
    return session;
  }
}

/** The address of a request without its query, fragment or credentials. */
function whereTo(input: string): { readonly host: string; readonly path: string } {
  try {
    const url = new URL(input);
    return { host: url.host, path: url.pathname };
  } catch {
    return { host: '', path: '' };
  }
}

/** Records every request an HTTP runner sends: where it went and how it was answered, nothing it carried. */
export function loggingFetch(inner: FetchFunction, logger: Logger): FetchFunction {
  return async (input, init) => {
    const target = whereTo(input);
    const method = init.method ?? 'GET';
    logger.info('runner.http', 'an HTTP request was sent', { method, ...target });
    try {
      const response = await inner(input, init);
      logger.info('runner.http', 'an HTTP request was answered', {
        method,
        ...target,
        status: response.status,
      });
      return response;
    } catch (error) {
      logger.info('runner.http', 'an HTTP request failed', { method, ...target, reason: reasonOf(error) });
      throw error;
    }
  };
}
