import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { terminalAuthChooser } from '../src/prompt.js';

const METHODS = [
  { id: 'oauth-personal', name: 'Log in with Google', description: 'Use your Google account' },
  { id: 'gemini-api-key', name: 'Gemini API key' },
];

async function ask(
  answers: string[],
  methods = METHODS,
  agent = 'Gemini CLI',
): Promise<{ chosen: string | undefined; shown: string }> {
  const input = new PassThrough();
  const output = new PassThrough();
  let shown = '';
  output.on('data', (chunk: Buffer) => {
    shown += chunk.toString('utf8');
  });
  const pending = terminalAuthChooser(input, output)(agent, methods);
  for (const answer of answers) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    input.write(`${answer}\n`);
  }
  if (answers.length === 0) {
    input.end();
  }
  const chosen = await pending;
  return { chosen, shown };
}

describe('terminalAuthChooser', () => {
  it('lists the methods with their ids and returns the one chosen by number', async () => {
    const { chosen, shown } = await ask(['2']);
    expect(chosen).toBe('gemini-api-key');
    expect(shown).toContain('Gemini CLI offers these ways to log in');
    expect(shown).toContain('1) Log in with Google - Use your Google account  [oauth-personal]');
    expect(shown).toContain('2) Gemini API key  [gemini-api-key]');
    expect(shown).toContain('auth: <id>');
  });

  it('returns the first method for 1', async () => {
    expect((await ask(['1'])).chosen).toBe('oauth-personal');
  });

  it.each([['0'], [''], ['  ']])('goes on without logging in for %j', async (answer) => {
    expect((await ask([answer])).chosen).toBeUndefined();
  });

  it('asks again after something that is not a choice', async () => {
    const { chosen, shown } = await ask(['9', 'abc', '1']);
    expect(chosen).toBe('oauth-personal');
    expect(shown.match(/not one of the choices/g)).toHaveLength(2);
  });

  it('gives up after three bad answers', async () => {
    expect((await ask(['x', 'y', 'z'])).chosen).toBeUndefined();
  });

  it('gives up when the input ends', async () => {
    expect((await ask([])).chosen).toBeUndefined();
  });

  it('shows nothing an agent sent as a control sequence', async () => {
    const { shown } = await ask(
      ['0'],
      [{ id: 'x\u001b[2Jid', name: 'Evil\u001b]0;pwned\u0007name', description: 'a\u0000b' }],
      'Agent\u001b[31m',
    );
    expect(shown).not.toContain('\u001b');
    expect(shown).not.toContain('\u0007');
    expect(shown).not.toContain('\u0000');
    expect(shown).toContain('Evil');
  });

  it('shortens a very long name', async () => {
    const { shown } = await ask(['0'], [{ id: 'a', name: 'N'.repeat(500) }]);
    expect(shown).toContain('...');
    expect(shown).not.toContain('N'.repeat(200));
  });
});
