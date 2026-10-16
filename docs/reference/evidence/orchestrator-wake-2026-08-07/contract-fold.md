# #71 FOLD MAP — `orchestrator-wake-contract.md` v1.0 → v1.1 (blocker → change)

- **Fold target:** `docs/reference/evidence/orchestrator-wake-2026-08-07/orchestrator-wake-contract.md`
  (v1.0 DRAFT → v1.1 DRAFT)
- **Red-team report:** `contract-redteam.md` (this directory) — five numbered blockers in §4,
  the drift/amendment items (C-1..C-4, H5-H8), the acceptance-pin assessment (§3), the open-question
  verdicts.
- **Verification HEAD:** `c780ef7447728a21d34dedb206859ff91f4e24c5` (this worktree's effective-tree
  snapshot). Every anchor below was re-verified with `grep -an`/`sed -n` at this HEAD. The red-team's
  worktree HEAD was `a596b23f4e5dcb2072f8013874ca08af6bd0d203`; line numbers that shifted between
  worktrees were re-pinned to this HEAD (see the "Re-pins" section).
- **Date:** 2026-08-07.

## Verdict

All five numbered blockers (B1-B5) are folded, the drift/amendment items (C-1..C-4, H5-H8) are
folded, the acceptance-pin amendments (§3 of the report) are applied, and the open-question verdicts
are applied (OQ-1 pinned, OQ-2 resolved by B3, OQ-3/OQ-4 unchanged). The contract header is v1.1
with the fold note.

---

## 1. Numbered blockers

