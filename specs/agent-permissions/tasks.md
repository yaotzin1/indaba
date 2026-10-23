# Tasks: Agent permissions

`ask` also needs the channel of `agent-conversation` (T-13); everything else stands on its own. The removal of the two hard-coded defaults and the absent-means-`read`
rule (T-08) are the breaking part and ship labelled.

## `@indaba/core`

- [ ] T-01. `PermissionLevel`, `EnforcementMode`, `EnforcementScope`, `PermissionCapability`, `PermissionCapable`, `isPermissionCapable`, `permissionCapabilitiesOf`,
  `StepPermissions.level?`, `RunRequest.permissionLevel`. Test: a runner without the contract supports no level and never throws.
- [ ] T-02. `resolvePermissions` (AC-01, whole-block, never merged) and `effectiveLevel` (AC-08, AC-13). Test: `defaults: full` with a step that has an `fs` block and no level
  resolves to the step's block, whose level is `edit`, not `full`; no block anywhere is `read`.
- [ ] T-03. `lowerLevel`, `applyBound` (AC-12) with its errors, `unsupportedBy` (AC-07), `describeEnforcement` (structured, C-10).

## `@indaba/engine`

- [ ] T-04. Parser: `level`, `timeout_seconds`, role and `defaults` permissions; every parse error of `api-surface.md` that needs no runner (AC-03). Tests on the block as written.
- [ ] T-05. `checkPermissions(workflow, registry)`: every runner of the chain, `ask` needs `acp`, the facts for `plan`/`validate` (AC-07, AC-08); called by `validate`, `plan` and run
  start; the editor's check calls it when it has the catalog.
- [ ] T-06. The guard rule: the implied `diff_within_scope` is added **in addition to** a declared one at `read`, `edit`, `ask`; none at `full` (AC-04, AC-14). Test: a loose
  declared guard does not weaken `fs.write`.
- [ ] T-07. Answerers, advisors, panel members and a decider are called at `read` whatever `defaults`/role/run option say (AC-06).
- [ ] T-08. **Breaking.** Remove the default `acceptEdits` and `workspace-write` and make an absent block `read` with the `read` arguments (AC-07, AC-08). Tests: a `claude-code`
  step with no `permissions` gets the `read` arguments; with `level: edit` it gets `acceptEdits`; `validate` prints the migration example for every agent step without a block.
  Update `README.md`, `docs/getting-started.md` and the examples named in C-01. Changelog entry labelled breaking.
- [ ] T-09. The acknowledgement of `full` (AC-05): the function the composition root gives the engine, the refusal to start without one, the trace attribute.

## `@indaba/runners`

- [ ] T-10. `PermissionCapable` for `claude-code`, `antigravity`, `codex`, `opencode`, `cursor`, API runners and `acp` with the table of C-03; for each argument marked *confirm*,
  a check against the installed CLI (and a run for what a flag does) or the level is `unsupported`. Arguments come first, `extraArgs` after. Correct the antigravity runner's comment.
- [ ] T-11. `permissionDenied` and `canRecogniseDenial` (AC-11): `antigravity` recognises the message of spec §1 (test strings built from fragments); the other CLI runners declare
  `canRecogniseDenial: false` until they can. The step failure with a fixed reason only under the conditions of AC-11; the agent's text is not in the reason or a span.
- [ ] T-12. `AcpRunner`: the `full` path of `decidePermission`; at `ask`, requests of AC-09 go to a `PermissionAsker`, a cut request offers only `deny`, with none it denies; the text
  builder cleans and cuts (20 paths, 200, 500).

## `indaba`, server, web and documentation

- [ ] T-13. `--permissions` and `--allow-full-access`; the terminal acknowledgement; the `PermissionAsker` wired to the channel (needs `agent-conversation`); denial when no person can
  be reached (AC-10).
- [ ] T-14. `indaba catalog` carries the map (AC-16); `@indaba/server` passes it through; `@indaba/web`: the presets and the old-style display, the key deletions when a preset
  changes, the refusal and the qualifier from the note ids, the `full` sentence, the Run confirmation listing `full` steps every time and passing `--allow-full-access` after it
  (AC-05, AC-16, AC-17). Coordinate with the page's answering slice (step 3e) for the display of an `ask` request.
- [ ] T-15. Span attributes and `PermissionDecided` (AC-15), with a test that no path, command or message is in a span, event or log line.
- [ ] T-16. The amendments to the other specs listed in `api-surface.md`, `docs/workflow-format.md`, `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md`. Fill `review.md`.
