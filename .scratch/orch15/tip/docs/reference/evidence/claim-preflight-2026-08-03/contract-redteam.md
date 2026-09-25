# Red team — claim-time liveness preflight contract (issue #88, CP1–CP10)

Adversarial review of `claim-preflight-contract.md` v1.0 (same directory), performed 2026-08-04
against the live tree. Method: every load-bearing file:line anchor spot-checked with `grep -an` /
`sed -n` (NUL-byte discipline for coordinator.mjs/application.mjs); the wave-driver composition
traced line-by-line over `impl/src/wave-driver.mjs:151-157, 240-264, 325-328, 504-505, 568-673`;
the registry digest-consequence chain walked over `application.mjs:8123-8136, 3127-3139, 9739-9767`
and `application-semantics.mjs:1888-1959`; the six claimTurn call sites OUTSIDE the trust-gate
suite audited individually (the contract audited only T10b/T17). md5 spot-check of the contract's
grounding claim: `impl/src/coordinator.mjs` = 85a05b87aad73c24d080545a9a2dd3fc, 13501 lines —
EXACT, the contract's re-verification claim holds at the file level.

## 1. Citation audit (30+ anchors checked)

**Exact (verified byte-for-byte against the tree):** claimTurn :2492-2529 and every interior anchor
in ground truth 1 (:2494, :2499, :2500-2502, :2507-2511, :2512-2514, :2515-2518, :2519-2522,
:2524, :2525-2528; `_pausedActTargets` :2340-2346; the watchdog docstring :2489-2490; the rollback
quote at :2302). The required_effect skip (:12187, quoted verbatim), five-way throw (:12189),
evidence (:12195-12201), kill set (:12502), terminalCause (:12503), claim expiry (:12508-12509),
`_beginStop` (:12514). Record epoch fields (:2060-2062) and the attention-only law (:2066).
`_observeSteeringCycle` :2200, steering-less guard :2204, `_settleSteeringCycle` :2218-2231,
`_expireSteeringCycle` reservation guard :2236-2238, `_clearSteeringTimer` :2111-2116 (null-safe),
capability_op :2185-2196. Watchdog entry :8821, provider_call :8828-8830, governance case
:12906-12926. content.message prose :11209-11211; no_progress :8090-8116. scratchpad.write_result
mint :11777-11780, cycle feed :11783-11785, context.read "no _observeSteeringCycle" :11792, mint
:11794-11797, board.claim_result :11803-11812. question.answered :9451, approval.resolved :9456,
decision.settled :9583, cycle answers :9490/:9620. Gate capture :12147-12155, sha :12156,
changedPaths :12157, inScope filter :12168, baseSha derivation :12188. recipes.mjs
IMPLEMENT_DEFAULT_POLICY :537-546. wave-driver header :17-19, claimOnce :246-264, claimAttempted
:247-248/:327, code mapping :252-255, nudgedRequestIds :328/:578. authorityProjection destructive
slots :1905/:1911/:1919, digest :1958. application.mjs freshness.registryDigest :9761, envelope
:9803, claim_turn dispatch :11892-11899 (error lane :11897-11899), attention advertise :9621,
descriptor destructive :9749, actionId registryDigest :8126, recheck :3127-3139. Test anchors:
phase87:60/:302, phase67:165/:460/:214/:375/:622, phase89:346/:253-312/:425,
mcp-reflex-board-package-red:243, 31b5-surface :208-228, grammar-m1 :268-276. The suite-idiom
lines in ground truth 8 (adapter :51-71, setup :80-106, stubs :113-128, T2 :155, T6 :200,
T9 :294-307, T10b :327-346, T11 :352-370, T15 :473-479, T17 :498-514). The grep claim
(`grep -rn 'destructive' impl/test/ | grep -i claim` → empty) re-run and confirmed.

**WRONG (must be corrected before fold — the contract's own header stakes its credibility on
"the numbers here are the corrected ones"):**

1. **application-semantics.mjs "flag at :517"** — the claim_turn entry is :511-518 and the
   `destructive: false, irreversible: false, idempotent: true, priority: 'recommended'` line is
   **:516**; :517 is `helpTopic: 'run.act.claim_turn', …`. CP9's "application-semantics.mjs:517
   flips destructive" and ground truth 6's ":511-519, flag at :517" are both off by one. An
   implementer editing the cited line touches the helpTopic.
