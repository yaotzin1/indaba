# Specification: Run integration (merge a finished run into a branch automatically, and resolve the conflicts)

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 (the decisions in section 8 are recommended; the maintainer confirms them)
> **Semver impact**: minor (below 1.0): new optional workflow field `integrate`, new optional CLI options, new events and
> attributes. The default (`off`) keeps today's behaviour. Provisional; confirmed in [`api-surface.md`](api-surface.md).
> **Builds on**: [`specs/parallel-steps`](../parallel-steps/spec.md) (landing into the run worktree and the resolution of a
> conflicting landing, stage 11), [`specs/git-workspace`](../git-workspace/spec.md) (the run worktree, the `Git` wrapper),
> [`specs/review-gate`](../review-gate/spec.md) (who may stop work before it goes on),
> [`specs/ruling-channel`](../ruling-channel/spec.md) (asking a person), [`specs/step-budgets`](../step-budgets/spec.md)
> (the spend of a resolution), [`specs/workspace-without-git`](../workspace-without-git/spec.md) (the `copy` isolation).
> **Origin**: a comparison with Cezar (2026-11-19) and the maintainer's request that the result of a run can be merged on
> its own, with the conflicts resolved, as an option.

---

## 1. The problem

`parallel-steps` lands each step into the **run worktree**, resolves the conflicts between steps there, and writes the
`patch` artifact. It states as a non-goal that it never changes the person's checkout. So when a run ends, the work is in a
worktree under `.indaba/worktrees/` and in a patch, and the person applies it by hand:

- a person who runs several workflows in a row (or the runs a tracker starts, `tracker-triggers`) gets a pile of patches
  to apply, each against a branch that has moved since the run forked;
- the conflicts that `parallel-steps` settles between *steps* come back as conflicts between the *run* and the branch, and
  nothing settles them: the person does it alone, without the agents that know the change;
- there is no way to say "when everything is green and reviewed, put it on my branch".

## 2. User stories

- **US-01.** As a workflow author, I say what happens to a finished run: nothing (as today), the result kept on a branch
  of its own, or merged into a target branch.
- **US-02.** As a person running a workflow, I turn automatic merging on for one run, with the target named, and I am
  told before it starts what will be changed.
- **US-03.** As a person, when the target branch moved since the run began and the merge conflicts, I choose what happens:
  the run stops and tells me, the agents resolve it, or I am asked.
- **US-04.** As a person, a merge that Indaba makes is never half done: either the target holds the whole, checked result
  or it is exactly as it was.
- **US-05.** As a person reading the run afterwards, I see whether it merged, onto which commit, who resolved a conflict
  and what they changed.
- **US-06.** As a developer embedding the engine, I replace the merge step (open a pull request, push to a remote) through
  the plugin contract, without editing the engine.

## 3. Acceptance criteria

### Modes

- [ ] AC-01. `integrate.mode` is `off` (default), `branch` or `merge`. With `off` nothing changes: the run ends as it
      does today and no event, span attribute or file of this spec appears.
- [ ] AC-02. `branch` writes the run's result as a new local branch `indaba/<run id>` from the run worktree. It never
      touches the checked-out branch, the index or the person's working files.
- [ ] AC-03. `merge` applies the result to `integrate.target`, a local branch the author or person **names**. There is no
      default target: a workflow with `merge` and no target is invalid (`diagnose` reports it).
- [ ] AC-04. Integration starts only when the run is `COMPLETED`: every step done, guards passed and every review or gate
      answered. A run that ends `FAILED` or `ESCALATED` is never integrated, in any mode.
- [ ] AC-05. `integrate` is refused, with a message that says why, when the workspace has `isolation: copy` or no git
      repository (`workspace-without-git`): there is no branch to merge into.

### How a merge is made

- [ ] AC-06. The merge is built in a worktree of its own from the target's tip, never in the person's checkout. The target
      branch moves in **one** step at the end, as a compare-and-swap on the commit the merge started from. If the target
      moved meanwhile, nothing is written and the merge is tried again once from the new tip (AC-14).
- [ ] AC-07. Before the swap the merged result is checked again with the run's guards (`git_diff`, scope and the rest) in
      the merge worktree. A result that fails them is not written; the integration ends `failed` with the guard's message.
