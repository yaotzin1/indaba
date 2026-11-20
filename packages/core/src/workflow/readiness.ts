import type { AttentionItem, AttentionKind, AttentionState } from './attention.js';
import { Isolation, type WorkflowDefinition } from './model.js';
import { runnerChainOf } from './readiness-runners.js';

/** What the machine can say. Every answer is a name or a state: the value of a variable cannot come through. */
export interface ReadinessProbe {
  isEnvSet(name: string): boolean;
  fileState(relativePath: string): 'file' | 'directory' | 'missing' | 'outside';
  hasExecutable(name: string): boolean;
  /** Registered and, for an agent CLI, its executable is found. */
  isRunnerRegistered(type: string, preset?: string): boolean;
  /** The variables this runner reads, by name. A plugin's probe may add its own (C-06). */
  envNamesOf(type: string, preset?: string): readonly string[];
  workspaceKind(): 'git' | 'plain';
}

export interface ReadinessReport {
  readonly items: readonly AttentionItem[];
  readonly criticalMissing: number;
  readonly needsConfirmation: number;
}

interface Extra {
  readonly stepId?: string;
  readonly how?: string;
}

export function attentionId(kind: AttentionKind, stepId: string | undefined, name: string): string {
  return `${kind}:${stepId ?? '-'}:${name}`;
}

function rank(item: AttentionItem): number {
  if (item.state === 'missing' && item.critical) {
    return 0;
  }
  if (item.state === 'needs-confirmation') {
    return 1;
  }
  if (item.state === 'missing' || item.state === 'unknown') {
    return 2;
  }
  return 3;
}

/** A probe that throws gives `unknown`, never a failure of the report (C-03). */
function ask<T>(question: () => T): { readonly ok: true; readonly value: T } | { readonly ok: false } {
  try {
    return { ok: true, value: question() };
  } catch {
    return { ok: false };
  }
}

function make(
  kind: AttentionKind,
  name: string,
  state: AttentionState,
  critical: boolean,
  message: string,
  extra: Extra = {},
): AttentionItem {
  return {
    id: attentionId(kind, extra.stepId, name),
    kind,
    state,
    critical,
    ...(extra.stepId !== undefined ? { stepId: extra.stepId } : {}),
    message,
    ...(extra.how !== undefined ? { how: extra.how } : {}),
  };
}

function unknown(kind: AttentionKind, name: string, extra: Extra): AttentionItem {
  return make(kind, name, 'unknown', false, `${name} could not be checked`, extra);
}

function yesNo(
  kind: AttentionKind,
  name: string,
  critical: boolean,
  extra: Extra,
  question: () => boolean,
  words: { readonly ready: string; readonly missing: string },
): AttentionItem {
  const answer = ask(question);
  if (!answer.ok) {
    return unknown(kind, name, extra);
  }
  return answer.value
    ? make(kind, name, 'ready', critical, words.ready, extra)
    : make(kind, name, 'missing', critical, words.missing, extra);
}

function fileItem(
  kind: AttentionKind,
  name: string,
  critical: boolean,
  extra: Extra,
  probe: ReadinessProbe,
): AttentionItem {
  const state = ask(() => probe.fileState(name));
  if (!state.ok) {
    return unknown(kind, name, extra);
  }
  if (state.value === 'file' || state.value === 'directory') {
    return make(kind, name, 'ready', critical, `${name} exists`, extra);
  }
  const why = state.value === 'outside' ? 'it lies outside the project' : 'it does not exist';
  return make(kind, name, 'missing', critical, `${name}: ${why}`, extra);
}

/**
 * What a run needs and what this machine and the person have, in step order (C-07). Pure: the machine is the probe.
 * `_inputs` is kept for the input checks of `workflow-inputs` (AC-03), which is not implemented, so nothing reads it yet.
 */
export function analyzeReadiness(
  workflow: WorkflowDefinition,
  _inputs: ReadonlyMap<string, unknown>,
  probe: ReadinessProbe,
  confirmed: ReadonlySet<string>,
): ReadinessReport {
  const items: AttentionItem[] = [];
  const seen = new Set<string>();
  const add = (item: AttentionItem): void => {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      items.push(item);
    }
  };

  const produced = new Set<string>();
  for (const step of workflow.steps) {
    const stepId = step.id;
    for (const [name, preset] of runnerChainOf(step, workflow)) {
      add(
        yesNo(
          'runner',
          name,
          true,
          {
            stepId,
            how: `Install ${name} so its program is on the PATH (Indaba needs a native executable, not a .cmd shim), or choose another runner for step "${stepId}".`,
          },
          () => probe.isRunnerRegistered(name, preset),
          { ready: `${name} is available`, missing: `${name} is not available on this machine` },
        ),
      );
      const names = ask(() => probe.envNamesOf(name, preset));
      for (const variable of names.ok ? names.value : []) {
        add(
          yesNo(
            'secret',
            variable,
            true,
            { stepId, how: `Set ${variable} in your environment before you start.` },
            () => probe.isEnvSet(variable),
            { ready: `${variable} is set`, missing: `${variable} is not set` },
          ),
        );
      }
    }
    for (const path of step.inputArtifacts) {
      if (!produced.has(path)) {
        add(fileItem('artifact', path, false, { stepId }, probe));
      }
    }
    for (const path of step.outputs) {
      produced.add(path);
    }
    const level = step.permissions?.level;
    if (level !== undefined && level !== workflow.defaultPermissions?.level) {
      add(
        make('permission', level, 'ready', false, `step "${stepId}" runs with the level "${level}"`, {
          stepId,
        }),
      );
    }
  }

  if (!workflow.steps.some((step) => step.isolation === Isolation.GitWorktree)) {
    add(make('workspace', 'isolation', 'ready', false, 'steps run in the project folder'));
  } else {
    const kind = ask(() => probe.workspaceKind());
    if (!kind.ok) {
      add(make('workspace', 'isolation', 'unknown', false, 'the workspace could not be checked'));
    } else if (kind.value === 'plain') {
      add(
        make(
          'workspace',
          'isolation',
          'missing',
          false,
          'a step asks for a git worktree and this folder is not a git repository',
          { how: 'Run it inside a git repository.' },
        ),
      );
    } else {
      add(make('workspace', 'isolation', 'ready', false, 'steps run in a git worktree'));
    }
  }

  for (const need of workflow.requires ?? []) {
    const critical = need.critical === true;
    const extra: Extra = need.how === undefined || need.how.trim() === '' ? {} : { how: need.how };
    if (need.kind === 'env') {
      add(
        yesNo('env', need.name, critical, extra, () => probe.isEnvSet(need.name), {
          ready: `${need.name} is set`,
          missing: `${need.name} is not set: ${need.description}`,
        }),
      );
    } else if (need.kind === 'file') {
      add(fileItem('file', need.name, critical, extra, probe));
    } else if (need.kind === 'tool') {
      add(
        yesNo('tool', need.name, critical, extra, () => probe.hasExecutable(need.name), {
          ready: `${need.name} is installed`,
          missing: `${need.name} was not found as a native program on the PATH: ${need.description}`,
        }),
      );
    } else {
      const state = confirmed.has(attentionId(need.kind, undefined, need.name))
        ? 'confirmed'
        : 'needs-confirmation';
      add(make(need.kind, need.name, state, critical, need.description, extra));
    }
  }

  const ordered = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
    .map((entry) => entry.item);
  return {
    items: ordered,
    criticalMissing: ordered.filter((i) => i.critical && i.state === 'missing').length,
    needsConfirmation: ordered.filter((i) => i.state === 'needs-confirmation').length,
  };
}
