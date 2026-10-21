import type { LoggingSettings, LoggingSettingsResponse, SettingDescription, SinkType } from '@indaba/core';

/**
 * The logging settings as the Settings screen edits them (specs/logging, AC-20): text, so a value being typed may be
 * wrong for a moment, and turned back into the `logging:` mapping a file would hold for the server to check. Every
 * label, help text, minimum and default arrives from the server (`LOGGING_SETTINGS`, `SINK_DEFAULTS` of
 * `@indaba/core`): the page holds no copy, and every check is the server's own (AC-19).
 */

export interface DraftSink {
  readonly type: SinkType;
  readonly values: Readonly<Record<string, string>>;
}

export interface Draft {
  readonly level: string;
  readonly sinks: readonly DraftSink[];
}

export const LEVELS = ['error', 'warn', 'info', 'debug'] as const;

/** The settings of each kind of sink, in the order they are shown. */
export const SINK_FIELDS: Readonly<Record<SinkType, readonly string[]>> = {
  file: ['level', 'folder', 'maxFileBytes', 'maxFiles'],
  stderr: ['level'],
  gelf: ['address', 'level', 'secretEnv', 'queueLength', 'timeoutSeconds', 'retries'],
  'http-json': ['address', 'level', 'secretEnv', 'queueLength', 'timeoutSeconds', 'retries'],
};

export const SINK_TYPE_ORDER: readonly SinkType[] = ['file', 'stderr', 'gelf', 'http-json'];

const NUMBER_FIELDS = new Set(['maxFileBytes', 'maxFiles', 'queueLength', 'timeoutSeconds', 'retries']);

export function isNumberField(key: string): boolean {
  return NUMBER_FIELDS.has(key);
}

export function draftOf(settings: LoggingSettings): Draft {
  return {
    level: settings.level,
    sinks: settings.sinks.map((sink) => {
      const record = sink as unknown as Readonly<Record<string, string | number | undefined>>;
      const values: Record<string, string> = {};
      for (const key of SINK_FIELDS[sink.type]) {
        const value = record[key];
        values[key] = value === undefined ? '' : String(value);
      }
      return { type: sink.type, values };
    }),
  };
}

function entryOf(sink: DraftSink): Record<string, unknown> {
  const entry: Record<string, unknown> = { type: sink.type };
  for (const [key, value] of Object.entries(sink.values)) {
    if (key === 'secretEnv' && value.trim() === '') {
      continue;
    }
    entry[key] = NUMBER_FIELDS.has(key) && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value.trim();
  }
  return entry;
}

/** The draft as the `logging:` mapping a file would hold. */
export function rawOf(draft: Draft): Readonly<Record<string, unknown>> {
  return { level: draft.level, sinks: draft.sinks.map(entryOf) };
}

/** One sink entry as a file would hold it, for a test record. */
export function rawSinkOf(sink: DraftSink): Readonly<Record<string, unknown>> {
  return entryOf(sink);
}

export function newSink(type: SinkType, defaults: LoggingSettingsResponse['sinkDefaults']): DraftSink {
  const values: Record<string, string> = {};
  for (const key of SINK_FIELDS[type]) {
    const value = defaults[type][key];
    values[key] = value === undefined ? '' : String(value);
  }
  return { type, values };
}

export function sameDraft(a: Draft, b: Draft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The description the server sent for a setting of a kind of sink: `file.folder`, `remote.retries`, ... */
export function descriptionOf(
  descriptions: readonly SettingDescription[],
  type: SinkType,
  key: string,
): SettingDescription | undefined {
  const scope = type === 'file' ? 'file' : type === 'stderr' ? 'stderr' : 'remote';
  return descriptions.find((d) => d.key === `${scope}.${key}`);
}

/** The problems that name the level of the log, or one setting of one sink, or a sink as a whole. */
export function problemsFor(problems: readonly string[], where: { sink?: number; key?: string }): string[] {
  if (where.sink === undefined) {
    return problems.filter((p) => p.startsWith('level '));
  }
  const prefix = where.key === undefined ? `sinks[${where.sink}] ` : `sinks[${where.sink}].${where.key} `;
  return problems.filter((p) => p.startsWith(prefix));
}

/** A problem as a person reads it next to its field: without the key the field already shows. */
export function plainProblem(problem: string): string {
  const text = problem.replace(/^(level|sinks\[\d+\](\.\w+)?) /, '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
