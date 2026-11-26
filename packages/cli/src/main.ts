import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import {
  type Adjudicator,
  DagBuilder,
  DEFAULT_MAX_ROUNDS,
  DEFAULT_TIMEOUT_SECONDS,
  explainPlan,
  INPUT_LIMITS,
  IndabaError,
  isConsensusStep,
  isShellStep,
  type Logger,
  type PlanExplanation,
  type Plugin,
  SpanEnded,
  StepStatusChanged,
  Tracer,
  type WorkflowDefinition,
  WorkflowValidationError,
} from '@indaba/core';
import {
  analyzeReadiness,
  applyRunBounds,
  catalogOf,
  checkPermissions,
  checkStalls,
  createReadinessProbe,
  describeStallFinding,
  effectiveGuards,
  FileWorkflowRegistry,
  fullAccessSteps,
  type ParseOptions,
  type PermissionFinding,
  type PermissionRunners,
  PROJECT_CONFIG_FILE,
  parseRunBound,
  planForStep,
  type ReadinessReport,
  type RunBound,
  readInputDeclarations,
  readOrigins,
  readProjectConfig,
  type WorkflowParser,
  WorkflowStatus,
  WorkflowValidator,
  workflowJsonSchema,
  writeLoggingConfig,
} from '@indaba/engine';
import type { AuthChooser } from '@indaba/runners';
import { describeBoard } from './board-plan.js';
import {
  CATALOG_USAGE,
  type CatalogOptions,
  CatalogUsageError,
  catalogCommand,
  LISTED_HUMAN_ARBITER,
  parseCatalog,
} from './catalog.js';
import { userConfigFolder } from './config-folder.js';
import { createEngine } from './engine-factory.js';
import type { ExitHooks } from './exit.js';
import { homeGate, runHome } from './home.js';
import { terminalInputAsker } from './input-prompt.js';
import {
  type CommandLogger,
  chooseLevel,
  extractLogOptions,
  LOG_OPTIONS_USAGE,
  type LogOptions,
  LogUsageError,
  openCommandLogger,
  testSink,
} from './log.js';
import type { BrowserOpener } from './open-browser.js';
import { parallelNotice, parseParallelFlag, planGroupLines, resolveLimit } from './parallel.js';
import { describePermissionFinding, runnerDefaultWords } from './permission-report.js';
import { explanationLines, oneLine, renderExplanationJson } from './plan-explain.js';
import { loadPlugin } from './plugin-loader.js';
import { createPrintableFilter } from './printable.js';
import { readinessLines } from './readiness-report.js';
import { redact } from './redact.js';
import { report } from './report.js';
import type { RunStarter } from './run-child.js';
import { CONFIRMATION_FILE } from './run-control/confirm.js';
import { createWorkflowEditor } from './run-control/editor.js';
import type { WorkflowFinder } from './run-control/finder.js';
import { createRunControl } from './run-control/index.js';
import { createRegistryHub, type RegistryHub } from './run-control/registry.js';
import { createWorkflowStore } from './run-control/source.js';
import {
  type AskInputs,
  checkInputs,
  type Gathered,
  gatherInputs,
  inputLines,
  suppliedFromOptions,
  tooManyOptions,
} from './run-inputs.js';
import { runWithDashboard } from './run-tui.js';
import type {
  ServerLoad,
  UiRegistryControl,
  UiRunControl,
  UiSettingsBackend,
  UiSettingsState,
  UiWorkflowEditor,
  UiWorkflowStore,
} from './server-loader.js';
import { settingsCommand } from './settings.js';
import { loadTui, type TuiLoad } from './tui-loader.js';
import { ui } from './ui.js';
import { watch } from './watch.js';
import {
  parseWorkflows,
  WORKFLOW_ROOTS_FILE,
  WORKFLOWS_USAGE,
  type WorkflowsOptions,
  WorkflowsUsageError,
  workflowsCommand,
} from './workflows.js';

export interface Io {
  readonly stdout: { write(text: string): void };
  readonly stderr: { write(text: string): void };
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  /** Aborting it cancels a running workflow; teardown still runs. */
  readonly signal?: AbortSignal;
  /** Present only when a person is at a terminal: lets them pick how an ACP agent logs in. */
  readonly chooseAuthMethod?: AuthChooser;
  /** Present only when a person is at a terminal: lets them rule on a debate that failed (the arbiter "human"). */
  readonly humanAdjudicator?: Adjudicator;
  /**
   * Asks for the inputs a run still lacks (specs/workflow-inputs, AC-16). Defaults to the plain questions of
   * `terminalInputAsker` when a person is at a terminal; tests replace it. Without either, a missing input ends the run.
   */
  readonly askInputs?: AskInputs;
  /** Present only when a person is at a terminal: where the dashboard of `indaba watch` is drawn and read from. */
  readonly terminal?: { readonly stdin: NodeJS.ReadableStream; readonly stdout: NodeJS.WritableStream };
  /** Loads the optional dashboard package. Defaults to importing `@indaba/tui`; tests replace it. */
  readonly loadTui?: () => Promise<TuiLoad>;
  /** Loads the optional local server. Defaults to importing `@indaba/server`; tests replace it. */
  readonly loadServer?: () => Promise<ServerLoad>;
  /** Opens an address in the browser, for `indaba ui`. Supplied by the binary; tests replace it. */
  readonly openBrowser?: BrowserOpener;
  /** Starts `indaba run` as a process of its own, for `run --tui`. Supplied by the binary; tests replace it. */
  readonly startRun?: RunStarter;
  /** The clock of the log records. Defaults to the wall clock; tests replace it. */
  readonly clock?: () => Date;
  /** The process id the log records carry. Defaults to this process. */
  readonly pid?: number;
  /** Where the command registers what must happen before an early exit (a second Ctrl+C): the log's flush. */
  readonly exitHooks?: ExitHooks;
}

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
/** A usage error, and also what an escalated run returns. */
export const EXIT_USAGE = 2;
export const EXIT_INTERRUPTED = 130;

const DEFAULT_FILE = '.indaba/workflow.ai.yml';

const USAGE = `Usage: indaba <command> [options]

Commands:
  validate [file]   Validate a workflow file
  plan [file]       Show the execution order of a workflow without running it
  run [file]        Execute a workflow
  watch [run]       Follow or read a run from the files it writes (no run: list them)
  report [run]      Gather the log, trace and environment of a run into a folder to attach to an issue
  settings          Show or change the logging settings of the project (indaba.config)
  ui                Open the web view of the runs on this machine
  schema            Print the JSON Schema of the workflow file
  catalog           List the runners, guard types and arbiters this installation offers
  workflows         List, scan, annotate and copy the workflows of your folders

Options:
  -h, --help        Show help
  -V, --version     Show the version

The file defaults to ${DEFAULT_FILE}. Every command accepts --plugin <specifier> (repeatable):
a file path or package name whose default export is an Indaba plugin.
Run "indaba <command> --help" for the options of one command.

${LOG_OPTIONS_USAGE}`;

