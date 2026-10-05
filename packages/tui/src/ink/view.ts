import type { Layout } from '../layout.js';
import type { Row, Screen, Tone } from '../screen.js';
import { Box, h, type ReactElement, Text } from './adapter.js';

/** Colour is an addition, never the only sign of a state: every row already says its state in words. */
const COLOR: Readonly<Record<Tone, string | undefined>> = {
  normal: undefined,
  dim: undefined,
  good: 'green',
  bad: 'red',
  warn: 'yellow',
  info: 'cyan',
  accent: 'magenta',
};

function RowView(props: { readonly row: Row; readonly color: boolean }): ReactElement {
  const { row } = props;
  const tone = props.color ? COLOR[row.tone] : undefined;
  return h(
    Text,
    {
      wrap: 'truncate',
      ...(tone === undefined ? {} : { color: tone }),
      ...(row.tone === 'dim' ? { dimColor: true } : {}),
      ...(row.selected ? { inverse: true } : {}),
    },
    // an empty row still takes a line
    row.text === '' ? ' ' : row.text,
  );
}

function Rows(props: {
  readonly rows: readonly Row[];
  readonly color: boolean;
  readonly width: number;
}): ReactElement {
  return h(
    Box,
    { flexDirection: 'column', width: props.width },
    ...props.rows.map((row, index) => h(RowView, { key: index, row, color: props.color })),
  );
}

export interface ScreenViewProps {
  readonly screen: Screen;
  readonly layout: Layout;
  readonly color: boolean;
  readonly ascii: boolean;
}

/** Draws a screen model. No decisions here: what to show was decided in `buildScreen`. */
export function ScreenView(props: ScreenViewProps): ReactElement {
  const { screen, layout, color } = props;
  const header = h(RowView, { row: screen.header, color });
  if (layout.mode === 'too-small') {
    return h(
      Box,
      { flexDirection: 'column' },
      header,
      h(Rows, { rows: screen.detail, color, width: layout.columns }),
    );
  }
  const footer = h(RowView, { row: screen.footer, color });
  const separator = props.ascii ? '|' : '│';

  if (layout.mode === 'split') {
    return h(
      Box,
      { flexDirection: 'column' },
      header,
      h(
        Box,
        { flexDirection: 'row' },
        h(Rows, { rows: screen.list, color, width: layout.listWidth }),
        h(Text, { dimColor: true }, separator),
        h(Rows, { rows: screen.detail, color, width: layout.detailWidth }),
      ),
      footer,
    );
  }

  return h(
    Box,
    { flexDirection: 'column' },
    header,
    h(Rows, { rows: screen.list, color, width: layout.columns }),
    h(Text, { dimColor: true }, separator.repeat(layout.columns)),
    h(Rows, { rows: screen.detail, color, width: layout.columns }),
    footer,
  );
}
