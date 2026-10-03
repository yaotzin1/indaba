<?php

declare(strict_types=1);

namespace Indaba\Workspace;

use Indaba\Core\Exception\WorkspaceException;

/**
 * Validates and applies unified diffs with `git apply`.
 */
final readonly class PatchService
{
    public function __construct(private Git $git = new Git()) {}

    public function canApply(string $patch, string $cwd): bool
    {
        if (trim($patch) === '') {
            return true;
        }
        try {
            $this->git->run(['apply', '--check', '-'], $cwd, $patch);
        } catch (WorkspaceException) {
            return false;
        }

        return true;
    }

    public function apply(string $patch, string $cwd): void
    {
        if (trim($patch) === '') {
            return;
        }
        $this->git->run(['apply', '--check', '-'], $cwd, $patch);
        $this->git->run(['apply', '-'], $cwd, $patch);
    }
}
