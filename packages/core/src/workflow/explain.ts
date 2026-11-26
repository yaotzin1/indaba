import { DagBuilder } from './dag-builder.js';
import type { StepDefinition, StepPermissions, WorkflowDefinition } from './model.js';
import {
  DecisionType,
  GuardType,
  isConsensusStep,
  isShellStep,
  McpPolicy,
  PermissionLevel,
  SHELL_RUNNER,
} from './model.js';
import { effectiveGuards, planForStep, stepTimeoutSeconds } from './resolve.js';

/**
 * What `indaba plan --explain` says about a workflow: for each step the effective value of each setting that decides what
 * the step may do and when it stops, where each value comes from, and what the step lacks (specs/plan-explain). A pure
 * value: the same workflow, origin map and facts always give the same explanation.
 */

/** Who wrote a value. `preset` is reserved (C-04); nothing in this module emits it. */
export type OriginKind = 'file' | 'role' | 'workflow_defaults' | 'fallback' | 'preset';

export interface Origin {
  readonly kind: OriginKind;
  /** For `fallback`: who decided (`engine`, `runner:<name>`, `flag:<option>`, `env:<NAME>`, `config:<key>`). */
  readonly by?: string;
  /** For `role`: the role's name. */
  readonly ref?: string;
  readonly line?: number;
  readonly column?: number;
}

/** Where something sits in the YAML document, one-based. */
export interface OriginPosition {
  readonly line: number;
  readonly column: number;
}

/**
 * A map from a path in the document (`$.steps[0].isolation`, `$.roles.writer.permissions`, `$.defaults.permissions`) to the
 * position where it was written. It gives lines only: which layer wrote a value is decided from the parsed workflow, so an
 * embedder that holds no source passes an empty map and still gets every origin without a line (AC-12).
 */
export type OriginMap = ReadonlyMap<string, OriginPosition>;

export type SettingKey =
  | 'runner'
  | 'permissions.level'
  | 'permissions.fs.write'
  | 'permissions.terminal'
  | 'isolation'
  | 'timeout_seconds'
  | 'stall'
  | 'on_failure'
  | 'guards'
  | 'mcp_policy'
  | 'decision_type'
  | 'arbiter'
  | 'rounds';

/** The fixed order of a step's settings (AC-02, AC-08). */
export const SETTING_ORDER: readonly SettingKey[] = [
  'runner',
  'permissions.level',
  'permissions.fs.write',
  'permissions.terminal',
  'isolation',
  'timeout_seconds',
  'stall',
  'on_failure',
  'guards',
  'mcp_policy',
  'decision_type',
  'arbiter',
  'rounds',
];

export interface ExplainedGuard {
  readonly type: string;
  readonly paths: readonly string[];
  /** `implied` when a `permissions` block adds it; `declared` when the step wrote it. */
  readonly source: 'declared' | 'implied';
}

export type SettingValue =
  | string
  | number
  | readonly string[]
  | { readonly unknown: string }
  | { readonly afterSeconds: number; readonly retries: number }
  | { readonly action: string; readonly target?: string; readonly maxRetries: number }
  | readonly ExplainedGuard[];

export interface ExplainedSetting {
  readonly key: SettingKey;
  readonly value: SettingValue;
  readonly origin: Origin;
}

export type GapCode =
  | 'no_permission_level'
  | 'no_write_scope'
  | 'no_check_on_result'
  | 'failure_stops_run'
  | 'full_access';

export interface ExplainedGap {
  readonly code: GapCode;
  readonly text: string;
  /** Ids of steps that already cover the gap, when any (Indaba does not judge whether they do). */
  readonly mitigatedBy: readonly string[];
}

export type ExplainedKind = 'shell' | 'agent' | 'debate';

export interface ExplainedStep {
  readonly id: string;
  readonly kind: ExplainedKind;
  readonly settings: readonly ExplainedSetting[];
  readonly gaps: readonly ExplainedGap[];
}

export interface PlanExplanation {
  readonly steps: readonly ExplainedStep[];
}

/** A value Indaba chose, and who chose it (`by` as in `Origin`). */
export interface ExplainFact<T> {
  readonly value: T;
  readonly by: string;
}

/** The facts core cannot hold: what the composition root reads from runners, the command line and the configuration. */
export interface ExplainFacts {
  /** The limit a call gets when a step writes none: the run's `--timeout`, or the engine's default. */
  readonly timeoutSeconds: ExplainFact<number>;
  /** The rounds a debate is given. Absent when an embedder supplies an arbiter that declares no bound (C-07). */
  readonly debateRounds?: ExplainFact<number>;
  /** What a runner's built-in default allows, in words; `undefined` when the runner cannot say (AC-06). */
  readonly runnerDefault: (runner: string) => string | undefined;
}

