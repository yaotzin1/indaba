import {
  McpCapability,
  McpUnavailableError,
  type Runner,
  type RunRequest,
  RunResult,
  SpanEnded,
} from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { type McpIssue, McpPlanner, parseWorkflow, WorkflowStatus } from '../src/index.js';
import { FakeRegistry, FakeRunner, harness, makeGitRepo } from './support.js';

const ok = (): RunResult => new RunResult({ exitCode: 0, output: 'ok' });

/** A runner that declares MCP support the way the runners package does. */
function capable(name: string, capability: string): Runner & { mcpCapability(): string } {
  return {
    name,
    mcpCapability: () => capability,
    run: async () => ok(),
  };
}

describe('McpPlanner', () => {
  it('reads a runner capability, defaulting to none', () => {
    expect(McpPlanner.capabilityOf(capable('a', 'injected'))).toBe(McpCapability.Injected);
    expect(McpPlanner.capabilityOf(capable('a', 'agent_managed'))).toBe(McpCapability.AgentManaged);
    expect(McpPlanner.capabilityOf(capable('a', 'nonsense'))).toBe(McpCapability.None);
    expect(McpPlanner.capabilityOf(new FakeRunner('plain', ok))).toBe(McpCapability.None);
  });

  it('preflight follows policy and capability', () => {
    const registry = new FakeRegistry([
      capable('claude-code', 'injected'),
      capable('antigravity', 'agent_managed'),
      new FakeRunner('shell', ok),
    ]);
    const yaml = `version: "1.0"
name: t
mcp_servers:
  docs: {command: npx}
roles:
  injected: {runner: claude-code}
  managed: {runner: antigravity}
  bare: {runner: shell}
steps:
  - {id: a, role: injected, mcp: [docs]}
  - {id: b, role: managed, mcp: [docs]}
  - {id: c, role: bare, mcp: [docs]}
  - {id: d, role: bare, mcp: [docs], mcp_policy: optional}
`;
    const issues = new McpPlanner(registry).preflight(parseWorkflow(yaml));
    const byStep = new Map<string, McpIssue>(issues.map((i) => [i.stepId, i]));

    expect(byStep.has('a')).toBe(false);
    expect(byStep.get('b')?.isError).toBe(false);
    expect(byStep.get('b')?.message).toContain('cannot verify');
    expect(byStep.get('c')?.isError).toBe(true);
    expect(byStep.get('d')?.isError).toBe(false);
    expect(byStep.get('c')?.describe()).not.toContain('npx');
  });
});

const PIPELINE = `version: "1.0"
name: p
mcp_servers:
  docs: {command: npx, args: [server], env: {TOKEN: hunter2}}
roles:
  injected: {runner: inj, mcp: [docs]}
  bare: {runner: bare}
steps:
  - {id: a, role: injected}
  - {id: b, role: bare, depends_on: [a], mcp: [docs], mcp_policy: optional}
`;

describe('WorkflowEngine and MCP', () => {
  it('passes injected servers and records only names', async () => {
    const repo = await makeGitRepo();
    const seen: RunRequest[] = [];
    const inj = {
      name: 'inj',
      mcpCapability: () => 'injected',
      run: async (request: RunRequest) => {
        seen.push(request);
        return ok();
      },
    };
    const bare = new FakeRunner('bare', ok);
    const { engine, events } = harness(repo, [inj, bare]);
    const spans: Record<string, Record<string, unknown>> = {};
    events.addListener(SpanEnded, (e) => {
      spans[e.span.name] = { ...e.span.attributes };
    });

    const result = await engine.run(parseWorkflow(PIPELINE), { taskId: 'M1' });

    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    expect(seen[0]?.mcpServers?.[0]?.name).toBe('docs');
    expect(bare.requests[0]?.mcpServers).toEqual([]);
    expect(spans['step a']?.['indaba.mcp.servers']).toBe('docs');
    expect(spans['step b']?.['indaba.mcp.skipped']).toBe('docs');
    const dump = JSON.stringify(spans);
    expect(dump).not.toContain('hunter2');
    expect(dump).not.toContain('npx');
  });

  it('refuses before anything runs when a required server cannot be provided', async () => {
    const repo = await makeGitRepo();
    const bare = new FakeRunner('bare', ok);
    const { engine } = harness(repo, [bare]);
    const yaml = PIPELINE.replace('mcp_policy: optional', 'mcp_policy: required').replace(
      'runner: inj',
      'runner: bare',
    );

    const error = await engine.run(parseWorkflow(yaml), { taskId: 'M2' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(McpUnavailableError);
    expect((error as McpUnavailableError).message).toContain('step "a" (runner bare), server "docs"');
    expect((error as McpUnavailableError).message).not.toContain('hunter2');
    expect(bare.requests).toHaveLength(0);
  });

  it('lets the workflow-wide default be optional', async () => {
    const repo = await makeGitRepo();
    const { engine } = harness(repo, [new FakeRunner('bare', ok)]);
    const yaml = `${PIPELINE.replace('runner: inj', 'runner: bare')}\ndefaults: {mcp_policy: optional}\n`;

    const result = await engine.run(parseWorkflow(yaml), { taskId: 'M3' });

    expect(result.status).toBe(WorkflowStatus.Completed);
  });
});

describe('McpPlanner with runner chains', () => {
  const registry = new FakeRegistry([
    capable('plain-api', 'none'),
    capable('acp', 'injected'),
    capable('managed', 'agent_managed'),
  ]);
  const plan = (runner: string, extra = ''): McpIssue[] =>
    new McpPlanner(registry).preflight(
      parseWorkflow(`version: "1.0"
name: t
mcp_servers:
  docs: {command: npx}
roles:
  worker: {runner: ${runner}}
steps:
  - {id: a, role: worker, mcp: [docs]${extra}}
`),
    );

  it('does not block a run whose primary cannot provide a server but a fallback can', () => {
    expect(plan('[plain-api, acp]')).toEqual([]);
  });

  it('judges a chain by the first runner that can provide the servers, and reports it', () => {
    const issues = plan('[plain-api, managed]');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.runner).toBe('managed');
    expect(issues[0]?.isError).toBe(false);
  });

  it('is an error only when no runner of the chain can provide a required server', () => {
    const issues = plan('[plain-api, nowhere]');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.isError).toBe(true);
    expect(issues[0]?.runner).toBe('plain-api');
  });

  it('skips runners the registry does not know and has nothing to say when none is known', () => {
    expect(plan('[nowhere, elsewhere]')).toEqual([]);
  });

  it('uses the step runner chain over the role when the step names its own', () => {
    expect(plan('plain-api', ', runner: [acp]')).toEqual([]);
  });

  it('lists the chains of a consensus by role, ignoring the step runner', () => {
    const wf = parseWorkflow(`version: "1.0"
name: t
roles:
  a: {runner: [x, y]}
  b: {runner: z}
steps:
  - {id: s, role: a, consensus_with: [b], decision_type: consensus, runner: ignored}
`);
    const step = wf.steps[0];
    expect(step === undefined ? [] : new McpPlanner(registry).chains(wf, step)).toEqual([
      ['a', ['x', 'y']],
      ['b', ['z']],
    ]);
  });

  it('gives a step with neither role nor chain no speakers beyond an empty chain', () => {
    const wf = parseWorkflow(`version: "1.0"
name: t
steps:
  - {id: s, runner: shell, commands: [echo]}
`);
    const step = wf.steps[0];
    expect(step === undefined ? [] : new McpPlanner(registry).chains(wf, step)).toEqual([
      [undefined, ['shell']],
    ]);
  });
});
