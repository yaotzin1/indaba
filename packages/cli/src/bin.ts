#!/usr/bin/env node
import { main } from './main.js';
import { terminalAuthChooser } from './prompt.js';

const controller = new AbortController();

// The first SIGINT cancels the run so teardown (worktree removal) happens; a second one gives up.
process.on('SIGINT', () => {
  if (controller.signal.aborted) {
    process.exit(130);
  }
  controller.abort();
});

const code = await main(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
  cwd: process.cwd(),
  signal: controller.signal,
  // Only a person at a terminal can be asked how an agent should log in.
  ...(process.stdin.isTTY && process.stdout.isTTY
    ? { chooseAuthMethod: terminalAuthChooser(process.stdin, process.stdout) }
    : {}),
});
process.exitCode = controller.signal.aborted ? 130 : code;
