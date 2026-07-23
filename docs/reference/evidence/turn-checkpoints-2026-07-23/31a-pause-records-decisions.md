# 31-a decisions contract — card declaration, pause records, `paused` lifecycle parity, steering registration at run creation, degenerate auto-settle (issue #31)

Ground truth: docs/35-turn-checkpoints.md v2 (docs/35 §2.1, §2.2 rules 4-5), settled and
**not re-litigated here**. 31-a's own scope, per docs/35 §4: "card declaration + default, pause
record + `paused` state lifecycle (TRANSITIONS/guards/unpark/projections), steering registration
at run creation, degenerate auto-settle with receipts. **The backward-compat spine; the suite
must stay green unchanged.**" Steering acts (nudge/wait/claim), claim invalidation, attention
classification, and stall-guard parity are 31-b. Claim-time effect evaluation, the visible-only
escalation bound, and the stall-watchdog silence/progress split are 31-c. This contract fixes
shapes, payloads, insertion points, and replay semantics for 31-a only; every file:line below was
read and verified against the current tree (not the design doc's own approximate line numbers,
which predate several unrelated commits — see the note on TRANSITIONS in Part C).

Code this contract is grounded in and will touch:

- the absent `card().turnCompletion` declaration on the five production adapter surfaces and its
  silent default for every other card — MockAdapter (adapter.mjs:207-227, no field today;
  `lifecycle.turn_completed` emission at :539 driven by `scenario.outcome`), `ClaudeSessionCli`
  (claude-session.mjs:404-469, `verbs` block at :454-463), inherited unmodified by `GlmSessionCli`
  (:1223-1275, its `card()` at :1255-1274 spreads `...base`) and `KimiSessionCli` (:1281-1353,
  same spread at :1338-1354) — so ONE declaration site covers three of the five harness
  identities; `CodexAppServerCli` (codex-appserver.mjs:266-324, `verbs` at :313-322);
  `GrokAcpCli` (grok-acp.mjs:187-248, `verbs` at :237-246); `KimiAcpCli` (kimi-acp.mjs:131-186,
  `verbs` at :181-184). These four explicit sites cover the exact five `harness` identities wired
  in `DEFAULT_ROUTES` (application-deployment.mjs:77-90: `codex`, `kimi-code`, `grok`,
  `claude-code`, `glm`) and dispatched in `builtInAdapters` (:657-711, the `if (route.harness ===
  ...)` ladder that instantiates `CodexAppServerCli`/`GrokAcpCli`/`KimiAcpCli`/`ClaudeSessionCli`/
  `GlmSessionCli` one per harness key). `KimiSessionCli` (the `claude-code`+`kimi`-provider
  alternate route, :693-696) is a sixth wired class but inherits the same base declaration — no
  separate edit;
- the interaction-family precedent a pause record must structurally mirror: `question.asked`/
  `approval.requested`/`decision.requested` admission (coordinator.mjs:9996-10150) — an
  `appendAttributed` durable per-worker log entry, an in-memory `record = {kind, worker,
  state:'pending', resolution:null, consumer:null, ...}` keyed into `this._pending`
  (`_activeInteractionIds` tracks liveness), a blocking admission additionally driving
  `_coordTransition(task, 'input_required', ...)`; single-consumer resolution via
  `_resolveInteractionAuthority(requestId, record)` (:1841-1844, sets `state:'resolved'`, deletes
  from `_activeInteractionIds` — callers additionally stamp `record.consumer`); startup replay
  reconstruction of exactly this pending-record shape (`reconstructedPending`, :11441-11451);
- the `lifecycle.turn_completed` handler (coordinator.mjs:9891-9941) — the exact insertion point:
  after the `wr?.status !== 'completed'` failure branch (:9912-9915) and the existing
  `parkedUnsettled` deferral for a still-pending blocking interaction (:9926-9931), immediately
  before the `_runTrustGate` dispatch (:9932-9939, gated on `this._drainState === 'open' &&
  handle.status !== 'stopping' && handle.status !== 'dead'`);
- the durable task-state machine: `TRANSITIONS`/`TERMINAL` (coordination-store.mjs:120-125 —
  **current lines; docs/35 §2.1(3) cites :115-120, five lines stale from unrelated REPL-2/KG-1
  `PROJECTION_CHECKPOINT_FIELDS` growth, :113-117**), `transitionTask` (:11772-11782, the single
  generic `'task.transitioned'` event kind for every task-status change, gated by
  `TRANSITIONS.get(task.status)?.has(to)`), and its fold (`_apply`'s generic
  `else if (event.kind === 'task.transitioned')` branch, :7631-7637, `status: p.to` — no
  per-target-state fold code exists or is needed);
- every guard keyed on `['working', 'input_required']`, verified exact:
  `claimScratch` (coordinator.mjs:9122), `postScratchFact` (:9139), `requestBoardClaim` (:9199),
  `submitBoardReport` (:9209), `admitReplManifest` (:9223), the startup sweep
  `_terminalizeUnattachedCoordinationTasks` (:11467-11489, guard at :11473), and the
  representation-admission gate (coordination-store.mjs:2878-2879, `requireLive &&
  !['working','input_required'].includes(task.status)`);
- the respond()-unpark parity precedent: `clearPending` (coordinator.mjs:8377-8386, the
  question/approval durable-plus-in-memory pair — `_coordTransition(..., 'working', ...)` is
  driven from the caller, `clearPending`'s own `handle.status==='blocked'` branch at :8381-8385
  sets `task.status = 'working'` in memory); the stale-interaction unpark (:8401-8407); the
  question/approval `respond()` unpark (:8462-8467); the decision `respond()` unpark
  (:8585-8594, with the DG2 in-memory-parity fix at :8594 explicit because the decision resolver
  does not route through `clearPending`); `_coordTransition` itself (:6821-6834 — updates
  `task.coordinationVersion` only; callers own the in-memory `task.status` write, which is why
  three separate call sites each carry their own explicit assignment);
- `_deriveWorkerStatus` (coordinator.mjs:11454-11465) — an **undocumented-by-docs/35, independently
  found** projection gap: its `default: return 'working'` branch silently renders any task status
  outside `{completed, failed, cancelled, input_required}` as `'working'`, which would misrender
  `paused` exactly the way §2.1(3) forbids;
- run-creation and the wave admission seam: `createWave` (wave.mjs:118-157, the
  `baton.runs.start(member.objective, {...route, scope:[...member.scope]})` call at :151);
  `BatonClient.waves` (application-client.mjs:1484-1486, `createWave(this, options)` — `this` is
  the `BatonClient`, carrying `.runs`); `BatonRuns.start` (:1292-1294) →
  `prepareRunStart` (:111-183, the **closed** `exactOptions` whitelist at :113-115 —
  `['runId','resultIntent','profile','scope','model','harness','effort','exact']`, no
  `driverKind` key today) → `application.command('run.start', {intent})`;
- the `recordDriver`/`driver.recorded` envelope (coordination-store.mjs:12306-12312, one generic
  event kind wrapping `{kind, ...payload}` for every `driver.*` marker) and its coordinator
  wrapper `_coordRecord` (coordinator.mjs:6857-6860); the exact precedent for reading a durable
  marker back by scanning `this._coordination.events()` for `event.kind === 'driver.recorded' &&
  event.payload?.kind === '<marker>'` (coordinator.mjs:3164-3168, the `plan.wave_cleanup_completed`
  tombstone lookup) — this is the mechanism the degenerate-case liveness check reuses;
- the stall watchdog's pre-existing, unmodified protection: `_armWatchdog`'s timer callback
  (coordinator.mjs:7401-7418) re-checks `task.status !== 'working'` at fire time (:7408) —
  `paused` joins this guard **by construction** (a distinct status value fails the check) with
  **zero code change**, verified here, not asserted;
