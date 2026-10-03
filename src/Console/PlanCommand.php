<?php

declare(strict_types=1);

namespace Indaba\Console;

use Indaba\Core\Exception\IndabaException;
use Indaba\Workflow\Graph\DagBuilder;
use Indaba\Workflow\Parser\WorkflowParser;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputArgument;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(name: 'plan', description: 'Show the execution order of a workflow without running it')]
final class PlanCommand extends Command
{
    protected function configure(): void
    {
        $this->addArgument('file', InputArgument::OPTIONAL, 'Workflow file', '.indaba/workflow.ai.yml');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $file = $input->getArgument('file');
        \assert(is_string($file));

        try {
            $workflow = (new WorkflowParser())->parseFile($file);
            $order = (new DagBuilder())->sort($workflow);
        } catch (IndabaException $e) {
            $output->writeln('<error>' . $e->getMessage() . '</error>');

            return Command::FAILURE;
        }

        foreach ($order as $n => $step) {
            $who = $step->isShell() ? 'shell: ' . implode(' && ', $step->commands) : ($step->role ?? $step->runner ?? '?');
            $extra = [];
            if ($step->dependsOn !== []) {
                $extra[] = 'after ' . implode(', ', $step->dependsOn);
            }
            if ($step->isConsensus()) {
                $extra[] = 'consensus with ' . implode(', ', $step->consensusWith);
            }
            $output->writeln(sprintf('%d. <info>%s</info> [%s]%s', $n + 1, $step->id, $who, $extra === [] ? '' : ' (' . implode('; ', $extra) . ')'));
        }

        return Command::SUCCESS;
    }
}
