<?php

declare(strict_types=1);

namespace Indaba\Observability;

use Indaba\Core\Exception\IndabaException;

/**
 * Appends every ended span to `<dir>/<traceId>.jsonl`. Register `onSpanEnded`
 * as a SpanEnded listener.
 */
final readonly class JsonlSpanExporter
{
    public function __construct(private string $directory) {}

    public function onSpanEnded(SpanEnded $event): void
    {
        $span = $event->span;
        if (!is_dir($this->directory) && !mkdir($this->directory, 0o775, true) && !is_dir($this->directory)) {
            throw new IndabaException(sprintf('Cannot create trace directory "%s".', $this->directory));
        }

        $line = json_encode([
            'trace_id' => $span->traceId,
            'span_id' => $span->spanId,
            'parent_span_id' => $span->parentSpanId,
            'name' => $span->name,
            'start' => $span->startedAt->format(\DATE_ATOM),
            'end' => $span->endedAt?->format(\DATE_ATOM),
            'duration_ms' => $span->durationMs(),
            'status' => $span->status->value,
            'status_message' => $span->statusMessage,
            'attributes' => (object) $span->attributes,
        ], \JSON_THROW_ON_ERROR | \JSON_UNESCAPED_SLASHES);

        file_put_contents($this->directory . '/' . $span->traceId . '.jsonl', $line . "\n", \FILE_APPEND | \LOCK_EX);
    }
}
