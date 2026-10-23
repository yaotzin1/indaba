// @vitest-environment happy-dom
import type {
  DiscussionView,
  RunSnapshot,
  RunSummary,
  ServerStreamEvent,
  StartRunRequest,
  StartStatusResponse,
  WorkflowListResponse,
  WorkflowProblem,
  WorkflowSourceResponse,
} from '@indaba/core';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ApiFailure,
  type Client,
  type Failure,
  type SaveSourceAnswer,
  type StartAnswer,
  type StopAnswer,
  type StreamHandlers,
} from '../src/client.js';
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
  starts: StartRunRequest[];
  statuses: string[];
  stops: string[];
  saves: { text: string; baseHash: string }[];
  checks: string[];
}

function fakeClient(options: {
  readonly runs?: readonly RunSummary[];
  readonly run?: RunSnapshot | Failure;
  readonly contract?: string | Failure;
  readonly discussion?: DiscussionView | 'none' | 'fail';
  readonly canStop?: boolean;
  readonly workflows?: WorkflowListResponse;
  readonly startRun?: (workflowId: string, confirmedHash: string | undefined) => StartAnswer | undefined;
  readonly startStatus?: (call: number) => StartStatusResponse;
  readonly stopRun?: StopAnswer;
  readonly source?: WorkflowSourceResponse | Failure;
  readonly save?: (text: string, baseHash: string) => SaveSourceAnswer;
  readonly check?: (text: string) => readonly WorkflowProblem[];
}): FakeClient {
  let runHandlers: StreamHandlers<RunSnapshot> | undefined;
  let serverHandlers: StreamHandlers<ServerStreamEvent> | undefined;
  const client: FakeClient = {
    runCalls: 0,
    starts: [],
    statuses: [],
    stops: [],
    saves: [],
    checks: [],
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
      return { run: r, canStop: options.canStop === true };
    },
    async workflows() {
      return options.workflows;
    },
    async startRun(workflowId, confirmedHash) {
      client.starts.push(confirmedHash === undefined ? { workflowId } : { workflowId, confirmedHash });
      return options.startRun?.(workflowId, confirmedHash) ?? { kind: 'started', startId: 'web-1' };
    },
    async startStatus(startId) {
      client.statuses.push(startId);
      return options.startStatus?.(client.statuses.length) ?? { state: 'running', runId: 'newer0000000000' };
    },
    async stopRun(runId) {
      client.stops.push(runId);
      return options.stopRun ?? { kind: 'stopping' };
    },
    async workflowSource(id) {
      const source = options.source;
      if (source === undefined)
        throw new ApiFailure({ kind: 'not_found', message: 'This workflow is no longer in the project.' });
      if ('kind' in source) throw new ApiFailure(source);
      return { ...source, workflow: { ...source.workflow, id } };
    },
    async saveWorkflowSource(_id, text, baseHash) {
      client.saves.push({ text, baseHash });
      return options.save?.(text, baseHash) ?? { kind: 'saved', contentHash: 'd'.repeat(64), problems: [] };
    },
    async checkWorkflow(text) {
      client.checks.push(text);
      return options.check === undefined ? undefined : options.check(text);
    },
    // A server without the form's editor (specs/web-app-editing-forms): these tests are of the source view.
    editor: async () => undefined,
    editWorkflow: async () => {
      throw new Error('not in this test');
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
    async loggingSettings() {
      return undefined;
    },
    async checkLoggingSettings() {
      return [];
    },
    async saveLoggingSettings() {
      return { saved: false, message: 'not in this test', problems: [] };
    },
    async testLogSink() {
      return { ok: false, text: 'not in this test' };
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

  it('opens a run from its link with one history entry, so Back leaves it at once', async () => {
    render(h(App, appProps(fakeClient({ runs: RUNS }))));
    const grid = await screen.findByRole('grid');
    const before = window.history.length;
    fireEvent.click(within(grid).getByText('task-pipeline'));
    await screen.findByRole('heading', { level: 2, name: /task-pipeline/ });
    expect(window.history.length).toBe(before + 1);
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
    expect(rows).toEqual(['rfc1' + '8.1k / 2.4k' + '$0.21', 'code1' + 'unknown' + 'unknown']);
    expect(within(table).getByText('8.1k / 2.4k').getAttribute('aria-label')).toBe('8.1k in, 2.4k out');
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
      'debate0 (1 still running)' + 'unknown' + 'unknown',
      'review1 (1 still running)' + 'unknown' + '$0.50',
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

describe('Run a workflow (T-16, AC-07, AC-13, AC-14)', () => {
  const VALID = {
    id: 'w1',
    name: 'demo',
    path: 'demo.workflow.ai.yml',
    project: 'shop',
    valid: true,
    problems: [],
  };
  const BROKEN = {
    id: 'w2',
    name: 'broken',
    path: 'ci/broken.workflow.ai.yml',
    project: 'shop',
    valid: false,
    problems: ['step "x" has no runner'],
  };
  const USE = {
    runners: ['shell', 'acp'],
    commands: ['build: npm test', 'role coder: my-agent --serve'],
    permissions: ['build: runner default (unrestricted)'],
    needsPerson: ['argue'],
  };
  const HASH = 'f'.repeat(64);

  function runnable(extra: Parameters<typeof fakeClient>[0] = {}) {
    return fakeClient({ runs: RUNS, workflows: { workflows: [VALID, BROKEN], truncated: false }, ...extra });
  }

  async function openPanel(client: FakeClient) {
    render(h(App, { ...appProps(client), pollMs: 5 }));
    const button = await screen.findByRole('button', { name: 'Run a workflow' });
    fireEvent.click(button);
    return { button, dialog: await screen.findByRole('dialog', { name: 'Run a workflow' }) };
  }

  it('offers no Run button and says read-only when the server starts no runs', async () => {
    render(h(App, appProps(fakeClient({ runs: RUNS }))));
    await screen.findByText('task-pipeline');
    expect(screen.queryByRole('button', { name: 'Run a workflow' })).toBeNull();
    expect(screen.getByText('Read-only')).toBeTruthy();
  });

  it('lists the workflows; one with problems cannot be run and says why', async () => {
    const client = runnable();
    const { dialog } = await openPanel(client);
    expect(screen.queryByText('Read-only')).toBeNull();
    expect(screen.getByText('Runs and stops')).toBeTruthy();
    const list = await within(dialog).findByRole('list', { name: 'Workflows found in the projects served' });
    expect(within(list).getByText('demo.workflow.ai.yml in shop')).toBeTruthy();
    const broken = within(dialog).getByRole('button', { name: 'Run broken' }) as HTMLButtonElement;
    expect(broken.disabled).toBe(true);
    const described = document.getElementById(broken.getAttribute('aria-describedby') ?? '');
    expect(described?.textContent).toContain('step "x" has no runner');
    expect(within(dialog).getByText(/closing it, or Ctrl\+C in its terminal, cancels them/)).toBeTruthy();
  });

  it('closes on Escape and gives focus back to the button that opened it', async () => {
    const { button, dialog } = await openPanel(runnable());
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('keeps focus inside the dialog', async () => {
    const { dialog } = await openPanel(runnable());
    await within(dialog).findByRole('button', { name: 'Run demo' });
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled])')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    last?.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    first?.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('shows what a first run will use, runs it on confirmation, and opens its run (AC-04, AC-08)', async () => {
    let call = 0;
    const client = runnable({
      startRun: (_id, hash) =>
        hash === undefined ? { kind: 'confirm', contentHash: HASH, use: USE } : undefined,
      startStatus: () =>
        ++call < 3 ? { state: 'starting' } : { state: 'running', runId: 'newer0000000000' },
    });
    const { dialog } = await openPanel(client);
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Run demo' }));
    const title = await within(dialog).findByRole('heading', { name: 'Before demo runs for the first time' });
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(within(dialog).getByText('build: npm test').tagName).toBe('CODE');
    expect(within(dialog).getByText('build: runner default (unrestricted)')).toBeTruthy();
    expect(within(dialog).getByText('argue')).toBeTruthy();
    expect(within(dialog).getByText(/cannot ask you and end as escalated/)).toBeTruthy();
    expect(within(dialog).getByText(/does not cover scripts a command calls/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Run it' }));
    await within(dialog).findByRole('status');
    expect(within(dialog).getByText('Starting demo...')).toBeTruthy();
    await waitFor(() => expect(window.location.pathname).toBe('/runs/newer0000000000'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(client.starts).toEqual([{ workflowId: 'w1' }, { workflowId: 'w1', confirmedHash: HASH }]);
    expect(client.statuses.length).toBe(3);
  });

  it('sends one start for a double click (AC-07)', async () => {
    let release: (answer: StartAnswer) => void = () => undefined;
    const client = runnable();
    client.startRun = async (workflowId) => {
      client.starts.push({ workflowId });
      return new Promise<StartAnswer>((resolve) => {
        release = resolve;
      });
    };
    const { dialog } = await openPanel(client);
    const run = await within(dialog).findByRole('button', { name: 'Run demo' });
    fireEvent.click(run);
    fireEvent.click(run);
    expect(client.starts).toHaveLength(1);
    await act(async () => release({ kind: 'refused', code: 'too_many_runs', problems: [] }));
  });

  it('says a refusal in plain words with the next action, never a status (AC-14)', async () => {
    const client = runnable({
      startRun: () => ({ kind: 'refused', code: 'workflow_invalid', problems: ['steps is missing'] }),
    });
    const { dialog } = await openPanel(client);
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Run demo' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('This workflow has problems, so it cannot run.');
    expect(alert.textContent).toContain('steps is missing');
    expect(alert.textContent).toContain('Fix the problems shown, then try again.');
    expect(alert.textContent).not.toMatch(/\b4\d\d\b/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to the list' }));
    await within(dialog).findByRole('button', { name: 'Run demo' });

    client.startRun = async () => ({ kind: 'refused', code: 'something_new', problems: [] });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run demo' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'The server did not start this run.',
    );
  });

  it('shows why a run that never started failed, and offers to try again (AC-15)', async () => {
    const client = runnable({
      startStatus: () => ({ state: 'failed', failure: 'OPENROUTER_API_KEY is not set' }),
    });
    const { dialog } = await openPanel(client);
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Run demo' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('The run did not start');
    expect(alert.textContent).toContain('OPENROUTER_API_KEY is not set');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(client.starts).toHaveLength(2));
  });

  it('tells the person once a session that closing indaba ui stops the runs (AC-11)', async () => {
    const client = runnable({ startStatus: () => ({ state: 'starting' }) });
    const { dialog } = await openPanel(client);
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Run demo' }));
    await within(dialog).findByText('Starting demo...');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Run a workflow' }));
    const again = await screen.findByRole('dialog');
    await within(again).findByRole('button', { name: 'Run demo' });
    expect(within(again).queryByText(/cancels them/)).toBeNull();
  });

  it('says so when no workflow was found, or the search stopped at its limit', async () => {
    const client = fakeClient({ runs: [], workflows: { workflows: [], truncated: true } });
    render(h(App, appProps(client)));
    expect(await screen.findByText(/Run a workflow from here, or start one in a terminal/)).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Run a workflow' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/No workflow file was found/)).toBeTruthy();
    expect(within(dialog).getByText(/the search stopped at its limit/)).toBeTruthy();
  });
});

describe('Stop (T-17, AC-09, AC-10, AC-13)', () => {
  it('offers Stop only for a live run this server started', async () => {
    render(h(App, appProps(fakeClient({ canStop: false }), '/runs/r1')));
    await screen.findByRole('heading', { name: /task-pipeline/ });
    expect(screen.queryByRole('button', { name: /Stop/ })).toBeNull();
    cleanup();
    render(
      h(App, appProps(fakeClient({ canStop: true, run: liveRun({ status: 'completed' }) }), '/runs/r1')),
    );
    await screen.findByRole('heading', { name: /task-pipeline/ });
    expect(screen.queryByRole('button', { name: /Stop/ })).toBeNull();
  });

  it('names the run and asks first; keeping it running sends nothing', async () => {
    const client = fakeClient({ canStop: true });
    render(h(App, appProps(client, '/runs/r1')));
    const stop = await screen.findByRole('button', { name: 'Stop the run of task-pipeline' });
    fireEvent.click(stop);
    const ask = await screen.findByRole('alertdialog', { name: 'Stop task-pipeline?' });
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Stop task-pipeline?'));
    expect(ask.textContent).toContain('its worktree is removed');
    fireEvent.keyDown(ask, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Stop the run of task-pipeline' }),
    );
    expect(client.stops).toEqual([]);
  });

  it('stops on confirmation, says it is stopping, and goes when the run has ended', async () => {
    const client = fakeClient({ canStop: true });
    render(h(App, appProps(client, '/runs/r1')));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop the run of task-pipeline' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop the run' }));
    expect(await screen.findByText('Stopping...')).toBeTruthy();
    expect(client.stops).toEqual(['r1']);
    act(() => client.push(liveRun({ status: 'cancelled', endedAt: T(31) })));
    await waitFor(() => expect(screen.queryByText('Stopping...')).toBeNull());
    expect(screen.queryByRole('button', { name: /Stop/ })).toBeNull();
  });

  it('says plainly when the run cannot be stopped from here', async () => {
    const client = fakeClient({ canStop: true, stopRun: { kind: 'refused', code: 'not_started_here' } });
    render(h(App, appProps(client, '/runs/r1')));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop the run of task-pipeline' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop the run' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'can only be stopped where it was started',
    );
  });
});

describe('the source view (T-10, T-11, AC-09 to AC-13)', () => {
  const TEXT = 'version: "1.0"\nname: demo\nsteps:\n  - id: a\n';
  const HASH = 'a'.repeat(64);
  const WF = {
    id: 'w1',
    name: 'demo',
    path: 'demo.workflow.ai.yml',
    project: 'shop',
    valid: true,
    problems: [],
  };
  const SOURCE: WorkflowSourceResponse = { workflow: WF, text: TEXT, contentHash: HASH, problems: [] };

  function editable(extra: Parameters<typeof fakeClient>[0] = {}) {
    return fakeClient({
      runs: RUNS,
      workflows: { workflows: [WF], truncated: false },
      source: SOURCE,
      check: () => [],
      ...extra,
    });
  }

  function open(client: FakeClient, confirm: (m: string) => boolean = () => true) {
    const props = appProps(client, `/workflows/${WF.id}`);
    const win = Object.assign(Object.create(window) as typeof window, {
      confirm,
      location: window.location,
      history: window.history,
      addEventListener: window.addEventListener.bind(window),
      removeEventListener: window.removeEventListener.bind(window),
    });
    render(h(App, { ...props, win, checkDelayMs: 5, pollMs: 5 }));
  }

  const editor = async () => (await screen.findByLabelText('The workflow file')) as HTMLTextAreaElement;

  it('opens from Edit in the Run panel, by an address of its own', async () => {
    const client = editable();
    render(h(App, appProps(client)));
    fireEvent.click(await screen.findByRole('button', { name: 'Run a workflow' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Edit demo' }));
    expect(window.location.pathname).toBe('/workflows/w1');
    expect(await screen.findByRole('heading', { name: 'Edit demo' })).toBeTruthy();
    expect((await editor()).value).toBe(TEXT);
  });

  it('offers no Edit when the server does not open files', async () => {
    render(h(App, appProps(fakeClient({ runs: RUNS, workflows: { workflows: [WF], truncated: false } }))));
    fireEvent.click(await screen.findByRole('button', { name: 'Run a workflow' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('button', { name: 'Run demo' });
    expect(within(dialog).queryByRole('button', { name: 'Edit demo' })).toBeNull();
  });

  it('shows the text with line numbers and the file it is', async () => {
    open(editable());
    await editor();
    expect(screen.getByText('demo.workflow.ai.yml in shop')).toBeTruthy();
    const gutter = document.querySelector('.source-gutter');
    expect(gutter?.textContent).toBe('12345');
    expect(screen.getByText('No problems: indaba validate would accept this.')).toBeTruthy();
  });

  it('checks a draft after a pause and shows only the latest answer', async () => {
    const client = editable({
      check: (text) =>
        text.includes('[') ? [{ message: 'invalid YAML: at line 2, column 3', line: 2, column: 3 }] : [],
    });
    open(client);
    const area = await editor();
    fireEvent.change(area, { target: { value: `${TEXT}x: [` } });
    expect(await screen.findByText('Not saved yet.')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'One problem' })).toBeTruthy();
    expect(client.checks.at(-1)).toBe(`${TEXT}x: [`);
  });

  it('puts the caret at a problem’s line and column', async () => {
    const client = editable({
      source: { ...SOURCE, problems: [{ message: 'invalid YAML: here', line: 2, column: 3 }] },
    });
    open(client);
    const area = await editor();
    fireEvent.click(await screen.findByRole('button', { name: 'Go to line 2: invalid YAML: here' }));
    expect(document.activeElement).toBe(area);
    expect(area.selectionStart).toBe(TEXT.indexOf('name') + 2);
  });

  it('indents with Tab, and lets Tab leave after Escape, so the keyboard is never trapped', async () => {
    open(editable());
    const area = await editor();
    area.focus();
    area.setSelectionRange(0, 0);
    expect(fireEvent.keyDown(area, { key: 'Tab' })).toBe(false);
    expect(area.value.startsWith('  version')).toBe(true);
    fireEvent.keyDown(area, { key: 'Escape' });
    expect(fireEvent.keyDown(area, { key: 'Tab' })).toBe(true);
  });

  it('saves against the hash it read, says so, and offers Run once the saved file is valid (AC-03, AC-09)', async () => {
    const client = editable();
    open(client);
    const area = await editor();
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    const run = screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(area, { target: { value: `${TEXT}# note\n` } });
    expect(run.disabled).toBe(true);
    fireEvent.click(save);
    await waitFor(() => expect(client.saves).toEqual([{ text: `${TEXT}# note\n`, baseHash: HASH }]));
    expect(await screen.findByText('Saved.')).toBeTruthy();
    await waitFor(() => expect(run.disabled).toBe(false));
    // The next save starts from the new hash.
    fireEvent.change(area, { target: { value: `${TEXT}# again\n` } });
    fireEvent.click(save);
    await waitFor(() => expect(client.saves.at(-1)?.baseHash).toBe('d'.repeat(64)));
  });

  it('runs the saved workflow from its own Run, through the confirmation (AC-07)', async () => {
    const client = editable({
      startRun: (_id, hash) =>
        hash === undefined
          ? {
              kind: 'confirm',
              contentHash: HASH,
              use: { runners: ['shell'], commands: [], permissions: [], needsPerson: [] },
            }
          : undefined,
    });
    open(client);
    await editor();
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByRole('heading', { name: 'Before demo runs for the first time' }),
    ).toBeTruthy();
    expect(client.starts).toEqual([{ workflowId: 'w1' }]);
  });

  it('says a text saved with problems cannot run until they are fixed (C-01)', async () => {
    const client = editable({
      save: () => ({
        kind: 'saved',
        contentHash: 'e'.repeat(64),
        problems: [{ message: 'steps is missing' }],
      }),
    });
    open(client);
    const area = await editor();
    fireEvent.change(area, { target: { value: 'name: x\n' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved, with problems: it cannot run until they are fixed.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('steps is missing')).toBeTruthy();
  });

  it('lets no check of an older draft replace what the save answered', async () => {
    let answerCheck: (problems: readonly WorkflowProblem[]) => void = () => undefined;
    const client = editable({
      save: () => ({
        kind: 'saved',
        contentHash: 'e'.repeat(64),
        problems: [{ message: 'steps is missing' }],
      }),
    });
    client.checkWorkflow = async (text) => {
      client.checks.push(text);
      return new Promise((resolve) => {
        answerCheck = resolve;
      });
    };
    open(client);
    const area = await editor();
    fireEvent.change(area, { target: { value: 'name: x\n' } });
    // The check of the draft starts, and has not answered when Save is pressed.
    await waitFor(() => expect(client.checks).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('steps is missing')).toBeTruthy();
    await act(async () => answerCheck([]));
    expect(screen.getByText('steps is missing')).toBeTruthy();
  });

  it('shows a conflict with the disk’s version and lets the person choose (AC-04, AC-12)', async () => {
    const DISK = 'version: "1.0"\nname: theirs\nsteps: []\n';
    const client = editable({
      save: (_t, base) =>
        base === HASH
          ? { kind: 'changed', current: { text: DISK, contentHash: 'f'.repeat(64) } }
          : { kind: 'saved', contentHash: 'd'.repeat(64), problems: [] },
    });
    open(client);
    const area = await editor();
    fireEvent.change(area, { target: { value: `${TEXT}# mine\n` } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The file changed on disk after you opened it');
    expect((within(alert).getByLabelText('The version on disk') as HTMLTextAreaElement).value).toBe(DISK);
    expect(area.value).toBe(`${TEXT}# mine\n`);
    fireEvent.click(within(alert).getByRole('button', { name: 'Keep mine and save' }));
    await waitFor(() =>
      expect(client.saves.at(-1)).toEqual({ text: `${TEXT}# mine\n`, baseHash: 'f'.repeat(64) }),
    );
    await waitFor(() =>
      expect(screen.queryByText('The file changed on disk after you opened it')).toBeNull(),
    );
  });

  it('takes the disk’s version when the person chooses it', async () => {
    const DISK = 'version: "1.0"\nname: theirs\nsteps: []\n';
    const client = editable({
      save: () => ({ kind: 'changed', current: { text: DISK, contentHash: 'f'.repeat(64) } }),
    });
    open(client);
    const area = await editor();
    fireEvent.change(area, { target: { value: 'mine' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use the version on disk' }));
    await waitFor(() => expect(area.value).toBe(DISK));
    expect(screen.getByText('Saved.')).toBeTruthy();
  });

  it('says plainly when a save was refused, and keeps the person’s text', async () => {
    const client = editable({ save: () => ({ kind: 'refused', code: 'not_saved' }) });
    open(client);
    const area = await editor();
    fireEvent.change(area, { target: { value: 'mine' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'The file could not be saved; it is as it was.',
    );
    expect(area.value).toBe('mine');
  });

  it('asks before leaving with unsaved changes, by Back or the header (AC-11)', async () => {
    const asked: string[] = [];
    let answer = false;
    open(editable(), (message) => {
      asked.push(message);
      return answer;
    });
    const area = await editor();
    fireEvent.click(screen.getByRole('link', { name: '← Runs' }));
    expect(asked).toEqual([]);
    expect(window.location.pathname).toBe('/');
    cleanup();
    open(editable(), (message) => {
      asked.push(message);
      return answer;
    });
    fireEvent.change(await editor(), { target: { value: 'changed' } });
    fireEvent.click(screen.getByRole('link', { name: '← Runs' }));
    expect(asked).toHaveLength(1);
    expect(window.location.pathname).toBe('/workflows/w1');
    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
    expect(asked).toHaveLength(2);
    expect(window.location.pathname).toBe('/workflows/w1');
    answer = true;
    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
    expect(window.location.pathname).toBe('/settings');
    expect(area).toBeTruthy();
  });

  it('says why a file cannot be opened', async () => {
    open(
      editable({
        source: {
          kind: 'server',
          message: 'This workflow file is larger than 1 MiB, so the page does not open or save it.',
        },
      }),
    );
    expect((await screen.findByRole('alert')).textContent).toContain('larger than 1 MiB');
    expect(screen.queryByLabelText('The workflow file')).toBeNull();
  });
});
