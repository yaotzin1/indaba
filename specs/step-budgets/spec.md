# Specification: Budgets (a spend ceiling, a question when it is reached, and metering for everything that spends)

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 (the decisions in section 8 are recommended; the maintainer confirms them)
> **Semver impact**: the budget fields, money and rates, the resume question and the CLI options are minor (new
> optional fields, new optional members, new optional contracts, new events and attributes; below 1.0). **The metering obligation (AC-21 to AC-30) is
> breaking** for third-party runners and for workflows that run a runner which reports no usage; it is
> classified in [`api-surface.md`](api-surface.md), and the choice of version is the maintainer's.
> **Builds on**: [`specs/transport-priority`](../transport-priority/spec.md) (runner chains, span events),
> [`specs/observability`](../observability/spec.md) (`TokenUsage`, `PricingTable`, `indaba.cost.usd`; the USD
> fields stay, money in any currency is added beside them),
> [`specs/debate-arbiter`](../debate-arbiter/spec.md) (the human-in-the-terminal path) and
> [`specs/ruling-channel`](../ruling-channel/spec.md) (the same question for front ends other than a terminal).
> **Siblings**: [`specs/step-variants`](../step-variants/spec.md) and
> [`specs/step-verdicts`](../step-verdicts/spec.md) spend inside a budget and are described here only where
> they touch it.

---

## 1. The problem

Indaba reports what a run spent: tokens on each call span, a cost where one is known, and the totals in the
trace. It never stops a run because of it. A step that retries three times, a debate that runs four rounds
with three participants, or an agent that loops on a tool can spend without limit, and the author learns the
number only afterwards. The wall-clock timeout (`timeoutSeconds`) bounds time, not money.

Three things make a ceiling harder than a comparison:

1. **The numbers are uneven.** An OpenAI-compatible runner reports tokens, and a cost only for a model in the
   pricing table. An ACP agent reports a cost only if it sends one, and no token split, and today Indaba keeps
   that cost only when it is in USD and drops it otherwise. The CLI runners report nothing. A ceiling that
   treated "not reported" as zero would look safe and enforce nothing. A person who pays in another currency
   also cannot read a USD-only report or cap, and a figure converted with a rate nobody can see is worse than
   the original.
2. **Stopping throws work away.** A step that is stopped at its ceiling has usually done most of its job.
   Tearing the worktree down and failing the run destroys that work, when the person who set the ceiling would
   often rather raise it a little and finish.
3. **Only what Indaba can see is capped.** A plugin that calls a model on its own (an adjudicator, a guard, a
   listener, a runner) spends money no ceiling sees, unless the contract makes reporting an obligation instead
   of a courtesy.

## 2. User stories

- **US-01.** As a workflow author, I cap the spend of one step so that a retry loop or a long debate cannot
  cost more than I decided.
- **US-02.** As a workflow author, I cap the spend of a whole run, so that the sum of many steps has a limit
  too.
- **US-03.** As a person running or scripting a workflow I did not write, I set a hard run cap from the command
  line, in the currency I pay in, without editing the file, that nothing in the run can raise.
- **US-10.** As a person who pays in another currency, I read every cost in the currency its source reported and,
  next to it, in the currency I chose, with the rate and its date, and I set caps in my currency.
- **US-04.** As a person at a terminal, a TUI, a web or a desktop front end, when a cap stops a step I am asked
  whether to continue from where it stopped, with more budget I name or one more call, or to stop for good.
- **US-05.** As a person who could not answer (CI, a closed terminal), I find the stopped work kept, told where
  it is, and I can resume it later.
- **US-06.** As a workflow author, I am told before the run (`validate`, `plan`) which runner will not meter
  its spend, and I must say so in the workflow, so nothing is unmetered by accident.
- **US-07.** As a person reading a trace or a report, I see what each step and the run spent, how much of it
  was metered, estimated or not metered, which source did not meter and why, and which cap stopped a run.
- **US-08.** As a plugin author, I must declare how my runner, adjudicator, guard or listener meters its spend,
  and I have a test helper that checks I meet the contract.
- **US-09.** As a developer embedding the engine, I receive typed events for a stop and for the answer, and I
  can supply my own way of asking.

## 3. Acceptance criteria

### Budgets and caps

- [ ] AC-01. A step may carry `budget: { max_cost, currency, max_tokens }`, where `max_cost_usd: n` is the
  spelling of `max_cost: n` with `currency: USD` (AC-37). At least one of `max_cost`, `max_cost_usd`, `max_tokens`
  is required. `max_cost` is a finite number greater than 0 in `currency` (default `USD`); `max_tokens` is an
  integer of at least 1. Any other key, a non-number, zero, a negative, `NaN` or `Infinity`, `max_cost` together
  with `max_cost_usd`, or `currency` without `max_cost`, fails validation naming the step and the field. A `budget` on a shell step fails validation (a shell step spends nothing the engine meters).
