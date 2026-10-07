# #66 FOLD — blocker → change map (v1.0 → v1.1)

Source: `contract-redteam.md` (2026-08-12, **NOT FOLD-READY** — 7 numbered blockers in §E).
Fold target: `doubt-review-contract.md` v1.1 (same dir). The red-team re-verified every citation at
its HEAD `ac92335d9d85de777edbb8cfe67af00c5f10915f` with `grep -an`/`sed -n`; `git diff` over
`impl/src` between the contract's v1.0 verification HEAD (`faf4e06d35bba2d1ea53d9d32e3c6d48ff97ee23`),
that HEAD, and the fold HEAD (`12e55921e9d08ff76956a6382d5b050ddff4d432`) is **empty**, so every
line number survives. The corrected/added anchors below were re-grepped at the fold HEAD before
writing.

Verdict folding: all **7 numbered blockers** resolved with the report's concrete fix; the
**6 citation/minor fixes** (M1/M2/M3/M5/M7/M8) applied; the **open-question verdicts** applied —
**OQ1/OQ2/OQ3 SOUND** as written, **OQ4 OVERSTATED** (M4) and re-adjudicated.

---

## Citation / minor fixes (report §B/§D) — all applied

| # | Fix | v1.0 (wrong/absent) | v1.1 (corrected) | Where in v1.1 |
|---|---|---|---|---|
| M1 | Embedded-only justification | D3 cited "the same embedded-only posture as the settlement rows, `application-semantics.mjs:1520-1527`" — false: that row is `surfaces: ['embedded','mcp']` and `baton_knowledge_settlement_lease` is a live MCP tool (`mcp-northbound.mjs:108/:138/:613`) | D3 cites the genuine embedded-only precedent `board.claim`/`board.report` (`application-semantics.mjs:1418-1439`); the embedded-only *design* of the doubt rows is unchanged | D3 |
| M2 | NUL-file misnomer | Header named the brief's "two NUL files" as `coordination-store.mjs` + `coordinator.mjs` | Header names `application.mjs` + `coordination-store.mjs` (the brief's actual NUL files); the practice (grep/sed only on those two) was always compliant | Header |
| M3 | Refusal-code overlap | `doubt_promote_not_authorized` and `doubt_promote_stale` both named the expired-lease condition | One code per condition: the lease gate fires the #63 XB lease-code family verbatim; `doubt_promote_stale` reserved for state-not-`reviewed` only | Refusal vocabulary, D4 step 3 |
| M5 | Fold surface unpinned | "folded, checkpointed, and inventory-listed exactly as #33's scratchpad kinds are" — no mechanism | Pinned: folded `knowledge` map + `PROJECTION_CHECKPOINT_FIELDS` + `snapshot()` exposure + event-kind inventory addition (rule 11's four seams); projection is the folded map, never a ledger scan | D2 intro, R2 |
| M7 | Doubt-surface keyset predicate deferred | "exact #33 rule-15 predicate discipline" — rule 15 keys `(createdEvent, entryId)`, a different key set | Spelled out: `raisedSeq < c \|\| (raisedSeq === c && doubtId > d)` for a cursor `{c, d}`, adapted from (not identical to) rule 15 | D3 |
| M8 | D1 overclaim | "never `orchestrator_skipped`" unqualified | Qualified with the `steering ?` guard: a no-driver run dispositions doubts `not_elevated/no_driver` (the rule-20 fallback, `coordination-store.mjs:14304`) — the same honest degenerate receipt notes/plans get | D1 |

## Numbered blockers (report §E) — all resolved

| # | Blocker | Concrete fix (from the report) | Change in v1.1 |
|---|---|---|---|
| 1 | **Elevated-but-unraised doubts are a silent sink (A6 in a new costume)** — raise ran after the carry sweep, and a raise refusal is captured-never-aborts | (a) run the raise scan **before** the carry sweep in the same invocation; (b) pin the carry predicate to any doubt not in `answered`/`dismissed`, minting `doubt_raised` (if absent) + `doubt_carried` in the one sweep; (c) delete the stateless gap in D2's state machine | **D2** new "No stateless gap" — an elevated-but-unraised doubt is a *receipted contradiction*, never a state. **D5** reordered to elevate → raise → sweep, with the widened carry predicate; the closing honesty sentence now covers the elevated-but-unraised path. **R2**/**R7** extended to pin the one-sweep mint. |
| 2 | **`promote_doubt`'s authority gate unenforceable as specified (the #73 forge class)** — input/`authorityFields` carry no `lease`, the pinned store gate demands one | Pin `resolveDoubt` to re-derive the active run-orchestrator lease for the `runId`'s settlement task server-side (`settlementLease` leaseId derivation, `coordinator.mjs:11552-11559`) and validate `principalId`/`sessionId`/`sessionAuthorityDigest` against it — lease never a caller field, mirroring `knowledge.promote`'s discipline (`application-semantics.mjs:1512-1514`) | **D4** registry-row note + step 1 rewritten to pin the server-side lease re-derivation and the session binding (`coordination-store.mjs:16207`, `:16228-16251`). **R4** extended: caller-supplied lease never accepted. |
| 3 | **`view.open_doubts.bytes = 4096` cannot hold one answered record** — question (1024) + context (2048) + resolution (4096) + wrappers > 4096 | Set `view.open_doubts.bytes = 8192` (the honest sum of the three prose bounds + wrapper overhead) — adopted over the OQ1 leaf-text shed / retire-the-byte-row alternatives | **D7** `view.open_doubts.bytes` = **8192** with the honest-sum derivation (7,168 B raw + wrapper overhead); the 4096 dead-row contradiction named. **R3** extended to pin one answered record renders inside the bound. |
| 4 | **`knowledge.doubts` orchestrator gate declared, never pinned** — no authentication mechanism, no dispatch branch, `waveId`-absent spans the project | Pin the read's authorization (active run-orchestrator lease for a named run; the deployment's top-level orchestrator principal for the project surface); pin the direct-port dispatch branch in `application.command`; pin `doubt_surface_unavailable`'s trigger exactly | **D3** new "Authorization (pinned)" bullet — the two authority holders, the direct-port dispatch branch (the settlement-branch shape at `application.mjs:12493-12495`), and the exact `doubt_surface_unavailable` trigger. Refusal vocabulary updated. **R3** extended. |
| 5 | **D1 selection change starves note/plan candidacy through the shared ceiling** — doubts consume `MAX_SCRATCHPAD_SHARED_ENTRIES`, the batch fails as a whole | Pin a doubts-only sub-cap within the 512 ceiling (doubts ≤ 384, notes+plans ≥ 128 — a 3:1 reservation derived from the existing ceiling, never a new arbitrary cap) | **D1** ceiling bullet rewritten with the derived sub-cap; the no-collateral property asserted. **R1** extended ("with no collateral"). |
| 6 | **"Closed loop" overstates deliverable v1** — the doubt's worker is in a settled run that may never respawn; #79 composes the block only at spawn/recovery | Pin the v1 honesty — delivered-when-recovered; assert the `doubt_resolved` coordinates (R6), never a wire-acked delivery; rename "closes the loop" to "arms the #79 `doubt_answer` push" | **D6** retitled to "arming #79's `doubt_answer` lane (v1 honesty)" with the delivered-when-recovered claim. Scope sentence updated. **R6** extended. |
| 7 | **Resolution prose is mis-wrapped** — D3/D4 wrapped `resolution` as `wrapProse` (`model-authored`), but a resolution is orchestrator-authored hub prose | Pin `wrapHubDerived` (`provenance: 'hub-derived', untrusted: true`, the #79 constructor) for the resolution and any orchestrator-authored doubt prose; add a red row asserting the resolution is never `hub-computed` and never `model-authored` | **D2** `doubt_resolved` payload framing; **D3** output frame + prose bullet; **D4** step 2. **R8** extended (resolution via `wrapHubDerived`, never `model-authored`/`hub-computed`). |

## Open questions (report §C)

- **OQ1** — **SOUND**, folded with a cross-ref to D6's delivered-when-recovered geometry (the
  settled-run / cannot-respawn reason is the same on both sides).