const COMMAND_USAGE: Readonly<Record<string, string>> = {
  catalog: CATALOG_USAGE,
  workflows: WORKFLOWS_USAGE,
  schema: `Usage: indaba schema

Print the JSON Schema (draft 2020-12) of the workflow file, for an editor or a form. It states the structure only:
rules across fields (a role must exist, no cycle, a runner must be registered) are what indaba validate checks.
`,
  validate: `Usage: indaba validate [file] [--input <name>=<value>]... [--plugin <specifier>]...

Validate a workflow file and print every problem found. A workflow that asks for inputs needs no values to be
checked; values given with --input are checked as indaba run would check them.
`,
  plan: `Usage: indaba plan [file] [--explain] [--json] [--input <name>=<value>]... [--plugin <specifier>]...

Show the execution order of a workflow without running it, and which inputs it asks for and which are still missing.

Options:
      --explain           Under each step, show the value of each setting that decides what it may do and when it stops,
                          where each value comes from (the file and its line, the role, the defaults block, or Indaba),
                          and what the step does not have. A gap is a fact: it never changes the exit code.
      --json              Print that explanation as JSON and nothing else on stdout (schema "indaba.plan-explain",
                          version 1); implies --explain. Problems go to stderr.
`,
  run: `Usage: indaba run [file] [options]

Execute a workflow.

Options:
  -w, --workdir <dir>     Project directory the workflow runs against (default: .)
      --task-id <id>      Task id (names the worktree and trace)
      --timeout <secs>    Per-step timeout in seconds (default: 900)
      --parallel <n>      How many steps may run at once (default: 1; INDABA_PARALLEL or parallel.max_steps in indaba.config set it too)
      --plugin <spec>     Load a plugin; repeatable
      --discussion-dir <dir>
                          Where the messages of each debate are kept for the web view (default: .indaba/discussions)
  -v, --verbose           Print the cost of each span; -vv also streams agent output
      --tui               Run in a process of its own and show it as a dashboard (needs a terminal and @indaba/tui);
                          closing the dashboard asks whether to detach (the run goes on) or cancel it
      --permissions [<step>=]<level>
                          Lower what agents may do in this run: read, edit or full (repeatable). It never raises a level
                          and never writes the file; a step with no level takes only read.
      --allow-full-access Acknowledge the steps at the level full when there is no terminal to ask at
      --confirm <id>      Confirm an item of the readiness report that only you can judge (repeatable); the run starts either way
      --input <name>=<value>
                          A value for an input the workflow asks for (repeatable; a list input is given by repeating it).
                          An input left out is asked for at a terminal; with none, the run does not start (exit 2).
      --input-file <name>=<path>
                          The value of a text input, read from a file inside the project
`,
};

function withLogOptions(usage: string): string {
  return `${usage}\n${LOG_OPTIONS_USAGE}`;
}

const RUN_ONLY_OPTIONS = [
  'workdir',
  'task-id',
  'timeout',
  'parallel',
  'verbose',
  'tui',
  'discussion-dir',
  'permissions',
  'allow-full-access',
  'confirm',
  'input-file',
] as const;

/** The options only `plan` has: another command refuses them as it refuses an option it does not know. */
const PLAN_ONLY_OPTIONS = ['explain', 'json'] as const;

function processIo(): Io {
  return { stdout: process.stdout, stderr: process.stderr, env: process.env, cwd: process.cwd() };
}

function readVersion(): string {
  const manifest: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  if (typeof manifest === 'object' && manifest !== null && 'version' in manifest) {
    return typeof manifest.version === 'string' ? manifest.version : 'unknown';
  }
  return 'unknown';
}

class UsageError extends Error {}

function commandUsage(command: string | undefined): string {
  const usage = command === undefined ? undefined : COMMAND_USAGE[command];
  return usage === undefined ? USAGE : withLogOptions(usage);
}

function usageError(io: Io, message: string, command?: string): number {
  io.stderr.write(`${message}\n\n${commandUsage(command)}`);
  return EXIT_USAGE;
}

/**
 * Runs one command with its logger: the `process.start` record first, a `process.end` record with the exit code last,
 * and every sink flushed before the command returns (specs/logging, AC-14, T-07).
 */
async function logged(
  command: string,
  root: string,
  options: LogOptions,
  io: Io,
  body: (logger: CommandLogger) => Promise<number>,
): Promise<number> {
  let logger: CommandLogger;
  try {
    const config = await readProjectConfig(root);
    if (config.problems.length > 0) {
      return usageError(
        io,
        `${PROJECT_CONFIG_FILE} is invalid:\n${config.problems.map((p) => ` - ${p}`).join('\n')}`,
        command,
      );
    }
    logger = openCommandLogger({
      root,
      level: chooseLevel(options.level, io.env.INDABA_LOG_LEVEL, config.logging.settings.level),
      dir: options.dir,
      settings: config.logging.settings,
      stderr: io.stderr,
      environment: io.env,
      clock: io.clock ?? (() => new Date()),
      pid: io.pid ?? process.pid,
      hostname: hostname(),
    });
  } catch (error) {
    if (error instanceof LogUsageError) {
      return usageError(io, error.message, command);
    }
    if (error instanceof IndabaError) {
      return usageError(io, redact(error.message, io.env), command);
    }
    throw error;
  }
  // What a report needs to state its environment without being asked; never the arguments' values (AC-14).
  logger.info('cli.process', 'process.start', {
    command,
    indabaVersion: readVersion(),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
  });
  // A second Ctrl+C leaves before `finally` runs; the records of the run are written first (bounded by exit.ts).
  const removeHook = io.exitHooks?.add(async () => {
    logger.info('cli.process', 'process.end', { exitCode: EXIT_INTERRUPTED, interruptedTwice: true });
    await logger.flush();
  });
  let code = EXIT_FAILURE;
  try {
    code = await body(logger);
    return code;
  } finally {
    removeHook?.();
    logger.info('cli.process', 'process.end', { exitCode: code });
    await logger.flush();
  }
}

interface Parsed {
  readonly file: string;
  readonly plugins: readonly string[];
  readonly workdir: string;
  readonly taskId: string | undefined;
  readonly timeout: number | undefined;
  readonly parallel: number | undefined;
  readonly verbosity: number;
  readonly tui: boolean;
  readonly discussionDir: string | undefined;
  readonly permissions: readonly string[];
  readonly allowFullAccess: 'run_option' | 'page' | 'terminal' | undefined;
  /** `--confirm <id>`: items of the readiness report the person has confirmed for this run. */
  readonly confirm: readonly string[];
  /** `--input <name>=<value>` and `--input-file <name>=<path>` (specs/workflow-inputs, AC-12 and AC-13). */
  readonly input: readonly string[];
  readonly inputFile: readonly string[];
  /** `plan --explain` and `plan --json` (specs/plan-explain, AC-01): `--json` implies `--explain`. */
  readonly explain: boolean;
  readonly json: boolean;
  readonly help: boolean;
}

