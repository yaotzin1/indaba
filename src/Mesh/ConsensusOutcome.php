<?php

declare(strict_types=1);

namespace Indaba\Mesh;

enum ConsensusOutcome: string
{
    case Reached = 'reached';
    /** The same positions were repeated: more rounds would not help. */
    case Stalled = 'stalled';
    case MaxRoundsExceeded = 'max_rounds_exceeded';
}
