# Spec-driven development a year on: patterns, evidence, a choice matrix, and Indaba

Amazon's Kiro (July 2025) and GitHub's Spec Kit (September 2025) put spec-driven development (SDD) at the centre of
AI-assisted coding. A year later there are dozens of frameworks, and comparing them product by product no longer helps much: they copy each other's best parts
quickly. This page looks at the **patterns** underneath them instead, what has actually been **measured**, which
pattern suits which **kind of change**, and where **Indaba** fits. The grouping and the matrix are this page's own;
the sources are listed at the end, and Jarosław Wąsowski's article "Spec-Driven Development Frameworks a Year Later"
prompted the structure.

Indaba is not an SDD framework. It writes no specs and prescribes no templates. It runs the stages of whichever
process you choose as a workflow: agents in order, gates between them, debates where two opinions help, each step
limited to the files it may change, and a trace of what happened. So the question on this page is not "Indaba or Spec
Kit" but "which pattern, and how does Indaba hold it in place".

## How seriously the spec is kept

Before the patterns, one distinction does most of the work. A 2026 practitioner's paper by Deepak Babu Piskala names
three levels of rigour, and they are a good vocabulary for everything below:

| Level | The spec is | After the first build |
| :--- | :--- | :--- |
| **Spec-first** | written before the code, to guide the first implementation | may be left behind; nothing forces it to stay true |
| **Spec-anchored** | kept next to the code as living documentation | every change of behaviour changes the spec first, or at the same time |
| **Spec-as-source** | the thing people edit; code is generated from it | code is never edited by hand |

Most frameworks start you at spec-first and promise spec-anchored. Spec-as-source, the most ambitious level, has
retreated over the year rather than spread.

## Four pattern families

### 1. The gated phase pipeline

**What it is.** A fixed sequence of documents, each written from the one before and checked before the next starts:
principles (a constitution), a specification, a technical plan, a task list, then the code. Every feature gets its own
folder, so features can be worked on side by side.

**Who does it.** Spec Kit (`/speckit.specify`, `plan`, `tasks`, `implement`, with `clarify` and `analyze` between
them), and Kiro's feature specs (requirements in EARS notation, a design, tasks), which now let you start from the
design instead of the requirements.

**Good at.** Traceability, and a clear place for a person to stop and read. **Weak at.** Ceremony for small changes,
and the spec tends to stay at spec-first: written well once, then not touched again.

### 2. Change deltas

**What it is.** Instead of one spec per feature, the repository holds the current truth (a spec per capability) and
each change is a small proposal that says only what it adds, changes or removes. When the change is done, the delta is
merged into the current specs and the proposal is archived, so history and present are both kept.

**Who does it.** OpenSpec (propose, apply, archive), which calls itself brownfield-first.

**Good at.** Existing codebases, where describing the whole system first is out of the question, and keeping the spec
current, because merging the delta is part of finishing the change. **Weak at.** Large new designs; and the merge is
still done by hand or by an agent, so drift is reduced, not prevented.

### 3. A planning team of role agents

**What it is.** Several agents with roles (analyst, product manager, architect and more) produce a
product requirements document, an architecture and small "story" files, each story carrying the context its developer
needs, before anyone codes.

**Who does it.** BMAD-METHOD, which also has a lighter quick mode.

**Good at.** Big features and regulated work, where the planning documents are themselves wanted. **Weak at.** Speed
and cost: it is the heaviest of the four, in tokens, in elapsed time and in the time it takes a team to learn it.

### 4. Gates and skills inside the prompt

**What it is.** No separate documents pipeline; instead, rules the agent loads every time (an `AGENTS.md` used as a
constitution, editor rules files) and skills that say "do not write code until a spec is approved". The discipline
lives in what the agent reads.

**Who does it.** Superpowers (its skills include a hard gate written into the prompt), `AGENTS.md` conventions,
Cursor rules, and every framework's own agent instructions.

**Good at.** Getting started in one command, and travelling with the repository to every agent. **Weak at.**
Enforcement: a gate written in a prompt is a request. An agent under pressure can skip it, and nothing outside the
agent notices.

### The families borrow from each other

The clearest sign of the year is convergence. Kiro, a phase pipeline, added a **design-first** variant and a separate
**bugfix spec** (current behaviour, expected behaviour, and behaviour that must not change), which is a step towards
change deltas. Spec Kit reached 1.0.0 in August 2026, one year after its first commit, with an extension system and a
guide for adopting it in an existing project, and community extensions add a post-implementation check of the code
against the spec. BMAD, the heaviest, offers a quick mode for smaller work. In practice a team now picks a family per kind of change, not
a product for life.

## What has actually been measured

Much of what is written about SDD is a vendor's promise or one team's impression. Sorted by how much weight it can
bear:

| Evidence | What it says | How far it goes |
| :--- | :--- | :--- |
| A comparison by type of change (reported by Wąsowski as the only public one he found) | four frameworks were within the noise of each other on tickets merged at first delivery | the one result that compares frameworks on the same kinds of change; it found no clear winner |
| A consultancy's benchmark (Reenbit, as reported by CodeMySpec) | one CRM dashboard took about 5.5 hours with BMAD and about 12 minutes with OpenSpec | one task, one team; it shows the cost of ceremony, not quality |
| A hands-on scoring of BMAD, Spec Kit and OpenSpec on one real feature, on 13 dimensions (RanTheBuilder) | Spec Kit's plans were well structured, but the code did not follow the spec's intent faithfully; BMAD added permission checks the others missed | one feature, one reviewer; useful for *what* to check |
| Time overhead quoted in tool guides | Spec Kit adds one to three hours or more per feature, review included; Kiro's spec flow adds 15 to 30 minutes on a new project | estimates, not controlled measurements |
| Keeping a spec true through later changes | the mechanisms exist (OpenSpec's merge and archive, Kiro's sync, review against the spec) | nobody has compared what they cost; this is the biggest open question |

Two cautions apply to all of it. Self-reported productivity has overstated benefits before (METR's warning, quoted in
several of these guides). And "merged at first delivery" says whether the work was accepted, not whether the spec is
still true six months later, which is the whole promise of the spec-anchored level.

### Measuring it yourself with Indaba

Because the evidence is thin, the most useful number is the one from your own codebase. Indaba records the same facts
for every run, whatever process the workflow encodes:

- each step's outcome, in order, and every **retry** (which gate sent the work back, and how many times);
- for a debate, its **outcome and rounds**, and for a human ruling, the **verdict**, also kept in the committed decision
  ledger (`.indaba-decisions/`);
- **time** per step, and **tokens and cost when the runner reports them** (a runner that reports nothing shows "unknown";
  Indaba never estimates them);
- the review's findings, on the board.

To compare two patterns, run the same change through two workflows in two clean clones, and compare: did it complete
without a human ruling, how many retries, how many debate rounds, how many review findings, how long, and what it
cost where that is known. `indaba watch <run> --plain` prints the summary and the board, and `indaba report <run>`
gathers the trace into a folder. This is a comparison of two runs, not a study; repeat it on a few changes of each kind
before you trust it.

## A choice matrix by kind of change

