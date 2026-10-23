import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_DOCUMENT_BYTES, WorkflowDocument, WorkflowDocumentError, WorkflowParser } from '../src/index.js';

/** specs/workflow-editor, T9 to T13: the document edits only what it is told to, and reads back what it wrote. */

const examples = fileURLToPath(new URL('../../../examples', import.meta.url));

const TEXT = `# A workflow, with comments everywhere.
version: "1.0"   # the format
name: 'demo'

# Roles first.
roles:
  coder:
    runner: acp   # an agent

steps:
  # The first step.
  - id: build
    runner: shell
    commands:
      - npm test   # quick

  - id: review    # second
    role: coder
    goal: >-
      Review it.
    depends_on: [build]
`;

const doc = (text = TEXT) => WorkflowDocument.parse(text);
const refused = (f: () => void) => expect(f).toThrow(WorkflowDocumentError);

describe('reading (AC-01, AC-07)', () => {
  it('reads a workflow and gives it back unchanged', () => {
    expect(doc().toString()).toBe(TEXT);
    for (const name of readdirSync(examples).filter((n) => n.endsWith('.yml'))) {
      const text = readFileSync(join(examples, name), 'utf8');
      expect(WorkflowDocument.parse(text).toString(), name).toBe(text);
    }
  });

  it('creates a minimal workflow', () => {
    expect(WorkflowDocument.create({ name: 'new one' }).toString()).toBe(
      'version: "1.0"\nname: new one\nsteps: []\n',
    );
    expect(WorkflowDocument.create({ name: 'a: b' }).get(['name'])).toBe('a: b');
    refused(() => WorkflowDocument.create({ name: 3 as unknown as string }));
  });

  it('refuses text over 1 MiB before it parses it, and an alias bomb before it expands', () => {
    refused(() => WorkflowDocument.parse(`name: ${'x'.repeat(MAX_DOCUMENT_BYTES)}\n`));
    const bomb = [
      'a: &a [x, x]',
      'b: &b [*a, *a, *a, *a]',
      'c: &c [*b, *b, *b, *b]',
      'd: [*c, *c, *c, *c, *c, *c, *c, *c]',
    ];
    expect(() => WorkflowDocument.parse(`${bomb.join('\n')}\n`)).toThrow(/aliases/);
  });

  it('refuses what is not one YAML mapping, and says why', () => {
    expect(() => WorkflowDocument.parse('a: [\n')).toThrow(/invalid YAML/);
    expect(() => WorkflowDocument.parse('a: 1\n---\nb: 2\n')).toThrow(/exactly one document/);
    expect(() => WorkflowDocument.parse('- a\n')).toThrow(/root must be a mapping/);
    expect(() => WorkflowDocument.parse('')).toThrow(/root must be a mapping/);
    expect(() => WorkflowDocument.parse('a: 1\na: 2\n')).toThrow(/invalid YAML/);
  });

  it('reads a workflow that has problems, for a wizard goes through invalid states (AC-06)', () => {
    const d = WorkflowDocument.parse('name: x\nsteps: 3\n');
    d.set(['steps'], []);
    expect(d.get(['steps'])).toEqual([]);
  });
});

describe('get, has and clone', () => {
  it('reads by path as plain JSON, and a copy of it', () => {
    const d = doc();
    expect(d.get(['steps', 1, 'goal'])).toBe('Review it.');
    expect(d.get(['steps', 1, 'depends_on'])).toEqual(['build']);
    expect(d.has(['roles', 'coder', 'runner'])).toBe(true);
    expect(d.has(['roles', 'ghost'])).toBe(false);
    expect(d.get(['steps', 9])).toBeUndefined();
    expect(d.get(['name', 'deeper'])).toBeUndefined();
    const list = d.get(['steps', 1, 'depends_on']) as string[];
    list.push('x');
    expect(d.get(['steps', 1, 'depends_on'])).toEqual(['build']);
    expect(d.get([])).toMatchObject({ name: 'demo' });
  });

  it('clones, so a copy changes alone', () => {
    const a = doc();
    const b = a.clone();
    b.set(['name'], 'other');
    expect(a.get(['name'])).toBe('demo');
    expect(b.get(['name'])).toBe('other');
  });
});

