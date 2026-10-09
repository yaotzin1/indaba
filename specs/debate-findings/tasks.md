# Tasks: Debate findings and prompts

Each task is checkable on its own; tests come with the code. Run `pnpm qa` after each group.

## `@indaba/core`

- [ ] T1. `Finding`, `AgentMessage.findings()` with the pattern in the plan. Tests: valid 1 to 5, case, bullet prefix, `[0]`, `[6]`, `[x]`, no number, text cut at 500, 50-finding cap, 20,000 characters of near-matches, a reply with no findings.
- [ ] T2. `PromptRegistry` (register, replace, get, names) and `DEBATE_REVIEW_PROMPT`. Tests: duplicate without `replace` throws, with it replaces; the text contains the format line and the scale.
- [ ] T3. `RunnerParticipant` option `instructions`. Tests: absent: the prompt equals a snapshot of the previous release's prompt; present: the section sits between the topic and the discussion; the reply-protocol is intact.
- [ ] T4. `IMPORTANCE_VOTER` and the shared file-token helper; appended to `BUILT_IN_VOTERS`. Tests: worst 5, 3, 1; only the latest non-agreement messages count; abstain with no findings; malformed lines in the reason; the file helper still serves `overlap` unchanged.
- [ ] T5. `StepDefinition.prompt` and `.promptAdditions`, `WorkflowDefinition.defaultPromptAdditions`, `PluginHost.registerPrompt`. `architecture.test.ts` still passes.

## `@indaba/engine`

- [ ] T6. Parse and validate `prompt`, `prompt_additions`, `defaults.prompt_additions` (booleans written `on`/`off`/`true`/`false`; anything else is an error naming the field). The warning for an arbiter with additions off.
- [ ] T7. `runConsensus`: the on/off rule (AC-02), prompt resolution and its failure (AC-04), `instructions` passed to every participant, attributes (AC-06, AC-10).
- [ ] T8. The findings file (AC-08): ordering, agreed files, cleaning, redaction, written on every outcome; failure to write fails the step.
- [ ] T9. The ledger key includes the prompt name and text (AC-09). Tests: same prompt hits; changed text misses; additions off misses a ruling made with them on.
- [ ] T10. Negative test: no span attribute contains finding text.

## `indaba` (CLI)

- [ ] T11. `RegistryPluginHost.registerPrompt`; `createEngine` registers `DEBATE_REVIEW_PROMPT`. `validate` and `plan` print the warning.
- [ ] T12. End to end: a fake debater that answers with `FINDING` lines, `[voters, human]` where `importance` decides; a plugin replaces `debate-review` with `{ replace: true }`; additions off prints the warning and the prompt is the old one.

## Documentation and gates

- [ ] T13. `docs/workflow-format.md` (the three fields, the format, the scale, the voter, the findings file, **what turning additions off costs**, that the numbers are agent-reported), `docs/extending.md`, `README.md`, `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md`.
- [ ] T14. `pnpm qa`, `pnpm e2e`, the node gates; coverage at least 85% on all four metrics.
- [ ] T15. Fill `review.md`.
