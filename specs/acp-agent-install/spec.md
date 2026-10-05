# Specification: Installing ACP agents on demand

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 (clarifications in section 8 are open)
> **Semver impact**: minor (new commands, one new workflow key, new user-level files; below 1.0)
> **Builds on**: [`specs/transport-priority`](../transport-priority/spec.md) (the `acp` runner, `agent:`).
> **Decided by the maintainer**: ask before every new agent or version and remember the answer per agent
> and version; the source of agents is the official ACP registry, limited by an allowlist.

---

## 1. The problem

The `acp` runner starts an agent program, and the person has to have installed it first. Editors such as
JetBrains solve this with an agent registry: pick an agent, and the IDE downloads and updates it. Today in
Indaba the person must find the right command, install the program, and on Windows avoid the `npx` shim
(which Indaba does not start). Real example: the official Antigravity ACP agent is a 430 MB native binary
that JetBrains had already downloaded, while Indaba could not use it until its path was written by hand.

Downloading and then running an executable is also the riskiest thing a tool like this can do, so it must
be explicit, narrow and verifiable, and never something a workflow file can trigger.

## 2. User stories

- **US-01.** As a person running a workflow that names a registry agent, I am offered to install it if it
  is missing, see exactly what will be downloaded, and say yes or no.
- **US-02.** As a person who answered yes once, I am not asked again for the same agent and version, and am
  asked again when the version or the download changes.
- **US-03.** As a person, I can list what is installed, install an agent ahead of time, and remove one:
  `indaba agents list | install <id> | remove <id>`.
- **US-04.** As a person on CI, nothing is downloaded unless I turned that on explicitly.
- **US-05.** As a person with a fallback list (`[acp, antigravity]`), a missing or declined agent is a runner
  that could not run, and the list moves on.
- **US-06.** As the maintainer, I know what Indaba installed, from where, with what checksum and under what
  license, and that no workflow file could have made it install anything.

## 3. Acceptance criteria

- [ ] AC-01. A workflow names a registry agent with `agent: { registry: "<id>" }` (optionally `auth`). It is
      resolved against the registry only when the agent is not installed.
- [ ] AC-02. A missing agent is **never** downloaded without a yes from the person, shown before anything
      is fetched: the agent's name and version, publisher (`authors`), license and its URL, the download
      URL and host, the archive size when known, whether a SHA-256 is published, and where it will be put.
- [ ] AC-03. The yes is remembered per agent id and version in a user-level file (never in the project and
      never in a workflow file). A different version, URL host or archive digest asks again.
- [ ] AC-04. With no terminal, nothing is downloaded and the runner could not run, with a message naming
      the command that installs it (`indaba agents install <id>`), unless `INDABA_ACP_AUTO_INSTALL` is set
      (section 8, question 3).
- [ ] AC-05. Only `https:` URLs on an allowlisted host (and only the registry's own host for the registry)
      are fetched, including after redirects; a redirect off the allowlist fails. Size is capped, and the
      cap is checked while streaming, not after.
- [ ] AC-06. When the registry publishes a SHA-256 the archive is verified before anything is extracted and a
      mismatch deletes the download and fails. When it publishes none, the consent says so, and the answer
      is remembered together with the digest actually received, so a later change is noticed.
- [ ] AC-07. Extraction cannot escape its folder (absolute paths, `..`, drive letters, links, device names
      are refused), caps the total size and file count, and sets no permission bit beyond the one executable
      the registry names.
- [ ] AC-08. Installs go to a per-user location, one folder per id and version, written atomically (temp folder
      then rename); an interrupted install leaves nothing that looks installed.
- [ ] AC-09. The command to run is the registry's `cmd` inside the install folder, with its `args`, started as
      an argument vector, never through a shell; its environment is the `acp` runner's allowlist.
- [ ] AC-10. For agents the registry distributes through `npx` or `uvx`, Indaba does not download anything
      itself: it shows the same consent and starts the package manager with the exact pinned package and
      version from the registry. A missing `npx` or `uvx` is a runner that could not run.
- [ ] AC-11. `indaba agents list` shows installed agents (id, version, source, checksum status, license);
      `install <id>` and `remove <id>` do what they say; `remove` deletes only what Indaba installed.
- [ ] AC-12. The registry fetch is cached with a short lifetime; offline, a cached copy is used and an
      installed agent still runs without any network.
- [ ] AC-13. A trace records `indaba.acp.install` (id, version, host, `checksum: verified | none`) when an
      install happens, and nothing about the download URL's query string or any credential.
- [ ] AC-14. Every dependency added for this (archive extraction) is open source and MIT-compatible,
      transitively, and the license check is in `research.md`.

## 4. Non-goals

- **Installing anything from a workflow file.** A workflow can name an id; it cannot name a URL, a command to
  download or a checksum, and cannot turn auto-install on.
- **Bundling or redistributing any agent.** Indaba downloads to the person's machine on their behalf, as an
  editor does; it ships no agent.
- **Updating agents in the background.** A newer version is offered when the registry has one and a run needs
  it; nothing updates silently.
- **A package manager.** No dependency resolution, no uninstall of anything Indaba did not install.
- **Reusing another application's install** (such as JetBrains' folder) in v1: its path depends on the IDE
  version. A person can still point `agent: { command: [...] }` at it by hand.
