# Red-team: trust-gate steering contract v0.9 — AUTHORITY + ANTI-GAMING

(Target: `docs/reference/evidence/trust-gate-steering-2026-08-02/trust-gate-steering-decisions.md` v0.9.
Angle: authority binding + anti-gaming. Every claim grounded in `impl/src/` file:line, verified 2026-08-02.
NUL-byte files (application.mjs, coordinator.mjs, coordination-store.mjs) read via `grep -an` / `sed -n`.)

## Verdict summary

| # | Attack | Verdict | One-line basis |
|---|--------|---------|----------------|
| 1 | TG1 do-nothing worker burns full budget | **CONFIRMED-HOLE** | Deployment wires stallMs = wallMin = 8h (application-deployment.mjs:1710); a chatty idler (1 worker event/8h, coordinator.mjs:8314-8316) has NO progress-based bound — today's 1-turn kill becomes budget exhaustion |
| 2 | TG3 nudge lane = reverse injection surface; steering-cycle re-arm | **NEEDS-AMENDMENT** | Nudge arrives as a plain user frame with zero provenance marking (claude-session.mjs:1256/:1261); authorable by observe-capability principals (application-semantics.mjs:701); micro-progress re-arms cycles (wave-driver.mjs:613-614); claim path can bypass (coordinator.mjs:2318); no mid-turn lane |
| 3 | TG4 verdict {gate, detail} reveals per-run evidence | **NEEDS-AMENDMENT** | DIAG-2 read shape is honest (digests+counts), but the proposed run.feedback delivery lane accepts CALLER-AUTHORED {gate, detail} with shape-only validation (application.mjs:1420-1468) — forged verdicts steer workers AND the planner's revision loop; required_effect degrades to 'unknown' (:797-804); baseSha/sha must stay hub-side |
| 4 | TG5 analysis:true digest binding / plan amendment | **DEFENDED (machinery) / NEEDS-AMENDMENT (wording + omission path)** | Closed node schema (goal-plan.mjs:291-296) + plan/approval digests + planBriefMatches make post-approval flips unrepresentable; BUT the contract says "brief-declared" while the binding must be a node field, and the exemption ALREADY exists by omitting requiredEffects (coordinator.mjs:11178 + goal-plan.mjs:412) |
| 5 | TG6 coaching deferral: harmful vs redundant | **NEEDS-AMENDMENT** | Actively harmful: the diff-churn coaching trains exactly the digest-keyed treadmill resets the new steering bounds are sensitive to (wave-driver.mjs:613-614, :505); deferral has no acceptance criterion |
| 6 | Missed authority hole(s) | **CONFIRMED-HOLE (6a/6b) + NEEDS-AMENDMENT (6c/6d)** | TG2 evidence is worker-farmable by trigger (scratchpad write admits at coordinator.mjs:9680-9725, 128-entry cap only); blocking questions park the worker OUTSIDE the stall watchdog (:10906-10919 vs :7903) with deadlineAt:null AND count as TG2 progress; claim bypass; contextEffectNodeBinding is an unnamed TG5 touch-point |

## Attack 1 — TG1: worst-case burn of a do-nothing worker (final-only vs today)

The contract's own red-team target asks: "does deferring required_effect to final-only let a worker
run the clock with no diff forever (the watchdog/stall path is the bound — is it sufficient)?"
Answer: **no — not as configured, and for one worker class not at all.**

### Today's bound

In the common case there is no registered steering driver — the coordinator's own comment says
"no live steering registration for the run — today, every run" (coordinator.mjs:1996). A
do-nothing worker's FIRST `turn_completed` with no diff is auto-settled by `_admitPauseRecord`
(coordinator.mjs:2003-2063, `basis: 'auto_no_driver'` at :2052-2056) and falls straight into
`_runTrustGate` (:10802), whose `required_effect` phase (:11178-11197) fails the task and kills
the worker. **Worst-case burn: one provider turn** — minutes of wall, one turn of tokens.

### TG1's bound (stall watchdog math)

Under TG1, intermediate completions settle as `working` with no gate. The remaining
progress-sensitive machinery:

- **Stall watchdog**: `_armWatchdog` (coordinator.mjs:7901-7917) fires `stallAction` after
  `stallMs` of silence, but ONLY silence — `handle.status === 'working'` and no worker-actor
  events. Default `stallMs: 120000` (:999), `stallAction: 'interrupt'` (:1004, :7934). **But the
  shipped deployment profile overrides it: `watchdog: { stallMs: DEFAULT_BUDGET.wallMin * 60_000 }`
  (application-deployment.mjs:1710) with `wallMin: 480` (:34-38) — i.e. stallMs = 28,800,000 ms =
  8 hours, coextensive with the entire node wall budget.** "The stall watchdog bounds it" therefore
  means "the whole 8-hour node budget bounds it" — no progress-based bound at all.
