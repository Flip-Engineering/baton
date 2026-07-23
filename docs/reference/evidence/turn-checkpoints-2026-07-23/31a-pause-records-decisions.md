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
  with no wave.mjs code change for `phase`, only for `attentionFrom`); story.mjs's per-worker fold
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
     this._admitPauseRecord(handle, task, terminalEvent, wr);
     break;  // never falls through to the existing _runTrustGate dispatch this turn
   }
   // existing _runTrustGate dispatch, unchanged
   ```
   A `'claim'` card (the default) never reaches the new branch — the existing `_runTrustGate`
   dispatch at :9932-9939 is reached exactly as today, unconditionally, byte-identical code path.
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
   anything before its first pause). When `headSha` is `null`, `changedPathsDigest` is
   `canonicalDigest([])`, not an error.
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
     'running' : 'approved'`. This requires `node.state` (the plan-node projection folded from
     task status inside `_goalPlanStatus`) to gain a `'paused'` value wherever it currently maps
     `task.status → node.state`; this contract does not re-derive that mapping's exact file:line
     (out of the read budget for this pass — `_goalPlanStatus` is a large method) but pins the
     requirement: **`node.state` must distinguish `paused` from `'accepted'`/`'failed'`/
     `'cancelled'`/plain-dispatched, or the phase ladder cannot key off it.** The
     `ownedWorker`-conditioned branches immediately after (:4991-4995, `'interrupted'`/
     `'interruption_uncertain'`) are `!runStop && phase === 'running'`-gated and so do not fire
     once `phase` is `'paused'` — no interaction between this branch and those two.
   - **wave.mjs.** `progress()` (:159-179) relays `outline.phase` verbatim
     (`phase: outline.phase ?? null`) — **no wave.mjs code change** once application.mjs's phase
     ladder is honest; the pass-through was verified by reading the function body. `attentionFrom`
     (:78-88) is a separate, deliberate non-change in 31-a: it currently maps `'input_required'`
     → `'blocked_interaction:answer_required'`; this contract does **not** add a `'paused'` →
     attention-class mapping there, because visible-only escalation classification is named 31-c
     scope (docs/35 §2.2 rule 8, §4). A plain pause under 31-a surfaces as `phase: 'paused'` with
     `attention: null` — visible in the phase field, silent in attention, exactly matching
     "steer, don't gate" until 31-c adds the escalation bound.
   - **story.mjs.** `LEGAL_TRANSITIONS[KIND.TURN_COMPLETED]` (:224) and its `applyEvent` case
     (:348-355) unconditionally park the worker at `'idle'` whenever `w.status === 'working'` —
     which would misrender a paused turn as "finished and free to redispatch," a distinct but
     equally dishonest failure from "disguised as working." Decision: add
     `TURN_PAUSED: 'turn.paused'` to the `KIND` map (mirroring `QUESTION_ASKED:
     'question.asked'`, story.mjs's existing convention — the coordinator now emits this kind on
     the same per-worker log story.mjs folds, Part B rule 2), with `LEGAL_TRANSITIONS[
     KIND.TURN_PAUSED] = {from: ['working'], to: 'paused'}` and a symmetric
     `TURN_SETTLED: 'turn.settled'` (Part D) with `{from: ['paused'], to: 'working'}`. The
     `WorkerStatus` typedef (:37) gains `'paused'`. `NEVER_STALLED_STATUSES` (:113) gains
     `'paused'` (a paused worker is legitimately waiting, same rationale as `input_required`
     already there). `ACTIVE_STATUSES` (:662) gains `'paused'` (a paused worker is not idle/done
     — SC5d's own rule, "active means actually doing something," and a parked-pending-steering
     turn is still in flight). The existing `KIND.TURN_COMPLETED` case (:348-355) is **left
     unmodified** — the new `TURN_PAUSED`/`TURN_SETTLED` kinds are the coordinator's honest
     signal; `TURN_COMPLETED` continues to mean "this turn is fully done, no pause," which after
     Part B rule 1's branch is now only ever emitted for a `'claim'`-carded turn or a
     `'pausable'`-carded turn whose card lied (never observed in the closed adapter registry).

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
   `application.command('run.start', {intent})` — the run-creation command handler (not read in
   this pass; out of budget, named as the implementer's insertion point) reads
   `intent.driverKind` and, when present, calls `_coordRecord('steering.registered', {runId,
   driverKind: intent.driverKind, actor}, ...)` **once, at the same point the run's own creation
   record is admitted**, before any task/dispatch exists for it.
   **Why this is not a client-side hint, despite being an ordinary option field:** the only
   caller that ever sets `driverKind: 'wave'` is `createWave` itself
   (wave.mjs:151, updated to `baton.runs.start(member.objective, {...route,
   scope: [...member.scope], driverKind: 'wave'})`) — server-side code inside the same process,
   not a value an external MCP/network caller can inject through any other path, because no other
   call site in this codebase passes `driverKind`. The whitelist makes the field syntactically
   general, but the codebase's own call graph makes it semantically wave-exclusive until a
   second, explicit admission channel is built (out of scope here, matching docs/35's "MCP/
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
   - **Fall through to the existing `_runTrustGate` dispatch, unchanged**
     (coordinator.mjs:9932-9939, `Promise.resolve(handle.worktreeReady).then(() =>
     this._runTrustGate(handle, wr)).catch(noop).finally(releaseAuthority)`) — this is the
     entire backward-compat claim: every run with no live steering registration (today, that is
     every run — nothing admits `steering.registered` before 31-a's wave.mjs edit ships) passes
     through mint → immediate resolve → unpark → the exact trust-gate call that ran unconditionally
     before this contract, byte-identical arguments, byte-identical timing relative to
     `worktreeReady`. Phase10 SC3/SC10, DG2's post-settlement continuation, and every MockAdapter
     flow in the current suite take this path and observe no new event ordering they don't
     already tolerate (they don't inspect `turn.paused`/`turn.settled` at all, and gain two new
     per-worker log lines they don't assert against).
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
  `canonicalDigest([])` when the worktree has no commits yet; matches
  `changedPathsAtCommit(baseSha, headSha)` when it does.
- **`paused` lifecycle parity (Part C):** each of the seven guard sites (`claimScratch`,
  `postScratchFact`, `requestBoardClaim`, `submitBoardReport`, `admitReplManifest`,
  representation admission, the startup sweep) accepts a `paused` task exactly as it accepts
  `input_required` today (positive case) and still refuses a `completed`/`failed`/`cancelled`
  task (negative case, unchanged). `_deriveWorkerStatus('paused') === 'blocked'`. TRANSITIONS:
  `working → paused` legal, `paused → working|failed|cancelled` legal,
  `paused → completed` **illegal** (`invalid_transition`, direct-to-completed must always
  traverse `working` first — the trust gate's own claim-time evaluation, unchanged in 31-a, is
  what eventually produces `completed`). application.mjs phase ladder renders `'paused'` for a
  task in that status, not `'running'`; wave.mjs `progress()` relays it unchanged
  (`member.phase === 'paused'`); `attentionFrom` returns `null` for a `'paused'` phase (not
  `'blocked_interaction:...'` — pinning the 31-a/31-c boundary by test, not just by prose).
  story.mjs: a `TURN_PAUSED` event transitions the worker story to `'paused'` from `'working'`
  only (a no-op-without-warning from any other status, mirroring `QUESTION_ASKED`'s own
  `{from:['working']}` shape); `NEVER_STALLED_STATUSES`/`ACTIVE_STATUSES` include it (a stalled
  signal never fires for a paused worker; the wave header's active-count includes it).
- **Steering registration + degenerate auto-settle (Part D):** `runs.start(objective,
  {driverKind:'wave', ...})` admits `steering.registered {runId, driverKind:'wave', actor}` as a
  `driver.recorded` event at run-creation time, before any task exists for the run;
  `runs.start(objective, {...})` with no `driverKind` (every non-wave caller, unchanged) admits
  nothing. `runs.start(objective, {driverKind: 'orchestrator'})` (or any non-`'wave'` value) is
  refused `clientError` at the client layer, before any command dispatch — never reaches the
  store. A pause record minted on a run with **no** `steering.registered` marker auto-settles
  synchronously within the same `lifecycle.turn_completed` handling: `turn.settled
  {actor:'policy', basis:'auto_no_driver'}` appended, task unparked to `working`, `_runTrustGate`
  invoked with the exact `wr` the turn produced — **and the full existing suite (phase10 SC3/
  SC10, DG2, every MockAdapter-driven test) passes unmodified**, because every one of those runs
  has no `steering.registered` marker and takes this exact path. A pause record minted on a run
  **with** a live `steering.registered` marker (a wave member, or a hand-admitted marker in the
  test) stays `paused`, is not auto-settled, and `_runTrustGate` is **not** invoked that turn —
  pinned by asserting the mock adapter's verification hook was never called, not merely that the
  task status is `paused`.
- **Replay + fold (Part C rule 4):** `_apply('task.transitioned', {to:'paused', ...})` folds
  `_tasks.get(id).status === 'paused'` with no new branch touched (a coverage assertion over the
  existing branch, not a new one); a checkpoint saved mid-pause and reloaded reconstructs the
  `paused` task status from `_tasks` alone (no new `PROJECTION_CHECKPOINT_FIELDS` entry
  required — the field-exact load at :743-744 stays unchanged and still passes); a coordinator
  restarted mid-pause (per-worker log has `turn.paused`, no `turn.settled`, no
  `lifecycle.turn_started` after it) reconstructs `_pausedTurns` with `state:'pending'` for that
  entry, mirroring `reconstructedPending`'s own replay test coverage.

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
- **No attention/escalation.** `attentionFrom` (wave.mjs:78-88) gains no `'paused'` branch; no
  visible-only escalation bound, no typed stop, no policy knob. A live-registered pause is
  silent until 31-c.
- **No stall-watchdog redesign.** The `task.status !== 'working'` guard at coordinator.mjs:7408
  already protects a `paused` task by construction (verified, Part-intro); this contract adds no
  watchdog code. Mid-turn long work (a worker waiting on its own subagents/suite) produces no
  result frame and therefore never reaches the `lifecycle.turn_completed` handler this contract
  touches — untouched, per docs/35 §2.2 rule 9.
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
