import { describe, expect, it } from 'vitest';
import {
  between,
  formatCallCost,
  formatDuration,
  formatMoney,
  formatRunCost,
  formatTokens,
  formatWhen,
  shortId,
} from '../src/format.js';
import {
  buildGraph,
  buildWorkflowGraph,
  clearFailureEdit,
  connectStepsEdit,
  disconnectDependsOnEdit,
  failureBrickEdit,
  isBrickKind,
  isStepBrickKind,
  isValidGraphConnection,
  retriedBy,
  retriesUsed,
  stepBrickEdit,
  unaddressableNodeId,
} from '../src/graph-model.js';
import { takeToken, tokenFromFragment } from '../src/session.js';
import { MAX_PENDING_CHARS, SseParser } from '../src/sse.js';
import { isActive, runLook, stepLook } from '../src/status.js';
import { cardLines, flowOf, handlesOf, initialZoom, READABLE_ZOOM, stepTime } from '../src/ui/RunGraph.js';
import { defaultStep } from '../src/ui/RunScreen.js';
import { hrefOf, isPlainClick, parseRoute } from '../src/ui/router.js';
import { failureSentence } from '../src/ui/StepPanel.js';
import { stepRows } from '../src/ui/StepsGrid.js';
import { applyTheme, readTheme, saveTheme } from '../src/ui/theme.js';
import { attempt, liveRun, STRUCTURE, step, T } from './fixtures.js';

