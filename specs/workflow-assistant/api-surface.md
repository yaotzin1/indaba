# API surface: Workflow assistant

> **Semver impact**: minor for everything here: new exports, new optional server resources, a new optional per-user profiles file, new span attributes. Nothing that exists changes behaviour. Classified under
> `.agents/skills/api_surface/SKILL.md`. `AssistantReply['kind']` and `ImpactReason` are closed unions consumers may switch on; a member added later is a major in practice.
> **Depends on**: `WorkflowEdit`, `WorkflowPath` and `JsonValue` of `@indaba/core` (web-contract); `WorkflowDocument`, `Catalog`, `catalogOf` and `workflowJsonSchema` of `@indaba/engine` (`specs/workflow-editor`);
> `StructuredQuestion` and `checkQuestion` of `specs/question-contract` (not yet implemented: this spec ships with or after it); the level `read` of `specs/agent-permissions` (not yet implemented, see AC-21);
> `userConfigFolder` of `indaba` (CLI), which `indaba ui` already uses for what a person confirmed.

## `@indaba/core` (pure)

```ts
export const MAX_QUESTIONS_PER_REQUEST: 5;                 // C-06
export const MAX_CONTEXT_CHARS: 200_000;                   // everything sent to the model in one call (C-06)
export const MAX_PACK_CHARS: 100_000;                      // the default pack (C-06)

/** A change the model proposes: exactly a `WorkflowEdit` (web-contract) plus the model's reason, shown to the person (AC-11). Roles are reached with `set` and `remove` on a path. */
export type ProposedEdit = WorkflowEdit & { readonly reason: string };

/** A question the assistant asks: the structured question of `question-contract` and an id the session gives it (AC-06). */
export interface AssistantQuestion {
  readonly id: string;
  readonly title: string;
  readonly question: StructuredQuestion;
}

/** The closed set of things the assistant may answer with (AC-04). */
export type AssistantReply =
  | { readonly kind: 'proposal'; readonly summary: string; readonly edits: readonly ProposedEdit[] }
  | { readonly kind: 'question'; readonly question: AssistantQuestion }
  | { readonly kind: 'explanation'; readonly text: string }
  | { readonly kind: 'refusal'; readonly reason: string };

/** Pure; never throws. Anything outside the closed shapes is `{ error }`, which the session turns into a `refusal` reply with that reason (AC-10, AC-11). */
export function parseAssistantReply(output: string): { readonly reply: AssistantReply } | { readonly error: string };

/**
 * AC-13: whether an edit is high-impact, decided from the edit and the state of the draft **just before it** (the clone after the earlier edits), never from the model's words.
 * The check looks inside the value of a `set` and the step of an `addStep`, recursively. Structured reasons for the front end to put in words.
 */
export type ImpactReason = 'permissions' | 'mcp' | 'shell_command' | 'runner' | 'guard_changed' | 'arbiter' | 'gate_approves';
export function classifyEdit(edit: ProposedEdit, draftBefore: JsonValue): { readonly highImpact: boolean; readonly reasons: readonly ImpactReason[] };
// `gate_approves` exists only when `review-gate` is implemented; until then no field can produce it.
```

## `@indaba/engine`

