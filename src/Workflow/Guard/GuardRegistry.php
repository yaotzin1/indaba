<?php

declare(strict_types=1);

namespace Indaba\Workflow\Guard;

use Indaba\Workflow\Model\GuardDefinition;

final class GuardRegistry
{
    /** @var array<string, GuardInterface> */
    private array $guards = [];

    /**
     * @param list<GuardInterface> $guards
     */
    public function __construct(array $guards)
    {
        foreach ($guards as $guard) {
            $this->guards[$guard->type()->value] = $guard;
        }
    }

    public static function withDefaults(): self
    {
        return new self([new GitDiffEmptyGuard()]);
    }

    public function check(GuardDefinition $definition, string $workdir): GuardResult
    {
        $guard = $this->guards[$definition->type->value] ?? null;

        return $guard === null
            ? GuardResult::fail(sprintf('No implementation registered for guard "%s".', $definition->type->value))
            : $guard->check($definition, $workdir);
    }
}
