# Specification: Tracker triggers (start a run from an event of an issue tracker)

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 (the decisions in section 8 are recommended; the maintainer confirms them)
> **Semver impact**: minor (below 1.0): new optional contracts, a new `PluginHost` method, a new command, new events. Nothing
> that has been released changes. Provisional; confirmed in [`api-surface.md`](api-surface.md).
> **Builds on**: [`specs/workflow-inputs`](../workflow-inputs/spec.md) (values a run starts with),
> [`specs/web-app-actions`](../web-app-actions/spec.md) and `indaba`'s `run-control` (starting a run from outside the
> terminal), [`specs/step-budgets`](../step-budgets/spec.md) (a ceiling on spend), [`specs/logging`](../logging/spec.md) (the
> redaction), [`specs/host-process-containment`](../host-process-containment/spec.md). `workflow-inputs` is not implemented;
> this spec is implemented after it.
> **Origin**: a comparison with Cezar (2026-11-19), which integrates Jira and Linear: issues can be browsed and the tool reacts
> to tracker events.

---

## 1. The problem

A run starts when a person types a command or presses Run. The target scenario of Indaba is "build me app xyz": a request
becomes a spec, a plan and parallel work. Requests increasingly arrive as issues in a tracker, and today someone copies each
into a command by hand. There is no way for an event ("issue labelled `indaba`") to start the right workflow with the issue's
content as its input, and no contract a developer can implement for a tracker Indaba does not know.

## 2. User stories

- **US-01.** As a person, I tell Indaba "watch this source, and when an item matches this rule, run this workflow with the
  item as input", and I can stop it at any time.
- **US-02.** As a workflow author, I receive the issue's title, body, labels and link as workflow inputs, declared like any
  other input.
- **US-03.** As a person, the same event never starts two runs, and a burst of events never starts more runs than I allowed.
- **US-04.** As a developer embedding the engine, I add a tracker (Jira, Linear, GitHub issues, anything) as a plugin that
  implements one small contract, and it gets no access a built-in would not.
- **US-05.** As a person, I see what each event did: matched, started a run, ignored, or refused, and why.

## 3. Acceptance criteria

### The contract

- [ ] AC-01. `@indaba/core` defines `TriggerSource`: a named source that, given a cursor and an abort signal, returns a
      bounded page of `TriggerEvent`s and the next cursor. It performs no run, reads no environment and imports nothing.
- [ ] AC-02. A `TriggerEvent` has: the source name, a stable id, a kind (`created`, `updated`, `labelled`, `commented`,
      `other`), the item's title, body, labels, link and the time the source gave. Every field is data; none is trusted.
- [ ] AC-03. A plugin registers a source with `PluginHost.registerTriggerSource`; the CLI registers none of its own in this
      spec. Whether a concrete tracker adapter ships in this repository is not decided here (C-03).

### Listening

- [ ] AC-04. `indaba listen <workflow> --source <name> --match <rule>` polls the source at an interval (default 60 s, minimum
      15 s) and starts a run for each new matching event. It runs until stopped and stops cleanly on a signal.
- [ ] AC-05. Polling is the default and needs no inbound port. A source may also support push through a local receiver; that
      receiver binds only to `127.0.0.1`, requires the token scheme of `indaba ui`, and checks the source's signature on each
      delivery. A delivery that fails either check is discarded and counted.
- [ ] AC-06. A rule is data, not code: a kind, a list of labels (all must be present), an optional title pattern, and an
      optional `workflow` override per label. No expression language and no script.
- [ ] AC-07. Each event id starts at most one run, ever for that source and workflow. The ids already handled are kept in
      `.indaba/triggers/` (gitignored) so a restart does not repeat them.
- [ ] AC-08. At most `--max-concurrent` runs (default 1) started by `listen` are active; events beyond that wait in order and
      are not dropped. `--max-per-hour` (default 6) bounds starts; the rest wait, and the report says so.
- [ ] AC-09. A run started by `listen` needs a spend ceiling: the workflow's `step-budgets` ceiling, or `--budget`. With
      neither, `listen` refuses to start, naming the missing ceiling.

### What reaches the run

