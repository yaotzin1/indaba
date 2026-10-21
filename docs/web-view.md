# The web view

A page in your browser that shows the runs on your machine and follows one of them live: its steps as a graph,
what each step did, what happens if it fails, its output and what it cost. It reads the same files as
`indaba watch` and the terminal dashboard, so the three always agree. It never starts, stops or changes anything.

<p align="center">
  <picture>
    <source srcset="assets/web-view-run-dark.png" media="(prefers-color-scheme: dark)">
    <img src="assets/web-view-run-light.png" width="860" alt="The Run screen: four steps left to right, the failure route from verify back to code drawn under them, the selected step's panel and the step list with each step's tries.">
  </picture>
</p>

> **Status.** Delivery step 1 of [`specs/web-app`](../specs/web-app/spec.md): read-only, Runs and Run. It is on the
> `feat/web-app` branch and not in a published version yet, so run it from a checkout (below). `pnpm try:ui -- --demo`
> also makes a demo project to look at.

## A debate's discussion

A step that is a debate has a closed **Show the discussion** section in its panel: the rounds, who said what, where each
participant ended, and the ruling if you were asked for one. The engine keeps the messages when the debate ends, in
`.indaba/discussions` of the project, or in the folder you name with `indaba run --discussion-dir <dir>`; if you kept them
elsewhere, tell the page with `indaba ui --discussion-dir <dir>` (repeatable). A run from before this was added, or one
whose folder the server was not told about, says that no messages were kept. Secrets are removed when the messages are
written.

## Open it

```bash
indaba ui                      # the runs of the current folder; opens your browser
indaba ui --root ../other-project --root .   # several projects
indaba ui --no-open --port 4173
```

| Option | Does |
| :--- | :--- |
| `--root <dir>` | A project whose runs to show (its `.indaba/traces`); repeatable. Default: the current folder |
| `--discussion-dir <dir>` | Another folder with the kept messages of debates; repeatable. Default: each root's `.indaba/discussions` |
| `--port <n>` | The port to listen on. Default: a free one |
| `--no-open` | Print the address and do not open the browser |

It prints an address with a token, opens it in your browser unless `--no-open`, and serves until `Ctrl+C`. It reads the
runs and starts none; runs you started in a terminal carry on when you stop it:

```text
Indaba is serving the runs of:
  /path/to/project

Open this address in a browser (it carries the token, so keep it to yourself):

  http://127.0.0.1:4173/#token=AUrK9NZ7CGDGRlcaz_6Lw...

Stop with Ctrl+C. Runs started in a terminal are not affected.
```

`indaba ui` needs the optional package `@indaba/server` installed next to `indaba`; the page is inside that package, so
there is nothing else to install. Without it the command says so and exits 1:

```text
indaba ui needs the package @indaba/server, which could not be loaded (...).
Install it next to indaba, then try again: npm install -g @indaba/server
```

Neither package is published yet. In a checkout of this repository, with Node 22 and pnpm 9, build once and use
`pnpm indaba` in place of `indaba`:

```bash
pnpm install
pnpm build
pnpm indaba ui --root /path/to/your/project
```

A checkout that has not been built says `The page of indaba ui has not been built. In a checkout of Indaba, run: pnpm build`.

### A demo with nothing to set up

From a checkout:

```bash
pnpm install
pnpm build
pnpm try:ui -- --demo
```

`--demo` makes a throwaway project in your temp folder, runs a four-step workflow in it (no agent, no API key: its
steps are `node` commands, and one of them fails once so you see a retry), then prints an address:

```text
Open this address in a browser (it carries the token, so keep it to yourself):

  http://127.0.0.1:52344/#token=q5G3fDM5i6QKij...
```

Open that address. `pnpm try:ui -- --root /path/to/your/project` does what `pnpm indaba ui --root` does, without
opening the browser. Either way, a run you start in that project with `indaba run` appears while it runs.

## What you see

### Runs

The runs on this machine, newest first: the workflow's name, its state, when it started, what it cost and its id. Hold
the pointer over a cost to see what it is made of (`3 model calls, 1 with no price`). Click a row or
the workflow's name to open the run. The list updates by itself when a run starts or ends. On a narrow screen each run
becomes a card.

### A run

| Part | Shows |
| :--- | :--- |
| The heading | The workflow, the run's state, when it started, how long it has run or took, and its id |
| **Steps** (the graph) | Every step of the workflow, left to right in the order they wait for each other, including steps that have not run yet. A grey arrow is "waits for" (`depends_on`); it turns green when the step it comes from has completed. A red dashed line under the steps is where a failure leads (`on_failure: retry_step`), with how many retries are used |
| The step panel | The selected step: what happened in it (its runner, model, tokens and cost, or its commands and exit codes), what happens if it fails, its tries with the reason each one failed, and its output |
| **Steps** (the list) | The same steps as a table; a step that ran more than once opens to show each try |
| **Cost** | What the run cost so far, the number of model calls, the budget, and a table of each step that called a model: its calls (and any still running), its tokens in and out, and its cost. The rows add up to the total, which is the same number the Runs screen shows |

