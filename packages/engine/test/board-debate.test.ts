import {
  AdjudicatorRegistry,
  BoardKind,
  DecisionType,
  Isolation,
  McpPolicy,
  Ruling,
  RunBoard,
  RunResult,
  SimpleEventDispatcher,
  type StepDefinition,
  Tracer,
  Verdict,
  type WorkflowDefinition,
} from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { DecisionLedger, GuardRegistry, StepExecutor } from '../src/index.js';
import { FakeRegistry, FakeRunner, FixedClock, makeGitRepo, SequenceIds } from './support.js';

const SECRET = ['sk', 'live', '0123456789'].join('-');

function debate(overrides: Partial<StepDefinition> = {}): StepDefinition {
  return {
    id: 'debate',
    role: 'a',
    goal: 'Is src fine?',
    dependsOn: [],
    inputArtifacts: [],
    outputs: [],
    commands: [],
    guards: [],
    isolation: Isolation.None,
    consensusWith: ['b'],
    decisionType: DecisionType.Consensus,
    mcp: [],
    ...overrides,
  };
}

const workflow: WorkflowDefinition = {
  version: '1.0',
  name: 'review',
  artifacts: {},
  roles: {
    a: { name: 'a', runner: 'ra', mcp: [] },
    b: { name: 'b', runner: 'rb', mcp: [] },
  },
  steps: [],
  mcpServers: {},
  defaultMcpPolicy: McpPolicy.Required,
};

const says = (name: string, ...replies: string[]): FakeRunner =>
  new FakeRunner(
    name,
    (_request, n) =>
      new RunResult({ exitCode: 0, output: replies[n - 1] ?? replies.at(-1) ?? 'AGREEMENT: ok' }),
  );

async function fixture(
  runners: FakeRunner[],
  options: { ruling?: Ruling; ledger?: boolean; repo?: string } = {},
) {
  const repo = options.repo ?? (await makeGitRepo());
  const adjudicators = new AdjudicatorRegistry();
  if (options.ruling !== undefined) {
    const ruling = options.ruling;
    adjudicators.register('human', { rule: async () => ruling });
  }
  const tracer = new Tracer(new FixedClock(), new SimpleEventDispatcher(), new SequenceIds());
  const executor = new StepExecutor({
    runners: new FakeRegistry(runners),
    guards: new GuardRegistry(),
    tracer,
    adjudicators,
    ...(options.ledger === true ? { ledger: new DecisionLedger(repo), clock: new FixedClock() } : {}),
    redact: (text) => text.split(SECRET).join('[redacted]'),
  });
  const board = new RunBoard({
    traceId: 'abc',
    workflow: 'review',
    clock: new FixedClock(),
    redact: (text) => text.split(SECRET).join('[redacted]'),
  });
  const span = await tracer.startTrace('root');
  const run = (step: StepDefinition, attempt = 1) =>
    executor.run(step, workflow, repo, span, { board, attempt });
  return { board, run, repo };
}

const shown = (board: RunBoard) =>
  board.entries({ states: ['pending', 'accepted', 'discarded', 'superseded'] });

describe('a debate on the run board', () => {
  it('mirrors every message in order with its round and sender, then the outcome, all accepted', async () => {
    const { board, run } = await fixture([
      says('ra', 'PROPOSAL: use a map', 'AGREEMENT: fine'),
      says('rb', 'CRITIQUE: a map leaks', 'AGREEMENT: fine'),
    ]);
    expect((await run(debate())).ok).toBe(true);
    const entries = shown(board);
    expect(entries.map((e) => [e.kind, e.sender, e.round, e.text, e.source])).toEqual([
      [BoardKind.Proposal, 'a', 1, 'use a map', 'engine'],
      [BoardKind.Critique, 'b', 1, 'a map leaks', 'engine'],
      [BoardKind.Agreement, 'a', 2, 'fine', 'engine'],
      [BoardKind.Agreement, 'b', 2, 'fine', 'engine'],
      [BoardKind.Result, 'a', undefined, 'reached after 2 round(s)', 'engine'],
    ]);
    expect(entries.map((e) => board.stateOf(e))).toEqual(Array(5).fill('accepted'));
  });

  it('keeps an unresolved debate’s entries accepted, with the open objections in the result', async () => {
    const { board, run } = await fixture([says('ra', 'CRITIQUE: no'), says('rb', 'CRITIQUE: never')]);
    const outcome = await run(debate());
    expect(outcome.ok).toBe(false);
    expect(outcome.escalate).toBe(true);
    const result = shown(board).find((e) => e.kind === BoardKind.Result);
    expect(result?.text).toContain('Open objections');
    expect(result?.text).toContain('a (CRITIQUE): no');
    expect(shown(board).every((e) => board.stateOf(e) === 'accepted')).toBe(true);
  });

  it('posts an arbiter’s ruling as a decision, with the note redacted', async () => {
    const { board, run } = await fixture([says('ra', 'CRITIQUE: no'), says('rb', 'CRITIQUE: never')], {
      ruling: new Ruling(Verdict.Accept, `good enough ${SECRET}`),
    });
    expect((await run(debate({ arbiter: 'human' }))).ok).toBe(true);
    const decision = shown(board).find((e) => e.kind === BoardKind.Decision);
    expect(decision?.text).toBe('accept: good enough [redacted]');
    expect(decision?.sender).toBe('human');
    expect(board.stateOf(decision as never)).toBe('accepted');
  });

  it('posts the remembered ruling and nothing else when the ledger skips the debate', async () => {
    const first = await fixture([says('ra', 'CRITIQUE: no'), says('rb', 'CRITIQUE: never')], {
      ruling: new Ruling(Verdict.Accept, 'fine'),
      ledger: true,
    });
    await first.run(debate({ arbiter: 'human' }));
    const asked = says('ra');
    const second = await fixture([asked, says('rb')], { ledger: true, repo: first.repo });
    expect((await second.run(debate({ arbiter: 'human' }))).ok).toBe(true);
    expect(asked.requests).toHaveLength(0);
    const entries = shown(second.board);
    expect(entries.map((e) => [e.kind, e.text])).toEqual([[BoardKind.Decision, 'accept: fine']]);
    expect(second.board.stateOf(entries[0] as never)).toBe('accepted');
  });

  it('copies exactly what the debate’s own transcript holds', async () => {
    const { board, run } = await fixture([
      says('ra', 'PROPOSAL: x', 'CRITIQUE: y', 'AGREEMENT: z'),
      says('rb', 'QUESTION: why', 'TOOL_INTENT: run it', 'AGREEMENT: z'),
    ]);
    await run(debate());
    const copy = shown(board)
      .filter((e) => e.kind !== BoardKind.Result)
      .map((e) => `${e.sender}|${e.round}|${e.text}`);
    expect(copy).toEqual(['a|1|x', 'b|1|why', 'a|2|y', 'b|2|run it', 'a|3|z', 'b|3|z']);
  });

  it('supersedes the failed attempt’s entries when a retry resets the step (AC-19)', async () => {
    const { board, run } = await fixture([says('ra', 'AGREEMENT: ok'), says('rb', 'AGREEMENT: ok')]);
    await run(debate(), 1);
    board.supersede(['debate']);
    await run(debate(), 2);
    const states = shown(board).map((e) => `${e.attempt}:${board.stateOf(e)}`);
    expect(states).toEqual([
      '1:superseded',
      '1:superseded',
      '1:superseded',
      '2:accepted',
      '2:accepted',
      '2:accepted',
    ]);
  });
});
