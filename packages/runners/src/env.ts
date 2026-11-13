import { mkdir, rm, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { RunnerUnavailableError } from '@indaba/core';

/**
 * The variables every child process needs to start and to run a toolchain: the operating system, paths, locale,
 * terminal, certificates and proxies. `TEMP`, `TMP` and `TMPDIR` are deliberately absent: they are set to the
 * step's confined directory instead (specs/host-process-containment, AC-04).
 */
export const BASELINE_ENV_NAMES: ReadonlySet<string> = new Set([
  'PATH',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'COMSPEC',
  'PATHEXT',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'TERM',
  'COLORTERM',
  'SHELL',
  'USER',
  'USERNAME',
  'LOGNAME',
  'TZ',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
]);

/** Prefixes that belong to the baseline too: the other locale categories and the package manager's own settings. */
const BASELINE_PREFIXES: readonly string[] = ['LC_', 'XDG_', 'NPM_CONFIG_'];

const TEMP_NAMES: readonly string[] = ['TEMP', 'TMP', 'TMPDIR'];

export interface RunnerEnvOptions {
  /** The environment the child's own is taken from. Defaults to nothing: the composition root passes `process.env`. */
  readonly source?: Readonly<Record<string, string | undefined>>;
  /** Variables whose name starts with one of these are passed on (the runner's provider credentials). */
  readonly prefixes?: readonly string[];
  /** Extra variables to pass on: exact names, or a prefix ending in `*`. */
  readonly passEnv?: readonly string[];
  /** Explicit additions; they win over everything, including `tempDir`. */
  readonly additions?: Readonly<Record<string, string>>;
  /** Where `TEMP`, `TMP` and `TMPDIR` point, unless `additions` sets them. */
  readonly tempDir?: string;
}

function startsWithAny(name: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => prefix !== '' && name.startsWith(prefix));
}

/**
 * Builds the complete environment of a child process from an allowlist, so an unrelated secret in the operator's
 * shell (a cloud key, a repository token) never reaches an agent or a verification command. Names are compared
 * case-insensitively (Windows), and kept as the source spelled them.
 */
export function buildRunnerEnvironment(options: RunnerEnvOptions): Record<string, string> {
  const exact = new Set<string>();
  const prefixes = [...BASELINE_PREFIXES, ...(options.prefixes ?? []).map((prefix) => prefix.toUpperCase())];
  for (const pattern of options.passEnv ?? []) {
    if (pattern.endsWith('*')) {
      prefixes.push(pattern.slice(0, -1).toUpperCase());
    } else {
      exact.add(pattern.toUpperCase());
    }
  }
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(options.source ?? {})) {
    const upper = name.toUpperCase();
    if (TEMP_NAMES.includes(upper)) {
      continue;
    }
    if (
      value !== undefined &&
      (BASELINE_ENV_NAMES.has(upper) || exact.has(upper) || startsWithAny(upper, prefixes))
    ) {
      env[name] = value;
    }
  }
  const additions = options.additions ?? {};
  const overridden = new Set(Object.keys(additions).map((name) => name.toUpperCase()));
  if (options.tempDir !== undefined) {
    for (const name of TEMP_NAMES) {
      if (!overridden.has(name)) {
        env[name] = options.tempDir;
      }
    }
  }
  return { ...env, ...additions };
}

/** How a runner picks the host variables a child receives. Shared by every process runner. */
export interface EnvironmentPolicy {
  readonly source: Readonly<Record<string, string | undefined>>;
  readonly prefixes: readonly string[];
  readonly passEnv: readonly string[];
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** How many calls in this process use each confined directory right now, so one finishing never clears another's. */
const activeTempDirs = new Map<string, number>();

async function clearTempDir(tempDir: string): Promise<void> {
  await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

/**
 * Runs `use` with a clean `<workdir>/.indaba/tmp` and removes it afterwards, whatever happened (AC-01, AC-02). The
 * directory sits on the workspace's drive and under `.indaba`, which every git and guard filter already ignores.
 * A working directory that does not exist is a runner that cannot start, before any process does. Calls that overlap
 * in one working directory share the directory; the last one to finish removes it.
 */
export async function withConfinedTemp<T>(workdir: string, use: (tempDir: string) => Promise<T>): Promise<T> {
  const root = resolve(workdir);
  const tempDir = resolve(root, '.indaba', 'tmp');
  if (!isInside(root, tempDir)) {
    throw new RunnerUnavailableError('The temporary directory would lie outside the working directory.');
  }
  const others = activeTempDirs.get(tempDir) ?? 0;
  activeTempDirs.set(tempDir, others + 1);
  const leave = async (): Promise<void> => {
    const remaining = (activeTempDirs.get(tempDir) ?? 1) - 1;
    if (remaining > 0) {
      activeTempDirs.set(tempDir, remaining);
      return;
    }
    activeTempDirs.delete(tempDir);
    // Never masks the outcome of the call: a file a dying child still holds is left for the next call to clear.
    await clearTempDir(tempDir).catch(() => undefined);
  };
  try {
    if (!(await stat(root)).isDirectory()) {
      throw new Error('not a directory');
    }
    if (others === 0) {
      await clearTempDir(tempDir);
    }
    await mkdir(tempDir, { recursive: true });
  } catch (error) {
    await leave();
    throw new RunnerUnavailableError('Cannot create the temporary directory of the working directory.', {
      cause: error,
    });
  }
  try {
    return await use(tempDir);
  } finally {
    await leave();
  }
}
