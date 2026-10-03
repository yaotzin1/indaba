<?php

declare(strict_types=1);

namespace Indaba\Observability;

/**
 * A unit of work in a trace: Trace (task) -> Span (step) -> child span (LLM call, tool, verification).
 * The root span of a trace has no parent.
 */
final class Span
{
    public private(set) ?\DateTimeImmutable $endedAt = null;
    public private(set) SpanStatus $status = SpanStatus::Unset;
    public private(set) ?string $statusMessage = null;

    /** @var array<string, scalar> */
    public private(set) array $attributes;

    /**
     * @param array<string, scalar> $attributes
     */
    public function __construct(
        public readonly string $traceId,
        public readonly string $spanId,
        public readonly ?string $parentSpanId,
        public readonly string $name,
        public readonly \DateTimeImmutable $startedAt,
        array $attributes = [],
    ) {
        $this->attributes = $attributes;
    }

    public function setAttribute(string $key, bool|float|int|string $value): void
    {
        $this->attributes[$key] = $value;
    }

    public function end(\DateTimeImmutable $at, SpanStatus $status, ?string $message = null): void
    {
        $this->endedAt = $at;
        $this->status = $status;
        $this->statusMessage = $message;
    }

    public function isEnded(): bool
    {
        return $this->endedAt !== null;
    }

    public function durationMs(): ?float
    {
        if ($this->endedAt === null) {
            return null;
        }

        return ((float) $this->endedAt->format('U.u') - (float) $this->startedAt->format('U.u')) * 1000;
    }
}
