# Self-review: OpenClaw runner

> **Status**: independent review done (below); the seven-question self-review is not written separately for a change of this size

## Independent review (2026-11-21)

A fresh agent read the uncommitted diff against the spec. Each finding was read in the code before it was acted on.

| # | Finding | State |
| :--- | :--- | :--- |
| 1 | Readiness ignored `agent: { command }`: on Windows the npm install gives only `openclaw.cmd`, so the recommended native executable still showed `openclaw` as critical-missing | fixed: the first word of the author's command is what readiness looks for (a file, or on the `PATH`); the optional `command` argument of `ReadinessProbe.isRunnerRegistered` carries it; tests |
| 2 | `INDABA_ACP_PASS_ENV` names were not listed by readiness for `openclaw`, though they reach it | fixed: listed as for `acp` |
| 3 | A test edit of mine replaced `'openrouter'` with `'acp'` in the registry list | fixed: `openrouter` restored, `openclaw` added |
| 4 | (Observation) with no level written the gate rejects approvals for edits, deletions, moves and commands, so a default OpenClaw step cannot change files | the existing behaviour of the gate for every ACP agent; now stated in the spec (C-04) and the docs: write `full` for a step that is to act |

No defect was found in: how `read` and `edit` are caught (step, role and `defaults` permissions, `--permissions`, a chain with another runner, the catalog and the page), MCP (declared none; the planner skips OpenClaw for a chain `[openclaw, claude-code]`; the runner sends an empty list on every path: the engine, a debate participant, a conflict resolution), the environment (baseline, `OPENCLAW_*` and `INDABA_ACP_PASS_ENV` only, in the preset and the author-command path; no token in argv, logs or messages), the subclass and the base class, or the behaviour of existing runners.

Verification: `pnpm qa` and `pnpm e2e` on the host before the commit. The runner is written from OpenClaw's documentation and has not been run against a live Gateway.