- [ ] AC-02. The workflow may carry a top-level `budget` with the same two keys. It caps the whole run: the
  sum of every metered call of every step, every attempt included.
- [ ] AC-03. `defaults.budget` may carry the same two keys. It is the step budget of every agent step that has
  no `budget` of its own, field by field: a step that sets only `max_tokens` still inherits the cost cap (amount and
  currency together) from the defaults.
- [ ] AC-04. `indaba run` accepts `--max-cost <amount>[<code>]` (for example `5`, `20PLN`, `"20 PLN"`; a bare
  number is USD) and `--max-tokens <n>`. They set the **operator run cap**: the run-wide ceiling for scripted and
  CI use, passed to the engine as `WorkflowEngineOptions.runBudget`, the single way every front end sets it. When
  the file also has a run `budget`, **both caps apply** and whichever is reached first stops the run, so no
  comparison across currencies is ever needed. A malformed value or an unknown currency code is a usage error
  (exit code 2) before anything runs.
- [ ] AC-05. An operator cap is **final**: no answer to a budget question can raise it or grant a call past it
  (AC-12). A cap that comes from the file is the author's default, which a person may raise at the question.
- [ ] AC-06. The engine meters every call it starts that can spend (AC-21): an agent step's call, each runner
  of a fallback list that actually ran, every participant's turn in a debate, every call an arbiter or another
  extension reports. A call's spend is added to its step's total and to the run's total. The spend of every
  attempt of a step counts: a retry does not reset the step's total.
- [ ] AC-07. A call's tokens are `inputTokens + outputTokens` of its metering report. Its cost is a `Money` in
  the currency it was reported in (AC-36): the pricing-table cost when the model is in the table, otherwise the
  runner's reported cost, otherwise **unknown**. Spend is totalled per original currency and converted to a
  cap's currency only to compare with that cap (AC-41). A call whose tokens or cost are unknown, or whose cost
  cannot be converted for a cap, adds nothing to that total and increments the `unmetered` count of its source.
  Unknown is never treated as zero in a message, a span or a summary.
- [ ] AC-08. Before starting a call that can spend, and again each time spend is observed, the engine compares
  the totals with every cap that applies. When `spent >= cap` for any of them, the call is not started (or, when
  it is running, is aborted) and the **budget question** (AC-11) is raised. `retry_step` never treats a budget
  stop as a failure to retry.
- [ ] AC-09. Spend is observed (a) when a call returns, from its metering report, and (b) while a call runs,
  when the runner reports it through the optional `RunRequest.onUsage` callback. A runner that never calls it
  is checked only at (a). The documentation and the trace say so: a cap limits further spend; it does not
  guarantee that one call cannot overshoot it.

### Stopping, asking, resuming

- [ ] AC-10. When a cap is reached the stopped call is aborted through its `AbortSignal` (process runners kill
  their tree, as for a cancel), and the step stays `RUNNING`: it has not failed, it is waiting for an answer.
  A budget stop is never reported as `cancelled`.
- [ ] AC-11. The engine asks one **budget question** per stop, through the registered `BudgetResolver`. The
  question names the step, the scope (`step` or `run`), the limit, the amount spent, the cap (a cost in the cap's
  currency and, when a display currency is selected and a rate exists, also in that currency with the rate and
  its date), how many calls were unmetered, how many resumes the step has used and may still use, and where the kept work is (a path
  relative to the project). It carries no prompt, output, transcript or secret. The question is asked inside
  the call that was stopped, so a debate keeps its transcript and a retry keeps its counters.
- [ ] AC-12. The answer is one of: **raise to** (a new absolute cap for the limit that tripped, and
  optionally the other; a cost in the cap's currency), **add** (extra headroom on top of what was spent, for the
  limit that tripped, and optionally the other; a cost in the cap's currency), **one more call** (the cap stays; the stopped step may make exactly one more call,
  which is not aborted by the cap, and the cap applies again afterwards), or **stop**. A raise or an add must
  leave room (a new cap above what is already spent) and an add must be above zero; an answer that does not is
  refused and the question is asked again. Numbers are validated like AC-01.
- [ ] AC-13. On a resume the interrupted call is repeated, as a fresh runner call over the same working
  directory, with its prompt followed by a fixed sentence saying that an earlier attempt was stopped by a
  spending limit and left partial work in the working directory. The step's attempt counter is not advanced; a
  retry's counters, a debate's transcript and a verdict loop's iteration count are untouched. The spend so far
  is kept: a resumed step continues from its old total and never resets.
- [ ] AC-14. A cap that is final (AC-05) is not asked about, and neither is a step that has already used
  `MAX_RESUMES_PER_STEP` resumes (5): the engine goes straight to the unanswered path (AC-16).
- [ ] AC-15. **Stop** answered by a person ends the step and the run `escalated`: the working directory is torn
  down as for any ending, nothing is exported from the stopped step, and no resume file remains.
