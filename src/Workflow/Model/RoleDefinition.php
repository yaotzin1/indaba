<?php

declare(strict_types=1);

namespace Indaba\Workflow\Model;

final readonly class RoleDefinition
{
    public function __construct(
        public string $name,
        public string $runner,
        public ?string $model = null,
    ) {}
}
