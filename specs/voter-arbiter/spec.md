# Specification: Voter arbiter

> **Status**: Draft
> **Stage entry**: 1
> **Semver impact**: minor (new optional workflow fields, a new `PluginHost` method, new span attributes;
> no default changes). Stacked on `specs/debate-arbiter`, which is not merged yet.

---

## 1. The problem

A debate that ends without consensus can be settled by a person (`specs/debate-arbiter`). That is the right
last word, but it is the only one: a person is asked every time, even when the transcript already shows an
obvious outcome (two reviewers cite the same files and one has agreed, or they cite entirely different files
and agree on nothing). There is also no way to put another decision-maker in front of the person, or to chain
several, and no scoring that Indaba itself can offer.

The run that motivated the arbiter shows it: two reviewers converged on the same five findings but both
answered `CRITIQUE`, so the debate failed. Something that can *score* how close a failed debate came would let
Indaba rule on the clear cases and hand only the unclear ones to a person.

## 2. User stories

- **US-01.** As a workflow author, I want Indaba to rule on a failed debate from measurable signals in the
  transcript, with thresholds I set, so that only the unclear debates need a person.
- **US-02.** As a workflow author, I want to chain arbiters (`[voters, human]`): the first that can decide
  does, otherwise the next is asked.
- **US-03.** As someone who disagrees with how Indaba scores, I want to replace or add a voter, and choose
  which voters count in a step, without editing Indaba.
- **US-04.** As a reviewer of the result, I want to see each voter's score and reason, and the mean, in the
  ruling file and the ledger.

## 3. Acceptance criteria

- [ ] AC-01. `arbiter` takes a name or a non-empty list of names. The first is tried first; each later one is
  tried only when the earlier one cannot decide (returns no ruling). The first ruling wins. If none rules, the
  step escalates, and the reason names each arbiter that could not decide. A name outside `[A-Za-z0-9_-]` or an
  empty list fails validation naming the step.
- [ ] AC-02. A step may carry `voters: { use, accept_at, reject_below }`. `use` is a list of voter names (default
  all built-in voters, in the order below), `accept_at` and `reject_below` are numbers from 0 to 10 with
  `reject_below <= accept_at` (defaults 7 and 4). `voters` on a step whose `arbiter` does not include `voters`,
  or any of these breaking their rules, fails validation naming the step and the field.
- [ ] AC-03. There is a built-in arbiter named `voters`. It asks each selected voter for a vote (a score from 0
  to 10, or an abstention, with a reason), takes the mean of the scores that were cast, and rules `accept` when
  the mean is at least `accept_at`, `reject` when it is below `reject_below`, and otherwise cannot decide. With
  no score cast it cannot decide.
- [ ] AC-04. Two voters are built in, both pure and deterministic:
  - `agreement`: ten times the share of participants whose latest message is `AGREEMENT`.
  - `overlap`: among the participants whose latest message is not `AGREEMENT`, the files they cite (a token
    that looks like `path/name.ext`, with any `:line` removed, compared case-insensitively). Ten times the
    number of files cited by all of them divided by the number cited by any. Abstains unless at least two such
    participants cite at least one file each.
- [ ] AC-05. The ruling's note lists each voter with its score and reason (abstentions as "abstained" and why,
  never as zero), then the mean and the thresholds. It is written to the ruling file and the ledger like any
  other note.
- [ ] AC-06. A plugin can add a voter with `host.registerVoter(voter)`. Registering a name that is already
  registered is an error unless the call says `{ replace: true }`, which replaces it (this is how a built-in
  is overridden). Built-ins register through the same call.
- [ ] AC-07. A `use` naming a voter nobody registered fails the step at run time, listing the registered names.
- [ ] AC-08. A voter that throws, or returns a score that is not a finite number from 0 to 10, fails the step
  (not escalates), naming the voter.
- [ ] AC-09. Given the same request and the same voters, the `voters` arbiter returns the same ruling. It reads
  no clock, randomness or environment, and starts no process.
- [ ] AC-10. The span of a step that a voters arbiter ruled on records `indaba.arbiter.kind = voters`,
  `indaba.arbiter.score` (the mean) and `indaba.arbiter.votes` (how many scores were cast). Voters' reasons and
  the transcript are in no span. When a later arbiter rules, `kind` is that arbiter's.
