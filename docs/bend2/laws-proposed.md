# Baton's laws proposed for the operator's approval

Provenance: work-bend2-laws, pillar 3 of issue #539, per the approval clause of
`docs/bend2/MANDATE.md` part 3. Every candidate below was verified against the checkout it names
(base `bc2e4fcd`): the enforcing source exists at the cited lines, and the pinning test exists
with the cited name. The seed inventories are `docs/bend2/laws-ledger-inventory.md` and
`docs/bend2/laws-validators-inventory.md` (landed as `6a00a7a4`); this document restates every row
of both, plus the development laws. The operator answers each row yes or no; only approved rows
enter `docs/bend2/laws.bend`, each carrying the decision.

## Row format

Each row carries: the stable law id, its kind (`runtime` — the software enforces it today — or
`development` — a rule the project is built under), its statement, a plain explanation a reader
can answer yes or no from, and its trace. A runtime row marked `(unpinned)` is enforced but has no
test that fails if the enforcement is removed; a row marked `(proposed)` is not enforced today and
is a candidate for the rewrite to adopt.

Words the plain explanations use: a **worker** is an AI agent doing a piece of work. A worker's
**workspace** is its own private copy of the project's files. The **shared log** is the
append-only record of everything that happened among a group of workers; entries in it are
numbered in order. A **notification** is a message the system pushes to a worker when something
it cares about happened. A **contribution** is a piece of finished work with its commit; it
**lands** when it is merged into the shared branch after an approval. A **typed refusal** is an
error answer that states, in fixed fields, exactly which rule failed, about what, and what to do
next.

---

## Custody of workspaces

### CUST-1 · runtime · A held workspace stays held until the hold is released
Statement: A handle holds a checkout until its hold is released; holding is the absence of a
release, so a finished-but-not-yet-cleaned-up worker still holds its workspace.
Plain explanation: When a worker is given its own copy of the project files, that copy belongs to
it until the worker is fully done with it — including the shutdown step that puts everything away.
No other worker may delete or reset the copy while that cleanup is still pending. Without this
law, a second worker could wipe a folder out from under a worker that was mid-shutdown and strand
exactly the worker everyone was waiting for.
Trace: `impl/src/shared-workspace-custody.mjs:38` `holdsWorkspace` (holder statuses `:19`,
attachable statuses `:25`). Test: `impl/test/shared-workspace-custody.test.mjs:318` "T3 the last
holder closes a dirty shared checkout only by retaining it, with no commit on the shared branch";
`:268` "T2 a stop detaches from a shared checkout and leaves the resource to the live holder".

### CUST-2 · runtime · A workspace that is closing takes no new worker
Statement: The statuses from which a worker may join a workspace are pending, working, blocked and
idle; a closing workspace accepts nobody.
Plain explanation: A workspace has a lifecycle, and only workspaces in a still-active state may
accept a new worker. Once a workspace has begun closing, every new arrival is turned away with a
clear refusal instead of being placed there. Without this law, a new worker could be moved into a
folder that is being dismantled and lose its work immediately.
Trace: `impl/src/shared-workspace-custody.mjs:25` `ATTACHABLE_STATUSES`, read at `:76` inside
`workspaceAttachmentOf` `:70`. Test: `impl/test/shared-workspace-custody.test.mjs:489` "T7 a
source that is still a live member but has no attachable checkout refuses"; `:425` "T6 an absent,
self, departed, foreign-swarm, or process-less source refuses without a holder".

### CUST-3 · runtime · Custody truth is the set of live worker handles
Statement: Who holds a workspace is decided by the controller's own live worker handles; group
membership and ownership receipts are separate records that do not decide custody.
Plain explanation: The answer to "who is using this folder right now" comes from one place only:
the list of live worker processes the controller is actually managing. Being on a team roster, or
holding an ownership certificate from earlier, does not by itself mean a worker is using the
folder. Without this law, the system could delete a folder a live worker is using because the
roster said the worker had left, or keep a folder forever because of a stale certificate.
Trace: module header `impl/src/shared-workspace-custody.mjs:1-13`; `workspaceHolders` `:53`.
Consumers: `liveWorkspaceHolders` `impl/src/runtime-api.mjs:583`, coordinator projection
`impl/src/coordinator.mjs:4216`. Test: none pins this directly; nearest evidence is
`impl/test/shared-workspace-custody.test.mjs:318` "T3" and the consumer paths.

### CUST-4 · runtime · A removal looks before it destroys and refuses while content is unaccounted for
Statement: A removal observes the workspace before its first destructive step and refuses while
un-captured content or another live holder is present; the two preservation reasons carry
distinct codes, and a live co-holder carries its own.
Plain explanation: Before the system deletes or recycles a worker's file copy, it first looks at
what is there. If there is work nobody saved, or another live worker still uses the copy, the
destruction is refused with a specific, named reason instead of proceeding. Without this law,
routine cleanup could silently erase unsaved work or yank the floor out from under a working
teammate.
Trace: `impl/src/worktree.mjs:1312` `assertRemovableContent` (`:1316` and `:1321` the preservation
codes, `:1326` the custody error); `observeOwnedWorktreeContent` `:1254` (`removable` flag
`:1262`, unobservable states `:1269` and `:1275`); `liveWorkspaceHolders` `:1300`. Test:
`impl/test/workspace-preservation.test.mjs:164` "reap() retains a dirty checkout for a dead owner
even with {force:true}"; `:501`, `:557`, `:587` the reconcile rows.

### CUST-5 · runtime · Retention is the preservation mechanism; no option overrides it
Statement: No caller option, force included, authorizes destroying un-captured content; the
boundary never stages, commits, stashes or rewrites what it judges.
Plain explanation: When the system decides that unsaved work must be preserved, it preserves it by
leaving it exactly where it is and refusing the destructive step. There is no "delete it anyway"
switch: a caller cannot pass a flag to overrule preservation. Without this law, any component
with a bug or a bad flag could bypass the safety check and destroy a worker's unsaved work.
Trace: boundary comment `impl/src/worktree.mjs:1170-1183`; call sites `:2461` and `:2759`. Test:
`impl/test/workspace-preservation.test.mjs:234` "no caller option is an authorization to destroy
un-captured content"; `:217` "markStopped is not an authorization to destroy un-captured content".

### CUST-6 · runtime · Only attested machine-made files may be destroyed without a capture
Statement: Content destroyed without a capture is limited to files the owner metadata attests as
machine-materialized — copied dependency trees and toolchain projections — and only paths the
version-control system reports as never-tracked can be treated as generated.
Plain explanation: A worker's folder contains both the worker's own work and machine-made clutter
such as downloaded libraries and tool installs. The system may delete the clutter without asking,
but only when its own records vouch that the system — not the worker — put it there, and only for
files the version-control system has never been asked to track. Without this law, cleanup could
eat hand-edited files that happened to sit inside a generated folder.
Trace: `impl/src/worktree.mjs:1187` `attestedInfrastructureRoots` (`:1190-1196` the literal-path
filter); `observeOwnedWorktreeContent` `:1282-1284`. Test:
`impl/test/workspace-preservation.test.mjs:311` "attested runtime infrastructure is generated,
not un-captured content"; `:418`; `:396`.

### CUST-7 · runtime · A capture refuses the repository's own main folder
Statement: A capture path refuses a workspace that resolves to the repository main checkout.
Plain explanation: The system keeps one master copy of the project and many worker copies. A
worker may only take capture actions, like committing from, a worker copy — never the master copy
everybody shares. Without this law, a misconfigured worker could commit half-finished work
straight from the master folder that other things depend on.
Trace: `impl/src/worktree.mjs:1334` `validateOwnedWorktree` (`:1345` the resolved-path check,
`:1349` the expected-path check). Test: `impl/test/workspace-preservation.test.mjs:438` "a
directory that is not this repository's checkout is retained".

### CUST-8 · runtime · A shared revision record describes state, never authorship
Statement: A shared revision record describes the checkout and its observed head with a live
holder count, and carries no authorship claim.
Plain explanation: When workers share one file copy, the system writes a neutral status record:
what version the folder is at, and how many workers are using it. The record deliberately says
nothing about who created or owns the work. Without this law, readers might treat a status
snapshot as proof of authorship and credit or blame the wrong worker.
Trace: `impl/src/shared-workspace-custody.mjs:97` `workspaceCustodyRecord`; consumer
`impl/src/runtime-api.mjs:213`. Test: `impl/test/shared-workspace-custody.test.mjs:392` "T5 a
shared revision describes the checkout and its observed HEAD, never authorship".

### CUST-9 · runtime · A worker copy is separation of files, not of history
Statement: A lane checkout is workspace separation: the ref namespace and the object store are
shared.
Plain explanation: Each worker's private copy of the files is a convenience, not a separate
universe: all copies draw from the same project history, and anything a worker commits is
immediately visible to the whole project's history. The isolation protects files being worked on,
not knowledge. Without this law, readers might wrongly assume a worker's commit is invisible
elsewhere until some later sync step.
Trace: `impl/src/worktree.mjs:1434` `WORKTREE_GIT_SHARING` (`:1436` the statement, `:1439`
`branchForTask`). Test: `impl/test/issue412-worktree-non-isolation.test.mjs:47` "issue 412: the
creation seam states workspace separation is not git-ref isolation"; `:56`.

### CUST-10 · runtime · Before a removal, the worker's branch is first put at the worker's state
Statement: Before a removal boundary the lane branch is put at the checkout's head; a branch
another workspace holds is left in place and the caller retains the checkout.
Plain explanation: Each worker copy has a matching named bookmark in the project history. Before
the system tears a copy down, it moves that bookmark to point at exactly what the worker left
behind, so nothing the worker reached is lost; if another copy is still using that bookmark, the
system declines and keeps the copy instead. Without this law, torn-down workspaces could leave
their final state unreachable.
Trace: `impl/src/worktree.mjs:1929` `ensureLaneBranchAtHead` (`:1939` the held-elsewhere refusal,
`:1942` the update-ref, `:1943` the reattach); `laneBranchHeldElsewhere` `:1907`;
`laneBranchState` `:1892`. Test: `impl/test/issue428-worktree-custody-on-stop.test.mjs:236`
"428-B: a stop of a seat whose HEAD is not on its branch puts the branch at HEAD first"; `:198`;
`:328`.

### CUST-11 · runtime · A physical workspace owner is claimed in one atomic, recoverable act
Statement: A physical workspace owner is allocated before any branch or worktree effect, as one
exclusive receipt published atomically; a restart reconciles a partial publication, and a
structurally sound foreign receipt is retained diagnostically.
Plain explanation: Before anyone creates or uses a physical folder, the system writes a single
claim ticket that names the owner; that ticket either appears completely or not at all, so two
workers can never both believe they own the same folder. If the system crashes halfway through
writing the ticket, the next start cleans up the half-written state; a ticket written by a
different, healthy system is left alone and reported. Without this law, two workers could work in
the same physical folder and corrupt each other.
Trace: `impl/src/worktree.mjs:740` `allocatePhysicalWorkspaceOwner`; `releasePhysicalWorkspaceOwner`
`:824`; `recoverWorkspaceOwnerPublication` `:598` (`:614` the ambiguous-allocation refusal);
`foreignConsistentReceipt` `:439` (`:447` the 64 KiB and mode bound). Test:
`impl/test/phase92.2-physical-workspace-owner-red.test.mjs:96` "P92.2-PO2: exclusive receipt
publication is failure-atomic before final-path visibility"; `:139`; `:245`; `:433`.

### CUST-12 · runtime · The detach gate and the reaper read one custody predicate
Statement: The detach gate and the reap backstop both call the same custody predicate.
Plain explanation: Two different routines decide questions of the form "is anyone still using
this folder" — one when a worker detaches, one during background cleanup. Both must ask the very
same question-answering function, so they can never disagree about whether a folder is free.
Without this law, one routine could declare a folder free while the other still sees a live
worker, and the folder would be destroyed under the worker.
Trace: both call `liveWorkspaceHolders` `impl/src/worktree.mjs:1300`, from the checkout path
`:1324` and the residue path `:2946` (`workspace_other_holder_live_retained` `:2949`); the
injected provider is `workspaceHolders` `impl/src/shared-workspace-custody.mjs:53`. Test:
`impl/test/shared-workspace-custody.test.mjs:513` "T8"; `:532` "T9".

---

## Host and workspace capacity

### CAP-1 · runtime · Every admission threshold derives from a measurement
Statement: Every host admission threshold derives from the host observation.
Plain explanation: How much work the machine may take on is computed from measurements of the
machine — how many cores and how much memory it actually has — never from fixed constants chosen
in advance. Without this law, the system would overcommit a small machine or waste a large one,
because a hardcoded guess cannot track the hardware it runs on.
Trace: `impl/src/host-capacity.mjs:230` `deriveHostCapacity`; `hostCapacityObservation` `:185`.
Test: `impl/test/issue297-issue307-host-capacity.test.mjs:48` "HC-1: every host admission
threshold is a derivation from the measurement, never a constant".

### CAP-2 · runtime · A worker takes no slot and is admitted at any load
Statement: A worker lease holds no slot; a worker request is admitted at any load; the derivation
carries no worker shortfall dimension.
Plain explanation: Starting a new worker is always allowed, no matter how busy the machine is:
workers do not reserve capacity, and the operating system's own scheduler spreads their load. The
system never says "the machine is too busy to start another worker." Without this law, the system
could refuse to start workers precisely when there is work to do, which is a hidden stop button on
the whole pipeline.
Trace: `impl/src/host-capacity.mjs:274` `roomFor` (a kind other than `verify` returns true);
`leaseWeight` `:249` (worker weight `cores: 0, bytes: 0`). Test:
`impl/test/issue297-issue307-host-capacity.test.mjs:77` "HC-2"; `:182` "HC-4"; `:444` "HC-12".

