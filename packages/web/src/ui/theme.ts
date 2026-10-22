/**
 * The theme: the system's, or one the person picked. The choice is a convenience for this browser only, so it is kept
 * in `localStorage` when that works and forgotten when it does not (a private window, blocked storage).
 */
export type Theme = 'system' | 'light' | 'dark';

export const THEMES: readonly Theme[] = ['system', 'light', 'dark'];

const KEY = 'indaba.theme';

export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readTheme(store: Store | undefined): Theme {
  try {
    const value = store?.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function saveTheme(store: Store | undefined, theme: Theme): void {
  try {
    store?.setItem(KEY, theme);
  } catch {
    // Storage is blocked: the choice lasts until the page is closed.
  }
}

/** Puts the theme on the root element, where the stylesheet reads it; `system` removes it. */
export function applyTheme(root: { readonly dataset: DOMStringMap }, theme: Theme): void {
  if (theme === 'system') {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = theme;
  }
}
