import {
  type AgentSpec,
  EnforcementMode,
  EnforcementScope,
  McpCapability,
  type PermissionCapability,
  PermissionLevel,
  type RunRequest,
  type RunResult,
} from '@indaba/core';
import { AcpRunner, type AcpRunnerOptions } from './acp-runner.js';
import { unsupported } from './permissions.js';

export type OpenClawRunnerOptions = AcpRunnerOptions;

/** What `openclaw acp` is started with, and which variables of the host reach it (the Gateway token and password). */
const OPENCLAW_PRESET = { command: ['openclaw', 'acp'], envPrefixes: ['OPENCLAW_'] } as const;
const PRESET_NAME = 'openclaw';

/**
 * OpenClaw over its ACP bridge (`openclaw acp`; specs/openclaw). An `AcpRunner` with its own name, a fixed command, and the
 * capabilities the bridge really has. It does not use the client's file and terminal methods, which are how Indaba holds an
 * ACP agent to a step's `permissions`, so `read` and `edit` are unsupported rather than claimed; and it rejects the MCP servers
 * a session is given, so the runner declares none. The Gateway it talks to is the person's own and is not checked here.
 *
 * It is not an entry of `ACP_AGENT_PRESETS`: as a preset on the `acp` runner it would claim both enforcements.
 */
export class OpenClawRunner extends AcpRunner {
  override readonly name: string = 'openclaw';
  override readonly description: string =
    'OpenClaw through its ACP bridge (openclaw acp): its own tools and approvals; no read or edit level, no MCP from the workflow.';

  constructor(options: OpenClawRunnerOptions = {}) {
    super({
      ...options,
      presets: { [PRESET_NAME]: OPENCLAW_PRESET },
      // A `command` written by the author has no prefixes of its own; the Gateway token still has to reach it.
      passEnv: [...(options.passEnv ?? []), 'OPENCLAW_*'],
    });
  }

  /** The gate answers the approvals the bridge relays, and at `full` allows every one; nothing holds `read` or `edit`. */
  override permissionCapabilities(): readonly PermissionCapability[] {
    return [
      unsupported(PermissionLevel.Read, 'no_client_methods'),
      unsupported(PermissionLevel.Edit, 'no_client_methods'),
      {
        level: PermissionLevel.Full,
        mode: EnforcementMode.Acp,
        scope: EnforcementScope.None,
        note: 'gate_allows_all',
      },
    ];
  }

  /** The bridge answers `session/new` with an error when it is given MCP servers (configure them in OpenClaw itself). */
  override mcpCapability(): McpCapability {
    return McpCapability.None;
  }

  override run(request: RunRequest, signal?: AbortSignal): Promise<RunResult> {
    // The bridge rejects any MCP server in session/new: the engine plans none for this runner, and a caller that hands one over is not obeyed.
    return super.run({ ...request, agent: agentOf(request.agent), mcpServers: [] }, signal);
  }
}

/** The agent of a request: the author's own `command` and `auth` when given, otherwise `openclaw acp`; a `preset` is ignored. */
function agentOf(given: AgentSpec | undefined): AgentSpec {
  const auth = given?.auth === undefined ? {} : { auth: given.auth };
  return given?.command !== undefined && given.command.length > 0
    ? { command: given.command, ...auth }
    : { preset: PRESET_NAME, ...auth };
}