### CAP-3 · runtime · A heavy request waits its turn, in order, with no deadline
Statement: An admission request is admitted once the derived budget has room and waits in order
until then, written as a visible queue entry carrying its position; acquiring carries no deadline,
and the queue-timeout refusal is never raised.
Plain explanation: When a big job cannot start yet because the machine's budget is spoken for, it
joins a visible waiting line with its place in it, and starts as soon as the jobs ahead finish.
There is no timer that gives up: a waiting job is never refused for having waited. Without this
law, long-running but legitimate work would be killed by an arbitrary clock just for queuing
behind other work.
Trace: `impl/src/host-capacity.mjs:704` `acquire` (`:712` the retry loop, `:739-746` the enqueue,
`:747-754` the queued row, `:767` the poll). Test:
`impl/test/issue512-suite-admission-refusal.test.mjs:150` "S512-3: a run behind another verify
lease waits and runs once it releases, or degrades at once on a host that cannot fund a suite -
never refused for waiting"; `impl/test/issue333-suite-verify-lease.test.mjs:191` "S333-4".

### CAP-4 · runtime · Only a full-suite verification is budgeted, at its measured cost
Statement: One verify lease charges the measured suite cost; only a verify is budgeted.
Plain explanation: Of all the things the system runs, only the full test-suite check is treated as
a big, budgeted expense, and it is charged what the suite actually measured — not a guess. All
other work is admitted without charging the budget. Without this law, ordinary work would be
crowded out by accounting meant only for the heaviest job, or the heaviest job would be admitted
without the room it really needs.
Trace: `impl/src/host-capacity.mjs:249` `leaseWeight`; `budgetFits` `:263` (`:265-266` the core
and byte comparisons). Test: `impl/test/issue297-issue307-host-capacity.test.mjs:77` "HC-2".

### CAP-5 · runtime · A machine that cannot fund a full suite says so at once
Statement: A host whose measured memory cannot fund one full suite answers at once with a
shortfall and no lease, and the caller proceeds without the lease.
Plain explanation: Some machines are simply too small to ever run the full test suite in one go.
On those, the system says so immediately — naming the shortfall — and the caller carries on
without the exclusive lease instead of waiting forever for something that will never fit. Without
this law, on a small machine every full-suite check would queue forever behind a condition no
amount of waiting could cure.
Trace: standing-property branch inside `acquire` `impl/src/host-capacity.mjs:725-727`, the
degraded answer `:756`, `memoryTightFor` `:258`; the caller's warning
`impl/scripts/suite-host-lease.mjs:103`. Test: `impl/test/issue333-suite-verify-lease.test.mjs:77`
"S333-1b"; `impl/test/issue512-suite-admission-refusal.test.mjs:150` "S512-3".

### CAP-6 · runtime · A dead holder's lease returns to the budget
Statement: A lease whose holder process is proved dead returns to the budget.
Plain explanation: When a job that reserved machine capacity dies without releasing its
reservation, the system checks whether the process is really gone and, if so, puts the reserved
capacity back for others to use. Without this law, crashed jobs would strand capacity forever,
and the machine would slowly stop accepting any new work.

Trace: the sweep `impl/src/host-capacity.mjs:714`; `livePid` `:117`. Test:
`impl/test/issue297-issue307-host-capacity.test.mjs:129` "HC-3: a proved-dead holder's lease
returns to the budget".

### CAP-7 · runtime · Releasing a lease requires the exact identity it was issued to
Statement: A release is identity-exact on nonce and resident id; a release naming a lease this
resident does not own is a no-op answering false.
Plain explanation: Capacity reservations are released only by the ticket's rightful holder: the
release must match the exact random serial and owner the ticket was issued with. Anyone else
trying to release it changes nothing and is told so. Without this law, one component could
accidentally cancel another's reservation and let a third job start on top of a running one.
Trace: `impl/src/host-capacity.mjs:773` `release` (`:781` the identity comparison). Test:
`impl/test/issue297-issue307-host-capacity.test.mjs:129` "HC-3" (assert `:146`);
`impl/test/issue333-suite-verify-lease.test.mjs:96` "S333-2" (assert `:105`).

### CAP-8 · runtime (unpinned) · Capacity records have closed field sets and a size ceiling
Statement: Lease, queue and observation records carry closed field sets and a byte ceiling; a
record outside the shape refuses, and an over-ceiling record is never stored or served.
Plain explanation: The small bookkeeping records that track who reserved what carry a fixed set of
fields and a hard size limit; anything with extra, missing, or oversized fields is rejected. This
keeps the reservation book honest and bounded — no record can smuggle in unlisted data or grow
until it chokes the readers. Without this law, a malformed or bloated record could corrupt the
capacity accounting the whole admission system depends on.
Trace: `impl/src/host-capacity.mjs:53` `RECORD_BYTE_CEILING`, `:54-55` `LEASE_FIELDS` and
`QUEUE_FIELDS`; `validateRecord` `:365` (`:367` the exact key set, `:369-372` the identity
bounds); the mode and ceiling guard in `readRecord` `:384-386`. Test: none pins the refusal path;
the sibling module's guard is pinned at `impl/test/issue500-worktree-capacity.test.mjs:129`
"500-cap-f" (assert `:151`).

### CAP-9 · runtime · The queue shows who is alive, and dead entries are swept
Statement: Every queue row reports whether its holder is alive, and a mutating read sweeps a
proved-dead entry.
Plain explanation: The waiting line for machine capacity shows, for every entry, whether the job
that asked for it still exists. When a reader with authority to change the line finds an entry
whose job has died, it removes that entry on the spot instead of leaving a ghost in the line.
Without this law, dead entries would clog the front of the line and every later job would wait
behind a corpse.
Trace: `impl/src/host-capacity.mjs:319` `projectParticipantVerify`; `observeParticipantVerify`
`:687` (`:691` the liveness filter). Test: `impl/test/issue506-queue-holder-liveness.test.mjs:52`
"HC-506-a"; `:79` "HC-506-c".

### CAP-10 · runtime · A memory collapse sheds at most one lease per episode, recorded once
Statement: A post-admission memory exhaustion sheds at most one verify lease per exhaustion
episode and records the shed once.
Plain explanation: If the machine runs short of memory after work has already been admitted, the
system relieves pressure by canceling exactly one big reservation and writes down that it did so —
never a cascade of cancellations, never an unrecorded one. Without this law, one tight moment
could cancel many running jobs, or a silent cancellation would leave accounting that no longer
matches reality.
Trace: `impl/src/host-capacity.mjs:305` `HOST_CAPACITY_SHED_ROW`; `DEFAULT_SHED_POLL_MS` `:66`.
Test: `impl/test/issue495-post-admission-shed.test.mjs:136` "S495-3: the shed is bounded to ONE
per exhaustion episode"; `:162` "S495-4"; `:342` "S495-6".

### CAP-11 · runtime · The suite's parallel width derives from current load, with an operator override
Statement: The suite runner's lane width derives from the host observation; a host at or above its
core count takes one lane, and the operator's environment setting overrides.
Plain explanation: How many pieces the big test-suite check splits into is computed from how busy
the machine is right now — a busy machine gets one piece, a free one gets several — and the human
operator may pin the number explicitly. Without this law, the suite would either stomp on a
machine that is already working or crawl on a machine that is idle.
Trace: `impl/src/host-capacity.mjs:345` `defaultSuiteParallelism` (`:347` reads
`capacity.saturated`). Test: `impl/test/issue424-seat-suite-lease.test.mjs:138` "S424-4";
`impl/test/issue297-issue307-host-capacity.test.mjs:223` "HC-6".

### CAP-12 · runtime · A nested run proves itself with the parent's own lease token
Statement: A nested runner is proved by the digest of the parent's lease token.
Plain explanation: When a running job starts another big job inside itself, the inner job may reuse
the outer job's capacity reservation only by presenting a fingerprint derived from the outer job's
own ticket — the parent vouches for the child, cryptographically. Merely claiming "I am inside
someone" is not accepted. Without this law, any process could dodge the reservation system by
declaring itself a child of a legitimate holder.
Trace: `impl/scripts/suite-host-lease.mjs:38` `suiteLeaseTokenDigest`; `suiteLeaseNested` `:50`.
Test: `impl/test/issue424-seat-suite-lease.test.mjs:65` "S424-1"; `:84` "S424-2";
`impl/test/issue333-suite-verify-lease.test.mjs:253` "S333-7".

### CAP-13 · runtime · The workspace capacity floor is computed from records, sealed, and enforced under lock
Statement: The worktree capacity floor is the ledger's estimate high-water plus the measured
runtime footprint; state is sealed with a keyed authentication code over canonical bytes, read
from a private root, and admission runs under one exclusive lock before any effect.
Plain explanation: The limit on how many worker folders may exist is computed from two recorded
numbers — the largest folder size seen so far plus what the running system itself occupies —
never guessed. The recorded state is protected against tampering with a cryptographic seal and
kept in a private directory, and all decisions about it are made while holding an exclusive lock,
before anything is created. Without this law, a corrupted or forged record could silently change
how many workspaces the system allows, or two simultaneous decisions could race each other.
Trace: `impl/src/worktree-capacity.mjs:158` `deriveWorktreeCapacityFloor`; `#effectiveFloor`
`:324`; `_seal` `:350`; `_read` `:378` (`:383` the mode and regular-file check, `:401-405` the
timing-safe comparison); `_ensureRoot` `:363` (`:371-374` the confinement checks). Test:
`impl/test/issue297-issue307-host-capacity.test.mjs:257` "HC-7";
`impl/test/phase59-worktree-capacity-authority.test.mjs:348` "WC3"; `:404` "WC4"; `:740` "WC14".

### CAP-14 · runtime · Releasing a reservation requires the exact token it was made with
Statement: A reservation is released by an exact token identity (id, owner, nonce); a token from
an earlier reservation cannot delete a later reservation that reused the same resource id.
Plain explanation: Folder-slot reservations are cancelled only with the exact ticket issued for
them, including its random serial. If a slot's id gets reused by a new reservation later, an old
ticket for the same id still cannot cancel the new one. Without this law, a stale cancellation
from long ago could silently destroy a reservation that is now live.
Trace: `impl/src/worktree-capacity.mjs:854` `releaseMany` (`:867-871` the identity comparison);
`release` `:789`. Test: `impl/test/phase59-worktree-capacity-authority.test.mjs:695` "WC12: stale
release token cannot delete a later reservation that reused the same resource id"; `:654` "WC10";
`:507` "WC5".

### CAP-15 · runtime · The capacity lock waits a bounded, measured time and never steals or deletes
Statement: The capacity lock wait runs on monotonic elapsed time with a configurable deadline; a
live holder past the deadline is refused pre-effect; an abandoned reaper gate is left in place; a
corrupt or ambiguous lock refuses at once and is left in place.
Plain explanation: Taking the capacity lock means waiting your turn while someone else holds it;
the wait is measured by a clock that cannot jump backwards and has a stated limit. If the holder
is alive but slow past that limit, you are refused cleanly, and their lock is left untouched —
never stolen or deleted — because a half-dead lock deleted by the wrong rule could let two
workers in at once. Without this law, a slow holder could be robbed mid-work, or a corrupted lock
file could be misread as "free".
Trace: `impl/src/worktree-capacity.mjs:42-45` the constants; the acquisition loop `:520-535`
(`:523` the deadline); `_lockNow` `:543`; `_waitSlice` `:587` (`:591` the refusal). Test:
`impl/test/worktree-capacity-contention.test.mjs:314` "WCC3"; `:421` "WCC6"; `:368` "WCC5";
`:455` "WCC7"; `:597` "WCC11".

### CAP-16 · runtime · One predicate decides capacity pressure for every reader
Statement: One predicate decides workspace capacity pressure, and the deployment summary and the
capacity notification both read it.
Plain explanation: "Is this system running out of workspace room?" has exactly one answer, computed
by one function, and every surface that reports or acts on pressure — the status summary and the
notification that something is tight — reads that same function. Without this law, the status
page could say all is well while notifications scream that the disk is full, and nobody could tell
which was right.
Trace: `impl/src/worktree-capacity.mjs:177` `workspaceCapacityPressure`. Test:
`impl/test/issue297-issue307-host-capacity.test.mjs:359` "HC-9";
`impl/test/wake-stream.test.mjs:248` "a deployment below its capacity floors wakes
capacity_pressure at attach".

### CAP-17 · runtime · A worker-count ceiling exists only where the operator configures it
Statement: A worker-concurrency ceiling is configured only by the deployment caller; null means
unbounded; an invalid value refuses at construction rather than coercing.
Plain explanation: The system does not secretly limit how many workers may run at once. Only the
person deploying it may set such a limit; leaving it unset means no limit; and a malformed value
stops the startup with a clear error instead of being quietly guessed into some number. Without
this law, a hidden limit would throttle the fleet for no stated reason, or a typo in the
configuration would be silently turned into an arbitrary cap.
Trace: `impl/src/concurrency-policy.mjs:15` `normalizeConcurrencyCeiling`; `withinConcurrencyCeiling`
`:25`. Test: `impl/test/concurrency-policy-admission.test.mjs:148` "REP-1"; `:182` "REP-2";
`:218` "DEP-2"; `:294` "ADM-4".

---

## Notifications (wake)

### WAKE-1 · runtime · Every notification kind comes from one closed table
Statement: Every wake row derives from exactly one entry of one closed class table; a second
mapping of the same log key is a construction error.
Plain explanation: The system pushes a small set of notification types to workers, and the list of
types is fixed in one table: every notification is produced by exactly one table entry, and no two
entries may claim the same underlying event. Adding a notification means adding it to the table,
not inventing a side channel. Without this law, two rules could both claim an event and workers
would get duplicated or contradictory notifications.
Trace: `impl/src/wake-stream.mjs:120` `WAKE_CLASS_TABLE`; `CLASS_BY_LEDGER_ROW` `:374` (`:378-379`
the duplicate-key throw); `wakeClassFor` `:398`. Test: `impl/test/wake-stream.test.mjs:100` "the
wake-class table derives every class from its own ledger row, and admits nothing else"; `:291`.

