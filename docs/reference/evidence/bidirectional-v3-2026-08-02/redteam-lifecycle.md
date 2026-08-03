# BD3 collaboration-spine contract — LIFECYCLE red-team

**Attacker:** lifecycle-attacker (glm-5.2, effort=high)
**Contract:** `docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md` (v1.0 worker-validated + v1.1 layers matrix)
**Angle:** lifecycle — wake laws, poll loops, cursor chains, settle tombstones, detached-wave re-attach, coalescing, evidence accrual, pack/receipt reaping, run.stop/close.
**Date:** 2026-08-03
**Status:** COMPLETE. Every claim grounded in `file:line`.

> **Read-only review.** `impl/` is read-only here; this file is the only write target. The
> deployment profile's verifier is `command: 'true'` (run-bd3-redteam.mjs:20) — a no-op
> pass-through by design; the real verification is *this report's evidence traceability*, which
> the appendix (§8) makes machine-checkable.

---

## 0. Scope & method

**Scope.** The lifecycle dimension of the BD3 spine: everything that concerns *when work is
triggered*, *how a detached/dying process's record survives*, *how evidence accrues*, *how
artifacts are reaped*, and *what a receipt actually attests*. The authority angle (viewer-scope
leaks, injection framing, supersession, reply-laundering, candidacy-visibility) is the sibling
report `redteam-authority.md`; this report touches authority only where it is a *lifecycle*
consequence (e.g. a stale cursor that re-exposes a downgraded member, a caller-named reader
identity that enables evidence farming).

**Method.** For each of the six attacks I (a) quote the contract's claim, (b) read the actual
implementation the claim rests on, (c) construct a concrete failure scenario, (d) verdict it.
Verdicts: **CONFIRMED-HOLE** (the contract's claim is false or missing against shipped code),
**DEFENDED** (the claim holds; the seam the attacker would use is closed), **NEEDS-AMENDMENT**
(directionally right but under-specified — ship-able with a pinned amendment).

**Verdict ledger:**

| # | Attack | Verdict | One-line |
|---|-------|---------|----------|
| 1 | BD3-D inbox completeness — driver actions → wake reasons | **CONFIRMED-HOLE** | `claim-on-stall` fan-out (`wave-driver.mjs:640-648`) fires on *absence* of wake events — no wake reason can carry it; "no behavior change" is false. |
| 2 | cursor honesty across 93B re-attach | **NEEDS-AMENDMENT** | The cursor is event-durable (continues, never resets), but wake *semantics* break across detach (members terminalize; stale wakes surface on dead members; one transient follow failure permanently downgrades a member). Contract also anchors on the wrong file. |
| 3 | wake-storm coalescing — 64-member terminalization | **NEEDS-AMENDMENT** | Coalescing 64→1 loses count and phase-distribution; harvest re-derives (defended) but the singular `{role, phase}` shape is violated and a phase-trusting cascade would be fooled. |
| 4 | BD3-A read receipts as promotion evidence (farming) | **CONFIRMED-HOLE** | The promotion gate (`coordination-store.mjs:14373-14375`) counts distinct reader *taskIds* with **no self-read exclusion** — the author's own task counts; at `minScratchReaders===1` a worker self-promotes with zero independent readers. |
| 5 | BD3-B pack lifecycle — who reaps packs | **CONFIRMED-HOLE** | The artifact store (`coordination-store.mjs:1081`, `:7900-7908`) has content-addressing + supersession but **no retention/expiry and no reaper**; the contract conflates validity-expiry with supersession, so an expired-but-not-superseded pack serves stale. |
| 6 | BD3-C delivery receipts — process death between delivery and read | **CONFIRMED-HOLE** | No receipt state machine exists today; the contract's `delivered`/`read` is unspecified across process death (zombie `delivered` forever, process-scoping unclear, and `delivered` is an ack-illusion vs. in-turn receipt). |
| ★ | Meta — the contract anchors on the wrong file | **CONFIRMED-HOLE (doc-honesty)** | `coordinator.mjs` contains **zero** of `followOnce`/`throughCursor`/`93B`/`followDowngraded`; those live in `wave-driver.mjs`/`wave.mjs`/`application-client.mjs`, and `throughCursor` is minted server-side. |

**Bottom line.** Four confirmed holes, two under-specified. The recurring seam: **every claim
that a stream/receipt "carries everything" or "accrues honestly" assumes a completeness the
shipped code does not enforce** — the stall signal has no wake (§1), the cursor survives but its
referents do not (§2), coalescing drops cardinality (§3), evidence accrual has no independence
gate (§4), packs have no reaper (§5), and receipts have no death-reconciliation (§6). The
contract's own control law (`:28-38`) already names the legitimate home for most of these (the
resource-circuit-breaker / last-resort clock class, constructive tool surfaces); the amendments
below mostly ask the contract to *say so explicitly* rather than redesign.

---

## 1. Attack 1 — BD3-D inbox correctness: the driver poll loop as the single consumer

**Contract claim (`bidirectional-v3-decisions.md:175-184`).** `attention.follow` returns a closed
set of five typed wake reasons — `decision_pending`, `blocked_interaction`, `candidacy_review`,
`member_terminal`, `deadline_approaching` — and "The wave driver's poll loop becomes one consumer
of this stream (no behavior change — it proves the stream carries everything the driver needs)."

**Lifecycle question.** "No behavior change" is a *completeness* assertion: every action the
driver takes today must be attributable to one of the five wake reasons, else the driver could not
run wake-only. I enumerate the driver's actions in `wave-driver.mjs` and map each.

### 1.1 The driver's action set today

The driver loop is a blocking `for (;;)` at `wave-driver.mjs:445`; each tick reads every member's
status (`:464`), reduces (`reduceMember`, `:183-197`), steers, then sleeps via `waitForWake`
(`:364-435`). `waitForWake` does **not** replace the timer — it **races a wall-clock
`setTimeout(resolve, intervalMs)` (`:426-431`) against one `followOnce` per live member
(`:399`)**. The wake gate is a single predicate, `isTargetChange` (`:215-224`):

```js
// wave-driver.mjs:215-224 — the ONLY definition of what ends a sleep early
function isTargetChange(page) {
  if (!page) return false;
  if (page.terminal === true) return true;                       // wake reason (a): terminal
  const changes = Array.isArray(page.changes) ? page.changes : [];
  return changes.some((change) => change?.category === 'execution'); // wake reason (b): execution change
}
```

