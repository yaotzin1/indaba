import type { Runner } from '../runner/index.js';

/**
 * Implemented by a runner that can tell when an attempt has gone quiet (specs/step-stalls, AC-05). When
 * `RunRequest.stallSeconds` is set, such a runner stops the attempt after that many seconds without activity and returns a
 * result with `stalled: true`. What counts as activity is the runner's own, and is stated in its documentation.
 *
 * `canReportActivity` is a boolean and not a constant because it can depend on how the runner is configured: `claude-code`
 * reads its activity from a stream, and in its plain-output mode nothing arrives before the end, so it answers `false`
 * there and `validate` refuses `stall` on it (C-17).
 */
export interface StallCapable {
  readonly canReportActivity: boolean;
}

/** True only for a runner that says, with the value `true`, that it can report activity. A plugin written before this existed is not. */
export function isStallCapable(runner: Runner): runner is Runner & StallCapable {
  return 'canReportActivity' in runner && runner.canReportActivity === true;
}
