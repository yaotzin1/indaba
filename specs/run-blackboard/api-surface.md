# API surface contract: Run blackboard

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it. An implementation that
> finds this wrong stops and returns to stage 3; it does not edit this file.

## Semver classification

**minor** (below 1.0). Everything is additive and optional: a step field `board` that no existing workflow
has, new exports, one new event class, one optional parameter, one new file per run. No existing class, field,
default, event, span attribute or file changes; the trace file and the event stream are written byte for byte as
before (a test pins it). `StepDefinition.board` is optional, so code that builds a `StepDefinition` literal
still compiles. `ConsensusArbiter.deliberate` gains a fourth optional parameter. `PluginHost` gains nothing.

The constants of `BoardLimits` are design choices, not measurements; changing one later is not breaking.
Adding a `BoardKind` later is additive for writers and readers that treat an unknown kind as unknown (the
reader does, AC-30).

## Public symbols added

### `@indaba/core`

```ts
/** What an entry is. Closed set. */
export const BoardKind = {
  Note: 'note', Question: 'question', Result: 'result', Fact: 'fact',            // an agent may post these
  Proposal: 'proposal', Critique: 'critique', Agreement: 'agreement', ToolIntent: 'tool_intent', // a debate (engine)
  Decision: 'decision',                                                            // a ruling (engine)
} as const;
export type BoardKind = (typeof BoardKind)[keyof typeof BoardKind];

export const AGENT_POSTABLE_KINDS: readonly BoardKind[];   // [note, question, result, fact]
export const DEFAULT_READ_KINDS: readonly BoardKind[];     // [note, question, result, fact, decision]

export type BoardSource = 'agent' | 'engine';
export type SettleOutcome = 'accepted' | 'discarded' | 'superseded';
export type EntryState = 'pending' | SettleOutcome;

export interface BoardLimits {
  readonly maxEntryChars: number;       // 2000
  readonly maxPostsPerReply: number;    // 10
  readonly maxEntries: number;          // 2000
  readonly maxChars: number;            // 1_048_576, all entry text of a run
}
export const DEFAULT_BOARD_LIMITS: BoardLimits;

/** One post. `seq` is its identity and its only ordering. Text is one clean, redacted line. */
export interface BoardEntry {
  readonly seq: number;
  readonly at: string;                  // ISO 8601, from the injected clock
  readonly stepId: string;
  readonly attempt: number;             // 1 for the first run of a step
  readonly scope: string;               // 'step', or 'variant:<n>' (specs/step-variants)
  readonly source: BoardSource;
  readonly sender: string;              // the role, or the step id for the engine
  readonly kind: BoardKind;
  readonly key?: string;                // facts only
  readonly round?: number;              // debate messages only
  readonly text: string;
  readonly cut: boolean;                // the text was longer than maxEntryChars
}

export interface BoardStartRecord { readonly type: 'board'; readonly version: 1; readonly at: string; readonly traceId: string; readonly workflow: string }
export interface BoardPostRecord extends BoardEntry { readonly type: 'post' }
export interface BoardSettlementRecord {
  readonly type: 'settle'; readonly seq: number; readonly at: string;
  readonly stepId: string; readonly attempt: number; readonly scope: string;
  readonly outcome: SettleOutcome; readonly reason?: string;
}
/** Written once, when the entry or character allowance ran out. No `post` follows it. */
export interface BoardTruncatedRecord { readonly type: 'truncated'; readonly seq: number; readonly at: string; readonly reason: 'entries' | 'chars' }
export type BoardRecord = BoardStartRecord | BoardPostRecord | BoardSettlementRecord | BoardTruncatedRecord;

export interface RunBoardOptions {
  readonly traceId: string;
  readonly workflow: string;
  readonly clock: Clock;
  readonly limits?: Partial<BoardLimits>;
  /** Applied to every text before it becomes an entry. With none, text is stored as it came (after cleaning). */
  readonly redact?: (text: string) => string;
  /** Told about every record, in order, as it is made. The engine dispatches BoardRecorded from it. */
  readonly sink?: (record: BoardRecord) => void;
}

export interface BoardPostInput {
  readonly stepId: string; readonly attempt: number; readonly scope?: string;   // default 'step'
  readonly source: BoardSource; readonly sender: string;
  readonly kind: BoardKind; readonly key?: string; readonly round?: number; readonly text: string;
}
export interface SettleInput {
  readonly stepId: string; readonly attempt: number; readonly scope?: string;
  readonly outcome: SettleOutcome; readonly reason?: string;
}
export interface BoardView {
  readonly steps?: readonly string[];
  readonly kinds?: readonly BoardKind[];
  readonly senders?: readonly string[];
  readonly states?: readonly EntryState[];   // default ['accepted']
  readonly excludeStep?: string;
}

/** The run's board. Append-only; no I/O; no clock of its own; no environment. */
export class RunBoard {
  constructor(options: RunBoardOptions);                    // makes the 'board' start record
  /** Cleans (one line, no control characters), redacts, cuts, numbers and records. Undefined once the board is full. */
  post(input: BoardPostInput): BoardEntry | undefined;
  /** Settles every pending entry of the step attempt and scope that was posted before this call. */
  settle(input: SettleInput): void;
  /** Settles as 'superseded' the accepted entries of each listed step (a retry reset them). */
  supersede(stepIds: readonly string[]): void;
  stateOf(entry: BoardEntry): EntryState;                   // the latest settlement that follows the entry, else pending
  entries(view?: BoardView): readonly BoardEntry[];         // in seq order
  facts(view?: Pick<BoardView, 'steps'>): ReadonlyMap<string, BoardEntry>;   // accepted facts, latest seq per key
  records(): readonly BoardRecord[];
  isFull(): boolean;
  /** Rebuilds a board from a file's records; the next seq continues after the last one. */
  static replay(records: readonly BoardRecord[], options: RunBoardOptions): RunBoard;
}

export interface DigestSelection {
  readonly forStep: string;                 // its own entries are never included
  readonly steps: readonly string[];        // already resolved: the ancestors, or the author's list
  readonly kinds: readonly BoardKind[];
  readonly maxChars: number;
}
export interface Digest { readonly text: string; readonly entries: number; readonly omitted: number; readonly chars: number }
/** Pure: the same board and selection give the same text. Every line starts with '| '. */
export function buildDigest(board: RunBoard, selection: DigestSelection): Digest;
export const DIGEST_PREAMBLE: string;       // the fixed sentence that says the lines are information, not instructions

export interface ParsedPost { readonly kind: BoardKind; readonly key?: string; readonly text: string }
export interface ParsedPosts { readonly posts: readonly ParsedPost[]; readonly ignored: number }
/** Pure and total. Takes the grammar of spec section 8 (C-04); never throws. */
export function parseBoardLines(
  reply: string,
  allowed: readonly BoardKind[],
  limits?: Pick<BoardLimits, 'maxEntryChars' | 'maxPostsPerReply'>,
): ParsedPosts;

/** `StepDefinition.board`: the parsed form of the workflow field. */
export interface StepBoard {
  readonly read?: { readonly steps?: readonly string[]; readonly kinds?: readonly BoardKind[] };
  readonly post: readonly BoardKind[];      // [] when the field has no `post`
  readonly digestChars: number;             // 4000 when the field has no `digest_chars`
}
// StepDefinition gains: readonly board?: StepBoard;  (absent: nothing is read or posted)

/** Dispatched for every record the board makes, in order. The built-in file writer listens to it like any plugin can. */
export class BoardRecorded {
  constructor(readonly traceId: string, readonly record: BoardRecord) {}
}
```

