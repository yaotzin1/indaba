import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { main } from '../src/index.js';
import { captureIo, makeTempDir, writePlugin, writeWorkflow } from './support.js';

/** A plugin runner that declares every level and logs the level it was started with. */
function capablePlugin(logFile: string): string {
  return `import { appendFileSync } from 'node:fs';
import { EOL } from 'node:os';
import { RunResult } from '@indaba/core';

const rows = ['read', 'edit', 'full'].map((level) => ({
  level, mode: 'native', scope: level === 'full' ? 'none' : 'guard', note: 'test',
}));

export default {
  name: 'capable-plugin',
  register(host) {
    host.registerRunner({
      name: 'cap',
      permissionCapabilities: () => rows,
      permissionDenied: () => false,
      canRecogniseDenial: false,
      async run(request) {
        appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({ level: request.permissionLevel ?? null, hasBlock: request.permissions !== undefined }) + EOL);
        return new RunResult({ exitCode: 0, output: 'done' });
      },
    });
  },
};
`;
}

const writerWorkflow = (permissions: string): string => `version: "1.0"
name: "perm-flow"
roles:
  worker:
    runner: "cap"
steps:
  - id: "work"
    role: "worker"
    goal: "do it"
${permissions}`;

const FULL = '    permissions:\n      level: full\n';
const EDIT = '    permissions:\n      level: edit\n      fs:\n        write: ["src/**"]\n';

async function setup(permissions: string) {
  const dir = await makeTempDir();
  // A read or edit step has the scope guard, which reads git state.
  execFileSync('git', ['init', '-q'], { cwd: dir });
  // The plugin, the workflow and the log stay outside the project, so the scope guard sees only what the step changed.
  const aux = await makeTempDir();
  const log = join(aux, 'log.jsonl');
  const plugin = await writePlugin(aux, 'p.mjs', capablePlugin(log));
  const file = await writeWorkflow(aux, 'f.yml', writerWorkflow(permissions));
  const started = (): { level: string | null; hasBlock: boolean }[] => {
    try {
      return readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as { level: string | null; hasBlock: boolean });
    } catch {
      return [];
    }
  };
  return { dir, plugin, file, started };
}

function traceText(dir: string): string {
  const folder = join(dir, '.indaba', 'traces');
  return readdirSync(folder)
    .map((name) => readFileSync(join(folder, name), 'utf8'))
    .join('\n');
}

function withTerminal(dir: string, answer: string) {
  const captured = captureIo(dir);
  let shown = '';
  const stdout = new Writable({
    write(chunk, _encoding, done) {
      shown += String(chunk);
      done();
    },
  });
  return {
    captured: { ...captured, io: { ...captured.io, terminal: { stdin: Readable.from([answer]), stdout } } },
    shown: () => shown,
  };
}

describe('steps at the level full (specs/agent-permissions AC-05)', () => {
  it('refuses to start without a terminal or --allow-full-access, naming the steps', async () => {
    const { dir, plugin, file, started } = await setup(FULL);
    const captured = captureIo(dir);
    const code = await main(['run', file, '--plugin', plugin], captured.io);
    expect(code).toBe(2);
    expect(captured.stderr()).toContain('work (cap)');
    expect(captured.stderr()).toContain('--allow-full-access');
    expect(started()).toEqual([]);
  });

  it('starts with --allow-full-access and records it as run_option on the task span; no block is sent at full', async () => {
    const { dir, plugin, file, started } = await setup(FULL);
    const captured = captureIo(dir);
    expect(
      await main(['run', file, '--plugin', plugin, '--allow-full-access', '--task-id', 'a1'], captured.io),
    ).toBe(0);
    expect(started()).toEqual([{ level: 'full', hasBlock: false }]);
    expect(captured.stdout()).toContain('FULL ACCESS');
    expect(traceText(dir)).toContain('"indaba.permissions.full_acknowledged":"run_option"');
  });

  it('records page when the server passes --allow-full-access=page', async () => {
    const { dir, plugin, file } = await setup(FULL);
    const captured = captureIo(dir);
    expect(await main(['run', file, '--plugin', plugin, '--allow-full-access=page'], captured.io)).toBe(0);
    expect(traceText(dir)).toContain('"indaba.permissions.full_acknowledged":"page"');
  });

  it('asks at a terminal, starts on a yes and records terminal', async () => {
    const { dir, plugin, file, started } = await setup(FULL);
    const terminal = withTerminal(dir, 'y\n');
    expect(await main(['run', file, '--plugin', plugin], terminal.captured.io)).toBe(0);
    expect(terminal.shown()).toContain('work (cap)');
    expect(started()).toHaveLength(1);
    expect(traceText(dir)).toContain('"indaba.permissions.full_acknowledged":"terminal"');
  });

  it('does not start on anything but a yes, and the acknowledgement does not carry over', async () => {
    const { dir, plugin, file, started } = await setup(FULL);
    const terminal = withTerminal(dir, 'n\n');
    const captured = terminal.captured;
    expect(await main(['run', file, '--plugin', plugin], captured.io)).toBe(2);
    expect(captured.stderr()).toContain('not confirmed');
    expect(started()).toEqual([]);
    // a second run is asked again
    const second = withTerminal(dir, 'y\n');
    expect(await main(['run', file, '--plugin', plugin], second.captured.io)).toBe(0);
    expect(second.shown()).toContain('work (cap)');
  });

  it('does not ask for a step that is not at full', async () => {
    const { dir, plugin, file, started } = await setup(EDIT);
    const captured = captureIo(dir);
    expect(await main(['run', file, '--plugin', plugin], captured.io)).toBe(0);
    expect(started()).toEqual([{ level: 'edit', hasBlock: true }]);
  });
});

