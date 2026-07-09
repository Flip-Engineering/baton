# 07 — Roadmap

*Build sequence for the Option-A hub (doc 04). Milestones are cut so each one is independently useful and falsifies something.*

## M0 — Spike: prove the two hard legs (~days)

Goal: one orchestrator (Claude Code) delegates one task each to a Codex worker and a Claude worker through a minimal hub, and can interrupt both.

- Hub skeleton: single process, in-memory registry + JSONL event log. No policy engine, no budgets.
- `codex-adapter`: persistent `codex app-server` (stdio child first; daemon later), `thread/start` → `turn/start` → stream → `turn/interrupt`. Auto-approve everything in a sandboxed worktree (`--sandbox` / workspace-write).
- `claude-adapter`: child `claude -p --input-format stream-json --output-format stream-json --permission-mode acceptEdits`, one process per worker.
- Northbound MCP tools: `fleet_spawn`, `fleet_send`, `fleet_wait`, `fleet_result`, `fleet_interrupt`, `fleet_list`.
- `baton tail <worker>`: raw event tail to a terminal.
- **Falsifies:** MCP long-poll viability (`fleet_wait` blocking semantics under each orchestrator's MCP client timeout behavior — the whole architecture leans on this; test it first, both directions: Claude-as-orchestrator and Codex-as-orchestrator via `codex mcp`).

## M1 — The GLM leg + approvals + real telemetry (~1–2 weeks)

- `glm-adapter` = claude-adapter + env override (Z.ai Anthropic-compatible endpoint), pending doc-01 findings on a native Z-code surface.
- Approval routing v1: deterministic policy file (allowlist/denylist per tool/command/path-scope) → escalate to `fleet_wait` → timeout = deny-with-message. Wire Codex server-requests and Claude canUseTool into it.
- BatonEvent schema v1 (doc 05) + SQLite index + digest levels; derived signals: stall, budget burn, scope drift.
- Task cards + result contracts (doc 06 Q6), per-harness brief templates.
- Worktree-per-worker lifecycle (create/merge/cleanup) + per-worker git identity.
- **Falsifies:** GLM-in-Claude-harness quality (Q1/Q6 concern); approval-deadlock design (doc 05 §5).

## M2 — Steering, human seat, hardening (~weeks)

- Control verbs complete: `nudge`, `steer` (native Codex / emulated Claude with `emulated` flag), `pause/resume`, idempotency keys, race rules from doc 05 §4.
- `baton top`: TUI dashboard — fleet view, digests, approve/deny, takeover (resume worker session in its own TUI).
- Budget enforcement (hard stop + threshold events); per-vendor backoff/reroute on rate limits.
- Adapter conformance suite run against installed CLI versions in CI; Codex schema-introspection feature detection.
- Loop detection; cross-review workflow preset (the existence-proof use case: worker A implements, worker B from a different vendor reviews).
- Red-team pass on cross-agent injection (doc 06 Q4).

## M3 — Second northbound + eval (~when earned)

- Eval harness (doc 06 Q9): fixed task set, solo vs native-subagents vs fleet, cost/time/pass-rate; publish numbers before adding features.
- Conductor mode (Option D): orchestrator under Agent SDK with true push loop, reusing hub + adapters unchanged.
- ACP southbound adapter tier (Gemini CLI first); OTel export bridge.
- Foreman posture: hub on a remote box (atari-homelab-class), SSH/Tailscale northbound; integrate `codex remote-control` daemon + pairing.

## Deliberately deferred

- Multi-hub federation / A2A between hubs (until a second machine actually hurts).
- Worker↔worker chat (decomposition smell — doc 06 Q6).
- A public "BatonProtocol" spec (doc 06 Q5 — stay a compatibility layer).
- Web dashboard before the TUI is loved.

## Open questions carried into implementation

1. `fleet_wait` vs MCP client timeouts: max safe block duration per client; resumable wait cursors as the fallback design.
2. Codex daemon vs per-worker stdio app-server: daemon gives multi-client + remote-control, stdio gives isolation; measure both.
3. Claude Code `--bg` background-agent mode: does it expose enough (notifications, reattach) to replace the per-process adapter? (Doc 01 to verify current state.)
4. Native Z.ai harness surface — exists? programmatic? (Doc 01.)
5. Where compaction bites: worker-side (brief survival — mitigations in doc 06 Q6) and orchestrator-side (fleet state re-hydration via `fleet_list` — doc 06 Q3).
