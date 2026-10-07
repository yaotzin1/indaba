# Research: Terminal UI

> Stage 2 artifact, 2026-10-05. Everything under "Measured" was measured by installing the packages into an
> empty scratch folder outside the repository and reading each package's `package.json`. Everything under
> "Reported" comes from web search results and was **not** verified. Versions move: repeat the measurement
> when the dependency decision is recorded.

## The licensing rule

Indaba is open source under the MIT license, and every dependency, transitive ones included, must be open
source and MIT-compatible (maintainer's standing rule). Permissive licenses (MIT, ISC, BSD) pass. A dual
license passes when one option is permissive (`MIT OR CC0-1.0` is used under MIT). Anything proprietary,
source-available or copyleft is a finding, not an addition.

## Question 1: which library

### Measured: Ink

```
ink@8.0.0, react@19.3.0 (installed with `npm i ink react`)
39 packages in the whole tree, 19 MB on disk
  MIT                37
  ISC                 1   signal-exit@3.0.7
  (MIT OR CC0-1.0)    1   type-fest@5.10.0
```

- Ink: MIT; `engines.node >=22` (Indaba's own floor, so no change to supported Node); 23 direct dependencies
  (`chalk`, `string-width`, `wrap-ansi`, `yoga-layout`, `react-reconciler` and similar terminal helpers).
- Peer dependencies: `react >=19.3.0`, `@types/react >=19.3.0`, and `react-devtools-core >=6.1.2`. The last
  is an optional development aid; it is not part of the 39 above and its license was **not** checked.
  Rule: do not install it.
- No package in the tree has a license outside the permitted set.

### Measured: `@clack/prompts` (for comparison)

`@clack/prompts@1.8.1`, MIT, Node `>=20.12`, 4 direct dependencies, all MIT in the tree measured above.
It offers prompts (select, confirm, text, spinner), not layout, so it is a candidate for nicer *prompts*
only, not for the dashboard.

### Alternatives considered

| Option | Verdict |
| :--- | :--- |
| Ink 8 + React 19 | recommended: layout (flexbox), components, keyboard handling and redraw are what a live DAG with panes needs |
| thin ANSI layer on `node:readline` and `node:tty` | no dependency and a tiny attack surface, but every widget, resize and diffing redraw is code Indaba would own; reasonable only for the plain view |
| `@clack/prompts` | prompts only; could replace the login picker later, separately |
| `@inquirer/prompts` | prompts only |
| `blessed` and forks, `terminal-kit` | lower level, older; not evaluated further |

### Reported, not verified

- Ink is said to be used by several large command line tools (Claude Code and Gemini CLI among them); this
  came from a search summary and is **not** a reason to adopt it.
- Ink works on Windows Terminal; legacy `cmd.exe` is the weak spot. **Needs a check on a real machine.**

### Costs of Ink to weigh

- React is a runtime dependency of a TypeScript command line tool that otherwise has two (`yaml`, optional
  `node-pty`). The tree is 39 packages against a handful today. It is confined to an optional package, so
  `indaba` itself gains none.
- Its API follows React's major versions; the package must pin exact versions and isolate every import in
  one adapter folder (spec section 7), so a breaking release is one place to fix.
- JSX needs a compiler option (`jsx`) that root `tsconfig.base.json` does not set and the governance
  protects (a `Workflow-Change:` trailer). Avoid it with `React.createElement` or a package-level
  `tsconfig`, to be confirmed at plan time (spec question 4).

## Question 2: what the TUI can read today

Measured on a run through the built CLI, and read from `packages/cli/src/engine-factory.ts`:

- `JsonlSpanExporter` is registered on `SpanEnded` only. A span appears in the file **when it ends**, with
  `trace_id, span_id, parent_span_id, name, start, end, duration_ms, status, status_message, attributes`
  and, since `transport-priority`, `events` when it has any.
- `StepStatusChanged` (`PENDING -> RUNNING -> VALIDATING -> COMPLETED`, with a reason) is dispatched and
  printed by the `run` command, and **never written to a file**.
- Streamed agent output (`onOutput`) is printed, not recorded.

Consequences:

1. A step that is running now is invisible in the files; only finished steps appear. The old spec's AC-03
   ("the only input is the trace") cannot deliver US-01 and US-02 as written.
2. Replay (US-06) of a finished run can reconstruct what ran from the trace, but not the step state timeline
   or the output.
3. So an event stream is the first deliverable. It is additive and independent of any UI: `span_started`,
   `span_ended`, `step_status`, `output`. Writing it to a second file keeps the existing trace byte-identical
   (spec clarification 2). The trace schema is public surface; a change to its lines would be a major after
   1.0, so the additive file is the safer shape.

## Open after research

- The dependency decision (Ink, pinned versions) is the maintainer's to record.
- Windows behaviour of Ink on legacy consoles and on Windows Terminal, on a real machine.
- Output caps for the `output` records (per record and per run) need numbers from a real long run.
- Whether `react-devtools-core` is ever pulled in by default (it should not be): check the lockfile after a
  trial install in the package.

## Sources

- Packages installed and read on 2026-10-05: `ink@8.0.0`, `react@19.3.0`, `@clack/prompts@1.8.1`
  (each `package.json`: `license`, `engines`, `dependencies`, `peerDependencies`).
- Search results on Node terminal UI libraries (Ink, `@clack/prompts`, `@inquirer/prompts`), used only for
  the "Reported" items above.
- `packages/cli/src/engine-factory.ts`, `packages/engine/src/observability/jsonl-span-exporter.ts`,
  `packages/cli/src/main.ts` (what is and is not written to a file).

## Recorded at implementation (2026-10-07)

- **Pinned, exactly, in `packages/tui/package.json` and the lockfile:** `ink@8.0.0`, `react@19.3.0`, and
  `@types/react@19.3.0` (a development dependency, not shipped). `react-devtools-core` is not installed.
- **License check re-run** with `pnpm --filter @indaba/tui licenses list --prod` against the lockfile: 40 packages
  in the production tree of `@indaba/tui` (this includes `@indaba/engine` and what it brings), 38 MIT, 1 ISC and
  1 `(MIT OR CC0-1.0)`, used under MIT. No package outside the permitted set, so the rule in the first section holds.
- The tree grew from the 39 measured on 2026-10-05 only by the workspace link to `@indaba/engine` and its own
  dependency; Ink and React themselves are the same versions.

