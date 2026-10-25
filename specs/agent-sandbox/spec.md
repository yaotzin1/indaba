# Specification: Running agents in a container or a virtual machine

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 (the decisions in section 8 are recommendations the maintainer confirms)
> **Semver impact**: minor (new optional workflow fields, new contracts, new commands; below 1.0). Existing
> workflows behave exactly as before.
> **Builds on**: [`specs/transport-priority`](../transport-priority/spec.md) (runners, `ProcessSpawner`),
> [`specs/git-workspace`](../git-workspace/spec.md) and [`specs/workspace-without-git`](../workspace-without-git/spec.md)
> (the folder a step works in), [`specs/acp-agent-install`](../acp-agent-install/spec.md) (installing agents),
> [`specs/mcp-support`](../mcp-support/spec.md).
> **Decided by the maintainer**: isolation by container or virtual machine is designed now, not later, because a
> hosted service cannot exist without it; and the whole mechanism is automated from Indaba, with no manual work to
> make it function.

---

## 1. The problem

Isolation today protects the *project*: a step works in a copy or a git worktree, and a guard checks what changed. It
does not protect the *machine*. An agent CLI that Indaba starts runs as the person, with their files, their network,
their credentials and every program on `PATH`. A guard can reject a patch after the fact; it cannot stop an agent from
reading `~/.ssh`, calling a server, or deleting something outside the working folder.

That is acceptable for one person running agents they chose on their own computer. It is not acceptable for:

- a person who wants to leave a run unattended and trust that the worst case is a bad result in one folder;
- agents given less trust than the person (a downloaded workflow, a third-party prompt, a model that can be steered by
  the files it reads);
- the hosted service in [`docs/hosted-service.md`](../../docs/hosted-service.md), which runs other people's agents on
  shared infrastructure and cannot exist without it.

The boundary has to be a thing the operating system or a hypervisor enforces: a container or a virtual machine. And it
has to be automatic. A feature that asks the person to write a Dockerfile, build an image, install the agent inside it
and wire up mounts will not be used by the people this project is for (`docs/positioning.md`).

## 2. User stories

- **US-01.** As a person running a workflow, I write `sandbox: container` (or accept a default) and Indaba does the
  rest: finds the engine, gets an image, starts the agent inside it, and removes everything afterwards.
- **US-02.** As a person, I run `indaba sandbox doctor` and read in plain words whether isolation will work, and if not,
  the one thing to do; `indaba sandbox setup` does that thing after I say yes.
- **US-03.** As a workflow author, I choose per workflow, and per step, whether it runs on the host, in a container or in
  a virtual machine, how much of the network it may use, and which of my secrets it receives.
- **US-04.** As a person, a step that asked for isolation never silently runs on the host because isolation was
  unavailable.
- **US-05.** As a person on Windows or macOS, it works through the container engine I already have or the one Indaba
  helps me install, and the agent still sees only the step's folder.
- **US-06.** As a plugin author, I add a different backend (a microVM, a remote machine, a cloud sandbox) through
  `Plugin` and `PluginHost`, with the same standing as the built-in container backend.
- **US-07.** As the operator of a hosted service, I set a policy that forbids `sandbox: none`, so no workflow file can
  opt out.
- **US-08.** As a person reading a trace, I see which backend ran each step and with which image digest, and never a
  secret.

## 3. Acceptance criteria

**Choosing a sandbox**

- [ ] AC-01. A workflow accepts a top-level `sandbox` mapping and a per-step `sandbox`, which overrides it. `kind` is
  `none` (the default; behaviour as today), `container` or `vm`; a plugin may register other kinds. Other fields:
  `network` (`none`, `agent_api` or `full`), `cpus`, `memory_mb`, `pids`, `timeout_seconds`, `image` (optional, section
  8 C-03), `env` (a list of **names** of environment variables to pass in) and `mounts` (extra read-only host folders by
  absolute path, off by default).
