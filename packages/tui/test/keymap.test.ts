import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildHomeScreen } from '../src/home-screen.js';
import { initialHome } from '../src/home-state.js';
import { KEYS, shippedKeys } from '../src/keymap.js';
import { computeLayout } from '../src/layout.js';

describe('the key table of Home', () => {
  it('hides a key whose option was not wired, and shows it when it was', () => {
    expect(shippedKeys({ openRun: false }).map((k) => k.id)).not.toContain('open');
    expect(shippedKeys({ openRun: true }).map((k) => k.id)).toContain('open');
    expect(shippedKeys({ openRun: true })).toHaveLength(KEYS.length);
  });

  it('is plain ASCII, so it reads on any terminal', () => {
    for (const key of KEYS) {
      expect(`${key.keys}${key.label}`).toMatch(/^[\x20-\x7e]+$/);
    }
  });

  it('has the same keys in the ? overlay as in the table', () => {
    const layout = computeLayout(100, 30);
    const screen = buildHomeScreen({ ...initialHome(), help: true }, layout, { ascii: true, canOpen: true });
    const shown = screen.detail.map((r) => r.text);
    for (const key of shippedKeys({ openRun: true })) {
      expect(shown.some((line) => line.startsWith(key.keys) && line.includes(key.label))).toBe(true);
    }
    const without = buildHomeScreen({ ...initialHome(), help: true }, layout, {
      ascii: true,
      canOpen: false,
    });
    expect(without.detail.map((r) => r.text).join('\n')).not.toContain('open the run');
  });

  it('is the table the documentation prints', () => {
    const docs = readFileSync(new URL('../../../docs/getting-started.md', import.meta.url), 'utf8');
    for (const key of KEYS) {
      expect(docs).toContain(`\`${key.keys}\``);
      expect(docs).toContain(key.label);
    }
  });
});
