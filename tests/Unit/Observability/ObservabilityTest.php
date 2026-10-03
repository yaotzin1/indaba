<?php

declare(strict_types=1);

namespace Indaba\Tests\Unit\Observability;

use Indaba\Observability\JsonlSpanExporter;
use Indaba\Observability\PricingTable;
use Indaba\Observability\SpanEnded;
use Indaba\Observability\SpanStarted;
use Indaba\Observability\SpanStatus;
use Indaba\Observability\TokenUsage;
use Indaba\Observability\Tracer;
use Indaba\Tests\Support\TempDir;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Clock\MockClock;
use Symfony\Component\EventDispatcher\EventDispatcher;

final class ObservabilityTest extends TestCase
{
    use TempDir;

    public function testCostIsComputedPerMillionTokensAndIgnoresVariantSuffix(): void
    {
        $pricing = new PricingTable(['m/x' => ['input' => 3.0, 'output' => 15.0]]);

        self::assertEqualsWithDelta(0.0105, (string) $pricing->costUsd('m/x:thinking', new TokenUsage(1000, 500)), 1e-9);
        self::assertNull($pricing->costUsd('unknown/model', new TokenUsage(1, 1)));
    }

    public function testSpansFormATreeCarryGenAiAttributesAndEmitEvents(): void
    {
        $clock = new MockClock('2026-01-01 00:00:00');
        $events = new EventDispatcher();
        $started = [];
        $ended = [];
        $events->addListener(SpanStarted::class, static function (SpanStarted $e) use (&$started): void {
            $started[] = $e->span->name;
        });
        $events->addListener(SpanEnded::class, static function (SpanEnded $e) use (&$ended): void {
            $ended[] = $e->span->name;
        });

        $tracer = new Tracer($clock, $events, new PricingTable(['m/x' => ['input' => 1.0, 'output' => 2.0]]));
        $root = $tracer->startTrace('task');
        $step = $tracer->startSpan('step', $root);
        $call = $tracer->startSpan('chat', $step, [Tracer::ATTR_OPERATION => 'chat']);
        $tracer->recordUsage($call, 'openrouter', 'm/x', new TokenUsage(1_000_000, 500_000));
        $clock->sleep(1.5);
        $tracer->endSpan($call);
        $tracer->endSpan($step, SpanStatus::Error, 'bad');
        $tracer->endSpan($root);

        self::assertSame($root->traceId, $call->traceId);
        self::assertSame($step->spanId, $call->parentSpanId);
        self::assertNull($root->parentSpanId);
        self::assertSame(1500.0, $call->durationMs());
        self::assertSame(1_000_000, $call->attributes['gen_ai.usage.input_tokens']);
        self::assertSame(500_000, $call->attributes['gen_ai.usage.output_tokens']);
        self::assertSame('m/x', $call->attributes['gen_ai.request.model']);
        self::assertSame(2.0, $call->attributes['indaba.cost.usd']);
        self::assertSame(SpanStatus::Error, $step->status);
        self::assertSame(['task', 'step', 'chat'], $started);
        self::assertSame(['chat', 'step', 'task'], $ended);
    }

    public function testJsonlExporterAppendsOneLinePerSpan(): void
    {
        $dir = $this->makeTempDir() . '/traces';
        $events = new EventDispatcher();
        $events->addListener(SpanEnded::class, (new JsonlSpanExporter($dir))->onSpanEnded(...));
        $tracer = new Tracer(new MockClock(), $events);

        $root = $tracer->startTrace('task', ['k' => 'v']);
        $tracer->endSpan($tracer->startSpan('child', $root));
        $tracer->endSpan($root);

        $lines = file($dir . '/' . $root->traceId . '.jsonl', \FILE_IGNORE_NEW_LINES);
        self::assertIsArray($lines);
        self::assertCount(2, $lines);
        $first = json_decode($lines[0], true);
        self::assertIsArray($first);
        self::assertSame('child', $first['name']);
        self::assertSame($root->spanId, $first['parent_span_id']);
    }
}