describe('--permissions (AC-12)', () => {
  it('lowers a written level for this run and sends the read block', async () => {
    const { dir, plugin, file, started } = await setup(EDIT);
    const captured = captureIo(dir);
    expect(await main(['run', file, '--plugin', plugin, '--permissions', 'read'], captured.io)).toBe(0);
    expect(started()).toEqual([{ level: 'read', hasBlock: true }]);
  });

  it('lowers a step at full so that it no longer needs the acknowledgement', async () => {
    const { dir, plugin, file, started } = await setup(FULL);
    const captured = captureIo(dir);
    expect(await main(['run', file, '--plugin', plugin, '--permissions', 'work=read'], captured.io)).toBe(0);
    expect(started()).toEqual([{ level: 'read', hasBlock: true }]);
  });

  it('is a usage error for a bad level, a missing step, and writes nothing', async () => {
    const { dir, plugin, file, started } = await setup(EDIT);
    for (const bound of ['ask', 'nope=read', '=read']) {
      const captured = captureIo(dir);
      expect(await main(['run', file, '--plugin', plugin, '--permissions', bound], captured.io)).toBe(2);
    }
    expect(started()).toEqual([]);
  });

  it('is accepted only by run', async () => {
    const { dir, file } = await setup(EDIT);
    const captured = captureIo(dir);
    expect(await main(['validate', file, '--permissions', 'read'], captured.io)).toBe(2);
  });
});

describe('validate and plan (AC-07, AC-08)', () => {
  it('refuses a level a runner of the chain cannot hold', async () => {
    const dir = await makeTempDir();
    const file = await writeWorkflow(
      dir,
      'f.yml',
      `version: "1.0"\nname: "w"\nroles:\n  worker:\n    runner: "opencode"\nsteps:\n  - id: "work"\n    role: "worker"\n    goal: "g"\n    permissions:\n      level: read\n`,
    );
    const validate = captureIo(dir);
    expect(await main(['validate', file], validate.io)).toBe(1);
    expect(validate.stdout()).toContain('the runner "opencode" cannot hold the level "read"');
    const plan = captureIo(dir);
    expect(await main(['plan', file], plan.io)).toBe(1);
    expect(plan.stdout()).toContain('permissions error:');
  });

  it('states the full sentence in plan', async () => {
    const { dir, plugin, file } = await setup(FULL);
    const plan = captureIo(dir);
    expect(await main(['plan', file, '--plugin', plugin], plan.io)).toBe(0);
    expect(plan.stdout()).toContain(
      "FULL ACCESS: this step's agent can change anything and run anything and nobody approves it",
    );
  });
});

describe('run --tui (AC-05)', () => {
  async function dashboard(answer: string, permissions: string, extra: string[] = []) {
    const { dir, plugin, file } = await setup(permissions);
    const captured = captureIo(dir);
    const stdin = new PassThrough();
    stdin.end(answer);
    const startedWith: string[][] = [];
    const io = {
      ...captured.io,
      terminal: { stdin, stdout: new PassThrough() },
      startRun: ((args: readonly string[]) => {
        startedWith.push([...args]);
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
    const code = await main(['run', file, '--plugin', plugin, '--tui', ...extra], io);
    return { code, startedWith, err: captured.stderr() };
  }

  it('asks in the parent on a yes and tells the child who acknowledged', async () => {
    const r = await dashboard('y\n', FULL);
    expect(r.startedWith.flat()).toContain('--allow-full-access=terminal');
  });

  it('does not start the child on anything but a yes', async () => {
    const r = await dashboard('n\n', FULL);
    expect(r.code).toBe(2);
    expect(r.startedWith).toEqual([]);
  });

  it('adds nothing for a workflow with no step at full', async () => {
    const r = await dashboard('', EDIT);
    expect(r.startedWith.flat().some((arg) => arg.startsWith('--allow-full-access'))).toBe(false);
  });
});
