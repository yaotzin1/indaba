import type { PermissionFinding } from '@indaba/engine';

/** What the built-in default of a runner allows, in words (specs/agent-permissions, AC-08). */
const RUNNER_DEFAULTS: Readonly<Record<string, string>> = {
  'claude-code': 'edits are accepted without asking',
  codex: 'it may change files in its workspace',
  acp: 'Indaba refuses edits, deletes and commands that the block does not allow',
  antigravity: 'Indaba adds no permission argument, so the agent applies its own',
  opencode: 'Indaba adds no permission argument, so the agent applies its own',
  cursor: 'Indaba adds no permission argument, so the agent applies its own',
};

/** The words for the note ids that runners declare (C-10: the front end owns its words). */
const NOTES: Readonly<Record<string, string>> = {
  plan_mode: 'the agent is put in its plan mode',
  accept_edits: 'the agent accepts edits and refuses other actions it cannot ask about',
  bypass_permissions: 'the agent runs with its permission checks off',
  skip_permissions: 'the agent runs with its permission checks off',
  auto_approve: 'the agent approves every permission itself',
  commands_not_limited: 'commands the agent runs are not limited',
  no_read_only_argument: 'it has no read-only mode, so a command could not be stopped',
  argument_unconfirmed: 'Indaba has not confirmed the argument that sets this level',
  gate: 'Indaba answers each request of the agent as it is made',
  gate_allows_all: 'Indaba allows every request of the agent',
  cannot_act: 'it cannot change files or run commands',
};

function noteOf(id: string | undefined): string {
  return id === undefined ? 'it does not offer this level' : (NOTES[id] ?? id);
}

/** One line for a finding. Errors make `validate` and `plan` fail; the rest are printed as facts. */
export function describePermissionFinding(finding: PermissionFinding): string {
  const step = `step "${finding.stepId}"`;
  switch (finding.code) {
    case 'unsupported':
      return `${step}: the runner "${finding.runner}" cannot hold the level "${finding.level}": ${noteOf(finding.note)}`;
    case 'read_with_mcp':
      return `${step}: a read-only agent that is given a tool server is not read-only; remove its mcp list or choose another level`;
    case 'edit_with_mcp':
      return `${step}: its mcp servers act with their own rights, whatever the level`;
    case 'default':
      return `${step}: no level is written, so the built-in default of the ${finding.runner} runner applies (${
        RUNNER_DEFAULTS[finding.runner] ?? 'Indaba cannot describe what it allows'
      }), not a level you chose; add permissions with a level to choose, for example permissions: { level: edit, fs: { write: ["src/**"] } }`;
    case 'full':
      return `${step}: FULL ACCESS: this step's agent can change anything and run anything and nobody approves it (runners: ${finding.runners.join(', ')})`;
    case 'enforcement': {
      const d = finding.description;
      const when = d.checkedOnlyAfter ? '; checked after the step, not while it works' : '';
      return `${step}: level "${d.level}" on ${d.runner}: ${noteOf(d.note)}${when}`;
    }
    case 'denial_unrecognised':
      return `${step}: a refused permission cannot be told from success for the ${finding.runner} runner`;
    case 'bound_no_effect':
      return `${step}: it has no level written, so this run's --permissions bound changes nothing for it`;
  }
}
