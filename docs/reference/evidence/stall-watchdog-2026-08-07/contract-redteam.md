# #67 RED-TEAM VERDICT — adversarial attack on `stall-watchdog-contract.md` v1.0

**Status:** **NOT FOLD-READY** — 9 numbered blockers (§7).
**Target:** `stall-watchdog-contract.md` (v1.0 DRAFT, same dir)
**Verification HEAD:** `7eff7cb78becbbc4aa6197808e3e22076c765a31` (current worktree HEAD).
**Contract-pinned HEAD:** `95da44142b44d760392e9ba52776eaedef950106` — the cited impl files are
byte-identical between the two (`git diff 95da441..HEAD` is empty for every cited file), so every
anchor was re-verified against the tree actually present.
**Discipline:** the three candidate NUL-bearing files were probed with `tr -cd '\000'` — only
`application.mjs` and `coordination-store.mjs` carry NUL bytes (3 each). `coordinator.mjs` has **0**
NUL bytes and was read whole. All non-NUL files were read with `sed -n`/`awk`; the NUL files with
`grep -an`/`sed -n` only.

---

## 0. Citation re-verification (every anchor in the contract, at HEAD)

Every ground-truth anchor, D2/D3/D4 inline anchor, and SW-pin anchor was re-verified by
`grep -an`/`sed -n`. The `REARM_KINDS` sort claim was verified with Node
(`[...set].sort()` deep-equals the literal). Verdict column: **PASS** = the anchor points at the
cited content; **DRIFT** = the content is present but the line span is off; **FAIL** = the anchor
does not point at the cited content.

| Cite | Verified at HEAD | Verdict |
|------|------------------|---------|
| G1 `application-deployment.mjs:37-41, 900, 1913, 1920` | `DEFAULT_BUDGET` (37-41); `timeoutMs` (900); `approvalTimeoutMs` (1913); `watchdog:{stallMs: DEFAULT_BUDGET.wallMin*60_000}` (1920) | **PASS** |
| G2 `coordinator.mjs:1057-1063`; `wave-driver.mjs:39` | code-default watchdog (1057-1063, `stallMs:120000`); wave stall clock `stallTimeoutMs: 20*60_000` (39) | **PASS** |
| G3 `coordinator.mjs:8731-8746` (mint 8739-8745) | `_armWatchdog`; `!(stallMs>0) \|\| status!=='working'` refusal; `stall_suspected` payload `{elapsedMs,action,mechanical}` (8739-8745) | **PASS** |
| G4 `coordinator.mjs:9144-9146, 8757-8759, 12824` | `_observeWatchdogEvent` any-worker-event re-arm; `_touchWatchdog` working-only; single feed `:12824` | **PASS** |
| G5 `coordination-store.mjs:496`; `coordinator.mjs:12445, 2661` | `MAX_SCRATCHPAD_WORKER_ENTRIES=128`; `scratchpad.write_result` mint + pause count | **PASS** |
| G6 `coordinator.mjs:12614-12635` (`deadlineAt:null` 12620; statuses 12631-12635); `_sweepDeadlines` 2909-2930 (deny 2920-2921, expire 2922-2924); `tick()` 1437 | question record + statuses exact; `_sweepDeadlines` starts at **2913** (2909-2912 are the previous method's tail); deny/expire branches exact; `_sweepDeadlines()` call is at **1448** inside `tick()` (1437 is the method's doc comment) | **PASS** (DRIFT 4-11 lines on function start / tick call) |
| G7 `coordinator.mjs:9951-9980` | `_expireDecision`: `decision.expired`, `input_required`→`working`, best-effort wire cancel, `resolution={disposition:'expired'}`, `handle.status='working'` | **PASS** |
| G8 `coordinator.mjs:7015-7060, 7088, 7122-7145, 1197`; `application.mjs:12749-12763, 12296` | `attentionFollow` (7021); `_attentionPage` (7088); `_mintMemberTerminal` (7122); `_attentionReasons=[]` (1197); `attentionWatch` facade + `run.attention.watch` dispatch | **PASS** |
| G9 `application-semantics.mjs:59-63`; `application.mjs:389-430, 455-458, 372-382` | `WAITING_ON_KINDS` closed five (59-63); `projectBlockedInteraction` (372); `projectWaitingOn` (390), `provider_stalled` (458) | **PASS on anchors / FAIL on the content claim** — see §3: `waitingOn:{kind:'blocked'}` does **not** exist |
| G10 `coordinator.mjs:2076-2140, 2163-2200, 2276-2320`; `:1003` | `_admitPauseRecord` (2076); `_armSteeringCycle` (**2165**, cited 2163); `_expireSteeringCycle` (2276); `_progressNudgeWindowMs ?? 300_000` (1003) | **PASS** (DRIFT 2 lines on `_armSteeringCycle`) |
| G11 `trust-gate-steering-decisions.md:78-81` | TG2 distinct-digest + resolution-gated classes + "#67's sibling" null-deadline default | **PASS** |
| G12 `coordinator.mjs:8404-8460` (`progress_unchanged` 8435-8439, `progress_checkpointed` 8448) | `_preserveProgressBeforeReap`; unchanged→`progress_unchanged {state:'no_progress'}`; changed→`progress_checkpointed` (both `actor:'policy'`) | **PASS** |
| G13 `wave-driver.mjs:668-673, 729-762, 39-40`; `application.mjs:7934-7960` | K=3 (669-673); stall clock + claim fan-out (729-762); **the #55 activity projection is `_activityProjection` at `application.mjs:8041-8068`** — `7934-7960` is `_followCategory`, a different function | **FAIL — wrong anchor (~100-line drift)** |
| D2 inline `coordinator.mjs:9774, 9779, 9906` | `question.answered` / `approval.resolved` / `decision.settled` minted only on resolution | **PASS** |
| D2 inline `coordinator.mjs:12322` | `_clearWatchdog(handle)` at the terminal-turn path | **PASS** |
| D3 inline `coordinator.mjs:12775` | decision record `deadlineAt: this._now() + request.deadlineMs` precedent | **PASS** |
| SW-01/02/03/05/09/10 anchors (`1920`, `8742-8744`, `9144-9146`, `496`, `8761-8765`) | payload `8742`; immediate `interrupt` map `8761-8765` | **PASS** |
| Seed quotes `trust-gate-steering-decisions.md:30-31` / `:33-35` | A7 "stall watchdog is not a liveness bound" quote is at **35-37**; farm quote at **31-34** | DRIFT 4 lines |
| `REARM_KINDS` is its own `[...set].sort()` result | Node-verified true | **PASS** |
| NUL-bearing file list | contract names `coordinator.mjs` as NUL-bearing; it has **0** NUL bytes | **FAIL — methodology mis-statement** |

