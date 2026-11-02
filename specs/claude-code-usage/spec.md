# Specification: Token usage and cost from the claude-code runner

> **Status**: Draft
> **Stage entry**: 1
> **Semver impact**: minor (below 1.0; see `api-surface.md`)

---

## 1. The problem

A run through the `claude-code` runner shows `tokens unknown, cost unknown` for every call. In four real runs of the
spec-first cookbook (about 50 minutes of agent work) no step had a figure, so the cost of a run cannot be read from
Indaba and a ceiling such as `--max-cost` of `specs/step-budgets` cannot hold on it. On Windows the `acp` route that
would report usage never starts (`npx` is a `.cmd` shim Indaba does not start), so `["acp", "claude-code"]` chains end
on this runner.

The CLI does print the numbers. With `--output-format stream-json --verbose`, Claude Code ends its output with a
`result` event that carries the final answer, `usage` (input, cache and output tokens) and `total_cost_usd`. The runner
today asks for plain text and throws that away. This is follow-up T-27 of `specs/step-budgets` (item 14), for the one
CLI whose output has a source.

## 2. User stories

- **US-01.** As a person running a workflow, I see tokens and cost on each `claude-code` step in `indaba watch`, the
  trace and the summary, without changing my workflow file.
- **US-02.** As a workflow author, my steps behave as before: the same answer text reaches `AGREEMENT:` / `CRITIQUE:`
  parsing, guards, the board and the debate transcript.
- **US-03.** As a developer embedding `@indaba/runners`, I can turn the new behaviour off, and a custom `extraArgs` that
  already chooses an output format is left alone.

## 3. Acceptance criteria

- [x] **AC-01** By default `ClaudeRunner` passes `--output-format stream-json --verbose` after `-p <prompt>`.
- [x] **AC-02** `RunResult.output` is the `result` string of the final `result` event; it equals what text mode printed
      for the same answer.
- [x] **AC-03** `RunResult.usage` is `TokenUsage(input, output)` with `input = input_tokens + cache_creation_input_tokens
      + cache_read_input_tokens` and `output = output_tokens`, a missing cache field counted as 0, only when the event
      holds `input_tokens` and `output_tokens` as non-negative safe integers and their sum is one too.
- [x] **AC-04** `RunResult.reportedCostUsd` is `total_cost_usd` when it is a finite number >= 0; never computed.
- [x] **AC-05** `RunResult.model` is the one key of `modelUsage` when it has exactly one and it is a plausible model name
      (letters, digits, `.` `_` `:` `/` `-`, at most 100 characters), else the request's model.
- [x] **AC-06** With no `result` event (timeout, abort, crash, a CLI that changed), `output` is the text of the last
      assistant message that has text (empty when none), `usage` and `reportedCostUsd` are absent, and nothing throws.
      When no line of the output is a JSON object (an older CLI printing a plain error on stdout), `output` is the
      stdout as before, so an error is never swallowed.
- [x] **AC-07** A line that is not JSON, or a JSON value that is not an object, is ignored. Only named fields are read,
      each type-checked; the parsed object is never spread, merged or passed on.
- [x] **AC-08** `onOutput` receives the answer text once, when the result is known, not the JSON lines.
- [x] **AC-09** This path runs on pipes, never a pseudo-terminal (a terminal can wrap a long JSON line); `mode` says `piped`.
- [x] **AC-10** Exit code, timeout (124), abort (130), `errorOutput`, MCP injection, model and permission arguments are
      unchanged.
- [x] **AC-11** `new ClaudeRunner({ reportUsage: false })` and any `extraArgs` containing `--output-format` give the
      previous command line and result exactly.
- [x] **AC-12** The engine records the tokens and the reported cost on the step's span with no engine change.
- [x] **AC-13** `docs/` states which runners report usage and which do not, and the cookbook's cost paragraph is updated.

## 4. Non-goals

- Codex, Cursor and Antigravity runners: each needs its own check of what its CLI prints (T-27 stays open for them).
- Showing the agent's tool calls or partial text live (`--include-partial-messages`). Output reaches `onOutput` as before.
- Reading `permission_denials` for the denial check of `specs/agent-permissions`; a later change may.
- Computing a cost from tokens for models the pricing table does not know.
- Any ceiling or budget behaviour: that is `specs/step-budgets`.
- A new runner name, workflow field or CLI option.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the CLI exits non-zero with a `result` event (`is_error`) | exit code kept; `output` is that result text; usage reported if present |
| the CLI exits non-zero with no `result` event | exit code kept; `output` per AC-06; no usage |
| the timeout elapses | 124, partial output per AC-06, no usage |
| the run is cancelled | 130, as above |
| the output contains lines that are not JSON | ignored; if no event is usable the answer is empty |
| `usage` has a negative, non-finite or non-number field | no usage reported for the call (not a guess) |
| the CLI is a version without `stream-json` | it exits non-zero with an error; the step fails as any CLI error does, and `reportUsage: false` restores the old call |

## 6. Security and data handling

The CLI's output is untrusted data. It is parsed with `JSON.parse` in a `try`, line by line; every field read is
type-checked; no parsed value reaches a shell, a path or a log, and the answer text takes the same route it took
before. The prompt is still an element of an argument vector. No secret is read or written. Memory is the stdout that
`executeProcess` already holds.

## 7. Where it lives

`packages/runners/src/claude-runner.ts`, with the line reader in a new `claude-stream.ts` of the same package. No
change in `@indaba/core` (the `RunResult` fields exist) or `@indaba/engine`. Infrastructure, not domain.

## 8. Clarifications

- **Default on.** Tokens and cost are what a person expects; the opt-out is `reportUsage: false`.
- **Input tokens count the cache.** Claude reports `input_tokens` without cache reads and writes, which are most of the
  prompt in agent work (11 551 written and 16 560 read against 2 fresh, in a one-word reply). `input` is their sum, so it
  is the prompt size. Cache prices differ from input prices, which is why `reportedCostUsd`, not a price table, is the cost.
- **Pipes, not a terminal.** A terminal gains nothing for `-p` output and may break lines.
- **No live JSON.** Print mode gave the final answer at the end; the answer is forwarded once to `onOutput`.
- **Semver.** minor: the call line of the runner changes and spans that had no tokens now have them. Nothing a workflow
  file says changes.

- **Relation to `specs/step-stalls`.** That spec (not implemented) also uses `--output-format stream-json --verbose`, but only
  in a step that sets `stall`, and says a step without `stall` keeps today's command line (its AC-15, AC-16). This change
  makes that mode the default for `claude-code`, so when step-stalls is implemented its "today" is this call: it reads the
  events as they arrive for activity (this change holds them back until the end), and its AC-15 sentence about an unchanged
  command line is about the call as it stands after this change. The parser here (`parseClaudeStream`) is the one it
  should reuse for the final text; the two share the result fields (AC-16 there).

## Artifacts not written

- `data-model.md`: no new entity; the only shapes are the optional `reportUsage` and the internal result in [`api-surface.md`](api-surface.md).
- `events.md`: no new event or span attribute; the existing token and cost attributes are filled.
- `research.md`: the CLI output was checked by running it; the observed events are recorded in [`plan.md`](plan.md).
