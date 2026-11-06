# Research: step stalls

Options considered, with what was measured. Numbers come from real runs of the CRUD cookbook workflow on 2026-10-31 with
the `claude-code` runner (Claude Code 2.1.316), one machine; they are an order of magnitude, not a benchmark.

## What was observed

| Observation | Value |
| :--- | :--- |
| `implement`, a complete run, no retry | 1.6 minutes |
| the whole workflow, no retry | about 19 minutes of step time |
| the whole workflow, one mutation retry | about 28 minutes |
| a slow `implement` (a retry after `npm test` failed) | 10 min 13 s, with no file change and about 16 CPU-seconds at the ten-minute mark; it then finished normally. The next retry took 5.5 minutes. No call that never returned has been observed |
| `claude -p <prompt>` in its plain mode | prints nothing until the answer is complete |
| `claude -p <prompt> --output-format stream-json --verbose` | a stream of events during the call: `system/init`, `system/thinking_tokens`, `assistant`, `rate_limit_event`, `result/success` (7 events for a three-line answer) |

## Options for detecting a stall

| Option | Verdict |
| :--- | :--- |
| **Output silence** (no chunk printed for N seconds), using the plain mode | Rejected for `claude-code`: in the plain mode the runner receives nothing until the end, so every healthy call looks silent for its whole duration. Right for runners that already stream. |
| **Output silence over the streaming mode** | **Chosen** for `claude-code`: events arrive while the model works, including `thinking_tokens`, so a long think is not a stall. |
| **File activity in the worktree** (a file changed within N seconds) | Rejected as the signal: a healthy step that is thinking or reading writes nothing. A stalled step and a thinking step look the same. May be added later as one more kind of activity, never as the only one. |
| **CPU of the process** | Rejected: an agent waiting on a network call uses almost no CPU whether it is healthy or stalled (the stalled process above used 16 CPU-seconds in ten minutes; a healthy one waits on the API too). Platform specific, and wrong on Windows pseudo-terminals. |
| **A shorter global `--timeout`** | Kept as it is, not enough: one number for steps that take 1.6 and 12 minutes. This is what the per-step `timeout_seconds` fixes. |
| **A heartbeat prompt to the agent** | Rejected: an agent that is stuck will not answer one, and a second input channel to an agent's session is a different, larger feature. |

## Options for the retry

| Option | Verdict |
| :--- | :--- |
| Retry the same step in place, worktree restored | **Chosen**: the smallest change that survives the observed case. The next prompt carries the failure only (retry isolation). |
| Reuse `on_failure: retry_step` with the step as its own target | Rejected: `retry_step` resets the target and its descendants, and counts against the step that failed; a stall of a step with no `on_failure` could not use it, and a stalled call is not a verdict about earlier work. |
| Count a failing retry target against the retrying step's budget (`verify`'s) | Not done here (spec C-08): it changes what existing workflows do on failure. A candidate follow-up. |
| Continue the agent's session with a "continue" message | Rejected: the session of a stalled call is in an unknown state, and resuming one is runner specific and unbounded in what it keeps. |

## Defaults

Both fields are opt-in. A default silence limit would be a major change: a legitimately long think prints nothing in the
plain mode, and the workflows that work today would start failing. The cookbooks can adopt the fields as examples once they
exist, which does not change a default.

## Measured on 2026-11-06

Claude Code 2.1.319 on one Windows machine, five real calls to `claude -p --output-format stream-json --verbose` run from an empty
folder, recording only the type of each event and when it arrived (no prompt text or answer was kept). An order of magnitude, not a
benchmark: five calls, one machine, one model setting.

| Call | Total | Longest gap | Where |
| :--- | :--- | :--- | :--- |
| a puzzle, default thinking | 19 s | 12.1 s | before the first event (`system/init`) |
| the same, maximum thinking budget | 28 s | 11.2 s | before the first event |
| the same, with `--include-partial-messages` | 21 s | 12.8 s | before the first event |
| a harder puzzle, maximum thinking budget | 23 s | 12 s | before the first event; the longest gap after it was 4.5 s |
| one shell command that runs 75 s, run by the agent | 94 s | 30 s | between two `tool_progress` events |

What this says:

- **Startup is silent for 11 to 13 seconds** before the first event. A silence timer that starts when the process starts, not at the
  first event, would count it.
- **Thinking is not silent.** `system/thinking_tokens` events arrived every 1 to 5 seconds, so "thinking counts as activity" (C-15)
  holds for these calls. None of the puzzles made the model think for more than about 15 seconds, so a multi-minute think is still
  unmeasured.
- **A long tool call is nearly silent.** While the command ran, the stream carried `tool_progress` events 26.1 and 30.0 seconds apart,
  and 16.1 seconds passed between the end of the command and the next event. A healthy call came within a second of the floor of
  `after_seconds` (30, C-05). This was one command of one kind; a test run that prints nothing for minutes was not measured.
- `--include-partial-messages` added content deltas while the model wrote its answer and nothing during a tool call. It does not
  close the gap.

What it suggests for the plan, to be decided there: a floor above 30 seconds (or guidance that `after_seconds` should be several
times the longest tool call a step makes), a timer that starts at the first event, and no claim in the documentation that a quiet
tool call is a stall.

## Not measured

- Whether a call ever hangs for good. None did in the runs above; the stall retry rests on that being plausible.
- How long a healthy `claude` call can be silent in the streaming mode **during a long reasoning step with many turns and
  tools**. See "Measured on 2026-11-06": thinking alone and one long tool call were measured, a multi-minute agentic step was not.
- Whether the other built-in runners' activity signals are reliable (spec AC-17 asks the plan to say, runner by runner).
