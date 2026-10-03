# Data model: Workflow engine

## Types

Value objects, all `final readonly`: `WorkflowDefinition` (name, version, artifacts, roles, steps),
`RoleDefinition` (runner name, optional model), `StepDefinition` (id, role or runner, goal,
`depends_on`, `input_artifacts`, `outputs`, guards, `commands`, isolation, `on_failure`,
`consensus_with`, `decision_type`), `GuardDefinition` (type and parameters), `OnFailure` (action,
target, `max_retries`). Enums: `GuardType`, `FailureAction`, `Isolation`, `DecisionType`,
`StepStatus`, `WorkflowStatus`.

## State and transitions

Intended table (to be checked against `StepState` in review; write what the code does, not what this
says):

| From | To | Caused by |
| :--- | :--- | :--- |
| `PENDING` | `RUNNING` | the engine starts the step |
| `RUNNING` | `VALIDATING` | the runner finished and guards or consensus must be checked |
| `RUNNING` | `FAILED` | the runner failed or could not run |
| `VALIDATING` | `COMPLETED` | all guards pass |
| `VALIDATING` | `FAILED` | a guard fails |
| `FAILED` | `PENDING` | `on_failure` retry, within `max_retries` |
| `FAILED` | `ESCALATED` | retries exhausted or no retry declared |

`COMPLETED` and `ESCALATED` are terminal.

## Workflow schema delta

This is the first version of the runtime schema: the contract in `docs/vision.md` section 4
(`version`, `name`, `artifacts`, `roles`, `steps` with the fields above). It is not the schema of the
repository's development `workflow.ai.yml`.

## Serialisation

`WorkflowResult` is an in-memory value object. Artifacts are files under `.indaba/artifacts/`.
