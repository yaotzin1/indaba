import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IndabaError, type Plugin } from '@indaba/core';

function looksLikePath(specifier: string): boolean {
  return specifier.startsWith('.') || isAbsolute(specifier);
}

function isPlugin(value: unknown): value is Plugin {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { name?: unknown; register?: unknown };
  return (
    typeof candidate.name === 'string' && candidate.name !== '' && typeof candidate.register === 'function'
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Loads a plugin module: a relative or absolute file path (resolved against `cwd`) or a bare package
 * name. The module must default-export a `Plugin`.
 */
export async function loadPlugin(specifier: string, cwd: string): Promise<Plugin> {
  const target = looksLikePath(specifier) ? pathToFileURL(resolve(cwd, specifier)).href : specifier;
  let loaded: unknown;
  try {
    loaded = await import(target);
  } catch (error) {
    throw new IndabaError(`Cannot load plugin "${specifier}": ${describe(error)}`, { cause: error });
  }
  const exported =
    typeof loaded === 'object' && loaded !== null ? (loaded as { default?: unknown }).default : undefined;
  if (!isPlugin(exported)) {
    throw new IndabaError(
      `Plugin "${specifier}" must default-export an object with a "name" string and a "register" function.`,
    );
  }
  return exported;
}
