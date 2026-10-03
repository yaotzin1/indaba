# API surface contract: Agent mesh

> Written retroactively. Names are the intended public classes; signatures are to be confirmed
> against `src/Mesh/` in review.

## Semver classification

**minor**: first public surface (below 1.0).

## Public symbols added

| Name (FQCN) | Kind | Notes |
| :--- | :--- | :--- |
| `Indaba\Mesh\AgentMessage` | final readonly class | immutable envelope |
| `Indaba\Mesh\MessageType` | enum | `PROPOSAL`, `CRITIQUE`, `AGREEMENT`, `QUESTION`, `TOOL_INTENT` |
| `Indaba\Mesh\Blackboard` | final class | append-only log with read views |
| `Indaba\Mesh\ConsensusArbiter` | final class | evaluates quorum over a blackboard |
| `Indaba\Mesh\ConsensusResult`, `ConsensusOutcome` | value object, enum | the verdict and its reason |
| `Indaba\Mesh\PingPongDetector` | final class | non-convergence detection |
| `Indaba\Mesh\ParticipantInterface` | interface | something that can take a turn in a debate (extension point) |
| `Indaba\Mesh\RunnerParticipant` | final class | a participant backed by a `RunnerInterface` |

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| workflow file | step fields `consensus_with`, `decision_type` | added (defined with the workflow-engine spec) |

## Defaults introduced

To be filled from the code in review: round limit, repeat limit for the ping-pong detector, default
quorum when `consensus_with` is given. Each is a major to change.

## Checks

- [ ] Every type in a public signature is public or deliberately `@internal`
- [ ] Implementations are `final`; the extension point is `ParticipantInterface`
- [ ] The mesh imports no Symfony class (`tests/Unit/Architecture/BoundaryTest.php`)
- [ ] `composer stan` passes without an ignore
