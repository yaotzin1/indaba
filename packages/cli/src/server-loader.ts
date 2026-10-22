import type { Logger } from '@indaba/core';

/** What the command line needs of `@indaba/server`. The package is optional, so its types are not imported. */
export interface UiServerOptions {
  readonly roots: readonly string[];
  readonly staticDir: string;
  readonly discussionDirectories?: readonly string[];
  readonly port?: number;
  /** The command's logger (specs/logging, AC-09); the contract is core's, which the command line already has. */
  readonly logger?: Logger;
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
