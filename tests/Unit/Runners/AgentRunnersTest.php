<?php

declare(strict_types=1);

namespace Indaba\Tests\Unit\Runners;

use Indaba\Runners\AntigravityRunner;
use Indaba\Runners\CodexRunner;
use Indaba\Runners\CommandRunner;
use Indaba\Runners\RunnerRegistry;
use Indaba\Runners\RunRequest;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpClient\MockHttpClient;

final class AgentRunnersTest extends TestCase
{
    public function testCodexBuildsAnExecCommandWithTheWorkspaceSandbox(): void
    {
        $result = (new CodexRunner(binary: 'echo', usePty: false))
            ->run(new RunRequest('do it; $(x)', sys_get_temp_dir(), 'gpt-5-codex'));

        self::assertSame("exec --sandbox workspace-write --model gpt-5-codex do it; \$(x)\n", $result->output);
    }

    public function testAntigravityBuildsAHeadlessPrintCommand(): void
    {
        $result = (new AntigravityRunner(binary: 'echo', usePty: false))
            ->run(new RunRequest('review this', sys_get_temp_dir(), 'some-model'));

        self::assertSame("--model some-model -p review this\n", $result->output);
    }

    public function testAntigravityNeverSkipsPermissionsUnlessAsked(): void
    {
        $result = (new AntigravityRunner(binary: 'echo', usePty: false))->run(new RunRequest('x', sys_get_temp_dir()));

        self::assertStringNotContainsString('dangerously', $result->output);
    }

    public function testRegistryUsesFirstClassRunnersAndEnvOverrides(): void
    {
        $default = RunnerRegistry::withDefaults([], new MockHttpClient());
        self::assertInstanceOf(CodexRunner::class, $default->get('codex'));
        self::assertInstanceOf(AntigravityRunner::class, $default->get('antigravity'));

        $custom = RunnerRegistry::withDefaults(['INDABA_CODEX_CMD' => 'mycodex go {prompt}'], new MockHttpClient());
        self::assertInstanceOf(CommandRunner::class, $custom->get('codex'));
    }

    public function testNewEnginesCanBeRegisteredWithoutTouchingTheCore(): void
    {
        $registry = RunnerRegistry::withDefaults([], new MockHttpClient());
        $registry->register(new CommandRunner('gemini', ['gemini', '-p', '{prompt}']));

        self::assertSame('gemini', $registry->get('gemini')->name());
    }
}
