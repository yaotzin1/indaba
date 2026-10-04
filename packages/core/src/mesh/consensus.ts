import { IndabaError } from '../errors/index.js';
import { DecisionType } from '../workflow/model.js';
import { Blackboard } from './blackboard.js';
import { type AgentMessage, MessageType } from './message.js';

export const ConsensusOutcome = {
  Reached: 'reached',
  /** The same positions were repeated: more rounds would not help. */
  Stalled: 'stalled',
  MaxRoundsExceeded: 'max_rounds_exceeded',
} as const;
export type ConsensusOutcome = (typeof ConsensusOutcome)[keyof typeof ConsensusOutcome];

export interface Participant {
  /** The role name this participant speaks for, e.g. "architect". */
  readonly role: string;
  respond(topic: string, board: Blackboard, round: number): Promise<AgentMessage>;
}

export class ConsensusResult {
  constructor(
    readonly outcome: ConsensusOutcome,
    readonly rounds: number,
    readonly transcript: readonly AgentMessage[],
  ) {}

  reached(): boolean {
    return this.outcome === ConsensusOutcome.Reached;
  }

  /** The most recent non-agreement message of each participant: what is still unresolved. */
  openObjections(): string {
    const latest = new Map<string, AgentMessage>();
    for (const m of this.transcript) {
      latest.set(m.sender, m);
    }
    return [...latest.values()]
      .filter((m) => m.type !== MessageType.Agreement)
      .map((m) => `${m.sender} (${m.type}): ${m.content}`)
      .join('\n');
  }
}

/**
 * Detects a debate that has stopped making progress: with N participants, the last N
 * messages repeat the N before them verbatim (modulo whitespace and case).
 */
export class PingPongDetector {
  isStalled(messages: readonly AgentMessage[], participants: number): boolean {
    if (participants < 1 || messages.length < 2 * participants) {
      return false;
    }
    const recent = messages.slice(-2 * participants);
    for (let i = 0; i < participants; i += 1) {
      if (recent[i]?.fingerprint() !== recent[i + participants]?.fingerprint()) {
        return false;
      }
    }
    return true;
  }
}

export interface ConsensusArbiterOptions {
  readonly maxRounds?: number;
  readonly pingPong?: PingPongDetector;
}

/**
 * Runs rounds of structured debate until the quorum is met, the debate stalls or the
 * round budget is spent. Participants take turns in the order given; quorum is evaluated
 * once per full round over each participant's latest message.
 */
export class ConsensusArbiter {
  private readonly maxRounds: number;
  private readonly pingPong: PingPongDetector;

  constructor(options: ConsensusArbiterOptions = {}) {
    this.maxRounds = options.maxRounds ?? 4;
    this.pingPong = options.pingPong ?? new PingPongDetector();
  }

  async deliberate(
    topic: string,
    participants: readonly Participant[],
    decision: DecisionType = DecisionType.Consensus,
  ): Promise<ConsensusResult> {
    if (participants.length === 0) {
      throw new IndabaError('A consensus needs at least one participant.');
    }

    const board = new Blackboard();
    for (let round = 1; round <= this.maxRounds; round += 1) {
      for (const participant of participants) {
        board.post(await participant.respond(topic, board, round));
      }
      if (this.quorumMet(board, participants, decision)) {
        return new ConsensusResult(ConsensusOutcome.Reached, round, [...board.messages()]);
      }
      if (this.pingPong.isStalled(board.messages(), participants.length)) {
        return new ConsensusResult(ConsensusOutcome.Stalled, round, [...board.messages()]);
      }
    }

    return new ConsensusResult(ConsensusOutcome.MaxRoundsExceeded, this.maxRounds, [...board.messages()]);
  }

  private quorumMet(
    board: Blackboard,
    participants: readonly Participant[],
    decision: DecisionType,
  ): boolean {
    const agreeing = participants.filter(
      (p) => board.latestBy(p.role)?.type === MessageType.Agreement,
    ).length;
    return decision === DecisionType.Consensus
      ? agreeing === participants.length
      : agreeing * 2 > participants.length;
  }
}
