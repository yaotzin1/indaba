// @vitest-environment happy-dom
import type { LoggingSettings, LoggingSettingsResponse } from '@indaba/core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiFailure, type Client, createClient, type Failure, isSettingsResponse } from '../src/client.js';
import { draftOf, newSink, plainProblem, problemsFor, rawOf, rawSinkOf } from '../src/settings-model.js';
import { parseRoute } from '../src/ui/router.js';
import { SettingsScreen } from '../src/ui/SettingsScreen.js';

afterEach(cleanup);

const DESCRIPTIONS: LoggingSettingsResponse['descriptions'] = [
  { key: 'level', type: 'level', default: 'info', label: 'Level', help: 'How much.', secret: false },
  {
    key: 'file.folder',
    type: 'text',
    default: '.indaba/logs',
    label: 'Log folder',
    help: 'Where the files go.',
    secret: false,
  },
  {
    key: 'file.maxFileBytes',
    type: 'integer',
    default: 10,
    min: 1,
    label: 'Largest log file (bytes)',
    help: 'Size.',
    secret: false,
  },
  {
    key: 'file.maxFiles',
    type: 'integer',
    default: 10,
    min: 1,
    label: 'Log files kept',
    help: 'Count.',
    secret: false,
  },
  {
    key: 'remote.secretEnv',
    type: 'text',
    default: '',
    label: 'Credential variable',
    help: 'The name.',
    secret: true,
  },
];

const DEFAULTS: LoggingSettingsResponse['sinkDefaults'] = {
  file: { level: 'debug', folder: '.indaba/logs', maxFileBytes: 10, maxFiles: 10 },
  stderr: { level: 'warn' },
  gelf: { level: 'info', queueLength: 1000, timeoutSeconds: 5, retries: 3 },
  'http-json': { level: 'info', queueLength: 1000, timeoutSeconds: 5, retries: 3 },
};

const SETTINGS: LoggingSettings = {
  level: 'info',
  sinks: [
    { type: 'file', level: 'debug', folder: '.indaba/logs', maxFileBytes: 10, maxFiles: 10 },
    {
      type: 'gelf',
      level: 'warn',
      address: 'udp://graylog.test:12201',
      secretEnv: 'GRAYLOG_TOKEN',
      queueLength: 1000,
      timeoutSeconds: 5,
      retries: 3,
    },
  ],
};

const answer = (settings: LoggingSettings = SETTINGS, present = true): LoggingSettingsResponse => ({
  settings,
  path: '/project/indaba.config',
  present,
  variables: { GRAYLOG_TOKEN: true },
  descriptions: DESCRIPTIONS,
  sinkDefaults: DEFAULTS,
});

interface Calls {
  checks: unknown[];
  saves: unknown[];
  tests: unknown[];
}

function settingsClient(options: {
  settings?: LoggingSettingsResponse | undefined | Failure;
  check?: (logging: unknown) => readonly string[];
  save?: 'ok' | 'problems' | 'fail';
}): Client & Calls {
  const calls: Calls = { checks: [], saves: [], tests: [] };
  const never = (): never => {
    throw new Error('not in this test');
  };
  return {
    contract: async () => ({ contractVersion: '1.0.0' }),
    runs: never,
    run: never,
    followRun: never,
    followServer: never,
    stepLog: never,
    discussion: never,
    workflows: async () => undefined,
    startRun: never,
    startStatus: never,
    stopRun: never,
    async loggingSettings() {
      const s = 'settings' in options ? options.settings : answer();
      if (s !== undefined && 'kind' in s) throw new ApiFailure(s);
      return s;
    },
    async checkLoggingSettings(logging) {
      calls.checks.push(logging);
      return options.check?.(logging) ?? [];
    },
    async saveLoggingSettings(logging) {
      calls.saves.push(logging);
      if (options.save === 'fail')
        throw new ApiFailure({ kind: 'server', message: 'indaba.config could not be written.' });
      if (options.save === 'problems') {
        return {
          saved: false,
          message: 'The settings were not saved.',
          problems: ['level must be one of error, warn, info, debug'],
        };
      }
      return { saved: true, settings: answer({ ...SETTINGS, level: 'debug' }) };
    },
    async testLogSink(sink) {
      calls.tests.push(sink);
      return { ok: true, text: 'The collector took the test record.' };
    },
    get checks() {
      return calls.checks;
    },
    get saves() {
      return calls.saves;
    },
    get tests() {
      return calls.tests;
    },
  };
}

function show(client: Client, onFatal: (failure: Failure) => void = () => undefined) {
  return render(h(SettingsScreen, { client, onFatal, checkDelayMs: 0 }));
}

