import type { AgentMessage } from './message.js';

/** Shared, append-only message space (blackboard pattern) plus a small fact store. */
export class Blackboard {
  private readonly log: AgentMessage[] = [];
  private readonly facts = new Map<string, string>();

  post(message: AgentMessage): void {
    this.log.push(message);
  }

  messages(): readonly AgentMessage[] {
    return this.log;
  }

  latestBy(sender: string): AgentMessage | undefined {
    return this.log.findLast((m) => m.sender === sender);
  }

  setFact(key: string, value: string): void {
    this.facts.set(key, value);
  }

  fact(key: string): string | undefined {
    return this.facts.get(key);
  }

  transcript(): string {
    return this.log.map((m) => `[round ${m.round}] ${m.sender} (${m.type}):\n${m.content}`).join('\n\n');
  }
}
