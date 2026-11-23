import { type AttentionItem, describeAttention, type ReadinessReport } from '@indaba/engine';

export { describeAttention };

/**
 * The report as text for `plan` and `run`: what is not ready first, in the report's order, and the ready items as one
 * count (AC-13, AC-14). Empty when the report has no item, or, with `onlyWhenOpen`, nothing to look at (a run with
 * nothing to flag prints exactly what it always did).
 */
export function readinessLines(report: ReadinessReport, onlyWhenOpen = false): readonly string[] {
  if (report.items.length === 0) {
    return [];
  }
  const isDone = (item: AttentionItem): boolean => item.state === 'ready' || item.state === 'confirmed';
  const ready = report.items.filter(isDone);
  const open = report.items.filter((item) => !isDone(item));
  if (onlyWhenOpen && open.length === 0) {
    return [];
  }
  const lines = [`readiness: ${ready.length} ready, ${open.length} to look at`];
  for (const item of open) {
    lines.push(`  ${describeAttention(item)}`);
  }
  return lines;
}
