<?php

declare(strict_types=1);

namespace Indaba\Workflow\Model;

enum FailureAction: string
{
    case RetryStep = 'retry_step';
    case Escalate = 'escalate';
    case Fail = 'fail';
}