Pick per change, not per project. "Evidence" says what is behind the advice: **compared** (measured against
alternatives), **reported** (one team's trial), **documented** (the tools describe it; nobody has compared it), or
**open** (nobody knows yet).

| Kind of change | Pattern that fits | What the spec should hold | Indaba workflow shape | Evidence |
| :--- | :--- | :--- | :--- | :--- |
| **Bug fix** | a bugfix spec (the change-delta idea, small) | current behaviour, expected behaviour, and what must not change | a regression test first, a gate that the test **fails** before the fix, the fix, the full test suite | documented (Kiro's bugfix spec); no comparison found |
| **Feature in an existing codebase** | change deltas, or the phase pipeline scoped to one feature folder | only what the change adds or alters, with the existing behaviour it relies on | spec gate debate, tasks, tests, implement limited to the touched folders, test gate, code review | compared once: the frameworks were within noise of each other |
| **Change across several components** | phase pipeline with a written contract between components; role team when the design is the hard part | the contract (requests, events, shapes) and each component's part | one implement step per component, each with its own `fs.write`, then a contract or integration gate that sends the failing side back | documented; no comparison found |
| **New application** | phase pipeline; role team for regulated or very large work | the constitution, then a spec per feature | the [CRUD](cookbook-crud.md) or [spec-first](cookbook-spec-first.md) cookbook | reported (single-task timings); quality not compared |
| **Changing behaviour later** (keeping the spec true) | spec-anchored: the spec changes first | the changed requirement, edited in place, with its id kept | spec edit committed first, then the same workflow; a review that flags code doing what no spec says | open: mechanisms documented, cost unknown |

## How Indaba supports each family

| Family | What Indaba adds | Where to see it |
| :--- | :--- | :--- |
| Gated phase pipeline | runs each phase as a step with required `outputs`; `analyze`-style checks as read-only steps; a debate over the spec before the plan; checkpoint commits so every phase is its own commit | [CRUD cookbook](cookbook-crud.md) (Spec Kit's skills, step by step) |
| Change deltas | one workflow, pointed at a change by an artifact line; the scope guard limits a change to the folders it declares; a spec gate before code; the result on a branch, merged when reviewed | [spec-first cookbook](cookbook-spec-first.md) (`workflow.ai.yml`, one spec per change) |
| Role team | roles are first-class: each step names a role, and each role its own runner and model, so the architect and the reviewer can be different agents; `consensus_with` makes roles argue; board notes carry one role's findings to the next | [idea to app](cookbook-quick-start.md) (agents debate the idea) and [workflow format](workflow-format.md#consensus-steps) |
| Gates in the prompt | moves the gate out of the prompt: a shell step that must exit 0, a declared output that must exist, a scope guard that fails a step which wrote outside its files, a retry that sends the failure back. The agent cannot talk its way past them | [workflow format: guards and retries](workflow-format.md#guards) |

And for the two hardest rows of the matrix:

**Bug fix: prove the bug before fixing it.** A gate that requires the new test to fail first turns "I fixed it" into
evidence. A sketch, with the agents' steps shortened:

```yaml
artifacts:
  bug: "specs/bugs/012-login-crash"          # bugfix.md: current, expected and unchanged behaviour

steps:
  - id: "regression_test"
    role: "tester"
    isolation: "git_worktree"
    permissions: { level: edit, fs: { write: ["test/regression/**"] } }
    input_artifacts: ["${{ artifacts.bug }}/bugfix.md"]
    goal: >-
      Write tests in test/regression/ for the expected behaviour in ${{ artifacts.bug }}/bugfix.md and for each
      behaviour it says must not change. Do not change anything else and do not run commands.

  - id: "checkpoint_test"
    depends_on: ["regression_test"]
    runner: "shell"
    commands: ["git add -A", "git commit -q -m \"regression test\""]

  - id: "test_fails_first"                     # the bug is reproduced: the new tests must not all pass yet
    depends_on: ["checkpoint_test"]
    runner: "shell"
    commands:
      - "node -e \"const r = require('node:child_process').spawnSync(process.execPath, ['--test', 'test/regression/**/*.test.*'], { stdio: 'inherit' }); process.exit(r.status === 0 ? 1 : 0)\""

  - id: "fix"
    depends_on: ["test_fails_first"]
    role: "implementer"
    isolation: "git_worktree"
    permissions: { level: edit, fs: { write: ["src/**"] } }
    goal: "Fix the bug in ${{ artifacts.bug }}/bugfix.md so that every test passes. Do not change test/."

  - id: "verify"
    depends_on: ["fix"]
    runner: "shell"
    commands: ["npm test"]
    on_failure: { action: "retry_step", target: "fix", max_retries: 3 }
```

`test_fails_first` passes only when the new tests fail now; it fails when they all pass already (the bug was not
reproduced) and when there are none. It cannot tell a test that fails for the right reason from one that fails because
it is broken, so read its output in the run, or let the code review check it.

**Cross-component change: one writer per component, one contract gate.** Each component's step may change only its own
folder, so an agent fixing the web app cannot quietly change the API to suit itself:

```yaml
  - id: "implement_api"
    role: "implementer"
    isolation: "git_worktree"
    permissions: { level: edit, fs: { write: ["services/api/**"] } }
    goal: "Implement the API side of ${{ artifacts.change }}/contract.md."

  - id: "checkpoint_api"
    depends_on: ["implement_api"]
    runner: "shell"
    commands: ["git add -A", "git commit -q -m \"api side\""]

  - id: "implement_web"
    depends_on: ["checkpoint_api"]
    role: "implementer"
    isolation: "git_worktree"
    permissions: { level: edit, fs: { write: ["apps/web/**"] } }
    goal: "Implement the web side of ${{ artifacts.change }}/contract.md. The API side is done; do not change it."

  - id: "contract"
    depends_on: ["implement_web"]
    runner: "shell"
    commands: ["npm run test:contract"]
    on_failure: { action: "retry_step", target: "implement_api", max_retries: 2 }
```

**Keeping the spec true: make drift visible.** Indaba cannot keep a spec current for you, and neither can any tool yet
in a way anyone has measured. What a workflow can do is put the spec in the same review as the code: the code review
step reads the spec and is asked for "code that does something the spec does not ask for", the spec and the code land on
the same branch, and the human rulings that accepted a gap are committed in the decision ledger, so the next person sees
that it was a decision and not an accident.

## Sources

- [Jarosław Wąsowski, "Spec-Driven Development Frameworks a Year Later: Pattern Families, Measurements and a Choice
  Matrix"](https://medium.com/@wasowski.jarek/spec-driven-development-frameworks-a-year-later-pattern-families-measurements-and-a-choice-matrix-125bcddf1e64)
- [Deepak Babu Piskala, "Spec-Driven Development: From Code to Contract in the Age of AI Coding Assistants" (arXiv
  2602.00180)](https://arxiv.org/abs/2602.00180)
- [Kiro, "New spec types: fix bugs and build on top of existing apps"](https://kiro.dev/blog/specs-bugfix-and-design-first/)
- [Spec Kit releases (1.0.0, 1.0.1)](https://github.com/github/spec-kit/releases)
- [Reenbit, "BMAD vs Spec Kit vs OpenSpec: Choosing Your Spec-Driven AI Framework"](https://reenbit.com/bmad-vs-spec-kit-vs-openspec-choosing-your-spec-driven-ai-framework/)
- [CodeMySpec, "Best Spec-Driven Development Tools (2026)"](https://codemyspec.com/blog/best-spec-driven-development-tools)
- [RanTheBuilder, "I Tested Three Spec-Driven AI Tools"](https://ranthebuilder.cloud/blog/i-tested-three-spec-driven-ai-tools-here-s-my-honest-take/)
- [Augment Code, "6 Best Spec-Driven Development Tools for AI Coding in 2026"](https://www.augmentcode.com/tools/best-spec-driven-development-tools)
- [Jarosław Wąsowski, "Comparing 15 Spec-Driven Development Frameworks"](https://medium.com/@wasowski.jarek/comparing-15-spec-driven-development-frameworks-artifacts-and-decision-paths-sdd-c052df529274)
  (Superpowers' prompt gate)
