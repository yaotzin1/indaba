# Tasks: Workflow assistant

Nothing here is implemented. The order puts what is pure first and the page last.

## `@indaba/core`

- [ ] T-01. `ProposedEdit`, `AssistantReply`, `parseAssistantReply` (AC-10, AC-11). Tests: every kind parses; text with extra keys, an unknown `op`, a path that is not an array, markup or a code fence around
  JSON, and an empty output are errors; it never throws.
- [ ] T-02. `classifyEdit` (AC-13). Tests: each `ImpactReason` is detected from the edit and the draft; the class cannot be changed by the `reason` text; `set` of `permissions.level: full`, `add_step` with a
  `shell` command, a `runner` change and removing a guard are all high-impact; a goal text is not.
- [ ] T-03. The constants (C-06).

## `@indaba/engine`

- [ ] T-04. `buildContextPack` (AC-08) from the shipped files; test that it contains the format, the schema, the catalog and the examples, stays within `MAX_PACK_CHARS`, and contains no path of the machine
  and no environment value. Decide which docs ship in the packages (C-04, `security-guard` skill).
- [ ] T-05. `AssistantSession` over a `Runner` at `read` (AC-10, AC-16): the prompt marks added documents as data; the repair attempt (AC-12) carries only the failure; timeouts and cancellation leave the draft
  untouched; usage is `unknown` when the runner reports none (AC-15). Tests with a fake runner; no test depends on a real agent.
- [ ] T-06. Proposal validation on a clone (AC-12) and `applyAccepted` (AC-05, AC-13): a high-impact edit is applied only when listed; a proposal that does not validate cannot be accepted; the draft is
  unchanged after a rejected or discarded proposal.
- [ ] T-07. The question path (AC-06): `checkQuestion` on each question, one repair, the limit of 5, no answer changes nothing.

## `indaba`, server

- [ ] T-08. The `assistant` section of `indaba.config`: parser, validation, no secrets (AC-03).
- [ ] T-09. The resources of AC-19, confined to served roots; the confirmation of AC-14 required to start; the span attributes (AC-18) with a test that no prompt, answer, path or key is in a span, event or
  log line (AC-17).

## `@indaba/web`

- [ ] T-10. The panel: off state and how to enable it (AC-01), the confirmation of AC-14, the message box, the added documents list (AC-09), the pack viewer.
- [ ] T-11. The proposal view: the diff, the plain-word list, accept / accept some / discard, the separate one-by-one acceptance of high-impact edits with accept-all excluding them (AC-05, AC-13); the
  `full` sentence of `agent-permissions` AC-04.
- [ ] T-12. Questions with options and recommendation (AC-06); explanations (AC-07); cost and "unknown" (AC-15); the words in the message catalogue.
- [ ] T-13. A keyboard path for every action of the panel (`web-app` AC-20).

## Documentation

- [ ] T-14. `docs/` page; `CHANGELOG.md`; `specs/DEPENDENCY_MAP.md`; the amendments listed in `api-surface.md` are sent to the owners of the web-app specs. Fill `review.md`.
