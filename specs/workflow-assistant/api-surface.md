# API surface: Workflow assistant

> **Semver impact**: minor for everything here: new exports, new optional server resources, a new optional `assistant` section of `indaba.config`, new span attributes. Nothing that exists changes
> behaviour. Classified under `.agents/skills/api_surface/SKILL.md`. `ProposedEdit['op']` and `AssistantReply['kind']` are closed unions consumers may switch on; a member added later is a major in practice.
> **Depends on**: `WorkflowDocument`, `Catalog`, `catalogOf` and `workflowJsonSchema` of `specs/workflow-editor`; `checkQuestion` and the question shape of `specs/question-contract` (not yet
> implemented: this spec ships with or after it, or carries a minimal copy of the check until it lands); the level `read` of `specs/agent-permissions` (until that lands, the assistant's runner is started with no
> tools by the built-in rules of the API runners and with the ACP gate refusing every request).

## `@indaba/core` (pure)

```ts
export const MAX_QUESTIONS_PER_REQUEST: 5;                 // C-06
export const MAX_CONTEXT_CHARS: number;                    // size bound of everything sent to the model (C-06; set at implementation)
export const MAX_PACK_CHARS: number;                       // size bound of the default pack (C-06)

/** The closed set of edits the model may propose: the operations of `WorkflowDocument` and nothing else (AC-11). */
export type ProposedEdit =
  | { readonly op: 'set'; readonly path: Path; readonly value: unknown; readonly reason: string }
  | { readonly op: 'remove'; readonly path: Path; readonly reason: string }
  | { readonly op: 'add_step'; readonly step: Readonly<Record<string, unknown>>; readonly after?: string; readonly reason: string }
  | { readonly op: 'remove_step'; readonly id: string; readonly reason: string }
  | { readonly op: 'move_step'; readonly id: string; readonly after?: string; readonly reason: string };

/** The closed set of things the assistant may answer with (AC-04). */
export type AssistantReply =
  | { readonly kind: 'proposal'; readonly summary: string; readonly edits: readonly ProposedEdit[] }
  | { readonly kind: 'question'; readonly question: Question }           // the shape of `question-contract`
  | { readonly kind: 'explanation'; readonly text: string }
  | { readonly kind: 'refusal'; readonly reason: string };

/** Parse the model's output into a reply. Pure; never throws; anything outside the closed shapes is a refusal-shaped error (AC-10, AC-11). */
export function parseAssistantReply(output: string): { readonly reply: AssistantReply } | { readonly error: string };

/**
 * AC-13: whether an edit is high-impact, decided from the edit and the draft only, never from the model's words. High-impact: a `permissions` block or level, an `mcp` list, a `shell`
 * command, a `runner`, a removed or disabled guard, an arbiter, a gate's `if_nobody` or deadline that approves. Structured reasons for the front end to put in words.
 */
export type ImpactReason = 'permissions' | 'mcp' | 'shell_command' | 'runner' | 'guard_removed' | 'arbiter' | 'gate_approves';
export function classifyEdit(edit: ProposedEdit, draft: unknown): { readonly highImpact: boolean; readonly reasons: readonly ImpactReason[] };
```

## `@indaba/engine`

```ts
/** AC-08: the default pack, built from the files shipped with this version. Pure given its inputs. */
export function buildContextPack(sources: {
  readonly format: string;               // docs/workflow-format.md as shipped
  readonly schema: Readonly<Record<string, unknown>>;
  readonly catalog: Catalog;             // with the permission map of agent-permissions when present
  readonly examples: readonly { readonly name: string; readonly text: string }[];
}): { readonly text: string; readonly chars: number; readonly parts: readonly string[] };

export interface AssistantProfile {
  readonly name: string;
  readonly kind: 'agent' | 'service';
  readonly runner: string;               // a runner of the catalog (AC-21)
  readonly model?: string;               // for a service
}

export interface AssistantSessionOptions {
  readonly profile: AssistantProfile;
  readonly draft: WorkflowDocument;
  readonly catalog: Catalog;
  readonly documents: readonly { readonly name: string; readonly text: string }[];   // added by the person (AC-09)
  readonly includePack: boolean;
  readonly runner: Runner;               // started at the level `read` (AC-10)
  readonly clock: Clock;
}

export class AssistantSession {
  constructor(options: AssistantSessionOptions);
  /** Send the person's words; returns a reply. A proposal has already been applied to a clone and validated (AC-12). */
  send(message: string, signal: AbortSignal): Promise<AssistantTurn>;
  answer(questionId: string, answer: string, signal: AbortSignal): Promise<AssistantTurn>;
}

export interface AssistantTurn {
  readonly reply: AssistantReply;
  readonly validation?: readonly Problem[];          // of the clone after the proposal (AC-12)
  readonly impact?: readonly { readonly index: number; readonly reasons: readonly ImpactReason[] }[];
  readonly usage: { readonly tokens?: number; readonly costUsd?: number };   // absent = unknown (AC-15)
}

/** AC-05: apply the accepted edits to the draft. High-impact edits are applied only when their index is in `acceptedHighImpact`. */
export function applyAccepted(
  draft: WorkflowDocument,
  proposal: Extract<AssistantReply, { kind: 'proposal' }>,
  accepted: { readonly indexes: readonly number[]; readonly acceptedHighImpact: readonly number[] },
): { readonly applied: number } | { readonly error: string };
```

`send` and `answer` are the only calls that reach the model. Everything else is pure or works on the clone.

## `indaba.config`

```yaml
assistant:
  profiles:
    - name: my-claude          # a label
      kind: agent
      runner: claude-code
    - name: cheap
      kind: service
      runner: openrouter
      model: some/model-id
```

The parser rejects an unknown `kind`, a runner that is not in the catalog (at use, not at parse), and any key that looks like a secret. Optional; absent means the assistant is off (AC-01).

## `@indaba/server`

| Resource | Meaning |
| :--- | :--- |
| `GET /assistant/profiles` | the profiles of the configuration, without secrets (AC-03) |
| `GET /assistant/pack` | the default pack as text and its size (AC-08) |
| `POST /assistant/sessions` | start a session for a draft and a profile; the body carries the confirmation of AC-14 |
| `POST /assistant/sessions/<id>/messages` | send a message; returns an `AssistantTurn` |
| `POST /assistant/sessions/<id>/answers` | answer a question |
| `POST /assistant/sessions/<id>/accept` | accept `indexes` and `acceptedHighImpact` (AC-05, AC-13); applies to the draft, saves nothing |
| `DELETE /assistant/sessions/<id>` | cancel and forget |

All are token-protected, confined to served roots, and return structured data with message ids, not English (the page owns the words).

## Span attributes

| Name | Value |
| :--- | :--- |
| `indaba.assistant.profile_kind` | `agent` or `service` |
| `indaba.assistant.questions`, `indaba.assistant.edits_proposed`, `indaba.assistant.edits_accepted`, `indaba.assistant.high_impact_accepted` | counts |

New attributes: minor. No prompt, answer, path or key is recorded.

## Changes to other specs (made by their owners when this one is accepted)

- `specs/web-app` C-19: replaced by a pointer to this spec ("decided: free; see `specs/workflow-assistant`"). `specs/web-app/plan-step-3.md`, "Later": the same.
- `specs/workflow-editor`: no change; `WorkflowDocument` already has the operations.
- `docs/README.md`/`docs/` : a page for the assistant when it is implemented.
