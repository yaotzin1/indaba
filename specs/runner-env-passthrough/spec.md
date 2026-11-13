# Specification: Passing environment variables to built-in runners (`passEnv` from the command line)

> **Status**: Draft (stages 1 and 2 written; section 8 records what an Indaba debate settled on 2026-11-13, awaiting the maintainer's confirmation; Q6 settled by a second debate, also awaiting confirmation)
> **Stage entry**: 1
> **Semver impact**: minor (provisional: a new, optional way to configure the CLI; nothing existing changes). Confirmed in `api-surface.md` once section 8 is settled.
> **Builds on**: [`specs/host-process-containment`](../host-process-containment/spec.md) (the allowlist this opens a door in), [`specs/transport-priority`](../transport-priority/spec.md) (`INDABA_ACP_PASS_ENV`, the one precedent), [`specs/logging`](../logging/spec.md) (`indaba.config`).

---

## 1. The problem

`specs/host-process-containment` gives every agent CLI, `shell` command and `acp` agent only an allowlist of the environment:
the baseline, the variables of its own provider (`ANTHROPIC_`, `OPENAI_`, ...) and what the runner was told to pass (`passEnv`).
`passEnv` exists on `CliRunnerOptions` and `ShellRunnerOptions`, but the composition root never sets it. Only the `acp` runner can
be told, through `INDABA_ACP_PASS_ENV`.

So a person who runs Indaba from the command line and needs one more variable to reach one runner has no way to say so:

- `claude-code` against Amazon Bedrock needs `AWS_PROFILE`, `AWS_REGION` and the `AWS_*` credentials; against Vertex AI, `CLOUD_ML_REGION`,
  `ANTHROPIC_VERTEX_PROJECT_ID` and `GOOGLE_APPLICATION_CREDENTIALS`. Most of them start with neither `ANTHROPIC_` nor `CLAUDE_`, so they are dropped.
- A company proxy or CA setting named outside the baseline (`REQUESTS_CA_BUNDLE`, `CURL_CA_BUNDLE`) is dropped.
- A verification command (`shell`) that needs `DATABASE_URL` to run its tests gets nothing.

The only ways round it today are to write a Node program that builds the registry with `passEnv`, or to give the agent the whole
environment back, which is the exposure the containment removed. A person who is not a developer (see the audience of Indaba)
can do neither.

## 2. User stories

- **US-01.** As a person running `indaba run` with `claude-code` through Bedrock, I want to name the `AWS_*` variables once, so the
  agent can sign in without Indaba handing it my whole environment.
- **US-02.** As a person whose test command needs `DATABASE_URL`, I want to pass that one variable to the `shell` runner only, not
  to the agent that writes the code.
- **US-03.** As the author of a workflow file I want to be unable to widen what a process receives from inside the file, because I
  may have got the file from someone else.
- **US-04.** As a person who commits `indaba.config` with my project, I never want a secret value in it, only names.
- **US-05.** As a developer embedding Indaba, I keep `passEnv` on the runner options exactly as it is.

## 3. Acceptance criteria

Written after the debate of section 8. Criteria marked (debate) were added or corrected by it.

- [ ] AC-01. A person can name variables (exact names, or a prefix ending in `*`, the same grammar as `INDABA_ACP_PASS_ENV`) that the
  built-in process runners pass on to their children, without writing code.
- [ ] AC-02. The setting can be scoped to one runner, so a variable meant for `claude-code` is not seen by `shell` or `codex` (US-02).
- [ ] AC-03. (debate) Nothing in a workflow file, an artifact, a model's output, a step's `env` or the project's `indaba.config` can grant a name (US-03).
  The setting is read only from the process environment and the user-level file of Q1, which the person controls. A test shows that a step's `env`
  and a project file each leave the allowlist unchanged.
- [ ] AC-04. Only names are ever stored or shown. A value is read from the environment at the moment the runner starts a process; it is
  never written to `indaba.config`, a trace, an event, a log, an error or the output of `indaba plan` / `indaba catalog`.
- [ ] AC-05. (debate) A name that is not a plausible variable name (letters, digits, underscore; a `*` only at the end), an entry that is a bare `*` and a
  prefix of fewer than 3 characters are usage errors. The message names the entry and says how to fix it (tested on the text, not only on the exit code).
- [ ] AC-06. (debate) `indaba plan` prints, per runner, one line per entry in an exact format (fixed in `api-surface.md`): the runner, the entry, the names it matches
  in the current environment (names only) or `not set`, and a `warning` mark on a matched name that contains `SECRET`, `TOKEN` or `KEY`. The warning never blocks.
  A test covers the matched, the not-set and the warning lines, and that no value appears.
- [ ] AC-07. Without the setting, nothing changes: the allowlist of `specs/host-process-containment` is exactly what it was.
- [ ] AC-08. `INDABA_ACP_PASS_ENV` keeps working unchanged (or is folded into the new setting with the same effect).
- [ ] AC-09. Every process runner honours it the same way, built-in or registered by a plugin through the public contract: a plugin
  runner that builds its environment with `buildRunnerEnvironment` gets the same names. (debate) When two sources name the same variable the result is
  the union, and a test shows it.
- [ ] AC-10. (debate) A project's `indaba.config` may list names it *requests*. They are not granted: `plan` prints each as requested, not granted, with the name,
  the runner and the plain instruction to grant it (what the name is for, which runner would get it, the exact step), and the same text appears at the start of a run
  that has one, so a person who skips `plan` still sees it. The text says to grant only what the person recognises; there is no one-click grant. Both texts are tested.
- [ ] AC-11. (debate 2) Grants are read only from the user-level file. A project `indaba.config` carrying `passEnv` is rejected with a message naming the key and saying to use `requestEnv`;
  the loader never reads a grant from a project. A test covers the rejection and that the allowlist is unchanged.
- [ ] AC-12. (debate 2) The user-level file has no path override and is not read through a symlink that leaves its folder. `indaba env grant` run without a terminal refuses an entry that
  comes from a project's request. Both are tested.

## 4. Non-goals

- **Setting a value.** This passes a variable through that already exists in the person's environment. Setting `FOO=bar` for a step is
  `specs/agent-sandbox`'s `env` and a different spec.
- **A per-step or per-workflow setting.** It is a property of the machine and the project, not of a workflow file (AC-03).
- **A secrets manager.** No vault, no `.env` loading, no encryption.
- **Passing the whole environment.** There is no switch for it; a person who wants that runs without Indaba's containment on purpose,
  which is `specs/agent-sandbox`'s `sandbox: none` conversation and not this one.
- **Changing the baseline.** What every process always gets stays as `BASELINE_ENV_NAMES` says.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| an entry is malformed (`AWS KEY`, `*`, `A*B`) | usage error before any run starts, naming the entry and the setting it came from; the exit code of a usage error |
| the setting names a runner Indaba does not have | a warning from `plan`; no failure (a plugin runner may be loaded later or not at all) |
| a named variable is not set in the environment | passes nothing for it; `plan` says "not set"; the process starts normally |
| two sources name the same variable | the union; no source removes another's names |
| the project configuration file has a bad key | the existing problem of `indaba.config` (a key it may not hold is named) |

## 6. Security and data handling

- The setting widens a security boundary on purpose, so it is the person's alone to set (AC-03). The attacker model is a workflow file or a
  repository's `indaba.config` from someone else: a cloned project can ship an `indaba.config` that names `*_TOKEN`, `GITHUB_TOKEN` or `AWS_*` and
  then run an agent that reads them. That is a real attack on the person who clones and runs (Q3 asks how it is answered).
- Names are checked against a strict shape before use; values are never read into any structure that is logged (the `secretEnv` precedent in
  `indaba.config`).
- A prefix is more dangerous than a name (`AWS_*` also matches `AWS_SECRET_ACCESS_KEY`, which is what Bedrock needs, and others). `plan` lists the
  names a prefix matches in the current environment, so the person sees what a prefix means before the run.

## 7. Where it lives

| Part | Package | Pure or infrastructure |
| :--- | :--- | :--- |
| the shape check and the union of sources (`parsePassEnv`) | `@indaba/core` (pure) or `@indaba/runners` | pure |
| per-runner names given to the built-in runners | `@indaba/runners` (`RunnerRegistry.withDefaults`) | infrastructure |
| reading the environment, the flag and `indaba.config`; `plan` output | `indaba` (the composition root), `@indaba/engine` (the config section) | infrastructure |
| docs | `docs/` | |

## 8. Clarifications

Settled by an Indaba debate on 2026-11-13: two `claude-code` agents, one arguing for the narrowest boundary (security) and one for a person who cannot write code
(usability), reached consensus after two rounds. The maintainer confirms or overturns each decision; the transcript is in the run's board (trace
`41faf97c05317c5949a4b97f6cc4aeae`). The original recommendations are kept where the debate changed them.

