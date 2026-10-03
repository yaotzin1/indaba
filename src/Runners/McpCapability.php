<?php

declare(strict_types=1);

namespace Indaba\Runners;

enum McpCapability: string
{
    /** Indaba passes the server configuration to the agent for each run. */
    case Injected = 'injected';
    /** The agent keeps its own MCP configuration; Indaba can neither inject nor verify it. */
    case AgentManaged = 'agent_managed';
    /** The engine has no MCP at all. */
    case None = 'none';
}