- **TG3's steering cycle** (if stall escalation is progress-class, as the contract lists it): adds
  one nudge + one continuation window (contract default: one `stallTimeoutMs` = 20 min,
  wave-driver.mjs:35) AFTER the 8h stall. Silent-idler worst case ≈ **8h20m**.
- **Token/usd hard stop** (coordinator.mjs:8131-8164): ratio-based on `task.brief.budget.tokens/
  usd`. A cheap-activity idler never trips it.
- **Wall clock**: `wallMin` is wired as the spawn/verification `timeoutMs` (:3318-3331, :4904,
  :5318) — the adapter call times out at 8h. That is the only wall bound found on a working task.
- **Provider governance**: per-TURN caps only (`maxProviderCallsPerTurn` :8264-8265,
  `maxToolCallsPerTurn` :8296-8298). `providerTurns: 2_048` (application-deployment.mjs:38) is
  run/plan accounting (application.mjs:1534-1566); no worker-level total-turn kill was found.

### The chatty-idler gap

`_observeWatchdogEvent` (coordinator.mjs:8314-8316) re-arms the stall timer on EVERY event with
`actor === 'worker'`, and it is fed for every handle event (:11089). A worker that emits one cheap
event per 7h59m — one read, one `true` command, one scratchpad write (whose receipt is hub-actor
but whose triggering wire event is worker-actor, :10861-10873) — **never trips the stall watchdog,
never trips the token/usd stop, and never finalizes, so the final-only gate never evaluates.**
Remaining bound: the 8h spawn wall only. And when it does finalize (or is killed at the wall), the
task fails — but the full budget envelope (8h slot, worktree reservation, run kept open) is spent.
That is exactly the failure the gate exists to prevent, now at ~2-3 orders of magnitude more waste
than today (1 turn → 8h).

The driver-registered path IS honestly bounded (wave driver: first checkpoint nudges, unchanged
re-park exhausts `unproductiveNudgeBudget: 1`, member done → claim-on-stall → `claimTurn` re-runs
the gate, wave-driver.mjs:589-601; wave stall marker 20 min :640; hard cap 3h :673). But TG1 does
not require a driver, and today essentially no run has one.

### Verdict

**CONFIRMED-HOLE.** The claimed bound is dishonest as configured: deployment stallMs = wallMin
makes the stall watchdog coextensive with the whole node budget, and a minimally-chatty idler has
no progress-based bound at all — only raw budget/wall exhaustion. TG1 as written converts the
gate's early-kill (1 turn) into budget exhaustion (up to 8h) for the auto_no_driver common case.

**Amendment (pick one, (a) preferred):**
(a) TG1 applies only to runs with a registered steering driver; auto_no_driver runs keep
    intermediate required_effect evaluation (or fail closed at first diff-free checkpoint). This
    makes the wave driver's proven bound universal instead of exceptional.
(b) Keep final-only verdicts but add an intermediate *progress-evaluation* (not verdict): the
    first diff-free `turn_completed` starts TG3's steering cycle immediately rather than waiting
    for stall; N consecutive diff-free checkpoints (small N, e.g. 2) escalate to the verdict.
(c) Re-tune deployment stallMs to a real progress bound (minutes, not wallMin) AND make the stall
    action verdict-producing — insufficient alone, since the chatty idler defeats any
    silence-based timer.

## Attack 2 — TG3: the nudge lane as an injection surface; steering-cycle re-arm

### Nudge text path and sanitization

The nudge IS a reverse injection lane by construction — policy- or principal-authored text into
the worker's context. What actually guards it:

- **Wire shape**: `coordinator.nudgeTurn` passes the message RAW to the adapter
  (coordinator.mjs:2208, `this._adapters[handle.vendor].prompt(workerId, message, 'turn')`), and
  the Claude adapter writes it as **a plain `user` frame, wire-identical to the task prompt**
  (claude-session.mjs:1256, :1261; the adapter's own CS7 comment: "'turn' and 'nudge' are
  wire-identical for Claude"). There is NO provenance marking on the hub→worker direction:
  `wrapProse(worker, text)` → `{provenance: 'model-authored', untrusted: true}` (messages.mjs:
  375-377) exists only for worker-authored prose consumed by the hub. A nudge arrives in the
  worker's context indistinguishable from its operator's turn — in tension with the brief's own
  "the task that follows is your sole work authority" discipline (recipes.mjs:527).
- **Sanitization present**: the application act boundary validates `validText(message, 4096)`
  (≤4096 bytes, non-empty, no NUL — application.mjs:281-283) and REJECTS on `SECRET_SHAPED_TEXT`
  (application.mjs:11607-11611). The wave driver's `completionMessage` is only non-empty-checked
  at the driver layer (wave-driver.mjs:87-88) but flows through `runHandle.act` →
  `application.command('run.act', ...)` (application-client.mjs:1111-1127), so the app boundary
  backstops it. `run.steer` applies the same checks to message and reason (application.mjs:864-874).
- **Sanitization gaps**: (a) the app-boundary `SECRET_SHAPED_TEXT` has FOUR patterns
  (application.mjs:285-290) while messages.mjs's has SIX (messages.mjs:410-417 adds `AKIA…` and
  JWT `eyJ…`) — AWS-key-shaped and JWT-shaped strings pass the nudge boundary; (b) `validText`
  does NOT NFKC-normalize (application.mjs:281-283) — homoglyph evasion of the regexes is open
  on this path (`normalizeSteer` normalizes reason but the run.act nudge path normalizes nothing);
  (c) no redaction, only rejection — a 4-pattern hit throws, so a principal probing the boundary
  learns the pattern list from error behavior.
- **Who can author**: `nudge_turn` semantic capability = `['control', 'observe']`
  (application-semantics.mjs:701), and run.act is exposed `web: true, mcp: true, mcpStateful:
  true` (application.mjs:163). An OBSERVE-holding principal can write 4096 bytes of arbitrary
  instruction text into a worker's user-role stream. In the shipped single-tenant deployment this
  is vacuous (`authorize: async () => true`, application-deployment.mjs:1738; the local-owner web
  session holds every capability, :1408-1412) — but the moment a nested orchestrator or MCP client
  holds observe-only, the steering lane is a text-injection surface into every worker it can see.

### Cycle bounding: one-per-verdict or total?

The contract bounds ONE cycle per progress verdict. It does NOT bound total cycles across a run's
life, and the code shows the re-arm shape explicitly:

- **Micro-progress re-arms the treadmill.** The wave driver resets the unproductive-nudge count on
  ANY changed digest: `if (unchanged) state.nudges += 1; else { state.digest = …; state.nudges = 1; }`
  (wave-driver.mjs:613-614), and the wave-level stall marker resets on any member digest change
  (:505). A worker alternating trivial in-scope diffs (whitespace churn) is perpetually
  "productive": no verdict ever matures, each new stall episode earns a fresh steering cycle, and
  the wave bound degrades to `hardCapMs: 3h` (:36, :673). Under TG1/TG2 the same trick works at
  the run layer with scratchpad writes as the progress class — with NO wave hardCap, only Attack
  1's budget envelope.
- **claim_turn bypass shape.** TG3 says "the run layer performs ONE bounded steering cycle" before
  the verdict — but never pins WHERE the cycle lives. `claimTurn` re-runs `_runTrustGate`
  DIRECTLY at claim time (coordinator.mjs:2318). If the steering cycle is implemented in the
  pause-settle path (`_admitPauseRecord`) rather than wrapping `_runTrustGate`'s progress verdict
  itself, every driver claim reaches the verdict with zero steering — a complete TG3 bypass. The
  shipped wave driver happens to nudge before claiming (L6), but the contract must not rely on
  driver etiquette for its own invariant.
- **Mid-turn lane missing.** `nudgeTurn` is pause-keyed (`_reservePauseRecord(pauseId)`,
  coordinator.mjs:2186): a pause record exists only at a `turn_completed` checkpoint. A worker
  hung MID-turn has no pause record, so TG3's "stall escalation" steering cycle has no delivery
  lane — the native mid-turn lane is prompt mode 'steer' (claude-session.mjs:1245-1256), which
  the contract never names. As drafted, TG3's cycle exists only where pauses already are.

### Verdict

**NEEDS-AMENDMENT.** The lane is byte-bounded and secret-pattern-checked (partially), so it is not
a raw firehose — but: (1) nudge/verdict text reaches the worker with no provenance marking,
wire-identical to operator turns; (2) observe-capable principals can author it; (3) total
steering cycles are unbounded (micro-progress re-arm), with the real bound silently outsourced to
hardCap/budget; (4) the claim path can bypass the cycle unless the contract pins the cycle around
`_runTrustGate`'s verdict, including `claimTurn`; (5) no mid-turn lane exists for the stall case
TG3 explicitly claims to cover.

**Amendments:**
(a) Mark steering text at the wire level: nudge/verdict payloads delivered with an explicit
    provenance envelope (e.g. `{kind:'policy_steering', untrusted:false, actor}` in the frame or a
    fixed prefix), never bare user prose; document that worker briefs treat only the brief as work
    authority.
(b) Unify the boundary pattern list with messages.mjs's six-pattern SECRET_SHAPED_TEXT and
    NFKC-normalize before testing on the run.act nudge path.
