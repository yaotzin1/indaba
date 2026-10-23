# The web view

A page in your browser that shows the runs on your machine and follows one of them live: its steps as a graph,
what each step did, what happens if it fails, its output and what it cost. It reads the same files as
`indaba watch` and the terminal dashboard, so the three always agree. It can also start a workflow of the project and stop
a run it started, and open a workflow file to read, change and save it; a run started in a terminal it only shows.

<p align="center">
  <picture>
    <source srcset="assets/web-view-run-dark.png" media="(prefers-color-scheme: dark)">
    <img src="assets/web-view-run-light.png" width="860" alt="The Run screen: four steps left to right, the failure route from verify back to code drawn under them, the selected step's panel and the step list with each step's tries.">
  </picture>
</p>

> **Status.** Delivery steps 1 and the first slice of 2 of [`specs/web-app`](../specs/web-app/spec.md): Runs and Run,
> and Run and Stop ([`specs/web-app-actions`](../specs/web-app-actions/spec.md)). Not in a published version yet, so run
> it from a checkout (below). `pnpm try:ui -- --demo` also makes a demo project to look at.

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
| `--log-level`, `--log-dir` | As for every command: how much goes to the log file, and where it is |

It prints an address with a token, opens it in your browser unless `--no-open`, and serves until `Ctrl+C`. Stopping it
stops the runs started from the page; runs you started in a terminal carry on:

```text
Indaba is serving the runs of:
  /path/to/project

Open this address in a browser (it carries the token, so keep it to yourself):

  http://127.0.0.1:4173/#token=AUrK9NZ7CGDGRlcaz_6Lw...

Stop with Ctrl+C; that also stops the runs started from the page. Runs started in a terminal are not affected.
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
| **Steps** (the graph) | Every step of the workflow, left to right in the order they wait for each other (top to bottom below 640 px), including steps that have not run yet. A grey arrow is "waits for" (`depends_on`); it turns green when the step it comes from has completed. A red dashed line under the steps is where a failure leads (`on_failure: retry_step`), with how many retries are used |
| The step panel | The selected step: what happened in it (its runner, model, tokens and cost, or its commands and exit codes), what happens if it fails, its tries with the reason each one failed, and its output |
| **Steps** (the list) | The same steps as a table; a step that ran more than once opens to show each try |
| **Cost** | What the run cost so far, the number of model calls, the budget, and a table of each step that called a model: its calls (and any still running), its tokens in and out (on a phone, in the step's own panel), and its cost. The rows add up to the total, which is the same number the Runs screen shows |

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

If the server stops answering while you follow a run, a red banner says so, every state turns grey and says
`last known` after its word (`✓ completed, last known`), and the page reconnects by itself, resuming where it left off without repeating or skipping
anything. After 8 failed attempts in a row (about half a minute) it stops asking: the header says **Server stopped**, a
banner says what to do, and **Check again** asks once and picks up again if the server answers. Nothing on the page
claims to be live while it is not.

## Run and Stop

**Run a workflow** on the Runs screen opens a panel with the workflow files of the projects served: files named
`*.workflow.ai.yml` or `*.workflow.ai.yaml` up to four folders down, and the project's default
`.indaba/workflow.ai.yml`. Folders `node_modules`, `.git` and the rest of `.indaba/` are not searched, and links are not
followed. A file with problems is listed with them, as `indaba validate` words them, and cannot be run. The search stops
at 200 files (it says so); a file over 1 MiB is listed as invalid.

The list is the workflow registry of those projects, the one `indaba workflows` keeps: each workflow shows the name,
project and tags you gave it with `indaba workflows annotate`, and its last run (state, when, cost). A workflow you hid
is behind **Show the hidden workflows**. The list is read again when you come back to the window, and the folders are
looked at again at most every 30 seconds; a file that was deleted is not offered.

**The first run asks first.** Before a workflow runs from the page for the first time, the panel shows what its file says
it will use: the runner of every step, the commands it runs (shell commands, an agent's own command, local MCP servers),
what each step may read and write, and the steps that need a person. Press **Run it** to go ahead. The page remembers
that you confirmed this exact content (by its SHA-256), so it does not ask again, and asks again whenever the file
changes, even by a space. What you confirmed is kept outside every project, in your user configuration folder
(`indaba/confirmed-workflows.json` under `%APPDATA%` on Windows, `~/Library/Application Support` on macOS,
`$XDG_CONFIG_HOME` or `~/.config` elsewhere), so a project you download never arrives confirmed.

The summary covers **only what the workflow file declares**. It does not cover scripts a command calls,
`indaba.config`, plugins, or what an agent then does with its own tools. A step with no `permissions` reads
"runner default (unrestricted)".

**What runs.** Each run is `indaba run --workdir <project> --task-id <id> -- <file>` in a process of its own, started in
the project's folder with the environment `indaba ui` was started with. It runs the exact bytes you confirmed: a copy
under `.indaba/run-inputs/` that is deleted when the run ends. It writes the same trace and log as a run from a terminal,
and `indaba watch` follows it. At most four runs started from the page are alive at once.

The run has no terminal, so a step that needs a person (a login, or `arbiter: human`) ends **escalated**; the panel lists
such steps before you run. Run those workflows in a terminal.

**Stop** is on the Run screen of a run the page started, while it runs. It asks first, then stops the run as `Ctrl+C`
would: the running step is cancelled and its worktree removed. A run started in a terminal has no Stop on the page.

**Closing `indaba ui`** (`Ctrl+C`, or closing its terminal) stops every run it started the same way, waits up to five
seconds, then ends any that did not stop, with everything they started. The page says so before your first run. If
`indaba ui` itself crashes, or is killed, its runs keep going without it; the next `indaba ui` in that project removes the
copies they left under `.indaba/run-inputs/`.

## Edit a workflow

**Edit** next to a workflow in the Run a workflow panel opens it at an address of its own (`/workflows/<id>`), so a
reload opens it again. It works for a workflow with problems too: that is where they get fixed. **Form** and **Source**
switch between two views of the same draft; what you change in one is in the other.

### As a form

The form is shown first when the file can be read as a workflow; otherwise the source view, with the reason.

- **The workflow, its roles and its steps** are fields: the name, each role's runner and model, and for the step you pick
  in the list its id, role, runner, goal, what it waits for, what its agent may change, isolation, what happens on
  failure, the debate fields, what it reads first and must create, its commands and its MCP servers. Each field says what
  it is, in the words of [the workflow format](workflow-format.md).
- **Choices come from your installation.** A runner is one this `indaba ui` knows (plugins included); a role is one the
  file declares; what a step waits for is one of the other steps. A value the file holds that is not one of them (a
  runner of a plugin not loaded here) is shown as it is and marked, never replaced.
- **Only what you touch changes.** A change goes into the file at that one place: your comments, blank lines, order and
  quoting stay as they were. A text field changes when you leave it or press **Enter**; a choice, at once. Clearing an
  optional field removes it; the name and a step's id cannot be left empty.
- **What a step's agent may change** is a choice of **Read only**, **Edit only these folders** (with the globs, one per
  line), **Full access** or **Not set**; what it may read stays as the file says. A rule that is none of them is shown as
  **Custom** and left alone until you pick one. A sentence in a goal ("do not edit files") is a request, not a rule.
- **Steps**: **Add a step** puts one after the step shown, named `step-1`, `step-2` and so on, with the shell runner for
  you to change; **Move up**, **Move down** and **Remove** (which asks first). Removing or renaming a step does not
  rewrite the steps that name it: the problems say where to change them.
- **Problems are at their field**, marked and read out with it; a problem of a whole step is at the top of the step, and
  the rest at the top of the form. All of them are also listed under the form, as in the source view.
- **What the form does not edit** (artifacts, MCP servers, an agent, guards, a key the format does not know) is named,
  with a button that opens the source view at it.

### As text

- **As you type**, after a short pause, the page checks the text with the same parser as `indaba validate` and lists the
  problems under it, each with its line and column; press one to put the cursor there. A problem about something
  that is missing (a step with no runner, say) points at the step that lacks it.
- **Tab** indents by two spaces. To leave the editor with the keyboard, press **Escape**, then **Tab**.
- **Save** writes the file. A text with problems is saved too, so you never lose a draft; it cannot run until they are
  fixed. **Run** is there once the saved file has none.
- **Saving changes what you confirmed.** The next Run shows you again what the workflow will use, because its content
  changed.
- **Nothing is overwritten by surprise.** If the file changed on disk after you opened it (another editor, `git pull`),
  saving stops and shows that version beside yours: **Use the version on disk**, or **Keep mine and save**.
- Leaving with unsaved changes (Back, another screen, closing the tab) asks first.

The page edits files that already exist; it does not create, rename or delete one. A file over 1 MiB, or one that is not
UTF-8 text, opens only in your own editor.

## Themes, keyboard and phone

- **Theme.** The page follows your system's light or dark setting. **System**, **Light** and **Dark** in the header
  choose; the choice is kept in this browser only.
- **Keyboard.** Everything works without a mouse: `Tab` through the header, the graph's steps, the step list and the
  panel; `Enter` opens a step. "Skip to the content" is the first stop.
- **Screen readers.** Each step in the graph is announced with its name and state, the tables have headers and names,
  and the page says when the connection drops.
- **Phone.** It works from 320 px wide. Below 640 px the graph runs top to bottom, so a long workflow scrolls with the
  page; turning the phone or widening the window turns it back. On a wider screen a graph too wide for its box opens at
  a size you can read, from the left; drag to see the rest.

## Safety

The page can show your agents' work, so it is built like something that could leak it.

- **Your machine only.** The server listens on `127.0.0.1` and answers only requests addressed to it by its own name
  (`127.0.0.1`, `localhost` or `[::1]` with its port), which stops a web page elsewhere reaching it through DNS tricks.
- **A token per start.** Every request needs the token from the printed address. It travels in the address fragment
  (the part after `#`, which a browser never sends to a server); the page reads it once, removes it from the address
  bar and keeps it in memory, and sends it as a header. Reloading the page therefore asks for the address again. Do not
  share the address while the server runs.
