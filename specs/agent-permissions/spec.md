# Specification: Agent permissions (what an agent may do without asking, chosen by the author)

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 (the decisions in section 8 are recommended; the maintainer confirms them)
> **Semver impact**: **major** for the one default that changes (C-01); everything else is minor (an optional `permissions.level`,
> an optional `defaults.permissions` and role `permissions`, a runner capability contract, new span attributes, one new
> run option). Below 1.0 the breaking part takes the next minor and is labelled as such in the changelog.
> **Builds on**: the `permissions` block of [`docs/workflow-format.md`](../../docs/workflow-format.md#permissions) and the
> `diff_within_scope` guard it adds; [`specs/agent-conversation`](../agent-conversation/spec.md) (the channel and the person's
> answers, for the `ask` level); [`specs/web-app-editing-forms`](../web-app-editing-forms/spec.md) (the presets of the form).
> **Related, not part of it**: [`specs/review-gate`](../review-gate/spec.md) (a gate asks about the *work*; this asks about
> the agent's *actions*), `specs/agent-sandbox` (a container backend is a stronger boundary than any level here).

---

## 1. The problem

Whether an agent may write files, run commands or do anything it likes without anyone approving is the author's decision.
Today Indaba makes it for them, and differently for every runner, in code:

- `claude-code` is started with `--permission-mode acceptEdits` and `codex` with `--sandbox workspace-write` whatever the
  workflow says (`claude-runner.ts`, `codex-runner.ts`); `opencode` and `antigravity` are started with no permission argument at
  all. The author cannot see or change this from the workflow file; only code that constructs the runner can.
- The `permissions` block (`fs.read`, `fs.write`, `terminal`) is enforced while the agent works only by the `acp` runner. For the
  command-line runners it is a guard that looks at the working directory **after** the step. The documentation says so, and
  the editor's presets ("Read only", "Edit only these folders", "Full access") do not.
- A command-line agent that is refused a permission in headless mode cannot ask. The `antigravity` CLI prints that a tool "required
  the write_file permission that headless mode cannot prompt for" and **exits 0**; the step is reported as having run, and
  the missing file is found by a guard minutes later, with no reason.
- There is no way to say "ask me before it does that", and no deliberate way to say "do not ask me at all".

The author must be able to choose, in the workflow file, between a read-only agent, an agent that edits where they say, an
agent whose risky actions are put to a person, and an agent with no limits, knowing which of those Indaba can actually enforce
for the runner they chose.

## 2. User stories

- **US-01.** As a workflow author, I set how much a step's agent may do, in the file, and Indaba never widens it for me.
- **US-02.** As a workflow author who wants full autonomy, I can choose it deliberately, and every run that uses it says so
  and asks me once.
- **US-03.** As a workflow author, I am told, before the run, which layer enforces my choice for each runner: the CLI itself, the
  ACP gate, or only a check after the step; and I am refused a choice that the runner cannot honour at all.
- **US-04.** As a person running a workflow that asks before acting, I see what the agent wants to do and decide, and nothing
  is allowed "always".
- **US-05.** As a person who is not a developer, I choose among plain names in the editor, and the page shows what each
  means for the runner that is selected.
- **US-06.** As a person reading a run, a refused permission is a step that failed with a reason, not a step that ran.

## 3. Acceptance criteria

Terms. A **level** is one of `read`, `edit`, `ask`, `full` (AC-02). **Enforcement** is the layer that makes a level true:
`native` (the agent's own CLI refuses while it works), `acp` (Indaba's permission gate answers the agent's requests while it
works), `guard` (a check of the working directory after the step), `none`, or `unsupported` (the runner cannot honour the
level).

**The field and where it is set**

- [ ] AC-01. `permissions` (a step's block, `docs/workflow-format.md`) gains an optional `level`. `permissions` also becomes valid on
  a role and in `defaults`, merged field by field with the layers `defaults`, then the role, then the step, a stronger layer
  replacing the same field of a weaker one (`fs` and `terminal` as they are today). A run option may lower the effective level but never
  raise it (AC-12). A `permissions` block with no `level` keeps working as it does today (AC-13).
- [ ] AC-02. The levels are:
  - `read`: the agent may read; it may not change files or run commands.
  - `edit`: the agent may change files that match `fs.write`, and run commands only if `terminal: allow`; anything else is refused.
  - `ask`: as `edit`, but what the agent asks to do beyond that is put to a person (AC-09).
  - `full`: no limit from Indaba, no approval asked. The author chose it (AC-04).
- [ ] AC-03. `edit` and `ask` require a non-empty `fs.write` (a parse error otherwise: "edit needs the folders it may change"), because an
  empty `fs.write` already means "may change nothing". `read` forbids `fs.write` and `terminal: allow`. A level on a `shell` step is a parse
  error: shell steps run the commands the author wrote. A level on a step whose runner is API-only (it cannot touch files) is allowed and
  satisfied by `native` (AC-06).
- [ ] AC-04. `full` forbids `fs` and `terminal` in the same block (they would be ignored; a parse error says so), does not add the
  `diff_within_scope` guard, and is shown by `plan`, `validate`, the dashboard and the page in plain words: "this step's agent can change
  anything and run anything and nobody approves it".

**Acknowledging `full`**

- [ ] AC-05. A run whose effective permissions include `full` on any step asks the person, once per run, before the first step, at a
  terminal: it names the steps and the runner of each and waits for a yes. Without a terminal the run refuses to start with a usage
  error naming the steps, unless the run option `--allow-full-access` is given (which is the person's acknowledgement). The page's
  Run action shows the same list in its confirmation (`web-app-actions` AC-13). The acknowledgement is recorded in the trace as
  `indaba.permissions.full_acknowledged` with its source (`terminal`, `run_option`, `page`). It never carries over to another run.

**What a runner can do**

- [ ] AC-06. A runner declares, per level, its enforcement through the contract `PermissionCapable` (`api-surface.md`). The built-in table
  is in C-03. A step is validated against **every runner in its chain** (the list of fallbacks): a level that any of them cannot honour
  (`unsupported`) is a parse-time error naming the runner, the level and, in plain words, why ("the claude-code runner cannot ask
  you; use the acp runner for that").
- [ ] AC-07. The runner turns the effective level into its own arguments: the arguments of the level come first and the runner's
  `extraArgs` (embedders only) come after, as today. No runner has a permission argument that the level does not name: the hard-coded
  `--permission-mode acceptEdits` and `--sandbox workspace-write` defaults are removed (C-01).
- [ ] AC-08. A runner that reports `guard` for a level says it in `plan` and `validate` as a fact: "claude-code enforces `read` only
  after the step, with a check of the changed files" (the sentence is generated from the declared enforcement). Nothing in any front end
  calls a `guard` level "enforced" without that qualifier.

**Ask**

- [ ] AC-09. At `ask` the runner must be `acp`. A permission request from the agent (`session/request_permission`) is not answered by
  policy but put to a person through the channel of `agent-conversation`: the tool and the paths it names, as text, cleaned and cut
  (they are chosen by the agent and are untrusted), with the choices *allow once* and *deny*. "Always allow" is never offered, as
  today. A request outside `fs.write` is denied without asking when `terminal` or the paths are not allowed at all. The answer is
  recorded (who, what, when). `agent-conversation` AC-43, which says a permission request is answered by policy and never a question,
  is amended to say "except at the level `ask`" (C-05).
- [ ] AC-10. If nobody answers an `ask`, the request is **denied**. `permissions.if_nobody` may only be `deny` in this version; a
  `timeout_seconds` (1 to 604800) is optional and, as in `review-gate`, applies to the person's time only. A denial is a refusal the agent
  sees, not a failure of the step.

**A refused permission is a failure with a reason**

- [ ] AC-11. A runner declares `denied(output)`, which recognises, from the agent's final output, that a permission it needed was refused
  in headless mode (for `antigravity`: the message quoted in section 1). When it does, the step fails with a fixed reason that names the
  level in force and the permission block to change, whatever the exit code, and the text of the agent's message is not copied into the
  reason or any span. A step that failed this way is an ordinary failure for `on_failure`.

**Run options and compatibility**

- [ ] AC-12. `indaba run --permissions <level>` (optionally `<step>=<level>`, repeatable) sets an upper bound for this run: the effective
  level is the lower of the file's and the option's, in the order `read` < `edit` < `ask` < `full`. It can never raise a level and never
  writes the file. A bound that a runner cannot honour is a usage error.
- [ ] AC-13. A `permissions` block with no `level` is read as before: a non-empty `fs.write` is `edit`, otherwise `read`, with the same
  enforcement as today (the ACP gate for `acp`, the guard for every runner). A workflow that has no `permissions` anywhere and runs on a
  command-line runner is the one case that changes (C-01).

**The record**

- [ ] AC-14. The step's span carries `indaba.permissions.level`, `indaba.permissions.enforcement` and, at `ask`,
  `indaba.permissions.asked`, `indaba.permissions.allowed` and `indaba.permissions.denied` (counts). A `PermissionDecided` event is
  dispatched for every `ask` answer (step, tool kind, decision, source). No path, command or message of the agent is in a span, an event or a
  log line.

**What the editor and the page show**

- [ ] AC-15. The runner catalog (`indaba catalog`, `specs/workflow-editor`) lists, per runner, the enforcement of each level
  (`permissions: { read: 'native', edit: 'native', ask: 'unsupported', full: 'native' }`), so a front end does not hard-code which runner
  can do what. The editor's three presets map to the file: *Read only* is `level: read`; *Edit only these folders* is `level: edit` with the
  folders in `fs.write`; *Full access* is `level: full`; *Ask me* is `level: ask` once the editor offers it. A value that matches none of
  these is shown as *Custom* and kept as it is (as `web-app-editing-forms` does today).
- [ ] AC-16. When the person picks a level that the selected runner cannot honour, the editor refuses it in plain words with the reason of
  AC-06; when the runner reports `guard`, it shows the sentence of AC-08 next to the choice. Choosing *Full access* shows the sentence of
  AC-04. The form still writes no level unless the person picks one.

## 4. Non-goals

- A list of allowed or forbidden tools (for example `--allowedTools`), network limits, or per-command rules. A level is coarse on
  purpose; finer control is `fs.write` and `terminal`.
- A container or other sandbox: `specs/agent-sandbox`. This spec says what Indaba asks the agent's runner to do and what it checks.
- Authenticating who answers an `ask` request: the channel of `agent-conversation` is not authenticated and this does not change it.
- Asking a person for a command-line runner's permissions. A headless CLI cannot ask; the `claude` CLI has a host mechanism
  (`--permission-prompts host`) that is a later piece of work, not this one.
- Answering an `ask` request by a panel or a role. The person only, in this version.
- Remembering a decision across runs.
- Choosing the level for the author. Indaba states facts about enforcement (AC-08) and does not recommend a level.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the level is one the runner cannot honour | parse error naming the runner, the level and why (AC-06) |
| `edit` without `fs.write`, `read` with `fs.write`, `full` with `fs` | parse error (AC-03, AC-04) |
| a level on a `shell` step | parse error (AC-03) |
| `full` and no terminal and no `--allow-full-access` | the run refuses to start (AC-05) |
| `full` and the person says no | the run does not start |
| an agent is refused a permission in headless mode and exits 0 | the step fails with the fixed reason (AC-11) |
| an `ask` request and nobody answers | denied (AC-10) |
| an `ask` request outside the allowed paths or with `terminal: deny` | denied without asking (AC-09) |
| the agent writes outside `fs.write` anyway (CLI runner at `read` or `edit`) | the guard fails the step after it ran (AC-08); the files stay in the worktree |
| `--permissions` names a level above the file's | the lower one is used; no error |
| a plugin runner declares no `PermissionCapable` | it supports no level; any `level` on a step that can use it is a parse error, and a step with no `level` runs as it does today (C-04) |
| the run is cancelled while an `ask` waits | cancelled; the request is denied; nothing is persisted |

## 6. Security and data handling

- The level is the author's, and nothing widens it: not the runner, not a role-level default that the step cannot see, not a run
  option (AC-12), not the agent. A model's text never changes a level.
- An `ask` request carries the agent's words (tool names, paths, a command): they are untrusted, cleaned of control characters and direction
  marks, cut, shown as text. A request cannot be answered "always allow" (AC-09).
- `full` is deliberate and visible: a plain sentence in four places (AC-04), a once-per-run acknowledgement (AC-05) and a trace attribute.
  It cannot be turned on by a run option, by a role default that the author did not write in this workflow, or by the editor without the
  person choosing it.
- For a command-line runner at `read` or `edit`, enforcement can be `guard` only: the agent may have written before the check. The
  `isolation: git_worktree` rule of the existing documentation still applies, and `validate` still warns without it. This spec does not
  claim more than that (AC-08).
- A refused permission is reported with a fixed reason and the level, never with the agent's text (AC-11, AC-14).
- No secret, path or command text is in a span, event or log line (AC-14).

## 7. Where it lives

- `@indaba/core` (pure): `PermissionLevel`, `Enforcement`, `PermissionCapability`, `PermissionCapable`, `StepPermissions.level`,
  `resolvePermissions` (layers, AC-01), `lowerLevel` (AC-12), `describeEnforcement` (AC-08), `RunRequest.permissionLevel`.
- `@indaba/engine`: parser and validator (the fields and every parse error), the check against every runner in the chain, the guard rule
  (AC-04, AC-13), `plan`/`validate` text, the `full` acknowledgement hook.
- `@indaba/runners`: every built-in runner implements `PermissionCapable` (the arguments and `denied`); the removal of the two
  hard-coded defaults; the `acp` runner's `ask` path.
- `indaba` (CLI): `--permissions`, `--allow-full-access`, the acknowledgement prompt, the `catalog` fields, the `ask` prompt.
- `@indaba/server`, `@indaba/web`: the catalog fields, the presets and the refusal text of AC-15 and AC-16; the page's Run confirmation;
  the display of an `ask` request belongs to the answering slice (`web-app` step 3e).

## 8. Clarifications

All of these are **recommended; the maintainer confirms**.

- **C-01. The default that changes.** A rule of this work (D10) is that no permission default is hard-coded in a runner: the level comes
  from the workflow, chosen by a person. Taken literally it removes `acceptEdits` from `claude-code` and `workspace-write` from `codex`,
  so a workflow that has no `permissions` and relies on them stops being able to edit. That is a changed default, which is a major
  (below 1.0, the next minor, labelled). **Recommended: do it**, with a migration that costs one line (`permissions: { level: edit, fs: { write: ["src/**"] } }`), and
  `validate` printing exactly that sentence for a step that now has no write access. **Alternative**: keep the two defaults for one
  release, make `plan` and `validate` state them as "the runner's own default, not your choice", and remove them in the next labelled
  minor. The recommendation is the first because the second leaves the thing the rule exists to prevent in place a release longer.
  `antigravity` and `opencode` have no permission argument today, so for them only the new field adds behaviour.
- **C-02. Why four levels.** They are the four things a person can mean: *look*, *change files where I said*, *ask me*, *do what you
  like*. Finer control exists (`fs.write`, `terminal`) and is kept. `ask` is a level, not a flag, because it changes who decides.
- **C-03. The built-in table.** What is **verified** was read from the installed CLI on 2026-10-23; what is marked *confirm* must be checked
  against the CLI at implementation, and a level whose argument cannot be confirmed is `guard` or `unsupported`, never a guess.

  | Runner | `read` | `edit` | `ask` | `full` |
  | :--- | :--- | :--- | :--- | :--- |
  | `claude-code` | native, `--permission-mode plan` (the mode exists; *confirm* that it refuses writes) | native, `--permission-mode acceptEdits` (as today) | unsupported (`--permission-prompts host` is a later piece) | native, `--permission-mode bypassPermissions` or `--dangerously-skip-permissions` (both exist) |
  | `antigravity` | native, `--mode plan` (the flag exists; *confirm* the meaning) | native, `--mode accept-edits` (verified to allow a write headless) | unsupported | native, `--dangerously-skip-permissions` (exists) |
  | `codex` | native, `--sandbox read-only` (*confirm*) | native, `--sandbox workspace-write` (as today) | unsupported | native, `--sandbox danger-full-access` (*confirm*) |
  | `opencode` | guard | guard (*confirm* what headless `opencode run` does with a write) | unsupported | native, `--auto` (exists) |
  | `cursor` | guard | guard (*confirm*) | unsupported | unsupported until an argument is confirmed |
  | `acp` | acp | acp | acp | acp (the gate allows every request, never "always") |
  | API runners (`openrouter`, OpenAI-compatible) | native (they cannot act) | native | unsupported | native |
  | `shell` | not applicable (AC-03) | | | |

  In every row `guard` also applies after the step for `read` and `edit`, as `diff_within_scope` does today.
- **C-04. A plugin runner** that does not implement `PermissionCapable` supports nothing: a step that names a level and can use it is a
  parse error, and a step with no level runs as it does today. Implementing the contract is how a plugin takes part; there is no
  privileged path for a built-in (extensibility rule).
- **C-05. `ask` and `agent-conversation`.** A permission request is not a question and uses its own small request type, because
  its content (a tool, paths) is not a person's reading material in prose. It uses the same channel, the same person, the same record
  and the same refusal to authenticate. `agent-conversation` AC-43 gains "except at the level `ask`".
- **C-06. The acknowledgement of `full`.** The author already chose `full` in the file; the acknowledgement guards against a file the
  person did not write or read (a workflow downloaded, copied from the registry, generated). It is a prompt, not a policy: with
  `--allow-full-access` it is given by the person on the command line.
- **C-07. Numbers that are guesses.** `timeout_seconds` up to 604800 and the cut of a request's text (200 characters per path, 500
  for a command) are design choices that are not measured; they are named in `api-surface.md` and revised when real runs exist.
- **C-08. The two spec ideas that came from the review of `review-gate`.** A refusal that a model can influence must not become an
  approval: `ask` with nobody answering is a denial, never an allow (AC-10). And the line between "enforced" and "checked afterwards"
  is stated, not implied (AC-08).

## Artifacts not written

- `plan.md`: `tasks.md` is the order of work; the hooks are in the runners and the engine's validator.
- `research.md`: the one external fact, the CLI flags, is in C-03 with what was verified and what was not.
- `data-model.md`: no stored format of its own.
- `events.md`: the one event, `PermissionDecided`, is listed in `api-surface.md`.
