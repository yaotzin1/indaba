import { type WorkflowEdit, WorkflowValidationError } from '@indaba/core';
import {
  catalogOf,
  parseWorkflow,
  WorkflowDocument,
  WorkflowParser,
  workflowJsonSchema,
} from '@indaba/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowEditor } from '../src/run-control/editor.js';
import { problemsOf } from '../src/run-control/problems.js';

afterEach(() => {
  vi.restoreAllMocks();
});

/** specs/web-app-editing-forms, T-04 and T-05: the editor of `indaba ui` over the real document and parser. */

/** A file a person wrote: comments, a blank line, quoting and an order of their own. */
const WORKFLOW = `# Builds the site.
version: "1.0"
name: site   # shown in the trace

roles:
  writer:
    runner: shell
steps:
  # The first step.
  - id: build
    runner: shell
    commands: ['npm run build']   # quoted on purpose
  - id: check
    runner: shell
    depends_on: [build]
    commands:
      - npm test
`;

const describes = (names: string[]) => ({
  describe: () => names.map((name) => ({ name, description: `${name} line` })),
});

const editor = createWorkflowEditor({
  parse: parseWorkflow,
  diagnose: (text: string) => new WorkflowParser().diagnose(text),
  schema: workflowJsonSchema(),
  catalog: catalogOf({
    runners: describes(['shell', 'acp']),
    guards: describes(['git_diff_empty']),
    adjudicators: describes(['human']),
  }),
});

const edit = (...edits: WorkflowEdit[]) => editor.edit({ text: WORKFLOW, edits });

/** The lines of `after` that are not in `before`, and the reverse: what an edit changed. */
function changed(before: string, after: string): { added: string[]; removed: string[] } {
  const a = before.split('\n');
  const b = after.split('\n');
  return { added: b.filter((l) => !a.includes(l)), removed: a.filter((l) => !b.includes(l)) };
}

