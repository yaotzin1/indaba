import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { InputDescription } from '@indaba/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index.js';
import { terminalInputAsker } from '../src/input-prompt.js';
import type { AskInputs } from '../src/run-inputs.js';
import { captureIo, makeGitRepo, writeWorkflow } from './support.js';

/** specs/workflow-inputs, T-18 to T-22 and T-25: the command line, the questions, and what a refusal leaves behind. */

// A git hook hands GIT_DIR to everything it starts; the runs below would work on the real repository.
const inherited = Object.entries(process.env).filter(([name]) => name.toUpperCase().startsWith('GIT_'));
beforeAll(() => {
  for (const [name] of inherited) {
    delete process.env[name];
  }
});
afterAll(() => {
  for (const [name, value] of inherited) {
    process.env[name] = value;
  }
});

const WORKFLOW = `version: "1.0"
name: review
inputs:
  specs:
    type: path
    list: true
    kind: directory
    max_items: 5
    description: "The specification folders to review"
  topic:
    type: text
    default: "everything"
    max_length: 200
    description: "What to focus on"
  tone:
    type: choice
    choices: [formal, short]
    default: formal
    description: "The tone"
  spare:
    type: boolean
    default: false
    description: "Not used by any step"
steps:
  - id: only
    runner: shell
    commands: ["echo hi"]
    goal: "Review \${{ inputs.specs }} about \${{ inputs.topic }} in a \${{ inputs.tone }} tone"
`;

