import { describe, expect, it } from 'vitest';
import { main } from '../src/index.js';
import { captureIo, makeTempDir, writePlugin, writeWorkflow } from './support.js';

// specs/step-stalls, release 2: what validate, plan and run say about a stall limit (AC-12, AC-18).

const HEAD =
  'version: "1.0"\nname: stall-cli\nroles:\n  steady: {runner: steady}\n  plain: {runner: plain}\n';

/** `steady` says it can report activity; `plain` is a runner written before the capability existed. */
const PLUGIN = `export default {
  name: 'stall-plugin',
  register(host) {
    host.registerRunner({ name: 'steady', canReportActivity: true, async run() { throw new Error('never run'); } });
    host.registerRunner({ name: 'plain', async run() { throw new Error('never run'); } });
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

const step = (role: string, stall: string, extra = '') =>
  `${HEAD}steps:\n  - {id: a, role: ${role}, goal: g, ${extra}stall: ${stall}}\n`;

const REFUSAL = (runner: string) =>
  `step "a": runner "${runner}" cannot report activity, so stall cannot be used with it`;

describe('indaba plan and stall', () => {
  it('prints the limit and the retries among the extras of a step that sets them', async () => {
    const r = await run(
      ['plan'],
      step('steady', '{after_seconds: 120, retries: 1}', 'isolation: git_worktree, '),
    );

    expect(r.code).toBe(0);
    const line = r.out.split('\n').find((l) => l.includes(' a ['));
    expect(line).toContain('stall 120s');
    expect(line).toContain('stall retries 1');
  });

  it('prints no retries when there are none, and nothing at all for a step without stall', async () => {
    const r = await run(
      ['plan'],
      `${HEAD}steps:\n  - {id: a, role: steady, goal: g, stall: {after_seconds: 90}}\n  - {id: b, role: steady, goal: g}\n`,
    );
    const lines = r.out.split('\n');

    expect(lines.find((l) => l.includes(' a ['))).toContain('stall 90s');
    expect(lines.find((l) => l.includes(' a ['))).not.toContain('retries');
    expect(lines.find((l) => l.includes(' b ['))).not.toContain('stall');
  });

  it('says that a runner cannot hold the limit, and fails', async () => {
    const r = await run(['plan'], step('plain', '{after_seconds: 90}'));

    expect(r.code).not.toBe(0);
    expect(r.out).toContain(`stall error: ${REFUSAL('plain')}`);
  });
});

describe('indaba validate and stall (AC-11, AC-12)', () => {
  it('accepts a runner that can report activity', async () => {
    const r = await run(['validate'], step('steady', '{after_seconds: 90}'));

    expect(r.code).toBe(0);
    expect(r.out).toContain('is valid');
  });

  it('refuses a runner that cannot, naming the step and the runner', async () => {
    const r = await run(['validate'], step('plain', '{after_seconds: 90}'));

    expect(r.code).toBe(1);
    expect(r.out).toContain('is invalid');
    expect(r.out).toContain(REFUSAL('plain'));
  });

  it('shows the problems of the field with the step and a number, never the file text', async () => {
    const r = await run(['validate'], step('steady', '{after_seconds: 59}'));

    expect(r.code).toBe(1);
    expect(r.out).toContain('step "a": stall.after_seconds must be a whole number from 60 to 3600');
  });
});

describe('indaba run and stall', () => {
  it('refuses to start, before anything is sent to an agent, when a runner cannot hold the limit', async () => {
    const r = await run(['run'], step('plain', '{after_seconds: 90}'));

    expect(r.code).toBe(1);
    expect(r.out).toContain(REFUSAL('plain'));
    expect(r.out + r.err).not.toContain('never run');
  });
});
