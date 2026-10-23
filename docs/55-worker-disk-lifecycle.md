# Worker disk lifecycle

Design proposal for [#1049](https://github.com/Flip-Engineering/baton/issues/1049),
2026-10-23. Source reviewed:
[`fdfe1c85c64d21058b4366d8f83dd669cb0022b9`](https://github.com/Flip-Engineering/baton/commit/fdfe1c85c64d21058b4366d8f83dd669cb0022b9).
Implementation and deployment require the operator's review of this document.
This investigation removed no files and changed no host configuration.

## Recommendation

Give every seat, including each parentless coordinator, a persistent host storage
identity. Launch its native harness and shell descendants under that identity.
Allocate its home, temporary files, checkouts and build outputs on the configured
working volume. Extend the existing artifact registry with those allocations,
their consumers and remote preservation results. Reconcile filesystem ownership
to discover files created through ordinary shell commands outside the allocations.

Use a distinct Unix UID per seat on each host for this attribution. Keep the
binding through restarts and retained work. Baton derives the actor from launch
context; the agent supplies the repository or intended operation. Shared build,
Git and publication services record the requesting seat and actual output path.
The root coordinator receives the same treatment. Here, root means the top-level
agent; its work processes run as an ordinary operating-system user.

Publish source and reviewer evidence as work progresses. At artifact release,
task completion, retirement and successful consolidation, verify the retained
generation against the actual remote, then collect local copies with no current
consumer. Reconcile unfinished collection after restart and on host storage
failure. Collection continues independently of agent admission and completion.

The main engineering cost is host launch integration: account provisioning,
credentials, native conversation stores and existing shared workspaces need
Linux and Darwin qualification. This cost addresses an observed attribution gap:
the three sampled `/tmp` trees all belong to UID 986, although their branch names
and repository structures differ. A shared account cannot supply seat ownership
from filesystem metadata alone.

## Incident and measurement method

The [incident report](https://github.com/Flip-Engineering/baton/issues/1049)
records `/dev/sda2` reaching zero available bytes around 19:20Z. It had about
76 GB available earlier that day. Flip's Colima Docker daemon stopped answering,
the recovery timer restarted its VM, and `home-cloud-postgres` restarted. The
film orchestra database shares this filesystem.

The operator recovered about 100 GB by removing three inactive Cargo output
trees (23 GB), shared `build-cache/target` (18 GB), and twelve clean, pushed merge
worktrees created by the root that day (about 54 GB). The reported pre-cleanup
ACP population was 246 registered worktrees and 94 GB. Those are incident-time
observations. They differ from the later inventory below.

Read-only measurements ran as `batonci` on `acp-compute-cluster-001`, starting at
19:57:54Z. `df -B1` reports filesystem bytes; `du -x -B1` reports allocated file
blocks within each traversal. Decimal GB below means bytes divided by 10^9.
Parent and child rows overlap. Permission failures make the affected `du` totals
lower bounds. They are neither deletion candidates nor physical recovery claims.
Concurrent production and agent writes continued throughout the measurements.

Complete command arguments, output, errors, timestamps and exit statuses are
retained on NVMe in:

```
/mnt/nvme4tb/ci-runners/baton2-native-homelab/home/.scratch/disk-lifecycle-1049-design-20261023/
```

`measure.py`, `details.py`, `extra.py`, `film-du.json`, `tmp-du.json`, `runner-du.json`,
`home-du.json`, `baton-home-du.json`, `df.json`, `details.json` and
`database-{0,1}.json` identify the observations. Issue snapshots retain the full
bodies and comments read for this review. Database reads used SQLite `mode=ro`.
Git inspection used `GIT_OPTIONAL_LOCKS=0` and `GIT_NO_LAZY_FETCH=1`; remote
queries used `ls-remote`, without fetching into or modifying the inspected trees.

### Homelab placement and size

| Filesystem | Capacity bytes | Available bytes at measurement | Use |
| --- | ---: | ---: | --- |
| `/dev/sda2`, `/` | 982,240,026,624 | 154,108,878,848 | Homes, ordinary `/tmp`, film orchestration and working files |
| `/dev/nvme0n1p1`, `/mnt/nvme4tb` | 3,936,818,806,784 | 755,927,367,680 | CI, Baton work, shared build cache, farm and retained data |

Use `F=/home/atari2036/render-fframes-port-20261016` and
`R=/mnt/nvme4tb/ci-runners` in the following tables.

| Path | Allocated GB | Producer or ownership evidence | Remote state established by this investigation |
| --- | ---: | --- | --- |
| `F` | >=119.618 | Film seats, coordinators and root integration; mixed content | Per-artifact verification required |
| `F/pipeline/worktrees` | 30.603 | ACP worktrees; Git lists 177 registrations including the main checkout across all paths | Git registration does not establish remote retention |
| `F/pipeline/.git` | 11.464 | Shared ACP object store and administration | Remote coverage of all refs/objects not measured |
| `F/worktrees` | 23.927 | FFrames and auxiliary work; FFrames Git lists 83 registrations across all paths | Remote coverage of individual trees not established |
| `F/publication` | 18.263 | Publication/export work; 17.226 GB in `deadlabour-v6-main-scratch` | Publication status does not establish retention of the scratch tree |
| `F/evidence` | 15.489 | Campaign evidence; 7.254 GB in a reboot-recovery directory | Remote copy not established |
| `F/baton` | >=7.202 | Coordinator database, native state, attempt outputs | Database and attempt retention are local here |
| `F/logs` | 3.521 | Film operational/provider logs | No complete remote copy established |
| `F/build-cache` | 2.473 | Shared build dependencies; 2.089 GB in `cargo-home` | Regenerable inputs require source URLs and identities; cache bytes not verified remotely |
| `/tmp` | >=27.774 | Mixed seat, runner and system work | Inspect by actual owner and content |
| `/tmp/acp261` | 4.857 | UID 986; branch names `film-studio-dsh-flash-2` | HEAD equals GitHub branch, but staged/unstaged changes remain |
| `/tmp/acp-0022acae` | 4.761 | UID 986; source export without usable Git metadata | Unknown |
| `/tmp/acp261-dsh-flash-1` | 2.494 | UID 986; branch names `film-studio-dsh-flash-1` | Clean; `origin` is a directory on this host |
| `R` | >=678.310 | CI and agent service roots; partial traversal | Shared service classification required |
| `R/baton2-native-homelab` | >=545.543 | Baton development, qualification, retained releases and seat homes | Individual branches may be pushed; complete retention not established |
| `R/fframes-port-20261016-build-cache` | 75.809 | Shared film compiler output | No remote copy established; retain reviewer evidence before collection |
| `R/.npm` | 1.998 | Runner package cache | Upstream availability and integrity require verification |
| `/home/atari2036` | >=450.474 | Shared operator account, service state and agent work; 52.501 GB in `projects`, 18.495 GB in `.venvs` | Mixed ownership and retention; each allocation needs inspection |
| `R/baton2-native-homelab/home` | >=303.730 | Agent shared account home; 216.439 GB in worktrees, 47.536 GB in `.local` | Mixed source, native continuation, outputs and retained releases |
| `R/baton2-native-homelab/home/fframes-target-khr-20261020` | 12.658 | Agent-created compiler target outside registered worktrees | Remote build evidence not established |
| `R/baton2-native-homelab/home/.cache` | >=3.567 | Package/tool caches, including 1.974 GB in Playwright | Regeneration and unique local content need separate classification |
| `/mnt/nvme4tb/automated-content-pipeline-homelab-20261002` | >=1,187.998 | Farm-owned service tree; includes jobs (546.357 GB), lanes (475.716 GB), worktrees (26.486 GB) and deployment checkouts (16.942 GB) | Per-job publication is not complete tree retention; remote coverage unverified |
| `/mnt/nvme4tb/agent-scratch` | >=85.873 | Agent/farm preparation; 31.359 GB under `batonci` | Mixed local source, build and preparation artifacts; unverified |
| `/mnt/nvme4tb/retained-root-builds-20261019` | >=57.606 | Root's earlier checksum-verified relocations from `/`; source and recovery evidence | These copies remain on the same homelab host; off-host coverage unverified |

A later service-root traversal, completed at 20:15:39Z, measured 205.406 GB in
`R/baton2-native-homelab/retained`, 21.675 GB in `qualifications` and 2.629 GB
in `scratch`. It returned exit 1 with access errors. Its complete record is
`baton-service-du.json`; `farm-du.json`, `agent-scratch-du.json` and
`retained-root-du.json` retain the other additional traversals. These retained
releases, compiler artifacts and qualification outputs require current-runtime,
rollback and evidence references before collection. Their directory names
provide no remote-retention proof.

The farm scan ran from 20:08:58Z to 20:12:23Z and returned exit 1 with access
errors. Its object cache measured 0.761 GB and npm cache 0.093 GB. The service
directory names identify their operating role; the seat that originated each
historical job or lane was not established by these size measurements.

The CI subtree scan took 254 seconds and returned exit 1 with access errors.
A host-wide reconciliation therefore needs to batch inactive owners in a single
traversal and use registered allocations for normal event handling. Repeating a
full traversal for every seat completion would multiply this measured scan cost.

The current film build wrapper explicitly defaults `CARGO_TARGET_DIR` to
`R/fframes-port-20261016-build-cache/target` and records `target_dir` in its
attempt output. `/etc/baton/scratch-root` selects
`R/baton2-native-homelab/scratch/tmp`. These are placement repairs for specific
callers. The root incident and remaining `/tmp` trees show continuing writes
through other launch paths.

A scan found 198 readable `observer.log` files allocating 1,932,886,016 bytes.
Eight attempt directories were inaccessible. The largest readable file allocated
573,837,312 bytes for `film-studio-sol-principal-20261020`; other examples
allocated 341,819,392 and 303,575,040 bytes for
`acp218-native-default-sol-conductor-20261020`. These owners follow the encoded
attempt identity. No remote copy of these complete files was demonstrated.

### Sampled retention checks

For `/tmp/acp261`, HEAD and the advertised GitHub branch both resolved to
`645f50ce12dd660676f086ca9ae517c3cf325b5a`. Its status contained deletions and
`MM videos/web/native/live-scene/frame.test.mjs`. Publishing HEAD alone would
lose the current index and working-file versions.

`/tmp/acp261-dsh-flash-1` had clean HEAD
`a106d9c6fc4560b4305f5a7e262f4f50da38f46b`. Its origin was
`/mnt/nvme4tb/agent-scratch/batonci/acp218-source-c484-complete-closure-20261021/source.git`.
The advertised branch there was a different commit. This is a same-host
repository, so even a matching answer would not establish remote retention.
All Git identity/status commands in `/tmp/acp-0022acae` exited 128.

Branch names suggest the two film seats associated with the clones. They do not
prove who executed `git clone`. The common UID proves only account ownership.
The root's twelve merge-worktree creations are attributed by the incident
report. This distinction matters when adopting existing data.

### Mac measurements and access limits

The Mac has no attached high-capacity working volume in the evidence recorded
under [#912](https://github.com/Flip-Engineering/baton/issues/912). Its internal
physical disk was reported as 251 GB; the APFS data volume was described as
228 GB, with 17 GB free on 2026-10-19. These figures describe different layers.
The Development tree was about 25 GB after that recovery.

The [2026-10-21 Mac recovery](https://github.com/Flip-Engineering/baton/issues/912#issuecomment-6324562529)
removed 216 inactive temporary Git snapshot stores and three duplicate clean
checkouts. APFS available space increased from 159,892 KiB to 36,795,924 KiB:
37,515,296,768 bytes of net physical recovery. Sampled stores contained Git
objects, private indices, lock files and interrupted temporary objects. Their
indices included Baton source and untracked `.scratch` evidence. The producing
component remained unidentified. This design includes preservation staging
stores in the owning attempt's lifecycle and requires producer attribution
before treating existing stores as disposable.

[#988's Mac recovery](https://github.com/Flip-Engineering/baton/issues/988#issuecomment-6304769414)
measured 12,849,438,720 allocated bytes in inactive ignored target directories
under `fframes-ci-harden`, `fframes-ci-gate` and `fframes-maingreen`; source and
uncommitted changes stayed in place. This is a separate observation, with no
claim that it adds to the APFS physical recovery above.

Fresh Mac measurements and privileged homelab measurements were requested through
the recorded coordinator. This seat cannot access the Mac, enumerate the NVMe
top level, use sudo, or inspect every other user's process descriptors. Fresh
Mac path/seat attribution and the inaccessible homelab totals remain explicit
measurement qualifications until the coordinator supplies them. Historical Mac
evidence establishes the failures this proposal must cover.

## Existing mechanisms and their coverage

| Work | Implemented or recorded coverage | Why the October 23 incident remained possible |
| --- | --- | --- |
| [#912](https://github.com/Flip-Engineering/baton/issues/912) | Storage classes, preview and protected removal primitives; NVMe build scratch and selected log-clean services. PR #934 merged as `4e436548`. | General apply remains disabled for configured roots. The issue's later reviews identify missing participation by real writer entry points. Placement fixes cover selected callers. |
| [#988](https://github.com/Flip-Engineering/baton/issues/988) | Tracks completion/consolidation cleanup. Recovery measured 123,962,974,208 allocated bytes removed on homelab; wrapper placement was corrected. | General lifecycle integration remains open. Earlier records omitted actual target paths: 982 of 986 inspected build attempts lacked `target_dir`; direct Cargo commands bypassed the wrapper. |
| [#644](https://github.com/Flip-Engineering/baton/issues/644) | Resident `.baton/wt` custody audit: later measurement found 44 checkout directories and 296 sidecars, 8,248,877,056 logical bytes. | Custody, uncaptured files and generated-path classification retained some trees. Its scope is resident-owned workspaces. It supplies no ownership proof for film shell clones. |
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

## Candidate designs and costs

| Candidate | Attribution and collection | Costs and limitations |
| --- | --- | --- |
| A. Managed allocation APIs, environment placement and existing collector | Every Baton allocation records its actor; wrappers allocate review/build scratch; terminal events collect registered paths. | Smallest source change. Raw `git clone /tmp/...`, absolute build paths and the root's own shell creations remain unattributed under a shared UID. Requires caller compliance for the incident's largest category. Useful infrastructure, insufficient as the complete design. |
| B. A private writable filesystem or VM per seat | All writable paths belong to a seat scope; preserve its changed files and discard the scope after consumers settle. | Strong path attribution. Requires Linux namespace/overlay integration and a different Darwin implementation or VM. Whole-file copy-up, per-seat images, path mapping and native-tool compatibility add unmeasured costs. Shared writable Git/build caches still require service ownership. |
| C. Persistent per-seat Unix identities, managed allocations and filesystem reconciliation | Registered paths take the event path; inode UID identifies shell-created files elsewhere. Shared services name their requesting seats. Root uses the same launch path. | Privileged host launcher/collector and account/credential migration are required. Scan cost scales with filesystem entries: the partial CI scan took 254 seconds. Existing shared-UID files need evidence-based adoption. Local Darwin native stores and GUI access require qualification. |

Recommend C, using A's allocation interfaces and collector. It gives arbitrary
shell creations an owner on both Unix platforms without requiring each command
to use an allocation API. B remains a candidate if platform qualification shows
that shared-UID native tools cannot run under separate identities. That result
would require revising this design before deployment.

The measured twelve root merge trees account for about 54 GB, compared with
about 41 GB in the removed Cargo outputs. Expanding the registered-worker
collector alone would omit a major incident producer. The remaining sampled
scratch trees allocate 12,111,233,024 bytes in total; their different retention
states require content-specific handling even after ownership is known.

Neither alternative makes a 3.94 TB filesystem unlimited. The recommended
design continually releases settled copies and displays actual resource use.
Cache capacity and network transfer savings need measurements from the proposed
implementation; this review makes no projected compression or deduplication claim.

## Attribution and placement

### Seat launch and ordinary shell writes

The host launcher binds `(host, Unix UID)` to the recorded seat in the coordinator
database before launching its harness. That binding survives turn boundaries,
restarts and unfinished artifact retention. Descendants inherit it. The host
collector uses this binding and filesystem ownership for files created through
shell tools, native file tools, package managers and detached children.

Use a stable account while any files, processes or retained local work belong to
the seat. Reconcile its remaining filesystem ownership before releasing the
account binding. UID reuse by a service manager can associate leftover files
with a later service; the [systemd execution documentation](https://www.freedesktop.org/software/systemd/man/255/systemd.exec.html)
describes that behavior. Service-manager automatic temporary-file deletion also
needs to respect Baton's remote-preservation ordering. The host configuration
must leave owned temporary files available to the collector after process exit.

The privileged component provisions identities, launches children and inspects
owned files. Ordinary agents request semantic work through their launch context.
Credential access and Git author identity follow the existing provider and
repository configuration through the launcher or existing credential helper.
Credential material belongs to the credential service and stays outside source
snapshots. A credential/publication failure keeps the affected work locally and
reports the actual failure.

On Darwin, a host helper launches the native harness with the selected real,
effective and saved user identity, configured supplementary groups and private
home. [Apple's `setuid` documentation](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/setuid.2.html)
defines the identity transition. Provider authentication, native resume, keychain
access and operator file review require actual Darwin qualification; the system
call alone does not establish that integration. The laptop continues to host
orchestration, source editing and review. Compiler/build/test execution continues
on the appropriate remote validation runner.

Each newly allocated checkout and temporary directory belongs to its seat.
Filesystem discovery indexes all created paths; it has no minimum size cutoff.
The registry stores allocations and service-produced artifacts. The filesystem
supplies the remainder. Reconciliation scans each actual writable filesystem
once for all owners needing settlement. It reports inaccessible paths and scan
completeness. An incomplete scan leaves account settlement unfinished.

Discovered files become artifacts automatically under their seat and recorded
assignment. Known Git administration identifies a checkout; known build-service
output identifies generated intermediates. Unclassified files receive complete
archive retention. A filename or ignore rule cannot establish that content is
regenerable. Discovery records its evidence and any ambiguous assignment;
attribution to a seat can be known while the particular producing task is unknown.
This automatic adoption is required for the shell-created incident paths.

Use exact owner and consumer relations for a mixed-owner directory's children.
Collect whole trees only when every
contained artifact is eligible. Shared checkouts registered through `join` retain
all recorded consumers. Inode ownership identifies a creator, while the shared
workspace record identifies everyone who can currently use or modify it.
Existing files modified in place retain their original inode owner; the consumer
record supplies the current work relationship.

Imported files, preserved-ownership copies and hard links require the same
distinction. Content ownership follows the inode; an allocation records the seat
using its local path. Shared mutable access must enter the consumer registry.
Historical last-writer attribution remains unknown from an inode UID.

Shared Git administration, compiler caches, selected deployments and farm output
have service owners. Calls into those services record the actual output path,
requesting seat, source identity and consumers. A service that exports files
through a shell command must return the same allocation information through its
ordinary operation. An uninstrumented service remains a named coverage gap.
Granting a seat access to another operating-system identity would similarly
require recording that producing service relationship.

### Working volume layout

The host configuration selects working and retention destinations by mount
identity. For homelab, new large local working data uses `/mnt/nvme4tb`:

| Allocation | Placement and owner |
| --- | --- |
| Checkout, merge/review clone | Seat work root on NVMe; Git object cache referenced separately |
| `HOME`, `TMPDIR`, package-manager private state | Seat home and temporary root on NVMe |
| Literal `/tmp` and `/var/tmp` in Linux seat processes | Bind the seat's NVMe temporary roots into its launch namespace; preserve their backing directories after exit |
| Mutable compiler target | Repository/toolchain build service on NVMe, with its actual target path and existing execution locks |
| Immutable packages, Git objects and source assets | Shared repository/service store on NVMe |
| Logs, preservation staging and evidence | Owned NVMe artifact roots, remotely published before local collection |
| Coordinator database and native continuation state | Durable configured control root with explicit live consumers and remote backup |

Linux systemd 255 is installed on the measured host. Its
[execution documentation](https://www.freedesktop.org/software/systemd/man/255/systemd.exec.html)
describes filesystem namespaces and bind paths. Qualify the actual launch path
and backing mount with a real seat; an environment-variable change establishes
only consumers that read that variable. In particular, the existing
`PrivateTmp=true` runner history under #988 demonstrates the need to inspect the
namespace's physical backing filesystem.

On a Mac with its measured single internal disk, private homes and temporary
files stay on that disk. Large validation and reusable build assets use remote
runners. Literal absolute temporary writes remain attributable by UID and are
collected on release. If a configured working mount is unavailable, retain the
actual placement error and unfinished work. An ordinary allocation may explicitly
select an available configured destination; silently placing a nominal NVMe
allocation on root would reproduce the observed failure.

Existing active paths remain in place. New placement applies to new allocations
and new launches after qualification. Any relocation of settled old work verifies
the complete destination copy and consumers before changing the original path.

### Existing unregistered work and the root

Adopt legacy allocations from current session workspace records, Git worktree
administration, attempt provenance, process references and retained creation
commands. Match exact paths and source identities. The common UID 986 and a
directory's date or branch-like name are insufficient for seat attribution.
Unresolved legacy data remains visible under its current account and project;
retain a complete remote copy before any proposed removal.

The parentless root receives its own account and allocation records at native
launch. Its `git worktree add`, source exports, review clones, package installs,
preservation indices and tool logs follow the same collection rules. Its
coordination database remains a separate live artifact. Root-created merge
worktrees become collectible on verified remote publication and release of the
merge/review operation, even while the coordinator continues other work.

A completed operator request settles that root assignment's auxiliary artifacts
through the same task-completion event used for workers. The root account and
native conversation can continue with later requests. Current workspaces and
unfinished background operations keep their local consumer references. For a
long-running assignment, managed merge/review operations release their own
allocations when publication and review finish. Raw shell allocations are
reconciled at assignment completion. Automatic cleanup therefore requires both
the root task-completion path and the shell-file discovery path to be integrated.

Operator files created outside a Baton process stay operator-owned. Importing
such a path into a task records its existing ownership and consumers. Host
visibility includes those bytes, while automatic deletion requires a settled
owned allocation. The design must not claim that a partial migration establishes
complete coverage of old shared-account data.

## Remote retention and verification

Remote means a configured destination on a different machine from the working
copy, accessible to the intended reviewers. NVMe on the homelab is a placement
destination for that host. A Mac copy on homelab is remote to the Mac; it does
not provide independent retention for homelab work. Git publication uses the
repository's declared shared publish destination, including the film campaign's
private repositories.

The deployment needs an off-host evidence store with authenticated reviewer
access and durable object identities. The current investigation has not
established such a destination for every homelab artifact. Configuring and
verifying it is a deployment dependency. Existing local work continues while
retention is unfinished.

| Content | Required retained form before local removal | Verification and reviewer access |
| --- | --- | --- |
| Committed source | Pushed branch or preserve ref containing each required commit; landed target if consolidation is claimed | Read the actual declared remote ref. Fetch/read the retained commit and required objects from that endpoint independently of local alternates. Record repository, object IDs and commit/PR links. |
| Index and uncommitted source | Private-index preservation commits for staged and working-tree states, including deletions, modes, symlinks and untracked authored files | Preserve the original index separately from the working tree; fetch the preservation generation and compare trees. Supply a review branch/commit link and base diff. |
| Untracked or ignored evidence | Content-addressed evidence bundle with path metadata and complete file hashes | Read the remote manifest and objects back; compare hashes and provide a stable authenticated browse/download entry. `.gitignore` supplies no evidence classification. |
| Source export with broken/missing Git metadata | Complete source/evidence archive and available source provenance | Download and hash-check the archive; expose its file index. A branch assertion cannot qualify `/tmp/acp-0022acae`. |
| Build outputs | Required binaries/results plus exact source, toolchain, command, environment inputs, full output and completed status | Verify remote evidence and any required binary. Regenerable intermediate files can then be collected. Outputs of unfinished runs retain their execution ownership. |
| Packages and compiler caches | Immutable upstream identity/checksum and retained build provenance; archive any locally unique required inputs | Verify upstream retrieval for relied-on content. Shared mutable targets require settled readers/writers. Cache classification alone establishes no durability. |
| Logs and native continuation | Complete required raw output, operational records, reports, failed-run diagnostics and referenced native state | Verify the uploaded generation and reviewer/recovery reads. Keep local files still required by an active reader or native resume path. |
| Preservation staging stores | Published source/evidence generation produced by that attempt | Verify publication, then remove the exact private indices/object staging directories after their process exits, including failed/interrupted staging once required diagnostics are retained. |

Preservation refs retain immutable generations through collection and review.
An advancing seat pointer may identify the newest generation; previously
referenced source and evidence stay reachable. A PR provides review context.
It establishes retention only for the actual commits and files it exposes.
Large evidence belongs in the evidence store with a linked index.

Stream archives to the destination or stage them on the configured working
volume. Creating a full second local evidence copy on a full root filesystem
would reproduce the temporary snapshot accumulation recorded on the Mac.
The publisher owns and releases its staging directories on success, failure and
recovery according to the same remote-evidence rule.

Extend canonical artifact records with owner/consumer relations, content class,
local mount/path identity and remote generation evidence. Store manifest data,
publication outcomes and failures in the database. Remote manifests serve
retrieval and review. Derive collection work from those records and current
filesystem state after a crash. A repeated upload or repeated collection attempt
is acceptable. Task text and dispatch/setup outcomes remain in the database.

## Removal events, live work and recovery

Collection eligibility is specific to an artifact generation:

1. Its owner and exact current filesystem object are known.
2. Every required source/evidence component has a verified remote representation.
3. No process, shared service, selected deployment, rollback reference or pending
   operation still needs that local object.
4. Its writers and collector use the same allocation ownership boundary through
   final output and release. Recheck current state while holding that boundary.

This is permission to remove a local copy. Agent completion and continued work
do not depend on collection success. Keep actual publication, allocation,
permission and filesystem errors with the unfinished artifact.

| Event | Preservation and collection effect |
| --- | --- |
| Commit or contribution | Publish the source commit; update its remote evidence. Keep current writable checkout. |
| Native turn end | Preserve stable source changes and completed output; report the turn and wake its orchestrator normally. A turn end does not end the seat. |
| Task completion or seat retirement/stop | After owned processes exit, capture final source/evidence and collect released allocations; keep explicit stops effective. |
| Successful landing or PR merge | Verify the actual remote result; release associated merge/review scratch after evidence publication and consumer release. |
| Deployment replacement | Collect superseded export/build trees when selected runtime and recorded rollback consumers release them and evidence is remote. |
| Consolidation or consumer release | Reconsider all associated artifacts, including children created by shell tools and shared cache entries. |
| Restart, failed collection or reconnect | Derive remaining work from artifact, process, Git and remote state; retry unfinished preservation/collection through the existing owned execution. |
| Host storage failure or explicit collection request | Collect all currently eligible artifacts on the affected filesystem; report preserved bytes and actual causes for the remainder. |

Live dirty or unpublished work stays usable. A publisher can capture completed,
stable generations without stopping the agent. A changing file remains part of
unfinished preservation. A remote copy of an earlier generation does not permit
removing a later dirty generation. Shared checkouts stay local while another
consumer needs their present paths.

A crashed seat with surviving children still has live work. An ended seat with
no successor is preserved by the coordinator's collector: publish its final
source and complete required evidence, then remove the released local working
files. Pending inputs and recovery context remain in the database and remote
continuation artifacts. A successor can reconstruct a new allocation from that
generation. It needs no surviving working path once all old local consumers
have released it. Unknown ownership or failed publication leaves the original
files present and visible to the coordinator.

Use the existing session lock for session state and an allocation/service
ownership boundary for shared writers and readers. The #912 review describes
actual missing writer integration; an operator declaration of exclusivity does
not supply it. A collector that cannot acquire an allocation immediately skips
it and reports why. It does not hold a live agent waiting for cleanup. An
already-owned background execution keeps its execution handle until completion.

The existing descriptor-relative, no-follow removal primitive checks the exact
mount and filesystem object. Git worktree removal also settles its Git
administration. Record the actual removal result and measure filesystem free
bytes around a collection pass. A crash between removal and result recording
is resolved by observing the now-absent path. Reconstructing this result needs
no separate durable cleanup queue.

Collect released artifacts continuously at lifecycle events, with restart
reconciliation for missed work. This design introduces no free-space percentage,
age, size, retry, turn or token cutoff. Space-failure events cause collection;
they do not relax preservation or stop agents. `statvfs` available bytes and
inode availability describe physical resources. Visibility can report an
observed write rate and estimated time to exhaustion as measurements, with
uncertainty; those estimates do not control agent execution.

### Boundaries where removal could lose work

| Boundary | Evidence or design consequence | Required preservation behavior |
| --- | --- | --- |
| Attribution to the wrong seat | The sampled scratch paths share UID 986; branch names give only a hypothesis about their creators. | Keep ambiguous legacy allocations; launch new work under its recorded identity and retain all shared consumers. |
| Treating inode ownership as current exclusive use | Shared workspaces and in-place edits can have several users. | Consult workspace/service consumers and actual processes; retain any active local dependency. |
| Assuming a commit includes dirty work | `/tmp/acp261` has a published HEAD and different index/working-file content. | Retain both index and working-tree generations, deletions and authored untracked files. Verify the final generation after writers finish. |
| Excluding ignored or unregistered content | #620's correction preserved previously omitted tracked edits; #644 retained unattested generated paths. | Archive unclassified content completely. Collect generated intermediates only with actual provenance and retained reviewer evidence. |
| Accepting a local repository as remote retention | The sampled clean clone points at a same-host `source.git`; #558 recorded unpublished local landings. | Verify the deployment's actual off-host endpoint and required objects. Keep local work on absent, mismatched or failed results. |
| Discarding source history after a squash/PR merge | A merged target can preserve the change while omitting the original source commit and review context. | Keep source preservation refs and evidence generations reachable through review; verify them independently of the merged target. |
| Removing raw output after extracting a report | The readable observer samples alone allocate 1.933 GB; the report is a smaller derived record. | Upload complete required raw output and failed-run evidence before removing its local file. Keep active native continuation paths. |
| Snapshotting a live coordinator database | The incident places the film database on the exhausted filesystem; #912 also records unlinked-owner protection. | Preserve active databases and ancestors. Produce consistent SQLite backups through the database service, including committed WAL state; verify remote restoration before retiring an old database. |
| Parent exit while a child/service continues writing | #988 found direct Cargo work outside the wrapper's records. | Keep the full owned execution and service consumers through actual completed status and final output. A terminal task row alone supplies no writer-release proof. |
| Failed or interrupted publication | #594 names failed-push retry; Mac evidence identifies interrupted snapshot staging. | Retain source, diagnostics and staging still needed to finish publication. Derive retries from current artifact state after recovery. |
| Interrupted scan or removal | This inventory contains permission errors; #568 documents startup failure after external manual removal. | Display incomplete coverage, preserve uncertain objects, and settle Git administration through its owning runtime. Reobserve absent paths after restart. |
| Collecting an earlier path/content generation | #912's implementation reviews identify writer coordination and path-identity requirements. | Share the allocation boundary with writers, recheck current source/consumer state, and use the existing descriptor-relative identity checks at removal. |

These are implementation review obligations for the observed failures and the
proposed retention boundaries. They add no author-maintained completion ledger.
The conductor and root review the design adversarially before the implementation
review stage described below.

## Reducing the working footprint

Use a per-repository Git object service with references from active checkouts
and retained local artifacts. Create blobless checkouts for source review and
merge work; fetch required content from the real remote on demand. Sparse
checkout can narrow a review's requested files. Source-wide builds, tools and
tests select the full content they actually require. Preserve reachable objects
before object-store maintenance, and keep live alternates valid.

Repository assets and LFS objects require their own immutable identities and
remote verification. A small Git clone does not establish that working media is
deduplicated or available remotely. The measured ACP shared `.git` alone is
11.464 GB. The incident's 1.9–4.5 GB checkouts demonstrate material working-file
cost even where Git objects are shared.

For compilation, share immutable packages and compiler-cache entries by exact
repository, toolchain, platform and input identity. Keep mutable target state
under the build service's existing execution locks, with recorded readers and
writers. The 75.809 GB film build cache on NVMe establishes the need for cache
collection as well as placement. Collect released mutable outputs after retaining
their build evidence. Retain referenced immutable entries and collect entries
whose source/consumer relationships have ended. Measure hit rates, allocated
blocks and rebuild cost during qualification before choosing additional policy.

Local cache consumers are current builds, selected toolchains and runtime
inputs. Historical branches retained for review do not pin their build caches
locally. Releasing the last local consumer makes an entry collectible; this can
cost a later rebuild or download. A shared off-host compiler-cache service can
retain immutable entries for later reuse. Its hit rate and transfer cost remain
unmeasured here. Cache policy must not impose a work-admission limit.

Review and merge operations allocate source-only scratch through the same
service. Package installation or compilation creates explicit child artifacts
when required. Raw shell commands remain supported; their created files inherit
the seat identity and enter reconciliation.

## Visibility and ownership of collection

Extend `logs-storage`'s existing registry projection and the storage lifecycle
read path into `swarm view` and `doctor`. Report per host and filesystem:
capacity, available bytes/inodes, measured allocation by class, known owners,
unattributed bytes, scan errors and observation time. Report per seat: registered
and discovered paths, shared consumers, allocated bytes, live processes,
remote source/evidence links, unpublished generations, collectible bytes and
the exact reason a local copy remains.

Shared bytes appear once in host totals and with their consumer set. APFS
logical length, allocated file blocks and physical filesystem recovery are
separate measurements. Deleted-but-open files remain a process-owned use of
storage until the descriptor closes. An incomplete scan is displayed as such.
The current two database snapshots are partial host coverage; the service must
discover every configured coordinator and service owner before claiming a
host-wide inventory.

The collector is an ordinary host service driven by durable artifact state and
lifecycle notifications. Notifications wake it; restart derives missed work
again. Failures wake the owning coordinator with exact retained paths, bytes,
remote failure and unfinished work. They do not require the operator to approve
each eligible deletion. Preview remains available for inspection; editing a
review document or declaring a task complete supplies no deletion authority.

## Qualification after design approval

The operator reviews this design before implementation is assigned. The first
implementation review should resolve the off-host evidence destination and
prove native harness/credential/resume behavior under separate identities on
Linux and a remote Darwin runner. Existing sessions retain their current paths
and identities during that work.

Acceptance reproduces the observed producer paths: a root merge worktree, a
shell clone with dirty source, a clone whose origin is another local directory,
a source export with missing Git administration, a direct Cargo target, a
shared wrapper target, a large attempt observer log and an interrupted private
snapshot store. The completed remote artifacts must be reviewable using only
their published references after local collection.

Run repeated real task, merge/review, validation and retirement cycles. Record
source/toolchain identity, process completion, complete output, per-class
allocated bytes and filesystem available-byte changes. Exercise the existing
failed-run cases: preservation failure, unfinished writer, active shared reader,
late files at terminal capture, unregistered tracked edits, interrupted upload
and interrupted collection. New selected failures require comparison with the
target using the same file, test and failure type. Every selected file must
receive a completed verdict before landing.

Only remote runners execute compiler checks, builds and tests. A running
validation remains owned through its original handle. Roll out qualified new
launches first, retain old active data, then adopt settled legacy allocations
with explicit evidence. Report remaining unowned legacy paths, unqualified
platform routes and unavailable remote stores as unfinished coverage.

## Open seats at the observation time

The following inventory derives open status from absence of a `session_stops`
row. It does not equate open with a live process or an unfinished task. Both
databases also contain an open `operator` row with an empty workspace. Detailed
seat/path mappings follow the retained read-only database snapshots.

Path prefixes: `F` is the film workspace above; `H=R/baton2-native-homelab/home`;
`A=R/baton2-native-homelab/retained/baton-account-credits-793-702-20261017T0106Z`.


### Film database

Snapshot: `2026-10-23T19:57:54.379404+00:00`; 24 non-operator open seats.

| Seat | Workspace |
| --- | --- |
| `asset-contract` | `F/worktrees/asset-contract` |
| `common-fx` | `F/worktrees/common-fx` |
| `farm-adapter` | `F/worktrees/farm-adapter` |
| `fframes-glass-successor-20261019` | `F/worktrees/fframes-glass-successor-20261019` |
| `acp-production-ds-coordinator-v5-20261019` | `F/pipeline/worktrees/acp-production-ds-coordinator-v5-20261019` |
| `acp-video-release-audit-ds-20261019` | `F/pipeline/worktrees/acp-video-release-audit-ds-20261019` |
| `acp-recovery-kimi-20261019` | `F/pipeline/worktrees/acp-recovery-kimi-20261019` |
| `acp-creative-k3-lead-v2-20261020` | `F/pipeline/worktrees/acp-creative-k3-conductor-20261020` |
| `acp-creative-assets-ds-1-20261020` | `F/pipeline/worktrees/acp-creative-assets-ds-1-20261020` |
| `film-studio-sol-principal-20261020` | `H/worktrees/film-studio-sol-lead-20261020` |
| `film-studio-codex-luna-2-20261020` | `H/worktrees/film-studio-night25-paint-reference-glm-20261023` |
| `film-studio-dsh-flash-1-20261020` | `H/worktrees/film-studio-dsh-flash-1-20261020` |
| `film-studio-dsh-flash-2-20261020` | `H/worktrees/film-studio-night25-print-binding-haiku-20261023` |
| `acp218-native-default-sol-conductor-20261020` | `F/pipeline/worktrees/acp-218-native-default-sol-20261020` |
| `acp218-native-default-kimi-worker-20261020` | `F/pipeline/worktrees/acp-218-native-default-kimi-20261020` |
| `acp218-fframes-ci-ds-worker-20261020` | `F/worktrees/acp218-fframes-ci-ds-20261020` |
| `acp218-live-three-receiver-ds-20261020` | `F/worktrees/acp218-live-three-receiver-ds-20261020` |
| `film-studio-ff-sol-20261022` | `H/worktrees/film-studio-night25-parity-sol-20261023` |
| `acp-creative-assets-haiku-20261022` | `F/pipeline/worktrees/acp-creative-assets-ds-2-20261020` |
| `acp218-native-default-haiku-20261022` | `F/pipeline/worktrees/acp-218-native-default-ds-20261020` |
| `film-studio-night25-sonnet-20261023` | `H/worktrees/film-studio-night25-eyes-points-sonnet-20261023` |
| `film-studio-night25-luna-20261023` | `H/worktrees/film-studio-night25-integration-luna-20261023` |
| `film-studio-night25-credit-sonnet-20261023` | `H/worktrees/film-studio-night25-layer-reference-sonnet-20261023` |
| `acp274-gpu-policy-sonnet-20261023` | `F/pipeline/worktrees/acp274-gpu-policy-sonnet-20261023` |

### Runtime database

Snapshot: `2026-10-23T19:57:54.891606+00:00`; 41 non-operator open seats.

| Seat | Workspace |
| --- | --- |
| `runtime-output-checkpoint-fix-wonder-20261019` | `A/worktrees/runtime-output-checkpoint-fix-wonder-20261019` |
| `runtime-glm-successor-20261019` | `A/worktrees/runtime-glm-successor-20261019` |
| `storage-policy-wonder-20261019` | `H/worktrees/storage-policy-20261019-baton` |
| `runtime-ds-rescue-coordinator-20261019` | `H/worktrees/runtime-storage-coordinator-ds-20261019` |
| `release-complete-review2-ds-20261019` | `H/worktrees/release-complete-review2-20261019` |
| `backlog-959-impl-20261019` | `H/worktrees/backlog-959-impl-20261019` |
| `backlog-772-impl-20261019` | `H/worktrees/backlog-772-impl-20261019` |
| `backlog-788-impl-20261019` | `H/worktrees/backlog-788-impl-20261019` |
| `backlog-862-impl-20261019` | `H/worktrees/backlog-862-impl-20261019` |
| `backlog-772-788-review-20261019` | `H/worktrees/backlog-772-788-review-20261019` |
| `compiler-queue-970-coordinator-20261019` | `H/worktrees/compiler-queue-970-coordinator-20261019` |
| `compiler-queue-970-kimi-integration-20261020` | `H/worktrees/compiler-queue-970-kimi-integration-20261020` |
| `baton-723-k3-20261020` | `H/worktrees/baton-723-k3-20261020` |
| `pr869-delivery-ds-20261021` | `H/worktrees/pr869-current-main-integration-20261020` |
| `pr901-delivery-ds-20261021` | `H/worktrees/pr901-current-main-integration-20261020` |
| `pr860-delivery-ds-20261021` | `H/worktrees/attribution960-pr860-return-20261019` |
| `baton-721-agy-lead-20261022` | `H/worktrees/baton-721-agy-lead-20261022` |
| `baton-721-agy-haiku-20261022` | `H/worktrees/baton-721-agy-haiku-20261022` |
| `pub994-haiku-20261022` | `H/worktrees/github-attribution960-impl-20261019` |
| `issue937-haiku-20261022` | `H/worktrees/issue937-live-path-fix-20261021` |
| `accounts-credit-haiku-20261022` | `H/worktrees/accounts-credit-delivery-ds-20261021` |
| `issue988-haiku-20261022` | `H/worktrees/pr988-cleanup-20261020` |
| `usage-holds-1014-haiku-20261022` | `H/worktrees/usage-holds-1014-20261022` |
| `stop-dsh-1015-haiku-20261022` | `H/worktrees/stop-dsh-1015-20261022` |
| `held-route-1016-haiku-20261022` | `H/worktrees/held-route-1016-20261022` |
| `worktree-paths-972-haiku-20261022` | `H/worktrees/worktree-paths-972-20261022` |
| `compiler-crash-1017-opus-20261022` | `H/worktrees/compiler-crash-1017-20261022` |
| `consol-1008-sonnet-20261022` | `H/worktrees/consol-1008-20261022` |
| `consol-queue-haiku-20261022` | `H/worktrees/consol-queue-20261022` |
| `consol-998-haiku-20261022` | `H/worktrees/consol-998-20261022` |
| `consol-937-sonnet-20261022` | `H/worktrees/consol-937-20261022` |
| `consol-788-sonnet-20261022` | `H/worktrees/consol-788-20261022` |
| `consol-ports-haiku-20261022` | `H/worktrees/consol-ports-20261022` |
| `consol-776-haiku-20261022` | `H/worktrees/consol-776-20261022` |
| `consol-1009-haiku-20261022` | `H/worktrees/consol-1009-20261022` |
| `consol-preserved-sonnet-20261022` | `H/worktrees/consol-preserved-20261022` |
| `consol-worktrees-haiku-20261022` | `H/worktrees/consol-worktrees-20261022` |
| `bend-static-review-sol-20261022` | `H/worktrees/bend-static-review-20261022` |
| `series-gh-1019-sol-20261022` | `H/worktrees/series-gh-1019-sol-20261022` |
| `queue1026-memory-admission-sonnet-20261022` | `H/worktrees/queue1026-memory-admission-20261022` |
| `disk-lifecycle-1049-sol-20261023` | `H/worktrees/disk-sprawl-1049-20261023` |
