import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ResolvedInputs, WorkflowValidationError } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { readInputDeclarations, WorkflowParser } from '../src/index.js';

/** specs/workflow-inputs, T-07 to T-10: the declarations, the references, and the parse options. */

const parser = new WorkflowParser();

const resolved = (values: ResolvedInputs['values']): ResolvedInputs => ({
  values,
  asked: [],
  digest: 'd'.repeat(64),
});

/** A workflow with the given `inputs` block and one agent step whose fields are given. */
function workflow(inputs: string, step = '    goal: "Do it"\n'): string {
  return `version: "1.0"
name: w
${inputs === '' ? '' : `inputs:\n${inputs}`}roles:
  coder:
    runner: claude-code
steps:
  - id: s1
    role: coder
${step}`;
}

function problems(source: string, options?: Parameters<WorkflowParser['parse']>[1]): readonly string[] {
  try {
    parser.parse(source, options);
  } catch (error) {
    if (error instanceof WorkflowValidationError) {
      return error.problems;
    }
    throw error;
  }
  return [];
}

const SPECS = `  specs:
    type: path
    list: true
    kind: directory
    max_items: 10
    description: "The folders to review"
`;

describe('a workflow without inputs is unchanged (AC-01, T-09)', () => {
  it('parses every shipped example the same with and without options', () => {
    const dir = fileURLToPath(new URL('../../../examples/', import.meta.url));
    const files = readdirSync(dir).filter((name) => name.endsWith('.workflow.ai.yml'));
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      const source = readFileSync(join(dir, file), 'utf8');
      const plain = parser.parse(source);
      expect(plain, file).toEqual(parser.parse(source, { placeholders: true }));
      expect(plain, file).not.toHaveProperty('inputs');
      expect(plain, file).not.toHaveProperty('unusedInputs');
      for (const step of plain.steps) {
        expect(step, file).not.toHaveProperty('goalInputs');
      }
    }
  });
});

