import { describe, expect, it } from 'vitest';
import { StepPool } from '../src/engine/step-pool.js';

// specs/parallel-steps, T-05: the pool holds the steps that run now, each with an abort controller chained to the run's.

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('StepPool', () => {
  it('starts empty', () => {
    const pool = new StepPool<string>();
    expect(pool.size).toBe(0);
    expect(pool.ids()).toEqual([]);
    expect(pool.has('a')).toBe(false);
  });

  it('holds a started step until it settles, and reports its value', async () => {
    const pool = new StepPool<string>();
    const a = deferred<string>();
    pool.start('a', () => a.promise);
    expect(pool.size).toBe(1);
    expect(pool.has('a')).toBe(true);
    a.resolve('done');
    expect(await pool.next()).toEqual({ id: 'a', result: { ok: true, value: 'done' } });
    expect(pool.size).toBe(0);
  });

  it('settles steps in the order they finish, not the order they started', async () => {
    const pool = new StepPool<string>();
    const a = deferred<string>();
    const b = deferred<string>();
    pool.start('a', () => a.promise);
    pool.start('b', () => b.promise);
    expect(pool.ids()).toEqual(['a', 'b']);
    b.resolve('second-started, first-done');
    expect((await pool.next()).id).toBe('b');
    expect(pool.ids()).toEqual(['a']);
    a.resolve('late');
    expect((await pool.next()).id).toBe('a');
  });

  it('reports a rejection as a result and keeps the other steps running', async () => {
    const pool = new StepPool<string>();
    const a = deferred<string>();
    const b = deferred<string>();
    pool.start('a', () => a.promise);
    pool.start('b', () => b.promise);
    const boom = new Error('boom');
    a.reject(boom);
    expect(await pool.next()).toEqual({ id: 'a', result: { ok: false, error: boom } });
    expect(pool.has('b')).toBe(true);
    b.resolve('ok');
    expect((await pool.next()).id).toBe('b');
  });

  it('refuses to start a step that is already running', () => {
    const pool = new StepPool<string>();
    pool.start('a', () => deferred<string>().promise);
    expect(() => pool.start('a', () => deferred<string>().promise)).toThrow(/already running/);
  });

  it('refuses to wait when nothing runs', async () => {
    await expect(new StepPool<string>().next()).rejects.toThrow(/nothing is running/i);
  });

  it('gives each step an abort signal of its own', async () => {
    const pool = new StepPool<string>();
    const seen: AbortSignal[] = [];
    const a = deferred<string>();
    const b = deferred<string>();
    pool.start('a', (signal) => {
      seen.push(signal);
      return a.promise;
    });
    pool.start('b', (signal) => {
      seen.push(signal);
      return b.promise;
    });
    pool.abort('a');
    expect(seen[0]?.aborted).toBe(true);
    expect(seen[1]?.aborted).toBe(false);
    a.resolve('x');
    b.resolve('y');
    await pool.next();
    await pool.next();
  });

  it('aborts every step when the run is aborted', async () => {
    const run = new AbortController();
    const pool = new StepPool<string>(run.signal);
    const seen: AbortSignal[] = [];
    const a = deferred<string>();
    const b = deferred<string>();
    pool.start('a', (s) => {
      seen.push(s);
      return a.promise;
    });
    pool.start('b', (s) => {
      seen.push(s);
      return b.promise;
    });
    run.abort();
    expect(seen.map((s) => s.aborted)).toEqual([true, true]);
    a.resolve('x');
    b.resolve('y');
    await pool.next();
    await pool.next();
  });

  it('starts a step already aborted when the run was aborted before it started', async () => {
    const run = new AbortController();
    run.abort();
    const pool = new StepPool<boolean>(run.signal);
    pool.start('a', async (signal) => signal.aborted);
    expect(await pool.next()).toEqual({ id: 'a', result: { ok: true, value: true } });
  });

  it('aborts all of its steps on abortAll and ignores an id it does not hold', async () => {
    const pool = new StepPool<string>();
    const seen: AbortSignal[] = [];
    const a = deferred<string>();
    pool.start('a', (s) => {
      seen.push(s);
      return a.promise;
    });
    pool.abort('nope');
    pool.abortAll();
    expect(seen[0]?.aborted).toBe(true);
    a.resolve('x');
    await pool.next();
  });

  it('stops listening to the run once a step has settled', async () => {
    const run = new AbortController();
    const pool = new StepPool<string>(run.signal);
    let signalOfA: AbortSignal | undefined;
    pool.start('a', async (s) => {
      signalOfA = s;
      return 'x';
    });
    await pool.next();
    run.abort();
    expect(signalOfA?.aborted).toBe(false);
  });
});
