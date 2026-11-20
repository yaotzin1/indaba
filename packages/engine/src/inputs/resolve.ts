import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative } from 'node:path';
import {
  canonicalInputs,
  checkBooleanValue,
  checkChoiceValue,
  checkNumberValue,
  checkTextValue,
  type InputCheck,
  type InputDefinition,
  type InputProblem,
  InputProblemCode,
  type InputValue,
  normalizeInputPath,
  type PathInput,
  quoteValue,
  type ResolvedInputs,
} from '@indaba/core';

/** Raw values as given: one array per input, with a single element for an input that is not a list (AC-12). */
export interface SuppliedInputs {
  readonly values: Readonly<Record<string, readonly string[]>>;
}

/** What `resolveInputs` asks of the file system; tests replace it (T-11). */
export interface InputFileSystem {
  realpath(path: string): Promise<string>;
  /** `undefined` when nothing is there. */
  stat(path: string): Promise<{ readonly isFile: boolean; readonly isDirectory: boolean } | undefined>;
  /** UTF-8; refuses a file longer than `maxCharacters` characters. */
  readText(path: string, maxCharacters: number): Promise<string>;
}

export interface ResolveInputsOptions {
  /** The run's working directory: a path value is relative to it and confined to it (AC-18). */
  readonly workDir: string;
  readonly fileSystem?: InputFileSystem;
  /** Names obtained by asking, recorded in `ResolvedInputs.asked`. */
  readonly asked?: readonly string[];
}

export type ResolveInputsResult =
  | { readonly ok: true; readonly inputs: ResolvedInputs }
  | {
      readonly ok: false;
      readonly problems: readonly InputProblem[];
      /** The inputs that have no value and no default, in declaration order: what a prompt or a form asks for. */
      readonly missing: readonly InputDefinition[];
    };

const codeOf = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;

/** The real file system. A file that is too long is refused by its size first, so it is never read whole. */
export const nodeInputFileSystem: InputFileSystem = {
  realpath: (path) => realpath(path),
  async stat(path) {
    try {
      const found = await stat(path);
      return { isFile: found.isFile(), isDirectory: found.isDirectory() };
    } catch (error) {
      if (codeOf(error) === 'ENOENT' || codeOf(error) === 'ENOTDIR') {
        return undefined;
      }
      throw error;
    }
  },
  async readText(path, maxCharacters) {
    const found = await stat(path);
    // A character is at most four bytes in UTF-8.
    if (found.size > maxCharacters * 4) {
      throw new RangeError(`the file is longer than ${maxCharacters} characters`);
    }
    const text = await readFile(path, { encoding: 'utf8' });
    if (Array.from(text).length > maxCharacters) {
      throw new RangeError(`the file is longer than ${maxCharacters} characters`);
    }
    return text;
  },
};

/** What a value of an input is called in a message, and what to write for it in `--input name=<...>`. */
function nouns(input: InputDefinition): {
  readonly one: string;
  readonly many: string;
  readonly hint: string;
} {
  if (input.type === 'path') {
    return input.kind === 'directory'
      ? { one: 'folder', many: 'folders', hint: '<folder>' }
      : input.kind === 'file'
        ? { one: 'file', many: 'files', hint: '<file>' }
        : { one: 'path', many: 'paths', hint: '<path>' };
  }
  return { one: 'value', many: 'values', hint: '<value>' };
}

function problem(input: string, code: InputProblem['code'], message: string): InputProblem {
  return { input, code, message };
}

function missingMessage(input: InputDefinition): string {
  const { hint } = nouns(input);
  const repeat = 'list' in input && input.list ? ' (repeat it for more than one)' : '';
  return `The workflow needs a value for "${input.name}": ${input.description}. Add --input ${input.name}=${hint}${repeat}, or run it in a terminal to be asked.`;
}

/** A default as the raw strings the checks take. */
function rawDefault(input: InputDefinition): readonly string[] | undefined {
  const value = input.default;
  if (value === undefined) {
    return undefined;
  }
  return Array.isArray(value) ? value : [String(value)];
}