- **OQ2** — **SOUND**, unchanged. No auto-reconcile; the review authority is never bypassed.
- **OQ3** — **SOUND**, unchanged. The scratchpad/open vs ledger/reviewed split is the honest one.
- **OQ4** — **OVERSTATED** (M4), re-adjudicated as **qualified**. A direct `scratchpad.elevate` of a
  doubt is raised only when it precedes the ritual (each ritual scans only its own wave's members);
  a post-ritual direct elevation is never raised by a later ritual. It is closed by the widened
  carry predicate (blocker 1) as a receipted contradiction when its lease is revoked, and is reaped
  at workflow settle (not a review-surface record) once the lease is gone. Direct elevation must
  precede the wave's settle ritual to enter the review surface — pinned, not claimed.

## What the fold must NOT change (report §B/§C — verified sound) — preserved intact

- The shape decision: (b) `knowledge.promote_doubt` as the authority + the durable doubt record as
  the queryable/review surface, on the D4 selection change; (a) and (c) still rejected.
- The A6 happy path: a doubt raised into the review surface is never a silent sink and never an
  auto-candidate into the Finding graph (GT2/GT5 structural taxonomy boundary).
- The state machine's event derivation: state is the latest event for the `doubtId`, never a caller
  field; idempotency keys `doubt_raised:${waveId}:${sharedEntryId}`, `doubt_resolved:${doubtId}`,
  `doubt_carried:${doubtId}`; the no-clocks law.
- The D4 taxonomy boundary: answer/dismiss mints no Finding, no KG node, no board item, no
  `knowledge.workflow_admitted`, no scratch-fact.
- The D7 registry discipline: three rows in the ONE `FRAME_LIMITS` registry, each derived from an
  existing row of the same class (no re-declare, #89 Decision 8).
- The #79 composition: the push lane is #79's surface; the doubt rung pins only the `doubt_resolved`
  coordinates (`doubt_answer` durable id, worker-addressed by identity).
- **R9**/**R10** structural pins (no auto-candidacy, replay-exactness) and **R5** (dismiss) unchanged.
