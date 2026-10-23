import { IndabaError } from '../errors/index.js';
import type { RunSummary } from '../web-contract/index.js';

/**
 * The workflow registry (specs/workflow-registry): the list of a person's workflow files, with what is known of each.
 * The file stays the definition; an entry only points at it. Pure: the store that reads and writes is elsewhere.
 */

/** How an entry came to be listed. */
export type RegistryOrigin = 'scanned' | 'added' | 'created' | 'copied';

export type RegistryValidation =
  | { readonly state: 'valid' }
  /** The first problem, one line, cleaned. */
  | { readonly state: 'invalid'; readonly message: string }
  /** Plain words, such as "the file is gone". */
  | { readonly state: 'missing'; readonly reason: string };

export interface RegistryEntry {
  /** Sixteen hexadecimal characters, kept for the life of the entry. */
  readonly id: string;
  /** The root, as the registry was given it. */
  readonly root: string;
  /** Relative to the root, `/` separators. */
  readonly path: string;
  /** The person's name for it, else the workflow's `name`, else the file's name. */
  readonly name: string;
  /** The person's project, else the root folder's name. */
  readonly project: string;
  readonly tags: readonly string[];
  readonly hidden: boolean;
  /** SHA-256 of the bytes last read, lowercase hex; empty when they were never read. */
  readonly hash: string;
  readonly validation: RegistryValidation;
  /** When the file was last read, ISO 8601. */
  readonly readAt: string;
  readonly origin: RegistryOrigin;
  /** For a copy: the id of the entry it was copied from. */
  readonly copiedFrom?: string;
  /** The newest run of this workflow in its root, when it can be told apart from others' (specs/workflow-registry, AC-12). */
  readonly lastRun?: RunSummary;
}

export interface RegistryScanReport {
  readonly root: string;
  readonly found: number;
  readonly added: number;
  readonly changed: number;
  readonly moved: number;
  readonly missing: number;
  readonly invalid: number;
  /** A limit of the scan stopped it, so a file may be missing from the list. */
  readonly truncated: boolean;
  /** The index could not be read; it was set aside as `index.json.bak` and the list started again. */
  readonly recovered: boolean;
}

/** The person's values. `null` clears one, so the default shows again; absent leaves it as it is. */
export interface RegistryAnnotation {
  readonly name?: string | null;
  readonly project?: string | null;
  readonly tags?: readonly string[];
  readonly hidden?: boolean;
}

export interface RegistryCopy {
  readonly entry: RegistryEntry;
  /** Places of the copy a person usually changes, one line each, such as `name: site`. */
  readonly toReview: readonly string[];
}

export type RegistryErrorCode =
  | 'not_found'
  | 'ambiguous'
  | 'outside_roots'
  | 'not_a_workflow'
  | 'exists'
  | 'would_return'
  | 'store_failed';

/** A refusal of a registry, by a code a caller can act on. */
export class RegistryError extends IndabaError {
  constructor(
    readonly code: RegistryErrorCode,
    message: string,
    /** For `ambiguous`: the ids that matched. */
    readonly candidates?: readonly string[],
  ) {
    super(message);
    this.name = 'RegistryError';
  }
}

/**
 * The registry's contract. `FileWorkflowRegistry` of `@indaba/engine` is the built-in store; a plugin may register
 * another through `PluginHost.registerRegistry`, with the same contract and nothing more.
 */
export interface WorkflowRegistry {
  /** The roots this registry covers, in order. */
  roots(): readonly string[];
  /** The entries of every root, from the store, without scanning. Sorted by root, then path. */
  list(options?: { readonly includeHidden?: boolean }): Promise<readonly RegistryEntry[]>;
  /** An entry by its id, or by the start of it when that names one entry; rejects with `ambiguous` otherwise. */
  get(idOrPrefix: string): Promise<RegistryEntry | undefined>;
  /** Looks at every root again and keeps the store current. Rejects with the signal's reason when aborted. */
  scan(options?: { readonly signal?: AbortSignal }): Promise<readonly RegistryScanReport[]>;
  /** Lists a file a scan would not find (another name). Idempotent. */
  add(file: string): Promise<RegistryEntry>;
  annotate(idOrPrefix: string, annotation: RegistryAnnotation): Promise<RegistryEntry>;
  /** Takes an entry out of the list; never deletes the file. */
  remove(idOrPrefix: string): Promise<void>;
  /** Copies the file into `folder`, never over an existing one. */
  copy(idOrPrefix: string, to: { readonly folder: string; readonly name?: string }): Promise<RegistryCopy>;
}
