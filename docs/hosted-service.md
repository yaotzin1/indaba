# A hosted Indaba: what it would need

Not planned, not specified, and not built. This page exists so the idea has a home and so the local work leaves the
right seams. It was written on 2026-10-12 after the maintainer decided that the local web view comes first and that a
hosted service is a different product: one that connects to a repository and does the work in the cloud, with no link to
anyone's machine.

## What it is

A service where a person signs in, connects a repository, picks or creates a workflow and runs it. The service clones the
repository, runs the agents in isolation, shows the same graph, board and cost the local view shows, and returns the
result as a branch or a pull request. Nothing runs on the person's computer.

## Why it is a different product

The engine would be the same. Everything around it is new, and the local specifications deliberately do not try to be
it (`specs/web-app` is loopback only, one person, one machine).

| Needed | Why local does not give it |
| :--- | :--- |
| Accounts and sign-in (OpenID Connect or own accounts) | the local view has one person and a token |
| Tenancy: one person's runs, files and keys invisible to another | the local view has one file tree |
| Repository access: a GitHub App or OAuth, tokens stored encrypted, scoped to the repositories chosen | the local view uses the folder it is given |
| **Isolation of every agent, enforced, with no way to opt out** | locally, `sandbox: none` is the default |
| A store and a job queue that survive restarts and many users | locally, files and one process |
| Secrets: whose API key pays for a run, how it is stored, quotas and caps | locally, environment variables |
| Operations: hosting cost, abuse handling, updates, a security review | none locally |

## The seams the local work keeps

These cost little now and are what make a hosted version possible without rewriting the local one.

1. **`WorkflowRegistry`** is a contract (`specs/workflow-registry`). A hosted store is a plugin.
2. **`Workspace` and `TrackedWorkspace`** are contracts (`specs/git-workspace`, `specs/workspace-without-git`). A hosted
   run supplies a cloned workspace; the engine does not know where it came from.
3. **`SandboxBackend`** is a contract (`specs/agent-sandbox`), with a policy that can forbid `sandbox: none`. A hosted
   service sets that policy and picks a `vm` backend for hostile tenants.
4. **One API between page and engine** (`specs/web-app`). The page does not know whether the engine is on the same
   machine, so the same page can later talk to a remote one.
5. **An `AuthProvider` contract**, to be specified when the hosted service is: sign-in is a way to answer "who is this",
   so OpenID, own accounts and a plain token are three providers, not three designs. The local view uses the token.
6. **Files as the format of a run.** Traces, the board and artifacts are files; a hosted store can keep the same
   records in object storage and a database.

## What the isolation requirement means here

Running other people's agents on shared machines is the case `specs/agent-sandbox` is written for. A container shares the
host kernel and is not enough for hostile tenants on its own, so the hosted service would use a virtual machine per run
(or per tenant) and a plugin backend for it. The built-in container backend and the policy mechanism exist now so that
this is a backend to add and not a redesign.

## Decisions waiting

| Decision | Matters for |
| :--- | :--- |
| Whether the hosted part is open source under the same licence or a separate, closed product | the repository layout and the licence of any code written for it |
| Which sign-in to support first (OpenID provider, own accounts, or GitHub only) | the `AuthProvider` spec |
| Whose API key pays: the person's own, or the service's with metering | the secrets design and billing |
| Which VM technology and which host | the `vm` backend plugin |
| Whether to host at all, or to offer a self-hosted package people run on their own server | everything above |

The last row is worth settling first: a self-hosted package needs the same seams and none of the operations.
