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
import {
  type DragEvent,
  createElement as h,
  type KeyboardEvent,
  type ReactElement,
  useMemo,
  useRef,
} from 'react';
import { between, formatDuration } from '../format.js';
import {
  type BrickKind,
  type Direction,
  type RunGraph as Graph,
  type GraphNode,
  isBrickKind,
  isValidGraphConnection,
  NODE_HEIGHT,
  NODE_WIDTH,
} from '../graph-model.js';
import { messages } from '../messages.js';
import { isActive, stepLook } from '../status.js';
import { useStale } from './stale.js';

export interface RunGraphEditProps {
  /** Called when the person connects two handles on the canvas. */
  readonly onConnect: (
    source: string,
    target: string,
    sourceHandle: string | null | undefined,
    targetHandle: string | null | undefined,
  ) => void;
  /** Called when a brick is dropped onto the canvas (`targetStepId` is undefined) or onto an addressable step card. */
  readonly onDropBrick: (kind: BrickKind, targetStepId: string | undefined) => void;
  /** Called when the person presses Delete or Backspace on a focused addressable step node. */
  readonly onDeleteStep: (stepId: string) => void;
}

export interface StepCardData extends Record<string, unknown> {
  readonly node: GraphNode;
  readonly selected: boolean;
  readonly now: number;
  /** The steps that send the run back here when they fail. */
  readonly retriedBy: readonly string[];
  /** Which way the graph runs: where a card's edges meet it. */
  readonly direction?: Direction;
  readonly edit?: RunGraphEditProps;
}

/** What a step's card says under its state: the runner, the try, or that it will run again. */
export function cardLines(data: StepCardData): {
  readonly runner: string;
  readonly note: string | undefined;
} {
  const { draft, step } = data.node;
  if (draft !== undefined) {
    const parts: string[] = [];
    if (draft.missingDependsOn.length > 0) {
      parts.push(messages.graph.card.missingDep(draft.missingDependsOn));
    }
    if (draft.missingFailureTarget !== undefined) {
      parts.push(messages.graph.card.missingRetry(draft.missingFailureTarget));
    }
    if (data.retriedBy.length > 0) {
      parts.push(messages.graph.card.retriedBy(data.retriedBy));
    }
    return {
      runner: draft.runnerLabel,
      note: parts.length === 0 ? undefined : parts.join(' · '),
    };
  }
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

/** One step on the canvas: its name, its runner, its state as a symbol and a word (or its rule in edit mode), and its time or note. */
export function StepCard(props: { readonly data: StepCardData }): ReactElement {
  const { data } = props;
  const { draft } = data.node;
  const { runner, note } = cardLines(data);
  const stale = useStale();
  if (draft !== undefined) {
    const tone = draft.hasProblems ? 'fail has-problem' : 'muted';
    const ruleText = draft.hasProblems
      ? draft.ruleLabel === ''
        ? messages.graph.card.hasProblems
        : `${draft.ruleLabel} · ${messages.graph.card.hasProblems}`
      : draft.ruleLabel;
    const hasMissing = draft.missingDependsOn.length > 0 || draft.missingFailureTarget !== undefined;
    return h(
      'div',
      { className: `step-card ${tone}${data.selected ? ' selected' : ''}` },
      h('span', { className: 'name', title: draft.label }, draft.label),
      h('span', { className: 'sub' }, runner === '' ? ' ' : runner),
      h(
        'span',
        { className: 'line', title: ruleText },
        draft.hasProblems ? h('span', { className: 'fail', 'aria-hidden': true }, '✕ ') : null,
        ruleText === '' ? ' ' : ruleText,
      ),
      h('span', { className: hasMissing ? 'sub fail' : 'sub', title: note }, note ?? ' '),
    );
  }
  const look = stepLook(data.node.step?.status ?? 'PENDING');
  const time = elapsed(data);
  const state = `${look.word}${time === undefined ? '' : `, ${time}`}`;
  // While the stream is down the card says so on its last line, which has room on a phone where the state line has not.
  const last = stale
    ? note === undefined
      ? messages.state.lastKnown
      : `${messages.state.lastKnown} · ${note}`
    : note;
  return h(
    'div',
    { className: `step-card ${look.tone}${data.selected ? ' selected' : ''}` },
    h('span', { className: 'name', title: data.node.id }, data.node.id),
    h('span', { className: 'sub' }, runner === '' ? ' ' : runner),
    h(
      'span',
      { className: 'line', title: state },
      h('span', { className: look.tone, 'aria-hidden': true }, look.symbol),
      ` ${state}`,
    ),
    h('span', { className: stale ? 'sub last-known' : 'sub', title: last }, last ?? ' '),
  );
}

type StepNode = Node<StepCardData, 'step'>;

/**
 * Where a card's edges meet it. Left to right, "waits for" enters on the left and leaves on the right, and the failure
 * route runs under the cards; top to bottom, it enters at the top and leaves at the bottom, and the failure route runs
 * beside them.
 */
export function handlesOf(direction: Direction): {
  readonly in: Position;
  readonly out: Position;
  readonly failure: Position;
} {
  return direction === 'LR'
    ? { in: Position.Left, out: Position.Right, failure: Position.Bottom }
    : { in: Position.Top, out: Position.Bottom, failure: Position.Right };
}

function StepNodeView(props: NodeProps<StepNode>): ReactElement {
  const at = handlesOf(props.data.direction ?? 'LR');
  const edit = props.data.edit;
  const connectable = edit !== undefined && props.data.node.draft?.addressable === true;
  return h(
    'div',
    connectable
      ? {
          onDragOver: (event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            event.stopPropagation();
          },
          onDrop: (event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            event.stopPropagation();
            const raw = event.dataTransfer.getData('text/plain');
            if (isBrickKind(raw)) {
              edit.onDropBrick(raw, props.data.node.id);
            }
          },
          onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key === 'Delete' || event.key === 'Backspace') {
              event.preventDefault();
              event.stopPropagation();
              edit.onDeleteStep(props.data.node.id);
            }
          },
        }
      : null,
    h(Handle, { type: 'target', position: at.in, id: 'in', isConnectable: connectable }),
    h(StepCard, { data: props.data }),
    h(Handle, { type: 'source', position: at.out, id: 'out', isConnectable: connectable }),
    h(Handle, { type: 'source', position: at.failure, id: 'fail-out', isConnectable: connectable }),
    h(Handle, { type: 'target', position: at.failure, id: 'fail-in', isConnectable: connectable }),
  );
}

