<?php

declare(strict_types=1);

namespace Indaba\Tests\Unit\Workspace;

use Indaba\Core\Exception\WorkspaceException;
use Indaba\Tests\Support\TempDir;
use Indaba\Workflow\Guard\GitDiffEmptyGuard;
use Indaba\Workflow\Model\GuardDefinition;
use Indaba\Workflow\Model\GuardType;
use Indaba\Workspace\GitWorktreeManager;
use Indaba\Workspace\PatchService;
use PHPUnit\Framework\TestCase;

final class GitWorkspaceTest extends TestCase
{
    use TempDir;

    public function testWorktreeIsolatesChangesProducesAPatchAndCleansUp(): void
    {
        $repo = $this->makeGitRepo();
        $ws = (new GitWorktreeManager($repo))->create('task-1');

        self::assertSame($repo . '/.indaba/worktrees/task-1', $ws->path());
        file_put_contents($ws->path() . '/src/app.txt', "v2\n");
        file_put_contents($ws->path() . '/src/new.txt', "new\n");
        mkdir($ws->path() . '/.indaba/artifacts', 0o775, true);
        file_put_contents($ws->path() . '/.indaba/artifacts/spec.md', 'never in the patch');

        self::assertSame("v1\n", file_get_contents($repo . '/src/app.txt'), 'main checkout untouched');

        $patch = $ws->diff();
        self::assertStringContainsString('+v2', $patch);
        self::assertStringContainsString('src/new.txt', $patch);
        self::assertStringNotContainsString('spec.md', $patch);

        $patches = new PatchService();
        self::assertTrue($patches->canApply($patch, $repo));
        $patches->apply($patch, $repo);
        self::assertSame("v2\n", file_get_contents($repo . '/src/app.txt'));
        self::assertFalse($patches->canApply($patch, $repo), 'already applied');

        $ws->destroy();
        $ws->destroy();
        self::assertDirectoryDoesNotExist($repo . '/.indaba/worktrees/task-1');
    }

    public function testRejectsPathTraversalInNames(): void
    {
        $this->expectException(WorkspaceException::class);
        (new GitWorktreeManager($this->makeGitRepo()))->create('../escape');
    }

    public function testRefusesToReuseAWorktreePath(): void
    {
        $manager = new GitWorktreeManager($this->makeGitRepo());
        $manager->create('same');
        $this->expectException(WorkspaceException::class);
        $manager->create('same');
    }

    public function testGitDiffEmptyGuard(): void
    {
        $repo = $this->makeGitRepo();
        $guard = new GitDiffEmptyGuard();
        $definition = new GuardDefinition(GuardType::GitDiffEmpty, ['src/']);

        self::assertTrue($guard->check($definition, $repo)->passed);

        file_put_contents($repo . '/other.txt', 'outside the guarded paths');
        self::assertTrue($guard->check($definition, $repo)->passed);

        file_put_contents($repo . '/src/added.txt', 'x');
        $result = $guard->check($definition, $repo);
        self::assertFalse($result->passed);
        self::assertStringContainsString('src/added.txt', (string) $result->message);
    }

    public function testGuardFailsClosedOutsideAGitRepository(): void
    {
        $result = (new GitDiffEmptyGuard())->check(
            new GuardDefinition(GuardType::GitDiffEmpty, ['src/']),
            $this->makeTempDir(),
        );

        self::assertFalse($result->passed);
    }
}
