/**
 * The redaction every record passes before a sink sees it (specs/logging, AC-05, T-06), and every other outgoing text
 * the command line redacts: a trace, an event, an error on the screen. Pure: the environment arrives as a value, so
 * core reads none. What it removes:
 *
 * - the values of environment variables named like a credential (key, token, secret, password, credential),
 *   four characters or longer so a flag such as `1` is never taken for a secret, and any extra value named by the caller
 *   (a log collector's credential read from a variable with any name);
 * - a bearer or basic credential (`Bearer <token>`, `Authorization: Basic <value>`);
 * - text shaped like a provider's API key or token (OpenAI-style `sk-`, GitHub, GitLab, Slack, AWS, Google, a JWT, a
 *   private key block);
 * - the value of a `token`, `access_token`, `api_key`, `key`, `secret` or `password` parameter in a URL query or
 *   fragment, which is how `indaba ui` hands its token to the page (`#token=`);
 * - the password of a URL's user information (`scheme://user:password@host`).
 *
 * A shape that is not here reaches the record. The rule for a new one (specs/logging, section 5): add it here with its
 * test, never work around it in a sink.
 */

export const REDACTED = '[redacted]';

/** Names of environment variables whose values are treated as secrets. */
const SECRET_NAME = /key|token|secret|password|passwd|credential/i;

/** The shortest value taken for a secret, so a short flag (`1`, `yes`) is never replaced everywhere. */
const MIN_SECRET_LENGTH = 4;

interface Shape {
  readonly pattern: RegExp;
  readonly replace: (match: string, ...groups: string[]) => string;
}

const whole = (): string => REDACTED;

/**
 * The shapes. Each pattern is global; a replacement keeps the part that says what was there (the scheme, the
 * parameter name), so a reader still sees that a credential was present.
 */
const SHAPES: readonly Shape[] = [
  // A PEM private key block, begin to end.
  {
    pattern: /-{5}BEGIN [A-Z ]*PRIVATE KEY-{5}[\s\S]*?(?:-{5}END [A-Z ]*PRIVATE KEY-{5}|$)/g,
    replace: whole,
  },
  // `Authorization: Bearer x`, `Authorization: Basic x`, `authorization=...`, in headers, dumps and messages.
  {
    pattern:
      /\b(authorization|proxy-authorization)(["']?\s*[:=]\s*["']?)(?:(bearer|basic|token|digest)\s+)?[^\s"',;]+/gi,
    replace: (_m, name, separator, scheme) =>
      `${name}${separator}${scheme === undefined ? '' : `${scheme} `}${REDACTED}`,
  },
  // A bare `Bearer x` anywhere else.
  { pattern: /\b(bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, replace: (_m, word) => `${word} ${REDACTED}` },
  // A JSON Web Token: three base64url parts, the first two starting with `{"`.
  { pattern: /\beyJ[A-Za-z0-9_-]{6,}\.eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*/g, replace: whole },
  // OpenAI-style keys, Anthropic's and OpenRouter's included.
  { pattern: /\bsk-[A-Za-z0-9_-]{16,}/g, replace: whole },
  // GitHub tokens (classic, OAuth, app, refresh) and fine-grained ones.
  { pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, replace: whole },
  // GitLab personal tokens.
  { pattern: /\bglpat-[A-Za-z0-9_-]{16,}/g, replace: whole },
  // Slack tokens.
  { pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, replace: whole },
  // AWS access key ids.
  { pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replace: whole },
  // Google API keys.
  { pattern: /\bAIza[0-9A-Za-z_-]{30,}/g, replace: whole },
  // A credential in a URL query or fragment: `#token=`, `?access_token=`, `&api_key=`.
  {
    pattern:
      /([?#&;](?:token|access_token|id_token|refresh_token|api[_-]?key|key|secret|password|auth)=)[^&#\s"'<>]+/gi,
    replace: (_m, prefix) => `${prefix}${REDACTED}`,
  },
  // The password of a URL's user information: `https://user:password@host`.
  {
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi,
    replace: (_m, prefix) => `${prefix}${REDACTED}@`,
  },
];

/** The values of the variables named like a credential, longest first so an overlapping shorter one cannot split it. */
export function secretValuesOf(environment: Readonly<Record<string, string | undefined>>): string[] {
  const values = new Set<string>();
  for (const [name, value] of Object.entries(environment)) {
    if (value !== undefined && value.length >= MIN_SECRET_LENGTH && SECRET_NAME.test(name)) {
      values.add(value);
    }
  }
  return sortedValues(values);
}

function sortedValues(values: Iterable<string>): string[] {
  return [...values].filter((value) => value.length >= MIN_SECRET_LENGTH).sort((a, b) => b.length - a.length);
}

export interface RedactorOptions {
  /** The environment of the command; the values of the variables named like a credential are removed. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
  /** Further values to remove whatever their variable is called, such as a log collector's credential. */
  readonly values?: readonly string[];
}

/** Builds the redaction function. The secret values are taken once, so the function is cheap to call per record. */
export function createRedactor(options: RedactorOptions = {}): (text: string) => string {
  const values = sortedValues(
    new Set([...secretValuesOf(options.environment ?? {}), ...(options.values ?? [])]),
  );
  return (text) => {
    let out = text;
    for (const value of values) {
      if (out.includes(value)) {
        out = out.split(value).join(REDACTED);
      }
    }
    for (const shape of SHAPES) {
      out = out.replace(shape.pattern, shape.replace);
    }
    return out;
  };
}
