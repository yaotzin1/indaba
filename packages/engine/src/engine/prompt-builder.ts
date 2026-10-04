import type { StepDefinition } from '@indaba/core';

/**
 * Builds the prompt for an agent step. On a retry only the latest failure is injected, trimmed to
 * its tail: a full error history would pollute the context with already-fixed problems.
 */
export class PromptBuilder {
  static readonly FEEDBACK_LIMIT = 4000;

  build(step: StepDefinition, feedback?: string): string {
    const parts = [`# Role: ${step.role ?? 'agent'}`, `## Goal\n${step.goal}`];

    if (step.inputArtifacts.length > 0) {
      parts.push(`## Input artifacts (read these first)\n${this.bullets(step.inputArtifacts)}`);
    }
    if (step.outputs.length > 0) {
      parts.push(`## Required outputs (create these files)\n${this.bullets(step.outputs)}`);
    }
    if (feedback !== undefined && feedback.trim() !== '') {
      parts.push(
        `## The previous attempt failed verification\nFix exactly this failure:\n\n\`\`\`\n${this.tail(feedback)}\n\`\`\``,
      );
    }
    return parts.join('\n\n');
  }

  tail(text: string): string {
    const trimmed = text.trim();
    return trimmed.length <= PromptBuilder.FEEDBACK_LIMIT
      ? trimmed
      : `[...truncated...]\n${trimmed.slice(-PromptBuilder.FEEDBACK_LIMIT)}`;
  }

  private bullets(items: readonly string[]): string {
    return items.map((item) => `- ${item}`).join('\n');
  }
}
