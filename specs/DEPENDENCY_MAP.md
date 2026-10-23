# Dependency map

How the packages depend on each other, and what breaks what. Updated at stage 8 of every feature.

## Import direction

```mermaid
graph BT
    subgraph Domain["@indaba/core: pure domain, no dependencies, no node: import"]
        Core["errors, workflow model, DagBuilder, StepState"]
        Mesh["mesh: AgentMessage, Blackboard, ConsensusArbiter"]
        Contracts["Runner, RunRequest, RunResult, Guard, Adjudicator, McpCapable, Plugin, PluginHost"]
        Obs["Tracer, Span, TokenUsage, PricingTable, EventDispatcher, Clock, IdGenerator"]
    end

    Engine["@indaba/engine: parser (yaml), guards, WorkflowEngine, git workspaces, span exporter, log sinks, indaba.config"]
    Runners["@indaba/runners: ShellRunner, OpenAiCompatibleRunner, AcpRunner (presets: claude, codex, gemini, opencode), agent CLI runners incl. OpenCodeRunner (node-pty optional)"]
    Cli["indaba: run, plan, validate, watch, report, settings, plugin loading, composition root"]
    Tui["@indaba/tui: the Ink dashboard of a run (optional)"]
    Server["@indaba/server: the local server of indaba ui, HTTP and SSE over the traces; starts and stops runs through the CLI (optional)"]
    Web["@indaba/web: the page indaba ui serves; private, bundled into static files"]
    Plugin["a third-party plugin"]

    Mesh --> Core
    Mesh --> Contracts
    Contracts --> Core
    Obs --> Core
    Engine --> Domain
    Runners --> Domain
    Cli --> Engine
    Cli --> Runners
    Cli --> Domain
    Cli -. "optional peer" .-> Tui
    Tui --> Engine
    Server --> Engine
    Server --> Domain
    Web -. "types only, erased at build" .-> Domain
    Server -. "serves the built files, no import" .-> Web
    Plugin --> Contracts
    Cli -. "loads at run time (--plugin)" .-> Plugin
```

Arrows point toward the package depended on, so `@indaba/core` sits at the bottom and imports
nothing. `engine` and `runners` never import each other; only `indaba` (the CLI) knows both, and it
registers the built-in runners and the git-diff guard through the same `PluginHost` a third-party
plugin receives. The mesh depends on the `Runner` *contract*, which lives in core, never on a
runner. A plugin depends only on the contracts in `@indaba/core`.

The guards are the layers tests: `packages/core/test/architecture.test.ts` (core imports only itself,
no `node:` module), `packages/engine/test/layers.test.ts` and `packages/runners/test/layers.test.ts`
(only relative files, `node:*`, the declared dependency and `@indaba/core`; never the runners, the
engine or the CLI upward). Two more keep the edges at the top honest. `packages/cli/test/layers.test.ts`
allows only `node:`, its own files and `@indaba/core`, `@indaba/engine` and `@indaba/runners`; the CLI
reaches `@indaba/tui` at run time, never by a static import. `packages/tui/test/layers.test.ts` allows
only its own files and `@indaba/engine`, with `ink` and `react` in a single adapter file, and fails if
core, engine or runners import the dashboard, or the CLI imports `ink`, `react` or a subpath of it.
`packages/server/test/layers.test.ts` allows its own files, `node:*`, `@indaba/core` and `@indaba/engine`, and no UI
package. `packages/web/test/layers.test.ts` allows its own files, the libraries it bundles (React, `apsw-gridwright`,
`@xyflow/react`, `@dagrejs/dagre`, the fonts) and `import type` from `@indaba/core`, and no `node:` module; it fails if
any other package imports the page. The page's libraries are build-time dependencies of a private package, so none of
them enters a consumer's tree. A new edge is a design question first
and a test change second.

## Progress

What is done and what is not, from the first day a spec was written to its last change, or to today
(2026-10-16) when nothing has shipped. Every date is a commit date from git; a bar is the time the spec
directory was being worked on, not an estimate. Grey is implemented; blue is specified and waiting.
The Status column of the next table gives the same facts with the exceptions.