async function project() {
  const dir = await makeGitRepo();
  await mkdir(join(dir, 'specs', 'billing'), { recursive: true });
  await mkdir(join(dir, 'specs', 'refunds'), { recursive: true });
  await writeFile(join(dir, 'specs', 'a.md'), 'x');
  const file = await writeWorkflow(dir, 'review.workflow.ai.yml', WORKFLOW);
  return { dir, file };
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function plain(command: 'plan' | 'validate', extra: string[] = [], workflow = WORKFLOW) {
  const { dir } = await project();
  const file = await writeWorkflow(dir, 'w.workflow.ai.yml', workflow);
  const captured = captureIo(dir, {});
  const code = await main([command, file, ...extra], captured.io);
  return { code, out: captured.stdout(), err: captured.stderr(), dir };
}

async function run(extra: string[] = [], io: Partial<Io> = {}, workflow = WORKFLOW) {
  const { dir } = await project();
  const file = await writeWorkflow(dir, 'w.workflow.ai.yml', workflow);
  const captured = captureIo(dir, {});
  const code = await main(['run', file, '--workdir', dir, ...extra], { ...captured.io, ...io });
  return { code, out: captured.stdout(), err: captured.stderr(), dir };
}

describe('validate and plan without values (AC-14, C-16, T-19)', () => {
  it('validate checks the declarations and needs no value, and warns about an input no step uses', async () => {
    const r = await plain('validate');
    expect(r.code).toBe(0);
    expect(r.out).toContain('review is valid');
    expect(r.out).toContain('warning: the input "spare" is declared but no step uses it.');
  });

  it('plan prints the inputs: set, default or missing, and the unused warning', async () => {
    const r = await plain('plan', ['--input', 'specs=specs/billing']);
    expect(r.code).toBe(0);
    expect(r.out).toContain(
      'Inputs:\n  specs (path list): set\n  topic (text): default\n  tone (choice): default\n  spare (boolean): default',
    );
    expect(r.out).toContain('warning: the input "spare" is declared but no step uses it.');
    const bare = await plain('plan');
    expect(bare.out).toContain('specs (path list): missing (add --input specs=<value>)');
    expect(bare.code).toBe(0);
  });

  it('checks the values given as a run would, with exit 2 and the words of the spec', async () => {
    const wrong = await plain('plan', ['--input', 'tone=casual']);
    expect(wrong.code).toBe(2);
    expect(wrong.err).toContain('"tone" must be one of: formal, short. "casual" is not.');
    const unknown = await plain('validate', ['--input', 'spec=x']);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain(
      'This workflow has no input called "spec". It takes: specs, topic, tone, spare.',
    );
    const outside = await plain('plan', ['--input', 'specs=../secrets']);
    expect(outside.code).toBe(2);
    expect(outside.err).toContain(
      '"../secrets" is outside the folder the workflow runs in. Choose a folder inside it.',
    );
  });

  it('is a usage error to give --input-file to plan or validate, and to forget the =', async () => {
    const file = await plain('plan', ['--input-file', 'topic=x']);
    expect(file.code).toBe(2);
    expect(file.err).toContain('Unknown option \'--input-file\' for "plan".');
    const bare = await plain('validate', ['--input', 'topic']);
    expect(bare.code).toBe(2);
    expect(bare.err).toContain('--input needs name=value');
  });

  it('refuses a declaration with a secret, and an input used in commands, with the messages of the spec', async () => {
    const secret = await plain(
      'validate',
      [],
      WORKFLOW.replace(
        '  spare:\n',
        '  key:\n    type: text\n    secret: true\n    description: "x"\n  spare:\n',
      ),
    );
    expect(secret.code).toBe(1);
    expect(secret.out).toContain(
      '$.inputs.key.secret: secrets are not supported as inputs yet. Keep keys in your environment, as for OPENROUTER_API_KEY.',
    );
    const commands = await plain(
      'validate',
      [],
      WORKFLOW.replace('commands: ["echo hi"]', 'commands: ["cat ${{ inputs.topic }}"]'),
    );
    expect(commands.code).toBe(1);
    expect(commands.out).toContain(
      'Inputs cannot be used in commands, because a command is run by the system shell',
    );
  });

  it('leaves a workflow without inputs exactly as it was', async () => {
    const r = await plain(
      'plan',
      [],
      'version: "1.0"\nname: plain\nsteps:\n  - id: a\n    runner: shell\n    commands: ["echo hi"]\n',
    );
    expect(r.code).toBe(0);
    expect(r.out).not.toContain('Inputs:');
  });
});

describe('run with values (AC-12, AC-22, AC-23, T-17)', () => {
  it('resolves the options, runs, and records the digest and counts but never a typed text', async () => {
    const marker = ['PRIVATE', 'marker', '4417'].join('-');
    const r = await run([
      '--input',
      'specs=specs/billing',
      '--input',
      'specs=./specs//refunds/',
      '--input',
      `topic=${marker}`,
    ]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('finished: COMPLETED');
    const traces = join(r.dir, '.indaba', 'traces');
    const files = await readdir(traces);
    const events = files.find((name) => name.endsWith('.events.jsonl'));
    const body = await readFile(join(traces, events ?? ''), 'utf8');
    expect(body).toContain('indaba.inputs.digest');
    expect(body).toContain('"indaba.inputs.count":4');
    expect(body).toContain('inputs_resolved');
    expect(body).toContain('"value.specs":"[\\"specs/billing\\",\\"specs/refunds\\"]"');
    expect(body).toContain(`"length.topic":${marker.length}`);
    // no file the run left holds the text, and neither do the logs (AC-23)
    const found: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'worktrees') {
            await walk(path);
          }
        } else if ((await readFile(path, 'utf8').catch(() => '')).includes(marker)) {
          found.push(path);
        }
      }
    };
    await walk(join(r.dir, '.indaba'));
    expect(found).toEqual([]);
  });

  it('reads a text input from a file inside the project (AC-13)', async () => {
    const { dir } = await project();
    const file = await writeWorkflow(dir, 'w.workflow.ai.yml', WORKFLOW);
    await writeFile(join(dir, 'topic.txt'), 'from a file');
    const captured = captureIo(dir, {});
    const code = await main(
      ['run', file, '--workdir', dir, '--input', 'specs=specs/billing', '--input-file', 'topic=topic.txt'],
      captured.io,
    );
    expect(code).toBe(0);
    expect(captured.stdout()).toContain('finished: COMPLETED');
  });

  it('refuses --input-file for another type, a file outside, a file too long, a missing file, and the same name twice', async () => {
    const { dir } = await project();
    const file = await writeWorkflow(dir, 'w.workflow.ai.yml', WORKFLOW);
    await writeFile(join(dir, 'long.txt'), 'x'.repeat(300));
    await writeFile(join(dir, 'topic.txt'), 'ok');
    const attempt = async (...extra: string[]) => {
      const captured = captureIo(dir, {});
      const code = await main(
        ['run', file, '--workdir', dir, '--input', 'specs=specs/billing', ...extra],
        captured.io,
      );
      return { code, err: captured.stderr(), made: await exists(join(dir, '.indaba', 'traces')) };
    };
    const typed = await attempt('--input-file', 'tone=topic.txt');
    expect(typed.err).toContain('--input-file is for a text input; "tone" is a choice input.');
    const outside = await attempt('--input-file', 'topic=../elsewhere.txt');
    expect(outside.err).toContain('--input-file topic:');
    expect(outside.err).toContain('is outside the folder the workflow runs in');
    const long = await attempt('--input-file', 'topic=long.txt');
    expect(long.err).toContain(
      '--input-file topic: the file is longer than the 200 characters "topic" may have.',
    );
    const missing = await attempt('--input-file', 'topic=nope.txt');
    expect(missing.err).toContain('does not exist');
    const twice = await attempt('--input', 'topic=a', '--input-file', 'topic=topic.txt');
    expect(twice.err).toContain('"topic" was given more than once through --input and --input-file');
    for (const result of [typed, outside, long, missing, twice]) {
      expect(result.code).toBe(2);
      expect(result.made).toBe(false);
    }
  });

  it('refuses more than 200 options, and a name that is not declared, with the declared ones listed', async () => {
    const many = Array.from({ length: 201 }, (_, i) => ['--input', `topic=${i}`]).flat();
    const tooMany = await run(many);
    expect(tooMany.code).toBe(2);
    expect(tooMany.err).toContain('At most 200 --input options are allowed; 201 were given.');
    const unknown = await run(['--input', 'specs=specs/billing', '--input', 'ghost=1']);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain(
      'This workflow has no input called "ghost". It takes: specs, topic, tone, spare.',
    );
  });
});