2. **"counted :12925"** (ground truth 3) — the governance increment `providerTurn.toolCalls += 1`
   is **:12924**; :12925 is `break;`.
3. **recipes.mjs "policy overrides :557"** (ground truth 5) — :557 is `}],`; the
   `policy: { ...IMPLEMENT_DEFAULT_POLICY, ...policy }` spread is **:558**.
4. **`_reservePauseRecord` :2304-2330 / "rollback body :2324-2328"** (ground truth 1) — the method
   body is :2305-2337 and the rollback arrow is :2325-2330 (the three load-bearing assignments
   :2326-2328 sit inside the cited range, and `finishResolving()` at :2329 is outside it).
   Imprecise, not misleading — but cite it correctly.
5. **CP8's "counts unchanged-digest re-parks against `unproductiveNudgeBudget` (:583-585)"** —
   :583 is the `unchanged` computation and :584-586 a comment; the budget comparison is **:589**.

None of the five changes a design conclusion; all five are corrected-in-place mechanical fixes.

## 2. Per-decision verdicts

### CP1 — insertion point and ordering: HOLE (error path unspecified; one race residue)

The verified mechanics are as claimed and they are good: while the reservation is held,
`rollback()` (:2325-2330) restores `pending`/`consumer: null` with zero events, so a refusal is
event-silent; a refused claim on a cycle-armed record leaves the cycle armed because the timer
clear (:2499) moved below the preflight; `_clearSteeringTimer` no-ops on steering-less records
(:2112); and `_expireSteeringCycle`'s guard (:2237 `record.state !== 'pending' → return`) cannot
double-settle a reserved record. The memo-order insertion (after the clear) would indeed disarm
the cycle and strand the pause — CP1's rationale is correct.

