<?php

declare(strict_types=1);

namespace Indaba\Mesh;

use Indaba\Core\Exception\IndabaException;
use Indaba\Workflow\Model\DecisionType;

/**
 * Runs rounds of structured debate until the quorum is met, the debate stalls or the
 * round budget is spent. Participants take turns in the order given; quorum is evaluated
 * once per full round over each participant's latest message.
 */
final readonly class ConsensusArbiter
{
    public function __construct(
        private int $maxRounds = 4,
        private PingPongDetector $pingPong = new PingPongDetector(),
    ) {}

    /**
     * @param list<ParticipantInterface> $participants
     */
    public function deliberate(
        string $topic,
        array $participants,
        DecisionType $decision = DecisionType::Consensus,
    ): ConsensusResult {
        if ($participants === []) {
            throw new IndabaException('A consensus needs at least one participant.');
        }

        $board = new Blackboard();

        for ($round = 1; $round <= $this->maxRounds; ++$round) {
            foreach ($participants as $participant) {
                $board->post($participant->respond($topic, $board, $round));
            }

            if ($this->quorumMet($board, $participants, $decision)) {
                return new ConsensusResult(ConsensusOutcome::Reached, $round, $board->messages());
            }
            if ($this->pingPong->isStalled($board->messages(), count($participants))) {
                return new ConsensusResult(ConsensusOutcome::Stalled, $round, $board->messages());
            }
        }

        return new ConsensusResult(ConsensusOutcome::MaxRoundsExceeded, $this->maxRounds, $board->messages());
    }

    /**
     * @param list<ParticipantInterface> $participants
     */
    private function quorumMet(Blackboard $board, array $participants, DecisionType $decision): bool
    {
        $agreeing = 0;
        foreach ($participants as $participant) {
            if ($board->latestBy($participant->role())?->type === MessageType::Agreement) {
                ++$agreeing;
            }
        }

        return match ($decision) {
            DecisionType::Consensus => $agreeing === count($participants),
            DecisionType::Majority => $agreeing * 2 > count($participants),
        };
    }
}
