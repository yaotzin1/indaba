<?php

declare(strict_types=1);

namespace Indaba\Workflow\Model;

enum DecisionType: string
{
    /** Every participant must agree. */
    case Consensus = 'consensus';
    /** More than half of the participants must agree. */
    case Majority = 'majority';
}
