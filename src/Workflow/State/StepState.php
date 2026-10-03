<?php

declare(strict_types=1);

namespace Indaba\Workflow\State;

use Indaba\Core\Exception\InvalidTransitionException;

final class StepState
{
    private StepStatus $status = StepStatus::Pending;
    private int $attempts = 0;
    private ?string $reason = null;

    public function __construct(public readonly string $stepId) {}

    public function status(): StepStatus
    {
        return $this->status;
    }

    public function attempts(): int
    {
        return $this->attempts;
    }

    public function reason(): ?string
    {
        return $this->reason;
    }

    public function transitionTo(StepStatus $to, ?string $reason = null): void
    {
        if (!$this->status->canTransitionTo($to)) {
            throw new InvalidTransitionException(sprintf(
                'Step "%s" cannot move from %s to %s.',
                $this->stepId,
                $this->status->value,
                $to->value,
            ));
        }

        $this->status = $to;
        $this->reason = $reason;
        if ($to === StepStatus::Running) {
            ++$this->attempts;
        }
    }
}
