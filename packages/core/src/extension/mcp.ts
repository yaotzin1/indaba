import type { Runner } from '../runner/index.js';

export const McpCapability = {
  /** Indaba passes the server configuration to the agent for each run. */
  Injected: 'injected',
  /** The agent keeps its own MCP configuration; Indaba can neither inject nor verify it. */
  AgentManaged: 'agent_managed',
  /** The engine has no MCP at all. */
  None: 'none',
} as const;
export type McpCapability = (typeof McpCapability)[keyof typeof McpCapability];

/** Implemented by runners that can say what MCP support they offer. */
export interface McpCapable {
  mcpCapability(): McpCapability;
}

export function isMcpCapable(runner: Runner): runner is Runner & McpCapable {
  return 'mcpCapability' in runner && typeof runner.mcpCapability === 'function';
}

/** A runner that does not implement McpCapable, or reports an unknown value, has no MCP. */
export function mcpCapabilityOf(runner: Runner): McpCapability {
  if (!isMcpCapable(runner)) {
    return McpCapability.None;
  }
  const declared: unknown = runner.mcpCapability();
  return declared === McpCapability.Injected || declared === McpCapability.AgentManaged
    ? declared
    : McpCapability.None;
}
