import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type BoardRecord, RunBoard } from '@indaba/core';
import { BoardReader } from '@indaba/engine';
import { describe, expect, it } from 'vitest';
import { corePath, makeGitRepo, pluginSource, requireBuild, runCli, writeFileIn } from './support.js';

requireBuild();

const WORKFLOW = `version: "1.0"
name: "board-flow"
roles:
  worker:
    runner: "poster"
  critic:
    runner: "critic"
steps:
  - id: "research"
    role: "worker"
    goal: "find the facts"
    board:
      post: [note, fact]
  - id: "reader"
    role: "worker"
    goal: "summarise what was found"
    depends_on: ["research"]
    board:
      read: {}
  - id: "argue"
    role: "worker"
    goal: "decide whether to ship"
    depends_on: ["reader"]
    consensus_with: ["critic"]
    board:
      read: {}
`;

const PLUGIN = pluginSource(`
import { BoardRecorded } from ${JSON.stringify(pathToFileURL(corePath).href)};
export default {
  name: 'board-e2e',
  register(host) {
    host.registerRunner({
      name: 'poster',
      async run(request) {
        if (request.prompt.includes('find the facts')) {
          return new RunResult({ exitCode: 0, output: 'done\\nBOARD note: the API is paged\\nBOARD fact api.version: v2' });
        }
        if (request.prompt.includes('summarise what was found')) {
          process.stderr.write('[prompt] ' + JSON.stringify(request.prompt) + '\\n');
          return new RunResult({ exitCode: 0, output: 'summary written' });
        }
        return new RunResult({ exitCode: 0, output: 'AGREEMENT: ship it' });
      },
    });
    host.registerRunner({ name: 'critic', async run() { return new RunResult({ exitCode: 0, output: 'AGREEMENT: fine by me' }); } });
    host.addListener(BoardRecorded, (event) => {
      process.stderr.write('[board] ' + JSON.stringify(event.record) + '\\n');
    });
  },
};
`);

const tagged = (stderr: string, tag: string): unknown[] =>
  stderr
    .split(/\r?\n/)
    .filter((l) => l.startsWith(`[${tag}] `))
    .map((l) => JSON.parse(l.slice(tag.length + 3)) as unknown);

describe('the run board, through the built CLI', () => {
  it('carries notes to a later step, shows a debate, and replays to the board that was live', async () => {
    const dir = await makeGitRepo();
    await writeFileIn(dir, 'flow.workflow.ai.yml', WORKFLOW);
    await writeFileIn(dir, 'plugin.mjs', PLUGIN);

    const plan = await runCli(['plan', 'flow.workflow.ai.yml', '--plugin', './plugin.mjs'], dir);
    expect(plan.code, plan.stdout + plan.stderr).toBe(0);
    expect(plan.stdout).toContain('board: reads nothing; may post note, fact');

    const run = await runCli(
      ['run', 'flow.workflow.ai.yml', '--plugin', './plugin.mjs', '--task-id', 'e2e-board'],
      dir,
    );
    expect(run.code, run.stdout + run.stderr).toBe(0);
    expect(run.stdout).toContain('Task e2e-board finished: COMPLETED');

    // the later step's prompt holds the earlier step's notes
    const [prompt] = tagged(run.stderr, 'prompt');
    expect(typeof prompt).toBe('string');
    expect(prompt).toContain('the API is paged');
    expect(prompt).toContain('api.version');

    // the board file: written beside the trace, with the debate on it
    const traces = join(dir, '.indaba', 'traces');
    const name = (await readdir(traces)).find((f) => f.endsWith('.board.jsonl'));
    expect(name, relative(dir, traces)).toBeDefined();
    const text = await readFile(join(traces, name ?? ''), 'utf8');
    const file = text.trim().split(String.fromCharCode(10));
    expect(file.length).toBeGreaterThan(5);
    expect(text).toContain('"step_id":"argue"');
    expect(text).toContain('ship it');

    // a replayed board equals the live one: the file, read back and replayed, holds the records that went by
    const live = tagged(run.stderr, 'board');
    const records = new BoardReader(traces);
    const runId = (name ?? '').replace('.board.jsonl', '');
    const replayed = RunBoard.replay(
      (await records.readAll(runId)).filter((r): r is BoardRecord => r.type !== 'unknown'),
      { traceId: runId, workflow: 'board-flow', clock: { now: () => new Date(0) } },
    );
    expect(replayed.records().map((r) => JSON.stringify(r))).toEqual(live.map((r) => JSON.stringify(r)));
    expect(replayed.entries().some((e) => e.stepId === 'argue')).toBe(true);

    // watch --plain ends with the board
    const watch = await runCli(['watch', 'latest', '--plain'], dir);
    expect(watch.code).toBe(0);
    expect(watch.stdout).toContain('api.version: v2 (research)');
    expect(watch.stdout).toMatch(/#\d+ research note: the API is paged/);
    expect(watch.stdout).toMatch(/#\d+ argue \w+:/);
  });
});
