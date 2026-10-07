/**
 * Environment values that look like credentials never reach the terminal, a file or a trace, even inside an
 * error or an agent's output. The rule is by variable name (key, token, secret, password, credential) and a
 * value of at least four characters, so a short flag such as `1` is never treated as a secret.
 */
export function redact(text: string, env: Readonly<Record<string, string | undefined>>): string {
  let out = text;
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value.length >= 4 && /key|token|secret|password|credential/i.test(key)) {
      out = out.split(value).join('[redacted]');
    }
  }
  return out;
}
