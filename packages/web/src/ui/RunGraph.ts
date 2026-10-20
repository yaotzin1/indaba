import {
  type BuiltInEdge,
  Handle,
  MarkerType,
  type Node,
  type NodeChange,
  type NodeProps,
  Position,
  ReactFlow,
  type ReactFlowProps,
} from '@xyflow/react';
import { createElement as h, type ReactElement, useMemo, useRef } from 'react';
import { between, formatDuration } from '../format.js';
import { type RunGraph as Graph, type GraphNode, NODE_HEIGHT, NODE_WIDTH } from '../graph-model.js';
import { messages } from '../messages.js';
import { isActive, stepLook } from '../status.js';

export interface StepCardData extends Record<string, unknown> {
  readonly node: GraphNode;
  readonly selected: boolean;
  readonly now: number;
  /** The steps that send the run back here when they fail. */
  readonly retriedBy: readonly string[];
}

/** What a step's card says under its state: the runner, the try, or that it will run again. */
export function cardLines(data: StepCardData): {
  readonly runner: string;
  readonly note: string | undefined;
} {
  const { step } = data.node;
  const runner = step?.runners.at(-1)?.name ?? '';
  const failedTries = step?.history.filter((attempt) => attempt.outcome === 'FAILED').length ?? 0;
  if (step !== undefined && step.attempts > 1) {
    return {
      runner,
      note: failedTries > 0 ? `try ${step.attempts}, ${failedTries} failed` : `try ${step.attempts}`,
    };
  }
  if (data.retriedBy.length > 0) {
    return { runner, note: `runs again if ${data.retriedBy.join(', ')} fails` };
  }
  return { runner, note: undefined };
}

function elapsed(data: StepCardData): string | undefined {
  const step = data.node.step;
  if (step?.startedAt === undefined) {
    return undefined;
  }
  return stepTime(step, data.now);
}

/**
 * How long the step's latest try took, or has been running: the earlier tries are in its history, and a time that
 * spanned them all would read as one slow try. Undefined for a step that is waiting, including one reset to run again.
 */
export function stepTime(
  step: {
    readonly startedAt: string | undefined;
    readonly endedAt: string | undefined;
    readonly status: string;
    readonly history?: readonly { readonly startedAt: string; readonly endedAt: string | undefined }[];
  },
  now: number,
): string | undefined {
  if (step.status === 'PENDING') {
    return undefined;
  }
  const latest = step.history?.at(-1);
  const start = latest?.startedAt ?? step.startedAt;
  const end =
    (latest === undefined ? step.endedAt : latest.endedAt) ??
    (isActive(step.status) ? new Date(now).toISOString() : undefined);
  const ms = between(start, end);
  return ms === undefined ? undefined : formatDuration(ms);
}

/** One step on the canvas: its name, its runner, its state as a symbol and a word, and its time. */
export function StepCard(props: { readonly data: StepCardData }): ReactElement {
  const { data } = props;
  const look = stepLook(data.node.step?.status ?? 'PENDING');
  const { runner, note } = cardLines(data);
  const time = elapsed(data);
  return h(
    'div',
    { className: `step-card ${look.tone}${data.selected ? ' selected' : ''}` },
    h('span', { className: 'name' }, data.node.id),
    h('span', { className: 'sub' }, runner === '' ? ' ' : runner),
    h(
      'span',
      { className: 'line' },
      h('span', { className: look.tone, 'aria-hidden': true }, look.symbol),
      ` ${look.word}${time === undefined ? '' : `, ${time}`}`,
    ),
    h('span', { className: 'sub' }, note ?? ' '),
  );
}

type StepNode = Node<StepCardData, 'step'>;

function StepNodeView(props: NodeProps<StepNode>): ReactElement {
  return h(
    'div',
    null,
    h(Handle, { type: 'target', position: Position.Left, id: 'in', isConnectable: false }),
    h(StepCard, { data: props.data }),
    h(Handle, { type: 'source', position: Position.Right, id: 'out', isConnectable: false }),
    h(Handle, { type: 'source', position: Position.Bottom, id: 'fail-out', isConnectable: false }),
    h(Handle, { type: 'target', position: Position.Bottom, id: 'fail-in', isConnectable: false }),
  );
}

const nodeTypes = { step: StepNodeView };