/** The sentence for an agent step with no level (specs/agent-permissions, AC-08). One source for the CLI and the explanation. */
export function defaultLevelSentence(runner: string, allows: string | undefined): string {
  return `No level is written, so the built-in default of the ${runner} runner applies (${
    allows ?? 'Indaba cannot describe what it allows'
  }), not a level you chose.`;
}

export function fullAccessSentence(runners: readonly string[]): string {
  return `FULL ACCESS: this step's agent can change anything and run anything and nobody approves it (runners: ${runners.join(', ')})`;
}

const NO_WRITE_SCOPE =
  'Nothing says which files this step may change: it works in the project folder and has no write scope and no guard on what it changed.';
const NO_CHECK_ON_RESULT =
  'No guard checks the result of this step: it counts as done when its runner finishes without an error.';
const FAILURE_STOPS_RUN = 'No on_failure is written, so a failure of this step stops the run.';

function kindOf(step: StepDefinition, workflow: WorkflowDefinition): ExplainedKind {
  if (isConsensusStep(step)) {
    return 'debate';
  }
  const role = step.role === undefined ? undefined : workflow.roles[step.role];
  return isShellStep(step) || (step.runner === undefined && role?.runner === SHELL_RUNNER)
    ? 'shell'
    : 'agent';
}

/** The layer that wrote a step's permissions block. The parser hands the very object of the layer it took it from. */
function permissionsLayer(
  step: StepDefinition,
  workflow: WorkflowDefinition,
): {
  readonly kind: 'file' | 'role' | 'workflow_defaults';
  readonly ref?: string;
  readonly path: (i: number) => string;
} {
  const permissions = step.permissions;
  const role = step.role === undefined ? undefined : workflow.roles[step.role];
  if (permissions !== undefined && role?.permissions === permissions) {
    return { kind: 'role', ref: role.name, path: () => `$.roles.${role.name}.permissions` };
  }
  if (permissions !== undefined && workflow.defaultPermissions === permissions) {
    return { kind: 'workflow_defaults', path: () => '$.defaults.permissions' };
  }
  return { kind: 'file', path: (i) => `$.steps[${i}].permissions` };
}

function originOf(
  kind: 'file' | 'role' | 'workflow_defaults',
  path: string,
  origins: OriginMap,
  ref?: string,
): Origin {
  const at = origins.get(path);
  return {
    kind,
    ...(ref !== undefined ? { ref } : {}),
    ...(at !== undefined ? { line: at.line, column: at.column } : {}),
  };
}

function fallback(by: string): Origin {
  return { kind: 'fallback', by };
}

/** Steps that depend on `id`, directly or not, and run shell commands: the ones that might check its result. */
function shellDependents(workflow: WorkflowDefinition, id: string): readonly string[] {
  return new DagBuilder().descendantsOf(workflow, id).filter((dependent) => {
    const step = workflow.steps.find((s) => s.id === dependent);
    return step !== undefined && kindOf(step, workflow) === 'shell';
  });
}

function hasMcp(step: StepDefinition, workflow: WorkflowDefinition): boolean {
  const role = step.role === undefined ? undefined : workflow.roles[step.role];
  return step.mcp.length > 0 || (role?.mcp.length ?? 0) > 0;
}

