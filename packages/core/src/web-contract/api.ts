/** The request and response shapes of the local web API (`specs/web-app/api-surface.md`), delivery step 1. */
import type { RunSnapshot, RunSummary } from './run.js';

/** The version of the contract between the page and the server. */
export interface ContractResponse {
  readonly contractVersion: string;
}

export interface ApiError {
  readonly code: string;
  /** Plain words a person can act on; never a secret, a path or a URL. */
  readonly message: string;
  readonly nextAction?: string;
}

export interface RunListResponse {
  readonly runs: readonly RunSummary[];
}

/** One message of a debate, as the engine kept it: redacted, with control sequences dropped. */
export interface DiscussionMessage {
  readonly round: number;
  readonly sender: string;
  /** PROPOSAL, CRITIQUE, AGREEMENT or any other type the debate used. */
  readonly type: string;
  readonly content: string;
}

/** The ruling that settled a debate which did not reach quorum. */
export interface DiscussionRuling {
  readonly verdict: string;
  readonly decidedBy: string;
  readonly note: string;
}

/** The whole discussion of one debate step of one run. */
export interface DiscussionView {
  readonly stepId: string;
  readonly outcome: string;
  readonly rounds: number;
  readonly messages: readonly DiscussionMessage[];
  readonly ruling?: DiscussionRuling;
}

export interface DiscussionResponse {
  readonly discussion: DiscussionView;
}

export interface RunResponse {
  readonly run: RunSnapshot;
}

/**
 * One event of a run's stream. The server builds the snapshot with the same reducer the terminal dashboard uses
 * and sends the whole snapshot, so a repeated or a missed event cannot corrupt the page: `id` only rises.
 */
export interface RunStreamEvent {
  readonly id: number;
  readonly run: RunSnapshot;
}

/** A run that appeared or ended, on the server-wide stream. */
export interface ServerStreamEvent {
  readonly id: number;
  readonly kind: 'run_started' | 'run_ended';
  readonly run: RunSummary;
}
