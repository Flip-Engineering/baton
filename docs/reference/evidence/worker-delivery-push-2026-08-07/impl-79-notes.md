# Issue #79 — worker-delivery push: implementation notes

- **Contract:** `worker-delivery-push-contract.md` v1.1 (+ the D2 per-source bounds pin from
  `suite-fold-2.md` v1.2).
- **Suite:** `impl/test/worker-delivery-push-red.test.mjs` (32 rows: 21 RED at named stages / 11 PIN).
- **Date:** 2026-08-13.
- **Result:** 32/32 green, verified with
  `node --test impl/test/worker-delivery-push-red.test.mjs` from the repo root (two consecutive
  runs, identical). The four adjacent suites are green (below).

## The seams landed

| Law | What | Where |
|---|---|---|
| D1/D2/R8′ | the `## Pending attention` delivery seam + the item/byte registry rows + the `wrapHubDerived` provenance envelope | `messages.mjs` (the shared render family + wrapper), `adapter.mjs` (`renderBrief` after `## Ambient knowledge`), `cli-adapters.mjs` (`renderPrompt` after the verification execution contract), `limits.mjs` (`view.attention_push.items` 8 / `view.attention_push.bytes` 4096) |
| D6 | the never-raw tail (the sanitizer's home path is redacted WHOLE, not just the username) | `verifier-diagnostics.mjs` — the ONE path-sanitizer home regex now redacts the full path (`/Users/…/lib.rs:12`), closing F6's `lib.rs` canary without a parallel redaction path |
| D3/D5/D7 | the per-worker push projection (`_pendingAttentionPush`) — worker-identity addressing, still-pending dedup by durable id, per-source bounds | `coordinator.mjs` |
| D4 | the delivered-then-read receipts (`attention.pushed` event + `_attentionReceipt`) | `coordinator.mjs` |
| D6 | the worker-scoped sanitized gate verdict (`_gateVerdictItemForWorker`, reuses `sanitizeVerifierDiagnosticText` verbatim) | `coordinator.mjs` |
| refusals | the frozen `PUSH_REFUSAL_CODES` family + the `_assertAttentionPushServed` serving-path guard | `coordinator.mjs` |
| #111-F3 (carried) | the corrective nudge coaches `{liveness counts, reason: no in-scope diff}` instead of the bare `Continue the current turn.` | `wave-driver.mjs` |

## Non-obvious decisions (recorded for the reviewer)

- **`application.mjs` / `application-deployment.mjs` (in the dispatch's deliverable list) needed no
  edit.** The verdict projection is re-derived in `coordinator.mjs` from the worker's OWN durable
  source events (`error`/`verify.reverified`), reusing `sanitizeVerifierDiagnosticText` verbatim —
  importing `application.mjs`'s private `debugGateRefusal` would create an app↔coordinator coupling
  and a parallel shape. The contract's `application.mjs` anchors (GT1/GT6) were re-verified with
  `grep -an`; the `debugGateRefusal`/`debugGateDetail` shape there is byte-identical to the
  coordinator's projection for every closed gate.
- **F6's `lib.rs` canary forced the sanitizer fix.** `sanitizeVerifierDiagnosticText` redacted only
  `/Users/<user>/` → `/[home]/`, leaving `projects/secret/lib.rs` — the raw capsule fragment still
  crossed. The fold's "no `lib.rs` in ANY field" is stronger than the prior sanitizer, so the home
  regex now redacts the whole path. This is a fix to the ONE sanitizer (never a parallel path);
  F3, `diagnostics-red` DG-1b, and `worker-verdict-surface-red` A4 stay green.
- **Empty-set seam is `attention: []`, not `undefined`.** D4/F5's negative arms read
  `composed.attention` directly (`.some(…)`), which requires the field to be an array even when the
  pending set is empty. The fold deferred F9 (`undefined` vs `[]` at the seam), so the seam attaches
  `[]` and the RENDERER omits the section for an empty/absent array (A4 pins absence-on-empty at the
  renderer, never the seam). No `attention.pushed` receipt mints for an empty set.

## Commit split (#141 — natural subsystem boundaries)

1. `feat(#79): attention delivery seam — wrapper, registry rows, renderers, sanitizer`
   — `messages.mjs`, `limits.mjs`, `adapter.mjs`, `cli-adapters.mjs`, `verifier-diagnostics.mjs`.
2. `feat(#79): worker-delivery push projection, receipts, and refusals` — `coordinator.mjs`.
3. `feat(#79): corrective nudge coaching (#111-F3 carried)` — `wave-driver.mjs`.
4. `docs(#79): impl notes` — this file.

## Verification

Primary (from the repo root):

```sh
node --test impl/test/worker-delivery-push-red.test.mjs   # 32/32 (was 11 pass / 21 fail)
```

Adjacents (the brief's four):

```sh
node --test impl/test/briefing-pack-red.test.mjs               # 31/31
node --test impl/test/orchestrator-wake-red.test.mjs           # 6 PIN / 30 RED (unchanged — #10 wake rung)
node --test impl/test/issue10-waiting-vocabulary-red.test.mjs  # 38/38
node --test impl/test/worker-orchestrated-swarm-red.test.mjs   # 16/16
```

Also re-run clean (no regressions): `diagnostics-red` 8/8, `frame-economics-red` +
`issue62-write-failure-red` + `issue53-run-debug-red` 59/59, `bidirectional-v3-red` +
`decision-gate-trust-gate-red` 33/33, `claim-preflight-red` 30/30, `wave-driver-red` +
`wave-driver-policy-red` 21/21, `adapter` + `cli-adapters` + `messages` 108/108,
`coordinator` 57/57. `feedback-forge-hardening-red` P1–P8 pins green (P5 pins the #79 push item's
`gate:${event.seq}` shape and derived-free constancy). Out-of-scope red-first suites stay at their
documented red splits (`worker-verdict-surface-red` 5 PIN / 26 RED for the future verdict-surface
rung; `orchestrator-wake-red` 6 PIN / 30 RED for the #10 wake rung).

Deployment verification stub: `true` (argv `[]`, cwd `.`) → exit 0.

## Campaign-law compliance

- **No clocks as controls:** the push is a pure function of the durable log; `read` is an event
  `seq` (never a wall clock); no `Date.now()` enters the new coordinator/wave-driver paths.
- **Byte literals ONLY in `limits.mjs`:** the two new bounds (8 items / 4096 bytes) are declared in
  the ONE `FRAME_LIMITS` registry and read by import everywhere else; the refusal codes are enum
  members, not payload byte literals.
- **`localeCompare` banned; sorted-key literals in ACTUAL order:** none introduced;
  `PUSH_REFUSAL_CODES` is declared in its ACTUAL sorted order (`not < ove < sta < unk`).
- **NUL discipline:** `application.mjs` / `coordination-store.mjs` were never whole-file read
  (imports only); edits located with `grep -an` / `sed -n`. No new NUL bytes introduced.
- **No arbitrary numeric limits:** 8 and 4096 are registry-declared frame bounds with documented
  derivations (the knowledge-slice precedent / the attention-text ceiling), never in-code counters.
