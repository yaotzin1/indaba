# Cookbook: a CRUD app, step by step

This recipe takes an empty folder to a working application, **inventory-app**: the stock list of a small shop, with a
JSON API and a one-page front end. Agents do every stage, the way a team would:

1. write the project's rules: a [spec-kit](https://github.com/github/spec-kit) constitution and an `AGENTS.md`;
2. specify the feature with spec-kit, argue over the spec, clarify it, plan it, break it into tasks and analyse it;
3. write a project skill, the procedure the coding agents then follow;
4. write the tests first, then the code;
5. pass three gates: the tests, a black-box acceptance test of the running server, and mutation testing;
6. review the result in a debate.

Each stage is a step of [`examples/crud-inventory.workflow.ai.yml`](../examples/crud-inventory.workflow.ai.yml), and
this page explains every one. For the short version, where you only write an idea and let the agents decide the
rest, see [Cookbook: from an idea to an app](cookbook-quick-start.md). Every field the workflow uses is described in
[Workflow format](workflow-format.md); the commands are in the [Playbook](playbook.md).

## What gets built

An item has an `id`, a unique `sku`, a `name`, a `quantity` and a `priceCents`, with `createdAt` and `updatedAt`.

| Endpoint | Does |
| :--- | :--- |
| `GET /api/items` | lists items; `?lowStock=5` lists those with fewer than 5 in stock |
| `POST /api/items` | adds an item: `201`, or `400` for a bad field and `409` for an sku that exists |
| `GET /api/items/:id` | one item, or `404` |
| `PATCH /api/items/:id` | changes any of `sku`, `name`, `quantity`, `priceCents` |
| `DELETE /api/items/:id` | removes it: `204` |
| `POST /api/items/:id/adjust` | `{ "delta": -3 }` takes three out of stock; `422` if that would go below zero |
| `GET /` | one page that lists, adds, adjusts and deletes items |

