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
 * The pure layers must not import framework code, so they stay testable and portable.
 */
final class LayerBoundaryTest extends TestCase
{
    /**
     * @return iterable<string, array{string}>
     */
    public static function pureDirectories(): iterable
    {
        foreach (['Core', 'Mesh', 'Workflow/Model', 'Workflow/Graph', 'Workflow/State', 'Workflow/Parser/Node.php'] as $dir) {
            yield $dir => [$dir];
        }
    }

    #[DataProvider('pureDirectories')]
    public function testPureLayersImportNoFramework(string $relative): void
    {
        $path = __DIR__ . '/../../../src/' . $relative;
        $files = is_file($path) ? [$path] : $this->phpFiles($path);

        self::assertNotSame([], $files);
        foreach ($files as $file) {
            $source = (string) file_get_contents($file);
            self::assertDoesNotMatchRegularExpression('/^use (Symfony|Psr)\\\\/m', $source, $file);
        }
    }

    public function testNoShellExecutionOutsideTheProcessWrapper(): void
    {
        foreach ($this->phpFiles(__DIR__ . '/../../../src') as $file) {
            $source = (string) file_get_contents($file);
            self::assertDoesNotMatchRegularExpression('/\b(shell_exec|exec|system|passthru|popen|proc_open|eval)\s*\(/', $source, $file);
        }
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

        return $files;
    }
}
