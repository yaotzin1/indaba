import { readFile } from 'node:fs/promises';
import type {
  AgentSpec,
  DecisionType as DecisionTypeValue,
  GuardDefinition,
  McpServerDefinition,
  OnFailure,
  RoleDefinition,
  StepDefinition,
  StepPermissions,
  WorkflowDefinition,
} from '@indaba/core';
import {
  DecisionType,
  FailureAction,
  Isolation,
  isConsensusStep,
  McpPolicy,
  PermissionLevel,
  PermissionMode,
  resolvePermissions,
  SHELL_RUNNER,
  WorkflowValidationError,
} from '@indaba/core';
import { parseAllDocuments } from 'yaml';
import { GuardRegistry } from '../guard/registry.js';
import { LineCounter, type Problem, place } from './diagnose.js';
import { ErrorBag } from './error-bag.js';
import { Interpolator } from './interpolator.js';
import { isYamlMap, Node } from './node.js';
import { WorkflowValidator } from './validator.js';

/** Own, enumerable properties only: a key such as `__proto__` stays data. */
function record<T>(entries: readonly (readonly [string, T])[]): Record<string, T> {
  return Object.fromEntries(entries);
}

function lookup<T extends string>(values: Readonly<Record<string, T>>, name: string): T | undefined {
  return Object.values(values).find((value) => value === name);
}

/** Parses and validates a workflow file. Every problem found is reported at once. */
/** The options every read of a workflow uses, so `parse` and `diagnose` see the same document. */
const YAML_OPTIONS = { schema: 'core', uniqueKeys: true, strict: true, logLevel: 'silent' } as const;

/**
 * AC-01: an agent step's effective block is the step's, else its role's, else `defaults`'s, whole. A shell step and a
 * debate step never receive a role's or `defaults`'s block (AC-03, AC-19).
 */
function resolveStepPermissions(
  step: StepDefinition,
  roles: Readonly<Record<string, RoleDefinition>>,
  defaults: StepPermissions | undefined,
): StepDefinition {
  if (step.runner === SHELL_RUNNER || isConsensusStep(step)) {
    return step;
  }
  const role = step.role !== undefined && Object.hasOwn(roles, step.role) ? roles[step.role] : undefined;
  const resolved = resolvePermissions({
    ...(step.permissions !== undefined ? { step: step.permissions } : {}),
    ...(role?.permissions !== undefined ? { role: role.permissions } : {}),
    ...(defaults !== undefined ? { defaults } : {}),
  });
  return resolved === undefined || resolved === step.permissions ? step : { ...step, permissions: resolved };
}

/** Top-level keys of a repository's development workflow, a different format that shares the file name. */
const DEVELOPMENT_WORKFLOW_KEYS = ['governance', 'tracks', 'stages', 'quality_gates'];

export class WorkflowParser {
  static readonly SUPPORTED_VERSION = '1.0';

  constructor(
    private readonly guards: GuardRegistry = GuardRegistry.withDefaults(),
    private readonly validator: WorkflowValidator = new WorkflowValidator(),
    /** When given, a runner name it does not know is a parse error instead of a failure at run time. */
    private readonly runners?: { has(name: string): boolean },
  ) {}

  async parseFile(path: string): Promise<WorkflowDefinition> {
    let contents: string;
    try {
      contents = await readFile(path, 'utf8');
    } catch {
      throw new WorkflowValidationError([`cannot read workflow file "${path}"`]);
    }
    return this.parse(contents);
  }

