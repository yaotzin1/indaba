# Tasks: Workflow assistant

Nothing here is implemented. The order puts what is pure first and the page last.

## `@indaba/core`

- [ ] T-01. `ProposedEdit`, `AssistantQuestion`, `AssistantReply`, `parseAssistantReply` (AC-10, AC-11). Tests: every kind parses; text with extra keys, an unknown `op`, a path that is not an array, markup or a code fence
  around JSON, and an empty output are errors; it never throws. The session turns an error into a `refusal` turn (T-05).
- [ ] T-02. `classifyEdit` (AC-13). Tests: each `ImpactReason` is detected from the edit and the draft before it; the class cannot be changed by the `reason` text; `set` of `permissions.level: full`, `addStep` with a `shell`
  command, a `runner` change and removing a guard are all high-impact; **nesting does not hide it** (a whole-step `set` or an `addStep` carrying `permissions`, `runner`, `mcp` or `shell`); an edit that is
  safe on the original draft but unsafe after an earlier edit is classified on the state before it; a goal text is not high-impact. `gate_approves` is added with `review-gate`.
- [ ] T-03. The constants (C-06).

## `@indaba/engine`

- [ ] T-04. `buildContextPack` (AC-08) from the shipped files; test that it contains the format, the schema, the catalog and the two named examples, stays within `MAX_PACK_CHARS` by dropping the examples then the schema and saying so (`omitted`), and contains no path of the machine
  and no environment value. Decide which docs ship in the packages (C-04, `security-guard` skill).
- [ ] T-05. `AssistantSession` over a runner resolved from the registry at `read` (AC-10, AC-16, AC-21), with a tracer and a logger: the prompt marks added documents as data (a test checks the marker); one repair inside the turn,
  with usage summed (AC-12); a parse error or a failed repair never throws; the question counter resets at `send` (AC-06); `setContext` records the new confirmation (AC-14); `cancel` leaves the session; the repair attempt (AC-12) carries only the failure; timeouts and cancellation leave the draft
  untouched; usage is `unknown` when the runner reports none (AC-15). Tests with a fake runner; no test depends on a real agent.
- [ ] T-06. Proposal validation on a clone (AC-12) and `selectAccepted` (AC-05, AC-13): a high-impact index must be in `acceptedHighImpact` and `acceptedHighImpact` must be a subset of `indexes`; an index out of range is
  refused; a chosen subset is validated (an edit of a step whose `addStep` was not chosen is refused with the problems); a proposal that does not validate cannot be accepted; nothing is mutated (it returns edits).
- [ ] T-07. The question path (AC-06): `checkQuestion` on each question, one repair, the limit of 5, no answer changes nothing.

## `indaba`, server

- [ ] T-08. `parseAssistantProfiles` in the engine and the lookup in the user configuration folder in the CLI (AC-03): unknown key, unknown kind and a secret-looking key are problems; a project `indaba.config` with an
  `assistant` section stays rejected by `parseProjectConfig` (test).
- [ ] T-09. The resources of AC-19 under `/api/v1/assistant`, shapes in the core web contract; confined to served roots; the server holds no draft (a test: the draft text comes with the message, accept returns edits); the
  confirmation of AC-14 required to start and to change the context; cancel versus delete; the span attributes (AC-18) with the sentinel test of AC-17.

## `@indaba/web`

- [ ] T-10. The panel: off state and how to enable it (AC-01), the confirmation of AC-14, the message box, the added documents list (AC-09), the pack viewer.
- [ ] T-11. The proposal view: the diff, the plain-word list, accept / accept some / discard, the separate one-by-one acceptance of high-impact edits with accept-all excluding them (AC-05, AC-13); the
  `full` sentence of `agent-permissions` AC-04.
- [ ] T-12. Questions with options and recommendation (AC-06); explanations (AC-07); cost and "unknown" (AC-15); the words in the message catalogue.
- [ ] T-13. A keyboard path for every action of the panel (`web-app` AC-20).

## Documentation

- [ ] T-14. `docs/` page; `CHANGELOG.md`; `specs/DEPENDENCY_MAP.md`; the amendments listed in `api-surface.md` are sent to the owners of the web-app specs. Fill `review.md`.

## Order and dependencies

T-01 to T-04 depend on nothing unimplemented. The question path (T-07) needs the check of `question-contract`; until it exists, a minimal copy of `checkQuestion` is carried and replaced. `gate_approves` (T-02) and the
plugin-runner profiles (AC-21) wait for `review-gate` and `agent-permissions`.