### WAKE-2 · runtime · Filtering notifications admits only the listed kinds
Statement: The filter vocabulary is the class table; an unknown class refuses and names the
closed set; an alias resolves to its class.
Plain explanation: A worker may ask to hear about only some notification types, but it must name
them from the fixed list — misspelled or invented types are refused with the list of what is
admitted. Harmless alternate spellings map to the same type. Without this law, a typo in a filter
would silently match nothing and the worker would wait forever for news it asked for.
Trace: `impl/src/wake-stream.mjs:340` `WAKE_CLASSES`; the alias index `:353-364`; `parseWakeFilter`
`:455` (`:470-474` the refusal). Test: `impl/test/wake-stream.test.mjs:128` "the filter admits
only the closed class set, and refuses an unknown class by naming the set";
`impl/test/wake-mcp-consumers.test.mjs:253` "an unknown wake class refuses with the closed set".

### WAKE-3 · runtime · Reconnecting to notifications resumes exactly where the reader left off
Statement: The cursor is the shared log's sequence number; a pull from `since=N` reads from N+1
and re-derives identical frames, so a reconnect has no gap and no duplicate.
Plain explanation: When a worker's connection to the notification feed drops and comes back, it
says "I last saw entry number N" and the feed resumes at N+1, delivering each missed item exactly
once. Nothing between the old position and now is skipped, and nothing is delivered twice.
Without this law, a dropped connection would either lose events or double-deliver them, and
workers would act on incomplete or repeated news.
Trace: `impl/src/wake-stream.mjs:619` `cursorOf`; `head` `:691`; `pull` `:759` (`:763` the resume
point, `:779-787` the derivation loop). Test: `impl/test/wake-stream.test.mjs:207` "the cursor
resumes from the last seq a consumer saw, with no gap and no duplicate";
`impl/test/wake-mcp-consumers.test.mjs:181`; `impl/test/swarm-wake.test.mjs:222`.

### WAKE-4 · runtime · A new feed connection starts at the current head
Statement: A pull with no cursor starts at the head, so an attachment begins at the current head.
Plain explanation: A freshly opened notification feed delivers what happens from now on; it does
not replay the entire past. A worker that wants history asks for it explicitly. Without this law,
every reconnect-by-accident would bury the worker under a flood of old events it had already
acted on.
Trace: `impl/src/wake-stream.mjs:763`. Test: `impl/test/wake-stream.test.mjs:145` "one attachment
receives the rows of every swarm the resident hosts, including one created after it".

### WAKE-5 · runtime · A reader left too far behind is told exactly what it missed
Statement: A consumer further behind than the replay bound receives a typed marker naming how many
rows it lost.
Plain explanation: The feed keeps a limited amount of history. If a worker was away so long that
part of the history has aged out, the feed does not pretend nothing happened: it sends a
structured "you fell behind" message stating exactly which entries are gone. Without this law, the
worker would silently believe it has seen everything and make decisions on a false picture.
Trace: `impl/src/wake-stream.mjs:766-773` (`:770` the dropped, from-seq, to-seq and cursor
fields). Test: `impl/test/wake-mcp-consumers.test.mjs:198` "a lagging stream tells the subscriber
how much it lost, in the stream's own typed frame" (assert `:209`).

### WAKE-6 · runtime · A changing condition announces its baseline, then its crossings
Statement: A standing-fault observation class is announced at attach and on each crossing; a
change-class observation establishes its baseline at attach.
Plain explanation: For notifications about a condition — like "the machine is low on room" — a new
listener immediately learns the condition's current state, and then hears each time it switches
between good and bad. The listener never has to guess the starting state. Without this law, a
worker would hear only the changes and could believe a condition is fine when it was already bad
before it started listening.
Trace: `impl/src/wake-stream.mjs:342` `OBSERVATION_CLASSES`; `_observationFrames` `:741` (`:750`
the announce-standing gate). Test: `impl/test/wake-stream.test.mjs:248` "a deployment below its
capacity floors wakes capacity_pressure at attach, and the CLI names the command that acts on it".

### WAKE-7 · runtime · Feed endings are a closed vocabulary, and the unknown maps to a safe default
Statement: The stream end reason and the attachment close reason are two closed vocabularies,
derived through one mapping for every transport; a status outside the vocabulary reads as a
transport close.
Plain explanation: When a notification feed ends, the reason it ended comes from a fixed list,
translated the same way no matter which connection technology carried it. A reason nobody
recognizes is reported as the honest default — "the connection closed" — rather than being shown
as a made-up code. Without this law, every transport would invent its own ending stories and
workers would misread why a feed stopped.
Trace: `impl/src/wake-stream.mjs:36` `WAKE_STREAM_END_REASONS`; `ATTACHMENT_CLOSED_REASONS` `:52`;
`attachmentClosedReason` `:57`; `attachmentClosedFrame` `:65` (`:66` the fallback);
`attachmentClosedReceived` `:81`. Test: `impl/test/issue356-wake-frame.test.mjs:221`; `:275`;
`:300`; `:319`.

### WAKE-8 · runtime · One feed carries everything the machine hosts
Statement: One attachment carries the rows of every group the machine hosts, including a group
created after the attachment, plus the machine-scoped rows.
Plain explanation: A worker opens one notification feed and receives news from all the groups on
its machine — including groups created after the feed was opened — plus machine-wide news. It
does not need one connection per group, and it never misses a group for being late. Without this
law, workers would silently miss notifications for parts of the system that did not exist when
they connected.
Trace: `impl/src/wake-stream.mjs:697` `_attribution`; `_swarmIds` `:717`. Test:
`impl/test/wake-stream.test.mjs:145`.

### WAKE-9 · runtime · A notification names what happened, never the content
Statement: A frame names the key it wrote and its actor and carries no body; only a terminal wake
carries the command that acknowledges it.
Plain explanation: A notification is a tap on the shoulder — it says which record changed and who
changed it, but it does not carry the record's contents, so an eavesdropper or a bug cannot leak
work material through the feed. And only notifications that ask the worker to act include the
exact next command. Without this law, the feed would either duplicate all the data (a leak risk)
or leave workers guessing what to do next.
Trace: `impl/src/wake-stream.mjs:531` `deriveWakeFrame`; `wakeMatches` `:488`; the table's `next`
field `:99-102` and `wakeRow` `:112`. Test: `impl/test/wake-stream.test.mjs:276` "#272: a context
wake names the key it wrote and its actor, never the body"; `:345` "terminal rows carry the
command that acknowledges them, and only terminal rows do".

### WAKE-10 · runtime (unpinned) · The push form parks on the shared log until there is news
Statement: The push form of watching parks on the shared log's wait primitive.
Plain explanation: A worker that wants to be pushed new notifications hands control to the shared
log's native waiting mechanism and is woken the moment a matching entry lands — it does not wake
up every few seconds to ask "anything yet?". The wait primitive itself is tested; the specific
connection between this watcher and the primitive is only exercised through the end-to-end
delivery tests. Without this law, notification waiting would degrade into constant polling,
burning cycles and adding delay to every delivery.
Trace: `impl/src/wake-stream.mjs:813` `watch`, `:828` the park; `waitAfter`
`impl/src/coordination-ledger-writes.mjs:761`. Test: the primitive at
`impl/test/coordination-ledger-writes.test.mjs:226` (assert `:243`); end-to-end:
`impl/test/issue316-sse-attachment-closed.test.mjs`, `impl/test/issue468-stream-errors.test.mjs`.

### WAKE-11 · runtime · The feed's version stamp is read on a schedule and degrades to none
Statement: The served-commit header is read once per pull on the deployment-observation cadence; a
supplier that cannot answer yields none.
Plain explanation: Notification frames can carry a "which version of the code is serving you"
stamp, but asking for it on every single event would be wasteful, so it is refreshed on a
schedule. If the answer cannot be obtained, the stamp is simply absent rather than a stale or
fabricated value. Without this law, workers could believe they are talking to a version of the
system that is no longer running.
Trace: `impl/src/wake-stream.mjs:678` `_servedFor` (`:681` the cadence guard, `:683-684` the
null-on-failure read). Test: `impl/test/issue316-provider-degraded.test.mjs:624` "316-c" (assert
`:655`, `:658`).

### WAKE-12 · runtime · A page of history is bounded and names its remainder
Statement: A pull page is bounded by the transport frame ceiling and names the remainder through a
typed continuation.
Plain explanation: When a worker asks for old notifications in bulk, each answer is capped at the
size any transport can carry, and the answer states explicitly "there is more, from here" with the
position to resume from. Without this law, a large history request would either be silently cut
short (and the worker would think that was everything) or grow until the connection breaks.
Trace: `impl/src/wake-stream.mjs:617` `DEFAULT_REPLAY_LIMIT`; `since` `:803` (`:806` the page
frame). Test: `impl/test/wake-mcp-consumers.test.mjs:232` "the pull page is bounded by the
transport frame ceiling, never by a row count"; `impl/test/issue507-wakes-since-cli.test.mjs:117`
"507-a"; `:168` "507-b".

### WAKE-13 · runtime · The wire protocol enforces its own framing rules
Statement: A local-loop feed client frame must be masked; an unmasked one is a protocol error
closing with code 1002; a server frame is unmasked; a frame over the wire ceiling closes with
1009.
Plain explanation: The notification socket speaks a standard wire protocol with strict rules about
how messages are wrapped and sized: client messages must carry the standard scrambling, server
messages must not, and no message may exceed the agreed size. Violations end the connection with
the standard error codes instead of being tolerated. Without this law, a malformed client could
poison the feed for everyone, or an oversized message could exhaust memory.
Trace: `impl/src/wake-stream.mjs:1018` `encodeServerFrame`; `createFrameReader` `:1038` (`:1054`
and `:1057` the 1009 close, `:1058` the 1002 close). Test: `impl/test/wake-binding.test.mjs:55`
"a declared loopback binding serves the same wake stream to an authenticated WebSocket client,
and refuses an anonymous one".

---

## The shared log

### LEDG-1 · runtime · The log is append-only and its entry numbers have no gaps
Statement: The ledger is append-only and a row's sequence number is its one-based index; a row
whose number is not its index refuses with `sequence_gap`.
Plain explanation: The shared log of everything that happened can only be added to, never edited
or reordered, and the Nth line of the file must carry exactly the number N. At startup the log is
checked for that property, and any tampering, truncation or out-of-order insertion is refused
before the system uses it. Without this law, the log could not be trusted as the system's memory:
renumbered or reordered history would silently change what the workers believe happened.
Trace: seq assignment `impl/src/coordination-ledger.mjs:1199`; the replay check
`impl/src/coordination-replay.mjs:524`. Test: `impl/test/phase11-coordination-store.test.mjs:204`
(assert `:207`).

### LEDG-2 · runtime (half unpinned) · Torn or wrongly-encoded log bytes are refused
Statement: A log tail with no trailing newline refuses with `truncated_tail`; a stretch that is
not valid UTF-8 refuses with `invalid_utf8`.
Plain explanation: Each log entry is one complete line of text ending in a newline, written in one
standard character encoding. If the file ends mid-line (a crash while writing) or contains bytes
that are not valid text in that encoding, the system refuses to guess and names the defect. The
mid-line case is tested; the wrong-encoding case is enforced but not. Without this law, a
half-written or corrupted entry could be silently accepted as real history.
Trace: `impl/src/coordination-replay.mjs:464-466` `truncated_tail`; `_ledgerLines` `:493-499`
`invalid_utf8`. Test: `truncated_tail` at `impl/test/phase11-coordination-store.test.mjs:204`; no
test names `invalid_utf8`.

### LEDG-3 · runtime · Writing the same thing twice under one key happens once
Statement: The idempotency key is the write identity: a repeat returns the original event; a
duplicate key found in an existing log refuses at replay with `duplicate_key`.
Plain explanation: Every entry is written under a caller-chosen key. If the same key is presented
again — because a message was retried after a timeout — the system does not add a second copy; it
answers with the first entry it already recorded. A file that somehow contains two entries with
one key is refused as corrupt. Without this law, retries would double-count events, and the same
action would appear to have happened twice.
Trace: the key replay `impl/src/coordination-ledger.mjs:1192-1193`; the key field on the row
`:1199`; the replay check `impl/src/coordination-replay.mjs:525-527`. Test:
`impl/test/phase11-coordination-store.test.mjs:36` (the duplicate-key row returning the original
event); `:204`.

### LEDG-4 · runtime · Only the current writer may append, and losing that role is a named event
Statement: Only the writer-lease holder may append; lease loss is typed; replacement is detected
on token, process id and process start.
Plain explanation: At any moment exactly one writer is allowed to add to the log, and it must hold
a current, unexpired ticket. The system recognizes a replaced writer by comparing three
independent marks — a random token, the process id, and when that process started — so a recycled
process id cannot impersonate its predecessor. Without this law, an old writer that everyone
believes dead could wake up and interleave entries into history.
Trace: the guard `impl/src/coordination-ledger.mjs:1184`; `_assertWriterLease`
`impl/src/coordination-admission.mjs:201`; `_assertLeaseOwnership` `:220-231`; `claimWriterLease`
`impl/src/coordination-ledger-writes.mjs:493`. Test: `impl/test/phase42-policy-invalidation.test.mjs:137`
(assert `:138`, `:141`); `impl/test/phase56-drain-and-close.test.mjs:499` (assert `:502`).

### LEDG-5 · runtime · A writer's claim ticket is a short, fail-closed exclusion window
Statement: A writer claim is a short fail-closed exclusion window; a live or ambiguous claimant is
left in place; a stale claim is removed.
Plain explanation: Taking over the writer role starts by dropping a short-lived claim ticket. If
another writer's ticket is present and might still be live — or cannot be proven dead — the
taker stops and leaves it alone; only a provably expired ticket is cleaned away. Without this
law, a takeover during a hiccup could evict a writer that was actually still working.
Trace: `impl/src/coordination-ledger-writes.mjs:502-530` (`:514` the stale unlink, `:515` the
ambiguous refusal, `:518-521` the live-claimant refusal). Test:
`impl/test/phase42-policy-invalidation.test.mjs:137` (assert `:158`, `:159`, `:160`).

