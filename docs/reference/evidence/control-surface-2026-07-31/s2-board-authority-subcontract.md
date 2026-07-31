# S-2 board/package authority sub-contract — one shared admission primitive (v1)

(Successor contract named by the control-surface v2 (R-CS-1, P0): v1 of the CS contract
would have let a facade board write bypass the MCP session-lease posture and board-fence
CAS — the checks live in the MCP ADAPTER (`mcp-northbound.mjs:1332-1361,1430-1448`), while
`Coordinator.postBoardItem` defaults `actor: 'orchestrator'` and forwards straight to the
store (`coordinator.mjs:9703-9725`), and the store checks neither lease nor fence for
orchestrator mutations (`coordination-store.mjs:13391-13411,13465-13483`). This contract
pins the shared primitive BEFORE any new surface gets board/package mutation. Security-
reviewed by construction: every rule names its negative-test battery. Sibling: S-3 owns the
registry-delta matrix that maps operations to profiles/surfaces ON TOP of this primitive;
this contract owns the primitive itself + the ghost-row reconciliation.)

## Ground truth

1. **The guard lives in the wrong layer.** MCP's board dispatch does the active
   session-bound orchestrator-lease lookup and the board-fence comparison adapter-side,
   synchronously with the coordinator call (one turn — no TOCTOU). Any second surface
   (embedded facade, CLI, web) reaching the same coordinator wrappers inherits NONE of it.
2. **The lease machinery exists and is session-bound.** Run-orchestrator leases bind
   `{repoId, principalId, sessionId, expiresAt}` and revalidate session authority, parent
   task, and Run admission (`coordination-store.mjs:1759-1889`, lookup revalidation at
   `:1818-1842`).
3. **The ghost rows fork the schema.** The v2 registry's board rows
   (`application-semantics.mjs:1231-1289`) carry `runId/entryId/note/before` with optional
   `expectedBoardFence`, defaulting to profile `ordinary` + ALL_SURFACES
   (`application-semantics.mjs:1501-1526`); the live MCP schema carries
   `board/itemId/detail/ordinal` with REQUIRED `expectedBoardFence`
   (`mcp-northbound.mjs:485-527`). Both cannot be the canonical shape.
4. **Actor defaulting is an authority hole.** `Coordinator.postBoardItem`'s
   `actor: 'orchestrator'` default means any caller that omits the actor writes AS the
   orchestrator. The primitive must never default an untrusted caller to orchestrator.

## The question

Where does board/package mutation authority LIVE so that every present and future surface
inherits exactly one enforcement — lease proof, fence CAS, idempotency, actor honesty —
with zero per-surface reimplementation? Answer: one shared admission primitive inside the
application/coordinator command path, with the MCP guards retiring to thin adapters.

## Rules

1. **One admission primitive, in the serialized command path.** A single coordinator-level
   admission function guards every board/package mutation from any surface. Per call it:
   (a) accepts a CLOSED session-authority envelope `{principal {actor, principalId,
   sessionId}, runId, board/item coordinates, mutation, expectedBoardFence,
   idempotencyKey}` — unknown fields refused; (b) resolves and REVALIDATES the active
   run-orchestrator lease at mutation admission (session authority, parent task, Run
   admission, expiry — `coordination-store.mjs:1818-1842`), in the SAME serialized command
   path as the mutation (no async gap between check and write — the TOCTOU bar); (c)
   compares `expectedBoardFence` against the live board fence inside the same admission
   (CAS); (d) binds the idempotency key to the NORMALIZED request (replay-same returns the
   prior receipt; replay-conflict refuses); (e) derives `actor` ONLY from the validated
   envelope's principal — never defaulted to `orchestrator` (an envelope naming
   `orchestrator` without a lease proving that principal's orchestrator lease for this Run
   refuses).
2. **Pinned refusal order and codes.** Exact precedence: `board_admission_invalid` (shape)
   → `board_lease_required` (no/expired lease) → `board_session_mismatch` (wrong
   session/principal) → `board_run_closed` (Run terminal/closed) → `stale_board_fence`
   (CAS) → `board_parent_stale` (retitle/reorder/close against a superseded item version)
   → replay-same receipt / `board_replay_conflict`. Every code is typed; the order is
   test-pinned because implementers will otherwise leak existence across checks.
