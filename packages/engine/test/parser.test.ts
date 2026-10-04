import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  DecisionType,
  FailureAction,
  GuardResult,
  GuardType,
  Isolation,
  isConsensusStep,
  isShellStep,
  McpPolicy,
  roleOf,
  stepOf,
  WorkflowValidationError,
} from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { GuardRegistry, Interpolator, parseWorkflow, WorkflowParser } from '../src/index.js';

const examples = fileURLToPath(new URL('../../../examples/', import.meta.url));

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

describe('reference workflow', () => {
  it('parses the reference workflow', async () => {
    const wf = await new WorkflowParser().parseFile(`${examples}task-pipeline.workflow.ai.yml`);

    expect(wf.name).toBe('indaba-task-pipeline');
    expect(wf.steps).toHaveLength(4);
    expect(roleOf(wf, 'architect').model).toBe('anthropic/claude-3.7-sonnet:thinking');

    const rfc = stepOf(wf, 'rfc');
    expect(rfc.goal).toBe('Prepare technical specification in .indaba/artifacts/spec.md');
    expect(rfc.outputs).toEqual(['.indaba/artifacts/spec.md']);
    expect(rfc.guards[0]?.paths).toEqual(['src/', 'tests/']);

    expect(stepOf(wf, 'code').isolation).toBe(Isolation.GitWorktree);
    expect(stepOf(wf, 'code').inputArtifacts).toEqual(['.indaba/artifacts/spec.md']);

    const verify = stepOf(wf, 'verify');
    expect(isShellStep(verify)).toBe(true);
    expect(verify.onFailure?.action).toBe(FailureAction.RetryStep);
    expect(verify.onFailure?.maxRetries).toBe(3);

    const review = stepOf(wf, 'debate_review');
    expect(isConsensusStep(review)).toBe(true);
    expect(review.decisionType).toBe(DecisionType.Consensus);
    expect(review.consensusWith).toEqual(['architect']);
  });

  it('parses every example workflow', async () => {
    const files = (await readdir(examples)).filter((f) => f.endsWith('.workflow.ai.yml'));
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const file of files) {
      const wf = await new WorkflowParser().parseFile(`${examples}${file}`);
      expect(wf.steps.length, file).toBeGreaterThan(0);
    }
  });

  it('reports an unreadable file as a validation error', async () => {
    await expect(new WorkflowParser().parseFile(`${examples}nope.yml`)).rejects.toBeInstanceOf(
      WorkflowValidationError,
    );
  });
});

const HEAD = 'version: "1.0"\nname: t\nroles:\n  a: {runner: shell}\n';

const INVALID: [string, string, string[]][] = [
  ['not yaml mapping', '- a\n- b\n', ['root must be a mapping']],
  ['bad version', 'version: "9"\nname: t\nsteps: []\n', ['unsupported version']],
  [
    'unknown dependency',
    `${HEAD}steps:\n  - {id: x, role: a, depends_on: [nope]}\n`,
    ['unknown step "nope"'],
  ],
  [
    'cycle',
    `${HEAD}steps:\n  - {id: x, role: a, depends_on: [y]}\n  - {id: y, role: a, depends_on: [x]}\n`,
    ['cycle'],
  ],
  ['duplicate ids', `${HEAD}steps:\n  - {id: x, role: a}\n  - {id: x, role: a}\n`, ['duplicate step id']],
  ['unknown role', `${HEAD}steps:\n  - {id: x, role: ghost}\n`, ['unknown role "ghost"']],
  [
    'unknown artifact',
    `${HEAD}steps:\n  - {id: x, role: a, goal: 'see \${{ artifacts.nope }}'}\n`,
    ['unknown artifact "nope"'],
  ],
  ['shell without commands', `${HEAD}steps:\n  - {id: x, runner: shell}\n`, ['declares no commands']],
  [
    'unknown guard',
    `${HEAD}steps:\n  - {id: x, role: a, guards: [{type: telepathy, paths: []}]}\n`,
    ['not a known guard'],
  ],
  [
    'retry target not an ancestor',
    `${HEAD}steps:\n  - {id: x, role: a}\n  - {id: y, role: a, on_failure: {action: retry_step, target: x, max_retries: 1}}\n`,
    ['must be the step itself or one of its ancestors'],
  ],
  [
    'retry without budget',
    `${HEAD}steps:\n  - {id: x, role: a, on_failure: {action: retry_step, target: x}}\n`,
    ['max_retries must be at least 1'],
  ],
  [
    'type errors reported together',
    'version: "1.0"\nname: t\nsteps:\n  - {goal: no id}\n  - {id: 5}\n',
    ['steps[0].id is required', 'steps[1].id must be a non-empty string'],
  ],
  ['invalid yaml', 'a: [unclosed\n', ['invalid YAML']],
  ['duplicate keys', 'version: "1.0"\nversion: "1.0"\n', ['invalid YAML']],
  ['custom tags', 'version: !custom "1.0"\nname: t\n', ['invalid YAML']],
  ['several documents', 'version: "1.0"\n---\nname: t\n', ['invalid YAML']],
  ['unquoted version number', 'version: 1.0\nname: t\n', ['version must be a non-empty string']],
];

