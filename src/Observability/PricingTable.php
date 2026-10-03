<?php

declare(strict_types=1);

namespace Indaba\Observability;

/**
 * USD price per million tokens, by model. The built-in rates are indicative;
 * supply your own table for billing-grade numbers.
 */
final readonly class PricingTable
{
    /**
     * @param array<string, array{input: float, output: float}> $rates
     */
    public function __construct(private array $rates = []) {}

    public static function defaults(): self
    {
        return new self([
            'anthropic/claude-3.7-sonnet' => ['input' => 3.0, 'output' => 15.0],
            'anthropic/claude-sonnet-4' => ['input' => 3.0, 'output' => 15.0],
            'anthropic/claude-opus-4' => ['input' => 15.0, 'output' => 75.0],
            'deepseek/deepseek-r1' => ['input' => 0.55, 'output' => 2.19],
        ]);
    }

    public function costUsd(string $model, TokenUsage $usage): ?float
    {
        $rate = $this->rates[$this->normalise($model)] ?? null;
        if ($rate === null) {
            return null;
        }

        return ($usage->inputTokens * $rate['input'] + $usage->outputTokens * $rate['output']) / 1_000_000;
    }

    /** Variant suffixes such as ":thinking" or ":free" share the base model's rate. */
    private function normalise(string $model): string
    {
        $pos = strpos($model, ':');

        return $pos === false ? $model : substr($model, 0, $pos);
    }
}
