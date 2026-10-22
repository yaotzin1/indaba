import { lstat, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import {
  IndabaError,
  type LoggingSettings,
  loggingSettingsToConfig,
  type ResolvedLogging,
  resolveLoggingSettings,
} from '@indaba/core';
import { Document, isMap, isScalar, parseAllDocuments, parseDocument } from 'yaml';

/**
 * The project configuration: `indaba.config` in the project root, YAML (specs/logging, AC-13 and section 8, item 7).
 * This step introduces its `logging:` section and nothing else; a key the file may not hold yet is a problem that names
 * it, so a typo is never ignored. It is configuration the person writes, kept beside the workflow and committed with
 * it, so it never holds a secret: a credential is the NAME of a variable (`secretEnv`).
 */
export const PROJECT_CONFIG_FILE = 'indaba.config';

/** The top-level sections the file may hold. */
export const PROJECT_CONFIG_SECTIONS: readonly string[] = ['logging'];

export interface ProjectConfig {
  /** The file read, or would be written. */
  readonly path: string;
  /** False when the project has no `indaba.config`; everything is then its default. */
  readonly present: boolean;
  readonly logging: ResolvedLogging;
  /** Every problem of the file, each naming the key (`logging.sinks[1].address`). Empty when it is valid. */
  readonly problems: readonly string[];
}

const YAML_OPTIONS = { schema: 'core', uniqueKeys: true, strict: true, logLevel: 'silent' } as const;

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'ENOENT';
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** The path of the file, refused when it is a link that leaves the project. */
async function configPath(root: string): Promise<string> {
  const path = join(root, PROJECT_CONFIG_FILE);
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() && !isInside(await realpath(root), await realpath(path))) {
      throw new IndabaError(`${PROJECT_CONFIG_FILE} is a link that leaves the project.`);
    }
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }
  }
  return path;
}

function decode(source: string): { readonly value: unknown; readonly problem?: string } {
  const docs = Array.from(parseAllDocuments(source, YAML_OPTIONS));
  const [doc, ...rest] = docs;
  if (doc === undefined) {
    return { value: undefined };
  }
  const problem = doc.errors[0] ?? doc.warnings[0];
  if (problem !== undefined) {
    return { value: undefined, problem: `invalid YAML: ${problem.message}` };
  }
  if (rest.length > 0) {
    return { value: undefined, problem: 'invalid YAML: the file holds exactly one document' };
  }
  return { value: doc.toJS() };
}

/** A comment above a key that is about to go moves to the next key, or above the whole document. */
function keepCommentOf(doc: Document, key: string): void {
  if (!isMap(doc.contents)) {
    return;
  }
  const items = doc.contents.items;
  const at = items.findIndex((pair) => isScalar(pair.key) && pair.key.value === key);
  const pair = items[at];
  const comment = pair !== undefined && isScalar(pair.key) ? pair.key.commentBefore : undefined;
  if (comment == null || comment === '') {
    return;
  }
  const next = items[at + 1];
  if (next !== undefined && isScalar(next.key)) {
    next.key.commentBefore =
      next.key.commentBefore == null ? comment : `${comment}\n${next.key.commentBefore}`;
  } else {
    doc.commentBefore = doc.commentBefore == null ? comment : `${doc.commentBefore}\n${comment}`;
  }
}

/** A document with no keys left: its comments, or nothing (never `{}`). */
function commentsOnly(doc: Document): string {
  const comment = doc.commentBefore;
  return comment == null || comment === ''
    ? ''
    : `${comment
        .split('\n')
        .map((line) => `#${line}`)
        .join('\n')}\n`;
}

/** The configuration of a project in text form, for a test or a UI that validates what a person typed. */
export function parseProjectConfig(source: string, path = PROJECT_CONFIG_FILE): ProjectConfig {
  const { value, problem } = decode(source);
  const problems: string[] = [];
  if (problem !== undefined) {
    return { path, present: true, logging: resolveLoggingSettings(undefined), problems: [problem] };
  }
  let section: unknown;
  if (value !== undefined && value !== null) {
    if (typeof value !== 'object' || Array.isArray(value)) {
      problems.push(
        `${PROJECT_CONFIG_FILE} must be a mapping of sections (${PROJECT_CONFIG_SECTIONS.join(', ')})`,
      );
    } else {
      for (const key of Object.keys(value)) {
        if (!PROJECT_CONFIG_SECTIONS.includes(key)) {
          problems.push(
            `${key} is not a section of ${PROJECT_CONFIG_FILE} (allowed: ${PROJECT_CONFIG_SECTIONS.join(', ')})`,
          );
        }
      }
      section = (value as Record<string, unknown>).logging;
    }
  }
  const logging = resolveLoggingSettings(section);
  problems.push(...logging.problems.map((p) => `logging.${p}`));
  return { path, present: true, logging, problems };
}

/** Reads `indaba.config` of `root`. A missing file is not a problem: everything takes its default. */
export async function readProjectConfig(root: string): Promise<ProjectConfig> {
  const path = await configPath(root);
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    if (isMissing(error)) {
      return { path, present: false, logging: resolveLoggingSettings(undefined), problems: [] };
    }
    throw new IndabaError(`${PROJECT_CONFIG_FILE} cannot be read.`, { cause: error });
  }
  return parseProjectConfig(source, path);
}

/**
 * Writes the `logging:` section of `indaba.config`, keeping the comments and every other key of the file (AC-20). The
 * settings are checked by the same `resolveLoggingSettings` a hand-edited file goes through, and what is written leaves
 * out every value equal to its default. A file that is not valid YAML is not overwritten. The new file replaces the old
 * one in one rename, so a reader never sees half of it.
 */
export async function writeLoggingConfig(root: string, settings: LoggingSettings): Promise<string> {
  const section = loggingSettingsToConfig(settings);
  const check = resolveLoggingSettings(section);
  if (check.problems.length > 0) {
    throw new IndabaError(`The logging settings are not valid: ${check.problems.join('; ')}`);
  }
  const path = await configPath(root);
  let source = '';
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    if (!isMissing(error)) {
      throw new IndabaError(`${PROJECT_CONFIG_FILE} cannot be read.`, { cause: error });
    }
  }
  const parsed = parseDocument(source, YAML_OPTIONS);
  if (parsed.errors.length > 0) {
    throw new IndabaError(`${PROJECT_CONFIG_FILE} is not valid YAML; fix it by hand before saving.`);
  }
  if (parsed.contents !== null && !isMap(parsed.contents)) {
    throw new IndabaError(
      `${PROJECT_CONFIG_FILE} must be a mapping of sections; fix it by hand before saving.`,
    );
  }
  // A file with nothing but comments has no mapping to add to; start one and keep the comments above it.
  const doc: Document = parsed.contents === null ? new Document({}) : parsed;
  if (doc !== parsed && parsed.commentBefore != null) {
    doc.commentBefore = parsed.commentBefore;
  }
  if (Object.keys(section).length === 0) {
    keepCommentOf(doc, 'logging');
    doc.delete('logging');
  } else {
    doc.set('logging', doc.createNode(section));
  }
  const text = isMap(doc.contents) && doc.contents.items.length === 0 ? commentsOnly(doc) : doc.toString();
  const temporary = join(dirname(path), `.${PROJECT_CONFIG_FILE}.${process.pid}.tmp`);
  try {
    await writeFile(temporary, text, 'utf8');
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw new IndabaError(`${PROJECT_CONFIG_FILE} cannot be written.`, { cause: error });
  }
  return path;
}
