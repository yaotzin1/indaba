<?php

declare(strict_types=1);

namespace Indaba\Runners;

use Symfony\Component\Process\Exception\ProcessTimedOutException;
use Symfony\Component\Process\Process;

/**
 * Deterministic execution of verification commands. The "prompt" is the command line.
 * Commands come from the workflow file the operator wrote, never from model output.
 */
final class ShellRunner implements RunnerInterface
{
    public function name(): string
    {
        return 'shell';
    }

    public function run(RunRequest $request): RunResult
    {
        $started = hrtime(true);
        $process = Process::fromShellCommandline(
            $request->prompt,
            $request->workdir,
            $request->env === [] ? null : $request->env,
            null,
            $request->timeoutSeconds,
        );

        $stdout = '';
        $stderr = '';
        $exit = 1;

        try {
            $process->run(static function (string $type, string $buffer) use (&$stdout, &$stderr, $request): void {
                if ($type === Process::ERR) {
                    $stderr .= $buffer;
                } else {
                    $stdout .= $buffer;
                }
                if ($request->onOutput !== null) {
                    ($request->onOutput)($buffer);
                }
            });
            $exit = $process->getExitCode() ?? 1;
        } catch (ProcessTimedOutException) {
            $exit = 124;
            $stderr .= sprintf("\nTimed out after %s seconds.", $request->timeoutSeconds);
        }

        return new RunResult($exit, $stdout, $stderr, null, (hrtime(true) - $started) / 1e6);
    }
}
