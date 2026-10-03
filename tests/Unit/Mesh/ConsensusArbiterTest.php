<?php

declare(strict_types=1);

namespace Indaba\Tests\Unit\Mesh;

use Indaba\Mesh\AgentMessage;
use Indaba\Mesh\Blackboard;
use Indaba\Mesh\ConsensusArbiter;
use Indaba\Mesh\ConsensusOutcome;
use Indaba\Mesh\MessageType;
use Indaba\Mesh\ParticipantInterface;
use Indaba\Mesh\PingPongDetector;
use Indaba\Workflow\Model\DecisionType;
use PHPUnit\Framework\TestCase;

final class ConsensusArbiterTest extends TestCase
{
    /**
     * @param list<string> $replies replies by round; the last one repeats
     */
    private function participant(string $role, array $replies): ParticipantInterface
    {
        return new readonly class ($role, $replies) implements ParticipantInterface {
            /**
             * @param list<string> $replies
             */
            public function __construct(private string $role, private array $replies) {}

            public function role(): string
            {
                return $this->role;
            }

            public function respond(string $topic, Blackboard $board, int $round): AgentMessage
            {
                $reply = $this->replies[min($round, count($this->replies)) - 1];

                return AgentMessage::fromReply($this->role, $reply, $round);
            }
        };
    }

    public function testReachesConsensusWhenEveryoneAgrees(): void
    {
        $result = (new ConsensusArbiter())->deliberate('topic', [
            $this->participant('architect', ['AGREEMENT: fine']),
            $this->participant('reviewer', ['CRITIQUE: tests missing', 'AGREEMENT: ok now']),
        ]);

        self::assertSame(ConsensusOutcome::Reached, $result->outcome);
        self::assertSame(2, $result->rounds);
    }

    public function testOneDissenterBlocksUnanimity(): void
    {
        $result = (new ConsensusArbiter(maxRounds: 3))->deliberate('t', [
            $this->participant('architect', ['AGREEMENT: ok']),
            $this->participant('reviewer', ['CRITIQUE: a', 'CRITIQUE: b', 'CRITIQUE: c']),
        ]);

        self::assertSame(ConsensusOutcome::MaxRoundsExceeded, $result->outcome);
        self::assertStringContainsString('reviewer (CRITIQUE): c', $result->openObjections());
    }

    public function testMajorityQuorum(): void
    {
        $result = (new ConsensusArbiter())->deliberate('t', [
            $this->participant('a', ['AGREEMENT: y']),
            $this->participant('b', ['AGREEMENT: y']),
            $this->participant('c', ['CRITIQUE: n']),
        ], DecisionType::Majority);

        self::assertTrue($result->reached());
    }

    public function testStopsEarlyOnPingPong(): void
    {
        $result = (new ConsensusArbiter(maxRounds: 10))->deliberate('t', [
            $this->participant('architect', ['PROPOSAL: use X']),
            $this->participant('reviewer', ['CRITIQUE: Use   Y instead']),
        ]);

        self::assertSame(ConsensusOutcome::Stalled, $result->outcome);
        self::assertSame(2, $result->rounds);
    }

    public function testUntaggedReplyIsNeverApproval(): void
    {
        $m = AgentMessage::fromReply('r', 'Looks good to me', 1);
        self::assertSame(MessageType::Proposal, $m->type);
    }

    public function testParsesTagVariants(): void
    {
        self::assertSame(MessageType::Agreement, AgentMessage::fromReply('r', '**AGREEMENT** - ship it', 1)->type);
        self::assertSame(MessageType::Critique, AgentMessage::fromReply('r', '[critique] no', 1)->type);
        self::assertSame('ship it', AgentMessage::fromReply('r', 'AGREEMENT: ship it', 1)->content);
        self::assertSame(MessageType::Proposal, AgentMessage::fromReply('r', 'AGREEMENTS are hard', 1)->type);
    }

    public function testPingPongNeedsEnoughHistory(): void
    {
        $m = AgentMessage::fromReply('a', 'CRITIQUE: x', 1);
        self::assertFalse((new PingPongDetector())->isStalled([$m, $m], 2));
        self::assertTrue((new PingPongDetector())->isStalled([$m, $m], 1));
    }
}
