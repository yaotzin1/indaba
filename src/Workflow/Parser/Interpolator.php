<?php

declare(strict_types=1);

namespace Indaba\Workflow\Parser;

use Indaba\Core\Exception\IndabaException;

/**
 * Resolves `${{ artifacts.name }}` references.
 */
final readonly class Interpolator
{
    /**
     * @param array<string, string> $artifacts
     */
    public function __construct(private array $artifacts) {}

    public function interpolate(string $value): string
    {
        return (string) preg_replace_callback(
            '/\$\{\{\s*artifacts\.([A-Za-z0-9_-]+)\s*\}\}/',
            fn(array $m): string => $this->artifacts[$m[1]]
                ?? throw new IndabaException(sprintf('unknown artifact "%s"', $m[1])),
            $value,
        );
    }
}
