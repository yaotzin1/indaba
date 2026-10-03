<?php

declare(strict_types=1);

namespace Indaba\Workflow\Model;

final readonly class OnFailure
{
    public function __construct(
        public FailureAction $action,
        public ?string $target = null,
        public int $maxRetries = 0,
    ) {}
}
