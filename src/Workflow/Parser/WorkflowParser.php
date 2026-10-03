<?php

declare(strict_types=1);

namespace Indaba\Workflow\Parser;

use Indaba\Core\Exception\WorkflowValidationException;
use Indaba\Workflow\Model\DecisionType;
use Indaba\Workflow\Model\FailureAction;
use Indaba\Workflow\Model\GuardDefinition;
use Indaba\Workflow\Model\GuardType;
use Indaba\Workflow\Model\Isolation;
use Indaba\Workflow\Model\McpPolicy;
use Indaba\Workflow\Model\McpServerDefinition;
use Indaba\Workflow\Model\OnFailure;
use Indaba\Workflow\Model\RoleDefinition;
use Indaba\Workflow\Model\StepDefinition;
use Indaba\Workflow\Model\WorkflowDefinition;
use Symfony\Component\Yaml\Exception\ParseException;
use Symfony\Component\Yaml\Yaml;

/**
 * Parses and validates a workflow file. Every problem found is reported at once.
 */
final readonly class WorkflowParser
{
    public const string SUPPORTED_VERSION = '1.0';

    public function __construct(private WorkflowValidator $validator = new WorkflowValidator()) {}

    public function parseFile(string $path): WorkflowDefinition
    {
        $contents = is_file($path) ? file_get_contents($path) : false;
        if ($contents === false) {
            throw new WorkflowValidationException([sprintf('cannot read workflow file "%s"', $path)]);
        }

        return $this->parse($contents);
    }

    public function parse(string $yaml): WorkflowDefinition
    {
        try {
            $data = Yaml::parse($yaml);
        } catch (ParseException $e) {
            throw new WorkflowValidationException(['invalid YAML: ' . $e->getMessage()]);
        }
        if (!is_array($data) || ($data !== [] && array_is_list($data))) {
            throw new WorkflowValidationException(['the document root must be a mapping']);
        }

        $errors = new ErrorBag();
        $plain = new Node($data, '$', $errors);

        $artifacts = $plain->stringMap('artifacts');
        $root = new Node($data, '$', $errors, new Interpolator($artifacts));

        $version = $root->string('version') ?? '';
        if ($version !== '' && $version !== self::SUPPORTED_VERSION) {
            $errors->add(sprintf('unsupported version "%s" (expected "%s")', $version, self::SUPPORTED_VERSION));
        }
        $name = $root->string('name') ?? '';

        $roles = [];
        foreach ($root->nodeMap('roles') as $roleName => $node) {
            $runner = $node->string('runner');
            if ($runner !== null) {
                $roles[$roleName] = new RoleDefinition($roleName, $runner, $node->string('model', false), $node->stringList('mcp'));
            }
        }

        $steps = [];
        foreach ($root->nodeList('steps') as $node) {
            $step = $this->parseStep($node, $errors);
            if ($step !== null) {
                $steps[] = $step;
            }
        }

        $mcpServers = [];
        foreach ($root->nodeMap('mcp_servers') as $serverName => $serverNode) {
            $mcpServers[$serverName] = new McpServerDefinition(
                $serverName,
                $serverNode->string('command', false),
                $serverNode->stringList('args'),
                $serverNode->stringMap('env'),
                $serverNode->string('url', false),
            );
        }
        $defaults = $root->map('defaults');
        $defaultPolicy = $defaults === null ? McpPolicy::Required : ($this->parsePolicy($defaults, $errors) ?? McpPolicy::Required);

        $workflow = new WorkflowDefinition($version, $name, $artifacts, $roles, $steps, $mcpServers, $defaultPolicy);

        $all = $errors->all();
        if ($errors->isEmpty()) {
            $all = $this->validator->validate($workflow);
        }
        if ($all !== []) {
            throw new WorkflowValidationException($all);
        }

        return $workflow;
    }

    private function parseStep(Node $node, ErrorBag $errors): ?StepDefinition
    {
        $id = $node->string('id');
        if ($id === null) {
            return null;
        }

        $guards = [];
        foreach ($node->nodeList('guards') as $guardNode) {
            $typeName = $guardNode->string('type');
            $type = $typeName === null ? null : GuardType::tryFrom($typeName);
            if ($typeName !== null && $type === null) {
                $errors->add(sprintf('%s.type "%s" is not a known guard', $guardNode->path, $typeName));
            }
            if ($type !== null) {
                $guards[] = new GuardDefinition($type, $guardNode->stringList('paths', true));
            }
        }

        $isolationName = $node->string('isolation', false);
        $isolation = $isolationName === null ? Isolation::None : Isolation::tryFrom($isolationName);
        if ($isolation === null) {
            $errors->add(sprintf('%s.isolation "%s" is not supported', $node->path, (string) $isolationName));
            $isolation = Isolation::None;
        }

        $decisionName = $node->string('decision_type', false);
        $decision = $decisionName === null ? null : DecisionType::tryFrom($decisionName);
        if ($decisionName !== null && $decision === null) {
            $errors->add(sprintf('%s.decision_type "%s" is not supported', $node->path, $decisionName));
        }

        return new StepDefinition(
            id: $id,
            role: $node->string('role', false),
            runner: $node->string('runner', false),
            goal: $node->string('goal', false, true) ?? '',
            dependsOn: $node->stringList('depends_on'),
            inputArtifacts: $node->stringList('input_artifacts', true),
            outputs: $node->stringList('outputs', true),
            commands: $node->stringList('commands', true),
            guards: $guards,
            isolation: $isolation,
            onFailure: $this->parseOnFailure($node->map('on_failure'), $errors),
            consensusWith: $node->stringList('consensus_with'),
            decisionType: $decision,
            mcp: $node->stringList('mcp'),
            mcpPolicy: $this->parsePolicy($node, $errors),
        );
    }

    private function parsePolicy(Node $node, ErrorBag $errors): ?McpPolicy
    {
        $name = $node->string('mcp_policy', false);
        if ($name === null) {
            return null;
        }        $policy = McpPolicy::tryFrom($name);
        if ($policy === null) {
            $errors->add(sprintf('%s.mcp_policy "%s" must be "required" or "optional"', $node->path, $name));
        }        return $policy;
    }
    private function parseOnFailure(?Node $node, ErrorBag $errors): ?OnFailure
    {
        if ($node === null) {
            return null;
        }
        $actionName = $node->string('action');
        $action = $actionName === null ? null : FailureAction::tryFrom($actionName);
        if ($actionName !== null && $action === null) {
            $errors->add(sprintf('%s.action "%s" is not supported', $node->path, $actionName));
        }
        if ($action === null) {
            return null;
        }

        return new OnFailure($action, $node->string('target', false), $node->int('max_retries', 0));
    }
}
