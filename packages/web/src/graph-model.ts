import { Graph, layout } from '@dagrejs/dagre';
import type { RunSnapshot, StepFailureRoute, StepView } from '@indaba/core';

/** The size of a step's card on the canvas, in pixels. */
export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 104;
const GAP_X = 64;
const GAP_Y = 36;

export interface GraphNode {
  readonly id: string;
  /** Top-left corner. */
  readonly x: number;
  readonly y: number;
  /** What the run recorded of the step; undefined for a step that has not reported anything yet. */
  readonly step: StepView | undefined;
  readonly onFailure: StepFailureRoute | undefined;
  readonly dependsOn: readonly string[];
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