describe('run before anything exists (AC-15, AC-16, T-20)', () => {
  async function nothingCreated(dir: string): Promise<void> {
    expect(await exists(join(dir, '.indaba', 'traces'))).toBe(false);
    expect(await exists(join(dir, '.indaba', 'worktrees'))).toBe(false);
    expect(await exists(join(dir, '.indaba', 'rulings'))).toBe(false);
    expect(await exists(join(dir, '.indaba', 'discussions'))).toBe(false);
  }

  it('exits 2 with a line to copy for each missing input when nothing can ask, and creates nothing', async () => {
    const r = await run();
    expect(r.code).toBe(2);
    expect(r.err).toBe(
      'The workflow did not start:\n - The workflow needs a value for "specs": The specification folders to review. Add --input specs=<folder> (repeat it for more than one), or run it in a terminal to be asked.\n',
    );
    await nothingCreated(r.dir);
  });

  it('lists every problem at once, each bad element of a list included, and creates nothing', async () => {
    const r = await run([
      '--input',
      'specs=../x',
      '--input',
      'specs=specs/nope',
      '--input',
      'specs=specs/a.md',
      '--input',
      'tone=casual',
    ]);
    expect(r.code).toBe(2);
    expect(r.err).toContain('"../x" is outside the folder the workflow runs in. Choose a folder inside it.');
    expect(r.err).toContain('"specs/nope" does not exist. Check the spelling, or choose another folder.');
    expect(r.err).toContain('"specs/a.md" is a file, but "specs" takes folders.');
    expect(r.err).toContain('"tone" must be one of: formal, short. "casual" is not.');
    await nothingCreated(r.dir);
  });
});

