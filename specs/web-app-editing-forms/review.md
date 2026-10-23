# Self-review: The local web view, step 3b (edit a workflow through forms)

> **Status**: done, 2026-10-23. Stages run: 1 to 8 of the feature track (spec, clarifications, api-surface,
> plan with the stage 5 audit, tasks, implementation test first, verification, this review). Two stage 6 findings went
> back to the contract and the spec, recorded there: `CatalogEntry` (web-contract imports only its own folder), and four
> wordings (a refusal shown at the top; a runner chain is a list; "show in source" searches the text; C-10).

## 1. Boundary and layering

`@indaba/core` gains declarations only (`web-contract/api.ts`); its contract test checks it. The server applies no edit:
it validates and copies the body (`workflow-editor.ts`) and calls a `WorkflowEditor` the command line supplies, as it
does the store. The page imports only types from core (its layers test); the edit runs on the command line because the
parser imports Node modules (spec C-01). No built-in gets anything a plugin lacks: the catalog lists plugins' runners
and guards as it lists the built-ins.

## 2. Determinism and failure isolation

Nothing reads a clock, randomness or the environment. `nextStepId` is a function of the ids. Edits are queued one at a
time in the page, each on the text the one before returned; an answer for a draft that changed is dropped (tested). No
process or worktree is started; an edit writes nothing.

## 3. Public surface and semver

Minor, below 1.0, recorded in `api-surface.md` (with its amendment) and `CHANGELOG.md`: new core types, `path` on
`WorkflowProblem` (optional), `WorkflowEditor`, `WorkflowEditorError`, four limits, `ServerOptions.workflowEditor`, two
resources, `CONTRACT_VERSION` `1.3.0`. The page's first view of a workflow is now the form when the text can be read;
`@indaba/web` is private, so no consumer's contract changes, and it is in the changelog. Every type in a public
signature is exported from its index.

## 4. Security

The body is capped (`MAX_SOURCE_BODY_BYTES`), the text at `MAX_SOURCE_BYTES`, and `edits`, path parts, key length and
value depth are bounded before the editor runs; a malformed edit is refused by index without echoing a value (tested,
including a value meant to read as a secret). Values are copied into fresh objects; a `__proto__` key stays an own key
and `WorkflowDocument` refuses it by name (tested: nothing is polluted). No path, process or URL is built from a request;
the edit `POST` needs the token, the `Host` check and the page's `Origin`. Logs hold a code and an index, never text,
values or paths. The page renders everything as text (layers test). `.indaba/` is now wholly gitignored, and the log
file #63 committed by mistake is untracked (a separate `chore` commit).

## 5. Observability and honest numbers

No span or attribute. No number is shown that was not computed. The limits are starting values, said so in the spec
(C-07) and in their doc comments. A refusal is a sentence a person can act on ("fix it in the source view").

## 6. Dependencies and packaging

No dependency added. `test/workflow-schema.json` is a test file of a private package and ships nowhere; `pnpm smoke`
packs and installs the six packages and the server finds its page.

## 7. Verification

On Linux (this machine), the gates of `workflow.ai.yml`'s `quality_gates`, each run alone:

```
node scripts/validate-skills.mjs              exit 0
node scripts/sync-claude-skills.mjs --check   .claude/skills is in sync (23 skills)
node scripts/sync-agent-docs.mjs --check      AGENTS.md, GEMINI.md and the cycle file are in sync (4 tracks, 8 stages, 23 skills, 8 gates, 19 rules)
node scripts/check-workflow.mjs               workflow.ai.yml matches the repository
node scripts/security-audit.mjs --source      security audit: no findings (source, manifests, tsconfig, biome.json)
node --test scripts/*.test.mjs                exit 0
pnpm qa                                       Test Files 111 passed; Tests 2078 passed | 2 skipped
                                              All files | 96.53 | 91.79 | 96.37 | 96.78
pnpm e2e                                      Test Files 11 passed; Tests 35 passed
pnpm smoke                                    6 packages packed and audited; the installed server finds its page
node scripts/check-track.mjs                  run by the commit hook on each commit
```

New files, statements / branches: `cli/run-control/editor.ts` 100 / 94.6, `problems.ts` 100 / 100,
`server/workflow-editor.ts` 100 / 100, `web/form-model.ts` 99.3 / 97.5, `web/ui/FormView.ts` 99.5 / 94.4; `client.ts`
99.6 / 95.7. `SourceScreen.ts` is 92 / 84.5: its uncovered branches are step 3a's (unmount guards, a save during a
check), not the form's.

**Real browser (T-12, also the check 3a left open).** Chromium 1194 through `playwright-core`, against the built
`indaba ui` on a commented workflow, at 320 and 1280 px in light and dark: no horizontal scroll at either width, no
console error, the Tab order runs view switch, name, fields, roles, step list, Add a step, every stop visible; a goal
edited in the form keeps every comment, the blank line and the quoting of the file in the source view. Not measured:
contrast ratios with a tool, and a screen reader.

CI on #65: Agent instruction set, Track and deliverables, Dependency audit, and Verify on ubuntu, windows and macOS all passed.

## Known gaps

- `artifacts`, `mcp_servers`, `agent`, `guards` and unknown keys are edited in the source view (spec AC-07); each is a
  later task, to do when someone asks for it in a form.
- "Show in the source view" finds a key by searching the text; in a flow mapping it lands at the start. Exact positions
  for any path would need the editor to answer them (a contract change), worth doing with 3c.
- Roles cannot be added or renamed in the form, only edited.
- Contrast was checked by eye in both themes, not measured; no screen-reader pass.
