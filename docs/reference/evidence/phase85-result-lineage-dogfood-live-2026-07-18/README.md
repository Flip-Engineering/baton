# Phase 85 Context result-lineage dogfood — 2026-07-18

This evidence used Baton's concise `openBaton().workflow()` surface to develop Baton from the
focused red `CRL85` contract.

The first heterogeneous route request selected native Kimi Code `kimi-code/k3` at `max` effort.
Baton truthfully refused it before spawn with `authentication_refresh_required` because the cached
subscription authentication had expired. Deployment close reported zero workers, and caller status
and index were unchanged. `kimi-expired.json` preserves that non-secret preflight result.

The rerun selected two exact Codex routes in one Workflow:

- `result-lineage-builder`: `codex` / `gpt-5.6-sol` / `high`;
- `result-lineage-adversary`: `codex` / `gpt-5.6-sol` / `xhigh`.

Both Attempts were accepted as retained Candidates. The adversary patch concentrated on the closed
lineage builder/validator and compatibility boundary; the builder also proposed runtime,
application, coordination replay, and public-export wiring. Their exact Candidate IDs, retained
result refs, changed paths, patch digests, and launch/observation truth are in `evidence.json`.
Local integration reviewed both rather than automatically merging either patch and added stricter
terminal-event plus accepted-commit/capsule binding.

The Run-stop receipt proves:

- target count `2`, remaining count `0`;
- processes observed `2`, processes closed `2`, kill-confirmed `2`;
- dispatch, interactions, and Run authority closed;
- deployment close returned zero workers; and
- caller status and index were unchanged.

The resulting local slice emits successful `baton.context_call_evidence` v3 with ordered exact
source parents and provider derivations, fully reverifies it on append/replay/artifact reads, keeps
lineage out of the settlement event, preserves historical completed v2 replay without inventing
reduce eligibility, leaves failed v2 lineage-free, and derives a reduce-source identity only from a
fully verified v3 settlement. Durable generic admission and reduce provider effects remain the next
gate because current durable admission and Plan/settlement validation are still map-specific.