describe('declarations (AC-01 to AC-06, T-07)', () => {
  it('reads every type with its defaults', () => {
    const source = workflow(`  topic:
    type: text
    description: "The topic"
  tone:
    type: choice
    choices: [formal, friendly]
    description: "The tone"
  retries:
    type: number
    integer: true
    min: 1
    max: 5
    description: "How many"
  dry:
    type: boolean
    description: "Dry run"
${SPECS}  notes:
    type: path
    kind: file
    extensions: [".md", ".TXT"]
    must_exist: false
    description: "A note"
`);
    const { declarations, problems: found } = readInputDeclarations(source);
    expect(found).toEqual([]);
    expect(Object.keys(declarations)).toEqual(['topic', 'tone', 'retries', 'dry', 'specs', 'notes']);
    expect(declarations.topic).toEqual({
      type: 'text',
      name: 'topic',
      description: 'The topic',
      list: false,
      minItems: 1,
      maxItems: 1,
      maxLength: 2000,
      multiline: false,
    });
    expect(declarations.tone).toMatchObject({ choices: ['formal', 'friendly'], list: false });
    expect(declarations.retries).toEqual({
      type: 'number',
      name: 'retries',
      description: 'How many',
      integer: true,
      min: 1,
      max: 5,
    });
    expect(declarations.dry).toEqual({ type: 'boolean', name: 'dry', description: 'Dry run' });
    expect(declarations.specs).toMatchObject({
      list: true,
      kind: 'directory',
      mustExist: true,
      minItems: 1,
      maxItems: 10,
      extensions: [],
    });
    expect(declarations.notes).toMatchObject({ kind: 'file', mustExist: false, extensions: ['.md', '.TXT'] });
    expect(parser.parse(source, { placeholders: true }).inputs).toEqual(declarations);
  });

  it('makes an input with a default optional, checks the default, and stores it in its checked form', () => {
    const { declarations, problems: found } = readInputDeclarations(
      workflow(`  topic:
    type: text
    default: "a\\r\\nb"
    multiline: true
    description: "x"
  tone:
    type: choice
    choices: [formal, short]
    default: short
    description: "x"
  retries:
    type: number
    default: 3
    description: "x"
  dry:
    type: boolean
    default: false
    description: "x"
  where:
    type: path
    default: "./specs//a/"
    description: "x"
  many:
    type: path
    list: true
    default: []
    description: "x"
  tones:
    type: choice
    choices: [formal, short]
    list: true
    default: [short, formal]
    description: "x"
`),
    );
    expect(found).toEqual([]);
    expect(declarations.topic).toMatchObject({ default: 'a\nb' });
    expect(declarations.tone).toMatchObject({ default: 'short' });
    expect(declarations.retries).toMatchObject({ default: 3 });
    expect(declarations.dry).toMatchObject({ default: false });
    expect(declarations.where).toMatchObject({ default: 'specs/a', minItems: 0 });
    expect(declarations.many).toMatchObject({ default: [], minItems: 0, maxItems: 20 });
    expect(declarations.tones).toMatchObject({ default: ['short', 'formal'] });
  });

  it('never throws for a bad file: the problems come back', () => {
    expect(readInputDeclarations('not: [valid').problems[0]).toContain('invalid YAML');
    expect(readInputDeclarations('- a\n- b\n').problems).toEqual(['the document root must be a mapping']);
    expect(readInputDeclarations('').problems).toEqual(['the document root must be a mapping']);
    expect(readInputDeclarations('name: w\n')).toEqual({ declarations: {}, problems: [] });
  });

  it('names the path of every problem, all at once', () => {
    const { declarations, problems: found } = readInputDeclarations(
      workflow(`  specs:
    type: path
    max_length: 5
    description: "x"
  n:
    type: number
    list: true
    description: "x"
  b:
    type: boolean
    default: "yes"
    description: "x"
  c:
    type: choice
    choices: []
    description: "x"
  weird:
    type: colour
    description: "x"
  nodesc:
    type: text
`),
    );
    expect(declarations).toEqual({});
    expect(found).toEqual(
      expect.arrayContaining([
        '$.inputs.specs.max_length is not a setting of a path input',
        '$.inputs.n.list is not a setting of a number input',
        '$.inputs.b.default must be true or false',
        '$.inputs.c.choices must list 1 to 50 choices',
        '$.inputs.weird.type must be one of text, path, choice, number, boolean',
        '$.inputs.nodesc.description is required',
      ]),
    );
  });

  it('says secrets are not supported yet', () => {
    const { problems: found } = readInputDeclarations(
      workflow('  key:\n    type: text\n    secret: true\n    description: "x"\n'),
    );
    expect(found).toEqual([
      '$.inputs.key.secret: secrets are not supported as inputs yet. Keep keys in your environment, as for OPENROUTER_API_KEY.',
    ]);
  });

  it.each([
    [
      'a name that starts with a digit',
      '  9a:\n    type: text\n    description: "x"\n',
      '$.inputs.9a is not a valid input name',
    ],
    [
      'a name with a dot',
      '  "a.b":\n    type: text\n    description: "x"\n',
      '$.inputs.a.b is not a valid input name',
    ],
    [
      'a description over 300 characters',
      `  a:\n    type: text\n    description: "${'x'.repeat(301)}"\n`,
      '$.inputs.a.description is longer than 300 characters',
    ],
    [
      'max_length over 10000',
      '  a:\n    type: text\n    max_length: 10001\n    description: "x"\n',
      '$.inputs.a.max_length must be a whole number from 1 to 10000',
    ],
    [
      'max_items over 100',
      '  a:\n    type: text\n    list: true\n    max_items: 101\n    description: "x"\n',
      '$.inputs.a.max_items must be a whole number from 1 to 100',
    ],
    [
      'min_items without list',
      '  a:\n    type: text\n    min_items: 1\n    description: "x"\n',
      '$.inputs.a.min_items only belongs to an input with list: true',
    ],
    [
      'min_items above max_items',
      '  a:\n    type: text\n    list: true\n    min_items: 5\n    max_items: 2\n    description: "x"\n',
      '$.inputs.a.min_items (5) is more than max_items (2)',
    ],
    [
      'a default over the length',
      '  a:\n    type: text\n    max_length: 2\n    default: "abc"\n    description: "x"\n',
      '$.inputs.a.default: "a" is longer than the 2 characters it may have (it has 3).',
    ],
    [
      'a default that is not a choice',
      '  a:\n    type: choice\n    choices: [x, y]\n    default: z\n    description: "x"\n',
      '$.inputs.a.default: "a" must be one of: x, y. "z" is not.',
    ],
    [
      'a number default outside the range',
      '  a:\n    type: number\n    max: 2\n    default: 3\n    description: "x"\n',
      '$.inputs.a.default is not allowed: "a" must be a number of at most 2; "3" is not.',
    ],
    [
      'a number default that is a string',
      '  a:\n    type: number\n    default: "3"\n    description: "x"\n',
      '$.inputs.a.default must be a number',
    ],
    [
      'min above max',
      '  a:\n    type: number\n    min: 5\n    max: 1\n    description: "x"\n',
      '$.inputs.a.min (5) is more than max (1)',
    ],
    [
      'a bound that is not a number',
      '  a:\n    type: number\n    min: "x"\n    description: "x"\n',
      '$.inputs.a.min must be a number',
    ],
    [
      'extensions without kind: file',
      '  a:\n    type: path\n    extensions: [".md"]\n    description: "x"\n',
      '$.inputs.a.extensions only belongs to an input with kind: file',
    ],
    [
      'an extension with no dot',
      '  a:\n    type: path\n    kind: file\n    extensions: ["md"]\n    description: "x"\n',
      '$.inputs.a.extensions[0] must look like ".md"',
    ],
    [
      'a path kind that does not exist',
      '  a:\n    type: path\n    kind: folder\n    description: "x"\n',
      '$.inputs.a.kind must be file, directory or any',
    ],
    [
      'an absolute path default',
      '  a:\n    type: path\n    default: "/etc"\n    description: "x"\n',
      '$.inputs.a.default: "/etc" is outside the folder the workflow runs in.',
    ],
    [
      'a list default that is not a list',
      '  a:\n    type: path\n    list: true\n    default: "x"\n    description: "x"\n',
      '$.inputs.a.default must be a list of strings',
    ],
    [
      'a default with too many items',
      '  a:\n    type: text\n    list: true\n    max_items: 1\n    default: [a, b]\n    description: "x"\n',
      '$.inputs.a.default holds 2 items, but the input takes 0 to 1',
    ],
    [
      'duplicate choices',
      '  a:\n    type: choice\n    choices: [x, x]\n    description: "x"\n',
      '$.inputs.a.choices must not repeat a choice',
    ],
    [
      'a choice that is empty',
      '  a:\n    type: choice\n    choices: ["x", ""]\n    description: "x"\n',
      '$.inputs.a.choices[1] must be 1 to 100 characters with no control character',
    ],
    [
      'no choices at all',
      '  a:\n    type: choice\n    description: "x"\n',
      '$.inputs.a.choices is required for a choice input',
    ],
  ])('refuses %s', (_name, inputs, expected) => {
    const found = readInputDeclarations(workflow(inputs)).problems;
    expect(
      found.some((message) => message.startsWith(expected)),
      found.join(' | '),
    ).toBe(true);
  });

  it('refuses more than 50 choices and a choice with a control character', () => {
    const many = Array.from({ length: 51 }, (_, i) => `c${i}`).join(', ');
    expect(
      readInputDeclarations(
        workflow(`  a:\n    type: choice\n    choices: [${many}]\n    description: "x"\n`),
      ).problems,
    ).toEqual(['$.inputs.a.choices must list 1 to 50 choices']);
    const control = readInputDeclarations(
      workflow(`  a:\n    type: choice\n    choices: ["x\\u0007y"]\n    description: "x"\n`),
    ).problems;
    expect(control).toEqual(['$.inputs.a.choices[0] must be 1 to 100 characters with no control character']);
  });

  it('refuses inputs that is not a mapping, and an input that is not a mapping', () => {
    expect(readInputDeclarations('inputs: [a]\n').problems).toEqual(['$.inputs must be a mapping']);
    expect(readInputDeclarations('inputs:\n  a: text\n').problems).toEqual(['$.inputs.a must be a mapping']);
  });

  it('puts the problems in the error a parse throws', () => {
    expect(problems(workflow('  a:\n    type: text\n    color: red\n    description: "x"\n'))).toContain(
      '$.inputs.a.color is not a setting of a text input',
    );
  });
});