- [ ] AC-16. **Unanswered** covers: no resolver registered (`--rulings none`, or no terminal), a resolver that
  returns no answer, a final cap, the resume limit, and a cancel while the question is open. The step and run
  end `escalated` (a cancel ends `cancelled`), the isolated working directory is **kept**, a resume file is
  written, and the report prints the kept path and the command to resume: `indaba run <file> --resume <taskId>`.
  A step without isolation has no working directory of its own to keep; its changes are in the project already,
  and the resume file is written all the same.
- [ ] AC-17. The kept working directory is under `.indaba/worktrees/`, found by the same confinement as every
  other path, and is never deleted automatically. It is removed only when a person answers **stop** to a
  question (AC-15) or the run that adopted it ends and tears it down as any workspace; a person may also remove
  it by hand.
- [ ] AC-18. `indaba run <file> --resume <taskId>` loads `.indaba/resume/<taskId>.json`, refuses (exit code 1,
  naming why) when the file is missing or of an unknown version, when the workflow's digest differs from the
  saved one, or when the kept directory is gone or outside `.indaba/worktrees/`; otherwise it adopts the kept
  directory, restores the finished steps, the counters and the spend totals, and continues at the stopped
  step. The first check finds the cap still reached and asks the question again. A `<taskId>` outside
  `[A-Za-z0-9_-]+` is a usage error.
- [ ] AC-19. A debate step resumed in the same run continues at the interrupted turn. A debate step resumed by
  `--resume` in a later run restarts its debate from the first round; its spend so far still counts.
- [ ] AC-20. The answer is not a ruling: it is never written to or read from the decision ledger of
  `specs/debate-arbiter`, and no earlier answer is reused. It is recorded in the trace and, when the run ends
  resumable, in the resume file.

### Metering is a contract obligation

- [ ] AC-21. **Every runner declares how it meters**, and so does every other extension that can spend: an
  adjudicator, a guard, a listener and a budget resolver. The declaration is `free` (it never spends), `metered`
  (it reports its spend, per figure `yes`, `maybe` or `no`, and, for a cost, the currencies it reports in) or
  `unmetered` with a reason. There is no fourth state and no default.
- [ ] AC-22. `PluginHost` refuses to register a runner, an adjudicator, a guard, a listener or a resolver that
  does not carry a well-formed declaration, with an error naming the plugin and what is missing. Built-ins
  register through the same calls and are held to the same rule.
- [ ] AC-23. Every `RunResult` carries a metering report: `metered` (with at least one of input tokens, output
  tokens or cost, and a `basis` of `reported` or `estimated`), `unmetered` (with a reason) or `none` (only
  from a `free` capability). When a runner or plugin does not build one, the `RunResult` constructor derives
  it from the existing `usage`, `reportedCost` and `reportedCostUsd`, and from nothing it reports `unmetered`. A
  reported cost is a `Money` in the currency it was reported in.
- [ ] AC-24. A capability declared `metered` that returns no figure is counted as a **gap**: it is totalled as
  unmetered, listed with its source, and recorded as an event; it does not fail the call.
- [ ] AC-25. A capability that spends and is not a runner reports through the same report: `Ruling` and
  `GuardResult` carry one, and a listener or any other code reports through the `UsageReporter` the host gives
  it. All of it goes to the same meter, so a cap sees it.
- [ ] AC-26. A step has a `metering_policy`: `required` (the default) or `optional`, also settable under
  `defaults`. `validate` fails a step whose runner list, arbiter or guards include a capability declared
  `unmetered` while the policy is `required`, naming the step, the source and its reason. With `optional` it
  passes, and the use is counted and shown (AC-27). `metering_policy` follows the vocabulary of `mcp_policy`.
- [ ] AC-27. The report of a run lists, per source, the calls that were not metered and why, the calls that were
  estimated, and the gaps, and the costs that could not be converted; the CLI prints them after the spend line. A
  total that includes any of them is never printed as complete.
- [ ] AC-28. A **conformance check** is exported for plugin authors (`checkMeteringContract`): it verifies a
  declaration is well formed, that a `metered` subject reports a figure on a successful sample, that a `free`
  subject reports `none`, that figures are finite, non-negative and non-decreasing within a call, and that an
  `unmetered` result carries no figure. The runner contract helper of `specs/transport-priority` (T-22) is the
  same helper and gains these checks.
- [ ] AC-29. The built-in CLI runners (`claude-code`, `codex`, `cursor`, `antigravity`) declare `unmetered`
  with an honest reason, because their CLIs report no usage that Indaba reads today. `shell` declares `free`.
  A follow-up (section 8, item 14) investigates, per CLI, a source the tool itself emits; where one exists the
  runner reports it as `metered`, with `basis: 'reported'` for what the tool printed and `basis: 'estimated'`
  only for what Indaba derives from such a source. No figure is ever invented.
