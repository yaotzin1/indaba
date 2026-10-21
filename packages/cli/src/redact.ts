import { createRedactor } from '@indaba/core';

type Environment = Readonly<Record<string, string | undefined>>;

const redactors = new WeakMap<Environment, (text: string) => string>();

/**
 * Credentials never reach the terminal, a file or a trace, even inside an error or an agent's output. The rule is
 * `createRedactor` of `@indaba/core` (specs/logging, T-06): the values of the variables named like a credential, bearer
 * tokens, API-key shapes and a token in a URL. The function built for one environment is kept, so a run that redacts
 * every chunk of output does not rebuild it each time.
 */
export function redact(text: string, env: Environment): string {
  let redactor = redactors.get(env);
  if (redactor === undefined) {
    redactor = createRedactor({ environment: env });
    redactors.set(env, redactor);
  }
  return redactor(text);
}