- honest projections named in scope: the run-phase ladder (application.mjs:4979-4995, plus the
  `ownedWorker`-conditioned branches at :4991-4995 this contract's `paused` branch must sit
  alongside); wave.mjs's `attentionFrom` (:78-88) and `progress()` (:159-179, `phase:
  outline.phase ?? null` — a pass-through, so the application.mjs fix alone repairs wave progress
  with no wave.mjs code change for `phase` at all; `attentionFrom` does eventually need a
  `'paused'` branch, but per the SHARED DECISION (see "v2 revisions") that edit is **31-b's**, not
  this contract's — 31-a touches no wave.mjs code); story.mjs's per-worker fold
  — the `WorkerStatus` typedef (:37), `LEGAL_TRANSITIONS[KIND.TURN_COMPLETED]` (:224, `{from:
  ['working'], to:'idle'}`) and its `applyEvent` case (:348-355, unconditionally parks the worker
  at `'idle'` on any `working`-status turn-completed — **never disguised as `working`, but
  disguised as done-and-idle**, equally dishonest for a paused turn), `NEVER_STALLED_STATUSES`
  (:113) and `ACTIVE_STATUSES` (:662);
- the diff-evidence primitive family: `_worktrees.changedPathsAtCommit(baseSha, resultSha,
  maxPaths)` (index.mjs:724-735, requires two full 40-hex commit SHAs, `git diff --name-only`)
  and `task.sessionContext?.baseSha` as the base (the same field the structured-review scope
  check reads, coordinator.mjs:3827-3828) — noted as a **gap, not reused verbatim**: no existing
  `_worktrees` accessor reads a worktree's current HEAD without a known result SHA (see Part B
  rule 3).

The v2 design is settled; this contract fixes the shapes and insertion points so 31-a ships
red-first and does not re-litigate docs/35.

## v2 revisions

Every numbered finding in docs/reference/evidence/turn-checkpoints-2026-07-23/31a-redteam.md is
resolved below with file:line evidence re-verified against the current tree; none are dropped.
SHARED DECISIONS pinned by the orchestrator (the `_pausedTurns` key space, story.mjs's
`'paused'` status winning with the fold-set fix, `attentionFrom`'s `'paused'` →
`'turn_checkpoint'` mapping living in 31-b not 31-a, and coordination-store.mjs:10630/:10637
being 31-a's edit that 31-b does not duplicate) are honored unmodified — this pass only grounds
them in verified evidence, it does not relitigate them.

- **P1-1 (BLOCKING — normalizeIntent strips driverKind).** Resolved: Part D rule 2 now names the
  required `normalizeIntent` whitelist edit (application.mjs:919-921, :933-941), mirroring the
  function's own existing `RESULT_INTENTS` validation shape (:100, :926); `driverKind` is
  explicitly excluded from `intentDigest`/runId derivation (:3703-3708, :3722-3729); the
  `existingRun !== null` reconcile case (:3731-3734) is specified — marker admission is gated on
  `existingRun === null` only.
- **P1-2 (story.mjs fold order — vacuous test).** Resolved: Part C rule 5's `TURN_PAUSED` rule is
  now `{from: ['working', 'idle'], to: 'paused'}` (verified against the real fold order:
  `lifecycle.turn_completed` always precedes `turn.paused` in the per-worker log, coordinator.mjs
  :9896 vs. the later mint in `_admitPauseRecord`); Part E's red test drives the real two-event
  sequence, not an isolated `TURN_PAUSED` event.
- **P1-3 (CI6 replay kills the paused task).** Resolved: new Part C rule 6 names CI6
  (coordinator.mjs:11251-11276) explicitly, chooses fail-closed parity with `input_required`
  (verified as `input_required`'s own existing, already-unmodified restart behavior — not a new
  degradation introduced here), and Part E's replay red test now asserts the post-restart task
  status and the disposition of the reconstructed `_pausedTurns` entry for the dead task.
- **P1-4 (31-a must not ship wave.mjs:151).** Resolved: Part D rule 2 no longer edits
  wave.mjs:151. That edit belongs to 31-b; this contract states the dependency instead of
  duplicating it, and ships the `runs.start`/`driverKind` plumbing with no caller, so the
  degenerate (no-driver) path is what the entire current suite continues to exercise.
- **P1-5 (changedPathsDigest throws when baseSha is absent).** Resolved: Part B rule 3 now guards
  on both `baseSha` and `headSha` being present before calling `changedPathsAtCommit`
  (index.mjs:724-728); either absent yields `canonicalDigest([])`, never a thrown
  `captured_change_invalid`.
- **P2-1 (single gated dispatch).** Resolved: Part B rule 1's mint-site snippet has
  `_admitPauseRecord` return a `settled` boolean; `if (!settled) break;` — the one pre-existing
  gate at coordinator.mjs:9932 runs exactly once either way, and Part D rule 4's "ran
  unconditionally" phrasing is corrected to name that gate.
- **P2-2 (name coordination-store.mjs:10630 and :10637).** Resolved: Part C rule 5 now cites
  `goalPlanStatus` (coordination-store.mjs:10593-10670) directly — :10630 gains the `'paused'`
  branch (the actual `node.state` fix Part C rule 5 previously flagged as out-of-budget);
  :10637 is named and verified unreachable for `'paused'` (gated by `TERMINAL.has(status)` at
  :10636, `TERMINAL` = `{completed,failed,cancelled}` at :120) — no code change there.
- **P2-3 (handle.status stays 'working' while the task is paused).** Resolved: named explicitly
  as deliberate for 31-a in Part B rule 2, with a 31-b note — no 31-a-owned projection reads
  `handle.status` for a paused task differently from `task.status`/`node.state`.
- **P2-4 (legacy in-flight runs).** Resolved: one sentence added to Part D rule 4.

## Part A — `card().turnCompletion`: declaration, default, and the completeness lint (§2.1 rule 1)

**Decision: a new optional `card()` field, read through one coordinator helper, defaulting to
`'claim'` wherever absent — never a schema migration of existing cards.**

1. **The field.** `card().turnCompletion ∈ {'claim', 'pausable'}`, optional. No adapter's `card()`
   shape validator exists in this codebase today (cards are plain object literals, never
   schema-checked at construction) — so adding an optional key to five sites is additive by
   construction; the other ~dozen card sites (atlas/cartographer/hmac-advisory capability cards,
   the legacy `SubprocessAdapterBase` family at adapter.mjs:699-748, every test-double card in
   `impl/test/*.mjs`) need **zero edits** and correctly read as `'claim'` under rule 2.
2. **The default-application site.** A single coordinator helper, `_turnCompletionOf(handle)`,
   sited beside `_harnessOf` (coordinator.mjs:2160-2168, the existing `this._adapters[vendor]
   ?.card()` pattern): `this._adapters[handle.vendor]?.card()?.turnCompletion ?? 'claim'`. This
   is the ONLY place the field is read. The `lifecycle.turn_completed` handler
   (coordinator.mjs:9891-9941) calls it once, immediately after the existing `parkedUnsettled`
   guard (:9926-9931) and before the `_runTrustGate` dispatch (:9932-9939) — see Part B rule 1
   for the exact branch. No other call site reads `turnCompletion`; MockAdapter, the 77 test-side
   cards, and every card without the field take the `'claim'` branch, which is byte-identical to
   today's unconditional `_runTrustGate` dispatch — **zero behavior change** for any of them.
3. **Declare `'pausable'` on the five production identities, at four sites (rule Part-intro).**
   Add `turnCompletion: 'pausable'` to the object literal returned by:
   - `ClaudeSessionCli.card()` (claude-session.mjs:406-469, alongside the existing `verbs` key)
     — inherited by `GlmSessionCli` and `KimiSessionCli` through their `{...base, ...}` spread;
     **no edit at :1255 or :1338**.
   - `CodexAppServerCli.card()` (codex-appserver.mjs:268-323).
   - `GrokAcpCli.card()` (grok-acp.mjs:188-247).
   - `KimiAcpCli.card()` (kimi-acp.mjs:134-185).
   The legacy `SubprocessAdapterBase` family (`CodexAdapter`, `ClaudeAdapter`, `GlmAdapter`,
   adapter.mjs:699-748) stays `'claim'` (absent) — every verb but `spawn` is already
   `'unsupported'` there (D11/SC8, adapter.test.mjs:1077-1091); a card that cannot prompt or
   steer cannot meaningfully pause either, and declaring `'pausable'` on it would be a second
   lying-card violation of the same SC8 discipline that forbids claiming unimplemented verbs.
4. **Card-completeness lint.** A new static check, `impl/scripts/card-completeness-lint.mjs`,
   modeled directly on the existing `impl/scripts/fixture-clock-lint.mjs` /
   `lintDefaultTestDirectory` pattern (wired into `impl/scripts/run-suite.mjs:8,13-19` the same
   way — see Part E). Unlike the clock lint (a textual source scan), this lint **constructs each
   of the five production classes with the same zero-live-dependency minimal options the existing
   suite already uses** (`new ClaudeSessionCli({})`, verified constructible with no opts at
   claude-session.test.mjs:112; `new CodexAppServerCli({requestTimeoutMs: N})`,
   `new GrokAcpCli({requestTimeoutMs: N})`, `new KimiAcpCli({requestTimeoutMs: N})` — all three
   probe their version synchronously and swallow the probe failure, `versionProbe` catch blocks
   at codex-appserver.mjs:249-253 / grok-acp.mjs:169-174 / kimi-acp.mjs:125, never throwing when
   the real CLI is absent) and asserts `.card().turnCompletion === 'pausable'` on each. A fixed,
   closed registry of exactly these five `{label, build}` entries — not a directory scan — so an
   adapter added later must be added to the registry explicitly (a missing registration is a
   silent gap the lint cannot itself catch, named here rather than hidden). Exports
   `lintCardCompleteness()` returning `[]` on success or `[{label, reason}]` findings; wired into
   `run-suite.mjs` immediately after the existing `lintDefaultTestDirectory()` block
   (:8,13-19), same fail-fast shape (`process.stderr.write` one line per finding,
   `process.exit(1)`).

## Part B — `turn.paused`: the pause record (§2.1 rule 2)

**Decision: a pause record is the interaction family's exact single-consumer shape, reused
verbatim, keyed by a new in-memory map — not a new authority model.**

1. **Mint site and branch.** In the `lifecycle.turn_completed` handler
   (coordinator.mjs:9891-9941), immediately after the `parkedUnsettled` check (:9926-9931)
   returns false and before the existing `_runTrustGate` dispatch block (:9932-9939):
   ```
   if (this._turnCompletionOf(handle) === 'pausable') {
     const settled = this._admitPauseRecord(handle, task, terminalEvent, wr);
     if (!settled) break;
   }
   // the ONE pre-existing gate, unchanged: coordinator.mjs:9932,
   // `this._drainState === 'open' && handle.status !== 'stopping' && handle.status !== 'dead'`
   if (this._drainState === 'open' && handle.status !== 'stopping' && handle.status !== 'dead') {
     ...
   }
   ```
   A `'claim'` card (the default) never reaches the new branch — the existing `_runTrustGate`
   dispatch at :9932-9939 is reached exactly as today, gated by exactly the one pre-existing
   condition (never "unconditional" — that phrasing in an earlier draft of this contract was
   wrong; :9932's gate always applied and still does). A `'pausable'` card's turn returns from
   `_admitPauseRecord` either `settled === true` (Part D's degenerate auto-settle ran — fall
   through to the existing gate, which then dispatches `_runTrustGate` exactly as it always has)
   or `settled === false` (a live `steering.registered` marker exists — the task stays `paused`,
   `break` skips the trust gate for this turn; P2-1). This is the only branch point in the
   handler this contract adds.
2. **The record shape**, admitted by a new `_admitPauseRecord(handle, task, terminalEvent, wr)`:
   - A durable per-worker log entry, `appendAttributed({worker: workerId, harness, turnEpoch,
     kind: 'turn.paused', actor: 'worker', payload: {taskId: task.id, turnEpoch,
     changedPathsDigest}})` — the same `appendAttributed` used for `question.asked`/
     `approval.requested`/`decision.requested` (coordinator.mjs:10014, :10060, :10121), giving
     `turn.paused` the same per-worker-log durability and startup replay path as those three
     kinds (see rule 4). `workerId` is redundant with the envelope's own `worker` field
     (`question.asked` does not repeat it in `payload` either) — the record shape in the payload
     is `{taskId, turnEpoch, changedPathsDigest}`, three fields, not four; the fourth field named
     in docs/35 §2.1(2) (`workerId`) is carried by the envelope, not duplicated in the payload,
     mirroring the interaction-family precedent exactly.
   - An in-memory single-consumer record in a new `this._pausedTurns` map, keyed by a
     synthesized pause id (`pause:${task.id}:${terminalEvent.seq}` — task-scoped, not
     worker-scoped, because a worker's task identity is what a nudge/wait/claim act targets in
     31-b): `{state: 'pending', resolution: null, consumer: null, worker: workerId, taskId:
     task.id, turnEpoch, changedPathsDigest, mintedEvent: terminalEvent.seq}`. This is
     field-for-field the interaction record shape (`kind`/`worker`/`state`/`resolution`/
     `consumer`, coordinator.mjs:10018-10026) with `kind` fixed to `'pause'` implicitly (the map
     itself is homogeneous, unlike `_pending`, so no `kind` discriminator field is carried).
   - `_coordTransition(task, 'paused', 'task.paused:${task.id}:${terminalEvent.seq}', evidence,
     'policy')` — the durable task-state transition, mirroring the blocking-interaction pattern
     at coordinator.mjs:10029-10031 exactly (`_coordTransition(task, 'input_required', ...)`),
     riding the existing generic `'task.transitioned'` event kind (Part-intro; zero new fold
     code). Then the explicit in-memory parity write `task.status = 'paused'` — required because
     `_coordTransition` never touches it (coordinator.mjs:6821-6834), matching the pattern at
     every existing unpark call site (:8384, :8547, :8594, :10040, :10086, :10148).
   - **P2-3, named and deliberate: `handle.status` does not change here.** The question/approval
     precedent (coordinator.mjs:10038, `handle.status = 'blocked'` alongside `task.status =
     'input_required'` at :10040) writes both fields together; `_admitPauseRecord` writes only
     `task.status`, leaving `handle.status === 'working'` while the task is `paused`. In the
     `!hasDriver` degenerate case (Part D rule 4) this is a same-tick, unobservable blip — the
     record settles and `handle.status` is never read in between. In the `hasDriver` case (Part D
     rule 5) it is a real, persistent inconsistency for as long as the task stays parked, because
     `WorkerHandle.status` has no `'paused'` value and this contract does not add one (adding a
     new handle-level status is steering-act-shaped work, out of the card/pause-record/lifecycle
     scope this contract covers). This is safe for 31-a specifically because no 31-a-owned
     projection reads `handle.status` to decide whether a task is paused — the run-phase ladder,
     `node.state`, and story.mjs (Part C) all key off `task.status` or the durable log, never
     `handle.status`. **31-b note:** nudge/wait/claim are handle-targeted acts; when 31-b
     implements them it must decide whether `handle.status` gains a value or reuses `'blocked'`
     for a parked worker — this contract leaves that decision to 31-b, not because it is unaware
     of the gap but because closing it has no observable effect until a 31-b-owned surface reads
     `handle.status` for a paused worker.
3. **`changedPathsDigest`.** `canonicalDigest(this._worktrees.changedPathsAtCommit(baseSha,
   headSha))` where `baseSha = task.sessionContext?.baseSha` (the same field the structured-review
   scope check reads at coordinator.mjs:3827-3828) and `headSha` is the worker's worktree HEAD at
   pause time. **Named gap:** no existing `_worktrees` method reads a worktree's current HEAD
   without an already-known result SHA — `changedPathsAtCommit` (index.mjs:724-735) takes two
   40-hex commit SHAs and diffs between them; nothing in the `_worktrees` interface (enumerated in
   the Part-intro bullet) resolves "HEAD of this worktree right now." This contract adds one new
   minimal accessor, `_worktrees.currentHeadSha(worktreePath)` (`git rev-parse HEAD`, same
   `localGit` helper already in scope in the index.mjs factory that defines `changedLines`/
   `changedPathsAtCommit`, :700-735), returning `null` if the worktree has no commits yet (a
   pause on a turn that has made no commits — legal; a worker's brief may not have edited
   anything before its first pause).
   **P1-5, fixed.** `baseSha` is independently optional: `request.context.baseSha` is only
   conditionally spread into `SessionContext` (coordinator.mjs:634,
   `...(request.context.baseSha ? { baseSha: request.context.baseSha } : {})`), so every
   MockAdapter/backward-compat task with no `baseSha` in its session context reaches the mint
   site with `task.sessionContext?.baseSha === undefined`. `changedPathsAtCommit` validates
   *both* arguments as 40-hex (index.mjs:725-727) and throws `captured_change_invalid` if either
   fails — calling it with `baseSha === undefined` throws unconditionally, inside the
   `turn_completed` handler, for every such task. The guard is therefore on **both** operands, not
   only `headSha`: `changedPathsDigest = (!baseSha || !headSha) ? canonicalDigest([]) :
   canonicalDigest(this._worktrees.changedPathsAtCommit(baseSha, headSha))`. A no-baseSha task
   (the common backward-compat case) and a no-commits-yet task (Part B rule 3's original named
   gap) both resolve to `canonicalDigest([])`; only a task with both a baseSha and a worktree HEAD
   calls into `changedPathsAtCommit` at all.
4. **Single-consumer resolution and startup replay.** A new `_resolvePauseAuthority(pauseId,
   record)` mirroring `_resolveInteractionAuthority` exactly (coordinator.mjs:1841-1844):
   `record.state = 'resolved'`. 31-a exercises exactly one resolution path — the degenerate
   auto-settle (Part D) — stamping `record.consumer = 'policy'`, the same convention used by the
   policy-driven interaction resolution at `_cancelPendingForDrain` (coordinator.mjs:1879,
   `record.consumer = 'policy'`). 31-b's nudge/wait/claim acts reuse this same map and helper
   unmodified; 31-a does not implement them. Startup replay reconstructs `this._pausedTurns`
   from the durable per-worker log the same way `reconstructedPending` rebuilds `_pending`
   (coordinator.mjs:11441-11451): scan each worker's log for `turn.paused` entries without a
   matching resolution marker (a `turn.settled` entry — Part D — or a later
   `lifecycle.turn_started` proving the turn moved on), and re-seed `_pausedTurns` with
   `state: 'pending'` for any that are still open. A `paused` task discovered at startup with no
   reconstructable pause record (log truncated, worker gone) is exactly the
   `_terminalizeUnattachedCoordinationTasks` sweep's job (Part C rule 3) — it already fails any
   `working`/`input_required`/`paused` task with no `lifecycle.spawned` receipt, and a `paused`
   task's `lifecycle.spawned` receipt is unconditionally present (spawn strictly precedes any
   turn completing), so this sweep's practical effect on `paused` tasks is a no-op by
   construction, verified, not a gap needing new code.

## Part C — the `paused` task state: full lifecycle parity (§2.1 rule 3)

**Decision: `paused` is `input_required`'s sibling everywhere `input_required` currently appears
as a live/non-terminal status — same TRANSITIONS shape, same guard membership, same unpark
parity discipline, same fold (none needed), same "never disguise as done or as working"
projection rule.**

1. **`TRANSITIONS`.** coordination-store.mjs:121-125 (current lines — see Part-intro's note on
   the docs/35 §2.1(3) citation drift):
   ```
   const TRANSITIONS = new Map([
     ['pending', new Set(['working', 'cancelled'])],
     ['working', new Set(['input_required', 'paused', 'completed', 'failed', 'cancelled'])],
     ['input_required', new Set(['working', 'failed', 'cancelled'])],
     ['paused', new Set(['working', 'failed', 'cancelled'])],
   ]);
   ```
   `paused`'s outbound set is exactly `input_required`'s: `working` (unpark — degenerate
   auto-settle in 31-a; nudge/wait-then-claim in 31-b), `failed`/`cancelled` (a paused task must
   be terminalizable the same way a blocked one is — run stop, fleet drain, etc., none of which
   this contract changes, all of which already transition FROM `input_required` and must now
   also transition FROM `paused`). `TERMINAL` (:120) is unchanged — `paused` is non-terminal by
   design (docs/35 §2.1(3): "a new non-terminal state").
2. **The seven guard sites**, each currently `['working', 'input_required'].includes(task.status)`
   or equivalent, each gains `'paused'`:
   - `claimScratch` (coordinator.mjs:9122), `postScratchFact` (:9139), `requestBoardClaim`
     (:9199), `submitBoardReport` (:9209), `admitReplManifest` (:9223) — all five read
     `!['working', 'input_required'].includes(task.status)` → `!['working', 'input_required',
     'paused'].includes(task.status)`. These are worker-authored writes; a paused worker is
     mid-turn-boundary, not terminal, and its scratch/board traffic from the JUST-COMPLETED turn
     (a race between the turn-completed frame and a trailing scratch write, or a worker that
     queues its next write before observing the pause) must not be spuriously refused
     `task_not_active`.
   - `_terminalizeUnattachedCoordinationTasks` (:11467-11489, guard :11473) →
     `!['working', 'input_required', 'paused'].includes(durable.status)` — verified a practical
     no-op for `paused` specifically (Part B rule 4), included for exhaustiveness/audit
     correctness, not because it currently misfires.
   - The representation-admission gate (coordination-store.mjs:2878-2879) →
     `(requireLive && !['working', 'input_required', 'paused'].includes(task.status))`.
   - **An eighth site, found independently, not named in docs/35 §2.1(3): `_deriveWorkerStatus`**
     (coordinator.mjs:11454-11465). Its `switch` has explicit cases for the three terminal
     statuses and `input_required` (→`'blocked'`); everything else — including the new `paused`
     — falls through `default: return 'working'`. This is precisely the "never disguised as
     working" violation §2.1(3) warns against, just not enumerated by name. Fix: add
     `case 'paused': return 'blocked';` (mirroring `input_required`'s mapping — from a worker's
     external-status point of view, "waiting on something before it can proceed" is `blocked`
     regardless of whether the something is an answer or a steering decision; `WorkerStatus` has
     no dedicated `paused` value and this contract does not add one to that enum — Part C rule 5
     covers why).
3. **Unpark parity** (auto-settle's consumption path — the only one 31-a exercises). Mirrors the
   `input_required` respond()-unpark pattern exactly (coordinator.mjs:8377-8386, :8462-8467,
   :8585-8594): `_coordTransition(task, 'working', 'task.working:${task.id}:${event.seq}',
   evidence, 'policy')` (durable) **then** the explicit `task.status = 'working'` in-memory write
   (not implied by `_coordTransition` — Part-intro). Part D pins the exact call site and ordering
   relative to the trust gate.
4. **Fold surface: zero new code.** `paused` rides the existing generic `'task.transitioned'`
   event kind exactly as every other status does; `_apply`'s handling (coordination-store.mjs
   :7631-7637, `status: p.to`) requires no branch for `paused` specifically, verified by reading
   the branch (Part-intro). `PROJECTION_CHECKPOINT_FIELDS` (:92-118) needs **no new entry** — the
   `_tasks` map (already listed, :93) is the only durable projection `paused` touches at the
   coordination-store layer; the interaction-family-style `_pausedTurns` in-memory map lives on
   the **coordinator**, not the store, exactly where `_pending`/`_activeInteractionIds` live
   today (neither of those is in `PROJECTION_CHECKPOINT_FIELDS` either — they are
   coordinator-side, replay-reconstructed from the per-worker log, not store-side
   checkpoint-projected; Part B rule 4 gives the reconstruction).
5. **Projections — honest `paused` rendering.**
   - **Run-phase ladder** (application.mjs:4979-4995). Insert a `paused` branch into the
     ternary ladder at :4979-4986, keyed off `node?.state`, at the same priority tier as
     `'running'` (a paused node is neither `work_completed`/`failed`/`cancelled` nor merely
     `'approved'`-and-undispatched): `node?.state === 'paused' ? 'paused' : node?.taskId ?
     'running' : 'approved'`.
     **P2-2, resolved — `node.state`'s exact file:line.** `node?.state` is folded inside
     `goalPlanStatus` (coordination-store.mjs:10593-10670, called through application.mjs's
     `_goalPlanStatus` wrapper at :3932, itself invoked at :4970 to build this ladder's `node`).
     The `state` assignment (:10629-10630) is:
     `if (dispatched) state = dispatched.task?.status === 'completed' && !dispatched.task
     .acceptanceRevocation ? 'accepted' : (['failed', 'cancelled'].includes(dispatched.task
     ?.status) ? dispatched.task.status : 'dispatched');` — every non-terminal status
     (`working`, `input_required`, and now `paused`) currently falls through to the literal
     `'dispatched'`, which is exactly the phase-ladder gap this rule names. Fix: extend the
     ternary chain with one more arm before the `'dispatched'` fallback: `... : dispatched.task
     ?.status === 'paused' ? 'paused' : 'dispatched'`. **The sibling site, :10637** (`let code =
     dispatched.task.status === 'completed' ? 'accepted' : dispatched.task.status ===
     'cancelled' ? 'cancelled' : 'task_failed';`, feeding `terminalOutcome`) is named here too but
     needs **no edit**: it only executes inside `else if (dispatched?.task &&
     TERMINAL.has(dispatched.task.status))` (:10636), and `TERMINAL` (:120) is
     `{completed, failed, cancelled}` — `paused` can never satisfy that guard, so a paused node's
     `terminalOutcome` stays `null`, exactly as it already does for `working`/`input_required`
     today. Named for audit completeness (mirroring the eighth-guard-site precedent, rule 2
     above), not because it currently misfires.
   - **wave.mjs.** `progress()` (:159-179) relays `outline.phase` verbatim
     (`phase: outline.phase ?? null`) — **no wave.mjs code change** once application.mjs's phase
     ladder is honest; the pass-through was verified by reading the function body.
     **`attentionFrom` (:78-88) — SHARED DECISION, 31-b's edit, not 31-a's.** An earlier draft of
     this contract pinned `attentionFrom('paused') === null` as a deliberate 31-a/31-c boundary.
     That pin is **superseded**: the orchestrator's shared decision across 31-a/31-b is that
     `attentionFrom` gains `if (phase === 'paused') return 'turn_checkpoint';` inside :78-88, and
     that edit belongs to **31-b**, not 31-a or 31-c. This contract makes no `attentionFrom` code
     change and does not duplicate 31-b's — it states the dependency: once this contract's
     run-phase ladder fix lands, `outline.phase` can legitimately be `'paused'`, and 31-b's
     `attentionFrom` branch is what turns that into a `turn_checkpoint` attention class. Until
     31-b ships, `attentionFrom('paused')` falls through the existing `if`-chain to `return null`
     by construction (no code change needed for that interim state to be correct) — visible in
     `phase`, silent in `attention`, which is the right behavior for 31-a's own scope even though
     it is not the final state.
   - **story.mjs.** `LEGAL_TRANSITIONS[KIND.TURN_COMPLETED]` (:224) and its `applyEvent` case
     (:348-355) unconditionally park the worker at `'idle'` whenever `w.status === 'working'` —
     which would misrender a paused turn as "finished and free to redispatch," a distinct but
     equally dishonest failure from "disguised as working." Decision: add
     `TURN_PAUSED: 'turn.paused'` to the `KIND` map (mirroring `QUESTION_ASKED:
     'question.asked'`, story.mjs's existing convention — the coordinator now emits this kind on
     the same per-worker log story.mjs folds, Part B rule 2), with a symmetric
     `TURN_SETTLED: 'turn.settled'` (Part D) with `{from: ['paused'], to: 'working'}`.
     **P1-2, fixed — the fold-order bug.** The per-worker log order is fixed by construction:
     `lifecycle.turn_completed` is appended at coordinator.mjs:9896, and `turn.paused` (Part B
     rule 2) is minted strictly afterward, inside `_admitPauseRecord`, which the mint-site branch
     (Part B rule 1) only reaches once the `parkedUnsettled` check has already passed :9926-9931.
     So `KIND.TURN_COMPLETED`'s existing `applyEvent` case (:348-355, `if (w.status ===
     'working') transitionStatus(w, kind, 'idle')`) always runs first and — since the worker is
     `'working'` at that point — always parks the worker at `'idle'` before `turn.paused` is even
     folded. A `LEGAL_TRANSITIONS[KIND.TURN_PAUSED] = {from: ['working'], to: 'paused'}` guard
     (as drafted originally) is therefore vacuous: by the time `TURN_PAUSED` folds,
     `w.status === 'idle'`, `transitionStatus` (:312-320) finds `'idle'` outside `rule.from`, adds
     `'illegal_transition'` to `w.warnings`, and leaves the worker rendered `'idle'` — silently
     wrong, and now also mis-flagged as illegal. Fix: `LEGAL_TRANSITIONS[KIND.TURN_PAUSED] =
     {from: ['working', 'idle'], to: 'paused'}` — a multi-value `from` set has direct precedent in
     this same table (`KIND.TURN_STARTED`: `{from: ['idle', 'working', 'interrupted'], ...}`,
     :223; `KIND.INTERRUPT_REQUESTED`: `{from: ['working', 'blocked', 'idle'], ...}`, :226), so
     this is not a novel shape. With `'idle'` admitted, the real two-event sequence
     (`turn_completed` folds `working`→`idle`, then `turn.paused` folds `idle`→`paused`) succeeds
     cleanly, and the parked worker renders `'paused'`, not `'idle'`. The `TURN_PAUSED`
     `applyEvent` case must call `transitionStatus(w, KIND.TURN_PAUSED, 'paused')` (not assign
     `w.status` directly) so this guard is actually consulted.
     The `WorkerStatus` typedef (:37) gains `'paused'`. `NEVER_STALLED_STATUSES` (:113) gains
     `'paused'` (a paused worker is legitimately waiting, same rationale as `input_required`
     already there). `ACTIVE_STATUSES` (:662) gains `'paused'` (a paused worker is not idle/done
     — SC5d's own rule, "active means actually doing something," and a parked-pending-steering
     turn is still in flight). The existing `KIND.TURN_COMPLETED` case (:348-355) is **left
     unmodified** — the new `TURN_PAUSED`/`TURN_SETTLED` kinds are the coordinator's honest
     signal; `TURN_COMPLETED` continues to mean "this turn is fully done, no pause," which after
     Part B rule 1's branch is now only ever emitted for a `'claim'`-carded turn or a
     `'pausable'`-carded turn whose card lied (never observed in the closed adapter registry).
6. **P1-3, fixed — CI6 must not silently resurrect a paused task; it must fail it, on purpose,
   the same way it already fails an unresolved `input_required` task.** Named site: CI6
   (coordinator.mjs:11251-11276, `if (!revisionRecoveryUnknown && !preservedInterrupt &&
   !TERMINAL_TASK_STATUSES.has(terminalStatus))` durably fails the task via
   `control.recovery_terminalized` / `session_not_reattached`). The per-event replay switch that
   computes the local `terminalStatus` variable (coordinator.mjs:10634-11212) has no case for
   the new `turn.paused`/`turn.settled` kinds; its `lifecycle.turn_completed` case (:11033-11048)
   unconditionally sets `terminalStatus = 'verifying'` whenever `e.payload?.status ===
   'completed'` (:11039) — true for a paused turn exactly as for a claimed one, because the
   pause decision is downstream of the provider's own completed result, not encoded in it. A
   restarted coordinator therefore computes `terminalStatus = 'verifying'` for a task that was
   actually `paused`, which is neither in `TERMINAL_TASK_STATUSES` (:245,
   `{completed, failed, cancelled}`) nor `'interrupted'`, so CI6 fires and durably fails it.
   **CHOOSE: fail-closed, parity with `input_required` — and this is not a new decision, it is
   already today's behavior for that sibling status.** Verified: a blocking
   `question.asked`/`approval.requested`/`decision.requested` sets `terminalStatus =
   'input_required'` on replay (:11142) whenever it is not already resolved; nothing in the
   replay switch (:11179-11208) resets it back to `'working'` unless a matching
   `question.answered`/`approval.resolved`/`decision.settled`/qualifying
   `control.interaction_superseded` event follows. An outstanding, unresolved `input_required`
   task therefore ALREADY hits CI6's exact same branch today, before this contract, and is
   durably failed on restart — a crashed session cannot honor a still-open question any more
   than it can honor a still-open pause. `paused` is symmetric: no live session exists to
   nudge/wait/claim it after a restart, so it must also durably fail rather than silently resume
   as if never parked. **No new code is required in the `terminalStatus` switch or in CI6
   itself** for this outcome — the existing unconditional `'verifying'` assignment at :11039
   combined with the existing CI6 branch already produces it.
   **The one real gap, and its resolution:** the reconstructed `_pausedTurns` entry (Part B rule
   4) is seeded unconditionally at the end of replay, exactly like `reconstructedPending`
   (coordinator.mjs:11443-11451, `for (const [requestId, record] of reconstructedPending) {
   this._pending.set(requestId, record); ... }`) — neither loop checks whether CI6 subsequently
   failed the owning task. So a dead (`failed`) task can carry a dangling `_pausedTurns` entry
   with `state: 'pending'` after restart, exactly mirroring the pre-existing, already-tolerated
   behavior for a dead task's dangling `_pending` interaction record. This is named here as
   existing precedent this contract inherits, not a new problem it introduces, and it needs no
   new guard code to match that precedent. The Part E replay red test pins both halves: (a) the
   post-restart durable task status is `'failed'` (CI6 fired), and (b) `_pausedTurns` still
   contains the stale `state: 'pending'` entry for it (parity with `_pending`'s identical
   tolerance), not merely that `_pausedTurns` was reconstructed at all.

## Part D — `steering.registered` at run creation and degenerate auto-settle (§2.2 rules 4-5)

**Decision: one new `driver.recorded` marker kind, admitted through a new closed `driverKind`
option threaded from `runs.start`, checked by an event-log scan mirroring an existing precedent
— no new durable projection, no caller-supplied authority beyond what `runs.start` already
authenticates.**

1. **The marker.** `steering.registered {runId, driverKind, actor}`, admitted via the existing
   `recordDriver`/`_coordRecord` envelope (coordination-store.mjs:12306-12312,
   coordinator.mjs:6857-6860) — `this._coordRecord('steering.registered', {runId, driverKind,
   actor}, 'run.steering_registered:${runId}', actor)`. Rides the generic `'driver.recorded'`
   event kind; no fold-surface change (Part-intro; `recordDriver` never writes a dedicated
   projection map today, by design — it "stays an event log," docs/35 §2.2 rule 4's own words,
   verified at :12306-12312).
2. **Admission site: run creation, not a client-side hint.** `prepareRunStart`
   (application-client.mjs:111-183) gains one new optional whitelisted key,
   `driverKind`, added to the `exactOptions` set at :113-115
   (`['runId','resultIntent','profile','scope','model','harness','effort','exact',
   'driverKind']`), validated to the single literal `'wave'` (any other value is
   `clientError('Run driverKind is invalid')` — MCP/embedded explicit registration, named in
   docs/35 §2.2 rule 4 as a future channel, is **not** implemented by this contract; only the
   wave path exists in 31-a). `intent.driverKind = options.driverKind` when present
   (mirroring the `for (const key of ['runId','profile','scope'])` copy-through at :147-149).
   `BatonRuns.start`/`#startPrepared` (:1284-1294) thread `intent` unchanged into
   `application.command('run.start', {intent})`.
   **P1-1, BLOCKING, fixed — the client-side whitelist alone is not enough.** The command
   dispatcher validates `run.start` args by calling `normalizeIntent(args.intent)`
   (application.mjs:1278) before the handler ever runs, and `start()` itself derives its working
   `intent` by calling the *same* `normalizeIntent` again via `_resolveIntent` (:2413-2414). Both
   call sites hit one function: `normalizeIntent` (:918-942) enforces a closed key whitelist —
   `new Set(['runId', 'objective', 'resultIntent', 'profile', 'route', 'scope', 'composition'])`
   (:919-921) — and throws `application_intent_invalid` (:931) the moment `Object.keys(value)
   .some((key) => !allowed.has(key))` is true (:924), then rebuilds the frozen intent from only
   those keys (:933-941). `driverKind` is in neither set. As written, ANY caller that reaches
   `normalizeIntent` with `driverKind` present — including this contract's own Part E red tests
   for `runs.start({driverKind: 'wave', ...})` — throws before the handler body runs at all; the
   client-side whitelist in `prepareRunStart` is necessary but not sufficient. Fix: add
   `driverKind` to the allowed `Set` at :919-921, validate it the same way `resultIntent` is
   already validated two lines below (:922, :926 — `hasResultIntent && !RESULT_INTENTS
   .has(value.resultIntent)`; mirror with a `hasDriverKind` check against a new frozen
   `DRIVER_KINDS = new Set(['wave'])`, same shape as `RESULT_INTENTS` at :100), and copy it
   through in the rebuild at :933-941 (`...(hasDriverKind ? { driverKind: value.driverKind } :
   {})`). This double-validates (client rejects a bad literal early with `clientError`; server
   rejects it again, defense-in-depth, with `application_intent_invalid` — the same two-tier
   pattern `resultIntent` already uses across application-client.mjs:127-128 and
   application.mjs:926) and is what actually lets `driverKind` reach the handler.
   **`driverKind` does NOT join `intentDigest` or runId derivation.** `_admitRecursiveRun`'s
   `intentDigest` (:3703-3708) and `start()`'s own runId hash (:3722-3729) both fold `objective`,
   `resultIntent`(when explicit), `profile`/`profileDigest`, `route`, `composition`, `scope`, and
   owner/runId identity — `driverKind` is deliberately excluded from both. It describes *who is
   driving* a run, not *what the run is*; two calls with identical objective/profile/route/scope
   should resolve to the same run whether or not a wave happens to be the caller, exactly the way
   two runs with the same shape don't fork identity over unrelated provenance metadata today.
   Including it would mean a hand-authored MCP call and a wave member with otherwise-identical
   intent silently mint two different runIds for what is semantically one request — worse
   idempotency, not better.
   **The `existingRun !== null` reconcile case, specified.** `start()` computes `existingRun`
   before authorization (:3732-3734, `this._findRun(intent.runId, {allowUnavailableProfile:
   true})`) and already treats it as a *resume*, not a fresh admission — e.g. `resultIntent`
   inherits from `durableResult` when the caller omits it and `existingRun !== null` (:3763-3767).
   `defineGoal` (:3829-3830) still runs on a resume (a later goal/plan revision can be admitted
   against an existing run), so it is not by itself "run creation." The `steering.registered`
   marker admission must NOT fire on every `defineGoal` call — only once, on a genuinely new run.
   Insertion point: immediately after `defineGoal` succeeds and `goal` is bound (:3829-3831),
   guarded by `existingRun === null && intent.driverKind !== undefined`:
   `if (existingRun === null && intent.driverKind !== undefined) { this._coordRecord
   ('steering.registered', {runId: intent.runId, driverKind: intent.driverKind, actor:
   authority(...).actorId}, 'run.steering_registered:${intent.runId}', owner); }`. A retry of
   `runs.start` against an `existingRun !== null` with `driverKind: 'wave'` therefore never
   re-admits (or duplicates) the marker — the run's driver identity is fixed at genuine creation
   time and is never retroactively granted or revoked by a later resumed call, matching Part D
   rule 3's `hasDriver` scan, which finds the original marker (if any) by `runId` regardless of
   how many `defineGoal` calls followed it.
   **P1-4, fixed — 31-a does not ship the wave.mjs:151 edit.** An earlier draft of this contract
   claimed `createWave` (wave.mjs:151) is "the only caller that ever sets `driverKind: 'wave'`,"
   updated in the same pass to actually pass it. That edit is **deferred to 31-b** (see the
   boundary note below) — 31-a ships only the `normalizeIntent`/`prepareRunStart`/marker-admission
   machinery above, with **zero caller** in the shipped tree. `wave.mjs:151` continues to call
   `baton.runs.start(member.objective, { ...route, scope: [...member.scope] })` exactly as today,
   unchanged. This is deliberate, not an oversight: with `driverKind: 'wave'` wired end to end but
   pausable cards live, a wave member's first `turn_completed` would mint a pause, `hasDriver`
   would resolve `true`, the task would park — and 31-a implements no nudge/wait/claim
   consumption path (that is 31-b), and the stall watchdog is cleared at `_clearWatchdog`
   (coordinator.mjs:9900) on every `turn_completed` and never re-arms on its own, so a wave member
   would park forever with no live code path to unstick it. Deferring the caller means the
   `!hasDriver` degenerate-auto-settle path (Part D rule 4) is what every run in the current
   suite exercises, unchanged, and the `hasDriver`-true branch (Part D rule 5) is exercised only
   by this contract's own hand-admitted-marker red tests, never by production wave traffic, until
   31-b lands its own wave.mjs edit — which this contract names as a dependency rather than
   duplicating.
   **Why this is not a client-side hint, despite being an ordinary option field:** the only
   intended caller of `driverKind: 'wave'` is `createWave` (wave.mjs, 31-b's edit, not this
   contract's) — server-side code inside the same process, not a value an external MCP/network
   caller can inject through any other path, because no call site in the tree this contract ships
   passes `driverKind`. The whitelist makes the field syntactically general, but the codebase's
   own call graph makes it semantically wave-exclusive until a second, explicit admission channel
   is built (out of scope here, matching docs/35's "MCP/
   embedded controllers may register explicitly" being named but not specified in v2).
3. **The degenerate-case liveness check**, run inside `_admitPauseRecord` (Part B rule 2) after
   minting the pause record and before returning: `const hasDriver =
   this._coordination.events().some((e) => e.kind === 'driver.recorded' && e.payload?.kind ===
   'steering.registered' && e.payload?.runId === task.runId);` — the exact scan-for-marker
   pattern already used for the `plan.wave_cleanup_completed` tombstone lookup
   (coordinator.mjs:3164-3168), reused verbatim in shape, new in predicate. `task.runId` is
   already resolved on every task record (used throughout the guard sites in Part C rule 2 and
   the `admitReplManifest` wrapper, coordinator.mjs:9227). No new in-memory cache — the existing
   codebase accepts this O(events) scan for exactly this kind of "was a durable marker ever
   admitted for this run" check, and `events()` (coordination-store.mjs:8231) is the store's own
   public accessor.
4. **Auto-settle**, when `!hasDriver`:
   - `_resolvePauseAuthority(pauseId, record)` (Part B rule 4), `record.consumer = 'policy'`.
   - Append `turn.settled {actor: 'policy', basis: 'auto_no_driver'}` to the same per-worker log
     via `appendAttributed` (mirroring the `turn.paused` mint in Part B rule 2 — same durability
     tier, same worker-scoped stream story.mjs folds via the new `TURN_SETTLED` kind, Part C
     rule 5).
   - Unpark: `_coordTransition(task, 'working', 'task.working:${task.id}:${settledEvent.seq}',
     evidence, 'policy')` then the explicit `task.status = 'working'` in-memory write (Part C
     rule 3).
   - **P2-1, fixed — return `settled = true` and fall through to the existing gated dispatch**
     (coordinator.mjs:9932-9939, `if (this._drainState === 'open' && handle.status !== 'stopping'
     && handle.status !== 'dead') { Promise.resolve(handle.worktreeReady).then(() =>
     this._runTrustGate(handle, wr)).catch(noop).finally(releaseAuthority); }`) — this is the
     entire backward-compat claim: every run with no live steering registration (today, that is
     every run — Part D rule 2's P1-4 fix means 31-a ships no caller that ever admits
     `steering.registered` at all, so `hasDriver` is `false` for literally every task in the
     current tree) passes through mint → immediate resolve → unpark → the exact trust-gate call
     gated by the one pre-existing condition above, byte-identical arguments, byte-identical
     timing relative to `worktreeReady`. (An earlier draft of this contract described that gate
     as running "unconditionally" — it does not, and never did; :9932's condition predates this
     contract and is unchanged by it. `_admitPauseRecord` returning `settled` and the mint-site
     branch doing `if (!settled) break;` — Part B rule 1 — is what lets this one pre-existing gate
     be the single dispatch path either way, instead of a second, redundant unconditional call.)
     Phase10 SC3/SC10, DG2's post-settlement continuation, and every MockAdapter flow in the
     current suite take this path and observe no new event ordering they don't already tolerate
     (they don't inspect `turn.paused`/`turn.settled` at all, and gain two new per-worker log
     lines they don't assert against).
   - **P2-4, one sentence on legacy in-flight runs.** Every run that exists today, and every run
     created after this contract ships that never passes `driverKind` (which, per the P1-4 fix
     above, is every run until 31-b's wave.mjs edit lands), has no `steering.registered` marker by
     construction, so its first pausable turn always takes this exact `!hasDriver` branch — mint,
     settle, unpark, trust-gate, all inside the same `lifecycle.turn_completed` handler tick —
     making a "legacy" in-flight run behaviorally indistinguishable from today's direct
     `_runTrustGate` dispatch even though its durable task status now transits through
     `paused → working` on the way there.
5. **When `hasDriver` is true**, the record stays `state: 'pending'` and the handler returns
   without dispatching `_runTrustGate` this turn — the task sits `paused`, a steering act
   (31-b: nudge/wait/claim) is required to move it. 31-a does not implement any consumption path
   for the live case; it only needs to leave the task correctly parked, which Part C's
   TRANSITIONS/guard/projection work already guarantees independent of who eventually resolves
   the record.

## Part E — red tests first (`impl/test/turn-checkpoints-31a-red.test.mjs`,
## `impl/test/card-completeness-lint-red.test.mjs`)

- **Card (Part A):** MockAdapter and a representative sample of existing test-double cards
  (already in the suite, untouched) still drive every existing turn_completed flow unchanged —
  no new assertion needed beyond "the full suite stays green" (Part G). `_turnCompletionOf`
  returns `'claim'` for a card with no field and for every legacy `SubprocessAdapterBase` card;
  returns `'pausable'` for `ClaudeSessionCli`/`GlmSessionCli`/`KimiSessionCli`/
  `CodexAppServerCli`/`GrokAcpCli`/`KimiAcpCli`, constructed with the same zero-live-dependency
  options the existing adapter test suites already use. `lintCardCompleteness()` returns `[]`
  against the current tree once the four declaration sites land, and returns a non-empty finding
  (file/reason, not a bare assert) when a declaration is reverted on any one of the five —
  pinned by constructing a deliberately-reverted card inline, mirroring `CL1` in
  `fixture-clock-lint-red.test.mjs`.
- **Pause record (Part B):** a `'pausable'`-carded worker's `lifecycle.turn_completed` mints
  `turn.paused` on the per-worker log (envelope fields correct: `kind:'turn.paused'`,
  `actor:'worker'`, `payload:{taskId, turnEpoch, changedPathsDigest}`), an in-memory
  `_pausedTurns` entry keyed `pause:<taskId>:<seq>` with `state:'pending'`, and durably
  transitions the task to `paused` (`this._coordination.task(id).status === 'paused'`,
  survives a coordination-store checkpoint round-trip). `changedPathsDigest` is
  `canonicalDigest([])` both when the worktree has no commits yet (`headSha === null`) AND when
  `task.sessionContext?.baseSha` is absent (P1-5 — every MockAdapter/backward-compat task with no
  `baseSha`, the common case per coordinator.mjs:634); matches `changedPathsAtCommit(baseSha,
  headSha)` only when both are present.
- **`paused` lifecycle parity (Part C):** each of the seven guard sites (`claimScratch`,
  `postScratchFact`, `requestBoardClaim`, `submitBoardReport`, `admitReplManifest`,
  representation admission, the startup sweep) accepts a `paused` task exactly as it accepts
  `input_required` today (positive case) and still refuses a `completed`/`failed`/`cancelled`
  task (negative case, unchanged). `_deriveWorkerStatus('paused') === 'blocked'`. TRANSITIONS:
  `working → paused` legal, `paused → working|failed|cancelled` legal,
  `paused → completed` **illegal** (`invalid_transition`, direct-to-completed must always
  traverse `working` first — the trust gate's own claim-time evaluation, unchanged in 31-a, is
  what eventually produces `completed`). application.mjs phase ladder renders `'paused'` for a
  task in that status, not `'running'` (asserted via `node.state === 'paused'` after the
  coordination-store.mjs:10630 fix, P2-2); wave.mjs `progress()` relays it unchanged
  (`member.phase === 'paused'`). `attentionFrom('paused')` currently returns `null` (falls
  through :78-88's `if`-chain) — this is the correct interim state for 31-a's own scope, not a
  permanent pin: the SHARED DECISION is that 31-b adds a `'paused'` → `'turn_checkpoint'` branch
  there, so this red test asserts today's `null` behavior is unaffected by 31-a's changes, and
  must NOT be read (by this suite or a future one) as asserting `attentionFrom('paused') === null`
  forever — that assertion is 31-b's to own and eventually flip.
  story.mjs: the real two-event sequence — `lifecycle.turn_completed` (folds `working → idle`)
  immediately followed by `turn.paused` (folds `idle → paused`, per the `{from: ['working',
  'idle']}` fix, P1-2) — renders the worker `'paused'`, not `'idle'`; a bare `TURN_PAUSED` event
  fired in isolation from `'working'` also succeeds (the same guard's other admitted `from`
  value), and firing it from any status outside `{'working', 'idle'}` is a no-op that also sets
  `warnings.has('illegal_transition')` (verified via `transitionStatus`, story.mjs:312-320 — this
  is a warning, not silent, unlike the vacuous-test framing in an earlier draft).
  `NEVER_STALLED_STATUSES`/`ACTIVE_STATUSES` include it (a stalled signal never fires for a
  paused worker; the wave header's active-count includes it).
- **Steering registration + degenerate auto-settle (Part D):** `runs.start(objective,
  {driverKind:'wave', ...})` admits `steering.registered {runId, driverKind:'wave', actor}` as a
  `driver.recorded` event at run-creation time (immediately after `defineGoal`, gated on
  `existingRun === null`), before any task exists for the run; `runs.start(objective, {...})`
  with no `driverKind` (every non-wave caller, unchanged) admits nothing.
  `runs.start(objective, {driverKind: 'orchestrator'})` (or any non-`'wave'` value) is refused
  `clientError` at the client layer (`prepareRunStart`), before any command dispatch; a value that
  somehow reached `normalizeIntent` directly (bypassing the client whitelist, e.g. a hand-built
  command payload in a test) is refused `application_intent_invalid` server-side too (P1-1 —
  defense in depth, the same two-tier shape `resultIntent` already uses) — never admitted as a
  marker either way. A second `runs.start` call against the same `runId` (`existingRun !== null`)
  with `driverKind: 'wave'` admits **no second marker** — the reconcile-case fix (Part D rule 2)
  — asserted by calling `runs.start` twice with the same `runId` and counting
  `steering.registered` events for that run (must stay 1, not 2). A pause record minted on a run
  with **no** `steering.registered` marker auto-settles synchronously within the same
  `lifecycle.turn_completed` handling: `turn.settled {actor:'policy', basis:'auto_no_driver'}`
  appended, task unparked to `working`, `_runTrustGate` invoked with the exact `wr` the turn
  produced — **and the full existing suite (phase10 SC3/SC10, DG2, every MockAdapter-driven
  test) passes unmodified**, because every one of those runs has no `steering.registered` marker
  (P1-4: 31-a ships no caller that ever sets one) and takes this exact path. A pause record
  minted on a run **with** a live `steering.registered` marker (necessarily hand-admitted in the
  test, since 31-a ships no production caller — P1-4) stays `paused`, is not auto-settled, and
  `_runTrustGate` is **not** invoked that turn — pinned by asserting the mock adapter's
  verification hook was never called, not merely that the task status is `paused`.
- **Replay + fold (Part C rule 4 and rule 6):** `_apply('task.transitioned', {to:'paused', ...})`
  folds `_tasks.get(id).status === 'paused'` with no new branch touched (a coverage assertion over
  the existing branch, not a new one); a checkpoint saved mid-pause and reloaded reconstructs the
  `paused` task status from `_tasks` alone (no new `PROJECTION_CHECKPOINT_FIELDS` entry
  required — the field-exact load at :743-744 stays unchanged and still passes); a coordinator
  restarted mid-pause with a **live** `steering.registered` marker for the run (per-worker log
  has `turn.paused`, no `turn.settled`, no `lifecycle.turn_started` after it) reconstructs
  `_pausedTurns` with `state:'pending'` for that entry, mirroring `reconstructedPending`'s own
  replay test coverage — but (P1-3) asserts the durable task status ends up `'failed'` after
  restart (CI6 fires, fail-closed parity with an unresolved `input_required` task, not a special
  case for `paused`) AND that the reconstructed `_pausedTurns` entry still exists with
  `state:'pending'` for that now-dead task (parity with `reconstructedPending`'s identical,
  pre-existing tolerance for a dead task's dangling `_pending` entry — named, not newly
  introduced).

Then the full suite `node impl/scripts/run-suite.mjs` green from the worktree root (this is the
literal backward-compat claim: **zero existing test in the current tree asserts anything about
`turn.paused`/`turn.settled`/`paused`, so none of them can observe the new mint-then-auto-settle
detour except through timing, and the detour is synchronous within the same handler tick**), and
`node --test impl/test/wave-driver-red.test.mjs` (exit 0) stays green — verified green against
the current tree, unmodified by this document, before this contract was written (Part-intro
verification run).

## Part F — boundaries

- **No steering acts.** `nudge`/`wait`/`claim`, their reservation + authority op, claim
  invalidation on nudge, and the `_expireScratchClaims` mirror at coordinator.mjs:10200 are
  31-b. 31-a implements exactly one resolution path for a pause record (policy auto-settle) and
  leaves the live-registration case correctly parked, untouched otherwise.
- **No wave.mjs:151 edit (P1-4).** `createWave` keeps calling `baton.runs.start` without
  `driverKind` — 31-a ships the `runs.start`/`normalizeIntent`/marker-admission machinery with no
  caller. Wiring `driverKind: 'wave'` into wave.mjs:151 is 31-b's edit, stated here as a
  dependency; this contract does not duplicate it.
- **No attention/escalation branch of its own.** `attentionFrom` (wave.mjs:78-88) gains no code
  change from this contract. SHARED DECISION: the `'paused'` → `'turn_checkpoint'` mapping there
  is **31-b's** edit (not 31-c's, correcting an earlier draft of this contract), made possible
  once this contract's `phase: 'paused'` projection lands. Until 31-b ships,
  `attentionFrom('paused')` returns `null` by construction (falls through the existing
  `if`-chain) — visible in `phase`, silent in `attention`, which is the correct interim state,
  not a permanent one this contract asserts.
- **No stall-watchdog redesign.** The `task.status !== 'working'` guard at coordinator.mjs:7408
  already protects a `paused` task by construction (verified, Part-intro); this contract adds no
  watchdog code. Mid-turn long work (a worker waiting on its own subagents/suite) produces no
  result frame and therefore never reaches the `lifecycle.turn_completed` handler this contract
  touches — untouched, per docs/35 §2.2 rule 9. (P1-4: because 31-a ships no wave.mjs caller, the
  watchdog's clear-and-never-rearm at `_clearWatchdog`/:9900 for a task parked by a live driver is
  exercised only by this contract's own hand-admitted-marker tests, never by production traffic,
  until 31-b's caller and consumption paths exist together.)
- **No MCP/embedded explicit registration channel.** Only `driverKind: 'wave'` through
  `runs.start` is implemented; the whitelist is closed to that one literal. A second explicit
  channel is a named future extension, not built here.
- **No new durable projection map.** `steering.registered` and `turn.paused`/`turn.settled` all
  ride existing generic envelopes (`driver.recorded`, `appendAttributed`'s per-worker log,
  `task.transitioned`); `PROJECTION_CHECKPOINT_FIELDS` gains nothing. The only genuinely new
  primitive is `_worktrees.currentHeadSha` (Part B rule 3) and the two in-memory maps
  (`_pausedTurns` on the coordinator, mirroring `_pending`).
- **No credentials, no git mutation beyond what already happens, no scratch/temp writes.**
  `_worktrees.currentHeadSha` reads (`git rev-parse HEAD`); it does not commit. Nothing in this
  contract writes outside the coordination ledger and the per-worker log; no `/tmp`, no harness/
  global-config mutation.

## Part G — validation

Focused red suite (`impl/test/turn-checkpoints-31a-red.test.mjs`,
`impl/test/card-completeness-lint-red.test.mjs`) green; then the full suite
`node impl/scripts/run-suite.mjs` green from the worktree root; the wave-driver reviewer
contract `node --test impl/test/wave-driver-red.test.mjs` (exit 0) stays green — verified green
against the current tree before this contract was written, and unaffected by it (this document
makes no code changes; Part-intro records the verification run).
