<?php

declare(strict_types=1);

namespace Indaba\Observability;

final readonly class SpanStarted
{
    public function __construct(public Span $span) {}
}
