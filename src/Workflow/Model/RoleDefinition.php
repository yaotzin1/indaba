<?php

declare(strict_types=1);

namespace Indaba\Workflow\Model;

final readonly class RoleDefinition
{
    /**
     * @param list<string> $mcp names of MCP servers every step of this role may use
     */
    public function __construct(
        public string $name,
        public string $runner,
        public ?string $model = null,
        public array $mcp = [],
    ) {}
}
