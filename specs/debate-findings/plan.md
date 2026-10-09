# Plan: Debate findings and prompts

> Stage 3. Contract: [`api-surface.md`](api-surface.md). Behaviour: [`spec.md`](spec.md).
> Stacked on `feat/voter-arbiter`, itself on `feat/debate-arbiter`. Merge them in that order.

## Where each piece goes

| Piece | Package | Why there |
| :--- | :--- | :--- |
| `Finding`, `AgentMessage.findings()`, `IMPORTANCE_VOTER`, `PromptRegistry`, `DEBATE_REVIEW_PROMPT`, the `instructions` option | `@indaba/core` | pure text and parsing, no I/O |
| `prompt`, `promptAdditions`, `defaultPromptAdditions`, `PluginHost.registerPrompt` | `@indaba/core` | the model and the extension contract |
| parse and validate the three fields; warning in `WorkflowValidator.warnings` | `@indaba/engine` (`parser/`) | existing parser and validator; `validate` and `plan` already print `warnings` |
| decide whether additions apply, resolve the prompt, build `instructions`, write the findings file, set attributes, extend the ledger key | `@indaba/engine` (`step-executor.ts`, `arbiter/`) | `runConsensus` is where the debate runs |
| register the prompt through the host | `indaba` (CLI) | composition root |

## Parsing findings

One pattern per line, applied to the first 20,000 characters of a message:
`^\s*(?:[-*]\s*)?FINDING\s*\[\s*([^\]\s]{1,3})\s*\]\s*(.*)$`, case-insensitive, multiline. The captured number
is accepted if it is `1` to `5` exactly; anything else increments `ignored`. The text is the rest of the line,
trimmed and cut to 500 characters. After 50 findings, further lines are not read (and not counted as ignored).
No nested quantifier, so matching is linear; a test feeds 20,000 characters of near-matches.

## The built-in prompt (`debate-review`)

```
## How to report findings
List every issue you want addressed on its own line, exactly like this:
FINDING [n] <file path or area>: <what is wrong and why it matters>
where n is how much it matters, as you honestly judge it: 5 = must be fixed before this ships, 4 = serious,
3 = should be fixed, 2 = minor, 1 = cosmetic. Put the file path (without a line number) in each finding that
concerns a file. In each reply, list only the findings you still stand by: leave out one that has been
answered, and do not repeat another reviewer's finding unless you agree with it, in which case repeat it with
your own number. Your numbers are used to decide how serious an open disagreement is, so do not inflate
them. If you have no findings, say so and answer AGREEMENT.
```

It asks for a reply that still starts with the reply-protocol keyword, so `AgentMessage.fromReply` is untouched.
The text is a constant in core. Its wording is a design choice and is expected to be tuned; the ledger key
includes it so tuning it never reuses an old ruling.

## `importance` voter

Latest message per sender; keep those not `AGREEMENT`; read their findings; if none has any, abstain
("no findings reported"). Otherwise `w` is the highest importance, the score is `10 * (5 - w) / 4`, the reason is
`"worst open finding is <w> (agent-reported); <k> findings counted<, m malformed lines ignored>"`.

## `runConsensus` change

1. `additions = step.promptAdditions ?? workflow.defaultPromptAdditions ?? (step.arbiter !== undefined)`.
2. If on: resolve `step.prompt ?? 'debate-review'` from the registry (unknown name throws `IndabaError`, listing
   `names()`); pass the text as `instructions` to every `RunnerParticipant`.
3. Add the prompt name and text to the memo key.
4. After the debate: set `indaba.prompt.additions`, and when on `indaba.prompt.name`, `indaba.findings.count` and
   `indaba.findings.max_importance` over the latest messages' findings; write `<step>.findings.md`.

## Findings file

Latest message of each participant, flattened, sorted by importance descending then participant order, each line
`[n] <participant>: <text>` (text cleaned, redacted, cut at 500). Below it, "Files named by every participant" from
the same file-token pattern as `overlap` (shared helper in core). A header says the numbers are agent-reported.

## Decisions recorded

- **No new dependency.**
- **No placeholders in prompts.** There is nothing to interpolate, so nothing to inject.
- **`registerPrompt` replaces explicitly**, matching `registerVoter` and `registerAdjudicator`.
- **Prompts from project files are excluded** (spec section 6).
- **The warning is a validation warning, not an error**, because turning the additions off is allowed.

## Analysis (stage 5)

| Check | Result |
| :--- | :--- |
| Published signature broken? | No. Every addition is optional. With no arbiter, the debate prompt is unchanged, proved by a snapshot test. Minor, conditional on the arbiter specs shipping together. |
| `node:` import in core? | No. Text and string operations only. |
| New runtime dependency? | None. |
| Untrusted data to shell, path, URL or log? | Findings are matched by a bounded linear pattern, kept as text and a number from 1 to 5, cleaned and redacted before the file, and in no span. The prompt has no interpolation. |
| Wall clock, randomness, environment? | None. |
| Unbounded loop or buffer? | 20,000 characters examined per message, 50 findings, 500 characters per finding. |
| Retry isolation? | The addition is static text, identical every round; no history is carried. |
| Secrets? | The findings file passes through `redact`. |
| Ledger staleness | The prompt in force is in the memo key (AC-09); a test changes the prompt and expects a miss. |

**Flag for review.** `debate-review` instructs agents to list only findings they still stand by. If a model drops a
finding for a reason other than having been answered, the `importance` voter sees a better debate than there was.
That is inherent in self-reported opinion and is why the voter's reason says "agent-reported" and why the
documentation tells authors to keep a person at the end of the chain for anything that matters.
