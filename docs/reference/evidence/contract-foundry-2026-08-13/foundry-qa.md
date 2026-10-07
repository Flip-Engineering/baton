FOUNDRY-QA v1
# FOUNDRY-QA — coordinator cross-check of the four contract drafts (contract-foundry wave A)

- **Coordinator:** foundry coordinator (v4-pro seat), objectiveRef `coordinator-brief.md`.
- **Verification HEAD:** `e371f704727cbca5fdff86af31ec8b154620a71f` ("Baton private effective-tree
  snapshot") — the tree every draft cites and the tree every anchor below was re-verified against
  THIS session with `grep -an` / `sed -n` / `Read`. It is identical across all five member
  worktrees (the rows draft in sibling worktrees; this cross-check ran against the same base).
- **Source of the drafts.** The `shared` scratchpad partition is UNREACHABLE from this session —
  the `run.scratchpad.append` verb is unlanded at HEAD (the #158 write verb; each row's OQ
  confirms this independently, and the model contract `scratchpad-write-2026-08-13/contract-fold.md`
  v1.1 documents the same RED state). All four rows therefore published their draft to the durable
  file only. **I read all four from their durable files** — `contract-163.md` (ws-06ef25),
  `contract-165.md` (ws-adaff3), `contract-167.md` (ws-44bc78), `contract-146.md` (ws-5b08d2) — the
  coordinator brief's explicit fallback ("fall back to the durable files … where the shared post is
  absent — note which"). The shared post is absent for ALL FOUR; that is the note. My own
  publish-to-`shared` is equally non-executable here, so this file is the harvest artifact.
- **Escalations.** No authority-class question in any draft requires a DECISION_REQUEST — every
  open question across the four is a judgment call the row recorded in its own open-questions
  section. Nothing is escalated UP.

Every draft carries the Ring-2 form (ground truths → decisions → refusal vocabulary → red-first
pins → open questions), cites evidence at this HEAD, introduces no bare clock, and ships red-first
pins. The cross-check below is per the coordinator brief's four axes: (a) citation anchors, (b) the
control law, (c) acceptance pins green-at-HEAD, (d) refusal vocabulary.

---

## #163 — quiescence-derived wave completion (row-quiescence)

**VERDICT: needs-work** — one named honesty hole in the control law the rung is replacing; every
other axis is clean.

### Spot-check record (verified this session)
- `workflow-interpreter.mjs:414` `DEFAULT_DRIVER` (hardCapMs 3000), `:416-422` `normalizeDriver`,
  `:736` loop condition `Date.now() - startedAt < driver.hardCapMs`, `:554` `startedAt`, `:464-465`
  `TERMINAL_PHASES`/`isTerminal`, `:733` terminal delete, `:753-757` stuck-decision early-break,
  `:602-605` verdict, `:609-617` seven-key D6 receipt, `:582-596` outcomes build, `:798`
  `steering_message_undelivered`, `:29-33` refusal codes, `:562-576` preOutcome — all accurate.
- `application.mjs:117-119` `PRODUCTION_WORKFLOW_DRIVER` (3h), `:85` noise kinds, `:505-520`
  `projectProgressClass` (silent at `:516`), `:8010-8033` `_followCategory` (noise→null at `:8018`),
  `:8035` `_eventBelongsToRun`, `:8137-8182` `_progressTiming` (`:8158` last→`{ts:startedAt}` default
  — the "zero meaningful events ⇒ lastProgress.at === startedAt" claim is accurate in substance),
  `:10931` inspect outline default, `:11039-11061` outline spread of `timing`/`progressClass`,
  `:11645` `waves.run` default — all accurate.
- `coordinator.mjs:71-76` `REARM_KINDS`, `:9382` silence return; `application-semantics.mjs:54`
  `PROGRESS_SILENCE_THRESHOLD_MS = 120_000`; `wave.mjs:451-486` `wave.close()` stops every member;
  `workflow-as-data-red.test.mjs:346,453,705` and `worker-orchestrated-swarm-red.test.mjs:77` — all
  accurate. **No wrong anchor found.**

### Control law
No bare clock is introduced: `hardCapMs: null` removes the production clock (D2.1); the window is
`max(2·maxObservedGapMs, QUIESCENCE_MIN_SILENT_POLLS·pollIntervalMs)` — the cadence term is
roster-derived and the floor is framed as an evidence-count bound (D1.2); the suite-only `hardCapMs:
3000` backstop is a test guardrail, not a workflow control. This is the #67 evidence-window form the
brief mandates, not a bare constant.

**The hole (why needs-work):** the quiescence candidate predicate (D1.1) is `silenceMs(role) >=
windowMs`, computed purely from `outline.silenceMs`, which `_progressTiming` derives from the last
*meaningful* event against wall time. A member whose turn is simply *long* — no new meaningful event
fires between `task.claimed` and `run.result_*`/`task.transitioned` — reads "silent" for the whole
turn. A cadence-derived window (e.g. 2× the observed 30 s gap = 60 s) can be shorter than a
legitimate in-progress turn, so the wave would be declared `WAVE-QUIESCED` **while a member is still
working**. That is exactly the #67 guarantee this contract quotes as its own law ("a
slow-but-productive worker is NEVER declared stalled; no bound fires on elapsed time without an
evidence check") — the confirmation poll (D1.3) catches *last-instant events*, not a *long live
turn*. The predicate ignores the outline's own `phase`/`progressClass` (the `projectProgressClass`
`:505-520` data the poll already reads, G3), which is the natural liveness-aware reset.

