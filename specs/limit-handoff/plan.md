# Plan: Limit handoff

## Approach

1. **Core, pure.** `RunLimit`, `classifyLimit`, `LimitLedger`, `decideOnLimit` and the two workflow fields. The
   decision is a function of (policy, list, who was tried, the ledger, now). The step executor only carries it out.
2. **Engine.** The step executor wraps the existing runner-list loop of `transport-priority`:
   - before each runner, ask the ledger (skip a cooling one with a `cooling` skip event);
   - after a result with `limit` (or a `RunnerLimitError`), mark the ledger, emit the event, ask `decideOnLimit`;
   - on `run`: build the handoff note and start the next runner on the same worktree; on `wait`: use the ruling
     channel's wait with the instant; on `ask`: raise the question; on `fail`: end with the single error.
3. **Runners.** Each runner builds a `LimitSignal` from what it already reads and calls `classifyLimit` with its own
   pattern list. The OpenAI-compatible runner uses status 429 and `Retry-After`. CLI runners use exit code, the
   structured stream where the CLI has one, and an anchored tail of text where it does not. ACP maps its error.
4. **Display** last: derive the state from events.

## Handoff note

Built in the engine from `git diff --name-only` of the worktree (argument array, confined paths), cut at 50 paths with a
count of the rest. Fixed English template, no agent output. Tested with names that contain control characters and
newlines (built from fragments, as the security gate requires).

## Analysis (stage 5)

| Question | Answer |
| :--- | :--- |
| A published signature broken without the right version? | no: every addition is optional; the one behaviour reading (AC-15) is classified minor in `api-surface.md` |
| A `node:` import or I/O in `@indaba/core`? | none: classification, ledger and decision are pure and take `nowMs` |
| A new runtime dependency? | none |
| Untrusted data reaching a shell, a path, a URL or a log? | agent text reaches only `classifyLimit` (fixed patterns, bounded); the agent's sentence is not copied into events; the handoff note carries confined paths as quoted data. Covered by tests |
| A wall clock, randomness or environment read in decision logic? | none: the clock is injected into `decideOnLimit` and the ledger reads |
| An unbounded loop, retry or buffer? | the list is walked once per step, each runner at most once; `max_wait` defaults to 0 and has no unbounded form; the note is cut at 50 paths; the text tail given to the classifier is bounded (4 KiB) |
| Does a limit weaken a guard? | no (AC-16): guards run on the final worktree |
| Does it break "retries are isolated and bounded"? | no: limits bypass the retry counter and the retry prompt (clarification 4); handoff is bounded by the list |
| Extension without privileged access? | yes: a plugin runner sets `limit` and a pattern list like a built-in |
| What is unproven? | what each CLI actually prints on a limit and whether it gives a reset instant. Nothing in this spec asserts it; T-01 gathers real samples first and AC-04 forbids guessing |

Result: the plan passes. No item is open: clarifications 3 and 5 were confirmed by the maintainer, 9 was decided for them.

## Risks

- **A CLI changes its message.** The text patterns are data per runner with a recorded sample each, so a break is one
  failing test and a one-line fix, and a missed limit degrades to today's behaviour (a failure).
- **A false positive wastes a handoff.** Bounded by AC-05 (only on failure) and by the list length.
- **Half-written files after a handoff.** The guard and `on_failure` remain the checks.
