<?php

declare(strict_types=1);

namespace Indaba\Mesh;

/**
 * Immutable envelope exchanged between agents on the blackboard.
 */
final readonly class AgentMessage
{
    public function __construct(
        public string $sender,
        public MessageType $type,
        public string $content,
        public int $round,
    ) {}

    /**
     * Parses an agent reply. A reply starting with a type keyword ("AGREEMENT: ...",
     * "[CRITIQUE] ...") carries that type; anything else is treated as a PROPOSAL, which
     * can never count as approval.
     */
    public static function fromReply(string $sender, string $reply, int $round): self
    {
        $text = trim($reply);
        if (preg_match('/^\s*[\[(*#]*\s*(PROPOSAL|CRITIQUE|AGREEMENT|QUESTION|TOOL_INTENT)\b[\])*]*\s*[:\-–—]?\s*/i', $text, $m) === 1) {
            $type = MessageType::from(strtoupper($m[1]));

            return new self($sender, $type, trim(substr($text, strlen($m[0]))), $round);
        }

        return new self($sender, MessageType::Proposal, $text, $round);
    }

    /** Whitespace- and case-insensitive identity of the content, for repetition detection. */
    public function fingerprint(): string
    {
        $normalised = strtolower((string) preg_replace('/\s+/', ' ', trim($this->content)));

        return $this->type->value . ':' . hash('sha256', $normalised);
    }
}
