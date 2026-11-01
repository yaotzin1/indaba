# Tutorial: get the best result from a cookbook run

The two cookbooks ([idea to app](cookbook-quick-start.md) and [CRUD, step by step](cookbook-crud.md)) tell you which
commands to type. This tutorial tells you what to **write** and what to **check**, because that is where the quality
of the result comes from. It is for someone who has never used spec-kit, agent skills or `AGENTS.md`, and it walks the
CRUD recipe in the order you would work: decide what you want, write the inputs, check the plan for free, run, read the
result in a useful order, and fix what is wrong at the document that caused it.

**Where the excerpts come from.** They are from real runs of the two workflows in
[`examples/`](../examples/idea-to-app.workflow.ai.yml) (the shop stock list from the quick start), shortened. Agents write
different text every time, so yours will read differently. Anything this page says Indaba does was checked in a run;
advice on what to write is marked as advice.

## 1. The idea in one picture

Every document in the recipe has one job, and each later one is written from the earlier ones. When the result is
wrong, you fix the **earliest** document that is wrong, not the code.

| Order | Document | Where | It answers | Written by | Read by |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | Your idea (quick start: `idea.md`; CRUD: the feature description inside the `specify` goal) | `idea.md`, or the workflow file | What do I want, for whom, and what is *not* wanted | you | the agents, first |
| 2 | Constitution | `.specify/memory/constitution.md` | Which principles never bend, whatever the feature | `foundation` | every later step; it outranks the rest |
| 3 | `AGENTS.md` (and `CLAUDE.md`, one line: `@AGENTS.md`) | project root | Where things are, how to run them, what "done" means | `foundation` | any coding agent, before it touches anything |
| 4 | Specification | `specs/001-<name>/spec.md` | What must the app do, in cases a tester could check | `specify`, `clarify` | tests, plan, tasks |
| 5 | Plan, contracts, data model, tasks | `specs/001-<name>/` | How, in what order, with exactly which requests and answers | `plan`, `tasks` | tester and implementer |
| 6 | Skills | `.claude/skills/<name>/SKILL.md` | How do we do the *recurring* job here (add an endpoint, kill a mutant) | `skill` | tester and implementer, and every later change |
| 7 | Tests, then code | `test/`, `src/`, `public/` | Does it behave as written | `tests`, `implement` | the gates |
| 8 | Acceptance test (CRUD recipe) | `acceptance/inventory.mjs` | Does the real server keep the contract, checked by something no agent can edit | you | the `acceptance` gate |

A rule of thumb for where a sentence belongs:

