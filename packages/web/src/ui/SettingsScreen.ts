import type { LoggingSettingsResponse, SettingDescription, SinkType } from '@indaba/core';
import {
  createElement as h,
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ApiFailure, type Client, type Failure } from '../client.js';
import { messages } from '../messages.js';
import {
  type Draft,
  type DraftSink,
  descriptionOf,
  draftOf,
  isNumberField,
  LEVELS,
  newSink,
  plainProblem,
  problemsFor,
  rawOf,
  rawSinkOf,
  SINK_FIELDS,
  SINK_TYPE_ORDER,
  sameDraft,
} from '../settings-model.js';

export interface SettingsScreenProps {
  readonly client: Client;
  readonly onFatal: (failure: Failure) => void;
  /** How long typing must pause before the draft is checked by the server. Tests set 0. */
  readonly checkDelayMs?: number;
}

/** The pause before a draft is checked: long enough not to ask on every key, short enough to feel immediate. */
const CHECK_DELAY_MS = 250;

type Status = { readonly text: string; readonly tone: 'ok' | 'fail' | 'info' } | undefined;

interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly help: string | undefined;
  readonly value: string;
  readonly fallback: string | undefined;
  readonly kind: 'level' | 'number' | 'text';
  readonly problems: readonly string[];
  readonly note?: string;
  readonly onChange: (value: string) => void;
}

/** One setting: its label, the value in an input, the default beside it, and what is wrong with it, read aloud too. */
function Field(props: FieldProps): ReactElement {
  const helpId = `${props.id}-help`;
  const problemId = `${props.id}-problem`;
  const described = [
    props.help === undefined ? undefined : helpId,
    props.problems.length > 0 ? problemId : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(' ');
  const common = {
    id: props.id,
    value: props.value,
    'aria-invalid': props.problems.length > 0 ? true : undefined,
    ...(described === '' ? {} : { 'aria-describedby': described }),
  };
  const input =
    props.kind === 'level'
      ? h(
          'select',
          {
            ...common,
            onChange: (event: { target: { value: string } }) => props.onChange(event.target.value),
          },
          ...LEVELS.map((level) => h('option', { key: level, value: level }, level)),
        )
      : h('input', {
          ...common,
          type: 'text',
          inputMode: props.kind === 'number' ? 'numeric' : undefined,
          spellCheck: false,
          autoComplete: 'off',
          onChange: (event: { target: { value: string } }) => props.onChange(event.target.value),
        });
  const atDefault = props.fallback !== undefined && props.value === props.fallback;
  return h(
    'div',
    { className: `field${props.problems.length > 0 ? ' has-problem' : ''}` },
    h('label', { htmlFor: props.id }, props.label),
    h(
      'div',
      { className: 'field-control' },
      input,
      props.fallback === undefined
        ? null
        : h(
            'span',
            { className: 'field-default' },
            h(
              'span',
              { className: 'muted' },
              messages.settings.defaultIs(props.fallback === '' ? '-' : props.fallback),
            ),
            atDefault
              ? null
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'link',
                    'aria-label': messages.settings.restoreLabel(props.label),
                    onClick: () => props.onChange(props.fallback ?? ''),
                  },
                  messages.settings.restore,
                ),
          ),
    ),
    props.note === undefined ? null : h('p', { className: 'field-note' }, props.note),
    props.help === undefined ? null : h('p', { id: helpId, className: 'field-help muted' }, props.help),
    props.problems.length === 0
      ? null
      : h('p', { id: problemId, className: 'field-problem' }, props.problems.map(plainProblem).join(' ')),
  );
}

function labelOf(descriptions: readonly SettingDescription[], type: SinkType, key: string): string {
  return descriptionOf(descriptions, type, key)?.label ?? messages.settings.fieldLabels[key] ?? key;
}

function helpOf(
  descriptions: readonly SettingDescription[],
  type: SinkType,
  key: string,
): string | undefined {
  if (key === 'level') {
    return messages.settings.sinkLevelHelp;
  }
  if (key === 'address') {
    return type === 'gelf' || type === 'http-json' ? messages.settings.addressHelp[type] : undefined;
  }
  return descriptionOf(descriptions, type, key)?.help;
}

interface SinkCardProps {
  readonly index: number;
  readonly sink: DraftSink;
  readonly loaded: LoggingSettingsResponse;
  readonly savedNames: ReadonlySet<string>;
  readonly problems: readonly string[];
  readonly prefix: string;
  readonly testing: boolean;
  readonly testResult: Status;
  readonly onChange: (key: string, value: string) => void;
  readonly onRemove: () => void;
  readonly onTest: () => void;
}