(c) State the total-cycle bound: steering cycles per run ≤ N (or per diff-free-episode, with a
    global episode cap), and name hardCapMs/budget as the terminal bound in the contract text.
(d) Pin the cycle around the verdict: TG3's steering cycle MUST wrap `_runTrustGate`'s
    progress-class failure, including the `claimTurn` re-run path (coordinator.mjs:2318).
(e) Name the mid-turn lane (prompt mode 'steer' / run.steer) for stall-escalation steering, or
    drop stall escalation from TG3's covered set.

## Attack 3 — TG4: what the verdict surface actually reveals

The contract's defense is: "the checks are already discoverable in the shipped source — obscurity
is not the defense, the gate's live re-run is." That answers the STATIC question (what the gate
checks). It does not answer the PER-RUN question (what the verdict evidences about THIS run), and
it ignores who can already mint verdict-shaped text.

### The {gate, detail} shape today (DIAG-2)

- `run.debug` is authorized exactly like `run.inspect` (application.mjs:11016), whose capability
  is `['observe']` (application.mjs:158) — ANY observe-holding principal reads the failure leg,
  plus the member's last 3 messages (boundedAttentionText'd, :11043-11045) and write receipts.
- `debugGateRefusal` (:841-863) projects the durable error event into {gate, detail}:
  `debugGateFromLiveCode` (:797-804) maps only scope/forbidden_effect/red_green/coverage/
  route_mismatch; **`required_effect_absent` falls to `'unknown'` with `detail: {}`** — the
  current shape cannot even name TG1's own verdict; TG4 must extend the enum, and the contract
  doesn't say what detail the progress verdict will carry.
- Scope detail is digests+counts only (:806-828); red_green/coverage detail is a
  `sanitizeVerifierDiagnosticText` tail (:830-834). Path strings never cross. This part of the
  contract's claim checks out.

### Per-run evidence beyond shipped source

The durable gate error event carries MORE than DIAG-2 projects: `requiredEffectEvidence` with the
run's **raw `baseSha` and captured `sha`** plus digests/counts (coordinator.mjs:11186-11195,
persisted into the error payload at :11471); `pathScopeEvidence` with the three path digests
(:11163-11176). Beyond the shipped source, a verdict discloses:

- **Git state**: base/head SHAs of the run (hub-side only today — IF TG4's progress-verdict detail
  ever includes them, it leaks the orchestrator's git base; in a nested-orchestrator shape that is
  parent-run state).
- **A capture oracle**: `canonicalDigest` is shipped code, so any digest in the verdict is a
  confirmation oracle — a worker can enumerate candidate path sets and test which one the capture
  attributed to it. Mostly it confirms what the worker already knows (its own diff), but
  `outOfScopeChangedPathCount`/digest also reports changes the worker did NOT make — in any
  shared-worktree or nested shape, that is a cross-tenant footprint leak.
- **The gate's evaluation timing**: the verdict receipt (`steered: {nudgeId, answered:false}`,
  TG3) plus WHICH gate fired tells a hostile worker exactly when evaluation happens — under TG1
  that is the map of when it is safe to idle (Attack 1). This is the part of "obscurity is not
  the defense" that IS load-bearing today: today the worker never learns the gate exists at all
  (#61 is filed precisely because it doesn't). TG4 should be honest that it trades this margin
  away deliberately; the live re-run is the remaining defense and it is only as strong as Attacks
  1/2 leave it.

### Who can read it; who can call run.feedback

- Read side: observe-capability principals (application.mjs:158). In the shipped deployment the
  authorize hook is vacuous (`async () => true`, application-deployment.mjs:1738); in any
  multi-tenant shape, "observe" is exactly the capability a low-trust tenant holds.
- **Write side — the real hole**: TG4 says the verdict is delivered "via run.feedback when the run
  is still live." Today `run.feedback` requires capabilities `['control', 'observe']`
  (application.mjs:169) and ACCEPTS CALLER-AUTHORED {gate, detail}: `normalizeGateCauseFeedback`
  (:1420-1468) validates SHAPE ONLY — gate in enum, digest fields HEX64-or-null, counts
  non-negative, tails re-sanitized. **Nothing binds the feedback's {gate, detail} to any real gate
  event.** Any observe/control principal can durably record a FORGED gate verdict about a
  candidate (recorded via `recordDriver` with source `authenticated_user`, :6504-6542), and the
  revision path consumes feedback rows (`_workflowRevisionFeedbackRows`, :6548-6567;
  normalization at :6119) — so a forged verdict steers not only the re-driven worker but the
  PLANNER's revision loop. The contract's "never orchestrator prose" is unenforceable in a lane
  whose existing semantics are "principal-authored prose, shape-checked."

### Verdict

**NEEDS-AMENDMENT.** The DIAG-2 read surface is honestly scoped (digests+counts, sanitized tails,
observe-gated) — but TG4's chosen delivery lane is forgeable by design today, and the contract
underspecifies the progress verdict's detail.

**Amendments:**
(a) Worker-bound verdicts must be HUB-MINTED: a `policy`-actor verdict record bound to the
    durable gate error event (e.g. `verdictDigest = digest(errorEventSeq)`), delivered with that
    binding visible; principal-authored {gate, detail} run.feedback must NEVER be presented to a
    worker as a gate verdict (mark it `claim`, or exclude the gate-cause form from worker-bound
    channels entirely).
(b) Pin the progress verdict's detail: counts+digests only; NEVER `baseSha`/`sha` (raw values sit
    in `requiredEffectEvidence` on the stream, coordinator.mjs:11186-11195 — keep them hub-side).