**Citation law:** the campaign law "every citation re-verified at the current HEAD" is violated by
the G13 anchor (a wrong citation is an automatic blocker per the red-team brief). The seed and G6/G10
drifts are content-true but line-stale. The NUL-file list is factually wrong about `coordinator.mjs`.

---

## 1. D1 — decoupled stall budget: **HOLE** (moderate)

**What is sound.** The one-directional decoupling is real at HEAD: `timeoutMs`/`approvalTimeoutMs`
still derive from `DEFAULT_BUDGET.wallMin` (900, 1913), `DEFAULT_WATCHDOG.stallMs = 20 * 60_000` is
strictly below 480 min, the two constants are frozen independently, and the wave-driver's 20-min
provider-stall clock (`wave-driver.mjs:39`) is a coherent cross-surface vocabulary. Keeping the
code default `stallMs:120000` (G2) is the right conservative pole.

**Hole 1 — no admission-time `stall < wall` check.** The only guard anywhere on `stallMs` is
`if (!(this._watchdog.stallMs > 0) ...)` (`coordinator.mjs:8733`). Nothing validates a deployment
override against the wall budget. A misconfiguration `watchdog: { stallMs: 500 * 60_000 }` (> the
480-min wall) sails through and the watchdog **can never fire before the node wall budget ends** —
the exact "bound that can never fire is the original bug reborn" the red-team brief predicts. The
contract pins a constant but no *bound* on the configurable value.
**Fix:** an admission check at the deployment seam (and/or in `_armWatchdog`) that
`stallMs` is a positive integer strictly less than the node wall `timeoutMs`, with a typed
refusal (`watchdog_stall_exceeds_wall`) on violation; pin it as a new acceptance row.

