<?php

declare(strict_types=1);

namespace Indaba\Workflow\Parser;

use Indaba\Core\Exception\IndabaException;
use Indaba\Workflow\Graph\DagBuilder;
use Indaba\Workflow\Model\FailureAction;
use Indaba\Workflow\Model\WorkflowDefinition;

/**
 * Semantic checks that need the whole document.
 */
final readonly class WorkflowValidator
{
    public function __construct(private DagBuilder $dag = new DagBuilder()) {}

    /**
     * @return list<string>
     */
    public function validate(WorkflowDefinition $workflow): array
    {
        $errors = [];
        $ids = [];

        if ($workflow->steps === []) {
            $errors[] = 'steps must contain at least one step';
        }

        foreach ($workflow->steps as $step) {
            if (!preg_match('/^[A-Za-z0-9_-]+$/', $step->id)) {
                $errors[] = sprintf('step id "%s" must match [A-Za-z0-9_-]+', $step->id);
            }
            if (isset($ids[$step->id])) {
                $errors[] = sprintf('duplicate step id "%s"', $step->id);
            }
            $ids[$step->id] = true;
        }

        foreach ($workflow->steps as $step) {
            $at = sprintf('step "%s"', $step->id);

            foreach ($step->dependsOn as $dep) {
                if ($dep === $step->id) {
                    $errors[] = $at . ' depends on itself';
                } elseif (!isset($ids[$dep])) {
                    $errors[] = sprintf('%s depends on unknown step "%s"', $at, $dep);
                }
            }

            if ($step->role !== null && !isset($workflow->roles[$step->role])) {
                $errors[] = sprintf('%s uses unknown role "%s"', $at, $step->role);
            }
            if ($step->role === null && $step->runner === null) {
                $errors[] = $at . ' needs a role or a runner';
            }
            if ($step->isShell() && $step->commands === []) {
                $errors[] = $at . ' uses the shell runner but declares no commands';
            }
            if (!$step->isShell() && $step->commands !== []) {
                $errors[] = $at . ' declares commands but is not a shell step';
            }
            if ($step->isConsensus() && $step->role === null) {
                $errors[] = $at . ' needs a role to take part in a consensus';
            }
            foreach ($step->consensusWith as $role) {
                if (!isset($workflow->roles[$role])) {
                    $errors[] = sprintf('%s consensus_with unknown role "%s"', $at, $role);
                }
            }

            $onFailure = $step->onFailure;
            if ($onFailure?->action === FailureAction::RetryStep) {
                if ($onFailure->maxRetries < 1) {
                    $errors[] = $at . ' on_failure.max_retries must be at least 1';
                }
                $target = $onFailure->target;
                if ($target === null || !isset($ids[$target])) {
                    $errors[] = sprintf('%s on_failure.target "%s" is not a step', $at, $target ?? '');
                } elseif ($target !== $step->id && !in_array($target, $this->dag->ancestorsOf($workflow, $step->id), true)) {
                    $errors[] = sprintf('%s on_failure.target "%s" must be the step itself or one of its ancestors', $at, $target);
                }
            }
        }

        if ($errors === []) {
            try {
                $this->dag->sort($workflow);
            } catch (IndabaException $e) {
                $errors[] = $e->getMessage();
            }
        }

        return $errors;
    }
}
