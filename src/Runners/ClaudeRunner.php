<?php

declare(strict_types=1);

namespace Indaba\Runners;

/**
 * Claude Code in print mode. Edits are auto-accepted by default because an implementer
 * step has to write files; narrow `$extraArgs` if a step should be read-only.
 */
final class ClaudeRunner extends AbstractCliRunner
{
    /**
     * @param list<string> $extraArgs
     */
    public function __construct(
        private readonly string $binary = 'claude',
        private readonly array $extraArgs = ['--permission-mode', 'acceptEdits'],
        bool $usePty = true,
    ) {
        parent::__construct($usePty);
    }

    public function name(): string
    {
        return 'claude-code';
    }

    protected function command(RunRequest $request): array
    {
        $command = [$this->binary, '-p', $request->prompt, ...$this->extraArgs];
        if ($request->model !== null) {
            array_push($command, '--model', $request->model);
        }

        return $command;
    }
}
