import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type McpServerDefinition, type Runner, RunnerError } from '@indaba/core';

/** A private temporary configuration file and the directory that confines it. */
export interface McpConfigFile {
  readonly file: string;
  readonly directory: string;
}

/**
 * Translates declared MCP servers into what each agent CLI accepts. Output may contain
 * secrets (env values, URLs): callers must never log it.
 */
export const McpConfigWriter = {
  /** Claude Code `--mcp-config` document. */
  claudeJson(servers: readonly McpServerDefinition[]): string {
    const entries = servers.map((server): [string, Record<string, unknown>] => {
      if (server.url !== undefined) {
        return [server.name, { type: 'http', url: server.url }];
      }
      const entry: Record<string, unknown> = { command: server.command ?? null, args: [...server.args] };
      if (Object.keys(server.env).length > 0) {
        entry.env = { ...server.env };
      }
      return [server.name, entry];
    });
    // fromEntries defines own properties, so a server called "__proto__" stays plain data.
    return JSON.stringify({ mcpServers: Object.fromEntries(entries) });
  },

  /**
   * Writes a private (0600) file inside a fresh private directory (0700). The caller removes
   * the directory, whatever the outcome of the run.
   */
  async writeClaudeFile(servers: readonly McpServerDefinition[]): Promise<McpConfigFile> {
    let directory: string | undefined;
    try {
      directory = await mkdtemp(join(tmpdir(), 'indaba-mcp-'));
      const file = join(directory, 'mcp.json');
      await writeFile(file, McpConfigWriter.claudeJson(servers), { mode: 0o600 });
      return { file, directory };
    } catch (error) {
      if (directory !== undefined) {
        await rm(directory, { recursive: true, force: true });
      }
      throw new RunnerError('Cannot write the temporary MCP configuration file.', { cause: error });
    }
  },

  /**
   * Codex `-c key=value` overrides (values are TOML).
   *
   * @returns alternating `-c`, `<override>` arguments
   */
  codexArgs(servers: readonly McpServerDefinition[]): string[] {
    const args: string[] = [];
    for (const server of servers) {
      const prefix = `mcp_servers.${tomlKey(server.name)}.`;
      if (server.url !== undefined) {
        args.push('-c', `${prefix}url=${toml(server.url)}`);
        continue;
      }
      args.push('-c', `${prefix}command=${toml(server.command ?? '')}`);
      if (server.args.length > 0) {
        args.push('-c', `${prefix}args=[${server.args.map(toml).join(', ')}]`);
      }
      const pairs = Object.entries(server.env).map(([key, value]) => `${tomlKey(key)} = ${toml(value)}`);
      if (pairs.length > 0) {
        args.push('-c', `${prefix}env={${pairs.join(', ')}}`);
      }
    }
    return args;
  },
};

// JSON string escapes are valid TOML basic-string escapes.
function toml(value: string): string {
  return JSON.stringify(value);
}

function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : toml(key);
}
