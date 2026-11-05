# Plan: step stalls, release 1 (`timeout_seconds`)

> Covers **release 1 only** (spec section 11). Release 2 (`stall`, its retry, `StallCapable`) is planned when its
> condition is met; its contract stays in `api-surface.md` and `events.md`. Paths below were read in the repository on
> 2026-11-05.

## Modules touched

| File | Change |
| :--- | :--- |
| `packages/core/src/workflow/model.ts` | `StepDefinition.timeoutSeconds?: number` (absent, never `undefined`, under `exactOptionalPropertyTypes`); `MAX_TIMEOUT_SECONDS = 86400`. `defineStep` needs no change: it spreads `init`. |
| `packages/core/src/mesh/runner-participant.ts` | `RunnerParticipantOptions.timeoutSeconds?: number`; `respond` adds it to the `RunRequest` only when set. |
| `packages/core/src/index.ts` | exports `MAX_TIMEOUT_SECONDS` (already re-exports the mesh and workflow modules; confirm). |
| `packages/engine/src/parser/parser.ts` | reads `timeout_seconds` (a whole number 1 to 86400) beside `isolation` (around line 290); the message in `api-surface.md`. The existing refusal inside `permissions` (line 414) is untouched (C-01). |
| `packages/engine/src/engine/step-executor.ts` | the effective limit of a step is `step.timeoutSeconds ?? this.timeoutSeconds`; used in `runShell` (line 250) and `runAgent` (line 315), and passed to `RunnerParticipant` in the debate branch (line 568). |
| `packages/engine/src/engine/workflow-engine.ts` | sets `indaba.step.timeout_seconds` on the step span (line 319) only when the step has the field. |
| `packages/engine/src/editor/schema.ts` | adds `timeout_seconds` to the step schema (what `indaba schema` prints). |
| `packages/cli/src/main.ts` | `plan` prints `timeout Ns` in a step's extras (around line 880) when set. |
| `docs/workflow-format.md`, `docs/playbook.md`, `docs/ai-playbook.md`, `docs/README.md`, `site/` page build, `llms.txt`, `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md` | documentation moves with the change (the docs-site rule). |

No new package, no new runtime dependency, no change in `@indaba/runners`: every runner already honours
`RunRequest.timeoutSeconds` (checked: `process-runner.ts`, `acp-runner.ts`, `openrouter-runner.ts`).

## Where the behaviour lives

The field is data on the step (pure domain, no `node:`). The precedence rule (step, then `--timeout`, then 900) is one
expression in the executor, which already receives the global option; the `900` default stays where it is
(`DEFAULT_TIMEOUT_SECONDS`). The parser validates the number before anything runs. The runners are untouched.

## Trade-offs taken

- **Debates get the step's limit but not the global one.** A debate does not use `--timeout` today (the participant sends
  no limit, so each runner applies 900). Extending the global to debates would change runs that work today; only a step
  that writes the field gets a new behaviour. Cost accepted: `--timeout 60` still does not bound a debate.
- **`timeout_seconds` is not refused anywhere except by range.** It is valid on shell, agent and debate steps (AC-14).
- **The limit is per call, not per step** (AC-02). A step that retries its runner chain, or a debate with many rounds, can
  take longer than the number. This is today's meaning of `--timeout` and the docs say so.

## Risks

| Risk | Mitigation |
| :--- | :--- |
| A workflow that has a `timeout_seconds` key today (the parser may ignore unknown keys, or reject them) changes behaviour | analysed 2026-11-05: the parser does not reject unknown step keys (`unknownKeys` is used only for the board block), so a file that already carries a `timeout_seconds` is silently ignored today and will start to apply. Accepted (it is what the author wrote); stated in the CHANGELOG. A test pins a file without the field to today's result (AC-20). |
| Reading `permissions.timeout_seconds` and `timeout_seconds` is confusing | the refusal message is unchanged; `workflow-format.md` says the two are different things (C-01). |
| `RunnerParticipant` is exported from `@indaba/core`; a new optional option is a minor | classified in `api-surface.md` (R1 surface); no existing field changes. |

## Out of scope for this change

Everything marked R2: `stall`, the retry and restore, `StallCapable`, `RunRequest.stallSeconds`, `RunResult.stalled`,
`STALL_EXIT_CODE`, the event and the status reasons; a "last activity" signal (spec section 11, open); live thinking for
`claude-code`; the follow-up of C-08; applying `--timeout` to debates.

## Release 2 notes (not planned yet)

- `claude-code` already reads `stream-json` by default; the activity signal would hook that stream.
- AC-17 asks each built-in runner to be classified; that table is written with release 2's plan, not now.
