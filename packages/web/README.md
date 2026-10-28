# @indaba/web

The page of `indaba ui`: React in `.ts` files, built by Vite into static files. **Private and never published.**
Its build ships inside [`@indaba/server`](../server), with its libraries bundled.

```bash
pnpm --filter @indaba/web build    # into packages/web/dist, where a checkout's server finds it
pnpm try:ui -- --demo              # a demo project, read-only
pnpm indaba ui --root <project>    # the full page
```

How the page is built, tested and kept accessible: [docs/web-view-development.md](../../docs/web-view-development.md).
