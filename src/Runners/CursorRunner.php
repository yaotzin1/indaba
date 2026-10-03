<?php

declare(strict_types=1);

namespace Indaba\Runners;

final class CursorRunner extends AbstractCliRunner
{
    public function __construct(private readonly string $binary = 'cursor-agent', bool $usePty = true)
    {
        parent::__construct($usePty);
    }

    public function name(): string
    {
        return 'cursor';
    }

    protected function command(RunRequest $request): array
    {
        $command = [$this->binary, '-p', $request->prompt];
        if ($request->model !== null) {
            array_push($command, '--model', $request->model);
        }

        return $command;
    }
}
