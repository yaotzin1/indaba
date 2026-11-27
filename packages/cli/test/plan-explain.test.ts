import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { main } from '../src/index.js';
import { explanationLines, originText, renderExplanationText } from '../src/plan-explain.js';
import { captureIo, makeTempDir, writeWorkflow } from './support.js';

// specs/plan-explain, T-10 to T-15.

const root = fileURLToPath(new URL('../../..', import.meta.url));
const examples = join(root, 'examples');

interface Golden {
  readonly code: number;
  readonly stdout: string;
}

/** What `indaba plan` printed for each example before this feature, up to the readiness lines (which depend on the machine). */
const golden: Readonly<Record<string, Golden>> = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/plan-before-explain.json', import.meta.url)), 'utf8'),
);

async function run(args: string[], cwd: string, env: Record<string, string | undefined> = {}) {
  const captured = captureIo(cwd, env);
  const code = await main(args, captured.io);
  return { code, out: captured.stdout(), err: captured.stderr() };
}

function beforeReadiness(out: string): string {
  const at = out.indexOf('\nreadiness:');
  return at < 0 ? out : out.slice(0, at + 1);
}

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

const SHORT = `version: "1.0"
name: short
roles:
  writer: { runner: claude-code }
steps:
  - id: write
    role: writer
    goal: do it
  - id: test
    runner: shell
    commands: ["pnpm test"]
    depends_on: [write]
`;

describe('plan without the new options is unchanged (AC-01)', () => {
  const names = Object.keys(golden).sort();

  it('has an example for each golden file', () => {
    expect(names.length).toBeGreaterThan(10);
  });

  it.each(names)('%s prints what it printed before, byte for byte, and exits as it did', async (name) => {
    const expected = golden[name];
    const r = await run(['plan', join(examples, `${name}.workflow.ai.yml`)], await makeTempDir());
    expect(beforeReadiness(r.out)).toBe(expected?.stdout);
    expect(r.code).toBe(expected?.code);
    expect(r.err).toBe('');
  });

  it.each(names)('%s with --explain keeps every line it had, in order, and adds lines only', async (name) => {
    const file = join(examples, `${name}.workflow.ai.yml`);
    const dir = await makeTempDir();
    const plain = beforeReadiness((await run(['plan', file], dir)).out).split('\n');
    const explained = await run(['plan', file, '--explain'], dir);
    const lines = explained.out.split('\n');
    let from = 0;
    for (const line of plain.filter((l) => l !== '')) {
      const found = lines.indexOf(line, from);
      expect(found, `missing: ${line}`).toBeGreaterThanOrEqual(from);
      from = found + 1;
    }
    expect(explained.code).toBe(golden[name]?.code);
    if (plain.some((line) => line.startsWith('1. '))) {
      expect(lines.length).toBeGreaterThan(plain.length);
    }
  });
});

