# Project INDABA: Multi-Agent Consensus & Observability Engine

The founding requirement: the mission, the domain modules and the runtime workflow contract. It was first written
for a PHP prototype that was never published; this version describes the same design as it is built, in
TypeScript for Node. The original text is in git history. `workflow.ai.yml` and `AGENTS.md` outrank this page.

## 1. Project mission & context
**Indaba** is an open-source, deterministic orchestration, debate and observability engine for AI agents (Multi-Agent Consensus & LLM Observability), written in TypeScript for Node 22+. The name comes from the Zulu tradition of a council convened to resolve complex matters and reach consensus. Unlike basic orchestrators that run CLI commands sequentially in isolated shells, Indaba provides:

1. **Multi-Agent Cross-Examination:** structured debate and verification across heterogeneous engines (Claude Code, Codex, Cursor, Antigravity, OpenCode and other agent CLIs, agents over ACP, reasoning models via OpenRouter or any OpenAI-compatible endpoint).
2. **Deterministic SDLC Pipelines:** declarative workflow files (`*.workflow.ai.yml`) as a DAG, strict quality gates, artifact-based handoffs.
3. **Real-time Observability:** telemetry aligned with OpenTelemetry GenAI Semantic Conventions (streaming spans, token usage, real-time cost, git diff inspection).

One command on any OS: `npx indaba` on Windows, macOS and Linux, with nothing to install but Node. License: MIT.

## 2. Tech stack & engineering standards
- TypeScript in strict mode (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), with no escape hatch: no `any`, no non-null assertion, no suppression comment.
- ESM packages in a pnpm workspace: `@indaba/core`, `@indaba/engine`, `@indaba/runners`, the `indaba` CLI, and the optional `@indaba/tui` and `@indaba/server` (the web view of `indaba ui`).
- Core domain strictly framework- and platform-agnostic: `@indaba/core` has no dependencies and imports no `node:` module, enforced by architecture tests.
- Infrastructure on Node itself: `child_process` with argument arrays (never a shell string), `fetch` for HTTP and Server-Sent Events, a YAML parser, and a plugin host for runners, guards and listeners.
- Biome for lint and format, Vitest with at least 85% coverage, StrykerJS mutation testing, contract-first and TDD.

## 3. Domain modules
**A. Workflow & Orchestration Engine (`@indaba/engine`)** parses, validates and executes workflow files; topologically sorts a DAG from `depends_on`; runs a state machine (`PENDING`, `RUNNING`, `VALIDATING`, `FAILED`, `ESCALATED`, `COMPLETED`). Quality gates and policy enforcers: exit codes of automated tools (`pnpm test`, `tsc`); filesystem boundaries (no changes in `src/` during RFC/architecture phases); retry-loop isolation (inject only the isolated stderr/assertion failure into the next prompt, never the full error history).

**B. Agent Inter-Communication Mesh (`@indaba/core`, `mesh/`)**: Blackboard pattern and a Consensus Arbiter. Immutable `AgentMessage` envelopes of type `PROPOSAL`, `CRITIQUE`, `AGREEMENT`, `QUESTION`, `TOOL_INTENT`. Turn-taking, infinite ping-pong detection, quorum validation (e.g. unanimous approval from `architect` and `reviewer`).

**C. Unified Runner Adapters (`@indaba/runners`)**, one `Runner` contract: agent CLI runners (`ClaudeRunner`, `CodexRunner`, `CursorRunner`, `AntigravityRunner`, `OpenCodeRunner`) spawned as child processes; an `AcpRunner` for agents that speak the Agent Client Protocol; an HTTP/SSE runner (`OpenRouterRunner`, and OpenAI-compatible endpoints) consuming Server-Sent Events for reasoning models; a `ShellRunner` for deterministic verification commands. New runners arrive as plugins, with no privileged access for the built-ins.

**D. Git Workspace Isolation (`@indaba/engine`, `workspace/`)**: ephemeral `git worktree` per task and variant (`.indaba/worktrees/{taskId}`); generate, validate and apply unified diffs (`git diff`, `git apply`); deterministic teardown on completion or cancellation (`git worktree remove --force`).

**E. Observability & Telemetry (`@indaba/core`, `@indaba/engine`)**: OpenTelemetry GenAI Semantic Conventions. Trace (task) -> Span (workflow step) -> child span (LLM call, tool execution, shell verification). Real-time input/output tokens, latency, USD cost per model. Spans are exported as JSONL and events stream to listeners in real time: the terminal dashboard (`@indaba/tui`) and the web view over SSE (`@indaba/server`).

## 4. Workflow contract (a workflow file as executed by Indaba)
The full format is in [workflow-format.md](workflow-format.md); this is the shape, and it runs as
[`examples/task-pipeline.workflow.ai.yml`](../examples/task-pipeline.workflow.ai.yml).

```yaml
version: "1.0"
name: "indaba-task-pipeline"

artifacts:
  spec: ".indaba/artifacts/spec.md"
  patch: ".indaba/artifacts/change.patch"

roles:
  architect:
    runner: "openrouter"
    model: "anthropic/claude-3.7-sonnet:thinking"
  implementer:
    runner: "claude-code"
  reviewer:
    runner: "antigravity"

steps:
  - id: "rfc"
    role: "architect"
    goal: "Prepare technical specification in ${{ artifacts.spec }}"
    outputs: ["${{ artifacts.spec }}"]
    guards:
      - type: "git_diff_empty"
        paths: ["src/", "tests/"]

  - id: "code"
    depends_on: ["rfc"]
    role: "implementer"
    input_artifacts: ["${{ artifacts.spec }}"]
    goal: "Implement changes satisfying the technical specification."
    isolation: "git_worktree"

  - id: "verify"
    depends_on: ["code"]
    runner: "shell"
    commands:
      - "pnpm test"
      - "pnpm typecheck"
    on_failure:
      action: "retry_step"
      target: "code"
      max_retries: 3

  - id: "debate_review"
    depends_on: ["verify"]
    role: "reviewer"
    consensus_with: ["architect"]
    decision_type: "consensus"
```
