# API surface contract: Workflow engine

> Written retroactively for the initial commit. The names are the intended public classes; exact
> signatures are to be confirmed against `src/` during review and corrected here, not the other way
> round.

## Semver classification

**minor**: the first public surface of an unreleased project (below 1.0).

## Public symbols added

| Name (FQCN) | Kind | Notes |
| :--- | :--- | :--- |
| `Indaba\Workflow\Model\WorkflowDefinition` | final readonly class | the parsed file |
| `Indaba\Workflow\Model\StepDefinition` | final readonly class | one step |
| `Indaba\Workflow\Model\RoleDefinition` | final readonly class | role to runner and model |
| `Indaba\Workflow\Model\GuardDefinition` | final readonly class | guard type and parameters |
| `Indaba\Workflow\Model\OnFailure` | final readonly class | action, target, `max_retries` |
| `Indaba\Workflow\Model\{GuardType, FailureAction, Isolation, DecisionType}` | enums | closed vocabularies of the schema |
| `Indaba\Workflow\Parser\WorkflowParser` | final class | YAML text or file to `WorkflowDefinition`; throws `WorkflowValidationException` |
| `Indaba\Workflow\Graph\DagBuilder` | final class | topological order, cycle detection |
| `Indaba\Workflow\State\StepStatus` | enum | `PENDING`, `RUNNING`, `VALIDATING`, `FAILED`, `ESCALATED`, `COMPLETED` |
| `Indaba\Workflow\State\StepState` | final class | one step's state and legal transitions |
| `Indaba\Workflow\State\StepStatusChanged` | event class | dispatched on every transition |
| `Indaba\Workflow\Guard\GuardInterface` | interface | the guard extension point |
| `Indaba\Workflow\Guard\{GuardRegistry, GuardResult, GitDiffEmptyGuard}` | classes | registry, verdict, the built-in guard |
| `Indaba\Workflow\Engine\WorkflowEngine` | final readonly class | `run(...)` returns `WorkflowResult` |
| `Indaba\Workflow\Engine\{WorkflowResult, WorkflowStatus}` | value object, enum | the outcome |
| `Indaba\Core\Exception\{IndabaException, WorkflowValidationException, InvalidTransitionException}` | exceptions | |

`@internal` (outside the contract): `Parser\{ErrorBag, Interpolator, Node, WorkflowValidator}` and
`Engine\{PromptBuilder, StepExecutor, StepOutcome}`.

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| workflow file | `version`, `name`, `artifacts`, `roles`, `steps` | added (docs/vision.md section 4) |
| workflow file | step fields `id, role, runner, goal, depends_on, input_artifacts, outputs, guards, commands, isolation, on_failure, consensus_with, decision_type` | added |
| guard types | `git_diff_empty` | added |
| failure actions | `retry_step` | added |
| event | `StepStatusChanged` | added |
| span attributes | `indaba.task.id`, `indaba.workflow.name` and per-step attributes | added; recorded in the observability spec |

## Defaults introduced

To be filled from the code in review (default `max_retries`, default timeout, isolation default).
Each is inherited by consumers and is a major to change.

## Checks

- [ ] Every type in a public signature is public or deliberately `@internal`
- [ ] Implementations are `final`; the extension point is `GuardInterface`
- [ ] Arrays are typed precisely
- [ ] `composer stan` passes without an ignore
