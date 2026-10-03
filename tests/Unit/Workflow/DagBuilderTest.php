<?php

declare(strict_types=1);

namespace Indaba\Tests\Unit\Workflow;

use Indaba\Core\Exception\IndabaException;
use Indaba\Workflow\Graph\DagBuilder;
use Indaba\Workflow\Model\StepDefinition;
use Indaba\Workflow\Model\WorkflowDefinition;
use PHPUnit\Framework\TestCase;

final class DagBuilderTest extends TestCase
{
    /**
     * @param array<string, list<string>> $deps
     */
    private function workflow(array $deps): WorkflowDefinition
    {
        $steps = [];
        foreach ($deps as $id => $on) {
            $steps[] = new StepDefinition(id: (string) $id, runner: 'shell', dependsOn: $on);
        }

        return new WorkflowDefinition('1.0', 't', [], [], $steps);
    }

    /**
     * @param list<StepDefinition> $steps
     * @return list<string>
     */
    private function ids(array $steps): array
    {
        return array_map(static fn(StepDefinition $s): string => $s->id, $steps);
    }

    public function testSortsByDependenciesKeepingDeclarationOrder(): void
    {
        $wf = $this->workflow(['c' => ['a', 'b'], 'a' => [], 'b' => ['a'], 'd' => []]);

        self::assertSame(['a', 'b', 'c', 'd'], $this->ids((new DagBuilder())->sort($wf)));
    }

    public function testDetectsCycles(): void
    {
        $this->expectException(IndabaException::class);
        $this->expectExceptionMessage('cycle');
        (new DagBuilder())->sort($this->workflow(['a' => ['b'], 'b' => ['a']]));
    }

    public function testAncestorsAndDescendants(): void
    {
        $wf = $this->workflow(['a' => [], 'b' => ['a'], 'c' => ['b'], 'x' => []]);
        $dag = new DagBuilder();

        $ancestors = $dag->ancestorsOf($wf, 'c');
        sort($ancestors);
        self::assertSame(['a', 'b'], $ancestors);
        self::assertSame(['b', 'c'], $dag->descendantsOf($wf, 'a'));
        self::assertSame([], $dag->descendantsOf($wf, 'x'));
    }
}