function parseCommand(command: string, rawArgs: readonly string[]): Parsed {
  // `--allow-full-access=page` is what the server passes after its own confirmation (specs/agent-permissions, AC-05).
  const provenance = rawArgs.includes('--allow-full-access=page')
    ? 'page'
    : rawArgs.includes('--allow-full-access=terminal')
      ? 'terminal'
      : undefined;
  const args = rawArgs.map((arg) =>
    arg === '--allow-full-access=page' || arg === '--allow-full-access=terminal'
      ? '--allow-full-access'
      : arg,
  );
  let result: ReturnType<typeof parseWith>;
  try {
    result = parseWith(args);
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = result;

  if (command !== 'run') {
    const stray = RUN_ONLY_OPTIONS.find((name) => values[name] !== undefined);
    if (stray !== undefined) {
      throw new UsageError(`Unknown option '--${stray}' for "${command}".`);
    }
  }
  if (command !== 'plan') {
    const stray = PLAN_ONLY_OPTIONS.find((name) => values[name] !== undefined);
    if (stray !== undefined) {
      throw new UsageError(`Unknown option '--${stray}' for "${command}".`);
    }
  }
  if (positionals.length > 1) {
    throw new UsageError(`Too many arguments: ${positionals.slice(1).join(' ')}`);
  }

  const rawTimeout = values.timeout;
  let timeout: number | undefined;
  if (rawTimeout !== undefined) {
    timeout = Number(rawTimeout);
    if (rawTimeout.trim() === '' || !Number.isFinite(timeout) || timeout <= 0) {
      throw new UsageError(`--timeout must be a positive number of seconds, got "${rawTimeout}"`);
    }
  }

  let parallel: number | undefined;
  try {
    parallel = parseParallelFlag(values.parallel);
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }

  return {
    file: positionals[0] ?? DEFAULT_FILE,
    plugins: values.plugin ?? [],
    workdir: values.workdir ?? '.',
    taskId: values['task-id'],
    timeout,
    parallel,
    verbosity: values.verbose?.length ?? 0,
    tui: values.tui === true,
    discussionDir: values['discussion-dir'],
    permissions: values.permissions ?? [],
    allowFullAccess: values['allow-full-access'] === true ? (provenance ?? 'run_option') : undefined,
    confirm: values.confirm ?? [],
    input: values.input ?? [],
    inputFile: values['input-file'] ?? [],
    explain: values.explain === true || values.json === true,
    json: values.json === true,
    help: values.help === true,
  };
}

function parseWith(args: readonly string[]) {
  return parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      plugin: { type: 'string', multiple: true },
      workdir: { type: 'string', short: 'w' },
      'task-id': { type: 'string' },
      timeout: { type: 'string' },
      parallel: { type: 'string' },
      verbose: { type: 'boolean', short: 'v', multiple: true },
      tui: { type: 'boolean' },
      'discussion-dir': { type: 'string' },
      permissions: { type: 'string', multiple: true },
      'allow-full-access': { type: 'boolean' },
      confirm: { type: 'string', multiple: true },
      input: { type: 'string', multiple: true },
      'input-file': { type: 'string', multiple: true },
      explain: { type: 'boolean' },
      json: { type: 'boolean' },
    },
  });
}

async function loadPlugins(specifiers: readonly string[], cwd: string): Promise<Plugin[]> {
  const plugins: Plugin[] = [];
  for (const specifier of specifiers) {
    plugins.push(await loadPlugin(specifier, cwd));
  }
  return plugins;
}

export async function main(argv: readonly string[], io: Io = processIo()): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined) {
    const gate = await homeGate(io, io.loadTui ?? loadTui, io.env.INDABA_NO_TUI === '1');
    if (gate.kind === 'exit') {
      return gate.code;
    }
    if (gate.kind === 'open') {
      return logged('home', io.cwd, { args: [], level: undefined, dir: undefined }, io, async (logger) =>
        runHome(io, gate, logger, {
          ascii: io.env.INDABA_ASCII === '1',
          color: io.env.NO_COLOR === undefined || io.env.NO_COLOR === '',
          environment: io.env,
          ...(await homeControl(io, logger)),
        }),
      );
    }
    return usageError(io, 'No command given.');
  }
  if (command === '--help' || command === '-h') {
    io.stdout.write(USAGE);
    return EXIT_OK;
  }
  if (command === '--version' || command === '-V') {
    io.stdout.write(`${readVersion()}\n`);
    return EXIT_OK;
  }
  let logOptions: LogOptions;
  try {
    logOptions = extractLogOptions(rest);
    chooseLevel(logOptions.level, io.env.INDABA_LOG_LEVEL);
  } catch (error) {
    if (error instanceof LogUsageError) {
      return usageError(io, error.message, COMMAND_USAGE[command] === undefined ? undefined : command);
    }
    throw error;
  }
  const args = logOptions.args;
  if (command === 'ui') {
    return logged(command, io.cwd, logOptions, io, async (logger) => {
      try {
        const { runControl, workflowStore, workflowEditor, registry } = await uiBackendsFor(io, logger);
        return await ui(args, io, {
          logger,
          ...(io.loadServer === undefined ? {} : { loadServer: io.loadServer }),
          loggingSettings: (root) => settingsBackend(root, io, logOptions),
          ...(runControl === undefined ? {} : { runControl }),
          workflowStore,
          workflowEditor,
          registry,
        });
      } catch (error) {
        const message = redact(error instanceof Error ? error.message : String(error), io.env);
        (error instanceof IndabaError ? io.stdout : io.stderr).write(`${message}\n`);
        return EXIT_FAILURE;
      }
    });
  }
  if (command === 'watch') {
    return logged(command, io.cwd, logOptions, io, (logger) => watchCommand(args, io, logger));
  }
  if (command === 'settings') {
    return logged(command, io.cwd, logOptions, io, (logger) =>
      settingsCommand(args, io, (workdir) => resolve(io.cwd, workdir), {
        logger,
        loadTui: io.loadTui ?? loadTui,
        noColor: io.env.NO_COLOR !== undefined && io.env.NO_COLOR !== '',
        testSink,
        isVariableSet: (name) => io.env[name] !== undefined && io.env[name] !== '',
        sinkOptions: (root) => ({
          root,
          level: 'debug',
          dir: logOptions.dir,
          stderr: io.stderr,
          environment: io.env,
          clock: io.clock ?? (() => new Date()),
          pid: io.pid ?? process.pid,
          hostname: hostname(),
        }),
      }),
    );
  }
  if (command === 'schema') {
    return logged(command, io.cwd, logOptions, io, async (logger) => {
      if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
        io.stdout.write(commandUsage('schema'));
        return EXIT_OK;
      }
      if (args.length > 0) {
        return usageError(io, `Unexpected argument: ${args[0] ?? ''}.`, 'schema');
      }
      io.stdout.write(`${JSON.stringify(workflowJsonSchema(), null, 2)}\n`);
      logger.info('cli.schema', 'the schema was printed');
      return EXIT_OK;
    });
  }
  if (command === 'workflows') {
    let options: WorkflowsOptions;
    try {
      options = parseWorkflows(args);
    } catch (error) {
      if (error instanceof WorkflowsUsageError) {
        return usageError(io, error.message, 'workflows');
      }
      throw error;
    }
    if (options.help) {
      io.stdout.write(commandUsage('workflows'));
      return EXIT_OK;
    }
    return logged(command, io.cwd, logOptions, io, async (logger) => {
      try {
        const plugins = await loadPlugins(options.plugins, io.cwd);
        const configFolder = userConfigFolder(
          process.platform,
          { appData: io.env.APPDATA, xdgConfigHome: io.env.XDG_CONFIG_HOME },
          homedir(),
        );
        return await workflowsCommand(options, io, {
          cwd: io.cwd,
          rootsFile: join(configFolder, WORKFLOW_ROOTS_FILE),
          pid: io.pid ?? process.pid,
          logger,
          registry: async (roots) => {
            const bundle = await createEngine({
              projectDir: io.cwd,
              env: io.env,
              plugins,
              logger,
              logSinks: logger,
              humanAdjudicator: LISTED_HUMAN_ARBITER,
            });
            return (
              bundle.workflowRegistry ??
              new FileWorkflowRegistry({
                roots,
                parse: (source) => bundle.parser.parse(source, { placeholders: true }),
                clock: io.clock ?? (() => new Date()),
                ids: () => randomBytes(8).toString('hex'),
                logger,
              })
            );
          },
        });
      } catch (error) {
        const message = redact(error instanceof Error ? error.message : String(error), io.env);
        (error instanceof IndabaError ? io.stdout : io.stderr).write(`${message}\n`);
        return EXIT_FAILURE;
      }
    });
  }
  if (command === 'catalog') {
    let options: CatalogOptions;
    try {
      options = parseCatalog(args);
    } catch (error) {
      if (error instanceof CatalogUsageError) {
        return usageError(io, error.message, 'catalog');
      }
      throw error;
    }
    if (options.help) {
      io.stdout.write(commandUsage('catalog'));
      return EXIT_OK;
    }
    return logged(command, io.cwd, logOptions, io, async (logger) => {
      try {
        return await catalogCommand(options, io, {
          logger,
          loadPlugins: (specifiers) => loadPlugins(specifiers, io.cwd),
          sources: async (plugins) => {
            const bundle = await createEngine({
              projectDir: io.cwd,
              env: io.env,
              plugins,
              logger,
              logSinks: logger,
              humanAdjudicator: io.humanAdjudicator ?? LISTED_HUMAN_ARBITER,
            });
            return { runners: bundle.runners, guards: bundle.guards, adjudicators: bundle.adjudicators };
          },
        });
      } catch (error) {
        const message = redact(error instanceof Error ? error.message : String(error), io.env);
        (error instanceof IndabaError ? io.stdout : io.stderr).write(`${message}\n`);
        return EXIT_FAILURE;
      }
    });
  }
  if (command === 'report') {
    return logged(command, io.cwd, logOptions, io, (logger) => reportCommand(args, io, logger, logOptions));
  }
  if (command !== 'validate' && command !== 'plan' && command !== 'run') {
    return usageError(io, `Unknown command "${command}".`);
  }

  let parsed: Parsed;
  try {
    parsed = parseCommand(command, args);
  } catch (error) {
    if (error instanceof UsageError) {
      return usageError(io, error.message, command);
    }
    throw error;
  }
  if (parsed.help) {
    io.stdout.write(withLogOptions(COMMAND_USAGE[command] ?? USAGE));
    return EXIT_OK;
  }

  let root = io.cwd;
  if (command === 'run') {
    const projectDir = await projectDirOf(parsed, io);
    if (projectDir === undefined) {
      return EXIT_FAILURE;
    }
    root = projectDir;
  }

  return logged(command, root, logOptions, io, async (logger) => {
    try {
      if (command === 'validate') {
        return await validate(parsed, io, logger);
      }
      if (command === 'plan') {
        return await plan(parsed, io, logger);
      }
      return parsed.tui
        ? await runInDashboard(root, rest, io, logger, parsed)
        : await run(parsed, root, io, logger);
    } catch (error) {
      const message = redact(error instanceof Error ? error.message : String(error), io.env);
      // `plan --json` keeps stdout for the JSON alone: its problems go to stderr (specs/plan-explain, AC-13).
      const toStdout = error instanceof IndabaError && !(command === 'plan' && parsed.json);
      (toStdout ? io.stdout : io.stderr).write(`${message}\n`);
      return EXIT_FAILURE;
    }
  });
}

