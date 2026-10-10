# Specification: Run blackboard (a shared, visible board for a whole run)

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 (the decisions in section 8 are recommended; the maintainer confirms them)
> **Semver impact**: minor (an optional step field, new optional exports, one new event, one new file per run,
> one optional parameter; nothing existing changes; below 1.0)
> **Builds on**: [`specs/agent-mesh`](../agent-mesh/spec.md) (`AgentMessage`, `Blackboard`, the consensus
> arbiter), [`specs/debate-arbiter`](../debate-arbiter/spec.md) (rulings, the transcript),
> [`specs/tui`](../tui/spec.md) (the run event stream, `TraceReader`, the dashboard) and
> [`specs/observability`](../observability/spec.md) (events, span attributes, redaction).
> **Siblings**: [`specs/step-variants`](../step-variants/spec.md), [`specs/step-verdicts`](../step-verdicts/spec.md),
> [`specs/step-budgets`](../step-budgets/spec.md) and [`specs/ruling-channel`](../ruling-channel/spec.md) touch
> the board and are described here only where they do. [`specs/workflow-editor`](../workflow-editor/spec.md)
> will describe the new step field in its schema.

---

## 1. The problem

The steps of a run share nothing but files. A later step learns what an earlier one concluded only if the
workflow author names a file and the earlier agent was told to write it. What passes between steps is usually
small (a finding, a decision, a fact that holds for the rest of the run, a question nobody has answered), and a
file is the wrong shape for it: it has to be named in advance, read in full, and nobody watching the run can
see it.

The one blackboard Indaba has is private. Each debate step builds a `Blackboard` in memory
(`packages/core/src/mesh/blackboard.ts`), the rounds post to it, and it is dropped when the step ends. All that
survives is a markdown transcript, written after the debate. Nobody can watch a debate as it happens, and no
other step can read it without being told a path.

Three consequences:

1. **A run cannot carry what it learned.** A review step cannot tell the revising step what the first review
   settled except through the retry feedback, and a step two stages later cannot know it at all.
2. **There is nothing to look at.** The dashboard shows steps, states, cost and output. It does not show what the
   steps tell each other, which is what a person trying to understand a run, or to trust it, wants to read.
3. **Every front end would have to invent it.** The TUI is first and a web view will mirror it. If the board is
   only a TUI feature, the web view invents its own; if it is a file with a documented format, both read it.

Indaba is also meant for people who are not developers, running a task that loops until it is done. For them
"what did the steps conclude, in plain words" is the most useful thing the dashboard can show, and it must not
depend on git, a repository or a terminal.

## 2. User stories

- **US-01.** As a workflow author, I say which earlier steps a step reads from the board and what it may post to
  it, in the workflow file, and a workflow that says nothing behaves exactly as it does today.
- **US-02.** As a workflow author, a step that reads the board sees a short digest of what earlier steps posted,
  in its prompt, whichever runner runs it (a text-only API runner included).
- **US-03.** As a workflow author, an agent step can leave a note, a question, a result or a fact for later
  steps by writing one line in its reply, without any tool.
- **US-04.** As a person watching a run in the TUI, I open the board and read, as they happen, what the steps
  and the debates post; I filter by step, sender and kind, open one entry, and see the facts.
- **US-05.** As a person reading a finished run, I replay the same board from its file.
- **US-06.** As a person who runs Indaba without being a developer, I read the board in plain words, with each
  kind named and marked by a word, not only a colour or a symbol.
- **US-07.** As a developer embedding the engine, I read a run's board in process (`RunBoard`) and observe every
  post through an event, without a file.
- **US-08.** As the author of a front end, I read one documented, UI-agnostic file and need nothing from the
  engine's internals.
- **US-09.** As a plugin author, I observe the board through the same event the built-in writer uses.

## 3. Acceptance criteria

Checkable statements; each becomes at least one test when implementation is scheduled.

**The board**

- [ ] AC-01. A run has one board. It is an append-only sequence of records; a record is never changed or removed,
  and a correction is a new record. `RunBoard` in `@indaba/core` performs no I/O, reads no clock of its own and no
  environment, and imports no `node:` module.
