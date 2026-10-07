# Issue #71 — the orchestrator attention inbox: wake-with-decisions instead of poll

- **Issue:** #71 — orchestrator attention inbox (wake-with-decisions instead of poll)
- **Date:** 2026-08-07
- **Status:** v1.1 DRAFT — implementation contract (Ring-2 form, acceptance pins red-first);
  FOLD of the red-team report `contract-redteam.md` (this directory)
- **Fold note (v1.0 → v1.1):** folds the red-team report's five numbered blockers — B1 (the
  composed cursor mixes store seq and `_attentionCursor` into one token), B2 (`candidacy_review`
  re-minted per page with fresh seqs), B3 (`budget_alarm` has no producer in the composed
  surface), B4 (a reason-only mint can be store-invisible), B5 (wrong `approve` citation) — plus
  the drift/amendment items (C-1..C-4, H5-H8), the acceptance-pin amendments (§3 of the report),
  and the open-question verdicts. The blocker→change map is `contract-fold.md` (this directory).
- **Verification HEAD:** `c780ef7447728a21d34dedb206859ff91f4e24c5` (this worktree's
  effective-tree snapshot). Every `file:line` citation below was re-verified with
  `grep -an`/`sed -n` at the verification HEAD. Per C-4, only `coordination-store.mjs` is
  NUL-bearing; `application.mjs` is clean — both were read by grep/sed only, per campaign
  discipline.
- **Brief:** `contract-71-brief.md` + `fold-71-brief.md` (this directory) — read fully. The
  issue body was unavailable at drafting time (`gh` is not authenticated in this worktree), so
  the brief's own decisions carry the requirements; the lived evidence
  (`orchestrator-friction-ledger.md`) and the landed machinery carry the anchors.
- **Seed.** The frontier-sweep ledger names the gap directly — the orchestrator polls
  `status()` in 15s loops because nothing wakes it. The two relevant frictions:
  "Hand-rolled poll loops in every driver (status→approve→nudge→claim + message/elevate/
  decision)" → **#106** (`orchestrator-friction-ledger.md:15`) and "Worker can't reach the
  OPERATOR (only the orchestrator); no escalation to human attention" — "decision lane covers
  orchestrator; operator escalation is #90 (remote, low) / **#71** (wake)" (`:34`). #71 is the
  wake half: a decision parks a member (`task.transitioned` → `input_required`), but the
  orchestrator has no event-driven surface that tells it so — it must poll. The worker-side
  attention inbox (`run.attention.watch`, coordinator `_attentionReasons`) pages the inbox
  only on an explicit read, and the store's `waitAfter` long-poll primitive
  (`coordination-store.mjs:8843`) already exists, unused by any attention surface. This
  contract composes them: an orchestrator wake anchored on `waitAfter`, delivering the
  decision-first surface.

**Cross-references (not re-specified here):** #10 (`waiting-vocabulary-contract.md` — the
closed five `WAITING_ON_KINDS`, the `member_waiting` push rung of OQ3), #79
(`worker-delivery-push-contract.md` — `answer_decision` is orchestrator-addressed, GT8, the
`budget_alarm` wake reason), #105 (`reply-chains-contract.md` — D8 routing, D9 the closed
kinds), #132 (`wave-observability-contract.md` — D1 web admission, D2 the wave registry
projection this wake reads), #138 (the ledger's Appendix C — the stateless HTTP MCP posture
the wake depends on), #91 (the ledger's `--kinds` investigation surface). Each is cited at the
decision it touches. This contract owns only the orchestrator wake surface.

---

## 1. Ground truths (re-verified at HEAD `c780ef7`)

