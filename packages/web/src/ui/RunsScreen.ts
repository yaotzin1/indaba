import type { RunSummary } from '@indaba/core';
import { Gridwright, type GridwrightColumn, responsive } from 'apsw-gridwright/react';
import { createElement as h, type MouseEvent, type ReactElement, useEffect, useMemo, useState } from 'react';
import { ApiFailure, type Client, type Failure, type StreamState } from '../client.js';
import { type Clock, formatWhen, shortId } from '../format.js';
import { messages } from '../messages.js';
import { runLook } from '../status.js';
import { StateChip } from './parts.js';
import { hrefOf, isPlainClick, type Navigate } from './router.js';

export interface RunsScreenProps {
  readonly client: Client;
  readonly clock: Clock;
  readonly navigate: Navigate;
  readonly onFatal: (failure: Failure) => void;
  readonly onLive: (state: StreamState) => void;
}

function runColumns(clock: Clock, navigate: Navigate): GridwrightColumn<RunSummary>[] {
  const open = (runId: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (isPlainClick(event)) {
      event.preventDefault();
      navigate({ name: 'run', runId, step: undefined });
    }
  };
  return [
    {
      id: 'workflow',
      header: messages.runs.workflow,
      accessor: (run) => run.workflow ?? messages.runs.unnamed,
      cell: ({ row }) =>
        h(
          'a',
          {
            className: 'row-link',
            href: hrefOf({ name: 'run', runId: row.runId, step: undefined }),
            onClick: open(row.runId),
          },
          row.workflow ?? messages.runs.unnamed,
        ),
    },
    {
      id: 'status',
      header: messages.runs.state,
      cell: ({ row }) => h(StateChip, { look: runLook(row.status) }),
    },
    {
      id: 'startedAt',
      header: messages.runs.started,
      formatValue: (value) => formatWhen(typeof value === 'string' ? value : undefined, clock),
    },
    {
      id: 'runId',
      header: messages.runs.run,
      sortable: false,
      responsive: { hideBelow: 640 },
      cell: ({ row }) => h('code', { title: row.runId }, shortId(row.runId)),
    },
  ];
}

const RUNS_ADDONS = [responsive<RunSummary>({ stackBelow: 560 })];
const RUNS_QUERY = { sort: [{ columnId: 'startedAt', direction: 'desc' as const }] };

/** The runs on this machine, newest first, live: the server-wide stream says when one starts or ends. */
export function RunsScreen(props: RunsScreenProps): ReactElement {
  const { client, clock, navigate, onFatal, onLive } = props;
  const [runs, setRuns] = useState<readonly RunSummary[] | undefined>(undefined);
  useEffect(() => {
    let current = true;
    const load = (): void => {
      client.runs().then(
        (list) => {
          if (current) {
            setRuns(list);
          }
        },
        (error: unknown) => {
          if (current && error instanceof ApiFailure) {
            onFatal(error.failure);
          }
        },
      );
    };
    load();
    // A run that starts or ends anywhere reads the list again; a second open page learns of it the same way (AC-05).
    const controller = new AbortController();
    void client.followServer({ onEvent: load, onState: onLive, onFailure: onFatal }, controller.signal);
    return () => {
      current = false;
      controller.abort();
    };
  }, [client, onFatal, onLive]);

  const columns = useMemo(() => runColumns(clock, navigate), [clock, navigate]);

  return h(
    'div',
    null,
    h('h2', { id: 'page-title' }, messages.runs.title),
    h('p', { className: 'muted' }, messages.runs.lead),
    runs === undefined
      ? null
      : runs.length === 0
        ? h(
            'section',
            { className: 'panel empty' },
            h('h3', null, messages.runs.emptyTitle),
            h('p', null, messages.runs.emptyBody),
            h('pre', null, h('code', null, messages.runs.emptyCommand)),
          )
        : h(
            'section',
            { className: 'panel' },
            h(Gridwright<RunSummary>, {
              className: 'ix-grid',
              'aria-label': messages.runs.gridLabel,
              columns,
              data: runs,
              getRowId: (run: RunSummary) => run.runId,
              initialQuery: RUNS_QUERY,
              onRowClick: (row) => navigate({ name: 'run', runId: row.data.runId, step: undefined }),
              addons: RUNS_ADDONS,
            }),
          ),
  );
}
