<?php

declare(strict_types=1);

namespace Indaba\Runners;

use Symfony\Component\Process\Exception\ProcessTimedOutException;
use Symfony\Component\Process\Process;

/**
 * Runs an agent CLI. When the platform supports it a pseudo-terminal is allocated so
 * the tool sees a TTY and streams ANSI output; in that mode stdout and stderr arrive
 * merged. The argument vector is passed to the process directly, never through a shell.
 */
abstract class AbstractCliRunner implements RunnerInterface
{
    public function __construct(private readonly bool $usePty = true) {}

    /**
     * @return list<string>
     */
    abstract protected function command(RunRequest $request): array;

    /**
     * Override when the command needs temporary files (e.g. an MCP configuration). The runner
     * deletes them once the process ends, however it ends.
     */
    protected function prepare(RunRequest $request): PreparedCommand
    {
        return new PreparedCommand($this->command($request));
    }

    public function run(RunRequest $request): RunResult
    {
        $started = hrtime(true);
        $prepared = $this->prepare($request);
        $process = new Process(
            $prepared->command,
            $request->workdir,
            $request->env === [] ? null : $request->env,
            null,
            $request->timeoutSeconds,
        );

        if ($this->usePty && Process::isPtySupported()) {
            $process->setPty(true);
        }

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
        } finally {
            foreach ($prepared->temporaryFiles as $file) {
                if (is_file($file)) {
                    unlink($file);
                }
            }
        }

        return new RunResult(
            $exit,
            self::stripAnsi($stdout),
            self::stripAnsi($stderr),
            null,
            (hrtime(true) - $started) / 1e6,
            $request->model,
        );
    }

    public static function stripAnsi(string $text): string
    {
        $clean = preg_replace('/\e\[[0-9;?]*[ -\/]*[@-~]|\e\][^\x07\e]*(?:\x07|\e\\\\)/', '', $text) ?? $text;

        return str_replace("\r\n", "\n", $clean);
    }
}