- [ ] AC-30. `validate` and `plan` print a warning, without failing, for each budget key that cannot trip on a
  source the step may use (a cost cap on a runner whose cost is `maybe` or absent, a token cap on one whose
  tokens are), for a cost cap whose currency has no supplied rate from a currency a source declares (AC-42), and
  for a step cap larger than the run cap. `plan` prints each step's effective budget, its
  policy and the run caps, and no estimated spend.

### Money, rates and currencies

- [ ] AC-36. A cost is a `Money`: `{ amount, currency }`, with `amount` a finite number of at least 0 and
  `currency` an ISO 4217 code from the table bundled with `@indaba/core`. A runner reports it, and a pricing
  table prices a model in it, exactly as the source gave it. The existing USD members stay and keep their
  meaning: `RunResult.reportedCostUsd` and the span attribute `indaba.cost.usd` are set only for a cost whose
  original currency is USD, and are never filled by a conversion. A new `RunResult.reportedCost` carries the
  cost in its original currency, whatever it is; the ACP runner keeps any currency the agent reports instead of
  dropping all but USD (this supersedes the last clause of `specs/transport-priority` T-20).
- [ ] AC-37. `max_cost_usd: n` is exactly `max_cost: n` with `currency: USD`, and is kept because the USD
  vocabulary already exists. A cap is a `Money`; its currency is its own and is never inferred.
- [ ] AC-38. Rates are **supplied**, never fetched. A rate is `{ from, to, rate, as_of }`: one unit of `from` is
  `rate` units of `to`, `rate` a finite number greater than zero, `from` and `to` different ISO codes, `as_of` a
  calendar date `YYYY-MM-DD`. They come from the workflow's top-level `rates` list, from a file given with
  `indaba run --rates <file>` (the same list), or from `WorkflowEngineOptions.rates`. When the same ordered pair
  appears in more than one place, the operator's (`--rates`, the engine option) wins over the workflow's; the same
  pair twice in one place is a validation error. The engine makes no network call, so a rate is data injected
  like the clock.
- [ ] AC-39. A conversion uses the supplied rate for the exact pair (`from` to `to`); when only the opposite pair
  is supplied it uses its reciprocal and says so; it never goes through a third currency. A currency converts to
  itself at rate 1 without an entry. With no usable rate the cost is not convertible (AC-41).
- [ ] AC-40. A **display currency** may be selected with the top-level `display_currency` or `indaba run
  --currency <code>` (the option wins). With none selected, every line is shown in its own original currency; a
  total is printed only when every part is in one currency. With one selected, every cost is shown first in its
  original currency and then converted: `0.42 USD (≈ 4.24 PLN at 10.1, as of 2026-10-01)`; a reciprocal rate is
  shown as `at 1/0.099 (inverse of PLN to USD), as of …`. A line with no rate to the display currency is shown in
  its original currency, marked `no rate to PLN`, and then **no total is printed**: a total appears only when
  every part was converted. Amounts are shown with the currency's number of minor units; ISO codes are printed,
  not symbols.
- [ ] AC-41. **Enforcement** converts spend to the cap's currency with the supplied rate and compares there. A
  call's cost in the cap's currency is added as it is. A cost with no usable rate to the cap's currency is
  counted as **unmetered** for that cap with the reason `no rate from X to Y`, never as zero; it is still totalled
  and shown in its own currency. A cap is therefore only as exact as its rates: a rate that is out of date makes
  the cap approximate, and the report and the question print the rate's date so a person can judge.
- [ ] AC-42. Each metered source declares the currencies its cost is reported in: a list of ISO codes, or `any`
  for a source that reports whatever its agent sends. `validate` checks, for each cost cap and each source the
  step may use that reports in a listed currency other than the cap's, that a usable rate exists: a missing one
  is an error when the step's `metering_policy` is `required` (the cap could never trip on that source) and a
  warning when `optional`. For `any` it is a warning only, because the currency is not known until the run.
- [ ] AC-43. The budget question shows the cost in the cap's currency and, when a display currency is selected and
  a rate exists, also in that currency with the rate and its date. An answer to a cost question is an amount in
  the cap's currency; an answer naming another currency is refused.
- [ ] AC-44. `--max-cost` takes an amount and an optional ISO code (`--max-cost 20PLN`, `--max-cost "20 PLN"`; a
  bare number is USD). The currency is part of the value, so `--currency`, which only chooses what is displayed,
  can never change what a cap means.
- [ ] AC-45. A step with `variants: N` gives each variant an equal share computed in the cap's currency
  (`max_cost / N`); the share is kept unrounded for enforcement and rounded only when shown.
- [ ] AC-46. The trace records both: each call span keeps the original cost (`indaba.cost.amount`,
  `indaba.cost.currency`) and, only when a display currency is selected and a rate exists, the converted figure
  with the rate, its date and whether it was inverted; a budget's spend is in the cap's currency. Neither a rate
  table nor a source's reason is a secret, but both are bounded and cleaned. Names are in `events.md`.
