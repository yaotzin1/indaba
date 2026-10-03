<?php

declare(strict_types=1);

namespace Indaba\Workflow\Engine;

/**
 * One preflight finding about an MCP server a step wants. Carries names only: server
 * definitions can hold secrets and never appear in messages.
 */
final readonly class McpIssue
{
    public function __construct(
        public string $stepId,
        public string $runner,
        public string $server,
        public bool $isError,
        public string $message,
    ) {}

    public function describe(): string
    {
        return sprintf('step "%s" (runner %s), server "%s": %s', $this->stepId, $this->runner, $this->server, $this->message);
    }
}
