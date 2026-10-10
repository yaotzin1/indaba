import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AgentMessage,
  ConsensusOutcome,
  ConsensusResult,
  MessageType,
  Ruling,
  RulingSource,
  Verdict,
} from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { rulingMarkdown, transcriptMarkdown, writeDebateArtifact } from '../src/arbiter/records.js';
import { makeTempDir } from './support.js';

const same = (text: string): string => text;
const result = (...messages: AgentMessage[]): ConsensusResult =>
  new ConsensusResult(ConsensusOutcome.Stalled, 2, messages);

describe('transcriptMarkdown', () => {
  it('lists every message in order with its round, sender and type', () => {
    const text = transcriptMarkdown(
      'debate',
      result(
        new AgentMessage('claude', MessageType.Critique, 'first', 1),
        new AgentMessage('antigravity', MessageType.Agreement, 'second', 1),
      ),
      same,
    );
    expect(text).toContain('# Debate: debate');
    expect(text).toContain('Outcome: stalled after 2 round(s).');
    expect(text.indexOf('first')).toBeLessThan(text.indexOf('second'));
    expect(text).toContain('## Round 1: antigravity (AGREEMENT)');
  });

  it('removes escape sequences and applies the redaction to text and sender', () => {
    const text = transcriptMarkdown(
      'debate',
      result(new AgentMessage('sec\u001b[2Jret', MessageType.Critique, 'pass\u001b[31mword secret', 1)),
      (t) => t.replaceAll('secret', '[redacted]'),
    );
    expect(text).not.toContain('\u001b');
    expect(text).toContain('password [redacted]');
    expect(text).toContain('Round 1: [redacted]');
  });

  it('cannot be closed early by a fence in the message', () => {
    const text = transcriptMarkdown(
      'debate',
      result(new AgentMessage('a', MessageType.Critique, 'before\n```\n# injected heading\n````\nafter', 1)),
      same,
    );
    expect(text).toContain('`````text\nbefore');
    expect(text).toContain('after\n`````');
  });
});

describe('rulingMarkdown', () => {
  const request = {
    stepId: 'debate',
    topic: 't',
    outcome: ConsensusOutcome.Stalled,
    rounds: 3,
    transcript: [],
  };

  it('states the verdict, who decided and the note', () => {
    const text = rulingMarkdown(request, 'human', new Ruling(Verdict.Accept, 'fine'), same);
    expect(text).toContain('Verdict: accept');
    expect(text).toContain('Decided by: human (asked)');
    expect(text).toContain('Debate: stalled after 3 round(s).');
    expect(text).toContain('fine');
  });

  it('says when there was no note and when the ruling came from the ledger', () => {
    const text = rulingMarkdown(request, 'human', new Ruling(Verdict.Reject, '', RulingSource.Memo), same);
    expect(text).toContain('(none)');
    expect(text).toContain('(memo)');
  });
});

describe('writeDebateArtifact', () => {
  it('writes under .indaba/artifacts in the working directory and returns the path', async () => {
    const dir = await makeTempDir();
    const path = await writeDebateArtifact(dir, 'step-1', 'ruling', 'hello');
    expect(path).toBe(join(dir, '.indaba', 'artifacts', 'step-1.ruling.md'));
    expect(await readFile(path, 'utf8')).toBe('hello');
  });

  it.each(['../escape', 'a/b', 'a\\b', '', 'has space', 'x\u0000y'])('refuses the step id %j', async (id) => {
    await expect(writeDebateArtifact(await makeTempDir(), id, 'transcript', 'x')).rejects.toThrow(
      /cannot name a debate record/,
    );
  });

  it('says where it could not write', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, '.indaba'), 'a file where the directory should be');
    await expect(writeDebateArtifact(dir, 'step', 'transcript', 'x')).rejects.toThrow(
      /Could not write the debate record/,
    );
  });
});
