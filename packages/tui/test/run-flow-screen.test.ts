import { describe, expect, it } from 'vitest';
import { computeLayout } from '../src/layout.js';
import { type FlowState, openPicker, openStop, reduceFlow } from '../src/run-flow.js';
import { buildFlowScreen, isDialog } from '../src/run-flow-screen.js';
import { refusal, USE, workflow } from './run-flow-fixtures.js';

const wide = computeLayout(120, 30);
const options = { ascii: false };
const text = (rows: readonly { text: string }[]): string => rows.map((r) => r.text).join('\n');
const must = (state: FlowState | undefined): FlowState => {
  if (state === undefined) {
    throw new Error('the flow closed');
  }
  return state;
};
const loaded = (list = [workflow()], truncated = false): FlowState =>
  must(reduceFlow(openPicker(), { listed: { workflows: list, truncated } }).state);

describe('the picker screen', () => {
  it('lists workflows by project and name, marking the selected one', () => {
    const screen = buildFlowScreen(
      loaded([
        workflow({ id: 'a', name: 'one', project: 'app' }),
        workflow({ id: 'b', name: 'two', project: 'docs' }),
      ]),
      wide,
      options,
    );
    expect(screen.header.text).toBe('Start a workflow');
    expect(screen.list.map((r) => r.text.trim())).toEqual(['app / one', 'docs / two']);
    expect(screen.list.map((r) => r.selected)).toEqual([true, false]);
    expect(screen.footer.text).toContain('Enter start');
  });

  it('says it is looking, then that there is nothing, and how to filter', () => {
    expect(text(buildFlowScreen(openPicker(), wide, options).list)).toContain('looking for workflows');
    expect(text(buildFlowScreen(loaded([]), wide, options).list)).toContain('no workflows found');
    const filtered = must(
      reduceFlow(must(reduceFlow(loaded(), { press: { char: '/' } }).state), { press: { char: 'z' } }).state,
    );
    const screen = buildFlowScreen(filtered, wide, options);
    expect(text(screen.list)).toContain('filter: z_');
    expect(text(screen.list)).toContain('nothing matches');
    expect(screen.footer.text).toContain('type to filter');
  });

  it('marks a workflow that is not valid and gives its problems beside the list', () => {
    const bad = workflow({
      valid: false,
      problems: ['steps: needs at least one', 'name: missing'],
      name: 'broken',
    });
    const screen = buildFlowScreen(loaded([bad]), wide, options);
    expect(screen.list[0]?.text).toContain('(not valid)');
    expect(screen.list[0]?.tone).toBe('bad');
    expect(text(screen.detail)).toContain('- steps: needs at least one');
    expect(text(screen.detail)).toContain('- name: missing');
  });

  it('shows the file, the tags and that a valid workflow is valid', () => {
    const screen = buildFlowScreen(loaded([workflow({ tags: ['nightly', 'qa'] })]), wide, options);
    const detail = text(screen.detail);
    expect(detail).toContain('review.workflow.ai.yml');
    expect(detail).toContain('nightly, qa');
    expect(detail).toContain('valid');
  });

  it('says that the list may be incomplete, and shows a failure to list', () => {
    expect(text(buildFlowScreen(loaded([workflow()], true), wide, options).list)).toContain(
      'may be incomplete',
    );
    const failed = must(reduceFlow(openPicker(), { listFailed: 'EACCES' }).state);
    expect(text(buildFlowScreen(failed, wide, options).list)).toContain('EACCES');
  });

  it('shows the list only on a narrow terminal, and keeps every line inside the width', () => {
    for (const columns of [40, 60, 79, 80, 160]) {
      const layout = computeLayout(columns, 24);
      const long = workflow({ name: 'n'.repeat(100), project: 'p'.repeat(100) });
      const screen = buildFlowScreen(loaded([long]), layout, options);
      const width = layout.mode === 'split' ? layout.listWidth : columns;
      for (const row of screen.list) {
        expect(Array.from(row.text).length).toBeLessThanOrEqual(width);
      }
      if (layout.mode !== 'split') {
        expect(screen.detail).toEqual([]);
      }
    }
  });

  it('removes control sequences and, in ASCII mode, everything above 7-bit, from what a file says', () => {
    const esc = String.fromCharCode(27);
    const nasty = workflow({
      name: `bad${esc}[2Jna${String.fromCharCode(233)}me`,
      problems: [`p${esc}[0m`],
      valid: false,
    });
    const screen = buildFlowScreen(loaded([nasty]), wide, { ascii: true });
    const all = text([...screen.list, ...screen.detail]);
    expect(all).not.toContain(esc);
    expect(all.split('\n').every((line) => /^[ -~]*$/.test(line))).toBe(true);
  });

  it('is a two-pane screen, unlike the dialogs', () => {
    expect(isDialog(openPicker())).toBe(false);
    expect(isDialog(openStop('r'))).toBe(true);
  });
});

