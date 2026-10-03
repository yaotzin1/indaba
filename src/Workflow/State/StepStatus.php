<?php

declare(strict_types=1);

namespace Indaba\Workflow\State;

enum StepStatus: string
{
    case Pending = 'PENDING';
    case Running = 'RUNNING';
    case Validating = 'VALIDATING';
    case Failed = 'FAILED';
    case Escalated = 'ESCALATED';
    case Completed = 'COMPLETED';

    public function canTransitionTo(self $to): bool
    {
        return match ($this) {
            self::Pending => $to === self::Running,
            self::Running => in_array($to, [self::Validating, self::Failed, self::Escalated], true),
            self::Validating => in_array($to, [self::Completed, self::Failed, self::Escalated], true),
            // A failed or completed step may be re-armed when an upstream retry re-runs it.
            self::Failed => in_array($to, [self::Pending, self::Escalated], true),
            self::Completed => $to === self::Pending,
            self::Escalated => false,
        };
    }

    public function isTerminal(): bool
    {
        return $this === self::Escalated || $this === self::Completed;
    }
}