describe('set: only the line it changes (AC-02, AC-04)', () => {
  it('replaces a scalar in place, in its own quoting', () => {
    const d = doc();
    d.set(['name'], 'renamed');
    expect(d.toString()).toBe(TEXT.replace("name: 'demo'", "name: 'renamed'"));
    d.set(['version'], '1.0');
    expect(d.toString()).toBe(TEXT.replace("name: 'demo'", "name: 'renamed'"));
    const e = doc();
    e.set(['steps', 1, 'role'], 'other');
    expect(e.toString()).toBe(TEXT.replace('role: coder', 'role: other'));
    e.set(['steps', 0, 'commands', 0], 'npm run build');
    expect(e.toString()).toBe(
      TEXT.replace('role: coder', 'role: other').replace('- npm test', '- npm run build'),
    );
  });

  it('writes a value that needs quotes with them, and a multiline one as one quoted line', () => {
    const d = doc();
    d.set(['steps', 1, 'role'], 'a: b');
    expect(d.get(['steps', 1, 'role'])).toBe('a: b');
    d.set(['steps', 1, 'role'], 'two\nlines');
    expect(d.get(['steps', 1, 'role'])).toBe('two\nlines');
    expect(d.toString()).toContain('role: "two\\nlines"');
    d.set(['steps', 1, 'role'], 'żółw');
    expect(d.get(['steps', 1, 'role'])).toBe('żółw');
  });

  it('adds a key at the end of its map, at the map’s indentation', () => {
    const d = doc();
    d.set(['steps', 0, 'goal'], 'build it');
    expect(d.toString()).toBe(
      TEXT.replace('      - npm test   # quick\n', '      - npm test   # quick\n    goal: build it\n'),
    );
    const e = doc();
    e.set(['roles', 'coder', 'model'], 'some/model');
    expect(e.toString()).toBe(
      TEXT.replace('    runner: acp   # an agent\n', '    runner: acp   # an agent\n    model: some/model\n'),
    );
  });

  it('creates the maps on the way', () => {
    const d = doc();
    d.set(['defaults', 'mcp_policy'], 'optional');
    expect(d.toString()).toBe(`${TEXT}defaults:\n  mcp_policy: optional\n`);
    const e = doc();
    e.set(['steps', 0, 'on_failure', 'action'], 'retry_step');
    expect(e.toString()).toBe(
      TEXT.replace(
        '      - npm test   # quick\n',
        '      - npm test   # quick\n    on_failure:\n      action: retry_step\n',
      ),
    );
  });

  it('replaces a list after its key, flow or block, and leaves the rest', () => {
    const d = doc();
    d.set(['steps', 1, 'depends_on'], ['build', 'x']);
    expect(d.toString()).toBe(
      TEXT.replace('    depends_on: [build]\n', '    depends_on:\n      - build\n      - x\n'),
    );
    const e = doc();
    e.set(['steps', 0, 'commands'], ['a', 'b']);
    expect(e.toString()).toBe(TEXT.replace('      - npm test   # quick\n', '      - a\n      - b\n'));
    e.set(['steps', 0, 'commands'], []);
    expect(e.toString()).toBe(
      TEXT.replace('    commands:\n      - npm test   # quick\n', '    commands: []\n'),
    );
  });

  it('appends to a list at its length', () => {
    const d = doc();
    d.set(['steps', 0, 'commands', 1], 'npm run lint');
    expect(d.toString()).toBe(
      TEXT.replace('      - npm test   # quick\n', '      - npm test   # quick\n      - npm run lint\n'),
    );
  });

  it('edits a flow collection through the document model, and still reads back right', () => {
    const d = WorkflowDocument.parse('name: x\nsteps: [{id: a, runner: shell, commands: [x]}]\n');
    d.set(['steps', 0, 'goal'], 'g');
    expect(d.get(['steps', 0])).toEqual({ id: 'a', runner: 'shell', commands: ['x'], goal: 'g' });
    d.addStep({ id: 'b', runner: 'shell', commands: ['y'] });
    expect((d.get(['steps']) as unknown[]).length).toBe(2);
  });
});

