<?php

declare(strict_types=1);

namespace Indaba\Workspace;

use Indaba\Core\Exception\WorkspaceException;
use Symfony\Component\Process\Process;

/**
 * Thin wrapper over the git binary. Arguments are passed as a vector, never via a shell.
 */
final readonly class Git
{
    /**
     * @param list<string> $args
     */
    public function run(array $args, string $cwd, ?string $stdin = null): string
    {
        $process = new Process(['git', ...$args], $cwd, null, $stdin, 120);
        $process->run();

        if (!$process->isSuccessful()) {
            throw new WorkspaceException(sprintf(
                'git %s failed in %s: %s',
                implode(' ', $args),
                $cwd,
                trim($process->getErrorOutput() . $process->getOutput()),
            ));
        }

        return $process->getOutput();
    }
}
