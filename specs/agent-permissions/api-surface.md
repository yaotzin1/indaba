# API surface: Agent permissions

> **Semver impact**: minor for everything new; **major (below 1.0: the next minor, labelled)** for the removal of the two hard-coded
> defaults (spec C-01). Classified under `.agents/skills/api_surface/SKILL.md`: a changed default is a breaking change even though
> nothing fails to type-check.
> **Depends on**: the `permissions` block and `StepPermissions` (already in `@indaba/core`), `McpCapable` as the pattern for a runner
> capability, `specs/agent-conversation` (the channel, for `ask`).

## `@indaba/core`

```ts
export const PermissionLevel = { Read: 'read', Edit: 'edit', Ask: 'ask', Full: 'full' } as const;
export type PermissionLevel = (typeof PermissionLevel)[keyof typeof PermissionLevel];

/** Ordered by how much the agent may do; `lowerLevel` and the run option use it (AC-12). */
export const PERMISSION_ORDER: readonly PermissionLevel[];     // ['read', 'edit', 'ask', 'full']

/** The layer that makes a level true (spec terms). */
export const Enforcement = {
  Native: 'native',            // the agent's own CLI refuses while it works
  Acp: 'acp',                  // Indaba's permission gate answers the agent's requests while it works
  Guard: 'guard',              // a check of the working directory after the step
  None: 'none',                // nothing limits the agent (the level `full`)
  Unsupported: 'unsupported',  // the runner cannot honour the level
} as const;
export type Enforcement = (typeof Enforcement)[keyof typeof Enforcement];

export interface PermissionCapability {
  readonly level: PermissionLevel;
  readonly enforcement: Enforcement;
  /** The arguments the runner adds for this level. Fixed by the runner; never built from workflow text. */
  readonly args: readonly string[];
}

/** Implemented by runners that can say what each level means for them. Same pattern as McpCapable. */
export interface PermissionCapable {
  /** One entry per level; a level that is absent is `unsupported`. */
  permissionCapabilities(): readonly PermissionCapability[];
  /**
   * Whether the agent's final output says it was refused a permission it needed (AC-11). Pure and bounded: it looks at the
   * first and last 4096 characters. It returns a boolean only, never the text.
   */
  permissionDenied(output: string): boolean;
}

export function isPermissionCapable(runner: Runner): runner is Runner & PermissionCapable;
/** A runner that does not implement it supports no level (spec C-04). Never throws. */
export function permissionCapabilitiesOf(runner: Runner): readonly PermissionCapability[];

/** `StepPermissions` gains one optional member; the existing three are unchanged. */
//   readonly level?: PermissionLevel;

/** `RunRequest` gains the effective level, resolved by the engine. Runners that do not implement PermissionCapable ignore it. */
//   readonly permissionLevel?: PermissionLevel;

/** AC-01, AC-13: the effective permissions of a step from defaults, role and step. Pure. */
export function resolvePermissions(layers: {
  readonly defaults?: StepPermissions;
  readonly role?: StepPermissions;
  readonly step?: StepPermissions;
}): StepPermissions | undefined;

/** AC-13: the level a block with no `level` means. */
export function impliedLevel(permissions: StepPermissions): PermissionLevel;   // fsWrite non-empty -> edit, else read

/** AC-12: the lower of two levels. */
export function lowerLevel(a: PermissionLevel, b: PermissionLevel): PermissionLevel;

/** AC-06: what a step's chain of runners cannot honour. Empty means every runner in the chain honours the level. */
export function unsupportedBy(
  level: PermissionLevel,
  chain: readonly { readonly name: string; readonly capabilities: readonly PermissionCapability[] }[],
): readonly { readonly runner: string; readonly why: string }[];

/** AC-08: the sentence for `plan`, `validate` and the editor, from the declared enforcement. Fixed wording per enforcement. */
export function describeEnforcement(runner: string, capability: PermissionCapability): string;

/** AC-09: a permission request the `acp` runner puts to a person. All text is the agent's: untrusted. */
export interface PermissionRequest {
  readonly id: string;                                  // from the injected IdGenerator
  readonly stepId: string;
  readonly toolKind: string;                            // fixed set from acp-policy: read, edit, delete, move, execute, other
  readonly paths: readonly string[];                    // cleaned, each cut at 200 characters, at most 20
  readonly command?: string;                            // cleaned, cut at 500
}
export type PermissionAnswer = 'allow_once' | 'deny';

export const MAX_PERMISSION_REQUEST_PATHS: 20;
export const MAX_PERMISSION_PATH_LENGTH: 200;
export const MAX_PERMISSION_COMMAND_LENGTH: 500;
```

