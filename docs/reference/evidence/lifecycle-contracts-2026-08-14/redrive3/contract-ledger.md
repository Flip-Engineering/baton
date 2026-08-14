# CONTRACT-LEDGER v1 — the logged-invariant contract (package ③, row row-lc-ledger)

[attempt: d2371308-6fa9-4b7d-b88f-42c655337599 row-lc-ledger]

Issue set: #194 (dsh-adoption ① — model-visible-means-logged as a dispatch-seam invariant + the
durable no-step turn) · #205 (the decision lane round-trips but never ledgers). Base: this
worktree at HEAD `5ae2c7e5` — `coordinator.mjs`, `coordination-store.mjs`, and `limits.mjs` are
byte-identical to the foundry base `09200e9` (verified: `git diff --stat 09200e9 HEAD -- impl/src`
touches only `application.mjs`/`recipes.mjs`/`wave-driver.mjs`/`workflow-interpreter.mjs`);
every `application.mjs` anchor below was re-read at HEAD numbers, not inherited. Ring-2 form:
ground truths → decisions → refusal vocabulary → red-first acceptance pins → open questions.
Every anchor was re-verified this session with `grep -an`/`sed -n` (NUL discipline on
`application.mjs`/`coordination-store.mjs`; plain grep elsewhere). No clocks anywhere.
Sorted-key literals in ACTUAL order.

