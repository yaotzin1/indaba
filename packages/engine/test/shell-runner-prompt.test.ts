import {
  Isolation,
  RunnerUnavailableError,
  RunResult,
  SimpleEventDispatcher,
  type StepDefinition,
  Tracer,
  type WorkflowDefinition,
  WorkflowValidationError,
} from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { GuardRegistry, parseWorkflow, StepExecutor, WorkflowParser } from '../src/index.js';
import { FakeRegistry, FakeRunner, FixedClock, makeTempDir, SequenceIds } from './support.js';

/**
 * The shell runner hands what it is given to the system shell, so it may only ever get the commands an author wrote.
 * An agent's prompt carries text a model wrote (notes, failure feedback, debate messages): no way may lead it there.
 */

const REFUSED = "would send an agent's prompt to the shell runner";

const file = (roles: string, steps: string): string => `version: "1.0"
name: t
roles:
${roles}
steps:
${steps}
`;

const ROLES = `  writer: { runner: claude-code }
  sh: { runner: shell }
  backup: { runner: [claude-code, shell] }`;

/** Every way a step that is not a shell step can reach the shell runner. */
const WAYS: readonly (readonly [string, string])[] = [
  ['a role that runs shell', '  - { id: s, role: sh, goal: g }'],
  ['a fallback of the role', '  - { id: s, role: backup, goal: g }'],
  ['a fallback written on the step', '  - { id: s, runner: [claude-code, shell], goal: g }'],
  ['a debate consulting a shell role', '  - { id: s, role: writer, consensus_with: [sh], goal: g }'],
  ['a debate led by a shell role', '  - { id: s, role: sh, consensus_with: [writer], goal: g }'],
  [
    'a debate consulting a role that falls back to shell',
    '  - { id: s, role: writer, consensus_with: [backup], goal: g }',
  ],
  // the resolution of a conflict debates the step's role, whatever runner the step itself writes
  [
    'a shell role behind a runner written on the step',
    '  - { id: s, role: sh, runner: claude-code, goal: g }',
  ],
];

describe('validation: an agent prompt never goes to the shell runner', () => {
  it.each(WAYS)('refuses %s', (_name, steps) => {
    const parse = (): WorkflowDefinition => parseWorkflow(file(ROLES, steps));
    expect(parse).toThrow(WorkflowValidationError);
    expect(parse).toThrow(REFUSED);
  });

  it('names the step and the role', () => {
    expect(() => parseWorkflow(file(ROLES, '  - { id: build, role: sh, goal: g }'))).toThrow(
      `step "build" ${REFUSED} (role "sh")`,
    );
  });

  it('says it once for a step, however many roles lead there', () => {
    const problems = ((): readonly string[] => {
      try {
        parseWorkflow(file(ROLES, '  - { id: s, role: sh, consensus_with: [backup], goal: g }'));
      } catch (error) {
        return error instanceof WorkflowValidationError ? error.problems : [];
      }
      return [];
    })();
    expect(problems.filter((p) => p.includes(REFUSED))).toHaveLength(1);
  });

  it('reports it in diagnose, which the editor and the web view read', () => {
    const problems = new WorkflowParser().diagnose(file(ROLES, '  - { id: s, role: sh, goal: g }'));
    expect(problems.some((p) => p.severity === 'error' && p.message.includes(REFUSED))).toBe(true);
  });

  it('accepts a shell step, and a role on the shell runner that no step uses', () => {
    const parsed = parseWorkflow(
      file(
        ROLES,
        '  - { id: s, runner: shell, commands: ["pnpm test"] }\n  - { id: w, role: writer, goal: g }',
      ),
    );
    expect(parsed.steps.map((s) => s.id)).toEqual(['s', 'w']);
  });
});

/** A workflow built by a program, which no parser has checked. */
function handBuilt(step: Partial<StepDefinition>): readonly [StepDefinition, WorkflowDefinition] {
  const definition: StepDefinition = {
    id: 's',
    goal: 'g',
    dependsOn: [],
    inputArtifacts: [],
    outputs: [],
    commands: [],
    guards: [],
    isolation: Isolation.None,
    consensusWith: [],
    mcp: [],
    ...step,
  };
  return [
    definition,
    {
      version: '1.0',
      name: 't',
      artifacts: {},
      roles: {
        writer: { name: 'writer', runner: 'claude-code', mcp: [] },
        sh: { name: 'sh', runner: 'shell', mcp: [] },
        backup: { name: 'backup', runner: 'claude-code', fallbackRunners: ['shell'], mcp: [] },
      },
      steps: [definition],
      mcpServers: {},
      defaultMcpPolicy: 'required',
    },
  ];
}

async function setUp() {
  const shell = new FakeRunner('shell', () => new RunResult({ exitCode: 0, output: 'AGREEMENT: ok' }));
  // unavailable, so a chain would walk on to its next runner
  const claude = new FakeRunner('claude-code', () => {
    throw new RunnerUnavailableError('not installed');
  });
  const tracer = new Tracer(new FixedClock(), new SimpleEventDispatcher(), new SequenceIds());
  const executor = new StepExecutor({
    runners: new FakeRegistry([shell, claude]),
    guards: new GuardRegistry(),
    tracer,
  });
  const span = await tracer.startTrace('root');
  return { shell, claude, executor, span, workdir: await makeTempDir() };
}

const BUILT: readonly (readonly [string, Partial<StepDefinition>])[] = [
  ['a role that runs shell', { role: 'sh' }],
  ['a fallback of the role', { role: 'backup' }],
  ['a fallback written on the step', { runner: 'claude-code', fallbackRunners: ['shell'] }],
  ['a debate consulting a shell role', { role: 'writer', consensusWith: ['sh'] }],
  ['a debate consulting a role that falls back to shell', { role: 'writer', consensusWith: ['backup'] }],
];

describe('the executor: an agent prompt never goes to the shell runner, whoever built the workflow', () => {
  it.each(BUILT)('fails the step for %s and calls no runner', async (_name, overrides) => {
    const { shell, claude, executor, span, workdir } = await setUp();
    const [step, workflow] = handBuilt(overrides);

    const outcome = await executor.run(step, workflow, workdir, span);

    expect(outcome.ok).toBe(false);
    expect(outcome.feedback).toContain('cannot take an agent');
    expect(shell.requests).toHaveLength(0);
    expect(claude.requests).toHaveLength(0);
  });

  it.each(BUILT.filter(([, o]) => o.consensusWith === undefined))(
    'refuses the intent call of %s',
    async (_name, overrides) => {
      const { shell, claude, executor, span, workdir } = await setUp();
      const [step, workflow] = handBuilt(overrides);

      const said = await executor.intent(step, workflow, workdir, span);

      expect(said.ok).toBe(false);
      expect(shell.requests).toHaveLength(0);
      expect(claude.requests).toHaveLength(0);
    },
  );

  it('still gives a shell step its commands', async () => {
    const { shell, executor, span, workdir } = await setUp();
    const [step, workflow] = handBuilt({ runner: 'shell', commands: ['pnpm test'] });

    const outcome = await executor.run(step, workflow, workdir, span);

    expect(outcome.ok).toBe(true);
    expect(shell.requests.map((r) => r.prompt)).toEqual(['pnpm test']);
  });
});
