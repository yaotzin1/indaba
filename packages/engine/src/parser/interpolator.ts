import { IndabaError, type InputDefinition, type ResolvedInputs } from '@indaba/core';

const REFERENCE = /\$\{\{\s*(artifacts|inputs)\.([A-Za-z0-9_-]+)\s*\}\}/g;
const WHOLE_INPUT = /^\s*\$\{\{\s*inputs\.([A-Za-z0-9_-]+)\s*\}\}\s*$/;

/** Where a reference sits, which decides what an input reference may be (specs/workflow-inputs, AC-07). */
export type InterpolationField = 'plain' | 'goal' | 'paths' | 'commands';

/** What the interpolator needs to expand `${{ inputs.<name> }}`. */
export interface InputsContext {
  readonly declarations: Readonly<Record<string, InputDefinition>>;
  /** The checked values; without them an input reference needs `placeholders`. */
  readonly resolved?: ResolvedInputs | undefined;
  /** Render every input reference as `<input: name>` (for `validate` and `plan`). Ignored when `resolved` is given. */
  readonly placeholders?: boolean | undefined;
}

/**
 * A problem with an input reference. Its text finishes the sentence that the caller starts with the place in the file
 * (`$.steps[0].goal refers to the input ...`), which is why it is not an `IndabaError` message of the older kind.
 */
export class InputReferenceError extends IndabaError {
  constructor(readonly tail: string) {
    super(tail);
    this.name = 'InputReferenceError';
  }
}

/** The label a text or path value gets in a goal; the value itself is in the prompt's Inputs section (AC-10). */
export const inputLabel = (name: string): string => `[input: ${name}]`;
/** What an unresolved input reference renders as, for `validate` and `plan` (AC-14). */
export const inputPlaceholder = (name: string): string => `<input: ${name}>`;

/** Resolves `${{ artifacts.name }}` and `${{ inputs.name }}` references. */
export class Interpolator {
  /** Every input a reference outside `commands` named, for the warning about an input nobody uses (AC-08). */
  readonly referenced = new Set<string>();
  private goalNames: string[] = [];

  constructor(
    private readonly artifacts: Readonly<Record<string, string>>,
    private readonly inputs?: InputsContext,
  ) {}

  /** Expands the references in one string. A list input has no single value: see {@link expand}. */
  interpolate(value: string, field: InterpolationField = 'plain'): string {
    return value.replace(REFERENCE, (_match, kind: string, name: string) =>
      kind === 'artifacts' ? this.artifact(name) : this.input(name, field),
    );
  }

  /** A goal's text, and the text and path inputs it refers to, in order of first reference. */
  interpolateGoal(value: string): { readonly text: string; readonly inputs: readonly string[] } {
    this.goalNames = [];
    const text = this.interpolate(value, 'goal');
    const inputs = this.goalNames;
    this.goalNames = [];
    return { text, inputs };
  }

  /**
   * One entry of `input_artifacts` or `outputs`: a path input that is the whole entry and is a list gives one entry for
   * each element, in order (AC-09); anything else is one entry.
   */
  expand(value: string): readonly string[] {
    const whole = value.match(WHOLE_INPUT);
    if (whole !== null) {
      const name = whole[1] ?? '';
      const found = this.declared(name);
      if (found.type === 'path' && found.list && this.valuesGiven()) {
        this.referenced.add(name);
        const values = this.inputs?.resolved?.values[name];
        if (!Array.isArray(values)) {
          throw this.needsValue(name);
        }
        return values;
      }
    }
    return [this.interpolate(value, 'paths')];
  }

  private artifact(name: string): string {
    const resolved = Object.hasOwn(this.artifacts, name) ? this.artifacts[name] : undefined;
    if (resolved === undefined) {
      throw new IndabaError(`unknown artifact "${name}"`);
    }
    return resolved;
  }

  private valuesGiven(): boolean {
    return this.inputs?.resolved !== undefined;
  }

  private declared(name: string): InputDefinition {
    const found =
      this.inputs !== undefined && Object.hasOwn(this.inputs.declarations, name)
        ? this.inputs.declarations[name]
        : undefined;
    if (found === undefined) {
      throw new InputReferenceError(`refers to the input "${name}", which is not declared under inputs.`);
    }
    return found;
  }

  private needsValue(name: string): InputReferenceError {
    return new InputReferenceError(
      `refers to the input "${name}", which needs a value. Give it with --input ${name}=<value>, or parse the file with placeholders to check it without one.`,
    );
  }

  private input(name: string, field: InterpolationField): string {
    const reference = `\${{ inputs.${name} }}`;
    if (field === 'commands') {
      throw new InputReferenceError(
        `uses ${reference}. Inputs cannot be used in commands, because a command is run by the system shell and a value could change what it does. Use it in goal, input_artifacts or outputs instead.`,
      );
    }
    if (field === 'plain') {
      this.declared(name);
      throw new InputReferenceError(
        `uses ${reference}. Inputs can only be used in goal, input_artifacts and outputs.`,
      );
    }
    const definition = this.declared(name);
    if (field === 'paths' && definition.type !== 'path') {
      throw new InputReferenceError(
        `uses ${reference}, which is a ${definition.type} input. input_artifacts and outputs take path inputs only.`,
      );
    }
    if (field === 'paths' && 'list' in definition && definition.list && this.inputs?.resolved !== undefined) {
      throw new InputReferenceError(
        `uses the list input "${name}" inside a longer value. A list input must be the whole entry.`,
      );
    }
    this.referenced.add(name);
    const usesLabel = definition.type === 'text' || definition.type === 'path';
    if (field === 'goal' && usesLabel && !this.goalNames.includes(name)) {
      this.goalNames.push(name);
    }
    const resolved = this.inputs?.resolved;
    if (resolved === undefined) {
      if (this.inputs?.placeholders === true) {
        return inputPlaceholder(name);
      }
      throw this.needsValue(name);
    }
    const value = Object.hasOwn(resolved.values, name) ? resolved.values[name] : undefined;
    if (value === undefined) {
      throw this.needsValue(name);
    }
    if (field === 'goal' && usesLabel) {
      return inputLabel(name);
    }
    if (typeof value === 'string') {
      return value;
    }
    return Array.isArray(value) ? value.join(', ') : String(value);
  }
}