describe('the editor of indaba ui (AC-02, AC-03, AC-08)', () => {
  it('answers the schema and the catalog it was given, the same each time', () => {
    const info = editor.info();
    expect(info.schema).toEqual(workflowJsonSchema());
    expect(info.catalog.runners.map((r) => r.name)).toEqual(['shell', 'acp']);
    expect(info.catalog.arbiters).toEqual([{ name: 'human', description: 'human line' }]);
    expect(editor.info()).toBe(info);
  });

  it('reads a text without changing it when there are no edits', () => {
    const answer = edit();
    expect(answer.text).toBe(WORKFLOW);
    expect(answer.value).toMatchObject({ name: 'site', steps: [{ id: 'build' }, { id: 'check' }] });
    expect(answer.problems).toEqual([]);
  });

  it('changes one field and keeps every comment, blank line and quote of the rest', () => {
    const answer = edit({ op: 'set', path: ['steps', 1, 'commands', 0], value: 'npm run test' });
    expect(changed(WORKFLOW, answer.text)).toEqual({
      added: ['      - npm run test'],
      removed: ['      - npm test'],
    });
    expect(answer.value).toMatchObject({ steps: [{}, { commands: ['npm run test'] }] });
  });

  it('removes a key, adds, moves and removes steps, in order, each on the text the one before gave', () => {
    const answer = edit(
      { op: 'remove', path: ['roles'] },
      { op: 'addStep', step: { id: 'step-1', runner: 'shell' }, after: 'build' },
      { op: 'moveStep', id: 'check' },
      { op: 'removeStep', id: 'build' },
    );
    expect(answer.text).toContain('# Builds the site.');
    expect(answer.text).toContain('name: site   # shown in the trace');
    expect(answer.text).not.toContain('roles:');
    const value = answer.value as { steps: { id: string }[] };
    expect(value.steps.map((s) => s.id)).toEqual(['check', 'step-1']);
    // `check` still depends on the removed `build`, and the new step has no command: said, not repaired (AC-10).
    expect(answer.problems.map((p) => p.path)).toEqual(
      expect.arrayContaining(['$.steps[0].depends_on', '$.steps[1].runner']),
    );
  });

  it('gives each problem its path, line and column (AC-04)', () => {
    const answer = edit({ op: 'set', path: ['steps', 0, 'isolation'], value: 'nope' });
    expect(answer.problems).toEqual([
      expect.objectContaining({
        path: '$.steps[0].isolation',
        line: expect.any(Number),
        column: expect.any(Number),
      }),
    ]);
  });

  it('refuses a text the document cannot read, as not_editable', () => {
    for (const text of ['a: [', 'a: 1\n---\nb: 2\n', '- a\n', '']) {
      expect(() => editor.edit({ text, edits: [] })).toThrow(
        expect.objectContaining({ name: 'WorkflowEditorError', code: 'not_editable' }),
      );
    }
  });

  it('refuses an edit the document refuses, naming its index and path, and changes nothing', () => {
    const attempt = () =>
      edit(
        { op: 'set', path: ['name'], value: 'renamed' },
        { op: 'set', path: ['steps', 0, '__proto__'], value: 1 },
      );
    expect(attempt).toThrow(
      expect.objectContaining({
        code: 'edit_refused',
        detail: { index: 1, path: '$.steps[0].__proto__' },
      }),
    );
    expect(() => edit({ op: 'removeStep', id: 'ghost' })).toThrow(
      expect.objectContaining({ code: 'edit_refused', detail: { index: 0, path: '$.steps' } }),
    );
  });

  it('lets an error that is not the document’s through, as a defect', () => {
    const broken = createWorkflowEditor({
      parse: () => {
        throw new WorkflowValidationError(['x']);
      },
      diagnose: () => {
        throw new RangeError('a defect');
      },
      schema: workflowJsonSchema(),
      catalog: editor.info().catalog,
    });
    expect(() => broken.edit({ text: WORKFLOW, edits: [] })).toThrow(RangeError);
  });

  it('refuses a schema that is not JSON when it is built', () => {
    expect(() =>
      createWorkflowEditor({
        parse: parseWorkflow,
        diagnose: () => [],
        schema: { when: new Date(0) },
        catalog: editor.info().catalog,
      }),
    ).toThrow(TypeError);
    for (const schema of [{ list: [1, Number.NaN] }, { fn: () => 1 }]) {
      expect(() =>
        createWorkflowEditor({
          parse: parseWorkflow,
          diagnose: () => [],
          schema,
          catalog: editor.info().catalog,
        }),
      ).toThrow(TypeError);
    }
  });

  it('lets an error of the document that is not a refusal through, from a read or an edit', () => {
    vi.spyOn(WorkflowDocument, 'parse').mockImplementationOnce(() => {
      throw new RangeError('a defect in the reader');
    });
    expect(() => edit()).toThrow(RangeError);
    vi.spyOn(WorkflowDocument.prototype, 'set').mockImplementationOnce(() => {
      throw new RangeError('a defect in the writer');
    });
    expect(() => edit({ op: 'set', path: ['name'], value: 'x' })).toThrow(RangeError);
  });
});

describe('the problems of a text, for the store and the editor (AC-04)', () => {
  const diagnose = (text: string) => new WorkflowParser().diagnose(text);

  it('gives a problem that cannot be placed its path only', () => {
    expect(problemsOf({ parse: parseWorkflow, diagnose }, '').problems).toEqual([
      { message: expect.any(String), path: '$' },
    ]);
  });

  it('turns a failure of the parser that is not a validation into one sentence', () => {
    const failing = (thrown: unknown) =>
      problemsOf(
        {
          parse: () => {
            throw thrown;
          },
          diagnose,
        },
        'x',
      );
    expect(failing(new Error('the reader broke'))).toEqual({
      problems: [{ message: 'the reader broke' }],
      name: undefined,
    });
    expect(failing('a string').problems).toEqual([{ message: 'a string' }]);
  });
});
