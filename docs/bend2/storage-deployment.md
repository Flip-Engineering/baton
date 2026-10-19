# Storage deployment layout

Status: platform integration for [issue #912](https://github.com/Flip-Engineering/baton/issues/912),
2026-10-19. Related records: [#644](https://github.com/Flip-Engineering/baton/issues/644)
retained worktrees, [#686](https://github.com/Flip-Engineering/baton/issues/686)
log volume, [#677](https://github.com/Flip-Engineering/baton/issues/677) heavy
validation placement, [#920](https://github.com/Flip-Engineering/baton/issues/920)
unlinked owner protection.

The platform slice owns operating-system service and timer wiring for the
qualified log-clean helper. It does not configure storage roots and does not
invoke a storage preview or apply command. The generic storage lifecycle is an
unqualified work in progress and this document does not describe it as shipped
policy.

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
writers. A future platform change that enables an apply command must protect
every active coordinator database and its ancestors, and must use writer
coordination for each approved root. A root is not a cleanup candidate because
a path exists.

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
