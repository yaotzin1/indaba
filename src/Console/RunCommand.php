<?php

declare(strict_types=1);

namespace Indaba\Console;

use Indaba\Core\Exception\IndabaException;
use Indaba\Observability\SpanEnded;
use Indaba\Workflow\Engine\WorkflowStatus;
use Indaba\Workflow\Parser\WorkflowParser;
use Indaba\Workflow\State\StepStatusChanged;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputArgument;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\EventDispatcher\EventDispatcher;

#[AsCommand(name: 'run', description: 'Execute a workflow')]
final class RunCommand extends Command
{
    protected function configure(): void
    {
        $this
            ->addArgument('file', InputArgument::OPTIONAL, 'Workflow file', '.indaba/workflow.ai.yml')
            ->addOption('workdir', 'w', InputOption::VALUE_REQUIRED, 'Project directory the workflow runs against', '.')
            ->addOption('task-id', null, InputOption::VALUE_REQUIRED, 'Task id (names the worktree and trace)')
            ->addOption('timeout', null, InputOption::VALUE_REQUIRED, 'Per-step timeout in seconds', '900');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $file = $input->getArgument('file');
        $workdir = $input->getOption('workdir');
        $taskId = $input->getOption('task-id');
        $timeout = $input->getOption('timeout');
        \assert(is_string($file) && is_string($workdir) && is_string($timeout));
        \assert($taskId === null || is_string($taskId));

        $projectDir = realpath($workdir);
        if ($projectDir === false) {
            $output->writeln('<error>Working directory does not exist.</error>');

            return Command::FAILURE;
        }

        try {
            $workflow = (new WorkflowParser())->parseFile($file);

            $events = new EventDispatcher();
            $events->addListener(StepStatusChanged::class, static function (StepStatusChanged $e) use ($output): void {
                $output->writeln(sprintf('  %-14s %s -> %s%s', $e->stepId, $e->from->value, $e->to->value, $e->reason === null ? '' : ' (' . strtok($e->reason, "\n") . ')'));
            });
            $events->addListener(SpanEnded::class, static function (SpanEnded $e) use ($output): void {
                $cost = $e->span->attributes['indaba.cost.usd'] ?? null;
                if ($cost !== null && is_float($cost)) {
                    $output->writeln(sprintf('    <comment>%s: $%.4f</comment>', $e->span->name, $cost), OutputInterface::VERBOSITY_VERBOSE);
                }
            });

            $engine = (new EngineFactory())->create($projectDir, $events, self::environment(), (float) $timeout);
            $output->writeln(sprintf('<info>Running %s</info>', $workflow->name));
            $result = $engine->run(
                $workflow,
                $projectDir,
                $taskId ?? 'task-' . bin2hex(random_bytes(4)),
                $output->isVeryVerbose() ? static fn(string $chunk) => $output->write($chunk) : null,
            );
        } catch (IndabaException $e) {
            $output->writeln('<error>' . $e->getMessage() . '</error>');

            return Command::FAILURE;
        }

        $output->writeln(sprintf('Task %s finished: <info>%s</info> (trace %s)', $result->taskId, $result->status->value, $result->traceId));
        if ($result->failureReason !== null) {
            $output->writeln('<error>' . $result->failureReason . '</error>');
        }

        return match ($result->status) {
            WorkflowStatus::Completed => Command::SUCCESS,
            WorkflowStatus::Failed => Command::FAILURE,
            WorkflowStatus::Escalated => 2,
        };
    }

    /**
     * @return array<string, string>
     */
    private static function environment(): array
    {
        $env = [];
        foreach (['OPENROUTER_API_KEY', 'INDABA_CODEX_CMD', 'INDABA_ANTIGRAVITY_CMD'] as $key) {
            $value = getenv($key);
            if (is_string($value)) {
                $env[$key] = $value;
            }
        }

        return $env;
    }
}
