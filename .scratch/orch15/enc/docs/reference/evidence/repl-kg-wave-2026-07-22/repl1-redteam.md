# Red-team report: repl1-decisions.md (v1) — verdict: NEEDS REVISION

Every finding MUST be resolved in v2 or explicitly rebutted with file:line code evidence.

## P0-1..3 (one coherent fix — the "reuse verbatim" premise is false at 5 Workflow-coupled sites)

1. `contextSessionIdentity` (context-authority.mjs:82-90) calls `normalizeContextManifest` and
   reads `normalizedManifest.workflow.runId` — a baton.repl_manifest object throws at the
   exact-field/kind check (context-program.mjs:193-195). The `_apply` fold of
   `context.session_admitted` re-validates via `_validateContextSessionPayload(p, event, true)`
   (coordination-store.mjs:7318 → :4818), recomputing identity (:4844) and hard-requiring
   goal+plan+`approval?.disposition === 'approved'` (:4887-4906). An honest REPL session event
   throws `context_session_integrity` on replay.
2. `DurableContextSession` constructor hard-codes `normalizeContextManifest(manifest,
   bench.policy)` (context-program.mjs:1187) and calls `coordination.admitContextSession`
   (:1190-1192) which refuses plan-less manifests (coordination-store.mjs:8904-8913).
3. The cell path refuses REPL sessions at two more sites: `admitContextCell` →
   `contextCellIdentity` → `contextProgramInputRefs` → `normalizeContextManifest(session.manifest)`
   (context-authority.mjs:61, :114-115); and `_validateContextCellAdmissionPayload` calls
   `_assertContextSessionCurrent` (coordination-store.mjs:5003 → :4765-4816) demanding
   goal/plan/approval + working task + dispatch binding (:4799-4813).

FIX (one coherent change): a kind-dispatching `normalizeManifestAny` used SYMMETRICALLY at
admission and fold (context-authority.mjs:61, :82; context-program.mjs:1187); a repl branch in
`_validateContextSessionPayload` that skips goal/plan/approval and instead requires the settled
`repl.manifest_admitted` record (replay-derivable — its map folds first); a repl branch in
`_assertContextSessionCurrent` keyed to the admission record (not a working dispatch);
`DurableContextSession` accepts an injected session-admission function or a pre-admitted
session (contract must say WHICH). Reword "evaluator untouched / byte-for-byte unchanged":
name these as authority-layer edits, enumerated.

## P1-4 — cross-run shared-authority bleed

The lease lookup takes {repoId, principalId, sessionId, expiresAt} — NO runId
(coordination-store.mjs:1488-1513; mcp-northbound.mjs:1013-1019). Leases are run-scoped
(`parentRunId`, :1254-1256). FIX: pin `lease.parent.runId === payload.runId`, else
`repl_manifest_authority_denied`; red test (lease for run X, manifest for run Y).

## P1-5 — rule 7 self-contradiction + under-threaded auth

replRole is digest-covered, so the wrapper cannot "force the suffix" without changing the
digest; rewriting the payload field trips the mismatch refusal. Store-side check needs wrapper
identity in auth, but the precedent passes only `{actor, key}` (coordinator.mjs:9159-9160) —
no principalId/repoId/runId, which `normalizeContextAuthority` requires
(context-authority.mjs:26-41). FIX: wrapper derives principalId/repoId/runId from the worker
handle's task and threads them as auth; replRole passes through; the STORE compares
`payload.replRole === 'worker:' + auth.principalId`. Pin the exact error code in the red test
(currently unpinned → vacuous).

## P1-6 — re-admission of same manifestDigest is last-wins

`_replManifestAdmissions` keyed by manifestDigest; idempotency keys on auth.key only. A second
admission under a new key/principal silently overwrites, shifting principal under an existing
session. FIX: same digest + identical core → idempotent; divergent principal/runId →
`repl_manifest_conflict`; add the red test.

## P1-7 — one REPL session wedges Workflow openSession

Existing scans dereference `session.manifest.workflow.*` unguarded over `_contextSessions`:
context-runtime.mjs:1204-1209, application.mjs:8534, :8545, :7368. A repl manifest has no
`.workflow` → bare TypeError in the Workflow path. FIX: `manifest.kind ===
'baton.context_manifest'` guards in all sites; red test: REPL session present → Workflow
openSession still succeeds.

## P1-8 — no replay-symmetry red test

FIX: add "admit REPL session + cell → reload from ledger → projection rebuilds → cell
settleable" to the red-test list.

## P2

9. Rule 8(d) cross-ref is broken (run-stop is rule 14, not "Part D rule 12").
10. Kind-inventory "drives _apply with every declared kind" is impractical; pin the static
    mechanism (extract `event.kind ===` literals from `_apply`, cross-check against checkpoint
    fields).
11. replRole worker regex is stricter than SafeId (`:` allowed, context-program.mjs:18) — pin
    the narrower grammar deliberately.
12. `principal` repoId provenance unpinned (mirror the Workflow path's
    `authority.repoId !== this._repoId` check, coordination-store.mjs:4865);
    `MAX_REPL_MANIFESTS_PER_RUN` has no named home or default.

Verified accurate (keep): digest-basis disjointness; delete-and-recompute discipline; branch
reuse; run-stop preamble shape; checkpoint field-exact write+load; principal pinning
:9017-9020; wrapper precedent; unknown-kind throw; snapshot conditional pattern; docs/33 cites.
