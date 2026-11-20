import { WorkflowValidationError } from '@indaba/core';
import { parseAllDocuments } from 'yaml';

/** The options every read of a workflow uses, so `parse`, `diagnose` and `readInputDeclarations` see the same document. */
export const YAML_OPTIONS = { schema: 'core', uniqueKeys: true, strict: true, logLevel: 'silent' } as const;

/** Core schema, one document, unique keys; a warning (an unknown tag, say) is as fatal as an error. */
export function decodeWorkflow(source: string): unknown {
  const docs = parseAllDocuments(source, YAML_OPTIONS);
  const [doc, ...rest] = Array.from(docs);
  if (doc === undefined) {
    return undefined;
  }
  const problem = doc.errors[0] ?? doc.warnings[0];
  if (problem !== undefined) {
    throw new WorkflowValidationError([`invalid YAML: ${problem.message}`]);
  }
  if (rest.length > 0) {
    throw new WorkflowValidationError(['invalid YAML: a workflow file holds exactly one document']);
  }
  return doc.toJS({ mapAsMap: true });
}