describe('the settings model', () => {
  it('turns settings into a draft and back into the mapping a file holds', () => {
    const draft = draftOf(SETTINGS);
    expect(draft.sinks[1]?.values).toMatchObject({
      address: 'udp://graylog.test:12201',
      queueLength: '1000',
    });
    expect(rawOf(draft)).toEqual({
      level: 'info',
      sinks: [
        { type: 'file', level: 'debug', folder: '.indaba/logs', maxFileBytes: 10, maxFiles: 10 },
        {
          type: 'gelf',
          address: 'udp://graylog.test:12201',
          level: 'warn',
          secretEnv: 'GRAYLOG_TOKEN',
          queueLength: 1000,
          timeoutSeconds: 5,
          retries: 3,
        },
      ],
    });
  });

  it('keeps a number being typed as text so the server can name it, and leaves out an empty secret', () => {
    const sink = {
      type: 'http-json' as const,
      values: { address: ' https://x.test ', retries: 'three', secretEnv: '' },
    };
    expect(rawSinkOf(sink)).toEqual({ type: 'http-json', address: 'https://x.test', retries: 'three' });
    expect(newSink('stderr', DEFAULTS)).toEqual({ type: 'stderr', values: { level: 'warn' } });
    expect(newSink('gelf', DEFAULTS).values).toMatchObject({ address: '', retries: '3' });
  });

  it('places each problem on its field, and reads it without the key', () => {
    const problems = [
      'level must be one',
      'sinks[1].address must be an address',
      'sinks[1] must be a mapping',
    ];
    expect(problemsFor(problems, {})).toEqual(['level must be one']);
    expect(problemsFor(problems, { sink: 1, key: 'address' })).toEqual([
      'sinks[1].address must be an address',
    ]);
    expect(problemsFor(problems, { sink: 1 })).toEqual(['sinks[1] must be a mapping']);
    expect(plainProblem('sinks[1].address must be an address')).toBe('Must be an address');
  });

  it('routes /settings', () => {
    expect(parseRoute('/settings', '')).toEqual({ name: 'settings' });
  });
});

