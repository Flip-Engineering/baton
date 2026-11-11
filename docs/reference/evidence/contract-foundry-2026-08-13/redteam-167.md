[attempt: 5471bf44-610b-413d-a476-7a32a465f675 row-rt167]
# RED-TEAM #167 — the bounded actual-inference readiness tier (implementation contract v1)

- **Reviewer:** row-rt167 (adversarial red team, review-foundry wave-b)
- **Target:** `docs/reference/evidence/contract-foundry-2026-08-13/contract-167.md`
- **Cross-check read:** `docs/reference/evidence/contract-foundry-2026-08-13/foundry-qa.md` (§#167)
- **Issue 167:** `gh issue view 167` is not fetchable — `gh` is unauthenticated in this worktree
  (identical to the row's own note in the contract header). Requirements carried by the brief,
  the landed #47 contract, and the code.
- **Verification HEAD:** `e371f704727cbca5fdff86af31ec8b154620a71f` — my worktree HEAD; the exact
  tree the draft cites. Every anchor below re-verified this session with `Read` / `sed -n` /
  `grep -an` (NUL discipline on `application.mjs`; plain grep elsewhere).
- **Verdict:** **NOT FOLD-READY** — two citation blockers + two structural holes (numbered in §7).

---

## 0. What the contract gets right (verified, so the HOLEs below are scoped)

The landed #47 machinery is accurately described, and the honesty claims that ride it are
real in the code:

- The probe is a **bounded, real, content-verified one-turn inference** through the exact route's
  adapter — `adapter.spawn(probeId, { goal: prompt })` (route-liveness.mjs:198), the same spawn
  path a real turn rides; verdict requires `lifecycle.turn_completed` + `payload.status ===
  'completed'` + captured output trimmed to the expected line (route-liveness.mjs:235-241). A bare
  `lifecycle.spawned` is not proof of provider-alive (:103 vs :235). Verified.
- The **bounds are closed and honest**: prompt ≤1KiB (:18, :188), capture ≤2KiB (:19, :237),
  watchdog ≤120s via `Promise.race([terminal, timeout])` + `timer.unref()` (:216-222), exactly one
  `resource.provider_call` receipt (:342-355), single-flight per route (:148-158), one verdict per
  probe with no retry/loop. Verified.
- The **cache discipline is real**: `ensure` (route-liveness.mjs:132-146) — fresh verified → hit;
  failed within `failureWindowMs` → typed throw; otherwise one probe, coalesced. Windows are
  vendor-derived freshness bounds (:13-15, :160-164), not TTL guesses. Verified.
- The **static/liveness separation** is real: `deploymentReadiness` is all-static
  (application-deployment.mjs:1076-1192); the doctor attaches `liveness`/`occupancy` as
  non-enumerable siblings (application-deployment.mjs:1346-1350); a lapsed window projects
  `unverified`, never stale-verified (route-liveness.mjs:368-370). Verified.
- The **wave preflight refuses, never reroutes**: `matchRoute` selects only the member's own
  exact route (wave-driver.mjs:161-172); static-blocked and liveness-failed members are refused
  `wave_driver_route_unready` (wave-driver.mjs:313-319, :328-334); no substitution code exists.
  Verified.
- The four **landed terminal codes** are exactly the table (application-semantics.mjs:2063-2088),
  and a probe verdict today collapses to the generic (:2090-2095, :2127-2130). Verified.
- All five acceptance pins are **RED at HEAD** (no `verdict`/`probedAt`; `check` un-wired in the
  library seam; four typed codes only; no `provider_quota` class; no no-reroute test). Verified.

---

## 1. Citation audit

### 1.1 Verified accurate (complete list — all re-checked this session at HEAD)

`route-liveness.mjs` — :3-4 header (quote spans :3-6 — nit), :13-19 bounds, :35-47 probe-capability
gate (`turnCompletion === 'pausable'` at :37), :113-118 worker-turn `invalid_grant|revok` finding,
:132-146 `ensure`, :148-158 `_probeFlight`, :160-164 `_windowFor`, :174-247 `_runProbe` (:186-187
prompt, :198 spawn, :216-222 watchdog, :227-232 timeout classification, :235-241 content-verified,
:243-244 wire `invalid_grant` classification, :246 `provider_unreachable`), :249-309 `_verify`/`_fail`,
:311-321 `invalidateCredential`, :342-355 `_mintProbeReceipts`, :359-389 `project` (:366-368
verified+unexpired, :368-371 lapsed → unverified, :371-374 unsupported → unverified). **All accurate.**

`application-deployment.mjs` — :1005-1016 `publicRosterRow`, :1076-1192 `deploymentReadiness`,
:1094-1103 adapter-match gate, :1106-1120 projected claude auth, :1121-1156 native kimi/grok auth,
:1157-1164 advertised readiness block, :1165-1171 credential-state gate, :1172-1177 harness-version
gate, :1178-1181 the static summary, :1212-1219 `assertRouteReady`, :1268 `#liveness = deployment.liveness ?? null`,
:1329-1369 `doctorReadiness`, :1346-1350 non-enumerable `liveness`/`occupancy`, :1376-1381
`#livenessGate` no-op, :1383-1388 `#composeLive` `unobserved`, :1419-1442 `#rosterProjection`,
:1895-1906 liveness validation (≤120_000 at :1900-1906), :1980-1988 `RouteLiveness` construction,
:2044-2047 wiring into `BatonDeployment`. **All accurate.**

`wave-driver.mjs` — :161-172 `matchRoute`, :302-337 `policy.preflight` (:313-319 static refusal,
:325-335 liveness probe + refusal). **Accurate.** `application-cli.mjs` — :1261-1267 doctor parse
(`check` at :1264), :2213 `if (parsed.kind === 'doctor') return client.doctor();`. **Accurate at the
library seam** (see blocker #2 for the operative-path problem). `application-semantics.mjs` —
:2063-2088 four typed codes, :2090-2095 generic, :2127-2130 projection collapse. **Accurate.**
`application.mjs:12429` — raw `doctorReadiness()` projects every profile route `state: 'ready'`
(NUL file, cited with `grep -an` — correct discipline). **Accurate.** `limits.mjs` — :1-7 registry
law, :53-106 lane tables, :130-131 digest. **Accurate in substance** (span nit below).
`mcp-northbound.mjs:114-115` — only `baton_run_scratchpad_read`/`baton_run_scratchpad_elevate`.
**Accurate.** `coordination-store.mjs:14064` — `writeScratchpad(fields, auth)`.
**Accurate.** Adapter cards — grok-acp.mjs:238, claude-session.mjs:611, kimi-acp.mjs:182,
codex-appserver.mjs:314 all `turnCompletion: 'pausable'`; `GlmSessionCli extends ClaudeSessionCli`
(claude-session.mjs:1611), `DeepseekSessionCli extends GlmSessionCli`
(application-deployment.mjs:760). **Accurate.** `readiness-credentials-red.test.mjs` — 26 top-level
`test(` calls, matching "26/26 at HEAD". **Accurate.** Cross-refs —
`readiness-credentials-contract.md` §4.1.3 / §3 / §6 and `bidirectional-v3-decisions.md:134-143`.
**Accurate in substance.**

### 1.2 WRONG / misleading anchors

1. **`coordinator.mjs:12693` — WRONG ANCHOR (blocker #1).** The contract header's shared-publish
   note reads "the only write up-channel is the coordinator's internal `scratchpad.write`
   (coordinator.mjs:12693 → coordination-store.mjs:14064)". Line 12693 is
   `&& !handle.workerPolicyObserved && !handle.workerPolicyMismatch) {` — worker-policy
   observation code, not scratchpad. The coordinator's worker write method is
   **`writeScratchpad(workerId, entry, opts)` at coordinator.mjs:11103** (turn-fence-checked,
   `{actor: 'worker', principalId: workerId}`, scoped `worker:<id>` at coordination-store.mjs:14106),
   and the store method is at :14064 as cited. Substance correct; anchor wrong by ~1,590 lines.
   Per the frame law a wrong citation is an automatic blocker.
2. **`application-cli.mjs:2213` / G5-A2 mechanism — MISLOCATED SEAM (blocker #2).** G5's claim —
   "The doctor handler `if (parsed.kind === 'doctor') return client.doctor();` (:2213) DROPS
   `check` — it never reaches the deployment" — is literally true of that *library function*, but
   the real CLI never calls it for `doctor`. `impl/scripts/baton.mjs:79-98` handles
   `parsed.kind === 'doctor'` **inline**: it reads `parsed.check` at :81 (`if (!parsed.check ||
   local.state !== 'configured')`), and on `--check` calls `clientFor(discoverBatonConnection()).doctor()`
   (BatonWebClient.doctor, application-cli.mjs:1961-1978), which reads `/readyz` + `/v1/application-card`.
   So the operator's `--check` flag is *consumed* — it selects local-vs-remote — while no forced
   probe ever fires. The RED state ("no forced-probe surface") is real; the cited mechanism
   ("dropped at :2213") is not the operative path, and **A2's fix anchors a seam the operator
   never reaches**. See §4-A2 and §7-2.

### 1.3 Nits (non-blocking)

- `limits.mjs:53-106` — the three lane tables span :53-111; the merged `FRAME_LIMITS` export is at
  :115. Substance ("no probe lane") correct.
- `route-liveness.mjs:3-4` — the quoted header sentence spans :3-6.
- `bidirectional-v3-decisions.md:142-143` — "they bound spend, not progress" is at :143-144
  (the control law :134-143 is correctly cited).

---

## 2. Per-decision attacks against the REAL code

### D1 — the probe tier: economics, lies, cost honesty

**Probe shape / bounds / cost honesty — SOUND.** The bound claims survive contact with the code
(§1.1). The cost honesty is stated plainly and is accurate: one billed inference turn per probe,
amortized by the cache (zero in a fresh window, ≤1 per stale route per window, single-flight so a
cold 64-route wave costs ≤64 one-token calls then 0 while fresh). The 120s watchdog is a bound on
the measurement's own terminal wait, never a workflow control — the control-law distinction is
stated exactly as the brief demanded and matches the code (:216-222).

**HOLE (blocker #4) — the gate covers `run()` + wave preflight only.** D1 trigger-1 presents
"`#livenessGate` (application-deployment.mjs:1376-1381)" as *the* spawn/preflight gate. In the
code the gate is wired into exactly ONE spawn surface: `BatonDeployment.run()` at
application-deployment.mjs:1446. The sibling spawn surfaces — `startMany` (:1450-1457), `workflow`
(:1459-1466), `explore` (:1468-1471), `review` (:1473-1480) — call `assertRouteReady` but **never
consult liveness**. A quota-dead or capacity-dead route consumed by a workflow member, an explore,
a review, or a `startMany` batch spawns a real provider turn with no probe, no cache consult, no
refusal — the exact "killed waves at turn time while reading `ready`" failure #167 exists to
prevent, re-entering through the non-wave surfaces. The wave path is covered (G4's preflight), so
the contract's own D3 scope ("wave admission") is met — but D1's "spawn/preflight gate" claim is
broader than the wiring, and **no acceptance pin asserts the uncovered surfaces**. *Fix:* wire
`#livenessGate` into `startMany`/`workflow`/`explore`/`review` (they already `assertRouteReady`),
or explicitly scope D1-trigger-1 to "single-run spawn + wave preflight" and add a pin asserting
that the non-gated surfaces carry no liveness guarantee (honest-read-only posture).

**Note (not blocker) — the probe is a liveness ping, not a capacity probe.** The probe measures
turn-completion liveness: a provider that answers the 1-token ping but 402s the real wave still
passes the probe and dies at the real turn. The contract's non-goal "no probe-as-benchmark" is
honest, and A4's worker-turn classification catches the death *after* the fact — but D1's honesty
paragraph should say plainly that the probe cannot distinguish "will accept the ping" from "will
accept the wave". This is a residual of the problem class, not a fixable defect, but stating it
closes the "probe lies" question the brief raises.

**Note (not blocker) — the `resource.provider_call` receipt is self-attested.** The receipt is
minted by RouteLiveness after the adapter's terminal event (route-liveness.mjs:342-355). It attests
that the adapter reported a call; it is not a billing statement. An adapter that fabricates
`turn_completed` + the expected content would mint a "verified" verdict with a receipt. The adapter
is the trust boundary for real turns too, so this is inherent — but D1's "one `resource.provider_call`
receipt" framing should not be read as independent provider-side proof of a billed call.

### D2 — the honest projection and the staleness law

**Staleness law — SOUND.** The projection's only clock touch is the cache-freshness check
`expiresAt > now` at read time (route-liveness.mjs:366); `verifiedAt`/`expiresAt`/`latencyMs` are
recorded at probe time into the tuple (:249-267); a lapsed window reports the recorded times and
projects `unverified` (:368-370); never-stale-alive holds. Content-derived, never TTL-guessing —
verified in code.

**HOLE (blocker #3) — "unmissable" is not pinned against the serialization seam.** The operator's
only wire read is `baton doctor` → `BatonWebClient.doctor()` (application-cli.mjs:1961-1978) →
GET `/readyz` (web-northbound.mjs:1173, returns `{ready}` only) + GET `/v1/application-card`
(web-northbound.mjs:1181 → `_handleOperatorRead` :1470-1522). That transport serializes the doctor
document through JSON; the per-route `liveness`/`occupancy` are **non-enumerable**
(application-deployment.mjs:1348-1349) and **do not survive `JSON.stringify`**. The web card
explicitly re-adds only `briefing` — the D6c precedent at web-northbound.mjs:1507-1513 reads the
non-enumerable sibling by property access and copies it into the served shape — and does **not**
re-add `liveness`. The roster's `liveness` field IS enumerable (`publicRosterRow`,
application-deployment.mjs:1005-1016) but has **no wire surface at all**: no CLI/MCP/web command
exists (grep for `fleet`/`roster` in application-cli.mjs returns nothing; `fleet_roster` is a
registered-but-dead semantic operation). A1's wording — "as an enumerable additive field OR the
stated non-enumerable sibling the doctor already uses — either satisfies the pin" — therefore
permits an implementer to satisfy the pin **in-process** while the operator's actual read still
sees only `state: 'ready'`. The "unmissable" law ("A consumer that reads the readiness read must
see `verdict` and `probedAt`") is **not met on the only readiness read the operator has** unless the
transport is pinned. *Fix:* require the honest fields to be **enumerable** on the doctor route row
(JSON-surviving), AND/OR pin the northbound re-add (the `briefing` precedent) for `/v1/application-card`,
`deployment.doctor`, and the MCP result envelope; add a pin asserting an operator wire read carries
`verdict` + `probedAt`.

### D3 — admission: refuse or inform; never silently reroute

**SOUND (the invariant).** `matchRoute` selects only the member's own exact route
(wave-driver.mjs:161-172) and no code path substitutes a different route; the preflight refuses
static-blocked (:313-319) and liveness-failed (:328-334) members with `wave_driver_route_unready`
before any spawn; `member.exact` is never rewritten; no fallback route is probed. The
no-reroute property holds in the real code, and A5's demand for a behavior + source-scan test is
the right pin.

**Coupled to the D2 fix.** The "inform" channel — the roster/doctor advisory the contract says an
orchestrator uses to *defer a member to a live seat* — is currently **wire-blind** for any
external orchestrator (MCP/web/CLI) until the D2 serialization fix lands (§2-D2). The in-process
wave preflight reads the non-enumerable sibling by property access and works today; the external
orchestrator does not.

**Note (not blocker) — the preflight admits an *unsupported* route unverified.** A non-pausable
adapter (test double / misconfiguration) produces `state: 'unsupported'`; `project` renders it
`unverified` (route-liveness.mjs:371-374), and the preflight's probe call leaves `refreshed?.state`
as `unverified` — **not** `failed` — so the member is admitted with no liveness verification
(wave-driver.mjs:325-335). Every real adapter is `pausable` (verified, §1.1), so this is a
test-double/misconfig path and the contract's additive-never-block posture is intentional — but the
admission is permissive for unverifiable routes, and the contract says so.

---

## 3. Refusal vocabulary

**SOUND.** The four landed codes and the generic collapse are exactly as described
(application-semantics.mjs:2063-2088, :2090-2095, :2127-2130). The extension (typed
`provider_unreachable`, `probe_content_mismatch`, `probe_oversize`, NEW `provider_quota`, each
carrying `{category, summary, remediation, retryable}`) is closed and typed, and A3's source-scan
pin would fail a wrong impl. Honest caveat correctly stated: A4 pins the *classification
separation* with a fixture; the exact 402/`insufficient_quota`/capacity wire grammar is unverified
against live wire (OQ2) — until it lands, `provider_quota` is a separation-only guarantee.

**Note.** The worker-turn finding (route-liveness.mjs:113-118) classifies only `invalid_grant|revok`;
a worker-turn 402/capacity death on a REAL turn currently also collapses to the generic at the
terminal projection (A4's "or worker turn" needs the same wire grammar to classify — OQ2's framing
is honest).

---

## 4. Acceptance pins — shallow-greenability

- **A1 (D2 shape) — RED at HEAD, but shallow-greenable (blocker #3).** A wrong impl that adds
  enumerable `verdict`/`probedAt` to the roster and keeps the doctor's non-enumerable sibling
  would pass the pin's letter while the operator's wire read stays blind. The pin must require the
  wire-surviving form (or pin the transport re-add). See §2-D2.
- **A2 (--check surface) — RED at HEAD, but anchors the wrong seam (blocker #2).** "Propagate the
  parsed `check` flag (application-cli.mjs:1264) through the doctor handler (:2213)" — the real
  CLI never reaches :2213 for doctor (baton.mjs:79-98 handles it inline and already consumes
  `check`). An impl that literally "propagates check through :2213" is green while
  `baton doctor --check` still never forces a probe. The pin must assert the **operator surface**:
  baton.mjs doctor branch → `BatonWebClient.doctor()` (application-cli.mjs:1961) → web wire →
  web-northbound forced-probe parameter. See §7-2.
- **A3 (typed probe failures) — RED at HEAD, SOUND.** A source scan is not trivially shallow-green;
  a wrong impl would fail the scan.
- **A4 (quota/capacity class) — RED at HEAD, SOUND as framed.** Pins the classification separation
  with a fixture; the wire grammar is honestly deferred to OQ2.
- **A5 (refuse or inform, never reroute) — RED at HEAD, SOUND.** Behavior + source-scan; a wrong
  impl that substitutes a route would fail both.

---

## 5. Open questions

All six are reasonable judgment calls. Two deserve elevation:

- **OQ4 (the `--check` wire path) is underweighted.** It is the crux of A1/D2's "unmissable" law,
  not a wire-shape implementation detail: whether the honest fields survive the operator's read
  determines whether the contract closes the honesty gap at all. Fold OQ4's decision into A1/A2
  (enumerable fields + a transport pin), rather than leaving it as a post-pin choice.
- **OQ3 (re-probe cadence for a quota death) needs a decision, not an open question.** With the
  default `failureWindowMs = 10 * 60 * 1000` (route-liveness.mjs:17), an auto-re-probe of a
  quota-dead route spends budget every 10 minutes. The contract names `--check` as the primary
  unstick but leaves the window to the deployment. Recommend `provider_quota` rows exclude
  automatic re-probe (operator-surface only), matching OQ3's own judgment — pin it in A4's fix.

---

## 6. Escalations

None authority-class. All judgment calls are recorded above (§2-§5). The shared-scratchpad publish
is **non-executable at this HEAD**: no worker-facing write verb exists — the MCP northbound exposes
only `baton_run_scratchpad_read`/`baton_run_scratchpad_elevate` (mcp-northbound.mjs:114-115), the
CLI registers only `run.scratchpad.read`/`run.scratchpad.elevate` (application-cli.mjs:30, :1476-1506),
and `run.scratchpad.append` / a `baton_run_scratchpad_write` tool does not exist anywhere
(verified by grep). This report is therefore the durable-file harvest artifact; the coordinator's
fallback (read the durable file where the shared post is absent) applies, exactly as the row's own
contract header and foundry-qa recorded for wave-a.

---

## 7. Verdict — NOT FOLD-READY

**Numbered blockers (what + why + concrete fix):**

1. **Citation: `coordinator.mjs:12693` is a wrong anchor** for the shared-publish note's
   "scratchpad.write up-channel" (the line is worker-policy observation code; the coordinator's
   worker write is `writeScratchpad` at **coordinator.mjs:11103**). *Why:* the frame law makes a
   wrong citation an automatic blocker, and the header is the first thing a reader checks. *Fix:*
   re-cite to coordinator.mjs:11103 (the store side, coordination-store.mjs:14064, is correct).
2. **Citation/mechanism: G5 and A2 anchor the `--check` failure at `application-cli.mjs:2213`, but
   the operator never reaches that seam.** The real `baton doctor --check` is handled inline at
   `impl/scripts/baton.mjs:79-98`, reads `parsed.check`, and calls `BatonWebClient.doctor()`
   (application-cli.mjs:1961) — which reads `/readyz` + `/v1/application-card` and never forces a
   probe. *Why:* A2's fix, implemented literally, would be green while the operator surface stays
   unwired. *Fix:* pin the operator path — baton.mjs doctor branch → `BatonWebClient.doctor()` →
   web wire → web-northbound forced-probe parameter — and assert a fresh probe fires per
   stale/absent route on `baton doctor --check`.
3. **HOLE (D2/A1): the honest projection is not unmissable on the operator's wire read.**
   Non-enumerable per-route `liveness`/`occupancy` vanish under JSON serialization
   (application-deployment.mjs:1348-1349); web-northbound re-adds only `briefing`
   (web-northbound.mjs:1507-1513); the roster's enumerable `liveness` has no CLI/MCP/web surface.
   A1's "OR the stated non-enumerable sibling" clause permits a shallow-green implementation. *Why:*
   the exact failure the contract exists to prevent (operator reads `ready`, seat is dead) survives
   on the wire. *Fix:* require enumerable `verdict`/`probedAt` on the doctor route row and/or pin the
   northbound re-add for `/v1/application-card` + `deployment.doctor` + MCP result; add a pin
   asserting an operator wire read carries `verdict` + `probedAt`.
4. **HOLE (D1): the probe gate covers `run()` + wave preflight only.** `#livenessGate` is wired
   into `BatonDeployment.run()` (application-deployment.mjs:1446); `startMany` (:1450-1457),
   `workflow` (:1459-1466), `explore` (:1468-1471), `review` (:1473-1480) spawn provider turns with
   `assertRouteReady` only and no liveness consult. *Why:* a quota-dead route consumed by a
   workflow/explore/startMany re-opens the #167 failure through the non-wave surfaces, and no pin
   catches it. *Fix:* wire `#livenessGate` into those four surfaces, or explicitly scope
   D1-trigger-1 and add a pin asserting the non-gated surfaces' honest-read-only posture.

**Amendments (non-blocking):** (a) state in D1's honesty paragraph that the probe is a liveness
ping, not a capacity probe — a provider that answers the ping but 402s the real wave passes the
probe (the residual the brief's "probe lies" question targets); (b) fold OQ4 into A1/A2 as a
wire-survival requirement; (c) give `provider_quota` a no-auto-re-probe window decision (OQ3).

**Notes (recorded, no action):** the `resource.provider_call` receipt is self-attested (adapter is
the trust boundary); the preflight admits an unsupported (non-pausable) route unverified;
`limits.mjs` FRAME_LIMITS span is :53-111/:115 (nit); the route-liveness header quote spans :3-6
(nit); the control-law quote sits at bidirectional-v3-decisions.md:143-144 (nit).

---

## 8. Supplemental live verification (attack drive, pass 2 — run against the real tree + resident server)

Second-pass checks executed after the initial write; each corroborates a finding above rather than
changing it.

- **The operator seam is exercised, not dead code.** A resident deployment is live
  (`impl/scripts/baton.mjs serve impl/scripts/resident.deployment.mjs`; `transport: local` per
  `.git/baton/connection.json`). Running `baton doctor` returns `inspectBatonConnection` local state
  (`state: needs_setup`, profile missing); running `baton doctor --check` returns the same local
  inspection and consumes the flag in the `!parsed.check || local.state !== 'configured'` branch
  (baton.mjs:81) — **no remote read, no forced probe, never reaching application-cli.mjs:2213**.
  This is empirical confirmation of blocker #2: the operator surface does not do what A2's
  (mis-anchored) fix would deliver.
- **`fleet_roster` has zero wire exposure.** `grep fleet_roster` in `mcp-northbound.mjs`,
  `application-cli.mjs`, `web-northbound.mjs` returns nothing. The roster's enumerable `liveness`
  (application-deployment.mjs:1005-1016) is reachable only in-process via
  `deployment.fleet.roster()` — no CLI/MCP/web surface. Corroborates blocker #3: the wire read is
  the operator's only read, and it carries neither the roster liveness nor the doctor's
  non-enumerable sibling.
- **The no-reroute invariant holds across the spawn layer too.** `wave.mjs:90-99` validates
  `member.exact` to a closed `{harness, model, effort}` shape; :196-197 passes the member's own
  `exact` into the spawn envelope. No code path substitutes a route for a member. Corroborates the
  D3 SOUND verdict (not just `matchRoute` at wave-driver.mjs:161-172).
- **Probe economics coalesce per route.** The wave preflight's `probe` handle
  (route-liveness.mjs:379-387) calls `ensure` → `_probeFlight` (route-liveness.mjs:148-158),
  keyed by `routeKey` — N members sharing one route coalesce into a single probe, so a cold wave of
  N members over M distinct routes costs ≤ M one-token calls, not N. The contract's "≤64 one-token
  calls on a first wave" bound is accurate.
- **Shared-scratchpad publish — attempted against the live surface.** The MCP tool list exposes
  only `baton_run_scratchpad_read`/`baton_run_scratchpad_elevate` (mcp-northbound.mjs:114-115); the
  CLI registers `run.scratchpad.read`/`run.scratchpad.elevate` and the run-scoped
  `run.board.post` (application-cli.mjs:30, :1476-1506, :1513-1541 — the board verb requires a
  runId and is not the `shared` partition); no `run.scratchpad.append` / `baton_run_scratchpad_write`
  exists anywhere in `impl/src`. There is no executable path at this HEAD that writes a `shared`
  note; the durable file is the publish and the coordinator's documented fallback applies.
