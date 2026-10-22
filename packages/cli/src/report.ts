import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { IndabaError, type Logger, type LogRecord } from '@indaba/core';
import { isRunId, PROJECT_CONFIG_FILE, type RunSummary, TraceReader } from '@indaba/engine';
import type { Io } from './main.js';

export const REPORT_USAGE = `Usage: indaba report [run] [options]

Gather what someone helping you needs about one run into a folder: the log lines of the processes that ran it, the
run's trace and events, the workflow file, indaba.config and the environment (Indaba, Node, operating system).
Everything is redacted the same way the log is. Nothing is sent anywhere; look through the folder, then attach it.
A run is its 32-character id, a unique start of it, or "latest" (the default).

Options:
  -w, --workdir <dir>    The project directory (default: .)
      --workflow <file>  The workflow file to include (default: .indaba/workflow.ai.yml when it exists)
      --out <dir>        Where the folder is made (default: .indaba/reports; a relative one stays in the project)
`;

/**
 * The most log lines a report takes. A starting value, not a measurement (specs/logging, section 8): enough for a long
 * run at `debug`, small enough that a person can read what they are about to send.
 */
export const MAX_REPORT_LOG_LINES = 20_000;

class ReportUsage extends Error {}

interface Parsed {
  readonly run: string;
  readonly workdir: string;
  readonly workflow: string | undefined;
  readonly out: string | undefined;
  readonly help: boolean;
}

function parseReport(args: readonly string[]): Parsed {
  let parsed: ReturnType<typeof parseOptions>;
  try {
    parsed = parseOptions(args);
  } catch (error) {
    throw new ReportUsage(error instanceof Error ? error.message : String(error));
  }
  if (parsed.positionals.length > 1) {
    throw new ReportUsage(`Too many arguments: ${parsed.positionals.slice(1).join(' ')}`);
  }
  return {
    run: parsed.positionals[0] ?? 'latest',
    workdir: parsed.values.workdir ?? '.',
    workflow: parsed.values.workflow,
    out: parsed.values.out,
    help: parsed.values.help === true,
  };
}

function parseOptions(args: readonly string[]) {
  return parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      workdir: { type: 'string', short: 'w' },
      workflow: { type: 'string' },
      out: { type: 'string' },
    },
  });
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function choose(name: string, runs: readonly RunSummary[]): string {
  if (name === 'latest') {
    const newest = runs[0];
    if (newest === undefined) {
      throw new IndabaError('There are no runs to report on.');
    }
    return newest.runId;
  }
  if (!isRunId(name)) {
    throw new IndabaError(`"${name}" is not a run id: it is lowercase hexadecimal, or "latest".`);
  }
  const matches = runs.filter((r) => r.runId.startsWith(name));
  const exact = matches.find((r) => r.runId === name);
  if (exact !== undefined) {
    return exact.runId;
  }
  if (matches.length === 1 && matches[0] !== undefined) {
    return matches[0].runId;
  }
  throw new IndabaError(
    matches.length === 0
      ? `No run starts with "${name}".`
      : `"${name}" fits ${matches.length} runs; give more of it.`,
  );
}

async function textOf(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

function parsedLines(text: string): LogRecord[] {
  const records: LogRecord[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value === 'object' && value !== null && 'message' in value) {
        records.push(value as LogRecord);
      }
    } catch {
      // A line cut by a crash, or written by something else: not part of the report.
    }
  }
  return records;
}

/** The task ids the run's events name, so a log record carrying only the task id is found too. */
function taskIdsOf(events: string): Set<string> {
  const ids = new Set<string>();
  for (const line of events.split('\n')) {
    const match = line.match(/"task_id":"([^"\\]{1,200})"/);
    if (match?.[1] !== undefined) {
      ids.add(match[1]);
    }
  }
  return ids;
}

/**
 * The log lines of a run: every record that names its trace or one of its tasks, and every other record of the
 * commands that wrote those (their start record, what a runner started, a plugin), in the order of the files.
 */
async function logLinesOf(folder: string, runId: string, taskIds: ReadonlySet<string>): Promise<LogRecord[]> {
  let names: string[];
  try {
    names = (await readdir(folder)).filter((name) => /^indaba-.*\.log\.jsonl$/.test(name)).sort();
  } catch {
    return [];
  }
  const all: LogRecord[] = [];
  for (const name of names) {
    all.push(...parsedLines((await textOf(join(folder, name))) ?? ''));
  }
  const pids = new Set<number>();
  for (const record of all) {
    const context = record.context;
    if (
      record.pid !== undefined &&
      (context?.traceId === runId || (context?.taskId !== undefined && taskIds.has(context.taskId)))
    ) {
      pids.add(record.pid);
    }
  }
  return all
    .filter((record) => record.pid !== undefined && pids.has(record.pid))
    .slice(-MAX_REPORT_LOG_LINES);
}

