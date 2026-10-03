<?php

declare(strict_types=1);

namespace Indaba\Runners;

/**
 * Implemented by runners that can say what MCP support they offer. A runner that does not
 * implement it is treated as McpCapability::None.
 */
interface McpCapable
{
    public function mcpCapability(): McpCapability;
}
