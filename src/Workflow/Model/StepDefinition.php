<?php

declare(strict_types=1);

namespace Indaba\Workflow\Model;

final readonly class StepDefinition
{
    public const string SHELL_RUNNER = 'shell';

    /**
     * @param list<string> $dependsOn
     * @param list<string> $inputArtifacts
     * @param list<string> $outputs
     * @param list<string> $commands
     * @param list<GuardDefinition> $guards
     * @param list<string> $consensusWith
     */
    public function __construct(
        public string $id,
        public ?string $role = null,
        public ?string $runner = null,
        public string $goal = '',
        public array $dependsOn = [],
        public array $inputArtifacts = [],
        public array $outputs = [],
        public array $commands = [],
        public array $guards = [],
        public Isolation $isolation = Isolation::None,
        public ?OnFailure $onFailure = null,
        public array $consensusWith = [],
        public ?DecisionType $decisionType = null,
    ) {}

    public function isShell(): bool
    {
        return $this->runner === self::SHELL_RUNNER;
    }

    public function isConsensus(): bool
    {
        return $this->decisionType !== null || $this->consensusWith !== [];
    }
}