(c) Extend DEBUG_GATE_CODES with the progress gate explicitly (today `required_effect_absent`
    degrades to `'unknown'`, application.mjs:797-804) so "WHICH gate" is honest.
(d) State the deliberate trade: the worker now knows the gate's checks and timing; justify against
    Attacks 1/2 rather than leaning on "obscurity is not the defense" alone.

## Attack 4 — TG5: analysis:true — where is the actual binding?

The contract's own red-team target: "must the plan node's own digest carry it (a plan amendment
could strip it post-approval — the approval digest must bind it)?" The machinery answer is yes
and it is already watertight; the contract TEXT is what's soft.

### The plan node schema today (closed union)

`normalizePlanRequest` admits plan nodes through `exactObject` with a fixed key set — key,
objective, definitionOfDone, deps, pathScope, risk, budget, verification, routes, capabilities,
effects, [contextScope], [requiredEffects], [workerPolicy], [revision], [contextCall]
(goal-plan.mjs:291-296). There is NO `analysis` field today; adding one is a schema amendment,
after which it rides the same closed union. `requiredEffects` itself is validated as a subset of
`effects` containing ONLY `repository_edit` (:332, :341-342).

### Approval digest coverage

The plan digest covers the full node array (`goalPlanDigest(coreBase)` with `nodes`,
coordination-store.mjs:10426, :10438-10448); the approval digest covers goal+plan+disposition+
policyDigest (:10473-10476). There is NO plan-amendment event kind — the authority event set is
goal.version_defined / plan.version_proposed / plan.approval_decided / plan.node_dispatched /
plan.node_budget_settled (:7627) — so "amending" a plan means proposing a NEW version, which:
must name the current head as predecessor (:10436-10439), is refused dispatch once superseded
(:10495-10500), requires a FRESH approval by a DIFFERENT principal (`plan_self_approval`, :10469),
and expires with `approvalTtlMs` (= wallMin × 60s = 8h, application-deployment.mjs:851;
`plan_approval_expired`, coordination-store.mjs:10502-10503) with no renewal of a decided version
(:10471). Replay re-derives the whole chain and hard-fails on divergence (:7493-7540).
**A post-approval flip of any node field is not representable in the event grammar.**

### The brief channel (buildAuthoritativeBrief / planBriefMatches)

The task brief is HUB-BUILT from the plan node: `buildAuthoritativeBrief(goal, plan, node,
binding)` (coordination-store.mjs:10542) passes `requiredEffects` through ONLY if the node
carries it (goal-plan.mjs:399-412), and every plan-bound dispatch — initial, revision, recovery,
wave — requires `planBriefMatches(fields?.brief, state.brief, …)` (coordination-store.mjs:10631,
:10684, :10779, :10850, :10935). A dispatch-time brief mutation fails admission; the revision
path re-derives brief and requiredEffects from the node (:10627-10652). The worker never writes
its brief; plan-bound tasks refuse bare `createTask` (`goal_plan_dispatch_api_required`,
:12117-12120).

### Dispatch-time authority: who may set it

Nobody at dispatch — the brief is pinned. At proposal: the planner principal
(`service('planner')`, application-deployment.mjs:1733), subject to approval by a different
principal. The recipes' objectiveTemplate CANNOT flip it: the template renders into the member
objective STRING (recipes.mjs:295-313, :327-328) → `baton.runs.start(member.objective, …)`
(wave.mjs:202) → prose in the goal text. No structured-field parsing exists on that path, so an
objective-smuggled "analysis: true" is inert prose — PROVIDED TG5 never parses the flag from
objective/brief text.

