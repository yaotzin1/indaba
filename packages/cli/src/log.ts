import {
  createLogger,
  createRedactor,
  type GelfSinkSettings,
  type HttpJsonSinkSettings,
  isLogLevel,
  LOG_LEVELS,
  type Logger,
  type LoggingSettings,
  type LogLevel,
  type LogRecord,
  type LogSink,
  type LogSinkRegistry,
  resolveLoggingSettings,
} from '@indaba/core';
import { FileLogSink, GelfLogSink, HttpJsonLogSink, type RemoteLogTrouble } from '@indaba/engine';
import { printableText } from './printable.js';

/** The logging options every command accepts (specs/logging, AC-07 and section 8, item 3). */
export const LOG_OPTIONS_USAGE = `Logging (every command; more in the logging: section of indaba.config):
      --log-level <level>  error, warn, info or debug (default: info; or INDABA_LOG_LEVEL)
      --log-dir <dir>      Folder of the log files (default: .indaba/logs; a relative one stays in the project)
`;

export class LogUsageError extends Error {}

export interface LogOptions {
  /** The arguments with the logging options taken out, for the command's own parser. */
  readonly args: readonly string[];
  readonly level: LogLevel | undefined;
  readonly dir: string | undefined;
}

const LEVELS = LOG_LEVELS.join(', ');

function levelOf(value: string, where: string): LogLevel {
  if (isLogLevel(value)) {
    return value;
  }
  throw new LogUsageError(`${where} must be one of ${LEVELS}, got "${printableText(value)}"`);
}

/**
 * Takes `--log-level` and `--log-dir` (as `--opt value` or `--opt=value`) out of a command's arguments, so every command,
 * `watch` included, accepts them without each parser knowing about them. Nothing after `--` is looked at.
 */
export function extractLogOptions(args: readonly string[]): LogOptions {
  const rest: string[] = [];
  let level: LogLevel | undefined;
  let dir: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';
    if (arg === '--') {
      rest.push(...args.slice(i));
      break;
    }
    const [name, inline] = arg.startsWith('--log-') ? splitOption(arg) : [arg, undefined];
    if (name !== '--log-level' && name !== '--log-dir') {
      rest.push(arg);
      continue;
    }
    let value = inline;
    if (value === undefined) {
      value = args[i + 1];
      i += 1;
    }
    if (value === undefined || value === '' || (inline === undefined && value.startsWith('-'))) {
      throw new LogUsageError(`${name} needs a value`);
    }
    if (name === '--log-level') {
      level = levelOf(value, '--log-level');
    } else {
      dir = value;
    }
  }
  return { args: rest, level, dir };
}

function splitOption(arg: string): [string, string | undefined] {
  const at = arg.indexOf('=');
  return at < 0 ? [arg, undefined] : [arg.slice(0, at), arg.slice(at + 1)];
}

/**
 * The option wins over the variable, the variable over `indaba.config`, and with none of them the default applies
 * (AC-07, AC-13).
 */
export function chooseLevel(
  option: LogLevel | undefined,
  variable: string | undefined,
  configured: LogLevel = resolveLoggingSettings(undefined).settings.level,
): LogLevel {
  if (option !== undefined) {
    return option;
  }
  if (variable !== undefined && variable !== '') {
    return levelOf(variable, 'INDABA_LOG_LEVEL');
  }
  return configured;
}

/** One line of printable text: escape sequences and controls dropped, line breaks and tabs made spaces. */
function flat(text: string): string {
  return printableText(text).replace(/[\r\n\t]+/g, ' ');
}

