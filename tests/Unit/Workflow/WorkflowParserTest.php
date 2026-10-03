<?php

declare(strict_types=1);

namespace Indaba\Tests\Unit\Workflow;

use Indaba\Core\Exception\WorkflowValidationException;
use Indaba\Workflow\Model\DecisionType;
use Indaba\Workflow\Model\FailureAction;
use Indaba\Workflow\Model\Isolation;
use Indaba\Workflow\Parser\WorkflowParser;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class WorkflowParserTest extends TestCase
{
    public function testParsesTheReferenceWorkflow(): void
    {
        $wf = (new WorkflowParser())->parseFile(__DIR__ . '/../../../examples/task-pipeline.workflow.ai.yml');

        self::assertSame('indaba-task-pipeline', $wf->name);
        self::assertCount(4, $wf->steps);
        self::assertSame('anthropic/claude-3.7-sonnet:thinking', $wf->role('architect')->model);

        $rfc = $wf->step('rfc');
        self::assertSame('Prepare technical specification in .indaba/artifacts/spec.md', $rfc->goal);
        self::assertSame(['.indaba/artifacts/spec.md'], $rfc->outputs);
        self::assertSame(['src/', 'tests/'], $rfc->guards[0]->paths);

        self::assertSame(Isolation::GitWorktree, $wf->step('code')->isolation);
        self::assertSame(['.indaba/artifacts/spec.md'], $wf->step('code')->inputArtifacts);

        $verify = $wf->step('verify');
        self::assertTrue($verify->isShell());
        self::assertSame(FailureAction::RetryStep, $verify->onFailure?->action);
        self::assertSame(3, $verify->onFailure->maxRetries);

        $review = $wf->step('debate_review');
        self::assertTrue($review->isConsensus());
        self::assertSame(DecisionType::Consensus, $review->decisionType);
        self::assertSame(['architect'], $review->consensusWith);
    }

    /**
     * @param list<string> $expected fragments each expected to appear in the error list
     */
    #[DataProvider('invalidDocuments')]
    public function testReportsEveryProblem(string $yaml, array $expected): void
    {
        try {
            (new WorkflowParser())->parse($yaml);
            self::fail('Expected a validation exception.');
        } catch (WorkflowValidationException $e) {
            $all = implode("\n", $e->errors);
            foreach ($expected as $fragment) {
                self::assertStringContainsString($fragment, $all);
            }
        }
    }

    /**
     * @return iterable<string, array{string, list<string>}>
     */
    public static function invalidDocuments(): iterable
    {
        $head = "version: \"1.0\"\nname: t\nroles:\n  a: {runner: shell}\n";

        yield 'not yaml mapping' => ["- a\n- b\n", ['root must be a mapping']];
        yield 'bad version' => ["version: \"9\"\nname: t\nsteps: []\n", ['unsupported version']];
        yield 'unknown dependency' => [$head . "steps:\n  - {id: x, role: a, depends_on: [nope]}\n", ['unknown step "nope"']];
        yield 'cycle' => [$head . "steps:\n  - {id: x, role: a, depends_on: [y]}\n  - {id: y, role: a, depends_on: [x]}\n", ['cycle']];
        yield 'duplicate ids' => [$head . "steps:\n  - {id: x, role: a}\n  - {id: x, role: a}\n", ['duplicate step id']];
        yield 'unknown role' => [$head . "steps:\n  - {id: x, role: ghost}\n", ['unknown role "ghost"']];
        yield 'unknown artifact' => [$head . "steps:\n  - {id: x, role: a, goal: 'see \${{ artifacts.nope }}'}\n", ['unknown artifact "nope"']];
        yield 'shell without commands' => [$head . "steps:\n  - {id: x, runner: shell}\n", ['declares no commands']];
        yield 'unknown guard' => [$head . "steps:\n  - {id: x, role: a, guards: [{type: telepathy, paths: []}]}\n", ['not a known guard']];
        yield 'retry target not an ancestor' => [
            $head . "steps:\n  - {id: x, role: a}\n  - {id: y, role: a, on_failure: {action: retry_step, target: x, max_retries: 1}}\n",
            ['must be the step itself or one of its ancestors'],
        ];
        yield 'retry without budget' => [
            $head . "steps:\n  - {id: x, role: a, on_failure: {action: retry_step, target: x}}\n",
            ['max_retries must be at least 1'],
        ];
        yield 'type errors reported together' => [
            "version: \"1.0\"\nname: t\nsteps:\n  - {goal: no id}\n  - {id: 5}\n",
            ['steps[0].id is required', 'steps[1].id must be a non-empty string'],
        ];
    }
}
