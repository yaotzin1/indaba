import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConsensusResult, DiscussionMessage, DiscussionRuling, DiscussionView } from '@indaba/core';
import { isRunId } from '../trace/records.js';
import { sanitize } from '../trace/sanitize.js';

/** Where the discussions of a project's debates are kept unless the person chooses another folder. */
export const DISCUSSION_DIRECTORY = join('.indaba', 'discussions');

const STEP_ID = /^[A-Za-z0-9_-]+$/;

export type Redact = (text: string) => string;

/** The discussion of a finished debate, redacted and with control sequences dropped. */
export function discussionOf(
  stepId: string,
  result: ConsensusResult,
  redact: Redact,
  ruling?: DiscussionRuling,
): DiscussionView {
  const clean = (text: string): string => redact(sanitize(text));
  return {
    stepId,
    outcome: result.outcome,
    rounds: result.rounds,
    messages: result.transcript.map((message) => ({
      round: message.round,
      sender: clean(message.sender),
      type: clean(message.type),
      content: clean(message.content),
    })),
    ...(ruling === undefined
      ? {}
      : {
          ruling: {
            verdict: clean(ruling.verdict),
            decidedBy: clean(ruling.decidedBy),
            note: clean(ruling.note),
          },
        }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageOf(value: unknown): DiscussionMessage | undefined {
  if (
    !isRecord(value) ||
    typeof value.round !== 'number' ||
    !Number.isInteger(value.round) ||
    typeof value.sender !== 'string' ||
    typeof value.type !== 'string' ||
    typeof value.content !== 'string'
  ) {
    return undefined;
  }
  return {
    round: value.round,
    sender: sanitize(value.sender),
    type: sanitize(value.type),
    content: sanitize(value.content),
  };
}

function rulingOf(value: unknown): DiscussionRuling | undefined {
  if (
    !isRecord(value) ||
    typeof value.verdict !== 'string' ||
    typeof value.decidedBy !== 'string' ||
    typeof value.note !== 'string'
  ) {
    return undefined;
  }
  return {
    verdict: sanitize(value.verdict),
    decidedBy: sanitize(value.decidedBy),
    note: sanitize(value.note),
  };
}

/**
 * The debates of a project's runs, one file per run and step: `<directory>/<traceId>.<stepId>.json`. The ids are
 * checked where the path is built, the file is read as data and validated, and every string is cleaned again on the
 * way out, because the file is something a person can edit.
 */
export class DiscussionStore {
  constructor(readonly directory: string) {}

  private pathOf(traceId: string, stepId: string): string | undefined {
    return isRunId(traceId) && STEP_ID.test(stepId)
      ? join(this.directory, `${traceId}.${stepId}.json`)
      : undefined;
  }

  /** Keeps a discussion. It never throws: a discussion is an extra, and losing one must not fail the debate. */
  async save(traceId: string, view: DiscussionView): Promise<boolean> {
    const path = this.pathOf(traceId, view.stepId);
    if (path === undefined) {
      return false;
    }
    try {
      await mkdir(this.directory, { recursive: true });
      await writeFile(path, `${JSON.stringify(view, null, 2)}\n`, 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  /** The kept discussion of one step of one run, or undefined when there is none or the file is not one. */
  async read(traceId: string, stepId: string): Promise<DiscussionView | undefined> {
    const path = this.pathOf(traceId, stepId);
    if (path === undefined) {
      return undefined;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      return undefined;
    }
    if (
      !isRecord(parsed) ||
      typeof parsed.outcome !== 'string' ||
      typeof parsed.rounds !== 'number' ||
      !Array.isArray(parsed.messages)
    ) {
      return undefined;
    }
    const messages: DiscussionMessage[] = [];
    for (const raw of parsed.messages) {
      const message = messageOf(raw);
      if (message === undefined) {
        return undefined;
      }
      messages.push(message);
    }
    const ruling = parsed.ruling === undefined ? undefined : rulingOf(parsed.ruling);
    return {
      stepId,
      outcome: sanitize(parsed.outcome),
      rounds: parsed.rounds,
      messages,
      ...(ruling === undefined ? {} : { ruling }),
    };
  }
}
