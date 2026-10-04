import { spawn } from 'node:child_process';
import { WorkspaceError } from '@indaba/core';

export interface GitOptions {
  /** Per-command deadline. */
  readonly timeoutMs?: number;
  /** Environment for git; defaults to the process environment, sanitised. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface GitRunOptions {
  readonly stdin?: string;
  readonly signal?: AbortSignal;
}

/**
 * Variables that would redirect git to another repository or index. They are set by git itself for
 * hooks, so a process started from a hook would otherwise operate on the wrong repository.
 */
const REDIRECTING =
  /^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|COMMON_DIR|PREFIX|NAMESPACE|CEILING_DIRECTORIES|CONFIG.*)$/i;

/** Thin wrapper over the git binary. Arguments are passed as a vector; no shell is ever involved. */
export class Git {
  private readonly timeoutMs: number;
  private readonly baseEnv: Readonly<Record<string, string | undefined>>;

  constructor(options: GitOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.baseEnv = options.env ?? process.env;
  }

  async run(args: readonly string[], cwd: string, options: GitRunOptions = {}): Promise<string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.baseEnv)) {
      if (value !== undefined && !REDIRECTING.test(key)) {
        env[key] = value;
      }
    }
    env.GIT_TERMINAL_PROMPT = '0';
    env.GIT_OPTIONAL_LOCKS = '0';
    env.LC_ALL = 'C';

    const describe = (detail: string): WorkspaceError =>
      new WorkspaceError(`git ${args.join(' ')} failed in ${cwd}: ${detail.trim()}`);

    return await new Promise<string>((resolve, reject) => {
      const child = spawn('git', [...args], {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: this.timeoutMs,
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
      });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
      child.stdin.on('error', () => undefined);
      child.on('error', (error) => reject(describe(error.message)));
      child.on('close', (code, signalName) => {
        const stdout = Buffer.concat(out).toString('utf8');
        if (code === 0) {
          resolve(stdout);
          return;
        }
        const stderr = Buffer.concat(err).toString('utf8');
        reject(describe(code === null ? `terminated by ${signalName ?? 'a signal'}` : stderr + stdout));
      });
      child.stdin.end(options.stdin ?? '');
    });
  }
}
