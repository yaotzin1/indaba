import {
  isLogLevel,
  LOG_LEVELS,
  LOGGING_DEFAULTS,
  LOGGING_SETTINGS,
  type LoggingSettings,
  type LogLevel,
  resolveLoggingSettings,
  type SinkSettings,
  type SinkType,
} from '@indaba/engine';

/**
 * The Settings screen of logging, as state: what is being edited, what is selected, what the person typed. Pure: a key
 * in, the next state out; saving and testing are asked for (`request`) and done by the screen. Every default, limit and
 * help text comes from `LOGGING_SETTINGS` and `LOGGING_DEFAULTS` of `@indaba/core`, and every check from
 * `resolveLoggingSettings`, the same function a hand-edited `indaba.config` goes through (specs/logging, AC-19, AC-20).
 */

/** What one setting of one sink holds while it is edited: text, so a value being typed may be wrong for a moment. */
export interface DraftSink {
  readonly type: SinkType;
  readonly values: Readonly<Record<string, string>>;
}

export interface Draft {
  readonly level: string;
  readonly sinks: readonly DraftSink[];
}

export type SettingsRow =
  | { readonly kind: 'level' }
  | { readonly kind: 'sink'; readonly sink: number }
  | { readonly kind: 'field'; readonly sink: number; readonly key: string }
  | { readonly kind: 'add'; readonly type: SinkType };

export type SettingsKey =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'enter'
  | 'escape'
  | 'backspace'
  | 'ctrl-c'
  | { readonly char: string };

export interface SettingsUi {
  readonly draft: Draft;
  /** What is in the file now, to tell an unsaved change. */
  readonly saved: Draft;
  readonly cursor: number;
  /** The text being typed into the selected setting, or undefined when nothing is being typed. */
  readonly editing: string | undefined;
  /** Leaving with unsaved changes was asked for and waits for a yes or a no. */
  readonly confirmQuit: boolean;
  readonly quit: boolean;
  /** Something the screen must do: write the file, or send a test record through the selected sink. */
  readonly request: 'save' | 'test' | undefined;
  /** The answer to the last request or refusal, shown under the settings. */
  readonly message: { readonly text: string; readonly tone: 'good' | 'bad' | 'info' } | undefined;
}

/** The settings of each kind of sink, in the order they are shown. */
export const SINK_FIELDS: Readonly<Record<SinkType, readonly string[]>> = {
  file: ['level', 'folder', 'maxFileBytes', 'maxFiles'],
  stderr: ['level'],
  gelf: ['address', 'level', 'secretEnv', 'queueLength', 'timeoutSeconds', 'retries'],
  'http-json': ['address', 'level', 'secretEnv', 'queueLength', 'timeoutSeconds', 'retries'],
};

const INTEGER_FIELDS = new Set(['maxFileBytes', 'maxFiles', 'queueLength', 'timeoutSeconds', 'retries']);

export const SINK_NAMES: Readonly<Record<SinkType, string>> = {
  file: 'Log files',
  stderr: 'Terminal (standard error)',
  gelf: 'GELF collector (Graylog)',
  'http-json': 'HTTP JSON collector',
};

/** The level a sink takes when its entry names none, as `resolveLoggingSettings` reads it. */
export function sinkDefaultLevel(type: SinkType): LogLevel {
  if (type === 'file') {
    return 'debug';
  }
  return type === 'stderr' ? LOGGING_DEFAULTS.stderr.level : 'info';
}

/** The default of one setting of one kind of sink, as text; empty when it has none (an address). */
export function fieldDefault(type: SinkType, key: string): string {
  if (key === 'level') {
    return sinkDefaultLevel(type);
  }
  const value =
    type === 'file'
      ? (LOGGING_DEFAULTS.file as Readonly<Record<string, string | number>>)[key]
      : (LOGGING_DEFAULTS.remote as Readonly<Record<string, string | number>>)[key];
  return value === undefined ? '' : String(value);
}

/** The description in `LOGGING_SETTINGS` that a setting of a kind of sink is shown with. */
export function describeField(
  type: SinkType,
  key: string,
): { readonly label: string; readonly help: string } {
  const scope = type === 'file' ? 'file' : type === 'stderr' ? 'stderr' : 'remote';
  const found = LOGGING_SETTINGS.find((s) => s.key === `${scope}.${key}`);
  if (found !== undefined) {
    return { label: found.label, help: found.help };
  }
  if (key === 'level') {
    return { label: 'Level', help: 'The least severe records this sink receives.' };
  }
  if (key === 'address') {
    return {
      label: 'Address',
      help:
        type === 'gelf'
          ? 'The GELF input: http(s)://host:port/gelf, tcp://host:port or udp://host:port.'
          : 'The URL each record is posted to: http(s)://...',
    };
  }
  return { label: key, help: '' };
}

export function draftOf(settings: LoggingSettings): Draft {
  return {
    level: settings.level,
    sinks: settings.sinks.map((sink) => {
      const values: Record<string, string> = {};
      for (const key of SINK_FIELDS[sink.type]) {
        const value = (sink as unknown as Readonly<Record<string, string | number | undefined>>)[key];
        values[key] = value === undefined ? '' : String(value);
      }
      return { type: sink.type, values };
    }),
  };
}

