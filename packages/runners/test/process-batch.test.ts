import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RunnerUnavailableError } from '@indaba/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NodeProcessSpawner,
  NodeStreamingProcessSpawner,
  type ProcessSpec,
  type PtyModule,
} from '../src/index.js';
import { TMP } from './support.js';

// A pid that no process owns, so a tree kill would hit nothing.
const NO_SUCH_PID = 2147483646;

const platform = Object.getOwnPropertyDescriptor(process, 'platform');

function pretendToBe(value: string): void {
  Object.defineProperty(process, 'platform', { ...platform, value });
}

afterEach(() => {
  if (platform !== undefined) {
    Object.defineProperty(process, 'platform', platform);
  }
});

/** A pseudo-terminal that only notes what it was asked to start, and ends at once. */
function recordingPty(): { readonly module: PtyModule; readonly started: string[] } {
  const started: string[] = [];
  const module: PtyModule = {
    spawn: (file) => {
      started.push(file);
      return {
        pid: NO_SUCH_PID,
        onData: () => undefined,
        onExit: (listener) => queueMicrotask(() => listener({ exitCode: 0 })),
        kill: () => undefined,
      };
    },
  };
  return { module, started };
}

function spec(program: string, overrides: Partial<ProcessSpec> = {}): ProcessSpec {
  return {
    command: [program, 'the prompt'],
    cwd: TMP,
    env: {},
    usePty: true,
    timeoutSeconds: 60,
    onData: () => undefined,
    ...overrides,
  };
}

// Windows starts these through its command interpreter, which would read the prompt as commands.
const BATCH = [
  'agent.cmd',
  'agent.bat',
  'C:\\tools\\agent.cmd',
  'C:/tools/AGENT.CMD',
  'C:\\tools\\Agent.Bat',
  // Windows drops dots and spaces at the end of a name
  'C:\\tools\\agent.cmd.',
  'C:\\tools\\agent.cmd ',
  'C:\\tools\\agent.bat. .',
  // Windows resolves `.` and `..` and drops a separator before it looks at the name
  'C:\\tools\\agent.cmd\\.',
  'C:\\tools\\agent.cmd/.',
  'C:\\tools\\agent.cmd\\x\\..',
  'C:/tools/agent.bat/x/..',
  'agent.cmd\\.',
  '\\\\server\\share\\agent.cmd\\.',
  '\\\\.\\C:\\tools\\agent.cmd\\x\\..',
  // A NUL cuts the name short on its way to the system
  'C:\\tools\\agent.cmd\0',
  'C:\\tools\\agent.cmd\0.exe',
];

const OTHERS = [
  'agent',
  'agent.exe',
  'C:\\tools\\agent.cmd.exe',
  'C:\\tools.cmd\\agent.exe',
  'C:\\tools\\agent.cmd\\..\\agent.exe',
  'C:\\tools\\cmd',
  'agent.cmdlet',
];

describe('a batch file is never started on Windows', () => {
  for (const program of BATCH) {
    it(`refuses ${JSON.stringify(program)} with and without a pseudo-terminal`, async () => {
      pretendToBe('win32');
      for (const usePty of [true, false]) {
        const pty = recordingPty();
        const spawner = new NodeProcessSpawner({ loadPty: async () => pty.module });
        const refused = spawner.run(spec(program, { usePty }));

        await expect(refused).rejects.toBeInstanceOf(RunnerUnavailableError);
        await expect(refused).rejects.toThrow(`Cannot start "${program}"`);
        await expect(refused).rejects.toThrow('native executable');
        await expect(refused).rejects.not.toThrow('the prompt');
        expect(pty.started).toEqual([]);
      }
    });
  }

  for (const program of OTHERS) {
    it(`starts ${JSON.stringify(program)}`, async () => {
      pretendToBe('win32');
      const pty = recordingPty();
      const spawner = new NodeProcessSpawner({ loadPty: async () => pty.module });
      await expect(spawner.run(spec(program))).resolves.toMatchObject({ exitCode: 0, mode: 'pty' });
      expect(pty.started).toEqual([program]);
    });
  }

  it('leaves the names alone on another system, where they mean nothing', async () => {
    pretendToBe('linux');
    const pty = recordingPty();
    const spawner = new NodeProcessSpawner({ loadPty: async () => pty.module });
    await expect(spawner.run(spec('agent.cmd'))).resolves.toMatchObject({ exitCode: 0 });
    expect(pty.started).toEqual(['agent.cmd']);
  });

  // The real thing, with whatever pseudo-terminal this machine has: the file must not run at all.
  it.runIf(process.platform === 'win32')('does not run a real batch file', async () => {
    const program = join(TMP, 'agent.cmd');
    const marker = join(TMP, 'agent-ran.txt');
    writeFileSync(program, '@echo off\r\necho ran>agent-ran.txt\r\n');

    // The message is the refusal's own: without a pseudo-terminal, a failure to start would say something else.
    for (const spelling of [program, `${program}\\.`]) {
      await expect(new NodeProcessSpawner().run(spec(spelling, { inheritEnv: true }))).rejects.toThrow(
        'native executable',
      );
    }
    expect(existsSync(marker)).toBe(false);
  });
});

describe('the spawner of a protocol agent refuses a batch file too', () => {
  for (const program of BATCH) {
    it(`refuses ${JSON.stringify(program)}`, async () => {
      pretendToBe('win32');
      const refused = new NodeStreamingProcessSpawner().start({
        command: [program, 'acp'],
        cwd: TMP,
        env: {},
      });
      await expect(refused).rejects.toBeInstanceOf(RunnerUnavailableError);
      await expect(refused).rejects.toThrow('native executable');
    });
  }
});
