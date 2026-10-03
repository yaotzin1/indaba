<?php

declare(strict_types=1);

namespace Indaba\Observability;

final readonly class SpanEnded
{
    public function __construct(public Span $span) {}
}