function SinkCard(props: SinkCardProps): ReactElement {
  const { sink, loaded, index } = props;
  const name = messages.settings.sinkNames[sink.type];
  const headingId = `${props.prefix}-sink-${index}`;
  const own = problemsFor(props.problems, { sink: index });
  const fieldProblems = props.problems.filter((p) => p.startsWith(`sinks[${index}].`));
  return h(
    'section',
    { className: 'panel sink', 'aria-labelledby': headingId, 'data-sink': sink.type },
    h(
      'div',
      { className: 'sink-head' },
      h('h3', { id: headingId }, name),
      h(
        'div',
        { className: 'sink-actions' },
        h(
          'button',
          {
            type: 'button',
            onClick: props.onTest,
            disabled: props.testing || fieldProblems.length > 0 || own.length > 0,
          },
          props.testing ? messages.settings.testing : messages.settings.test,
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'quiet',
            onClick: props.onRemove,
            'aria-label': messages.settings.removeLabel(name),
          },
          messages.settings.remove,
        ),
      ),
    ),
    own.length === 0 ? null : h('p', { className: 'field-problem' }, own.map(plainProblem).join(' ')),
    ...SINK_FIELDS[sink.type].map((key) => {
      const value = sink.values[key] ?? '';
      const fallback = loaded.sinkDefaults[sink.type][key];
      const secret = key === 'secretEnv';
      let note: string | undefined;
      if (secret && value.trim() !== '') {
        const known = loaded.variables[value.trim()];
        note =
          known === undefined || !props.savedNames.has(value.trim())
            ? messages.settings.variableUnknown
            : known
              ? messages.settings.variableSet
              : messages.settings.variableNotSet;
      }
      return h(Field, {
        key,
        id: `${props.prefix}-${index}-${key}`,
        label: labelOf(loaded.descriptions, sink.type, key),
        help: helpOf(loaded.descriptions, sink.type, key),
        value,
        fallback: fallback === undefined ? undefined : String(fallback),
        kind: key === 'level' ? 'level' : isNumberField(key) ? 'number' : 'text',
        problems: problemsFor(props.problems, { sink: index, key }),
        ...(note === undefined ? {} : { note }),
        onChange: (next: string) => props.onChange(key, next),
      });
    }),
    props.testResult === undefined
      ? null
      : h('p', { className: `sink-result ${props.testResult.tone}`, role: 'status' }, props.testResult.text),
  );
}

/**
 * The Settings screen of logging (specs/logging, AC-20, AC-21, T-12): every value with its default beside it, checked
 * by the server as it is typed, a test record through one sink, and Save, which writes the `logging:` section of
 * `indaba.config` through the same writer as a hand-edited file. A secret is a variable's name; whether it is set is
 * the server's to say.
 */