`PermissionCapable` is a new optional contract and `RunRequest.permissionLevel` a new optional member: minor. `PermissionLevel` and
`Enforcement` are closed sets; a member added later is a minor under the same rule `GuardType` is not: consumers are told to treat an
unknown value as `unsupported`.

## `@indaba/runners`

Every built-in runner implements `PermissionCapable` with the table of spec C-03. A runner builds its arguments as
`[...levelArgs, ...extraArgs]` (AC-07). Removed: the default `['--permission-mode', 'acceptEdits']` of `ClaudeCodeRunner` and
`['--sandbox', 'workspace-write']` of `CodexRunner` (spec C-01, **breaking**). The `extraArgs` constructor option stays for embedders.
`AcpRunner` at `ask` calls `decidePermission` for what is outside the allowed set and puts the rest to a person through a new
`PermissionAsker` it is given (below); with none it denies.

```ts
/** Given to the `acp` runner by the composition root; the CLI wires it to the channel of agent-conversation. */
export interface PermissionAsker {
  ask(request: PermissionRequest, signal: AbortSignal): Promise<PermissionAnswer>;   // rejects or resolves 'deny' when nobody answers
}
```

## Workflow file

| Field | Where | Meaning | Default |
| :--- | :--- | :--- | :--- |
| `permissions.level` | step, role, `defaults.permissions` | `read`, `edit`, `ask`, `full` | none: see spec AC-13 and C-01 |
| `permissions` (the whole block) | **role and `defaults` are new**; the step already has it | merged field by field, step over role over defaults | none |
| `permissions.timeout_seconds` | with `level: ask` | the person's time, 1 to 604800 | none (never) |
| `permissions.if_nobody` | with `level: ask` | only `deny` in this version | `deny` |

A parse error names the field path and why for: an unknown level; `edit` or `ask` without a non-empty `fs.write`; `read` with `fs.write` or
`terminal: allow`; `full` together with `fs` or `terminal`; a level on a `shell` step; a level that any runner of the step's chain cannot honour
(the runner, the level and the reason in plain words); `timeout_seconds` or `if_nobody` without `level: ask`; `if_nobody` other than `deny`.

## CLI

| Option | Meaning |
| :--- | :--- |
| `indaba run --permissions [<step>=]<level>` (repeatable) | an upper bound for this run; never raises a level (AC-12) |
| `indaba run --allow-full-access` | the person's acknowledgement of AC-05 for a run with no terminal |
| `indaba plan`, `indaba validate` | per step: the effective level, the enforcement of each runner in the chain (AC-08), the `full` sentence (AC-04) |
| `indaba catalog` | each runner entry gains `permissions: Record<PermissionLevel, Enforcement>` (AC-15) |

A changed or new CLI option: minor, except as stated for the default.

## Span attributes and events

| Name | Value |
| :--- | :--- |
| `indaba.permissions.level` | the effective level of the step |
| `indaba.permissions.enforcement` | the enforcement of the runner that ran it |
| `indaba.permissions.asked`, `.allowed`, `.denied` | counts, at `ask` |
| `indaba.permissions.full_acknowledged` | `terminal`, `run_option` or `page`, on the task span, when a step is `full` |
| event `PermissionDecided { taskId, stepId, toolKind, decision, source }` | one per `ask` answer; no path or command |

New attributes and event: minor.

## Web contract (`@indaba/server`, `@indaba/web`)

The catalog response gains the `permissions` map per runner (AC-15) as an optional member, so a client written before it ignores it; the
web contract version moves by a minor. The Run action's confirmation (`web-app-actions` AC-13) lists the steps at `full` (AC-05). No other
contract change: the form writes `permissions.level` through the existing edit resources.

## Changes to other specs (made when this one is accepted)

- `agent-conversation` AC-43: a permission request is answered by policy "except at the level `ask`" (spec C-05).
- `docs/workflow-format.md`: the Permissions section (the level, the table of C-03, the rule for the default, the sentence about guards).
- `docs/getting-started.md`: the runner table says what each runner does with each level; the lines that say Indaba "never adds `--auto`"
  stay true and are completed with "the level `full` is the author's".
- `web-app-editing-forms`: the presets map to the levels of AC-15; the form shows the refusal and the qualifier of AC-16.
- `workflow-editor`: the schema gains `permissions.level`, role and `defaults` permissions; the catalog gains the map.
