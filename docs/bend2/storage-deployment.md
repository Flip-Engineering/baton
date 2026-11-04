# Storage deployment layout

Status: platform integration for [issue #912](https://github.com/Flip-Engineering/baton/issues/912),
2026-10-19. Related records: [#644](https://github.com/Flip-Engineering/baton/issues/644)
retained worktrees, [#686](https://github.com/Flip-Engineering/baton/issues/686)
log volume, [#677](https://github.com/Flip-Engineering/baton/issues/677) heavy
validation placement, [#920](https://github.com/Flip-Engineering/baton/issues/920)
unlinked owner protection.

The platform slice owns operating-system service and timer wiring for the
qualified log-clean helper and the qualified storage-clean helper. The storage
policy, preview and apply commands are merged on main (PR #934, PR #1128) and
this document describes the qualified storage scheduler built on them. The
units do not name storage roots; the deployment owner supplies
`BATON_STORAGE_ROOTS` in the environment file described below.

## Qualified log-clean scheduler

The qualified command is the immutable packaged helper:

```
RELEASE/libexec/baton2/logs-clean-all DATABASE
```

The helper prints one JSON object to stdout:

```
{"results":[<one logs-clean response per registered session>]}
```

It enumerates session IDs from the selected database and calls the canonical
`Logs.clean_all` sequentially. Each session call takes its lock, rereads
pending input and applies the existing settlement checks. Temporary scratch
and build outputs are not database candidates.

The contract is merged in
[PR #926](https://github.com/Flip-Engineering/baton/pull/926) at merge commit
`ce6e0c18`. Four remote daily units are deployed and every actual database
exits 0. The deployment receipt is
`/mnt/nvme4tb/rt/logs-clean-all-deployment-20261019/926-deployment-receipt.json`.

The repository templates are:

- `deploy/storage/systemd/baton-logs-cleanup.service` and `.timer`;
- `deploy/storage/launchd/com.flip.baton.logs-cleanup.plist`.

They call the helper with the database as the only argument. They run under
the database owner with the standard Baton environment and carry no
credentials. Root deploys from a release that contains the helper; the
templates do not name a branch head and do not require further permission.

The cleanup lock serializes cleanup invocations. It does not exclude other
writers. The storage-clean scheduler below adds the per-root writer leases,
database-reference admission and mount-identity checks that an apply command
needs.

## Qualified storage-clean scheduler

The qualified command is the immutable packaged helper:

```
RELEASE/libexec/baton2/storage-clean DATABASE COMMAND ARG...
```

It exposes the product administration commands and calls the same
`StoragePolicy` implementation the complete Baton binary uses:

```
storage-clean DATABASE storage-policy
storage-clean DATABASE storage-preview SESSION
storage-clean DATABASE storage-apply SESSION
storage-clean DATABASE storage-collect SESSION
storage-clean DATABASE storage-sweep
```

`storage-sweep` is the scheduled command. It enumerates session IDs from the
selected database and runs the settled-session collection for each one. Every
session uses the same settled gate, the same collectable-root selection and
the same apply pipeline as the product commands. Each session contributes one
object:

```
{"results":[{"session":SESSION,"result":<collect response>}]}
```

A settled session whose configured roots are admitted removes the eligible
generated entries under those roots. A root that is not referenced by the
database, not canonical, overlapping another root, or held by a writer lease
is refused and its files stay. A directory whose mount identity cannot be
verified, or that is itself a mount boundary, is preserved before any
deletion. A skipped or refused session is reported in its own object and does
not stop the sweep.

Roots come from the environment. The deployment owner writes
`/etc/baton/storage-roots.env`:

```
BATON_STORAGE_ROOTS=build-output=/path/to/generated-output|selection:/etc/acp-fframes-artifact/selection.json
```

An explicitly released staging root names the authenticated repository that
must contain each candidate commit. The `staging-source-released` marker records
the operator's ownership release decision:

```
BATON_STORAGE_ROOTS=staging-source-released=/mnt/large/agent-scratch/acp390-install|<authenticated-repo>
```

Use `staging-source` while ownership remains active. Its candidates stay
protected with a release-required reason.

`BATON_STORAGE_EXCLUSIVE_ROOTS` may be added for the same roots when the
operator declares them exclusive to cleanup. Without the environment file no
roots are configured and the pass removes nothing.

The repository templates are:

- `deploy/storage/systemd/baton-storage-cleanup.service` and `.timer`;
- `deploy/storage/launchd/com.flip.baton.storage-cleanup.plist`.

They run under the database owner with the standard Baton environment and
carry no credentials. The service carries `MemoryHigh=2G`, a soft throttle
that keeps the pass running above the mark with swap available, and
`TimeoutStartSec=infinity`. It sets no hard memory limit and no forced zero
swap. A soft limit throttles pressure; it does not detect a leak.

On macOS the mount identity of a candidate and its parent is compared through
the mounted filesystem identity (`f_fsid`) before any removal. Darwin
directory removal is implemented from source but has not been validated on a
Darwin runner; files and logs on the same filesystem are removed, and any
identity that cannot be established preserves the entry.

### Staging and activation

The helper is staged like the log-clean helper. Build the entry with the
shared queue, then stage a source-pinned release directory:

```sh
sh bend2/scripts/build-native.sh bend2/src/coordinator/storage-focused.bend   .scratch/bend2/storage-focused
python3 bend2/scripts/stage-storage-clean.py   --binary .scratch/bend2/storage-focused   --bend "$BEND" --clang "$CLANG"   --source-root "$BATON2_SOURCE"   --source-commit "$(git -C "$BATON2_SOURCE" rev-parse HEAD)"   --destination "$RELEASE/storage-clean"
```

The staged directory contains `libexec/baton2/storage-clean`,
`storage-clean-manifest.json`, `SHA256SUMS` and `stage-receipt.json`. Install
the service and timer templates with `ExecStart` and `ProgramArguments`
pointed at the staged helper, write the environment file, then:

```sh
systemctl daemon-reload
systemctl enable --now baton-storage-cleanup.timer
systemctl start baton-storage-cleanup.service
```

The first service start is the live pass. Read the journal for the per-session
results before enabling the timer on a production database.

## Deployed host layout, 2026-10-19

Read-only measurements on the homelab:

| Path | Filesystem | Size | Free |
| --- | --- | --- | --- |
| `/` and `/tmp`, `/var/tmp`, `/home/atari2036` | ext4 `/dev/sda2` | 915 GB | measured before cleanup |
| `/mnt/nvme4tb` | ext4 `/dev/nvme0n1p1` | 3.6 TB | 1.1 TB |

The deployed NVMe scratch root is
`/mnt/nvme4tb/ci-runners/baton2-native-homelab/scratch/tmp`. It is selected by
`/etc/baton/scratch-root` and
`baton-.service.d/20-nvme-scratch.conf`, which declare `RequiresMountsFor` and
`AssertPathIsMountPoint`. Existing services were not restarted. The bound
runner temporary directory at
`/mnt/nvme4tb/ci-runners/baton2-native-homelab/temp` is a separate path and
keeps its configuration.

The NVMe scratch configuration and the cleanup work tracked in #915 and #917
are deployed. Together with the completed backups they recovered 232290603008
bytes of physical space on the root filesystem. The backup relocation recovered
146132537344 bytes, preserved the original path as a symlink, and completed the
shared model move. The shared model store is
`/mnt/nvme4tb/shared-assets/atari2036-ai-models`; its legacy path remains a
symlink.

Measured external stores:

| Store | Path | Bytes |
| --- | --- | --- |
| Shared model store | `/mnt/nvme4tb/shared-assets/atari2036-ai-models` | 27 GB |
| ACP immutable Git object cache | `/mnt/nvme4tb/automated-content-pipeline-homelab-20261002/object-cache` | 3.7 GB in `pack` |
| ACP npm cache | `/mnt/nvme4tb/automated-content-pipeline-homelab-20261002/npm-cache` | 89 MB |
| ACP render jobs | `/mnt/nvme4tb/automated-content-pipeline-homelab-20261002/jobs` | 605 GB |
| ACP render lanes | `/mnt/nvme4tb/automated-content-pipeline-homelab-20261002/lanes` | 665 GB |

The ACP render harness builds a bare, blobless, depth-1 Git cache under
`FARM_CACHE` (default `~/.cache/acp-farm`) through a sibling temporary
directory and a rename, and fetches `main` into a ref rather than `FETCH_HEAD`
(`repo-template/videos/scripts/farm.py:53-115`). The cache is per repository;
removing a job does not remove it (`repo-template/videos/scripts/farm.py:312`).
No Baton source reads the shared model store or the ACP caches. This document
makes no shared-consumer or shared-deduplication claim for them.

## Unqualified storage lifecycle

Root selected the product command contract `storage-policy`,
`storage-preview SESSION` and `storage-apply SESSION`, with roots resolved from
the recorded project or workspace. The competing `BATON_STORAGE_ROOTS` surface
and a second preview/apply shape are not part of the selected contract.

That implementation is unqualified work in progress. Before merge it must
prove leaf replacement and exclusive-writer race protection, and it must
protect every active coordinator database and its ancestors, including the
unlinked-owner case in #920. It must preserve unknown content, unpublished
source, shared immutable assets and Git objects. The platform templates in
this repository do not schedule it.

## macOS

Issue #912 records the operator's Mac with 17 GB free on a 228 GB internal
APFS data volume and no external writable data volume. Large builds and
rendering run on remote runners, as the ACP campaign rules require. The
completed Mac cleanup removed nine obsolete engine caches and a fully merged
fframes checkout after NVMe preservation, for an actual physical gain of
1.389 GB. A future project-local scratch or cache root stays inside the project
on the internal APFS volume. This slice installs no local Mac file.

## Log and evidence retention

`logs-storage` reports database, public log, segment, checkpoint, attempt and
stderr bytes. `logs-clean SESSION` removes eligible completed attempt
diagnostics under the session lock and preserves base logs, historical
segments, provider stores, unfinished attempts and files with incomplete
stderr metadata. `docs/bend2/logging.md` records the level, rotation and
cleanup rules.

Log and evidence retention reports candidates. It never blocks a turn,
dispatch, admission or completion.
