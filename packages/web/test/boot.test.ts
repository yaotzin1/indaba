// @vitest-environment happy-dom
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectionOf } from '../src/ui/RunGraph.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('starting the page', () => {
  it('takes the token out of the address, sends it as a header, and renders', async () => {
    document.body.append(Object.assign(document.createElement('div'), { id: 'root' }));
    window.history.replaceState(null, '', '/#token=boot-token-0123456789');
    const calls: { url: string; auth: string | undefined }[] = [];
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url: String(input), auth: headers.Authorization });
      const url = String(input);
      if (url.endsWith('/contract')) return new Response(JSON.stringify({ contractVersion: '1.0.0' }));
      if (url.endsWith('/runs')) return new Response(JSON.stringify({ runs: [] }));
      return new Response('', { status: 503 });
    });

    await import('../src/main.js');

    expect(window.location.hash).toBe('');
    await screen.findByText('No runs yet');
    await waitFor(() => expect(calls.some((c) => c.url === '/api/v1/runs')).toBe(true));
    expect(calls.every((c) => c.auth === 'Bearer boot-token-0123456789')).toBe(true);
    expect(calls.every((c) => !c.url.includes('boot-token'))).toBe(true);
  });

  it('does nothing in a document without a root', async () => {
    const { boot } = await import('../src/main.js');
    expect(() => boot(window)).not.toThrow();
  });

  it('starts without storage when the browser blocks it', async () => {
    document.body.append(Object.assign(document.createElement('div'), { id: 'root' }));
    window.history.replaceState(null, '', '/');
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { boot } = await import('../src/main.js');
    boot(window);
    expect((await screen.findAllByText('This page needs its address')).length).toBeGreaterThan(0);
  });
});

describe('choosing a step on the canvas', () => {
  it('takes the step a person selected and ignores everything else', () => {
    expect(
      selectionOf([
        { type: 'select', id: 'a', selected: false },
        { type: 'select', id: 'b', selected: true },
      ]),
    ).toBe('b');
    expect(selectionOf([{ type: 'remove', id: 'a' }])).toBeUndefined();
    expect(selectionOf([])).toBeUndefined();
  });
});
