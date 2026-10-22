import { type ChildProcess, type SpawnOptions, spawn } from 'node:child_process';

/** Opens an address in the person's browser. It resolves true if the opener started, false if it could not. */
export type BrowserOpener = (url: string) => Promise<boolean>;

/**
 * The program that opens an address on each system, with the address as one argument: never a shell string, because
 * `start` and `cmd` would read the address as a command. On Windows `rundll32` is the program that does what `start`
 * does.
 */
export function openerCommand(
  platform: string,
  url: string,
): { readonly file: string; readonly args: string[] } {
  if (platform === 'win32') {
    return { file: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] };
  }
  if (platform === 'darwin') {
    return { file: 'open', args: [url] };
  }
  return { file: 'xdg-open', args: [url] };
}

/** The part of `spawn` the opener uses, so a test starts no browser. */
export type Starter = (file: string, args: string[], options: SpawnOptions) => ChildProcess;

export function createBrowserOpener(platform: string, start: Starter = spawn): BrowserOpener {
  return (url) =>
    new Promise((resolve) => {
      const { file, args } = openerCommand(platform, url);
      try {
        const child = start(file, args, { stdio: 'ignore', detached: true, windowsHide: true });
        child.once('error', () => resolve(false));
        child.once('spawn', () => {
          child.unref();
          resolve(true);
        });
      } catch {
        resolve(false);
      }
    });
}
