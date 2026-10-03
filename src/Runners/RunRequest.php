<?php

declare(strict_types=1);

namespace Indaba\Runners;

final readonly class RunRequest
{
    /**
     * @param array<string, string> $env
     * @param (\Closure(string): void)|null $onOutput receives output as it streams
     */
    public function __construct(
        public string $prompt,
        public string $workdir,
        public ?string $model = null,
        public float $timeoutSeconds = 900.0,
        public array $env = [],
        public ?\Closure $onOutput = null,
    ) {}
}
