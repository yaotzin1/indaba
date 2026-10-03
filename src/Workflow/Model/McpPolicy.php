<?php

declare(strict_types=1);

namespace Indaba\Workflow\Model;

enum McpPolicy: string
{
    /** A step that needs a server its runner cannot provide is refused before the run starts. */
    case Required = 'required';
    /** The step runs without a server its runner cannot provide. */
    case Optional = 'optional';
}
