# docs/reference — implementation-grade harness dossiers

Deep dives produced from primary-source inspection of the installed binaries (codex 0.144.0, claude 2.1.205, opencode, gemini), the generated Codex app-server JSON-schema bundle, OpenAI's Codex-plugin source, and vendor docs — with local binary evidence outranking web docs on conflict. These are the working references for adapter authors; the design docs (`../00`–`../09`) cite them.

| Dossier | Covers |
|---|---|
| [codex-app-server.md](codex-app-server.md) | Full app-server protocol: 121 client methods (33 experimental, absent from the schema dump), transports (stdio/unix-socket/ws/daemon), initialize handshake, turn/thread/approval/steer surface, `-32001` contention, v1 vs v2 |
| [codex-runtime.md](codex-runtime.md) | `codex exec --json` event vocabulary, `--output-schema`, `codex mcp-server`, config.toml, session storage, sandboxing (Seatbelt/Landlock), auth, features flags |
| [claude-agent-sdk.md](claude-agent-sdk.md) | `query()` Options, Query API (interrupt/setModel/applyFlagSettings), SDKMessage vocabulary, canUseTool/PermissionResult, hooks, control_request/response frames, transcript JSONL |
| [claude-harness.md](claude-harness.md) | settings hooks (events, payloads, exit-code semantics), agent teams internals (`~/.claude/teams`, task files, mailbox, locking), background agents, OTel, plugin hooks.json |
| [acp-bridge-lessons.md](acp-bridge-lessons.md) | The two ACP bridge codebases (claude-agent-acp, codex-acp) as engineering references: process/lifecycle, mapping tables, capability losses, cancel/completion races — with design lessons for baton adapters |
| [memory-pm-prior-art.md](memory-pm-prior-art.md) | Shared-memory/PM substrates: agent teams task+mailbox formats, codex-plugin job ledger, claude-flow `.swarm/`, MemGPT/Letta, beads, git-as-memory — feeds `../08` |

**Caveat:** a few gap-check passes were cut off by a session limit during generation; the dossiers are the completed dig outputs. Where a dossier makes a load-bearing claim, verify against the cited binary/schema before building on it — several already flag their own unverified spots.
