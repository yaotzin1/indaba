/**
 * The logging contract of @indaba/core, re-exported so a package that may only import the engine (the terminal
 * dashboard) takes a logger from the same place as everyone else.
 */
export type { LogContext, LogFields, Logger, LogLevel, LogRecord, LogSink } from '@indaba/core';
export { createLogger, noopLogger } from '@indaba/core';
export type { DecisionLedgerOptions, LedgerEntry, MemoKey } from './arbiter/ledger.js';
export { DecisionLedger, LEDGER_DIRECTORY } from './arbiter/ledger.js';
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
export { JsonlSpanExporter } from './observability/jsonl-span-exporter.js';
export type { EventSource } from './observability/log-events.js';
export { logEngineEvents } from './observability/log-events.js';
export { RandomIdGenerator, SystemClock } from './observability/system.js';
export { ErrorBag } from './parser/error-bag.js';
export { Interpolator } from './parser/interpolator.js';
export { parseWorkflow, WorkflowParser } from './parser/parser.js';
export { WorkflowValidator } from './parser/validator.js';
export * from './trace/index.js';
export type { GitOptions, GitRunOptions } from './workspace/git.js';
export { Git } from './workspace/git.js';
export { GitWorktree } from './workspace/git-worktree.js';
export { GitWorktreeManager } from './workspace/git-worktree-manager.js';
export { PatchService } from './workspace/patch-service.js';
export type { Workspace, WorkspaceManager } from './workspace/workspace.js';
