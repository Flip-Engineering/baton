# #71 RED-TEAM — adversarial attack on `orchestrator-wake-contract.md` v1.0

- **Target:** `docs/reference/evidence/orchestrator-wake-2026-08-07/orchestrator-wake-contract.md` (v1.0 DRAFT)
- **Red-team brief:** `redteam-71-brief.md` (this directory)
- **Verification HEAD:** the contract pins `d1a1e267d259d50fcdb49e51889a593393e66628`; this worktree's
  current HEAD is `a596b23f4e5dcb2072f8013874ca08af6bd0d203`. Every anchor below was re-verified with
  `grep -an`/`sed -n` at **current HEAD** per the campaign law. The only NUL-bearing file is
  `coordination-store.mjs`; `application.mjs` is clean (see C-4).
- **Date:** 2026-08-07.

## Verdict

| Decision | Verdict |
|----------|---------|
| D1 — the wake primitive | **HOLE** (4 blockers: B1, B2, B3, B4) |
| D2 — decision-first surface | SOUND with caveats (H5, H6) |
| D3 — who may be woken | SOUND, but D3.3 is violated by B2 |
| D4 — surface mapping | SOUND with hardening note (H7) |
| D5 — #105 composition | SOUND |
| D6 — refusal vocabulary | SOUND with citation drift (H8) |

**Final: NOT FOLD-READY.** Five numbered blockers in §4.

---

## 1. Citation re-verification (every anchor at current HEAD)

### 1.1 Ground truths G1–G14

