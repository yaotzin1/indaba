# API surface contract: Debate arbiter

> Names are provisional until the plan stage confirms them against `PluginHost` and the engine options.

## Semver classification

**minor**: every addition is optional and no existing default changes. A workflow without `arbiter`,
an engine built without an adjudicator and a plugin that knows nothing of this behave as before. The
transcript artifact is a new file written by existing debate steps; it replaces nothing.

## Public symbols added

### `@indaba/core`

```ts
export const Verdict = { Accept: 'accept', Reject: 'reject' } as const;
export type Verdict = (typeof Verdict)[keyof typeof Verdict];

export class Ruling {
  constructor(readonly verdict: Verdict, readonly note: string) {}
  accepted(): boolean;
}

export interface RulingRequest {
  readonly stepId: string;
  readonly topic: string;
  readonly outcome: ConsensusOutcome;      // 'stalled' | 'max_rounds_exceeded'
  readonly rounds: number;
  readonly transcript: readonly AgentMessage[];
}

/** Something that can settle a debate that failed. Extension point. */
export interface Adjudicator {
  /** Resolves to a Ruling, or null when it cannot answer (the step then escalates). */
  /** One line a wizard shows next to the name. Optional. */
  readonly description?: string;
  rule(request: RulingRequest, signal?: AbortSignal): Promise<Ruling | null>;
}
```

`StepDefinition` gains `readonly arbiter?: string;`.

`PluginHost` gains `registerAdjudicator(name: string, adjudicator: Adjudicator): void`, beside
`registerRunner` and `registerGuard`. Adding a method to this interface is safe: plugins call the host and
do not implement it, and `RegistryPluginHost` in the CLI is the only implementer. `Plugin` is unchanged.

`Ruling` gains `readonly source: 'asked' | 'memo'`, set by the engine, never by an adjudicator.

### `@indaba/engine`

`DecisionLedger` (exported, `new DecisionLedger(projectDir, { git? })`):
`memoKey(workflow, stepId, topic): Promise<MemoKey>`, `lookup(workflow, key): Promise<LedgerEntry | undefined>`,
`append(entry): Promise<void>`, `pathOf(workflow): string`. `MemoKey` is `{ key, commit } | { skipped: reason }`.
`LedgerEntry` is `{ key?; workflow; stepId; kind; verdict; note; outcome; rounds; commit?; decidedAt }`.
`LEDGER_DIRECTORY` is `".indaba-decisions"`. The key is a SHA-256 over the workflow name, step id, topic and
the listing of committed files outside `.indaba/` and `.indaba-decisions/` (`git ls-tree -r`), computed in
the engine; `@indaba/core` has no crypto.

`StepExecutorOptions` (the debate runs in `StepExecutor.runConsensus`) gains, all optional:
`adjudicators?: AdjudicatorRegistry` (name to `Adjudicator`), `ledger?: DecisionLedger`,
`clock?: Clock` (for `decidedAt`; the executor has none today) and `redact?: (text: string) => string`
(the CLI's `redact` is not visible to the engine, so it is injected, as the tracer already does).
Without `ledger` nothing is memoised and nothing is written to `.indaba-decisions/`.
`transcriptMarkdown(result: ConsensusResult): string` is internal, not exported.

### `indaba` (CLI)

`TerminalAdjudicator implements Adjudicator`, internal to the package, registered under the name `human`.

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| workflow file | step field `arbiter` | added: `"human"`, or a name a plugin registered. Only on a debate step |
| workflow file | validation errors | added: `step "x" has an arbiter but is not a debate`, `step "x" arbiter "y" is not registered` (the latter at run time, since plugins load then) |
| CLI | none | no new option |
| span attribute | `indaba.arbiter.kind` | added, on a debate step span that consulted an arbiter |
| span attribute | `indaba.arbiter.verdict` | added: `accept`, `reject` or `unavailable` |
| project file | `.indaba-decisions/<workflow-name>.jsonl` | added: append-only ruling ledger, committed |
| span attribute | `indaba.arbiter.source` | added: `asked` or `memo` |
| span attribute | `indaba.arbiter.memo` | added: `skipped` when the tree is dirty or git is unavailable |
| artifact | `.indaba/artifacts/<step-id>.transcript.md` | added, every debate step |
| artifact | `.indaba/artifacts/<step-id>.ruling.md` | added, a ruled step: verdict, note, outcome and rounds of the debate |

## Defaults introduced

- Attempts at an unrecognised answer from the terminal: 3. Changing it is a major.
- No adjudicator available: escalate as today.
- Memo key: workflow name, step id, topic, the committed files (not the commit hash), clean tree. Changing what goes into the key is a major
  (it changes which rulings are reused).

## Checks

- [ ] `@indaba/core` imports no `node:` module (`architecture.test.ts`)
- [ ] The terminal adjudicator is registered the way a plugin's would be (no privileged access)
- [ ] `docs/workflow-format.md` documents `arbiter`; `CHANGELOG.md` and `README.md` updated
- [ ] No `any`, no `!`, no suppression comment
- [ ] `.indaba-decisions/` is not in `.gitignore`, and `docs/` says why it is committed
- [ ] The ledger test covers: hit, miss on a changed file, dirty tree, malformed line, torn append
- [ ] Transcript and note never reach a span, event or log; redaction test present