/** A path that exists: where it really is must still lie inside the real working directory, and be the right kind. */
async function checkExisting(
  input: PathInput,
  stored: string,
  workDir: string,
  realRoot: string,
  fileSystem: InputFileSystem,
): Promise<InputProblem | undefined> {
  const shown = quoteValue(stored);
  const outside = problem(
    input.name,
    InputProblemCode.OutsideDirectory,
    `"${shown}" is outside the folder the workflow runs in. Choose a ${nouns(input).one} inside it.`,
  );
  const notThere = problem(
    input.name,
    InputProblemCode.NotFound,
    `"${shown}" does not exist. Check the spelling, or choose another ${nouns(input).one}.`,
  );
  const unreadable = problem(input.name, InputProblemCode.NotFound, `"${shown}" could not be looked at.`);
  let real: string;
  try {
    real = await fileSystem.realpath(join(workDir, stored));
  } catch (error) {
    if (codeOf(error) !== 'ENOENT' && codeOf(error) !== 'ENOTDIR') {
      return unreadable;
    }
    // Nothing is there yet. Where the nearest folder that is there really lies must still be inside, so a link in
    // the path cannot lead a new file out of the directory.
    const parts = stored.split('/');
    for (let keep = parts.length - 1; keep >= 0; keep -= 1) {
      const ancestor = keep === 0 ? workDir : join(workDir, ...parts.slice(0, keep));
      try {
        if (isOutside(realRoot, await fileSystem.realpath(ancestor))) {
          return outside;
        }
        break;
      } catch (ancestorError) {
        if (codeOf(ancestorError) !== 'ENOENT' && codeOf(ancestorError) !== 'ENOTDIR') {
          return unreadable;
        }
      }
    }
    if (input.mustExist) {
      return notThere;
    }
    return extensionProblem(input, stored, shown);
  }
  if (isOutside(realRoot, real)) {
    return outside;
  }
  let entry: Awaited<ReturnType<InputFileSystem['stat']>>;
  try {
    entry = await fileSystem.stat(real);
  } catch {
    return problem(input.name, InputProblemCode.NotFound, `"${shown}" could not be looked at.`);
  }
  if (entry === undefined) {
    return input.mustExist
      ? problem(
          input.name,
          InputProblemCode.NotFound,
          `"${shown}" does not exist. Check the spelling, or choose another ${nouns(input).one}.`,
        )
      : undefined;
  }
  if (input.kind === 'directory' && !entry.isDirectory) {
    return problem(
      input.name,
      InputProblemCode.WrongKind,
      `"${shown}" is a file, but "${input.name}" takes folders.`,
    );
  }
  if (input.kind === 'file' && !entry.isFile) {
    return problem(
      input.name,
      InputProblemCode.WrongKind,
      `"${shown}" is a folder, but "${input.name}" takes files.`,
    );
  }
  return extensionProblem(input, real, shown);
}

/** Whether a real location is outside the real working directory (the comparison ignores case where the system does). */
function isOutside(realRoot: string, real: string): boolean {
  const from = relative(realRoot, real);
  return from === '..' || from.startsWith('..\\') || from.startsWith('../') || isAbsolute(from);
}

/** The file types of a `kind: file` input, checked on the name of the real entry or, when none exists yet, on the stored one. */
function extensionProblem(input: PathInput, name: string, shown: string): InputProblem | undefined {
  if (input.kind !== 'file' || input.extensions.length === 0) {
    return undefined;
  }
  const wanted = input.extensions.map((extension) => extension.toLowerCase());
  return wanted.includes(extname(name).toLowerCase())
    ? undefined
    : problem(
        input.name,
        InputProblemCode.WrongExtension,
        `"${shown}" is not one of the file types this input takes (${input.extensions.join(', ')}).`,
      );
}

/**
 * Checks every value, applies the defaults, confines every path, and reports every problem at once (AC-15, AC-18).
 * It never throws for a bad value; it throws only for a programming error (an empty `workDir`).
 */
