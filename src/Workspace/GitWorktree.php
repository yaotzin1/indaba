<?php

declare(strict_types=1);

namespace Indaba\Workspace;

use Indaba\Core\Exception\WorkspaceException;

final class GitWorktree implements Workspace
{
    private bool $destroyed = false;

    public function __construct(
        private readonly string $projectDir,
        private readonly string $path,
        private readonly Git $git,
    ) {}

    public function path(): string
    {
        return $this->path;
    }

    public function diff(): string
    {
        $this->assertAlive();
        // Stage everything (the index of a worktree is private to it) so new files are included.
        // .indaba holds runtime state, never part of a change.
        $this->git->run(['add', '-A', '--', '.', ':(exclude).indaba'], $this->path);

        return $this->git->run(['diff', '--cached', '--binary', 'HEAD'], $this->path);
    }

    public function destroy(): void
    {
        if ($this->destroyed) {
            return;
        }
        $this->destroyed = true;

        $this->git->run(['worktree', 'remove', '--force', $this->path], $this->projectDir);
        $this->git->run(['worktree', 'prune'], $this->projectDir);
    }

    private function assertAlive(): void
    {
        if ($this->destroyed) {
            throw new WorkspaceException('The workspace has been destroyed.');
        }
    }
}
