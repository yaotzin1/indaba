<?php

declare(strict_types=1);

namespace Indaba\Workflow\Engine;

use Indaba\Core\Exception\IndabaException;
use Indaba\Core\Exception\McpUnavailableException;
use Indaba\Mesh\ConsensusArbiter;
use Indaba\Mesh\ParticipantInterface;
use Indaba\Mesh\RunnerParticipant;
use Indaba\Observability\Span;
use Indaba\Observability\SpanStatus;
use Indaba\Observability\Tracer;
use Indaba\Runners\RunnerInterface;
use Indaba\Runners\RunnerRegistry;
use Indaba\Runners\RunRequest;
use Indaba\Runners\RunResult;
use Indaba\Workflow\Guard\GuardRegistry;
use Indaba\Workflow\Model\DecisionType;
use Indaba\Workflow\Model\McpServerDefinition;
use Indaba\Workflow\Model\StepDefinition;
use Indaba\Workflow\Model\WorkflowDefinition;

/**
 * Executes one step's work (run) and then checks its postconditions (validate).
 * Retry, ordering and state transitions belong to the engine.
 */
final readonly class StepExecutor
{
    private McpPlanner $mcp;

    public function __construct(
        private RunnerRegistry $runners,
        private GuardRegistry $guards,
        private Tracer $tracer,
        private PromptBuilder $prompts = new PromptBuilder(),
        private ConsensusArbiter $arbiter = new ConsensusArbiter(),
        private float $timeoutSeconds = 900.0,
    ) {
        $this->mcp = new McpPlanner($runners);
    }

    /**
     * @return list<McpIssue>
     */
    public function mcpIssues(WorkflowDefinition $workflow): array
    {
        return $this->mcp->preflight($workflow);
    }

    public function run(
        StepDefinition $step,
        WorkflowDefinition $workflow,
        string $workdir,
        Span $span,
        ?string $feedback,
        ?\Closure $onOutput = null,
    ): StepOutcome {
        try {
            if ($step->isShell()) {
                return $this->runShell($step, $workdir, $span, $onOutput);
            }
            if ($step->isConsensus()) {
                return $this->runConsensus($step, $workflow, $workdir, $span);
            }

            return $this->runAgent($step, $workflow, $workdir, $span, $feedback, $onOutput);
        } catch (IndabaException $e) {
            return StepOutcome::failed($e->getMessage());
        }
    }

    public function validate(StepDefinition $step, string $workdir): StepOutcome
    {
        foreach ($step->outputs as $output) {
            $path = $this->resolve($workdir, $output);
            if ($path === null || !is_file($path)) {
                return StepOutcome::failed(sprintf('Expected output "%s" was not produced.', $output));
            }
        }

        foreach ($step->guards as $guard) {
            $result = $this->guards->check($guard, $workdir);
            if (!$result->passed) {
                return StepOutcome::failed(sprintf('Guard %s failed: %s', $guard->type->value, $result->message ?? ''));
            }
        }

        return StepOutcome::ok();
    }

    private function runShell(StepDefinition $step, string $workdir, Span $span, ?\Closure $onOutput): StepOutcome
    {
        $shell = $this->runners->get(StepDefinition::SHELL_RUNNER);

        foreach ($step->commands as $command) {
            $result = $this->invoke($shell, new RunRequest($command, $workdir, null, $this->timeoutSeconds, [], $onOutput), $span, 'execute_tool', $command);
            if (!$result->succeeded()) {
                return StepOutcome::failed(sprintf(
                    "Command `%s` exited with code %d.\n%s",
                    $command,
                    $result->exitCode,
                    $this->prompts->tail($result->failureText()),
                ));
            }
        }

        return StepOutcome::ok();
    }

    private function runAgent(
        StepDefinition $step,
        WorkflowDefinition $workflow,
        string $workdir,
        Span $span,
        ?string $feedback,
        ?\Closure $onOutput,
    ): StepOutcome {
        [$runner, $model] = $this->resolveRunner($step, $workflow);
        $mcp = $this->mcp->resolve($workflow, $step, $step->role, $runner);
        $this->recordMcp($span, $mcp);
        if ($mcp->missing !== []) {
            return StepOutcome::failed(sprintf('Required MCP server(s) unavailable for runner %s: %s', $runner->name(), implode(', ', $mcp->missing)));
        }
        $request = new RunRequest($this->prompts->build($step, $feedback), $workdir, $model, $this->timeoutSeconds, [], $onOutput, $mcp->injected);
        $result = $this->invoke($runner, $request, $span, 'invoke_agent', $runner->name());

        return $result->succeeded()
            ? StepOutcome::ok()
            : StepOutcome::failed(sprintf("Runner %s exited with code %d.\n%s", $runner->name(), $result->exitCode, $this->prompts->tail($result->failureText())));
    }

    private function runConsensus(StepDefinition $step, WorkflowDefinition $workflow, string $workdir, Span $span): StepOutcome
    {
        $roles = array_values(array_unique([...($step->role === null ? [] : [$step->role]), ...$step->consensusWith]));

        $participants = array_map(function (string $roleName) use ($step, $workflow, $workdir, $span): ParticipantInterface {
            $role = $workflow->role($roleName);
            $runner = $this->runners->get($role->runner);
            $mcp = $this->mcp->resolve($workflow, $step, $roleName, $runner);
            $this->recordMcp($span, $mcp);
            if ($mcp->missing !== []) {
                throw new McpUnavailableException([sprintf('step "%s", role "%s": %s', $step->id, $roleName, implode(', ', $mcp->missing))]);
            }

            return new RunnerParticipant(
                $roleName,
                $runner,
                $workdir,
                $role->model,
                fn(RunnerInterface $r, RunRequest $req): RunResult => $this->invoke($r, $req, $span, 'invoke_agent', $roleName),
                $mcp->injected,
            );
        }, $roles);

        $topic = $step->goal !== '' ? $step->goal : 'Review the work produced so far and decide whether it should be accepted.';
        if ($step->inputArtifacts !== []) {
            $topic .= "\n\nRelevant artifacts:\n- " . implode("\n- ", $step->inputArtifacts);
        }

        $result = $this->arbiter->deliberate($topic, $participants, $step->decisionType ?? DecisionType::Consensus);
        $span->setAttribute('indaba.consensus.outcome', $result->outcome->value);
        $span->setAttribute('indaba.consensus.rounds', $result->rounds);

        if ($result->reached()) {
            return StepOutcome::ok();
        }

        // No quorum is a judgement call for a human, not something a retry can fix.
        return StepOutcome::escalated(sprintf(
            "No consensus (%s after %d round(s)). Open objections:\n%s",
            $result->outcome->value,
            $result->rounds,
            $result->openObjections(),
        ));
    }
    /** Names only: server definitions can carry secrets and never reach a span. */
    private function recordMcp(Span $span, McpResolution $mcp): void
    {
        $injected = array_map(static fn(McpServerDefinition $d): string => $d->name, $mcp->injected);
        foreach (['servers' => $injected, 'assumed' => $mcp->assumed, 'skipped' => $mcp->skipped] as $key => $names) {
            if ($names !== []) {
                $existing = $span->attributes['indaba.mcp.' . $key] ?? '';
                $all = array_filter([is_string($existing) ? $existing : '', implode(',', $names)], static fn(string $s): bool => $s !== '');
                $span->setAttribute('indaba.mcp.' . $key, implode(',', $all));
            }
        }
    }

    /**
     * @return array{RunnerInterface, ?string}
     */
    private function resolveRunner(StepDefinition $step, WorkflowDefinition $workflow): array
    {
        if ($step->role !== null) {
            $role = $workflow->role($step->role);

            return [$this->runners->get($role->runner), $role->model];
        }

        return [$this->runners->get($step->runner ?? throw new IndabaException('Step has neither role nor runner.')), null];
    }

    private function invoke(RunnerInterface $runner, RunRequest $request, Span $parent, string $operation, string $label): RunResult
    {
        $span = $this->tracer->startSpan($operation . ' ' . $runner->name(), $parent, [
            Tracer::ATTR_OPERATION => $operation,
            'indaba.runner' => $runner->name(),
            'indaba.label' => $label,
        ]);

        try {
            $result = $runner->run($request);
        } catch (\Throwable $e) {
            $this->tracer->endSpan($span, SpanStatus::Error, $e->getMessage());
            throw $e;
        }

        if ($result->usage !== null && ($result->model ?? $request->model) !== null) {
            $this->tracer->recordUsage($span, $runner->name(), $result->model ?? (string) $request->model, $result->usage);
        }
        $span->setAttribute('indaba.exit_code', $result->exitCode);
        $this->tracer->endSpan($span, $result->succeeded() ? SpanStatus::Ok : SpanStatus::Error);

        return $result;
    }

    /** Resolves a workflow-relative path, refusing anything that escapes the working directory. */
    public function resolve(string $workdir, string $relative): ?string
    {
        $base = realpath($workdir);
        if ($base === false || str_contains($relative, "\0")) {
            return null;
        }
        $candidate = $base . DIRECTORY_SEPARATOR . ltrim(str_replace('\\', '/', $relative), '/');
        $parts = [];
        foreach (explode('/', str_replace(DIRECTORY_SEPARATOR, '/', $candidate)) as $segment) {
            if ($segment === '..') {
                array_pop($parts);
            } elseif ($segment !== '.') {
                $parts[] = $segment;
            }
        }
        $normalised = implode('/', $parts);
        $normalisedBase = str_replace(DIRECTORY_SEPARATOR, '/', $base);

        return str_starts_with($normalised . '/', rtrim($normalisedBase, '/') . '/') ? $normalised : null;
    }
}
