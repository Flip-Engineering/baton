# Max-campaign stream: hitl-operator

## DESIGN
# The Operator Plane: Designing baton for the Human Agent

*How the person running a cross-vendor fleet keeps the plot, debugs intent, earns their way to autonomy, seizes control when they must, and learns to brief better — all without a second source of truth. This designs the surfaces named in doc 14 #16–20, #5 and doc 05 §7, and folds them into one plane that mirrors, for the human, the exact discipline baton already applies to the orchestrator's context.*

---

## 0. The problem, precisely

The corpus already names the operator as an agent with a scarce context window (their attention) and a harness (the tooling) — doc 14 #16, and the closing conviction of doc 14 ("the operator's [scarcest resource] is the plot"). But the design stops at `baton top` (doc 05 §7): a TUI grid tailing the ledger. A grid is a *dashboard*, and the dominant DX failure of every multi-agent system is not "I can't see the metrics" — it is **loss of the plot**: the operator can see five workers' statuses and still not know what the fleet is collectively doing or whether it's on track, because reconstructing the *story* from telemetry is work they must redo on every glance.

Six sub-problems fall out, each a place adoption lives or dies:

1. **Narrative, not dashboard** (#16) — the operator needs a continuously-updated, provenance-linked *story*, generated from the ledger, not a wall of dials.
2. **Debugging intent, not action** (#17) — the ledger records `interrupt w3`; the operator's real question is *why did the orchestrator decide that*, and the reasoning is ephemeral.
3. **Graduated autonomy** (#18) — nobody hands an autonomous cross-vendor fleet the keys on day one; the trust ramp *is* the onboarding funnel, and baton has a policy engine but not the ramp.
4. **The takeover seat + preemption UX** (doc 05 §7) — the escape hatch that earns trust: resume a worker in its own TUI, and make the `human > orchestrator > worker` authority gradient legible.
5. **Worker dignity from the operator's side** (#5) — a worker's decline or counter-proposal is the fleet's most valuable signal and the design buries it as a failure.
6. **Time-travel & counterfactual replay** (#20) — latent in the ledger; the way an operator *learns to brief better*.

### The design spine (one commitment that generates the rest)

**The operator plane is a projection-and-control layer over the one ledger — never a second source of truth.** Every surface below is *derived* from the append-only `BatonEvent` stream (doc 05 §1); every operator *action* is a fenced control op that enters that same ledger with `actor: human` (doc 05 §4). This is not a nicety — it is forced by three invariants the corpus already earned:

- **No invisible hand** (doc 04 principle 3, doc 09 S): a human steering a worker must be visible to the orchestrator and vice versa. So the operator cannot have a private channel; their acts are ledger events.
- **The Referee runs on facts, not the story** (doc 13 meta-finding; doc 15 §0 — Referee is the trust spine *inside* the Conductor). The narrative is a *lens* for the human's attention; it must never become an authority. No merge, verdict, or I7 gate ever reads the prose. The ledger's hub-computed `facts` are truth; the narrative is a subtractive projection of them.
- **Subtraction under a moving frontier** (doc 14, closing). The operator plane's whole job is to *remove* demands on the operator's attention — hand them the story and hide the grid, and *remove them from the loop entirely* as trust is earned. Every mechanism below is measured by attention it *subtracts*, not features it adds.

Architecturally the plane is a **client of the supervisor's own socket API** (supervisor open-Q #4 — "almost certainly yes; I5 needs a non-MCP path anyway"), separate from the northbound MCP. It tails the same JSONL+SQLite ledger the orchestrator reads through `fleet_wait`, and it writes through the same fence-checked verbs. It *is* the human seat of doc 05 §7, specified in full.

The unifying primitive that makes "since I last looked" work everywhere: the operator gets a **durable read-cursor** into the ledger, exactly the orchestrator's I3 cursor. Every "what changed" is computed against it.

```
Operator plane = read(ledger)  →  derive(narrative, intent-trace, autonomy-evidence, timeline)
               + write(fenced control ops, actor:human)  →  ledger
```

Below, each surface is the human's mirror of a mechanism the orchestrator already has. That symmetry is the design.

| Orchestrator-facing mechanism | Operator-facing mirror |
|---|---|
| `digest` (comms §6): attention/facts/prose | **Narrative** (§1): storylines/beats/since-cursor |
| Derived signals (05 §2): loop/stall/budget/drift | Beat classifier + storyline health |
| Control op + `actor` (05 §4) | + **`rationale`/`trigger_ref`** → **intent-trace** (§2) |
| Policy engine (05 §5) — tripwire in the sandbox | **Autonomy ramp** (§3) — moves *attention* boundary, never authorization |
| Two-phase stop I6; fence I1 | **Two-phase takeover**; preemption menu (§4) |
| `ask`/`question` (comms §4) | **`decline`/`counter_propose`** → pushback items (§5) |
| Ledger replay (09 F2) | **`operator_scrub` / `operator_counterfactual`** (§6) |

---

## 1. The Narrative

### 1.1 Problem

`baton top` shows fleet *state*. The operator wants fleet *story*: "3 workers are implementing the auth refactor; w2 is blocked on a test that looks flaky; the orchestrator just rerouted w4 after Codex declined the migration" (doc 14 #16). A metrics grid forces the operator to re-derive that sentence from telemetry every glance; a narrative hands it to them and keeps it current.

Two constraints make this hard *and* make it honest:

- **No narration tax** (doc 14 #4). The narrative must be *derived from artifacts the fleet produces anyway* — control ops, lifecycle events, diffstats, exit codes, the `rationale` field — never from prose the worker or orchestrator must generate *for the watchers*. An agent that narrates for the gallery optimizes for the narration. So a *cheap summarizer* renders prose *from* facts; the working agents never pay.
- **Prose is untrusted** (comms §6, doc 09 §D4). Worker-authored prose, if surfaced at all, is delimiter-wrapped and marked `untrusted`. The default narrative is built entirely from hub-computed `facts`.

### 1.2 Mechanism: the plot model

The narrative is not regenerated on each glance (expensive, and it would drift). It is an **incrementally-maintained materialized view** — a *plot model* — updated by a cheap local model as beat-worthy events land, and folded into storylines. This is the incremental-summarization pattern (Redux-DevTools-style folding of an append-only event log; Temporal's replay-from-history), applied to a fleet.

**The atomic unit is a `beat`** — a typed, provenance-linked micro-event in the story:

```jsonc
{
  "beat_id": "b_2291",
  "seq_range": [4172, 4180],          // ledger events this beat summarizes — the provenance link
  "ts": "2026-07-09T18:22:31Z",
  "storyline": "sl_auth",
  "kind": "progress | risk | decision | pushback | anomaly | resolution",
  "text": "w2 hit its 3rd near-identical failure on tests/test_auth.py — loop suspected.",
  "sourced_from": "facts",            // facts (hub-computed, trusted) | prose (untrusted, wrapped)
  "actor": "worker | orchestrator | human | policy"
}
```

**A `storyline`** is a subtree of the task-DAG (doc 08 §3a) — the natural decomposition the orchestrator already produced. Workers map to DAG nodes; a storyline groups the workers under one goal:

```jsonc
{
  "id": "sl_auth",
  "title": "Auth refactor",
  "goal_ref": "task:auth_refactor",
  "workers": ["w1", "w2"],
  "state": "on_track | at_risk | blocked | done | abandoned",
  "current": "Nearly done; w2 stuck on a test that looks flaky.",   // the one-line where-we-stand
  "beats": ["b_2288", "b_2291", ...]
}
```

**`NarrativeState`** is the whole view the operator reads:

```jsonc
{
  "as_of_seq": 8842,
  "fleet_goal": { "text": "Ship the auth refactor behind a flag",
                  "source": "operator-pinned",              // or orchestrator-declared
                  "provenance": [12] },
  "storylines": [ /* ... */ ],
  "attention": [ /* the priority lane, ordered first: pushback, approvals, blocked, alarms */ ],
  "since": { "from_cursor": "c_op_771", "new_beats": ["b_2290","b_2291"] }  // "what changed since you last looked"
}
```

### 1.3 The beat classifier (aggressive subtraction)

The single biggest way this fails is by re-becoming the dashboard-in-prose: if every event mints a beat, the operator drowns. So a **deterministic classifier** — not the model — decides beat-worthiness, and it is biased hard toward *state changes and threshold crossings only*:

```
beat_worthy(event) =
    event.class ∈ {control.*, lifecycle.spawned/exited/crashed,
                   health.*, resource.budget.threshold_crossed,
                   verification.result (I7 pass/fail),
                   pushback.* (decline/counter_propose)}
 OR event is a derived-signal transition (loop_suspected first-fire, stall onset,
                                          scope_drift onset, cost-shape anomaly)
```

Routine `action.tool_call` / `content.*_delta` / `reasoning.*` events — the bulk lane (supervisor §4) — **never** mint beats. They are exactly the noise the digest already coalesces. A storyline's `current` line and `state` are recomputed from the derived signals (doc 05 §2) the classifier consumes, so "at_risk" is a fact (any member looping / stalled / >80% budget), not a vibe.

Only when a beat is minted does the cheap summarizer run, and it renders text **from the event's structured payload plus the `rationale` field (§2)** — e.g. from `{loop_suspected, tool: pytest, k: 3, target: tests/test_auth.py}` it writes "w2 hit its 3rd near-identical failure on tests/test_auth.py — loop suspected." No worker prose required; the working agents pay nothing (#4 satisfied).

### 1.4 Loss-of-the-plot recovery

The escape hatch for the operator's *own* context: `operator_catchup()` regenerates the `since` delta from the operator's read-cursor forward, and — the valuable move — `operator_recap(storyline)` re-summarizes a whole storyline's beats into a fresh 3-sentence arc when the operator has been away long enough that even the delta is too much. This is the operator's `retract`/compaction (doc 14 #7) — it evicts stale plot from *their* window and hands back a clean summary. Provenance survives compaction: the recap still carries the `seq_range` anchors, so "show me why you say w2 is stuck" jumps straight to the ledger slice and the worktree diff.

---

## 2. Debugging intent, not action

### 2.1 Problem

The ledger records the control op (`control.interrupt{worker: w3}`) but not the *rationale* (`because I misread the digest as a loop`) — and the orchestrator's reasoning is gone the moment the turn ends (doc 14 #17). When the fleet does something dumb, "why did the orchestrator *decide* that?" is unanswerable. This is also what makes the fleet auditable in the way that matters: not "what happened" but "why did the Conductor think that was right."

### 2.2 Mechanism: rationale + trigger, bound to the op

Extend the control-op envelope (supervisor §1) with two fields, captured *at emit time* by whoever issues the op:

```jsonc
Control op = {
  op, worker_id, fence, idem_key, actor, issued_seq,
  "rationale": "digest showed 5 near-identical pytest failures — looks like the edit/test loop; steering with the fixture hint",
  "trigger_ref": 8791          // seq of the derived-signal / event that prompted this op
}
```

- `rationale` is **model-authored → provenance-typed `untrusted`** (it is the orchestrator's *self-report*, subject to the same discipline as any model prose), but it is **non-repudiably bound** to the op's `(fence, issued_seq)` — you cannot rewrite why you did a thing after the fact.
- `trigger_ref` closes the causal loop the operator actually debugs: **signal → rationale → op → effect**. The "effect" is not stored; it's *derived* — the next verification / health / lifecycle event on that worker after the op.

**No narration tax here either.** The orchestrator is *already deciding*; the rationale is the decision stated, not a performance for the gallery. To keep it cheap and only where it pays, `rationale` is a **required, non-empty argument** at the MCP boundary for the *consequential* verbs only — `fleet_send(mode=steer)`, `fleet_interrupt`, `fleet_kill`, `fleet_approve(deny|deny_and_interrupt)`, and reroute/reassign. Nudges, reads, and routine allows require nothing. This is scaffold-WHAT (doc 12/14 #27): you scaffold the *capture of the why*, not *how* the orchestrator reasons.

### 2.3 The intent-trace query

```
operator_why(op_seq) -> {
  trigger:   <event at trigger_ref>,          // "what did it see"  (fact — trusted)
  rationale: <the op's rationale, untrusted>,  // "what it said it thought"
  op:        <the control op>,                 // "what it did"      (fact)
  effect:    <next verification/health/lifecycle on worker after op>  // "what happened" (fact)
}
```

This renders in the narrative as an expandable "why" under any `decision`-kind beat. The operator clicks the beat "orchestrator rerouted w4" and gets: *it saw* Codex's decline (trigger, fact), *it said* "Codex balked at the migration; reassigning to Claude which handled the last three" (rationale, untrusted), *it did* reroute (fact), *and then* w4-claude passed verification (effect, fact). Three of the four legs are hub-facts; only the rationale is the model's word — and that asymmetry is itself diagnostic (§ limits: a rationale that contradicts its own trigger is a red flag the operator can now *see*).

---

## 3. Graduated autonomy — the trust ramp

### 3.1 Problem

The trust journey is dry-run → approve-everything → approve-sampled → autonomous-with-circuit-breakers → autonomous (doc 14 #18). baton has a policy *engine* (doc 05 §5) but not the *ramp as an operator journey* with a graduation criterion and evidence at each step. The system that *earns* autonomy incrementally — and shows the operator the evidence for each increment — is the one people actually deploy.

The prior art to build on and to differ from: Claude Code's `permissionMode` + allowlist (a user graduates specific tools/paths to auto-approve), Cursor's "YOLO" all-or-nothing toggle, Devin's approval gates. The all-or-nothing toggle is the anti-pattern — it forces the operator to choose between babysitting everything and trusting everything. SAE-style *levels* are closer but still global. baton's design is **per-cell**, not per-level.

### 3.2 The load-bearing honesty (state it first, or the whole feature is dangerous)

**The ramp moves the human-attention boundary — what the policy engine auto-answers — and NEVER the authorization boundary, which is the OS sandbox** (doc 05 §5 correction; doc 09 §C3; standing principle). Even at maximal "autonomous," a worker's writes are still kernel-confined to its worktree, and a scope escape is still kernel-denied *regardless of rung*. Graduation only decides whether a *human is in the loop* for an action that is *already inside the sandbox*. This is exactly why graduated autonomy is safe to offer at all: the worst a maximally-trusted cell can do is auto-approve something the kernel would have permitted anyway. Autonomy subtracts operator attention; it grants no new capability.

### 3.3 Mechanism: per-cell rung, evidence-driven promotion, fast-trip breakers

Autonomy is tracked per **`(action_class × scope)` cell**, not globally. You graduate `file_edit in tests/**` independently of `command_exec` or `file_edit in src/auth/**`. This is the granularity at which trust is actually differentiated — an operator trusts the fleet to edit tests long before they trust it to touch payments.

```jsonc
AutonomyCell = {
  "action_class": "file_edit | command_exec | network | merge | spawn",
  "scope": "tests/**",
  "rung": "dry_run | approve_all | approve_sampled | auto_breakered | autonomous",
  "sample_rate": 0.15,                       // approve_sampled only
  "evidence": { "approvals": 48, "denies": 0, "human_overrides": 0,
                "safety_denies": 0, "i7_fails": 0, "since": "2026-07-06" },
  "breaker": { "state": "armed | tripped", "last_trip_ref": null, "reason": null }
}
```

**The rungs, concretely:**

- **`dry_run`** — the fleet *plans* and shows the plan; executes nothing in this cell. The operator reads the intended actions as narrative beats with no side effects. (This is where onboarding starts.)
- **`approve_all`** — every action in the cell escalates to the operator (via the existing policy→orchestrator→human chain, single-consumer I2).
- **`approve_sampled`** — the policy auto-allows-inside-sandbox but surfaces a random `sample_rate` fraction to the operator as *audit* items (answered post-hoc; non-blocking). Sampling is how trust is *verified* without full attention — the operator spot-checks.
- **`auto_breakered`** — auto-allow-inside-sandbox, human out of the loop, **circuit breakers armed** (§3.5).
- **`autonomous`** — as above; breakers still armed (they never disarm), but no routine sampling.

**Promotion is a proposal with evidence, never automatic.** When a cell's evidence crosses a threshold — sufficient sample size, approval-rate above bound, **zero** safety-relevant denies and **zero** I7 verification failures in the window — the supervisor emits an operator attention item (this is the onboarding funnel made concrete):

```jsonc
{ "kind": "autonomy.promotion_proposal",
  "cell": "file_edit @ tests/**",
  "from": "approve_all", "to": "approve_sampled",
  "evidence": "You approved 48 of 48 file edits in tests/** over 3 days; 0 denied, 0 overridden, 0 verification failures.",
  "accept": "operator_autonomy_promote('file_edit@tests/**', 'approve_sampled')",
  "decline": "operator_autonomy_hold(...)" }
```

This is doc 14 #18's exact example ("you've approved 50 of my file edits and rejected 2; shall I stop asking about file edits in `tests/`?"), realized. The human accepts → the policy engine's *default for that one cell* flips from "escalate" to "auto-allow-inside-sandbox." The evidence is always shown; trust is never assumed.

### 3.4 Guarding against gamed graduation (fleet-misalignment, #24)

Approval-rate is game-able: a fleet can converge on the easiest-to-approve interpretation of "done" and rack up approvals for actions that are agreeable but wrong (doc 14 #24 — fleet-level misalignment; the race to the weakest defensible standard). So graduation weights are deliberately asymmetric:

- **A single I7 hub-verification failure in a cell is a hard breaker trip** (§3.5) and *resets the evidence window* — worker-agreeable actions cannot graduate past the one check that isn't worker-adjacent.
- **Human denies/overrides count far more than approvals** toward *withholding* promotion (a 2% override rate blocks graduation even at high approval count).
- Promotion evidence is computed over **hub-facts** (approvals resolved, I7 outcomes, override events), never over worker prose. The Referee, not the story, gates the ramp.

### 3.5 Circuit breakers — the demotion path (trust lost fast)

Trust is earned slowly and lost fast. Any of these trips the breaker on a cell (Nygard's circuit-breaker pattern, `Release It!`):

```
trip(cell) if:
    an action occurs that would have been DENIED at a lower rung, OR
    an I7 hub-verification fails on this cell's work, OR
    a cost-shape anomaly fires (>Nσ over the class median — doc 14 #19), OR
    a scope_drift is detected outside cell.scope (doc 05 §2), OR
    a human override lands during approve_sampled audit
```

On trip: the cell **demotes one rung**, `breaker.state = tripped`, evidence window resets, and an operator attention item fires with the full trigger context. **Re-arming requires explicit operator action** — the breaker does not self-heal, because a self-healing breaker on a safety cell is how the fleet teaches itself the weakest standard (#24 again). Cost-as-signal (#19) is thus not merely a budget event but a *diagnostic that can demote autonomy* — a task that cost 5× its class median is a bug report, and it pulls the human back into the loop for that cell.

**Breaker state machine:**

```
armed ──trip condition──► tripped(rung−1) ──emit attention item──► [wait for operator]
tripped ──operator_autonomy_rearm(cell) [+ optional re-promote]──► armed
```

---

## 4. The takeover seat + preemption UX

### 4.1 Problem

The takeover move — a human converts a worker to interactive control, dropping to the harness's own TUI via session resume (`codex resume <thread>` / `claude --resume <session>`) — is "the escape hatch that makes people trust the system" (doc 05 §7). It is the top of the preemption hierarchy `human > orchestrator > worker` (doc 10 §1a). Two things need design: (a) the *handoff* must be clean — you cannot drop a human into a worker mid-tool-call — and (b) the authority gradient must be *legible*.

### 4.2 Mechanism: two-phase takeover, fenced, reconciled

Takeover mirrors I6's two-phase stop and I1's fence:

```
orchestrator-controlled
     │  operator_takeover(worker, urgency=gentle|emergency, rationale)
     ▼
acquiring   ── gentle: quiesce to next tool boundary (the (a) end of the violence
     │          spectrum, doc 14 #2 — land the agent's thought, don't shred it)
     │       ── emergency: two-phase interrupt (I6) for a runaway worker
     │       ── on quiesce: bump fence (I1), snapshot worktree (fleet_freeze)
     ▼
human-held  ── TUI attached via session resume; orchestrator ops on this worker
     │          now return stale_fence{current} (I1) — the orchestrator CANNOT
     │          fight the human; control.takeover.acquired{actor:human} is in the
     │          ledger, so the takeover is visible to the orchestrator (no invisible hand)
     │  operator_release(worker, reconcile_note, rationale)
     ▼
reconciling ── the human's actions during takeover were ledger events; the supervisor
     │          hands the orchestrator a reconciliation digest ("human edited
     │          src/auth/session.py; rebased; tests green") — symmetric to the
     │          worker-steer reconciliation preamble (doc 05 §4)
     ▼
orchestrator-controlled
```

Three things this gets right that a naive "just attach a terminal" would not:

- **Gentle by default** (doc 14 #2). Default `urgency=gentle` acquires at the next tool boundary — near-zero coherence waste. `emergency` (hard interrupt) is reserved for a genuinely runaway worker. The design reaches for the *gentle* end first, exactly as #2 argues, instead of defaulting to the violent seizure the APIs expose most cleanly.
- **The fence bump makes authority real, not polite** (I1, doc 10 §1a — "interruption authority and fence precedence are the same mechanism"). A human takeover cannot be undone by an orchestrator `resume`; the orchestrator gets `stale_fence`, not a race.
- **Release reconciles.** The human's work isn't lost to the orchestrator's belief state — the orchestrator is re-briefed with what changed, so it doesn't re-litigate the human's fix. This is the same "silent edits poison the worker's belief state" discipline (doc 05 §4, amendment-is-loud) applied to the human→orchestrator direction.

### 4.3 Preemption UX: the intervention ladder mapped to the violence spectrum

Per worker, the operator sees an **authority badge** — who currently holds the fence: `policy` / `orchestrator` / `human` — and an **intervention menu ordered by coherence-cost** (doc 14 #2's violence spectrum), with the cursor defaulting to the *gentlest intervention that addresses the current signal*:

```
w2  [orchestrator]  loop_suspected on tests/test_auth.py (3×)
    ├─ Nudge        "reconsider at your next pause" — near-zero waste   ← default (matches signal)
    ├─ Steer        redirect this turn (Ack shows work_preservation)
    ├─ Gentle-stop  stop at next tool boundary, keep work
    ├─ Interrupt    two-phase stop (I6), plan discarded
    ├─ Take over    drop into codex/claude TUI (this section)
    └─ Kill         terminate + verify death (05 §4)
```

The menu *is* the preemption hierarchy made operable: everything on it flows *down* (human→worker), the human's action always wins the fence, and every item emits a `control.*` event visible to the orchestrator. The operator never has to think about fences; they think about *how hard do I need to intervene*, and the system maps that to the right mechanism. Defaulting to the gentlest effective option is how the plane protects *both* the operator's attention and the worker's coherence.

---

## 5. Worker dignity from the operator's side

### 5.1 Problem

A worker forced into `{completed, failed, blocked}` either over-claims or discards real work (doc 14 #3), and a worker that can only obey wastes the judgment you're paying a frontier harness for (doc 14 #5). The *signal that three workers all balked at a brief is worth more than forcing the third to comply.* From the operator's side, these signals must surface as first-class attention — not as failures buried in a status column.

### 5.2 Mechanism: decline / counter-propose as pushback items

Extend the communication channel's `ask` family (comms §4) with two worker→orchestrator message kinds, and the result contract (comms §5) with graceful partial delivery (#3):

```jsonc
// worker→orch, on the bidirectional comms channel (never worker↔worker)
decline        = { brief_ref, reason, confidence }
counter_propose= { brief_ref, reason, proposed_brief_delta }

// result contract gains texture (doc 14 #3)
result += { "progress": 0.8, "blocker": "specific thing", "salvageable": { "diff_ref": "art:…" } }
```

A `decline`/`counter_propose` surfaces as an attention wait-item of kind **`pushback`** — ordered *first* in the operator's `attention` lane (comms §6), alongside questions and approvals, and rendered as a `pushback`-kind beat in the narrative ("w3 (Codex) declined the migration brief: 'the spec is ambiguous about idempotency'"). It is explicitly **not** a `failed` status. Dignity, operationally, means the decline is *cheap, logged, non-penalized, and visible* — the operator sees the pushback and can act on it.

### 5.3 The correlation signal (the valuable part)

A single decline is a data point; **k declines on briefs sharing a template or parent is a brief-quality bug**. A correlation detector fires a higher-priority item:

```jsonc
{ "kind": "pushback.correlated",
  "brief_template": "codex-v2/migration",
  "declining_workers": ["w3", "w5", "w7"],
  "shared_reason_cluster": "spec ambiguous on idempotency",
  "routes_to": "brief-improver (doc 14 #27)" }
```

This is doc 14 #16's exact narrative beat ("the orchestrator just rerouted w4 after Codex refused the migration") plus doc 14 #27's brief-improver loop, wired together: correlated pushback is the highest-signal evidence that *the brief*, not the workers, is wrong — and it's scaffold-WHAT (learning to task better), which survives the bitter lesson. The operator's response menu on a `pushback` item:

- **Accept counter-proposal** → re-brief with `proposed_brief_delta` (a fenced new `brief` turn).
- **Override** → proceed anyway (logged, `rationale` required, worker *not* penalized).
- **Fix template** → route to brief-improver; the fix propagates to all briefs derived from that template.

---

## 6. Time-travel & counterfactual replay

### 6.1 Problem

The ledger enables replay (doc 09 F2), but as a debug capability, not a product surface. Two operator-facing moves (doc 14 #20): *"show me the fleet 20 minutes ago"* (time-scrub) and — the valuable one — *"replay this task with the brief changed"* (counterfactual), which is how an operator *learns to brief better*.

### 6.2 Time-scrub (cheap, MVP — a pure ledger fold)

Because the ledger is append-only, fleet state at time/seq `T` is just the fold of events `≤ T`. `NarrativeState` is itself such a fold, so reconstructing "20 minutes ago" reuses the §1 machinery with a bounded cursor:

```
operator_scrub(at = ts | seq) -> NarrativeState(events ≤ at)   // pure read, no side effects
```

The operator scrubs a timeline and watches storylines evolve, each beat still provenance-linked to its `seq_range`. This is Redux-DevTools / rr-style time-travel over the fleet's event history — and it's genuinely cheap because the ledger already *is* the event log; nothing new is recorded.

### 6.3 Counterfactual replay (two honest flavors)

Counterfactual is where honesty matters most, because "replay this with the brief changed" means two very different things:

**(a) Live counterfactual (MVP-adjacent — reuses `fleet_spawn`).**

```
operator_counterfactual(task_ref, brief_delta, mode="live")
  -> spawns a shadow worker in a throwaway worktree with the edited brief,
     produces a two-narrative diff (original storyline ‖ counterfactual storyline)
```

This is **a run, not *the* run** — non-deterministic (different sampling, a moved repo, live tool results). It is honestly labeled as such. It is still exactly what an operator needs to *learn to brief better*: change the ambiguous idempotency clause, spawn the shadow, and *see if w3's decline disappears*. Cheap, reuses existing spawn, high learning value.

**(b) Deterministic counterfactual (later — eval-gated, needs the replay harness).**

True "change only the brief, hold everything else" requires the reproducibility harness of doc 14 #14: pinned model version, captured tool-result snapshots (so the re-run doesn't re-hit a mutated filesystem), seed capture, frozen capability-index revision. Without all of it, a "counterfactual" attributes the difference to noise, not the brief — theater. This flavor is therefore **the same engine the M1 eval needs for honest ablations** (doc 14 #14, #21) and is gated with it. *Do not ship it before the replay harness exists*; a deterministic-looking counterfactual that isn't deterministic is worse than no counterfactual, because the operator will draw causal conclusions from noise.

---

## 7. Worked example

*A single scenario exercising all six surfaces. The fleet: `Claude→(Codex+GLM)`, four workers on an auth refactor, sidecar deployment (doc 04). The operator, Will, glances at the plane after 20 minutes away.*

**T+0 — Narrative, "since you last looked" (§1).** Will opens the plane. He does not see a grid; he sees:

> **Auth refactor** — *at risk*. w1 (Claude) landed the session-store change, verified green ⟨seq 4102⟩. **w2 (Codex) is stuck**: 3rd near-identical failure on `tests/test_auth.py`, loop suspected ⟨4172–4180⟩. **w3 (Codex) declined the migration brief** — "spec ambiguous on idempotency" ⟨4201⟩; the orchestrator rerouted it to w4 (Claude) ⟨4205⟩. w4 verified green but **cost 4.8× the class median** ⟨4330⟩.

Four beats, each provenance-linked. The `since` delta is computed against Will's read-cursor; the routine tool calls that filled the 20 minutes never became beats (§1.3).

**T+1 — Debugging intent (§2).** The reroute surprised Will. He clicks the `decision` beat and calls `operator_why(4205)`:
- *trigger* (fact): w3's `decline{reason: "spec ambiguous on idempotency"}` ⟨4201⟩.
- *rationale* (untrusted): "Codex balked; the last three migrations went to Claude cleanly — reassigning to w4."
- *effect* (fact): w4 verified green ⟨4330⟩ — but with the cost anomaly.

The reroute was sound; the rationale matches the trigger. Good.

**T+2 — Correlated pushback (§5).** But w3's decline isn't alone: `pushback.correlated` has fired — w3, w5 (a prior task), and w7 all declined briefs from `codex-v2/migration` citing the same idempotency ambiguity. This is a *brief* bug, not a worker bug. Will accepts the highest-confidence counter-proposal (w3's `proposed_brief_delta` pins the idempotency contract) and routes the template to the brief-improver.

**T+3 — Cost-as-signal trips a breaker (§3.5).** w4's 4.8× cost anomaly ⟨4330⟩ tripped the circuit breaker on the `command_exec @ src/auth/**` cell — which had been at `auto_breakered`. It demoted to `approve_all` and raised an attention item. Will inspects: w4 over-explored after the reroute (context poison from inheriting the migration mid-stream). He leaves the cell demoted — trust re-earned slowly (§3.4) — and re-arms only after the next clean pass.

**T+4 — Takeover (§4).** w2 is still looping. The intervention menu defaults the cursor to **Nudge** (matching `loop_suspected`), but Will has seen this flaky test before, so he escalates to **Take over** (gentle). The supervisor quiesces w2 to its next tool boundary ⟨4402⟩, bumps the fence, and drops Will into `codex resume <thread>`. He pins the test seed, confirms it's flaky (not w2's bug), commits a `@flaky` marker, and `operator_release`s with the note "test was flaky, seed 42; marked and moved on." The orchestrator gets the reconciliation digest and does *not* re-interrupt w2 ⟨4440⟩. Every action Will took is in the ledger with `actor: human` — the orchestrator saw all of it.

**T+5 — Counterfactual (§6).** Was the whole w3/w4 detour avoidable? Will runs `operator_counterfactual(task: migration, brief_delta: <pinned idempotency contract>, mode="live")`. The shadow worker (Codex, edited brief) *does not decline* — it completes the migration directly. Will now has evidence the brief fix works, and the two-narrative diff to prove it. Labeled "a run, not the run" — but enough to promote the template fix with confidence.

Total operator attention spent: one narrative read, one `why`, three decisions. No grid, no metric reconstruction, no lost plot.

---

## 8. MVP vs. later

The operator plane is scoped against the corpus's two spines: the **Referee** value (narrative + intent + pushback explain the fleet's *verdicts* and are useful even in a verification-only branch) versus the **Conductor** value (autonomy ramp + takeover are driving-branch, gated on the M1 eval per doc 13). And everything counterfactual-deterministic is gated on the replay harness (doc 14 #14).

| Surface | MVP (ships with Conductor MVP: single adapter, I1/I3/I4/I6) | Later (earned by demand / eval-gated) |
|---|---|---|
| **Narrative (§1)** | Operator read-cursor; deterministic beat classifier; templated beats from hub-facts; `since`/`catchup`/`recap`; TUI | Cheap-model prose polish opt-in; CPG-delta beats ("1 new taint path" — doc 15 §4a); web dashboard |
| **Intent (§2)** | Required `rationale`+`trigger_ref` on consequential verbs; `operator_why` intent-trace | Rationale-vs-trigger contradiction detector as an auto-flag |
| **Autonomy (§3)** | *(Conductor-branch, needs run-history to have data)* dry_run + approve_all cells; policy engine already exists | Full per-cell ramp, promotion proposals, sampled audit, circuit breakers — after the fleet has run long enough to have evidence *and* the eval clears the Conductor branch |
| **Takeover (§4)** | Two-phase takeover (session resume already in 05 §7); fence bump; reconciliation digest; authority badge; intervention menu (nudge/interrupt/kill exist) | Gentle-stop + steer menu rungs (need `steer` native, pending M0); emergency-vs-gentle tuning |
| **Pushback (§5)** | `decline`/`counter_propose` as `pushback` attention items; partial-delivery result fields; correlation detector | Auto-route to brief-improver (doc 14 #27) |
| **Time-travel (§6)** | `operator_scrub` (pure ledger fold) | `operator_counterfactual(live)`; then `operator_counterfactual(deterministic)` — *only after* the replay harness (doc 14 #14), gated with M1 |

The through-line: the MVP is almost entirely **reads over the ledger + two envelope fields + one already-specified seat**. It is cheap precisely because it's a projection, not a new system. The expensive parts (the full autonomy ramp, deterministic counterfactual) are the ones that *should* wait — for run-history, for the eval, for the replay harness.

---

## 9. Honest limits

1. **The narrative can mislead; the ledger cannot.** The narrative is model-authored prose derived from facts — a lens, not truth. The mitigation is structural, not aspirational: every beat carries its `seq_range`, so any claim is one click from the raw event and the worktree diff, and **no merge, I7 gate, or autonomy promotion ever reads the prose** (§0). The Referee runs on facts. If the narrative and the ledger disagree, the ledger wins, always. The risk that remains: an operator who trusts the story without ever drilling in — the plane makes drilling one click away, but cannot force it.

2. **Rationale is stated intent, not actual computation.** `rationale` is the orchestrator's *self-report*, captured at emit time — untrusted, possibly post-hoc or confabulated. It debugs what the orchestrator *said* it thought, not what it actually computed (which is ephemeral and unrecoverable). This is still valuable — a rationale that contradicts its own `trigger_ref` is a visible red flag — but the operator must not mistake a plausible rationale for a correct decision.

3. **Graduation is a stationarity bet.** Evidence-based promotion assumes past approvals predict future safety — true only if the task distribution is stationary. A novel task class landing in an `autonomous` cell is exactly where the bet fails, and circuit breakers are a *mitigation, not a guarantee* (they catch the anomaly *after* it fires, inside the sandbox). The design's honest floor is that the OS sandbox — not the ramp — is the safety boundary (§3.2): the worst a mis-graduated cell does is auto-approve something the kernel already permits. Graduation trades operator attention for risk *inside* that floor; it never lowers the floor.

4. **Correlated approval can still drift the standard down.** §3.4 weights I7 failures and human overrides heavily precisely because fleet-level misalignment (#24) can manufacture agreeable approvals — but if the *human* also drifts toward rubber-stamping (approval fatigue is real), the co-drift is invisible to a system that treats human approvals as ground truth. The only true anchor is the hub-run I7 verification against a human/orchestrator-pinned spec (doc 13 T5); the operator plane surfaces it but cannot substitute for it.

5. **Deterministic counterfactual is theater without the replay harness.** Stated in §6.3 and repeated because it's the most tempting corner to cut: a counterfactual that isn't deterministic invites the operator to draw causal conclusions from noise. Ship the live flavor (honestly labeled) and withhold the deterministic flavor until doc 14 #14's harness exists.

6. **The plane improves span-of-control; it does not solve it.** The narrative lets one operator watch a handful of workers without losing the plot — but per-vendor concurrency ceilings (Z.ai Pro ≈ 1 in-flight) cap fleet size anyway, so a handful is the real regime. The plane does not make one operator supervise 100 fleets; at true scale the operator is still the bottleneck, and the honest answer is that baton's fleets are small by construction (doc 10 T3 caveat — "capped at handfuls per vendor"). The plane is designed for that regime, not beyond it.

7. **Beat-classifier calibration is the whole game and it's per-harness.** If the classifier is too eager, the narrative becomes the dashboard-in-prose it was built to replace; too quiet, and it misses the beat that mattered. The threshold (which signals are beat-worthy) is a subtraction discipline that needs per-harness tuning (a Codex loop and a Claude loop have different signatures), and getting it wrong fails *silently* toward noise — the operator won't notice the plot is buried until they've already lost it. This is the one place the plane can regress into the very failure it targets, and it must be watched.

*— the operator is an agent too; design for their attention with the same discipline you design for the orchestrator's context. Hand them the story, hide the grid, earn their autonomy, and make every one of their moves an event the fleet can see.*

## RED-TEAM
## Red-team: hitl-operator

I read the corpus this design cantilevers off of — doc 05 (telemetry/steering), doc 14 (the 30 addenda it claims to "realize"), doc 13 (the Referee reframe + the eval gate), supervisor-state-machine.md (I1–I7), communication-channel.md §6 (digest), doc 15 §0. The design is fluent and self-aware — it pre-empts many attacks in §9. That fluency is itself the problem: several "honest limits" are load-bearing kills filed as footnotes, and the showcase (§7) repeatedly does the exact thing the limits forbid. Strongest attacks first.

---

### 1. The central value proposition and the central safety story are mutually exclusive. (severity: fatal)

The spine is *"hand them the story, hide the grid"* (§0, closing) — subtract attention by making the narrative the thing the operator reads. The safety story is *"The narrative can mislead; the ledger cannot… no merge, I7 gate, or autonomy promotion ever reads the prose… If the narrative and the ledger disagree, the ledger wins"* (§9.1). These cannot both be operative:

- If the operator **hides the grid and trusts the story** (the stated goal), they are trusting an explicitly `untrusted`, model-authored, lossy projection as their primary surface.
- If the operator **drills into the ledger to verify** (the safety model), no attention was subtracted — they're doing the grid-reconstruction work the plane promised to remove, plus reading prose on top.

§9.1 names this and then waves it away: *"The risk that remains: an operator who trusts the story without ever drilling in — the plane makes drilling one click away, but cannot force it."* That is not a residual risk; it is the design refuting its own thesis. The whole plane exists to let the operator **stop** reconstructing from telemetry. Its safety depends on them **continuing** to reconstruct from telemetry. "One click away" is irrelevant when the entire UX is optimized to make the click feel unnecessary. You have built a surface whose adoption success (operator relies on the story) *is* its failure mode (operator relies on the story).

---

### 2. The narrative solves a large-N problem baton's own constraints forbid from existing. (severity: fatal — it's a mirage)

The problem statement is imported wholesale from doc 14 #16 — *"loss of the plot"* — but #16 is a general multi-agent-DX claim. The design never checks whether that problem exists **at baton's scale**, and its own §9.6 concedes it does not:

> *"per-vendor concurrency ceilings (Z.ai Pro ≈ 1 in-flight) cap fleet size anyway, so a handful is the real regime… baton's fleets are small by construction."*

At N = 1–3 workers a human does not lose the plot of a grid. `baton top` — the "wall of dials" the design derides — is *already* a legible surface for three rows. The entire "narrative not dashboard" argument (§1.1) rhetorically inflates a 3-row status table into "a wall of dials" to justify a story-generation layer that the corpus's hard concurrency ceiling makes unnecessary. The design markets a solution to span-of-control (watch many workers) and then admits in §9.6 it *"does not solve span-of-control"* and that fleets are handfuls by construction. So: the plot-loss problem is real at N=50 and baton is structurally N≤~5. **You are building the cure for a disease the architecture is immune to.** This is the kill-case: the narrative surface (§1), the most elaborated part of the design, is a mirage at baton's actual operating point.

---

### 3. The autonomy ramp's "load-bearing honesty" is a sleight of hand that removes the one control the sandbox doesn't cover. (severity: high)

§3.2 stakes the entire feature's safety on:

> *"the worst a maximally-trusted cell can do is auto-approve something the kernel would have permitted anyway. Autonomy subtracts operator attention; it grants no new capability."*

This quietly redefines the threat to exclude why the approval chain exists at all. Doc 05 §5 is explicit: the OS sandbox confines **writes to the worktree**; the approval chain (policy→orchestrator→human) exists for the class of actions that are *sandbox-permitted but human-unwanted*. The design's own cell taxonomy lists **`network`** and **`merge`** as `action_class`es that graduate to `autonomous`. So "auto-approve what the kernel permits" concretely means: auto-approve network egress the kernel allows, auto-approve merges with the human out of the loop. The approval chain's entire value is the human ceiling over exactly those. The ramp removes that ceiling and calls it "moving attention, not authorization."

**Concrete failure:** a `network @ *` cell graduates to `autonomous` on clean evidence. Then doc 14 #25 (contagion) fires — a poisoned README in one worker's repo propagates a malicious instruction through the shared substrate. The worker makes a kernel-permitted egress call and exfiltrates. The human was *removed from the loop by their own earned trust*, on the one action class where the sandbox is not the boundary. §3.2's reassurance ("worst case = what the kernel permits anyway") is only comforting if the kernel denies everything dangerous — but if it did, you wouldn't have an approval chain. The existence of the chain is proof the sandbox is not the whole boundary; the ramp's headline claim assumes it is.

---

### 4. `rationale` as a required MCP argument is a narration tax on the control plane — precisely #4's prohibition — and a safety regression on the emergency path. (severity: high)

§2.2 asserts:

> *"No narration tax here either. The orchestrator is already deciding; the rationale is the decision stated, not a performance for the gallery."*

This is rhetoric, and it inverts doc 14 #4, which says: *"An agent that knows it's being watched-for-narration optimizes for the narration."* Making `rationale` a **"required, non-empty argument at the MCP boundary"** on `fleet_interrupt`, `fleet_kill`, `fleet_approve(deny)`, reroute — i.e. the highest-stakes verbs — is *definitionally* watched-for-narration, on the path where narration-optimization is most corrosive (the orchestrator learns to phrase seizures persuasively rather than decide well). "Already deciding" conflates the decision with its **articulation**; the model was not previously emitting a one-line English justification — that is new gated token production, the tax #4 names.

Worse, it lands on the liveness-critical path the supervisor exists to protect. Per supervisor.md, `interrupt`/`kill` are the mechanisms for a *runaway* worker. A required-non-empty validation means: **you cannot kill a runaway worker without first composing prose.** An orchestrator that emits `fleet_kill{rationale:""}` under a cost-anomaly emergency gets rejected at the boundary. The design put a narration gate on the fire extinguisher and never noticed.

---

### 5. Intent-debugging rests entirely on untrusted prose whose only diagnostic a competent model never trips — and the showcase trains the operator to trust it. (severity: high)

§2.3's value claim is that a *"rationale that contradicts its own trigger is a red flag the operator can now see."* But the rationale is authored **with the trigger in context** (§2.2: captured at emit time by the issuer, which has `trigger_ref` in hand). A coherent model producing a self-report will trivially make it consistent with the trigger it can see — post-hoc coherence is free. So the contradiction detector (conveniently deferred to "Later") catches only *incompetent* confabulation. The genuinely dangerous case — a fluent, trigger-consistent rationale for a **wrong** decision — is invisible by construction.

And the design *trains the operator to read consistency as safety*. §7, T+1: *"The reroute was sound; the rationale matches the trigger. Good."* This is the "green-check theater strictly worse than trusting the worker" failure doc 13 T5 warns about, reproduced one level up for `rationale`: a plausible self-report is exactly the artifact a spec-gaming/misaligned orchestrator (doc 14 #24) produces, and the plane presents it to the operator as reassurance. §9.2 admits "the operator must not mistake a plausible rationale for a correct decision" — then §7 has the operator do exactly that.

---

### 6. "Gentle by default" takeover has no reliable Codex boundary-hold — it silently degrades to the violent path the section claims to avoid. (severity: high)

§4.2's default `urgency=gentle` *"quiesce[s] to next tool boundary."* But doc 05 §4's `pause` row is explicit that this primitive is emulated and unreliable, and that **Codex has no universal hold point**:

> *"Codex has no universal approval boundary (`acceptForSession` + non-command tools pass through), so `pause`=`interrupt`→hold→resume (in-flight work lost, `emulated:true`), or use `fleet_freeze`."*

So on a Codex worker, "quiesce to the next tool boundary" has no mechanism — a non-command tool call passes straight through with nothing to hold on. Gentle takeover on Codex therefore **degrades to `fleet_freeze` (interrupt→snapshot)**, which is the emergency/violent end of the very spectrum §4 congratulates itself for avoiding by default. The design even admits this in §8 ("Gentle-stop + steer menu rungs (need `steer` native, pending M0)" are *Later*) — yet §4 and the §7 showcase (T+4: "gentle… quiesces w2 to its next tool boundary") present gentle takeover as MVP-real on a Codex fleet. Internal contradiction: the marquee escape-hatch UX is available only on the one harness (Claude, PreToolUse) with a genuine hold, and silently violent on the other.

---

### 7. The reconciliation digest is prose updating the orchestrator's belief state — the exact poison the design claims to have cured. (severity: high)

§4.2 hands the orchestrator, on release, a *"reconciliation digest ('human edited src/auth/session.py; rebased; tests green')"* and claims symmetry with doc 05 §4's amendment-is-loud discipline, so *"it doesn't re-litigate the human's fix."* But §7 T+4 makes the content plainly narrative: *"test was flaky, seed 42; marked and moved on"* — and the orchestrator **acts on it** ("does not re-interrupt w2"). That is model/human **prose steering orchestrator behavior**, which is precisely what §0 forbids ("the Referee runs on facts, not the story") applied to the human→orchestrator direction. Doc 05 §4's discipline is that edits are *loud and worker-perceivable* — not that a downstream agent should *trust a prose summary of what happened*. The honest reconciliation is: after release, the orchestrator re-reads the worktree diff and re-runs I7 (facts), not "consumes a story about the fix." As written, the design lets a human narrative poison the orchestrator's belief state — the same poison (doc 05 §4, "silent edits poison the worker's belief state") with a human as the source.

---

### 8. The evidence that drives graduation is sparse and gameable at baton's actual tempo; the anti-gaming defense assumes an I7 density that doesn't exist. (severity: medium-high)

§3.3's flagship example: *"You approved 48 of 48 file edits in tests/** over 3 days."* Two problems.

**(a) The rate is fantasy.** Doc 05 §6's steering philosophy is *"Brief well… Let it cook… Intervene on signal"* and the approval chain resolves most cases at policy/orchestrator before reaching the human. At N≈1 in-flight (Z.ai) with a hands-off cadence, 48 *human-surfaced* approvals in tests/** in 3 days implies a chatty regime that contradicts "let it cook," or a far longer calendar than "3 days." §8 concedes the whole ramp is "Later, after the fleet has run long enough to have evidence." The onboarding-funnel feature is gated on an evidence-accrual rate the small-N, hands-off regime makes glacial — plausibly slower than the frontier moving under it (#23). Aspirational.

**(b) The anti-gaming anchor is thinner than claimed.** §3.4 leans on *"a single I7 hub-verification failure in a cell is a hard breaker trip"* and *"zero I7 verification failures in the window"* as the non-worker-adjacent gate. But I7 (supervisor.md) runs on **task results / merges**, not per file-edit-approval. A `file_edit @ tests/**` cell accumulates 48 approvals with **no per-action I7 re-run** — I7 fires sparsely at task granularity. So the cell graduates on human approvals whose only claimed anchor (I7) never densely covered those actions. Combined with §9.4's admitted human co-drift (rubber-stamping is invisible), the "gamed graduation" defense rests on a verification signal that isn't present at the cell's action granularity. The design assumes I7 blankets every cell; it blankets task boundaries.

---

### 9. The counterfactual showcase draws a causal conclusion from an n=1 non-deterministic run — the exact error §9.5 forbids. (severity: medium)

§6.3(a) is honestly labeled *"a run, not the run"* — non-deterministic. Then §7 T+5 does this:

> *"The shadow worker… does not decline — it completes the migration directly. Will now has evidence the brief fix works… enough to promote the template fix with confidence."*

One non-deterministic shadow run that happens not to decline is n=1 and distinguishes "the brief fix caused it" from "sampling variance" not at all. §9.5 says the deterministic flavor is withheld precisely because *"a counterfactual that isn't deterministic invites the operator to draw causal conclusions from noise."* The design's own worked example is the operator drawing a causal conclusion from noise ("promote… with confidence"). The showcase demonstrates the failure the limit was written to prevent. If your MVP-adjacent flavor can't support the causal claim, don't stage the operator making it.

---

### 10. Human + orchestrator racing on one fence for *non-takeover* interventions is the hard case the supervisor flags as unsolved — and the design hand-waves it. (severity: medium)

§4.3: *"The operator never has to think about fences… the human's action always wins the fence."* That guarantee comes from I1, where **takeover bumps the fence**. But the intervention menu's Nudge / Steer / Gentle-stop are *not* takeovers. If a human Steer and an orchestrator Steer are composed against the same `turn_epoch` with no takeover bump, I1 gives no ordering — idempotency dedupes, fences order, but same-fence-no-bump is a genuine race. Supervisor.md §6 lists *"race human+orchestrator on one fence"* as *the* hard fault-injection test, and open-Q #4 marks the human-seat socket API itself as *"almost certainly yes"* — i.e. unspecified. The design builds a full second control client (writes fenced ops with `actor:human`) on an unspecified socket and asserts the hardest concurrency case is solved by a mechanism (fence bump) that only its top rung (takeover) actually invokes. "The operator never has to think about fences" is true only because the design didn't.

---

### 11. Smaller but real

- **"Cheap local model" is unpriced and load-bearing.** §1.2/1.3/1.4 route every minted beat, every `recap`, and narrative polish through *"a cheap local model."* Under one-box-first, that model shares the box with the supervisor and workers. This is the same uncosted-poll sin doc 13 T2 already flagged ("an uncosted ~200-token perception poll the ant-analogy promises is free"), recurring. Price it against the box or it's the ant-poll again.
- **The materialized "plot model" is a second source of truth that lies by omission.** §1.2 makes the narrative *"an incrementally-maintained materialized view."* A too-quiet classifier (§9.7, admitted to *"fail silently toward noise"*) drops a beat; the operator reads `since` as complete and a real event is invisible in the projection. §9.7 itself: *"the operator won't notice the plot is buried until they've already lost it."* You cannot both put this classifier in the MVP (§8) and have no eval for narrative completeness (there is none — you can eval I7, you cannot eval "did the operator lose the plot" without the operator losing it). The one MVP component with no ground-truth signal is the one whose silent failure recreates the target problem.

---

### Bottom line

The design's engineering symmetry (each operator surface mirrors an orchestrator mechanism) is genuinely elegant and the ledger-projection spine is correct. But three things sink it as pitched:

1. **Scale (#2):** the narrative — its most-developed surface — cures a disease baton's ≤5-worker ceiling is immune to, and §9.6 admits it.
2. **The value/safety contradiction (#1):** you cannot both hide the grid and require the operator to distrust the story; adoption success *is* the failure mode.
3. **Autonomy's honesty is a sleight (#3):** "worst case = what the kernel permits" is only true because it excludes network/merge — the very actions the approval chain exists to gate — and then graduates them.

The corpus's own verdict (doc 13) is that *everything above the control/verification plane is speculation until the M1 eval clears the Conductor branch*. This entire plane is above the control plane. §8 tries to inoculate by splitting MVP along Referee/Conductor lines — but Narrative + Autonomy + Takeover are all Conductor-branch, and the design ships them as if the eval had already passed. The honest scoping is: build **nothing here** until the eval says the Conductor is worth driving, and even then, build the *takeover seat and pushback items* (real, corpus-earned, small) — and leave the narrative and the autonomy ramp on the shelf until baton runs at a scale, and accrues evidence at a rate, that neither the concurrency ceiling nor the "let it cook" cadence currently permits.

## BLUE-TEAM & SALVAGE
I have the corpus grounding I need. The red team's factual load-bearing claims check out: doc 05 §pause row confirms Codex has no universal hold boundary (`pause`=`interrupt`, `emulated:true`); supervisor §6 lists "race human+orchestrator on one fence" as *the* hard fault test and open-Q #4 leaves the human-seat socket "almost certainly yes" (unspecified); I7 fires at task/merge granularity; doc 05 §5 makes the sandbox the boundary and the policy chain a tripwire. Here is the blue-team response.

## Blue-team & salvage: hitl-operator

### Part 1 — Findings, one at a time

**#1 — Value/safety contradiction (red: fatal). Verdict: CONCEDE-AND-FIX (not fatal).**
The red builds a false dichotomy: "trust the untrusted story" vs. "reconstruct from telemetry." Both legs ignore the third, which the design already half-specifies and must now make load-bearing: **the operator acts on fact-typed beats, and verification is not the operator's job at all — it is I7's, and it runs without them.** The decision-bearing beats — `control.*`, `verification.result` (I7 pass/fail), `resource.budget.threshold_crossed`, `pushback.*`, lifecycle — carry `sourced_from: facts` and are *hub-computed*. The prose is a rendering skin over a structured hub-fact; trusting a `verification.result=fail` beat is trusting the Referee, not a model narration. The genuinely untrusted content is narrow and already fenced off: worker prose (delimiter-wrapped) and `rationale` (§2), neither of which gates anything.

So the contradiction dissolves *if and only if* the fact/prose boundary is enforced **in the surface, not just in the ledger** — which the design left implicit. The fix (mechanism): (a) every operator *action button* is wired only to a fact-typed beat; a prose-typed summary is never actionable on its own — it always has a fact beat behind it or it renders as inert, visibly-marked `untrusted` text with no control affordance. (b) Prose polish / `recap` is opt-in (§8 already scopes it Later); the MVP narrative is templated-from-facts, so "the story" *is* the fact stream in human-readable form. The residual the red names — an operator who never drills in — is real but reduces to: an operator who trusts fact-typed beats (correct) and ignores the decorative untrusted skin (correct). That is not the design refuting its thesis; it is the design's thesis once the surface stops blurring the two provenance types. Concede that §0/§9 asserted this only at the ledger layer and left the *surface* free to present prose as if it were fact — that gap is the kill the red found, and it closes with a UI-level provenance rule, not a rewrite.

**#2 — Narrative is a mirage at N≤5 (red: fatal). Verdict: DEFEND the temporal core, CONCEDE the cross-sectional plot-model.**
The red collapses "loss of the plot" onto a single axis (concurrent worker count) and correctly notes baton is N≤~5 there. But plot-loss is **events-since-last-look × workers**, and at baton's *own* mandated cadence — doc 05 §6 "brief well, **let it cook**, intervene on signal" — the operator is *away*, then returns. A single autonomous worker over a 20-minute cook emits thousands of `action.tool_call`/`content.*_delta` events; `baton top`'s 3-row grid shows current *state* but answers neither "what changed since I left" nor "why." The reconstruction cost on return is real at N=1. The mechanism that pays for itself at N≤5 is therefore the **temporal** one: the operator read-cursor + the fact-typed `since` delta + `catchup`/`recap` + intent-trace. Those are cheap ledger folds, useful at N=1.

What the red kills, correctly, is the **cross-sectional** apparatus: the elaborate `storyline`-as-DAG-subtree grouping, the materialized "plot model," "hide the grid." Grouping 3 rows into storylines and calling `baton top` "a wall of dials" is rhetorical inflation. Concede it. Salvaged: keep the temporal catch-up (the since-cursor delta over facts); drop the storyline plot-model and the "hide the grid" framing until fleets exceed the handful regime the concurrency ceiling currently forbids. The narrative shrinks from "a new story-generation layer" to "a diff over the ledger since your cursor" — which is what actually earns its keep at baton's scale.

**#3 — Autonomy's "worst case = kernel permits anyway" excludes network/merge (red: high). Verdict: CONCEDE-AND-FIX, with a real partition.**
The red is right that the reassurance is only true where the sandbox *is* the boundary, and the design's own cell taxonomy lists `network` and `merge` — the two classes the approval chain exists to gate precisely *because* they're sandbox-permitted-but-human-unwanted. Two fixes, both mechanical:

- **`merge` is not a worker action and was never a cell.** Merge is a hub operation gated by I7 (supervisor: results are claims, the hub re-runs verification). Whatever the rung, a merge passes through hub I7 re-execution against the pinned spec. Remove `merge` from the autonomy taxonomy entirely — it is Referee-gated by construction, not attention-gated.
- **Partition `action_class` into sandbox-confinable vs. sandbox-unconfinable.** `file_edit @ scope` is confinable — a mis-graduated cell auto-approves a write the kernel already confines to the worktree, so the red's own steel (worst case = kernel-permitted) genuinely holds. `network` egress to arbitrary hosts is *not* cheaply confinable, so it is **never graduation-eligible**: it stays at `approve_all` permanently, or is kernel-denied by `sandboxPolicy` (doc 05 §5 — the sandbox *can* deny net; then there's nothing to graduate). The contagion scenario (#25) the red constructs requires a graduated `network @ *` cell; under the partition that cell cannot exist. Concede the design implied all classes are symmetric; they are not, and the honest ramp only graduates the classes where the sandbox actually is the floor.

**#4 — `rationale` is a narration tax on the control plane and blocks the fire-extinguisher (red: high). Verdict: CONCEDE the emergency block (real bug), DEFEND-with-change on the tax.**
The emergency-path point is a genuine defect and I concede it outright: a required-non-empty prose field on `fleet_kill`/`fleet_interrupt` means you cannot kill a runaway without composing prose — a narration gate on liveness. Fix: **`trigger_ref` (a seq pointer — a fact, zero narration) is the required field; the prose `rationale` is always optional and never blocks.** On the emergency path the op proceeds with `rationale` empty and `trigger_ref` defaulting to the firing signal's seq; prose can be backfilled. Liveness never waits on articulation.

On the narration-tax-#4 concern: partially defend. #4's danger is *optimizing for the narration*. Requiring a *fact pointer* (`trigger_ref`) creates no narration-optimization pressure — it's a citation, not a performance. The optional free-text is where the pressure could live, so it stays optional and, critically, is provenance-typed `untrusted` and gates nothing (§2.2). An orchestrator that learns to phrase seizures persuasively gains nothing, because no gate reads the prose — the effect leg (next I7/health event) is what the operator and the ramp actually consume. Concede the design overstated "no narration tax… the decision is already stated"; the honest claim is narrower — *the required capture is a fact citation, and the prose is optional and non-authoritative.*

**#5 — Intent-debugging rests on untrusted prose; the detector only catches incompetent confabulation; §7 trains trust (red: high). Verdict: CONCEDE the framing, DEFEND the fact-anchored value.**
Concede that "rationale matches trigger → good" (§7 T+1) is exactly the green-check theater doc 13 T5 warns against, one level up. Fix the value story and the showcase together: the intent-trace's worth is **not** consistency-implies-safe. Three of its four legs — trigger, op, effect — are hub-facts; only the rationale is model-word. The operator's actual signal is the **effect leg**: w4 passed *I7* (fact) after the reroute. The decision was validated by a Referee-computed effect, *independent of the prose*. Rewrite §7 T+1 to: "the *effect* (w4 passed I7) validated the reroute; the rationale is the least-trusted leg and is labelled so." The trace debugs *dumb decisions after the fact* by juxtaposing trigger-fact and effect-fact; a contradiction between rationale and trigger is a *bonus* flag, never the primary safety mechanism. Concede the deferred detector catches only clumsy confabulation — so demote it from "safety feature" to "cheap auto-annotation," and stop the showcase reading consistency as reassurance.

**#6 — Gentle takeover has no reliable Codex hold; degrades to the violent path (red: high). Verdict: CONCEDE-AND-FIX (capability-gated, honestly).**
Confirmed against doc 05: Codex `pause`=`interrupt`→hold→resume, in-flight work lost, `emulated:true`; only Claude PreToolUse genuinely holds. The design's error is the **showcase**, where w2 is a Codex worker and T+4 narrates "gentle… quiesces to next tool boundary" as if real. Fix: gentle takeover's coherence guarantee is **capability-gated per `card()`**, and "no silent emulation" (adapter-contract) already forces the honest path — on a harness without a genuine hold, gentle = "quiesce at next *command* boundary, else `fleet_freeze` (interrupt→snapshot)," stamped `emulated:true`, and the intervention menu shows the *real* coherence-cost for *that* worker (a Codex "Take over" row honestly reads higher on the violence spectrum than a Claude one). Small fix: make w2 a Claude worker in the showcase, or show the Codex freeze honestly. The mechanism (card-gated, emulation-stamped) already exists; the design just failed to apply its own no-silent-emulation rule to the takeover UX.

**#7 — Reconciliation digest is prose poisoning the orchestrator's belief state (red: high). Verdict: CONCEDE-AND-FIX (fact-first reconciliation).**
Sharp catch, and it violates the design's own §0 rule in the human→orchestrator direction. Fix: on `operator_release`, the orchestrator receives **facts, not a story** — (a) the worktree **diff** (fact), (b) the **ledger slice** of the human's `actor:human` control ops during takeover (facts), and (c) a **hub I7 re-run** on the affected scope (fact). The prose note ("test was flaky, seed 42") is an *optional untrusted annotation*, exactly like `rationale`, and the orchestrator's decision not to re-interrupt must be derivable from the diff + I7-green, not from trusting the sentence. This is precisely the symmetry the design *claimed* but didn't build. Cheap, and it makes the human→orchestrator handoff obey the same "Referee runs on facts" discipline as everything else.

**#8 — Evidence rate is fantasy; I7 doesn't blanket file-edit cells (red: medium-high). Verdict: CONCEDE both, with a granularity fix.**
(a) Concede the "48 in 3 days" rate contradicts let-it-cook at N≈1 in-flight; the numbers are illustrative-optimistic. Fix: promotion thresholds are **evidence-count based, not calendar based**, and the honest expectation is graduation spans many sessions — which is exactly why §8 already defers the full ramp to "after run-history." (b) Concede the design over-claimed per-action I7 density: I7 fires at task/merge boundaries. Fix the anti-gaming anchor to match reality: a fine-grained cell (`file_edit @ tests/**`) graduates only when the **tasks its actions rolled up into have passed hub I7** — the window must contain ≥k task-level I7 passes whose scope intersects the cell, not merely k human approvals. Unverified approval-count alone never graduates. This keeps §3.4's spine (the non-worker-adjacent gate) but ties it to the granularity I7 actually operates at.

**#9 — Counterfactual showcase draws a causal conclusion from n=1 (red: medium). Verdict: CONCEDE (fix the wiring, not just the wording).**
Concede: §7 T+5 does the exact thing §9.5 forbids. Fix is structural, not cosmetic: **the live counterfactual produces a hypothesis, never a promotion.** Its output feeds the §5.3 correlation detector, not a template-fix decision. Promotion of a brief-template fix requires the *correlated-pushback signal to disappear across the k declining briefs* (a fact aggregate over multiple runs) or the deterministic harness — never one shadow run "happening not to decline." Rewrite T+5: "the shadow didn't decline — one suggestive data point; promotion waits on the correlation clearing or the deterministic replay." The live flavor stays MVP-adjacent as a *hypothesis generator*; the causal claim is gated where §9.5 already said it must be.

**#10 — Human+orchestrator race on one fence for non-takeover ops (red: medium). Verdict: CONCEDE-AND-FIX (every human op bumps the fence).**
Confirmed: supervisor §6 flags this as the hard fault test; I1 only bumps on takeover; Nudge/Steer/Gentle-stop are not takeovers, so a same-epoch human/orchestrator Steer has no ordering. Fix is one line of invariant: **every `actor:human` control op acquires-and-bumps the fence** (micro-takeover semantics), not just full Take-over. Then I1's "fences order; idempotency dedupes" makes "human always wins the fence" true by *construction* for the whole intervention menu, and the orchestrator's competing op returns `stale_fence`. This also forces the design to actually specify the human-seat socket (open-Q #4): human writes traverse the same fence-checked verb path and bump `turn_epoch`. The red is right the design asserted the guarantee while only its top rung invoked the mechanism — so extend the mechanism to every rung.

**#11 — Cheap model uncosted; materialized view lies by omission (red: medium). Verdict: DEFEND (a) via templates, CONCEDE-AND-FIX (b).**
(a) Defend: §8's MVP already renders beats from **deterministic templates over hub-facts — zero model in the path**. Prose polish is Later/opt-in; when opted into, it's priced against the operator's box budget explicitly. The MVP narrative costs nothing the ledger doesn't already produce. The ant-poll sin (T2) applied to a *mandatory* model; here the model is optional and the default is a pure fold. (b) Concede the "materialized view" framing invites the silent-omission failure. Fix: **the narrative is not a persistent second store — it's a pure, recomputable ledger fold** (as §6.2 itself admits `NarrativeState` is). Drop "incrementally-maintained materialized view." And add the completeness anchor the red correctly says is missing: the `since` delta **always surfaces the raw event count next to the beat count** ("312 events, 4 beats") — a too-quiet classifier shows as a large raw/beat ratio the operator can expand, so silent-drop-to-noise becomes *visible* without an impossible "did-you-lose-the-plot" eval. The classifier stays deterministic and inspectable (not a model), so its threshold is auditable, not stochastic.

### Part 2 — Salvage: the strongest version that survives

Split the plane exactly along the corpus's two spines (doc 13), and ship only the Referee-branch, corpus-earned, N≤5-useful core:

**Ships now (Referee-branch — real, small, useful at the actual operating point):**
1. **Operator read-cursor + fact-typed `since` delta + intent-trace.** A temporal catch-up over the ledger (I3 cursor primitive reused), beats rendered from hub-facts by deterministic templates, `trigger_ref` required on consequential verbs / `rationale` optional+untrusted, raw-count shown beside beat-count. *No storyline plot-model, no "hide the grid," no mandatory model.*
2. **Pushback items** (`decline`/`counter_propose` + partial-delivery result fields + the correlation detector). Pure win, corpus-earned (#5), highest-signal-per-token, zero contested mechanism. This is the part of the design the red barely touched — because it's right.
3. **The takeover seat**, with all four fixes folded in: every human op fence-bumps (#10), gentle is card-gated + emulation-stamped honestly (#6), reconciliation is fact-first — diff + ledger-slice + I7 re-run, prose optional (#7), and the intervention menu shows real per-harness coherence-cost.

**Waits (Conductor-branch — eval-gated and/or evidence-rate-gated):**
4. **Autonomy ramp**, only after run-history exists *and* M1 clears the Conductor branch — and rebuilt with the #3/#8 fixes: sandbox-confinable classes only (network never auto, merge removed as I7-gated-at-hub), evidence tied to task-level I7 passes, count-based thresholds.
5. **Full storyline narrative / plot-model** — deferred as the #2 mirage; justified only if fleets ever exceed the handful the concurrency ceiling forbids.
6. **Counterfactual** — live flavor as a *hypothesis generator* feeding the correlation detector (#9); deterministic flavor gated on the replay harness (already conceded).

The salvaged plane is what the red's own bottom line arrived at — "build the takeover seat and pushback items, leave the narrative and autonomy ramp on the shelf" — plus the one thing the red under-credited: the **temporal** since-cursor catch-up, which survives the scale attack because plot-loss is a function of time-away, not just worker-count, and baton's let-it-cook cadence *maximizes* time-away.

### Part 3 — Integrate, and the single first thing

**Planes/invariants it plugs into:** the plane is a **client of the supervisor's socket API** (open-Q #4, now forced to be specified), reading the same JSONL+SQLite ledger the orchestrator reads via `fleet_wait`, writing the same fence-checked verbs with `actor:human`. It touches exactly four invariants and adds nothing above the control/verification plane: **I3** (the operator read-cursor *is* the orchestrator's durable at-least-once cursor), **I1** (extended: every human op bumps `turn_epoch`, making human>orchestrator true for all rungs, not just takeover), **I6** (takeover reuses two-phase stop), **I7** (the *only* gate on merge and on autonomy promotion — never prose, ever). No new source of truth: every surface is `derive(ledger)`; every action is a fenced event *in* the ledger.

**Build first — one thing:** **the human seat's fenced read/write spine on the supervisor socket — the `actor:human` control path that bumps the fence, plus the operator read-cursor — proven against the supervisor's own "race human+orchestrator on one fence" fault-injection test.** Everything else (pushback rendering, intent-trace, the `since` delta, takeover) is a projection over that spine, and this is the one piece that also discharges the #10 race the supervisor already flagged as its hardest unsolved fault. It requires no model, no eval, no run-history — just reads over the existing ledger + two envelope fields (`trigger_ref` required, `rationale` optional) + the fence-bump-on-human-op invariant. Ship that, prove human>orchestrator ordering under fault injection, and layer the pushback items and since-delta on top. Hold the autonomy ramp and the storyline narrative behind the M1 eval and accrued run-history, exactly as doc 13's verdict demands — because they are Conductor-branch speculation until the eval says the Conductor is worth driving.
