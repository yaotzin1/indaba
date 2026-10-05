# API surface contract: Installing ACP agents on demand

> Specification only. Nothing here exists yet; this is the contract implementation will be written
> against, and it changes only through this spec. Draft until `spec.md` section 8 is resolved.

## Semver classification

**minor** (below 1.0): new commands, one new optional workflow key, new user-level files, new exports.
Nothing existing changes meaning. A workflow without `agent: { registry }` behaves exactly as before and
never touches the network for an agent.

## Public symbols added

| Export (package, module) | Kind | Notes |
| :--- | :--- | :--- |
| `@indaba/core` `workflow/model` | field | `AgentSpec.registry?: string`, an agent id from the ACP registry; exclusive with `preset` and `command` |
| `@indaba/core` `agents` | types and functions | `RegistryAgent` and the registry schema validation, `platformKey(os, arch)`, `InstallRecord`, `ConsentRecord`; pure, no `node:` |
| `@indaba/runners` `agents` | interface | `AgentResolver { resolve(spec: AgentSpec, signal?: AbortSignal): Promise<ResolvedAgent> }`; `AcpRunner` takes one |
| `@indaba/runners` `agents` | class | `RegistryClient` (fetch, validate, cache the registry) |
| `@indaba/runners` `agents` | class | `AgentInstaller` (download, verify, extract, atomic install) |
| `@indaba/runners` `agents` | class | `AgentStore` (per-user installs and consent records) |
| `@indaba/runners` `agents` | type | `Consent = (offer: InstallOffer) => Promise<boolean>`; supplied only by a terminal front end |
| `indaba agents list` | command | installed agents: id, version, source, checksum status, license |
| `indaba agents install <id>` | command | the consent prompt, then install |
| `indaba agents remove <id>` | command | removes only what Indaba installed |

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| workflow | `agent: { registry: "<id>", auth?: "<method>" }` | new; `validate` notes that a run may use the network |
| environment | `INDABA_ACP_AUTO_INSTALL` | new; names agents (not "all") that may install without asking, only with a published checksum |
| environment | `INDABA_ACP_REGISTRY_URL` | new; overrides the registry location; environment only |
| user file | `<user data dir>/indaba/agents/<id>/<version>/` and `consents.json` | new; never in the project or a workflow |
| span event | `indaba.acp.install` | new; `acp.agent.id`, `acp.agent.version`, `acp.download.host`, `acp.checksum` (`verified` or `none`) |

## Defaults introduced

Nothing is downloaded unless the person says yes (or names the agent in `INDABA_ACP_AUTO_INSTALL`);
no workflow file can request a download. Loosening either later is a major.

## Checks

- [ ] `@indaba/core` imports no `node:` module (registry validation and platform selection are pure)
- [ ] No code path downloads without a recorded consent or an explicit environment opt-in (test)
- [ ] A hostile registry entry (bad URL, `cmd` escaping the folder, huge size, wrong host) is rejected (test)
- [ ] A hostile archive (`..`, absolute, drive letter, symlink, bomb) installs nothing (test)
- [ ] Every new dependency is open source and MIT-compatible, transitively, recorded in `research.md`
- [ ] `pnpm qa` passes with no suppression comment
