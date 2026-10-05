import { createInterface } from 'node:readline/promises';
import type { AuthChooser, AuthMethodInfo } from '@indaba/runners';

const MAX_SHOWN = 120;
const ATTEMPTS = 3;

/** What an agent sends is shown on the person's terminal: no control characters, and not too long. */
function plain(text: string): string {
  const cleaned = Array.from(text, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f) ? ' ' : char;
  })
    .join('')
    .trim();
  return cleaned.length > MAX_SHOWN ? `${cleaned.slice(0, MAX_SHOWN)}...` : cleaned;
}

function describe(method: AuthMethodInfo, n: number): string {
  const description = method.description === undefined ? '' : ` - ${plain(method.description)}`;
  return `  ${n}) ${plain(method.name)}${description}  [${plain(method.id)}]\n`;
}

/**
 * Lets a person pick how an agent logs in, as an editor does, when the workflow names no method.
 * Empty input or 0 goes on without logging in (the agent may already be). Anything else is asked
 * again, three times at most. Never used when there is no terminal.
 */
export function terminalAuthChooser(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): AuthChooser {
  return async (agent, methods) => {
    const rl = createInterface({ input, output, terminal: false });
    const closed = new Promise<undefined>((resolve) => rl.once('close', () => resolve(undefined)));
    try {
      output.write(`\n${plain(agent)} offers these ways to log in:\n`);
      output.write('  0) go on without logging in (it may be logged in already)\n');
      for (const [index, method] of methods.entries()) {
        output.write(describe(method, index + 1));
      }
      output.write('Put `auth: <id>` on the agent in the workflow to skip this question.\n');

      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const answer = await Promise.race([rl.question(`Choose 0-${methods.length}: `), closed]);
        if (answer === undefined) {
          return undefined;
        }
        const text = answer.trim();
        if (text === '' || text === '0') {
          return undefined;
        }
        const n = Number(text);
        if (Number.isInteger(n) && n >= 1 && n <= methods.length) {
          return methods[n - 1]?.id;
        }
        output.write('That is not one of the choices.\n');
      }
      return undefined;
    } finally {
      rl.close();
    }
  };
}
