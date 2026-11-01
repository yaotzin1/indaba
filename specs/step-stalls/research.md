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

## Not measured

- Whether a call ever hangs for good. None did in the runs above; the stall retry rests on that being plausible.
- How long a healthy `claude` call can be silent in the streaming mode between events. The thinking events were seen in a
  three-line answer; a long reasoning step has not been measured. `after_seconds` has a floor of 30 and the author sets the
  number; the plan should record a measurement before the cookbooks propose one.
- Whether the other built-in runners' activity signals are reliable (spec AC-17 asks the plan to say, runner by runner).
