# Specification: Agent permissions (what an agent may do without asking, chosen by the author)

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 (the decisions in section 8 are recommended; the maintainer confirms them)
> **Semver impact**: **breaking for one default** (C-01), and for the optional members of `StepPermissions` (C-09); everything else is a
> minor (an optional `permissions.level`, `permissions` on a role and in `defaults`, a runner capability contract, new span attributes,
> new run options). Below 1.0 the breaking part takes the next minor and is labelled as such in the changelog.
> **Builds on**: the `permissions` block of [`docs/workflow-format.md`](../../docs/workflow-format.md#permissions) and the
> `diff_within_scope` guard it adds; [`specs/agent-conversation`](../agent-conversation/spec.md) (the channel and the person's
> answers, for the `ask` level; this spec reverses three of its deferrals, C-05); [`specs/web-app-editing-forms`](../web-app-editing-forms/spec.md)
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
chose. The maintainer's rule behind this (recorded here because no other document holds it): **no permission default is hard-coded in a
runner; the level comes from the workflow, written by a person, and when it is absent the most restrictive one applies.**

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

Terms. A **level** is one of `read`, `edit`, `ask`, `full` (AC-02). Enforcement has two parts. The **mode** is what makes the level true while
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
  never raise it (AC-12). A block with no `level` keeps working as before (AC-13).
- [ ] AC-02. The levels are:
  - `read`: the agent may read; it may not change files or run commands.
  - `edit`: the agent may change files that match `fs.write`, and run commands only if `terminal: allow`; anything else is refused.
  - `ask`: as `edit`, except that the actions listed in AC-09 are put to a person instead of being refused.
  - `full`: no limit from Indaba and no approval asked. The author chose it (AC-04).
- [ ] AC-03. For a block that **writes** a `level`: `edit` and `ask` require a non-empty `fs.write` ("edit needs the folders it may change"); `read` forbids
  `fs.write` and `terminal: allow`; `full` forbids `fs` and `terminal` (AC-04). These rules are checked on the block as written, never on a merged
  result. A block that does not write a `level` is not held to them (AC-13). A level on a `shell` step is an error: shell steps run the commands
  the author wrote. A level on a step whose runners are API-only (they cannot touch files) is allowed for `read`, `edit` and `full` and satisfied by
  `native`.
- [ ] AC-04. `full` does not add the `diff_within_scope` guard, is shown by `plan`, `validate`, the dashboard and the page in plain words ("this
  step's agent can change anything and run anything and nobody approves it"), and is never the effect of an absent field (AC-08).
- [ ] AC-05. A run whose effective permissions include `full` on any step asks the person, once per run, before the first step, at a terminal: it names
  the steps and the runner of each and waits for a yes. Without a terminal the run refuses to start with a usage error naming the steps, unless
  the run option `--allow-full-access` is given (which is the person's acknowledgement). The page's Run action lists the same steps in its confirmation
  **every time it starts a run, whether or not the file's hash was confirmed before**, and passes `--allow-full-access` to the child only after that
  confirmation (`web-app-actions` AC-13 is amended, C-05). The acknowledgement is recorded on the task span as `indaba.permissions.full_acknowledged`
  (`terminal`, `run_option` or `page`). It never carries over to another run.
- [ ] AC-06. Answerers, advisors, panel members and a decider (`agent-conversation` AC-53, `review-gate`) always run at `read`, whatever any
  `defaults`, role or run option says. Their block is set by the engine for the call and is not resolved from the layers of AC-01.

**What a runner can do, and what is checked when**

- [ ] AC-07. A runner declares, per level, its mode and the scope it can hold, through the contract `PermissionCapable` (`api-surface.md`); the built-in
  table is in C-03. A step is checked against **every runner in its chain** (the list of fallbacks): a level that any of them cannot honour
  (`unsupported`) is an error naming the runner, the level and, in plain words, why. The check needs the registry of runners, so it is made by
  `validate`, `plan` and at the start of a run, and by the editor's check when it has the catalog (AC-15); the parser, which has no runners, does not
  make it. The runner turns the effective level into its own arguments, which come first, and its `extraArgs` (embedders only) come after, as
  today. No runner has a permission argument that a level does not name: the hard-coded `--permission-mode acceptEdits` and `--sandbox workspace-write`
  defaults are removed (C-01).
- [ ] AC-08. **An absent block means `read`**, for every runner, and the runner is given the `read` arguments (not none). For `acp` this is what it does
  today (it refuses edits, deletes, moves and commands without a block). `plan` and `validate` state, for each agent step with no block, "this step's
  agent cannot change files or run commands; add `permissions` to allow it", with the one-line example of C-01.
- [ ] AC-09. At `ask` the runner must be `acp`. A permission request from the agent (`session/request_permission`) for **a command, a fetch or any
  other action that is not a file operation** is put to a person through the channel of `agent-conversation`: the tool kind and, as text, what the
  agent names (a command, a path), with the choices *allow once* and *deny*. A file change outside `fs.write`, anything under `.git` or `.indaba`,
  and a command when the person has not been given the choice (`terminal: deny` and no person reachable) are denied without asking: the file
  server of the gate refuses them whatever a person says, so they are not offered. "Always allow" is never offered. A request whose text had to be
  cut (a path over 200 characters, a command over 500) is shown as cut and offers **only deny**. The text is chosen by the agent: it is untrusted,
  cleaned of control characters and direction marks, and shown as text. Each answer is recorded (who, what kind, when) without the text, in the
  channel's answer record.
- [ ] AC-10. If nobody answers an `ask`, the request is **denied**; there is no other choice, so there is no `if_nobody` field. `timeout_seconds`
  (1 to 604800) is optional with `level: ask` and is the person's time only; the step's own runner timeout is not paused while a request waits, and
  `validate` states when `timeout_seconds` is not shorter than it. A denial is a refusal the agent sees, not a failure of the step. With no terminal,
  with `--rulings none`, or in a mode in which no person is asked (`agent-conversation` AC-15), every `ask` request is denied and recorded as
  unanswered.

**A refused permission is a failure with a reason**

- [ ] AC-11. A runner declares `permissionDenied(output)`, which recognises, from the agent's final output, that a permission it needed was refused in
  headless mode (for `antigravity`: the message quoted in section 1). A step fails with a fixed reason that names the level in force and the block to
  change only when the runner recognises the message, the exit code is 0, **and** the level is `read`/`edit`/`ask` with a declared output missing or the
  step wrote nothing it was asked to (so a reviewer that quotes the message is not failed). The text of the agent's message is not copied into the reason
  or any span. A step that failed this way is an ordinary failure for `on_failure`. A built-in CLI runner that cannot recognise a refusal says so in `plan`
  ("a refused permission cannot be told from success for this runner"); no front end implies otherwise.

**Run options, compatibility and guards**

- [ ] AC-12. `indaba run --permissions <level>` (optionally `<step>=<level>`, repeatable) sets an upper bound for this run: the effective level is the lower
  of the file's and the option's, in the order `read` < `edit` < `ask` < `full`. It can never raise a level and never writes the file. A bound that does not
  apply to a step is a usage error naming the step and why: `edit` or `ask` over a block with no `fs.write` (use `read`), a bound on a step that does not exist,
  a bound that a runner of the step's chain cannot honour. A bound of `read` is always applicable and is the dry-run switch.
- [ ] AC-13. A block with no `level` is read as before and its **implied level** is `edit` if `fs.write` is non-empty and `read` otherwise. The implied level
  reaches the runner like a written one, so a legacy block on a command-line runner now gets that runner's arguments for it (C-01 lists what changes). A legacy
  block that allows the terminal but no writes keeps its `terminal` setting for `acp` as today.
- [ ] AC-14. A declared `diff_within_scope` guard no longer replaces the one a block implies (`chain.ts`): both apply at `read`, `edit` and `ask`, so a loose
  declared guard cannot weaken the author's `fs.write`. At `full` neither is added unless declared.

**The record**

- [ ] AC-15. The step's span carries `indaba.permissions.level`, `indaba.permissions.mode` and `indaba.permissions.scope` (the enforcement words above) and, at `ask`,
  `indaba.permissions.asked`, `.allowed` and `.denied` (counts). A `PermissionDecided` event is dispatched for every `ask` answer (step, tool kind, decision, source).
  No path, command or message of the agent is in a span, an event or a log line.

**What the editor and the page show**

- [ ] AC-16. The runner catalog (`indaba catalog`, `specs/workflow-editor`) lists, per runner and level, the mode, the scope and a machine-readable note id
  (`permissions: { read: { mode, scope, note }, ... }`), not English text: each front end owns its words (`web-app-actions` AC-14). A front end does not hard-code which
  runner can do what. The editor's presets map to the file as follows. *Read only* writes `{ level: read }`. *Edit only these folders* writes
  `{ level: edit, fs: { write: [...] } }`. *Full access* writes `{ level: full }`. *Ask me* writes `{ level: ask, fs: { write: [...] } }` once the editor offers it.
  A block of the old shape (`fs.write` and `terminal` only, with no `level`) that equals an old preset is still shown under that preset's name, marked "old style", and
  is rewritten to the new shape only when the person changes it; the old *Full access* (`write: ["**"]`, `terminal: allow`) is shown as "old style Full access" and is **not**
  `level: full` (it keeps the guard). Switching presets deletes the keys the new shape forbids, one edit per path. Any block that matches none is *Custom* and is kept
  as it is.
- [ ] AC-17. When the person picks a level that the selected runner cannot honour, the editor refuses it in plain words from the note id of AC-16; where the mode or the scope
  is not `native`/`acp` it shows the qualifier ("checked after the step, not while it works"). Choosing *Full access* shows the sentence of AC-04. The form still writes no
  level unless the person picks one.

## 4. Non-goals

- A list of allowed or forbidden tools (for example `--allowedTools`), network limits, or per-command rules. A level is coarse on purpose; finer control is `fs.write` and `terminal`.
- A container or other sandbox: `specs/agent-sandbox`. This spec says what Indaba asks the agent's runner to do and what it checks.
- Authenticating who answers an `ask` request: the channel of `agent-conversation` is not authenticated (AC-09 and §6 say what that means) and this does not change it.
- Asking a person for a command-line runner's permissions. A headless CLI cannot ask; the `claude` CLI has a host mechanism (`--permission-prompts host`) that is a later piece of work.
- Answering an `ask` request by a panel or a role. The person only, in this version.
- Remembering a decision across runs.
- Choosing the level for the author. Indaba states facts about enforcement and does not recommend a level.
- Permissions of a debate's participants beyond AC-06: they are bound to `read` as answerers are, and a debate step has no permissions block of its own.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the level is one a runner of the chain cannot honour | error naming the runner, the level and why, at `validate`, `plan` and run start (AC-07) |
| `edit` without `fs.write`, `read` with `fs.write`, `full` with `fs` | error on the block as written (AC-03) |
| a level on a `shell` step | error (AC-03) |
| no block on an agent step | `read` for every runner; `plan` says so (AC-08) |
| `full` and no terminal and no `--allow-full-access` | the run refuses to start (AC-05) |
| `full` and the person says no | the run does not start |
| an agent is refused a permission in headless mode and exits 0 | the step fails with the fixed reason, if the runner recognises it (AC-11) |
| an `ask` request and nobody answers | denied (AC-10) |
| an `ask` request for a file change outside `fs.write`, `.git` or `.indaba` | denied without asking (AC-09) |
| an `ask` request whose text was cut | shown as cut; only *deny* offered (AC-09) |
| the agent writes outside `fs.write` anyway (CLI runner at `read` or `edit`) | the guard fails the step after it ran (AC-14); the files stay in the worktree |
| `--permissions` names a level above the file's | the lower one is used; no error |
| `--permissions edit` on a block with no `fs.write` | usage error naming the step (AC-12) |
| a plugin runner declares no `PermissionCapable` | it supports no level; a step that names a level and can use it is an error, and a step with no block gets `read` that it cannot enforce, which `plan` states (C-04) |
| an answerer or advisor of another spec | always `read` (AC-06) |
| the run is cancelled while an `ask` waits | cancelled; the request is denied; nothing is persisted |

## 6. Security and data handling

- The level is the author's, and nothing widens it: not the runner, not a weaker layer (the three places are not merged, AC-01), not a run option (AC-12), not
  the agent, not an answerer or panel (always `read`, AC-06). A model's text never changes a level.
- An `ask` request carries the agent's words (a tool kind, a command, paths): they are untrusted, cleaned, cut, shown as text, and a cut request cannot be allowed
  (AC-09). "Always allow" does not exist.
- **The channel is not authenticated, and this spec does not fix that.** Anyone who can write `.indaba/conversation/` can answer a request, the first answer wins, and the
  agent under review, which can read `fs.read`-unrestricted files and write outside `fs.write` when its runner does not stop it, may be able to answer its own `ask`. At
  `ask` the channel is therefore the thing that constrains the agent, and `plan` states, for every step at `ask`, "the agent's own process could answer this request";
  `validate` states the same fact. The documentation says no setting in this version prevents it. An authenticated channel is a separate piece of work.
- `full` is deliberate and visible: a plain sentence in four places (AC-04), a once-per-run acknowledgement (AC-05) and a trace attribute. It cannot be turned on by a run
  option, by a weaker layer over a stronger one, or by the editor without the person choosing it. A workflow downloaded, copied from the registry or generated that contains
  `full` is stopped by the acknowledgement.
- For a command-line runner, the scope (the `fs.write` globs and `terminal: deny`) is held by the guard **after** the step, and the mode confines the agent only to its
  workspace (AC-07, C-03). The agent may have written, or run a command, before the check. The `isolation: git_worktree` rule of the existing documentation still applies and
  `validate` still warns without it. This spec claims no more than that.
- A refused permission is reported with a fixed reason and the level, never with the agent's text (AC-11, AC-15).
- No secret, path or command text is in a span, event or log line (AC-15).

## 7. Where it lives

- `@indaba/core` (pure): `PermissionLevel`, `PermissionMode`-style enforcement words, `PermissionCapability`, `PermissionCapable`, `StepPermissions.level` and the
  optional members (C-09), `resolvePermissions` (AC-01), `impliedLevel` (AC-13), `lowerLevel` (AC-12), `unsupportedBy` (AC-07), `describeEnforcement` (structured, C-10),
  `RunRequest.permissionLevel`.
- `@indaba/engine`: parser (the field, role and `defaults` blocks), the checks at `validate`/`plan`/run start with the registry, the guard rule (AC-04, AC-14), the
  `plan`/`validate` text, the `full` acknowledgement hook, `--permissions` resolution, the answerers' `read` (AC-06).
- `@indaba/runners`: every built-in runner implements `PermissionCapable` (the arguments and `permissionDenied`); the removal of the two hard-coded defaults; the `acp`
  runner's `ask` path and the `full` path of `decidePermission`.
- `indaba` (CLI): `--permissions`, `--allow-full-access`, the acknowledgement prompt, the `catalog` fields, the `ask` prompt.
- `@indaba/server`, `@indaba/web`: the catalog fields, the presets and the refusal text, the page's Run confirmation and its passing of `--allow-full-access`; the display of
  an `ask` request belongs to the answering slice (`web-app` step 3e).

## 8. Clarifications

All of these are **recommended; the maintainer confirms**.

- **C-01. The defaults that change, and what breaks.** The rule of section 1 removes `acceptEdits` from `claude-code` and `workspace-write` from `codex`, and an absent block means
  `read` (AC-08). A changed default is a major (below 1.0, the next minor, labelled). **What breaks**, all of it: (1) a `claude-code`, `codex`, `antigravity`, `opencode`
  or `cursor` agent step with no `permissions` can no longer edit; the `README.md` (`codex exec --sandbox workspace-write`), `docs/getting-started.md` and the examples
  `task-pipeline`, `mcp` and `review-debate` that use `claude-code` without permissions must be updated in the same change; (2) a legacy block with an empty `fs.write` on a CLI
  runner moves from `acceptEdits` to the runner's `read` arguments (AC-13); (3) debate and consensus participants had no permissions and now run at `read` (AC-06), which changes
  only a participant that edited files; (4) a migrated workflow whose runner cannot recognise a refusal (AC-11) **runs and edits nothing** without an error unless a declared output
  is missing, and `validate` cannot tell a step that used to edit from a read-only one, so it prints the example for every agent step without a block. The one-line example is
  `permissions: { level: edit, fs: { write: ["src/**"] } }`. **Alternative:** keep the two defaults for one release, state them in `plan` as "the runner's own default, not your
  choice", and remove them in the next labelled minor. The recommendation is to remove them now, because the alternative leaves the thing the rule exists to prevent in place a
  release longer.
- **C-02. Why four levels.** They are the four things a person can mean: *look*, *change files where I said*, *ask me*, *do what you like*. Finer control exists (`fs.write`,
  `terminal`) and is kept. `ask` is a level, not a flag, because it changes who decides.
- **C-03. The built-in table.** What is **verified** was read from the installed CLI on 2026-10-23 with `--help`; what is marked *confirm* must be checked against the CLI
  (and, for what a flag does, run) at implementation, and a level whose argument cannot be confirmed is `unsupported`, never a guess. The scope of a command-line runner is
  `guard` at every level but `full`; the mode only confines the agent to its workspace or mode.

  | Runner | `read` | `edit` | `ask` | `full` |
  | :--- | :--- | :--- | :--- | :--- |
  | `claude-code` | native, `--permission-mode plan` (the mode exists; *confirm* that it refuses writes) | native, `--permission-mode acceptEdits` (as today) | unsupported (`--permission-prompts host` is a later piece) | native, `--permission-mode bypassPermissions` (exists) |
  | `antigravity` | native, `--mode plan` (the flag exists; *confirm* the meaning) | native, `--mode accept-edits` (the flag exists; a write headless was observed to depend on it; *confirm* by a run) | unsupported | native, `--dangerously-skip-permissions` (exists) |
  | `codex` | native, `--sandbox read-only` (*confirm*) | native, `--sandbox workspace-write` (as today) | unsupported | native, `--sandbox danger-full-access` (*confirm*) |
  | `opencode` | after (no read-only argument found in `--help`) | after | unsupported | native, `--auto` (exists) |
  | `cursor` | after | after | unsupported | unsupported until an argument is confirmed |
  | `acp` | acp | acp | acp | acp (the gate allows every request, never "always") |
  | API runners (`openrouter`, OpenAI-compatible) | native (they cannot act) | native | unsupported | native |
  | `shell` | not applicable (AC-03) | | | |

  For `opencode` and `cursor` no read-only or edit-only argument was found in `--help`, so their `read` and `edit` have mode `after`: the runner is started with no permission
  argument and only the guard checks, after the step. That is allowed and `plan` says so (AC-07, AC-17); an author who needs the agent stopped while it works uses `acp` with
  `agent: opencode`, which the documentation already recommends. `antigravity` also has `--sandbox` ("terminal restrictions"), not used here; its runner comment, which says
  that edits are auto-approved, is wrong for headless mode and is corrected in the same change.
- **C-04. A plugin runner** that does not implement `PermissionCapable` supports no level: a step that names a level and can use it is an error, and a step with no block gets
  `read`, which `plan` says the plugin cannot enforce. Implementing the contract is how a plugin takes part; there is no privileged path for a built-in (extensibility rule).
- **C-05. `ask` and `agent-conversation`.** `agent-conversation` explicitly declined to route an ACP permission request to a person: AC-43, the non-goal on answering ACP
  permission requests (its line 454), C-01(b) and C-15(2), and its channel kinds are closed (C-14, AC-57, `data-model.md`). This spec reverses those deliberately, for the
  level `ask` only, and the amendments are listed in `api-surface.md`. A permission request uses its own small request type, because its content (a tool, a command) is not
  prose, and the same channel, person, record and refusal to authenticate. `web-app-actions` AC-13 is amended for the `full` list of AC-05.
- **C-06. The acknowledgement of `full`.** The author already chose `full` in the file; the acknowledgement guards against a file the person did not write or read (a
  workflow downloaded, copied from the registry, generated). It is a prompt, not a policy.
- **C-07. Numbers that are guesses.** `timeout_seconds` up to 604800, the cut of a request's text (200 characters per path, 500 for a command), at most 20 paths in a request, and
  the 4096 characters at each end of the output that `permissionDenied` reads are design choices that are not measured; they are named in `api-surface.md` and revised when
  real runs exist.
- **C-08. Two lessons from the review of `review-gate`.** A refusal that a model can influence must not become an approval: an `ask` with nobody answering is a denial (AC-10), and
  a cut request cannot be allowed (AC-09). And the line between "enforced while it works" and "checked afterwards" is stated, not implied (AC-07, AC-17).
- **C-09. `StepPermissions` becomes optional-field.** Today `parsePermissions` fills `fsRead: []`, `fsWrite: []` and `terminal: deny` for absent keys, so an absent field cannot be
  told from an empty one. With the layers not merged (AC-01) that does not matter for resolution, but `level` is optional and the editor must tell a written `terminal: deny` from
  none. The new member is optional (`level?`); the existing three keep their required types and their present filling. This is the only change to `StepPermissions`, and it is
  a minor.
- **C-10. Words belong to the front end.** Core returns structured descriptions (a runner, a level, a mode, a scope, a note id), the CLI renders them in English, and the page renders
  them from its message catalogue (`web-app-actions` AC-14).

## Artifacts not written

- `plan.md`: `tasks.md` is the order of work; the hooks are in the runners and the engine's validator.
- `research.md`: the one external fact, the CLI flags, is in C-03 with what was verified and what was not.
- `data-model.md`: no stored format of its own.
- `events.md`: the one event, `PermissionDecided`, is listed in `api-surface.md`.