async function watchCommand(args: readonly string[], io: Io, logger: Logger): Promise<number> {
  try {
    return await watch(args, io, {
      logger,
      noColor: io.env.NO_COLOR !== undefined && io.env.NO_COLOR !== '',
      loadTui: io.loadTui ?? loadTui,
    });
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error), io.env);
    (error instanceof IndabaError ? io.stdout : io.stderr).write(`${message}\n`);
    return EXIT_FAILURE;
  }
}

interface UiBackends {
  readonly runControl?: (roots: readonly string[]) => UiRunControl;
  readonly workflowStore: (roots: readonly string[]) => UiWorkflowStore;
  readonly workflowEditor: UiWorkflowEditor;
  /** The registry's screens (specs/web-app-registry); the finder of the store and the run control follows it. */
  readonly registry: (roots: readonly string[]) => UiRegistryControl;
}

/**
 * What the page of `indaba ui` may do besides reading runs, each with the parser `indaba validate` uses: start and stop
 * runs (specs/web-app-actions), a child `indaba run` per run through the same starter as `run --tui`, and read, check
 * and save a workflow's text (specs/web-app-editing-core). Without a starter (a test that gives none) the page cannot
 * start runs.
 */
async function uiBackendsFor(io: Io, logger: Logger): Promise<UiBackends> {
  // The arbiter `human` is listed, as `indaba catalog` lists it: a workflow can name it, and nothing here rules.
  const bundle = await createEngine({
    projectDir: io.cwd,
    env: io.env,
    logger,
    humanAdjudicator: LISTED_HUMAN_ARBITER,
  });
  const { parser } = bundle;
  // Listing and checking a workflow needs no values: a file that asks for inputs is valid, and `indaba run` asks (spec workflow-inputs, C-16).
  const parse = (source: string) => parser.parse(source, { placeholders: true });
  const pid = io.pid ?? process.pid;
  const diagnose = (source: string) => parser.diagnose(source);
  // One registry hub per set of served roots, shared by the store, the run control and the registry's screens, so they
  // agree on ids and share the scan (specs/workflow-registry, slice 2). It covers the served roots, then the per-user
  // list of folders, and follows a folder the page adds (specs/web-app-registry, C-01).
  const clock = io.clock ?? (() => new Date());
  const folder = userConfigFolder(
    process.platform,
    { appData: io.env.APPDATA, xdgConfigHome: io.env.XDG_CONFIG_HOME },
    homedir(),
  );
  const hubs = new Map<string, RegistryHub>();
  const hubFor = (roots: readonly string[]): RegistryHub => {
    const key = JSON.stringify(roots);
    const known = hubs.get(key);
    if (known !== undefined) {
      return known;
    }
    const hub = createRegistryHub({
      roots,
      rootsFile: join(folder, WORKFLOW_ROOTS_FILE),
      pid,
      createRegistry: (covered) =>
        new FileWorkflowRegistry({
          roots: covered,
          parse,
          clock,
          ids: () => randomBytes(8).toString('hex'),
          logger,
        }),
      clock,
      cwd: io.cwd,
      logger,
    });
    hubs.set(key, hub);
    return hub;
  };
  const finderFor = (roots: readonly string[]): WorkflowFinder => hubFor(roots).finder;
  const registry = (roots: readonly string[]): UiRegistryControl => hubFor(roots).control;
  const workflowStore = (roots: readonly string[]) =>
    createWorkflowStore({ roots, finder: finderFor(roots), parse, diagnose, pid, logger });
  const workflowEditor = createWorkflowEditor({
    parse,
    diagnose,
    schema: workflowJsonSchema(),
    catalog: catalogOf(bundle),
  });
  const starter = io.startRun;
  if (starter === undefined) {
    return { workflowStore, workflowEditor, registry };
  }
  const confirmationFile = join(folder, CONFIRMATION_FILE);
  return {
    workflowStore,
    workflowEditor,
    registry,
    runControl: (roots) =>
      createRunControl({
        roots,
        finder: finderFor(roots),
        starter,
        environment: io.env,
        confirmationFile,
        pid,
        ids: () => randomBytes(12).toString('hex'),
        parse,
        readiness: (workflow, root, confirmed) =>
          analyzeReadiness(
            workflow,
            new Map(),
            createReadinessProbe(root, io.env, bundle.runners),
            confirmed,
          ),
        logger,
      }),
  };
}

