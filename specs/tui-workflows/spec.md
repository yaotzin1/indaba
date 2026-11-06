# Feature TUI-5: registry management in the terminal (`tui-workflows`)

> **Level**: feature of [`tui-epic`](../tui-epic/spec.md) (TUI-5). **Status**: Draft, specification only (revised 2026-11-06 after review).
> **Stage entry**: 1 · **Semver impact**: minor (provisional)
> **Depends on**: `tui-run-control` (it owns the read-only list and the picker); implemented `workflow-registry`, `web-app-registry`.

---

## 1. The problem

Changing the registry (a workflow's details, hiding it, copying it, the places Indaba looks) is done by `indaba workflows` (a command
with subcommands) and by the web view. The terminal application has no screen for it. The read-only list and the picker are in
`tui-run-control` (stories 2.3), because starting a run needs them; this feature adds only the management.

## 2. Stories

- **TUI-5.1** As a person, I edit a workflow's name, project and tags (kept beside the file) and hide or show it; hidden ones are off the list by default.
- **TUI-5.2** As a person, I copy a workflow to another folder of the list, under a name I choose.
- **TUI-5.3** As a person, I add a folder to the places Indaba looks (the path is shown after resolving) and rescan, seeing what changed.
- **TUI-5.4** As a person, I remove a missing workflow from the list.

## 3. Acceptance criteria

- [ ] AC-01 Every action calls the same registry controls as the web view (injected, epic R-02; shape re-exported by `@indaba/engine`); a refusal shows its code's message.
- [ ] AC-02 Paths typed by the person are shown resolved, confined as the registry confines them, sanitised and length-limited.
- [ ] AC-03 Hidden workflows are off by default and the choice is a key, not a hidden state.
- [ ] AC-04 Nothing is written to a workflow file by this feature; only the registry's own metadata and, for a copy, the new file through the registry.
- [ ] AC-05 Each action logs one `info` record with ids and no free text.

## 4. Non-goals

- Editing the content of a workflow (`TUI-6`). Creating a workflow from a template or a wizard (a later epic). The list and picker (`TUI-2`).

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| a folder disappears | its workflows are marked missing, never dropped silently |
| the metadata cannot be written | the refusal is shown; the list is unchanged |

## 6. Parity

| Capability | Web view | TUI | `--plain` / CLI |
| :--- | :--- | :--- | :--- |
| Details, hide, copy, add folder, rescan, remove | yes (`web-app-registry`) | this feature | `indaba workflows` |

## 7. Where it lives

`@indaba/tui` (screens), `@indaba/engine` (re-exports), `indaba` (injects the registry control).

## Artifacts not written

- `plan.md`: written when scheduled.
- `tasks.md`: written when scheduled.
- `research.md`: nothing external is relied on.
- `data-model.md`: the registry's data belongs to `workflow-registry`.
- `events.md`: the feature emits no event.
