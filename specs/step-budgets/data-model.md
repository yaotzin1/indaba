# Data model: Budgets

The only data this feature keeps outside a run is the **resume file**: what is needed to continue a run whose
work was kept. Nothing else is persisted; the meter lives for one run and its figures go to spans (`events.md`).

## `.indaba/resume/<taskId>.json`

Gitignored runtime state. Written atomically (a temporary file in the same directory, then a rename), by
`ResumeStore` only, which validates `<taskId>` against `[A-Za-z0-9_-]+` before building the path. Read by
`indaba run <file> --resume <taskId>`, removed when the resumed run ends without keeping anything again.

```ts
export interface ResumeFile {
  readonly version: 1;                       // anything else is refused
  readonly taskId: string;
  readonly traceId: string;                  // of the run that stopped; becomes `indaba.budget.resumed_from`
  readonly workflow: string;                 // the workflow name
  readonly digest: string;                   // definitionDigest(workflow): SHA-256 of the canonical JSON
  readonly createdAt: string;                // ISO 8601, from the injected clock
  readonly stoppedStepId: string;
  readonly reason: 'unanswered' | 'final_cap' | 'resume_limit' | 'cancelled';
  readonly steps: Readonly<Record<string, {
    readonly status: 'PENDING' | 'RUNNING' | 'VALIDATING' | 'FAILED' | 'ESCALATED' | 'COMPLETED';
    readonly attempts: number;
  }>>;
  /** Engine loop counters, keyed by feature. `retries.<stepId>` now; step-verdicts adds its own prefix. */
  readonly counters: Readonly<Record<string, number>>;
  readonly resumes: Readonly<Record<string, number>>;       // resumes used, by step id
  readonly isolated: readonly string[];                      // step ids whose working directory is the worktree
  readonly workspaces: readonly string[];                    // kept directories, relative to the project, each under .indaba/worktrees/<taskId>
  readonly feedback: Readonly<Record<string, string>>;       // pending retry feedback by step id; redacted; at most 4,000 characters each
  readonly budget: BudgetSnapshot;
}

export interface BudgetSnapshot {
  /** Spend is stored per ORIGINAL currency (`BudgetTotals.cost`); it is converted again, with the rates the resumed
   *  invocation supplies, when compared with a cap. The rates themselves are not stored: they are supplied afresh. */
  readonly run: BudgetTotals;
  readonly steps: Readonly<Record<string, BudgetTotals>>;
  /** Caps as they stand after any grants (a cost cap is a `Money`, in its own currency). `operator` caps are re-supplied by the new invocation, never trusted from the file. */
  readonly caps: { readonly run?: Budget; readonly steps: Readonly<Record<string, Budget>> };
  readonly oneCall: readonly string[];                       // step ids with a granted "one more call" not yet used
  readonly sources: readonly { readonly source: string; readonly kind: 'unmetered' | 'estimated' | 'gap';
                               readonly reason: string; readonly calls: number }[];
}
```

## Rules

- **Never holds** a prompt, an output, a transcript, an environment value or a path outside the project. The
  only free text is `feedback` (already redacted, bounded) and the source `reason`s (cleaned, at most 300
  characters).
- **The operator cap is not stored.** A resumed invocation supplies `--max-cost` and `--max-tokens` again, or
  none; a stored operator cap could otherwise outlive the intention of the person who set it.
- **Currencies and rates.** Amounts are stored unrounded with their ISO code. The file holds no rate: a resumed
  run uses the rates it is given, so a resume with different rates can trip a cap at a different point; the
  figures it prints carry the rates and dates in use. `digest` covers the workflow's own `rates`, so a changed
  rate in the workflow file refuses the resume like any other change (the operator's `--rates` is outside it).
- **Spend never resets.** `budget.run`, `budget.steps` and `sources` are restored into the meter before the
  first check, so the stopped step continues from its old total.
- **A resume refuses** a file whose `version` is unknown, whose `digest` differs from the current workflow, whose
  `workspaces` contain a path that does not resolve (realpath, symlinks followed) to a directory under
  `.indaba/worktrees/<taskId>` that has a kept-workspace record (`specs/workspace-without-git`), or whose steps do not match the workflow's step ids. It changes nothing when it
  refuses.
- **A debate step** resumed by `--resume` restarts from its first round; the file keeps no transcript. A debate
  resumed in the live run needs no file: its transcript is in memory.
- **Lifetime.** Created when a run ends keeping work; consumed by `--resume`; removed with the directory when a
  person answers stop. Nothing expires it automatically, and nothing deletes the directory without a decision.
