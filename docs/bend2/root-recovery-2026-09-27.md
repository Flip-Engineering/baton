# Native root delivery and recovery

These runs used the changes over `eea08d62` in the `bend2-architect14` worktree.
They exercised real Claude Code, Codex and OMP roots. Recovery killed the owned
coordinator, adapter and native processes and restarted them with retained
storage. The machine and the shared Baton resident were not restarted.

## Claude Code channel delivery

The first real Claude Code 2.1.283 connection failed with `CONNECT_TIMEOUT`.
Native PID 46262 sent a newline-delimited `initialize` request, while the
adapter waited for `Content-Length` framing. The adapter now reads and writes
newline-delimited JSON-RPC; the channel tests use that transport too.

Print mode loaded the MCP tools but did not register the development channel.
The interactive root registered it, then rejected the first notification with
`Invalid params ... meta.messageIds: Invalid input`. Channel metadata now
contains strings; `messageIds` is a JSON-encoded array in a string.

Native session `428f7a2f-c3ff-4894-a9ec-25c39d4771fb`, on `claude-opus-4-6`,
received `channel-live-turn` from a real OMP worker through
`notifications/claude/channel`. No prompt was typed to start that root turn.
The native debug log records receipt at `04:39:59.209Z`, followed by the native
`baton2_ack` call at `04:40:07.346Z`. Its receipt is
`root-amber-927 live-cobalt-927`. The first label came from the root's earlier
conversation; the worker report supplied the second.

## Claude Code recovery

Initialization replay exposed another real failure: a pending report was sent
before Claude installed its channel notification handler and remained
unacknowledged. The adapter now completes a client `ping` round trip after
tool discovery before replaying pending messages. Messages remain in the
coordinator database during that handshake. There is no timer or retry counter.

The recovery run killed native root PID 6538 and its owned MCP relay and server
PIDs 92110 and 92209 with SIGKILL. A further real worker turn then committed
`channel-pending-turn` while the channel was absent. The coordinator returned
a delivery error and retained the report. Its existing diagnostic path also
recorded `channel-pending-turn:observation`; both remained pending.

The root resumed session `428f7a2f-c3ff-4894-a9ec-25c39d4771fb` using native
`--resume` with the same MCP configuration. After the local development-channel
prompt was accepted, replay started its next turn without a new user prompt.
The native log records channel registration at `04:42:49.999Z` and the replay
notification at `04:42:50.141Z`. The root acknowledged all three pending rows:

| Message | Native receipt |
| --- | --- |
| `channel-turn` | `root-amber-927 worker-saffron-927` |
| `channel-pending-turn` | `root-amber-927 pending-jade-927` |
| `channel-pending-turn:observation` | `root-amber-927 observation-ack` |

The root inbox was empty afterward. Its native conversation retained the
earlier live-channel turn and the root review label. The recovered session
was then exited normally and remains available for native resume.

## Codex and OMP root recovery

The existing adapters launched Codex with `--ephemeral` and OMP with
`--no-session`. Real two-turn checks reproduced lost root context on both
routes: each first turn acknowledged its assigned review label, each second
turn returned `label-unavailable`, and the coordinator's root native ID stayed
empty.

The adapters now retain native sessions and bind the observed initialization ID
in the existing root session row. Reattachment preserves it; each later turn
passes it to the native resume command. The following real checks retained
both the native ID and the earlier review label:

| Route | Native root session | Remembered label |
| --- | --- | --- |
| Codex `gpt-6-astra` | `01a0e12f-47c8-7861-bdf5-2ceb68b08246` | `root-persist-indigo-codex` |
| OMP `deepseek/deepseek-flash` | `01a0e12f-4ee5-7000-b5af-eebe7f55129b` | `root-persist-indigo-omp` |

Each root then began a real review of the channel adapter and coordinator root
delivery module. Once its native stream showed a tool starting, the driver
killed that run's coordinator, adapter and native processes. The Codex run
killed PIDs 60128, 60131, 60241, 60463, 60601 and 72293. The OMP run killed
PIDs 61338, 61340, 61481 and 61622. Each `root-interrupted` message was already
committed and had no receipt.

Running the same adapter's `--attach` command again resumed its recorded native
session, delivered `root-interrupted`, and completed the review. Both receipts
contain the remembered label and substantive findings. Both root inboxes were
empty afterward, and both native IDs were unchanged. The native reviews were
static code reviews; the external driver's process and database observations
establish the kill-and-resume result.

## Evidence and checks

Artifacts are under `.scratch/bend2/architect14/` in this worktree:

- `claude-channel/`: native debug logs, raw MCP input/output, `crash.json`,
  `pending-before-resume.json`, `recovery-evidence.json` and worker streams.
  `framing-failure/` retains the first failed initialization.
- `codex-root-memory-before/` and `omp-root-memory-before/`: the real lost-label
  receipts before the native session repair.
- `codex-root-memory-after/` and `omp-root-memory-after/`: successful label
  continuation, `crash.json`, `crash-native.jsonl`, `resumed.out` and
  `crash-evidence.json`.
- `root-memory-run.py` and `root-crash-run.py`: the native continuation and
  process-loss drivers.

The touched Python checks passed: Codex root 10, OMP root 9, MCP root 9. These
cover native-session binding and reuse through reattachment, channel transport,
string metadata, delivery after discovery, and pending replay. No JS suite ran.
Worker branches, workspaces, native sessions and the coordinator databases were
retained.
