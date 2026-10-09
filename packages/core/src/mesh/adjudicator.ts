import { IndabaError } from '../errors/index.js';
import type { ConsensusOutcome } from './consensus.js';
import type { AgentMessage } from './message.js';

export const Verdict = {
  Accept: 'accept',
  Reject: 'reject',
} as const;
export type Verdict = (typeof Verdict)[keyof typeof Verdict];

/** Where a ruling came from: someone was asked, or the decision ledger already held it. */
export const RulingSource = {
  Asked: 'asked',
  Memo: 'memo',
} as const;
export type RulingSource = (typeof RulingSource)[keyof typeof RulingSource];

/** A decision on a debate that failed, with the reason the decider gave. */
export class Ruling {
  constructor(
    readonly verdict: Verdict,
    readonly note: string,
    readonly source: RulingSource = RulingSource.Asked,
  ) {}

  accepted(): boolean {
    return this.verdict === Verdict.Accept;
  }
}

/** What an adjudicator is shown: the question and how the debate went. */
export interface RulingRequest {
  readonly stepId: string;
  readonly topic: string;
  readonly outcome: ConsensusOutcome;
  readonly rounds: number;
  readonly transcript: readonly AgentMessage[];
}

/** Settles a debate that ended without consensus. Add one by registering it from a plugin. */
export interface Adjudicator {
  /** A `Ruling`, or `null` when it cannot answer; the step then escalates as it always has. */
  rule(request: RulingRequest, signal?: AbortSignal): Promise<Ruling | null>;
}

/** The adjudicators a workflow's `arbiter` field can name. */
export class AdjudicatorRegistry {
  private readonly byName = new Map<string, Adjudicator>();

  register(name: string, adjudicator: Adjudicator): void {
    if (name === '') {
      throw new IndabaError('An adjudicator needs a name.');
    }
    if (this.byName.has(name)) {
      throw new IndabaError(`An adjudicator named "${name}" is already registered.`);
    }
    this.byName.set(name, adjudicator);
  }

  get(name: string): Adjudicator | undefined {
    return this.byName.get(name);
  }

  names(): readonly string[] {
    return [...this.byName.keys()];
  }
}