describe('asking (AC-16, T-21)', () => {
  it('asks for what is missing, and runs with the answer, recording that it was asked', async () => {
    const asked: string[][] = [];
    const ask: AskInputs = async (_declarations, missing) => {
      asked.push([...missing]);
      return { values: { specs: ['specs/billing', 'specs/refunds'] } };
    };
    const r = await run([], { askInputs: ask });
    expect(r.code).toBe(0);
    expect(asked).toEqual([['specs']]);
    const traces = join(r.dir, '.indaba', 'traces');
    const events = (await readdir(traces)).find((name) => name.endsWith('.events.jsonl'));
    const body = await readFile(join(traces, events ?? ''), 'utf8');
    expect(body).toContain('"indaba.inputs.asked":1');
  });

  it('asks again for an answer that is refused, once the problem is said, and then goes on', async () => {
    const answers = [['../x'], ['specs/billing']];
    const seen: string[][] = [];
    const ask: AskInputs = async (_declarations, missing) => {
      seen.push([...missing]);
      return { values: { specs: answers.shift() ?? [] } };
    };
    const r = await run([], { askInputs: ask });
    expect(r.code).toBe(0);
    expect(seen).toEqual([['specs'], ['specs']]);
  });

  it('gives up after three empty answers with the missing line, and exits 130 when the person closes it', async () => {
    let calls = 0;
    const empty: AskInputs = async () => {
      calls += 1;
      return { values: {} };
    };
    const gaveUp = await run([], { askInputs: empty });
    expect(gaveUp.code).toBe(2);
    expect(calls).toBe(3);
    expect(gaveUp.err).toContain('The workflow needs a value for "specs"');
    const closed = await run([], { askInputs: async () => undefined });
    expect(closed.code).toBe(130);
    expect(closed.err).toContain('No answer was given, so the workflow did not start.');
    expect(await exists(join(closed.dir, '.indaba', 'traces'))).toBe(false);
  });

  it('does not ask about a value the options gave that is wrong: that ends the run', async () => {
    let calls = 0;
    const r = await run(['--input', 'tone=casual'], {
      askInputs: async () => {
        calls += 1;
        return { values: { specs: ['specs/billing'] } };
      },
    });
    expect(r.code).toBe(2);
    expect(calls).toBe(0);
  });

  it('asks at a terminal with the plain questions when the binary gave no asker of its own', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    stdin.end('specs/billing\nspecs/refunds\n\n');
    let shown = '';
    stdout.on('data', (chunk: Buffer) => {
      shown += chunk.toString('utf8');
    });
    const r = await run([], { terminal: { stdin, stdout } });
    expect(r.code).toBe(0);
    expect(shown).toContain('specs: The specification folders to review');
    expect(shown).toContain('a folder inside the project; one per line, an empty line to finish');
  });
});

const described = (
  extra: Partial<InputDescription> & Pick<InputDescription, 'name' | 'type'>,
): InputDescription => ({
  description: 'A question',
  list: false,
  limits: {},
  hasDefault: false,
  ...extra,
});

