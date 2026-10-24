import type {
  ApiError,
  RegistryAddRootRequest,
  RegistryAddRootResponse,
  RegistryAnnotateRequest,
  RegistryCopyRequest,
  RegistryCopyResponse,
  RegistryEntryView,
  RegistryListResponse,
  RegistryResolveRootRequest,
  RegistryResolveRootResponse,
  RegistryScanResponse,
} from '@indaba/core';

/**
 * What the command line supplies so the server lists, annotates, copies and removes registry entries without reading or
 * writing a file itself (specs/web-app-registry, AC-10). Like {@link RunControl}: without it the registry resources answer
 * 404.
 */
export interface RegistryControl {
  /** The entries of every covered folder, hidden and missing ones included; scans when the last scan is old. */
  list(): Promise<RegistryListResponse>;
  /** Scans every folder now. */
  scan(): Promise<RegistryScanResponse>;
  /** Rejects with a {@link RegistryControlError}: `not_found`. */
  annotate(id: string, request: RegistryAnnotateRequest): Promise<RegistryEntryView>;
  /** Rejects with `not_found`, `exists`, `outside_roots`. */
  copy(id: string, request: RegistryCopyRequest): Promise<RegistryCopyResponse>;
  /** Rejects with `not_found`, `would_return`. Never deletes the file. */
  remove(id: string): Promise<void>;
  /** What a typed path resolves to; writes nothing. Rejects with `not_a_folder`. */
  resolveRoot(request: RegistryResolveRootRequest): Promise<RegistryResolveRootResponse>;
  /** Adds the folder the person confirmed. Rejects with `not_a_folder`, `store_failed`. */
  addRoot(request: RegistryAddRootRequest): Promise<RegistryAddRootResponse>;
}

export type RegistryControlErrorCode =
  | 'not_found'
  | 'outside_roots'
  | 'exists'
  | 'would_return'
  | 'not_a_workflow'
  | 'store_failed'
  | 'not_a_folder';

/** A refusal of the control, by a `code` the server maps to a status and plain words. */
export class RegistryControlError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'RegistryControlError';
  }
}

/** The longest name or project a person may give an entry. A starting value, not a measurement. */
export const MAX_NAME_LENGTH = 120;
/** The most tags an entry may carry. A starting value. */
export const MAX_TAGS = 20;
/** The longest tag. A starting value. */
export const MAX_TAG_LENGTH = 40;
/** The longest typed folder path. A starting value. */
export const MAX_FOLDER_LENGTH = 1024;
/** A registry or root id as the registry hands it out. */
export const REGISTRY_ID = /^[0-9a-f]{16}$/;
/** The name of a copied file: no folders, no extension. */
export const COPY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

/** Whether the text holds a control character, which a name, a tag or a path never carries. */
const hasControl = (text: string): boolean => {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      return true;
    }
  }
  return false;
};

export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const bad = (message: string): { readonly ok: false; readonly message: string } => ({ ok: false, message });

const isRecord = (body: unknown): body is Readonly<Record<string, unknown>> =>
  typeof body === 'object' && body !== null && !Array.isArray(body);

/** A name or a project: text, trimmed, not empty, not too long, without control characters. */
function textOf(value: unknown, label: string): Parsed<string> {
  if (typeof value !== 'string') {
    return bad(`${label} must be text, or null to use the default.`);
  }
  const text = value.trim();
  if (text === '') {
    return bad(`${label} cannot be empty; clear it to use the default.`);
  }
  if (text.length > MAX_NAME_LENGTH) {
    return bad(`${label} is longer than ${MAX_NAME_LENGTH} characters.`);
  }
  if (hasControl(text)) {
    return bad(`${label} has a character that cannot be shown.`);
  }
  return { ok: true, value: text };
}