describe('set: what it refuses, and the document is unchanged (AC-02)', () => {
  it('refuses keys that reach a prototype, in the path or the value', () => {
    const d = doc();
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      refused(() => d.set(['steps', 0, key], 'x'));
      refused(() => d.set(['steps', 0, 'x'], JSON.parse(`{"${key}": 1}`)));
      refused(() => d.get([key]));
    }
    expect(d.toString()).toBe(TEXT);
  });

  it('refuses a value that is not plain JSON', () => {
    const d = doc();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    let deep: unknown = 'x';
    for (let i = 0; i < 70; i += 1) {
      deep = [deep];
    }
    const sparse: unknown[] = [];
    sparse[2] = 'x';
    for (const value of [
      () => undefined,
      new Date(0),
      new Map(),
      new (class Thing {})(),
      Number.NaN,
      Number.POSITIVE_INFINITY,
      cycle,
      deep,
      sparse,
      { [Symbol('s')]: 1 },
      undefined,
      10n,
    ]) {
      refused(() => d.set(['name'], value));
    }
    expect(d.toString()).toBe(TEXT);
  });

  it('refuses a path through a value, an empty path, a bad index, and says which path', () => {
    const d = doc();
    expect(() => d.set(['name', 'x'], 1)).toThrow(/\$\.name is a value/);
    refused(() => d.set([], {}));
    refused(() => d.set(['steps', -1], 'x'));
    refused(() => d.set(['steps', 1.5], 'x'));
    refused(() => d.set(['steps', 9], 'x'));
    try {
      d.set(['steps', 0, 'constructor'], 1);
    } catch (error) {
      expect((error as WorkflowDocumentError).path).toBe('$.steps[0].constructor');
    }
    expect(d.toString()).toBe(TEXT);
  });
});

describe('remove', () => {
  it('removes a key and its lines, and only those', () => {
    const d = doc();
    d.remove(['steps', 0, 'commands']);
    expect(d.toString()).toBe(TEXT.replace('    commands:\n      - npm test   # quick\n', ''));
    d.remove(['steps', 1, 'goal']);
    expect(d.has(['steps', 1, 'goal'])).toBe(false);
    expect(d.toString()).not.toContain('Review it.');
  });

  it('leaves `{}` or `[]` when the last entry goes', () => {
    const d = doc();
    d.remove(['roles', 'coder', 'runner']);
    expect(d.toString()).toBe(TEXT.replace('  coder:\n    runner: acp   # an agent\n', '  coder: {}\n'));
    d.remove(['steps', 0, 'commands', 0]);
    expect(d.get(['steps', 0, 'commands'])).toEqual([]);
  });

  it('refuses a path that is not there', () => {
    refused(() => doc().remove(['steps', 0, 'nope']));
  });
});

