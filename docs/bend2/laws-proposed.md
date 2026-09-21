# Baton's laws proposed for the operator's approval — revision 2

Provenance: work-bend2-laws, pillar 3 of issue #539, per the approval clause of
`docs/bend2/MANDATE.md` part 3. Revision 2 applies the two operator corrections relayed on
2026-09-21: (1) every plain explanation is plain technical English — the file was rewritten, not
spot-fixed; (2) every row now states its Bend2 carrier — the type, affine ownership rule, closed
variant, smart constructor or structural bound that makes a violation unwritable — or states
plainly that the row is a runtime constraint and names what a proof would take. Rows keep their
identifiers and their traces, and are marked `law` (proof form stated) or `constraint` (no proof
form yet at the pin). Nothing is presented as a law while it is only a runtime check.

Classification provenance. The custody, capacity, wake and coordination-ledger rows carry the
proof-form classification of bend2-laws-ledger (51 carriers, 10 partial, 3 with no carrier
known), nearly verbatim. The closed-shape, authorization, permission and landing rows carry the
classification of bend2-laws-validators, nearly verbatim. The development rows are classified by
this lane. A named carrier is the design path that would make the row a law; it is not a claim
that the row is one already. Today every runtime row is a runtime constraint with a passing test,
which is evidence the constraint exists. Per the evidence convention, each carrier needs a
compiled, run example under `docs/bend2/examples/laws-*` citing the pinned reference before
`laws.bend` claims it.

Audited base: `bc2e4fcd`. Verification method unchanged: every cited source file exists, every
cited line is in range, every quoted test name occurs in its cited test file — all 131 inventory
rows hold, no row dropped for drift.

## Row format

Each row carries: the stable id, its kind (`runtime` — the software enforces it today; or
`development` — a rule the project is built under), its class (`law` — a Bend2 proof form is
stated; or `constraint` — a runtime check, with what a proof would take), its statement, a plain
explanation a reader can answer yes or no from, the carrier or constraint line, and its trace.
Proposed rows (not enforced today) keep the `proposed` kind marker.

Words the plain explanations use: a **worker** is an AI agent doing a piece of work. A worker's
**workspace** is its own private copy of the project's files. The **shared log** is the
append-only record of everything that happened among a group of workers; entries in it are
numbered in order. A **notification** is a message the system sends to a worker when something it
cares about happened. A **contribution** is a piece of finished work with its commit; it **lands**
when it is merged into the shared branch after an approval. A **typed refusal** is an error
answer that states, in fixed fields, exactly which rule failed, about what, and what to do next.

---

## Custody of workspaces

### CUST-1 · runtime · law · A held workspace stays held until its hold is released
Statement: A handle holds a checkout until its hold is released; holding is the absence of a
release, so a finished-but-not-yet-cleaned-up worker still holds its workspace.
Plain explanation: A worker's folder stays assigned to that worker until the worker's shutdown
sequence completes and the assignment is explicitly released. The system refuses to delete or
reset the folder while any hold is still active. Without this rule, a cleanup can delete files at
the same moment the worker's final write is landing.
Bend2 carrier: affine ownership — a checkout capability whose only consumer is the release
operation, so a hold is closed only by consuming the capability, and use after close is not a
value.
Trace: `impl/src/shared-workspace-custody.mjs:38` `holdsWorkspace` (holder statuses `:19`,
attachable statuses `:25`). Test: `impl/test/shared-workspace-custody.test.mjs:318` "T3 the last
holder closes a dirty shared checkout only by retaining it, with no commit on the shared branch";
`:268` "T2 a stop detaches from a shared checkout and leaves the resource to the live holder".

### CUST-2 · runtime · law · A workspace that is closing takes no new worker
Statement: The statuses from which a worker may join a workspace are pending, working, blocked and
idle; a closing workspace accepts nobody.
Plain explanation: Only workspaces in a still-active state accept a new worker. Once a workspace
has begun closing, every new arrival is refused with a typed answer. Without this rule, a new
worker can be placed in a folder that is being dismantled and lose its work immediately.
Bend2 carrier: closed variant — `Attachable = Pending | Working | Blocked | Idle` as a type
distinct from the full holder state; the attach operation takes only `Attachable`, so the closing
case cannot be passed to it.
Trace: `impl/src/shared-workspace-custody.mjs:25` `ATTACHABLE_STATUSES`, read at `:76` inside
`workspaceAttachmentOf` `:70`. Test: `impl/test/shared-workspace-custody.test.mjs:489` "T7 a
source that is still a live member but has no attachable checkout refuses"; `:425` "T6 an absent,
self, departed, foreign-swarm, or process-less source refuses without a holder".

### CUST-3 · runtime · constraint · Custody truth is the set of live worker handles
Statement: Who holds a workspace is decided by the controller's own live worker handles; group
membership and ownership receipts are separate records that do not decide custody.
Plain explanation: The answer to "who is using this folder now" comes from one place: the list of
live worker processes the controller manages. Team membership and earlier ownership receipts do
not by themselves mean a worker is using the folder. Without this rule, the system can delete a
folder a live worker is using because a roster said the worker left, or keep a folder because of
an outdated receipt.
Constraint: the liveness of the handle set is a runtime measurement. A proof would take nominal
separation — a `Custody` type distinct from the membership type and from the owner-receipt type,
so one cannot stand in for another — with the live set as the only producer of the `Custody`
value; the measurement itself stays runtime.
Trace: module header `impl/src/shared-workspace-custody.mjs:1-13`; `workspaceHolders` `:53`.
Consumers: `liveWorkspaceHolders` `impl/src/runtime-api.mjs:583`, coordinator projection
`impl/src/coordinator.mjs:4216`. Test: none pins this directly; nearest evidence is
`impl/test/shared-workspace-custody.test.mjs:318` "T3" and the consumer paths.

### CUST-4 · runtime · law · A removal looks before it destroys and refuses while content is unaccounted for
Statement: A removal observes the workspace before its first destructive step and refuses while
un-captured content or another live holder is present; the two preservation reasons carry
distinct codes, and a live co-holder carries its own.
Plain explanation: Before the system deletes or recycles a worker's file copy, it records what is
in the copy. If work was never saved, or another live worker still uses the copy, the destruction
is refused with a specific named reason. Without this rule, routine cleanup can erase unsaved
work or remove a folder another worker is using.
Bend2 carrier: affine ownership — a removal token whose only constructor is a total `Removable`
observation, consumed by the destroy operation, so destruction without a prior observation could
not be written; the observation itself stays runtime.
Trace: `impl/src/worktree.mjs:1312` `assertRemovableContent` (`:1316` and `:1321` the preservation
codes, `:1326` the custody error); `observeOwnedWorktreeContent` `:1254` (`removable` flag
`:1262`, unobservable states `:1269` and `:1275`); `liveWorkspaceHolders` `:1300`. Test:
`impl/test/workspace-preservation.test.mjs:164` "reap() retains a dirty checkout for a dead owner
even with {force:true}"; `:501`, `:557`, `:587` the reconcile rows.

### CUST-5 · runtime · law · Retention is the preservation mechanism; no option overrides it
Statement: No caller option, force included, authorizes destroying un-captured content; the
boundary never stages, commits, stashes or rewrites what it judges.
Plain explanation: When the system decides unsaved work must be preserved, it preserves it by
leaving the content in place and refusing the destructive step. There is no override switch: no
caller can pass a flag that bypasses preservation. Without this rule, a buggy caller could
destroy a worker's unsaved work by passing an argument.
Bend2 carrier: the removal token of CUST-4, plus an exact record for the destroy arguments that
has no authority-carrying field — an override option has no field to be passed through.
Trace: boundary comment `impl/src/worktree.mjs:1170-1183`; call sites `:2461` and `:2759`. Test:
`impl/test/workspace-preservation.test.mjs:234` "no caller option is an authorization to destroy
un-captured content"; `:217` "markStopped is not an authorization to destroy un-captured content".

### CUST-6 · runtime · law · Only attested machine-made files may be destroyed without a capture
Statement: Content destroyed without a capture is limited to files the owner metadata attests as
machine-materialized — copied dependency trees and toolchain projections — and only paths the
version-control system reports as never-tracked can be treated as generated.
Plain explanation: A worker's folder contains the worker's own work and machine-made files such
as downloaded libraries and tool installs. The system may delete the machine-made files without
asking, but only when its records identify them as system-created, and only for files the
version-control system was never asked to track. Without this rule, cleanup can delete
hand-edited files inside a generated folder.
Bend2 carrier: smart constructor — an `AttestedRoot` value built only from metadata satisfying
the literal-path rule, so an absolute path, a parent-directory segment, or a reserved root is
not a value; the metadata's correctness stays runtime.
Trace: `impl/src/worktree.mjs:1187` `attestedInfrastructureRoots` (`:1190-1196` the literal-path
filter); `observeOwnedWorktreeContent` `:1282-1284`. Test:
`impl/test/workspace-preservation.test.mjs:311` "attested runtime infrastructure is generated,
not un-captured content"; `:418`; `:396`.

### CUST-7 · runtime · law · A capture refuses the repository's own main folder
Statement: A capture path refuses a workspace that resolves to the repository main checkout.
Plain explanation: The system keeps one master copy of the project and many worker copies. Capture
actions are valid only on worker copies, never on the master copy. Without this rule, a
misconfigured worker can commit half-finished work directly from the master folder.
Bend2 carrier: nominal type — `OwnedCheckout` is distinct from a path, with no constructor from
an arbitrary path, so the main checkout cannot stand where an owned checkout is required.
Trace: `impl/src/worktree.mjs:1334` `validateOwnedWorktree` (`:1345` the resolved-path check,
`:1349` the expected-path check). Test: `impl/test/workspace-preservation.test.mjs:438` "a
directory that is not this repository's checkout is retained".

### CUST-8 · runtime · law · A shared revision record describes state, never authorship
Statement: A shared revision record describes the checkout and its observed head with a live
holder count, and carries no authorship claim.
Plain explanation: When workers share one file copy, the system writes a status record: which
version the folder is at, and how many workers are using it. The record has no field about who
created or owns the work. Without this rule, a reader can treat a status record as proof of
authorship and credit the wrong worker.
Bend2 carrier: structural bound — the record type carries exactly the checkout, the observed head
and the holder count; there is no authorship field to set.
Trace: `impl/src/shared-workspace-custody.mjs:97` `workspaceCustodyRecord`; consumer
`impl/src/runtime-api.mjs:213`. Test: `impl/test/shared-workspace-custody.test.mjs:392` "T5 a
shared revision describes the checkout and its observed HEAD, never authorship".

### CUST-9 · runtime · law · A worker copy is separation of files, not of history
Statement: A lane checkout is workspace separation: the ref namespace and the object store are
shared.
Plain explanation: Each worker's private copy of the files is separate for editing only: all
copies use the same project history, and anything a worker commits is immediately part of that
shared history. The isolation protects files being edited, not knowledge. Without this rule,
readers can wrongly assume a worker's commit is invisible to the rest of the project until a
later sync step.
Bend2 carrier: nominal type — a `LaneCheckout` obtainable only through the one creation function,
so no other sharing model is representable; adopting it as a law is the rewrite's choice.
Trace: `impl/src/worktree.mjs:1434` `WORKTREE_GIT_SHARING` (`:1436` the statement, `:1439`
`branchForTask`). Test: `impl/test/issue412-worktree-non-isolation.test.mjs:47` "issue 412: the
creation seam states workspace separation is not git-ref isolation"; `:56`.

### CUST-10 · runtime · law · Before a removal, the worker's branch is first put at the worker's state
Statement: Before a removal boundary the lane branch is put at the checkout's head; a branch
another workspace holds is left in place and the caller retains the checkout.
Plain explanation: Each worker copy has a named bookmark in the project history. Before the system
removes a copy, it moves that bookmark to the worker's final state, so the work stays reachable;
if another copy still uses that bookmark, the removal is refused and the copy is kept. Without
this rule, a removed workspace can leave its final state unreachable.
Bend2 carrier: affine ordering — the branch-positioning step yields a token that the removal
consumes, so removal cannot run before the branch is settled.
Trace: `impl/src/worktree.mjs:1929` `ensureLaneBranchAtHead` (`:1939` the held-elsewhere refusal,
`:1942` the update-ref, `:1943` the reattach); `laneBranchHeldElsewhere` `:1907`;
`laneBranchState` `:1892`. Test: `impl/test/issue428-worktree-custody-on-stop.test.mjs:236`
"428-B: a stop of a seat whose HEAD is not on its branch puts the branch at HEAD first"; `:198`;
`:328`.

### CUST-11 · runtime · law · A physical workspace owner is claimed in one atomic, recoverable act
Statement: A physical workspace owner is allocated before any branch or worktree effect, as one
exclusive receipt published atomically; a restart reconciles a partial publication, and a
structurally sound foreign receipt is retained diagnostically.
Plain explanation: Before anyone creates or uses a physical folder, the system writes one claim
record naming the owner; the record appears completely or not at all, so two workers cannot both
believe they own the folder. If the system stops halfway through writing it, the next start
repairs the partial state; a record written by a different, working system is left in place and
reported. Without this rule, two workers can work in the same physical folder and overwrite each
other's files.
Bend2 carrier: affine ordering — the owner receipt is a capability that every later branch and
worktree effect requires, so an effect before allocation cannot be written; atomic publication
and reconciliation stay runtime.
Trace: `impl/src/worktree.mjs:740` `allocatePhysicalWorkspaceOwner`; `releasePhysicalWorkspaceOwner`
`:824`; `recoverWorkspaceOwnerPublication` `:598` (`:614` the ambiguous-allocation refusal);
`foreignConsistentReceipt` `:439` (`:447` the 64 KiB and mode bound). Test:
`impl/test/phase92.2-physical-workspace-owner-red.test.mjs:96` "P92.2-PO2: exclusive receipt
publication is failure-atomic before final-path visibility"; `:139`; `:245`; `:433`.

### CUST-12 · runtime · law · The detach gate and the reaper read one custody predicate
Statement: The detach gate and the reap backstop both call the same custody predicate.
Plain explanation: Two routines decide whether anyone still uses a folder: one when a worker
detaches, one during background cleanup. Both call the same function, so they cannot disagree
about whether a folder is free. Without this rule, one routine can declare a folder free while
the other still sees a live worker, and the folder is removed under that worker.
Bend2 carrier: structural — one `Custody` type produced by one predicate function and consumed by
both the detach gate and the reap path; a second predicate has no type to return.
Trace: both call `liveWorkspaceHolders` `impl/src/worktree.mjs:1300`, from the checkout path
`:1324` and the residue path `:2946` (`workspace_other_holder_live_retained` `:2949`); the
injected provider is `workspaceHolders` `impl/src/shared-workspace-custody.mjs:53`. Test:
`impl/test/shared-workspace-custody.test.mjs:513` "T8"; `:532` "T9".

---

## Host and workspace capacity

### CAP-1 · runtime · law · Every admission threshold derives from a measurement
Statement: Every host admission threshold derives from the host observation.
Plain explanation: How much work the machine may take on is computed from measurements of the
machine — its cores and memory — not from fixed constants. Without this rule, the system
overcommits a small machine or wastes a large one, because a constant cannot track the hardware
it runs on.
Bend2 carrier: opaque type — `Thresholds` has a single derivation constructor from the
observation and no literal constructor, so a constant standing where a measurement belongs is
not a value.
Trace: `impl/src/host-capacity.mjs:230` `deriveHostCapacity`; `hostCapacityObservation` `:185`.
Test: `impl/test/issue297-issue307-host-capacity.test.mjs:48` "HC-1: every host admission
threshold is a derivation from the measurement, never a constant".

