# Package ③ members contract — the member-creation honesty contract (redrive 3)
[attempt: 9a07d8eb-e52d-475f-ac64-65ffbb707813 row-lc-members]

The implementation contract for the wave-lifecycle package (③)'s MEMBER-CREATION row: issue
#199 (member-creation failures emit no durable store record — the receipt reads `'failed'` for
members that never existed), issue #200 (member task ids derive from the objective without the
wave namespace — same-path re-drives bind the prior task, live or dead), issue #204 (the
resident has no drain-restart — impl landings force a manual restart that kills in-flight
waves, the v12→v13 dance), and — per the orchestrator addendum to this row's brief
(`row-lc-members.md:13-27`) — issue #218 (the spawn-wedge: a member whose spawn waits on a seat
ceiling never enters a typed state; no event, no roster truth, no queue position). This is the
**third drive** of the row's deliverable (`redrive3/contract-members.md`); the first dispatch
died before writing anything (the redrive QA's gap record,
`redrive/contract-qa.md`), and a redrive-2 attempt landed a contract in a sibling worktree
after that QA closed (git `60c99f4`). This artifact SUPERSEDES both: it carries every
ground truth of the redrive-2 text re-verified at the CURRENT HEAD — which has moved twice
since (`49b42d3` the #210 read-path rewrite, `a3e96e8` the #221 operator ruling) — plus the
#218 material the redrive-2 text predates entirely. It is a **Ring-2 contract** (ground truths
→ decisions → refusal vocabulary → red-first acceptance pins → open questions): it specifies
behavior; it does not amend implementation in this artifact.

