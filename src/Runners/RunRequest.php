<?php

declare(strict_types=1);

namespace Indaba\Runners;

use Indaba\Workflow\Model\McpServerDefinition;

final readonly class RunRequest
{
    /**
     * @param array<string, string> $env
     * @param (\Closure(string): void)|null $onOutput receives output as it streams
     * @param list<McpServerDefinition> $mcpServers servers the runner is asked to make available;
     *                                              only honoured by runners whose capability is Injected
     */
    public function __construct(
        public string $prompt,
        public string $workdir,
        public ?string $model = null,
        public float $timeoutSeconds = 900.0,
        public array $env = [],
        public ?\Closure $onOutput = null,
        public array $mcpServers = [],
    ) {}
}
