---
name: mesh_consensus
description: Use when changing AgentMessage envelopes, the blackboard, turn-taking, the consensus arbiter, quorum rules or ping-pong detection. Covers immutable messages, deterministic arbitration and bounded debate.
---

# Agent Mesh & Consensus Specialist

The mesh is where heterogeneous agents cross-examine each other. Its value is that the outcome of a
debate is a pure function of the messages, so it can be tested, replayed and audited. It lives in
`packages/core/src/mesh` and so imports no `node:` module.

## Messages are immutable envelopes

`AgentMessage` has `readonly` fields: sender role, `MessageType` (`PROPOSAL`, `CRITIQUE`,
`AGREEMENT`, `QUESTION`, `TOOL_INTENT`), content, and the round it was posted in. A message is never
edited; a correction is a new message. `AgentMessage.fromReply(sender, reply, round)` parses a
model's reply: a leading type keyword sets the type, and anything else is a `PROPOSAL`, which can
never count as approval. Core has no clock in the message; anything time-related is passed in.

## The blackboard

`Blackboard` is an append-only log (`post`, `messages`, `latestBy`, `transcript`) plus named facts.
It holds no I/O and no clock. It is the single source the arbiter and the detector read, so a debate
can be reconstructed from it alone.

## Turn-taking and rounds

Who speaks next is decided by rule, not by who answers first: participants speak in the order given
(the workflow's declaration order), once per round. A `Participant` is `{ role, respond(topic,
board, round): Promise<AgentMessage> }`; `RunnerParticipant` adapts a `Runner` to it. A participant
that fails throws, which fails the step; it does not stall the round.

## Consensus

`ConsensusArbiter` (`new ConsensusArbiter({ maxRounds?, pingPong? })`, default 4 rounds) runs
`deliberate(topic, participants, decision)` and evaluates the quorum once per full round over each
participant's latest message. Rules to keep:

- only a participant's **latest** message counts: an `AGREEMENT` followed by a `CRITIQUE` is no
  longer agreement, so a reopened question is automatic;
- the quorum comes from `DecisionType`: consensus needs every participant, majority needs strictly
  more than half;
- the outcome is `reached`, `stalled` or `max_rounds_exceeded`, never a boolean, and
  `ConsensusResult.openObjections()` says what is unresolved;
- the quorum kind is data in the step definition, evaluated without a switch on role names.

## Ping-pong detection

`PingPongDetector.isStalled(messages, participants)` recognises a debate that is not converging:
with N participants, the last N messages repeat the N before them (compared by
`AgentMessage.fingerprint()`, whitespace- and case-normalised). Detection ends the debate with
`stalled`. Core has no crypto, so the fingerprint is the normalised text, compared for equality
only. Bound every loop: a round limit, a repeat check. An unbounded debate is a cost incident.

## TOOL_INTENT

A `TOOL_INTENT` message declares what an agent wants to do; it does not do it. Execution goes
through the engine and a runner, under the same guards as any step. The mesh never runs a command.

## Testing

Table-driven Vitest cases in `packages/core/test/mesh.test.ts`: a list of scripted participants and
the expected outcome. Include the stalled debate, the reopened agreement, the majority that is one
short, and the round budget spent. Participants are plain objects, so no runner is needed.
