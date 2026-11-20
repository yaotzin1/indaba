import type { AttentionItem, ReadinessReport } from '@indaba/engine';

const STATE_WORDS: Readonly<Record<AttentionItem['state'], string>> = {
  ready: 'ready',
  missing: 'missing',
  'needs-confirmation': 'needs your confirmation',
  confirmed: 'confirmed',
  unknown: 'could not be checked',
};

/** Workflow text reaches a terminal: control characters (escape sequences) become spaces (specs/run-readiness, section 6). */
function plain(text: string): string {
  return [...text]
    .map((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || (code >= 127 && code <= 159) ? ' ' : char;
    })
    .join('');
}

/** One line for an item, in plain words (specs/run-readiness, AC-11). */
export function describeAttention(item: AttentionItem): string {
  const mark = item.critical && item.state === 'missing' ? 'CRITICAL ' : '';
  const how = item.how === undefined || item.how === '' ? '' : ` How: ${plain(item.how)}`;
  return `${mark}${STATE_WORDS[item.state]}: ${plain(item.message)}.${how}`;
}

/**
 * The report as text for `plan` and `run`: what is not ready first, in the report's order, and the ready items as one
 * count (AC-13, AC-14). Empty when the report has no item, or, with `onlyWhenOpen`, nothing to look at (a run with
 * nothing to flag prints exactly what it always did).
 */
export function readinessLines(report: ReadinessReport, onlyWhenOpen = false): readonly string[] {
  if (report.items.length === 0) {
    return [];
  }
  const ready = report.items.filter((item) => item.state === 'ready' || item.state === 'confirmed');
  const open = report.items.filter((item) => item.state !== 'ready' && item.state !== 'confirmed');
  if (onlyWhenOpen && open.length === 0) {
    return [];
  }
  const lines = [`readiness: ${ready.length} ready, ${open.length} to look at`];
  for (const item of open) {
    lines.push(`  ${describeAttention(item)}`);
  }
  return lines;
}
