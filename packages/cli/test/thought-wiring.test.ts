import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/index.js';
import { captureIo, makeTempDir, writePlugin, writeWorkflow } from './support.js';

const SECRET = 'topsecretvalue1';

const WORKFLOW = `version: "1.0"
name: "thought-flow"
roles:
  worker:
    runner: "fake"
steps:
  - id: "work"
    role: "worker"
    goal: "do the thing"
`;

// A plugin runner only calls the request's onThought: it has the same channel a built-in runner has (AC-01, US-04).
const PLUGIN = `import { RunResult } from '@indaba/core';
export default {
  name: 'thought-plugin',
  register(host) {
    host.registerRunner({
      name: 'fake',
      async run(request) {
        request.onThought?.('weighing the options, token ${SECRET}\\n');
        return new RunResult({ exitCode: 0, output: 'done' });
      },
    });
  },
};
`;

describe('the reasoning of a plugin runner, through the composition root', () => {
  it('is written to the event stream, redacted, and nowhere else', async () => {
    const dir = await makeTempDir();
    const pluginFile = await writePlugin(dir, 'p.mjs', PLUGIN);
    const workflow = await writeWorkflow(dir, 'w.yml', WORKFLOW);
    const captured = captureIo(dir, { MY_API_TOKEN: SECRET });
    const code = await main(['run', workflow, '--plugin', pluginFile, '-w', dir], captured.io);
    expect(code).toBe(0);

    const traces = join(dir, '.indaba', 'traces');
    const files = await readdir(traces);
    const events = await readFile(join(traces, files.find((f) => f.endsWith('.events.jsonl')) ?? ''), 'utf8');
    const records = events
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { type: string; text?: string });
    const thoughts = records.filter((r) => r.type === 'thought');
    expect(thoughts).toHaveLength(1);
    expect(thoughts[0]?.text).toContain('weighing the options');
    expect(events).not.toContain(SECRET);

    const spans = await readFile(
      join(traces, files.find((f) => /^[0-9a-f]{32}\.jsonl$/.test(f)) ?? ''),
      'utf8',
    );
    expect(spans).not.toContain('weighing the options');
    expect(spans).toContain('indaba.thought.chars');
    expect(captured.stdout()).not.toContain('weighing the options');
  });
});