/** The draft as the `logging:` mapping a file would hold, for `resolveLoggingSettings` to check. */
export function rawOf(draft: Draft): Readonly<Record<string, unknown>> {
  return {
    level: draft.level,
    sinks: draft.sinks.map((sink) => {
      const entry: Record<string, unknown> = { type: sink.type };
      for (const [key, value] of Object.entries(sink.values)) {
        if (key === 'secretEnv' && value === '') {
          continue;
        }
        entry[key] = INTEGER_FIELDS.has(key) && /^\d+$/.test(value) ? Number(value) : value;
      }
      return entry;
    }),
  };
}

export interface Checked {
  readonly settings: LoggingSettings;
  /** Every problem, each naming its key (`sinks[1].address ...`). */
  readonly problems: readonly string[];
}

export function check(draft: Draft): Checked {
  const resolved = resolveLoggingSettings(rawOf(draft));
  return { settings: resolved.settings, problems: resolved.problems };
}

/** The problems that belong to one row, so they are shown next to it. */
export function problemsOf(row: SettingsRow | undefined, problems: readonly string[]): string[] {
  if (row === undefined) {
    return [];
  }
  if (row.kind === 'level') {
    return problems.filter((p) => p.startsWith('level '));
  }
  if (row.kind === 'field') {
    return problems.filter((p) => p.startsWith(`sinks[${row.sink}].${row.key} `));
  }
  if (row.kind === 'sink') {
    return problems.filter((p) => p.startsWith(`sinks[${row.sink}] `));
  }
  return [];
}

export function rowsOf(draft: Draft): SettingsRow[] {
  const rows: SettingsRow[] = [{ kind: 'level' }];
  draft.sinks.forEach((sink, index) => {
    rows.push({ kind: 'sink', sink: index });
    for (const key of SINK_FIELDS[sink.type]) {
      rows.push({ kind: 'field', sink: index, key });
    }
  });
  const present = new Set(draft.sinks.map((s) => s.type));
  for (const type of ['file', 'stderr'] as const) {
    if (!present.has(type)) {
      rows.push({ kind: 'add', type });
    }
  }
  rows.push({ kind: 'add', type: 'gelf' }, { kind: 'add', type: 'http-json' });
  return rows;
}

export function initialSettingsUi(settings: LoggingSettings): SettingsUi {
  const draft = draftOf(settings);
  return {
    draft,
    saved: draft,
    cursor: 0,
    editing: undefined,
    confirmQuit: false,
    quit: false,
    request: undefined,
    message: undefined,
  };
}

export function isDirty(ui: SettingsUi): boolean {
  return JSON.stringify(ui.draft) !== JSON.stringify(ui.saved);
}

function setValue(draft: Draft, sink: number, key: string, value: string): Draft {
  return {
    ...draft,
    sinks: draft.sinks.map((s, i) => (i === sink ? { ...s, values: { ...s.values, [key]: value } } : s)),
  };
}

function cycleLevel(level: string, by: number): LogLevel {
  const at = isLogLevel(level) ? LOG_LEVELS.indexOf(level) : 0;
  return LOG_LEVELS[(at + by + LOG_LEVELS.length) % LOG_LEVELS.length] ?? 'info';
}

function newSink(type: SinkType): DraftSink {
  const values: Record<string, string> = {};
  for (const key of SINK_FIELDS[type]) {
    values[key] = fieldDefault(type, key);
  }
  return { type, values };
}

function clampCursor(ui: SettingsUi): SettingsUi {
  const rows = rowsOf(ui.draft).length;
  const cursor = Math.min(Math.max(ui.cursor, 0), rows - 1);
  return cursor === ui.cursor ? ui : { ...ui, cursor };
}

function selectedSink(row: SettingsRow | undefined): number | undefined {
  return row !== undefined && (row.kind === 'sink' || row.kind === 'field') ? row.sink : undefined;
}

function edited(ui: SettingsUi, draft: Draft): SettingsUi {
  return clampCursor({ ...ui, draft, message: undefined });
}