describe('steps by id (AC-03)', () => {
  it('adds a step at the end or after another, in the list’s own spacing', () => {
    const d = doc();
    d.addStep({ id: 'ship', runner: 'shell', commands: ['echo ok'] });
    expect(d.toString()).toBe(`${TEXT}\n  - id: ship\n    runner: shell\n    commands:\n      - echo ok\n`);
    const e = doc();
    e.addStep({ id: 'mid', runner: 'shell', commands: ['x'] }, { after: 'build' });
    expect(e.toString()).toBe(
      TEXT.replace(
        '  - id: review',
        '  - id: mid\n    runner: shell\n    commands:\n      - x\n\n  - id: review',
      ),
    );
  });

  it('removes a step with its comment, and leaves other steps’ depends_on to problems()', () => {
    const d = doc();
    d.removeStep('build');
    expect(d.toString()).toBe(
      TEXT.replace(
        '  # The first step.\n  - id: build\n    runner: shell\n    commands:\n      - npm test   # quick\n\n',
        '',
      ),
    );
    expect(d.get(['steps', 0, 'depends_on'])).toEqual(['build']);
    expect(d.problems().map((p) => p.message)).toContain('step "review" depends on unknown step "build"');
  });

  it('moves a step with its text unchanged, to the front or after another', () => {
    const d = doc();
    d.moveStep('review');
    expect((d.get(['steps']) as { id: string }[]).map((s) => s.id)).toEqual(['review', 'build']);
    expect(d.toString()).toBe(
      `${TEXT.slice(0, TEXT.indexOf('  # The first step.'))}  - id: review    # second\n    role: coder\n    goal: >-\n      Review it.\n    depends_on: [build]\n\n  # The first step.\n  - id: build\n    runner: shell\n    commands:\n      - npm test   # quick\n`,
    );
    d.moveStep('review', { after: 'build' });
    expect(d.toString()).toBe(TEXT);
  });

  it('starts a list from nothing, and empties it again', () => {
    const d = WorkflowDocument.create({ name: 'n' });
    d.addStep({ id: 'a', runner: 'shell', commands: ['echo'] });
    d.addStep({ id: 'b', runner: 'shell', commands: ['echo'] }, { after: 'a' });
    expect(d.toString()).toBe(
      'version: "1.0"\nname: n\nsteps:\n  - id: a\n    runner: shell\n    commands:\n      - echo\n  - id: b\n    runner: shell\n    commands:\n      - echo\n',
    );
    d.moveStep('b');
    expect((d.get(['steps']) as { id: string }[]).map((s) => s.id)).toEqual(['b', 'a']);
    d.removeStep('a');
    d.removeStep('b');
    expect(d.toString()).toBe('version: "1.0"\nname: n\nsteps: []\n');
    const e = WorkflowDocument.parse('name: n\n');
    e.addStep({ id: 'a', runner: 'shell', commands: ['x'] });
    expect(e.get(['steps', 0, 'id'])).toBe('a');
  });

  it('refuses an id that is not there, and a move after itself', () => {
    const d = doc();
    refused(() => d.removeStep('nope'));
    refused(() => d.moveStep('nope'));
    refused(() => d.moveStep('build', { after: 'nope' }));
    refused(() => d.moveStep('build', { after: 'build' }));
    refused(() => d.addStep({ id: 'x' }, { after: 'nope' }));
    refused(() => WorkflowDocument.parse('steps: 3\n').addStep({ id: 'x' }));
    expect(d.toString()).toBe(TEXT);
  });
});

describe('problems (AC-05)', () => {
  it('is what the parser’s diagnose says of the same text, with the same options', () => {
    const d = doc();
    expect(d.problems()).toEqual(new WorkflowParser().diagnose(TEXT));
    const known = { has: (name: string) => name === 'shell' };
    expect(d.problems({ runners: known })).toEqual(
      new WorkflowParser(undefined, undefined, known).diagnose(TEXT),
    );
    expect(
      d.problems({ runners: known }).some((p) => p.message.includes('"acp" is not a known runner')),
    ).toBe(true);
  });
});

describe('every example, one field changed', () => {
  it.each(readdirSync(examples).filter((n) => n.endsWith('.yml')))(
    '%s changes only its name line',
    (name) => {
      const text = readFileSync(join(examples, name), 'utf8');
      const d = WorkflowDocument.parse(text);
      d.set(['name'], 'edited by a test');
      const before = text.split('\n');
      const after = d.toString().split('\n');
      expect(after).toHaveLength(before.length);
      const changed = before.flatMap((line, i) => (line === after[i] ? [] : [i]));
      expect(changed).toHaveLength(1);
      expect(after[changed[0] ?? 0]).toContain('edited by a test');
      expect(new WorkflowParser().diagnose(d.toString()).filter((p) => p.severity === 'error')).toEqual([]);
    },
  );
});