- [ ] AC-02. An entry has a monotonic `seq` (from 1, one counter for the run), a time from the injected clock,
  the id of the step that produced it, the attempt number, a scope, a source (`agent` or `engine`), a sender, a
  kind, an optional fact key, an optional debate round, single-line text and a `cut` flag. `seq` is the entry's
  identity and the only ordering; two runs of the same inputs with the same clock produce the same records.
- [ ] AC-03. The kinds are a closed set: `note`, `question`, `result`, `fact` (postable by an agent),
  `proposal`, `critique`, `agreement`, `tool_intent` (the existing message types, posted by the engine for a
  debate) and `decision` (a ruling, posted by the engine). Text is one line: newlines and control characters are
  removed before the entry exists.
- [ ] AC-04. An entry is `pending` until its step attempt is settled, then `accepted`, `discarded` or
  `superseded` (section 8, C-05). A settlement is its own record, written after the entries it settles. The
  state of an entry is derived from the records; nothing is rewritten.
- [ ] AC-05. The fact store is derived: the facts are the accepted `fact` entries, the one with the highest `seq`
  per key winning. A fact is never deleted; a newer value replaces it in the view and the older stays in the log.
- [ ] AC-06. The existing `Blackboard`, `AgentMessage` and `ConsensusArbiter` behave exactly as before; a debate
  keeps its own working board for the quorum, and the run board receives a copy of each message (C-01).

**The workflow field**

- [ ] AC-07. A step may carry `board:` with `read`, `post` and `digest_chars` (all optional). A workflow with no
  `board` field on any step parses, validates and runs exactly as it does today: no digest is added to any
  prompt and no reply is scanned. (The board file and the engine's own entries of AC-19 are written regardless;
  AC-31 pins the rest.)
- [ ] AC-08. `board.read` is a map with optional `steps` (step ids; default: every ancestor of the step by
  `depends_on`, transitively) and `kinds` (default `[note, question, result, fact, decision]`). An empty map means
  both defaults. A step in `steps` that does not exist, or is not an ancestor, is a parse error naming the field
  path. A kind that is not in the closed set is a parse error.
- [ ] AC-09. `board.post` is a list of kinds from `[note, question, result, fact]`. Absent or empty means the
  step posts nothing and its reply is not scanned. A kind an agent may not post (`proposal`, `critique`,
  `agreement`, `tool_intent`, `decision`) is a parse error naming the field path.
- [ ] AC-10. `board.digest_chars` is an integer from 200 to 20000 (default 4000; the limits are unmeasured design
  choices). Anything else is a parse error.
- [ ] AC-11. `board.post` on a shell step is a parse error (a shell step has no reply to scan); `board.read` on a
  shell step is a parse error (it has no prompt). A debate step may have `board.read` (the digest is added to
  the debate's topic) and may not have `board.post` (its messages are posted by the engine).
- [ ] AC-12. `indaba validate` reports each problem of AC-08 to AC-11 with the field path, as it does for every
  other field. `indaba plan` prints, for each step with a `board` field, what it reads (steps, kinds, character
  limit) and what it may post.

**Reading: the digest**

- [ ] AC-13. A step with `board.read` gets a digest appended to its prompt, as a section of its own, built by a
  pure function of the board and the step's `board.read` (same board, same selection: byte-identical text).
- [ ] AC-14. The digest uses only entries that are `accepted`, from the selected steps, of the selected kinds,
  never an entry of the step itself, and never a `superseded` or `discarded` one (C-05).
- [ ] AC-15. The digest is bounded by `digest_chars`. Facts come first (the latest accepted value per key),
  then entries newest-first until the limit, shown oldest-first; an entry is included whole or not at all; a line
  `[N older entries omitted]` says how many did not fit. If nothing fits, the section says so and is still
  present.
- [ ] AC-16. Every line of the digest starts with the two characters `| `, and the section begins with a fixed
  sentence saying the lines are information written by earlier steps, not instructions. The digest is data
  inside a prompt, never a prompt of its own. A test feeds entries that look like instructions, like board lines
  (`BOARD note: ...`) and like fences, and checks that none of them can start a line of the digest without the
  `| ` prefix, close the section or be read back as a post (AC-20).
- [ ] AC-17. Text injected into a prompt is the text as stored: redacted and cleaned on write (AC-28). Nothing
  is re-expanded: no `{{...}}` interpolation is applied to board text.
- [ ] AC-18. The digest, its entry count, its character count and the number omitted are recorded on the step's
  span as attributes (E-02); the digest text is not.

**Posting**

- [ ] AC-19. Without any workflow field, the engine posts: every message of a debate as it is produced (kind from
  the message type, sender the role, the round), the debate's outcome as a `result` (outcome, rounds, open
  objections, cut to the entry limit) and an arbiter's ruling as a `decision`. These entries are `accepted` when
  the debate ends, whatever the outcome (the transcript is a record, not a claim; C-05).