const nodeTypes = { step: StepNodeView };

/** The nodes and edges React Flow draws for a laid-out run or workflow draft. Pure, so the picture is tested without a canvas. */
export function flowOf(
  graph: Graph,
  selected: string | undefined,
  now: number,
  edit?: RunGraphEditProps,
): { readonly nodes: StepNode[]; readonly edges: BuiltInEdge[] } {
  const isDraft = graph.nodes.some((n) => n.draft !== undefined);
  const nodes = graph.nodes.map((node): StepNode => {
    const look = stepLook(node.step?.status ?? 'PENDING');
    const retriedBy = graph.edges
      .filter((edge) => edge.kind === 'failure' && edge.target === node.id)
      .map((edge) => edge.source);
    const draft = node.draft;
    const connectable = edit !== undefined && draft?.addressable === true;
    return {
      id: node.id,
      type: 'step',
      position: { x: node.x, y: node.y },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      data: {
        node,
        selected: node.id === selected,
        now,
        retriedBy,
        direction: graph.direction,
        ...(edit === undefined ? {} : { edit }),
      },
      selected: node.id === selected,
      draggable: false,
      connectable,
      ariaLabel:
        draft !== undefined
          ? messages.graph.card.ariaStep(draft.label, draft.runnerLabel, draft.ruleLabel, draft.hasProblems)
          : `${node.id}, ${look.word}. Show details.`,
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
        label: isDraft
          ? messages.graph.card.edgeRetry(edge.source, edge.target, max)
          : `if ${edge.source} fails: run ${edge.target} again, ${used} of ${max} used`,
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
  readonly edit?: RunGraphEditProps;
}

/**
 * The run or workflow draft as a graph, left to right (top to bottom on a narrow screen). Pan and zoom by dragging and with the controls of the canvas, never by the page's
 * own scroll. Every step can be reached with Tab and opened with Enter; the step list beside it does the same.
 */
export function RunGraph(props: RunGraphProps): ReactElement {
  const { graph, selected, now, onSelect, edit } = props;
  const { nodes, edges } = useMemo(() => flowOf(graph, selected, now, edit), [graph, selected, now, edit]);
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
    deleteKeyCode: null,
    nodesDraggable: false,
    nodesConnectable: edit !== undefined,
    nodesFocusable: true,
    edgesFocusable: false,
    elementsSelectable: true,
    zoomOnScroll: false,
    preventScrolling: false,
    ...(edit === undefined
      ? {}
      : {
          isValidConnection: (connection) =>
            isValidGraphConnection(
              connection.source,
              connection.target,
              connection.sourceHandle,
              connection.targetHandle,
            ),
          onConnect: (connection) =>
            edit.onConnect(
              connection.source,
              connection.target,
              connection.sourceHandle,
              connection.targetHandle,
            ),
        }),
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
      'aria-label': edit === undefined ? messages.run.graphLabel : messages.graph.canvasLabel,
      ...(edit === undefined
        ? {}
        : {
            onDragOver: (event: DragEvent<HTMLDivElement>) => {
              event.preventDefault();
            },
            onDrop: (event: DragEvent<HTMLDivElement>) => {
              event.preventDefault();
              const raw = event.dataTransfer.getData('text/plain');
              if (isBrickKind(raw)) {
                edit.onDropBrick(raw, undefined);
              }
            },
            onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
              if (event.key !== 'Delete' && event.key !== 'Backspace') {
                return;
              }
              const target = event.target instanceof Element ? event.target.closest('[data-id]') : null;
              const id = target?.getAttribute('data-id') ?? undefined;
              const node = id === undefined ? undefined : graph.nodes.find((n) => n.id === id);
              if (node?.draft?.addressable) {
                event.preventDefault();
                edit.onDeleteStep(node.id);
              }
            },
          }),
    },
    h(ReactFlow<StepNode, BuiltInEdge>, flow),
  );
}