- [ ] AC-02. Absent `sandbox` means `none` and changes nothing for existing workflows. A `sandbox` field naming a kind
  that no registered backend provides fails validation at parse time, naming the field and the kinds available.
- [ ] AC-03. The engine option `sandboxPolicy` (and `indaba.config` for the CLI) can set `allowed_kinds`, a `minimum`
  and `forbid_host_mounts`. A workflow that asks for less than the policy fails validation. A workflow cannot loosen a
  policy: it can only ask for the same or stronger isolation.

**Fail closed**

- [ ] AC-04. When a step asks for a sandbox and its backend is unavailable (no engine, engine not running, image
  missing and not obtainable, no permission), the step fails with a plain-words message that names the one action to
  take. It never runs on the host, and the fallback list of `transport-priority` does not select a host-side runner to
  get around it (a fallback runner that cannot honor the sandbox is skipped, not run).
- [ ] AC-05. A runner that executes code on the host and does not implement the sandbox request is refused for any step
  whose `sandbox` is not `none`. A runner that executes nothing locally (the HTTP API runners) is exempt, and the trace
  says `sandbox: not_applicable`. Which a runner is, is declared by the runner, not guessed (section 8 C-06).

**Automation: nothing to do by hand**

- [ ] AC-06. If the container engine is installed and running, no setup is needed. Indaba obtains the image itself:
  pulls a published base image by digest, or builds one from a definition Indaba generates (the base, the agent CLI the
  step's runner needs, a non-root user). The person writes no Dockerfile. Built images are cached, named by the hash of
  their definition, and reused.
- [ ] AC-07. Agents the step needs (`claude`, `codex`, `gemini`, `opencode`, an ACP registry agent) are installed into
  the image by Indaba, using the same consent, allowlist, checksum and size rules as `acp-agent-install`. The consent is
  asked once per agent and version and covers the image, not each run.
- [ ] AC-08. `indaba sandbox doctor` reports, without changing anything, the engine found (Docker or Podman, and its
  version), whether it is running, whether the user may use it, free disk for images, the platform (Linux containers on
  Windows need WSL 2 or Hyper-V), and the images cached. Every failure has one next action.
- [ ] AC-09. `indaba sandbox setup` performs that action when Indaba can: start a stopped engine, add nothing without
  consent, and where the engine itself is missing, run the platform's package manager (`winget`, `brew`, `apt`) as an
  argument vector after showing the exact command and getting a yes. It never runs a downloaded script and never elevates
  silently. Where the operating system forces an administrator step (a Windows feature, a reboot, a license acceptance),
  setup stops there, says so, and `doctor` resumes from where it left off.
- [ ] AC-10. With no terminal (CI, hosted), nothing is installed. The step fails with the AC-04 message unless the
  operator enabled automatic setup in configuration.
- [ ] AC-11. Containers and temporary images are removed when the step ends, fails or is cancelled. Every container is
  named by the run and step (`indaba-<runId>-<stepId>-<n>`) and labelled, so `indaba sandbox clean` removes what a crash
  left, and nothing else.

**What the sandbox gives the agent**

- [ ] AC-12. The agent sees exactly one writable thing: the step's workspace (the copy or worktree of `isolation`),
  mounted at a fixed path. Nothing else of the host is visible unless listed under `mounts`, and those are read-only.
  Home directories, the project's own `.git` and `.indaba/` are never mounted.
- [ ] AC-13. The process runs as a non-root user with all capabilities dropped, `no-new-privileges`, a read-only root
  filesystem plus a temporary scratch area, and the limits from `cpus`, `memory_mb` and `pids`. No privileged mode, no
  host network mode, no device, no container-engine socket inside, ever.
- [ ] AC-14. `network: none` gives no network. `agent_api` allows only the hosts the step's runner needs (its model
  provider), through an egress proxy Indaba starts beside the container; `full` is unrestricted and is refused by a
  policy that forbids it. Where a backend cannot enforce `agent_api`, it fails the step rather than weakening it
  (section 8 C-05).