/** Enter on the picked workflow, then a report with nothing to look at: the start goes ahead as it always did. */
function entered(): FlowState {
  const checking = must(reduceFlow(loaded(), { press: 'enter' }).state);
  return must(
    reduceFlow(checking, { readiness: { items: [], criticalMissing: 0, needsConfirmation: 0 } }).state,
  );
}

describe('the dialogs', () => {
  const confirming = (changed = false): FlowState => {
    const asked = must(
      reduceFlow(entered(), {
        refused: refusal('confirmation_required', {
          contentHash: 'h',
          use: { ...USE, needsPerson: ['argue'] },
        }),
      }).state,
    );
    return changed ? ({ ...(asked as object), changed: true } as FlowState) : asked;
  };

  it('lists what the workflow will use, and asks y or n', () => {
    const screen = buildFlowScreen(confirming(), wide, options);
    const body = text(screen.detail);
    expect(screen.header.text).toContain('Confirm what review will use');
    expect(body).toContain('Runners');
    expect(body).toContain('shell');
    expect(body).toContain('build: npm test');
    expect(body).toContain('What agents may change');
    expect(body).toContain('Needs a person');
    expect(body).toContain('y confirm and start');
    expect(body).not.toContain('changed since');
  });

  it('says in so many words that the file changed since it was looked at', () => {
    expect(text(buildFlowScreen(confirming(true), wide, options).detail)).toContain(
      'changed since you looked',
    );
  });

  it('bounds a long list of commands', () => {
    const many = { ...USE, commands: Array.from({ length: 30 }, (_, i) => `step ${i}: run`) };
    const asked = must(
      reduceFlow(entered(), {
        refused: refusal('confirmation_required', { contentHash: 'h', use: many }),
      }).state,
    );
    const body = text(buildFlowScreen(asked, wide, options).detail);
    expect(body).toContain('...and 18 more');
    expect(body).not.toContain('step 29');
  });

  it('removes control sequences from what the file says it uses', () => {
    const esc = String.fromCharCode(27);
    const hostile = {
      ...USE,
      commands: [`rm${esc}[2J -rf`],
      runners: [`x${esc}]0;title${String.fromCharCode(7)}`],
    };
    const asked = must(
      reduceFlow(entered(), {
        refused: refusal('confirmation_required', { contentHash: 'h', use: hostile }),
      }).state,
    );
    expect(text(buildFlowScreen(asked, wide, options).detail)).not.toContain(esc);
  });

  it('lists the full-access steps and asks for its own key', () => {
    const full = must(
      reduceFlow(entered(), {
        refused: refusal('full_access_required', {
          contentHash: 'h',
          steps: [{ stepId: 'deploy', runners: ['claude-code', 'codex'] }],
        }),
      }).state,
    );
    const screen = buildFlowScreen(full, wide, options);
    expect(screen.header.text).toContain('FULL access');
    expect(text(screen.detail)).toContain('deploy  (claude-code, codex)');
    expect(text(screen.detail)).toContain('a allow full access and start');
    expect(text(screen.detail)).not.toContain('y confirm');
  });

  it('shows each waiting and ending state in words', () => {
    const requesting = entered();
    expect(text(buildFlowScreen(requesting, wide, options).detail)).toContain('asking the control');
    const starting = must(reduceFlow(requesting, { started: { startId: 'web-1' } }).state);
    expect(text(buildFlowScreen(starting, wide, options).detail)).toContain(
      'waiting for the run to appear (0)',
    );
    const failed = must(reduceFlow(requesting, { threw: 'broke' }).state);
    const screen = buildFlowScreen(failed, wide, options);
    expect(screen.header.text).toBe('The run did not start');
    expect(text(screen.detail)).toContain('broke');
    expect(text(screen.detail)).toContain('any key to go back');
  });

  it('names the run it asks to stop, and says it is waiting once told to', () => {
    const asked = buildFlowScreen(openStop('abc123'), wide, options);
    expect(asked.header.text).toBe('Stop this run?');
    expect(text(asked.detail)).toContain('run abc123');
    expect(text(asked.detail)).toContain('y stop it');
    const stopping = must(reduceFlow(openStop('abc123'), { press: { char: 'y' } }).state);
    expect(buildFlowScreen(stopping, wide, options).header.text).toBe('Stopping');
  });

  it('keeps every dialog line inside a 40-column terminal', () => {
    const layout = computeLayout(40, 12);
    const screen = buildFlowScreen(confirming(), layout, options);
    for (const row of [screen.header, ...screen.detail]) {
      expect(Array.from(row.text).length).toBeLessThanOrEqual(40);
    }
  });

  it('shows only a notice below the floor of 40 by 8', () => {
    const screen = buildFlowScreen(openPicker(), computeLayout(30, 6), options);
    expect(text(screen.detail)).toContain('Terminal too small');
  });
});

