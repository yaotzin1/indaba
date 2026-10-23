# API surface: Agent permissions

> **Semver impact**: minor for everything new; **breaking (below 1.0: the next minor, labelled)** for the removal of the two hard-coded defaults and for
> "an absent block means `read`" (spec C-01). Classified under `.agents/skills/api_surface/SKILL.md`: a changed default is a breaking change even though
> nothing fails to type-check. `PermissionLevel`, `PermissionMode` and `PermissionScope` are closed unions that consumers may switch on; a member added later
> is a major in practice (that skill), and consumers are told to treat an unknown value as `unsupported`. They are new now, so this release adds no break.
> **Depends on**: the `permissions` block and `StepPermissions` (already in `@indaba/core`), `McpCapable` as the pattern for a runner capability,
> `specs/agent-conversation` (the channel, for `ask`).

## `@indaba/core`

```ts
export const PermissionLevel = { Read: 'read', Edit: 'edit', Ask: 'ask', Full: 'full' } as const;
export type PermissionLevel = (typeof PermissionLevel)[keyof typeof PermissionLevel];

/** Ordered by how much the agent may do; `lowerLevel` and the run option use it (AC-12). */
export const PERMISSION_ORDER: readonly PermissionLevel[];     // ['read', 'edit', 'ask', 'full']

/** What makes a level true while the agent works (spec terms). */
export const EnforcementMode = {
  Native: 'native',            // the agent's own CLI refuses
  Acp: 'acp',                  // Indaba's permission gate answers the agent's requests
  After: 'after',              // the runner has no mode of its own; only the scope guard checks, after the step
  None: 'none',                // nothing limits the agent (the level `full`)
  Unsupported: 'unsupported',  // the runner cannot honour the level
} as const;
export type EnforcementMode = (typeof EnforcementMode)[keyof typeof EnforcementMode];

/** What holds the `fs.write` globs and `terminal` (spec terms). */
export const EnforcementScope = {
  Acp: 'acp',                  // the gate refuses a request outside them as it is asked (over ACP only; the guard also holds)
  Guard: 'guard',              // a check of the working directory after the step
  None: 'none',                // at `full`
} as const;
export type EnforcementScope = (typeof EnforcementScope)[keyof typeof EnforcementScope];

export interface PermissionCapability {
  readonly level: PermissionLevel;
  readonly mode: EnforcementMode;
  readonly scope: EnforcementScope;
  /** A fixed id a front end turns into words (spec C-10), for example `cli_confines_workspace_only`. */
  readonly note: string;
}

/** Implemented by runners that can say what each level means for them. Same pattern as McpCapable. Arguments stay private to the runner. */
export interface PermissionCapable {
  /** One entry per level; a level that is absent is `unsupported`. */
  permissionCapabilities(): readonly PermissionCapability[];
  /**
   * Whether the agent's final output says it was refused a permission it needed (AC-11). Pure and bounded: it reads the first and last
   * MAX_DENIAL_WINDOW characters. It returns a boolean, never the text. A runner that cannot recognise a refusal returns false and says so
   * through `canRecogniseDenial`.
   */
  permissionDenied(output: string): boolean;
  readonly canRecogniseDenial: boolean;
}

export function isPermissionCapable(runner: Runner): runner is Runner & PermissionCapable;
/** A runner that does not implement it supports no level (spec C-04). Never throws. */
export function permissionCapabilitiesOf(runner: Runner): readonly PermissionCapability[];

export const MAX_DENIAL_WINDOW: 4096;                          // C-07

/** `StepPermissions` gains one optional member. The three existing members keep their types and the parser's filling (C-09). */
//   readonly level?: PermissionLevel;

/** `RunRequest` gains the effective level, resolved by the engine (AC-08, AC-13). Runners that do not implement PermissionCapable ignore it. */
//   readonly permissionLevel?: PermissionLevel;

/** AC-01: the effective block is the step's, else the role's, else `defaults`'s, whole. Pure; never merges. */
export function resolvePermissions(layers: {
  readonly step?: StepPermissions;
  readonly role?: StepPermissions;
  readonly defaults?: StepPermissions;
}): StepPermissions | undefined;

/** AC-08, AC-13: the level in force. No block is `read`; a block with no level is `edit` if fsWrite is non-empty, else `read`. Pure. */
export function effectiveLevel(permissions: StepPermissions | undefined): PermissionLevel;

/** AC-12: the lower of two levels. */
export function lowerLevel(a: PermissionLevel, b: PermissionLevel): PermissionLevel;

/** AC-12: apply a run bound to a step's effective block; an error names why it does not apply. */
export function applyBound(
  permissions: StepPermissions | undefined,
  bound: PermissionLevel,
): { readonly permissions: StepPermissions | undefined; readonly level: PermissionLevel } | { readonly error: string };

/** AC-07: what a step's chain of runners cannot honour. Empty means every runner in the chain honours the level. */
export function unsupportedBy(
  level: PermissionLevel,
  chain: readonly { readonly name: string; readonly capabilities: readonly PermissionCapability[] }[],
): readonly { readonly runner: string; readonly capability: PermissionCapability | undefined }[];

/** AC-07, AC-17, C-10: a structured description for the CLI and the page to render in their own words. No English here. */
export interface EnforcementDescription {
  readonly runner: string;
  readonly level: PermissionLevel;
  readonly mode: EnforcementMode;
  readonly scope: EnforcementScope;
  readonly note: string;
  readonly checkedOnlyAfter: boolean;                   // mode or scope is `after`/`guard` only
}
export function describeEnforcement(runner: string, capability: PermissionCapability): EnforcementDescription;

/** AC-09: a permission request the `acp` runner puts to a person. All text is the agent's: untrusted. */
export interface PermissionRequest {
  readonly id: string;                                  // from the injected IdGenerator
  readonly stepId: string;
  readonly toolKind: string;                            // the fixed set of acp-policy: execute, fetch, other, ...
  readonly paths: readonly string[];                    // cleaned, each cut at 200 characters, at most 20
  readonly command?: string;                            // cleaned, cut at 500
  readonly cut: boolean;                                // true when anything above was cut: only `deny` is offered
}
export type PermissionAnswer = 'allow_once' | 'deny';

export const MAX_PERMISSION_REQUEST_PATHS: 20;
export const MAX_PERMISSION_PATH_LENGTH: 200;
export const MAX_PERMISSION_COMMAND_LENGTH: 500;
```