| # | Anchor(s) | Verdict | Note |
|---|-----------|---------|------|
| G1 | `coordination-store.mjs:8843-8870` (`waitAfter`), `:1594-1598` (`_notifyAppend`) | **VERIFIED** | `waitAfter(afterSeq, timeoutMs, {signal})` event-seq anchored, transport bound, AbortSignal, `{advanced, upperBound}`; `_notifyAppend` finishes every waiter behind the append. |
| G2 | `application.mjs:8257-8326` (`follow`), `:8315` (`waitAfter` call), `:8299-8300` (`timedOut`), `:8308` (`application_follow_oversize`) | **VERIFIED** | Loop → page → `waitAfter(view.cursor, remaining, {signal})` → re-page; honest empty is `timedOut: true`. |
| G3 | `coordinator.mjs:11809-11843` (`wait`), `application.mjs:7921-7950` (`run.wait`), `wave-driver.mjs:463-534`, `application.mjs:7952-7975` (`_followCategory`), `wave-driver.mjs:267-272` (`isTargetChange`) | **VERIFIED, characterization imprecise** | See C-1. |
| G4 | `coordinator.mjs:7021-7058` (`attentionFollow`), `:7088-7120` (`_attentionPage`), `:7122-7156` (`_mintMemberTerminal`), `application.mjs:12842-12854` (`attentionWatch`) | **VERIFIED** | Page read; `timeoutMs: undefined`. |
| G5 | `coordinator.mjs:7062-7066` (`_attentionScopeAuthorized`), `:7070-7083` (`_isReviewAuthority`) | **VERIFIED** | wave-owner always; run-scoped lease holder via `activeRunOrchestratorLeaseForSession`. |
| G6 | `coordinator.mjs:12688-12788`, `:12786` (`_coordTransition(task,'input_required')`), `application.mjs:575-599` (`projectDecisionAttention`), `:12469-12511` (`answer`), `:12492-12506` (`already_resolved`), `wave-driver.mjs:622-641` (`onDecision`) | **VERIFIED** | `already_resolved` at `:12499` (within range). |
| G7 | `wave-driver.mjs:202-205` (`BLOCKING_INTERACTION_KINDS`), `application-semantics.mjs:58-61` (`WAITING_ON_KINDS`) | **VERIFIED** | Closed three / closed five, both frozen; `WAITING_ON_KINDS` is in ACTUAL sorted order. |
| G8 | `messages.mjs:18` (`ATTENTION_TYPES`), `coordinator.mjs:11856-11862` (`budget_alarm` map at `:11859`), `worker-delivery-push-contract.md:232-249` | **VERIFIED, characterization imprecise** | See C-2 — `budget_alarm` is a **digest** kind, not an `_attentionReasons` kind. |
| G9 | `application.mjs:4619-4630` (`wave.started`), `:12563-12573` (`appendWaveClosedInternal`), `coordination-store.mjs:13312` (`appendWaveClosed`), `briefing-pack-contract.md:377` | **VERIFIED except C-3** | `wave.closed` is a top-level `this._append('wave.closed', payload, auth)`. |
| G10 | `coordinator.mjs:12614-12631` (`question.asked` blocking path), `reply-chains-contract.md` D8/D9 | **VERIFIED** | blocking→`input_required`; conversational→`input.requested`, no phase transition. |
| G11 | `limits.mjs:59, 68-70, 99`; `application.mjs:55, 58-59, 334-342, 1344-1359` | **VERIFIED** | `decision.question` 2048, `decision.option.label` 160, `decision.option.summary` 512, `decision.text` 4096, `view.attention_text.bytes` 4096, `MAX_ATTENTION`=64, `boundedAttentionText`, `followPolicy.maxResponseBytes`=`MAX_RUN_VIEW_BYTES`. |
| G12 | `web-northbound.mjs:15-17, 53-58, 366, 634-636`; `web-stream.mjs:194`; `mcp-northbound.mjs:375-378, 930-931` | **VERIFIED** | `run_wait` ceiling at `:366`; envelope dispatch at `:634-636`; `invalid_run_wait` guard at `:930-931`. |
| G13 | `application-cli.mjs:1400-1419` (`attention watch`), `:1655-1657` (approve), `:1662-1673` (answer `--option`), `:1649-1656` (`--wait`) | **WRONG for the approve range** | See B5 — the `approve` block is at `:1658-1660`, not `:1655-1657`. |
| G14 | `orchestrator-friction-ledger.md:108` (Appendix C, #138 row) | **VERIFIED** | "A process-per-call orchestrator … can never hold the wave lane". |

### 1.2 Decision anchors

| Decision | Anchor(s) | Verdict | Note |
|----------|-----------|---------|------|
| D1 | `coordination-store.mjs:8843` | **VERIFIED** | |
| D2 | `application.mjs:12480-12491`, `mcp-northbound.mjs:551-557` (`baton_decision_answer`), `application-cli.mjs:1662-1673` | **VERIFIED** except B5 | The `:1655-1657` approve citation is wrong (B5). |
| D3 | `coordinator.mjs:7062-7083` | **VERIFIED** | |
| D4 | `mcp-northbound.mjs:620-626` (`baton_run_attention_watch`), `:112`, `:92`, `:375-378`, `:930-931`; `web-northbound.mjs:634-636`, `:366`; `web-stream.mjs:194`; `application-cli.mjs:1400-1419`; `wave-observability-contract.md` D1.1-1.2 | **VERIFIED** | |
| D6 | `coordinator.mjs:7021-7066`, `application.mjs:12639-12654`, `:8257-8326`, `:12492-12506`; `web-northbound.mjs:366`, `:149-232`; `mcp-northbound.mjs:930-931`, `:198-261` | **VERIFIED except C-3** | `stateFailureCode` actually starts at `:200` (range is `200-268`); see also H8. |

### 1.3 Citation caveats (C)

- **C-1 (G3).** "`run.follow`'s category filter wakes only on `execution`/`plan`/`terminal` store events"
  is imprecise. `_followCategory` (`application.mjs:7952-7975`) returns **nine** categories (plan,
  execution, orchestration, context, evidence, result, cleanup, integration/recovery/verification,
  and a `driver.recorded` fallback), and `run.follow` returns on **any** `page.changes.length > 0`
  (`application.mjs:8294-8296`). The narrowing lives only in the wave-driver's `isTargetChange`
  (`wave-driver.mjs:267-272`), which aborts the sleep on `page.terminal` or an `execution`-category
  change — and **does not include `plan`**. The two cited functions do not jointly support the
  sentence. It does not change D1's store-advance trigger (which is consistent with `run.follow`'s
  real behavior), so this is a precision finding, not a blocker.
