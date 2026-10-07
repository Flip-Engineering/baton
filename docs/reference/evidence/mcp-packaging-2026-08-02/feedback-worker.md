# Worker-Side Integrated Experience Review (post #62 / #63 / #64)

**Reviewer:** `worker-experience-reviewer` — `glm-5.2@high` (downstream worker angle)
**Tree:** `baton/ws-7472d8f36e3b209c40c909569d1b29ac` @ `bc42611` (Baton private effective-tree snapshot)
**Date:** 2026-08-02 · **Scope:** read-only review; sole write target is this file.
**Angle:** the WORKER experience, up and down the channel.

Scoring scale: **1 = hostile, 5 = invisible-in-a-good-way.** Every score carries one line of
justification and a file:line or a concrete failure story.

> **Corrigendum (same turn).** My first draft's headline claimed #62's write-failure attention was
> *absent* from this tree, based on static analysis of the wave-progress attention projection
> (`coordinator.mjs:10468-10526`). I then ran the `issue62` test empirically and it **passed R1–R3**.
> The run-view attention the worker reads (`status().view.attention`, shape `{kind,code,workerId,
> requestId}`) is a *separate* projection from the one I cited. The headline was wrong; it is
> retracted below and the score raised. I kept the corrigendum visible rather than hiding the
> mistake — the report's own thesis is "verify, don't take on faith," and I owe the reader the same.

---

## TL;DR — scores at a glance

