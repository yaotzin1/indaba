import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type ConsensusResult, IndabaError, type Ruling, type RulingRequest } from '@indaba/core';
import { sanitize } from '../trace/sanitize.js';

/** Where a step's debate record goes, inside the step's working directory. */
export const ARTIFACT_DIRECTORY = join('.indaba', 'artifacts');

const STEP_ID = /^[A-Za-z0-9_-]+$/;

export type Redact = (text: string) => string;

/** Untrusted text goes into a file a person will read: no escape sequences, no secrets. */
function clean(text: string, redact: Redact): string {
  return redact(sanitize(text));
}

/** A fenced block that the text itself cannot close. */
function fenced(text: string): string {
  let fence = '```';
  while (text.includes(fence)) {
    fence += '`';
  }
  return `${fence}text\n${text}\n${fence}`;
}

/** Every message of the debate in the order it was posted. */
export function transcriptMarkdown(stepId: string, result: ConsensusResult, redact: Redact): string {
  const parts = [
    `# Debate: ${stepId}`,
    `Outcome: ${result.outcome} after ${result.rounds} round(s).`,
    ...result.transcript.map(
      (message) =>
        `## Round ${message.round}: ${clean(message.sender, redact)} (${message.type})\n\n${fenced(clean(message.content, redact))}`,
    ),
  ];
  return `${parts.join('\n\n')}\n`;
}

/** The ruling and the situation it settled. */
export function rulingMarkdown(request: RulingRequest, kind: string, ruling: Ruling, redact: Redact): string {
  const parts = [
    `# Ruling: ${request.stepId}`,
    `Verdict: ${ruling.verdict}`,
    `Decided by: ${clean(kind, redact)} (${ruling.source})`,
    `Debate: ${request.outcome} after ${request.rounds} round(s).`,
    `## Note\n\n${ruling.note === '' ? '(none)' : fenced(clean(ruling.note, redact))}`,
  ];
  return `${parts.join('\n\n')}\n`;
}

/**
 * Writes `<workdir>/.indaba/artifacts/<stepId>.<suffix>.md`. The name is made of a step id that the parser has
 * already restricted to `[A-Za-z0-9_-]`; it is checked again here because this is where a path is built.
 */
export async function writeDebateArtifact(
  workdir: string,
  stepId: string,
  suffix: 'transcript' | 'ruling',
  content: string,
): Promise<string> {
  if (!STEP_ID.test(stepId)) {
    throw new IndabaError(`Step id "${stepId}" cannot name a debate record.`);
  }
  const directory = join(workdir, ARTIFACT_DIRECTORY);
  const path = join(directory, `${stepId}.${suffix}.md`);
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(path, content, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new IndabaError(`Could not write the debate record ${path}: ${reason}`, { cause: error });
  }
  return path;
}