- **Verifying a publisher's signature.** The registry offers none; the checksum and the allowlist are what
  there is (section 8, question 2).

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the agent is installed | run it; no network, no prompt |
| not installed, person says no | runner could not run ("declined"); a fallback list moves on |
| not installed, no terminal, no opt-in | runner could not run, naming `indaba agents install <id>` |
| the registry cannot be fetched and nothing is cached | runner could not run; names the URL host, not a token |
| the id is not in the registry | runner could not run, listing close ids |
| no build of the agent for this platform | runner could not run, naming the platform and the ones offered |
| a download or a redirect leaves the allowlist | stop, delete, report the host |
| the archive is over the size cap, or the stream stalls | stop, delete, report |
| the checksum does not match | delete, report both digests, remember nothing |
| the archive contains a path that escapes | delete everything, report; the install is not created |
| the install is interrupted | the temp folder is removed on the next run; nothing is listed as installed |
| the installed agent's files changed since install | the recorded digest of the executable no longer matches: ask again before running |

## 6. Security and data handling

An agent is arbitrary code that will run with the person's permissions and read their project, so this
feature is a supply-chain boundary. Controls: consent before any fetch (AC-02), consent never grantable by
a workflow file (non-goal 1), an allowlist of hosts and the registry host only over `https:` (AC-05),
checksum verification where published and digest pinning where not (AC-06), safe extraction (AC-07),
atomic per-user installs (AC-08), no shell (AC-09), and the existing `acp` runner limits (environment
allowlist, permissions gate, scope guard, worktree). The registry itself is untrusted data: its entries are
validated against a schema, URLs and paths in them are checked as above, and its text is shown on the
person's terminal only after control characters are removed. Download URLs are logged by host only.
Proprietary or copyleft licenses appear in the consent text; the person decides (section 8, question 4).

## 7. Where it lives

- **`@indaba/runners`**: the registry client, the installer (download, verify, extract), the install store and
  the resolution of `agent: { registry }` into a command. `AcpRunner` asks an `AgentResolver` for a command.
- **`@indaba/core`**: the `AgentSpec.registry` field and the pure parts (registry schema validation, platform
  key selection, the consent record shape). No `node:` import.
- **`indaba` (the command line)**: `agents list | install | remove`, the terminal consent prompt, the user
  config file location. It is the only place that reads `INDABA_ACP_AUTO_INSTALL` and the config directory.
- Extraction needs a zip reader; see `research.md`.

## 8. Clarifications

1. **Registry source: decided.** The official ACP registry (`registry.json` on the registry's CDN), with a
   built-in allowlist of download hosts. Pinning the registry's own URL means a person cannot be redirected to
   another registry by a workflow file; an override is an environment variable only.
2. **Integrity: open.** About half of the registry's binary entries publish no SHA-256 (measured, `research.md`),
   including Antigravity. *Recommended:* allow them only with an explicit yes that says "no checksum
   published", pin the digest that was received, and refuse them when not interactive. Alternative: refuse any
   entry without a checksum (safest, but excludes Antigravity today).
3. **Unattended installs: open.** *Recommended:* an environment variable `INDABA_ACP_AUTO_INSTALL=<id,id>`
   naming the agents (not "all"), and only for entries that publish a checksum. Alternative: none (CI must
   run `indaba agents install` first).
4. **Licenses: open.** The registry carries 15 proprietary entries, one GPL and one AGPL among 41. These are
   separate programs Indaba runs as child processes, not dependencies of Indaba, so the MIT-only rule for
   dependencies does not apply to them. *Recommended:* show the license and its URL in the consent and allow.
   Alternative: only offer registry agents with an open source license by default, and require a flag for the
   rest. **Maintainer's call.**
5. **Archive format and the zip reader: open.** Antigravity ships a zip; others ship tar.gz or bare
   binaries. *Recommended:* a small, audited, MIT zip reader as a dependency, or code Indaba writes itself on
   `node:zlib` (about 150 lines, with zip-slip tests). Decide with the dependency review in `research.md`.
6. **Where agents live.** *Recommended:* a per-user data directory (`%LOCALAPPDATA%\indaba\agents`,
   `$XDG_DATA_HOME/indaba/agents`, `~/Library/Application Support/indaba/agents`), not the project's
   `.indaba/` (large, per user, and gitignored runtime state is per project).
7. **The workflow key.** `agent: { registry: "antigravity-acp" }` (explicit, so `validate` can say that a run
   may use the network) versus letting `agent: antigravity-acp` fall through from the built-in presets.
   *Recommended:* explicit.
8. **Presets.** `claude`, `codex` and `gemini` stay as built-in presets (`npx`); whether they become registry
   lookups with the registry's exact pinned versions is a plan-time decision.

## Artifacts not written

- `data-model.md`: the install record and consent record are listed in `api-surface.md`.
- `events.md`: one span event is added and listed in `api-surface.md`.
- `plan.md`: planning waits for clarifications 2 to 5.
- `tasks.md`: nothing to schedule until the plan exists.
