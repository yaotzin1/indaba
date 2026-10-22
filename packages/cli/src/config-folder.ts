import { posix, win32 } from 'node:path';

/**
 * The user's configuration folder, where `indaba ui` keeps what a person confirmed (specs/web-app-actions, C-03): outside
 * every project, so a project cannot arrive with its own confirmations. `%APPDATA%` on Windows, `~/Library/Application
 * Support` on macOS, `$XDG_CONFIG_HOME` or `~/.config` elsewhere. Everything it reads is passed in.
 */
export function userConfigFolder(
  platform: NodeJS.Platform,
  /** `%APPDATA%` and `$XDG_CONFIG_HOME`, as the environment gives them. */
  variables: { readonly appData: string | undefined; readonly xdgConfigHome: string | undefined },
  home: string,
): string {
  // The rules of the platform asked about, not of the one running: a test on Linux checks the Windows answer.
  if (platform === 'win32') {
    const appData = variables.appData;
    return appData !== undefined && win32.isAbsolute(appData)
      ? appData
      : win32.join(home, 'AppData', 'Roaming');
  }
  if (platform === 'darwin') {
    return posix.join(home, 'Library', 'Application Support');
  }
  const xdg = variables.xdgConfigHome;
  return xdg !== undefined && posix.isAbsolute(xdg) ? xdg : posix.join(home, '.config');
}
