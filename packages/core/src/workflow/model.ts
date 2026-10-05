import { IndabaError } from '../errors/index.js';

export const DecisionType = {
  /** Every participant must agree. */
  Consensus: 'consensus',
  /** More than half of the participants must agree. */
  Majority: 'majority',
} as const;
export type DecisionType = (typeof DecisionType)[keyof typeof DecisionType];

export const FailureAction = {
  RetryStep: 'retry_step',
  Escalate: 'escalate',
  Fail: 'fail',
} as const;
export type FailureAction = (typeof FailureAction)[keyof typeof FailureAction];

/** Guard types Indaba ships. A guard type is an open string: a plugin registers its own without touching core. */
export const GuardType = {
  GitDiffEmpty: 'git_diff_empty',
  /** The worktree diff may only touch the allowed globs (`paths`). */
  DiffWithinScope: 'diff_within_scope',
} as const;
export type GuardType = string;

export const PermissionMode = {
  Allow: 'allow',
  Deny: 'deny',
} as const;
export type PermissionMode = (typeof PermissionMode)[keyof typeof PermissionMode];

/** What a step's agent may touch. Absent on a step means the runner's own defaults. */
export interface StepPermissions {
  readonly fsRead: readonly string[];
  readonly fsWrite: readonly string[];
  readonly terminal: PermissionMode;
}

/** An agent for a protocol runner: a named preset, or a literal command and arguments. */
export interface AgentSpec {
  readonly preset?: string;
  readonly command?: readonly string[];
}

export const Isolation = {
  None: 'none',
  GitWorktree: 'git_worktree',
} as const;
export type Isolation = (typeof Isolation)[keyof typeof Isolation];

export const McpPolicy = {
  /** A step that needs a server its runner cannot provide is refused before the run starts. */
  Required: 'required',
  /** The step runs without a server its runner cannot provide. */
  Optional: 'optional',
} as const;
export type McpPolicy = (typeof McpPolicy)[keyof typeof McpPolicy];

/**
 * A Model Context Protocol server a step may use: either a local process (`command`) or a
 * remote endpoint (`url`). The values are operator-authored and may carry secrets, so nothing
 * here is ever logged or put into a span; only `name` is.
 */
export interface McpServerDefinition {
  readonly name: string;
  readonly command?: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly url?: string;
}

export interface GuardDefinition {
  readonly type: GuardType;
  readonly paths: readonly string[];
}

export interface OnFailure {
  readonly action: FailureAction;
  readonly target?: string;
  readonly maxRetries: number;
}

export interface RoleDefinition {
  readonly name: string;
  readonly runner: string;
  /** Tried in order when the primary runner could not run at all. */
  readonly fallbackRunners?: readonly string[];
  readonly agent?: AgentSpec;
  readonly model?: string;
  /** Names of MCP servers every step of this role may use. */
  readonly mcp: readonly string[];
}

export const SHELL_RUNNER = 'shell';

export interface StepDefinition {
  readonly id: string;
  readonly role?: string;
  readonly runner?: string;
  readonly fallbackRunners?: readonly string[];
  readonly agent?: AgentSpec;
  readonly permissions?: StepPermissions;
  readonly goal: string;
  readonly dependsOn: readonly string[];
  readonly inputArtifacts: readonly string[];
  readonly outputs: readonly string[];
  readonly commands: readonly string[];
  readonly guards: readonly GuardDefinition[];
  readonly isolation: Isolation;
  readonly onFailure?: OnFailure;
  readonly consensusWith: readonly string[];
  readonly decisionType?: DecisionType;
  /** Names of MCP servers this step may use, besides its role's. */
  readonly mcp: readonly string[];
  /** Absent means the workflow default. */
  readonly mcpPolicy?: McpPolicy;
}

export interface WorkflowDefinition {
  readonly version: string;
  readonly name: string;
  readonly artifacts: Readonly<Record<string, string>>;
  readonly roles: Readonly<Record<string, RoleDefinition>>;
  readonly steps: readonly StepDefinition[];
  readonly mcpServers: Readonly<Record<string, McpServerDefinition>>;
  readonly defaultMcpPolicy: McpPolicy;
}

/** Fills every collection and scalar default so callers only state what differs. */
export function defineStep(init: Partial<StepDefinition> & { readonly id: string }): StepDefinition {
  return {
    goal: '',
    dependsOn: [],
    inputArtifacts: [],
    outputs: [],
    commands: [],
    guards: [],
    isolation: Isolation.None,
    consensusWith: [],
    mcp: [],
    ...init,
  };
}

export function isShellStep(step: StepDefinition): boolean {
  return step.runner === SHELL_RUNNER;
}

export function isConsensusStep(step: StepDefinition): boolean {
  return step.decisionType !== undefined || step.consensusWith.length > 0;
}

export function stepOf(workflow: WorkflowDefinition, id: string): StepDefinition {
  const step = workflow.steps.find((s) => s.id === id);
  if (step === undefined) {
    throw new IndabaError(`Unknown step "${id}".`);
  }
  return step;
}

export function roleOf(workflow: WorkflowDefinition, name: string): RoleDefinition {
  const role = Object.hasOwn(workflow.roles, name) ? workflow.roles[name] : undefined;
  if (role === undefined) {
    throw new IndabaError(`Unknown role "${name}".`);
  }
  return role;
}
