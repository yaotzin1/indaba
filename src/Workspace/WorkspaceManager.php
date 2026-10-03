<?php

declare(strict_types=1);

namespace Indaba\Workspace;

interface WorkspaceManager
{
    public function create(string $taskId, ?string $variant = null): Workspace;
}
