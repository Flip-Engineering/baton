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
| [grok-build-cli.md](grok-build-cli.md) | Grok Build CLI 0.1.216 (xAI): native ACP `grok agent stdio` (initialize handshake live-verified, verbatim frames), `x.ai/*` extension catalog, headless one-shot formats, leader/serve multi-client, sessions-on-disk = ACP stream, auth precedence, sandbox, D1 verb mapping — added 2026-07-10 |
| [Phase 40 proposed graph evidence](evidence/phase40-proposed-install-graph-live-2026-07-12/) | Official npm proposed-not-installed graph/delta, measured sandbox/runtime receipt, exact authenticated registry proxy, offline replay, and cleanup evidence |
| [Phase 41 transitive advisory evidence](evidence/phase41-transitive-advisory-live-2026-07-12/) | An exact byte copy of Baton's actual lock graph scanned through official OSV QueryBatch with scan-session/request/response CAS, conservative import attention, zero source mutation, and offline semantic replay |

**Caveat:** a few gap-check passes were cut off by a session limit during generation; the dossiers are the completed dig outputs. Where a dossier makes a load-bearing claim, verify against the cited binary/schema before building on it — several already flag their own unverified spots.
