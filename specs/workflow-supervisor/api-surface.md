# API surface contract: Workflow supervisor

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it. An
> implementation that finds this wrong stops and returns to stage 3; it does not edit this file.

## Semver classification

**minor** (below 1.0). Provisional until section 8 of the spec is confirmed.

Reasoning: one new command and new optional exports. No default changes, no existing command prints anything new, no existing type gains
a required member, no workflow field is added. `plan`, `validate`, `run`, `watch` and `ui` do not import the new module (AC-01). The JSON of
the report carries `schema` and `version`; a reader is told to ignore keys it does not know, so a later optional key is a minor.

## Public symbols added

| Export (package, module) | Kind | Signature |
| :--- | :--- | :--- |
| `@indaba/core`, supervisor/model | interface | `AdvisorInput { readonly explanation: PlanExplanation; readonly task: string; readonly repoFacts: RepoFacts; readonly stepText: readonly StepText[] }` |
| `@indaba/core`, supervisor/model | interface | `StepText { readonly stepId: string; readonly kind: 'shell' \| 'agent'; readonly commands: readonly string[]; readonly goal?: string }` (inputs left unresolved) |
| `@indaba/core`, supervisor/model | interface | `RepoFacts { readonly manifests: readonly ManifestFacts[]; readonly lockfiles: readonly string[]; readonly topLevel: readonly string[] }`; a fact that cannot be read is `{ unknown: reason }` |
| `@indaba/core`, supervisor/model | interface | `ManifestFacts { readonly file: string; readonly dependencies: readonly string[]; readonly scripts: readonly { readonly name: string; readonly command: string }[] }` |
| `@indaba/core`, supervisor/model | interface | `FailureDigest { readonly runId: string; readonly stepId: string; readonly runners: readonly string[]; readonly attempts: readonly AttemptFacts[]; readonly endedBy: EndedBy; readonly lastFailure: string; readonly explanation: PlanExplanation }` |
| `@indaba/core`, supervisor/model | union | `EndedBy`: `retries_exhausted`, `stalled`, `timed_out`, `debate_max_rounds`, `debate_stalled`, with the counts each carries |
| `@indaba/core`, supervisor/model | interface | `SupervisorReport { readonly schema: 'indaba.supervisor-report'; readonly version: 1; readonly phase: 'preflight' \| 'triage'; readonly workflow: string; readonly inputDigest: string; readonly findings: readonly Finding[]; readonly droppedUnsupported: number; readonly droppedDuplicate: number; readonly patch?: SupervisorPatch; readonly usage: UsageReport }` |
| `@indaba/core`, supervisor/model | interface | `Finding { readonly id: string; readonly severity: Severity; readonly step?: string; readonly anchor: string; readonly message: string; readonly evidence: readonly EvidencePointer[]; readonly edits?: readonly number[] }` |
| `@indaba/core`, supervisor/model | union | `Severity`: `info`, `warning`, `blocker_suggestion` |
| `@indaba/core`, supervisor/model | type | `EvidencePointer`: `explain:<step>.<setting>`, `digest:<field path>`, `repo:<fact path>`, `task`, `step:<id>.<field>` |
| `@indaba/core`, supervisor/model | interface | `SupervisorPatch { readonly edits: readonly ProposedEdit[]; readonly diff: string }` (the diff is computed by the program) |
| `@indaba/core`, supervisor/check | functions | `verifyEvidence`, `orderFindings`, `findingId`, `isDuplicateOfGap` (pure) |
| `@indaba/core`, supervisor/model | constants | `MAX_SUPERVISOR_INPUT_CHARS`, `MAX_TASK_CHARS`, `MAX_FINDINGS`, `MAX_MESSAGE_CHARS`, `MAX_PATCH_EDITS`, `MAX_REPO_TOP_LEVEL`, `MAX_REPAIR_CALLS` (values fixed at stage 3; not measured) |
| `@indaba/core`, assistant | interface and function | `ProposedEdit` and `classifyEdit`, **shared with `workflow-assistant`**: whichever feature is implemented first adds them, the other reuses them; neither redefines them |
| `@indaba/engine`, supervisor | functions | `buildRepoFacts(root)`, `buildAdvisorInput(...)`, `buildFailureDigest(record, stepId)`, `parseSupervisorReply(text)`, `applyPatchToCopy(text, edits)`, `renderUnifiedDiff(before, after)`, `superviseOnce(input, runner, options)` |
| `indaba`, supervise | functions (internal to the package) | `renderReportText`, `renderReportJson`, the confirmation prompts; not exported from the package index |

## Public symbols changed

| Name | Before | After | Impact |
| :--- | :--- | :--- | :--- |
| none | | | |

## Removed or deprecated

| Name | Replacement | Removed in |
| :--- | :--- | :--- |
| nothing | | |

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| CLI | `indaba supervise <file> [--goal <text> \| --goal-file <path>] [--profile <name>] [--json] [--show-input] [--apply]` | new command, phase 1 (names provisional, C-01 and C-02) |
| CLI | `indaba supervise <file> --run <id> [--step <id>]` | phase 2, after a failed run |
| CLI | `--yes` | **does not exist** and must not be added (AC-05, C-07) |
| JSON | `schema: "indaba.supervisor-report"`, `version: 1` | new contract (AC-12) |
| span | `indaba.supervisor` | new span |
| span attributes | `indaba.supervisor.phase`, `.profile_kind`, `.input_digest`, `.findings`, `.findings_dropped`, `.edits_proposed`, `.edits_accepted`, `.high_impact_accepted` | new; no text, path or key |
| workflow schema, events | none | no field is added; no event |
| manifest list read by `buildRepoFacts` | `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `composer.json` | a fixed list, extended only by a minor |

## Defaults introduced or changed

| Option | Old default | New default |
| :--- | :--- | :--- |
| none | | |

## Checks

- [ ] Every type appearing in a new public signature is itself public (or deliberately marked `@internal` and not re-exported from the package index)
- [ ] Implementations are not exported for subclassing; the extension point is an interface
- [ ] Collections are typed precisely and read-only where they are not mutated (`readonly T[]`, `Readonly<Record<string, V>>`)
- [ ] `pnpm qa` (Biome, `tsc` strict, Vitest) passes with no suppression comment
- [ ] A layers test fails if any module other than the `supervise` command imports the supervisor, and if the supervisor imports `WorkflowEngine`, `StepExecutor`, the runner registry, the permission resolution or a guard (AC-01, AC-03)
