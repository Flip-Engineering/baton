# Worker disk lifecycle

Design proposal for [#1049](https://github.com/Flip-Engineering/baton/issues/1049),
2026-10-23. Source reviewed:
[`fdfe1c85c64d21058b4366d8f83dd669cb0022b9`](https://github.com/Flip-Engineering/baton/commit/fdfe1c85c64d21058b4366d8f83dd669cb0022b9).
The conductor reviews this design, the root critiques it, and the conductor
staffs the accepted implementation. This contribution changes documentation.

## Recommendation and scope

Phase 1 automatically collects two homelab allocation classes: completed,
clean merge/review worktrees whose source is verified on the actual shared Git
remote, and inactive Cargo target trees with established producing-source and
toolchain provenance. It uses project Git administration, existing execution
and session records, build-wrapper output paths, current process references and
the existing collector. The root's merge operations use this same path.

The [October 23 incident](https://github.com/Flip-Engineering/baton/issues/1049)
recovered about 54 GB from twelve clean, pushed worktrees created by the root,
23 GB from three inactive Cargo targets and 18 GB from a shared target. Those
observations select the Phase 1 scope. The root's
[incident report](https://github.com/Flip-Engineering/baton/issues/1049)
says it recovered "about 100 GB in 15 minutes". Its three category estimates
sum to approximately 95 GB (54 + 23 + 18); the rounded report and category
estimates remain separate observations. The report records the Docker failure
and PostgreSQL restart when the root filesystem reached zero available bytes.

Automatic collection follows completed operations and verified publication.
An unreadable, active, dirty or insufficiently documented allocation stays in
place with its reason reported. Eligibility is evaluated for each allocation.
Phase 1 can collect an eligible worktree while an unrelated evidence directory
remains unreadable.

The remaining #1049 coverage is explicit follow-on work: dirty source snapshots,
non-Git evidence, exports without Git administration, independent clones outside
known roots, and the Mac's unidentified temporary-store producer. Each has a
named observation and acceptance condition below. Phase 1 leaves those paths
available and reports them.

## Evidence and measurement limits

The [measurement record on #1049](https://github.com/Flip-Engineering/baton/issues/1049#issuecomment-6376239439)
contains the dated homelab path inventory, remote-state samples, derived open
seat/path observations, complete measurement commands and retained evidence
locations. Seat inventories remain derived observations on the issue. Runtime
selection reads the current database and Git administration.

On October 23 at 19:57:54Z, `df -B1` reported 154,108,878,848 available bytes on
`/` and 755,927,367,680 on `/mnt/nvme4tb`. Read-only allocated-block measurements
found at least 119.618 GB in the film workspace, 27.774 GB in `/tmp`, 303.730 GB in
the Baton service home, 75.809 GB in the shared film build-cache root and
1,187.998 GB in the farm tree. Decimal GB means bytes divided by 10^9.
These are later observations than the incident recovery. Overlapping directory
measurements, concurrent writes and permission failures prevent adding them
into a physical recovery total.

The project Git worktree listings completed successfully in 0.037851 seconds
for ACP and 0.015658 seconds for FFrames. These timings cover listing only.
Remote verification, dirt inspection and removal costs are unmeasured. The CI
subtree traversal took 254.208 seconds; the farm traversal took 204.754 seconds.
Both returned exit 1 with access errors. Phase 1 uses the Git listings and exact
target paths. Whole-filesystem traversal has no Phase 1 trigger or schedule.

The sampled `/tmp/acp261` HEAD matched its GitHub branch at
`645f50ce12dd660676f086ca9ae517c3cf325b5a`, while the index and working tree
contained changes. `/tmp/acp261-dsh-flash-1` was clean but its origin was another
directory on the homelab. `/tmp/acp-0022acae` had no usable Git metadata.
All three belonged to UID 986. Content and actual remote verification explain
their retention decisions. The evidence identifies no file whose safe removal
depended on learning its creator from a distinct per-seat UID.

The [October 21 Mac recovery](https://github.com/Flip-Engineering/baton/issues/912#issuecomment-6324562529)
removed 216 inactive temporary Git stores and three duplicate checkouts, with
37,515,296,768 bytes of net physical APFS recovery. The producing component
remained unidentified. The separate
[Cargo cleanup observation](https://github.com/Flip-Engineering/baton/issues/988#issuecomment-6304769414)
records 12,849,438,720 allocated bytes in three Mac target directories.
Fresh Mac and privileged homelab measurements are unavailable for this revision.
The existing measurements supply the stated observations; creator attribution,
complete host totals and Darwin cleanup behavior remain unmeasured.

## Existing mechanisms and their coverage

| Work | Implemented or recorded coverage | Why the October 23 incident remained possible |
| --- | --- | --- |
| [#912](https://github.com/Flip-Engineering/baton/issues/912) | Storage classes, preview and protected removal primitives; NVMe build scratch and selected log-clean services. PR #934 merged as `4e436548`. | General apply remains disabled for configured roots. The issue's later reviews identify missing participation by real writer entry points. Placement fixes cover selected callers. |
| [#988](https://github.com/Flip-Engineering/baton/issues/988) | Tracks completion/consolidation cleanup. Recovery measured 123,962,974,208 allocated bytes removed on homelab; wrapper placement was corrected. | General lifecycle integration remains open. Earlier records omitted actual target paths: 982 of 986 inspected build attempts lacked `target_dir`; direct Cargo commands bypassed the wrapper. |
| [#644](https://github.com/Flip-Engineering/baton/issues/644) | Resident `.baton/wt` custody audit identified uncaptured content and unresolved controller authority. | Custody and generated-path classification retained affected trees. Discovery covers resident-owned workspaces; film shell clones need their own producer paths. |
| [#568](https://github.com/Flip-Engineering/baton/issues/568) | Runtime removal of ended participants' owned workspaces and runtime scopes; landed as `cefd16d6`. Its comments also report 79 auxiliary verification trees in `/private/tmp`. | Registered ownership supplies the cleanup boundary. Arbitrary later shell allocations and the root's own merge trees still require coverage. The historical disk-admission proposal is superseded by current project instructions. |
| [#616](https://github.com/Flip-Engineering/baton/issues/616) | Startup captures dirty content from already-terminal seats and reclaims registered owned trees; terminal cleanup captures late files. Promoted as `addc4b77`. | The reconciler enumerates its owned workspace administration and known holders. It does not inventory arbitrary paths created by shell tools. |
| [#620](https://github.com/Flip-Engineering/baton/issues/620) | Startup handles unregistered leftover directories under `.baton/wt`, preserving tracked edits and deletions first; promoted as `2612f388`. | Discovery remains inside that authority root. Its review corrected a real tracked-edit deletion defect. Untracked/ignored infrastructure was excluded by the old contract, so it cannot establish complete reviewer-evidence retention. |
| [#594](https://github.com/Flip-Engineering/baton/issues/594) | Event-driven push of owned seat commits and private-index snapshots; landed as `3455e115`. | Source preservation has a repository/seat boundary. It does not identify every external clone or retain arbitrary evidence, cache inputs and native logs. A local snapshot ref also needs actual remote verification. |
| [#558](https://github.com/Flip-Engineering/baton/issues/558) | Established the remote publication requirement after local integrate receipts reported unpublished landings. | Publication and cleanup are distinct effects. Current fast-forward landing and push are separate operations. A local landing result supplies no complete path-retention proof. |
| [#686](https://github.com/Flip-Engineering/baton/issues/686) | Operational verbosity, provider event selection, storage inspection, attempt cleanup and log-preservation work. | Collection covers named log/attempt files and settlement conditions. Active, failed and diagnostic evidence remains local; source/build trees are outside this collector. Smaller operational logs do not collect retained raw attempt outputs. |

The [implementation review on #988](https://github.com/Flip-Engineering/baton/issues/988#issuecomment-6304957332)
identifies [`Logs.storage`](../bend2/src/coordinator/logs.bend), `clean_attempts`, `clean_attempt_logs` and
`clean_owned` as integration points. At the reviewed source, `storage` enumerates
`log_files`, `executions` and stderr generations. `attempt_cleanup_files` names
stdout, stderr files, `observer.log` and `keeper.log`. `clean_owned` holds the
session lock and rereads pending input. This is useful existing ownership and
collection code; a general filesystem artifact registry still requires extension.

[`storage/state.bend`](../bend2/src/storage/state.bend) derives ownership from
workspace, execution and registered log paths.
[`lifecycle.bend:apply_session`](../bend2/src/storage/lifecycle.bend) returns status 3 for any
nonempty configuration because the cooperative root writer protocol is absent.
The internal apply primitive rereads source state and verifies path identity.
This design preserves those existing protections and adds the real producers
to the ownership model before enabling collection of their roots.

[`git/land.bend:ld_settle`](../bend2/src/git/land.bend) removes exactly a checked landing's candidate and target
scratch trees for `LLanded` or `LAlready`; other results keep them. The current
[`coordinator/land.bend`](../bend2/src/coordinator/land.bend) fast-forward route calls `GitLand.land`. `push_git` and
`remote_tip_git` are separate helpers with explicit destinations. General cleanup
must use the subsequent verified publication event. It must retain source and
review evidence from failed or conflicted scratch trees before collecting them.

Historical `impl/src/worktree.mjs` at `addc4b77` and `2612f388` confirms the
#616/#620 scope: workspace owner receipts, `.baton/wt` enumeration, lane-branch
containment, live holders and recovery capture. These historical JavaScript
mechanisms are evidence for the existing behavior; their presence does not
establish equivalent deployment of the current native runtime.

## Candidate designs

| Candidate | Decision and cost |
| --- | --- |
| Project paths, Git discovery and producer lifecycle | Recommended for Phase 1. Git lists auxiliary worktrees created by root shell commands; wrapper records identify actual Cargo outputs. Existing source and process observations determine eligibility per allocation. This requires collector call sites and producer-path integration. It covers the two incident classes. |
| Registered-seat cleanup alone | Covers recorded seat workspaces. The root's twelve merge worktrees contributed about 54 GB outside that ownership path. Add project Git discovery and root operation completion to reach this observed category. |
| Per-seat UIDs and filesystem-wide reconciliation | Removed from the recommendation. The samples establish shared account ownership, with no measured removal decision requiring a distinct UID. Account provisioning, credential migration and native launch changes have no qualifying failed run here. The measured broad scans also return incomplete results at substantial cost. |
| Private filesystem or VM per seat | Removed from Phase 1. The two incident classes have exact Git or producer paths. VM/overlay launch integration and shared-cache handling add unmeasured implementation costs. A future proposal needs a failed path-based collection run that establishes the missing function. |

Path-based attribution gives new allocations a seat-rooted NVMe working
directory and derives the seat from the native launch context. A Linux launch
can bind its private NVMe temporary directory at `/tmp` and use a seat-rooted
home. Darwin launch configuration can select seat-rooted `HOME` and `TMPDIR`.
These placement choices cover consumers of those paths and variables.
Literal external paths require their own producer evidence. Phase 1 uses the
existing NVMe placement repairs and qualifies any additional binding at the
affected Linux launch path; it introduces no per-seat operating-system account.

## Phase 1 allocation discovery and attribution

The Phase 1 mechanisms serve these recorded failures:

| Mechanism | Failed run and changed decision |
| --- | --- |
| Project Git worktree discovery, including root operations | October 23: twelve pushed root merge trees retained about 54 GB. They enter the same candidate path as seat worktrees. |
| Actual off-host source verification | #558: local landing receipts reported unpublished work. The allocation stays local until its required objects are verified at the shared remote. |
| Resolved Cargo target and producing-input observations | #988: direct Cargo commands accumulated output outside wrapper records; most old records omitted the target. Exact producer paths distinguish generated allocations from unresolved directories. |
| Completion/publication callbacks and restart reconciliation | October 23: completed work remained after push; #616: already-ended work survived earlier startup cleanup. Released known allocations are reconsidered automatically at these events. |
| Current local references and existing execution/build boundaries | #988 found active producer paths outside canonical records; the October 23 recovery checked that Cargo had exited. A live or uninspectable producer keeps its target. |
| Per-allocation content and path checks | #620's first patch lost a tracked edit. Dirty or unresolved content keeps the affected tree; an unrelated inaccessible path has its own retained result. |

Per-seat accounts, account retirement, filesystem-wide settlement, automatic
archives of unknown content and a new bulk evidence-store dependency are outside
Phase 1. Their inclusion in a later implementation requires the specific failed
producer or retention run identified in the follow-on scope.

The existing configured project repositories and disposable work roots define
where collection applies. Query `git worktree list --porcelain` for each project
repository. It includes linked checkouts created through ordinary
`git worktree add`, including the root's integration checkouts. Resolve the Git
common directory and exact worktree path from Git. The primary checkout stays
a project input.

Associate a worktree with the current session or operation through matching
workspace, execution-cwd and retained Git-operation records. A tree with no
unique seat match remains attributed to its repository/project. Repository
authority, disposable-root configuration and source durability can be known
while the particular creating seat remains unknown. Eligibility uses the
established project, path, source and current-reference evidence.

New merge/review operations use the existing repository operation path to
allocate scratch. Baton records the actual path, source and execution outcome
as part of that operation. The root supplies the semantic repository, source
and target; action and allocation identities come from context. Shell-created
linked worktrees are discovered through the project Git listing. A standalone
clone or source export outside those roots remains follow-on work.

For Cargo, record the resolved target path from the producing environment and
wrapper invocation. The current film wrapper selects
`/mnt/nvme4tb/ci-runners/fframes-port-20261016-build-cache/target` by default and
records `target_dir`. It also uses existing campaign build locks.
[#988's recovery](https://github.com/Flip-Engineering/baton/issues/988#issuecomment-6304728457)
found direct Cargo commands outside this wrapper; most inspected old records
omitted the target path. Integration must cover those actual entry points:
route campaign Cargo execution through the wrapper and propagate the resolved
target path through the existing execution record. Observe explicit overrides.
An unidentified target remains reported with its provenance gap.

The producing operation records source commit or preserved dirty-source
generation, toolchain identity, command, environment inputs, output location
and completed process result automatically. These are execution observations.
Agents do not maintain allocation lists, consumer declarations or cleanup
receipts.

### Derived local consumers

| Relationship | Source used by tooling |
| --- | --- |
| Seat currently uses a checkout | Session/join workspace records, current assignment and execution cwd; resolve path aliases before comparison |
| Operation still owns scratch or a target | Existing execution handle, its process descendants and terminal/release state; retain ownership through final output |
| Another Git checkout uses shared administration | Git's worktree listing and common-directory resolution |
| Process currently uses the allocation | Relevant Linux cwd, executable, open descriptors and mapped files; associate descendants with their recorded executions |
| Pending work needs a local workspace | Current assignment, pending input and native continuation context associated with that workspace |
| Build uses a shared target | Resolved target paths in wrapper/execution records, existing build-lock ownership and current Cargo process environment/reference evidence |
| Runtime or rollback selection uses a path | Existing deployed release selection and rollback configuration; an unresolvable selection preserves the affected path |

These relationships are derived again when collection runs. A derived cache
of the observations can support display. Tooling uses current source observations
for the removal decision.

### Consumer evidence and the #1045 prerequisite

[#1045](https://github.com/Flip-Engineering/baton/issues/1045) records
`apply-removed` returning `process-unknown` in four of four runs on main on this
host. The issue identifies access errors, process exit, directory-read errors
and fixed scan truncation as possible causes; it has not confirmed which one
caused those runs. [`host/storage.c`](../bend2/src/host/storage.c) currently
limits fd and mapping enumeration to 4096 entries and also limits process and
reference counts. Those limits can prevent a definite answer about a candidate.

Resolving this failure in the consumer-check path is a Phase 1 prerequisite.
The current generic `process-unknown` result cannot qualify the root merge
worktrees for collection. Phase 1 uses the following candidate-specific evidence:

1. Read Git's lock/prunable state for the exact registered worktree. A locked
   worktree stays in place; a prunable record requires administration repair
   before it can supply an ordinary checkout decision.
2. Resolve current session/join workspaces, assignments, pending continuation
   and owned executions against that path. A live relationship supplies a
   definite consumer and keeps the worktree through gaps between tool calls.
3. Under the existing operation ownership boundary, inspect cwd, executable,
   descriptors and mapped-file references for processes owned by the collecting
   account. Match the candidate's canonical path, descendants and file identity.
   Recorded consumers under another account are inspected through that service's
   existing owner; unresolved service use keeps the candidate.
4. Return `no-consumer` only after the relevant reads complete and no reference
   matches. A positive match returns `consumer-present`. An unresolved read
   returns `consumer-unknown` with the candidate, PID, operation and actual
   error; it supplies no deletion authority.

The #1045 repair must read fd/maps directories to their actual end and remove
the fixed process/reference truncation from this decision. It must identify
the actual failing PID/read in the reproduced run, distinguish a confirmed
exited process from a live unreadable one, and preserve actual allocation and
I/O errors. No replacement numeric scan limit is proposed. Readability of
unrelated disk directories is outside this process-reference check. An
unreadable live process with unresolved candidate relevance remains unknown;
classifying it as unrelated requires evidence.

Qualification uses the affected homelab account and the twelve-root-merge-worktree
case. The original trees were removed in recovery, so rerun their normal
merge/push/release workflow on the same busy host and record the actual paths.
Released, clean, remotely published worktrees must receive definite
`no-consumer` results while a current workspace and a process actually using a
candidate receive definite consumer results and remain present. If the selected
path still answers `process-unknown` or `consumer-unknown`, Phase 1 qualification
is incomplete. This prerequisite has not passed in the evidence available to
this design; a baseline failure on main does not establish working collection.

## Phase 1 retention and removal

### Clean merge and review worktrees

Before collecting a linked worktree, establish the following from current
source and execution state:

1. Git identifies its exact project, administration and path inside a configured
   disposable work root. The current operation has released it.
2. Its tracked state is clean. Inspect untracked and ignored content as well.
   Known Cargo output is handled as a child allocation; other unique files
   preserve the worktree and appear in its report.
3. HEAD and every source ref needed by the completed operation are available
   from the project's declared off-host publish remote.
4. Git lock state and current session, assignment, process and operation
   observations produce a definite `no-consumer` answer through the qualified
   #1045 consumer path above. Preserve current workspaces and unfinished
   operations through quiet gaps between their tool calls.
5. The exact path and filesystem object still match the inspected allocation.

Read the actual publish endpoint. Query the relevant remote refs and verify
the retained source commit against those objects. A source that is an ancestor
of a verified remote target is durable; a squash landing also needs the
original source ref retained for its review history. Use Git's object/ref
operations to establish the relationship, with an exact preserve ref where
needed. Local remote-tracking refs and an `integrated` field leave remote
publication unverified.

Use the configured shared destination, including the film campaign's private
Git repositories. The same-host NVMe `origin` in the sample requires checking
the project's actual off-host destination. A failed query or missing source
keeps the checkout. A successful check records the repository, ref and source
object IDs so the reviewer can read or fetch the retained work.

After the observations pass under the existing operation/session ownership
boundary, remove the linked worktree through Git and settle its administration.
Keep the branch/preserve refs. Reuse the existing descriptor-relative identity
checks for filesystem removal. Record actual results in the operation outcome.

The root's managed merge operation releases its scratch after actual remote
publication and terminal output. Raw shell-created worktrees remain pinned
while their producing assignment or continuation needs them; completion of
that assignment triggers the same project sweep. A published branch alone
does not end an active operation.

### Known Cargo output

A Cargo target becomes eligible when the producing runs have completed,
source and toolchain provenance establish its generated contents, source is
retained on the actual off-host Git remote, and current readers/writers and
runtime references have released it.

Keep source and toolchain provenance and completed process evidence in their
existing execution records. Validation output already resides in attempt
outputs outside the target directory, where its existing retention continues.
Phase 1 removes known generated Cargo state after source publication,
producer completion and consumer release. Log publication is a separate
evidence-lifecycle operation and is excluded from Cargo eligibility.

The October 23 recovery identifies regenerable targets and reports that Cargo
was inactive. It names no target-internal review artifact whose loss required
publishing attempt output before removal. This design therefore requires no
new Git evidence commit or bulk-log upload to collect those targets. Existing
selected runtime binaries and any actual unresolved file remain live artifacts
under their observed use; their retention follows that file's role.

Generated object files and incremental compilation state can then be rebuilt
from the retained inputs. Their removal releases local cache capacity.
A binary selected by a runtime, rollback or review result remains a live
artifact. A file with unresolved purpose stays in place. A directory named
`target` alone supplies no producer provenance.

Keep the existing shared build locks and execution ownership through child
exit and final output. Inspect direct-Cargo references as required by the #988
producer bypass. Legacy shared targets with missing provenance remain separate
reported allocations. For targets whose producing source/toolchain and inactive
use are established, the collector applies the same decision the operator used
for the October 23 Cargo recovery.

### Lifecycle triggers and recovery

| Event | Targeted work |
| --- | --- |
| Verified Git publication or completed merge/review | Reconsider that operation's worktree and known child outputs |
| Task completion, seat stop or retirement | Inspect its released worktree/target allocations and associated project Git worktrees |
| Build exit and completed process evidence | Reconsider that exact target; shared targets wait for the remaining derived consumers |
| Coordinator restart or remote reconnect | Recompute outstanding decisions for known project worktrees and exact recorded targets |
| Storage write failure or explicit collection request | Visit known projects and target allocations on the affected filesystem |

Each lifecycle notification schedules one targeted pass. Notifications arriving
during an owned pass cause it to inspect current state before it finishes.
A later pass derives remaining work again. A background pass retains its
existing execution handle through completion. There is no filesystem-wide scan,
per-seat traversal, polling cadence or fixed space threshold in Phase 1.

A native turn ending supplies no operation or assignment release. It triggers
no worktree listing, dirt inspection or remote verification. Those inspections
run at the release/recovery events in the table. Their per-allocation cost
remains unmeasured and must be reported by the corresponding qualification run.

Collection acquires the existing operation/session boundary without making a
live writer wait for cleanup. An allocation that is busy stays in place.
Where a producer currently bypasses that boundary, integration and its
qualification are part of the corresponding producer repair. The generic
`storage-apply` route remains disabled for unrelated configured roots.

An unreadable path or uninspectable required reference makes that allocation
ineligible. Report its exact path, failed operation and error. Other allocations
receive their own decisions. The measured broad-scan access failures establish
why collection needs allocation-local observations.

Use source records, Git administration and path existence to recover an
interrupted pass. An already absent path receives an observed absent result;
the runtime still settles any remaining Git administration. A separate durable
cleanup queue is unnecessary. Pending messages and completion reports retain
their existing database semantics.

At the next disk-full event, these passes can remove verified released Git
worktrees and qualified generated Cargo outputs using existing Git remotes.
Dirty source, unknown paths and unique unretained evidence remain local.
Available recovery is the measured eligible subset at that event. Current
recovery capacity requires that pass's allocation observations.
Allocation/filesystem failures keep their actual cause and unfinished work.
Collection outcomes do not control agent admission, continuation or completion.

## Remaining coverage and its entry conditions

| Work | Observed run or path | Next work and acceptance |
| --- | --- | --- |
| Phase 2: dirty-source preservation | #594's local-only snapshots; October 23 `/tmp/acp261` has published HEAD with different staged/working content | Use private-index snapshots retaining both states, deletions and authored untracked files. Verify a remotely fetched generation before local removal. Keep the live working path while its seat needs it. |
| Phase 2: independent clones and exports | October 23 `/tmp/acp261-dsh-flash-1` uses a local origin; `/tmp/acp-0022acae` has broken/missing Git metadata | Identify the concrete creation commands and their actual scratch path selection. Integrate those producers with seat/project roots. A broken export remains local until a specific preservation route is verified. |
| Phase 2: non-Git reviewer evidence | October 23 readable observer logs allocate 1.933 GB; film evidence directory allocates 15.489 GB | Identify the exact logs/results reviewers or recovery need, their producer and remote destination. Verify remote reads of those files before collecting their local copies. |
| Phase 2: deployment exports and shared caches | #988 names superseded deployment copies; the measured NVMe film cache allocates 75.809 GB | Derive selected runtime, rollback and active build references from existing source. Extend collection to the identified producer paths after those references resolve. Measure reuse and rebuild cost for any cache policy. |
| Darwin producer repair | #912's October 21 Mac incident: 216 inactive temporary Git stores, creator unidentified | Trace a real store to the producing invocation using retained indices, execution records and process/temporary-path evidence. Fix that producer's success, failure and recovery cleanup, preserving source and diagnostic state first. Validate on a remote Darwin runner. |
| Further isolation or host-wide discovery | No removal decision in this investigation required per-seat UIDs or a filesystem-wide ownership sweep | Reconsider only after a real failed path-based run identifies the exact missed allocation, missing attribution and changed removal decision. No implementation is assigned under this entry. |

A per-seat private NVMe root, Linux private `/tmp` backing and seat-rooted
`HOME`/`TMPDIR` can be integrated at the measured producer launch paths as the
clone/export work proceeds. The root receives the same path defaults as other
seats. Existing active paths remain in place until their local consumers settle.

For non-Git evidence, the single operator decision is: select an off-host
destination, state its available capacity, and identify the reviewer/recovery
identities that can read it and the publisher that can write it. The conductor
records that choice in deployment configuration. The Phase 2 implementation
then verifies the destination against the selected evidence workload. Phase 1
can ship using existing Git remotes while that decision remains unresolved.

Unclassified content stays local and is surfaced to its project/seat owner.
The film workspace's measured 119.618 GB includes tracked checkouts, generated outputs, caches, logs and
evidence. The unclassified subset and transmitted archive size were never
measured. Publishing the whole tree would visit at least that allocated
footprint while duplicating already retained and regenerable content.
No wholesale upload or review assignment is proposed. A specific evidence
publisher requires an identified reviewer/recovery use and a verified destination.

## Working footprint and visibility

New merge/review scratch uses the configured NVMe working root and the project's
Git objects. Blobless checkouts and sparse review views can reduce fetched and
checked-out content for tools that support them. Git's common directory and
alternates remain live inputs to their checkouts. Object-store collection
requires its own Git reference proof; Phase 1 removes worktrees and generated
Cargo outputs.

Use the existing repository/toolchain shared build wrapper and its actual
target path. Independent current builds share the service's derived writer
lifetime and locks. Releasing the last consumer makes regenerable outputs
collectible after evidence publication; later work may pay a rebuild cost.
Cache-hit and rebuild-time savings remain unmeasured. Shared compiler caches
and immutable package reuse receive measured policies through the Phase 2
cache work above.

Extend `logs-storage` and storage inspection into `swarm view` or `doctor` with
current filesystem capacity/available bytes, each discovered worktree or known
target, producing project/seat when established, measured bytes, remote
source/evidence links and a current eligible/retained reason. Display scan
errors next to the affected allocation. Derive seat/path views from current
session and Git records when read.

Host-wide totals remain qualified by the visibility scan's actual coverage.
Whole-filesystem measurements can be requested for diagnosis; their measured
multi-minute cost and access failures are visible in the result. They supply
no prerequisite for targeted collection. Keep logical file lengths, allocated
blocks and physical available-byte changes distinct.

## Loss boundaries

| Boundary | Named evidence | Required behavior |
| --- | --- | --- |
| Wrong path or foreign worktree selected | #568's external removals left runtime owner administration inconsistent | Use configured disposable roots, exact Git paths and current operation authority; settle Git/runtime administration through its owner. |
| Incomplete allocation inspection | Every broad October 23 inventory returned access errors; eight attempt directories were inaccessible | An unreadable candidate is ineligible. Name that path and error. Decide other allocations independently. |
| Active work during a quiet gap | #912's writer review identifies missing native entry-point participation | Retain the recorded operation/assignment through final output and release; a gap between commands supplies no release evidence. |
| Dirty state omitted from a commit | October 23 `/tmp/acp261` has staged and unstaged changes despite remote HEAD equality | Phase 1 keeps it. Phase 2 preserves and verifies both generations before removal. |
| Ignored or unregistered source omitted | #620's first patch deleted an unpreserved tracked edit; #644 retained unattested files | Inspect the complete candidate content; retain unresolved files and report them. A known Cargo child uses its producing-source proof. |
| Local integration mistaken for off-host retention | #558's local landing; October 23 clone with local `origin` | Verify the declared actual remote and required source objects. Failed or absent publication keeps the allocation. |
| Squash merge omits original review history | #558 establishes publication of the actual artifact; #594 preserves source commits | Keep the original source/preserve refs used by review and verify their remote reachability. |
| Consumer answer never reaches a decision | #1045 reproduces `process-unknown` on this homelab host | Resolve the candidate-specific process-check failure before Phase 1 acceptance; report candidate/PID/read errors and require definite no-consumer results for released root merge trees. |
| Generated target confused with evidence | #988 and October 23 recoveries concern regenerable Cargo outputs; no target-internal review file is named | Keep attempt outputs in their existing external locations, record producer provenance/completion, and collect the known generated target after source verification and consumer release. Log publication supplies no Cargo eligibility condition. |
| Raw log report extraction omits diagnostic evidence | #686 and the October 23 observer-log samples | Keep raw unique evidence until its specific Phase 2 publisher verifies remote retention. |
| Active coordinator database or ancestor removed | #912's database-path protection and related #920 evidence | Active control databases, their ancestors and continuation paths stay outside Phase 1 candidates. |
| Child writer survives parent completion | #988 found direct Cargo execution outside wrapper records | Follow the owned execution and derived child/service references through actual exit; retain an active or uninspectable target. |
| Interrupted publication or collection | #594's failed-push retry; #616's missed terminal cleanup | Keep unverified source; rederive unfinished collection from current durable source and Git state after restart. |

## Acceptance by phase

| Producer path | Phase and failed run | Required completed evidence |
| --- | --- | --- |
| Root merge worktree created outside registered seat worktrees | Phase 1; October 23 approximately 54 GB retained after push; #1045 consumer-check failure | Resolve #1045 in the selected path first. Rerun the twelve-worktree root merge/publication/release case on the affected busy host, obtaining definite no-consumer results and automatic removal for eligible trees. A run returning `process-unknown` cannot pass Phase 1. Preserve current workspaces and an unfinished merge. |
| Private and shared Cargo targets | Phase 1; October 23 approximately 23 GB plus 18 GB; #988 direct-wrapper bypass | Capture actual target/source/toolchain and completed process evidence. After source verification, producer exit and definite reference release, collect generated targets automatically while external attempt outputs stay retained. Perform collection with log publication absent. Keep an active shared writer and unknown-provenance target. |
| Dirty shell clone | Phase 2 source; October 23 `/tmp/acp261` | Recreate staged/working differences from verified remote preservation refs after local collection. |
| Clone with local origin | Phase 2 clone producer; October 23 `/tmp/acp261-dsh-flash-1` | Resolve the actual off-host publish destination; preserve the clone until that source is verified there. |
| Export with unusable Git metadata | Phase 2 export producer; October 23 `/tmp/acp-0022acae` | Identify creation/provenance and verify the selected retention mechanism; keep an unresolved export. |
| Large attempt observer log | Phase 2 evidence; #686 and October 23 samples | Reviewer/recovery reads the complete required remote file after eligible local collection. |
| Interrupted private Git staging store | Darwin producer work; #912 October 21 recovery | Identify its actual creator. Repeated producer success/failure/recovery releases unused stores while current source/snapshots survive. |
| Superseded release/export or reusable cache | Phase 2 producer work; #988 | Derive active/rollback/build references and show collection after actual release, with retained evidence and measured reuse cost. |

Phase 1 acceptance repeats the real root merge and Cargo workflows. Compare
target and candidate behavior for every selected test file, recording the
same file/test/failure-type verdicts and completed process results. Measure
allocated bytes, actual filesystem available-byte change, remotely reviewable
source/evidence and the paths retained for current work. The old incident
sizes motivate the selection; they are not expected-byte assertions.

Compilation, compiler checks, builds and tests execute on the appropriate
remote runners. Preserve exact source/toolchain identity and complete output.
Continue every running validation through its existing execution handle.
Collection failures report unfinished allocations while agents continue their
work. Fixed age, size, percentage, duration and usage limits supply no work
admission or continuation decisions.
