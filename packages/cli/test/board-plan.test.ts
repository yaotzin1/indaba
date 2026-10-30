import { describe, expect, it } from 'vitest';
import { main } from '../src/index.js';
import { captureIo, makeTempDir, writePlugin, writeWorkflow } from './support.js';

const HEAD = 'version: "1.0"\nname: board-plan\nroles:\n  worker: {runner: fake}\n  critic: {runner: fake}\n';

const WORKFLOW = `${HEAD}steps:
  - {id: research, role: worker, goal: find}
  - id: plain
    role: worker
    goal: no board
    depends_on: [research]
  - id: writes
    role: worker
    goal: leaves notes
    depends_on: [research]
    board: {post: [note, fact]}
  - id: reads
    role: worker
    goal: reads everything
    depends_on: [research, writes]
    board: {read: {}}
  - id: picky
    role: worker
    goal: reads some
    depends_on: [research, writes]
    board:
      read: {steps: [research], kinds: [result, fact]}
      post: [question]
      digest_chars: 1200
  - id: talk
    role: worker
    goal: debate
    consensus_with: [critic]
    depends_on: [picky]
    board: {read: {}}
`;

const PLUGIN = `export default {
  name: 'board-plan-plugin',
  register(host) {
    host.registerRunner({ name: 'fake', async run() { throw new Error('never run'); } });
  },
};
`;

async function run(args: string[], workflow: string) {
  const dir = await makeTempDir();
  const file = await writeWorkflow(dir, 'w.yml', workflow);
  const plugin = await writePlugin(dir, 'p.mjs', PLUGIN);
  const captured = captureIo(dir, {});
  const code = await main([...args, file, '--plugin', plugin], captured.io);
  return { code, out: captured.stdout(), err: captured.stderr() };
}

describe('indaba plan and the board', () => {
  it('prints one indented line under each step that has a board, and nothing under the others', async () => {
    const r = await run(['plan'], WORKFLOW);
    const lines = r.out.split('\n');
    const at = (id: string) => lines.findIndex((l) => l.includes(` ${id} [`));
    expect(lines[at('research') + 1]).not.toContain('board:');
    expect(lines[at('plain') + 1]).not.toContain('board:');
    expect(lines[at('writes') + 1]).toBe('   board: reads nothing; may post note, fact');
    expect(lines[at('reads') + 1]).toBe(
      '   board: reads all ancestors (note, question, result, fact, decision), at most 4000 characters; may post nothing',
    );
    expect(lines[at('picky') + 1]).toBe(
      '   board: reads research (result, fact), at most 1200 characters; may post question',
    );
    expect(lines[at('talk') + 1]).toBe(
      '   board: reads all ancestors (note, question, result, fact, decision), at most 4000 characters; may post nothing',
    );
  });

  it('leaves the output of a workflow with no board exactly as it was', async () => {
    const r = await run(
      ['plan'],
      `${HEAD}steps:\n  - {id: a, role: worker, goal: x}\n  - {id: b, role: worker, goal: y, depends_on: [a]}\n`,
    );
    expect(r.out).not.toContain('board');
  });
});

describe('indaba validate and the board', () => {
  it('shows the problems of the field with their paths, together, and exits with a failure', async () => {
    const r = await run(
      ['validate'],
      `${HEAD}steps:
  - {id: a, role: worker, goal: x}
  - id: b
    role: worker
    goal: y
    depends_on: [a]
    board: {read: {kinds: [bogus]}, post: [decision], digest_chars: 1}
`,
    );
    expect(r.code).not.toBe(0);
    const text = r.out + r.err;
    for (const path of [
      'steps[1].board.read.kinds[0]',
      'steps[1].board.post[0]',
      'steps[1].board.digest_chars',
    ]) {
      expect(text).toContain(path);
    }
  });

  it('shows a read step that does not exist or is not an ancestor, once the field itself is sound', async () => {
    const r = await run(
      ['validate'],
      `${HEAD}steps:
  - {id: a, role: worker, goal: x}
  - {id: b, role: worker, goal: y, depends_on: [a], board: {read: {steps: [nowhere]}}}
`,
    );
    expect(r.code).not.toBe(0);
    expect(r.out + r.err).toContain('steps[1].board.read.steps[0] "nowhere" is not a step');

    const other = await run(
      ['validate'],
      `${HEAD}steps:
  - {id: a, role: worker, goal: x}
  - {id: c, role: worker, goal: z}
  - {id: b, role: worker, goal: y, depends_on: [a], board: {read: {steps: [c]}}}
`,
    );
    expect(other.code).not.toBe(0);
    expect(other.out + other.err).toContain(
      'steps[2].board.read.steps[0] "c" is not an ancestor of this step',
    );
  });

  it('accepts a good board', async () => {
    const r = await run(['validate'], WORKFLOW);
    expect(r.code).toBe(0);
  });
});

describe('plain words in what the command line says about the board (AC-40)', () => {
  const BANNED = /digest|settle|supersede|degraded|jsonl/i;
  const PATH = /steps\[\d+\](?:\.[a-z_]+|\[\d+\])*/g;

  it('keeps the banned words out of the plan lines and of the validation errors', async () => {
    const plan = await run(['plan'], WORKFLOW);
    const bad = await run(
      ['validate'],
      `${HEAD}steps:\n  - {id: s, runner: shell, commands: [echo], board: {read: {}}}\n  - {id: a, role: worker, goal: x, board: {post: [critique], digest_chars: 5, read: {steps: [q]}}}\n`,
    );
    const boardLines = plan.out.split('\n').filter((l) => l.includes('board:'));
    expect(boardLines.length).toBeGreaterThanOrEqual(4);
    for (const line of [...boardLines, ...(bad.out + bad.err).split('\n')]) {
      expect(line.replace(PATH, ''), line).not.toMatch(BANNED);
    }
  });
});