### CAP-2 · runtime · law · A worker takes no slot and is admitted at any load
Statement: A worker lease holds no slot; a worker request is admitted at any load; the derivation
carries no worker shortfall dimension.
Plain explanation: Starting a new worker is always allowed, however busy the machine is: workers
reserve no capacity, and the operating system's scheduler spreads their load. The system never
refuses to start a worker because of machine load. Without this rule, the system can refuse to
start workers while there is work to do.
Bend2 carrier: closed variant — `Lease = Verify(weight) | Worker`, with the weight field present
only on the `Verify` arm; a worker lease has no weight to check.
Trace: `impl/src/host-capacity.mjs:274` `roomFor` (a kind other than `verify` returns true);
`leaseWeight` `:249` (worker weight `cores: 0, bytes: 0`). Test:
`impl/test/issue297-issue307-host-capacity.test.mjs:77` "HC-2"; `:182` "HC-4"; `:444` "HC-12".

### CAP-3 · runtime · law · A heavy request waits its turn, in order, with no deadline
Statement: An admission request is admitted once the derived budget has room and waits in order
until then, written as a visible queue entry carrying its position; acquiring carries no deadline,
and the queue-timeout refusal is never raised.
Plain explanation: When a large job cannot start because the machine's budget is reserved, it
joins a visible waiting line with its position in it and starts when the jobs ahead finish. No
timer cancels a waiting job: waiting is never a refusal reason. Without this rule, long-running
but legitimate work is stopped by a clock for queuing behind other work.
Bend2 carrier: closed variant — `Admission = Leased(token) | Queued(position, ahead) |
Degraded(shortfall)`; the removed timeout-refusal arm has no representation, so a
refusal-for-waiting cannot be constructed.
Trace: `impl/src/host-capacity.mjs:704` `acquire` (`:712` the retry loop, `:739-746` the enqueue,
`:747-754` the queued row, `:767` the poll). Test:
`impl/test/issue512-suite-admission-refusal.test.mjs:150` "S512-3: a run behind another verify
lease waits and runs once it releases, or degrades at once on a host that cannot fund a suite -
never refused for waiting"; `impl/test/issue333-suite-verify-lease.test.mjs:191` "S333-4".

### CAP-4 · runtime · law · Only a full-suite verification is budgeted, at its measured cost
Statement: One verify lease charges the measured suite cost; only a verify is budgeted.
Plain explanation: Of all the work the system runs, only the full test-suite check is charged
against the capacity budget, and it is charged the cost the suite actually measured. All other
work is admitted without charging the budget. Without this rule, ordinary work is crowded out by
accounting meant for the heaviest job, or the heaviest job runs without the room it needs.
Bend2 carrier: the CAP-2 closed variant — the measured suite cost is a field of the `Verify` arm
alone; a worker arm has no cost to charge.
Trace: `impl/src/host-capacity.mjs:249` `leaseWeight`; `budgetFits` `:263` (`:265-266` the core
and byte comparisons). Test: `impl/test/issue297-issue307-host-capacity.test.mjs:77` "HC-2".

### CAP-5 · runtime · law · A machine that cannot fund a full suite says so at once
Statement: A host whose measured memory cannot fund one full suite answers at once with a
shortfall and no lease, and the caller proceeds without the lease.
Plain explanation: Some machines cannot run the full test suite in one go. On those machines the
system answers immediately, naming the shortfall, and the caller continues without the exclusive
lease; no queue forms, because waiting cannot change the outcome. Without this rule,
on a small machine every full-suite check queues indefinitely.
Bend2 carrier: the `Degraded(shortfall)` arm of the admission variant is the only way to proceed
without a lease, so an unrecorded lease-free proceed is unwritable; the shortfall record names
the dimension, the observed and the required numbers.
Trace: standing-property branch inside `acquire` `impl/src/host-capacity.mjs:725-727`, the
degraded answer `:756`, `memoryTightFor` `:258`; the caller's warning
`impl/scripts/suite-host-lease.mjs:103`. Test: `impl/test/issue333-suite-verify-lease.test.mjs:77`
"S333-1b"; `impl/test/issue512-suite-admission-refusal.test.mjs:150` "S512-3".

### CAP-6 · runtime · constraint · A dead holder's lease returns to the budget
Statement: A lease whose holder process is proved dead returns to the budget.
Plain explanation: When a job that reserved machine capacity stops without releasing the
reservation, the system checks that the process is gone and then makes the reservation available
again. Without this rule, reserved capacity stays reserved after its holder is gone, and the
machine accepts less and less new work.
Constraint: process liveness is a runtime measurement. A proof would take a partial carrier: a
`ProvedDead` evidence value whose only producer is the liveness check, consumed by the reclaim;
the measurement itself stays runtime.
Trace: the sweep `impl/src/host-capacity.mjs:714`; `livePid` `:117`. Test:
`impl/test/issue297-issue307-host-capacity.test.mjs:129` "HC-3: a proved-dead holder's lease
returns to the budget".

### CAP-7 · runtime · law · Releasing a lease requires the exact identity it was issued to
Statement: A release is identity-exact on nonce and resident id; a release naming a lease this
resident does not own is a no-op answering false.
Plain explanation: Capacity reservations are released only by the holder of the exact ticket:
the release must match the random serial and owner the ticket was issued with. Any other release
attempt changes nothing and is told so. Without this rule, one component can cancel another's
reservation and let a third job run on top of a running one.
Bend2 carrier: affine token — the release token is produced by acquire and consumed by release,
so a foreign or fabricated token is not a value.
Trace: `impl/src/host-capacity.mjs:773` `release` (`:781` the identity comparison). Test:
`impl/test/issue297-issue307-host-capacity.test.mjs:129` "HC-3" (assert `:146`);
`impl/test/issue333-suite-verify-lease.test.mjs:96` "S333-2" (assert `:105`).

### CAP-8 · runtime · law · Capacity records have closed field sets and a size ceiling
Statement: Lease, queue and observation records carry closed field sets and a byte ceiling; a
record outside the shape refuses, and an over-ceiling record is never stored or served.
Plain explanation: The bookkeeping records that track who reserved what have a fixed set of
fields and a hard size limit; records with extra, missing, or oversized content are rejected.
Without this rule, a malformed or oversized record can corrupt the capacity accounting that
admission depends on.
Bend2 carrier: structural — a closed record type with a fixed field set, plus a serialized size
bound fixed by the type; a record outside either is not a value.
Trace: `impl/src/host-capacity.mjs:53` `RECORD_BYTE_CEILING`, `:54-55` `LEASE_FIELDS` and
`QUEUE_FIELDS`; `validateRecord` `:365` (`:367` the exact key set, `:369-372` the identity
bounds); the mode and ceiling guard in `readRecord` `:384-386`. Test: none pins the refusal path;
the sibling module's guard is pinned at `impl/test/issue500-worktree-capacity.test.mjs:129`
"500-cap-f" (assert `:151`).

### CAP-9 · runtime · constraint · The queue shows who is alive, and dead entries are swept
Statement: Every queue row reports whether its holder is alive, and a mutating read sweeps a
proved-dead entry.
Plain explanation: The waiting line for machine capacity states, for every entry, whether the
job that asked for it still exists. When a reader with authority to change the line finds an
entry whose holder no longer exists, it removes that entry. Without this rule, entries of
finished jobs stay at the front of the line and every later job waits behind them.
Constraint: the sweeping read is an effect and stays runtime. A proof would take a partial
carrier: the row type forces a liveness field of type `Alive | Dead(evidence)`; the measurement
stays runtime.
Trace: `impl/src/host-capacity.mjs:319` `projectParticipantVerify`; `observeParticipantVerify`
`:687` (`:691` the liveness filter). Test: `impl/test/issue506-queue-holder-liveness.test.mjs:52`
"HC-506-a"; `:79` "HC-506-c".

### CAP-10 · runtime · law · A memory collapse sheds at most one lease per episode, recorded once
Statement: A post-admission memory exhaustion sheds at most one verify lease per exhaustion
episode and records the shed once.
Plain explanation: If the machine runs short of memory after work was admitted, the system
cancels exactly one large reservation per exhaustion event and writes the cancellation down
once. Without this rule, one shortage can cancel many running jobs, or an unrecorded cancellation
leaves accounting that no longer matches what is running.
Bend2 carrier: affine episode value consumed by the one shed operation, so a second shed within
the same episode cannot be written; detecting the episode stays runtime.
Trace: `impl/src/host-capacity.mjs:305` `HOST_CAPACITY_SHED_ROW`; `DEFAULT_SHED_POLL_MS` `:66`.
Test: `impl/test/issue495-post-admission-shed.test.mjs:136` "S495-3: the shed is bounded to ONE

### CAP-11 · runtime · law · The suite's parallel width derives from current load, with an operator override
Statement: The suite runner's lane width derives from the host observation; a host at or above its
core count takes one lane, and the operator's environment setting overrides.
Plain explanation: How many pieces the full test-suite check splits into is computed from how busy
the machine is now: a busy machine gets one piece, an idle machine several. The operator may set
the number explicitly. Without this rule, the suite competes with other work for cores or runs
slowly on an idle machine.
Bend2 carrier: derived opaque type, as CAP-1 — the width has one derivation constructor from the
observation and the override, and no literal constructor.
Trace: `impl/src/host-capacity.mjs:345` `defaultSuiteParallelism` (`:347` reads
`capacity.saturated`). Test: `impl/test/issue424-seat-suite-lease.test.mjs:138` "S424-4";
`impl/test/issue297-issue307-host-capacity.test.mjs:223` "HC-6".

### CAP-12 · runtime · law · A nested run proves itself with the parent's own lease token
Statement: A nested runner is proved by the digest of the parent's lease token.
Plain explanation: When a running job starts another large job inside itself, the inner job may
reuse the outer job's reservation only by presenting a digest computed from the outer job's own
ticket. Claiming to be inside someone is not accepted. Without this rule, any process can claim
to be a child of a legitimate holder and bypass the reservation system.
Bend2 carrier: affine capability — the child receives the parent's lease value, so possession
demonstrates the parent issued it, and a forgeable environment string has no type.
Trace: `impl/scripts/suite-host-lease.mjs:38` `suiteLeaseTokenDigest`; `suiteLeaseNested` `:50`.
Test: `impl/test/issue424-seat-suite-lease.test.mjs:65` "S424-1"; `:84` "S424-2";
`impl/test/issue333-suite-verify-lease.test.mjs:253` "S333-7".

### CAP-13 · runtime · constraint · The workspace capacity floor is computed from records, sealed, and enforced under lock
Statement: The worktree capacity floor is the ledger's estimate high-water plus the measured
runtime footprint; state is sealed with a keyed authentication code over canonical bytes, read
from a private root, and admission runs under one exclusive lock before any effect.
Plain explanation: The limit on how many worker folders may exist is computed from two recorded
numbers: the largest folder size so far, plus what the running system itself occupies. The
recorded state is protected against modification with a cryptographic seal, kept in a private
directory, and admission decisions are made while holding an exclusive lock before anything is
created. Without this rule, a modified record can silently change how many workspaces the system
allows, or two simultaneous decisions can conflict.
Constraint: partial. The carried halves: an affine lock token that the git effect consumes gives
lock-before-effect, and the floor is an opaque derived type as CAP-1. The sealing and path
confinement stay runtime.
Trace: `impl/src/worktree-capacity.mjs:158` `deriveWorktreeCapacityFloor`; `#effectiveFloor`
`:324`; `_seal` `:350`; `_read` `:378` (`:383` the mode and regular-file check, `:401-405` the
timing-safe comparison); `_ensureRoot` `:363` (`:371-374` the confinement checks). Test:
`impl/test/issue297-issue307-host-capacity.test.mjs:257` "HC-7";
`impl/test/phase59-worktree-capacity-authority.test.mjs:348` "WC3"; `:404` "WC4"; `:740` "WC14".

### CAP-14 · runtime · law · Releasing a reservation requires the exact token it was made with
Statement: A reservation is released by an exact token identity (id, owner, nonce); a token from
an earlier reservation cannot delete a later reservation that reused the same resource id.
Plain explanation: Folder-slot reservations are cancelled only with the exact receipt issued for
them, including its random serial. If a slot's id is later reused by a new reservation, an old
receipt for the same id still cannot cancel the new one. Without this rule, an old cancellation
can remove a reservation that is now live.
Bend2 carrier: affine token — the release token is consumed once, so a stale token is a spent
value and cannot be applied to a later reservation.
Trace: `impl/src/worktree-capacity.mjs:854` `releaseMany` (`:867-871` the identity comparison);
`release` `:789`. Test: `impl/test/phase59-worktree-capacity-authority.test.mjs:695` "WC12: stale
release token cannot delete a later reservation that reused the same resource id"; `:654` "WC10";
`:507` "WC5".

### CAP-15 · runtime · constraint · The capacity lock wait is bounded, measured, and never steals or deletes
Statement: The capacity lock wait runs on monotonic elapsed time with a configurable deadline; a
live holder past the deadline is refused pre-effect; an abandoned reaper gate is left in place; a
corrupt or ambiguous lock refuses at once and is left in place.
Plain explanation: Taking the capacity lock means waiting while another job holds it; the wait is
measured by a clock that does not run backwards and has a stated limit. If the holder is alive
but slow past that limit, the request is refused and the lock is left untouched; a damaged lock
file is refused as unreadable, also left in place. Without this rule, a slow holder's lock can be
taken mid-work, or a damaged lock file can be read as "free".
Constraint: no carrier known — the deadline, the clock and the other processes are runtime. To
become a proof it would take termination by a decreasing measure plus the pre-effect property
carried by the absence of an effect token on the refusal path.
Trace: `impl/src/worktree-capacity.mjs:42-45` the constants; the acquisition loop `:520-535`
(`:523` the deadline); `_lockNow` `:543`; `_waitSlice` `:587` (`:591` the refusal). Test:
`impl/test/worktree-capacity-contention.test.mjs:314` "WCC3"; `:421` "WCC6"; `:368` "WCC5";
`:455` "WCC7"; `:597` "WCC11".

### CAP-16 · runtime · law · One predicate decides capacity pressure for every reader
Statement: One predicate decides workspace capacity pressure, and the deployment summary and the
capacity notification both read it.
Plain explanation: "Is this system running out of workspace room" has one answer, computed by one
function, and every surface that reports or acts on pressure reads that function. Without this
rule, the status report can say room remains while notifications report it is exhausted, and no
reader can tell which is correct.
Bend2 carrier: structural — one pressure predicate type consumed by both the summary and the
wake; a second predicate has no type to return.
Trace: `impl/src/worktree-capacity.mjs:177` `workspaceCapacityPressure`. Test:
`impl/test/issue297-issue307-host-capacity.test.mjs:359` "HC-9";
`impl/test/wake-stream.test.mjs:248` "a deployment below its capacity floors wakes
capacity_pressure at attach".

### CAP-17 · runtime · law · A worker-count ceiling exists only where the operator configures it
Statement: A worker-concurrency ceiling is configured only by the deployment caller; null means
unbounded; an invalid value refuses at construction rather than coercing.
Plain explanation: The system sets no limit of its own on how many workers run at once. Only the
operator may set one; leaving it unset means no limit; a malformed value stops startup with a
typed error, and the configured number is kept exactly as given. Without this rule, an unstated limit
throttles the workers for no recorded reason, or a typo becomes an arbitrary cap.
Bend2 carrier: closed variant — `Ceiling = Unbounded | Limit(n)` with `n` a positive structural
bound, so the malformed value is not a value.
Trace: `impl/src/concurrency-policy.mjs:15` `normalizeConcurrencyCeiling`; `withinConcurrencyCeiling`
`:25`. Test: `impl/test/concurrency-policy-admission.test.mjs:148` "REP-1"; `:182` "REP-2";
`:218` "DEP-2"; `:294` "ADM-4".

---

## Notifications (wake)

