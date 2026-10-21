import type { LoggingSettings, SinkSettings } from '@indaba/engine';
import { buildSettingsScreen } from '../settings-screen.js';
import {
  check,
  initialSettingsUi,
  markSaved,
  reduceSettings,
  type SettingsKey,
  type SettingsUi,
  selectedSinkSettings,
  withMessage,
} from '../settings-state.js';
import {
  Box,
  h,
  type Key,
  type ReactElement,
  Text,
  useApp,
  useEffect,
  useInput,
  useState,
  useWindowSize,
} from './adapter.js';

/** What the Settings screen asks of whoever opened it: the file, the environment and the sinks are theirs. */
export interface SettingsActions {
  /** Writes the settings to `indaba.config`. Resolves with a sentence for the person; rejects with the reason. */
  save(settings: LoggingSettings): Promise<string>;
  /** Sends one test record through a sink built from these settings. Resolves with how it went. */
  test(sink: SinkSettings): Promise<{ readonly ok: boolean; readonly text: string }>;
  /** Whether a variable is set; never its value. */
  isVariableSet(name: string): boolean;
}

export interface SettingsAppProps {
  readonly settings: LoggingSettings;
  readonly path: string;
  readonly actions: SettingsActions;
  readonly ascii: boolean;
  readonly color: boolean;
  readonly onFinish: (saved: boolean) => void;
}

export function settingsKey(input: string, key: Key): SettingsKey | undefined {
  if (key.ctrl && input === 'c') return 'ctrl-c';
  if (key.upArrow) return 'up';
  if (key.downArrow) return 'down';
  if (key.leftArrow) return 'left';
  if (key.rightArrow) return 'right';
  if (key.return) return 'enter';
  if (key.escape) return 'escape';
  if (key.backspace || key.delete) return 'backspace';
  if (key.ctrl || key.meta || input === '') return undefined;
  return { char: input };
}

const TONE: Readonly<Record<string, string | undefined>> = {
  good: 'green',
  bad: 'red',
  warn: 'yellow',
  info: 'cyan',
  accent: 'magenta',
};

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The Settings screen of logging (specs/logging, AC-20, T-13). */
export function SettingsApp(props: SettingsAppProps): ReactElement {
  const { exit } = useApp();
  const size = useWindowSize();
  const [ui, setUi] = useState<SettingsUi>(() => initialSettingsUi(props.settings));
  const [savedOnce, setSavedOnce] = useState(false);

  useInput((input, key) => {
    const press = settingsKey(input, key);
    if (press !== undefined) {
      setUi((previous) => reduceSettings(previous, press));
    }
  });

  useEffect(() => {
    if (ui.request === 'save') {
      const { settings } = check(ui.draft);
      props.actions.save(settings).then(
        (text) => {
          setSavedOnce(true);
          setUi((previous) => markSaved(previous, text));
        },
        (error: unknown) => setUi((previous) => withMessage(previous, `Not saved: ${reason(error)}`, 'bad')),
      );
    } else if (ui.request === 'test') {
      const sink = selectedSinkSettings(ui);
      if (sink === undefined) {
        setUi((previous) => withMessage(previous, 'Fix the problems of this sink before testing it.', 'bad'));
      } else {
        props.actions.test(sink).then(
          (result) => setUi((previous) => withMessage(previous, result.text, result.ok ? 'good' : 'bad')),
          (error: unknown) =>
            setUi((previous) => withMessage(previous, `The test failed: ${reason(error)}`, 'bad')),
        );
      }
    }
  }, [ui.request]);

  useEffect(() => {
    if (ui.quit) {
      props.onFinish(savedOnce);
      exit();
    }
  }, [ui.quit]);

  const rows = buildSettingsScreen(ui, {
    path: props.path,
    isVariableSet: props.actions.isVariableSet,
    columns: size.columns,
    ascii: props.ascii,
  });
  return h(
    Box,
    { flexDirection: 'column' },
    ...rows.map((row, index) => {
      const color = props.color ? TONE[row.tone] : undefined;
      return h(
        Text,
        {
          key: index,
          wrap: 'truncate',
          ...(color === undefined ? {} : { color }),
          ...(row.tone === 'dim' ? { dimColor: true } : {}),
          ...(row.selected ? { inverse: true } : {}),
        },
        row.text === '' ? ' ' : row.text,
      );
    }),
  );
}
