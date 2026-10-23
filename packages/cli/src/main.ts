import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  type Adjudicator,
  DagBuilder,
  IndabaError,
  isConsensusStep,
  isShellStep,
  type Logger,
  type Plugin,
  SpanEnded,
  StepStatusChanged,
  Tracer,
  type WorkflowDefinition,
  WorkflowValidationError,
} from '@indaba/core';
import {
  catalogOf,
  effectiveGuards,
  FileWorkflowRegistry,
  PROJECT_CONFIG_FILE,
  planForStep,
  readProjectConfig,
  type WorkflowParser,
  WorkflowStatus,
  WorkflowValidator,
  workflowJsonSchema,
  writeLoggingConfig,
} from '@indaba/engine';
import type { AuthChooser } from '@indaba/runners';
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
import { loadPlugin } from './plugin-loader.js';
import { createPrintableFilter } from './printable.js';
import { redact } from './redact.js';
import { report } from './report.js';
import type { RunStarter } from './run-child.js';
import { CONFIRMATION_FILE } from './run-control/confirm.js';
import { createWorkflowEditor } from './run-control/editor.js';
import { createWorkflowFinder, type WorkflowFinder } from './run-control/finder.js';
import { createRunControl } from './run-control/index.js';
import { createWorkflowStore } from './run-control/source.js';
import { runWithDashboard } from './run-tui.js';
import type {
  ServerLoad,
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
  validate: `Usage: indaba validate [file] [--plugin <specifier>]...

Validate a workflow file and print every problem found.
`,
  plan: `Usage: indaba plan [file] [--plugin <specifier>]...

Show the execution order of a workflow without running it.
`,
  run: `Usage: indaba run [file] [options]

Execute a workflow.

Options:
  -w, --workdir <dir>     Project directory the workflow runs against (default: .)
      --task-id <id>      Task id (names the worktree and trace)
      --timeout <secs>    Per-step timeout in seconds (default: 900)
      --plugin <spec>     Load a plugin; repeatable
      --discussion-dir <dir>
                          Where the messages of each debate are kept for the web view (default: .indaba/discussions)
  -v, --verbose           Print the cost of each span; -vv also streams agent output
      --tui               Run in a process of its own and show it as a dashboard (needs a terminal and @indaba/tui);
                          closing the dashboard asks whether to detach (the run goes on) or cancel it
`,
};

function withLogOptions(usage: string): string {
  return `${usage}\n${LOG_OPTIONS_USAGE}`;
}

const RUN_ONLY_OPTIONS = ['workdir', 'task-id', 'timeout', 'verbose', 'tui', 'discussion-dir'] as const;

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
  readonly verbosity: number;
  readonly tui: boolean;
  readonly discussionDir: string | undefined;
  readonly help: boolean;
}

