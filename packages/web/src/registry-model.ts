import type {
  RegistryAnnotateRequest,
  RegistryEntryView,
  RegistryListResponse,
  RegistryRootView,
  RegistryScanReportView,
  RunCost,
  RunStatus,
} from '@indaba/core';
import { messages } from './messages.js';
import { runLook, type StateLook } from './status.js';

/**
 * The Workflows screen without a screen (specs/web-app-registry): the rows of the table, what a form changed, and the
 * sentences the actions report. Pure, so each rule has a test and the screen only draws.
 */

/** The longest name or project, tag and number of tags the server takes (spec C-03); the form says so before it sends. */
export const MAX_NAME_LENGTH = 120;
export const MAX_TAG_LENGTH = 40;
export const MAX_TAGS = 20;
/** The file name of a copy: no folders and no extension (`api-surface.md`). */
export const COPY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

/** A row of the Workflows table. */
export interface WorkflowRow {
  readonly id: string;
  readonly entry: RegistryEntryView;
  readonly name: string;
  readonly project: string;
  /** The tags as one string, for sorting and for the search. */
  readonly tags: string;
  /** What the table shows for the last result; undefined when the workflow never ran. */
  readonly lastStatus: RunStatus | undefined;
  readonly lastLook: StateLook | undefined;
  readonly lastCost: RunCost | undefined;
  readonly lastStartedAt: string | undefined;
  readonly state: StateLook;
  /** The reason behind an invalid or missing state, for a tooltip; empty when valid. */
  readonly stateWhy: string;
  /** Whether the name can open the workflow: a file that is gone cannot be opened. */
  readonly opens: boolean;
}

function stateOf(entry: RegistryEntryView): { look: StateLook; why: string } {
  switch (entry.validation.state) {
    case 'valid':
      return { look: { tone: 'completed', symbol: '✓', word: messages.registry.state.valid }, why: '' };
    case 'invalid':
      return {
        look: { tone: 'failed', symbol: '✗', word: messages.registry.state.invalid },
        why: entry.validation.message,
      };
    case 'missing':
      return {
        look: { tone: 'escalated', symbol: '▲', word: messages.registry.state.missing },
        why: entry.validation.reason,
      };
  }
}

/** The rows for the entries, hidden ones left out unless asked for. Order is the server's: folder, then path. */
export function rowsOf(list: RegistryListResponse, showHidden: boolean): readonly WorkflowRow[] {
  return list.entries
    .filter((entry) => showHidden || !entry.hidden)
    .map((entry): WorkflowRow => {
      const state = stateOf(entry);
      const run = entry.lastRun;
      return {
        id: entry.id,
        entry,
        name: entry.name,
        project: entry.project,
        tags: entry.tags.join(', '),
        lastStatus: run?.status,
        lastLook: run === undefined ? undefined : runLook(run.status),
        lastCost: run?.cost,
        lastStartedAt: run?.startedAt,
        state: state.look,
        stateWhy: state.why,
        opens: entry.validation.state !== 'missing',
      };
    });
}

/** How many entries the table is not showing because they are hidden. */
export const hiddenCount = (list: RegistryListResponse): number =>
  list.entries.filter((e) => e.hidden).length;

/** The folder of an entry, for a sentence such as "in blog". */
export const rootOf = (list: RegistryListResponse, entry: RegistryEntryView): RegistryRootView | undefined =>
  list.roots.find((root) => root.id === entry.rootId);

/** Tags typed as one line, separated by commas: trimmed, empty ones dropped, each once. */
export function tagsFromText(text: string): readonly string[] {
  const tags: string[] = [];
  for (const part of text.split(',')) {
    const tag = part.trim();
    if (tag !== '' && !tags.includes(tag)) {
      tags.push(tag);
    }
  }
  return tags;
}

export interface DetailsForm {
  /** What the person typed; empty means "use the default". */
  readonly name: string;
  readonly project: string;
  readonly tags: string;
}

export const formOf = (entry: RegistryEntryView): DetailsForm => ({
  name: entry.name,
  project: entry.project,
  tags: entry.tags.join(', '),
});

/** What is wrong with the form, in plain words, before anything is sent; empty when it can be saved. */
export function detailsProblems(form: DetailsForm): readonly string[] {
  const problems: string[] = [];
  const tooLong = (text: string): boolean => text.trim().length > MAX_NAME_LENGTH;
  if (tooLong(form.name)) {
    problems.push(messages.registry.editProblems.nameTooLong(MAX_NAME_LENGTH));
  }
  if (tooLong(form.project)) {
    problems.push(messages.registry.editProblems.projectTooLong(MAX_NAME_LENGTH));
  }
  const tags = tagsFromText(form.tags);
  if (tags.length > MAX_TAGS) {
    problems.push(messages.registry.editProblems.tooManyTags(MAX_TAGS));
  }
  if (tags.some((tag) => tag.length > MAX_TAG_LENGTH)) {
    problems.push(messages.registry.editProblems.tagTooLong(MAX_TAG_LENGTH));
  }
  return problems;
}

/**
 * The request that saves the form: only what changed. An emptied name or project asks for the default (`null`); one the
 * person did not touch is not sent. `undefined` when nothing changed.
 */
export function annotationOf(
  entry: RegistryEntryView,
  form: DetailsForm,
): RegistryAnnotateRequest | undefined {
  const request: { name?: string | null; project?: string | null; tags?: readonly string[] } = {};
  const name = form.name.trim();
  if (name !== entry.name) {
    request.name = name === '' ? null : name;
  }
  const project = form.project.trim();
  if (project !== entry.project) {
    request.project = project === '' ? null : project;
  }
  const tags = tagsFromText(form.tags);
  if (tags.join('\u0000') !== entry.tags.join('\u0000')) {
    request.tags = tags;
  }
  return Object.keys(request).length === 0 ? undefined : request;
}

/** The folders a copy may go to: all that can be read. */
export const copyTargets = (list: RegistryListResponse): readonly RegistryRootView[] =>
  list.roots.filter((root) => root.readable);

/** The sentence a scan ends with: what was found, and that a limit stopped it or an index was set aside. */
export function scanSentence(reports: readonly RegistryScanReportView[]): string {
  const sum = (pick: (r: RegistryScanReportView) => number): number =>
    reports.reduce((total, report) => total + pick(report), 0);
  const parts = [
    messages.registry.scan.found(sum((r) => r.found)),
    ...(sum((r) => r.added) > 0 ? [messages.registry.scan.added(sum((r) => r.added))] : []),
    ...(sum((r) => r.changed) > 0 ? [messages.registry.scan.changed(sum((r) => r.changed))] : []),
    ...(sum((r) => r.moved) > 0 ? [messages.registry.scan.moved(sum((r) => r.moved))] : []),
    ...(sum((r) => r.missing) > 0 ? [messages.registry.scan.missing(sum((r) => r.missing))] : []),
  ];
  const notes = [
    ...(reports.some((r) => r.truncated) ? [messages.registry.scan.truncated] : []),
    ...(reports.some((r) => r.recovered) ? [messages.registry.scan.recovered] : []),
  ];
  return [parts.join(', ').concat('.'), ...notes].join(' ');
}

/** The words for a refusal of the registry, with the next action; a code the page does not know gets the general ones. */
export function refusalWords(code: string): { readonly message: string; readonly next: string } {
  return messages.registry.refusal[code] ?? messages.registry.refusalOther;
}
