# Plan: OpenClaw runner

## Modules touched

| File | Change |
| :--- | :--- |
| `packages/runners/src/openclaw-runner.ts` (new) | `OpenClawRunner extends AcpRunner`: name, description, a private preset, `passEnv` with `OPENCLAW_*`, the capabilities, `run` that fixes the agent |
| `packages/runners/src/acp-runner.ts` | `name` and `description` typed `string` so a subclass may override them |
| `packages/runners/src/registry.ts`, `index.ts` | register and export |
| `packages/engine/src/readiness/probe.ts` | `openclaw: 'openclaw'` in the program table |
| `packages/engine/src/editor/schema.ts` | the runner enumeration text |
| `packages/cli/src/permission-report.ts`, `packages/web/src/messages.ts` | the words of `no_client_methods` |
| `docs/getting-started.md`, `docs/workflow-format.md`, `docs/using-the-alpha.md`, `README.md`, `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md` | per the documentation rule |

## Order

1. The runner and its tests against the fake ACP agent of `packages/runners/test/acp-support.ts`.
2. Registration, the readiness program, the schema text, the two sets of words.
3. Validate, plan and the catalog: tests through `checkPermissions` and `McpPlanner` with the real registry.
4. Documentation; `pnpm qa`, `pnpm e2e`, the node gates.

## Risks

- **The bridge is read from documentation, not run.** The flags and the feature matrix are the documented ones. The
  review says so, and the docs say the runner is unverified against a live Gateway.
- **`agent.command` bypasses the environment prefix** for a `command` spec; `passEnv` with `OPENCLAW_*` covers it.
