<?php

declare(strict_types=1);

namespace Indaba\Workflow\Model;

final readonly class GuardDefinition
{
    /**
     * @param list<string> $paths
     */
    public function __construct(
        public GuardType $type,
        public array $paths,
    ) {}
}
