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
     * Built-in runners: shell, claude-code, codex, antigravity, cursor and openrouter. More engines
     * join the same way: implement RunnerInterface and `register()` it; workflows select a runner
     * by its `name()`.
     *
     * @param array<string, string> $env process environment. INDABA_CODEX_CMD and INDABA_ANTIGRAVITY_CMD
     *                                   replace the built-in command line (space separated, `{prompt}`
     *                                   and `{model}` mark where those go)
     */
    public static function withDefaults(array $env = [], ?HttpClientInterface $http = null): self
    {
        $registry = new self();
        $registry
            ->register(new ShellRunner())
            ->register(new ClaudeRunner())
            ->register(self::templateRunner('codex', $env['INDABA_CODEX_CMD'] ?? null) ?? new CodexRunner())
            ->register(self::templateRunner('antigravity', $env['INDABA_ANTIGRAVITY_CMD'] ?? null) ?? new AntigravityRunner())
            ->register(new CursorRunner())
            ->register(new OpenRouterRunner($http ?? HttpClient::create(), $env['OPENROUTER_API_KEY'] ?? ''));

        return $registry;
    }

    private static function templateRunner(string $name, ?string $override): ?CommandRunner
    {
        if ($override === null || trim($override) === '') {
            return null;
        }
        $template = array_values(array_filter(explode(' ', $override), static fn(string $a): bool => $a !== ''));

        return new CommandRunner($name, $template);
    }
}
