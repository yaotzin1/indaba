import {
  createLogger,
  isLogLevel,
  LOG_LEVELS,
  type Logger,
  type LogLevel,
  type LogRecord,
  type LogSink,
  resolveLoggingSettings,
} from '@indaba/core';
import { FileLogSink } from '@indaba/engine';
import { printableText } from './printable.js';
import { redact } from './redact.js';

/** The logging options every command accepts (specs/logging, AC-07 and section 8, item 3). */
export const LOG_OPTIONS_USAGE = `Logging (every command):
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

/** The option wins over the variable; neither means the default (AC-07). */
export function chooseLevel(option: LogLevel | undefined, variable: string | undefined): LogLevel {
  if (option !== undefined) {
    return option;
  }
  if (variable !== undefined && variable !== '') {
    return levelOf(variable, 'INDABA_LOG_LEVEL');
  }
  return resolveLoggingSettings(undefined).settings.level;
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
  readonly dir: string | undefined;
  readonly stderr: { write(text: string): void };
  /** The values to keep out of every record, by the rule of redact.ts. */
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly clock: () => Date;
  readonly pid: number;
}

/**
 * The one logger of a command: the file sink and the standard-error sink of the defaults, the level chosen, and the
 * environment's secret values redacted before any sink sees a record (AC-05). A log folder that cannot be written costs
 * one warning on standard error and the command goes on without the file (specs/logging, section 5).
 */
export function openCommandLogger(options: CommandLogOptions): Logger {
  const defaults = resolveLoggingSettings(undefined).settings.sinks;
  const sinks: LogSink[] = [];
  let logger: Logger | undefined;
  for (const sink of defaults) {
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
        throw new LogUsageError(`--log-dir: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (sink.type === 'stderr') {
      sinks.push(stderrSink(options.stderr, sink.level));
    }
  }
  logger = createLogger({
    sinks,
    clock: options.clock,
    level: options.level,
    pid: options.pid,
    redact: (text) => redact(text, options.environment),
  });
  return logger;
}