- **Q1. Where is it set?** *Decided:* an environment variable and a **user-level** configuration file, no command-line flag, and **no** project `indaba.config`.
  The original recommendation (the environment variable and `indaba.config`) is overturned: a project file belongs to whoever wrote the repository, so it is the attacker's
  file in a clone. A non-developer needs a setting that stays set, so the user-level file is required, not optional; a wizard or the TUI can write it once.
- **Q2. What is the scope?** *Decided (as recommended):* a list per runner (`INDABA_PASS_ENV_<RUNNER>`, `claude-code` as `CLAUDE_CODE`, and a per-runner list in the user-level file).
  A global list would give the agent what the test command needs and the reverse (US-02). A wizard or the TUI says "for Claude Code" and "for the test command", never the variable name.
- **Q3. How is a hostile `indaba.config` answered?** *Decided:* (a), overturning the recommendation of (c): a project file can never widen the allowlist. A trust-on-first-use
  prompt would be consent theatre for someone who cannot judge a list of names. Instead a project file may only *request* names, shown as "requested, not granted" (AC-10), and
  trust-on-first-use can be added later if people ask. The accepted risk: someone who copies a grant command from a cloned project's README; hence the wording rule of AC-10.
- **Q4. `INDABA_ACP_PASS_ENV`.** *Decided (as recommended):* stays, as an alias for `INDABA_PASS_ENV_ACP`, documented as such. Dropping it would be a breaking change.
- **Q5. Prefix patterns.** *Decided (as recommended, with conditions):* `AWS_*` is allowed, because Bedrock needs it. `plan` lists what a prefix matches and marks `SECRET`, `TOKEN` and `KEY`
  names with a warning that does not block; a bare `*` and a prefix under 3 characters are refused (AC-05).