  parse(source: string): WorkflowDefinition {
    const data = this.decode(source);
    if (!isYamlMap(data)) {
      throw new WorkflowValidationError(['the document root must be a mapping']);
    }

    const errors = new ErrorBag();
    const plain = new Node(data, '$', errors);

    const artifacts = record(plain.stringMap('artifacts'));
    const root = new Node(data, '$', errors, new Interpolator(artifacts));

    const version = root.string('version') ?? '';
    if (version !== '' && version !== WorkflowParser.SUPPORTED_VERSION) {
      errors.add(`unsupported version "${version}" (expected "${WorkflowParser.SUPPORTED_VERSION}")`);
      if (DEVELOPMENT_WORKFLOW_KEYS.some((key) => data.has(key))) {
        errors.add(
          'this looks like a development workflow (stages, governance), not an Indaba workflow: see docs/workflow-format.md',
        );
      }
    }
    const name = root.string('name') ?? '';

    const roleEntries: [string, RoleDefinition][] = [];
    for (const [roleName, node] of root.nodeMap('roles')) {
      const chain = this.runnerChain(node, true, errors);
      if (chain !== undefined) {
        const model = node.string('model', false);
        const agent = this.parseAgent(node, errors);
        const rolePermissions = this.parsePermissions(node, errors);
        roleEntries.push([
          roleName,
          {
            name: roleName,
            runner: chain.runner,
            ...(chain.fallbackRunners.length > 0 ? { fallbackRunners: chain.fallbackRunners } : {}),
            ...(agent !== undefined ? { agent } : {}),
            ...(model !== undefined ? { model } : {}),
            mcp: node.stringList('mcp'),
            ...(rolePermissions !== undefined ? { permissions: rolePermissions } : {}),
          },
        ]);
      }
    }

    const steps: StepDefinition[] = [];
    for (const node of root.nodeList('steps')) {
      const step = this.parseStep(node, errors);
      if (step !== undefined) {
        steps.push(step);
      }
    }

    const serverEntries: [string, McpServerDefinition][] = [];
    for (const [serverName, serverNode] of root.nodeMap('mcp_servers')) {
      const command = serverNode.string('command', false);
      const url = serverNode.string('url', false);
      serverEntries.push([
        serverName,
        {
          name: serverName,
          ...(command !== undefined ? { command } : {}),
          args: serverNode.stringList('args'),
          env: record(serverNode.stringMap('env')),
          ...(url !== undefined ? { url } : {}),
        },
      ]);
    }
    const defaults = root.map('defaults');
    const defaultMcpPolicy =
      defaults === undefined
        ? McpPolicy.Required
        : (this.parsePolicy(defaults, errors) ?? McpPolicy.Required);

    const defaultPermissions = defaults === undefined ? undefined : this.parsePermissions(defaults, errors);
    const roles = record(roleEntries);

    const workflow: WorkflowDefinition = {
      version,
      name,
      artifacts,
      roles,
      steps: steps.map((step) => resolveStepPermissions(step, roles, defaultPermissions)),
      mcpServers: record(serverEntries),
      defaultMcpPolicy,
      ...(defaultPermissions !== undefined ? { defaultPermissions } : {}),
    };

    const problems = errors.isEmpty() ? this.validator.validate(workflow) : errors.all();
    if (problems.length > 0) {
      throw new WorkflowValidationError(problems);
    }
    return workflow;
  }

  /**
   * The problems of a text, each placed in it (specs/workflow-editor, AC-05): the errors `parse` would throw, or, when
   * there are none, the warnings `indaba validate` prints. The sentences are those exactly; only the place is added.
   */
  diagnose(source: string): Problem[] {
    const lines = new LineCounter();
    const docs = Array.from(parseAllDocuments(source, { ...YAML_OPTIONS, lineCounter: lines }));
    const [doc, second] = docs;
    let workflow: WorkflowDefinition;
    try {
      workflow = this.parse(source);
    } catch (error) {
      if (!(error instanceof WorkflowValidationError)) {
        throw error;
      }
      if (doc === undefined) {
        return error.problems.map((message) => ({ path: '$', message, severity: 'error' }));
      }
      const syntax = doc.errors[0] ?? doc.warnings[0];
      return error.problems.map((message): Problem => {
        if (syntax !== undefined && message === `invalid YAML: ${syntax.message}`) {
          const at = syntax.linePos?.[0];
          return at === undefined
            ? { path: '$', message, severity: 'error' }
            : { path: '$', message, severity: 'error', line: at.line, column: at.col };
        }
        if (
          second !== undefined &&
          message.startsWith('invalid YAML: a workflow file holds exactly one document')
        ) {
          const { line, col } = lines.linePos(second.range[0]);
          return { path: '$', message, severity: 'error', line, column: col };
        }
        return place(doc, lines, message, 'error');
      });
    }
    // A text that parses has a first document.
    return doc === undefined
      ? []
      : this.validator.warnings(workflow).map((m) => place(doc, lines, m, 'warning'));
  }

