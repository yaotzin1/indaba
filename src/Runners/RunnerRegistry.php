<?php

declare(strict_types=1);

namespace Indaba\Runners;

use Indaba\Core\Exception\RunnerException;
use Symfony\Component\HttpClient\HttpClient;
use Symfony\Contracts\HttpClient\HttpClientInterface;

final class RunnerRegistry
{
    /** @var array<string, RunnerInterface> */
    private array $runners = [];

    public function register(RunnerInterface $runner): self
    {
        $this->runners[$runner->name()] = $runner;

        return $this;
    }

    public function has(string $name): bool
    {
        return isset($this->runners[$name]);
    }

    public function get(string $name): RunnerInterface
    {
        return $this->runners[$name] ?? throw new RunnerException(sprintf(
            'Unknown runner "%s". Registered: %s.',
            $name,
            implode(', ', array_keys($this->runners)) ?: 'none',
        ));
    }

    /**
     * @param array<string, string> $env process environment; INDABA_CODEX_CMD / INDABA_ANTIGRAVITY_CMD
     *                                   override the argument template (space separated, `{prompt}` marks the prompt)
     */
    public static function withDefaults(array $env = [], ?HttpClientInterface $http = null): self
    {
        $registry = new self();
        $registry
            ->register(new ShellRunner())
            ->register(new ClaudeRunner())
            ->register(new CursorRunner())
            ->register(new CommandRunner('codex', self::template($env['INDABA_CODEX_CMD'] ?? null, ['codex', 'exec', '{prompt}'])))
            ->register(new CommandRunner('antigravity', self::template($env['INDABA_ANTIGRAVITY_CMD'] ?? null, ['antigravity', 'chat', '{prompt}'])))
            ->register(new OpenRouterRunner($http ?? HttpClient::create(), $env['OPENROUTER_API_KEY'] ?? ''));

        return $registry;
    }

    /**
     * @param list<string> $default
     * @return list<string>
     */
    private static function template(?string $override, array $default): array
    {
        if ($override === null || trim($override) === '') {
            return $default;
        }

        return array_values(array_filter(explode(' ', $override), static fn(string $a): bool => $a !== ''));
    }
}