### WAKE-1 · runtime · law · Every notification kind comes from one closed table
Statement: Every wake row derives from exactly one entry of one closed class table; a second
mapping of the same log key is a construction error.
Plain explanation: The system sends a fixed set of notification types, and every notification is
produced by exactly one table entry; no two entries claim the same underlying event. Adding a
notification type means adding it to the table. Without this rule, two rules can claim one event
and workers receive duplicated or contradictory notifications.
Bend2 carrier: total match — a closed row variant matched exhaustively into an optional class,
which makes a second mapping and an unmatched row unwritable.
Trace: `impl/src/wake-stream.mjs:120` `WAKE_CLASS_TABLE`; `CLASS_BY_LEDGER_ROW` `:374` (`:378-379`
the duplicate-key throw); `wakeClassFor` `:398`. Test: `impl/test/wake-stream.test.mjs:100` "the
wake-class table derives every class from its own ledger row, and admits nothing else"; `:291`.

### WAKE-2 · runtime · law · Filtering notifications admits only the listed kinds
Statement: The filter vocabulary is the class table; an unknown class refuses and names the
closed set; an alias resolves to its class.
Plain explanation: A worker may request only some notification types, named from the fixed list;
misspelled or invented types are refused with the admitted list. Alternate spellings map to the
same type. Without this rule, a misspelled filter matches nothing and the worker waits for
notifications it asked for and never receives.
Bend2 carrier: closed variant — the filter holds the class type itself, so an unknown class is
not a value; each alias is a total resolution function into it.
Trace: `impl/src/wake-stream.mjs:340` `WAKE_CLASSES`; the alias index `:353-364`; `parseWakeFilter`
`:455` (`:470-474` the refusal). Test: `impl/test/wake-stream.test.mjs:128` "the filter admits
only the closed class set, and refuses an unknown class by naming the set";
`impl/test/wake-mcp-consumers.test.mjs:253` "an unknown wake class refuses with the closed set".

### WAKE-3 · runtime · law · Reconnecting to notifications resumes exactly where the reader left off
Statement: The cursor is the shared log's sequence number; a pull from `since=N` reads from N+1
and re-derives identical frames, so a reconnect has no gap and no duplicate.
Plain explanation: When a worker's connection to the notification feed drops and returns, it
names the last entry number it saw and the feed continues from the next entry, delivering each
missed item exactly once. Nothing between the old position and now is skipped or delivered twice.
Without this rule, a dropped connection either loses events or delivers them twice.
Bend2 carrier: structural — a sequence-number type distinct from an integer, with a `next`
operation as the only way to advance, so an off-by-one resume is not expressible.
Trace: `impl/src/wake-stream.mjs:619` `cursorOf`; `head` `:691`; `pull` `:759` (`:763` the resume
point, `:779-787` the derivation loop). Test: `impl/test/wake-stream.test.mjs:207` "the cursor
resumes from the last seq a consumer saw, with no gap and no duplicate";
`impl/test/wake-mcp-consumers.test.mjs:181`; `impl/test/swarm-wake.test.mjs:222`.

### WAKE-4 · runtime · law · A new feed connection starts at the current head
Statement: A pull with no cursor starts at the head, so an attachment begins at the current head.
Plain explanation: A freshly opened notification feed delivers what happens from now on and does
not replay the past; a worker that wants history requests it explicitly. Without this rule, every
reconnect delivers a large volume of already-handled events.
Bend2 carrier: closed variant — `Cursor = FromHead | Since(seq)`; the no-cursor default is total
by construction.
Trace: `impl/src/wake-stream.mjs:763`. Test: `impl/test/wake-stream.test.mjs:145` "one attachment
receives the rows of every swarm the resident hosts, including one created after it".

### WAKE-5 · runtime · law · A reader left too far behind is told exactly what it missed
Statement: A consumer further behind than the replay bound receives a typed marker naming how many
rows it lost.
Plain explanation: The feed retains a limited history. If a worker was away so long that part of
the history is outside the retained range, the feed sends a structured message stating exactly
which entries are gone, and the answer identifies itself as partial. Without this rule, the worker assumes it
has seen everything and acts on an incomplete picture.
Bend2 carrier: closed variant — the pull result carries a `Lagged` arm holding the dropped count
and the lost range, and there is no arm for a silent gap.
Trace: `impl/src/wake-stream.mjs:766-773` (`:770` the dropped, from-seq, to-seq and cursor
fields). Test: `impl/test/wake-mcp-consumers.test.mjs:198` "a lagging stream tells the subscriber
how much it lost, in the stream's own typed frame" (assert `:209`).

### WAKE-6 · runtime · law · A changing condition announces its baseline, then its crossings
Statement: A standing-fault observation class is announced at attach and on each crossing; a
change-class observation establishes its baseline at attach.
Plain explanation: For notifications about a condition, such as remaining workspace room, a new
listener immediately learns the condition's current state and then hears each change. The
listener does not have to assume a starting state. Without this rule, a worker hears only
changes and can believe a condition is nominal when it was already exceeded before it attached.
Bend2 carrier: the class variant carries its announcement discipline as a tag —
announce-at-attach or baseline-only — so a class cannot be handled by the other rule.
Trace: `impl/src/wake-stream.mjs:342` `OBSERVATION_CLASSES`; `_observationFrames` `:741` (`:750`
the announce-standing gate). Test: `impl/test/wake-stream.test.mjs:248` "a deployment below its
capacity floors wakes capacity_pressure at attach, and the CLI names the command that acts on it".

### WAKE-7 · runtime · law · Feed endings are a closed vocabulary, and the unknown maps to a fixed default
Statement: The stream end reason and the attachment close reason are two closed vocabularies,
derived through one mapping for every transport; a status outside the vocabulary reads as a
transport close.
Plain explanation: When a notification feed ends, the reason comes from a fixed list, translated
the same way for every connection technology. A reason outside the list is reported as the
transport-close default. Without this rule, each transport reports endings its own way and
workers misread why a feed stopped.
Bend2 carrier: two closed variants with one total function between them, so a status outside the
vocabulary resolves to the single fallback arm.
Trace: `impl/src/wake-stream.mjs:36` `WAKE_STREAM_END_REASONS`; `ATTACHMENT_CLOSED_REASONS` `:52`;
`attachmentClosedReason` `:57`; `attachmentClosedFrame` `:65` (`:66` the fallback);
`attachmentClosedReceived` `:81`. Test: `impl/test/issue356-wake-frame.test.mjs:221`; `:275`;
`:300`; `:319`.

### WAKE-8 · runtime · constraint · One feed carries everything the machine hosts
Statement: One attachment carries the rows of every group the machine hosts, including a group
created after the attachment, plus the machine-scoped rows.
Plain explanation: A worker opens one notification feed and receives events from all the groups
on its machine, including groups created after the feed was opened, plus machine-wide events. A
separate connection per group is not needed, and a late-opened group is not missed. Without this
rule, workers miss notifications for parts of the system that did not exist when they connected.
Constraint: no carrier known — visibility of a group created after attach is a property of a
computation over live state. A proof would take the attachment to hold the group set as a value
produced by the read, rather than reading a mutable registry.
Trace: `impl/src/wake-stream.mjs:697` `_attribution`; `_swarmIds` `:717`. Test:
`impl/test/wake-stream.test.mjs:145`.

### WAKE-9 · runtime · law · A notification names what happened, never the content
Statement: A frame names the key it wrote and its actor and carries no body; only a terminal wake
carries the command that acknowledges it.
Plain explanation: A notification states which record changed and which actor changed it, and
carries no record content, so a reader of the feed cannot obtain work material from it. Only
notifications that ask the worker to act include the exact next command. Without this rule, the
feed duplicates stored data or leaves workers without the command they need.
Bend2 carrier: closed variant — the acknowledging-command field exists only on the terminal
frame arm, so a non-terminal frame carrying a command is not a value; the frame record has no
body field.
Trace: `impl/src/wake-stream.mjs:531` `deriveWakeFrame`; `wakeMatches` `:488`; the table's `next`
field `:99-102` and `wakeRow` `:112`. Test: `impl/test/wake-stream.test.mjs:276` "#272: a context
wake names the key it wrote and its actor, never the body"; `:345` "terminal rows carry the
command that acknowledges them, and only terminal rows do".

### WAKE-10 · runtime · constraint · The push form parks on the shared log until there is news
Statement: The push form of watching parks on the shared log's wait primitive.
Plain explanation: A worker that wants new notifications as they happen hands control to the
shared log's waiting mechanism and is resumed the moment a matching entry is written; it does not
poll at intervals. The wait primitive itself is tested; the connection between this watcher and
the primitive is exercised only through the end-to-end delivery tests. Without this rule,
notification delivery degrades to repeated polling, adding delay and load to every delivery.
Constraint: no carrier known — a park is an effect. A proof would take the frame stream to have
the wait primitive as its only producer, so no second producer of frames exists in the type.
Trace: `impl/src/wake-stream.mjs:813` `watch`, `:828` the park; `waitAfter`
`impl/src/coordination-ledger-writes.mjs:761`. Test: the primitive at
`impl/test/coordination-ledger-writes.test.mjs:226` (assert `:243`); end-to-end:
`impl/test/issue316-sse-attachment-closed.test.mjs`, `impl/test/issue468-stream-errors.test.mjs`.

### WAKE-11 · runtime · constraint · The feed's version stamp is read on a schedule and degrades to none
Statement: The served-commit header is read once per pull on the deployment-observation cadence; a
supplier that cannot answer yields none.
Plain explanation: Notification frames can carry a "which version is serving you" stamp. Reading
it on every event would be wasteful, so it is refreshed on a schedule; when the read fails, the
stamp is absent; only a successful read produces a value. Without this rule, workers can believe they are
talking to a version that is no longer running.
Constraint: partial. The unanswerable case is an optional `Served` value; the once-per-cadence
discipline is runtime and would take the header to be a value threaded through the pull rather
than recomputed per frame.
Trace: `impl/src/wake-stream.mjs:678` `_servedFor` (`:681` the cadence guard, `:683-684` the
null-on-failure read). Test: `impl/test/issue316-provider-degraded.test.mjs:624` "316-c" (assert
`:655`, `:658`).

### WAKE-12 · runtime · law · A page of history is bounded and names its remainder
Statement: A pull page is bounded by the transport frame ceiling and names the remainder through a
typed continuation.
Plain explanation: When a worker requests old notifications in bulk, each answer is capped at the
largest size a connection can carry, and states "there is more, from here" with the position to
resume from. Without this rule, a large history request is silently cut short, and the worker
treats the partial answer as everything.
Bend2 carrier: structural — the page type's size is bounded, and the remainder is a distinct
continuation arm.
Trace: `impl/src/wake-stream.mjs:617` `DEFAULT_REPLAY_LIMIT`; `since` `:803` (`:806` the page
frame). Test: `impl/test/wake-mcp-consumers.test.mjs:232` "the pull page is bounded by the
transport frame ceiling, never by a row count"; `impl/test/issue507-wakes-since-cli.test.mjs:117`
"507-a"; `:168` "507-b".

### WAKE-13 · runtime · constraint · The wire protocol enforces its own framing rules
Statement: A local-loop feed client frame must be masked; an unmasked one is a protocol error
closing with code 1002; a server frame is unmasked; a frame over the wire ceiling closes with
1009.
Plain explanation: The notification socket speaks a wire protocol with fixed rules for how
messages are wrapped and sized: client messages carry the standard scrambling, server messages do
not, and no message exceeds the agreed size. Violations end the connection with the standard
error codes. Without this rule, a malformed client can break the feed for every connected worker,
or an oversized message can exhaust memory.
Constraint: partial. `ClientFrame` and `ServerFrame` as distinct types make a masked server frame
unwritable; byte-level masking and the close codes stay runtime.
Trace: `impl/src/wake-stream.mjs:1018` `encodeServerFrame`; `createFrameReader` `:1038` (`:1054`
and `:1057` the 1009 close, `:1058` the 1002 close). Test: `impl/test/wake-binding.test.mjs:55`
"a declared loopback binding serves the same wake stream to an authenticated WebSocket client,
and refuses an anonymous one".

### PROP-1 · proposed · constraint · A log read is bounded by law, not by each reader's discipline
Statement: A ledger read is bounded; today the bounds exist per reader, with no single predicate
stating the rule.
Plain explanation: Reading from the shared log should always carry a stated size or window limit,
for every reader. Today some readers set their own limits individually and nothing requires it.
Without this rule, a future reader can load an unbounded stretch of history and exhaust the
machine's memory.
Bend2 carrier: structural — the bounded-window read is the only read in the interface, so an
unbounded read is not a value. This is a proposal; nothing enforces it today.
Trace: partial evidence: `WAITING_ON_TAIL_SCAN_CHUNK`
`impl/src/application-observation.mjs:402`; `impl/src/limits.mjs:375-377`;
`impl/test/issue140-waiting-on-tail-read.test.mjs` (6 passing tests). No runtime predicate states
the rule.

### PROP-2 · proposed · constraint · Replay of any log the writer accepted produces a working summary
Statement: The fold is total over recorded history: replay of any log the appender accepted
produces a projection.
Plain explanation: Whatever the writing rules admit, the reading rules must be able to process:
no entry can be written and then fail replay. Today this is defended piece by piece — pre-write
checks, quarantine, review gates — with no single stated rule. Without this rule, the system can
write an entry it cannot start up with.
Bend2 carrier: by construction — one smart constructor shared by admission and the fold makes a
non-total fold unwritable. This is a proposal; nothing enforces it today.
Trace: partial evidence: `impl/test/issue290-prospective-fold.test.mjs` and
`impl/test/issue304-fold-admission-gate.test.mjs` pass; no runtime predicate states the rule.

### PROP-3 · proposed · constraint · One writer per log, stated as one rule across both logs
Statement: One writer per ledger; today the main log's writer lease and the session log's
numbering rule enforce it separately, with no single stated rule joining them.
Plain explanation: Each append-only record should allow exactly one writer at a time, as one
principle. Today the main log enforces it with a lease and the login record with numbering
checks, separately. Without this rule, a new append-only record can be added with no single-writer
rule.
Bend2 carrier: affine — a single writer capability per log, so a second writer is not a value.
This is a proposal; nothing enforces it today.
Trace: partial evidence: `impl/test/phase42-policy-invalidation.test.mjs:137`;
`impl/test/issue487-session-ledger-dual-writer.test.mjs:55`, `:89`, `:123`.

---

## The shared log

### LEDG-1 · runtime · law · The log is append-only and its entry numbers have no gaps
Statement: The ledger is append-only and a row's sequence number is its one-based index; a row
whose number is not its index refuses with `sequence_gap`.
Plain explanation: The shared log can only be added to, never edited or reordered, and the Nth
line carries exactly the number N. At startup the file is checked against that property, and
truncation, reordering or insertion is refused before the system uses it. Without this rule, the
log cannot serve as the system's memory: renumbered history silently changes what happened.
Bend2 carrier: structural — a sealed log whose append assigns the sequence number, so a row
carrying a caller-supplied number is not a value; the startup file check remains a check over
the same type.
Trace: seq assignment `impl/src/coordination-ledger.mjs:1199`; the replay check
`impl/src/coordination-replay.mjs:524`. Test: `impl/test/phase11-coordination-store.test.mjs:204`
(assert `:207`).

### LEDG-2 · runtime · constraint · Torn or wrongly-encoded log bytes are refused
Statement: A log tail with no trailing newline refuses with `truncated_tail`; a stretch that is
not valid UTF-8 refuses with `invalid_utf8`.
Plain explanation: Each log entry is one complete line of text in one standard character
encoding. If the file ends mid-line, or contains bytes that are not valid text in that encoding,
the system refuses and names the defect. The mid-line case is tested; the
wrong-encoding case is enforced but not. Without this rule, a partially written or corrupted
entry is accepted as history.
Constraint: partial. A proof would take an exact-UTF-8 string type built only by a validated
decode; the truncated-tail check stays a runtime check at the file boundary.
Trace: `impl/src/coordination-replay.mjs:464-466` `truncated_tail`; `_ledgerLines` `:493-499`
`invalid_utf8`. Test: `truncated_tail` at `impl/test/phase11-coordination-store.test.mjs:204`; no
test names `invalid_utf8`.

