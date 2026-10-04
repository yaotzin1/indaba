import { describe, expect, it } from 'vitest';
import {
  DagBuilder,
  defineStep,
  IndabaError,
  InvalidTransitionError,
  isConsensusStep,
  isShellStep,
  McpPolicy,
  McpUnavailableError,
  roleOf,
  StepState,
  StepStatus,
  stepOf,
  type WorkflowDefinition,
  WorkflowValidationError,
} from '../src/index.js';

function workflow(deps: Record<string, string[]>): WorkflowDefinition {
  return {
    version: '1.0',
    name: 't',
    artifacts: {},
    roles: {},
    steps: Object.entries(deps).map(([id, dependsOn]) => defineStep({ id, runner: 'shell', dependsOn })),
    mcpServers: {},
    defaultMcpPolicy: McpPolicy.Required,
  };
}

describe('DagBuilder', () => {
  it('sorts by dependencies keeping declaration order', () => {
    const wf = workflow({ c: ['a', 'b'], a: [], b: ['a'], d: [] });
    expect(new DagBuilder().build(wf).map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('detects cycles', () => {
    const build = (): unknown => new DagBuilder().build(workflow({ a: ['b'], b: ['a'] }));
    expect(build).toThrow(WorkflowValidationError);
    expect(build).toThrow('cycle');
  });

  it('finds ancestors and descendants', () => {
    const wf = workflow({ a: [], b: ['a'], c: ['b'], x: [] });
    const dag = new DagBuilder();
    expect([...dag.ancestorsOf(wf, 'c')].sort()).toEqual(['a', 'b']);
    expect(dag.descendantsOf(wf, 'a')).toEqual(['b', 'c']);
    expect(dag.descendantsOf(wf, 'x')).toEqual([]);
  });
});

describe('StepState', () => {
  it('counts attempts on the happy path', () => {
    const s = new StepState('x');
    s.transitionTo(StepStatus.Running);
    s.transitionTo(StepStatus.Validating);
    s.transitionTo(StepStatus.Completed);
    expect(s.status()).toBe(StepStatus.Completed);
    expect(s.attempts()).toBe(1);
  });

  it('re-arms a failed step on retry', () => {
    const s = new StepState('x');
    s.transitionTo(StepStatus.Running);
    s.transitionTo(StepStatus.Failed, 'boom');
    expect(s.reason()).toBe('boom');
    s.transitionTo(StepStatus.Pending);
    s.transitionTo(StepStatus.Running);
    expect(s.attempts()).toBe(2);
  });

  it('rejects illegal moves', () => {
    const s = new StepState('x');
    expect(() => s.transitionTo(StepStatus.Completed)).toThrow(InvalidTransitionError);
    expect(() => s.transitionTo(StepStatus.Completed)).toThrow(
      'Step "x" cannot move from PENDING to COMPLETED.',
    );
  });

  it('treats escalated as final', () => {
    const s = new StepState('x');
    s.transitionTo(StepStatus.Running);
    s.transitionTo(StepStatus.Escalated);
    expect(() => s.transitionTo(StepStatus.Pending)).toThrow(InvalidTransitionError);
  });
});

describe('model helpers and errors', () => {
  it('classifies steps', () => {
    expect(isShellStep(defineStep({ id: 'a', runner: 'shell' }))).toBe(true);
    expect(isConsensusStep(defineStep({ id: 'a' }))).toBe(false);
    expect(isConsensusStep(defineStep({ id: 'a', consensusWith: ['b'] }))).toBe(true);
    expect(isConsensusStep(defineStep({ id: 'a', decisionType: 'majority' }))).toBe(true);
  });

  it('looks up steps and roles or fails with the documented messages', () => {
    const wf = workflow({ a: [] });
    expect(stepOf(wf, 'a').id).toBe('a');
    expect(() => stepOf(wf, 'zz')).toThrow('Unknown step "zz".');
    expect(() => roleOf(wf, 'constructor')).toThrow('Unknown role "constructor".');
  });

  it('formats validation and MCP errors with their problems', () => {
    const v = new WorkflowValidationError(['a', 'b']);
    expect(v.message).toBe('Invalid workflow:\n - a\n - b');
    expect(v.problems).toEqual(['a', 'b']);
    expect(v).toBeInstanceOf(IndabaError);
    expect(v.name).toBe('WorkflowValidationError');
    const m = new McpUnavailableError(['x']);
    expect(m.message).toBe('Required MCP servers cannot be provided:\n - x');
    expect(new IndabaError('e', { cause: v }).cause).toBe(v);
  });
});
