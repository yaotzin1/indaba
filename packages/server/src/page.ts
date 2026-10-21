import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where the built page is, or undefined when it has not been built. A published package carries it in its own `page`
 * folder (task T-10 of specs/web-app puts it there); in a checkout it is the build of the sibling package `web`. The
 * command that starts the server asks, so the server itself still receives its `staticDir` as an option.
 */
export function defaultPageDirectory(
  here: string = fileURLToPath(new URL('..', import.meta.url)),
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  return [join(here, 'page'), join(here, '..', 'web', 'dist')].find((dir) => exists(join(dir, 'index.html')));
}
