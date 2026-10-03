---
name: mesh_consensus
description: Use when changing AgentMessage envelopes, the blackboard, turn-taking, the consensus arbiter, quorum rules or ping-pong detection. Covers immutable messages, deterministic arbitration and bounded debate.
---

# Agent Mesh & Consensus Specialist

The mesh is where heterogeneous agents cross-examine each other. Its value is that the outcome of a
debate is a pure function of the messages, so it can be tested, replayed and audited.

## Messages are immutable envelopes

`Mesh\AgentMessage` is a `final readonly` value object: id, sender role, optional recipient,
`MessageType` (`PROPOSAL`, `CRITIQUE`, `AGREEMENT`, `QUESTION`, `TOOL_INTENT`), content, a reference
to the message it answers, and the timestamp **passed in by the caller** (from the injected clock). A
message is never edited; a correction is a new message.

## The blackboard

`Mesh\Blackboard` is an append-only log with read views (by round, by sender, the latest proposal).
It holds no I/O and no clock. It is the single source the arbiter and the detector read, so a debate
can be reconstructed from it alone.

## Turn-taking and rounds

Who speaks next is decided by rule, not by who answers first: a round order fixed by the workflow's
declaration order. A role that does not answer within its deadline records a timeout message type or
a failed step, per the spec; it does not stall the round.

## Consensus

`Mesh\ConsensusArbiter` evaluates a quorum over the blackboard: for example unanimous `AGREEMENT`
from `architect` and `reviewer` on the same proposal id. Rules to keep:

- agreement refers to a specific proposal id; an agreement to a superseded proposal does not count;
- a `CRITIQUE` after an agreement reopens the question;
- the verdict is `Reached`, `Pending` or `Deadlocked`, with the reason, never a boolean;
- quorum kinds (unanimous, majority, named roles) are data in `GuardDefinition`/`StepDefinition`,
  evaluated by the arbiter without a switch on role names.

## Ping-pong detection

`Mesh\PingPongDetector` recognises a debate that is not converging: the same two roles trading
messages whose content repeats (normalised, then compared by hash) or whose proposal id never
advances, past a bound. Detection ends the debate with an escalation. Bound every loop: a round
limit, a message limit, a repeat limit. An unbounded debate is a cost incident.

## TOOL_INTENT

A `TOOL_INTENT` message declares what an agent wants to do; it does not do it. Execution goes
through the engine and a runner, under the same guards as any step. The mesh never runs a command.

## Testing

Table-driven: a list of message sequences and the expected verdict. Include the deadlock, the
reopened agreement, the stale agreement and the repeated-critique loop.