- [ ] AC-15. Only the environment variables named in `env`, and the credentials the runner itself requires, enter the
  sandbox, passed by name to the engine so the value is not on any command line, in any log, any image layer or any
  trace.
- [ ] AC-16. The step's output and exit code, the timeout, the abort signal and the PTY mode behave as in
  `ProcessSpawner` today. Cancelling stops the container by its name, not only the local client process.

**Observability**

- [ ] AC-17. A step's span records `indaba.sandbox.kind`, `indaba.sandbox.backend`, `indaba.sandbox.image_digest`,
  `indaba.sandbox.network` and the limits; it records the names of passed variables and never their values. An image
  build and a doctor result are events. `watch` and the dashboard show the kind and the digest.

**Extension**

- [ ] AC-18. A backend is a `SandboxBackend` registered through `PluginHost.registerSandbox`. The built-in container
  backend registers the same way and has no access a plugin lacks. A backend failing, or throwing, fails only the step
  that used it.

## 4. Non-goals

- **Not a promise against every attack.** A container shares the host kernel. It stops accidents and most hostile
  behaviour; it is not the answer to a determined kernel exploit. That is what the `vm` kind is for, and the
  documentation says this in those words (no claim of "secure" without that qualification).
- **No sandbox for the engine itself.** The engine, its guards and its confinement checks stay on the host and trusted.
  Only the programs an agent step starts are isolated.
- **No container orchestration.** No Kubernetes, no swarm, no compose files. One engine on one machine, or a backend a
  plugin supplies.
- **No image registry service of ours.** Base images come from public registries by digest, or are built locally.
- **No Windows containers.** Linux containers (through WSL 2 or Hyper-V) only; the agents are Linux programs.
- **Not a billing or quota system.** Limits stop a runaway process; metering belongs to `step-budgets` and the hosted
  service.
- **The hosted service is not built here.** This spec is the part of it that must exist first.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the engine is not installed | step fails, message names `indaba sandbox setup`; never runs on the host |
| the engine is installed but stopped | `setup` starts it; a run starts it only if the configuration allows, otherwise fails with the message |
| the image cannot be pulled or built (offline, disk full) | step fails with the cause; a cached image for the same definition is used if present |
| the agent exits non-zero | as any runner: the step's failure handling applies; the container is removed |
| the timeout elapses | the container is killed by name, then removed; exit code and `timedOut` as today |
| the run is cancelled | the same, within the existing abort grace; teardown does not honor the abort signal |
| the out-of-memory killer or the pids limit trips | reported as a distinct, plain-words failure, not a generic exit code |
| the network is `none` and the agent needs its API | the runner reports it could not reach its provider; the message suggests `agent_api` |
| the egress proxy cannot start | step fails closed; no direct network is offered instead |
| Indaba crashes mid-step | labelled containers remain; `indaba sandbox clean` and the next run's start-up sweep remove those whose run is gone |
| a plugin backend throws | only that step fails; other steps and the run continue per `on_failure` |
| policy forbids the requested kind | validation fails before any step starts |

## 6. Security and data handling

**Untrusted:** everything the agent does and writes, the workflow file (when downloaded), the image contents, and any
path or name derived from them. **Trusted:** the engine process, the policy, and the definitions Indaba generates.

- Every command to the container engine is an argument vector (`spawn`, never a shell string). Names, labels, paths and
  environment names pass the strict name check the worktree code uses; a value that fails it is refused, not escaped.
- The generated image definition is passed on standard input or as a build context Indaba writes to a confined temporary
  folder. It contains no secret. A secret never enters an image layer, a build argument, a label or a command line.
- The only host path ever mounted writable is the step's workspace, resolved and checked inside `.indaba/worktrees`. A
  `mounts` entry must be absolute, must exist, is mounted read-only, and is refused when it is or contains the home
  directory, a filesystem root, the engine socket, or a path the policy forbids.
