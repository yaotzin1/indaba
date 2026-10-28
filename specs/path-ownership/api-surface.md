# API surface contract: Path ownership

> **Provisional (stage 1).** Written with the specification so the surface can be reviewed with it. It becomes the
> contract at stage 3; from then on it is immutable during stage 6, and an implementation that finds it wrong stops and
> returns to stage 3.

## Semver classification

**minor** (below 1.0).

Reasoning: `owners` is optional and a workflow without it runs as today (spec AC-02). `Intent.requests` is declared, optional, by `parallel-steps`.
New span attributes and log records are additive. The two new `BoardKind` members follow `specs/DEPENDENCY_MAP.md`
("What breaks what"): the board's readers treat an unknown kind as unknown, but a third party switching over
`BoardKind` exhaustively stops compiling, so the release takes the next minor below 1.0 and the changelog names the
members.

## Public symbols added

| Export (package, module) | Kind | Signature |
| :--- | :--- | :--- |
| `@indaba/core` (`workflow/model.ts`) | field | `WorkflowDefinition.owners?: Readonly<Record<string, readonly string[]>>` (role to paths) |
| `@indaba/core` (`workflow/ownership.ts`) | function | `ownerOf(path: string, owners: Readonly<Record<string, readonly string[]>>): string \| undefined` |
| `@indaba/core` (`mesh/ownership.ts`) | function | `parseOwnerAnswer(text: string): { readonly kind: 'rejected'; readonly reason: string; readonly instead: string } \| { readonly kind: 'changed' } \| { readonly kind: 'unreadable' }`: what the owner's answer says; `changed` still has to pass landing (spec AC-11, AC-12), `unreadable` is a failed call (AC-13) |
| `@indaba/core` (`mesh/ownership.ts`) | type | `RequestOutcome = 'accepted' \| 'rejected' \| 'failed' \| 'withdrawn'` (spec AC-04), the outcome a `request_answer` entry records |
| `@indaba/engine` (`config/project-config.ts`) | field | `ProjectConfig.ownership: { readonly contestTimeoutSeconds: number }`, always present, default filled |
| `@indaba/engine` (`config/project-config.ts`) | constant change | `PROJECT_CONFIG_SECTIONS` gains `'ownership'` |
| `@indaba/core` (board kinds) | enum members | `BoardKind.ChangeRequest = 'change_request'`, `BoardKind.RequestAnswer = 'request_answer'`, engine-written only |
| `@indaba/engine` (`workspace/`) | function | `splitDiffByPaths(diff: string, match: (path: string) => boolean): { readonly matched: string; readonly rest: string }` |

## Public symbols changed

| Name | Before | After | Impact |
| :--- | :--- | :--- | :--- |
| `Intent` (`parallel-steps`) | `requests?` declared, always absent | filled from `REQUEST` lines | none: the field is part of the `parallel-steps` contract |

## Removed or deprecated

None.

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| workflow file | top-level `owners` | added |
| JSON schema and catalog | `owners` | added, with its description |
| prompt | the `REQUEST`, `REJECT` and `INSTEAD` lines; the owned-paths section of the intent instruction | added |
| span | owner call, with `indaba.ownership.owner`, `indaba.ownership.request`, `indaba.ownership.outcome` | added |
| board | `change_request`, `request_answer` | added |
| log records | spec AC-18 | added |

## Defaults introduced or changed

| Option | Old default | New default |
| :--- | :--- | :--- |
| contests per request | (none) | 1 (spec C-04) |
| requests per intent call or landing | (none) | 5 (spec AC-09, a design choice) |
| `ownership.contest_timeout_seconds` | (none) | 900 (spec AC-09, a design choice) |

## Checks

- [ ] Every type appearing in a new public signature is itself public (or deliberately marked `@internal` and not re-exported from the package index)
- [ ] Implementations are not exported for subclassing; the extension point is an interface
- [ ] Collections are typed precisely and read-only where they are not mutated (`readonly T[]`, `Readonly<Record<string, V>>`)
- [ ] `pnpm qa` (Biome, `tsc` strict, Vitest) passes with no suppression comment
