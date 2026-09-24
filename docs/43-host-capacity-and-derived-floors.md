# 43 — Host capacity is the throttle; the workspace floor is a record

Status: implemented (issues #297 and #307; 2026-09-14 incident — seven lanes plus root
verdicts on a 10-core / 16 GB host drove the load average to 24–46, and a full volume
refused a recruit against a constant 512 MiB floor with no wake).

The code of record is `impl/src/host-capacity.mjs` (the host-wide authority and the
derivation), `impl/src/worktree-capacity.mjs` (the derived workspace floor, the
`capacityPressure` predicate), `impl/src/application-deployment.mjs` (the doctor's
capacity sections and the deployment wiring), `impl/src/contribution-service.mjs` and
`impl/src/swarm-runtime.mjs` (the typed admission rows for `swarm.check` and
`swarm.recruit`), and `impl/scripts/run-suite.mjs` (the suite runner's derived default
parallelism).

## 1. The host capacity authority (#297)

Every threshold is a derivation from one observation — `os.availableParallelism()`,
`os.totalmem()`, `os.freemem()`, `os.loadavg()[0]` — and the module mints no admission
constant of its own (`deriveHostCapacity`):

| Threshold | Derivation |
|---|---|
| `hubCores` | 1 — the process is one event loop; every stop, drain and watchdog deadline is a timer on it (the #269 rationale, structural rather than chosen) |
| `usableCores` | `cores − hubCores` |
| `suiteCores` | `cores − hubCores` — a full suite uses every core but the hub's (the #269 measurement) |
| `verdictLanes` | `floor(usableCores / suiteCores)` — the #269 lane formula, generalized host-wide |
| `coreShareBytes` | `floor(totalBytes / cores)` — one core's equal share of memory, the unit the suite's cost is measured in |
| `suiteBytes` | `coreShareBytes × suiteCores` |
| `usableBytes` | `totalBytes − coreShareBytes` |
| `saturated` | `load1m ≥ cores` — the operator's `uptime` read, derived |
| `memoryTight` | `availableBytes < suiteBytes` |

Admission weights: a `verify` lease (a full-suite verdict) charges `suiteCores` cores and
`suiteBytes` bytes — the one cost the host has measured (#269). A `worker` lease (a
recruited participant) charges nothing: a seat is not a thread, its footprint is not known
before it runs, and a derived slot count per core was a hardware analogy rather than a
measurement (operator ruling, 2026-09-18, retiring #329's one-share-per-worker rule and the
`workerSlots` / `workerMemoryTight` rows). A worker never waits: it holds no slot,
`roomFor` admits it unconditionally, and the host's own scheduler is the throttle (#541).
Admission never refuses for being busy — a request that does not fit waits IN ORDER as a
visible queue entry (FIFO by enqueued timestamp, same-instant ties broken by a random
nonce), reporting `{position, ahead}` once. The wait has no bound: a request that cannot be
admitted now is admitted when the requests ahead of it release, and admission is never
refused for having waited (#541). A verify on a host whose memory cannot fund one full
suite is answered at once as degraded, with the shortfall named, and proceeds without a
lease.

### Sharing: the host-scoped lease directory

`defaultHostCapacityRoot()` resolves one directory per (host, user) beside the POSIX
`/tmp` baseline — `baton-host-capacity-<fingerprint(hostname, platform, arch, uid)>` —
the host-wide sibling of the per-repo `.baton/capacity` files. Per-worker `TMPDIR`
isolation is deliberately not honoured: an authority that resolved through a
per-process temp root would fragment per resident and share nothing.
`BATON_HOST_CAPACITY_ROOT` (or `advanced.capacity.hostCapacity.root`) pins an
operator-chosen location when `/tmp` is not one shared filesystem. Records are mode
0600; another user's resident gets its own directory (its processes could neither read
nor honour this user's locks).

Mutations serialize on the published-owner mutex the worktree capacity ledger proved:
an owner record published by atomic link, counted only after re-observation, a dead
holder reclaimed only under an exclusive reaper gate, every wait bounded by a monotonic
deadline. A crashed resident's leases and queue entries are swept by any live resident's
next observation (pid proved dead — `EPERM` counts as alive, conservative across
users). `observe()` reads under the mutex; `observeNow()` is the doctor's non-mutating
read.

## 2. Typed admission rows (#297 item 2)

`swarm.recruit` admits its seat BEFORE the membership write: while the derived budget
has no room the request waits as a visible queue entry, a durable
`swarm.admission_queued` driver row records `{position, ahead}` the moment it is
enqueued, and when admitted the response carries the typed row
`{state: 'admitted', authority: 'host', position?, ahead?, queuedAt?}`. A queued seat
starts no worker until the host admits it — the queue drains in order as leases are
released, and `swarm.stop` / `swarm.participant_left` reconcile the runtime's worker
leases against its live-roster holders, so a seat whose runtime ended returns its lease
even if membership remains. A runtime built without an authority reports
`authority: 'unwired'` rather than pretending.

`swarm.check` admits its verdict through the same authority before the deployment's own
#269 lane orders it: a full check records `contribution.check_host_queued`
(`{position, ahead, running, workerLeases}`) when enqueued, holds the lease for the
verdict, releases it whichever way the verdict ends, and reports
`admission: {state: 'admitted', authority: 'host', …}` on the receipt. The swarm runtime
mirrors that wait at the swarm level (#269 items 2 and 4): while the check waits, the
check path watches the authority's visible queue for its holder
(`check:${contributionId}:${checkId}`) and records the same durable
`swarm.admission_queued` / `admitted` / `timeout` rows a recruit gets (with
`command: 'swarm.check'`, `contributionId`, `checkId`, `leaseKind: 'verify'`); `swarm.view`
folds them per (contribution, check) into the admission slice, mints `check_queued` /
`check_queue_timeout` attention, and marks the waiting contribution's row as queued with
the position, ahead and shortfall. Reviewer independence holds beside it: the seat that
authored a contribution cannot check it — `swarm.check` by the contributing seat refuses
`self_check_refused` (rule `check-reviewer-independence`) before any effect.

## 3. The suite runner's parallelism (#297 item 3)

`run-suite.mjs` defaults its parallel lane to `defaultSuiteParallelism()` — the same
derivation, one core for the runner's own loop and no more lanes than the memory the
host funds at one share per lane. `BATON_SUITE_PARALLELISM` remains the operator
override: an explicit decision that replaces the derivation, never a second default.

## 3b. The suite runner's verify lease (#333)

A full suite costs every core but the hub's (the #269 measurement `suiteCores`), so two
residents each running a suite on one host repeat the 2026-09-14 load incident by
construction. `run-suite.mjs` therefore holds ONE host-wide `verify` lease for the whole
verdict: acquired from the shared authority (the seam lives in
`impl/scripts/suite-host-lease.mjs` so tests can stage it) before the lanes start,
released at the verdict whichever way it ends. While the request waits it prints the
queued row — `position`, `ahead`, `shortfall`, the #329 shape. A spent wait refuses
BEFORE any lane starts, the way a recruit refuses pre-effect — unless the dimension
names a limit no wait could cure: a `budget` shortfall (another lease holds the lane)
or a `load` shortfall (the host is oversubscribed) can resolve, so the run refuses; a
`memory` shortfall means the host itself cannot fund a full suite's entitled share, a
standing property of a small host, so the run proceeds degraded without mutual exclusion
and warns loudly instead of bricking (`suiteQueueTimeoutDecision`; unknown failures
fail closed to refuse). No lane ever runs starved without saying so.
`BATON_HOST_CAPACITY_DISABLED=1` stays the operator bypass (the run acquires nothing and
touches no lease directory); a nested runner — one spawned from a test file, carrying
`BATON_TEST_SUITE_ROOT` — stays unwired the same way deployments do, so the suite's own
self-checks (which spawn the runner) never queue behind their parent's lease on a host
that is oversubscribed by design. Every test-file child stays unwired through the
`BATON_HOST_CAPACITY_DISABLED=1` the runner already pins in the child environment. The
runner's own wait defaults short (2s): verify leases are held for whole suites and checks
(minutes), so a longer wait would only delay the same refuse/degrade decision while
stalling time-bound runs on a host with no room; `BATON_HOST_CAPACITY_WAIT_MS` extends it
when queuing behind a known-finishing holder and `BATON_HOST_CAPACITY_POLL_MS` sets the
queue poll. Catchable signals release through the verdict path's `finally`; a SIGKILL-class
death between acquire and release holds the lease until the authority's dead-holder sweep
reclaims it — the designed recovery for a crashed resident, not a second release path.

## 3c. The worker's verify on the participant row (#333; #332 wires the row)

A worker's suite is a `verify` lease held under the seat's holder name
(`participant:<swarmId>:<participantId>`, the same template the worker holder set mints),
and the deployment summary's `hostCapacity.used.leases.verify` counts it — verify leases
are counted by kind, so worker suites read beside verdict leases with no special case.
`impl/src/host-capacity.mjs` exports the ONE derivation the swarm view's participant row
projects through: `projectParticipantVerify(queue, verifyHolders, holder)` (pure — a queue
entry under the name reads `{state: 'queued', position, ahead}`, a live verify lease
under it reads `{state: 'admitted', position: null, ahead: null}`, anything else reads
null) and the authority method `observeParticipantVerify(holder)` (the same non-mutating
live-pid read `observeNow()` performs, folded through the derivation).

Coordination note for the #332 lane, which owns `impl/src/swarm-runtime.mjs`: wire the
row by calling `this.hostCapacity.observeParticipantVerify(
`participant:${swarmId}:${participantId}`)` per participant (guarded by `typeof ... ===
'function'`, so an unwired runtime keeps the row absent) and attaching the result as
`verify` — null when the seat holds and waits on nothing. This lane does not touch
swarm-runtime.mjs.

## 3d. Post-admission shedding (#495)

Admission judges a request before it starts, which leaves the leases already admitted unjudged: a
host that loses the memory to fund the verify runs it admitted goes on counting them, and no reader
learns that the host can no longer pay for what it holds. `HostCapacityAuthority.shedIfExhausted()`
is that reading, on the same observation and the same derivation admission refuses on.
`hostCapacityShortfall` names the verify kind's `memory` dimension when `availableBytes` is below
the `suiteBytes` share every admitted verify was measured against — that reading, with at least one
verify lease admitted and seen on two consecutive observations, sheds the NEWEST admitted verify
lease. Newest is by `acquiredAt`, same-instant ties broken by nonce descending, so the lease that
arrived last yields first. The method answers one row:

    host.capacity_shed {leaseKind, holder, residentId, acquiredAt, shortfall, at}

`shortfall` carries the numbers that justified the shed (`{dimension: 'memory', observed:
availableBytes, required: suiteBytes, unit: 'bytes'}`). The lease directory is host-wide, so the
lease shed may belong to another resident, and the row names whose it was. The lease record is gone
when the method returns, so the next `observe`/`observeNow` reads the freed budget.

The shed is bounded to ONE per exhaustion episode. Removing an admitted lease's record returns
accounting only: the memory its process holds stays held, so further sheds on a host that stays
exhausted would describe a host funding nothing while its suites run. An observation with room again
closes the episode, and a later exhaustion sheds the newest lease admitted at that time. A `load`
shortfall — a host at or above its own core count — is not exhaustion, since a shed admits nothing
there. The removal is an exact-name `rmSync({ force: true })` under the host mutex, so a release
racing the shed is a no-op on both sides.

A resident wires it with `watchExhaustion(onShed)` and `stopExhaustionWatch()`: a bounded, unref'd
interval (`shedPollMs`, 5000 ms by default — protocol timing, since the derivation alone decides
whether the host is exhausted) that asks the authority each interval and hands every shed row to the
caller. `baton serve` starts the watch once the resident is serving
(`BatonDeployment#startOrdinaryHost`), stops it where the incarnation withdraws, and records each row
through the deployment's own `driver.recorded` lane.

## 4. The derived workspace floor (#307)

The floor beneath a reservation wave is a record, not a constant:

```
floor = largest checkout estimate the deployment has recorded (ledger high-water)
      + measured runtime footprint (state ledger + evidence roots, walked with caps;
        worker homes are the checkout estimates the high-water already carries)
```

`DEFAULT_WORKTREE_CAPACITY.minFreeBytes/minFreeInodes` are `null` — derive. An operator
may pin either field through `advanced.capacity.policy`; the resolution is per field
(configured wins, `null` derives) and the policy digest pins which regime is in force,
so the floor cannot flip silently under live reservations. The high-water lives in the
capacity ledger itself (schemaVersion 2, `estimateHighWater`, sealed with the
reservations it protects; schemaVersion 1 ledgers stay verifiable byte-for-byte and
migrate on first write). A live reservation counts against free space through
`outstanding` exactly as before — the floor adds room for one more participant plus the
deployment's own growth, and nothing is double-counted.

### The refusal names its numbers

A refused wave throws `worktree_capacity_exceeded` carrying `freeBytes, freeInodes,
outstandingBytes, outstandingInodes, estimateBytes, estimateInodes, floorBytes,
floorInodes, floorSource, deficitBytes, deficitInodes, reasons`, and the message spells
the same facts with the remedy that would admit this exact request. The Web mapping
(web 503) repeats them, replacing "what defines this limit" with the numbers.

### The doctor and the view

`deployment.doctor` reports the workspace observation beside the EFFECTIVE floor
(`floorBytes, floorInodes, floorSource, estimateHighWater, runtimeFootprint`) and a
`hostCapacity` section — the derived budget, live leases and the visible queue, read
fresh, with memory quantized DOWN to the deployment reserve granularity and load
quantized DOWN to whole cores so equal-state projections stay deeply equal across reads
(the #35 discipline; admission itself always derives from the raw observation).

`swarm.view` carries the `deployment` summary on every projection: the workspace
section and the host section. The observation crossing the floor is a deployment-level
fact — `workspaceCapacityPressure(workspace)` (exported from
`impl/src/worktree-capacity.mjs`, re-exported from `impl/src/application-deployment.mjs`)
is the ONE predicate; the wake stream lane imports it to derive a `capacity_pressure`
wake. This document does not build the wake.

`swarm.view` also carries the swarm's own `policy` (#443) — the RESOLVED re-route policy,
`{rerouteOnProviderFault: 'manual' | 'auto', reroutePreferApi}`, with `auto` and no
billing preference filled in for a swarm that never declared one (#574: recoverability is the
default posture; a declared `manual` stops at the proposal and pages an orchestrator), so a view
of a fresh swarm already says what a provider-fault death would do. It is declared when the swarm is
OPENED — `baton swarm create <purpose> --policy '{"rerouteOnProviderFault":"auto"}'` — or
later by one caller-submittable `swarm.policy_updated` row through `swarm.update`: both
spellings write the same row and read the same fold (the create validates its policy
against the fold's closed sets BEFORE the `swarm.created` row lands, so a refused policy
leaves no swarm behind). A swarm whose provider killed a seat reads its candidates from the
same deployment route rows the `routeUsage` rows below describe.

Both the doctor and the view's `deployment` summary carry `routeUsage` (#341):
an array of per-served-route usage rows derived from the deployment's own operational
log and adapter cards. Each row has the shape
`{route, state, code, usage: {turns, tokens, usd}, concurrency: {ceiling, inUse},
lastProviderRefusal: {code, text, at, resetAt} | null, quota: {state, resetAt}}`.
Turns and tokens are aggregated from `lifecycle.turn_started` and `resource.tokens`
events matched by route attribution (`harnessResolved`, `modelResolved`,
`effortResolved`). The concurrency ceiling comes from the adapter card, and
`lastProviderRefusal` is the most recent `lifecycle.crashed` event whose payload
carries `PROVIDER_FAULT_CODES.quota`. The `quota` section reflects the live
`ProviderQuotaAuthority.blockFor()` derivation — a route whose provider refused it
for quota reads `{state: 'exhausted', resetAt}` until the recorded instant passes,
then reads `{state: 'ok', resetAt: null}` again. The `baton route usage` CLI verb
exposes the same rows. The brief renderer's `## Swarm` section includes a
`### Route usage` subsection when the brief carries usage rows.

A participant row's `workspace` carries the seat's commit attributions as a BOUNDED TAIL (#464,
the second half): `commits` is the newest `view.workspace.commits` rows of the
`worktree.commit_recorded` ledger (#425), newest first, with `commitsTotal` the whole count beside
it — so a roster never pays a busy seat's history (the live swarm measured one seat at 195 049 B /
1 241 rows) and a bounded row still says how much of it there is. The bound derives in
`impl/src/limits.mjs` from the family's ONE list page (a share of `view.served_behind.commits`,
never a hand-typed ceiling). The read that answers the rest is the seat's OWN scoped read —
`swarm.view {swarmId, participantId}`, on which heavy per-row fields ride whole (#343/#349) — and
a bridge PAGE drops the commit rows entirely the way it drops `lastToolRows` and the native
observation record, keeping `commitsTotal`: a 36-seat swarm whose seats are busier than the bound
answers its whole roster in one frame again.

Both the doctor and the view's `deployment` summary also carry `served` (#306 part 2):
`{commit, branch, target: {ref, commit, behind}}` — the revision this deployment
SERVES, read once at open and frozen for its life (the code that loaded is the code
that answers), beside the target it is measured against, read fresh at every read from
the checkout's own refs: the checkout's branch when it is on one, else the remote
default (`origin/HEAD`, then `origin/master`), else nulls for a detached checkout with
no remote. `behind` is `rev-list --count served..target` over the refs the repository
holds now — a fetch refreshes it; the doctor never touches the network — and every git
read answers null instead of throwing, so an unreadable checkout is absence on a doctor,
never a doctor failure. `swarm.recruit` reads the same row to answer its `baseBehind`
advisory (docs/39).

A participant row carries the objective's FIRST LINE, never the objective (#464): `role` is
bounded by the ONE `view.role.head` registry row (160 B, derived in `impl/src/limits.mjs` from
the frame a roster must fit — quadratic, because a seat's brief renders every peer's role line),
`roleBytes` is the length the recruiter wrote, and `roleRef {kind, seq}` names the
`swarm.participant_joined` ledger row that holds the whole text. ONE derivation — the fold's
participant row — so `swarm.view`, `run.peers.read`, the recruit brief's `## Swarm situation`
section and the checkpoint all carry the same bounded line: a 36-seat roster's participants
projection (3 KB objectives each) fits one `wire.frame` instead of paging six rows at a time.

A `swarm.operation_completed` row names the seat's objective by REFERENCE, never as a second
copy (#469): `objectiveRef {kind: 'swarm.participant_joined', seq}` + `objectiveBytes` are the pair
the participant row mints above, the wrapped `swarm.stop` answer's own `objective` is replaced by
the same pair, and `planPreview` carries the node's id and the objective's FIRST LINE under
`view.role.head` — so the receipt that measured 998 271 B (one 320 602 B objective spelled three
times) and the 473 rows holding 56 MB of the parsed window record rows bounded by their fixed
fields, and `baton swarm stop`'s rendering prints the line the reference names.

A participant row carries its brief's REACH, never the composed text (#464, the third half):
`brief` is `{bytes, seq, exposure}` — the composed brief's byte length, the
`swarm.participant_joined` ledger row that holds it (the fold mints `briefBytes`/`briefRef` at the
join, the pair `roleBytes`/`roleRef` already use), and the docs/46 §4.1 relationship class this
caller stands in to the seat (the ONE `_briefExposure`, derived per read: the organizer stands in
the delegation class, the seat is `self`, a peer `swarm`, a shared checkout `checkout`, a shared
group `group`). The participantId-scoped read still carries the text whole on the row it names —
with the same reach beside it as `briefReach` — so the roster (any `participants` projection, the
whole record's array, a bridge page) pays a fixed small shape per seat instead of the text the
ledger already holds: the probe's ~17.5 KB per row becomes ~60 B, and a 39-seat fixture carrying
the live ~17 KB briefs (plus the #464 commit tail) answers its participants projection in ONE
frame where the same fixture served 22 of 39 rows before.

## 5. The open contract: replaying → reconstructing → answering (#351)

A resident's open is three phases, each named on the `baton serve` flip lines and in `startupReport()`:

- **replaying** — the coordination store opens deferred and folds its ledger in chunks of `FRAME_LIMITS['view.wake_replay.items']` rows, yielding to the event loop between chunks (`loadCoordinationStoreAsync`). A checkpoint whose bytes and anchors prove under a different authority digest reads `stale_authority` and is reused; only real corruption replays from the first row, and the flip line names the invariant that refused it (#397). An open that could not be served by the checkpoint it found writes the cache the NEXT open needs once the fold completes — no cache at all, another projection shape or commit, or another authority digest (whose window is reused and then refreshed under this build's authority) — which is also where a projection past `checkpoint.projection_bytes` lands: a stop skips that write with its measured bytes on the row, and the open pays it behind a replay it has already finished, so at most one replay follows a skipped release (#449). The serve log prints `replayed (open Nms; R rows on the ledger; replayed K; checkpoint <state>)` for any ledger at the chunk bound or above.
- **reconstructing** — the coordinator's projection-derived startup (snapshot clone, task seeding, plan-node settlement, per-worker log replay, absent-process recovery, reconciliation, unattached-task terminalization) runs ONCE, after the replay resolves (#434), as one pass order with two cadences: the synchronous constructor drains it without yielding, the deployment open awaits it with a yield at the same registry bound after each bounded unit. No projection is read and no row is appended before the replay resolves; an early append refuses `coordination_store_loading`. The startup report carries `reconstructionState` and `reconstructionElapsedMs`.
- **answering** — the publication exists and the self-check answered. The flip line prints `answering (open Nms; …; reconstructed Mms; checkpoint <state>)`.

A signal that arrives during the open is admitted and remembered; the stop row lands through the deployment's own writer once the ledger writer exists, and the usual drain follows.

The checkpoint's body is a projection of the ledger and never a second copy of it: every housewriting
outcome carries the projection's measured bytes by family — `bytesByFamily`, read from the SAME
serialize the `checkpoint.projection_bytes` ceiling judges, with `projectionBaselineBytes` and
`sharedBytes` beside it so the entries close on the measured bytes exactly — and the family that
carried a rendering re-points at the ledger row holding it (measured on the clone's 288 671 406-byte
checkpoint: the swarm snapshot's per-seat rows, 17 422 263 B of which 99.3% was the composed recruit
brief, now `briefBytes` + `briefRef` and 126 805 B; issue #465).

The rest of the body's second copies follow the same rule, through ONE reference grammar and ONE
reader (`PROJECTION_REFERENCES` + `_projectionReferenceValue` in `impl/src/coordination-store.mjs`):
a row keeps its IDENTITY and OUTCOME and names the ledger row that holds the text as
`{<field>Ref {kind, seq}, <field>Bytes}`, and every consumer resolves the pair from that row — the
ledger is the source, the projection the pointer. Two families are converted where they are FOLDED,
because every reader of those rows already goes through the store's own accessors: a completed web
command keeps `{commandId, status, outcome.httpStatus}` and references the response body it recorded
(`outcome.bodyBytes` + `outcome.bodyRef`, resolved by `webCommand`/`webCommandByScope` — measured on
the clone, `_webCommands` was 39 206 146 B of the 288 871 406-byte body; the request content is
never on the row to reference, only `requestAxes`' digest map is), and a spill keeps
`{spillId, digest, bytes, lane}` where `bytes` IS the referenced body's length (5 845 234 B;
`materializeSpill` and the mint receipt answer the body unchanged). Three are referenced in the
checkpoint BODY only, because consumers outside the store read those rows whole
(`coordination-replay.mjs`'s `plan.nodes`, the application's goal/plan readers): a goal's
`objective` (11 971 429 B), a plan's `nodes` (12 071 920 B) and a task's `brief` (12 141 185 B), each
as `objectiveRef`/`nodesRef`/`briefRef` beside its `<field>Bytes`, with a family and its head map
rendered from the ONE row they alias. On this lane's fixture (one 200 KB web answer, one 50 KB
spill, one 40 KB objective, one 3 KB node objective, one 4 KB brief) the projection falls 622 288 B
→ 317 961 B over a 310 578-byte ledger, and the release write gets FASTER (24.1 ms → 17.3 ms
median, five rounds) even though the render walk costs 0.9 ms: what leaves the body is text the
checkpoint used to serialize and fsync twice over.

What is left is the parsed window, and that is the honest answer to "why is this still over the
ceiling": `_events` + `_byKey` are the ledger's own rows, cached as parsed objects — 180 159 961 B
of the clone's 288 871 406 B, and after this lane the whole remainder. The ceiling the registry
derives (`checkpoint.projection_bytes` = `view.wake_replay.items` × `view.attention_text.bytes`, 4096
rows × 4096 bytes = 16 MiB) is a ROW ceiling times a row's text, so a checkpoint fits it exactly when
the live window it caches is within `view.wake_replay.items` rows — the clone's window is 51 327
rows, 12.5× that row ceiling, which is why its release write reports `release_checkpoint_unbounded`
at 189 MB whatever the text families do. The lever is the compaction cut (#223 `compact({beforeSeq})`),
not another rendering: an operator cadence that keeps the live window inside the registry's row
ceiling is what makes the release write land, and until it exists the open's own refresh write is
the one that caches (issue #465 item 4/5).


## 6. Restart truth: lost seats and refused starts (#364, #384)

- A restarted resident reconciles every participant's runtime row against the worker fleet it actually recovered (`coordinator.startupWorkerFleet()`: owned = spawned by this incarnation, recovered = a kernel-start-bound process the replay proved alive; everything else is lost). For each lost seat the swarm runtime folds ONE durable `swarm.participant_runtime_lost {swarmId, participantId, workerId, incarnation, at}` (runtime-recorded, never caller-submittable), so `swarm.view` reads `live: false, state: dead` with a `worker_lost_on_restart` attention row whose `next` names resume (`swarm.recruit --resume-from`) or stop. The brief's Peers section and scopeOverlap read the settled liveness; a lost seat holds no capacity reservation.
- A start the owned-resource reconciliation refuses names its cause: `coordinator_cleanup_incomplete` carries `{reconciler, record, observed, next}` for the reconciler that failed (workspace owners, worker processes, capacity leases, publication lease), a transient observation says `retry after N ms` with the fact it waits on (N from the reconciler's own grace row), and `baton serve` records `host.startup_refused {code, reconciler, record, observed}` through the deployment's writer before exiting, so the doctor and the wake stream see it.

