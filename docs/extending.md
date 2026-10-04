# Extending Indaba

A runner, a guard type or an event listener is added from outside Indaba, as a plugin. A plugin is a
module that default-exports an object with a `name` and a `register(host)` function. The contracts it
implements (`Runner`, `Guard`, `Plugin`, `PluginHost`, the events) are defined in `@indaba/core`, so
adding one never edits core, the engine or the runners.

The built-in runners and the `git_diff_empty` guard are registered through the same registries a plugin
reaches. A plugin therefore has no less access than a built-in, and no more.

## The contract

```ts
interface Plugin {
  readonly name: string;
  register(host: PluginHost): void | Promise<void>;
}

interface PluginHost {
  registerRunner(runner: Runner): void;
  registerGuard(guard: Guard): void;
  addListener<E extends object>(
    type: abstract new (...args: never[]) => E,
    listener: (event: E) => unknown,
  ): void;
}

interface Runner {
  readonly name: string; // what a workflow file writes in `runner:`
  run(request: RunRequest, signal?: AbortSignal): Promise<RunResult>;
}

interface Guard {
  readonly type: string; // what a workflow file writes in a guard's `type:`
  check(guard: GuardDefinition, workdir: string): Promise<GuardResult>;
}
```

Behaviour worth knowing:

- A `Runner` returns a `RunResult` for a command that ran, even if it failed (a non-zero `exitCode`);
  the step's `on_failure` decides what happens. Throw a `RunnerError` only when the runner could not
  run at all. Honour `request.timeoutSeconds` (default 900) and the `AbortSignal`, and do not leave a
  child process behind.
- A `Guard` returns `GuardResult.pass()` or `GuardResult.fail(message)`. It decides; it does not act.
  Resolve `guard.paths` against `workdir` and refuse any path that leaves it.
- Registering a runner name or guard type that already exists replaces the earlier one.
- Guard types are checked when a workflow is validated, against the guards registered, so a plugin's
  guard type is a valid value in `workflow.ai.yml` once the plugin is loaded. Load the plugin for
  `validate` and `plan` too.
- Listeners run in registration order, one at a time. A listener that throws is isolated: the run
  continues, and the error goes to the command line's listener-error handler, which prints
  `Listener failed: <message>` to stderr. A listener may be async.
- A plugin whose `register` throws stops the command with `Plugin "<name>" failed to register: ...`.

Events you can listen to, all exported from `@indaba/core`: `StepStatusChanged` (`taskId`, `stepId`,
`from`, `to`, optional `reason`), `SpanStarted` and `SpanEnded` (each carries a `span`). Names and
payloads are public surface.

## A complete plugin

This plugin adds a runner called `echo`, a guard type called `file_exists` and a listener that logs
step transitions. It lives in your own project, for example `plugins/demo.ts` compiled to
`plugins/demo.js`.

```ts
import { access } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  type Guard,
  type GuardDefinition,
  GuardResult,
  type Plugin,
  type PluginHost,
  RunResult,
  type Runner,
  type RunRequest,
  StepStatusChanged,
} from '@indaba/core';

// A runner: answers every prompt by echoing it back. Never starts a process.
const echo: Runner = {
  name: 'echo',
  async run(request: RunRequest, signal?: AbortSignal): Promise<RunResult> {
    if (signal?.aborted === true) {
      return new RunResult({ exitCode: 1, output: '', errorOutput: 'aborted' });
    }
    request.onOutput?.(request.prompt);
    return new RunResult({ exitCode: 0, output: request.prompt });
  },
};

// A guard: every path listed under the guard must exist in the step's working directory.
const fileExists: Guard = {
  type: 'file_exists',
  async check(guard: GuardDefinition, workdir: string): Promise<GuardResult> {
    const missing: string[] = [];
    for (const path of guard.paths) {
      const target = resolve(workdir, path);
      const escapes = isAbsolute(relative(workdir, target)) || relative(workdir, target).startsWith('..');
      if (escapes) {
        return GuardResult.fail(`Path "${path}" leaves the working directory.`);
      }
      try {
        await access(target);
      } catch {
        missing.push(path);
      }
    }
    return missing.length === 0 ? GuardResult.pass() : GuardResult.fail(`Missing: ${missing.join(', ')}`);
  },
};

const plugin: Plugin = {
  name: 'demo',
  register(host: PluginHost): void {
    host.registerRunner(echo);
    host.registerGuard(fileExists);
    host.addListener(StepStatusChanged, (event) => {
      process.stderr.write(`[demo] ${event.stepId}: ${event.from} -> ${event.to}\n`);
    });
  },
};

export default plugin;
```

A workflow that uses all three:

```yaml
version: "1.0"
name: "plugin-demo"
roles:
  speaker:
    runner: "echo"
steps:
  - id: "say"
    role: "speaker"
    goal: "Hello from a plugin runner."
    outputs: ["hello.txt"]
    guards:
      - type: "file_exists"
        paths: ["hello.txt"]
```

(That workflow fails at the `outputs` check, because the echo runner writes no file; it is there to show
the three names in use. Add a `shell` step before it that creates `hello.txt` to make it pass.)

## Running with a plugin

Pass `--plugin` to `validate`, `plan` and `run`. The option repeats, and the value is a file path
(relative paths resolve against the directory you run in) or an installed package name:

```bash
npx indaba validate workflow.ai.yml --plugin ./plugins/demo.js
npx indaba run workflow.ai.yml --plugin ./plugins/demo.js --plugin my-indaba-plugin
```

The module must default-export a `Plugin`. If it does not, or cannot be imported, the command stops with
a message naming the specifier. Node loads the file as an ES module, so a TypeScript plugin has to be
compiled first (or run under a loader you provide).

## Using the engine without the command line

`indaba` exports `createEngine({ projectDir, env, plugins })`, which wires the registries, the tracer and
the engine, and registers the plugins you pass. Its result gives you the `engine`, the `parser`
(validating against the same guard registry, so plugin guard types are valid), the `runners` and
`guards` registries and the `events` dispatcher. Parsing a file and running it:

```ts
import { createEngine } from 'indaba';

const { engine, parser } = await createEngine({
  projectDir: process.cwd(),
  env: process.env,
  plugins: [plugin],
});
const workflow = await parser.parseFile('workflow.ai.yml');
const result = await engine.run(workflow);
console.log(result.status);
```

## Rules for extensions

- Depend on `@indaba/core` for the contracts. Do not import from another package's internals.
- Do not hand a string composed from model output to a shell. Start processes with an argument array.
- Keep secrets out of what you return, trace or log.
- Any new name a workflow can use (a runner, a guard type) is public surface of your plugin: version it.
