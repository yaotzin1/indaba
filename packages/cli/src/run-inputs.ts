import { join } from 'node:path';
import {
  describeInputs,
  INPUT_LIMITS,
  type InputDefinition,
  type InputDescription,
  type InputProblem,
  type PathInput,
  quoteValue,
  type ResolvedInputs,
} from '@indaba/core';
import {
  type InputFileSystem,
  nodeInputFileSystem,
  resolveInputs,
  type SuppliedInputs,
} from '@indaba/engine';

/**
 * Asks a person for the values a run still lacks (specs/workflow-inputs, AC-16). `undefined` means the person closed it
 * without answering. The binary supplies one when stdin and stdout are terminals; tests replace it.
 */
export type AskInputs = (
  declarations: readonly InputDescription[],
  missing: readonly string[],
) => Promise<SuppliedInputs | undefined>;

export type Supplied =
  | { readonly ok: true; readonly supplied: SuppliedInputs }
  | { readonly ok: false; readonly message: string };

/** The refusal of more options than a command may carry (AC-12). */
export const tooManyOptions = (count: number): string =>
  `At most ${INPUT_LIMITS.options} --input options are allowed; ${count} were given.`;

/** `name=value` split at the first `=`: the value is everything after it (AC-12). */
function split(option: string, flag: string): { readonly name: string; readonly value: string } | string {
  const at = option.indexOf('=');
  if (at <= 0) {
    return `${flag} needs name=value, such as ${flag} topic=billing; "${quoteValue(option)}" does not have both.`;
  }
  return { name: option.slice(0, at), value: option.slice(at + 1) };
}

/**
 * The raw values the options carry: one array per input, repeated options making a list. `--input-file name=path` reads a
 * file inside the working directory as the value of a `text` input (AC-13). Nothing is checked against the declarations
 * here except what the options themselves can get wrong; `resolveInputs` checks the values.
 */
export async function suppliedFromOptions(
  input: readonly string[],
  inputFile: readonly string[],
  declarations: Readonly<Record<string, InputDefinition>>,
  workDir: string,
  fileSystem: InputFileSystem = nodeInputFileSystem,
): Promise<Supplied> {
  if (input.length + inputFile.length > INPUT_LIMITS.options) {
    return { ok: false, message: tooManyOptions(input.length + inputFile.length) };
  }
  // A Map, not an object: a name such as `constructor` or `__proto__` is a name like any other (and is refused later as not declared).
  const values = new Map<string, string[]>();
  for (const option of input) {
    const parts = split(option, '--input');
    if (typeof parts === 'string') {
      return { ok: false, message: parts };
    }
    const given = values.get(parts.name) ?? [];
    given.push(parts.value);
    values.set(parts.name, given);
  }
  const fromFile = new Set<string>();
  for (const option of inputFile) {
    const parts = split(option, '--input-file');
    if (typeof parts === 'string') {
      return { ok: false, message: parts };
    }
    if (values.has(parts.name) || fromFile.has(parts.name)) {
      return {
        ok: false,
        message: `"${quoteValue(parts.name)}" was given more than once through --input and --input-file; use one of them, once.`,
      };
    }
    fromFile.add(parts.name);
    const declared = Object.hasOwn(declarations, parts.name) ? declarations[parts.name] : undefined;
    if (declared === undefined) {
      // Left for resolveInputs, which names the input and lists the ones the workflow takes.
      values.set(parts.name, []);
      continue;
    }
    if (declared.type !== 'text') {
      return {
        ok: false,
        message: `--input-file is for a text input; "${declared.name}" is a ${declared.type} input. Give it with --input ${declared.name}=<value>.`,
      };
    }
    const read = await readInputFile(declared.name, parts.value, declared.maxLength, workDir, fileSystem);
    if (typeof read !== 'string') {
      return { ok: false, message: read.message };
    }
    values.set(parts.name, [read]);
  }
  return { ok: true, supplied: { values: Object.fromEntries(values) } };
}

async function readInputFile(
  name: string,
  path: string,
  maxLength: number,
  workDir: string,
  fileSystem: InputFileSystem,
): Promise<string | { readonly message: string }> {
  // The path obeys the confinement of every path input: inside the working directory, through links, and a real file.
  const probe: PathInput = {
    type: 'path',
    name,
    description: 'the file',
    list: false,
    minItems: 1,
    maxItems: 1,
    kind: 'file',
    mustExist: true,
    extensions: [],
  };
  const checked = await resolveInputs(
    { [name]: probe },
    { values: { [name]: [path] } },
    { workDir, fileSystem },
  );
  if (!checked.ok) {
    return { message: `--input-file ${name}: ${checked.problems[0]?.message ?? 'the file cannot be used.'}` };
  }
  const stored = checked.inputs.values[name];
  try {
    return await fileSystem.readText(join(workDir, typeof stored === 'string' ? stored : path), maxLength);
  } catch (error) {
    return {
      message:
        error instanceof RangeError
          ? `--input-file ${name}: the file is longer than the ${maxLength} characters "${name}" may have.`
          : `--input-file ${name}: "${quoteValue(path)}" could not be read.`,
    };
  }
}

