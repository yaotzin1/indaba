# Research: TypeScript port

## Questions settled by the port

| Question | Answer |
| :--- | :--- |
| Run on Windows without Docker or WSL? | Yes: Node 22 plus pnpm; nothing else is needed on the host. |
| PTY on Windows? | `node-pty` supports ConPTY. It is optional; the piped fallback keeps every runner usable without it. To be confirmed by a CI run on `windows-latest`. |
| YAML | `yaml` package, core schema, no custom tags. |
| SSE | `fetch` with a streaming body plus the ported `SseParser`; no dependency. |
| Process tree kill | `taskkill /pid N /T /F` on win32, negative-pid signal on POSIX (spawn with `detached: true`). |
| npm names | `indaba` returned 404 on the registry on 2026-10-04 (unclaimed). The `@indaba` scope was not verified. |

## Open items (do not block implementation)

- Provenance publishing needs npm trusted publishing set up by the maintainer.
- Whether `@indaba/runners` should also split per vendor later; not needed now.
