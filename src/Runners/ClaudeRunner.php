<?php

declare(strict_types=1);

namespace Indaba\Runners;

/**
 * Claude Code in print mode. Edits are auto-accepted by default because an implementer
 * step has to write files; narrow `$extraArgs` if a step should be read-only.
 *
 * MCP servers are injected: written to a private temporary file passed with `--mcp-config`,
 * with `--strict-mcp-config` so the agent sees exactly the servers the workflow declared.
 */
final class ClaudeRunner extends AbstractCliRunner implements McpCapable
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

    public function mcpCapability(): McpCapability
    {
        return McpCapability::Injected;
    }

    protected function command(RunRequest $request): array
    {
        return $this->build($request, null);
    }

    protected function prepare(RunRequest $request): PreparedCommand
    {
        if ($request->mcpServers === []) {
            return new PreparedCommand($this->build($request, null));
        }

        $file = McpConfigWriter::writeClaudeFile($request->mcpServers);

        return new PreparedCommand($this->build($request, $file), [$file]);
    }

    /**
     * @return list<string>
     */
    private function build(RunRequest $request, ?string $mcpConfigFile): array
    {
        $command = [$this->binary, '-p', $request->prompt, ...$this->extraArgs];
        if ($mcpConfigFile !== null) {
            array_push($command, '--mcp-config', $mcpConfigFile, '--strict-mcp-config');
        }
        if ($request->model !== null) {
            array_push($command, '--model', $request->model);
        }

        return $command;
    }
}
