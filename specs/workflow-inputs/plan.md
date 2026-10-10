# Plan: Workflow inputs

Nothing here is a decision about behaviour: that is in `spec.md` and `api-surface.md`. This names the files that will
change and the order, so two people who never speak make halves that fit.

## Modules touched

| File | Change |
| :--- | :--- |
| `packages/core/src/workflow/inputs.ts` (new) | the types, `InputProblemCode`, the five pure checks, `normalizeInputPath`, `describeInputs`, `canonicalInputs`; no `node:` import |
| `packages/core/src/workflow/model.ts` | `WorkflowDefinition.inputs?`, `StepDefinition.goalInputs?` |
| `packages/core/src/index.ts` | the new exports |
| `packages/engine/src/parser/inputs.ts` (new) | `readInputDeclarations`: the declaration keys per type, defaults checked with the pure checks, every problem with its path |
| `packages/engine/src/parser/interpolator.ts` | a second reference form, `inputs.<name>`, that renders a value, a label or a placeholder as AC-10 says, and refuses `commands` |
| `packages/engine/src/parser/parser.ts` | `ParseOptions`; read `inputs`; give the interpolator the resolved values; fill `goalInputs`; the "needs a value" and "undeclared" errors |
| `packages/engine/src/inputs/resolve.ts` (new) | `resolveInputs`, `InputFileSystem` and its `node:fs` default; the `realpath` confinement; the digest with `node:crypto` |
| `packages/engine/src/engine/prompt-builder.ts` | `buildInputsSection`, `INPUTS_NOTICE`; append the section when `goalInputs` is not empty |
| `packages/engine/src/engine/workflow-engine.ts` | `WorkflowEngineOptions.inputs`; set the root span attributes; write `inputs_resolved` |
| `packages/engine/src/trace/records.ts`, `event-writer.ts` | the three records |
| `packages/engine/src/inputs/channel.ts` (new, stacked) | `requestInputs`, `listPendingInputRequests`, `answerInputRequest` over the ruling-channel helpers |
| `packages/cli/src/main.ts` | `--input`, `--input-file`; resolve before creating the engine task; plan and validate output; exit 2 with the missing list |
| `packages/cli/src/input-prompt.ts` (new) | `terminalInputAsker` |
| `packages/cli/src/run-child.ts` | pass `--input` options to the child for `run --tui` |
| `packages/tui/src/inputs-form.ts` (new) | `collectInputs`, the form before the child starts |
| `docs/workflow-format.md` | an Inputs section, the new interpolation form, the messages; `docs/getting-started.md` a short example |
| `examples/review-specs.workflow.ai.yml` (new) | the workflow of spec.md section 9 |
| `CHANGELOG.md`, `README.md`, `AGENTS.md`, `specs/DEPENDENCY_MAP.md` | per the documentation rule; the changelog lists the `${{ inputs.` change under "Changed" |

## Order

1. Core: types and pure checks, with the hostile cases (control characters, bidirectional controls, drive letters, UNC
   and device paths, `..`, giant numbers). The architecture test stays green.
2. Engine, parse side: `readInputDeclarations`, the interpolator, `ParseOptions`, `goalInputs`, the `commands` refusal.
3. Engine, resolve side: `resolveInputs` against a fake `InputFileSystem`, then against a temporary directory with a
   link that points out (skipped with a stated reason where the platform cannot create one).
4. Prompt builder and engine: the Inputs section, the span attributes, the record.
5. CLI: options, plan and validate, the terminal prompt, the missing-input exit; `run --tui` hand-over.
6. TUI form. The channel records are stacked on `specs/ruling-channel` and wait for it.
7. Documentation and the example; `pnpm qa`, `pnpm e2e` (a run that is given an input and one that is refused), the node
   gates.

## Risks

- **Interpolation at parse time.** The parser interpolates while it reads each field, so values must exist before the
  step fields are read. That is why `ParseOptions` carries them in, and why `readInputDeclarations` is a separate, cheaper
  first pass. The alternative, interpolating later, would change the parser's structure for every field.
- **Windows paths.** Case-insensitive comparison, drive letters, `\\?\` prefixes and junctions each need a test that runs
  on the Windows CI job; a test that cannot create a junction says so and does not pass silently.
- **The one changed behaviour** (a literal `${{ inputs.`): a test pins the error message and the changelog entry.
- **`run --tui`.** The dashboard must collect before it spawns; a test with a fake spawner checks the child receives
  `--input` and never reads stdin.
