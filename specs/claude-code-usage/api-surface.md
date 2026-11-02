# API surface: Token usage and cost from the claude-code runner

**Semver classification: minor** (below 1.0, the next preview number). No export is removed or renamed; one optional
option is added; a runner's command line and process mode change; spans that had no token or cost attributes now have
them.

## `@indaba/runners`

```ts
export interface ClaudeRunnerOptions extends CliRunnerOptions {
  readonly binary?: string;
  readonly extraArgs?: readonly string[];
  /**
   * Ask Claude Code for `--output-format stream-json --verbose` and report the tokens and the cost it prints
   * (default true). `false`, or an `extraArgs` that already holds `--output-format`, keeps the plain-text call
   * and reports nothing, as before.
   */
  readonly reportUsage?: boolean;
}

// ClaudeRunner.run(request, signal): Promise<ProcessRunResult>  (unchanged signature)
```

New, internal to the package (not exported from `index.ts`): `parseClaudeStream(stdout: string): ClaudeStreamResult`
in `claude-stream.ts`:

```ts
interface ClaudeStreamResult {
  readonly text: string;               // result.result, else the last assistant text, else ''
  readonly complete: boolean;          // a result event was found
  readonly usage?: TokenUsage;         // only when complete and well formed
  readonly costUsd?: number;
  readonly model?: string;
}
```

## `@indaba/core`, `@indaba/engine`, `indaba` (CLI)

No change. `RunResult.usage`, `RunResult.reportedCostUsd` and `RunResult.model` exist, and the step executor already
records a runner-reported cost when no price table result exists.

## Behaviour that changes

| Before | After (default) |
| :--- | :--- |
| `claude -p <prompt> <permission args> [--mcp-config ...] [--model ...]` | the same, plus `--output-format stream-json --verbose` after the prompt |
| pseudo-terminal when `node-pty` loads | pipes; `ProcessRunResult.mode` is `piped` |
| `usage`, `reportedCostUsd` absent | present when the CLI printed them |
| `output` is the terminal text with ANSI stripped | the `result` string of the final event |

## CLI, workflow file, events, span attributes

No new option, field, event or attribute.