**Hole 2 — disclosure is source-comment-only.** The "honestly disclosed" claim is a comment in the
config literal; **no operator surface exposes the watchdog config or what it measures**. The
application facade contains zero `stallMs`/`watchdog` references (`grep -rn stallMs impl/src/application.mjs`
is empty), so an operator cannot read "the stall window is 20 min and measures no-progress evidence"
from any status/view endpoint — only the *event* (`stall_suspected {basis}`) is observable, after it
fires. The disclosure requirement in the brief ("what the budget MEASURES, not just its value") is
unmet at runtime.
**Fix:** expose the resolved watchdog config (stallMs + basis semantics + the REARM set) on a
deployment/run status surface, byte-stable.

---

## 2. D2 — progress-evidence re-arming: **HOLE** (major)

The core direction — kill the any-event re-arm, enumerate the re-arm kinds — is right and the
`REARM_KINDS` literal is genuinely ACTUAL-sorted. But the contract changes the **set** and not the
**feed** or the **actor gate**, so the closed set as written is largely inert.

**Hole 3 — the retained `event.actor !== 'worker'` gate makes most of REARM_KINDS dead.**
The D2 replacement keeps `if (event.actor !== 'worker') return;` "unchanged". Verified actor
attribution at HEAD for the named kinds:
- `control.steer` → minted `actor: opts.actor ?? 'orchestrator'` (`coordinator.mjs:7404`) — **filtered**;
- `verify.reverified` → `actor: 'policy'` (`:6463`, `:13011`) — **filtered**;
- `worktree.progress_checkpointed` → `actor: 'policy'` (`:8448`) — **filtered**;
- `lifecycle.turn_started` → worker-actor (adapter `claude-session.mjs:884-894` gates it to real
  turn beginnings) — the **only** kind that reliably survives the gate;
- the interaction resolutions (`question.answered` / `approval.resolved` / `decision.settled`) are
  minted only on resolution (`:9774, :9779, :9906`) and only flow to the watchdog observer if they
  ride the worker observation stream.

**Hole 4 — the feed never delivers the orchestrator/policy kinds at all.** `_observeWatchdogEvent`
has **exactly one call site**, the worker observation stream at `coordinator.mjs:12824` inside
`_handleEvent`. `control.steer` is minted on the send path (`:7408`) and `verify.reverified` on the
policy verify path — neither is routed into `_handleEvent`, so even with the actor gate removed they
would never reach the re-arm function. The contract specifies no new feed.
**Fix (covers 3+4):** re-specify D2 as *both* a set and a feed. Either (a) drop the blanket
`actor !== 'worker'` return and route the named policy/orchestrator kinds (steer, verify,
checkpointed) into the observer, or (b) shrink REARM_KINDS to the genuinely worker-observable kinds
and stop claiming `control.steer`/`verify.reverified`/`worktree.progress_checkpointed` re-arm.
`worktree.progress_checkpointed` is additionally self-contradictory as a re-arm: it is minted **by
the reap pre-check itself** (`_preserveProgressBeforeReap`, G12), so the reap's own receipt is also
a "re-arm kind" — a reaped worker simultaneously produces evidence that says "progress".

**Hole 5 — the D2 replacement code kills the loop-tracking branches it claims to preserve.**
The contract's `_observeWatchdogEvent` does `if (!REARM_KINDS.includes(event.kind)) return;`
*before* the provider_call/tool_call observation branches, while the comment says "the existing
logical-observation branches (provider_call / tool_call loop-tracking) still run — but they do NOT
re-arm". With the early return in place the branches are **unreachable**: `resource.provider_call`
and `content.tool_call` are not in REARM_KINDS, so every such event returns before
`_observeLogicalProviderCall` / `_observeLogicalToolCall` (and the `loopThreshold` loop detector,
`:9166-9174`) runs. The loop watchdog is silently disabled.
**Fix:** order the code so the observation/loop-tracking branches run *before* the REARM_KINDS
silence-return, or explicitly state the loop detector is also removed (it is not, per the comment).

**Evolved-idler attacks against the *watchdog* itself — sound.**
- scratchpad write/delete cycling: `scratchpad.write_result` is not a REARM kind → does not re-arm ✓;
- no-op diff (touch/revert): `progress_checkpointed` is minted only when the captured sha differs
  from `baseSha` and only by the coordinator at reap pre-check → a worker cannot self-mint it mid-window ✓;
- same-digest replay: the watchdog has no digest class at all (kind-based), so replay is moot ✓;
- orchestrator self-dealing via nudge: `control.steer` is actor-filtered AND feed-absent → the
  self-dealing loop fails to re-arm ✓ — but only because the legitimate steer re-arm is broken too
  (Hole 3/4).