So today there are exactly **two** wake reasons: a terminal transition, or an `execution`-category
change (checkpoint/decision park or resolve — `:216-218`). Everything else "advances the cursor
but does NOT wake" (`:218`). The contract's five-reason taxonomy is a *superset*; two of its
reasons (`candidacy_review`, `deadline_approaching`) have **no corresponding driver action today**
(they are aspirational / orchestrator-side), and one driver action has **no** wake reason.

### 1.2 Action → wake-reason map

| Driver action | file:line | Triggering condition (quoted/paraphrased) | Mapped wake reason | Covered? |
|---|---|---|---|---|
| Decision answer relay (D) | `wave-driver.mjs:557` (`deliverDecisionAnswer`→`run.answer` `:232`) | `reduced.blocked && reduced.gated.kind === 'answer_decision'` (`:492`); a pending decision is an `execution` change | `decision_pending` | ✅ |
| Nudge (E) | `wave-driver.mjs:601` (`act('nudge_turn')`) | a `turn_checkpoint` pause (`:488`) under `policy.steering === 'nudge-on-checkpoint'` (`:566`) — an `execution` change | `blocked_interaction` | ✅ |
| Claim — treadmill/budget (F) | `wave-driver.mjs:573,594` (`claimOnce`→`claim_turn` `:251`) | a re-parked checkpoint with unchanged `changedPathsDigest` (`:588-593`) — the re-park is an `execution` change | (checkpoint) `blocked_interaction` | ✅ |
| Terminal harvest | `wave-driver.mjs:464` status read | `page.terminal === true` | `member_terminal` | ✅ |
| **Claim — stall fan-out (G)** | **`wave-driver.mjs:640-648`** (`claimOnce` at `:646`) | **`now - lastMarkerAt >= policy.stallTimeoutMs`** (`:640`) | **NONE** | ❌ |
| Hard-cap exit | `wave-driver.mjs:673` | `now - startedAt >= policy.hardCapMs` (`:673`) | NONE (timer) | ❌ (loop exit) |
| Stall exit | `wave-driver.mjs:669` | inside the stall branch (`:640`) | NONE (timer) | ❌ (loop exit) |

### 1.3 The action with no wake reason

**ACTION G — the `claim-on-stall` fan-out** (`wave-driver.mjs:638-648`):

```js
const now = Date.now();
// D4: stall is checked BEFORE cap when both cross in one poll.
if (now - lastMarkerAt >= policy.stallTimeoutMs) {
  if (policy.finalization === 'claim-on-stall') {
    // D9: claim fan-out at wave stall — every pending-paused member, one claim each…
    for (const { role, run: runHandle, checkpoint } of paused) {
      const state = memberState.get(role) ?? freshState();
      if (!state.claimAttempted) await claimOnce(role, runHandle, checkpoint, claims, state);
```

`lastMarkerAt` is refreshed **only** when the wave-level marker changes (`:505`: `if (marker !==
lastMarker) { … lastMarkerAt = Date.now(); }`), and the marker is the **cursor-stripped** status
digest (`stallMarker`, `:144-157`). So `now - lastMarkerAt >= stallTimeoutMs` fires *precisely
when no member's semantic view changed for the whole window* — i.e., when the wake stream stayed
totally silent. **Stall, by construction, is the absence of every wake reason.** It can only fire
off the plain-timer half of `waitForWake` (the `setTimeout` at `:427`); no `execution` change and
no terminal transition exists to carry it.

