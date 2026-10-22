# Storage policy

The coordinator records storage in durable classes. `storage-policy` prints
the classes, their roots and their retention bounds. `logs-storage` includes
the same policy object in its report.

## Classes and roots

| Class | Contents | Cleanup owner |
| --- | --- | --- |
| `scratch-build` | Build output under `.scratch` | Storage cleanup |
| `checkout-worktree` | Linked checkouts and worktrees | Landing and worktree removal |
| `shared-immutable` | Published shared assets | Asset publication |
| `git-objects` | Git objects and object caches | Git maintenance |
| `logs-evidence` | Registered logs, attempt logs and stderr evidence | Storage cleanup |
| `durable-state` | Project database and attempt directories | Database administration |
| `unknown` | A path with no class marker | Preserved |

The project argument is the configured canonical root recorded for the
project. On the homelab host that root sits on the NVMe array under the
runner tree at `/mnt/nvme4tb/ci-runners`. On a Mac host that root is
project-local on the project volume. Each class root is the recorded
project directory joined with the class directory: `.scratch` for scratch
and logs, `worktrees` for checkouts, `.git/objects` for Git objects and
`assets` for shared assets. Existing project paths remain valid on both
hosts and active payload stays in place. Issue
[#912](https://github.com/Flip-Engineering/baton/issues/912) records the
measured evidence for this policy.

## Retention

Log evidence has a retention bound of 268435456 bytes. The bound orders
preview output and names the point where settled items become cleanup
candidates. Scratch build output is a cleanup candidate when its owning
attempt has settled. Dispatch, admission and turn execution read no
retention bound.

## Cleanup

`storage-preview SESSION` reads the recorded attempt state for one session
and prints one item per attempt directory. Each item names its path, class,
byte count, removal decision and reason. Preview performs reads only.

`storage-apply SESSION` runs the locked session cleanup and prints the same
receipt shape with the cleanup result. `logs-clean SESSION` runs the same
cleanup and keeps its existing output shape.

An item is removed only when all of these facts hold:

- The class permits removal.
- No owner lease is active.
- No process is live for the attempt.
- The worktree holds no dirty or unpublished work for the item.
- No runtime input, unmerged ref or pending task or attempt data names it.
- The content is not shared with another owner.
- The path is not a symlink.
- The attempt has settled and the item holds bytes.

The decision reads recorded state and preservation facts. A repeated apply
finds the files absent and records no new removals. Apply re-reads state
under the session lock, so a turn that starts during cleanup keeps its
files. Removal uses the existing attempt-file helper, which opens the
attempt directory without following its final component and unlinks only
named regular files.

## Scheduled cleanup

The scheduled unit runs `storage-apply` for one named session. Apply reads
state under the session lock and removes an item only when the recorded
decision holds: exited, released, acknowledged, reported, exit 0, no
pending input and no diagnostic policy. A symlinked attempt directory and
an active session keep their files. Run `storage-preview SESSION` by hand
before the first scheduled run and read the receipt the unit leaves.

systemd timer unit `baton-storage-cleanup.timer`:

```ini
[Unit]
Description=Run Baton storage cleanup

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
```

systemd service unit `baton-storage-cleanup.service`:

```ini
[Unit]
Description=Baton storage cleanup

[Service]
Type=oneshot
ExecStart=/path/to/baton2 /path/to/state.db storage-apply SESSION
```

launchd agent `com.flip.baton.storage-cleanup.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.flip.baton.storage-cleanup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/path/to/baton2</string>
    <string>/path/to/state.db</string>
    <string>storage-apply</string>
    <string>SESSION</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>3</integer>
  </dict>
</dict>
</plist>
```

Replace `SESSION` with the session that owns the attempt directories.
