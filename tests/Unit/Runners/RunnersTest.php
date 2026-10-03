<?php

declare(strict_types=1);

namespace Indaba\Tests\Unit\Runners;

use Indaba\Core\Exception\RunnerException;
use Indaba\Runners\AbstractCliRunner;
use Indaba\Runners\ClaudeRunner;
use Indaba\Runners\CommandRunner;
use Indaba\Runners\OpenRouterRunner;
use Indaba\Runners\RunnerRegistry;
use Indaba\Runners\RunRequest;
use Indaba\Runners\ShellRunner;
use Indaba\Runners\SseParser;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;

final class RunnersTest extends TestCase
{
    public function testShellRunnerCapturesStreamsAndExitCode(): void
    {
        $seen = '';
        $result = (new ShellRunner())->run(new RunRequest(
            'echo out; echo err 1>&2; exit 3',
            sys_get_temp_dir(),
            onOutput: function (string $chunk) use (&$seen): void {
                $seen .= $chunk;
            },
        ));

        self::assertSame(3, $result->exitCode);
        self::assertSame("out\n", $result->output);
        self::assertSame("err\n", $result->errorOutput);
        self::assertSame('err', $result->failureText());
        self::assertStringContainsString('out', $seen);
    }

    public function testShellRunnerTimesOut(): void
    {
        $result = (new ShellRunner())->run(new RunRequest('sleep 5', sys_get_temp_dir(), timeoutSeconds: 0.3));

        self::assertSame(124, $result->exitCode);
        self::assertStringContainsString('Timed out', $result->errorOutput);
    }

    public function testCommandRunnerSubstitutesWholeArguments(): void
    {
        $runner = new CommandRunner('echoer', ['printf', '%s|%s', '{prompt}', '{model}'], usePty: false);
        $result = $runner->run(new RunRequest('a b; rm -rf /', sys_get_temp_dir(), 'm1'));

        self::assertSame('a b; rm -rf /|m1', $result->output);
    }

    public function testClaudeRunnerBuildsAnArgumentVectorWithoutAShell(): void
    {
        // `echo` stands in for the claude binary: it prints the argument vector it was given.
        $runner = new ClaudeRunner(binary: 'echo', usePty: false);
        $result = $runner->run(new RunRequest('a b; $(touch pwned)', sys_get_temp_dir(), 'opus'));

        self::assertSame('claude-code', $runner->name());
        self::assertSame("-p a b; $(touch pwned) --permission-mode acceptEdits --model opus
", $result->output);
        self::assertFileDoesNotExist(sys_get_temp_dir() . '/pwned');
    }

    public function testStripAnsi(): void
    {
        self::assertSame("hello\nworld", AbstractCliRunner::stripAnsi("\e[31mhello\e[0m\r\n\e]0;title\x07world"));
    }

    public function testSseParserHandlesSplitChunksCommentsAndCrlf(): void
    {
        $p = new SseParser();

        self::assertSame([], $p->feed(": OPENROUTER PROCESSING\n\ndata: {\"a\""));
        self::assertSame(['{"a":1}', '[DONE]'], $p->feed(":1}\r\n\r\ndata: [DONE]\n\n"));
    }

    public function testOpenRouterStreamsContentAndUsage(): void
    {
        $sse = implode('', [
            ": OPENROUTER PROCESSING\n\n",
            'data: ' . json_encode(['choices' => [['delta' => ['reasoning' => 'thinking...']]]]) . "\n\n",
            'data: ' . json_encode(['choices' => [['delta' => ['content' => 'Hel']]]]) . "\n\n",
            'data: ' . json_encode(['choices' => [['delta' => ['content' => 'lo']]]]) . "\n\n",
            'data: ' . json_encode(['choices' => [], 'usage' => ['prompt_tokens' => 12, 'completion_tokens' => 5]]) . "\n\n",
            "data: [DONE]\n\n",
        ]);
        $captured = [];
        $client = new MockHttpClient(function (string $method, string $url, array $options) use ($sse, &$captured): MockResponse {
            $captured = ['method' => $method, 'url' => $url, 'body' => $options['body'] ?? '', 'headers' => $options['headers'] ?? []];

            return new MockResponse([substr($sse, 0, 40), substr($sse, 40)], ['http_code' => 200]);
        });

        $streamed = '';
        $result = (new OpenRouterRunner($client, 'sk-test'))->run(new RunRequest(
            'say hi',
            '.',
            'anthropic/claude-3.7-sonnet:thinking',
            onOutput: function (string $c) use (&$streamed): void {
                $streamed .= $c;
            },
        ));

        self::assertSame(0, $result->exitCode);
        self::assertSame('Hello', $result->output);
        self::assertSame('Hello', $streamed);
        self::assertSame(12, $result->usage?->inputTokens);
        self::assertSame(5, $result->usage->outputTokens);
        self::assertSame('POST', $captured['method']);
        self::assertSame('https://openrouter.ai/api/v1/chat/completions', $captured['url']);
        $body = json_decode((string) $captured['body'], true);
        self::assertIsArray($body);
        self::assertTrue($body['stream']);
        self::assertSame('anthropic/claude-3.7-sonnet:thinking', $body['model']);
    }

    public function testOpenRouterReportsHttpErrors(): void
    {
        $client = new MockHttpClient(new MockResponse('{"error":"nope"}', ['http_code' => 401]));
        $result = (new OpenRouterRunner($client, 'bad'))->run(new RunRequest('x', '.', 'm'));

        self::assertSame(1, $result->exitCode);
        self::assertStringContainsString('HTTP 401', $result->errorOutput);
    }

    public function testOpenRouterNeedsKeyAndModel(): void
    {
        $client = new MockHttpClient();
        try {
            (new OpenRouterRunner($client, ''))->run(new RunRequest('x', '.', 'm'));
            self::fail('expected exception');
        } catch (RunnerException $e) {
            self::assertStringContainsString('OPENROUTER_API_KEY', $e->getMessage());
        }

        $this->expectException(RunnerException::class);
        (new OpenRouterRunner($client, 'k'))->run(new RunRequest('x', '.'));
    }

    public function testRegistryLooksUpRunnersAndExplainsMisses(): void
    {
        $registry = RunnerRegistry::withDefaults(['INDABA_CODEX_CMD' => 'mycodex run {prompt}'], new MockHttpClient());

        foreach (['shell', 'claude-code', 'cursor', 'codex', 'antigravity', 'openrouter'] as $name) {
            self::assertSame($name, $registry->get($name)->name());
        }

        $this->expectException(RunnerException::class);
        $this->expectExceptionMessage('Unknown runner "nope"');
        $registry->get('nope');
    }
}