**Verdict: CONFIRMED-HOLE.** If the loop "became one consumer of the wake stream with no behavior
change," removing the wall-clock timer and waking only on `execution`/terminal would have to
preserve all behavior. It does not: action G (the `claim-on-stall` fan-out — *the exact
finalization policy this red-team's own runner uses*, `run-bd3-redteam.mjs:103`) cannot be signaled
by any of the five wake reasons and would **never fire** in a wake-only world. The same is true of
the `hard_cap` (`:673`) and `stall` (`:669`) loop exits.

**Failure scenario.** A 64-member wave where every member parks at a checkpoint and then goes
silent (provider stall, not crash — the members are alive but not progressing). No `execution`
change fires, no terminal transition fires. In a wake-only driver, `attention.follow` never
returns; the wave hangs forever. Today the stall timer (`policy.stallTimeoutMs`) breaks the
deadlock and fans out `claim_turn`. Drop the timer → lose the only escape.

**Amendment.** The contract must do one of the following (the control law at `:28-38` already
permits both):
1. **Add a sixth wake reason `silence {sinceMs, members[]}`** — a wave-level "no target change
   for N ms" wake, distinct from `deadline_approaching` (which is per-`requestId`, `:181`) and
   from `blocked_interaction` (which requires an *interaction*, not silence). Silence is the only
   wake that represents *absence*, and absence is irreducibly a clock.
2. **Or scope the claim:** "the driver is wake-only *except* for the stall/hard-cap backstop,
   which is a resource-circuit-breaker-class timer (the control law's legitimate clock class),
   not a progress signal." This makes the contract honest without adding a wake reason.

Either way, "no behavior change" must be struck or qualified. Note also that the two *new* wake
reasons (`candidacy_review`, `deadline_approaching`) have **no** driver action mapping to them
today — `candidacy_review` is an orchestrator-side KG ritual (`wave-driver.mjs:687`, post-loop),
and `deadline_approaching` is itself a countdown timer. The contract should say which actor
consumes each, or the "one consumer" framing is internally inconsistent.

---

## 2. Attack 2 — cursor honesty across a 93B re-attach

**Contract claim (`:187`).** "cursor honesty across re-attach (93B's detached record must feed
the stream identically)." `followOnce` is "cursor-chained (`followOnce`'s throughCursor
discipline)" (`:181`).

**Lifecycle question.** For the cursor to be *honest* across a driver-process death and re-attach,
a wake reason emitted while the wave was detached must (a) be durably recorded, (b) survive into
the re-attached stream at the right offset, (c) not be dropped against the live stream, and (d)
carry the same `afterCursor` semantics.

### 2.1 What "detached" actually means, and where the cursor lives

First, a doc-honesty finding (★ in the ledger). The contract anchors `followOnce`/`throughCursor`/
`93B` on `coordinator.mjs`. That file contains **none** of them (verified by exact-count grep:
`followOnce` 0, `throughCursor` 0, `93B` 0, `followDowngraded` 0). The actual homes:

- `followOnce` is defined on the run handle at **`application-client.mjs:957-983`** — a one-shot
  wire round-trip (`run.follow`) racing an `AbortSignal`, returning the raw view. It does **not**
  compute the next wake; "wake law" is a doc phrase, the decision is the driver's `isTargetChange`.
- `throughCursor` is **consumed** at `wave-driver.mjs:413-422` (`cursor = page.throughCursor` at
  `:414`, advanced only forward) but **minted server-side** by the remote Baton Web `run.follow`
  handler — it is not produced anywhere in this repository. The contract's "ground every claim in
  file:line" mandate cannot be satisfied for the cursor's authority; that authority is off-repo.

### 2.2 The cursor itself is honest (defended)

On re-attach the cursor **continues, never resets**. `attachWave` (`wave.mjs:224-303`) returns the
same handle shape over the existing runs (`:302`); the driver seeds each member's cursor **fresh
from the run's status** on the first post-attach poll (`wave-driver.mjs:462-469`):
`if (Number.isSafeInteger(outline.cursor)) cursor = outline.cursor;`. Because `outline.cursor` is
the run's authoritative store-global sequence (advanced server-side while the driver was dead),
re-attach picks up the live position. There is no `cursor = 0` anywhere in `attachWave`,
`createWaveHandle`, or `waitForWake`. The `wave.driver_detached` key dedup
(`application-client.mjs:1550`, minted server-side via `run.inspect{mintWaveDetached:true}`) only
dedups the *detach-record mint* — it cannot drop a follow page. **At the event/cursor layer, the
stream feeds identically. This part is DEFENDED.**

### 2.3 The detach-boundary break (semantics, not bytes)

The dishonesty is *semantic*, and it is three-layered:

**(a) Members terminalize across detach; wakes referencing them go stale.** The 93B contract
itself (the shipped design, `wave-durability-2026-07-30/wave-durability-decisions.md` rule 2 TRUTH
CLAUSE) states: "every member that was in-flight at the predecessor's death reads as
recovery-terminalized at attach (CI6 — no live session survives a restart to honor a pause)."
So a `decision_pending {requestId}` wake minted during detachment refers to a member that is now
*terminal* — acting on it (the driver would relay a decision answer, `wave-driver.mjs:557`) is
wrong. The 93B rule-3 note already anticipates the nudge flavor: "replay may seed a pending pause
for a terminalized task, surfacing a `turn_checkpoint` attention + an advertised `nudge_turn` on a
dead member — drivers must expect and refuse-classify both refusal codes." That is an admission
that the stream does **not** feed identically: it carries stale wakes on dead members that the
consumer must refuse-classify. BD3-D adds four *new* wake classes but specifies no such refusal
reconciliation for them.

**(b) A transient follow failure during detach permanently downgrades the member.**
`followDowngraded` is a per-member `Set<role>` (`wave-driver.mjs:333-336`); a single thrown
`followOnce` (anything other than `application_follow_cancelled`, `:402`) adds the member once and
**forever** (`:400-411`), and the eligibility filter (`:367-369`) then excludes it from all future
follows — the member is poll-only for the *rest of the wave*. There is **no re-promotion path**.
So a wake reason that "spans the detach boundary" can, if the detach coincides with a transient
`application_follow_unavailable`, silently remove that member from the wake stream entirely. Its
wakes no longer arrive early at all — only on the `pollIntervalMs` timer. That is a behavior change
across the detach boundary the contract's "feed identically" claim ignores.

**(c) The contract names a file that does not contain the mechanism** (see §2.1) — so the
"throughCursor discipline" it cites is not locatable in the repo, and the cursor authority is a
remote service the contract does not name.

**Verdict: NEEDS-AMENDMENT.** The cursor is event-durable (defended), but the contract's
strong-form claim — "the detached record must feed the stream identically" — is false at the
semantic layer: members terminalize across detach (stale wakes on dead members), and a transient
detach-time follow failure permanently degrades a member's wake path. The contract must reconcile
this rather than assert identity.

**Failure scenario.** Driver dies with member M parked at a decision (`decision_pending` minted
in the durable event log). Re-attach: M is recovery-terminalized (its task → `failed`). The
attention stream replays the `decision_pending` wake. A wake-only driver that trusts the wake
relays a decision answer to a dead member (no-op at best, a spurious `run.answer` on a terminal
run at worst). The 93B design already makes the *driver* refuse-classify this for nudges; BD3-D
inherits the same duty for its four new wake classes but does not state it.

**Amendment.**
1. **Re-anchor the contract** on the actual files: `followOnce` at `application-client.mjs:957`;
   cursor consumption at `wave-driver.mjs:413-422`; attach at `wave.mjs:224-303`. Name
   `throughCursor` as server-minted (off-repo authority).
2. **Specify stale-wake reconciliation across detach**: a wake reason whose subject member is
   terminal at consume-time is *suppressed or re-classified* (`stale_on_terminal`), never acted
   on. The 93B refusal taxonomy (`not_found` / `not_paused`, `wave-durability-decisions.md` rule
   3) must extend to BD3-D's wake classes.
3. **Make `followDowngraded` re-promotable after re-attach**, or document explicitly that a
   detach-time transient failure costs the member its early-wake path for the rest of the wave
   (a deliberate degradation, not an identity claim).

---

## 3. Attack 3 — wake-storm coalescing (64-member terminalization)

**Contract claim (`:185-186`).** "wake-storm (a 64-member wave terminalizing — coalescing rules,
one wake per reason-class per cursor window)." The non-coalesced wake shape is singular:
`member_terminal {role, phase}` (`:181`).

**Lifecycle question.** Coalescing is lossy by construction. The question is not *whether* it
loses information (it does) but whether any *lost* reason would change driver behavior.

### 3.1 What coalescing drops

"One wake per reason-class per cursor window" collapses 64 `member_terminal` wakes into ONE.
The singular shape `{role, phase}` can carry exactly **one** role and **one** phase. Lost:
- **Count** — the driver cannot tell "1 terminal" from "64 terminal" from the wake alone.
- **Per-member identity** — 63 of 64 `{role}` values are gone.
- **Phase distribution** — if one member `failed` and 63 `completed`, the coalesced wake carries
  only one phase. The contract's `phase` field (`:181`) is singular by definition.

### 3.2 Does the lost reason change behavior?

