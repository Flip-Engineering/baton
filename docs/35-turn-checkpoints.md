# 35 — Turn Checkpoints: steer, don't gate

Status: design groundwork for issue #31 (spec v1, pre-red-team). The operator's rule: turn-based
limits make smart systems shallow and brittle — steer programmatically (nudge / check progress),
never gate on turn boundaries. Grounded in the dogfood evidence: w-144 (gated worker killed by
required_effect_absent), w-145 (settlement refused, 29-minute stall), w-153 (bloc reviewer killed
mid-investigation), the board-package suite-wait kill, and the decision-live series.

## 1. The truth today

`lifecycle.turn_completed {status:'completed'}` is an automatic **result claim**: the coordinator
launches the trust gate (capture + verification + required/forbidden effects) the moment any
provider turn ends (coordinator.mjs:9901-9913 region), exempt only while a blocking interaction
record is literally pending (8595e40). Every generation stop is treated as "the work is done."

That is false for ordinary agent work. Workers pause mid-task constantly — to think, to wait on
a sub-tool, to run a multi-minute test suite, to dispatch their own subagents — and at that
moment there is legitimately no in-scope diff, so the gate kills them (`required_effect_absent`).
Four healthy workers died to it in one cycle. My own mitigation attempts (prompt-coaching
"never pause; write the skeleton first") were effective once and structurally wrong: they fight
the model's nature with instructions instead of steering the machinery.

The steering machinery to do this right already exists: drivers poll progress (`wave.progress`),
answer attention items, and nudge members onward (`wave.send`, coordinator `prompt` modes).
The gate simply fires before any of it can act.

## 2. Design

### 2.1 A completed turn is a checkpoint, never a claim

1. **Claim vs pause is an adapter-card declaration.** `card().turnCompletion` ∈
   `{ 'claim', 'pausable' }`. Scripted test doubles whose scenarios END the work (MockAdapter
   `scenario.outcome`) declare `claim` — their turn end IS the completion signal, preserving
   today's semantics exactly. Interactive harnesses (claude, codex, grok, kimi, glm) declare
   `pausable` — a provider result frame is a pause by default, never a claim.
2. **A pausable turn end mints a checkpoint record**, not a gate: durable, replay-exact,
   single-consumer, in the interaction family (a sibling of question/approval/decision):
   `turn.checkpoint { workerId, taskId, turnEpoch, diffDigest, changedPathsDigest, pendingTool? }`
   admitted at the boundary, with the task transitioning to `checkpointed` (a new non-terminal
   state beside input_required/working — honestly named, never disguised as working).
3. **The trust gate consumes CLAIMS, never checkpoints.** Required-effect and verification
   evaluation happens exactly once, at an explicit completion claim: the worker's own done
   signal through the verdict path, or the orchestrator's settle act (2.2). A checkpoint NEVER
   evaluates required effects — by construction there is no claim yet.

### 2.2 The orchestrator steers per checkpoint

4. **Checkpoints surface as first-class attention** (`turn_checkpoint` classification with a
   sanitized diff summary), visible in RunView, wave progress, and the MCP/CLI surfaces — a
   driver sees "paused with N changed paths" instead of a bare phase string.
5. **Three steering acts, single-consumer, fenced:**
   - `nudge` — prompt-continue the SAME session (the existing prompt lane; the worker resumes
     with its full context and any orchestrator guidance).
   - `wait` — leave the checkpoint parked (long-running tool/suite/subagent waits are legal;
     a parked checkpoint emits nothing and costs nothing).
   - `settle` — the orchestrator claims the result on the worker's behalf; the trust gate runs
     with the checkpoint's diff evidence. Settle is the ONLY way a paused turn reaches the gate.
6. **Backward compatibility is the degenerate case.** With no driver steering attached (plain
   `baton.runs.start` without a watching driver), a checkpoint auto-settles immediately —
   preserving today's exact semantics for single-turn flows and the entire existing suite.
   "No driver" is defined per-run: a wave member has a driver by construction; a bare run has
   one only if a controller attached. The auto-settle is honest and receipted, not a silent
   fallback.
7. **Bounded parking, never silent.** A checkpoint parked beyond a deployment-owned bound with
   no driver steering escalates VISIBLY (attention escalation class), never auto-kills. What
   escalation does — settle-with-partial-evidence vs typed stop with preserved work — is a
   deployment policy, named in receipts. Subagent-dispatch pauses are explicitly supported: a
   worker whose own agents are in flight parks legally and resumes on their return (nested-
   agent authority questions stay under issue #12).

### 2.3 What dies

8. The `input_required`-pending-record exemption (8595e40) is subsumed: a blocking interaction
   pending IS a checkpoint with a named pending record; one mechanism, not two. The phase11
   CK2/CK8 flow (turn completes during answer delivery) and the decision-gate flow both map
   onto checkpoint + settle naturally, and their tests keep passing through the degenerate
   auto-settle.
9. No prompt-level prohibitions are needed anywhere: objectives stop carrying "never pause",
   "no subagents", "write skeleton first". (The acceptance rule for this epic includes a live
   wave whose member pauses twice mid-task and completes via nudges, and a driver objective
   containing none of those phrases.)

## 3. Non-goals

No removal of the trust gate itself — capture/verification/effects stay, moved to claim time.
No change to MockAdapter claim semantics (the suite's backbone). No nested-orchestration
authority model (issue #12). No prompt-level steering language anywhere in the machinery —
steering is programmatic acts, not instructions. No capability restriction by default
(issue #32's calibration stands: large models keep full toolsets).

## 4. Issue breakdown

- **31-a**: checkpoint record + card declaration + `checkpointed` state + degenerate
  auto-settle (the backward-compat spine; the suite must stay green unchanged).
- **31-b**: steering acts (nudge/wait/settle) with single-consumer fencing + attention
  classification + RunView/wave/MCP projections.
- **31-c**: claim-time effect evaluation move + bounded-parking escalation policy + the live
  pause-twice wave acceptance.
