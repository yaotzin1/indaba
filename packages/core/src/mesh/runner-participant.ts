import type { Runner, RunRequest, RunResult } from '../runner/index.js';
import type { McpServerDefinition } from '../workflow/model.js';
import type { Blackboard } from './blackboard.js';
import type { Participant } from './consensus.js';
import { AgentMessage, MessageType } from './message.js';

export interface RunnerParticipantOptions {
  readonly role: string;
  readonly runner: Runner;
  readonly workdir: string;
  readonly model?: string;
  /** Hook around the runner call, for tracing. */
  readonly invoke?: (runner: Runner, request: RunRequest) => Promise<RunResult>;
  /** Servers to ask the runner to provide. */
  readonly mcpServers?: readonly McpServerDefinition[];
  readonly signal?: AbortSignal;
}

/**
 * Adapts a runner into a debate participant by wrapping the topic and the transcript
 * so far in the message protocol.
 */
export class RunnerParticipant implements Participant {
  readonly role: string;

  constructor(private readonly options: RunnerParticipantOptions) {
    this.role = options.role;
  }

  async respond(topic: string, board: Blackboard, round: number): Promise<AgentMessage> {
    const { runner, workdir, model, invoke, mcpServers, signal } = this.options;
    const request: RunRequest = {
      prompt: this.prompt(topic, board, round),
      workdir,
      ...(model !== undefined ? { model } : {}),
      ...(mcpServers !== undefined ? { mcpServers } : {}),
    };
    const result = invoke === undefined ? await runner.run(request, signal) : await invoke(runner, request);

    if (!result.succeeded()) {
      return new AgentMessage(
        this.role,
        MessageType.Critique,
        `The runner failed and could not take part: ${result.failureText()}`,
        round,
      );
    }
    return AgentMessage.fromReply(this.role, result.output, round);
  }

  private prompt(topic: string, board: Blackboard, round: number): string {
    const transcript = board.transcript();
    return [
      `You are the "${this.role}" in a structured review (round ${round}). Decide on the topic below.`,
      `## Topic\n${topic}`,
      transcript === '' ? null : `## Discussion so far\n${transcript}`,
      '## Reply protocol\nBegin your reply with exactly one keyword followed by a colon: ' +
        'AGREEMENT (you approve as it stands), CRITIQUE (you require changes; list them), ' +
        'PROPOSAL (you suggest an alternative) or QUESTION. Only AGREEMENT counts as approval.',
    ]
      .filter((part): part is string => part !== null)
      .join('\n\n');
  }
}