type Item = {
  id: string;
  kind: 'env';
  state: 'ready' | 'missing' | 'needs-confirmation' | 'confirmed' | 'unknown';
  critical: boolean;
  message: string;
  how?: string;
};
const entry = (
  id: string,
  state: Item['state'],
  extra: { critical?: boolean; how?: string; message?: string } = {},
): Item => ({
  id,
  kind: 'env',
  state,
  critical: extra.critical ?? false,
  message: extra.message ?? id,
  ...(extra.how === undefined ? {} : { how: extra.how }),
});

function reading(items: Item[], failure?: string): FlowState {
  const checking = must(reduceFlow(loaded(), { press: 'enter' }).state);
  const report = { items, criticalMissing: 0, needsConfirmation: 0 };
  return must(
    reduceFlow(checking, failure === undefined ? { readiness: report } : { readinessFailed: failure }).state,
  );
}

describe('the readiness screens (specs/run-readiness, AC-13, 15)', () => {
  it('says it is looking while the control answers', () => {
    const checking = must(reduceFlow(loaded(), { press: 'enter' }).state);
    const screen = buildFlowScreen(checking, wide, options);
    expect(screen.header.text).toBe('Starting review');
    expect(text(screen.detail)).toContain('looking at what this run needs');
    expect(text(screen.detail)).toContain('Esc cancel');
    expect(isDialog(checking)).toBe(true);
  });

  it('counts what is ready and lists only what needs a look, critical first and marked', () => {
    const state = reading([
      entry('env:-:A', 'ready'),
      entry('env:-:B', 'ready'),
      entry('env:-:KEY', 'missing', { critical: true, message: 'KEY is not set' }),
      entry('decision:-:OK', 'needs-confirmation', { message: 'Someone approved the spend' }),
    ]);
    const screen = buildFlowScreen(state, wide, options);
    expect(screen.header.text).toBe('review: what this run needs');
    expect(screen.header.tone).toBe('warn');
    const body = text(screen.detail);
    expect(body).toContain('2 ready, 2 to look at');
    expect(body).toContain('CRITICAL missing: KEY is not set');
    expect(body).toContain('needs your confirmation: Someone approved the spend');
    expect(body).not.toContain('env:-:A');
    const rows = screen.detail.filter((r) => r.selected === true);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toContain('CRITICAL missing');
    expect(rows[0]?.tone).toBe('bad');
  });

  it('is a red header only when something critical is missing', () => {
    const critical = {
      items: [entry('env:-:KEY', 'missing', { critical: true })],
      criticalMissing: 1,
      needsConfirmation: 0,
    };
    const checking = must(reduceFlow(loaded(), { press: 'enter' }).state);
    const state = must(reduceFlow(checking, { readiness: critical }).state);
    expect(buildFlowScreen(state, wide, options).header.tone).toBe('bad');
  });

  it('shows how to fix only the selected item, and the confirm key only for an item that can be confirmed', () => {
    const items = [
      entry('env:-:A', 'missing', { how: 'Set A before you start.' }),
      entry('decision:-:C', 'needs-confirmation', { how: 'Ask your lead.' }),
    ];
    const first = reading(items);
    const onMissing = text(buildFlowScreen(first, wide, options).detail);
    expect(onMissing).toContain('How: Set A before you start.');
    expect(onMissing).not.toContain('Ask your lead');
    expect(onMissing).toContain('Enter start anyway');
    expect(onMissing).not.toContain('c confirm');
    const second = must(reduceFlow(first, { press: { char: 'j' } }).state);
    const onDecision = text(buildFlowScreen(second, wide, options).detail);
    expect(onDecision).toContain('How: Ask your lead.');
    expect(onDecision).toContain('c confirm for this run');
    expect(onDecision).toContain('Enter start anyway');
  });

  it('says when the report could not be had, and still offers the start', () => {
    const state = reading([], 'the probe broke');
    const body = text(buildFlowScreen(state, wide, options).detail);
    expect(body).toContain('The readiness could not be checked: the probe broke');
    expect(body).toContain('Enter start');
  });

  it('bounds a long list and says how many more there are', () => {
    const many = Array.from({ length: 14 }, (_, i) => entry(`env:-:V${i}`, 'missing'));
    const body = text(buildFlowScreen(reading(many), wide, options).detail);
    expect(body).toContain('14 to look at');
    expect(body).toContain('...and 4 more');
  });

  it('neutralises control sequences in workflow text, and is 7-bit in ASCII mode', () => {
    const hostile = entry('env:-:X', 'missing', {
      message: `bad ${String.fromCharCode(27)}[2J name ${String.fromCharCode(0x2713)}`,
      how: `fix ${String.fromCharCode(27)}]0;title${String.fromCharCode(7)}`,
    });
    const body = text(buildFlowScreen(reading([hostile]), wide, { ascii: true }).detail);
    expect(body).not.toContain(String.fromCharCode(27));
    expect(body).not.toContain(String.fromCharCode(7));
    expect(Array.from(body).every((c) => (c.codePointAt(0) ?? 0) < 128)).toBe(true);
    expect(body).toContain('name ?');
  });

  it('keeps every line inside a narrow terminal, wrapping the words of how to fix', () => {
    const narrow = computeLayout(40, 20);
    const state = reading([
      entry('env:-:A', 'missing', {
        critical: true,
        message: 'a very long message that cannot fit on a forty column terminal at all',
        how: 'Install the program so it is on the PATH, or choose another runner for this step and try again.',
      }),
    ]);
    const screen = buildFlowScreen(state, narrow, options);
    for (const r of [screen.header, ...screen.detail]) {
      expect(Array.from(r.text).length).toBeLessThanOrEqual(40);
    }
    expect(text(screen.detail)).toContain('How: Install the program');
  });

  it('puts Enter first in the key line, so a narrow terminal clips the least important key', () => {
    const state = reading([entry('env:-:A', 'missing'), entry('decision:-:C', 'needs-confirmation')]);
    const second = must(reduceFlow(state, { press: { char: 'j' } }).state);
    const screen = buildFlowScreen(second, computeLayout(40, 20), options);
    const keys = screen.detail[screen.detail.length - 1]?.text ?? '';
    expect(keys.startsWith('Enter start anyway')).toBe(true);
    expect(Array.from(keys).length).toBeLessThanOrEqual(40);
  });

  it('always draws the selected item, scrolling a window over a long list', () => {
    const many = Array.from({ length: 14 }, (_, i) => entry(`env:-:V${i}`, 'missing'));
    let state = reading(many);
    for (let i = 0; i < 7; i += 1) {
      state = must(reduceFlow(state, { press: { char: 'j' } }).state);
    }
    const screen = buildFlowScreen(state, wide, options);
    const selected = screen.detail.filter((r) => r.selected === true);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.text).toContain('env:-:V7');
    expect(text(screen.detail)).toContain('above');
    expect(text(screen.detail)).toContain('more below');
  });

  it('draws fewer items on a short terminal, so the keys stay on the screen', () => {
    const many = Array.from({ length: 14 }, (_, i) => entry(`env:-:V${i}`, 'missing'));
    const short = computeLayout(100, 16);
    const screen = buildFlowScreen(reading(many), short, options);
    const drawn = screen.detail.filter((r) => r.text.startsWith('missing:'));
    expect(drawn.length).toBeLessThanOrEqual(4);
    expect(drawn.length).toBeGreaterThanOrEqual(1);
    expect(screen.detail[screen.detail.length - 1]?.text).toContain('Enter start anyway');
  });

  it('says nothing is left after the last item was confirmed, and offers a plain start', () => {
    const checking = must(
      reduceFlow(reading([entry('decision:-:C', 'needs-confirmation')]), { press: { char: 'c' } }).state,
    );
    const again = must(
      reduceFlow(checking, {
        readiness: {
          items: [entry('decision:-:C', 'confirmed')],
          criticalMissing: 0,
          needsConfirmation: 0,
        },
      }).state,
    );
    const screen = buildFlowScreen(again, wide, options);
    expect(text(screen.detail)).toContain('1 ready, 0 to look at');
    expect(text(screen.detail)).toContain('Nothing is left to look at.');
    expect(screen.detail[screen.detail.length - 1]?.text).toContain('Enter start');
    expect(screen.detail[screen.detail.length - 1]?.text).not.toContain('anyway');
    expect(screen.header.tone).toBe('info');
  });
});
