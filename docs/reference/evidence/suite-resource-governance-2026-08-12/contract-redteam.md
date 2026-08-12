# #77 RED-TEAM VERDICT — suite-resource-governance contract v1.0

**Subject:** `suite-resource-governance-contract.md` v1.0 DRAFT (same directory)
**Date:** 2026-08-12
**Review HEAD:** `6d9d6d5d5f180c5dbb4f3d7d292344c72a6cc5e5` (current worktree HEAD)
**Laws honored:** no clocks as workflow controls; every citation re-verified at the current HEAD
(via `sed -n`/`grep -an`); NUL-bearing source files (`application.mjs`,
`coordination-store.mjs`) never opened whole — the contract itself cites none of their lines
directly, and this review likewise reads them only through the cited wrapper documents.

**Final verdict: NOT FOLD-READY.** Four numbered blockers (B1–B4) below. Two of the four decisions
(D1, D2) carry substantive holes that undercut the contract's central law ("a recalibrated cap
never masks a correctness failure" and "a deadline must never be shorter than an honest static
floor"); D3 and D4 are SOUND. All content anchors re-verified except the contract's own
verification-HEAD stamp (B4).

---

## 1. Citation re-verification (executed first, per the brief)

Every anchor in the contract was re-read at `6d9d6d5` with `sed -n`/`grep -an`. The NUL-file rule
was respected: the contract never cites `impl/src/application.mjs` or
`impl/src/coordination-store.mjs` line numbers directly (the only appearance is inside the
quoted `grounding.md:240` row content, which this review did not follow into the kernel).

