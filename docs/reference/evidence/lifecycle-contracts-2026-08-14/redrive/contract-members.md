# Package ③ members contract — the member-creation honesty contract (re-drive)
[attempt: a8f2584a-3282-4825-b1d0-5aa4a6b69067 row-lc-members]

The implementation contract for the wave-lifecycle package (③)'s MEMBER-CREATION row: issue
#199 (member-creation failures emit no durable store record — the receipt reads `'failed'` for
members that never existed), issue #200 (member task ids derive from the objective without the
wave namespace — same-path re-drives bind the prior task, live or dead), and issue #204 (the
resident has no drain-restart — impl landings force a manual restart that kills in-flight waves,
the v12→v13 dance). This is the **re-drive** of the row's deliverable: the first dispatch died
mid-flight before writing its contract, so this artifact lives at `redrive/contract-members.md`
(the dispatch's work-only path), not the pre-dispatched row-brief path. It is a **Ring-2
contract** (ground truths → decisions → refusal vocabulary → red-first acceptance pins → open
questions): it **specifies behavior**; it does not amend implementation in this artifact. It
cross-references — it does not re-specify — the wave-observability lane's wave machinery
(`wave-observability-2026-08-06/wave-observability-contract.md`), the #129 run-less-wave witness
(`dropped-features-2026-08-06/SYNTHESIS.md:100-106`), the #74 seat-map discipline, and the #114
pinned-accessor law (`workflow-as-data-contract.md:203-207`).

- **Date:** 2026-08-14 (re-drive)
- **Status:** RED-FIRST CONTRACT — implementation contract v1 (red-first; no code landed for this
  row's issues)
- **Verification HEAD:** `1ff83353d7dc068ebdb87d1909f83fe80cee6b0b` ("Baton private effective-tree
  snapshot"). Every `file:line` citation below was re-verified THIS session with `grep -an` /
  `sed -n` at this HEAD (`grep -an`/`sed -n` on `application.mjs` + `coordination-store.mjs` —
  NUL discipline; plain grep elsewhere).
- **Brief:** `foundry-brief.md` and `row-lc-members.md` (the foundry pack, same package dir) and
  the dispatched brief — read fully. The issue bodies (`gh issue view 199/200/204`) could not be
  fetched (`gh` is not authenticated in this worktree); the requirements are carried by the row
  brief, the foundry frame, and the campaign's incident record below.
- **Read-order executed.** (1) `foundry-brief.md` (the shared frame — Ring-2 form, attempt-echo,
  no clocks, publish-to-shared); (2) `row-lc-members.md` (the objective brief — the three issues);
  (3) `coordinator-brief.md` (the QA cross-check the four contracts will receive); (4) the
  `lifecycle-contracts.wavefile` (harvest shape); (5) the campaign incident record
  (`workflow-dsl-2026-08-13/suite-addendum-notes.md`, the foundry-commit history); (6) the sibling
  model contract (`wave-observability-2026-08-06/wave-observability-contract.md`); (7) every source
  anchor below (each re-verified at HEAD this session).
- **Scope of the row, in one sentence:** the member-creation boundary gains a durable, typed
  record for every member-start outcome (the #199 phantom is deleted), the member task id gains
  the wave-instance namespace and a non-stale (waveId, role) → runId resolution (the #200
  cross-wave bind is deleted), and the resident deployment gains a drain-restart lifecycle that
  stops admission, waits for in-flight members to settle without killing them, and exits with a
  restart receipt (the #204 restart dance is deleted).
- **Boundary map (cross-contract, the four share the wave lifecycle).** The LAUNCH row owns the
  wire shape of a member start failure (`startError on the wire`, #173) and the objective-cap
  admission alignment (#207); THIS row owns the durable store record and the no-phantom-'failed'
  guarantee. The FILESYSTEM row owns member confinement/settle (#185); THIS row does not amend
  scope or harvest. The LEDGER row owns model-visible-means-logged (#194); THIS row's new
  `wave.member_start_failed` record is a store record, not a model-visible ledger row — it rides
  the `driver.recorded` event family, exactly like `wave.started` and `steering.registered`, and
  is therefore in scope here, not there.

- **Shared-publish note (the shared post is ABSENT — VERIFIED impossible, with evidence).** The
  foundry frame requires publishing this contract to the `shared` scratchpad partition
  (`foundry-brief.md:23`), but NO surface verb to write a scratchpad note exists in this tree —
  the missing verb is issue #158, whose contract
  (`scratchpad-write-2026-08-13/scratchpad-write-contract.md`) is itself a draft artifact, not an
  implementation. Re-verified at HEAD this session: CLI surfaces only `run.scratchpad.read` /
  `run.scratchpad.elevate` (`application-cli.mjs:1483-1515`); MCP surfaces only
  `baton_scratchpad_elevate|settle` / `baton_run_scratchpad_read|elevate`
  (`mcp-northbound.mjs:107-117,599-609`); the registry lists read/elevate/settle only
  (`application-semantics.mjs:1338,1465,1476,1692,1701`); the web surface has NO scratchpad verb.
  The ONLY writer is the coordinator handling a live worker session's internal `scratchpad.write`
  event (`coordinator.mjs:13003-13013`, `claude-session.mjs:1146`) — unreachable from this
  filesystem worktree, and the store kernel (`coordination-store.mjs:14064-14086`) demands the
  live auth + idempotency envelope. The coordinator's brief provides the documented fallback for
  exactly this case: read the durable files where the shared post is absent and note which
  (`coordinator-brief.md:12`). This file is that fallback; the shared post is recorded as ABSENT
  (this note is the "which").

---

## Ground truths (verified at HEAD `1ff8335`)

### #199 — member-creation failures emit no durable store record

1. **`createWave` swallows per-member start failures into the in-memory handle.** Each member's
   `baton.runs.start(...)` is wrapped in a per-member `try/catch` that parks the refusal in
   `entry.startError = { code, message }` and still calls `state.members.set(role, entry)`
   (`wave.mjs:234-253`). A failed member is therefore a handle entry with `run: null` and an
   in-memory `startError` — nothing is written to the store.
2. **Both wave-handle reads render the never-started member `phase:'failed'`.** `progress()` maps a
   `!entry.run` member to `{role, phase:'failed', terminalCause:'start', terminal:true,
   attention:null, error: entry.startError, knowledgeDigest:null}` (`wave.mjs:350-354`); `settle()`
   maps it to `{role, phase:'failed', terminalCause:'start', terminal:true, narrative:null,
   resultSha:null, error: entry.startError}` (`wave.mjs:468-473`). The cause rides the handle, but
   only in memory.
3. **The interpreter's receipt drops the cause and reads a bare `'failed'`.** In `runWorkflow`, a
   member with no handle gets `preOutcome.set(role, {phase:'failed', terminal:true,
   resultSha:null})` (`workflow-interpreter.mjs:580-582`); the receipt's `outcomes` row is built
   from that with no `error` field (`workflow-interpreter.mjs:599-615`), and the receipt is exactly
   the seven keys `{basis, harvest, manifestDigest, outcomes, steering, verdict, waveId}`
   (`workflow-interpreter.mjs:625-633`). So the `waves.run` receipt reads `'failed'` for a member
   that never existed, with no cause and no store trace — the campaign incident's exact wording
   (`suite-addendum-notes.md:5`).
4. **The store has no member-creation refusal/reservation record kind.** The `_append` kinds in
   `coordination-store.mjs` are the closed set: `task.created`/`task.claimed`/`task.transitioned`/
   `wave.started`(as `driver.recorded`)/`wave.closed`/`authority.rejected`/`fleet.drain_*`/… — no
   `wave.member_*` kind exists (verified by scanning every `this._append('…')` call site).
   `createTask` appends `task.created` only when a task is actually created (`coordination-store.mjs:12417-12442`);
   a member whose `run.start` throws never reaches it.
5. **Capacity reservation is per-task at dispatch, so a failed member never reserves.** `reserveCapacity`
   is keyed by `taskId` and runs in the worker-dispatch path (`index.mjs:371-411`); a member with no
   task performs no reservation. The row brief's "no task.created, no reservation, no refusal" is
   exactly the store truth.
6. **The direct port refuses partial starts; the interpreter seam swallows.** `startWave`
   (`application.mjs:11730-11772`) — the MCP/CLI `waves.start` surface — throws
   `wave_member_invalid` carrying `{actual, cap, cause, role}` on ANY member refusal (the D5.1
   fold, `application.mjs:11744-11756`) and never returns a success shape with a `runs:[null]`
   drain. The interpreter seam (`waves.run` → facade `baton.waves.start` →
   `createWave`, `workflow-interpreter.mjs:549-553`) is the path that swallows. The #199
   asymmetry is that the DURABLE record is absent on BOTH paths: the direct port refuses typed but
   leaves no store event, and the seam swallows and leaves no store event.
7. **The campaign's incident record.** Four foundry attempts at the #170 addendum suite "died to
   the member-creation silence (#199/#200 — no `task.created`, no capacity reservation, a receipt
   claiming `failed` for a member that never existed)" (`suite-addendum-notes.md:5`); the
   phantom-failure root cause was filed as the 64KiB objectiveRef admission vs 4KiB run.start
   admission mismatch (`git 1a70099`). This contract does NOT re-litigate the cap mismatch — the
   LAUNCH row owns #207; here the durable-record gap is the contract.

### #200 — member task ids exclude the wave namespace; re-drives bind the prior task

8. **The runId digest deliberately excludes the wave namespace.** `start()` derives
   `run-${digest({objective, …explicitResultIntentIdentity, profileDigest, route, composition,
   scope, ownerPrincipalId}).slice(0,32)}` (`application.mjs:4539-4547`) — `waveId`, `waveRole`,
   and `waveStart` are NOT in the digest, and the normalization comment states the exclusion is
   deliberate: "Deliberately NOT folded into intentDigest or runId derivation… Same rationale for
   waveId/waveRole/waveStart below" (`application.mjs:1558-1561`). Two waves whose members carry
   byte-identical objectives therefore resolve to the SAME member runId — the cross-wave bind.
9. **The waveId itself is key-derived, not content-derived.** `createWave` mints
   `wave:${sha256(idempotencyKey).slice(0,32)}` (`wave.mjs:204-207`); `startWave` mints
   `wave:${digest({idempotencyKey, members:[{role, objective}]}).slice(0,32)}`
   (`application.mjs:11717-11720`). A fresh key is a fresh wave; a re-keyed re-drive over the same
   objective is a NEW logical wave that nonetheless computes the same member runId as the prior
   wave (GT8).
10. **The (waveId, waveRole) → runId resolution is stale-first.** `_runIdForWaveMember` scans the
    `driver.recorded` event log and returns the FIRST `steering.registered` match for
    `(waveId, waveRole)` (`application.mjs:11889-11899`). It is the durable referent for the wave
    surfaces: `waves.list` member reads resolve `runId = this._runIdForWaveMember(row.waveId, role)`
    and inspect THAT run (`application.mjs:11845-11853`). A same-key re-drive whose member objective
    re-mints (a content-digest bump) therefore binds the wave surface to the PRIOR run while the
    freshly minted run is orphaned.
11. **`saltObjectives:false` opts into cross-wave run sharing.** The wave-driver mints a per-`run()`
    salt and renders `[attempt: ${salt} ${role}] ${objective}` unless `saltObjectives:false`
    (`wave-driver.mjs:359-376`); with the salt off, identical members across waves share the digest
    — the exact runId collision GT8 makes inevitable. The workaround the campaign actually used was
    a content-digest bump to mint a fresh member task, "until the derivation includes the wave
    namespace" (`git e0dc7bf`) — the workaround is the bug's acknowledgment.
12. **`waves.attach` matches by objective TEXT, not by recomputed runId — so namespacing the
    derivation does not break attach.** The direct port `attachWave` builds `wanted = new Map(members
    → member.objective)` and matches listed runs on `item.objective` equality
    (`application.mjs:11477-11486`), then requires each matched run's `_runWaveId(runId) === waveId`
    (mismatch → `application_wave_member_mismatch`, `application.mjs:11494-11507`). The embedded
    `attachWave` (wave.mjs) does the same over `baton.runs.list()` (`wave.mjs:295-301`). Neither
    path recomputes a runId from the objective; the attach binding proof is the steering-registered
    waveId, so a wave-namespaced derivation is orthogonal to attach.

### #204 — the resident has no drain-restart

13. **The serve lifecycle's shutdown path is `deployment.close()`.** `serveDeployment` runs the
    hosted deployment under `SignalLifecycleOwner({signalEmitter: process, shutdown: () =>
    deployment.close()})` (`impl/scripts/baton.mjs:42-63`) — SIGINT/SIGTERM/SIGHUP call `deployment.close()`.
14. **`close()`/`closeAsync()` refuse on active capacity.** `assertCapacityQuiescent()` throws
    `driver_capacity_active` ("use drainAndClose()") when the driver holds capacity reservations;
    both `close()` and `closeAsync()` call it before closing authority (`index.mjs:1554-1587`).
    Under `SignalLifecycleOwner`, a rejecting shutdown surfaces as `application_host_shutdown_failed`
    with the cause carried (`application-host.mjs:80-86`) — so a resident with in-flight waves
    CANNOT close cleanly on signal.
15. **`drainAndClose()` hard-drains the fleet.** It drives `coordinator.drain()`, which fences
    synchronously (`_drainState = 'draining'`, `coordinator.mjs:1724`), collects the target workers
    (pending or owning local resources — in-flight wave members included), and runs `_performDrain`
    to stop and reap them (`coordinator.mjs:1724-1757`, the stop/cancel/reap machinery at
    `coordinator.mjs:1758-1831`), with `coordinator_drain_incomplete` if the deadline does not
    converge (`index.mjs:1600-1666`).
16. **The v12→v13 dance is the incident.** "attempt-a phantom-failed into wedged resident v12; v13
    probe verified member creation healthy" (`git e9cc6ed`). The restart of the wedged resident
    killed in-flight wave work; the row brief's "impl landings force a manual restart that kills
    in-flight waves" is the requirement source. No surface exists that stops admission, waits for
    in-flight members to settle, and then exits cleanly — close refuses, drain kills.

---

## Decisions

### D1 — Member-creation outcomes are durable and typed (the #199 phantom is deleted)

**Every member admitted to a wave settles to exactly one durable store record, minted at the
member-creation boundary — the same site that already decides a member's run.start outcome.** On a
successful start the existing `steering.registered` run-binding record is minted, unchanged
(`application.mjs:4654-4667`). On a failed start a NEW record kind is minted:

- **Kind:** `wave.member_start_failed`, a `driver.recorded` kind value — the same event family as
  `wave.started` (`application.mjs:140`) and `steering.registered` (`application.mjs:135`), so it
  is store-durable, replay-visible, and requires no per-command MCP surface row (the
  `wave_registry_invalid` posture, `wave-observability-contract.md` §D2.3).
- **Payload:** `{waveId, role, code, message}` with the inner refusal code preserved
  (`cause.code` — e.g. a profile/quota admission code or `spill_body_exceeded`). `message` is the
  member's own refusal message.
- **Exactly-once:** the mint dedups on a stable key (the `recordDriver` discipline,
  `coordination-store.mjs:1497-1498`), so a retry never double-mints.
- **Timing:** the record is minted BEFORE the member entry settles into the wave handle — the same
  "a driver dying mid-loop leaves members discoverable" argument that motivated
  `steering.registered`'s pre-loop mint (`application.mjs:4667-4686`). A driver that dies the
  moment a member start refuses still leaves the record durable.

Both member-creation surfaces emit it: the interpreter seam (`createWave`, `wave.mjs:234-253`),
which currently swallows the error into `entry.startError`, mints the record at the catch site; the
direct port (`startWave`, `application.mjs:11730-11772`), which currently throws
`wave_member_invalid` on the first refusal, mints the record for the refused member before
throwing.

**No wave surface renders `phase:'failed'` for a member whose failure has no durable record.** The
`'failed'` outcome a driver observes — on the wave handle (`progress`/`settle`, `wave.mjs:350-354,
468-473`) or on the interpreter receipt (`workflow-interpreter.mjs:580-582`) — is always backed by
a `wave.member_start_failed` record correlatable by `{waveId, role}`. The in-memory-only phantom is
the defect; the receipt may (and the LAUNCH row owns the wire shape) additionally surface the
cause, but the store record is this row's guarantee.

### D2 — Member task ids are wave-namespaced and the (waveId, waveRole) resolution is non-stale (the #200 bind is deleted)

**D2.1 — the member runId derivation folds in the wave instance.** When a run is minted with a wave
binding (`intent.driverKind === 'wave'`, `intent.waveId` present), the runId digest
(`application.mjs:4539-4547`) folds in `intent.waveId`. Two distinct logical waves (different
`idempotencyKey`) with byte-identical member objectives resolve to DISTINCT member tasks. Ordinary
non-wave runs are unchanged (the digest folds the wave namespace only when it is present). The
deliberate-exclusion comment (`application.mjs:1558-1561`) is amended for wave-driven runs: the
wave namespace is part of what a wave-driven run IS. Attach is unaffected — it matches by objective
TEXT and the steering-registered binding proof (GT12), never by a recomputed runId.

**D2.2 — the (waveId, waveRole) → runId resolution is by LATEST registration, never stale-first.**
`_runIdForWaveMember` (`application.mjs:11889-11899`) returns the LAST `steering.registered` match
for `(waveId, waveRole)` instead of the first. A same-key re-drive whose member objective re-mints
(a content-digest bump, `git e0dc7bf`) resolves the wave surface (`waves.list` member reads,
`application.mjs:11845-11853`) to its OWN latest run — the fresh run is never orphaned and the
prior run is never silently re-bound as the wave's member referent. (The prior run remains
individually inspectable by runId; it is simply no longer the wave's member referent.)

**D2.3 — same-key re-drives stay idempotent or refuse typed; they never mint unreachable runs.**
With D2.1, a same-key re-drive whose member objective is byte-identical dedupes to the existing run
(idempotent resume). A same-key re-drive whose member objective re-mints resolves to its own run by
D2.2. A same-key re-drive of a TERMINAL wave keeps the existing `wave_already_terminal` refusal
(`application.mjs:11695-11709`). The one case that cannot be satisfied by resolution alone — a live
wave whose members are already bound and whose re-drive would mint a second, unreachable run —
refuses typed (`wave_member_task_collision`, below) rather than minting the orphan. No path mints a
member run that the wave surface cannot reach.

### D3 — The resident gains a drain-restart lifecycle (the #204 dance is deleted)

**The deployment gains a closed drain-restart lifecycle verb that is distinct from `close()` /
`closeAsync()` (which refuse on active capacity) and from `drainAndClose()` (which hard-drains).**
The verb sequences three phases:

1. **Fence admission.** New wave starts are refused typed while drain-restart is in progress (the
   same fence posture `coordinator.drain()` already uses: `_drainState = 'draining'`,
   `coordinator.mjs:1724`).
2. **Wait for in-flight members to settle — without killing them.** The lifecycle waits on the
   event-driven terminal transitions of the in-flight members (the store's terminal phases), not a
   new wall clock; it does NOT stop/reap the member workers the way `_performDrain` does
   (`coordinator.mjs:1724-1757`). The work product of every in-flight member persists in the store.
3. **Exit with a restart receipt.** The process exits 0 with a closed typed restart receipt naming
   the fenced admission window and the settled member set. After relaunch, the deployment is open
   to new waves again.

The refusal vocabulary below names the closed failure codes. The lifecycle is surfaced on the same
transports the resident already serves (signal path through `impl/scripts/baton.mjs:42-63`); it does not
amend the web/MCP command tables (the byte-stable command-table key set pinned by grammar-m3-red is
untouched). The restart receipt is clock-free: the fenced window is an event-seq boundary, and the
settled set is the store's terminal-phase set — the #114 no-clocks discipline.

---

## Refusal vocabulary

**Closed, typed, surface-constant** — the same code, and where a refusal carries detail, the same
detail shape, on embedded throw, MCP `structuredContent.error`, web body, and CLI `body.error` +
exit (the #114 W6 pinned-accessor law; the MCP `stateFailureCode` allowlist, `mcp-northbound.mjs:204-220`).

Existing, reused unchanged:

| Code | Where | Meaning |
|---|---|---|
| `wave_member_invalid` | `application.mjs:11744-11756` (D5.1) | A direct-port member start refusal — ANY start refusal (profile/quota, `spill_body_exceeded`, `application_*`); the wave is never a success shape. Already MCP-allowlisted (`mcp-northbound.mjs:220`). Unchanged |
| `wave_already_terminal` | `application.mjs:11695-11709` (#183) | A same-key `waves.start` whose wave is already terminal refuses, naming `{priorWaveId, verdict}` + re-key next action. Unchanged; D2.3 builds on it |
| `application_wave_member_mismatch` | `application.mjs:11494-11507` | `waves.attach` matched a run bound to another wave (or none). Unchanged; attach's binding proof |
| `wave_attach_unknown_wave` / `wave_attach_proof_required` | `application.mjs:11486-11489`, `wave.mjs:283,341` | Attach bound no members / attach lacks the server-side binding proof. Unchanged |
| `wave_member_not_found` | `wave.mjs:334` | Embedded attach matched no run for a member objective. Unchanged |
| `driver_capacity_active` | `index.mjs:1554-1574` | `close()`/`closeAsync()` with active reservations. Unchanged — the refusal D3's surface must make unnecessary for the restart path |
| `coordinator_drain_incomplete` | `index.mjs:1600-1666`, `coordinator.mjs:1724-1757` | `drainAndClose()` did not converge before its deployment deadline. Unchanged — the hard-drain path D3 distinguishes from |
| `application_host_shutdown_failed` | `application-host.mjs:80-86` | `SignalLifecycleOwner` shutdown authority rejected. Unchanged — the current serve-exit shape on signal-with-active-capacity |

New, introduced by this contract:

| Code | Where | Meaning |
|---|---|---|
| `wave.member_start_failed` (record kind) | member-creation boundary, both surfaces (D1) | The durable member-creation-failure record: a `driver.recorded` kind value, payload `{waveId, role, code, message}` with the inner refusal code preserved, exactly-once. Store-integrity only — no per-command MCP surface row (the `wave_registry_invalid` posture) |
| `wave_member_task_collision` | same-key live-wave re-drive (D2.3) | A same-key re-drive whose members are already bound and whose objective re-mint would create an unreachable second run refuses typed (naming `{waveId, role, priorRunId}`) instead of minting the orphan. MCP-allowlisted like `wave_member_invalid` |

---

## Red-first acceptance pins

Each pin is RED at HEAD at a named stage and GREEN only for a correct impl — a wrong impl that
merely papered over the failure shape must still fail.

- **A1 — durable member-start record (D1).** *Stage: `member-start-record-absent`.* **Red at HEAD:**
  via the interpreter seam (`waves.run` over `createWave`, `workflow-interpreter.mjs:549-553`), a
  wave whose member's `run.start` refuses (a profile/quota admission refusal) yields a receipt whose
  member outcome reads `phase:'failed'` (`workflow-interpreter.mjs:580-582,599-615`) AND the store
  has ZERO events attributable to that member — no `task.created`, no capacity reservation, no
  `wave.member_*` record (the `_append` kind set has no member-creation refusal kind, GT4).
  **Green only for:** the same run mints exactly one `wave.member_start_failed` record (a
  `driver.recorded` kind value, payload `{waveId, role, code, message}` with the inner refusal code
  preserved), exactly-once (stable-key dedup), BEFORE the member entry settles into the handle; and
  the receipt's `phase:'failed'` outcome for that member is backed by the record (correlate by
  `{waveId, role}`) — never a phantom. **Anti-shallow:** asserting only that the receipt carries a
  cause is NOT green — the record must be in the store (close/reopen the store over the same logDir
  and replay, the F6 replay-exactness posture), and the direct port (`waves.start` via
  `startWave`) must ALSO emit the record for a refused member before throwing `wave_member_invalid`.
- **A2 — wave-namespaced member task id (D2.1).** *Stage: `task-id-not-wave-namespaced`.* **Red at
  HEAD:** with `saltObjectives:false` (`wave-driver.mjs:359-376`), two waves with DIFFERENT
  `idempotencyKey` and BYTE-IDENTICAL member objectives resolve the member to the SAME runId — one
  shared task for two logical waves (the runId digest excludes `waveId`, `application.mjs:4539-4547,
  1558-1561`). **Green only for:** the member runId derivation folds in the wave instance when the
  intent carries a wave binding — the two waves resolve to DISTINCT member tasks; a non-wave
  ordinary `run.start` is byte-unchanged; `waves.attach` still binds by objective TEXT + the
  steering-registered proof (`application.mjs:11477-11507`). **Anti-shallow:** a test that changes
  the runId by salting the objective is NOT green — the pin drives `saltObjectives:false`, so the
  derivation itself must carry the namespace.
- **A3 — non-stale (waveId, waveRole) → runId resolution (D2.2).** *Stage:
  `stale-first-member-resolution`.* **Red at HEAD:** a same-key live-wave re-drive whose member
  objective re-mints (a content-digest bump, `git e0dc7bf`) mints a fresh run AND the wave surface
  resolves `_runIdForWaveMember(waveId, role)` to the FIRST `steering.registered`
  (`application.mjs:11889-11899`) — `waves.list`/`waves.progress`/`waves.send`/`waves.stop` target
  the PRIOR run while the fresh run is orphaned. **Green only for:** the resolution is by LATEST
  registration — the re-drive's surface binds its own run — OR a same-key live-wave re-drive whose
  members are already bound refuses `wave_member_task_collision` naming `{waveId, role, priorRunId}`
  before minting the unreachable second run. The `wave_already_terminal` path
  (`application.mjs:11695-11709`) is unchanged for terminal waves. **Anti-shallow:** asserting only
  that the fresh run EXISTS is NOT green — the pin asserts which run the WAVE SURFACE binds.
- **A4 — drain-restart lifecycle (D3).** *Stage: `drain-restart-absent`.* **Red at HEAD:** with an
  in-flight wave (active capacity reservations), the resident's serve lifecycle has NO graceful
  restart — `close()`/`closeAsync()` refuse `driver_capacity_active` (`index.mjs:1554-1587`,
  surfacing through `SignalLifecycleOwner` as `application_host_shutdown_failed`,
  `application-host.mjs:80-86`), and `drainAndClose()` hard-drains the fleet (the fence + stop/reap
  at `coordinator.mjs:1724-1757`, `index.mjs:1600-1666`) — so a manual restart either fails or kills
  the in-flight members (the v12→v13 dance, `git e9cc6ed`). **Green only for:** a drain-restart
  surface exists that (a) fences new wave admission — a `waves.start` during drain-restart refuses
  typed, (b) waits for the in-flight members to reach a terminal phase WITHOUT killing them — their
  work product persists in the store and no member worker is stopped/reaped, (c) exits 0 with a
  closed typed restart receipt, and (d) after relaunch the deployment admits new waves again.
  **Anti-shallow:** a surface that merely swallows `driver_capacity_active` and exits 0 is NOT green
  — (a), (b), and (d) are asserted, so a kill-or-refuse restart stays red.

---

## Fold-record-ready pin list

The pins in fold-record form (one row each; the impl wave records GREEN only when a correct impl
lands — a wrong impl must stay RED):

| Pin | Stage (RED at HEAD) | Decision | Green only for | Anti-shallow |
|---|---|---|---|---|
| A1 | `member-start-record-absent` | D1 | a `wave.member_start_failed` store record per failed member, exactly-once, before the member settles, on both the seam and the direct port | store replay (F6 posture); direct port also emits |
| A2 | `task-id-not-wave-namespaced` | D2.1 | the member runId folds in the wave instance; two distinct-key waves with byte-identical objectives get distinct tasks | driven at `saltObjectives:false`, so the derivation itself must carry the namespace |
| A3 | `stale-first-member-resolution` | D2.2 | latest-registration resolution (or the typed `wave_member_task_collision` refusal) — the re-drive's surface binds its own run | asserts which run the wave surface binds, not merely that a fresh run exists |
| A4 | `drain-restart-absent` | D3 | drain-restart fences admission, waits without killing, exits 0 with a restart receipt, reopens after relaunch | swallowing `driver_capacity_active` and exiting 0 is not green — (a)(b)(d) asserted |

---

## Open questions

- **OQ1 — the direct port's record mint ordering (D1).** `startWave` throws `wave_member_invalid`
  on the FIRST member refusal and never returns the wave. The contract requires the record to be
  minted "for the refused member before throwing" — but the waveId is derived from the request
  (`application.mjs:11717-11720`), so the record's `waveId` is available before the throw. The open
  question is whether NON-refused members of the same partial wave also need a durable trace at the
  throw site (the wave never returned) — the contract pins only the refused member's record and
  leaves the siblings to the idempotency-key dedupe.
- **OQ2 — D2.2's latest-resolution vs the typed refusal.** The contract allows EITHER latest-first
  resolution OR the `wave_member_task_collision` refusal for the live-wave re-mint case. Latest-first
  is self-healing (the re-drive binds its own run); the typed refusal is more honest about a
  driver error (a live wave should rarely be re-minted). This is an authority-class choice — the
  contract names latest-first as the default and the refusal as the admissible alternative; the
  impl wave should pick one and the QA should check it.
- **OQ3 — the drain-restart settle bound (D3).** The contract requires waiting for in-flight members
  to settle "without a new wall clock" and without killing them. The existing hard-drain carries a
  deployment-deadline policy (`coordinator_drain_incomplete`). Whether drain-restart borrows the
  same policy (a deadline that fails the restart with a typed receipt rather than killing) or is
  unbounded-until-settle is a policy decision for the impl row — the contract pins the no-kill and
  the typed-failure shape, not the bound.
- **OQ4 — boundary with the LEDGER row (#194).** `wave.member_start_failed` is a `driver.recorded`
  store record, not a model-visible ledger row. If the LEDGER row's "model-visible-means-logged"
  doctrine is read to cover ALL store records, the two contracts overlap at the record's visibility;
  this contract keeps it in the `driver.recorded` family (invisible to the model) and defers to the
  LEDGER row for the visibility question.
