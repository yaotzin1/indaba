# API surface: Logging

> **Status**: Draft. **Semver impact**: minor (below 1.0). Additive: no existing type, option or default changes.

## Public symbols added

| Name | Kind | Package |
| :--- | :--- | :--- |
| `LogLevel` | type | `@indaba/core` |
| `LogRecord`, `LogSink`, `Logger`, `LoggerOptions` | interfaces | `@indaba/core` |
| `createLogger(options)`, `noopLogger` | function, constant | `@indaba/core` |
| `FileLogSink` | class | `@indaba/engine` |
| `LogContext`, `Logger.child(context)` | interface, method (adds `runId`, `taskId`, `stepId`, `traceId`) | `@indaba/core` |
| `FileLogSink`, `GelfLogSink`, `HttpJsonLogSink` | classes | `@indaba/engine` |
| `--log-level <level>`, `--log-dir <dir>` | CLI options on every command | `indaba` |
| `INDABA_LOG_LEVEL` | environment variable | `indaba` |
| `logging:` section (`level`, `sinks`, `maxFileBytes`, `maxFiles`, `folder`) | project configuration, `indaba.config` | `indaba` |
| `indaba report [run]` | CLI command (second step) | `indaba` |
| `LOGGING_SETTINGS`, `LOGGING_DEFAULTS`, `SettingDescription` | constants, type: the one description the parser and every UI use | `@indaba/core` |
| Settings screen for logging | web page (with the actions step) and terminal dashboard | `@indaba/web`, `@indaba/tui` |
| `PUT /api/v1/settings/logging`, `GET /api/v1/settings/logging` | HTTP, with the actions step of `specs/web-app` | `@indaba/server` |
| `logger?: Logger` | option on the engine, the runners and `ServerOptions` | each package |
| `logEngineEvents(events, logger)`, `EventSource` | function, interface: engine events into log records (AC-22) | `@indaba/engine` |
| `Logger`, `LogRecord`, `LogSink`, `LogLevel`, `LogContext`, `LogFields`, `createLogger`, `noopLogger` | re-exports of `@indaba/core` (AC-23) | `@indaba/engine` |
| `PluginHost.logger?` | the command's logger, for plugins (optional so an existing host still type-checks) | `@indaba/core` |
| `CreateEngineOptions.logger?` | wires the logger to the events and the plugin host | `indaba` |
| `WatchOptions.logger?` | the dashboard's log | `@indaba/tui` |
| `Plugin.logSinks?` | extension point | `@indaba/core` |

```ts
// @indaba/core
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';
export interface LogRecord {
  readonly time: string;                      // ISO 8601, from the injected clock
  readonly level: LogLevel;
  readonly component: string;                 // 'engine.worktree', 'server.http'
  readonly message: string;                   // a constant sentence; never untrusted text
  readonly fields?: Readonly<Record<string, string | number | boolean>>;
}
export interface LogContext { readonly runId?: string; readonly taskId?: string; readonly stepId?: string; readonly traceId?: string; }
// LogRecord also carries `context?: LogContext` and `pid: number` (injected, so core reads no process)
export interface LogSink {
  readonly level?: LogLevel;                  // a sink's own minimum, at or above the logger's
  write(record: LogRecord): void;             // must not throw, must not block; one that does is dropped
  flush?(): Promise<void>;                    // called once when the command ends
}
export interface Logger {
  error(component: string, message: string, fields?: LogRecord['fields']): void;
  warn(component: string, message: string, fields?: LogRecord['fields']): void;
  info(component: string, message: string, fields?: LogRecord['fields']): void;
  debug(component: string, message: string, fields?: LogRecord['fields']): void;
  child(context: LogContext): Logger;         // same sinks and level, every record gets this context
}
export interface LoggerOptions {
  readonly sinks: readonly LogSink[];
  readonly clock: () => Date;
  readonly level?: LogLevel;                  // default 'info'
  readonly redact?: (text: string) => string; // applied to the message and every string field
}
export function createLogger(options: LoggerOptions): Logger;
export const noopLogger: Logger;
```

## Compatibility

Every `logger` option is optional and defaults to `noopLogger`, so an embedder who passes nothing sees no change. No
default, field meaning, event or span attribute changes. The new file lives under the gitignored `.indaba/`.
