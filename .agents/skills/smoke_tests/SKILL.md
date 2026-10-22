---
name: smoke_tests
description: Use when verifying the installed package rather than the source tree, or changing a package's files, exports or bin entry. Covers the packed-install smoke test and the published-files audit.
---

# Built-Artifact Verification Specialist

A green unit suite proves the source works with the development tree around it. It says nothing
about what a consumer receives: the compiled `dist`, the `exports` maps, the `bin` entry, the files
in each tarball and the runtime dependencies without the dev toolchain.

## What the artifact is

Six npm tarballs (`indaba`, `@indaba/core`, `@indaba/engine`, `@indaba/runners`, `@indaba/tui`,
`@indaba/server`) produced by `pnpm pack`, which rewrites `workspace:` ranges to real versions. The
private `@indaba/web` is never packed: its build ships inside `@indaba/server`, in `page/`, staged by
the server's `prepack` (`scripts/stage-page.mjs`, which also writes the licences of every bundled
library to `page/THIRD-PARTY-LICENSES.txt`) and removed again by its `postpack`.

## The smoke test

```bash
pnpm build
pnpm smoke
```

`scripts/smoke-pack.mjs` packs every published package under `packages/`, audits each tarball's
files, and installs the tarballs twice into empty temporary projects. With `indaba` alone, the
optional `@indaba/tui` and `@indaba/server` must be absent, and `indaba --version`, `indaba validate`
on an example and `indaba ui` (which must say what to install) must behave. With everything, the
installed `@indaba/server` must find the page in its own package. It must be started through
pnpm so `npm_execpath` names pnpm's own script: Node refuses to start a `.cmd` shim without a shell,
and this repository never uses a shell for that. CI runs it on Linux, Windows and macOS as a step of
the verify job.

It proves: each tarball contains what its `exports` and `bin` name, the dependency list is
sufficient without dev dependencies, imports resolve across packages, and the CLI boots. Extend it
with a tiny workflow run through `ShellRunner` when that adds coverage.

## The published-files audit

The smoke test runs it on every tarball (`auditFiles` in `scripts/smoke-pack.mjs`, with its own
tests): anything but `dist/**/*.js`, `*.d.ts`, their maps, `package.json`, `README.md` and `LICENSE`
fails, except `page/**` in `@indaba/server`, which must also hold `page/index.html`, a script under
`page/assets/` and `page/THIRD-PARTY-LICENSES.txt`. Each package's `files` is `["dist"]`
(`@indaba/server` adds `"page"`). To read what would ship by hand:

```bash
pnpm --filter @indaba/core pack --pack-destination <tmp>
tar -tf <tmp>/indaba-core-0.1.0.tgz
```

`dist/**`, `package.json`, `README.md` and `LICENSE` belong; tests, specs, `.agents`, `.indaba`, a
stray `.env` or a `node_modules` directory are a leak.

## When to run it

Any change to a `package.json` (`files`, `exports`, `bin`, `dependencies`), a `tsconfig.build.json`,
the build script, or a new runtime dependency; and before every release.

## Known limit

`pnpm smoke` needs `dist/`, so it runs after `pnpm build`. It tests the packed install, not the
registry: it cannot show that a published version resolves from npm.
