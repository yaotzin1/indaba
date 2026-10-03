<?php

declare(strict_types=1);

namespace Indaba\Tests\Unit\Workflow;

use Indaba\Core\Exception\InvalidTransitionException;
use Indaba\Workflow\State\StepState;
use Indaba\Workflow\State\StepStatus;
use PHPUnit\Framework\TestCase;

final class StepStateTest extends TestCase
{
    public function testHappyPathCountsAttempts(): void
    {
        $s = new StepState('x');
        $s->transitionTo(StepStatus::Running);
        $s->transitionTo(StepStatus::Validating);
        $s->transitionTo(StepStatus::Completed);

        self::assertSame(StepStatus::Completed, $s->status());
        self::assertSame(1, $s->attempts());
    }

    public function testRetryRearmsAFailedStep(): void
    {
        $s = new StepState('x');
        $s->transitionTo(StepStatus::Running);
        $s->transitionTo(StepStatus::Failed, 'boom');
        $s->transitionTo(StepStatus::Pending);
        $s->transitionTo(StepStatus::Running);

        self::assertSame(2, $s->attempts());
    }

    public function testRejectsIllegalMoves(): void
    {
        $s = new StepState('x');
        $this->expectException(InvalidTransitionException::class);
        $s->transitionTo(StepStatus::Completed);
    }

    public function testEscalatedIsFinal(): void
    {
        $s = new StepState('x');
        $s->transitionTo(StepStatus::Running);
        $s->transitionTo(StepStatus::Escalated);

        $this->expectException(InvalidTransitionException::class);
        $s->transitionTo(StepStatus::Pending);
    }
}