**Residual to name (not a blocker):** `lifecycle.turn_started` is the one worker-self-mintable re-arm
kind and it *also* clears the `'stall'` flag (`_resetWatchdogTurn`, `:8750-8755`). Its honesty rests
entirely on the adapter's one-start/one-terminal accounting (`claude-session.mjs:884-894`); a loose
adapter turns a turn-spammer into a perpetual re-armer. The contract should pin that adapter
discipline as a dependency of the closed set.

---

## 3. D3 — blocked-status escape / whose stall: **HOLE** (major)

**Hole 6 — `waitingOn: {kind: 'blocked'}` does not exist; SW-06 is RED, not GREEN.**
The contract asserts (D3 and SW-06) that a blocked worker reads `waitingOn: {kind: 'blocked'}` and
calls it the honest #10 state. At HEAD:
- `projectWaitingOn` returns **null** when the member is blocked (`if (blocked) return null;`,
  `application.mjs:408`) — the precedence in G9 is not "blocked > spawning > …", it is *blocked
  short-circuits the whole waitingOn projection to honest null*;
- the blocked state is a **separate** surface, `blockedInteraction`, via
  `projectBlockedInteraction` (`application.mjs:372-388`) → `{kind: 'answer_question'}` /
  `{kind: 'decision'}` / `{kind: 'approve_plan'}`;
- `'blocked'` is **not** a member of the closed-five `WAITING_ON_KINDS` (`application-semantics.mjs:59-63`).

So the D3 "honest state" claim names a non-existent surface, SW-06 (marked GREEN) asserts a state
that fails if actually tested, and §5's "no new waiting kinds" is contradicted by D3's invented
6th kind. The pinned GREEN is the *wrong pin*.
**Fix:** rewrite D3/SW-06 to read the actual surface — `waitingOn: null` + `blockedInteraction:
{kind: 'answer_question'|...}` — and keep the honest-state argument on `blockedInteraction`, or
specify a real new `blocked` waiting kind (which §5 must then un-ban).

**Hole 7 — the null-deadline default can fire while a decision legitimately awaits the operator.**
The D3 default is a time-only bound on an orchestrator-facing interaction with **zero evidence
check on the orchestrator side**: after `blockingInteractionTimeoutMs` (20 min) the blocking
`question` record is swept regardless of whether a human is actively reviewing it. Escalation is
"not an answer" (good), but the contract follows `_expireDecision` (G7) which **closes the record**
(`resolution` set, `record.state` resolved) — an operator's late answer is rejected as
`already_resolved`, and the worker is force-released to `working` while it may still genuinely need
the input (→ blocked → re-ask → blocked oscillation). The #105 escalation path uses
`question.asked {blocking:true}` (`reply-chains-contract.md` G11 → `coordinator.mjs:12614-12631`);
D3 adds an expiry to that lane where none existed, so a legitimate >20-min operator review of an
escalated chain gets preempted. This is exactly the "legitimate slow work" the control law protects,
on the orchestrator side.
**Fix:** (a) add an operator-side evidence/ack extension on the attention reason (the OQ-1 surface —
see §6), so an acknowledged-in-review interaction does not expire; and (b) make the sweep
**non-destructive**: keep the record answerable after escalation (disposition 'escalated' but not
`already_resolved`-closed), so a late operator answer still lands.

**Absent/malicious orchestrator** — honest as designed: the 20-min default bounds the park, the
worker is never stall-reaped for the orchestrator's question (SW-07 holds), and after release the
D1/D2 surface applies to the now-`working` worker. This part is **SOUND**.

---

## 4. D4 — the kill ladder: **HOLE** (major)

The ladder's shape (escalate → claim/nudge → reap, receipted, no silent kills, unclaimed stalls
never auto-reap) is the right constructive order, and every receipt name is real at HEAD
(`health.stall_suspected`, `control.steer`/`control.nudge`, `worktree.progress_unchanged`/
`progress_checkpointed`, `kill.requested`/`control.interrupt_requested` — all minted today). The
order is structurally enforced (reap is gated on the claimed cycle having expired unanswered). But
two composition holes make the ladder escapable.