### LEDG-6 · runtime · Releasing the writer role flushes first, and a failed flush stops durable writes
Statement: A clean release flushes the pending group-commit before dropping the lease; a failed
sync refuses further durable writes with `coordination_ledger_unsynced` while readers continue.
Plain explanation: When the log writer steps down, it first pushes everything it promised to
durable storage; if that push fails, the writer refuses to accept new entries (naming the reason)
rather than pretend they are safe — although reading what is already there continues. Without
this law, a crash right after a "successful" write could lose entries the rest of the system
already counted on.
Trace: `impl/src/coordination-ledger-writes.mjs:560-565`; `impl/src/coordination-admission.mjs:208-216`.
Test: `impl/test/issue290-ledger-sync.test.mjs:22`, `:38`, `:47`.

### LEDG-7 · runtime · A fault in building the summary poisons the summary, never the log
Statement: A fold failure poisons the projection and names the sequence number and the cause; the
durable log stays authoritative, readers continue, and a restart with replay repairs.
Plain explanation: The system keeps a running summary of the log for fast answers. If computing
that summary ever fails, the failure freezes the summary — with the exact entry and reason named —
but the log itself is untouched, readers can still use it, and a restart rebuilds the summary from
scratch. Without this law, one bad entry could take down the record of truth along with the
convenience view built on top of it.
Trace: `_poisonProjection` `impl/src/coordination-ledger.mjs:1166` (`:1167` the first-write-wins
freeze); `impl/src/coordination-admission.mjs:202-207`. Test:
`impl/test/issue290-quarantine.test.mjs:30`; `impl/test/issue290-prospective-fold.test.mjs:63`.

### LEDG-8 · runtime · A log entry the rules reject is a typed startup refusal naming everything
Statement: A recorded row the fold rejects is a typed startup refusal naming the sequence number,
the kind, the fold's own code and the remedy, raised at the replay fold site.
Plain explanation: If an entry already written in the log breaks the system's own rules, the
system refuses at startup with a structured error that says exactly which entry, what kind it
claimed, which rule it broke, and what to do about it. It does not skip the entry or crash with a
vague error. Without this law, one malformed entry would make the whole system unexplainable —
either silently ignored (history rewritten) or fatal with no clue where the problem is.
Trace: `SwarmReplayRefusal` `impl/src/coordination-ledger.mjs:151` (`:154-162` the message,
`:164-169` the fields); `foldRow` `impl/src/coordination-replay.mjs:537-548`. Test:
`impl/test/issue304-fold-admission-gate.test.mjs:16`.

### LEDG-9 · runtime · Quarantine of a bad entry is idempotent, conflict-checked, and written safely
Statement: Quarantine is idempotent for the same entry and conflicting for a different entry; the
entry file is written temp, flushed, renamed, at a private mode.
Plain explanation: When a log entry is moved aside into quarantine, quarantining the identical
entry again changes nothing, while quarantining a different entry under the same name is refused
as a conflict. The quarantined copy is written so it either fully appears or not at all, and only
privileged users can read it. Without this law, retrying a quarantine could pile up duplicate or
contradicting copies of the evidence.
Trace: `writeQuarantineEntry` `impl/src/coordination-ledger.mjs:103` (`:106-112` the duplicate and
conflict decision, `:118-123` the atomic write). Test: `impl/test/issue290-quarantine.test.mjs:72`;
`:120`.

### LEDG-10 · runtime · Compaction archives before rewriting, and any drift or bad cut is refused
Statement: Compaction archives a prefix into content-addressed immutable segments; the index is a
cache; the segment lands before the ledger rewrite; divergence refuses as
`coordination_compact_ledger_drift`; a mismatched cut refuses as
`coordination_compact_cut_mismatch`.
Plain explanation: To keep the log small, old entries are copied into immutable archive files
whose names are fingerprints of their content, and only after the archive is safely on disk is
the live log shortened. If the log changed underneath the compaction, or the cut does not match
what was archived, the operation refuses by name and changes nothing. Without this law, a
compaction race could permanently delete entries that were never archived.
Trace: `compact` `impl/src/coordination-ledger-writes.mjs:646` (`:651` the cut bound, `:663-667`
the drift refusal, `:686-689` the cut mismatch); `_writeSegment` `:600` (`:606` the idempotent
content-addressed write); `_writeSegmentIndex` `:625`. Test:
`impl/test/ledger-compaction-223-red.test.mjs:71`; `:143`.

### LEDG-11 · runtime · The summary checkpoint is housekeeping, never authority
Statement: The projection checkpoint is written off the request path, coalesced to one pending
write, and bounded by its own size ceiling; the ledger stays authoritative.
Plain explanation: The system periodically saves its fast summary to disk so restarts are quick,
but that saved summary is a convenience only — the log remains the truth. Saving never blocks a
caller, repeats collapse into one pending save, and the summary file has a size cap. Without this
law, checkpoint writing could add delays to real work, or an ever-growing summary file could
become a second, competing record of history.
Trace: the interval decision `impl/src/coordination-ledger.mjs:1217-1234` (`:1224-1233` the
deferred and coalesced write); `_boundedCheckpointWrite` `:897` (`:901-905` the deferred skip);
`impl/src/limits.mjs:375-378`. Test: `impl/test/issue366-run-stop-replay-ceiling.test.mjs:361`;
`impl/test/issue351-startup-answer.test.mjs:366`.

### LEDG-12 · runtime · The log opens through one replay path, all or nothing
Statement: The replay fold runs through one path for the synchronous open and the async open; a
half-loaded store does not survive a failed open.
Plain explanation: However the system starts — waiting for the log to load or loading it in the
background — the exact same replay routine reads it, and if loading fails there is no
half-initialized state left behind to answer questions wrongly. Without this law, the two startup
styles could drift into disagreeing about the past, and a failed load could leave a store that
answers from partial history.
Trace: `_loadRun` `impl/src/coordination-replay.mjs:501-506` (the shared generator and `:515`
`store._loading`); `_apply` `impl/src/coordination-ledger.mjs:2314`. Test:
`impl/test/phase11-coordination-store.test.mjs:220` "CK2"; `:243` "CK2: terminal state is
immutable across replay".

