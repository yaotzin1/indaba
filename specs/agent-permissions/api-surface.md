# API surface: Agent permissions

> **Semver impact**: minor for everything in this release. Nothing that exists changes behaviour: a step that writes no level keeps the runner defaults of today (spec C-01). The removal of the two
> hard-coded defaults, and "an absent block means `read`", are a **breaking change of the next minor**, labelled, and are not in this surface. Classified under
> `.agents/skills/api_surface/SKILL.md`. `PermissionLevel`, `EnforcementMode` and `EnforcementScope` are closed unions that consumers may switch on; a member added later (the level `ask`) is a major in
> practice, and consumers are told to treat an unknown value as `unsupported`.
> **Depends on**: the `permissions` block and `StepPermissions` (already in `@indaba/core`), `McpCapable` as the pattern for a runner capability,
> nothing else in this release. (`specs/agent-conversation` is needed only by the later level `ask`.)

## `@indaba/core`

```ts
// `ask` is reserved (spec AC-09): it is not a member in this version and is rejected by the parser with a message that says so.
export const PermissionLevel = { Read: 'read', Edit: 'edit', Full: 'full' } as const;
export type PermissionLevel = (typeof PermissionLevel)[keyof typeof PermissionLevel];

/** Ordered by how much the agent may do; `lowerLevel` and the run option use it (AC-12). */
export const PERMISSION_ORDER: readonly PermissionLevel[];     // ['read', 'edit', 'full']

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

/** `Describes` (the catalog source) gains, for runners only, `permissions?: Readonly<Record<PermissionLevel, { mode, scope, note }>>`; `catalogOf` and `clean()` keep it (spec C-11). */

/** `RunRequest` gains the level the step wrote, or the one a run bound gave it (AC-12). Absent for a step with no level. Runners that do not implement PermissionCapable ignore it. */
//   readonly permissionLevel?: PermissionLevel;

/** AC-01: the effective block is the step's, else the role's, else `defaults`'s, whole. Pure; never merges. */
export function resolvePermissions(layers: {
  readonly step?: StepPermissions;
  readonly role?: StepPermissions;
  readonly defaults?: StepPermissions;
}): StepPermissions | undefined;

/**
 * AC-08, AC-13: a step that writes a level runs at it. A step that writes none has no level in force: it keeps its runner's behaviour (`kind: 'default'`) and
 * `impliedLevel` (edit if fsWrite is non-empty, else read) only describes it and applies a run bound. Pure.
 */
export function effectiveLevel(
  permissions: StepPermissions | undefined,
): { readonly kind: 'written'; readonly level: PermissionLevel } | { readonly kind: 'default'; readonly impliedLevel: PermissionLevel };

/** AC-12: the lower of two levels. */
export function lowerLevel(a: PermissionLevel, b: PermissionLevel): PermissionLevel;

/**
 * AC-12: apply a run bound. A written level is lowered (`edit` to `read` drops `fs.write`, so the implied guard allows no change); a step with no level takes only a bound of `read`;
 * any other bound over it returns the block unchanged with `changed: false` so that `plan` can say so. An error names why it does not apply (a missing or non-agent step).
 */
export function applyBound(
  permissions: StepPermissions | undefined,
  bound: PermissionLevel,
): { readonly permissions: StepPermissions | undefined; readonly level: PermissionLevel | undefined; readonly changed: boolean } | { readonly error: string };

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

```

`PermissionCapable` is a new optional contract and `RunRequest.permissionLevel` a new optional member: minor. The types of the later `ask` level (`PermissionRequest`, `PermissionAnswer`, the limits of its text) are
not in this surface; they belong to the later spec (spec C-05).

## `@indaba/engine`

- The parser reads `permissions.level` and accepts `permissions` on a role and in `defaults` (AC-01, AC-03); `level: ask` and `timeout_seconds` are rejected with the message of AC-09. It
  validates what it can without runners: the unknown or reserved level, the combinations of AC-03 on the block as written, a level on a `shell` step.
- `checkPermissions(workflow, registry)` makes the checks that need runners (AC-07: every runner of the chain for a written level; the `full` list; the facts of AC-08 for steps with no level). It is called by `validate`, `plan` and at the start of a run, not by `parseWorkflow`. The editor's check resource calls it
  when it has the catalog.
- Resolution (AC-01) happens once per agent step and its result is handed to every reader that reads `step.permissions` today: `effectiveGuards(step, resolved)` (chain.ts; it has no workflow argument today),
  `runAgent` (step-executor.ts), `summaryOfUse` (run-control/confirm.ts, which also gains `fullAccessSteps`), the validator's warnings, and `plan` in the CLI. `planForRole` is unchanged (AC-19).
- `effectiveGuards` (chain.ts) adds the implied `diff_within_scope` guard **in addition to** a declared one for a block that writes a level `read` or `edit` (AC-14), and none at `full`. A block with no level keeps today's rule.
- Answerers, advisors, panel members and a decider are called with a block set by the engine at `read` (AC-06; applies when those features land).
- `checkPermissions` also reports AC-18 (a step at `read` with `mcp`, an error; at `edit`, a note).
- The acknowledgement of `full` (AC-05) is a function the composition root gives the engine: `acknowledgeFullAccess(steps): Promise<'terminal' | 'run_option' | 'page' | 'refused'>`. The flag is `--allow-full-access[=page]`; the server
  passes `=page` after its confirmation, and the parent of the dashboard child asks at the terminal and passes the bare flag.
  A run with no such function and a `full` step refuses to start.