**Hole 1 — a preflight throw wedges the record forever.** The contract specifies only the
CP2-fire path ("rollback() and return — no throw"). If the preflight's `await
handle.worktreeReady` rejects or the fresh `_worktrees.capture` throws (capture_failed is a live
code path, :12145-12155's own sibling at :8107), the error propagates out of claimTurn with no
rollback: the record stays `resolving` (:2318), `resolvingDone` never releases (:2320), every
subsequent claim/nudge/wait on that pauseId hangs awaiting it (:2309), and the steering-expiry
guard (:2237) skips `resolving` records — a zombie pause no authority can settle, exactly the
contradictory-state outcome attack surface 3 asks about. Fix (one sentence in CP1 + one row):
wrap the preflight in try/catch mirroring :2519-2522 — on ANY preflight throw, `rollback()` and
rethrow; acceptance pin (d) gains a capture-throws row (claim rejects, record `pending`,
`consumer: null`, a second claim proceeds).

**Residue (minor) — the swallowed expiry.** If the steering window fires DURING the preflight's
capture await, `_expireSteeringCycle` returns at the reservation guard (:2238) having done
nothing — and the one-shot timer is spent. On the refuse path the rollback restores `pending`
with `steering.answered === false` and a dead timer: the cycle can never fire again, and a
driverless pause (the only kind with a cycle) can now pend to run termination with no verdict —
where today the same claim would have run the gate. Fix: have the guard-skip set
`record.steering.expiryPending = true`; the refuse path runs the expiry synchronously after
`rollback()` (a flag and one call — count-lawful, no clock).

### CP2 — trigger predicate: SOUND, with two pin amendments

The mirror is verbatim-correct as quoted (:12187 condition; :12189 five-way test), and keying
"diffless" on a fresh capture rather than the record's attention-only digest (:2066) is the right
law — verified the record's digest is documented as never-gate-input at :2066. Two things the
contract cites but does not spell out, and no acceptance row pins: (a) the five-way test reads
`baseSha` from `task.sessionContext?.baseSha ?? captured?.baseSha ?? null` (:12188) and
`inScopeChangedPaths` from `pathInScope(task.brief.pathScope, path)` (:12168) — a shallow mirror
that compares only `captured.sha === captured.baseSha` diverges from the gate whenever
sessionContext.baseSha differs; (b) the capture call itself carries authority kwargs
(vendor/model/ownerTaskId/expectedBaseSha/expectedBranch/sparse, :12147-12155) — T18's stub
(`capture: (...a) => current(...a)`) ignores arguments, so an implementation capturing with WRONG
kwargs greens every pin while behaving differently on real worktrees (expectedBaseSha mismatch →
capture_failed → hole-1 wedge on the live path). Fix: T18 asserts the capture spy received the
gate-identical kwargs, and one row pins the `!sha || !baseSha` edge (capture returning null sha →
would-fire true). The double-capture cost claim is sound: capture is diff-vs-base stable across
repeated calls (the no_progress determination at :8096-8116 depends on exactly that), so the
preflight's extra capture cannot flip the gate's own tuple.

### CP3 — the counted set: SOUND, one criterion-wording amendment

Each counted class verified at its mint: scratchpad.write_result ok:true (:11777-11780, hub
actor), context.read_result ok:true (:11794-11797, hub actor), content.tool_call governance case
(:12906-12926, increment :12924) plus watchdog/logical accounting (:8832-8854),
resource.provider_call (:8828-8830), interaction resolutions (:9451/:9456/:9583 — minted only on
resolution, so "resolution-gated" holds by construction). Actor classes are load-bearing and
correctly stated. **Wording hole:** the section's own admission rule — "hub-receipted or
governance-counted" — does not cover item 4 (`content.message`): it is not hub-receipted and is
governance-counted NOWHERE (ground truth 3 itself: attention prose :11209-11211 + a watchdog
touch, and the watchdog touch at :8823 applies to every worker event, so it cannot be the bar
without also admitting the lifecycle markers CP5 excludes). Either amend the criterion to name
the third class honestly ("watchdog-observed worker content events") or drop item 4 — the #88
receipt (5 Bash tool_calls) needs only items 1-3. Design note, non-blocking: CP3 has no per-epoch
dedup and needs none (≥1 gates a boolean; TG2's no-content-floor rule holds), but see CP8 for
where the farm bound ACTUALLY lives — and what happened to it.

### CP4 — the pause-epoch window: SOUND, one missing pin

`this._log.read(record.worker)` filtered by `e.turnEpoch === record.turnEpoch && e.seq <=
record.mintedEvent` — both record fields verified at :2060-2062; the seq bound is indeed
belt-and-braces over the epoch bound (a parked worker mints nothing). No clock, replay-stable —
campaign-lawful. **Gap: no acceptance row exercises the epoch filter.** Every pin in the contract
emits liveness in the SAME epoch as the pause; a shallow implementation reading the whole worker
stream with no epoch/seq restriction greens (a)-(d) byte-identically while letting stale liveness
rescue a genuinely stuck worker — attack surface 2's headline question, currently unpinned. Fix:
add a row — epoch-1 liveness, epoch-2 diffless pause with zero epoch-2 events → claim → FULL gate
→ `required_effect_absent` kill. Hardening note (non-blocking): turnEpoch rides the harness wire
envelope, not worker text, so the anti-stale filter inherits harness-envelope honesty rather than
TG2's worker-text law — acceptable, but the contract should say so once.

### CP5 — what never counts: SOUND

Verified: a cycle-answering scratchpad write settles its record working via `_settleSteeringCycle`
(:2218-2231) leaving no pending record to preflight; lifecycle markers must be excluded or every
pause refuses (T10b/T17 fixtures emit spawn → turn_completed → claim — re-verified zero CP3
events, so the byte-identical claim holds); driver/policy-actor events are steering acts.
T18b implicitly pins the lifecycle exclusion (it emits turn_completed and must still die) — good.

### CP6 — the refusal: SOUND (inherits CP1's error-path fix)

Both surfacing lanes verified to exist TODAY: application dispatch forwards `{ok:false}` as an
application error carrying `claimed.result` as the code (:11897-11899), and claimOnce maps
`result.ok === false` to `code: result.result` (:252-255) recorded on the claims evidence (:262)
— `claim_premature_liveness` lands on both with zero new plumbing. The rollback-clean guarantees
(pause pending, worker alive, no turn.settled/gate/verdict events) are exactly what reservation
mechanics provide (:2325-2330), and claimable-later is real: the preflight re-evaluates on a
fresh capture each attempt, so a subsequent diff flips would-fire false and the full gate runs.
The refusal mints no event, so nothing the TG3 cycle or watchdog can misread as progress (attack
surface 3's second question: no). The liveness payload shape (counts + digests, no paths/prose)
is TG4-consistent.

### CP7 — post-memo receipt classes excluded: SOUND (defer; see open question 1 below)

board.claim_result's deliberate non-liveness is documented in-code (:11806-11807) and
capability_op's cycle-only role at :2185-2196. Exclusion is the conservative direction.

### CP8 — wave-driver composition: HOLE (the farm bound; the contract's strongest claims are false as written)

Traced over the live loop (:504-505, :568-673). `claimAttempted` per-member IS consumed by a
refusal today (:247-248), so per-pauseId keying is necessary — that half is right. The
termination story is not:

1. Once `state.done` is set (treadmill, :589-591), EVERY subsequent re-park enters the done
   branch (:569-577). With per-pauseId `claimAttempted`, each NEW pauseId triggers a fresh
   `claimOnce` → refused (worker has fresh in-epoch liveness) → fresh corrective nudge (the
   `refusalNudged` flag is per-requestId) → settle working → re-park. **No count binds this
   loop.** The unproductiveNudgeBudget was already spent getting to `done`; L4's dedup and the
   K=3 rule (:578, :581) don't apply to corrective nudges by construction.
2. The wave stall clock cannot fire: `stallMarker` (:151-157) hashes the whole outline INCLUDING
   attention requestIds, and each re-park mints a new pauseId (`pause:${task.id}:${seq}`, :2059)
   → the marker changes → `lastMarkerAt` resets (:505) every cycle. The remaining terminators are
   `hardCapMs` (3h WALL, :673), the task's own token/usd budgets, or provider-governance hard
   exceed — i.e., the anti-farm bound for the exact class this contract protects becomes **a
   clock in disguise**, while CP8 claims "bounded by counts, no timers", "the member closes
   exactly as today", and CP10 claims "Farm bound: unchanged". All three statements are false as
   written: today the liveness-rich diffless worker dies at the FIRST budget-exhausted claim
   (gate verdict, terminal); as written it churns claim→refuse→nudge→re-park until the 3h wall
   and is reaped by `wave.close` (:695-697) with NO gate verdict ever.

   **Fix (counts, no new clocks):** give the corrective nudge a per-MEMBER count budget (one
   flag, e.g. `refusalNudges` capped at 1, parallel to unproductiveNudgeBudget). While budget
   remains: refuse → nudge (as CP8 says). Once exhausted: the refusal is recorded on the claims
   evidence with NO nudge; the pause pends; no new pauseId is minted; the stall marker stabilizes
   and the PRE-EXISTING stall clock fires; the D9 fan-out claim (:641-646) is refused-and-
   recorded (per-pauseId attempt already consumed → no-op, or refused again and tolerated);
   basis 'stall'; the guaranteed close reaps. Worst case added latency is then (budget × one
   nudge cycle) + one stallTimeoutMs — and the stall clock is the driver layer's own pre-existing
   terminator (the K=3 unsteerable rule already defers to "stall/cap" the same way, :579-581), so
   the contract introduces no clock. CP8/CP10's text must then say the true thing: for a
   permanently diffless worker that stays alive, the terminal judgment moves from the gate to the
   driver's stall/cap reap — named, not hidden behind "exactly as today".
3. Secondary spec gap: CP8 must say whether `refusalNudged` is consumed on ATTEMPT or on
   DELIVERED acknowledgment. D8 (:600-609) established that nudge refusals do NOT consume
   requestIds; consuming refusalNudged on a failed delivery would strand a live worker's pause
   (claimAttempted spent, nudge spent, L4 dedup blocking the ordinary nudge) to the stall reap
   through no fault of its own. Consume on delivery, symmetric with D8.
4. **CP8 has no acceptance pin at all.** The memo promised a wave-driver-red claim-refused
   recording row; the contract's pins (a)-(d) never touch the driver — a CP8 no-op (or the
   unbounded loop above) greens the entire acceptance section. Add wave-driver rows: refusal code
   recorded on claims evidence; exactly one corrective nudge for the same requestId; the NEXT
   pauseId is claimed again; the per-member corrective budget exhausted → no further nudge.

### CP9 — the honest-registry flip: SOUND (citation fix; one policy note)

The consequence chain is verified fail-closed: the flip changes the authorityProjection's actions
slot (:1911) → authorityDigest (:1958) → every actionId (which EMBEDS the registry digest,
:8126) and every `freshness.registryDigest` (:9761) and envelope digest (:9803). A pre-flip
actionId presented post-flip is simply not found by `_recheckSemanticAction` (:3131-3137) →
typed `application_action_scope_mismatch` — the contract's "expected registry-versioning
semantics, not a runtime migration" is ACCURATE, and the wave driver tolerates it (claimOnce
records the code and polls on). No durable actionId store exists; in-flight pauses are
coordinator-level and unaffected; all digest pins in the suite are dynamic (phase67:375/:622,
phase89:253-312/:425, mcp:243 presence — re-verified). Policy note (non-blocking): the registry's
human-facing `version` stays '1.3.0' (:1089) because phase87:61 pins it and acceptance (c)
forbids moving pre-existing rows — a semantic flag flip with no version movement is a small
honest-registry gap the contract should NAME (defer the bump policy explicitly, or amend the row
in the same fold). Fix the :517→:516 citation (blocker 4).

### CP10 — the silent-worker path: SOUND in mechanism, HOLE-in-text

The silent path is verified untouched: zero CP3 events in the window → would-fire alone cannot
refuse → full gate → :12189-12204 → :12502-12515, exactly as today; T17/T10b fixtures emit zero
counted events (re-verified) and T18b pins the kill. TG1's no-third-outcome law holds — the
preflight is claim admission, not a gate verdict. The text claim "Farm bound: unchanged" is
false as written (see CP8) — the bound CHANGES BY DESIGN for liveness-rich workers; what the
contract must say is that it moves to the capped corrective nudge + the driver's pre-existing
stall/cap reap, with the final gate's diff requirement byte-for-byte intact (that part IS true
and is the actual anti-gaming law).

## 3. Cross-cutting attack-surface answers

**Suite blast radius (beyond the audited suite).** The contract ground-truthed only
trust-gate-steering-red.test.mjs. I audited the other six claimTurn call sites:
phase11-persistent-sessions:372/379 (brief omits requiredEffects → would-fire false → identical);
turn-checkpoints-31a-red:699 (claim `.catch(() => {})`, zero-liveness fixture → gate path →
identical); turn-checkpoints-31b5-surface-red:247 (diffed pausedRun, asserts `claimed.ok` →
would-fire false → identical); phase10-driver-e2e:112 (real worktree diff, expects completed →
identical); bidirectional-driver-red:369 (diffed, expects claimed → identical);
turn-checkpoints-31b-red:205 (races a nudge; loser gets `already_resolved` before the preflight
is reached → identical). Acceptance (c)'s byte-identical claim SURVIVES, but the contract should
have enumerated these; fold this audit in.

**Preflight vs TG3 cycle on one pause (attack surface 8).** Precedence is correct: refuse leaves
the cycle armed (the cheaper save survives — verified :2237 guard + rollback); proceed consumes
the cycle as its own answer (6c, :2497-2499); no double-settle race exists. The one residue is
CP1's swallowed-expiry race (above). Note the driverless path is deliberately unchanged: a
liveness-rich diffless worker whose one TG3 window expires still dies at the gate — the
preflight protects only claim admission, which is the #88 control point. Consistent.

**Shallow-implementation scan of the four pins (attack surface 6).** (a) is tight on
rollback/kill/refusal/reclaim semantics but silent on the CP4 epoch filter, the capture-kwargs
mirror, and the preflight-throw path (blocker 3). T18b usefully kills the "count lifecycle
markers" shallow. No pin exercises an ok:false scratchpad/context receipt — an implementation
counting FAILED receipts greens everything; one line in T18 (an ok:false write_result present,
claim still refused only because of the tool_calls — or a dedicated row) closes it. (c) pins the
flag and summary but the registry `version` note (CP9) is unaddressed.

**The four open questions (attack surface 7).**
1. board.claim_result / capability_op — **defer, non-blocking.** Exclusion creates NO new blind
   spot: a board-only/capability-only turn counts for nothing at claim time TODAY, so v1
   preserves status quo exactly; the asymmetry (scratchpad counts, board.claim doesn't) is
   visible but lawful. Caveat: post-#78 waves make board.claim common in legitimate recon, so
   schedule the grounding pass (live receipt + farm analysis) as a NAMED follow-up at
   acceptance, not an open-ended one.
2. `irreversible` — **defer, non-blocking.** Conservative is right while the flag pair's
   consumer semantics are ungrounded; but note 2-of-3 claim outcomes (claimed-completed,
   claimed-killed) are de facto irreversible, so the honesty argument CP9 makes for
   `destructive` applies to `irreversible` almost verbatim — it will resurface; ground the
   consumers (MCP annotations, outline rendering) in the follow-up.
3. Capture cost / safe-direction digest short-circuit — **defer, sound.** Skipping the preflight
   capture when the attention digest already proves a diff is safe because the gate re-captures
   and re-verifies; the reverse stays banned, correctly.
4. Live-restage ownership/seat — **defer, non-blocking.** T18's mock-provider row is the real
   pin; the glm live receipt is corroborating evidence. Either directory works; decide at fold.

## 4. Verdict

**NOT FOLD-READY — 4 blockers.**

1. **CP8 termination hole (the farm bound).** The refuse→nudge→re-park loop is unbounded in
   counts; the stall marker resets on every new pauseId (:505, :151-157, :2059), so the only
   terminator is the 3h hardCap wall; "bounded by counts, no timers" (CP8), "closes exactly as
   today" (CP8), and "Farm bound: unchanged" (CP10) are false as written. Fix: per-member
   corrective-nudge count budget (exhaust → record-only, pause pends, pre-existing stall clock
   reaps), refusalNudged consumed on delivery (D8 symmetry), and honest closure text in CP8/CP10.
2. **CP1/CP6 preflight error path.** A worktreeReady rejection or capture throw wedges the pause
   record in `resolving` forever (claims hang on :2309; the expiry guard :2237 skips it). Fix:
   try/catch → rollback + rethrow (mirror :2519-2522), plus an acceptance row.
3. **Acceptance coverage gaps.** No pin for: the CP4 epoch filter (stale-liveness exclusion —
   the anti-stale story is entirely untested), CP8 as a whole (the memo's wave-driver row was
   dropped; a CP8 no-op greens (a)-(d)), the preflight-throw rollback, and the capture-kwargs /
   baseSha-derivation / inScope mirror (:12147-12155, :12188, :12168 — T18's stub ignores
   arguments). Add the named rows.
4. **Citation corrections.** application-semantics.mjs flag :517→:516 (entry :511-519→:511-518);
   governance counting :12925→:12924; recipes overrides :557→:558; `_reservePauseRecord`
   :2304-2330→:2305-2337 (rollback :2324-2328→:2325-2330); CP8 budget anchor :583-585→:583/:589.

Non-blocking amendments to fold with the fixes: CP3's admission criterion must cover (or drop)
`content.message`; the swallowed-expiry `expiryPending` re-check on the refuse path; name the
registry version-bump policy for the flag flip; state that CP4's epoch filter inherits
harness-envelope honesty; fold in the six-suite claimTurn audit from §3; schedule open question
1's grounding pass at acceptance.

The core design — claim admission as the control point, a typed rollback-clean refusal, the
closed hub-receipted liveness set, the event-epoch window, the silent-worker path untouched — is
sound and verified against the code. The citation base is 90%+ exact with five correctable
defects. What blocks the fold is not the hub-side preflight; it is the unexamined driver-side
termination story (blocker 1) and the unspecified error path (blocker 2), both with fixes stated
above.
