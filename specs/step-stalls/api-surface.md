# API surface contract: step stalls

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it. An
> implementation that finds this wrong stops and returns to stage 3; it does not edit this file.

## Semver classification

**minor**

Reasoning: every addition is optional or a new export, and no default, event, span name, attribute name or field meaning that
exists today changes (see the classification table in the `api_surface` skill).

- New optional step fields (`timeout_seconds`, `stall`): "new workflow field that is optional" is a minor.
- A new optional runner interface (`StallCapable`), following `PermissionCapable` and `McpCapable`, rather than a new method
  on `Runner`: adding a method to an interface that third parties implement would be a major.
- New optional members of `RunRequest` and `RunResult`: a new optional property with absent-means-unchanged semantics is a
  minor. With `exactOptionalPropertyTypes` on, each is **absent**, never `undefined`.
- New span attributes and one new span event: additions only; none renamed.
- **No default changes.** A step with neither field runs with the command line, limit, result and attributes it has today
  (AC-20). The global limit stays 900 seconds.

Below 1.0 a minor is a minor; no changelog entry for a major is needed.

## Public symbols added

| Export (package, module) | Kind | Signature |
| :--- | :--- | :--- |
| `@indaba/core`, `workflow` | interface | `interface StallPolicy { readonly afterSeconds: number; readonly retries: number }` |
| `@indaba/core`, `workflow` | const | `MIN_STALL_SECONDS = 30`, `MAX_STALL_SECONDS = 3600`, `MAX_STALL_RETRIES = 3`, `MAX_TIMEOUT_SECONDS = 86400` |
| `@indaba/core`, `extension` | interface | `interface StallCapable { readonly canReportActivity: true }` |
| `@indaba/core`, `extension` | function | `function isStallCapable(runner: Runner): runner is Runner & StallCapable` |

`StallCapable` has one member and no method on purpose: the detection is the runner's own work inside `run`, driven by the
new `RunRequest.stallSeconds`. The marker lets `validate` refuse a mismatch before anything starts, which is all the
engine needs to know. A runner that implements it promises: when `stallSeconds` is set, it stops the attempt after that
many seconds without activity and returns a result with `stalled: true`.

## Public symbols changed

| Name | Before | After | Impact |
| :--- | :--- | :--- | :--- |
| `Step` (`@indaba/core`) | no time fields | `readonly timeoutSeconds?: number; readonly stall?: StallPolicy` | additive, optional; absent means today's behaviour |
| `StepInit` (`@indaba/core`) | no time fields | the same two optional members | additive, optional |
| `RunRequest` (`@indaba/core`) | `timeoutSeconds?: number` exists | adds `readonly stallSeconds?: number` | additive, optional; absent means no stall detection |
| `RunResult` (`@indaba/core`) | no `stalled` | `readonly stalled?: true` (present only when the attempt was stopped for silence); `RunResultInit` gains `stalled?: true` | additive; a consumer that ignores it sees an ordinary failed result (exit code 124 is **not** used; see below) |
| `WorkflowEngineOptions` / `StepExecutorOptions` (`@indaba/engine`) | `timeoutSeconds?: number` is the global limit | unchanged | the step's own field takes precedence in the executor (spec C-03); the option keeps its meaning |

A stalled result uses a new exit code, `STALL_EXIT_CODE = 125`, exported from `@indaba/runners` beside `TIMEOUT_EXIT_CODE`
(124) and `ABORT_EXIT_CODE`. A consumer that reads only `exitCode` sees a non-zero code and fails the attempt, as for
any failure; the reason text distinguishes it. Using a new code is additive: no existing code changes meaning.

## Removed or deprecated

None.

## Workflow schema, CLI, events and attributes

**Workflow file** (`version: "1.0"` is unchanged: both fields are optional additions):

```yaml
steps:
  - id: implement
    isolation: git_worktree
    timeout_seconds: 900          # optional, 1 to 86400: limit of each call or command of this step
    stall:                        # optional, agent steps only, not debates
      after_seconds: 300          # required, 30 to 3600: stop an attempt silent for this long
      retries: 1                  # optional, 0 to 3, default 0; above 0 needs isolation: git_worktree
```

Validation messages (exact texts are part of the contract; `N` is a number):

| Condition | Message |
| :--- | :--- |
| `timeout_seconds` not a whole number in 1 to 86400 | `step "<id>": timeout_seconds must be a whole number from 1 to 86400` |
| `stall` not a mapping, or unknown key | `step "<id>": stall takes after_seconds and retries only` |
| `after_seconds` missing or outside 30 to 3600 | `step "<id>": stall.after_seconds must be a whole number from 30 to 3600` |
| `retries` outside 0 to 3 | `step "<id>": stall.retries must be a whole number from 0 to 3` |
| `stall` on a shell step or a step with no agent | `step "<id>": stall needs an agent step` |
| `stall` on a debate step | `step "<id>": stall is not supported on a debate step in this version` |
| a runner of the chain is not `StallCapable` | `step "<id>": runner "<name>" cannot report activity, so stall cannot be used with it` |
| `retries` above 0 without a worktree | `step "<id>": stall.retries above 0 needs isolation: git_worktree` |

**CLI.** No new option and no changed option. `indaba run --timeout <secs>` keeps its meaning as the default for steps without
`timeout_seconds`. `indaba validate`, `plan` and `schema` report and describe the new fields; `plan` prints the limits of a
step that has them.

**Runner behaviour.**

- `claude-code` (`ClaudeRunner`) implements `StallCapable`. When `RunRequest.stallSeconds` is set it adds
  `--output-format stream-json --verbose` to its command line and reads the events as activity; the `RunResult` fields are
  the same as for the plain output (AC-16). When it is not set, the command line and result are unchanged.
- Every other built-in runner either implements `StallCapable` or is named in `plan.md` with the reason it does not (AC-17).

**Events and attributes.** In [`events.md`](events.md).

**Exit codes of the CLI.** Unchanged. A run that ends because a stalled step failed ends `failed` or `escalated` (exit 1 or
2) like any failed step.

## Compatibility statement

A consumer that does not use the new fields cannot observe the change (AC-20). A runner plugin written before this change
keeps compiling and running; it is refused only in a step that sets `stall` (AC-21).
