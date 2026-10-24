import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  type FullAccessStep,
  PermissionLevel,
  type RunSummaryOfUse,
  SHELL_RUNNER,
  type StepDefinition,
  type WorkflowDefinition,
} from '@indaba/core';
import { isAgentStep, planForStep, sanitize } from '@indaba/engine';

/** How many confirmed versions of one workflow are kept; the oldest goes first. */
export const MAX_HASHES_PER_WORKFLOW = 10;
/** The longest item of the summary of use; a longer one is cut. A starting value, not a measurement. */
export const MAX_USE_ITEM = 300;
/** The most items of one list of the summary; the rest are counted, not shown. A starting value. */
export const MAX_USE_ITEMS = 100;

/** The name of the store, under the user's configuration folder: outside every project (spec C-03). */
export const CONFIRMATION_FILE = join('indaba', 'confirmed-workflows.json');

/** The SHA-256 of the exact bytes that will run, lowercase hexadecimal. */
export function contentHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Text from a workflow file shown to a person: no control sequence, a bounded length. */
function item(text: string): string {
  const clean = sanitize(text).replace(/\s+/g, ' ').trim();
  return clean.length > MAX_USE_ITEM ? `${clean.slice(0, MAX_USE_ITEM - 1)}…` : clean;
}

function bounded(items: readonly string[]): string[] {
  if (items.length <= MAX_USE_ITEMS) {
    return [...items];
  }
  return [...items.slice(0, MAX_USE_ITEMS - 1), `and ${items.length - (MAX_USE_ITEMS - 1)} more`];
}

function runnerOf(step: StepDefinition, workflow: WorkflowDefinition): string | undefined {
  return step.runner ?? (step.role === undefined ? undefined : workflow.roles[step.role]?.runner);
}

function fallbacksOf(step: StepDefinition, workflow: WorkflowDefinition): readonly string[] {
  return (
    step.fallbackRunners ??
    (step.role === undefined ? [] : (workflow.roles[step.role]?.fallbackRunners ?? []))
  );
}

/**
 * What the first run of a workflow will use, as its file declares it (AC-04), built from the definition parsed from the
 * same buffer that is hashed and run. It covers the file only: not the scripts a command calls, `indaba.config`,
 * plugins, or what an agent then does with its own tools. The page says so.
 */
export function summaryOfUse(workflow: WorkflowDefinition): RunSummaryOfUse {
  const runners: string[] = [];
  const commands: string[] = [];
  const permissions: string[] = [];
  const needsPerson: string[] = [];
  const fullAccessSteps: FullAccessStep[] = [];
  const seen = new Set<string>();
  const runner = (name: string): void => {
    if (!seen.has(name)) {
      seen.add(name);
      runners.push(item(name));
    }
  };

  for (const [name, role] of Object.entries(workflow.roles)) {
    if (role.agent?.command !== undefined && role.agent.command.length > 0) {
      commands.push(item(`role ${name}: ${role.agent.command.join(' ')}`));
    }
  }
  for (const step of workflow.steps) {
    const name = runnerOf(step, workflow);
    if (name !== undefined) {
      runner(name);
    }
    for (const fallback of fallbacksOf(step, workflow)) {
      runner(fallback);
    }
    if (name === SHELL_RUNNER) {
      for (const command of step.commands) {
        commands.push(item(`${step.id}: ${command}`));
      }
    }
    if (step.agent?.command !== undefined && step.agent.command.length > 0) {
      commands.push(item(`${step.id}: ${step.agent.command.join(' ')}`));
    }
    const declared = step.permissions;
    permissions.push(
      item(
        declared === undefined
          ? `${step.id}: runner default (unrestricted)`
          : declared.level === 'full'
            ? `${step.id}: FULL ACCESS: the agent can change anything and run anything and nobody approves it`
            : // An empty `read` restricts nothing; an empty `write` allows nothing (docs/workflow-format.md).
              `${step.id}: read ${declared.fsRead.length === 0 ? 'anything' : declared.fsRead.join(', ')}; ` +
              `write ${declared.fsWrite.length === 0 ? 'nothing' : declared.fsWrite.join(', ')}; ` +
              `terminal ${declared.terminal}`,
      ),
    );
    if (isAgentStep(step, workflow) && declared?.level === PermissionLevel.Full) {
      fullAccessSteps.push({
        stepId: item(step.id),
        runners: planForStep(step, workflow).names.map(item),
      });
    }
    if (step.arbiter === 'human') {
      needsPerson.push(item(step.id));
    }
  }
  for (const [name, server] of Object.entries(workflow.mcpServers)) {
    if (server.command !== undefined) {
      commands.push(item(`MCP server ${name}: ${[server.command, ...server.args].join(' ')}`));
    }
  }
  return {
    runners: bounded(runners),
    commands: bounded(commands),
    permissions: bounded(permissions),
    needsPerson: bounded(needsPerson),
    fullAccessSteps: fullAccessSteps.slice(0, MAX_USE_ITEMS),
  };
}

type Store = Map<string, Map<string, string[]>>;

function storeOf(text: string): Store {
  const store: Store = new Map();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return store;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return store;
  }
  for (const [root, paths] of Object.entries(data)) {
    if (typeof paths !== 'object' || paths === null || Array.isArray(paths)) {
      continue;
    }
    const byPath = new Map<string, string[]>();
    for (const [path, hashes] of Object.entries(paths)) {
      if (Array.isArray(hashes)) {
        byPath.set(
          path,
          hashes.filter((hash): hash is string => typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash)),
        );
      }
    }
    store.set(root, byPath);
  }
  return store;
}

function textOf(store: Store): string {
  const data = Object.fromEntries(
    [...store].map(([root, byPath]) => [root, Object.fromEntries([...byPath])] as const),
  );
  return `${JSON.stringify(data, null, 2)}\n`;
}

/**
 * The workflows a person confirmed, by the realpath of their root, their relative path and the SHA-256 of their bytes,
 * kept in the user's configuration folder (spec C-03). A file that cannot be read or parsed counts as empty: the safe
 * direction is to ask again. Writes are atomic (a temporary file, then a rename) and a failure is the caller's to see.
 */
export class ConfirmationStore {
  private writes = 0;

  /** `file` is the store itself; a test passes one in a temporary folder. */
  constructor(
    private readonly file: string,
    private readonly pid: number,
  ) {}

  private async load(): Promise<Store> {
    try {
      return storeOf(await readFile(this.file, 'utf8'));
    } catch {
      return new Map();
    }
  }

  async has(root: string, path: string, hash: string): Promise<boolean> {
    return (await this.load()).get(root)?.get(path)?.includes(hash) ?? false;
  }

  /** Records the hash, newest last, keeping at most {@link MAX_HASHES_PER_WORKFLOW}. Rejects when it cannot write. */
  async add(root: string, path: string, hash: string): Promise<void> {
    const store = await this.load();
    const byPath = store.get(root) ?? new Map<string, string[]>();
    const hashes = (byPath.get(path) ?? []).filter((known) => known !== hash);
    hashes.push(hash);
    byPath.set(path, hashes.slice(-MAX_HASHES_PER_WORKFLOW));
    store.set(root, byPath);
    await mkdir(dirname(this.file), { recursive: true });
    this.writes += 1;
    const temporary = `${this.file}.${this.pid}.${this.writes}.tmp`;
    try {
      await writeFile(temporary, textOf(store), { flag: 'wx' });
      await rename(temporary, this.file);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
