# Tasks: Agent permissions

This release needs nothing that is not implemented. `ask` is reserved (spec AC-09) and its work is a later spec. The removal of the two hard-coded defaults is **not** in this list: it is the next
labelled minor (spec C-01), listed under "Later".

## `@indaba/core`

- [ ] T-01. `PermissionLevel` (`read`, `edit`, `full`), `EnforcementMode`, `EnforcementScope`, `PermissionCapability`, `PermissionCapable`, `isPermissionCapable`, `permissionCapabilitiesOf`,
  `StepPermissions.level?`, `RunRequest.permissionLevel`. Test: a runner without the contract supports no level and never throws.
- [ ] T-02. `resolvePermissions` (AC-01, whole-block, never merged, agent steps only) and `effectiveLevel` (AC-08, AC-13). Test: `defaults: full` with a step that has an `fs` block and no level
  resolves to the step's block, not `full`; a step with no block and no level is `kind: default`.
- [ ] T-03. `lowerLevel`, `applyBound` (AC-12) with its errors, `unsupportedBy` (AC-07), `describeEnforcement` (structured, C-10), `Describes.permissions` (C-11). Tests for AC-12: a bound never raises; `--permissions full` over a step with
  no level changes nothing; `edit` lowered to `read` drops `fs.write` and the implied guard allows no change; a missing or shell step is a usage error; `read` on a runner that does not offer it is a usage error.

## `@indaba/engine`

- [ ] T-04. Parser: `level`, `timeout_seconds`, role and `defaults` permissions; every parse error of `api-surface.md` that needs no runner (AC-03). Tests on the block as written.
- [ ] T-05. Hand the resolved block of agent steps to every reader of `step.permissions` (`effectiveGuards`, `runAgent`, `summaryOfUse`, the validator, `plan`); a `defaults` block never reaches a shell step (test: `defaults` at
  `read` and a shell step that writes a file passes). `checkPermissions(workflow, registry)` (including AC-18): every runner of the chain for a written level, and the facts for `plan`/`validate` (AC-07, AC-08); called by `validate`, `plan` and run start; the
  editor's check calls it when it has the catalog.
- [ ] T-06. The guard rule: for a block that writes a level, the implied `diff_within_scope` is added **in addition to** a declared one at `read` and `edit`; none at `full`; a block with no level keeps
  today's rule (AC-04, AC-14). Test: a loose declared guard does not weaken a written `fs.write`.
- [ ] T-07. Consensus participants ignore role and `defaults` blocks (AC-19), with a test. (AC-06, the `read` of answerers and the rest, has no task here: it lands with `agent-conversation` and `review-gate`.)
- [ ] T-08. For a step that writes a level, the runner uses that level's arguments and not its legacy default; for a step that writes none it behaves exactly as today (tests: byte-identical arguments for `claude-code`
  and `codex` with no `permissions`). `plan` and `validate` state the default each such step uses and the one-line example (AC-08).
- [ ] T-09. The acknowledgement of `full` (AC-05): the function the composition root gives the engine, the refusal to start without one, the trace attribute.

## `@indaba/runners`

- [ ] T-10. `PermissionCapable` for `claude-code`, `antigravity`, `codex`, `opencode`, `cursor`, API runners and `acp` with the table of C-03; for each argument marked *confirm*,
  a check against the installed CLI (and a run for what a flag does) or the level is `unsupported`. Arguments: `[...extraArgs, ...levelArgs]`; test: `read` plus `extraArgs` carrying a permission flag yields the `read` argument. Correct the antigravity runner's comment.
- [ ] T-11. `permissionDenied` and `canRecogniseDenial` (AC-11): `antigravity` recognises the message of spec §1 (test strings built from fragments); the other CLI runners declare
  `canRecogniseDenial: false` until they can. The step failure with a fixed reason only under the conditions of AC-11; the agent's text is not in the reason or a span.
- [ ] T-12. `AcpRunner`: `decidePermission` takes the level; at `full` it allows every request (never "always") and the file server does not limit writes (AC-04). `summaryOfUse` and the trace views (`trace/plain.ts`, `trace/view.ts`)
  print `full`, not "write nothing".

## `indaba`, server, web and documentation

- [ ] T-13. `--permissions` and `--allow-full-access[=page]`; the terminal acknowledgement, the parent of the dashboard child asking and passing the flag, and the refusal without one (AC-05, AC-12). Tests: usage errors of AC-12;
  the acknowledgement does not carry over to a second run (AC-05); the dashboard (TUI) shows the `full` sentence (AC-04).
- [ ] T-14. `indaba catalog` carries the map (AC-16); `@indaba/server` passes it through and implements `fullAccessConfirmedHash` and `409 full_access_required` (AC-05); `@indaba/web`: `presetOf`/`presetValue` (today a block with a `level` is `custom`
  and `presetValue` writes only `fs`/`terminal`) and the shape check in `client.ts`; the presets and the old-style display, the key deletions when a preset changes, the refusal and
  the qualifier from the note ids, the `full` sentence, the default fact of AC-08, the Run confirmation listing `full` steps every time and passing `--allow-full-access` after it (AC-05, AC-16, AC-17).
- [ ] T-15. Span attributes (AC-15), with a test that no path, command or message is in a span, event or log line. Test of AC-11 under its conditions (declared output missing; empty diff with no outputs; the message quoted by a reviewer does not fail a step;
  a step on the runner default), and of AC-13 for the ACP gate and the guard (byte-identical behaviour for a block with no level).
- [ ] T-16. The amendments to the other specs listed in `api-surface.md`, `docs/workflow-format.md`, `docs/getting-started.md`, `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md`. Fill `review.md`.

## Later (not in this release)

- **The next minor, breaking and labelled (spec C-01):** remove the two hard-coded defaults and make an absent block `read`; update `README.md`, `docs/getting-started.md` and the examples that use
  `claude-code` or `codex` with no `permissions`; `validate` prints the migration line.
- **`agent-permissions-ask` (spec C-05):** the level `ask` for the `acp` runner, with the amendments to `agent-conversation`.
