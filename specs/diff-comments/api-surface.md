# API surface contract: Diff comments

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it. An
> implementation that finds this wrong stops and returns to stage 3; it does not edit this file.

> **Status**: provisional, written at stage 1. Stage 3 confirms or corrects it.

## Semver classification

**minor** (below 1.0).

Reasoning: new optional types, a new `BoardKind` member, new events and span attributes and a new command. No default
changes and nothing released changes meaning. A new `BoardKind` member is classified as `run-blackboard` AC-30 says: the
reader rule protects the shipped readers; the changelog names it.

## Public symbols added

| Export (package, module) | Kind | Signature |
| :--- | :--- | :--- |
| `@indaba/core` `DiffComment` | interface | `{ id; step; attempt; path; side: 'before' \| 'after'; fromLine; toLine; quoted: string; text: string; author: CommentAuthor; status: 'open' \| 'answered' \| 'withdrawn'; delivered: boolean }` |
| `@indaba/core` `CommentAuthor` | union | `{ kind: 'person' } \| { kind: 'agent'; name: string }` |
| `@indaba/core` `CommentStore` | interface | `add`, `edit`, `withdraw`, `list(step, attempt)`, `markDelivered`, `markAnswered` |
| `@indaba/engine` `FileCommentStore` | class | the built-in store beside the run's artifacts |
| `@indaba/engine` `commentsForPrompt` | function | `(comments: readonly DiffComment[]) => string` (the delimited block of AC-05) |

## Public symbols changed

| Name | Before | After | Impact |
| :--- | :--- | :--- | :--- |
| `BoardKind` | current members | adds `review_comment` | readers that treat an unknown kind as unknown are unaffected |
| event union | current members | adds the five `comment.*` events | exhaustive switches need a case |

## Removed or deprecated

None.

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| CLI | `indaba comment`, `indaba comments` | new commands |
| server resources | read and write of comments, `Origin` required on writes as for the other writes | new |
| events | `comment.added`, `.edited`, `.withdrawn`, `.delivered`, `.answered` | new |
| span attributes | `indaba.comments.count`, `.delivered`, `.answered` | new |
| workflow field | none | unchanged |

## Defaults introduced or changed

| Option | Old default | New default |
| :--- | :--- | :--- |
| comment text length | (none) | 2,000 characters |
| comments per send-back | (none) | 50 |
