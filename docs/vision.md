# Project INDABA: Multi-Agent Consensus & Observability Engine (original requirement)

This is the founding requirement, kept verbatim. `workflow.ai.yml` and `AGENTS.md` outrank it.

## 1. Project mission & context
**Indaba** is an open-source, deterministic orchestration, debate and observability engine for AI agents (Multi-Agent Consensus & LLM Observability), written in modern PHP (8.4+). The name comes from the Zulu tradition of a council convened to resolve complex matters and reach consensus. Unlike basic orchestrators that run CLI commands sequentially in isolated shells, Indaba provides:

1. **Multi-Agent Cross-Examination:** structured debate and verification across heterogeneous engines (Claude Code via PTY, Antigravity, Codex, reasoning models via OpenRouter).
2. **Deterministic SDLC Pipelines:** declarative workflow files (`workflow.ai.yml`) as a DAG, strict quality gates, artifact-based handoffs.
3. **Real-time Observability:** telemetry aligned with OpenTelemetry GenAI Semantic Conventions (streaming spans, token usage, real-time cost, git diff inspection).

License: MIT.

## 2. Tech stack & engineering standards
- PHP 8.4+ (`declare(strict_types=1);`, readonly classes, native enums, first-class callables).
- Core domain strictly framework-agnostic (`src/Domain`, `src/Core`).
- Infrastructure: Symfony components (`process`, `yaml`, `event-dispatcher`, `console`, `workflow`).
- PHPStan level 8 or 9 with zero unhandled errors (no arbitrary `ignoreErrors`). PHPUnit 11+ or Pest, contract-first and TDD. PER Coding Style 2.0 / PSR-12.

## 3. Domain modules
**A. Workflow & Orchestration Engine (`src/Workflow/`)** parses, validates and executes `workflow.ai.yml`; topologically sorts a DAG from `depends_on`; runs a state machine (`PENDING`, `RUNNING`, `VALIDATING`, `FAILED`, `ESCALATED`, `COMPLETED`). Quality gates and policy enforcers: exit codes of automated tools (`composer test`, `phpstan`); filesystem boundaries (no changes in `src/` during RFC/architecture phases); retry-loop isolation (inject only the isolated stderr/assertion failure into the next prompt, never the full error history).

**B. Agent Inter-Communication Mesh (`src/Mesh/`)**: Blackboard pattern and a Consensus Arbiter. Immutable `AgentMessage` envelopes of type `PROPOSAL`, `CRITIQUE`, `AGREEMENT`, `QUESTION`, `TOOL_INTENT`. Turn-taking, infinite ping-pong detection, quorum validation (e.g. unanimous approval from `architect` and `reviewer`).

**C. Unified Runner Adapters (`src/Runners/`)**, one `RunnerInterface`: CLI PTY runners (`ClaudeRunner`, `CursorRunner`) via `Symfony\Component\Process\Process` with a pseudo-terminal; an HTTP/SSE runner (`OpenRouterRunner`) consuming Server-Sent Events for reasoning models; a `ShellRunner` for deterministic verification commands.

**D. Git Workspace Isolation (`src/Workspace/`)**: ephemeral `git worktree` per task and variant (`.indaba/worktrees/{taskId}`); generate, validate and apply unified diffs (`git diff`, `git apply`); deterministic teardown on completion or cancellation (`git worktree remove --force`).

**E. Observability & Telemetry (`src/Observability/`)**: OpenTelemetry GenAI Semantic Conventions. Trace (task) -> Span (workflow step) -> child span (LLM call, tool execution, shell verification). Real-time input/output tokens, latency, USD cost per model. Events through PSR-14 / `symfony/event-dispatcher` for real-time streaming (SSE / Mercure / WebSockets).

## 4. Workflow contract (`workflow.ai.yml` as executed by Indaba)
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
      - "composer test"
      - "vendor/bin/phpstan"
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
