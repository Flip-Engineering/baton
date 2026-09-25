# External Review — Codex / GPT-5.x (cross-vendor red-team)

*Generated 2026-07-09 by running OpenAI Codex CLI (codex 0.144.0, ChatGPT-auth, read-only sandbox) as an adversarial external reviewer over docs/00–07. This dogfoods baton'''s own thesis: the harness being orchestrated critiques the design to orchestrate it. Codex ran 9 web searches to ground its critique. Unedited output below.*

---

## Verdict

Baton has identified the right interoperability problem but selected a northbound architecture that cannot provide the liveness guarantees the design assigns to it. The hub is promising; making a synchronous CLI model part of the approval and scheduling control plane is not.

## Top risks

1. **`fleet_wait` is not an event loop.** This is the largest underweighted risk despite being called “the crux” in doc 04 §“The event-loop problem.” A Codex MCP tool has a default 60-second timeout; `fleet_wait(timeout_s=300)` will be cancelled unless every installation is specially configured. If the server returns its resume cursor only when the call completes, cancellation also loses the cursor. Progress notifications may update UI, but they do not wake the model or create a new model turn. Failure scenario: the wait dies at 60 seconds, a worker requests approval at 61, the result is delivered to a dead waiter, and the worker remains blocked while retries accumulate. [Codex’s MCP configuration](https://developers.openai.com/codex/config-reference) documents the 60-second default.

2. **There is no real concurrency-control model.** Idempotency keys and `human > orchestrator > policy` in doc 05 §4 are insufficient. You need leases, fencing epochs, expected-state transitions, and single-consumer ownership for approvals. Failure scenario: a human takes over worker epoch 12 while a stale orchestrator resolves an approval observed at epoch 11; both operations are individually valid, but the supposedly paused worker executes the command. App-server approval requests are request-scoped and later emit `serverRequest/resolved`; Baton must treat them as consumable messages, not replayable facts.

3. **The subscription-arbitrage premise is overstated.** Doc 01 §7 and doc 06 Q7 infer a general blessing from OpenAI’s Claude plugin. That plugin is evidence that one integration is supported, not permission for arbitrary unattended subscription-funded fleets. Current OpenAI guidance says API-key auth is for programmatic CI/CD, while enterprise access tokens are for trusted schedulers and private runners; ordinary ChatGPT sign-in is described for local work. App-server documentation also directs job automation toward the Codex SDK. Failure scenario: a fleet works under a developer login, then hits workspace policy, account-wide limits, or an auth-policy change with no billable fallback. [OpenAI authentication guidance](https://developers.openai.com/codex/auth) is materially narrower than the docs claim.

4. **Backpressure is almost undesigned.** Doc 05 specifies “map everything,” full replay, JSONL, SQLite, deltas, OTel, and multiple workers, but no bounded queues or overload policy. Failure scenario: five workers emit command-output and reasoning deltas faster than SQLite fsyncs; the hub stops draining child stdout, pipe buffers fill, workers appear stalled, and the stall detector “corrects” healthy work. Approvals and lifecycle events need a separate priority lane; message/output deltas must be coalescible or droppable.

5. **The roadmap spends before proving value.** Evaluation is deferred to M3 even though doc 06 Q1 admits the real competitor is “`codex exec` in a for-loop.” M1’s approvals, telemetry, worktrees, scheduler, GLM compatibility, SQLite, and deadlock handling are not a 1–2 week production milestone. Also, GLM-through-Claude is a second model provider, not a third independent harness architecture. Failure scenario: months are spent normalizing surfaces before discovering that coarse cross-review needs only spawn/result/cancel.

## Codex-surface corrections

- Doc 02 §Codex calls schema generation “protocol introspection.” It is offline, version-specific code generation, not runtime reflection or protocol negotiation. A schema diff cannot teach old adapter code new semantics. Pin CLI versions, hash schemas, and maintain tested compatibility ranges.

- The app-server is publicly documented and has a stable API subset plus explicit experimental opt-in; calling it simply “literally experimental” in doc 06 Q8 is inaccurate. Conversely, its WebSocket transport remains explicitly “experimental and unsupported,” so doc 04’s daemon/Foreman posture should not treat it as a production socket. [App-server protocol documentation](https://developers.openai.com/codex/app-server).

- Doc 05 §5’s `fleet_approve(... allow|deny|edit)` does not map to Codex. Command approvals support accept, decline, cancel, session acceptance, or an **exec-policy amendment**; that amendment does not edit the pending command. File approvals have no amendment. “Edit” must mean decline plus steer/reprompt. [Approval decisions](https://developers.openai.com/codex/app-server#approvals).

- Doc 05 §4 invents `pause` through an approval gate. Codex does not guarantee an approval boundary before every tool call; already-allowed commands and non-command tools pass through. Expose `pause` as unsupported unless implemented by interrupting the turn.

- `thread/archive` is not `kill`. It moves persisted thread logs; it does not by itself terminate an active turn, background terminal, or app-server process. A kill sequence needs interrupt, process cleanup, terminal cleanup, and verification.

- Doc 06 Q6 overclaims `thread/goal/set` as a compaction-proof definition-of-done pin. The documented guarantee is persisted goal state and accounting, not that arbitrary acceptance criteria are automatically preserved verbatim in every post-compaction prompt.

- Doc 07 M0’s `--sandbox` wording is wrong for app-server: its CLI has no such option. Sandbox and approval policy belong in `thread/start`/`turn/start` parameters or config.

- When Codex is the orchestrator, Baton’s mutating MCP tools may themselves trigger MCP-tool approval depending on host policy and tool annotations. That creates a nested approval loop: Codex asks the human for permission to answer a worker’s permission request. Doc 05 does not model this.

- New enterprise-facing app-server clients must identify themselves with `clientInfo`; OpenAI asks enterprise integrations to contact it for known-client registration. Treat app-server as an integration contract, not an anonymous internal socket.

## What to cut / what to add

Cut v1 to `spawn`, short `poll`, `result`, `interrupt`, and coarse cross-review. Drop pause, editable approvals, PTY support, raw reasoning capture, remote-control integration, A2A preparation, and generic mid-turn steering until measured demand exists. Benchmark the official Codex SDK and two-tool `codex mcp-server` surface before committing to raw app-server ownership.

Add a non-LLM supervisor state machine: durable inbox/outbox, preallocated cursors, leases and fencing epochs, short polls below host timeouts, independent human notifications, pending-approval recovery, and explicit cancellation semantics. Add bounded priority queues, delta coalescing, retention/redaction/encryption, provider-account concurrency budgets, CLI/schema pinning, and fault-injection tests. Move the solo-versus-fleet evaluation into M0; budget several weeks for a credible local alpha and months for hardened cross-vendor operation.

## What they got right

Doc 04 principle 2 and doc 06 Q6—**artifacts over chat, with worktree isolation and structured result contracts**—is the strongest idea here. Double down by making worker prose non-authoritative: Baton should trust independently verified commits, diffs, and test evidence, not narratives or transcripts.