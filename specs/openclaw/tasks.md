# Tasks: OpenClaw runner

## Infrastructure

- [x] **T-01** `AcpRunner.name` and `description` typed `string`
- [x] **T-02** `OpenClawRunner` (command, environment, capabilities, no MCP, agent fixed)
- [x] **T-03** Register it in `RunnerRegistry.withDefaults`; export it
- [x] **T-04** Readiness program table; schema text; the words of `no_client_methods` in the CLI and the page

## Tests

- [x] **T-05** The command is `openclaw acp`; `agent.command` replaces it; `preset` is ignored; `auth` passes
- [x] **T-06** `OPENCLAW_*` and `INDABA_ACP_PASS_ENV` pass, an unrelated key does not
- [x] **T-07** `read` and `edit` are unsupported (an error in `checkPermissions`), `full` is accepted; the catalog map
- [x] **T-08** An MCP server on a step: `required` is an error in `McpPlanner.preflight`, `optional` is skipped
- [x] **T-09** `agent: openclaw` on an `acp` role is still an unknown preset; `new AcpRunner().name` is `acp`
- [x] **T-10** The registry lists `openclaw`; the readiness probe looks for the `openclaw` program
- [x] **T-11** Architecture and layers tests still green

## Documentation

- [x] **T-12** Runner tables, the two limits, Windows and the Gateway, in the docs and the README
- [x] **T-13** CHANGELOG under Unreleased; `specs/DEPENDENCY_MAP.md` (no dependency added: say so)

## Stage 7: Verification

- [ ] `pnpm qa`, `pnpm e2e` and `node scripts/check-workflow.mjs` green, output recorded in review.md