### LEDG-3 · runtime · law · Writing the same thing twice under one key happens once
Statement: The idempotency key is the write identity: a repeat returns the original event; a
duplicate key found in an existing log refuses at replay with `duplicate_key`.
Plain explanation: Every entry is written under a caller-chosen key. Presenting the same key
again, for example after a retried request, does not add a second copy: the system answers with
the entry it already recorded. A file containing two entries under one key is refused as
corrupt. Without this rule, retries double-count events.
Bend2 carrier: structural — a keyed store where the key maps to at most one row, so a repeat
write under the key returns the existing row rather than appending.
Trace: the key replay `impl/src/coordination-ledger.mjs:1192-1193`; the key field on the row
`:1199`; the replay check `impl/src/coordination-replay.mjs:525-527`. Test:
`impl/test/phase11-coordination-store.test.mjs:36` (the duplicate-key row returning the original
event); `:204`.

### LEDG-4 · runtime · law · Only the current writer may append, and losing that role is a named event
Statement: Only the writer-lease holder may append; lease loss is typed; replacement is detected
on token, process id and process start.
Plain explanation: At any moment exactly one writer may add to the log, and it must hold a
current ticket. The system recognizes a replaced writer by three independent marks: a random
token, the process id, and when that process started, so a reused process id cannot pass for its
predecessor. Without this rule, a writer everyone believes stopped can add entries into history.
Bend2 carrier: affine capability — append takes a writer-lease value, so appending without the
lease cannot be written.
Trace: the guard `impl/src/coordination-ledger.mjs:1184`; `_assertWriterLease`
`impl/src/coordination-admission.mjs:201`; `_assertLeaseOwnership` `:220-231`; `claimWriterLease`
`impl/src/coordination-ledger-writes.mjs:493`. Test: `impl/test/phase42-policy-invalidation.test.mjs:137`
(assert `:138`, `:141`); `impl/test/phase56-drain-and-close.test.mjs:499` (assert `:502`).

### LEDG-5 · runtime · constraint · A writer's claim receipt is a short, fail-closed exclusion window
Statement: A writer claim is a short fail-closed exclusion window; a live or ambiguous claimant is
left in place; a stale claim is removed.
Plain explanation: Taking over the writer role starts by writing a short-lived claim receipt. If
another writer's receipt is present and might still be live, or cannot be shown to be finished,
the takeover stops and leaves it in place; only a provably expired receipt is removed. Without
this rule, a takeover during a failure evicts a writer that is still working.
Constraint: partial. The exclusion window itself is a runtime protocol; a proof would take the
outcome as a closed variant, `Claimed | Busy | Ambiguous`, so fail-closed is the only default a
caller can take.
Trace: `impl/src/coordination-ledger-writes.mjs:502-530` (`:514` the stale unlink, `:515` the
ambiguous refusal, `:518-521` the live-claimant refusal). Test:
`impl/test/phase42-policy-invalidation.test.mjs:137` (assert `:158`, `:159`, `:160`).

### LEDG-6 · runtime · law · Releasing the writer role flushes first, and a failed flush stops durable writes
Statement: A clean release flushes the pending group-commit before dropping the lease; a failed
sync refuses further durable writes with `coordination_ledger_unsynced` while readers continue.
Plain explanation: When the log writer steps down, it first writes everything it accepted to
durable storage; if that write fails, the writer refuses new entries, naming the reason, rather
than reporting entries as durable when they are not. Reading what is already there continues.
Without this rule, a failure right after a write loses entries the rest of the system already
counted.
Bend2 carrier: affine ordering plus state typing — release consumes the lease after the flush,
and the failed-sync state is a type without an append operation, so a durable write after a
failed sync is not expressible.
Trace: `impl/src/coordination-ledger-writes.mjs:560-565`; `impl/src/coordination-admission.mjs:208-216`.
Test: `impl/test/issue290-ledger-sync.test.mjs:22`, `:38`, `:47`.

### LEDG-7 · runtime · law · A fault in building the summary stops the summary, never the log
Statement: A fold failure poisons the projection and names the sequence number and the cause; the
durable log stays authoritative, readers continue, and a restart with replay repairs.
Plain explanation: The system keeps a running summary of the log for fast answers. If computing
that summary fails, the failure freezes the summary with the exact entry and reason named, while
the log is untouched, readers continue on it, and a restart rebuilds the summary. Without this
rule, one bad entry brings down the record and the view built on it together.
Bend2 carrier: closed variant — the authority state is `Healthy | Poisoned(seq, cause)`, and the
poisoned arm lacks the projection operations, so a failed summary has nothing to answer with.
Trace: `_poisonProjection` `impl/src/coordination-ledger.mjs:1166` (`:1167` the first-write-wins
freeze); `impl/src/coordination-admission.mjs:202-207`. Test:
`impl/test/issue290-quarantine.test.mjs:30`; `impl/test/issue290-prospective-fold.test.mjs:63`.

### LEDG-8 · runtime · law · A log entry the rules reject is a typed startup refusal naming everything
Statement: A recorded row the fold rejects is a typed startup refusal naming the sequence number,
the kind, the fold's own code and the remedy, raised at the replay fold site.
Plain explanation: If an entry already written into the log breaks the system's rules, the system
refuses at startup with a structured error naming the entry, its kind, the broken rule, and the
remedy. It does not skip the entry, and it does not stop without explanation. Without this rule,
one malformed entry makes the system either silently rewrite history or stop with no cause
stated.
Bend2 carrier: one validator shared by admission and the fold, with the refusal type carrying the
sequence number, kind and code; the refusal is a value of that type, not a message.
Trace: `SwarmReplayRefusal` `impl/src/coordination-ledger.mjs:151` (`:154-162` the message,
`:164-169` the fields); `foldRow` `impl/src/coordination-replay.mjs:537-548`. Test:
`impl/test/issue304-fold-admission-gate.test.mjs:16`.

### LEDG-9 · runtime · constraint · Quarantine of a bad entry is idempotent, conflict-checked, and written safely
Statement: Quarantine is idempotent for the same entry and conflicting for a different entry; the
entry file is written temp, flushed, renamed, at a private mode.
Plain explanation: Moving a log entry into quarantine twice for the identical entry changes
nothing the second time, while quarantining a different entry under the same name is refused as a
conflict. The quarantined copy appears completely or not at all, readable only by the owner.
Without this rule, a retried quarantine can accumulate contradictory copies of the evidence.
Constraint: partial. A proof would take a map keyed by the sequence number giving at most one
entry, with the conflicting case unwritable; the atomic file write stays runtime.
Trace: `writeQuarantineEntry` `impl/src/coordination-ledger.mjs:103` (`:106-112` the duplicate and
conflict decision, `:118-123` the atomic write). Test: `impl/test/issue290-quarantine.test.mjs:72`;
`:120`.

### LEDG-10 · runtime · law · Compaction archives before rewriting, and any drift or bad cut is refused
Statement: Compaction archives a prefix into content-addressed immutable segments; the index is a
cache; the segment lands before the ledger rewrite; divergence refuses as
`coordination_compact_ledger_drift`; a mismatched cut refuses as
`coordination_compact_cut_mismatch`.
Plain explanation: To keep the log small, old entries are copied into immutable archive files
whose names are derived from their content, and only after the archive is on disk is the live log
shortened. If the log changed during the operation, or the cut does not match the archive, the
operation refuses and changes nothing. Without this rule, a concurrent write during compaction
can permanently lose entries that were never archived.
Bend2 carrier: content addressing plus affine ordering — the segment's name is derived from its
bytes, so a mis-addressed segment is not a value, and the segment-before-rewrite order is carried
by consumption.
Trace: `compact` `impl/src/coordination-ledger-writes.mjs:646` (`:651` the cut bound, `:663-667`
the drift refusal, `:686-689` the cut mismatch); `_writeSegment` `:600` (`:606` the idempotent
content-addressed write); `_writeSegmentIndex` `:625`. Test:
`impl/test/ledger-compaction-223-red.test.mjs:71`; `:143`.

### LEDG-11 · runtime · constraint · The summary checkpoint is housekeeping, never authority
Statement: The projection checkpoint is written off the request path, coalesced to one pending
write, and bounded by its own size ceiling; the ledger stays authoritative.
Plain explanation: The system periodically saves its summary so restarts are fast, but the saved
summary is a convenience: the log remains the authoritative record. Saving never delays a caller,
repeated saves collapse into one, and the summary file has a size cap. Without this rule,
checkpoint writing adds delays to real work, or a growing summary file becomes a second record of
history that can disagree with the first.
Constraint: partial. A proof would take a size-bounded projection type carrying the ceiling; the
deferral and coalescing are scheduling and stay runtime.
Trace: the interval decision `impl/src/coordination-ledger.mjs:1217-1234` (`:1224-1233` the
deferred and coalesced write); `_boundedCheckpointWrite` `:897` (`:901-905` the deferred skip);
`impl/src/limits.mjs:375-378`. Test: `impl/test/issue366-run-stop-replay-ceiling.test.mjs:361`;
`impl/test/issue351-startup-answer.test.mjs:366`.

### LEDG-12 · runtime · law · The log opens through one replay path, all or nothing
Statement: The replay fold runs through one path for the synchronous open and the async open; a
half-loaded store does not survive a failed open.
Plain explanation: Whether the system waits for the log to load or loads it in the background, the
same replay routine reads it, and a failed load leaves no partially initialized state behind.
Without this rule, the two startup styles can disagree about the past, and a failed load can
leave a store answering from partial history.
Bend2 carrier: total open — the open returns a closed result variant, so a half-loaded store is
never a value.
Trace: `_loadRun` `impl/src/coordination-replay.mjs:501-506` (the shared generator and `:515`
`store._loading`); `_apply` `impl/src/coordination-ledger.mjs:2314`. Test:
`impl/test/phase11-coordination-store.test.mjs:220` "CK2"; `:243` "CK2: terminal state is
immutable across replay".

### LEDG-13 · runtime · law · Pointing at a summary entry resolves only through the declared grammar
Statement: A projection reference of kind and sequence resolves only through the declared
reference grammar; a kind outside the table, a sequence outside the log, or a disagreeing row
resolves to null.
Plain explanation: Some records point at other records by kind and position. Such a pointer
resolves only when the kind is known, the position exists, and the entry there is of that kind;
anything else answers "nothing here". Without this rule, an outdated pointer can make the system
read one record as another.
Bend2 carrier: closed variant over exactly the declared reference kinds, so an undeclared kind is
not a value and resolves to nothing by construction.
Trace: `PROJECTION_REFERENCES` `impl/src/coordination-ledger.mjs:52`; `_projectionReferenceValue`
`:739` (`:743-746` the four rejections). Test: `impl/test/issue465-second-copies.test.mjs:221`
(assert `:245`, `:254-257`), `:262` (assert `:312-314`), `:166` (`:196`).

### LEDG-14 · runtime · law · Searching back through the log walks bounded windows
Statement: The reverse lookup of the last matching event walks back from the tail in clone-free
bounded windows of 256 rows as far as the first entry.
Plain explanation: To find the most recent log entry matching a condition, the system walks
backwards from the newest entry in fixed-size chunks, holding only the chunk being examined. The
search always advances and never copies the whole log into memory. Without this rule, a backward
search on a large log can stall or exhaust memory.
Bend2 carrier: structural bound — the windowed read is the only read offered, and its window size
is fixed by the type.
Trace: `WAITING_ON_TAIL_SCAN_CHUNK` `impl/src/application-observation.mjs:402`;
`lastCoordinationEvent` `:404` (`:411-419` the windowed walk); `eventCursor`
`impl/src/coordination-ledger.mjs:3567`; `eventsView` `:3571`. Test:
`impl/test/issue140-waiting-on-tail-read.test.mjs:105`; `:132`; `:173`.

### LEDG-15 · runtime · law · A pre-write gate may check but never change
Statement: An append's before-write gate must not change state; a gate that appends refuses with
`causal_correction_integrity`.
Plain explanation: Some writes allow a final permission check just before the entry is recorded.
That check can read the current state but cannot modify it, including by writing its own log
entries; if it does, the write is refused by name. This check is enforced but not tested. Without
this rule, a check can alter history as a side effect of judging it.
Bend2 carrier: purity — the gate's type carries no effect, so a state change inside it is
unrepresentable.
Trace: `impl/src/coordination-ledger.mjs:1200-1204`. Test: none; no test names
`causal_correction_integrity`.

### LEDG-16 · runtime · law · No write lands while the log is still loading
Statement: An append is refused before a deferred open's replay resolves, with
`coordination_store_loading`.
Plain explanation: When the system starts and the log loads in the background, any attempt to add
an entry before loading finishes is refused with a "still loading" answer. The system never writes
new history on top of history it has not finished reading. Without this rule, an early writer can
append an entry that lands before the older entries it depends on.
Bend2 carrier: state-typed store — the loading state is a distinct type without an append
operation, so an append before the replay resolves is not expressible.
Trace: `impl/src/coordination-ledger.mjs:1187-1189`. Test:
`impl/test/issue434-deferred-open-reconstruction.test.mjs:75`; `:43`.

### LEDG-17 · runtime · law · New entries are judged by the same rule that will later read them
Statement: A recorded payload is judged prospectively by the fold's own rule before the durable
append; the fold rule and the write gate are one function.
Plain explanation: Before an entry is written, it is checked by the same code that will later
apply it during replay: one function, used twice. An entry that would fail replay is refused
before it is written. Without this rule, the system can accept entries it will later fail to
replay at startup.
Bend2 carrier: smart constructor — the row type's only constructor runs the fold's own rule, so
an unvalidated row cannot reach the log.
Trace: `assertWaveStartedRoster` `impl/src/coordination-ledger.mjs:80` (shared by the replay fold
and the write gate); the call `:1195-1198`; `_validateRecordedPayload`
`impl/src/coordination-admission.mjs:233` (`:242-246`). Test:
`impl/test/issue290-prospective-fold.test.mjs:20`; `:47`.

### LEDG-18 · runtime · law · The login-record log is a second append-only log with its own durability rule
Statement: The session ledger is a second append-only log with its own durability law:
`truncated_tail`, `sequence_gap` naming line, sequence and both writers, and `schema_version`.
Plain explanation: Login and session records are kept in their own append-only file with the same
integrity guarantees as the main log: torn writes, out-of-order numbering, and wrong-version
records are refused, and a numbering conflict names the exact line, the number, and both writers.
Without this rule, the record of who is connected can be corrupted silently or by two writers
writing at once.
Bend2 carrier: the sealed-log carrier of LEDG-1 and the keyed carrier of LEDG-3, applied to the
session ledger; the torn-tail half stays a runtime check at the file boundary.
Trace: `_lines` `impl/src/web-auth.mjs:70` (`:73` `truncated_tail`); `_consume` `:80` (`:84`
`schema_version`, `:85` `sequence_gap`); the append that numbers from disk `:92-98`. Test:
`impl/test/issue487-session-ledger-dual-writer.test.mjs:55`; `:89`; `:123`.

### LEDG-19 · runtime · law · Cursors are entry numbers, and only real ones wait
Statement: The head is the event count; a cursor past the head refuses; every wait arms from the
head.
Plain explanation: Workers record their place in the log as an entry number. A number beyond
anything the log contains is refused at once; only numbers the log produced can wait. New waits start from the
log's actual end. Without this rule, a worker holding a bogus position can wait forever for
events that cannot exist, or misnumber its place and skip real events.
Bend2 carrier: structural — the sequence type is refined to the log bound, so a cursor past the
head is not a value.
Trace: `ledgerHeadSeq` `impl/src/coordination-ledger.mjs:5580`; `eventCursor` `:3567`;
`waitAfter` `impl/src/coordination-ledger-writes.mjs:761` (`:762-768` the argument validation,
`:769` the immediate answer). Test: `impl/test/evidence-search-deployment.test.mjs:89` (assert
`:97`); `impl/test/coordination-ledger-writes.test.mjs:226` (assert `:243`);
`impl/test/phase66-run-continuation-export.test.mjs:205` (assert `:206-210`).