describe('plan --explain (AC-09)', () => {
  it('prints a block under each step: a line per setting with its origin at the end, then the gaps', async () => {
    const dir = await makeTempDir();
    const file = await writeWorkflow(dir, 'short.yml', SHORT);
    const r = await run(['plan', file, '--explain'], dir);
    expect(r.code).toBe(0);
    const out = r.out.split('\n');
    const first = out.indexOf('1. write [writer]');
    const second = out.indexOf('2. test [shell: pnpm test] (after write)');
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
    const block = out.slice(first + 1, second);
    expect(block).toContain('   runner: claude-code  <- role writer, line 4');
    expect(block).toContain('   isolation: none  <- fallback, engine');
    expect(block).toContain('   timeout_seconds: 900s  <- fallback, engine');
    expect(block.some((l) => l.startsWith('   ! no_permission_level: '))).toBe(true);
    expect(block.some((l) => l.startsWith('   ! no_check_on_result: ') && l.endsWith('test.'))).toBe(true);
    expect(block.some((l) => l.startsWith('   i failure_stops_run: '))).toBe(true);
  });

  it('shows the line of a value the step wrote and says who chose the rest', async () => {
    const dir = await makeTempDir();
    const file = await writeWorkflow(
      dir,
      'w.yml',
      `version: "1.0"
name: lines
defaults:
  permissions: { level: read }
roles:
  r: { runner: claude-code }
steps:
  - id: a
    role: r
    goal: g
    isolation: git_worktree
    timeout_seconds: 60
    on_failure: { action: retry_step, target: a, max_retries: 2 }
`,
    );
    const r = await run(['plan', file, '--explain'], dir);
    expect(r.out).toContain('   permissions.level: read  <- workflow_defaults, line 4');
    expect(r.out).toContain('   isolation: git_worktree  <- file, line 11');
    expect(r.out).toContain('   timeout_seconds: 60s  <- file, line 12');
    expect(r.out).toContain(
      '   on_failure: retry_step a, run again up to 2 times; each retry is isolated and carries only the last failure  <- file, line 13',
    );
    expect(r.out).toContain('   guards: diff_within_scope nothing (implied)  <- workflow_defaults, line 4');
    expect(r.out).not.toContain('no_permission_level');
  });

  it('exits as plan does, and a gap never changes the exit code (AC-13)', async () => {
    const dir = await makeTempDir();
    const file = await writeWorkflow(dir, 'short.yml', SHORT);
    expect((await run(['plan', file], dir)).code).toBe(0);
    expect((await run(['plan', file, '--explain'], dir)).code).toBe(0);
  });

  it('keeps the problems of an invalid file where plan puts them, with the same exit code', async () => {
    const dir = await makeTempDir();
    const file = await writeWorkflow(dir, 'bad.yml', 'version: "1.0"\nname: bad\nsteps: []\n');
    const plain = await run(['plan', file], dir);
    const explained = await run(['plan', file, '--explain'], dir);
    expect(plain.code).toBe(1);
    expect(explained).toEqual(plain);
  });
});