### LEDG-13 · runtime · Pointing at a summary entry resolves only through the declared grammar
Statement: A projection reference of kind and sequence resolves only through the declared
reference grammar; a kind outside the table, a sequence outside the log, or a disagreeing row
resolves to null.
Plain explanation: Some records point at other records by kind and position ("the summary entry of
this kind at this number"). Such a pointer resolves only when the kind is a known kind, the
position exists, and the entry found there really is of that kind; anything else answers "nothing
here" instead of guessing. Without this law, a stale or forged pointer could make the system read
one record as another.
Trace: `PROJECTION_REFERENCES` `impl/src/coordination-ledger.mjs:52`; `_projectionReferenceValue`
`:739` (`:743-746` the four rejections). Test: `impl/test/issue465-second-copies.test.mjs:221`
(assert `:245`, `:254-257`), `:262` (assert `:312-314`), `:166` (`:196`).

### LEDG-14 · runtime · Searching back through the log walks bounded windows
Statement: The reverse lookup of the last matching event walks back from the tail in clone-free
bounded windows of 256 rows as far as the first entry.
Plain explanation: When the system needs to find the most recent log entry matching something, it
walks backwards in fixed-size chunks from the newest entry, holding only the chunk it is looking
at, all the way to the beginning if needed. The search always makes progress and never copies the
whole log into memory. Without this law, a backward search could stall on a huge log or exhaust
memory on a busy system.
Trace: `WAITING_ON_TAIL_SCAN_CHUNK` `impl/src/application-observation.mjs:402`;
`lastCoordinationEvent` `:404` (`:411-419` the windowed walk); `eventCursor`
`impl/src/coordination-ledger.mjs:3567`; `eventsView` `:3571`. Test:
`impl/test/issue140-waiting-on-tail-read.test.mjs:105`; `:132`; `:173`.

### LEDG-15 · runtime (unpinned) · A pre-write gate may check but never change
Statement: An append's before-write gate must not change state; a gate that appends refuses with
`causal_correction_integrity`.
Plain explanation: Some writes allow a final "is this allowed?" check just before the entry is
recorded. That check is allowed to look at the current state but strictly forbidden to modify it
— including by sneaking in its own log entries. If it does, the write is refused by name. Without
this law, a check could quietly rewrite history as a side effect of judging it, and the log would
no longer match what callers were told happened.
Trace: `impl/src/coordination-ledger.mjs:1200-1204`. Test: none; no test names
`causal_correction_integrity`.

### LEDG-16 · runtime · No write lands while the log is still loading
Statement: An append is refused before a deferred open's replay resolves, with
`coordination_store_loading`.
Plain explanation: When the system starts and the log loads in the background, any attempt to add
a new entry before loading finishes is refused with a clear "still loading" answer. The system
never writes new history on top of history it has not finished reading. Without this law, an
early writer could append an entry that lands before the older entries it logically depends on.
Trace: `impl/src/coordination-ledger.mjs:1187-1189`. Test:
`impl/test/issue434-deferred-open-reconstruction.test.mjs:75`; `:43`.

### LEDG-17 · runtime · New entries are judged by the same rule that will later read them
Statement: A recorded payload is judged prospectively by the fold's own rule before the durable
append; the fold rule and the write gate are one function.
Plain explanation: Before an entry is written into the log, it is checked by the very same code
that will later apply that entry when the log is replayed — one function, two uses. An entry that
would fail replay is refused before it is ever written. Without this law, the system could accept
entries it would later choke on at startup, planting a delayed failure in its own history.
Trace: `assertWaveStartedRoster` `impl/src/coordination-ledger.mjs:80` (shared by the replay fold
and the write gate); the call `:1195-1198`; `_validateRecordedPayload`
`impl/src/coordination-admission.mjs:233` (`:242-246`). Test:
`impl/test/issue290-prospective-fold.test.mjs:20`; `:47`.

### LEDG-18 · runtime · The login-record log is a second append-only log with its own durability law
Statement: The session ledger is a second append-only log with its own durability law:
`truncated_tail`, `sequence_gap` naming line, sequence and both writers, and `schema_version`.
Plain explanation: Login and session records are kept in their own append-only file with the same
kind of integrity guarantees as the main log: torn writes, out-of-order numbering, and wrong
version records are refused — and a numbering conflict names the exact line, the number, and both
writers involved. Without this law, the security-sensitive record of who is connected could be
corrupted silently or by two writers stepping on each other.
Trace: `_lines` `impl/src/web-auth.mjs:70` (`:73` `truncated_tail`); `_consume` `:80` (`:84`
`schema_version`, `:85` `sequence_gap`); the append that numbers from disk `:92-98`. Test:
`impl/test/issue487-session-ledger-dual-writer.test.mjs:55`; `:89`; `:123`.

### LEDG-19 · runtime · Cursors are entry numbers, and only real ones wait
Statement: The head is the event count; a cursor past the head refuses; every wait arms from the
head.
Plain explanation: Workers track "how far along the log I am" with an entry number. A number
beyond anything the log contains is refused rather than accepted and silently waited on. New
waits start from the log's actual end. Without this law, a worker holding a bogus position could
wait forever for events that cannot exist, or misnumber its place and skip real events.
Trace: `ledgerHeadSeq` `impl/src/coordination-ledger.mjs:5580`; `eventCursor` `:3567`;
`waitAfter` `impl/src/coordination-ledger-writes.mjs:761` (`:762-768` the argument validation,
`:769` the immediate answer). Test: `impl/test/evidence-search-deployment.test.mjs:89` (assert
`:97`); `impl/test/coordination-ledger-writes.test.mjs:226` (assert `:243`);
`impl/test/phase66-run-continuation-export.test.mjs:205` (assert `:206-210`).

### PROP-1 · proposed · A log read is bounded by law, not by each reader's discipline
Statement: A ledger read is bounded; today the bounds exist per reader, with no single predicate
stating the law.
Plain explanation: Reading from the shared log should always come with a stated size or window
limit, no matter which part of the system is reading. Today some readers impose their own limits
individually, but nothing requires it. Without this law, a future reader could load an unbounded
stretch of history into memory and take the whole system down with it.
Trace: partial evidence: `WAITING_ON_TAIL_SCAN_CHUNK`
`impl/src/application-observation.mjs:402`; `impl/src/limits.mjs:375-377`;
`impl/test/issue140-waiting-on-tail-read.test.mjs` (6 passing tests). No runtime predicate states
the law.

### PROP-2 · proposed · Replay of any log the writer accepted must produce a working summary
Statement: The fold is total over recorded history: replay of any ledger the appender accepted
produces a projection.
Plain explanation: Whatever the log-writing rules let in, the log-reading rules must be able to
process — there is no entry that can be written but never read back. Today this is defended piece
by piece (pre-write checks, quarantine, review gates) but no single rule states it. Without this
law, the system could one day write an entry it can never start up with.
Trace: partial evidence: `impl/test/issue290-prospective-fold.test.mjs` and
`impl/test/issue304-fold-admission-gate.test.mjs` pass; no runtime predicate states the law.

### PROP-3 · proposed · One writer per log, stated as one law across both logs
Statement: One writer per ledger; today the two arms — the main log's writer lease and the
session log's numbering rule — are pinned separately with no single law joining them.
Plain explanation: Each of the system's append-only records should allow exactly one writer at a
time, as a single stated principle. Today the main log enforces this with a lease and the login
record enforces it with numbering checks, each separately. Without this law, a new kind of log
could be added with no single-writer rule at all.
Trace: partial evidence: `impl/test/phase42-policy-invalidation.test.mjs:137`;
`impl/test/issue487-session-ledger-dual-writer.test.mjs:55`, `:89`, `:123`.

---

## Closed shapes on the coordination surface

### CS-01 · runtime · The set of events a caller may send is fixed at thirteen
Statement: The public event vocabulary is a frozen thirteen-kind set; an unknown kind is refused
at the command contract with the admitted set, and again at the durable fold as an unknown kind.
Plain explanation: Workers coordinate by sending events, and the list of event types they may send
is a fixed list of thirteen, known in advance. Anything not on the list is refused with the list
of what is allowed, at the front door and again before anything is recorded. Without this law, a
misspelled or invented event type could sneak in and later break the system when it replays its
history.
Trace: `impl/src/swarm-contract.mjs:10-29` `SWARM_EVENT_KINDS` (field rule `:653-656`,
`swarmClosedSetAdmitted` `:138-144`); `impl/src/swarm-state.mjs:414-417`. Test:
`impl/test/swarm-state.test.mjs:92` "unknown kind throws SwarmRefusal";
`impl/test/issue372-closed-sets-taught.test.mjs:33` "372-a".

### CS-02 · runtime · The schema table and the event list can never disagree
Statement: Module load throws when the payload schema keys disagree with the event kinds, and
driver-row kinds are load-time disjoint from the caller-submittable set.
Plain explanation: The system keeps two lists that describe events: the types a caller may send,
and the detailed field descriptions for each. When the program starts, it checks the two lists
match exactly, and it also checks that internal bookkeeping event types are kept separate from
caller-sendable ones. Without this law, a developer could add an event to one list and forget the
other, and callers would hit a mismatch only as a confusing failure later.
Trace: `impl/src/swarm-contract.mjs:51-57` load checks. Test:
`impl/test/swarm-event-schemas.test.mjs:32` "the payload schemas describe exactly the public
swarm.update event kinds"; `impl/test/swarm-refusals.test.mjs:188` "the log replays refusals
byte-identically, and no caller can fabricate one".

### CS-03 · runtime · A command's arguments are exactly its declared ones
Statement: An argument key outside the command's declared argument list refuses, naming the rule
and carrying the admitted fields.
Plain explanation: Each command accepts a specific set of named options; passing an option the
command does not declare is refused immediately, and the refusal lists the options that do exist.
Without this law, a misspelled option would be silently ignored and the command would run with a
default the caller never intended — the classic silent-misbehavior trap.
Trace: `impl/src/swarm-contract.mjs:869-875`. Test:
`impl/test/issue372-closed-sets-taught.test.mjs:49` "372-b".

### CS-04 · runtime · Identity-keyed commands refuse a retry key
Statement: The capture and check commands carry their identity in their coordinates; an
idempotency key on them refuses with rule identity-keyed before any effect.
Plain explanation: Two system commands get their identity from what they point at — what they
capture or check — so attaching an extra "retry key" to them is refused up front, before anything
happens. Without this law, a caller could believe two such commands are the same retry of one
action when they are actually two different actions, or vice versa.
Trace: `impl/src/swarm-contract.mjs:864-868`. Test:
`impl/test/swarm-native-bridge.test.mjs:948` "an explicit idempotencyKey on an identity-keyed
command is refused by name, before any effect".

### CS-05 · runtime · A refused value teaches the admitted list
Statement: A value outside a closed-set field refuses with the closed-set rule and a message of
the form "field must be one of: ...", composed from the same table the validator judges.
Plain explanation: When a caller supplies a value from a fixed list — a mode, a priority, a status
— and gets it wrong, the error message does not just say "invalid": it names the field and lists
every acceptable value. The list comes from the same table the check itself uses, so they can
never disagree. Without this law, callers would have to guess the right spelling by trial and
error.
Trace: `impl/src/swarm-contract.mjs:886-894` (+ `:138-144`). Test:
`impl/test/issue372-closed-sets-taught.test.mjs:33` "372-a";
`impl/test/issue373-read-only-recruit.test.mjs:151` "#373 (c)".

### CS-06 · runtime · An event payload carries no unlisted fields
Statement: A payload key the event schema does not know refuses, naming the event's fields, before
any authority check or fold.
Plain explanation: Each event type declares exactly which data fields it accepts; sending an event
with an extra, undeclared field is refused immediately, and the refusal lists the fields that do
exist. Without this law, a caller could bury extra data inside an event believing it was
delivered, when in fact it was silently dropped or, worse, stored where nothing would read it.
Trace: `impl/src/swarm-contract.mjs:923-935`. Test:
`impl/test/swarm-refusals.test.mjs:131` "each refusal family records its own coordinates" (rule
pinned at `:149`).

### CS-07 · runtime · Missing required fields are refused with their expectations, and only the caller's fields are required
Statement: A missing caller-required payload field refuses, carrying each field's schema
expectation; fields the system fills in itself stay caller-optional.
Plain explanation: For each event type, some fields must come from the caller and some are filled
in automatically. Omitting a required field produces an error naming the field and what kind of
value it expects; the automatic ones are never demanded. Without this law, callers would omit
fields and get mysterious downstream failures, or be forced to supply bookkeeping values that are
not theirs to supply.
Trace: `impl/src/swarm-contract.mjs:911-922, 936-946`; `impl/src/swarm-event-schemas.mjs:447-449`.
Test: `impl/test/swarm-event-schemas.test.mjs:65` "contract admission refuses exactly the
caller-supplied fields, naming field and expectation".

### CS-08 · runtime · Double-encoded reports are refused with the fix, not stored
Statement: A body, or whole payload, that is a string parsing to a JSON document refuses with the
re-encode remedy before translation or fold.
Plain explanation: A report should be sent as structured data. If someone sends structured data
that was accidentally converted to text twice — a text string that itself parses as data — the
system refuses it and says "send it as data, not as a string of data". Without this law, such a
report would be stored as text, and every reader would see garbage like one field per character.
Trace: `impl/src/swarm-contract.mjs:563-588` `swarmEncodedReportBody`, admission checks `:902-909`
and `:947-952`. Test: `impl/test/issue481-string-body-refused.test.mjs:181` "#481 (a)".

### CS-09 · runtime · Views are sliced only in the ways the table declares
Statement: The projection argument admits only keys of the frozen view-projections table; the
slicer is the one definition of each slice and refuses the same set.
Plain explanation: Readers can ask for a reduced view of a record — say, just the summary fields —
but only from a fixed menu of prepared views, defined in one table. Anything off the menu is
refused, and the one function that cuts views is the only definition of each. Without this law,
different parts of the system would invent their own view variants and a name would mean
different things in different places.
Trace: `impl/src/swarm-contract.mjs:89-115` `SWARM_VIEW_PROJECTIONS`, `swarmViewProjection`
`:146-152`, field rule `:665-668`. Test: `impl/test/swarm-view-slices.test.mjs:94` "every
projection answers its own slice, keeps the frame, and the default stays the whole record"
(unknown refused at `:136-139`); `:157` "the projection slicer is the one definition of a slice".

### CS-10 · runtime · Recruit mode is exactly change or read-only
Statement: Recruit `mode` admits exactly {change, read_only}, declared once and read by the field
rule, the closed-set refusal, and the interface's own schema.
Plain explanation: When a worker is brought in, it is either allowed to make changes or explicitly
restricted to look-but-don't-touch; there are exactly those two options, defined in one place. The
same two values appear in the error messages and in the machine-readable command descriptions.
Without this law, a third unintended mode could appear in one surface but not others, and callers
would not know which behaviors a worker really has.
Trace: `impl/src/swarm-contract.mjs:123, 639-642, 1044-1045`. Test:
`impl/test/issue373-read-only-recruit.test.mjs:151` "#373 (c)".

### CS-11 · runtime · Message priority is exactly next-boundary or now
Statement: Guidance priority admits exactly {next_boundary, now}, declared once and read by the
field rule, the admitted list, and the interface schema.
Plain explanation: A message to a working worker can ask for two levels of urgency: handle it at
the next natural stopping point, or handle it immediately. Those are the only two levels; a
request for any other urgency is refused with the list. Without this law, senders would invent
urgency levels the receiver does not implement, and urgent messages could silently degrade.
Trace: `impl/src/swarm-contract.mjs:132, 645-648`. Test:
`impl/test/issue273-guidance-runtime.test.mjs:168` "273-b" (set pinned at `:157-159`).

### CS-12 · runtime · Lifecycle states are frozen sets shared by checker and descriptions
Statement: Work status, assignment/claim status, and review decision validate against frozen
module sets and refuse invalid values naming the set.
Plain explanation: Words like "open", "completed", "accepted", "rejected" describe the states of
work items and reviews, and each such list of words is fixed in one place and used both by the
checker and by the generated documentation. A value outside the list is refused with the list.
Without this law, two components could disagree about what states exist, and an item could get
stuck in a state one component does not recognize.
Trace: `impl/src/swarm-state.mjs:92-94`, checks `:510-512, 664-666, 894-896, 944-946`. Test:
`impl/test/swarm-state.test.mjs:165, 172, 179`.

### CS-13 · runtime · A policy update names known fields with known values, at least one
Statement: The policy event names only the frozen policy fields with values from the frozen mode
sets, and names at least one field.
Plain explanation: When the operator changes how the group should behave in a fault — say, how to
re-route work — the change is sent as a set of named settings, each of which must be a known
setting with a known kind of value, and at least one setting must be named. Without this law, a
policy update could contain gibberish settings that are stored but never acted on, or an empty
update that looks like a decision but decides nothing.
Trace: `impl/src/swarm-state.mjs:766-790` policy branch (sets at `:100, 109-110`). Test:
`impl/test/issue443-reroute-on-provider-fault.test.mjs:229` "443-a2" (unknown field named at
`:258-267`).

### CS-14 · runtime · A claim points at exactly one thing
Statement: A claim names exactly one of a work item or a set of paths; path entries are
repo-relative and name no parent-directory or current-directory segments.
Plain explanation: When a worker claims ownership of work, it must claim either a named work item
or a set of file paths — never both at once, never neither. Paths must be written relative to the
project root and may not wander upward outside it. Without this law, a claim could be ambiguous
about what it covers, or a crafted path could point outside the project entirely.
Trace: `impl/src/swarm-state.mjs:659-666` + `validClaimPaths:208-220`. Test:
`impl/test/issue423-claims-proposals-state.test.mjs:128`.

### CS-15 · runtime · A proposal plan has exactly two parts, each strictly shaped
Statement: A proposal plan carries only work and claims; each work entry names a work item and an
objective once; each claims entry names exactly one of work item or paths.
Plain explanation: A worker proposing a plan submits it in a fixed shape: a list of work items to
create (each named and described exactly once) and a list of claims (each pointing at one thing).
Anything else in the plan is refused. Without this law, plans could smuggle extra instructions or
ambiguous entries, and the workers receiving them would each interpret the plan differently.
Trace: `impl/src/swarm-state.mjs:289-315` `validProposalPlan`. Test:
`impl/test/issue423-claims-proposals-state.test.mjs:230`.

### CS-16 · runtime · Every error code is defined exactly once, in one table
Statement: Every code the fold or the runtime raises has exactly one row in the refusal table
carrying status, raiser and rule; both refuse helpers mint through the table, so an untabled code
is a construction-time error; the web status map derives from the table.
Plain explanation: Every distinct error the coordination system can produce is listed exactly once
in a single table, together with its web status, who may raise it, and the rule it names. Code
that raises errors must go through a helper that accepts only listed codes, so inventing a new
error without documenting it stops the program instead of shipping. Without this law, the same
failure would be described differently on different surfaces, and clients could not reliably
distinguish one error from another.
Trace: `impl/src/swarm-refusals.mjs:35-186, 203-207`; wired at `impl/src/swarm-state.mjs:178-185`
and `impl/src/swarm-runtime.mjs:210-213`. Test:
`impl/test/issue430-swarm-refusal-set.test.mjs:215` "#430 (a)" (static scan over both raise
sites), `:258` "#430 (b)", same-rule pairs `:267`.

### CS-17 · runtime · A work report validates against one published shape
Statement: A contract-claiming body validates against the one contribution schema: unknown fields
at any level refuse; type, required and enum refusals carry field, rule and expectation read from
the schema object the brief renders.
Plain explanation: When a worker reports finished work in the structured format, the report is
checked against one published template — the same template shown to workers in their
instructions. Extra fields are refused at every level of the report, and every complaint names the
field, what was wrong, and what was expected. Without this law, reports would arrive in shapes
their readers cannot parse, and each reader would enforce its own private version of the format.
Trace: `impl/src/contribution-contract.mjs:162-241` `validateContributionContract`,
`contractRefusal:137-141`, schema `:49-115`. Test:
`impl/test/issue310-contribution-contract.test.mjs:164` "(e)";
`impl/test/issue371-contract-example.test.mjs:101, 116, 129, 142`.

### CS-18 · runtime · A report item's status is one of three exact words
Statement: items[].status admits exactly {delivered, partial, not_delivered}, the frozen set
reused by schema, validator, and brief.
Plain explanation: Each line of a work report says how far it got, and the only allowed answers
are "delivered", "partial", or "not delivered" — the same three words everywhere the status is
shown or checked. Without this law, a worker could write "mostly done" or "success-ish", and
readers would have to guess whether the work actually landed.
Trace: `impl/src/contribution-contract.mjs:29, 200-202`. Test:
`impl/test/issue310-contribution-contract.test.mjs:164` "(e)" (status assert at `:172`).

### CS-19 · runtime (unpinned) · The landing receipt has a closed payload shape
Statement: A landing-recorded payload carries exact commit ids for base, head-before and squash;
head-after as commit-or-null; target; changed paths; a gates object; a positive-integer-or-null
issue; and a boolean dry-run flag.
Plain explanation: When a piece of work is merged, the system records a receipt of exactly what
happened: which commits were involved, what moved where, which files changed, what checks ran,
which issue it closes, and whether it was a rehearsal. Every field's type is fixed. This shape is
enforced but not directly tested. Without this law, downstream readers of the receipt would have
to guess which fields exist and what they mean.
Trace: `impl/src/swarm-state.mjs:951-996`. Test: none directly; nearest hits are fixture rows at
`impl/test/issue296-swarm-integrate.test.mjs:254` and
`impl/test/issue441c-situation-one-derivation.test.mjs:215`.

### CS-20 · runtime · The schema descriptions are checked for well-formedness at load
Statement: Every required schema field carries an expectation; shipped examples carry exactly the
caller-required fields and none of the auto-filled ones; the schema declares no size or count
caps; every driver row is fully described.
Plain explanation: The documented descriptions of every command and event are themselves checked
when the program starts: each required field explains what kind of value it wants, the worked
examples use exactly the fields a caller must supply, nothing smuggles in size limits through the
back door, and internal bookkeeping rows are described too. Without this law, the documentation
and the checker would drift apart, and workers following the examples would produce reports the
checker rejects.
Trace: `impl/src/swarm-event-schemas.mjs:490-509` load checks. Test:
`impl/test/swarm-event-schemas.test.mjs:46, 54, 111`.

---

## Authorization boundaries

### AB-01 · runtime · Path scope patterns follow one documented dialect
Statement: One glob matcher compiles scope patterns where `*` spans one path segment, `**/` spans
zero or more whole segments, `?` spans one character, and everything else is literal.
Plain explanation: When a worker is told which files it may touch, the instruction uses a small
pattern language with exactly three special symbols, each with one meaning, and all other
characters mean themselves. The same single translator implements the language everywhere.
Without this law, a pattern that means "one folder deep" in one place could mean "the whole
tree" in another, and a worker would touch files its scope meant to protect.
Trace: `impl/src/path-scope.mjs:5-31` `pathScopeRegex`. Test:
`impl/test/phase83-context-runtime-red.test.mjs:24` "CR83-0".

### AB-02 · runtime (unpinned) · Malformed scope patterns are rejected at construction and match nothing
Statement: A pattern that is empty, carries a null byte, is absolute, contains a backslash, or has
a parent-directory segment throws a typed error at construction, and a path of that shape matches
nothing.
Plain explanation: Scope patterns that could never be safe — empty, absolute, escaping the project,
or containing control characters — are rejected the moment they are constructed, and paths with
the same defects never match any pattern. This guard is enforced but not directly tested; the
workflow layer re-checks the same shape class at its own admission. Without this law, a broken
pattern could silently match everything and grant a worker the whole repository.
Trace: `impl/src/path-scope.mjs:5-8`, `pathMatchesScope:33-36`, `scopeError:1-3`; the workflow
mirror at `impl/src/workflow-interpreter.mjs:206-210` pinned by
`impl/test/workflow-as-data-red.test.mjs:596-599`.

### AB-03 · runtime · Claimed paths are a non-empty list of safe, project-relative paths
Statement: Claim paths form a non-empty array of non-empty repo-relative strings naming no
parent-directory or leading current-directory segments.
Plain explanation: When a worker claims a set of files, the claim must actually name at least one
file, written as paths inside the project, with nothing that climbs out of the project or starts
with a redundant prefix. Without this law, a claim could cover nothing (and mean nothing), or a
crafted path like "escape the folder and then this file" could point at things outside the
project.
Trace: `impl/src/swarm-state.mjs:210-220` `validClaimPaths`. Test:
`impl/test/issue423-claims-proposals-state.test.mjs:128` (the escape row at `:131`).

### AB-04 · runtime · Overlapping claims on one workspace refuse before any write
Statement: A path claim overlapping an active claim on the same recorded workspace refuses, naming
holder, claim id, the overlapping paths and the workspace; overlap is exact equality or a
folder-boundary prefix; other workspaces, missing workspaces, the seat's own holds and work-item
claims fall outside the rule.
Plain explanation: Two workers may not claim the same files in the same working copy at the same
time: the second claim is refused, and the refusal says who holds the files, which claim holds
them, and which paths collide. Claims in different copies of the project, or claims on named work
items instead of files, do not collide. Without this law, two workers would edit the same files
blindly and destroy each other's work.
Trace: `impl/src/swarm-state.mjs:1072-1083` `claimConflictFor`, fold raise `:1889-1899`;
`impl/src/swarm-runtime.mjs:1011-1017` `pathsOverlap`. Test:
`impl/test/issue423-claims-proposals-state.test.mjs:74`;
`impl/test/issue423-claims-and-peers.test.mjs:122`;
`impl/test/issue441d-claims-instead-of-handovers.test.mjs:117`.

### AB-05 · runtime · A claim is bound to the working copy it was made in
Statement: The fold derives a claim's workspace from the participant's recorded row: a fresh claim
binds the holder's recorded workspace, a moved hold keeps the workspace it was taken in, and a
seat with no recorded workspace claims with none.
Plain explanation: A claim on files is tied to a specific physical copy of the project — the one
the claiming worker actually works in — and that binding is derived from records, not from what
the caller says. When the claim moves to another worker, it stays bound to the original copy.
Without this law, a claim could float between copies, and the conflict rule of AB-04 could not
tell which copy's files it actually protects.
Trace: `impl/src/swarm-state.mjs:1883-1888`. Test:
`impl/test/issue423-claims-proposals-state.test.mjs:51` and `:67`.

### AB-06 · runtime · Only the holder can move a claim, in one recorded act
Statement: An active claim moves only from its holder; a handoff rewrites the holder in one row
and keeps the claim active; a handoff or release naming a nonexistent claim refuses.
Plain explanation: Ownership of a claim passes only when the current holder gives it up, and the
handoff is a single record change — the claim never flickers through inactive states. Pointing a
handoff or a release at a claim that does not exist is refused. Without this law, anyone could
reassign anyone's work, handoffs could momentarily orphan claims, and typos could silently do
nothing.
Trace: `impl/src/swarm-state.mjs:1851-1876`. Test:
`impl/test/issue423-claims-proposals-state.test.mjs:100`;
`impl/test/issue423-claims-and-peers.test.mjs:146-149, 161-163`.

### AB-07 · runtime · A seat's declared scope is recorded as one reserved claim at recruit time
Statement: The recruit effect records the seat's declared scope as exactly one claim with the
reserved scope-prefix id on the seat's recorded workspace; a recruit with no scope writes no row.
Plain explanation: The set of files a worker is allowed to touch is itself written down as a
special claim with a reserved name, so the worker's permission boundary exists as a first-class
record rather than only a note in its instructions. A worker recruited without a declared scope
writes no such record. Without this law, scope would be invisible to the conflict machinery, and
two workers could be admitted with overlapping permissions and no warning.
Trace: `impl/src/swarm-runtime.mjs:8424-8428` (+ `scopeClaimId`, `impl/src/swarm-state.mjs:138-140`).
Test: `impl/test/issue441d-claims-instead-of-handovers.test.mjs:85` "#441d-a".

### AB-08 · runtime · Scope records never fence anyone
Statement: The conflict rule exempts scope claims in both directions: the seat's own scope row and
every other seat's scope row are both skipped by the scan.
Plain explanation: The special claims that record what workers are allowed to touch never trigger
the "someone else owns this file" conflict — neither when a worker claims files inside its own
declared scope, nor when two workers' scopes overlap. Only work claims collide. Without this law,
recruiting a second worker whose permissions naturally overlap the first would be impossible.
Trace: `impl/src/swarm-state.mjs:1074` and `:1077`. Test:
`impl/test/issue441d-claims-instead-of-handovers.test.mjs:117` "#441d-b".

### AB-09 · runtime · The reserved scope-claim namespace cannot be forged
Statement: A hand-written claim id in the scope namespace naming a seat other than its holder
refuses as an invalid payload.
Plain explanation: Claim names starting with the reserved scope prefix are generated by the system
for the seat they belong to. A caller manually crafting such a name for a different worker is
refused. Without this law, a caller could forge a scope record that makes it look like the system
itself assigned a worker a permission boundary it never declared.
Trace: `impl/src/swarm-state.mjs:651-658`. Test:
`impl/test/issue441d-claims-instead-of-handovers.test.mjs:220` "#441d-e" (throw asserted at
`:250-253`).

### AB-10 · runtime · A read-only recruit yields a read-only outcome, whatever the nested options say
Statement: A read_only recruit forces the run's result intent to read-only-evidence, overriding
nested options; the intent set is the closed pair {change, read_only_evidence}.
Plain explanation: When a worker is brought in under look-but-don't-touch rules, the system records
in advance that the only thing it can produce is evidence — never a change — and no option buried
deeper in the request can overturn that. Without this law, a restricted worker could be launched
with hidden settings that let it change the repository, and everyone would believe the restriction
was in force.
Trace: `impl/src/swarm-runtime.mjs:8083-8087` (set at `:625`). Test:
`impl/test/issue373-read-only-recruit.test.mjs:85` "#373 (a)".

### AB-11 · runtime · A read-only seat cannot publish a commit, by name
Statement: A contract-claiming body carrying a commit object from a read-only seat refuses
contribution_mode_mismatch with mode, field and expectation; commit null is the admitted publish
for that mode.
Plain explanation: A worker that was never allowed to change anything cannot then report a commit
as its finished work: the system refuses the report, stating the mode, the offending field, and
what that field must look like (no commit at all). Without this law, the read-only promise could
be quietly broken at reporting time, after the restriction had already done its job everywhere
else.
Trace: `impl/src/contribution-contract.mjs:386-391` `validateContributionContractMode`, wired at
`impl/src/swarm-runtime.mjs:7869-7874` (mode via `_recruitMode:2294`). Test:
`impl/test/issue373-read-only-recruit.test.mjs:171` "#373 (d)" (detail deep-equal at `:182`).

### AB-12 · runtime · An empty scope means nothing to protect, and is refused for a contributing seat
Statement: An empty options.scope admits only for a read-only recruit and refuses non-empty for a
contributing seat; a scope over 64 entries or with duplicates refuses.
Plain explanation: A worker allowed to change things must declare which files it may touch —
sending no scope is refused, because unstated scope would mean unlimited reach. Only a
look-but-don't-touch worker may skip the declaration, and even a stated scope is capped in size
and may not repeat entries. Without this law, a contributing worker could be launched with no
declared boundary, and nobody could later tell which files it was ever supposed to touch.
Trace: `impl/src/swarm-runtime.mjs:691-711`. Test:
`impl/test/issue474-recruit-preconditions-typed.test.mjs:215` "474-a", `:248` "474-b", `:273`
"474-b2".

### AB-13 · runtime · Every bridge request authenticates, and the transport is local-only
Statement: Every bridge request authenticates by a bearer token whose digest must be an active
token-table entry, rechecked after the body is read; unknown and revoked tokens refuse identically
before dispatch; the transport accepts loopback addresses only.
Plain explanation: Every request into the coordination system must carry a secret key, and the
system checks the key by comparing a one-way fingerprint against its table of live keys —
rechecking even after the request body arrives, so a key revoked mid-flight cannot be used.
Unknown and revoked keys get the same refusal, and the service only listens on the machine's own
local address. Without this law, a stolen, revoked, or forged key could steer the worker fleet
from outside the machine.
Trace: `impl/src/swarm-native-bridge.mjs:444-449` and `:357-358`. Test:
`impl/test/swarm-native-bridge.test.mjs:403` (unknown/revoked), `:520` (in-flight revoke), `:250`
(loopback).

### AB-14 · runtime · Identity comes from the key, never from the request body
Statement: The bridge derives principal and context from the token entry, so no request field
chooses them; every command taking a group id must name the token's own group; receipts and
refusal envelopes carry no token material.
Plain explanation: Who a request comes from is decided by which secret key it presented, not by
any field inside the request — a caller cannot claim to be someone else by saying so. Requests
about a specific group must be about the group the key belongs to, and answers never echo the
secret back. Without this law, any authenticated worker could impersonate any other, or leak its
own key into logs and receipts.
Trace: `impl/src/swarm-native-bridge.mjs:491-501`, issue receipt `:599-603`. Test:
`impl/test/swarm-native-bridge.test.mjs:347, 436, 215, 635`.

---

## The permission model

### PM-01 · runtime (refusal arm unpinned) · There are exactly seven permissions
Statement: Grants are members of the frozen seven-value set {read, communicate, contribute,
review, organize, recruit, stop}; a recruit naming anything outside it refuses.
Plain explanation: What a worker may do is expressed in exactly seven kinds of authority — look,
talk, contribute work, review others' work, organize, bring in new workers, and stop things.
Bringing in a new worker with any other authority named is refused. The set itself is pinned
through the interface descriptions; the specific refusal for an out-of-list authority is not.
Without this law, permissions could be invented ad hoc and nobody could audit what a worker can
really do.
Trace: `impl/src/swarm-runtime.mjs:1032` `SWARM_PERMISSIONS`, recruit check `:7927-7929`. Test:
`impl/test/issue314-mcp-core-surface-red.test.mjs:144` (set membership via the interface enum);
the refusal arm has no test.

### PM-02 · runtime · A worker without stated permissions gets the safe default three
Statement: A seat recruited without an explicit grant holds {read, communicate, contribute};
grants are stored frozen on the join row and no later fold kind mutates them.
Plain explanation: Bringing in a worker without saying what it may do gives it exactly three
basics — it may look around, talk to teammates, and contribute work — and nothing more, ever:
the grant is written once, immutably, and no later event rewrites it. Without this law, a
forgotten permission field would either strand the worker (unable to do anything) or silently
grant everything, and later events could quietly promote workers after the fact.
Trace: `impl/src/swarm-runtime.mjs:1033` `DEFAULT_PERMISSIONS`, reads at `:1957, 3704, 6705`;
`impl/src/swarm-state.mjs:1301-1303` join row. Test:
`impl/test/issue310-contribution-contract.test.mjs:91` "(a)".

### PM-03 · runtime (unpinned) · Every event kind has exactly one required permission
Statement: Every event kind maps to exactly one required permission in the update-permissions
table; a kind missing from or extra to the table throws at module load.
Plain explanation: For each of the thirteen event types a caller can send, the system knows in
advance which single authority is needed to send it — and it checks that the table covers exactly
the full event list when the program starts, refusing to run if the two lists ever disagree.
This check is not behaviorally tested. Without this law, a newly added event could slip out with
no authority attached — either sendable by anyone or sendable by no one.
Trace: `impl/src/swarm-runtime.mjs:1034-1056`. Test: none (load-time assert; pinnable in the
static source-scan style of the refusal-set test).

### PM-04 · runtime · Each command carries its one permission
Statement: Each command names its one permission: view and watch read; recruit recruits; guide and
notify communicate; capture contributes; check reviews; stop stops; integrate organizes.
Plain explanation: Every action a caller can ask the system to perform has exactly one authority
attached to it, fixed in one table: looking around needs the read authority, merging work needs
the organizer authority, and so on. Without this law, whether an action was allowed would depend
on which door it came through, and the same action could demand different authorities on different
days.
Trace: `impl/src/swarm-runtime.mjs:1057-1067` `COMMAND_PERMISSIONS`. Test:
`impl/test/swarm-native-bridge.test.mjs:312` "an implementer cannot make organizer changes; a
delegated organizer can".

### PM-05 · runtime · The permission a request needs is derived exactly once
Statement: The permission a swarm.update request needs is derived once; dispatch and the view's
updates rows read the same derivation, so the advertised authorities and the enforced checks share
one source.
Plain explanation: When a worker asks "what am I allowed to send?", the answer comes from the very
same function the enforcer uses to decide whether to accept a send — there is one rulebook, read
by both the receptionist and the guard. Without this law, the system could advertise permissions
it then refuses, or accept what it told callers was forbidden.
Trace: `impl/src/swarm-runtime.mjs:1984-2013` `_updatePermission`, dispatch `:7755-7758`, view rows
`:4516-4523`. Test: `impl/test/swarm-view-slices.test.mjs:168` "updates names the kinds this
caller may send with the permission that admits each, and dispatch agrees".

### PM-06 · runtime · A seat's own acts ride lesser authority than acts on others
Statement: A seat's own claim rides contribute; its own consent or synchronization arrival rides
read; its own leave rides read; naming another seat keeps the table's organize.
Plain explanation: You may manage your own things with lighter authority than is needed to manage
other people's: recording your own claim, agreeing to someone's proposal, or leaving the group are
acts on yourself, while the same event aimed at a teammate needs the organizer authority. Without
this law, either every self-service act would need an organizer's blessing (and nothing could
proceed autonomously), or any worker could modify its teammates' records.
Trace: `impl/src/swarm-runtime.mjs:1988, 1995, 2000-2001, 2010`. Test:
`impl/test/issue423-claims-and-peers.test.mjs:146-149` (non-holder refused) with own-claim
admissions at `:117+`.