describe('the Settings screen', () => {
  it('shows each value with its default and the file it lives in', async () => {
    show(settingsClient({}));
    await screen.findByText('Saved in /project/indaba.config');
    const folder = screen.getByLabelText('Log folder');
    expect((folder as HTMLInputElement).value).toBe('.indaba/logs');
    const gelf = screen.getByRole('region', { name: 'GELF collector (Graylog)' });
    expect(within(gelf).getByText('set on the server')).toBeTruthy();
    expect(within(gelf).getAllByText('default info').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
  });

  it('says when nothing is saved yet, and when the server offers no settings', async () => {
    show(settingsClient({ settings: answer(SETTINGS, false) }));
    await screen.findByText('/project/indaba.config does not exist yet: every value below is a default.');
    cleanup();
    show(settingsClient({ settings: undefined }));
    await screen.findByText(/This server does not offer the settings/);
  });

  it('checks a change with the server and shows the problem on its field', async () => {
    const client = settingsClient({
      check: (logging) =>
        JSON.stringify(logging).includes('"maxFiles":"ten"')
          ? ['sinks[0].maxFiles must be a whole number of at least 1']
          : [],
    });
    show(client);
    const kept = await screen.findByLabelText('Log files kept');
    fireEvent.change(kept, { target: { value: 'ten' } });
    await screen.findByText('Must be a whole number of at least 1');
    expect(kept.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('One problem keeps this from being saved')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Put back the default of Log files kept' }));
    await waitFor(() => expect(screen.queryByText('Must be a whole number of at least 1')).toBeNull());
  });

  it('saves the draft, and starts from what the server now holds', async () => {
    const client = settingsClient({});
    show(client);
    const level = await screen.findByLabelText('Level of the whole log');
    fireEvent.change(level, { target: { value: 'debug' } });
    await screen.findByText('Not saved yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved. The next command uses these settings.');
    expect(client.saves).toEqual([expect.objectContaining({ level: 'debug' })]);
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
  });

  it('shows the problems a save was refused for, and a server that could not write', async () => {
    const refused = settingsClient({ save: 'problems' });
    show(refused);
    fireEvent.change(await screen.findByLabelText('Level of the whole log'), { target: { value: 'warn' } });
    await screen.findByText('Not saved yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Must be one of error, warn, info, debug');
    cleanup();
    show(settingsClient({ save: 'fail' }));
    fireEvent.change(await screen.findByLabelText('Level of the whole log'), { target: { value: 'warn' } });
    await screen.findByText('Not saved yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('indaba.config could not be written.');
  });

  it('adds and removes a sink, and undoes changes', async () => {
    show(settingsClient({}));
    fireEvent.click(await screen.findByRole('button', { name: 'Add: HTTP JSON collector' }));
    expect(screen.getByRole('region', { name: 'HTTP JSON collector' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Log files' }));
    expect(screen.queryByRole('region', { name: 'Log files' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add: Log files' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo changes' }));
    expect(screen.getByRole('region', { name: 'Log files' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'HTTP JSON collector' })).toBeNull();
  });

  it('sends a test record through one sink and says how it went', async () => {
    const client = settingsClient({});
    show(client);
    const gelf = await screen.findByRole('region', { name: 'GELF collector (Graylog)' });
    fireEvent.click(within(gelf).getByRole('button', { name: 'Send a test record' }));
    await within(gelf).findByText('The collector took the test record.');
    expect(client.tests).toEqual([
      expect.objectContaining({ type: 'gelf', address: 'udp://graylog.test:12201' }),
    ]);
  });

  it('says a typed variable name is checked when saved, not whether it is set', async () => {
    show(settingsClient({}));
    const gelf = await screen.findByRole('region', { name: 'GELF collector (Graylog)' });
    fireEvent.change(within(gelf).getByLabelText('Credential variable'), {
      target: { value: 'OTHER_TOKEN' },
    });
    expect(within(gelf).getByText('checked when saved')).toBeTruthy();
  });

  it('hands a lost token to the page, and shows any other failure in place', async () => {
    const fatal: Failure[] = [];
    show(settingsClient({ settings: { kind: 'unauthorized' } }), (f) => fatal.push(f));
    await waitFor(() => expect(fatal).toEqual([{ kind: 'unauthorized' }]));
  });
});

describe('the settings calls of the client', () => {
  const settingsBody = answer();
  function fakeFetch(handler: (url: string, init: RequestInit) => Response) {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, init: init ?? {} });
      return handler(url, init ?? {});
    }) as typeof fetch;
    return { fetchFn, seen };
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('reads the settings, and none from a server that does not offer them', async () => {
    const { fetchFn } = fakeFetch(() => json(settingsBody));
    expect(await createClient({ token: 't', fetch: fetchFn }).loggingSettings()).toEqual(settingsBody);
    const missing = fakeFetch(() => json({ code: 'settings_unavailable', message: 'no' }, 404));
    expect(await createClient({ token: 't', fetch: missing.fetchFn }).loggingSettings()).toBeUndefined();
    const broken = fakeFetch(() => json({ settings: 3 }));
    await expect(createClient({ token: 't', fetch: broken.fetchFn }).loggingSettings()).rejects.toThrow(
      ApiFailure,
    );
    expect(isSettingsResponse(settingsBody)).toBe(true);
  });

  it('saves with the token as JSON, and returns the problems of a refusal', async () => {
    const { fetchFn, seen } = fakeFetch((url) =>
      url.endsWith('/check')
        ? json({ problems: ['level x'] })
        : url.endsWith('/test')
          ? json({ code: 'invalid_settings', message: 'no', problems: ['address must be'] }, 422)
          : json({ code: 'invalid_settings', message: 'Not saved.', problems: ['level x', 3] }, 422),
    );
    const client = createClient({ token: 'tok', fetch: fetchFn });
    expect(await client.checkLoggingSettings({ level: 'x' })).toEqual(['level x']);
    expect(await client.saveLoggingSettings({ level: 'x' })).toEqual({
      saved: false,
      message: 'Not saved.',
      problems: ['level x'],
    });
    expect(await client.testLogSink({ type: 'gelf' })).toEqual({ ok: false, text: 'address must be' });
    expect(seen[1]?.init.method).toBe('PUT');
    expect(seen[1]?.init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(seen[1]?.init.body))).toEqual({ logging: { level: 'x' } });
  });

  it('returns what a save gave, and fails on a server that cannot be read or reached', async () => {
    const ok = fakeFetch(() => json(settingsBody));
    expect(await createClient({ token: 't', fetch: ok.fetchFn }).saveLoggingSettings({})).toEqual({
      saved: true,
      settings: settingsBody,
    });
    const odd = fakeFetch(() => json({ nothing: true }));
    await expect(createClient({ token: 't', fetch: odd.fetchFn }).saveLoggingSettings({})).rejects.toThrow(
      ApiFailure,
    );
    expect(await createClient({ token: 't', fetch: odd.fetchFn }).testLogSink({})).toEqual({
      ok: false,
      text: 'The server sent an answer this page cannot read.',
    });
    const text = fakeFetch(() => new Response('not json', { status: 200 }));
    await expect(createClient({ token: 't', fetch: text.fetchFn }).checkLoggingSettings({})).rejects.toThrow(
      ApiFailure,
    );
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    await expect(createClient({ token: 't', fetch: down }).saveLoggingSettings({})).rejects.toThrow(
      ApiFailure,
    );
    const conflict = fakeFetch(() => json({ code: 'not_saved', message: 'could not be written' }, 409));
    await expect(
      createClient({ token: 't', fetch: conflict.fetchFn }).saveLoggingSettings({}),
    ).rejects.toThrow(ApiFailure);
  });
});