  /** Core schema, one document, unique keys; a warning (an unknown tag, say) is as fatal as an error. */
  private decode(source: string): unknown {
    const docs = parseAllDocuments(source, YAML_OPTIONS);
    const [doc, ...rest] = Array.from(docs);
    if (doc === undefined) {
      return undefined;
    }
    const problem = doc.errors[0] ?? doc.warnings[0];
    if (problem !== undefined) {
      throw new WorkflowValidationError([`invalid YAML: ${problem.message}`]);
    }
    if (rest.length > 0) {
      throw new WorkflowValidationError(['invalid YAML: a workflow file holds exactly one document']);
    }
    return doc.toJS({ mapAsMap: true });
  }

  private parseStep(node: Node, errors: ErrorBag): StepDefinition | undefined {
    const id = node.string('id');
    if (id === undefined) {
      return undefined;
    }

    const guards: GuardDefinition[] = [];
    for (const guardNode of node.nodeList('guards')) {
      const typeName = guardNode.string('type');
      const type = typeName !== undefined && this.guards.has(typeName) ? typeName : undefined;
      if (typeName !== undefined && type === undefined) {
        errors.add(`${guardNode.path}.type "${typeName}" is not a known guard`);
      }
      if (type !== undefined) {
        guards.push({ type, paths: guardNode.stringList('paths', true) });
      }
    }

    const isolationName = node.string('isolation', false);
    let isolation: Isolation = Isolation.None;
    if (isolationName !== undefined) {
      const found = lookup(Isolation, isolationName);
      if (found === undefined) {
        errors.add(`${node.path}.isolation "${isolationName}" is not supported`);
      } else {
        isolation = found;
      }
    }

    const decisionName = node.string('decision_type', false);
    const decision: DecisionTypeValue | undefined =
      decisionName === undefined ? undefined : lookup(DecisionType, decisionName);
    if (decisionName !== undefined && decision === undefined) {
      errors.add(`${node.path}.decision_type "${decisionName}" is not supported`);
    }

    const arbiter = node.string('arbiter', false);
    if (arbiter !== undefined && !/^[A-Za-z0-9_-]+$/.test(arbiter)) {
      errors.add(`${node.path}.arbiter "${arbiter}" must be letters, digits, _ or -`);
    }

    const role = node.string('role', false);
    const chain = this.runnerChain(node, false, errors);
    const agent = this.parseAgent(node, errors);
    const permissions = this.parsePermissions(node, errors);
    if (permissions?.level !== undefined && chain?.runner === SHELL_RUNNER) {
      errors.add(
        `${node.path}.permissions.level is not allowed on a shell step: a shell step runs the commands its author wrote`,
      );
    }
    const onFailure = this.parseOnFailure(node.map('on_failure'), errors);
    const mcpPolicy = this.parsePolicy(node, errors);

    return {
      id,
      ...(role !== undefined ? { role } : {}),
      ...(chain !== undefined ? { runner: chain.runner } : {}),
      ...(chain !== undefined && chain.fallbackRunners.length > 0
        ? { fallbackRunners: chain.fallbackRunners }
        : {}),
      ...(agent !== undefined ? { agent } : {}),
      ...(permissions !== undefined ? { permissions } : {}),
      goal: node.string('goal', false, true) ?? '',
      dependsOn: node.stringList('depends_on'),
      inputArtifacts: node.stringList('input_artifacts', true),
      outputs: node.stringList('outputs', true),
      commands: node.stringList('commands', true),
      guards,
      isolation,
      ...(onFailure !== undefined ? { onFailure } : {}),
      consensusWith: node.stringList('consensus_with'),
      ...(decision !== undefined ? { decisionType: decision } : {}),
      ...(arbiter !== undefined ? { arbiter } : {}),
      mcp: node.stringList('mcp'),
      ...(mcpPolicy !== undefined ? { mcpPolicy } : {}),
    };
  }

  /** `runner` is a name or a list; the first is the primary, the rest are fallbacks. */
  private runnerChain(
    node: Node,
    required: boolean,
    errors: ErrorBag,
  ): { readonly runner: string; readonly fallbackRunners: readonly string[] } | undefined {
    const names = node.stringOrList('runner', required);
    const [runner, ...fallbackRunners] = names ?? [];
    if (runner === undefined) {
      return undefined;
    }
    if (this.runners !== undefined) {
      for (const name of [runner, ...fallbackRunners]) {
        if (!this.runners.has(name)) {
          errors.add(`${node.path}.runner "${name}" is not a known runner`);
        }
      }
    }
    return { runner, fallbackRunners };
  }

