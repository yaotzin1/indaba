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
}

export const MIN_COLUMNS = 40;
export const MIN_ROWS = 8;
/** At least this wide, the list and the detail sit side by side. */
export const SPLIT_COLUMNS = 80;
const MAX_LIST_WIDTH = 32;
const SEPARATOR = 1;

export function computeLayout(columns: number, rows: number): Layout {
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
