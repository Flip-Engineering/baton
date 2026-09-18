# Reincarnation in place: one deployment, a succession of incarnations (issue #306)

Design direction: 2026-09-18, sub-orchestrator seat kimi-306. Stage: `landed` — the
implementation lanes landed on master the same day: ds-306a (the verb, master `809341b3`,
contribution-06f99c82f8a14b50eaee4b1e395fb6a8) and ds-306b (the advisories and wake class,
master `6bc66bcb`, contribution-3308797739faa1c7f08c6dc5aa1a4d66), with the web-admission
wiring lane ds-306w landing behind them. Where the landing diverges from the design below, §11
is the authoritative record. The pin file
`impl/test/issue306-reincarnation-red.test.mjs` was observed 14/14 red at HEAD 1a830bfe as a
red-before skeleton and then moved to the landed truth (the 374aa9d8 precedent): it now pins
this document's sections against the landed implementation and is 15/15 green on master
`34c557d4`. The lane suites (`impl/test/issue306a-*.test.mjs`, `impl/test/issue306b-*.test.mjs`)
pin the mechanics.

Evidence this design answers (the root's, 2026-09-18):

- **Every landing forces a manual restart dance.** The operator's loop is "land → restart both
  residents → recruit the next wave". Today's restart of the primary took 229 s and failed its
  own shutdown (#450); its reopen replayed 161 931 rows for 65 s because the stop never wrote a
  checkpoint (#449).
- **A resident restart loses its workers.** Seat workers are child processes of the resident on
  stdio pipes (impl/src/omp-rpc.mjs, impl/src/coordinator.mjs worker lifecycle); every lane on a
  resident must be stopped first, and the successor finds them through #364's
  `swarm.participant_runtime_lost` reconciliation.
- **Lanes recruited hours after a landing start on a stale base** and need a hand-written rebase
  note. The recruit receipt already carries a first `baseBehind` (swarm-runtime.mjs
  `_baseBehind`); this design makes it a typed advisory with a named remedy.

## 0. Rules that do not change

These rules from the landed corpus bind every mechanism below; this design extends them, never
exceptions them:

- **Publication order (#288): never two publications, never none.** The connection authority is
  one file tuple (selector + profile, resident-authority.mjs `ResidentAuthority.publish`) moved
  atomically; the handoff below is ordered so a reader at every instant resolves exactly one
  incarnation.
- **One derivation per fact.** The served commit and the behind count already have ONE
  derivation — `servedRevision` / `servedTarget` / `servedRow` (application-deployment.mjs),
  frozen at open (`#served`) and re-read fresh per call. The doctor, the recruit advisory, the
  wake frame header (`servedWakeFact`, #316 c) and the swarm outline all read it; the
  reincarnation verb changes what it answers, never adds a second derivation.
- **One writer, one lease.** The coordination ledger has exactly one writer, fenced by
  `claimWriterLease` / `releaseWriterLease` (coordination-store.mjs); a premature claimant sees
  `coordination_writer_busy`. The handoff moves the lease; it never shares it.
- **The stop is already staged and recorded (#351).** `STOP_STAGES` and the
  `host.stop_requested` / `host.stop_waiting` / `host.stopped` rows are the vocabulary a
  reincarnation reuses for its drain and its exit; the tail past the writer's authority is
  narrated in the same shape (`#sayStopTail` precedent), never silently dropped.
  Since #472 that vocabulary includes the workers the old incarnation STOPPED WAITING ON:
  `host.stopped` carries them as their own `abandoned: [{workerId, attempt, alive}]` list beside
  `released` (never inside it, empty and never absent), and a stop that abandons one still mints
  that row — which is what lets a handoff whose old incarnation gave up on a wedged worker record
  how it ended instead of exiting without an outcome.
- **A death is typed and settled (#364, #442).** Workers the successor cannot control are found
  by the startup reconstruction and folded ONCE as `swarm.participant_runtime_lost`; this design
  keeps that row as the one reading of "the seat's runtime died with the old incarnation".
- **Every bound derives from the limits registry** (impl/src/limits.mjs, Decision 8's
  no-re-declare law). The new rows this design names are listed in §9 with their derivations.
- **No unsolicited network on read paths.** The doctor never fetches; `servedTarget` counts from
  the refs the repository holds NOW. The fetch below happens only inside the reincarnate VERB,
  which the operator invoked.

## 1. The incarnation model

The vocabulary already exists; #306 gives it a succession rule.

- **Deployment id is stable.** `stableDeploymentId` (resident-authority.mjs) names the durable
  deployment across processes; the state directory (`.git/baton/application-v3/state` under the
  deployment root) and the coordination ledger belong to it, not to any process.
- **Incarnation id is per process.** Every resident start mints `incarnation:
  instance-${randomUUID()}` when it acquires the resident lease (resident-authority.mjs); it is
  published in the connection profile, embedded in the socket path, echoed by the doctor's
  `application.resident` row, and carried on every wake frame's resident subject. Clients
  already refuse a stale incarnation (`resident_incarnation_mismatch`, retryable).
- **Served commit is per incarnation.** `#served` freezes `servedRevision(repoRoot)` at open:
  the code running is the code that was loaded, whatever the checkout does afterwards. A
  reincarnation is the ONE operation that changes the served commit a live deployment answers —
  by ending one incarnation and starting the next at the target.

So: **a reincarnation is an ordered succession — a new incarnation over the same deployment id,
state directory, and participant population — not a new deployment and not an in-place code
swap.** The old process keeps serving until the successor has replayed and published; then it
withdraws and exits. "The resident" an operator talks to is the deployment; which incarnation
answers is the fact the incarnation id already carries.

## 2. The handoff protocol

`deployment.reincarnate {target}` (application command; CLI spellings `baton deployment
reincarnate <commit-ish>` and `baton serve --reincarnate <commit-ish>`, both sent to the RUNNING
resident). Permission: organize/owner. The verb is a REQUEST, not a block: it answers after step
1 with a receipt `{reincarnation: {target, from, state: 'draining'}}` — an in-flight turn can be
minutes long, and a verb that waited for the whole handoff would hold its caller hostage to the
drain. Progress rides the durable rows below and the wake feed (§5); completion is
`host.reincarnated`, failure is `host.reincarnation_failed`, and the caller that wants to wait
follows the wake class. Every step names its durable row; rows are recorded
through the same `#stopRecord` → `recordDriver` path the #351 stop rows use, idempotency-keyed
per reincarnation attempt, so a repeated request under one key replays and a new attempt mints a
new key.

0. **Pre-effect refusals (§6).** Nothing is recorded, nothing changes, the answer names why.
1. **Request.** The target resolves through the git authority: a `git fetch` of the
   deployment's configured remote if the commit-ish is unreachable locally, then `rev-parse`.
   The old incarnation records, synchronously and before any other effect (the
   `recordStopRequested` precedent):
   `host.reincarnation_requested {target: {sha, ref}, from: {incarnation, commit}, at}`.
2. **Admission closes.** The existing #351 admission gate closes to NEW turns; the resident
   keeps serving reads, watches, and in-flight turns. This is the drain-restart of #204 in
   place: a one-shot harness seat's IN-FLIGHT turn completes on the old incarnation.
3. **Drain.** The old incarnation waits for in-flight turns, each wait a
   `host.stop_waiting {on, ids, at}` row in the existing shape. The wait is bounded by the
   deployment's declared drain policy, exactly as a signal stop is.
4. **Successor spawned.** `node scripts/baton.mjs serve` starts over the same deployment, in a
   checkout at the target sha — when the checkout IS the resident's serving directory and no
   worker holds it (#428 custody), `git checkout --detach <sha>` moves it and the successor
   serves the same directory; the environment carries `BATON_PREDECESSOR_INCARNATION` naming the
   old incarnation. The spawn rides an injection seam — deployment option
   `advanced.reincarnation.spawn({cwd, sha, predecessorIncarnation, env})` answering a child
   handle `{pid, exit, stderrTail}` — so unit rows drive a stub successor and never spawn a real
   second resident; production serves the real command. The old incarnation records
   `host.successor_started {pid, incarnation, at}` — the LAST row it writes with the lease held.
5. **Lease handoff.** The old incarnation releases the coordination writer lease
   (`releaseWriterLease`) — the release mints the old incarnation's `host.stopped` through the
   existing arming seam (`armHostStopOutcome`) with `state: 'reincarnating'`, so the #351
   machinery, not a new path, says how this incarnation ended. The successor's
   `claimWriterLease` waits on the lease's own bounded
   poll (new registry rows, §9) instead of refusing `coordination_writer_busy` at once. From
   here the old incarnation writes no more rows; its remaining narration rides the #351
   say-the-tail channel.
6. **Successor opens and publishes.** The successor adopts the state directory, replays (or
   opens the #449 checkpoint), runs its startup reconstruction — which folds the old
   incarnation's seats as `swarm.participant_runtime_lost` exactly as after any restart — takes
   the resident authority lease (the ordinary stale-lease recovery reclaims the old
   incarnation's if it died), and PUBLISHES: the connection selector and profile move to the
   new incarnation atomically (#288). It records `host.successor_published {incarnation, pid,
   commit, at}`.
7. **Old withdraws and exits.** The old incarnation polls the published connection's
   incarnation field (the deployment's existing publication read; bound from the registry) until
   it names the successor AND the successor's lease owner is alive. Then it withdraws its own
   listeners and profile remnants and exits 0 through the #351 stop path (web drain, fleet
   drain with nothing to drain, close) — its stages past the writer authority narrated in the
   `host.stopped tail` vocabulary.
8. **Settlement recorded by the successor.** Observing the old process gone (the lease-owner
   liveness primitive resident-authority.mjs already uses) and the old publication withdrawn,
   the successor records the two closing rows:
   `host.publication_withdrawn {incarnation: <old>, at}` and
   `host.reincarnated {from: {incarnation, commit}, to: {incarnation, commit}, at}`.
   The old incarnation cannot write these — it no longer holds the writer lease — so the
   successor records them as OBSERVATIONS of the old incarnation's acts; the wake feed maps
   `host.reincarnated` to the `incarnation_changed` class (§5).

Crash analysis — what each step leaves behind:

- **Crash after 1, before 4:** the ledger names the request and the closed admission; the
  admission gate is in-memory, so the process's death ends it. The next open (an ordinary
  restart or a retried reincarnate) replays `host.reincarnation_requested` with no successor
  rows — an interrupted attempt, visible on the doctor. Part 1 does not auto-resume a half
  handoff (§8); the operator re-runs the verb, and `reincarnation_in_flight` (§6) is what keeps
  a second request honest while the FIRST process lives.
- **Crash during 3 (drain):** ordinary crash semantics — in-flight turns die with the process,
  the next open folds their seats `participant_runtime_lost` (#364). Nothing reincarnation-
  specific is owed.
- **Old crashes after 4 (successor started):** the successor does not depend on the old
  staying alive. Its lease claim recovers the stale lease by pid-liveness (the
  resident-authority reclaim path), it publishes, and — observing the predecessor named by
  `BATON_PREDECESSOR_INCARNATION` gone — records `host.publication_withdrawn` and
  `host.reincarnated` itself. The handoff completes without the old.
- **Successor dies before publishing:** the old incarnation is its PARENT — the child `exit`
  event reaches it directly. It records
  `host.reincarnation_failed {step: 'successor_publish', cause: {exit, stderrTail}}` (the #326
  bounded tail, registry-bounded), REOPENS admission, and keeps serving. The publication never
  moved; clients never noticed.
- **Successor dies after publishing, before settlement:** the old's step-7 poll sees the
  successor's incarnation but a dead lease owner; on the poll bound it records
  `host.reincarnation_failed {step: 'publication_handoff', cause}`, re-publishes its OWN
  authority (the idempotent republish path), reopens admission, keeps serving.
- **Old dies between successor publish and own exit:** the successor's settlement observation
  (old pid gone, old publication withdrawn or reclaimed) fires and records the closing rows.
  Clean.

## 3. What survives, what drains

| Fact | Across the incarnation boundary |
| --- | --- |
| Deployment id, state directory, coordination ledger | **Survive** — they belong to the deployment, not the process. |
| Participant rows, swarm memberships, assignments | **Survive unchanged** — ledger-folded state. |
| Workspaces (worktrees on disk, #428 custody) | **Survive** — the checkout files are the clone's, unaffected by the process boundary. A successor recruited with `resumeFrom` inherits one (#385) exactly as after any restart. |
| Contracts, parked guidance (#337), claims | **Survive** — durable rows; parked guidance composes into the seat's next brief under the successor. |
| Context packages, knowledge, boards, scratchpads | **Survive** — store-resident. |
| Seat worker PROCESSES | **End.** They are the old process's children on stdio pipes; a successor cannot inherit them. Their seats read `state: dead` / `lost` through the ONE #364 reconciliation, and their NEXT turns (resume, #318/#385) run under the successor. |
| In-flight one-shot turns | **Drain** — they complete on the old incarnation (steps 2–3); the old admits no new turns. |
| Wake attachments (SSE/WS follows) | **End typed** — the old resident names its stopping (`baton.wake_attachment_closed`, reason `resident_stopping`, #316 b); consumers resume from the frame's cursor against the successor. |
| Writer lease, resident lease, publication, socket | **Hand over** — the protocol of §2, in order: release → claim → publish → observe → withdraw → settle. |
| Served commit | **Changes** — per incarnation, by construction (§1). This is the point of the verb. |
| Routes, route usage, quota/degrade episodes | **Survive as ledger facts**; the successor's own readiness reads them. A provider-fault route degradation (#442) outlives the incarnation that recorded it. |

## 4. The doctor and recruit advisories

**Doctor.** `deployment.doctor` (and `baton doctor --check`) already compose the `served` block
from the ONE derivation (`servedRow`, application-deployment.mjs): `{commit, branch, target:
{ref, commit, behind}}`, frozen-at-open served revision, fresh target read, no network. This
design extends it, same derivation:

- `target: {ref, sha}` — the deployment's configured landing target (default: the checkout's
  branch, else the remote's default — the existing `servedTarget` resolution).
- `behind: {count, commits: [{sha, subject}]}` — `git rev-list <served>..<target>`, the list
  bounded by a new registry row (§9); `behind.count: 0` reads `upToDate: true`.
- Spawn rule: a doctor is a diagnostic read and may spawn once per call — docs/46 §7's no-spawn
  rule binds the VIEW paths (`swarm.view` slices), which the doctor is not one of. The served
  row already shells git at read time under exactly this rule; the behind list rides the same
  single read, never a second spawn per commit (one `rev-list` answers count and list together).

**Recruit.** `swarm.recruit` on a resident whose served commit is behind the target is ADMITTED
— the receipt's `baseBehind` (already landed, swarm-runtime.mjs `_baseBehind`) grows into the
typed advisory:

```js
advisory: { kind: 'base_behind', served: sha, target: { ref, sha }, count,
            next: 'baton deployment reincarnate <target>' }
```

and the recruit brief's inheritance/base section names it in one line — "This resident serves
\<sha\>, \<n\> commits behind \<ref\>; your base is the served commit." — so the seat knows its
base is stale and the root knows to reincarnate first. The advisory and the doctor's `behind`
are ONE derivation: the runtime asks the deployment's summary, never git (already true today —
`deploymentSummary().served`).

## 5. The wake class

`host.reincarnated` maps to a new closed wake class in the ONE table (wake-stream.mjs
`WAKE_CLASS_TABLE`, where #442 added `dead`):

```js
wakeRow({
  wakeClass: 'incarnation_changed', scope: 'deployment', terminal: false,
  next: 'baton swarm view {swarmId}',
  summary: 'the resident reincarnated in place — a successor incarnation now serves the deployment',
  rows: [operationalKind('host.reincarnated')],
  subject: { field: 'incarnation', kind: 'resident', fallback: { field: 'deploymentId', kind: 'deployment' } },
})
```

- `terminal: false`, a sibling of `dead` in scope only: nothing settled, nobody died — the
  consumer re-reads the view and its next attachments bind the new incarnation.
- A root's bounded watch (`baton deployment watch --follow --wake-class
  incarnation_changed`) sees the row with the from/to commits; every bounded swarm watch sees it
  as a deployment-scope frame.
- The `resident_lifecycle` observation class (publication changed) ALREADY crosses at the
  publish step; `incarnation_changed` is the ledger-driven settlement — the two are one fact at
  two moments (publication moved; handoff recorded), never two derivations.
- The class name and row join the closed sets the generated surfaces render (docs/36 §7.4 by
  regeneration, never hand-edited) — a docs/39 naming hunk is a docs lane's, named in the
  contribution's needsFromOthers.

## 6. Refusals

Typed, pre-effect, minted through the deployment/host refusal path (`hostError` /
`deploymentError` with an explicit code — the same pattern as `application_host_busy` and
`application_host_shutdown_failed`; there is no single host-code table today, so the codes are
the contract and the tests pin them):

| Code | When | Detail |
| --- | --- | --- |
| `reincarnation_target_unreachable` | the commit-ish resolves to nothing even after the verb's fetch | `{target}` |
| `reincarnation_in_flight` | an unresolved `host.reincarnation_requested` from THIS live process exists | `{since, successorPid}` (null until spawned) |
| `reincarnation_checkout_held` | the serving checkout is a worker-held worktree (#428 custody) | `{holders}` |
| `reincarnation_same_commit` | target sha == the served commit | `{commit}` |

The writer-lease half is NOT a caller refusal: the successor WAITS on the lease's bounded poll
(§2 step 5); a lease that outlives the bound turns the attempt into `host.reincarnation_failed
{step: 'writer_lease', cause}` — a recorded outcome, never a hung process and never an immediate
`coordination_writer_busy` at the caller.

## 7. What stays OUT of part 1

- **Remote residents (#298).** The protocol assumes the successor spawns as a local child over
  the same state directory; a cross-host handoff needs a transfer story for the resident lease
  this design does not pretend to have.
- **Worker adoption.** No attempt to re-parent or re-attach live seat worker processes to the
  successor. The #364 reconciliation + resume (#318/#385) is the admitted path; adoption is its
  own issue.
- **Automatic resume of a half-finished handoff** at open (§2 crash table leaves it to the
  operator).
- **Multi-turn session continuity across the boundary.** In-flight one-shot turns drain;
  anything longer settles as lost and resumes.

## 8. Open questions

1. Should the successor auto-RESUME the seats the old incarnation drained (a recruit
   --resume-from per active seat minted by the root's wake consumer), or is resume always the
   root's act? Part 1: the root's act, woken by `incarnation_changed`.
2. Replay cost on the real primary: 161 931 rows cost 65 s today (#449). Reincarnation pays it
   while the old incarnation still serves reads — is that overlap acceptable, or does the #449
   checkpoint need to land FIRST so the successor opens from a checkpoint? Part 1 composes with
   either; the answer decides the operator-visible handoff latency.
3. Should the old incarnation's `host.stopped` equivalent be successor-recorded (a
   `host.reincarnation_drained` row naming the old's exit), or is `host.reincarnated` +
   narrated tail enough? Part 1: `host.reincarnated` only.
4. Does `baton serve --reincarnate` need a `--wait` spelling that blocks until
   `host.reincarnated`, or is the wake class the wait? Part 1: the wake class.

## 9. Bounds this design adds (the limits registry, with derivations)

Lane A owns the rows in impl/src/limits.mjs; each lands with its derivation comment in the
registry's style:

- `host.reincarnation.lease_wait_ms` — the successor's writer-lease poll ceiling. Derivation:
  the old incarnation's worst-case final write (one bounded row) plus the observed
  claim/release round-trip; on the order of the existing drain poll bounds, never a ledger-size
  function.
- `host.reincarnation.lease_poll_ms` — the poll interval inside that ceiling.
- `host.reincarnation.publication_wait_ms` — the old incarnation's observation ceiling for the
  successor's publication + liveness. Derivation: the successor's open bound (replay is the
  variable — see §8 question 2; the row bounds the POLL, and a checkpointed open keeps it
  honest) plus the publication write.
- `host.reincarnation.publication_poll_ms` — the poll interval.
- `host.reincarnation.stderr_tail_bytes` — the bounded stderr tail a failed successor's
  `host.reincarnation_failed` cause carries (the #326 bounded-tail precedent).
- `view.doctor.behind_commits.items` — the `behind.commits` list ceiling (lane B's row).
  Derivation: the list is an operator's "what will I pick up" reading — a page, never the
  history; the count is always exact regardless.

## 10. Landing order and the manifest

- The red-before skeleton (`impl/test/issue306-reincarnation-red.test.mjs`) was observed red at
  HEAD 1a830bfe by the design lane (14/14). The implementation lanes landed BEFORE the design
  package integrated, so the pins moved to the landed truth (the 374aa9d8 precedent) and the
  file is GREEN on master — no expected-red manifest rows are needed for it. Its filename keeps
  the red-before record for archaeology; the header comment carries the history.
- Lane order: ds-306a (the verb) and ds-306b (the advisories and wake class) touch
  `application-deployment.mjs` and `limits.mjs` in DISJOINT regions (A: host/publication/
  reincarnation + the wait/poll bound rows; B: the `served`/`behind` derivation + the
  behind-list bound). Either order lands; the seam inventory and surface artifacts regenerate
  once after the second merge.
- The skeleton's handoff induction follows the seam this document names (§2 step 4,
  `advanced.reincarnation.spawn`); if the landed seam's spelling diverges, the skeleton's
  induction moves to it in the same integration — the row TITLES (the manifest keys) do not
  change.

## 11. Landed truth: where the implementation diverged from the design above

Landed on master 2026-09-18 (`809341b3` lane A, `6bc66bcb` lane B, wiring lane ds-306w behind
them). The divergences, reviewed and accepted by the sub-orchestrator:

1. **The verb is an application DIRECT PORT** (dispatched in application.mjs beside
   `deployment.doctor`), never an `APPLICATION_COMMAND_DEFINITIONS` key — the byte-stable
   command table and its canonical-operation construction check stay untouched. The authority
   check lives in `application.reincarnate` (owner or a lifecycle capability — `emergency_stop`
   or `control`; a seat holding neither draws `application_unauthorized`), and an unhosted
   deployment draws `reincarnation_unavailable`.
2. **The receipt** reads `{schemaVersion: 1, state: 'reincarnating', at, target, from,
   successor: {pid, incarnation}, next}` — not the `{reincarnation: {state: 'draining'}}`
   envelope §2 sketched. The verb still answers before the drain completes; the old's own
   `close()` is the handoff's continuation.
3. **New-turn admission during the handoff refuses `reincarnation_in_flight` {since,
   successorPid, phase}** through the ONE `turnAdmissionRefusal()` read (the route gate and the
   start-family methods share it) — not the #351 `coordinator_draining` code §2 step 2 assumed.
   One refusal object, one vocabulary; the code is the handoff's own.
4. **The old incarnation mints the successor's identity** (`BATON_INCARNATION`), so
   `host.successor_started {pid, incarnation}` names the incarnation the successor adopts and
   publishes — one identity, named before the successor exists. The handoff env also carries
   `BATON_PREDECESSOR_PID` / `BATON_PREDECESSOR_COMMIT` / `BATON_REINCARNATION_TARGET`, and the
   successor writes a readiness MARKER (`resident/handoff.<incarnation>.json`) before its open
   blocks on the leases — readiness evidence stronger than "the child is alive".
5. **The spawn seam is `advanced.resident.spawnSuccessor(spec)`** (a resident option; the spec
   carries command/args/cwd/env plus the marker, selector, profile, token and lease paths) —
   not the `advanced.reincarnation.spawn` spelling §2 step 4 proposed. Same contract, one spec
   object.
6. **The release mints the old's `host.stopped` with the ordinary `stopped` state** — the
   `reincarnating` state §2 step 5 proposed rides the receipt and the marker instead; the row
   vocabulary stays #351's.
7. **The crash table's re-publish arm landed (#306r).** A successor that dies before its readiness
   marker fails the verb with `reincarnation_failed {step: 'successor_start', cause: {exit,
   signal, stderrTail}}` and the durable row, admission reopened — as designed. A successor that
   dies (or stalls past the bound) AFTER the marker and BEFORE publishing is now the arm §2
   described, and it is decided by the successor's OWN facts, never by the timer alone: the old
   runs a **handoff window** (`#reincarnationWindow`) BEFORE any listener of its own closes, in the
   order the successor's open reaches each authority — (1) the fleet drain (the ordinary
   coordinator drain, so its rows land where a stop's rows land), (2) the result export root lease
   (the successor's own open constructs an application over the same deployment and cannot proceed
   without it), (3) the coordination writer lease (the release mints the old's `host.stopped`
   through the armed #351 outcome, as the ordinary stop's release does), (4) the successor's own
   `opened` state on the readiness marker, which is when (5) the resident and publication leases
   move, and (6) the publication itself, read as connection.json naming a different incarnation.
   At any step, the window can end in `host.reincarnation_failed {step: 'publication_handoff',
   cause: {exit, signal, stderrTail, waitedMs}}` — the child's exit, or the bound with `reason:
   'publication_timeout'` — and then the old incarnation **RE-PUBLISHES**: it ends the successor's
   process, re-takes the coordination writer authority through the same lease path the open uses
   (`claimWriterLease`) and the result export root through the same construction the application
   performs (`ResultExportLifecycle` over its own root), reopens admission, and goes on serving.
   Nothing is withdrawn: the publication bytes, the listeners and the process are the same ones
   that were serving before the handoff, and `host.publication_withdrawn` is never recorded for
   this incarnation. The row's `authority` column says exactly what the window had handed over:
   `residentLease`/`publicationLease` are `held` when the successor never reached its own open
   (the whole authority is the old's again) and `released` when it did — those two lease
   directories cannot be re-taken without minting a new incarnation (which would repoint the
   publication), so a failure past that point leaves them free for the next resident start while
   the publication bytes stay the old incarnation's; `publication: 'intact'` and `writerLease:
   'reclaimed'` hold in every case. Two more halves of the same arm: the successor publishes
   `lease_held_by_predecessor` on its marker and stands down typed (its open's lease wait is spent
   and the predecessor went on serving — the refusal a late publisher draws), and the failure row
   now wakes the `incarnation_changed` class beside `host.reincarnated`, so a root following the
   handoff sees its outcome either way instead of silence.
   A stop asked for INSIDE the window is a stop (#470): an operator's `close()` or a signal's
   shutdown joins the window, and when the handoff fails it supersedes the re-publish with the
   ordinary stop (`host.stopped`, the withdrawal, the listener closed) instead of being answered
   with `{state: 'serving', handoff: 'publication_failed'}` — that answer had swallowed the stop,
   kept the listener open and left the process alive. Only the handoff's OWN scheduled stop may
   end in the re-publish.
8. **`host.reincarnated` carries `predecessorExited`** beside `from`/`to` — the successor's
   observation of the predecessor's process (pid liveness, EPERM means alive), never a clock.
9. **The wake class carries `next: null`** — the WAKE_CLASS_TABLE's one invariant admits a `next`
   command only on a terminal class, so the re-read guidance rides the summary. §5's sketch
   named a command; the invariant wins.
10. **The bounds landed as two registry rows**, not §9's six: `host.reincarnation.wait_ms`
    (300 s = the deployment's own 90 s drain window + a 210 s successor-startup allowance derived
    from the measured 65 s reopen of the operator's 161 931-row ledger), enforced at all three
    waits, and `view.served_behind.commits` for the behind-commit page; both stderr tails ride
    the existing `MAX_STDERR_TAIL_BYTES` (#326).
11. **Lane B's new doctor spellings publish NON-ENUMERABLY** (the DP5 pattern): `served.behind
    {count, commits}`, `served.upToDate` and `served.target.sha` ride the row beside the landed
    enumerable `{commit, branch, target: {ref, commit, behind}}`, which
    `impl/test/served-commit-306.test.mjs` deep-pins (outside lane B's scope). One hunk there
    makes the new spelling the serialized one — carried forward below.
12. **§2 step 2's "wait for in-flight turns"** reads the coordinator's live handles
    (`turnInFlight`), and §6's `reincarnation_checkout_held {holders}` reads live workers whose
    worktree IS the serving checkout — both from the coordinator's own list, never a second
    custody scan.
13. **The old incarnation ends when the handoff does (#461, landed `290370b2`).** The live
    incident: the old lingered four minutes after `host.publication_withdrawn` because it was the
    successor's parent and the child handle with its stdio pipes kept the loop alive. Now
    `close()` releases the successor's process handle after the withdrawal (unref child + stdio,
    detach the stderr listener) and the old exits by itself; the served tail's last stage is
    `incarnation_exit`, said only by a stop that finished a handoff. The publication wait is a
    durable `host.stop_waiting {wait: {on: 'successor_publication', entries: [{resource,
    reaper: 'successor', since}]}}` row recorded at the commit point right after
    `host.successor_started` (past the release the old holds no writer authority). The signal
    path reads the incarnation's state first: a withdrawn deployment answers 0 participants and
    `SignalLifecycleOwner` narrates no second drain (`withdrawn` predicate, wired by `baton serve`).
    `host.successor_started` carries `argv` (the spawn spelling) and `log` — since #468 the PATH
    of the incarnation's own serve log (`resident/serve.<incarnation>.log`, opened by the
    successor at open and named again on its `host.reincarnated`), so no incarnation's narration
    depends on a predecessor's pipe; the
    successor's stderr is teed into the old's serve log.
14. **The handoff declaration is consumed by the incarnation it names (#462, landed
    `b3486836`).** The successor reads `BATON_INCARNATION` / `BATON_PREDECESSOR_INCARNATION` /
    `BATON_PREDECESSOR_PID` / `BATON_PREDECESSOR_COMMIT` / `BATON_REINCARNATION_TARGET` into its
    own incarnation state at open and deletes the ONE closed list
    `REINCARNATION_HANDOFF_ENV_KEYS` (derived from the spec that mints them) from its environment
    in the same act; a malformed declaration is consumed too. Every child environment is built
    over that declaration-free base (the worker runtime's `baseEnv`, the #459 gate run, the
    regenerators, a seat's nested `baton serve`), and `#successorSpec` re-bases on it before it
    mints the NEXT successor's own five keys — so no process an incarnation spawns believes it is
    a successor, while each reincarnate still hands a fresh declaration to its successor. One key
    is NOT in that list and rides through on purpose: `BATON_SERVE_PARENT_PID` (#471, `0bbf133b`),
    the declared parent a fixture helper sets so `baton serve` stops itself (`host.stop_requested
    {trigger: 'parent_exited', parentPid}`, watched with `reincarnationProcessAlive`) when the
    test runner dies — a reincarnation successor inherits the declaration and the predecessor's
    process group, so a fixture's resident and every successor it spawns die with the runner.

Carried forward from the lanes (the root's re-brief list): the `served-commit-306` deep-pin hunk
(item 11); docs/39's wake section naming `incarnation_changed` and the reincarnation rows beside
it (the class now carries the failure row too, item 7); the README docs table row for this
document.