```mermaid
gantt
    dateFormat YYYY-MM-DD
    axisFormat %d %b
    section Implemented
    workflow-engine        :done, 2026-10-03, 2026-10-04
    agent-mesh             :done, 2026-10-03, 2026-10-04
    runner-adapters        :done, 2026-10-03, 2026-10-04
    git-workspace          :done, 2026-10-03, 2026-10-04
    observability          :done, 2026-10-03, 2026-10-04
    cli                    :done, 2026-10-03, 2026-10-04
    mcp-support            :done, 2026-10-04, 1d
    typescript-port        :done, 2026-10-04, 2026-10-10
    tui                    :done, 2026-10-04, 2026-10-10
    transport-priority     :done, 2026-10-05, 2026-10-10
    debate-arbiter         :done, 2026-10-10, 1d
    opencode               :done, 2026-10-10, 1d
    attempt-history        :done, 2026-10-14, 1d
    watch-workflow-name    :done, 2026-10-14, 1d
    logging                :done, 2026-10-20, 2026-10-21
    section Specified, not started
    web-app                :active, 2026-10-04, 2026-10-16
    web-app-actions        :done, 2026-10-22, 1d
    web-app-editing-core   :done, 2026-10-22, 1d
    acp-agent-install      :active, 2026-10-05, 2026-10-16
    debate-findings        :active, 2026-10-10, 2026-10-16
    ruling-channel         :active, 2026-10-10, 2026-10-16
    voter-arbiter          :active, 2026-10-10, 2026-10-16
    step-variants          :active, 2026-10-10, 2026-10-16
    step-verdicts          :active, 2026-10-10, 2026-10-16
    step-budgets           :active, 2026-10-10, 2026-10-16
    workflow-editor        :active, 2026-10-22, 2d
    run-blackboard         :active, 2026-10-11, 2026-10-16
    workflow-inputs        :active, 2026-10-11, 2026-10-16
    workspace-without-git  :active, 2026-10-11, 2026-10-16
    workflow-registry      :active, 2026-10-12, 2026-10-16
    single-step-run        :active, 2026-10-12, 2026-10-16
    agent-sandbox          :active, 2026-10-12, 2026-10-16
```

`desktop-app` was dropped and is left out of the chart.

## Feature to package

