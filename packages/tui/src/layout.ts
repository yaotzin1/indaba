/** How the screen is divided. Pure: it depends on the size of the terminal and nothing else. */
export interface Layout {
  /** `split`: the steps beside the detail; `stacked`: one above the other; `too-small`: only a notice. */
  readonly mode: 'split' | 'stacked' | 'too-small';
  readonly columns: number;
  readonly rows: number;
  /** Width of the step list, and of the detail pane. */
  readonly listWidth: number;
  readonly detailWidth: number;
  /** Rows of each pane's body (a one-row header and a one-row footer are already taken off). */
  readonly listRows: number;
  readonly detailRows: number;
  /** Width and rows of the board docked beside the detail pane; 0 when the board is not docked. */
  readonly dockWidth: number;
  readonly dockRows: number;
  /**
   * Rows of the block of panes of the running steps, drawn above the detail pane (specs/tui-agent-panes). They are already
   * taken off `detailRows`, with one row for the line under them. 0 when no step runs or there is no room.
   */
  readonly paneRows: number;
  /** How many panes of four rows fit in `paneRows`. */
  readonly paneCap: number;
}

export const MIN_COLUMNS = 40;
export const MIN_ROWS = 8;
/** At least this wide, the list and the detail sit side by side. */
export const SPLIT_COLUMNS = 80;
/**
 * At least this wide, and with a board to show, the board is docked on the right of the detail pane (specs/run-blackboard
 * C-13). A first choice from rendering 120, 140 and 160 columns (at 140 the entries and the key row of the board are cut short), not a measurement: the spec leaves the width to be set from
 * trying real terminals, so change it here when people have.
 */
export const DOCK_COLUMNS = 160;
const MAX_LIST_WIDTH = 32;
const MAX_DOCKED_LIST_WIDTH = 28;
const SEPARATOR = 1;

/** One pane is a title row and three rows of the tail of the step's output. */
export const PANE_ROWS = 4;

/**
 * Rows the block of panes takes out of a detail pane of `detailRows`: at most a third of it and at most what the running steps
 * fill, in whole panes of {@link PANE_ROWS}; 0 when that is not one pane. So a small terminal has none, and the list and the
 * detail are what they were.
 */
export function paneRowsFor(detailRows: number, running: number): number {
  const wanted = Math.min(Math.floor(Math.max(0, detailRows) / 3), Math.max(0, running) * PANE_ROWS);
  return Math.floor(wanted / PANE_ROWS) * PANE_ROWS;
}

/** The layout of the screen, and of the panes of `panes` running steps inside the detail pane. */
export function computeLayout(
  columns: number,
  rows: number,
  options: { readonly dock?: boolean; readonly panes?: number } = {},
): Layout {
  const base = baseLayout(columns, rows, options);
  const paneRows = base.mode === 'too-small' ? 0 : paneRowsFor(base.detailRows, options.panes ?? 0);
  if (paneRows === 0) {
    return { ...base, paneRows: 0, paneCap: 0 };
  }
  return {
    ...base,
    detailRows: base.detailRows - paneRows - 1,
    paneRows,
    paneCap: paneRows / PANE_ROWS,
  };
}

function baseLayout(
  columns: number,
  rows: number,
  options: { readonly dock?: boolean },
): Omit<Layout, 'paneRows' | 'paneCap'> {
  const safeColumns = Number.isFinite(columns) && columns > 0 ? Math.floor(columns) : 0;
  const safeRows = Number.isFinite(rows) && rows > 0 ? Math.floor(rows) : 0;
  const body = Math.max(0, safeRows - 2);

  if (safeColumns < MIN_COLUMNS || safeRows < MIN_ROWS) {
    return {
      mode: 'too-small',
      columns: safeColumns,
      rows: safeRows,
      listWidth: 0,
      detailWidth: 0,
      listRows: 0,
      detailRows: 0,
      dockWidth: 0,
      dockRows: 0,
    };
  }
  if (options.dock === true && safeColumns >= DOCK_COLUMNS) {
    const listWidth = Math.min(MAX_DOCKED_LIST_WIDTH, Math.floor(safeColumns * 0.2));
    const dockWidth = Math.floor(safeColumns * 0.38);
    return {
      mode: 'split',
      columns: safeColumns,
      rows: safeRows,
      listWidth,
      detailWidth: safeColumns - listWidth - dockWidth - 2 * SEPARATOR,
      listRows: body,
      detailRows: body,
      dockWidth,
      dockRows: body,
    };
  }
  if (safeColumns >= SPLIT_COLUMNS) {
    const listWidth = Math.min(MAX_LIST_WIDTH, Math.floor(safeColumns * 0.3));
    return {
      mode: 'split',
      columns: safeColumns,
      rows: safeRows,
      listWidth,
      detailWidth: safeColumns - listWidth - SEPARATOR,
      listRows: body,
      detailRows: body,
      dockWidth: 0,
      dockRows: 0,
    };
  }
  const listRows = Math.max(2, Math.floor(body / 3));
  return {
    mode: 'stacked',
    columns: safeColumns,
    rows: safeRows,
    listWidth: safeColumns,
    detailWidth: safeColumns,
    listRows,
    detailRows: Math.max(1, body - listRows - 1),
    dockWidth: 0,
    dockRows: 0,
  };
}

/** Shortens text to `width` characters, ending in an ellipsis (or `~` in ASCII); pads nothing. Counts code points. */
export function clip(text: string, width: number, ascii = false): string {
  if (width <= 0) {
    return '';
  }
  const chars = Array.from(text);
  if (chars.length <= width) {
    return text;
  }
  const mark = ascii ? '~' : '…';
  return `${chars.slice(0, width - 1).join('')}${mark}`;
}

/** Pads with spaces to `width` characters, or clips when longer. */
export function fit(text: string, width: number, ascii = false): string {
  const clipped = clip(text, width, ascii);
  return clipped + ' '.repeat(Math.max(0, width - Array.from(clipped).length));
}

/** Breaks text into rows of at most `width` characters, so a long line is shown whole. An empty line stays one row. */
export function wrap(text: string, width: number): string[] {
  const chars = Array.from(text);
  if (width <= 0 || chars.length <= width) {
    return [text];
  }
  const rows: string[] = [];
  for (let i = 0; i < chars.length; i += width) {
    rows.push(chars.slice(i, i + width).join(''));
  }
  return rows;
}
