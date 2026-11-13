# Specification: Passing environment variables to built-in runners (`passEnv` from the command line)

> **Status**: Draft (stage 1 written; stage 2 open: section 8 holds the questions this spec asks the maintainer to settle)
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

The shape of the setting is open (section 8, Q1 to Q3); these criteria hold for every answer.

- [ ] AC-01. A person can name variables (exact names, or a prefix ending in `*`, the same grammar as `INDABA_ACP_PASS_ENV`) that the
  built-in process runners pass on to their children, without writing code.
- [ ] AC-02. The setting can be scoped to one runner, so a variable meant for `claude-code` is not seen by `shell` or `codex` (US-02).
- [ ] AC-03. Nothing in a workflow file, an artifact, a model's output or a step's `env` can add to what is passed (US-03). The setting is read
  only from the process environment, a command-line option or the project configuration file, which the person controls.
- [ ] AC-04. Only names are ever stored or shown. A value is read from the environment at the moment the runner starts a process; it is
  never written to `indaba.config`, a trace, an event, a log, an error or the output of `indaba plan` / `indaba catalog`.
- [ ] AC-05. A name that is not a plausible variable name (letters, digits, underscore; a `*` only at the end), or an entry that is a bare `*`, is a usage
  error that names the entry, not silently ignored. A bare `*` is refused because it would undo the allowlist.
- [ ] AC-06. `indaba plan` (or `validate`) says, per runner, which names will be passed on, so a person can check without running.
  A name that matches nothing in the current environment is reported as such, not as an error.
- [ ] AC-07. Without the setting, nothing changes: the allowlist of `specs/host-process-containment` is exactly what it was.
- [ ] AC-08. `INDABA_ACP_PASS_ENV` keeps working unchanged (or is folded into the new setting with the same effect).
- [ ] AC-09. Every process runner honours it the same way, built-in or registered by a plugin through the public contract: a plugin
  runner that builds its environment with `buildRunnerEnvironment` gets the same names.

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

## 8. Clarifications: the questions to settle

Each has a recommendation; the discussion should confirm or overturn it, and say why.

- **Q1. Where is it set?** (a) an environment variable; (b) a section of `indaba.config`; (c) a `--pass-env` option on `run`; (d) all three.
  *Recommendation:* (a) and (b), no flag. A flag is noise on every command line and lands in shell history; the environment variable
  is the existing precedent (`INDABA_ACP_PASS_ENV`), and the config file is where a team records it once.
- **Q2. What is the scope?** (a) one global list for every runner; (b) a list per runner; (c) global for the agent CLIs and a separate one for `shell`.
  *Recommendation:* (b), with a short grammar: `INDABA_PASS_ENV_<RUNNER>` (`claude-code` as `CLAUDE_CODE`) and a `runners.<name>.pass_env` list in `indaba.config`.
  A single global list gives the agent every variable the test command needs and the reverse (US-02).
- **Q3. How is a hostile `indaba.config` answered?** (a) the config file may not widen the allowlist at all (environment variable only);
  (b) it may, and `plan` prints what it passes; (c) it may, but Indaba asks for confirmation the first time a project's list changes
  (a recorded hash, like trust on first use).
  *Recommendation:* (c) if the audience is people who clone projects; otherwise (a). This is the question the maintainer must answer.
- **Q4. Does `INDABA_ACP_PASS_ENV` stay?** *Recommendation:* yes, as an alias for `INDABA_PASS_ENV_ACP`, documented as such.
- **Q5. Prefix patterns.** Is `AWS_*` allowed, given that it also passes `AWS_SECRET_ACCESS_KEY`? *Recommendation:* allowed, because Bedrock needs exactly that, with the
  listing of AC-06 as the safeguard; a bare `*` refused (AC-05).

## Artifacts not written

- `data-model.md`: no persistent format beyond one `indaba.config` section, settled with section 8.
- `events.md`: no new event or span attribute; a name is never recorded.
- `research.md`: the need comes from the incident the containment spec closes, and the provider variables are those the Claude Code documentation lists for Bedrock and Vertex.
- `plan.md`: written after section 8 is settled (stage 3).
- `tasks.md`: written after section 8 is settled (stage 4).