- [ ] AC-10. The event's fields are given as the workflow's declared inputs by name (`title`, `body`, `labels`, `link`, `id`),
      validated and bounded (body default 20,000 characters, longer is cut and marked). A workflow that does not declare an
      input receives nothing of it.
- [ ] AC-11. The item's text enters a prompt only through an input, as delimited data the prompt names as untrusted. It is
      never a command, a path, a branch name or a shell string; a branch or file name made from it uses the run id instead.
- [ ] AC-12. Permission levels are those of the workflow. A trigger can never raise a run's permission level or turn on
      `integrate` (`run-integration`) that the workflow did not set.

### Record and control

- [ ] AC-13. Events: `trigger.received`, `trigger.matched`, `trigger.started`, `trigger.ignored`, `trigger.refused`,
      `trigger.error`, each with the source, event id and, for `started`, the run id. The item's text is not in any event;
      its length is.
- [ ] AC-14. A source's credentials are given to the plugin by the composition root from the host's environment; they are in
      no event, trace, log, exception or artifact. A source error (network, authorisation) is retried with a bounded back-off
      and reported as `trigger.error`; it never stops other sources.
- [ ] AC-15. Listing and reading items (the "browse issues" half) is a second, optional member of the contract,
      `TriggerSource.list`, read-only. `indaba triggers list --source <name>` prints it. Writing back to a tracker (comments,
      status) is not part of this spec.
- [ ] AC-16. The web view and the dashboard show the state of a listener (running, last poll, queue, counts) read from its
      state file; starting or stopping one from the page is a later change (section 4).

## 4. Non-goals

- Writing to a tracker: no comment, status change or assignment. A plugin may do it through its own hooks; no contract here.
- A concrete Jira or Linear adapter in this specification (C-03).
- A rule language, a scheduler or cron: `listen` reacts to events; a schedule is the host's.
- Starting a listener from the web view in this spec.
- Reading attachments or anything the item links to.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the source cannot be reached | `trigger.error`; bounded back-off; the cursor is not advanced |
| a delivery fails the signature or token check | discarded and counted; no run |
| the workflow's inputs do not validate | `trigger.refused` with the field and reason; no run; the id is recorded so it is not retried forever |
| the process dies midway | the cursor and handled ids are written after each event is decided; at most the event in flight is seen again, and AC-07 stops a second run |
| a run started by `listen` fails | reported as any run; the listener goes on with the next event |
| the budget ceiling is missing | `listen` refuses to start (AC-09) |

## 6. Security and data handling

- Everything from a tracker is untrusted, including labels and titles: bounded, validated, passed as data (AC-10, AC-11).
- Nothing listens on a network interface by default. Push mode binds to loopback only; exposing it is the person's act and is
  outside this spec.
- A run that nobody watches is the case where a prompt injection costs most, so the ceilings (AC-08, AC-09) and the
  workflow's permission levels (AC-12) are required, not advised.
- Source credentials are secrets in the sense of `logging`'s redaction.

## 7. Where it lives

`@indaba/core`: `TriggerSource`, `TriggerEvent`, the rule type, the events (pure types, no `node:`). `@indaba/engine`:
the matcher, the handled-id store, the queue. `indaba`: `listen`, `triggers`, the composition root. `@indaba/server` and
`@indaba/web`, `@indaba/tui`: the listener's state, read-only. No dependency added.

## 8. Clarifications

- **C-01 (recommended).** Poll first, push second, so that the first version needs no inbound port.
- **C-02 (recommended).** Refuse to start without a spend ceiling (AC-09): an unattended listener with no ceiling is the
  expensive mistake.
- **C-03 (open, the maintainer decides).** Whether concrete tracker adapters are written in this repository or elsewhere. This
  spec supplies the contract either way.
- **C-04 (open).** The defaults of AC-04 and AC-08 (interval, concurrency, per hour) are proposals.

## Artifacts not written

- `plan.md`: stage 3 has not begun; written when `workflow-inputs` is implemented.
- `tasks.md`: stage 4 has not begun.
- `data-model.md`: the handled-id store is a small file; its layout is decided at stage 3.
- `research.md`: no tracker's API is used by this contract.
- `events.md`: the events are listed in AC-13.