### Acceptance pins
All eleven pins verified RED at HEAD (no green pin): `WAVE-QUIESCED` is not in the enum (`:604`
computes only WAVE-OK/WAVE-INCOMPLETE); no window/confirmation/unrecoverable-exit machinery exists;
`application.mjs:117-119` still ships the 3h cap. Pin discipline is correct.

### Refusal vocabulary
Closed and typed: two named evidence lines (`wave_quiesced`, `wave_terminalized_unrecoverable`) plus
a closed `exit` enum (`pending_empty | stuck_handled | quiesced | terminalized_unrecoverable |
hard_cap`); no new refusal code. The OQ3 caveat (a throwing `quiescenceMinPolls` validation would
name its code) is honestly left out of this rung's vocabulary.

### What it most needs next
Make the quiescence candidate phase/liveness-aware: a still-pending member in an active turn phase
(or whose `progressClass` is not `silent`) must never be a candidate, regardless of `silenceMs`.
Close that and the rung is fold-ready.

---

## #165 — launch-time harvest-contract validation (row-launchval)

**VERDICT: sound** — two trivial nits; no hole that blocks folding.

### Spot-check record (verified this session)
- `run-task-wave.mjs:29,34,44-47,60-64,82,96,117,138,171-185,184,192-198` — all accurate:
  `--targets` collected (`:34`), presence-only validation + `process.exit(2)` (`:44-47`), the
  `Deliverables (edit ONLY these)` objective line (`:63`), `waves.start` (`:82`), the
  `git show`/`writeFileSync` harvest loop (`:171-185`), exit-code classes `1` vs `2`
  (`:96,192-198`).
