<?php

declare(strict_types=1);

namespace Indaba\Observability;

final readonly class TokenUsage
{
    public function __construct(
        public int $inputTokens,
        public int $outputTokens,
    ) {}
}
