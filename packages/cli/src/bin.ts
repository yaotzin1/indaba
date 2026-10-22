#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { terminalAdjudicator } from './arbiter-prompt.js';
import { EarlyExit } from './exit.js';
import { main } from './main.js';
import { createBrowserOpener } from './open-browser.js';
import { terminalAuthChooser } from './prompt.js';
import { CANCEL_MESSAGE, createRunStarter, treeKiller } from './run-child.js';

const controller = new AbortController();
const earlyExit = new EarlyExit();

// The first SIGINT cancels the run so teardown (worktree removal) happens. A second one gives up on the run, but
// first gives the log a bounded moment to write its last records; a third leaves at once.
process.on('SIGINT', () => {
  if (earlyExit.started) {
    process.exit(130);
  }
  if (controller.signal.aborted) {
    void earlyExit.run().then(() => process.exit(130));
    return;
  }
  controller.abort();
});

// A run started by `run --tui` is asked to stop through its channel: a signal is no gentle request on Windows.
if (process.send !== undefined) {
  process.on('message', (message) => {
    if (message === CANCEL_MESSAGE) {
      controller.abort();
    }
  });
}

const code = await main(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
  cwd: process.cwd(),
  signal: controller.signal,
  exitHooks: earlyExit,
  startRun: createRunStarter(
    process.execPath,
    fileURLToPath(import.meta.url),
    treeKiller(process.platform, {
      spawn: (command, args, options) => spawn(command, [...args], options),
      kill: (pid, signal) => process.kill(pid, signal),
    }),
  ),
  openBrowser: createBrowserOpener(process.platform),
  // Only a person at a terminal can be asked how an agent should log in, or to rule on a debate.
  ...(process.stdin.isTTY && process.stdout.isTTY
    ? {
        chooseAuthMethod: terminalAuthChooser(process.stdin, process.stdout),
        humanAdjudicator: terminalAdjudicator(process.stdin, process.stdout),
        terminal: { stdin: process.stdin, stdout: process.stdout },
      }
    : {}),
});
process.exitCode = controller.signal.aborted ? 130 : code;
// The channel of a run started by `run --tui` would keep the process alive after the run ends.
if (process.connected) {
  process.disconnect();
}

// Leave when the work is done, once what was printed has been handed to the terminal or pipe. A runner
// can leave a handle open that nothing here owns (on Windows a pseudo-terminal's conhost outlives its
// child), and waiting for the event loop to drain would never end.
await Promise.all([process.stdout, process.stderr].map(flushed));
process.exit();

function flushed(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolve) => {
    stream.write('', () => resolve());
  });
}