- The container engine's own socket is never mounted. A process that can reach it owns the host.
- The egress proxy allows hosts by exact name from the runner's declared needs, resolves them itself, and refuses
  addresses in private, loopback and link-local ranges (the metadata address of a cloud host included) so an allowed
  name cannot be turned into a request to the inside of the network.
- Login state of an agent CLI (its token files) is never mounted from the person's home. The credential an agent needs
  is passed by name (`env`) or created inside the sandbox by the runner's own login flow, and kept in a per-agent volume
  Indaba owns, removable with `indaba sandbox clean --credentials`.
- Output from the sandbox goes through the same sanitizer and secret redaction as any runner output before it reaches a
  trace, an event or a terminal.
- `doctor` output and error messages name the engine and the next action, never environment values or file contents.

## 7. Where it lives

- `@indaba/core` (pure; no `node:` module): `SandboxKind`, `SandboxSpec`, `SandboxPolicy`, `SandboxBackend`,
  `PreparedLaunch`, `SandboxStatus`, `SandboxUnavailableError`, `PluginHost.registerSandbox`, the optional `sandbox`
  field on `RunRequest`, the optional `Runner.execution` declaration, the workflow model fields and their validation.
- `@indaba/engine`: parsing and validation of `sandbox`, policy resolution per step, passing the resolved spec to the
  runner through `RunRequest`, the sweep of leftovers, span attributes and events, the confinement of mounts.
- `@indaba/runners`: runners that spawn processes call `SandboxBackend.prepare` and hand the **wrapped argument vector**
  to the existing `ProcessSpawner`. `ProcessSpawner`, the PTY path and the kill logic are unchanged in shape; the wrapper
  only changes what they start.
