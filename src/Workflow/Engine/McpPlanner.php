<?php

declare(strict_types=1);

namespace Indaba\Workflow\Engine;

use Indaba\Core\Exception\RunnerException;
use Indaba\Runners\McpCapability;
use Indaba\Runners\McpCapable;
use Indaba\Runners\RunnerInterface;
use Indaba\Runners\RunnerRegistry;
use Indaba\Workflow\Model\McpPolicy;
use Indaba\Workflow\Model\StepDefinition;
use Indaba\Workflow\Model\WorkflowDefinition;

/**
 * Decides, per step and per runner, how each wanted MCP server is provided, and checks the
 * whole workflow before anything runs.
 */
final readonly class McpPlanner
{
    public function __construct(private RunnerRegistry $runners) {}

    public static function capabilityOf(RunnerInterface $runner): McpCapability
    {
        return $runner instanceof McpCapable ? $runner->mcpCapability() : McpCapability::None;
    }

    /**
     * @param string|null $roleName the role speaking in this step (a consensus has several), if any
     */
    public function resolve(WorkflowDefinition $workflow, StepDefinition $step, ?string $roleName, RunnerInterface $runner): McpResolution
    {
        $names = $step->mcp;
        if ($roleName !== null && isset($workflow->roles[$roleName])) {
            $names = [...$workflow->roles[$roleName]->mcp, ...$names];
        }
        $names = array_values(array_unique($names));
        if ($names === []) {
            return new McpResolution();
        }

        $policy = $step->mcpPolicy ?? $workflow->defaultMcpPolicy;
        $capability = self::capabilityOf($runner);

        $injected = [];
        $assumed = [];
        $skipped = [];
        $missing = [];
        foreach ($names as $name) {
            $definition = $workflow->mcpServers[$name] ?? null;
            if ($definition === null) {
                $missing[] = $name; // unreachable after validation; fail closed regardless
                continue;
            }
            match (true) {
                $capability === McpCapability::Injected => $injected[] = $definition,
                $capability === McpCapability::AgentManaged => $assumed[] = $name,
                $policy === McpPolicy::Optional => $skipped[] = $name,
                default => $missing[] = $name,
            };
        }

        return new McpResolution($injected, $assumed, $skipped, $missing);
    }

    /**
     * @return list<McpIssue> errors first matter to the caller; warnings are informational
     */
    public function preflight(WorkflowDefinition $workflow): array
    {
        $issues = [];

        foreach ($workflow->steps as $step) {
            foreach ($this->speakers($workflow, $step) as [$roleName, $runnerName]) {
                try {
                    $runner = $this->runners->get($runnerName);
                } catch (RunnerException) {
                    continue; // an unknown runner is reported when the step runs
                }

                $resolution = $this->resolve($workflow, $step, $roleName, $runner);
                foreach ($resolution->missing as $name) {
                    $issues[] = new McpIssue($step->id, $runnerName, $name, true, 'the runner has no MCP support (policy: required)');
                }
                foreach ($resolution->skipped as $name) {
                    $issues[] = new McpIssue($step->id, $runnerName, $name, false, 'the runner has no MCP support; the step will run without it (policy: optional)');
                }
                foreach ($resolution->assumed as $name) {
                    $issues[] = new McpIssue($step->id, $runnerName, $name, false, 'managed by the agent itself; Indaba cannot verify it is configured');
                }
            }
        }

        return $issues;
    }

    /**
     * Who runs a step: one speaker, or every participant of a consensus.
     *
     * @return list<array{string|null, string}> pairs of role name (if any) and runner name
     */
    public function speakers(WorkflowDefinition $workflow, StepDefinition $step): array
    {
        $roles = $step->isConsensus()
            ? array_values(array_unique([...($step->role === null ? [] : [$step->role]), ...$step->consensusWith]))
            : ($step->role === null ? [] : [$step->role]);

        if ($roles === []) {
            return [[null, $step->runner ?? '']];
        }

        $speakers = [];
        foreach ($roles as $role) {
            if (isset($workflow->roles[$role])) {
                $speakers[] = [$role, $workflow->roles[$role]->runner];
            }
        }

        return $speakers;
    }
}