---

## Closed shapes on the coordination surface

### CS-01 · runtime · law · The set of events a caller may send is fixed at thirteen
Statement: The public event vocabulary is a frozen thirteen-kind set; an unknown kind is refused
at the command contract with the admitted set, and again at the durable fold as an unknown kind.
Plain explanation: Workers coordinate by sending events, and the list of event types they may send
is fixed at thirteen. Anything else is refused with the admitted list, at the entry point and
again before anything is recorded. Without this rule, a misspelled or invented event type can be
recorded and break the system when it replays its history.
Bend2 carrier: closed sum type with one constructor per kind; a non-constructor kind is
unwritable.
Trace: `impl/src/swarm-contract.mjs:10-29` `SWARM_EVENT_KINDS` (field rule `:653-656`,
`swarmClosedSetAdmitted` `:138-144`); `impl/src/swarm-state.mjs:414-417`. Test:
`impl/test/swarm-state.test.mjs:92` "unknown kind throws SwarmRefusal";
`impl/test/issue372-closed-sets-taught.test.mjs:33` "372-a".

### CS-02 · runtime · law · The schema table and the event list can never disagree
Statement: Module load throws when the payload schema keys disagree with the event kinds, and
driver-row kinds are load-time disjoint from the caller-submittable set.
Plain explanation: The system keeps two descriptions of events: the types a caller may send, and
the field descriptions for each. At startup the two are checked to match exactly, and internal
bookkeeping event types are checked to stay separate from caller-sendable ones. Without this
rule, an event added to one list and not the other surfaces as a failure in operation.
Bend2 carrier: one declaration per constructor doubles as the payload record type, and the schema
table is derived from it, so schema and kind disagreement cannot compile — derived-map
exhaustiveness.
Trace: `impl/src/swarm-contract.mjs:51-57` load checks. Test:
`impl/test/swarm-event-schemas.test.mjs:32` "the payload schemas describe exactly the public
swarm.update event kinds"; `impl/test/swarm-refusals.test.mjs:188` "the log replays refusals
byte-identically, and no caller can fabricate one".

### CS-03 · runtime · law · A command's arguments are exactly its declared ones
Statement: An argument key outside the command's declared argument list refuses, naming the rule
and carrying the admitted fields.
Plain explanation: Each command accepts a specific set of named options; an undeclared option is
refused immediately, and the refusal lists the options that exist. Without this rule, a
misspelled option is ignored and the command runs with a default the caller never chose.
Bend2 carrier: an exact argument record per command with a closed field set; unknown fields are
unwritable.
Trace: `impl/src/swarm-contract.mjs:869-875`. Test:
`impl/test/issue372-closed-sets-taught.test.mjs:49` "372-b".

### CS-04 · runtime · law · Identity-keyed commands refuse a retry key
Statement: The capture and check commands carry their identity in their coordinates; an
idempotency key on them refuses with rule identity-keyed before any effect.
Plain explanation: Two commands take their identity from what they point at — the work they
capture or check — so attaching a retry key to them is refused before anything happens. Without
this rule, a caller can treat two different actions as retries of one, or one action as two.
Bend2 carrier: the capture and check argument records omit the idempotency-key field entirely.
Trace: `impl/src/swarm-contract.mjs:864-868`. Test:
`impl/test/swarm-native-bridge.test.mjs:948` "an explicit idempotencyKey on an identity-keyed
command is refused by name, before any effect".

### CS-05 · runtime · law · A refused value teaches the admitted list
Statement: A value outside a closed-set field refuses with the closed-set rule and a message of
the form "field must be one of: ...", composed from the same table the validator judges.
Plain explanation: When a caller supplies a value from a fixed list and gets it wrong, the error
names the field and lists every acceptable value, and the list comes from the same table the
check uses. Without this rule, callers learn the accepted spellings only by repeated failure.
Bend2 carrier: `Result[T, Refusal]` with the refusal a closed variant; the admitted list is
derived from the enum, out-of-set values are unwritable, and the closed-set refusal arms
disappear with the enum.
Trace: `impl/src/swarm-contract.mjs:886-894` (+ `:138-144`). Test:
`impl/test/issue372-closed-sets-taught.test.mjs:33` "372-a";
`impl/test/issue373-read-only-recruit.test.mjs:151` "#373 (c)".

### CS-06 · runtime · law · An event payload carries no unlisted fields
Statement: A payload key the event schema does not know refuses, naming the event's fields, before
any authority check or fold.
Plain explanation: Each event type declares exactly which data fields it accepts; an event with an
extra undeclared field is refused immediately, and the refusal lists the fields that exist.
Without this rule, a caller can include data in an event believing it was delivered when it was
dropped.
Bend2 carrier: a per-event payload record type; unknown payload fields are unwritable.
Trace: `impl/src/swarm-contract.mjs:923-935`. Test:
`impl/test/swarm-refusals.test.mjs:131` "each refusal family records its own coordinates" (rule
pinned at `:149`).

### CS-07 · runtime · law · Missing required fields are refused with their expectations, and only the caller's fields are required
Statement: A missing caller-required payload field refuses, carrying each field's schema
expectation; fields the system fills in itself stay caller-optional.
Plain explanation: For each event type, some fields must come from the caller and some are filled
automatically. Omitting a required field produces an error naming the field and its expected
kind; the automatic fields are never demanded. Without this rule, callers omit fields and the
failure appears later, far from the cause.
Bend2 carrier: two related records per kind — a caller payload with the required fields total and
the auto-filled absent, and a stored payload with all fields — plus a total caller-to-stored
function; a required-but-absent call is unwritable.
Trace: `impl/src/swarm-contract.mjs:911-922, 936-946`; `impl/src/swarm-event-schemas.mjs:447-449`.
Test: `impl/test/swarm-event-schemas.test.mjs:65` "contract admission refuses exactly the
caller-supplied fields, naming field and expectation".

### CS-08 · runtime · constraint · Double-encoded reports are refused with the fix, not stored
Statement: A body, or whole payload, that is a string parsing to a JSON document refuses with the
re-encode remedy before translation or fold.
Plain explanation: A report is sent as structured data. Structured data accidentally converted to
text twice — a text string that itself parses as a document — is refused with the instruction to
send it as data. Without this rule, the report is stored as text and every reader sees one field
per character.
Constraint: partial. The nominal sum `Body = Report(record) | Note(text)` makes sending the object
form as text fail to typecheck; a note whose text itself parses as a document stays
representable while the text branch admits arbitrary strings. A full proof needs a
parse-produced not-JSON refinement on the text branch.
Trace: `impl/src/swarm-contract.mjs:563-588` `swarmEncodedReportBody`, admission checks `:902-909`
and `:947-952`. Test: `impl/test/issue481-string-body-refused.test.mjs:181` "#481 (a)".

### CS-09 · runtime · law · Views are sliced only in the ways the table declares
Statement: The projection argument admits only keys of the frozen view-projections table; the
slicer is the one definition of each slice and refuses the same set.
Plain explanation: Readers can request a reduced view of a record, but only from a fixed menu of
prepared views defined in one table, and one function cuts every view. Without this rule,
different parts of the system invent their own view variants, and one name means different
records in different places.
Bend2 carrier: a projection enum; the slicer is a total function over it.
Trace: `impl/src/swarm-contract.mjs:89-115` `SWARM_VIEW_PROJECTIONS`, `swarmViewProjection`
`:146-152`, field rule `:665-668`. Test: `impl/test/swarm-view-slices.test.mjs:94` "every
projection answers its own slice, keeps the frame, and the default stays the whole record"
(unknown refused at `:136-139`); `:157` "the projection slicer is the one definition of a slice".

### CS-10 · runtime · law · Recruit mode is exactly change or read-only
Statement: Recruit `mode` admits exactly {change, read_only}, declared once and read by the field
rule, the closed-set refusal, and the interface's own schema.
Plain explanation: A worker is admitted either with permission to make changes or explicitly
restricted to reading; those are the only two options, declared in one place and used by the error
messages and the machine-readable command descriptions alike. Without this rule, a third mode can
appear in one surface and not another, and no reader can state what the worker may do.
Bend2 carrier: a mode enum of exactly the two values; one declaration feeds every consumer.
Trace: `impl/src/swarm-contract.mjs:123, 639-642, 1044-1045`. Test:
`impl/test/issue373-read-only-recruit.test.mjs:151` "#373 (c)".

### CS-11 · runtime · law · Message priority is exactly next-boundary or now
Statement: Guidance priority admits exactly {next_boundary, now}, declared once and read by the
field rule, the admitted list, and the interface schema.
Plain explanation: A message to a working worker asks for one of two urgencies: handle it at the
next stopping point, or handle it immediately. Any other urgency is refused with the admitted
list. Without this rule, senders invent urgency levels the receiver does not implement, and
urgent messages degrade silently.
Bend2 carrier: a priority enum of exactly the two values.
Trace: `impl/src/swarm-contract.mjs:132, 645-648`. Test:
`impl/test/issue273-guidance-runtime.test.mjs:168` "273-b" (set pinned at `:157-159`).

### CS-12 · runtime · law · Lifecycle states are frozen sets shared by checker and descriptions
Statement: Work status, assignment/claim status, and review decision validate against frozen
module sets and refuse invalid values naming the set.
Plain explanation: The words describing the states of work items and reviews are fixed lists,
used by both the checker and the generated documentation. A value outside a list is refused with
the list. Without this rule, two components can disagree about which states exist, and an item
can enter a state some component does not recognize.
Bend2 carrier: status and decision enums; the fold's closed-set validation arms disappear with
them.
Trace: `impl/src/swarm-state.mjs:92-94`, checks `:510-512, 664-666, 894-896, 944-946`. Test:
`impl/test/swarm-state.test.mjs:165, 172, 179`.

### CS-13 · runtime · law · A policy update names known fields with known values, at least one
Statement: The policy event names only the frozen policy fields with values from the frozen mode
sets, and names at least one field.
Plain explanation: When the group's fault behavior is changed, the change names specific settings,
each a known setting with a known kind of value, and names at least one. Without this rule, a
policy update can contain settings nothing acts on, or an empty update that looks like a decision
but decides nothing.
Bend2 carrier: a closed variant over the seven inhabited non-empty policy shapes (three optional
fields), so an empty or over-shaped policy is unwritable; an exact record plus a smart
constructor is the fallback if seven variants are judged unreadable.
Trace: `impl/src/swarm-state.mjs:766-790` policy branch (sets at `:100, 109-110`). Test:
`impl/test/issue443-reroute-on-provider-fault.test.mjs:229` "443-a2" (unknown field named at
`:258-267`).

### CS-14 · runtime · law · A claim points at exactly one thing
Statement: A claim names exactly one of a work item or a set of paths; path entries are
repo-relative and name no parent-directory or current-directory segments.
Plain explanation: A worker claiming ownership of work claims either a named work item or a set of
file paths, never both and never neither. Paths are written relative to the project root and
cannot name a location outside it. Without this rule, a claim is ambiguous about what it covers,
or a crafted path points outside the project.
Bend2 carrier: `ClaimTarget = ForWork(workId) | ForPaths(nonEmptyList of paths)`, with the path
type from AB-02; both-targets and no-target are unwritable.
Trace: `impl/src/swarm-state.mjs:659-666` + `validClaimPaths:208-220`. Test:
`impl/test/issue423-claims-proposals-state.test.mjs:128`.

### CS-15 · runtime · law · A proposal plan has exactly two parts, each strictly shaped
Statement: A proposal plan carries only work and claims; each work entry names a work item and an
objective once; each claims entry names exactly one of work item or paths.
Plain explanation: A proposed plan has a fixed shape: a list of work items to create, each named
and described once, and a list of claims, each pointing at one thing. Anything else is refused.
Without this rule, plans can carry extra entries, and different readers act on different plans.
Bend2 carrier: an exact record with the two fields, the claims entries using the CS-14 sum;
anything beyond the two fields is unwritable.
Trace: `impl/src/swarm-state.mjs:289-315` `validProposalPlan`. Test:
`impl/test/issue423-claims-proposals-state.test.mjs:230`.

### CS-16 · runtime · law · Every error code is defined exactly once, in one table
Statement: Every code the fold or the runtime raises has exactly one row in the refusal table
carrying status, raiser and rule; both refuse helpers mint through the table, so an untabled code
is a construction-time error; the web status map derives from the table.
Plain explanation: Every distinct error the coordination system produces is listed exactly once,
with its web status, who may raise it, and the rule it names. Error-raising code must go through a
helper that accepts only listed codes, so an undocumented error is refused at construction and
never ships. Without this rule, the same failure is described differently on different surfaces and
clients cannot tell one error from another.
Bend2 carrier: a refusal closed variant with one constructor per code, each carrying exactly its
detail; the status is a total function over the variant, and minting an undeclared code is
unwritable — the constructor set replaces the runtime guard.
Trace: `impl/src/swarm-refusals.mjs:35-186, 203-207`; wired at `impl/src/swarm-state.mjs:178-185`
and `impl/src/swarm-runtime.mjs:210-213`. Test:
`impl/test/issue430-swarm-refusal-set.test.mjs:215` "#430 (a)" (static scan over both raise
sites), `:258` "#430 (b)", same-rule pairs `:267`.

### CS-17 · runtime · law · A work report validates against one published shape
Statement: A contract-claiming body validates against the one contribution schema: unknown fields
at any level refuse; type, required and enum refusals carry field, rule and expectation read from
the schema object the brief renders.
Plain explanation: A structured work report is checked against one published template, the same
template shown to workers in their instructions. Extra fields are refused at every level, and each
complaint names the field, the rule, and the expectation. Without this rule, reports arrive in
shapes their readers cannot parse, and each reader enforces its own version of the format.
Bend2 carrier: nested exact record types for the report and its sub-records, plus the item-status
enum; the strict validator becomes the type and the field-rule-expectation refusals disappear
with it.
Trace: `impl/src/contribution-contract.mjs:162-241` `validateContributionContract`,
`contractRefusal:137-141`, schema `:49-115`. Test:
`impl/test/issue310-contribution-contract.test.mjs:164` "(e)";
`impl/test/issue371-contract-example.test.mjs:101, 116, 129, 142`.

### CS-18 · runtime · law · A report item's status is one of three exact words
Statement: items[].status admits exactly {delivered, partial, not_delivered}, the frozen set
reused by schema, validator, and brief.
Plain explanation: Each line of a work report states how far it got, and the only allowed answers
are three fixed words, the same three everywhere the status is shown or checked. Without this
rule, a worker can write "mostly done", and readers must guess whether the work landed.
Bend2 carrier: an item-status enum of exactly the three values.
Trace: `impl/src/contribution-contract.mjs:29, 200-202`. Test:
`impl/test/issue310-contribution-contract.test.mjs:164` "(e)" (status assert at `:172`).

### CS-19 · runtime · law · The landing receipt has a closed payload shape
Statement: A landing-recorded payload carries exact commit ids for base, head-before and squash;
head-after as commit-or-null; target; changed paths; a gates object; a positive-integer-or-null
issue; and a boolean dry-run flag.
Plain explanation: When work is merged, the system records a receipt of exactly what happened:
the commits involved, what moved, which files changed, which checks ran, which issue it closes,
and whether it was a rehearsal. Every field's type is fixed. This shape is enforced but not
directly tested. Without this rule, readers of the receipt must guess which fields exist.
Bend2 carrier: an exact receipt record with a commit-id newtype produced only by a parser fixed
at the hex length, optional fields for head-after and issue, and a boolean for the dry run;
mis-shaped receipts are unwritable.
Trace: `impl/src/swarm-state.mjs:951-996`. Test: none directly; nearest hits are fixture rows at
`impl/test/issue296-swarm-integrate.test.mjs:254` and
`impl/test/issue441c-situation-one-derivation.test.mjs:215`.

