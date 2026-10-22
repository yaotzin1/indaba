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
import { buildGraph, retriedBy, retriesUsed } from '../src/graph-model.js';
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
