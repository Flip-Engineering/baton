# Phase 72 — native Kimi Code harness and bidirectional Baton participation

Status: acceptance-red until every contract below is implemented, adversarially tested without a
new credential, independently reviewed, and live-proved through Baton's ordinary application
surface. This phase is additive to Phase 71: `claude-code` driving Kimi K3 remains one route, while
the native `kimi` command is a distinct coding harness.

Current grounded deployment facts, refreshed 2026-07-17:

- Kimi Code CLI `0.27.0` is installed and subscription-authenticated at
  `~/.kimi-code/bin/kimi`; it is not on this process's `PATH`, so Baton needs bounded executable
  discovery rather than assuming a newly installed shell profile has been reloaded;
- `kimi acp` is the native machine interface: JSON-RPC over stdin/stdout with initialize,
  authenticate, new/load/resume/prompt/cancel/list, model/thinking/mode config, streamed updates,
  approval requests, and file reverse-RPC;
- ACP 0.27.0 does not implement `session/close`, so exact process-group close/reap remains Baton's
  responsibility;
- the official Kimi Agent SDK exposes multi-turn sessions, streamed tool/approval/status events,
  interrupt, close, model/thinking selection, and explicit executable/environment configuration;
  and
- Kimi Code supports MCP, the preferred self-describing northbound bridge when Kimi acts as a
  Baton orchestrator rather than a Baton worker.

Authoritative references:

- <https://github.com/MoonshotAI/kimi-code>
- <https://moonshotai.github.io/kimi-code/en/reference/kimi-acp>
- <https://moonshotai.github.io/kimi-code/en/reference/kimi-command>
- <https://github.com/MoonshotAI/kimi-agent-sdk/tree/main/node/agent_sdk>

## KC1 — two honest routes

The registry distinguishes `claude-code` plus Kimi provider/K3 model from the native `kimi-code`
harness plus its observed provider/model inventory. The orchestrator selects harness, model, and
effort together. Internal adapter keys may disambiguate providers; public receipts use observed
harness/version/provider/model identities. Neither route impersonates the other.

Baton discovers an existing `kimi` binary from deployment configuration or a bounded search that
includes the official user install location. It resolves and versions the executable before
admission. Baton never installs, upgrades, migrates, logs in, logs out, or rewrites Kimi Code.

## KC2 — native ACP worker adapter

`KimiAcpCli` uses `kimi acp` and a reusable ACP client core, not terminal escape sequences or TUI
scraping. It validates initialize identity/version/capabilities/auth before provider work and maps:

- spawn to initialize/authenticate plus `session/new` or exact `session/load`/`session/resume`;
- prompt to `session/prompt`, without fabricating unsupported mid-turn steer behavior;
- interrupt to `session/cancel` plus one correlated terminal result;
- approval/question to `session/request_permission` responses;
- recovery/list to advertised session methods; and
- kill to exact owned process-group termination/reap because ACP lacks `session/close`.

ACP request, session, process-generation, task, and worker IDs remain distinct and correlated.
Unknown or unstable methods are unsupported, never silently emulated. Reverse file RPC stays inside
the task worktree and path policy; unavailable terminal reverse RPC is not advertised.

## KC3 — exact native model and effort control

The adapter derives model and thinking/effort inventory from Kimi initialization/config options. A
requested model is set through the supported config option or exact native flag and observed back
before work proceeds. Baton does not map `low`, `medium`, `high`, `xhigh`, or `max` onto a boolean
thinking switch by folklore. Each model advertises only a lossless, policy-approved mapping; an
always-thinking model refuses incompatible effort, and missing required effort refuses pre-spawn.
There is no global `low` default.

## KC4 — private runtime and global non-interference

Every native Kimi worker receives a Baton-owned `HOME`, temp directory, and Kimi config/session/log
root. Ambient provider/injection variables are stripped. Deployment policy may project an explicitly
approved subscription-login artifact into that private root with owner-only permissions, but Baton
never mutates `~/.kimi-code`, copies credentials into a worktree, or exposes content/host paths in
logs, prompts, evidence, exports, or status.

Pre-ready missing auth is typed and creates no provider turn. Worker spawn never starts a device
login. Tests snapshot representative global Kimi files and the installed executable around normal,
crash, cancel, kill, replay, and shutdown paths.

## KC5 — lifecycle, recovery, and exact reap

