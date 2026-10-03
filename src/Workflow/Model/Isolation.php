<?php

declare(strict_types=1);

namespace Indaba\Workflow\Model;

enum Isolation: string
{
    case None = 'none';
    case GitWorktree = 'git_worktree';
}