describe('formatting', () => {
  it.each([
    [0, 'under 1 s'],
    [999, 'under 1 s'],
    [41_000, '41 s'],
    [60_000, '1 min'],
    [182_000, '3 min 2 s'],
    [3_600_000, '1 h'],
    [3_840_000, '1 h 4 min'],
  ])('a duration of %i ms reads %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });

  it('measures between two times, and says nothing when one is missing or unreadable', () => {
    expect(between(T(1), T(5))).toBe(4000);
    expect(between(T(1), undefined)).toBeUndefined();
    expect(between('not a time', T(1))).toBeUndefined();
  });

  it('never shows an invented cost (AC-19)', () => {
    expect(formatRunCost({ usd: 0, unknown: 0, calls: 0 })).toBe('$0.00 (no model calls)');
    expect(formatRunCost({ usd: 0, unknown: 2, calls: 2 })).toBe('unknown');
    expect(formatRunCost({ usd: 0.42, unknown: 1, calls: 3 })).toBe('at least $0.42 (partial)');
    expect(formatRunCost({ usd: 1.5, unknown: 0, calls: 3 })).toBe('$1.50');
    expect(formatCallCost(undefined)).toBe('unknown');
    expect(formatCallCost(0.21)).toBe('$0.21');
    expect(formatMoney(0.001)).toBe('less than $0.01');
  });

  it('shortens tokens and ids', () => {
    expect(formatTokens(undefined)).toBe('unknown');
    expect(formatTokens(812)).toBe('812');
    expect(formatTokens(8100)).toBe('8.1k');
    expect(formatTokens(1_200_000)).toBe('1.2M');
    expect(shortId('4dd7a436f00d')).toBe('4dd7a436…');
    expect(shortId('abc')).toBe('abc');
  });

  it('says when relative to today, in the given zone', () => {
    const clock = { now: () => Date.parse(T(0)), timeZone: 'UTC' };
    expect(formatWhen(T(0), clock)).toBe('today 12:00');
    expect(formatWhen('2026-10-19T18:40:00.000Z', clock)).toBe('yesterday 18:40');
    expect(formatWhen('2026-10-12T09:05:00.000Z', clock)).toBe('12 Oct 09:05');
    expect(formatWhen(undefined, clock)).toBe('–');
    expect(formatWhen('nonsense', clock)).toBe('–');
  });
});

describe('states', () => {
  it('gives every state a symbol and a word, never colour alone', () => {
    for (const status of [
      'COMPLETED',
      'RUNNING',
      'VALIDATING',
      'FAILED',
      'ESCALATED',
      'CANCELLED',
      'PENDING',
      'ODD',
    ]) {
      const look = stepLook(status);
      expect(look.symbol.length).toBeGreaterThan(0);
      expect(look.word.length).toBeGreaterThan(0);
    }
    for (const status of ['completed', 'running', 'failed', 'escalated', 'cancelled', 'unknown'] as const) {
      expect(runLook(status).word.length).toBeGreaterThan(0);
    }
    expect(stepLook('VALIDATING').word).toBe('checking');
    expect(stepLook('ODD').word).toBe('unknown');
    expect(isActive('VALIDATING')).toBe(true);
    expect(isActive('COMPLETED')).toBe(false);
  });
});

describe('the token', () => {
  it('is read from the fragment only when it is shaped like one', () => {
    expect(tokenFromFragment('#token=abcdefghijklmnop_-12')).toBe('abcdefghijklmnop_-12');
    expect(tokenFromFragment('#x=1&token=abcdefghijklmnop')).toBe('abcdefghijklmnop');
    expect(tokenFromFragment('#token=short')).toBeUndefined();
    expect(tokenFromFragment(`#token=${'<script>'.repeat(3)}`)).toBeUndefined();
    expect(tokenFromFragment('')).toBeUndefined();
  });

  it('is removed from the address, keeping the path and the query', () => {
    const calls: unknown[] = [];
    const token = takeToken(
      { hash: '#token=abcdefghijklmnop', pathname: '/runs/abc', search: '?step=verify' },
      { replaceState: (...args: unknown[]) => calls.push(args[2]) },
    );
    expect(token).toBe('abcdefghijklmnop');
    expect(calls).toEqual(['/runs/abc?step=verify']);
  });

  it('leaves an address with no fragment alone', () => {
    const calls: unknown[] = [];
    takeToken(
      { hash: '', pathname: '/', search: '' },
      { replaceState: (...args: unknown[]) => calls.push(args) },
    );
    expect(calls).toEqual([]);
  });
});

describe('the event stream parser', () => {
  it('assembles events split across chunks', () => {
    const parser = new SseParser();
    expect(parser.push(': connected\n\nid: 3\nevent: snap')).toEqual([]);
    expect(parser.push('shot\ndata: {"a":1}\n\n')).toEqual([{ id: 3, event: 'snapshot', data: '{"a":1}' }]);
  });

  it('joins data lines, reads CRLF, and names an unnamed event message', () => {
    const parser = new SseParser();
    expect(parser.push('data: one\r\ndata:two\r\n\r\n')).toEqual([
      { id: undefined, event: 'message', data: 'one\ntwo' },
    ]);
  });

  it('ignores an id that is not a whole number and a block with no data', () => {
    const parser = new SseParser();
    expect(parser.push('id: x\nevent: a\ndata: 1\n\nevent: b\n\nid\ndata\n\n')).toEqual([
      { id: undefined, event: 'a', data: '1' },
      { id: undefined, event: 'message', data: '' },
    ]);
  });

  it('drops a block that never ends instead of growing without limit', () => {
    const parser = new SseParser();
    parser.push(`data: ${'x'.repeat(MAX_PENDING_CHARS)}`);
    expect(parser.push('\n\ndata: next\n\n')).toEqual([{ id: undefined, event: 'message', data: 'next' }]);
  });
});

describe('the graph of a run', () => {
  it('draws every step of the recorded structure, the ones not run yet included, left to right', () => {
    const graph = buildGraph(liveRun());
    expect(graph.structureKnown).toBe(true);
    expect(graph.nodes.map((n) => n.id)).toEqual(['rfc', 'code', 'verify', 'review']);
    const xs = graph.nodes.map((n) => n.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(graph.nodes.find((n) => n.id === 'review')?.step).toBeUndefined();
  });

  it('marks the edges of completed steps, and draws the failure route on top', () => {
    const graph = buildGraph(liveRun());
    const waits = graph.edges.filter((e) => e.kind === 'waits');
    expect(waits.map((e) => [e.source, e.target, e.done])).toEqual([
      ['rfc', 'code', true],
      ['code', 'verify', true],
      ['verify', 'review', false],
    ]);
    expect(graph.edges.find((e) => e.kind === 'failure')).toMatchObject({
      source: 'verify',
      target: 'code',
      retries: { used: 1, max: 3 },
    });
    expect(retriedBy(graph, 'code')).toEqual(['verify']);
  });

  it('runs top to bottom when asked: each step below the one it waits for, in a column one card wide', () => {
    const graph = buildGraph(liveRun(), 'TB');
    expect(graph.direction).toBe('TB');
    const ys = graph.nodes.map((n) => n.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    expect(new Set(graph.nodes.map((n) => n.x)).size).toBe(1);
    expect(graph.width).toBeLessThan(graph.height);
    // The edges are the same whichever way it runs: only the picture turns.
    expect(graph.edges).toEqual(buildGraph(liveRun()).edges);
    expect(buildGraph(liveRun()).direction).toBe('LR');
  });

  it('shows an old run as a column on a phone', () => {
    const graph = buildGraph(liveRun({ structure: undefined }), 'TB');
    expect(graph.nodes.map((n) => n.x)).toEqual([0, 0, 0]);
    expect(graph.nodes.map((n) => n.y)).toEqual([0, 140, 280]);
    expect(graph).toMatchObject({ width: 200, height: 384 });
    expect(buildGraph(liveRun({ structure: undefined, steps: [] }), 'TB')).toMatchObject({
      width: 0,
      height: 0,
    });
  });

  it('meets its cards on the sides that face the way it runs', () => {
    expect(handlesOf('LR')).toEqual({ in: 'left', out: 'right', failure: 'bottom' });
    expect(handlesOf('TB')).toEqual({ in: 'top', out: 'bottom', failure: 'right' });
    expect(flowOf(buildGraph(liveRun(), 'TB'), undefined, 0).nodes[0]?.data.direction).toBe('TB');
  });

  it('is the same picture every time for the same run', () => {
    expect(buildGraph(liveRun())).toEqual(buildGraph(liveRun()));
  });

  it('shows an old run as its steps in a row, with no edges', () => {
    const graph = buildGraph(liveRun({ structure: undefined }));
    expect(graph.structureKnown).toBe(false);
    expect(graph.edges).toEqual([]);
    expect(graph.nodes.map((n) => n.y)).toEqual([0, 0, 0]);
    expect(buildGraph(liveRun({ structure: undefined, steps: [] }))).toMatchObject({ width: 0, height: 0 });
  });

  it('counts the retries a route has used, never more than it allows', () => {
    const route = { action: 'retry_step', target: 'code', maxRetries: 1 };
    const failed = step('verify', { history: [attempt(1, 'FAILED', 0, 1), attempt(2, 'FAILED', 2, 3)] });
    expect(retriesUsed(failed, route)).toBe(1);
    expect(retriesUsed(undefined, route)).toBe(0);
  });

  it('turns into nodes and edges for the canvas, each node named for a screen reader', () => {
    const graph = buildGraph(liveRun());
    const flow = flowOf(graph, 'verify', Date.parse(T(30)));
    expect(flow.nodes.find((n) => n.id === 'verify')).toMatchObject({
      selected: true,
      ariaLabel: 'verify, running. Show details.',
    });
    expect(flow.nodes.find((n) => n.id === 'code')?.data.retriedBy).toEqual(['verify']);
    const failure = flow.edges.find((e) => e.className === 'failure');
    expect(failure).toMatchObject({
      type: 'smoothstep',
      label: 'if verify fails: run code again, 1 of 3 used',
    });
    expect(flow.edges.filter((e) => e.className === 'waits done')).toHaveLength(2);
  });

  it('says on a card which try it is, or that it runs again when another step fails', () => {
    const graph = buildGraph(liveRun());
    const data = (id: string) => {
      const found = flowOf(graph, undefined, 0).nodes.find((n) => n.id === id);
      if (found === undefined) throw new Error(id);
      return found.data;
    };
    expect(cardLines(data('verify'))).toEqual({ runner: 'shell', note: 'try 2, 1 failed' });
    expect(cardLines(data('code'))).toEqual({ runner: 'claude-code', note: 'try 2' });
    expect(cardLines(data('review'))).toEqual({ runner: '', note: undefined });
  });

  it('opens a wide graph at a readable zoom, and fits one that has room', () => {
    expect(initialZoom(900, 1200)).toBeUndefined();
    expect(initialZoom(900, 360)).toBe(READABLE_ZOOM);
    expect(initialZoom(900, 0)).toBeUndefined();
  });

  it('times a running step against now and a finished one against its end', () => {
    expect(stepTime({ startedAt: T(0), endedAt: undefined, status: 'RUNNING' }, Date.parse(T(41)))).toBe(
      '41 s',
    );
    expect(stepTime({ startedAt: T(0), endedAt: T(3), status: 'COMPLETED' }, Date.parse(T(41)))).toBe('3 s');
    expect(stepTime({ startedAt: undefined, endedAt: undefined, status: 'PENDING' }, 0)).toBeUndefined();
    const retried = {
      startedAt: T(0),
      endedAt: T(20),
      status: 'COMPLETED',
      history: [attempt(1, 'FAILED', 0, 4), attempt(2, 'COMPLETED', 16, 20)],
    };
    expect(stepTime(retried, 0)).toBe('4 s');
    expect(stepTime({ ...retried, status: 'PENDING' }, 0)).toBeUndefined();
    expect(
      stepTime(
        { ...retried, status: 'RUNNING', history: [attempt(1, 'FAILED', 0, 4), attempt(2, 'RUNNING', 16)] },
        Date.parse(T(30)),
      ),
    ).toBe('14 s');
  });

  it('opens the running step first, else the last that failed, else the first', () => {
    expect(defaultStep(buildGraph(liveRun()).nodes)).toBe('verify');
    const failed = liveRun({
      steps: [step('rfc', { status: 'FAILED' }), step('code', { status: 'ESCALATED' })],
    });
    expect(defaultStep(buildGraph(failed).nodes)).toBe('code');
    expect(defaultStep(buildGraph(liveRun({ steps: [] })).nodes)).toBe('rfc');
    expect(defaultStep([])).toBeUndefined();
  });

  it('lists the steps with their tries as children', () => {
    const rows = stepRows(buildGraph(liveRun()).nodes, Date.parse(T(30)));
    expect(rows.map((r) => [r.label, r.look.word, r.time])).toEqual([
      ['rfc', 'completed', '4 s'],
      ['code', 'completed', '5 s'],
      ['verify', 'running', '9 s'],
      ['review', 'pending', '–'],
    ]);
    expect(rows[2]?.children?.map((r) => [r.label, r.look.word, r.time])).toEqual([
      ['try 1', 'failed', '4 s'],
      ['try 2', 'running', '9 s'],
    ]);
    expect(rows[0]?.children).toBeUndefined();
  });
});

describe('what a failure does, in words', () => {
  const route = STRUCTURE[2]?.onFailure;
  it.each([
    [undefined, true, 'No on_failure is set'],
    [{ action: 'fail', target: undefined, maxRetries: 0 }, true, 'No on_failure is set'],
    [{ action: 'escalate', target: undefined, maxRetries: 0 }, true, 'ends as escalated at once'],
    [route, true, 'Up to 3 retries, 1 used'],
    [{ action: 'retry_step', target: 'code', maxRetries: 1 }, true, 'Up to 1 retry'],
    [{ action: 'custom', target: undefined, maxRetries: 0 }, true, 'on_failure is custom'],
    [route, false, 'did not record'],
  ])('%j', (r, known, text) => {
    const verify = buildGraph(liveRun()).nodes.find((n) => n.id === 'verify')?.step;
    expect(failureSentence(r, verify, known)).toContain(text);
  });
});

describe('the address', () => {
  it.each([
    ['/', '', { name: 'runs' }],
    ['/runs', '', { name: 'runs' }],
    ['/runs/abc123', '', { name: 'run', runId: 'abc123', step: undefined }],
    ['/runs/abc123', '?step=verify', { name: 'run', runId: 'abc123', step: 'verify' }],
    ['/runs/abc123', '?step=..%2Fx', { name: 'run', runId: 'abc123', step: undefined }],
    ['/runs/..%2F..%2Fetc', '', { name: 'missing' }],
    ['/runs/%E0%A4%A', '', { name: 'missing' }],
    ['/elsewhere/x/y', '', { name: 'missing' }],
  ])('%s%s', (path, search, route) => {
    expect(parseRoute(path, search)).toEqual(route);
  });

  it('writes the address back', () => {
    expect(hrefOf({ name: 'runs' })).toBe('/');
    expect(hrefOf({ name: 'missing' })).toBe('/');
    expect(hrefOf({ name: 'run', runId: 'a b', step: 'v' })).toBe('/runs/a%20b?step=v');
  });

  it('keeps a click that asks for a new tab out of the page', () => {
    const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
    expect(isPlainClick(plain)).toBe(true);
    expect(isPlainClick({ ...plain, ctrlKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, button: 1 })).toBe(false);
  });
});

describe('the theme', () => {
  it('is remembered when storage works and forgotten when it does not', () => {
    const map = new Map<string, string>();
    const store = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
    expect(readTheme(store)).toBe('system');
    saveTheme(store, 'dark');
    expect(readTheme(store)).toBe('dark');
    const broken = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: (): void => {
        throw new Error('blocked');
      },
    };
    expect(readTheme(broken)).toBe('system');
    expect(() => saveTheme(broken, 'light')).not.toThrow();
    expect(readTheme(undefined)).toBe('system');
  });

  it('is put on the root element, and system removes it', () => {
    const root = { dataset: {} as DOMStringMap };
    applyTheme(root, 'light');
    expect(root.dataset.theme).toBe('light');
    applyTheme(root, 'system');
    expect(root.dataset.theme).toBeUndefined();
  });
});

describe('the source view helpers', () => {
  it('finds the offset of a line and column, clamped to the text', async () => {
    const { offsetOf, lineCount } = await import('../src/ui/SourceScreen.js');
    const text = 'ab\ncdef\n\ng';
    expect(offsetOf(text, 1, 1)).toBe(0);
    expect(offsetOf(text, 2, 3)).toBe(5);
    expect(offsetOf(text, 2, 99)).toBe(7);
    expect(offsetOf(text, 3, 1)).toBe(8);
    expect(offsetOf(text, 4, 1)).toBe(9);
    expect(offsetOf(text, 9, 1)).toBe(text.length);
    expect(offsetOf(text, 1, 0)).toBe(0);
    expect(lineCount(text)).toBe(4);
    expect(lineCount('')).toBe(1);
  });

  it('routes /workflows/{id} and back', async () => {
    const { parseRoute, hrefOf } = await import('../src/ui/router.js');
    expect(parseRoute('/workflows/abc123', '')).toEqual({ name: 'workflow', workflowId: 'abc123' });
    expect(parseRoute('/workflows/a%2Fb', '')).toEqual({ name: 'missing' });
    expect(hrefOf({ name: 'workflow', workflowId: 'abc' })).toBe('/workflows/abc');
  });
});

describe('the graph of a workflow draft (step 3c)', () => {
  const catalog = {
    catalog: 1 as const,
    runners: [
      { name: 'shell', description: 'Shell commands' },
      {
        name: 'codex',
        description: 'Codex agent',
        permissions: {
          read: { mode: 'native' as const, scope: 'guard' as const, note: '' },
          edit: { mode: 'after' as const, scope: 'guard' as const, note: '' },
          full: { mode: 'none' as const, scope: 'none' as const, note: '' },
        },
      },
      {
        name: 'openrouter',
        description: 'OpenRouter API',
        permissions: {
          read: { mode: 'native' as const, scope: 'guard' as const, note: '' },
          edit: { mode: 'unsupported' as const, scope: 'none' as const, note: 'cannot_act' },
          full: { mode: 'unsupported' as const, scope: 'none' as const, note: 'cannot_act' },
        },
      },
    ],
    guards: [],
    arbiters: [{ name: 'majority', description: 'Majority vote' }],
    voters: [],
    prompts: [],
    values: {
      decisionTypes: [],
      isolation: [],
      failureActions: [],
      mcpPolicies: [],
      promptAdditions: [],
    },
  };
  const emptyCatalog = { ...catalog, runners: [], arbiters: [] };

  it('lays out a draft left to right or top to bottom and summarizes each step card (AC-02, AC-03)', () => {
    const step0 = {
      id: 'plan',
      role: 'architect',
      consensus_with: ['security'],
      decision_type: 'consensus',
      permissions: { level: 'read' },
    };
    const step1 = {
      id: 'implement',
      runner: 'claude-code',
      depends_on: ['plan'],
      permissions: { level: 'edit', fs: { write: ['src/**'] } },
    };
    const step2 = {
      id: 'verify',
      runner: 'shell',
      depends_on: ['implement'],
      commands: ['pnpm test', 'pnpm lint'],
      on_failure: { action: 'retry_step', target: 'implement', max_retries: 2 },
    };
    const draft = {
      version: '1.0',
      roles: {
        architect: { runner: 'claude-code' },
        security: { runner: 'codex' },
      },
      steps: [step0, step1, step2],
    };
    const problems = [{ message: 'Bad goal', path: '$.steps[1].goal' }];
    const lr = buildWorkflowGraph(draft, problems, 'LR');
    expect(lr.direction).toBe('LR');
    expect(lr.nodes.map((n) => n.id)).toEqual(['plan', 'implement', 'verify']);
    expect(lr.nodes.map((n) => n.x)).toEqual([...lr.nodes.map((n) => n.x)].sort((a, b) => a - b));
    expect(lr.nodes[0]?.draft).toMatchObject({
      index: 0,
      label: 'plan',
      addressable: true,
      runnerLabel: 'debate (architect + security)',
      ruleLabel: 'read-only',
      hasProblems: false,
      missingDependsOn: [],
    });
    expect(lr.nodes[1]?.draft).toMatchObject({
      index: 1,
      label: 'implement',
      addressable: true,
      runnerLabel: 'claude-code',
      ruleLabel: 'writes src/**',
      hasProblems: true,
    });
    expect(lr.nodes[2]?.draft).toMatchObject({
      index: 2,
      label: 'verify',
      addressable: true,
      runnerLabel: 'shell',
      ruleLabel: '2 commands',
      hasProblems: false,
    });
    expect(lr.edges).toEqual([
      { id: 'waits:plan->implement', source: 'plan', target: 'implement', kind: 'waits', done: false },
      { id: 'waits:implement->verify', source: 'implement', target: 'verify', kind: 'waits', done: false },
      {
        id: 'failure:verify->implement',
        source: 'verify',
        target: 'implement',
        kind: 'failure',
        done: false,
        retries: { used: 0, max: 2 },
      },
    ]);

    // Non-structural field edits keep every node at the exact same coordinates (C-06).
    const editedGoal = {
      ...draft,
      steps: [step0, { ...step1, goal: 'Changed goal' }, step2],
    };
    expect(buildWorkflowGraph(editedGoal, [], 'LR').nodes.map((n) => [n.id, n.x, n.y])).toEqual(
      lr.nodes.map((n) => [n.id, n.x, n.y]),
    );

    const flow = flowOf(lr, 'implement', 0, {
      onConnect: () => undefined,
      onDropBrick: () => undefined,
      onDeleteStep: () => undefined,
    });
    expect(flow.nodes[1]).toMatchObject({
      selected: true,
      connectable: true,
      ariaLabel: 'implement, claude-code, writes src/**, has problems. Edit step.',
    });
    expect(flow.edges.find((e) => e.className === 'failure')?.label).toBe(
      'if verify fails: run implement again, up to 2',
    );

    const tb = buildWorkflowGraph(draft, [], 'TB');
    expect(tb.direction).toBe('TB');
    expect(tb.nodes.map((n) => n.y)).toEqual([...tb.nodes.map((n) => n.y)].sort((a, b) => a - b));
  });

  it('summarizes full access, old-style full access, custom permissions, role inheritance and empty drafts', () => {
    expect(buildWorkflowGraph({ version: '1.0', steps: [] }, [])).toEqual({
      direction: 'LR',
      nodes: [],
      edges: [],
      structureKnown: true,
      width: 0,
      height: 0,
    });
    const draft = {
      roles: { reviewer: { runner: 'codex' } },
      steps: [
        { id: 'a', role: 'reviewer', permissions: { level: 'full' } },
        { id: 'b', runner: 'claude-code', permissions: { fs: { write: ['**'] }, terminal: 'allow' } },
        { id: 'c', runner: 'claude-code', permissions: { terminal: ' weird ' } },
        { id: 'd', runner: 'openrouter' },
        { id: 'e', runner: 'shell', commands: ['echo ok'] },
        { id: 'f', runner: 'shell', commands: [] },
      ],
    };
    const graph = buildWorkflowGraph(draft, []);
    expect(graph.nodes.map((n) => [n.draft?.runnerLabel, n.draft?.ruleLabel])).toEqual([
      ['role: reviewer', 'full access'],
      ['claude-code', 'old style full access'],
      ['claude-code', 'custom permissions'],
      ['openrouter', 'runner default'],
      ['shell', '1 command'],
      ['shell', 'no commands'],
    ]);
  });

  it('records dangling depends_on and on_failure.target without creating dagre ghost nodes, does not invent max_retries, and isolates unaddressable steps (AC-04)', () => {
    const draft = {
      steps: [
        {
          id: 'verify',
          runner: 'shell',
          depends_on: ['removed-step', 'build', 'verify'],
          on_failure: { action: 'retry_step', target: 'vanished' },
        },
        { id: 'build', runner: 'shell' },
        { runner: 'shell' },
        { id: 'dup', runner: 'shell' },
        { id: 'dup', runner: 'shell' },
        'not-an-object',
      ],
    };
    const graph = buildWorkflowGraph(draft, []);
    expect(graph.nodes).toHaveLength(6);
    expect(graph.nodes.map((n) => n.id)).toEqual([
      'verify',
      'build',
      unaddressableNodeId(2),
      unaddressableNodeId(3),
      unaddressableNodeId(4),
      unaddressableNodeId(5),
    ]);
    expect(graph.nodes[0]?.onFailure).toEqual({
      action: 'retry_step',
      target: 'vanished',
      maxRetries: 0,
    });
    expect(graph.nodes[0]?.draft).toMatchObject({
      addressable: true,
      missingDependsOn: ['removed-step', 'verify'],
      missingFailureTarget: 'vanished',
    });
    expect(graph.nodes[2]?.draft).toMatchObject({ label: '(no id)', addressable: false });
    expect(graph.nodes[3]?.draft).toMatchObject({ label: 'dup', addressable: false });
    expect(graph.edges).toEqual([
      { id: 'waits:build->verify', source: 'build', target: 'verify', kind: 'waits', done: false },
    ]);
  });

  it('lays out cycles in depends_on and special step ids (__proto__, constructor) with finite coordinates (AC-02, section 6)', () => {
    const draft = {
      steps: [
        { id: '__proto__', runner: 'shell', depends_on: ['constructor'] },
        { id: 'constructor', runner: 'shell', depends_on: ['__proto__'] },
      ],
    };
    const graph = buildWorkflowGraph(draft, []);
    expect(graph.nodes).toHaveLength(2);
    for (const node of graph.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
    expect(graph.edges).toHaveLength(2);
  });

  it('builds step brick edits and failure brick edits deterministically (AC-05)', () => {
    expect(isBrickKind('agent')).toBe(true);
    expect(isBrickKind('retry_step')).toBe(true);
    expect(isBrickKind('guard')).toBe(false);
    expect(isStepBrickKind('debate')).toBe(true);
    expect(isStepBrickKind('escalate')).toBe(false);

    const value = {
      roles: { architect: { runner: 'claude-code' }, reviewer: { runner: 'codex' } },
      steps: [{ id: 'step-1', runner: 'shell' }],
    };
    expect(stepBrickEdit('agent', value, catalog, 'step-1')).toEqual({
      id: 'step-2',
      edit: { op: 'addStep', step: { id: 'step-2', runner: 'codex' }, after: 'step-1' },
    });
    expect(stepBrickEdit('agent', value, emptyCatalog, 'no-such-step')).toEqual({
      id: 'step-2',
      edit: { op: 'addStep', step: { id: 'step-2' } },
    });
    expect(stepBrickEdit('api', value, catalog, undefined)).toEqual({
      id: 'step-2',
      edit: { op: 'addStep', step: { id: 'step-2', runner: 'openrouter' } },
    });
    expect(stepBrickEdit('shell', value, catalog, undefined)).toEqual({
      id: 'step-2',
      edit: { op: 'addStep', step: { id: 'step-2', runner: 'shell' } },
    });
    expect(stepBrickEdit('debate', value, catalog, 'step-1')).toEqual({
      id: 'step-2',
      edit: {
        op: 'addStep',
        step: {
          id: 'step-2',
          role: 'architect',
          consensus_with: ['reviewer'],
          decision_type: 'consensus',
        },
        after: 'step-1',
      },
    });

    expect(failureBrickEdit(value, 'step-1', 'retry_step')).toEqual({
      op: 'set',
      path: ['steps', 0, 'on_failure'],
      value: { action: 'retry_step', target: 'step-1', max_retries: 3 },
    });
    expect(failureBrickEdit(value, 'step-1', 'escalate')).toEqual({
      op: 'set',
      path: ['steps', 0, 'on_failure'],
      value: { action: 'escalate' },
    });
    expect(failureBrickEdit(value, 'step-1', 'fail')).toEqual({
      op: 'set',
      path: ['steps', 0, 'on_failure'],
      value: { action: 'fail' },
    });
    expect(failureBrickEdit(value, 'missing', 'fail')).toBeUndefined();
  });

  it('connects and disconnects depends_on and on_failure handles safely by step id (AC-07, AC-08, AC-10)', () => {
    const value = {
      steps: [
        { id: 'plan', runner: 'claude-code' },
        {
          id: 'verify',
          runner: 'shell',
          depends_on: ['old-dep'],
          on_failure: { action: 'retry_step', target: 'verify', max_retries: 5 },
        },
      ],
    };

    expect(isValidGraphConnection('plan', 'verify', 'out', 'in')).toBe(true);
    expect(isValidGraphConnection('plan', 'plan', 'out', 'in')).toBe(false);
    expect(isValidGraphConnection('verify', 'verify', 'fail-out', 'fail-in')).toBe(true);
    expect(isValidGraphConnection('plan', 'verify', 'out', 'fail-in')).toBe(false);
    expect(isValidGraphConnection('plan', 'verify', 'fail-out', 'in')).toBe(false);

    expect(connectStepsEdit(value, 'plan', 'verify', 'out', 'in')).toEqual({
      op: 'set',
      path: ['steps', 1, 'depends_on'],
      value: ['old-dep', 'plan'],
    });
    // Duplicate dependency or self-dependency is ignored.
    expect(connectStepsEdit(value, 'old-dep', 'verify', 'out', 'in')).toBeUndefined();
    expect(connectStepsEdit(value, 'plan', 'plan', 'out', 'in')).toBeUndefined();
    expect(connectStepsEdit(value, 'plan', 'verify', 'out', 'fail-in')).toBeUndefined();

    // Connecting failure handles keeps existing max_retries.
    expect(connectStepsEdit(value, 'verify', 'plan', 'fail-out', 'fail-in')).toEqual({
      op: 'set',
      path: ['steps', 1, 'on_failure'],
      value: { action: 'retry_step', target: 'plan', max_retries: 5 },
    });

    // Disconnecting the last dependency removes the key; disconnecting one of many updates the list.
    expect(disconnectDependsOnEdit(value, 'verify', 'old-dep')).toEqual({
      op: 'remove',
      path: ['steps', 1, 'depends_on'],
    });
    const withTwoDeps = {
      steps: [{ id: 'verify', runner: 'shell', depends_on: ['old-dep', 42, 'plan'] }],
    };
    expect(disconnectDependsOnEdit(withTwoDeps, 'verify', 'old-dep')).toEqual({
      op: 'set',
      path: ['steps', 0, 'depends_on'],
      value: [42, 'plan'],
    });
    expect(disconnectDependsOnEdit(value, 'verify', 'not-there')).toBeUndefined();

    expect(clearFailureEdit(value, 'verify')).toEqual({
      op: 'remove',
      path: ['steps', 1, 'on_failure'],
    });
    expect(clearFailureEdit(value, 'plan')).toBeUndefined();
  });
});
