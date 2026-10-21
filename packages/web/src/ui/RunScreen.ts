import type { RunSnapshot } from '@indaba/core';
import {
  createElement as h,
  type MouseEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { ApiFailure, type Client, type Failure, type StreamState } from '../client.js';
import { costTip } from '../cost.js';
import { between, type Clock, formatDuration, formatRunCost, formatWhen, shortId } from '../format.js';
import { buildGraph, type GraphNode, retriedBy } from '../graph-model.js';
import { messages } from '../messages.js';
import { isActive, runLook } from '../status.js';
import { CostTable } from './CostTable.js';
import { StateChip } from './parts.js';
import { RunGraph } from './RunGraph.js';
import { hrefOf, isPlainClick, type Navigate } from './router.js';
import { StepPanel } from './StepPanel.js';
import { StepsGrid } from './StepsGrid.js';

export interface RunScreenProps {
  readonly client: Client;
  readonly clock: Clock;
  /** The time used for running durations, ticking while a run is live. */
  readonly now: number;
  readonly runId: string;
  readonly step: string | undefined;
  readonly navigate: Navigate;
  readonly onFatal: (failure: Failure) => void;
  readonly onLive: (state: StreamState) => void;
}

/** The step to open when none is named: the one running, else the last that failed or escalated, else the first. */
export function defaultStep(nodes: readonly GraphNode[]): string | undefined {
  const active = nodes.find((node) => node.step !== undefined && isActive(node.step.status));
  if (active !== undefined) {
    return active.id;
  }
  const troubled = [...nodes]
    .reverse()
    .find((n) => n.step?.status === 'FAILED' || n.step?.status === 'ESCALATED');
  return troubled?.id ?? nodes[0]?.id;
}

function CostPanel(props: { readonly run: RunSnapshot; readonly nodes: readonly GraphNode[] }): ReactElement {
  const { run, nodes } = props;
  const { cost } = run;
  return h(
    'section',
    { className: 'panel', 'aria-labelledby': 'cost-title' },
    h('h3', { id: 'cost-title' }, messages.run.costTitle),
    h(
      'dl',
      { className: 'facts' },
      h('dt', null, run.status === 'running' ? messages.run.costSoFar : messages.run.costTotal),
      h('dd', null, h('b', { title: costTip(cost) }, formatRunCost(cost))),
      h('dt', null, messages.run.modelCalls),
      h(
        'dd',
        null,
        String(cost.calls),
        cost.unknown > 0
          ? h('span', { className: 'muted' }, ` (${messages.run.callsWithNoPrice(cost.unknown)})`)
          : null,
      ),
      h('dt', null, messages.run.budget),
      h('dd', null, messages.run.noLimit),
    ),
    h(CostTable, { nodes }),
    h('p', { className: 'muted' }, messages.run.costNote),
  );
}

/** One run, live: its graph, the selected step, the step list and the cost. Reads only; starts and stops nothing. */
export function RunScreen(props: RunScreenProps): ReactElement {
  const { client, clock, now, runId, step, navigate, onFatal, onLive } = props;
  const [run, setRun] = useState<RunSnapshot | undefined>(undefined);
  const [missing, setMissing] = useState(false);
  const [stream, setStream] = useState<StreamState>('connecting');

  useEffect(() => {
    let current = true;
    setRun(undefined);
    setMissing(false);
    client.run(runId).then(
      (snapshot) => {
        if (current) {
          setRun(snapshot);
        }
      },
      (error: unknown) => {
        if (!current || !(error instanceof ApiFailure)) {
          return;
        }
        if (error.failure.kind === 'not_found') {
          setMissing(true);
        } else {
          onFatal(error.failure);
        }
      },
    );
    return () => {
      current = false;
    };
  }, [client, runId, onFatal]);

  useEffect(() => {
    const controller = new AbortController();
    void client.followRun(
      runId,
      {
        onEvent: setRun,
        onState: (state) => {
          setStream(state);
          onLive(state);
        },
        onFailure: (failure) => {
          if (failure.kind === 'not_found') {
            setMissing(true);
          } else {
            onFatal(failure);
          }
        },
      },
      controller.signal,
    );
    return () => controller.abort();
  }, [client, runId, onFatal, onLive]);

  const graph = useMemo(() => (run === undefined ? undefined : buildGraph(run)), [run]);
  const selected = step ?? (graph === undefined ? undefined : defaultStep(graph.nodes));
  const select = useCallback(
    (stepId: string) => navigate({ name: 'run', runId, step: stepId }, { replace: true }),
    [navigate, runId],
  );
  const back = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (isPlainClick(event)) {
      event.preventDefault();
      navigate({ name: 'runs' });
    }
  };
  const backLink = h(
    'p',
    { className: 'back' },
    h('a', { href: hrefOf({ name: 'runs' }), onClick: back }, `← ${messages.run.back}`),
  );

  if (missing) {
    return h(
      'div',
      null,
      backLink,
      h(
        'section',
        { className: 'panel', role: 'alert' },
        h('h2', null, messages.run.notFoundTitle),
        h('p', null, messages.run.notFoundBody),
      ),
    );
  }
  if (run === undefined || graph === undefined) {
    return h('div', null, backLink);
  }

  const look = runLook(run.status);
  const ms = between(run.startedAt, run.endedAt ?? new Date(now).toISOString());
  const elapsed =
    ms === undefined
      ? ''
      : run.endedAt === undefined
        ? messages.run.runningFor(formatDuration(ms))
        : messages.run.tookTotal(formatDuration(ms));
  const node = graph.nodes.find((n) => n.id === selected);
  const stale = stream === 'reconnecting' || stream === 'unavailable';

  return h(
    'div',
    { className: stale ? 'stale' : undefined },
    backLink,
    h('h2', { id: 'page-title' }, run.workflow ?? messages.runs.unnamed, h(StateChip, { look })),
    h(
      'p',
      { className: 'muted' },
      messages.run.meta(formatWhen(run.startedAt, clock), elapsed, shortId(runId)),
    ),
    stream === 'reconnecting' ? h('p', { className: 'banner', role: 'status' }, messages.reconnecting) : null,
    h(
      'section',
      { className: 'panel graph', 'aria-labelledby': 'graph-title' },
      h(
        'h3',
        { id: 'graph-title' },
        messages.run.graphTitle,
        h('span', { className: 'muted' }, `(${messages.run.graphHint})`),
      ),
      graph.structureKnown ? null : h('p', { className: 'note' }, messages.run.structureUnknown),
      h(RunGraph, { graph, selected, now, onSelect: select }),
      h(
        'p',
        { className: 'legend' },
        h(
          'span',
          null,
          h('span', { className: 'swatch', 'aria-hidden': true }),
          messages.run.legendWaits,
          ' (',
          h('code', null, 'depends_on'),
          ')',
        ),
        h(
          'span',
          null,
          h('span', { className: 'swatch failure', 'aria-hidden': true }),
          messages.run.legendFailure,
          ' (',
          h('code', null, 'on_failure'),
          ')',
        ),
        h('span', null, messages.run.legendKeys),
      ),
    ),
    h(
      'div',
      { className: 'layout' },
      h(
        'div',
        null,
        node === undefined
          ? null
          : h(StepPanel, {
              node,
              structureKnown: graph.structureKnown,
              retriedBy: retriedBy(graph, node.id),
              now,
              loadDiscussion: () => client.discussion(runId, node.id),
            }),
        run.notes.length === 0
          ? null
          : h(
              'section',
              { className: 'panel' },
              h('h3', null, messages.run.notes),
              h('ul', null, ...run.notes.map((note, i) => h('li', { key: i }, note))),
            ),
      ),
      h(
        'aside',
        { 'aria-label': messages.run.stepsTitle },
        h(
          'section',
          { className: 'panel', 'aria-labelledby': 'steps-title' },
          h('h3', { id: 'steps-title' }, messages.run.stepsTitle),
          h(StepsGrid, { nodes: graph.nodes, selected, now, onSelect: select }),
        ),
        h(CostPanel, { run, nodes: graph.nodes }),
      ),
    ),
  );
}
