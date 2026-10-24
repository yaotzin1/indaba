import type { RunSummary } from './run.js';

/**
 * The registry's screens (specs/web-app-registry): the plain data of `WorkflowRegistry` that the page and the server share.
 * Declarations only. They repeat the registry's members instead of importing them, because this folder imports only itself.
 */

export type RegistryOriginView = 'scanned' | 'added' | 'created' | 'copied';

export type RegistryStateView =
  | { readonly state: 'valid' }
  | { readonly state: 'invalid'; readonly message: string }
  | { readonly state: 'missing'; readonly reason: string };

/** One workflow of the registry, hidden and missing ones included. No path of the machine: the root is named by `rootId`. */
export interface RegistryEntryView {
  /** The registry's id: 16 hexadecimal characters, matched exactly. */
  readonly id: string;
  /** The person's name, else the workflow's, else the file's. */
  readonly name: string;
  readonly project: string;
  readonly tags: readonly string[];
  readonly hidden: boolean;
  /** Relative to its root, forward slashes. */
  readonly path: string;
  /** {@link RegistryRootView.id}. */
  readonly rootId: string;
  readonly origin: RegistryOriginView;
  /** An entry id, for an entry that was copied. */
  readonly copiedFrom?: string;
  readonly validation: RegistryStateView;
  readonly lastRun?: RunSummary;
  /** True when Remove is offered: the entry is missing, or was added by path and no scan would list it. */
  readonly removable: boolean;
}

/** A folder the registry covers. */
export interface RegistryRootView {
  /** The first 16 hexadecimal characters of the SHA-256 of the resolved folder: an identifier, not a secret. */
  readonly id: string;
  /** The folder's name. */
  readonly name: string;
  /** The resolved folder, shown to the person whose machine it is. */
  readonly folder: string;
  readonly readable: boolean;
}

export interface RegistryListResponse {
  /** Sorted by root, then path. */
  readonly entries: readonly RegistryEntryView[];
  readonly roots: readonly RegistryRootView[];
  /** True when the last scan stopped at a limit, so the list may be incomplete. */
  readonly truncated: boolean;
}

export interface RegistryScanReportView {
  readonly rootId: string;
  readonly found: number;
  readonly added: number;
  readonly changed: number;
  readonly moved: number;
  readonly missing: number;
  readonly invalid: number;
  readonly truncated: boolean;
  readonly recovered: boolean;
}

export interface RegistryScanResponse {
  readonly reports: readonly RegistryScanReportView[];
}

/** `null` clears the person's value so the default shows again; an absent member is left as it is. */
export interface RegistryAnnotateRequest {
  readonly name?: string | null;
  readonly project?: string | null;
  readonly tags?: readonly string[];
  readonly hidden?: boolean;
}

export interface RegistryCopyRequest {
  /** {@link RegistryRootView.id}: the folder to copy into. The page never sends a path. */
  readonly rootId: string;
  /** A file name without folders or extension. */
  readonly name?: string;
}

export interface RegistryCopyResponse {
  readonly entry: RegistryEntryView;
  /** Places of the copied file a person will usually change, one line each. */
  readonly toReview: readonly string[];
}

/** Step one of an import: what a typed path resolves to. Writes nothing. */
export interface RegistryResolveRootRequest {
  readonly path: string;
}

export interface RegistryResolveRootResponse {
  /** The resolved folder, shown back to the person. */
  readonly folder: string;
  readonly name: string;
  readonly alreadyCovered: boolean;
  /** Workflow files a bounded scan lists in it. */
  readonly found: number;
  /** True when a limit stopped the count, so there may be more. */
  readonly atLeast: boolean;
}

/** Step two: the person confirmed `folder` as shown. The server resolves it again and refuses a different result. */
export interface RegistryAddRootRequest {
  readonly folder: string;
}

export interface RegistryAddRootResponse {
  readonly root: RegistryRootView;
  readonly alreadyCovered: boolean;
  readonly report: RegistryScanReportView;
}