| Anchor | Verified content at `6d9d6d5` | Verdict |
|---|---|---|
| G1 `run-suite.mjs:19-25, 27-74, 76-117`; `impl/package.json:27` | :19-25 fixture-clock-lint → stderr + exit 1; :27-74 surface-conformance (ledger, classifySurfaces, checkEnumStrings, checkLedgerMonotone); :76-117 `mkdtempSync('baton-suite-')` + `chmod 0o700` + owner receipt + `spawn(node --import <watchdog> --test ...argv.slice(2), {detached, stdio:'inherit', env})`; `package.json:27` = `"test": "node scripts/run-suite.mjs"` | PASS |
| G2 `run-suite.mjs:217, 225, 232, 241`; `run-evidence.mjs:13-15, 122-127, 137` | `termDeadline = Date.now()+5000`; `killDeadline = Date.now()+1000`; `waitForTrackedGroup(Date.now()+1000)`; `forceTimer = setTimeout(SIGKILL, 5000)`; run-evidence `TERM_GRACE_MS=5_000 / KILL_GRACE_MS=1_000 / POLL_MS=25` at :13-15, the deadline loops at :122-127, forceTimer SIGKILL at :137 | PASS |
| G3 `phase56:45`, `kimi:18`, `grok:73`, `phase8:75` | `until(... timeoutMs=3_000)`; `waitFor(... timeoutMs=2000)`; `until(... timeoutMs=3000)`; `waitUntil(... timeoutMs=1500)`; `issue10-waiting-vocabulary-red:459` `timeoutMs=20_000`; `orchestrator-wake-red:370` `tries=400, delayMs=20`; 285 `*.test.mjs` files; 679 poll-call-site lines across them | PASS |
| G4 `phase56:268, 645`, `grok:648`, `codex:527`, `bidir:1176`, `claude:633` | `Date.now()-started < 500` (deployment deadline); `>= 4_500 && < 8_000`; `elapsed < 2000` (requestTimeoutMs); `elapsed < 2000` (second instance, codex); `woke.elapsedMs < 1_000` (wake interval); `elapsed >= 60` (grace floor) | PASS |
| G5/G6 `PROGRESS.md:12-14, 401-405, 425-427`; `orchestrator-friction-ledger.md:52` | "surfaced 4x, each passing isolated re-runs — D9's cap recalibrated honestly (waves.start alone measures ~3.9s under load)"; "recurred 8x across gates — every row passes isolated re-runs"; "green twice isolated each"; friction-ledger row "5 isolated re-runs this sweep (kimi-acp, SC18, DC4/DC5, phase92…)" | PASS |
| G7/G8 `suite-blueteam.md:246-260, 251`; `suite-67-brief.md:18-20`; `stall-watchdog-contract.md:422-428` | F7/B4 finding (30 ms interval vs 60 ms `_armWatchdog`, 2× margin); "#7 load-flake class is exactly a wall-clock race between a test stream and a real timer" (:251); "NEVER declared stalled; no bound fires on elapsed time without an evidence check"; "A 20-minute compile is not a stall" | PASS |
| G9/G10 `fixture-clock-lint.mjs:1-14, 24-48`; `suite-hygiene.mjs:1-10, 23-32` | time-bomb shape (CoordinationStore + near-dated expiry + no injected clock); ESRCH-only owner-death sweep (no age heuristic) | PASS |
| G11 `run-suite.mjs:105`; node version | `node v25.8.0`; spawn argv has no `--test-concurrency` | PASS |
| G12 `grep -rn 'loadavg\|availableParallelism\|cpus()' impl/scripts impl/test` | empty (exit 1) | PASS |
| D1.3 `run-suite.mjs:108-116` | the `env:` seam carries `BATON_SUITE_*` keys (the calibration env would ride it) | PASS |
| D2.2 `suite-blueteam.md:256-257` | B4 concrete fix (widen margin / drive through `now()`/`tick()` seam) | PASS |
| D2.4 `waiting-vocabulary-2026-08-06/grounding.md:234-240` | the honest-null rule's precise statement is at **:227**; :234-240 is the waitingOn-kinds table whose rows carry the "honest-null note" column (incl. "honest-null when blocked/paused", "backing event seq"). Not a fabrication, but the citation is ~7 lines late — the rule lives at 227 | DRIFT (minor) |
| D2.2 `(#80 F2 precedent)` | no anchor given. The precedent exists at `docs/reference/evidence/tg3-window-2026-08-07/suite-fold-2.md:87` — "F2 — MEDIUM — TW-03's staging rides event ordering, never real wall time" (the #7 class). Under-anchored, not nonexistent | DRIFT (minor) |
| Verification HEAD claim | `5ac5e65` is **not** an ancestor of `6d9d6d5`, and the contract file does **not exist** at `5ac5e65`. The "current worktree HEAD" claim is stale | **FAIL → B4** |

No content citation in the contract is wrong at the current HEAD. The two drifts are precision
nits; the verification-HEAD stamp is a genuine integrity failure (B4).

---

## 2. Verdict per decision

### D1 — The calibration model → **HOLE** (B1, B2)

The shape (measured-load-derived deadlines, honest-static idle defaults, closed key set, stable
stderr line + `BATON_SUITE_CALIBRATION` env, `measureCalibration`/`readCalibration`/`scaledTimeout`
helpers, D1.5 recorded baseline) is the right architecture, and the recorded-load-context receipt
is exactly the observability the brief demands. But two attacks land.

**B1 — a calibrated deadline CAN be shorter than the honest static floor.** The derivation
`factor = max(1, ceil(max(load.one/cores, probeMs/BASELINE_PROBE_MS)))` (D1.2) floors at 1, so
`scaledTimeout(base) = base × factor ≥ base` — the floor is the *current per-file literal*. The
contract then asserts "the idle defaults ARE the honest measurements" (D1 preamble) and bakes that
into RG-03/RG-06 ("byte-identical idle default"; "quiet host yields factor === 1"). But the
evidence contradicts the premise: D9's receipt (`PROGRESS.md:401-403`, quoted in G5) proves at
least one current cap was **not** honest — "waves.start alone measures ~3.9s under load" was the
*recalibration*, i.e. the pre-existing cap was tighter than the measured truth. There is no
mechanism in the contract tying any idle default to a recorded measurement (and no
`baselineProbeMs` value exists anywhere in the tree at HEAD — see Open questions). Concretely:
`grok-acp.test.mjs:648` caps at `elapsed < 2000` for a `requestTimeoutMs: 200` product; a host
loaded at `load.one = 6` on 8 cores gives `ceil(6/8) = 1` → factor 1 → the derived deadline stays
2000 ms, which can sit below the honest static floor for that operation under that load. The
derived floor must be the recorded measurement, not the inherited literal.
**Fix:** floor the idle default at the D9-style recorded measurement when one exists —
`scaledTimeout(base) = max(base, recorded_floor) × factor`; revise RG-03/RG-06 to say
"byte-identical to today *only for rows with no recorded measurement*", and require the cluster
rows to first land measured recalibrations before the derived shape can claim honesty.

**B2 — the load sample is a start-time snapshot and can be gamed both ways.** The measurement is
taken once, before the child spawn (D1.1). (a) *Too lax:* a 1-minute `os.loadavg()[0]` spike
(another gate's compile, a backup) at start leaves the factor stale-high for roughly the first
minute of the run, so an otherwise-idle run gets deadlines 2–4× too lax — a genuinely hung process
is detected late (detection-latency masking; the run still *fails* eventually, but not at the
honest bound). (b) *Too tight — the cluster survives:* a suite that starts idle (factor 1) and
loads mid-run — including load the suite generates **itself** via parallel `node --test` children,
which the pre-spawn sample structurally cannot see — keeps factor 1 and re-fires the exact
under-load flake cluster the contract's title claims to end. D3.1's shed only engages when the
*start-time* factor is already > 1. (c) The load term triggers only at oversubscription:
`ceil(load.one/cores)` is 1 until `load.one > cores`, yet the #7 mechanism (event-loop gapping,
timer coalescing, G7/B4) begins well below full utilization — D9's ~3.9 s was measured under load
that need not have been oversubscribed.
**Fix:** (i) receipt the sample explicitly as a start-time snapshot and state the residual
idle-start-then-load tail as a documented residual (mid-run re-measure is already a non-goal — the
title must not overclaim); (ii) use a load signal that triggers below oversubscription (e.g.
`max(load.one, load.five)/cores` with a fractional band, or a probe-inflated band); (iii) fold the
suite's own concurrency into the factor so a full-parallelism idle start cannot self-overload an
uncalibrated run.

Minor (D1): the probe measures *spawn* latency while the poll-until rows fail on *event-loop
gapping* — a different mechanism; the `max()` over the load term covers it, but the contract
should name the load term as the primary guard for the #7 class. `K = 5` probe spawns is an
arbitrary sample count (make it configurable per the campaign's no-arbitrary-limits rule).

### D2 — Flake-taxonomy honesty → **HOLE** (B3)

The law ("a recalibrated cap never masks a correctness failure") and the receipt discipline
(D2.3) are stated correctly, and the closed cause-class vocabulary (D2.2) is well-formed and
sorted. The isolated-rerun-then-load-rerun discipline (D2.1) is the right shape. But the
classification cannot do what the law demands.

**B3 — a REAL load-dependent race passes the "load-flake candidate" test.** "Passes isolated,
fails under load → load-flake candidate → cap MAY be recalibrated" (D2.1) is the signature of
*both* a load flake *and* a genuine correctness race that only manifests under contention (the
very "REAL bugs wearing flake clothes" the D2 preamble warns about). The cause-class vocabulary is
entirely timing-mechanism classes (`drain_deadline`, `event_loop_gap`, `margin_window`,
`poll_floor`, `start_latency`, `timer_coalescing`) — none of them asks whether the row asserts a
**product** semantic that the product violated under load. The contract's own D1.4 absolute-timing
rule makes this concrete: `grok-acp.test.mjs:648` (`elapsed < 2000`, "expected a bounded wait near
requestTimeoutMs") asserts the product honored its `requestTimeoutMs: 200`; `phase56-drain-and-close.test.mjs:268`
(`Date.now() - started < 500`, "deployment deadline bounds a never-settling cleanup") asserts the
drain honors its `timeoutMs: 40`. D1.4 says rows asserting product timer semantics "tests product
values, not machine speed — scaling those would make the assertion vacuous or wrong." Yet G4 lists
both as cluster rows whose caps should derive. The contract never resolves the overlap, so scaling
such a row (e.g. 2000 × 3 = 6000 ms) accepts a product that missed its own 200 ms timeout 30× —
exactly the masking the law forbids.
**Fix:** D2.1 must add a pre-recalibration **semantic triage**: before any "cap MAY be
recalibrated", classify the row — does it assert a product timer value (`requestTimeoutMs`,
drain/grace window, `stallMs`, a `spawn({timeoutMs})` literal)? If yes, a load-failure is a
REAL-BUG candidate, never recalibrated. Classify each G4 row (absolute-timing vs load-aware) and
pin the classification in the red suite so the marker's *correctness* is tested, not just its
mechanical exclusion (RG-12).

Minor (D2): the `// baton-suite: absolute-timing` / `// baton-suite: load-aware` markers are
reviewable by grep but their *correctness* is unverified — a mis-marked row never scales (stays
flaky) or scales (masks). Marker assignment should route through the D2.1 triage. RG-11 (the
recalibration receipt) is enforced by "review discipline + header inventory," not mechanically —
acknowledged, but it is the contract's softest guarantee precisely where the law is strongest.

### D3 — Parallelism posture → **SOUND** (with notes)

- **Fork-bomb-by-calibration:** none. `--test-concurrency = max(1, ceil(cores/factor))` with
  `factor ≥ 1` is always `≤ cores`; adaptive concurrency can never exceed today's full-parallelism
  bound, so the calibration cannot amplify load above the safe host bound.
- **Budget separation:** honest. Per-file time-bounded assertions carry the calibrated deadlines
  (D1); the whole-run budget is the operator's SIGTERM/SIGINT backstop, never derived from
  per-file deadlines; there is no internal wall-clock budget a long file could silently eat.
- **Control-law check on the stop path:** SOUND. The reaping windows (SIGTERM 5 s → SIGKILL 1 s →
  tracked-group +1 s) are caps on *evidence-based* waits — `groupAlive()`/the process table are the
  evidence (run-suite.mjs:217-233), so they escalate only on "no evidence of exit," the #67 shape.
  The `requestStop` forceTimer (run-suite.mjs:241) is a bare 5 s elapsed escalation, but it is a
  reap backstop for an operator-initiated stop, not a liveness declaration — flagged, not
  blocking.
- Note (minor): D3.1 passes `--test-concurrency` through `process.argv`; if an operator already
  passes `--test-concurrency`, precedence is unspecified — pin it (gate's value wins, or refuse).

### D4 — Refusal/observability vocabulary → **SOUND** (with notes)

- Fail-closed is the honest choice: `suite_calibration_unavailable` refuses rather than silently
  running at factor 1, which is precisely the "unmeasured run cannot distinguish a hung process
  from a slow machine" law. `suite_calibration_invalid` for a malformed env record is correct.
- The calibration line + failing row name do form the load-context receipt; the record's key set
  and both literals verify in ACTUAL sorted order (checked: `baselineProbeMs < cores < factor <
  load < measuredAt < probeMs < schemaVersion`; `drain_deadline < event_loop_gap < margin_window <
  poll_floor < start_latency < timer_coalescing`; `suite_calibration_invalid <
  suite_calibration_unavailable`; `fifteen < five < one`).
- Note (minor): RG-05's return spec `{cores, load, probeMs, baselineProbeMs, factor}` omits
  `measuredAt` and `schemaVersion`; align it with the closed key set (§3) to avoid ambiguity.

### Acceptance pins (RG-01..RG-12)

RG-01, RG-02, RG-04, RG-05 (after the RG-05 nit), RG-07, RG-08, RG-09, RG-10 are sound and
mechanically testable. **RG-03 and RG-06 are flawed** (they bake in the B1 floor hole). RG-11 is
review-only (soft, acknowledged). RG-12 needs marker-correctness verification (B3 minor).

### Open questions

1. **Where is the recorded `BASELINE_PROBE_MS`?** None exists at HEAD (no `baselineProbeMs`/
   `BASELINE_PROBE_MS` in any `.mjs`/`.md`/`.json`). D1.5's "recorded idle-host measurement" is a
   forward requirement: who measures it, on which reference host, and when? Until it exists the
   factor degrades to the load term (D1.5 handles this) — but the "recorded measurement" framing
   overstates the current state.
2. **The residual idle-start-then-load tail** (B2b): is it explicitly receipted as residual, or is
   the title "end the under-load flake cluster" overclaiming? The contract should say which side
   of the cluster it actually ends.
3. **Marker correctness** (B3 minor): is a mis-marked row (absolute-timing vs load-aware) covered
   by any red row? If not, add one.

---

## 3. Blockers — NOT FOLD-READY

**B1 — The derived floor is the inherited literal, not a measured honest value, so a calibrated
deadline CAN be shorter than the honest static floor.** (D1, RG-03/RG-06.)
*Why:* `factor = max(1, …)` floors `scaledTimeout(base)` at the current per-file literal; the
contract asserts those literals "ARE the honest measurements" without a mechanism, while the D9
receipt proves a current cap was too tight (measured ~3.9 s). Under sub-oversubscribed load the
factor stays 1 and the derived deadline stays below the measured truth.
*Fix:* floor the idle default at the recorded D9-style measurement when one exists
(`max(base, recorded_floor)`), revise RG-03/RG-06 to scope "byte-identical" to rows with no
recorded measurement, and require cluster rows to land measured recalibrations first.

**B2 — The single pre-spawn load sample can be gamed both ways, and the idle-start-under-own-load
tail keeps the cluster alive.** (D1.)
*Why:* a stale-high spike yields deadlines too lax (late hang detection); a suite that starts idle
and loads mid-run — including its own parallel children — stays at factor 1 and re-fires the
cluster; and `ceil(load.one/cores)` only triggers at oversubscription, while the #7 mechanism
begins below full utilization.
*Fix:* receipt the sample as a start-time snapshot and name the residual tail; use a load signal
that triggers below oversubscription (`max(one, five)/cores` band); fold the suite's own
concurrency into the factor.

**B3 — The flake-taxonomy classification cannot distinguish a load-dependent REAL race from a load
flake, and the D1.4 absolute-timing overlap lets a product-timing row be recalibrated into
vacuity.** (D2.)
*Why:* "passes isolated, fails under load → cap MAY be recalibrated" is the signature of both, and
the cause classes are all timing-mechanism classes; G4's own cluster rows (`grok-acp:648`,
`phase56:268`) assert product timer semantics that D1.4 says must NOT derive — the contract never
resolves the overlap.
*Fix:* add a pre-recalibration semantic triage (product-timer assertion → REAL-BUG candidate, never
recalibrate), classify each G4 row, and pin the classification so marker correctness is tested.

**B4 — The verification-HEAD stamp is stale and the contract file is absent at its claimed
HEAD.** (Citation integrity.)
*Why:* the contract claims "current worktree HEAD `5ac5e65`", but the current HEAD is `6d9d6d5`,
`5ac5e65` is not an ancestor, and the file does not exist there. All *content* anchors re-verified
at the current HEAD (no substantive citation failure), but the document misrepresents its own
verification basis.
*Fix:* re-stamp the verification HEAD at the current HEAD and re-run the anchor check (this review
did: every content anchor passes at `6d9d6d5`; the two drifts — `grounding.md:234-240` → the rule
at :227, and the unanchored "#80 F2 precedent" → `tg3-window-2026-08-07/suite-fold-2.md:87` — should
be corrected at the same time).
