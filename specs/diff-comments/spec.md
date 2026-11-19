# Specification: Diff comments (a person's comment on a line of a step's change goes back to the agent)

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 (the decisions in section 8 are recommended; the maintainer confirms them)
> **Semver impact**: minor (below 1.0): new optional contracts, a new board kind, new events and attributes, new CLI command.
> Provisional; confirmed in [`api-surface.md`](api-surface.md).
> **Builds on**: [`specs/review-gate`](../review-gate/spec.md) (the gate and its outcome "change this step"),
> [`specs/step-verdicts`](../step-verdicts/spec.md) (the send-back and the bounded loop),
> [`specs/run-blackboard`](../run-blackboard/spec.md) (the board), [`specs/parallel-steps`](../parallel-steps/spec.md) (the
> review before landing sees the step's own diff), [`specs/web-app`](../web-app/spec.md) and [`specs/tui-epic`](../tui-epic/spec.md)
> (where a person reads a change).
> None of `review-gate`, `step-verdicts` and `run-blackboard`'s consumers is complete; this spec is implemented after them.
> **Origin**: a comparison with Cezar (2026-11-19), which lets a person comment on the lines of a diff.

---

## 1. The problem

`review-gate` shows a person what a step changed "in plain words, and never a diff" (US-05), which is right for someone who
is not a developer. A developer who reads the change wants to say *this line*, not "change this step": today the only
answers are an outcome and a free-text note about the whole step. The agent then guesses which part is meant, or the person
edits the file by hand and the agent never learns why.

## 2. User stories

- **US-01.** As a developer reviewing a step's change, I comment on a line or a range of lines of the diff, and the comment
  reaches the agent that wrote it when the step is sent back.
- **US-02.** As a developer, I see my comments next to the lines, and which of them the agent has seen on its next attempt.
- **US-03.** As an agent given a comment, I receive the file, the lines, the code on them as they were and the text, as data
  I answer; not a free paragraph in which I have to find the place.
- **US-04.** As a person who is not a developer, nothing changes: the gate stays in plain words and shows no diff.
- **US-05.** As an author of a workflow with several agents, a comment can be addressed to the author of the change or to the
  reviewer panel, and appears on the board for the others.

## 3. Acceptance criteria

### The comment

- [ ] AC-01. A comment has: the step and attempt it is on, a path, the side (`before` or `after`), a first and last line, the
      text of those lines **as the diff showed them**, the comment text, and who wrote it (a person, or an agent of a panel).
- [ ] AC-02. A comment is accepted only if its path is in the step's diff, its lines exist in that diff on that side, and the
      attempt is the latest one. Anything else is refused with a message; nothing is stored.
- [ ] AC-03. The text is bounded (default 2,000 characters), the number of comments for one send-back is bounded (default
      50), and a comment is plain text: no markup is interpreted.
- [ ] AC-04. A comment can be edited or withdrawn by its author until the step is sent back; after that it is part of the
      record and never changes.

### Reaching the agent

- [ ] AC-05. When a gate or a review sends a step back (`review-gate` "change this step"), the step's next prompt carries its
      comments as a delimited block of structured items, in file and line order. The block is data: the prompt says so and
      names the delimiter.
- [ ] AC-06. The rule that a retry's prompt carries only the last failure is kept: the comments are the person's feedback on
      the **latest** attempt only. Earlier attempts' comments are not added again.
- [ ] AC-07. If a commented line no longer exists in the new attempt, the comment is still shown to the agent with the
      original text of the line, marked "line changed since".
- [ ] AC-08. An agent's reply to a comment (a line in its answer that names the comment's id) is recorded next to it as
      `answered`; a comment with no reply is `unanswered`. Indaba does not judge whether the change fixed the comment.
- [ ] AC-09. A comment on a step that lands (`parallel-steps`) is against the step's own diff, not the combined state, as
      the review before landing is.

### Where it is made