| Feature (spec) | Status | Packages |
| :--- | :--- | :--- |
| `typescript-port` | Implemented | all |
| `workflow-engine` | Implemented | `@indaba/core` (model, DAG, state), `@indaba/engine` (parser, guards, engine) |
| `agent-mesh` | Implemented | `@indaba/core` |
| `debate-arbiter` | Implemented (T16, `Adjudicator.description`, delivered with `workflow-editor`) | `@indaba/core` (`Adjudicator` contract, `PluginHost.registerAdjudicator`, the `arbiter` step field), `@indaba/engine` (parser, decision ledger, debate records, `StepExecutor`), `indaba` (the terminal arbiter) |
| `runner-adapters` | Implemented | `@indaba/core` (contract), `@indaba/runners` |
| `transport-priority` | Implemented, except T-22 (the runner contract test helper) | `@indaba/core` (runner chain, permissions model, glob, span events), `@indaba/engine` (parser, fallback loop, scope guard), `@indaba/runners` (API and ACP runners), `indaba` |
| `git-workspace` | Implemented | `@indaba/engine` |
| `observability` | Implemented | `@indaba/core` (tracer, value types), `@indaba/engine` (exporter) |
| `cli` | Implemented | `indaba` |
| `tui` | Implemented, except one manual run on Windows Terminal | `@indaba/engine` (event stream, run view model, sanitizer), `@indaba/tui` (the dashboard), `indaba` (`watch`) |
| `mcp-support` | Implemented | `@indaba/core` (capability contracts), `@indaba/engine`, `@indaba/runners` |
| `opencode` | Implemented | `@indaba/runners` (`OpenCodeRunner`, the `opencode` ACP preset) |
| `attempt-history` | Implemented | `@indaba/engine` (`AttemptView`, `StepView.history`, plain output), `@indaba/tui` (detail pane) |
| `watch-workflow-name` | Implemented | `@indaba/engine` (`RunSummary.workflow`), `indaba` (`watch`) |
| `logging` | Implemented, except the web Settings screen (T-12, `feat/web-app-logging`) | `@indaba/core` (contract, settings, redaction), `@indaba/engine` (file, GELF and HTTP-JSON sinks, `indaba.config`, the event bridge), `@indaba/runners` (process and HTTP records), `@indaba/tui` (the Settings screen), `indaba` (the composition root, `report`, `settings`). No dependency added |
| `web-app` | In progress: delivery step 1 (the server, the page, Runs and Run, `indaba ui`) and the Settings screen are merged; step 2 has its first slice in `web-app-actions`; step 3 (editing) is planned in `plan-step-3.md` | `@indaba/core` (contract types, `RunState.structure`), `@indaba/engine` (`indaba.workflow.structure`), `@indaba/server`, `@indaba/web` (private), `indaba` (`ui`) |
| `web-app-actions` | Implemented (merged, #59), except the real-browser check at 320 px (see its `review.md`) | `@indaba/core` (contract types, `canStop`), `@indaba/server` (`RunControl`, three resources, `Origin` required on writes), `@indaba/web` (Run a workflow panel, Stop), `indaba` (`run-control/`, `kill()` of the run child). No dependency added |
| `web-app-editing-core` | Implemented (merged, #60), except the real-browser check (see its `review.md`) | `@indaba/core` (source types), `@indaba/server` (`WorkflowStore`, three resources), `@indaba/web` (the source view), `indaba` (`run-control/source.ts`). No dependency added |
| `workflow-registry` | Not started (specified) | `@indaba/core` (contract), `@indaba/engine` (file store), `indaba` |
| `single-step-run` | Not started (specified) | `@indaba/core`, `@indaba/engine`, `indaba` |
| `agent-sandbox` | Not started (specified) | `@indaba/core` (contracts), `@indaba/engine`, `@indaba/runners`, `indaba` (container backend) |
| `acp-agent-install` | Not started (specified) | `@indaba/core` (registry types), `@indaba/runners` (installer, store), `indaba` (`agents`, the consent prompt) |
| `debate-findings` | Not started (specified) | `@indaba/core`, `@indaba/engine`, `indaba` |
| `ruling-channel` | Not started (specified) | `@indaba/core`, `@indaba/engine`, `indaba` |
| `voter-arbiter` | Not started (specified) | `@indaba/core`, `@indaba/engine`, `indaba` |
| `step-variants` | Not started (specified) | `@indaba/core`, `@indaba/engine`, `indaba` |
| `step-verdicts` | Not started (specified) | `@indaba/core`, `@indaba/engine`, `indaba` |
| `step-budgets` | Not started (specified) | `@indaba/core`, `@indaba/engine`, `@indaba/runners`, `indaba` |
| `workflow-editor` | Implemented: part 1 (`diagnose`, #61), part 2 (`WorkflowDocument`, the schema, `indaba schema`, #62), part 3 (descriptions, `indaba catalog`, on `feat/workflow-editor-catalog`). Voters and prompts in the catalog wait for their specs | `@indaba/core` (descriptions, part 3), `@indaba/engine` (`diagnose`, `editor/`), `indaba` (`schema`, `catalog`). Dev dependency: `ajv` (test only) |
| `workspace-without-git` | Not started (specified) | `@indaba/core`, `@indaba/engine`, `indaba` |
| `run-blackboard` | Not started (specified) | `@indaba/core`, `@indaba/engine`, `indaba`, `@indaba/tui` |
| `workflow-inputs` | Not started (specified) | `@indaba/core`, `@indaba/engine`, `indaba`, `@indaba/tui` |
| `desktop-app` | Dropped | kept for history |

## What breaks what

- Changing `Runner`, `RunRequest` or `RunResult` in core breaks every runner, the mesh participant
  and every plugin's runner: a major.
- Changing `Guard`, `Plugin`, `PluginHost`, `Adjudicator` (including its `RulingRequest`) or `McpCapable`
  breaks every plugin: a major.
- Changing `Logger`, `LogRecord` or `LogSink`, or what the redaction removes, changes every plugin sink and every
  log a person sends: the record shape is a major; a redaction that removes more is a minor, one that removes less
  is a major.
- Changing what goes into the decision ledger's key changes which rulings are reused: a major.
- Changing a workflow model type or the schema breaks the parser, the engine and every workflow file
  in the wild: a major.
- Renaming a span attribute or an event breaks consumers' dashboards and listeners: a major.
- Adding a member to a string-literal union (a step status, a failure action) breaks consumers who
  switch over it exhaustively.
- A new runtime dependency changes every consumer's dependency tree; it is a recorded decision
  (`project.runtime_dependencies` and `project.optional_dependencies` in `workflow.ai.yml`). Today:
  `yaml` in the engine, `ink` and `react` in `@indaba/tui` (which only the optional dashboard loads), and optionally `node-pty` in the runners.

## Runtime state, not code

`.indaba/worktrees/`, `.indaba/traces/` and `.indaba/artifacts/` are produced by Indaba when it runs,
and are gitignored. `.indaba-decisions/` (the arbiter ledger) is also written by Indaba but is committed on purpose. They are unrelated to the development workflow file at the repository root.