function explainStep(
  step: StepDefinition,
  index: number,
  workflow: WorkflowDefinition,
  origins: OriginMap,
  facts: ExplainFacts,
): ExplainedStep {
  const kind = kindOf(step, workflow);
  const at = (key: string): string => `$.steps[${index}].${key}`;
  const settings: ExplainedSetting[] = [];
  const gaps: ExplainedGap[] = [];
  const plan = planForStep(step, workflow);

  // runner: the chain, in order. A runner written on the step wins over the role's.
  const role = step.role === undefined ? undefined : workflow.roles[step.role];
  settings.push({
    key: 'runner',
    value: plan.names,
    origin:
      step.runner !== undefined || role === undefined
        ? originOf('file', at('runner'), origins)
        : originOf('role', `$.roles.${role.name}.runner`, origins, role.name),
  });

  const layer = permissionsLayer(step, workflow);
  const permissions: StepPermissions | undefined = kind === 'agent' ? step.permissions : undefined;
  if (permissions !== undefined) {
    const permissionOrigin = originOf(layer.kind, layer.path(index), origins, layer.ref);
    if (permissions.level !== undefined) {
      settings.push({ key: 'permissions.level', value: permissions.level, origin: permissionOrigin });
    }
    settings.push({ key: 'permissions.fs.write', value: permissions.fsWrite, origin: permissionOrigin });
    settings.push({ key: 'permissions.terminal', value: permissions.terminal, origin: permissionOrigin });
  }

  settings.push({
    key: 'isolation',
    value: step.isolation,
    // The model cannot tell a written `none` from an absent field; the source can.
    origin:
      step.isolation !== 'none' || origins.has(at('isolation'))
        ? originOf('file', at('isolation'), origins)
        : fallback('engine'),
  });

  settings.push({
    key: 'timeout_seconds',
    value: stepTimeoutSeconds(step, facts.timeoutSeconds.value),
    origin:
      step.timeoutSeconds !== undefined
        ? originOf('file', at('timeout_seconds'), origins)
        : fallback(facts.timeoutSeconds.by),
  });

  if (kind === 'agent' && step.stall !== undefined) {
    settings.push({
      key: 'stall',
      value: { afterSeconds: step.stall.afterSeconds, retries: step.stall.retries },
      origin: originOf('file', at('stall'), origins),
    });
  }

  if (step.onFailure !== undefined) {
    settings.push({
      key: 'on_failure',
      value: {
        action: step.onFailure.action,
        ...(step.onFailure.target !== undefined ? { target: step.onFailure.target } : {}),
        maxRetries: step.onFailure.maxRetries,
      },
      origin: originOf('file', at('on_failure'), origins),
    });
  }

  const guards = effectiveGuards(step);
  if (guards.length > 0) {
    const declared = new Set(step.guards);
    const implied = permissions !== undefined && guards.some((g) => !declared.has(g));
    settings.push({
      key: 'guards',
      value: guards.map((g) => ({
        type: g.type,
        paths: g.paths,
        source: declared.has(g) ? ('declared' as const) : ('implied' as const),
      })),
      origin:
        step.guards.length > 0 || !implied
          ? originOf('file', at('guards'), origins)
          : originOf(layer.kind, layer.path(index), origins, layer.ref),
    });
  }

  if (kind !== 'shell' && hasMcp(step, workflow)) {
    settings.push({
      key: 'mcp_policy',
      value: step.mcpPolicy ?? workflow.defaultMcpPolicy,
      origin:
        step.mcpPolicy !== undefined
          ? originOf('file', at('mcp_policy'), origins)
          : workflow.defaultMcpPolicy !== McpPolicy.Required || origins.has('$.defaults.mcp_policy')
            ? originOf('workflow_defaults', '$.defaults.mcp_policy', origins)
            : fallback('engine'),
    });
  }

  if (kind === 'debate') {
    settings.push({
      key: 'decision_type',
      value: step.decisionType ?? DecisionType.Consensus,
      origin:
        step.decisionType !== undefined ? originOf('file', at('decision_type'), origins) : fallback('engine'),
    });
    if (step.arbiter !== undefined) {
      settings.push({
        key: 'arbiter',
        value: step.arbiter,
        origin: originOf('file', at('arbiter'), origins),
      });
    }
    settings.push(
      facts.debateRounds === undefined
        ? {
            key: 'rounds',
            value: {
              unknown: 'the arbiter is supplied by the program that runs the workflow and declares no bound',
            },
            origin: fallback('engine'),
          }
        : { key: 'rounds', value: facts.debateRounds.value, origin: fallback(facts.debateRounds.by) },
    );
  }

  // Gaps are facts, never errors, and each is reported only when it follows from the model (AC-05, AC-06).
  if (kind === 'agent') {
    const level = permissions?.level;
    if (level === undefined) {
      const primary = plan.names[0];
      gaps.push({
        code: 'no_permission_level',
        text: defaultLevelSentence(
          primary ?? 'unknown',
          primary === undefined ? undefined : facts.runnerDefault(primary),
        ),
        mitigatedBy: [],
      });
    }
    if (level === PermissionLevel.Full) {
      gaps.push({ code: 'full_access', text: fullAccessSentence(plan.names), mitigatedBy: [] });
    }
    const limiting = guards.some(
      (g) => g.type === GuardType.DiffWithinScope || g.type === GuardType.GitDiffEmpty,
    );
    if (step.isolation === 'none' && !limiting) {
      gaps.push({ code: 'no_write_scope', text: NO_WRITE_SCOPE, mitigatedBy: [] });
    }
    if (guards.length === 0) {
      gaps.push({
        code: 'no_check_on_result',
        text: NO_CHECK_ON_RESULT,
        mitigatedBy: shellDependents(workflow, step.id),
      });
    }
  }
  if (step.onFailure === undefined) {
    gaps.push({ code: 'failure_stops_run', text: FAILURE_STOPS_RUN, mitigatedBy: [] });
  }

  return { id: step.id, kind, settings, gaps };
}

/**
 * Explains every step, in the order `plan` prints them. `origins` may be empty when the source is unknown: every origin is
 * then given without a line (AC-12).
 */
export function explainPlan(
  workflow: WorkflowDefinition,
  origins: OriginMap,
  facts: ExplainFacts,
): PlanExplanation {
  const order = new DagBuilder().build(workflow);
  return {
    steps: order.map((step) => explainStep(step, workflow.steps.indexOf(step), workflow, origins, facts)),
  };
}