The one real finding: **the exemption already exists by omission.** The gate fires only when
`task.brief?.requiredEffects?.includes('repository_edit')` (coordinator.mjs:11178), and the brief
carries requiredEffects only when the node does — so a planner can TODAY omit requiredEffects for
any node (approval being the only control); profiles merely default it on for every node
(application-deployment.mjs:889). TG5's flag adds documentation, not authority — unless the
contract makes the flag the SOLE legitimate omission path.

### Verdict

**DEFENDED (machinery) / NEEDS-AMENDMENT (contract wording + omission path).** The digest chain
binds any future analysis field exactly as the contract's red-team target demands; no amendment,
revision, recovery, or dispatch path can flip it post-approval. But:

**Amendments:**
(a) Reword TG5: the flag is a PLAN NODE field (planner-proposed, approval-digest-bound), surfaced
    into the brief by `buildAuthoritativeBrief` — never "brief-declared," never settable at
    dispatch, never parsed from objective/brief prose.
(b) Close the omission path: the gate (or dispatch admission) must treat a missing
    `requiredEffects` on a node WITHOUT `analysis: true` as invalid (or the profile must), so the
    exemption is auditable rather than incidental. Today omission alone already skips the phase.
(c) State that approval is the control and name the approver: analysis nodes ride the same
    different-principal approval as everything else; the approver sees the flag in the plan diff.

## Attack 5 — TG6 deferral: is the surviving coaching actively harmful?

### What IMPLEMENT_CONSTRAINTS actually carries today

Candor first: the literal "skeleton-first" string exists only in the contract itself, not in
shipped source. What `IMPLEMENT_CONSTRAINTS` (recipes.mjs:528-537) ships is: red-first ("write
the failing test first", :529), the wire-frame oversize constraint (:530), no-commit (:531),
minimal-diff style (:532), and the verbatim SCRATCHPAD_WRITE shape coaching (:533-536, issue #62 —
a prompt-side mitigation of the scratchpad's closed-kind admission, exactly the class the
operator banned). The "skeleton-first" pattern the operator hates rides in operator-authored
objectives (the contract seed's words), with the same function: force an early diff so the
every-turn gate sees progress. The shipped red-first line is its respectable cousin — a failing
test on turn 1 IS a diff, and under today's gate that is survival behavior.

### Interaction with TG1/TG3

Not merely redundant — actively harmful under the new machinery, for one code-grounded reason:
**the coaching trains digest churn, and the steering machinery is digest-keyed.**

- The wave driver's treadmill resets on any changed digest: `state.nudges = 1` when the digest
  changes (wave-driver.mjs:613-614), and the wave stall marker resets on any member digest change
  (:505). A worker trained to "write a skeleton on turn 1, flesh it out turn 2" produces exactly
  the churn pattern that perpetually re-arms TG3's steering cycle and nudge budget (Attack 2).
  The coaching, left in place, becomes a micro-progress farming manual for the new bounds.
- The SCRATCHPAD_WRITE shape coaching (:533-536) teaches workers to emit scratchpad entries as
  a first-class activity; under TG2 those receipts ARE the liveness evidence class. The coaching
  literally instructs the behavior that farms the new progress signal (bound only by the
  128-entry worker partition, coordination-store.mjs:438, :13245-13246 — see Attack 6).
- And TG6's deferral has no landing criterion: the contract's Acceptance section (:133-143)
  exercises TG1-TG5 and says nothing about coaching retirement; TG6 is "named follow-ups (out of
  v1)" with no owner, no test, no trigger beyond "once TG1/TG3 make it unnecessary." As drafted,
  the pattern rides forever.

### Verdict

**NEEDS-AMENDMENT.** Under TG1+TG3 the coaching is not inert ballast; it trains the precise
behaviors (early diff churn, scratchpad emission) that reset the new steering bounds. Retiring it
must land WITH TG1/TG3 or be acceptance-gated, not deferred to an unowned follow-up.

**Amendment:** move "retire the skeleton-first/diff-churn coaching from recipes' constraint lines
and operator objective templates" from TG6 into the v1 acceptance set: (a) the acceptance suite
includes a worker whose first turn is reads+scratchpad only and which is NOT nudged into writing
a diff (the contract's own first acceptance case already creates this worker — assert its brief
carries no diff-churn coaching); (b) `IMPLEMENT_CONSTRAINTS` drops or rewords the red-first line
to name acceptance-time evaluation; (c) TG6 keeps only per-profile tuning and boilerplate
regeneration.

## Attack 6 — Authority holes the contract missed

### 6a. TG2's "unspoofable" evidence is worker-farmable by trigger

The contract: "The evidence is the hub's own receipts (policy-actor, never worker text), so it is
unspoofable by the worker." True about MINTING, false about TRIGGERING. The
`scratchpad.write_result` receipt is hub-actor (coordinator.mjs:10869-10872) but is minted in
direct response to the worker's own `scratchpad.write` wire event (:10861-10868), admitted by
`writeScratchpad` with only fence + idempotency-key checks (:9680-9725). Every adapter wire event
is stamped `actor: 'worker'` at the trust boundary (:1160-1165) and EVERY one re-arms the stall
watchdog via `_observeWatchdogEvent` (:11089 → :8314-8316). So under TG2 the liveness farm is one
scratchpad write per stall window — 8 hours in the shipped profile (Attack 1). The only write cap
is the 128-entry worker partition (`MAX_SCRATCHPAD_WORKER_ENTRIES`, coordination-store.mjs:438,
:13245-13246); 128 × 8h ≫ any budget, so it is not the effective bound. Worse, **non-blocking
`question.asked`** (`payload.blocking === false`, coordinator.mjs:10910-10912) mints a
hub-receipted `question.asked` + `input.requested` record WITHOUT taking the pending-question
slot (:10915-10919 sets `pendingQuestionId` only in the blocking branch) — unlimited sequential
liveness receipts, per-turn provider-governance caps aside. The contract's cited bound ("BD-A
one-pending-decision admission") covers decisions only, and caps COUNT, not the farm itself.

### 6b. A blocking question parks the worker OUTSIDE the stall watchdog — and TG2 rewards it

A blocking question sets `handle.status = 'blocked'` and `task.status = 'input_required'`
(coordinator.mjs:10906-10919) with `deadlineAt: null` (:10903). `_armWatchdog` refuses any
non-`working` status (:7903), and `_touchWatchdog` likewise (:7927-7929) — so while parked on its
own question, the worker has NO stall timer at all; the watchdog re-arms only when the answer
lands (:11066-11069). The worker is unkillable-by-stall for the duration of a question it chose
to ask, in a deployment where nobody may be listening — bounded only by the wave driver's
`hardCapMs: 3h` (wave-driver.mjs:36, :673) if a driver exists, else by Attack 1's wall/budget
envelope. And under TG2 the question itself counts as progress evidence. Stalling-by-question is
not capped by the one-pending-decision admission the contract cites; it is *subsidized*.

### 6c. claim_turn reaches the verdict with no steering cycle (contract-shape hole)

Cross-reference Attack 2(d): `claimTurn` re-runs `_runTrustGate` directly (coordinator.mjs:2318),
bypassing any steering cycle that lives in the pause-settle path. The contract never pins where
TG3's cycle wraps. A bespoke driver (or a compromised orchestrator principal with run.act,
`['control','observe']` — application-semantics.mjs:701) can claim at the first checkpoint and
convert an intermediate pause into a final evaluation with zero steering — the exact
verdict-first behavior the epic exists to abolish, re-achievable through the driver's front door.

