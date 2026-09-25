# Red-Team — Steered & Interruptible Subordination

*Focused adversarial review of the specific capability the user flagged: can an orchestrator harness reliably **stop** and **redirect** a subordinate worker harness? Six attack classes, each scenario constructed by an attacker agent and ruled by an independent verifier against verified API ground truth (`codex app-server` 0.144.0 schema, Claude Agent SDK semantics). Full transcripts in the workflow journal; this is the curated finding set. Dispositions feed `docs/09-revision-log.md` §A/§B/§E.*

## The one-sentence answer

**Subordination is not a property you get from the control verbs; it is a property the non-LLM supervisor enforces — and only for effects baton mediates.** An orchestrator can reliably stop a worker's *baton-visible* activity within a bounded window; it cannot un-ring a side effect the worker already committed to the outside world (a `git push`, a DB migration, a webhook), and it cannot compel a non-cooperative worker to *obey* a steer — only to receive it. The design's job is to make the mediated part reliable and the unmediated part *visible*, never to pretend the unmediated part is controlled.

## Confirmed-exploitable findings (ruled against real API semantics)

### Interruption
- **The ack illusion (catastrophic).** `turn/interrupt` returns `{}` before work stops; the turn unwinds async. An orchestrator that treats the ack as "stopped" respawns or merges into a worktree whose previous occupant is still running `db:migrate`/`git push`. Danger window = residual runtime of the in-flight tool child (1–10s for a push, 30–300s for a suite, unbounded for a hung command). → **Two-phase interrupt** (`unwinding`→`interrupt.confirmed` on `turn/completed(cancelled)`) + **worktree leases with fencing**. Residual: external side effects escape every worktree fence.
- **`still_queued` necromancy (catastrophic).** A queued nudge survives Claude's `interrupt()`; the interrupt's `then` message and the zombie nudge co-start the next turn → the interrupt becomes a *go* signal for the action it was meant to prevent. → **interrupt flushes the nudge queue**; adapter-owned outbox as a MUST; `fleet_revoke`; side-effecting imperatives are tasks, not nudges.
- **Interrupt has no latency SLO / priority (serious).** No priority lane; backoff-on-busy has no interrupt carve-out despite the design relying on OpenAI's broker cross-client-interrupt exception. → priority lane + carve-out; the dominant term is *detection* latency → hub-side watchdog (below).
- **Kill is a sequence, not `thread/archive` (serious).** `thread/archive` moves logs; it doesn't stop a turn, a background terminal, or the process. SIGKILL truncates the transcript tail; "transcript preserved" is false under SIGKILL. → documented kill quiesce protocol (T1≥120s → SIGTERM → T2≥15s → SIGKILL, each a `control.*` event) + post-kill integrity pass before merge.

### Steering
- **Queue-only `turn/steer` lets the committed tool batch run after a "successful" steer (catastrophic-conditional).** `turn/steer`'s behavioral semantics are *unverified*; if it queues, the in-flight `rm`/`push` still executes. → effect-receipt Ack (`applied_after_seq` + `inflight_items[]`); **M0 must test steer timing before the card claims `steer:native`**.
- **Emulated-steer on Claude loses the race to a surviving nudge, and wakes the worker mid-surgery (catastrophic/serious).** Interrupt+reprompt discards correct in-flight work with no reconciliation. → fail-closed degrade (DROP a steer whose turn already ended; never silent-convert to a stale next-task prefix); reconciliation preamble; card verb-structs declaring `preserves_inflight_work`.
- **Steer doesn't invalidate a pending approval (serious).** A human later approves a command the steer called off. → hub rejects `fleet_send(steer)` to a worker blocked on an unresolved approval; steer fences the approval.
- **Delivery ≠ compliance (serious).** A worker can receive a steer and rationally ignore it mid-plan. → **constraint-bearing steers** with a hub-side watch emitting `health.steer_noncompliance`.

