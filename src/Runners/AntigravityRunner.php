<?php

declare(strict_types=1);

namespace Indaba\Runners;

/**
 * Google Antigravity CLI (`agy`) in headless print mode. File edits in the workspace are
 * auto-approved by the CLI; shell commands need a grant in its settings.json, or an explicit
 * `--dangerously-skip-permissions` passed through `$extraArgs`, which Indaba never adds on its
 * own. Authenticate once interactively first: headless runs use the cached credentials.
 */
final class AntigravityRunner extends AbstractCliRunner implements McpCapable
{
    /**
     * @param list<string> $extraArgs
     */
    public function __construct(
        private readonly string $binary = 'agy',
        private readonly array $extraArgs = [],
        bool $usePty = true,
    ) {
        parent::__construct($usePty);
    }

    public function mcpCapability(): McpCapability
    {
        return McpCapability::AgentManaged;
    }

    public function name(): string
    {
        return 'antigravity';
    }

    protected function command(RunRequest $request): array
    {
        $command = [$this->binary, ...$this->extraArgs];
        if ($request->model !== null) {
            array_push($command, '--model', $request->model);
        }
        array_push($command, '-p', $request->prompt);

        return $command;
    }
}