| # | Blocker (report §4) | Fold decision | Where it landed in v1.1 |
|---|---------------------|---------------|-------------------------|
| B1 | **The composed cursor mixes store seq and `_attentionCursor` into one token (D1.1).** A store-dominated `throughCursor` makes every later attention reason (`seq` ≤ cursor) invisible, so `member_terminal`/`candidacy_review` never wake a return-trip orchestrator; W-9, D1.2, D3.3 violated. | **Split the cursor.** The wake payload carries TWO independent cursors: `storeCursor` (the `waitAfter` operand + store-item paging) and `reasonsCursor` (the `_attentionCursor` space, paged by the existing `_attentionPage` filter, `coordinator.mjs:7092`). A reason seq is NEVER folded into `storeCursor`; the store cursor is the only monotone continuation token. Anchoring reason seqs to the store head at mint time is explicitly NOT a substitute (collision between two reasons minted in one store interval). | §2 D1.1 (the wait loop), D1.3 (honest empty shape), D1.6 (reasons notifier); §2 D2 payload shape + D2.5 (the cursors are the paging contract); §4 law "The cursor is split, never composed (B1)"; §3 W-1. |
| B2 | **`candidacy_review` is re-minted on every page with a fresh seq, unfiltered by `afterCursor` (`coordinator.mjs:7098-7117`).** A run with a live candidacy queue never returns an honest empty; violates D1.3 and D3.3 and breaks W-1. | **Stable-identity reason (option a).** Mint `candidacy_review` ONCE into `_attentionReasons` when the run first has a non-empty candidacy queue; refresh (count/candidates updated in place, seq unchanged) only when the queue count changes; page it with the same `reason.seq <= reasonsCursor` filter as `member_terminal`. Never re-minted per page read. (The alternative — anchoring its seq to the candidate Finding's store event — was not chosen because the store-adjacent mint is a larger surface change; the stable-identity fix reuses the existing seq filter.) | §2 D1.2 (closed-set bullet), D1.3 (honest empty reachable); §2 D3.3; §3 W-1, W-4. |
| B3 | **`budget_alarm` has no producer in the composed surface (D1.2).** It is a digest kind (`coordinator.mjs:11859`), absent from `_attentionReasons` and from any store-derived item; an implementation faithful to D1.2 + G4 would never emit it. | **Name the producer (option a).** `budget_alarm` rides `reasons` composed from `_collectDigest`'s `attention` array (`coordinator.mjs:11852-11861`) FILTERED to `budget_alarm`, with the digest's own ack/cursor discipline. It is a reason (read, never answered in place — D2.3). | §2 D1.2 (closed-set bullet); §1 G8 (de-conflation); §4 law "Compose, never duplicate"; §5 OQ-2 (RESOLVED). |
| B4 | **A reason-only mint can be store-invisible (D1.5/W-9).** `_mintMemberTerminal` fires on an already-terminal task without a `_coordTransition` store append (`coordinator.mjs:8148`), so the storm-coalesced count update (`coordinator.mjs:7141-7149`) never advances the store and `waitAfter` never wakes on it. | **Re-scope W-9 to store-visible changes + add the reasons notifier.** The guarantee pin now covers STORE-visible changes; reason-only liveness is real via the in-process reasons notifier (D1.6) — a reason mint/coalesce/refresh finishes the waiter exactly as an append would (event-driven, never a clock), without moving the store cursor. | §2 D1.5 (re-scoped pin), D1.6 (new reasons notifier); §3 W-9; §4 non-goals note. |
| B5 | **Wrong citation: `application-cli.mjs:1655-1657` for `run approve` (G13, D2.2).** `:1655-1657` is the tail of `run status --wait`; the `approve` block is at `:1658-1660`. | **Re-point both citations.** G13 `:1655-1657` (`approve`) → `:1658-1660`; D2.2 `:1655-1657` → `:1658-1660`; D4.3 `:1655-1673` → `:1658-1673`. | §1 G13; §2 D2.2, D4.3. |

## 2. Drift / amendment items (report §1.3, §2.2, §2.6)

| Item | Report finding | Fold | Where it landed |
|------|----------------|------|-----------------|
| C-1 | G3 "category filter wakes only on `execution`/`plan`/`terminal`" is imprecise: `_followCategory` returns nine categories; `run.follow` returns on ANY `page.changes.length > 0` (`application.mjs:8298`); the narrowing lives only in the wave-driver's `isTargetChange` (`wave-driver.mjs:267-272`), which does NOT include `plan`. | G3 rewritten to the real behavior; the D1 trigger stays consistent with `run.follow`. | §1 G3 |
| C-2 | G8 conflated `budget_alarm` with an `_attentionReasons` wake reason; it is a DIGEST kind produced in `_collectDigest` (`coordinator.mjs:11852-11861`), absent from the attention inbox. | G8 de-conflated; seeds B3. | §1 G8 |
| C-3 | `briefing-pack-contract.md:377` is two lines below the D9 header (`:375`); `mcp-northbound.mjs:198-261` for `stateFailureCode` actually spans `:200-268`. | Both citations re-pointed. | §1 G9 (`:375`); §2 D6 (`:200-268`) |
| C-4 | The contract's "two NUL-bearing files" claim is wrong for `application.mjs` — a NUL scan shows only `coordination-store.mjs` contains NUL bytes; `application.mjs` is clean (it is `file`-typed `data` with non-NUL control bytes, so `grep -a`/`sed` discipline is retained). | Header + §6 corrected to "only `coordination-store.mjs` is NUL-bearing; `application.mjs` is clean"; both read by grep/sed only. | Header; §6 |
| H5 | D2.4's spill claim mis-cites the economy: the decision lane does NOT spill (`decision.question` is `graceful: null`, `limits.mjs:59`, refused at admission `decision_question_exceeded`); the spill-digest economy belongs to `message.reply.body`/`wave.member.objective` (`limits.mjs:55, 57`); an oversize question can never reach the wake oversize path. | D2.4 rewritten: no decision-question spill; the wake's own oversize spill (the `actions` remainder) uses the head+digest shape. | §2 D2.4; §3 W-8 |
| H6 | `actions` (up to ~1,024 items) and `waitingOn` (up to 1,024 members) are unbounded; oversize-recovery unspecified. | `actions` sliced to `MAX_ATTENTION = 64` (`application.mjs:58`) with the remainder spilled as a digest; `waitingOn` capped; oversize-recovery posture pinned (narrow scope or page in batches — there is nothing to shrink). | §2 D2.4; §3 W-8 |
| H7 | MCP 24h held lane raises the blast radius; no client-cancellation path for an in-flight `tools/call`. | MCP ceiling tightened to the web 30s precedent (`web-northbound.mjs:366`) — one-shot waits (the #138 posture); CLI and web envelope may hold up to `maxWaitMs`; disconnect→abort mapping pinned via the `waitAfter` `AbortSignal` (G1). | §2 D4.1; §3 W-7 |
| H8 | D6 rationale half-wrong: `application_attention_wait_oversize` already survives via the `application_` pass-through (`mcp-northbound.mjs:205`); `attention_scope_forbidden` already has a row (`mcp-northbound.mjs:246`); the web mapper maps unknown `application_*` to 400 (`web-northbound.mjs:170-173`), `attention_wait_invalid` falls to 503 (`web-northbound.mjs:232`). | D6 rationale rewritten to the verified facts; only `attention_wait_invalid` genuinely needs the new MCP row; the web 400-class row is added for it. | §2 D6 |

## 3. Open-question verdicts (report §2.3 + fold brief)

| OQ | Verdict | Fold |
|----|---------|------|
| OQ-1 | **PINNED, not deferred.** The wave-scoped form must NEVER pass a null runId — the bare-deployment-scope escape (`coordinator.mjs:7064-7065`) would admit any authenticated principal to the whole attention surface. | §2 D3.1 + §5 OQ-1 |
| OQ-2 | **RESOLVED by B3.** `budget_alarm` enters `reasons` via the digest composition (`_collectDigest`'s `attention`, filtered to `budget_alarm`, with the digest's ack/cursor discipline). It stays a reason (read, not answered in place); answering it is #90's escalation territory. | §2 D1.2 + §5 OQ-2 |
| OQ-3 | Unchanged — `plan_approval` stays actionable with the single-run digest. | §5 OQ-3 |
| OQ-4 | Unchanged — the web ceiling is a transport bound, raised there never in the lane. | §5 OQ-4 |

## 4. Acceptance-pin amendments (report §3)

| Pin | Report assessment | Fold effect |
|-----|-------------------|-------------|
| W-1 | RED as specified; B1/B2 break the honesty. | Honest empty restored: B2's stable `candidacy_review` (no re-mint), B1's split cursor + D1.6's notifier make reason-only changes observable. Still RED (no wake surface). |
| W-2 | RED; shape SOUND. | Unchanged (shape preserved). |
| W-3 | RED for the wake; GREEN for the receipt path. | Unchanged. |
| W-4 | RED; design SOUND — B2's fabricated reason wakes both waiters spuriouly. | B2's stable identity removes the spurious wake. |
| W-5 | RED; design SOUND. | Unchanged. |
| W-6 | RED; set order VERIFIED sorted. | `WAKE_REASONS` byte-unchanged from v1.0; still ACTUAL sorted order. |
| W-7 | RED; MCP hold hazard (H7). | MCP ceiling tightened to the web 30s precedent; disconnect→abort pinned. |
| W-8 | GREEN for limits; RED for the wake builder (H5/H6). | `actions` slice to 64 + digest spill, `waitingOn` cap, page-in-batches recovery, no decision-question spill. |
| W-9 | GREEN for individual transitions; RED for the pin's scope (B4). | Pin re-scoped to STORE-visible changes; reasons notifier carries reason-only liveness. |

## 5. Re-pins (line numbers that shifted between worktrees)

The red-team report was verified at `a596b23...`; this fold re-verified every fold-in anchor at
`c780ef7...`. Anchors that differ:

| Anchor | Red-team | This HEAD |
|--------|----------|-----------|
| `mcp-northbound.mjs` `application_` pass-through | `:212` | `:205` |
| `mcp-northbound.mjs` `attention_scope_*` row | `:262` | `:246` |
| `web-northbound.mjs` unknown-`application_*` → 400 | `:176-179` | `:170-173` |
| `application-cli.mjs` `approve` block (B5) | `:1658-1660` | `:1658-1660` (unchanged) |
| `coordinator.mjs` `_attentionPage` candidacy mint | `:7098-7118` | `:7098-7117` |
| `coordinator.mjs` `_mintMemberTerminal` def | `:7122-7156` | `:7126-7156` |
| `briefing-pack-contract.md` D9 header (C-3) | `:375` | `:375` (unchanged) |

## 6. Verification

- **Deployment verification command** (Baton): executable `true`, arguments `[]`, expected exit 0.
- **Evidence discipline:** every fold-in anchor re-verified by `grep -an`/`sed -n` at
  `c780ef7447728a21d34dedb206859ff91f4e24c5`; `application.mjs` is `data`-typed (non-NUL control
  bytes) and `coordination-store.mjs` is NUL-bearing — both read by grep/sed only, never whole.
  Sorted-key literals remain ACTUAL order; `WAKE_REASONS` byte-unchanged; `localeCompare` banned.
