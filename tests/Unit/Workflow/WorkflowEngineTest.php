<?php

declare(strict_types=1);

namespace Indaba\Tests\Unit\Workflow;

use Indaba\Observability\Tracer;
use Indaba\Runners\RunnerRegistry;
use Indaba\Runners\RunRequest;
use Indaba\Runners\RunResult;
use Indaba\Runners\ShellRunner;
use Indaba\Tests\Support\FakeRunner;
use Indaba\Tests\Support\TempDir;
use Indaba\Workflow\Engine\StepExecutor;
use Indaba\Workflow\Engine\WorkflowEngine;
use Indaba\Workflow\Engine\WorkflowResult;
use Indaba\Workflow\Engine\WorkflowStatus;
use Indaba\Workflow\Guard\GuardRegistry;
use Indaba\Workflow\Parser\WorkflowParser;
use Indaba\Workflow\State\StepStatus;
use Indaba\Workflow\State\StepStatusChanged;
use Indaba\Workspace\GitWorktreeManager;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Clock\MockClock;
use Symfony\Component\EventDispatcher\EventDispatcher;

final class WorkflowEngineTest extends TestCase
{
    use TempDir;

    private const string PIPELINE = <<<'YAML'
        version: "1.0"
        name: pipeline
        artifacts:
          spec: ".indaba/artifacts/spec.md"
          patch: ".indaba/artifacts/change.patch"
        roles:
          architect: {runner: arch}
          implementer: {runner: impl}
          reviewer: {runner: rev}
        steps:
          - id: rfc
            role: architect
            goal: "Write ${{ artifacts.spec }}"
            outputs: ["${{ artifacts.spec }}"]
            guards:
              - {type: git_diff_empty, paths: ["src/"]}
          - id: code
            depends_on: [rfc]
            role: implementer
            input_artifacts: ["${{ artifacts.spec }}"]
            goal: Implement it
            isolation: git_worktree
          - id: verify
            depends_on: [code]
            runner: shell
            commands: ["grep -q fixed src/app.txt"]
            on_failure: {action: retry_step, target: code, max_retries: 2}
          - id: review
            depends_on: [verify]
            role: reviewer
            consensus_with: [architect]
            decision_type: consensus
            goal: Review the change
        YAML;

    /** @var list<StepStatusChanged> */
    private array $transitions = [];

    /**
     * @param array<string, FakeRunner> $agents
     */
    private function engine(string $repo, array $agents): WorkflowEngine
    {
        $events = new EventDispatcher();
        $events->addListener(StepStatusChanged::class, function (StepStatusChanged $e): void {
            $this->transitions[] = $e;
        });
        $tracer = new Tracer(new MockClock(), $events);

        $registry = new RunnerRegistry();
        $registry->register(new ShellRunner());
        foreach ($agents as $runner) {
            $registry->register($runner);
        }

        return new WorkflowEngine(
            new StepExecutor($registry, GuardRegistry::withDefaults(), $tracer),
            $tracer,
            $events,
            new GitWorktreeManager($repo),
        );
    }

    private function architect(): FakeRunner
    {
        return new FakeRunner('arch', function (RunRequest $r, int $n): RunResult {
            // The architect writes the spec on its first call (the RFC step); later calls are debate turns.
            if ($n === 1) {
                mkdir($r->workdir . '/.indaba/artifacts', 0o775, true);
                file_put_contents($r->workdir . '/.indaba/artifacts/spec.md', '# spec');

                return new RunResult(0, 'done');
            }

            return new RunResult(0, 'AGREEMENT: matches the spec');
        });
    }

    private function reviewer(string $reply = 'AGREEMENT: lgtm'): FakeRunner
    {
        return new FakeRunner('rev', static fn(): RunResult => new RunResult(0, $reply));
    }

    private function statusOf(WorkflowResult $r, string $step): StepStatus
    {
        return $r->steps[$step];
    }