- **Date:** 2026-08-14 (redrive 3)
- **Status:** RED-FIRST CONTRACT — implementation contract v1 (red-first; no code landed for
  this row's issues)
- **Verification HEAD:** `09200e97c1be113946459d901c8fab56034d8a1f`. Every `file:line` citation
  below was re-verified THIS session with `grep -an` / `sed -n` at this HEAD (`grep -an` /
  `sed -n` on `application.mjs` + `coordination-store.mjs` — NUL discipline; plain grep
  elsewhere). Where the redrive-2 text's anchors shifted under `49b42d3`/`a3e96e8`, the
  corrected anchor is cited and the shift is named.
- **Brief:** `foundry-brief.md` + `row-lc-members.md` (this dir) — read fully, including the
  orchestrator's #218 addendum (`row-lc-members.md:13-27`), which is contract law for D4–D6
  below. The issue bodies (`gh issue view 199/200/204/218`) could not be fetched (`gh` is not
  authenticated in this worktree); the requirements are carried by the row brief, the foundry
  frame, and the campaign's incident record (git history + the local evidence dirs), all cited
  inline.
- **Read-order executed.** (1) `foundry-brief.md` (the shared frame — Ring-2 form, attempt-echo,
  no clocks, publish-to-shared); (2) `row-lc-members.md` + its #218 addendum; (3)
  `coordinator-brief.md` (the QA cross-check this contract will receive); (4)
  `lifecycle-contracts.wavefile` (harvest shape — this file must contain `#199`); (5) the prior
  drives' record: `redrive/contract-qa.md` (via git `49b42d3`) and the redrive-2 contract text
  (via git `60c99f4`); (6) the #218/#221 campaign record: git `a3e96e8`, `8f0c112`,
  `bf93263`, `fad6f52`, `e9cc6ed`, `e0dc7bf`, `1a70099`; the telemetry row's brief
  (`impl-telemetry-2026-08-14/redrive1/row-telemetry-brief.md` — the sibling #218 addendum);
  (7) every source anchor below, each re-verified at HEAD this session.
- **Scope of the row, in one sentence:** every member a wave admits becomes durable and typed
  from the first admission decision to terminal — a failed start leaves a store record (not a
  phantom `'failed'`), the member task id carries the wave instance (no cross-wave bind), a
  spawn that waits on a real seat is a LEDGERED waiting state with adapter key, queue position,
  and holders (never 44 silent minutes), every spawn hop is a store-visible transition with a
  seq, waves.run admission names the serialization truth (rows vs ceilings, per adapter), the
  states compose (seat_queued then typed-failed is two records, never a collapse), and the
  resident gains a drain-restart lifecycle that settles in-flight members without killing them.
- **Boundary map (cross-contract — the four share the wave lifecycle).** The LAUNCH row owns
  the wire shape of a member start failure (`startError` on the wire, #173) and the
  objective-cap admission alignment (#207 — the 64 KiB `objectiveRef` admission at
  `workflow-interpreter.mjs:39` vs the 4096-byte `run.objective` cap in `limits.mjs`; the
  mismatch was the phantom-failure root cause filed on #199 by git `1a70099` — this contract
  does NOT re-litigate it, it owns the typed-event consequence). THIS row owns the durable
  store records and the no-phantom guarantee. The FILESYSTEM row owns member
  confinement/settle (#185); THIS row does not amend scope or harvest. The LEDGER row owns
  model-visible-means-logged (#194); THIS row's new records ride the `driver.recorded` /
  task-event families (store-durable, not model-visible ledger rows) — OQ4 pins the seam. The
  TELEMETRY row (#146, `impl-telemetry-2026-08-14/redrive1/row-telemetry-brief.md:26`) owns the
  seat READ surface (per-adapter inFlight/ceiling/seat_queued projection); THIS row owns the
  LEDGERED state that projection reads — this row writes the truth, telemetry surfaces it. The
  receipt-shape law (the settle receipt's EXACTLY-seven keys, F14) is LAUNCH's; D6 below adds a
  key to the ACCEPTANCE receipt (a different, also-closed shape) — flagged as a judgment call,
  not silently.
- **The #221 reconciliation (judgment call, recorded — see DECISION_REQUEST 1).** The
  orchestrator's #218 addendum says "adapter seat ceilings gate spawns INSIDE the adapter
  call." Between the addendum's writing and this drive, the operator ruled on #221 (git
  `a3e96e8`, 2026-08-14): the coordinator's `_dispatchPass` seat-ceiling pre-cap — the
  invented literal that silently queued spawns — was RIPPED OUT; "provider-TRUE backpressure
  (typed 429/rate_limited on the member, #120) is the only queue." This contract honors BOTH:
  `seat_queued` (D4) is a ledgered state minted only when a spawn waits on a REAL constraint —
  an adapter-internal ceiling, a provider capacity answer with retry semantics, or the
  router's real card-ceiling arithmetic — and it is NEVER silent, so it cannot recreate the
  #221 defect class (a synthetic queue with no event). The ruling is cited as ground truth
  (GT17-GT19); the residual silent vector the ruling left behind is GT19 and drives pin A5.

---

## Ground truths (verified at HEAD `09200e9`)

### #199 — member-creation failures emit no durable store record

1. **`createWave` swallows per-member start failures into the in-memory handle.** Each member's
   `baton.runs.start(...)` is wrapped in a per-member `try/catch` that parks the refusal in
   `entry.startError = { code, message }` and still calls `state.members.set(member.role,
   entry)` (`wave.mjs:250-252`). A failed member is a handle entry with `run: null` and an
   in-memory `startError` — nothing is written to the store for the failure.
2. **Both wave-handle reads render the never-started member `phase:'failed'`.** `progress()`
   maps a `!entry.run` member to `{role, phase:'failed', terminalCause:'start', terminal:true,
   attention:null, error: entry.startError, knowledgeDigest:null}` (`wave.mjs:353`); `settle()`
   maps it to `{phase:'failed', terminalCause:'start', terminal:true, narrative:null,
   resultSha:null, error: entry.startError}` (`wave.mjs:472`). The cause rides the handle, but
   only in memory.
3. **The interpreter's receipt drops the cause and reads a bare `'failed'`.** In `runWorkflow`,
   a member with no handle gets `preOutcome.set(role, {phase:'failed', terminal:true,
   resultSha:null})` (`workflow-interpreter.mjs:590`); the receipt's `outcomes` row is built
   from that with no `error` field (`workflow-interpreter.mjs:599-620`), and the settle
   receipt is exactly the seven keys `{basis, harvest, manifestDigest, outcomes, steering,
   verdict, waveId}` in sorted order (`workflow-interpreter.mjs:631-639`). So the `waves.run`
   receipt reads `'failed'` for a member that never existed, with no cause and no store trace —
   the campaign incident's exact shape (git `e3d1598`: "no `task.created`, no capacity
   reservation, a receipt claiming `failed` for a member that never existed").
4. **The store has no member-creation refusal/reservation record kind.** The `_append` kinds in
   `coordination-store.mjs` are the closed set `task.created`/`task.claimed`/
   `task.transitioned`/`task.dispatch_deferred`/`task.acceptance_revoked`/
   `task.resources_released`/`evidence.mapped`/`artifact.registered`/`driver.recorded`
   (envelope for `steering.registered`, `wave.started`, `wave.closed`, …)/
   `authority.rejected`/`fleet.drain_*` — verified by scanning all 102 `this._append('…')`
   call sites; NO `wave.member_*` kind exists. `createTask` appends `task.created` only when a
   task is actually created; a member whose `run.start` throws never reaches it.
5. **Capacity reservation is per-task at dispatch, so a failed member never reserves.**
   `reserveCapacity(taskId, …)` is keyed by taskId in the worker-dispatch path
   (`index.mjs:371-411`); a member with no task performs no reservation. The row brief's "no
   task.created, no reservation, no refusal" is exactly the store truth.
6. **The direct port refuses partial starts typed; the interpreter seam swallows; NEITHER
   leaves a durable record.** `startWave` (the MCP/CLI `waves.start` surface) throws
   `wave_member_invalid` carrying `{actual, cap, cause, role}` on ANY member refusal (the D5.1
   fold, `application.mjs:11769-11785`) and never returns a success shape with a `runs:[null]`
   drain. The interpreter seam (`waves.run` → facade `baton.waves.start` → `createWave`,
   `workflow-interpreter.mjs:549-553`) is the path that swallows (GT1). The #199 asymmetry: the
   TYPED refusal on the direct port is also store-silent — the throw site mints nothing.

### #200 — member task ids exclude the wave namespace; re-drives bind the prior task

7. **The runId digest deliberately excludes the wave namespace.** `start()` derives
   `run-${digest({objective, …explicitResultIntentIdentity, profileDigest, route,
   composition, scope, ownerPrincipalId}).slice(0,32)}` (`application.mjs:3343-3351`) —
   `waveId`, `waveRole`, and `waveStart` are NOT in the digest, and the normalization comment
   states the exclusion is deliberate: "Deliberately NOT folded into intentDigest or runId
   derivation… Same rationale for waveId/waveRole/waveStart below"
   (`application.mjs:1560-1563`). Two waves whose members carry byte-identical objectives
   resolve to the SAME member runId — the cross-wave bind.
8. **The interpreter salts per-invocation, so a re-drive MINTS a fresh run and strands it.**
   `runWorkflow` mints `salt = randomUUID()` per invocation (`workflow-interpreter.mjs:520`)
   and renders `[attempt: ${salt} ${role}] ${objective}` from the member's `objectiveRef` file
   (`workflow-interpreter.mjs:347`, `:519-531`). A re-drive of the SAME spec therefore
   derives different member runIds than the prior drive — the "same-path re-drives bind the
   prior task" of the row brief happens through GT9's resolution, and the campaign's
   workaround was a key+path bump per re-drive (git `fad6f52`: "v17 re-drive packs (key+path
   bumps per #183/#200)"; the earlier content-digest bump, git `e0dc7bf`, was the same
   acknowledgment — "until the derivation includes the wave namespace").
9. **The (waveId, waveRole) → runId resolution is stale-first.** `_runIdForWaveMember` scans
   the `driver.recorded` event log and returns the FIRST `steering.registered` match for
   `(waveId, waveRole)` (`application.mjs:11937-11948`). It is the durable referent for the
   wave surfaces: `waves.list` member reads resolve `runId =
   this._runIdForWaveMember(row.waveId, member)` and inspect THAT run
   (`application.mjs:11872`). A same-key re-drive whose member objective re-mints (a salt or
   content-digest bump) therefore binds the wave surface to the PRIOR run — live or dead —
   while the freshly minted run is orphaned. The row brief's "(live or dead)" is exactly this:
   the resolution never checks the matched run's phase.
10. **The two waveId minting sites disagree on content, compounding the bind.** `createWave`
    mints `wave:${sha256(idempotencyKey).slice(0,32)}` (`wave.mjs:207-208`); `startWave` mints
    `wave:${digest({idempotencyKey, members:[{role, objective}]}).slice(0,32)}`
    (`application.mjs:11740-11743`). A fresh key is a fresh wave on both — but a re-keyed
    re-drive over the same objectives is a NEW logical wave whose members nonetheless resolve
    per GT7-GT9.
11. **`saltObjectives:false` opts into cross-wave run sharing on the driver path.** The
    wave-driver mints a per-`run()` salt and renders `[attempt: ${salt} ${role}]` unless
    `saltObjectives:false` (`wave-driver.mjs:357-363`); with the salt off, identical members
    across waves share the digest — the exact runId collision GT7 makes inevitable. The ritual
    re-drive path deliberately re-attaches via this dedupe (`wave-driver.mjs:378`).
12. **`waves.attach` matches by objective TEXT, not by recomputed runId — so namespacing the
    derivation does not break attach.** The direct port builds `wanted = new Map(members →
    member.objective)` and matches listed runs on objective equality
    (`application.mjs:11477-11489`), then requires each matched run's `_runWaveId(runId) ===
    waveId` (mismatch → `application_wave_member_mismatch`, `application.mjs:11516-11518`).
    The embedded port does the same and refuses `wave_member_not_found` when no run matches
    (`wave.mjs:334`). Neither path recomputes a runId; attach's binding proof is the
    steering-registered waveId — a wave-namespaced derivation is orthogonal to attach.

### #204 — the resident has no drain-restart

13. **The serve lifecycle's shutdown path is `deployment.close()`.** `serveDeployment` runs
    the hosted deployment under `SignalLifecycleOwner({signalEmitter: process, shutdown: ()
    => deployment.close()})` (`impl/scripts/baton.mjs:41-63`) — SIGINT/SIGTERM/SIGHUP call
    `deployment.close()`.
14. **`close()`/`closeAsync()` refuse on active capacity.** `assertCapacityQuiescent()` throws
    `driver_capacity_active` ("use drainAndClose()") when the driver holds capacity
    reservations (`index.mjs:1554-1558`); both close paths call it before closing authority
    (`index.mjs:1563,1578`). Under `SignalLifecycleOwner`, a rejecting shutdown surfaces as
    `application_host_shutdown_failed` with the cause carried (`application-host.mjs:81,190`)
    — so a resident with in-flight waves CANNOT close cleanly on signal.
15. **`drainAndClose()` hard-drains the fleet.** It fences admission (`_drainState =
    'draining'`, `coordinator.mjs:1648,1724`), collects the target workers (pending or owning
    local resources — in-flight wave members included), and runs `_performDrain`
    (`coordinator.mjs:1727`, the machinery at `coordinator.mjs:2770+`) to stop and reap them,
    with `coordinator_drain_incomplete` if the deadline does not converge
    (`index.mjs:1600-1666`). No surface exists that stops admission, waits for in-flight
    members to settle WITHOUT killing them, and then exits cleanly — close refuses, drain
    kills.
16. **The v12→v13 dance is the incident.** "attempt-a phantom-failed into wedged resident v12;
    v13 probe verified member creation healthy" (git `e9cc6ed`). The restart of the wedged
    resident killed in-flight wave work; the row brief's "impl landings force a manual
    restart that kills in-flight waves" is the requirement source.

### #218 — the spawn-wedge: a waiting spawn is not a typed state (addendum scope)

17. **The wedge's mechanism, as ruled.** The coordinator's `_dispatchPass` used to skip a
    dep-satisfied task when `inFlight(vendor) >= card.concurrencyCeiling`, intending to mint a
    durable `task.dispatch_deferred` receipt (issue #10 D5 Arm 1, the store API survives at
    `coordination-store.mjs:13246-13266`). The receipts NEVER minted in production — "zero
    `task.dispatch_deferred` ever" — so the skip was total silence: v16 flooded 24 wave
    launches, 5 materialized, 19 members sat silently pending (the row brief addendum,
    `row-lc-members.md:17`; git `a3e96e8`: "v16: 19 silently-pending members; v17's 'healthy
    window' = exactly the ceiling size"). The member lifecycle never entered a typed state —
    no event, no roster truth, no queue position — for the entire wait.
18. **The #221 operator ruling (landed at this HEAD).** The pre-cap was an "invented literal
    that silently queued spawns ahead of any real provider signal — the phantom/fleet-stall
    wedge's true mechanism." It is RIPPED OUT: `_dispatchPass` now dispatches every
    dep-satisfied pending task (`coordinator.mjs:2917-2925`, the ruling comment in the code);
    "backpressure is provider-TRUE now: a real 429/quota answer arrives as a typed, retried,
    ledgered provider event on the member — never a silent synthetic queue." The
    provider-true refusal path exists and is typed: `resource.provider_turn_refused` /
    `resource.provider_turn_admitted` (`coordinator.mjs:3416,3464`) and
    `_failInitialProviderAdmission` transitions the task `failed` with evidence
    (`coordinator.mjs:3490-3496`). A refused spawn ack is likewise typed:
    `_onSpawnRefused` mints `lifecycle.crashed` with `payload.phase:'spawn'` (or
    `'worktree'`) and a typed code, then fails the task (`coordinator.mjs:4164-4207`).
19. **A residual silent vector survives the ruling: the auto-route ceiling skip.** For an
    auto-routed task, `_resolveVendor` builds per-adapter cards + inFlight counts and calls
    the router; `pick` filters `eligible = candidates.filter((c) => c.inFlight <
    c.concurrencyCeiling)` and returns `null` when every eligible adapter is at ceiling
    (`router.mjs:202-203`, reached via `coordinator.mjs:2989-2990`); `_dispatchPass` then does
    a bare `continue` — the task stays `pending` with NO event of any kind
    (`coordinator.mjs:2920-2921`). This is a REAL card-ceiling wait (the ceilings are
    deployment authority: glm 1→4 by operator policy, git `bf93263`, the deployment override
    at `application-deployment.mjs:862-875`; the adapter defaults at
    `cli-adapters.mjs:221-246,618` and `adapter.mjs:749,771,790`), not an invented pre-cap —
    but it is STILL SILENT: the member has no seat_queued state, no queue position, no
    holders, exactly the v16 shape at one layer deeper.
20. **The spawn hops between `task.claimed` and terminal are not store-visible.** The store
    sees `task.created` (creation) and `task.claimed` (dispatch, `coordinator.mjs:3509-3520`)
    — then nothing until a terminal `task.transitioned`. The intermediate hops live only in
    the coordinator's in-memory worker log: worktree creation (`worktreeSource`/
    `worktreeReady`, `coordinator.mjs:3605-3612,3691-3708` — `worktreeCreationPending` is an
    in-memory flag, not an event), native spawn (`lifecycle.spawned`,
    `coordinator.mjs:3711-3713`), and process readiness (`lifecycle.process_ready`,
    `application-semantics`-adjacent worker-log kinds at `coordinator.mjs:60-62`). These
    reach the store only as `evidence.mapped` digests attached to transitions
    (`coordination-store.mjs:12757-12775`, keyed `evidence:<worker>:<seq>` — 87 `_coordMapEvent`
    call sites, essentially all transition/pause/terminal moments). A member stalled between
    hops is therefore invisible to the store and to every wave surface that reads it — "a
    stall is a named state with a seq" is not yet true anywhere.
21. **The waiting vocabulary already reserves the words — but nothing mints them.**
    `WAITING_ON_KINDS` is the closed additive wait vocabulary on the run view
    (`application-semantics.mjs:59-61`): `capacity_ceiling`, `dispatch_pending`,
    `plan_approval`, `provider_stalled`, `spawning`. Post-#221 the suites were restaged so
    "no `capacity_ceiling` projection [comes] from a pre-cap — the class survives for
    provider-true signals" (git `a3e96e8`): the kind exists, the projection seam exists, and
    at HEAD there is NO producer for `capacity_ceiling` waitingOn on any true signal. The
    addendum's seat_queued is this class, made durable.
22. **Admission names no serialization truth.** The `waves.run` detach acceptance receipt is
    the closed sorted shape `{accepted, manifestDigest, members, schemaVersion, verdict,
    waveId}` (`workflow-interpreter.mjs:643-652`) — member ROLES only. The wavefile's
    per-member `harness`/`model` rows are known at admission (`admitSpec`), and the
    deployment's per-adapter inFlight/ceiling read already exists
    (`application-deployment.mjs:1392-1401`, `#occupancyFor`), so the serialized-vs-parallel
    truth ("4 deepseek rows on 4 seats") is computable at admission — but no surface names
    it. The launcher learned the v16 serialization only after 44 silent minutes
    (`row-lc-members.md:23-25`).
23. **The roster reads steering-registered bindings, so a not-yet-dispatched member is
    indistinguishable from a stuck one.** `waves.list` hydrates each member from
    `_runIdForWaveMember` → `inspect(runId)` (`application.mjs:11865-11880`); a member whose
    task waits (GT19) or stalls (GT20) shows only the run's coarse phase, never the spawn
    stage or seat truth. The telemetry row's lived phrasing: "19 members silently pending
    behind the deepseek ceiling while the roster showed nothing"
    (`impl-telemetry-2026-08-14/redrive1/row-telemetry-brief.md:26-27`).

---

## Decisions

### D1 — Member-creation outcomes are durable and typed (the #199 phantom is deleted)

**Every member admitted to a wave settles to exactly one durable store record, minted at the
member-creation boundary — the same site that already decides a member's run.start outcome.**
On a successful start the existing `steering.registered` run-binding record is minted,
unchanged (`application.mjs:4657-4669`). On a failed start a NEW record kind is minted:

- **Kind:** `wave.member_start_failed`, a `driver.recorded` kind value — the same event family
  as `steering.registered` (`application.mjs:135`) and `wave.started` — store-durable,
  replay-visible, no per-command MCP surface row required (the `wave_registry_invalid`
  posture).
- **Payload:** `{waveId, role, code, message}` with the inner refusal code preserved
  (`cause.code` — a profile/quota admission code, `spill_body_exceeded`, an `application_*`
  code). `message` is the member's own refusal message.
- **Exactly-once:** the mint dedups on a stable key (the `recordDriver` idempotency
  discipline, `coordination-store.mjs:13242-13248`), so a retry never double-mints.
- **Timing:** minted BEFORE the member entry settles into the wave handle — the same
  "a driver dying mid-loop leaves members discoverable" argument that motivated
  `steering.registered`'s pre-loop mint (`application.mjs:4670-4686`). A driver that dies the
  moment a member start refuses still leaves the record durable.

Both member-creation surfaces emit it: the interpreter seam (`createWave`,
`wave.mjs:250-252`) mints the record at the catch site, and the direct port (`startWave`,
`application.mjs:11769-11785`) mints it for the refused member BEFORE throwing
`wave_member_invalid` (the waveId is derived from the request at `application.mjs:11740-11743`,
so it is available before the throw — OQ1 names the siblings question).

**No wave surface renders `phase:'failed'` for a member whose failure has no durable record.**
The `'failed'` outcome a driver observes — on the wave handle (`progress`/`settle`,
`wave.mjs:353,472`) or on the interpreter receipt (`workflow-interpreter.mjs:590,599-620`) — is
always backed by a `wave.member_start_failed` record correlatable by `{waveId, role}`. The
LAUNCH row owns whatever cause additionally reaches the wire; the store record is this row's
guarantee.

### D2 — Member task ids are wave-namespaced and the (waveId, waveRole) resolution is non-stale (the #200 bind is deleted)

**D2.1 — the member runId derivation folds in the wave instance.** When a run is minted with a
wave binding (`intent.waveId` present), the runId digest (`application.mjs:3343-3351`) folds in
`intent.waveId`. Two distinct logical waves (different `idempotencyKey`) with byte-identical
member objectives resolve to DISTINCT member tasks. Ordinary non-wave runs are unchanged (the
digest folds the wave namespace only when it is present). The deliberate-exclusion comment
(`application.mjs:1560-1563`) is amended for wave-driven runs: the wave namespace is part of
what a wave-driven run IS. Attach is unaffected — it matches by objective TEXT and the
steering-registered binding proof (GT12), never by a recomputed runId. The ritual re-drive
path (`wave-driver.mjs:378`, `saltObjectives:false` re-attach via runId dedupe) keeps its
semantics: same-key + same-objective dedupes idempotently even with the namespace folded in,
because both drives derive the same (waveId, objective) pair.

**D2.2 — the (waveId, waveRole) → runId resolution is by LATEST registration, never
stale-first.** `_runIdForWaveMember` (`application.mjs:11937-11948`) returns the LAST
`steering.registered` match for `(waveId, waveRole)` instead of the first. A same-key
re-drive whose member objective re-mints (the per-invocation interpreter salt, GT8; a
content-digest bump) resolves the wave surfaces (`waves.list`/`waves.progress`/
`waves.send`/`waves.stop`, `application.mjs:11872`) to its OWN latest run — the fresh run is
never orphaned and the prior run is never silently re-bound as the wave's member referent.
(The prior run remains individually inspectable by runId; it is simply no longer the wave's
member referent.)

**D2.3 — same-key re-drives stay idempotent or refuse typed; they never mint unreachable
runs.** With D2.1, a same-key re-drive whose member objective is byte-identical dedupes to the
existing run (idempotent resume). A same-key re-drive of a TERMINAL wave keeps the existing
`wave_already_terminal` refusal (`application.mjs:11715-11732`). The one case resolution alone
cannot satisfy — a live wave whose members are already bound and whose re-drive would mint a
second, unreachable run — refuses typed (`wave_member_task_collision`, below) rather than
minting the orphan. No path mints a member run the wave surface cannot reach.

### D3 — The resident gains a drain-restart lifecycle (the #204 dance is deleted)

**The deployment gains a closed drain-restart lifecycle verb distinct from `close()` /
`closeAsync()` (which refuse on active capacity, GT14) and from `drainAndClose()` (which
hard-drains, GT15).** The verb sequences three phases:

1. **Fence admission.** New wave starts refuse typed while drain-restart is in progress (the
   same fence posture `coordinator.drain()` already uses: `_drainState = 'draining'`,
   `coordinator.mjs:1648,1724`).
2. **Wait for in-flight members to settle — without killing them.** The lifecycle waits on the
   event-driven terminal transitions of the in-flight members (the store's terminal phases),
   not a new wall clock; it does NOT stop/reap the member workers the way `_performDrain` does
   (`coordinator.mjs:1727,2770+`). The work product of every in-flight member persists in the
   store.
3. **Exit with a restart receipt.** The process exits 0 with a closed typed restart receipt
   naming the fenced admission window (an event-seq boundary — no clocks) and the settled
   member set. After relaunch, the deployment is open to new waves again.

The refusal vocabulary below names the closed failure codes. The lifecycle is surfaced on the
transports the resident already serves (the signal path through `impl/scripts/baton.mjs:41-63`)
and does not amend the web/MCP command tables.

### D4 — `seat_queued` is a first-class LEDGERED member waiting state (the #218 silent pend is deleted; the #221 ruling is honored)

**A member whose spawn does not proceed immediately enters the ledgered `seat_queued` state,
minted the moment the wait begins — never a silent pend.** The record:

- **Kind:** `task.seat_queued` (a task-lane event, sibling of the dead `task.dispatch_deferred`
  API at `coordination-store.mjs:13246-13266` — the shape is right, the mint trigger was
  wrong), exactly-once per (taskId, wait episode) by idempotency key.
- **Payload:** `{taskId, adapter, queuePosition, holdingMemberIds, ceiling, inFlight}` — the
  addendum's named truth (`row-lc-members.md:19-20`): which adapter key the spawn waits on,
  the member's position in that wait, and the member ids holding the seats. `ceiling` and
  `inFlight` are MINT-TIME frozen (the D5-Arm-1 discipline).
- **Producers — REAL constraints only, per the #221 ruling (GT18):** (a) an adapter-internal
  ceiling wait (the spawn entered the adapter call and the adapter holds it); (b) a provider
  capacity answer with retry semantics (the typed 429/quota event class, #120); (c) the
  auto-route card-ceiling arithmetic (GT19 — the residual silent `continue` at
  `coordinator.mjs:2920-2921`). An invented coordinator-side pre-cap that queues spawns ahead
  of any real signal is FOREVER ILLEGAL (`a3e96e8`); `seat_queued` differs from the pre-cap
  precisely in that the wait is real AND named.
- **Resolution:** the episode ends in exactly one way — the seat is granted (the spawn
  proceeds; the grant is the next spawn-stage event, D5) or the member fails typed (D1 or the
  provider-true refusal path, GT18). A `seat_queued` episode that ends in failure leaves BOTH
  records (the wait AND the typed terminal); they are distinct events with distinct kinds and
  are never collapsed into a bare `failed`.

**The `waitingOn` projection reads the ledger.** The run-view `waitingOn` kind
`capacity_ceiling` (`application-semantics.mjs:59-61` — the class the #221 restaging preserved
"for provider-true signals", GT21) is derived from the `task.seat_queued` record — the
telemetry row's seat surface (`impl-telemetry-2026-08-14/redrive1/row-telemetry-brief.md:26`)
reads the same ledger rows for its per-adapter queue projection. One truth, two readers; the
boundary is this row WRITES it, telemetry PROJECTS it.

### D5 — Every spawn hop is a store-visible member transition with a seq (a stall is a named state)

**The member's spawn pipeline mints a store-visible transition event at every hop —
reservation → worktree → native spawn → ready — each with a store seq.** Today the store sees
`task.created` and `task.claimed` and then nothing until terminal (GT20); the hops live in the
worker log and reach the store only as transition-attached `evidence.mapped` digests
(`coordination-store.mjs:12757-12775`). The contract:

- **Hop events:** `task.seat_reserved` (the `reserveCapacity` receipt lands, `index.mjs:371`),
  `task.worktree_ready` (the checkout confirms, `coordinator.mjs:3605-3612`), `task.spawned`
  (the native spawn dispatches, mirroring `lifecycle.spawned`,
  `coordinator.mjs:3711-3713`), `task.process_ready` (the provider process is ready). A hop
  that REFUSES keeps the existing typed terminal paths (`_onSpawnRefused` →
  `lifecycle.crashed` phase `spawn`/`worktree`, `coordinator.mjs:4164-4207`;
  `_failInitialProviderAdmission` → provider-turn failure, `coordinator.mjs:3489-3496`) — the
  refusal is a transition WITH evidence, and now also a hop-lane terminal so the stage
  sequence cannot dangle.
- **Stall = a named state with a seq:** a member's spawn stage is the LAST hop event's kind +
  seq. A stall is derivable exactly ("member X at `task.worktree_ready` seq N with no
  successor"), surfacing on the wave roster member read (GT23), and it is a WAITING state —
  `waitingOn` kind `spawning` (`application-semantics.mjs:61`) rides the same events. No new
  wall clock is introduced; liveness remains the #67 watchdog's evidence discipline.
- **Anti-phantom ordering:** hop events are minted AFTER the hop's physical effect is true
  (the reservation exists, the checkout exists, the child exists) — never an aspirational
  pre-mark, so a crashed coordinator cannot leave a hop event whose effect never happened.

### D6 — Admission names the serialization truth at admission time (the launcher stops discovering it after 44 silent minutes)

**`waves.run`'s acceptance receipt (and `waves.start`'s response) names the per-adapter
serialization arithmetic the roster implies.** At admission the spec's member routes are known
(`admitSpec`) and the deployment's per-adapter `{inFlight, concurrencyCeiling}` read exists
(`application-deployment.mjs:1392-1401`); the acceptance therefore carries a closed
`serialization` array, one row per adapter with member rows: `{adapter, rows, ceiling,
inFlight, estOrder}` — the addendum's phrasing: "4 deepseek rows on 4 seats: serialized, est.
order …" (`row-lc-members.md:23-25`). `estOrder` is the admission-time queue position
projection (event-seq order, no clocks). The receipt stays honest under change: the row is
admission-time truth (frozen), and the LIVE truth is the D4 ledger — the two are labeled as
such (admission estimate vs ledger fact), never conflated.

**Judgment call (recorded):** the settle receipt's EXACTLY-seven-key law (F14,
`workflow-interpreter.mjs:631-639`) is untouched; the NEW key lands on the ACCEPTANCE shape
(`workflow-interpreter.mjs:643-652`), which is a different closed set owned jointly with the
LAUNCH row — the fold stage must reconcile the key-set change there (boundary map, above).

### D-composition — the states distinguish, never collapse

A member's lifecycle is now fully sequenced and typed: `admitted` (steering-registered, or
`wave.member_start_failed`) → `seat_reserved` → `worktree_ready` → `spawned` →
(`seat_queued` ⇄ seat granted, zero or more episodes) → `process_ready` → … → terminal. The
composition laws: (1) `seat_queued` is a WAITING state — it never renders `failed` and never
substitutes for a typed failure; (2) a member may be `seat_queued` AND later fail typed — both
records exist, both are readable, the roster shows the terminal cause WITH the wait history;
(3) a member that fails at creation (D1) never enters the spawn pipeline at all — its only
record is `wave.member_start_failed`; the phantom and the pend are two distinct deletions.

---

## Refusal vocabulary

**Closed, typed, surface-constant** — the same code, and where a refusal carries detail, the
same detail shape, on embedded throw, MCP `structuredContent.error`, web body, and CLI
`body.error` + exit (the #114 pinned-accessor law; the MCP `stateFailureCode` allowlist,
`mcp-northbound.mjs:215-223,266-269`).

Existing, reused unchanged:

| Code | Where | Meaning |
|---|---|---|
| `wave_member_invalid` | `application.mjs:11773-11785` (D5.1) | A direct-port member start refusal — ANY start refusal (profile/quota, `spill_body_exceeded`, `application_*`); the wave is never a success shape. Already MCP-allowlisted. Unchanged; D1 adds the pre-throw record mint |
| `wave_already_terminal` | `application.mjs:11715-11732` (#183) | A same-key `waves.start` whose wave is already terminal refuses, naming `{priorWaveId, verdict}` + re-key next action. Unchanged; D2.3 builds on it |
| `application_wave_member_mismatch` | `application.mjs:11516-11518` | `waves.attach` matched a run bound to another wave (or none). Unchanged; attach's binding proof |
| `wave_attach_unknown_wave` | `application.mjs:11521-11523` | Attach bound no members of the asserted wave. Unchanged |
| `wave_member_not_found` | `wave.mjs:334` | Embedded attach matched no run for a member objective. Unchanged |
| `driver_capacity_active` | `index.mjs:1554-1558` | `close()`/`closeAsync()` with active reservations. Unchanged — the refusal D3's surface must make unnecessary for the restart path |
| `coordinator_drain_incomplete` | `index.mjs:1600-1666` | `drainAndClose()` did not converge before its deployment deadline. Unchanged — the hard-drain path D3 distinguishes from |
| `application_host_shutdown_failed` | `application-host.mjs:81,190` | `SignalLifecycleOwner` shutdown authority rejected. Unchanged — the current serve-exit shape on signal-with-active-capacity |
| `worktree_unavailable` / `authentication_required` / typed provider codes | `coordinator.mjs:4164-4207` (`_onSpawnRefused`), `coordinator.mjs:3489-3496` | A refused spawn ack / provider-turn admission refusal — already typed and ledgered with evidence. Unchanged; D5 keeps them as the hop-lane terminals |

New, introduced by this contract:

| Code / kind | Where | Meaning |
|---|---|---|
| `wave.member_start_failed` (record kind) | member-creation boundary, both surfaces (D1) | The durable member-creation-failure record: a `driver.recorded` kind value, payload `{waveId, role, code, message}` with the inner refusal code preserved, exactly-once, minted before the member settles. Store-integrity only — no per-command MCP surface row |
| `wave_member_task_collision` | same-key live-wave re-drive (D2.3) | A same-key re-drive whose members are already bound and whose objective re-mint would create an unreachable second run refuses typed (naming `{waveId, role, priorRunId}`) instead of minting the orphan. MCP-allowlisted like `wave_member_invalid` |
| `task.seat_queued` (record kind) | the wait site, producers per D4 | The ledgered seat-wait record: payload `{taskId, adapter, queuePosition, holdingMemberIds, ceiling, inFlight}`, mint-time frozen, exactly-once per wait episode. Ends only in seat-granted (next hop event) or a typed failure — never a silent pend |
| `task.seat_reserved` / `task.worktree_ready` / `task.spawned` / `task.process_ready` (record kinds) | the spawn hops (D5) | Store-visible hop transitions, minted after the physical effect is true, each with a seq; the spawn stage of a member is the last hop's kind + seq |
| `wave_admission_fenced` | the drain-restart fence (D3) | A `waves.start`/`waves.run` arriving while drain-restart is in progress refuses typed, naming `{phase:'drain-restart'}` + the fenced event-seq boundary — the D3 admission fence's wire shape |
| `drain_restart_incomplete` | the drain-restart settle bound (D3, OQ3) | If drain-restart carries a settle bound and it does not converge, the restart fails with this typed receipt rather than killing members (the no-kill law is absolute) |

---

## Red-first acceptance pins

Each pin is RED at HEAD at a named stage and GREEN only for a correct impl — a wrong impl
that merely papered over the failure shape must still fail.

- **A1 — durable member-start record (D1).** *Stage: `member-start-record-absent`.* **Red at
  HEAD:** via the interpreter seam (`waves.run` over `createWave`,
  `workflow-interpreter.mjs:549-553`), a wave whose member's `run.start` refuses (a
  profile/quota admission refusal) yields a receipt whose member outcome reads `phase:'failed'`
  (`workflow-interpreter.mjs:590,599-620`) AND the store has ZERO events attributable to that
  member — no `task.created`, no capacity reservation, no `wave.member_*` record (the
  `_append` kind set has no member-creation refusal kind, GT4). **Green only for:** the same
  run mints exactly one `wave.member_start_failed` record (payload `{waveId, role, code,
  message}` with the inner refusal code preserved), exactly-once, BEFORE the member entry
  settles into the handle; and the receipt's `phase:'failed'` outcome is backed by the record
  (correlate by `{waveId, role}`) — never a phantom. **Anti-shallow:** asserting only that the
  receipt carries a cause is NOT green — the record must be in the store (close/reopen the
  store over the same logDir and replay), and the direct port (`waves.start` via `startWave`)
  must ALSO mint the record for the refused member before throwing `wave_member_invalid`.
- **A2 — wave-namespaced member task id (D2.1).** *Stage: `task-id-not-wave-namespaced`.*
  **Red at HEAD:** with `saltObjectives:false` (`wave-driver.mjs:357-363`), two waves with
  DIFFERENT `idempotencyKey` and BYTE-IDENTICAL member objectives resolve the member to the
  SAME runId — one shared task for two logical waves (the digest excludes `waveId`,
  `application.mjs:3343-3351` + the deliberate-exclusion comment at `:1560-1563`). **Green
  only for:** the member runId derivation folds in the wave instance when the intent carries a
  wave binding — the two waves resolve to DISTINCT member tasks; a non-wave ordinary
  `run.start` is byte-unchanged; `waves.attach` still binds by objective TEXT + the
  steering-registered proof (`application.mjs:11477-11519`). **Anti-shallow:** a test that
  changes the runId by salting the objective is NOT green — the pin drives
  `saltObjectives:false`, so the derivation itself must carry the namespace.
- **A3 — non-stale (waveId, waveRole) → runId resolution (D2.2).** *Stage:
  `stale-first-member-resolution`.* **Red at HEAD:** a same-key live-wave re-drive whose member
  objective re-mints (the per-invocation interpreter salt, GT8) mints a fresh run AND the wave
  surface resolves `_runIdForWaveMember(waveId, role)` to the FIRST `steering.registered`
  (`application.mjs:11937-11948`) — `waves.list`/`waves.progress`/`waves.send`/`waves.stop`
  target the PRIOR run (live or dead — the resolution never checks phase, GT9) while the fresh
  run is orphaned. **Green only for:** the resolution is by LATEST registration — the
  re-drive's surface binds its own run — OR a same-key live-wave re-drive whose members are
  already bound refuses `wave_member_task_collision` naming `{waveId, role, priorRunId}` before
  minting the unreachable second run. `wave_already_terminal` is unchanged for terminal waves.
  **Anti-shallow:** asserting only that the fresh run EXISTS is NOT green — the pin asserts
  which run the WAVE SURFACE binds.
- **A4 — drain-restart lifecycle (D3).** *Stage: `drain-restart-absent`.* **Red at HEAD:**
  with an in-flight wave (active capacity reservations), the resident's serve lifecycle has NO
  graceful restart — `close()`/`closeAsync()` refuse `driver_capacity_active`
  (`index.mjs:1554-1578`, surfacing as `application_host_shutdown_failed`,
  `application-host.mjs:81`), and `drainAndClose()` hard-drains the fleet (the fence + stop/reap,
  `coordinator.mjs:1648,1724-1727,2770+`; `index.mjs:1600-1666`) — a manual restart either
  fails or kills the in-flight members (the v12→v13 dance, GT16). **Green only for:** a
  drain-restart surface exists that (a) fences new wave admission — a `waves.start` during
  drain-restart refuses `wave_admission_fenced`, (b) waits for the in-flight members to reach
  a terminal phase WITHOUT killing them — work product persists in the store, no member worker
  is stopped/reaped, (c) exits 0 with a closed typed restart receipt naming the fenced
  event-seq window and the settled member set, and (d) after relaunch the deployment admits
  new waves again. **Anti-shallow:** a surface that merely swallows `driver_capacity_active`
  and exits 0 is NOT green — (a), (b), and (d) are asserted, so a kill-or-refuse restart stays
  red.
- **A5 — ledgered seat_queued (D4).** *Stage: `seat-wait-silent`.* **Red at HEAD:** an
  auto-routed member task whose only eligible adapters are all at their real card ceiling
  stays `pending` with NO store event — `_dispatchPass`'s bare `continue`
  (`coordinator.mjs:2920-2921` via `router.mjs:202-203`), the v16 shape one layer deeper
  (GT19); likewise an adapter-internal wait mints nothing. The member has no queue position,
  no holders, no roster truth — and `task.dispatch_deferred` remains at zero productions
  (GT17). **Green only for:** the wait mints exactly one `task.seat_queued` record carrying
  `{taskId, adapter, queuePosition, holdingMemberIds, ceiling, inFlight}` (mint-time frozen),
  readable by the roster member view and the telemetry seat projection; the episode ends only
  in seat-granted (the next hop event) or a typed failure; and re-introducing any coordinator
  pre-cap that queues ahead of a real signal is a FAILURE of this pin (the #221 law is
  asserted in the negative). **Anti-shallow:** minting a bare event without the payload truths
  (position + holders) is NOT green — the addendum's named fields are the point; and a
  synthetic wait where the provider would have answered is NOT green.
- **A6 — store-visible spawn hops (D5).** *Stage: `spawn-stage-silent`.* **Red at HEAD:**
  between `task.claimed` and terminal, the store shows NO hop events for a member — the
  worktree/spawn/ready hops live only in the worker log (GT20) and reach the store as
  transition-attached `evidence.mapped` digests (`coordination-store.mjs:12757-12775`); a
  member stalled at the worktree hop is indistinguishable on every wave surface from one never
  dispatched (GT23). **Green only for:** each hop mints its store event (`task.seat_reserved`,
  `task.worktree_ready`, `task.spawned`, `task.process_ready`) AFTER the physical effect is
  true, each with a seq; a member's spawn stage reads as the last hop's kind + seq on the
  roster; and a hop-refusal keeps the existing typed terminals (`lifecycle.crashed`
  phase `spawn`/`worktree`; provider-turn failure) so no stage sequence dangles.
  **Anti-shallow:** minting hop events aspirationally (before the effect) is NOT green — the
  pin crashes the coordinator between effect and mint expectation and requires the event to
  trail the effect, never lead it.
- **A7 — admission-time serialization honesty (D6).** *Stage:
  `admission-serialization-silent`.* **Red at HEAD:** a `waves.run` spec with 4 member rows on
  one adapter whose ceiling is 4 while 0 seats are free admits with the closed acceptance
  `{accepted, manifestDigest, members, schemaVersion, verdict, waveId}`
  (`workflow-interpreter.mjs:643-652`) — roles only, no per-adapter rows-vs-ceiling arithmetic,
  no estimated order; the launcher discovers the serialization only through the (now-removed)
  silence (GT22; the addendum's "44 silent minutes", `row-lc-members.md:25`). **Green only
  for:** the acceptance (and `waves.start`'s response) carries the closed `serialization`
  array — one row per adapter `{adapter, rows, ceiling, inFlight, estOrder}` — computed from
  the admission-time spec routes + the deployment occupancy read
  (`application-deployment.mjs:1392-1401`), labeled admission-time estimate, with the D4
  ledger named as the live truth. **Anti-shallow:** a row that names only the adapter counts
  without `estOrder` is NOT green — the launcher must learn the estimated ORDER at admission;
  and a live-count masquerading as admission truth is NOT green (the two are labeled).

---

## Fold-record-ready pin list

| Pin | Stage (RED at HEAD) | Decision | Green only for | Anti-shallow |
|---|---|---|---|---|
| A1 | `member-start-record-absent` | D1 | one `wave.member_start_failed` store record per failed member, exactly-once, before the member settles, on BOTH the seam and the direct port | store replay proves durability; receipt-cause-only is not green |
| A2 | `task-id-not-wave-namespaced` | D2.1 | the member runId folds in the wave instance; two distinct-key waves with byte-identical objectives get distinct tasks; attach unchanged | driven at `saltObjectives:false` — the derivation, not the salt, carries the namespace |
| A3 | `stale-first-member-resolution` | D2.2 | latest-registration resolution (or the typed `wave_member_task_collision` refusal) — the re-drive's surface binds its own run | asserts which run the wave surface binds, not merely that a fresh run exists |
| A4 | `drain-restart-absent` | D3 | fences admission (`wave_admission_fenced`), waits without killing, exits 0 with a typed restart receipt (event-seq window), reopens after relaunch | swallowing `driver_capacity_active` and exiting 0 is not green — (a)(b)(d) asserted |
| A5 | `seat-wait-silent` | D4 | `task.seat_queued` with `{adapter, queuePosition, holdingMemberIds, ceiling, inFlight}` at every REAL wait; ends only seat-granted or typed-failed; no synthetic pre-cap ever | payload-less mint is not green; a synthetic wait where the provider would answer is not green |
| A6 | `spawn-stage-silent` | D5 | hop events minted after the physical effect, each with a seq; stage = last hop on the roster; hop-refusals stay typed terminals | aspirational pre-marking is not green — the event trails the effect |
| A7 | `admission-serialization-silent` | D6 | acceptance carries `serialization` rows `{adapter, rows, ceiling, inFlight, estOrder}`, admission-frozen, ledger named as live truth | counts without estOrder not green; live-count-as-admission-truth not green |

---

## Judgment calls (recorded per the frame's law)

1. **The #221 reconciliation (D4).** The addendum predates the ruling; read literally
   ("adapter seat ceilings gate spawns INSIDE the adapter call") it could be taken to
   re-legitimize a coordinator-side ceiling queue. This contract reads them as composing: the
   ruling kills SYNTHETIC waits, the addendum demands REAL waits be LEDGERED. If the operator
   reads the addendum instead as "the adapter call itself must block-and-queue internally,"
   D4's producer set changes shape (the wait moves into the adapter) but the record contract
   is unchanged.
2. **`task.seat_queued` as a task-lane event, not a `driver.recorded` kind.** D1's failure
   record rides `driver.recorded` (wave-scoped, no task exists yet); D4's wait record rides
   the task lane (a task exists — it was created and claimed). This split follows the store's
   existing family discipline; the alternative (everything under `driver.recorded`) was
   rejected because the wait is a property of the TASK's dispatch, and the dead
   `deferTaskDispatch` API already chose the task lane for exactly this shape.
3. **The acceptance-receipt key addition (D6).** The F14 seven-key law belongs to the SETTLE
   receipt; the acceptance receipt is a separate closed set. Adding `serialization` to the
   acceptance (not the settle) minimizes the shape change — but the LAUNCH row owns receipt
   shapes, so the fold must reconcile there (recorded in the boundary map, not silently).
4. **Auto-route ceiling arithmetic as a legal `seat_queued` producer.** The #221 ruling
   ripped the PRE-CAP but left `router.pick`'s eligible filter (`router.mjs:202-203`) — a
   REAL card-ceiling gate that is currently silent (GT19). This contract makes it a producer
   rather than deleting it, because the ceilings are deployment authority (the glm 1→4 policy
   flip, `bf93263`, shows they encode real provider limits). Deleting the filter instead
   (always dispatch, provider-true backpressure) would also satisfy the no-silence law — the
   fold stage may choose it, provided pin A5's green condition holds either way (no silent
   pend, whatever mechanism).

## DECISION_REQUEST entries (authority-class ambiguity; no bus verb in this harness — recorded
here for the orchestrator, per the redrive QA's precedent)

1. **DR1 — who owns the spawn-pipeline event family?** The hop events (D5) and `seat_queued`
   (D4) are coordinator/store seams the TELEMETRY row (#146) also touches (its seat
   projection reads the same rows) and the KERNEL-honesty audits (#169,
   `kernel-honesty-2026-08-13`) have previously claimed. **Options:** (a) this row's impl wave
   lands the event family, telemetry reads it (the boundary map's default); (b) a shared
   store-layer wave lands the family, this row lands only the member-creation record (D1) and
   the roster/stage reads; (c) split — `task.seat_queued` here (member lifecycle), hop events
   in a coordinator-scoped row. **Default taken:** (a), because the addendum assigns the
   member-state semantics to this contract.
2. **DR2 — D6's key-set change vs the LAUNCH row's receipt pins.** If the LAUNCH row's
   contract pins the acceptance key set as frozen, D6 as written contradicts it. **Options:**
   (a) `serialization` joins the acceptance key set (this contract's default, with the fold
   reconciling LAUNCH's pin); (b) serialization truth rides an existing key's payload (e.g.
   under `members` rows — no key-set change); (c) it is a separate admission receipt verb.
   **Default taken:** (a); (b) is the fallback if LAUNCH's freeze is load-bearing.

## Open questions

- **OQ1 — the direct port's sibling trace (D1).** `startWave` throws on the FIRST member
  refusal and never returns the wave; the contract pins the refused member's record (the
  waveId exists pre-throw, `application.mjs:11740-11743`). Whether NON-refused members of the
  same partial wave also need a durable trace at the throw site is left to the impl — their
  runs exist and are steering-registered, so the store is not silent about them.
- **OQ2 — latest-first vs the typed collision refusal (D2.2/D2.3).** Latest-first is
  self-healing; the typed refusal is more honest about a driver error (a live wave should
  rarely be re-minted). The contract names latest-first the default and the refusal the
  admissible alternative; the impl wave picks one and the QA checks it.
- **OQ3 — the drain-restart settle bound (D3).** Unbounded-until-settle vs borrowing the
  hard-drain's deadline policy (failing with `drain_restart_incomplete` rather than killing).
  The contract pins the no-kill law and the typed-failure shape; the bound is impl policy.
- **OQ4 — the LEDGER row's visibility doctrine (D1/D4/D5).** The new records ride the
  task/driver event families (store-durable). If #194's model-visible-means-logged doctrine is
  read to cover ALL store records, this row's records and the LEDGER row overlap at
  visibility; this contract keeps them out of the model-visible ledger and defers to that row.
- **OQ5 — `estOrder` under concurrent admission (D6).** Two waves admitted in the same window
  compute orders from the same occupancy snapshot; the orders are ESTIMATES by construction.
  Whether the admission row also names the competing waveIds (so a launcher can distinguish
  "serialized behind my own rows" from "behind another wave") is an impl refinement.
- **OQ6 — hop events and store growth (D5).** Four new event kinds per member multiply the
  ledger; the #210 read-path rewrite (`49b42d3`) was itself a ledger-scale remediation. The
  impl wave should measure the eventsView read cost at campaign fleet scale (the WLS-1
  bounded-read discipline) before landing D5 unbounded.

---

## Publish

Deliverable written to
`docs/reference/evidence/lifecycle-contracts-2026-08-14/redrive3/contract-members.md`; full
text published to `redrive3/shared/contract-members.md` (the `shared` publish, inside this
dispatch's `redrive3/**` write scope — the same confinement the redrive QA recorded at
`redrive/contract-qa.md:160-166`).