```ts
/** AC-08: the default pack, built from the files shipped with this version. Pure given its inputs. Parts are in a fixed order (format, catalog, schema, examples); over `MAX_PACK_CHARS` the examples go first, then the schema, and `omitted` says which. */
export function buildContextPack(sources: {
  readonly format: string;               // docs/workflow-format.md as shipped
  readonly schema: Readonly<Record<string, unknown>>;
  readonly catalog: Catalog;             // with the permission map of agent-permissions when present
  readonly examples: readonly { readonly name: string; readonly text: string }[];   // task-pipeline and review-debate (AC-08)
}): { readonly text: string; readonly chars: number; readonly parts: readonly string[]; readonly omitted: readonly string[] };

export interface AssistantProfile {
  readonly name: string;
  readonly kind: 'agent' | 'service';
  readonly runner: string;               // resolved by name in the RunnerRegistry, plugins included (AC-21)
  readonly model?: string;               // for a service
}

/** The per-user profiles file (AC-03). Pure parse; a key that looks like a secret, an unknown kind or an unknown key is a problem that names it. */
export function parseAssistantProfiles(text: string): { readonly profiles: readonly AssistantProfile[] } | { readonly problems: readonly string[] };

export interface AssistantSessionOptions {
  readonly profile: AssistantProfile;
  readonly catalog: Catalog;
  readonly runners: RunnerRegistry;      // the profile's runner is resolved here and started at `read` (AC-10, AC-21)
  readonly includePack: boolean;
  readonly documents: readonly { readonly name: string; readonly text: string }[];
  readonly tracer: Tracer;
  readonly logger: Logger;
  readonly clock: Clock;
}

export class AssistantSession {
  constructor(options: AssistantSessionOptions);
  /**
   * One request: the person's words about the **current text of the draft** (passed each time, so the session holds no draft). Returns the first reply that is not a repair.
   * Inside it, at most one repair call (AC-12); `usage` is the sum of both calls. A parse failure or a failed repair is a `refusal` or a proposal marked invalid, never a throw.
   * `send` starts a new request: the question counter resets (AC-06).
   */
  send(message: string, draftText: string, signal: AbortSignal): Promise<AssistantTurn>;
  /** Continues the request that asked `question.id`. */
  answer(questionId: string, answer: string, draftText: string, signal: AbortSignal): Promise<AssistantTurn>;
  /** AC-14: replaces the added documents and the pack switch; the caller must have the person's new confirmation, and the session records that it did. */
  setContext(change: { readonly documents: readonly { readonly name: string; readonly text: string }[]; readonly includePack: boolean }, confirmed: boolean): void;
  /** AC-16: cancels the call in flight, if any; the session stays. */
  cancel(): void;
}

export interface AssistantTurn {
  readonly reply: AssistantReply;
  /** For a proposal: problems of the clone after **all** edits in order (AC-12). Empty = valid. */
  readonly validation?: readonly Problem[];
  /** For a proposal: `index` is a position in `reply.edits` (AC-05). */
  readonly impact?: readonly { readonly index: number; readonly reasons: readonly ImpactReason[] }[];
  readonly usage: { readonly tokens?: number; readonly costUsd?: number };   // absent = unknown (AC-15)
}

/**
 * AC-05, AC-13: choose edits of a proposal. `indexes` are positions in `proposal.edits`; `acceptedHighImpact` must be a subset of `indexes`; an index out of range or a high-impact index
 * not in `acceptedHighImpact` is refused. The chosen edits are applied in order to a clone of `draftText` and the result is validated; a subset that does not validate (for example an edit
 * of a step whose `addStep` was not chosen) is refused with the problems. On success it returns the edits for the caller to apply with the existing edit resource, and records the counts (AC-18).
 */
export function selectAccepted(
  draftText: string,
  proposal: Extract<AssistantReply, { kind: 'proposal' }>,
  accepted: { readonly indexes: readonly number[]; readonly acceptedHighImpact: readonly number[] },
  catalog: Catalog,
): { readonly edits: readonly WorkflowEdit[] } | { readonly error: string; readonly problems?: readonly Problem[] };
```

`send`, `answer` and a repair are the only calls that reach the model. The session never mutates a document: it returns edits, and the page or any front end applies them with the existing editing resource.

## The profiles file

`<userConfigFolder>/indaba/assistant.yml`, outside every project, so a project that arrives from elsewhere cannot carry a profile or redirect the person's content to an endpoint. (`indaba.config` of the project is committed
and holds no secret; it is not used, C-05.)

```yaml
profiles:
  - name: my-claude
    kind: agent
    runner: claude-code
  - name: cheap
    kind: service
    runner: openrouter
    model: some/model-id
```

Absent file or no profiles: the assistant is off (AC-01). The key of a service is the environment variable the runner already reads.

## `@indaba/server`

Shapes live in `@indaba/core` web-contract; routes are under `/api/v1/assistant`, token-protected, confined to served roots. The session is kept in the server's memory (lost on restart; nothing is written, AC-17).
The server holds **no draft**: the page sends the current text with each message.

| Resource | Meaning |
| :--- | :--- |
| `GET /assistant/profiles` | the profiles, without secrets (AC-03) |
| `GET /assistant/pack` | the default pack as text, its size and `omitted` (AC-08) |
| `POST /assistant/sessions` | start a session for a profile; the body carries the confirmation of AC-14 |
| `PUT /assistant/sessions/<id>/context` | change added documents or the pack switch; needs a new confirmation (AC-14) |
| `POST /assistant/sessions/<id>/messages` | send a message with the draft text; returns an `AssistantTurn` |
| `POST /assistant/sessions/<id>/answers` | answer a question |
| `POST /assistant/sessions/<id>/accept` | `selectAccepted`; returns the `WorkflowEdit[]` to apply (AC-05, AC-13); changes and saves nothing |
| `POST /assistant/sessions/<id>/cancel` | cancels the call in flight (AC-16) |
| `DELETE /assistant/sessions/<id>` | forgets the session |

## Span attributes

| Span | Attributes |
| :--- | :--- |
| one model call (`send`, `answer`, a repair) | `indaba.assistant.profile_kind` (`agent` or `service`), `indaba.assistant.questions` (so far in this request) |
| the accept | `indaba.assistant.edits_proposed`, `indaba.assistant.edits_accepted`, `indaba.assistant.high_impact_accepted` |

New attributes: minor. No prompt, answer, path or key is recorded.

## Changes to other specs (made by their owners when this one is accepted)

- `specs/web-app` C-19: replaced by a pointer to this spec ("decided: free; see `specs/workflow-assistant`"). `specs/web-app/plan-step-3.md`, "Later": the same.
- `specs/web-app-actions` C-03: the user configuration folder now also holds `assistant.yml`.
- `specs/workflow-editor`: no change; `WorkflowDocument` already has the operations.
- `docs/`: a page for the assistant when it is implemented.