- **C-2 (G8).** Calling `budget_alarm` a "BD3-D attention-inbox wake reason" conflates two surfaces.
  `budget_alarm` is a **digest** attention kind produced in `_collectDigest`
  (`coordinator.mjs:11856-11862`), read from the coordinator's per-worker event log. The
  **attention inbox** (`attentionFollow`/`_attentionPage`, G4) pages only `_attentionReasons`,
  which contains `member_terminal` and `candidacy_review` — **never `budget_alarm`**. This is the
  seed of B3.
- **C-3 (G9, D6).** `briefing-pack-contract.md:377` is two lines below the D9 header (at `:375`),
  still inside the D9 section — minor drift. `mcp-northbound.mjs:198-261` for `stateFailureCode`:
  the function begins at `:200` (spans `200-268`) — minor drift.
- **C-4 (NUL discipline).** The contract's claim that `application.mjs` and `coordination-store.mjs`
  are "the two NUL-bearing files" is wrong for the former: a NUL scan shows only
  `coordination-store.mjs` contains NUL bytes; `application.mjs` is clean. This worktree re-verified
  both with `grep`/`sed` anyway.

---

## 2. Attack findings

### 2.1 D1 — the wake primitive: **HOLE**

**The classic long-poll race — SOUND at the store primitive.** `waitAfter` re-checks
`this._events.length > afterSeq` *after* registering the waiter (`coordination-store.mjs:8870`), so
an event landing between the caller's seq read and the wait registration cannot be missed; JS
single-threading makes the executor atomic. `_notifyAppend` (`:1594-1598`) plus the post-registration
check make the primitive race-free. The wake loop's `waitAfter` operand is `view.cursor` (the store
upper bound at surface-build time), so an advance after the build but before registration resolves
immediately — no missed wake, and no busy spin.

**B1 — the composed cursor mixes two incommensurable seq spaces (D1.1).** D1.1 says "`afterCursor`
anchors BOTH the store seq (the `waitAfter` operand) and the composed surface's paging cursor;
`throughCursor` advances to the composed surface's max `seq`". But the composed surface's `seq` values
come from **two different counters**:

- Store-derived items (a decision park, a plan proposal, a wave close) page by the **store event seq**
  (`_events.length`, large integers).
- The attention reasons (`member_terminal`, `candidacy_review`) page by **`_attentionCursor`**
  (`coordinator.mjs:1198`, incremented at `:7107` and `:7129`) — a small, process-scoped, restart-
  resetting counter, independent of the store.

