import type {
  EditorResponse,
  EditWorkflowRequest,
  JsonObject,
  JsonValue,
  WorkflowEdit,
  WorkflowEditResponse,
  WorkflowPath,
} from '@indaba/core';

/**
 * What the command line supplies so the server applies no edit itself (specs/web-app-editing-forms, AC-13). Like
 * `WorkflowStore`: without it the editor resources answer 404 and the page shows only the source view.
 */
export interface WorkflowEditor {
  /** The schema and the catalog; the same answer for the life of the server. */
  info(): EditorResponse;
  /** Throws a {@link WorkflowEditorError}: `not_editable`, or `edit_refused` with detail `{ index, path? }`. */
  edit(request: EditWorkflowRequest): WorkflowEditResponse;
}

/** A refusal of a workflow editor, by a `code` the server maps to a status and plain words. */
export class WorkflowEditorError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'WorkflowEditorError';
  }
}

/** The most edits one request may carry. A starting value, not a measurement (spec C-07). */
export const MAX_EDITS = 64;
/** The most keys and indexes in one path. A starting value. */
export const MAX_PATH_PARTS = 16;
/** The longest key, step id or `after`, in characters. A starting value. */
export const MAX_KEY_LENGTH = 256;
/** How deep a value may nest; a scalar is depth 0. A starting value. */
export const MAX_VALUE_DEPTH = 16;

/** Why a body is not an edit request: a sentence that names the edit by its index and never repeats a value. */
export type EditRequestProblem = { readonly ok: false; readonly message: string };

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const field = (value: Readonly<Record<string, unknown>>, key: string): unknown =>
  Object.hasOwn(value, key) ? value[key] : undefined;

/** A key, a step id or an `after`: a non-empty string of bounded length. */
const isName = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_KEY_LENGTH;

function pathOf(value: unknown): WorkflowPath | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PATH_PARTS) {
    return undefined;
  }
  const parts: (string | number)[] = [];
  for (const part of value) {
    if (typeof part === 'number' && Number.isSafeInteger(part) && part >= 0) {
      parts.push(part);
    } else if (typeof part === 'string' && part.length <= MAX_KEY_LENGTH) {
      parts.push(part);
    } else {
      return undefined;
    }
  }
  return parts;
}

/**
 * A copy of a value parsed from JSON, or undefined when it nests deeper than {@link MAX_VALUE_DEPTH}. The copy is
 * built with plain objects that have no prototype key of their own, so nothing of the body reaches the editor but data.
 */
function jsonOf(value: unknown, depth: number): JsonValue | undefined {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (depth >= MAX_VALUE_DEPTH) {
    return undefined;
  }
  if (Array.isArray(value)) {
    const items: JsonValue[] = [];
    for (const item of value) {
      const copied = jsonOf(item, depth + 1);
      if (copied === undefined) {
        return undefined;
      }
      items.push(copied);
    }
    return items;
  }
  if (isRecord(value)) {
    return objectOf(value, depth);
  }
  return undefined;
}

function objectOf(value: Readonly<Record<string, unknown>>, depth: number): JsonObject | undefined {
  const copy: Record<string, JsonValue> = {};
  for (const key of Object.keys(value)) {
    const copied = jsonOf(value[key], depth + 1);
    if (copied === undefined) {
      return undefined;
    }
    // `defineProperty`, so a key named `__proto__` is an own key here and the editor refuses it by name.
    Object.defineProperty(copy, key, { value: copied, enumerable: true, writable: true, configurable: true });
  }
  return copy;
}

/** One edit of the body, copied with only its own fields, or undefined when it is not one of the five. */
function editOf(value: unknown): WorkflowEdit | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const op = field(value, 'op');
  const after = field(value, 'after');
  if (after !== undefined && !isName(after)) {
    return undefined;
  }
  const withAfter = after === undefined ? {} : { after };
  if (op === 'set' || op === 'remove') {
    const path = pathOf(field(value, 'path'));
    if (path === undefined) {
      return undefined;
    }
    if (op === 'remove') {
      return { op, path };
    }
    if (!Object.hasOwn(value, 'value')) {
      return undefined;
    }
    const copied = jsonOf(field(value, 'value'), 0);
    return copied === undefined ? undefined : { op, path, value: copied };
  }
  if (op === 'addStep') {
    const step = field(value, 'step');
    const copied = isRecord(step) ? objectOf(step, 0) : undefined;
    return copied === undefined ? undefined : { op, step: copied, ...withAfter };
  }
  if (op === 'removeStep' || op === 'moveStep') {
    const id = field(value, 'id');
    if (!isName(id)) {
      return undefined;
    }
    return op === 'removeStep' ? { op, id } : { op, id, ...withAfter };
  }
  return undefined;
}

/**
 * The edits of a request body, checked against the limits and copied into fresh objects (api-surface.md), or the reason
 * they are not. The text is checked by the caller, as the check's is.
 */
export function editsOf(
  body: unknown,
): { readonly ok: true; readonly edits: readonly WorkflowEdit[] } | EditRequestProblem {
  const edits = isRecord(body) ? field(body, 'edits') : undefined;
  if (!Array.isArray(edits)) {
    return { ok: false, message: 'The request carries no list of edits.' };
  }
  if (edits.length > MAX_EDITS) {
    return { ok: false, message: `The request carries more than ${MAX_EDITS} edits.` };
  }
  const copied: WorkflowEdit[] = [];
  for (const [index, edit] of edits.entries()) {
    const one = editOf(edit);
    if (one === undefined) {
      return { ok: false, message: `Edit ${index} is not an edit the page can make.` };
    }
    copied.push(one);
  }
  return { ok: true, edits: copied };
}
