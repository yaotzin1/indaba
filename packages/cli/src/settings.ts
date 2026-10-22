import { parseArgs } from 'node:util';
import { LOGGING_SETTINGS, type Logger, type LoggingSettings, type SinkSettings } from '@indaba/core';
import { readProjectConfig, writeLoggingConfig } from '@indaba/engine';
import type { CommandLogOptions, SinkTestResult } from './log.js';
import type { Io } from './main.js';
import { printableText } from './printable.js';
import type { TuiLoad } from './tui-loader.js';

export const SETTINGS_USAGE = `Usage: indaba settings [options]

Show and change the logging settings of the project (the logging: section of indaba.config). On a terminal, with
@indaba/tui installed, it opens the Settings screen: every setting with its default beside it, checked as you type,
a test record through one sink (t) and Save (s). Anywhere else, and with --plain, it prints the settings in use.
A collector's credential is entered as the NAME of an environment variable; its value is never shown or saved.

Options:
  -w, --workdir <dir>   The project directory (default: .)
      --plain           Print the settings instead of opening the screen
      --ascii           Draw the screen without box characters
`;

export interface SettingsCommandOptions {
  readonly logger: Logger;
  readonly loadTui: () => Promise<TuiLoad>;
  readonly noColor: boolean;
  /** Builds the logger options of the project, for a test record. */
  readonly sinkOptions: (root: string) => CommandLogOptions;
  readonly testSink: (sink: SinkSettings, options: CommandLogOptions) => Promise<SinkTestResult>;
  /** Whether a variable is set and not empty; main answers, since only it reads the environment. */
  readonly isVariableSet: (name: string) => boolean;
}

class SettingsUsage extends Error {}

function parse(args: readonly string[]) {
  try {
    const { values, positionals } = parseArgs({
      args: [...args],
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        workdir: { type: 'string', short: 'w' },
        plain: { type: 'boolean' },
        ascii: { type: 'boolean' },
      },
    });
    if (positionals.length > 0) {
      throw new SettingsUsage(`Unexpected argument: ${positionals.join(' ')}`);
    }
    return {
      help: values.help === true,
      workdir: values.workdir ?? '.',
      plain: values.plain === true,
      ascii: values.ascii === true,
    };
  } catch (error) {
    throw error instanceof SettingsUsage
      ? error
      : new SettingsUsage(error instanceof Error ? error.message : String(error));
  }
}

/** The settings in use as plain lines: `key  value  (default ...)`, one sink after another. */
export function settingsLines(settings: LoggingSettings, path: string, present: boolean): string[] {
  const describe = (key: string): string => LOGGING_SETTINGS.find((s) => s.key === key)?.label ?? key;
  const lines = [
    `Logging settings (${present ? printableText(path) : `${printableText(path)}, not written yet: all defaults`})`,
  ];
  lines.push(`  level: ${settings.level}  (default info)`);
  settings.sinks.forEach((sink, index) => {
    lines.push(`  sinks[${index}]: ${sink.type}, level ${sink.level}`);
    if (sink.type === 'file') {
      lines.push(`    ${describe('file.folder')}: ${printableText(sink.folder)}`);
      lines.push(`    ${describe('file.maxFileBytes')}: ${sink.maxFileBytes}`);
      lines.push(`    ${describe('file.maxFiles')}: ${sink.maxFiles}`);
    } else if (sink.type === 'gelf' || sink.type === 'http-json') {
      lines.push(`    address: ${printableText(sink.address)}`);
      if (sink.secretEnv !== undefined) {
        lines.push(`    ${describe('remote.secretEnv')}: ${sink.secretEnv}`);
      }
      lines.push(`    queue ${sink.queueLength}, timeout ${sink.timeoutSeconds} s, retries ${sink.retries}`);
    }
  });
  return lines;
}

/** `indaba settings`: see the usage text. Returns the exit status. */
export async function settingsCommand(
  args: readonly string[],
  io: Io,
  root: (workdir: string) => string,
  options: SettingsCommandOptions,
): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(args);
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${SETTINGS_USAGE}`);
    return 2;
  }
  if (parsed.help) {
    io.stdout.write(SETTINGS_USAGE);
    return 0;
  }
  const project = root(parsed.workdir);
  const config = await readProjectConfig(project);
  if (config.problems.length > 0) {
    io.stdout.write(`${config.path} is invalid:\n${config.problems.map((p) => ` - ${p}`).join('\n')}\n`);
    return 1;
  }

  if (io.terminal !== undefined && !parsed.plain) {
    const loaded = await options.loadTui();
    if ('tui' in loaded && loaded.tui.editLoggingSettings !== undefined) {
      const result = await loaded.tui.editLoggingSettings({
        settings: config.logging.settings,
        path: config.path,
        ascii: parsed.ascii,
        color: !options.noColor,
        stdout: io.terminal.stdout,
        stdin: io.terminal.stdin,
        logger: options.logger,
        actions: {
          save: async (settings) => {
            const path = await writeLoggingConfig(project, settings);
            options.logger.info('cli.settings', 'the logging settings were saved', { path });
            return `Saved to ${path}. The next command uses them.`;
          },
          test: (sink) => options.testSink(sink, options.sinkOptions(project)),
          isVariableSet: options.isVariableSet,
        },
      });
      io.stdout.write(result.saved ? `Logging settings saved to ${config.path}\n` : 'Nothing was saved.\n');
      return 0;
    }
    io.stderr.write(
      'The Settings screen needs @indaba/tui (npm install @indaba/tui); printing the settings. --plain hides this.\n',
    );
  }
  io.stdout.write(`${settingsLines(config.logging.settings, config.path, config.present).join('\n')}\n`);
  return 0;
}