Because store seqs dominate the max, `throughCursor` is a large store seq after the first wake. A
return-trip orchestrator feeds that large value back as `afterCursor`. `_attentionPage` then skips
every reason whose `reason.seq <= afterCursor` (`coordinator.mjs:7091-7092`) — and freshly minted
attention reasons have **small** seqs (`1, 2, 3, …`). So after the first store-dominated wake,
`member_terminal`/`candidacy_review` are **permanently invisible** to a return-trip orchestrator.
Two of the three attention-reason wake classes in the D1.2 closed set are effectively dead on the
second wake. This violates D1.2, D1.5/W-9, and D3.3 ("two wakes with the same `afterCursor` return
the same items"). The existing `run.attention.watch` is self-consistent only because its cursor is
entirely in the `_attentionCursor` space; D1.1's dual anchoring is what breaks it.

**Fix.** Split the cursor. The wake payload must carry two independent cursors: a `storeCursor` (the
`waitAfter` operand and the paging cursor for store-derived items) and a `reasonsCursor` (the
`_attentionCursor` space, paged by the existing `_attentionPage` filter). Never fold a reason seq
into `throughCursor`; keep the store cursor as the only monotone continuation token. (Anchoring
reason seqs to the store head at mint time is not a substitute — two reasons minted between store
advances would collide on the same seq.)

**B2 — `candidacy_review` is re-minted on every page and is never filtered by the cursor (D1.3,
D3.3).** `_attentionPage` mints a fresh `candidacy_review` with `seq: ++this._attentionCursor` on
**every page read**, is **not pushed into `_attentionReasons`**, and is **not filtered by
`afterCursor`** (`coordinator.mjs:7098-7118`). Consequences:

1. A run with a non-empty candidacy queue never returns an honest empty: every re-page — even after
   an unrelated store advance, or with an unchanged `afterCursor` — fabricates a fresh
   `candidacy_review` with a new seq. This directly violates D1.3 ("never a fabricated reason") and
   D3.3 ("two wakes with the same `afterCursor` return the same items until the store advances").
2. The wake's `throughCursor` jitters (the minted seq changes per page), so the honest-empty pin
   W-1 cannot hold for a run with a live candidacy queue.

**Fix.** Make `candidacy_review` a stable-identity reason: push it into `_attentionReasons` when
minted (one per run, refreshed only when the queue count changes), so its seq is minted once and
paged by the same `reason.seq <= afterCursor` filter as `member_terminal`. Or derive it from the
candidate Findings' own store events (a finding append already advances the store), anchoring the
reason's seq to that event seq — which also removes the "re-mint per read" behavior.

**B3 — `budget_alarm` has no producer in the composed surface (D1.2, D2.3).** D1.2 lists
`budget_alarm` as a wake reason that "rides `reasons`". But the wake composes the existing
`_attentionPage` for the attention reasons (the non-goal pins reasons as process-scoped, G4), and
`_attentionPage` produces only `member_terminal`/`candidacy_review`. `budget_alarm` lives in
`_collectDigest` (`coordinator.mjs:11859`) — a per-worker, cursor-acked digest read — and in the
coordinator's event log (`:8974`), neither of which the contract names as a wake source. The
contract does not specify how `budget_alarm` enters `reasons`. As written, the wake class is
unsourced; an implementation faithful to the letter of D1.2 + G4 would never emit it.

**Fix.** Name the producer. Either (a) the wake composes the digest's `attention` array
(`_collectDigest`), filtered to `budget_alarm`, with its own ack/cursor discipline, or (b)
`budget_alarm` is minted into `_attentionReasons` on the threshold event (a store-adjacent mint, per
the `:8974` emitter), or (c) drop `budget_alarm` from the v1.0 closed set and re-file it. Option (a)
is the smallest honest change and keeps the reasons surface single-source.

**B4 — a reason-only mint can be store-invisible (D1.5/W-9).** W-9 pins "every wake-worthy change
advances the store seq". But `_mintMemberTerminal` fires on every `lifecycle.turn_completed` with
`status: 'completed'` (`coordinator.mjs:12318`), including when the task is **already terminal** —
in which case `_coordTransition` no-ops (`coordinator.mjs:8148`: `if (!durable || durable.status ===
to) return durable;`) and **no store event lands**. The storm-coalesced count update
(`:7141-7149`) is therefore a wake-worthy state change with no store advance, so `waitAfter` does
not wake on it. The pin overstates the coincidence: a terminal *reason* mint is not always a
terminal *store* advance.

**Fix.** Re-scope W-9 to store-visible changes only, and make reason-only liveness real by B1's
split cursor *plus* a reasons notifier — or guarantee the coincidence (mint the coalesce update
coincident with a store append, e.g. anchor the coalesce window to a `task.transitioned`/terminal
store event). As specified, the coalesced update is only observable on the *next* store advance.

**Waiter honesty — SOUND.** `waitAfter` waiters auto-release on the transport bound (a
`setTimeout` per waiter, `coordination-store.mjs:8859`), and `run.follow`-style loops release their
controllers in `finally` (`application.mjs:8324`). No waiter can hold a slot forever; the "no clocks"
law is respected (the deadline is the transport bound, matching G2).

### 2.2 D2 — the decision-first surface: **SOUND with caveats (H5, H6)**

**Stale-action risk — SOUND.** The actionable items are derived **live** at page-build time:
`projectDecisionAttention` emits only `interaction.state === 'pending'` entries
(`application.mjs:577-580`), and the view attention is rebuilt per page. A decision answered before
the page build is excluded; one answered between build and delivery yields a stale item that the
answer path receipts as `already_resolved` with `resolvedBy` (`application.mjs:12492-12506`). The
idempotent-answer posture (D3.3) holds for `answer_*` items.

**H5 — the D2.4 spill claim mis-cites the economy.** D2.4 says an oversize question/option is
"spill-digest-cited per #89 … the same spill the decision admission already uses". The decision
lane does **not** spill: `decision.question` is `graceful: null` (`limits.mjs:59`) and an oversize
question is **refused at admission** (`decision_question_exceeded` with a coaching
`{cap, actual, unit, gracefulPath}`, `coordinator.mjs:12698-12727`, `messages.mjs:243+`). The
spill-digest-citation economy belongs to `message.reply.body`/`run.objective`
(`limits.mjs:55,57`, `coordinator.mjs:12540-12559`). Moreover, because an oversize question is
refused before a pending record exists, the wake can **never encounter** an oversize question to
spill. The sentence describes a non-scenario with the wrong precedent.

**Fix.** Delete the spill sentence, or specify a real oversize-action spill (e.g. head + digest of
the first N actions, matching the `message.reply` economy) and note that decision questions are
always within the 2048-byte admission bound so never reach the wake oversize path.

**H6 — `actions` and `waitingOn` are unbounded by the contract.** MAX_ATTENTION=64 caps the
*run-view* attention array (`application.mjs:55`, `:7288`), but the contract does not pin that the
wake's `actions` array is sliced to 64. With one pending decision per worker (`R-BD-4`,
`coordinator.mjs:12757-12779`) and up to 1,024 workers (`MAX_RUN_VIEW_WORKERS`,
`application.mjs:56`), `actions` can hold ~1,024 items. `waitingOn` (per-member deltas, D1.4) is
likewise uncapped at up to 1,024 members. The only bound is the serialized `maxResponseBytes`
oversize refusal — and the contract does not specify the client's recovery from
`application_attention_wait_oversize` (a run that is oversize can *never* be woken; there is nothing
to shrink). The W-8 "64-item attention cap" is a run-view fact, not a wake-surface pin.

