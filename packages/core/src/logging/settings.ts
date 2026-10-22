/**
 * The settings of logging, described once (specs/logging, AC-13, AC-18, AC-19). The configuration parser, the
 * command-line help, the web page and the terminal dashboard are all built from this module, so a default or a limit
 * exists in one place. Pure: nothing here reads a file or the environment.
 */

import { isLogLevel, type LogLevel } from './logger.js';

/**
 * The starting values. None is a measurement: nothing in the repository says what a typical log size is, so they are
 * named here, in one place, and revised from real logs (specs/logging, section 8).
 */
export const LOGGING_DEFAULTS = {
  level: 'info' as LogLevel,
  file: { folder: '.indaba/logs', maxFileBytes: 10 * 1024 * 1024, maxFiles: 10 },
  stderr: { level: 'warn' as LogLevel },
  remote: { queueLength: 1000, timeoutSeconds: 5, retries: 3 },
} as const;

export type SinkType = 'file' | 'stderr' | 'gelf' | 'http-json';

export const SINK_TYPES: readonly SinkType[] = ['file', 'stderr', 'gelf', 'http-json'];

export interface FileSinkSettings {
  readonly type: 'file';
  readonly level: LogLevel;
  readonly folder: string;
  readonly maxFileBytes: number;
  readonly maxFiles: number;
}

export interface StderrSinkSettings {
  readonly type: 'stderr';
  readonly level: LogLevel;
}

export interface RemoteDelivery {
  readonly queueLength: number;
  readonly timeoutSeconds: number;
  readonly retries: number;
}

export interface GelfSinkSettings extends RemoteDelivery {
  readonly type: 'gelf';
  readonly level: LogLevel;
  /** `http` or `https` URL of the GELF input, or `tcp://host:port` or `udp://host:port`. */
  readonly address: string;
  /** The NAME of an environment variable holding a credential, never the credential. */
  readonly secretEnv?: string;
}

export interface HttpJsonSinkSettings extends RemoteDelivery {
  readonly type: 'http-json';
  readonly level: LogLevel;
  readonly address: string;
  readonly secretEnv?: string;
}

export type SinkSettings = FileSinkSettings | StderrSinkSettings | GelfSinkSettings | HttpJsonSinkSettings;

export interface LoggingSettings {
  readonly level: LogLevel;
  readonly sinks: readonly SinkSettings[];
}

export interface SettingDescription {
  /** The key, in the dotted form a person sees: `file.maxFiles`. */
  readonly key: string;
  readonly type: 'level' | 'integer' | 'text';
  readonly default: string | number;
  readonly min?: number;
  readonly label: string;
  readonly help: string;
  /** A secret is entered as the NAME of an environment variable and never shown back. */
  readonly secret: boolean;
}

export const LOGGING_SETTINGS: readonly SettingDescription[] = [
  {
    key: 'level',
    type: 'level',
    default: LOGGING_DEFAULTS.level,
    label: 'Level',
    help: 'How much to record: error, warn, info or debug. debug adds prompts and output (shortened and filtered).',
    secret: false,
  },
  {
    key: 'file.folder',
    type: 'text',
    default: LOGGING_DEFAULTS.file.folder,
    label: 'Log folder',
    help: 'Where the log files are written. A relative folder stays inside the project.',
    secret: false,
  },
  {
    key: 'file.maxFileBytes',
    type: 'integer',
    default: LOGGING_DEFAULTS.file.maxFileBytes,
    min: 1,
    label: 'Largest log file (bytes)',
    help: 'A new file is started when the current one reaches this size.',
    secret: false,
  },
  {
    key: 'file.maxFiles',
    type: 'integer',
    default: LOGGING_DEFAULTS.file.maxFiles,
    min: 1,
    label: 'Log files kept',
    help: 'The oldest files beyond this number are deleted.',
    secret: false,
  },
  {
    key: 'stderr.level',
    type: 'level',
    default: LOGGING_DEFAULTS.stderr.level,
    label: 'Level shown in the terminal',
    help: 'Records at this level and above are also printed on standard error.',
    secret: false,
  },
  {
    key: 'remote.queueLength',
    type: 'integer',
    default: LOGGING_DEFAULTS.remote.queueLength,
    min: 1,
    label: 'Records held while a collector is slow',
    help: 'When the queue is full the oldest debug records are dropped and the count is logged once.',
    secret: false,
  },
  {
    key: 'remote.timeoutSeconds',
    type: 'integer',
    default: LOGGING_DEFAULTS.remote.timeoutSeconds,
    min: 1,
    label: 'Send timeout (seconds)',
    help: 'A collector that does not answer in this time is treated as down for this attempt.',
    secret: false,
  },
  {
    key: 'remote.retries',
    type: 'integer',
    default: LOGGING_DEFAULTS.remote.retries,
    min: 0,
    label: 'Send retries',
    help: 'After this many failed attempts a record is dropped, with one warning per outage.',
    secret: false,
  },
  {
    key: 'remote.secretEnv',
    type: 'text',
    default: '',
    label: 'Environment variable holding the collector credential',
    help: 'The name of the variable, not its value. The value is read when the command starts and is never logged.',
    secret: true,
  },
];