`PermissionCapable` is a new optional contract and `RunRequest.permissionLevel` a new optional member: minor.

## `@indaba/engine`

- The parser reads `permissions.level`, `permissions.timeout_seconds` (only with `level: ask`), and accepts `permissions` on a role and in `defaults` (AC-01, AC-03). It
  validates what it can without runners: the unknown level, the combinations of AC-03 on the block as written, a level on a `shell` step.
- `checkPermissions(workflow, registry)` makes the checks that need runners (AC-07: every runner of the chain; the `ask`-needs-`acp` rule; the `full` list; the
  `timeout_seconds` versus step-timeout fact). It is called by `validate`, `plan` and at the start of a run, not by `parseWorkflow`. The editor's check resource calls it
  when it has the catalog.
- `effectiveGuards` (chain.ts) adds the implied `diff_within_scope` guard **in addition to** a declared one at `read`, `edit` and `ask` (AC-14), and none at `full`.
- Answerers, advisors, panel members and a decider are called with a block set by the engine at `read` (AC-06).
- The acknowledgement of `full` (AC-05) is a function the composition root gives the engine: `acknowledgeFullAccess(steps): Promise<'terminal' | 'run_option' | 'page' | 'refused'>`.
  A run with no such function and a `full` step refuses to start.

## `@indaba/runners`

Every built-in runner implements `PermissionCapable` with the table of spec C-03. A runner builds its arguments as `[...levelArgs, ...extraArgs]` (AC-07). Removed: the
default `['--permission-mode', 'acceptEdits']` of `ClaudeCodeRunner` and `['--sandbox', 'workspace-write']` of `CodexRunner` (spec C-01, **breaking**); the comment of
`AntigravityRunner` that edits are auto-approved is corrected. `AcpRunner` at `ask` puts the requests of AC-09 to a `PermissionAsker` it is given; with none it denies. Its
`decidePermission` gains the `full` path (allow every request, never "always") and a request-text builder that cleans and cuts.

```ts
/** Given to the `acp` runner by the composition root; the CLI wires it to the channel of agent-conversation. */
export interface PermissionAsker {
  /** Resolves 'deny' when nobody answers, the time ran out, or the signal aborted. Never offers allow for a request with `cut: true`. */
  ask(request: PermissionRequest, signal: AbortSignal): Promise<PermissionAnswer>;
}
```