/** Reduces one key. `request` is cleared by every key, so a request is acted on once. */
export function reduceSettings(previous: SettingsUi, key: SettingsKey): SettingsUi {
  const ui: SettingsUi = previous.request === undefined ? previous : { ...previous, request: undefined };
  const rows = rowsOf(ui.draft);
  const row = rows[ui.cursor];

  if (ui.confirmQuit) {
    if (typeof key === 'object' && key.char === 'y') {
      return { ...ui, quit: true };
    }
    if ((typeof key === 'object' && key.char === 'n') || key === 'escape') {
      return { ...ui, confirmQuit: false };
    }
    return ui;
  }

  if (ui.editing !== undefined && row?.kind === 'field') {
    if (key === 'enter') {
      return edited({ ...ui, editing: undefined }, setValue(ui.draft, row.sink, row.key, ui.editing.trim()));
    }
    if (key === 'escape') {
      return { ...ui, editing: undefined };
    }
    if (key === 'backspace') {
      return { ...ui, editing: ui.editing.slice(0, -1) };
    }
    if (key === 'ctrl-c') {
      return { ...ui, editing: undefined };
    }
    if (typeof key === 'object' && printable(key.char)) {
      return { ...ui, editing: `${ui.editing}${key.char}` };
    }
    return ui;
  }

  if (key === 'up' || (typeof key === 'object' && key.char === 'k')) {
    return { ...ui, cursor: Math.max(0, ui.cursor - 1) };
  }
  if (key === 'down' || (typeof key === 'object' && key.char === 'j')) {
    return { ...ui, cursor: Math.min(rows.length - 1, ui.cursor + 1) };
  }
  if (key === 'ctrl-c' || key === 'escape' || (typeof key === 'object' && key.char === 'q')) {
    return isDirty(ui) ? { ...ui, confirmQuit: true } : { ...ui, quit: true };
  }
  if (typeof key === 'object' && key.char === 's') {
    if (check(ui.draft).problems.length > 0) {
      return { ...ui, message: { text: 'Fix the problems shown before saving.', tone: 'bad' } };
    }
    return { ...ui, request: 'save', message: { text: 'Saving...', tone: 'info' } };
  }
  if (typeof key === 'object' && key.char === 't') {
    const sink = selectedSink(row);
    if (sink === undefined) {
      return { ...ui, message: { text: 'Select a sink to send it a test record.', tone: 'info' } };
    }
    if (
      problemsOf({ kind: 'sink', sink }, check(ui.draft).problems).length > 0 ||
      hasFieldProblem(ui.draft, sink)
    ) {
      return { ...ui, message: { text: 'Fix the problems of this sink before testing it.', tone: 'bad' } };
    }
    return { ...ui, request: 'test', message: { text: 'Sending a test record...', tone: 'info' } };
  }

  if (row === undefined) {
    return ui;
  }
  if (row.kind === 'add') {
    if (key === 'enter') {
      const draft = { ...ui.draft, sinks: [...ui.draft.sinks, newSink(row.type)] };
      const at = rowsOf(draft).findIndex((r) => r.kind === 'sink' && r.sink === draft.sinks.length - 1);
      return { ...edited(ui, draft), cursor: at + 1 };
    }
    return ui;
  }
  if (row.kind === 'level') {
    if (key === 'left' || key === 'right' || key === 'enter') {
      return edited(ui, { ...ui.draft, level: cycleLevel(ui.draft.level, key === 'left' ? -1 : 1) });
    }
    if (typeof key === 'object' && key.char === 'd') {
      return edited(ui, { ...ui.draft, level: LOGGING_DEFAULTS.level });
    }
    return ui;
  }
  if (typeof key === 'object' && key.char === 'x') {
    return edited(ui, { ...ui.draft, sinks: ui.draft.sinks.filter((_s, i) => i !== row.sink) });
  }
  if (row.kind === 'sink') {
    return ui;
  }
  const sink = ui.draft.sinks[row.sink];
  if (sink === undefined) {
    return ui;
  }
  const value = sink.values[row.key] ?? '';
  if (typeof key === 'object' && key.char === 'd') {
    return edited(ui, setValue(ui.draft, row.sink, row.key, fieldDefault(sink.type, row.key)));
  }
  if (row.key === 'level') {
    if (key === 'left' || key === 'right' || key === 'enter') {
      return edited(ui, setValue(ui.draft, row.sink, row.key, cycleLevel(value, key === 'left' ? -1 : 1)));
    }
    return ui;
  }
  if (key === 'enter') {
    return { ...ui, editing: value, message: undefined };
  }
  return ui;
}

/** A key that types something: no control character (a pasted escape sequence types nothing). */
function printable(text: string): boolean {
  return [...text].every((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code >= 0x20 && code !== 0x7f && !(code >= 0x80 && code < 0xa0);
  });
}

function hasFieldProblem(draft: Draft, sink: number): boolean {
  return check(draft).problems.some((p) => p.startsWith(`sinks[${sink}].`));
}

/** The sink selected, checked, for a test record; undefined when none is selected or it has a problem. */
export function selectedSinkSettings(ui: SettingsUi): SinkSettings | undefined {
  const index = selectedSink(rowsOf(ui.draft)[ui.cursor]);
  if (index === undefined || hasFieldProblem(ui.draft, index)) {
    return undefined;
  }
  const draftSink = ui.draft.sinks[index];
  if (draftSink === undefined) {
    return undefined;
  }
  const alone = check({ level: ui.draft.level, sinks: [draftSink] });
  return alone.problems.length === 0 ? alone.settings.sinks[0] : undefined;
}

/** After a save: what was written is now what the file holds. */
export function markSaved(ui: SettingsUi, text: string): SettingsUi {
  return { ...ui, saved: ui.draft, request: undefined, message: { text, tone: 'good' } };
}

export function withMessage(ui: SettingsUi, text: string, tone: 'good' | 'bad' | 'info'): SettingsUi {
  return { ...ui, request: undefined, message: { text, tone } };
}