**Partly defended.** The driver's terminal harvest does not trust the wake for member identity —
it re-derives every member's state on each tick by reading `runHandle.status()`
(`wave-driver.mjs:464`) and reducing (`:183-197`). So the *which members* and *which phases* are
recoverable from the durable member runs; the coalesced wake is merely a "something changed, go
look" signal. The exit condition `settled === totalMembers` (`:636`) is satisfied by counting
reaped outcomes, not by counting wakes. So a pure-harvest driver is fine.

**But two behaviors break:**
1. **Early-exit / liveness is lost.** Because count is lost, the driver can never conclude from the
   wake that *all* members are terminal — it must always full-scan. That is a latency/efficiency
   regression, not a correctness one, but it means "one wake per cursor window" cannot drive a
   prompt settle; the driver still polls everyone.
2. **A phase-trusting cascade is fooled.** If any consumer (a coordinator-worker in the #74
   pattern, or a fail-fast policy) uses the wake's `phase` to trigger a cascade — "a member
   `failed` → stop the siblings" — a coalesced wake reporting `phase: completed` would **mask the
   failure**. The singular `{role, phase}` shape is itself the hazard: it promises one member's
   phase but, after coalescing, it carries an arbitrary survivor's phase. The contract specifies
   no rule for *which* phase survives coalescing.

**Verdict: NEEDS-AMENDMENT.** Coalescing is necessary (a 64-wake storm is real), and harvest is
defended (re-derivable). But the singular `{role, phase}` shape is **violated** by 64→1
coalescing, and a consumer that trusts the wake's phase for cascade/exit decisions is silently
wrong. The contract under-specifies the coalesced shape.

