<?php

declare(strict_types=1);

namespace Indaba\Workflow\Engine;

use Indaba\Workflow\Model\StepDefinition;

/**
 * Builds the prompt for an agent step. On a retry only the latest failure is injected, trimmed
 * to its tail: a full error history would pollute the context with already-fixed problems.
 */
final readonly class PromptBuilder
{
    public const int FEEDBACK_LIMIT = 4000;

    public function build(StepDefinition $step, ?string $feedback = null): string
    {
        $parts = [sprintf('# Role: %s', $step->role ?? 'agent'), "## Goal\n" . $step->goal];

        if ($step->inputArtifacts !== []) {
            $parts[] = "## Input artifacts (read these first)\n" . $this->bullets($step->inputArtifacts);
        }
        if ($step->outputs !== []) {
            $parts[] = "## Required outputs (create these files)\n" . $this->bullets($step->outputs);
        }
        if ($feedback !== null && trim($feedback) !== '') {
            $parts[] = "## The previous attempt failed verification\n"
                . "Fix exactly this failure:\n\n```\n" . $this->tail($feedback) . "\n```";
        }

        return implode("\n\n", $parts);
    }

    public function tail(string $text): string
    {
        $text = trim($text);

        return strlen($text) <= self::FEEDBACK_LIMIT
            ? $text
            : "[...truncated...]\n" . substr($text, -self::FEEDBACK_LIMIT);
    }

    /**
     * @param list<string> $items
     */
    private function bullets(array $items): string
    {
        return implode("\n", array_map(static fn(string $i): string => '- ' . $i, $items));
    }
}
