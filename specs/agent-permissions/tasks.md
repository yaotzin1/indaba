# Tasks: Agent permissions

`ask` also needs the channel of `agent-conversation` (T-12); everything else stands on its own. The removal of the two hard-coded defaults
(T-07) is the breaking part and ships labelled.

## `@indaba/core`

- [ ] T-01. `PermissionLevel`, `Enforcement`, `PermissionCapability`, `PermissionCapable`, `isPermissionCapable`, `permissionCapabilitiesOf`,
  `StepPermissions.level`, `RunRequest.permissionLevel`. Test: a runner without the contract supports no level and never throws.
- [ ] T-02. `resolvePermissions` (AC-01) and `impliedLevel` (AC-13): defaults, role and step merge field by field; a block with no level is
  `edit` with a non-empty `fs.write` and `read` otherwise.
- [ ] T-03. `lowerLevel` and `unsupportedBy` (AC-06, AC-12); `describeEnforcement` (AC-08): fixed wording per enforcement, never "enforced" for
  `guard` without the qualifier.

## `@indaba/engine`

- [ ] T-04. Parser and validator: `level` on step, role and `defaults.permissions`, every parse error of `api-surface.md`, the check
  against every runner of the chain, the `shell` step refusal (AC-03, AC-04, AC-06).
- [ ] T-05. The guard rule: `diff_within_scope` for `read` (empty paths), `edit` and `ask` (the `fs.write` globs), none for `full`; a block
  without a level behaves as today (AC-04, AC-13).
- [ ] T-06. `plan`/`validate` text: the effective level, the enforcement per runner, the `full` sentence; the warning that has no
  `isolation: git_worktree` is kept.
- [ ] T-07. **Breaking.** Remove the default `acceptEdits` and `workspace-write` (AC-07). Tests: a `claude-code` step with no `permissions` is
  started with no permission argument; with `level: edit` it is started with `--permission-mode acceptEdits`; `validate` prints the
  migration line for a step that no longer can write (spec C-01). Changelog entry labelled breaking.

## `@indaba/runners`

- [ ] T-08. `PermissionCapable` for `claude-code`, `antigravity`, `codex`, `opencode`, `cursor`, API runners and `acp` with the table of C-03; for
  each argument marked *confirm*, a check against the installed CLI or the level is `guard`/`unsupported`. Arguments come first, `extraArgs` after.
- [ ] T-09. `permissionDenied` for `antigravity` (the message of spec §1) and any other runner whose CLI reports a headless denial; tests with the
  recorded message built from fragments (so the security audit stays quiet).
- [ ] T-10. The step failure of AC-11: a fixed reason with the level and the block to change, whatever the exit code; the agent's text is not in
  the reason or a span.
- [ ] T-11. `AcpRunner` at `ask`: requests outside the allowed set go to a `PermissionAsker`; with none, deny; "always" never offered (AC-09, AC-10).

## `indaba`, server, web and documentation

- [ ] T-12. `--permissions` and `--allow-full-access`; the once-per-run acknowledgement at a terminal and the refusal without one (AC-05, AC-12);
  the `PermissionAsker` wired to the channel (needs `agent-conversation`).
- [ ] T-13. `indaba catalog` carries the map (AC-15); `@indaba/server` passes it through; `@indaba/web`: the presets map to the levels, the
  refusal and the qualifier, the `full` sentence, the Run confirmation lists `full` steps (AC-15, AC-16, AC-05). Coordinate with the page's
  answering slice (step 3e) for the display of an `ask` request.
- [ ] T-14. Span attributes and `PermissionDecided` (AC-14), with a test that no path, command or message is in a span, event or log line.
- [ ] T-15. `docs/workflow-format.md`, `docs/getting-started.md`, `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md`; the changes to other specs listed in
  `api-surface.md`. Fill `review.md`.
