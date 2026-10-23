import { stepOf, WorkflowValidationError } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { parseWorkflow } from '../src/index.js';

function workflow(body: string): string {
  return `version: "1.0"\nname: levels\n${body}`;
}

function problemsOf(yaml: string): string {
  try {
    parseWorkflow(yaml);
  } catch (error) {
    if (error instanceof WorkflowValidationError) {
      return error.problems.join('\n');
    }
    throw error;
  }
  return '';
}

const roles = `roles:
  dev:
    runner: claude-code
`;

describe('permissions.level (specs/agent-permissions AC-01 to AC-03)', () => {
  it('reads a written level on a step', () => {
    const wf = parseWorkflow(
      workflow(`${roles}steps:
  - id: a
    role: dev
    goal: g
    permissions:
      level: edit
      fs:
        write: ["src/**"]
`),
    );
    expect(stepOf(wf, 'a').permissions).toEqual({
      level: 'edit',
      fsRead: [],
      fsWrite: ['src/**'],
      terminal: 'deny',
    });
  });

  it('takes the step block, else the role block, else the defaults, whole and never merged', () => {
    const wf = parseWorkflow(
      workflow(`defaults:
  permissions:
    level: read
roles:
  dev:
    runner: claude-code
  writer:
    runner: claude-code
    permissions:
      level: edit
      fs:
        write: ["docs/**"]
steps:
  - id: own
    role: writer
    goal: g
    permissions:
      level: full
  - id: fromRole
    role: writer
    goal: g
  - id: fromDefaults
    role: dev
    goal: g
`),
    );
    expect(stepOf(wf, 'own').permissions?.level).toBe('full');
    expect(stepOf(wf, 'fromRole').permissions).toEqual({
      level: 'edit',
      fsRead: [],
      fsWrite: ['docs/**'],
      terminal: 'deny',
    });
    expect(stepOf(wf, 'fromDefaults').permissions?.level).toBe('read');
    expect(wf.defaultPermissions?.level).toBe('read');
    expect(wf.roles.writer?.permissions?.level).toBe('edit');
  });

  it('never hands a role or defaults block to a shell step or a debate step', () => {
    const wf = parseWorkflow(
      workflow(`defaults:
  permissions:
    level: read
roles:
  a:
    runner: claude-code
  b:
    runner: antigravity
steps:
  - id: sh
    runner: shell
    commands: ["echo hi"]
  - id: debate
    role: a
    consensus_with: [b]
    decision_type: consensus
    goal: g
  - id: plain
    role: a
    goal: g
`),
    );
    expect(stepOf(wf, 'sh').permissions).toBeUndefined();
    expect(stepOf(wf, 'debate').permissions).toBeUndefined();
    expect(stepOf(wf, 'plain').permissions?.level).toBe('read');
  });

  it('keeps a block with no level exactly as before', () => {
    const wf = parseWorkflow(
      workflow(`${roles}steps:
  - id: a
    role: dev
    goal: g
    permissions:
      terminal: allow
      fs:
        write: ["src/**"]
`),
    );
    expect(stepOf(wf, 'a').permissions).toEqual({ fsRead: [], fsWrite: ['src/**'], terminal: 'allow' });
  });

  it('rejects the combinations of AC-03 on the block as written', () => {
    const step = (permissions: string) =>
      workflow(`${roles}steps:
  - id: a
    role: dev
    goal: g
    permissions:
${permissions}`);
    expect(problemsOf(step('      level: edit\n'))).toContain('needs the folders it may change');
    expect(problemsOf(step('      level: read\n      fs:\n        write: ["x"]\n'))).toContain(
      'may not write files',
    );
    expect(problemsOf(step('      level: read\n      terminal: allow\n'))).toContain('may not write files');
    expect(problemsOf(step('      level: full\n      terminal: deny\n'))).toContain('has no limits to give');
    expect(problemsOf(step('      level: full\n      fs:\n        read: ["x"]\n'))).toContain(
      'has no limits to give',
    );
    expect(problemsOf(step('      level: bogus\n'))).toContain('must be "read", "edit" or "full"');
  });

  it('says that ask is not available yet and rejects timeout_seconds', () => {
    const step = (permissions: string) =>
      workflow(`${roles}steps:
  - id: a
    role: dev
    goal: g
    permissions:
${permissions}`);
    expect(problemsOf(step('      level: ask\n'))).toContain('cannot ask a person');
    expect(problemsOf(step('      level: read\n      timeout_seconds: 5\n'))).toContain('timeout_seconds');
  });

  it('rejects a level on a shell step as written', () => {
    const text = workflow(`steps:
  - id: sh
    runner: shell
    commands: ["echo hi"]
    permissions:
      level: read
`);
    expect(problemsOf(text)).toContain('not allowed on a shell step');
  });

  it('checks a role block and a defaults block as written, too', () => {
    const roleBad = workflow(`roles:
  dev:
    runner: claude-code
    permissions:
      level: edit
steps:
  - id: a
    role: dev
    goal: g
`);
    expect(problemsOf(roleBad)).toContain('roles.dev.permissions.level');
    const defaultsBad = workflow(`defaults:
  permissions:
    level: full
    terminal: allow
${roles}steps:
  - id: a
    role: dev
    goal: g
`);
    expect(problemsOf(defaultsBad)).toContain('defaults.permissions.level');
  });
});
