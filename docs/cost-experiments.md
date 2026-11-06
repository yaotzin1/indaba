# Spending less: experiments to try

Indaba lets you decide which model does which job. That makes it possible to spend differently, for
example a strong model where a mistake is expensive and something smaller or local where it is not. This
page lists ideas for doing that. They are **suggestions to try on your own setup**, not
recommendations and not promises. Whether any of them saves anything depends on your models, your task,
what you pay and how good the result has to be, and only a run of your own can tell you. The page gives no
prices and no expected savings on purpose.

## What Indaba gives you, and what it does not

| It gives you | Where |
| :--- | :--- |
| A model per role, so one runner can serve a strong role and a cheap role | [`roles`](workflow-format.md#roles) |
| A list of runners per role or step | [Transports and fallback](workflow-format.md#transports-and-fallback) |
| Your own OpenAI-compatible server, such as Ollama, LM Studio or vLLM, as a runner | [API runners](getting-started.md#api-runners) |
| Shell steps, which call no model | [Shell steps](workflow-format.md#shell-steps) |
| Bounded retries, a bounded debate, and a time limit for each step | [Retries](workflow-format.md#retries-on_failure), [Consensus steps](workflow-format.md#consensus-steps), `timeout_seconds` |
| What each call used and, where known, cost | `indaba run -v`, the trace, the [web view](web-view.md) |

It does **not** give you a spending ceiling. A run is never stopped because of what it has spent; a budget
is specified in [`specs/step-budgets`](../specs/step-budgets/spec.md) and not built. The limits that exist
today bound time and attempts (`timeout_seconds`, `max_retries`, the rounds of a debate), not money.

And a cost is shown only when it is known: the model's price is known and the runner reported usage, or the
runner reported a cost itself. `codex`, `antigravity`, `cursor` and `opencode` report nothing Indaba reads,
and a local model has no price. An unknown cost is shown as absent, not as zero. A step that shows no cost is
not necessarily a cheap step.

## How to run an experiment

1. **Change one thing.** Move one role to another model, or one step to a shell command, and leave the rest.
2. **Use the same task** and the same starting files each time. `indaba plan` shows which role and runner
   each step will use before anything runs.
3. **Run it more than once.** A model's output varies, and so do its retries.
4. **Read two things, not one.** Read what the run used (`indaba run -v`, or the Cost screen of
   `indaba ui`), and read what you got: did the guards pass, how many times did a step retry, what did
   the review find, did you have to fix the result by hand? A cheaper run that needs your afternoon is not
   cheaper for you.
5. **Keep the workflow file** of each variant, so the comparison can be repeated.

[`examples/cost-tiers.workflow.ai.yml`](../examples/cost-tiers.workflow.ai.yml) is a starting point with
three tiers in it. Its model names are placeholders; put in models you can use.

## Ideas to try

### Match the model to the cost of a mistake

A plan is followed by every later step, so an error in it is repeated. A first draft is followed by a check.
You might give the first to a stronger model and the second to a smaller one. In the file, that is two roles on
the same runner with different models:

```yaml
roles:
  planner:
    runner: "openrouter"
    model: "your-strongest-model"
  drafter:
    runner: "openrouter"
    model: "your-cheaper-model"
```

Which steps deserve the stronger model is the question to answer by trying. Planning and review are the
usual candidates; so is whatever step you found yourself correcting by hand.

### Use a shell step for anything that is a rule

Running tests, a linter, a type check or a link check needs no model. A step with `runner: "shell"` calls
none, and a guard on a step does not either. If a step asks a model to decide something a command can
decide, the command may be the cheaper way to do it, and it gives the same answer each time.

### Let a check catch the cheap model's mistakes, and count the retries

A smaller model that is checked by a test and allowed a few retries may reach a good result. It may also fail
the check again and again. A retry carries only the last failure, not the history, so it does not grow, but each
attempt still runs. Try it and look at how many attempts a step needed. If the cheaper role retries often, the
experiment has told you something.

```yaml
on_failure:
  action: "retry_step"
  target: "draft"
  max_retries: 2
```

`escalate` instead of `retry_step` ends the run at the first failure, which may suit a step where you would
rather look yourself than pay for another attempt.

### Shape the debate

A debate is a conversation, so it grows with the number of participants and the rounds. The participants are
the step's `role` plus every role in `consensus_with`, and a debate runs up to four rounds. You could try
fewer participants, shorter replies (say so in the `goal`), or reviewers on smaller or local models with a person
as the `arbiter` for the cases they cannot settle. Whether a smaller reviewer finds what a stronger one finds
is again something to compare, by running both on the same work.

### Try a local model

Any server that speaks the OpenAI chat API can be a runner. You configure it in the environment, never in the
workflow file:

```
INDABA_OPENAI_COMPAT_LOCAL_BASE_URL=http://localhost:11434/v1
INDABA_OPENAI_COMPAT_LOCAL_MODEL=<a model your server has>
```

This makes a runner called `local`, and a role can use it (`runner: "local"`). Things to know before you try:

- It is a text runner. Like every API runner, the model returns text and cannot edit files or run tools by
  itself, so it suits steps that read and write text: a review, a summary, a first draft.
- Nobody bills you per token, but the machine, its power and your waiting time are costs too. Indaba cannot see
  them, and it shows a local model's cost as unknown.
- Small models follow a strict output format less reliably. Keep the `goal` short and exact, and put a guard or a
  check after the step.
- The prompt stays on your machine. For some work that matters as much as cost.

### Fallback is for availability, not for quality

A runner list is tried in order, but the next runner is used only when the earlier one **could not run**: no
key, no program, the endpoint did not answer. A runner that ran and gave a poor result is not replaced by the
next one. So `["local", "openrouter"]` means "use the local server when it is up, and the API when it is not".
It does not mean "try local first and pay for the API only if the answer is bad". For that you would need a
step that checks the answer and a retry on a different role.

### Send less to each step

An agent is told to read a step's `input_artifacts` first. Naming only the files a step needs, and keeping a
`goal` short and exact, means less is read. Whether it matters is, again, something to measure.

### Put a limit on time, and on silence

`timeout_seconds` on a step limits each call of its runner. It is a limit on time, not on money, but a call that never
ends is one you may be paying for. `stall` stops a call that has gone quiet and can run the step again; read
[Stalls](workflow-format.md#stalls-stall) first, because only some runners can use it and a stalled attempt may already
have cost something. Whether a retry saves anything is another thing to measure: it is a second attempt that is paid for.

## What to write down

A comparison is only useful if you can read it later. For each variant, note:

| Question | Where to find it |
| :--- | :--- |
| What did each step use, and where known, cost? | `indaba run -v`, `.indaba/traces/`, the web view |
| Was any cost unknown, and for which steps? | the same; unknown means absent |
| How many attempts did each step need? | the trace, the board |
| Did every guard and check pass, and did the review find anything? | the run's end status and the board |
| What did you have to fix by hand? | your own notes |

If a step's cost is unknown, do not compare it with one that is known as if it were zero.

## See also

- [workflow-format.md](workflow-format.md): every field named above.
- [getting-started.md](getting-started.md#environment-variables): the variables for a local endpoint, and which runners report usage.
- [using-the-alpha.md](using-the-alpha.md): which transport to choose when.
- [web-view.md](web-view.md): the Cost screen of a run.
