<?php

declare(strict_types=1);

namespace Indaba\Mesh;

/**
 * Detects a debate that has stopped making progress: with N participants, the last N
 * messages repeat the N before them verbatim (modulo whitespace and case).
 */
final readonly class PingPongDetector
{
    /**
     * @param list<AgentMessage> $messages
     */
    public function isStalled(array $messages, int $participants): bool
    {
        if ($participants < 1 || count($messages) < 2 * $participants) {
            return false;
        }

        $recent = array_slice($messages, -2 * $participants);
        for ($i = 0; $i < $participants; ++$i) {
            if ($recent[$i]->fingerprint() !== $recent[$i + $participants]->fingerprint()) {
                return false;
            }
        }

        return true;
    }
}
