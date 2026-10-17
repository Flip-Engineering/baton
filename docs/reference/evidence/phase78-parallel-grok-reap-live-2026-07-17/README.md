# Phase 78 parallel Grok selective-reap evidence — 2026-07-17

Command:

```sh
node docs/reference/evidence/phase78-parallel-grok-reap-live-2026-07-17/run.mjs
```

Two exact `grok / grok-4.5 / high` Runs were admitted concurrently through one bound Run group.
Baton selectively stopped the first Run while allowing the sibling to continue, then joined
deployment close with no remaining workers.

- stopped Run: `run-42cebf5baecb4e0377d7cb8e4f656467`
- sibling Run: `run-fa749079aa7d3a7def449af1de61a670`
- admission phases: `running`, `running`
- selective result: first Run `stopped`; sibling `failed`
- exact close: `{workers:0, workerIds:[], closed:true}`
- close/reopen inspection: both Runs own zero local resources and advertise no stale stop action

The sibling failure is intentionally not called a provider success: Baton's Run cascade typed it
as `authentication_required`. The installed Grok 0.2.99 auth record contains one expired RFC3339
expiry and its silent refresh had failed. Dogfood therefore added bounded static Grok-auth
readiness; current `baton doctor` reports every Grok 4.5 effort
`authentication_refresh_required` before worktree or process creation, with ordinary
`grok login` remediation and no credential/path projection.

This is a green concurrent admission/selective stop/exact reap proof and a red provider-work proof.
The provider-work gate remains pending until Grok login is refreshed; literal Grok Build also
remains red until the provider actually observes that exact model identity.