export function SettingsScreen(props: SettingsScreenProps): ReactElement {
  const { client, onFatal } = props;
  const prefix = `settings${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const [loaded, setLoaded] = useState<LoggingSettingsResponse | undefined | 'unavailable'>(undefined);
  const [draft, setDraft] = useState<Draft | undefined>(undefined);
  const [saved, setSaved] = useState<Draft | undefined>(undefined);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [status, setStatus] = useState<Status>(undefined);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<number | undefined>(undefined);
  const [results, setResults] = useState<Readonly<Record<number, Status>>>({});

  const fail = useCallback(
    (error: unknown) => {
      if (error instanceof ApiFailure) {
        if (error.failure.kind === 'server') {
          setStatus({ text: error.failure.message, tone: 'fail' });
        } else {
          onFatal(error.failure);
        }
      }
    },
    [onFatal],
  );

  const adopt = useCallback((answer: LoggingSettingsResponse) => {
    const next = draftOf(answer.settings);
    setLoaded(answer);
    setDraft(next);
    setSaved(next);
    setProblems([]);
  }, []);

  useEffect(() => {
    let current = true;
    client.loggingSettings().then(
      (answer) => {
        if (current) {
          if (answer === undefined) {
            setLoaded('unavailable');
          } else {
            adopt(answer);
          }
        }
      },
      (error: unknown) => {
        if (current) {
          fail(error);
        }
      },
    );
    return () => {
      current = false;
    };
  }, [client, adopt, fail]);

  // Every change is checked by the server's own rules, after a short pause in typing; the newest answer wins.
  const asked = useRef(0);
  useEffect(() => {
    if (draft === undefined || saved === undefined) {
      return;
    }
    if (sameDraft(draft, saved)) {
      asked.current += 1;
      setProblems([]);
      return;
    }
    asked.current += 1;
    const number = asked.current;
    const timer = setTimeout(() => {
      client.checkLoggingSettings(rawOf(draft)).then(
        (found) => {
          if (asked.current === number) {
            setProblems(found);
          }
        },
        (error: unknown) => fail(error),
      );
    }, props.checkDelayMs ?? CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [client, draft, saved, fail, props.checkDelayMs]);

  const savedNames = useMemo(() => {
    const names = new Set<string>();
    for (const sink of saved?.sinks ?? []) {
      const name = sink.values.secretEnv?.trim();
      if (name !== undefined && name !== '') {
        names.add(name);
      }
    }
    return names;
  }, [saved]);

  if (loaded === undefined || (loaded !== 'unavailable' && (draft === undefined || saved === undefined))) {
    return h(
      'div',
      null,
      h('h2', { id: 'page-title' }, messages.settings.title),
      h('p', { className: 'muted', role: 'status' }, messages.settings.loading),
    );
  }
  if (loaded === 'unavailable' || draft === undefined || saved === undefined) {
    return h(
      'div',
      null,
      h('h2', { id: 'page-title' }, messages.settings.title),
      h('section', { className: 'panel empty' }, h('p', null, messages.settings.unavailable)),
    );
  }

  const dirty = !sameDraft(draft, saved);
  const change = (next: Draft): void => {
    setDraft(next);
    setStatus(undefined);
  };
  const changeSink = (index: number, key: string, value: string): void => {
    change({
      ...draft,
      sinks: draft.sinks.map((s, i) => (i === index ? { ...s, values: { ...s.values, [key]: value } } : s)),
    });
    setResults((previous) => ({ ...previous, [index]: undefined }));
  };
  const removeSink = (index: number): void => {
    change({ ...draft, sinks: draft.sinks.filter((_s, i) => i !== index) });
    setResults({});
  };
  const addSink = (type: SinkType): void =>
    change({ ...draft, sinks: [...draft.sinks, newSink(type, loaded.sinkDefaults)] });
  const test = (index: number): void => {
    const sink = draft.sinks[index];
    if (sink === undefined) {
      return;
    }
    setTesting(index);
    client.testLogSink(rawSinkOf(sink)).then(
      (result) => {
        setTesting(undefined);
        setResults((previous) => ({
          ...previous,
          [index]: { text: result.text, tone: result.ok ? 'ok' : 'fail' },
        }));
      },
      (error: unknown) => {
        setTesting(undefined);
        fail(error);
      },
    );
  };
  const save = (): void => {
    setSaving(true);
    setStatus({ text: messages.settings.saving, tone: 'info' });
    client.saveLoggingSettings(rawOf(draft)).then(
      (answer) => {
        setSaving(false);
        if (answer.saved) {
          adopt(answer.settings);
          setStatus({ text: messages.settings.saved, tone: 'ok' });
        } else {
          setProblems(answer.problems);
          setStatus({ text: answer.message, tone: 'fail' });
        }
      },
      (error: unknown) => {
        setSaving(false);
        fail(error);
      },
    );
  };

  const present = new Set(draft.sinks.map((s) => s.type));
  const addable = SINK_TYPE_ORDER.filter(
    (type) => type === 'gelf' || type === 'http-json' || !present.has(type),
  );
  const levelProblems = problemsFor(problems, {});

  return h(
    'div',
    { className: 'settings' },
    h('h2', { id: 'page-title' }, messages.settings.title),
    h('p', { className: 'muted' }, messages.settings.lead),
    h(
      'p',
      { className: 'note' },
      loaded.present ? messages.settings.file(loaded.path) : messages.settings.notWritten(loaded.path),
    ),
    h(
      'section',
      { className: 'panel' },
      h(Field, {
        id: `${prefix}-level`,
        label: messages.settings.levelLabel,
        help: messages.settings.levelHelp,
        value: draft.level,
        fallback: String(loaded.descriptions.find((d) => d.key === 'level')?.default ?? 'info'),
        kind: 'level',
        problems: levelProblems,
        onChange: (value: string) => change({ ...draft, level: value }),
      }),
    ),
    h('h3', { className: 'sinks-title' }, messages.settings.sinksTitle),
    ...draft.sinks.map((sink, index) =>
      h(SinkCard, {
        // A sink has no id of its own; its place and kind name it while the screen is open.
        key: `${index}-${sink.type}`,
        index,
        sink,
        loaded,
        savedNames,
        problems,
        prefix,
        testing: testing === index,
        testResult: results[index],
        onChange: (key: string, value: string) => changeSink(index, key, value),
        onRemove: () => removeSink(index),
        onTest: () => test(index),
      }),
    ),
    h(
      'div',
      { className: 'add-sinks' },
      ...addable.map((type) =>
        h(
          'button',
          { key: type, type: 'button', className: 'quiet', onClick: () => addSink(type) },
          messages.settings.add(messages.settings.sinkNames[type]),
        ),
      ),
    ),
    h('p', { className: 'muted small' }, messages.settings.secretNote),
    h(
      'div',
      { className: 'save-bar' },
      h(
        'button',
        {
          type: 'button',
          className: 'primary',
          onClick: save,
          disabled: !dirty || saving || problems.length > 0,
        },
        saving ? messages.settings.saving : messages.settings.save,
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'quiet',
          onClick: () => {
            setDraft(saved);
            setProblems([]);
            setStatus(undefined);
            setResults({});
          },
          disabled: !dirty || saving,
        },
        messages.settings.reset,
      ),
      problems.length > 0
        ? h(
            'p',
            { className: 'save-status fail', role: 'status' },
            messages.settings.problemsTitle(problems.length),
          )
        : status !== undefined
          ? h('p', { className: `save-status ${status.tone}`, role: 'status' }, status.text)
          : dirty
            ? h('p', { className: 'save-status info', role: 'status' }, messages.settings.unsaved)
            : null,
    ),
  );
}
