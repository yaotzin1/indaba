<?php

declare(strict_types=1);

namespace Indaba\Workflow\Engine;

final readonly class StepOutcome
{
    private function __construct(
        public bool $ok,
        public bool $escalate,
        public string $feedback,
    ) {}

    public static function ok(): self
    {
        return new self(true, false, '');
    }

    /** A failure the retry policy may act on. */
    public static function failed(string $feedback): self
    {
        return new self(false, false, $feedback);
    }

    /** A failure only a human can resolve; retrying is pointless. */
    public static function escalated(string $feedback): self
    {
        return new self(false, true, $feedback);
    }
}
