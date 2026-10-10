import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Verdict } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { DecisionLedger, Git, LEDGER_DIRECTORY, type LedgerEntry } from '../src/index.js';
import { makeGitRepo, makeTempDir } from './support.js';

const IDENTITY = ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false'];

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    key: 'k1',
    workflow: 'review',
    stepId: 'debate',
    kind: 'human',
    verdict: Verdict.Accept,
    note: 'ship it',
    outcome: 'max_rounds_exceeded',
    rounds: 4,
    decidedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

async function keyOf(ledger: DecisionLedger, topic = 'is it fine?'): Promise<string> {
  const memo = await ledger.memoKey('review', 'debate', topic);
  if ('skipped' in memo) {
    throw new Error(`no key: ${memo.skipped}`);
  }
  return memo.key;
}

describe('DecisionLedger records', () => {
  it('finds nothing when no ruling was ever recorded', async () => {
    const ledger = new DecisionLedger(await makeTempDir());
    expect(await ledger.lookup('review', 'k1')).toBeUndefined();
  });

  it('appends one line per ruling and finds it by key', async () => {
    const dir = await makeTempDir();
    const ledger = new DecisionLedger(dir);
    await ledger.append(entry());
    await ledger.append(entry({ key: 'k2', note: 'other' }));
    const text = await readFile(ledger.pathOf('review'), 'utf8');
    expect(text.split('\n').filter((l) => l !== '')).toHaveLength(2);
    expect((await ledger.lookup('review', 'k2'))?.note).toBe('other');
    expect(await ledger.lookup('review', 'nope')).toBeUndefined();
  });

  it('lets the newest ruling for a key win and keeps the older line as history', async () => {
    const ledger = new DecisionLedger(await makeTempDir());
    await ledger.append(entry({ verdict: Verdict.Reject, note: 'no' }));
    await ledger.append(entry({ verdict: Verdict.Accept, note: 'yes' }));
    expect((await ledger.lookup('review', 'k1'))?.verdict).toBe('accept');
    expect((await readFile(ledger.pathOf('review'), 'utf8')).split('\n').filter(Boolean)).toHaveLength(2);
  });

  it('never reuses a ruling that has no key', async () => {
    const { key: _omitted, ...withoutKey } = entry();
    const ledger = new DecisionLedger(await makeTempDir());
    await ledger.append(withoutKey);
    expect(await ledger.lookup('review', 'k1')).toBeUndefined();
  });

  it('keeps a workflow name from leaving the ledger directory', async () => {
    const dir = await makeTempDir();
    const ledger = new DecisionLedger(dir);
    expect(ledger.pathOf('../../etc/passwd')).toBe(join(dir, LEDGER_DIRECTORY, '______etc_passwd.jsonl'));
    expect(ledger.pathOf('')).toBe(join(dir, LEDGER_DIRECTORY, 'workflow.jsonl'));
  });

  it.each([
    ['text that is not JSON', 'not json', 'is not valid JSON'],
    ['a JSON array', '[1]', 'is not an object'],
    ['a ruling missing its verdict', '{"workflow":"w","stepId":"s"}', 'does not have the shape of a ruling'],
    [
      'a verdict nobody can give',
      '{"workflow":"w","stepId":"s","kind":"k","verdict":"maybe","note":"","outcome":"o","rounds":1,"decidedAt":"d"}',
      'does not have the shape of a ruling',
    ],
  ])('names the line of %s', async (_label, line, message) => {
    const dir = await makeTempDir();
    const ledger = new DecisionLedger(dir);
    await mkdir(join(dir, LEDGER_DIRECTORY));
    await writeFile(ledger.pathOf('review'), `${JSON.stringify(entry())}\n${line}\n`);
    await expect(ledger.lookup('review', 'k1')).rejects.toThrow(new RegExp(`line 2 ${message}`));
  });

  it('does not take a torn last line for a ruling', async () => {
    const dir = await makeTempDir();
    const ledger = new DecisionLedger(dir);
    await ledger.append(entry());
    await writeFile(ledger.pathOf('review'), `${JSON.stringify(entry())}\n{"workflow":"rev`, { flag: 'w' });
    await expect(ledger.lookup('review', 'k1')).rejects.toThrow(/line 2 is not valid JSON/);
  });

  it('says where it could not write', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, LEDGER_DIRECTORY), 'a file where the directory should be');
    await expect(new DecisionLedger(dir).append(entry())).rejects.toThrow(
      /Could not write the decision ledger/,
    );
  });

  it('says where it could not read', async () => {
    const dir = await makeTempDir();
    const ledger = new DecisionLedger(dir);
    await mkdir(ledger.pathOf('review'), { recursive: true });
    await expect(ledger.lookup('review', 'k1')).rejects.toThrow(/Could not read the decision ledger/);
  });
});