## `@indaba/runners`

Every built-in runner implements `PermissionCapable` with the table of spec C-03. For a step that writes a level a runner builds its arguments as `[...extraArgs, ...levelArgs]` (the level is last, so it wins) and does **not** use its
legacy default; for a step with no level it behaves as today: `ClaudeCodeRunner` keeps `['--permission-mode', 'acceptEdits']` and `CodexRunner` keeps `['--sandbox', 'workspace-write']` (spec C-01; their
removal is the next labelled minor). The comment of `AntigravityRunner` that edits are auto-approved is corrected. `AcpRunner`'s `decidePermission` gains a `level` parameter and the `full` path (allow every request, never "always"; the file server does not limit writes at `full`, AC-04).

## Workflow file

| Field | Where | Meaning | Default |
| :--- | :--- | :--- | :--- |
| `permissions.level` | step, role, `defaults.permissions` | `read`, `edit`, `full` (`ask` is reserved and rejected) | none: the runner keeps its behaviour of today (AC-08) |
| `permissions` (the whole block) | **role and `defaults` are new**; the step already has it | the step's block if there is one, else the role's, else `defaults`'s, whole (never merged) | none |

A parse error names the field path and why for: an unknown level; `edit` written without a non-empty `fs.write`; `read` written with `fs.write` or `terminal: allow`;
`full` written with `fs` or `terminal`; a level on a `shell` step; `level: ask` or `timeout_seconds` (reserved, with the message of AC-09). At `validate`/`plan`/run start: a written level that a runner
of the chain cannot honour (the runner, the level, the reason in plain words), `read` with `mcp`, and the facts of the spec (agent steps with no level and the default their runner applies, `full` steps).

## CLI

| Option | Meaning |
| :--- | :--- |
| `indaba run --permissions [<step>=]<level>` (repeatable) | an upper bound for this run; never raises a level (AC-12); a usage error when it does not apply to a step |
| `indaba run --allow-full-access[=page]` | the person's acknowledgement of AC-05 for a run with no terminal; `=page` is passed by the server after its confirmation |
| `indaba plan`, `indaba validate` | per step: the level or "the <runner> default", the mode and scope for each runner in the chain with the qualifier of AC-17, the `full` sentence (AC-04), the default fact of AC-08 |
| `indaba catalog` | each runner entry gains `permissions: Record<PermissionLevel, { mode, scope, note }>` (AC-16) |

A changed or new CLI option: minor, except as stated for the defaults.

## Span attributes

| Name | Value |
| :--- | :--- |
| `indaba.permissions.level` | the level written, or `default` |
| `indaba.permissions.mode`, `indaba.permissions.scope` | the enforcement words of the runner that ran it |
| `indaba.permissions.full_acknowledged` | `terminal`, `run_option` or `page`, on the task span, when a step is `full` |

New attributes: minor. (The event `PermissionDecided` belongs to the later `ask` spec.)

## Web contract (`@indaba/core` web-contract, `@indaba/server`, `@indaba/web`)

```ts
// CatalogEntry (web-contract/api.ts) gains an optional member; a client written before it ignores it.
//   readonly permissions?: Readonly<Record<PermissionLevel, { readonly mode: EnforcementMode; readonly scope: EnforcementScope; readonly note: string }>>;
```

`POST /runs` gains the optional body field `fullAccessConfirmedHash` and a response `409 full_access_required` with the `full` steps; `RunSummaryOfUse` gains `fullAccessSteps`. The web contract version moves by a minor. The form writes `permissions.level` through the existing edit resources, deleting the keys a preset forbids with one edit per path
(AC-16). The page's Run confirmation lists the `full` steps every time and passes `--allow-full-access` only after it (AC-05). The words (the refusal, the qualifier, the `full`
sentence) are in the page's message catalogue, keyed by the `note` ids.

## Changes to other specs (made when this one is accepted)

- `web-app-editing-forms`: AC-09 (the presets) maps to the levels and the old-style display (AC-16); the form shows the refusal and the qualifier (AC-17); the "Not set" help text, which says
  other runners are not limited, is replaced by the default fact of AC-08.
- `web-app-actions`: AC-03 (the body of `POST /runs`) gains `fullAccessConfirmedHash` and the 409; AC-13 (confirmations) gains the `full` list every time (AC-05).
- `workflow-editor`: the schema gains `permissions.level`, role and `defaults` permissions; the catalog gains the map (C-11); the comment on `catalog: 1` in `engine/editor/catalog.ts` is amended.
- `docs/workflow-format.md`: the Permissions section (the level, the table of C-03, what a step with no level does, the guard rule, the sentence about the scope being checked after the step).
- `docs/getting-started.md`: the runner table says what each runner does with each level.
- Not in this release: `agent-conversation` (the four deferrals that `ask` reverses), the README and the examples (they change in the release that removes the defaults, C-01).