### CS-20 · runtime · law · The schema descriptions are checked for well-formedness at load
Statement: Every required schema field carries an expectation; shipped examples carry exactly the
caller-required fields and none of the auto-filled ones; the schema declares no size or count
caps; every driver row is fully described.
Plain explanation: The documented descriptions of every command and event are themselves checked
at startup: each required field states what kind of value it wants, the worked examples use
exactly the fields a caller must supply, size limits are not declared through the descriptions,
and internal bookkeeping rows are described too. Without this rule, the documentation and the
checker drift apart, and workers following the examples produce reports the checker rejects.
Bend2 carrier: the shipped examples are typed constants of the caller-payload types, so an
example missing a required field or setting an auto-filled one fails to typecheck, and the
expectation strings derive from the types.
Trace: `impl/src/swarm-event-schemas.mjs:490-509` load checks. Test:
`impl/test/swarm-event-schemas.test.mjs:46, 54, 111`.

---

## Authorization boundaries

### AB-01 · runtime · law · Path scope patterns follow one documented dialect
Statement: One glob matcher compiles scope patterns where `*` spans one path segment, `**/` spans
zero or more whole segments, `?` spans one character, and everything else is literal.
Plain explanation: When a worker is told which files it may touch, the instruction uses a pattern
language with exactly three special symbols, each with one meaning; all other characters mean
themselves. One translator implements the language everywhere. Without this rule, a pattern
meaning one folder deep in one place can mean the whole tree in another.
Bend2 carrier: a glob tree type (literal, one-segment star, multi-segment star, single-character
question) produced by a pattern parser, with the matcher a total function over the tree;
unsupported operators are unwritable by construction.
Trace: `impl/src/path-scope.mjs:5-31` `pathScopeRegex`. Test:
`impl/test/phase83-context-runtime-red.test.mjs:24` "CR83-0".

### AB-02 · runtime · law · Malformed scope patterns are rejected at construction and match nothing
Statement: A pattern that is empty, carries a null byte, is absolute, contains a backslash, or has
a parent-directory segment throws a typed error at construction, and a path of that shape matches
nothing.
Plain explanation: Scope patterns that cannot be safe — empty, absolute, escaping the project, or
containing control characters — are rejected when constructed, and paths with the same defects
match no pattern. This guard is enforced but not directly tested at this module; the workflow
layer checks the same shape class at its own admission. Without this rule, a broken pattern can
match everything and grant a worker the whole repository.
Bend2 carrier: path and pattern as parsed types — segment lists that cannot contain a
parent-directory segment, an absolute form, or a backslash by construction; both the typed-throw
arm and the false-return arm disappear.
Trace: `impl/src/path-scope.mjs:5-8`, `pathMatchesScope:33-36`, `scopeError:1-3`; the workflow
mirror at `impl/src/workflow-interpreter.mjs:206-210` pinned by
`impl/test/workflow-as-data-red.test.mjs:596-599`.

### AB-03 · runtime · law · Claimed paths are a non-empty list of safe, project-relative paths
Statement: Claim paths form a non-empty array of non-empty repo-relative strings naming no
parent-directory or leading current-directory segments.
Plain explanation: A claim on files names at least one path, written relative to the project root,
with nothing that leaves the project. Without this rule, a claim can cover nothing and mean
nothing, or point outside the project.
Bend2 carrier: a non-empty list of the parsed path type from AB-02; the empty list and the
escaping path are unwritable.
Trace: `impl/src/swarm-state.mjs:210-220` `validClaimPaths`. Test:
`impl/test/issue423-claims-proposals-state.test.mjs:128` (the escape row at `:131`).

### AB-04 · runtime · constraint · Overlapping claims on one workspace refuse before any write
Statement: A path claim overlapping an active claim on the same recorded workspace refuses, naming
holder, claim id, the overlapping paths and the workspace; overlap is exact equality or a
folder-boundary prefix; other workspaces, missing workspaces, the seat's own holds and work-item
claims fall outside the rule.
Plain explanation: Two workers cannot claim the same files in the same working copy at the same
time: the second claim is refused, naming the holder, the claim, and the colliding paths. Claims
in different copies, or on named work items, do not collide. Without this rule, two workers edit
the same files and overwrite each other's work.
Constraint: overlap is a property of the mutable claim records, so the row is a runtime check. A
proof would take affine ownership — a path-range token minted to each active hold and consumed by
any later claim naming an overlapping range — which requires the claim records to be threaded as
owned values through the fold.
Trace: `impl/src/swarm-state.mjs:1072-1083` `claimConflictFor`, fold raise `:1889-1899`;
`impl/src/swarm-runtime.mjs:1011-1017` `pathsOverlap`. Test:
`impl/test/issue423-claims-proposals-state.test.mjs:74`;
`impl/test/issue423-claims-and-peers.test.mjs:122`;
`impl/test/issue441d-claims-instead-of-handovers.test.mjs:117`.

### AB-05 · runtime · law · A claim is bound to the working copy it was made in
Statement: The fold derives a claim's workspace from the participant's recorded row: a fresh claim
binds the holder's recorded workspace, a moved hold keeps the workspace it was taken in, and a
seat with no recorded workspace claims with none.
Plain explanation: A claim on files is tied to the physical copy the claiming worker works in, and
that binding is derived from records, not chosen by the caller. When the claim moves to another
worker it stays bound to the original copy. Without this rule, a claim can float between copies,
and the conflict rule cannot tell which copy's files it protects.
Bend2 carrier: the caller-facing claim record omits the workspace field; the fold derives it, so
a caller-supplied workspace is unwritable.
Trace: `impl/src/swarm-state.mjs:1883-1888`. Test:
`impl/test/issue423-claims-proposals-state.test.mjs:51` and `:67`.

### AB-06 · runtime · constraint · Only the holder can move a claim, in one recorded act
Statement: An active claim moves only from its holder; a handoff rewrites the holder in one row
and keeps the claim active; a handoff or release naming a nonexistent claim refuses.
Plain explanation: Ownership of a claim passes only when the current holder gives it up, and the
handoff is one record change with no intermediate state. Pointing a handoff or a release at a
claim that does not exist is refused. Without this rule, any worker can reassign another's work,
handoffs can temporarily orphan claims, and a typo can act on nothing.
Constraint: the holder at move time is ledger state, so the row is a runtime check. A proof would
take a hold token minted only to the current holder and consumed and re-minted by the handoff —
affine transfer — requiring the token to be threaded through the ledger.
Trace: `impl/src/swarm-state.mjs:1851-1876`. Test:
`impl/test/issue423-claims-proposals-state.test.mjs:100`;
`impl/test/issue423-claims-and-peers.test.mjs:146-149, 161-163`.

### AB-07 · runtime · law · A seat's declared scope is recorded as one reserved claim at recruit time
Statement: The recruit effect records the seat's declared scope as exactly one claim with the
reserved scope-prefix id on the seat's recorded workspace; a recruit with no scope writes no row.
Plain explanation: The set of files a worker may touch is itself written down as a claim with a
reserved name, so the worker's permission boundary is a record the rest of the system reads, not
a paragraph in its instructions. A worker recruited without a declared scope writes no such
record. Without this rule, scopes are invisible to the conflict machinery.
Bend2 carrier: an abstract newtype for the reserved claim id with a module-private constructor —
only the recruit effect can produce the value, so the reserved row is unwritable elsewhere.
Trace: `impl/src/swarm-runtime.mjs:8424-8428` (+ `scopeClaimId`, `impl/src/swarm-state.mjs:138-140`).
Test: `impl/test/issue441d-claims-instead-of-handovers.test.mjs:85` "#441d-a".

### AB-08 · runtime · law · Scope records never fence anyone
Statement: The conflict rule exempts scope claims in both directions: the seat's own scope row and
every other seat's scope row are both skipped by the scan.
Plain explanation: The claims that record what workers may touch never trigger the file-conflict
refusal — neither against a worker's own scope nor between two workers' scopes. Only work claims
collide. Without this rule, recruiting a second worker whose permissions naturally overlap the
first would be refused.
Bend2 carrier: the claim type splits into a hold variant and a scope variant, and the conflict
scan takes only the hold variant — the two exemptions become the type filter, and exhaustiveness
forces the split.
Trace: `impl/src/swarm-state.mjs:1074` and `:1077`. Test:
`impl/test/issue441d-claims-instead-of-handovers.test.mjs:117` "#441d-b".

### AB-09 · runtime · law · The reserved scope-claim namespace cannot be forged
Statement: A hand-written claim id in the scope namespace naming a seat other than its holder
refuses as an invalid payload.
Plain explanation: Claim names with the reserved scope prefix are produced by the system for the
seat they belong to. A caller writing such a name by hand for a different worker is refused.
Without this rule, a caller can fabricate a scope record that makes it look as if the system
assigned a worker a boundary it never declared.
Bend2 carrier: the same abstract reserved-id newtype as AB-07 — a hand-written id in the reserved
namespace cannot typecheck as a claim id.
Trace: `impl/src/swarm-state.mjs:651-658`. Test:
`impl/test/issue441d-claims-instead-of-handovers.test.mjs:220` "#441d-e" (throw asserted at
`:250-253`).

### AB-10 · runtime · law · A read-only recruit yields a read-only outcome, whatever the nested options say
Statement: A read_only recruit forces the run's result intent to read-only-evidence, overriding
nested options; the intent set is the closed pair {change, read_only_evidence}.
Plain explanation: A worker admitted under read-only rules can produce only evidence, never
changes, and no option deeper in the request can change that. Without this rule, a restricted
worker can be launched with settings that let it change the repository while everyone believes
the restriction is in force.
Bend2 carrier: a total function from the mode enum to the intent enum, with exhaustive cases; the
intent has no other producer.
Trace: `impl/src/swarm-runtime.mjs:8083-8087` (set at `:625`). Test:
`impl/test/issue373-read-only-recruit.test.mjs:85` "#373 (a)".

### AB-11 · runtime · law · A read-only seat cannot publish a commit, by name
Statement: A contract-claiming body carrying a commit object from a read-only seat refuses
contribution_mode_mismatch with mode, field and expectation; commit null is the admitted publish
for that mode.
Plain explanation: A worker that was never permitted to change anything cannot report a commit as
its finished work: the report is refused, stating the mode, the offending field, and what the
field must look like. Without this rule, the read-only promise can be broken at reporting time
after holding everywhere else.
Bend2 carrier: a two-constructor report sum — the read-only body carries no commit field, and the
change body carries an optional commit reference; a commit on a read-only body is unwritable.
Trace: `impl/src/contribution-contract.mjs:386-391` `validateContributionContractMode`, wired at
`impl/src/swarm-runtime.mjs:7869-7874` (mode via `_recruitMode:2294`). Test:
`impl/test/issue373-read-only-recruit.test.mjs:171` "#373 (d)" (detail deep-equal at `:182`).

### AB-12 · runtime · law · An empty scope means nothing to protect, and is refused for a contributing seat
Statement: An empty options.scope admits only for a read-only recruit and refuses non_empty for a
contributing seat; a scope over 64 entries or with duplicates refuses.
Plain explanation: A worker permitted to change things must declare which files it may touch;
requesting one with no declared scope is refused, because an unstated scope is an unlimited one.
Only a read-only worker may skip the declaration, and a stated scope is capped in size and
cannot repeat entries. Without this rule, a contributing worker can be launched with no declared
boundary.
Bend2 carrier: the recruit request is indexed by mode — the change variant carries a bounded
non-empty scope list, the read-only variant carries no scope field; the empty-scope-on-change and
over-64 forms are unwritable.
Trace: `impl/src/swarm-runtime.mjs:691-711`. Test:
`impl/test/issue474-recruit-preconditions-typed.test.mjs:215` "474-a", `:248` "474-b", `:273`
"474-b2".

### AB-13 · runtime · constraint · Every bridge request authenticates, and the transport is local-only
Statement: Every bridge request authenticates by a bearer token whose digest must be an active
token-table entry, rechecked after the body is read; unknown and revoked tokens refuse identically
before dispatch; the transport accepts loopback addresses only.
Plain explanation: Every request into the coordination system carries a secret key, checked by
comparing a one-way digest against the table of live keys, rechecked after the request body
arrives so a key revoked during the request cannot be used. Unknown and revoked keys receive the
same refusal, and the service listens only on the machine's own address. Without this rule, a
stolen or revoked key can steer the worker fleet from outside the machine.
Constraint: token liveness is mutable table state. Typed halves exist now: secret-token and
digest newtypes, and the scope record. A proof would take a linear capability issued per scope
and destroyed by revoke, required by the transport's request type — capability threading.
Trace: `impl/src/swarm-native-bridge.mjs:444-449` and `:357-358`. Test:
`impl/test/swarm-native-bridge.test.mjs:403` (unknown/revoked), `:520` (in-flight revoke), `:250`
(loopback).

### AB-14 · runtime · law · Identity comes from the key, never from the request body
Statement: The bridge derives principal and context from the token entry, so no request field
chooses them; every command taking a group id must name the token's own group; receipts and
refusal envelopes carry no token material.
Plain explanation: Who a request comes from is decided by which secret key it presented, not by
any field in the request: a caller cannot claim to be another worker by saying so. Requests about
a group must concern the group the key belongs to, and answers never echo the secret. Without
this rule, any authenticated worker can act as another, or leak its key into receipts.
Bend2 carrier: the wire request records omit the principal and context fields, and the group id
is typed as a scoped value minted only when the key was issued; a cross-group call is unwritable.
Trace: `impl/src/swarm-native-bridge.mjs:491-501`, issue receipt `:599-603`. Test:
`impl/test/swarm-native-bridge.test.mjs:347, 436, 215, 635`.

---

## The permission model

### PM-01 · runtime · law · There are exactly seven permissions
Statement: Grants are members of the frozen seven-value set {read, communicate, contribute,
review, organize, recruit, stop}; a recruit naming anything outside it refuses.
Plain explanation: What a worker may do is expressed in exactly seven kinds of authority. Admitting
a worker with any other authority named is refused. The set is pinned through the interface
descriptions; the refusal for an out-of-list authority is not separately tested. Without this
rule, permissions can be invented as needed and no one can state what a worker may do.
Bend2 carrier: a permission enum; an out-of-set grant is unwritable and the refusal arm
disappears with the enum.
Trace: `impl/src/swarm-runtime.mjs:1032` `SWARM_PERMISSIONS`, recruit check `:7927-7929`. Test:
`impl/test/issue314-mcp-core-surface-red.test.mjs:144` (set membership via the interface enum);
the refusal arm has no test.

### PM-02 · runtime · law · A worker without stated permissions gets the safe default three
Statement: A seat recruited without an explicit grant holds {read, communicate, contribute};
grants are stored frozen on the join row and no later fold kind mutates them.
Plain explanation: Admitting a worker without stating its permissions gives it exactly three
basics — read, communicate, contribute — and nothing more. The grant is written once on the join
record and no later event changes it. Without this rule, a missing permission field either leaves
the worker unable to act or grants everything, and later events can promote workers after the
fact.
Bend2 carrier: an optional grant field on the join row plus a total default function; the row is
an immutable record and only the join branch constructs a participant row.
Trace: `impl/src/swarm-runtime.mjs:1033` `DEFAULT_PERMISSIONS`, reads at `:1957, 3704, 6705`;
`impl/src/swarm-state.mjs:1301-1303` join row. Test:
`impl/test/issue310-contribution-contract.test.mjs:91` "(a)".

### PM-03 · runtime · law · Every event kind has exactly one required permission
Statement: Every event kind maps to exactly one required permission in the update-permissions
table; a kind missing from or extra to the table throws at module load.
Plain explanation: For each event type a caller can send, exactly one authority is required to
send it, and the program refuses to start if the table does not cover exactly the full event
list. This check is not behaviorally tested. Without this rule, a new event can ship with no
authority attached — sendable by anyone or by no one.
Bend2 carrier: permission-of-event as an exhaustive match over the event enum; a new constructor
without a case fails to compile — the load-time assert becomes the compiler.
Trace: `impl/src/swarm-runtime.mjs:1034-1056`. Test: none (load-time assert; pinnable in the
static source-scan style of the refusal-set test).