export type Gathered =
  | {
      readonly ok: true;
      /** `undefined` when the workflow declares no inputs. */
      readonly inputs: ResolvedInputs | undefined;
      /** The raw values, the ones asked for included, as the options would carry them. */
      readonly supplied: SuppliedInputs;
      readonly asked: readonly string[];
    }
  | { readonly ok: false; readonly code: number; readonly message: string };

const MESSAGE_HEAD = 'The workflow did not start:';
/** How many times one input is asked for again after an answer that is refused. */
const ATTEMPTS = 3;

const list = (problems: readonly InputProblem[]): string =>
  `${MESSAGE_HEAD}\n${problems.map((p) => ` - ${p.message}`).join('\n')}\n`;

/**
 * Resolves the inputs of a run before anything exists: values from the options, a default, or the person's answer
 * (AC-15, AC-16). A problem with any input ends with exit code 2 and one message that lists every problem; a person who
 * closes the question ends with 130. With nothing that can ask, a missing input is a problem with a line to copy.
 */
export async function gatherInputs(input: {
  readonly declarations: Readonly<Record<string, InputDefinition>>;
  readonly supplied: SuppliedInputs;
  readonly workDir: string;
  readonly ask?: AskInputs | undefined;
  readonly fileSystem?: InputFileSystem | undefined;
}): Promise<Gathered> {
  const { declarations, workDir, ask } = input;
  if (Object.keys(declarations).length === 0 && Object.keys(input.supplied.values).length === 0) {
    return { ok: true, inputs: undefined, supplied: input.supplied, asked: [] };
  }
  const values: Record<string, readonly string[]> = { ...input.supplied.values };
  const askedNames: string[] = [];
  const tries = new Map<string, number>();
  const fileSystem = input.fileSystem === undefined ? {} : { fileSystem: input.fileSystem };
  for (;;) {
    const result = await resolveInputs(
      declarations,
      { values },
      { workDir, asked: askedNames, ...fileSystem },
    );
    if (result.ok) {
      return { ok: true, inputs: result.inputs, supplied: { values }, asked: askedNames };
    }
    // What can be asked again: an input that has no value, and one whose answer was refused.
    const askable = result.problems
      .filter(
        (p) => (tries.get(p.input) ?? 0) < ATTEMPTS && (p.code === 'missing' || askedNames.includes(p.input)),
      )
      .map((p) => p.input)
      .filter((name, index, all) => all.indexOf(name) === index);
    const unaskable = result.problems.filter((p) => !askable.includes(p.input));
    if (ask === undefined || askable.length === 0 || unaskable.length > 0) {
      return { ok: false, code: 2, message: list(result.problems) };
    }
    const answer = await ask(describeInputs(declarations), askable);
    if (answer === undefined) {
      return { ok: false, code: 130, message: 'No answer was given, so the workflow did not start.\n' };
    }
    for (const name of askable) {
      tries.set(name, (tries.get(name) ?? 0) + 1);
      const given = Object.hasOwn(answer.values, name) ? answer.values[name] : undefined;
      if (given === undefined || given.length === 0) {
        delete values[name];
      } else {
        values[name] = given;
        if (!askedNames.includes(name)) {
          askedNames.push(name);
        }
      }
    }
  }
}

/** What `plan` and `validate` make of the options: the values are checked as a run would, a missing one is not a problem (C-16). */
export async function checkInputs(input: {
  readonly declarations: Readonly<Record<string, InputDefinition>>;
  readonly supplied: SuppliedInputs;
  readonly workDir: string;
}): Promise<
  | { readonly ok: true; readonly inputs: ResolvedInputs | undefined; readonly missing: readonly string[] }
  | { readonly ok: false; readonly message: string }
> {
  const result = await resolveInputs(input.declarations, input.supplied, { workDir: input.workDir });
  if (result.ok) {
    return { ok: true, inputs: result.inputs, missing: [] };
  }
  const real = result.problems.filter((problem) => problem.code !== 'missing');
  if (real.length > 0) {
    return { ok: false, message: `${list(real).replace(MESSAGE_HEAD, 'The inputs given cannot be used:')}` };
  }
  return { ok: true, inputs: undefined, missing: result.missing.map((definition) => definition.name) };
}

/** The Inputs block of `plan`: name, type, and whether a value or a default is set, or the input is still missing (AC-14). */
export function inputLines(
  declarations: Readonly<Record<string, InputDefinition>>,
  supplied: SuppliedInputs,
): readonly string[] {
  const entries = Object.values(declarations);
  if (entries.length === 0) {
    return [];
  }
  const lines = ['Inputs:'];
  for (const definition of entries) {
    const given =
      Object.hasOwn(supplied.values, definition.name) && (supplied.values[definition.name]?.length ?? 0) > 0;
    const kind = 'list' in definition && definition.list ? `${definition.type} list` : definition.type;
    const state = given
      ? 'set'
      : definition.default !== undefined
        ? 'default'
        : `missing (add --input ${definition.name}=<value>)`;
    lines.push(`  ${definition.name} (${kind}): ${state}`);
  }
  return lines;
}