### PM-07 · runtime · Membership is checked before any permission
Statement: A caller with no active membership in the group refuses before any permission check;
knowledge verbs belong to seated participants, with the evidence search as a plain read and the
seat-read verbs likewise.
Plain explanation: Before the system even asks "does this caller have the right authority?", it
asks "is this caller a member at all?" — a non-member gets the membership refusal no matter what
they asked for. Reading the shared knowledge base is allowed as a plain read for seated members.
Without this law, outsiders would receive authority-specific errors that leak what permissions
would be needed, and removed workers could keep exercising granular rights.
Trace: `impl/src/swarm-runtime.mjs:1947-1961` (`_memberOf`/`_caller`/`_permit`), knowledge gate
`:5151-5156`, seat-read gate `:5229-5231`. Test: `impl/test/swarm-native-bridge.test.mjs:336`
"the runtime owns membership-scoped surface verbs".

### PM-08 · runtime (unpinned) · Nobody can grant an authority they do not hold
Statement: A caller cannot grant a permission it does not hold.
Plain explanation: When one worker brings in another and shares out authorities, it can only share
authorities it itself possesses — you cannot hand someone else the organizer authority unless you
have it. This rule is enforced but has no test. Without this law, an ordinary worker could mint
itself a team of organizers, and the permission hierarchy would only exist on paper.
Trace: `impl/src/swarm-runtime.mjs:7930-7932`. Test: none.

