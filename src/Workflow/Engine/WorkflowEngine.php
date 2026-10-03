<?php

declare(strict_types=1);

namespace Indaba\Workflow\Engine;

use Indaba\Observability\SpanStatus;
use Indaba\Observability\Tracer;
use Indaba\Workflow\Graph\DagBuilder;
use Indaba\Workflow\Model\FailureAction;
use Indaba\Workflow\Model\Isolation;
use Indaba\Workflow\Model\StepDefinition;
use Indaba\Workflow\Model\WorkflowDefinition;
use Indaba\Workflow\State\StepState;
use Indaba\Workflow\State\StepStatus;
use Indaba\Workflow\State\StepStatusChanged;
use Indaba\Workspace\Workspace;
use Indaba\Workspace\WorkspaceManager;
use Psr\EventDispatcher\EventDispatcherInterface;

/**
 * Executes a workflow in dependency order, drives each step's state machine, applies
 * the retry policy and tears the isolated workspace down however the run ends.
 */
final readonly class WorkflowEngine
{
    /** Artifact key that receives the diff of an isolated workspace after each isolated step. */
    public const string PATCH_ARTIFACT = 'patch';

    public function __construct(
        private StepExecutor $executor,
        private Tracer $tracer,
        private EventDispatcherInterface $events,
        private WorkspaceManager $workspaces,
        private DagBuilder $dag = new DagBuilder(),
    ) {}

    /**
     * @param (\Closure(string): void)|null $onOutput live output of the running step
     */
    public function run(
        WorkflowDefinition $workflow,
        string $projectDir,
        string $taskId,
        ?\Closure $onOutput = null,
    ): WorkflowResult {
        $order = $this->dag->sort($workflow);

        $position = [];
        $states = [];
        foreach ($order as $i => $step) {
            $position[$step->id] = $i;
            $states[$step->id] = new StepState($step->id);
        }

        $root = $this->tracer->startTrace('indaba.task ' . $workflow->name, [
            'indaba.task.id' => $taskId,
            'indaba.workflow.name' => $workflow->name,
        ]);

        /** @var Workspace|null $workspace */
        $workspace = null;
        /** @var array<string, true> $isolated steps whose working directory is the worktree */
        $isolated = [];
        /** @var array<string, int> $retries */
        $retries = [];
        /** @var array<string, string> $feedback */
        $feedback = [];
        $status = WorkflowStatus::Completed;
        $reason = null;

        try {
            $i = 0;
            while ($i < count($order)) {
                $step = $order[$i];
                $state = $states[$step->id];

                $useWorktree = $step->isolation === Isolation::GitWorktree
                    || array_filter($step->dependsOn, static fn(string $d): bool => isset($isolated[$d])) !== [];
                $current = null;
                if ($useWorktree) {
                    $workspace ??= $this->workspaces->create($taskId);
                    $isolated[$step->id] = true;
                    $current = $workspace;
                }
                $workdir = $current === null ? $projectDir : $current->path();

                if ($workdir !== $projectDir) {
                    $this->stageArtifacts($step, $projectDir, $workdir);
                }

                $outcome = $this->execute($step, $workflow, $state, $taskId, $root, $workdir, $feedback[$step->id] ?? null, $onOutput);
                unset($feedback[$step->id]);

                if ($outcome->ok) {
                    if ($current !== null) {
                        $this->exportPatch($workflow, $current, $projectDir);
                    }
                    ++$i;
                    continue;
                }

                $policy = $step->onFailure;
                $target = $policy !== null
                    && !$outcome->escalate
                    && $policy->action === FailureAction::RetryStep
                    && ($retries[$step->id] ?? 0) < $policy->maxRetries ? $policy->target : null;

                if ($target !== null) {
                    $retries[$step->id] = ($retries[$step->id] ?? 0) + 1;
                    $feedback[$target] = $outcome->feedback;

                    $rerun = [$target, ...$this->dag->descendantsOf($workflow, $target)];
                    foreach ($rerun as $id) {
                        if (isset($states[$id]) && $states[$id]->status() !== StepStatus::Pending) {
                            $this->move($states[$id], $taskId, StepStatus::Pending, 'retry of ' . $step->id);
                        }
                    }
                    $i = $position[$target];
                    continue;
                }

                $escalate = $outcome->escalate
                    || $policy?->action === FailureAction::Escalate
                    || ($policy?->action === FailureAction::RetryStep);
                if ($escalate && $state->status() === StepStatus::Failed) {
                    $this->move($state, $taskId, StepStatus::Escalated, $outcome->feedback);
                }
                $status = $escalate ? WorkflowStatus::Escalated : WorkflowStatus::Failed;
                $reason = sprintf('Step "%s": %s', $step->id, $outcome->feedback);
                break;
            }
        } finally {
            $workspace?->destroy();
            $root->setAttribute('indaba.workflow.status', $status->value);
            $this->tracer->endSpan($root, $status === WorkflowStatus::Completed ? SpanStatus::Ok : SpanStatus::Error, $reason);
        }

        return new WorkflowResult(
            $taskId,
            $root->traceId,
            $status,
            array_map(static fn(StepState $s): StepStatus => $s->status(), $states),
            $reason,
        );
    }

    private function execute(
        StepDefinition $step,
        WorkflowDefinition $workflow,
        StepState $state,
        string $taskId,
        \Indaba\Observability\Span $root,
        string $workdir,
        ?string $feedback,
        ?\Closure $onOutput,
    ): StepOutcome {
        $span = $this->tracer->startSpan('step ' . $step->id, $root, [
            'indaba.step.id' => $step->id,
            'indaba.step.attempt' => $state->attempts() + 1,
        ]);

        $this->move($state, $taskId, StepStatus::Running);
        $outcome = $this->executor->run($step, $workflow, $workdir, $span, $feedback, $onOutput);

        if ($outcome->ok) {
            $this->move($state, $taskId, StepStatus::Validating);
            $outcome = $this->executor->validate($step, $workdir);
        }

        if ($outcome->ok) {
            $this->move($state, $taskId, StepStatus::Completed);
            $this->tracer->endSpan($span, SpanStatus::Ok);

            return $outcome;
        }

        $this->move($state, $taskId, StepStatus::Failed, $outcome->feedback);
        $this->tracer->endSpan($span, SpanStatus::Error, $outcome->feedback);

        return $outcome;
    }

    private function move(StepState $state, string $taskId, StepStatus $to, ?string $reason = null): void
    {
        $from = $state->status();
        $state->transitionTo($to, $reason);
        $this->events->dispatch(new StepStatusChanged($taskId, $state->stepId, $from, $to, $reason));
    }

    /** Copies input artifacts that live only in the project directory into the worktree. */
    private function stageArtifacts(StepDefinition $step, string $projectDir, string $workdir): void
    {
        foreach ($step->inputArtifacts as $artifact) {
            $source = $this->executor->resolve($projectDir, $artifact);
            $target = $this->executor->resolve($workdir, $artifact);
            if ($source === null || $target === null || !is_file($source) || is_file($target)) {
                continue;
            }
            if (!is_dir(dirname($target)) && !mkdir(dirname($target), 0o775, true) && !is_dir(dirname($target))) {
                continue;
            }
            copy($source, $target);
        }
    }

    private function exportPatch(WorkflowDefinition $workflow, Workspace $workspace, string $projectDir): void
    {
        $relative = $workflow->artifacts[self::PATCH_ARTIFACT] ?? null;
        $target = $relative === null ? null : $this->executor->resolve($projectDir, $relative);
        if ($target === null) {
            return;
        }
        if (!is_dir(dirname($target)) && !mkdir(dirname($target), 0o775, true) && !is_dir(dirname($target))) {
            return;
        }
        file_put_contents($target, $workspace->diff());
    }
}
