import {
  DecisionType,
  FailureAction,
  Isolation,
  McpPolicy,
  PermissionLevel,
  PermissionMode,
} from '@indaba/core';
import { WorkflowParser } from '../parser/parser.js';

/**
 * The JSON Schema (draft 2020-12) of the workflow file (specs/workflow-editor, AC-08, AC-09): its structure, as
 * `WorkflowParser` reads it, with a description of each field from `docs/workflow-format.md`. Enumerations come from
 * the constants the parser uses, so the two cannot differ; `test/schema.test.ts` keeps the rest agreeing (AC-10).
 *
 * Built by hand, not generated (the spec's non-goals). How the parser reads a field decides its schema: an optional
 * field may be `null`, which the parser takes as absent; a "non-empty" string is one with a character that is not
 * white space; unknown keys are ignored, so they are allowed.
 */

type Schema = Readonly<Record<string, unknown>>;

const values = (constants: Readonly<Record<string, string>>): string[] => Object.values(constants);

/** A field the parser takes as absent when it is null. */
const orNull = (schema: Schema): Schema => ({ anyOf: [schema, { type: 'null' }] });

const NON_EMPTY = { type: 'string', pattern: '\\S' } as const;
const STRING_LIST = { type: 'array', items: { type: 'string' } } as const;
const STRING_MAP = { type: 'object', additionalProperties: { type: 'string' } } as const;

/** A name, or a non-empty list of distinct names, in priority order. */
const RUNNER_CHAIN: Schema = {
  anyOf: [NON_EMPTY, { type: 'array', items: NON_EMPTY, minItems: 1, uniqueItems: true }],
};

const AGENT: Schema = {
  description:
    'For the acp runner: the agent to start, a preset name (claude, codex, gemini, opencode) or a mapping with a preset or a command: [program, arg, ...] and optionally auth, the agent’s own id for how to log in. Other runners ignore it.',
  anyOf: [
    NON_EMPTY,
    {
      type: 'object',
      properties: {
        preset: orNull({ type: 'string', description: 'A preset name.' }),
        command: orNull({ ...STRING_LIST, description: 'The program and its arguments.' }),
        auth: orNull({ type: 'string', description: 'The agent’s own id for how to log in.' }),
      },
      anyOf: [
        {
          required: ['preset'],
          properties: { preset: { type: 'string', description: 'A preset name.' } },
        },
        {
          required: ['command'],
          properties: {
            command: { type: 'array', minItems: 1, description: 'The program and its arguments.' },
          },
        },
      ],
    },
  ],
};

const PERMISSIONS: Schema = {
  type: 'object',
  description:
    'What the step’s agent may do. A step’s block, else its role’s, else defaults’, whole (never merged); a block with no level behaves as before.',
  properties: {
    level: orNull({
      enum: values(PermissionLevel),
      description:
        'read (look only), edit (change the files fs.write names) or full (no limit and nobody asked). ask is not available yet.',
    }),
    fs: orNull({
      type: 'object',
      properties: {
        read: orNull({
          ...STRING_LIST,
          description: 'Globs the agent may read; empty or absent: not restricted.',
        }),
        write: orNull({
          ...STRING_LIST,
          description: 'Globs the agent may change; empty or absent: nothing.',
        }),
      },
    }),
    terminal: orNull({
      enum: values(PermissionMode),
      description: 'Whether the agent may run commands: allow or deny (default deny).',
    }),
  },
};

const ROLE: Schema = {
  type: 'object',
  description: 'A role: who runs a step and with which model.',
  required: ['runner'],
  properties: {
    runner: {
      ...RUNNER_CHAIN,
      description:
        'The runner that executes the role, or a list of runners in priority order: an API runner such as openrouter, acp, claude-code, codex, antigravity, cursor, opencode, or the name of a runner a plugin registers.',
    },
    agent: orNull(AGENT),
    model: orNull({
      type: 'string',
      description: 'Passed to the runner as its model. API runners require one.',
    }),
    mcp: orNull({ ...STRING_LIST, description: 'mcp_servers names that every step of the role may use.' }),
    permissions: orNull({
      ...PERMISSIONS,
      description: 'Used by an agent step of this role that has no permissions of its own.',
    }),
  },
};

const GUARD: Schema = {
  type: 'object',
  required: ['type'],
  properties: {
    type: {
      ...NON_EMPTY,
      description: 'The guard type: git_diff_empty, diff_within_scope, or one a plugin registers.',
    },
    paths: orNull({ ...STRING_LIST, description: 'Paths the guard looks at (interpolated).' }),
  },
};

const ON_FAILURE: Schema = {
  type: 'object',
  description: 'What to do when the step fails.',
  required: ['action'],
  properties: {
    action: { enum: values(FailureAction), description: 'retry_step, escalate or fail.' },
    target: orNull({
      type: 'string',
      description: 'For retry_step: the step to run again: the failing step itself or one of its ancestors.',
    }),
    // Read even when null, which is then an error: not `orNull`.
    max_retries: {
      type: 'integer',
      description: 'For retry_step: an integer of at least 1 (default 0, which is invalid for retry_step).',
    },
  },
};