/**
 * The control Home starts and stops runs with: the one `indaba ui` builds for the project, when this process can start runs.
 * Home without it still lists and opens runs, so a failure to build it is logged and not fatal.
 */
async function homeControl(io: Io, logger: Logger): Promise<{ control?: UiRunControl }> {
  try {
    const control = (await uiBackendsFor(io, logger)).runControl?.([io.cwd]);
    return control === undefined ? {} : { control };
  } catch {
    logger.info('cli.home', 'the control that starts runs could not be built; Home only lists runs');
    return {};
  }
}

/** What the page of `indaba ui` may do with the logging settings of a project: the same reader, writer and test as `indaba settings`. */
function settingsBackend(root: string, io: Io, logOptions: LogOptions): UiSettingsBackend {
  const answer = async (): Promise<UiSettingsState> => {
    const config = await readProjectConfig(root);
    const variables: Record<string, boolean> = {};
    for (const sink of config.logging.settings.sinks) {
      if ((sink.type === 'gelf' || sink.type === 'http-json') && sink.secretEnv !== undefined) {
        const value = io.env[sink.secretEnv];
        variables[sink.secretEnv] = value !== undefined && value !== '';
      }
    }
    return { settings: config.logging.settings, path: config.path, present: config.present, variables };
  };
  return {
    read: answer,
    save: async (settings) => {
      await writeLoggingConfig(root, settings);
      return answer();
    },
    test: (sink) =>
      testSink(sink, {
        root,
        level: 'debug',
        dir: logOptions.dir,
        stderr: io.stderr,
        environment: io.env,
        clock: io.clock ?? (() => new Date()),
        pid: io.pid ?? process.pid,
        hostname: hostname(),
      }),
  };
}

/** The folders the file sinks of a project write to: those of its indaba.config, or the default, or --log-dir. */
async function logFoldersOf(root: string, options: LogOptions): Promise<string[]> {
  const config = await readProjectConfig(root);
  const folders = config.logging.settings.sinks.flatMap((sink) =>
    sink.type === 'file' ? [resolve(root, options.dir ?? sink.folder)] : [],
  );
  return [...new Set(folders)];
}

async function reportCommand(
  args: readonly string[],
  io: Io,
  logger: Logger,
  logOptions: LogOptions,
): Promise<number> {
  try {
    return await report(args, io, {
      logger,
      redact: (text) => redact(text, io.env),
      runtime: {
        indabaVersion: readVersion(),
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      logFolders: (root) => logFoldersOf(root, logOptions),
    });
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error), io.env);
    (error instanceof IndabaError ? io.stdout : io.stderr).write(`${message}\n`);
    return EXIT_FAILURE;
  }
}

/**
 * What a command knows of the workflow's inputs before it has parsed it (specs/workflow-inputs): the declarations, read
 * from the file's text alone. A file that cannot be read, or whose declarations have problems, gives none: the parse
 * that follows reports it as it always did.
 */
async function declaredInputs(
  parsed: Parsed,
  io: Io,
): Promise<ReturnType<typeof readInputDeclarations>['declarations'] | undefined> {
  let source: string;
  try {
    source = await readFile(resolve(io.cwd, parsed.file), 'utf8');
  } catch {
    return undefined;
  }
  const found = readInputDeclarations(source);
  return found.problems.length === 0 ? found.declarations : undefined;
}

/**
 * Resolves the inputs of a run before anything exists (AC-15): the options, the defaults, and the person's answers.
 * A number is an exit code. A file that cannot be read or whose declarations have problems has no inputs here: the
 * parse that follows says what is wrong with it, rather than "this workflow takes no inputs".
 */
async function inputsForRun(
  parsed: Parsed,
  io: Io,
  projectDir: string,
): Promise<number | Extract<Gathered, { ok: true }>> {
  const declarations = await declaredInputs(parsed, io);
  if (declarations === undefined) {
    return { ok: true, inputs: undefined, supplied: { values: {} }, asked: [] };
  }
  const supplied = await suppliedFromOptions(parsed.input, parsed.inputFile, declarations, projectDir);
  if (!supplied.ok) {
    return usageError(io, supplied.message, 'run');
  }
  const gathered = await gatherInputs({
    declarations,
    supplied: supplied.supplied,
    workDir: projectDir,
    ask: inputAsker(io),
  });
  return gathered.ok ? gathered : refuseInputs(io, gathered);
}

/** The questions of a run: the plain ones at a terminal, unless a test or a front end supplied its own. */
function inputAsker(io: Io): AskInputs | undefined {
  return (
    io.askInputs ??
    (io.terminal === undefined ? undefined : terminalInputAsker(io.terminal.stdin, io.terminal.stdout))
  );
}

/**
 * `run --tui` asks in the dashboard package's form when the package has one and a person is at the terminal, before the
 * dashboard takes the screen (AC-17). A test or front end that supplied its own questions keeps them; an older
 * `@indaba/tui` without the form leaves the plain questions in place.
 */
async function dashboardInputAsker(io: Io, logger: CommandLogger): Promise<AskInputs | undefined> {
  if (io.askInputs !== undefined || io.terminal === undefined) {
    return undefined;
  }
  const { stdin, stdout } = io.terminal;
  const loaded = await (io.loadTui ?? loadTui)();
  if (!('tui' in loaded) || loaded.tui.collectInputs === undefined) {
    return undefined;
  }
  const { collectInputs } = loaded.tui;
  return async (declarations, missing) => {
    const fields = declarations.filter((entry) => missing.includes(entry.name));
    const collected = await collectInputs({
      fields,
      ascii: io.env.INDABA_ASCII === '1',
      color: io.env.NO_COLOR === undefined || io.env.NO_COLOR === '',
      stdout,
      stdin,
      logger,
    });
    return collected === undefined ? undefined : { values: { ...collected.values } };
  };
}

/** An input that cannot be used ends the command as a usage error: nothing has been created yet (AC-15). */
function refuseInputs(io: Io, gathered: Extract<Gathered, { ok: false }>): number {
  io.stderr.write(gathered.message);
  return gathered.code;
}

