<?php

declare(strict_types=1);

namespace Indaba\Runners;

/**
 * A CLI agent described by configuration: the literal `{prompt}` and `{model}` tokens in
 * the argument template are replaced, one whole argument at a time. Used for engines
 * (Codex, Antigravity) whose command line is configurable rather than built in.
 */
final class CommandRunner extends AbstractCliRunner implements McpCapable
{
    /**
     * @param list<string> $template e.g. ['codex', 'exec', '{prompt}']
     */
    public function __construct(
        private readonly string $runnerName,
        private readonly array $template,
        private readonly McpCapability $mcp = McpCapability::None,
        bool $usePty = true,
    ) {
        parent::__construct($usePty);
    }

    public function mcpCapability(): McpCapability
    {
        return $this->mcp;
    }

    public function name(): string
    {
        return $this->runnerName;
    }

    protected function command(RunRequest $request): array
    {
        $command = [];
        foreach ($this->template as $arg) {
            $command[] = match ($arg) {
                '{prompt}' => $request->prompt,
                '{model}' => $request->model ?? '',
                default => $arg,
            };
        }

        return $command;
    }
}
