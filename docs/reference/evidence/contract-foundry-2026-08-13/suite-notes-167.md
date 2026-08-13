[attempt: ea57954b-95c1-4918-a494-41b0249738ee row-suite-167]
# SUITE NOTES — row-suite-167 (RED-first acceptance suite for the FOLDED #167 readiness-honesty contract)

- **Row:** `row-suite-167` (suite-foundry wave-c)
- **Suite file:** `impl/test/readiness-honesty-red.test.mjs` (the only code deliverable; no source
  files touched — #167 is a SPEC rung)
- **Binding contract:** `docs/reference/evidence/contract-foundry-2026-08-13/contract-167.md` (v2,
  folded per `redteam-167.md` + `fold-167.md`); source-of-truth artifacts exist in git at
  `30e1e73` (contract-167.md 565 lines, redteam-167.md 364 lines, fold-167.md 97 lines) and were
  read from `/tmp/row167-src/`.
- **Suite law:** `docs/reference/evidence/contract-foundry-2026-08-13/foundry-brief.md` (the shared
  frame) — red-first named stages, hermetic fixtures, no clocks as controls, namespace imports,
  sorted-key literals, `watchdog.stallMs` 60_000 + `stallAction` from contract vocabulary, static
  ORDER/EXISTENCE/byte-string anchors only (#166), split-twice, attempt-echo (#171).
- **Verification HEAD:** `e371f704727cbca5fdff86af31ec8b154620a71f` ("Baton private effective-tree
  snapshot"). Run command (repo root): `node --test impl/test/readiness-honesty-red.test.mjs`.
- **Execution contract:** `Executable "true"`, args `[]`, cwd `.`, exit 0 — trivially satisfied by
  the harness; the suite's RED failures are the intended outcome.

---

## Row inventory — 17 rows (9 capability RED rows + 8 PIN rows)

*Continuation round: every PIN row now has a named-stage twin — the pin guards what today holds;
the twin asserts the contract form that does not. A1p→A1a/A1b/A1c, A3p→A3, A4p→A4, A5p→A5,
A6p→A6, P-stale→**V-stale**, A-L→**A-Lcap**. V-stale and A-Lcap are new this round.*

| Row | Kind | Contract pin | What it asserts | Stage at HEAD (named in the assertion message) | Today |
|---|---|---|---|---|---|
| A1p | PIN | D2/G1/DP5 | static-ready route reads `state: 'ready'` + byte-stable summary; the liveness sibling stays NON-enumerable; a never-probed route projects honest `unverified`, never a fabricated liveness | — | GREEN |
| A1a | RED | D2 cardinal + wire law | doctor route row carries enumerable `verdict`/`probedAt` that survive JSON.stringify; static-only → `unverified`/null (never self-relabeled probe-verified); fresh content-verified probe → `probe-verified` with `probedAt` = recorded verifiedAt | `typeof row.verdict === 'string'` fails — no verdict field on the doctor row | RED |
| A1b | RED | D2 shape | the fleet_roster row carries the same `{verdict, probedAt}` projection (the honesty class is not a private doctor sibling) | `typeof rosterRow.verdict === 'string'` fails | RED |
| A1c | RED | D2 wire law (fold blocker 3) | the operator wire re-add sites carry `verdict`+`probedAt`: `/v1/application-card` (`_handleOperatorRead`), `BatonWebClient.doctor()`, `_freshDoctorReadiness()` | `cardSlice.includes('probedAt')` fails — web re-adds only `briefing` (web-northbound.mjs:1504-1513) | RED |
| A2 | RED | D1 trigger 3, A2 (fold blocker 2) | `baton doctor --check` forces one fresh probe per stale route through the OPERATOR path: `baton.mjs` doctor branch → `BatonWebClient.doctor()` → a `/v1/application-card` forced-probe parameter | `doctorBranch.includes('forceProbe')` fails — `--check` only selects local-vs-remote (baton.mjs:81) | RED |
| A3 | RED | G6 refusal vocabulary | `provider_unreachable`, `probe_content_mismatch`, `probe_oversize`, `provider_quota` each get a PROVIDER_TERMINAL_GUIDANCE row with `{category, summary, remediation, retryable}`; `provider_quota` excludes automatic re-probe (OQ3); a probe verdict never collapses to GENERIC | `guidance.indexOf('provider_unreachable: {')` fails — the typed vocabulary has only the 4 landed codes | RED |
| A4 | RED | D1, refusal vocabulary, OQ3 | a probe carrying the quota/capacity wire (HTTP 402 / insufficient_quota), completed OR failed, classifies `provider_quota` — distinct from `probe_content_mismatch`/`provider_unreachable` — and excludes the automatic failureWindow re-probe | `row.liveness.code === 'provider_quota'` fails — collapses to `probe_content_mismatch` (completed) / `provider_unreachable` (failed) | RED |
| A5 | RED | D3 | a failed verdict refuses wave preflight `wave_driver_route_unready` BEFORE any member spawn; the driver never substitutes a route (matchRoute no-substitution scan) | `row.verdict` is falsy — the preflight cannot refuse on the honest projection | RED |
| A6 | RED | D1 trigger 1, A6 (fold blocker 4) | `#livenessGate` is consulted on ALL five spawn surfaces (run/startMany/workflow/explore/review), each still consulting `assertRouteReady` (additive) | `startMany` slice lacks `#livenessGate` — only `run()` (:1446) consults the gate | RED |
| V-stale | RED | D2 staleness law (P-stale twin) | the honest verdict follows the staleness law: a lapsed verified window reads `verdict: 'unverified'` — NEVER stale `probe-verified` — with `probedAt` retaining the last recorded measurement (content-derived, OQ5); a never-probed route reads `unverified`/null | `lapsed.verdict === 'unverified'` fails — no verdict field, so the lapsed-window verdict cannot hold | RED |
| A3p | PIN | G6 unchanged vocabulary | the four EXISTING PROVIDER_TERMINAL_GUIDANCE rows (`authentication_required`, `authentication_refresh_required`, `wire_frame_oversize`, `provider_crashed`) each carry the 4 fields | — | GREEN |
| A4p | PIN | fold F-1 + A4 negative control | a quota/capacity worker-turn death fires NO invalid_grant credential fan-out (sibling survives); the landed invalid_grant class still invalidates every row sharing the credentialKey and ONLY those (codex control survives) | — | GREEN |
| A5p | PIN | RT-5p, D3 | a static-blocked orphan (`credentialState: 'absent'`) is refused at wave preflight with `wave_driver_route_unready`; matchRoute performs no substitution (fallback/alternate/substitute/router absent) | — | GREEN |
| A6p | PIN | G1, A6 sibling | all five spawn surfaces still consult `assertRouteReady` (the static gate is not weakened by the honesty fold) | — | GREEN |
| P-stale | PIN | D2 staleness law | direct RouteLiveness with injected mutable now: fresh verified → lapsed `unverified` with `verifiedAt`/`expiresAt` reporting recorded content; a never-probed route reads `unverified` | — | GREEN |
| A-L | PIN | fixture-lint | the LivenessAdapter modes plant the wires they claim (complete emits the exact content pin; quota modes carry the quota/capacity wire; die emits no turn_completed; wrong emits non-pin; invalid_grant carries the credential-death wire; noisy places the pin beyond the capture bound; the expected-line parser reads the bounded probe prompt) | — | GREEN |
| A-Lcap | PIN | D1 cost-honesty, G2 (A-L twin) | the bounded-capture law: a probe whose exact pin sits beyond the 2KiB capture bound NEVER verifies — it fails `probe_content_mismatch` through the real classification (route-liveness.mjs:237-241), never a fabricated verify | — | GREEN |

**Total: 17 — 8 GREEN / 9 RED at HEAD.**

---

## Stage table — every RED row fails at its NAMED stage

| Row | Named stage (assertion message) | Evidence |
|---|---|---|
| A1a | `stage A1a: doctor route rows carry no enumerable verdict field (D2 shape)` | `typeof row.verdict === 'string'` false |
| A1b | `stage A1b: roster rows carry no verdict field (D2)` | roster row from `deployment.fleet.roster()` has no `verdict` |
| A1c | `stage A1c: the /v1/application-card handler re-adds no probedAt — the honest projection vanishes on the wire (web re-adds only briefing)` | `_handleOperatorRead` slice lacks `probedAt` |
| A2 | `stage A2: the baton.mjs doctor branch never forces a probe — --check only selects local-vs-remote (baton.mjs:81)` | doctor-branch slice lacks `forceProbe` |
| A3 | `stage A3: the typed refusal vocabulary has no provider_unreachable row — the probe verdict collapses to the generic (G6)` | `guidance.indexOf('provider_unreachable: {')` = -1 |
| A4 | `stage A4: a quota probe carrying the quota/capacity wire does not classify provider_quota — it collapses to probe_content_mismatch/provider_unreachable at HEAD` | `row.liveness.code` = `probe_content_mismatch` |
| A5 | `stage A5: doctor route rows carry no verdict field — the preflight cannot refuse on the honest projection (D3, D2 wire law)` | `row.verdict` undefined |
| A6 | `stage A6: startMany() consults no #livenessGate — the gate covers only run() (D1, blocker 4)` | `startMany` slice lacks `#livenessGate` |
| V-stale | `stage V-stale: a lapsed verified window reads verdict unverified — never stale probe-verified (D2 staleness law)` | `lapsed.verdict` undefined |

---

## PIN list — every pin's named stage (the wrong implementation each pin kills)

| Pin | Named-stage twin row | Kills |
|-----|---------------------|-------|
| **A1p** static substrate | A1a (doctor), A1b (roster), A1c (wire re-add) | an impl that relabels a static-only read `probe-verified` (cardinal law), leaks `liveness`/`occupancy` into the enumerable row (DP5), or loses the honest `unverified` on the wire (fold blocker 3) |
| **A3p** existing refusal table | A3 | an impl that rewrites the typed vocabulary without the four existing rows (G6) — the four landed codes are the unchanged floor the four probe codes join |
| **A4p** F-1 fan-out + quota negative control | A4 | an impl that lets a quota/capacity death fire the invalid_grant credential fan-out (A4), or weakens the invalid_grant same-key fan-out / its codex control isolation (fold F-1) |
| **A5p** static preflight refusal + no substitution | A5 | an impl that admits a failed verdict to wave preflight instead of refusing `wave_driver_route_unready` (D3), or substitutes/fallbacks a member route (matchRoute scan) |
| **A6p** assertRouteReady on all five surfaces | A6 | an impl that removes the static gate from a spawn surface while folding in the liveness gate (the gate is additive, never a replacement — G1) |
| **P-stale** landed staleness law on `liveness.state` | V-stale (the verdict-level law) | an impl whose lapsed `liveness.state` reports stale-`verified`, or whose honest VERDICT is sticky (once `probe-verified`, always `probe-verified`) — the verdict must lapse with the recorded window and keep `probedAt` content-derived |
| **A-L** fixture-lint | A-Lcap (the bounded-capture law) | a vacuous fixture — a mode claiming a wire it does not plant; and a wrong impl that verifies on an unbounded contains-scan of the probe output (the pin beyond the 2KiB capture must never verify) |

---

## Measured splits (split-twice law — run from the repo root; continuation round)

**Run 1** — `node --test impl/test/readiness-honesty-red.test.mjs` → **17 tests, 8 pass / 9 fail.**
- GREEN (8): A1p, A3p, A4p, A5p, A6p, P-stale, A-L, A-Lcap
- RED (9): V-stale, A1a, A1b, A1c, A2, A3, A4, A5, A6

**Run 2** — same command → **17 tests, 8 pass / 9 fail.** Same 8 GREEN / same 9 RED, same named
stages. STABLE.

The 9 RED rows go GREEN only on a contract-correct implementation (the enumerable `{verdict,
probedAt}` projection on the doctor + roster rows and the northbound re-adds; the operator forced
probe; the typed probe-failure vocabulary incl. `provider_quota` + no-auto-re-probe; the
quota/capacity classification; the preflight refusal on the honest projection; the five-surface
`#livenessGate`; the verdict-level staleness law — a lapsed window reads `unverified` with
`probedAt` retaining the last measurement). The 8 PIN rows pass today and must stay green after
landing.

---

## Judgment calls (mine — recorded per the escalation posture)

1. **`forceProbe` spelling for the invented forced-probe parameter.** The contract pins A2's
   behavior (`baton doctor --check` forces one fresh probe per stale/absent route via a
   web-northbound forced-probe parameter on `/v1/application-card`) but not the JS spelling.
   `forceProbe` is absent from impl/ at HEAD (grep exit 1), so the choice is collision-free; it is
   the most sibling-consistent reading of "forced-probe signal" and is asserted by source scan in
   the baton.mjs branch, `BatonWebClient.doctor()`, and `_handleOperatorRead`.
2. **`verdict`/`probedAt` as the enumerable projection field names.** D2 names the projection
   `{static, probedAt, verdict}` (semantic order, no byte-stability claim — so no key-order
   literal is asserted). `probedAt` appears NOWHERE in impl/ at HEAD (count 0 across the five
   target files), making it a clean RED discriminator for the wire-survival scans. `verdict`
   exists at application-cli.mjs:919 only as an unrelated compactRunResult field name — scans are
   scoped to method slices (`_handleOperatorRead`, `doctor()`, `_freshDoctorReadiness`), never
   whole-file, so the false-positive is avoided.
3. **`provider_quota` as the typed code name.** The contract's refusal vocabulary names the
   quota/capacity class (OQ2/OQ3) without a code literal; `provider_quota` follows the
   `provider_*`/`probe_*` naming of the existing table and is asserted both as a
   PROVIDER_TERMINAL_GUIDANCE row key and as the classification `row.liveness.code`.
4. **The wave-preflight consumer in A5/A5p is driven exactly as wave-driver.mjs drives it** (the
   facade's `waves.start` throws `fixture_preflight_passed` to stop the wave at the fixture
   boundary) — the D3 refusal is asserted BEFORE any member spawn without spawning real work.
5. **A1p pins `unverified`, not the unreachable `unobserved`.** `openBatonDeployment` always
   constructs a RouteLiveness controller (application-deployment.mjs:1980/2046), so the
   `#composeLive` "unobserved" fallback (:1383-1388) is unreachable through the fixture. The
   honest static-only read is the contract's own `unverified` (D2) — the pin asserts that, keeping
   the row GREEN at HEAD while pinning the honest projection.
6. **Fixture liveness uses the injected-clock + bounded-`probeTimeoutMs` closed fields**
   (`advanced.liveness.now/probeTimeoutMs/failureWindowMs` — the closed field set at
   application-deployment.mjs:1895-1906). `now` is a deterministic injected epoch
   (2026-08-13T00:00:00.000Z), never the real clock; `probeTimeoutMs` is 60_000 (≤ the 120_000
   bound); async settling is bounded (setTimeout(0) + flush loops), never a work clock.
7. **The continuation round's pin-twin reading of "every pin becomes a row at its named stage."**
   Five pins (A1p/A3p/A4p/A5p/A6p) already had their contract-form twins among the RED rows
   (A1a/A1b/A1c/A3/A4/A5/A6). The two pins without a direct twin got NEW rows: **V-stale** (RED —
   the honest verdict's staleness law: a lapsed verified window reads `unverified` with `probedAt`
   retaining the last recorded measurement; the lapsed-transition is NOT asserted by A1a, which
   covers only the static and fresh-verified forms) and **A-Lcap** (PIN — the bounded-capture law:
   a probe whose exact pin sits beyond the 2KiB capture bound fails `probe_content_mismatch`
   through the real classification; GREEN at HEAD because route-liveness.mjs:237-241 already
   enforces the bound, and it kills an unbounded contains-scan impl). The remaining pins'
   contract forms equal their landed forms (no stricter RED is possible without overstating the
   contract) — those are documented in the PIN list with the wrong impl they kill.
8. **V-stale uses the lapsed-transition as its FIRST failing assertion**, not the fresh-verified
   form (which A1a already stages): the row probes, advances the injected clock past the grok
   window (`GROK_WINDOW_MS + 1`), and asserts `verdict === 'unverified'` + `probedAt ===
   ISO(verifiedAt)`. This keeps the row's named stage distinct from A1a's cardinal-law stage and
   directly extends P-stale (the landed `liveness.state` law) to the contract's verdict projection.
9. **The `noisy` LivenessAdapter mode mirrors the #47 suite's wire** (`'x'.repeat(3072) + '\n' +
   line` — the pin placed beyond PROBE_CAPTURE_MAX_BYTES). A-Lcap asserts it through the real
   classification (a full fixture, not just the adapter seam), so the bounded-capture law is proven
   against RouteLiveness itself; A-L's fixture-lint additionally proves the wire plants the pin.

## Shared-scratchpad publish — RECORDED REFUSAL (non-executable at HEAD)

The mid-turn instruction was to publish the notes to the `shared` scratchpad partition as I go, and
to record a failed publish as evidence. Per the binding contract's own header
(contract-167.md:30-45) — verified again THIS session — **no worker-facing `shared`-scope write
surface exists at HEAD**: the only write up-channel is the coordinator's `scratchpad.write`
dispatch (coordinator.mjs:12690-12697 → method :10790 → store `writeScratchpad` at
coordination-store.mjs:14064, scoped to `worker:<id>` at :14106), reachable only from inside a live
authenticated worker stream; promotion to `shared` is a coordinator/steering elevation action
(`elevateTaskScratchpad`/`settleWorkflowScratchpad`), not a row write. The MCP northbound surface
exposes only read/elevate for scratchpads (mcp-northbound.mjs:114-115); no
`run.scratchpad.append`/`scratchpad.write` routing exists in application-cli.mjs or
mcp-northbound.mjs. Per coordinator-brief.md (line 12) the coordinator falls back to the durable
files where the shared post is absent — **this notes file IS the publish**, and this refusal is
recorded as the evidence.

## Sanity backstops

- `probedAt` absent from all five target files at HEAD (route-liveness.mjs, web-northbound.mjs,
  application-cli.mjs, mcp-northbound.mjs, impl/scripts/baton.mjs) — clean wire-survival
  discriminator (verified by grep, count 0 each).
- `quota` absent from route-liveness.mjs; `forceProbe` absent from impl/ — invented spellings are
  collision-free.
- Source scans are ORDER/EXISTENCE/byte-string only (method slices via brace-balanced extraction,
  `sliceBetween` for the baton.mjs branch) — never absolute line-window anchors (#166).
- Fixture hermeticity: mkdtemp roots under os.tmpdir(), `test.after` cleanup, no network, no real
  provider spawns (probes faked at the adapter seam), `git init` + `true` the only subprocesses.