- [ ] AC-47. Rate and money logic (`Money`, `RateTable`, conversion, formatting) is pure: it reads no clock,
  environment, locale or network, and the same inputs give the same output. Every new line is covered by tests;
  the 85% floor holds.

### Telemetry and documentation

- [ ] AC-31. The span of a step records its budget and its metered spend, the task span the run's, and the stop
  and the answer are span events and typed events (names in `events.md`). None carries a prompt, output, path,
  transcript or secret.
- [ ] AC-32. When a run ends, the CLI prints one line with the metered totals, original currency first, and the
  counts of estimated and unmetered calls, for example
  `spent 0.42 USD (≈ 4.24 PLN at 10.1, as of 2026-10-01) and 18,300 tokens (2 calls estimated, 3 not metered)`.
  Section "Money" fixes the format.
- [ ] AC-33. A workflow without any of the new fields and with only metered or `free` runners behaves exactly as
  before, and its traces are byte-identical apart from the attributes written only when a budget applies.
- [ ] AC-34. The metering logic (`BudgetMeter`) is pure: no clock, randomness, environment or I/O. The same
  sequence of observations gives the same verdicts. Every new line is covered by tests; the 85% floor holds.
- [ ] AC-35. `docs/extending.md` states the metering obligation and how to meet it (T-31), and
  the examples in `examples/` that name a CLI runner say `metering_policy: optional`.

## 4. Non-goals

- **Provider billing.** No query of a provider's usage or billing API, and no reconciliation with an invoice.
  The numbers are the ones the runs reported or, where marked, estimated.
- **Fetching rates.** The engine makes no network call for a rate, ever. Rates are supplied (AC-38).
- **Chained conversion.** No conversion through a third currency (USD to PLN to EUR): each hop would compound a
  stale rate. A pair with no supplied rate, direct or inverse, is not convertible.
- **Deciding a rate is stale.** The engine does not compare a rate's date with today's date; it prints the date.
- **Inferring a currency or a rate** from a locale, a region, a time zone or an environment variable.
- **Tax, fees, spreads and rounding rules of a payment.** Amounts are kept unrounded; rounding happens only when
  a figure is shown.
- **Per-user, per-team or per-day quotas,** or any state that outlives a run other than the resume file. A
  budget is one run's ceiling.
- **Forecasting.** Token counts of an agent run cannot be known in advance, so `plan` shows caps, not a
  predicted spend.
- **A time budget.** `timeoutSeconds` stays the only clock limit.
- **Raising a cap automatically.** Only a person's answer raises a cap, and never an operator cap.
- **Resuming on another machine, or after the workflow changed.** A resume needs the same project checkout, the
  kept working directory and an unchanged workflow digest.
- **Resuming an agent's own session.** The repeated call is a fresh call over the kept work; an ACP session is
  not reopened.
- **A command to list or discard kept work.** A kept directory is reported when it is created and removed by
  answering stop on a resume or by hand (section 8, item 13).
- **Trusting a number.** A runner or plugin can report anything; the meter only filters what is not a finite,
  non-negative, non-decreasing figure. A capability that lies about its spend cannot be caught.
- **Spend inside an agent that Indaba cannot see,** such as an agent's sub-agents inside one ACP session, beyond
  what the agent reports.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| a step's spend reaches its `max_cost` or `max_tokens` | the in-flight call is aborted, the step stays `RUNNING`, the budget question is asked |
| the run's spend reaches its cap | the same, with scope `run`; the step running when it tripped is the one named |
| a cap is already reached when a call is about to start | the call is not started; the question is asked |
| the person answers raise, add or one more call | the call is repeated with the note; spend continues from the old total; the attempt counter is unchanged |
| the person answers stop | the step and run end `escalated`; the working directory is torn down; no resume file remains |
| no one can answer (no resolver, no terminal, `--rulings none`, a resolver returning no answer) | `escalated`, exit 2; the isolated directory is kept; resume file written; path and resume command reported |
| the cap is final (operator) or the resume limit is reached | not asked; the same unanswered path |
| the run is cancelled while the question is open | `cancelled`, exit 130; the directory is kept and the resume file written; the cancel wins over the stop |
| the answer is invalid (a cap below what is spent, a number that is not valid) | refused, with the reason, and the question is asked again |
| a runner reports no usage and no cost | the call is `unmetered`; it cannot trip a cap; its source and reason are listed |
| a cost is in a currency with no supplied rate to the cap's currency (direct or inverse) | the cost is counted as `unmetered` for that cap with the reason `no rate from X to Y`; never zero; shown in its own currency; the cap cannot trip on it |
| a rate entry is malformed, duplicated or names an unknown currency | the workflow (or the `--rates` file) fails validation naming the entry; nothing runs |
| a rate is out of date | nothing happens: the cap is approximate (section 8, item 22); every figure shows the rate's date |
| a display currency is selected and some line has no rate to it | that line is shown in its original currency, marked `no rate to <code>`, and no total is printed |
| a runner declared `metered` reports nothing for a call | counted as a gap, listed, recorded; the call does not fail |
| a runner reports spend that goes down, or a negative, `NaN` or infinite figure | ignored for metering and recorded as an event; never fails the step |
| `--resume` finds the file missing, the version unknown, the workflow changed, or the directory gone | refused with the reason, exit 1; nothing is changed or deleted |
| a plugin registers a runner, adjudicator, guard, listener or resolver without a declaration | the host refuses it, naming the plugin; the other plugins load |
| a step runs a source declared `unmetered` and its policy is `required` | `validate` fails naming the step, the source and its reason |
| a debate trips a cap between participants | the question is asked; on resume the debate continues; unanswered, it ends `escalated`, and no arbiter is asked |
| the arbiter chain would run after a budget stop | it does not; a budget stop is not a failed debate |
| a malformed `budget` in the file | the workflow fails validation before anything runs, naming the field |

