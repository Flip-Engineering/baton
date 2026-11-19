# Repair the Codex root relay on the operator's Mac (#1054)

This procedure restores root delivery into Codex thread
`01a1125f-5f70-7ed0-8857-d155680a01af` on the operator's Mac and installs the
relay repair from `fix/1054-root-relay-20261104`. Run every command on the
Mac. The Baton package is built and tested on the homelab; the Mac only
installs the finished package and runs operational commands.

Terms used below:

- `ROOT_THREAD` = `01a1125f-5f70-7ed0-8857-d155680a01af`
- `RELEASE` = the installed package directory that contains the repaired
  `libexec/baton2/codex-root-relay.mjs`
- MCP entry names (`baton-runtime`, `baton-opus`, and any others) come from
  `codex mcp list` in step 2; use the names shown there
- The database host is reachable as `atari-homelab-lan` on the LAN and as
  `atari-homelab` over Tailscale

## 1. Record the current state

```sh
readlink ~/.codex/app-server-control/app-server-control.sock
ls -ld /private/tmp/codex-daemon-$(id -u)
pgrep -fl codex-root-relay.mjs
ps aux | grep -i codex | grep -v grep
```

Expected: the symlink points into `/private/tmp/codex-daemon-<uid>/<hash>` and
the directory exists (it has existed since 2026-11-01 21:20 PDT). The process
list shows the managed daemon and one or more `codex-root-relay.mjs`
processes. Keep this output; it is the before picture for the report on
#1054.

If the symlink target is missing again, follow section 6 before continuing.

## 2. Retire stale relay processes

Each relay child exits when its Codex context closes or when its standard
input ends. Stale generations left over from earlier configurations do not
exit on their own. Verify ownership and purpose before ending any process:

```sh
pgrep -fl codex-root-relay.mjs
ps -o pid,ppid,lstart,command -p $(pgrep -f codex-root-relay.mjs | tr '\n' ',' | sed 's/,$//')
```

For each listed process, confirm its command line names
`codex-root-relay.mjs` and one of the Baton databases, and confirm its parent
from `ppid` is the managed daemon or a known supervisor. Do not signal any
process whose command line does not match. End the verified ones:

```sh
kill <PID>...
```

Expected: each process exits within a few seconds (`pgrep -fl
codex-root-relay.mjs` shrinks). A relay that holds a root-thread delivery
lock releases it on exit; `ls -l
~/.codex/root-channel-delivery-locks/` shows the lock files, and `lockf -k -t
0 <lockfile> true` exits 0 once no holder remains. Unread messages are not
lost: a read is recorded only after the thread returns the message, so every
message that was in flight stays unread and is sent again on the next
connection.

## 3. Update the MCP registrations

List the current entries:

```sh
codex mcp list
```

For each enabled Baton entry (`baton-runtime`, `baton-opus`, and any other
enabled entry from the list; keep disabled portfolio entries disabled),
re-register it with the repaired relay path and both SSH hosts. Fill
`DATABASE`, `COORDINATOR`, and `CONDUCTOR` from the existing entry shown by
`codex mcp get <name>`:

```sh
codex mcp remove baton-runtime
codex mcp add baton-runtime -- node RELEASE/libexec/baton2/codex-root-relay.mjs \
  --ssh atari-homelab-lan --ssh atari-homelab \
  --database DATABASE --coordinator COORDINATOR --conductor CONDUCTOR \
  --session operator --thread ROOT_THREAD
```

Expected: `codex mcp get baton-runtime` shows the new command line with both
`--ssh` values. With both hosts registered, the relay connects over
Tailscale whenever the LAN route is unreachable.

## 4. Restart the managed daemon and resume the root thread

The daemon spawns relay children for its active contexts. Restart it so every
context picks up the repaired relay and the repaired registration:

```sh
codex app-server daemon restart
codex resume ROOT_THREAD
```

Expected: the restart command prints a JSON lifecycle result with a restarted
status. Threads are stored on disk under `~/.codex`; the resume reloads the
root thread into the new daemon. No session content is lost. New
`codex-root-relay.mjs` children appear within a few seconds:

```sh
pgrep -fl codex-root-relay.mjs
```

Expected: one child per enabled entry per active context, each command line
showing the repaired `RELEASE` path and both `--ssh` hosts.

## 5. Verify delivery (the #1054 completion evidence)

The lead dispatches a fresh complete Baton message to the runtime orchestra's
`operator` session from the database host. On the Mac, watch for the relay to
queue it and for the thread to return it:

1. The message appears in the root thread as a user message. Open the resumed
   thread and check that the newest user message carries the dispatched text.
2. The relay logs `codexRootMessageReceived` with the dispatched message ID
   on its standard error. For daemon-spawned children this stream is captured
   by the app-server logs under `~/.codex/log/`; if it is not visible there,
   the lead can confirm the read from the database host instead: the
   conductor records the native-bound read only after the thread returns the
   complete message, so the message leaving the owed list on the database
   host is the read record.
3. The lead confirms the read record for the message ID and the session owes
   no further input.

## 6. Recovery when the control socket directory is missing

Codex binds the managed daemon's control socket under
`/private/tmp/codex-daemon-<uid>/<hash>` and points
`~/.codex/app-server-control/app-server-control.sock` at it. The location is
fixed in the Codex binary; macOS `/tmp` cleaning can remove the directory
while the daemon keeps the unlinked socket open, and new connections then
fail with ENOENT. Detect this state:

```sh
readlink ~/.codex/app-server-control/app-server-control.sock
ls -ld /private/tmp/codex-daemon-$(id -u)
```

Expected in the failure state: the symlink resolves into a directory that
`ls` reports missing. Recovery is a daemon restart, which re-creates the
directory, binds a new socket, and re-points the symlink:

```sh
codex app-server daemon restart
codex resume ROOT_THREAD
codex app-server proxy </dev/null; echo "proxy exit: $?"
```

Expected: the proxy exits 0 once the socket answers. Relays reconnect on
their own; the operator's 2026-11-01 log showed the relay already retries the
proxy every second while the socket is missing.

## 7. Rollback

1. Re-register each MCP entry with its previous command line (the old relay
   path, or the repaired path with a single `--ssh atari-homelab-lan` host).
2. `codex app-server daemon restart` and `codex resume ROOT_THREAD`.
3. The per-database delivery state files
   (`~/.codex/root-channel-delivery-locks/*.json`) are written only by the
   repaired relay. The previous relay version ignores them. Remove them only
   if a clean downgrade is required:

   ```sh
   rm ~/.codex/root-channel-delivery-locks/*.json
   ```

   Removing them loses the recorded read positions and queue records, so the
   next delivery of an unread message re-scans the thread history and may
   queue a second copy of a notice that was already queued.

Rollback does not touch Codex threads, the databases, or unread messages.
