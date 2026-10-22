import {
  coreAddons,
  Gridwright,
  type GridwrightColumn,
  PAGINATION_ADDON,
  responsive,
  treeData,
} from 'apsw-gridwright/react';
import { createElement as h, type ReactElement, useMemo } from 'react';
import { between, formatDuration } from '../format.js';
import type { GraphNode } from '../graph-model.js';
import { messages } from '../messages.js';
import { type StateLook, stepLook } from '../status.js';
import { StateChip } from './parts.js';
import { stepTime } from './RunGraph.js';

/** A row of the step list: a step, or one try of a step that ran more than once. */
export interface StepRow {
  readonly id: string;
  readonly stepId: string;
  readonly label: string;
  readonly look: StateLook;
  readonly time: string;
  readonly children: readonly StepRow[] | undefined;
}

/** The rows for these steps, in graph order: a retried step opens to show its tries. */
export function stepRows(nodes: readonly GraphNode[], now: number): readonly StepRow[] {
  return nodes.map((node): StepRow => {
    const step = node.step;
    const tries =
      step !== undefined && step.history.length > 1
        ? step.history.map((attempt): StepRow => {
            const ms = between(attempt.startedAt, attempt.endedAt ?? new Date(now).toISOString());
            return {
              id: `${node.id}#${attempt.attempt}`,
              stepId: node.id,
              label: messages.run.tryLabel(attempt.attempt),
              look: stepLook(attempt.outcome),
              time: ms === undefined ? '–' : formatDuration(ms),
              children: undefined,
            };
          })
        : undefined;
    return {
      id: node.id,
      stepId: node.id,
      label: node.id,
      look: stepLook(step?.status ?? 'PENDING'),
      time: (step === undefined ? undefined : stepTime(step, now)) ?? '–',
      children: tries,
    };
  });
}

export interface StepsGridProps {
  readonly nodes: readonly GraphNode[];
  readonly selected: string | undefined;
  readonly now: number;
  readonly onSelect: (stepId: string) => void;
}

/** The steps of a run as an apsw-gridwright grid, beside the graph: the same selection, reachable by keyboard. */
export function StepsGrid(props: StepsGridProps): ReactElement {
  const { nodes, selected, now, onSelect } = props;
  const rows = useMemo(() => stepRows(nodes, now), [nodes, now]);
  const columns = useMemo(
    (): GridwrightColumn<StepRow>[] => [
      {
        id: 'label',
        header: messages.run.step,
        sortable: false,
        cell: ({ row }) =>
          row.children === undefined && row.id !== row.stepId
            ? row.label
            : h(
                'button',
                {
                  type: 'button',
                  className: 'row-link',
                  'aria-current': row.stepId === selected ? true : undefined,
                  onClick: () => onSelect(row.stepId),
                },
                row.label,
              ),
      },
      {
        id: 'state',
        header: messages.runs.state,
        sortable: false,
        width: 136,
        accessor: (row) => row.look.word,
        cell: ({ row }) => h(StateChip, { look: row.look }),
      },
      {
        id: 'time',
        header: messages.run.time,
        sortable: false,
        align: 'end',
        width: 100,
        responsive: { hideBelow: 330 },
      },
    ],
    [selected, onSelect],
  );
  const core = useMemo(() => coreAddons<StepRow>().filter((addon) => addon.name !== PAGINATION_ADDON), []);
  const addons = useMemo(
    () => [
      treeData<StepRow>({
        getRowId: (row) => row.id,
        getChildren: (row) => row.children,
        defaultExpandedDepth: 1,
      }),
      responsive<StepRow>(),
    ],
    [],
  );
  return h(Gridwright<StepRow>, {
    className: 'ix-grid',
    'aria-label': messages.run.stepsLabel,
    columns,
    data: rows,
    pageSize: 500,
    // A run's steps are a short list, read whole: no paging controls.
    coreAddons: core,
    addons,
  });
}