## 6. Security and data handling

Budget values are numbers written by the workflow author or the operator on the command line, validated at
parse time as finite, positive and bounded in type. They are never interpolated into a prompt, path, command or
log line without being rendered as a number. Figures that a runner or plugin reports are untrusted input; the
meter accepts only finite, non-negative, non-decreasing figures. A buggy or malicious source can make a cap
trip early (by over-reporting) or never (by reporting nothing, which is why the unmetered count is shown and
the declaration is required). A declared reason is operator-facing text from a plugin: it is cut to 300
characters and cleaned like any untrusted text before it reaches a terminal or a file, and is never put in a
span attribute value other than as that cleaned, bounded string.

**The kept working directory.** It holds an agent's partial work, which may contain anything the agent wrote.
It is only ever under `.indaba/worktrees/<taskId>` (gitignored runtime state), is resolved and confined like
every other path, is never followed through a symlink out of that tree, and is not deleted without a decision:
a person's answer, or a resumed run's normal teardown. A resume refuses a directory that moved or left that
tree. Keeping it longer than a run is a deliberate change from "torn down however the run ends"; the report says
where it is so it is not forgotten.

**The resume file.** It holds identifiers, counters, spend totals, the saved workflow digest and the last
failure feedback, redacted with the same redaction as every other artifact and cut to the existing 4,000
characters. It holds no prompt, output, transcript or environment value. It is under `.indaba/resume/`
(gitignored), written atomically (temporary file in the same directory, then rename), and the id used in its
path is validated before any path is built from it.

**The question and the answer.** The question carries numbers, a step id and a relative path, so nothing in it
needs a secret. An answer is parsed, not evaluated: numbers are range-checked, any text is bounded, and nothing
the person types reaches a shell, a path or a log unescaped. The terminal and file channels (`--rulings`) are
the same trusted local channels as for rulings.

`--max-cost`, `--max-tokens`, `--currency` and `--rates` are read in the CLI's composition root only; the engine
never reads the environment.

**Money and rates.** A currency code is accepted only if it is in the ISO 4217 table bundled with `@indaba/core`
(three capital letters, with its number of minor units); anything else is rejected, from a runner's report as
much as from a workflow file. An amount is a finite, non-negative number. A rate is a finite number greater than
zero between two different currencies, with an `as_of` that is a real calendar date. Rates come only from the
workflow file, the `--rates` file or the engine option: never from the network, the locale, the time zone or the
environment, so a budget decision never depends on anything outside what the operator supplied. A rate table is
bounded (at most 200 entries) and read as data, never evaluated. The symbols of currencies are never used or
guessed; figures are printed with their ISO codes.

## 7. Where it lives

- `@indaba/core` (pure, no `node:` module): the `budget` and `metering_policy` fields on `StepDefinition` and
  `WorkflowDefinition`; the `Budget`, `UsageObservation` and `BudgetVerdict` types; the pure `BudgetMeter`; the
  metering declarations and reports (`Metering`, `MeteringReport`) on `Runner`, `Adjudicator`, `Guard`,
  `RunResult`, `Ruling`, `GuardResult`; `UsageReporter`; the `BudgetResolver`, `BudgetQuestion` and
  `BudgetDecision` contracts; `PluginHost.registerBudgetResolver` and the refusal of undeclared extensions;
  `StepState.restore`; the conformance check (`checkMeteringContract`, in a `testing` entry); and the events.
- `@indaba/engine`: parsing and validating the fields and the policy, the warnings, the `BudgetGate` that owns
  the meter and the question, the kept-directory and resume-file code (`WorkspaceManager.adopt`,
  `ResumeStore`), and the resume start of `WorkflowEngine`.
- `@indaba/runners`: every built-in runner declares its metering; the ACP and OpenAI-compatible runners call
  `onUsage` where they already receive spend while streaming. No runner enforces a budget itself.
