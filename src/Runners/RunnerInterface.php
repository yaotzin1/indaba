<?php

declare(strict_types=1);

namespace Indaba\Runners;

interface RunnerInterface
{
    /** The name workflows use to select this runner, e.g. "claude-code". */
    public function name(): string;

    public function run(RunRequest $request): RunResult;
}
