<?php

declare(strict_types=1);

namespace Indaba\Workspace;

use Indaba\Core\Exception\WorkspaceException;

/**
 * Creates detached worktrees under `<project>/.indaba/worktrees/<taskId>[-<variant>]`.
 */
final readonly class GitWorktreeManager implements WorkspaceManager
{
    public function __construct(
        private string $projectDir,
        private Git $git = new Git(),
    ) {}

    public function create(string $taskId, ?string $variant = null): Workspace
    {
        $name = $this->safeName($taskId) . ($variant === null ? '' : '-' . $this->safeName($variant));
        $path = rtrim($this->projectDir, '/\\') . '/.indaba/worktrees/' . $name;

        if (file_exists($path)) {
            throw new WorkspaceException(sprintf('Worktree path already exists: %s', $path));
        }
        if (!is_dir(dirname($path)) && !mkdir(dirname($path), 0o775, true) && !is_dir(dirname($path))) {
            throw new WorkspaceException(sprintf('Cannot create %s', dirname($path)));
        }

        $this->git->run(['worktree', 'add', '--detach', $path, 'HEAD'], $this->projectDir);

        return new GitWorktree($this->projectDir, $path, $this->git);
    }

    private function safeName(string $value): string
    {
        if (preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]*$/', $value) !== 1 || str_contains($value, '..')) {
            throw new WorkspaceException(sprintf('Unsafe task or variant name "%s".', $value));
        }

        return $value;
    }
}
