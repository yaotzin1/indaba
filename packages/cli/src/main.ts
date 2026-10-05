import { readFileSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  DagBuilder,
  IndabaError,
  isConsensusStep,
  isShellStep,
  type Plugin,
  SpanEnded,
  StepStatusChanged,
  Tracer,
  type WorkflowDefinition,
  WorkflowValidationError,
} from '@indaba/core';
import {
  effectiveGuards,
  planForStep,
  type WorkflowParser,
  WorkflowStatus,
  WorkflowValidator,
} from '@indaba/engine';
import type { AuthChooser } from '@indaba/runners';
import { createEngine } from './engine-factory.js';
import { loadPlugin } from './plugin-loader.js';

export interface Io {
  readonly stdout: { write(text: string): void };
  readonly stderr: { write(text: string): void };
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  /** Aborting it cancels a running workflow; teardown still runs. */
  readonly signal?: AbortSignal;
  /** Present only when a person is at a terminal: lets them pick how an ACP agent logs in. */
  readonly chooseAuthMethod?: AuthChooser;
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

Options:
  -h, --help        Show help
  -V, --version     Show the version

The file defaults to ${DEFAULT_FILE}. Every command accepts --plugin <specifier> (repeatable):
a file path or package name whose default export is an Indaba plugin.
Run "indaba <command> --help" for the options of one command.
`;

const COMMAND_USAGE: Readonly<Record<string, string>> = {
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
  -v, --verbose           Print the cost of each span; -vv also streams agent output
`,
};

const RUN_ONLY_OPTIONS = ['workdir', 'task-id', 'timeout', 'verbose'] as const;

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

/** Environment values that look like credentials never reach the terminal, even inside an error. */
function redact(text: string, env: Io['env']): string {
  let out = text;
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value.length >= 4 && /key|token|secret|password|credential/i.test(key)) {
      out = out.split(value).join('[redacted]');
    }
  }
  return out;
}

function usageError(io: Io, message: string, command?: string): number {
  io.stderr.write(`${message}\n\n${command === undefined ? USAGE : (COMMAND_USAGE[command] ?? USAGE)}`);
  return EXIT_USAGE;
}

interface Parsed {
  readonly file: string;
  readonly plugins: readonly string[];
  readonly workdir: string;
  readonly taskId: string | undefined;
  readonly timeout: number | undefined;
  readonly verbosity: number;
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
  if (command !== 'validate' && command !== 'plan' && command !== 'run') {
    return usageError(io, `Unknown command "${command}".`);
  }

  let parsed: Parsed;
  try {
    parsed = parseCommand(command, rest);
  } catch (error) {
    if (error instanceof UsageError) {
      return usageError(io, error.message, command);
    }
    throw error;
  }
  if (parsed.help) {
    io.stdout.write(COMMAND_USAGE[command] ?? USAGE);
    return EXIT_OK;
  }

  try {
    if (command === 'validate') {
      return await validate(parsed, io);
    }
    return command === 'plan' ? await plan(parsed, io) : await run(parsed, io);
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

async function validate(parsed: Parsed, io: Io): Promise<number> {
  const plugins = await loadPlugins(parsed.plugins, io.cwd);
  const { parser } = await createEngine({ projectDir: io.cwd, env: io.env, plugins });
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

async function plan(parsed: Parsed, io: Io): Promise<number> {
  const plugins = await loadPlugins(parsed.plugins, io.cwd);
  const { parser, planner } = await createEngine({ projectDir: io.cwd, env: io.env, plugins });
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

async function run(parsed: Parsed, io: Io): Promise<number> {
  let projectDir: string;
  try {
    projectDir = await realpath(resolve(io.cwd, parsed.workdir));
  } catch {
    io.stdout.write('Working directory does not exist.\n');
    return EXIT_FAILURE;
  }

  const plugins = await loadPlugins(parsed.plugins, io.cwd);
  const { engine, parser, events } = await createEngine({
    projectDir,
    env: io.env,
    plugins,
    ...(io.chooseAuthMethod === undefined ? {} : { chooseAuthMethod: io.chooseAuthMethod }),
    ...(parsed.timeout === undefined ? {} : { stepTimeoutSeconds: parsed.timeout }),
    onListenerError: (error) => {
      const reason = error instanceof Error ? error.message : String(error);
      io.stderr.write(`Listener failed: ${redact(reason, io.env)}\n`);
    },
  });
  const workflow = await loadWorkflow(parser, parsed, io);

  events.addListener(StepStatusChanged, (e) => {
    const reason = e.reason === undefined ? '' : ` (${e.reason.split('\n')[0] ?? ''})`;
    io.stdout.write(`  ${e.stepId.padEnd(14)} ${e.from} -> ${e.to}${reason}\n`);
  });
  if (parsed.verbosity >= 1) {
    events.addListener(SpanEnded, (e) => {
      const cost = e.span.attributes[Tracer.ATTR_COST_USD];
      if (typeof cost === 'number') {
        io.stdout.write(`    ${e.span.name}: $${cost.toFixed(4)}\n`);
      }
    });
  }

  io.stdout.write(`Running ${workflow.name}\n`);
  const result = await engine.run(workflow, {
    ...(io.signal === undefined ? {} : { signal: io.signal }),
    ...(parsed.taskId === undefined ? {} : { taskId: parsed.taskId }),
    ...(parsed.verbosity >= 2 ? { onOutput: (chunk: string) => io.stdout.write(chunk) } : {}),
  });

  io.stdout.write(`Task ${result.taskId} finished: ${result.status} (trace ${result.traceId})\n`);
  if (result.failureReason !== undefined) {
    io.stdout.write(`${redact(result.failureReason, io.env)}\n`);
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
