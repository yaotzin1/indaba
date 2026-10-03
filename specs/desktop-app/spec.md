# Specification: Desktop application (PHP-native shell: Tauri or Electron)

> **Status**: Draft. **Specification only: nothing in this directory is implemented, and this change
> adds no code.** Implementation starts only after this spec is clarified and accepted.
> **Stage entry**: 1
> **Semver impact**: minor (a new, separately packaged application; below 1.0)
> **Sibling**: [`specs/web-app`](../web-app/spec.md) is a separate spec. This one may embed the UI
> that one builds (section 8, question 1), but the two are independently deliverable.

---

## 1. The problem

Indaba runs agents that edit code in git worktrees, call paid APIs and need developer tools installed
and authenticated on one machine. That makes the desktop the natural place to operate it, and a poor
fit for "start a server, open a browser tab, remember a token":

- a person wants to double-click an application, pick a project folder and run a workflow,
- an escalation or a finished run should reach them as an operating-system notification, even when
  the window is closed,
- credentials (OpenRouter key, anything else) should live in the OS keychain, not in shell profiles,
- the PHP runtime, `git` and the app should arrive together, so installing it is not a PHP setup task.

"PHP-native" means the application is built **with PHP as its backend**, in the way NativePHP does it:
a native shell (Electron or Tauri) hosts the UI, and a bundled PHP runtime runs Indaba. It does not
mean rewriting the engine in another language, and it does not mean Node or Rust holds any
orchestration logic.

## 2. User stories

- **US-01.** As a developer, I install one signed application on Windows, macOS or Linux and run a
  workflow against a folder I choose, with no separate PHP or Composer installation.
- **US-02.** As a developer, I am notified by the operating system when a run completes, fails or
  **escalates**, and clicking the notification opens that run.
- **US-03.** As a developer, my API keys are stored in the OS keychain and passed to a run's
  environment only for the duration of that run.
- **US-04.** As a developer, the application tells me what is missing on my machine (git, the Claude
  Code, Codex or Antigravity CLI, their login state) instead of failing mid-run.
- **US-05.** As a developer, the app keeps working offline for everything except the model calls.
- **US-06.** As a maintainer, I can build, sign and publish the application from CI for all three
  operating systems and ship updates safely.

## 3. Acceptance criteria

- [ ] AC-01 The application is its own package (`desktop/`), versioned with the repository, and
      depends on Indaba only through the run API of `specs/run-api` (the same contract as the web app).
- [ ] AC-02 The shell contains no orchestration logic. Anything that decides what runs, retries or
      stops is PHP (the engine); the shell starts the PHP runtime, hosts a window and offers native
      capabilities.
- [ ] AC-03 The PHP runtime is bundled (no system PHP required) at the version the repository's
      `composer.json` supports, with the extensions the engine needs (`pcntl` where available,
      `mbstring`, `curl`/stream wrappers for `symfony/http-client`, `zip` as required).
- [ ] AC-04 The run API listens only on loopback, on a port chosen at launch, protected by a random
      per-launch token held by the shell; no other local user or web page can drive it.
- [ ] AC-05 Native capabilities: folder picker for the project root, OS notifications (completed,
      failed, escalated), tray/menu-bar presence while runs are active, deep link
      `indaba://run/<id>`, and OS-keychain secret storage.
- [ ] AC-06 Secrets are read from the keychain at run start, injected into that run's child
      environment, and never written to disk, logs, traces, events or crash reports.
- [ ] AC-07 First-run diagnostics report: `git` present and version, each agent CLI found on `PATH` and
      its login state if the CLI can report it, whether a PTY is available (section 6), and write access
      to `.indaba/`. Each missing item links to its fix; nothing is installed silently.
- [ ] AC-08 Closing the window never kills a running workflow without asking; quitting stops the runs
      the user confirms and tears their worktrees down (existing engine behaviour).
- [ ] AC-09 Installers are produced for Windows, macOS and Linux by CI and are code-signed; macOS builds
      are notarised. Update checks are signed and verified before install; the app never auto-installs
      an unsigned update.
- [ ] AC-10 No telemetry. The only network traffic the shell itself generates is the update check
      (which can be disabled).
- [ ] AC-11 The shell's web content runs with context isolation, no Node integration in the renderer,
      a strict Content-Security-Policy, and navigation limited to the local UI and `https` links opened
      in the system browser.

## 4. Non-goals

- **No second implementation of Indaba** in Rust, JavaScript or anything else. The PHP engine is the
  product.
- **No mobile.** NativePHP's mobile targets are out of scope.
- **No bundled agent CLIs.** Claude Code, Codex and Antigravity are separate products with their own
  licences and logins; the app detects them and explains how to install them.
