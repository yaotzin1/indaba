import { existsSync, realpathSync, statSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import type { ReadinessProbe } from '@indaba/core';

/** What the probe needs to know about the runners: whether a name is registered. `RunnerRegistry` satisfies it. */
export interface RunnerPresence {
  has(name: string): boolean;
}

export interface ReadinessProbeOptions {
  /** `process.platform`, injected so a test can say `win32` anywhere. */
  readonly platform?: NodeJS.Platform;
}

/** The program each built-in agent CLI runner starts (the defaults of the runners; a configured command is not seen here). */
const CLI_EXECUTABLES: Readonly<Record<string, string>> = {
  'claude-code': 'claude',
  codex: 'codex',
  antigravity: 'agy',
  opencode: 'opencode',
  cursor: 'cursor-agent',
  openclaw: 'openclaw',
};

/** Names a pass-through list gives exactly; a prefix ending in `*` names no single variable. */
function exactNames(list: string | undefined): string[] {
  return (list ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name));
}

function envValue(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  insensitive: boolean,
): string | undefined {
  if (!insensitive) {
    return env[name];
  }
  const wanted = name.toLowerCase();
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === wanted);
  return key === undefined ? undefined : env[key];
}

/**
 * The machine as the readiness analysis sees it (specs/run-readiness). It answers with names and states only: it reads
 * a variable to say whether it is set and returns no value. `PATH` is a directory scan; nothing is started.
 */
export function createReadinessProbe(
  root: string,
  env: Readonly<Record<string, string | undefined>>,
  registry: RunnerPresence,
  options: ReadinessProbeOptions = {},
): ReadinessProbe {
  const platform = options.platform ?? process.platform;
  const windows = platform === 'win32';
  const insensitive = windows;

  const isEnvSet = (name: string): boolean => (envValue(env, name, insensitive) ?? '') !== '';

  const executableSuffixes = (): readonly string[] => {
    if (!windows) {
      return [''];
    }
    const listed = (envValue(env, 'PATHEXT', true) ?? '.COM;.EXE;.BAT;.CMD')
      .split(';')
      .map((ext) => ext.toLowerCase())
      .filter((ext) => ext !== '');
    // A `.cmd` or `.bat` shim cannot be started without a shell, and Indaba never uses one.
    return ['.exe', '.com'].filter((ext) => listed.includes(ext));
  };

  const hasExecutable = (name: string): boolean => {
    if (name === '' || name.includes('/') || name.includes('\\')) {
      return false;
    }
    const dirs = (envValue(env, 'PATH', insensitive) ?? '')
      .split(windows ? ';' : delimiter)
      .filter((d) => d !== '');
    for (const dir of dirs) {
      const carriesExtension =
        windows && executableSuffixes().some((ext) => name.toLowerCase().endsWith(ext));
      const candidates = carriesExtension ? [name] : executableSuffixes().map((suffix) => `${name}${suffix}`);
      for (const file of candidates) {
        const candidate = join(dir.replace(/^"(.*)"$/, '$1'), file);
        try {
          const info = statSync(candidate);
          // Windows has no execute bit (the suffix says what runs); a POSIX file system does.
          if (info.isFile() && (windows || process.platform === 'win32' || (info.mode & 0o111) !== 0)) {
            return true;
          }
        } catch {
          // not here: try the next directory
        }
      }
    }
    return false;
  };

  const realRoot = (): string => {
    try {
      return realpathSync(resolve(root));
    } catch {
      return resolve(root);
    }
  };

  const isFile = (path: string): boolean => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  };

  /** A program named by its path: a file, and on Windows not a batch file, which the runners refuse to start. */
  const isProgram = (path: string): boolean => {
    const name = win32.normalize(path).replace(/[\\/. ]+$/, '');
    return !(windows && /\.(?:bat|cmd)$/i.test(name)) && isFile(path);
  };

  /** The program a built-in agent CLI runner starts: the first word of its configured command, else its default. */
  const programOf = (type: string): string | undefined => {
    const configured =
      type === 'codex'
        ? env.INDABA_CODEX_CMD
        : type === 'antigravity'
          ? env.INDABA_ANTIGRAVITY_CMD
          : undefined;
    const first = configured
      ?.trim()
      .split(/\s+/)[0]
      ?.replace(/^"(.*)"$/, '$1');
    return first !== undefined && first !== '' ? first : CLI_EXECUTABLES[type];
  };

  const fileState = (relativePath: string): 'file' | 'directory' | 'missing' | 'outside' => {
    if (isAbsolute(relativePath)) {
      return 'outside';
    }
    const base = realRoot();
    const target = resolve(base, relativePath);
    const inside = (path: string): boolean => {
      const rel = relative(base, path);
      return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
    };
    if (!inside(target)) {
      return 'outside';
    }
    if (!existsSync(target)) {
      return 'missing';
    }
    // A link that leads out of the project is outside it, whatever it is called.
    if (!inside(realpathSync(target))) {
      return 'outside';
    }
    return statSync(target).isDirectory() ? 'directory' : 'file';
  };

  return {
    isEnvSet,
    fileState,
    hasExecutable,
    isRunnerRegistered(type: string, _preset?: string, command?: readonly string[]): boolean {
      const runnerProgramFound = (name: string): boolean => {
        // The program the author wrote for an OpenClaw agent replaces `openclaw` (a native executable on Windows, specs/openclaw, AC-04).
        const written = name === 'openclaw' ? command?.[0] : undefined;
        const program = written !== undefined && written !== '' ? written : programOf(name);
        return program === undefined
          ? true
          : isAbsolute(program)
            ? isProgram(program)
            : hasExecutable(program);
      };
      if (!registry.has(type)) {
        return false;
      }
      return programOf(type) === undefined || runnerProgramFound(type);
    },
    envNamesOf(type: string): readonly string[] {
      if (type === 'openrouter') {
        return ['OPENROUTER_API_KEY'];
      }
      if (type === 'acp' || type === 'openclaw') {
        return exactNames(envValue(env, 'INDABA_ACP_PASS_ENV', false));
      }
      const compat = Object.keys(env)
        .map((key) => key.match(/^INDABA_OPENAI_COMPAT_(.+)_KEY_ENV$/))
        .find((match) => match !== null && (match[1] ?? '').toLowerCase().replaceAll('_', '-') === type);
      if (compat !== null && compat !== undefined) {
        return exactNames(env[compat[0]]);
      }
      return [];
    },
    workspaceKind(): 'git' | 'plain' {
      for (let dir = resolve(root); ; dir = dirname(dir)) {
        if (existsSync(join(dir, '.git'))) {
          return 'git';
        }
        if (dirname(dir) === dir) {
          return 'plain';
        }
      }
    },
  };
}
