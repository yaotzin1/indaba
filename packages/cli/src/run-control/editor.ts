import type {
  EditorCatalog,
  EditorResponse,
  EditWorkflowRequest,
  JsonObject,
  JsonValue,
  WorkflowEdit,
  WorkflowEditResponse,
} from '@indaba/core';
import { WorkflowDocument, WorkflowDocumentError } from '@indaba/engine';
import type { UiWorkflowEditor } from '../server-loader.js';
import { type ProblemSources, problemsOf } from './problems.js';

/**
 * A refusal of the workflow editor. The server recognises it by `name` and `code`, as it does `WorkflowStoreError`,
 * because the command line does not import the optional `@indaba/server`.
 */
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

export interface WorkflowEditorOptions extends ProblemSources {
  /** `workflowJsonSchema()`, computed once; it must be JSON. */
  readonly schema: Readonly<Record<string, unknown>>;
  /** `catalogOf` over the bundle of `indaba ui`, computed once. */
  readonly catalog: EditorCatalog;
}

/** Whether a value is JSON, as the document's `get` guarantees; this tells the compiler, it does not trust anything. */
function isJson(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJson);
  }
  if (typeof value !== 'object') {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null) && Object.values(value).every(isJson);
}

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && isJson(value);

function apply(document: WorkflowDocument, edit: WorkflowEdit): void {
  const after = (id: string | undefined) => (id === undefined ? {} : { after: id });
  switch (edit.op) {
    case 'set':
      document.set(edit.path, edit.value);
      return;
    case 'remove':
      document.remove(edit.path);
      return;
    case 'addStep':
      document.addStep(edit.step, after(edit.after));
      return;
    case 'removeStep':
      document.removeStep(edit.id);
      return;
    case 'moveStep':
      document.moveStep(edit.id, after(edit.after));
      return;
  }
}

/**
 * Edits a draft for the form of `indaba ui` (specs/web-app-editing-forms): the text is read with `WorkflowDocument`, the
 * edits applied in order, and the result answered with its problems as the store's check gives them. It reads and
 * writes no file; saving is the store's.
 */
export function createWorkflowEditor(options: WorkflowEditorOptions): UiWorkflowEditor {
  if (!isJsonObject(options.schema)) {
    throw new TypeError('the workflow schema is not JSON');
  }
  const info: EditorResponse = { schema: options.schema, catalog: options.catalog };
  return {
    info: () => info,
    edit: (request: EditWorkflowRequest): WorkflowEditResponse => {
      let document: WorkflowDocument;
      try {
        document = WorkflowDocument.parse(request.text);
      } catch (error) {
        if (error instanceof WorkflowDocumentError) {
          throw new WorkflowEditorError('not_editable', error.message);
        }
        throw error;
      }
      for (const [index, edit] of request.edits.entries()) {
        try {
          apply(document, edit);
        } catch (error) {
          if (error instanceof WorkflowDocumentError) {
            throw new WorkflowEditorError('edit_refused', error.message, {
              index,
              ...(error.path === undefined ? {} : { path: error.path }),
            });
          }
          throw error;
        }
      }
      const text = request.edits.length === 0 ? request.text : document.toString();
      const value = document.get([]);
      return {
        text,
        value: isJsonObject(value) ? value : {},
        problems: problemsOf(options, text).problems,
      };
    },
  };
}
