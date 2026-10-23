import { type WorkflowDefinition, type WorkflowProblem, WorkflowValidationError } from '@indaba/core';
import { type Problem, sanitize } from '@indaba/engine';

export interface ProblemSources {
  /** Parses a workflow as `indaba validate` does; throws `WorkflowValidationError` with its problems. */
  readonly parse: (source: string) => WorkflowDefinition;
  /** The same problems, each placed in the text (`WorkflowParser.diagnose`, specs/workflow-editor). */
  readonly diagnose: (source: string) => readonly Problem[];
}

/** A problem of `diagnose` as the page receives it: its sentence cleaned, its path and its place (AC-15 of step 3a). */
function problemOf(problem: Problem): WorkflowProblem {
  const message = sanitize(problem.message);
  const path = sanitize(problem.path);
  return problem.line === undefined || problem.column === undefined
    ? { message, path }
    : { message, path, line: problem.line, column: problem.column };
}

/**
 * What `indaba validate` would say of a text, for the store and the editor alike (specs/web-app-editing-forms, AC-04):
 * the errors of `parse`, placed by `diagnose`, and the workflow's name when it parses. The warnings of a valid file are
 * not problems here.
 */
export function problemsOf(
  sources: ProblemSources,
  text: string,
): { readonly problems: readonly WorkflowProblem[]; readonly name: string | undefined } {
  try {
    const workflow = sources.parse(text);
    return { problems: [], name: sanitize(workflow.name) };
  } catch (error) {
    if (error instanceof WorkflowValidationError) {
      const placed = sources.diagnose(text).filter((p) => p.severity === 'error');
      return { problems: placed.map(problemOf), name: undefined };
    }
    return {
      problems: [{ message: sanitize(error instanceof Error ? error.message : String(error)) }],
      name: undefined,
    };
  }
}
