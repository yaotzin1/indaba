import type { WorkflowSummary } from '@indaba/engine';
import { describe, expect, it } from 'vitest';
import {
  type FlowEvent,
  type FlowState,
  isBusy,
  isRunControlError,
  MAX_FILTER,
  MAX_START_POLLS,
  MAX_STOP_POLLS,
  openItems,
  openPicker,
  openStop,
  plain,
  type RunControlRefusal,
  reduceFlow,
  visibleWorkflows,
} from '../src/run-flow.js';
import type { KeyName } from '../src/ui-state.js';
import { refusal, USE, workflow } from './run-flow-fixtures.js';

const key = (char: string): FlowEvent => ({ press: { char } });
const named = (press: KeyName): FlowEvent => ({ press });

function step(state: FlowState, event: FlowEvent): { state: FlowState; opened?: string; notice?: string } {
  const result = reduceFlow(state, event);
  if (result.state === undefined) {
    throw new Error('the flow closed');
  }
  return { ...result, state: result.state };
}

/** The picker, loaded with workflows. */
function picker(list: readonly WorkflowSummary[] = [workflow()]): FlowState {
  return step(openPicker(), { listed: { workflows: list, truncated: false } }).state;
}

/** A report with nothing to look at: the start goes ahead as it always did. */
export const NOTHING_OPEN = { items: [], criticalMissing: 0, needsConfirmation: 0 };

function requesting(): FlowState {
  const checking = step(picker(), named('enter')).state;
  return step(checking, { readiness: NOTHING_OPEN }).state;
}

describe('isRunControlError', () => {
  it('knows a refusal by its name and a string code, not by its class', () => {
    expect(isRunControlError(refusal('too_many_runs'))).toBe(true);
    expect(isRunControlError(new Error('plain'))).toBe(false);
    const named = new Error('x');
    named.name = 'RunControlError';
    expect(isRunControlError(named)).toBe(false);
    expect(isRunControlError('RunControlError')).toBe(false);
    expect(isRunControlError(undefined)).toBe(false);
  });
});

