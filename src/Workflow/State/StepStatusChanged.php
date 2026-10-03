<?php

declare(strict_types=1);

namespace Indaba\Workflow\State;

final readonly class StepStatusChanged
{
    public function __construct(
        public string $taskId,
        public string $stepId,
        public StepStatus $from,
        public StepStatus $to,
        public ?string $reason = null,
    ) {}
}
