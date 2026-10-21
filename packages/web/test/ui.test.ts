// @vitest-environment happy-dom
import type { DiscussionView, RunSnapshot, RunSummary, ServerStreamEvent } from '@indaba/core';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiFailure, type Client, type Failure, type StreamHandlers } from '../src/client.js';
import { buildGraph } from '../src/graph-model.js';
import { App, type AppProps } from '../src/ui/App.js';
import { NARROW, useMediaQuery } from '../src/ui/media.js';
import { StepCard } from '../src/ui/RunGraph.js';
import { StepPanel } from '../src/ui/StepPanel.js';
import { attempt, liveRun, runner, step, T } from './fixtures.js';

afterEach(cleanup);

const NOW = Date.parse(T(30));
const clock = { now: () => NOW, timeZone: 'UTC' };

interface FakeClient extends Client {
  /** Pushes a snapshot to the open run stream, or a run event to the server stream. */
  push(run: RunSnapshot): void;
  announce(event: ServerStreamEvent): void;
  state(state: 'live' | 'reconnecting' | 'unavailable' | 'ended'): void;
  fail(failure: Failure): void;
  runCalls: number;
}

function fakeClient(options: {
  readonly runs?: readonly RunSummary[];
  readonly run?: RunSnapshot | Failure;
  readonly contract?: string | Failure;
  readonly discussion?: DiscussionView | 'none' | 'fail';
}): FakeClient {
  let runHandlers: StreamHandlers<RunSnapshot> | undefined;
  let serverHandlers: StreamHandlers<ServerStreamEvent> | undefined;
  const client: FakeClient = {
    runCalls: 0,
    async contract() {
      const c = options.contract ?? '1.0.0';
      if (typeof c !== 'string') throw new ApiFailure(c);
      return { contractVersion: c };
    },
    async runs() {
      client.runCalls += 1;
      return options.runs ?? [];
    },
    async run() {
      const r = options.run ?? liveRun();
      if ('kind' in r) throw new ApiFailure(r);
      return r;
    },
    followRun(_id, handlers, signal) {
      runHandlers = handlers;
      handlers.onState('live');
      return new Promise((resolve) => signal.addEventListener('abort', () => resolve()));
    },
    followServer(handlers, signal) {
      serverHandlers = handlers;
      handlers.onState('live');
      return new Promise((resolve) => signal.addEventListener('abort', () => resolve()));
    },
    async stepLog() {
      return '';
    },
    async discussion() {
      if (options.discussion === 'fail') throw new ApiFailure({ kind: 'server', message: 'no' });
      return options.discussion === 'none' || options.discussion === undefined
        ? undefined
        : options.discussion;
    },
    push: (run) => runHandlers?.onEvent(run),
    announce: (event) => serverHandlers?.onEvent(event),
    state: (state) => {
      runHandlers?.onState(state);
      serverHandlers?.onState(state);
    },
    fail: (failure) => {
      runHandlers?.onFailure(failure);
      serverHandlers?.onFailure(failure);
    },
  };
  return client;
}

function appProps(
  client: Client | undefined,
  path = '/',
  search = '',
): AppProps & { readonly root: { dataset: DOMStringMap } } {
  window.history.replaceState(null, '', `${path}${search}`);
  return {
    client,
    clock,
    win: window,
    origin: 'http://127.0.0.1:4173',
    root: { dataset: {} as DOMStringMap },
    store: undefined,
    tickMs: 60_000,
  };
}

const RUNS: readonly RunSummary[] = [
  {
    runId: 'older0000000000',
    startedAt: T(0),
    status: 'completed',
    workflow: 'release-notes',
    cost: { usd: 0.42, unknown: 0, calls: 2 },
  },
  {
    runId: 'newer0000000000',
    startedAt: T(20),
    status: 'running',
    workflow: 'task-pipeline',
    cost: { usd: 0.1, unknown: 1, calls: 3 },
  },
  {
    runId: 'nameless0000000',
    startedAt: T(10),
    status: 'escalated',
    workflow: undefined,
    cost: { usd: 0, unknown: 0, calls: 0 },
  },
];