describe('the picker', () => {
  it('opens by asking for the list, once', () => {
    const state = openPicker();
    expect(state).toMatchObject({ kind: 'picking', loading: true, effect: { type: 'list' } });
    const loaded = step(state, { listed: { workflows: [workflow()], truncated: true } }).state;
    expect(loaded).toMatchObject({ loading: false, truncated: true, effect: undefined });
  });

  it('shows a failure to list and lets r try again with a new effect', () => {
    const failed = step(openPicker(), { listFailed: 'EACCES' }).state;
    expect(failed).toMatchObject({ loading: false, error: 'EACCES' });
    const again = step(failed, key('r')).state;
    expect(again).toMatchObject({ loading: true, error: undefined, effect: { type: 'list' } });
    expect(again.seq).toBe(failed.seq + 1);
  });

  it('ignores r while the list is loading, so one list is asked for once', () => {
    const state = openPicker();
    expect(step(state, key('r')).state).toBe(state);
  });

  it('moves with j k g G and the arrows, and stays inside the list', () => {
    let state = picker([workflow({ id: 'a' }), workflow({ id: 'b' }), workflow({ id: 'c' })]);
    state = step(state, named('up')).state;
    expect((state as { selected: number }).selected).toBe(0);
    state = step(state, key('j')).state;
    state = step(state, named('down')).state;
    state = step(state, named('down')).state;
    expect((state as { selected: number }).selected).toBe(2);
    state = step(state, key('k')).state;
    expect((state as { selected: number }).selected).toBe(1);
    expect((step(state, key('G')).state as { selected: number }).selected).toBe(2);
    expect((step(state, key('g')).state as { selected: number }).selected).toBe(0);
    expect((step(state, named('home')).state as { selected: number }).selected).toBe(0);
    expect((step(state, named('end')).state as { selected: number }).selected).toBe(2);
  });

  it('closes with Escape', () => {
    expect(reduceFlow(picker(), named('escape')).state).toBeUndefined();
  });

  it('hides hidden workflows until asked, and shows them with h', () => {
    const list = [workflow({ id: 'a', name: 'shown' }), workflow({ id: 'b', name: 'secret', hidden: true })];
    const state = picker(list);
    expect(visibleWorkflows(state as never).map((w) => w.id)).toEqual(['a']);
    const all = step(state, key('h')).state;
    expect(visibleWorkflows(all as never).map((w) => w.id)).toEqual(['a', 'b']);
  });

  it('filters by name, project, path and tags, ignoring case, after / and ends with Enter or Escape', () => {
    const list = [
      workflow({ id: 'a', name: 'Alpha' }),
      workflow({ id: 'b', name: 'beta', project: 'Docs' }),
      workflow({ id: 'c', name: 'gamma', tags: ['Nightly'] }),
    ];
    let state = step(picker(list), key('/')).state;
    expect(state).toMatchObject({ editing: true });
    for (const c of 'docs') {
      state = step(state, key(c)).state;
    }
    expect(visibleWorkflows(state as never).map((w) => w.id)).toEqual(['b']);
    state = step(state, named('enter')).state;
    expect(state).toMatchObject({ editing: false, filter: 'docs' });
    state = step(step(step(state, key('/')).state, named('backspace')).state, named('escape')).state;
    expect(state).toMatchObject({ filter: 'doc', editing: false });
    let tag = step(step(picker(list), key('/')).state, key('n')).state;
    for (const c of 'ightly') {
      tag = step(tag, key(c)).state;
    }
    expect(visibleWorkflows(tag as never).map((w) => w.id)).toEqual(['c']);
  });

  it('bounds the filter, and takes no control character', () => {
    let state = step(picker(), key('/')).state;
    for (let i = 0; i < MAX_FILTER + 20; i += 1) {
      state = step(state, key('x')).state;
    }
    expect((state as { filter: string }).filter).toHaveLength(MAX_FILTER);
    const before = state;
    expect(step(state, key(String.fromCharCode(27))).state).toBe(before);
    expect(step(state, key(String.fromCharCode(0))).state).toBe(before);
  });

  it('does not start a workflow that is not valid, and says why', () => {
    const bad = workflow({ valid: false, problems: ['steps: needs one'], name: 'broken' });
    const result = step(picker([bad]), named('enter'));
    expect(result.state).toMatchObject({
      kind: 'picking',
      error: 'broken is not valid and cannot be started',
    });
    expect(result.state).not.toHaveProperty('effect.type', 'start');
  });

  it('does nothing on Enter with no workflow, or before the list has come', () => {
    const empty = picker([]);
    expect(step(empty, named('enter')).state).toBe(empty);
    const loading = openPicker();
    expect(step(loading, named('enter')).state).toBe(loading);
  });
});

