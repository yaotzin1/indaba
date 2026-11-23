import { type ReadinessReport, RunResult, SpanEnded } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { parseWorkflow, readinessAttributes } from '../src/index.js';
import { FakeRunner, harness, makeGitRepo } from './support.js';

const SECRET_VALUE = ['sk', 'record', 'fake', '9876'].join('-');

const report: ReadinessReport = {
  items: [
    {
      id: 'secret:a:OPENROUTER_API_KEY',
      kind: 'secret',
      state: 'missing',
      critical: true,
      message: 'not set',
    },
    { id: 'account:-:Google', kind: 'account', state: 'needs-confirmation', critical: false, message: 'm' },
  ],
  criticalMissing: 1,
  needsConfirmation: 1,
};

describe('the readiness record of a run (AC-17)', () => {
  it('turns a report into counts and the id and state of each item', () => {
    const attributes = readinessAttributes(report);
    expect(attributes['indaba.readiness.critical_missing']).toBe(1);
    expect(attributes['indaba.readiness.needs_confirmation']).toBe(1);
    expect(JSON.parse(String(attributes['indaba.readiness.items']))).toEqual([
      ['secret:a:OPENROUTER_API_KEY', 'missing'],
      ['account:-:Google', 'needs-confirmation'],
    ]);
    expect(JSON.stringify(attributes)).not.toContain(SECRET_VALUE);
  });

  it('puts the record on the run span, as attributes and as the event indaba.readiness', async () => {
    const h = harness(await makeGitRepo(), [
      new FakeRunner('shell', () => new RunResult({ exitCode: 0, output: 'ok' })),
    ]);
    const ended: Record<string, unknown>[] = [];
    const events: string[] = [];
    h.events.addListener(SpanEnded, (e) => {
      if (e.span.name.startsWith('indaba.task')) {
        ended.push({ ...e.span.attributes });
        events.push(...e.span.events.map((event) => event.name));
      }
    });
    const workflow = parseWorkflow(`version: "1.0"
name: w
steps:
  - id: a
    runner: shell
    commands: ["echo hi"]
`);
    await h.engine.run(workflow, { readiness: report });
    expect(ended[0]).toMatchObject({
      'indaba.readiness.critical_missing': 1,
      'indaba.readiness.needs_confirmation': 1,
    });
    expect(events).toContain('indaba.readiness');
  });

  it('records nothing when no report is given', async () => {
    const h = harness(await makeGitRepo(), [
      new FakeRunner('shell', () => new RunResult({ exitCode: 0, output: 'ok' })),
    ]);
    const ended: Record<string, unknown>[] = [];
    h.events.addListener(SpanEnded, (e) => {
      if (e.span.name.startsWith('indaba.task')) {
        ended.push({ ...e.span.attributes });
      }
    });
    await h.engine.run(
      parseWorkflow(`version: "1.0"
name: w
steps:
  - id: a
    runner: shell
    commands: ["echo hi"]
`),
    );
    expect(Object.keys(ended[0] ?? {}).some((key) => key.startsWith('indaba.readiness'))).toBe(false);
  });
});
