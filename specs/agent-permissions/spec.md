# Specification: Agent permissions (what an agent may do without asking, chosen by the author)

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 (the decisions in section 8 are recommended; the maintainer confirms them)
> **Semver impact**: minor (an optional `permissions.level`, `permissions` on a role and in `defaults`, a runner capability contract, new span attributes, new
> run options). Nothing that exists changes behaviour in this release: the two hard-coded runner defaults stay until a step writes a level, and their removal is a
> labelled breaking change of a later minor (C-01). One exception, stated in the CHANGELOG: the parser ignores unknown keys, so a `permissions` block that a file already carries
> on a role or in `defaults` was inert and now takes effect.
> **Builds on**: the `permissions` block of [`docs/workflow-format.md`](../../docs/workflow-format.md#permissions) and the
> `diff_within_scope` guard it adds; [`specs/agent-conversation`](../agent-conversation/spec.md) (the channel and the person's
> answers; needed only by the later level `ask`, C-05); [`specs/web-app-editing-forms`](../web-app-editing-forms/spec.md)
> (the presets of the form).
> **Related, not part of it**: [`specs/review-gate`](../review-gate/spec.md) (a gate asks about the *work*; this asks about the
> agent's *actions*), `specs/agent-sandbox` (a container backend is a stronger boundary than any level here).

---

## 1. The problem

Whether an agent may write files, run commands or do anything it likes without anyone approving is the author's decision. Today Indaba
makes it for them, differently for every runner, in code:

- `claude-code` is started with `--permission-mode acceptEdits` and `codex` with `--sandbox workspace-write` whatever the workflow says
  (`claude-runner.ts`, `codex-runner.ts`); `opencode`, `cursor` and `antigravity` are started with no permission argument. The author cannot
  see or change this from the workflow file; only code that constructs the runner can (`extraArgs`).
- The `permissions` block (`fs.read`, `fs.write`, `terminal`) is enforced while the agent works only by the `acp` runner. For the
  command-line runners it is a guard that looks at the working directory **after** the step. The documentation says so, and the editor's
  presets ("Read only", "Edit only these folders", "Full access") do not.
- A command-line agent that is refused a permission in headless mode cannot ask. The `antigravity` CLI prints that a tool "required the
  write_file permission that headless mode cannot prompt for" and **exits 0**; the step is reported as having run, and the missing file is
  found by a guard minutes later, with no reason.
- There is no way to say "ask me before it does that", and no deliberate way to say "do not ask me at all".

The author must be able to choose, in the workflow file, between a read-only agent, an agent that edits where they say, an agent whose
risky actions are put to a person, and an agent with no limits, knowing which of those Indaba can enforce, and when, for the runner they
chose. The maintainer's rule behind this (recorded here because no other document holds it): **no permission default is hard-coded in a runner; the level comes from
the workflow, written by a person.** This release applies it to every step that writes a level, and says plainly, for every step that does not, which
default the runner applies; it does not yet remove the two defaults that exist (C-01).

## 2. User stories

- **US-01.** As a workflow author, I set how much a step's agent may do, in the file, and Indaba never widens it for me.
- **US-02.** As a workflow author who wants full autonomy, I can choose it deliberately, and every run that uses it says so and asks me once.
- **US-03.** As a workflow author, I am told, before the run, which layer enforces my choice for each runner: the CLI itself, the ACP gate, or
  only a check after the step; and I am refused a choice that the runner cannot honour at all.
- **US-04.** As a person running a workflow that asks before acting, I see what the agent wants to do and decide, and nothing is allowed "always".
- **US-05.** As a person who is not a developer, I choose among plain names in the editor, and the page shows what each means for the
  runner that is selected.
- **US-06.** As a person reading a run, a refused permission is a step that failed with a reason, not a step that ran.

## 3. Acceptance criteria

Terms. A **level** is one of `read`, `edit`, `full` (AC-02); `ask` is reserved (AC-09). Enforcement has two parts. The **mode** is what makes the level true while
the agent works: `native` (the agent's own CLI refuses), `acp` (Indaba's permission gate answers the agent's requests), `after` (the runner has no
mode of its own for the level, so only the scope guard checks, after the step), `none` (nothing limits the agent: the level `full`) or `unsupported`
(the runner cannot honour the level at all). The **scope** is what holds the `fs.write` globs and
`terminal`: `acp` (the gate refuses a request outside them as it is asked, over ACP only), `guard` (a check of the working directory after
the step; it holds for every runner), or `none` (at `full`). A command-line runner's native mode confines the agent to its workspace, not to
the globs (C-03); the globs and `terminal: deny` are held for it by the guard only.

**The field, the layers and the absent case**

- [ ] AC-01. `permissions` (a step's block) gains an optional `level`, and the block becomes valid on a role and in `defaults`. The three places
  are **not merged**: the effective block is the one of the step if it has one, else the role's, else `defaults`'s, whole. (The parser cannot
  tell an absent `fs` from an empty one, and a weaker layer must never widen a stronger one.) A run option may lower the effective level but
  never raise it (AC-12). A block with no `level` keeps working as before (AC-13). Resolution applies **only to agent steps**: a `shell` step and a debate's participants never receive a role's or
  `defaults`'s block (AC-03, AC-19). Every place that reads a step's permissions today (`effectiveGuards`, the runner call, `summaryOfUse`, the validator, `plan`) reads the resolved block (`api-surface.md`).
- [ ] AC-02. The levels are:
  - `read`: the agent may read; it may not change files or run commands. A runner that has no mode of its own for it (only the check after the step) does not offer it (C-03).
  - `edit`: the agent may change files that match `fs.write`, and run commands only if `terminal: allow`; anything else is refused.
  - `ask`: reserved for a later version (AC-09). Writing it is an error that says so.
  - `full`: no limit from Indaba and no approval asked. The author chose it (AC-04).
- [ ] AC-03. For a block that **writes** a `level`: `edit` requires a non-empty `fs.write` ("edit needs the folders it may change"); `read` forbids `fs.write` and
  `terminal: allow`; `full` forbids `fs` and `terminal` (AC-04). These rules are checked on the block as written, never on a merged result. A block that does not
  write a `level` is not held to them (AC-13). A level on a `shell` step is an error: shell steps run the commands the author wrote; a `defaults` or role block is simply not applied to them (AC-01). A level on a step whose runners are
  API-only and that has no `mcp` list (AC-18) is allowed and satisfied by `native`.
- [ ] AC-04. `full` does not add the `diff_within_scope` guard, sends the runner no `fs`/`terminal` limits (for `acp`: the gate allows every request and its file server does not limit writes, so the agent's
  own tools and the gate both act freely; `request.permissionLevel` is the one channel, and `decidePermission` takes the level), is described as `full` and never as "write nothing" by `summaryOfUse` (`packages/cli/src/run-control/confirm.ts`; its result type `RunSummaryOfUse` is in `@indaba/core` web-contract), is shown by `plan`, `validate`, the dashboard and the page in plain words ("this
  step's agent can change anything and run anything and nobody approves it"), and is never the effect of an absent field (AC-08).
- [ ] AC-05. A run whose effective permissions include `full` on any step asks the person, once per run, before the first step, at a terminal: it names
  the steps and the runner of each and waits for a yes. Without a terminal the run refuses to start with a usage error naming the steps, unless
  the run option `--allow-full-access` is given (which is the person's acknowledgement). The page's Run action lists the same steps in its confirmation **every time it starts a run, whether or not the file's hash was confirmed before**. The request of `POST /runs` gains
  `fullAccessConfirmedHash` (the content hash the person saw, with the steps listed); a run whose file has a `full` step and no matching value is refused with `409 full_access_required` carrying the
  step list (the `RunSummaryOfUse` of `confirm.ts` gains `fullAccessSteps`), and with a matching value the server starts the child with `--allow-full-access=page` (`web-app-actions` AC-03 and AC-13 are
  amended). When `indaba run` re-spawns itself for the dashboard, the parent asks at the terminal and the child receives `--allow-full-access`. The acknowledgement is recorded on the task span as
  `indaba.permissions.full_acknowledged` (`terminal`, `run_option` for the bare flag, `page` for the value `page`). It never carries over to another run.
- [ ] AC-06. **Applies when `agent-conversation` and `review-gate` are implemented; it has no test in this release.** Answerers, advisors, panel members and a decider (`agent-conversation` AC-53, `review-gate`) always run at `read`, whatever any
  `defaults`, role or run option says. Their block is set by the engine for the call and is not resolved from the layers of AC-01.

**What a runner can do, and what is checked when**

- [ ] AC-07. A runner declares, per level, its mode and the scope it can hold, through the contract `PermissionCapable` (`api-surface.md`); the built-in table is in C-03. A step that
  writes a level is checked against **every runner in its chain** (the list of fallbacks): a level that any of them cannot honour (`unsupported`) is an error naming the runner, the level
  and, in plain words, why. The check needs the registry of runners, so it is made by `validate`, `plan` and at the start of a run, and by the editor's check when it has the catalog
  (AC-16); the parser, which has no runners, does not make it. The runner turns a written level into its own arguments, which come **last**: `[...extraArgs, ...levelArgs]`, and when a level is written the permission flags of the agent are removed from `extraArgs`
  (`--permission-mode`, `--mode`, `--sandbox`, `--auto`, the skip-permissions flags), because a later flag does not cancel a bare one such as `--dangerously-skip-permissions`; so an embedder's `extraArgs` can never widen a written level. Today `extraArgs` replaces a runner's legacy default; with a written level it is kept and the level wins. The two legacy defaults (C-01) apply only to a step that writes no level and are replaced, not added to, by a written one.
  **What the guard holds.** The scope guard reads the tracked and the untracked, not-ignored paths of the step's working tree after the step (`git status`). It does not see a command that ran, a path git ignores
  (`dist/`, `node_modules/`) or a write outside the working tree, so it holds the `fs.write` globs only for paths git shows and does not hold `terminal` at all. A level whose meaning depends on holding `terminal` or on stopping
  the agent while it works is offered only by a runner whose own mode does so (C-03): otherwise it is `unsupported`; and `edit` on a runner whose commands are not limited carries the note id `commands_not_limited` (AC-17).
- [ ] AC-08. **A step that writes no level keeps its runner's behaviour of today**: `claude-code` starts with `--permission-mode acceptEdits`, `codex` with `--sandbox workspace-write`, the others with
  no permission argument, `acp` refuses what a missing block refuses. Indaba does not hide it: `plan` and `validate` state, for every agent step with no level, "this step uses the built-in default of
  the <runner> runner (<what it allows>), not a level you chose; add `permissions` with a `level` to choose", with the one-line example of C-01. A later labelled minor makes an absent block `read`
  (C-01).
- [ ] AC-09. The level `ask` is **reserved**. Writing `level: ask`, or `timeout_seconds` on a permissions block, is an error saying, in plain words, that this version cannot ask a person about an agent's
  actions yet. Nothing in this release puts an agent's permission request to a person. The design for the later version is kept in C-05 so that nothing agreed is lost.
- [ ] AC-10. Reserved, with AC-09: this number is left unused so that the references of the other specs do not move.

**A refused permission is a failure with a reason**

- [ ] AC-11. A runner declares `permissionDenied(output)`, which recognises, from the agent's final output, that a permission it needed was refused in
  headless mode (for `antigravity`: the message quoted in section 1). A step fails with a fixed reason that names the level in force and the block to
  change only when the runner recognises the message, the exit code is 0, **and** a level is in force (`read`, `edit`, or a step on the runner's default, where the reason names "the <runner> default") **and** a declared output is missing or, when the step declares no outputs, the
  worktree diff is empty (so a reviewer that quotes the message is not failed). It is evaluated for each attempt, for the runner of the chain that ran it. The test is: a step whose output contains the recorded message, exit 0, a declared output missing, fails with the fixed reason; the same output with the output present passes. The message is
  the one observed once from `agy -p` on 2026-10-23 (section 1) and is kept as a test fixture built from fragments. The text of the agent's message is not copied into the reason
  or any span. A step that failed this way is an ordinary failure for `on_failure`. A built-in CLI runner that cannot recognise a refusal says so in `plan`
  ("a refused permission cannot be told from success for this runner"); no front end implies otherwise.

**Run options, compatibility and guards**

- [ ] AC-12. `indaba run --permissions <level>` (optionally `<step>=<level>`, repeatable) sets an upper bound for this run: for a step that **writes** a level, the effective level is the lower
  of the file's and the option's, in the order `read` < `edit` < `full`. It can never raise a level and never writes the file. Lowering `edit` to `read` drops its `fs.write` and the implied guard then allows no change at all. Every bound that applies to a step is applied and the lowest wins; a bound of `edit` over a step at `full` gives `read`, because `full` names no folders for `edit` to allow (AC-03).
  A step with no level (the runner's default) is affected only by a bound of `read`, which gives it the `read` arguments; any other bound over it changes nothing, and `plan` says so for the step. A bound applies to agent
  steps only. A usage error names the step and why when: the named step does not exist or is not an agent step; or a runner of the step's chain cannot honour the resulting level (`--permissions read` is the dry-run switch
  where every runner offers `read`).
- [ ] AC-13. A block with no `level` is read as before and **behaves as before**: its implied level (`edit` if `fs.write` is non-empty, `read` otherwise) selects nothing new, the runner keeps the behaviour of
  AC-08, and the ACP gate and the guard act as they do today. The implied level is used only to describe the step in `plan`.
- [ ] AC-14. For a block that writes a `level`, a declared `diff_within_scope` guard no longer replaces the one the block implies (`chain.ts`): both apply at `read` and `edit`, so a loose declared
  guard cannot weaken the author's `fs.write`. At `full` neither is added unless declared. A block with no level keeps today's rule (AC-13).

**The record**

- [ ] AC-15. The step's span carries `indaba.permissions.level`, `indaba.permissions.mode` and `indaba.permissions.scope` (the enforcement words above), or `indaba.permissions.level: default` when no level was written. No path,
  command or message of the agent is in a span, an event or a log line.

**What the editor and the page show**

- [ ] AC-16. The runner catalog (`indaba catalog`, `specs/workflow-editor`) lists, per runner and level, the mode, the scope and a machine-readable note id
  (`permissions: { read: { mode, scope, note }, ... }`), not English text: each front end owns its words (`web-app-actions` AC-14). A front end does not hard-code which
  runner can do what. The editor's presets map to the file as follows. *Read only* writes `{ level: read }`. *Edit only these folders* writes
  `{ level: edit, fs: { write: [...] } }`. *Full access* writes `{ level: full }`. *Ask me* is not offered in this version.
  A block of the old shape (`fs.write` and `terminal` only, with no `level`) that equals an old preset is still shown under that preset's name, marked "old style", and
  is rewritten to the new shape only when the person changes it; the old *Full access* (`write: ["**"]`, `terminal: allow`) is shown as "old style Full access" and is **not**
  `level: full` (it keeps the guard). Switching presets deletes the keys the new shape forbids, one edit per path. Any block that matches none is *Custom* and is kept
  as it is.
- [ ] AC-17. When the person picks a level that the selected runner cannot honour, the editor refuses it in plain words from the note id of AC-16; where the mode or the scope
  is not `native`/`acp` it shows the qualifier ("checked after the step, not while it works") and, for the note id `commands_not_limited`, "commands the agent runs are not limited". Choosing *Full access* shows the sentence of AC-04. The form still writes no
  level unless the person picks one.

**Other ways an agent can act, and the debate**

- [ ] AC-18. An MCP server a step lists (`mcp`) acts with its own rights, whatever the level. A step that writes `read` and has a non-empty `mcp` list is an error ("a read-only agent that is
  given a tool server is not read-only"); one that writes `edit` gets a note in `plan` and `validate`; at `full` there is none. A step on an API-only runner counts as unable to act only when it has no `mcp` list.
- [ ] AC-19. The participants of a consensus step ignore role and `defaults` blocks and get no permissions block, as today (`planForRole`): this release does not change what they may do. A role at `full` that only a
  debate uses does not enter the list of AC-05. Making them `read` belongs to the release that removes the defaults (C-01).

## 4. Non-goals

- A list of allowed or forbidden tools (for example `--allowedTools`), network limits, or per-command rules. A level is coarse on purpose; finer control is `fs.write` and `terminal`.
- A container or other sandbox: `specs/agent-sandbox`. This spec says what Indaba asks the agent's runner to do and what it checks.
- Asking a person about an agent's actions (the level `ask`): reserved (AC-09), designed in C-05.
- Authenticating who writes into the channel of `agent-conversation`; this spec does not use the channel in this version.
- Anything that depends on the agent mesh (debates, consensus, a panel). Answerers, advisors and panel members of other specs always run at `read` (AC-06) whether or not that feature is installed.
- Remembering a decision across runs.
- Choosing the level for the author. Indaba states facts about enforcement and does not recommend a level.
- Permissions of a debate's participants: unchanged in this release (AC-19); making them `read` belongs to the release that removes the defaults (C-01).

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| a written level that a runner of the chain cannot honour | error naming the runner, the level and why, at `validate`, `plan` and run start (AC-07) |
| `edit` without `fs.write`, `read` with `fs.write`, `full` with `fs`, `level: ask` | error on the block as written (AC-03, AC-09) |
| a level on a `shell` step | error (AC-03) |
| no level on an agent step | the runner's behaviour of today; `plan` says which (AC-08) |
| `full` and no terminal and no `--allow-full-access` | the run refuses to start (AC-05) |
| `full` and the person says no | the run does not start |
| an agent is refused a permission in headless mode and exits 0 | the step fails with the fixed reason, if the runner recognises it (AC-11) |
| the agent writes outside `fs.write` anyway (CLI runner at `read` or `edit`) | the guard fails the step after it ran (AC-14); the files stay in the worktree |
| `--permissions` names a level above the file's | the lower one is used; no error |
| `--permissions` names a step that is missing or not an agent step, or the lowered level is unsupported by a runner of its chain | usage error naming the step (AC-12) |
| a step with a non-empty `mcp` list | `read`: error; `edit`: a note in `plan`/`validate` (AC-18) |
| a plugin runner declares no `PermissionCapable` | it supports no level; a step that writes a level and can use it is an error (C-04) |
| an answerer, advisor or panel member of another spec | always `read` (AC-06) |

## 6. Security and data handling

- The level is the author's, and nothing widens it: not the runner, not a weaker layer (the three places are not merged, AC-01), not a run option (AC-12: it only lowers a written level), not the agent, not an answerer or
  panel (always `read`, AC-06). A model's text never changes a level.
- `full` is deliberate and visible: a plain sentence in four places (AC-04), a once-per-run acknowledgement (AC-05) and a trace attribute. It cannot be turned on by a run option, by a
  weaker layer over a stronger one, or by the editor without the person choosing it. A workflow downloaded, copied from the registry or generated that contains `full` is stopped by the
  acknowledgement.
- For a command-line runner, the scope (the `fs.write` globs and `terminal: deny`) is held by the guard **after** the step, and the mode confines the agent only to its workspace (AC-07,
  C-03). The agent may have written, or run a command, before the check. The `isolation: git_worktree` rule of the existing documentation still applies and `validate` still warns without it.
  This spec claims no more than that.
- An MCP server acts with its own rights, whatever the level (AC-18). The scope guard sees only what git shows in the working tree (AC-07).
- A step that writes no level keeps a runner default that may allow edits; `plan` says so for every such step (AC-08), so the absence of a choice is visible, not silent.
- A refused permission is reported with a fixed reason and the level, never with the agent's text (AC-11, AC-15).
- No secret, path or command text is in a span, event or log line (AC-15).

## 7. Where it lives

- `@indaba/core` (pure): `PermissionLevel`, `PermissionMode`-style enforcement words, `PermissionCapability`, `PermissionCapable`, `StepPermissions.level`, `resolvePermissions` (AC-01), `impliedLevel` (AC-13), `lowerLevel` (AC-12), `unsupportedBy` (AC-07), `describeEnforcement` (structured, C-10),
  `RunRequest.permissionLevel`, and, in `@indaba/engine`, `Describes` (editor/catalog.ts) gaining an optional `permissions` member for runners (C-11).
- `@indaba/engine`: parser (the field, role and `defaults` blocks), the checks at `validate`/`plan`/run start with the registry, the guard rule (AC-04, AC-14), the
  `plan`/`validate` text, the `full` acknowledgement hook, `--permissions` resolution, the answerers' `read` (AC-06).
- `@indaba/runners`: every built-in runner implements `PermissionCapable` (the arguments for a written level and `permissionDenied`); the `full` path of `decidePermission`. The two hard-coded
  defaults stay for a step with no level (C-01).
- `indaba` (CLI): `--permissions`, `--allow-full-access`, the acknowledgement prompt, the `catalog` fields.
- `@indaba/server`, `@indaba/web`: the catalog fields, the presets and the refusal text, the page's Run confirmation and its passing of `--allow-full-access`.

## 8. Clarifications

All of these are **recommended; the maintainer confirms**.

- **C-01. The defaults: kept for one release, then removed.** The rule of section 1 says that no permission default is hard-coded in a runner. Two exist (`acceptEdits` for `claude-code`, `workspace-write` for
  `codex`), and removing them, with "an absent block means `read`", would stop every existing agent step with no `permissions` from editing: a changed default, which is a major (below 1.0, the next
  minor, labelled). **This release keeps them, for a step that writes no level**, and makes them visible instead (AC-08): `plan` and `validate` say which default each step uses and how to choose. A step that
  writes a level never uses them. **The next minor** removes the two defaults and makes an absent block `read` for every runner, with a changelog entry labelled breaking and the one-line migration
  `permissions: { level: edit, fs: { write: ["src/**"] } }`; what it will break is already known and is the work of that release: agent steps with no `permissions` in `README.md`, `docs/getting-started.md` and the
  examples `task-pipeline`, `mcp` and `review-debate`; a legacy block with an empty `fs.write` on a CLI runner; debate participants (they get no permissions today); and a migrated workflow whose runner
  cannot recognise a refusal (AC-11) and so "runs and edits nothing" without an error. The maintainer chose this order on 2026-10-23 over removing the defaults now.
- **C-02. Why these levels.** They are the things a person can mean: *look*, *change files where I said*, *do what you like*, and, later, *ask me*. Finer control exists (`fs.write`,
  `terminal`) and is kept. `ask` will be a level, not a flag, because it changes who decides.
- **C-03. The built-in table.** What is **verified** was read from the installed CLI on 2026-10-23 with `--help`; what is marked *confirm* must be checked against the CLI
  (and, for what a flag does, run) at implementation, and a level whose argument cannot be confirmed is `unsupported`, never a guess. The scope of a command-line runner is
  `guard` at every level but `full`; the mode only confines the agent to its workspace or mode. `codex` at `edit` runs commands inside its sandbox whatever `terminal` says: it carries the note
  `commands_not_limited` too.

  | Runner | `read` | `edit` | `ask` | `full` |
  | :--- | :--- | :--- | :--- | :--- |
  | `claude-code` | native, `--permission-mode plan` (confirmed 2026-10-24: a run asked to create a file did not, and wrote its plan to its own folder outside the workspace) | native, `--permission-mode acceptEdits` (as today) | unsupported (`--permission-prompts host` is a later piece) | native, `--permission-mode bypassPermissions` (exists) |
  | `antigravity` | native, `--mode plan` (confirmed 2026-10-24: a run asked to create a file did not, and wrote its plan to its own folder outside the workspace) | native, `--mode accept-edits` (confirmed 2026-10-23: a headless write needs it) | unsupported | native, `--dangerously-skip-permissions` (exists) |
  | `codex` | native, `--sandbox read-only` (*confirm*) | native, `--sandbox workspace-write` (as today) | unsupported | native, `--sandbox danger-full-access` (*confirm*) |
  | `opencode` | unsupported (no read-only argument; the guard cannot stop a command) | after, note `commands_not_limited` | unsupported | native, `--auto` (exists) |
  | `cursor` | unsupported | after, note `commands_not_limited` | unsupported | unsupported until an argument is confirmed |
  | `acp` | acp | acp | acp | acp (the gate allows every request, never "always") |
  | API runners (`openrouter`, OpenAI-compatible) | native (they cannot act, unless the step has `mcp`: AC-18) | native | unsupported | native |
  | `shell` | not applicable (AC-03) | | | |

  For `opencode` and `cursor` no read-only or edit-only argument was found in `--help`. Their `read` is therefore `unsupported` (the guard cannot hold "no commands", AC-07): a step that writes `read` on them is an error that says so
  and names `acp` with `agent: opencode` as the way, which the documentation already recommends. Their `edit` has mode `after`: the runner is started with no permission argument and only the guard checks, after the step, which `plan` says
  with the note `commands_not_limited` (AC-17). `antigravity` also has `--sandbox` ("terminal restrictions"), not used here; its runner comment, which says
  that edits are auto-approved, was contradicted by one headless run on 2026-10-23 (an observation, not a survey) and is corrected in the same change.
  The `ask` column is the design for the later version (C-05); in this version `ask` is reserved and no column entry is used.
- **C-04. A plugin runner** that does not implement `PermissionCapable` supports no level: a step that names a level and can use it is an error, and a step with no level keeps whatever the plugin does (AC-08: nothing is
  hidden), which `plan` says Indaba cannot describe for it; once the defaults go (C-01) an absent block means `read` and the plugin's inability to enforce it is stated. Implementing the contract is how a plugin takes part; there is no privileged path for a built-in (extensibility rule).
- **C-05. `ask` is deferred; the design is kept.** The maintainer deferred it on 2026-10-23 to keep this release to what stands on its own. What was agreed, for the later spec `agent-permissions-ask`:
  the runner must be `acp`; a request for a command, a fetch or any other action that is not a file operation is put to a person with *allow once* and *deny*, never "always"; a file change outside `fs.write`,
  anything under `.git` or `.indaba`, and a command nobody can be asked about are denied without asking, because the file server of the gate refuses them whatever a person says; a request whose text had to be
  cut (200 characters per path, 500 for a command, at most 20 paths) is shown as cut and offers only *deny*; nobody answering is a denial, never an allow, and there is no `if_nobody` field because there is only
  one value; `timeout_seconds` is the person's time only and the step's own runner timeout is not paused; the text is chosen by the agent and is cleaned and shown as text; the channel of `agent-conversation`
  is not authenticated and the agent's own process may be able to answer its own request, which `plan` and `validate` would state. It reverses four deferrals of `agent-conversation` (AC-43, its non-goal on
  answering ACP permission requests with a person, C-01(b), C-15(2)) and adds the permission request to its closed list of channel kinds (C-14, AC-57, `data-model.md`). `web-app-actions` AC-13 does not
  change for `ask`. The `ask` request is shown in the answering slice of the page (`web-app` step 3e).
- **C-06. The acknowledgement of `full`.** The author already chose `full` in the file; the acknowledgement guards against a file the person did not write or read (a
  workflow downloaded, copied from the registry, generated). It is a prompt, not a policy.
- **C-07. Numbers that are guesses.** The 4096 characters at each end of the output that `permissionDenied` reads are a design choice that is not measured; it is named in `api-surface.md` and revised when
  real runs exist. (The numbers for `ask` are in C-05 and belong to the later spec.)
- **C-08. A lesson from the review of `review-gate`.** The line between "enforced while it works" and "checked afterwards" is stated, not implied (AC-07, AC-17), and a refusal that a model can influence
  must never become an approval (this is why `ask` nobody-answers is a denial, C-05).
- **C-09. `StepPermissions` becomes optional-field.** Today `parsePermissions` fills `fsRead: []`, `fsWrite: []` and `terminal: deny` for absent keys, so an absent field cannot be
  told from an empty one. With the layers not merged (AC-01) that does not matter for resolution, but `level` is optional and the editor must tell a written `terminal: deny` from
  none. The new member is optional (`level?`); the existing three keep their required types and their present filling. This is the only change to `StepPermissions`, and it is
  a minor.
- **C-10. Words belong to the front end.** Core returns structured descriptions (a runner, a level, a mode, a scope, a note id), the CLI renders them in English, and the page renders
  them from its message catalogue (`web-app-actions` AC-14).
- **C-11. The catalog member.** `catalogOf` reads only `Describes.describe()` (in `@indaba/engine`, `editor/catalog.ts`: a name and a description; the core type `Described` is not changed) and rebuilds each entry. `Describes` gains an optional `permissions` member that only runners provide, and `clean()` keeps it. The new
  member is additive and optional, so `catalog` stays at `1`; the comment in `engine/editor/catalog.ts` ("a change of shape raises it") is amended to say an optional member does not. The maintainer confirms this reading.

## Artifacts not written

- `plan.md`: `tasks.md` is the order of work; the hooks are in the runners and the engine's validator.
- `research.md`: the one external fact, the CLI flags, is in C-03 with what was verified and what was not.
- `data-model.md`: no stored format of its own.
- `events.md`: this release adds no event; `PermissionDecided` belongs to the later `ask` spec (C-05).
