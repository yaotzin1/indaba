/**
 * The keys of Home. One table: the key line, the `?` overlay and the documentation are all made from it, and a test fails
 * when they differ (specs/tui-home, AC-03). A key whose feature has not shipped is not in the table at all.
 */
export interface KeyDef {
  readonly id: 'up' | 'down' | 'open' | 'new' | 'stop' | 'refresh' | 'help' | 'quit';
  /** As shown to the person. ASCII only, so it reads on any terminal. */
  readonly keys: string;
  readonly label: string;
  /** The key exists only when the caller supplied this option (a view that is not wired is absent, never empty). */
  readonly needs?: 'openRun' | 'runs';
}

export const KEYS: readonly KeyDef[] = [
  { id: 'up', keys: 'Up k', label: 'previous run' },
  { id: 'down', keys: 'Down j', label: 'next run' },
  { id: 'open', keys: 'Enter', label: 'open the run', needs: 'openRun' },
  { id: 'new', keys: 'n', label: 'start a workflow', needs: 'runs' },
  { id: 'stop', keys: 's', label: 'stop a run started here', needs: 'runs' },
  { id: 'refresh', keys: 'r', label: 'refresh the list' },
  { id: 'help', keys: '?', label: 'show or hide this help' },
  { id: 'quit', keys: 'q', label: 'quit' },
];

/** The keys that work now, given what the caller wired. */
export function shippedKeys(available: {
  readonly openRun: boolean;
  readonly runs?: boolean;
}): readonly KeyDef[] {
  return KEYS.filter((key) => key.needs === undefined || available[key.needs] === true);
}