/** Reads the workflow file; when none was named and the default is missing, says what to do about it. */
async function loadWorkflow(
  parser: WorkflowParser,
  parsed: Parsed,
  io: Io,
  options?: ParseOptions,
): Promise<WorkflowDefinition> {
  try {
    return await parser.parseFile(resolve(io.cwd, parsed.file), options);
  } catch (error) {
    if (
      error instanceof WorkflowValidationError &&
      parsed.file === DEFAULT_FILE &&
      error.problems.some((problem) => problem.startsWith('cannot read workflow file'))
    ) {
      throw new WorkflowValidationError([
        ...error.problems,
        `no file was given, so ${DEFAULT_FILE} was tried; name one: indaba <command> <workflow-file>`,
      ]);
    }
    throw error;
  }
}

/**
 * What `validate` and `plan` make of `--input`: they need no values and read the file with placeholders; values given
 * are checked as a run would check them, a missing one is no problem (C-16), and a bad one is a usage error (AC-14).
 */
async function checkedInputs(
  parsed: Parsed,
  declarations: Awaited<ReturnType<typeof declaredInputs>>,
  io: Io,
  command: 'plan' | 'validate',
): Promise<
  | number
  | {
      readonly options: ParseOptions;
      readonly supplied: { readonly values: Readonly<Record<string, readonly string[]>> };
    }
> {
  if (declarations === undefined) {
    return { options: { placeholders: true }, supplied: { values: {} } };
  }
  const workDir = resolve(io.cwd);
  const supplied = await suppliedFromOptions(parsed.input, parsed.inputFile, declarations, workDir);
  if (!supplied.ok) {
    return usageError(io, supplied.message, command);
  }
  if (Object.keys(supplied.supplied.values).length === 0) {
    return { options: { placeholders: true }, supplied: supplied.supplied };
  }
  const result = await checkInputs({ declarations, supplied: supplied.supplied, workDir });
  if (!result.ok) {
    io.stderr.write(result.message);
    return EXIT_USAGE;
  }
  return {
    options: result.inputs === undefined ? { placeholders: true } : { inputs: result.inputs },
    supplied: supplied.supplied,
  };
}

async function validate(parsed: Parsed, io: Io, logger: CommandLogger): Promise<number> {
  const plugins = await loadPlugins(parsed.plugins, io.cwd);
  const { parser, runners } = await createEngine({
    projectDir: io.cwd,
    env: io.env,
    plugins,
    logger,
    logSinks: logger,
  });
  const declarations = await declaredInputs(parsed, io);
  const checked = await checkedInputs(parsed, declarations, io, 'validate');
  if (typeof checked === 'number') {
    return checked;
  }
  let workflow: WorkflowDefinition;
  try {
    workflow = await loadWorkflow(parser, parsed, io, checked.options);
  } catch (error) {
    if (!(error instanceof WorkflowValidationError)) {
      throw error;
    }
    io.stdout.write(`${parsed.file} is invalid:\n`);
    for (const problem of error.problems) {
      io.stdout.write(` - ${problem}\n`);
    }
    return EXIT_FAILURE;
  }
  const findings = checkPermissions(workflow, runners);
  const refused = findings.filter((f) => f.severity === 'error');
  const stalls = checkStalls(workflow, runners);
  if (refused.length > 0 || stalls.length > 0) {
    io.stdout.write(`${parsed.file} is invalid:\n`);
    for (const finding of refused) {
      io.stdout.write(` - ${describePermissionFinding(finding)}\n`);
    }
    for (const finding of stalls) {
      io.stdout.write(` - ${describeStallFinding(finding)}\n`);
    }
    return EXIT_FAILURE;
  }
  io.stdout.write(
    `${workflow.name} is valid (${workflow.steps.length} steps, ${Object.keys(workflow.roles).length} roles).\n`,
  );
  for (const warning of new WorkflowValidator().warnings(workflow)) {
    io.stdout.write(`warning: ${warning}\n`);
  }
  for (const finding of findings) {
    io.stdout.write(`permissions: ${describePermissionFinding(finding)}\n`);
  }
  return EXIT_OK;
}

/** The readiness report of a workflow on this machine (specs/run-readiness). It informs and never stops a start (C-04). */
function readinessReport(
  workflow: WorkflowDefinition,
  io: Io,
  root: string,
  runners: PermissionRunners & { has(name: string): boolean },
  confirmed: ReadonlySet<string>,
): ReadinessReport {
  return analyzeReadiness(workflow, new Map(), createReadinessProbe(root, io.env, runners), confirmed);
}

function readinessOf(
  workflow: WorkflowDefinition,
  io: Io,
  root: string,
  runners: PermissionRunners & { has(name: string): boolean },
  confirmed: ReadonlySet<string>,
): readonly string[] {
  return readinessLines(readinessReport(workflow, io, root, runners, confirmed));
}

async function plan(parsed: Parsed, io: Io, logger: CommandLogger): Promise<number> {
  const plugins = await loadPlugins(parsed.plugins, io.cwd);
  const { parser, planner, runners } = await createEngine({
    projectDir: io.cwd,
    env: io.env,
    plugins,
    logger,
    logSinks: logger,
  });
  const declarations = await declaredInputs(parsed, io);
  const checked = await checkedInputs(parsed, declarations, io, 'plan');
  if (typeof checked === 'number') {
    return checked;
  }
  const workflow = await loadWorkflow(parser, parsed, io, checked.options);
  const order = new DagBuilder().build(workflow);
  // `--json` keeps stdout for the JSON alone: the rest of the plan is not printed and what fails goes to stderr.
  const text = (line: string): void => {
    if (!parsed.json) {
      io.stdout.write(line);
    }
  };
  const problem = (line: string): void => {
    (parsed.json ? io.stderr : io.stdout).write(line);
  };
  const explanation = parsed.explain ? await explanationOf(workflow, parsed, io) : undefined;

  order.forEach((step, n) => {
    const who = isShellStep(step)
      ? `shell: ${oneLine(step.commands.join(' && '))}`
      : (step.role ?? step.runner ?? '?');
    const extra: string[] = [];
    if (step.dependsOn.length > 0) {
      extra.push(`after ${step.dependsOn.join(', ')}`);
    }
    if (isConsensusStep(step)) {
      extra.push(`consensus with ${step.consensusWith.join(', ')}`);
    }
    if (step.timeoutSeconds !== undefined) {
      extra.push(`timeout ${step.timeoutSeconds}s`);
    }
    if (step.stall !== undefined) {
      extra.push(`stall ${step.stall.afterSeconds}s`);
      if (step.stall.retries > 0) {
        extra.push(`stall retries ${step.stall.retries}`);
      }
    }
    if (!isShellStep(step) && !isConsensusStep(step)) {
      const names = planForStep(step, workflow).names;
      if (names.length > 1) {
        extra.push(`runners ${names.join(' -> ')}`);
      }
    }
    for (const guard of effectiveGuards(step)) {
      if (guard.type === 'diff_within_scope') {
        extra.push(
          `may only change ${guard.paths.length === 0 ? 'nothing' : oneLine(guard.paths.join(', '))}`,
        );
      }
    }
    text(`${n + 1}. ${step.id} [${who}]${extra.length === 0 ? '' : ` (${extra.join('; ')})`}\n`);
    const board = describeBoard(step);
    if (board !== undefined) {
      text(`   ${board}\n`);
    }
    const explained = explanation?.steps.find((candidate) => candidate.id === step.id);
    for (const line of explained === undefined ? [] : explanationLines(explained)) {
      text(`${line}\n`);
    }
  });

  for (const line of inputLines(declarations ?? {}, checked.supplied)) {
    text(`${line}\n`);
  }
  for (const name of workflow.unusedInputs ?? []) {
    text(`warning: the input "${name}" is declared but no step uses it.\n`);
  }
  // The groups for the limit that would run: variable, file, then the workflow, (specs/parallel-steps, AC-32).
  const configured = await readProjectConfig(io.cwd);
  const asked = resolveLimit({
    flag: undefined,
    variable: io.env.INDABA_PARALLEL,
    configured: configured.parallel.maxSteps,
  });
  const wanted =
    workflow.maxParallel === undefined ? asked.limit : Math.min(asked.limit, workflow.maxParallel);
  const notice = parallelNotice(wanted);
  if (notice !== undefined) {
    text(`${notice}\n`);
  }
  for (const line of planGroupLines(order, wanted)) {
    text(`${line}\n`);
  }

  let failed = false;
  for (const finding of checkPermissions(workflow, runners)) {
    failed ||= finding.severity === 'error';
    (finding.severity === 'error' ? problem : text)(
      `${finding.severity === 'error' ? 'permissions error: ' : 'permissions: '}${describePermissionFinding(finding)}\n`,
    );
  }
  for (const finding of checkStalls(workflow, runners)) {
    failed = true;
    problem(`stall error: ${describeStallFinding(finding)}\n`);
  }
  for (const issue of planner.preflight(workflow)) {
    failed ||= issue.isError;
    (issue.isError ? problem : text)(
      `${issue.isError ? 'MCP error: ' : 'MCP warning: '}${issue.describe()}\n`,
    );
  }
  // The readiness report closes the plan; it never changes the exit code (specs/run-readiness, AC-14).
  for (const line of readinessOf(workflow, io, io.cwd, runners, new Set())) {
    text(`${line}\n`);
  }
  if (parsed.json && explanation !== undefined) {
    io.stdout.write(renderExplanationJson(workflow.name, explanation));
  }
  return failed ? EXIT_FAILURE : EXIT_OK;
}

