<?php

declare(strict_types=1);

namespace Indaba\Runners;

/**
 * An agent command line plus the temporary files it needs, which the runner deletes afterwards.
 */
final readonly class PreparedCommand
{
    /**
     * @param list<string> $command
     * @param list<string> $temporaryFiles
     */
    public function __construct(
        public array $command,
        public array $temporaryFiles = [],
    ) {}
}
