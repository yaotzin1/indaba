# indaba

Indaba runs work that several AI agents and a person do together, in loops, and keeps a record of who decided what.
You describe the work as a workflow file: a graph of steps with quality gates and retries. Agents can debate until
they agree, a step can run in its own git worktree, and every step, token and cost is traced.

This package is the command line, and the way to embed Indaba in your own code.

> **Preview.** The newest version is under the `next` tag. Plain `npx indaba` still resolves to an older preview.

## Try it

Node 22 or newer, nothing else to install:

```bash
npx indaba@next validate workflow.ai.yml   # check a workflow file
npx indaba@next plan workflow.ai.yml       # the order the steps would run in
npx indaba@next run workflow.ai.yml        # run it
```

The first run of [getting started](https://yaotzin1.github.io/indaba/getting-started.html) needs no API key and no agent.

## Commands

| Command | What it does |
| :--- | :--- |
| `validate [file]` | Validate a workflow file |
| `plan [file]` | Show the execution order of a workflow without running it |
| `run [file]` | Execute a workflow |
| `watch [run]` | Follow or read a run from the files it writes |
| `report [run]` | Gather the log, trace and environment of a run into a folder to attach to an issue |
| `settings` | Show or change the project's logging settings |
| `ui` | Open the web view of the runs on this machine (needs `@indaba/server`) |
| `schema` | Print the JSON Schema of the workflow file |
| `catalog` | List the runners, guard types and arbiters this installation offers |
| `workflows` | List, scan, annotate and copy the workflows of your folders |

`indaba <command> --help` lists the options of one command. Every command accepts `--plugin <specifier>`.

## Optional packages

- [`@indaba/tui`](https://www.npmjs.com/package/@indaba/tui): a terminal dashboard for `indaba run --tui` and `indaba watch`.
- [`@indaba/server`](https://www.npmjs.com/package/@indaba/server): the web view of `indaba ui`.

```bash
npm install -g indaba@next @indaba/tui@next @indaba/server@next
```

## Using it from code

```ts
import { createEngine } from 'indaba';

const { engine, parser } = await createEngine({ projectDir: process.cwd(), env: process.env, plugins: [] });
const workflow = await parser.parseFile('workflow.ai.yml');
const result = await engine.run(workflow);
console.log(result.status);
```

Plugins add runners, guard types, arbiters, listeners and log sinks: see [Extending](https://yaotzin1.github.io/indaba/extending.html).
The workflow file is described in [Workflow format](https://yaotzin1.github.io/indaba/workflow-format.html).

## Links

- Documentation: https://yaotzin1.github.io/indaba/
- Source, issues and changelog: https://github.com/yaotzin1/indaba

## Built by

Built by [APSW Labs](https://apswlabs.com) — creators of [Gridwright](https://github.com/yaotzin1/apsw-gridwright) (React data grid).

## Licence

MIT
