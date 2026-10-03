<?php

declare(strict_types=1);

namespace Indaba\Runners;

use Indaba\Core\Exception\RunnerException;
use Indaba\Workflow\Model\McpServerDefinition;

/**
 * Translates declared MCP servers into what each agent CLI accepts. Output may contain
 * secrets (env values, URLs): callers must never log it.
 */
final class McpConfigWriter
{
    /**
     * Claude Code `--mcp-config` document.
     *
     * @param list<McpServerDefinition> $servers
     */
    public static function claudeJson(array $servers): string
    {
        $entries = [];
        foreach ($servers as $server) {
            if ($server->url !== null) {
                $entries[$server->name] = ['type' => 'http', 'url' => $server->url];
            } else {
                $entry = ['command' => $server->command, 'args' => $server->args];
                if ($server->env !== []) {
                    $entry['env'] = $server->env;
                }
                $entries[$server->name] = $entry;
            }
        }

        return json_encode(['mcpServers' => (object) $entries], \JSON_THROW_ON_ERROR | \JSON_UNESCAPED_SLASHES);
    }

    /**
     * Writes a private (0600) temporary file. The caller deletes it.
     *
     * @param list<McpServerDefinition> $servers
     */
    public static function writeClaudeFile(array $servers): string
    {
        $path = tempnam(sys_get_temp_dir(), 'indaba-mcp-');
        if ($path === false || !chmod($path, 0o600) || file_put_contents($path, self::claudeJson($servers)) === false) {
            if (is_string($path) && is_file($path)) {
                unlink($path);
            }
            throw new RunnerException('Cannot write the temporary MCP configuration file.');
        }

        return $path;
    }

    /**
     * Codex `-c key=value` overrides (values are TOML).
     *
     * @param list<McpServerDefinition> $servers
     * @return list<string> alternating `-c`, `<override>` arguments
     */
    public static function codexArgs(array $servers): array
    {
        $args = [];
        foreach ($servers as $server) {
            $prefix = 'mcp_servers.' . $server->name . '.';
            if ($server->url !== null) {
                array_push($args, '-c', $prefix . 'url=' . self::toml($server->url));
                continue;
            }
            array_push($args, '-c', $prefix . 'command=' . self::toml((string) $server->command));
            if ($server->args !== []) {
                array_push($args, '-c', $prefix . 'args=[' . implode(', ', array_map(self::toml(...), $server->args)) . ']');
            }
            if ($server->env !== []) {
                $pairs = [];
                foreach ($server->env as $key => $value) {
                    $pairs[] = self::tomlKey($key) . ' = ' . self::toml($value);
                }
                array_push($args, '-c', $prefix . 'env={' . implode(', ', $pairs) . '}');
            }
        }

        return $args;
    }

    private static function toml(string $value): string
    {
        // JSON string escapes are valid TOML basic-string escapes.
        return json_encode($value, \JSON_THROW_ON_ERROR | \JSON_UNESCAPED_SLASHES | \JSON_UNESCAPED_UNICODE);
    }

    private static function tomlKey(string $key): string
    {
        return preg_match('/^[A-Za-z0-9_-]+$/', $key) === 1 ? $key : self::toml($key);
    }
}