**Failure scenario.** A 64-member wave; member #7 `failed`, the other 63 `completed`, all in one
cursor window. Coalescing emits one `member_terminal {role: <some survivor>, phase: 'completed'}`.
A coordinator-worker subscribed to the stream that stops siblings on `phase: 'failed'` never sees
the failure — it trusts the coalesced wake. (Today the wave driver does not do this; tomorrow's
#74 coordinator-worker might.)

**Amendment.** Specify the coalesced wake as an **aggregate**, not the singular shape:
`member_terminal {count, phases: {completed: N, failed: M, cancelled: K, …}, members: [role…]}`
(or at minimum `{count, anyFailed: bool}`). **Or** pin the inverse rule: "the driver re-derives
per-member phase on every `member_terminal` wake and never trusts the wake's singular `phase` for
cascade or exit decisions; the singular shape is a hint, not a census." Pick one and state it —
the current `:181` shape plus `:185-186` coalescing are mutually inconsistent as written.

---

## 4. Attack 4 — BD3-A read receipts as promotion evidence (farming)

**Contract claim (BD3-A, `:133-135`).** "Every read mints a `scratch.read`-family evidence event
(the existing causal-evidence class — reads are already first-class evidence in the KG's promotion
paths, so worker reads ACCRUE grounding weight honestly)." Red-team list (`:140`) pins "reads are
NOT TG2 progress evidence — pin that."

**Lifecycle question.** If reads feed the same `scratch.read` evidence class that gates KG
promotion, a worker that can *mint its own reads* can farm the counter. The contract pins the
TG2-progress vector but is **silent on the promotion-farming vector**.

### 4.1 The promotion gate and its reader-counting

`scratch.read` is minted at **`coordination-store.mjs:13149-13157`** (`readScratch`), payload
`{...reader, resource, envRef, result}` where `reader = {readerActor, readerWorker, taskId, runId}`
(built by the caller, `coordinator.mjs:9928-9935`). It is projected into `_scratchReads`
(`:8257-8258`).

The promotion gate is `_deriveKnowledgePromotion` at **`coordination-store.mjs:14337`**; the
scratch-fact admission predicate is **`:14373-14375`**:

```js
const reads = scratchReads.filter((event) => event.payload?.result?.facts?.some((row) => row.id === fact.id)
  && typeof event.payload?.taskId === 'string');
const byTask = new Map();
for (const read of reads)
  if (taskStatus.get(read.payload.taskId) === 'completed' && verifiedOutcomes.has(read.payload.taskId)
    && !byTask.has(read.payload.taskId)) byTask.set(read.payload.taskId, read);
const readerTaskIds = [...byTask.keys()].sort();
if (readerTaskIds.length < policy.minScratchReaders) continue;   // <-- the gate
```

A scratch fact becomes an admitted `Finding` only if the count of **distinct reader `taskId`s** —
each `completed`, each with a `verified_task_outcome`, each whose `result.facts` contained the
fact — meets `policy.minScratchReaders` (field `:149`; ceiling ≤1000 at `:293-297`; parallel gate
at `:14544-14545`).

### 4.2 The farm

Three properties combine into the hole:

1. **No self-read / author exclusion.** An exhaustive search of `_deriveKnowledgePromotion`
   (`:14337-14395`) for any comparison between the reader's `taskId` and the fact's `ownerTask`
   returned **nothing**. The fact *carries* `ownerTask` (set at `coordination-store.mjs:13394`:
   `ownerWorker: source.workerId, ownerTask: source.taskId, runId: source.runId`), but the filter
   at `:14373-14374` never reads it. (The only `ownerTask` comparisons in the file are in
   `_eligibleScratchOracle` at `:14480,:14491,:14501`, gated to `fact.grounding === 'derived'` — a
   different path that does not apply to observed-fact reader-counting.)
2. **Dedup is by `taskId`, not worker or run.** Repeated reads under one `taskId` collapse to one
   entry (`!byTask.has(read.payload.taskId)`, `:14374`), and a repeated idempotency-key
   short-circuits to the prior event (`:13150-13151`). So the *same task* cannot inflate — but
   *the author's own task is an eligible reader*.
3. **Reader identity is caller-named, not stream-bound.** `Coordinator.readScratch`
   (`coordinator.mjs:9928-9935`) builds the reader with `readerActor: opts.actor ??
   'orchestrator'` and `readerWorker: workerId` (the caller's argument). This is an **asymmetry**
   with scratchpad *writes*, which require `auth.actor === 'worker' && auth.principalId ===
   fields.workerId` (`coordination-store.mjs:13205-13210`, stream-bound per `coordinator.mjs:11035-
   11036`). The contract BD3-A *promises* reads mirror writes' "worker identity bound by the
   authenticated stream" (`:120-122`); the shipped read path does not enforce it.

**Consequence — the farm vectors:**
- **Self-read counts.** At `minScratchReaders === 1`, a worker self-promotes with **zero**
  independent readers: post an observed fact, read it under its own `taskId`, complete + verify
  the task (`:14374` requires `completed` + `verifiedOutcomes`), gate passes.
- **Off-by-one at any N.** At `minScratchReaders === N`, the producer's own task consumes one slot,
  so the real independence requirement is only N−1. The gate never establishes that *another* task
  read the fact.
- **Cross-task farming.** A worker rebound across tasks A, B, C can record a read under each
  (`taskId` comes from `handle.taskId`, `coordinator.mjs:9930`). Each must be independently
  completed+verified (real work), so this is not free — but the producer-self-read is the cheap
  farm.

**Verdict: CONFIRMED-HOLE.** The contract claim that reads "ACCRUE grounding weight honestly" is
false: the gate counts the author's own task as a reader, so the grounding is not independent. The
contract's red-team list (`:140`) pins the TG2-progress vector and **misses the promotion vector
entirely** — the more dangerous one, because promotion mints a `Finding` that rides ambient KG
serving to *other* workers (`messages.mjs:500` `buildKnowledgeSlice`).

**Failure scenario.** Worker W posts an observed (unverified) scratch fact F containing a
plausible-but-wrong claim about the codebase. W reads F under its own task, completes+verifies
(its task genuinely did other work). At `minScratchReaders === 1`, F is promoted to a `Finding`
and enters the ambient serving slice (`messages.mjs:500-538`) served to sibling workers as
`{provenance:'knowledge', untrusted:true}` grounding — W has laundered its own unverified note
into KG-served "knowledge" with no second reader ever having seen it.

**Amendment.**
1. **Exclude the author.** Add `&& read.payload.taskId !== fact.ownerTask` (and
   `read.payload.readerWorker !== fact.ownerWorker`) to the filters at
   `coordination-store.mjs:14373-14374` and `:14544-14545`. The author's own task must never count
   toward `minScratchReaders`.
2. **Count distinct workers or runs, not tasks.** Change the dedup key from `taskId` to
   `readerWorker` (or `runId`) so one worker rebound across many tasks cannot manufacture N
   "readers."
3. **Bind reader identity to the authenticated stream** (close the read/write asymmetry): a
   worker-initiated read must carry `auth.actor === 'worker'` with `principalId === readerWorker`,
   as writes do (`:13205-13210`). Today `readerActor` defaults to `'orchestrator'`
   (`coordinator.mjs:9931`), which is wrong for a BD3-A worker pull and lets the orchestrator name
   a reader the worker never authorized. (The viewer-scope half of this is the authority report's
   §1; the *evidence-farming* half is here.)
4. The TG2-progress pin (`:140`) is **DEFENDED** — confirmed reads are excluded: the steering
   qualifier (`coordinator.mjs:2141-2149`) admits only `scratchpad`-write / `interaction` /
   `turn_started` evidence; `scratch.read` appears nowhere in that path.

---

## 5. Attack 5 — BD3-B pack lifecycle — who reaps packs

**Contract claim (BD3-B, `:144-156`).** A `context-pack` is "content-addressed, versioned {type,
body ≤ 8KiB, validity, provenance}"; the red-team target (`:154`): "version staleness (a brief
citing a superseded pack must fail loudly at spawn, not silently serve stale)."

**Lifecycle question.** The contract specifies *validity* and *supersession* but is silent on
*reaping*: who GCs packs, on what window, and whether retention is run-scoped or project-scoped.

### 5.1 The pack store and the sweep

The natural home for a content-addressed `context-pack` is the existing artifact store:
`this._artifacts = new Map()` at **`coordination-store.mjs:1081`**, content-addressed by digest,
registered at `:7900-7905`, versioned via `supersededBy`/`supersededEvent` (`:7906-7908`). Three
facts about it:

1. **No retention / expiry on artifacts — not even a validity clock.** They persist for the store
   lifetime. Versioning marks supersession (`supersededBy`/`supersededEvent`, `:7906-7908`) but
   never reaps the superseded byte. **Strengthening, first-hand verified:** the artifact's
   knowledge node is minted with `validTo: null` hardcoded (`CS:7905`) — artifacts do not even
   *carry* a validity expiry. So if `context-pack`s ride this store, the contract's `validity`
   field (`:146`) is decorative: there is no `validTo` to lapse and no reaper to act on it.
2. **Artifacts are on the "NOT reaped by any sweep" list.** The shipped reapers are all
   event-driven and target other classes: `reapRunScratchpads` (`coordination-store.mjs:13518-
   13585`, on Run `stopping`) reaps scratchpad partitions + bridge facts (emitting
   `scratchpad.partition_reaped` + `scratch.fact_expired`); terminal-task scratch claims
   (`coordinator.mjs:7489-7495`) and board claims (`:7720-7728`) reap on task terminality;
   `_sweepDeadlines` (`:2694-2712`) reaps expired decisions/approvals. **No reaper touches
   artifacts.** Knowledge nodes are version-*invalidated*, never bulk-reaped.
3. **Validity-expiry ≠ supersession, and only one is enforced at serve.** The KG serving slice
   (`messages.mjs:500-538`, `buildKnowledgeSlice`) filters expired-validity nodes at serve time
   (`:502-507`: `if (node.validTo == null) return true; … return end > at`). That is the KG slice.
   **The contract's staleness rule covers supersession only** ("a brief citing a *superseded*
   pack must fail," `:154`) and says nothing about a pack whose `validTo` has elapsed but which is
   not superseded. Given artifacts carry no expiry machinery, such a pack would still materialize
   at spawn — silently stale.

### 5.2 The reaping hole

**Verdict: CONFIRMED-HOLE.** Two distinct gaps:

**(a) No reaper — packs grow unbounded.** A `context-pack` cited only by a dead run, or a pack
whose validity has elapsed, is never GC'd. Run-scoped packs (a `spec`/`findings` pack minted for
one wave) outlive the run; project-scoped packs (a `constraints` pack) outlive everything. The
content-addressed ledger accumulates without bound, and the contract specifies no retention class
(run-scoped vs project-scoped) for any of its v1 types (`spec`, `findings`, `constraints`,
`:149-150`).

