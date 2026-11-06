# API surface: tui-editing (provisional)

> **Status**: provisional, written at stage 1. Revised 2026-11-06 after review: the injected shapes are the wire types of @indaba/core re-exported by @indaba/engine (epic rule R-02). Stage 3 replaces this file with signatures before any code; until then no symbol
> here is a contract. **Semver impact**: minor below 1.0 (see the feature's `spec.md`).

The surface is what the feature's spec names under "Where it lives": new exports of `@indaba/tui` and injected control shapes
declared in it, satisfied by `indaba`. The injected shapes mirror the ones `@indaba/server` already uses so both views share one
implementation (epic rule R-02).

## Checks

- [ ] Every type in a new public signature is public or marked `@internal`
- [ ] No `@indaba/tui` import of the CLI or of `@indaba/server`
