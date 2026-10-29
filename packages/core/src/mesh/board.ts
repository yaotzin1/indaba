import type { Clock } from '../support/index.js';

/** What an entry is. Closed set. */
export const BoardKind = {
  Note: 'note',
  Question: 'question',
  Result: 'result',
  Fact: 'fact',
  Proposal: 'proposal',
  Critique: 'critique',
  Agreement: 'agreement',
  ToolIntent: 'tool_intent',
  Decision: 'decision',
} as const;
export type BoardKind = (typeof BoardKind)[keyof typeof BoardKind];

/** The kinds an agent may post in its reply. The others are posted by the engine only. */
export const AGENT_POSTABLE_KINDS: readonly BoardKind[] = [
  BoardKind.Note,
  BoardKind.Question,
  BoardKind.Result,
  BoardKind.Fact,
];

/** What a step reads when its `board.read` names no kinds: the debate kinds are long, so they are left out. */
export const DEFAULT_READ_KINDS: readonly BoardKind[] = [
  BoardKind.Note,
  BoardKind.Question,
  BoardKind.Result,
  BoardKind.Fact,
  BoardKind.Decision,
];

export type BoardSource = 'agent' | 'engine';
export type SettleOutcome = 'accepted' | 'discarded' | 'superseded';
export type EntryState = 'pending' | SettleOutcome;

export interface BoardLimits {
  /** Longest text of one entry; longer text is cut and marked. */
  readonly maxEntryChars: number;
  /** Most posts taken from one reply. */
  readonly maxPostsPerReply: number;
  /** Most entries in a run. */
  readonly maxEntries: number;
  /** Most characters of entry text in a run. */
  readonly maxChars: number;
}

/** Design choices, not measurements (spec C-08): the first real runs decide whether they move. */
export const DEFAULT_BOARD_LIMITS: BoardLimits = {
  maxEntryChars: 2000,
  maxPostsPerReply: 10,
  maxEntries: 2000,
  maxChars: 1_048_576,
};

/** One post. `seq` is its identity and its only ordering. Text is one clean, redacted line. */
export interface BoardEntry {
  readonly seq: number;
  readonly at: string;
  readonly stepId: string;
  readonly attempt: number;
  readonly scope: string;
  readonly source: BoardSource;
  readonly sender: string;
  readonly kind: BoardKind;
  readonly key?: string;
  readonly round?: number;
  readonly text: string;
  readonly cut: boolean;
}

export interface BoardStartRecord {
  readonly type: 'board';
  readonly v: 1;
  readonly at: string;
  readonly traceId: string;
  readonly workflow: string;
}
export interface BoardPostRecord extends BoardEntry {
  readonly type: 'post';
}
export interface BoardSettlementRecord {
  readonly type: 'settle';
  readonly seq: number;
  readonly at: string;
  readonly stepId: string;
  readonly attempt: number;
  readonly scope: string;
  readonly outcome: SettleOutcome;
  readonly reason?: string;
}
/** Written once, when the entry or character allowance ran out. No `post` follows it. */
export interface BoardTruncatedRecord {
  readonly type: 'truncated';
  readonly seq: number;
  readonly at: string;
  readonly reason: 'entries' | 'chars';
}
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
  readonly stepId: string;
  readonly attempt: number;
  /** Default `step`. */
  readonly scope?: string;
  readonly source: BoardSource;
  readonly sender: string;
  readonly kind: BoardKind;
  readonly key?: string;
  readonly round?: number;
  readonly text: string;
}

export interface SettleInput {
  readonly stepId: string;
  readonly attempt: number;
  readonly scope?: string;
  readonly outcome: SettleOutcome;
  readonly reason?: string;
}

export interface BoardView {
  readonly steps?: readonly string[];
  readonly kinds?: readonly BoardKind[];
  readonly senders?: readonly string[];
  /** Default `['accepted']`. */
  readonly states?: readonly EntryState[];
  readonly excludeStep?: string;
}

/** The syntax of a fact key (spec C-04). */
export const BOARD_KEY_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const STEP_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const SCOPE_PATTERN = /^(?:step|variant:[0-9]{1,6})$/;
const MAX_SENDER_CHARS = 100;
const MAX_REASON_CHARS = 300;
const SUPERSEDE_REASON = 'a retry reset this step';

const KINDS: readonly string[] = Object.values(BoardKind);

export function isBoardKind(value: string): value is BoardKind {
  return KINDS.includes(value);
}

/** One clean line: newlines and tabs become a space, other control characters go, runs of spaces collapse. */
export function cleanBoardText(text: string): string {
  let out = '';
  let lastSpace = true;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const spacing =
      code === 0x0a || code === 0x0d || code === 0x09 || code === 0x20 || code === 0x2028 || code === 0x2029;
    if (spacing) {
      if (!lastSpace) {
        out += ' ';
        lastSpace = true;
      }
      continue;
    }
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      continue;
    }
    out += ch;
    lastSpace = false;
  }
  return out.endsWith(' ') ? out.slice(0, -1) : out;
}