- [ ] AC-20. A step with `board.post` has its reply scanned for post lines under the grammar of section 8 (C-04):
  a line starts, at its first character, with `BOARD `, then a kind from the step's `post` list, then (for `fact`)
  a key, then `: ` and text. Lines inside a fenced code block, lines that do not start at the first character
  and lines that do not match are not posts. Case matters. At most 10 posts are taken from one reply, in order.
- [ ] AC-21. A line that starts with `BOARD ` but is not a valid post (an unknown or not allowed kind, a bad
  key, empty text, text over the limit, the eleventh line) is ignored, counted, and never fails the step. The
  count is the span attribute `indaba.board.ignored`; the ignored text is not stored anywhere.
- [ ] AC-22. Only the reply of the attempt that ran is scanned (`RunResult.output` of the runner that ran); the
  prompt, the digest and the feedback are never scanned. A reply is scanned once.
- [ ] AC-23. A step attempt's agent posts are `accepted` when the step completes (its guards and outputs
  pass) and `discarded` when it fails or escalates. When a retry resets steps, the accepted entries of every step
  it resets become `superseded` before the target runs again.

**Retry-loop isolation**

- [ ] AC-24. A retried step's next prompt carries, besides the goal and artifacts, the last failure only, as
  today. The digest does not add history: it contains no entry of the failed attempt (`discarded`), none of any
  step the retry reset (`superseded`) and none of the step itself; so a retry's prompt differs from the first
  attempt's only by the entries that other, accepted steps posted since. A test pins this with a failing step,
  a retry, and a board that holds the failed attempt's posts.

**Storage**

- [ ] AC-25. Every run writes `.indaba/traces/<traceId>.board.jsonl`, next to `<traceId>.jsonl` and
  `<traceId>.events.jsonl`, one JSON object per line, appended whole in `seq` order by a single serialized
  writer. The format is in [`data-model.md`](data-model.md) and is the contract for every reader.
- [ ] AC-26. The writer is an ordinary listener of the `BoardRecorded` event (E-01). It writes nothing the event
  does not carry, and a plugin can listen to the same event.
- [ ] AC-27. The file name comes from the trace id, validated as lowercase hexadecimal as for the other two
  files; the directory is created if missing. The existing `<traceId>.jsonl` and `<traceId>.events.jsonl` are
  written byte for byte as before (a test pins that).
- [ ] AC-28. Text is redacted with the same function the event stream uses (variables named like a key, token,
  secret, password or credential) and cleaned (control characters removed) before it becomes an entry, so the
  file, the digest and the event carry the same text.
- [ ] AC-29. Limits (unmeasured design choices, section 8, C-08): an entry's text is cut at 2000 characters and
  marked `cut`; a run holds at most 2000 entries and 1 MiB of entry text; past either, one `truncated` record is
  written and no more entries, while settlements continue.
- [ ] AC-30. A reader never fails on the file: a partial last line is waited for, a line that does not parse is an
  `unknown` record, and a record type from a later version is `unknown` too.

**Behaviour that must not change**

- [ ] AC-31. For a workflow without `board` fields, the prompts, the replies handled, the step outcomes, the
  exit codes, the trace file and the event stream are identical to today's. The only additions are the board
  file and the entries of AC-19.
- [ ] AC-32. `@indaba/core` imports no `node:` module for any of this (`architecture.test.ts` stays green) and
  `engine` and `runners` keep their layers tests.

**The TUI**

