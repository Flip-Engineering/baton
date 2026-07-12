# 07 — Roadmap (revised, review round 1)

> **Current scope supersession (2026-07-12):** the historical M3 remote Foreman/homelab idea below
> is not part of Baton's current goal. Baton remains deployment-neutral and single-project; adding
> homelab integration would be a detriment. The line is retained only as exploration history.

*Build sequence for the Option-A hub (doc 04). Milestones are cut so each one is independently useful and **falsifies something measurable**. Rewritten after review round 1 (doc 09 §F): the single strongest convergent signal from the Codex external review, the product judge, the ambition judge, and the time-scale judge was **"you are spending before you prove value, and the proof is cheap."** So eval and the differentiating demo move to the front, and the honest MVP is cut hard.*

## Guiding re-estimate (time-scale judge + Codex review)

The old "M1 in 1–2 weeks" was fiction. The supervisor invariants alone (`spec/supervisor-state-machine.md` I1–I7) are **~2–3 weeks to a tested skeleton for one adapter**, because the tests are the hard part: fault injection — kill the worker mid-approval, cancel `fleet_wait` mid-return, race human+orchestrator on one fence. Cross-vendor conformance is a **months-long, permanently-recurring** cost: every vendor CLI release is a potential break (the app-server is version-fragile; schema-gen is offline codegen, not runtime negotiation — pin versions, hash schemas, keep tested compatibility ranges). Plan for that trajectory, not just the MVP.

## M0 — Transport spike + the honest baseline (~1 week)

Goal: prove the load-bearing bridge works in *both* orchestrator directions, and establish the number every later milestone is judged against.

- Hub skeleton: single process, in-memory registry + JSONL event log. No policy engine, no budgets.
- `codex-adapter`: persistent `codex app-server` (stdio child), `thread/start`→`turn/start`→stream→`turn/interrupt`. Sandbox/approval via `thread/start`/`turn/start` params (**not** a `--sandbox` CLI flag — app-server has none; ref `docs/reference/codex-app-server.md`), workspace-write confined to the worktree.
- `claude-adapter`: child `claude -p --input-format stream-json --output-format stream-json --permission-mode acceptEdits`, one process per worker, **adapter-owned outbox** (nudges never hit stdin mid-turn).
- Northbound MCP tools (minimal): `fleet_spawn`, `fleet_send`, `fleet_wait`, `fleet_result`, `fleet_interrupt`, `fleet_list`.
- **Empirical experiments (this is the point of M0), each a recorded number:**
  1. `fleet_wait` under real host timeouts — set `tool_timeout_sec` (Codex `~/.codex/config.toml`) and `MCP_TOOL_TIMEOUT`/`CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` (Claude); confirm the bounded-poll-under-timeout (`HOST_SAFE_MS`) loop + progress heartbeats survive, both directions (Claude-orchestrator and Codex-as-orchestrator via `codex mcp`).
  2. **`turn/steer` behavioral semantics** — does it splice mid-turn or queue? The card may not declare `steer:native` until this passes (red-team `steer` A1).
  3. **Interrupt latency + the unwind window** — time from `fleet_interrupt` to confirmed `turn/completed(cancelled)`, and whether a shell child keeps running past the ack (red-team `interrupt` A1).
  4. **The honest baseline:** `codex exec` in a for-loop vs the minimal hub on ~5 fixed tasks — wall-clock and pass-rate. If the hub isn't already at least competitive on the axes it will later claim, stop and rethink.
- **Falsifies:** the whole event-loop premise, the steer/interrupt reliability premise, and "the hub beats a for-loop" — the three things everything else assumes.

## M1 — The differentiating demo + cross-review + the supervisor (~3–5 weeks)

The two things a `codex exec` for-loop *cannot* do, shipped first because they justify the hub's existence:

- **Differentiating exit demo (name it, gate on it):** orchestrator dies/restarts mid-fleet and resumes command with **pending approvals and worker state intact** (`fleet_list` re-hydration; supervisor I1–I6). A for-loop loses everything on Ctrl-C; the hub doesn't. This is the smallest thing that proves the architecture earns its complexity (product judge C1).
- **Cross-review as the headline (`fleet_review`):** hub-composed tool — worker A implements, worker B *from a different vendor* reviews the diff; the one use case with an existence proof (OpenAI's own plugin). Optional `fleet_bakeoff` (N vendors, same task, judge). Promoted from the old M2 (ambition judge C2).
- **The non-LLM supervisor (the real work):** I1 turn-scoped fencing, I3 at-least-once cursors, I4 bounded poll, I6 drain-first two-phase stop, I7 hub-run verification. Worktree leases with fencing. Priority/bulk lanes (I §4). Single-consumer approval arbiter (I2).
- **Approvals v1:** OS sandbox as the authorization boundary (Codex `sandboxPolicy` / Claude `permissionMode` confine to worktree); deterministic policy engine as a *tightening tripwire/logger only*; out-of-band human notify; timeout → deny-licensing-`status=blocked`. Hub-side watchdog (budget hard-stop + loop-auto-interrupt) that needs **no model turn** — promoted from M2 because the nested-approval padlock (red-team `approval` A4) leaves an unattended fleet otherwise unstoppable.
- **`BatonEvent` v1** with the `surface/model/seat` + `agent_path` envelope (modularity judge C4/C7) + SQLite derived cache (WAL, batched, crash-recoverable — never fsync-per-event); derived signals stall/budget/scope-drift/**semantic-progress** (red-team `adversarial` A4).
- **Cut-down eval at the exit gate:** arms (a) best solo vs (c) fleet on ~10 tasks; explicit pivot criteria (fleet ≤ solo pass-rate and >1.5× wall-clock → halt and rethink). Eval gates M2, not the reverse (Codex review; product judge C2).
- **Auth posture:** API-key is the **default** for unattended/CI; subscription auth is an opt-in, vendor-narrow, on-notice mode (doc 09 §F5). Benchmark the official **Codex SDK** and two-tool **`codex mcp-server`** as lower-ToS-risk alternatives to raw app-server ownership before committing.
- **Falsifies:** does orchestration actually beat a soloist (the eval); does the supervisor hold under fault injection; GLM-in-Claude-harness quality (deferred worker, see below).

## M2 — Full control surface + human seat + hardening (~weeks, earned by M1's eval)

- Control verbs complete with their corrected semantics (doc 05 §4): `nudge` (with `at=tool_boundary`), `steer` (effect-receipt ack; native-Codex-if-M0-verified / emulated-Claude), `fleet_freeze`, honest `pause` (emulated per card), `ask`/`fleet_respond` (the worker's voice — agent-xp C1). "Amendment is loud" conformance assertion.
- `glm-adapter` = claude-adapter + Z.ai env (officially supported config; `glm-5.2[1m]`, long timeout, auto-compact); scheduler respects plan concurrency ceilings (Pro ≈ 1 in-flight) as a hard input. Evaluate **OpenCode-as-GLM-worker** as a distinct, possibly richer adapter (`opencode serve` REST/WS + `export/import`) if the Claude-harness/GLM mismatch degrades quality.
- `baton top`: TUI dashboard — fleet view, provenance-typed digests (`facts` vs delimiter-wrapped untrusted `prose`), approve/deny, **takeover** (resume worker session in its own TUI).
- **New: worker isolation & threat model** implemented (per-worker throwaway `$HOME`, mount/sandbox enforcement, honey-token canary boot test) — doc 09 §C4.
- Per-vendor backoff/reroute (reroute is a headroom-checked scheduler decision, not a retry cascade); hub-lifecycle recovery (process registry in the ledger, boot reconcile, orphan reaper).
- Adapter conformance suite pinned to installed CLI versions in CI; kill quiesce protocol (T1/T2 numbers) + post-kill integrity pass.
- Red-team pass on cross-agent injection + result-contract forgery (doc 06 Q4, red-team `adversarial` A5/A7).

## M3 — Second northbound + reach (~when earned)

- Conductor mode (Option D): orchestrator under Agent SDK with a true push loop, reusing hub + adapters unchanged (the supervisor already removed the LLM from the liveness path, so this is a northbound swap, not a rewrite).
- ACP southbound tier (Gemini CLI first); draft ACP `steer`/usage extension proposals upstream (ambition judge C4).
- Foreman posture: hub on a remote box (atari-homelab-class), SSH/Tailscale northbound; unix control socket + `codex app-server proxy` + `codex remote-control` pairing (**not** the ws:// transport — explicitly unsupported; Codex review).
- Full eval publication (doc 06 Q9) with the harness card + per-vendor cost; routing-by-empirics falls out of the same data.

## Deliberately deferred / cut

- Multi-hub federation / A2A between hubs (until a second machine actually hurts).
- Worker↔worker chat (decomposition smell — doc 06 Q6).
- A public "BatonProtocol" spec (doc 06 Q5 — stay a compatibility layer).
- PTY tier-3 adapter reframed from "fleet view is total" to "known workaround, not a commitment" (ambition judge C7) — build only if a real harness with no other surface must join.
- Web dashboard before the TUI is loved.
- Raw-reasoning capture, editable-approvals-everywhere, generic mid-turn steer as a headline — all until measured demand (Codex review "what to cut").

## Open questions carried into implementation

1. `fleet_wait` block duration vs each host's MCP timeout: hardcode conservative `HOST_SAFE_MS`=25s or probe? (Conservative default + config override; MCP tasks extension — doc 03 — is the eventual native answer, host support varies.)
2. Supervisor: one process owning N adapters (single fence authority, single point of failure + ledger-replay recovery) vs one-per-worker. Leaning single-process.
3. Codex daemon vs per-worker stdio app-server: daemon gives multi-client + remote-control, stdio gives isolation and sidesteps `-32001` broker contention; measure both.
4. Claude Code `--bg` background-agent mode: enough (notifications, reattach) to replace the per-process adapter?
5. GLM-5.2 quality inside the Claude harness vs OpenCode-native (M2 experiment).
6. Where compaction bites: worker-side (brief survival, `thread/goal/set` re-injection) and orchestrator-side (decision-state rehydration via `fleet_recap` replaying own `control.*` + doc 08 decision records — agent-xp C7).
7. Anthropic agent-teams internals (`docs/reference/claude-harness.md`) as integration target: could baton workers appear as "teammates" to a Claude orchestrator, reusing its mailbox/task ledger rather than competing with it?
8. Nested-approval-loop host config: exact tool-annotation + approval-policy stanza per host that makes baton's control verbs auto-approvable, shipped as an install step and verified by the liveness preflight.