/** The nodes and edges React Flow draws for a laid-out run. Pure, so the picture is tested without a canvas. */
export function flowOf(
  graph: Graph,
  selected: string | undefined,
  now: number,
): { readonly nodes: StepNode[]; readonly edges: BuiltInEdge[] } {
  const nodes = graph.nodes.map((node): StepNode => {
    const look = stepLook(node.step?.status ?? 'PENDING');
    const retriedBy = graph.edges
      .filter((edge) => edge.kind === 'failure' && edge.target === node.id)
      .map((edge) => edge.source);
    return {
      id: node.id,
      type: 'step',
      position: { x: node.x, y: node.y },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      data: { node, selected: node.id === selected, now, retriedBy },
      selected: node.id === selected,
      draggable: false,
      connectable: false,
      ariaLabel: `${node.id}, ${look.word}. Show details.`,
    };
  });
  const edges = graph.edges.map((edge): BuiltInEdge => {
    if (edge.kind === 'failure') {
      const used = edge.retries?.used ?? 0;
      const max = edge.retries?.max ?? 0;
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: 'fail-out',
        targetHandle: 'fail-in',
        type: 'smoothstep',
        pathOptions: { offset: 34, borderRadius: 10 },
        className: 'failure',
        label: `if ${edge.source} fails: run ${edge.target} again, ${used} of ${max} used`,
        markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--fail)' },
        focusable: false,
        selectable: false,
      };
    }
    return {
      id: edge.id,
      type: 'default',
      source: edge.source,
      target: edge.target,
      sourceHandle: 'out',
      targetHandle: 'in',
      className: edge.done ? 'waits done' : 'waits',
      markerEnd: { type: MarkerType.ArrowClosed, color: edge.done ? 'var(--ok)' : 'var(--line-strong)' },
      focusable: false,
      selectable: false,
    };
  });
  return { nodes, edges };
}

/** The smallest zoom at which a card is still read without effort. */
export const READABLE_ZOOM = 0.8;

/**
 * The zoom to open a graph at: undefined when it fits its box at a readable zoom (then it is fitted), otherwise the
 * readable zoom, from the left edge, and the reader pans to the rest. A phone gets steps it can read, not a picture of
 * all of them it cannot.
 */
export function initialZoom(graphWidth: number, boxWidth: number): number | undefined {
  if (boxWidth <= 0 || graphWidth <= 0) {
    return undefined;
  }
  return (boxWidth - 32) / graphWidth >= READABLE_ZOOM ? undefined : READABLE_ZOOM;
}

/** The step a person chose in these canvas changes, if they chose one. */
export function selectionOf(changes: readonly NodeChange<StepNode>[]): string | undefined {
  for (const change of changes) {
    if (change.type === 'select' && change.selected) {
      return change.id;
    }
  }
  return undefined;
}

export interface RunGraphProps {
  readonly graph: Graph;
  readonly selected: string | undefined;
  readonly now: number;
  readonly onSelect: (stepId: string) => void;
}

/**
 * The run as a graph, left to right. Pan and zoom by dragging and with the controls of the canvas, never by the page's
 * own scroll. Every step can be reached with Tab and opened with Enter; the step list beside it does the same.
 */
export function RunGraph(props: RunGraphProps): ReactElement {
  const { graph, selected, now, onSelect } = props;
  const { nodes, edges } = useMemo(() => flowOf(graph, selected, now), [graph, selected, now]);
  const height = Math.max(200, graph.height + 120);
  const box = useRef<HTMLDivElement>(null);
  const flow: ReactFlowProps<StepNode, BuiltInEdge> = {
    nodes,
    edges,
    nodeTypes,
    onInit: (instance) => {
      const width = box.current?.clientWidth ?? 0;
      const zoom = initialZoom(graph.width, width);
      if (zoom === undefined) {
        void instance.fitView({ padding: 0.08, maxZoom: 1 });
      } else {
        void instance.setViewport({ x: 16, y: (height - graph.height * zoom) / 2 - 10, zoom });
      }
    },
    minZoom: 0.4,
    maxZoom: 1.5,
    nodesDraggable: false,
    nodesConnectable: false,
    nodesFocusable: true,
    edgesFocusable: false,
    elementsSelectable: true,
    zoomOnScroll: false,
    preventScrolling: false,
    // The graph is controlled: the address holds the selection. React Flow reports what the person did (a click, or Enter
    // on a focused step) as a change, and the selection comes back through `selected`; it is never read back from the
    // canvas, so the two cannot chase each other.
    onNodesChange: (changes) => {
      const chosen = selectionOf(changes);
      if (chosen !== undefined && chosen !== selected) {
        onSelect(chosen);
      }
    },
    ariaLabelConfig: { 'node.a11yDescription.default': messages.run.legendKeys },
  };
  return h(
    'div',
    {
      ref: box,
      className: 'graph-canvas',
      style: { height },
      role: 'group',
      'aria-label': messages.run.graphLabel,
    },
    h(ReactFlow<StepNode, BuiltInEdge>, flow),
  );
}