- [ ] AC-33. The dashboard has a board pane, switchable with the consensus transcript pane (key `b`), that lists
  entries as they are read from the file: sequence, step, sender, kind (word and glyph), and the first line of
  the text. A new entry appears within 250 ms of being written (the bound of `specs/tui` AC-04).
- [ ] AC-34. The pane filters by step (the one selected in the step list), by kind and by sender; filters
  combine, show what is active, and clear in one key. `discarded` and `superseded` entries are hidden by
  default, can be shown, and then carry the word `discarded` or `superseded`.
- [ ] AC-35. `Enter` opens one entry in full (its step, attempt, sender, kind, round, time, text) and `Esc`
  returns to the list. A facts view lists the current value of each fact with the step that set it.
- [ ] AC-36. All board text is sanitised by the TUI's sanitiser before it reaches a component (`specs/tui`
  AC-05), whatever was stored; it is shown as text, never interpreted.
- [ ] AC-37. Colour is never the only carrier: every kind has a word and a glyph, `NO_COLOR` is honoured, the
  key legend lists the board keys, and the pane is keyboard-complete.
- [ ] AC-38. The pane reads only `<traceId>.board.jsonl` through `BoardReader`, imports no engine internals
  beyond the reader and the value types, and shows "no board file yet" while the file does not exist, and
  "the board is incomplete" when the run reported it degraded (C-09).
- [ ] AC-39. `indaba watch --plain` (and any non-terminal output) prints a board section after the steps: the
  facts, then the newest 50 accepted entries one per line as `#<seq> <step> <kind>: <text>`, with a line saying
  how many older entries are not shown.

## 4. Non-goals

- **No tool for agents.** No MCP tool, no function an agent calls, no file protocol an agent has to open. An
  agent sees a digest in its prompt and writes lines in its reply; nothing else.
- **No memory between runs.** A board belongs to one run. Nothing is carried to the next run, and nothing is
  searched. No vector store, no embeddings, no summarising model.
- **No editing and no deleting.** Entries are append-only; a wrong entry is answered by a newer one.
- **No remote or multi-machine board.** One process writes one file on one machine. A second process writing the
  same run is unsupported.
- **No web view in this change.** The web view is a later mirror of the TUI and reads the same file through a
  local server (a later spec). This spec fixes the file, not that server.
- **No `--ui tui|web` selector in this change.** The maintainer intends `indaba run --ui tui|web` later;
  `--tui` stays as it is.
- **No new way to answer a question.** A pending ruling is answered through `specs/ruling-channel`, not through
  the board (C-11).
- **No automatic posting of a step's output.** An author opts in to `result`; the engine never posts a step's
  whole output (C-16).
- **No plugin-defined kinds or digest strategies in this change** (C-12).
- **No change to `AgentMessage`, `Blackboard` or `ConsensusArbiter` behaviour,** and none to the decision ledger.
- **No new runtime dependency.**

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the board file cannot be created or written | the run is not affected: the writer reports the first failure once (`onError`), the root span gets the event `indaba.board.degraded`, and the in-memory board keeps serving digests, so a run behaves the same with or without the file; the TUI says the board is incomplete |
| a reply has a malformed or not allowed `BOARD` line | the line is ignored and counted (`indaba.board.ignored`); the step is not failed and not retried because of it |
| a reply has more than 10 valid post lines | the first 10 are taken, the rest are ignored and counted |
| an entry's text is over the limit | cut at the limit and marked `cut`; the rest is dropped |
| the run reaches 2000 entries or 1 MiB of entry text | one `truncated` record; no more entries; settlements, digests of what exists and the run continue |
| redaction throws on a text | that entry is not stored (as the event stream does for output); the run continues |
| a step reads the board and the board is empty | the digest section is present and says there is nothing yet |
| a step reads a step that is not accepted yet or was reset | its entries are not in the digest |
| a step attempt fails or escalates | its agent posts are `discarded`; the failed attempt's posts reach no prompt |
| a retry resets steps | their accepted entries become `superseded` before the target runs again |
| the run is cancelled | entries already written stay; unsettled entries stay `pending`; the file is not rewritten |
| the process dies mid-line | a partial last line is ignored by every reader until completed, then treated as `unknown` |
| two processes write one file | unsupported; the writer is one per run |
| a resumed run (`specs/step-budgets`) | `RunBoard.replay` rebuilds the board from the file, then appends to it with the next `seq` |
| a reader meets a record type it does not know | `unknown`; it keeps reading |