function parseCommand(command: string, args: readonly string[]): Parsed {
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

  return {
    file: positionals[0] ?? DEFAULT_FILE,
    plugins: values.plugin ?? [],
    workdir: values.workdir ?? '.',
    taskId: values['task-id'],
    timeout,
    verbosity: values.verbose?.length ?? 0,
    tui: values.tui === true,
    discussionDir: values['discussion-dir'],
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
      verbose: { type: 'boolean', short: 'v', multiple: true },
      tui: { type: 'boolean' },
      'discussion-dir': { type: 'string' },
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
        const { runControl, workflowStore, workflowEditor } = await uiBackendsFor(io, logger);
        return await ui(args, io, {
          logger,
          ...(io.loadServer === undefined ? {} : { loadServer: io.loadServer }),
          loggingSettings: (root) => settingsBackend(root, io, logOptions),
          ...(runControl === undefined ? {} : { runControl }),
          workflowStore,
          workflowEditor,
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
                parse: (source) => bundle.parser.parse(source),
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
      return parsed.tui ? await runInDashboard(root, rest, io, logger) : await run(parsed, root, io, logger);
    } catch (error) {
      const message = redact(error instanceof Error ? error.message : String(error), io.env);
      (error instanceof IndabaError ? io.stdout : io.stderr).write(`${message}\n`);
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
  const parse = (source: string) => parser.parse(source);
  const pid = io.pid ?? process.pid;
  const diagnose = (source: string) => parser.diagnose(source);
  // One finder per set of roots, shared by the store and the run control, so they agree on ids and share the scan
  // (specs/workflow-registry, slice 2).
  const clock = io.clock ?? (() => new Date());
  const finders = new Map<string, WorkflowFinder>();
  const finderFor = (roots: readonly string[]): WorkflowFinder => {
    const key = JSON.stringify(roots);
    const known = finders.get(key);
    if (known !== undefined) {
      return known;
    }
    const finder = createWorkflowFinder({
      registry: new FileWorkflowRegistry({
        roots,
        parse,
        clock,
        ids: () => randomBytes(8).toString('hex'),
        logger,
      }),
      clock,
    });
    finders.set(key, finder);
    return finder;
  };
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
    return { workflowStore, workflowEditor };
  }
  const folder = userConfigFolder(
    process.platform,
    { appData: io.env.APPDATA, xdgConfigHome: io.env.XDG_CONFIG_HOME },
    homedir(),
  );
  const confirmationFile = join(folder, CONFIRMATION_FILE);
  return {
    workflowStore,
    workflowEditor,
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
        logger,
      }),
  };
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

/** Reads the workflow file; when none was named and the default is missing, says what to do about it. */
async function loadWorkflow(parser: WorkflowParser, parsed: Parsed, io: Io): Promise<WorkflowDefinition> {
  try {
    return await parser.parseFile(resolve(io.cwd, parsed.file));
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

async function validate(parsed: Parsed, io: Io, logger: CommandLogger): Promise<number> {
  const plugins = await loadPlugins(parsed.plugins, io.cwd);
  const { parser } = await createEngine({
    projectDir: io.cwd,
    env: io.env,
    plugins,
    logger,
    logSinks: logger,
  });
  let workflow: WorkflowDefinition;
  try {
    workflow = await loadWorkflow(parser, parsed, io);
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
  io.stdout.write(
    `${workflow.name} is valid (${workflow.steps.length} steps, ${Object.keys(workflow.roles).length} roles).\n`,
  );
  for (const warning of new WorkflowValidator().warnings(workflow)) {
    io.stdout.write(`warning: ${warning}\n`);
  }
  return EXIT_OK;
}

async function plan(parsed: Parsed, io: Io, logger: CommandLogger): Promise<number> {
  const plugins = await loadPlugins(parsed.plugins, io.cwd);
  const { parser, planner } = await createEngine({
    projectDir: io.cwd,
    env: io.env,
    plugins,
    logger,
    logSinks: logger,
  });
  const workflow = await loadWorkflow(parser, parsed, io);
  const order = new DagBuilder().build(workflow);

  order.forEach((step, n) => {
    const who = isShellStep(step)
      ? `shell: ${step.commands.join(' && ')}`
      : (step.role ?? step.runner ?? '?');
    const extra: string[] = [];
    if (step.dependsOn.length > 0) {
      extra.push(`after ${step.dependsOn.join(', ')}`);
    }
    if (isConsensusStep(step)) {
      extra.push(`consensus with ${step.consensusWith.join(', ')}`);
    }
    if (!isShellStep(step) && !isConsensusStep(step)) {
      const names = planForStep(step, workflow).names;
      if (names.length > 1) {
        extra.push(`runners ${names.join(' -> ')}`);
      }
    }
    for (const guard of effectiveGuards(step)) {
      if (guard.type === 'diff_within_scope') {
        extra.push(`may only change ${guard.paths.length === 0 ? 'nothing' : guard.paths.join(', ')}`);
      }
    }
    io.stdout.write(`${n + 1}. ${step.id} [${who}]${extra.length === 0 ? '' : ` (${extra.join('; ')})`}\n`);
  });

  let failed = false;
  for (const issue of planner.preflight(workflow)) {
    failed ||= issue.isError;
    io.stdout.write(`${issue.isError ? 'MCP error: ' : 'MCP warning: '}${issue.describe()}\n`);
  }
  return failed ? EXIT_FAILURE : EXIT_OK;
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
async function runInDashboard(
  projectDir: string,
  args: readonly string[],
  io: Io,
  logger: Logger,
): Promise<number> {
  return runWithDashboard(
    args.filter((arg) => arg !== '--tui'),
    projectDir,
    { ...io, loadTui: io.loadTui ?? loadTui },
    { environment: io.env, noColor: io.env.NO_COLOR !== undefined && io.env.NO_COLOR !== '', logger },
  );
}

async function run(parsed: Parsed, projectDir: string, io: Io, logger: CommandLogger): Promise<number> {
  const plugins = await loadPlugins(parsed.plugins, io.cwd);
  const { engine, parser, events } = await createEngine({
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
  const workflow = await loadWorkflow(parser, parsed, io);

  const screen = screenOf(io);
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
  const result = await engine.run(workflow, {
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
