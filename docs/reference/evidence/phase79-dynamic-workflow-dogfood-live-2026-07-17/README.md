# Phase 79 dynamic Workflow dogfood

This evidence runner uses the concise `openBaton({ repo, advanced })` surface and the new
`baton.workflow(...)` composition directly. It dispatches one Codex Attempt and two concurrent
Grok Attempts over the same WorkItem in isolated worktrees, then exercises typed feedback,
operator selection, aggregate Workflow evidence, exact Run stop, and fleet close.

It intentionally has no caller-managed token, dollar, export-byte, or file-count controls. The
deployment owns bounded safety policy and the orchestrator supplies only the repository, exact
routes, verification command, shared objective, scope, and role-labeled team.

The retained Candidates are evidence only; the runner does not apply any Candidate to the caller
checkout.

Run it with:

```sh
node docs/reference/evidence/phase79-dynamic-workflow-dogfood-live-2026-07-17/run.mjs
```

The exact Grok run fails closed before provider effects when local Grok OAuth is unavailable or
expired. `run-codex.mjs` exercises the same Workflow with two exact Codex effort routes so the new
composition can still be validated without weakening route or authentication truth:

```sh
node docs/reference/evidence/phase79-dynamic-workflow-dogfood-live-2026-07-17/run-codex.mjs
```
