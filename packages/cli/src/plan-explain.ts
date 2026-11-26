import type {
  ExplainedGap,
  ExplainedGuard,
  ExplainedSetting,
  ExplainedStep,
  Origin,
  PlanExplanation,
  SettingValue,
} from '@indaba/core';
import { printableText } from './printable.js';

/**
 * The two renderings of an explanation of a plan (specs/plan-explain, AC-09 and AC-10): text under each step's line of
 * `plan`, and a JSON document for a front end or CI. Both read the same value; neither computes a default.
 */

/** What an author controls reaches the terminal as one printable line: escape sequences, controls and line breaks are gone. */
export function oneLine(text: string): string {
  return printableText(text)
    .replace(/[\n\t]+/g, ' ')
    .trim();
}

function list(values: readonly string[], empty: string): string {
  return values.length === 0 ? empty : values.map(oneLine).join(', ');
}

function isUnknown(value: SettingValue): value is { readonly unknown: string } {
  return typeof value === 'object' && !Array.isArray(value) && 'unknown' in value;
}

function guardText(guard: ExplainedGuard): string {
  // a scope guard with no path lets the step change nothing; saying so is clearer than saying nothing
  const none = guard.type === 'diff_within_scope' ? ' nothing' : '';
  const paths = guard.paths.length === 0 ? none : ` ${list(guard.paths, '')}`;
  return `${oneLine(guard.type)}${paths} (${guard.source})`;
}

function valueText(setting: ExplainedSetting): string {
  const value = setting.value;
  if (typeof value === 'string') {
    return oneLine(value);
  }
  if (typeof value === 'number') {
    return setting.key === 'timeout_seconds' ? `${value}s` : String(value);
  }
  if (Array.isArray(value)) {
    switch (setting.key) {
      case 'runner':
        return (value as readonly string[]).map(oneLine).join(' -> ');
      case 'guards':
        return (value as readonly ExplainedGuard[]).map(guardText).join('; ');
      default:
        return list(value as readonly string[], 'nothing');
    }
  }
  if (isUnknown(value)) {
    return `unknown (${oneLine(value.unknown)})`;
  }
  if ('afterSeconds' in value) {
    return `after ${value.afterSeconds}s of silence, run again up to ${value.retries} times`;
  }
  if ('action' in value) {
    const target = value.target === undefined ? '' : ` ${oneLine(value.target)}`;
    const bound =
      value.action === 'retry_step'
        ? `, run again up to ${value.maxRetries} times; each retry is isolated and carries only the last failure`
        : '';
    return `${oneLine(value.action)}${target}${bound}`;
  }
  return '';
}

/** `<- file, line 6`, `<- role writer, line 3`, `<- fallback, claude-code`: where a value comes from, at the end of its line. */
export function originText(origin: Origin): string {
  const at = origin.line === undefined ? '' : `, line ${origin.line}`;
  switch (origin.kind) {
    case 'file':
      return `<- file${at}`;
    case 'role':
      return `<- role ${oneLine(origin.ref ?? '?')}${at}`;
    case 'workflow_defaults':
      return `<- workflow_defaults${at}`;
    case 'fallback':
      return `<- fallback, ${oneLine(origin.by ?? 'engine')}`;
    case 'preset':
      return `<- preset${origin.by === undefined ? '' : `, ${oneLine(origin.by)}`}`;
  }
}

/** A gap that is only information (a failure stops the run) is marked `i`, the others `!`; the word, not a colour, says which. */
function gapMark(gap: ExplainedGap): string {
  return gap.code === 'failure_stops_run' ? 'i' : '!';
}

function gapLines(gap: ExplainedGap): readonly string[] {
  const covered =
    gap.mitigatedBy.length === 0
      ? ''
      : ` Steps that run after it and may check it (Indaba does not judge whether they do): ${list(gap.mitigatedBy, '')}.`;
  return [`   ${gapMark(gap)} ${gap.code}: ${oneLine(gap.text)}${covered}`];
}

/** The block of one step: a line for each setting, the origin at its end, then a mark and a sentence for each gap (AC-09). */
export function explanationLines(step: ExplainedStep): readonly string[] {
  const settings = step.settings.map((s) => `   ${s.key}: ${valueText(s)}  ${originText(s.origin)}`);
  return [...settings, ...step.gaps.flatMap(gapLines)];
}

/** Every block, each under the step's id, for a person who wants the explanation without the rest of `plan`. */
export function renderExplanationText(explanation: PlanExplanation): string {
  return explanation.steps
    .flatMap((step) => [`${oneLine(step.id)} [${step.kind}]`, ...explanationLines(step)])
    .join('\n')
    .concat('\n');
}

export const EXPLAIN_SCHEMA = 'indaba.plan-explain';
export const EXPLAIN_VERSION = 1;

function originJson(origin: Origin): Record<string, unknown> {
  // a fixed order of keys, and only the ones that carry something
  return {
    kind: origin.kind,
    ...(origin.by === undefined ? {} : { by: origin.by }),
    ...(origin.ref === undefined ? {} : { ref: origin.ref }),
    ...(origin.line === undefined ? {} : { line: origin.line }),
    ...(origin.column === undefined ? {} : { column: origin.column }),
  };
}

/**
 * The JSON of an explanation (AC-10): `schema` and `version`, the workflow's name and the steps, keys in a fixed order, no
 * timestamp, no absolute path and no value of the environment. A reader ignores keys and `origin.kind` values it does not
 * know; adding a key is a minor change of this contract, renaming or removing one a major.
 */
export function renderExplanationJson(workflowName: string, explanation: PlanExplanation): string {
  const document = {
    schema: EXPLAIN_SCHEMA,
    version: EXPLAIN_VERSION,
    workflow: workflowName,
    steps: explanation.steps.map((step) => ({
      id: step.id,
      kind: step.kind,
      settings: step.settings.map((s) => ({ key: s.key, value: s.value, origin: originJson(s.origin) })),
      gaps: step.gaps.map((g) => ({ code: g.code, text: g.text, mitigatedBy: g.mitigatedBy })),
    })),
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}