## 6. Security and data handling

Everything an agent writes is untrusted, and the board is the first place where one agent's output becomes
another agent's input without a person in between. That is the risk this feature adds, and the design answers it
in four places.

- **Posting is a strict grammar, not an interpretation.** A post is a line of one exact form at the first
  character of a line, from an allowed kind, with a bounded count and length. Nothing in a reply can name a step,
  a target, an action or a path; the only effect of a valid line is an entry in the board. Anything else is
  ignored, and an ignored line fails nothing, so an injected line cannot be used to fail a step.
- **Reading is fenced and labelled.** The digest is data: a fixed sentence says so, every line carries a prefix
  that cannot start a post, it is bounded, and no template expansion touches it. A later model can still be
  persuaded by text in it, as it can by any file it reads; the design limits what such text can do (it cannot post
  as the engine, cannot name another step, cannot reach another step's prompt unless the author selected that
  step), and the author controls which steps and kinds a step reads.
- **Secrets are redacted on write.** The same redaction as the event stream is applied before the entry exists,
  so the file, the digest and the event cannot differ. The board never carries MCP server definitions, runner
  arguments or environment values; entries hold only text an agent or the engine produced. The file stays under
  `.indaba/` (gitignored, local) because it can still hold whatever an agent chose to write.
- **Display is text.** Control characters are removed on write, and the TUI sanitises again on read
  (defence in depth), so a stored entry cannot repaint a terminal or plant a link. A later web view must render
  entries as text, never as HTML.

The file name is built from the validated trace id only; no board text reaches a path, a shell or a log. No new
process is started. No dependency is added.

## 7. Where it lives

- **`@indaba/core` (pure, no `node:`)**: `BoardKind`, `BoardEntry`, `BoardRecord`, `RunBoard`, `BoardLimits`,
  `buildDigest`, `parseBoardLines`, the `board` field of `StepDefinition`, and the event `BoardRecorded` beside
  `StepOutput`. One optional parameter on `ConsensusArbiter.deliberate` (an observer called after each post).
- **`@indaba/engine`**: parsing and validating the `board` field; creating the run's `RunBoard` and settling it
  as steps end, fail, retry and are reset; adding the digest to a step's prompt and scanning its reply;
  mirroring debate messages, outcomes and rulings; `BoardWriter` (a listener that appends the file) and
  `BoardReader` (reads and follows it, tolerant of partial lines), beside `RunEventWriter` and `TraceReader`.
- **`indaba` (the CLI)**: registers `BoardWriter` as a listener in the composition root, prints board
  information in `plan`, and includes the board in `watch --plain`.
- **`@indaba/tui`**: the board pane and `reduceBoard`, using `BoardReader`. Nothing else imports `ink`.
- **Not in this change**: the web view, a `--ui` selector, anything in `@indaba/runners`.

## 8. Clarifications

Stage 2. Every choice below is **recommended; the maintainer confirms**. Each default is inherited by every
consumer.

- **C-01. One run board; the debate keeps its own working board.** The run board is new and run-wide. A debate
  still builds its own `Blackboard` for the quorum and the ping-pong check, and the run board receives a copy of
  each message through an observer. Rejected: making the debate read and write the run board directly. The
  quorum looks at `latestBy(sender)` within one debate, so every read would need a scope filter; the published
  `Blackboard` and `ConsensusArbiter` would change; and a debate would depend on a file-backed structure for its
  own correctness. A copy costs one call per message and changes nothing that exists.
- **C-02. A new entry type, not a change to `AgentMessage`.** `AgentMessage` is a published class with a
  positional constructor and four fields. The board needs eight more (sequence, time, step, attempt, scope,
  source, key, cut). `BoardEntry` wraps what is needed and leaves the envelope alone. The kinds are lower-case
  words in a closed set, the mesh types mapped one to one (`PROPOSAL` to `proposal`, and so on), plus `note`,
  `result`, `fact` and `decision`. Rejected: adding the new kinds to `MessageType`. That would make the debate's
  reply parser accept them (`fromReply`) and change what counts as agreement.