/** The annotate request of a body. Only the four members are read; the rest is ignored. */
export function parseAnnotate(body: unknown): Parsed<RegistryAnnotateRequest> {
  if (!isRecord(body)) {
    return bad('The request is not a set of changes.');
  }
  const request: {
    name?: string | null;
    project?: string | null;
    tags?: readonly string[];
    hidden?: boolean;
  } = {};
  for (const key of ['name', 'project'] as const) {
    const value = body[key];
    if (value === undefined) {
      continue;
    }
    if (value === null) {
      request[key] = null;
      continue;
    }
    const text = textOf(value, key === 'name' ? 'The name' : 'The project');
    if (!text.ok) {
      return text;
    }
    request[key] = text.value;
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.length > MAX_TAGS) {
      return bad(`The tags must be a list of at most ${MAX_TAGS}.`);
    }
    const tags: string[] = [];
    for (const raw of body.tags as readonly unknown[]) {
      if (typeof raw !== 'string') {
        return bad('A tag must be text.');
      }
      const tag = raw.trim();
      if (tag === '' || tag.length > MAX_TAG_LENGTH || hasControl(tag)) {
        return bad(`A tag must be 1 to ${MAX_TAG_LENGTH} characters of plain text.`);
      }
      if (!tags.includes(tag)) {
        tags.push(tag);
      }
    }
    request.tags = tags;
  }
  if (body.hidden !== undefined) {
    if (typeof body.hidden !== 'boolean') {
      return bad('hidden must be true or false.');
    }
    request.hidden = body.hidden;
  }
  if (Object.keys(request).length === 0) {
    return bad('Say what to change: the name, the project, the tags or hidden.');
  }
  return { ok: true, value: request };
}

/** The copy request of a body: a folder id and an optional file name. */
export function parseCopy(body: unknown): Parsed<RegistryCopyRequest> {
  if (!isRecord(body)) {
    return bad('The request does not name a folder.');
  }
  const rootId = body.rootId;
  if (typeof rootId !== 'string' || !REGISTRY_ID.test(rootId)) {
    return bad('The request does not name a folder of the list.');
  }
  const name = body.name;
  if (name === undefined) {
    return { ok: true, value: { rootId } };
  }
  if (typeof name !== 'string' || !COPY_NAME.test(name)) {
    return bad('The file name may use letters, digits, dots, dashes and underscores, up to 80 characters.');
  }
  return { ok: true, value: { rootId, name } };
}

/** A typed or confirmed folder: text, not empty, bounded, no control characters. */
function folderOf(value: unknown): Parsed<string> {
  if (typeof value !== 'string' || value.trim() === '') {
    return bad('The request does not name a folder.');
  }
  if (value.length > MAX_FOLDER_LENGTH) {
    return bad(`The folder path is longer than ${MAX_FOLDER_LENGTH} characters.`);
  }
  if (hasControl(value)) {
    return bad('The folder path has a character that cannot be used.');
  }
  return { ok: true, value };
}

export function parseResolveRoot(body: unknown): Parsed<RegistryResolveRootRequest> {
  const folder = folderOf(isRecord(body) ? body.path : undefined);
  return folder.ok ? { ok: true, value: { path: folder.value } } : folder;
}

export function parseAddRoot(body: unknown): Parsed<RegistryAddRootRequest> {
  const folder = folderOf(isRecord(body) ? body.folder : undefined);
  return folder.ok ? { ok: true, value: { folder: folder.value } } : folder;
}

/** The status and plain words of each refusal the control may give; undefined for a code it should not give. */
export function registryRefusal(code: string): { status: number; error: ApiError } | undefined {
  switch (code) {
    case 'not_found':
      return {
        status: 404,
        error: {
          code,
          message: 'This workflow is no longer in the list.',
          nextAction: 'Open the list again.',
        },
      };
    case 'outside_roots':
      return {
        status: 422,
        error: {
          code,
          message: 'That folder is not one of the places Indaba looks in.',
          nextAction: 'Pick a folder from the list, or import it first.',
        },
      };
    case 'exists':
      return {
        status: 409,
        error: {
          code,
          message: 'A workflow with this file name is already in that folder. Nothing was copied.',
          nextAction: 'Give the copy another name.',
        },
      };
    case 'would_return':
      return {
        status: 409,
        error: {
          code,
          message: 'Indaba would list this file again at the next scan, so removing it would not last.',
          nextAction: 'Hide it instead.',
        },
      };
    case 'not_a_workflow':
      return {
        status: 422,
        error: { code, message: 'That is not a workflow file Indaba can list.' },
      };
    case 'not_a_folder':
      return {
        status: 422,
        error: {
          code,
          message: 'That is not a folder Indaba can read.',
          nextAction: 'Check the path, then try again.',
        },
      };
    case 'store_failed':
      return {
        status: 500,
        error: {
          code,
          message: 'The list could not be saved.',
          nextAction: 'Check that the folder is writable, then try again.',
        },
      };
    default:
      return undefined;
  }
}
