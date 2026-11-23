import { describe, expect, it } from 'vitest';
import { main } from '../src/index.js';
import { captureIo, makeTempDir, writeWorkflow } from './support.js';

/** specs/openclaw, T-07, T-08 and T-10: what `validate`, `plan` and `catalog` say about a step on OpenClaw. */

const workflow = (role: string, extra = '', mcp = '') => `version: "1.0"
name: oc
roles:
  helper:
    runner: openclaw
${role}${mcp === '' ? '' : 'mcp_servers:\n  docs:\n    command: docs-mcp\n'}steps:
  - id: ask
    role: helper
    goal: "Say hi"
${extra}`;

async function command(name: 'validate' | 'plan', yaml: string, env: Record<string, string> = {}) {
  const dir = await makeTempDir();
  const file = await writeWorkflow(dir, 'oc.workflow.ai.yml', yaml);
  const captured = captureIo(dir, env);
  const code = await main([name, file], captured.io);
  return { code, out: captured.stdout(), err: captured.stderr() };
}

describe('a step on the openclaw runner', () => {
  it('cannot be held to read or edit: an error before anything runs, with the reason in words', async () => {
    for (const level of ['read', 'edit']) {
      // `edit` must name the folders it may change before the runner is even asked.
      const written = level === 'edit' ? 'level: edit, fs: { write: ["src/**"] }' : 'level: read';
      const r = await command('validate', workflow(`    permissions: { ${written} }\n`));
      expect(r.code, level).toBe(1);
      expect(r.out, level).toContain(`the runner "openclaw" cannot hold the level "${level}"`);
      expect(r.out, level).toContain('its bridge does not use the file and terminal requests Indaba answers');
    }
    const plan = await command(
      'plan',
      workflow('    permissions: { level: edit, fs: { write: ["src/**"] } }\n'),
    );
    expect(plan.code).toBe(1);
    expect(plan.out).toContain(
      'permissions error: step "ask": the runner "openclaw" cannot hold the level "edit"',
    );
  });

  it('accepts full, and a step with no level, which is the existing default fact', async () => {
    const full = await command('validate', workflow('    permissions: { level: full }\n'));
    expect(full.code).toBe(0);
    expect(full.out).toContain('oc is valid');
    const none = await command('validate', workflow(''));
    expect(none.code).toBe(0);
    expect(none.out).toContain('oc is valid');
  });

  it('is refused the MCP servers of the workflow in plan when they are required, and skipped when optional', async () => {
    const required = await command('plan', workflow('', '    mcp: [docs]\n', 'docs'));
    expect(required.code).toBe(1);
    expect(required.out).toContain(
      'MCP error: step "ask" (runner openclaw), server "docs": the runner has no MCP support (policy: required)',
    );
    const optional = await command(
      'plan',
      workflow('', '    mcp: [docs]\n    mcp_policy: optional\n', 'docs'),
    );
    expect(optional.out).toContain('MCP warning:');
    expect(optional.out).not.toContain('MCP error:');
  });

  it('is looked for on the PATH, and a missing program is a critical item in the readiness report', async () => {
    const r = await command('plan', workflow(''), { PATH: '' });
    expect(r.out).toContain('CRITICAL missing: openclaw is not available on this machine.');
    expect(r.out).toContain('Install openclaw so its program is on the PATH');
    expect(r.code).toBe(0);
  });
});

describe('indaba catalog lists openclaw', () => {
  it('with read and edit unsupported and full accepted', async () => {
    const dir = await makeTempDir();
    const captured = captureIo(dir, {});
    const code = await main(['catalog', '--json'], captured.io);
    expect(code).toBe(0);
    const catalog = JSON.parse(captured.stdout()) as {
      runners: { name: string; permissions: Record<string, { mode: string; note: string }> }[];
    };
    const entry = catalog.runners.find((runner) => runner.name === 'openclaw');
    expect(entry?.permissions.read).toMatchObject({ mode: 'unsupported', note: 'no_client_methods' });
    expect(entry?.permissions.edit).toMatchObject({ mode: 'unsupported', note: 'no_client_methods' });
    expect(entry?.permissions.full).toMatchObject({ mode: 'acp', note: 'gate_allows_all' });
  });
});

describe('a role that names its own command for openclaw (AC-04)', () => {
  it('is ready when that program exists, though none called openclaw is on the PATH', async () => {
    const written = JSON.stringify([process.execPath, 'acp']);
    const r = await command('plan', workflow(`    agent: { command: ${written} }\n`), { PATH: '' });
    expect(r.out).not.toContain('openclaw is not available on this machine');
    expect(r.out).toContain('readiness:');
    expect(r.code).toBe(0);
  });
});
