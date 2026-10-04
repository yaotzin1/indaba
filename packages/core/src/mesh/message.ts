export const MessageType = {
  Proposal: 'PROPOSAL',
  Critique: 'CRITIQUE',
  Agreement: 'AGREEMENT',
  Question: 'QUESTION',
  ToolIntent: 'TOOL_INTENT',
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

const REPLY_TAG = /^\s*[[(*#]*\s*(PROPOSAL|CRITIQUE|AGREEMENT|QUESTION|TOOL_INTENT)\b[\])*]*\s*[:\-–—]?\s*/i;

function isMessageType(value: string): value is MessageType {
  return Object.values<string>(MessageType).includes(value);
}

/** Immutable envelope exchanged between agents on the blackboard. */
export class AgentMessage {
  constructor(
    readonly sender: string,
    readonly type: MessageType,
    readonly content: string,
    readonly round: number,
  ) {}

  /**
   * Parses an agent reply. A reply starting with a type keyword ("AGREEMENT: ...",
   * "[CRITIQUE] ...") carries that type; anything else is treated as a PROPOSAL, which
   * can never count as approval.
   */
  static fromReply(sender: string, reply: string, round: number): AgentMessage {
    const text = reply.trim();
    const match = REPLY_TAG.exec(text);
    const keyword = match?.[1]?.toUpperCase();
    if (match !== null && keyword !== undefined && isMessageType(keyword)) {
      return new AgentMessage(sender, keyword, text.slice(match[0].length).trim(), round);
    }
    return new AgentMessage(sender, MessageType.Proposal, text, round);
  }

  /**
   * Whitespace- and case-insensitive identity of the content, for repetition detection.
   * Compared only for equality, so the normalised text stands in for a hash (core has no crypto).
   */
  fingerprint(): string {
    return `${this.type}:${this.content.trim().replace(/\s+/g, ' ').toLowerCase()}`;
  }
}
