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

const STATE_WORDS: Readonly<Record<AttentionState, string>> = {
  ready: 'ready',
  missing: 'missing',
  'needs-confirmation': 'needs your confirmation',
  confirmed: 'confirmed',
  unknown: 'could not be checked',
};

/** Workflow text reaches a terminal: control characters (escape sequences) become spaces (specs/run-readiness, section 6). */
export function plainText(text: string): string {
  return [...text]
    .map((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || (code >= 127 && code <= 159) ? ' ' : char;
    })
    .join('');
}

/** One line for an item in plain words, the same in every view (specs/run-readiness, AC-11). */
export function describeAttention(
  item: Pick<AttentionItem, 'state' | 'critical' | 'message' | 'how'>,
): string {
  const mark = item.critical && item.state === 'missing' ? 'CRITICAL ' : '';
  const how = item.how === undefined || item.how === '' ? '' : ` How: ${plainText(item.how)}`;
  return `${mark}${STATE_WORDS[item.state]}: ${plainText(item.message)}.${how}`;
}