- **What it may change.** The server itself starts nothing and writes nothing. `indaba ui` gives it two things to do:
  write the logging settings (the Settings screen), start and stop runs, and save a workflow file it lists (above). Every change needs the token and
  must come from the page itself: a request without the page's own `Origin`, which a browser always sends on a write, is
  refused even with the token. The page sends an id from the list, never a path; the server looks the id up in a fresh
  search, and builds the command from its own values only. A save replaces only the file that id names, inside its
  project, through a temporary file and a rename, so the file is always one whole version; the text of a workflow is
  never written to the log.
- **Text stays text.** Everything a run produced (agent output, commands, messages) is shown as plain text: no HTML, no
  links, and terminal escape sequences are removed by the server first. The page loads nothing from the internet (no
  fonts, scripts or analytics), and a Content-Security-Policy forbids it.
- **What it logs.** Like every command, `indaba ui` appends to the project's log (`.indaba/logs`, see `--log-level` and
  `--log-dir`): the server's start and stop with its address but never the token, each refused request (method, the path
  without any query, status and reason), each stream opening and closing, and anything that failed. It never logs a
  request body or the `Authorization` header. A failure is also printed in the terminal; refused requests are not, so a
  page left open after a restart does not fill it.
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

Messages in the Run a workflow panel:

| Message | What to do |
| :--- | :--- |
| **This workflow has problems, so it cannot run** | Fix the problems listed, then try again |
| **The most runs started here at once are already going** | Wait for one to end, or stop one |
| **Your confirmation could not be saved** | Your user configuration folder cannot be written; the run does not start until it can |
| **The run did not start** | It shows the first line the run printed; run the workflow with `indaba run` in a terminal to see the rest |
| **This run was recorded before Indaba wrote down which step waits for which** | A run from an earlier version: its steps are shown in the order they ran, with no arrows, and what a failure does is unknown |

## Not there yet

From [`specs/web-app`](../specs/web-app/spec.md) and [roadmap.md](roadmap.md), in the order they are planned: a
published `@indaba/server`, so `indaba ui` works from npm; naming, tagging and hiding a workflow from the page (today
with `indaba workflows annotate`); "run this step" and a form for a workflow's inputs; answering
an agent's questions; applying or discarding a run's changes; forms and the graph as an editor (positions for every
problem come with them).

Working on the page itself: [web-view-development.md](web-view-development.md).
