import type { ReadinessReport, SpanAttributes } from '@indaba/core';

/**
 * What the run span records of a readiness report (specs/run-readiness, AC-17): two counts and, as one JSON text
 * (span attributes are scalars), the id and state of each item. An id holds a name and never a value.
 */
export function readinessAttributes(report: ReadinessReport): SpanAttributes {
  return {
    'indaba.readiness.critical_missing': report.criticalMissing,
    'indaba.readiness.needs_confirmation': report.needsConfirmation,
    'indaba.readiness.items': JSON.stringify(report.items.map((item) => [item.id, item.state])),
  };
}