### 6d. Nested/recursive admission inherits the flag silently

Context-effect plans are bound to their durable call admission: plan digest must equal
`expectedPlanDigest` and every node binding must equal `contextEffectNodeBinding(callCore, unit)`
byte-for-byte (coordination-store.mjs:6813-6845), with units covering the admitted execution set
exactly (:6840-6845). Today that is a DEFENSE — a nested plan cannot smuggle content its
admission didn't bind. But when TG5 adds `analysis` to the node schema, the flag must ALSO be
added to `contextEffectNodeBinding`'s expected shape; otherwise either (i) nested units drop the
flag silently (analysis semantics lost across the boundary — a correctness hole), or (ii) someone
relaxes the binding comparison to admit it (an authority hole). The contract never mentions the
context-call binding as a TG5 touch-point. Same for the replay-side dispatch field list
(:7531-7532), which must admit the new field deliberately.

### Verdict

**CONFIRMED-HOLE (6a, 6b); NEEDS-AMENDMENT (6c, 6d).** The contract's anti-gaming story for TG2
rests on "unspoofable receipts" and a decision cap, while the farmable trigger, the
watchdog-escaping question park, the claim-path bypass, and the nested-binding touch-point are
all unaddressed.

**Amendments:**
(a) TG2's progress evidence must be RATE-AWARE, not presence-aware: liveness requires NEW
    substantive evidence since the last checkpoint (diff digest change OR scratchpad/board/
    interaction receipts above a floor), and question.asked counts ONLY on resolution
    (orchestrator-answered), never on asking. Non-blocking questions never count.
(b) Close the park: either `_armWatchdog` covers `blocked`/`input_required` with a separate
    (longer) interaction-stallMs, or a blocking interaction carries a real `deadlineAt` whose
    expiry escalates to the TG3 cycle. State which, in the contract.
(c) Pin TG3's steering cycle around `_runTrustGate`'s progress verdict on ALL entry paths,
    explicitly naming `claimTurn` (coordinator.mjs:2318).
