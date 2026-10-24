import { AdjudicatorRegistry, DecisionType, FailureAction, Isolation, McpPolicy } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { catalogOf, GuardRegistry, MAX_DESCRIPTION } from '../src/index.js';

/** specs/workflow-editor, T1 to T3: descriptions and the catalog behind `indaba catalog` (AC-11, AC-13). */

const list = (entries: { name: string; description: string }[]) => ({ describe: () => entries });

describe('catalogOf', () => {
  it('lists what the registries hold, with the format’s values from its own constants', () => {
    const catalog = catalogOf({
      runners: list([{ name: 'shell', description: 'Runs commands.' }]),
      guards: GuardRegistry.withDefaults(),
      adjudicators: new AdjudicatorRegistry(),
    });
    expect(catalog.catalog).toBe(1);
    expect(catalog.runners).toEqual([{ name: 'shell', description: 'Runs commands.' }]);
    expect(catalog.guards.map((g) => g.name)).toEqual(['git_diff_empty', 'diff_within_scope']);
    expect(catalog.arbiters).toEqual([]);
    expect(catalog.values.decisionTypes).toEqual(Object.values(DecisionType));
    expect(catalog.values.isolation).toEqual(Object.values(Isolation));
    expect(catalog.values.failureActions).toEqual(Object.values(FailureAction));
    expect(catalog.values.mcpPolicies).toEqual(Object.values(McpPolicy));
    expect(catalog.voters).toEqual([]);
    expect(catalog.prompts).toEqual([]);
    expect(catalog.values.promptAdditions).toEqual([]);
  });

  it('cleans names and lines from plugins: no control sequence, one line, cut at the limit', () => {
    const esc = String.fromCharCode(27);
    const catalog = catalogOf({
      runners: list([{ name: `x${esc}[2J`, description: `a\n\n  b${esc}[31m ${'c'.repeat(400)}` }]),
      guards: list([]),
      adjudicators: list([]),
    });
    const [runner] = catalog.runners;
    expect(runner?.name).toBe('x');
    expect(runner?.description.startsWith('a b ccc')).toBe(true);
    expect(runner?.description.length).toBe(MAX_DESCRIPTION);
    expect(runner?.description.endsWith('…')).toBe(true);
  });
});

describe('describe() on the registries', () => {
  it('gives each guard and arbiter with its description, "" when none, in order', () => {
    const guards = GuardRegistry.withDefaults();
    guards.register({ type: 'plain', check: async () => ({ passed: true }) as never });
    expect(guards.describe().at(-1)).toEqual({ name: 'plain', description: '' });
    expect(guards.describe().every((g) => g.name === 'plain' || g.description !== '')).toBe(true);
    const arbiters = new AdjudicatorRegistry();
    arbiters.register('a', { description: 'First.', rule: async () => null });
    arbiters.register('b', { rule: async () => null });
    expect(arbiters.describe()).toEqual([
      { name: 'a', description: 'First.' },
      { name: 'b', description: '' },
    ]);
  });
});

describe('catalogOf: the permission map of a runner (specs/agent-permissions, AC-16, C-11)', () => {
  const entry = (permissions: unknown) =>
    list([{ name: 'r', description: 'A runner.', permissions } as never]) as never;
  const sources = (runners: never) => ({
    runners,
    guards: list([]),
    adjudicators: list([]),
  });

  it('keeps the map, and an entry without one stays as it was', () => {
    const permissions = {
      read: { mode: 'native', scope: 'guard', note: 'cli_confines_workspace_only' },
      edit: { mode: 'after', scope: 'guard', note: 'commands_not_limited' },
      full: { mode: 'none', scope: 'none', note: 'unlimited' },
    };
    expect(catalogOf(sources(entry(permissions))).runners).toEqual([
      { name: 'r', description: 'A runner.', permissions },
    ]);
    expect(catalogOf(sources(list([{ name: 'bare', description: '' }]) as never)).runners).toEqual([
      { name: 'bare', description: '' },
    ]);
  });

  it('rebuilds what a plugin sent: unknown words become unsupported, a note is one clean token', () => {
    const esc = String.fromCharCode(27);
    const catalog = catalogOf(
      sources(
        entry({
          read: { mode: 'sudo', scope: 'guard', note: 'x' },
          edit: { mode: 'native', scope: 'guard', note: `Bad Note!${esc}[2J<b>` },
          // `full` missing altogether
        }),
      ),
    );
    const permissions = catalog.runners[0]?.permissions;
    expect(permissions?.read).toEqual({ mode: 'unsupported', scope: 'none', note: 'not_offered' });
    expect(permissions?.edit).toEqual({ mode: 'native', scope: 'guard', note: 'adoteb' });
    expect(permissions?.full).toEqual({ mode: 'unsupported', scope: 'none', note: 'not_offered' });
  });

  it('cuts a very long note', () => {
    const long = { mode: 'native', scope: 'guard', note: 'a'.repeat(500) };
    const catalog = catalogOf(sources(entry({ read: long, edit: long, full: long })));
    expect(catalog.runners[0]?.permissions?.read.note.length).toBe(64);
  });
});
