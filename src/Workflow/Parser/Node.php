<?php

declare(strict_types=1);

namespace Indaba\Workflow\Parser;

use Indaba\Core\Exception\IndabaException;

/**
 * Typed, error-accumulating view over a decoded YAML mapping.
 */
final readonly class Node
{
    /**
     * @param array<array-key, mixed> $data
     */
    public function __construct(
        private array $data,
        public string $path,
        private ErrorBag $errors,
        private ?Interpolator $interpolator = null,
    ) {}

    public function has(string $key): bool
    {
        return array_key_exists($key, $this->data);
    }

    public function string(string $key, bool $required = true, bool $interpolate = false): ?string
    {
        if (!$this->has($key) || $this->data[$key] === null) {
            if ($required) {
                $this->errors->add(sprintf('%s.%s is required', $this->path, $key));
            }

            return null;
        }

        $value = $this->data[$key];
        if (!is_string($value) || ($required && trim($value) === '')) {
            $this->errors->add(sprintf('%s.%s must be a non-empty string', $this->path, $key));

            return null;
        }

        return $interpolate ? $this->resolve($value, $key) : $value;
    }

    public function int(string $key, int $default): int
    {
        if (!$this->has($key)) {
            return $default;
        }
        $value = $this->data[$key];
        if (!is_int($value)) {
            $this->errors->add(sprintf('%s.%s must be an integer', $this->path, $key));

            return $default;
        }

        return $value;
    }

    /**
     * @return list<string>
     */
    public function stringList(string $key, bool $interpolate = false): array
    {
        if (!$this->has($key) || $this->data[$key] === null) {
            return [];
        }
        $value = $this->data[$key];
        if (!is_array($value) || !array_is_list($value)) {
            $this->errors->add(sprintf('%s.%s must be a list of strings', $this->path, $key));

            return [];
        }

        $out = [];
        foreach ($value as $i => $item) {
            if (!is_string($item)) {
                $this->errors->add(sprintf('%s.%s[%d] must be a string', $this->path, $key, $i));
                continue;
            }
            $out[] = $interpolate ? ($this->resolve($item, $key) ?? $item) : $item;
        }

        return $out;
    }

    public function map(string $key): ?self
    {
        if (!$this->has($key) || $this->data[$key] === null) {
            return null;
        }

        return $this->asNode($this->data[$key], $this->path . '.' . $key);
    }

    /**
     * @return list<self>
     */
    public function nodeList(string $key): array
    {
        if (!$this->has($key) || $this->data[$key] === null) {
            return [];
        }
        $value = $this->data[$key];
        if (!is_array($value) || !array_is_list($value)) {
            $this->errors->add(sprintf('%s.%s must be a list', $this->path, $key));

            return [];
        }

        $nodes = [];
        foreach ($value as $i => $item) {
            $node = $this->asNode($item, sprintf('%s.%s[%d]', $this->path, $key, $i));
            if ($node !== null) {
                $nodes[] = $node;
            }
        }

        return $nodes;
    }

    /**
     * @return array<string, self>
     */
    public function nodeMap(string $key): array
    {
        $map = $this->map($key);
        if ($map === null) {
            return [];
        }

        $nodes = [];
        foreach ($map->data as $name => $item) {
            $node = $this->asNode($item, $map->path . '.' . $name);
            if ($node !== null) {
                $nodes[(string) $name] = $node;
            }
        }

        return $nodes;
    }

    /**
     * @return array<string, string>
     */
    public function stringMap(string $key): array
    {
        $map = $this->map($key);
        if ($map === null) {
            return [];
        }

        $out = [];
        foreach ($map->data as $name => $item) {
            if (!is_string($item)) {
                $this->errors->add(sprintf('%s.%s must be a string', $map->path, $name));
                continue;
            }
            $out[(string) $name] = $item;
        }

        return $out;
    }

    private function asNode(mixed $value, string $path): ?self
    {
        if (!is_array($value)) {
            $this->errors->add(sprintf('%s must be a mapping', $path));

            return null;
        }

        return new self($value, $path, $this->errors, $this->interpolator);
    }

    private function resolve(string $value, string $key): ?string
    {
        if ($this->interpolator === null) {
            return $value;
        }
        try {
            return $this->interpolator->interpolate($value);
        } catch (IndabaException $e) {
            $this->errors->add(sprintf('%s.%s: %s', $this->path, $key, $e->getMessage()));

            return null;
        }
    }
}
