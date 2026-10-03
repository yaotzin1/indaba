<?php

declare(strict_types=1);

namespace Indaba\Tests\Support;

use Indaba\Runners\RunnerInterface;
use Indaba\Runners\RunRequest;
use Indaba\Runners\RunResult;

final class FakeRunner implements RunnerInterface
{
    /** @var list<RunRequest> */
    public array $requests = [];

    /**
     * @param \Closure(RunRequest, int): RunResult $handler receives the request and the 1-based call number
     */
    public function __construct(private readonly string $name, private readonly \Closure $handler) {}

    public function name(): string
    {
        return $this->name;
    }

    public function run(RunRequest $request): RunResult
    {
        $this->requests[] = $request;

        return ($this->handler)($request, count($this->requests));
    }
}
