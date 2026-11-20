import { createInterface } from 'node:readline/promises';
import type { InputDescription } from '@indaba/core';
import type { SuppliedInputs } from '@indaba/engine';
import type { AskInputs } from './run-inputs.js';

const MAX_SHOWN = 300;

/** What a workflow file says is shown on the person's terminal: no control characters, and not too long. */
function plain(text: string): string {
  const cleaned = Array.from(text, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f) ? ' ' : char;
  })
    .join('')
    .trim();
  return cleaned.length > MAX_SHOWN ? `${cleaned.slice(0, MAX_SHOWN)}...` : cleaned;
}

/** One plain line that says what an answer looks like, from the declaration's own limits. */
function hint(input: InputDescription): string {
  const { limits } = input;
  switch (input.type) {
    case 'choice':
      return `one of: ${(input.choices ?? []).map(plain).join(', ')}`;
    case 'boolean':
      return 'true or false';
    case 'number': {
      const bounds =
        limits.min !== undefined && limits.max !== undefined
          ? ` from ${limits.min} to ${limits.max}`
          : limits.min !== undefined
            ? ` of at least ${limits.min}`
            : limits.max !== undefined
              ? ` of at most ${limits.max}`
              : '';
      return `${limits.integer === true ? 'a whole number' : 'a number'}${bounds}`;
    }
    case 'path':
      return limits.kind === 'directory'
        ? 'a folder inside the project'
        : limits.kind === 'file'
          ? `a file inside the project${typeof limits.extensions === 'string' ? ` (${limits.extensions})` : ''}`
          : 'a file or folder inside the project';
    default:
      return limits.multiline === true
        ? `text, up to ${limits.maxLength ?? ''} characters; an empty line to finish`
        : `one line of text, up to ${limits.maxLength ?? ''} characters`;
  }
}

/**
 * Asks, in plain words, for each input a run still lacks: its description, what an answer looks like, and for a list
 * "one per line, empty line to finish" (AC-16). An empty answer to a single value is no answer (never an empty value);
 * the caller asks again. Closing the input without an answer gives `undefined`. Never used when there is no terminal.
 */
export function terminalInputAsker(input: NodeJS.ReadableStream, output: NodeJS.WritableStream): AskInputs {
  return async (declarations, missing) => {
    const rl = createInterface({ input, output, terminal: false });
    // Lines are kept as they arrive: a person who pastes several at once must not lose the ones that came before the
    // next question was asked, and a closed input still hands over what it had.
    const buffered: string[] = [];
    let waiting: ((answer: string | undefined) => void) | undefined;
    let ended = false;
    rl.on('line', (text) => {
      if (waiting === undefined) {
        buffered.push(text);
        return;
      }
      const resolve = waiting;
      waiting = undefined;
      resolve(text);
    });
    rl.once('close', () => {
      ended = true;
      waiting?.(undefined);
      waiting = undefined;
    });
    const line = (prompt: string): Promise<string | undefined> => {
      output.write(prompt);
      const next = buffered.shift();
      if (next !== undefined) {
        return Promise.resolve(next);
      }
      if (ended) {
        return Promise.resolve(undefined);
      }
      return new Promise((resolve) => {
        waiting = resolve;
      });
    };
    try {
      const values: Record<string, string[]> = {};
      for (const name of missing) {
        const described = declarations.find((entry) => entry.name === name);
        if (described === undefined) {
          continue;
        }
        output.write(`\n${plain(described.name)}: ${plain(described.description)}\n`);
        output.write(
          `  ${hint(described)}${described.list ? '; one per line, an empty line to finish' : ''}\n`,
        );
        if (described.list) {
          const items: string[] = [];
          for (;;) {
            const answer = await line('> ');
            if (answer === undefined) {
              return undefined;
            }
            if (answer.trim() === '') {
              break;
            }
            items.push(answer);
          }
          if (items.length > 0) {
            values[name] = items;
          }
          continue;
        }
        if (described.limits.multiline === true) {
          const lines: string[] = [];
          for (;;) {
            const answer = await line('> ');
            if (answer === undefined) {
              return undefined;
            }
            if (answer.trim() === '') {
              break;
            }
            lines.push(answer);
          }
          if (lines.length > 0) {
            values[name] = [lines.join('\n')];
          }
          continue;
        }
        const answer = await line('> ');
        if (answer === undefined) {
          return undefined;
        }
        if (answer.trim() !== '') {
          values[name] = [answer];
        }
      }
      return { values } satisfies SuppliedInputs;
    } finally {
      rl.close();
    }
  };
}
