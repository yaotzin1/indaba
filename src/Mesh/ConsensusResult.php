<?php

declare(strict_types=1);

namespace Indaba\Mesh;

final readonly class ConsensusResult
{
    /**
     * @param list<AgentMessage> $transcript
     */
    public function __construct(
        public ConsensusOutcome $outcome,
        public int $rounds,
        public array $transcript,
    ) {}

    public function reached(): bool
    {
        return $this->outcome === ConsensusOutcome::Reached;
    }

    /** The most recent non-agreement message of each participant: what is still unresolved. */
    public function openObjections(): string
    {
        $latest = [];
        foreach ($this->transcript as $m) {
            $latest[$m->sender] = $m;
        }

        $lines = [];
        foreach ($latest as $m) {
            if ($m->type !== MessageType::Agreement) {
                $lines[] = sprintf('%s (%s): %s', $m->sender, $m->type->value, $m->content);
            }
        }

        return implode("\n", $lines);
    }
}