describe('terminalInputAsker', () => {
  async function ask(declarations: InputDescription[], missing: string[], answers: string) {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    stdin.end(answers);
    let shown = '';
    stdout.on('data', (chunk: Buffer) => {
      shown += chunk.toString('utf8');
    });
    const result = await terminalInputAsker(stdin, stdout)(declarations, missing);
    return { result, shown };
  }

  it('says what each answer looks like, from the declaration', async () => {
    const declarations = [
      described({ name: 'tone', type: 'choice', choices: ['formal', 'short'] }),
      described({ name: 'dry', type: 'boolean' }),
      described({ name: 'n', type: 'number', limits: { integer: true, min: 1, max: 5 } }),
      described({ name: 'low', type: 'number', limits: { min: 2 } }),
      described({ name: 'high', type: 'number', limits: { max: 9 } }),
      described({ name: 'any', type: 'number', limits: {} }),
      described({ name: 'file', type: 'path', limits: { kind: 'file', extensions: '.md,.txt' } }),
      described({ name: 'where', type: 'path', limits: { kind: 'any' } }),
      described({ name: 'line', type: 'text', limits: { maxLength: 50, multiline: false } }),
      described({ name: 'body', type: 'text', limits: { maxLength: 500, multiline: true } }),
    ];
    const { result, shown } = await ask(
      declarations,
      declarations.map((d) => d.name),
      'a\nb\n3\n4\n5\n6\nx.md\ny\nsome line\nsome text\n\n',
    );
    expect(shown).toContain('one of: formal, short');
    expect(shown).toContain('true or false');
    expect(shown).toContain('a whole number from 1 to 5');
    expect(shown).toContain('a number of at least 2');
    expect(shown).toContain('a number of at most 9');
    expect(shown).toContain('a file inside the project (.md,.txt)');
    expect(shown).toContain('a file or folder inside the project');
    expect(shown).toContain('one line of text, up to 50 characters');
    expect(shown).toContain('text, up to 500 characters');
    expect(result?.values.tone).toEqual(['a']);
    expect(result?.values.body).toEqual(['some text']);
  });

  it('reads a list until an empty line, and leaves out an empty answer to a single value', async () => {
    const declarations = [
      described({ name: 'specs', type: 'path', list: true, limits: { kind: 'directory' } }),
      described({ name: 'topic', type: 'text' }),
    ];
    const { result } = await ask(declarations, ['specs', 'topic'], 'a\nb\n\n   \n');
    expect(result?.values).toEqual({ specs: ['a', 'b'] });
  });

  it('gives undefined when the input closes, in the middle of a list as well', async () => {
    const declarations = [
      described({ name: 'specs', type: 'path', list: true }),
      described({ name: 'topic', type: 'text' }),
    ];
    expect((await ask(declarations, ['specs', 'topic'], 'a\n')).result).toBeUndefined();
    expect((await ask(declarations, ['topic'], '')).result).toBeUndefined();
  });

  it('skips a name it was not given a description of, and shows a description without control characters', async () => {
    const esc = String.fromCharCode(0x1b);
    const declarations = [
      described({ name: 'topic', type: 'text', description: `Say ${esc}[31mred${esc}[0m` }),
    ];
    const { result, shown } = await ask(declarations, ['ghost', 'topic'], 'x\n');
    expect(shown).not.toContain(esc);
    expect(shown).toContain('Say  [31mred [0m');
    expect(result?.values).toEqual({ topic: ['x'] });
  });
});

describe('run --tui (AC-17, T-22)', () => {
  async function dashboard(answers: string, extra: string[] = []) {
    const { dir } = await project();
    const file = await writeWorkflow(dir, 'w.workflow.ai.yml', WORKFLOW);
    const captured = captureIo(dir, {});
    const stdin = new PassThrough();
    stdin.end(answers);
    const started: string[][] = [];
    const io: Io = {
      ...captured.io,
      terminal: { stdin, stdout: new PassThrough() },
      startRun: ((args: readonly string[]) => {
        started.push([...args]);
        return {
          exited: Promise.resolve(0),
          stderr: () => '',
          cancel: () => undefined,
          kill: () => undefined,
          release: () => undefined,
        };
      }) as never,
      loadTui: async () => ({ tui: { watch: async () => ({ quit: 'close' as const, code: 0 }) } }),
    };
    const code = await main(['run', file, '--tui', ...extra], io);
    return { code, started, err: captured.stderr(), dir };
  }

  it('asks here, before the dashboard, and hands the child each answer as --input', async () => {
    const r = await dashboard('specs/billing\nspecs/refunds\n\n');
    // the fake child writes no run, so the command ends with "did not start"; the child was started with the answers
    expect(r.started).toHaveLength(1);
    const args = r.started[0] ?? [];
    expect(args).not.toContain('--tui');
    expect(args.join(' ')).toContain('--input specs=specs/billing --input specs=specs/refunds');
  });

  it('hands on the options it was given as they are, and asks only for what is missing', async () => {
    const r = await dashboard('', ['--input', 'specs=specs/billing']);
    expect(r.started).toHaveLength(1);
    const args = r.started[0] ?? [];
    expect(args.filter((arg) => arg === '--input')).toHaveLength(1);
  });

  it('does not start a child when an input is wrong, or when the person closes the question', async () => {
    const wrong = await dashboard('', ['--input', 'tone=casual']);
    expect(wrong.code).toBe(2);
    expect(wrong.started).toEqual([]);
    const closed = await dashboard('');
    expect(closed.code).toBe(130);
    expect(closed.started).toEqual([]);
  });
});

