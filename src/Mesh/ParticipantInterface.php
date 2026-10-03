<?php

declare(strict_types=1);

namespace Indaba\Mesh;

interface ParticipantInterface
{
    /** The role name this participant speaks for, e.g. "architect". */
    public function role(): string;

    public function respond(string $topic, Blackboard $board, int $round): AgentMessage;
}
