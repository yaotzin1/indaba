/**
 * The logging contract (specs/logging). Pure: no clock, process or environment is read here. The clock, the process id
 * and the redaction are handed in, so the same inputs and the same clock give the same records in the same order.
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export const LOG_LEVELS: readonly LogLevel[] = ['error', 'warn', 'info', 'debug'];

const RANK: Readonly<Record<LogLevel, number>> = { error: 0, warn: 1, info: 2, debug: 3 };

/** True when a record of `level` is at least as severe as the `minimum` that is kept. */
export function levelEnabled(level: LogLevel, minimum: LogLevel): boolean {
  return RANK[level] <= RANK[minimum];
}

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}

/** What ties a record to a run, so one failure can be found with a filter. */
export interface LogContext {
  readonly runId?: string;
  readonly taskId?: string;
  readonly stepId?: string;
  readonly traceId?: string;
}

export type LogFields = Readonly<Record<string, string | number | boolean>>;

export interface LogRecord {
  /** ISO 8601, from the injected clock. */
  readonly time: string;
  readonly level: LogLevel;
  /** The package and area, such as `engine.worktree` or `server.http`. */
  readonly component: string;
  /** A fixed sentence of the source. Text from outside goes in `fields`, never here. */
  readonly message: string;
  readonly fields?: LogFields;
  readonly context?: LogContext;
  readonly pid?: number;
}

/** A place records go. `write` must not throw and must not block; a sink that throws is dropped. */
export interface LogSink {
  /** The sink's own minimum, at or above the logger's. */
  readonly level?: LogLevel;
  write(record: LogRecord): void;
  /** Called once when the command ends, so a queued sink can send what is left. */
  flush?(): Promise<void>;
}

export interface Logger {
  error(component: string, message: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(component: string, message: string, fields?: Readonly<Record<string, unknown>>): void;
  info(component: string, message: string, fields?: Readonly<Record<string, unknown>>): void;
  debug(component: string, message: string, fields?: Readonly<Record<string, unknown>>): void;
  /** Same sinks and level; every record gets this context on top of the parent's. */
  child(context: LogContext): Logger;
  /** Flushes every sink that can be flushed. Never rejects. */
  flush(): Promise<void>;
}

/**
 * A logger that sinks can join after it was built: the composition root makes the logger before it loads the plugins,
 * and a plugin's sink joins through `PluginHost.registerLogSink` (specs/logging, AC-10). Every logger derived with
 * `child` shares the same sinks.
 */
export interface LogSinkRegistry {
  /** Adds a sink for the records from now on, with the same isolation as the sinks given at the start. */
  addSink(sink: LogSink): void;
}

export interface LoggerOptions {
  readonly sinks: readonly LogSink[];
  readonly clock: () => Date;
  /** Default `info`. */
  readonly level?: LogLevel;
  /** Applied to the message and to every string field, before any sink sees the record. */
  readonly redact?: (text: string) => string;
  readonly pid?: number;
}

/**
 * The longest string kept in a field. A starting value, not a measurement: it keeps one runaway value from filling a
 * file, and is revised from real logs (specs/logging, section 8).
 */
export const MAX_FIELD_LENGTH = 1000;

const TRUNCATED = '...[truncated]';

function clean(value: unknown, redact: (text: string) => string): string | number | boolean {
  if (typeof value === 'string') {
    const text = redact(value);
    return text.length > MAX_FIELD_LENGTH ? `${text.slice(0, MAX_FIELD_LENGTH)}${TRUNCATED}` : text;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return value === null ? 'null' : typeof value;
}

const identity = (text: string): string => text;

export const noopLogger: Logger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  child: () => noopLogger,
  flush: () => Promise.resolve(),
};

export function createLogger(options: LoggerOptions): Logger & LogSinkRegistry {
  const minimum = options.level ?? 'info';
  const redact = options.redact ?? identity;
  const active = [...options.sinks];

  const deliver = (record: LogRecord): void => {
    for (const sink of [...active]) {
      if (sink.level !== undefined && !levelEnabled(record.level, sink.level)) {
        continue;
      }
      try {
        sink.write(record);
      } catch {
        // A failing sink is dropped for the rest of the run, and the others hear about it once.
        const at = active.indexOf(sink);
        if (at >= 0) {
          active.splice(at, 1);
        }
        emit('warn', 'logging', 'a log sink failed and was dropped', {}, {});
      }
    }
  };

  const emit = (
    level: LogLevel,
    component: string,
    message: string,
    fields: Readonly<Record<string, unknown>> | undefined,
    context: LogContext,
  ): void => {
    if (!levelEnabled(level, minimum)) {
      return;
    }
    const kept: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(fields ?? {})) {
      kept[redact(key)] = clean(value, redact);
    }
    const cleanContext: Record<string, string> = {};
    for (const [key, value] of Object.entries(context)) {
      if (typeof value === 'string') {
        cleanContext[key] = redact(value);
      }
    }
    deliver({
      time: options.clock().toISOString(),
      level,
      component: redact(component),
      message: redact(message),
      ...(Object.keys(kept).length > 0 ? { fields: kept } : {}),
      ...(Object.keys(cleanContext).length > 0 ? { context: cleanContext } : {}),
      ...(options.pid === undefined ? {} : { pid: options.pid }),
    });
  };

  const build = (context: LogContext): Logger => ({
    error: (component, message, fields) => emit('error', component, message, fields, context),
    warn: (component, message, fields) => emit('warn', component, message, fields, context),
    info: (component, message, fields) => emit('info', component, message, fields, context),
    debug: (component, message, fields) => emit('debug', component, message, fields, context),
    child: (extra) => build({ ...context, ...extra }),
    flush: async () => {
      await Promise.all(
        [...active].map(async (sink) => {
          try {
            await sink.flush?.();
          } catch {
            // A sink that cannot flush has nothing more to give; the command is ending.
          }
        }),
      );
    },
  });

  return {
    ...build({}),
    addSink: (sink) => {
      if (!active.includes(sink)) {
        active.push(sink);
      }
    },
  };
}