Kimi inherits Phase 70. ACP turn terminality does not prove process close; cancel does not prove
descendants are gone. Kill confirms only after exact group reap. Unaccepted dirty progress is
checkpointed before runtime/worktree removal, and preservation failure retains both.

Restart loads/resumes only the exact session bound to task, repository, checkout, model,
effort/thinking mode, and process lineage. Response loss cannot create another session/provider turn.
Model/auth/protocol mismatch never falls back to Claude, GLM, Grok, another Kimi route, or ambient
configuration.

## KC6 — Kimi as a capability-scoped Baton orchestrator

Kimi Code may also act northbound as a Baton orchestrator through the existing authenticated
application semantics, preferably projected as compact MCP tools:

- `runs.start`, `inspect`, `help`, `changes`, `act`, `answer`, `steer`, and `stop` remain the one
  semantic vocabulary;
- tools return outline first, then ToC/section/item/evidence depth on demand;
- ordinary calls accept objectives, reasons, action IDs, and semantic inputs—not Git refs,
  worktree/runtime paths, environment maps, budgets, export ceilings, or raw receipts;
- Baton's private repository/user connection selects URL/repository/token; no token appears in a
  prompt, argv, tool schema, or checked-in Kimi MCP config; and
- the Agent SDK may host programmatic sessions, but calls the same Baton client/MCP authority rather
  than inventing a second orchestration API.

A Kimi orchestrator can direct Runs whose workers use native Kimi. That recursive topology is
explicitly bounded; it does not let a worker control itself or the fleet.

## KC7 — worker/orchestrator authority separation

Worker credentials and Kimi-orchestrator Baton credentials are different principals, capabilities,
and runtime projections. A worker gets task-scoped file/tool authority and addressed interaction. An
orchestrator gets only granted repository/Run capabilities. Neither can read/reuse the other's token,
session store, MCP configuration, private home, or action IDs.

A worker cannot promote itself by invoking a local `baton`, discovering connection files, adding an
MCP server, reading parent environment, or replaying an orchestrator action. An orchestrator cannot
bypass Plan approval, routing, stop barriers, evidence gates, or addressing. Recursive Runs carry a
lineage/depth guard and refuse cycles or unbounded self-spawn before effects.

## KC8 — self-describing AX and metadata

Cards expose ACP method/reverse-RPC coverage, model/thinking inventory, load/resume/list, approvals,
missing session close, credential state, isolation, reap ownership, and observation gaps. Help says
whether Kimi is acting as harness, orchestrator, or both without dumping the full card by default.

Ordinary explicit selection is:

```text
baton "OBJECTIVE" --harness kimi-code --model MODEL --effort EFFORT
```

When policy plus live inventory identify one exact route, axes may be inferred. Ambiguity refuses
with one help continuation. Endpoints, keys, session roots, MCP JSON, ACP frames, budgets, byte
ceilings, and process timeouts never become ordinary arguments.

## KC9 — deterministic and recursive acceptance

Before live provider work, fake ACP and fake authenticated Baton tests prove:

1. initialize/auth/new/load/resume/prompt/cancel/permission frames are exact and correlated;
2. model plus effort/thinking is exact and unsupported/missing values refuse pre-provider;
3. private roots are owner-only and global Kimi files remain byte-for-byte unchanged;
4. crash, malformed protocol, unknown method, auth refusal, timeout, response loss, and descendants
   fail closed without route fallback;
5. concurrent native Kimi workers get independent sessions/worktrees and kill/reap exactly;
6. Phase 70 checkpoints dirty progress and `resume_work` restores it once;
7. a Kimi orchestrator can start, inspect, act, steer, and stop an authenticated Run through the
   outline-to-evidence tool cascade;
8. worker authority cannot be reused as orchestrator authority, and recursive cycles/depth attacks
   refuse pre-spawn;
9. native Kimi and Claude-Code-through-Kimi coexist with distinct receipts/route learning;
10. restart preserves exact session/action idempotency without duplicate provider work; and
11. existing Claude, GLM, Grok, Web, MCP, application, route, lifecycle, and Phase 70 tests stay green.

The live gate uses the existing subscription login only after private projection is proven: one tiny
read-only worker, one bounded edit with fresh verification, confirmed kill/reap, and a separately
authenticated Kimi orchestrator controlling a disposable Run. It compares global Kimi state before
and after without printing credentials. No homelab integration is part of this phase.