(d) List TG5's touch-points exhaustively: node schema (goal-plan.mjs:291-296),
    `buildAuthoritativeBrief` (:399-412), `planBriefMatches`, dispatch payload
    (coordination-store.mjs:10656, :10699, :10803) + replay field lists (:7531-7532), AND
    `contextEffectNodeBinding` (consumed at coordination-store.mjs:6834, :5981).

## Required amendments (consolidated)

Ordered by severity. Each is stated once; per-attack sections carry the full grounding.

1. **(A1, blocking) Re-bind TG1's progress bound.** Either gate TG1 on a registered steering
   driver (making the wave driver's proven bound universal), or add an intermediate
   progress-evaluation that starts TG3's cycle at the first diff-free checkpoint and escalates
   after N consecutive diff-free checkpoints. Independently: de-couple deployment `stallMs` from
   `wallMin` (application-deployment.mjs:1710) — a stall timer coextensive with the whole node
   budget is not a progress bound. Without one of these, TG1 converts the gate's 1-turn early
   kill into up-to-8h budget exhaustion for the auto_no_driver common case
   (coordinator.mjs:1996).
2. **(A6a/6b, blocking) Make TG2 rate-aware and close the question park.** Liveness requires NEW
   substantive evidence since the last checkpoint; `question.asked` counts only on resolution,
   never on asking; non-blocking questions never count; and a blocking interaction must either
   keep a (longer) stall timer armed in `blocked`/`input_required` or carry a real `deadlineAt`
   that escalates into TG3. As drafted, TG2 subsidizes stalling-by-question with progress
   evidence while the stall watchdog is disarmed (coordinator.mjs:10906-10919, :7903).
3. **(A2/6c, blocking) Pin TG3's cycle around the verdict, not the pause path.** The steering
   cycle must wrap `_runTrustGate`'s progress-class failure on EVERY entry path, explicitly
   including `claimTurn` (coordinator.mjs:2318); add a total-cycle bound per run (name
   hardCapMs/budget as the terminal bound); name the mid-turn lane (prompt mode 'steer',
   claude-session.mjs:1245-1256) for stall escalation or drop stall escalation from TG3's set.
4. **(A2, high) Mark steering text at the wire level.** Nudge/verdict payloads delivered with an
   explicit provenance envelope, never bare user prose; unify the run.act boundary's
   SECRET_SHAPED_TEXT with messages.mjs's six-pattern list and NFKC-normalize before testing
   (application.mjs:281-290 vs messages.mjs:410-417).
5. **(A3, high) Hub-mint worker-bound verdicts.** A `policy`-actor verdict record bound to the
   durable gate error event; principal-authored {gate, detail} run.feedback
   (application.mjs:1420-1468) must never be presented to a worker as a gate verdict. Pin the
   progress verdict's detail to counts+digests (never `baseSha`/`sha`,
   coordinator.mjs:11186-11195) and extend DEBUG_GATE_CODES so `required_effect_absent` stops
   degrading to `'unknown'` (application.mjs:797-804).
6. **(A4, medium) Reword TG5 to its real binding.** The flag is a PLAN NODE field
   (planner-proposed, approval-digest-bound), surfaced into the brief by
   `buildAuthoritativeBrief`; never dispatch-settable, never parsed from objective/brief prose.
   Close the plain-omission path so the flag is the sole legitimate way a node drops
   `repository_edit` (today omission alone suffices, coordinator.mjs:11178 + goal-plan.mjs:412).
   Enumerate touch-points including `contextEffectNodeBinding` and the replay field lists.
7. **(A5, medium) Land the coaching retirement with TG1/TG3, not after.** Move it into the v1
   acceptance set; the coaching trains the digest-churn that resets the new steering bounds
   (wave-driver.mjs:613-614, :505), so deferring it past v1 leaves a farming manual in every
   objective.

## What the contract gets right (for the record)

- The plan/approval/dispatch digest chain is genuinely watertight against post-approval
  amendment (Attack 4): closed schemas, digest-bound versions, different-principal approval,
  supersession and TTL refusals, replay re-derivation. TG5's flag, once a node field, inherits
  all of it.
- The DIAG-2 read surface (digests+counts, sanitized tails, observe-gated) is an honest shape to
  reuse for TG4 — the danger is the WRITE lane it proposes to reuse, not the shape.
- The driver-registered path's bounds (nudge budget → claim → gate at claim; stall marker; hard
  cap) are real and proven; the epic's mistake is assuming that path where the coordinator's own
  comment says "today, every run" has no driver (coordinator.mjs:1996).
- Counting coordination work as progress (TG2's intent) is the right direction; the hole is the
  farmability of the trigger and the question-park watchdog escape, both fixable per amendment 2.