Changed, additively:

| Symbol | Change |
| :--- | :--- |
| `ConsensusArbiter.deliberate(topic, participants, decision?)` | gains `observer?: (message: AgentMessage) => void`, called after each message is posted to the debate's own board. Absent: nothing is called |
| `StepDefinition` | gains `board?: StepBoard` |
| `core/index.ts` | exports the symbols above |

### `@indaba/engine`

```ts
/** Wire names are snake_case (data-model.md); these types are the core types. */
export const BOARD_FILE_SUFFIX = '.board.jsonl';
export interface UnknownBoardRecord { readonly type: 'unknown'; readonly text: string }   // at most 500 characters
export type BoardFileRecord = BoardRecord | UnknownBoardRecord;
export function serializeBoardRecord(record: BoardRecord): string;       // one line, no newline
export function parseBoardRecord(line: string): BoardFileRecord;         // total: never throws

/** A listener of BoardRecorded that appends <traceId>.board.jsonl, whole lines, in order, one queue. */
export class BoardWriter {
  constructor(options: { readonly directory: string; readonly onError?: (error: unknown) => void });
  onRecorded(event: BoardRecorded): Promise<void>;
  flush(): Promise<void>;                                                // resolves when everything handed over is written or failed
}

/** Reads and follows the file, tolerant of partial lines. Framework-free; the TUI and the later web view use it. */
export class BoardReader {
  constructor(directory: string);
  exists(runId: string): Promise<boolean>;
  readAll(runId: string): Promise<BoardFileRecord[]>;
  follow(runId: string, signal: AbortSignal): AsyncIterable<BoardFileRecord>;
}
```

