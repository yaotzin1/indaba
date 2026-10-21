import { sanitize } from '@indaba/engine';
import { clip, fit } from './layout.js';
import type { Row, Tone } from './screen.js';
import {
  check,
  describeField,
  fieldDefault,
  isDirty,
  problemsOf,
  rowsOf,
  type SettingsRow,
  type SettingsUi,
  SINK_NAMES,
} from './settings-state.js';

export interface SettingsScreenOptions {
  /** The file the settings are saved to, shown in the header. */
  readonly path: string;
  /** Whether a variable named as a secret is set in this command's environment: its value is never shown (AC-21). */
  readonly isVariableSet: (name: string) => boolean;
  readonly columns: number;
  readonly ascii: boolean;
}

const row = (text: string, tone: Tone = 'normal', selected = false): Row => ({ text, tone, selected });

/** Text the person typed, or that came from the file: safe for a terminal and on one line. */
function safe(text: string): string {
  return sanitize(text).replace(/[\r\n\t]+/g, ' ');
}

const LABEL_WIDTH = 34;
const VALUE_WIDTH = 28;

function line(label: string, value: string, extra: string, columns: number): string {
  return clip(`${fit(label, LABEL_WIDTH)}${fit(value, VALUE_WIDTH)}${extra}`, columns);
}

function shownValue(
  ui: SettingsUi,
  r: SettingsRow,
  selected: boolean,
  options: SettingsScreenOptions,
): string {
  if (r.kind === 'level') {
    return ui.draft.level;
  }
  if (r.kind !== 'field') {
    return '';
  }
  if (selected && ui.editing !== undefined) {
    return `${safe(ui.editing)}_`;
  }
  const value = safe(ui.draft.sinks[r.sink]?.values[r.key] ?? '');
  if (r.key === 'secretEnv') {
    if (value === '') {
      return '(none)';
    }
    return `${value} (${options.isVariableSet(value) ? 'set' : 'not set'})`;
  }
  return value === '' ? '(empty)' : value;
}

function labelOf(ui: SettingsUi, r: SettingsRow, ascii: boolean): string {
  if (r.kind === 'level') {
    return '  Level of the whole log';
  }
  if (r.kind === 'add') {
    return `  ${ascii ? '+' : '＋'} Add: ${SINK_NAMES[r.type]}`;
  }
  const sink = ui.draft.sinks[r.sink];
  if (r.kind === 'sink') {
    return `  ${sink === undefined ? '' : SINK_NAMES[sink.type]}`;
  }
  return `      ${sink === undefined ? r.key : describeField(sink.type, r.key).label}`;
}

function defaultOf(ui: SettingsUi, r: SettingsRow): string | undefined {
  if (r.kind === 'level') {
    return 'info';
  }
  if (r.kind !== 'field') {
    return undefined;
  }
  const sink = ui.draft.sinks[r.sink];
  if (sink === undefined) {
    return undefined;
  }
  const value = fieldDefault(sink.type, r.key);
  return value === '' ? undefined : value;
}

/** The rows of the Settings screen: every setting with its value and its default beside it, then help and keys. */
export function buildSettingsScreen(ui: SettingsUi, options: SettingsScreenOptions): Row[] {
  const columns = Math.max(20, options.columns);
  const { problems } = check(ui.draft);
  const rows = rowsOf(ui.draft);
  const out: Row[] = [
    row(
      clip(`Logging settings  ${safe(options.path)}${isDirty(ui) ? '  (not saved)' : ''}`, columns),
      'accent',
    ),
    row(''),
  ];
  rows.forEach((r, index) => {
    const selected = index === ui.cursor;
    const own = problemsOf(r, problems);
    const fallback = defaultOf(ui, r);
    const extra = own.length > 0 ? `! ${own[0] ?? ''}` : fallback === undefined ? '' : `default: ${fallback}`;
    const tone: Tone =
      own.length > 0 ? 'bad' : r.kind === 'sink' ? 'info' : r.kind === 'add' ? 'dim' : 'normal';
    out.push(
      row(
        line(labelOf(ui, r, options.ascii), shownValue(ui, r, selected, options), extra, columns),
        tone,
        selected,
      ),
    );
  });
  out.push(row(''));
  const current = rows[ui.cursor];
  if (current?.kind === 'field') {
    const sink = ui.draft.sinks[current.sink];
    if (sink !== undefined) {
      out.push(row(clip(describeField(sink.type, current.key).help, columns), 'dim'));
    }
  } else if (current?.kind === 'level') {
    out.push(row(clip('How much is recorded at all: error, warn, info or debug.', columns), 'dim'));
  }
  const others = problems.filter((p) => !rows.some((r) => problemsOf(r, [p]).length > 0));
  for (const problem of others) {
    out.push(row(clip(`! ${problem}`, columns), 'bad'));
  }
  if (ui.message !== undefined) {
    out.push(
      row(
        clip(safe(ui.message.text), columns),
        ui.message.tone === 'good' ? 'good' : ui.message.tone === 'bad' ? 'bad' : 'info',
      ),
    );
  }
  if (ui.confirmQuit) {
    out.push(
      row(clip('There are unsaved changes. Leave without saving? y = leave, n = stay', columns), 'warn'),
    );
  }
  const keys =
    ui.editing === undefined
      ? 'up/down move  enter edit  left/right level  d default  x remove  t test  s save  q quit'
      : 'type the value  enter keep  esc cancel';
  out.push(row(clip(keys, columns), 'dim'));
  return out;
}
