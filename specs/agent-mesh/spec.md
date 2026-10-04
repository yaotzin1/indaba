# Specification: Agent mesh

> **Superseded implementation language.** This spec was written for the PHP prototype, which was never
> published. Behaviour is unchanged by the TypeScript port; class, method and field names follow
> [`specs/typescript-port/api-surface.md`](../typescript-port/api-surface.md) (for example
> `RunnerInterface` is `Runner`, `*Exception` is `*Error`, fields are camelCase). Where this text names a
> PHP, Composer, Symfony or Docker detail, read the Node and TypeScript equivalent.

> **Status**: Implemented in the initial commit; specified retroactively from `docs/vision.md`
> section 3B. Treat as a description to be corrected by review.
> **Stage entry**: 1 (retroactive)
> **Semver impact**: minor (first public surface; below 1.0)

---

## 1. The problem

One model reviewing its own work, or two agents answering independently, gives no cross-examination.
A workflow author wants heterogeneous agents (for example an architect and a reviewer) to propose,
critique and agree, with a rule that says when consensus is reached and a stop when they go in
circles, all reproducible from a recorded transcript.

## 2. User stories

- **US-01.** As a workflow author, I write `consensus_with: ["architect"]` and
  `decision_type: "consensus"` on a review step and the step completes only when the declared
  participants agree.
- **US-02.** As a workflow author, a debate that stops converging ends in an escalation instead of
  running forever.
- **US-03.** As a developer embedding Indaba, I can read the whole debate from the blackboard and
  replay the arbiter's verdict from it.

## 3. Acceptance criteria

- [ ] `AgentMessage` is immutable and carries a `MessageType` of `PROPOSAL`, `CRITIQUE`,
      `AGREEMENT`, `QUESTION` or `TOOL_INTENT`.
- [ ] `Blackboard` is an append-only log with read views; it performs no I/O.
- [ ] `ConsensusArbiter` returns a result with an outcome (reached, pending, deadlocked) and the
      reason, for a given blackboard and quorum rule.
- [ ] `PingPongDetector` flags two participants trading repeating messages beyond a bound.
- [ ] Every loop (rounds, messages, repeats) is bounded.
- [ ] A `TOOL_INTENT` message only declares intent; the mesh never executes it.

## 4. Non-goals

- Free-form chat between agents without a quorum rule.
- Persisting debates between runs.
- Executing tools from within the mesh; execution belongs to the engine and runners.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| a participant's runner fails | the debate step fails with the runner's error; no silent skip |
| no convergence within the bound | the outcome is deadlocked and the step escalates |
| an agreement refers to a superseded proposal | it does not count towards quorum |

## 6. Security and data handling

Message content is model output and therefore untrusted. It is never interpolated into a command
line or a path, and it is not copied into trace attributes.

## 7. Where it lives

`src/Mesh/`, pure domain. It depends on the `RunnerInterface` contract (through `RunnerParticipant`)
and on the workflow model's `DecisionType`, and on nothing else.

## 8. Clarifications

None recorded. Quorum kinds beyond "all named roles agree" are to be confirmed against the code.

## Artifacts not written

- `plan.md`: retroactive spec; the layout is in `.agents/rules/architecture.md`.
- `research.md`: no options were recorded at the time.
- `data-model.md`: the shapes are in api-surface.md; there is no state machine beyond the verdict.
- `events.md`: the mesh dispatches no event; telemetry for debates is recorded by the engine's spans.
- `tasks.md`: the work is done.