- **No in-app editing of code or workflows** in v1.
- **No cloud sync, accounts or hosted service.**
- **No Mac App Store or Microsoft Store distribution** in v1: their sandboxes conflict with launching
  arbitrary developer tools and writing to arbitrary project folders.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the bundled PHP fails to start | the app shows the error and the log location; no blank window |
| the run API dies | the shell restarts it once, reconnects the UI, and reports runs that were in progress as interrupted (their JSONL trace and artifacts survive; the in-memory state does not) |
| the app crashes mid-run | child agent processes are terminated with it (process group / job object); stale worktrees under `.indaba/worktrees/` are detected and offered for cleanup at next launch |
| an agent CLI is missing at run time | the run is refused before it starts, naming the CLI (the engine's preflight, surfaced) |
| the keychain is locked or unavailable | the run is refused with a clear message; secrets are never read from a fallback file |
| an update fails verification | it is discarded and the current version keeps running |
| the machine sleeps during a run | the run continues or fails on its own timeouts; the UI shows elapsed wall-clock honestly |

## 6. Security and data handling

The application starts agents that edit files and spend money, so the local API is the sensitive
surface: loopback only, per-launch token, no CORS to arbitrary origins, no cookies. The renderer
is treated as an untrusted browser: context isolation on, no Node APIs, and the narrow native bridge
exposes named operations (pick folder, store/read secret, notify), never a generic "run command".
Secrets live in the OS keychain and enter a run only through the child process environment.

**Platform limits that affect behaviour, stated up front.**
- *PTY.* The CLI runners allocate a pseudo-terminal where `Symfony\Component\Process` supports it
  (Linux, macOS). **On Windows PHP has no PTY support**, so the agent CLIs run with pipes instead of a
  TTY. Some agent CLIs behave differently without one (colour, interactive prompts, buffering).
  Whether that is acceptable, or whether Windows needs a ConPTY helper, is open question 3.
- *Developer tools on the host.* `git` (worktrees) and the agent CLIs must be installed, on `PATH`
  for a GUI-launched process (which on macOS does not inherit the shell's `PATH`), and logged in.
- *Antivirus and signing.* A bundled interpreter that spawns processes is a classic heuristic false
  positive; signing and a documented allow-list path are part of delivery, not an afterthought.

## 7. Where it lives

`desktop/` is a separate package that depends on the **run API** (`specs/run-api`, not yet written;
it is shared with the web app and must not be specified twice). The PHP engine in `src/` does not
change and does not learn about the desktop. In particular **no Laravel or Electron/Tauri code enters
`src/`**: NativePHP is Laravel-based, so if it is chosen the Laravel application lives entirely in
`desktop/` and talks to Indaba as a library or through the run API, and the pure-domain boundary test
keeps holding.

## 8. Clarifications

Open questions to resolve at stage 2. Each default chosen is inherited by every user.

1. **What does the window show?** *(Recommended)* the web app of `specs/web-app`, loaded from the local
   run API, so there is one UI. The desktop then adds only native capabilities (AC-05). The alternative,
   a second native UI, duplicates the largest piece of work and is rejected unless the web spec is.
   If the web spec is not accepted first, this spec is blocked on it.
2. **Which shell?** Three candidates, to be decided by a short spike measuring installer size, startup
   time, signing and update effort, and Windows PTY options:
   - *NativePHP Desktop* (Laravel; Electron based): the most direct "PHP-native" path, with ready
     notifications, menus, deep links and updater, at the price of a Laravel application and Electron's
     footprint. Whether it now also offers a Tauri runtime must be verified against its current docs.
   - *Tauri with a PHP sidecar* (a statically built PHP binary, for example via `static-php-cli`):
     small installers and a strong security model, at the price of Rust in the build and writing the
     sidecar lifecycle ourselves.
   - *Electron with a bundled PHP binary, no Laravel*: Electron's maturity without Laravel's weight,
     at the price of building the PHP lifecycle and updater glue ourselves.
   No default is recommended before the spike; the acceptance criteria are written to hold for all
   three.
3. **Windows PTY.** Accept pipe mode (documented), or require a ConPTY-capable helper for the CLI runners.
   Affects the engine's runner contract and therefore needs its own change if chosen.
4. **Which PHP extensions and version are bundled**, and how bundled PHP is kept patched. A bundled
   interpreter is something we now have to update for security fixes.
5. **Where does state live?** Per-project `.indaba/` (current behaviour) plus an app-level data
   directory for settings and the run index. Confirm nothing sensitive goes to either.
6. **Auto-update mechanism and channel** (stable only in v1).

## Artifacts not written

- `plan.md`: planning waits for the spike in question 2 and for `specs/run-api`.
- `tasks.md`: nothing to schedule until the spec is accepted.
- `research.md`: the shell comparison is the output of the spike named in question 2, recorded there.
- `data-model.md`: app settings are a handful of keys, defined at plan time.
- `events.md`: no new engine events; native notifications are driven by the existing step events.
