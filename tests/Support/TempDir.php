<?php

declare(strict_types=1);

namespace Indaba\Tests\Support;

use PHPUnit\Framework\Attributes\After;
use Symfony\Component\Process\Process;

trait TempDir
{
    /** @var list<string> */
    private array $tempDirs = [];

    protected function makeTempDir(): string
    {
        $dir = sys_get_temp_dir() . '/indaba-' . bin2hex(random_bytes(6));
        mkdir($dir, 0o775, true);

        return $this->tempDirs[] = (string) realpath($dir);
    }

    protected function makeGitRepo(): string
    {
        $dir = $this->makeTempDir();
        mkdir($dir . '/src');
        file_put_contents($dir . '/src/app.txt', "v1\n");
        foreach ([['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-q', '-m', 'init']] as $args) {
            (new Process(['git', ...$args], $dir))->mustRun();
        }

        return $dir;
    }

    #[After]
    protected function removeTempDirs(): void
    {
        foreach ($this->tempDirs as $dir) {
            (new Process(['rm', '-rf', $dir]))->run();
        }
        $this->tempDirs = [];
    }
}