### PM-09 · runtime · Knowledge verbs get their authority from one frozen table
Statement: Each participant knowledge verb names its permission and identity fields in one frozen
table (seed, post, append, elevate contribute; board read, scratchpad read, evidence search read),
and the gate reads the table.
Plain explanation: The small set of actions that write or read the shared knowledge base — adding
facts, posting to boards, searching evidence — each declare in one table which authority they
require, and the enforcement reads that table rather than hard-coding rules per verb. Without
this law, adding a new knowledge verb would mean hand-wiring its authority in several places, and
the advertised requirements would drift from the enforced ones.
Trace: `impl/src/swarm-contract.mjs:192-229` `SWARM_KNOWLEDGE_COMMANDS`,
`swarmKnowledgePermission:239-241`. Test: `impl/test/swarm-knowledge.test.mjs:158`.

### PM-10 · runtime · No one reviews their own work
Statement: A contribution cannot be checked by its own author; the check verb refuses
self-check by name before any check runs and before any review row lands.
Plain explanation: The worker who produced a piece of work can never be the one who approves it:
asking for that is refused up front, with the rule named, before any checking machinery even
starts and before any record of review is written. Without this law, a worker could wave its own
work through, and the approval that gates landing would be meaningless.
Trace: `impl/src/swarm-runtime.mjs:8648-8650`. Test:
`impl/test/swarm-check-admission.test.mjs:76`; `impl/test/swarm-application.test.mjs:218`.

### PM-11 · runtime · A review is attributed to who really acted
Statement: A review's reviewer is the acting identity — the member's participant name or the
acting principal's label; a caller-named mismatch refuses, and the fold independently asserts the
named reviewer is a participant or the event's actor.
Plain explanation: The name attached to an approval or rejection is fixed by the system from
whoever actually performed it — a caller cannot attach someone else's name to their review, and
the record-keeping layer independently double-checks that the named reviewer is a real member or
the acting principal. Without this law, one worker could forge approvals under a teammate's or an
organizer's name, and the review trail would prove nothing.
Trace: `impl/src/swarm-runtime.mjs:7880-7884`; `impl/src/swarm-state.mjs:1017-1024`
`assertAttribution` (applied at `:2257`). Test:
`impl/test/issue292-coupling-truth.test.mjs:263` "a review is attributed to the ACTOR".

---

## Contributions and landing

### CL-01 · runtime · A structured report is a contribution; plain text is only a note
Statement: An object body claims the contribution contract when it carries at least one of the six
contract keys; a bare-string publish without an identity is recorded as a note and wakes no
contribution class.
Plain explanation: The system recognizes a formal work report by its shape — if it carries any of
the fields every report has, it is treated as a report with all the obligations of one, while
plain prose is recorded as a casual note that nobody has to review or land. Without this law, a
note could accidentally be treated as a deliverable (and wait forever for review), or a real
report could be filed as a note that nobody acts on.
Trace: `impl/src/contribution-contract.mjs:122-130` `isContributionContractBody`,
`CONTRIBUTION_NOTE_KIND:33`. Test: `impl/test/issue310-contribution-contract.test.mjs:110` "(b)".

### CL-02 · runtime · A report names its own author
Statement: A contribution publish names the caller's own participant id; naming another seat
refuses.
Plain explanation: When a worker files a report, the author recorded on it must be the worker
itself. Filing a report under a teammate's name is refused. Without this law, one worker could
file misleading work under another's name, and the review trail would blame or credit the wrong
party.
Trace: `impl/src/swarm-runtime.mjs:7862-7864`. Test:
`impl/test/swarm-runtime.test.mjs:97` "delegated coordinator recruits within grants and
implementers can contribute ordinary findings".

### CL-03 · runtime · The reported commit must actually exist on the worker's branch
Statement: A published commit id must resolve on the seat's lane branch before admission; failure
refuses carrying the field, the rule, the id and the branch.
Plain explanation: A work report that claims a commit is checked, at filing time, that the commit
really exists on the worker's branch — a report pointing at a commit that cannot be found is
refused with the details of what failed. Without this law, a report with a typo or a fabricated
commit would be accepted and only blow up later, when a reviewer or the landing machinery tries
to look at work that does not exist.
Trace: `impl/src/swarm-runtime.mjs:2327-2343` `_admitContributionContract`. Test:
`impl/test/issue310-contribution-contract.test.mjs:130` "(c)".

### CL-04 · runtime · Work reported from a folder with unsaved changes is stamped as such
Statement: A commit-null publish from a dirty worktree stamps the body and the receipt status as
uncommitted work; a clean worktree admits unstamped.
Plain explanation: When a worker reports results without a commit while its file copy still has
uncommitted changes, the system marks both the report and its receipt as "uncommitted work" so
every reader knows the results were never safely recorded. From a clean copy, no such mark is
added. Without this law, a report could look finished while its actual work was one accident away
from being lost.
Trace: `impl/src/swarm-runtime.mjs:2318-2324` (constant at
`impl/src/contribution-contract.mjs:36`). Test:
`impl/test/issue310-contribution-contract.test.mjs:146` "(d)".

### CL-05 · runtime · One report identity is used once
Statement: A second record under a held contribution id refuses as a duplicate; an omitted id
mints a fresh id per call.
Plain explanation: Each formal report has a unique identity; trying to file a second report under
an identity already in use is refused, so an identity always names exactly one report. A caller
who does not supply one gets a fresh one each time. Without this law, retries and collisions
would silently overwrite or double-count reports.
Trace: `impl/src/swarm-state.mjs:2210-2212`. Test:
`impl/test/swarm-state.test.mjs:674` "contribution duplicate throws" (assert `:677`);
`impl/test/issue441b-seat-read-verbs.test.mjs:373`.

### CL-06 · runtime · Review state derives from the reviews, once, for every reader
Statement: Review state derives once from the append-only review list: accepted when the last
accept is later than the last reject, rejected when a reject is last, unreviewed otherwise;
comments leave the state unchanged.
Plain explanation: Whether a piece of work is currently approved, rejected, or untouched is not
stored as a separate flag — it is computed from the ordered list of reviews, and every reader
computes it the same way: the most recent accept-or-reject wins, comments are just commentary.
Without this law, two readers could disagree about whether work is approved, and a stale flag
could let rejected work be merged.
Trace: `impl/src/swarm-runtime.mjs:1359-1364` `swarmContributionReviewState`. Test:
`impl/test/issue433-contributions-projection.test.mjs:92` "433-a".

### CL-07 · runtime · Reviews are appended, never rewritten
Statement: A review row appends; prior reviews are retained.
Plain explanation: When a reviewer decides on a piece of work, the decision is added to the list of
decisions; earlier decisions stay in the record forever. This is what makes "the most recent
decision wins" meaningful — an earlier acceptance is not erased when it is later revoked, it is
superseded. Without this law, the history of who approved and who objected could be edited after
the fact.
Trace: `impl/src/swarm-state.mjs:2258-2267`. Test:
`impl/test/issue296-swarm-integrate.test.mjs:308` "296f" (both rows retained).

### CL-08 · runtime · Only a currently-approved contribution can be merged
Statement: The integrate verb lands a contribution whose last settling review is accept; any other
state refuses before any effect, carrying the derived review state and the rule.
Plain explanation: The merge step refuses to run unless the work's most recent decision is an
approval — a rejection, or silence, stops the merge before anything at all happens, and the
refusal states the current review state. Without this law, work that was rejected (or never
reviewed) could end up in the shared branch through a stale or careless merge.
Trace: `impl/src/swarm-runtime.mjs:7360-7370`. Test:
`impl/test/issue296-swarm-integrate.test.mjs:295` "296f: a contribution with no unrevoked accept
refuses pre-effect".

### CL-09 · runtime · Merging applies exactly the work since the common ancestor, as one commit
Statement: The landing applies the range from the merge base of target and tip to the tip, as one
squashed commit, where the tip is the report's commit or the captured revision; the report's
observed head plays no part; an unreachable commit refuses.
Plain explanation: When work is merged, the system figures out precisely which changes belong to
that piece of work — everything it did since it branched off the shared branch — and applies them
as a single combined commit. A report pointing at a commit that does not share history with the
target is refused. Without this law, a merge could sweep in unrelated changes or apply work onto
a base it was never built against.
Trace: `impl/src/worktree.mjs:2196-2233` `landContribution` (rule comment `:2215-2217`). Test:
`impl/test/issue296-swarm-integrate.test.mjs:208` "296b" and the phantom-id row `:378`.

### CL-10 · runtime (unpinned) · Merging nothing is refused, and the scratch copy is cleaned up
Statement: A range carrying no change to land refuses and removes the scratch checkout.
Plain explanation: If a merge attempt turns out to contain no actual changes, the system refuses
rather than recording an empty merge, and it tidies up the temporary working copy it created. This
arm is enforced but not directly tested. Without this law, empty merges could accumulate in the
history and abandoned scratch copies could pile up on the machine.
Trace: `impl/src/worktree.mjs:2294-2297`. Test: none for this arm; the same code is pinned for
the regenerator-failure arm at `impl/test/issue451-integrate-dependency-link.test.mjs:232-236`.

### CL-11 · runtime · A merge touching files another merge just landed is refused by name
Statement: A squash overlapping a landed contribution's receipt paths refuses, naming the files
and the landed contribution.
Plain explanation: When a merge would change files that another, already-merged piece of work
changed, the system refuses and names both the colliding files and the earlier contribution.
Conflicts must be resolved by a decision, not silently auto-merged. Without this law, two
contributions could silently overwrite each other's files, and whichever landed second would
destroy the first's fixes.
Trace: `impl/src/swarm-runtime.mjs:7297-7298` (row `impl/src/swarm-refusals.mjs:129`). Test:
`impl/test/issue296-swarm-integrate.test.mjs:247` "296d".