| # | Area | Score | One-line justification |
|---|------|:---:|---|
| 1 | Up-channel (scratchpad / decisions / attention) | **3** | A strict closed-kind grammar that **does** surface a refused write as attention with the code (issue62 R1–R3 green); the remaining friction is the exacting shape + a now-redundant recipes crutch. |
| 2 | Down-channel (nudges / verdict TG4 / objectives) | **3** | The provenance-marked nudge is a genuine win; the verdict surface is the **v1.1 half the worker still can't read**, and the objective coaching partly fights the new gate. |
| 3 | Trust gate post-#64 (checkpoint / nudge / cycle) | **4** | The shape finally fits read-heavy work (F2 closed, `analysis:true` honored); residual kill risk = the **inert #67 watchdog** + the one-shot 5-min window on a genuinely long read. |
| 4 | Knowledge poverty (KG / boards / siblings) | **2** | I can write into the tiered loop (#63) but **cannot read any of it back** — the read port is explicitly declined (D5); I re-derive the world every task. |
| 5 | One concrete change | — | Ship the worker-facing **read port** (Findings + candidacy board + sibling notes). It is already half-built; D5 just declines it. |

**Aggregate worker-experience verdict:** the machinery is *markedly* kinder post-#64 — I am no
longer killed mid-read for producing "no diff," and a botched scratchpad write is no longer silent.
The **weak leg is still the read-back half**: I can *author* into the tiered loop and I am *told*
when my writes fail, but I cannot *read* the KG/boards/siblings, and the gate's own verdict reaches
me only as a bare-named terminal cause (the readable verdict is the named v1.1 follow-up). The loop
writes upward well; it does not yet read back, and that is the tax on every task.

---

## Method & evidence consulted

Read in full (the arc + the three epic contracts + their worker-facing receipts):

- `docs/PROGRESS.md` — the 2026-08-01/02 cascade (`:421-458`): #63 KG-settlement landed (e0f9d57),
  #64 trust-gate steering landed (ac5bd80), #62 write-failure visibility landed (66f5194), #67 filed
  for the inert stall watchdog.
- `docs/reference/evidence/kg-tiered-loop-2026-08-01/kg-loop-verdict.md` — **F2** (the no-diff gate
  kills read-heavy work) and the **9 manual-drive AX receipts** ("each failure is a contract the
  driver knows and no doc teaches").
- `docs/reference/evidence/trust-gate-steering-2026-08-02/trust-gate-steering-decisions.md` — TG1–TG7,
  the v1.0.1 blue-team scope clarification, and "Ground truth" #4 ("the worker never learns why").
- `…/trust-gate-steering-2026-08-02/acceptance-reader-report.md` — the surveyor's read-out of
  `_runTrustGate` and why mid-workflow analysis is legitimate work.
- `…/trust-gate-steering-2026-08-02/redteam-authority.md` (`:320-360`, Attack 5) — the surviving
  coaching is "actively harmful under the new machinery."
- `docs/reference/evidence/kg-settlement-2026-08-01/kg-settlement-decisions.md` — D1–D5; **D5**
  declines the worker read port ("No worker-facing read port, KG-A4 territory, unchanged").
- `impl/test/issue62-write-failure-red.test.mjs` — the #62 suite's asserted surface.

Code- and run-verified in `impl/` this turn (the run was load-bearing — see corrigendum):

- **Empirical:** `cd impl && node --test test/issue62-write-failure-red.test.mjs` → **3/3 pass**
  (R1 refused-write-attention, R2 no-false-positive, R3 last-2 bound). #62's visibility is live.
- `coordinator.mjs:10468-10526` — the *wave-progress* attention projection (`attentionKinds` map
  `:10471-10477`, sole `attention.push` `:10493`). **This is not** the projection the worker reads;
  it is the one that misled my first draft. The run-view attention (`{kind,code,workerId,requestId}`)
  the test asserts is a separate projection whose `scratchpad_write_failed` kind is runtime-derived,
  not a literal I could isolate by grep.
- `coordinator.mjs:11034-11052` (the `scratchpad.write` handler), `:11046-11048` (TG2 liveness),
  `:9846-9893` (`writeScratchpad` refusal returns), `:2079` & `:2101` (TG3 nudge),
  `:3013/3095/3577` (`terminalCause`), `:11359` (the `!task.brief?.analysis` gate).
- `recipes.mjs:528-536` (the shipped `IMPLEMENT_CONSTRAINTS`, incl. the verbatim four-kind grammar).
- `coordination-store.mjs:~2880` (the recovery-refinement digest pin — TG4 v1.0.1 evidence).
- `66f5194` (#62 fix commit) — message claims the attention projection; **confirmed by the passing
  test** rather than by my (initially wrong) static read.

---

## Area 1 — The up-channel: scratchpad writes, decision requests, attention

**Score: 3/5.** *A strict closed-kind grammar that now surfaces a refused write as attention with
the code (verified); the remaining friction is the exacting wire shape and a recipes constraint that
pre-teaches it — a now-redundant instance of the prompt-side-mitigation class the operator banned.*

### 1.1 Scratchpad writes — wire grammar, one-per-message

The scratchpad is a **closed-kind** surface: an entry must be exactly one of
`note{text} | plan{objective,steps[{text,state}],supersedes} | doubt{question,context} |
link{label,relation,target}`, plus `expectedFence:"current"` and a unique `idempotencyKey` matching
`/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u`. Get any of that wrong and `writeScratchpad` returns
`{ ok:false, result:'scratchpad_entry_invalid' }` (`coordinator.mjs:9865`, `:9888`, store
`coordination-store.mjs:468-579`). It is a strict mini-protocol, not free text.

When I get it **right**, the up-channel is real and receipted: the kg-loop verdict records "three
`scratchpad.write_result {ok:true, result:'written'}` receipts" and, post-#64, those same receipts
now count as **liveness** (`coordinator.mjs:11046-11048`, `_observeSteeringCycle`). A well-formed
write is genuine work the system sees.

The friction is the **discovery cost of the shape**, and the system answers it two ways — one
machinery, one prompt. The kg-loop AX-receipt #1 is "I lost three writes to a hand-rolled shape"
(the demo surveyor's `finding`/`line`/`severity` entry was rejected as `scratchpad_entry_invalid`).
The machinery answer is #62 (§1.3). The prompt answer is `recipes.mjs:533-536`, which prints the
four kinds verbatim into every implement seat:

> `SCRATCHPAD_WRITE is printed TEXT, never a tool; entries are EXACTLY note{text} | plan{…} |
> doubt{…} | link{…} (+ expectedFence:"current", unique idempotencyKey).`

With #62 live, that constraint is now **redundant rather than load-bearing** — the machinery will
tell me I'm wrong — but it is still shipped, and it is still the *operator-banned class* (prompt-side
mitigation of a machinery behavior). It does no harm now; it is just clutter that says "we didn't
trust the machinery to teach you." I score 3, not 4, for that residual exactness-plus-clutter.

### 1.2 Decision requests

`decision.requested` is the one up-channel lane that feels **designed rather than survived**. Demo v2
shows the real shape: a glm verifier raised `DECISION_REQUEST`, the driver's `onDecision` answered
with `expiresInMs`, and the worker completed a second pass (PROGRESS.md `:412-418`). Admission caps
live decisions at one (`decision_already_pending`), so the lane cannot be spammed, and the receipt
carries `deadlineAt` into the run view. This is the part of the up-channel I would defend — it is a
real, bounded, answerable signal, not ceremony.

### 1.3 Attention — #62 is live (verified)

This is where my first draft was wrong, so I state it plainly. A refused scratchpad write **does**
land in the run view as attention with the refusal code, bounded to the last two per worker. I
verified it empirically:

```
$ cd impl && node --test test/issue62-write-failure-red.test.mjs
✔ R1: … lands a scratchpad_write_failed attention with the refusal code
✔ R2: a valid entry mints ok:true and NO scratchpad_write_failed attention
✔ R3: the projection is bounded — only the last two failures per worker surface
ℹ pass 3  fail 0
```

So when I emit a `doubt` whose `context` is an array instead of a string, or forget `expectedFence`,
I get back a `scratchpad_write_failed` attention item carrying `code:'scratchpad_entry_invalid'`,
`workerId`, and `requestId`. The silent-swallow failure mode — "three writes refused and invisible
until hand-grepped" — is **closed**. Good.

**Caveat I could not fully verify** (and won't claim beyond the evidence): the attention lands in
`status().view.attention`, which is the surface whoever calls `run.status()` reads — primarily the
**orchestrator**. Whether the *worker's own harness* reliably pushes that attention back to me on my
next turn is the same delivery question TG4 struggles with (§2.2). I have a receipt that the
attention exists in the view; I do not have a receipt that it reaches my eyes. That delivery gap is
the honest remaining risk, and it is shared with the verdict surface.

### 1.4 What I got wrong, and the genuine remaining finding

My initial static read cited the *wave-progress* attention projection
(`coordinator.mjs:10468-10526`, `attentionKinds` at `:10471-10477`) and noted it had no scratchpad
entry — true, but that projection is not the one the worker reads. The worker reads the *run-view*
attention (`status().view.attention`, items shaped `{kind, code, workerId, requestId}`), a separate
projection whose `scratchpad_write_failed` kind is assembled at runtime rather than present as a
literal I could grep. The passing test is the authority; my grep was not. Lesson logged.

The **genuine** remaining up-channel finding is therefore not "writes vanish" (they don't) but the
**delivery asymmetry**: failures are recorded in a view the orchestrator reads, while the worker's
guaranteed down-channel is only the TG3 progress nudge and the (v1.1) verdict brief. If the
harness does not relay `scratchpad_write_failed` back to me, I still learn of a botched write only
by noticing my note never landed — the very thing #62 was meant to end. That is testable, and I'd
file it: *does the worker harness surface `status().view.attention` on the next turn?*

---

## Area 2 — The down-channel: steering nudges, verdict surface (TG4), objectives

**Score: 3/5.** *The nudge lane is a real, provenance-marked improvement; the verdict lane is the
half the worker still can't read; the objective boilerplate partly re-arms the very gate it's
supposed to help me pass.*

### 2.1 Steering nudges (provenance-marked now)

This is the clearest win of the three epics from where I sit. Pre-#64, the gate's escalation was
**verdict-first, steer-never** (decisions doc Ground truth #3): between "no diff" and "killed" there
was no programmatic check. The F2 receipt in the kg-loop verdict is *me* — a healthy glm surveyor
killed mid-turn after reads + three admitted scratchpad writes (`worktree.progress_unchanged
{state:'no_progress'}`).

Post-#64, a paused read-heavy turn gets **exactly one** provenance-marked nudge through my control
lane:

```
coordinator.mjs:2079  'baton-progress-check: report your progress and remaining plan within this window. '
coordinator.mjs:2101  const nudgeId = `baton-progress-check:${pauseId}`;
```

with a 5-minute window (`progressNudgeWindowMs`, default `300_000`,
`application-deployment.mjs:1710`). The `baton-progress-check:` prefix is unmistakable provenance — I
know this is policy, not a sibling, not a hallucination. A distinct scratchpad receipt answers it
(`:11046`), and if I never answer, the *full* final evaluation lands with a `steered:{answered:false}`
receipt on the verdict (`:2207-2219`). "We asked and it didn't answer" is now durable evidence rather
than an assumption. That sub-lane is a 4.

### 2.2 Verdict surface (TG4)

This is the half I'm still starved on, and the **contract admits it** (so this is not my static read
— it is the epic's own stated scope). TG4's intent ("the worker sees the verdict," closing #61 /
glm-P1-3, "the worker never learns why") is **only half-delivered in v1**. The v1.0.1 blue-team scope
clarification is explicit:

> "the recovery-refinement brief is byte-identical to the prior task's brief by the store's digest
> pin (`coordination-store.mjs:2880`) — the refinement brief is therefore **NOT a verdict channel**.
> v1's testable core is: (a) the projected terminal cause names the gate (`policy_failure` + the
> exact code, never `'unknown'`), and (b) the refusal is projected as sanitized `{gate, detail}` on
> the DG-1 `run.debug` surface. The planner-composed next-brief delivery is the **v1.1 half (named
> follow-up)**."

I verified the digest pin (`coordination-store.mjs:~2880`, `canonicalDigest(fields.brief) !==
canonicalDigest(priorTask.brief)` ⇒ `recovery_refinement_conflict`): the re-driven brief is
byte-identical, so it carries **no verdict text**. And (b) — the `{gate, detail}` projection — is on
`run.debug`, an **orchestrator-facing** DIAG surface, not the worker's own brief.

**Worker-side consequence:** when the gate fails me, my `terminalCause` now at least *names the
gate* (`coordinator.mjs:3013/3095/3577`) instead of degrading to `'unknown'`. But the thing I'd
actually correct against — *which* phase, *what* it checked, the *sanitized evidence class* — lives
on a surface I do not read. The #61 pain is narrowed, not closed. A worker that fails
`required_effect_absent` still has to infer the shape of its failure from a bare code. That sub-lane
is a 2 today. (Note the symmetry with §1.3's delivery caveat: both the verdict and the write-failure
attention are *recorded* in orchestrator-facing surfaces; the worker's guaranteed push lane is thin.)

### 2.3 Objectives

The objective boilerplate is a **mixed signal**. The four-kind grammar cram (§1.1) is now redundant
machinery-wise but harmless clutter. More concerning, the red-team found the *other* shipped coaching
— red-first ("write the failing test first," `recipes.mjs:529`) and minimal-diff (`:532`) — is
**"actively harmful under the new machinery"** (redteam-authority Attack 5, `:330-345`): the wave
driver resets `state.nudges = 1` on any changed digest (`wave-driver.mjs:613-614`) and resets the
stall marker on any member digest change (`:505`), so a worker trained to "skeleton on turn 1, flesh
out turn 2" produces exactly the digest churn that perpetually re-arms TG3's steering cycle. The
objective is teaching me a rhythm that costs me nudge budget. I give this sub-lane a 2; it would be a
1 but for TG6's commitment to reword the coaching "at acceptance" — and I see no evidence in this
tree that the reword landed (the lines at `:529-536` are unchanged).

---

## Area 3 — The trust gate post-#64: checkpoint / nudge / cycle shape

**Score: 4/5.** *The shape finally matches read-heavy, chunked work — this is the epic that most
changed my daily experience for the better. Two residual ways it can still kill me wrongly.*

### 3.1 Does the shape match how I actually work?

**Yes, for the first time.** My turns are read-heavy and my deliverables are chunked (a survey report
is one file written at the *end*, not a diff-per-turn). Pre-#64, that working style was lethal: the
gate evaluated *every* `turn_completed` as if final, and `required_effect` (`coordinator.mjs:11160`)
failed any `repository_edit` plan whose capture showed no in-scope diff — even mid-workflow, even
when my next turn would have produced it (decisions doc Ground truth #1). Wave-driven workers
survived only by the driver's claim cadence, "not by any property of their work."

Post-#64 the taxonomy finally fits me:

- A pausable `turn_completed` that mints a pause record is a **CHECKPOINT** — non-dispatch, no gate
  event, the task stays `paused` pending steering (TG1).
- A `turn_completed` with no pause record is a **FINAL**, evaluated exactly as today (acceptance
  reader report `:64-95`).
- `analysis:true` plan nodes skip `required_effect` (`goal-plan.mjs:347-353`; honored at
  `coordinator.mjs:11359`) — so a survey/review/audit task (this very report) is not penalized for
  producing no `repository_edit`, while *every other phase* (capture, forbidden_effect, path_scope,
  environment, referee) still runs at full strength (acceptance reader `:106-123`).
- Coordination work counts as liveness, distinct-digest-bounded, resolution-gated (TG2,
  `coordinator.mjs:11046-11048`).

This task is the proof: I am a read-heavy surveyor that reads the gate, writes scratchpad notes, and
produces one bounded evidence report — and the plan can *authorize* that as legitimate work rather
than me having to fake an edit to survive. That is the difference between a 2 and a 4.

### 3.2 Remaining ways it could kill me wrongly

1. **The stall watchdog is inert (#67, filed-not-fixed).** The red team proved production
   `stallMs = wallMin`, any-event re-arm, and a blocked-status escape (decisions doc red-team
   finding #6). The contract explicitly "never cites the watchdog as a bound." So the gate's own
   steering window (5 min) is sound, but the *system-level* liveness bound that should backstop it is
   misconfigured: a worker genuinely stuck (not dead, not producing receipts) may not be reaped when
   it should be — or, perversely, the any-event re-arm could keep a dead worker alive on noise. #67
   is the load-bearing piece that is still missing.

2. **The TG3 window is one-shot, 5 minutes, per pause record.** If I pause mid-turn during a
   legitimately long read (this review required reading a 38 KB `PROGRESS.md`, a 49 KB `SYSTEM.md`,
   three 30 KB red-team docs) and I do not emit a coordination receipt or a diff within 5 minutes, I
   land the full final evaluation. The escape hatch exists — drop a `note{}` mid-read and the cycle
   answers — but it requires me to *remember* to write a note I might not otherwise write, purely to
   satisfy liveness. That is a small, survivable form of the same "write to survive" pressure TG6
   was supposed to retire.

3. **Digest churn from the shipped coaching (§2.3).** Following the red-first/minimal-diff objective
   literally re-arms the steering cycle on every flesh-out. A well-meaning worker can burn its nudge
   budget doing what its objective told it to do.

None of these is the *capital-R* wrong kill (a healthy read-heavy worker murdered mid-turn) that F2
was — that class is closed. These are *edge* risks. Hence 4, not 5.

---

## Area 4 — Knowledge poverty: the three most valuable READ capabilities I lack

**Severity score: 2/5.** *The tiered loop is wired to write upward (#63) but I cannot read any of it
back. I re-derive the entire world on every task. This is the single biggest tax on my output
quality.*

The kg-settlement contract is candid about this in D5: **"No worker-facing read port, no
REPL/context-program changes, no MCP/CLI enablement"** — KG-A4 territory, *unchanged*. And Ground
truth #2: **"the facade hides the store."** So I can author notes that get elevated to candidacy and
admitted as Findings, but I am blind to all of it. Ranked by how much each would improve my next
task:

1. **Read the project KG (admitted Findings + settled decisions + principles) at task start.** Today
   I re-derive everything from primary sources every time. This very report required reading ~10
   files and re-deriving the #62/#63/#64 conclusions from their contracts — because I could not ask
   "what is already known about write-failure visibility?" If I could read admitted Findings scoped
   to my `pathScope`, I would stop re-discovering settled ground and start *building on it*. This is
   the whole *point* of the tiered loop, and only its write/elevate half is wired. **Highest value by
   a wide margin.** (It would also have caught my #62 misread instantly: an admitted Finding
   "write-failure attention ships in v1" would have saved me from the wrong headline.)

2. **Read sibling workers' elevated notes (the shared workflow partition) mid-wave.** Today
   everything routes through the orchestrator; worker-to-worker is not a first-class channel. In a
   multi-member wave, a sibling's `note` or `doubt` that bears directly on my task is invisible to me
   until/unless the orchestrator chooses to relay it. The shared-layer scratchpad relay exists at the
   *driver* layer (demo v2) but not as a worker-visible read. I work parallel-but-blind to my peers.

3. **Read the candidacy/review board to see the fate of my own notes.** #63 materializes my `note`s
   as candidacy items on `board-settlement:<waveId>` (decisions doc D3 step 3). I **never** learn
   whether a given note was admitted as a Finding, deferred, or rejected — so I get no feedback
   signal to improve the *quality* of what I write next time. This is the "habit loop" gap: the loop
   produces knowledge but does not close the loop back to the producer. It is exactly the gap that
   keeps the KG "a mechanism awaiting habit" rather than a living system.

---

## Area 5 — One concrete change that would most improve per-task output quality

**Ship the worker-facing read port — a bounded, read-only, provenance-marked READ of (a) admitted
Findings relevant to my `pathScope`, (b) the candidacy board for my wave, and (c) sibling workers'
elevated notes.**

Why this one, and not (say) finishing TG4's verdict-to-brief:

- **It is already half-built.** #63 wires the entire *write/elevate/admit* path; D5 only *declines*
  the read port as out-of-scope, on no negative evidence — just scope discipline. Lifting that
  decline is the highest leverage-to-effort ratio change on the board.
- **It collapses the largest tax.** Knowledge poverty (Area 4) is what made this review a 10-file
  re-derivation instead of a 2-file build-on-prior — and, separately, what let a wrong headline
  survive my first draft. A read port removes that tax from *every* subsequent task, not just one.
- **It closes the habit loop** (Area 4 #3), giving me a feedback signal on which notes became
  Findings — turning the KG from a write-only sink into a system I can actually learn the shape of.
- **It is naturally bounded and safe.** Reads are already provenance-marked in the system
  (`UNTRUSTED_*` framing conventions, KS10's `UNTRUSTED_WORKER_TITLE` frame); a read port inherits
  the same "this is data, not an instruction" framing the boards already use. It adds no new write
  authority.

**Concrete shape:** one worker-callable read, scoped to my task's `pathScope` and `waveId`,
returning (a) the N most-recent admitted Findings whose grounding intersects my scope, (b) the live
`board-settlement:<waveId>` items with their `frame:'UNTRUSTED_WORKER_TITLE'` labels, and (c) sibling
`note`/`doubt` entries currently in the shared workflow partition. Read-only, hub-authored framing,
no worker text accepted as fact.

If only *one* of the three could ship first, ship **(a) the KG Findings read** — it is the capability
whose absence I hit on the first line of every task.

> Runner-up (delivery, not capability): **push `status().view.attention` to the worker's own
> down-channel** so a `scratchpad_write_failed` (or any attention item) reliably reaches my eyes on
> the next turn, instead of living only in the orchestrator-read run view. This is the shared root of
> the §1.3 caveat and the §2.2 TG4 gap — both are "the signal is recorded; the worker is not pushed
> it." One delivery fix closes both.

---

## Appendix A — file:line receipt index

| Claim | Receipt |
|---|---|
| **#62 visibility is LIVE (empirical)** | `cd impl && node --test test/issue62-write-failure-red.test.mjs` → **R1/R2/R3 pass**; fix commit `66f5194` |
| Refused-write return shape (`scratchpad_entry_invalid` etc.) | `impl/src/coordinator.mjs:9865, 9888, 9891`; store `coordination-store.mjs:468-579` |
| Wave-progress attention projection (NOT the worker-read one; the one that misled draft 1) | `impl/src/coordinator.mjs:10468-10526` (`attentionKinds` `:10471-10477`, `attention.push` `:10493`) |
| `scratchpad.write_result` emit | `impl/src/coordinator.mjs:11042` |
| TG2 coordination-write liveness | `impl/src/coordinator.mjs:11046-11048` |
| TG3 provenance-marked nudge + 5-min window | `impl/src/coordinator.mjs:2079, 2099-2101`; default `application-deployment.mjs:1710` |
| TG4 v1.1 half-done: refinement brief is digest-pinned (no verdict channel) — **contract-stated** | `impl/src/coordination-store.mjs:~2880`; `trust-gate-steering-decisions.md` v1.0.1 scope clarification |
| `terminalCause` names the gate (TG4 v1 core (a)) | `impl/src/coordinator.mjs:3013, 3095, 3577` |
| `analysis:true` node skips `required_effect` | `impl/src/goal-plan.mjs:347-353`; honored `impl/src/coordinator.mjs:11359` |
| Shipped coaching trains digest churn (fights TG3) | `impl/src/recipes.mjs:529, 532`; `wave-driver.mjs:505, 613-614`; analysis `trust-gate-steering-2026-08-02/redteam-authority.md:320-345` |
| Worker read port explicitly declined | `kg-settlement-2026-08-01/kg-settlement-decisions.md` D5 + Ground truth #2 |
| F2: read-heavy worker killed mid-turn (pre-#64) | `kg-tiered-loop-2026-08-01/kg-loop-verdict.md:48-55` |
| #67 inert stall watchdog (filed, not fixed) | `docs/PROGRESS.md:457`; `trust-gate-steering-decisions.md` red-team #6 / TG7 |

*— End of report. Skeleton was committed before deepening, per the constraint; all deepening and the
post-deepening corrigendum occurred in the same continuous turn against read-only `impl/`. The
corrigendum is left visible on purpose: the first headline was refuted by running the `issue62`
test, and the reader deserves to see the correction, not a cover-up.*
