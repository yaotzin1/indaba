# Specification: Step variants (independent attempts, examined by other agents)

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 (the decisions in section 8 are recommended; the maintainer confirms)
> **Semver impact**: minor (new optional step fields, additive fields on `AgentMessage`, `ConsensusResult`, `Ruling`
> and `RulingRequest`, new artifacts, events and span attributes; no default changes)
> **Builds on**: [`specs/agent-mesh`](../agent-mesh/spec.md) (the debate rounds, the stall detector, the quorum),
> [`specs/debate-arbiter`](../debate-arbiter/spec.md) (what happens when a debate fails),
> [`specs/git-workspace`](../git-workspace/spec.md) (worktrees and patches). Siblings written at the same time:
> [`specs/step-budgets`](../step-budgets/spec.md) and [`specs/step-verdicts`](../step-verdicts/spec.md); this spec
> names where it meets each.

---

## 1. The problem

An agent step that edits code is a single draw from a model. Indaba's answer to a poor draw is a sequence: run the
step again with the last failure appended (`on_failure`), or put a debate step after it. Both are *anchored*: a retry
is told what was wrong with the previous attempt, so it explores near it by design (the retry-loop isolation rule),
and a debate reviews one result. Neither can ask the question that matters when a change is costly to get wrong:
what would a *different* attempt, by the same model or another, have produced, and which of the attempts survives
scrutiny by agents that did not write it?

Two things stop an author writing that today. The engine runs a workflow's steps one after another in one shared
worktree, so two sibling steps cannot be independent attempts at the same thing: the second sees the first's edits.
And a debate decides *whether everyone agrees with a proposal*; it has no way to decide *which of several results*,
and its arbiter can only say accept or reject.

The idea is Indaba's own strength turned on competing work: run the attempts in isolation, then let other agents
cross-examine them, with the machinery that already decides when a debate has converged, has stalled, or needs a
person.

## 2. User stories

- **US-01.** As a workflow author, I want to write `variants: 3` on an editing step, so the step is attempted three
  times, each in its own worktree, without seeing the others.
- **US-02.** As a person who runs or embeds Indaba, I want the maximum number of attempts to be a setting of the
  engine and not part of the file format, so an installation decides how much disk, process count and spend a
  workflow may ask for.
- **US-03.** As a workflow author, I want other agents (roles I name) to read every attempt's diff, argue, and agree
  on one, so the choice is a recorded cross-examination and not my eyeballs.
- **US-04.** As a workflow author, I want a failed or split examination to go to the arbiter I already use for
  debates (a person, voters, a plugin), so I do not learn a second mechanism.
- **US-05.** As a person reading the run afterwards, I want every attempt's diff and the examination's transcript
  saved, so I can read what was rejected and why, and apply a loser by hand if I disagree.
- **US-06.** As a workflow author, I want an attempt that fails its guards or does not produce its outputs dropped
  before anyone examines it.
- **US-07.** As a person who cancels a run, I want every attempt stopped and every extra worktree removed.
- **US-08.** As a developer embedding the engine, I want the examination to be the debate machinery with a different
  quorum rule, so a plugin arbiter that already works for debates works here.

## 3. Acceptance criteria

- [ ] AC-01. A step may declare `variants: N`, an integer of at least 2. The file format has no upper bound; the
  engine has one, `maxVariants` (default 3, C-01). A non-integer, a number below 2, or one above `maxVariants` fails
  validation with a message naming the step and, for the last, the limit.
- [ ] AC-02. `variants` is valid only on an agent step that declares `isolation: git_worktree` itself and also
  declares `examine_with`, a non-empty list of role names. On a shell step, a debate step (`consensus_with`), a step
  whose isolation is `none` or only inherited from a dependency, or a step without `examine_with`, validation fails
  naming the step and the reason. `examine_with` without `variants` fails too. No existing workflow is affected.
- [ ] AC-03. Every variant runs with the step's own runner chain, model and agent. `variants` carries no per-variant
  settings (C-01).
