# Working on the web view

How the page of `indaba ui` is built, the rules it keeps, and how to change it without breaking them. What the page
does for a person is in [web-view.md](web-view.md); why it is shaped this way is in
[`specs/web-app`](../specs/web-app/spec.md) (the plan's "Decisions taken while building the page" records the choices
made while building it). The repository's rules in [`workflow.ai.yml`](../workflow.ai.yml) and
[`AGENTS.md`](../AGENTS.md) apply here as everywhere: pick a track, keep the spec directory current, pass the gates.

## The pieces

```text
.indaba/traces/*.jsonl  ─►  @indaba/engine        TraceReader, reduceRun: records to RunState (shared with the dashboard)
                        ─►  @indaba/server        node:http, token and Host checks, JSON and Server-Sent Events, static files
                        ─►  @indaba/web           the page: React, apsw-gridwright, React Flow, built to static files
                             @indaba/core          the contract types both sides compile against (types only)
```

| Package | Is | Imports |
| :--- | :--- | :--- |
| `packages/core/src/web-contract/` | The shapes the page and the server share: `RunSnapshot`, `RunSummary`, `StepView`, `StepStructure`, the request and response types. Declarations only | nothing |
| `packages/engine/src/trace/` | Reading a run: `TraceReader`, the reducer that the dashboard and the page both use, `readStructure` for the recorded graph | core |
| `packages/server/` | `startServer({ roots, staticDir, port?, token?, discussionDirectories?, logger?, loggingSettings?, runs?, workflowStore?, workflowEditor?, registry? })`: the API under `/api/v1`, the streams, the page's files. `defaultPageDirectory()` finds the page: its own `page/` in an installed package, `packages/web/dist` in a checkout | core, engine, `node:` |
| `packages/web/` | The page. **Private**: never published on its own. Vite builds it into `packages/web/dist`, which ships inside `@indaba/server` (see [Packaging](#packaging)) | its own files, the libraries below, `import type` from core |
| `packages/cli/src/ui.ts` | `indaba ui`: loads `@indaba/server` lazily, asks it for the page, starts it with the backends `main.ts` builds (logging settings, run control, workflow store and editor, registry), opens the browser | the server through `server-loader.ts`, never statically |

Nothing imports `@indaba/web`, and `@indaba/web` imports no `node:` module and no other Indaba package at run time.
`packages/web/test/layers.test.ts` and `packages/server/test/layers.test.ts` fail the build if that changes.

### Inside `packages/web/src`

| File | Holds |
| :--- | :--- |
| `main.ts` | `boot(window)`: takes the token out of the address, makes the client, renders `App`. The only file that imports CSS |
| `client.ts` | Every request: the token as a header, the contract check, the streams read with `fetch` and resumed after a drop |
| `sse.ts` | The Server-Sent Events parser the streams use (`EventSource` cannot send a header) |
| `session.ts` | Reading the token from `#token=` and removing it from the address |
| `graph-model.ts` | A run or a workflow draft to nodes and edges, laid out left to right by `@dagrejs/dagre`, plus pure helpers for graph brick and connection edits |
| `format.ts`, `status.ts` | Durations, money, tokens, times; a state's symbol, word and colour class. Pure |
| `cost.ts` | The cost of a step and the rows of a run's cost table, added up the way the engine's reducer adds up the run's. Pure |
| `messages.ts` | Every string the page shows |
| `styles.css` | The tokens of both themes and every rule; the `--gw-*` mapping for the grids |
| `ui/App.ts` | Header, theme switch, the screen the address names, the messages that replace a screen |
| `form-model.ts`, `registry-model.ts`, `settings-model.ts` | The form's fields read from the schema, the rows of the Workflows screen, the state of the Settings screen. No React |
| `ui/RunsScreen.ts`, `ui/RunScreen.ts`, `ui/WorkflowsScreen.ts`, `ui/SettingsScreen.ts` | The Runs, Run, Workflows and Settings screens |
| `ui/RunPanel.ts` | The Run a workflow panel: the list, the confirmation, full access, starting |
| `ui/WorkflowDialogs.ts`, `ui/Modal.ts` | The Workflows screen's dialogs (details, copy, import, remove) and the dialog that keeps focus inside |
| `ui/RunGraph.ts`, `ui/StepPanel.ts`, `ui/StepsGrid.ts` | The graph (view mode for a run, edit mode for a workflow draft), the selected step, the step list |
| `ui/FormView.ts`, `ui/GraphView.ts`, `ui/SourceScreen.ts` | The three views of a workflow draft (Form, Graph, Source) and the shared edit queue |
| `ui/CostTable.ts`, `ui/Discussion.ts` | The cost of each step that called a model; a debate's kept messages, loaded when opened |
| `ui/router.ts`, `ui/theme.ts`, `ui/parts.ts` | The address, the theme, small shared parts |
| `ui/stale.ts`, `ui/media.ts` | Whether what is shown is the last known state (the app provides it, every chip and card reads it); a media query as a hook, for the graph's direction below 640 px |

## Run it while you work

```bash
pnpm build                       # every package, then the page (pnpm --filter @indaba/web build)
pnpm indaba ui --no-open         # the runs of this checkout, served with the built page
pnpm try:ui -- --demo            # a throwaway run with a retry, then the same server over it
```

After changing the page, `pnpm --filter @indaba/web build` rebuilds only the page; reload the browser (the server reads
the files on each request). After changing the server or the CLI, stop it and run `pnpm build` again. `try:ui` is in
`scripts/try-ui.mjs` and is kept for `--demo`, which makes the project to look at.

## The rules the page keeps

### React without JSX

Components are written with `createElement`, imported as `h`, in `.ts` files, as `@indaba/tui` does:

```ts
import { createElement as h, type ReactElement } from 'react';

export function StateChip(props: { readonly look: StateLook }): ReactElement {
  return h('span', { className: `state ${props.look.tone}` }, h('span', { 'aria-hidden': true }, props.look.symbol), props.look.word);
}
```

This is deliberate. The security audit (`scripts/security-audit.mjs`), the coverage measurement and the root
typecheck all read `.ts`; a `.tsx` file would be outside every one of them. Do not add JSX without extending those gates
first, in a change of its own with a `Workflow-Change:` trailer.

### Types only from core

The page takes nothing but types from `@indaba/core` (`import type { RunSnapshot } from '@indaba/core'`). A value
import would pull core into the bundle and, worse, could pull Node code toward the browser. The layers test checks it.
If the page needs a new shape, declare it in `packages/core/src/web-contract/` (declarations only; its own test fails on
a value) and export it from core's index.

### Text from a run is text

Agent output, reasons, commands and notes are untrusted. Render them as React text children, which React escapes;
never `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML` or a link built from run data. The server has
already removed escape sequences, but the page does not rely on that. The layers test fails on any HTML sink, and
`packages/web/test/ui.test.ts` renders hostile output and checks that no element came out of it. When you write a
hostile string in a test, build it from fragments: the security audit reads tests too.

### No invented numbers

A cost that is not known is `unknown`; a total with an unknown part is `at least … (partial)`; a step with no budget is
`no limit`. Use `formatRunCost` and `formatCallCost` in `format.ts` rather than formatting money in a component.

### Every string in the catalogue

Text a person reads goes in `messages.ts`, with a function when it needs values, so a translation can reorder the
words. Data from the run (step ids, runner names, output) is not a string of the page and is shown as it is.

### State is the address

The page keeps what a person expects to survive a reload in the address: the screen, `?step=` and the Workflows screen's `?hidden=1` (spec C-05). Use
`navigate` from `ui/router.ts`; a step change replaces the history entry instead of adding one. The theme is the one
thing in `localStorage`, read and written inside `try`, because storage can be blocked.

### Reactive: live and any width

The maintainer's standing requirement. **Live**: everything a run changes reaches the screen without a reload, through
the streams (`followRun`, `followServer`); a component never fetches on a timer, and a new field shown from a run is
read from the snapshot the stream delivers. **Any width**: from 320 px to a wide desktop, the page never scrolls sideways.
A wide thing scrolls inside its own box (the graph pans, a table scrolls in `.table-scroll`), a grid uses `responsive()`,
the least useful column of a table carries `narrow-hide`, and long text (a failure reason, output) wraps rather than
widening a column. Check both before you say a change is done:

```bash
pnpm try:ui -- --root <a project with a run going>   # watch it move without reloading
```

and look at the page at 320, 375, 768 and 1440 px wide (a browser's device toolbar does it); in each,
`document.documentElement.scrollWidth` must equal `clientWidth`.

### Colour never alone

A state is a symbol and a word (`status.ts`); colour repeats them. A new state needs all three, in both themes.

## Themes and the look

`styles.css` defines the tokens on `:root` for the light theme and redefines them for dark under
`@media (prefers-color-scheme: dark)` (unless the person chose Light) and under `[data-theme="dark"]`.

| Token | Use |
| :--- | :--- |
| `--bg`, `--panel`, `--well`, `--table` | The page, a panel, an inset (output, child rows), the graph's canvas |
| `--ink`, `--muted`, `--line`, `--line-strong` | Text, secondary text, hairlines, edges and control borders |
| `--brand`, `--brand-wash`, `--brand-ink` | The ochre of the Indaba mark: current page, focus, links, selection. Never a state |
| `--ok`, `--run`, `--fail`, `--esc`, `--pend` and their `-bg` | The five state colours. Escalated is violet so it is never read as the accent |

Rules for a change to the look:

- Every text and state pair meets WCAG 2.2 AA (4.5:1) in both themes. Check a new colour against its background
  before using it; the current pairs are 5.1:1 or more.
- Type is Atkinson Hyperlegible Next for the interface and Atkinson Hyperlegible Mono for output and code, bundled from
  `@fontsource` and served by the page itself.
- The graph's dotted canvas is the one decorative element. Panels are flat (no shadows); the radius falls with rank:
  12 px for a region, 8 px for an item, 5 px for a chip.
- Motion only shows that something is running, and stops under `prefers-reduced-motion`.
- Biome checks CSS too, including `noDescendingSpecificity`: put a rule after the more specific ones that target the
  same element, or target a different element.

The sketches in [`specs/web-app/sketches`](../specs/web-app/sketches/README.md) use the same tokens and are the
reference for a new screen: sketch it there first, as AC-21 asks, then build it.

## Tables: apsw-gridwright

Every table of rows is an `apsw-gridwright` grid, pinned to an exact version in `packages/web/package.json`. It is
themed by mapping its `--gw-*` properties onto the page's tokens in `styles.css` (`body .gw-root.ix-grid`, specific
enough to win over the grid's own dark-mode rule), so give every grid `className: 'ix-grid'`.

```ts
const ADDONS = [responsive<RunSummary>({ stackBelow: 560 })];   // outside the component, or in useMemo

h(Gridwright<RunSummary>, {
  className: 'ix-grid',
  'aria-label': messages.runs.gridLabel,
  columns,                       // useMemo
  data: runs,
  getRowId: (run: RunSummary) => run.runId,
  addons: ADDONS,
});
```

- **Give the row type to every add-on** (`responsive<RunSummary>()`, `treeData<StepRow>(...)`): with
  `exactOptionalPropertyTypes` an add-on typed `unknown` does not fit the grid.
- **Keep add-ons and columns stable**: build them outside the component or in `useMemo`.
- **A tree is `role="treegrid"`**, which matters in tests (`findByRole('treegrid', ...)`).
- **A short list needs no paging**: `coreAddons<Row>().filter((a) => a.name !== PAGINATION_ADDON)`, as the step list does.
- **Narrow screens**: `responsive()` hides a column with `responsive: { hideBelow: <px> }` or turns rows into cards with
  `stackBelow`.

A gap in the grid is fixed in `apsw-gridwright` and the pin moved, not worked around here (spec C-02).

## The graph: React Flow

`ui/RunGraph.ts` draws what `graph-model.ts` computed; React Flow lays out nothing. Three things to keep:

- **The graph is controlled.** The selected step comes from the address. React Flow reports what the person did through
  `onNodesChange`, and `selectionOf` takes the chosen step from those changes. Do not read the canvas's own selection
  back (`onSelectionChange`): the canvas and the address then chase each other in an update loop.
- **`nodeTypes` is a constant** outside the component; a new object on each render remounts every node.
- **A wide graph opens readable**: `initialZoom` keeps cards at 0.8 or larger and starts from the left edge, and the reader
  pans.

The structure comes from the run itself (`RunState.structure`, written by the engine when the run starts as
`indaba.workflow.structure`), never from the workflow file, which may have changed since. A run without it is shown as
a row of steps with a note.

## Adding something the page shows

1. **Is it in the run already?** Look at `RunState` in `packages/core/src/web-contract/run.ts`. If it is not, the engine
   records it first (a trace attribute or event, a minor, with its own tests), and the reducer reads it, so the
   dashboard can show it too.
2. **The shape** goes in `@indaba/core`'s `web-contract`, types only.
3. **The server** sends it: an endpoint in `packages/server/src/server.ts` (a `GET` under `/api/v1`, an id matched before
   any path is built, text cleaned), with a test over HTTP.
4. **The client** reads it in `client.ts`, checking the shape it received, with a test against a fake `fetch`.
5. **The page** shows it: logic in a pure function with a unit test, the component with a test in happy-dom, strings in
   `messages.ts`.
6. **The documents**: [web-view.md](web-view.md) for what a person sees, `specs/web-app/api-surface.md` for a contract
   change, and `CHANGELOG.md`.

## Something the page does: a write

Run and Stop ([`specs/web-app-actions`](../specs/web-app-actions/spec.md)) are the pattern for anything the page changes.

1. **The server does no work itself.** It defines an interface (`RunControl` in `packages/server/src/run-control.ts`,
   like `LoggingSettingsBackend` and `RegistryControl` in `packages/server/src/registry-control.ts`) and the command line
   supplies it; `packages/server/test/layers.test.ts` keeps the server
   from spawning a process or writing a file. Without the backend, the resource answers 404 and the page offers nothing.
2. **The checks of every write** are in `server.ts`: the token, the `Host`, the page's own `Origin` (a write without one
   is refused), a JSON body of at most `MAX_BODY_BYTES`, and only the fields the contract names are read. Ids from the
   path are checked for shape before anything is looked up.
3. **A refusal has a code.** The backend throws an error named `RunControlError` with a `code`; the server maps each code
   to a status and plain words, and the page maps the code (never the status) to a message from `messages.actions`.
   The server recognises the error by name and code, not class, because the command line does not import the optional
   `@indaba/server`; the registry's refusals are named `RegistryControlError` and handled the same way.
4. **The command line does the work** in `packages/cli/src/run-control/`: the workflows of the registry through
   `registry.ts` (`createRegistryHub`: one hub per set of served roots plus the per-user list of folders, shared by the
   run control, the workflow store and the Workflows screen) and `finder.ts` (scanned at most every 30 seconds; without a
   registry, step 2's bounded scan and ids), the confirmation store in
   the user's configuration folder, the run copy, one `indaba run` child per run through `createRunStarter`, and stop
   (cancel, a grace period, then `kill()` of the process tree). Its tests use a fake `RunStarter`, never a real agent.
5. **The end-to-end tests** (`packages/cli/e2e/ui-run.e2e.test.ts`, `ui-edit.e2e.test.ts`, `ui-registry.e2e.test.ts`)
   run the built CLI with shell steps only.

Editing a workflow's text ([`specs/web-app-editing-core`](../specs/web-app-editing-core/spec.md)) follows the same
pattern with `WorkflowStore` (`packages/server/src/workflow-store.ts`) and `packages/cli/src/run-control/source.ts`. A
save is always against the hash the page read (`baseHash`); the store re-reads the file just before it renames a
temporary file over it, and a different hash is `changed_on_disk` with the disk's version. The page never builds YAML.

The form ([`specs/web-app-editing-forms`](../specs/web-app-editing-forms/spec.md)) sends every change as an edit of a
path to `POST /api/v1/workflows/edit`, with the draft's text; `WorkflowEditor` (`packages/server/src/workflow-editor.ts`,
which also checks the limits of a request) is supplied by `packages/cli/src/run-control/editor.ts`, which applies it with
`WorkflowDocument` and answers the new text, the document as JSON and its problems with their `path`. It runs on the
command line because the page takes only types from `@indaba/core`, and the parser imports Node modules. The fields
come from the schema (`GET /api/v1/editor`, with the catalog): `src/form-model.ts` reads it, with no React, and
`src/ui/FormView.ts` renders it. Edits are queued in `SourceScreen.ts`, one at a time, and an answer for a draft that
changed meanwhile is dropped. `test/workflow-schema.json` is the schema the page's tests use; a test in
`packages/cli/test/main-extra.test.ts` fails when it differs from `indaba schema`, and says how to write it again.

## Tests

```bash
pnpm vitest run packages/web                     # the page's tests
pnpm vitest run packages/web/test/ui.test.ts -t "Run screen"
pnpm qa                                          # everything, with coverage
```

| File | Covers |
| :--- | :--- |
| `test/logic.test.ts` | Formatting, states, the token, the stream parser, the graph model, the address, the theme. No DOM |
| `test/client.test.ts` | The client against a fake `fetch`: headers, failures, resume with `Last-Event-ID`, back-off, abort |
| `test/form-model.test.ts` | The fields read from the real schema, the choices, where problems go, the permissions presets, entries and edits, the line of a key. No DOM |
| `test/form.test.ts` | The form in happy-dom over a fake editor that works on JSON text: the two views, every kind of field, the presets, the steps, problems at their field, the order of edits, and the graph editor |
| `test/cost.test.ts` | The cost of a step and the rows and total of a run's cost table |
| `test/workflows.test.ts` | The Workflows screen: the list, Edit details, Copy, Import a folder, Remove from the list, Scan again, dialogs keeping focus |
| `test/registry-client.test.ts`, `test/registry-model.test.ts` | The registry's requests in the client, and the rows of the Workflows screen |
| `test/settings.test.ts` | The Settings screen and its model |
| `test/ui.test.ts` | The screens in happy-dom with a fake client: navigation, live updates, reconnecting, blocking messages, hostile output, the Run a workflow panel (focus, the confirmation, starting, refusals), Stop, and the source view (check, save, conflict, leaving with unsaved changes) |
| `test/boot.test.ts` | Starting the page: the token leaves the address and travels as a header |
| `test/layers.test.ts` | What the page may import, no HTML sink, nothing imports the page, the package stays private |
| `test/fixtures.ts` | `liveRun()`: a run in the middle of a retry, and builders for steps, tries and runners |

A test that needs a DOM starts with `// @vitest-environment happy-dom`. The fake client in `ui.test.ts` has `push`,
`announce`, `state` and `fail` to drive the streams from a test. Coverage is measured over `packages/web/src` with the
rest of the repository and must stay at 85% or more on every metric.

Before you say a change to the page works, look at it: `pnpm try:ui -- --demo` for Runs and Run, and
`pnpm indaba ui --root <project>` for Run and Stop, Workflows, the editor and Settings (`try:ui` serves the page
read-only); in both themes, a narrow window, and with the keyboard.

## Packaging

The page reaches a person inside `@indaba/server`, never as a package of its own:

- `pnpm pack` (and so the release and `pnpm smoke`) runs the server's `prepack`, `scripts/stage-page.mjs`, which copies
  `packages/web/dist` to `packages/server/page` and writes `page/THIRD-PARTY-LICENSES.txt`; its `postpack` removes the
  copy, so a checkout always serves `packages/web/dist`. `packages/server/page/` is gitignored.
- With no build the pack fails: no server tarball ships without its page.
- `pnpm smoke` reads every tarball and fails on a file that does not belong (anything but `dist/`, the manifest, the
  readme and the licence, plus `page/` for the server), installs `indaba` alone to check it boots without the optional
  packages, and installs everything to check the server finds its page. Its checks are `auditFiles` and the install
  steps in `scripts/smoke-pack.mjs`, with self-tests next to it.

## Dependencies

The page's libraries are `devDependencies` of a private package, bundled into `packages/web/dist` at build time. A user
of Indaba receives them as files, never as packages in their tree, so they are not in `project.runtime_dependencies`;
`workflow.ai.yml` says so in `project.architecture`. Adding one is still a decision:

- pin an exact version, at least two weeks old where a choice exists;
- check its licence and its dependencies' licences (`npm view <package> license dependencies`) and write them in the
  plan; MIT, ISC, BSD and the SIL OFL for fonts are fine;
- add it to `BUNDLED` (it reaches the page) or `TOOLS` (build and tests only) in `scripts/stage-page.mjs`: a
  devDependency in neither stops the pack, so no library ships without its licence in `THIRD-PARTY-LICENSES.txt`;
- keep the bundle in mind: a phone loads it.

Today: `react` and `react-dom`, `apsw-gridwright`, `@xyflow/react`, `@dagrejs/dagre`,
`@fontsource/atkinson-hyperlegible-next` and `-mono`; and for tests and the build, `vite`, `happy-dom`,
`@testing-library/react` and `@testing-library/dom`, with the React types.
