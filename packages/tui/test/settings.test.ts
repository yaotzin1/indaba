import { defaultLoggingSettings, type LoggingSettings, type SinkSettings } from '@indaba/engine';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.FORCE_COLOR = '1';
  process.env.CI = 'true';
});

import {
  buildSettingsScreen,
  checkSettingsDraft,
  editLoggingSettings,
  initialSettingsUi,
  isDirty,
  reduceSettings,
  rowsOf,
  type SettingsKey,
  type SettingsUi,
  selectedSinkSettings,
} from '../src/index.js';
import { settingsKey } from '../src/ink/settings-app.js';
import { FakeStdin, FakeStdout, KEY, until } from './terminal.js';

const press = (ui: SettingsUi, ...keys: SettingsKey[]): SettingsUi => keys.reduce(reduceSettings, ui);
const char = (c: string): SettingsKey => ({ char: c });
const type = (ui: SettingsUi, text: string): SettingsUi => press(ui, ...[...text].map(char));

/** Moves the cursor to the row that `match` finds. */
function goTo(ui: SettingsUi, match: (label: string) => boolean): SettingsUi {
  const rows = buildSettingsScreen(ui, { path: 'p', isVariableSet: () => false, columns: 200, ascii: true });
  const index = rows.slice(2).findIndex((r) => match(r.text));
  if (index < 0) {
    throw new Error('no such row');
  }
  return { ...ui, cursor: index };
}

const screenText = (ui: SettingsUi, isVariableSet = (_name: string) => false): string =>
  buildSettingsScreen(ui, { path: '/p/indaba.config', isVariableSet, columns: 200, ascii: true })
    .map((r) => r.text)
    .join('\n');

describe('the Settings screen state', () => {
  it('starts from the settings in use, with every default beside its value', () => {
    const ui = initialSettingsUi(defaultLoggingSettings());
    const text = screenText(ui);
    expect(text).toContain('Level of the whole log');
    expect(text).toMatch(/Log folder\s+\.indaba\/logs\s+default: \.indaba\/logs/);
    expect(text).toMatch(/Largest log file \(bytes\)\s+10485760\s+default: 10485760/);
    expect(text).toContain('Add: GELF collector (Graylog)');
    expect(text).not.toContain('(not saved)');
    expect(isDirty(ui)).toBe(false);
  });

  it('cycles a level with the arrows and restores its default with d', () => {
    let ui = initialSettingsUi(defaultLoggingSettings());
    ui = press(ui, 'right');
    expect(ui.draft.level).toBe('debug');
    ui = press(ui, 'right', 'left', 'left');
    expect(ui.draft.level).toBe('info');
    ui = press(ui, 'left', char('d'));
    expect(ui.draft.level).toBe('info');
  });

  it('checks a value as it is typed, by the same rules as the file, and refuses to save it', () => {
    let ui = initialSettingsUi(defaultLoggingSettings());
    ui = goTo(ui, (t) => t.includes('Log files kept'));
    ui = press(ui, 'enter', 'backspace', 'backspace');
    ui = type(ui, 'ten');
    expect(screenText(ui)).toContain('ten_');
    ui = press(ui, 'enter');
    expect(checkSettingsDraft(ui.draft).problems).toEqual([
      'sinks[0].maxFiles must be a whole number of at least 1',
    ]);
    expect(screenText(ui)).toContain('! sinks[0].maxFiles must be a whole number of at least 1');
    ui = press(ui, char('s'));
    expect(ui.request).toBeUndefined();
    expect(ui.message?.tone).toBe('bad');
    ui = press(ui, char('d'), char('s'));
    expect(ui.request).toBe('save');
  });

  it('cancels typing with escape, and drops control characters', () => {
    let ui = goTo(initialSettingsUi(defaultLoggingSettings()), (t) => t.includes('Log folder'));
    ui = press(ui, 'enter', char('\u001b[31m'), char('x'), 'escape');
    expect(ui.draft.sinks[0]?.values.folder).toBe('.indaba/logs');
    ui = press(ui, 'enter', char('\u0007'), char('/more'), 'enter');
    expect(ui.draft.sinks[0]?.values.folder).toBe('.indaba/logs/more');
    ui = press(ui, 'enter', 'ctrl-c');
    expect(ui.editing).toBeUndefined();
  });

  it('adds a collector, asks for its address, and removes a sink with x', () => {
    let ui = goTo(initialSettingsUi(defaultLoggingSettings()), (t) => t.includes('Add: HTTP JSON collector'));
    ui = press(ui, 'enter');
    expect(ui.draft.sinks.map((s) => s.type)).toEqual(['file', 'stderr', 'http-json']);
    expect(checkSettingsDraft(ui.draft).problems).toEqual([
      'sinks[2].address must be an address starting with http:// or https://',
    ]);
    ui = press(ui, 'enter');
    ui = type(ui, 'https://logs.test/in');
    ui = press(ui, 'enter');
    expect(checkSettingsDraft(ui.draft).problems).toEqual([]);
    expect(isDirty(ui)).toBe(true);
    expect(screenText(ui)).toContain('(not saved)');
    ui = goTo(ui, (t) => t.trim() === 'Terminal (standard error)');
    ui = press(ui, char('x'));
    expect(ui.draft.sinks.map((s) => s.type)).toEqual(['file', 'http-json']);
    expect(screenText(ui)).toContain('Add: Terminal (standard error)');
  });

  it('shows whether the variable of a secret is set, never its value', () => {
    const settings: LoggingSettings = {
      level: 'info',
      sinks: [
        {
          type: 'gelf',
          level: 'info',
          address: 'udp://g.test:1',
          secretEnv: 'G_TOKEN',
          queueLength: 1,
          timeoutSeconds: 1,
          retries: 0,
        },
      ],
    };
    const ui = initialSettingsUi(settings);
    expect(screenText(ui, (name) => name === 'G_TOKEN')).toContain('G_TOKEN (set)');
    expect(screenText(ui)).toContain('G_TOKEN (not set)');
  });

  it('asks for a test of the selected sink only when it has no problem', () => {
    let ui = initialSettingsUi(defaultLoggingSettings());
    ui = press(ui, char('t'));
    expect(ui.request).toBeUndefined();
    ui = goTo(ui, (t) => t.trim() === 'Log files');
    ui = press(ui, char('t'));
    expect(ui.request).toBe('test');
    expect(selectedSinkSettings(ui)).toMatchObject({ type: 'file', folder: '.indaba/logs' });
    ui = goTo(ui, (t) => t.includes('Add: GELF'));
    ui = press(ui, 'enter', char('t'));
    expect(ui.request).toBeUndefined();
    expect(ui.message?.text).toContain('Fix the problems');
    expect(selectedSinkSettings(ui)).toBeUndefined();
  });

  it('asks before leaving with unsaved changes', () => {
    let ui = press(initialSettingsUi(defaultLoggingSettings()), 'right', char('q'));
    expect(ui.confirmQuit).toBe(true);
    expect(screenText(ui)).toContain('Leave without saving?');
    ui = press(ui, char('z'), char('n'));
    expect(ui.confirmQuit).toBe(false);
    ui = press(ui, 'escape', 'escape');
    expect(ui.quit).toBe(false);
    ui = press(ui, char('q'), char('y'));
    expect(ui.quit).toBe(true);
    expect(press(initialSettingsUi(defaultLoggingSettings()), 'ctrl-c').quit).toBe(true);
  });

  it('keeps the cursor on the rows that exist', () => {
    let ui = initialSettingsUi(defaultLoggingSettings());
    ui = press(ui, 'up', char('k'));
    expect(ui.cursor).toBe(0);
    for (let i = 0; i < 40; i += 1) {
      ui = press(ui, char('j'));
    }
    expect(ui.cursor).toBe(rowsOf(ui.draft).length - 1);
  });

  it('names its keys', () => {
    const none = {
      upArrow: false,
      downArrow: false,
      leftArrow: false,
      rightArrow: false,
      return: false,
      escape: false,
      backspace: false,
      delete: false,
      ctrl: false,
      meta: false,
    };
    const k = (over: Partial<typeof none>) =>
      ({ ...none, ...over }) as unknown as Parameters<typeof settingsKey>[1];
    expect(settingsKey('c', k({ ctrl: true }))).toBe('ctrl-c');
    expect(settingsKey('', k({ leftArrow: true }))).toBe('left');
    expect(settingsKey('', k({ rightArrow: true }))).toBe('right');
    expect(settingsKey('', k({ delete: true }))).toBe('backspace');
    expect(settingsKey('', k({}))).toBeUndefined();
    expect(settingsKey('x', k({}))).toEqual({ char: 'x' });
  });
});

