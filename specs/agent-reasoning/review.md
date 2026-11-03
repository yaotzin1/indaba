# Self-review: Agent reasoning stream

> **Status**: complete for stages 6 to 8. Not yet committed or merged.

## 1. Boundary and layering

`@indaba/core` gained a callback type, one event class, one optional constructor argument and two attribute constants;
it still imports nothing (`architecture.test.ts` passes). The wire parsing of `agent_thought_chunk` and `delta.reasoning`
is in the two runners only. The sink, the character count and the span attribute are in `StepExecutor.invoke`, so a
single step, a retry and each debate turn behave the same, and a plugin runner that calls only `request.onThought` gets
the same events and records as a built-in (`thought-wiring.test.ts` runs one through the composition root). No built-in
has access a plugin lacks.

## 2. Determinism and failure isolation

No clock, randomness or environment read was added; the writer uses its injected clock. A retry's prompt is built from
the last failure only and reasoning is never stored on `RunResult`: `agent-reasoning.test.ts` asserts a first attempt's
reasoning is absent from the second prompt and that the second attempt has its own span and a `seq` that starts at 0.
Every bound is finite (4096 per record, 2 MiB per run shared with output, 500 lines of 2000 characters in the view, 4000
characters per attempt). A throwing caller callback or listener is caught and cannot fail a step.

## 3. Public surface and semver

Minor, as `api-surface.md` says; `CHANGELOG.md` records it. Everything added is optional or additive. **Two corrections
to the stage 3 contract**, found by reading the code at stage 6 and written back into `spec.md`, `plan.md`,
`api-surface.md` and `tasks.md`: (a) `RunSummaryOfUse` is the pre-run confirmation summary, not an aggregation, so the
reasoning-token total lives on `RunState.reasoningTokens` (built by `reduceRun`, so also on the snapshot), and `TraceReader`
is untouched; (b) `RunStreamEvent` is `{ id, run: RunSnapshot }`, so reasoning travels in `StepView.thoughts` and there is
no new stream event. Also: `--thoughts` needed `PlainOptions.thoughts` (the final view) as well as
`EventLineOptions.thoughts` (follow and replay lines), because a finished run never goes through the lines. `StepView`
and `RunState` gained required fields, which breaks anyone who builds those objects by hand (the repository's own
fixtures); readers are unaffected.

## 4. Security

Reasoning is untrusted. It reaches no shell, path, URL, board parser, debate parser, guard or prompt. It is redacted per
chunk in `RunEventWriter` before the length is measured and before it is written, is absent from `<id>.jsonl` (asserted),
and the server's `snapshotOf` cleans `thoughts`, `partialThought` and each attempt's `thought` like every other text
(extended in `runs.ts` and its test). The web view renders it as text nodes (no `innerHTML`; a hostile string is
asserted), and the terminal paths go through `sanitize`. Known limit, documented in `docs/logging.md`: a secret split
across two streamed chunks can escape the per-chunk redactor, as it can for output.

## 5. Observability and honest numbers

`indaba.usage.reasoning_tokens` is set only when the provider reported a valid non-negative integer, and the total is
`null`, never 0, when no span did. `gen_ai.usage.output_tokens` is unchanged and `PricingTable` does not add reasoning
tokens again (tested). `indaba.thought.chars` is the raw count, only when something was received, and records the text
of nothing.

## 6. Dependencies and packaging

No dependency added. Nothing new reaches a tarball.

## 7. Verification

- `pnpm lint` (biome) and `pnpm typecheck`: clean (5 warnings and 1 info in `styles.css`, unchanged).
- Vitest: 152 files, 2779 passed, 2 skipped; coverage 96.77% statements, 92.17% branches, 96.15% functions, 97.02%
  lines (floor 85).
- **`pnpm qa` as a single command does not exit 0 on this machine**: `packages/cli/test/logging-config.test.ts`
  ("writes the last records of a command interrupted twice") fails under full-suite load. It fails the same way on an
  untouched `main` (checked with a stash) and passes alone, so it is a timing flake that this change did not cause. The
  run above excludes only that file.
- `pnpm e2e`: exit 0 (13 files passed, 1 skipped).
- Node gates: validate-skills, sync-claude-skills, sync-agent-docs, check-workflow, security-audit --source,
  build-site --check, and `node --test scripts/*.test.mjs` (94 passed): all clean.
- Not run: `node scripts/check-track.mjs` (needs the commit), `check-workflow.mjs --remote` (CI unchanged), `pnpm smoke`.

## Known gaps

- **No real provider or agent has been run.** The ACP and OpenRouter paths are tested against fakes and fixtures only;
  whether a given model really streams `reasoning` or `agent_thought_chunk` is unproven here.
- **The dashboard shows a count, not a collapsible section.** The detail pane is a fixed grid with no expand state, so a
  step with reasoning gets one row (`reasoning: N line(s); indaba watch --plain --thoughts prints them`). A real
  expandable pane needs UI state and keys: do it when the dashboard grows a second pane.
- `--thoughts` does nothing for the dashboard itself; it affects plain output only, as the spec says.
- A thought chunk the runner emits after the writer's allowance ran out is dropped silently (same as output).