**Hole 8 — claim-then-idle: the rung-2 cycle is answered by TG2 evidence, not D2 evidence, so the
ladder never reaches reap.** D4 says rung 2 "reuses `_armSteeringCycle` (G10)" and that the cycle
resolves when "the worker emits any D2 re-arm evidence". The existing cycle's answer set
(`_steeringEvidenceQualifies`, `coordinator.mjs:2208-2238`) is **TG2 evidence**: `scratchpad` with a
distinct content digest, `capability_op` with a distinct digest, `turn_started`, and a RESOLVED
interaction — deduped **per cycle** (`steering.digestSet`), not per lifetime. `scratchpad.write_result`
is *not* a D2 REARM kind. So the attack that killed the old any-event re-arm walks straight through
the ladder:
1. worker idles → D1 fires → `stall_suspected` + `stall_declared`, no stop (rung 1) ✓;
2. orchestrator claims → `control.steer` arms the cycle (rung 2);
3. worker answers with **one scratchpad note** (a distinct digest) → `_steeringEvidenceQualifies`
   returns true → cycle resolves `answered:true` → per D4 the stall clears and the watchdog re-arms fresh;
4. worker idles again → stall → nudge → note → … **forever**. Never reaped, never progressing,
   one note per cycle, each note cheaper than the last.

The dedup is per-window, and a worker with a single saved note answers every cycle. The contract's
"the stall clears (the stall action flag is removed, the watchdog re-arms fresh)" also specifies no
**removal point** for the `'stall'` flag: the only current removal is `_resetWatchdogTurn`
(`:8751`), so the mechanism is under-specified even if the answer set were fixed.
**Fix:** (a) pin the rung-2 cycle's answer set to the **D2 REARM_KINDS** (narrow
`_steeringEvidenceQualifies` or mint a stall-seam-specific cycle) so a scratchpad/capability note
cannot clear a stall; (b) specify the `'stall'`-flag removal seam (a new `_clearStall(handle)` called
only on a qualifying D2 re-arm inside the window); (c) decide the dedup class explicitly — per-stall
lifetime dedup, not per-cycle, so one reused digest cannot answer successive cycles.

**Hole 9 — steer-does-not-arm today; the claim seam is new wiring with no specification.**
The existing `_armSteeringCycle` arms at **pause admission** (`_admitPauseRecord` → `:2134`) and
`_expireSteeringCycle` requires `task.status === 'paused'` (`:2290`) — a `working` stall-seam worker
would no-op both guards. D4's "a control.steer / control.nudge arms a bounded cycle at the stall
seam" is therefore a new path (steer handler → arm), which the contract does not specify (which
method, what record shape, how `working` passes the paused-only guards). It also contradicts D2:
REARM_KINDS contains `control.steer` but not `control.nudge`, while D4 arms on both.
**Fix:** specify the stall-seam cycle record + arming call site (e.g. a `_armStallCycle(handle)` on
`control.steer`/`control.nudge`), its `working`-compatible expiry, and reconcile the REARM kind list
with the claim kinds.

---

## 5. The control-law line: **BROKEN** — a slow-but-productive worker can be declared stalled **and reaped**

The contract's central claim — "no evidence of progress, never too slow" — is violated by its own
mechanics. Compose the pieces:
- D2 removes `content.tool_call`, `resource.provider_call`, `resource.tokens`, and every other
  in-flight signal from re-arming (SW-03: "provider calls, tool calls" never re-arm);
- D1 pins the window at **20 min**;
- D4's rung-2 nudge has a **300 s** window (`_progressNudgeWindowMs`, `coordinator.mjs:1003`), and
  rung 3 reaps when the cycle expires unanswered.

Now take a *productive* worker: a 25-minute compile, a 20+-minute single LLM generation, or a long
verification run. `lifecycle.turn_started` re-arms at turn start, then the worker emits **zero
REARM kinds** for the whole tool call (its only activity is the excluded `tool_call`/`tokens`).
D1 fires at 20 min → `stall_declared`. The orchestrator nudges; the worker is **mid-tool-call and
cannot process the control-lane prompt** (turn in flight), so the 300 s cycle expires unanswered →
rung 3: `_preserveProgressBeforeReap` pins whatever the compile has written (G12 receipts it) **and
the worker is killed anyway** (`_applyWatchdogAction` → `_beginStop`, `:8761-8765`). "Preserve before
reap" preserves the *output*; it does not prevent the *kill*. The basis `no_progress_evidence` is
honest in isolation, but the window + excluded in-flight signals + reap ladder jointly implement
exactly what the control law forbids: **a clock-gated kill on legitimate slow work.**

