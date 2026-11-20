import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { main } from '../src/index.js';
import { readinessLines } from '../src/readiness-report.js';
import { captureIo, makeGitRepo, writeWorkflow } from './support.js';

// A git hook hands GIT_DIR to everything it starts; the run below would work on the real repository.
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
name: ready-flow
requires:
  - { kind: env, name: INDABA_TEST_NEVER_SET, description: a key the test never sets, critical: true, how: set it }
  - { kind: account, name: Google, description: the OAuth client exists }
steps:
  - id: only
    runner: shell
    commands: ["echo hi"]
    input_artifacts: ["brief.md"]
`;

async function start(command: 'plan' | 'run', extra: string[] = []) {
  const dir = await makeGitRepo();
  const file = await writeWorkflow(dir, 'w.yml', WORKFLOW);
  const captured = captureIo(dir, {});
  const code = await main(
    [command, file, ...(command === 'run' ? ['--workdir', dir] : []), ...extra],
    captured.io,
  );
  return { code, out: captured.stdout(), err: captured.stderr() };
}

describe('readiness in indaba plan (AC-14)', () => {
  it('prints a readiness section after the plan, critical first, with how to fix it', async () => {
    const r = await start('plan');
    expect(r.code).toBe(0);
    const text = r.out;
    expect(text.indexOf('1. only')).toBeLessThan(text.indexOf('readiness:'));
    expect(text).toContain('readiness: 1 ready, 3 to look at');
    const lines = text.split('\n');
    const first = lines.findIndex((l) => l.includes('CRITICAL missing: INDABA_TEST_NEVER_SET is not set'));
    const account = lines.findIndex((l) => l.includes('needs your confirmation: the OAuth client exists'));
    const artifact = lines.findIndex((l) => l.includes('missing: brief.md: it does not exist'));
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(account);
    expect(account).toBeLessThan(artifact);
    expect(lines[first]).toContain('How: set it');
  });
});

describe('readiness in indaba run (AC-14, AC-15)', () => {
  it('prints the report as a warning and starts the run exactly as before; exit code unchanged', async () => {
    const r = await start('run');
    expect(r.out).toContain('CRITICAL missing: INDABA_TEST_NEVER_SET is not set');
    expect(r.out.indexOf('readiness:')).toBeLessThan(r.out.indexOf('finished'));
    expect(r.out).toContain('finished: COMPLETED');
    expect(r.code).toBe(0);
  });

  it('--confirm turns a needs-confirmation item into confirmed, for this run only (AC-12)', async () => {
    const confirmed = await start('run', ['--confirm', 'account:-:Google']);
    expect(confirmed.out).not.toContain('needs your confirmation');
    expect(confirmed.out).toContain('readiness: 2 ready, 2 to look at');
    const again = await start('run');
    expect(again.out).toContain('needs your confirmation: the OAuth client exists');
  });

  it('--confirm is not an option of plan', async () => {
    const r = await start('plan', ['--confirm', 'account:-:Google']);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("Unknown option '--confirm'");
  });
});

describe('readinessLines', () => {
  it('prints nothing for an empty report and collapses ready items to a count (AC-13)', () => {
    expect(readinessLines({ items: [], criticalMissing: 0, needsConfirmation: 0 })).toEqual([]);
    const lines = readinessLines({
      items: [
        {
          id: 'runner:a:codex',
          kind: 'runner',
          state: 'ready',
          critical: true,
          message: 'codex is available',
        },
        {
          id: 'tool:-:jq',
          kind: 'tool',
          state: 'unknown',
          critical: false,
          message: 'jq could not be checked',
        },
      ],
      criticalMissing: 0,
      needsConfirmation: 0,
    });
    expect(lines).toEqual([
      'readiness: 1 ready, 1 to look at',
      '  could not be checked: jq could not be checked.',
    ]);
  });
});

describe('readinessLines and terminal text (section 6)', () => {
  it('turns control characters of workflow text into spaces', () => {
    const esc = String.fromCharCode(27);
    const lines = readinessLines({
      items: [
        {
          id: 'env:-:E',
          kind: 'env',
          state: 'missing',
          critical: false,
          message: `bad${esc}]0;title${String.fromCharCode(7)} text`,
          how: `go${esc}[2J`,
        },
      ],
      criticalMissing: 0,
      needsConfirmation: 0,
    });
    expect(lines.join('\n')).not.toContain(esc);
    expect(lines.join('\n')).not.toContain(String.fromCharCode(7));
  });
});
