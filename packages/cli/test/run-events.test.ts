import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/index.js';
import { redact } from '../src/redact.js';
import { captureIo, FIXTURE_WORKFLOW, makeTempDir, writePlugin, writeWorkflow } from './support.js';

describe('redact', () => {
  it('replaces the value of a variable whose name says it is a credential, wherever it appears', () => {
    const env = {
      MY_API_KEY: 'abcd1234',
      GH_TOKEN: 'tok-9999',
      DB_PASSWORD: 'hunter22',
      APP_SECRET: 'shh-shh',
      X_CREDENTIAL: 'cred1234',
    };
    expect(redact('a abcd1234 b tok-9999 c hunter22 d shh-shh e cred1234 f', env)).toBe(
      'a [redacted] b [redacted] c [redacted] d [redacted] e [redacted] f',
    );
    expect(redact('abcd1234abcd1234', env)).toBe('[redacted][redacted]');
  });

  it('matches the name in any case and anywhere in it', () => {
    expect(redact('v1234', { api_key: 'v1234' })).toBe('[redacted]');
    expect(redact('v1234', { SOME_TOKEN_VALUE: 'v1234' })).toBe('[redacted]');
    expect(redact('v1234', { Secret: 'v1234' })).toBe('[redacted]');
  });

  it('leaves a value alone when the name does not look like a credential', () => {
    expect(redact('home is /home/me', { HOME: '/home/me', PATH: '/bin' })).toBe('home is /home/me');
  });

  it('does not treat a value shorter than four characters as a secret', () => {
    expect(redact('on 1 and abc', { MY_KEY: '1', OTHER_TOKEN: 'abc' })).toBe('on 1 and abc');
    expect(redact('abcd', { MY_KEY: 'abcd' })).toBe('[redacted]');
  });

  it('ignores variables with no value, and changes nothing for an empty environment', () => {
    expect(redact('text', { MY_KEY: undefined })).toBe('text');
    expect(redact('text', {})).toBe('text');
    expect(redact('', { MY_KEY: 'abcd' })).toBe('');
  });
});

describe('the event stream a run leaves behind', () => {
  const SECRET = 'topsecretvalue1';

  const plugin = (): string => `import { RunResult } from '@indaba/core';
export default {
  name: 'streaming-plugin',
  register(host) {
    host.registerRunner({
      name: 'fake',
      async run(request) {
        request.onOutput?.('the token is ${SECRET} and that is all\\n');
        return new RunResult({ exitCode: 0, output: 'done' });
      },
    });
  },
};
`;

  async function run(
    env: Record<string, string | undefined>,
  ): Promise<{ dir: string; events: string; trace: string }> {
    const dir = await makeTempDir();
    const pluginFile = await writePlugin(dir, 'p.mjs', plugin());
    const workflow = await writeWorkflow(
      dir,
      'w.yml',
      FIXTURE_WORKFLOW.replace(/guards:\n\s+- type: "always_ok"\n/, ''),
    );
    const captured = captureIo(dir, env);
    const code = await main(['run', workflow, '--plugin', pluginFile, '-w', dir], captured.io);
    expect(code).toBe(0);

    const traces = join(dir, '.indaba', 'traces');
    const files = await readdir(traces);
    const eventsFile = files.find((f) => f.endsWith('.events.jsonl'));
    const traceFile = files.find((f) => f.endsWith('.jsonl') && !f.endsWith('.events.jsonl'));
    expect(eventsFile).toBeDefined();
    expect(traceFile).toBeDefined();
    return {
      dir,
      events: await readFile(join(traces, eventsFile ?? ''), 'utf8'),
      trace: await readFile(join(traces, traceFile ?? ''), 'utf8'),
    };
  }

  it('stores what a step streamed, with the value of a credential in the environment redacted', async () => {
    const { events } = await run({ MY_API_TOKEN: SECRET });

    expect(events).not.toContain(SECRET);
    const outputs = events
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((r) => r.type === 'output');
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.text).toBe('the token is [redacted] and that is all\n');
  });

  it('stores the text as it came when nothing in the environment looks like a credential', async () => {
    const { events } = await run({ HOME: '/home/me' });
    expect(events).toContain(`the token is ${SECRET} and that is all`);
  });

  it('records the steps as they change, and the root span ending with the run status', async () => {
    const { events } = await run({});
    const records = events
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);

    expect(
      records.filter((r) => r.type === 'step_status').map((r) => `${String(r.from)}->${String(r.to)}`),
    ).toEqual(['PENDING->RUNNING', 'RUNNING->VALIDATING', 'VALIDATING->COMPLETED']);
    const last = records.at(-1);
    expect(last).toMatchObject({ type: 'span_ended' });
    expect(last).toMatchObject({ attributes: { 'indaba.workflow.status': 'COMPLETED' } });
  });

  it('leaves the trace file with only span records, no event-stream record types', async () => {
    const { trace } = await run({});
    for (const line of trace.trim().split('\n')) {
      const record = JSON.parse(line) as Record<string, unknown>;
      expect(record).not.toHaveProperty('type');
      expect(record).toHaveProperty('span_id');
    }
  });
});