The D3 null-deadline default is a second time-only bound with zero evidence check (orchestrator
side, §3 Hole 7). The D1 window itself is evidence-gated (it fires only on no-re-arm) — but 20 min
is not "coarse" enough to cover a legitimate single tool call, and D2 removed the only signal that
would have covered it.
**Fix (minimum):** an in-flight liveness re-arm that does not resurrect the any-event farm — e.g.
re-arm on `lifecycle.turn_started` **and** on an in-flight `content.tool_call`/provider-frame start
(a per-turn "tool started, not yet returned" marker, or a `turnInFlight` liveness check that is not
the any-event re-arm), OR make rung 3 require the worker to be genuinely unresponsive (no in-flight
turn) before reap, OR set D1 far above the worst-case single-tool-call duration and let the
steering cycle, not the window, be the liveness judge. The contract must show the line it claims.

---

## 6. Refusal / observability vocabulary, acceptance pins, open questions

**Vocabulary.** The ledger receipts are typed, named, surface-constant, and verified: `stall_suspected`
(existing, gains `basis`), `progress_unchanged`/`progress_checkpointed` (existing), `question.expired`
(the `decision.expired` analog). The two **new attention reasons** (`stall_declared`,
`interaction_expired`) are named but **under-specified as surfaces**: the attention inbox currently
carries `member_terminal` (coalesced) and a live-derived `candidacy_review` behind a
review-authority gate (`coordinator.mjs:7085-7150`); the contract does not pin the reason-object
shape (`seq`/`runId`/`mintEpoch`/`mintedAt`), the runId source for a stall (the handle's task runId),
or the `_attentionPage` target/authority filtering for the two new kinds. The "no new refusal codes"
and "no new waiting kinds" constraints are consistent *except* where D3 invents `waitingOn:blocked`
(§3). `stateFailureCode`/web mapper untouched — verified sound.

**Acceptance pins.** SW-01..05, SW-08..10 are each **red-first-able** at HEAD and each names the
failing anchor. SW-07 (blocked never reaped) is a true GREEN. **SW-06 is a broken pin**: it asserts
`waitingOn: {kind:'blocked'}` which is not the HEAD read (`waitingOn: null` +
`blockedInteraction: {kind:'answer_question'}`); as written it is RED, not GREEN, and would fail its
own verification. Fix with §3 Hole 6.

**Open questions (verdicts, as required):**
- **OQ-1 — attention-reason claim/ack surface: FOLD-BLOCKING.** It is not optional polish: it is the
  missing operator-side evidence check that prevents the D3 default from firing during legitimate
  review (§3 Hole 7). Verdict: add a claim/ack on `stall_declared`/`interaction_expired` that extends
  the effective deadline; the `claim_turn` precedent (`coordinator.mjs:2541`, `wave-driver.mjs:397`)
  is a usable shape.
- **OQ-2 — unclaimed-stall residual: DEFERRED.** "Stays escalated, never auto-reaps" is the honest
  terminal under the control law; the claimed path is where the ladder is escapable (Hole 8). A
  supervisor-armed reap already exists. Do not add an auto-reap clock.
- **OQ-3 — `blockingInteractionTimeoutMs` value: FOLD-BLOCKING (mechanism before value).** The 20-min
  value is not the defect; a time-only bound with zero orchestrator evidence check is (§3 Hole 7).
  The value only becomes a knob worth tuning once the ack-extension exists. Keep 20 min provisionally,
  gate the pin on the mechanism.
- **OQ-4 — `verify.reverified {accept:false}`: FOLD-BLOCKING (moot until the actor gate is fixed).**
  `verify.reverified` is minted `actor:'policy'` (`:6463`, `:13011`) and never reaches the watchdog
  observer under the D2 gate (Hole 3/4). The accept-true/accept-false question is unresolvable until
  the feed/actor fix lands; pin the loop-detector bound (`loopThreshold`, `coordinator.mjs:1057`) as
  the answer.

---

## 7. Final verdict: **NOT FOLD-READY**

Numbered blockers (what → why → fix):

1. **G13 citation is wrong at HEAD.** `application.mjs:7934-7960` is `_followCategory`, not the #55
   activity projection; the projection is `_activityProjection` at `application.mjs:8041-8068`.
   A wrong citation is an automatic blocker under the campaign law. **Fix:** re-point the G13 anchor
   to `8041-8068` (and re-verify it is current at the fold HEAD).
2. **D2's REARM_KINDS is largely inert — the actor gate + single feed make most kinds dead.**
   `control.steer` (actor `orchestrator`, `:7404`), `verify.reverified` (actor `policy`, `:6463`/`:13011`),
   `worktree.progress_checkpointed` (actor `policy`, `:8448`) are filtered by the retained
   `event.actor !== 'worker'` gate, and none of them ride the only watchdog feed (`:12824`). Only
   `lifecycle.turn_started` (and worker-actor interaction resolutions) can re-arm. **Fix:** re-specify
   D2 as set + feed + actor policy together (§2 Hole 3/4).
3. **D3/SW-06 name a surface that does not exist.** `waitingOn: {kind:'blocked'}` is not in the code
   (`projectWaitingOn` returns null when blocked, `application.mjs:408`); `'blocked'` is not in
   `WAITING_ON_KINDS`; the honest state is `blockedInteraction: {kind:'answer_question'|...}`. SW-06
   (marked GREEN) is RED as written, and §5's no-new-kinds law contradicts D3. **Fix:** rewrite
   D3/SW-06 on `blockedInteraction`, or spec a real 6th waiting kind.
4. **The rung-2 cycle is answered by TG2 evidence, enabling claim-then-idle.** Reusing
   `_armSteeringCycle` answers on scratchpad/capability distinct digests (`_steeringEvidenceQualifies`,
   `:2208-2238`, dedup per-cycle) — not D2 REARM kinds — so a worker answers every nudge with one note
   and the ladder never reaches reap. **Fix:** narrow the stall-seam cycle to D2 REARM kinds, spec the
   stall-flag removal seam, and dedup per-stall lifetime (§4 Hole 8).
5. **The control-law line is broken for slow-but-productive workers.** 20-min D1 window + D2 excludes
   in-flight `tool_call`/`tokens`/`provider_call` + 300-s nudge window + mid-turn worker cannot answer
   = a 25-min compile gets declared stalled, escalated, and reaped; `_preserveProgressBeforeReap`
   preserves the output but not the worker. **Fix:** add an in-flight-turn liveness re-arm (that is not
   the any-event re-arm), or gate rung-3 reap on genuine unresponsiveness, or push D1 far above the
   worst-case single tool call (§5).
6. **D1 has no admission-time `stall < wall` check.** A misconfigured `stallMs ≥ wallMin*60_000`
   recreates the never-fires bound; the only guard is `stallMs > 0` (`:8733`). Disclosure is also
   source-comment-only with no operator surface. **Fix:** admission validation + runtime config
   disclosure (§1).
7. **D3's null-deadline default can fire during legitimate operator work.** 20-min time-only bound with
   zero orchestrator evidence check closes a blocking question under an operator's active review (#105
   escalation lane), rejecting a late answer as `already_resolved`. **Fix:** operator ack/claim
   extension (OQ-1) + non-destructive escalation (§3 Hole 7).
