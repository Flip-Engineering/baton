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

> **Corrected in review round 1 (docs/09 §A/§B).** The original table over-promised on `steer`, `pause`, and `kill` against the real APIs. Corrected rows below; every control op is enforced by the non-LLM supervisor (`spec/supervisor-state-machine.md`), not by model good-will. See `reviews/steering-interruption-redteam.md` for the attacks that forced each change.

| Verb | Semantics | Codex | Claude Code |
|---|---|---|---|
| `nudge` | Queue message; delivered at a chosen boundary (`at=next_turn` default, or `at=tool_boundary` for urgent/budget). Lives in the **adapter outbox**, NEVER written to CLI stdin mid-turn. Interrupt flushes the queue (voided IDs listed in the ack). | outbox → `turn/start`, or `thread/inject_items` at tool boundary | outbox → next stdin msg, or PreToolUse injection |
| `steer` | Redirect the in-flight turn. **Ack is an effect-receipt**: `{recipe_used, work_preservation: yes\|no\|partial, applied_after_seq, inflight_items[]}` — the orchestrator learns what its steer preserved *and* what already committed. Rejected if the worker is blocked on an unresolved approval. | `turn/steer` — **timing unverified; card may not claim `native` until M0 tests it**; if queue-only, `inflight_items[]` warns of the committed batch | emulated (`interrupt`+reprompt or PreToolUse rewrite); discards in-flight work → `work_preservation:no`, mandatory reconciliation preamble |
| `interrupt` | **Two-phase.** Returns `{state:"unwinding", interrupt_id}`; `control.interrupt.confirmed` emitted only on the worker's authoritative stop (`turn/completed(cancelled)` / reconciled interrupt receipt). Drains outstanding approvals (`cancel`) as a precondition. Unwind-timeout → kill sequence. Optional `then` starts the next turn. | `turn/interrupt` (returns `{}` async — the `{}` is NOT "stopped") | SDK `interrupt()`; reconcile `still_queued` |
| `pause` / `resume` | **Emulated, declared per-card — NOT a native tool-boundary hold.** Codex has no universal approval boundary (`acceptForSession` + non-command tools pass through), so `pause`=`interrupt`→hold→resume (in-flight work lost, `emulated:true`), or use `fleet_freeze` (interrupt→confirmed-unwound→snapshot worktree→pinned ref) for inspection. | `pause: emulated(interrupt)` / `fleet_freeze` | `pause: emulated(hook)` — PreToolUse deferral genuinely holds |
| `kill` | **A sequence, not one call.** interrupt → terminate background terminals → close thread → stop/clean the process → **verify death** (`pgrep` process tree) → `lifecycle.exited`. Quiesce: grace T1≥120s → SIGTERM → T2≥15s → SIGKILL, each escalation a `control.*` event. | `turn/interrupt` + terminals + `thread/archive` (**archive ≠ kill**) + process mgmt | SIGTERM→SIGKILL; transcript preserved **through SIGTERM, best-effort under SIGKILL** |

Race rules (write them down or debug them forever):
- `steer` racing `turn_completed`: **fail-closed** — if the turn ends first, the steer is **DROPPED** (never silently converted to a stale next-turn prefix) and the ack says "not applied; resend as nudge if still valid." Forces re-decision with fresh information.
- **Turn-scoped fencing:** every control op carries `(worker, turn_epoch)`; the supervisor bumps `turn_epoch` on each `turn/start` and rejects stale-epoch ops. Idempotency keys *dedupe*; fences *order* (supervisor I1). Human takeover bumps the fence, so a stale orchestrator op is rejected `stale_fence{current}`.
- Control ops are themselves events in the ledger (`control.*` with `actor`) — **"no invisible hand" is a system invariant** (doc 04 principle 3), not just a telemetry nicety. A human steering the orchestrator's worker is visible to the orchestrator and vice versa.
- Conflict rule: human > orchestrator > policy defaults, enforced by fence precedence, not politeness. A human `pause` cannot be overridden by an orchestrator `resume`; the orchestrator gets a `policy.blocked` event explaining why.
- **Amendment is loud:** any approval-edit / `updatedInput` / `updatedToolOutput` carries an in-band, worker-perceivable note ("baton amended your command: <diff>; reason: <r>"). Silent edits poison the worker's belief state (doc 09 §E, C5).

