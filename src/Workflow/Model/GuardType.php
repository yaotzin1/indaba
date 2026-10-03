<?php

declare(strict_types=1);

namespace Indaba\Workflow\Model;

enum GuardType: string
{
    case GitDiffEmpty = 'git_diff_empty';
}
