<?php

declare(strict_types=1);

namespace Indaba\Mesh;

use Indaba\Runners\RunnerInterface;
use Indaba\Runners\RunRequest;

/**
 * Adapts a runner into a debate participant by wrapping the topic and the transcript
 * so far in the message protocol.
 */
final readonly class RunnerParticipant implements ParticipantInterface
{
    /**
     * @param (\Closure(RunnerInterface, RunRequest): \Indaba\Runners\RunResult)|null $invoke hook for tracing
     */
    public function __construct(
        private string $role,
        private RunnerInterface $runner,
        private string $workdir,
        private ?string $model = null,
        private ?\Closure $invoke = null,
    ) {}

    public function role(): string
    {
        return $this->role;
    }

    public function respond(string $topic, Blackboard $board, int $round): AgentMessage
    {
        $request = new RunRequest($this->prompt($topic, $board, $round), $this->workdir, $this->model);
        $result = $this->invoke === null ? $this->runner->run($request) : ($this->invoke)($this->runner, $request);

        if (!$result->succeeded()) {
            return new AgentMessage(
                $this->role,
                MessageType::Critique,
                'The runner failed and could not take part: ' . $result->failureText(),
                $round,
            );
        }

        return AgentMessage::fromReply($this->role, $result->output, $round);
    }

    private function prompt(string $topic, Blackboard $board, int $round): string
    {
        $transcript = $board->transcript();

        return implode("\n\n", array_filter([
            sprintf('You are the "%s" in a structured review (round %d). Decide on the topic below.', $this->role, $round),
            "## Topic\n" . $topic,
            $transcript === '' ? null : "## Discussion so far\n" . $transcript,
            "## Reply protocol\nBegin your reply with exactly one keyword followed by a colon: "
            . 'AGREEMENT (you approve as it stands), CRITIQUE (you require changes; list them), '
            . 'PROPOSAL (you suggest an alternative) or QUESTION. Only AGREEMENT counts as approval.',
        ]));
    }
}
