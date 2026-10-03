# API surface contract: MCP support

## Semver classification

**minor** (below 1.0): new optional workflow keys and new public classes. No existing default changes:
a workflow that declares no MCP behaves exactly as before.

## Public symbols added

| Name (FQCN) | Kind | Notes |
| :--- | :--- | :--- |
| `Indaba\Workflow\Model\McpServerDefinition` | final readonly class | `name`, `command`, `args`, `env`, `url` |
| `Indaba\Workflow\Model\McpPolicy` | enum | `Required`, `Optional` |
| `Indaba\Runners\McpCapability` | enum | `Injected`, `AgentManaged`, `None` |
| `Indaba\Runners\McpCapable` | interface | `mcpCapability(): McpCapability`; implemented by runners that can say |
| `Indaba\Workflow\Engine\McpPlanner` | final readonly class | per-step resolution and workflow preflight |
| `Indaba\Workflow\Engine\McpIssue` | final readonly class | one preflight finding |
| `Indaba\Core\Exception\McpUnavailableException` | exception | a required server cannot be provided |

Changed (additive, defaulted parameters at the end): `WorkflowDefinition` (`mcpServers`,
`defaultMcpPolicy`), `StepDefinition` (`mcp`, `mcpPolicy`), `RoleDefinition` (`mcp`), `RunRequest`
(`mcpServers`), `StepExecutor` and `RunnerParticipant` (receive the servers to pass).

## Workflow schema

| Key | Meaning |
| :--- | :--- |
| `mcp_servers.<name>` | `command`, `args`, `env` or `url` |
| `defaults.mcp_policy` | `required` (default) or `optional` |
| `roles.<r>.mcp`, `steps[].mcp` | list of server names |
| `steps[].mcp_policy` | overrides the workflow default for that step |

## CLI

`bin/indaba plan` prints MCP findings and exits `1` when one is an error.

## Span attributes (names only, never values)

`indaba.mcp.servers`, `indaba.mcp.assumed`, `indaba.mcp.skipped`: comma-separated server names.

## Defaults introduced

`required`. Changing it is a major.

## Internal helpers (not public surface)

`Indaba\Runners\McpConfigWriter` (per-agent translation), `Indaba\Runners\PreparedCommand` (a command and
the temporary files to delete), `Indaba\Workflow\Engine\McpResolution` (per-step result). Marked
`@internal` in review.

Changed signatures to confirm in review: `CommandRunner::__construct` gains `McpCapability $mcp` before
`$usePty`; `AbstractCliRunner` gains the protected `prepare()` hook.