- **True for every feature, forever** ("tests first", "no runtime dependencies"): the constitution.
- **A fact about this project** ("`src/server.js` only starts the app", "run `npm test`"): `AGENTS.md`.
- **What this one feature must do**: the specification and its contracts.
- **A procedure you want repeated the same way** ("to add an endpoint: contract, failing test, validation, store, route,
  mutation run"): a skill.

Each answer is stored once. A rule repeated in four files drifts apart; a rule in the wrong file is read by the wrong
agent, or not at all.

## 2. Decide what you want (before you run anything)

The agents decide whatever you leave open, and they decide it confidently. In the quick-start run, the idea was two
sentences. The spec that came back recorded 17 decisions the idea never made, in its `Clarifications` section. A few:

```text
- Q: Are item codes case-sensitive? → A: No. Codes are unique case-insensitively, stored as entered ...
- Q: How is price handled? → A: Integer cents (0 to 100,000,000). The API takes cents only; only the page converts "12.50" ...
- Q: In what order do sell and restock validate? → A: Code (404), then body (400), then business rule (409).
- Q: What is out of scope? → A: Auth, editing name or price, sales history, suppliers, categories, ...
```

They were reasonable. They were also somebody else's decisions about your shop. So the most valuable ten minutes in this
recipe are before the run.

### Quick start: write `idea.md`

Advice (what the agents had to guess when it was missing):

1. **Who uses it, and what do they do with it?** One person at a till is a different app from a team.
2. **The things (nouns) and their facts.** "Items with a code, a name, how many we have and the price."
3. **The actions (verbs).** "Add items, take some out of stock when they sell, see what is running low."
4. **What it must *not* do.** "No logins. No history." Out-of-scope lines are the cheapest way to stop an agent adding
   a feature.
5. **Any number you care about.** "Low means fewer than 10." Otherwise the agents pick 5.

Too vague: `An app for my shop.` Good enough: the two sentences in the [quick start](cookbook-quick-start.md#1-write-your-idea).
Better: those two sentences plus `Low stock means fewer than 10. One person uses it; no logins. Prices have two decimals.`

### CRUD recipe: write the feature description

In the CRUD recipe the idea is not a file: it is the paragraph that starts `Feature description:` in the `goal` of the
`specify` step of [`crud-inventory.workflow.ai.yml`](../examples/crud-inventory.workflow.ai.yml). It is the one place
where the contract is written by a person. The shipped one has this shape; reuse it for your own app:

| Part | In the example | Why it matters |
| :--- | :--- | :--- |
| The thing and *every field's rules* | `an sku (1 to 32 characters of A-Z, 0-9 and -, unique across items), a name (1 to 200 characters, not blank), a quantity and a priceCents (whole numbers of 0 or more)` | Boundaries become tests (32 and 33 characters). No range written means no boundary tested |
| Fields the system makes | `id`, `createdAt` and `updatedAt` (ISO 8601) | Otherwise the agent invents their format |
| Each operation | `PATCH /api/items/:id (any of the four fields, at least one, nothing else; 200, 400, 404, 409; an item may keep its own sku)` | One clause per success *and* per failure status, and when it happens |
| Rules across fields | `adjusts stock ... without going below zero` and `422 when quantity would go below 0` | The cases a test most often misses |
| The error shape | `every error is { "error": "<message>" }; any other method or path is 404 with that shape` | One shape lets the page and other programs handle every failure the same way |
| Who else calls it | `Other programs use the HTTP API, so it is part of the requirements` | Tells the spec step to treat the API as a requirement, not a detail |

Checklist before you save the file: every action has a success status and at least one failure status; every field has a
type and a limit; the error shape is stated once; at least one line says what is out of scope.

If you change the app, write the **acceptance test** at the same time (section 8): it is the same contract as the
description, written as checks, and it is what a finished run is measured against.

## 3. Choose the principles (the constitution)

`foundation` writes `.specify/memory/constitution.md` from the principles listed in its `goal`. The shipped list is:
spec first; tests first, asserting exact status codes and bodies; mutation-tested to a score of 80; no runtime
dependencies; small and explicit. The result reads like this (shortened):

```markdown
# inventory-app Constitution
## Core Principles
### I. Spec First (NON-NEGOTIABLE)
Every change starts as a spec-kit feature in `specs/` ...
### II. Tests First
Failing tests are written before the code ...
```

To add a principle of your own, add a clause to the `foundation` goal, in the same style as the others. Good principles
are checkable ("every error response has the shape `{ "error": ... }`"), few (five to seven), and true for every
feature. Advice from the runs, not a measured rule: a principle such as "tests are deterministic: no sleeps, no fixed
ports, no racing a socket" is worth adding. In the quick-start run a generated test (a 413 on an oversized body)
failed with `ECONNRESET` on roughly three of five `npm test` runs on Windows, while the run's own gate had happened to
pass; the tests were correct about the behaviour and timing-dependent about the socket.

## 4. `AGENTS.md`: the first thing an agent reads

`AGENTS.md` is the file Codex and other agents read when they open the folder, and the workflow's goals tell every step to
read it. Claude Code reads `CLAUDE.md`, which holds the single line `@AGENTS.md` and so imports it: one file to keep right. What the quick-start run produced (shortened):

```markdown
# AGENTS.md
Rules for every coding agent working in this repository. The governing document is `.specify/memory/constitution.md`; read it first.
## What this is        <- what it does, the limits, what is out of scope
## Layout              <- src/ code, src/server.js only starts the app on PORT, public/, test/, specs/
## Commands            <- npm install, npm test, npm run mutation, npm start
## Rules               <- 1. Spec first  2. Tests first  3. Mutation-tested ...
## Skills              <- the speckit-* skills, and each project skill by its final path
## Done means          <- npm test passes; mutation score >= 80; no runtime dependencies
```

What to check when you read it: the commands run on your machine; the layout names real folders; "Done means" is
something a command can prove; the Skills section lists every project skill by the path where it actually is. Keep it
short. A long `AGENTS.md` is skimmed, and anything long-lived belongs in the constitution or a skill.

## 5. The specification, file by file

spec-kit gives a feature one folder. Each file has a job, and each is worth a different kind of reading:

| File | What it is | What to check |
| :--- | :--- | :--- |
| `spec.md` | What the app must do, as user stories with priorities and *Given / When / Then* scenarios; requirements numbered `FR-001`...; success criteria; `Clarifications` | Every action you listed is a story; every failure you care about is a scenario; nothing says `[NEEDS CLARIFICATION]` |
| `checklists/requirements.md` | The spec's own quality checklist | Unticked boxes name what the spec still lacks |
| `plan.md` | The technical approach, within the limits the `plan` goal gave | The stack and layout match `AGENTS.md` |
| `research.md` | Decisions with the alternatives considered | Skim for a choice you would not accept |
| `data-model.md` | Each entity, its fields, rules and state changes | Same limits as your description |
| `contracts/api.md` | Every request, body, status code and error message | The one to read closely: the tests and the code are written from it |
| `quickstart.md` | How to start the app and try it | You can follow it |
| `tasks.md` | The ordered work, tests before code, with checkboxes | Test tasks come first; the last task is the gates |

A user story in the real run looked like this (shortened):

```markdown
### User Story 1 - Add items and see the stock list (Priority: P1)
**Why this priority**: Without items there is nothing else to do; this alone is a usable stock list.
**Independent Test**: Add two items, list them sorted by code, search for part of a name, and see only the matches.
**Acceptance Scenarios**:
1. **Given** an empty stock, **When** the shopkeeper adds code `ABC`, name `Widget`, quantity 10, price 1250 cents,
   **Then** the item is created (201, with `Location`) and appears in the list.
2. **Given** item `abc` exists, **When** `ABC` is added, **Then** the request is rejected as a duplicate (409) ...
```

The `Clarifications` section at the top is the most useful part to read first: it is the list of what the agents decided
for you (section 2). If one answer is wrong, you found the error at the cheapest place.

## 6. Skills: where they go and what goes in them

A **skill** is a short procedure an agent loads when its description matches the job. It is a folder with one file:

```text
.claude/skills/<name>/SKILL.md
```

Claude Code finds skills under `.claude/skills/`. Agents with other conventions use other folders: the CRUD cookbook
notes that spec-kit initialised for Codex puts its skills in `.agents/skills/`. The workflow writes the project's own
skills to `.agents/skills/<name>/SKILL.md` and its `checkpoint_skill` shell step copies them to `.claude/skills/`,
because a Claude Code agent run without a person cannot write under `.claude/`. If you write a skill by hand, put it
straight in `.claude/skills/<name>/`.

Anatomy, from the real `change-feature` skill of the quick-start run (53 lines, shortened):

```markdown
---
name: change-feature
description: Use when adding or changing any behavior of the shop stock app (route, rule, validation, page control, persistence); gives the contract-first, tests-first, mutation-gated procedure.
---
# Change a feature
Governing rules: `.specify/memory/constitution.md` and `AGENTS.md`. Do the steps in order ...
## 1. Contract first (spec-kit)
## 2. Plan the files            <- which file holds validation, store, HTTP, I/O
## 3. Tests first, and watch them fail
## 4. Code
## 5. Gates                     <- npm test, npm run mutation >= 80; never lower the threshold
## 6. Finish
```

What makes a skill work, as far as these runs show:

1. **The front matter is the trigger.** `name` is the folder name; `description` says *when to use it* ("Use when ...").
   A vague description is never picked; a precise one is.
2. **Numbered steps in the order you want them done**, each with the file or command it uses.
3. **A "Never" list.** The second skill, `kill-mutants`, opens with what not to do (lower the threshold, add ignore
   rules, narrow what is mutated) before it says how to proceed.
4. **Specific to the project.** Names the real files and the real limits (`10,240 bytes allowed, 10,241 gives 413`),
   not general advice an agent already knows.
5. **Short.** The workflow asks for under 60 lines. Move background to `AGENTS.md` or the spec.

Skill, `AGENTS.md` or constitution? A skill is *how to do a kind of job*; `AGENTS.md` is *where things are*; the
constitution is *what never changes*. If you find yourself writing "when you add X, first ..." it is a skill.

**Getting the skills you want.** The `skill` step's goal says what to write. The shipped one asks for one skill that is
the procedure for adding or changing an endpoint. To get another (say, "release a new version" or "change the page"),
add it to that goal in one sentence: its name, when it applies, and the order of its steps. Every new skill must also be
listed in the Skills section of `AGENTS.md` by its final path; the goal already says so.

## 7. Check before you spend: `validate` and `plan`

```bash
indaba validate crud-inventory.workflow.ai.yml
indaba plan crud-inventory.workflow.ai.yml
```

Both start no agent and cost nothing. After you edit a goal, run them again: `validate` catches a broken file, and `plan`
shows each step's order, runner and *what it may change*. Read the "may only change" part against your intent: if you
asked the `skill` step for a second skill under a new folder, its `fs.write` list must allow it, or the step will fail
with `Changes outside the allowed scope`.

## 8. Write your own acceptance test

The acceptance test is the one gate no agent can edit, so it is where *you* decide what "working" means. The shipped
[`acceptance.mjs`](../examples/crud-inventory/acceptance.mjs) is 172 lines and has this pattern, which you can reuse:

1. Start the real app (`node src/server.js`) on a free port, passing it in `PORT`, and wait until it answers.
2. Register checks with `check('name', async () => { ... })`. Each makes a request and asserts the **exact** status and
   body (`assert.equal(res.status, 201)`), and error bodies have the shape `{ error: <string> }`.
3. One check per sentence of your feature description: the creation, each failure status, the cross-field rule.
   Checks that need an earlier one (reading the item you created) say so and fail clearly if it did not pass.
4. Print `ok` or `FAILED` per check; exit `0` only if all passed. A non-zero exit is what sends the run back to `implement`.

Copy it to `acceptance/<name>.mjs`, replace the checks, update the command in the `acceptance` step, and tell the agents
not to touch it (the examples' goals say `without changing ... acceptance/`). Write the checks from your *description*,
not from the code the agents wrote: the point is that it is independent of them.

## 9. Run it, and read the result in the right order

```bash
indaba run crud-inventory.workflow.ai.yml
```

In a second terminal use `indaba watch latest` (see [what each stage produces](cookbook-stages.md#watch-it-while-it-runs)).
When the run ends, the work is on the branch `indaba/inventory-app`, one commit per stage. Read it **in the order the
documents were written**, stopping at the first thing that is wrong:

1. `spec.md`'s `Clarifications`: the decisions made for you (section 2).
2. `contracts/api.md`: every request and answer. This is the contract.
3. `AGENTS.md` and the constitution: do the rules say what you meant?
4. The skills: do they name the right files and the right "never"s?
5. `git log` of the branch: if a mutation retry happened, the extra `tests` and `code` commits show what the gate made
   stronger.
6. The final review: `indaba watch latest --plain` ends with it. Agents list what the tests do not cover.
7. Only then the code and the page: run it (`npm start`) and try the actions in your description.

## 10. Review the spec before any code is written

The run does not stop between stages for your approval: it asks you only when a debate fails to settle. (A review gate is
specified in [`specs/review-gate`](../specs/review-gate/spec.md) and is not built.) To read and correct the specification
**before** the tests and code are written, run the recipe in two halves with two copies of the workflow file:

**Copy 1, `crud-inventory-spec.workflow.ai.yml`.** Change `name:` to `"crud-inventory-spec"`. Delete the steps from
`skill` to the end of the file (`skill`, `checkpoint_skill`, `tests`, `checkpoint_tests`, `implement`, `checkpoint_code`,
`verify`, `acceptance`, `mutation`, `final_review`). That leaves ten steps, `foundation` to `analyze`, and nothing else
needs editing.

**Copy 2, `crud-inventory-build.workflow.ai.yml`.** Change `name:` to `"crud-inventory-build"`. Delete the first ten
steps (`foundation` to `analyze`), then make four edits so nothing points at a deleted step:

1. In `skill`, delete the line `depends_on: ["analyze"]`.
2. In `tests`, delete the `read:` block under `board:` (keep `post: [result]`).
3. In `implement`, change `steps: ["spec_review", "analyze", "tests"]` to `steps: ["tests"]`.
4. In `final_review`, change `steps: ["analyze", "tests", "implement"]` to `steps: ["tests", "implement"]`.

Both copies pass `indaba validate`. This recipe is for the CRUD workflow, which names the feature directory in every goal.
The quick-start workflow finds its feature through `.specify/feature.json`, a pointer spec-kit keeps out of git, so it would
not survive the split. Then:

```bash
git add . && git commit -m "Add the two workflows"
indaba run crud-inventory-spec.workflow.ai.yml
git merge indaba/inventory-app           # take the constitution, AGENTS.md and the specification
# read and edit specs/001-inventory-app/ and AGENTS.md; fix what is wrong by hand, then:
git add . && git commit -m "Reviewed specification"
indaba run crud-inventory-build.workflow.ai.yml
git merge indaba/inventory-app
```

Merge the first half before the second, and commit your edits: each half starts from your current commit, so your
corrections are what the tests and the code are written from.

## 11. When the result is wrong: fix the earliest document

| What you see | The cause is probably | Fix |
| :--- | :--- | :--- |
| A feature you did not want | Out of scope was not written, so the agents added it | Add an out-of-scope sentence to the idea or the feature description; run again |
| A rule you did not choose (a limit, a default) | The idea left it open and the agents decided (see `Clarifications`) | Write the rule in the idea; or, if it is the only one, correct it in `spec.md` and `contracts/api.md` using the two-half recipe |
| The agents keep doing a job the wrong way | No skill, or the skill's `description` never matches | Add or sharpen a skill, and its line in `AGENTS.md` |
| The same mistake in every new feature | The rule is in nobody's file | Add a principle to the `foundation` goal, or a "Never" to the skill |
| Tests pass but the app is not what you asked | The acceptance test is missing the case | Add a check to your acceptance test |
| `mutation` sends the run back more than once | Tests check too little | Normal. Run `npm run mutation` on the branch to see the survivors. If it escalates, see [when it goes wrong](cookbook-crud.md#when-it-goes-wrong) |
| `npm test` fails now and then | A generated test depends on timing | Add the determinism principle (section 3) and ask the agent to rewrite that test |

**Before a second run.** Each checkpoint runs `git branch -f indaba/inventory-app HEAD`, which **moves** the branch. A
second run overwrites the branch from the first. Merge what you want to keep, or rename the branch
(`git branch -m indaba/inventory-app indaba/inventory-app-v1`), before you run again.

## 12. A checklist for the best result

Before the run:

- [ ] The idea or feature description names who, the things and their limits, every action with its statuses, and what is
      out of scope.
- [ ] The principles in the `foundation` goal are few and checkable.
- [ ] The `skill` goal asks for the procedures you want repeated.
- [ ] Your acceptance test (CRUD recipe) states the contract in checks the agents cannot edit.
- [ ] `indaba validate` and `indaba plan` are clean, and "may only change" matches your intent.
- [ ] Git has your name and email, and the workflow is committed.

After the run:

- [ ] You read `Clarifications` and `contracts/api.md` and agree with every answer.
- [ ] `AGENTS.md` commands run; the skills name real files.
- [ ] `npm test` passes several times in a row, not once.
- [ ] `node acceptance/<name>.mjs` and `npm run mutation` pass on the merged branch.
- [ ] You tried the page by hand with the actions from your description.

## See also

- [Cookbook: CRUD, step by step](cookbook-crud.md): what each step does, and what to do when it fails.
- [Cookbook: what each stage produces](cookbook-stages.md): the files after every stage, with excerpts.
- [Cookbook: idea to app](cookbook-quick-start.md): the short version, from `idea.md`.
- [Workflow format](workflow-format.md): every field a goal, permission or gate can use.
