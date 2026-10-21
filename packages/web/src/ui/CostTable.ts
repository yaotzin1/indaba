import {
  coreAddons,
  Gridwright,
  type GridwrightColumn,
  PAGINATION_ADDON,
  responsive,
} from 'apsw-gridwright/react';
import { createElement as h, type ReactElement, useMemo } from 'react';
import { type CostRow, costRows, costTip } from '../cost.js';
import { formatRunCost, formatTokens } from '../format.js';
import type { GraphNode } from '../graph-model.js';
import { messages } from '../messages.js';

export interface CostTableProps {
  readonly nodes: readonly GraphNode[];
}

/**
 * A run's cost, step by step, as an apsw-gridwright grid: the calls, the tokens and the cost of every step that called
 * a model. Its rows add up to the total above it (both follow the engine's reducer); a step with a call still running
 * says so, because that call's cost is not known yet.
 */
export function CostTable(props: CostTableProps): ReactElement {
  const rows = useMemo(() => costRows(props.nodes), [props.nodes]);
  const columns = useMemo(
    (): GridwrightColumn<CostRow>[] => [
      { id: 'id', header: messages.run.step },
      {
        id: 'calls',
        header: messages.run.calls,
        align: 'end',
        width: 96,
        accessor: (row) => row.cost.calls,
        cell: ({ row }) =>
          row.running > 0
            ? h(
                'span',
                null,
                String(row.cost.calls),
                h('span', { className: 'muted' }, ` (${messages.run.callsRunning(row.running)})`),
              )
            : String(row.cost.calls),
      },
      {
        id: 'tokens',
        header: messages.step.tokens,
        align: 'end',
        sortable: false,
        responsive: { hideBelow: 420 },
        cell: ({ row }) => `${formatTokens(row.inputTokens)} / ${formatTokens(row.outputTokens)}`,
      },
      {
        id: 'cost',
        header: messages.step.cost,
        align: 'end',
        accessor: (row) => row.cost.usd,
        // A step whose only call is still running has no cost yet: unknown, not "no model calls".
        cell: ({ row }) =>
          row.cost.calls === 0
            ? messages.cost.unknown
            : h('span', { title: costTip(row.cost) }, formatRunCost(row.cost)),
      },
    ],
    [],
  );
  // A run has few steps that call a model: the table is read whole, with no paging controls.
  const core = useMemo(() => coreAddons<CostRow>().filter((addon) => addon.name !== PAGINATION_ADDON), []);
  const addons = useMemo(() => [responsive<CostRow>()], []);
  if (rows.length === 0) {
    return h('p', null, messages.run.noModelCalls);
  }
  return h(Gridwright<CostRow>, {
    className: 'ix-grid',
    'aria-label': messages.run.costTableLabel,
    columns,
    data: rows,
    getRowId: (row: CostRow) => row.id,
    pageSize: 500,
    coreAddons: core,
    addons,
  });
}
