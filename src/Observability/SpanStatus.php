<?php

declare(strict_types=1);

namespace Indaba\Observability;

enum SpanStatus: string
{
    case Unset = 'unset';
    case Ok = 'ok';
    case Error = 'error';
}
