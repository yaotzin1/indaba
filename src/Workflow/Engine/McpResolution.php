<?php

declare(strict_types=1);

namespace Indaba\Workflow\Engine;

use Indaba\Workflow\Model\McpServerDefinition;

/**
 * What one runner can do about the MCP servers one step wants.
 */
final readonly class McpResolution
{
    /**
     * @param list<McpServerDefinition> $injected passed to the runner
     * @param list<string> $assumed names the agent is trusted to have configured itself
     * @param list<string> $skipped names dropped under the optional policy
     * @param list<string> $missing names that cannot be provided under the required policy
     */
    public function __construct(
        public array $injected = [],
        public array $assumed = [],
        public array $skipped = [],
        public array $missing = [],
    ) {}
}
