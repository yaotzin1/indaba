import { Graph, layout } from '@dagrejs/dagre';
import type {
  EditorCatalog,
  JsonObject,
  JsonValue,
  RunSnapshot,
  StepFailureRoute,
  StepView,
  WorkflowEdit,
  WorkflowProblem,
} from '@indaba/core';
import { isOldStyle, nextStepId, presetOf, writeGlobs } from './form-model.js';
import { messages } from './messages.js';

/** The size of a step's card on the canvas, in pixels. */
export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 104;
const GAP_X = 64;
const GAP_Y = 36;

/** The brick kinds the palette offers (spec AC-05, AC-06). */
export type StepBrickKind = 'agent' | 'api' | 'shell' | 'debate';
export type FailureBrickKind = 'retry_step' | 'escalate' | 'fail';
export type BrickKind = StepBrickKind | FailureBrickKind;

const STEP_BRICK_KINDS: readonly StepBrickKind[] = ['agent', 'api', 'shell', 'debate'];
const FAILURE_BRICK_KINDS: readonly FailureBrickKind[] = ['retry_step', 'escalate', 'fail'];

/** Synthetic node id for a step at `index` that has no unique string `id` (spec AC-04). */
export function unaddressableNodeId(index: number): string {
  return `\0step:${index}`;
}

/** Extra facts shown on a step card when the graph edits a workflow draft (spec AC-03, AC-04). */
export interface StepDraftMeta {
  /** Index of the step in `steps` (0-based). */
  readonly index: number;
  /** Display label on the card: the step's `id`, or `(no id)` when absent/empty. */
  readonly label: string;
  /** True when the step is a mapping with a unique non-empty `id` in the draft. */
  readonly addressable: boolean;
  /** Runner name, `role: <name>`, or `debate (<roles>)`. */
  readonly runnerLabel: string;
  /** Permission rule (`read-only`, `writes ...`, `full access`, `old style full access`, `custom permissions`, `runner default`) or command count. */
  readonly ruleLabel: string;
  /** Whether any problem in `problems` points at this step or a field inside it. */
  readonly hasProblems: boolean;
  /** Step ids in `depends_on` that do not match any addressable step in the draft (spec AC-04). */
  readonly missingDependsOn: readonly string[];
  /** Target step id in `on_failure.target` when it does not match any addressable step in the draft (spec AC-04). */
  readonly missingFailureTarget?: string;
}

export interface GraphNode {
  readonly id: string;
  /** Top-left corner. */
  readonly x: number;
  readonly y: number;
  /** What the run recorded of the step; undefined for a step that has not reported anything yet. */
  readonly step: StepView | undefined;
  readonly onFailure: StepFailureRoute | undefined;
  readonly dependsOn: readonly string[];
  readonly draft?: StepDraftMeta;
}

export interface GraphEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  /** `waits` is `depends_on`; `failure` is where a failure leads (`on_failure: retry_step`). */
  readonly kind: 'waits' | 'failure';
  /** For `waits`: the step it comes from completed. */
  readonly done: boolean;
  /** For `failure`: retries used and allowed. */
  readonly retries?: { readonly used: number; readonly max: number };
}

/** Which way the steps run: left to right, or top to bottom on a narrow screen (answer 5 of the sketches). */
export type Direction = 'LR' | 'TB';

export interface RunGraph {
  readonly direction: Direction;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  /** False for a run recorded without its structure: the steps are then a row in the order they ran, with no edges. */
  readonly structureKnown: boolean;
  readonly width: number;
  readonly height: number;
}

/** How many times a step's failure has sent the run back: its failed attempts, up to what the route allows. */
export function retriesUsed(step: StepView | undefined, route: StepFailureRoute): number {
  if (step === undefined) {
    return 0;
  }
  const failed = step.history.filter((attempt) => attempt.outcome === 'FAILED').length;
  return Math.min(failed, route.maxRetries);
}

/**
 * The graph of a run, laid out left to right, or top to bottom when asked. Deterministic: the same run in the same
 * direction always gives the same picture, so it does not jump between snapshots (C-03). The layout reads only the
 * `depends_on` edges; a failure route is drawn on top, because laying it out would turn the picture around every time
 * a step can be retried.
 */