export async function resolveInputs(
  declarations: Readonly<Record<string, InputDefinition>>,
  supplied: SuppliedInputs,
  options: ResolveInputsOptions,
): Promise<ResolveInputsResult> {
  if (options.workDir === '') {
    throw new Error('resolveInputs needs the working directory');
  }
  const fileSystem = options.fileSystem ?? nodeInputFileSystem;
  const problems: InputProblem[] = [];
  const missing: InputDefinition[] = [];
  const values: Record<string, InputValue> = {};

  for (const name of Object.keys(supplied.values)) {
    if (!Object.hasOwn(declarations, name)) {
      const known = Object.keys(declarations);
      problems.push(
        problem(
          name,
          InputProblemCode.Unknown,
          `This workflow has no input called "${quoteValue(name)}". ${
            known.length === 0 ? 'It takes no inputs.' : `It takes: ${known.join(', ')}.`
          }`,
        ),
      );
    }
  }

  let realRoot: string | undefined;
  const root = async (): Promise<string> => {
    realRoot ??= await fileSystem.realpath(options.workDir);
    return realRoot;
  };

  for (const input of Object.values(declarations)) {
    const given = Object.hasOwn(supplied.values, input.name) ? supplied.values[input.name] : undefined;
    const raws = given !== undefined && given.length > 0 ? given : rawDefault(input);
    if (raws === undefined) {
      missing.push(input);
      problems.push(problem(input.name, InputProblemCode.Missing, missingMessage(input)));
      continue;
    }
    const isList = 'list' in input && input.list;
    const { one, many } = nouns(input);
    if (!isList && raws.length > 1) {
      problems.push(
        problem(
          input.name,
          InputProblemCode.Duplicate,
          `"${input.name}" was given more than once, and it takes a single ${one}.`,
        ),
      );
      continue;
    }
    if (isList && raws.length > input.maxItems) {
      problems.push(
        problem(
          input.name,
          InputProblemCode.TooMany,
          `"${input.name}" takes at most ${input.maxItems} ${many}; ${raws.length} were given.`,
        ),
      );
      continue;
    }
    if (isList && raws.length < input.minItems) {
      problems.push(
        problem(
          input.name,
          InputProblemCode.TooFew,
          `"${input.name}" takes at least ${input.minItems} ${many}; ${raws.length} were given.`,
        ),
      );
      continue;
    }

    const checked: InputValue[] = [];
    let bad = false;
    for (const raw of raws) {
      const result = await checkOne(input, raw, options.workDir, root, fileSystem);
      if (!result.ok) {
        problems.push(result.problem);
        bad = true;
        break;
      }
      checked.push(result.value);
    }
    if (!bad) {
      values[input.name] = isList ? (checked as readonly string[]) : (checked[0] as InputValue);
    }
  }

  if (problems.length > 0) {
    return { ok: false, problems, missing };
  }
  const digest = createHash('sha256').update(canonicalInputs(declarations, values), 'utf8').digest('hex');
  const asked = (options.asked ?? []).filter((name) => Object.hasOwn(values, name));
  return { ok: true, inputs: { values, asked, digest } };
}

async function checkOne(
  input: InputDefinition,
  raw: string,
  workDir: string,
  root: () => Promise<string>,
  fileSystem: InputFileSystem,
): Promise<InputCheck<InputValue>> {
  switch (input.type) {
    case 'text':
      return checkTextValue(input, raw);
    case 'choice':
      return checkChoiceValue(input, raw);
    case 'number':
      return checkNumberValue(input, raw);
    case 'boolean':
      return checkBooleanValue(input, raw);
    case 'path': {
      const stored = normalizeInputPath(input, raw, workDir);
      if (!stored.ok) {
        return stored;
      }
      let realRoot: string;
      try {
        realRoot = await root();
      } catch {
        return {
          ok: false,
          problem: problem(
            input.name,
            InputProblemCode.NotFound,
            'The folder the workflow runs in could not be looked at.',
          ),
        };
      }
      const found = await checkExisting(input, stored.value, workDir, realRoot, fileSystem);
      return found === undefined ? stored : { ok: false, problem: found };
    }
  }
}
