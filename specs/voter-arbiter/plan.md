# Plan: Voter arbiter

> Stage 3. Contract: [`api-surface.md`](api-surface.md). Behaviour: [`spec.md`](spec.md).
> Stacked on `feat/debate-arbiter`: it changes `StepDefinition.arbiter` handling and `runConsensus` from that branch.

## Where each piece goes

| Piece | Package | Why there |
| :--- | :--- | :--- |
| `Vote`, `Voter`, `VoterRegistry`, `AGREEMENT_VOTER`, `OVERLAP_VOTER`, `VotersAdjudicator`, `VotersDefinition` | `@indaba/core` (`src/mesh/voters.ts`) | pure functions of the transcript; no I/O |
| `fallbackArbiters`, `voters` on `StepDefinition`; `RulingRequest.voters`; `PluginHost.registerVoter` | `@indaba/core` | the model and the extension contract |
| parse `arbiter` as a name or a list, parse `voters`, validate | `@indaba/engine` (`parser/`) | existing parser and validator |
| try arbiters in order, pass `voters` into the request, unknown voter / invalid score as failures | `@indaba/engine` (`step-executor.ts`) | the only place a debate runs |
| `registerVoter` in `RegistryPluginHost`; register built-ins and the `voters` arbiter | `indaba` (CLI) | composition root |

## Voter definitions

Participants are the distinct senders in the transcript. A participant's latest message is its last one.

- `agreement`: `10 * agreeing / participants`, `agreeing` being those whose latest type is `AGREEMENT`. Reason:
  `"<agreeing> of <participants> participants agree"`. Abstains on an empty transcript.
- `overlap`: take the latest messages that are not `AGREEMENT`. Extract file tokens from each with the pattern
  in `api-surface.md`, strip `:line`, lower-case, de-duplicate. Keep the participants with at least one token.
  Fewer than two: abstain ("fewer than two participants cite a file"). Otherwise
  `10 * |intersection of all| / |union of all|`, one decimal place not applied (the mean is rounded for display
  only). Reason: `"<n> of <m> cited files are cited by all"`.

Scores are not rounded when computed; the note shows one decimal place. The pattern is applied to at most
the first 20,000 characters of a message, so a hostile message cannot make matching expensive.

## `VotersAdjudicator.rule`

1. Resolve `request.voters.use` (default: every registered built-in, i.e. `BUILT_IN_VOTERS` names) against the
   registry; an unknown name throws `IndabaError("unknown voter ... registered: ...")`.
2. Call each voter in order. A throw is wrapped as `IndabaError("voter \"x\" failed: ...")`. A `score` vote that
   is not a finite number in `[0, 10]` throws `IndabaError("voter \"x\" returned an invalid score")`.
3. Mean of cast scores; none cast: return `null`.
4. `>= acceptAt`: accept. `< rejectBelow`: reject. Otherwise `null`.
5. The note is built from cleaned, cut reasons, and the executor sets `indaba.arbiter.score` and `.votes`.
   The adjudicator returns the note; it needs a way to hand back the two numbers, so `Ruling` gains optional
   `score?: number` and `votes?: number` (additive; recorded in the ledger entry too).

## `runConsensus` change

`[arbiter, ...fallbackArbiters]` in order. For each name: unknown name is skipped with the reason
"nothing registered under that name" (as today for a single name); `rule` returning `null` is skipped with
"could not decide"; the first ruling is used. If the list ends without one, escalate with a reason listing each
arbiter and why. A throw still fails the step. The span's `kind` is the arbiter that ruled; `score` and `votes`
are set only if the ruling carries them.

## Decisions recorded

- **No new dependency.** Pure TypeScript in core.
- **Voters synchronous.** `vote()` returns a `Vote`, not a promise: a voter that needs I/O or a model is a
  different kind of thing (an `Adjudicator`), and keeping this one synchronous keeps it deterministic.
- **Override by `replace: true`.** Explicit, so a typo cannot silently shadow a built-in.
- **Ledger.** `kind` is the arbiter that ruled; `score` and `votes` are added to the entry when present. Old lines
  without them stay valid.

## Analysis (stage 5)

| Check | Result |
| :--- | :--- |
| Published signature broken? | No. `arbiter` still accepts a single name; new fields are optional; `Ruling` gains optional members. Minor. |
| `node:` import in core? | No. The voters use string and regular expression operations only. |
| New runtime dependency? | None. |
| Untrusted data to shell, path, URL or log? | The transcript is matched by fixed patterns on bounded input; matches are compared as text and never opened. Reasons are cleaned and cut before use and are not put in spans. |
| Wall clock, randomness, environment? | None in voters or the adjudicator. |
| Unbounded loop or buffer? | Voters loop over a bounded transcript; per-message matching is capped at 20,000 characters; reasons at 300. |
| Secrets? | The ruling note goes through the existing `redact` before any write. |
| Regular-expression cost | The file-token pattern has no nested quantifiers; with the input cap, matching is linear. A test feeds 20,000 characters of near-matches. |

One decision to flag for review: `Ruling` gains `score` and `votes` so the executor can set attributes without
parsing the note. The alternative, a `details` bag, was rejected as an untyped escape hatch.