describe('plan --json (AC-10)', () => {
  it('prints the explanation as JSON and nothing else on stdout', async () => {
    const dir = await makeTempDir();
    const file = await writeWorkflow(dir, 'short.yml', SHORT);
    const r = await run(['plan', file, '--json'], dir);
    expect(r.code).toBe(0);
    expect(r.err).toBe('');
    const parsed = JSON.parse(r.out);
    expect(parsed.schema).toBe('indaba.plan-explain');
    expect(parsed.version).toBe(1);
    expect(parsed.workflow).toBe('short');
    expect(parsed.steps.map((s: { id: string }) => s.id)).toEqual(['write', 'test']);
    expect(Object.keys(parsed)).toEqual(['schema', 'version', 'workflow', 'steps']);
    expect(Object.keys(parsed.steps[0])).toEqual(['id', 'kind', 'settings', 'gaps']);
    expect(parsed.steps[0].settings[0]).toEqual({
      key: 'runner',
      value: ['claude-code'],
      origin: { kind: 'role', ref: 'writer', line: 4, column: 13 },
    });
    expect(parsed.steps[0].gaps.map((g: { code: string }) => g.code)).toEqual([
      'no_permission_level',
      'no_write_scope',
      'no_check_on_result',
      'failure_stops_run',
    ]);
  });

  it('implies --explain: the two options together print the same', async () => {
    const dir = await makeTempDir();
    const file = await writeWorkflow(dir, 'short.yml', SHORT);
    const both = await run(['plan', file, '--json', '--explain'], dir);
    expect(both).toEqual(await run(['plan', file, '--json'], dir));
  });

  it('is byte for byte the same twice, has no timestamp, no absolute path and no environment value', async () => {
    const dir = await makeTempDir();
    const file = await writeWorkflow(dir, 'short.yml', SHORT);
    const keyValue = ['sk', 'or', 'v1', 'abcdef0123456789'].join('-');
    const env = { OPENROUTER_API_KEY: keyValue, HOME: dir };
    const a = await run(['plan', file, '--json'], dir, env);
    const b = await run(['plan', file, '--json'], dir, env);
    expect(a.out).toBe(b.out);
    expect(a.out).not.toContain(dir);
    expect(a.out).not.toContain(keyValue);
    expect(a.out).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('prints nothing on stdout for an invalid file and puts the problems on stderr (AC-13)', async () => {
    const dir = await makeTempDir();
    const file = await writeWorkflow(dir, 'bad.yml', 'version: "1.0"\nname: bad\nsteps: []\n');
    const r = await run(['plan', file, '--json'], dir);
    expect(r.code).toBe(1);
    expect(r.out).toBe('');
    expect(r.err.length).toBeGreaterThan(0);
  });

  it('prints nothing on stdout and exits 2 for an input value that is not accepted', async () => {
    const dir = await makeTempDir();
    const file = await writeWorkflow(
      dir,
      'in.yml',
      `version: "1.0"
name: in
inputs:
  tone: { type: choice, description: the tone, choices: [calm, loud] }
roles:
  r: { runner: claude-code }
steps:
  - id: a
    role: r
    goal: "speak \${{ inputs.tone }}"
`,
    );
    const plain = await run(['plan', file, '--input', 'tone=bogus'], dir);
    const r = await run(['plan', file, '--json', '--input', 'tone=bogus'], dir);
    expect(plain.code).toBe(2);
    expect(r.code).toBe(2);
    expect(r.out).toBe('');
    expect(r.err).toBe(plain.err);
  });

  it('puts a failing finding on stderr, still prints the JSON and exits as plan does', async () => {
    const dir = await makeTempDir();
    const file = await writeWorkflow(
      dir,
      'bad-level.yml',
      `version: "1.0"
name: stall
roles:
  r: { runner: claude-code }
steps:
  - id: a
    role: r
    goal: g
    permissions: { level: edit, fs: { write: ["src/**"] } }
    stall: { after_seconds: 120 }
`,
    );
    const plain = await run(['plan', file], dir);
    const r = await run(['plan', file, '--json'], dir);
    expect(r.code).toBe(plain.code);
    expect(() => JSON.parse(r.out)).not.toThrow();
  });
});

describe('the options belong to plan', () => {
  it.each(['validate', 'run'])(
    '%s refuses --explain and --json as an option it does not know',
    async (command) => {
      const dir = await makeTempDir();
      const file = await writeWorkflow(dir, 'short.yml', SHORT);
      for (const flag of ['--explain', '--json']) {
        const r = await run([command, file, flag], dir);
        expect(r.code).toBe(2);
        expect(r.err).toContain(`Unknown option '${flag}' for "${command}".`);
        expect(r.out).toBe('');
      }
    },
  );

  it('lists them in the usage of plan', async () => {
    const r = await run(['plan', '--help'], await makeTempDir());
    expect(r.out).toContain('--explain');
    expect(r.out).toContain('--json');
    expect(r.out).toContain('indaba.plan-explain');
  });
});

describe('what the file can put on the screen (AC-09, section 6)', () => {
  // Step ids are checked by the parser; an author can still write role names and paths freely.
  it('prints a role name as one plain line, in the line of the step and in the block under it', async () => {
    const dir = await makeTempDir();
    // YAML escapes, written as text: the parser turns them into an escape character and a line break
    const hostileRole = ['w', 'u001b[31m', 'nfake: line'].join(String.fromCharCode(92));
    const file = await writeWorkflow(
      dir,
      'roles.yml',
      `version: "1.0"
name: roles
roles:
  "${hostileRole}": { runner: claude-code }
  other: { runner: codex }
steps:
  - id: a
    role: "${hostileRole}"
    goal: g
  - id: b
    role: other
    consensus_with: ["${hostileRole}"]
    goal: g
`,
    );
    for (const args of [
      ['plan', file],
      ['plan', file, '--explain'],
    ]) {
      const r = await run(args, dir);
      expect(r.code).toBe(0);
      expect(r.out).not.toContain(ESC);
      expect(r.out.split('\n').filter((l) => l.startsWith('fake: line'))).toEqual([]);
    }
  });

  const hostilePaths = [
    `a${ESC}[2J${ESC}]0;title${BEL}b/**`,
    'x\\n   ! fake_gap: nothing to see/**',
    `p${String.fromCharCode(13)}overwritten/**`,
  ];

  it('prints no escape sequence, no control character and no line the file made up', async () => {
    const dir = await makeTempDir();
    const secretLooking = ['sk', 'live', '0123456789abcdef'].join('-');
    const environmentValue = secretLooking.split('').reverse().join('');
    const file = await writeWorkflow(
      dir,
      'hostile.yml',
      `version: "1.0"
name: hostile
roles:
  r: { runner: claude-code }
steps:
  - id: a
    role: r
    goal: g
    permissions: { level: edit, fs: { write: ["${hostilePaths.join('", "')}", "${secretLooking}/**"] } }
    isolation: git_worktree
`,
    );
    const r = await run(['plan', file, '--explain'], dir, { SECRET_TOKEN: environmentValue });
    expect(r.code).toBe(0);
    const text = r.out + r.err;
    expect(text).not.toContain(ESC);
    expect(text).not.toContain(BEL);
    expect(text).not.toContain(String.fromCharCode(13));
    // a newline in a path does not start a line that looks like a gap of its own
    expect(r.out.split('\n').filter((l) => l.startsWith('   ! fake_gap'))).toEqual([]);
    expect(r.out).toContain('fake_gap: nothing to see/**');
    // paths are shown as written, and a value of the environment is not in the output at all
    expect(r.out).toContain(`${secretLooking}/**`);
    expect(r.out).not.toContain(environmentValue);
  });

  it('escapes the same text in JSON by the serializer, so it parses back to what the file said', async () => {
    const dir = await makeTempDir();
    const file = await writeWorkflow(
      dir,
      'hostile.yml',
      `version: "1.0"
name: hostile
roles:
  r: { runner: claude-code }
steps:
  - id: a
    role: r
    goal: g
    permissions: { level: edit, fs: { write: ["${hostilePaths[1]}"] } }
`,
    );
    const r = await run(['plan', file, '--json'], dir);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain(ESC);
    const written = JSON.parse(r.out).steps[0].settings.find(
      (s: { key: string }) => s.key === 'permissions.fs.write',
    );
    expect(written.value).toEqual(['x\n   ! fake_gap: nothing to see/**']);
  });
});

describe('the renderings', () => {
  it('writes each kind of origin', () => {
    expect(originText({ kind: 'file' })).toBe('<- file');
    expect(originText({ kind: 'file', line: 6, column: 3 })).toBe('<- file, line 6');
    expect(originText({ kind: 'role', ref: 'writer', line: 3 })).toBe('<- role writer, line 3');
    expect(originText({ kind: 'role' })).toBe('<- role ?');
    expect(originText({ kind: 'workflow_defaults', line: 20 })).toBe('<- workflow_defaults, line 20');
    expect(originText({ kind: 'fallback', by: 'runner:claude-code' })).toBe(
      '<- fallback, runner:claude-code',
    );
    expect(originText({ kind: 'fallback' })).toBe('<- fallback, engine');
    expect(originText({ kind: 'preset', by: 'basic' })).toBe('<- preset, basic');
    expect(originText({ kind: 'preset' })).toBe('<- preset');
  });

  it('writes every kind of value, an unknown with its reason, a guard with its source', () => {
    const lines = explanationLines({
      id: 'd',
      kind: 'debate',
      settings: [
        { key: 'runner', value: ['a', 'b'], origin: { kind: 'file' } },
        { key: 'permissions.fs.write', value: [], origin: { kind: 'file' } },
        { key: 'permissions.fs.write', value: ['src/**', 'docs/**'], origin: { kind: 'file' } },
        { key: 'stall', value: { afterSeconds: 90, retries: 2 }, origin: { kind: 'file' } },
        { key: 'on_failure', value: { action: 'fail', maxRetries: 0 }, origin: { kind: 'file' } },
        {
          key: 'guards',
          value: [{ type: 'git_diff_empty', paths: [], source: 'declared' }],
          origin: { kind: 'file' },
        },
        {
          key: 'rounds',
          value: { unknown: 'no bound declared' },
          origin: { kind: 'fallback', by: 'engine' },
        },
        { key: 'rounds', value: 4, origin: { kind: 'fallback', by: 'engine' } },
      ],
      gaps: [{ code: 'full_access', text: 'FULL', mitigatedBy: [] }],
    });
    expect(lines).toEqual([
      '   runner: a -> b  <- file',
      '   permissions.fs.write: nothing  <- file',
      '   permissions.fs.write: src/**, docs/**  <- file',
      '   stall: after 90s of silence, run again up to 2 times  <- file',
      '   on_failure: fail  <- file',
      '   guards: git_diff_empty (declared)  <- file',
      '   rounds: unknown (no bound declared)  <- fallback, engine',
      '   rounds: 4  <- fallback, engine',
      '   ! full_access: FULL',
    ]);
  });

  it('renders every step with its id and kind', () => {
    const text = renderExplanationText({
      steps: [{ id: 'a', kind: 'agent', settings: [], gaps: [] }],
    });
    expect(text).toBe('a [agent]\n');
  });
});
