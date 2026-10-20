/**
 * Every string the page shows (AC-20). One catalogue, in English; a translation replaces this object. Functions take
 * the values a sentence needs, so word order stays a translator's choice.
 */
export const messages = {
  appName: 'Indaba',
  nav: { label: 'Main', runs: 'Runs' },
  skipToContent: 'Skip to the content',
  readOnly: 'Read-only',
  readOnlyTitle: 'This page never starts or changes anything',
  live: {
    connecting: 'Connecting',
    live: 'Live',
    reconnecting: 'Reconnecting',
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

  reconnecting: 'The connection dropped. Reconnecting; what you see is the last known state.',
} as const;
