# 05 — Telemetry, Monitoring, Interruption & Steering

*The observability and control semantics of the hub. Telemetry is not a feature bolted onto orchestration — it is the input to steering, and steering without it is guessing.*

## 1. Normalized event schema

Every adapter translates its harness's native stream into `BatonEvent`:

```jsonc
{
  "ts": "2026-07-09T18:22:31.041Z",
  "seq": 4172,                     // per-worker monotonic; gap-free or gap-flagged
  "worker": "w_codex_01",
  "harness": "codex@0.144.0",
  "session": "thread_abc",         // harness-native session/thread id
  "turn": "turn_007",
  "kind": "action.tool_call.completed",
  "payload": { /* kind-specific */ },
  "emulated": false,               // true when the adapter faked a primitive
  "actor": "worker"                // worker | orchestrator | human | policy
}
```

Kind taxonomy (closed set, versioned):

- **lifecycle.**: `spawned`, `turn_started`, `turn_completed`, `session_compacted`, `exited`, `crashed`
- **content.**: `message_delta`, `message`, `reasoning_delta` (off by default — expensive, rarely actionable), `plan_updated`
- **action.**: `tool_call.started/completed`, `file_edit` (path + diffstat), `command_exec` (cmd + exit + duration), `diff_updated`
- **control.**: `interrupt`, `steer`, `nudge_queued`, `approval.requested/resolved`, `policy.blocked` — *always* carry `actor`
- **resource.**: `tokens` (in/out/cache), `cost_estimate`, `rate_limit`, `budget.threshold_crossed`
- **health.**: `stall_suspected`, `loop_suspected`, `error`, `quota_exhausted`

Mapping examples: Codex `turn/diff/updated` → `action.diff_updated`; Codex `thread/tokenUsage/updated` → `resource.tokens`; Claude stream-json result usage → `resource.tokens`; Claude `--include-hook-events` → whichever kind the hook signifies. Adapters must map *everything* to some kind (`unknown.passthrough` with the raw payload rather than dropping — silent event loss is how debugging dies).

Storage: append-only JSONL per worker (the replayable truth) + SQLite index (queries, dashboard). Optional OTel bridge exporting spans (turn = span, tool call = child span) and metrics — Claude Code already speaks OTel natively, so the hub's export should *merge*, not duplicate, when workers self-report.

## 2. Derived signals (where monitoring earns its keep)

Raw event tails are for humans debugging; the orchestrator should consume **derived signals** computed by the hub:

- **Stall**: turn open, no events for N seconds (N per-harness; reasoning models legitimately go quiet — calibrate against `reasoning_delta` heartbeats if enabled).
- **Loop**: k-repetition of near-identical tool-call signatures (same tool, similar args, similar failure) — the classic edit/test/fail spiral.
- **Budget burn**: tokens or cost vs. the brief's budget; thresholds at 50/80/100% emit `resource.budget.threshold_crossed`.
- **Scope drift**: file edits outside the brief's declared path scope. Cheap to compute, remarkably predictive of trouble.
- **Churn**: same file edited > m times in a turn — indecision proxy.

These become `fleet_wait`-surfaced digests. The orchestrator never needs to read 4,000 events; it needs "w_codex_01: 82% budget, loop-suspected on `pytest tests/test_auth.py` (5 near-identical failures)".

## 3. Digest levels

`fleet_events(level=…)`:
- `digest` (default): lifecycle + control + health + resource thresholds + per-turn one-line summaries (the adapter or a cheap local model summarizes each completed turn).
- `actions`: + tool calls, file edits, diffstats.
- `full`: everything including content deltas (human dashboard / postmortem replay; almost never the orchestrator).

**Principle: the orchestrator's context is the scarcest resource in the system.** Every schema decision above exists to let it supervise five workers for an hour on a few thousand tokens.

## 4. Control verbs and their exact semantics