describe('DecisionLedger memoKey', () => {
  it('is the same for the same question on the same code', async () => {
    const ledger = new DecisionLedger(await makeGitRepo());
    expect(await keyOf(ledger)).toBe(await keyOf(ledger));
  });

  it('differs when the question, the step or the workflow differs', async () => {
    const ledger = new DecisionLedger(await makeGitRepo());
    const base = await keyOf(ledger);
    expect(await keyOf(ledger, 'another question')).not.toBe(base);
    const other = await ledger.memoKey('review', 'second', 'is it fine?');
    const renamed = await ledger.memoKey('other', 'debate', 'is it fine?');
    expect('key' in other && other.key).not.toBe(base);
    expect('key' in renamed && renamed.key).not.toBe(base);
  });

  it('cannot be forged by moving text between fields', async () => {
    const ledger = new DecisionLedger(await makeGitRepo());
    const a = await ledger.memoKey('ab', 'c', 'd');
    const b = await ledger.memoKey('a', 'bc', 'd');
    expect('key' in a && 'key' in b && a.key !== b.key).toBe(true);
  });

  it('changes when a committed file changes', async () => {
    const repo = await makeGitRepo();
    const ledger = new DecisionLedger(repo);
    const before = await keyOf(ledger);
    const git = new Git();
    await writeFile(join(repo, 'src', 'app.txt'), 'v2\n');
    await git.run(['add', '-A'], repo);
    await git.run([...IDENTITY, 'commit', '-q', '-m', 'v2'], repo);
    expect(await keyOf(ledger)).not.toBe(before);
  });

  it('is unchanged by committing the ledger itself, and by Indaba writing to .indaba/', async () => {
    const repo = await makeGitRepo();
    const ledger = new DecisionLedger(repo);
    const before = await keyOf(ledger);
    await mkdir(join(repo, '.indaba', 'artifacts'), { recursive: true });
    await writeFile(join(repo, '.indaba', 'artifacts', 'x.md'), 'run output');
    await ledger.append(entry());
    expect(await keyOf(ledger)).toBe(before);

    const git = new Git();
    await git.run(['add', '-f', LEDGER_DIRECTORY], repo);
    await git.run([...IDENTITY, 'commit', '-q', '-m', 'record the ruling'], repo);
    expect(await keyOf(ledger)).toBe(before);
  });

  it('is skipped while a tracked file has uncommitted changes', async () => {
    const repo = await makeGitRepo();
    await writeFile(join(repo, 'src', 'app.txt'), 'edited\n');
    const memo = await new DecisionLedger(repo).memoKey('review', 'debate', 'q');
    expect(memo).toEqual({ skipped: 'the working tree has uncommitted changes' });
  });

  it('is skipped while an untracked file is present', async () => {
    const repo = await makeGitRepo();
    await writeFile(join(repo, 'new.txt'), 'new\n');
    const memo = await new DecisionLedger(repo).memoKey('review', 'debate', 'q');
    expect('skipped' in memo).toBe(true);
  });

  it('is skipped outside a git repository', async () => {
    const memo = await new DecisionLedger(await makeTempDir()).memoKey('review', 'debate', 'q');
    expect(memo).toEqual({ skipped: 'the project is not a git repository with a commit' });
  });
});
