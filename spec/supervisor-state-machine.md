# Supervisor State Machine (v0 draft — for review)

*The durable, deterministic, NON-LLM control plane. Written in direct response to the Codex external review's two top risks — "`fleet_wait` is not an event loop" and "there is no real concurrency-control model" — and to the user's ask to tie the design to practical implementation. The governing principle: **the LLM orchestrator must not be in the liveness-critical path.** Steering and interruption reliability (the user's red-team target) is a property of THIS layer, not of the model's good intentions.*

## 0. Why this layer exists

The design docs (00–08) put an LLM in a loop with workers via MCP `fleet_wait`. The Codex review correctly demolished the naïve form: an MCP tool call has a ~60s host timeout, so a 300s long-poll dies; cancellation can lose the cursor; a worker's urgent approval arriving while the orchestrator is *not* in a `fleet_wait` (or is mid-turn) has nowhere to land; and "human > orchestrator" via idempotency keys is not a concurrency model. Every one of these is a **liveness or safety property that cannot depend on a stochastic model choosing to poll at the right moment.** So we interpose a boring, testable, always-running supervisor. The LLM *drives*; the supervisor *guarantees*.

Analogy that keeps the boundary honest: the orchestrator is a pilot; the supervisor is fly-by-wire. The pilot commands; the flight computer enforces envelopes, holds attitude when hands are off the stick, and never lets a single input put the aircraft somewhere unrecoverable. You do not implement flight control in the pilot.

## 1. Objects and invariants

```
Worker      = { id, adapter, session_ref, epoch, lease, status, concurrency_class }
Lease       = { holder: 'supervisor', fence: u64, expires_at }        // fence increments on every takeover/epoch bump
Control op  = { op, worker_id, fence, idem_key, actor, issued_seq }   // fence REQUIRED
Inbox/Outbox= append-only per worker; cursor-addressed; durable (JSONL + fsync barrier)
Approval    = { id, worker_id, kind, payload, state, deadline, consumer }  // single-consumer, consumable
```

Invariants the supervisor enforces (these are the spec — everything else is mechanism):

- **I1 (Fencing).** Every control op carries the `fence` it was issued against. The supervisor rejects any op whose `fence` < the worker's current `fence`. This is how "human > orchestrator" actually works: a human takeover bumps the fence; the stale orchestrator op that was valid a second ago is now rejected with `stale_fence{current}`. Idempotency keys dedupe; **fences order**. (Codex risk #2; red-team `ownership-concurrency` A-class.)
- **I2 (Single-consumer approvals).** An approval is delivered to exactly one consumer and answered exactly once; a `serverRequest/resolved`-style event closes it. Double-answer is a no-op returning the original resolution. Answerable by ANY attached client (orchestrator OR human seat), so a dead `fleet_wait` waiter never strands it. (Codex risk #1/#2.)
- **I3 (Durable cursors).** A read cursor is reserved and persisted BEFORE any data is returned to a caller. A cancelled/timed-out `fleet_wait` therefore never loses position — the next call resumes at the reserved cursor. (Codex risk #1.)
- **I4 (Bounded blocking).** No supervisor→orchestrator call blocks longer than `HOST_SAFE_MS` (default 25_000, must be < the host MCP timeout). It returns `{events?, cursor, more: bool}` — empty-but-valid if nothing happened. The orchestrator re-calls; this is a *bounded poll loop*, not a long-poll. (Codex risk #1.)
- **I5 (Out-of-band human path).** Human notification (approval needed, budget alarm, stall) fires through a channel independent of the orchestrator's turn — the supervisor's own notifier (webhook/push/TUI), never *through* the model. An absent or wedged orchestrator cannot strand a worker. (Codex risk #1; docs 05 §5.)
- **I6 (Two-phase stop).** `interrupt`/`kill` are request→confirm. The op is not "done" until the supervisor observes the worker's authoritative stop event (Codex `turn/completed`-after-interrupt; Claude interrupt receipt reconciled against `still_queued`). Until then the worker is `stopping`, not `idle`. (Red-team `interrupt-liveness`.)

## 2. Worker lifecycle (the state machine)

```
                 spawn                 turn/start                 turn ends
   (none) ─────────────► idle ───────────────► working ───────────────► idle
                          │                      │  ▲                     │
              resume/fork │           interrupt  │  │ steer(native)       │ nudge queued
                          │        (two-phase)   ▼  │                     ▼
                          │                   stopping ──confirmed──► idle (was-cancelled)
                          │                      │
              approval    ▼                      ▼  outstanding approval on cancel
   working ──request──► blocked ◄────────────────┘  → supervisor auto-answers 'cancel' (I2/I6)
     ▲                    │ answer (policy/orch/human, single-consumer)
     └────────────────────┘
   any state ── lease expiry / crash ──► orphaned ──reap──► (respawn|resume|dead)
```

State transitions are the ONLY places control ops take effect, and each checks the fence (I1). Notable edges:

- **working → stopping** on `interrupt`: supervisor sends the adapter's native interrupt, marks `stopping`, starts a `STOP_DEADLINE` timer. On the worker's confirmed stop event → `idle(was-cancelled)`. On deadline → escalate (SIGTERM→SIGKILL for process adapters; alarm for daemon adapters) and record a `health.forced_stop`. **The danger window between ack and confirmed stop is first-class state, not a gap.** (Red-team A: worker still writing files after interrupt ack — the mitigation is that baton does not report the worker as safe-to-merge until `stopping→idle` is confirmed AND the worktree diff is re-read.)
- **blocked → working** only via a single-consumer approval answer. If the turn is cancelled while `blocked`, the supervisor MUST emit the `cancel` answer to the outstanding approval before completing the interrupt (I2+I6), or the worker hangs.
- **steer while working**: if the adapter card says `steer:native` (Codex `turn/steer`, pending M0 behavioral verification), forward it with the fence. If `steer:emulated` (Claude), the supervisor does NOT silently interrupt+reprompt — it returns `Ack{emulated:true, will_discard_inflight:true}` so the orchestrator *chooses* whether the in-flight work is worth preserving. **Emulation is surfaced, never hidden** (adapter-contract rule; red-team `steer-correctness` A: orchestrator can't tell native from emulated → fixed by making the Ack say so).

## 3. The event-loop bridge, done correctly

Two independent flows, never multiplexed through one blocking call:

**(a) Orchestrator poll loop** — `fleet_wait(cursor, classes?, HOST_SAFE_MS)`:
- Reserves+persists the next cursor (I3) before returning.
- Blocks up to `HOST_SAFE_MS` (I4) OR until a matching event lands, whichever first.
- Returns `{events: [...digest...], cursor, more}`; the orchestrator immediately re-calls with `cursor`. A 10-minute fleet run = ~24 bounded calls, none exceeding the host timeout, none losing position if the host cancels one.
- `classes` lets the orchestrator subscribe to a priority lane only (e.g. `['control','health']`) so approvals/lifecycle are never stuck behind a delta flood (I-priority, §4).

**(b) Approval/human path** — never depends on (a):
- When a worker enters `blocked`, the supervisor (1) tries the deterministic policy engine (instant allow/deny for allowlisted/denylisted ops), (2) if it escalates, enqueues the approval in the priority lane AND fires the out-of-band human notifier (I5), (3) starts the approval `deadline` timer.
- The approval is answerable by the orchestrator's next `fleet_wait` (it appears in the `control` class) OR by the human seat directly OR, on deadline, by the supervisor's default (`deny-with-message`, never default-allow). Single-consumer (I2) means whoever answers first wins and the rest see the resolution.
- **This is why a dead waiter doesn't strand a worker**: the approval's liveness is owned by the supervisor's timer, not the orchestrator's poll.

## 4. Backpressure & priority (Codex risk #4)

The supervisor drains each worker's adapter stream on its own bounded queue; it NEVER blocks reading child stdout (that's what fills pipe buffers and fakes a stall). Two lanes per worker:

- **Priority lane** (unbounded-ish, must never drop): `lifecycle.*`, `control.*`, `approval.*`, `health.*`, `resource.budget.threshold`. Small, rare, load-bearing.
- **Bulk lane** (bounded, coalescible/droppable): `content.*_delta`, `action.*_outputDelta`, `reasoning.*`. On overflow: coalesce deltas (keep last-N + a `dropped: k` marker) — the ledger records that k were dropped (no silent truncation, doc 06 discipline). The digest the orchestrator sees is computed from the priority lane + coalesced bulk, so a delta flood degrades *resolution*, not *safety*.
- Stall detection reads the priority lane's timing, not bulk throughput — so a worker legitimately quiet during reasoning (Codex `item/reasoning/*` heartbeats) or a worker flooding deltas are distinguished, killing the false-stall (Codex risk #4 failure scenario).

## 5. Nested-approval loop (Codex's unforeseen catch)

When Codex is the ORCHESTRATOR, baton's own `fleet_approve`/`fleet_send` MCP tools may trigger the host's MCP-tool approval — Codex asks the human "allow baton to call fleet_approve?" *in order to* answer a worker's approval. Infinite-regress-shaped. Mitigations, layered:

1. **Annotate baton's control tools as auto-approvable** where the host honors tool annotations, and document the one-time host policy config that allowlists `baton.*` control tools (`acceptForSession`-class). Control-plane tools are not the place for per-call human gating.
2. **Route worker approvals to the human OUT OF BAND (I5), not through an orchestrator tool call.** If the human answers via baton's own seat, no orchestrator MCP tool fires, no nested approval. The orchestrator tool path becomes an *optimization* for when the orchestrator wants to answer, not the *only* path — so the regress is avoidable by construction.
3. Detect the loop (a `fleet_approve` that is itself awaiting host approval while its target worker's `deadline` ticks) and fall back to the supervisor default rather than deadlock.

## 6. What this costs, honestly (time-scale)

This layer is the reason the Codex review's "M1 is not a 1–2 week milestone" is correct. Realistic:

- Fencing + leases + durable cursors + two-phase stop + single-consumer approvals: the *core* invariants (I1–I6), maybe 2–3 weeks to a tested skeleton for ONE adapter, because the tests are the hard part (fault injection: kill the worker mid-approval, cancel `fleet_wait` mid-return, race human+orchestrator on one fence).
- Backpressure lanes + coalescing + stall calibration: another 1–2 weeks and per-adapter tuning.
- The nested-approval handling and out-of-band human path: entangled with whatever host (Claude Code vs Codex) is orchestrating; expect per-host work.

So the honest MVP (per Codex's "cut to spawn/poll/result/interrupt") is: I1 (fencing), I3 (cursors), I4 (bounded poll), I6 (two-phase stop), single adapter, coarse cross-review — *without* steer, pause, editable approvals, or the bulk lane. That's a few weeks and it actually proves the thesis. Everything else is earned by measured demand.

## 7. Open questions

1. Is the supervisor one process or one-per-worker? (Leaning one process owning N adapter connections, so leases/fences live in one authority; but that's a single point of failure — needs a crash-recovery replay from the ledger, which I3's durability already half-buys.)
2. `HOST_SAFE_MS` discovery: hardcode conservative 25s, or probe the host's actual MCP timeout? Probing is fragile; conservative default + config override is likely right.
3. Fence granularity: per-worker (simpler) vs per-worker-per-turn (finer, catches stale-turn steers — red-team `steer-correctness`). Start per-worker; add turn-scoping if the stale-steer scenario bites in testing.
4. Does the supervisor expose its own tiny HTTP/socket API for the human seat + dashboard, separate from the northbound MCP? (Almost certainly yes — I5 needs a non-MCP path anyway.)