describe('references (AC-07 to AC-10, T-08)', () => {
  const body = (goal: string) => workflow(SPECS, `    goal: "${goal}"\n`);

  it('renders a text or path input as a label and lists it in goalInputs, in order of first reference', () => {
    const source = workflow(
      `${SPECS}  topic:\n    type: text\n    description: "x"\n`,
      '    goal: "Review ${{ inputs.topic }} in ${{ inputs.specs }} and again ${{ inputs.topic }}"\n',
    );
    const parsed = parser.parse(source, {
      inputs: resolved({ specs: ['specs/a', 'specs/b'], topic: 'billing' }),
    });
    expect(parsed.steps[0]?.goal).toBe('Review [input: topic] in [input: specs] and again [input: topic]');
    expect(parsed.steps[0]?.goalInputs).toEqual(['topic', 'specs']);
    expect(parsed.unusedInputs).toBeUndefined();
  });

  it('expands a choice, number or boolean input to its value as written', () => {
    const source = workflow(
      `  tone:\n    type: choice\n    choices: [formal, short]\n    description: "x"\n  n:\n    type: number\n    description: "x"\n  dry:\n    type: boolean\n    description: "x"\n  tones:\n    type: choice\n    list: true\n    choices: [formal, short]\n    description: "x"\n`,
      '    goal: "Be ${{ inputs.tone }}, try ${{ inputs.n }} times, dry ${{ inputs.dry }}, tones ${{ inputs.tones }}"\n',
    );
    const parsed = parser.parse(source, {
      inputs: resolved({ tone: 'formal', n: 2.5, dry: true, tones: ['short', 'formal'] }),
    });
    expect(parsed.steps[0]?.goal).toBe('Be formal, try 2.5 times, dry true, tones short, formal');
    expect(parsed.steps[0]?.goalInputs).toBeUndefined();
  });

  it('renders every reference as <input: name> when asked for placeholders, and ignores them when values are given', () => {
    const source = body('Review ${{ inputs.specs }}');
    expect(parser.parse(source, { placeholders: true }).steps[0]?.goal).toBe('Review <input: specs>');
    expect(parser.parse(source, { placeholders: true }).steps[0]?.goalInputs).toEqual(['specs']);
    expect(
      parser.parse(source, { placeholders: true, inputs: resolved({ specs: ['a'] }) }).steps[0]?.goal,
    ).toBe('Review [input: specs]');
  });

  it('needs a value when it is given no options and the file refers to an input', () => {
    expect(problems(body('Review ${{ inputs.specs }}'))).toEqual([
      '$.steps[0].goal refers to the input "specs", which needs a value. Give it with --input specs=<value>, or parse the file with placeholders to check it without one.',
    ]);
    // a file that declares inputs and refers to none still parses with no options
    expect(problems(body('Review everything'))).toEqual([]);
  });

  it('needs a value for a declared input the resolved values lack', () => {
    expect(problems(body('Review ${{ inputs.specs }}'), { inputs: resolved({}) })[0]).toContain(
      'needs a value',
    );
  });

  it('refuses an input that is not declared, naming the field and the input', () => {
    expect(problems(body('Review ${{ inputs.spec }}'), { placeholders: true })).toEqual([
      '$.steps[0].goal refers to the input "spec", which is not declared under inputs.',
    ]);
  });

  it('refuses an input in commands with the explanation of C-02, naming the entry', () => {
    const source = `version: "1.0"
name: w
inputs:
${SPECS}steps:
  - id: s1
    runner: shell
    commands:
      - echo ok
      - cat \${{ inputs.specs }}
`;
    expect(problems(source, { placeholders: true })).toEqual([
      '$.steps[0].commands[1] uses ${{ inputs.specs }}. Inputs cannot be used in commands, because a command is run by the system shell and a value could change what it does. Use it in goal, input_artifacts or outputs instead.',
    ]);
  });

  it('refuses an input in a guard path, and refuses one that is not declared in commands the same way', () => {
    const source = workflow(
      SPECS,
      '    guards:\n      - type: diff_within_scope\n        paths: ["${{ inputs.specs }}"]\n',
    );
    expect(problems(source, { placeholders: true })).toEqual([
      '$.steps[0].guards[0].paths[0] uses ${{ inputs.specs }}. Inputs can only be used in goal, input_artifacts and outputs.',
    ]);
  });

  it('leaves the text of any other field as it is', () => {
    const source = `version: "1.0"
name: "keep \${{ inputs.x }} here"
inputs:
${SPECS}steps:
  - id: s1
    runner: shell
    commands: ["echo ok"]
`;
    expect(parser.parse(source, { placeholders: true }).name).toBe('keep ${{ inputs.x }} here');
  });

  it('expands a path input into input_artifacts and outputs: one entry, or one for each element of a list', () => {
    const source = workflow(
      `${SPECS}  one:\n    type: path\n    description: "x"\n`,
      '    input_artifacts: ["${{ inputs.specs }}", "${{ inputs.one }}", "fixed.md"]\n    outputs: ["${{ inputs.one }}.out"]\n',
    );
    const parsed = parser.parse(source, { inputs: resolved({ specs: ['specs/a', 'specs/b'], one: 'x/y' }) });
    expect(parsed.steps[0]?.inputArtifacts).toEqual(['specs/a', 'specs/b', 'x/y', 'fixed.md']);
    expect(parsed.steps[0]?.outputs).toEqual(['x/y.out']);
    const placeholder = parser.parse(source, { placeholders: true });
    expect(placeholder.steps[0]?.inputArtifacts).toEqual(['<input: specs>', '<input: one>', 'fixed.md']);
  });

  it('mixes artifacts and inputs in one string', () => {
    const source = `version: "1.0"
name: w
artifacts:
  out: "build/out"
inputs:
  one:
    type: path
    description: "x"
roles:
  coder:
    runner: claude-code
steps:
  - id: s1
    role: coder
    goal: "go"
    outputs: ["\${{ artifacts.out }}/\${{ inputs.one }}"]
`;
    expect(parser.parse(source, { inputs: resolved({ one: 'x' }) }).steps[0]?.outputs).toEqual([
      'build/out/x',
    ]);
  });

  it('refuses a list input inside a longer entry, and an input of another type in a path field', () => {
    const list = workflow(SPECS, '    outputs: ["a/${{ inputs.specs }}"]\n');
    expect(problems(list, { inputs: resolved({ specs: ['a', 'b'] }) })).toEqual([
      '$.steps[0].outputs[0] uses the list input "specs" inside a longer value. A list input must be the whole entry.',
    ]);
    const wrong = workflow(
      '  topic:\n    type: text\n    description: "x"\n',
      '    input_artifacts: ["${{ inputs.topic }}"]\n',
    );
    expect(problems(wrong, { placeholders: true })).toEqual([
      '$.steps[0].input_artifacts[0] uses ${{ inputs.topic }}, which is a text input. input_artifacts and outputs take path inputs only.',
    ]);
  });

  it('warns about a declared input no step uses, and not about one only an output uses', () => {
    const unused = parser.parse(workflow(SPECS), { placeholders: true });
    expect(unused.unusedInputs).toEqual(['specs']);
    expect(parser.diagnose(workflow(SPECS)).map((p) => [p.severity, p.message])).toContainEqual([
      'warning',
      'the input "specs" is declared but no step uses it.',
    ]);
    const used = parser.parse(workflow(SPECS, '    outputs: ["${{ inputs.specs }}"]\n'), {
      placeholders: true,
    });
    expect(used.unusedInputs).toBeUndefined();
  });

  it('does not count a reference in commands as a use, because it is refused', () => {
    expect(parser.parse(workflow(SPECS), { placeholders: true }).unusedInputs).toEqual(['specs']);
  });

  it('keeps the references of an unresolved workflow readable by diagnose, which never needs a value', () => {
    const found = parser.diagnose(body('Review ${{ inputs.specs }}'));
    expect(found.filter((p) => p.severity === 'error')).toEqual([]);
  });
});

describe('a literal ${{ inputs. in an existing workflow (C-14, T-10)', () => {
  it('is now a reference, and an undeclared one is an error naming the input', () => {
    const source = workflow('', '    goal: "Write the text ${{ inputs.x }} as it is"\n');
    expect(problems(source)).toEqual([
      '$.steps[0].goal refers to the input "x", which is not declared under inputs.',
    ]);
  });
});