export interface ReportOptions {
  readonly logger: Logger;
  /** The same redaction the command's logger applies (main builds it from the environment). */
  readonly redact: (text: string) => string;
  /** What the start record of a command holds, for the environment record: the version, Node, platform and architecture. */
  readonly runtime: Readonly<Record<string, string>>;
  /** The folders of the log files of a project, as the logger of a command in it writes them. */
  readonly logFolders: (root: string) => Promise<readonly string[]>;
}

/** `indaba report`: see the usage text. Returns the exit status. */
export async function report(args: readonly string[], io: Io, options: ReportOptions): Promise<number> {
  let parsed: Parsed;
  try {
    parsed = parseReport(args);
  } catch (error) {
    if (error instanceof ReportUsage) {
      io.stderr.write(`${error.message}\n\n${REPORT_USAGE}`);
      return 2;
    }
    throw error;
  }
  if (parsed.help) {
    io.stdout.write(REPORT_USAGE);
    return 0;
  }

  const root = resolve(io.cwd, parsed.workdir);
  const traces = join(root, '.indaba', 'traces');
  const runId = choose(parsed.run, await new TraceReader(traces).listRuns());
  const redact = options.redact;
  const now = (io.clock ?? (() => new Date()))();
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');

  const outRoot = resolve(root, parsed.out ?? join('.indaba', 'reports'));
  if (parsed.out !== undefined && !isAbsolute(parsed.out) && !isInside(root, outRoot)) {
    throw new IndabaError('--out: a relative folder must stay inside the project.');
  }
  const folder = join(outRoot, `report-${runId.slice(0, 12)}-${stamp}`);
  await mkdir(folder, { recursive: true });

  const written: { name: string; what: string }[] = [];
  const put = async (name: string, what: string, text: string): Promise<void> => {
    await writeFile(join(folder, name), redact(text), 'utf8');
    written.push({ name, what });
  };
  const missing: string[] = [];

  const events = (await textOf(join(traces, `${runId}.events.jsonl`))) ?? '';
  if (events !== '') {
    await put('events.jsonl', 'what the run did, as it did it', events);
  } else {
    missing.push('events.jsonl (the run wrote none)');
  }
  const trace = await textOf(join(traces, `${runId}.jsonl`));
  if (trace !== undefined) {
    await put('trace.jsonl', 'the spans of the run: steps, agent calls, tokens and cost', trace);
  } else {
    missing.push('trace.jsonl (not written yet: the run may still be going)');
  }

  const lines: LogRecord[] = [];
  for (const logFolder of await options.logFolders(root)) {
    lines.push(...(await logLinesOf(logFolder, runId, taskIdsOf(events))));
  }
  if (lines.length > 0) {
    await put(
      'log.jsonl',
      'the log lines of the processes that ran it',
      `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`,
    );
  } else {
    missing.push('log.jsonl (no log line names this run)');
  }

  const workflowPath = resolve(io.cwd, parsed.workflow ?? join(root, '.indaba', 'workflow.ai.yml'));
  const workflow = await textOf(workflowPath);
  if (workflow !== undefined) {
    await put('workflow.ai.yml', 'the workflow file', workflow);
  } else if (parsed.workflow !== undefined) {
    throw new IndabaError(`--workflow: cannot read "${parsed.workflow}".`);
  } else {
    missing.push('workflow.ai.yml (name it with --workflow <file>)');
  }
  const config = await textOf(join(root, PROJECT_CONFIG_FILE));
  if (config !== undefined) {
    await put(PROJECT_CONFIG_FILE, 'the project configuration', config);
  }

  // The start record of each command: the one that names the command and the Node version.
  const starts = lines
    .filter((l) => l.fields?.command !== undefined && l.fields.nodeVersion !== undefined)
    .map((l) => l.fields ?? {});
  await put(
    'environment.json',
    'Indaba, Node and the operating system, now and when the run was started',
    `${JSON.stringify(
      {
        runId,
        reportedAt: now.toISOString(),
        ...options.runtime,
        processes: starts,
      },
      null,
      2,
    )}\n`,
  );
  await put(
    'README.txt',
    'what is here',
    [
      `A report of the Indaba run ${runId}, made by "indaba report" at ${now.toISOString()}.`,
      '',
      ...written.map((w) => `${w.name.padEnd(18)} ${w.what}`),
      ...(missing.length === 0 ? [] : ['', 'Not included:', ...missing.map((m) => `  ${m}`)]),
      '',
      'Credentials known to Indaba were replaced by [redacted]. Paths, commands, file names and what agents wrote',
      'are still here: read the files before sending them to anyone.',
      '',
    ].join('\n'),
  );

  options.logger.info('cli.report', 'a report was written', { runId, files: written.length, folder });
  io.stdout.write(`Report of run ${runId} written to ${folder}\n`);
  for (const file of written) {
    io.stdout.write(`  ${file.name.padEnd(18)} ${file.what}\n`);
  }
  for (const item of missing) {
    io.stdout.write(`  not included: ${item}\n`);
  }
  io.stdout.write('Nothing was sent anywhere. Read the files before you attach them to a report.\n');
  return 0;
}
