# Review of the plans for steps 2 and 3 of the web view

> Not the self-review of the implementation (that is `review.md`, filled after the code exists). This records a review
> of the **plans** before any code, run on 2026-10-22 as an Indaba debate, and what was done with each finding.

## How it was run

`review-web-app-plans`: one `plans_review` step, two reviewers from different vendors (Claude Code and Antigravity),
`decision_type: consensus`, `arbiter: human`. The reviewers read `spec.md`, `api-surface.md`, `plan.md`, `tasks.md` of
this directory, `specs/web-app/plan-step-3.md`, and the code the plans build on. They were told not to modify anything.
The debate ran its four rounds and ended `max_rounds_exceeded`: neither reviewer wrote AGREEMENT, because the plans needed
edits, although from round 2 their lists agreed point for point. The human arbiter (the maintainer) ruled **accept** on
2026-10-22 (`decidedAt` 11:18 UTC), meaning: take the consolidated edits and build from the amended plans. The ruling is
in the committed ledger `.indaba-decisions/review-web-app-plans.jsonl`. The transcript is in
`.indaba/artifacts/plans_review.transcript.md` (gitignored, local to the machine that ran it). The workflow file is
`.indaba/review-plans.workflow.ai.yml`, also local.

Before applying anything, the three claims everything else rests on were checked against the code: a write without an
`Origin` is accepted today (`checks.ts` `originAllowed`), the root span carries `indaba.task.id`
(`workflow-engine.ts:93`, `event-writer.ts:26`), and the child is started `detached` (`run-child.ts:40`).

## Findings and what happened to each

| # | Finding | Disposition |
| :--- | :--- | :--- |
| 1 | **Blocker.** The run id of the trace is the `traceId`, which `--task-id` does not set; the id from `POST /runs` would not match `GET /runs/{id}`, `canStop` or `stop` | Accepted. Two ids (spec C-02, AC-08): `startId` (task id, server-generated) and `runId` (trace id), correlated by `indaba.task.id` on the root `span_started` record. Diffing the traces folder, as `run-tui.ts` does, was rejected: it races when runs start together |
| 2 | A run that fails before any trace exists would be a `404` forever | Accepted, with a change: the reviewers proposed answering `GET /runs/{startId}` with `startFailure`; a **separate `GET /starts/{startId}`** was chosen instead so no response is sometimes a run and sometimes not (spec C-07) |
| 3 | The child's working directory: `loadWorkflow` resolves the file against `cwd`, not `--workdir` | Accepted (AC-03): `cwd: root`, relative path after `--`, a test with two roots |
| 4 | The confirmation file inside the project arrives pre-confirmed in a clone or a zip | Accepted (C-03): stored in the user's config folder keyed by the root's realpath; the scan skips `.indaba/` except the default file |
| 5 | The hash covers less than what runs (scripts a command calls, `indaba.config`, plugins, agent commands, MCP servers, omitted permissions) | Accepted (AC-04): the summary adds `agent.command`, local MCP commands, "runner default (unrestricted)" and `needsPerson`, and states the limit in plain words on the page. Hashing the referenced files is a non-goal |
| 6 | The window between the hash and the child's own read | Accepted with the reviewers' alternative to `--expect-hash` (rejected: a public CLI option for a loopback tool): the confirmed **bytes** are written to `.indaba/run-inputs/<startId>.yml` (`wx`, only after confirmation) and that copy runs (AC-05). The copy is deleted on exit and swept at start |
| 7 | `kill` was missing: a child that ignores cancel keeps running after `indaba ui` closes, against US-04; the child is detached, so killing only its pid orphans grandchildren; the child has no TTY, so `human` arbitration and logins escalate | Accepted (AC-11, AC-12): cancel, grace, then kill the tree (`taskkill ... /T` on Windows, the process group elsewhere), a no-op after exit, `needsPerson` shown before Run. Whether `scripts/security-audit.mjs` accepts the calls is a check in T-10, not an assumption |
| 8 | `originAllowed` accepts a missing `Origin`; the spec requires one on every write; the error strings say "settings" | Accepted (AC-16, T-02). This tightens the existing settings `PUT`, so it is recorded as a tightening in the semver note |
| 9 | AC-07 left open which repeat call is `200` and which `202` | Accepted (AC-09): `202 stopping` while alive, `200 ended` after exit |
| 10 | `taskId` now names a file; it must be the server's, from a fixed alphabet, and shape-checked wherever it returns from a URL | Accepted (AC-08, T-08 includes `taskId: "../x"`) |
| 11 | Stale copies if `indaba ui` crashes; hash the same buffer that is written; create with `wx` | Accepted (AC-05) |
| 12 | Step 3 was ordered after unbuilt specs although step 2 depends on none, and 3a needs only the parser | Accepted (`plan-step-3.md`): step 2, then 3a, then `debate-findings` and `workflow-editor`, then `workflow-registry`, then 3b to 3d. 3a's `PUT` has its own 1 MiB cap and the same confinement as step 2 |
| 13 | A saved edit must invalidate the confirmation, or a page that edits and runs could appear to confirm what the person never saw | Accepted as an acceptance criterion of 3a |
| 14 | Invented numbers | None found; the constants are labelled starting values. The plan now also says they were not measured |

## Not taken, or taken differently

- `GET /runs/{startId}` overloading (finding 2): a separate resource instead.
- `--expect-hash` (finding 6): rejected by both reviewers.
- Putting the `Origin` rule on reads: no, `originAllowed` is only called for methods other than `GET`.

## Closed by the implementation (2026-10-22)

- `taskkill` and `process.kill(-pid, ...)`: a probe file with both passed `scripts/security-audit.mjs --source` with no
  findings, so T-10 kept its design.
- The correlation by `indaba.task.id` works against traces the engine writes: the unit test writes them with
  `RunEventWriter` in the opposite order of the starts, and the e2e test's traces come from the built `indaba run`. A
  first line still being written is looked at again, not cached as someone else's.
- Running the copy under `.indaba/run-inputs/` changes nothing a workflow resolves: the same workflow run from the
  original and from the copy saw the same working directory and resolved an input artifact the same way.

## Found while implementing

| # | Finding | Handled |
| :--- | :--- | :--- |
| 15 | The CLI cannot throw the server's `RunControlError` (the package is optional and not imported) | The server also recognises an `Error` named `RunControlError` with a string `code`; tested |
| 16 | An empty `fs.read` means unrestricted (`docs/workflow-format.md`); a first draft summarised it as "read nothing" | Says "read anything" now; tested |
| 17 | "runner default (unrestricted)" overstates the `acp` runner, whose own default refuses edits | Kept, as the spec words it: the safe direction for a confirmation |
| 18 | `run started` is listed under `server.runs`, but only the command line knows the path | Written by the command line under `cli.ui`; the server writes `start refused` and `run stop requested` |
| 19 | A failure of the page's "can this server start runs?" question blocked the whole page in a first draft | It only decides whether the Run button shows; a test (the boot test with a 503) caught it |
| 20 | A second `indaba ui` on the same project sweeps the first one's live copies | Recorded as a known gap in `review.md` |
| 21 | `AGENTS.md` was one character under the 12000 that antigravity reads, so its server row could not grow | Reworded within its old length |

## Still open
- Product decisions for step 3 (one file or many, where a new workflow goes, which editing is built here) are the maintainer's.
