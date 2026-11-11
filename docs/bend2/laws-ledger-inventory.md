> Provenance: the findings of participant bend2-laws-ledger, a read-only seat that publishes no commit by
> contract. Recorded in this swarm as contribution-fc290d6fef34795ef324df677914ef2d (the curated inventory) and contribution-8f24661e9c4b706d57ae6c1c13e6c3ae (this document text); committed as a file by
> bend2-orchestrator2 on the seat's behalf, because the seat writes no file and its pillar lead's
> worker went inactive. Audited at base bc2e4fcd.
# Baton's laws: custody, capacity, wake, and coordination-ledger

This document extracts the invariants the implementation enforces in four areas: workspace
custody, host and worktree capacity, wake-stream semantics, and coordination-ledger semantics.
Each law names the source that enforces it and the test that pins it.

A law the source enforces and a test pins is marked **extracted**. A law worth stating that has no
single enforcement site at this revision is marked **proposed**. A law the source enforces with no
test behind it is marked **unpinned**; those are the rows this audit leaves open.

The closed-shape validators, the authorization boundaries, the swarm permission model, and the
contribution and landing contract sit outside this document's scope.

Audited revision: `bc2e4fcd` (`Issue #541: host admission never refuses for load or for waiting`),
base `31f356b2`. All line references are to that revision.

Law ids carry the area they belong to: `CUST` custody, `CAP` capacity, `WAKE` wake, `LEDG`
coordination ledger, `PROP` proposed.

Test citations are given as `file:line "test name"`. Where a test file's name ends in `-red`, that
file is a red lane whose rows are declared in `impl/scripts/expected-red-tests.json`; each red-lane
row cited here was run at this revision and passes.

## Custody

**CUST-1** *(extracted)* A handle holds a checkout until its hold is released. Holding is the absence
of a release: a terminal handle whose own cleanup has not finalized still holds the checkout.
Source: `impl/src/shared-workspace-custody.mjs:38` `holdsWorkspace` (holder statuses `:19`, attachable
statuses `:25`).
Test: `impl/test/shared-workspace-custody.test.mjs:318` "T3 the last holder closes a dirty shared
checkout only by retaining it, with no commit on the shared branch"; `:268` "T2 a stop detaches from
a shared checkout and leaves the resource to the live holder".

**CUST-2** *(extracted)* A checkout that is closing takes no new holder. The attachable statuses are
`pending`, `working`, `blocked` and `idle`.
Source: `impl/src/shared-workspace-custody.mjs:25` `ATTACHABLE_STATUSES`, read at `:76` inside
`workspaceAttachmentOf` `:70`.
Test: `impl/test/shared-workspace-custody.test.mjs:489` "T7 a source that is still a live member but
has no attachable checkout refuses"; `:425` "T6 an absent, self, departed, foreign-swarm, or
process-less source refuses without a holder".

**CUST-3** *(extracted)* Custody truth is the controller's own live worker handles. Swarm membership
and the workspace-owner receipt are separate records.
Source: module header `impl/src/shared-workspace-custody.mjs:1-13`; `workspaceHolders` `:53`. Consumers:
`liveWorkspaceHolders` `impl/src/runtime-api.mjs:583`, coordinator projection `impl/src/coordinator.mjs:4216`.
Test: none pins this directly. The nearest evidence is `impl/test/shared-workspace-custody.test.mjs:318`
"T3" for the shared checkout and the consumer paths above.

**CUST-4** *(extracted)* A removal observes the checkout before its first destructive effect and
refuses while un-captured content or another live holder is present. The two preservation reasons
carry distinct codes: `workspace_uncommitted_content_retained` and
`workspace_content_unobservable_retained` (`WorkspacePreservationError`); a live co-holder carries
`WorkspaceCustodyError`.
Source: `impl/src/worktree.mjs:1312` `assertRemovableContent` (`:1316` and `:1321` the preservation
codes, `:1326` the custody error); `observeOwnedWorktreeContent` `:1254` (`removable` flag `:1262`,
unobservable states `:1269` and `:1275`); `liveWorkspaceHolders` `:1300`.
Test: `impl/test/workspace-preservation.test.mjs:164` "reap() retains a dirty checkout for a dead owner
even with {force:true}"; `:501` "reconcile() retains a dead owner's dirty checkout and settles nobody's
capacity for it"; `:557` "reconcile() retains a dead owner's checkout whose only difference is
Git-ignored content"; `:587` "reconcile() never touches a live foreign controller's checkout, dirty or not".

**CUST-5** *(extracted)* Retention is the preservation mechanism. No caller option, `force` included,
authorizes destroying un-captured content. Nothing in this boundary stages, commits, stashes or
rewrites the content it judges.
Source: boundary comment `impl/src/worktree.mjs:1170-1183`; call sites `:2461` and `:2759`.
Test: `impl/test/workspace-preservation.test.mjs:234` "no caller option is an authorization to destroy
un-captured content"; `:217` "markStopped is not an authorization to destroy un-captured content".

**CUST-6** *(extracted)* The content destroyed without a capture is infrastructure the owner metadata
attests as runtime-materialized: `copiedDependencies` and `toolchainProjectionTargets`. Only paths Git
reports as untracked or ignored can be treated as generated.
Source: `impl/src/worktree.mjs:1187` `attestedInfrastructureRoots` (`:1190-1196` the literal-path filter
that rejects absolute, dot-dot, and `.git`/`.baton` roots); `observeOwnedWorktreeContent` `:1282-1284`
(status `??` or `!!`).
Test: `impl/test/workspace-preservation.test.mjs:311` "attested runtime infrastructure is generated,
not un-captured content"; `:418` "attested infrastructure never hides force-added source from
preservation"; `:396` "an attested dependency tree is not walked file by file".

