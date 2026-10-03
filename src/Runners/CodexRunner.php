<?php

declare(strict_types=1);

namespace Indaba\Runners;

/**
 * OpenAI Codex CLI in non-interactive mode (`codex exec`). Codex is read-only by default, so
 * the workspace-write sandbox is requested: an implementer step has to edit files, and the
 * sandbox still confines the edits to the working directory. Authenticate beforehand
 * (`codex login`, or CODEX_API_KEY in the environment).
 *
 * MCP servers are injected as `-c mcp_servers.<name>.*` configuration overrides.
 */
final class CodexRunner extends AbstractCliRunner implements McpCapable
{
    /**
     * @param list<string> $extraArgs
     */
    public function __construct(
        private readonly string $binary = 'codex',
        private readonly array $extraArgs = ['--sandbox', 'workspace-write'],
        bool $usePty = true,
    ) {
        parent::__construct($usePty);
    }

    public function name(): string
    {
        return 'codex';
    }

    public function mcpCapability(): McpCapability
    {
        return McpCapability::Injected;
    }

    protected function command(RunRequest $request): array
    {
        $command = [$this->binary, 'exec', ...$this->extraArgs, ...McpConfigWriter::codexArgs($request->mcpServers)];
        if ($request->model !== null) {
            array_push($command, '--model', $request->model);
        }
        $command[] = $request->prompt;

        return $command;
    }
}
