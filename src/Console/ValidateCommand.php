<?php

declare(strict_types=1);

namespace Indaba\Console;

use Indaba\Core\Exception\WorkflowValidationException;
use Indaba\Workflow\Parser\WorkflowParser;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputArgument;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(name: 'validate', description: 'Validate a workflow file')]
final class ValidateCommand extends Command
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
        } catch (WorkflowValidationException $e) {
            $output->writeln('<error>' . $file . ' is invalid:</error>');
            foreach ($e->errors as $error) {
                $output->writeln(' - ' . $error);
            }

            return Command::FAILURE;
        }

        $output->writeln(sprintf('<info>%s</info> is valid (%d steps, %d roles).', $workflow->name, count($workflow->steps), count($workflow->roles)));

        return Command::SUCCESS;
    }
}