**Headline:** Baton runs on two ledgers with one law claimed of neither. The per-worker
operational log (`log.mjs` — "The ONLY source of truth", `log.mjs:5`) records most of what the
model is served, but INLINE and uncapped; the coordination store — the ledger the #194 invariant
names — receives served-context records only as unadmitted inline bodies (the `_deliver` alias),
best-effort swallows (three verbatim try/catch sites), or content-opaque digest pointers
(`evidence.mapped`). The decision lane (#205) reaches the store as a task-state transition and a
digest: zero `decision.*` kinds exist (verified: `grep -an "_append('decision" coordination-store.mjs`
→ no matches), the answer never enters the store in any form, and two settlement paths (the
stale-fence discard and the no-live-worker shortcut) record NOTHING on either ledger — an
answered decision can reappear as pending after restart, which is precisely the lane-proof wave's
"answered DECISION_REQUEST left no record." And the durable no-step turn (#194's second half) is
inverted at HEAD: the deliberate no-op (`waitTurn`) logs (`turn.wait_noted`,
`coordinator.mjs:2551-2560`) while the REFUSED act (a rejected nudge/delivery) logs nothing.

## 1. Ground truths (each verified at HEAD this session)

### The two-ledger frame (#194's substrate)

- **GT-D1 — two ledgers, one seam.** The operational log: one append-only JSONL file per worker,
  durable on disk, seq-stamped (`log.mjs:1-3`, "The ONLY source of truth"). The coordination store: the append-only event
  ledger with idempotency keys and validated kinds (`coordination-store.mjs:1490-1527`). The
  dispatch seam writes both opportunistically; nothing binds them. `mapOperationalEvent`
  (`coordination-store.mjs:12757-12773`) is the only bridge, and its store payload is
  `{digest, kind, ts, worker, workerSeq}` — content-opaque by design, and it requires a live
  `_operationalRead` resolver or refuses `evidence_resolver_required` — a bare store replay
  cannot follow the pointer.
- **GT-D2 — the logged brief is not the served brief.** `lifecycle.spawned` records
  `payload: {taskId, brief: task.brief, …}` (`coordinator.mjs:3711-3730`), but the adapter is
  served `providerBrief = this._providerBrief(task.brief, workerId)` (`coordinator.mjs:3540`,
  dispatched at `:3744`). `_providerBrief` (`coordinator.mjs:3814-3880`) MATERIALIZES context-pack
  bodies into the brief (`:3826-3844`), injects the orientation L0 grant (`:3851`), and attaches
  the per-worker `attention` push (`:3858+`). No record anywhere binds the served composition:
  the model-visible bytes (which pack bodies, which attention items, which orientation map)
  differ from `task.brief`, and the difference is derivable only by re-running the projection.
- **GT-D3 — the spawn brief rides the operational log inline and uncapped.** No limits-lane
  governs the `lifecycle.spawned` brief body; a 64 KiB by-reference objective renders verbatim
  into it (`renderObjective` at `workflow-interpreter.mjs:336`, the 64 KiB bound `:42`, enforced
  `:343-344` — HEAD numbers; `workflow-interpreter.mjs` moved since the foundry base). The store's own `task.created` carries topology only — `{id, runId, relation, …}`
  (`coordination-store.mjs:_validateTaskTopology`, no objective/brief field) — so the store never
  sees the member's brief in any form, inline or cited.
- **GT-D4 — the `_deliver` alias lane writes bodies INLINE into the store, unadmitted and
  best-effort.** On delivery success the seam appends `control.send`/`control.nudge`/
  `control.steer` with `payload: {message}` — full body inline (`coordinator.mjs:7748-7756`) —
  and then records `message.sent` with `body: typeof message === 'string' ? message :
  JSON.stringify(message)` — FULL body inline into the coordination store
  (`coordinator.mjs:7766-7777`). `recordMessage` (`coordination-store.mjs:13789-13801`) performs
  NO size admission of any kind: the 2048-byte `message.send.body` lane (`limits.mjs:54`) is
  enforced only at `coordinator.sendMessage` (`coordinator.mjs:7177-7200`); the `_deliver` alias
  bypasses it, so a >2048-byte turn-mode prompt rides the durable store inline, outside every
  declared lane. And the store write is swallowed on failure: `catch { /* the lane audit is
  best-effort; delivery already succeeded */ }` (`coordinator.mjs:7776`) — the store's record of a
  served turn can be silently ABSENT.
- **GT-D4b — the best-effort swallow is a class, not a spot.** The same shape appears at
  `message.sent` in `sendMessage` (`coordinator.mjs:7245-7257`, `catch { /* audit is best-effort
  */ }`), at `message.delivered` (`:7290-7297`), and at the wave-lane `wave.settled` mint
  (`application.mjs:11694-11709`, `catch { /* the settle record is best-effort; the wave's member
  truth is already durable */ }` at `:11708`). Four verbatim swallow sites guard four ledger
  records this package's contracts treat as load-bearing.
- **GT-D5 — the graceful exemplar exists and is proven; the invariant is achievable with shipped
  primitives.** `sendMessage` admits oversize to the 1 MiB `spill.body` ceiling
  (`limits.mjs:86`) with a durable spill (`coordinator.mjs:7188-7200`), serves the worker a
  bounded head + `[SPILLED {citation}]` frame (`:7272-7276`), and receipts delivery
  (`message.delivered` with head+digest+spill, `:7278-7297`). `run.objective` is the same shape
  (`application.mjs:4519-4541`). The spill substrate is content-addressed (`spill:sha256:<digest>`,
  `coordination-store.mjs:13539-13566`) and materializable (`materializeSpill`,
  `:13567-13571`). Nothing new must be invented for #194 — the seam must be made to use what the
  frame-economics registry already declares.

### The durable no-step turn (#194's second half)

- **GT-D6 — refused dispatch attempts leave no record (five unlogged refusal classes + one
  conditional).** In `_deliver` (`coordinator.mjs:7610-7780`): `goal_plan_continuation_not_authorized`
  (`:7621-7623`), `run_sealed` (throws, `:7624-7630`), `worker_stopping` (`:7643`),
  `worker_not_active` (`:7660-7664`), and `task_terminal` (`:7665`) all return/throw with ZERO
  events on either ledger; the adapter-refused case logs `control.delivery_refused` ONLY when
  `opts.controlId` exists (`:7737-7744`) — a controlId-less refused delivery is invisible. In
  `nudgeTurn` (`coordinator.mjs:2456-2538`): `provider_turn_refused` / `delivery_exception` /
  `delivery_refused` roll back and return (`:2473-2496`) with no event whenever governance is
  absent — `_admitProviderTurn` returns `{ok: true}` SILENTLY when `!this._providerGovernance`
  (`coordinator.mjs:3412-3413`), and `_releaseProviderTurnAdmission` logs only when a governed
  `providerTurn` exists (`:3499-3506`). Contrast: `waitTurn` — the deliberate NO-OP — mints
  `turn.wait_noted` durably (`:2551-2560`). The non-act is recorded; the refused act is not.
- **GT-D7 — a served nudge is unreconstructable from both ledgers.** `nudgeTurn` succeeds and
  records `turn.settled` with `payload: {actor, basis: 'nudge', pauseId}` (`coordinator.mjs:2505-2509`)
  plus `lifecycle.turn_started` with `payload: {nudged: true, pauseId, controlId}` (`:2523-2528`).
  The message bytes the model was served — `request.inputs.message ?? DEFAULT_TURN_NUDGE_MESSAGE`
  (`application.mjs:12463-12478`; the default is `'Continue the current turn.'`, `:61`) — appear
  in NEITHER record, neither ledger. The single most common steering act on the wave surface has
  no served-context record at all.

### The decision lane (#205)

- **GT-D8 — zero `decision.*` kinds in the coordination store.** Verified by grep: no
  `_append('decision…')` call exists in `coordination-store.mjs`; the only `decision.` strings in
  the store are the FRAME_LIMITS lane lookups (`:3557-3566`, the reuse-decision caps). The wave
  lane shows the available precedent: `recordDriver(kind, …)` wraps any driver kind into a
  `driver.recorded` event (`coordination-store.mjs:13240-13246`), and the application uses it for
  `steering.registered` / `wave.started` / `wave.settled` (`application.mjs:138-145`, `:4661`,
  `:4682`, `:11694-11709`). The decision lane calls NO store recorder on any path.
- **GT-D9 — the round-trip's content is operational-only.** Request side: `decision.requested`
  carries `{requestId, request}` (question, options, deadline, recommendation) into the
  per-worker operational log (`coordinator.mjs:13389`) and an in-memory `_pending` record
  (`:13378-13392`); the store receives ONLY a `task.input_required` transition whose payload is
  `{…evidence, interaction: {blocking: true, kind: 'decision', requestId}}` (`:13395`) — where
  `evidence` is the digest-only `mapOperationalEvent` pointer (GT-D1). Answer side:
  `decision.settled` carries `{requestId, answer, disposition: 'delivered'}` operational-only
  (`coordinator.mjs:10403-10405`); the store receives only a `task.working` transition with
  `interaction: {disposition: 'delivered', requestId}` (`:10416-10418`). The ANSWER — which
  option the orchestrator chose, or what free text it sent — never enters the coordination store
  in any form: not inline, not digested, not spilled. `decisionSettledProjection`
  (`coordinator.mjs:12132-12150`) reads `this._log.read(workerId)` — the operational log — and
  projects `{requestId, disposition, at, seq}` only.
- **GT-D10 — two settlement paths record NOTHING, and replay resurrects the pending record.**
  The stale-fence discard (`coordinator.mjs:10347-10355`) and the no-live-worker shortcut
  (`:10356-10366`, returns `{ok: true, result: 'applied'}` with `record.resolution` set in
  memory) append no event to either ledger. But `_pending` is "reconstructed purely from the
  durable log" on restart (`coordinator.mjs:13900-13906`): the ask (`decision.requested`) is
  durable, the settlement is not — so after a restart the answered decision REAPPEARS AS PENDING
  and `respond()` will accept a second answer for it. This is the lane-proof wave's incident in
  mechanism form: the round-trip succeeded, the caller got `ok`, and the ledger holds no record
  that it ever happened.
- **GT-D11 — the refusal asymmetry.** The decision lane's FAILURE paths ledger more than its
  success path: malformed requests mint `control.malformed_interaction_rejected` operational +
  `authority.rejected {kind: 'decision', reason, evidence}` in the store
  (`coordinator.mjs:13303-13325`); duplicates (`:13337-13343`), drain discards (`:13326-13335`),
  and one-pending-violations (`:13346-13368`) the same. A store-only reader can learn that a
  decision was REFUSED but never what was ASKED or ANSWERED.

### Boundary truths (inherited seams this row must not contradict)

- **GT-D12 — the sibling contracts' seams.** The launch row owns receipt SHAPES — its OQ-L2
  names this row as the owner of spill-artifact RECONSTRUCTABILITY ("one shape, both seams"); its
  GT-L8/PIN-L2 `startError` truth is the launch-receipt half of the same causes this row's
  no-step records must carry (same `error.code` on both seams). The fs row's D4 mints a
  `member_fs_escape` store event in this row's ledger lane (contract-qa fold check F-B1) — this
  row acknowledges it and imposes the vocabulary discipline below on it. The members row's
  #199 typed creation events share the store's event table; the fold must keep kinds disjoint.

## 2. Decisions (judgment calls recorded; options where the call is arguable)

- **D1 — model-visible-means-logged is a STORE-side invariant at the dispatch seam.** Every seam
  that serves the provider bytes — the spawn brief (post-`_providerBrief`), a turn/nudge/steer
  message, a materialized attention push — must leave exactly one durable coordination-store
  record that either carries the served bytes within a declared cap or cites `{digest, spill}` for
  them, and that binds the SERVED composition (GT-D2), not the pre-transformation brief. Options:
  (a) store-side record (CHOSEN — #194 names the coordination store; the operational log is the
  worker lane and its retention is not the store's contract); (b) operational-log-only with a
  stronger `evidence.mapped` (rejected: digest-only + resolver-bound, GT-D1); (c) a new
  combined ledger (rejected: two ledgers already exist; a third multiplies the seam).
- **D2 — the alias lane inherits the sendMessage admission.** `_deliver`'s `message.sent` goes
  through the SAME admission as `coordinator.sendMessage`: ≤2048 bytes inline, above that a
  durable spill with head + `[SPILLED {citation}]` in the record, hard refusal only past the
  `spill.body` ceiling. The operational log's `control.send` family keeps the full message (it is
  the worker's own lane and the replay substrate) — the STORE record is the capped/cited one.
  Options: (a) reuse the exact sendMessage machinery (CHOSEN — GT-D5; one admission per economy);
  (b) a new `turn.body` limits row (rejected unless the fold wants the lane named separately —
  `message.send.body` already names the lane family).
- **D3 — best-effort ends for served-context and settlement records.** At the four GT-D4b sites
  the catch-and-continue is replaced by fail-closed ledgering: the record is minted BEFORE the
  provider effect where the effect is dispatch (the two-phase `control.delivery_requested` →
  `control.send` shape already exists, `coordinator.mjs:7694-7701`/`7748-7756`), and a mint
  failure refuses with the new typed `dispatch_ledger_unavailable` (vocabulary §3) rather than
  dispatching unrecorded. For post-effect settlements (`wave.settled`, `message.delivered`) a
  failed mint POISONS (the `coordination_write_unavailable` machinery already exists,
  `coordinator.mjs:_poisonCoordination`) instead of swallowing. Options: (a) pre-effect mint +
  post-effect confirm (CHOSEN); (b) keep post-effect-only but poison on failure (weaker: a crash
  between effect and mint still loses the record); (c) leave best-effort (REJECTED — it is the
  #194 gap in its purest form).
- **D4 — the no-step turn is recorded, typed, and unconditional on controlId.** Every refusal at
  the dispatch seam (`_deliver`'s five unlogged classes + ack-refused; `nudgeTurn`'s three) mints
  a durable refusal record — operational `control.delivery_refused` generalized to carry
  `{mode, reason, message-digest-or-citation, controlId: null}` — and a store-side no-step record
  for steering-class acts (nudge/steer), keyed like the act that was refused. The record carries
  the refused message by digest/citation (D2's shape), so even a refused act's would-be-served
  context is reconstructable. `waitTurn`'s `turn.wait_noted` stands unchanged (surface-constant).
- **D5 — the decision lane ledgers both halves.** Two store event kinds, `decision.requested` and
  `decision.settled`, each a validated closed payload (the store validates — this is NOT a bare
  `driver.recorded` passthrough): requested carries `{runId, taskId, workerId, requestId,
  question: head+citation when spilled (the `decision.question` lane already exists,
  `limits.mjs:59`), options, recommended, deadlineAt, actor}`; settled carries `{requestId,
  answer: {optionId} | {text: head+citation} | null, disposition, actor}`. The two invisible
  settlements (GT-D10) mint `decision.settled` with dispositions `stale_discarded` and
  `applied_no_worker` BEFORE returning, so replay reconstructs the resolution and a second answer
  draws the existing stale-fence refusal rather than silently succeeding twice. Options: (a)
  dedicated validated kinds (CHOSEN — GT-D8 shows the store validates its kinds; the decision
  lane is coordination state, not driver narration); (b) `driver.recorded` envelope kinds
  (rejected: no validation, and the driver envelope is for driver-authored narration — the
  decision lane is worker↔orchestrator coordination); (c) extend `task.input_required`/`task.working`
  payloads (rejected: state-transition payloads are evidence, not content homes; the transition
  stays, the content moves).
- **D6 — reconstructability is resolver-free.** Whatever the store cites must be materializable
  from the store alone (`materializeSpill`, `contextPack`/`materializeContextPack`,
  `grantContextPack` receipts) — the GT-D1 `evidence.mapped` digest pointer may ride ALONGSIDE
  but never as the only path to served content. A bare store replay (no `_operationalRead`) is
  the acceptance reader for every pin in §4.

## 3. Refusal vocabulary (closed, typed, surface-constant)

Existing codes this contract depends on, unchanged (each verified at HEAD):

| Code | Minted at | Anchor |
|---|---|---|
| `spill_body_exceeded` | the only hard refusal on the graceful byte lanes | `limits.mjs:54/56/86`, `coordinator.mjs:7188`, `application.mjs:4526` |
| `message_lane_invalid` / `message_lane_conflict` | `recordMessage` kind/idempotency guards | `coordination-store.mjs:13791-13797` |
| `evidence_resolver_required` / `evidence_mismatch` | the operational→store digest bridge | `coordination-store.mjs:12757-12773` |
| `decision_question_exceeded` / `decision_option_label_exceeded` / `decision_option_summary_exceeded` / `decision_text_exceeded` | the decision lane's admission caps (messages.mjs → createDecisionRequest/Answer) | `limits.mjs:59/68/69/70`, `messages.mjs:216-219` |
| `coordination_write_unavailable` | the poison path when an authoritative coordination mutation fails | `coordinator.mjs:_poisonCoordination` |
| `authority.rejected` (store kind) with `kind: 'decision'` | malformed/duplicate/drain decision-request refusals | `coordinator.mjs:13303-13368` |
| result-code family `worker_not_active` / `task_terminal` / `worker_stopping` / `delivery_refused` / `stale_fence` / `semantic_target_drift` | the dispatch seam's act results (these remain RESULT codes; §D4 adds records, not new result codes) | `coordinator.mjs:7621-7665`, `:7745-7746` |

NEW codes this contract adds (closed set of three; surface-constant across embedded/MCP/CLI —
the MCP stateFailureCode allowlist must admit all three):

| Code | Meaning | Refusal shape |
|---|---|---|
| `dispatch_ledger_unavailable` | the served-context/no-step ledger mint failed at the dispatch seam, BEFORE the provider effect | `{seam: 'spawn'\|'deliver'\|'nudge', reason}` — fail-closed per D3 |
| `decision_record_invalid` | a `decision.requested`/`decision.settled` payload failed the store's closed-shape validation | `{field}` — mirrors `message_lane_invalid`'s discipline |
| `decision_ledger_conflict` | idempotency-key conflict on a `decision.*` record (same key, different content) | `{requestId}` — mirrors `message_lane_conflict` |

No prose-string refusals; no numeric-limit refusals beyond the registry's declared lanes; no
clocks. The fs row's `member_fs_escape` store event (GT-D12) joins this ledger's event table at
fold; this row's vocabulary discipline (typed, payload-keyed, closed) applies to it unchanged —
cited, not re-owned.

## 4. Red-first acceptance pins

Each pin names its stage (where the pin test hooks), is RED at HEAD `5ae2c7e5`, and greens ONLY
for a correct impl (a shallow greening is itself a defect — the QA's fold instruction 3). The
acceptance reader for every reconstructability assertion is a BARE STORE REPLAY (D6): the
coordination store reloaded from its ledger with no `_operationalRead` resolver wired.

- **PIN-D1 — the served brief is reconstructable, and it is the SERVED one.**
  Stage: spawn dispatch (`coordinator.mjs:3711-3744`, the `lifecycle.spawned` → `adapter.spawn`
  span). RED at HEAD (GT-D2/D3): no store record of the member's brief exists in any form —
  `task.created` carries topology only; the store-first reader cannot even learn the objective.
  Green: a spawn with (a) a cited context pack, (b) a pending attention item, and (c) a 64 KiB
  rendered objective leaves exactly one store record whose digest EQUALS the digest of the
  `providerBrief` actually handed to the adapter (asserted against a captured adapter input),
  with every materialized component resolvable store-side (pack via `materializeContextPack`,
  objective via `materializeSpill`, attention items via their own receipts). Shallow-green trap:
  recording `task.brief` (the pre-transformation brief) instead of the served composition fails —
  the pin asserts digest equality with the ADAPTER'S input, not with `task.brief`.
- **PIN-D2 — the alias lane cannot smuggle an unadmitted body into the store.**
  Stage: `_deliver` success path (`coordinator.mjs:7748-7777`). RED at HEAD (GT-D4): a 3 KiB
  turn-mode message through the alias lands in `message.sent` as a full inline body — no lane
  admits it (`recordMessage` has no admission, `coordination-store.mjs:13789-13801`). Green: the
  store record carries head + `[SPILLED {citation}]`, the spill is materializable, and the
  record's inline bytes are ≤ the `message.send.body` cap; the operational log retains the full
  body. Shallow-green trap: greening by REFUSING >2048-byte deliveries at the seam (a wall in
  front of a spill lane — the law verbatim at `application.mjs:12082-12084`, HEAD-anchored) fails;
  the pin asserts ADMIT-with-spill.
- **PIN-D3 — no served turn without its ledger record (best-effort ends).**
  Stage: the four swallow sites (GT-D4b: `coordinator.mjs:7776`, `:7256`, `:7297`,
  `application.mjs:11708`). RED at HEAD: fault-inject a store failure at `recordMessage` and
  drive a delivery — it returns `ok` and no record exists anywhere. Green: the pre-effect mint
  failure surfaces the typed `dispatch_ledger_unavailable` refusal (no dispatch); a post-effect
  settlement failure poisons (`coordination_write_unavailable`) rather than returning ok.
  Shallow-green trap: converting the catch to a rethrow but keeping the mint AFTER the provider
  effect fails the crash-window clause — the pin drives a crash between effect and confirm and
  asserts the pre-effect record already reconstructs the served bytes.
- **PIN-D4 — the refused act is recorded; the record does not need a controlId.**
  Stage: `_deliver` refusal arms (`coordinator.mjs:7618-7665`, `:7737-7744`) and `nudgeTurn`
  refusals (`:2473-2496`). RED at HEAD (GT-D6): (a) `nudgeTurn` against a task whose worker died
  returns `provider_turn_refused`/`delivery_refused` with zero events on either ledger; (b) an
  adapter-refused delivery with no `controlId` logs nothing. Green: each refusal mints the
  durable refusal record (operational `control.delivery_refused` generalized + the store-side
  no-step record for steering-class acts), carrying the refused message by digest/citation and
  the typed reason. `waitTurn`'s `turn.wait_noted` shape is asserted UNCHANGED
  (surface-constant). Shallow-green trap: logging only when `controlId` exists (HEAD's shape)
  fails clause (b); logging a generic `delivery_refused` string without the message citation
  fails the reconstructability clause.
- **PIN-D5 — a served nudge is reconstructable from the store.**
  Stage: `nudgeTurn` success (`coordinator.mjs:2505-2528`) × the act input
  (`application.mjs:12463-12478`). RED at HEAD (GT-D7): drive `nudge_turn` with
  `inputs.message = 'resume the fold, row 2'`; the message appears in neither ledger — `turn.settled`
  and `lifecycle.turn_started` carry `{actor, basis, pauseId}` / `{nudged, pauseId, controlId}`
  only. Green: the store's served-context record for the nudge reconstructs the exact message
  (inline-within-cap or spill-cited, D2's shape), and the DEFAULT message
  (`'Continue the current turn.'`) is recorded identically when no input is given.
  Shallow-green trap: recording only non-default messages (eliding the default) fails the second
  clause.
- **PIN-D6 — the decision round-trip ledgers both halves, resolver-free.**
  Stage: the decision lane's request and settle arms (`coordinator.mjs:13297-13401`,
  `:10403-10418`) × store validation. RED at HEAD (GT-D8/D9): after a worker raises a
  DECISION_REQUEST and the orchestrator answers via `run.answer`, a bare store replay finds ZERO
  `decision.*` events — the question, options, and answer are absent from the store entirely.
  Green: `decision.requested` (question/options/deadline/actor, head+citation when oversize) and
  `decision.settled` (answer, disposition, actor) exist as validated store events, and the bare
  replay reconstructs BOTH the question asked and the answer given without any operational
  resolver. The existing `task.input_required`/`task.working` transitions and their
  `interaction` payloads remain unchanged (surface-constant). Shallow-green trap: minting
  `driver.recorded {kind: 'decision…'}` without store validation fails the closed-shape clause
  (D5a vs D5b was decided on exactly this); recording the answer as a digest-only pointer fails
  the resolver-free clause.
- **PIN-D7 — an invisible settlement stays settled after restart.**
  Stage: `_resolveRecord`'s discard and no-handle arms (`coordinator.mjs:10347-10366`) × replay
  (`:13900-13906`). RED at HEAD (GT-D10): (a) answer a decision whose worker handle is gone —
  returns `ok/applied`, nothing recorded; (b) answer a stale-fenced decision — discarded,
  nothing recorded; in both cases, a coordinator restart (replay from the operational log)
  reconstructs the decision as PENDING and accepts a second answer. Green: both arms mint
  `decision.settled` (dispositions `applied_no_worker` / `stale_discarded`) before returning, and
  the post-restart replay shows the decision RESOLVED, refusing a second answer with the
  stale-fence path. Shallow-green trap: minting an event that lacks `requestId`/`disposition`
  fails the replay assertion — reconstruction is keyed on exactly those fields.
- **PIN-D8 — the refusal asymmetry closes without regressing the refusals.**
  Stage: the decision lane's refusal arms (`coordinator.mjs:13303-13368`). RED at HEAD (GT-D11)
  in the contract's sense: a malformed decision request leaves MORE store truth (the typed
  `authority.rejected` with `kind: 'decision'`, reason, and evidence) than a fully successful
  round-trip (which leaves none). Green: the successful round-trip satisfies PIN-D6 AND every
  existing `authority.rejected` shape (kind, reason, evidence digest, idempotency key grammar)
  is byte-unchanged. Shallow-green trap: "closing the asymmetry" by weakening the refusal
  records to match the (pre-pin) silence of the success path fails — the pin asserts BOTH
  clauses.

## 5. Open questions

- **OQ-D1 (naming authority):** the served-context record's kind grammar — one kind
  (`context.served` with a `seam` field) vs per-seam kinds (`brief.served`, `turn.served`).
  Recommended: one kind + `seam` (the fs row's event-table growth concern, GT-D12). DECISION_REQUEST
  to the fold if the registry owners prefer per-seam kinds.
- **OQ-D2 (two-phase shape):** D3's pre-effect mint + post-effect confirm introduces a
  transient `served {confirmed: false}` state a reader can observe. Acceptable (the
  `control.delivery_requested` → `control.send` pair already has this shape operationally) or
  must the store record be single-shot? No pin depends on the answer; the fold decides.
- **OQ-D3 (operational-log retention):** this row could not fully verify this session whether
  the per-worker operational JSONL survives worker reap/cleanup (the reap paths remove
  worktrees/runtimes; `log.mjs`'s directory ownership vs the reap sweep was not traced
  end-to-end). If logs are reaped, the operational lane is NOT a durable archive and D1's
  store-side ruling is the only survivable one — which is why D1 chose the store. The fold
  should pin retention explicitly (a natural fs-row × ledger-row joint pin).
- **OQ-D4 (boundary with launch, inherited):** launch's OQ-L2 — receipt SHAPE (launch) vs
  reconstructability (ledger) must stay one shape at both seams. The `wave.settled` best-effort
  catch (GT-D4b, `application.mjs:11708`) sits on launch's PIN-L3 surface; if the launch fold
  lands a different settlement-read shape than D3's poison ruling, this row's PIN-D3 clause for
  that site follows the launch ruling (it is their seam; this row owns only the no-silent-swallow
  law).
- **OQ-D5 (boundary with members):** the members row's #199 typed creation events join the same
  store event table; kind-disjointness (`decision.*` here vs their `task.*`/creation kinds) must
  be checked at fold. No conflict identified in either contract's vocabulary as written.
- **OQ-D6 (decision.question spill):** the `decision.question` lane (`limits.mjs:59`) is declared
  HARD (`graceful: null`) — D5's "head+citation when spilled" for the REQUESTED record assumes
  the lane stays hard at admission (oversize refuses `decision_question_exceeded`) and therefore
  never needs a spill. If a later economy makes the lane graceful, the record shape already
  accommodates the citation. Recorded, no action.

## 6. Judgment calls recorded this session (the foundry's law)

1. **Deliverable-path discrepancy (resolved in favor of the twice-named path).** The Baton task
   and the row brief (`redrive4/row-lc-ledger.md:10`) BOTH name
   `redrive3/contract-ledger.md` as the deliverable — and `redrive3/` holds the sibling
   contracts (fs, launch, members) plus the QA seat, missing only this file. The task's
   boilerplate constraint line ("Work only within: …/redrive4/**") contradicts both. Ruling: the
   twice-named path wins; this file completes the redrive3 package the QA seat is auditing.
   Recorded here for the fold; no other redrive4 writes were made.
2. **Anchor base honesty.** The sibling contracts pin "RED at HEAD `09200e9`"; this worktree's
   HEAD is `5ae2c7e5` (docs-only + four impl files changed since). All pins here were re-verified
   at `5ae2c7e5`; the three files this row cites most (`coordinator.mjs`,
   `coordination-store.mjs`, `limits.mjs`) are byte-identical across both bases (verified by
   `git diff`), so the siblings' anchors in those files remain exact. `application.mjs` anchors
   are HEAD numbers (the `wave.settled` mint moved `11652` → `11694-11709`).
3. **#194's "exact served context" scoped to the coordination store per the row brief** (D1) —
   the operational log remains the worker lane and keeps its inline full bodies (D2). This is the
   brief's own reading ("reconstructable from the coordination store… never bodies-inline"),
   not a discretionary narrowing.

## 7. Publish to `shared` — the refusal, recorded (#158 law)

Instructed to publish to `shared` on completion. The publish path does not exist for a member
row and refuses with NO typed code — re-verified at HEAD this session:
`writeScratchpad` hardcodes the write scope `worker:${fields.workerId}`
(`coordination-store.mjs:14169`, entry `:14130`); the shared-scope settlement lane is
orchestrator-actor-only (`createAndClaimSettlementTask` refuses `auth?.actor !== 'orchestrator'`,
`:12557-12562`). There is no refusal string to quote because the refusal is a silent admission
into the worker partition. This contract is therefore published ON DISK (here) and the
shared-lane refusal is recorded verbatim above for the fold to carry; fabricating a shared-scope
publish was not an option.

## 8. Cross-contract boundary notes (for the coordinator's coherence check)

- launch row owns receipt SHAPES (#202 family, `startError` on the wire); this row owns
  reconstructability of what was served. PIN-D2/D5's citation shape and launch's PIN-L5
  admit-with-spill behavior must compose (one spill economy, both seams) — launch's OQ-L2
  anticipated exactly this handoff.
- members row owns creation-failure events (#199) and drain-restart (#204); PIN-D7's replay
  clause and their drain semantics share the replay substrate — a fold-level joint check that
  drain-era settlements (their lane) and decision settlements (this lane) reconstruct under the
  same replay pass.
- fs row owns base-commit capture/index.lock/confinement; the acknowledged seam is their D4
  `member_fs_escape` store event (GT-D12, §3's closing discipline note) and OQ-D3's
  operational-log retention question (a natural joint pin with their settle-sweep).
