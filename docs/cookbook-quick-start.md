# Cookbook: from an idea to an app

You write a few sentences about an application you want. Indaba does the rest: its agents argue your idea into a
first version, write the project's rules, a specification, a plan, the tasks, the skills the agents will use, the tests
and the code, and only finish when the tests pass and mutation testing shows that the tests would notice a broken app.
Then they review the result against what you asked for.

This page is the short way, and it is meant to show what the Indaba engine can do for you. The
[step-by-step cookbook](cookbook-crud.md) builds one application with every stage explained and every setting spelled
out; read it when you want to change how the work is done.

## What you get

A git branch, `indaba/app`, with one commit per stage:

| Commit | What is in it |
| :--- | :--- |
| Project rules | `AGENTS.md` (the rules every coding agent reads), `CLAUDE.md`, and `.specify/memory/constitution.md` (the project's principles, in [spec-kit](https://github.com/github/spec-kit)'s format) |
| Spec, plan and tasks | `specs/001-<name>/`: `spec.md` with user stories and requirements, `plan.md`, `data-model.md`, `contracts/`, `quickstart.md`, `tasks.md` |
| Project skills | `.claude/skills/<name>/SKILL.md`: one to three procedures for the work that will recur in your app, such as adding a feature |
| Tests | `package.json`, `stryker.config.json` and `test/` |
| Code | `src/` and `public/`: a Node 22 web app with a JSON API and one page, and no runtime dependencies |

If the mutation gate sent the run back, you see a second Tests and Code commit: what the agents changed to make the
tests stronger.

## What you need

- Node 22 or newer, npm, git (with your name and email set), and network access for `npm install`.
- [uv](https://docs.astral.sh/uv/), to install spec-kit's files with `uvx`.
- Indaba: `npm install -g indaba@next`.
- An agent: Claude, over ACP or as the logged-in `claude` CLI. See
  [Logging in to an ACP agent](getting-started.md#logging-in-to-an-acp-agent).
- A terminal for the run. Indaba asks you something only when the agents cannot agree.

## 1. Write your idea

```bash
mkdir my-app && cd my-app
git init
uvx --from git+https://github.com/github/spec-kit.git@v1.2.5 specify init --here --force --integration claude --script py --non-interactive
printf ".indaba/\nnode_modules/\nreports/\n.stryker-tmp/\n" > .gitignore
```

The `uvx` line installs spec-kit's templates and skills into the project (add `--ignore-agent-tools` if the `claude`
CLI is not installed). On Windows `cmd`, write `.gitignore` in an editor with those four lines.

Now write `idea.md` in your own words. A few sentences are enough; say who it is for and what they do with it:

```markdown
A stock list for my small shop: items with a code, a name, how many we have and the price.
I want to add items, take some out of stock when they sell, and see what is running low.
```

Other ideas that fit: a reading list for a book club with votes on the next book; a sign-up sheet for volunteer
shifts; a tracker for the plants in an office and when each was last watered. Keep it to something a person could
build in a day: the agents will cut anything bigger down to a first version, and tell you what they left out.

```bash
git add . && git commit -m "My idea"
```

## 2. Run it

Save [`examples/idea-to-app.workflow.ai.yml`](../examples/idea-to-app.workflow.ai.yml) in the folder and commit it
(`git add . && git commit -m "Add the workflow"`): with uncommitted changes Indaba does not reuse an earlier ruling of
yours, and asks again. Then:

```bash
indaba run idea-to-app.workflow.ai.yml
```

The terminal prints each stage as it runs, and stays free to ask you when a debate cannot settle (do not add `--tui`: the
dashboard cannot ask). To read what the agents tell each other, open a second terminal and run `indaba watch latest`, or
`indaba ui` for a browser. The run takes a while and costs what the agent calls cost: at least ten of them, more when a debate takes
several rounds or a gate sends work back.

## 3. Take the result

```bash
git merge indaba/app
npm install
npm test
npm start            # then open http://localhost:3000
```

Read `AGENTS.md` first: it says what was built, where everything is and how to work on it. The final review's findings
are at the end of `indaba watch latest --plain`.

## What Indaba does while you wait

| Stage | Who | What happens |
| :--- | :--- | :--- |
| Debate the idea | product, architect and tester agents | They argue your idea into a first version: who uses it, at most six features, what is left out, the data and its rules, the API, the edge cases. The run goes on only when all three would ship the same scope |
| Project rules | architect | A spec-kit constitution (spec first, tests first, mutation-tested, no runtime dependencies) and `AGENTS.md` |
| Spec, plan, tasks | architect | spec-kit's specify, plan and tasks skills, followed from the agreed scope |
| Skills | architect | Project skills for the recurring work, listed in `AGENTS.md` |
| Tests | tester | Tests from the spec, before any code exists |
| Code | implementer | Code that makes the tests pass. It is not allowed to change the tests |
| Test gate | Indaba | `npm test`. A failure goes back to the implementer with the error, up to three times |
| Mutation gate | Indaba | [Stryker](https://stryker-mutator.io/) changes the code in small ways and checks the tests notice. Below a score of 80, the run goes back to the tester with the changes no test caught, up to twice |
| Final review | product, architect and tester | They check the app against your idea and settle on one list of findings |

Three things hold the agents to the plan, whatever they write in their replies:

- **Each agent may only change its own files.** The tester cannot touch the code and the implementer cannot touch the
  tests, so "make the tests pass" cannot be done by weakening the tests. A step that changes anything else fails.
- **The gates run real commands.** A stage is done when `npm test` and Stryker say so, not when an agent says so.
- **They work on a copy.** Everything happens in a separate git worktree; your folder only changes when you merge.

## When Indaba asks you

If a debate does not settle within its rounds, the run stops and shows you what was said. Type `accept` to go on with
things as they stand, or `reject` with a one-line note to stop. Your answer is saved in `.indaba-decisions/`, and an
identical run later reuses it instead of asking again.

## When it stops early

The last line says how it ended: `COMPLETED`, `FAILED` or `ESCALATED` (a gate still failed after its retries, or you
rejected a debate). Whatever ended it, the branch `indaba/app` holds every stage that finished, so nothing is lost.

- `indaba watch latest --plain` shows each stage and why the last one stopped.
- A stage that failed with `Changes outside the allowed scope` changed a file that was not its own; the message lists
  the files.
- The [step-by-step cookbook](cookbook-crud.md#when-it-goes-wrong) has a table of failures and what to do.

## Where to go next

- Get a better result: the [tutorial](cookbook-tutorial.md) shows how to write the idea, what the rules, the specification
  and the skills are for, and how to read and fix what a run produced.
- Change the idea and run again in a new folder: the workflow does not know what app it builds.
- Ask your agent to add a feature: it reads `AGENTS.md` and the project skills, so it works the way this run did.
- The [step-by-step cookbook](cookbook-crud.md) explains every stage of a run like this one, with a fixed contract and an
  acceptance test, and how to change agents, gates and the stack.
