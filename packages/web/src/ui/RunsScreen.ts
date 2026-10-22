import type { RunSummary } from '@indaba/core';
import { Gridwright, type GridwrightColumn, responsive } from 'apsw-gridwright/react';
import {
  createElement as h,
  type MouseEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ApiFailure, type Client, type Failure, type StreamState } from '../client.js';
import { costTip } from '../cost.js';
import { type Clock, formatRunCost, formatWhen, shortId } from '../format.js';
import { messages } from '../messages.js';
import { runLook } from '../status.js';
import { StateChip } from './parts.js';
import { RunPanel } from './RunPanel.js';
import { hrefOf, isPlainClick, type Navigate } from './router.js';

export interface RunsScreenProps {
  readonly client: Client;
  readonly clock: Clock;
  readonly navigate: Navigate;
  readonly onFatal: (failure: Failure) => void;
  readonly onLive: (state: StreamState) => void;
  /** Whether this server starts runs; without it there is no Run button (specs/web-app-actions). */
  readonly canRun?: boolean;
  /** Whether the person was told this session that closing indaba ui stops its runs. */
  readonly noticeSeen?: boolean;
  readonly onNoticeSeen?: () => void;
  /** How often a start is asked about; tests make it short. */
  readonly pollMs?: number;
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
      id: 'cost',
      header: messages.runs.cost,
      align: 'end',
      // Sorted by what is known to have been spent; the cell says when that is partial or unknown.
      accessor: (run) => run.cost.usd,
      cell: ({ row }) => h('span', { title: costTip(row.cost) }, formatRunCost(row.cost)),
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
  const [panelOpen, setPanelOpen] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  const closePanel = useCallback(() => {
    setPanelOpen(false);
    // Focus goes back where it was before the dialog opened.
    opener.current?.focus();
  }, []);
  const openRun = useCallback(
    (runId: string) => {
      setPanelOpen(false);
      navigate({ name: 'run', runId, step: undefined });
    },
    [navigate],
  );
  const onNoticeSeen = props.onNoticeSeen ?? (() => undefined);
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
    h(
      'div',
      { className: 'title-row' },
      h('h2', { id: 'page-title' }, messages.runs.title),
      props.canRun === true
        ? h(
            'button',
            {
              ref: opener,
              type: 'button',
              className: 'primary',
              'aria-haspopup': 'dialog',
              onClick: () => setPanelOpen(true),
            },
            messages.runs.runWorkflow,
          )
        : null,
    ),
    h('p', { className: 'muted' }, messages.runs.lead),
    panelOpen
      ? h(RunPanel, {
          client,
          onClose: closePanel,
          onOpenRun: openRun,
          onFatal,
          noticeSeen: props.noticeSeen === true,
          onNoticeSeen,
          ...(props.pollMs === undefined ? {} : { pollMs: props.pollMs }),
        })
      : null,
    runs === undefined
      ? null
      : runs.length === 0
        ? h(
            'section',
            { className: 'panel empty' },
            h('h3', null, messages.runs.emptyTitle),
            h('p', null, props.canRun === true ? messages.runs.emptyBodyCanRun : messages.runs.emptyBody),
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