- **Q6. Where is the user-level file?** *Decided by a second debate (2026-11-13, `claude-code` against `antigravity`, consensus after two rounds, trace `599c795662271aa543698e2201155a62`),
  awaiting the maintainer:* `<userConfigFolder>/indaba/indaba.config`, using `userConfigFolder()` in `packages/cli/src/config-folder.ts` (`%APPDATA%` on Windows,
  `~/Library/Application Support` on macOS, `$XDG_CONFIG_HOME` or `~/.config` elsewhere), the folder where `indaba ui` already keeps what a person confirmed. Checked in the repository: the helper exists.
  - **No path override.** An environment variable that moved the file could point the trusted store into a cloned repository; a symlink leading out of the folder is refused.
  - **Format:** the YAML of `indaba.config`, names only, `passEnv: { <runner>: [AWS_PROFILE, AWS_*] }`, validated by AC-05. The user file's `passEnv` is a **grant**; a project's
    `indaba.config` uses a different key, `requestEnv`, and a `passEnv` in a project file is rejected, so the shared filename cannot mix the two meanings (AC-11).
  - **Writers:** by hand, `indaba settings`, the wizard and `indaba env grant|revoke|list <runner> <name>`, all through one comment-preserving atomic writer (temporary file, then rename; mode 0600 on Unix).
    `indaba env grant` refuses to take an entry from a project's request when it runs without a terminal (AC-12).
  - A first proposal (`passenv.yaml`, `~/.config` on macOS, `INDABA_USER_CONFIG`) was withdrawn by its author for the reasons above.
  - Not yet checked: the existing round-trip writer is in `@indaba/engine`; whether it preserves comments is for the plan (stage 3) to confirm before this is relied on.

Criteria the debate found wrong or untestable were corrected above (AC-03, AC-05, AC-06) or added (AC-10).

## Artifacts not written

- `data-model.md`: no persistent format beyond one `indaba.config` section, settled with section 8.
- `events.md`: no new event or span attribute; a name is never recorded.
- `research.md`: the need comes from the incident the containment spec closes, and the provider variables are those the Claude Code documentation lists for Bedrock and Vertex.
- `plan.md`: written after section 8 is settled (stage 3).
- `tasks.md`: written after section 8 is settled (stage 4).