- **C-03. The workflow field, and what is on by default.** `board: { read: { steps, kinds }, post: [kinds],
  digest_chars }` on a step. Nothing is read or posted by default, so no existing workflow changes. Reading is
  limited to ancestors (transitive `depends_on`) so that the digest is a function of the graph and not of the
  order the engine happened to run steps in. The default `kinds` for reading leave out the debate kinds
  (`proposal`, `critique`, `agreement`, `tool_intent`), which are long; an author who wants them lists them.
  Shell steps cannot use `board` (they have no prompt and no reply of their own to scan); a debate step may read
  but not post. Rejected: a workflow-level `board:` switch that turns it on everywhere (it would change every
  prompt at once), and a default that posts each step's last paragraph (C-16).
- **C-04. The post grammar.** One line per post, because a one-line entry is bounded, easy to list and easy to
  show:

  ```
  BOARD note: the staging database is read-only
  BOARD question: which of the two invoices is the final one?
  BOARD result: three endpoints need changing; list in notes.md
  BOARD fact api.version: 3
  ```

  The line starts at its first character, the kind is lower-case, the key (facts only) matches
  `[a-z0-9][a-z0-9_.-]{0,63}`, the separator is a colon and one space, the text is 1 to 2000 characters after
  trimming. Lines in fenced blocks are skipped, so quoting an example does not post it. Rejected: a JSON block
  (an agent that gets a quote wrong loses everything; a half-finished block is ambiguous), a tag that may be
  indented or bulleted (the first-column rule is what keeps a quoted digest from being re-posted), and a tool
  (decided: no tool). Ignoring a bad line, instead of failing the step, is deliberate: a failure is retried, and
  an injected line must not be able to push a run into a retry loop.
- **C-05. Settlement: pending, accepted, discarded, superseded.** An agent's claim counts only if its step
  passes: a step's agent posts are `accepted` when the step completes and `discarded` when it fails or
  escalates. A retry that re-runs the target and every step after it makes their accepted entries
  `superseded`, so a loop never reads the results of the iteration it is redoing. A debate is the exception:
  its messages and outcome are accepted when it ends in any outcome, because they are a record of what was said
  and an escalated debate's transcript is exactly what a person or a later step wants. Settlement is a record
  of its own, written after the entries it concerns, which keeps the file append-only. Rejected: writing an
  entry only after its step completes (the TUI could not show a debate live, and a crash would lose posts);
  rewriting an entry's state (breaks append-only and tailing).
- **C-06. Retry-loop isolation.** The rule is "the next prompt carries only the last failure". The digest does
  not carry history: it holds only `accepted` entries of other steps, none of the retried step's own earlier
  attempts, and none of the steps a retry reset. So between attempt 1 and attempt 2 the digest can differ only
  by entries that accepted steps posted in the meantime, never by the failed attempt. The board is shared state,
  not a log of attempts. A review loop (`specs/step-verdicts`) therefore passes the critique to the revising step
  through its existing feedback path, and the board shows the critique to people; it does not duplicate it into
  the reviser's prompt.