**Fix.** Pin an explicit `actions` slice (e.g. `MAX_ATTENTION`, with spill-digest for the remainder
per H5's fix) and a `waitingOn` cap or paging continuation, and specify the oversize-recovery
posture (shrink scope / page in batches).

### 2.3 D3 — who may be woken: **SOUND, but D3.3 is violated by B2**

**Authority inversion — SOUND.** `attention.wait` is run-scoped and routes through
`_attentionScopeAuthorized`/`_isReviewAuthority` (`coordinator.mjs:7062-7083`): `wave-owner` always,
else a live run-orchestrator lease holder whose session matches the run
(`activeRunOrchestratorLeaseForSession`). A worker principal has no such lease and is refused
`attention_scope_forbidden`. The coarse MCP `observe` capability (D4.1) is defense-in-depth, not the
authority seam. The "bare deployment scope admits any authenticated principal" escape
(`coordinator.mjs:7064-7065`) is unreachable for the wake because the wake is always run-scoped —
**but OQ-1's wave-scoped form must not pass a null runId**, or any authenticated principal would see
the deployment's whole attention surface. Pin that now, not in the OQ.

**Multi-orchestrator starvation — SOUND.** The wake is a read; it never claims, settles, or mutes.
Two waiters both page the same store-derived items; the first answer wins and the loser reads
`already_resolved` (G6). No claim-on-read leaks in for `answer_*` items. **However**, D3.3's
"two wakes with the same `afterCursor` return the same items until the store advances" is false for
`candidacy_review` (B2) — the fabricated-reason problem is a D1 defect that D3.3 inherits.

### 2.4 D4 — surface mapping: **SOUND with a hardening note (H7)**

**MCP long-poll discipline — H7.** D4.1 binds `baton_attention_wait.timeoutMs` to
`followPolicy.maxWaitMs` (≤ 24h, `application.mjs:1356`). A `tools/call` that blocks for up to
24h holds the MCP stdio channel for that whole duration. The `AbortSignal` in `waitAfter` is
server-internal; there is **no client-initiated cancellation path** for an in-flight MCP `tools/call`
(only a connection close, which the server must map to an abort — unspecified here). The
`fleet_run_wait`/`fleet_run_follow` precedent (`mcp-northbound.mjs:375-378, 930-931`) has the same
shape, so the wake is consistent with the surface — but the wake makes a 24h held lane the
orchestrator's *primary* attention surface, which raises the blast radius. Recommend pinning a
tighter MCP ceiling (e.g. the web 30s precedent) or documenting the disconnect→abort mapping.

**Web transport vs long-poll — SOUND (precedent-held).** The web ceiling caps `timeoutMs` at 30s
(`web-northbound.mjs:366`); the command envelope holds the HTTP response open until the application
returns (the `run_wait` precedent at `:1046` and `:634-636`), so the application's `timedOut: true`
receipt is what the client sees on the honest empty — the transport does not pre-empt it. The
contract must add the named ceiling check for `attention_wait` (the existing check is `run_wait`-
specific), which D6 already does via `application_attention_wait_timeout_exceeds_web_ceiling`.

**CLI — SOUND.** `baton run attention wait` extends the existing `run attention` grammar
(`application-cli.mjs:1400-1419`) and rides the existing answer legs (`:1662-1673`); the honest
empty exits 0 (a result, not a refusal).

### 2.5 D5 — #105 composition: **SOUND**

The `kind` discriminator is **derived**, never inferred from prose: `answer_*` items are minted only
by `projectDecisionAttention` from real pending interaction records (`application.mjs:575-599`), and
a reply-hop cannot produce a pending interaction (D8/D9 of `reply-chains-contract.md`; a
`question.asked blocking:true` is the worker's own escalation, which legitimately wakes as
`answer_question`). There is no wire field a reply could set to masquerade as a decision item. The
v1.0 set contains no `message_reply` kind, and D5.3 correctly pins that a future hop MUST be a new
kind — sound. The one leak is B2's fabricated `candidacy_review` (not a reply/decision issue).

### 2.6 D6 — refusal vocabulary: **SOUND with drift (H8)**

- The `stateFailureCode` "gains `attention_wait_invalid` and `application_attention_wait_oversize`"
  rationale is **half wrong** (H8): `application_attention_wait_oversize` **already survives** the
  MCP surface via the `application_` prefix pass-through (`mcp-northbound.mjs:212`), so without a
  row it does **not** degrade to `command_outcome_unknown`; only `attention_wait_invalid` would.
  Adding both rows is harmless, but the stated reason is inaccurate.
- "`attention_scope_forbidden` is a lane throw, not an MCP tool error, and needs no row" is also
  inaccurate: it **already has a row** (`mcp-northbound.mjs:262`, with
  `attention_scope_invalid`/`attention_target_invalid`). The "needs no row" conclusion is right;
  the characterization is wrong.
- The web mapper (`web-northbound.mjs:149-232`) maps unknown `application_*` codes to 400
  (`:176-179`), so `application_attention_wait_oversize` gets a 400 for free; `attention_wait_invalid`
  would fall through to 503 `temporarily_unavailable` (`:232`) and genuinely needs the new row the
  contract specifies. Directionally correct.

---

## 3. Acceptance-pin assessment

| Pin | Verdict | Basis |
|-----|---------|-------|
| W-1 (honest empty; waitAfter, no poll timer; decision park wakes same tick) | **RED as specified — and B1/B2 break the honesty** | The store-level primitive is sound, but B2 makes the honest empty unreachable for a run with a live candidacy queue, and B1/B4 make reason-only changes unobservable. |
| W-2 (decision park wakes with the `projectDecisionAttention` shape + answer address) | **RED; shape SOUND** | Shape matches `application.mjs:575-599`; live-derived so not stale. |
| W-3 (answer from wake, receipted; `already_resolved` for late answerer) | **RED for the wake; GREEN for the receipt path** | `run.answer` path pinned at `application.mjs:12492-12506`; no wake exists yet. |
| W-4 (two waiters both wake; no claim-on-read) | **RED; design SOUND** | D3 holds; B2's fabricated reason would also wake both waiters identically (harmless for muting, but spurious). |
| W-5 (reply does not wake; blocking escalation does) | **RED; design SOUND** | D5 discriminator is derived and honest. |
| W-6 (closed set, sorted; `WAITING_ON_KINDS`/`ATTENTION_TYPES` byte-unchanged) | **RED; set order VERIFIED sorted** | The literal itself is in ACTUAL sorted order. |
| W-7 (surfaces: MCP observe long-poll; web 30s ceiling; CLI exits 0 on empty) | **RED; MCP hold hazard (H7)** | |
| W-8 (frame economics: 64-cap, boundedAttentionText, oversize refusal) | **GREEN for the limits; RED for the wake builder** | H5/H6 — the "64-item attention cap" and spill claims don't map to the wake's `actions`/`waitingOn`. |
| W-9 (guarantee pin: no wake-worthy change store-invisible) | **GREEN for the individual transitions; RED for the pin's scope** | B4 — reason-only mints (coalesced terminal, candidacy) can be store-invisible. |

---

## 4. Numbered blockers (what + why + concrete fix)

1. **B1 — the composed cursor mixes the store seq and `_attentionCursor` into one paging token
   (D1.1).** *Why:* store-dominated `throughCursor` makes every later attention reason
   (`seq` ≤ cursor) invisible, so `member_terminal`/`candidacy_review` never wake a return-trip
   orchestrator; W-9, D1.2, and D3.3 are violated. *Fix:* split the payload into a `storeCursor`
   (waitAfter operand + store-item paging) and a `reasonsCursor` (the `_attentionCursor` space,
   paged by the existing `_attentionPage` filter); never fold reason seqs into `throughCursor`.

2. **B2 — `candidacy_review` is re-minted on every page with a fresh seq, unfiltered by
   `afterCursor` (`coordinator.mjs:7098-7118`).** *Why:* a run with a non-empty candidacy queue never
   returns an honest empty — every re-page fabricates a reason, violating D1.3 and D3.3 and breaking
   W-1. *Fix:* mint `candidacy_review` once into `_attentionReasons` (stable identity), refreshed only
   on a count change, and let the existing seq filter page it; or anchor its seq to the candidate
   Finding's store event.

3. **B3 — `budget_alarm` has no producer in the composed surface (D1.2).** *Why:* it is a digest
   kind (`coordinator.mjs:11859`), absent from `_attentionReasons` (G4) and from any store-derived
   item the contract names; an implementation faithful to D1.2 + G4 would never emit it. *Fix:* name
   the producer — compose the digest's `attention` (filtered to `budget_alarm`) with an ack/cursor
   discipline, or mint it into `_attentionReasons`, or drop it from the v1.0 set.

4. **B4 — a reason-only mint can be store-invisible, breaking W-9 (D1.5).** *Why:*
   `_mintMemberTerminal` fires on an already-terminal task without a `_coordTransition` store append
   (`coordinator.mjs:8150`), so the coalesced count update never advances the store and `waitAfter`
   never wakes on it. *Fix:* re-scope W-9 to store-visible changes and add a reasons notifier (per
   B1's split cursor), or make the coalesce update coincident with a store append.

5. **B5 — wrong citation: `application-cli.mjs:1655-1657` for `run approve` (G13, D2.2).** *Why:*
   the `approve` block is at `:1658-1660`; `:1655-1657` is the tail of `run status --wait`. A wrong
   citation is an automatic blocker per the brief. *Fix:* re-point both citations to
   `application-cli.mjs:1658-1660`.

Minor items to fold in (not blockers): C-1 (G3 characterization), C-2 (G8 conflation), C-3
(`briefing-pack-contract.md:377` → `:375`; `mcp-northbound.mjs:198-261` → `:200-268`), C-4
(`application.mjs` is not NUL-bearing), H5 (spill claim), H6 (`actions`/`waitingOn` caps + oversize
recovery), H7 (MCP 24h hold / no client cancel), H8 (D6 rationale drift), and OQ-1 must pin that a
wave-scoped wait never passes a null runId (the bare-deployment-scope escape).

---

## 5. Method note

- Every anchor was re-verified with `grep -an`/`sed -n` at HEAD `a596b23f4e5dcb2072f8013874ca08af6bd0d203`;
  `coordination-store.mjs` was read by `sed -n` ranges only (NUL-bearing). No file was read whole.
- The classic long-poll race, the waiter-slot bound, the answer-from-wake idempotence, the
  worker-principal authority, and the reply-vs-decision discriminator were all **tested against the
  code** and are SOUND; the blockers are concentrated in the cursor/composition design (D1), not in
  the underlying primitives.

**Deployment verification command** (Baton): executable `true`, arguments `[]`, expected exit 0.