- [ ] AC-11. The ledger records the arbiter that actually ruled as `kind`. A reused ruling skips the whole
  chain, as before.
- [ ] AC-12. Every new line is covered by tests; the 85% floor holds.
- [ ] AC-13. A voter may carry a `description`, and the registry lists names with descriptions so a wizard can
  offer them (`specs/workflow-editor`). The built-in voters are described in one line each: what they measure.

## 4. Non-goals

- A voter that calls a model. A plugin can provide one through `registerVoter`; Indaba ships none, so a score
  never costs tokens unless the author chose that.
- Weighted voters, per-voter thresholds, or a vote that depends on another voter's.
- Judging whether the work is *good*. See section 6.
- Anything during the debate: voters speak once, after it failed.
- Learning or calibrating the thresholds from past rulings.
- Changing what counts as agreement in the debate itself.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| every voter abstains | the `voters` arbiter cannot decide; the next arbiter is asked |
| the mean falls between the two thresholds | cannot decide; the next arbiter is asked |
| the chain ends with nobody having ruled | escalated, reason names each arbiter and that it could not decide |
| a voter throws or returns an invalid score | step failed, naming the voter |
| `use` names an unknown voter | step failed, listing the registered voter names |
| a voter's reason is very long or contains escape sequences | cut to 300 characters and cleaned before it is used anywhere |
| `voters` runs with no participants' messages (empty transcript) | every built-in abstains; cannot decide |
| the run is cancelled while a later arbiter (a person) waits | as in `specs/debate-arbiter` |

## 6. Security and data handling

The transcript is untrusted model output. The built-in voters only read it: they match it with fixed regular
expressions of bounded cost and never use it as a command, path, URL or key. A cited "file" is compared as text
and is not opened. Reasons carry text derived from the transcript (for example a file name), so they are cleaned
and cut like any untrusted text before they reach the ruling file, the ledger or the terminal; they are never put
in a span.

**What the scores mean.** They measure how far the *debate* converged: whether participants agreed, and whether
they were talking about the same files. They do not measure whether the work is right. Two reviewers who both
confidently repeat a wrong finding about the same file score high. That is why the default thresholds leave a
wide undecided band (4 to 7) for the next arbiter, and why `[voters, human]` is the intended chain. The default
thresholds are design choices made here, not measured on any data; the documentation says so.

## 7. Where it lives

- `@indaba/core` (pure): the `Voter` and `Vote` contracts, the two built-in voters, the `voters` arbiter
  (`VotersAdjudicator`), the voter registry, the `arbiter` chain and `voters` fields on `StepDefinition`, and
  `PluginHost.registerVoter`. Everything here is deterministic over the transcript, so it needs no `node:` module.
- `@indaba/engine`: parsing and validating the fields, and trying the arbiters in order in `runConsensus`.
- `indaba` (CLI): registers the built-in voters and the `voters` arbiter through the plugin host.

## 8. Clarifications

Resolved with the maintainer:

- The voters are Indaba's own algorithm, not extra model calls, and they can be overridden.
- The ruling is the mean score against a threshold.
- When the score cannot decide, the next arbiter is asked: arbiters chain.

Defaults chosen here, inherited by every consumer:

- Scale 0 to 10, `accept_at` 7, `reject_below` 4. Not measured; documented as defaults.
- Two built-in voters (`agreement`, `overlap`). A third that rewards "positions stopped changing" was rejected:
  a debate that has stopped changing without agreeing is a deadlock, so such a voter would raise the score for
  the wrong reason.
- Overlap is by file, not by finding: coarse on purpose, because finding text cannot be compared reliably.
- Override is explicit (`replace: true`), so two plugins cannot silently replace each other's voter.
- Voters run one after another in `use` order, so the breakdown and any failure are reproducible.
- The `arbiter` chain generalises the single name of `specs/debate-arbiter` and mirrors the runner chain
  (`runner` plus `fallbackRunners`). A single name keeps working unchanged.

## Artifacts not written

- `research.md`: the options were weighed in conversation; nothing depends on outside facts.
- `data-model.md`: the shapes are in api-surface.md; there is no state beyond one ruling.
- `events.md`: no event is added; the span attributes are listed in api-surface.md.
