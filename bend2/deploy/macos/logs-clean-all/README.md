# macOS registered-log cleanup

The focused `logs-clean-all` binary reads one existing Baton database and removes attempt diagnostics that pass the coordinator's cleanup checks. The runner stores one private result per job and UTC day. It retains result files for 30 days.

## Build the helper

Use Bend 2.0.25 and the host C compiler. The focused entry does not build the full coordinator.

```sh
BEND=/path/to/bend-2.0.25/bin/bend \
CC="$(xcrun --find clang)" \
SDKROOT="$(xcrun --sdk macosx --show-sdk-path)" \
sh bend2/scripts/build-native.sh \
  bend2/src/coordinator/logs-clean-all-focused.bend \
  .scratch/bend2/logs-clean-all-focused
```

Copy the resulting executable to `libexec/baton2/logs-clean-all` in a new immutable release directory. Keep the source commit, Bend executable hash, C compiler version, SDK version, generated C hash, and native binary hash in the release manifest.

## Install a per-database LaunchAgent

Copy `cleanup-registered-logs.sh` to `bin/cleanup-registered-logs` in the immutable release. Replace each `@...@` token in `com.flip.baton2.logs-clean-all.plist.in` with the user's home directory, release directory name, existing database path, job ID, hour, and minute. Install the resulting plist under `~/Library/LaunchAgents` with mode 0600.

Use a separate job ID for each database. The runner refuses a missing database or a symbolic link, writes private files under `~/Library/Logs/Baton2/logs-clean-all/<job-id>`, and keeps at most one success and one failure result per UTC day. LaunchAgents use `RunAtLoad=false`; an operator can run an initial pass with `launchctl kickstart` after bootstrap.
