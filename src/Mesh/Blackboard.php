<?php

declare(strict_types=1);

namespace Indaba\Mesh;

/**
 * Shared, append-only message space (blackboard pattern) plus a small fact store.
 */
final class Blackboard
{
    /** @var list<AgentMessage> */
    private array $messages = [];

    /** @var array<string, string> */
    private array $facts = [];

    public function post(AgentMessage $message): void
    {
        $this->messages[] = $message;
    }

    /**
     * @return list<AgentMessage>
     */
    public function messages(): array
    {
        return $this->messages;
    }

    public function latestBy(string $sender): ?AgentMessage
    {
        for ($i = count($this->messages) - 1; $i >= 0; --$i) {
            if ($this->messages[$i]->sender === $sender) {
                return $this->messages[$i];
            }
        }

        return null;
    }

    public function setFact(string $key, string $value): void
    {
        $this->facts[$key] = $value;
    }

    public function fact(string $key): ?string
    {
        return $this->facts[$key] ?? null;
    }

    public function transcript(): string
    {
        $lines = [];
        foreach ($this->messages as $m) {
            $lines[] = sprintf("[round %d] %s (%s):\n%s", $m->round, $m->sender, $m->type->value, $m->content);
        }

        return implode("\n\n", $lines);
    }
}