- **C-07. Where the file lives.** `.indaba/traces/<traceId>.board.jsonl`, next to the trace and the event
  stream. The directory, the run-id validation (`isRunId`), the listing of runs and the way `watch` finds a run
  already exist there, so no new path has to be confined, and a front end that has a run's id has all three
  files. Rejected: `.indaba/boards/` (a new directory with the same rules), and `.indaba/artifacts/` (artifacts
  are a step's outputs, may be copied into worktrees, and have a different lifecycle).
- **C-08. Limits.** 2000 characters an entry, 10 posts a reply, 2000 entries and 1 MiB of entry text a run,
  4000 characters of digest by default (200 to 20000). All five are design choices, not measured: no data in
  this repository says how big a useful board is. They are constants of `BoardLimits`, overridable by an
  embedder, and the first real runs decide whether they move. Raising one is not a breaking change.
- **C-09. A board that cannot be written does not fail the run.** The in-memory board is what digests are built
  from, so a run behaves the same with or without the file. The first write error is reported once, the root
  span gets `indaba.board.degraded`, and the TUI says the board is incomplete. Rejected: failing the run (a full
  disk would then fail work that did not need the file).
- **C-10. Determinism.** The clock is injected; `seq` replaces any id generator (it is an integer from the
  board itself); nothing reads the environment; the digest is a pure function; the order of entries is `seq`.
  `RunBoard.replay(records)` rebuilds a board from a file and is how a resumed run (`specs/step-budgets`)
  continues one.
- **C-11. How the board meets the other specs.** Each is a dependency in one direction only, so none of them has
  to land first.
  - *`step-variants`*: each variant's posts are in scope `variant:<n>` and stay `pending` until selection; the
    winner's are `accepted`, the losers' `discarded` (they stay in the file, which is what "kept" means for them).
  - *`step-verdicts`*: when a review step returns a verdict, the engine may post it as an `agreement` or
    `critique` entry with the reason, sender the step, source `engine`. A step with a `review` field posts
    nothing extra by default; this is the one place the two specs meet.
  - *`step-budgets`*: the digest is part of the step's input and is metered with it; writing the board costs
    nothing. A cap that stops a step discards that attempt's posts like any other failure; a resume appends to the
    same file (`replay`).
  - *`debate-arbiter`*: a ruling becomes a `decision` entry (verdict and the redacted note); the decision ledger,
    the artifacts and the memo are unchanged.
  - *`ruling-channel`*: while a ruling is pending, the engine may post a `question` entry that says so; the
    question is answered through the channel, and the answer is posted as the `decision`. The board is never the
    way to answer. Rejected: merging the two. The channel is a request and an answer between processes with its
    own lifecycle; the board is a log.
- **C-12. Extensions.** A plugin can observe every record through the `BoardRecorded` event with
  `registerListener`, exactly as the built-in writer does, so the built-in has no access a plugin lacks.
  Plugins cannot add kinds or digest strategies in this change. A new kind changes what the TUI must name and
  what a workflow may declare; a digest strategy is the prompt-injection boundary, and a registry of them would
  make that boundary something a plugin could weaken. Both can be added later, additively, when there is a real
  second use. `buildDigest` and `parseBoardLines` are exported from core and take their limits as arguments, so
  an embedder can call them and a second implementation can be tested against them.
- **C-13. The TUI.** The board is a pane of the existing dashboard, switchable with the transcript pane, as the
  TUI spec proposed for the transcript. Proposed keys, to be reconciled with the dashboard's legend: `b` opens
  or closes the pane; `up`/`down` (and `j`/`k` where the dashboard already uses them) move; `Enter` opens an
  entry, `Esc` closes it; `s` filters to the selected step; `t` cycles the kind filter; `r` cycles the sender
  filter; `x` clears the filters; `f` shows the facts; `d` shows or hides discarded and superseded entries.
  Layout: a list of one line per entry (`#seq  step  sender  kind-glyph kind-word  text`), the active filters in
  a line above it, the legend below; the detail view takes the same area. The web view later mirrors the pane
  and reads the same file; the file is the contract, so nothing in this spec is TUI-shaped except AC-33 to AC-38.
  The maintainer's intended `indaba run --ui tui|web` is not part of this change.
- **C-14. Plain words, no git.** Board kinds are shown as words a non-developer reads: Note, Question, Result,
  Fact, Decision, and for a debate Proposal, Critique, Agreement. The board has no dependency on git, a worktree
  or a repository; it works for `isolation: none` and for non-code workflows such as the media pipeline in
  `docs/workflow-format.md`. Messages that mention it say "the board" and "notes between steps", not `jsonl`.
- **C-15. The debate's outcome as a `result`.** Downstream steps need to know how a debate ended without
  reading its messages. The engine posts one `result` at the end of a debate (outcome, rounds, open objections,
  cut to the entry limit). Rejected: leaving it to the reader to infer the outcome from the last messages.
- **C-16. No automatic posting of step output.** The engine never posts a step's whole output or its last
  paragraph. The output can be large, can contain secrets and untrusted text, and would turn every step into a
  poster. An author opts in with `post: [result]` and the agent writes the line. Rejected: a default `result` per
  step.

## Artifacts not written

- `research.md`: the feature adds no dependency and compares no technology; the alternatives that mattered are
  recorded in the clarifications above.
