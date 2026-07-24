# Dynamic workflow demo — acceptance record (2026-07-24)

The operator's standing question: *can baton demonstrate dynamic workflows of multiple agents
coordinating (homogeneous and heterogeneous), using the shared-layer features and interacting
bidirectionally with the orchestrator, under a dynamic script the orchestrator steers live?*

This is the acceptance record for the demo campaign that answered it — seven demo waves
(v1–v7), the artifacts they produced, the machinery defects they surfaced (three fixed in
flight), and an honest accounting of what is and is not yet proven.

## 1. What was run

A workflow with a scripted but *responsive* shape: a drafter produces an agentic-experience
report from salvaged research notes (9 grounded frictions, `research-notes.md`, recovered from
the v3 glm researcher), a critic reviews it, the orchestrator relays between them through the
shared layer, and one stage contains a live decision gate. Seven attempts, each an iteration on
real fleet/machinery failures:

| Wave | Seats | Outcome |
|---|---|---|
| v1 | grok + kimi + sonnet | both non-claude seats failed at spawn (grok auth, kimi `effort_unavailable`) |
| v2 | grok@low + kimi@low + sonnet | identical failures — grok's token had expired 28 min post-login |
| v3 | glm×2 + sonnet | researcher produced 144-line research notes + first scratchpad attempt; **second concurrent glm never spawned** (silent unclaimed dispatch, run projected `working` — issue #49) |
| v4 | glm + sonnet | **decision gate answered live**; 13 grammar attempts, 1 accepted write; my driver crashed on an object-typed entry field |
| v5/v5b | glm + sonnet | fence-repair designed, then the driver hung 4h inside `run.events()` (the timeline generator *follows* forever); killed by task timeout |
| v6 | glm + sonnet, `expectedFence:"current"` | decision gate (4th proof) + **first `'current'` write accepted** — then the glm drafter hit its ~20-min envelope (issue #50) |
| v7 | sonnet×2 (homogeneous) | entry accepted at 91s; drafter churned the file through ~60 short turns (in flight at writing) |

## 2. What is PROVEN (with receipts)

1. **Bidirectional worker→orchestrator→worker decisions.** Four live gates across glm and
   sonnet seats: the worker poses `DECISION_REQUEST` (multi-choice + recommended + free-text
   flag), the run parks `input_required`, the driver answers through `run.act('answer_decision',
   {optionId})`, the worker continues on the answer. Every gate durable and attributed in the
   coordination ledger.
2. **Workers writing the shared layer.** `SCRATCHPAD_WRITE` grammar → hub admission →
   `scratchpad.write_result` receipt → entry visible in `wave.progress()` member views. glm and
   sonnet seats both posted accepted entries.
3. **Turn-checkpoint steering at scale.** Hundreds of `nudge_turn` acts across the demo waves
   with requestId-keyed dedup; pausable turns park, the driver steers, no prompt-coaching anywhere.
4. **Orchestrator-controlled dynamic script.** Stage gates fire on what workers surface (entry
   counts, not timers); per-role nudge holds (the critic was never nudge-treadmilled awaiting
   input — the v4 critic's 100+ nudge treadmill was diagnosed and fixed by design in v5+).
5. **Heterogeneous and homogeneous waves.** glm+sonnet (v4–v6) and sonnet×2 (v7) — plus the
   campaign's codex+kimi+opus red-team swarms and the two-seat implementation handoffs
   (opus SP1–SP5 → codex SP6–SP11 on #33; codex contract → opus review on the grammar doc).

## 3. Machinery defects the demo SURFACED (and their dispositions)

1. **The scratchpad fence chase (issue #48 erratum — FIXED and consumed live).**
   `expectedFence` is the worker *turn* fence — unobservable from inside a harness and advanced
   by every steering event. The demo logged **0/24** accepted writes under numeric fences, and
   the driver's FENCE REPAIR sends chased a target that moved with every nudge. Fixed as
   `expectedFence: "current"` (live-fence resolution at admission; idempotencyKey carries retry
   safety) in `71ea8ff`, pinned by D11 + scanner rows, suite 2880/2880 — and the fix was
   consumed *by the demo itself* within the hour (accepted writes in v6/v7).
2. **Second concurrent glm never spawns (issue #49 — open).** Dispatched, unclaimed, zero
   error, run reports `working` for 30+ minutes. The worst terminal taxonomy — invisible.
3. **glm provider stream dies at ~20 min (issue #50 — open).** 3/3 glm waves stalled
   identically; two full artifacts salvaged from checkpoint pins; tasks must fit a ~15-min
   envelope until the adapter detects stream death.
4. **Done-but-paused is indistinguishable from stuck-but-paused (issue #51 — open, the
   operator's own observation).** The #45 opus worker said "Done — both suites green" 118 times
   into a void. Upward state feedback is thinner than downward steering; three design
   directions filed.
5. **The embedded facade lacks the shared-layer write surface (issue #48 — open).** Boards are
   MCP-only, elevation is kernel-only, `run.scratchpad()` unwired, REPL orchestration
   kernel-only. The full orchestrator-controlled-boards vision needs this slice.
6. **Driver anti-patterns, all receipted and productized in #46:** flat watchdogs kill healthy
   workers; phase-only stall markers kill them faster; `run.events()` follows forever;
   `[object Object]` in log lines is always a missing `String()` guard.

## 4. What is NOT yet proven

1. **The full inter-agent relay end-to-end** (drafter chunks → critic review → doubts →
   revision): every demo wave proved the *mechanics* of each hop (writes, projections, sends)
   but the complete chain has not yet closed in one wave. v7 was in flight at this writing;
   its receipts append below.
2. **Orchestrator-controlled durable BOARDS** as the task substrate (needs issue #48's facade
   slice — workers currently receive tasks by objective and context by `run.send`, not by
   reading a shared board).
3. **Scratchpad ELEVATION** (task→workflow→project): the kernel methods exist and are
   suite-pinned; no production orchestration surface can invoke them yet (also issue #48).

## 5. The artifacts

- `research-notes.md` — 9 grounded AX frictions (v3 glm researcher, salvaged from worktree).
- `report-draft.md` — the v5 glm drafter's 119-line AX report (salvaged; v6/v7 drafts append).
- `receipts-v4.md` — the v4 driver's inter-agent log (decision gate, 125 nudges, the treadmill).
- `run-demo-wave.mjs`, `run-demo-wave-v4.mjs`, `run-demo-wave-v5.mjs` — the driver lineage, each
  a lesson in what a shipped driver must own (now productized as `createWaveDriver`, #46).

## 6. Verdict

The demo's purpose was to prove the coordination mechanics and surface what reality wouldn't
tolerate. Both succeeded: every shared-layer mechanic is live and receipted, and the demo
produced five filed issues, one consumed-in-flight machinery fix (#48 erratum), and the
productized driver (#46). The remaining unproven beats (full relay chain, boards, elevation)
are blocked on issue #48's facade slice — which the demo's evidence now fully specifies.

## 7. The loop CLOSED (v12, 2026-07-24T17:47–18:04Z)

The full inter-agent relay completed with every hop receipted:

1. **orchestrator → critic:** the driver pushed the committed 126-line draft via `run.send`
   (17:47:53).
2. **critic → shared layer:** the sonnet critic reviewed it *substantively* — re-read every
   cited source, diffed claims line-by-line, posted **5 doubt entries** via `SCRATCHPAD_WRITE`
   (17:50:55) and wrote an 80-line `critique.md` with five grounded findings + an independent
   verification pass.
3. **shared layer → orchestrator:** the driver read the doubt entries from `wave.progress()`
   member scratchpad views and relayed them to the reviser via `run.send` (dynamic
   reprioritization, 17:50:55).
4. **reviser → shared layer:** the reviser posted its resolution entry (`written`) and
   concluded "No change" with reasoning (17:59:14).

Every hop ran through baton machinery — down-channel `run.send`, up-channel prose grammar,
durable scratchpad entries, wave projections, dynamic stage gates, turn-checkpoint steering.
No file-system shortcuts between agents.

**The deepest AX finding of the campaign (v10):** a worker that completed its manifest
correctly DECLINED to post entries because "No SCRATCHPAD_WRITE-capable tool exists in my
environment" — it pattern-matched the grammar as a harness tool, searched its tool list, found
none, and skipped the step. The prose up-channel is undiscoverable as *prose* unless the brief
says so in those words. v11's "SCRATCHPAD_WRITE IS NOT A TOOL — it is TEXT you print"
instruction fixed it instantly. Filed under #51 (upward-feedback discoverability: the brief
advertisement must state the prose nature, not just the grammar shape).

**Artifacts harvested:** `critique.md` (80 lines, sonnet, source-diffed), `report-draft.md`
(126 lines, sonnet drafter v7), `research-notes.md` (glm researcher v3), the v1–v12 driver
lineage and receipts logs in this directory.