**(b) Validity-expiry is conflated with supersession.** The contract's only staleness rule
(`:154`) fires on *supersession* (a `supersededBy` chain, which the artifact store does model,
`:7906-7908`). It does **not** fire on *validity-expiry* (a `validTo` in the past). So an
expired-but-not-superseded pack — exactly the case `validity` was added to handle (`:146`) —
serves stale at spawn. The two failure modes the contract lists ("version staleness" and the
`validity` field) are governed by different machinery, and only the first has a failure path.

**Failure scenario.** Orchestrator mints `context-pack` P (`findings`) with `validTo: 2026-08-05`.
On 2026-08-06 a brief cites P by digest. P is not superseded (no v2 was minted). Per the contract
as written, the spawn does not fail (the staleness rule is supersession-only); the hub
materializes P's now-expired findings into the worker's context — silently stale. Separately,
every pack ever minted sits in `_artifacts` forever.

**Amendment.**
1. **Give packs a retention class.** Run-scoped packs (`spec`, `findings` for one wave) are reaped
   on Run stop — ride the `reapRunScratchpads` pattern (`coordination-store.mjs:13518-13585`) with
   a new `pack.partition_reaped`/`artifact.expired` event. Project-scoped packs (`constraints`)
   persist but expire by `validTo`. The contract must say which v1 types are which.
2. **Extend the staleness rule to validity-expiry.** A citation to a pack whose `validTo < now`
   must fail at spawn with the typed code (`context_pack_expired`), exactly as a superseded pack
   fails (`:154`). Supersession and expiry are two reasons, one failure path.
3. **Name the reaper's trigger.** Today there is no background sweeper (all cleanup is
   event-driven from `tick()` or terminal transitions, per the sweep inventory in §5.1). Packs
   need either an event-driven reap (on Run stop / on supersession) or an explicit sweep — the
   contract must not silently inherit a sweeper that does not exist.

---

## 6. Attack 6 — BD3-C delivery receipts: process death between delivery and read

**Contract claim (BD3-C, `:161-168`).** Delivery receipts "`message.delivered`/`message.read` on
both streams"; red-team pin (`:172`): "receipt semantics (delivered vs read vs acted-on — never
claim acted-on)."

**Lifecycle question.** Three states (`delivered`, `read`, `acted-on`) imply transitions the
receipt must survive. The pin guarantees "never claim acted-on" (the strongest state is never
fabricated). But the *weakest* honest state is the problem: a worker whose process dies between
`delivered` and `read` leaves a receipt stuck in `delivered` forever.

### 6.1 The receipt state machine today — and the death window

**There is no message-receipt state machine today.** `_deliver` (`coordinator.mjs:6612-6760`)
calls the adapter, logs one event (`control.nudge`/`control.steer`/`control.send`), and returns a
bare `{ok:true, result:'ok', emulated}`. There is no `delivered`/`read` state, no
`message.delivered`/`message.read` event kind. The only receipt-shaped machinery is run-control
ops (`run.control_provider_acked` at `coordination-store.mjs:8427-8433`, validated `:4290-4349`),
which carry an `outcome` with `deliveredDespiteStale`/`actualDelivery` — but that covers run-level
`interrupt`/`send`, not worker nudges/steers/prose. **So BD3-C's receipts are entirely new**, and
the contract must define their behavior across the one transition it does not mention: process
death.

Process death is detected via three worker-origin events: `lifecycle.process_closed`
(`coordinator.mjs:10844-10889`), `lifecycle.crashed` (`:10980-10999`),
`lifecycle.process_reap_unconfirmed` (`:10891-10905`). On death, `handle.status` →
`dead`/`exited`/`orphaned`, the active task → `failed`, and scratch/board claims are reaped
(`:7489-7495`, `:7720-7728`). **There is no hook that reconciles a `delivered` message receipt on
death.** A receipt outlives the process it was delivered to.

### 6.2 The forever-delivered receipt

**Verdict: CONFIRMED-HOLE.** Three sub-holes:

**(a) Zombie `delivered`.** A worker that dies between `delivered` and `read` leaves the receipt
in `delivered` forever — there is no `delivery_orphaned`/`undeliverable` terminal state, and no
death-hook transitions it. The orchestrator's stream (`:162` "on both streams") keeps a `delivered`
that will never become `read`. If any consumer gates on `read` (e.g. "wait for read before
claiming the worker saw the steer"), it waits forever. (Today's `claim-on-stall` timer,
`wave-driver.mjs:640`, would eventually break the wait — but only via the stall backstop §1
flags as outside the wake stream; the receipt itself is never reconciled.)

**(b) Process-scoping is unspecified — a respawn inherits a false `delivered`.** The coordinator
tracks generation/pid/processGroupId (`coordinator.mjs:10846-10850` validates them on lifecycle
events), so it *can* distinguish a predecessor process from its respawn. The 93B recovery model
re-drives terminalized members with *salted objectives* — a fresh run (`wave-durability-decisions.
md` rule 5) — so the respawned worker is a new process that never received the message. If receipts
are keyed by `workerId` (not by generation), the respawn inherits its predecessor's `delivered` —
a lie. The contract does not say which.

**(c) `delivered` is an ack-illusion vs. in-turn receipt.** Prior red-team art
(`reviews/steering-interruption-redteam.md:12`, "The ack illusion") established that an ack
returned *before* work stops is an illusion: `turn/interrupt` returns `{}` before the turn
unwinds. By analogy, a `message.delivered` that fires when the message is *queued/handed to the
adapter* (which is what `control.nudge` logs today, `coordinator.mjs:6612-6760`) is not "the worker
received it into its turn" — it is "the hub accepted it." The same review's "still_queued
necromancy" (`:13`) shows a queued nudge surviving an interrupt and co-starting the next turn as a
*go* signal. So `delivered` (queued) and `read` (in-turn) can diverge by the entire residual
runtime of the in-flight tool child — minutes for a suite, unbounded for a hung command. The
contract's two-state model hides this gap.

**Verdict restated.** The contract's "never claim acted-on" pin (`:172`) is necessary and correct
(DEFENDED as far as it goes). It is insufficient: it says nothing about (a) reconciling
`delivered` on death, (b) process-scoping vs worker-scoping, or (c) what `delivered` actually
attests relative to the ack-illusion window.

