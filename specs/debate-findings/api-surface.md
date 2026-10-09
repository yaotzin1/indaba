# API surface contract: Debate findings and prompts

> Builds on `specs/debate-arbiter` and `specs/voter-arbiter`.

## Semver classification

**minor**, on the condition that the two specs it builds on ship in the same release. On its own against the
last release it would be a major, because it changes the prompt of debates that name an arbiter and adds a voter
to the default list; both of those exist only in the unreleased arbiter work. A debate with no `arbiter` is
byte-for-byte unchanged (AC-03).

## Public symbols added

### `@indaba/core`

```ts
export interface Finding {
  readonly importance: 1 | 2 | 3 | 4 | 5;     // agent-reported
  readonly text: string;
}

export interface FindingsRead {
  readonly findings: readonly Finding[];       // at most 50
  readonly ignored: number;                    // FINDING lines with a missing or out-of-range number
}

// AgentMessage gains:
//   findings(): FindingsRead

export class PromptRegistry {
  register(name: string, text: string, options?: { readonly replace?: boolean }): void; // duplicate without replace: IndabaError
  get(name: string): string | undefined;
  names(): readonly string[];
}

export const DEBATE_REVIEW_PROMPT_NAME: 'debate-review';
export const DEBATE_REVIEW_PROMPT: string;     // the built-in text

export const IMPORTANCE_VOTER: Voter;          // name "importance"; appended to BUILT_IN_VOTERS

// RunnerParticipantOptions gains:
//   readonly instructions?: string;            // placed between the topic and the discussion; absent: prompt unchanged
```

`StepDefinition` gains `readonly prompt?: string` and `readonly promptAdditions?: boolean`.
`WorkflowDefinition` gains `readonly defaultPromptAdditions?: boolean`.
`PluginHost` gains `registerPrompt(name: string, text: string, options?: { readonly replace?: boolean }): void`.

### `@indaba/engine`

`StepExecutorOptions` gains `readonly prompts?: PromptRegistry` (the same object the host registers into).
`WorkflowValidator.warnings` adds the warning for an arbiter with `prompt_additions: off`.
The ledger's `memoKey` gains a `prompt` argument that is part of the digest.

### `indaba` (CLI)

`RegistryPluginHost.registerPrompt`; `createEngine` registers `DEBATE_REVIEW_PROMPT` through it.

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| workflow file | step field `prompt` | added: the name of a registered prompt |
| workflow file | step field `prompt_additions` | added: `on` or `off` |
| workflow file | `defaults.prompt_additions` | added: `on` or `off` |
| workflow file | validation | added: a warning for an arbiter with additions off; an error for a non-boolean value |
| CLI | `validate`, `plan` | print the new warning |
| span attribute | `indaba.prompt.additions` | added: `on` or `off`, on every debate step |
| span attribute | `indaba.prompt.name` | added: the prompt in force, when additions are on |
| span attribute | `indaba.findings.count` | added: findings counted, agent-reported |
| span attribute | `indaba.findings.max_importance` | added: the highest importance reported, agent-reported |
| artifact | `.indaba/artifacts/<step-id>.findings.md` | added, when additions are on |

## Defaults introduced

- Additions on exactly when the step has an `arbiter`. Changing this is a major.
- The built-in prompt is `debate-review`. Changing its text changes what agents are asked: a major once released,
  and the ledger key includes it, so rulings made under another text are not reused.
- Importance scale 1 to 5; score `10 * (5 - w) / 4`; 50 findings read per message. Changing any is a major.
- `importance` joins the default `use` list of the `voters` arbiter.

## Checks

- [ ] `@indaba/core` imports no `node:` module (`architecture.test.ts`)
- [ ] With no arbiter, the debate prompt equals the one in the previous release (a snapshot test)
- [ ] The built-in prompt registers through `PluginHost`, like a plugin's
- [ ] `docs/workflow-format.md` documents the fields, the format, the voter, and what turning additions off costs
- [ ] No `any`, no `!`, no suppression comment
- [ ] No span attribute holds finding text
