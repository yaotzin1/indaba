# Specification: terminal dashboard comes with `indaba`

> **Status**: Implemented, pending review (see `review.md`)
> **Stage entry**: 1 (stages 2 to 5 are folded into this file; the feature is a packaging change with no runtime logic)
> **Semver impact**: minor (confirmed in `api-surface.md`)

---

## 1. The problem

`@indaba/tui` is an optional peer dependency of `indaba`. `npx indaba@next watch` or `indaba run --tui` therefore starts
without a dashboard, prints a hint to install a second package, and falls back to plain lines. The terminal dashboard is
the rich view of Indaba and the way most people watch a run; having to find and install it separately is a hurdle,
especially for people who run Indaba for regular tasks and do not know what a peer dependency is.

## 2. User stories

- **US-01.** As a person who runs `npx indaba@next run wf.yml --tui` or `watch`, I get the dashboard without installing anything else.
- **US-02.** As a person who wants the browser view, I still choose to install `@indaba/server`, and the docs show the one `npx` line that does it.
- **US-03.** As a person on a machine where Ink cannot load, `indaba` still works in plain output and says why.

## 3. Acceptance criteria

- [x] AC-01. `indaba`'s `package.json` lists `@indaba/tui` under `dependencies` and not under `peerDependencies`
      (`packages/cli/test/manifest.test.ts`).
- [x] AC-02. `@indaba/server` stays an optional peer dependency and is not a dependency (same test).
- [x] AC-03. A packed install of `indaba` alone contains `@indaba/tui` where `indaba` resolves it, and does not contain
      `@indaba/server` or `@indaba/web` (`scripts/smoke-pack.mjs`).
- [x] AC-04. When the dashboard fails to load, `watch`, `settings` and `run --tui` say it could not be loaded and why; no
      message tells the user to `npm install @indaba/tui` (`watch-screen`, `settings`, `run-tui` tests).
- [x] AC-05. The docs say the dashboard comes with `indaba` and the web view does not, and give
      `npx -p indaba@next -p @indaba/server@next indaba ui`.

## 4. Non-goals

- Making `@indaba/server` a dependency. Decided by the maintainer on 2026-11-06: the terminal view is the rich one, the web view is a nicer copy of it and stays optional.
- Downloading `@indaba/server` at run time. The CLI never runs an installer: code fetched on demand would sit outside the lockfile and provenance chain.
- Importing `@indaba/tui` statically. It is still loaded with a dynamic `import()`, so `validate`, `plan`, `report` and the rest never load Ink and React, and a failed load degrades to plain output.
- Any change to the dashboard itself, to `indaba ui` or to its message.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| `@indaba/tui` cannot be loaded (broken install, unsupported Node) | `watch` and `settings` print plain output and one line on stderr naming the reason; `run --tui` starts nothing and exits 2 |
| `@indaba/server` is not installed | unchanged: `indaba ui` says what to install and exits 1 |

## 6. Security and data handling

No new input, path, process or secret. The reason printed on a failed load is the message of the import error (module names and paths), as `indaba ui` already prints.

## 7. Where it lives

`packages/cli` (manifest, three messages, `tui-loader.ts` comment). No change in `@indaba/core`, `engine`, `runners` or `tui`.

## 8. Clarifications

- **Runtime dependency decision.** `@indaba/tui` is a package of this repository, so `project.runtime_dependencies` is unchanged. It brings `ink` 8.0.0 and `react` 19.3.0 (both MIT, already in the tree of the published `@indaba/tui`) into the install of every `indaba` consumer, which is the cost of the change: a larger install for people who never open the dashboard. Accepted by the maintainer.
- **The messages** keep the text `could not be loaded` plus the reason, because a missing package is no longer a normal state.

## Artifacts not written

- `plan.md`: a manifest move and three messages; section 7 and the clarifications are the plan.
- `tasks.md`: five small edits, each listed under the acceptance criteria.
- `research.md`: nothing external is relied on.
- `data-model.md`: no data is added or changed.
- `events.md`: the feature emits no event and adds no span.