export interface ResolvedLogging {
  readonly settings: LoggingSettings;
  /** One plain sentence per problem, each naming the key. Empty when the input is valid. */
  readonly problems: readonly string[];
}

const ADDRESS = /^(https?|tcp|udp):\/\/[^\s/]+(:\d+)?(\/\S*)?$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const UNSAFE_PATH = /[\0\r\n]/;

type Raw = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unknownKeys(raw: Raw, allowed: readonly string[], where: string, problems: string[]): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      problems.push(`${where}${key} is not a logging setting (allowed: ${allowed.join(', ')})`);
    }
  }
}

function levelOf(raw: unknown, fallback: LogLevel, where: string, problems: string[]): LogLevel {
  if (raw === undefined) {
    return fallback;
  }
  if (isLogLevel(raw)) {
    return raw;
  }
  problems.push(`${where} must be one of error, warn, info, debug`);
  return fallback;
}

function countOf(raw: unknown, fallback: number, min: number, where: string, problems: string[]): number {
  if (raw === undefined) {
    return fallback;
  }
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= min) {
    return raw;
  }
  problems.push(`${where} must be a whole number of at least ${min}`);
  return fallback;
}

function remoteOf(raw: Raw, where: string, problems: string[]): RemoteDelivery {
  const d = LOGGING_DEFAULTS.remote;
  return {
    queueLength: countOf(raw.queueLength, d.queueLength, 1, `${where}queueLength`, problems),
    timeoutSeconds: countOf(raw.timeoutSeconds, d.timeoutSeconds, 1, `${where}timeoutSeconds`, problems),
    retries: countOf(raw.retries, d.retries, 0, `${where}retries`, problems),
  };
}

function secretEnvOf(raw: unknown, where: string, problems: string[]): { readonly secretEnv?: string } {
  if (raw === undefined) {
    return {};
  }
  if (typeof raw === 'string' && ENV_NAME.test(raw)) {
    return { secretEnv: raw };
  }
  problems.push(`${where} must be the NAME of an environment variable, not its value`);
  return {};
}

