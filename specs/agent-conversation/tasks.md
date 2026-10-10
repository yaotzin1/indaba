# Tasks: Agent conversation

Ordered by dependency. Domain first, infrastructure second, console and documentation last. Each task independently checkable.
Tests are written with each task, not after (qa skill). Tasks marked **(phase 2)** are built after the rest (C-26). The helper for
downloading and creating assets is `specs/asset-helper`, not listed here.

## Domain (`@indaba/core`)

- [ ] **T-01** `DecisionKind`, `AVAILABLE_DECISION_KINDS` (`['questions']`), `DecisionMode`, `AskSettings`, `DeciderSpec`, `ChoiceLayer`, `EffectiveChoice`
- [ ] **T-02** `effectiveChoice`: layers weakest first, step addressing, `answerers` and `decider` replaced whole, the authority rule (promotion `decides`, else the role's, else empty), `mode` derived as `decider` when `questions` is in authority; a test per precedence case and for empty authority deciding nothing
- [ ] **T-03** `describeChoice`: the plain-words banner per step, naming each kind and who takes it; facts only (unmetered, no person in reach, no authority); a snapshot of every wording of AC-16
- [ ] **T-04** `Answerer`, `AnswererRegistry` (refuses without `metering`, duplicate kind without `replace`), `AnswerRequest`, `AnswerOutcome`, `AnsweredBy`
- [ ] **T-05** `walkAnswerers`: pass and unavailable move on, exhausted lists who passed, `person` handled as the caller decides; table-driven
- [ ] **T-06** `panelAnswerFrom`: the latest PROPOSAL, dissent of those not agreeing (cut, at most three), `undefined` without a quorum or a PROPOSAL; pure
- [ ] **T-07** `recoverableDebates` and `historyFor` over a `RunBoard`: newest first, at most 20; 30 messages and 12000 characters, newest kept, omitted count; pure
- [ ] **T-08** `Blackboard.addHistory`, `history()`, the transcript line; `ConsensusArbiter.deliberate(..., history?)`: history ignored by the quorum, the stall detector and the outcome, rounds numbered after it, `rounds` = this call's; a test that an old AGREEMENT in the history never satisfies a new quorum; unchanged without it
- [ ] **T-09** `fenceAsData`, `panelTopic`, `roleSection`, the fixed sentences; a hostile-text test (instructions, board lines, verdict tags, `NO ANSWER:`, fences) that cannot start a line without `| `
- [ ] **T-10** `DecisionRequest` and `DecisionOutcome` for all six kinds (types and a compile test that each sibling can narrow on `kind`)
- [ ] **T-11** `ConversationMessage`, `MessageReceipt`, the five events
- [ ] **T-12** Assets: `AssetKind`, `AssetSource`, `AssetSourceRegistry`, `AssetResolver` (fixed precedence, `alsoIn`, `searched`), `AssetUnresolvedError.plain()`, `parseAssetFirstBlock`, `isAssetName`, the limits; the plain message for each reason
- [ ] **T-13** `Role` gains `instructions`, `skill`, `decides`; `StepDefinition` gains `ask`, `decider`; `WorkflowDefinition` gains `askDefaults`, `deciderDefault`, `assetFolders`, `skills`; `PluginHost.registerAnswerer` and `registerAssetSource`
- [ ] **T-14** Architecture test still green: no `node:` import in core

## Infrastructure (`@indaba/engine`)

- [ ] **T-15** Parser and validator for every field and every error of "Parse and validation errors", each naming the field path, in plain words; `ask: true`; `decides` naming an unavailable kind lists the available ones; a workflow with none of the new fields parses to the same definition as before
- [ ] **T-16** `ChoiceState`: `current`, `applyChange` (mode, decider set, decider remove; from the next question; refuses unknown step or role and incomplete choices as a whole), the record of every change
- [ ] **T-17** Assets: `FolderAssetSource` (only `skills/<name>/SKILL.md` and `prompts/<name>.md`; a name validated first; symlinks and junctions out of the folder refused; size and text checks), `WorkflowAssetSource`, `readAssetManifest`, `createAssetResolver`; no network (a test that fails if a socket is opened)
- [ ] **T-18** Manifest verification: no entry, `accepted: false`, a different hash, a bad `path`, an oversize manifest, each refused with the plain message and nothing used instead; a downloaded and a user folder with the same name resolved by the fixed precedence
- [ ] **T-19** `validate` and `plan`: which source each skill and prompt resolved from, `alsoIn` as a fact, the plain error when unresolved, the choice per step; the trace attributes `indaba.asset.*` with name, origin and hash and never the text
- [ ] **T-20** `ConversationChannel`, `listLiveRuns`, `listPendingQuestions`, `answerQuestion`, `sendConversation`, `readReceipt`: atomic whole files, id validation (`../` test), bounded size, at most 10 files per poll, malformed files skipped with a warning, stale `pid` cleaned; the only code that builds a path under `.indaba/conversation/`
- [ ] **T-21** `PromptBuilder` sections: role section, ask instruction, answered questions, person messages; the same text each pass; the retry-isolation test (a retry differs from the first pass only by the failure text)
- [ ] **T-22** Person messages: queue per step (20) and per run (200), delivery at the next prompt, oldest first, receipts `queued`/`delivered`/`undelivered`/`refused`; a message to a debate joins the next round's topic and never counts for the quorum; a board note for each
- [ ] **T-23** Interrupt (`--now`): aborts the call with the budget gate's controller (ACP gets `session/cancel`), discards the partial reply, keeps the workspace, runs the next pass; refused for shell, debate and not-running steps with the plain messages
- [ ] **T-24** The question loop in `StepExecutor`: first `BOARD question:` taken, the rest counted; a question before outputs, guards and the verdict; the step stays `RUNNING`; the re-run in the same workspace with the answered questions only; limits per attempt and per run; no `on_failure` or review counter moves
- [ ] **T-25** The person as an answerer: `FileAnswerer` (request files, the first answer wins, withdraw), the choices and stages of AC-45 to AC-48, no timeout, cancel ends the run `cancelled`; skip and best-guess recorded as `skipped`
- [ ] **T-26** `PanelAnswerer`: a `ConsensusArbiter` over the `ask.panel` roles with the role sections, `panelTopic`, the quorum, rounds, recovery with `historyFor`, asking again with a note (3 times); `pass` with proposals and dissent when there is no agreement
- [ ] **T-27** `RoleAnswerer`, `FreshAnswerer`: one metered call, a new session, the `NO ANSWER:` rule, the labels; `role:` with the step's own role refused at parse time
- [ ] **T-28** `DeciderAnswerer`: the decider answers every question of its steps with `questions` in authority, none outside it, `decided_by`, `max_decisions` per step and per run, the exhaustion policy; never writes `.indaba-decisions/` (a test lists the directory before and after)
- [ ] **T-29** Read-only answerers: one helper for `permissions` (empty write list, no terminal), the prompt line and the scope check against the tracked workspace; a changed file fails the call and escalates the step naming the files; the `validate` facts for runners that cannot be limited and steps with no workspace
- [ ] **T-30** Metering: every answerer and decider call reported with its source (`panel`, `role`, `fresh`, `decider`, `explain`); an unmetered answerer declared, counted, shown; a budget stop makes the answerer `unavailable` for the question
- [ ] **T-31** Take over and reopen: abort the answerer calls in flight and ask the person; a reopen supersedes the model's answer with a person's and is delivered with the fixed sentence; neither affects a finished step
- [ ] **T-32** `ask` (a person's question to an answerer): the explainer given the question, the goal, the kept last reply and the digest; the reply labelled as a reconstruction; the kept reply is bounded, redacted, in memory only
- [ ] **T-33** Board entries and the choice notes (`answers`, `answered_by`, `decided_by`, `mode`, scope `panel:<n>`); the event-stream records and the span attributes of `events.md`, none carrying text
- [ ] **T-34** **(phase 2)** The offline `ask` for a finished run: `BoardReader` history, the answerer, `.indaba/asks/<id>.json`, nothing else written, exit codes 0/1/2

## Console (`indaba`)

- [ ] **T-35** Run options `--mode`, `--answer-with`, `--decider`, `--no-human`, `--ask-human` into the `run_option` layer; usage errors name the unknown step, role or kind; the banner before the first step
- [ ] **T-36** `say`, `ask`, `answer` (`list`, `show`, `<id> ...`, `--reopen`, `--take-over`), `mode set|show`, `decider set|remove`: receipts and replies in plain words; a command for a run that is not running says so
- [ ] **T-37** `TerminalAnswerer`: numbered choices in the wording of C-06, the same input rules as the human arbiter, end of input answers `unavailable`
- [ ] **T-38** `createEngine`: the built-in answerers and asset sources registered through `PluginHost`, the resolver built from the workflow, the project folders, the user folders and the plugins; `--rulings none` closes the prompt, not the inbox
- [ ] **T-39** `@indaba/tui`: the header with the choice, the banner, the conversation pane, the message entry (a text entry component), the question pane, the controls to join, step back and change the decider; all text sanitised; keyboard-complete; `NO_COLOR`
- [ ] **T-40** **(phase 2)** `indaba ask --run <traceId>|latest`

## Tests

- [ ] **T-41** The AC-02 table: every combination of absent and present fields, run options and live changes with a scripted question; with no choice naming a model the person is asked, with nobody reachable the step ends `ESCALATED`, and no answerer or decider runner is called
- [ ] **T-42** AC-16: configurations a cautious engine might refuse (unmetered decider, a chain of one, `trusted` with nobody in reach, a decider with empty authority) all run; the banner states the facts and blocks nothing
- [ ] **T-43** Live switching with a scripted clock and inbox: a change during a question applies from the next one; a take-over changes only the open one; incomplete changes refused as a whole; every change recorded in the event, the stream and the board
- [ ] **T-44** Hostile inputs: board lines, verdict tags, `NO ANSWER:` lines and fences in a question, an answer, a message, a note and a history; oversize files and messages; a flooded inbox; ids with `../`; an asset with `..`, a symlink out, a NUL, a script that must not run; strings built from fragments (security gate)
- [ ] **T-45** End to end through the built CLI: a workflow whose step asks a question, answered by a scripted person, by the panel, by a role, by a fresh instance and by a decider; a `say` read at the next pass; `--now`; `mode set` mid-run
- [ ] **T-46** `pnpm smoke`: the packed install still boots with the new exports; unit coverage for new behaviour, success and failure paths (85% floor on all four metrics)

## Documentation

- [ ] **T-47** `docs/workflow-format.md`: the new fields, the fixed sentences, the three ways of working and the decider, the asset precedence, the read-only statement, the commands; `docs/getting-started.md`: talking to a run, `say`, `ask`, `answer`, `mode`, `decider`
- [ ] **T-48** `docs/extending.md`: writing an `Answerer` (the `metering` declaration) and an `AssetSource`; README, CHANGELOG under Unreleased, `specs/DEPENDENCY_MAP.md`, AGENTS.md repository map if a path changed
- [ ] **T-49** Follow-ups in other specs listed in section 9 of the spec, each in its own change: `run-blackboard`, `step-budgets`, `debate-arbiter`, `step-verdicts`, `step-variants`, `workspace-without-git`, `debate-findings`, `tui`, `workflow-editor`
- [ ] **T-50** Write `specs/asset-helper` (list, add, remove, verify and create skills and prompts; a plain-words wizard to make one; sources user-declared and allowlisted; show before accept; per name and version; pinned by hash; licence recorded) before the helper is built

## Stage 7: Verification

- [ ] `pnpm qa` and the node gates (`node scripts/check-workflow.mjs`) green end to end, output recorded in review.md
- [ ] `pnpm e2e` and `pnpm smoke` (if present on this branch's base) green