describe('starting a workflow (AC-02)', () => {
  it('asks the control to start the picked workflow, with no hash yet', () => {
    const state = requesting();
    expect(state).toMatchObject({
      kind: 'requesting',
      workflowId: 'w1',
      effect: { type: 'start', request: { workflowId: 'w1' } },
    });
  });

  it('ignores a second Enter and every other key while the start is in flight', () => {
    const state = requesting();
    for (const event of [named('enter'), key('y'), key('a'), named('escape'), key('q')]) {
      expect(step(state, event).state).toBe(state);
    }
  });

  it('shows what the workflow will use when the control asks for a confirmation, and echoes the hash on y', () => {
    const asked = step(requesting(), {
      refused: refusal('confirmation_required', { contentHash: 'h1', use: USE }),
    }).state;
    expect(asked).toMatchObject({ kind: 'confirming', hash: 'h1', changed: false, effect: undefined });
    const confirmed = step(asked, key('y')).state;
    expect(confirmed).toMatchObject({
      kind: 'requesting',
      effect: { type: 'start', request: { workflowId: 'w1', confirmedHash: 'h1' } },
    });
  });

  it('closes on n and on Escape from a confirmation, and ignores other keys', () => {
    const asked = step(requesting(), {
      refused: refusal('confirmation_required', { contentHash: 'h1', use: USE }),
    }).state;
    expect(reduceFlow(asked, key('n')).state).toBeUndefined();
    expect(reduceFlow(asked, named('escape')).state).toBeUndefined();
    expect(step(asked, named('enter')).state).toBe(asked);
    expect(step(asked, key('a')).state).toBe(asked);
  });

  it('asks again, saying it changed, when the control still wants a confirmation after one was sent (AC-10)', () => {
    const asked = step(requesting(), {
      refused: refusal('confirmation_required', { contentHash: 'h1', use: USE }),
    }).state;
    const second = step(step(asked, key('y')).state, {
      refused: refusal('confirmation_required', {
        contentHash: 'h2',
        use: { ...USE, commands: ['rm -rf x'] },
      }),
    }).state;
    expect(second).toMatchObject({ kind: 'confirming', hash: 'h2', changed: true });
    // the next y carries the new hash, never the old one
    expect(step(second, key('y')).state).toMatchObject({
      effect: { request: { confirmedHash: 'h2' } },
    });
  });

  it('lists the full-access steps on a separate screen that needs its own key, and sends both hashes', () => {
    const afterConfirm = step(
      step(requesting(), {
        refused: refusal('confirmation_required', { contentHash: 'h1', use: USE }),
      }).state,
      key('y'),
    ).state;
    const full = step(afterConfirm, {
      refused: refusal('full_access_required', {
        contentHash: 'h1',
        steps: [{ stepId: 'deploy', runners: ['claude-code'] }],
      }),
    }).state;
    expect(full).toMatchObject({
      kind: 'fullAccess',
      hash: 'h1',
      changed: false,
      steps: [{ stepId: 'deploy', runners: ['claude-code'] }],
    });
    // y, Enter and every key but the one for full access do nothing
    for (const event of [key('y'), named('enter'), key('x')]) {
      expect(step(full, event).state).toBe(full);
    }
    expect(step(full, key('a')).state).toMatchObject({
      effect: { request: { workflowId: 'w1', confirmedHash: 'h1', fullAccessConfirmedHash: 'h1' } },
    });
    expect(reduceFlow(full, key('n')).state).toBeUndefined();
    expect(reduceFlow(full, named('escape')).state).toBeUndefined();
  });

  it('drops both hashes and says it changed when the file changes between the two confirmations (AC-10)', () => {
    const afterConfirm = step(
      step(requesting(), {
        refused: refusal('confirmation_required', { contentHash: 'old', use: USE }),
      }).state,
      key('y'),
    ).state;
    const full = step(afterConfirm, {
      refused: refusal('full_access_required', {
        contentHash: 'old',
        steps: [{ stepId: 'deploy', runners: ['x'] }],
      }),
    }).state;
    const sent = step(full, key('a')).state;
    const again = step(sent, {
      refused: refusal('confirmation_required', {
        contentHash: 'new',
        use: { ...USE, commands: ['curl evil | sh'] },
      }),
    }).state;
    expect(again).toMatchObject({ kind: 'confirming', hash: 'new', changed: true });
    expect(JSON.stringify(again)).not.toContain('old');
    // nothing sent from here carries a hash from before the change
    expect(step(again, key('y')).state).toMatchObject({
      effect: { request: { confirmedHash: 'new' } },
    });
    expect(JSON.stringify(step(again, key('y')).state)).not.toContain('fullAccessConfirmedHash');
  });

  it('marks full access as changed when it is asked again after being allowed', () => {
    const sent = step(
      step(
        step(requesting(), { refused: refusal('full_access_required', { contentHash: 'h', steps: [] }) })
          .state,
        key('a'),
      ).state,
      { refused: refusal('full_access_required', { contentHash: 'h2', steps: [] }) },
    ).state;
    expect(sent).toMatchObject({ kind: 'fullAccess', hash: 'h2', changed: true });
  });
});