### PM-04 · runtime · law · Each command carries its one permission
Statement: Each command names its one permission: view and watch read; recruit recruits; guide and
notify communicate; capture contributes; check reviews; stop stops; integrate organizes.
Plain explanation: Every action a caller can request has exactly one authority attached, fixed in
one table. Without this rule, whether an action is allowed depends on which entry point it
arrives through.
Bend2 carrier: the same exhaustive match, over the command enum.
Trace: `impl/src/swarm-runtime.mjs:1057-1067` `COMMAND_PERMISSIONS`. Test:
`impl/test/swarm-native-bridge.test.mjs:312` "an implementer cannot make organizer changes; a
delegated organizer can".

### PM-05 · runtime · constraint · The permission a request needs is derived exactly once
Statement: The permission a swarm.update request needs is derived once; dispatch and the view's
updates rows read the same derivation, so the advertised authorities and the enforced checks share
one source.
Plain explanation: When a worker asks what it may send, the answer comes from the same function
the enforcer uses to accept or refuse a send: one rulebook, read by both the listing and the
check. Without this rule, the system can advertise permissions it then refuses.
Constraint: no hard carrier — sharing is by construction, one named total function both surfaces
call; a divergent second table is new code, not a type error. A proof would take a module
signature under which the derivation is the only export of its type.
Trace: `impl/src/swarm-runtime.mjs:1984-2013` `_updatePermission`, dispatch `:7755-7758`, view rows
`:4516-4523`. Test: `impl/test/swarm-view-slices.test.mjs:168` "updates names the kinds this
caller may send with the permission that admits each, and dispatch agrees".

### PM-06 · runtime · law · A seat's own acts ride lesser authority than acts on others
Statement: A seat's own claim rides contribute; its own consent or synchronization arrival rides
read; its own leave rides read; naming another seat keeps the table's organize.
Plain explanation: Acting on your own records needs lighter authority than acting on other
people's: recording your own claim, agreeing to a proposal, or leaving the group are acts on
yourself, while the same event aimed at a teammate needs the organizer authority. Without this
rule, every self-service act needs an organizer, or any worker can modify its teammates' records.
Bend2 carrier: the relaxation as exhaustive cases of the PM-05 derivation over the event and
action enums; the mapping is the definition, and its fidelity to policy remains specification
rather than type.
Trace: `impl/src/swarm-runtime.mjs:1988, 1995, 2000-2001, 2010`. Test:
`impl/test/issue423-claims-and-peers.test.mjs:146-149` (non-holder refused) with own-claim
admissions at `:117+`.

### PM-07 · runtime · constraint · Membership is checked before any permission
Statement: A caller with no active membership in the group refuses before any permission check;
knowledge verbs belong to seated participants, with the evidence search as a plain read and the
seat-read verbs likewise.
Plain explanation: Before the system asks what authority the caller holds, it asks whether the
caller is a member at all; a non-member receives the membership refusal whatever they asked for.
Reading the shared knowledge base is a plain read for seated members. Without this rule, removed
workers keep exercising detailed rights, and refusal messages disclose which authority each
request would need.
Constraint: membership is mutable state. A proof would take a membership capability minted at
join and destroyed on leave, required by every command's parameter type — capability threading.
Trace: `impl/src/swarm-runtime.mjs:1947-1961` (`_memberOf`/`_caller`/`_permit`), knowledge gate
`:5151-5156`, seat-read gate `:5229-5231`. Test: `impl/test/swarm-native-bridge.test.mjs:336`
"the runtime owns membership-scoped surface verbs".

### PM-08 · runtime · constraint · Nobody can grant an authority they do not hold
Statement: A caller cannot grant a permission it does not hold.
Plain explanation: When one worker admits another and shares authorities, it can share only
authorities it itself possesses. This rule is enforced but not tested. Without this rule, an
ordinary worker can admit a team of organizers, and the permission structure exists only in the
configuration files.
Constraint: no carrier known — the rule is a subset relation over grant sets. A proof would take
type-level finite-set subset constraints over the seven-permission universe, refinement or
dependent typing; until then it stays runtime.
Trace: `impl/src/swarm-runtime.mjs:7930-7932`. Test: none.

### PM-09 · runtime · law · Knowledge verbs get their authority from one frozen table
Statement: Each participant knowledge verb names its permission and identity fields in one frozen
table (seed, post, append, elevate contribute; board read, scratchpad read, evidence search read),
and the gate reads the table.
Plain explanation: The actions that write or read the shared knowledge base each declare in one
table which authority they require, and enforcement reads that one table for every verb,
Without this rule, adding a knowledge verb means wiring its authority in several
places, and the advertised requirement drifts from the enforced one.
Bend2 carrier: an exhaustive record keyed by the verb enum; a verb without an admission row fails
to compile.
Trace: `impl/src/swarm-contract.mjs:192-229` `SWARM_KNOWLEDGE_COMMANDS`,
`swarmKnowledgePermission:239-241`. Test: `impl/test/swarm-knowledge.test.mjs:158`.

### PM-10 · runtime · constraint · No one reviews their own work
Statement: A contribution cannot be checked by its own author; the check verb refuses
self-check by name before any check runs and before any review row lands.
Plain explanation: The worker that produced a piece of work cannot approve it: the request is
refused up front, naming the rule, before any checking runs and before any review record is
written. Without this rule, a worker can approve its own work, and the approval that gates
landing means nothing.
Constraint: no carrier known — reviewer-distinct-from-author is an inequality over open identity
sets. A proof would take a refinement with a decidable-inequality witness or a dependent proof
argument; until then it stays runtime.
Trace: `impl/src/swarm-runtime.mjs:8648-8650`. Test:
`impl/test/swarm-check-admission.test.mjs:76`; `impl/test/swarm-application.test.mjs:218`.

### PM-11 · runtime · law · A review is attributed to who really acted
Statement: A review's reviewer is the acting identity — the member's participant name or the
acting principal's label; a caller-named mismatch refuses, and the fold independently asserts the
named reviewer is a participant or the event's actor.
Plain explanation: The name on an approval or rejection is set by the system from whoever
performed it: a caller cannot attach another worker's name to a review, and the record layer
independently confirms the named reviewer is a real participant or the acting principal. Without
this rule, one worker can file approvals under another's name.
Bend2 carrier: the caller-facing review record omits the reviewer field; the fold derives it from
the acting identity, so the attribution check becomes construction.
Trace: `impl/src/swarm-runtime.mjs:7880-7884`; `impl/src/swarm-state.mjs:1017-1024`
`assertAttribution` (applied at `:2257`). Test:
`impl/test/issue292-coupling-truth.test.mjs:263` "a review is attributed to the ACTOR".

---

## Contributions and landing

### CL-01 · runtime · law · A structured report is a contribution; plain text is only a note
Statement: An object body claims the contribution contract when it carries at least one of the six
contract keys; a bare-string publish without an identity is recorded as a note and wakes no
contribution class.
Plain explanation: The system recognizes a formal work report by its shape: a body carrying any of
the report fields is a report with all the obligations of one, while plain text is recorded as a
note that nobody reviews or lands. Without this rule, a note can wait forever for review, or a
real report can be filed where nobody acts on it.
Bend2 carrier: a body sum type — contract record, note text, or legacy hand-off — with claim
detection as case analysis.
Trace: `impl/src/contribution-contract.mjs:122-130` `isContributionContractBody`,
`CONTRIBUTION_NOTE_KIND:33`. Test: `impl/test/issue310-contribution-contract.test.mjs:110` "(b)".

### CL-02 · runtime · law · A report names its own author
Statement: A contribution publish names the caller's own participant id; naming another seat
refuses.
Plain explanation: When a worker files a report, the recorded author is the worker itself; filing
under a teammate's name is refused. Without this rule, one worker can file misleading work under
another's name.
Bend2 carrier: the publish record omits the author field; the runtime derives it from the
authenticated principal.
Trace: `impl/src/swarm-runtime.mjs:7862-7864`. Test:
`impl/test/swarm-runtime.test.mjs:97` "delegated coordinator recruits within grants and
implementers can contribute ordinary findings".

### CL-03 · runtime · constraint · The reported commit must actually exist on the worker's branch
Statement: A published commit id must resolve on the seat's lane branch before admission; failure
refuses carrying the field, the rule, the id and the branch.
Plain explanation: A report claiming a commit is checked at filing time that the commit exists on
the worker's branch; a report pointing at a commit that cannot be found is refused with the
details. Without this rule, a report with a fabricated commit is accepted and fails later, when a
reader tries to look at work that does not exist.
Constraint: resolution asks the repository, so the row is a runtime constraint by nature. The
types carry the typed refusal record naming the field, rule, id and branch.
Trace: `impl/src/swarm-runtime.mjs:2327-2343` `_admitContributionContract`. Test:
`impl/test/issue310-contribution-contract.test.mjs:130` "(c)".

### CL-04 · runtime · constraint · Work reported from a folder with unsaved changes is stamped as such
Statement: A commit-null publish from a dirty worktree stamps the body and the receipt status as
uncommitted work; a clean worktree admits unstamped.
Plain explanation: When a worker reports results without a commit while its file copy still has
unrecorded changes, the system marks both the report and its receipt as uncommitted work, so
every reader knows the results were never safely recorded. From a clean copy no mark is added.
Without this rule, a report looks finished while its work can be lost without any record.
Constraint: worktree dirtiness is filesystem state. The types carry the admit result union —
stamped or clean — so an unstamped dirty publish is unwritable inside the type; the dirtiness
measurement stays runtime.
Trace: `impl/src/swarm-runtime.mjs:2318-2324` (constant at
`impl/src/contribution-contract.mjs:36`). Test:
`impl/test/issue310-contribution-contract.test.mjs:146` "(d)".

### CL-05 · runtime · constraint · One report identity is used once
Statement: A second record under a held contribution id refuses as a duplicate; an omitted id
mints a fresh id per call.
Plain explanation: Each formal report has a unique identity; filing a second report under an
identity already in use is refused, so an identity names exactly one report. A caller that omits
the identity receives a fresh one. Without this rule, retries and collisions overwrite or
double-count reports.
Constraint: uniqueness in a mutable map is runtime state. A proof would take linear map threading
— insert consumes the ledger value and returns the new one, so a duplicate insert needs a stale
ledger — or mint-only identities; it requires an owned-state redesign.
Trace: `impl/src/swarm-state.mjs:2210-2212`. Test:
`impl/test/swarm-state.test.mjs:674` "contribution duplicate throws" (assert `:677`);
`impl/test/issue441b-seat-read-verbs.test.mjs:373`.

### CL-06 · runtime · law · Review state derives from the reviews, once, for every reader
Statement: Review state derives once from the append-only review list: accepted when the last
accept is later than the last reject, rejected when a reject is last, unreviewed otherwise;
comments leave the state unchanged.
Plain explanation: Whether work is approved, rejected, or untouched is not stored as a flag: it is
computed from the ordered list of reviews, and every reader computes it the same way — the most
recent accept-or-reject decides, comments decide nothing. Without this rule, two readers can
disagree about whether work is approved.
Bend2 carrier: a total typed reduction from the review list to the three-value state enum, with
the list order structural; single-definition carries the same caveat as PM-05.
Trace: `impl/src/swarm-runtime.mjs:1359-1364` `swarmContributionReviewState`. Test:
`impl/test/issue433-contributions-projection.test.mjs:92` "433-a".

### CL-07 · runtime · law · Reviews are appended, never rewritten
Statement: A review row appends; prior reviews are retained.
Plain explanation: Each review decision is added to the list; earlier decisions stay in the
record. This is what makes "the most recent decision decides" meaningful: an earlier acceptance is
superseded, not erased. Without this rule, the history of approvals and objections can be edited
after the fact.
Bend2 carrier: immutable lists in a pure fold — erasure is unwritable, and append is the only
combining operation.
Trace: `impl/src/swarm-state.mjs:2258-2267`. Test:
`impl/test/issue296-swarm-integrate.test.mjs:308` "296f" (both rows retained).

### CL-08 · runtime · constraint · Only a currently-approved contribution can be merged
Statement: The integrate verb lands a contribution whose last settling review is accept; any other
state refuses before any effect, carrying the derived review state and the rule.
Plain explanation: The merge step refuses to run unless the work's most recent decision is an
approval; a rejection, or no decision, stops the merge before anything happens, and the refusal
states the current review state. Without this rule, rejected or unreviewed work reaches the
shared branch.
Constraint: no carrier in ordinary types — the rule is a predicate over mutable review state. A
proof would take a contribution type indexed by review state, with the CL-06 reduction as the
only producer of the accepted index; if the language lacks indexed types, the runtime gate plus
the typed refusal stands.
Trace: `impl/src/swarm-runtime.mjs:7360-7370`. Test:
`impl/test/issue296-swarm-integrate.test.mjs:295` "296f: a contribution with no unrevoked accept
refuses pre-effect".

### CL-09 · runtime · law · Merging applies exactly the work since the common ancestor, as one commit
Statement: The landing applies the range from the merge base of target and tip to the tip, as one
squashed commit, where the tip is the report's commit or the captured revision; the report's
observed head plays no part; an unreachable commit refuses.
Plain explanation: A merge applies precisely the changes the work made since it branched off the
shared branch, combined into one commit. A report pointing at a commit that shares no history
with the target is refused. Without this rule, a merge can include unrelated changes or apply
work onto a base it was never built against.
Bend2 carrier: nominal — the merge operation takes a base newtype produced only by the merge-base
step, and the observed head is a distinct type, so substituting it is unwritable; that the base
really is a merge-base stays with the git call.
Trace: `impl/src/worktree.mjs:2196-2233` `landContribution` (rule comment `:2215-2217`). Test:
`impl/test/issue296-swarm-integrate.test.mjs:208` "296b" and the phantom-id row `:378`.

### CL-10 · runtime · law · Merging nothing is refused, and the scratch copy is cleaned up
Statement: A range carrying no change to land refuses and removes the scratch checkout.
Plain explanation: If a merge attempt contains no actual changes, the system refuses with the
empty-change refusal and removes the temporary working copy it created. This arm is enforced
but not directly tested. Without this rule, empty merges accumulate in the history and abandoned
temporary copies accumulate on the machine.
Bend2 carrier: boundary — the squash step returns a diff result, changed or empty, and the landing
consumes only the changed case; the refusal arm becomes the empty case. Git-side truth stays with
the adapter.
Trace: `impl/src/worktree.mjs:2294-2297`. Test: none for this arm; the same code is pinned for
the regenerator-failure arm at `impl/test/issue451-integrate-dependency-link.test.mjs:232-236`.

### CL-11 · runtime · constraint · A merge touching files another merge just landed is refused by name
Statement: A squash overlapping a landed contribution's receipt paths refuses, naming the files
and the landed contribution.
Plain explanation: A merge that would change files another already-merged contribution changed is
refused, naming the colliding files and the earlier contribution. Conflicts require a decision,
not an automatic resolution. Without this rule, the second of two overlapping merges overwrites
the first contribution's changes.
Constraint: overlap against landed receipts is ledger state. The same affine path-range route as
AB-04 would carry it, if ever taken; until then a runtime check over a pure overlap predicate.
Trace: `impl/src/swarm-runtime.mjs:7297-7298` (row `impl/src/swarm-refusals.mjs:129`). Test:
`impl/test/issue296-swarm-integrate.test.mjs:247` "296d".

