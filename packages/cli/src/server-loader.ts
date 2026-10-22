import type {
  Logger,
  LoggingSettings,
  LoggingSettingsResponse,
  SaveWorkflowSourceRequest,
  SaveWorkflowSourceResponse,
  SinkSettings,
  SinkTestResponse,
  StartRunRequest,
  StartRunResponse,
  StartStatusResponse,
  StopRunResponse,
  WorkflowCheckResponse,
  WorkflowListResponse,
  WorkflowSourceResponse,
} from '@indaba/core';

/** What the command line needs of `@indaba/server`. The package is optional, so its types are not imported. */
export interface UiServerOptions {
  readonly roots: readonly string[];
  readonly staticDir: string;
  readonly discussionDirectories?: readonly string[];
  readonly port?: number;
  /** The command's logger (specs/logging, AC-09); the contract is core's, which the command line already has. */
  readonly logger?: Logger;
  /** The logging settings of the project, for the page's Settings screen (specs/logging, AC-20). */
  readonly loggingSettings?: UiSettingsBackend;
  /** Starting and stopping runs from the page (specs/web-app-actions); the server's `RunControl`. */
  readonly runs?: UiRunControl;
  /** Reading, checking and saving a workflow's text from the page (specs/web-app-editing-core). */
  readonly workflowStore?: UiWorkflowStore;
}

/** The shape of `WorkflowStore` of `@indaba/server`. A refusal is an `Error` named `WorkflowStoreError` with a `code`. */
export interface UiWorkflowStore {
  read(id: string): Promise<WorkflowSourceResponse>;
  save(id: string, request: SaveWorkflowSourceRequest): Promise<SaveWorkflowSourceResponse>;
  check(text: string): WorkflowCheckResponse;
}

/**
 * What the command line gives the server to start and stop runs: the shape of `RunControl` of `@indaba/server`,
 * declared here because the package is optional. A refusal is an `Error` named `RunControlError` with a `code`.
 */
export interface UiRunControl {
  list(): Promise<WorkflowListResponse>;
  start(request: StartRunRequest): Promise<StartRunResponse>;
  startStatus(startId: string): StartStatusResponse | undefined;
  stop(runId: string): StopRunResponse | undefined;
  isAlive(runId: string): boolean;
  stopAll(): Promise<void>;
}

/** What the command line knows of a project's settings; the server adds their description. */
export type UiSettingsState = Omit<LoggingSettingsResponse, 'descriptions' | 'sinkDefaults'>;

export interface UiSettingsBackend {
  read(): Promise<UiSettingsState>;
  save(settings: LoggingSettings): Promise<UiSettingsState>;
  test(sink: SinkSettings): Promise<SinkTestResponse>;
}

export interface UiServerHandle {
  readonly url: string;
  readonly port: number;
  close(): Promise<void>;
}

export interface ServerModule {
  startServer(options: UiServerOptions): Promise<UiServerHandle>;
  /** The folder of the built page, or undefined when it has not been built. */
  defaultPageDirectory(): string | undefined;
}

export type ServerLoad = { readonly server: ServerModule } | { readonly missing: string };

const SERVER_PACKAGE = '@indaba/server';

/**
 * Loads the local server if it is installed. A package that is absent, or one that fails to load, is not a crash of the
 * command: `indaba ui` says why and ends.
 */
export async function loadServer(
  importer: (name: string) => Promise<unknown> = (name) => import(name),
): Promise<ServerLoad> {
  let loaded: unknown;
  try {
    loaded = await importer(SERVER_PACKAGE);
  } catch (error) {
    return { missing: error instanceof Error ? error.message : String(error) };
  }
  const candidate = loaded as { startServer?: unknown; defaultPageDirectory?: unknown };
  if (typeof candidate.startServer !== 'function' || typeof candidate.defaultPageDirectory !== 'function') {
    return { missing: `${SERVER_PACKAGE} does not export startServer and defaultPageDirectory` };
  }
  return { server: candidate as ServerModule };
}
