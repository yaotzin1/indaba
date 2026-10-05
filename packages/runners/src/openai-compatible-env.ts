import { RunnerError } from '@indaba/core';
import { type FetchFunction, OpenAiCompatibleRunner } from './openrouter-runner.js';

const BASE_URL = /^INDABA_OPENAI_COMPAT_([A-Z0-9]+(?:_[A-Z0-9]+)*)_BASE_URL$/;
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface OpenAiCompatibleEnvOptions {
  /** Runner names that may not be taken, normally the names of the built-in runners. */
  readonly reserved?: readonly string[];
  readonly fetch?: FetchFunction;
}

/**
 * Endpoints the person configured in the environment, one runner each:
 *
 * - `INDABA_OPENAI_COMPAT_<NAME>_BASE_URL`  required, e.g. `http://localhost:11434/v1`
 * - `INDABA_OPENAI_COMPAT_<NAME>_KEY_ENV`   the name of the variable that holds the key; absent means keyless
 * - `INDABA_OPENAI_COMPAT_<NAME>_MODEL`     the model used when a role names none
 *
 * `<NAME>` becomes the runner name in lower case with `_` as `-` (`LM_STUDIO` is `lm-studio`). Only
 * the composition root calls this, with the process environment; a workflow file can never add an
 * endpoint, because a base URL in an untrusted file could send the API key somewhere else.
 */
export function openAiCompatibleFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  options: OpenAiCompatibleEnvOptions = {},
): OpenAiCompatibleRunner[] {
  const reserved = new Set(options.reserved ?? []);
  const runners: OpenAiCompatibleRunner[] = [];

  for (const variable of Object.keys(env).sort()) {
    const match = BASE_URL.exec(variable);
    const baseUrl = env[variable];
    if (match === null || baseUrl === undefined || baseUrl.trim() === '') {
      continue;
    }
    const prefix = match[1] ?? '';
    const name = prefix.toLowerCase().replaceAll('_', '-');
    if (reserved.has(name)) {
      throw new RunnerError(
        `${variable}: "${name}" is the name of a built-in runner and cannot be redefined.`,
      );
    }

    const keyEnv = env[`INDABA_OPENAI_COMPAT_${prefix}_KEY_ENV`];
    if (keyEnv !== undefined && keyEnv !== '' && !VARIABLE_NAME.test(keyEnv)) {
      throw new RunnerError(
        `INDABA_OPENAI_COMPAT_${prefix}_KEY_ENV must be the name of an environment variable.`,
      );
    }
    const model = env[`INDABA_OPENAI_COMPAT_${prefix}_MODEL`];
    const keyless = keyEnv === undefined || keyEnv === '';
    runners.push(
      new OpenAiCompatibleRunner({
        name,
        baseUrl: baseUrl.trim(),
        apiKey: keyless ? '' : (env[keyEnv] ?? ''),
        ...(keyless ? { keyless: true } : { apiKeyEnv: keyEnv }),
        ...(model !== undefined && model !== '' ? { defaultModel: model } : {}),
        ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
      }),
    );
  }
  return runners;
}