/** Cuts to at most `max` UTF-16 units without leaving half a surrogate pair. */
function cutText(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  const end = max > 0 && isHighSurrogate(text.charCodeAt(max - 1)) ? max - 1 : max;
  return text.slice(0, end);
}

function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function groupKey(stepId: string, attempt: number, scope: string): string {
  return `${stepId}\u0000${attempt}\u0000${scope}`;
}

/** The run's board. Append-only; no I/O; no clock of its own; no environment. */
export class RunBoard {
  private readonly limits: BoardLimits;
  private readonly clock: Clock;
  private readonly redact: ((text: string) => string) | undefined;
  private sink: ((record: BoardRecord) => void) | undefined;
  private readonly log: BoardRecord[] = [];
  private readonly posts: BoardEntry[] = [];
  private readonly states = new Map<number, EntryState>();
  private readonly groups = new Map<string, BoardEntry[]>();
  private seq = 0;
  private chars = 0;
  private full = false;

  constructor(options: RunBoardOptions) {
    this.limits = { ...DEFAULT_BOARD_LIMITS, ...options.limits };
    this.clock = options.clock;
    this.redact = options.redact;
    this.sink = options.sink;
    this.record({
      type: 'board',
      v: 1,
      at: this.now(),
      traceId: options.traceId,
      workflow: options.workflow,
    });
  }

  /** Cleans (one line, no control characters), redacts, cuts, numbers and records. Undefined once the board is full or the input is refused. */
  post(input: BoardPostInput): BoardEntry | undefined {
    const scope = input.scope ?? 'step';
    if (!this.acceptsIdentity(input, scope) || !isBoardKind(input.kind)) {
      return undefined;
    }
    const key = input.kind === BoardKind.Fact ? input.key : undefined;
    if (input.kind === BoardKind.Fact && (key === undefined || !BOARD_KEY_PATTERN.test(key))) {
      return undefined;
    }
    if (this.full) {
      return undefined;
    }
    const redacted = this.redacted(cleanBoardText(input.text));
    const redactedSender = this.redacted(cleanBoardText(input.sender));
    if (redacted === undefined || redactedSender === undefined || redacted === '' || redactedSender === '') {
      return undefined;
    }
    const sender = cutText(redactedSender, MAX_SENDER_CHARS);
    const cut = redacted.length > this.limits.maxEntryChars;
    const text = cutText(redacted, this.limits.maxEntryChars);
    if (this.posts.length >= this.limits.maxEntries) {
      this.truncate('entries');
      return undefined;
    }
    if (this.chars + text.length > this.limits.maxChars) {
      this.truncate('chars');
      return undefined;
    }
    const entry: BoardEntry = {
      seq: this.nextSeq(),
      at: this.now(),
      stepId: input.stepId,
      attempt: input.attempt,
      scope,
      source: input.source,
      sender,
      kind: input.kind,
      ...(key === undefined ? {} : { key }),
      ...(input.round === undefined ? {} : { round: input.round }),
      text,
      cut,
    };
    this.record({ type: 'post', ...entry });
    return entry;
  }

  /** Settles every pending entry of the step attempt and scope that was posted before this call. */
  settle(input: SettleInput): void {
    const scope = input.scope ?? 'step';
    const group = this.groups.get(groupKey(input.stepId, input.attempt, scope));
    if (group === undefined || !group.some((e) => this.stateOf(e) === 'pending')) {
      return;
    }
    this.recordSettlement(input.stepId, input.attempt, scope, input.outcome, input.reason);
  }

  /** Settles as `superseded` the accepted entries of each listed step: one record per accepted (step, attempt, scope). */
  supersede(stepIds: readonly string[]): void {
    for (const stepId of stepIds) {
      const seen = new Set<string>();
      for (const entry of this.posts) {
        if (entry.stepId !== stepId || this.stateOf(entry) !== 'accepted') {
          continue;
        }
        const id = groupKey(entry.stepId, entry.attempt, entry.scope);
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        this.recordSettlement(entry.stepId, entry.attempt, entry.scope, 'superseded', SUPERSEDE_REASON);
      }
    }
  }

  /** The latest settlement that follows the entry, else pending. */
  stateOf(entry: BoardEntry): EntryState {
    return this.states.get(entry.seq) ?? 'pending';
  }

  /** In `seq` order. By default only the accepted entries. */
  entries(view: BoardView = {}): readonly BoardEntry[] {
    const states = view.states ?? ['accepted'];
    return this.posts.filter(
      (e) =>
        states.includes(this.stateOf(e)) &&
        (view.steps === undefined || view.steps.includes(e.stepId)) &&
        (view.kinds === undefined || view.kinds.includes(e.kind)) &&
        (view.senders === undefined || view.senders.includes(e.sender)) &&
        e.stepId !== view.excludeStep,
    );
  }

