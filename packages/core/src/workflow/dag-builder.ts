import { WorkflowValidationError } from '../errors/index.js';
import type { StepDefinition, WorkflowDefinition } from './model.js';

/**
 * Topological ordering and reachability over `dependsOn`. Ordering is stable:
 * among ready steps the one declared first wins, so a plan is reproducible.
 */
export class DagBuilder {
  build(workflow: WorkflowDefinition): readonly StepDefinition[] {
    let remaining = [...workflow.steps];
    const emitted = new Set<string>();
    const ordered: StepDefinition[] = [];

    while (remaining.length > 0) {
      const index = remaining.findIndex((step) => step.dependsOn.every((id) => emitted.has(id)));
      const next = remaining[index];
      if (next === undefined) {
        throw new WorkflowValidationError([
          `Dependency cycle or unknown dependency among steps: ${remaining.map((s) => s.id).join(', ')}`,
        ]);
      }
      ordered.push(next);
      emitted.add(next.id);
      remaining = remaining.filter((_, i) => i !== index);
    }

    return ordered;
  }

  /** Ids of every step the given step transitively depends on. */
  ancestorsOf(workflow: WorkflowDefinition, stepId: string): readonly string[] {
    const byId = this.index(workflow);
    const seen = new Set<string>();
    const stack = [...(byId.get(stepId)?.dependsOn ?? [])];

    for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
      const step = byId.get(id);
      if (seen.has(id) || step === undefined) {
        continue;
      }
      seen.add(id);
      stack.push(...step.dependsOn);
    }

    return [...seen];
  }

  /** Ids of every step that transitively depends on the given step, in declaration order. */
  descendantsOf(workflow: WorkflowDefinition, stepId: string): readonly string[] {
    return workflow.steps.filter((s) => this.ancestorsOf(workflow, s.id).includes(stepId)).map((s) => s.id);
  }

  private index(workflow: WorkflowDefinition): Map<string, StepDefinition> {
    return new Map(workflow.steps.map((step) => [step.id, step]));
  }
}