export function buildGraph(run: RunSnapshot, direction: Direction = 'LR'): RunGraph {
  const across = direction === 'LR';
  const byId = new Map(run.steps.map((step) => [step.id, step]));
  const structure = run.structure;

  if (structure === undefined) {
    // A row of the steps in the order they ran, or a column on a narrow screen.
    const nodes = run.steps.map(
      (step, index): GraphNode => ({
        id: step.id,
        x: across ? index * (NODE_WIDTH + GAP_X) : 0,
        y: across ? 0 : index * (NODE_HEIGHT + GAP_Y),
        step,
        onFailure: undefined,
        dependsOn: [],
      }),
    );
    const count = nodes.length;
    return {
      direction,
      nodes,
      edges: [],
      structureKnown: false,
      width: count === 0 ? 0 : across ? count * (NODE_WIDTH + GAP_X) - GAP_X : NODE_WIDTH,
      height: count === 0 ? 0 : across ? NODE_HEIGHT : count * (NODE_HEIGHT + GAP_Y) - GAP_Y,
    };
  }

  const graph = new Graph();
  graph.setGraph(
    across
      ? { rankdir: 'LR', nodesep: GAP_Y, ranksep: GAP_X, marginx: 0, marginy: 0 }
      : { rankdir: 'TB', nodesep: GAP_X, ranksep: GAP_Y, marginx: 0, marginy: 0 },
  );
  graph.setDefaultEdgeLabel(() => ({}));
  for (const step of structure) {
    graph.setNode(step.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const step of structure) {
    for (const from of step.dependsOn) {
      graph.setEdge(from, step.id);
    }
  }
  layout(graph);

  let width = 0;
  let height = 0;
  const nodes = structure.map((plan): GraphNode => {
    const placed = graph.node(plan.id);
    const x = Math.round((placed?.x ?? 0) - NODE_WIDTH / 2);
    const y = Math.round((placed?.y ?? 0) - NODE_HEIGHT / 2);
    width = Math.max(width, x + NODE_WIDTH);
    height = Math.max(height, y + NODE_HEIGHT);
    return {
      id: plan.id,
      x,
      y,
      step: byId.get(plan.id),
      onFailure: plan.onFailure,
      dependsOn: plan.dependsOn,
    };
  });

  const edges: GraphEdge[] = [];
  for (const plan of structure) {
    for (const from of plan.dependsOn) {
      edges.push({
        id: `waits:${from}->${plan.id}`,
        source: from,
        target: plan.id,
        kind: 'waits',
        done: byId.get(from)?.status === 'COMPLETED',
      });
    }
    const route = plan.onFailure;
    if (route?.action === 'retry_step' && route.target !== undefined) {
      edges.push({
        id: `failure:${plan.id}->${route.target}`,
        source: plan.id,
        target: route.target,
        kind: 'failure',
        done: false,
        retries: { used: retriesUsed(byId.get(plan.id), route), max: route.maxRetries },
      });
    }
  }
  return { direction, nodes, edges, structureKnown: true, width, height };
}

/** The steps that send the run back to this one when they fail. */
export function retriedBy(graph: RunGraph, id: string): readonly string[] {
  return graph.edges
    .filter((edge) => edge.kind === 'failure' && edge.target === id)
    .map((edge) => edge.source);
}

const isObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const valueAt = (value: JsonValue | undefined, key: string): JsonValue | undefined =>
  isObject(value) && Object.hasOwn(value, key) ? value[key] : undefined;

const objectAt = (value: JsonValue | undefined, key: string): JsonObject | undefined => {
  const found = valueAt(value, key);
  return isObject(found) ? found : undefined;
};

const listAt = (value: JsonValue | undefined, key: string): readonly JsonValue[] | undefined => {
  const found = valueAt(value, key);
  return Array.isArray(found) ? found : undefined;
};

const stringAt = (value: JsonValue | undefined, key: string): string | undefined => {
  const found = valueAt(value, key);
  return typeof found === 'string' ? found : undefined;
};

const strings = (value: readonly JsonValue[] | undefined): readonly string[] =>
  (value ?? []).filter((v): v is string => typeof v === 'string');

const runnerNames = (value: JsonValue | undefined): readonly string[] => {
  if (typeof value === 'string') {
    return value === '' ? [] : [value];
  }
  return Array.isArray(value) ? strings(value).filter((v) => v !== '') : [];
};

const uniqueStrings = (items: readonly string[]): readonly string[] => [...new Set(items)];

function summarizeStep(
  raw: JsonValue | undefined,
  roles: JsonObject | undefined,
): { readonly runnerLabel: string; readonly ruleLabel: string } {
  if (!isObject(raw)) {
    return { runnerLabel: '', ruleLabel: '' };
  }
  const words = messages.graph.card;
  const roleName = stringAt(raw, 'role') ?? '';
  const roleObj = roleName !== '' ? objectAt(roles, roleName) : undefined;
  const ownRunners = runnerNames(valueAt(raw, 'runner'));
  const effectiveRunners = ownRunners.length > 0 ? ownRunners : runnerNames(valueAt(roleObj, 'runner'));
  const consensusWith = strings(listAt(raw, 'consensus_with')).filter((r) => r !== '');
  const decisionType = stringAt(raw, 'decision_type');
  const isDebate = consensusWith.length > 0 || decisionType === 'consensus';

  const runnerLabel = isDebate
    ? words.debate([...(roleName !== '' ? [roleName] : []), ...consensusWith])
    : ownRunners.length > 0
      ? ownRunners.join(', ')
      : roleName !== ''
        ? words.role(roleName)
        : '';

  const rawCommands = listAt(raw, 'commands');
  const rawPermissions = valueAt(raw, 'permissions');
  const isShell =
    effectiveRunners.includes('shell') ||
    (rawCommands !== undefined && rawPermissions === undefined && effectiveRunners.length === 0);
  if (isShell) {
    return {
      runnerLabel,
      ruleLabel: words.commands(strings(rawCommands).length),
    };
  }
  const preset = presetOf(rawPermissions);
  switch (preset) {
    case 'none':
      return { runnerLabel, ruleLabel: words.runnerDefault };
    case 'read_only':
      return { runnerLabel, ruleLabel: words.readOnly };
    case 'folders':
      return { runnerLabel, ruleLabel: words.writes(writeGlobs(rawPermissions)) };
    case 'full':
      return {
        runnerLabel,
        ruleLabel: isOldStyle(rawPermissions) ? words.oldStyleFull : words.fullAccess,
      };
    case 'custom':
      return { runnerLabel, ruleLabel: words.customPermissions };
  }
}

function stepHasProblems(problems: readonly WorkflowProblem[], index: number): boolean {
  const prefix = `$.steps[${index}]`;
  return problems.some(
    (p) =>
      p.path !== undefined &&
      (p.path === prefix || p.path.startsWith(`${prefix}.`) || p.path.startsWith(`${prefix}[`)),
  );
}

/**
 * Builds a deterministic `RunGraph` from a workflow draft (`value: JsonObject`) and its `problems`, using `@dagrejs/dagre`
 * in the given `direction` ('LR' | 'TB'). Only edges between addressable steps in the draft are passed to `dagre` and
 * emitted as `GraphEdge`s; dangling references in `depends_on` or `on_failure.target` are recorded in
 * `draft.missingDependsOn` and `draft.missingFailureTarget`. All lookups use `Map`/`Set` (safe for any step id).
 */
export function buildWorkflowGraph(
  value: JsonObject,
  problems: readonly WorkflowProblem[],
  direction: Direction = 'LR',
): RunGraph {
  const across = direction === 'LR';
  const rawSteps = listAt(value, 'steps') ?? [];
  const roles = objectAt(value, 'roles');

  const idCounts = new Map<string, number>();
  for (const raw of rawSteps) {
    const id = stringAt(raw, 'id') ?? '';
    if (isObject(raw) && id !== '') {
      idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
    }
  }
  const addressableIds = new Set<string>();
  for (const [id, count] of idCounts) {
    if (count === 1) {
      addressableIds.add(id);
    }
  }

  interface PreparedStep {
    readonly nodeId: string;
    readonly validDependsOn: readonly string[];
    readonly onFailure: StepFailureRoute | undefined;
    readonly draft: StepDraftMeta;
  }

  const prepared: PreparedStep[] = rawSteps.map((raw, index): PreparedStep => {
    const rawId = stringAt(raw, 'id') ?? '';
    const addressable = isObject(raw) && rawId !== '' && addressableIds.has(rawId);
    const nodeId = addressable ? rawId : unaddressableNodeId(index);
    const label = rawId !== '' ? rawId : messages.graph.card.noId;
    const { runnerLabel, ruleLabel } = summarizeStep(raw, roles);

    const rawDeps = uniqueStrings(strings(listAt(raw, 'depends_on')).filter((d) => d !== ''));
    const validDependsOn = addressable
      ? rawDeps.filter((dep) => dep !== nodeId && addressableIds.has(dep))
      : [];
    const missingDependsOn = rawDeps.filter((dep) => dep === nodeId || !addressableIds.has(dep));

    const rawFailure = objectAt(raw, 'on_failure');
    const action = stringAt(rawFailure, 'action') ?? '';
    const rawTarget = stringAt(rawFailure, 'target');
    const target = rawTarget !== undefined && rawTarget !== '' ? rawTarget : undefined;
    const rawMax = valueAt(rawFailure, 'max_retries');
    const maxRetries = typeof rawMax === 'number' && Number.isInteger(rawMax) && rawMax >= 0 ? rawMax : 0;
    const onFailure: StepFailureRoute | undefined =
      action === '' ? undefined : { action, target, maxRetries };
    const missingFailureTarget =
      action === 'retry_step' && target !== undefined && !addressableIds.has(target) ? target : undefined;

    return {
      nodeId,
      validDependsOn,
      onFailure,
      draft: {
        index,
        label,
        addressable,
        runnerLabel,
        ruleLabel,
        hasProblems: stepHasProblems(problems, index),
        missingDependsOn,
        ...(missingFailureTarget === undefined ? {} : { missingFailureTarget }),
      },
    };
  });

  if (prepared.length === 0) {
    return { direction, nodes: [], edges: [], structureKnown: true, width: 0, height: 0 };
  }

  const dagreId = (id: string): string => `n:${id}`;
  const graph = new Graph();
  graph.setGraph(
    across
      ? { rankdir: 'LR', nodesep: GAP_Y, ranksep: GAP_X, marginx: 0, marginy: 0 }
      : { rankdir: 'TB', nodesep: GAP_X, ranksep: GAP_Y, marginx: 0, marginy: 0 },
  );
  graph.setDefaultEdgeLabel(() => ({}));
  for (const item of prepared) {
    graph.setNode(dagreId(item.nodeId), { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const item of prepared) {
    for (const from of item.validDependsOn) {
      graph.setEdge(dagreId(from), dagreId(item.nodeId));
    }
  }
  layout(graph);

  let width = 0;
  let height = 0;
  const nodes = prepared.map((item): GraphNode => {
    const placed = graph.node(dagreId(item.nodeId));
    const px = placed !== undefined && Number.isFinite(placed.x) ? placed.x : NODE_WIDTH / 2;
    const py = placed !== undefined && Number.isFinite(placed.y) ? placed.y : NODE_HEIGHT / 2;
    const x = Math.round(px - NODE_WIDTH / 2);
    const y = Math.round(py - NODE_HEIGHT / 2);
    width = Math.max(width, x + NODE_WIDTH);
    height = Math.max(height, y + NODE_HEIGHT);
    return {
      id: item.nodeId,
      x,
      y,
      step: undefined,
      onFailure: item.onFailure,
      dependsOn: item.validDependsOn,
      draft: item.draft,
    };
  });

  const edges: GraphEdge[] = [];
  for (const item of prepared) {
    for (const from of item.validDependsOn) {
      edges.push({
        id: `waits:${from}->${item.nodeId}`,
        source: from,
        target: item.nodeId,
        kind: 'waits',
        done: false,
      });
    }
    const route = item.onFailure;
    if (
      item.draft.addressable &&
      route?.action === 'retry_step' &&
      route.target !== undefined &&
      addressableIds.has(route.target)
    ) {
      edges.push({
        id: `failure:${item.nodeId}->${route.target}`,
        source: item.nodeId,
        target: route.target,
        kind: 'failure',
        done: false,
        retries: { used: 0, max: route.maxRetries },
      });
    }
  }

  return { direction, nodes, edges, structureKnown: true, width, height };
}

/** Narrow an unknown string (such as a drag-and-drop transfer payload) to a known `BrickKind`. */
export function isBrickKind(value: string): value is BrickKind {
  return (
    (STEP_BRICK_KINDS as readonly string[]).includes(value) ||
    (FAILURE_BRICK_KINDS as readonly string[]).includes(value)
  );
}

export function isStepBrickKind(value: BrickKind): value is StepBrickKind {
  return (STEP_BRICK_KINDS as readonly string[]).includes(value);
}

function findAddressableStep(
  value: JsonObject,
  stepId: string,
): { readonly index: number; readonly step: JsonObject } | undefined {
  if (stepId === '') {
    return undefined;
  }
  const rawSteps = listAt(value, 'steps') ?? [];
  let foundIndex = -1;
  let foundStep: JsonObject | undefined;
  let count = 0;
  for (let i = 0; i < rawSteps.length; i += 1) {
    const raw = rawSteps[i];
    if (isObject(raw) && stringAt(raw, 'id') === stepId) {
      count += 1;
      foundIndex = i;
      foundStep = raw;
    }
  }
  return count === 1 && foundStep !== undefined ? { index: foundIndex, step: foundStep } : undefined;
}

/**
 * The `addStep` edit a step brick produces, and the new step's generated id. `afterId` is included as `after` only when
 * it names an addressable step in `value.steps` (spec AC-05).
 */
export function stepBrickEdit(
  kind: StepBrickKind,
  value: JsonObject,
  catalog: EditorCatalog,
  afterId: string | undefined,
): { readonly id: string; readonly edit: WorkflowEdit } {
  const rawSteps = listAt(value, 'steps') ?? [];
  const stepIds = rawSteps.map((s) => stringAt(s, 'id')).filter((s): s is string => s !== undefined);
  const id = nextStepId(stepIds);
  const after =
    afterId !== undefined && findAddressableStep(value, afterId) !== undefined ? afterId : undefined;

  const nonShell = catalog.runners.filter((r) => r.name !== 'shell');
  let step: JsonObject;
  switch (kind) {
    case 'agent': {
      const entry =
        nonShell.find((r) => r.permissions !== undefined && r.permissions.edit.mode !== 'unsupported') ??
        nonShell[0];
      step = entry === undefined ? { id } : { id, runner: entry.name };
      break;
    }
    case 'api': {
      const entry =
        nonShell.find(
          (r) =>
            r.permissions !== undefined &&
            r.permissions.read.mode !== 'unsupported' &&
            r.permissions.edit.mode === 'unsupported',
        ) ?? nonShell[0];
      step = entry === undefined ? { id } : { id, runner: entry.name };
      break;
    }
    case 'shell':
      step = { id, runner: 'shell' };
      break;
    case 'debate': {
      const roles = Object.keys(objectAt(value, 'roles') ?? {});
      const firstRole = roles[0];
      const secondRole = roles[1];
      step = {
        id,
        ...(firstRole !== undefined ? { role: firstRole } : {}),
        ...(secondRole !== undefined ? { consensus_with: [secondRole] } : {}),
        decision_type: 'consensus',
      };
      break;
    }
  }

  return {
    id,
    edit: {
      op: 'addStep',
      step,
      ...(after === undefined ? {} : { after }),
    },
  };
}

/**
 * The `set` edit on `['steps', stepIndex, 'on_failure']` a failure brick produces for the addressable step `stepId`
 * in `value`, or `undefined` if `stepId` is not an addressable step (spec AC-05, AC-10).
 */
export function failureBrickEdit(
  value: JsonObject,
  stepId: string,
  kind: FailureBrickKind,
): WorkflowEdit | undefined {
  const found = findAddressableStep(value, stepId);
  if (found === undefined) {
    return undefined;
  }
  const path = ['steps', found.index, 'on_failure'] as const;
  if (kind === 'retry_step') {
    const existing = objectAt(found.step, 'on_failure');
    const existingTarget = stringAt(existing, 'target');
    const target = existingTarget !== undefined && existingTarget !== '' ? existingTarget : stepId;
    const rawMax = valueAt(existing, 'max_retries');
    return {
      op: 'set',
      path,
      value: { action: 'retry_step', target, max_retries: rawMax ?? 3 },
    };
  }
  return {
    op: 'set',
    path,
    value: { action: kind },
  };
}

/** Whether connecting `sourceHandle` on `source` to `targetHandle` on `target` is a valid handle pair (spec AC-07). */
export function isValidGraphConnection(
  source: string,
  target: string,
  sourceHandle: string | null | undefined,
  targetHandle: string | null | undefined,
): boolean {
  if (source === '' || target === '') {
    return false;
  }
  const isWaitsOut = sourceHandle === 'out' || sourceHandle === null || sourceHandle === undefined;
  const isWaitsIn = targetHandle === 'in' || targetHandle === null || targetHandle === undefined;
  if (isWaitsOut && isWaitsIn) {
    return source !== target;
  }
  return sourceHandle === 'fail-out' && targetHandle === 'fail-in';
}

/**
 * The edit produced when a person connects `source` (`sourceHandle`) to `target` (`targetHandle`) on the canvas
 * (spec AC-07, AC-10), or `undefined` when the handles do not match, `source === target` for `depends_on`, the
 * dependency already exists, or either step is not addressable in `value`.
 */
export function connectStepsEdit(
  value: JsonObject,
  source: string,
  target: string,
  sourceHandle: string | null | undefined,
  targetHandle: string | null | undefined,
): WorkflowEdit | undefined {
  if (!isValidGraphConnection(source, target, sourceHandle, targetHandle)) {
    return undefined;
  }
  const sourceStep = findAddressableStep(value, source);
  const targetStep = findAddressableStep(value, target);
  if (sourceStep === undefined || targetStep === undefined) {
    return undefined;
  }
  if (sourceHandle === 'fail-out' && targetHandle === 'fail-in') {
    const existing = objectAt(sourceStep.step, 'on_failure');
    const rawMax = valueAt(existing, 'max_retries');
    return {
      op: 'set',
      path: ['steps', sourceStep.index, 'on_failure'],
      value: { action: 'retry_step', target, max_retries: rawMax ?? 3 },
    };
  }
  const rawDeps = listAt(targetStep.step, 'depends_on') ?? [];
  if (strings(rawDeps).includes(source)) {
    return undefined;
  }
  return {
    op: 'set',
    path: ['steps', targetStep.index, 'depends_on'],
    value: [...rawDeps, source],
  };
}

/**
 * The edit produced when a person disconnects `fromId` from addressable step `stepId`'s `depends_on` (spec AC-08,
 * AC-10): `set` with the remaining ids, or `remove` when none remain; `undefined` when `stepId` is not addressable or
 * `fromId` is not in `depends_on`.
 */
export function disconnectDependsOnEdit(
  value: JsonObject,
  stepId: string,
  fromId: string,
): WorkflowEdit | undefined {
  const found = findAddressableStep(value, stepId);
  if (found === undefined) {
    return undefined;
  }
  const rawDeps = listAt(found.step, 'depends_on') ?? [];
  if (!strings(rawDeps).includes(fromId)) {
    return undefined;
  }
  const next = rawDeps.filter((id) => id !== fromId);
  const path = ['steps', found.index, 'depends_on'] as const;
  return next.length === 0 ? { op: 'remove', path } : { op: 'set', path, value: next };
}

/**
 * The edit produced when a person clears `on_failure` on addressable step `stepId` (spec AC-08, AC-10), or `undefined`
 * when `stepId` is not addressable or has no `on_failure`.
 */
export function clearFailureEdit(value: JsonObject, stepId: string): WorkflowEdit | undefined {
  const found = findAddressableStep(value, stepId);
  if (found === undefined || valueAt(found.step, 'on_failure') === undefined) {
    return undefined;
  }
  return { op: 'remove', path: ['steps', found.index, 'on_failure'] };
}
