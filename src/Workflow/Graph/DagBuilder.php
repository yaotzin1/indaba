<?php

declare(strict_types=1);

namespace Indaba\Workflow\Graph;

use Indaba\Core\Exception\IndabaException;
use Indaba\Workflow\Model\StepDefinition;
use Indaba\Workflow\Model\WorkflowDefinition;

/**
 * Topological ordering and reachability over `depends_on`. Ordering is stable:
 * among ready steps the one declared first wins, so a plan is reproducible.
 */
final class DagBuilder
{
    /**
     * @return list<StepDefinition>
     */
    public function sort(WorkflowDefinition $workflow): array
    {
        $remaining = $workflow->steps;
        $emitted = [];
        $ordered = [];

        while ($remaining !== []) {
            $progressed = false;
            foreach ($remaining as $i => $step) {
                if (array_diff($step->dependsOn, array_keys($emitted)) === []) {
                    $ordered[] = $step;
                    $emitted[$step->id] = true;
                    unset($remaining[$i]);
                    $remaining = array_values($remaining);
                    $progressed = true;
                    break;
                }
            }

            if (!$progressed) {
                throw new IndabaException(sprintf(
                    'Dependency cycle or unknown dependency among steps: %s',
                    implode(', ', array_map(static fn(StepDefinition $s): string => $s->id, $remaining)),
                ));
            }
        }

        return $ordered;
    }

    /**
     * @return list<string> ids of every step the given step transitively depends on
     */
    public function ancestorsOf(WorkflowDefinition $workflow, string $stepId): array
    {
        $byId = $this->index($workflow);
        $seen = [];
        $stack = isset($byId[$stepId]) ? $byId[$stepId]->dependsOn : [];

        while ($stack !== []) {
            $id = array_pop($stack);
            if (isset($seen[$id]) || !isset($byId[$id])) {
                continue;
            }
            $seen[$id] = true;
            array_push($stack, ...$byId[$id]->dependsOn);
        }

        return array_keys($seen);
    }

    /**
     * @return list<string> ids of every step that transitively depends on the given step
     */
    public function descendantsOf(WorkflowDefinition $workflow, string $stepId): array
    {
        $out = [];
        foreach ($workflow->steps as $step) {
            if (in_array($stepId, $this->ancestorsOf($workflow, $step->id), true)) {
                $out[] = $step->id;
            }
        }

        return $out;
    }

    /**
     * @return array<string, StepDefinition>
     */
    private function index(WorkflowDefinition $workflow): array
    {
        $byId = [];
        foreach ($workflow->steps as $step) {
            $byId[$step->id] = $step;
        }

        return $byId;
    }
}