**Failure scenario.** Orchestrator sends a critical `steer` to worker W; receipt mints
`message.delivered`. W's process is SIGKILLed 50ms later (before the steer enters W's next turn).
The receipt is `delivered` forever. The orchestrator (or a #74 coordinator-worker gating on read)
believes W "got" the steer. W is re-driven as a fresh run that never sees the message and proceeds
on the pre-steer objective — the steer is silently lost, exactly the "delivery ≠ compliance"
residual (`reviews/steering-interruption-redteam.md:21`) but now *unobserved* because the receipt
lies.

**Amendment.**
1. **Reconcile on death.** On `lifecycle.process_closed`/`crashed`/`process_reap_unconfirmed`
   (`coordinator.mjs:10844`/`:10980`/`:10891`), every `delivered`-but-not-`read` receipt for that
   process transitions to a terminal `delivery_orphaned {at, cause}` — never stuck, never
   falsely `read`.
2. **Process-scope the receipt.** Bind the receipt to the generation/pid that received it
   (`coordinator.mjs:10846-10850` already tracks these), not to `workerId`. A respawned worker
   starts with no `delivered` for messages its predecessor received.
3. **Pin `delivered` semantics against the ack-illusion.** `delivered` = "the message entered the
   worker's active turn context" (post the unwind window), NOT "the hub queued it." Or introduce a
   fourth state (`queued` < `delivered` < `read` < acted-on, the last never claimed). At minimum
   the contract must say which side of the ack-illusion `delivered` lives on, citing the
   `steering-interruption-redteam` ack-illusion and necromancy findings.
4. **Name the authoritative stream on death.** "Both streams" (`:162`) breaks asymmetrically: the
   worker's stream is gone. The contract must designate the orchestrator's stream as authoritative
   *and* require it be death-reconciled (per amendment 1).

---

## 7. Synthesis — cross-cutting lifecycle holes

Five attacks, one seam. **Every claim that a stream/receipt "carries everything" or "accrues
honestly" assumes a completeness the shipped code does not enforce:**

- §1: the stall signal — the *absence* of wake events — has no wake reason; the driver's escape
  (`claim-on-stall`) is a timer the contract's "wake-only" claim erases.
- §2: the cursor survives detach (bytes), but its *referents* do not (members terminalize; stale
  wakes on dead members; a transient failure permanently downgrades a member's wake path).
- §3: coalescing preserves the reason-*class* but drops *cardinality*; the singular wake shape is
  inconsistent with the coalescing rule.
- §4: evidence "accrues" but the gate counts the *author* as a reader — no independence.
- §5: packs are *versioned* but never *reaped*; validity-expiry is conflated with supersession.
- §6: receipts are *delivered* but never *death-reconciled*; `delivered` straddles the ack-illusion.

**The contract's own control law already names the fix's home** (`:28-38`): controls must be
eval-able, constructive, or conversational; "arbitrary turn-limits and time windows are the wrong
class"; "resource circuit-breakers (token/usd/turn budgets) are a distinct, legitimate class."
The stall timer (§1) and the deadline countdown are legitimately in that last-resort /
circuit-breaker class — the contract just has to *say so* instead of claiming "no behavior
change." The independence gate (§4), the reaper (§5), and the death-reconciliation (§6) are
constructive tool-surface fixes the contract must add. None require redesigning the spine; all
require the contract to stop asserting completeness it has not pinned.

**One structural doc-honesty hole (★) cuts across all of them:** the contract anchors
`followOnce`/`throughCursor`/`93B`/`followDowngraded` on `coordinator.mjs`, which contains none
of them. The actual homes are `wave-driver.mjs` (wake gate, poll loop, reducer, downgrade),
`wave.mjs` (attach), and `application-client.mjs:957` (`followOnce`), with `throughCursor` minted
off-repo (server-side). The contract's "ground every claim in file:line" mandate cannot be met for
the cursor authority until the anchors are corrected — and §2's detach analysis depends on reading
the right files.

---

## 8. Appendix A — evidence index (file:line)

All paths relative to the worktree root. `WD` = `impl/src/wave-driver.mjs`; `WV` =
`impl/src/wave.mjs`; `AC` = `impl/src/application-client.mjs`; `CS` =
`impl/src/coordination-store.mjs`; `CO` = `impl/src/coordinator.mjs`; `MS` =
`impl/src/messages.mjs`; `CT` = `docs/reference/evidence/bidirectional-v3-2026-08-02/
bidirectional-v3-decisions.md`; `WD93` = `docs/reference/evidence/wave-durability-2026-07-30/
wave-durability-decisions.md`; `SIR` = `reviews/steering-interruption-redteam.md`.

**Verification protocol.** Evidence was gathered by four parallel read-only subagents over the
impl files, then **every load-bearing citation was re-checked first-hand** against source (not
trusted on agent authority): `WD:640-648` and `WD:333-336`/`:367-369` (Attacks 1, 2);
`CS:14373-14375` (Attack 4); `CS:1081`/`:7900-7908` plus the `_artifacts.delete|clear` and
`setInterval` negation greps (Attack 5); `CO:6760`/`:6752` plus the `message.delivered|read`
negation grep (Attack 6); and the `coordinator.mjs` vocab-count grep (★). Where first-hand
checking sharpened a finding, the report says so (Attack 5's `validTo: null`; Attack 4's exact-keys
validator).

**Attack 1 (BD3-D inbox).**
- `WD:364-435` — `waitForWake`, races timer (`:426-431`) against `followOnce` per member (`:399`).
- `WD:215-224` — `isTargetChange`, the sole wake gate (terminal | execution-change).
- `WD:183-197` — `reduceMember` (blocked | checkpoint | checkpoint+claim | working).
- `WD:445` poll loop; `WD:464` status read; `WD:34` `pollIntervalMs: 20_000`.
- `WD:557` decision answer relay (`:232` run.answer); trigger `WD:492`.
- `WD:601` nudge (`act('nudge_turn')`); trigger checkpoint-paused `WD:488`, guard `WD:566`.
- `WD:573,594` claim treadmill (`:251` claim_turn); `WD:588-593` claimReady.
- **`WD:640-648` claim-on-stall fan-out (ACTION G); `WD:646` claimOnce; `WD:505` marker refresh.**
- `WD:673` hard_cap exit; `WD:669` stall exit; `WD:636` settled===totalMembers; `WD:678` settle;
  `WD:687` KG ritual; `WD:698` close.
- `CT:175-184` the claim; `CT:181` wake reasons/shapes; `CT:185-186` coalescing.
- `run-bd3-redteam.mjs:103` — `finalization: 'claim-on-stall'` (the policy ACTION G serves).

**Attack 2 (cursor / 93B detach).**
- `AC:957-983` — `followOnce` definition (NOT in coordinator.mjs).
- `WD:413-422` throughCursor consumed; `WD:414` forward-only advance.
- `WD:462-469` cursor seeded fresh from status on re-attach (no reset).
- `WV:172-189` waveId/idempotencyKey; `WV:199-206` per-run binding; `WV:224-303` `attachWave`;
  `WV:302` same handle shape.
- `AC:1546-1557` `waves.attach`; `wave.driver_detached` minted server-side via `run.inspect`.
- `WD:333-336` `followDowngraded` Set; `WD:400-411` one-shot downgrade; `WD:367-369` eligibility
  (never re-promoted); `WD:402` `application_follow_cancelled` excluded.
- `WD:144-157` `stallMarker` strips cursor.
- `WD93` rule 2 (terminalize on attach), rule 3 (turn.settled replay + dangling-record note).
- `CT:181,187` the claims. ★ `coordinator.mjs` grep: `followOnce`/`throughCursor`/`93B`/
  `followDowngraded` = 0 hits.

**Attack 3 (coalescing).**
- `CT:181` singular `member_terminal {role, phase}`; `CT:185-186` coalescing rule.
- `WD:462-469` harvest re-derives per-member status; `WD:183-197` phase classes; `WD:636` exit.

**Attack 4 (read farming).**
- `CS:13149-13157` `readScratch` mint; `CS:8257-8258` projection into `_scratchReads`.
- **`CS:14373-14375` promotion gate (distinct reader taskIds, completed+verified); `CS:14337`
  `_deriveKnowledgePromotion`; `CS:14544-14545` parallel gate.**
- `CS:149` `minScratchReaders` field; `CS:293-297` ceiling ≤1000.
- `CO:9928-9935` `Coordinator.readScratch` — reader caller-named, `readerActor` defaults
  `'orchestrator'`.
- `CS:13205-13210` write envelope (stream-bound contrast); `CO:11035-11036` stream-binding note.
- `CS:13394` fact `ownerTask`/`ownerWorker` set (never compared in the gate).
- `CO:2141-2149` `_steeringEvidenceQualifies` — reads EXCLUDED from TG2 (defended).
- `MS:500-538` `buildKnowledgeSlice` — promoted Findings served ambient to siblings.
- `CT:133-135` the claim; `CT:140` red-team list (pins TG2, misses promotion).

**Attack 5 (pack reaping).**
- `CS:1081` `_artifacts = new Map()`; `CS:7900-7905` registration; `CS:7906-7908` supersession;
  `CS:7751-7766` SHA-derived IDs.
- `CS:3292` knowledge-node validity fields (versioned, not reaped).
- `MS:500-507` `buildKnowledgeSlice` filters expired `validTo` at serve (KG slice only, not packs).
- `CS:13518-13585` `reapRunScratchpads` (the reaping analog packs do NOT ride).
- `CO:2694-2712` `_sweepDeadlines`; `CO:7489-7495` scratch-claim reap; `CO:7720-7728` board-claim
  reap — none touch artifacts.
- `CT:144-156` the claim; `CT:154` staleness rule (supersession only).

**Attack 6 (delivery receipts / death).**
- `CO:6612-6760` `_deliver` — bare ack, no receipt state; logs `control.nudge`/`steer`/`send`.
- `CS:8427-8433` (validated `CS:4290-4349`) `run.control_provider_acked` — only receipt machinery
  (run-level, not worker messages).
- `CO:10844-10889` `lifecycle.process_closed`; `CO:10980-10999` `lifecycle.crashed`;
  `CO:10891-10905` `lifecycle.process_reap_unconfirmed`; `CO:10846-10850` generation/pid validation.
- `CO:7489-7495` / `CO:7720-7728` claims reaped on death — but no message-receipt hook.
- `SIR:12` ack illusion; `SIR:13` still_queued necromancy; `SIR:21` delivery ≠ compliance.
- `WD93` rule 5 — re-drive with salted objectives (fresh process).
- `CT:161-168` the claim; `CT:172` "never claim acted-on" pin.

**Meta (★ doc-honesty).**
- `coordinator.mjs` exact-count grep: `followOnce`=0, `throughCursor`=0, `afterCursor`=0,
  `nextCursor`=0, `cursorChain`=0, `followDowngraded`=0, `93B`/`93b`=0, `wakeLaw`/`wakeReason`=0.
- Actual homes: `AC:957` (`followOnce`), `WD:215-224`/`:364-435` (wake law), `WV:224-303`
  (attach), `WD:333-336` (downgrade). `throughCursor` producer = remote Baton Web `run.follow`
  handler (off-repo).

---

## 9. Appendix B — what this review did NOT do (honest scope)

- **Server-side cursor authority is off-repo.** `throughCursor` is minted by the remote Baton Web
  `run.follow` handler. §2's "cursor is event-durable" verdict holds for the *consumption* path
  (the driver never resets, `WD:462-469`), but the *production* side — whether the server drops or
  reorders a throughCursor across a detach — could not be verified from this repository. Flagged,
  not claimed.
- **`minScratchReaders` default is deployment-supplied, not in-store.** §4's hole holds at any N
  (the author consumes a slot). The store enforces an **exact-keys validator** (`CS:294`: the
  policy object's keys must equal `KNOWLEDGE_PROMOTION_POLICY_FIELDS` exactly) — so there is no
  in-store default merge; the policy is passed fully-formed by the deployment/coordinator that
  constructs it. The *severity* at N=1 (full self-promote) vs N>1 (off-by-one) therefore depends
  on the deployment default, which is not pinned in `coordination-store.mjs`. The ceiling is
  ≤1000 (`CS:297`).
- **Authority angles deferred to the sibling report.** Viewer-scope leak in `targets`
  (`CT:188`), `finding`-by-id cross-run leak, UNTRUSTED-framing mandatoriness, reply-laundering
  into worker-to-worker sends, and candidacy-visibility to unauthorized viewers are
  `redteam-authority.md`'s scope; this report touches them only where they are lifecycle
  consequences (caller-named reader identity enabling farming in §4; stale-cursor re-exposure in
  §2).
- **No impl/ files were edited.** Only this report was written. Verified: `git status --short`
  shows a single untracked file, `docs/reference/evidence/bidirectional-v3-2026-08-02/redteam-
  lifecycle.md`. The deployment verifier (`command: 'true'`, `run-bd3-redteam.mjs:20`) exits 0.
