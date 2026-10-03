<?php

declare(strict_types=1);

namespace Indaba\Console;

use Indaba\Observability\JsonlSpanExporter;
use Indaba\Observability\PricingTable;
use Indaba\Observability\SpanEnded;
use Indaba\Observability\Tracer;
use Indaba\Runners\RunnerRegistry;
use Indaba\Workflow\Engine\PromptBuilder;
use Indaba\Workflow\Engine\StepExecutor;
use Indaba\Workflow\Engine\WorkflowEngine;
use Indaba\Workflow\Guard\GuardRegistry;
use Indaba\Workspace\GitWorktreeManager;
use Symfony\Component\Clock\Clock;
use Symfony\Component\EventDispatcher\EventDispatcher;

/**
 * Composition root: wires the default engine for the CLI.
 */
final readonly class EngineFactory
{
    /**
     * @param array<string, string> $env
     */
    public function create(string $projectDir, EventDispatcher $events, array $env, float $stepTimeout = 900.0): WorkflowEngine
    {
        $events->addListener(SpanEnded::class, new JsonlSpanExporter($projectDir . '/.indaba/traces')->onSpanEnded(...));

        $tracer = new Tracer(Clock::get(), $events, PricingTable::defaults());
        $executor = new StepExecutor(
            RunnerRegistry::withDefaults($env),
            GuardRegistry::withDefaults(),
            $tracer,
            new PromptBuilder(),
            timeoutSeconds: $stepTimeout,
        );

        return new WorkflowEngine($executor, $tracer, $events, new GitWorktreeManager($projectDir));
    }
}
