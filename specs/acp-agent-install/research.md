# Research: Installing ACP agents on demand

> Stage 2 artifact, 2026-10-05. "Measured" means computed from the real registry file or from npm metadata
> fetched today. "Observed" means read from this machine's own files. Nothing was downloaded or run except
> a read-only `initialize` handshake with an already installed agent.

## The registry

Source: `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json` (56 KB, HTTP 200).

### Measured

- Top level: `version` (`1.0.0`), `agents` (41), `extensions` (empty).
- Per agent: `id, name, version, description, repository, website, authors, license, license_url,
  distribution, icon`. All 41 have a `license_url`.
- `distribution` kinds: `npx` (22 agents), `binary` (19), `uvx` (2). An `npx` entry pins an exact package and
  version, for example `@agentclientprotocol/claude-agent-acp@0.85.1`, or `@google/gemini-cli@0.62.0` with
  `args: ["--acp"]`. A `uvx` entry pins a package too (`fast-agent-acp==0.10.1`, `minion-code@0.1.44`).
- `binary` entries are keyed by platform (`darwin-aarch64`, `darwin-x86_64`, `linux-x86_64`,
  `linux-aarch64`, `windows-x86_64`, `windows-aarch64`), each with `archive` (a URL), `cmd` (a path inside
  the archive), optional `args`, `env`, and optional `sha256`.
- Of 101 binary targets, **53 publish a `sha256` and 48 do not**; 9 of the 19 binary agents have at least one
  target without one. Antigravity's entries publish none.
- Archive formats across binary targets: `tar.gz` 59, `zip` 34, `tar.bz2` 4, bare executable 2, other 2.
- Download hosts: `github.com` 71, and 6 each for `dl.google.com`, `sfc-repo.snowflakecomputing.com`,
  `downloads.cursor.com`, `static.devin.ai`, `downloads.poolside.ai`. GitHub release URLs redirect to other
  hosts, so an allowlist must cover the redirect targets or follow redirects only to allowlisted hosts.
- Licenses declared: Apache-2.0 15 (plus one written `Apache 2.0`), MIT 8, proprietary 15 (two spellings),
  GPL-3.0-or-later 1, AGPL-3.0 1.
- Antigravity, today: `antigravity-acp` **1.3.0**, `proprietary`, `license_url` `https://antigravity.google/terms`,
  Google LLC, `.zip` archives from `dl.google.com`, `cmd` `./agy_acp_server.exe` on Windows (`.par` elsewhere,
  with `--uid=` on Linux).

### Observed on this machine

- JetBrains installed Antigravity ACP versions 1.0.0 and 1.1.1 under
  `<user local data>/JetBrains/<IDE and version>/acp-agents/antigravity-acp/<version>/`; the 1.1.1 executable is
  about 430 MB. JetBrains' own record for it has `sha256: null` and a field for an accepted terms-of-service
  version, so an editor already asks for consent and records it.
- A read-only `initialize` of that executable returned protocol version 1 and four login methods
  (`oauth-personal`, `oauth-business`, `gemini-api-key`, `agent-platform`), and it has stored credentials in
  `~/.gemini/antigravity-acp/`. It starts as a native `.exe`, so the Windows `npx` shim problem does not arise
  for binary agents.

## Archive extraction

Binary agents need unpacking. A 430 MB archive must not be read into memory.

| Option | License | Notes |
| :--- | :--- | :--- |
| `yauzl` 3.4.0 | MIT | streaming zip reader; one dependency (`buffer-crc32`, to be license-checked); the safe choice for the large Antigravity zip |
| `fflate` 0.8.3 | MIT | no dependencies; its simple unzip works on whole buffers, so unsuited to 430 MB; streaming API exists but is more code |
| `adm-zip` 0.6.1 | MIT | no dependencies; reads the whole archive into memory; unsuited |
| `unzipper` 0.12.5 | MIT | five dependencies; heavier than needed |
| `extract-zip` 2.0.1 | BSD-2-Clause | built on `yauzl`; not updated since 2023 |
| `tar` 7.5.22 | BlueOak-1.0.0 | permissive and OSI-approved, but **not MIT**: a maintainer decision under the licensing rule |
| own tar reader on `node:zlib` | none (our code) | about 100 lines for `tar.gz`; zip-slip and link tests required |

*Recommended:* `yauzl` for zip (after checking `buffer-crc32`'s license), and Indaba's own small `tar.gz`
reader on `node:zlib`, so the one non-MIT candidate (`tar`) is avoided. `tar.bz2` (4 targets) and other
formats are **not supported in v1**: such an agent is a runner that could not run, with the message to install
it by hand and use `agent: { command: [...] }`. Bare executables need no extraction.

## Security notes that shape the spec

- **Zip slip** (entries named `../x`, absolute paths, drive letters, `\` separators on Windows) and **link
  entries** are the classic extraction attacks: every entry is resolved against the target folder and
  refused if it leaves it or is not a regular file or folder.
- **Decompression bombs**: cap the total uncompressed size and the file count; check while streaming.
- **No checksum** on about half the entries means integrity rests on TLS to the publisher's host; pinning the
  digest that was received (and asking again when it changes) is the only protection against a silent swap.
- **Redirects**: follow them manually, re-checking the host and `https:` at each hop.
- The registry file is untrusted input: validate its shape, never use a URL or `cmd` from it without the
  checks above, and show its text with control characters removed.

## Reported, not verified

- That other editors (Zed and others) use this registry the same way JetBrains does. Only JetBrains' files
  were read here.

## Open after research

- `buffer-crc32` license, and a trial of `yauzl` against the real 430 MB Antigravity zip (memory and time).
- Whether the registry offers anything like a signature in a later schema version.
- Where each OS expects per-user application data, and what happens on a read-only home.

## Sources

- `registry.json` fetched on 2026-10-05 and analysed locally (counts above).
- `npm view` metadata for `yauzl`, `fflate`, `adm-zip`, `extract-zip`, `unzipper`, `tar`.
- The JetBrains IDE's own files on the machine where this was measured: its `acp-agents/installed.json`
  record, its `acp-agents` install folders and its ACP agent list (no secrets read). Their exact locations
  depend on the operating system and the IDE version and are deliberately not given here.
