<?php

declare(strict_types=1);

namespace Indaba\Tests\Unit\Architecture;

use FilesystemIterator;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use SplFileInfo;

/**
 * Enforces the first architectural rule of workflow.ai.yml with a token scan rather than a regex
 * over source text: every qualified name a file mentions, whether imported or written in full, is
 * checked, and comments and strings cannot cause or hide a violation.
 *
 * Complements LayerBoundaryTest (which greps `use` lines). This one also catches a fully qualified
 * name used inline and enforces the dependency direction between the layers.
 */
final class BoundaryTest extends TestCase
{
    /**
     * The pure domain: directory under src/ => the Indaba namespaces it may name besides its own.
     * Anything outside the PHP standard library, these, and Psr\Clock is a violation.
     *
     * @var array<string, list<string>>
     */
    private const PURE = [
        'Core' => [],
        'Workflow/Model' => ['Indaba\Core'],
        'Workflow/Graph' => ['Indaba\Core', 'Indaba\Workflow\Model'],
        'Workflow/State' => ['Indaba\Core', 'Indaba\Workflow\Model'],
        'Mesh' => ['Indaba\Core', 'Indaba\Workflow\Model', 'Indaba\Runners\RunnerInterface', 'Indaba\Runners\RunRequest', 'Indaba\Runners\RunResult'],
    ];

    /** The runners the engine and the mesh must reach only through RunnerInterface and the registry. */
    private const CONCRETE_RUNNER = '/^Indaba\\\\Runners\\\\(?:Abstract\w*|\w+Runner)$/';

    /**
     * @return iterable<string, array{string, list<string>}>
     */
    public static function pureDirectories(): iterable
    {
        foreach (self::PURE as $directory => $allowed) {
            yield $directory => [$directory, $allowed];
        }
    }

    /**
     * @param list<string> $allowed
     */
    #[DataProvider('pureDirectories')]
    public function testPureDomainNamesNoFrameworkAndNoUpwardDependency(string $directory, array $allowed): void
    {
        $files = $this->phpFiles(self::source() . '/' . $directory);
        self::assertNotSame([], $files, "no PHP files found under src/{$directory}");

        $own = 'Indaba\\' . str_replace('/', '\\', $directory);
        foreach ($files as $file) {
            foreach ($this->qualifiedNames($file) as $name) {
                if (str_starts_with($name, 'Symfony\\')) {
                    self::fail("{$file} names {$name}: the pure domain imports no Symfony class");
                }
                if (str_starts_with($name, 'Psr\\') && !str_starts_with($name, 'Psr\\Clock\\')) {
                    self::fail("{$file} names {$name}: the pure domain may use Psr\\Clock only");
                }
                if (str_starts_with($name, 'Indaba\\') && !$this->isWithin($name, [$own, ...$allowed])) {
                    self::fail("{$file} names {$name}: not in its own namespace or its allowed dependencies (" . implode(', ', [$own, ...$allowed]) . ')');
                }
            }
        }
    }

    public function testOnlyTheCompositionRootNamesAConcreteRunner(): void
    {
        $allowed = ['Console/', 'Runners/'];
        foreach ($this->phpFiles(self::source()) as $file) {
            $relative = substr($file, strlen(self::source()) + 1);
            foreach ($allowed as $prefix) {
                if (str_starts_with($relative, $prefix)) {
                    continue 2;
                }
            }
            foreach ($this->qualifiedNames($file) as $name) {
                self::assertDoesNotMatchRegularExpression(
                    self::CONCRETE_RUNNER,
                    $name,
                    "{$relative} names the concrete runner {$name}; depend on RunnerInterface or RunnerRegistry",
                );
            }
        }
    }

    public function testNothingUnderSrcDependsOnTests(): void
    {
        foreach ($this->phpFiles(self::source()) as $file) {
            foreach ($this->qualifiedNames($file) as $name) {
                self::assertStringStartsNotWith('Indaba\\Tests\\', $name, "{$file} depends on test code");
                self::assertStringStartsNotWith('PHPUnit\\', $name, "{$file} depends on PHPUnit");
            }
        }
    }

    private static function source(): string
    {
        return dirname(__DIR__, 3) . '/src';
    }

    /**
     * @param list<string> $namespaces
     */
    private function isWithin(string $name, array $namespaces): bool
    {
        foreach ($namespaces as $namespace) {
            if ($name === $namespace || str_starts_with($name, $namespace . '\\')) {
                return true;
            }
        }

        return false;
    }

    /**
     * Every qualified name in the file, without a leading backslash, found by tokenising. A
     * `namespace` declaration is not a dependency and is skipped.
     *
     * @return list<string>
     */
    private function qualifiedNames(string $file): array
    {
        $tokens = token_get_all((string) file_get_contents($file), TOKEN_PARSE);
        $names = [];
        $afterNamespace = false;

        foreach ($tokens as $token) {
            if (!is_array($token)) {
                $afterNamespace = false;

                continue;
            }
            [$id, $text] = $token;
            if ($id === T_WHITESPACE || $id === T_COMMENT || $id === T_DOC_COMMENT) {
                continue;
            }
            if ($id === T_NAMESPACE) {
                $afterNamespace = true;

                continue;
            }
            if (($id === T_NAME_QUALIFIED || $id === T_NAME_FULLY_QUALIFIED) && !$afterNamespace) {
                $names[] = ltrim($text, '\\');
            }
            $afterNamespace = false;
        }

        return $names;
    }

    /**
     * @return list<string>
     */
    private function phpFiles(string $directory): array
    {
        $files = [];
        foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS)) as $file) {
            if ($file instanceof SplFileInfo && $file->getExtension() === 'php') {
                $files[] = $file->getPathname();
            }
        }
        sort($files);

        return $files;
    }
}