describe('review findings of slice 2', () => {
  it('treats constructor, __proto__ and toString as names like any other: not declared, exit 2', async () => {
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const r = await run(['--input', 'specs=specs/billing', '--input', `${name}=x`]);
      expect(r.code, name).toBe(2);
      expect(r.err, name).toContain(`This workflow has no input called "${name}".`);
    }
    const input = await run(['--input', 'constructor=x', '--input', 'constructor=y']);
    expect(input.code).toBe(2);
  });

  it('shows a description without control characters in the message that lists what is missing', async () => {
    const esc = String.fromCharCode(0x1b);
    const r = await run([], {}, WORKFLOW.replace('"The specification folders to review"', `"Say [31mred"`));
    expect(r.code).toBe(2);
    expect(r.err).not.toContain(esc);
    expect(r.err).toContain('Say  [31mred');
  });

  it('reports the declaration problems, not "takes no inputs", when the file is broken and --input is given', async () => {
    const broken = WORKFLOW.replace('type: boolean', 'type: colour');
    const r = await run(['--input', 'topic=x'], {}, broken);
    expect(r.code).not.toBe(0);
    expect(r.err + r.out).toContain('$.inputs.spare.type must be one of');
    expect(r.err).not.toContain('takes no inputs');
    const plan = await plain('plan', ['--input', 'topic=x'], broken);
    expect(plan.err + plan.out).not.toContain('takes no inputs');
  });

  it('names the command it was given in the usage that follows a bad option', async () => {
    const r = await plain('validate', ['--input', 'topic']);
    expect(r.err).toContain('Usage: indaba validate');
  });

  it('refuses before the dashboard when the answers and the options together are more than 200', async () => {
    const lines = `${Array.from({ length: 5 }, (_, i) => `specs/billing${i}`).join('\n')}\n\n`;
    const { dir } = await project();
    for (let i = 0; i < 5; i += 1) {
      await mkdir(join(dir, 'specs', `billing${i}`), { recursive: true });
    }
    const file = await writeWorkflow(dir, 'w.workflow.ai.yml', WORKFLOW);
    const captured = captureIo(dir, {});
    const stdin = new PassThrough();
    stdin.end(lines);
    const started: string[][] = [];
    const given = Array.from({ length: 198 }, (_, i) => ['--input', `topic=${i}`]).flat();
    const code = await main(['run', file, '--tui', ...given], {
      ...captured.io,
      terminal: { stdin, stdout: new PassThrough() },
      startRun: ((args: readonly string[]) => {
        started.push([...args]);
        return { exited: Promise.resolve(0), stderr: () => '', cancel() {}, kill() {}, release() {} };
      }) as never,
      loadTui: async () => ({ tui: { watch: async () => ({ quit: 'close' as const, code: 0 }) } }),
    });
    // 198 given + 5 asked: the duplicate topic is refused first, which is also before the child
    expect(code).toBe(2);
    expect(started).toEqual([]);
  });
});

describe('terminalInputAsker: a multiline text', () => {
  it('reads lines until an empty one and joins them with line feeds', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    stdin.end('first line\nsecond line\n\n');
    const declarations = [
      described({ name: 'body', type: 'text', limits: { maxLength: 500, multiline: true } }),
    ];
    const result = await terminalInputAsker(stdin, stdout)(declarations, ['body']);
    expect(result?.values).toEqual({ body: ['first line\nsecond line'] });
  });
});
