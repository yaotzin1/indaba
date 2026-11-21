import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EnforcementMode,
  McpCapability,
  mcpCapabilityOf,
  PermissionLevel,
  permissionCapabilitiesOf,
  permissionMapOf,
  RunnerUnavailableError,
  type RunRequest,
} from '@indaba/core';
import { afterEach, describe, expect, it } from 'vitest';
import { ACP_AGENT_PRESETS, AcpRunner, OpenClawRunner, RunnerRegistry } from '../src/index.js';
import { FakeAgent, type Script } from './acp-support.js';

/** specs/openclaw, T-05 to T-10: the runner against the fake ACP agent of the other ACP tests. */

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function workdir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'indaba-openclaw-')));
  dirs.push(dir);
  return dir;
}

const text = (t: string): Record<string, unknown> => ({
  sessionUpdate: 'agent_message_chunk',
  content: { type: 'text', text: t },
});

const SAYS_HELLO: Script = {
  prompt: (_message, wire, reply) => {
    wire.update(text('hello from the gateway'));
    reply({ stopReason: 'end_turn' });
  },
};

async function run(
  script: Script = SAYS_HELLO,
  overrides: Partial<RunRequest> = {},
  env: Record<string, string | undefined> = {},
  passEnv: string[] = [],
) {
  const agent = new FakeAgent(script);
  const runner = new OpenClawRunner({ spawner: agent, env, passEnv });
  const result = await runner.run({ prompt: 'do the thing', workdir: await workdir(), ...overrides });
  return { result, agent, runner };
}

describe('the openclaw runner starts the bridge (AC-01, AC-02)', () => {
  it('is a runner of its own name, and the acp runner keeps its name', () => {
    const runner = new OpenClawRunner();
    expect(runner.name).toBe('openclaw');
    expect(runner.description).toContain('OpenClaw');
    expect(new AcpRunner().name).toBe('acp');
    expect(new AcpRunner().description).toContain('Agent Client Protocol');
  });

  it('starts openclaw acp as an argument array, and carries the agent’s reply as the output', async () => {
    const { result, agent } = await run();
    expect(agent.specs[0]?.command).toEqual(['openclaw', 'acp']);
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe('hello from the gateway');
    expect(agent.methods()).toEqual(['initialize', 'session/new', 'session/prompt']);
  });

  it('is registered with the other built-in runners', () => {
    const registry = RunnerRegistry.withDefaults({});
    expect(registry.names()).toContain('openclaw');
    expect(registry.names()).toContain('acp');
    expect(registry.describe().find((entry) => entry.name === 'openclaw')?.description).toContain('OpenClaw');
  });
});

describe('the agent of a request (AC-04, AC-08)', () => {
  it('replaces the command with the author’s own, and passes the login method on', async () => {
    const authenticated: unknown[] = [];
    const script: Script = {
      ...SAYS_HELLO,
      initialize: (_message, _wire, reply) =>
        reply({ protocolVersion: 1, agentCapabilities: {}, authMethods: [{ id: 'token', name: 'Token' }] }),
      authenticate: (message, _wire, reply) => {
        authenticated.push(message.params);
        reply({});
      },
    };
    const { agent } = await run(script, {
      agent: { command: ['C:\\tools\\openclaw.exe', 'acp', '--verbose'], auth: 'token' },
    });
    expect(agent.specs[0]?.command).toEqual(['C:\\tools\\openclaw.exe', 'acp', '--verbose']);
    expect(authenticated).toEqual([{ methodId: 'token' }]);
  });

  it('ignores a preset a role names, and an empty command', async () => {
    const preset = await run(SAYS_HELLO, { agent: { preset: 'claude' } });
    expect(preset.agent.specs[0]?.command).toEqual(['openclaw', 'acp']);
    const empty = await run(SAYS_HELLO, { agent: { command: [] } });
    expect(empty.agent.specs[0]?.command).toEqual(['openclaw', 'acp']);
  });

  it('is not a preset of the acp runner: agent: openclaw there is unknown (it would claim the two enforcements)', async () => {
    expect(Object.keys(ACP_AGENT_PRESETS).sort()).toEqual(['claude', 'codex', 'gemini', 'opencode']);
    const agent = new FakeAgent(SAYS_HELLO);
    const runner = new AcpRunner({ spawner: agent });
    await expect(
      runner.run({ prompt: 'x', workdir: await workdir(), agent: { preset: 'openclaw' } }),
    ).rejects.toThrow(RunnerUnavailableError);
    await expect(
      runner.run({ prompt: 'x', workdir: await workdir(), agent: { preset: 'openclaw' } }),
    ).rejects.toThrow(/Unknown ACP agent preset "openclaw"/);
  });
});

