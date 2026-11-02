# Tasks: Token usage and cost from the claude-code runner

- [x] **T-01** tests for `parseClaudeStream` (result found, no result, garbage lines, bad numbers, one and many models, cache sum)
- [x] **T-02** `claude-stream.ts` makes T-01 pass
- [x] **T-03** tests for `ClaudeRunner`: flags, pipes, output, usage, cost, model, `onOutput` once, exit codes, timeout, abort, opt-out, `extraArgs` with `--output-format`, MCP and permission arguments unchanged
- [x] **T-04** `ClaudeRunner` option and `run` override make T-03 pass
- [x] **T-05** update existing tests that assert the old command line
- [x] **T-06** an engine-level test that a runner-reported cost and usage land on the span (AC-12), if none exists
- [x] **T-07** docs: getting-started, CHANGELOG, step-budgets item 14, the step-stalls note, docs site (llms.txt is generated from the pages). Not here: the cookbook cost paragraph, which is on PR #109 and is updated after it merges
- [x] **T-08** `pnpm qa`, node gates, `pnpm e2e`, a real run of one step (manual) to compare tokens with the CLI's own figure
- [x] **T-09** `review.md`
