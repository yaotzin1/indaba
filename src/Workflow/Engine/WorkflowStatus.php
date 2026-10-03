<?php

declare(strict_types=1);

namespace Indaba\Workflow\Engine;

enum WorkflowStatus: string
{
    case Completed = 'COMPLETED';
    case Failed = 'FAILED';
    case Escalated = 'ESCALATED';
}