describe('what reaches the bridge (AC-03, AC-06)', () => {
  it('passes the baseline and the OPENCLAW_ variables, and nothing else of the host', async () => {
    const { agent } = await run(
      SAYS_HELLO,
      {},
      {
        PATH: '/usr/bin',
        HOME: '/home/x',
        OPENCLAW_GATEWAY_TOKEN: 'gateway-token-value',
        OPENCLAW_GATEWAY_PASSWORD: 'gateway-password-value',
        ANTHROPIC_API_KEY: 'unrelated-key',
        OPENROUTER_API_KEY: 'another-key',
      },
    );
    const env = agent.specs[0]?.env ?? {};
    expect(env.OPENCLAW_GATEWAY_TOKEN).toBe('gateway-token-value');
    expect(env.OPENCLAW_GATEWAY_PASSWORD).toBe('gateway-password-value');
    expect(env.PATH).toBe('/usr/bin');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
  });

  it('still passes them when the author wrote the command, and adds what INDABA_ACP_PASS_ENV names', async () => {
    const { agent } = await run(
      SAYS_HELLO,
      { agent: { command: ['openclaw', 'acp', '--session', 'agent:design:main'] } },
      { OPENCLAW_GATEWAY_TOKEN: 't', EXTRA_NAME: 'e', OTHER: 'o' },
      ['EXTRA_NAME'],
    );
    const env = agent.specs[0]?.env ?? {};
    expect(env.OPENCLAW_GATEWAY_TOKEN).toBe('t');
    expect(env.EXTRA_NAME).toBe('e');
    expect(env.OTHER).toBeUndefined();
  });

  it('never sends the workflow’s MCP servers to the bridge, which rejects them', async () => {
    const { agent } = await run(SAYS_HELLO, {
      mcpServers: [{ name: 'docs', command: 'docs-mcp', args: [], env: {} }],
    });
    const created = agent.received.find((message) => message.method === 'session/new');
    expect(created?.params?.mcpServers).toEqual([]);
  });
});

describe('what the runner declares (AC-05, AC-06, T-07)', () => {
  const runner = new OpenClawRunner();

  it('cannot hold read or edit, and accepts full with the gate allowing all', () => {
    const capabilities = permissionCapabilitiesOf(runner);
    expect(capabilities.map((c) => [c.level, c.mode, c.note])).toEqual([
      [PermissionLevel.Read, EnforcementMode.Unsupported, 'no_client_methods'],
      [PermissionLevel.Edit, EnforcementMode.Unsupported, 'no_client_methods'],
      [PermissionLevel.Full, EnforcementMode.Acp, 'gate_allows_all'],
    ]);
    const map = permissionMapOf(runner);
    expect(map.read.mode).toBe(EnforcementMode.Unsupported);
    expect(map.full.note).toBe('gate_allows_all');
  });

  it('declares no MCP capability, where the acp runner injects', () => {
    expect(mcpCapabilityOf(runner)).toBe(McpCapability.None);
    expect(mcpCapabilityOf(new AcpRunner())).toBe(McpCapability.Injected);
  });

  it('reads no denial in an output, as the acp runner does not', () => {
    expect(runner.canRecogniseDenial).toBe(false);
    expect(runner.permissionDenied('permission denied')).toBe(false);
  });
});