- `workflow-interpreter.mjs:154,291-316,320-327,116-125,196-203,358-361,632,639` — all accurate:
  `admitHarvestEntry` checks closed shape + containment only (no directory check), the blob check at
  `:632` (the #74 half), `harvest_miss` at `:639`, the D4 v1.2 comment, the scope-class
  bare-directory precedent.
- `orchestrator-friction-ledger.md:117` — the App-D row 1 LAW text verified verbatim (both incident
  classes; "targets name FILES, never directories"; the post-harvest equality candidate row).
- `application.mjs:11625-11645`, `application-cli.mjs:1327-1332`, `mcp-northbound.mjs:1795-1796`,
  `web-northbound.mjs:46`, `workflow-as-data-red.test.mjs:362,663-686,679-681,744` — all accurate.
- **Nits (non-blocking):** (1) G2 says "the only matches are unrelated `handle.status()` calls at
  `:117,:138`" — `:138` is a `.terminalOutcome?.status` *field* read, not a `.status()` call; the
  load-bearing negative claim (no `stat`/`cat-file`/`isDirectory`) holds. (2) The refusal-vocabulary
  prose says the driver "introduces three closed tokens" but the table lists **four**
  (`target_directory_refused`, `deliverables_malformed`, `deliverables_uncovered`,
  `brief_unreadable`).

### Control law
Clean — every D1–D3 check is a filesystem/shape/set predicate at launch; no time control, no new
numeric limit (correctly no #89 row).

### Acceptance pins
All five RED at HEAD (the launch-time check is purely additive; the contract explicitly declines to
pin the already-green "absent path passes" behaviors — correct pin discipline).

### Refusal vocabulary
Closed and typed. The interpreter reuses the landed `workflow_harvest_invalid`; the driver adds four
closed tokens. The honest caveat is that the driver's "typed" refusal is an exit code + stable
message token (thinner than the interpreter's code enum) — stated openly, acceptable for a CLI
script, but it is the vocabulary's weak seam.

### What it most needs next
Make the driver's four tokens machine-readable and fix the "three vs four" count; then the D2
coverage guarantee is inert until briefs actually adopt the `## Deliverables` front-matter (the
foundry's own briefs declare deliverables in prose — OQ3). Both are named follow-ons, not defects.

---

## #167 — bounded actual-inference readiness tier (row-readiness)

**VERDICT: sound** — the control-law distinction is handled exactly as the brief requires; the open
items are wire-grammar verification, not structural holes.

### Spot-check record (verified this session)
- `application-deployment.mjs:1076-1192` `deploymentReadiness` (static summary "The exact route
  passed static deployment readiness." at `:1178-1181`), `:1212-1219` `assertRouteReady`,
  `:1329-1369` `doctorReadiness` (non-enumerable `liveness`/`occupancy` at `:1346-1350`),
  `:1895-1906` liveness validation (`probeTimeoutMs`/`failureWindowMs` ≤ 120_000), `:1268`
  `#liveness = deployment.liveness ?? null`, `:1376-1381` `#livenessGate` no-op, `:1383-1388`
  `#composeLive` `unobserved` — all accurate.
- `route-liveness.mjs:3-4,13-22,35-47,121-129,132-146,174-247,342-355,359-389,243-246` — all
  accurate: bounds (`:16-19`), `turnCompletion === 'pausable'` gate, `ensure` cache discipline,
  content-verified probe, `resource.provider_call` receipt, `project(route,{withProbe})`,
  `invalid_grant|revok → authentication_refresh_required` as the only wire-classified verdict.
- `application-cli.mjs:1261-1267` (`check` parsed at `:1264`), `:2213` (`if (parsed.kind ===
  'doctor') return client.doctor();` — the flag is DROPPED, confirming G5/A2 RED).
- `application-semantics.mjs:2063-2088` (four typed codes), `:2090-2095` generic, `:2127-2130`
  projection collapse; `limits.mjs:1-7,53-106,130-131` (no probe lane — G7 confirmed);
  `wave-driver.mjs:161-172,302-337` (matchRoute own-route only; preflight refuses, never reroutes).
  **No wrong anchor found.**

### Control law
Handled correctly and honestly: the ≤120 s probe timeout is explicitly a bound on the PROBE (the
measurement's own terminal wait), never a workflow control — the exact distinction the brief
instructed the row to state. The freshness windows are cache-freshness derivations from vendor
physical bounds, and the failure window bounds only the auto-re-probe cadence (with the explicit
`--check`/credential-refresh carve-out). No per-turn limit or liveness clock on real work.

### Acceptance pins
All five RED at HEAD: no `verdict`/`probedAt` fields exist; `check` is parsed-and-dropped; only four
codes are typed; a 402/capacity output collapses to `probe_content_mismatch`/`provider_unreachable`
with no `provider_quota` class; no no-reroute test exists. Pin discipline correct.

### Refusal vocabulary
Closed and typed — extends `PROVIDER_TERMINAL_GUIDANCE` with `provider_unreachable`,
`probe_content_mismatch`, `probe_oversize`, and NEW `provider_quota`, each carrying
`{category, summary, remediation, retryable}`. The OQ1 additive-vs-rename judgment (keep
`liveness.state` byte-stable, add `verdict`+`probedAt`) is the right call for a green suite.

### What it most needs next
Pin the quota/capacity **wire grammar** (A4 pins the *classification separation* with a fixture, but
the 402/`insufficient_quota`/capacity matcher is unverified against live wire — OQ2). Until that
grammar lands, `provider_quota` is a separation-only guarantee.

---

## #146 — fleet seat telemetry surface (row-telemetry)

**VERDICT: sound** — no wrong anchor, no clock, no green pin; the remaining risk is a derivation
cost, not a correctness hole.

### Spot-check record (verified this session)
- `coordinator.mjs:2903,2904-2916` (ceiling skip mints the durable deferral receipt,
  idempotency-keyed), `:3039-3045` `_inFlightCount` (working|stopping|blocked), `:12031-12034`
  `list()`, `:10337-10342` `routeCards()` — all accurate.
- `coordination-store.mjs:13186-13201` `deferTaskDispatch`, `:8039-8042` (no projection state —
  replay re-derives), `:8875-8879` `events()`, `:8917` `task()`, `:13374-13376` `ledgerHeadSeq()` —
  all accurate.
- `application-deployment.mjs:1390-1398` `#occupancyFor` (confirms A4's RED claim: it fabricates
  `inFlight: 0`, never `null`, for an unmatched vendor), `:1005-1016` `publicRosterRow`,
  `:1320-1322` `fleet.roster()`, `:1419-1442` `#rosterProjection` (`new Date().toISOString()` at
  `:1420` — the wall-time stamp this contract refuses to copy), `:267-269` `publicRoute`, `:1089`,
  `:1422-1426` — all accurate.
- `application.mjs:444-460` `projectWaitingOn` `capacity_ceiling`, `:11610-11619` `_runWaveRoute`,
  `:11759-11822` `waveList` (seat-map recovery `:11782-11784`; wave row `:11811-11818`;
  `wave_not_found` `:11798-11799`), `:11769` page ≤16, `:12429-12452` raw `doctorReadiness`
  (`state:'ready'` `:12430-12432`), `:12560-12574` dispatch (observe verbs not refused) — all
  accurate. `application-semantics.mjs:1108,1622-1632,1648-1653`; `mcp-northbound.mjs:541-547,559-568`;
  `application-cli.mjs:1335-1338`; `web-northbound.mjs:414` — all accurate. **No wrong anchor found.**

### Control law
Clean and deliberate: the freshness frame is `observedAtEventSeq` (an event sequence, never wall
time), and the contract explicitly refuses to copy the roster's `new Date().toISOString()` stamp.
No deadline/expiry/turn-cap on the new paths.

### Acceptance pins
All eight RED at HEAD (no `seats`/`capacity`/`observedAtEventSeq` exist; `#occupancyFor` fabricates
`0`; `fleet_roster` is registered-but-dead; neither MCP description names capacity). Pin discipline
correct, including the A8 additive-landing byte-stability assertion.

### Refusal vocabulary
Closed — no new refusal code, no new verb (observe extension of two existing surfaces), and the
observe posture is pinned (a worker-seat principal is served the same bounded projection). Correct.

### What it most needs next
Justify or bound the `deferred` derivation cost: the D1 aggregate is "scan `coordination.events()`
for every `task.dispatch_deferred` receipt and join pending task status" (G10) — a full-ledger scan
per read. That is honest and needs no new authority, but the contract should state the cost/ceiling
(or confirm the page-bound `waves.list` keeps it acceptable) so an orchestrator reading `seats` on a
large ledger does not pay an unbounded scan. OQ3's `fleet_roster` wiring is the named follow-on.

---

## Bottom line

- **Sound:** #165, #167, #146 (fold-ready modulo the named follow-ons).
- **Needs-work:** #163 — the slow-turn false-quiescence guard (phase/progressClass-aware candidate
  predicate) is the one hole that must close before fold.

No draft fabricated a missing row's content; no draft introduced a bare clock; every pin is RED at
HEAD; every refusal vocabulary is closed and typed. All four shared posts are absent (the #158
append verb is unlanded), and all four were read from their durable files — that is the source note
this QA file records.