## 5. Approval routing (the permission chain)

Worker approval requests (Codex server-requests; Claude canUseTool) flow: **policy engine → orchestrator → human**, with per-stage timeouts.

> **Corrected in review round 1 (docs/09 §C).** The original framing made a string-matching policy engine the authorization boundary. It is not — it is a tripwire. **The OS sandbox is the boundary.**

- **The OS sandbox is the authorization boundary, not the policy engine.** Set Codex `sandboxPolicy` / Claude `permissionMode` so writes are confined to the worker's worktree and scope escapes are *kernel-denied*. Attacker-crafted command text cannot evade a kernel confinement the way it evades a string allowlist (doc 09 §C3, red-team A6). The deterministic policy engine may only **tighten** this, never substitute for it: it answers allowlisted/denylisted cases instantly and **logs** everything as a tripwire, but a policy "allow" is legal only *inside* the confined sandbox.
- **Approvals are single-consumer, answered exactly once** (supervisor I2). A hub-side arbiter CAS's each `request_id` `open→resolved{by,decision,epoch}`; the first committed answer is the only wire-send to the harness; losers get `already_resolved{winner}` (a success carrying the original decision, never an error). Every answerer — human `fleet_respond`, orchestrator, policy, adapter auto-cancel — routes through this one point.
- Escalation to orchestrator: surfaces in `fleet_wait` as an attention item; orchestrator answers via `fleet_respond` (decision `allow|allow_session|deny|deny_and_interrupt`, or `answer` to a worker `question`). **`edit` is capability-gated, not universal:** on Claude it's native (`updatedInput`, with a loud note); on Codex there is *no edit-the-command option* — `edit` maps to `decline + steer` with the ack reporting `outcome: declined_and_resteered`, plus a ledger watch verifying the worker complied (doc 09 §D3).
- Escalation to human: **out-of-band notification** through the supervisor's own notifier (webhook/push/TUI), never *through* the orchestrator's turn (supervisor I5) — so an absent/wedged orchestrator can't strand a worker. On timeout, **deny-with-message licensing `status=blocked`** ("no approver available; return status=blocked with what you needed, or continue read-only") — never hang forever, never default-allow.
- Deadlock guard: approvals are answerable by *any* attached client at any time and are **never scoped away by a `worker_ids` filter on `fleet_wait`**; their liveness is owned by the supervisor's timer, not any orchestrator poll. (Generalizes OpenAI's broker cross-socket `turn/interrupt` exception; see supervisor §5 for the nested-approval-loop handling when Codex is the orchestrator.)

## 6. The steering philosophy (a position, not just mechanics)

Steering exists to correct *pathology*, not to co-author. A worker harness is valuable precisely because it is autonomous — micromanaging it mid-turn re-serializes the work and buys the worst of both worlds (doc 06 develops this). The intended cadence:

1. **Brief well** (doc 06 §context): goal, constraints, path scope, verification command, budget, definition-of-done.
2. **Let it cook.** Watch derived signals, not deltas.
3. **Intervene on signal**: budget threshold → nudge to wrap up; loop-suspected → steer with the missing insight or interrupt with a narrower brief; scope drift → pause + inspect diff; stall → health-check, then interrupt.
4. **Judge results by artifacts**: run the brief's verification command against the worker's diff; never accept "done" on the worker's say-so.

Anti-pattern to refuse in the tool design: a `fleet_chat` verb. If the orchestrator wants a conversation, that's `nudge`/turn boundaries; making mid-turn chat cheap invites the pathology.

## 7. Human seat

The dashboard (TUI first — `baton top`; web later) tails the same ledger and wields the same verbs through the same hub API, so nothing the human does is invisible to the orchestrator or vice versa. Attach/detach per worker; replay any session from JSONL (step through events); the "takeover" move — human converts a worker to interactive control (drops to the harness's own TUI via session resume: `codex resume <thread>` / `claude --resume <session>`) — is the escape hatch that makes people trust the system. Takeover emits `control.*` events and (optionally) suspends orchestrator control verbs on that worker until released.
