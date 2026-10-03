<?php

declare(strict_types=1);

namespace Indaba\Core\Exception;

final class WorkflowValidationException extends IndabaException
{
    /**
     * @param list<string> $errors
     */
    public function __construct(public readonly array $errors)
    {
        parent::__construct("Invalid workflow:\n - " . implode("\n - ", $errors));
    }
}
