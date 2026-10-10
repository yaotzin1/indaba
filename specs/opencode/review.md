# Self-review: <feature name>

> **Status**: pending self-review (implementation done 2026-10-08; the seven answers are not written yet)

Answer all seven. See [`.agents/rules/review.md`](../../.agents/rules/review.md). Do not write
answers for a review that has not happened: leave the status above and the sections empty until it
has.

## 1. Boundary and layering

## 2. Determinism and failure isolation

## 3. Public surface and semver

## 4. Security

## 5. Observability and honest numbers

## 6. Dependencies and packaging

## 7. Verification

```
<paste the actual output of: pnpm qa, and node scripts/check-workflow.mjs>
```

## Known gaps

- Verified by hand 2026-10-08 against OpenCode 1.18.35: `opencode run --help` shows `--model`, `--auto` and the
  positional message; an ACP step with `agent: { command: [<native opencode.exe>, "acp"] }` completed (task
  `oc-1`, reply "OK", cost shown as $0.0000 because the protocol reported none). Not verified: the `opencode`
  preset by name, the `opencode` CLI runner, a role `model` over ACP.
- On Windows `opencode` on PATH is an npm `.cmd` shim that Indaba cannot start, so the preset and the CLI
  runner need the native `opencode.exe`. The preset can be bypassed with `agent.command`; the CLI runner has
  no workflow-level way to set its binary (`codex` and `antigravity` have `INDABA_*_CMD`). No `INDABA_OPENCODE_CMD` is added (maintainer, 2026-10-08): Windows users take ACP with the native exe, or
  install Indaba in WSL.
