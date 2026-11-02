# Plan: Token usage and cost from the claude-code runner

## What was checked on the real CLI (Claude Code 2.1.316)

`claude -p "..." --output-format stream-json --verbose --permission-mode plan` prints one JSON object per line:
`system/init`, `assistant` (content blocks of type `thinking`, `tool_use`, `text`), `user` (tool results),
`rate_limit_event`, and last `result/success` holding `result` (string), `total_cost_usd` (number), `usage`
(`input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`, ...) and `modelUsage`
(an object keyed by model name). `--output-format json` gives the final object only; `stream-json` is chosen because it
still shows the last assistant text when the process is killed before the `result` event.

## Steps

1. `claude-stream.ts`: `parseClaudeStream`, a pure function over the stdout text.
2. `ClaudeRunner`: option `reportUsage`; `build` appends the two flags; `run` is overridden to execute on pipes with
   an `onOutput` that is held back, then to build the result from `parseClaudeStream` and forward the text once.
3. Tests against `FakeSpawner` only (no real CLI in the suite).
4. Docs: `docs/getting-started.md` (cost paragraph), the cookbook cost paragraph, `README.md` if it lists usage,
   `CHANGELOG.md`, `specs/step-budgets/spec.md` item 14 (one line), playbooks, `llms.txt`.

## Analysis (stage 5)

- Signature break: none; one optional option.
- `node:` in core: none touched.
- Dependency: none.
- Untrusted data: parsed JSON read by named, type-checked fields; never reaches a shell, path or log.
- Clock, randomness, environment: none.
- Unbounded buffer: the stdout already held by `executeProcess`; the parser makes one pass and keeps one line at a time.