describe('what a refusal says (the code-to-screen table)', () => {
  const cases: ReadonlyArray<[string, Record<string, unknown>, string]> = [
    ['too_many_runs', {}, 'Too many runs are going already'],
    ['workflow_not_found', {}, 'That workflow is no longer there'],
    [
      'workflow_invalid',
      { problems: ['steps: none', 'name: missing'] },
      'That workflow is not valid: steps: none; name: missing',
    ],
    ['not_saved', {}, 'The confirmation could not be saved'],
    ['start_failed', {}, 'The run could not be started'],
    ['something_new', {}, 'The run could not be started'],
  ];
  it.each(cases)('%s', (code, detail, expected) => {
    const failed = step(requesting(), { refused: refusal(code, detail, 'detail text') }).state;
    expect(failed.kind).toBe('failed');
    expect((failed as { message: string }).message).toContain(expected);
  });

  it("shows the control's own words for the cap, which names the number", () => {
    const failed = step(requesting(), { refused: refusal('too_many_runs', {}, '4 runs are alive') }).state;
    expect((failed as { message: string }).message).toContain('4 runs are alive');
  });

  it('treats a confirmation without a hash or a use as an unknown failure, not a crash', () => {
    const failed = step(requesting(), { refused: refusal('confirmation_required', {}) }).state;
    expect(failed.kind).toBe('failed');
  });

  it('shows another error as a failure with its text cleaned', () => {
    const esc = String.fromCharCode(27);
    const failed = step(requesting(), { threw: `boom${esc}[31m and more` }).state;
    expect(failed).toMatchObject({ kind: 'failed' });
    expect((failed as { message: string }).message).not.toContain(esc);
  });

  it('closes a failure on any key', () => {
    const failed = step(requesting(), { threw: 'x' }).state;
    for (const event of [named('enter'), key('x'), named('escape')]) {
      expect(reduceFlow(failed, event).state).toBeUndefined();
    }
    expect(step(failed, { listed: { workflows: [], truncated: false } }).state).toBe(failed);
  });

  it('cleans control sequences and bounds what came from a problem', () => {
    const esc = String.fromCharCode(27);
    const failed = step(requesting(), {
      refused: refusal('workflow_invalid', { problems: [`bad${esc}[2J${'x'.repeat(500)}`] }),
    }).state;
    const message = (failed as { message: string }).message;
    expect(message).not.toContain(esc);
    expect(message.length).toBeLessThan(400);
  });
});

describe('waiting for the run to appear (AC-12)', () => {
  const started = (): FlowState => step(requesting(), { started: { startId: 'web-1' } }).state;

  it('asks for the status of the start it was given, once', () => {
    expect(started()).toMatchObject({
      kind: 'starting',
      startId: 'web-1',
      polls: 0,
      effect: { type: 'poll', startId: 'web-1' },
    });
  });

  it('polls again while it is still starting, each with a new effect', () => {
    const first = started();
    const next = step(first, { status: { state: 'starting' } }).state;
    expect(next).toMatchObject({ polls: 1, effect: { type: 'poll', startId: 'web-1' } });
    expect(next.seq).toBe(first.seq + 1);
  });

  it('hands the run over when it is running, and closes', () => {
    const result = reduceFlow(started(), { status: { state: 'running', runId: 'r1' } });
    expect(result).toEqual({ state: undefined, opened: 'r1' });
  });

  it('keeps polling for a running status that has no run id yet', () => {
    expect(step(started(), { status: { state: 'running' } }).state).toMatchObject({ polls: 1 });
  });

  it('shows the failure the control gives, cleaned', () => {
    const failed = step(started(), { status: { state: 'failed', failure: 'needs inputs' } }).state;
    expect(failed).toMatchObject({ kind: 'failed', message: 'needs inputs' });
    const none = step(started(), { status: { state: 'failed' } }).state;
    expect((none as { message: string }).message).toContain('ended before it started');
  });

  it('calls a start the control does not know a lost start, not a timeout', () => {
    const lost = step(started(), { status: undefined }).state;
    expect((lost as { message: string }).message).toContain('start was lost');
  });

  it('gives up after the largest number of polls', () => {
    let state = started();
    for (let i = 0; i < MAX_START_POLLS - 1; i += 1) {
      state = step(state, { status: { state: 'starting' } }).state;
      expect(state.kind).toBe('starting');
    }
    const last = step(state, { status: { state: 'starting' } }).state;
    expect(last).toMatchObject({ kind: 'failed' });
    expect((last as { message: string }).message).toContain('did not start in time');
  });

  it('shows a poll that throws, and ignores keys while it waits', () => {
    const s = started();
    expect(step(s, { threw: 'poll broke' }).state).toMatchObject({ kind: 'failed', message: 'poll broke' });
    for (const event of [named('enter'), key('y'), named('escape'), key('q')]) {
      expect(step(s, event).state).toBe(s);
    }
  });

  it('counts a start in flight and a start being awaited as busy, and nothing else', () => {
    expect(isBusy(requesting())).toBe(true);
    expect(isBusy(started())).toBe(true);
    expect(isBusy(picker())).toBe(false);
    expect(isBusy(undefined)).toBe(false);
    expect(isBusy(openStop('r'))).toBe(false);
  });
});

