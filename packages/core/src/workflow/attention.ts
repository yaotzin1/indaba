/**
 * One line of "what needs a person's attention". Readiness (specs/run-readiness) produces the first kinds; handover
 * (specs/run-handover) reuses the type for `finding` and `manual-check`. An item carries names and states, never a value.
 */
export type AttentionKind =
  | 'runner'
  | 'secret'
  | 'input'
  | 'artifact'
  | 'workspace'
  | 'permission'
  | 'tool'
  | 'file'
  | 'env'
  | 'account'
  | 'decision'
  | 'asset'
  | 'finding'
  | 'manual-check';

export type AttentionState = 'ready' | 'missing' | 'needs-confirmation' | 'confirmed' | 'unknown';

export interface AttentionItem {
  /** `<kind>:<stepId or ->:<name>`: stable, so a confirmation survives a new computation. */
  readonly id: string;
  readonly kind: AttentionKind;
  readonly state: AttentionState;
  /** The run would probably fail without it. It orders the list and marks the item; it never blocks a start. */
  readonly critical: boolean;
  readonly stepId?: string;
  /** Plain words. */
  readonly message: string;
  /** One sentence on how to fix it, when known. */
  readonly how?: string;
}