function addressOf(raw: unknown, schemes: readonly string[], where: string, problems: string[]): string {
  if (typeof raw === 'string' && ADDRESS.test(raw) && schemes.includes(raw.slice(0, raw.indexOf(':')))) {
    return raw;
  }
  problems.push(`${where} must be an address starting with ${schemes.map((s) => `${s}://`).join(' or ')}`);
  return '';
}

function sinkOf(raw: unknown, index: number, problems: string[]): SinkSettings | undefined {
  const where = `sinks[${index}].`;
  if (!isRecord(raw)) {
    problems.push(`sinks[${index}] must be a mapping with a type`);
    return undefined;
  }
  const type = raw.type;
  if (type === 'file') {
    unknownKeys(raw, ['type', 'level', 'folder', 'maxFileBytes', 'maxFiles'], where, problems);
    const d = LOGGING_DEFAULTS.file;
    const folder = raw.folder === undefined ? d.folder : raw.folder;
    if (typeof folder !== 'string' || folder.trim() === '' || UNSAFE_PATH.test(folder)) {
      problems.push(`${where}folder must be a folder path`);
    }
    return {
      type,
      level: levelOf(raw.level, 'debug', `${where}level`, problems),
      folder:
        typeof folder === 'string' && folder.trim() !== '' && !UNSAFE_PATH.test(folder) ? folder : d.folder,
      maxFileBytes: countOf(raw.maxFileBytes, d.maxFileBytes, 1, `${where}maxFileBytes`, problems),
      maxFiles: countOf(raw.maxFiles, d.maxFiles, 1, `${where}maxFiles`, problems),
    };
  }
  if (type === 'stderr') {
    unknownKeys(raw, ['type', 'level'], where, problems);
    return { type, level: levelOf(raw.level, LOGGING_DEFAULTS.stderr.level, `${where}level`, problems) };
  }
  if (type === 'gelf' || type === 'http-json') {
    unknownKeys(
      raw,
      ['type', 'level', 'address', 'secretEnv', 'queueLength', 'timeoutSeconds', 'retries'],
      where,
      problems,
    );
    const schemes = type === 'gelf' ? ['http', 'https', 'tcp', 'udp'] : ['http', 'https'];
    return {
      type,
      level: levelOf(raw.level, 'info', `${where}level`, problems),
      address: addressOf(raw.address, schemes, `${where}address`, problems),
      ...secretEnvOf(raw.secretEnv, `${where}secretEnv`, problems),
      ...remoteOf(raw, where, problems),
    };
  }
  problems.push(`${where}type must be one of ${SINK_TYPES.join(', ')}`);
  return undefined;
}

/**
 * Turns the `logging:` section of the configuration (or nothing) into the settings in use. Anything missing takes its
 * default; anything unknown or of the wrong type is a problem that names the key. Nothing is ignored silently.
 */
export function resolveLoggingSettings(raw: unknown): ResolvedLogging {
  const problems: string[] = [];
  const defaults: LoggingSettings = {
    level: LOGGING_DEFAULTS.level,
    sinks: [
      {
        type: 'file',
        level: 'debug',
        folder: LOGGING_DEFAULTS.file.folder,
        maxFileBytes: LOGGING_DEFAULTS.file.maxFileBytes,
        maxFiles: LOGGING_DEFAULTS.file.maxFiles,
      },
      { type: 'stderr', level: LOGGING_DEFAULTS.stderr.level },
    ],
  };
  if (raw === undefined || raw === null) {
    return { settings: defaults, problems };
  }
  if (!isRecord(raw)) {
    return { settings: defaults, problems: ['logging must be a mapping'] };
  }
  unknownKeys(raw, ['level', 'sinks'], '', problems);
  const level = levelOf(raw.level, defaults.level, 'level', problems);
  if (raw.sinks === undefined) {
    return { settings: { level, sinks: defaults.sinks }, problems };
  }
  if (!Array.isArray(raw.sinks)) {
    problems.push('sinks must be a list');
    return { settings: { level, sinks: defaults.sinks }, problems };
  }
  const sinks: SinkSettings[] = [];
  raw.sinks.forEach((entry: unknown, index: number) => {
    const sink = sinkOf(entry, index, problems);
    if (sink !== undefined) {
      sinks.push(sink);
    }
  });
  return { settings: { level, sinks }, problems };
}

/** The default sinks, as `resolveLoggingSettings` gives them when the section is missing. */
export function defaultLoggingSettings(): LoggingSettings {
  return resolveLoggingSettings(undefined).settings;
}

type ConfigValue = string | number | boolean | readonly ConfigMapping[];
interface ConfigMapping {
  readonly [key: string]: ConfigValue;
}

/** A sink's level when its entry does not name one, as `resolveLoggingSettings` reads it. */
function defaultLevelOf(type: SinkType): LogLevel {
  if (type === 'file') {
    return 'debug';
  }
  return type === 'stderr' ? LOGGING_DEFAULTS.stderr.level : 'info';
}

function sinkToConfig(sink: SinkSettings): ConfigMapping {
  const out: Record<string, ConfigValue> = { type: sink.type };
  if (sink.level !== defaultLevelOf(sink.type)) {
    out.level = sink.level;
  }
  if (sink.type === 'file') {
    const d = LOGGING_DEFAULTS.file;
    if (sink.folder !== d.folder) {
      out.folder = sink.folder;
    }
    if (sink.maxFileBytes !== d.maxFileBytes) {
      out.maxFileBytes = sink.maxFileBytes;
    }
    if (sink.maxFiles !== d.maxFiles) {
      out.maxFiles = sink.maxFiles;
    }
  } else if (sink.type === 'gelf' || sink.type === 'http-json') {
    const d = LOGGING_DEFAULTS.remote;
    out.address = sink.address;
    if (sink.secretEnv !== undefined) {
      out.secretEnv = sink.secretEnv;
    }
    if (sink.queueLength !== d.queueLength) {
      out.queueLength = sink.queueLength;
    }
    if (sink.timeoutSeconds !== d.timeoutSeconds) {
      out.timeoutSeconds = sink.timeoutSeconds;
    }
    if (sink.retries !== d.retries) {
      out.retries = sink.retries;
    }
  }
  return out;
}

/**
 * The `logging:` section that `resolveLoggingSettings` reads back as `settings`, with every value equal to its default
 * left out, so a saved file says only what the person changed (AC-18, AC-20). `resolveLoggingSettings` of the result
 * gives the same settings and no problem.
 */
export function loggingSettingsToConfig(settings: LoggingSettings): Readonly<Record<string, ConfigValue>> {
  const out: Record<string, ConfigValue> = {};
  if (settings.level !== LOGGING_DEFAULTS.level) {
    out.level = settings.level;
  }
  const sinks = settings.sinks.map(sinkToConfig);
  const defaults = defaultLoggingSettings().sinks.map(sinkToConfig);
  if (JSON.stringify(sinks) !== JSON.stringify(defaults)) {
    out.sinks = sinks;
  }
  return out;
}
