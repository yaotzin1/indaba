import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * The per-user list of folders a person added, shared by `indaba workflows add` and the page of `indaba ui`
 * (specs/web-app-registry, C-01): one file, one writer.
 */

/** The per-user list of added folders, in the user's configuration folder, beside the confirmations of indaba ui. */
export const WORKFLOW_ROOTS_FILE = join('indaba', 'workflow-roots.json');

/** The folders a person added, from the per-user file; a file that is not a list of strings reads as empty. */
export async function readRoots(file: string): Promise<readonly string[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === 'string') : [];
}

/** Writes the per-user list of folders whole, through a temporary file. */
export async function writeRoots(file: string, roots: readonly string[], pid: number): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(roots, null, 2)}\n`, { flag: 'w' });
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export const isFolder = (path: string): Promise<boolean> =>
  stat(path).then(
    (info) => info.isDirectory(),
    () => false,
  );

/**
 * The folders `indaba ui` covers: the ones it was given, then the per-user list that still exists, each once. A listed
 * folder that is gone is left out and reported through `skipped`.
 */
export async function coveredRoots(
  given: readonly string[],
  file: string,
  skipped: (folder: string) => void = () => undefined,
): Promise<readonly string[]> {
  const roots = [...given];
  for (const folder of await readRoots(file)) {
    if (roots.includes(folder)) {
      continue;
    }
    if (await isFolder(folder)) {
      roots.push(folder);
    } else {
      skipped(folder);
    }
  }
  return roots;
}