/**
 * The explanation of a plan (specs/plan-explain): the pure function of `@indaba/core` over the parsed workflow, the lines
 * of the file read again for origins, and the facts only the composition root knows. `plan` has no `--timeout`, so the
 * limit of a call is the engine's default; the rounds of a debate are those of the default arbiter.
 */
async function explanationOf(workflow: WorkflowDefinition, parsed: Parsed, io: Io): Promise<PlanExplanation> {
  let source: string | undefined;
  try {
    source = await readFile(resolve(io.cwd, parsed.file), 'utf8');
  } catch {
    source = undefined;
  }
  return explainPlan(workflow, source === undefined ? new Map() : readOrigins(source, workflow), {
    timeoutSeconds: { value: DEFAULT_TIMEOUT_SECONDS, by: 'engine' },
    debateRounds: { value: DEFAULT_MAX_ROUNDS, by: 'engine' },
    runnerDefault: runnerDefaultWords,
  });
}

/**
 * What a run prints. An agent's streamed text rarely ends with a newline, so a status line printed
 * after it would be glued to its last word: `line` starts on a fresh line when it has to.
 */
interface Screen {
  write(text: string): void;
  line(text: string): void;
}

function screenOf(io: Io): Screen {
  let atLineStart = true;
  const write = (text: string): void => {
    if (text === '') {
      return;
    }
    io.stdout.write(text);
    atLineStart = text.endsWith('\n');
  };
  return {
    write,
    line: (text) => write(atLineStart ? text : `\n${text}`),
  };
}

/** What an agent streams is shown as plain text only: see printable.ts. One filter per run, so a split sequence is still caught. */
function printed(screen: Screen): (chunk: string) => void {
  const filter = createPrintableFilter();
  return (chunk) => screen.write(filter(chunk));
}

/** The project directory a run works in, or undefined (after saying so) when it does not exist. */
async function projectDirOf(parsed: Parsed, io: Io): Promise<string | undefined> {
  try {
    return await realpath(resolve(io.cwd, parsed.workdir));
  } catch {
    io.stdout.write('Working directory does not exist.\n');
    return undefined;
  }
}

/** `run --tui`: the same command line, without the flag, in a process of its own, shown as a dashboard. */
interface PermissionGate {
  readonly workflow: WorkflowDefinition;
  readonly findings: readonly PermissionFinding[];
  readonly acknowledged: 'terminal' | 'run_option' | 'page' | undefined;
}

/**
 * What must hold before a run starts (specs/agent-permissions, AC-05, AC-07, AC-12): the run bounds are applied, a level
 * a runner cannot hold is refused, and the steps at `full` are acknowledged by a person or by `--allow-full-access`. A
 * number is the exit code of a run that must not start.
 */
async function permissionGate(
  parsed: Parsed,
  loaded: WorkflowDefinition,
  runners: PermissionRunners,
  io: Io,
): Promise<PermissionGate | number> {
  const bounds: RunBound[] = [];
  for (const text of parsed.permissions) {
    const bound = parseRunBound(text);
    if ('error' in bound) {
      return usageError(io, bound.error, 'run');
    }
    bounds.push(bound);
  }
  const bounded = applyRunBounds(loaded, bounds, runners);
  if (bounded.errors.length > 0) {
    return usageError(io, bounded.errors.join('\n'), 'run');
  }
  const workflow = bounded.workflow;
  const findings = [...checkPermissions(workflow, runners), ...bounded.findings];
  const refused = findings.filter((f) => f.severity === 'error');
  const stalls = checkStalls(workflow, runners);
  if (refused.length > 0 || stalls.length > 0) {
    io.stdout.write(`${parsed.file} is invalid:\n`);
    for (const finding of refused) {
      io.stdout.write(` - ${describePermissionFinding(finding)}\n`);
    }
    for (const finding of stalls) {
      io.stdout.write(` - ${describeStallFinding(finding)}\n`);
    }
    return EXIT_FAILURE;
  }

  const full = fullAccessSteps(workflow, runners);
  if (full.length === 0) {
    return { workflow, findings, acknowledged: undefined };
  }
  const list = full.map((f) => `  ${f.stepId} (${f.runners.join(', ')})`).join('\n');
  if (parsed.allowFullAccess !== undefined) {
    return { workflow, findings, acknowledged: parsed.allowFullAccess };
  }
  if (io.terminal === undefined) {
    return usageError(
      io,
      `These steps run at the level "full": the agent can change anything and run anything and nobody approves it.\n${list}\nThere is no terminal to ask at; pass --allow-full-access to start anyway.`,
      'run',
    );
  }
  if (!(await confirmFullAccess(io.terminal, list))) {
    io.stderr.write('Not started: full access was not confirmed.\n');
    return EXIT_USAGE;
  }
  return { workflow, findings, acknowledged: 'terminal' };
}

