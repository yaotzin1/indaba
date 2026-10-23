/**
 * The logging contract of @indaba/core, and the one description of its settings, re-exported so a package that may
 * only import the engine (the terminal dashboard and its Settings screen) takes them from the same place as everyone
 * else.
 */
export type {
  LogContext,
  LogFields,
  Logger,
  LoggingSettings,
  LogLevel,
  LogRecord,
  LogSink,
  SettingDescription,
  SinkSettings,
  SinkType,
} from '@indaba/core';
export {
  createLogger,
  defaultLoggingSettings,
  isLogLevel,
  LOG_LEVELS,
  LOGGING_DEFAULTS,
  LOGGING_SETTINGS,
  loggingSettingsToConfig,
  noopLogger,
  resolveLoggingSettings,
  SINK_DEFAULTS,
  SINK_TYPES,
} from '@indaba/core';
export { DISCUSSION_DIRECTORY, DiscussionStore, discussionOf } from './arbiter/discussions.js';
export type { DecisionLedgerOptions, LedgerEntry, MemoKey } from './arbiter/ledger.js';
export { DecisionLedger, LEDGER_DIRECTORY } from './arbiter/ledger.js';
export type { ProjectConfig } from './config/project-config.js';
export {
  PROJECT_CONFIG_FILE,
  PROJECT_CONFIG_SECTIONS,
  parseProjectConfig,
  readProjectConfig,
  writeLoggingConfig,
} from './config/project-config.js';
export type { Catalog, CatalogSources, Describes } from './editor/catalog.js';
export { catalogOf, MAX_DESCRIPTION } from './editor/catalog.js';
export {
  MAX_ALIASES,
  MAX_DOCUMENT_BYTES,
  WorkflowDocument,
  WorkflowDocumentError,
} from './editor/document.js';
export { workflowJsonSchema } from './editor/schema.js';
export type { RunnerPlan } from './engine/chain.js';
export { effectiveGuards, planForRole, planForStep } from './engine/chain.js';
export type { RunnerLookup, Speaker } from './engine/mcp.js';
export { McpIssue, McpPlanner, McpResolution } from './engine/mcp.js';
export { StepOutcome, WorkflowResult, WorkflowStatus } from './engine/outcome.js';
export { PromptBuilder } from './engine/prompt-builder.js';
export type { StepExecutorOptions, StepRunOptions } from './engine/step-executor.js';
export { StepExecutor } from './engine/step-executor.js';
export type { RunOptions, WorkflowEngineOptions } from './engine/workflow-engine.js';
export { WorkflowEngine } from './engine/workflow-engine.js';
export { DiffWithinScopeGuard } from './guard/diff-within-scope-guard.js';
export { GitDiffEmptyGuard } from './guard/git-diff-empty-guard.js';
export { GuardRegistry } from './guard/registry.js';
export type { FileLogSinkOptions } from './observability/file-log-sink.js';
export { FileLogSink } from './observability/file-log-sink.js';
export type { GelfLogSinkOptions } from './observability/gelf-log-sink.js';
export { GelfLogSink, gelfDatagrams, toGelf } from './observability/gelf-log-sink.js';
export type { HttpJsonLogSinkOptions } from './observability/http-json-log-sink.js';
export { HttpJsonLogSink } from './observability/http-json-log-sink.js';
export { JsonlSpanExporter } from './observability/jsonl-span-exporter.js';
export type { EventSource } from './observability/log-events.js';
export { logEngineEvents } from './observability/log-events.js';
export type {
  RemoteDelivery as RemoteLogDelivery,
  RemoteLogSinkOptions,
  RemoteLogTrouble,
} from './observability/remote-log-sink.js';
export { DEFAULT_RETRY_DELAY_MS, RemoteLogSink } from './observability/remote-log-sink.js';
export type { CollectorAddress } from './observability/remote-transport.js';
export { authorizationOf, parseCollectorAddress } from './observability/remote-transport.js';
export { RandomIdGenerator, SystemClock } from './observability/system.js';
export type { Path, Problem } from './parser/diagnose.js';
export { pathText } from './parser/diagnose.js';
export { ErrorBag } from './parser/error-bag.js';
export { Interpolator } from './parser/interpolator.js';
export { parseWorkflow, WorkflowParser } from './parser/parser.js';
export { WorkflowValidator } from './parser/validator.js';
export type { FileWorkflowRegistryOptions } from './registry/file-registry.js';
export { FileWorkflowRegistry } from './registry/file-registry.js';
export type { WorkflowFile, WorkflowFileScan } from './registry/files.js';
export {
  DEFAULT_WORKFLOW,
  MAX_WORKFLOW_BYTES,
  readWorkflowFile,
  SCAN_MAX_DEPTH,
  SCAN_MAX_DIRECTORIES,
  SCAN_MAX_FILES,
  scanWorkflowFiles,
  tooLarge,
  UnreadableWorkflow,
} from './registry/files.js';
export { REGISTRY_INDEX } from './registry/index-file.js';
export * from './trace/index.js';
export type { GitOptions, GitRunOptions } from './workspace/git.js';
export { Git } from './workspace/git.js';
export { GitWorktree } from './workspace/git-worktree.js';
export { GitWorktreeManager } from './workspace/git-worktree-manager.js';
export { PatchService } from './workspace/patch-service.js';
export type { Workspace, WorkspaceManager } from './workspace/workspace.js';
