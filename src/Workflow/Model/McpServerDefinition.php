<?php

declare(strict_types=1);

namespace Indaba\Workflow\Model;

/**
 * A Model Context Protocol server a step may use: either a local process (`command`) or a
 * remote endpoint (`url`). The values are operator-authored and may carry secrets, so nothing
 * here is ever logged or put into a span; only `name` is.
 */
final readonly class McpServerDefinition
{
    /**
     * @param list<string> $args
     * @param array<string, string> $env
     */
    public function __construct(
        public string $name,
        public ?string $command = null,
        public array $args = [],
        public array $env = [],
        public ?string $url = null,
    ) {}
}
