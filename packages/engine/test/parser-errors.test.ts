import { McpPolicy, WorkflowValidationError } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { parseWorkflow } from '../src/index.js';

function problemsOf(yaml: string): string {
  try {
    parseWorkflow(yaml);
  } catch (error) {
    if (error instanceof WorkflowValidationError) {
      return error.problems.join('\n');
    }
    throw error;
  }
  throw new Error('Expected a validation error.');
}

const HEAD = 'version: "1.0"\nname: t\nroles:\n  a: {runner: shell}\n';
const ONE = `${HEAD}steps:\n  - {id: x, role: a}\n`;

const CASES: [string, string, string][] = [
  [
    'roles that are not a mapping',
    'version: "1.0"\nname: t\nroles: [a]\nsteps: []\n',
    'roles must be a mapping',
  ],
  [
    'a role entry that is not a mapping',
    'version: "1.0"\nname: t\nroles:\n  a: 5\nsteps: []\n',
    'roles.a must be a mapping',
  ],
  ['steps that are not a list', `${HEAD}steps: nope\n`, 'steps must be a list'],
  ['a step that is not a mapping', `${HEAD}steps: [5]\n`, 'steps[0] must be a mapping'],
  [
    'depends_on that is not a list',
    `${HEAD}steps:\n  - {id: x, role: a, depends_on: y}\n`,
    'depends_on must be a list of strings',
  ],
  [
    'a depends_on item that is not a string',
    `${HEAD}steps:\n  - {id: x, role: a, depends_on: [1]}\n`,
    'depends_on[0] must be a string',
  ],
  [
    'an integer field holding text',
    `${HEAD}steps:\n  - {id: x, role: a, on_failure: {action: retry_step, target: x, max_retries: many}}\n`,
    'max_retries must be an integer',
  ],
  [
    'an env value that is not a string',
    `${HEAD}mcp_servers:\n  s: {command: run, env: {K: 5}}\nsteps:\n  - {id: x, role: a}\n`,
    'mcp_servers.s.env.K must be a string',
  ],
  [
    'an unknown artifact inside a list',
    `${HEAD}steps:\n  - {id: x, role: a, outputs: ['\${{ artifacts.nope }}']}\n`,
    'unknown artifact "nope"',
  ],
  [
    'an unsupported isolation',
    `${HEAD}steps:\n  - {id: x, role: a, isolation: vm}\n`,
    'isolation "vm" is not supported',
  ],
  [
    'an unsupported decision type',
    `${HEAD}steps:\n  - {id: x, role: a, decision_type: coin}\n`,
    'decision_type "coin" is not supported',
  ],
  [
    'an invalid step policy',
    `${HEAD}steps:\n  - {id: x, role: a, mcp_policy: maybe}\n`,
    'mcp_policy "maybe" must be',
  ],
  [
    'an invalid default policy',
    `${HEAD}defaults: {mcp_policy: maybe}\nsteps:\n  - {id: x, role: a}\n`,
    'mcp_policy "maybe" must be',
  ],
  [
    'an unsupported failure action',
    `${HEAD}steps:\n  - {id: x, role: a, on_failure: {action: panic}}\n`,
    'action "panic" is not supported',
  ],
  [
    'a failure block without an action',
    `${HEAD}steps:\n  - {id: x, role: a, on_failure: {target: x}}\n`,
    'action is required',
  ],
  ['no steps', `${HEAD}steps: []\n`, 'steps must contain at least one step'],
  ['a step id with a space', `${HEAD}steps:\n  - {id: "a b", role: a}\n`, 'must match [A-Za-z0-9_-]+'],
  ['a self dependency', `${HEAD}steps:\n  - {id: x, role: a, depends_on: [x]}\n`, 'x" depends on itself'],
  ['neither role nor runner', `${HEAD}steps:\n  - {id: x}\n`, 'needs a role or a runner'],
  [
    'commands on an agent step',
    `${HEAD}steps:\n  - {id: x, role: a, commands: [ls]}\n`,
    'declares commands but is not a shell step',
  ],
  [
    'consensus without a role',
    `${HEAD}steps:\n  - {id: x, runner: shell, commands: [ls], consensus_with: [a]}\n`,
    'needs a role to take part in a consensus',
  ],
  [
    'consensus with an unknown role',
    `${HEAD}steps:\n  - {id: x, role: a, consensus_with: [ghost]}\n`,
    'consensus_with unknown role "ghost"',
  ],
  [
    'a retry without a target',
    `${HEAD}steps:\n  - {id: x, role: a, on_failure: {action: retry_step, max_retries: 1}}\n`,
    'on_failure.target "" is not a step',
  ],
  [
    'a retry to an unknown step',
    `${HEAD}steps:\n  - {id: x, role: a, on_failure: {action: retry_step, target: z, max_retries: 1}}\n`,
    'on_failure.target "z" is not a step',
  ],
  [
    'an unknown step MCP server',
    `${HEAD}steps:\n  - {id: x, role: a, mcp: [ghost]}\n`,
    'uses unknown MCP server "ghost"',
  ],
  [
    'an unknown role MCP server',
    'version: "1.0"\nname: t\nroles:\n  a: {runner: shell, mcp: [ghost]}\nsteps:\n  - {id: x, role: a}\n',
    'role "a" uses unknown MCP server "ghost"',
  ],
  [
    'an MCP server name with a space',
    `${HEAD}mcp_servers:\n  "a b": {command: run}\nsteps:\n  - {id: x, role: a}\n`,
    'name must match',
  ],
  [
    'an MCP server with neither command nor url',
    `${HEAD}mcp_servers:\n  s: {}\nsteps:\n  - {id: x, role: a}\n`,
    'needs exactly one of "command" or "url"',
  ],
  [
    'an MCP server with both command and url',
    `${HEAD}mcp_servers:\n  s: {command: run, url: "https://example.invalid/mcp"}\nsteps:\n  - {id: x, role: a}\n`,
    'needs exactly one of "command" or "url"',
  ],
  [
    'an MCP url that is not http',
    `${HEAD}mcp_servers:\n  s: {url: "ftp://example.invalid"}\nsteps:\n  - {id: x, role: a}\n`,
    'url must be an http or https URL',
  ],
  [
    'args on a url server',
    `${HEAD}mcp_servers:\n  s: {url: "https://example.invalid/mcp", args: [a]}\nsteps:\n  - {id: x, role: a}\n`,
    'only apply to a "command" server',
  ],
];

describe('parser and validator error paths', () => {
  it.each(CASES)('reports %s', (_name, yaml, fragment) => {
    expect(problemsOf(yaml)).toContain(fragment);
  });

  it('accepts an optional default policy and a null optional field', () => {
    const wf = parseWorkflow(
      `${ONE.replace('{id: x, role: a}', '{id: x, role: a, goal: null}')}`.replace(
        'steps:',
        'defaults: {mcp_policy: optional}\nsteps:',
      ),
    );

    expect(wf.defaultMcpPolicy).toBe(McpPolicy.Optional);
    expect(wf.steps[0]?.goal).toBe('');
  });

  it('keeps a role model and a failure target when given', () => {
    const wf = parseWorkflow(
      'version: "1.0"\nname: t\nroles:\n  a: {runner: shell, model: m1}\nsteps:\n  - {id: x, role: a, on_failure: {action: retry_step, target: x, max_retries: 2}}\n',
    );

    expect(wf.roles.a?.model).toBe('m1');
    expect(wf.steps[0]?.onFailure?.target).toBe('x');
  });
});
