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

describe('the dialogs', () => {
  const confirming = (changed = false): FlowState => {
    const asked = must(
      reduceFlow(must(reduceFlow(loaded(), { press: 'enter' }).state), {
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
      reduceFlow(must(reduceFlow(loaded(), { press: 'enter' }).state), {
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
      reduceFlow(must(reduceFlow(loaded(), { press: 'enter' }).state), {
        refused: refusal('confirmation_required', { contentHash: 'h', use: hostile }),
      }).state,
    );
    expect(text(buildFlowScreen(asked, wide, options).detail)).not.toContain(esc);
  });

  it('lists the full-access steps and asks for its own key', () => {
    const full = must(
      reduceFlow(must(reduceFlow(loaded(), { press: 'enter' }).state), {
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
    const requesting = must(reduceFlow(loaded(), { press: 'enter' }).state);
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
