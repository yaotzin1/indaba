import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/index.js';
import { captureIo, makeTempDir, writePlugin, writeWorkflow } from './support.js';

const SECRET = 'topsecretvalue1';

const WORKFLOW = `version: "1.0"
name: "board-flow"
roles:
  worker:
    runner: "fake"
steps:
  - id: "work"
    role: "worker"
    goal: "do the thing"
    board:
      post: [note, fact]
`;

/** A runner that posts a note carrying the secret, and, when asked, breaks the board file before it does. */
const plugin = (breakBoardFile: boolean): string => `import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { RunResult } from '@indaba/core';
export default {
  name: 'board-plugin',
  register(host) {
    host.registerRunner({
      name: 'fake',
      async run(request) {
        if (${breakBoardFile}) {
          const traces = join(request.workdir, '.indaba', 'traces');
          const id = (await readdir(traces)).find((f) => f.endsWith('.events.jsonl'))?.split('.')[0];
          // a folder where the file should be: every later append fails
          await rm(join(traces, id + '.board.jsonl'), { force: true });
          await mkdir(join(traces, id + '.board.jsonl'));
        }
        return new RunResult({ exitCode: 0, output: 'BOARD note: the token is ${SECRET}\\nBOARD fact api.key: ${SECRET}' });
      },
    });
  },
};
`;

async function run(breakBoardFile: boolean) {
  const dir = await makeTempDir();
  const pluginFile = await writePlugin(dir, 'p.mjs', plugin(breakBoardFile));
  const workflow = await writeWorkflow(dir, 'w.yml', WORKFLOW);
  const captured = captureIo(dir, { MY_API_TOKEN: SECRET });
  const code = await main(['run', workflow, '--plugin', pluginFile, '-w', dir], captured.io);
  const traces = join(dir, '.indaba', 'traces');
  const files = await readdir(traces);
  return { code, traces, files };
}

describe('the board file of a run', () => {
  it('is written beside the trace and the event stream, whole lines in order, with the start record first', async () => {
    const { code, traces, files } = await run(false);
    expect(code).toBe(0);
    const name = files.find((f) => f.endsWith('.board.jsonl'));
    expect(name).toBeDefined();
    const lines = (await readFile(join(traces, name ?? ''), 'utf8')).trim().split('\n');
    const records = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(records[0]).toMatchObject({ type: 'board', v: 1, workflow: 'board-flow' });
    expect(records.filter((r) => r.type === 'post')).toHaveLength(2);
    expect(records.at(-1)).toMatchObject({ type: 'settle', outcome: 'accepted' });
    expect(files).toHaveLength(3);
  });

  it('holds the credential of the environment in no record: the board redacts as the event stream does', async () => {
    const { traces, files } = await run(false);
    const board = await readFile(join(traces, files.find((f) => f.endsWith('.board.jsonl')) ?? ''), 'utf8');
    expect(board).not.toContain(SECRET);
    expect(board).toContain('the token is [redacted]');
    const posts = board
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((r) => r.type === 'post');
    expect(posts.map((p) => p.text)).toEqual(['the token is [redacted]', '[redacted]']);
  });

  it('does not fail the run when it cannot be written: the root span says so, by the error’s class only', async () => {
    const { code, traces, files } = await run(true);
    expect(code).toBe(0);
    const traceFile = files.find(
      (f) => f.endsWith('.jsonl') && !f.includes('.events.') && !f.includes('.board.'),
    );
    const spans = (await readFile(join(traces, traceFile ?? ''), 'utf8'))
      .trim()
      .split('\n')
      .map(
        (l) =>
          JSON.parse(l) as {
            parent_span_id?: string | null;
            events?: { name: string; attributes: Record<string, unknown> }[];
          },
      );
    const degraded = spans
      .filter((s) => s.parent_span_id == null)
      .flatMap((s) => s.events ?? [])
      .filter((e) => e.name === 'indaba.board.degraded');
    if (degraded.length !== 1) {
      console.log(JSON.stringify(spans.map((s) => ({ p: s.parent_span_id, e: s.events }))), files);
    }
    expect(degraded).toHaveLength(1);
    const error = degraded[0]?.attributes['indaba.board.error'];
    expect(typeof error).toBe('string');
    expect(error).toMatch(/^[A-Za-z]+$/);
    expect(JSON.stringify(degraded)).not.toContain(traces);
  });
});