**CUST-7** *(extracted)* A capture path refuses a workspace that resolves to the repository main checkout.
Source: `impl/src/worktree.mjs:1334` `validateOwnedWorktree` (`:1345` the resolved-path check, `:1349` the
expected-path check).
Test: `impl/test/workspace-preservation.test.mjs:438` "a directory that is not this repository's checkout
is retained".

**CUST-8** *(extracted)* A shared revision record describes the checkout and its observed HEAD with a
live holder count, and carries no authorship claim.
Source: `impl/src/shared-workspace-custody.mjs:97` `workspaceCustodyRecord`; consumer
`impl/src/runtime-api.mjs:213`.
Test: `impl/test/shared-workspace-custody.test.mjs:392` "T5 a shared revision describes the checkout and
its observed HEAD, never authorship".

**CUST-9** *(extracted)* A lane checkout is workspace separation: the ref namespace is shared and the
object store is shared.
Source: `impl/src/worktree.mjs:1434` `WORKTREE_GIT_SHARING` (`:1436` the statement, `:1439` `branchForTask`).
Test: `impl/test/issue412-worktree-non-isolation.test.mjs:47` "issue 412: the creation seam states
workspace separation is not git-ref isolation"; `:56` "issue 412: a lane checkout publishes a repo-visible
ref sharing the object store".

**CUST-10** *(extracted)* Before a removal boundary the lane branch is put at the checkout's HEAD. A branch
another worktree holds is left in place and the caller retains the checkout.
Source: `impl/src/worktree.mjs:1929` `ensureLaneBranchAtHead` (`:1939` the held-elsewhere refusal,
`:1942` the update-ref, `:1943` the reattach); `laneBranchHeldElsewhere` `:1907`; `laneBranchState` `:1892`.
Test: `impl/test/issue428-worktree-custody-on-stop.test.mjs:236` "428-B: a stop of a seat whose HEAD is
not on its branch puts the branch at HEAD first"; `:198` "428-A"; `:328` "428-D: a lane branch survives
stop and drain".

**CUST-11** *(extracted)* A physical workspace owner is allocated before any branch or worktree effect, as
one exclusive receipt published atomically. A restart reconciles a partial publication. A structurally
sound foreign receipt is retained diagnostically.
Source: `impl/src/worktree.mjs:740` `allocatePhysicalWorkspaceOwner`; `releasePhysicalWorkspaceOwner` `:824`;
`recoverWorkspaceOwnerPublication` `:598` (`:614` the ambiguous-allocation refusal);
`foreignConsistentReceipt` `:439` (`:447` the 64 KiB and mode bound).
Test: `impl/test/phase92.2-physical-workspace-owner-red.test.mjs:96` "P92.2-PO2: exclusive receipt
publication is failure-atomic before final-path visibility"; `:139` "P92.2-PO2: exclusive publication has
an exact durable-link commit boundary"; `:245` "P92.2-PO2: restart reconciles an exact dead-controller
temp-only publication"; `:433` "P92.2-RC2: dead foreign registered authority and a mismatched local branch
are retained diagnostically".

**CUST-12** *(extracted)* The detach gate and the reap backstop read one custody predicate.
Source: both call `liveWorkspaceHolders` `impl/src/worktree.mjs:1300`, from the checkout path `:1324` and the
residue path `:2946` (`workspace_other_holder_live_retained` `:2949`). That injected provider is
`workspaceHolders` `impl/src/shared-workspace-custody.mjs:53`.
Test: `impl/test/shared-workspace-custody.test.mjs:513` "T8 stopping a participant that owns its clean
checkout converges and removes the checkout"; `:532` "T9 residue no capture can record is retained with its
refusal event while the stop still converges".
## Capacity

**CAP-1** *(extracted)* Every host admission threshold derives from the host observation.
Source: `impl/src/host-capacity.mjs:230` `deriveHostCapacity`; `hostCapacityObservation` `:185`.
Test: `impl/test/issue297-issue307-host-capacity.test.mjs:48` "HC-1: every host admission threshold is a
derivation from the measurement, never a constant".