3. **The MCP guards retire to thin adapters.** `mcp-northbound.mjs:1332-1361,1430-1448`'s
   bespoke lease/fence checks DELETE; the MCP tools translate the tool call into the closed
   envelope and call the primitive (capability + stateful admission per the MCP layer's
   existing discipline stays — that is transport, not authority). Source-scan pinned: the
   adapter carries no lease/fence logic of its own.
4. **The embedded facade obtains session authority honestly.** A facade caller holds an
   in-process principal; the primitive acquires the run-orchestrator lease for that
   principal via the EXISTING lease-acquisition path (`coordination-store.mjs:1759-1889`)
   — acquisition is explicit (a facade `boards.lease(runId)` or first-mutation implicit
   acquisition with the lease receipt returned; the choice is pinned by test), bounded by
   the lease TTL, and revoked on Run close. No ambient authority: a facade that never
   acquired a lease gets `board_lease_required`.
5. **Ghost-row reconciliation.** The registry board rows are rewritten to the LIVE
   executable schema (`board/itemId/detail/ordinal`, required `expectedBoardFence`) or
   removed where no operation exists — per the S-3 registry-delta matrix, which consumes
   this primitive. Package rows likewise reconcile to the store's actual admit/attach
   shapes (`coordination-store.mjs:9342-9448`). No row may advertise a surface until its
   primitive-backed operation exists (the ghost-surface ban).
6. **Packages share the primitive's envelope.** Context-package admit/attach ride the same
   session-authority envelope + lease revalidation (their store paths,
   `coordination-store.mjs:9325-9450`, today rely on Context Program authority); the package
   authority key pinning stays, unified under the one envelope.

## Red-first tests — `impl/test/board-authority-red.test.mjs`

The negative battery (each one exact-code, exact-order):
1. **BA-1 shape:** unknown field / missing envelope field / oversize →
   `board_admission_invalid`.
2. **BA-2 lease:** no lease, expired lease, revoked lease → `board_lease_required`.
3. **BA-3 session:** valid lease, wrong sessionId / wrong principalId →
   `board_session_mismatch`.
4. **BA-4 run state:** mutation against a terminal/closed Run → `board_run_closed`.
5. **BA-5 fence:** stale `expectedBoardFence` → `stale_board_fence`; a concurrent mutation
   between read and write loses the CAS (no TOCTOU — instrumented interleaving).
6. **BA-6 parent:** retitle/close against a superseded item version → `board_parent_stale`.
7. **BA-7 replay:** replay-same (identical normalized request + key) returns the prior
   receipt with no second effect; replay-conflict (same key, different request) refuses.
8. **BA-8 actor honesty:** an envelope naming `actor:'orchestrator'` without the lease
   refuses; the adapter-default path is deleted (source-scan: no `actor ?? 'orchestrator'`
   in the mutation path).
9. **BA-9 MCP adapter thinness:** source-scan — no lease/fence logic in the MCP dispatch;
   the four board tools route through the primitive; the MCP lease posture receipts are
   unchanged on the wire.
10. **BA-10 facade acquisition:** the facade's explicit/implicit lease acquisition path is
    pinned (receipt, TTL, revocation on Run close); post-Run-close mutation refuses
    `board_lease_required` or `board_run_closed` per the pinned order.

Deterministic: CoordinationStore + Coordinator fixtures (the reflex2 harness pattern), fixed
clocks, no live providers, no real sessions.

## Verification

```text
node --test impl/test/board-authority-red.test.mjs impl/test/reflex2-boards-red.test.mjs impl/test/mcp-reflex-board-package-red.test.mjs impl/test/reflex3-packages-red.test.mjs
node impl/scripts/run-suite.mjs
```

## Explicit non-goals (v1)

New board/package FEATURES (nesting stays P1-D's field-level addition over this authority);
worker-initiated posting (workers still claim/report only); web/CLI board surfaces (S-3
decides profiles); scratchpad/REPL/knowledge authority (their own S-3 rows ride this
primitive's envelope pattern where applicable); M5.
