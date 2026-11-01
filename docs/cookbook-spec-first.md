# Cookbook: you write the specs, Indaba reviews them

The other cookbooks hand an idea to agents and let them write the specification. This one is for the opposite habit:
**you** write every specification, by hand, the way spec-driven development (SDD) means it, and Indaba is the second
pair of eyes. You build an application one feature at a time: a login window, a list window, a window to add,
change and delete. For each feature, Indaba has two agents argue over your spec before any code exists, and over the
code once it does. When three features have gone through that loop, you write the loop down as a `workflow.ai.yml`, and
from then on the process is kept by Indaba: you write the spec, and the run does the rest the same way every time.

Every spec, word for word, and each step in the order you do it, are in the
[tutorial](cookbook-spec-first-tutorial.md). This page explains the process and the three workflow files.

This is the recommended way of working for an application you will keep. How it compares with the other cookbooks,
and what each of them shows: [Choose a way of working](playbook.md#choose-a-way-of-working).

## What gets built

**contacts-app**: the shared contact list of a small office, a JSON API and three windows (web pages), on Node 22 with
no runtime dependencies.

| Feature | Spec | Window | Built |
| :--- | :--- | :--- | :--- |
| 001 Login | `specs/001-login/spec.md` | `/login`: username, password, sign in; sign out everywhere | by you, reviewed by Indaba |
| 002 Contact list | `specs/002-contact-list/spec.md` | `/contacts`: search, sort by column, pages | by you, reviewed by Indaba |
| 003 Contact window | `specs/003-contact-edit/spec.md` | `/contacts/new`, `/contacts/<id>`: add, change, delete; told when someone else saved first | by you, reviewed by Indaba |
| 004 Export | `specs/004-export/spec.md` | an Export CSV button on the list | by the `workflow.ai.yml` you wrote |

Around the code, the documents every later person and agent reads:

| File | Is | Written by |
| :--- | :--- | :--- |
| `.specify/memory/constitution.md` | the principles every feature obeys; it outranks everything else | you, once |
| `AGENTS.md`, `CLAUDE.md` | the layout, the commands and the rules for coding agents | you, once |
| `specs/<NNN-name>/spec.md` | what one feature must do, in cases a tester can check | you, per feature |
| `workflow.ai.yml` | the process, kept: review the spec, tests first, code, test gate, review the code | you, after feature 003 |

The folder layout is spec-kit's (`specs/<NNN-name>/`, `.specify/memory/constitution.md`), so
[spec-kit](https://github.com/github/spec-kit) can be added later, but nothing here needs it installed.

## The process

```text
                 once                          for each feature                              after three features
  constitution, AGENTS.md  ->  write spec.md -> review-spec -> fix -> ... -> implement -> review-code   ->   workflow.ai.yml
                                  (you)         (Indaba)       (you)        (you, or      (Indaba)          (Indaba keeps
                                                                             your agent)                     the process)
```

1. **Write the spec.** User stories with *Given / When / Then* scenarios, numbered requirements (`FR-001` ...), the
   window's layout and states, the exact requests and answers, edge cases, and what is out of scope.
2. **Review the spec** with [`contacts-review-spec.workflow.ai.yml`](../examples/contacts-review-spec.workflow.ai.yml).
   Two agents read it against the constitution, `AGENTS.md` and the earlier specs, and debate until both accept the
   same list of findings: a requirement no test could check, a missing failure case, an unstated limit, a window state
   nobody described, a security gap. Nothing is changed; you read the findings.
3. **Fix the spec**, commit, and review again until what is left is only findings you decided to accept.
4. **Implement**: yourself, or by giving your coding agent the feature's spec (the tutorial has the prompt). Tests
   first, as the constitution says.
5. **Review the code** with [`contacts-review-code.workflow.ai.yml`](../examples/contacts-review-code.workflow.ai.yml):
   Indaba runs `npm test`, then two agents debate the code against the spec.
6. **After three features, keep the process**: [`contacts.workflow.ai.yml`](../examples/contacts.workflow.ai.yml),
   saved as `workflow.ai.yml`, does steps 4 and 5 for the next spec you write, and starts with a spec gate.

Why review before code: a gap found in a spec costs a sentence; the same gap found in code costs a test, a change and a
second review. In this process the spec is the one document a person owns. Agents write tests and code from it and
are told never to edit it, so the review is how it gets a second reader.

## What you need

- Node 22 or newer, npm, and git with your name and email set (the process workflow commits).
- Indaba: `npm install -g indaba@next`, or write `npx indaba@next` wherever this page writes `indaba`.
- One agent. The roles use Claude over ACP and fall back to the `claude-code` CLI when ACP cannot start. See
  [Logging in to an ACP agent](getting-started.md#logging-in-to-an-acp-agent) and [Using the alpha](using-the-alpha.md).
  A second, different agent (Codex, Gemini) as the second reviewer gives a more independent review: change the
  `tester` role's runner and agent.
- A terminal for the runs: the debates use `arbiter: "human"`, which asks you only when the agents cannot agree.

A review debate calls each of its two agents once per round, for up to four rounds, so one review is between two and
eight agent calls.

## The three workflow files

| File | Steps | Run it | Changes |
| :--- | :--- | :--- | :--- |
| [`contacts-review-spec.workflow.ai.yml`](../examples/contacts-review-spec.workflow.ai.yml) | `spec_review`: a debate of `reviewer` and `tester` over `spec.md` | after each draft of a spec | nothing |
| [`contacts-review-code.workflow.ai.yml`](../examples/contacts-review-code.workflow.ai.yml) | `verify` (`npm test`), then `code_review`: a debate over `src/`, `public/`, `test/` against the spec | after each feature is implemented | nothing |
| [`contacts.workflow.ai.yml`](../examples/contacts.workflow.ai.yml), saved as `workflow.ai.yml` | `check_spec`, `spec_gate`, `tasks`, `tests`, `implement`, `verify`, `code_review`, with three `checkpoint_*` commits | for each new spec, from feature 004 | the branch `indaba/specs/<NNN-name>` |

Each file names its feature once, at the top:

```yaml
artifacts:
  feature: "specs/001-login"   # the feature directory to review: change it for each spec
```

The goals refer to it as `${{ artifacts.feature }}`, so changing that one line points the whole file at the next
feature. `indaba run` has no option to pass a value in, which is why the line is in the file.

**Commit before every run.** Each review runs in a git worktree made from your last commit, so an uncommitted draft is
not what the agents read. The debates are read-only (`permissions: { level: read }`), and the scope guard fails the
step if anything changed.

## Reviewing a spec

```bash
git add specs/001-login && git commit -m "001-login: draft"
indaba run contacts-review-spec.workflow.ai.yml
indaba watch latest --plain        # in another terminal while it runs, or afterwards: the board at the end is the debate
```

How to read the result:

- **The debate's messages are the review.** In the first round each agent lists up to five findings and begins with
  `CRITIQUE:`. From then on, `AGREEMENT:` means "I accept the other reviewer's findings as the result" (not "the spec is
  good"), and `CRITIQUE:` means a finding is missing, wrong or badly worded. This is the
  [review debate pattern](workflow-format.md#pattern-a-review-debate); without it, two reviewers who find the same
  problems never settle.
- **`completed`** means they settled on one list. Read it on the board (`indaba watch latest --plain`) or in the web view
  (`indaba ui`). The transcript file of a debate is written inside the worktree, which is removed when the run ends, so
  the board is where the messages stay.
- **When they cannot settle**, the human arbiter shows you the transcript and asks `accept` or `reject`. Either answer
  ends the review; the findings are still the messages. Your ruling is appended to `.indaba-decisions/<workflow>.jsonl`.
  Commit that folder: it is the record of who decided what, and an identical re-run reuses the ruling instead of asking
  again.
- **Fix, commit, run again.** Each finding is either fixed in the spec, or accepted on purpose. Write an accepted one into
  the spec ("Out of scope: ...", or an edge case that says what happens) so the next review does not raise it again.

## Implementing a feature

The process does not mind who writes the code, as long as the tests come first and `spec.md` is not edited. Give your
coding agent (Claude Code, Codex, ...) the feature's directory and the rules; the tutorial has the exact prompt. It reads
`AGENTS.md` itself, and that file points it at the constitution. Then:

```bash
npm test
git add . && git commit -m "001-login: implemented"
```

## Reviewing the code

```bash
indaba run contacts-review-code.workflow.ai.yml
```

`verify` runs `npm test` in the worktree. If it fails, the run fails and no agent is called: fix the tests first.
Then `code_review` debates the code against the spec, with the same `AGREEMENT:` / `CRITIQUE:` meaning as the spec
review. Fix what you agree with, commit, and run it again if you changed much. A finding that says the *spec* is wrong
is fixed in the spec first, then in the code.

## Keeping the process: `workflow.ai.yml`

After feature 003 you have done the same thing three times. Save
[`examples/contacts.workflow.ai.yml`](../examples/contacts.workflow.ai.yml) at the root of the project as
`workflow.ai.yml` and commit it. It is the loop above, with the implementing done by agents:

| Step | Who | Does | May change |
| :--- | :--- | :--- | :--- |
| `check_spec` | shell | fails with `No committed spec at specs/<feature>/spec.md` when the feature line is wrong or the spec is not committed | |
| `spec_gate` | reviewer + tester | debate whether anything in your spec blocks building it | nothing |
| `tasks` | architect | `specs/<feature>/tasks.md`: the work in order, tests first, each task naming its file and requirement ids | `specs/**` |
| `checkpoint_tasks` | shell | commits, and points `indaba/specs/<feature>` at the commit | |
| `tests` | tester | a test for every requirement and scenario, failing for now | `test/**`, `specs/*/tasks.md` |
| `checkpoint_tests` | shell | commits | |
| `implement` | implementer | the code, until the tests pass; never `test/`, `package.json` or `spec.md` | `src/**`, `public/**`, `specs/*/tasks.md` |
| `checkpoint_code` | shell | commits | |
| `verify` | shell | `npm test`; a failure goes back to `implement`, with the end of the test output in its prompt, at most 3 times | |
| `code_review` | reviewer + tester | debate the code against the spec | nothing |

Three choices in it are worth knowing:

- **The spec gate is a go or no-go, not a list of findings.** Its goal makes `AGREEMENT:` mean "nothing in the spec blocks
  building it" (which is also what the engine tells debaters an `AGREEMENT` is). When a reviewer finds a blocker it
  answers `CRITIQUE:`, the debate does not settle, and the human arbiter asks you: `accept` builds anyway, `reject` ends
  the run before any test or code is written. You already reviewed the spec while you wrote it, so usually both agree
  in the first round and the run goes on.
- **Checkpoints.** Every agent step runs in one worktree, and the scope guard compares it with its last commit. Each
  `checkpoint_*` step commits, so `tests` is judged only on what it wrote; a tester that touches `src/` fails with
  `Guard diff_within_scope failed: Changes outside the allowed scope (test/**, specs/*/tasks.md)`.
- **The result is a branch.** The worktree is removed when the run ends; the commits are on `indaba/specs/<feature>`
  (for example `indaba/specs/004-export`). Merge it when you are happy with the review.

For each new feature:

```bash
# write specs/004-export/spec.md (review it with contacts-review-spec while you draft), then
# change the feature line in workflow.ai.yml to "specs/004-export"
git add . && git commit -m "004-export: spec"
indaba validate workflow.ai.yml && indaba plan workflow.ai.yml
indaba run workflow.ai.yml
git log --oneline indaba/specs/004-export      # tasks, tests, code (a second code commit after a retry)
git merge indaba/specs/004-export
```

The two review files stay useful: `contacts-review-spec` while you draft each spec, and `contacts-review-code` after any
change you make by hand.

## When it goes wrong

| What you see | Why | Do |
| :--- | :--- | :--- |
| The review talks about an old version of the spec | The draft was not committed | Commit, run again |
| `check_spec` fails: `No committed spec at ...` | The feature line names a directory that does not exist, or the spec is not committed | Fix the line in `workflow.ai.yml`, or commit the spec |
| A run ends `escalated` at `spec_gate` | You answered `reject` | Fix the blockers in the spec, commit, run again |
| `Guard diff_within_scope failed` | An agent wrote outside its step's files | Read which file in the message; run again, or narrow the goal |
| `verify` fails three times, then `escalated` | The code cannot pass the tests, or a test contradicts the spec | Read the board for a `question` from `implement`; fix the test or the spec, commit, run again |
| `npm test` never ends | A test leaves a server open when it fails | The constitution's rule II: tests close what they open in `t.after` |
| A second run overwrote the branch | Each checkpoint moves `indaba/specs/<feature>` | Merge or rename the branch before you run the same feature again |

## How this recipe was checked

The specs, the constitution and `AGENTS.md` are those of the tutorial. The API that the four specs describe was built as
a reference implementation, and 24 `node:test` tests of their requirements pass against it. The three workflows were run
end to end with stand-in agents (a plugin that writes the reference files instead of calling a model): real git,
worktrees, scope guards, checkpoints and `npm test`, including a `verify` failure sent back to `implement`, a scope
guard failure when the tester wrote under `src/`, and `check_spec` stopping a run whose feature line had a typo. They have not been run with real agents for this page yet, and real
agents word their findings differently every time. The windows (`public/`) were not part of the reference.

## See also

- [Tutorial: every spec, step by step](cookbook-spec-first-tutorial.md): the texts of the constitution, `AGENTS.md` and all
  four specs, and the commands in order.
- [Cookbook: CRUD, step by step](cookbook-crud.md): the same kind of app with agents writing the specs, spec-kit's skills,
  an acceptance test and mutation testing, any of which can be added to your `workflow.ai.yml`.
- [Workflow format](workflow-format.md): debates, the arbiter, permissions, guards, retries.
