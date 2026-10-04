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
