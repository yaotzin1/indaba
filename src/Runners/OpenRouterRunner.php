<?php

declare(strict_types=1);

namespace Indaba\Runners;

use Indaba\Core\Exception\RunnerException;
use Indaba\Observability\TokenUsage;
use Symfony\Contracts\HttpClient\Exception\ExceptionInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

/**
 * Streams a chat completion from OpenRouter over SSE. Reasoning tokens are not part of the
 * returned output; only the final content is.
 */
final readonly class OpenRouterRunner implements RunnerInterface
{
    public function __construct(
        private HttpClientInterface $http,
        #[\SensitiveParameter]
        private string $apiKey,
        private ?string $defaultModel = null,
        private string $baseUrl = 'https://openrouter.ai/api/v1',
    ) {}

    public function name(): string
    {
        return 'openrouter';
    }

    public function run(RunRequest $request): RunResult
    {
        if ($this->apiKey === '') {
            throw new RunnerException('OPENROUTER_API_KEY is not set.');
        }
        $model = $request->model ?? $this->defaultModel
            ?? throw new RunnerException('The openrouter runner needs a model (set `model` on the role).');

        $started = hrtime(true);
        $parser = new SseParser();
        $content = '';
        $usage = null;

        try {
            $response = $this->http->request('POST', rtrim($this->baseUrl, '/') . '/chat/completions', [
                'headers' => [
                    'Authorization' => 'Bearer ' . $this->apiKey,
                    'Accept' => 'text/event-stream',
                ],
                'json' => [
                    'model' => $model,
                    'stream' => true,
                    'usage' => ['include' => true],
                    'messages' => [['role' => 'user', 'content' => $request->prompt]],
                ],
                'timeout' => 60,
                'max_duration' => $request->timeoutSeconds,
            ]);

            if ($response->getStatusCode() >= 400) {
                return new RunResult(
                    1,
                    '',
                    sprintf('OpenRouter HTTP %d: %s', $response->getStatusCode(), $response->getContent(false)),
                    null,
                    (hrtime(true) - $started) / 1e6,
                    $model,
                );
            }

            foreach ($this->http->stream($response) as $chunk) {
                if ($chunk->isTimeout()) {
                    continue;
                }
                foreach ($parser->feed($chunk->getContent()) as $payload) {
                    if ($payload === '[DONE]') {
                        break 2;
                    }
                    $this->consume($payload, $content, $usage, $request);
                }
            }
        } catch (ExceptionInterface $e) {
            return new RunResult(1, $content, 'OpenRouter transport error: ' . $e->getMessage(), null, (hrtime(true) - $started) / 1e6, $model);
        }

        return new RunResult(0, $content, '', $usage, (hrtime(true) - $started) / 1e6, $model);
    }

    private function consume(string $payload, string &$content, ?TokenUsage &$usage, RunRequest $request): void
    {
        $event = json_decode($payload, true);
        if (!is_array($event)) {
            return;
        }

        $choices = $event['choices'] ?? null;
        $delta = is_array($choices) && isset($choices[0]) && is_array($choices[0]) ? ($choices[0]['delta'] ?? null) : null;
        if (is_array($delta) && isset($delta['content']) && is_string($delta['content']) && $delta['content'] !== '') {
            $content .= $delta['content'];
            if ($request->onOutput !== null) {
                ($request->onOutput)($delta['content']);
            }
        }

        $raw = $event['usage'] ?? null;
        if (is_array($raw)) {
            $usage = new TokenUsage(
                is_int($raw['prompt_tokens'] ?? null) ? $raw['prompt_tokens'] : 0,
                is_int($raw['completion_tokens'] ?? null) ? $raw['completion_tokens'] : 0,
            );
        }
    }
}
