# Tasks: step stalls, release 1 (`timeout_seconds`)

Ordered by dependency. Each task independently checkable. Tests are written first for each task (stage 6).

## Domain

- [ ] **T-01** `MAX_TIMEOUT_SECONDS` and `StepDefinition.timeoutSeconds?` in `core/workflow/model.ts`; exported from the index. Test: `defineStep` keeps the field, omits it when absent.
- [ ] **T-02** `RunnerParticipantOptions.timeoutSeconds?`; `respond` puts it in the request only when set. Test: with and without it, on the `RunRequest` a fake runner receives (AC-14, AC-20).

## Infrastructure

- [ ] **T-03** Parser: `timeout_seconds` whole number 1 to 86400 on any step kind; the contract's message for 0, 86401, 1.5, "10", a list, null. Test in `parser-errors.test.ts` and `parser.test.ts` (AC-01, AC-14).
- [ ] **T-04** Executor: effective limit `step.timeoutSeconds ?? global`; shell commands, agent call and debate participants all receive it. Tests with a fake runner that records `timeoutSeconds` (AC-01, AC-02, AC-14).
- [ ] **T-05** A step that times out ends as today with `Timed out after N seconds.` where N is the step's number, and `on_failure` applies (AC-03). Test with a fake runner returning exit 124.
- [ ] **T-06** `indaba.step.timeout_seconds` on the step span only when set. Test on the exporter output; a step without the field has no such attribute (AC-20).
- [ ] **T-07** Compatibility pin: a workflow without the field produces the same requests, events and attributes as before (AC-20).

## Console

- [ ] **T-08** `schema` lists `timeout_seconds` (`editor/schema.ts`); `plan` prints `timeout Ns`. Tests in the existing schema and CLI plan tests.

## Tests

- [ ] **T-09** Hostile inputs for the number (strings, negative, huge, NaN, YAML anchors producing non-integers): rejected before anything runs, message without file contents.
- [ ] **T-10** `core/test/architecture.test.ts` and the `layers.test.ts` files still green.

## Documentation

- [ ] **T-11** `docs/workflow-format.md` (field table, precedence, "per call", debates, not the same as `permissions.timeout_seconds`), `docs/playbook.md` and `docs/ai-playbook.md`, `docs/README.md` if a page is added, `llms.txt`, the Pages build (`node scripts/build-site.mjs --check`).
- [ ] **T-12** `CHANGELOG.md` under Unreleased; `specs/DEPENDENCY_MAP.md` (no new dependency: say so if it lists packages).
- [ ] **T-13** Cookbook note: where `examples/crud-inventory.workflow.ai.yml` could set a longer limit on `implement`. Optional; do not change the example's behaviour in this release.
- [ ] **T-14** `review.md` answered against `.agents/rules/review.md`; the seven answers with real `pnpm qa` and `check-workflow` output.

## Gates

- [ ] **T-15** `pnpm qa`, `node scripts/check-workflow.mjs`, the other node gates, `node scripts/check-track.mjs`. Report the actual output.