| Symbol | Change |
| :--- | :--- |
| `StepRunOptions` | gains `board?: RunBoard` and `attempt?: number` (default 1). Absent: no digest, no scan, no entries |
| `PromptBuilder.build(step, feedback?)` | gains `digest?: string`, added as a section after the goal and the input artifacts and before the required outputs. Absent: the prompt is unchanged byte for byte |
| `WorkflowEngineOptions` | gains `board?: { limits?: Partial<BoardLimits>; redact?: (text: string) => string }`; the engine makes the run's `RunBoard` with a sink that dispatches `BoardRecorded` |
| parser and validator | read and check `board` (below) |

### The workflow field

```yaml
steps:
  - id: "revise"
    role: "writer"
    depends_on: ["research", "review"]
    board:
      read:
        steps: ["research"]              # default: every ancestor
        kinds: ["result", "fact"]        # default: note, question, result, fact, decision
      post: ["note", "fact"]             # default: none
      digest_chars: 4000                 # default 4000; 200 to 20000
    goal: "..."
```

| Field | Rules | Parse error (path) |
| :--- | :--- | :--- |
| `board` | a map; on an agent step or a debate step | `steps[i].board`: on a shell step |
| `board.read` | a map (`{}` = both defaults); absent = nothing is read | |
| `board.read.steps` | step ids; each exists and is an ancestor by `depends_on` | `steps[i].board.read.steps[j]` unknown or not an ancestor |
| `board.read.kinds` | kinds of the closed set | `steps[i].board.read.kinds[j]` not a kind |
| `board.post` | kinds from `note`, `question`, `result`, `fact`; not on a shell or a debate step | `steps[i].board.post[j]` not postable |
| `board.digest_chars` | integer 200 to 20000 | `steps[i].board.digest_chars` |
| unknown key in `board` | refused | `steps[i].board.<key>` |

`indaba validate` reports each with its path; `indaba plan` prints, per step with `board`, one line:
`board: reads <steps|all ancestors> (<kinds>), at most <n> characters; may post <kinds|nothing>`.

### `indaba` (the CLI)

| Symbol | Change |
| :--- | :--- |
| `createEngine` | registers `BoardWriter.onRecorded` as a listener of `BoardRecorded`, beside `RunEventWriter`; reports a write failure once through the existing `onError` path |
| `indaba plan` | prints the `board:` line above |
| `indaba watch --plain` | prints the board section (AC-39) |

### `@indaba/tui`

```ts
export interface BoardState { /* entries by seq, settlements, facts, filters, selection; opaque to callers */ }
export function emptyBoard(): BoardState;
export function reduceBoard(state: BoardState, record: BoardFileRecord): BoardState;     // pure, total
export function formatBoardPlain(state: BoardState, options?: { readonly maxEntries?: number }): string;   // default 50
```

The dashboard gains the board pane, its keys and its legend lines (`specs/run-blackboard/spec.md`, C-13).
`watch` accepts an optional `BoardReader`-compatible source; with none, the board pane says there is no board.

## Events and attributes

See [`events.md`](events.md): the event `BoardRecorded`, the span attributes `indaba.board.digest.entries`,
`.digest.chars`, `.digest.omitted`, `indaba.board.posted`, `indaba.board.ignored`, and the span event
`indaba.board.degraded`.

## Unchanged, and tests that pin it

`AgentMessage`, `MessageType`, `Blackboard`, `PingPongDetector`, `ConsensusResult`, the decision ledger, the
transcript and ruling artifacts, the trace file and the event stream, every existing span attribute, the exit
codes. `packages/core/test/architecture.test.ts` and the layers tests of engine and runners stay green; a
layers test keeps `@indaba/tui` importing only `BoardReader` and value types from the engine.