describe('WorkflowParser errors', () => {
  it.each(INVALID)('reports %s', (_name, yaml, fragments) => {
    const all = problemsOf(yaml);
    for (const fragment of fragments) {
      expect(all).toContain(fragment);
    }
  });

  it('rejects an empty document', () => {
    expect(problemsOf('')).toContain('root must be a mapping');
  });

  it('keeps __proto__ and numeric keys as plain data', () => {
    const wf = parseWorkflow(
      'version: "1.0"\nname: t\nroles:\n  __proto__: {runner: shell}\n  "7": {runner: shell}\nsteps:\n  - {id: x, role: "7"}\n',
    );
    expect(Object.keys(wf.roles)).toEqual(['7', '__proto__']);
    expect(Object.getPrototypeOf(wf.roles)).toBe(Object.prototype);
  });
});

describe('guard types come from the registry', () => {
  const yaml = `${HEAD}steps:\n  - {id: x, role: a, guards: [{type: lint_clean, paths: []}]}\n`;

  it('refuses a type nobody registered', () => {
    expect(problemsOf(yaml)).toContain('not a known guard');
  });

  it('accepts a type a plugin registered', () => {
    const registry = GuardRegistry.withDefaults().register({
      type: 'lint_clean',
      check: async () => GuardResult.pass(),
    });
    const wf = new WorkflowParser(registry).parse(yaml);
    expect(wf.steps[0]?.guards[0]?.type).toBe('lint_clean');
    expect(GuardType.GitDiffEmpty).toBe('git_diff_empty');
  });
});

describe('Interpolator', () => {
  it('resolves references with flexible spacing and refuses unknown ones', () => {
    const i = new Interpolator({ spec: 'a/b.md' });
    const open = '$' + '{{';
    const ref = (name: string, pad = ' '): string => `${open}${pad}artifacts.${name}${pad}}}`;
    expect(i.interpolate(`x ${ref('spec', '')} y ${ref('spec', '  ')}`)).toBe('x a/b.md y a/b.md');
    expect(() => i.interpolate(ref('nope'))).toThrow('unknown artifact "nope"');
    expect(() => i.interpolate(ref('constructor'))).toThrow('unknown artifact');
  });
});

const MCP_HEAD = `version: "1.0"
name: mcp
mcp_servers:
  docs:
    command: npx
    args: ["-y", "docs-server"]
    env: {TOKEN: "s3cret \\"quoted\\""}
  remote:
    url: https://mcp.example.com/sse
roles:
  coder: {runner: claude, mcp: [docs]}
  local: {runner: noMcp}
`;

describe('MCP declarations', () => {
  it('parses servers, roles, steps and policies', () => {
    const wf = parseWorkflow(
      `${MCP_HEAD}\ndefaults: {mcp_policy: optional}\nsteps:\n  - {id: a, role: coder, mcp: [remote], mcp_policy: required}\n  - {id: b, role: coder}\n`,
    );
    expect(wf.mcpServers.docs?.command).toBe('npx');
    expect(wf.mcpServers.docs?.args).toEqual(['-y', 'docs-server']);
    expect(wf.mcpServers.remote?.url).toBe('https://mcp.example.com/sse');
    expect(wf.roles.coder?.mcp).toEqual(['docs']);
    expect(wf.defaultMcpPolicy).toBe(McpPolicy.Optional);
    expect(stepOf(wf, 'a').mcpPolicy).toBe(McpPolicy.Required);
    expect(stepOf(wf, 'b').mcpPolicy).toBeUndefined();
  });

  it('defaults the policy to required', () => {
    expect(parseWorkflow(`${MCP_HEAD}\nsteps:\n  - {id: a, role: coder}\n`).defaultMcpPolicy).toBe(
      McpPolicy.Required,
    );
  });

  const base = 'version: "1.0"\nname: t\nroles:\n  r: {runner: shell}\n';
  const bad: [string, string, string][] = [
    [
      'neither command nor url',
      `${base}mcp_servers:\n  x: {args: [a]}\nsteps:\n  - {id: s, role: r}\n`,
      'exactly one of "command" or "url"',
    ],
    [
      'both command and url',
      `${base}mcp_servers:\n  x: {command: c, url: 'https://a.b'}\nsteps:\n  - {id: s, role: r}\n`,
      'exactly one',
    ],
    [
      'bad url scheme',
      `${base}mcp_servers:\n  x: {url: 'ftp://a.b'}\nsteps:\n  - {id: s, role: r}\n`,
      'http or https',
    ],
    [
      'bad server name',
      `${base}mcp_servers:\n  'a.b"c': {command: c}\nsteps:\n  - {id: s, role: r}\n`,
      'name must match',
    ],
    [
      'unknown server on a step',
      `${base}steps:\n  - {id: s, role: r, mcp: [ghost]}\n`,
      'step "s" uses unknown MCP server "ghost"',
    ],
    [
      'unknown server on a role',
      'version: "1.0"\nname: t\nroles:\n  r: {runner: shell, mcp: [ghost]}\nsteps:\n  - {id: s, role: r}\n',
      'role "r" uses unknown MCP server',
    ],
    [
      'bad policy',
      `${base}defaults: {mcp_policy: sometimes}\nsteps:\n  - {id: s, role: r}\n`,
      'must be "required" or "optional"',
    ],
  ];
  it.each(bad)('rejects %s', (_name, yaml, fragment) => {
    expect(problemsOf(yaml)).toContain(fragment);
  });
});