- [ ] AC-10. `indaba comment <run> <step> <path> <line[-line]> "<text>"` adds a comment; `indaba comments <run> [<step>]`
      lists them. Both work without a terminal UI. They refuse a run that is not waiting at a gate or a review.
- [ ] AC-11. The web view shows a step's diff with a comment control on every line; the dashboard offers the same with keys.
      Each has a keyboard path for every action and a visible focus, per the accessibility rules of `web-app` and `tui-epic`.
- [ ] AC-12. A comment is a board entry of a new kind `review_comment`, so the other agents of the run can read it. A reader
      that does not know the kind ignores it, as `run-blackboard` AC-30 requires.
- [ ] AC-13. Events: `comment.added`, `comment.edited`, `comment.withdrawn`, `comment.delivered`, `comment.answered`; span
      attributes on the step span: `indaba.comments.count`, `.delivered`, `.answered`. The text of a comment is not an
      attribute; its length is.

### Parity

| Capability | Web view | TUI | CLI / `--plain` |
| :--- | :--- | :--- | :--- |
| see the step's diff | yes (read-only diff) | yes (pane) | `indaba comments` lists comments with the lines |
| add a comment on a line | yes | yes | `indaba comment` |
| edit or withdraw before send-back | yes | yes | `indaba comment --edit`, `--withdraw` |
| see which comments the agent answered | yes | yes | `indaba comments` shows the status |

## 4. Non-goals

- A code host. Nothing is synchronised with a pull request, and no thread, resolution state or mention between people exists.
- Suggested changes that Indaba applies itself: the agent makes the change.
- Showing a diff to a person who is not a developer (`review-gate` US-05 stands).
- Comments on files outside the step's diff, on commit messages, or on the run as a whole (the gate's free-text note is for
  that).
- Judging a comment as resolved. The person decides, by the next review.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the path or lines are not in the diff | refused, nothing stored (AC-02) |
| a comment arrives after the step was sent back | refused: the attempt is no longer the latest |
| the agent ignores the comments | the next review sees an unchanged line; the comment stays `unanswered` |
| the run ends or is stopped with comments undelivered | they stay in the record, `delivered: false`, never sent later |
| the diff is too large to show | the view shows the file list and loads a file's diff on request; comments work as before |

## 6. Security and data handling

- A comment is untrusted text from a person or an agent. It enters a prompt as delimited data, never a command; it never
  reaches a shell, a path or a log line as code. Paths come from the diff, are made relative and checked to stay inside the
  worktree.
- The quoted code is what the agent already produced in the run; it is not read from anywhere else.
- Comment text is subject to the redaction of `logging`: a secret pasted in one is removed from logs and traces.

## 7. Where it lives

`@indaba/core`: `DiffComment`, `CommentStore` and the events (pure types). `@indaba/engine`: the check against the diff, the
store beside the run's artifacts, the prompt block, the board entry. `indaba`: `comment`, `comments`. `@indaba/tui`,
`@indaba/server`, `@indaba/web`: the diff and the control. No dependency added (the diff is shown with the page's own code).

## 8. Clarifications

- **C-01 (recommended).** Comments feed the existing send-back and the gate's outcome; there is no second path that restarts a
  step.
- **C-02 (recommended).** Only the latest attempt's comments are carried (AC-06), so the retry rule holds and a prompt does
  not grow without bound.
- **C-03 (open).** Whether an agent of a panel (`review-gate`) may write comments at the same level as a person. The text
  allows it (AC-01), marked as an agent; the maintainer confirms.
- **C-04 (open).** The limits of AC-03 are defaults; the maintainer confirms the numbers.

## Artifacts not written

- `plan.md`: stage 3 has not begun; written when `review-gate` is implemented.
- `tasks.md`: stage 4 has not begun.
- `data-model.md`: the comment is described in AC-01; the store's layout is decided at stage 3.
- `research.md`: nothing outside the repository is needed.
- `events.md`: the events are listed in AC-13.