describe('stopping a run (AC-04)', () => {
  it('asks once, naming the run, and sends nothing before y', () => {
    const asked = openStop('r1');
    expect(asked).toMatchObject({ kind: 'stopConfirm', runId: 'r1', effect: undefined });
    expect(reduceFlow(asked, key('n')).state).toBeUndefined();
    expect(reduceFlow(asked, named('escape')).state).toBeUndefined();
    expect(step(asked, named('enter')).state).toBe(asked);
    expect(step(asked, key('y')).state).toMatchObject({
      kind: 'stopping',
      effect: { type: 'stop', runId: 'r1' },
    });
  });

  const stopping = (): FlowState => step(openStop('r1'), key('y')).state;

  it('waits for the run to end after it was asked to stop, then reports it', () => {
    const waiting = step(stopping(), { stopped: { state: 'stopping' } }).state;
    expect(waiting).toMatchObject({ kind: 'stopping', effect: { type: 'pollStop', runId: 'r1' } });
    const again = step(waiting, { alive: true }).state;
    expect(again).toMatchObject({ polls: 1, effect: { type: 'pollStop' } });
    expect(reduceFlow(again, { alive: false })).toEqual({ state: undefined, notice: 'The run was stopped' });
  });

  it('says a run that had already finished is not an error', () => {
    expect(reduceFlow(stopping(), { stopped: { state: 'ended' } })).toEqual({
      state: undefined,
      notice: 'That run had already finished',
    });
  });

  it('says a run the control does not know cannot be stopped here', () => {
    const result = step(stopping(), { stopped: undefined }).state;
    expect((result as { message: string }).message).toContain('not started from this screen');
  });

  it('shows a stop that throws, and leaves the run listed', () => {
    expect(step(stopping(), { stopThrew: 'EPERM' }).state).toMatchObject({
      kind: 'failed',
      message: 'EPERM',
    });
  });

  it('stops waiting after the largest number of polls, without calling it an error', () => {
    let state = step(stopping(), { stopped: { state: 'stopping' } }).state;
    for (let i = 0; i < MAX_STOP_POLLS - 1; i += 1) {
      state = step(state, { alive: true }).state;
    }
    expect(reduceFlow(state, { alive: true }).notice).toContain('still ending');
  });

  it('ignores keys while it waits, so a repeated s or y sends one stop', () => {
    const s = stopping();
    for (const event of [key('y'), key('s'), named('enter'), named('escape')]) {
      expect(step(s, event).state).toBe(s);
    }
  });
});

describe('plain', () => {
  it('replaces control characters, joins spaces, and bounds the length', () => {
    expect(plain(`a${String.fromCharCode(27)}[0mb\nc\td`)).toBe('a [0mb c d');
    expect(plain('x'.repeat(300), 50)).toHaveLength(50);
    expect(plain('  spaced   out  ')).toBe('spaced out');
  });
});

describe('plain, for text a file or the control wrote', () => {
  it('blanks the C1 controls (0x9b is a terminal CSI) and the bidi controls, not only the C0 ones', () => {
    const csi = String.fromCharCode(0x9b);
    expect(plain(`a${csi}2Jb`)).toBe('a 2Jb');
    for (let code = 0x80; code <= 0x9f; code += 1) {
      expect(plain(`a${String.fromCharCode(code)}b`)).toBe('a b');
    }
    for (const code of [
      0x61c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
    ]) {
      expect(plain(`a${String.fromCharCode(code)}b`)).toBe('a b');
    }
    // text that is only text is left alone: accents, CJK and an emoji are not controls
    expect(plain(`caf${String.fromCharCode(0xe9)} ${String.fromCharCode(0x4e2d)}`)).toBe(
      `caf${String.fromCharCode(0xe9)} ${String.fromCharCode(0x4e2d)}`,
    );
  });
});

describe('what a known refusal does not say', () => {
  it.each(['workflow_not_found', 'not_saved', 'start_failed'])(
    '%s uses the words of the screen, never the control',
    (code) => {
      const failed = reduceFlow(requesting(), {
        refused: refusal(code, {}, 'a raw detail text with /home/someone/secret.yml'),
      }).state as { message: string };
      expect(failed.message).not.toContain('raw detail text');
      expect(failed.message).not.toContain('/home/someone');
    },
  );
});

/** An attention item as the report carries it. */
function item(
  id: string,
  state: 'ready' | 'missing' | 'needs-confirmation' | 'confirmed' | 'unknown',
  extra: { critical?: boolean; how?: string } = {},
) {
  return {
    id,
    kind: 'env' as const,
    state,
    critical: extra.critical ?? false,
    message: id,
    ...(extra.how === undefined ? {} : { how: extra.how }),
  };
}