const MCP_POLICY: Schema = { enum: values(McpPolicy) };

const STEP: Schema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { ...NON_EMPTY, description: 'Unique, matching [A-Za-z0-9_-]+.' },
    role: orNull({
      type: 'string',
      description: 'A key of roles. The step is an agent step run by the role’s runner and model.',
    }),
    runner: orNull({
      ...RUNNER_CHAIN,
      description:
        'A runner, or a list of runners in priority order, named directly. shell makes a shell step. With both a role and a runner, the step’s runner is used and the role still supplies the model.',
    }),
    agent: orNull({ ...AGENT, description: 'For the acp runner: overrides the role’s agent.' }),
    permissions: orNull(PERMISSIONS),
    goal: orNull({
      type: 'string',
      description: 'The instruction given to the agent (interpolated). Empty for a shell step.',
    }),
    depends_on: orNull({
      ...STRING_LIST,
      description: 'List of step ids that must complete first. A step may not depend on itself.',
    }),
    input_artifacts: orNull({
      ...STRING_LIST,
      description: 'Paths the agent is told to read first (interpolated).',
    }),
    outputs: orNull({
      ...STRING_LIST,
      description: 'Paths the step must create (interpolated). Missing after the step is a failure.',
    }),
    commands: orNull({
      ...STRING_LIST,
      description:
        'List of command lines (interpolated), run in order; the first non-zero exit fails the step. Only a shell step may have them, and it must have at least one.',
    }),
    guards: orNull({ type: 'array', items: GUARD, description: 'Checks run after the step succeeds.' }),
    isolation: orNull({ enum: values(Isolation), description: 'none (default) or git_worktree.' }),
    on_failure: orNull(ON_FAILURE),
    consensus_with: orNull({ ...STRING_LIST, description: 'Roles that debate with this step’s role.' }),
    decision_type: orNull({
      enum: values(DecisionType),
      description: 'consensus (every participant agrees) or majority (more than half).',
    }),
    arbiter: orNull({
      type: 'string',
      pattern: '^[A-Za-z0-9_-]+$',
      description:
        'Who settles a debate that failed: human, or the name of an adjudicator a plugin registers. Only on a debate step.',
    }),
    mcp: orNull({
      ...STRING_LIST,
      description: 'mcp_servers names this step may use, in addition to its role’s.',
    }),
    mcp_policy: orNull({
      ...MCP_POLICY,
      description: 'required or optional; overrides defaults.mcp_policy for this step.',
    }),
  },
};

const MCP_SERVER: Schema = {
  type: 'object',
  description:
    'A Model Context Protocol server: exactly one of command (a local process; args and env are optional) or url (an http or https endpoint).',
  properties: {
    command: orNull({ type: 'string', description: 'The program of a local server.' }),
    args: orNull({ ...STRING_LIST, description: 'Its arguments.' }),
    env: orNull({ ...STRING_MAP, description: 'Variables it starts with.' }),
    url: orNull({ type: 'string', description: 'The http or https endpoint of a remote server.' }),
  },
};

/** The JSON Schema of the workflow file. A fresh object each call, so a caller may change its copy. */
export function workflowJsonSchema(): Readonly<Record<string, unknown>> {
  return structuredClone({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://indaba.dev/schema/workflow-1.0.json',
    title: 'Indaba workflow file',
    description:
      'The structure of an Indaba workflow file (docs/workflow-format.md). Rules across fields are not stated here: a role a step names must exist, a dependency must name a step, no cycle, a step needs a role or a runner, step ids are unique, a runner or guard type must be registered. `indaba validate` and WorkflowParser.diagnose report those.',
    type: 'object',
    required: ['version', 'name'],
    properties: {
      version: {
        const: WorkflowParser.SUPPORTED_VERSION,
        description: `Must be "${WorkflowParser.SUPPORTED_VERSION}".`,
      },
      name: { ...NON_EMPTY, description: 'Non-empty string; names the trace (indaba.task <name>).' },
      artifacts: orNull({
        ...STRING_MAP,
        description: 'Map of name to a path string. Names a path once so steps can refer to it.',
      }),
      roles: orNull({
        type: 'object',
        additionalProperties: ROLE,
        description: 'Map of role name to a role. Needed by any step that uses role.',
      }),
      steps: orNull({ type: 'array', items: STEP, description: 'A list with at least one step.' }),
      mcp_servers: orNull({
        type: 'object',
        additionalProperties: MCP_SERVER,
        description: 'Map of server name to a Model Context Protocol server.',
      }),
      defaults: orNull({
        type: 'object',
        description: 'defaults.mcp_policy and defaults.permissions are read.',
        properties: {
          mcp_policy: orNull({ ...MCP_POLICY, description: 'required (the default) or optional.' }),
          permissions: orNull({
            ...PERMISSIONS,
            description: 'Used by an agent step whose step and role have no permissions.',
          }),
        },
      }),
    },
  });
}