- `indaba` (CLI): `--max-cost`, `--max-tokens`, `--currency`, `--rates`, `--resume`, the terminal and file resolvers chosen by the
  existing `--rulings` option, the warnings and errors in `validate` and `plan`, the spend and resume report.

## 8. Clarifications

All recommended; the maintainer confirms.

1. **Is an unknown cost zero?** No. Unknown adds nothing to a total and is counted separately as `unmetered`,
   with the source and the reason (the "No invented numbers" rule). A cap on a quantity a source never reports
   cannot trip, and the author is told before the run, not left to find out.
2. **Cap semantics: reached or exceeded?** `spent >= cap` trips. A budget of 1.00 means "stop at one dollar".
   One rule is easier to document and test than a gate before a call and a different threshold during it.
3. **Is it a guarantee?** No. Spend is known when a call returns, and during a call only if the runner calls
   `onUsage`. A single call can overshoot the cap by what it spends before the next observation, and a granted
   "one more call" is not capped at all while it runs. The documentation says "limits further spend". Runners
   that stream usage (ACP, OpenAI-compatible) narrow the overshoot; the others do not.
4. **What does a stop end as?** `escalated`, exit code 2, as every other thing only a person can resolve. The
   step is not `FAILED` (that would invite `on_failure`); it stays `RUNNING` while the question is open and
   becomes `ESCALATED` only on an answer or an unanswered end. `StepState` is unchanged for the live path.
5. **Scopes.** The step (`budget`), the step default (`defaults.budget`), the run (top-level `budget`) and the
   operator run cap (`--max-cost`, `--max-tokens`, or `WorkflowEngineOptions.runBudget` for any other front
   end). The first limit reached trips. The file's run cap and the operator cap are two caps that both apply (each in
   its own currency), so no choice between them and no cross-currency comparison is needed; the operator cap
   is final (item 8).
6. **What counts toward a step in a debate or a retry?** Everything that step caused: every attempt, every
   participant, every call an arbiter or another extension reports for it. A retry that re-runs descendants
   leaves each step its own total; the run total counts them all.
7. **Variants and verdict loops.** Every variant of a step is a metered call of that step, and every iteration
   of a verdict loop is another attempt, so both count against the same step total and the run total. A step
   with `variants: N` and a budget gives each variant an equal share (`cap / N`, `max_tokens` rounded down);
   the step total stays the cap. The question is asked about the step, never about one variant; when a share
   trips and what then happens to the other variants is for `step-variants` to define. A resume file lists every
   working directory the step kept (`workspaces`), and the saved counters are a keyed map to which
   `step-verdicts` adds its iteration counters, so neither spec needs the other's types.
8. **Why is an operator cap final?** It is the cap for scripted and CI use: the person who set it on a command
   line (or an embedding program that passed `runBudget`) wants a limit that nothing in the run can talk past,
   including a front end that answers every question with "one more call". A file budget is the author's
   default, which the person running it may raise. The flags are defined as the CLI spelling of
   `runBudget` so a web or desktop front end sets the same cap through the engine, with no flag parsing of its
   own. Recommended; if a final cap is too strict for interactive use, the alternative is to let a person raise
   it with a typed confirmation.
9. **Time.** Not budgeted here. The existing per-call timeout stays.
10. **Why ask inside the stopped call.** The call is the smallest unit that can be repeated without redoing
    anything else: a debate keeps its transcript in memory, a retry its counters, a verdict loop its iteration,
    all untouched. The price is that a resume is a fresh call over the kept work, not a continued session.
11. **The channel.** The question reuses the answer path the human arbiter uses and the `--rulings` option:
    `terminal` prompts in the terminal, `files` writes a request under `.indaba/rulings/` and waits for an
    answer, `none` registers no resolver. `specs/ruling-channel` is not built yet; this spec needs of it, and
    states here so it can be reconciled when either lands: a request `kind` (`ruling`, the default, or `budget`)
    in the same directory and the same atomic-file rules; a budget request without a transcript; an answer of
    `{ decision: 'stop' }` or `{ decision: 'resume', mode, max_cost?, max_tokens? }` (a cost in the cap's
    currency); `indaba rule <id>
    resume --raise-to-cost <amount>`, `--add-cost <amount>`, `--raise-to-tokens <n>`, `--add-tokens <n>`, `--one-call`
    and `indaba rule <id> stop`; and the records `budget_requested` and `budget_answered`. The terminal path has
    no dependency on that spec.
12. **Why a limit of five resumes per step.** A front end that always answers "one more call" would otherwise
    loop forever; a person is the bound, and a constant is the backstop. After five the step stops unanswered.
    The number is a design choice, not measured.
13. **Discarding kept work.** No command is added: answering stop on a `--resume` removes it, and git can remove
    it by hand. A `discard` command is a natural follow-up; I could not decide whether it belongs in this change.