### Approval-as-control-plane & ownership
- **Interrupt can hang on an un-drained approval (serious).** A worker blocked on an approval when cancelled hangs unless answered `cancel`. → drain-approvals as a precondition step of interrupt/kill.
- **Consumable-approval roulette (catastrophic — arbitrary command).** Human `deny` and orchestrator/timeout `accept` race one consumable approval; no single-consumer ownership. → supervisor **I2** single-consumer CAS; interrupt fences pending approvals; double-answer returns the original decision, not an error.
- **The nested-approval padlock (catastrophic, unattended).** Codex-orchestrator's own `fleet_interrupt`/`fleet_kill` may need human approval → an unattended fleet has no working stop verb; the looping worker burns ~10³–10⁴ executions overnight. → annotate control tools auto-approvable + ship host-allowlist config; out-of-band human path; **liveness preflight** (refuse unattended mode until a `fleet_interrupt` canary round-trips un-prompted); **promote budget-hard-stop + loop-auto-interrupt from M2 into an M1 hub-side watchdog that needs no model turn.**
- **Ownership races (catastrophic).** Human takeover (epoch N) vs stale orchestrator op (epoch N-1); both individually valid; the "paused" worker executes. → supervisor **I1** fencing tokens; **turn-scoped** fencing promoted from later to now.

### Adversarial / non-cooperative worker (the deepest)
- **Result-contract injection (catastrophic).** A worker forges its own `{command, exit, tail}` verification block and a fake "untrusted worker output" provenance frame. → **the hub re-runs verification independently in the worker's sandbox; worker-reported exit codes are never trusted; provenance framing is hub-applied, not worker-quotable.** New doc 04 principle: *worker prose is non-authoritative; only independently re-run evidence counts.*
- **Approved-benign command detonates a pre-staged side effect (catastrophic).** The command the human approves is benign; harm was staged earlier. → OS-sandbox-as-boundary (below); the string policy is a tripwire, not the gate.
- **The plausible-progress spinner (serious).** A worker emits plausible events so stall/loop detection never fires while making no real progress. → derived signals must include *semantic* progress (diff toward DoD, verification trend), not just event liveness. Honest residual: no clean fix.
- **The policy engine is defeated by attacker-controlled command text (catastrophic-conditional).** String allowlist/denylist is evadable. → **the OS sandbox is the authorization boundary (Codex `sandboxPolicy` / Claude `permissionMode` confine writes to the worktree; scope escapes are kernel-denied); policy may only tighten, never substitute for, the harness gate.**

## What the red-team *validated*

Repeatedly, verifiers ruled attacks built against `docs/05` alone as "closed by `spec/supervisor-state-machine.md`." The supervisor's I1 (fencing), I2 (single-consumer approvals), I3 (durable cursors), I4 (bounded poll), I5 (out-of-band human path), and I6 (two-phase stop) are the load-bearing defenses, and they held. The refinements the red-team forced — **at-least-once cursors, turn-scoped fencing now, drain-approvals precondition, worker-verification independence, OS-sandbox-as-boundary, and "amendment is loud"** — are folded into the spec and doc 09.

## The honest residual (things no mechanism fixes)

1. **External side effects escape all fences.** A worker that `git push`ed or ran a migration before interrupt has changed a world baton doesn't own. Mitigation is *visibility* (report "command X spawned 40ms before interrupt landed"), not prevention. The only real defense is keeping side-effecting operations behind approval gates and out of nudges — a convention, weakly enforceable.
2. **Compliance is not compellable.** A different-vendor model mid-plan may rationally decline a steer. Baton can *detect* non-compliance and escalate to interrupt; it cannot make a subordinate obey. "Subordination" is bounded by the worker's cooperation; against a confused or injected worker, the guarantee degrades to "stoppable," not "steerable."
3. **SIGKILL is non-cooperative by definition.** Generous grace periods reduce how often you reach it; nothing makes it consistent.
4. **A model in the stop path adds irreducible latency.** Only the hub-side watchdog (no model turn) removes it, trading false-positive interrupts for speed.

These residuals are not defeats — they are the true shape of the capability. Baton should *claim exactly this much*: reliable, bounded, visible stopping of mediated activity; best-effort steering with verified compliance-or-escalation; and explicit, logged acknowledgement that the unmediated world is beyond its fence.
