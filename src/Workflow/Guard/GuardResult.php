<?php

declare(strict_types=1);

namespace Indaba\Workflow\Guard;

final readonly class GuardResult
{
    private function __construct(
        public bool $passed,
        public ?string $message,
    ) {}

    public static function pass(): self
    {
        return new self(true, null);
    }

    public static function fail(string $message): self
    {
        return new self(false, $message);
    }
}