### CL-12 · runtime · law · The checks a landing must pass are derived from what changed
Statement: The gate set is the union of the path-derived gate selection and the runner's
import-graph selection over the merged checkout; a change selecting nothing is a recorded skip.
Plain explanation: Before work merges, the system decides which tests must pass from the files the
work touched and the project's dependency graph — mechanically, from a table plus the graph, not
from a judgment call at merge time. Work touching nothing testable is recorded as an explicit
skip. Without this rule, merges can run the wrong tests or none.
Bend2 carrier: a pure total function from the changed paths and the optional issue to a gate set
or a recorded skip over a closed region enum; the skip is a value of the result type.
Trace: `impl/src/swarm-runtime.mjs:7463-7483`; `impl/src/landing-table.mjs:160-210`
`gateSetForPaths`, `LANDING_REGIONS:213`. Test:
`impl/test/issue466-landing-selection.test.mjs:298` "466c", `:239` "466a";
`impl/test/issue463-integrate-gate-paths.test.mjs:330` "463b".

### CL-13 · runtime · constraint · The shared branch moves only green, only forward, and only once
Statement: A red gate set refuses, naming the unexpected rows; the fast-forward is a
compare-and-swap update whose loss refuses; a dry run gates the squash, records head-after null,
and moves nothing.
Plain explanation: Work merges only after every required check passes. The final move is guarded so
that if the branch moved while the checks ran, the merge fails, and every landing is computed against the branch's current head;
a rehearsal mode runs everything except the final move and reports what would have happened.
Without this rule, work merges over a teammate's just-landed changes, or failing work merges
through a race.
Constraint: split. The red-green half is carried by a gate-verdict sum that landing consumes only
in the green case, with the unexpected rows on the red payload. The compare-and-swap race is
external: a linear head-before token consumed by an atomic-swap primitive types the attempt, but
the race itself stays runtime-detected.
Trace: `impl/src/worktree.mjs:2340-2348` and `:2354`; `impl/src/swarm-runtime.mjs:7299-7306`.
Test: `impl/test/issue296-swarm-integrate.test.mjs:279` "296e";
`impl/test/issue459-integrate-off-loop.test.mjs:303` "459c";
`impl/test/issue463-integrate-gate-paths.test.mjs:352` "463c" (the compare-and-swap race arm has
no behavioral test).

### CL-14 · runtime · constraint · Work is merged once, by its own author's report, and replays identically
Statement: A second integration of the same contribution refuses as a duplicate; the receipt binds
the contribution's own author and replays byte-identically from the log.
Plain explanation: A piece of work merges once; asking again is refused. The merge receipt names
the report's own author, and reading the record later replays exactly the bytes written. Without
this rule, repeated merges stack identical changes, receipts can be attributed to whoever asked
last, and rereading history gives different answers.
Constraint: split. Author binding is carried — the receipt record omits the author and derives it,
as CL-02. Landing-once has no carrier: the same linear-ledger route as CL-05. Byte-identical
replay is a determinism property evidenced by the replay test, not typeable.
Trace: `impl/src/swarm-state.mjs:2270-2304`. Test:
`impl/test/issue296-swarm-integrate.test.mjs:367` "296h" and `:349`.

### CL-15 · runtime · law · Merging needs the deployer's repository authority and the organizer permission
Statement: The integrate verb requires repository-write authority in the deployment and the
organize permission, the same authority the other root-side acts take.
Plain explanation: Merging into the shared branch is doubly gated: the deployment must hold
permission to change the repository, and whoever triggers the merge must hold the organizer
authority. Without this rule, an ordinary contributor can rewrite the shared branch, or a
deployment without repository credentials attempts the merge and fails partway.
Bend2 carrier: capability — the merge operation requires an opaque repository-authority value that
only the deployment wiring produces; without it the call does not typecheck. That the wiring
really holds git access stays runtime.
Trace: `impl/src/swarm-runtime.mjs:7378-7383`; `COMMAND_PERMISSIONS:1064-1066`. Test:
`impl/test/swarm-native-bridge.test.mjs:312` (organize gate).

### CL-16 · runtime · constraint · Instructions that mimic a work report are checked before any worker is admitted
Statement: A recruit objective presenting itself as a contribution body and naming a field the
contract does not admit refuses typed at recruit time, before any seat is admitted.
Plain explanation: The text used to admit a worker is checked for resembling a formal work report
with fields that do not exist; contradictory instructions refuse the admission before the worker
starts. Without this rule, a worker is launched on instructions that set it up to produce reports
nobody can accept.
Constraint: no carrier known — objectives are prose and the check is a scan over arbitrary text. A
structured objective record type would move the check into the type, but that is a product design
change, not a type fact.
Trace: `impl/src/contribution-contract.mjs:348-378` `contributionContractConflict`, wired at
`impl/src/swarm-runtime.mjs:7941-7944`. Test: `impl/test/issue502-brief-contract-guard.test.mjs:109`
"(a)" and `:153` "(d)".

### CL-17 · runtime · law · Internal bookkeeping events are not sendable by callers
Statement: Landing lifecycle rows and operation/refusal rows are runtime-recorded driver rows,
load-time disjoint from the caller-submittable event set.
Plain explanation: Some log entries are written only by the system — merge milestones and refusal
records — and no caller can submit them; the two vocabularies are checked to be disjoint at
startup. Without this rule, a caller can fabricate "your work was merged" or "you were refused"
records.
Bend2 carrier: two disjoint enums, the submit events and the driver rows, with the update
operation taking only the submit enum; a driver kind in an update is unwritable.
Trace: `impl/src/swarm-event-schemas.mjs:201-207` and `:252-297`;
`impl/src/swarm-contract.mjs:55-57`. Test: `impl/test/swarm-refusals.test.mjs:188` (a forged kind
refuses).

### PR-01 · proposed · constraint · Parse scope patterns when a worker is admitted, so no broken pattern exists downstream
Statement: Recruit scope entries pass a length and distinctness check but no pattern-grammar
check today; an invalid glob later matches everything in view derivations and escapes as an
untyped error in retained-result enforcement. Proposal: parse scope entries at recruit admission,
as workflow member scopes already are.
Plain explanation: When a worker declares which files it may touch, the patterns are checked for
count and distinctness but not for well-formedness; a malformed pattern discovered later makes
views over-restrictive and checks fail with an untyped error. The proposal is to reject malformed
patterns at admission, as one other subsystem already does. Without this rule, a typo in a scope
quietly widens what the worker can touch.
Bend2 carrier: parse the scope strings into the glob and path types at the recruit boundary, so
the recruit record takes a list of parsed patterns and invalid patterns are unwritable.
Trace: `impl/src/swarm-runtime.mjs:696-711`; `inDeclaredScope` `:991-999`;
`impl/src/context-runtime.mjs:632`; the existing precedent
`impl/src/workflow-interpreter.mjs:206-210`.

### PR-02 · proposed · constraint · Pin the scope pattern guard
Statement: No test pins the pattern guard's typed throw or the forbidden-shape matches-nothing
rule.
Plain explanation: The rule that malformed file-scope patterns are rejected and match nothing is
real but untested: nothing fails today if the rule is removed. The proposal is a small direct test
beside the existing dialect test. Without this pin, the guard can disappear in a refactor and
reach production unnoticed.
Not a law row: a pinning gap for AB-02's runtime arm; superseded once the AB-02 carriers land,
and until then the proposed test is the only evidence.
Trace: `impl/src/path-scope.mjs:5-8, 33-36`; nearest existing pin
`impl/test/phase83-context-runtime-red.test.mjs:24`.

### PR-03 · proposed · constraint · Pin the three unpinned permission arms
Statement: Three enforced arms lack pins: the out-of-list permissions refusal, the
update-permissions load assert, and no-elevation-by-delegation.
Plain explanation: Three permission rules are enforced but nothing fails if they are removed:
refusing an unknown authority name, refusing to start when the event-to-authority table is
incomplete, and refusing to grant an authority the granter lacks. The proposal is one test per
arm. Without these pins, the permission system can lose its edges silently.
Not a law row: the first two gaps are superseded by the PM-01 and PM-03 carriers; PM-08 stays
runtime, so its gap remains open.
Trace: `impl/src/swarm-runtime.mjs:7927-7929, 1034-1056, 7930-7932`.

### PR-04 · proposed · constraint · Pin the three unpinned landing arms
Statement: Three enforced arms lack pins: the landing-receipt payload set, the empty-range arm of
the change-invalid refusal, and the compare-and-swap race on the target branch.
Plain explanation: Three merge-time rules are enforced but untested: the exact shape of the merge
receipt, the refusal to merge an empty change set, and the refusal to merge onto a branch that
moved during the checks. The proposal is one test per arm. Without these pins, the merge machinery
can drift: receipts with missing fields, stacked empty merges, or merges onto stale bases.
Not a law row: the CS-19 and CL-10 gaps are superseded by their carriers; the CL-13 race stays
runtime, so its gap remains open.
Trace: `impl/src/swarm-state.mjs:951-996`; `impl/src/worktree.mjs:2294-2297, 2340-2348`.

### PR-05 · proposed · constraint · Unit-pin the refusal-table guard
Statement: The refusal-table guard's throwing branch is guarded only by a static source scan; a
direct unit test keeps the guarantee if the scan's literal detection drifts.
Plain explanation: The rule "an error code must exist in the table before code can raise it" is
checked today by a test that reads the program's source text looking for violations. If that
text-scanning test stops recognizing the pattern, the guarantee ends silently. The proposal is a
direct small test of the guard function itself.
Not a law row: superseded once the CS-16 refusal variant replaces stringly codes, since an
undeclared code becomes unwritable.
Trace: `impl/src/swarm-refusals.mjs:203-207`, wired at `impl/src/swarm-state.mjs:178-185` and
`impl/src/swarm-runtime.mjs:210-213`; current guard
`impl/test/issue430-swarm-refusal-set.test.mjs:215`.

---

## Development laws

### DEV-1 · development · law · No cutoff of any kind stops an agent's work or its input
Statement: No deadline, queue wait, size, count or buffer limit stops an agent control flow or an
input; a bound derived from a physical resource carries its derivation.
Plain explanation: The system never abandons an agent's work because too much time passed or too
many steps ran: a task that cannot start yet waits in line, an input of any size is accepted, and
nothing stops for being slow. The only limits are physical ones, such as the memory a machine
has, and any such limit states where its number comes from. Without this rule, long or large work
is stopped by limits that are stated nowhere.
Bend2 carrier: type-level plus the proven law — the admission result is a closed variant with no
timeout arm, so a cutoff on the wait is unwritable, and `worker_admitted_at_any_load` is proven
in the draft `laws.bend`.
Trace: operator ruling on #541, commit `bc2e4fcd`; `docs/bend2/MANDATE.md` §3; enforced by CAP-2,
CAP-3, CAP-5.

### DEV-2 · development · law · A request records its intent durably and answers at once
Statement: A verb records a durable intent and answers its receipt at once; never a synchronous
wait.
Plain explanation: When a worker asks the system to do something, the system writes the request
where it survives a crash and answers that it is recorded, immediately. The caller is never kept
waiting while the operation runs; slow work continues in the background and the worker learns the
outcome through notifications. Without this rule, a slow operation freezes the caller, and a
crash loses the request.
Bend2 carrier: type-level — the closed receipt record is all a verb answers; no constructor means
"still waiting", so a synchronous-wait result is unwritable.
Trace: operator rulings on #529 (commits `30cdb282`, `84357e4b`) and #543 (commit `25856479`);
`docs/54-native-wake.md:1-27`; enforced by WAKE-10.

### DEV-3 · development · law · Notifications are pushed to workers, never fetched by them
Statement: Wake is native and always on; it is not a verb a model invokes.
Plain explanation: Workers receive events — a teammate's report, a question, an assignment change
— at the moment they can act on them, the same way their instructions are handed to them at
start. A worker never runs a command to check for events, and no such command exists. Without
this rule, workers poll for events, or an agent that never learned the check command waits
indefinitely.
Bend2 carrier: type-level — the command enum is the whole command surface and carries no
notification-fetch constructor; a wake verb is unwritable.
Trace: `docs/54-native-wake.md:1-7`; operator rulings on #529 and #543; `docs/bend2/MANDATE.md` §3.

### DEV-4 · development · law · Every refusal names its rule, its field, and its remedy
Statement: Every refusal is typed and names its rule, its field and its remedy.
Plain explanation: A refusal is a structured answer stating which rule failed, which input caused
it, and what to change to succeed next time; the receiving agent can correct course without
reading prose. Without this rule, a refused request starts a cycle of blind retries, and one
misformatted field can end a run.
Bend2 carrier: type-level — the refusal record has three mandatory fields and no default; a
refusal missing any of the three is unwritable.
Trace: `docs/bend2/MANDATE.md` §3; enforced by CS-05, CS-16, CS-17.

### DEV-5 · development · law · Work lands red-first, through review and integrate, never by hand
Statement: A contribution lands red-first, through review and integrate, never by hand; the
target moves only through the gate.
Plain explanation: Every change to the shared branch follows the same sequence: specified with a
failing test first, reported, approved by someone other than the author, and merged by the
system's own gated machinery after the required checks pass. No report without a commit counts as
delivered. Without this rule, unreviewed or unverified changes enter the shared branch, and the
tests see the problem only after it lands.
Bend2 carrier: type-level — the landing type reaches its merged state only through an acceptance
value that only an accept review row builds; the compare-and-swap fast-forward remains a runtime
check the type cannot carry.
Trace: `docs/bend2/MANDATE.md` "Deliverable form"; `CONTRIBUTING.md` steps 4–5;
`docs/42-suite-legitimacy.md:112-115`; rulings on #539 (`58d0814e`, `13b104bc`); enforced by
CL-06, CL-08, CL-13.

### DEV-6 · development · constraint · A seat holds whole scope and full authority, never a slice
Statement: Orchestration gives a seat whole scope and full authority, never a slice of a mandate.
Plain explanation: When work is divided among workers, each worker receives a complete assignment
it can finish on its own, with the authority that finishing requires. Without this rule, work
stalls on missing authority, and the
coordinator becomes the limit on how much work can proceed.
Constraint: no carrier at the pin — the rule governs an orchestration process, not a value. A
proof form would take scope values built only by one total derivation from the mandate record,
with no constructor producing a partial scope; stating that derivation is a design choice for the
rewrite.
Trace: `docs/bend2/MANDATE.md` §3; `docs/39-swarm-runtime.md:1175-1178`.

### DEV-7 · development · constraint · Prose is plain technical English
Statement: Prose written for or checked into this repository is plain technical English: no
aphorism, no metaphor, no poetic description, no contrast-form description, no operational
journaling in product-facing documentation.
Plain explanation: The project's written material states facts directly in simple technical
language: each section names what it covers, each sentence carries information the reader could
not assume, and descriptions do not define a thing by what it is not. Development history belongs
in contributor documents, not product documents. Without this rule, the written surface drifts
into prose that readers and agents cannot act on.
Constraint: a prose property, review-enforced; no type system carries it.
Trace: `AGENTS.md` at the repository root.

---

## Counts

Candidates presented: 138 — 131 runtime rows from the two inventories (64 in the ledger lane: 12
custody, 17 capacity, 13 wake, 19 coordination-ledger, 3 proposed; 67 in the validator lane: 20
closed shapes, 14 authorization boundaries, 11 permission rows, 17 contribution and landing, 5
proposed) and 7 development laws.

Class marks: 99 rows are marked law (a Bend2 proof form is stated: 48 in the ledger lane's
domains, 46 in the validator lane's domains, 5 development); 39 rows are marked constraint (a
runtime check, with what a proof would take). All 8 proposed rows carry the constraint class per
the operator's rule: 4 of them (PROP-1..3, PR-01) state a carrier that becomes a law form once
the behavior exists and a compiled example pins it, and 4 (PR-02..05) are proposed test pins.

Marked unpinned (enforced, no pinning test): CAP-8, WAKE-10, LEDG-2 (half), LEDG-15, CUST-3 (no
direct test), CS-19, AB-02, PM-01 (refusal arm), PM-03, PM-08, CL-10 (arm), CL-13 (race arm).

Verification: every trace above was checked at this checkout; all 131 inventory rows hold, no row
was dropped for source drift. Every carrier named above is a proposal to pin: per the evidence
convention it needs a compiled, run example under `docs/bend2/examples/laws-*` before `laws.bend`
claims it.
