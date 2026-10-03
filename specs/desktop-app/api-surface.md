# API surface contract: Desktop application

> Specification only. Nothing here exists yet; this is the contract implementation will be written
> against, and it changes only through this spec.

## Semver classification

**minor** (below 1.0): adds a separately packaged application. It changes no existing PHP class,
workflow key or command.

## Public symbols added

None in `src/`. The deliverable is a separate package:

| Name | Kind | Notes |
| :--- | :--- | :--- |
| `desktop/` | application package, not published to Packagist | shell, bundled PHP runtime, installers |
| `indaba://run/<id>` | deep-link URL scheme | opens a run in the app |

## Consumed contract

The run API of `specs/run-api` (the same one `specs/web-app` consumes), over loopback with a
per-launch bearer token. The app adds nothing to that contract.

## Native bridge (renderer to shell), a closed list

| Operation | Purpose |
| :--- | :--- |
| `pickDirectory()` | choose the project root |
| `getSecret(name)`, `setSecret(name, value)`, `deleteSecret(name)` | OS keychain |
| `notify(kind, runId)` | completed, failed, escalated |
| `openExternal(url)` | `https` links in the system browser |
| `diagnostics()` | git, agent CLIs, PTY availability, write access |

No operation takes a command line, a path outside a user-chosen directory, or arbitrary script.

## Workflow schema, CLI, events and attributes

No change.

## Defaults introduced

Loopback only, random port, per-launch token, update checks on and signed, no telemetry. Changing any
of them later is a major.
