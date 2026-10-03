<?php

declare(strict_types=1);

namespace Indaba\Workflow\Guard;

use Indaba\Core\Exception\WorkspaceException;
use Indaba\Workflow\Model\GuardDefinition;
use Indaba\Workflow\Model\GuardType;
use Indaba\Workspace\Git;

/**
 * Filesystem boundary: the step may not have modified, added or deleted anything under the
 * guarded paths (e.g. no changes to `src/` during an RFC phase). Fails closed when git
 * state cannot be inspected.
 */
final readonly class GitDiffEmptyGuard implements GuardInterface
{
    public function __construct(private Git $git = new Git()) {}

    public function type(): GuardType
    {
        return GuardType::GitDiffEmpty;
    }

    public function check(GuardDefinition $guard, string $workdir): GuardResult
    {
        $paths = $guard->paths === [] ? ['.'] : $guard->paths;

        try {
            $status = $this->git->run(
                ['status', '--porcelain', '--untracked-files=all', '--', ...$paths],
                $workdir,
            );
        } catch (WorkspaceException $e) {
            return GuardResult::fail('Cannot inspect git state: ' . $e->getMessage());
        }

        $changes = array_values(array_filter(explode("\n", $status), static fn(string $l): bool => trim($l) !== ''));
        if ($changes === []) {
            return GuardResult::pass();
        }

        return GuardResult::fail(sprintf(
            "Changes are not allowed under %s:\n%s",
            implode(', ', $paths),
            implode("\n", $changes),
        ));
    }
}
