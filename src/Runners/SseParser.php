<?php

declare(strict_types=1);

namespace Indaba\Runners;

/**
 * Incremental Server-Sent Events parser. Feed it network chunks of any size and it
 * returns the `data:` payload of each event completed so far.
 */
final class SseParser
{
    private string $buffer = '';

    /**
     * @return list<string>
     */
    public function feed(string $chunk): array
    {
        $this->buffer .= str_replace(["\r\n", "\r"], "\n", $chunk);
        $payloads = [];

        while (($end = strpos($this->buffer, "\n\n")) !== false) {
            $block = substr($this->buffer, 0, $end);
            $this->buffer = substr($this->buffer, $end + 2);

            $data = [];
            foreach (explode("\n", $block) as $line) {
                if ($line === '' || $line[0] === ':') {
                    continue; // comment / keep-alive such as ": OPENROUTER PROCESSING"
                }
                if (str_starts_with($line, 'data:')) {
                    $data[] = ltrim(substr($line, 5), ' ');
                }
            }
            if ($data !== []) {
                $payloads[] = implode("\n", $data);
            }
        }

        return $payloads;
    }
}
