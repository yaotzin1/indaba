import { type Logger, type LoggingSettings, noopLogger } from '@indaba/engine';
import { h, type RenderOptions, render } from './ink/adapter.js';
import { type SettingsActions, SettingsApp } from './ink/settings-app.js';

export type { SettingsActions } from './ink/settings-app.js';

export interface SettingsOptions {
  /** The settings in use, as `indaba.config` holds them (or the defaults). */
  readonly settings: LoggingSettings;
  /** The file they are saved to. */
  readonly path: string;
  readonly actions: SettingsActions;
  readonly ascii: boolean;
  readonly color: boolean;
  readonly stdout: NodeJS.WritableStream;
  readonly stdin: NodeJS.ReadableStream;
  /** Records when the screen opens and closes. Nothing at `warn`: that is printed over the screen. */
  readonly logger?: Logger;
}

export interface SettingsResult {
  /** The settings were saved at least once. */
  readonly saved: boolean;
}

/**
 * The Settings screen of logging on the terminal (specs/logging, AC-20, T-13): every setting with its default beside
 * it, checked as it is typed by the same rules as a hand-edited `indaba.config`, a test record through one sink, and
 * Save. Gives the terminal back before it returns or throws.
 */
export async function editLoggingSettings(options: SettingsOptions): Promise<SettingsResult> {
  const logger = options.logger ?? noopLogger;
  let saved = false;
  const renderOptions: RenderOptions = {
    stdout: options.stdout,
    stdin: options.stdin,
    exitOnCtrlC: false,
    patchConsole: false,
    interactive: true,
  };
  logger.info('tui.settings', 'the settings screen opened');
  const instance = render(
    h(SettingsApp, {
      settings: options.settings,
      path: options.path,
      actions: options.actions,
      ascii: options.ascii,
      color: options.color,
      onFinish: (wasSaved: boolean) => {
        saved = wasSaved;
      },
    }),
    renderOptions,
  );
  try {
    await instance.waitUntilExit();
  } finally {
    instance.unmount();
  }
  logger.info('tui.settings', 'the settings screen closed', { saved });
  return { saved };
}