- [ ] AC-04. Each variant runs in its own worktree, started from the state the step's workspace is in when the step
  begins (earlier steps' changes included), not from `HEAD` alone (C-03). A variant is given no path but its own.
- [ ] AC-05. Variants run concurrently, at most `variants_concurrency` at once (default 2, never above the count).
  No more worktrees exist at a time than that, plus the step's own workspace.
- [ ] AC-06. A variant is one attempt: the step's prompt, `outputs`, `input_artifacts`, `permissions`, MCP servers,
  runner chain with fallback and timeout apply to it as they would to the step run once. The step's `on_failure` is
  not applied inside a variant; it applies to the step as a whole (AC-14).
- [ ] AC-07. When a variant's agent finishes, the step's `outputs` check and guards (including the implicit
  `diff_within_scope` that `permissions` adds) run in that variant's worktree. A variant that fails either is
  `failed`; a cancelled one is `cancelled`; the rest are candidates. A candidate's diff is measured from its starting
  point (C-03), redacted, and written to `.indaba/artifacts/<step-id>.variant-<n>.diff` (n from 1, declaration
  order). A failed variant's diff is kept too, when it has one.
- [ ] AC-08. When every variant has finished and at least one is a candidate, the **examination** runs: a debate
  among the `examine_with` roles, using the existing rounds, stall detection and `decision_type` (default
  `consensus`; `majority` allowed), with a ballot quorum instead of an agreement quorum (C-04). Each examiner, every
  round, replies with a first line `CHOICE: <candidate id>` or `CHOICE: none`, then its reasons and its answer to the
  other examiners.
- [ ] AC-09. Examiners are shown each candidate by its id (`variant-<n>`), its files changed and lines added and
  removed, its verdict where the step declares verdicts, and the path of its diff file, staged into the examiner's
  working directory. They are **not** told anything else about how it was produced (C-05). A reply whose first line
  is not exactly a candidate id or `none` is a message with no choice; it can never satisfy the quorum.
- [ ] AC-10. The quorum is met when the latest message of every examiner (`consensus`), or of more than half
  (`majority`), names the same choice. The outcome is then `reached` with that choice. A choice of a candidate
  applies that candidate's diff (AC-12). A choice of `none` ends the step `ESCALATED` with the examiners' reasons.
- [ ] AC-11. When the examination ends `stalled` or `max_rounds_exceeded`, the step's `arbiter` (if it has one) is
  asked exactly as for a failed debate, with one addition to the request: the ballot (the candidates, how many
  examiners chose each, and the leader, which is the choice with the most examiners naming it, or none on a tie). A
  ruling of `accept` applies the leader, or the candidate the ruling names (C-07). `reject` ends the step
  `ESCALATED`. An `accept` with no leader and no named candidate is not a decision: the step ends `ESCALATED` saying
  the examiners tied. With no arbiter, or an unavailable one, the step ends `ESCALATED` as a failed debate does, and
  nothing is applied.
- [ ] AC-12. A chosen candidate's diff is applied to the step's workspace by `PatchService.apply`, after
  `canApply`, exactly as a normal step's result is carried forward, and the step completes. Nothing else is applied.
  The existing patch artifact export then runs as after any isolated step.
- [ ] AC-13. Examiners must not change the workspace. The engine snapshots the step's workspace before the
  examination and, after it, checks that its diff since the snapshot is empty; if not, the step fails naming that the
  workspace changed during examination, and nothing is applied.
- [ ] AC-14. If no variant is a candidate, the step is `FAILED` with one line per variant (its index and the first
  failure, redacted and cut), so `on_failure: retry_step` can use it as feedback. A retry re-runs every variant in
  fresh worktrees and re-runs the examination; nothing from the earlier attempt is reused.
- [ ] AC-15. The examination writes the existing debate artifacts (`.indaba/artifacts/<step-id>.transcript.md`, and
  `<step-id>.ruling.md` when an arbiter ruled), and a `<step-id>.selection.md` listing each variant, its outcome, the
  ballot per round, the result and the source of the decision. Files of an earlier attempt are overwritten.
- [ ] AC-16. Every variant worktree is removed when the step ends, however it ends. Removal is not cancelled by the
  abort signal. A removal that fails is reported and fails the run, as the run's own teardown failure does.
- [ ] AC-17. Cancelling the run aborts every running variant and the examination, and ends the step cancelled.
- [ ] AC-18. Given the same workflow, the same injected id generator and the same results from the runners, the
  variants get the same worktree names, are numbered in declaration order, and are presented to the examiners in that
  order. Completion order never changes numbering or the order shown. The ballot tie rule uses no randomness (C-06).
- [ ] AC-19. The step's budget (`specs/step-budgets`), when it has one, is divided equally among the variants; what
  the examination spends also counts against the step's total, which stays the cap. A variant that exhausts its share
  ends `failed` for that reason. An unreported cost is unknown, never zero.
- [ ] AC-20. When the step declares verdicts (`specs/step-verdicts`), each variant's verdict is read from its own
  output and shown to the examiners. Only the applied candidate's verdict is routed.
- [ ] AC-21. `indaba plan` prints, for a step with variants, the count, each variant's runner chain and model, the
  concurrency, the examiners, the decision type, the arbiter and the worst-case number of worktrees.
- [ ] AC-22. The step's span has one child span per variant, and the attributes and events of `events.md`. No diff
  text, summary, reason or note is in any span, event or log line.
- [ ] AC-23. The decision ledger is neither read nor written for a variants step (C-08).
- [ ] AC-24. A debate step without `variants` behaves exactly as before: the agreement quorum is the default, the new
  fields are absent, and every existing test passes unchanged.
- [ ] AC-25. Every new line is covered by tests; the 85% floor holds.

## 4. Non-goals

- A pick-one prompt that exists only to let a person compare attempts. The person's role is the **arbiter** of a
  failed examination, the same as for a failed debate (C-09). An author who wants a person to decide can always set
  `arbiter: human`; Indaba adds no second way to ask.
- Scoring attempts automatically by running tests or a linter. Guards are the only automatic filter (AC-07); a
  plugin arbiter may do more.
- Merging parts of several attempts, or applying more than one. One candidate is applied whole, or none.
- Attempts across steps, or one attempt spanning several steps.
- Remote or queued execution.
- Committing, branching, pushing, or touching `main`. The chosen diff enters the step's workspace like any result.
- A screen that lays attempts side by side. Front ends use the ballot and the artifacts.
- Remembering the choice (C-08).
- Examiners that run tools against the candidates, such as building one. They read diffs. A step whose attempts must
  be run to be judged is a different spec.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the workflow asks for more than `maxVariants` | validation fails before the run, naming the step and the limit |
| one variant's runner fails, the others succeed | that variant is `failed`; the step goes on with the candidates |
| every variant fails or is filtered out | step `FAILED`, one line per variant; `on_failure` applies; no examination |
| exactly one candidate | still examined (the examiners name it or `none`) |
| a variant fails its guard or misses an output | `failed`, not a candidate, its diff kept |
| a variant exceeds its share of the budget | `failed` with that reason |
| examiners reach a choice of a candidate | its diff is applied; step completes |
| examiners reach a choice of `none` | step `ESCALATED`, reasons in the reason |
| examination `stalled` or out of rounds, arbiter accepts | the leader (or the named candidate) is applied |
| examination `stalled` or out of rounds, arbiter rejects, is unavailable, or none is set | step `ESCALATED`; nothing applied; diffs kept |
| examiners tie and the arbiter accepts without naming a candidate | step `ESCALATED` saying they tied |
| the arbiter names an id that is not a candidate | step `FAILED` naming the id; nothing applied |
| an examiner's runner fails | as for a debate step: the step fails with the runner's error |
| an examiner replies with no valid `CHOICE` line | that message has no choice; the debate continues; repeated, it stalls |
| an examiner changed the workspace | step `FAILED` (AC-13); nothing applied |
| the chosen diff does not apply to the workspace | step `FAILED` naming the variant; nothing is half-applied |
| creating the Nth worktree fails | variants started are aborted and removed; step `FAILED` with the path and error |
| a variant's worktree cannot be seeded | that attempt `FAILED` before any agent runs; no variant starts from another base |
| writing a diff artifact fails | step `FAILED` with the path and error; nothing is applied |
| the run is cancelled | every variant and the examination aborted, worktrees removed, step cancelled |
| the process dies midway | worktrees remain under `.indaba/worktrees/`; `git worktree prune` clears them; no name is reused |

## 6. Security and data handling

**Isolation is of files and diffs, not a boundary.** Variants are separate worktrees under `.indaba/worktrees/`, named
from the task id, the step id and the index, all passing the existing `GitWorktreeManager` name check. The agents are
processes on the same machine under the same user: a variant told to be hostile could read a sibling's directory by
guessing its path. The documentation says so and does not call it a sandbox.

**The diffs and the examiners' replies are untrusted model output.** A diff is never interpolated into a command, path
or span. It reaches `git apply` only on standard input after `--check`, which refuses paths outside the tree. The
choice is parsed from the first line of a reply by an anchored comparison with the known candidate ids and `none`; it
is never evaluated, used as a path, or looked up as anything but one of those strings. The examiners' reasons are
cleaned (control characters and ANSI escapes stripped) before a person sees them. A candidate's *content* can contain
instructions aimed at the examiners (a prompt injection in a code comment). That is why examiners cannot change the
workspace without failing the step (AC-13), are not told which model wrote what, and why a person remains the
last arbiter; it does not make the examination immune, and the documentation says so.

**Secrets.** Diff artifacts, `selection.md`, the transcript and any note are redacted as other artifacts are. The
examiners' environment is what their roles give them. Nothing the workflow author writes about an attempt reaches a path, a command or a prompt except the step's own goal.

**Bounds.** At most `maxVariants` variants (default 3), 2 running at once by default, and the debate's existing round limit (C-10). Diff files are
kept whole; examiners are given paths, not pasted diffs, so a large diff does not enlarge every prompt.

## 7. Where it lives

- `@indaba/core` (pure): the `variants`, `variants_concurrency` and `examine_with` fields on `StepDefinition`; the
  `QuorumRule` seam on `ConsensusArbiter`, the ballot quorum and the tally; an optional `choice` on `AgentMessage`; an
  optional `choice` on `ConsensusResult` and on `Ruling`; an optional `ballot` on `RulingRequest`; the new events. No
  `node:` module, no I/O.
- `@indaba/engine`: the `maxVariants` option (default 3) and its use by the parser; parsing and validating the fields; `Workspace.snapshot` and `diff(since)`; seeding a variant
  worktree; the variants path in `StepExecutor` (concurrency, per-variant outputs and guards, the examination through
  `runConsensus`, application, teardown); the artifacts; the span attributes and events.
- `indaba` (CLI): the human arbiter shows the ballot and accepts a candidate id; `plan` output.

## 8. Clarifications

All of these are **recommended; the maintainer confirms**.

**The shape, and what was rejected.** Indaba's distinctive strength is agents examining each other's work through a
deterministic debate with a recorded outcome and an arbiter. The recommended shape therefore keeps one new idea (an
isolated attempt, repeated) and reuses everything else: the debate rounds, stall detection and quorum choice; the
arbiter chain, including a person; `PatchService`; the worktree manager; the artifacts. Alternatives considered:

- *A separate "selector" contract with a built-in "human" that shows the attempts and reads a number.* Rejected: it
  is comparison by eye with a second plugin contract beside `Adjudicator`, and it would leave the cross-examination
  that is Indaba's reason to exist out of the loop. A person still decides when the examiners cannot, through the
  arbiter they already use.
- *Stretching `Verdict` to carry an index.* Rejected: every existing arbiter implements `accept`/`reject`; changing
  that is a breaking change for a smaller gain than one optional field on `Ruling`.
- *N-1 pairwise debates (a tournament).* Rejected: cost grows with the count and with every round, and the result
  depends on the bracket order, which is an arbitrary input to a deterministic engine.
- *Scoring each attempt independently with voters.* Rejected as the primary mechanism: scores measure how far a debate
  converged (`specs/voter-arbiter`), not which attempt is better, and independent scoring is not cross-examination.
  A voters arbiter can still be the step's `arbiter` for a split ballot, once it understands ballot messages (C-07).
- *Sibling steps in the DAG plus a debate step.* Not possible today: steps run in sequence in one shared worktree, so
  the second sibling sees the first's edits and is not independent; and the debate has no way to carry a choice to the
  engine. Both gaps are what this spec fills, with the smallest change that does.
- *`on_failure` retries with a debate between.* Exists; kept. It is sequential and anchored on the last failure by
  design, so it explores near one attempt, which is the opposite of what variants are for.
- *A smaller shape: exactly two attempts, a champion and a challenger.* Considered. The ballot already degenerates
  correctly for two, and a maximum that is a setting costs one comparison in the validator. Kept: any N of at least 2,
  bounded by `maxVariants`.

**Decisions.**

- **C-01. `variants` is one integer, and the maximum is a setting.** `variants: 3` runs the step three times with its
  own runner chain, model and agent. Any integer of at least 2 is valid in the file; the file format bakes in no
  upper bound. The upper bound is the engine option `maxVariants` (default 3, an unmeasured design choice; the CLI
  passes the default, and an embedder may pass another). The parser receives it as it receives the runner lookup. A
  workflow that asks for more fails validation with a message naming the step and the limit (for example `step
  "implement": variants 5 exceeds the maximum of 3`). Concurrency is its own setting, the step field
  `variants_concurrency` (default 2, never above the count). `examine_with` is a step field. Rejected: a fixed range
  such as 2 to 4 in the field itself (it makes an installation's resource limit part of the file format, so changing
  the limit changes the format); a list of named attempts, each with its own runner, model or label (it makes the
  field a second way to say what `role` and `runner` already say, multiplies the validation surface, and invites
  attempts that differ in more than chance, which makes the examination a comparison of configurations rather than
  of attempts); and roles as attempts (the attempts would be the roles of the workflow, so a step's attempts could
  not be declared apart from the roles that debate them, and the same role could not attempt twice). A consequence
  that is accepted: attempts differ by the model's sampling only; "the same task on two models" is not expressed by
  `variants`.
- **C-02. There are no labels.** An attempt is `variant-<n>`, numbered in declaration order from 1.
- **C-03. Where a variant starts.** The step's workspace may hold changes earlier steps made and not committed;
  `GitWorktreeManager` creates from `HEAD`. A variant must start from those, and its diff must be measured from them,
  or the chosen diff would repeat work already there and fail to apply. So the engine takes a *snapshot* of the
  step's workspace (`git add -A`, then `git write-tree`: a tree id, no commit, no author identity), applies the
  workspace's diff to the new worktree, snapshots that, and measures the variant's diff since that snapshot.
  Committing a seed inside the variant worktree was rejected (needs an identity, leaves commits).
- **C-04. The ballot is a quorum rule, not a second debate engine.** `ConsensusArbiter` today decides by counting
  `AGREEMENT` messages. It gains an optional `QuorumRule`; the default is the existing rule, so no debate changes. The
  ballot rule reads the optional `choice` an examiner's message carries (parsed from the first line by the engine) and
  is met when the latest choices match as `consensus` or `majority` says. Stall detection already compares message
  fingerprints, so examiners repeating themselves stall the examination unchanged. A reply with a `choice` is typed
  `PROPOSAL` (it is not an approval of anything) so code that counts `AGREEMENT` is not fooled.
- **C-05. Examiners are not told who wrote what.** Producers and examiners may be the same roles, and a model tends to
  prefer its own output. Candidates are presented as `variant-<n>` by declaration order and nothing else: every attempt
  runs with the step's own configuration, so there is nothing about how it was produced to hide, and the index
  carries no information. The step's own role is not an examiner unless listed, so the default is that no attempt is
  judged by its author's role. Shuffling the presentation was rejected: it needs randomness, which decision logic may
  not read.
- **C-06. The tie rule uses no randomness and does not guess.** The leader is the choice named by strictly the most
  examiners; a tie has no leader. A tie goes to the arbiter with no leader, and the arbiter must name a candidate, or
  the step escalates. A tie is never broken by order or by chance.
- **C-07. The arbiter may name a candidate.** `Ruling` gains an optional `choice` and `RulingRequest` an optional
  `ballot`. An arbiter written against `specs/debate-arbiter` ignores both and answers accept or reject, which means
  "apply the leader". The terminal arbiter, shown a ballot, accepts `accept`, a candidate id, or `reject`. The voters
  arbiter (`specs/voter-arbiter`, not yet implemented) counts agreement from `AGREEMENT` messages, so it needs to learn
  that matching choices are agreement before it is useful here; until then it abstains on a ballot and the next
  arbiter in a chain is asked. That change belongs to that spec.
- **C-08. Not recorded, not reused.** The ledger skips a *debate* when the same question was ruled on for the same
  files. An examination's question contains the candidates, which differ on every run, so the key would never match,
  and a recorded "accept" without a candidate could not be re-applied. A variants step neither reads nor writes the
  ledger. A later spec could record choices for audit in a separate file.
- **C-09. Where the person is.** A person decides a split or failed examination as the arbiter, in the terminal now
  and through `specs/ruling-channel` later: that spec's request file gains the ballot and its answer may name a
  candidate. This spec does not change that one; it records the intent so the two fit.
- **C-10. Examination bounds are the debate's.** The round limit, `decision_type` and ping-pong detector apply as they
  do to any debate. Examination spend is not separately capped here (see AC-19).
- **C-11. One attempt is still examined.** Uniformity beats a special case: the examiners can name it or `none`. An
  author who does not want an examination for one survivor does not use variants.
- **C-12. Retries re-run everything.** A retry that re-ran only the failed variants would make the number of
  candidates depend on history.
- **C-13. Limits are design choices, not measurements.** The engine's maximum number of variants and the default
  concurrency of 2 bound disk (each worktree is a full checkout), processes and provider rate limits. The default
  maximum is 3, chosen low so a workflow cannot start many agents by accident. None of these numbers has been measured
  on any workload, and the documentation says so. An embedder or the CLI may set a different maximum
  (`maxVariants`, C-01). Raising the default is a minor change; lowering it is a major, because a workflow that
  validated before would fail.
- **C-14. Guards run before examination.** An examiner is never shown a candidate the workflow would have rejected.
  The chosen diff is not re-checked: it was checked on an identical base (C-03).

## Artifacts not written

- `research.md`: the options were weighed in conversation and in C-04 to C-09; nothing here depends on a fact that
  must be checked outside the repository.
- `data-model.md`: the shapes are in `api-surface.md`; the only state is per-variant (`passed`, `failed`,
  `cancelled`) and has no transitions worth a diagram.