- `indaba` (the CLI): the built-in container backend (Docker and Podman, through the engine's command-line client), image
  definition and caching, the egress proxy, `indaba sandbox doctor | setup | clean`, configuration, the composition root
  registering it through the same `PluginHost`.
- Contract between them: `SandboxBackend` of `api-surface.md`. Nothing in `@indaba/core` knows what Docker is.

The container backend lives in the CLI package and not in `@indaba/runners` because it is infrastructure that no runner
should depend on directly, and so that `engine` and `runners` keep not importing each other.

## 8. Clarifications

All recommendations; the maintainer confirms.

- **C-01. The backend wraps a launch; it does not replace the spawner.** `SandboxBackend.prepare(launch)` takes what
  would have been started on the host (argument vector, working directory, environment names, mount of the workspace)
  and returns the vector that starts it inside the sandbox (`docker run ...`, or `limactl shell ...`, or a VM
  controller's command), plus a `terminate()` and a `cleanup()`. That keeps the PTY path, the process tree kill, the
  timeout and the streaming exactly as they are, and it is expressive enough for a container (one command) and for a
  virtual machine (boot, run, stop) with the lifecycle held in `prepare` and `cleanup`. Alternative rejected: a second
  spawner that reimplements streaming and kill for each backend.
- **C-02. `container` and `vm` are two kinds, not one.** A virtual machine gives a separate kernel and is what the hosted
  service needs for hostile tenants; a container is what a person on a laptop already has. The contract is the same,
  so supporting `vm` means a backend, not a redesign. **Decided by the maintainer (2026-10-25): the `container` backend
  is built in this repository; the `vm` backend is not part of it.** A `vm` backend is a plugin that registers through
  `registerSandbox` like any third party's, with no access a plugin lacks. What stays here, so a workflow is the same
  file wherever it runs: the `vm` kind, the `SandboxBackend` contract, the policy (`minimum: vm` included) and the
  validation. Without such a plugin, `kind: vm` fails validation (AC-02) and the message names the missing backend; it
  never falls back to a container or the host.
- **C-03. The image is generated; `image` is an escape hatch.** With no `image`, Indaba builds from its own definition
  (a small Linux base pinned by digest, the agents the steps need, a non-root user, `git` only if a step needs it).
  With `image`, Indaba uses the named image as is and installs nothing into it, and the person is told the agent must be
  inside it. Pinning by digest and recording it in the trace is what makes a run reproducible.
- **C-04. Docker and Podman, one code path.** Both take the same options for what this needs. Detection order: the one
  named in configuration, then Podman (rootless by default), then Docker. Docker Desktop's license terms are the user's
  business; the documentation says Podman is a free alternative and `setup` can install either.
- **C-05. Network policy honest about what a container can enforce.** `none` is cheap and exact. `agent_api` needs an
  egress proxy and a network the container cannot leave except through it, which both engines can do with an internal
  network and a proxy container. If the platform cannot (rootless networking differences), the step fails with the reason;
  it does not degrade to `full`. `full` exists because some tools need it and is the first thing a hosted policy forbids.
- **C-06. A runner declares where it executes.** `Runner.execution` is `host` (it starts local processes: shell, agent
  CLIs, ACP agents), `remote` (it only makes HTTP calls: OpenRouter and compatible) or absent (treated as `host`, the safe
  reading). A step with a sandbox and a `host` runner that does not also declare it supports the request is refused.
  Absent is optional so a third-party runner keeps compiling (api-surface.md).
- **C-07. Files inside and outside agree through the workspace mount.** The step's workspace is mounted at `/work`, and
  the working directory is translated. A git worktree contains a `.git` file pointing at the main repository's git
  directory, which is deliberately not mounted, so `git` commands inside a sandboxed worktree step do not work. Changes
  are still computed by the engine on the host, from the mounted folder, as today. A step that needs git inside the
  sandbox uses `isolation: copy` plus a repository created in the copy (a documented pattern), or it runs unsandboxed.
  Stated as a limit, not hidden.
- **C-08. ACP agents and MCP servers.** An ACP agent is started inside the sandbox; the filesystem and terminal requests
  it makes of Indaba are answered by Indaba on the host against the workspace, which is why the permission rules of
  `transport-priority` still hold. An MCP server named by a step is started where the step runs (inside), unless its
  definition says it must run on the host, in which case the policy decides. **Open:** MCP servers that need a host
  resource (a local browser, a desktop app) cannot be sandboxed; the first version refuses them under a sandbox.
- **C-09. Automation has one honest limit.** Indaba can pull, build, start, stop, clean and sweep with no help. It cannot
  install a container engine without an operating-system privilege, a license acceptance on some platforms and
  sometimes a reboot. So the promise is: *Indaba does everything it is allowed to do, asks once for the rest, shows the
  exact command, and resumes*. A hosted service ships with the engine in its own image, so the person there never sees it.
- **C-10. Default stays `none`.** A changed default is a major (AC-02, the repository's rule), and most local use is
  trusted. The hosted service and `indaba.config` can raise the floor. A future major may change the default after use
  shows it is safe to.
- **C-11. Cost of isolation is reported, not hidden.** A first run builds an image (minutes, hundreds of MB, shown with a
  size estimate before it starts) and every step pays a container start. No number is claimed here; the first
  measurement is a stage 7 task, and the figures in documentation come from it.
- **C-12. Windows and macOS.** Linux containers run in a VM the engine manages (WSL 2 on Windows, a hypervisor on macOS).
  Bind-mounted folders cross that boundary slower and with path translation. The backend converts the workspace path to
  the engine's form and refuses a path it cannot translate; `doctor` flags a project on a network or cloud-synced
  folder. This is where the first real-world friction is expected, and phase 0 of the plan is to run it on the
  maintainer's Windows machine.

## Artifacts not written

- `plan.md`: planning waits for the clarifications above to be confirmed.
- `tasks.md`: nothing to schedule until the plan exists.
- `research.md`: the engines (Docker, Podman) and the microVM candidates are compared at plan time against measured
  start-up cost, which does not exist yet.
- `data-model.md`: the only state is the image cache index and the credential volumes, described in `api-surface.md`.
- `events.md`: the events (`sandbox.image.build`, `sandbox.start`, `sandbox.stop`, `sandbox.cleanup`) are listed in
  `api-surface.md` because there are four and each is one line.