    public function testRunsTheWholePipelineRetriesWithIsolatedFeedbackAndCleansUp(): void
    {
        $repo = $this->makeGitRepo();
        $implementer = new FakeRunner('impl', function (RunRequest $r, int $n): RunResult {
            self::assertStringContainsString('/.indaba/worktrees/', $r->workdir);
            self::assertFileExists($r->workdir . '/.indaba/artifacts/spec.md', 'input artifact is staged into the worktree');
            file_put_contents($r->workdir . '/src/app.txt', $n === 1 ? "broken\n" : "fixed\n");

            return new RunResult(0, 'ok');
        });

        $result = $this->engine($repo, ['arch' => $this->architect(), 'impl' => $implementer, 'rev' => $this->reviewer()])
            ->run((new WorkflowParser())->parse(self::PIPELINE), $repo, 'T1');

        self::assertSame(WorkflowStatus::Completed, $result->status, (string) $result->failureReason);
        foreach (['rfc', 'code', 'verify', 'review'] as $id) {
            self::assertSame(StepStatus::Completed, $this->statusOf($result, $id));
        }

        // One failed attempt, then a retry that was told only about that failure.
        self::assertCount(2, $implementer->requests);
        self::assertStringNotContainsString('previous attempt failed', $implementer->requests[0]->prompt);
        self::assertStringContainsString('previous attempt failed', $implementer->requests[1]->prompt);
        self::assertStringContainsString('grep -q fixed src/app.txt', $implementer->requests[1]->prompt);

        // The change reached the patch artifact, not the main checkout; the worktree is gone.
        self::assertStringContainsString('+fixed', (string) file_get_contents($repo . '/.indaba/artifacts/change.patch'));
        self::assertSame("v1\n", file_get_contents($repo . '/src/app.txt'));
        self::assertDirectoryDoesNotExist($repo . '/.indaba/worktrees/T1');

        $verify = array_values(array_filter($this->transitions, static fn(StepStatusChanged $t): bool => $t->stepId === 'verify'));
        self::assertContains(StepStatus::Failed, array_map(static fn(StepStatusChanged $t): StepStatus => $t->to, $verify));
    }

    public function testExhaustedRetriesEscalate(): void
    {
        $repo = $this->makeGitRepo();
        $implementer = new FakeRunner('impl', static fn(): RunResult => new RunResult(0, 'did nothing'));

        $result = $this->engine($repo, ['arch' => $this->architect(), 'impl' => $implementer, 'rev' => $this->reviewer()])
            ->run((new WorkflowParser())->parse(self::PIPELINE), $repo, 'T2');

        self::assertSame(WorkflowStatus::Escalated, $result->status);
        self::assertCount(3, $implementer->requests, 'first attempt plus max_retries=2');
        self::assertSame(StepStatus::Escalated, $this->statusOf($result, 'verify'));
        self::assertSame(StepStatus::Pending, $this->statusOf($result, 'review'));
        self::assertDirectoryDoesNotExist($repo . '/.indaba/worktrees/T2');
    }

    public function testRfcStepFailsWhenItTouchesSource(): void
    {
        $repo = $this->makeGitRepo();
        $architect = new FakeRunner('arch', static function (RunRequest $r): RunResult {
            mkdir($r->workdir . '/.indaba/artifacts', 0o775, true);
            file_put_contents($r->workdir . '/.indaba/artifacts/spec.md', '# spec');
            file_put_contents($r->workdir . '/src/app.txt', "sneaky\n");

            return new RunResult(0, 'done');
        });

        $result = $this->engine($repo, ['arch' => $architect])->run((new WorkflowParser())->parse(self::PIPELINE), $repo, 'T3');

        self::assertSame(WorkflowStatus::Failed, $result->status);
        self::assertSame(StepStatus::Failed, $this->statusOf($result, 'rfc'));
        self::assertStringContainsString('Guard git_diff_empty failed', (string) $result->failureReason);
        self::assertStringContainsString('src/app.txt', (string) $result->failureReason);
    }

    public function testMissingOutputArtifactFailsTheStep(): void
    {
        $repo = $this->makeGitRepo();
        $architect = new FakeRunner('arch', static fn(): RunResult => new RunResult(0, 'forgot the file'));

        $result = $this->engine($repo, ['arch' => $architect])->run((new WorkflowParser())->parse(self::PIPELINE), $repo, 'T4');

        self::assertSame(WorkflowStatus::Failed, $result->status);
        self::assertStringContainsString('was not produced', (string) $result->failureReason);
    }

    public function testNoConsensusEscalatesWithoutRetrying(): void
    {
        $repo = $this->makeGitRepo();
        $implementer = new FakeRunner('impl', static function (RunRequest $r): RunResult {
            file_put_contents($r->workdir . '/src/app.txt', "fixed\n");

            return new RunResult(0, 'ok');
        });
        $reviewer = $this->reviewer('CRITIQUE: needs more tests');

        $result = $this->engine($repo, ['arch' => $this->architect(), 'impl' => $implementer, 'rev' => $reviewer])
            ->run((new WorkflowParser())->parse(self::PIPELINE), $repo, 'T5');

        self::assertSame(WorkflowStatus::Escalated, $result->status);
        self::assertSame(StepStatus::Escalated, $this->statusOf($result, 'review'));
        self::assertStringContainsString('needs more tests', (string) $result->failureReason);
        self::assertCount(1, $implementer->requests);
    }

    public function testUnknownRunnerFailsTheStepInsteadOfCrashing(): void
    {
        $repo = $this->makeGitRepo();
        $result = $this->engine($repo, [])->run((new WorkflowParser())->parse(self::PIPELINE), $repo, 'T6');

        self::assertSame(WorkflowStatus::Failed, $result->status);
        self::assertStringContainsString('Unknown runner "arch"', (string) $result->failureReason);
    }
}
