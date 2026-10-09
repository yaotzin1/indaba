# API surface contract: Ruling channel

> Builds on `specs/debate-arbiter` (`Adjudicator`, `Ruling`, `RulingRequest`, the arbiter name `human`).

## Semver classification

**minor**. A new run option with a default that keeps today's behaviour, a new command, two new event-stream
record types (readers skip unknown records), a new runtime directory. Nothing existing changes.

## Public symbols added

### `@indaba/core`

```ts
export class RulingRequested { constructor(readonly taskId: string, readonly id: string, readonly stepId: string,
                                           readonly outcome: ConsensusOutcome, readonly rounds: number) {} }
export class RulingAnswered  { constructor(readonly taskId: string, readonly id: string, readonly verdict: Verdict) {} }
```

### `@indaba/engine`

```ts
export interface RulingFile {                  // .indaba/rulings/<id>.request.json
  readonly id: string;
  readonly taskId: string;
  readonly traceId: string;
  readonly workflow: string;
  readonly stepId: string;
  readonly outcome: string;
  readonly rounds: number;
  readonly topic: string;
  readonly transcript: readonly { readonly round: number; readonly sender: string; readonly type: string; readonly content: string }[];
  readonly requestedAt: string;
  readonly pid: number;
}

export interface RulingAnswer {                // .indaba/rulings/<id>.answer.json
  readonly verdict: 'accept' | 'reject';
  readonly note?: string;                      // at most 2,000 characters
}

export function listPendingRulings(projectDir: string): Promise<readonly RulingFile[]>;
export function answerRuling(projectDir: string, id: string, answer: RulingAnswer): Promise<void>;   // IndabaError when no such pending request

export interface FileRulingAdjudicatorOptions {
  readonly projectDir: string;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly redact: (text: string) => string;
  readonly events?: EventDispatcher;
  readonly pollMs?: number;                    // default 500; injectable for tests
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}
export class FileRulingAdjudicator implements Adjudicator { constructor(options: FileRulingAdjudicatorOptions); }
```

The event stream gains the records `{ type: 'ruling_requested', at, traceId, id, stepId, outcome, rounds }` and
`{ type: 'ruling_answered', at, traceId, id, verdict }`; `RunEventWriter` gains `onRulingRequested` and
`onRulingAnswered`.

### `indaba` (CLI)

`CreateEngineOptions.humanAdjudicator` is unchanged; `main` picks the terminal or file implementation from `--rulings`.

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| workflow file | none | no change: `arbiter: human` is the same under every front end |
| CLI | `run --rulings terminal\|files\|none` | added; default `terminal` with a terminal, else `none` |
| CLI | `rule list`, `rule <id> accept\|reject [--note]`, `rule <id> show` | added |
| CLI | `run --tui` | now starts its child with `--rulings files` |
| event record | `ruling_requested`, `ruling_answered` | added |
| span attribute | `indaba.arbiter.invalid_answers` | added: count, only when above zero |
| runtime directory | `.indaba/rulings/` | added, gitignored (it is under `.indaba/`) |

## Defaults introduced

- Poll every 500 ms. No timeout. Note at most 2,000 characters; a message in a request at most 8,000. Changing any is
  a minor, except the no-timeout rule, which is a major.
- Exit codes of `indaba rule`: `0` answered or listed, `1` unknown id, `2` usage error.

## Checks

- [ ] `@indaba/core` imports no `node:` module (`architecture.test.ts`)
- [ ] `listPendingRulings` and `answerRuling` are the only code that builds a path under `.indaba/rulings/`
- [ ] The id is validated before any path is built from it (`../` test)
- [ ] `docs/workflow-format.md`, `docs/getting-started.md` (the directory, `rule`, `--rulings`), `README.md` and `CHANGELOG.md` updated
- [ ] A reader of the event stream that predates the two records still works (a test feeds it one)
- [ ] No `any`, no `!`, no suppression comment
