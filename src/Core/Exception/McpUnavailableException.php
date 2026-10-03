<?php

declare(strict_types=1);

namespace Indaba\Core\Exception;

final class McpUnavailableException extends IndabaException
{
    /**
     * @param list<string> $problems one line per step/server that cannot be provided
     */
    public function __construct(public readonly array $problems)
    {
        parent::__construct("Required MCP servers cannot be provided:\n - " . implode("\n - ", $problems));
    }
}
