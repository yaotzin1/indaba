<?php

declare(strict_types=1);

namespace Indaba\Workflow\Model;

use Indaba\Core\Exception\IndabaException;

final readonly class WorkflowDefinition
{
    /**
     * @param array<string, string> $artifacts
     * @param array<string, RoleDefinition> $roles
     * @param list<StepDefinition> $steps
     */
    public function __construct(
        public string $version,
        public string $name,
        public array $artifacts,
        public array $roles,
        public array $steps,
    ) {}

    public function step(string $id): StepDefinition
    {
        foreach ($this->steps as $step) {
            if ($step->id === $id) {
                return $step;
            }
        }

        throw new IndabaException(sprintf('Unknown step "%s".', $id));
    }

    public function role(string $name): RoleDefinition
    {
        return $this->roles[$name] ?? throw new IndabaException(sprintf('Unknown role "%s".', $name));
    }
}
