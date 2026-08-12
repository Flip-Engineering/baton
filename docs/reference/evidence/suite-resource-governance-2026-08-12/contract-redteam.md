# #77 RED-TEAM REPORT — adversarial attack on the suite-resource-governance contract v1.0

**Attacker's HEAD:** `6614102e7803b75e92eae19eeb28fd3ff0f1f8e5` (current worktree, the Baton
private effective-tree snapshot).
**Verification basis:** every citation below re-verified at this HEAD with `grep -an` / `sed -n`.
The contract's claimed verification HEAD (`5ac5e65f595e472710b576a16a699a6d6fc3dfbc`) is a
**different** Baton snapshot on a parallel branch; every cited target file is byte-identical
between the two (`git diff 5ac5e65..HEAD -- <file>` empty for all 18 cited files), so the anchors
resolve identically at the current HEAD. The two NUL-bearing source files are exactly
`impl/src/application.mjs` and `impl/src/coordination-store.mjs` (verified by byte scan over all
115 `impl/src/*.mjs`); neither is cited by line anchor — the contract cites only the suite surface.

**Summary verdict: NOT FOLD-READY.** Six numbered blockers (§D). The shape is right — measured
load at run time, an honest-static floor, a never-mask-correctness law, adaptive concurrency with
an honest per-file-vs-whole-run split — but the calibration model under-reads the very class it
governs (the #7 sub-saturation habitat), the "never masks a correctness failure" law has a
pass-through for load-exposed real races, the SIGKILL-window row and the baseline receipt both
contradict the contract's own closed-literal law, RG-09's oracle is false against D3.1's formula,
and the calibration is claimed as an "evidence check" it is not.

---

## A. Citation verification (brief item 1)

**All cited anchors resolve at the current HEAD.** Verified with `grep -an` / `sed -n`:

- `docs/PROGRESS.md:12-14` ✓ ("the documented #7 load-flake cluster, green twice isolated each",
  line 14); `401-405` ✓ ("surfaced 4x, each passing isolated re-runs — D9's cap recalibrated
  honestly (waves.start alone measures ~3.9s under load)", lines 402-403); `425-427` ✓ ("recurred
  8x across gates — every row passes isolated re-runs", lines 425-426).
- `frontier-sweep-2026-08-03/orchestrator-friction-ledger.md:52` ✓ ("Gate load-flakes (#7 cluster)
  re-run in isolation by hand every gate | 5 isolated re-runs this sweep (kimi-acp, SC18,
  DC4/DC5, phase92…)").
- `stall-watchdog-2026-08-07/suite-blueteam.md:246-260` ✓ (F7, "B4's re-arm-vs-window margin is
  2×", line 246); `:251` ✓ ("the #7 load-flake class is exactly a wall-clock race between a test
  stream and a real timer"); `:256-257` ✓ ("widen the margin on the must-not-stall rows — e.g.
  `stallMs: 300` …").
- `stall-watchdog-2026-08-07/stall-watchdog-contract.md:422-428` ✓ ("no bound fires on elapsed time
  without an evidence check", line 424; "A 20-minute compile is not a stall", line 425).
- `stall-watchdog-2026-08-07/suite-67-brief.md:18-20` ✓ ("a slow-but-productive worker … is NEVER
  declared stalled; no bound fires on elapsed time without an evidence check").
- `waiting-vocabulary-2026-08-06/grounding.md:234-240` ✓ (the honest-null table; the contract's
  sentence is a characterization, not a quote — the table's honest-null column and the
  event-seq-backed `since` at line 240 support it).
- `impl/scripts/run-suite.mjs:19-25, 27-74, 76-117` ✓ (fixture-clock lint; surface-conformance +
  monotone ledger check; suite-root + detached spawn); `:105` ✓ (the `node --import <watchdog>
  --test ...argv.slice(2)` spawn, `stdio: 'inherit'`); `:108-116` ✓ (the spawn env block);
  `:217, 225, 232, 241` ✓ (SIGTERM 5 s / SIGKILL 1 s / tracked-group +1 s / 5 s force-SIGKILL
  timer).
- `impl/scripts/run-evidence.mjs:13-15, 122-127, 137` ✓ (`TERM_GRACE_MS = 5_000`,
  `KILL_GRACE_MS = 1_000`; the reaping deadlines; the force timer).
- `impl/package.json:27` ✓ (`"test": "node scripts/run-suite.mjs"`).
- Test-file anchors — G3/G4 all verify: `phase56-drain-and-close.test.mjs:45` (`timeoutMs = 3_000`),
  `:268` (`Date.now() - started < 500`), `:645` (`>= 4_500 && < 8_000`); `kimi-acp.test.mjs:18`
  (`timeoutMs = 2000`); `grok-acp.test.mjs:73` (`timeoutMs = 3000`), `:648` (`elapsed < 2000`);
  `phase8-correctness.test.mjs:75` (`timeoutMs = 1500`); `codex-appserver.test.mjs:527`
  (`elapsed < 2000`); `bidirectional-driver-red.test.mjs:1176` (`elapsedMs < 1_000`);
  `claude-session.test.mjs:633` (`elapsed >= 60`).
- `fixture-clock-lint.mjs:1-14, 24-48` ✓ (the time-bomb shape; `lintFixtureClocks`); `suite-
  hygiene.mjs:1-10, 23-32` ✓ (ESRCH-only sweep; `ownerDead`).
- G11/G12 claims verified by reproduction: `node --test` runs files in parallel and takes no
  `--test-concurrency` (no occurrence in `impl/scripts/*.mjs`); `node --version` = `v25.8.0`;
  `grep -rn 'loadavg\|availableParallelism\|cpus()' impl/scripts impl/test` → empty; 285 test
  files (✓), 388 `timeoutMs` call sites (✓); 8×2 s files finish in 2.22 s (all concurrent, vs
  16.6 s at `--test-concurrency=1`).

**Citation-hygiene notes (non-blocking, none is a wrong citation):**

1. **The claimed "verification HEAD" is not the current HEAD.** The contract names
   `5ac5e65f595e472710b576a16a699a6d6fc3dfbc` "current worktree HEAD"; the actual current HEAD is
   `6614102`. The contract file does not even exist at `5ac5e65` in this repo. Because every cited
   target is byte-identical across the two snapshots the anchors all still resolve, but the
   "verification HEAD" line is stale and should name the snapshot the reader can actually check.
2. **D2.2's "#80 F2 precedent" is un-anchored.** It exists and supports the claim — the F2 finding
   at `tg3-window-2026-08-07/suite-blueteam.md:130-142` re-stages a wall-time-dependent "minute 4"
   staging on event ordering — but the contract names only "#80 F2". A one-line anchor fixes it.

---

## B. Attack results

### B.1 D1 — the calibration model (brief item 2)

**The shape is right; the sample is not honest for the class it governs.** Three concrete defects:

**(a) The factor is a saturation step, not a sub-saturation multiplier.** `factor = max(1, ceil(max(
load.one / cores, probeMs / BASELINE_PROBE_MS)))` (D1.2). `ceil` + `max(1, …)` flatten everything
below saturation: on a 10-core host, `load.one = 6` (60 % busy) yields `ceil(0.6) = 1` → factor 1.
The #7 class the contract exists to govern is precisely a *sub-saturation* event-loop gap — B4's 30 ms
interval bridging a 60 ms window under a GC pause or a competing child
(`suite-blueteam.md:251-254`). A host at 60 % busy can easily gap the event loop > 30 ms, and the
calibrated deadlines are byte-identical to the raw constants that already flake. The D9 precedent
("waves.start alone measures ~3.9 s under load") was a *spawn-latency* calibration — the probe, not
the load term — so the load term contributes nothing until the host is *over*-saturated.

**(b) The probe measures spawn latency; the factor is applied to event-loop-gap rows.** The probe
(K=5 `node -e ''`) times *process spawn cost* (D1.1: "the exact operation the start-latency caps
time"). But D1.4 applies the same factor to every poll-until deadline and margin row, whose failure
mode is *in-process* event-loop gaps / timer coalescing — a different physical phenomenon that a
separate-process spawn probe does not observe. A host whose spawn cost is nominal but whose suite
process is GC-pausing yields factor 1 on exactly the rows the #7 cluster names. The probe is honest
for `start_latency`; applying it to `event_loop_gap`/`timer_coalescing`/`margin_window` rows is a
category error.

**(c) The probe self-inflates unless the spawns are sequential.** The contract says "K = 5 bounded
`node -e ''` spawns" without saying sequential or parallel. Measured on this host: sequential median
71 ms (61,58,106,71,163) vs parallel median 112 ms (115,112,111,113,106) — a **+58 % inflation from
the probe's own concurrency**. A parallel probe over-reads `probeMs`, inflates factor, laxes every
deadline for the whole run, and (via D3.1) sheds concurrency the host did not demand. The sample is
not honest until the probe's own load is excluded or the spawns are sequenced.

**Can the sample be gamed?** The reading is taken at suite start *before* the child spawns
(D1.1), so a suite under test cannot inflate it (its files do not exist yet). The gaming vector is
*environmental* (a cron/CI sibling during the read), which is the honest load the contract responds
to — but the one-shot reading then applies to the whole run: **a suite that starts loaded and
finishes idle keeps lax deadlines** (the brief's exact concern). The contract receipts it (the
record names `factor`) but the *consequence* is un-acknowledged: a timing *regression* (a cleanup
that now takes 900 ms instead of 400 ms) silently passes at factor 2 — the regression-detection side
of the two-sided test is softened, and D1's claim "a deadline still measures what it claims" is only
half-true (it measures a *hang*; it stops measuring a *drift*). This is an acknowledged non-goal
("no mid-run re-measurement") but the contract never states the drift-detection consequence.

**Can a calibrated deadline be SHORTER than an honest static floor?** No — `max(1, …)` floors the
factor at 1, so derived bounds are never below the static constant. But the floor itself is the
under-read: on a sub-saturation host the "honest static floor" *for the #7 class* (B4's 2× margin,
`suite-blueteam.md:256-257`) is exactly the constant that flakes, and D1 never raises it — it only
multiplies it when the host saturates. See blocker B5.

**The calibration receipt.** D1.3 writes one stderr line + `BATON_SUITE_CALIBRATION` in the spawn
env, so a captured terminal carries load context by construction. But the receipt is a *stderr line
only* — there is no durable artifact (the suite root is `rmSync`'d on exit, G1), so a CI that
truncates or separates stderr loses the load context, and the D2 re-run discipline (B.2) needs each
re-run's own receipt to be interpretable. Soft, fixable by also writing the record to the suite root
or the evidence wrapper's output.

### B.2 D2 — flake-taxonomy honesty (brief item 3)

**The law is stated; the mechanism has a pass-through for load-exposed real races.** D2.1's buckets:

- passes isolated AND under load → transient blip, no cap change;
- **passes isolated, fails under load → load-flake candidate, cap MAY be recalibrated;**
- fails isolated → REAL BUG, cap NOT touched.

The middle bucket classifies *any* row that passes alone and fails under the suite's own parallel
load as a load-flake candidate. A **real race that only manifests under load** — the deadline catching
a genuine ordering bug (the contract's own preamble admits "some cluster members may be REAL bugs
wearing flake clothes") — lands in exactly that bucket. The cause classes (D2.2) are all
measurement-centric (`drain_deadline`, `start_latency`, `margin_window`, …) and prescribe
"recalibrate/derive" actions; none requires the *outcome* to have been correct. Nothing in D2.1 or
D2.2 distinguishes "the row failed because the deadline was too tight for the load" from "the row
failed because the underlying operation never completed correctly under load". The #7 class *is* a
race (test-stream vs real-timer); the load-exposed product race is indistinguishable from it by the
bucket rule alone. **The "never masks a correctness failure" law has a hole.** See blocker B1.

**The re-run discipline is pinned but not mechanical, and its legs are not load-receipted.** D2.1
requires two re-runs; D2.3/RG-11 receipts the recalibration in the commit, "asserted by the review
discipline, pinned in the suite's header inventory." That is a process pin, not a gate — a red suite
cannot enforce it (RG-11's oracle is not machine-checkable). More importantly, the **isolated leg
runs on the shared host**: isolation removes the suite's *own* parallelism but not host load. A
loaded host during the isolated re-run makes a pure flake fail isolated → misclassified REAL BUG
(the conservative direction, no masking), and a *quiet* host during the load leg (the suite's load
is only a few files if the cluster is small) makes the load leg pass → bucket 1, no action, the
flake recurs. Each re-run needs its own calibration receipt to be interpretable; D2.1 does not
require it.

**Cause-class redundancy.** `event_loop_gap` and `timer_coalescing` are the same physical mechanism
(G7's B4, with identical recalibration "same as `event_loop_gap`"), yet RG-08 demands a diagnosis
name "exactly one closed cause class". A single fire can honestly be read as either; the vocabulary
invites misclassification. Merge or define the discriminator.

### B.3 D3 — parallelism posture (brief item 4)

**(a) Adaptive concurrency never exceeds a safe bound — but the idle default is wrong.** The
derivation `--test-concurrency = max(1, ceil(cores / factor))` is bounded above by `cores`
(factor ≥ 1), so there is no fork-bomb-by-calibration. But node's current default is
`os.availableParallelism() - 1` — verified empirically: 20×2 s files finish in 6.89 s under the
default ≈ 6.96 s at `--test-concurrency=9`, vs 4.97 s at `--test-concurrency=10` on a 10-parallelism
host. So at factor 1 D3.1 derives `ceil(cores/1) = cores`, **one more than today's `cores - 1`**,
and RG-09's oracle "an idle run keeps today's concurrency" is false against D3.1's own formula. An
idle run *raises* the suite's self-load at the exact default the contract promises is "byte-identical
to today", leaving zero headroom for the gate, the probe, and the host. See blocker B4.

**(b) The per-file vs whole-run split is honestly drawn but the backstop is load-softened.** The
per-file assertions carry the calibration (D1); the whole-run budget is the operator's SIGTERM —
correctly separated: a long file cannot silently drain the per-file budget, and the calibration line
names the factor so a slow run is explainable. But D3.2 scales the *stop-path* grace
(`graceMs = BASE_GRACE_MS * factor`) and the 5 s force-SIGKILL timer, so on a loaded hung host the
operator's single SIGTERM can take `BASE × (1 + factor)` seconds to reach SIGKILL, and a second
SIGTERM does not force-immediately (a double-signal-immediate-SIGKILL convention is absent). The
"backstop" is itself load-extended, and the operator's budget is silently exceeded by the scaling
it was meant to protect. Non-blocking but needs a bound or a second-signal escape.

**(c) `--test-concurrency` precedence is undefined.** The gate appends the derived flag to the user
argv it passes through (G1). A user-supplied `--test-concurrency` collides; node takes the last.
Specify the precedence.

### B.4 The control-law line (brief item 5)

**The calibration is claimed as an evidence check; it is a start-of-run scaling.** The contract's
preamble inherits "#67: no bound fires on elapsed time without an evidence check"
(`stall-watchdog-contract.md:422-428`) and D1 asserts "The evidence check for a suite deadline is the
measured host-load calibration recorded at run time." But the calibration is measured *once, before
the child spawns*; it is a static multiplier on every deadline, not a per-fire check. At fire time a
scaled deadline cannot distinguish "the predicate is late because the machine got loaded" from "the
predicate is late because the product hung" — the same bound fires on elapsed time either way, and
its "evidence" is a sample taken minutes earlier. A host that loads *after* the start reading
false-fires a calibrated deadline with no in-run evidence at all, and the receipt only *explains* it
after the fact. The claim "never declare a slow-but-healthy machine broken" is stronger than the
mechanism delivers.

The genuinely evidence-based fix is the #67 analog made concrete: the poll helpers
(`until`/`waitFor`/`waitUntil`) already loop over a predicate; the `waitFor(events, predicate)`
helpers in `kimi-acp.test.mjs:18` / `grok-acp.test.mjs:73` already see the *event stream*. A deadline
that **re-arms on any new event** (no new event since the last tick is the liveness evidence) is a
true evidence-checked bound. The contract instead scales the window — a legitimate design, but it
must say so, and scope the residual (a post-start spike still false-fires; the receipt makes it
explainable, not prevented).

Other elapsed-time bounds in scope:

- **Stop-path timers** (G2, D3.2) — fire on elapsed time, but the current loop's `groupAlive()`
  poll *is* a liveness evidence check (SIGKILL only when still alive). Compliant in mechanism; the
  *scaling* by a start-measured factor can under-grace a host loaded after start → SIGKILL on a
  progressing shutdown (the slow-but-healthy-STOP reading as broken).
- **The probe's hard 2 s cap** (D1.1) — a physical bound on measurement infrastructure, not a
  workflow control; legitimate. But its *timeout semantics are unspecified*: a spawn that exceeds
  2 s could be refused (`suite_calibration_unavailable`) or recorded as a truncated 2000 ms — the
  latter under-reads the true factor on a slow host and silently laxes the run. Specify refusal.
- **The whole-run budget** — the operator's SIGTERM is a human action, not an automatic bound.
  Compliant.

### B.5 Refusal/observability vocabulary, acceptance pins, open questions (brief item 6)

**Vocabulary.** The two refusal codes and the stable calibration line are well-formed, closed, and
sorted in ACTUAL order (§3 verified: `drain_deadline < event_loop_gap < margin_window < poll_floor <
start_latency < timer_coalescing`; `invalid < unavailable`; `baselineProbeMs < cores < factor < load <
measuredAt < probeMs < schemaVersion`; `fifteen < five < one`). `suite_calibration_unavailable`
(fail-closed on an unmeasured probe) is the honest choice, with one acknowledged trade-off: on a
pathologically slow host the gate *refuses to run* — a run-level "slow machine reads as broken" that
is at least explicit and named. **Frame defect:** `suite_calibration_invalid` fires *child-side*
(a child/helper parses the env), not at the gate — the D4 claim that both codes are "surface-constant
across the gate" is inaccurate, and the child-side refusal surface (a throw? a typed error the row
fails with?) and `readCalibration()`'s absent-vs-malformed distinction (absent → null/factor 1,
malformed → refuse) are undefined. **Marker default:** with "absent both markers, the default is
derivation", every existing row across the 285 files silently becomes load-aware at the implementation
commit, and the absolute-timing *membership* is author-placed with no closed list — the exact G4 row
the contract flags as load-firing is also the exact D1.4 absolute-timing example (blocker B2).

**Acceptance pins.**

| Pin | Verdict |
|---|---|
| RG-01..RG-03, RG-05, RG-07, RG-10, RG-12 | **SOUND** — mechanically testable, well-formed oracles. |
| RG-04 | **SOUND** with a seam gap — `measureCalibration()` has no injection seam, so "a synthetic high probe/load" (RG-06) cannot be produced without one. Specify overrides on the helper. |
| RG-06 | **SOUND** with a seam gap (as RG-04). |
| RG-08 | **HOLE** — "an unknown class is refused" has no refusing surface (no validator named), and the `event_loop_gap`/`timer_coalescing` redundancy makes "exactly one class" ambiguous. |
| RG-09 | **HOLE** — false against D3.1's own formula (B.3(a), blocker B4). |
| RG-11 | **HOLE as a red-suite oracle** — a review discipline pinned in a header inventory is not a red test; the suite cannot assert it. Honest as process, mislabeled as an acceptance pin. |

**Open questions the contract leaves unanswered (each verdict'd).**
1. Probe spawns: sequential or parallel? **HOLE** — the self-inflation measurement (B.1(c)) makes
   this decisive; default must be sequential (or parallel with the probe's own load excluded).
2. Probe >2 s cap: refusal or truncated 2000 ms? **HOLE** — truncation under-reads factor; specify
   refusal.
3. Who *reads* `BATON_SUITE_CALIBRATION` and enforces `suite_calibration_invalid` — the gate cannot
   (it already spawned), so the child-side refusal surface is undefined. **HOLE**.
4. `--test-concurrency` precedence vs a user-supplied flag. **HOLE** (minor).
5. Does D2 bucket 1 ("transient infra blip → no cap change") mean a non-reproducible under-load fire
   recurs indefinitely with only a receipt? For a governance contract that is arguably the correct
   no-guess posture, but the contract should say the cluster ends by *accumulating* receipts, not by
   a single classification. **SOUND** with a documentation duty.
6. Where does the baseline's measurement context `{host, date, method, sampleN}` live, given §3's
   closed set omits it? **HOLE** — blocker B3.

---

## C. Verdict per decision

| Decision | Verdict | One-line rationale |
|---|---|---|
| D1 calibration model | **HOLE** | Shape right, sample dishonest for the #7 class: saturation-step load term (B.1a), spawn-probe applied to event-loop-gap rows (B.1b), probe self-inflation (B.1c), baseline receipt contradicts §3 (B3), drift-detection consequence un-stated. |
| D2 flake-taxonomy honesty | **HOLE** | The "never masks a correctness failure" law has a pass-through: a load-exposed real race lands in the "load-flake candidate" bucket with no outcome-correctness check (B1); re-run legs not load-receipted; classes redundant. |
| D3 parallelism posture | **HOLE** | Concurrency is bounded (sound) but the idle default is wrong (RG-09 false, B4), the stop backstop is load-softened, precedence undefined. |
| D4 refusal/observability + pins | **HOLE** | Vocabulary split SOUND; child-side `suite_calibration_invalid` surface undefined, RG-08/RG-11 not satisfiable as written, marker default silently scales everything (compounds B2). |
| Control-law line | **HOLE** | "Calibration is the evidence check" over-delivers #67: it is start-of-run scaling, not a per-fire check; post-start spikes still false-fire (B.4). The stop-path's `groupAlive()` poll is the one genuine evidence check in scope. |

---

## D. Final: NOT FOLD-READY — numbered blockers

1. **B1 — D2.1 lets a load-exposed real race be recalibrated as a flake.** A row that passes
   isolated and fails under load is classified "load-flake candidate" purely on the isolated/load
   pattern; a genuine race that only manifests under load (the deadline catching a real ordering
   bug — the contract's own preamble admits this class) receives a cause class and a cap
   recalibration. The contract's headline law — "a recalibrated cap never masks a correctness
   failure" — is violated by its own taxonomy. **Why:** D2.2's classes are all measurement-centric
   and prescribe recalibration; none checks that the *outcome* was correct when given the deadline.
   **Fix:** before any recalibration, the load re-run must confirm the failure was timing-only — the
   awaited condition (the drain completed, the event arrived, the ack resolved) is observed to land
   once the deadline is extended. If the outcome never lands even past the extended bound, the row
   is a REAL BUG (correctness ticket, cap untouched). Add this as the gate between D2.1 bucket 2 and
   D2.2, and make it a receipt field.

2. **B2 — G4 ↔ D1.4 contradiction on the SIGKILL window.** G4 lists
   `phase56-drain-and-close.test.mjs:645` (`Date.now() - started >= 4_500 && < 8_000`) as a
   load-firing elapsed-assertion cap; D1.4's scaling rule applies to "the `X <= elapsed < Y` window's
   upper bound"; and D1.4's absolute-timing exclusion names "a SIGKILL grace window" as a row that
   NEVER scales. The contract's flagship flake row is simultaneously a cap to scale and the canonical
   absolute-timing example. An implementer cannot classify it, and the author-placed `// baton-suite:
   absolute-timing` marker lets either reading ship silently. **Fix:** a closed membership table for
   the G4 rows (scale / absolute-timing / floor-raw), keyed to a rule that is decidable — e.g. a
   timer owned by the harness/wrapper (run-evidence.mjs's `TERM_GRACE_MS`) is machine-speed and
   scales its upper bound; a timer owned by the product kernel is absolute-timing and stays raw —
   and mark `phase56:645` explicitly.

3. **B3 — D1.5 contradicts §3's closed key set.** D1.5 says `BASELINE_PROBE_MS` ships in the
   calibration record "with its measurement context `{host, date, method, sampleN}`", but §3's closed
   set is `baselineProbeMs, cores, factor, load, measuredAt, probeMs, schemaVersion` — no
   `host`/`method`/`sampleN`. And the degraded-basis path ("if the baseline is unrecorded, the record
   says so") has no representation in a closed set: the single key `baselineProbeMs` cannot both be
   present-as-number and "say so" without a new key (closed-set violation) or a null/absent value
   (undefined). **Why:** the closed-literal law is a campaign law with a blocker precedent (#70's
   "closed-literal contradiction"). **Fix:** either add the baseline-context keys to the closed set
   with their ACTUAL order, or move the baseline context to a defined separate receipt object the
   record references, and pin the unrecorded-baseline representation (e.g. `baselineProbeMs: null`
   with a closed `baselineBasis: "unrecorded"|"recorded"` literal) — one consistent choice, stated
   once.

4. **B4 — RG-09's oracle is false against D3.1's formula.** node's default test-file concurrency is
   `os.availableParallelism() - 1` (verified: 20×2 s files → 6.89 s default ≈ 9-wide on a
   10-parallelism host; `--test-concurrency=10` → 4.97 s, `=9` → 6.96 s). D3.1's
   `max(1, ceil(cores / factor))` at factor 1 gives `cores` — one MORE than today — yet RG-09 and
   D1 promise "an idle run keeps today's concurrency" and "a quiet host is byte-identical to today."
   An idle run raises the suite's self-load to the host's full parallelism with zero headroom for the
   gate/probe/host, at the exact default the contract promises is unchanged. **Fix:** derive
   `--test-concurrency = max(1, ceil((cores - 1) / factor))` (preserving today's idle default), or
   deliberately pin that idle concurrency becomes `cores` and justify the added load in D3.1 — then
   fix RG-09 to match.

5. **B5 — D1's factor under-reads the #7 class it governs.** Three compounded defects (B.1a-c): the
   load term is a saturation step (`ceil(load.one / cores)` → 1 below saturation, where the #7 class
   lives); the probe measures spawn latency while the factor scales event-loop-gap/margin rows it
   does not observe; and an unspecified parallel probe self-inflates +58 % (measured). A 60 %-busy
   host with nominal spawn cost gets factor 1 and the exact raw deadlines that already flake — the
   contract's centerpiece mechanism does not deliver "end the under-load flake cluster" in its most
   common habitat. **Why:** the calibration must measure the phenomenon the deadlines time. **Fix:**
   (i) probe the event-loop gap directly (a bounded in-process interval-cadence measurement — how
   late a 10 ms interval fires on average) rather than spawn cost alone; (ii) run the probe spawns
   sequentially or exclude the probe's own concurrency; (iii) drop the saturation ceil at
   sub-saturation (a continuous `max(1, load.one / cores, probeMs / BASELINE_PROBE_MS)` multiplier,
   floored at 1) so a 60 % host yields factor ≈ 1.6, not 1.

6. **B6 — "The evidence check for a suite deadline is the measured host-load calibration" over-
   delivers the #67 law.** The calibration is a one-shot, pre-spawn scaling applied uniformly to every
   deadline; it is not a per-fire evidence check. A calibrated deadline still fires on elapsed time
   with no progress evidence, and a host that loads *after* the start reading false-fires with no
   in-run evidence — "never declare a slow-but-healthy machine broken" is stronger than the mechanism
   delivers. **Why:** the contract claims the inherited law and then satisfies it with a multiplier.
   **Fix:** either require the poll helpers to re-arm on predicate progress (the `waitFor(events,
   predicate)` helpers already see the event stream — a "no new event since the last tick" deadline is
   the suite's honest in-flight-turn analog), or explicitly scope the residual: "calibrated deadlines
   are receipted scaling, not evidence-checked liveness; a post-start load spike can still false-fire,
   and the receipt makes it explainable" — and stop claiming the #67 law is met by measurement alone.

Non-blocking but worth folding before landing: probe timeout semantics (B.5, open question 2);
`suite_calibration_invalid` child-side surface + `readCalibration()` absent-vs-malformed (B.5);
the one-shot sample's drift-detection softening and D2 bucket 1's "no action" recurrence (B.1, B.5
open question 5); the stop-path load-softened backstop and missing double-signal escape (B.3b);
`--test-concurrency` precedence (B.3c); the `event_loop_gap`/`timer_coalescing` vocabulary
redundancy (B.2); the un-anchored #80 F2 and stale verification HEAD (A); the marker-default
silent scaling of all 285 files' rows (B.5); and the RG-04/RG-06 injection-seam gap.