| # | Ground truth | Verified anchor |
|---|--------------|-----------------|
| G1 | The store's `waitAfter` long-poll EXISTS and is the wake primitive to compose on: event-seq anchored (no clock), bounded by a transport `timeoutMs`, abortable via an optional `AbortSignal`, returning `{advanced, upperBound}` — `advanced: true` when `_events.length > afterSeq`, `false` on timeout. `_notifyAppend` finishes every waiter whose `afterSeq` is behind the append. | `coordination-store.mjs:8843-8870`; `_notifyAppend` at `:1594-1598` |
| G2 | `run.follow` is the landed long-poll discipline that composes `waitAfter`: loop → build view → page changes → if nothing relevant and not deadline, `waitAfter(view.cursor, remaining, {signal})` → re-page on ANY store advance; unrelated backlog loops without returning. The honest empty on the transport bound is `timedOut: true` (never a fabricated change). | `application.mjs:8257-8326`; `waitAfter` call at `:8315`; `timedOut` at `:8299-8300`; the oversize refusal `application_follow_oversize` at `:8308` |
| G3 | The orchestrator polls because nothing wakes it. `coordinator.wait()` polls `_collectDigest()` on a `_waitPollMs` timer (`:11809-11843`); `run.wait` uses it (`application.mjs:7921-7950`); the wave-driver's sleep races its own poll timer against one follow per live member (`wave-driver.mjs:463-534`). `run.follow` returns on ANY `page.changes.length > 0` (`application.mjs:8298`) — `_followCategory` returns nine categories (`application.mjs:7952-7975`); the wake narrowing lives only in the wave-driver's `isTargetChange` (`wave-driver.mjs:267-272`), which aborts the sleep on `page.terminal` or an `execution`-category change and does NOT include `plan` (C-1 — the v1.0 "only `execution`/`plan`/`terminal`" characterization is imprecise). | `coordinator.mjs:11809-11843`; `application.mjs:7921-7950, 7952-7975, 8298`; `wave-driver.mjs:463-534` |
| G4 | The worker-side attention inbox EXISTS and pages two reason kinds: `member_terminal` (minted by `_mintMemberTerminal`, storm-coalesced, epoch-marked) and `candidacy_review` (minted FRESH per page read with `seq: ++this._attentionCursor` at `:7107`, NOT pushed into `_attentionReasons`, NOT filtered by the `afterCursor` seq filter at `:7092` — the B2 defect). Both page by `_attentionCursor` (`coordinator.mjs:1198` — a process-scoped, restart-resetting counter independent of the store seq), never by the store seq (the B1 defect). `attentionFollow` is a page READ (`afterCursor`/`throughCursor`, no long-poll); `run.attention.watch` calls it with `timeoutMs: undefined`. | `coordinator.mjs:7021-7058` (`attentionFollow`), `:7088-7120` (`_attentionPage`, seq filter `:7092`, candidacy mint `:7098-7117`), `:7126-7156` (`_mintMemberTerminal`, coalesce `:7141-7149`); `application.mjs:12842-12854` (`attentionWatch`) |
| G5 | The attention scope authority is the orchestrator principal: `_attentionScopeAuthorized` admits `wave-owner` always, a bare deployment scope admits any authenticated principal, and a run-scoped follow admits a live run-orchestrator lease holder via `_isReviewAuthority` (the store's `activeRunOrchestratorLeaseForSession` matched by runId + session). | `coordinator.mjs:7062-7066` (`_attentionScopeAuthorized`), `:7070-7083` (`_isReviewAuthority`) |
| G6 | The decision lane is orchestrator-addressed: a worker's `decision.requested` parks the member — `_coordTransition(task, 'input_required', ...)` — and the pending decision projects into the run view as an `answer_decision` attention entry via `projectDecisionAttention` (`{kind, workerId, requestId, question, options, allowFreeResponse, recommended, deadlineAt}`). The orchestrator answers via `run.answer(runId, requestId, answer)` → `coordinator.respond`; a late answer returns the distinct `already_resolved` outcome with `resolvedBy`, never a generic error. | `coordinator.mjs:12688-12788` (`decision.requested` admission), `:12786` (`task.input_required` transition); `application.mjs:575-599` (`projectDecisionAttention`), `:12469-12511` (`run.answer`, `already_resolved` at `:12492-12506`); `wave-driver.mjs:622-641` (`onDecision` callback) |
| G7 | The blocking-interaction kinds are a closed three: `answer_decision`/`answer_question`/`answer_approval` (`BLOCKING_INTERACTION_KINDS`, `wave-driver.mjs:202-205`). The #10 waiting vocabulary is a closed five: `WAITING_ON_KINDS = ['capacity_ceiling','dispatch_pending','plan_approval','provider_stalled','spawning']` (frozen, in ACTUAL sorted order). `decision_pending` stays OUT of `WAITING_ON_KINDS` — it is already projected via attention. A reply chain never enters either set (#105 D9). | `wave-driver.mjs:202-205`; `application-semantics.mjs:58-61` |
| G8 | The #10-era inbox vocabulary is a DIFFERENT thing: `ATTENTION_TYPES = Object.freeze(['approval','question','blocked','stalled','budget_alarm'])` (messages.mjs:18). `budget_alarm` is orchestrator/operator-relevant BUT it is a DIGEST attention kind produced in `_collectDigest` (`'resource.budget_threshold': 'budget_alarm'`, coordinator.mjs:11859, within `:11852-11861`), read from the coordinator's per-worker event log (`:8970-8978`) — it is NOT an `_attentionReasons` kind; the attention inbox pages only `member_terminal`/`candidacy_review` (C-2; the seed of B3). #79 adjudicated `answer_decision` as orchestrator-addressed and excluded from worker push. | `messages.mjs:18`; `coordinator.mjs:11852-11861, 11859, 8970-8978`; `worker-delivery-push-contract.md:232-249` |
| G9 | The wave lifecycle events exist: `wave.started` mints pre-loop, exactly-once, idempotency-keyed (`wave.started:${waveId}`) as a `driver.recorded` payload (`application.mjs:4619-4630`); the wave-driver's post-close `wave.closed` append seam exists at the application layer (`application.mjs:12563-12573`), folded as a TOP-LEVEL store event per #103 D9 (`briefing-pack-contract.md:375` — C-3 re-point from `:377`, spec-referenced). #132's registry projection (`waves.list`, `_waveRegistry`) folds both — this wake reads it, never re-derives it. | `application.mjs:4619-4630, 12563-12573`; `wave-observability-contract.md` D2 |
| G10 | The #105 D8 boundary is the routing rule this wake composes: blocking follow-ups go to the interaction lane (`question.asked blocking:true` → task `input_required` → an `answer_*` item); conversational follow-ups go to the budgeted reply lane (no task phase transition, `waitingOn` stays null — D9). A decision gate ALWAYS transitions a task phase; a reply hop NEVER does. | `reply-chains-contract.md` D8/D9; `coordinator.mjs:12614-12631` (`question.asked` blocking path) |
| G11 | Frame economics (#89) is one declared registry: `decision.question` 2048 / `decision.option.label` 160 / `decision.option.summary` 512 / `decision.text` 4096 bytes (admission, refused `decision_*_exceeded`), `view.attention_text.bytes` 4096 (view, graceful `shed-flagged`). `run.follow` bounds its serialized response by `followPolicy.maxResponseBytes` = `MAX_RUN_VIEW_BYTES` (`application.mjs:1344-1359`); the run-view attention array is capped at `MAX_ATTENTION = 64` and every worker-authored field passes `boundedAttentionText` (`application.mjs:58-59, 334-342`). | `limits.mjs:59, 68-70, 99`; `application.mjs:55, 58-59, 334-342, 1344-1359` |
| G12 | The web surface already admits long-poll transports: `run_follow`/`run_wait` ride the `/v1/commands` envelope (`web-northbound.mjs:634-636`), `run_wait` timeoutMs > 30_000 refuses `application_wait_timeout_exceeds_web_ceiling` (`:366`); `/v1/events` SSE is poll-based (`WebEventStream`, `web-stream.mjs:194`). The MCP surface already has the long-poll precedent `fleet_run_follow`/`fleet_run_wait` with the timeout guard `invalid_run_wait` (`mcp-northbound.mjs:375-378, 930-931`). | `web-northbound.mjs:15-17, 53-58, 366, 634-636`; `web-stream.mjs:194`; `mcp-northbound.mjs:375-378, 930-931` |
| G13 | The CLI already parses `run attention watch` (page read), `run answer --option`, and `run approve --plan`. `run follow --wait`/`run status --wait` are the blocking CLI precedents (map to `run.follow`/`run.wait`). | `application-cli.mjs:1400-1419` (`attention watch`), `:1658-1660` (`approve` — B5 re-point from `:1655-1657`), `:1662-1673` (`answer --option`), `:1649-1656` (`--wait`) |
| G14 | The #138 dependency is on the ledger, not in the tree: "A process-per-call orchestrator (kimi's Bash) can never hold the wave lane — the only northbound with waves (#132) requires a persistent parent" → **#138** (stateless HTTP MCP endpoint on the resident). The wake is a persistent-session long-poll; #138's process-per-call endpoint can issue a bounded one-shot wait, never a held lane. | `orchestrator-friction-ledger.md:108` (Appendix C) |

---

## 2. Decisions

### D1 — The wake primitive: a `waitAfter`-anchored long-poll over the composed orchestrator surface

**The orchestrator asks "wake me when anything needs me"; the answer is a new run-scoped
command `attention.wait` that composes the store's `waitAfter` (G1) exactly the way
`run.follow` does (G2) — but pages the ORCHESTRATOR's composed surface, not the run-follow
change page.** No clock is a workflow control: `timeoutMs` is only the transport's long-poll
bound; the loop wakes on an event-seq advance and re-pages.

1. **The wait loop.** `attention.wait(runId, {afterCursor: {storeCursor, reasonsCursor}, timeoutMs}, principal)`
   follows the `run.follow` shape (G2): authorize (D3), then loop —
   build the composed surface (D2), page store-derived items past `storeCursor` and attention
   reasons past `reasonsCursor` (G4's `_attentionPage` filter, `coordinator.mjs:7092`), and if
   any actionable item or reason is present, deliver; else `waitAfter(storeCursor, remaining,
   {signal})` (`coordination-store.mjs:8843`) and re-page on ANY store advance or on the
   reasons notifier (D1.6). A store advance for an unrelated event (e.g. an artifact
   registered) re-pages, finds nothing past the cursors, and loops — never a fabricated reason.
   **B1 fold — the cursor is SPLIT, never composed into one token.** The store seq (the
   `waitAfter` operand and the paging cursor for store-derived items) is `storeCursor`; the
   attention-reason seqs (G4's `_attentionCursor` space — a process-scoped, restart-resetting
   counter independent of the store) are a SEPARATE `reasonsCursor`, paged by the existing
   `_attentionPage` filter. A reason seq is NEVER folded into `storeCursor`; the store cursor
   is the only monotone continuation token. (Anchoring reason seqs to the store head at mint
   time is NOT a substitute — two reasons minted between store advances would collide on the
   same seq.) This kills the return-trip invisibility: `member_terminal`/`candidacy_review`
   page by `reasonsCursor` in the `_attentionCursor` space and wake a return-trip orchestrator,
   instead of being skipped by a store-dominated `afterCursor`.
2. **The closed set of wake classes.** The wake reports exactly these reason kinds
   (a frozen `WAKE_REASONS` literal in ACTUAL sorted order, matching the `WAITING_ON_KINDS`
   frozen-array discipline of G7):
   ```
   ['answer_approval', 'answer_decision', 'answer_question', 'budget_alarm', 'candidacy_review', 'member_terminal', 'plan_approval', 'wave_terminal']
   ```
   - `answer_decision` / `answer_question` / `answer_approval` — the blocking-interaction lane
     (G7): a decision parked, a blocking question asked, an approval pending.
   - `member_terminal` / `candidacy_review` — the existing coordinator attention reasons (G4).
     `candidacy_review` is a STABLE-IDENTITY reason (B2): minted ONCE into `_attentionReasons`
     when the run first has a non-empty candidacy queue, refreshed (count/candidates updated in
     place, seq unchanged) only when the queue count changes, and paged by the same
     `reason.seq <= reasonsCursor` filter as `member_terminal` — never re-minted per page read.
   - `budget_alarm` — the orchestrator/operator-relevant BD3-D wake reason (G8,
     `resource.budget_threshold` → `budget_alarm`); it rides `reasons` composed from the
     digest's `attention` array (`_collectDigest`, `coordinator.mjs:11852-11861`) FILTERED to
     `budget_alarm`, with the digest's own ack/cursor discipline (B3 — the producer is named;
     `_attentionPage` produces only `member_terminal`/`candidacy_review` and never emits it).
     Read, never answered in place — D2.3.
   - `plan_approval` — a plan is advertised awaiting approval (the run's
     `waitingOn: 'plan_approval'` — G7); the wake carries the plan digest (D2).
   - `wave_terminal` — the wave itself closed (#132 registry `state: 'closed'`, G9).
   NOT in the set: reply-chain hops (#105 D8, D5 below), routine progress, unrelated backlog,
   and the worker-facing #10-era `ATTENTION_TYPES` kinds (`approval`/`question`/`blocked`/
   `stalled` — the orchestration-era inbox vocabulary, G8).
3. **The honest empty.** When the transport bound elapses with nothing past either cursor, the
   wake returns `{woken: false, timedOut: true, storeCursor: <unchanged>, reasonsCursor: <unchanged>, actions: [], reasons: []}`
   — never a fabricated reason, never a synthesized default. B2's stable-identity
   `candidacy_review` makes the honest empty REACHABLE for a run with a live candidacy queue
   (no re-mint fabricates a reason per re-page); B1's split cursor keeps the honest empty a
   true continuation across returns. This is `run.follow`'s `timedOut: true` posture (G2)
   applied to the attention surface.
4. **WaitingOn transitions to interaction.** A member whose `waitingOn` kind changes — set,
   cleared, or moved to a blocking interaction — is a wake-worthy transition (the brief's
   "waitingOn transitions to interaction"). The composed surface pages each member's current
   `waitingOn` and each pending blocking interaction; a `member_waiting`-style delta is
   reported as the member's `waitingOn` value riding the wake payload (D2), NOT as a new
   `WAITING_ON_KINDS` kind (G7 stays closed; #10 OQ3's `member_waiting` rung is folded into
   the wake surface, not the vocabulary).
5. **Every wake-worthy STORE change is store-seq-visible (a guarantee pin, not a clock; B4
   re-scope).** The loop wakes on a store advance, so the coordinator must append a store event
   coincident with every wake-worthy STORE-visible state change. This already holds: a decision
   park is a `task.transitioned` (`application.mjs`-visible via
   `_coordTransition(task, 'input_required')`, G6); a candidacy admission is a store queue
   event; a wave close is the `wave.closed` append (G9); a plan proposal is
   `plan.version_proposed`. The pin is re-scoped to store-visible changes because a REASON-ONLY
   mint can be store-invisible (B4): `_mintMemberTerminal` fires on every
   `lifecycle.turn_completed` with `status: 'completed'` (`coordinator.mjs:12318`) — including
   when the task is already terminal, in which case `_coordTransition` no-ops
   (`coordinator.mjs:8148`) and no store event lands; the storm-coalesced count update
   (`coordinator.mjs:7141-7149`) is therefore observable only on the next store advance unless
   the reasons notifier carries it (D1.6).

6. **The reasons notifier (reason-only liveness, B1 + B4).** The attention reasons are
   process-scoped (G4, non-goal), so a reason-only mint has no store event to wake
   `waitAfter`. The wake's loop therefore awaits the store `waitAfter` AND an in-process
   reasons notifier: when `_mintMemberTerminal` mints/coalesces a reason or `candidacy_review`
   refreshes on a queue-count change, the notifier finishes the waiter exactly as an append
   would (event-driven, never a clock). A reason-only mint wakes a waiting orchestrator
   without a store append; the store cursor does NOT move, so the store-derived page is
   unchanged and the wake delivers the reason alone (D2.3).

### D2 — The decision-first surface: wake-with-decisions

**The wake payload surfaces actionable items FIRST, with their answer address riding each item,
so the orchestrator answers from the wake without a second read.** The payload shape:

```
{
  schemaVersion: 1,
  woken: true,
  runId,                         // the scoped run the orchestrator follows
  storeCursor,                   // B1 split: the waitAfter operand + store-item paging cursor
  reasonsCursor,                 // B1 split: the _attentionCursor-space paging cursor
  actions: [ ... actionable items FIRST ... ],
  reasons: [ ... attention reasons ... ],
  waitingOn: [ { runId, kind|null, workerId? } ... ],   // per-member waitingOn deltas
  wave: { state: 'open'|'closed', waveId, ... },        // #132 registry row projection
  timedOut: false,
}
```

1. **Actionable-item shape (decision-first).** The `answer_*` items mirror
   `projectDecisionAttention` verbatim (G6) plus the answer address:
   ```js
   {
     kind: 'answer_decision',            // | 'answer_question' | 'answer_approval'
     runId: '<member run>',              // the interaction's OWN run (G6: the answer must
                                         //   resolve inside this run — application.mjs:12480-12491)
     workerId, requestId,                // projectDecisionAttention identity
     question: boundedAttentionText(...),// view.attention_text.bytes 4096 discipline (G11)
     options: [{id, label, summary}],    // bounded (G11)
     allowFreeResponse, recommended, deadlineAt,   // verbatim from projectDecisionAttention
     answer: {                           // the direct-answer address — answer FROM the wake
       command: 'run.answer', runId, requestId,
     },
   }
   ```
   A `plan_approval` item is `{kind: 'plan_approval', runId, planDigest,
   answer: {command: 'run.approve', runId, planDigest}}` — the advertised plan's digest is the
   actionable identity; the orchestrator approves with one command.
2. **The direct-answer path, receipted.** The orchestrator answers from the wake payload with
   the item's own `answer.command`: `run.answer(runId, requestId, {optionId | text | decision})`
   (`application.mjs:12469-12511`) / MCP `baton_decision_answer`
   (`mcp-northbound.mjs:551-557`) / CLI `baton run answer RUN --option ID`
   (`application-cli.mjs:1662-1673`); or `run.approve` / `baton run approve RUN --plan DIGEST`
   (`application-cli.mjs:1658-1660` — B5 re-point). The answer is RECEIPTED with the
   coordinator's own result code: `applied`, or `already_resolved` with `resolvedBy` for a late answerer
   (G6) — never a generic error.
3. **The action/reason split is machine-readable.** `actions` carry the blocking-interaction
   kinds and `plan_approval` (the things the orchestrator can settle by answering); `reasons`
   carry `member_terminal`/`candidacy_review`/`budget_alarm` (attention the orchestrator reads
   but does not answer in-place). A consumer routes on `entry.kind` — an `answer_*` item is
   answered, a reason is read.
4. **Frame economics (#89).** The composed surface is bounded: every worker-authored field
   passes `boundedAttentionText` (`application.mjs:334-342`, G11); the serialized wake payload
   is capped by the profile's `followPolicy.maxResponseBytes` = `MAX_RUN_VIEW_BYTES`
   (`application.mjs:1344-1359`), refusing `application_attention_wait_oversize` on overflow —
   the `run.follow` oversize refusal precedent (`application_follow_oversize`,
   `application.mjs:8308`). **H6 fold — `actions` is sliced to `MAX_ATTENTION = 64`
   (`application.mjs:58`);** the remainder of a run's pending interactions spills as a digest
   (head + citation) so the orchestrator still sees more awaits, and drains them by paging.
   **`waitingOn` is likewise capped** (per-member deltas, D1.4 — up to `MAX_RUN_VIEW_WORKERS`
   = 1,024 members, `application.mjs:56`); a run with more member deltas pages them on the next
   wake. **Oversize-recovery posture:** `application_attention_wait_oversize` is a real refusal
   the client recovers from by NARROWING SCOPE or PAGING THE SURFACE IN BATCHES (raising
   `storeCursor`/`reasonsCursor` to drain) — the items are real state, so there is nothing to
   shrink; a run that is oversize is never silently skipped. **H5 fold — a decision question is
   NEVER oversize at the wake:** `decision.question` is an admission-bound field with
   `graceful: null` (`limits.mjs:59`), refused at admission with `decision_question_exceeded`
   plus the coaching `{cap, actual, unit, gracefulPath}` (`coordinator.mjs:12698-12727`), so an
   oversize question never reaches the wake's oversize path. The spill-digest-citation economy
   belongs to `message.reply.body`/`wave.member.objective` (`limits.mjs:55, 57`), not to
   decisions; the wake's own oversize spill (the `actions` remainder) uses that same
   head+digest shape.
5. **The cursors are the paging contract (B1 split).** A consumer passes the returned
   `storeCursor` back as the next `storeCursor` and the returned `reasonsCursor` back as the
   next `reasonsCursor` — the two spaces are NEVER folded into one token. On an honest empty
   (D1.3) both cursors are unchanged, so a retry with the same cursors is a true continuation,
   never a re-read.

### D3 — Who may be woken: the orchestrator principal, multi-orchestrator honest

1. **The scope authority is the existing one.** `attention.wait` authorizes through
   `_attentionScopeAuthorized` / `_isReviewAuthority` (G5): the deployment's `wave-owner`
   principal always; a run-scoped wait also admits a live run-orchestrator lease holder whose
   session matches the run (`activeRunOrchestratorLeaseForSession`). A bare deployment scope
   admits any authenticated principal; the run-scoped target check holds them honest
   (`coordinator.mjs:7062-7083`). **OQ-1 pin — a wave-scoped wait NEVER passes a null runId.**
   The bare-deployment-scope escape is `runId == null` (`coordinator.mjs:7064-7065`); if a
   wave-scoped form dropped the runId, any authenticated principal would see the deployment's
   whole attention surface. The wave-scoped form must carry a concrete run-scoped authority or
   an explicit wave-scope check that replaces the null-runId branch — pinned now, not in the OQ.
2. **Multi-orchestrator honesty: two waiters both wake — no claim-on-read.** The wake is a
   READ; it never claims, settles, or mutes an item. Two orchestrators (the `wave-owner` and a
   live run-orchestrator lease holder) both page the same actionable items and both wake on the
   same store advance. The FIRST answer wins; the loser's `run.answer` returns
   `already_resolved` with `resolvedBy` (G6). The wake surface never records "who read it" and
   never withholds an item because another waiter saw it.
3. **A wake does not re-answer or re-settle.** The wake delivers state; only the answer
   commands (`run.answer`/`run.approve`) mutate. A wake payload is idempotent to read: two
   wakes with the same `storeCursor` + `reasonsCursor` return the same items until the store
   advances past the store cursor or a reason is minted/refreshed past the reasons cursor —
   B2's stable-identity `candidacy_review` (no per-page re-mint) is what makes this honest for
   a run with a live candidacy queue.

### D4 — The surface mapping

1. **MCP — a `baton_attention_wait`-class tool.** The new tool joins the ordinary table beside
   `baton_run_attention_watch` (`mcp-northbound.mjs:620-626`, capability `['observe']` at
   `:112`), with the long-poll discipline the MCP surface already carries for
   `fleet_run_follow`/`fleet_run_wait` (`mcp-northbound.mjs:375-378`): `inputSchema` =
   `{repoId, runId, afterCursor: {storeCursor, reasonsCursor}, timeoutMs}` with `timeoutMs` a
   safe positive integer bounded by the deployment profile's `followPolicy.maxWaitMs`
   (≤ 24h, G11) — the `invalid_run_wait` guard precedent (`mcp-northbound.mjs:930-931`).
   **H7 fold — the MCP ceiling is TIGHT (the web 30s precedent, `web-northbound.mjs:366`), not
   24h, and a connection close ABORTS the in-flight wait.** A 24h held `tools/call` lane on the
   MCP stdio channel is the wake's primary-surface blast radius; the MCP surface issues bounded
   ONE-SHOT waits (the #138 posture, D4.4), while the CLI and the web command envelope may hold
   up to `maxWaitMs`. The disconnect→abort mapping is pinned: a connection close aborts the
   in-flight `waitAfter` via its `AbortSignal` (G1) — the honest `timedOut: true` receipt is
   what the client sees on a close. Capability `['observe']` — the wake is a read; the
   answering capability already rides `baton_decision_answer` (`['approve','observe']`,
   `mcp-northbound.mjs:92`). The `stateFailureCode` allowlist gains the new refusals (D6).
2. **Web — the command envelope, not SSE.** `attention_wait` rides `/v1/commands` as a
   `run_follow`-class transport (`web-northbound.mjs:634-636`): a bounded request/response
   long-poll, never the poll-based `/v1/events` SSE (`web-stream.mjs:194`). The web ceiling
   applies: `timeoutMs > 30_000` refuses `application_attention_wait_timeout_exceeds_web_ceiling`
   — the `run_wait` ceiling precedent (`web-northbound.mjs:366`).
3. **CLI — `baton run attention wait` (the brief's `baton attention wait`).** The CLI grammar
   extends the existing `run attention` block (`application-cli.mjs:1400-1419`) with a
   `wait` action: `baton run attention wait RUN [--timeout MS] [--store-cursor N]
   [--reasons-cursor N] [--kind KIND]` — blocks on the wake and renders the decision-first
   payload, exiting with the honest empty on the transport bound (never a fabricated reason,
   never a nonzero exit for an empty wake). `run answer --option` / `run approve --plan`
   (`application-cli.mjs:1658-1673` — B5 re-point) are the answer legs.
4. **The #132 D1 and #138 dependency posture.** The wake is a `definition.web`-style entry (or,
   if it stays a direct port, a #132-D1-style web slice: a `WAKE_WEB_ENTRIES` row spread into
   `COMMAND_CAPABILITY` + a validator exception — `wave-observability-contract.md` D1.1-1.2).
   It must ride whichever admission lands first and never duplicate #132's slice. **The #138
   posture is pinned:** the wake is a PERSISTENT-session long-poll — a held `waitAfter` on the
   deployment's private coordination store. A stateless process-per-call orchestrator (#138)
   cannot hold the lane; its endpoint issues a bounded one-shot wait (one `waitAfter` hop with
   an honest empty on the transport bound), never a resumed lane. The long-poll contract does
   not depend on #138 landing; #138's endpoint, when it lands, reuses the same command.

### D5 — The #105 composition: reply-chain hop vs decision, machine-readable

Per #105 D8 (G10), the wake distinguishes the two machine-readably by the **presence and kind
of an actionable item**, never by inferring blockingness from prose:

1. **A decision wake is an `answer_*` action item.** A blocking follow-up goes to the
   interaction lane (G10) — a decision gate ALWAYS transitions a task phase — and surfaces in
   `actions` with `kind: 'answer_decision'` (or `answer_question`/`answer_approval`), carrying
   `requestId` + the direct-answer address (D2.1). This is the ONLY machine-readable "this is
   blocking, answer now" signal in the wake.
2. **A reply-chain hop is never a wake reason.** A conversational follow-up goes to the budgeted
   reply lane (G10) — no task phase transition, `waitingOn` stays null (D9). The wake's closed
   set (D1.2) contains no `message_reply` / reply-hop kind; a reply lands, the store advances,
   the wake re-pages, finds nothing past the cursors, and stays silent. The honest state is
   `{woken: false}` for a reply — the orchestrator observes a chain through the receipt lane
   (#105 D4), never through the wake.
3. **The distinction is the `kind` discriminator, pinned for future surface too.** If a future
   epic adds orchestrator-addressable reply hops (#105 OQ-1), such a hop MUST surface as a NEW
   kind (e.g. `message_reply` with `{messageId, inReplyTo}`), never folded into `answer_decision`
   — a consumer answering on `kind` must never mistake a reply hop for a decision gate. In v1.0
   no such kind exists; the honest-empty posture (D1.3) covers a reply-only interval.
4. **A chain deadlock is not a wake cause; its escalation is.** A genuinely blocked worker must
   raise `question.asked` → `input_required` (G10), which surfaces as `answer_question` and
   wakes. A stalled pure-conversational cycle (no pending interaction) stays a monitoring
   concern (#105 D9) — the wake never fabricates a reason from a stall.

### D6 — Refusal vocabulary

Existing, reused unchanged:

| Code | Where | Meaning |
|---|---|---|
| `attention_scope_invalid` / `attention_scope_forbidden` | `coordinator.mjs:7021-7066` | The run-scoped scope/target authority check (unchanged) |
| `application_attention_watch_invalid` | `application.mjs:12639-12654` | Malformed `run.attention.watch` request (unchanged) |
| `application_follow_unavailable` / `application_follow_invalid` / `application_follow_cancelled` / `application_follow_oversize` | `application.mjs:8257-8326` | The `run.follow` long-poll refusals (the wake's shape precedents) |
| `application_wait_timeout_exceeds_web_ceiling` | `web-northbound.mjs:366` | A web wake `timeoutMs > 30_000` (unchanged precedent) |
| `invalid_run_wait` | `mcp-northbound.mjs:930-931` | An MCP wake `timeoutMs` beyond the profile bound (the guard shape) |
| `already_resolved` | `application.mjs:12492-12506` | A late answer's distinct typed result (the wake's answer path) |

New, introduced by this contract:

| Code | Where | Meaning |
|---|---|---|
| `attention_wait_invalid` | `application.mjs` (the new `_normalizeAttentionWait`) | Malformed `attention.wait` request — bad `runId`/`storeCursor`/`reasonsCursor`/`timeoutMs`/`kind`; refused at the application layer, preserved on every surface |
| `application_attention_wait_oversize` | the composed-surface builder (D2.4) | The serialized wake payload exceeds `followPolicy.maxResponseBytes` — the `application_follow_oversize` precedent (G11) |
| `application_attention_wait_timeout_exceeds_web_ceiling` | web-northbound.mjs | The web transport ceiling, named for the wake transport (D4.2) |

The `stateFailureCode` allowlist (`mcp-northbound.mjs:200-268` — C-3 re-point) gains
`attention_wait_invalid` — it would otherwise degrade to `command_outcome_unknown` (H8).
`application_attention_wait_oversize` ALREADY survives the MCP surface via the `application_`
prefix pass-through (`mcp-northbound.mjs:205`), so without a row it does NOT degrade — adding
its row is harmless, but survival does not depend on it. `already_resolved` already survives
via the same `application_` pass-through. `attention_scope_forbidden` already has a row
(`mcp-northbound.mjs:246`, alongside `attention_scope_invalid`/`attention_target_invalid`) —
it is a lane throw and needs no NEW row. The web mapper (`web-northbound.mjs:170-173`) already
maps unknown `application_*` codes to 400, so `application_attention_wait_oversize` gets a 400
for free; `attention_wait_invalid` would fall through to 503 `temporarily_unavailable`
(`web-northbound.mjs:232`) and genuinely needs the new 400-class row (the `capability_*_invalid`
family precedent).

The wire sorted-key literals remain exactly as verified: `ATTENTION_TYPES` in ACTUAL order
(G8), `WAITING_ON_KINDS` in ACTUAL sorted order (G7), `WAKE_REASONS` in ACTUAL sorted order
(D1.2). No new sorted-key literal is introduced.

---

## 3. Acceptance pins (red-first)

RED = fails at HEAD; GREEN = passes at HEAD and is pinned.

| Pin | Assertion | Today |
|-----|-----------|-------|
| W-1 | **The wake long-polls on `waitAfter`, and every wake-worthy STORE change advances the store seq.** An orchestrator `attention.wait` on a run with no pending items holds a `waitAfter` (no poll timer on the hot path — `coordinator.wait`/`run.wait`'s `_waitPollMs` loop is not used) and returns the honest empty `{woken: false, timedOut: true, storeCursor: <unchanged>, reasonsCursor: <unchanged>, actions: [], reasons: []}` on the transport bound, never a fabricated reason. A decision park (G6) advances the store seq AND wakes the wait in the same tick. Folded: B1's split cursor + D1.6's reasons notifier make reason-only mints observable; B2's stable-identity `candidacy_review` makes the honest empty reachable with a live candidacy queue. | **RED** (no wake surface; the attention inbox is page-read-only, G4) |
| W-2 | **A decision park wakes with the decision-first item.** A member's `decision.requested` wakes an orchestrator waiting on that run with an `actions` entry `{kind: 'answer_decision', runId, workerId, requestId, question, options, allowFreeResponse, recommended, deadlineAt, answer: {command: 'run.answer', runId, requestId}}` — the `projectDecisionAttention` shape (G6) plus the answer address. | **RED** (no wake; `run.attention.watch` returns only `member_terminal`/`candidacy_review`, G4) |
| W-3 | **Answer from the wake, receipted.** Answering the wake's `answer_decision` item via `run.answer`/`baton_decision_answer`/`baton run answer --option` returns the coordinator's result code (`applied`); a late answerer on the same `requestId` returns `already_resolved` with `resolvedBy` — the wake never re-answers a settled item (D3.3). | **RED** for the wake; the `run.answer` receipt path is **GREEN** (pinned) |
| W-4 | **Two waiters both wake — no claim-on-read.** The `wave-owner` AND a live run-orchestrator lease holder waiting on the same run both wake with the same items; neither read mutes the other's wake; the first answer wins and the loser reads `already_resolved` (D3.2). Folded: B2's stable-identity `candidacy_review` removes the spurious both-waiters-wake caused by the per-page re-mint (report §2.3). | **RED** (no wake surface; the authority check itself is **GREEN** at `coordinator.mjs:7062-7083`) |
| W-5 | **A reply-chain hop does not wake; a blocking escalation does.** A worker's budgeted reply (no phase transition) advances the store but returns `{woken: false}` on the transport bound; a `question.asked blocking:true` → `input_required` escalates as `{kind: 'answer_question'}` (D5, G10). No `message_reply` kind exists in `WAKE_REASONS` (D1.2). | **RED** (no wake surface) |
| W-6 | **The closed set.** `WAKE_REASONS` is exactly `['answer_approval','answer_decision','answer_question','budget_alarm','candidacy_review','member_terminal','plan_approval','wave_terminal']` — a `sort()`-deepEqual pin in ACTUAL sorted order; `WAITING_ON_KINDS` and `ATTENTION_TYPES` are byte-unchanged (G7, G8). | **RED** (no `WAKE_REASONS` literal) |
| W-7 | **Surfaces.** MCP `baton_attention_wait` (observe) long-polls with `timeoutMs` bounded by the TIGHT MCP ceiling (the web 30s precedent — H7 fold) and maps a connection close to an abort of the in-flight `waitAfter` (G1); the web envelope `attention_wait` respects the 30s ceiling; the CLI `baton run attention wait RUN --timeout` blocks and exits 0 on an honest empty (D4). | **RED** (no wake surface) |
| W-8 | **Frame economics.** The wake payload is bounded — `actions` sliced to `MAX_ATTENTION = 64` with the remainder spilled as a head+digest, `waitingOn` capped, `boundedAttentionText` on every worker-authored field, `maxResponseBytes` oversize refusal with the page-in-batches recovery posture, and NO decision-question spill (decision questions are admission-bound and never reach the wake oversize path) — and the decision limits (`decision.question` 2048, `decision.option.label` 160, `decision.option.summary` 512, `decision.text` 4096, `view.attention_text.bytes` 4096) are unchanged (G11). (H5 + H6 folds.) | **GREEN** for the limits (pinned); the wake's own bounded builder is **RED** |
| W-9 | **Guarantee-pin: no wake-worthy STORE change is store-invisible (B4 re-scope).** A decision park, a candidacy admission, a plan proposal, and a wave close each advance the store seq (D1.5) — a green test can append each wake-worthy store change and assert the store cursor advanced before the wait returned. Reason-only mints (the coalesced member-terminal count update on an already-terminal task, a candidacy refresh) are delivered by the reasons notifier (D1.6), not by a store append — they wake without advancing the store cursor. | **GREEN** for the individual store transitions (they already append); the reasons notifier is the new pin |

---

## 4. Campaign-law constraints and non-goals

- **No clocks as controls.** `timeoutMs` is the transport's long-poll bound and nothing else —
  the `waitAfter` discipline (G1). The wake never ticks, never expires a decision early, never
  gates on a timer. `deadlineAt` on an `answer_decision` item is the worker-authored admission
  sweep (G6), surfaced for orchestrator prioritization, never a wake control.
- **No new waiting kinds.** `WAITING_ON_KINDS` stays the closed five (G7); the
  `member_waiting` rung of #10 OQ3 is folded into the wake SURFACE (a member's `waitingOn`
  rides the payload), not into the vocabulary.
- **`localeCompare` banned.** All ordering is seq-ascending (`_attentionCursor`/store seq) or
  frozen-array ACTUAL order; no locale-aware sort.
- **Compose, never duplicate.** The wake reads #132's registry projection (`waves.list`,
  `_waveRegistry`) for `wave_terminal` (G9), `projectDecisionAttention` for the decision items
  (G6), the existing `_attentionPage` for the `member_terminal`/`candidacy_review` reasons
  (G4), and `_collectDigest`'s `attention` array (filtered to `budget_alarm`, G8/B3) for the
  digest reason — none is re-derived.
- **The cursor is split, never composed (B1).** `storeCursor` (the store seq — the `waitAfter`
  operand and the store-item paging cursor) and `reasonsCursor` (the `_attentionCursor` space
  — the `_attentionPage` filter) are independent continuation tokens; a reason seq is never
  folded into the store cursor, and the store cursor is the only monotone continuation token.
- **The honest empty is a result, not a refusal.** A wake with nothing to report is
  `{woken: false, timedOut: true}` — a successful read, never an error, never a fabricated
  reason (D1.3).
- **The wake never settles.** Only `run.answer`/`run.approve` mutate; the wake is read-only
  (D3.3, D4.1 — the observe capability).
- **Non-goals.** Moving the coordinator's in-memory attention reasons into the store (they stay
  process-scoped, G4; the D1.6 reasons notifier is process-scoped, and reason seqs are NOT
  anchored to the store head — B1); orchestrator-addressable reply-chain hops (#105 OQ-1 —
  D5.3 pins the discriminator for the future surface, v1.0 has no such kind); the #138
  stateless endpoint itself (the wake pins only the dependency posture, D4.4); cross-run wake
  aggregation (v1.0 is run-scoped; a wave-wide wake composes the per-member runs the driver
  already follows, G3).

---

## 5. Open questions

- **OQ-1 — Wave-scoped vs run-scoped wait — PINNED, not deferred.** v1.0 pins a run-scoped
  `attention.wait` (the orchestrator follows one run). The brief's "wave terminal events" wake
  cause (D1.2) implies a wave-scoped form that pages the #132 registry row + all member runs.
  **The fold pins the authority invariant now: a wave-scoped form NEVER passes a null runId**
  (the bare-deployment-scope escape, `coordinator.mjs:7064-7065`; D3.1) — it must carry a
  concrete run-scoped authority or an explicit wave-scope check. The form itself stays the
  recommendation: a wave-scoped wrapper composes per-member runs with the wave-driver's
  one-follow-per-member law (`wave-driver.mjs:463-534`); decide from the wave driver's lived
  polling (G3) before adding a second scope.
- **OQ-2 — `budget_alarm` as a wake reason — RESOLVED by B3.** G8 pins `budget_alarm` as
  orchestrator/operator relevant (`coordinator.mjs:11859`) and the brief names "attention items
  addressed to the orchestrator". The fold names the producer (D1.2): the wake composes
  `_collectDigest`'s `attention` array (`coordinator.mjs:11852-11861`) filtered to
  `budget_alarm`, with the digest's own ack/cursor discipline. It stays a reason (read, not
  answered in place); whether an operator must ANSWER a `budget_alarm` (not just read it) is
  #90's escalation territory, not #71's.
- **OQ-3 — `plan_approval` actionable vs reason.** D2.1 makes `plan_approval` actionable (the
  advertised plan's digest rides with the `run.approve` address). If a later epic makes plan
  approval multi-run or batch, the actionable shape may need the run's plan lane read; v1.0
  keeps the single-run digest.
- **OQ-4 — web transport ceiling.** The wake rides the command envelope (D4.2) and inherits
  the 30s `run_wait` ceiling (`web-northbound.mjs:366`). If a future web client needs a longer
  held wake, the ceiling is a web-surface transport bound, not a workflow gate — raise it there,
  never in the lane.

---

## 6. Verification

- **HEAD pinned:** `c780ef7447728a21d34dedb206859ff91f4e24c5` (this worktree's effective-tree
  snapshot at fold time).
- **Fold discipline (v1.1):** every fold-in anchor was re-verified by `grep -an`/`sed -n` at
  the verification HEAD. Per C-4, only `coordination-store.mjs` is NUL-bearing; `application.mjs`
  is clean — both were read by grep/sed only. The red-team's worktree HEAD was
  `a596b23f4e5dcb2072f8013874ca08af6bd0d203`; line numbers that shifted between worktrees were
  re-pinned to this HEAD (e.g. `mcp-northbound.mjs:205` the `application_` pass-through, `:246`
  the `attention_scope_*` row; `web-northbound.mjs:170-173` the `application_*`→400 block).
  Sorted-key literals appear only as verified (G7, G8, D1.2); `WAKE_REASONS` is byte-unchanged
  from v1.0. Cross-referenced contracts (#10, #79, #105, #132, #138 via the ledger, #91 via
  the ledger) are cited, never re-specified.
- **Deployment verification command** (Baton): executable `true`, arguments `[]`, expected
  exit 0.