### CL-12 · runtime · The checks a landing must pass are derived from what changed
Statement: The gate set is the union of the path-derived gate selection and the runner's
import-graph selection over the merged checkout; a change selecting nothing is a recorded skip.
Plain explanation: Before work is merged, the system decides which tests must pass by looking at
which files the work touched and which other files depend on them — and it does so mechanically
from a table plus the project's dependency graph, not from anyone's judgment call at merge time.
Work that touches nothing testable is recorded as an explicit skip, not as a silent pass. Without
this law, merges could run the wrong tests (or none), and "it seemed fine" would replace real
verification.
Trace: `impl/src/swarm-runtime.mjs:7463-7483`; `impl/src/landing-table.mjs:160-210`
`gateSetForPaths`, `LANDING_REGIONS:213`. Test:
`impl/test/issue466-landing-selection.test.mjs:298` "466c", `:239` "466a";
`impl/test/issue463-integrate-gate-paths.test.mjs:330` "463b".

### CL-13 · runtime · The shared branch moves only green, only forward, and only once
Statement: A red gate set refuses, naming the unexpected rows; the fast-forward is a
compare-and-swap update whose loss refuses; a dry run gates the squash, records head-after null,
and moves nothing.
Plain explanation: Work merges into the shared branch only after every required check passes. The
final move is guarded so that if the branch moved while the checks were running, the merge fails
instead of landing on a stale base — and a rehearsal mode runs everything except the final move
and reports what would have happened. Without this law, work could be merged over a teammate's
just-landed changes, or failing work could slip through on a technicality.
Trace: `impl/src/worktree.mjs:2340-2348` and `:2354`; `impl/src/swarm-runtime.mjs:7299-7306`.
Test: `impl/test/issue296-swarm-integrate.test.mjs:279` "296e";
`impl/test/issue459-integrate-off-loop.test.mjs:303` "459c";
`impl/test/issue463-integrate-gate-paths.test.mjs:352` "463c" (the compare-and-swap race arm has
no behavioral test).

### CL-14 · runtime · Work is merged once, by its own author's report, and replays identically
Statement: A second integration of the same contribution refuses as a duplicate; the receipt binds
the contribution's own author and replays byte-identically from the log.
Plain explanation: A piece of work can only be merged once; asking again is refused. The receipt
of a merge names the report's own author, and reading the merge record later replays exactly the
same bytes that were written. Without this law, repeated merges would stack identical changes,
merge records could be attributed to whoever asked last, and rereading history could give
different answers.
Trace: `impl/src/swarm-state.mjs:2270-2304`. Test:
`impl/test/issue296-swarm-integrate.test.mjs:367` "296h" and `:349`.

### CL-15 · runtime · Merging needs the deployer's repository authority and the organizer permission
Statement: The integrate verb requires repository-write authority in the deployment and the
organize permission, the same authority the other root-side acts take.
Plain explanation: Merging into the shared branch is a privileged act, doubly gated: the
deployment must actually possess permission to change the repository, and whoever triggers it
must hold the organizer authority. Without this law, any worker with ordinary contributor rights
could rewrite the shared branch, or a deployment without repository credentials would attempt the
impossible and fail messily mid-merge.
Trace: `impl/src/swarm-runtime.mjs:7378-7383`; `COMMAND_PERMISSIONS:1064-1066`. Test:
`impl/test/swarm-native-bridge.test.mjs:312` (organize gate).

### CL-16 · runtime · Instructions that mimic a work report are checked before any worker is admitted
Statement: A recruit objective presenting itself as a contribution body and naming a field the
contract does not admit refuses typed at recruit time, before any seat is admitted.
Plain explanation: The text used to recruit a worker is scanned for looking like a formal work
report with fields that do not exist; if the instructions are self-contradictory in that way, the
recruit is refused before the worker is even started. Without this law, a worker would be
launched on instructions that set it up to produce reports nobody can accept, wasting the whole
run.
Trace: `impl/src/contribution-contract.mjs:348-378` `contributionContractConflict`, wired at
`impl/src/swarm-runtime.mjs:7941-7944`. Test: `impl/test/issue502-brief-contract-guard.test.mjs:109`
"(a)" and `:153` "(d)".

### CL-17 · runtime · Internal bookkeeping events are not sendable by callers
Statement: Landing lifecycle rows and operation/refusal rows are runtime-recorded driver rows,
load-time disjoint from the caller-submittable event set.
Plain explanation: Some log entries can only be written by the system itself — the milestones of a
merge, the record of a refusal — and no caller can submit them, which is checked when the program
starts by comparing the two vocabularies. Without this law, a caller could forge "your work was
merged" or "you were refused" records, and the log could no longer be trusted as evidence.
Trace: `impl/src/swarm-event-schemas.mjs:201-207` and `:252-297`;
`impl/src/swarm-contract.mjs:55-57`. Test: `impl/test/swarm-refusals.test.mjs:188` (a forged kind
refuses).

### PR-01 · proposed · Parse scope patterns when a worker is admitted, so no broken pattern exists downstream
Statement: Recruit scope entries pass a length and distinctness check but no pattern-grammar
check today; an invalid glob later matches everything in view derivations and escapes as an
untyped error in retained-result enforcement. Proposal: parse scope entries at recruit admission,
as workflow member scopes already are.
Plain explanation: When a worker declares which files it may touch, the patterns it lists are
checked for being few and distinct, but not for being well-formed — a malformed pattern discovered
later makes views overprotective and checks fail with a cryptic error. The proposal is to reject
malformed patterns at the door, the way one other subsystem already does. Without this law, a
typo in a scope quietly widens what the worker can touch.
Trace: `impl/src/swarm-runtime.mjs:696-711`; `inDeclaredScope` `:991-999`;
`impl/src/context-runtime.mjs:632`; the existing precedent
`impl/src/workflow-interpreter.mjs:206-210`.

### PR-02 · proposed test · Pin the scope pattern guard
Statement: No test pins the pattern guard's typed throw or the forbidden-shape matches-nothing
rule.
Plain explanation: The rule that malformed file-scope patterns are rejected and match nothing is
real but untested: nothing fails today if the rule is removed. The proposal is a small direct
test beside the existing dialect test. Without this pin, the guard could disappear in a refactor
and nobody would notice until a malformed pattern grants too much.
Trace: `impl/src/path-scope.mjs:5-8, 33-36`; nearest existing pin
`impl/test/phase83-context-runtime-red.test.mjs:24`.

### PR-03 · proposed tests · Pin the three unpinned permission arms
Statement: Three enforced arms lack pins: the out-of-list permissions refusal, the
update-permissions load assert, and no-elevation-by-delegation.
Plain explanation: Three permission rules are enforced but nothing fails if they are removed:
refusing an unknown authority name, refusing to start when the event-to-authority table is
incomplete, and refusing to grant an authority you lack. The proposal is one test per arm.
Without these pins, the permission system could silently lose its edges.
Trace: `impl/src/swarm-runtime.mjs:7927-7929, 1034-1056, 7930-7932`.

### PR-04 · proposed tests · Pin the three unpinned landing arms
Statement: Three enforced arms lack pins: the landing-receipt payload set, the empty-range arm of
the change-invalid refusal, and the compare-and-swap race on the target branch.
Plain explanation: Three merge-time rules are enforced but untested: the exact shape of the merge
receipt, the refusal to merge an empty change set, and the refusal to merge onto a branch that
moved mid-flight. The proposal is one test per arm. Without these pins, the merge machinery could
drift — recording receipts with missing fields, stacking empty merges, or landing onto stale
bases.
Trace: `impl/src/swarm-state.mjs:951-996`; `impl/src/worktree.mjs:2294-2297, 2340-2348`.

### PR-05 · proposed test · Unit-pin the refusal-table guard
Statement: The refusal-table guard's throwing branch is guarded only by a static source scan; a
direct unit test keeps the guarantee if the scan's literal detection drifts.
Plain explanation: The rule "an error code must exist in the table before code can raise it" is
currently checked by a test that reads the program's source text and looks for offending
patterns. If that text-scanning test ever stops recognizing the pattern, the guarantee dies
silently. The proposal is a direct small test of the guard function itself. Without this pin, the
guarantee depends on a text scanner's fragility.
Trace: `impl/src/swarm-refusals.mjs:203-207`, wired at `impl/src/swarm-state.mjs:178-185` and
`impl/src/swarm-runtime.mjs:210-213`; current guard
`impl/test/issue430-swarm-refusal-set.test.mjs:215`.

---

## Development laws

### DEV-1 · development · No cutoff of any kind stops an agent's work or its input
Statement: No deadline, queue wait, size, count or buffer limit stops an agent control flow or an
input; a bound derived from a physical resource carries its derivation.
Plain explanation: The system never gives up on an agent's work because too much time or too many
steps have passed: a task that cannot start yet waits in line, an input of any size is accepted,
and nothing times out just for being slow. The only limits are physical ones — like the memory a
machine actually has — and any such limit must state where its number comes from. Without this
law, long or large work would be silently abandoned by hidden timers, and the hardest problems
would be exactly the ones the system refuses to finish.
Trace: operator ruling on #541, commit `bc2e4fcd`; `docs/bend2/MANDATE.md` §3; enforced by CAP-2,
CAP-3, CAP-5.

### DEV-2 · development · A request records its intent durably and answers at once
Statement: A verb records a durable intent and answers its receipt at once; never a synchronous
wait.
Plain explanation: When a worker asks the system to do something, the system immediately writes
the request down where it survives any crash and answers "done, it is recorded" right away — it
never holds the worker on the line while the thing actually happens. Anything slow continues in
the background, and the worker hears about it later through notifications. Without this law, a
slow or stuck operation would freeze the caller, and a crash mid-operation would lose the request
entirely.
Trace: operator rulings on #529 (commits `30cdb282`, `84357e4b`) and #543 (commit `25856479`);
`docs/54-native-wake.md:1-27`; enforced by WAKE-10.

### DEV-3 · development · Notifications are pushed to workers, never fetched by them
Statement: Wake is native and always on; it is not a verb a model invokes.
Plain explanation: Workers receive their news — a teammate's report, a question, a change to their
assignment — delivered to them automatically at the moment they can act on it, the same way their
instructions are handed to them at startup. A worker never has to know that notifications exist
or run a command to check for them, and there is no notification "command" to invoke. Without
this law, workers would have to poll for news (burning time and money), or an agent that never
learned the check command would wait forever.
Trace: `docs/54-native-wake.md:1-7`; operator rulings on #529 (commits `30cdb282`, `84357e4b`)
and #543 (commit `25856479`); `docs/bend2/MANDATE.md` §3.

### DEV-4 · development · Every refusal names its rule, its field, and its remedy
Statement: Every refusal is typed and names its rule, its field and its remedy.
Plain explanation: When the system refuses a request, the refusal is a structured answer, not a
paragraph of prose: it says exactly which rule failed, which piece of input caused it, and what
the caller should change to succeed next time. An agent receiving it can correct course without
parsing free text. Without this law, a refused request would start a guessing game — the caller
would retry blindly or give up, and one misformatted field could end an entire run.
Trace: `docs/bend2/MANDATE.md` §3; enforced by CS-05, CS-16, CS-17.

### DEV-5 · development · Work lands red-first, through review and integrate, never by hand
Statement: A contribution lands red-first, through review and integrate, never by hand; the
target moves only through the gate.
Plain explanation: Every change to the shared branch travels the same road: the work is specified
with a failing test first, a report is filed, someone other than the author approves it, and the
system's own gated machinery performs the merge after the required checks pass. Nobody merges by
hand, and no report without a commit counts as delivered. Without this law, unreviewed or
unverified changes would enter the shared branch through side doors, and the tests that guard the
project would only see problems after they landed.
Trace: `docs/bend2/MANDATE.md` "Deliverable form"; `CONTRIBUTING.md` "The self-hosted development
loop" steps 4-5; `docs/42-suite-legitimacy.md:112-115`; operator rulings on #539 (commits
`58d0814e`, `13b104bc`); enforced by CL-06, CL-08, CL-13.

### DEV-6 · development · A seat holds whole scope and full authority, never a slice
Statement: Orchestration gives a seat whole scope and full authority, never a slice of a mandate.
Plain explanation: When work is split among workers, each worker is handed a complete, coherent
assignment it can finish on its own — with the full permission it needs to finish it — rather
than a fragment that depends on constant hand-holding from a coordinator. A worker never has to
ask a neighbor for the authority to complete the thing it was assigned. Without this law, work
would constantly stall on permission gaps and half-assignments, and the coordinator would become
a bottleneck every task had to squeeze through.
Trace: `docs/bend2/MANDATE.md` §3; `docs/39-swarm-runtime.md:1175-1178`.

### DEV-7 · development · Prose is plain technical English
Statement: Prose written for or checked into this repository is plain technical English: no
aphorism, no metaphor, no poetic description, no contrast-form description, no operational
journaling in product-facing documentation.
Plain explanation: Everything the project writes — documentation, reports, commit messages,
instructions — states facts directly in simple technical language: each section says what it
covers, each sentence carries information the reader could not already assume, and descriptions
never define a thing by what it is not. Development history belongs in contributor documents, not
in product prose. Without this law, the project's written surface would drift into rhetoric that
human readers and AI workers alike cannot act on.
Trace: `AGENTS.md` at the repository root.

---

## Counts

Candidates presented: 138 — 131 runtime law rows from the two inventories (64 in the ledger lane:
12 custody, 17 capacity, 13 wake, 19 coordination-ledger, 3 proposed; 67 in the validator lane:
20 closed shapes, 14 authorization boundaries, 11 permission rows, 17 contribution and landing,
5 proposed) and 7 development laws.

Marked unpinned (enforced, no pinning test): CAP-8, WAKE-10, LEDG-2 (half), LEDG-15, CUST-3 (no
direct test), CS-19, AB-02, PM-01 (refusal arm), PM-03, PM-08, CL-10 (arm), CL-13 (race arm).

Marked proposed (not enforced): PROP-1, PROP-2, PROP-3, PR-01, PR-02, PR-03, PR-04, PR-05.

Verification: every trace above was checked at this checkout; all 131 inventory rows hold, no law
was dropped for source drift.
