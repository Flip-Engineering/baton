# Communication Channel — the bidirectional data-plane channel (v0 draft)

*The negotiated, content-bearing half of doc 10's two-channel model. The steering channel (unidirectional, preemptive, control plane) is specified in `supervisor-state-machine.md` + `docs/05` §4. This specifies its opposite: the **bidirectional** channel that carries briefs, questions, answers, and results between orchestrator and worker — ordered, durable, turn-respecting, on the data plane. Keeping this physically separate from steering is design law #1 (doc 10 §5).*

## 1. Channel properties (contrast with steering)

- **Bidirectional**: either party initiates. Orchestrator initiates a `brief`; a worker initiates an `ask`. (Interruption never flows up — doc 10 §1a — but *communication* does.)
- **Turn-respecting**: messages are delivered at boundaries the recipient is ready for; they never preempt a turn. Urgency is expressed by *choosing* `at=tool_boundary` for a nudge, not by jumping the channel.
- **Ordered + durable + replayable**: every message is a ledger event; the channel is reconstructable from the ledger. No message is lost on a crash (contrast: a steering signal is fire-and-fence).
- **Addressed, point-to-point**: `(from, to)` are specific fleet members. This is the *expensive* channel (doc 10 T2) — every message costs the recipient's context — so it carries only what genuinely needs a directed exchange; ambient coordination goes stigmergically through the knowledge plane (doc 10 T3), not here.

## 2. Message types

```jsonc
// envelope common to all
{ "msg_id": "m_…", "from": "orchestrator|w_id|human", "to": "w_id|orchestrator",
  "kind": "...", "in_reply_to": "m_…?", "turn_epoch": 41, "ts": "...", "seq": 88213 }
```

| kind | dir | payload | delivery |
|---|---|---|---|
| `brief` | orch→worker | the task card (§3) | at spawn, or as a new turn |
| `nudge` | orch→worker | free text + `at: next_turn \| tool_boundary` | adapter outbox → chosen boundary (never mid-reasoning); flushed by interrupt (doc 09 A3) |
| `ask` | worker→orch | `{question, options?, blocking: bool, context_ref?}` | becomes a `question` wait-item (§4) |
| `answer` | orch→worker (or human) | `{in_reply_to, decision\|text}` | via `fleet_respond`; delivered at worker's next boundary; unblocks if `blocking` |
| `result` | worker→orch | the result contract (§5) | on task terminal transition |
| `digest` | hub→orch | provenance-typed summary (§6) | as `fleet_wait` return value |

Note `nudge` rides this channel but is *content* (cooperative, may-act-on-at-boundary); the moment something must *change the turn's trajectory preemptively*, it's a `steer` on the control plane, not a message here (doc 10 §6 Q3). The `kind` picks the channel and thus the guarantee.

## 3. The `brief` (downward task card)

The only context a worker gets — no orchestrator transcript (doc 06 Q6, doc 10 T2). Schema:

```jsonc
{ "goal": "…", "constraints": ["…"], "path_scope": ["src/auth/**"],
  "definition_of_done": "…", "verification": { "command": "pytest tests/auth", "expect_exit": 0 },
  "budget": { "tokens": 200000, "usd": 5.0, "wall_min": 30 },
  "orientation_ref": "art:…",       // a capability-plane repo-map handle (doc 11 orientation), NOT inlined prose
  "brief_template": "codex-v2" }    // per-harness brief dialect (doc 06 Q6; Codex≠Claude prompting)
```

The brief is authored per-harness (a Codex brief and a Claude brief for the *same* task differ — the `gpt-5-4-prompting` skill exists for exactly this translation). It is **pinned outside the transcript** where the harness supports it (Codex `thread/goal/set`) and **re-injected on compaction** (Claude `PreCompact` hook) so it survives (doc 09; adapter-contract goal-pin row). Orientation and other bulky context are passed **by artifact-store handle**, not inlined — the worker fetches what it needs (capability-plane §3).

## 4. The `ask` / `question` flow (the worker's voice — the missing primitive)

Review round 1 (doc 09 §E1) found workers had no way to ask; a blocked worker could only guess or hang. The fix: `ask` is a first-class message, distinct from an approval.

