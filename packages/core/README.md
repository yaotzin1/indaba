# @indaba/core

The pure domain of [Indaba](https://github.com/yaotzin1/indaba): the workflow model and its graph, step states, the mesh where agents debate to
consensus, the contracts for runners, guards, arbiters and plugins, and the tracing and logging types.

It has no dependencies and imports no `node:` module, so it runs anywhere JavaScript does.

```bash
npm install @indaba/core@next
```

## When you need it

Mostly to write a plugin. A plugin is an object with a `name` and a `register(host)` function that adds runners,
guard types, arbiters or listeners through the `PluginHost`. The contracts it implements are exported from here:

```ts
import { type Guard, GuardResult, type Plugin } from '@indaba/core';

const alwaysPasses: Guard = {
  type: 'always_passes',
  description: 'A guard that never objects.',
  async check() {
    return GuardResult.pass();
  },
};

const plugin: Plugin = {
  name: 'demo',
  register(host) {
    host.registerGuard(alwaysPasses);
  },
};
export default plugin;
```

`indaba validate --plugin ./demo.js` then accepts `type: always_passes` in a workflow. A complete plugin, with a runner
and a listener, is in [Extending](https://yaotzin1.github.io/indaba/extending.html).

Built-in runners and guards register through the same host: a plugin has no less access than a built-in, and no more.

## Related packages

- [`indaba`](https://www.npmjs.com/package/indaba): the command line, and `createEngine` to embed the engine.
- [`@indaba/engine`](https://www.npmjs.com/package/@indaba/engine): the parser, guards, engine and tracing.
- [`@indaba/runners`](https://www.npmjs.com/package/@indaba/runners): the built-in runners.

## Links

- Documentation: https://yaotzin1.github.io/indaba/
- Source, issues and changelog: https://github.com/yaotzin1/indaba

## Built by

Built by [APSW Labs](https://apswlabs.com) — creators of [Gridwright](https://github.com/yaotzin1/apsw-gridwright) (headless data grid).

## Licence

MIT