14. **The CLI runners' honest declaration.** `claude-code`, `codex`, `cursor` and `antigravity` declare
    `unmetered` with the reason "the CLI prints no usage that Indaba reads". A follow-up task (T-27) checks, per
    CLI, whether a machine-readable source exists in the tool's own output; where one does, the runner reports
    from it. A tokenizer count of a prompt or output may be offered as `estimated` only where such a source
    makes it meaningful and only labelled so; it is never presented as reported.
15. **Version and the strict default.** The obligation changes what a published contract requires and makes any
    workflow that runs a CLI runner fail `validate` until it says `metering_policy: optional`. By this
    repository's own rule that is a major; below 1.0 it can ship as the next preview number, which the alpha
    guide already says carries no stability promise, and the CHANGELOG lists it under a breaking heading. The
    alternative that keeps it a minor is: undeclared extensions load as `unmetered` with a warning, and the
    default policy is `optional`, for one release, then the strict form. Which to ship is the maintainer's
    decision; this spec is written for the strict form.
16. **Voters and listeners.** The voter contract of `specs/voter-arbiter` is synchronous and pure, so a voter
    cannot make a call and needs no declaration; if that contract ever becomes asynchronous it must carry one. A
    listener has no return value, so it reports spend through the `UsageReporter` the host gives it, and
    declares `free` (the usual case), `metered` or `unmetered` when it is added.
17. **Why these names and this shape.** Taken from Indaba's own vocabulary, not from any other tool.
    - Field names follow the existing `max_*` limits (`max_retries`, `max_rounds_exceeded`): `max_cost` (with a `currency`)
      and `max_tokens`, grouped under one `budget` key so a third limit can join without a new top-level field.
      `max_cost_usd` stays as the USD spelling because `indaba.cost.usd` and `reportedCostUsd` already use it
      (item 20).
    - The defaults block is the existing `defaults` (today it carries `mcp_policy`), merged field by field; the
      policy is `metering_policy` with the values `required` and `optional` that `mcp_policy` already uses.
    - The stop reuses the `escalated` outcome, exit code 2 and the teardown path.
    - Runners and other extensions take part through the contracts they already implement and the host they
      already register with; the engine has no special case for any runner by name, and nothing is reachable
      only by the built-ins.
    - The meter is pure arithmetic in `@indaba/core` over numbers handed to it. It holds no clock, random source,
      environment or id; the one timestamp in the resume file comes from the injected clock and the ids from the
      injected generator.

18. **Why a `Money` and not a number with a unit in its name.** A cost that is only ever USD can be a number; a
    cost in any currency cannot be read without its code. `Money` is the smallest honest shape, it is what a source
    reports "as it is", and it keeps conversion out of the sources: a runner never converts, only reports.
19. **Rates are data, injected.** A live rate would make a budget decision depend on the network and the moment,
    and the same run could stop at different points on two days. Supplied rates keep the decision a pure function
    of its inputs, like the clock and the ids. The price is that the person supplying rates keeps them current
    (item 22). `as_of` is a date, not a time: it is a label for a reader, not an input to any decision.
20. **Keep `max_cost_usd`, add `max_cost` and `currency`.** Nothing of this feature has shipped, so replacing the
    field would break no one; it is kept anyway because the USD names are already public (`indaba.cost.usd`,
    `reportedCostUsd`) and a USD-only author should not have to learn a currency field. The cost is a second
    spelling that must be documented as an exact equivalent, and giving both is an error. The alternative, one
    spelling (`max_cost` plus `currency`, default USD) and no `max_cost_usd`, is simpler and also a minor today;
    removing `max_cost_usd` later would be a major. The choice is recommended, not forced.
21. **Why two caps instead of a comparison.** The file's run cap may be in EUR and the operator's in PLN. Taking
    "the tighter" would need a rate between them just to choose; keeping both and letting the first reached trip
    needs none and is the same limit in effect.
22. **A stale rate makes a cap approximate.** The engine cannot know a rate is old without comparing a date with
    the clock and choosing an age, which would be an invented number. It prints the rate's date wherever the rate
    is used and leaves the judgement to the person who supplied it. A cap in a currency other than the one a
    source bills in is, honestly, a cap on the author's estimate of the exchange, not on the bill.
23. **No chaining, a reciprocal allowed.** One hop only, because each hop multiplies the uncertainty. A reciprocal
    of a supplied rate is allowed and always labelled, because a table rarely lists both directions and the
    reciprocal ignores any spread, which the label makes visible.
24. **Totals only when complete.** A converted total with one line missing would read as the whole. A total is
    printed only when every part converted; otherwise each currency is listed on its own line.
25. **Not decided here.** Whether a rate table should also be readable from a per-user configuration file: no
    such file exists today, so rates come from the workflow, `--rates` and the engine option only.

## Artifacts not written

- `research.md`: nothing external is relied on. Every behaviour here is defined by Indaba's own runners, pricing
  table, engine and the specs it builds on, which `plan.md` names.
