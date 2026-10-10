# What Indaba is for

A short statement of what Indaba is, who it is for, what it deliberately is not, and which parts exist today.
It is written to decide what to build next: a feature that does not fit here needs a reason.

## In one paragraph

Indaba runs work that several AI agents and a person do together, in loops, and keeps a record of who decided
what. The engine, not a model, decides what runs next. The agents can examine each other's work, the person can
talk to them and answer their questions at any time, and the person chooses who makes the decisions: themselves,
a group of agents, or one agent they promote, such as an architect or a manager. Nothing is hidden: every step,
cost and decision is in a trace you can read afterwards.

## Who it is for

- **People who repeat work that is worth reviewing**: a change to a codebase, a document that needs drafting and
  checking, a media edit, a report. The work goes round a loop (do it, review it, revise it) until someone
  approves, with a limit on the loop.
- **Developers and people who are not.** A folder does not have to be a git repository, and the interface should
  not assume a terminal. Today you still need Node, and you write the workflow file by hand; a wizard and a web
  view are planned, not built.
- **People who want to stay in charge without sitting watching.** You can take part in every decision, leave the
  agents to decide, or hand decisions to an agent you chose, and change your mind during the run.

## What makes it different

1. **A conversation, not a black box.** You can send a message to the models and they can ask you questions.
2. **You decide who decides.** Indaba never chooses on its own to involve a person or to leave a decision to a
   model. It carries out your choice and records who made each decision. Answers from models are never recorded
   as human rulings.
3. **Deterministic and auditable.** The same workflow runs the same way. Runs leave traces with token and cost
   figures, and a decision ledger can be committed with your project.
4. **Safe by default.** Paths are confined, text from agents and from other people is treated as data and never
   run, secrets stay out of traces, and untrusted content is fenced when it goes into a prompt.
5. **Honest numbers.** Costs and limits are metered where a source reports them; unknown is shown as unknown,
   never as zero.
6. **Open to extension.** Runners, guards, arbiters and listeners are added through plugins; the built-in ones get
   no access a plugin lacks.

## What it is not

- **Not a cockpit for running many coding agents at once on a repository.** Indaba orchestrates a few agents that
  examine each other, not a queue of parallel tasks.
- **Not an editor or an IDE**, and not an agent itself: it drives agents and models you already have.
- **Not a hosted service.** It runs on your machine, with your keys and your logins.
- **Not a scheduler or a trigger platform** (run every morning, run when a file arrives), and no loops over lists
  of items. These are not in the current plan and will be reconsidered if asked for.
- **Not an automatic merger.** Changes leave a step as a patch for a person or a named decider to apply.

## Where each part stands

| Part | State |
| :--- | :--- |
| Workflow files: steps in a graph, quality gates, guards, retries, artifacts | Works (alpha) |
| Runners: API (OpenRouter and compatible), ACP agents, agent command lines (Claude Code, Codex, Cursor, Antigravity, OpenCode) with fallback between them | Works (alpha) |
| Debate between roles to consensus, a human arbiter, a committed decision ledger | Works (alpha) |
| Isolation in a git worktree, traces with cost, a live event stream, `watch`, and a terminal dashboard | Works (alpha) |
| Budgets and currencies, resume after a stop | Specified: `step-budgets` |
| Review loops with a verdict, running one step several ways and choosing, shared run notes (blackboard) | Specified: `step-verdicts`, `step-variants`, `run-blackboard` |
| Folders that are not git repositories | Specified: `workspace-without-git` |
| Talk to the models, choose who decides, shared skills and prompts, workflow inputs | Specified: `agent-conversation`, `workflow-inputs` |
| Workflow editor, schema and catalog for a wizard; ruling channel for other front ends; voter arbiter | Specified: `workflow-editor`, `ruling-channel`, `voter-arbiter` |
| Web view (a mirror of the terminal dashboard, richer later) and a desktop app | Planned, not yet respecified |

"Specified" means a written specification exists and nothing is built. The alpha has no stability promise.

## Using this page

When someone proposes a feature, ask: does it serve a repeatable, reviewable loop of agents and people? Does the
person stay in charge of who decides? Does it work without git and without a terminal? If a feature needs the
answer "no" to any of these, say why it is worth it.