**CAP-2** *(extracted)* A worker lease holds no slot. A worker request is admitted at any load. The
derivation carries no worker shortfall dimension.
Source: `impl/src/host-capacity.mjs:274` `roomFor` (a kind other than `verify` returns true);
`leaseWeight` `:249` (worker weight `cores: 0, bytes: 0`).
Test: `impl/test/issue297-issue307-host-capacity.test.mjs:77` "HC-2: two residents share one host lease
directory; a worker holds no slot and is admitted at any load (#541), and a verify charges the suite
budget (FIFO, visible position, in-order drainage)"; `:182` "HC-4"; `:444` "HC-12 (#329, revised #541)".

**CAP-3** *(extracted)* An admission request is admitted once the derived budget has room and waits in
order until then, written as a visible queue entry carrying `position` and `ahead`. `acquire` carries no
deadline, so a request is admitted when the requests ahead of it release. `host_capacity_queue_timeout` is
no longer raised.
Source: `impl/src/host-capacity.mjs:704` `acquire` (`:712` the retry loop, `:739-746` the enqueue,
`:747-754` the queued row, `:767` the poll).
Test: `impl/test/issue512-suite-admission-refusal.test.mjs:150` "S512-3: a run behind another verify lease
waits and runs once it releases, or degrades at once on a host that cannot fund a suite - never refused
for waiting (#541)"; `impl/test/issue333-suite-verify-lease.test.mjs:191` "S333-4".

**CAP-4** *(extracted)* One verify lease charges the measured suite cost; only a verify is budgeted.
Source: `impl/src/host-capacity.mjs:249` `leaseWeight`; `budgetFits` `:263` (`:265-266` the core and byte
comparisons).
Test: `impl/test/issue297-issue307-host-capacity.test.mjs:77` "HC-2".

**CAP-5** *(extracted)* A host whose measured memory cannot fund one full suite answers at once with a
shortfall and no lease, and the caller proceeds without the lease.
Source: the standing-property branch inside `acquire` `impl/src/host-capacity.mjs:725-727`, the degraded
answer `:756`, `memoryTightFor` `:258`; the caller's warning `impl/scripts/suite-host-lease.mjs:103`
`formatSuiteDegradedWarning`.
Test: `impl/test/issue333-suite-verify-lease.test.mjs:77` "S333-1b: a host that cannot fund a suite answers
degraded at once - no wait, no queue row"; `impl/test/issue512-suite-admission-refusal.test.mjs:150` "S512-3".

**CAP-6** *(extracted)* A lease whose holder process is proved dead returns to the budget.
Source: the sweep `impl/src/host-capacity.mjs:714`; `livePid` `:117`.
Test: `impl/test/issue297-issue307-host-capacity.test.mjs:129` "HC-3: a proved-dead holder's lease returns
to the budget".

**CAP-7** *(extracted)* A release is identity-exact on `nonce` and `residentId`; a release naming a lease
this resident does not own is a no-op answering false.
Source: `impl/src/host-capacity.mjs:773` `release` (`:781` the identity comparison).
Test: `impl/test/issue297-issue307-host-capacity.test.mjs:129` "HC-3" (assert `:146` "a release naming a
lease this resident does not own is a no-op"); `impl/test/issue333-suite-verify-lease.test.mjs:96` "S333-2"
(assert `:105`).

**CAP-8** *(extracted, unpinned for the refusal path)* Lease, queue and observation records carry closed
field sets and a byte ceiling.
Source: `impl/src/host-capacity.mjs:53` `RECORD_BYTE_CEILING` (from `FRAME_LIMITS['stream.omp.flush']`),
`:54-55` `LEASE_FIELDS` and `QUEUE_FIELDS`; `validateRecord` `:365` (`:367` the exact key set, `:369-372` the
identity bounds); the mode and ceiling guard in `readRecord` `:384-386`.
Test: none pins the refusal path. Every staged lease and queue record in the suite passes the guard's accept
path (`impl/test/issue297-issue307-host-capacity.test.mjs:136-142`, `impl/test/issue506-queue-holder-liveness.test.mjs:33-42`,
`impl/test/issue495-post-admission-shed.test.mjs:59-67`, `impl/test/issue333-suite-verify-lease.test.mjs:169`,
`impl/test/issue424-seat-suite-lease.test.mjs:209`, `impl/test/issue459-integrate-off-loop.test.mjs:421-424`,
`impl/test/issue512-suite-admission-refusal.test.mjs:55`), so a guard made over-strict fails a test and a
guard made permissive fails none. The same guard family is pinned for the sibling module at
`impl/test/issue500-worktree-capacity.test.mjs:129` "500-cap-f: the capacity owner record is bounded at
4 096 bytes" (assert `:151`), which covers `impl/src/worktree-capacity.mjs`.

**CAP-9** *(extracted)* Every queue row reports whether its holder is alive, and a mutating read sweeps a
proved-dead entry.
Source: `impl/src/host-capacity.mjs:319` `projectParticipantVerify`; `observeParticipantVerify` `:687`
(`:691` the liveness filter).
Test: `impl/test/issue506-queue-holder-liveness.test.mjs:52` "HC-506-a: observeNow names each queue holder
alive or dead; a dead front holder never reads like a live queued request"; `:79` "HC-506-c: the mutating
read sweeps the dead entry (the reclaim half) and its row is gone, not stale".

**CAP-10** *(extracted)* A post-admission memory exhaustion sheds at most one verify lease per exhaustion
episode and records it once as `host.capacity_shed`.
Source: `impl/src/host-capacity.mjs:305` `HOST_CAPACITY_SHED_ROW`; `DEFAULT_SHED_POLL_MS` `:66`.
Test: `impl/test/issue495-post-admission-shed.test.mjs:136` "S495-3: the shed is bounded to ONE per
exhaustion episode"; `:162` "S495-4"; `:342` "S495-6".

**CAP-11** *(extracted)* The suite runner's lane width derives from the host observation. A host at or above
its core count takes one lane. `BATON_SUITE_PARALLELISM` is the operator override.
Source: `impl/src/host-capacity.mjs:345` `defaultSuiteParallelism` (`:347` reads `capacity.saturated`).
Test: `impl/test/issue424-seat-suite-lease.test.mjs:138` "S424-4: the lane width derives from the host's
current load, not from cores and memory alone"; `impl/test/issue297-issue307-host-capacity.test.mjs:223` "HC-6".

**CAP-12** *(extracted)* A nested runner is proved by the digest of the parent's lease token.
Source: `impl/scripts/suite-host-lease.mjs:38` `suiteLeaseTokenDigest`; `suiteLeaseNested` `:50`.
Test: `impl/test/issue424-seat-suite-lease.test.mjs:65` "S424-1: a run that only inherits the suite root
acquires the verify lease - the root alone is no bypass"; `:84` "S424-2: the nested bypass needs the
parent's lease token - the digest the parent itself derives"; `impl/test/issue333-suite-verify-lease.test.mjs:253` "S333-7".

**CAP-13** *(extracted)* The worktree capacity floor derives from the ledger's estimate high-water plus the
measured runtime footprint. State is sealed with an HMAC over canonical bytes and read from a confined
`0o700` root. Admission runs under one exclusive lock before any Git effect.
Source: `impl/src/worktree-capacity.mjs:158` `deriveWorktreeCapacityFloor`; `#effectiveFloor` `:324`;
`_seal` `:350`; `_read` `:378` (`:383` the mode and regular-file check, `:401-405` the `timingSafeEqual`
comparison); `_ensureRoot` `:363` (`:371-374` the confinement checks).
Test: `impl/test/issue297-issue307-host-capacity.test.mjs:257` "HC-7: the floor derivation is the largest
recorded estimate plus the measured footprint"; `impl/test/phase59-worktree-capacity-authority.test.mjs:348`
"WC3: byte max+1 refuses typed before worktree, runtime, task, or provider effect"; `:404` "WC4"; `:740`
"WC14: valid-shape ledger tampering fails HMAC validation closed".

**CAP-14** *(extracted)* A reservation is released by an exact token identity (`id`, `ownerId`, `nonce`). A
token from an earlier reservation cannot delete a later reservation that reused the same resource id.
Source: `impl/src/worktree-capacity.mjs:854` `releaseMany` (`:867-871` the identity comparison); `release` `:789`.
Test: `impl/test/phase59-worktree-capacity-authority.test.mjs:695` "WC12: stale release token cannot delete
a later reservation that reused the same resource id"; `:654` "WC10"; `:507` "WC5".

**CAP-15** *(extracted)* The capacity lock wait runs on monotonic elapsed time with a configurable deadline,
and every non-progress turn ends in a bounded slice. A live holder past the deadline is refused pre-effect.
An abandoned reaper gate is left in place. A corrupt or ambiguous lock refuses at once and is left in place.
Source: `impl/src/worktree-capacity.mjs:42-45` the constants; the acquisition loop `:520-535` (`:523` the
deadline); `_lockNow` `:543`; `_waitSlice` `:587` (`:591` the refusal).
Test: `impl/test/worktree-capacity-contention.test.mjs:314` "WCC3: a live holder past the deadline refuses
pre-effect, untouched and never stolen"; `:421` "WCC6: corrupt or ambiguous locks refuse at once without
waiting and are never deleted"; `:368` "WCC5"; `:455` "WCC7"; `:597` "WCC11".

**CAP-16** *(extracted)* One predicate decides workspace capacity pressure, and the deployment summary and
the `capacity_pressure` wake both read it.
Source: `impl/src/worktree-capacity.mjs:177` `workspaceCapacityPressure`.
Test: `impl/test/issue297-issue307-host-capacity.test.mjs:359` "HC-9: the deployment summary predicate
answers capacity pressure"; `impl/test/wake-stream.test.mjs:248` "a deployment below its capacity floors
wakes capacity_pressure at attach, and the CLI names the command that acts on it".

**CAP-17** *(extracted)* A worker-concurrency ceiling is configured only by the deployment caller; `null`
means unbounded. An invalid value refuses at construction rather than coercing.
Source: `impl/src/concurrency-policy.mjs:15` `normalizeConcurrencyCeiling`; `withinConcurrencyCeiling` `:25`.
Test: `impl/test/concurrency-policy-admission.test.mjs:148` "REP-1: no in-tree adapter invents a ceiling; a
configured value is preserved and an invalid one refuses"; `:182` "REP-2: the shared predicate treats null
as unbounded and a configured value as a real gate"; `:218` "DEP-2"; `:294` "ADM-4".
## Wake

**WAKE-1** *(extracted)* Every wake row derives from exactly one entry of one closed class table. A second
mapping of the same ledger key is a construction error.
Source: `impl/src/wake-stream.mjs:120` `WAKE_CLASS_TABLE`; `CLASS_BY_LEDGER_ROW` `:374` (`:378-379` the
duplicate-key throw); `wakeClassFor` `:398`.
Test: `impl/test/wake-stream.test.mjs:100` "the wake-class table derives every class from its own ledger
row, and admits nothing else"; `:291` "#272: one wake per coordination row, and harness chatter wakes nobody".

**WAKE-2** *(extracted)* The filter vocabulary is the class table. An unknown class refuses and names the
closed set. An alias resolves to its class.
Source: `impl/src/wake-stream.mjs:340` `WAKE_CLASSES`; the alias index `:353-364` (`:357` and `:359` the two
construction errors); `parseWakeFilter` `:455` (`:470-474` the refusal naming the set).
Test: `impl/test/wake-stream.test.mjs:128` "the filter admits only the closed class set, and refuses an
unknown class by naming the set"; `impl/test/wake-mcp-consumers.test.mjs:253` "an unknown wake class refuses
with the closed set, and no attachment is opened".

**WAKE-3** *(extracted)* The cursor is the coordination ledger seq. A pull from `since=N` reads from N+1 and
re-derives identical frames, so a reconnect has no gap and no duplicate.
Source: `impl/src/wake-stream.mjs:619` `cursorOf`; `head` `:691`; `pull` `:759` (`:763` the resume point,
`:779-787` the derivation loop).
Test: `impl/test/wake-stream.test.mjs:207` "the cursor resumes from the last seq a consumer saw, with no gap
and no duplicate"; `impl/test/wake-mcp-consumers.test.mjs:181` "a dropped attachment reconnects from the last
delivered seq, with no gap and no duplicate"; `impl/test/swarm-wake.test.mjs:222` "followWakes emits one page
per coordination row when the transport replays one (#272)".

**WAKE-4** *(extracted)* A pull with no cursor starts at the head, so an attachment begins at the current
head.
Source: `impl/src/wake-stream.mjs:763`.
Test: `impl/test/wake-stream.test.mjs:145` "one attachment receives the rows of every swarm the resident
hosts, including one created after it".

**WAKE-5** *(extracted)* A consumer further behind than the replay bound receives a typed
`baton.wake_stream_lagged` marker naming how many rows it lost.
Source: `impl/src/wake-stream.mjs:766-773` (`:770` the `dropped`, `fromSeq`, `toSeq` and `cursor` fields).
Test: `impl/test/wake-mcp-consumers.test.mjs:198` "a lagging stream tells the subscriber how much it lost,
in the stream's own typed frame" (assert `:209` the dropped count).

**WAKE-6** *(extracted)* A standing-fault observation class is announced at attach and on each crossing. A
change-class observation establishes its baseline at attach.
Source: `impl/src/wake-stream.mjs:342` `OBSERVATION_CLASSES`; `_observationFrames` `:741` (`:750` the
`announceStanding` gate).
Test: `impl/test/wake-stream.test.mjs:248` "a deployment below its capacity floors wakes capacity_pressure
at attach, and the CLI names the command that acts on it".

**WAKE-7** *(extracted)* The stream end reason and the attachment close reason are two closed vocabularies,
derived through one mapping for every transport. A status outside the vocabulary reads as a transport close.
Source: `impl/src/wake-stream.mjs:36` `WAKE_STREAM_END_REASONS`; `ATTACHMENT_CLOSED_REASONS` `:52`;
`attachmentClosedReason` `:57`; `attachmentClosedFrame` `:65` (`:66` the fallback); `attachmentClosedReceived` `:81`.
Test: `impl/test/issue356-wake-frame.test.mjs:221`, the row that carries a closed end reason and the CLI
print of it; `:275` the SSE ended frame; `:300` the transport-error cause; `:319` the local-transport
refusal code in the socket cause.

**WAKE-8** *(extracted)* One attachment carries the rows of every swarm the resident hosts, including one
created after the attachment, plus the deployment-scope rows.
Source: `impl/src/wake-stream.mjs:697` `_attribution`; `_swarmIds` `:717`.
Test: `impl/test/wake-stream.test.mjs:145`.

**WAKE-9** *(extracted)* A frame names the key it wrote and its actor and carries no body. Only a terminal
wake carries the command that acknowledges it.
Source: `impl/src/wake-stream.mjs:531` `deriveWakeFrame`; `wakeMatches` `:488`; the table's `next` field
`:99-102` and `wakeRow` `:112`.
Test: `impl/test/wake-stream.test.mjs:276` "#272: a context wake names the key it wrote and its actor, never
the body"; `:345` "#272: terminal rows carry the command that acknowledges them, and only terminal rows do".

**WAKE-10** *(extracted, unpinned)* The push form parks on the coordination store's `waitAfter`.
Source: `impl/src/wake-stream.mjs:813` `watch`, `:828` the park; `waitAfter` `impl/src/coordination-ledger-writes.mjs:761`.
Test: none observes a park from `WakeStream.watch`. The primitive's contract is pinned at
`impl/test/coordination-ledger-writes.test.mjs:226` (assert `:243`) and
`impl/test/phase66-run-continuation-export.test.mjs:205` (assert `:206-210`), and the two production call
sites (`impl/src/wake-stream.mjs:1148`, `impl/src/web-northbound.mjs:3301`) are exercised end to end by
`impl/test/issue316-sse-attachment-closed.test.mjs` and `impl/test/issue468-stream-errors.test.mjs`. A
regression that replaced the park with polling would fail no test.

**WAKE-11** *(extracted)* The served-commit header is read once per pull on the deployment-observation
cadence. A supplier that cannot answer yields `null`.
Source: `impl/src/wake-stream.mjs:678` `_servedFor` (`:681` the cadence guard, `:683-684` the null-on-failure read).
Test: `impl/test/issue316-provider-degraded.test.mjs:624` "316-c: the wake frame header carries the served
commit and how far behind master it is, read on the deployment cadence" (assert `:655` and `:658`, the
second of which states the header is read once at publish and refreshed on the cadence).

**WAKE-12** *(extracted)* A pull page is bounded by the transport frame ceiling and names the remainder
through a typed continuation.
Source: `impl/src/wake-stream.mjs:617` `DEFAULT_REPLAY_LIMIT` (from `FRAME_LIMITS['view.wake_replay.items']`);
`since` `:803` (`:806` the `baton.wake_page` frame).
Test: `impl/test/wake-mcp-consumers.test.mjs:232` "the pull page is bounded by the transport frame ceiling,
never by a row count"; `impl/test/issue507-wakes-since-cli.test.mjs:117` "507-a"; `:168` "507-b".

**WAKE-13** *(extracted)* A loopback WebSocket client frame must be masked; an unmasked one is a protocol
error closing 1002. A server frame is unmasked. A frame over the wire ceiling closes with 1009.
Source: `impl/src/wake-stream.mjs:1018` `encodeServerFrame`; `createFrameReader` `:1038` (`:1054` and `:1057`
the 1009 close, `:1058` the 1002 close).
Test: `impl/test/wake-binding.test.mjs:55` "a declared loopback binding serves the same wake stream to an
authenticated WebSocket client, and refuses an anonymous one".
## Coordination ledger

**LEDG-1** *(extracted)* The ledger is append-only and a row's `seq` is its one-based index. A row whose seq
is not its index refuses with `sequence_gap`.
Source: seq assignment `impl/src/coordination-ledger.mjs:1199`; the replay check `impl/src/coordination-replay.mjs:524`.
Test: `impl/test/phase11-coordination-store.test.mjs:204`, the startup row that rejects truncated tails,
sequence gaps and duplicate keys (assert `:207`).

**LEDG-2** *(extracted, half unpinned)* A tail with no trailing newline refuses with `truncated_tail`. A
stretch that is not its own exact UTF-8 bytes refuses with `invalid_utf8`.
Source: `impl/src/coordination-replay.mjs:464-466` `truncated_tail`; `_ledgerLines` `:493-499` `invalid_utf8`.
Test: `truncated_tail` is pinned at `impl/test/phase11-coordination-store.test.mjs:204`. No test under
`impl/test` names `invalid_utf8`.

**LEDG-3** *(extracted)* The idempotency key is the write identity: a repeat returns the original event. A
duplicate key at replay refuses with `duplicate_key`.
Source: the key replay `impl/src/coordination-ledger.mjs:1192-1193`; the key field on the row `:1199`; the
replay check `impl/src/coordination-replay.mjs:525-527`.
Test: `impl/test/phase11-coordination-store.test.mjs:36`, the duplicate-key row returning the original event;
`:204`.

**LEDG-4** *(extracted)* Only the writer-lease holder may append. Lease loss is typed. Replacement is
detected on `token`, `pid` and `pidStart`.
Source: the guard at the head of the append `impl/src/coordination-ledger.mjs:1184`; `_assertWriterLease`
`impl/src/coordination-admission.mjs:201`; `_assertLeaseOwnership` `:220-231` (`:227-229` the identity
comparison); `claimWriterLease` `impl/src/coordination-ledger-writes.mjs:493`.
Test: `impl/test/phase42-policy-invalidation.test.mjs:137`, the exclusive-policy-writer row (assert `:138`
`coordination_writer_busy`, `:141` `coordination_writer_lost` on a replaced lease);
`impl/test/phase56-drain-and-close.test.mjs:499`, the row where strict writer release neither deletes nor
blesses a replacement lease (assert `:502`).

**LEDG-5** *(extracted)* A writer claim is a short fail-closed exclusion window. A live or ambiguous
claimant is left in place; a stale claim is removed.
Source: `impl/src/coordination-ledger-writes.mjs:502-530` (`:514` the stale unlink, `:515` the ambiguous
refusal, `:518-521` the live-claimant refusal).
Test: `impl/test/phase42-policy-invalidation.test.mjs:137` (assert `:158` dead claim recovered, `:159` live
claim blocks, `:160` malformed claim refuses).

**LEDG-6** *(extracted)* A clean release flushes the pending group-commit before dropping the lease. A failed
sync refuses further durable writes with `coordination_ledger_unsynced` while readers continue.
Source: `impl/src/coordination-ledger-writes.mjs:560-565`; `impl/src/coordination-admission.mjs:208-216`.
Test: `impl/test/issue290-ledger-sync.test.mjs:22`, `:38` and `:47`.

**LEDG-7** *(extracted)* A fold failure poisons the projection and names the seq and the cause. The durable
bytes stay authoritative; readers continue and a restart with replay repairs.
Source: `_poisonProjection` `impl/src/coordination-ledger.mjs:1166` (`:1167` the first-write-wins freeze);
`impl/src/coordination-admission.mjs:202-207`.
Test: `impl/test/issue290-quarantine.test.mjs:30`; `impl/test/issue290-prospective-fold.test.mjs:63`.

**LEDG-8** *(extracted)* A recorded row the fold rejects is a typed startup refusal naming the seq, the kind,
the fold's own code and the remedy, raised at the replay fold site.
Source: `SwarmReplayRefusal` `impl/src/coordination-ledger.mjs:151` (`:154-162` the message, `:164-169` the
fields); `foldRow` `impl/src/coordination-replay.mjs:537-548`.
Test: `impl/test/issue304-fold-admission-gate.test.mjs:16`.

**LEDG-9** *(extracted)* Quarantine is idempotent for the same seq and entry and conflicting for a different
entry. The entry file is written temp, fsync, rename at mode `0o600`.
Source: `writeQuarantineEntry` `impl/src/coordination-ledger.mjs:103` (`:106-112` the duplicate and conflict
decision, `:118-123` the atomic write).
Test: `impl/test/issue290-quarantine.test.mjs:72`; `:120`.

**LEDG-10** *(extracted)* Compaction archives a prefix into content-addressed immutable segments. The index is
a cache. The segment lands before the ledger rewrite. Divergence from the loaded prefix refuses with
`coordination_compact_ledger_drift`; a mismatched cut refuses with `coordination_compact_cut_mismatch`.
Source: `compact` `impl/src/coordination-ledger-writes.mjs:646` (`:651` the cut bound, `:663-667` the drift
refusal, `:686-689` the cut mismatch); `_writeSegment` `:600` (`:606` the idempotent content-addressed write);
`_writeSegmentIndex` `:625`.
Test: `impl/test/ledger-compaction-223-red.test.mjs:71`; `:143`.

**LEDG-11** *(extracted)* The projection checkpoint is housekeeping: the ledger stays authoritative. It is
written off the request path, coalesced to one pending write, and bounded by its own projection ceiling.
Source: the interval decision `impl/src/coordination-ledger.mjs:1217-1234` (`:1224-1233` the deferred and
coalesced write); `_boundedCheckpointWrite` `:897` (`:901-905` the deferred skip when the projection is past
the ceiling); `impl/src/limits.mjs:375-378` `checkpoint.projection_bytes`.
Test: `impl/test/issue366-run-stop-replay-ceiling.test.mjs:361` (the clean release wrote the checkpoint);
`impl/test/issue351-startup-answer.test.mjs:366`; also covered by `impl/test/ledger-compaction-223-red.test.mjs:71`.

**LEDG-12** *(extracted)* The replay fold runs through one path for the synchronous open and the async open. A
half-loaded store does not survive a failed open.
Source: `_loadRun` `impl/src/coordination-replay.mjs:501-506` (the shared generator and `:515`
`store._loading`); `_apply` `impl/src/coordination-ledger.mjs:2314`.
Test: `impl/test/phase11-coordination-store.test.mjs:220` "CK2: queued DAG and ready set replay with exact
deps and reserved handle"; `:243` "CK2: terminal state is immutable across replay".

**LEDG-13** *(extracted)* A projection `{kind, seq}` pair resolves only through the declared reference
grammar. A kind outside the table, a seq outside the ledger, or a row whose kind disagrees resolves to `null`.
Source: `PROJECTION_REFERENCES` `impl/src/coordination-ledger.mjs:52`; `_projectionReferenceValue` `:739`
(`:743-746` the four rejections).
Test: `impl/test/issue465-second-copies.test.mjs:221` (assert `:245`, and `:254-257` where an orphan seq and a
wrong-kind pair both resolve null), `:262` (assert `:312-314`), `:166` (`:196`).

**LEDG-14** *(extracted)* The reverse lookup of the last matching event walks back from the tail in clone-free
bounded windows of 256 rows as far as seq 1.
Source: `WAITING_ON_TAIL_SCAN_CHUNK` `impl/src/application-observation.mjs:402`; `lastCoordinationEvent`
`:404` (`:411-419` the windowed walk); `eventCursor` `impl/src/coordination-ledger.mjs:3567`; `eventsView` `:3571`.
Test: `impl/test/issue140-waiting-on-tail-read.test.mjs:105`; `:132`; `:173`.

**LEDG-15** *(extracted, unpinned)* An append's `beforeWrite` gate must not change state; a gate that appends
refuses with `causal_correction_integrity`.
Source: `impl/src/coordination-ledger.mjs:1200-1204`.
Test: none. No test under `impl/test` names `causal_correction_integrity`.

**LEDG-16** *(extracted)* An append is refused before a deferred open's replay resolves, with
`coordination_store_loading`.
Source: `impl/src/coordination-ledger.mjs:1187-1189`.
Test: `impl/test/issue434-deferred-open-reconstruction.test.mjs:75`; `:43`.

**LEDG-17** *(extracted)* A recorded payload is judged prospectively by the fold's own rule before the durable
append. The fold rule and the write gate are one function.
Source: `assertWaveStartedRoster` `impl/src/coordination-ledger.mjs:80` (shared by the replay fold and the
write gate); the call `:1195-1198`; `_validateRecordedPayload` `impl/src/coordination-admission.mjs:233`
(`:242-246` the `wave.started` dispatch).
Test: `impl/test/issue290-prospective-fold.test.mjs:20`; `:47`.

**LEDG-18** *(extracted)* The session ledger is a second append-only log with its own durability law:
`truncated_tail`, `sequence_gap` naming line and seq and both writers, and `schema_version`.
Source: `_lines` `impl/src/web-auth.mjs:70` (`:73` `truncated_tail`); `_consume` `:80` (`:84` `schema_version`,
`:85` `sequence_gap`); the append that numbers from disk `:92-98`.
Test: `impl/test/issue487-session-ledger-dual-writer.test.mjs:55`; `:89`, the row refusing typed and naming
line, seq and both writers; `:123`.

**LEDG-19** *(extracted)* The head is the event count. A cursor past the head refuses. Every wait arms from the
head.
Source: `ledgerHeadSeq` `impl/src/coordination-ledger.mjs:5580`; `eventCursor` `:3567`; `waitAfter`
`impl/src/coordination-ledger-writes.mjs:761` (`:762-768` the argument validation, `:769` the immediate answer
when the head has moved).
Test: `impl/test/evidence-search-deployment.test.mjs:89` (assert `:97`, where the cursor is the ledger head
seq); `impl/test/coordination-ledger-writes.test.mjs:226` (assert `:243`);
`impl/test/phase66-run-continuation-export.test.mjs:205` (assert `:206-210`).
## Proposed laws

These three laws carry no single enforcement site at this revision. Each is stated as proposed rather
than extracted, and each lists the nearest partial evidence.

**PROP-1** *(proposed)* A ledger read is bounded. The bound exists per reader: `#140` bounds the
waiting-on tail scan through `WAITING_ON_TAIL_SCAN_CHUNK` (`impl/src/application-observation.mjs:402`,
used by `lastCoordinationEvent` `:404`), and `#464`/`#465` bound the projection through
`checkpoint.projection_bytes` (`impl/src/limits.mjs:375-377`). No single predicate states the law.
Partial evidence: `impl/test/issue140-waiting-on-tail-read.test.mjs` pins the `#140` reader (6 tests, all
passing); no test asserts the law itself.

**PROP-2** *(proposed)* The fold is total over recorded history: replay of any ledger the appender accepted
produces a projection. The prospective write gate (LEDG-17), the quarantine verb (LEDG-9) and the static
fold-safety gate defend it at run time and at review time respectively.
Partial evidence: `impl/test/issue290-prospective-fold.test.mjs` and
`impl/test/issue304-fold-admission-gate.test.mjs` both pass. No runtime predicate states the law.

**PROP-3** *(proposed)* One writer per ledger. Two arms exist: the coordination writer lease (LEDG-4 and
LEDG-5, `impl/src/coordination-ledger-writes.mjs:493`) and the session-ledger numbering rule
(`impl/src/web-auth.mjs:70` and `:80`). Each arm is pinned separately
(`impl/test/phase42-policy-invalidation.test.mjs:137`;
`impl/test/issue487-session-ledger-dual-writer.test.mjs:55`, `:89`, `:123`). No single law joins them.

## Findings

### Laws the source enforces with no test behind them

Four enforcement sites have no test that fails when the site is removed or loosened. Each is a
candidate for a pinning test before the law is treated as extracted in `laws.bend`.

- **CAP-8**, the host-capacity record guard (`impl/src/host-capacity.mjs:365` `validateRecord`, `:384-386`
  the mode and byte-ceiling guard in `readRecord`). Every staged lease and queue record in the suite
  passes the guard's accept path, so a guard made over-strict fails a test and a guard made permissive
  fails none. The same guard family is pinned for the worktree capacity module at
  `impl/test/issue500-worktree-capacity.test.mjs:129` (assert `:151`).
- **WAKE-10**, the park in `WakeStream.watch` (`impl/src/wake-stream.mjs:828`). The `waitAfter` primitive
  is pinned; the call site is exercised only through the SSE attachment tests, which assert delivery
  rather than the wait. A regression to polling would fail no test.
- **LEDG-2**, the `invalid_utf8` half (`impl/src/coordination-replay.mjs:493-499`). The `truncated_tail`
  half of the same law is pinned. No test names `invalid_utf8`.
- **LEDG-15**, the before-write gate rule (`impl/src/coordination-ledger.mjs:1200-1204`). No test names
  `causal_correction_integrity`.

### Laws with no test citation

- **CUST-3**, custody truth as the controller's handle set. The consumer paths are exercised by
  `impl/test/shared-workspace-custody.test.mjs` and the workspace projection tests, and no test asserts
  that custody truth is the handle set rather than swarm membership.
- **LEDG-11**, whose citation previously reused the LEDG-10 test. The stronger pins are
  `impl/test/issue366-run-stop-replay-ceiling.test.mjs:361` and `impl/test/issue351-startup-answer.test.mjs:366`.

### Documentation drift in `impl/src/host-capacity.mjs`

`#541` changed the enforced capacity law at this revision and left four docblock passages stating the
retired one. The enforced behavior is CAP-2, CAP-3 and CAP-5 above; the following passages disagree with
the code they sit beside:

- `:215-217` derives `saturated: load1m >= cores` and states that new heavy work queues.
- `:225-228` states that worker admission is gated only by `saturated`.
- `:255-257` states that a worker is gated by load alone.
- `:279-284` lists `load` among the shortfall dimensions and states that a worker can only ever wait on it.

The module header (`:14-18`) and the `acquire` docblock (`:699-703`) state the current law. The derived
field `saturated` is still computed at `:242` and still read by `defaultSuiteParallelism` at `:347`, so it
remains live for the suite lane width and is no longer an admission gate. `roomFor` (`:274`) admits a
worker unconditionally and `hostCapacityShortfall` (`:285`) cannot return the `load` dimension.

### A test citation to avoid

`impl/test/prescriptive-doctor-red.test.mjs:769` states the `coordination_writer_lost` cause and the
`pidStart` mismatch, and it sits inside a row that `impl/scripts/expected-red-tests.json` declares
expected-red. Use `impl/test/phase42-policy-invalidation.test.mjs:137` and
`impl/test/phase56-drain-and-close.test.mjs:499` for LEDG-4.

### Reading a `-red` test file

A file whose name ends in `-red` is a red lane, and a red lane may contain rows that already pass. Of the
red-named files cited here, `impl/test/issue140-waiting-on-tail-read.test.mjs` (6 rows),
`impl/test/ledger-compaction-223-red.test.mjs` (2 rows) and `impl/test/issue304-fold-admission-gate.test.mjs`
(4 rows) all pass at this revision. Conversely `impl/test/cross-deployment-knowledge-red.test.mjs` fails 22
of its rows, all 22 declared expected-red. The only reliable test of a citation is to run the file and to
check `impl/scripts/expected-red-tests.json`, which held 451 entries at this revision.

## Evidence

All runs were made from `impl/` in a checkout at `bc2e4fcd`, using `node --test` on the named files.

- `test/shared-workspace-custody.test.mjs test/issue297-issue307-host-capacity.test.mjs` - 21 tests, 21 pass, 0 fail.
- `test/wake-stream.test.mjs test/wake-mcp-consumers.test.mjs` - 18 tests, 18 pass, 0 fail.
- `test/issue290-prospective-fold.test.mjs test/issue290-ledger-sync.test.mjs test/issue290-quarantine.test.mjs
  test/ledger-compaction-223-red.test.mjs test/issue487-session-ledger-dual-writer.test.mjs
  test/issue140-waiting-on-tail-read.test.mjs test/issue434-deferred-open-reconstruction.test.mjs
  test/issue304-fold-admission-gate.test.mjs` - 27 tests, 27 pass, 0 fail.
- `test/concurrency-policy-admission.test.mjs test/issue465-second-copies.test.mjs
  test/issue316-provider-degraded.test.mjs test/evidence-search-deployment.test.mjs` - 33 tests, 33 pass, 0 fail.
- `test/coordination-ledger-writes.test.mjs test/phase66-run-continuation-export.test.mjs
  test/issue500-worktree-capacity.test.mjs` - 17 tests, 17 pass, 0 fail.
- `test/phase42-policy-invalidation.test.mjs` - 18 tests, 18 pass, 0 fail.
- `test/phase56-drain-and-close.test.mjs` - 45 tests, 45 pass, 0 fail.
- `test/phase11-coordination-store.test.mjs` - 30 tests, 29 pass, 1 fail. The failure is
  `CK8/CK9: public driver exposes coordination and queued DAG survives restart before dispatch`, declared
  expected-red at `impl/scripts/expected-red-tests.json:880` with reason `design`. The ledger law it
  touches (replay determinism, LEDG-12) is separately pinned by the two passing CK2 rows at `:220` and `:243`.

Total across the runs above: 209 tests, 208 pass, and 1 fail that the expected-red manifest declares.