  /**
   * A preset name, or a mapping with a `preset` or a `command` list (`[program, ...arguments]`) and
   * optionally `auth`, the agent's own id for how to log in.
   */
  private parseAgent(node: Node, errors: ErrorBag): AgentSpec | undefined {
    const value = node.stringOrMap('agent');
    if (value === undefined) {
      return undefined;
    }
    if (value.text !== undefined) {
      return { preset: value.text };
    }
    const block = value.node;
    const preset = block?.string('preset', false);
    const command = block?.stringList('command') ?? [];
    const auth = block?.string('auth', false);
    if (preset === undefined && command.length === 0) {
      errors.add(`${node.path}.agent needs a preset name or a non-empty command list`);
      return undefined;
    }
    return {
      ...(command.length > 0 ? { command } : { preset: preset ?? '' }),
      ...(auth !== undefined ? { auth } : {}),
    };
  }

  /** Scope for a step's agent. A block with no `terminal` key denies the terminal. */
  private parsePermissions(node: Node, errors: ErrorBag): StepPermissions | undefined {
    const block = node.map('permissions');
    if (block === undefined) {
      return undefined;
    }
    const fs = block.map('fs');
    const terminalName = block.string('terminal', false) ?? PermissionMode.Deny;
    const terminal = lookup(PermissionMode, terminalName);
    if (terminal === undefined) {
      errors.add(`${block.path}.terminal "${terminalName}" must be "allow" or "deny"`);
    }
    const fsRead = fs?.stringList('read') ?? [];
    const fsWrite = fs?.stringList('write') ?? [];
    const level = this.parseLevel(block, errors);
    if (block.has('timeout_seconds')) {
      errors.add(
        `${block.path}.timeout_seconds is not supported: this version cannot ask a person about an agent's actions yet`,
      );
    }
    if (level === PermissionLevel.Edit && fsWrite.length === 0) {
      errors.add(`${block.path}.level "edit" needs the folders it may change: add fs.write`);
    }
    if (level === PermissionLevel.Read && (fsWrite.length > 0 || terminal === PermissionMode.Allow)) {
      errors.add(
        `${block.path}.level "read" may not write files or run commands: remove fs.write and terminal "allow"`,
      );
    }
    if (level === PermissionLevel.Full && (block.has('fs') || block.has('terminal'))) {
      errors.add(`${block.path}.level "full" has no limits to give: remove fs and terminal`);
    }
    return {
      ...(level !== undefined ? { level } : {}),
      fsRead,
      fsWrite,
      terminal: terminal ?? PermissionMode.Deny,
    };
  }

  private parseLevel(block: Node, errors: ErrorBag): PermissionLevel | undefined {
    const name = block.string('level', false);
    if (name === undefined) {
      return undefined;
    }
    if (name === 'ask') {
      errors.add(
        `${block.path}.level "ask" is not available yet: this version cannot ask a person about an agent's actions; use "read", "edit" or "full"`,
      );
      return undefined;
    }
    const level = lookup(PermissionLevel, name);
    if (level === undefined) {
      errors.add(`${block.path}.level "${name}" must be "read", "edit" or "full"`);
    }
    return level;
  }

  private parsePolicy(node: Node, errors: ErrorBag): McpPolicy | undefined {
    const name = node.string('mcp_policy', false);
    if (name === undefined) {
      return undefined;
    }
    const policy = lookup(McpPolicy, name);
    if (policy === undefined) {
      errors.add(`${node.path}.mcp_policy "${name}" must be "required" or "optional"`);
    }
    return policy;
  }

  private parseOnFailure(node: Node | undefined, errors: ErrorBag): OnFailure | undefined {
    if (node === undefined) {
      return undefined;
    }
    const actionName = node.string('action');
    const action = actionName === undefined ? undefined : lookup(FailureAction, actionName);
    if (actionName !== undefined && action === undefined) {
      errors.add(`${node.path}.action "${actionName}" is not supported`);
    }
    if (action === undefined) {
      return undefined;
    }
    const target = node.string('target', false);
    return { action, ...(target !== undefined ? { target } : {}), maxRetries: node.int('max_retries', 0) };
  }
}

export function parseWorkflow(source: string): WorkflowDefinition {
  return new WorkflowParser().parse(source);
}
