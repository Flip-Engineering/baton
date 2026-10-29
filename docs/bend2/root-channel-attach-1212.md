# Attach the operator roots

This procedure attaches the operator's Claude Code and Codex conversations to
the runtime, flip, riff and film orchestra databases. It preserves each
database's unread messages. Run it after the release containing the root relay
and its coordinator changes is installed on the database host.

## Orchestra entries

| Orchestra | Claude Code MCP name | Codex MCP name | Database |
| --- | --- | --- | --- |
| runtime | `baton-runtime` | `baton-runtime` | `/mnt/nvme4tb/ci-runners/baton2-native-homelab/retained/baton-account-credits-793-702-20261017T0106Z/orchestra.db` |
| flip | `baton-flip` | `baton-flip` | `/mnt/nvme4tb/ci-runners/baton2-native-homelab/retained/flip-brusharena-research-20261019/orchestra.db` |
| riff | `baton-riff` | `baton-riff` | `/mnt/nvme4tb/ci-runners/baton2-native-homelab/home/.local/share/baton2/research/riff-backlog-20261019/orchestra.db` |
| film | `baton-film` | `baton-film` | `/home/atari2036/render-fframes-port-20261016/baton/orchestra.db` |

## Claude Code root

Set `ROOT_SESSION` to the existing Claude Code conversation ID and
`COORDINATOR` to the installed Baton executable on the database host. Attach
that same conversation to each orchestra before starting the MCP server:

```sh
ssh -T homelab "exec '$COORDINATOR' '/mnt/nvme4tb/ci-runners/baton2-native-homelab/retained/baton-account-credits-793-702-20261017T0106Z/orchestra.db' attach operator claude-code '$ROOT_SESSION' ''"
ssh -T homelab "exec '$COORDINATOR' '/mnt/nvme4tb/ci-runners/baton2-native-homelab/retained/flip-brusharena-research-20261019/orchestra.db' attach operator claude-code '$ROOT_SESSION' ''"
ssh -T homelab "exec '$COORDINATOR' '/mnt/nvme4tb/ci-runners/baton2-native-homelab/home/.local/share/baton2/research/riff-backlog-20261019/orchestra.db' attach operator claude-code '$ROOT_SESSION' ''"
ssh -T homelab "exec '$COORDINATOR' '/home/atari2036/render-fframes-port-20261016/baton/orchestra.db' attach operator claude-code '$ROOT_SESSION' ''"
```

Run `bend2/scripts/root-channel-config.mjs` on the database host once per
database. Save each printed entry on the Mac in the Claude Code MCP
configuration. Pass the matching server name and `--resume` ID:

```sh
node bend2/scripts/root-channel-config.mjs DATABASE COORDINATOR --session operator --resume ROOT_SESSION --ssh homelab --name baton-runtime
```

Use each table path with its matching server name. Start the existing
conversation with all four servers enabled:

```sh
claude --resume ROOT_SESSION --mcp-config FILE --dangerously-load-development-channels server:baton-runtime server:baton-flip server:baton-riff server:baton-film
```

The remote conductor sends one complete unread message at a time. Calling
`baton2_delivery` records the read and lets the next unread message be sent.

## Codex root

Use the same Codex `CODEX_HOME` for the app-server daemon, TUI and relay. Select
the existing root thread ID and retain it as `ROOT_THREAD`. Register its thread
in each database before starting the relay. Run these
commands from the Mac, substituting the installed coordinator and database
paths from the table:

```sh
ssh -T homelab 'exec COORDINATOR DATABASE attach operator codex ROOT_THREAD ""'
```

On the Mac, register one MCP server per database. `RELAY` is the checkout path
that contains `bend2/scripts/codex-root-relay.mjs`; the other paths are on the
database host.

```sh
codex mcp add baton-runtime -- node RELAY/bend2/scripts/codex-root-relay.mjs --ssh homelab --database DATABASE --coordinator COORDINATOR --conductor CONDUCTOR --session operator --thread ROOT_THREAD
codex mcp add baton-flip -- node RELAY/bend2/scripts/codex-root-relay.mjs --ssh homelab --database DATABASE --coordinator COORDINATOR --conductor CONDUCTOR --session operator --thread ROOT_THREAD
codex mcp add baton-riff -- node RELAY/bend2/scripts/codex-root-relay.mjs --ssh homelab --database DATABASE --coordinator COORDINATOR --conductor CONDUCTOR --session operator --thread ROOT_THREAD
codex mcp add baton-film -- node RELAY/bend2/scripts/codex-root-relay.mjs --ssh homelab --database DATABASE --coordinator COORDINATOR --conductor CONDUCTOR --session operator --thread ROOT_THREAD
```

Set each command's `DATABASE` to the matching table row. Set `COORDINATOR` and
`CONDUCTOR` to the installed executable and `mcp-conductor.mjs` paths on the
database host. Start the managed app-server and resume the selected root thread:

```sh
codex app-server daemon start
codex resume ROOT_THREAD
```

The managed app-server owns the thread resumed by the TUI. The configured relay
keeps the SSH conductor stream open. For each complete notification it opens
`codex app-server proxy` under the relay's `CODEX_HOME`, which finds the running
app-server's control socket on each delivery without a stored address. The relay
then:

1. Confirms with `thread/loaded/list` that the app-server has `ROOT_THREAD`
   loaded. Otherwise it queues nothing and exits with status 1.
2. Reads the thread's newest turn and its item IDs with `thread/turns/list`.
3. Runs `codex queue` with the complete notification.
4. Reads the thread's turns until a `userMessage` item that was not present in
   step 2 contains the complete notification text.
5. Calls the conductor's `baton2_root_delivery` with the thread, the complete
   notification, and the turn and item IDs that returned it. This records the
   read and advances delivery to the next unread message.

Queue acceptance does not record a read. A notification that is queued while the
root is in a long turn stays unread until the thread returns it. If the relay
or the root client closes first, the message stays unread and the next
connection sends it again, which can add a second copy of the notification to
the thread.

## Read the existing backlog

Leave all unread messages in place. Keep each relay connected while it queues
the oldest complete message and records its read. The conductor then sends the
next unread message. Continue until each database reports no owed operator
input. Use `status` to inspect owed counts; do not use `pending`, `inbox` or
age-based updates as a backlog-clearing step because those operations record
reads.