8. **D2's replacement code disables the loop-tracking branches it claims to keep.** The
   `!REARM_KINDS.includes` return precedes the `provider_call`/`tool_call` branches, making
   `_observeLogicalToolCall` and the `loopThreshold` detector unreachable. **Fix:** reorder so
   observation/loop-tracking runs before the silence-return, or state the removal explicitly (§2 Hole 5).
9. **D4's claim seam is new wiring with no specification, and REARM_KINDS vs D4 disagree on
   `control.nudge`.** The existing cycle only arms at pause admission and expires only on `paused`
   tasks (`:2290`); the steer-arms-cycle path, record shape, and `working`-compatible expiry are
   unspecified, and D4 arms on `control.nudge` while D2's set omits it. **Fix:** spec
   `_armStallCycle` + reconcile the kind lists (§4 Hole 9).

Blockers 1-4 are fatal to the contract's own claims (citations, the closed set, the honest-state
pin, the ladder's binding power); 5 is fatal to the control law the campaign holds; 6-9 are
structural holes that must be closed before fold. **Verdict per decision: D1 HOLE, D2 HOLE, D3 HOLE,
D4 HOLE; the control-law line is BROKEN; final NOT FOLD-READY.**

---
**Method note (campaign law, self-applied):** no clocks were introduced by this report; every cited
line was re-verified at the current HEAD (`7eff7cb`) by `grep -an`/`sed -n`; `application.mjs` and
`coordination-store.mjs` were read by grep/sed only; no `localeCompare`; sorted-key literals cited as
verified.
