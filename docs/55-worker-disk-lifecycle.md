# Worker disk lifecycle

Design proposal for [#1049](https://github.com/Flip-Engineering/baton/issues/1049),
2026-10-24. Source reviewed:
[`fdfe1c85c64d21058b4366d8f83dd669cb0022b9`](https://github.com/Flip-Engineering/baton/commit/fdfe1c85c64d21058b4366d8f83dd669cb0022b9).
The conductor reviews this design, the root critiques it, and the conductor
staffs the accepted implementation. The
[root critique](https://github.com/Flip-Engineering/baton/issues/1049#issuecomment-6379361378)
approves the design with the changes specified here. This contribution changes
documentation.

## Recommendation and scope

Phase 1 publishes released source to exact-SHA preservation refs on the actual
off-host Git remote, verifies those refs, and removes released checkouts through
Git. It collects inactive Cargo targets, npm dependency trees and released
compile-queue key directories. Project Git hooks attribute new shell-created
worktrees and clones to their creating session. Allocation and release events
run collection; live filesystem availability selects additional shared-cache
collection. The root's working files use the same lifecycle.

The [October 23 incident](https://github.com/Flip-Engineering/baton/issues/1049)
recovered about 54 GB from twelve clean, pushed worktrees created by the root,
23 GB from three inactive Cargo targets and 18 GB from a shared target. Those
observations select the Phase 1 scope. The root's
[incident report](https://github.com/Flip-Engineering/baton/issues/1049)
says it recovered "about 100 GB in 15 minutes". Its three category estimates
sum to approximately 95 GB (54 + 23 + 18); the rounded report and category
estimates remain separate observations. The report records the Docker failure
and PostgreSQL restart when the root filesystem reached zero available bytes.

An open assignment keeps its working paths, including dirty and unpublished
source. Released source is published automatically before local removal.
An unreadable allocation or unresolved consumer stays in place with its reason
reported. Eligibility is evaluated for each allocation. Phase 1 can collect an
eligible worktree while an unrelated evidence directory remains unreadable.

Phase 1 also identifies and repairs the Mac temporary Git-store producer and
reduces new ACP working copies with sparse checkouts and a shared object store.
Phase 2 covers non-Git reviewer evidence, exports with unusable Git metadata and
additional deployment/cache producers. Its single operator decision is the
off-host evidence-store configuration described below.

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
| Project paths, Git discovery and producer lifecycle | Recommended. Project hooks attribute allocations; Git lists root and seat worktrees. Exact remote refs retain source, native Cargo locks identify inactive targets, and producer release collects queue keys. Project listing costs were 0.038 and 0.016 seconds. Snapshot upload, dirt inspection and removal costs require measurement during implementation. |
| Registered-seat cleanup alone | Covers registered seat workspaces. The root's twelve merge worktrees contributed about 54 GB outside that path, and shell clones contributed about 26 GB. This candidate leaves those observed producers uncovered. |
| Per-seat UIDs and filesystem-wide reconciliation | Account provisioning, credentials and native-launch changes add work without an observed removal decision needing a distinct UID. The measured broad scans took 204.754 and 254.208 seconds and returned access errors. |
| Private filesystem or VM per seat | Adds launch, credential, continuation and shared-cache integration. The incident allocations have Git or concrete producer paths; no failed path-based removal run establishes a need for this isolation. |

## Phase 1 allocation discovery and attribution

The configured project repositories and disposable roots define collection
authority. Query `git worktree list --porcelain` for each project and resolve
the common Git directory and exact checkout path. This finds shell-created
linked worktrees, including the root's merge and review trees. Primary project
checkouts remain live inputs. Branches and preservation refs remain present
after a linked working directory is removed.

Install an executable `post-checkout` hook in each project's common Git hooks
directory and in the Git template selected by the seat launch environment.
Compose it with the project's existing hook and effective `core.hooksPath`.
On creation, it records `BATON_SESSION`, inherited from native launch, in the
new worktree's Git administration directory. Resolve that directory through
Git so linked worktrees get separate attribution. The first creator remains
recorded through subsequent branch checkouts. Record the actual clone path in
the existing creation/execution outcome so discovery can revisit independent
repositories under configured scratch roots. No agent-maintained inventory is
required.

[Git's hook contract](https://git-scm.com/docs/githooks#_post_checkout) covers
`git clone` and `git worktree add` with checkout enabled. For Baton's sparse
creation path using `--no-checkout`, the creator writes the same attribution
before materialization. The hook is part of the clone template before clone
runs; a hook in the source repository is insufficient for a new clone.
Creation with missing attribution is reported, and legacy trees use current
workspace, assignment, execution and Git-operation observations. An unresolved
live owner retains the affected allocation. Existing worktrees discovered
through project Git administration can be attributed to the project.

Keep a checkout while its attributed session has an open assignment. Match
current join/workspace paths, pending continuation and owned operations as
well. A native turn ending supplies no assignment release. Explicit task
completion, stop or retirement can release a path after successor and runtime
references resolve. A stopped seat's dirty source follows the preservation
sequence below. Root and coordinator shells inherit the same session and
template configuration, and their merge operations report the actual scratch
path through the existing Git operation.

New checkouts, clone staging, private indices, build scratch and queue keys use
the configured NVMe working root on homelab. Seat launch selects its NVMe
`TMPDIR` and Git template; managed creation commands select that root directly.
Existing shell-created paths on `/` stay discoverable through Git and creation
records until released. Literal paths and source exports without Git metadata
keep an unresolved result until their concrete producer is integrated.
Operational logs and native continuation retain their existing recorded paths
and lifecycle. No placement change moves an active workspace.

For Cargo, resolve the actual target/build path from invocation, environment
and Cargo configuration, and inspect its `CACHEDIR.TAG`. Known legacy targets
under service homes enter this discovery, including the measured 12.658 GB
orphan. Wrapper records improve discovery and diagnostics; their absence does
not make a marked inactive Cargo output ineligible. Inspect npm dependency
roots for `node_modules/.package-lock.json`. Enumerate compile-queue keys from
the queue's own state directory. Each producer supplies its actual allocation
path through its functional execution outcome.

### Derived local consumers

| Relationship | Source used by tooling |
| --- | --- |
| Session needs a checkout | Creator attribution in Git administration, current assignment, join/workspace records and continuation paths |
| Operation owns scratch | Existing execution handle, terminal/release state and current descendants; retain through final output |
| Another checkout needs shared Git objects | Git worktree listing, common-directory resolution and live refs |
| Process uses a source or npm allocation | Candidate-specific cwd, executable, descriptors and mapped-file observations through the qualified #1045 path |
| Cargo is writing output | Nonblocking acquisition of Cargo's native target/build lock files, held through rename and deletion |
| Queue producer or requester needs a key | Queue key lock, live requester ownership, publication/install state and selected artifact references |
| Runtime or rollback needs generated output | Existing deployed release and rollback selections; unresolved selection retains the affected allocation |

Derive these relationships again on each pass. Attribution names the creator;
current assignments and executions establish continued use. Collection uses
the current source observations and allocation identity.

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
worktrees for collection. Cargo writer exclusion uses its native locks;
the #1045 process scan serves source worktrees and other allocations whose
consumers require process references. Phase 1 uses this evidence for worktrees:

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

### Publish released source, then remove the checkout

A linked worktree becomes a candidate when its assignment and operations have
released it, Git identifies its project and disposable path, and the qualified
consumer check returns a definite `no-consumer`. Keep active work and unresolved
paths through quiet gaps between commands.

Read the project's actual publish URL, including Git's effective push URL and
URL rewrite configuration. A filesystem path or `file://` URL identifies a
same-host destination. An SSH or HTTPS endpoint must name the off-host project
service; an endpoint resolving to this worker is local. Follow a local
`origin` to the configured project destination. The sampled
`/tmp/acp261-dsh-flash-1` origin on NVMe supplies no off-host copy.
Unresolvable endpoints and failed remote reads keep the allocation.

For each released checkout:

1. Capture its HEAD, source refs needed by review, real index state and visible
   working state. Use #594's private-index capture, extended to retain a separate
   index tree before applying working-file changes. Preserve staged/unstaged
   differences, tracked deletions and authored untracked files. Keep sparse
   index entries for absent files. Inspect ignored content: known generated
   children follow their own rules; unresolved unique evidence keeps the tree.
2. Produce commit objects for the required generations, retaining the original
   HEAD and ancestry. Push each exact object to
   `refs/baton/preserve/<full-object-id>` on the actual off-host project remote.
   An existing ref must already name that object. Publication creates refs
   without force updates; the collector never deletes branches or preserve refs.
3. Run `git ls-remote <publish-url> <exact-preserve-ref>` and require that exact
   ref at the captured SHA for every required generation. A moving development
   branch is insufficient. Record the destination, refs and object IDs in the
   existing operation outcome for reviewer fetches and recovery.
4. Reread assignment/operation release, allocation identity and content under
   the existing ownership boundary. Keep anything changed since capture.
   After all required generations are verified remotely, normalize only the
   captured tracked/index state and remove only the captured authored untracked
   paths. This normalization is a destructive part of collection and has the
   same publication and release requirements. It preserves branch tips.
   Collect eligible generated children separately. Unresolved files remain.
5. Run `git worktree remove <exact-path>` without `--force`. A refusal keeps
   the tree with Git's error. Settle its runtime/Git administration through the
   owning operation and keep its branch and preservation refs.

Historical #594 captures the visible working version and leaves the real
index unchanged. Capturing both index and working generations is required for
the measured `MM` file in `/tmp/acp261`. Qualification reconstructs both
generations by fetching the exact preserve refs from the off-host remote.
Partial publication keeps the remaining local state and reports the failed ref.

Independent clones created through the seat template follow the same
attribution, release and publication sequence. Their primary directory remains
while the assignment is open. A released disposable clone can be removed through
the existing identity-checked filesystem primitive after its unique refs,
index, working content and other consumers are accounted for. Git's
`worktree remove` applies to linked trees. Keep any independent Git object
store used by another checkout.

A live seat can publish snapshots while keeping its working path. An ended
seat with no successor is preserved and collected through this sequence.
Explicit stops and unresolved continuation ownership remain effective.

### Cargo targets

Inspect the actual `CACHEDIR.TAG` contents and Cargo output layout at the
resolved allocation. This identifies generated Cargo state, including targets
whose old execution records lack provenance. A directory name alone supplies
no classification. Source and toolchain records remain execution diagnostics;
source publication, provenance completeness and log upload are excluded from
Cargo collection eligibility. The source stays on disk and rebuilds the target.

Acquire Cargo's actual `.cargo-lock` files with nonblocking exclusive locks,
covering the target's profiles and target triples and the effective build
directory. Use the installed toolchain's lock semantics and retain the open
descriptors through same-filesystem rename and deletion. Acquire all required
locks before renaming; a busy lock or unreadable lock directory keeps the
allocation and collection proceeds to other candidates. Cargo writer exclusion
uses these locks and requires no `/proc` traversal.

Cargo's [lock compatibility change](https://github.com/rust-lang/cargo/pull/16886)
retains a shared `.cargo-lock` while newer layouts also use build/artifact
locks. Resolve the effective layout for the deployed toolchain and include
its associated locks and build path. The
[Cargo output contract](https://doc.rust-lang.org/cargo/reference/build-cache.html)
permits separate target and build directories. Qualification covers the actual
host toolchains and direct Cargo invocations that bypassed wrapper records.

Read existing deployment and rollback selections before collection. A selected
binary or unresolved selection keeps the affected allocation. The producer
boundary covers build launch through child exit, and live assignment/execution
state keeps output needed by a pending test or review operation. After release,
take the native locks, rename the target aside within its parent filesystem,
and delete that exact directory while holding the locks. New managed builds
use the producer's existing allocation boundary and resolve the current target
path. A busy boundary skips collection and allows work to continue. Acceptance
must show a build already using a target stays intact and a later build can
recreate the target after collection.

Attempt outputs remain at their existing paths outside the target, with their
existing retention. The October 23 recovery named no unique target-internal
review evidence. Actual selected artifacts and unique files identified by a
producer remain protected through their existing references. No new source
push or log-publication operation is required to reclaim the observed 23 GB,
18 GB shared target or 12.658 GB orphan target.

### npm dependency trees

Treat `node_modules` identified by npm's hidden
`node_modules/.package-lock.json` as generated package output. Preserve the
project manifest and source lockfile with source. npm's
[hidden lockfile contract](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json/#hidden-lockfiles)
describes the generated dependency tree; that file supplies classification,
and supplies no writer lock.

Use current assignment, npm execution, test/server process and deployment
references to decide release. Reuse the qualified #1045 path for actual process
readers. An active install, test, server or selected deployment keeps its tree.
After release, rename the dependency directory aside and delete it through its
producer boundary. Package installation recreates it from the project inputs.
Keep workspace/link dependencies outside the allocation and resolve them as
source. The root and seat paths receive the same treatment. This covers the
`npm ci` producer named in #1049; measured savings for this class remain unknown.

### Compile-queue keys

Collect `$state/keys/<key>` when its producer and current requesters release it.
The retained
[queue implementation at f6dd0667](https://github.com/Flip-Engineering/baton/blob/f6dd066762140fa2e58e3bac14350eef198cd15d/bend2/src/host/compile-queue.bend)
holds the key lock through detached supervisor execution and publication, and
tracks requester ownership. It stores completed artifacts and failed-run output
under that key. Integrate collection at producer release, after requesters have
received their results and artifacts have been installed at their destination.

Acquire the existing key boundary without waiting. A live supervisor,
requester, artifact install or selected runtime result keeps the key. Released
generated C/object/cache contents can be removed; a later request rebuilds them.
Required failure output follows existing attempt-output retention. If the key
contains the only copy of required diagnostic evidence, retain it until that
specific evidence is preserved. Keep outputs already installed in selected
release directories through their own selection references. Restart derives
unfinished key release from current queue state, key locks and result paths.

### Mac temporary Git-store producer

Phase 1 traces the producer of #912's 216 temporary Git stores, whose October
21 recovery released 37,515,296,768 physical APFS bytes with three duplicate
checkouts. The current evidence leaves the creator unidentified. Obtain a real
store's path/stat, index/object contents and producing execution or temporary-path
record from the Mac owner. Match it to the actual invocation; directory naming
alone leaves attribution unresolved.

Repair the identified producer's success, failure and restart cleanup at that
entry point. A private index/staging store is released after its snapshots have
verified exact off-host refs and its operation has finished using it. Source
or diagnostic content with unresolved retention keeps that store. This trace
and repair are Phase 1 acceptance work. The design seat has requested the
measurements through the conductor and has no Mac access. Validate the real
producer on a remote Darwin runner and retain its completed execution evidence.

### Lifecycle triggers and space pressure

| Event | Targeted collection |
| --- | --- |
| Controlled checkout/clone allocation | Run the released-allocation pass for that project and filesystem |
| Build start or compile-queue key allocation | Run the release pass for known targets, dependency trees and queue keys on that filesystem |
| Verified publication or completed merge/review | Publish any remaining released source and reconsider that operation's checkout |
| Task completion, seat stop or retirement | Reconsider released attributed allocations and project Git worktrees |
| Build/queue producer release | Reconsider its exact generated allocation after consumers settle |
| Restart or remote reconnect | Recompute known project, producer and staging-store decisions |
| Write failure or explicit collection request | Run the affected filesystem's known-allocation pass and retain the actual write failure |

At each controlled allocation, read `statvfs` on its actual filesystem.
Available bytes are `f_bavail * f_frsize`. Compare them with the bytes measured
for that allocation kind's real previous output or current materialization
inputs. A checkout can derive its selected file bytes from Git/source
observations; a build or key can use its previous measured allocated footprint.
If available bytes are below that measured allocation size, also collect
released shared caches on that filesystem. Record the observation, derivation
and available measurement coverage. An unmeasured kind still runs its ordinary
release pass and reports that its additional pressure comparison is unavailable.

This comparison selects collection work. It never refuses, pauses or truncates
an allocation or agent. Start a pass through the existing owned execution path;
work continues while eligible released allocations are collected. No fixed
age, percentage, capacity or periodic timer controls collection. The physical
filesystem and measured allocation supply the comparison. Actual allocation
failures retain their errors and unfinished work.

Notifications arriving during an owned pass cause a current-state recheck.
Derive remaining work from source records, Git administration and path
existence after interruption. Settle remaining administration for an already
absent path. Native turn completion supplies no release and schedules no pass.
No filesystem-wide traversal is part of these triggers; the measured broad
scans remain explicit diagnostics.

Collection takes each producer/operation boundary without waiting on live
work. Report an unreadable candidate's path, operation and error, then decide
other candidates independently. The generic `storage-apply` route remains
disabled for unrelated configured roots. Pending input and completion handling
retain their current database semantics.

## Working footprint and visibility

The [October 23 footprint report](https://github.com/Flip-Engineering/baton/issues/1049#issuecomment-6376863192)
records about 110 GB of new working files between 06:00Z and 23:40Z, mostly
ACP checkouts of about 4.8 GB for four new ensembles. It also records a fall in
NVMe free space from about 720 GB to 500 GB and 35 GB of farm output.
These concurrent observations do not establish a complete accounting equality.

A [read-only sample](https://github.com/Flip-Engineering/baton/issues/1049#issuecomment-6379422782)
on October 24 at 03:35:18–03:35:20Z measured
`acp-ax-fresh-haiku2-20261023` at source
`f7bbf9b21fa0d036e713e79277407e81ea4b56d8`:

| Measurement | Bytes |
| --- | ---: |
| Complete linked working directory, allocated blocks | 4,850,827,264 |
| Tracked files, allocated blocks from lstat | 4,837,810,176 |
| Tracked files, logical lengths | 4,771,223,542 |
| Tracked files under videos, allocated blocks | 4,765,257,728 |
| Tracked files under farm, allocated blocks | 9,412,608 |
| Tracked files under homelab, allocated blocks | 6,410,240 |
| Shared common Git objects, allocated blocks | 4,032,225,280 |

All commands and file-stat reads completed successfully. The common directory
was `acp-concept-content-base-20261023/.git`; its objects are shared inputs
outside the measured linked working directory. Complete commands, timestamps,
stdout/stderr, exit statuses and tracked-path measurements are retained in
`acp-footprint-revision.json` beside the earlier measurement evidence. These
numbers are a concurrent read-only sample, with no sparse checkout or deletion
performed.

Adopt a project common object store and linked worktrees on NVMe, with sparse
working views for ACP assignments. This sample already shares objects;
`videos` accounts for 98.5% of tracked allocated bytes. A seat limited to
`farm`, `homelab` and top-level files would materialize approximately
16.1 MB of tracked allocated file data under this sample's sizes, before
directory/index metadata and generated output. The illustrative saving is
about 4.82 GB per such view. This is a selected-path calculation, with no
claim that every seat has those dependencies.

At creation, derive the initial path set from the actual task and tool imports;
expand the sparse view as work needs other directories. Git's
[sparse checkout mechanism](https://git-scm.com/docs/git-sparse-checkout)
retains the full commit identity. Review, snapshot, status and remote-runner
flows must preserve absent skip-worktree entries and materialize required
validation inputs. Full-tree work expands its view through the same interface.
Measure actual selected path sets, object fetching, checkout bytes and expansion
cost in the real ACP seat workflows. No numeric footprint limit restricts work.

Share Git objects across seats and review/merge scratch; keep the common store
while refs and checkouts use it. Blobless fetching can reduce the initial
object transfer where the host supports it. Existing stores remain intact
through active use. Compiler output uses the existing repository/toolchain
shared target and producer locks. Releasing the last consumer makes its
regenerable contents collectible; the next build can pay a rebuild cost.
Cache-hit savings and rebuild time remain unmeasured.

Extend `logs-storage` inspection into `swarm view` or `doctor` with current
filesystem capacity and available bytes, each discovered allocation, attributed
session/project, measured bytes, remote source/evidence refs, live references
and the current collection/retention reason. Show measurement time, unmeasured
allocation kinds and scan errors. Derive views from session state, Git
administration and producer paths. No checked-in seat census supplies decisions.

Host-wide totals state their actual coverage. Explicit diagnostic traversals
can measure broad roots; their multi-minute cost and access failures remain in
the result. Keep file lengths, allocated blocks and physical available-byte
changes separate.

## Phase 2 evidence and remaining coverage

| Work | Observed allocation | Implementation and acceptance |
| --- | --- | --- |
| Non-Git reviewer evidence | Readable observer logs allocate 1.933 GB; film evidence allocates 15.489 GB | Identify the specific reviewer/recovery files and publisher. Verify full remote reads before removing those local copies. |
| Exports with unusable Git metadata | October 23 /tmp/acp-0022acae | Trace its concrete creator and preserve unique content through the chosen evidence destination; unresolved exports remain local. |
| Additional deployment exports and shared caches | #988 superseded deployments; film cache root measured 75.809 GB | Integrate each producer and existing selected runtime/rollback references. Collect released generated content, retaining required diagnostic evidence; measure reuse and rebuild cost. |

The single operator decision is the off-host evidence-store configuration:
destination, available capacity, publisher write identity and reviewer/recovery
read identities. The conductor records that choice in deployment configuration.
The Phase 2 publisher verifies it with the identified evidence workload.
Phase 1 uses existing project Git destinations for source.

Unclassified unique content stays local and is surfaced to its project/session
owner with its observed path and reason. The 119.618 GB film workspace includes
source, generated output, logs and evidence; its unclassified subset and archive
transfer size are unmeasured. A specific evidence publisher requires an
identified reviewer/recovery use and a verified destination.

## Loss boundaries

| Boundary | Named evidence | Required behavior |
| --- | --- | --- |
| Wrong or foreign path selected | #568 external removals left owner administration inconsistent | Resolve configured authority, exact Git path and filesystem identity; settle administration through its owner. |
| Incomplete allocation inspection | October 23 broad inventories returned access errors; eight attempt directories were inaccessible | Keep that candidate and report its path/read/error. Decide other allocations independently. |
| Open assignment between commands | #912 writer-entry-point review and shell-created paths in #1049 | Keep creator-attributed checkouts while the assignment remains open, plus current execution and continuation references. |
| Staged or working changes omitted | /tmp/acp261 has an MM file despite remote HEAD equality | Preserve separate index and working generations at verified exact-SHA remote refs before local normalization/removal. |
| Unique ignored or unregistered source omitted | #620 first patch lost a tracked edit; #644 retained unresolved files | Inspect the complete candidate. Collect classified generated children separately; retain unresolved unique files. |
| Moving branch ceases to retain work | #558 unpublished landing and root critique of the October 23 hand review | Verify exact refs/baton/preserve object IDs and retain those refs; development branch movement cannot change that reference. |
| Same-host origin mistaken for off-host retention | /tmp/acp261-dsh-flash-1 origin points to NVMe on this worker | Resolve the effective publish URL to the actual off-host project destination; keep an unresolved allocation. |
| Squash merge loses original review history | #558 publication requirement and #594 source snapshots | Retain original source ancestry and snapshot generations through exact remote preservation refs. |
| Consumer result remains unknown | #1045 process-unknown reproduction on this host | Repair and qualify the candidate-specific consumer path before Phase 1 acceptance; unresolved reads keep the candidate. |
| Cargo collection requires missing old records | #988 omitted target paths; October 23 orphan target is 12.658 GB | Identify Cargo output from its marker/layout and acquire native locks; source/provenance records supply no extra eligibility condition. |
| Build is active during target collection | #988 direct Cargo bypass and October 23 inactive-process check | Hold native Cargo locks through rename/delete and retain active operations plus runtime/rollback selections. |
| Dependency output still serves live work | #1049 npm ci creates unregistered output | Use hidden-lockfile classification and current install/test/server/deployment references; retain active consumers. |
| Queue producer outlives requester | Retained compile-queue implementation keeps a detached supervisor/key lock | Release the key only after producer publication, requester artifact delivery and selected result references settle. |
| Diagnostic evidence is only local | #686 observer logs and queue failed-run output | Keep required raw evidence until its existing retention or verified Phase 2 publication permits removal. |
| Active control database or ancestor selected | #912 database-path protection and #920 | Keep active databases, ancestors and continuation paths outside disposable candidates. |
| Temporary snapshot store survives operation | #912 Mac recovery of 216 stores | Trace and repair the actual producer in Phase 1; release stores after source publication and operation completion. |
| Interrupted publication or collection | #594 failed-push retry; #616 missed terminal cleanup | Keep unverified generations; derive unfinished decisions from current durable source, Git and producer state after restart. |

## Acceptance by producer

| Producer path | Failed run | Required completed evidence |
| --- | --- | --- |
| Root merge/review linked worktrees | October 23 twelve trees, about 54 GB; #1045 unknown results | Repair #1045 first. Repeat the normal twelve-tree merge/publication/release case on the busy host with definite no-consumer results and automatic non-force Git removal. Keep current workspaces, unfinished operations and an open creator assignment. |
| Released unpublished or dirty source | Root critique's 115 hand-reviewed checkouts; /tmp/acp261 staged/working changes | Push exact-SHA refs and fetch them from the off-host remote to reconstruct HEAD, index, working generations and authored untracked files. Keep source on failed publication or changed content. Verify review history after ordinary branch movement. |
| Shell-created worktree and clone | About 26 GB in /tmp and root-created merge trees | Actual git worktree add and clone record BATON_SESSION via installed hook/template. Show separate linked admin attribution, discovery and open-assignment retention; qualify sparse no-checkout creation through its creator path. |
| Private/shared/orphan Cargo targets | October 23 23 GB plus 18 GB; 12.658 GB orphan | Use actual markers/locks with missing historical provenance. Keep an active direct Cargo writer and selected binary, collect released targets without source/log publication, and rebuild after collection. Cover deployed Cargo lock layouts. |
| npm dependency tree | npm ci named in #1049 | Classify a real hidden-lockfile tree; keep an active install/test/server, then collect on release and reinstall from retained source inputs. |
| Compile-queue key | Released key directories named in root critique; existing detached supervisor | Keep live producer/requesters and incomplete artifact delivery; collect generated key content after release. Keep required failure output through its evidence lifecycle. |
| Allocation pressure pass | October 23 Docker/PostgreSQL failures at zero free bytes | Show collection at checkout, build-start and queue-key allocation; record actual statvfs availability and measured-kind derivation for shared-cache selection. Work continues regardless of collection outcome. |
| ACP sparse view/shared objects | October 23 about 110 GB checkout growth; 4.851 GB sample | Exercise real narrow seat and review/merge workflows, expand for actual dependencies, preserve snapshot semantics, and measure resulting working/object bytes and validation identity. |
| Mac temporary Git store | #912 October 21 recovery | Identify the real producer from Mac evidence; repeated success/failure/restart releases unused stores while current source, snapshots and diagnostics survive. Validate on a remote Darwin runner. |
| Non-Git evidence/export | Observer logs, film evidence and broken export | Phase 2 reviewer/recovery reads complete required remote content after eligible local collection using the configured evidence destination. |

Phase 1 acceptance requires completed runs of these real producer workflows,
including #1045 and the Mac producer repair. Existing baseline failures and
missing Mac attribution remain unfinished qualification; this document claims
no implementation acceptance.

Compare target and candidate for each selected test file, preserving file,
test, failure type and completed process evidence. Measure allocated bytes,
physical available-byte changes, remote review/reconstruction and retained
active paths. Historical incident sizes motivate coverage and supply no
expected-byte assertion.

Compilation, compiler checks, builds and tests execute on the appropriate
remote runners with exact source/toolchain identity and full output. Continue
every active validation through its existing handle. Collection reports
unfinished allocations while agents continue their work. No numeric budget
controls admission, continuation, completion or input acceptance.
