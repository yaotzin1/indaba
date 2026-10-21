/**
 * The shapes the local web API uses for the logging settings (specs/logging, AC-20, AC-21). Beside the settings rather
 * than in `web-contract`, which holds only the run view and imports nothing from outside its folder.
 */
import type { LoggingSettings, SettingDescription, SinkType } from './settings.js';

/**
 * The logging settings of the project `indaba ui` was started in (specs/logging, AC-20, AC-21). A secret is the name of
 * an environment variable; `variables` says which of the names in the settings are set in the server's environment,
 * never what they hold.
 */
export interface LoggingSettingsResponse {
  readonly settings: LoggingSettings;
  /** The file the settings live in, for the person to recognise. */
  readonly path: string;
  /** False when the project has no `indaba.config` yet and every value is a default. */
  readonly present: boolean;
  readonly variables: Readonly<Record<string, boolean>>;
  /** The one description of the settings (`LOGGING_SETTINGS`): labels, help, minimums; the page keeps no copy. */
  readonly descriptions: readonly SettingDescription[];
  /** What each kind of sink takes when a key is left out (`SINK_DEFAULTS`), shown as "default" beside a value. */
  readonly sinkDefaults: Readonly<Record<SinkType, Readonly<Record<string, string | number>>>>;
}

/** `POST /api/v1/settings/logging/check`: the problems of a draft, by the same rules as saving; nothing is written. */
export interface LoggingSettingsCheckResponse {
  readonly problems: readonly string[];
}

/** `PUT /api/v1/settings/logging`: the `logging:` section as the file would hold it. */
export interface LoggingSettingsRequest {
  readonly logging: unknown;
}

/** `POST /api/v1/settings/logging/test`: one sink entry as the file would hold it. */
export interface SinkTestRequest {
  readonly sink: unknown;
}

export interface SinkTestResponse {
  readonly ok: boolean;
  /** One plain sentence: delivered, written, or why not. */
  readonly text: string;
}