describe('editLoggingSettings on a terminal', () => {
  it('saves, tests a sink and gives the terminal back', async () => {
    const stdout = new FakeStdout(160, 40);
    const stdin = new FakeStdin();
    const saved: LoggingSettings[] = [];
    const tested: SinkSettings[] = [];
    const done = editLoggingSettings({
      settings: defaultLoggingSettings(),
      path: '/project/indaba.config',
      ascii: true,
      color: false,
      stdout: stdout as unknown as NodeJS.WritableStream,
      stdin: stdin as unknown as NodeJS.ReadableStream,
      actions: {
        save: async (s) => {
          saved.push(s);
          return 'Saved to /project/indaba.config.';
        },
        test: async (s) => {
          tested.push(s);
          return { ok: true, text: 'The test record was written.' };
        },
        isVariableSet: () => false,
      },
    });
    await until(() => stdout.text.includes('Logging settings'));
    stdin.type('\u001b[C');
    await until(() => stdout.text.includes('(not saved)'));
    stdin.type('s');
    await until(() => stdout.text.includes('Saved to /project/indaba.config.'));
    stdin.type(KEY.down);
    stdin.type('t');
    await until(() => stdout.text.includes('The test record was written.'));
    stdin.type('q');
    const result = await done;
    expect(result).toEqual({ saved: true });
    expect(saved[0]?.level).toBe('debug');
    expect(tested[0]?.type).toBe('file');
    expect(stdin.rawMode).toBe(false);
  });

  it('says when saving fails, and leaves without saving', async () => {
    const stdout = new FakeStdout(160, 40);
    const stdin = new FakeStdin();
    const done = editLoggingSettings({
      settings: defaultLoggingSettings(),
      path: 'indaba.config',
      ascii: false,
      color: true,
      stdout: stdout as unknown as NodeJS.WritableStream,
      stdin: stdin as unknown as NodeJS.ReadableStream,
      actions: {
        save: () => Promise.reject(new Error('read-only folder')),
        test: () => Promise.reject(new Error('unused')),
        isVariableSet: () => false,
      },
    });
    await until(() => stdout.text.includes('Logging settings'));
    stdin.type('\u001b[C');
    stdin.type('s');
    await until(() => stdout.text.includes('Not saved: read-only folder'));
    stdin.type(KEY.down);
    stdin.type('t');
    await until(() => stdout.text.includes('The test failed: unused'));
    stdin.type(KEY.escape);
    await until(() => stdout.text.includes('Leave without saving?'));
    stdin.type('y');
    expect(await done).toEqual({ saved: false });
  });
});
