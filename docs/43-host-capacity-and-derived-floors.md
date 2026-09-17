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
| `coreShareBytes` | `floor(totalBytes / cores)` — one core's equal share of memory |
| `suiteBytes` | `coreShareBytes × suiteCores` |
| `usableBytes` | `totalBytes − coreShareBytes` |
| `workerSlots` | `usableCores` |
| `saturated` | `load1m ≥ cores` — the operator's `uptime` read, derived |
| `memoryTight` | `freeBytes < suiteBytes` |

Admission weights: a `verify` lease (a full-suite verdict) charges `suiteCores` cores and
`suiteBytes` bytes; a `worker` lease (a recruited participant) charges one core share.
Admission never refuses for being busy — a request that does not fit waits IN ORDER as a
visible queue entry (FIFO by enqueued timestamp, same-instant ties broken by a random
nonce), reporting `{position, ahead}` once. Only the caller's own bounded wait
(`waitMs`, protocol timing aligned with the resident command deadline) ends in a typed
`host_capacity_queue_timeout` refusal that names the queue position — nothing was
started, nothing recorded as work.

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