- A worker emits `ask{question, blocking}`. It maps to the A2A/MCP-tasks **`input_required`** interrupted state (doc 03) — the worker's task status becomes `input_required`, and the ask surfaces as a **`question` wait-item** (distinct from an `approval` wait-item) in the next `fleet_wait` return.
- `blocking:true` → the worker parks (status `input_required`) until answered; `blocking:false` → the worker continues on its best guess and the answer, if it arrives, is a course-correction nudge.
- Answered via `fleet_respond(msg_id, answer)` by the orchestrator OR the human (single-consumer, same CAS as approvals — supervisor I2 — so a human and the orchestrator don't double-answer).
- **Timeout policy** (parallels approval timeout, doc 05 §5): a blocking `ask` with no answer within the deadline resolves to `deny-licensing-status=blocked` — the worker is told "no answer available; return `status=blocked` with what you needed, or proceed read-only." A worker is never stranded on an unanswered question, and never told to guess on something safety-critical.

Why distinct from approval: an *approval* is "may I do this dangerous thing" (default-deny, security-load-bearing); a *question* is "which of these should I do / what did you mean" (default-blocked-then-unblock, correctness-load-bearing). Conflating them makes every clarification look like a security event and every security event answerable by "sure." The wait-item type separates them; `fleet_respond` handles both with the right defaults.

## 5. The `result` (upward result contract)

A worker's terminal output. **Non-authoritative** (doc 09 §C1): its `verification` block is a *claim* the hub re-runs (supervisor I7, capability-plane §6).

```jsonc
{ "status": "completed | failed | blocked | cancelled",
  "summary": "≤ N tokens — what changed and why",
  "artifacts": { "commits": ["sha"], "diff_ref": "art:…", "files": ["…"] },
  "verification": { "command": "…", "claimed_exit": 0, "tail_ref": "art:…" },  // CLAIM — hub re-executes
  "open_questions": ["…"],
  "budget_used": { "tokens": …, "usd": … } }
```

The hub, on receipt: re-runs `verification` in the worker's/fresh sandbox; on mismatch, stamps the result `unverified` and refuses merge. Prose in `summary` is wrapped as untrusted worker output when it enters the orchestrator's context (doc 09 §D4). The worker cannot forge the provenance frame (capability-plane §6). A worker that can't fill the contract isn't done, whatever its prose says (doc 06 Q6).

## 6. The `digest` (hub→orchestrator, provenance-typed)

What the orchestrator actually reads from the fleet, as the `fleet_wait` return value (doc 05 §3, doc 09 §D4). Provenance-typed so the orchestrator never confuses hub-computed fact with model-authored prose:

```jsonc
{ "cursor": "…", "more": false,
  "attention": [ /* blocked workers / questions / approvals / budget alarms FIRST */ ],
  "facts":  [ { "worker":"w3", "kind":"lifecycle.turn_completed", "diffstat":"+40-3", "budget":"82%" } ],  // hub-computed, trusted
  "prose":  [ { "worker":"w3", "text":"…", "provenance":"model-authored", "untrusted":true } ] }           // delimiter-wrapped
```

Default digest is `facts` only (mechanically templated — tool calls, diffstat, exit codes, tokens); `prose` (model summary) is opt-in and always marked untrusted (doc 09 §D4, agent-xp C6). Attention items (questions, approvals, alarms) are ordered first and are the priority lane (supervisor §4).

## 7. Delivery & ordering guarantees

- **Per-pair ordering**: messages between a given `(from,to)` are delivered in `seq` order.
- **At-least-once** with `msg_id` dedup (mirrors the ledger's I3 cursor discipline).
- **Durable**: the channel is a projection of the ledger; a crashed orchestrator re-reads unacked messages on restart (`fleet_list` + cursor — doc 09 §F2, the differentiating demo).
- **Fenced**: every message carries `turn_epoch`; a stale-epoch `answer`/`nudge` (composed against a turn that has since ended) is dropped, not applied to a fresh turn (doc 05 §4, supervisor I1). This is the comms-channel echo of the steering channel's fencing — same mechanism, so an answer to a question the worker has moved past doesn't misfire.

## 8. What does NOT go on this channel

Design law #3 (doc 10 §5): worker↔worker messages. If two workers need to coordinate, they do it **stigmergically** through the knowledge plane — a blackboard tuple (`take` the payments/ lease), a shared note, a commit — not a directed message. A worker↔worker message is a decomposition smell (doc 06 Q6); the absence of the verb is the enforcement. Ambient "what's everyone doing" is a read of the ledger/blackboard, not a broadcast. The communication channel is *only* orchestrator↔worker and human↔anyone.

## 9. Open questions

1. Can a worker `ask` the *fleet* (broadcast question) rather than the orchestrator — e.g. "has anyone already solved this migration"? That's really a knowledge-plane query (BoK/blackboard), not a broadcast message; route it there (doc 11 causal-research module) and keep the channel point-to-point.
2. Should `answer` be able to carry an artifact handle (the orchestrator answers a question with a file/diff, not just text)? Likely yes — reuse the artifact-store handle mechanism; the worker fetches.
3. Rate-limiting the `ask` channel: a confused/adversarial worker could flood questions to DoS the orchestrator/human (red-team `adversarial-worker`). Per-worker ask budget + coalescing, mirroring the approval-flood defense.
