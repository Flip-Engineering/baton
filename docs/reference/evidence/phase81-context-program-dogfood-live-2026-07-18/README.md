# Phase 81 Context Program live dogfood

Run from the repository root:

```sh
rtk node docs/reference/evidence/phase81-context-program-dogfood-live-2026-07-18/run.mjs
```

The runner uses Baton's ordinary deployment surface and effective-tree snapshot. It dispatches one
Codex `gpt-5.6-sol` low-effort architect and one native Kimi Code `kimi-code/k3` high-effort
adversary in parallel, then applies typed feedback through one Kimi successor Plan. It emits a
compact semantic/evidence summary and always attempts Workflow stop plus deployment-wide reap. No
caller budget, recursion, export, file-size, storage, provider-turn, or wall-time controls are
required.

The runner internally owns and removes one ephemeral deployment state root. The initial live
attempt without that isolation exposed a default-state compatibility collision before provider
launch; that is retained as product friction rather than becoming another caller-managed option.
The first interrupted Kimi attempt also proved restart recovery and exact reap, while exposing that
a one-shot `once` signal listener could let a repeated terminal signal exit before awaited cleanup;
the runner now keeps idempotent signal handlers installed through close.

This is a live authenticated provider test. It relies on the existing Codex and Kimi Code login
state and does not contain or request an API key.
