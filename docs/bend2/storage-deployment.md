# Storage deployment layout

Status: platform integration for [issue #912](https://github.com/Flip-Engineering/baton/issues/912),
2026-10-19. Related records: [#644](https://github.com/Flip-Engineering/baton/issues/644)
retained worktrees, [#686](https://github.com/Flip-Engineering/baton/issues/686)
log volume, [#677](https://github.com/Flip-Engineering/baton/issues/677) heavy
validation placement.

The Bend2 storage lifecycle owns classification, retention, owner and
reference checks, apply planning and every removal decision. This slice owns
the operating-system service and timer wiring for log cleanup. It does not
wrap, reimplement or schedule a storage preview or apply command.

## Observed host layout, 2026-10-19

Read-only measurements on the homelab:

| Path | Filesystem | Size | Free |
| --- | --- | --- | --- |
| `/` and `/tmp`, `/var/tmp`, `/home/atari2036` | ext4 `/dev/sda2` | 915 GB | 43 GB (96% used) |
| `/mnt/nvme4tb` | ext4 `/dev/nvme0n1p1` | 3.6 TB | 1.1 TB (70% used) |

| Consumer | Root | Bytes |
| --- | --- | --- |
| Baton homelab `retained` | `/mnt/nvme4tb/ci-runners/baton2-native-homelab/retained` | 170 GB |
| Baton homelab `home` | `/mnt/nvme4tb/ci-runners/baton2-native-homelab/home` | 42 GB |
| Baton homelab `qualifications` | `/mnt/nvme4tb/ci-runners/baton2-native-homelab/qualifications` | 21 GB |
| Baton homelab `runner` | `/mnt/nvme4tb/ci-runners/baton2-native-homelab/runner` | 6.8 GB |
| Baton homelab `temp` | `/mnt/nvme4tb/ci-runners/baton2-native-homelab/temp` | 349 MB |
| ACP project `build-cache` | `/home/atari2036/render-fframes-port-20261016/build-cache` | 79 GB |
| ACP project `worktrees` | `/home/atari2036/render-fframes-port-20261016/worktrees` | 39 GB |
| ACP project `baton` | `/home/atari2036/render-fframes-port-20261016/baton` | 9.6 GB |
| ACP project `logs` | `/home/atari2036/render-fframes-port-20261016/logs` | 3.9 GB |
| ACP project `evidence` | `/home/atari2036/render-fframes-port-20261016/evidence` | 3.8 GB |
| ACP homelab `jobs` | `/mnt/nvme4tb/automated-content-pipeline-homelab-20261002/jobs` | 605 GB |
| ACP homelab `lanes` | `/mnt/nvme4tb/automated-content-pipeline-homelab-20261002/lanes` | 665 GB |
| ACP homelab `object-cache` | `/mnt/nvme4tb/automated-content-pipeline-homelab-20261002/object-cache` | 3.7 GB |
| ACP homelab `npm-cache` | `/mnt/nvme4tb/automated-content-pipeline-homelab-20261002/npm-cache` | 89 MB |

The ACP project root records its storage root as `storage` in
`/mnt/nvme4tb/automated-content-pipeline-homelab-20261002/config.json`. Its
render harness builds a bare, blobless, depth-1 Git cache under `FARM_CACHE`
(default `~/.cache/acp-farm`) through a sibling temporary directory and a
rename, and fetches `main` into a ref rather than `FETCH_HEAD`
(`repo-template/videos/scripts/farm.py:53-115`). The cache is per repository;
removing a job does not remove it (`repo-template/videos/scripts/farm.py:312`).
The farm README records that the shared immutable Git object cache keeps
independent filesystem links, so removing an old job does not invalidate other
jobs.

The installed `baton2-native-homelab.service` binds
`/mnt/nvme4tb/ci-runners/baton2-native-homelab` at
`/run/baton2-native-homelab`, sets `HOME`, `TMPDIR`, `RUNNER_TOOL_CACHE` and a
constructed `PATH`, and keeps the release, runner, native-client and tool
caches on the NVMe volume. The deployment-recovery lane owns that unit and its
drop-ins. The deployed NVMe scratch configuration, including
`TMPDIR=/run/baton2-native-homelab/temp`, stays unchanged.

## Storage roots

Bend2 records the canonical root for each storage class. The platform slice
configures none of them and schedules no storage apply command. It records the
measured paths and their owners:

| Store | Path | Owner |
| --- | --- | --- |
| Baton homelab retained evidence and attempt directories | `/mnt/nvme4tb/ci-runners/baton2-native-homelab/retained` | Baton homelab |
| Baton homelab worktrees | `/mnt/nvme4tb/ci-runners/baton2-native-homelab/worktrees` | Baton homelab |
| Baton deployed scratch | `/mnt/nvme4tb/ci-runners/baton2-native-homelab/temp` | Deployment-recovery lane |
| Shared model store | `/mnt/nvme4tb/shared-assets/atari2036-ai-models` | `atari2036`; parent root-owned |
| ACP immutable Git object cache | `/mnt/nvme4tb/automated-content-pipeline-homelab-20261002/object-cache` | ACP render farm |
| ACP npm cache | `/mnt/nvme4tb/automated-content-pipeline-homelab-20261002/npm-cache` | ACP render farm |

The shared model store holds 27 GB of model files. The ACP object cache holds
3.7 GB in `pack`. No Baton source reads either store, so this document makes no
Baton consumer claim and no shared-deduplication claim. Existing active paths
keep their files; no payload moves.

## macOS

Issue #912 records the operator's Mac with 17 GB free on a 228 GB APFS data
volume and no external writable data volume. Large builds and rendering run on
remote runners, as the ACP campaign rules require. A future project-local
scratch or cache root stays inside the project on the internal APFS volume. No
local Mac file is installed by this slice.

## Scheduled log cleanup

The OS wiring templates are:

- `deploy/storage/systemd/baton-logs-cleanup.service` and `.timer`;
- `deploy/storage/launchd/com.flip.baton.logs-cleanup.plist`.

Both call the normal CLI `<baton2> <database> logs-clean-all`. The database
argument is authoritative. The command enumerates registered session IDs from
the database and calls `Logs.clean` sequentially. Each call takes its session
lock, rereads pending input and applies the existing settlement checks. It
prints one JSON object to stdout:

```
{"results":[<one logs-clean response per registered session>]}
```

Temporary scratch and build outputs are not database candidates. The unit runs
under the database owner with the standard Baton environment and carries no
credentials.

The command contract is published in
[PR #918](https://github.com/Flip-Engineering/baton/pull/918) at head
`44b618d7ffe1adfe374762e8ec85640e46b7b434`. The templates stay uninstalled
until the main CLI build and merge are available, the database path and log
destination are confirmed, and root reviews the deployment.

## Log and evidence retention

`logs-storage` reports database, public log, segment, checkpoint, attempt and
stderr bytes. `logs-clean SESSION` removes eligible completed attempt
diagnostics under the session lock and preserves base logs, historical
segments, provider stores, unfinished attempts and files with incomplete
stderr metadata. `docs/bend2/logging.md` records the level, rotation and
cleanup rules.

Log and evidence retention reports candidates. It never blocks a turn,
dispatch, admission or completion.

## Related records

- Issue #912 holds the measured host and Mac evidence and the acceptance list.
- Issue #644 holds the retained-worktree classification.
- Issue #686 holds log volume, verbosity and cleanup evidence.
- Issue #677 holds heavy validation placement.
