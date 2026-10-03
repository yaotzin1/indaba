<?php

declare(strict_types=1);

namespace Indaba\Observability;

use Psr\Clock\ClockInterface;
use Psr\EventDispatcher\EventDispatcherInterface;

/**
 * Creates spans, stamps them with GenAI semantic-convention attributes and
 * announces their lifecycle through PSR-14.
 */
final readonly class Tracer
{
    public const string ATTR_OPERATION = 'gen_ai.operation.name';
    public const string ATTR_PROVIDER = 'gen_ai.provider.name';
    public const string ATTR_MODEL = 'gen_ai.request.model';
    public const string ATTR_INPUT_TOKENS = 'gen_ai.usage.input_tokens';
    public const string ATTR_OUTPUT_TOKENS = 'gen_ai.usage.output_tokens';
    public const string ATTR_COST_USD = 'indaba.cost.usd';

    public function __construct(
        private ClockInterface $clock,
        private EventDispatcherInterface $events,
        private PricingTable $pricing = new PricingTable(),
    ) {}

    /**
     * @param array<string, scalar> $attributes
     */
    public function startTrace(string $name, array $attributes = []): Span
    {
        return $this->start($name, bin2hex(random_bytes(16)), null, $attributes);
    }

    /**
     * @param array<string, scalar> $attributes
     */
    public function startSpan(string $name, Span $parent, array $attributes = []): Span
    {
        return $this->start($name, $parent->traceId, $parent->spanId, $attributes);
    }

    public function endSpan(Span $span, SpanStatus $status = SpanStatus::Ok, ?string $message = null): void
    {
        $span->end($this->clock->now(), $status, $message);
        $this->events->dispatch(new SpanEnded($span));
    }

    public function recordUsage(Span $span, string $provider, string $model, TokenUsage $usage): void
    {
        $span->setAttribute(self::ATTR_PROVIDER, $provider);
        $span->setAttribute(self::ATTR_MODEL, $model);
        $span->setAttribute(self::ATTR_INPUT_TOKENS, $usage->inputTokens);
        $span->setAttribute(self::ATTR_OUTPUT_TOKENS, $usage->outputTokens);

        $cost = $this->pricing->costUsd($model, $usage);
        if ($cost !== null) {
            $span->setAttribute(self::ATTR_COST_USD, $cost);
        }
    }

    /**
     * @param array<string, scalar> $attributes
     */
    private function start(string $name, string $traceId, ?string $parentId, array $attributes): Span
    {
        $span = new Span($traceId, bin2hex(random_bytes(8)), $parentId, $name, $this->clock->now(), $attributes);
        $this->events->dispatch(new SpanStarted($span));

        return $span;
    }
}