function shown(value: string | number | boolean): string {
  const text = flat(String(value));
  return text === '' || /[\s="]/.test(text) ? `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : text;
}

/** `level: message`, then `key=value` fields and context, as plain text with nothing a terminal would act on (AC-08). */
export function formatForTerminal(record: LogRecord): string {
  const pairs = [...Object.entries(record.fields ?? {}), ...Object.entries(record.context ?? {})].map(
    ([key, value]) => `${flat(key)}=${shown(value)}`,
  );
  return `${[`${record.level}: ${flat(record.message)}`, ...pairs].join(' ')}\n`;
}

/** The standard-error sink: `warn` and above by default, so standard output never changes. */
export function stderrSink(stream: { write(text: string): void }, level: LogLevel): LogSink {
  return { level, write: (record) => stream.write(formatForTerminal(record)) };
}

export interface CommandLogOptions {
  /** The project the command works in; the default log folder is inside it. */
  readonly root: string;
  readonly level: LogLevel;
  /** `--log-dir`: replaces the folder of every file sink. */
  readonly dir: string | undefined;
  /** The sinks, from `indaba.config` or the defaults. */
  readonly settings?: LoggingSettings;
  readonly stderr: { write(text: string): void };
  /** The values to keep out of every record, by the rule of `createRedactor`, and the source of collector credentials. */
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly clock: () => Date;
  readonly pid: number;
  /** The `host` of a GELF message: this machine's name. */
  readonly hostname?: string;
}

/** The logger of a command, and the door a plugin's sink comes in through. */
export type CommandLogger = Logger & LogSinkRegistry;

const TROUBLE: Readonly<Record<RemoteLogTrouble['kind'], string>> = {
  unreachable: 'a log collector cannot be reached; records for it are dropped until it answers',
  'reachable-again': 'a log collector answers again',
  dropped: 'records for a log collector were dropped',
};

function remoteSink(
  settings: GelfSinkSettings | HttpJsonSinkSettings,
  options: CommandLogOptions,
  credential: string | undefined,
  tell: (trouble: RemoteLogTrouble) => void,
): LogSink {
  const common = {
    level: settings.level,
    address: settings.address,
    queueLength: settings.queueLength,
    timeoutSeconds: settings.timeoutSeconds,
    retries: settings.retries,
    onTrouble: tell,
    ...(credential === undefined ? {} : { credential }),
  };
  return settings.type === 'gelf'
    ? new GelfLogSink({ ...common, source: options.hostname ?? 'indaba', pid: options.pid })
    : new HttpJsonLogSink(common);
}

/**
 * The one logger of a command: the sinks of `indaba.config` (or the default file and standard-error sinks), the level
 * chosen, and every record redacted before any sink sees it (AC-05, T-06): the environment's secret values, the
 * credentials of the collectors, bearer tokens, API-key shapes and a token in a URL. A log folder that cannot be
 * written costs one warning and the command goes on without the file; a collector that is down costs one warning per
 * outage (specs/logging, section 5, AC-16). A collector's credential is read here, from the variable `secretEnv`
 * names, and from nowhere else.
 */
export function openCommandLogger(options: CommandLogOptions): CommandLogger {
  const configured = options.settings ?? resolveLoggingSettings(undefined).settings;
  const sinks: LogSink[] = [];
  const credentials: string[] = [];
  const unsetVariables: string[] = [];
  let logger: CommandLogger | undefined;
  for (const sink of configured.sinks) {
    if (sink.type === 'file') {
      try {
        sinks.push(
          new FileLogSink({
            root: options.root,
            folder: options.dir ?? sink.folder,
            maxFileBytes: sink.maxFileBytes,
            maxFiles: sink.maxFiles,
            level: sink.level,
            onError: (folder) =>
              logger?.warn('logging.file', 'the log folder cannot be written; this command logs no file', {
                folder,
              }),
          }),
        );
      } catch (error) {
        const where = options.dir === undefined ? 'logging folder' : '--log-dir';
        throw new LogUsageError(`${where}: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (sink.type === 'stderr') {
      sinks.push(stderrSink(options.stderr, sink.level));
    } else {
      const credential = sink.secretEnv === undefined ? undefined : options.environment[sink.secretEnv];
      if (sink.secretEnv !== undefined && (credential === undefined || credential === '')) {
        unsetVariables.push(sink.secretEnv);
      }
      if (credential !== undefined && credential !== '') {
        credentials.push(credential);
      }
      const address = sink.address;
      const type = sink.type;
      try {
        sinks.push(
          remoteSink(sink, options, credential === '' ? undefined : credential, (trouble) =>
            logger?.warn('logging.remote', TROUBLE[trouble.kind], {
              sink: type,
              address,
              ...(trouble.kind === 'unreachable' ? { reason: trouble.reason } : {}),
              ...(trouble.kind === 'dropped' ? { count: trouble.count } : {}),
            }),
          ),
        );
      } catch (error) {
        throw new LogUsageError(`logging: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  logger = createLogger({
    sinks,
    clock: options.clock,
    level: options.level,
    pid: options.pid,
    redact: createRedactor({ environment: options.environment, values: credentials }),
  });
  for (const variable of unsetVariables) {
    logger.warn(
      'logging.remote',
      'the variable named in secretEnv is not set; the collector gets no credential',
      {
        variable,
      },
    );
  }
  return logger;
}