  /** The accepted facts, the entry with the highest `seq` per key winning; ordered by key. */
  facts(view: Pick<BoardView, 'steps'> = {}): ReadonlyMap<string, BoardEntry> {
    const latest = new Map<string, BoardEntry>();
    for (const entry of this.entries({ ...view, kinds: [BoardKind.Fact] })) {
      if (entry.key !== undefined) {
        latest.set(entry.key, entry);
      }
    }
    return new Map([...latest].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  }

  records(): readonly BoardRecord[] {
    return this.log;
  }

  isFull(): boolean {
    return this.full;
  }

  /** Rebuilds a board from a file's records; the next `seq` continues after the last one. Writes no second start record. */
  static replay(records: readonly BoardRecord[], options: RunBoardOptions): RunBoard {
    const board = new RunBoard({ ...options, sink: () => undefined });
    const start = records.find((r) => r.type === 'board');
    board.log.length = 0;
    board.log.push(
      start ?? { type: 'board', v: 1, at: board.now(), traceId: options.traceId, workflow: options.workflow },
    );
    for (const record of records) {
      if (record.type !== 'board') {
        board.log.push(record);
      }
      board.apply(record);
    }
    board.sink = options.sink;
    return board;
  }

  private acceptsIdentity(input: BoardPostInput, scope: string): boolean {
    return (
      STEP_ID_PATTERN.test(input.stepId) &&
      SCOPE_PATTERN.test(scope) &&
      Number.isInteger(input.attempt) &&
      input.attempt >= 1 &&
      (input.round === undefined || (Number.isInteger(input.round) && input.round >= 1)) &&
      (input.source === 'agent' || input.source === 'engine')
    );
  }

  /** Redaction that throws stores nothing: the caller sees `undefined`. */
  private redacted(text: string): string | undefined {
    if (this.redact === undefined) {
      return text;
    }
    try {
      return cleanBoardText(this.redact(text));
    } catch {
      return undefined;
    }
  }

  private recordSettlement(
    stepId: string,
    attempt: number,
    scope: string,
    outcome: SettleOutcome,
    reason: string | undefined,
  ): void {
    const cleaned = reason === undefined ? undefined : this.redacted(cleanBoardText(reason));
    this.record({
      type: 'settle',
      seq: this.nextSeq(),
      at: this.now(),
      stepId,
      attempt,
      scope,
      outcome,
      ...(cleaned === undefined || cleaned === '' ? {} : { reason: cutText(cleaned, MAX_REASON_CHARS) }),
    });
  }

  private truncate(reason: 'entries' | 'chars'): void {
    this.full = true;
    this.record({ type: 'truncated', seq: this.nextSeq(), at: this.now(), reason });
  }

  private nextSeq(): number {
    return this.seq + 1;
  }

  private now(): string {
    return this.clock.now().toISOString();
  }

  /** Every record, made or replayed, goes through here, so state has one source: the list of records. */
  private record(record: BoardRecord): void {
    this.log.push(record);
    this.apply(record);
    if (this.sink !== undefined) {
      try {
        this.sink(record);
      } catch {
        // A listener fails alone; the board is what the digests are built from.
      }
    }
  }

  private apply(record: BoardRecord): void {
    switch (record.type) {
      case 'board':
        return;
      case 'post': {
        this.seq = Math.max(this.seq, record.seq);
        const entry: BoardEntry = {
          seq: record.seq,
          at: record.at,
          stepId: record.stepId,
          attempt: record.attempt,
          scope: record.scope,
          source: record.source,
          sender: record.sender,
          kind: record.kind,
          ...(record.key === undefined ? {} : { key: record.key }),
          ...(record.round === undefined ? {} : { round: record.round }),
          text: record.text,
          cut: record.cut,
        };
        this.posts.push(entry);
        this.states.set(entry.seq, 'pending');
        this.chars += entry.text.length;
        const id = groupKey(entry.stepId, entry.attempt, entry.scope);
        const group = this.groups.get(id);
        if (group === undefined) {
          this.groups.set(id, [entry]);
        } else {
          group.push(entry);
        }
        return;
      }
      case 'settle': {
        this.seq = Math.max(this.seq, record.seq);
        const group = this.groups.get(groupKey(record.stepId, record.attempt, record.scope)) ?? [];
        for (const entry of group) {
          const state = this.states.get(entry.seq);
          const applies = record.outcome === 'superseded' ? state === 'accepted' : state === 'pending';
          if (entry.seq < record.seq && applies) {
            this.states.set(entry.seq, record.outcome);
          }
        }
        return;
      }
      case 'truncated':
        this.seq = Math.max(this.seq, record.seq);
        this.full = true;
        return;
    }
  }
}