Select a step by clicking it in the graph or in the list, or by pressing `Tab` until it is focused and then `Enter`.
The selected step is part of the address (`?step=verify`), so a reload or a copied link opens the same step. When
nothing is selected, the page opens the step that is running, otherwise the last one that failed, otherwise the first.

Each card in the graph says the step's runner, its state as a symbol and a word, its time, and either its try
(`try 2, 1 failed`) or that it runs again if another step fails. Drag the canvas to move it; the page's own scroll
never zooms it.

### What the states mean

| Symbol and word | Means |
| :--- | :--- |
| `○ pending` | Not started, or reset to run again after a retry |
| `▶ running`, `▶ checking` | Running, or its guards and outputs are being checked |
| `✓ completed` | Finished and passed its checks |
| `✗ failed` | Failed; what happens next is in "If this step fails" |
| `▲ escalated` | Handed to a person: retries ran out, a debate did not agree, or `on_failure: escalate` |
| `■ cancelled` | Stopped |

Colour repeats the symbol and the word and is never the only sign of a state.

### Costs

A cost the page cannot compute is shown as **unknown**, never as zero. A total that includes a model call with no price
says **at least $0.42 (partial)**. A run with no model calls (only commands) says **$0.00 (no model calls)**. A step
with no budget says **no limit**.

### When the connection drops

If the server stops answering while you follow a run, a red banner says so and that what you see is the last
known state, the run's states turn grey, and the page reconnects by itself, resuming where it left off without repeating or skipping
anything. After 8 failed attempts in a row (about half a minute) it stops asking: the header says **Server stopped**, a
banner says what to do, and **Check again** asks once and picks up again if the server answers. Nothing on the page
claims to be live while it is not.

## Themes, keyboard and phone

- **Theme.** The page follows your system's light or dark setting. **System**, **Light** and **Dark** in the header
  choose; the choice is kept in this browser only.
- **Keyboard.** Everything works without a mouse: `Tab` through the header, the graph's steps, the step list and the
  panel; `Enter` opens a step. "Skip to the content" is the first stop.
- **Screen readers.** Each step in the graph is announced with its name and state, the tables have headers and names,
  and the page says when the connection drops.
- **Phone.** It works from 320 px wide. A graph too wide for the screen opens at a size you can read, from the left;
  drag to see the rest.

## Safety

The page can show your agents' work, so it is built like something that could leak it.

- **Your machine only.** The server listens on `127.0.0.1` and answers only requests addressed to it by its own name
  (`127.0.0.1`, `localhost` or `[::1]` with its port), which stops a web page elsewhere reaching it through DNS tricks.
- **A token per start.** Every request needs the token from the printed address. It travels in the address fragment
  (the part after `#`, which a browser never sends to a server); the page reads it once, removes it from the address
  bar and keeps it in memory, and sends it as a header. Reloading the page therefore asks for the address again. Do not
  share the address while the server runs.
- **Read-only.** The server answers `GET` only: it starts no run, writes no file and stops nothing.
- **Text stays text.** Everything a run produced (agent output, commands, messages) is shown as plain text: no HTML, no
  links, and terminal escape sequences are removed by the server first. The page loads nothing from the internet (no
  fonts, scripts or analytics), and a Content-Security-Policy forbids it.
- **Third-party code.** The page bundles a few open-source libraries and fonts; their licences ship with it, in
  `page/THIRD-PARTY-LICENSES.txt` inside the `@indaba/server` package.
- **No secrets in what it reads.** A value of an environment variable named like a key, token, secret, password or
  credential is replaced by `[redacted]` before a run writes its trace, so it is not in the files the page shows.

## Messages that replace the page

| Message | What to do |
| :--- | :--- |
| **This page needs its address** | The address had no token, or the server refused it (it was started again, so its token changed). Open the address the terminal printed |
| **The server stopped** | Nothing answers at the address. Start it again, then open the new address |
| **This page is older than the server** | The server was updated while the page was open. Reload |
| **Run not found** | No run has this id, perhaps because its trace was deleted. Go back to Runs |
| **This run was recorded before Indaba wrote down which step waits for which** | A run from an earlier version: its steps are shown in the order they ran, with no arrows, and what a failure does is unknown |

## Not there yet

From [`specs/web-app`](../specs/web-app/spec.md) and [roadmap.md](roadmap.md), in the order they are planned: a
published `@indaba/server`, so `indaba ui` works from npm; the list of workflows with their health (it needs
`specs/workflow-registry`); Run, Stop and "run this step"; answering an agent's questions; applying or discarding a
run's changes; the workflow editor. On a phone the graph still runs left to right (opening at a readable size and
dragged sideways); top to bottom below 640 px is decided and not built yet, and so is a `last known` label on each state
when the connection drops (today the states turn grey and the banner says it).

Working on the page itself: [web-view-development.md](web-view-development.md).