describe('the page without a usable token', () => {
  it('says how to get the address, and shows nothing else', () => {
    render(h(App, appProps(undefined)));
    expect(screen.getByRole('alert').textContent).toContain('This page needs its address');
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('blocks when the server refuses the token, speaks a newer contract, or has stopped', async () => {
    for (const [failure, text] of [
      [{ kind: 'unauthorized' }, 'needs its address'],
      [{ kind: 'newer_contract' }, 'older than the server'],
      [{ kind: 'unreachable' }, 'Nothing answers at http://127.0.0.1:4173'],
      [{ kind: 'server', message: 'The server sent nonsense.' }, 'The server sent nonsense.'],
    ] as const) {
      render(h(App, appProps(fakeClient({ contract: failure }))));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(text));
      cleanup();
    }
  });
});

describe('the Runs screen', () => {
  it('lists the runs newest first in a grid, each a link to its run', async () => {
    render(h(App, appProps(fakeClient({ runs: RUNS }))));
    const grid = await screen.findByRole('grid', { name: 'Runs on this machine' });
    const links = within(grid)
      .getAllByRole('link')
      .map((a) => a.textContent);
    expect(links).toEqual(['task-pipeline', 'unnamed', 'release-notes']);
    expect(within(grid).getByText('escalated')).toBeTruthy();
    expect(screen.getByText('Live').className).toBe('badge live');
  });

  it('shows the cost of each run, marking a partial or an absent price, with what it is made of on hover', async () => {
    render(h(App, appProps(fakeClient({ runs: RUNS }))));
    const grid = await screen.findByRole('grid', { name: 'Runs on this machine' });
    expect(within(grid).getByText('$0.42').getAttribute('title')).toBe('2 model calls, each with a price');
    expect(within(grid).getByText('at least $0.10 (partial)').getAttribute('title')).toBe(
      '3 model calls, 1 with no price',
    );
    expect(within(grid).getByText('$0.00 (no model calls)').getAttribute('title')).toBe('No model calls');
  });

  it('opens a run from its link, keeping the page, and goes back', async () => {
    render(h(App, appProps(fakeClient({ runs: RUNS }))));
    const grid = await screen.findByRole('grid');
    fireEvent.click(within(grid).getByText('task-pipeline'));
    await screen.findByRole('heading', { level: 2, name: /task-pipeline/ });
    expect(window.location.pathname).toBe('/runs/newer0000000000');
    fireEvent.click(screen.getByText('← Runs'));
    await screen.findByRole('heading', { level: 2, name: 'Runs' });
    expect(window.location.pathname).toBe('/');
  });

  it('opens a run by clicking its row', async () => {
    render(h(App, appProps(fakeClient({ runs: RUNS }))));
    const grid = await screen.findByRole('grid');
    const row = within(grid).getByText('release-notes').closest('tr');
    if (row === null) throw new Error('no row');
    fireEvent.click(row);
    await waitFor(() => expect(window.location.pathname).toBe('/runs/older0000000000'));
  });

  it('reads the list again when the server says a run started', async () => {
    const client = fakeClient({ runs: RUNS });
    render(h(App, appProps(client)));
    await screen.findByRole('grid');
    expect(client.runCalls).toBe(1);
    act(() => client.announce({ id: 1, kind: 'run_started', run: RUNS[0] as RunSummary }));
    await waitFor(() => expect(client.runCalls).toBe(2));
  });

  it('says how to start a run when there is none', async () => {
    render(h(App, appProps(fakeClient({ runs: [] }))));
    expect((await screen.findByText('No runs yet')).tagName).toBe('H3');
    expect(screen.getByText('indaba run workflow.yml')).toBeTruthy();
  });

  it('blocks when the list cannot be read for good', async () => {
    const client = fakeClient({ runs: RUNS });
    client.runs = async () => {
      throw new ApiFailure({ kind: 'unauthorized' });
    };
    render(h(App, appProps(client)));
    expect((await screen.findByRole('alert')).textContent).toContain('needs its address');
  });
});

describe('the Run screen', () => {
  it('shows the run, its cost with unknowns marked, and opens the running step', async () => {
    render(h(App, appProps(fakeClient({}), '/runs/r1')));
    await screen.findByRole('heading', { level: 2, name: /task-pipeline/ });
    expect(screen.getByText(/Started today 12:00, running for 30 s, run r1/)).toBeTruthy();
    expect(screen.getByText('at least $0.21 (partial)')).toBeTruthy();
    expect(screen.getByText('(1 with no price)')).toBeTruthy();
    const panel = screen.getByRole('article');
    expect(within(panel).getByRole('heading', { level: 3 }).textContent).toContain('verify');
    expect(within(panel).getByText(/Up to 3 retries, 1 used/)).toBeTruthy();
    expect(within(panel).getByText('pnpm typecheck exited with 2')).toBeTruthy();
    expect(within(panel).getByText('Output (live)')).toBeTruthy();
  });

  it('opens a table of the cost of each step that called a model, adding up to the total', async () => {
    render(h(App, appProps(fakeClient({}), '/runs/r1')));
    const table = await screen.findByRole('grid', { name: 'The cost of each step that called a model' });
    const rows = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.textContent);
    expect(rows).toEqual(['rfc1' + '8.1k / 2.4k' + '$0.21', 'code1' + 'unknown / unknown' + 'unknown']);
    expect(screen.getByText('at least $0.21 (partial)').getAttribute('title')).toBe(
      '2 model calls, 1 with no price',
    );
  });

  it('says a call still running has no cost yet, and counts it apart', async () => {
    const run = liveRun({
      steps: [
        step('debate', {
          status: 'RUNNING',
          runners: [runner({ spanId: 'live', endedAt: undefined })],
        }),
        step('review', {
          status: 'RUNNING',
          runners: [runner({ spanId: 'done', costUsd: 0.5 }), runner({ spanId: 'next', endedAt: undefined })],
        }),
      ],
      structure: undefined,
    });
    render(h(App, appProps(fakeClient({ run }), '/runs/r1')));
    const table = await screen.findByRole('grid', { name: 'The cost of each step that called a model' });
    const rows = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.textContent);
    expect(rows).toEqual([
      'debate0 (1 still running)' + 'unknown / unknown' + 'unknown',
      'review1 (1 still running)' + 'unknown / unknown' + '$0.50',
    ]);
  });

  it('says when no step has called a model', async () => {
    const run = liveRun({
      steps: [step('lint', { status: 'COMPLETED' })],
      cost: { usd: 0, unknown: 0, calls: 0 },
    });
    render(h(App, appProps(fakeClient({ run }), '/runs/r1')));
    expect(await screen.findByText('No step of this run has called a model.')).toBeTruthy();
  });

  it('selects a step from the step list and keeps it in the address', async () => {
    render(h(App, appProps(fakeClient({}), '/runs/r1')));
    const list = await screen.findByRole('treegrid', { name: /Steps of this run/ });
    fireEvent.click(within(list).getByRole('button', { name: 'rfc' }));
    await waitFor(() =>
      expect(within(screen.getByRole('article')).getByRole('heading', { level: 3 }).textContent).toContain(
        'rfc',
      ),
    );
    expect(window.location.search).toBe('?step=rfc');
    expect(screen.getByText('some/model')).toBeTruthy();
  });

  it('opens the step the address names', async () => {
    render(h(App, appProps(fakeClient({}), '/runs/r1', '?step=review')));
    const panel = await screen.findByRole('article');
    expect(within(panel).getByText('Waits for verify.')).toBeTruthy();
    expect(within(panel).getByText(/escalated at once/)).toBeTruthy();
  });

  it('follows the live stream, and greys the run out while reconnecting', async () => {
    const client = fakeClient({});
    const { container } = render(h(App, appProps(client, '/runs/r1')));
    await screen.findByRole('heading', { level: 2, name: /task-pipeline/ });
    act(() => client.state('reconnecting'));
    expect(screen.getByText(/The connection dropped/)).toBeTruthy();
    expect(container.querySelector('.stale')).not.toBeNull();
    // Every state says in words that it is the last known one: the run's, each step's in the list, each card's.
    const labels = container.querySelectorAll('.last-known');
    expect(labels.length).toBeGreaterThanOrEqual(1 + 4);
    expect(labels[0]?.textContent).toBe(', last known');
    expect(container.querySelector('.step-card')?.textContent).toContain('last known');
    act(() => client.push(liveRun({ status: 'completed', endedAt: T(40) })));
    act(() => client.state('ended'));
    await screen.findByText(/took 40 s/);
    expect(screen.queryByText(/The connection dropped/)).toBeNull();
    expect(container.querySelector('.last-known')).toBeNull();
    expect(container.querySelector('.step-card')?.textContent).not.toContain('last known');
    expect(screen.getByText('Run ended')).toBeTruthy();
  });

  it('stops and offers to check again when the server is not answering, and starts afresh once it is', async () => {
    const client = fakeClient({});
    render(h(App, appProps(client, '/runs/r1')));
    await screen.findByRole('heading', { level: 2, name: /task-pipeline/ });
    act(() => client.state('unavailable'));
    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toContain('The server is not answering');
    expect(screen.getByText('Server stopped')).toBeTruthy();
    expect(screen.queryByText(/The connection dropped/)).toBeNull();
    expect(screen.getAllByText(', last known').length).toBeGreaterThan(0);
    fireEvent.click(within(banner).getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(await screen.findByText('Live')).toBeTruthy();
  });

  it('says so when the server still does not answer', async () => {
    const client = fakeClient({});
    render(h(App, appProps(client, '/runs/r1')));
    await screen.findByRole('heading', { level: 2, name: /task-pipeline/ });
    act(() => client.state('unavailable'));
    client.contract = async () => {
      throw new ApiFailure({ kind: 'server', message: 'no' });
    };
    fireEvent.click(await screen.findByRole('button', { name: 'Check again' }));
    expect(await screen.findByText('Still not answering.')).toBeTruthy();
  });

  it('says a run is not found, from the first read or from the stream', async () => {
    render(
      h(
        App,
        appProps(fakeClient({ run: { kind: 'not_found', message: 'No run has this id.' } }), '/runs/gone'),
      ),
    );
    expect((await screen.findByRole('alert')).textContent).toContain('Run not found');
    cleanup();
    const client = fakeClient({});
    render(h(App, appProps(client, '/runs/r1')));
    await screen.findByRole('heading', { level: 2, name: /task-pipeline/ });
    act(() => client.fail({ kind: 'not_found', message: 'gone' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Run not found');
  });

  it('blocks when the stream refuses the token', async () => {
    const client = fakeClient({});
    render(h(App, appProps(client, '/runs/r1')));
    await screen.findByRole('heading', { level: 2, name: /task-pipeline/ });
    act(() => client.fail({ kind: 'unauthorized' }));
    expect((await screen.findByRole('alert')).textContent).toContain('needs its address');
  });

  it('blocks when the first read fails for another reason', async () => {
    render(h(App, appProps(fakeClient({ run: { kind: 'unreachable' } }), '/runs/r1')));
    expect((await screen.findByRole('alert')).textContent).toContain('The server stopped');
  });

  it('says when a run did not record its structure, and lists what it could not read', async () => {
    render(
      h(
        App,
        appProps(
          fakeClient({ run: liveRun({ structure: undefined, notes: ['line 4: not JSON'] }) }),
          '/runs/r1',
        ),
      ),
    );
    expect(await screen.findByText(/recorded before Indaba wrote down/)).toBeTruthy();
    expect(screen.getByText('line 4: not JSON')).toBeTruthy();
    expect(screen.getByText(/did not record where a failure leads/)).toBeTruthy();
  });

  it('treats an address it does not know as the Runs screen', async () => {
    render(h(App, appProps(fakeClient({ runs: RUNS }), '/no/such/place')));
    expect(await screen.findByRole('heading', { level: 2, name: 'Runs' })).toBeTruthy();
  });
});

describe('the theme switch', () => {
  it('puts the chosen theme on the root and remembers it', async () => {
    const map = new Map<string, string>();
    const props = {
      ...appProps(fakeClient({})),
      store: {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
      },
    };
    render(h(App, props));
    fireEvent.click(screen.getByLabelText('Dark'));
    await waitFor(() => expect(props.root.dataset.theme).toBe('dark'));
    expect(map.get('indaba.theme')).toBe('dark');
    fireEvent.click(screen.getByLabelText('System'));
    await waitFor(() => expect(props.root.dataset.theme).toBeUndefined());
  });
});

describe('a step', () => {
  const graph = buildGraph(liveRun());
  const node = (id: string) => {
    const found = graph.nodes.find((n) => n.id === id);
    if (found === undefined) throw new Error(id);
    return found;
  };

  it('shows the commands of a shell step with their exit codes', () => {
    const shell = {
      ...node('verify'),
      step: step('verify', {
        status: 'COMPLETED',
        startedAt: T(0),
        endedAt: T(2),
        runners: [runner({ spanId: 'a', name: 'shell', operation: 'execute_tool', exitCode: 0 })],
      }),
    };
    render(h(StepPanel, { node: shell, structureKnown: true, retriedBy: [], now: NOW }));
    expect(screen.getByRole('columnheader', { name: 'Exit code' })).toBeTruthy();
    expect(screen.getByText('Nothing yet.')).toBeTruthy();
  });

  it('shows agent output as text, never as markup (AC-16)', () => {
    const hostile = `<img src=x onerror=${'alert'}(1)> <a href="javascript:void(0)">x</a>`;
    const agent = {
      ...node('code'),
      step: step('code', {
        status: 'COMPLETED',
        output: [hostile],
        outputTruncated: true,
        consensus: { outcome: 'reached', rounds: 1 },
        skipped: [{ runner: 'codex', reason: 'not installed' }],
      }),
    };
    const { container } = render(
      h(StepPanel, { node: agent, structureKnown: true, retriedBy: ['verify'], now: NOW }),
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('pre a')).toBeNull();
    expect(container.querySelector('pre')?.textContent).toBe(hostile);
    expect(screen.getByText('Only the last part is shown.')).toBeTruthy();
    expect(screen.getByText('If verify fails, this step runs again.')).toBeTruthy();
    expect(screen.getByText('The debate ended reached after 1 round.')).toBeTruthy();
    expect(screen.getByText('Skipped codex: not installed')).toBeTruthy();
    expect(screen.getByText('No runner has started for this step yet.')).toBeTruthy();
  });

  it('draws a card with a symbol, a word and the time, and marks the selected one', () => {
    const { container } = render(
      h(StepCard, { data: { node: node('verify'), selected: true, now: NOW, retriedBy: [] } }),
    );
    const card = container.querySelector('.step-card');
    expect(card?.className).toBe('step-card running selected');
    expect(card?.textContent).toContain('running, 9 s');
    expect(card?.textContent).toContain('try 2, 1 failed');
  });
});

describe('the discussion of a debate step', () => {
  const graph = buildGraph(liveRun());
  const node = (id: string) => {
    const found = graph.nodes.find((n) => n.id === id);
    if (found === undefined) throw new Error(id);
    return found;
  };
  const view: DiscussionView = {
    stepId: 'code',
    outcome: 'stalled',
    rounds: 2,
    messages: [
      { round: 1, sender: 'claude', type: 'CRITIQUE', content: '<b>fix the loop</b>' },
      { round: 1, sender: 'antigravity', type: 'AGREEMENT', content: 'fine' },
      { round: 2, sender: 'claude', type: 'AGREEMENT', content: 'ok' },
    ],
    ruling: { verdict: 'accept', decidedBy: 'human', note: 'ship it' },
  };
  const debating = {
    ...node('code'),
    step: step('code', { status: 'COMPLETED', consensus: { outcome: 'stalled', rounds: 2 } }),
  };
  const panel = (load: () => Promise<DiscussionView | undefined>) =>
    render(
      h(StepPanel, { node: debating, structureKnown: true, retriedBy: [], now: NOW, loadDiscussion: load }),
    );

  it('stays closed until asked, then shows the rounds, who said what and the ruling, as text', async () => {
    let asked = 0;
    const { container } = panel(async () => {
      asked += 1;
      return view;
    });
    expect(asked).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Show the discussion' }));
    expect(await screen.findByText('Round 2')).toBeTruthy();
    expect(screen.getByText('Round 1')).toBeTruthy();
    expect(screen.getByText(/Where each one ended: claude AGREEMENT, antigravity AGREEMENT/)).toBeTruthy();
    expect(screen.getByText('Ruling: accept, decided by human.')).toBeTruthy();
    expect(container.querySelector('b + pre, pre b')).toBeNull();
    expect(screen.getByText('<b>fix the loop</b>')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide the discussion' }));
    expect(screen.queryByText('Round 1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show the discussion' }));
    expect(await screen.findByText('Round 1')).toBeTruthy();
    expect(asked).toBe(1);
  });

  it('says plainly when no messages were kept, and when they could not be loaded', async () => {
    panel(async () => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Show the discussion' }));
    expect(await screen.findByText(/No messages were kept/)).toBeTruthy();
    cleanup();
    panel(async () => {
      throw new Error('x');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Show the discussion' }));
    expect((await screen.findByRole('alert')).textContent).toContain('could not be loaded');
  });

  it('offers nothing for a step that is not a debate or when there is no server to ask', () => {
    render(
      h(StepPanel, {
        node: node('code'),
        structureKnown: true,
        retriedBy: [],
        now: NOW,
        loadDiscussion: async () => view,
      }),
    );
    expect(screen.queryByRole('button', { name: 'Show the discussion' })).toBeNull();
    cleanup();
    render(h(StepPanel, { node: debating, structureKnown: true, retriedBy: [], now: NOW }));
    expect(screen.queryByRole('button', { name: 'Show the discussion' })).toBeNull();
  });

  it('loads through the screen: a selected debate step asks the server for its own run and step', async () => {
    const run = liveRun({
      steps: [step('rfc', { status: 'COMPLETED', consensus: { outcome: 'reached', rounds: 1 } })],
    });
    const client = fakeClient({ run, discussion: view });
    render(h(App, appProps(client, '/runs/r1', '?step=rfc')));
    fireEvent.click(await screen.findByRole('button', { name: 'Show the discussion' }));
    expect(await screen.findByText('Round 1')).toBeTruthy();
  });
});

describe('text from a run that attacks the page (T-12)', () => {
  const markup = `<img src=x on${'error'}=alert(1)><${'script'}>alert(2)</${'script'}>`;
  const scriptUrl = ['java', 'script', ':alert(3)'].join('');
  /** Any element the page did not put there itself: the logo is its only image. */
  const FOREIGN = 'img:not([src="/indaba-mark.svg"]), script, iframe, object, embed';

  it('a workflow name and a run id stay text, and every link stays inside the page', async () => {
    const runs: readonly RunSummary[] = [
      {
        runId: scriptUrl,
        startedAt: T(0),
        status: 'failed',
        workflow: markup,
        cost: { usd: 0, unknown: 0, calls: 0 },
      },
    ];
    const { container } = render(h(App, appProps(fakeClient({ runs }))));
    const grid = await screen.findByRole('grid');
    expect(within(grid).getByText(markup).tagName).toBe('A');
    expect(container.querySelector(FOREIGN)).toBeNull();
    for (const link of Array.from(container.querySelectorAll('a'))) {
      const href = link.getAttribute('href') ?? '';
      expect(href.startsWith('/') || href.startsWith('#')).toBe(true);
    }
  });

  it('output, a failure reason and a runner name are shown as text, never as markup or a live link', async () => {
    const run = liveRun({
      steps: [
        step('verify', {
          status: 'FAILED',
          attempts: 1,
          reason: markup,
          history: [attempt(1, 'FAILED', 0, 3, markup)],
          runners: [runner({ spanId: 's9', name: markup, model: scriptUrl })],
          output: [markup, `[open](${scriptUrl})`, scriptUrl],
        }),
      ],
      structure: undefined,
    });
    const { container } = render(h(App, appProps(fakeClient({ run }), '/runs/r1', '?step=verify')));
    await screen.findByRole('heading', { level: 2, name: /task-pipeline/ });
    expect(screen.getAllByText(markup, { exact: false }).length).toBeGreaterThan(0);
    expect(container.querySelector(FOREIGN)).toBeNull();
    for (const link of Array.from(container.querySelectorAll('a'))) {
      expect(link.getAttribute('href') ?? '').not.toContain(scriptUrl);
    }
    expect(container.innerHTML).not.toContain('src="x"');
  });
});

describe('a run with every state, a step that retries itself and records the page cannot read (T-13)', () => {
  const states = [
    'COMPLETED',
    'RUNNING',
    'VALIDATING',
    'FAILED',
    'ESCALATED',
    'CANCELLED',
    'PENDING',
    'REWOUND',
  ];
  const words = [
    'completed',
    'running',
    'checking',
    'failed',
    'escalated',
    'cancelled',
    'pending',
    'unknown',
  ];
  const ids = states.map((s) => s.toLowerCase());
  const run = liveRun({
    status: 'running',
    structure: ids.map((id, i) => ({
      id,
      dependsOn: i === 0 ? [] : [ids[i - 1] as string],
      onFailure: id === 'failed' ? { action: 'retry_step', target: 'failed', maxRetries: 2 } : undefined,
    })),
    steps: states.map((status, i) =>
      step(ids[i] as string, {
        status,
        attempts: status === 'FAILED' ? 2 : 1,
        history:
          status === 'FAILED'
            ? [attempt(1, 'FAILED', 0, 1, 'first'), attempt(2, 'FAILED', 2, 3, 'second')]
            : [attempt(1, status, 0, 1)],
      }),
    ),
    notes: ['a record of a kind this view does not know: future_event'],
  });

  it('names every state in words in the step list, the unknown one as unknown', async () => {
    render(h(App, appProps(fakeClient({ run }), '/runs/r1')));
    await screen.findByRole('heading', { level: 2, name: /task-pipeline/ });
    const grid = screen.getByLabelText('Steps of this run. Select a step to open it.');
    for (const word of words) {
      expect(within(grid).getAllByText(word).length, word).toBeGreaterThan(0);
    }
  });

  it('draws the loop of a step that retries itself, with the retries it used', () => {
    const graph = buildGraph(run);
    expect(graph.edges.filter((e) => e.kind === 'failure')).toEqual([
      expect.objectContaining({ source: 'failed', target: 'failed', retries: { used: 2, max: 2 } }),
    ]);
    expect(graph.nodes.map((n) => n.id)).toEqual(ids);
  });

  it('lists what it could not read as plain notes instead of failing', async () => {
    render(h(App, appProps(fakeClient({ run }), '/runs/r1')));
    expect(await screen.findByText('Records this page could not read')).toBeTruthy();
    expect(screen.getByText('a record of a kind this view does not know: future_event').tagName).toBe('LI');
  });
});

describe('the graph on a phone (answer 5)', () => {
  /** A `matchMedia` that says narrow until told otherwise, and tells its listeners when that changes. */
  function fakeMedia(initial: boolean) {
    let matches = initial;
    const listeners = new Set<() => void>();
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      get matches() {
        return query === NARROW && matches;
      },
      media: query,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    })) as unknown as typeof window.matchMedia;
    return {
      set(next: boolean) {
        matches = next;
        for (const listener of listeners) listener();
      },
      restore() {
        window.matchMedia = original;
      },
      listeners,
    };
  }

  it('runs top to bottom below 640 px, and turns back when the screen widens', async () => {
    const media = fakeMedia(true);
    try {
      const { container } = render(h(App, appProps(fakeClient({}), '/runs/r1')));
      await screen.findByRole('heading', { level: 2, name: /task-pipeline/ });
      await waitFor(() => expect(container.querySelector('.react-flow__handle-top')).not.toBeNull());
      expect(container.querySelector('.react-flow__handle-left')).toBeNull();
      act(() => media.set(false));
      await waitFor(() => expect(container.querySelector('.react-flow__handle-left')).not.toBeNull());
      expect(container.querySelector('.react-flow__handle-top')).toBeNull();
      cleanup();
      expect(media.listeners.size).toBe(0);
    } finally {
      media.restore();
    }
  });

  it('keeps the wide layout where the browser cannot say how wide it is', () => {
    const original = window.matchMedia;
    Reflect.deleteProperty(window, 'matchMedia');
    try {
      const { result } = renderHook(() => useMediaQuery(NARROW));
      expect(result.current).toBe(false);
    } finally {
      window.matchMedia = original;
    }
  });
});