| Verb | Semantics | Codex | Claude Code |
|---|---|---|---|
| `nudge` | Queue message; delivered at next turn boundary (never disturbs in-flight turn) | queue → next `turn/start` | queue → next stdin message |
| `steer` | Redirect the in-flight turn, preserving its work | **native `turn/steer`** | emulated: `interrupt` → resume-with-message (flagged `emulated`) |
| `interrupt` | Cancel in-flight turn; session lives; optional `then` message starts next turn | `turn/interrupt` | SDK interrupt / control frame |
| `pause` / `resume` | Hold at next tool boundary; no new tool executions until resume | via approval-gate (defer approvals) | via canUseTool/hook deferral |
| `kill` | End session; adapter must confirm process/thread death and emit `lifecycle.exited` | `thread/archive` + process mgmt | SIGTERM → SIGKILL escalation, transcript preserved |

Race rules (write them down or debug them forever):
- `steer` racing `turn_completed`: if the turn ends first, the steer **degrades to a nudge** and the ack says so. Never apply stale steering to a fresh turn silently.
- All control ops carry client-supplied idempotency keys; replays are no-ops with the original ack.
- Control ops are themselves events in the ledger (`control.*` with `actor`) — **the orchestrator must be able to see that a human steered its worker**, and vice versa. Two supervisors editing one worker without a shared journal is a farce.
- Conflict rule: human > orchestrator > policy defaults. A human `pause` cannot be overridden by an orchestrator `resume`; the orchestrator gets a `policy.blocked` event explaining why.

## 5. Approval routing (the permission chain)

Worker approval requests (Codex server-requests; Claude canUseTool) flow: **policy engine → orchestrator → human**, with per-stage timeouts.

- Policy engine first: deterministic rules (allowlist/denylist by tool, command pattern, path scope from the brief). Rules answer instantly; everything else escalates. The policy engine must be deterministic — an LLM-judged permission gate is itself steerable by a prompt-injected worker (doc 06).
- Escalation to orchestrator: surfaces in `fleet_wait` as an attention item; orchestrator answers via `fleet_approve` (allow/deny/**edit** — amending the command is the highest-leverage steering primitive there is).
- Escalation to human: dashboard notification; on timeout, **deny-with-message** ("denied: no approver available; explain what you wanted and continue read-only") — never hang the worker forever, never default-allow.
- Deadlock guard: the approval path must never route through a blocked `fleet_wait` caller's own pending turn. Concretely: approvals are answerable by *any* northbound client at any time, and `fleet_wait` returns approval requests as wait-results rather than requiring a separate subscription. (This is the deadlock OpenAI's single-flight broker structurally avoids by allowing cross-socket `turn/interrupt`; we generalize the exception into the design.)

## 6. The steering philosophy (a position, not just mechanics)

Steering exists to correct *pathology*, not to co-author. A worker harness is valuable precisely because it is autonomous — micromanaging it mid-turn re-serializes the work and buys the worst of both worlds (doc 06 develops this). The intended cadence:

1. **Brief well** (doc 06 §context): goal, constraints, path scope, verification command, budget, definition-of-done.
2. **Let it cook.** Watch derived signals, not deltas.
3. **Intervene on signal**: budget threshold → nudge to wrap up; loop-suspected → steer with the missing insight or interrupt with a narrower brief; scope drift → pause + inspect diff; stall → health-check, then interrupt.
4. **Judge results by artifacts**: run the brief's verification command against the worker's diff; never accept "done" on the worker's say-so.

Anti-pattern to refuse in the tool design: a `fleet_chat` verb. If the orchestrator wants a conversation, that's `nudge`/turn boundaries; making mid-turn chat cheap invites the pathology.

## 7. Human seat

The dashboard (TUI first — `baton top`; web later) tails the same ledger and wields the same verbs through the same hub API, so nothing the human does is invisible to the orchestrator or vice versa. Attach/detach per worker; replay any session from JSONL (step through events); the "takeover" move — human converts a worker to interactive control (drops to the harness's own TUI via session resume: `codex resume <thread>` / `claude --resume <session>`) — is the escape hatch that makes people trust the system. Takeover emits `control.*` events and (optionally) suspends orchestrator control verbs on that worker until released.
