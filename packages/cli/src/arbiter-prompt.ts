import { createInterface } from 'node:readline/promises';
import { type Adjudicator, Ruling, type RulingRequest, Verdict } from '@indaba/core';
import { printableText } from './printable.js';

/** A message is shown up to this long; the whole text is in the transcript file the person can open. */
const MAX_SHOWN = 3000;
const MAX_NOTE = 2000;
const ATTEMPTS = 3;

function shown(text: string): string {
  const clean = printableText(text).trim();
  return clean.length > MAX_SHOWN
    ? `${clean.slice(0, MAX_SHOWN)}\n... (cut; the rest is in the transcript file)`
    : clean;
}

function verdictOf(answer: string): Verdict | undefined {
  switch (answer.trim().toLowerCase()) {
    case 'a':
    case 'accept':
      return Verdict.Accept;
    case 'r':
    case 'reject':
      return Verdict.Reject;
    default:
      return undefined;
  }
}

function describe(request: RulingRequest): string {
  const lines = [
    '',
    `The debate in step "${printableText(request.stepId)}" ended without consensus (${request.outcome} after ${request.rounds} round(s)).`,
    '',
  ];
  for (const message of request.transcript) {
    lines.push(
      `--- round ${message.round}: ${printableText(message.sender)} (${message.type})`,
      shown(message.content),
      '',
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Asks the person at the terminal to rule on a debate that failed: `accept` or `reject`, then an optional note.
 * Anything else is asked again, three times at most. If the input closes, the run is cancelled or the answers never
 * come out right, it returns null and the step escalates as it always did. Only used when there is a terminal.
 */
export function terminalAdjudicator(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Adjudicator {
  return {
    async rule(request, signal) {
      if (signal?.aborted === true) {
        return null;
      }
      const rl = createInterface({ input, output, terminal: false });
      const gone = new Promise<undefined>((resolve) => {
        rl.once('close', () => resolve(undefined));
        signal?.addEventListener('abort', () => resolve(undefined), { once: true });
      });
      try {
        output.write(describe(request));
        for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
          const answer = await Promise.race([rl.question('Rule on it: accept or reject? [a/r] '), gone]);
          if (answer === undefined) {
            return null;
          }
          const verdict = verdictOf(answer);
          if (verdict === undefined) {
            output.write('Answer "accept" (a) or "reject" (r).\n');
            continue;
          }
          const note = await Promise.race([rl.question('Note, one line (optional): '), gone]);
          if (note === undefined) {
            return null;
          }
          return new Ruling(verdict, note.trim().slice(0, MAX_NOTE));
        }
        return null;
      } finally {
        rl.close();
      }
    },
  };
}