## Workflow file

| Field | Where | Meaning | Default |
| :--- | :--- | :--- | :--- |
| `permissions.level` | step, role, `defaults.permissions` | `read`, `edit`, `ask`, `full` | none: see spec AC-08 and AC-13 |
| `permissions` (the whole block) | **role and `defaults` are new**; the step already has it | the step's block if there is one, else the role's, else `defaults`'s, whole (never merged) | none, which means `read` |
| `permissions.timeout_seconds` | with `level: ask` | the person's time, 1 to 604800 | none (never) |

A parse error names the field path and why for: an unknown level; `edit` or `ask` written without a non-empty `fs.write`; `read` written with `fs.write` or `terminal: allow`;
`full` written with `fs` or `terminal`; a level on a `shell` step; `timeout_seconds` without `level: ask` or out of range. At `validate`/`plan`/run start: a level that a runner of the
chain cannot honour (the runner, the level, the reason in plain words), `ask` on a runner other than `acp`, and the facts of the spec (agent steps with no block, `ask` steps, `full`
steps, `timeout_seconds` not shorter than the step timeout).

## CLI

| Option | Meaning |
| :--- | :--- |
| `indaba run --permissions [<step>=]<level>` (repeatable) | an upper bound for this run; never raises a level (AC-12); a usage error when it does not apply to a step |
| `indaba run --allow-full-access` | the person's acknowledgement of AC-05 for a run with no terminal |
| `indaba plan`, `indaba validate` | per step: the effective level, the mode and scope for each runner in the chain with the qualifier of AC-17, the `full` sentence (AC-04), the absent-block fact (AC-08), the `ask` channel fact (spec §6) |
| `indaba catalog` | each runner entry gains `permissions: Record<PermissionLevel, { mode, scope, note }>` (AC-16) |

A changed or new CLI option: minor, except as stated for the defaults.

## Span attributes and events

| Name | Value |
| :--- | :--- |
| `indaba.permissions.level` | the effective level of the step |
| `indaba.permissions.mode`, `indaba.permissions.scope` | the enforcement words of the runner that ran it |
| `indaba.permissions.asked`, `.allowed`, `.denied` | counts, at `ask` |
| `indaba.permissions.full_acknowledged` | `terminal`, `run_option` or `page`, on the task span, when a step is `full` |
| event `PermissionDecided { taskId, stepId, toolKind, decision, source }` | one per `ask` answer; no path or command |

New attributes and event: minor.

## Web contract (`@indaba/core` web-contract, `@indaba/server`, `@indaba/web`)

```ts
// CatalogEntry (web-contract/api.ts) gains an optional member; a client written before it ignores it.
//   readonly permissions?: Readonly<Record<PermissionLevel, { readonly mode: EnforcementMode; readonly scope: EnforcementScope; readonly note: string }>>;
```

The web contract version moves by a minor. The form writes `permissions.level` through the existing edit resources, deleting the keys a preset forbids with one edit per path
(AC-16). The page's Run confirmation lists the `full` steps every time and passes `--allow-full-access` only after it (AC-05). The words (the refusal, the qualifier, the `full`
sentence) are in the page's message catalogue, keyed by the `note` ids.

## Changes to other specs (made when this one is accepted)

- `agent-conversation`: AC-43 ("a permission request is answered by policy and is never a question") gains "except at the level `ask`"; the non-goal on answering ACP permission
  requests with a person (its section 4), C-01(b) and C-15(2) are reversed for `ask`; the closed list of channel kinds (C-14, AC-57) and `data-model.md` gain the permission request
  and its answer; AC-53 (answerers read-only) is now enforced by AC-06 here.
- `web-app-actions`: AC-13 (confirmations) gains the `full` list every time (AC-05).
- `web-app-editing-forms`: AC-09 (the presets) maps to the levels and the old-style display (AC-16); the form shows the refusal and the qualifier (AC-17); the "Not set" help text, which says
  other runners are not limited, is replaced.
- `workflow-editor`: the schema gains `permissions.level`, role and `defaults` permissions; the catalog gains the map.
- `docs/workflow-format.md`: the Permissions section (the level, the table of C-03, the absent-block rule, the guard rule, the sentence about the scope being checked after the step).
- `docs/getting-started.md`, `README.md` and the examples that use `claude-code` or `codex` with no `permissions` (C-01): updated in the same change.
