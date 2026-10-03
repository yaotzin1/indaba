<?php

declare(strict_types=1);

namespace Indaba\Workflow\Parser;

final class ErrorBag
{
    /** @var list<string> */
    private array $errors = [];

    public function add(string $message): void
    {
        $this->errors[] = $message;
    }

    /**
     * @return list<string>
     */
    public function all(): array
    {
        return $this->errors;
    }

    public function isEmpty(): bool
    {
        return $this->errors === [];
    }
}
