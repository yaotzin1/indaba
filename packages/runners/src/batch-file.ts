import { win32 } from 'node:path';
import { RunnerUnavailableError } from '@indaba/core';

const BATCH_EXTENSION = /\.(?:bat|cmd)$/i;
/** What Windows drops from the end of a path. */
const TRAILING = /[\\/. ]+$/;

/**
 * Windows runs a `.cmd` or `.bat` file through its command interpreter, which reads the arguments as commands, and an
 * argument here can be a prompt that quotes what a model wrote. So such a program is never started. The name is read as
 * Windows reads it: `.` and `..` segments resolved, trailing separators, dots and spaces dropped. A NUL cuts a name
 * short on its way to the system, so a name that holds one is refused too.
 */
export function refuseBatchFile(file: string): void {
  if (process.platform !== 'win32') {
    return;
  }
  if (file.includes('\0') || BATCH_EXTENSION.test(win32.normalize(file).replace(TRAILING, ''))) {
    throw new RunnerUnavailableError(
      `Cannot start "${file}": Windows runs a .cmd or .bat file through a command interpreter, which would read the arguments as commands. Use a native executable.`,
    );
  }
}
