# Plan: Agent conversation

## Modules touched

| Package | File | Change |
| :--- | :--- | :--- |
| `@indaba/core` | `src/conversation/choice.ts` (new) | `DecisionKind`, `AVAILABLE_DECISION_KINDS`, `DecisionMode`, `AskSettings`, `DeciderSpec`, `ChoiceLayer`, `EffectiveChoice`, `effectiveChoice`, `describeChoice` |
| `@indaba/core` | `src/conversation/answerers.ts` (new) | `Answerer`, `AnswererRegistry`, `AnswerRequest`, `AnswerOutcome`, `AnsweredBy`, `walkAnswerers`, `PanelAnswer`, `panelAnswerFrom`, `StepQuestion`, `RecoverableDebate`, `recoverableDebates`, `historyFor` |
| `@indaba/core` | `src/conversation/decisions.ts` (new) | `DecisionRequest`, `DecisionOutcome` (types for all six kinds) |
| `@indaba/core` | `src/conversation/messages.ts` (new) | `ConversationMessage`, `MessageReceipt`, `fenceAsData`, the fixed sentences, `panelTopic`, `roleSection`, the events |
| `@indaba/core` | `src/assets/` (new) | `AssetKind`, `AssetSource`, `AssetSourceRegistry`, `AssetResolver`, `AssetUnresolvedError`, `parseAssetFirstBlock`, `isAssetName`, the limits |
| `@indaba/core` | `src/workflow/model.ts` | role gains `instructions`, `skill`, `decides`; step gains `ask`, `decider`; workflow gains `askDefaults`, `deciderDefault`, `assetFolders`, `skills` |
| `@indaba/core` | `src/mesh/blackboard.ts`, `src/mesh/consensus.ts` | `addHistory`, `history()`; `deliberate(..., history?)`; history excluded from quorum, stall and outcome |
| `@indaba/core` | `src/extension/` | `PluginHost.registerAnswerer`, `registerAssetSource` |
| `@indaba/engine` | `src/parser/parser.ts`, `validator.ts` | the new fields and every error of "Parse and validation errors"; plain-words messages |
| `@indaba/engine` | `src/engine/choice-state.ts` (new) | `ChoiceState`, `applyChange`, the record of changes |
| `@indaba/engine` | `src/engine/step-executor.ts` | the question loop (AC-39 to AC-42); person messages delivered at the next prompt; interrupt; the role section; the order of work (question before outputs, guards, verdict) |
| `@indaba/engine` | `src/engine/prompt-builder.ts` | sections: role, ask instruction, answered questions, person messages |
| `@indaba/engine` | `src/conversation/channel.ts`, `files.ts`, `inbox.ts` (new) | `ConversationChannel`, the list/answer/send functions, `FileAnswerer`, `ConversationInbox`, the atomic writers |
| `@indaba/engine` | `src/conversation/answerers.ts` (new) | `PanelAnswerer`, `RoleAnswerer`, `FreshAnswerer`, `DeciderAnswerer`; read-only runs; the scope check |
| `@indaba/engine` | `src/assets/` (new) | `FolderAssetSource`, `WorkflowAssetSource`, `readAssetManifest`, `createAssetResolver`; hashing with `node:crypto` |
| `@indaba/engine` | `src/arbiter/records.ts`, board writer | engine notes for choices; question and answer entries; `answers`/`answered_by`/`decided_by`/`mode` |
| `@indaba/engine` | `src/trace/` | the event-stream records and the span attributes of `events.md` |
| `indaba` | `src/main.ts`, `engine-factory.ts` | options `--mode`, `--answer-with`, `--decider`, `--no-human`, `--ask-human`; the banner; the resolver; the registrations |
| `indaba` | `src/commands/say.ts`, `ask.ts`, `answer.ts`, `mode.ts`, `decider.ts` (new) | the commands, receipts and replies in plain words |
| `indaba` | `src/terminal-answerer.ts` (new) | the prompt in the terminal the run was started in |
| `@indaba/tui` | header, banner, conversation pane, message entry, question pane, controls | reads the board and the request files, writes only through the engine's functions |
| `docs/` | `workflow-format.md`, `getting-started.md`, `extending.md` | fields, fixed sentences, commands, the read-only statement, answerer and asset-source contracts |
| root | `README.md`, `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md`, `AGENTS.md` | per the documentation rule |

## Order

1. Core types, the pure functions and the tests that need no engine (`effectiveChoice`, `walkAnswerers`, `panelAnswerFrom`,
   `fenceAsData`, `parseAssetFirstBlock`, the mesh history).
2. The parser and validator, with every error message and its plain-words wording.
3. Assets: the sources, the resolver, the manifest reader, the `validate` and `plan` output. Independent of the conversation and
   shippable alone.
4. The channel and the files, with the CLI commands that use them (`say`, `answer`, `mode`, `decider`) and the receipts.
5. The question loop in `StepExecutor`, the person answerer (terminal, files), the decider for `questions`.
6. The panel, the role and fresh answerers, recovery inside a run.
7. The dashboard.
8. Phase 2: `ask` for a finished run.

## Decisions that shape the work

- **The choice is state, not configuration.** `ChoiceState` holds the layers and is the only thing a live change touches; the
  executor asks it at each question and never caches the result across questions.
- **A question's re-run reuses the step's workspace and its pass machinery.** It is a new pass of the same attempt, so the
  budget gate, the abort controller and the fallback chain apply without change.
- **Read-only answerers share one helper.** Permissions, the prompt line and the scope check are written once and used by the
  panel, the role, the fresh instance, the decider and the explainer.
- **Assets are resolved once, at load, and hashed.** Nothing re-reads a file during the run. The resolver is passed in; the
  executor never reads an asset itself.
- **Nothing here touches the decision ledger.** A test lists `.indaba-decisions/` before and after.

## Risks

- The dashboard has no text entry today; the message entry and the answer entry are new work in `@indaba/tui` (Ink).
- Two prompts for one question (terminal and files) must withdraw cleanly; the first answer wins.
- A mode change racing with a question that is being asked is decided by the sequence in which the engine reads the inbox; the
  rule (from the next question, take-over for the open one) must be tested with a scripted clock and inbox.
- The role section is added to every call of a role, including working calls; the retry-isolation test must pin that a retry's
  prompt differs from the first only by the failure text and the section, which is the same text.
- `hashing` of large assets is bounded by the 8000-character limit, so it is cheap; folders with thousands of assets are listed,
  not read, until a name is asked for.
