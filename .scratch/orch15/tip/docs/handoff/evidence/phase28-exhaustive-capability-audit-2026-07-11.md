# Phase 28 exhaustive capability audit evidence — 2026-07-11

## Outcome

The full-system goal is not complete. The control/trust/coordination/web-MCP spine is real;
capability-plane product wiring and several session/governance/trust/northbound/runtime depths are
not. `docs/28-exhaustive-capability-audit.md` is the current synthesis. The historical 107-row
Phase-10 matrix remains an inventory but is explicitly superseded for status.

## Independent recursive audit

Exact `grok-4.5` and `grok-composer-2.5-fast` audited concurrently through Baton at `e07f5ab`.
Provider identities were observed on distinct overlapping PIDs; both reports were freshly
sparse-verified; both normal kills were confirmed; every process, worktree, runtime, and branch was
reaped. The wiring auditor produced a 71-row primary matrix; the catalog auditor produced an
83-row expanded matrix and independently identified the stale Phase-10 status hazard. Evidence is
under `docs/reference/evidence/phase28-exhaustive-capability-audit-grok-review-2026-07-11/`.

## Grounded correction

Direct inspection of `impl/src/index.mjs` confirms that `createDriver()` constructs the
coordinator, worktree/referee, router, story, runtime isolation, and coordination authority. Atlas
classes are exports only; there is no `new Atlas*` assembly or coordinator/web/MCP invocation
path. No Vantage, Skill Forge, Cartographer, Quartermaster, Cairn, or Evidence Ladder product class
exists under `impl/src`. Those facts control the partial/pending labels even where focused module
tests are green.

## Next gate

Phase 29 should make existing Atlas operations public fleet capabilities before adding another
standalone analysis module. Acceptance requires one coordinator-owned registry/invoke authority,
ACI envelopes, cancellation/budgets/provenance/reverify, authenticated northbound mapping, and
explicit proof that CPG/fingerprint/policy outputs cannot authorize verification bypass or merge.
