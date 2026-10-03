<?php

declare(strict_types=1);

namespace Indaba\Workflow\Engine;

use Indaba\Workflow\State\StepStatus;

final readonly class WorkflowResult
{
    /**
     * @param array<string, StepStatus> $steps final status per step id
     */
    public function __construct(
        public string $taskId,
        public string $traceId,
        public WorkflowStatus $status,
        public array $steps,
        public ?string $failureReason = null,
    ) {}
}
