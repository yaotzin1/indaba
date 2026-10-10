# Tasks: Workflow inputs

Ordered by dependency. Domain first, infrastructure second, console and documentation last. Each task independently
checkable. Tests are written with each task, not after (qa skill).

## Domain (`@indaba/core`)

- [ ] **T-01** `workflow/inputs.ts`: the types, `InputType`, `PathKind`, `InputProblemCode`; no `node:` import
- [ ] **T-02** `checkTextValue`: control characters, NUL, bidirectional controls, unpaired surrogates, line endings,
  `max_length`, `multiline`; hostile-string tests built from fragments (security gate)
- [ ] **T-03** `checkChoiceValue`, `checkNumberValue` (no locale, no exponent, no `NaN`), `checkBooleanValue`
- [ ] **T-04** `normalizeInputPath`: `/` separators, `..`, drive letter without root, UNC and device prefixes, control
  characters, an absolute path with no prefix to compare against is refused; tests for Windows and POSIX spellings on
  every platform (it is pure)
- [ ] **T-05** `describeInputs` and `canonicalInputs`; a test pins the example in `data-model.md` and that declaration
  order does not change the text
- [ ] **T-06** `WorkflowDefinition.inputs?`, `StepDefinition.goalInputs?`; exports; the architecture test is green

## Engine, parse side

- [ ] **T-07** `readInputDeclarations`: keys per type, defaults checked, every problem with its path; an unknown key,
  `secret`, `list` on a number, `extensions` without `kind: file`
- [ ] **T-08** interpolator: `${{ inputs.<name> }}`; value, label or placeholder; undeclared is an error naming the
  field; `commands` refused with the C-02 message; `input_artifacts` and `outputs` take path inputs only and expand a
  list to one entry each
- [ ] **T-09** parser: `ParseOptions`, `goalInputs`, "needs a value" without options, the unused-input warning in the
  validator; a workflow without `inputs` parses identically (a golden test over the existing examples)
- [ ] **T-10** the literal `${{ inputs.x }}` edge case: a test pins the new error message (C-14)

## Engine, resolve side

- [ ] **T-11** `resolveInputs` with a fake `InputFileSystem`: defaults, missing, unknown, duplicates, list bounds, every
  problem reported at once, the digest is stable across two orders of the same options
- [ ] **T-12** confinement against a temporary directory: `realpath` of a link or junction that leaves the directory is
  refused; case-insensitive comparison on Windows; `kind` and `extensions` on the real entry
- [ ] **T-13** `--input-file`: UTF-8, the size limit, a path outside the directory, a missing file
- [ ] **T-14** the digest uses `node:crypto` and nothing else; no new dependency in `package.json` (security-guard
  skill)

## Engine, run side

- [ ] **T-15** `buildInputsSection` and `INPUTS_NOTICE`: the fence is longer than any backtick run in a value; a value
  that looks like an instruction stays inside the fence; the size cap (50000); only `goalInputs` are listed
- [ ] **T-16** `WorkflowEngineOptions.inputs`: root span attributes, `inputs_resolved` (a text value as a length only),
  a retried step's prompt carries the same section and nothing from earlier attempts
- [ ] **T-17** no value is recorded in any trace, event or error message: a test scans the artifacts of a run given a
  text input containing a marker string

## Console (`indaba`)

- [ ] **T-18** `--input` and `--input-file` parsing: first `=` splits, repeatable, at most 200, unknown name lists the
  declared ones, a duplicate non-list is a usage error
- [ ] **T-19** `validate` and `plan` without values: placeholders, the Inputs block, the missing list, the unused warning
- [ ] **T-20** `run`: resolve before any task, worktree, trace or ledger entry exists (a test asserts none was created
  on refusal); exit 2 and the copy-ready lines when nothing can ask
- [ ] **T-21** `terminalInputAsker`: plain-words prompts, choices and defaults shown, a list read until an empty line,
  re-asks on a bad answer, returns `undefined` when closed
- [ ] **T-22** `run --tui`: the dashboard collects first, the child receives `--input`, the child never reads stdin
- [ ] **T-23** the TUI form `collectInputs` (stacked on `specs/tui`)
- [ ] **T-24** the channel records and functions (stacked on `specs/ruling-channel`): atomic files, an invalid answer is
  ignored and counted, a cancelled run removes its request

## Tests

- [ ] **T-25** hostile-input tests across the above, built from fragments: shell metacharacters in a text value never
  reach a command; a path with `..`, a UNC path, a junction out, a drive letter; control and bidirectional characters;
  a giant list; a value with backtick fences
- [ ] **T-26** end to end through the built CLI: the example workflow with two folders, with a missing folder, with an
  outside path, with nothing supplied and no terminal (exit 2)
- [ ] **T-27** unit coverage for new behaviour, success and failure paths (85% floor on all four metrics)
- [ ] **T-28** `pnpm smoke`: the packed install still boots with the new exports

## Documentation

- [ ] **T-29** `docs/workflow-format.md`: the Inputs section, the new interpolation form, the messages, the rule that
  inputs are not allowed in `commands` and why; `docs/getting-started.md` example
- [ ] **T-30** `examples/review-specs.workflow.ai.yml`; it passes `indaba validate` and `indaba plan` from the built CLI,
  and a test keeps it parsing
- [ ] **T-31** README, CHANGELOG under Unreleased ("Added", and "Changed" for the `${{ inputs.` edge case),
  `specs/DEPENDENCY_MAP.md`, AGENTS.md repository map if a path changed

## Stage 7: Verification

- [ ] `pnpm qa` and the node gates (`node scripts/check-workflow.mjs`) green end to end, output recorded in review.md
- [ ] `pnpm e2e` and `pnpm smoke` green