const report = (...items: ReturnType<typeof item>[]) => ({
  items,
  criticalMissing: items.filter((i) => i.critical && i.state === 'missing').length,
  needsConfirmation: items.filter((i) => i.state === 'needs-confirmation').length,
});

/** The picker, Enter, and a report with something to look at. */
function reading(items: ReturnType<typeof item>[]): FlowState {
  const checking = step(picker(), named('enter')).state;
  return step(checking, { readiness: report(...items) }).state;
}

describe('the readiness step (specs/run-readiness, AC-12, 13, 15)', () => {
  it('asks what the run needs when a workflow is picked, with no confirmations yet', () => {
    const checking = step(picker(), named('enter')).state;
    expect(checking).toMatchObject({
      kind: 'checking',
      workflowId: 'w1',
      confirmed: [],
      effect: { type: 'readiness', request: { workflowId: 'w1' } },
    });
    expect((checking.effect as { request: object }).request).not.toHaveProperty('confirmed');
  });

  it('starts at once, as it always did, when nothing needs a look', () => {
    const checking = step(picker(), named('enter')).state;
    const started = step(checking, {
      readiness: report(item('env:-:A', 'ready'), item('env:-:B', 'confirmed')),
    }).state;
    expect(started).toMatchObject({
      kind: 'requesting',
      sent: { workflowId: 'w1' },
      effect: { type: 'start' },
    });
    expect((started as { sent: object }).sent).not.toHaveProperty('confirmed');
  });

  it('shows what needs a look, ready items counted and not listed', () => {
    const state = reading([
      item('env:-:A', 'ready'),
      item('env:-:B', 'missing', { critical: true }),
      item('decision:-:C', 'needs-confirmation'),
    ]);
    expect(state).toMatchObject({ kind: 'readiness', selected: 0, effect: undefined });
    if (state.kind !== 'readiness') {
      throw new Error('not the report');
    }
    expect(openItems(state.report).map((i) => i.id)).toEqual(['env:-:B', 'decision:-:C']);
  });

  it('always lets the person start, whatever is missing (C-04, AC-15)', () => {
    const state = reading([item('env:-:B', 'missing', { critical: true })]);
    const started = step(state, named('enter')).state;
    expect(started).toMatchObject({ kind: 'requesting', sent: { workflowId: 'w1' } });
  });

  it('confirms the selected item for this run, asks again, and starts with it', () => {
    const state = reading([item('env:-:B', 'missing'), item('decision:-:C', 'needs-confirmation')]);
    const down = step(state, key('j')).state;
    expect(down).toMatchObject({ selected: 1 });
    const asking = step(down, key('c')).state;
    expect(asking).toMatchObject({
      kind: 'checking',
      confirmed: ['decision:-:C'],
      selected: 1,
      effect: { type: 'readiness', request: { workflowId: 'w1', confirmed: ['decision:-:C'] } },
    });
    // the control answers with the item confirmed; one item is left to look at
    const again = step(asking, {
      readiness: report(item('env:-:B', 'missing'), item('decision:-:C', 'confirmed')),
    }).state;
    expect(again).toMatchObject({ kind: 'readiness', selected: 0, confirmed: ['decision:-:C'] });
    const started = step(again, named('enter')).state;
    expect(started).toMatchObject({
      kind: 'requesting',
      sent: { workflowId: 'w1', confirmed: ['decision:-:C'] },
    });
  });

  it('does not confirm what cannot be confirmed: a missing item, or an unknown one', () => {
    const state = reading([item('env:-:B', 'missing'), item('env:-:U', 'unknown')]);
    expect(step(state, key('c')).state).toBe(state);
    expect(step(step(state, key('j')).state, key('c')).state).toMatchObject({ kind: 'readiness' });
  });

  it('confirms an id once, even when c is pressed again after the answer', () => {
    const state = reading([item('decision:-:C', 'needs-confirmation')]);
    const first = step(state, key('c')).state;
    const asked = step(first, { readiness: report(item('decision:-:C', 'needs-confirmation')) }).state;
    expect(step(asked, key('c')).state).toMatchObject({ confirmed: ['decision:-:C'] });
  });

  it('keeps the selection inside the list when it shrinks', () => {
    const asking = step(
      step(reading([item('env:-:A', 'missing'), item('decision:-:C', 'needs-confirmation')]), key('j')).state,
      key('c'),
    ).state;
    expect(asking).toMatchObject({ selected: 1 });
    expect(
      step(asking, { readiness: report(item('decision:-:C', 'confirmed'), item('env:-:A', 'missing')) })
        .state,
    ).toMatchObject({ selected: 0 });
  });

  it('shows a report that could not be had, and still offers the start', () => {
    const checking = step(picker(), named('enter')).state;
    const failed = step(checking, { readinessFailed: 'the probe broke\u001b[2J' }).state;
    expect(failed).toMatchObject({ kind: 'readiness', error: 'the probe broke [2J' });
    expect(step(failed, named('enter')).state).toMatchObject({ kind: 'requesting' });
  });

  it('closes on Escape while checking and from the report, and takes no other key while checking', () => {
    const checking = step(picker(), named('enter')).state;
    expect(step(checking, key('x')).state).toBe(checking);
    expect(reduceFlow(checking, named('escape')).state).toBeUndefined();
    expect(reduceFlow(reading([item('env:-:A', 'missing')]), named('escape')).state).toBeUndefined();
    expect(reduceFlow(reading([item('env:-:A', 'missing')]), key('n')).state).toBeUndefined();
  });

  it('ignores an answer that arrives out of turn', () => {
    const state = reading([item('env:-:A', 'missing')]);
    expect(step(state, { listed: { workflows: [], truncated: false } }).state).toBe(state);
    const checking = step(picker(), named('enter')).state;
    expect(step(checking, { listFailed: 'x' }).state).toBe(checking);
  });

  it('starts on Enter while the report is still being had, so a slow check never holds a start back (AC-15)', () => {
    const checking = step(picker(), named('enter')).state;
    const started = step(checking, named('enter')).state;
    expect(started).toMatchObject({
      kind: 'requesting',
      sent: { workflowId: 'w1' },
      effect: { type: 'start' },
    });
    // the answer that arrives late is ignored: the flow is no longer waiting for it
    expect(step(started, { readiness: report(item('env:-:A', 'missing')) }).state).toBe(started);
  });

  it('keeps the confirmations when Enter starts while a confirmation is being checked again', () => {
    const asking = step(reading([item('decision:-:C', 'needs-confirmation')]), key('c')).state;
    expect(step(asking, named('enter')).state).toMatchObject({
      kind: 'requesting',
      sent: { workflowId: 'w1', confirmed: ['decision:-:C'] },
    });
  });

  it('shows the report again after the last item was confirmed, and does not start by itself', () => {
    const asking = step(reading([item('decision:-:C', 'needs-confirmation')]), key('c')).state;
    const again = step(asking, { readiness: report(item('decision:-:C', 'confirmed')) }).state;
    expect(again).toMatchObject({ kind: 'readiness', confirmed: ['decision:-:C'], effect: undefined });
    const started = step(again, named('enter')).state;
    expect(started).toMatchObject({
      kind: 'requesting',
      sent: { workflowId: 'w1', confirmed: ['decision:-:C'] },
    });
  });

  it('carries the confirmations through the confirmation of what the file uses, and the full access one', () => {
    const state = reading([item('decision:-:C', 'needs-confirmation')]);
    const confirmed = step(step(state, key('c')).state, {
      readiness: report(item('decision:-:C', 'confirmed'), item('env:-:A', 'missing')),
    }).state;
    const requested = step(confirmed, named('enter')).state;
    const asked = step(requested, {
      refused: refusal('confirmation_required', { contentHash: 'h1', use: USE }),
    }).state;
    expect(asked).toMatchObject({ kind: 'confirming', confirmed: ['decision:-:C'] });
    const yes = step(asked, key('y')).state;
    expect(yes).toMatchObject({
      kind: 'requesting',
      sent: { workflowId: 'w1', confirmedHash: 'h1', confirmed: ['decision:-:C'] },
    });
    const full = step(yes, {
      refused: refusal('full_access_required', {
        contentHash: 'h1',
        steps: [{ stepId: 's', runners: ['claude-code'] }],
      }),
    }).state;
    expect(step(full, key('a')).state).toMatchObject({
      sent: {
        confirmedHash: 'h1',
        fullAccessConfirmedHash: 'h1',
        confirmed: ['decision:-:C'],
      },
    });
  });
});