/** AC-05: names the steps at the level `full` and waits for a yes; anything else is a no. */
async function confirmFullAccess(terminal: NonNullable<Io['terminal']>, list: string): Promise<boolean> {
  const lines = createInterface({ input: terminal.stdin, output: terminal.stdout });
  try {
    const answer = await lines.question(
      `These steps run at the level "full": the agent can change anything and run anything and nobody approves it.\n${list}\nStart the run? [y/N] `,
    );
    return /^\s*y(es)?\s*$/i.test(answer);
  } finally {
    lines.close();
  }
}

async function runInDashboard(
  projectDir: string,
  args: readonly string[],
  io: Io,
  logger: CommandLogger,
  parsed: Parsed,
): Promise<number> {
  // The child has no terminal, so the parent asks about steps at `full` and hands the child the acknowledgement (AC-05).
  const forwarded = args.filter((arg) => arg !== '--tui');
  // The child has no terminal and never asks: what is missing is asked here, before the dashboard takes the screen, and
  // handed on as `--input` (specs/workflow-inputs, AC-17).
  const form = await dashboardInputAsker(io, logger);
  const gathered = await inputsForRun(
    parsed,
    form === undefined ? io : { ...io, askInputs: form },
    projectDir,
  );
  if (typeof gathered === 'number') {
    return gathered;
  }
  let handedOn = 0;
  for (const name of gathered.asked) {
    for (const raw of gathered.supplied.values[name] ?? []) {
      forwarded.push('--input', `${name}=${raw}`);
      handedOn += 1;
    }
  }
  // The answers travel as options, so the child counts them with the ones given (AC-12): refuse here, not after the dashboard is up.
  if (parsed.input.length + parsed.inputFile.length + handedOn > INPUT_LIMITS.options) {
    return usageError(io, tooManyOptions(parsed.input.length + parsed.inputFile.length + handedOn), 'run');
  }
  // Only a workflow that cannot be read is left to the run itself, which reports it; a refused or unconfirmed gate stops here.
  let loaded: { workflow: WorkflowDefinition; runners: PermissionRunners } | undefined;
  try {
    const plugins = await loadPlugins(parsed.plugins, io.cwd);
    const { parser, runners } = await createEngine({
      projectDir,
      env: io.env,
      plugins,
      logger,
      logSinks: logger,
    });
    loaded = {
      workflow: await loadWorkflow(parser, parsed, io, { placeholders: true }),
      runners,
    };
  } catch {
    loaded = undefined;
  }
  if (loaded !== undefined) {
    const gate = await permissionGate(parsed, loaded.workflow, loaded.runners, io);
    if (typeof gate === 'number') {
      return gate;
    }
    // The child cannot ask, so it is told who did, and records it.
    if (gate.acknowledged === 'terminal') {
      forwarded.push('--allow-full-access=terminal');
    }
  }
  return runWithDashboard(
    forwarded,
    projectDir,
    { ...io, loadTui: io.loadTui ?? loadTui },
    { environment: io.env, noColor: io.env.NO_COLOR !== undefined && io.env.NO_COLOR !== '', logger },
  );
}

async function run(parsed: Parsed, projectDir: string, io: Io, logger: CommandLogger): Promise<number> {
  const plugins = await loadPlugins(parsed.plugins, io.cwd);
  // The limit of steps that run at once: flag, variable, file, default (specs/parallel-steps, AC-01).
  const configured = await readProjectConfig(projectDir);
  const limit = resolveLimit({
    flag: parsed.parallel,
    variable: io.env.INDABA_PARALLEL,
    configured: configured.parallel.maxSteps,
  });
  for (const warning of limit.warnings) {
    io.stderr.write(`${warning}\n`);
  }
  // Every input is resolved before a task, a worktree, a trace or a ledger entry exists (specs/workflow-inputs, AC-15).
  const gathered = await inputsForRun(parsed, io, projectDir);
  if (typeof gathered === 'number') {
    return gathered;
  }
  const { engine, parser, events, runners } = await createEngine({
    ...(gathered.inputs === undefined ? {} : { inputs: gathered.inputs }),
    maxParallelSteps: limit.limit,
    maxParallelSource: limit.source,
    maxWaits: configured.parallel.maxWaits,
    projectDir,
    logger,
    logSinks: logger,
    env: io.env,
    plugins,
    ...(io.chooseAuthMethod === undefined ? {} : { chooseAuthMethod: io.chooseAuthMethod }),
    ...(io.humanAdjudicator === undefined ? {} : { humanAdjudicator: io.humanAdjudicator }),
    ...(parsed.timeout === undefined ? {} : { stepTimeoutSeconds: parsed.timeout }),
    ...(parsed.discussionDir === undefined
      ? {}
      : { discussionDirectory: resolve(io.cwd, parsed.discussionDir) }),
    onListenerError: (error) => {
      const reason = error instanceof Error ? error.message : String(error);
      io.stderr.write(`Listener failed: ${redact(reason, io.env)}\n`);
    },
  });
  const loaded = await loadWorkflow(
    parser,
    parsed,
    io,
    gathered.inputs === undefined ? undefined : { inputs: gathered.inputs },
  );

  const gate = await permissionGate(parsed, loaded, runners, io);
  if (typeof gate === 'number') {
    return gate;
  }
  const { workflow, findings, acknowledged } = gate;

  const screen = screenOf(io);
  const notice = parallelNotice(limit.limit);
  if (notice !== undefined) {
    screen.line(`${notice}\n`);
  }
  events.addListener(StepStatusChanged, (e) => {
    const reason = e.reason === undefined ? '' : ` (${e.reason.split('\n')[0] ?? ''})`;
    screen.line(`  ${e.stepId.padEnd(14)} ${e.from} -> ${e.to}${reason}\n`);
  });
  if (parsed.verbosity >= 1) {
    events.addListener(SpanEnded, (e) => {
      const cost = e.span.attributes[Tracer.ATTR_COST_USD];
      if (typeof cost === 'number') {
        screen.line(`    ${e.span.name}: $${cost.toFixed(4)}\n`);
      }
    });
  }

  screen.line(`Running ${workflow.name}\n`);
  // The full-access sentence is repeated at the start of every run; the other facts are for plan and validate (AC-04, AC-08).
  for (const finding of findings.filter((f) => f.code === 'full')) {
    screen.line(`  permissions: ${describePermissionFinding(finding)}\n`);
  }
  const readiness = readinessReport(workflow, io, projectDir, runners, new Set(parsed.confirm));
  for (const line of readinessLines(readiness, true)) {
    screen.line(`${line}
`);
  }
  const result = await engine.run(workflow, {
    readiness,
    ...(acknowledged === undefined ? {} : { fullAccessAcknowledged: acknowledged }),
    ...(io.signal === undefined ? {} : { signal: io.signal }),
    ...(parsed.taskId === undefined ? {} : { taskId: parsed.taskId }),
    ...(parsed.verbosity >= 2 ? { onOutput: printed(screen) } : {}),
  });

  screen.line(`Task ${result.taskId} finished: ${result.status} (trace ${result.traceId})\n`);
  if (result.failureReason !== undefined) {
    screen.line(`${redact(result.failureReason, io.env)}\n`);
  }

  switch (result.status) {
    case WorkflowStatus.Completed:
      return EXIT_OK;
    case WorkflowStatus.Failed:
      return EXIT_FAILURE;
    case WorkflowStatus.Escalated:
      return EXIT_USAGE;
    default:
      return EXIT_INTERRUPTED;
  }
}
