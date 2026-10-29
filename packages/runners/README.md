# @indaba/runners

The built-in runners of [Indaba](https://github.com/yaotzin1/indaba): what turns a step of a workflow into work by an agent, a model or a command.
A workflow names one, or a list to fall back through (`runner: ["acp", "claude-code"]`).

```bash
npm install @indaba/runners@next
```

| Name in a workflow | What it runs |
| :--- | :--- |
| `shell` | Commands, started with argument arrays and never a shell string |
| `claude-code`, `codex`, `cursor`, `antigravity`, `opencode` | The agent's command line |
| `acp` | An agent that speaks the Agent Client Protocol, with a per-request permission gate |
| `openrouter` | A model on OpenRouter, streamed over Server-Sent Events |
| any name you configure | An OpenAI-compatible endpoint (`INDABA_OPENAI_COMPAT_<NAME>_BASE_URL`) |

Each runner reports tokens and cost where its source gives them, honours the step's timeout and cancellation, and
maps a step's permission level (`read`, `edit`, `full`) to its own flags where it can.
`indaba catalog` lists what each one supports.

## Most people want `indaba` instead

The [`indaba`](https://www.npmjs.com/package/indaba) package registers these runners for you. Use this package to
compose your own engine, or to build a runner of your own on `AbstractCliRunner` or `OpenAiCompatibleRunner`
and register it from a plugin ([Extending](https://yaotzin1.github.io/indaba/extending.html)).

Which runner to choose for which job: [Using the alpha](https://yaotzin1.github.io/indaba/using-the-alpha.html).

## Links

- Documentation: https://yaotzin1.github.io/indaba/
- Source, issues and changelog: https://github.com/yaotzin1/indaba

## Built by

Built by [APSW Labs](https://apswlabs.com) — creators of [Gridwright](https://github.com/yaotzin1/apsw-gridwright) (React data grid).

## Licence

MIT