It runs on Node 22 with no runtime dependencies. Its one development dependency is
[StrykerJS](https://stryker-mutator.io/), which does the mutation testing.

And around the code, what a project needs so the next agent or person can work on it:

| File | Written by | Is |
| :--- | :--- | :--- |
| `AGENTS.md`, `CLAUDE.md` | `foundation` | the rules every coding agent reads: layout, commands, rules, skills, what "done" means |
| `.specify/memory/constitution.md` | `foundation` | the project's principles, which outrank every other document |
| `specs/001-inventory-app/` | `specify` to `tasks` | `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/api.md`, `quickstart.md`, `tasks.md` |
| `.claude/skills/add-endpoint/SKILL.md` | `skill` | how to add or change an endpoint here, from the contract to the mutation run |
| `test/`, `package.json`, `stryker.config.json` | `tests` | the tests and the mutation settings |
| `src/`, `public/` | `implement` | the application |

## The steps

| Step | Who | Does | May change |
| :--- | :--- | :--- | :--- |
| `foundation` | architect | constitution (spec-kit skill), `AGENTS.md`, `CLAUDE.md` | `.specify/memory/**`, `AGENTS.md`, `CLAUDE.md` |
| `specify` | architect | `specs/001-inventory-app/spec.md` (spec-kit skill), from the feature description in its goal | `specs/**` |
| `spec_review` | reviewer + architect | debate the spec until both accept the same findings | nothing |
| `clarify` | architect | answers the open questions from the findings and records them in the spec (spec-kit skill) | `specs/**` |
| `plan` | architect | plan, research, data model, API contract, quickstart (spec-kit skill) | `specs/**` |
| `tasks` | architect | `tasks.md`, tests before code (spec-kit skill) | `specs/**` |
| `analyze` | reviewer | checks spec, plan, tasks and constitution against each other (spec-kit skill); posts findings | nothing |
| `skill` | architect | the `add-endpoint` project skill, listed in `AGENTS.md` | `.claude/skills/add-endpoint/**`, `AGENTS.md` |
| `tests` | tester | `package.json`, `stryker.config.json`, `test/` | `test/**`, those two files, `tasks.md` |
| `implement` | implementer | `src/`, `public/` (spec-kit skill and the project skill) | `src/**`, `public/**`, `tasks.md` |
| `verify` | shell | `npm install`, `npm test`; a failure goes back to `implement`, at most 3 times | |
| `acceptance` | shell | `node acceptance/inventory.mjs`; a failure goes back to `implement`, at most 2 times | |
| `mutation` | shell | `npx stryker run`; surviving mutants go back to `tests`, at most 2 times | |
| `final_review` | reviewer + architect | debate the finished code against the spec | nothing |

Between them sit five `checkpoint_*` shell steps that commit what came before to the branch `indaba/inventory-app`.
That branch is what you get at the end (see [Checkpoints](#checkpoints)).

## What you need

- Node 22 or newer, npm, git (with your name and email set: the checkpoints commit), and network access for
  `npm install`.
- [uv](https://docs.astral.sh/uv/), to install spec-kit's files with `uvx`.
- Indaba: `npm install -g indaba@next`, or write `npx indaba@next` wherever this page writes `indaba`.
- One agent. The roles use Claude over ACP and fall back to the `claude-code` CLI when ACP cannot start, so either an
  ACP-capable Claude or an installed, logged-in `claude` CLI will do. See
  [Logging in to an ACP agent](getting-started.md#logging-in-to-an-acp-agent) and [Using the alpha](using-the-alpha.md).
- A terminal for the run: the two debates use `arbiter: "human"`, which asks you only when the agents cannot agree.

The run calls agents at least eleven times (each debate takes up to four rounds, and every retry calls agents again),
so it costs what those calls cost with your agent.

## 1. Make the project

```bash
mkdir inventory-app && cd inventory-app
git init
uvx --from git+https://github.com/github/spec-kit.git@v1.2.5 specify init --here --force --integration claude --script py --non-interactive
printf ".indaba/\nnode_modules/\nreports/\n.stryker-tmp/\n" > .gitignore
mkdir acceptance
```

Save [`examples/crud-inventory/acceptance.mjs`](../examples/crud-inventory/acceptance.mjs) as
`acceptance/inventory.mjs`, then commit:

```bash
git add . && git commit -m "Start inventory-app"
```

What each part is for:

- **git and one commit.** The steps work in a git worktree, which needs a commit to start from.
- **spec-kit.** `specify init --integration claude` installs spec-kit's templates in `.specify/` and its commands as
  Claude skills in `.claude/skills/speckit-*`. `--script py` picks its Python helper scripts, which work on every OS;
  the workflow's agents read the skills but do not run the scripts (see [How spec-kit is used](#how-spec-kit-is-used)).
  Add `--ignore-agent-tools` if the `claude` CLI is not installed. `@v1.2.5` pins the release this recipe was written
  against.
- **`.gitignore`.** Installed packages, Stryker's reports and Indaba's runtime state must not end up in the commits.
  On Windows `cmd`, write it in an editor with those four lines.
- **The acceptance test.** It starts the real server and checks the contract over HTTP, outside the agents' control:
  no step may change `acceptance/`. Whatever the agents write, a completed run means this test passed.

## 2. Get the workflow file

Save [`examples/crud-inventory.workflow.ai.yml`](../examples/crud-inventory.workflow.ai.yml) in the folder as
`crud-inventory.workflow.ai.yml`. Or, to have Indaba find it with no file argument, save it as
`.indaba/workflow.ai.yml`.

## 3. Read what each stage does

### Project rules: `foundation`

The architect follows spec-kit's `speckit-constitution` skill to write `.specify/memory/constitution.md` with the
principles in its goal: spec first, tests first, mutation-tested with a score of at least 80, no runtime dependencies,
small and explicit. Then it writes `AGENTS.md`, the file coding agents read before they touch anything: what the
project is, the layout, the commands, the rules, the skills and what "done" means. `CLAUDE.md` is one line,
`@AGENTS.md`, so Claude Code reads the same rules. `outputs` fails the step if either file is missing.

### The specification: `specify`, `spec_review`, `clarify`, `plan`, `tasks`, `analyze`

**`specify`** follows `speckit-specify` with the feature description in its goal, which fixes the data rules and the
HTTP API (other programs use it, so it is a requirement, not a detail). It creates `specs/001-inventory-app/spec.md`
and the quality checklist, and posts on the board:

```text
BOARD result: A stock list for a small shop, with an HTTP API and one page.
BOARD fact feature.dir: specs/001-inventory-app
```

**`spec_review`** is a [review debate](workflow-format.md#pattern-a-review-debate). `AGREEMENT:` means "I accept the
other participant's findings", not "the spec is perfect", so two agents who find the same gaps can settle. Every
message lands on the board.

**`clarify`** follows `speckit-clarify`, which normally asks you questions. Here nobody is asked: the architect answers
each question from the debate's findings and records question and answer in the spec's Clarifications section, as the
skill does.

**`plan`** and **`tasks`** follow `speckit-plan` and `speckit-tasks`. The plan gets the technical context (Node 22,
`node:http`, `node:test`, Stryker, the layout from `AGENTS.md`) and writes the API contract to `contracts/api.md`; the
tasks put every test before the code it tests.

**`analyze`** follows `speckit-analyze` at the `read` level: it may change nothing. It posts its CRITICAL and HIGH
findings as board notes, which the tester and the implementer read in their prompts.

### A project skill: `skill`

The architect writes `.claude/skills/add-endpoint/SKILL.md`, a skill in the format Claude Code loads (front matter
with a `name` and a `description` of when to use it), and lists it in `AGENTS.md`. It is the procedure for this
project: contract first, failing tests first, validation, store, route, then the tests and the mutation run. The
`tests` and `implement` steps are told to follow it, and it stays in the repository for every later change, whoever
makes it.

### Tests first, then the code: `tests`, `implement`

**`tests`** follows the test parts of the skill for every endpoint in the contract. It writes `package.json` and
`stryker.config.json` word for word as its goal gives them, so the gates are fixed before any code exists, and ticks
its tasks in `tasks.md`. It may not write `src/`.

**`implement`** follows `speckit-implement` (working through `tasks.md`) and the project skill. It may change `src/**`,
`public/**` and `tasks.md` only, so the one way through the gates is to make the code right, not to bend the tests. If
a test disagrees with the spec, it follows the spec and posts a `question`, which you will read on the board.

### The gates: `verify`, `acceptance`, `mutation`

**`verify`** installs Stryker (`--no-package-lock`, so no lock file appears as a change) and runs `npm test`.
**`acceptance`** runs `node acceptance/inventory.mjs`, the test you copied in step 1. When either fails, `on_failure`
resets `implement` and every step after it and runs `implement` again with the last failure in its prompt (only the
last one, never the history).

**`mutation`** runs Stryker. Passing tests prove only that the tests pass. Stryker changes the code in small ways, one
at a time (`>=` becomes `>`, `&&` becomes `||`, a string becomes empty), and runs the tests against each change, called
a mutant. A mutant the tests catch is *killed*; one they miss has *survived*, and shows a behaviour no test checks.
Below the threshold, Stryker exits with status 1 and its report lists every survivor:

```text
[Survived] Regex
src/app.js:8:19
-   const ITEM_PATH = /^\/api\/items\/([^/]+)$/;
+   const ITEM_PATH = /\/api\/items\/([^/]+)$/;
```

That report becomes the failure in the `tests` step's next prompt, so the tester knows exactly which behaviour has no
test: here, no test sends a path with something in front of `/api/items/`, so dropping the `^` anchor changes nothing
the tests can see (a real survivor, from a test run of this recipe). The retry goes back to
`tests`, further than the others, because a surviving mutant is a missing test, not broken code. The code then runs
against the stronger tests, and every gate runs again. Some survivors cannot be killed (a change that does not alter
behaviour, called an equivalent mutant), which is why the threshold is below 100.

The threshold is `"break": 80` in `stryker.config.json`: a starting value chosen for this recipe, not a measured one.

### The review: `final_review`

The same kind of debate as `spec_review`, over the finished code, the spec and the mutation report.

### Checkpoints

All steps run in one detached worktree under `.indaba/worktrees/`, so your folder is not touched while the run goes. A
step's permissions are held by a scope guard that looks at everything changed since the worktree's last commit.
Without a commit between steps that write to different places, `implement` would be blamed for the files `tests`
wrote. Each checkpoint commits and moves the branch `indaba/inventory-app` to that commit, so each step is judged on its
own changes, and the branch keeps the work even if a later step fails. Steps that write to the same place (`specify`
to `tasks`, all in `specs/**`) share one checkpoint.

### How spec-kit is used

The spec-kit skills are written for an agent you talk to: they ask questions, and some run a small setup script first
(to find the feature directory or copy a template). In this workflow the agents read the skills and follow them, with
three changes written into each goal: the feature directory is named (`specs/001-inventory-app`), templates are copied
by hand instead of by the script, and questions are answered from the debate instead of by you. The agents then need
no terminal, so every step keeps the `edit` level and runs the same on Windows, macOS and Linux; every command in the
run is a shell step you can read in the file.

## 4. Check and plan

```bash
indaba validate crud-inventory.workflow.ai.yml
indaba plan crud-inventory.workflow.ai.yml
```

`validate` should print `crud-inventory is valid (19 steps, 4 roles).` followed by `permissions:` notes describing how
each runner holds the `edit` and `read` levels. `plan` prints the order, the runners, what each step may change and
what it reads from the board:

```text
1. foundation [architect] (runners acp -> claude-code; may only change .specify/memory/**, AGENTS.md, CLAUDE.md)
2. checkpoint_foundation [shell: git add -A && git commit -q --allow-empty -m "inventory-app: constitution and AGENTS.md" && git branch -f indaba/inventory-app HEAD] (after foundation)
3. specify [architect] (after checkpoint_foundation; runners acp -> claude-code; may only change specs/**, .specify/feature.json)
...
9. analyze [reviewer] (after checkpoint_spec; runners acp -> claude-code; may only change nothing)
10. skill [architect] (after analyze; runners acp -> claude-code; may only change .claude/skills/add-endpoint/**, AGENTS.md)
...
16. verify [shell: npm install --no-package-lock --no-audit --no-fund && npm test] (after checkpoint_code)
17. acceptance [shell: node acceptance/inventory.mjs] (after verify)
18. mutation [shell: npx stryker run] (after acceptance)
19. final_review [reviewer] (after mutation; consensus with architect)
```

Both commands start nothing and cost nothing.

## 5. Run it

```bash
indaba run crud-inventory.workflow.ai.yml
```

You get one line per state change, and the terminal stays free to answer when a debate cannot settle (see below). Do not
add `--tui` to this run: the dashboard cannot ask you, so a debate that fails would escalate instead of asking. To read the
facts, the debates, the analysis and the coder's questions as they arrive, use a second terminal: `indaba watch latest`
follows the same run, and `indaba ui` shows it in a browser (see [Web view](web-view.md)).

A retry is visible as steps going back to `PENDING`:

```text
  mutation       RUNNING -> FAILED (Command `npx stryker run` exited with code 1.)
  tests          COMPLETED -> PENDING (retry of mutation)
  ...
  tests          PENDING -> RUNNING
```

If a debate does not settle within its rounds, the run stops and shows you the transcript. Type `accept` to go on with
the findings as they stand, or `reject` and a one-line note to end the run. Your ruling is written to
`.indaba-decisions/crud-inventory.jsonl`, which is meant to be committed.

The last line is the result: `Task <id> finished: COMPLETED (trace <32 hex characters>)`. Exit status 0 is completed,
1 failed, 2 escalated (a debate you rejected, or a gate still failing after its retries), 130 cancelled.

## 6. Take the result

The work is on the branch, one commit per checkpoint (a mutation retry adds another `tests` and `code` commit, so you
can see what the gate changed):

```bash
git log --oneline indaba/inventory-app
git merge indaba/inventory-app
npm install
npm test
node acceptance/inventory.mjs
npm run mutation      # the same Stryker run as the gate; the HTML report is in reports/mutation/
npm start             # then open http://localhost:3000
```

```bash
curl -s -X POST localhost:3000/api/items -H "content-type: application/json" \
  -d '{"sku":"MUG-01","name":"Blue mug","quantity":12,"priceCents":900}'
curl -s "localhost:3000/api/items?lowStock=20"
```

Read the final review before you build on it: `indaba watch latest --plain` ends with the board, where every message of
both debates is a proposal, critique or agreement followed by the outcome, and the messages are also kept under
`.indaba/discussions/`.

To add a feature later, ask your agent in the project: it reads `AGENTS.md`, uses spec-kit's `/speckit-specify` for
the new feature and the `add-endpoint` skill for the work, and the same three gates tell you when it is done.

## When it goes wrong

| You see | It means | Do |
| :--- | :--- | :--- |
| `validate` reports a problem with a path such as `$.steps[3].permissions` | the file was changed into something Indaba cannot run | fix that field first and validate again |
| a worktree error, or `checkpoint_foundation` fails | no git repository, no commit yet, or no git name and email | step 1, and `git config --global user.name` / `user.email` |
| a step fails with `Expected output "..." was not produced.` | the agent answered without writing the file | run again; if it repeats, check the agent can write files (logged in, not in a read-only mode) |
| a step fails with `Changes outside the allowed scope` | the agent changed a file that was not its own | the reason lists the files; widen `fs.write` only if the change was right. `node_modules/` or `reports/` in the list means they are missing from `.gitignore` |
| `verify` fails at `npm install` | no network, or the registry could not be reached | fix the network and run again |
| `verify` or `acceptance` fails until the run ends `escalated` | the code could not be made to pass | `indaba watch latest --plain` shows the last failure and the coder's questions; often a test contradicts the spec. The branch holds the work so far |
| `mutation` fails until the run ends `escalated` | the tests still miss behaviours | run `npm run mutation` on the branch and read the survivors; some are equivalent mutants no test can kill. Add the tests yourself, or lower `break` |
| no runner of a step could run | neither ACP nor the `claude` CLI could start | the reason names each runner and why; see [Using the alpha](using-the-alpha.md) |
| a debate escalates with no question | there was no terminal (a pipe, CI, or `--tui`) | run from a terminal, or remove `arbiter: "human"` to let it escalate on purpose |

For anything else, `indaba report latest` gathers the log, the trace and the environment into one redacted folder; see
[Playbook: when a run fails](playbook.md#when-a-run-fails).

## Make it yours

- **Mix agents.** Give the reviewer another model, so the debates are not one model agreeing with itself: for example
  `agent: "codex"` or `agent: "gemini"` on the `reviewer` role, or `runner: "openrouter"` with a `model` (a text-only
  API runner is a good fit for review and debate, not for steps that write files). For Codex, initialise spec-kit with
  `--integration codex`; it puts the skills in `.agents/skills/`, so change the skill paths in the goals.
- **Your own stack.** Change the technical context in the `plan` goal, the gates (`pytest` and `mutmut run` for
  Python; `npx tsc --noEmit` and Stryker's TypeScript checker for TypeScript), the `fs.write` globs and `.gitignore`.
- **Your own app.** Change the feature description in the `specify` goal and write an acceptance test for its
  contract, or drop the `acceptance` step and let the debates and the tests carry it. The
  [quick start](cookbook-quick-start.md) does exactly that, from an `idea.md`.
- **More resources.** Run a second feature through `specify` to `implement` with its own feature directory
  (`specs/002-suppliers`) and its own `fs.write`, so the agents cannot step on each other's files.
- **A cheaper run.** Delete `spec_review`, `clarify`, `analyze` and `final_review` (and their entries in `depends_on`
  and `board.read.steps`), or drop `mutation` while you try the recipe out.
