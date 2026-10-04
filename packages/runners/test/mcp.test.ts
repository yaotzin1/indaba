import { existsSync, statSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import type { McpServerDefinition, Runner } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import {
  ClaudeRunner,
  CodexRunner,
  CommandRunner,
  CursorRunner,
  McpCapability,
  McpConfigWriter,
  mcpCapabilityOf,
  ShellRunner,
} from '../src/index.js';
import { FakeSpawner, TMP } from './support.js';

const servers: McpServerDefinition[] = [
  { name: 'docs', command: 'npx', args: ['-y', 'x'], env: { TOKEN: 'a"b' } },
  { name: 'remote', args: [], env: {}, url: 'https://mcp.example.com/sse' },
];

describe('McpConfigWriter', () => {
  it('writes the Claude config as JSON', () => {
    const decoded = JSON.parse(McpConfigWriter.claudeJson(servers)) as {
      mcpServers: Record<string, unknown>;
    };

    expect(decoded.mcpServers.docs).toEqual({ command: 'npx', args: ['-y', 'x'], env: { TOKEN: 'a"b' } });
    expect(decoded.mcpServers.remote).toEqual({ type: 'http', url: 'https://mcp.example.com/sse' });
  });

  it('keeps a server named like a prototype key as plain data', () => {
    const json = McpConfigWriter.claudeJson([{ name: '__proto__', command: 'x', args: [], env: {} }]);

    expect(Object.keys(JSON.parse(json).mcpServers)).toEqual(['__proto__']);
  });

  it('escapes Codex overrides as TOML values', () => {
    expect(
      McpConfigWriter.codexArgs([
        { name: 'docs', command: 'npx', args: ['-y', 'a"b'], env: { TOKEN: 'x y' } },
        servers[1] as McpServerDefinition,
      ]),
    ).toEqual([
      '-c',
      'mcp_servers.docs.command="npx"',
      '-c',
      'mcp_servers.docs.args=["-y", "a\\"b"]',
      '-c',
      'mcp_servers.docs.env={TOKEN = "x y"}',
      '-c',
      'mcp_servers.remote.url="https://mcp.example.com/sse"',
    ]);
  });

  it('quotes a server name that is not a bare TOML key', () => {
    const args = McpConfigWriter.codexArgs([{ name: 'a.b', command: 'x', args: [], env: {} }]);

    expect(args[1]).toBe('mcp_servers."a.b".command="x"');
  });

  it('writes a private file inside a private temporary directory', async () => {
    const { file, directory } = await McpConfigWriter.writeClaudeFile(servers);
    try {
      expect(dirname(file)).toBe(directory);
      expect(directory.startsWith(tmpdir())).toBe(true);
      expect(await readFile(file, 'utf8')).toBe(McpConfigWriter.claudeJson(servers));
      if (process.platform !== 'win32') {
        expect(statSync(file).mode & 0o777).toBe(0o600);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('MCP in the runners', () => {
  it('ClaudeRunner passes a config file during the run and removes it afterwards', async () => {
    let existedDuringRun = false;
    let content = '';
    const spawner = new FakeSpawner((spec) => {
      const file = spec.command[spec.command.indexOf('--mcp-config') + 1] ?? '';
      existedDuringRun = existsSync(file);
      content = existedDuringRun ? statSync(file).size.toString() : '';
      return undefined;
    });
    await new ClaudeRunner({ spawner, extraArgs: [] }).run({
      prompt: 'go',
      workdir: TMP,
      mcpServers: servers,
    });

    const command = spawner.last.command;
    const file = command[command.indexOf('--mcp-config') + 1] ?? '';
    expect(command.slice(0, 3)).toEqual(['claude', '-p', 'go']);
    expect(command.at(-1)).toBe('--strict-mcp-config');
    expect(existedDuringRun).toBe(true);
    expect(Number(content)).toBeGreaterThan(0);
    expect(existsSync(file)).toBe(false);
    expect(existsSync(dirname(file))).toBe(false);
  });

  it('removes the config file even when the process cannot start', async () => {
    let file = '';
    const spawner = new FakeSpawner((spec) => {
      file = spec.command[spec.command.indexOf('--mcp-config') + 1] ?? '';
      throw new Error('spawn failed');
    });

    await expect(
      new ClaudeRunner({ spawner }).run({ prompt: 'go', workdir: TMP, mcpServers: servers }),
    ).rejects.toThrow('spawn failed');
    expect(file).not.toBe('');
    expect(existsSync(dirname(file))).toBe(false);
  });

  it('ClaudeRunner without servers writes nothing', async () => {
    const spawner = new FakeSpawner();
    await new ClaudeRunner({ spawner, extraArgs: [] }).run({ prompt: 'go', workdir: TMP });

    expect(spawner.last.command).toEqual(['claude', '-p', 'go']);
  });

  it('CodexRunner injects overrides before the prompt', async () => {
    const spawner = new FakeSpawner();
    await new CodexRunner({ spawner }).run({
      prompt: 'go',
      workdir: TMP,
      mcpServers: [servers[1] as McpServerDefinition],
    });

    expect(spawner.last.command).toEqual([
      'codex',
      'exec',
      '--sandbox',
      'workspace-write',
      '-c',
      'mcp_servers.remote.url="https://mcp.example.com/sse"',
      'go',
    ]);
  });

  it('reports each runner capability', () => {
    expect(mcpCapabilityOf(new ClaudeRunner())).toBe(McpCapability.Injected);
    expect(mcpCapabilityOf(new CodexRunner())).toBe(McpCapability.Injected);
    expect(mcpCapabilityOf(new CursorRunner())).toBe(McpCapability.AgentManaged);
    expect(mcpCapabilityOf(new CommandRunner('c', ['x']))).toBe(McpCapability.None);
    expect(mcpCapabilityOf(new CommandRunner('c', ['x'], { mcp: McpCapability.Injected }))).toBe(
      McpCapability.Injected,
    );
    const plain: Runner = new ShellRunner();
    expect(mcpCapabilityOf(plain)).toBe(McpCapability.None);
  });
});
