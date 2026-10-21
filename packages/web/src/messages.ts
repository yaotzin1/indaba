/**
 * Every string the page shows (AC-20). One catalogue, in English; a translation replaces this object. Functions take
 * the values a sentence needs, so word order stays a translator's choice.
 */
export const messages = {
  appName: 'Indaba',
  nav: { label: 'Main', runs: 'Runs', settings: 'Settings' },
  skipToContent: 'Skip to the content',
  readOnly: 'Read-only',
  readOnlyTitle:
    'This page never starts or changes a run; only the Settings screen writes, and only indaba.config',
  live: {
    connecting: 'Connecting',
    live: 'Live',
    reconnecting: 'Reconnecting',
    unavailable: 'Server stopped',
    ended: 'Run ended',
  },
  theme: { legend: 'Theme', system: 'System', light: 'Light', dark: 'Dark' },

  runs: {
    title: 'Runs',
    lead: 'The runs on this machine, newest first.',
    gridLabel: 'Runs on this machine',
    run: 'Run',
    workflow: 'Workflow',
    state: 'State',
    started: 'Started',
    cost: 'Cost',
    unnamed: 'unnamed',
    emptyTitle: 'No runs yet',
    emptyBody: 'Start one in a terminal and it appears here while it runs.',
    emptyCommand: 'indaba run workflow.yml',
  },

  run: {
    back: 'Runs',
    meta: (started: string, elapsed: string, id: string): string =>
      `Started ${started}, ${elapsed}, run ${id}`,
    runningFor: (duration: string): string => `running for ${duration}`,
    tookTotal: (duration: string): string => `took ${duration}`,
    graphTitle: 'Steps',
    graphHint: 'select one for details',
    graphLabel: 'The steps of this run as a graph',
    legendWaits: 'waits for',
    legendFailure: 'where a failure leads',
    legendKeys: 'Click a step, or Tab to it and press Enter.',
    structureUnknown:
      'This run was recorded before Indaba wrote down which step waits for which, so its steps are shown in the order they ran.',
    stepsTitle: 'Steps',
    stepsLabel: 'Steps of this run. Select a step to open it.',
    step: 'Step',
    time: 'Time',
    tryLabel: (n: number): string => `try ${n}`,
    costTitle: 'Cost',
    costSoFar: 'So far',
    costTotal: 'Total',
    modelCalls: 'Model calls',
    callsWithNoPrice: (n: number): string => `${n} with no price`,
    costTableLabel: 'The cost of each step that called a model',
    calls: 'Calls',
    tokens: 'Tokens',
    tokensInOut: (input: string, output: string): string => `${input} in, ${output} out`,
    callsRunning: (n: number): string => `${n} still running`,
    noModelCalls: 'No step of this run has called a model.',
    budget: 'Budget',
    noLimit: 'no limit',
    costNote:
      'A total that includes a call with no price says so. A step with no budget says no limit, never zero.',
    notFoundTitle: 'Run not found',
    notFoundBody: 'No run on this machine has this id. It may have been deleted with its trace.',
    notes: 'Records this page could not read',
  },

  step: {
    happened: 'What happened',
    happening: 'What is happening',
    willHappen: 'What will happen',
    ifFails: 'If this step fails',
    tries: 'Tries',
    output: 'Output',
    outputLive: 'live',
    outputNothing: 'Nothing yet.',
    outputCut: 'Only the last part is shown.',
    openLog: 'Open the full log',
    runner: 'Runner',
    command: 'Command',
    exitCode: 'Exit code',
    model: 'Model',
    tokens: 'Tokens in / out',
    cost: 'Cost',
    result: 'Result',
    why: 'Why',
    notReported: 'not reported',
    waitsFor: (ids: string): string => `Waits for ${ids}.`,
    waitsForNothing: 'Waits for nothing; it can run first.',
    noRunnerYet: 'No runner has started for this step yet.',
    skipped: (runner: string, reason: string): string => `Skipped ${runner}: ${reason}`,
    tools: 'Tools used',
    permissions: (allowed: number, refused: number): string =>
      `Permissions: ${allowed} allowed, ${refused} refused.`,
    consensus: (outcome: string, rounds: number): string =>
      `The debate ended ${outcome} after ${rounds} ${rounds === 1 ? 'round' : 'rounds'}.`,
    failFails: 'No on_failure is set: the run ends as failed and nothing runs again.',
    failEscalates: 'on_failure is escalate: the run ends as escalated at once, for a person to look at.',
    failRetry: (target: string, max: number, used: number): string =>
      `on_failure is retry_step: ${target} and every step after it run again, told only the last failure. Up to ${max} ${
        max === 1 ? 'retry' : 'retries'
      }, ${used} used; after that the run ends as escalated.`,
    failOther: (action: string): string => `on_failure is ${action}.`,
    failUnknown: 'This run did not record where a failure leads.',
    targetOf: (ids: string): string => `If ${ids} fails, this step runs again.`,
    closeLabel: 'Steps',
  },

  cost: {
    unknown: 'unknown',
    noCalls: (money: string): string => `${money} (no model calls)`,
    partial: (money: string): string => `at least ${money} (partial)`,
    lessThanCent: 'less than $0.01',
    tipNone: 'No model calls',
    tipCalls: (calls: number): string =>
      `${calls} model ${calls === 1 ? 'call' : 'calls'}, each with a price`,
    tipPartial: (calls: number, unknown: number): string =>
      `${calls} model ${calls === 1 ? 'call' : 'calls'}, ${unknown} with no price`,
  },

  state: {
    completed: 'completed',
    running: 'running',
    validating: 'checking',
    failed: 'failed',
    escalated: 'escalated',
    cancelled: 'cancelled',
    pending: 'pending',
    unknown: 'unknown',
    lastKnown: 'last known',
  },

  time: {
    underASecond: 'under 1 s',
    today: (clock: string): string => `today ${clock}`,
    yesterday: (clock: string): string => `yesterday ${clock}`,
  },

  blocking: {
    tokenTitle: 'This page needs its address',
    tokenBody:
      'Open the address that indaba ui printed in your terminal. It carries a token that this page needs.',
    tokenAction: 'Start it again with indaba ui.',
    stoppedTitle: 'The server stopped',
    stoppedBody: (address: string): string => `Nothing answers at ${address}.`,
    stoppedAction: 'Start it again with indaba ui, then open the new address.',
    newerTitle: 'This page is older than the server',
    newerBody: 'The server was updated while this page was open.',
    newerAction: 'Reload the page.',
  },

  unavailable: {
    title: 'The server is not answering',
    body: 'The page stopped asking. What you see is the last known state.',
    action: 'If you stopped indaba ui, start it again and open the new address. Otherwise check again.',
    check: 'Check again',
    checking: 'Checking...',
    stillDown: 'Still not answering.',
  },

  discussion: {
    title: 'The discussion',
    show: 'Show the discussion',
    hide: 'Hide the discussion',
    loading: 'Loading...',
    none: 'No messages were kept for this step of this run. A run from before messages were kept has none, and so does a run whose messages were kept in a folder this server was not told about (indaba ui --discussion-dir).',
    failed: 'The messages could not be loaded.',
    summary: (participants: string): string => `Where each one ended: ${participants}.`,
    round: (n: number): string => `Round ${n}`,
    ruling: (verdict: string, by: string): string => `Ruling: ${verdict}, decided by ${by}.`,
    rulingNote: 'Note with the ruling',
  },

  settings: {
    title: 'Logging settings',
    badge: 'Changes indaba.config',
    lead: 'Where Indaba keeps its log and how much it records, for the project indaba ui was started in.',
    file: (path: string): string => `Saved in ${path}`,
    notWritten: (path: string): string => `${path} does not exist yet: every value below is a default.`,
    unavailable:
      'This server does not offer the settings. Start it again with a current indaba ui, or change them in a terminal with indaba settings.',
    loading: 'Loading...',
    levelLabel: 'Level of the whole log',
    levelHelp: 'How much is recorded at all: error, warn, info or debug.',
    sinksTitle: 'Where the records go',
    sinkNames: {
      file: 'Log files',
      stderr: 'Terminal (standard error)',
      gelf: 'GELF collector (Graylog)',
      'http-json': 'HTTP JSON collector',
    },
    fieldLabels: {
      level: 'Level',
      address: 'Address',
    } as Readonly<Record<string, string>>,
    addressHelp: {
      gelf: 'The GELF input: https://host/gelf, tcp://host:port or udp://host:port.',
      'http-json': 'The URL each record is posted to: https://...',
    },
    sinkLevelHelp: 'The least severe records this one receives.',
    defaultIs: (value: string): string => `default ${value}`,
    restore: 'Default',
    restoreLabel: (label: string): string => `Put back the default of ${label}`,
    variableSet: 'set on the server',
    variableNotSet: 'not set on the server',
    variableUnknown: 'checked when saved',
    add: (name: string): string => `Add: ${name}`,
    remove: 'Remove',
    removeLabel: (name: string): string => `Remove ${name}`,
    test: 'Send a test record',
    testing: 'Sending...',
    save: 'Save',
    saving: 'Saving...',
    reset: 'Undo changes',
    unsaved: 'Not saved yet.',
    saved: 'Saved. The next command uses these settings.',
    problemsTitle: (n: number): string =>
      n === 1 ? 'One problem keeps this from being saved' : `${n} problems keep this from being saved`,
    secretNote:
      'A collector credential is entered as the name of an environment variable. Its value is never shown, sent or saved.',
  },

  reconnecting: 'The connection dropped. Reconnecting; what you see is the last known state.',
} as const;
