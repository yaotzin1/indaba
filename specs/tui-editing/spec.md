# Feature TUI-6: editing a workflow in the terminal (`tui-editing`)

> **Level**: feature of [`tui-epic`](../tui-epic/spec.md) (TUI-6). **Status**: Draft, specification only; **deferred behind a demand check** (revised 2026-11-06 after review).
> **Stage entry**: 1 · **Semver impact**: minor (provisional)
> **Order**: story 6.1 first (cheap, no new dependency); stories 6.2 to 6.6 start only when the maintainer confirms demand, because a
> multi-line editor with live validation has no Ink primitive and the web view already edits.
> **Depends on**: `tui-workflows`; implemented `workflow-editor`, `web-app-editing-core`, `web-app-editing-forms`.

---

## 1. The problem

A workflow can be edited as a form or as text in the web view. In the terminal the person must open another editor and run
`indaba validate` by hand, with none of the choices the installation knows (runners, roles, models).

## 2. Stories

- **TUI-6.1** As a person, I open the selected workflow in my editor (`$VISUAL`, then `$EDITOR`), and when I return it is validated and the problems are listed with their line.
- **TUI-6.2** As a person, I edit a workflow as a form: its name, roles (runner, model), steps (add, remove, move) and what a step's agent may change.
- **TUI-6.3** As a person, choices of runner and role come from my installation (plugins included), as in the web view.
- **TUI-6.4** As a person, I edit the text in the application with live validation.
- **TUI-6.5** As a person, saving changes only what I touched (comments and order stay), and a file changed on disk since I opened it is not overwritten.
- **TUI-6.6** As a person, a draft with problems is saved too, and cannot run until they are fixed.

## 3. Acceptance criteria

- [ ] AC-01 (6.1) The editor is started with an argument array and no shell; the application suspends and restores the terminal around it, also on failure; a missing editor is reported.
- [ ] AC-02 (6.2 to 6.4) The form and the text use the engine's own document model, validator and catalog (injected; shapes re-exported by `@indaba/engine`; no second parser).
- [ ] AC-03 (6.5) A change is written at its place and nothing else moves (same function as the web view); a conflicting write is refused and the person chooses to reload or keep their draft.
- [ ] AC-04 (6.4) The text editor works with a keyboard only and says how to leave it (no trap).
- [ ] AC-05 (6.2) What the form cannot edit is named, as in the web view, and left untouched.
- [ ] AC-06 Typed text is sanitised when echoed and never put in a shell or a log; each save logs one `info` record with ids only.

## 4. Non-goals

- A graph editor (the web view). Any new dependency for a text editor widget: 6.4 is built only if the demand check passes and only on Ink.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the file changed on disk | the save is refused with the reason; nothing overwritten |
| the text has problems | saved as a draft; listed; Run disabled |
| `$EDITOR` fails or is unset | the reason is shown; the terminal is restored |

## 6. Parity

| Capability | Web view | TUI | `--plain` / CLI |
| :--- | :--- | :--- | :--- |
| Edit in the user's editor | n/a | 6.1 | the user's editor, then `indaba validate` |
| Form editing | yes | 6.2, 6.3 (deferred) | `indaba validate`, `schema`, `catalog` |
| Text editing | yes | 6.4 to 6.6 (deferred) | the user's editor |
| Graph editing | yes | out of scope (epic non-goal) | no |

## 7. Where it lives

`@indaba/tui` (screens), `@indaba/engine` (re-exports), `indaba` (injects the editor control and starts the user's editor).

## Artifacts not written

- `plan.md`: written when scheduled.
- `tasks.md`: written when scheduled.
- `research.md`: nothing external is relied on.
- `data-model.md`: the document model belongs to `workflow-editor`.
- `events.md`: the feature emits no event.
