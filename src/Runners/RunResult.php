<?php

declare(strict_types=1);

namespace Indaba\Runners;

use Indaba\Observability\TokenUsage;

final readonly class RunResult
{
    public function __construct(
        public int $exitCode,
        public string $output,
        public string $errorOutput = '',
        public ?TokenUsage $usage = null,
        public float $durationMs = 0.0,
        public ?string $model = null,
    ) {}

    public function succeeded(): bool
    {
        return $this->exitCode === 0;
    }

    /** Stderr when present, otherwise stdout: the part worth showing after a failure. */
    public function failureText(): string
    {
        $text = trim($this->errorOutput) !== '' ? $this->errorOutput : $this->output;

        return trim($text);
    }
}
