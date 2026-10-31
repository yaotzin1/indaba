# Cookbook: what each stage produces

[Cookbook: CRUD, step by step](cookbook-crud.md) explains what each stage of the inventory workflow *does*. This page
shows what it *produces*: the files that appear after each stage, with short excerpts, so you know what to look for
while a run is going and what you will have at the end.

**Where the excerpts come from.** They are from one real run of
[`examples/crud-inventory.workflow.ai.yml`](../examples/crud-inventory.workflow.ai.yml) with the `claude-code` runner,
shortened (`...` marks what was cut). Agents write different text every time, so your files will read differently; the
names, the sections and the checks around them will be the same. Nothing here was edited by hand.

## Where is my code?

Not in your folder, until you take it. Every agent step works in a separate git worktree under `.indaba/worktrees/`,
and the `checkpoint_*` steps commit each stage to the branch `indaba/inventory-app`. While the run goes, your folder
still holds only what you set up (the workflow, `acceptance/`, spec-kit's files, `.gitignore`). The worktree is deleted
when the run ends, so the branch is the only place the work survives, even when a step fails.

```bash
git log --oneline indaba/inventory-app    # one commit per stage
git checkout indaba/inventory-app         # look at the code, or:
git merge indaba/inventory-app            # take it into your branch
```

## Watch it while it runs

Open a second terminal in the project folder; leave the one that runs the workflow alone.

```bash
indaba watch latest      # a dashboard of the steps (needs: npm install -g @indaba/tui@next); q quits, ? lists the keys
indaba watch latest --plain --output   # the same as lines, with what each step streams
indaba ui                # a browser view of the runs (see Web view); the address carries a token, keep it to yourself
```

`indaba watch latest --replay` plays a finished run back with its original timing. Do not start the run itself with
`--tui`: the dashboard cannot answer the human arbiter, so a debate that fails to settle would escalate instead of
asking you. See [Web view](web-view.md) for the browser view.

## The folder, stage by stage

Each row is the state of the branch after the checkpoint that follows the stage.

| After | New in the project |
| :--- | :--- |
| start (your commit) | `.specify/` and `.claude/skills/speckit-*` (spec-kit), `acceptance/inventory.mjs`, the workflow file |
| `foundation` | `.specify/memory/constitution.md`, `AGENTS.md`, `CLAUDE.md` |
| `specify` | `specs/001-inventory-app/spec.md`, `checklists/requirements.md` |
| `clarify`, `plan`, `tasks` | the spec's Clarifications, then `plan.md`, `research.md`, `data-model.md`, `contracts/api.md`, `quickstart.md`, `tasks.md` |
| `skill` | `.agents/skills/add-endpoint/SKILL.md`, copied to `.claude/skills/add-endpoint/SKILL.md` |
| `tests` | `package.json`, `stryker.config.json`, `test/validate.test.js`, `test/store.test.js`, `test/app.test.js` |
| `implement` | `src/validate.js`, `src/store.js`, `src/app.js`, `src/server.js`, `public/index.html` |

The gates add nothing to the branch: `verify`, `acceptance` and `mutation` only run commands. The debates
(`spec_review`, `final_review`) and `analyze` change no file; what they conclude goes on the board
(`indaba watch latest` shows it) and into `.indaba/artifacts/`.

## Stage by stage

### `foundation`: the rules every later step obeys

Three files. The constitution is spec-kit's document of principles, written for this project:

```markdown
# inventory-app Constitution

## Core Principles

### I. Spec First (NON-NEGOTIABLE)
Every change, including a bug fix, starts as a spec-kit feature in `specs/` (spec, plan, tasks).
Code MUST NOT be written or changed for behaviour that no spec describes. ...

### II. Tests First
... Tests assert exact status codes and exact response bodies; assertions such as "is OK",
"is truthy" or "status is 2xx" are not allowed. The files in `acceptance/` are fixed ...

### III. Mutation-Tested
`npm run mutation` (Stryker) MUST reach a mutation score of at least 80. A surviving mutant is
fixed by adding or tightening a test. The threshold MUST NOT be lowered ...
```

`AGENTS.md` is the short version agents read first: what the project is, the layout (`acceptance/` marked off-limits),
the commands, the rules, and a Skills section. `CLAUDE.md` is one line, `@AGENTS.md`, so Claude Code reads the same file.

### `specify`, `clarify`, `plan`, `tasks`: spec-kit's documents

`spec.md` starts from the feature description in the workflow's goal and grows user stories with acceptance scenarios
and numbered requirements (`FR-001`, ...). `clarify` answers the open questions and records each one:

```markdown
## Clarifications

### Session 2026-10-31

- Q: Does changing an item to its own current sku count as a conflict, is sku comparison case-sensitive, ...?
  → A: ...
- Q: How are "whole number", "blank" and the 200-character limit judged?
  → A: The parsed JSON value decides "whole number": `5.0` and `1e2` are valid, `1.5` is not. ...

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Keep the stock list (Priority: P1)
...
1. **Given** an empty stock list, **When** the owner adds an item with sku, name, quantity and priceCents,
   **Then** the item is created (201) and the response is the item
```

`plan` and `tasks` then write the technical side. `contracts/api.md` fixes every status and message, so a tester can
assert exact bodies:

```markdown
**Item** (exactly these seven fields, FR-016):
{ "id": "3f0c6c0e-...", "sku": "AB-1", "name": "Blue mug", "quantity": 5, "priceCents": 899,
  "createdAt": "2026-10-31T09:00:00.000Z", "updatedAt": "2026-10-31T09:00:00.000Z" }

**Error** (every refusal): { "error": "<message>" }. The messages below are fixed so tests can assert exact bodies.
```

`tasks.md` puts the test tasks before the code tasks, grouped by user story.

### `spec_review` and `analyze`: reviews that change no file

`spec_review` is a debate between the reviewer and the architect over `spec.md`; they stop when both accept the same
list of findings. `analyze` is one reviewer checking the spec, plan, tasks and constitution against each other. Its
findings reach the later steps as notes on the board. In this run it caught a real inconsistency:

```text
analyze note CRITICAL plan.md adds `DATA_FILE` persistence and a 500 `internal error` answer that spec.md does not
contain (the spec says memory only). That breaks constitution Principle V ...
analyze note HIGH plan.md, tasks.md and contracts/api.md disagree about `DATA_FILE` and 500. ...
```

`tasks.md` then opens with a "Scope note (spec first)" that records the decision, which is what Principle I asks for.

### `skill`: the procedure the next steps follow

A project skill, in the format Claude Code loads: front matter with a `name` and a `description` of when to use it, then
the procedure.

```markdown
---
name: add-endpoint
description: Use when adding or changing an API endpoint, or adding or changing an item field, in inventory-app.
---

# add-endpoint

## 1. Spec and contract first (no spec, no code)
- Run the spec-kit flow (`speckit-specify`, `speckit-plan`, `speckit-tasks`) so the change has a feature in `specs/`.
- Update `contracts/api.md` before any test: method and path, request body, every status, ...

## 2. Failing tests first
Write each test, run `npm test`, and see it fail before writing the code. ...
```

An agent cannot write under `.claude/` in a non-interactive run, so the skill is written to `.agents/skills/` and the
`checkpoint_skill` step copies it to `.claude/skills/`, where Claude Code finds it. It is listed in `AGENTS.md`, and it
stays in the repository for every later change, whoever makes it.

### `tests`: before any code

The tester writes `package.json` (with `"test": "node --test"` and Stryker as the one dev dependency),
`stryker.config.json`, and tests that assert exact messages:

```javascript
const SKU_ERR = "sku must be 1 to 32 characters of A-Z, 0-9 and -";
const NAME_ERR = "name must be 1 to 200 characters and not blank";
...
```

### `implement`: the code, against those tests

`src/validate.js` (pure functions), `src/store.js`, `src/app.js` (the routes), `src/server.js` (starts on `PORT`) and
`public/index.html`, following the project skill. In this run that came to about 250 lines of code and 1,100 lines of
tests.

```javascript
export function isWholeNumber(v) {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

export function isSku(v) {
  return typeof v === "string" && /^[A-Z0-9-]{1,32}$/.test(v);
}
```

### The gates: `verify`, `acceptance`, `mutation`

Commands, not agents. In this run: 102 of 102 tests passed; the acceptance test passed all 10 checks against the real
server; Stryker met the threshold of 80. The `mutation` step also writes `reports/mutation/survivors.txt`: the mutant
counts, then each surviving mutant as `file:line mutator`, so the final review can read it as plain text.

### `final_review`: the last debate

The reviewer and the architect read the code against the spec and the mutation result. If the two cannot agree within
four rounds, a human is asked (when there is a terminal), or the step ends `escalated`. See
[The review](cookbook-crud.md#the-review-final_review) in the CRUD cookbook.

## How long a run takes

Measured on one machine with the `claude-code` runner (each stage is one or more calls to an agent, and the gates run real
commands). Treat these as an order of magnitude, not a promise: your agent, model and network change them.

| Run | Step time | What it included |
| :--- | :--- | :--- |
| a clean run (20 steps) | about 19 minutes | no retry. The longest steps were the final review (3 min), the tests (3 min) and the mutation gate (2.5 min) |
| a run with one mutation retry (33 steps) | about 28 minutes | the first Stryker run fell below 80, so `tests` and `implement` ran again; the mutation gate took about 12 minutes over its two attempts |

The agent calls dominate, and every retry and every extra debate round adds more. A debate has up to four rounds. Expect
a first run to take longer than the numbers above while you read along.

## Faster: leave out mutation testing

Mutation testing is the slowest gate and it is optional. It is recommended, because it is the only gate that checks the
tests themselves: in the run with a retry above, the first set of tests passed `npm test` and the acceptance test but
Stryker scored them below 80, so the run went back to the tester. Without it, tests that pass but check little go through.

To leave it out, edit the workflow before the run (`indaba validate` accepts both results; the edit was checked with
`validate` and `plan`, not with a full run):

1. Delete the `mutation` step.
2. In `final_review`, change `depends_on: ["mutation"]` to the step before it: `["acceptance"]` in the CRUD workflow,
   `["verify"]` in the idea-to-app workflow.

The agents are still told about mutation testing by the files they write (the constitution and `AGENTS.md`) and the tester
still creates `stryker.config.json`; nothing runs it, and the retry that sends surviving mutants back to the tester is gone
with the step. To remove the rule too, take mutation testing out of the `foundation` and `tests` goals. In the two runs
measured above the gate took 2.5 of 19 minutes, and about 12 of 28 when it sent the run back.

## What you can do in parallel today, and what is planned

**Today the steps of one run run one at a time**, even where the order allows two of them to overlap. What you can do
in parallel is run **separate** workflows at once, each in its own project folder: they share nothing, and each has its own
`indaba watch latest`. That is how this page was checked: two different applications built side by side.

Planned, not built: the `parallel-steps` specification (independent steps of one run working at the same time, and
talking before they collide) is a draft in `specs/parallel-steps`, and the [roadmap](roadmap.md) lists it as specified,
not built. Two rough edges found while writing the cookbooks are also open: the scope guard of a step looks at every
change since the worktree's last commit (which is why the workflows commit between stages), and `indaba validate`
warns about missing isolation on steps that inherit it from an earlier step.

## See also

- [Cookbook: CRUD, step by step](cookbook-crud.md): what each stage does, and what to do when it goes wrong.
- [Cookbook: idea to app](cookbook-quick-start.md): the same process, started from a few sentences of your own.
- [Playbook](playbook.md) and [Web view](web-view.md): watching and steering a run.