- [ ] AC-08. `integrate.strategy` is `squash` (default: one commit on the target) or `merge` (a merge commit that keeps
      the run's commits). Fast-forward is used only when the target has not moved and the strategy is `merge`.
- [ ] AC-09. The commit message and its trailers come from the workflow (`integrate.message`, with the run id); Indaba adds
      a `Run:` trailer and no other attribution of its own.
- [ ] AC-10. Indaba never pushes, never force-updates a ref, never deletes a branch and never rewrites history. A remote,
      a pull request and a deletion are for a plugin (AC-22).
- [ ] AC-11. When the target branch is the one checked out, the integration refuses if the person's working tree has
      uncommitted changes, and otherwise moves the checkout with the ref in the same swap. It never stashes, resets or
      overwrites the person's files.

### Conflicts

- [ ] AC-12. `integrate.on_conflict` is `stop` (default), `resolve` or `ask`. A conflict changes nothing in the target.
- [ ] AC-13. `stop`: the integration ends `conflicted`, the run keeps its `COMPLETED` status, and the report names the
      conflicting files and the branch `indaba/<run id>` that holds the result (made as in AC-02 so nothing is lost).
- [ ] AC-14. `resolve` reuses the resolution of `parallel-steps` AC-24, with the run in the place of the step: the agent
      named by `integrate.resolver` (a runner list; default the runner of the last step) proposes the combined change in a
      fresh fork, a second agent (`integrate.examiner`, default the arbiter's) examines it, and they agree or go to the
      arbiter. An accepted resolution is checked as in AC-07, then merged as in AC-06.
- [ ] AC-15. One resolution is tried per integration, plus one new attempt if the target moved while it ran (AC-06). A
      resolution that fails its guards, conflicts again or is rejected ends the integration `conflicted` as in AC-13.
- [ ] AC-16. `ask` puts the conflict to the decider through `ruling-channel` with the files and hunks and these choices: the
      agents resolve it, keep the result on its branch, or drop the integration. With no one to answer the default of
      `ruling-channel` applies; if it has none, the integration ends `conflicted`.
- [ ] AC-17. The files and hunks given to a resolver come from git's output for the merge worktree, are made relative and
      checked to stay inside it. The agents' text is data, never a command, a path or a shell string.

### Control, cost and record

- [ ] AC-18. The spend of a resolution counts against the run's `step-budgets` ceiling. A resolution that would pass it is
      not started and the integration ends `conflicted`.
- [ ] AC-19. `--integrate <off|branch|merge>` and `--integrate-target <branch>` override the workflow for one run; the
      option never turns a workflow's `off` into `merge` without `--yes` or a confirmation shown first (the target, the
      strategy, the number of commits and the files that would change).
- [ ] AC-20. Events: `integration.started`, `integration.merged`, `integration.conflicted`, `integration.resolved`,
      `integration.failed`, each with the run, mode, target and, where it applies, the commit before and after. Span
      attributes `indaba.integrate.mode`, `.target`, `.outcome`, `.base`, `.result`, `.resolved_by`.
- [ ] AC-21. `indaba watch`, the TUI and the web view show the outcome and, for a resolution, who proposed, who examined
      and what the arbiter decided. The `patch` artifact is written as today, and a second one for a merged result.
- [ ] AC-22. The merge is behind a contract in `@indaba/core` (`RunIntegrator`) that the CLI registers through
      `PluginHost`, like a guard or a runner. The built-in one does `branch` and `merge` with local git; a plugin can
      replace it. The built-ins get no access a plugin lacks.

## 4. Non-goals

- Pushing, opening a pull request, merging on a host, deleting branches. They are a plugin's through AC-22.
- Resolving a conflict without an examiner, or more than one attempt: a conflict that two agents cannot settle comes to a
  person.
- Merging a run that did not complete, or merging parts of a run.
- Rebasing the person's branches or touching any branch other than the named target and `indaba/<run id>`.
- Deciding whether the target is a branch Indaba should be allowed to change. The person names it; Indaba does not keep a
  list.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the target branch does not exist | the integration ends `failed` before any worktree is made, naming the branch |
| the target moves while the merge is built | nothing is written; one new attempt from the new tip (AC-06) |
| the merge conflicts, `on_conflict: stop` | `conflicted`; the result is on `indaba/<run id>`; the target is untouched |
| the resolver fails, times out or is rejected | `conflicted` as above; its fork is removed |
| the merged result fails the guards | `failed`; nothing is written; the merge worktree is removed |
| the process dies midway | the target ref moves in one compare-and-swap, so it holds the old or the new commit and never a half merge; worktrees under `.indaba/worktrees/` remain as today |
| the run is cancelled during integration | the swap, if it has begun, completes (one ref update); otherwise nothing is written |
| the working tree of a checked-out target is dirty | refused (AC-11), the result is kept on `indaba/<run id>` |

## 6. Security and data handling

- Branch names, run ids and paths are validated and confined; git is run through the `Git` wrapper with argument arrays,
  never a shell string.
- The merge, and any resolver, work in a worktree Indaba owns, in an environment built by `host-process-containment`.
- A resolver sees the conflicting hunks of the repository it was already given to work on. Nothing is sent to a tracker,
  a host or a remote by this spec.
- The commit message is built from the workflow and the run id; text produced by an agent is not placed in a trailer.

## 7. Where it lives

`@indaba/core`: the `integrate` model, `RunIntegrator`, `IntegrationOutcome`, the events (pure types, no `node:`).
`@indaba/engine`: `integrate/` (the worktree merge, the compare-and-swap, the conflict loop on the `parallel-steps`
machinery), the parser and `diagnose` rules. `indaba`: the options, the confirmation, the composition root. `@indaba/tui`,
`@indaba/server`, `@indaba/web`: the outcome and the question. No dependency added.

## 8. Clarifications

- **C-01 (recommended).** Default `off`, `on_conflict: stop`, strategy `squash`: nothing changes for anyone until they ask,
  and the first thing they ask for is the safe one.
- **C-02 (recommended).** Local refs only. A remote and a pull request are a plugin (AC-10, AC-22), so no credential enters
  this repository's code.
- **C-03 (recommended).** The `branch` mode exists so that `stop` and a refusal never lose work: the result is always
  somewhere a person can find it.
- **C-04 (open, the maintainer decides).** Whether `resolve` may be the author's choice in the workflow file or must be
  turned on by the person at run time, because it spends money and changes a branch. The text above allows both and asks
  for confirmation (AC-19) when the run-time option widens the workflow.
- **C-05 (open).** Whether the examiner of a resolution may be the same runner as the resolver. `parallel-steps` requires
  the other agent; this spec follows it.

## Artifacts not written

- `plan.md`: stage 3 has not begun; written when the maintainer confirms section 8.
- `tasks.md`: stage 4 has not begun.
- `data-model.md`: nothing is stored beyond the run's artifacts and the branch.
- `research.md`: the behaviour is that of `git` and of `parallel-steps`, both specified; no outside source is needed.
- `events.md`: the events are listed in AC-20 and need no document of their own.
