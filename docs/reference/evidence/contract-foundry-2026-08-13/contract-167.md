# Issue #167 — the bounded actual-inference readiness tier: implementation contract v1

The implementation contract for issue #167: static readiness (credential present + executable
compatible) is not provider-alive — Grok's 402 and glm's capacity deaths each killed waves at turn
time while reading `ready`. This is a **Ring-2 contract** (ground truths → decisions → refusal
vocabulary → red-first acceptance pins → open questions): it **specifies behavior**; it does not
amend implementation in this artifact. It cross-references — it does not re-specify — the landed #47
liveness tier (`route-liveness.mjs`; `readiness-credentials-contract.md` v1.0, post-red-team fold),
the static readiness substrate (`application-deployment.mjs`), and the wave-driver preflight seam
(`wave-driver.mjs`).

- **Date:** 2026-08-13
- **Status:** DRAFT v1 — red-first. The probe machinery itself is LANDED (#47); the pins below
  target the honesty gaps #167 names. No code lands in this rung.
- **Verification HEAD:** `e371f704727cbca5fdff86af31ec8b154620a71f` ("Baton private effective-tree
  snapshot"). Every `file:line` citation below was re-verified this session with `grep -an` /
  `sed -n` / `Read` at this HEAD, not inherited. No NUL-bearing files are cited; the one
  `application.mjs` anchor is cited with `grep -an` (that file carries NUL bytes).
- **Brief:** `row-readiness.md` + `foundry-brief.md` (same dir) — read fully. The issue body
  (`gh issue view 167`) could not be fetched (`gh` is not authenticated in this worktree); the
  requirements are carried by the brief, the problem statement, the landed #47 contract
  (`readiness-credentials-contract.md`), and the code itself.
- **Shared-scratchpad publish:** NOT performed — no worker-facing surface that writes the `shared`
  partition exists at this HEAD. Verified: the only write up-channel is the coordinator's internal
  `scratchpad.write` (coordinator.mjs:12693 → coordination-store.mjs:14064), which writes to
  `worker:<id>` scope only and is reachable solely from inside a live authenticated worker stream
  (bound `workerId` + turn fence); promotion to `shared` is a coordinator/steering elevation action
  (`elevateTaskScratchpad`/`settleWorkflowScratchpad`), not a row write. The MCP northbound surface
  exposes only `baton_run_scratchpad_read`/`baton_run_scratchpad_elevate` (mcp-northbound.mjs:114-115);
  no `run.scratchpad.append` / `scratchpad.write` routing exists in `application-cli.mjs` or
  `mcp-northbound.mjs`. Per `coordinator-brief.md` (line 12) the coordinator falls back to the durable
  files `contract-<issue>.md` where the shared post is absent — that fallback is invoked here; this
  file IS the publish, and the coordinator should note it.
- **Scope, one sentence:** the actual-inference readiness tier's honesty is closed — the probe is a
  bounded real one-token inference with stated cost and trigger surfaces (D1); the readiness read
  carries a `{static, probedAt, verdict}` projection where a static-only read never relabels itself
  alive (D2); and wave admission may only refuse or inform — never silently reroute (D3).

---

## Ground truths (verified this session)

### G1 — Static readiness is the substrate, and its verdict text is honest about being static

- `deploymentReadiness()` (application-deployment.mjs:1076-1192) computes per-route states from
  adapter cards + credential metadata + observed harness version. The passing row summary is exactly
  **"The exact route passed static deployment readiness."** (application-deployment.mjs:1178-1181).
  The gate order: exact adapter match (`route_unavailable`/`route_ambiguous`, :1094-1103); projected
  claude authentication (:1106-1120); native kimi/grok authentication (:1121-1156); adapter-advertised
  `readiness` block (:1157-1164); credential state not absent/expired/invalid/unavailable (:1165-1171);
  harness version `observed` (:1172-1177). All static.
- `assertRouteReady()` (application-deployment.mjs:1212-1219) refuses spawns/waves on `blocked`
  routes with the typed code — the enforcement seam the live tier extends.
- The raw application's `doctorReadiness()` (application.mjs:12429, NUL file, cited with `grep -an`)
  projects every profile route as `state: 'ready'` — a purely static projection that knows nothing
  about provider-aliveness. The deployment facade owns the honest surface.

### G2 — The actual-inference tier is LANDED as `RouteLiveness` (#47), and its probe is real and bounded

- Header (route-liveness.mjs:3-4): "RouteLiveness — the #47 bounded actual-inference readiness tier
  … an additive liveness attribute on the existing route state: per-route probe cache joined to
  credential identity, single-flight per route, never probe per call."
- Probe shape (route-liveness.mjs:174-247): one bounded prompt requiring a deterministic,
  content-verifiable answer — `Reply with exactly one line: '<model>-probe ok'. Nothing else.`
  (:186-187) — executed through the real adapter for the exact route via `adapter.spawn(probeId,
  { goal: prompt })` (:198), the same code path a real spawn rides. The verdict is content-verified:
  `lifecycle.turn_completed` + `payload.status === 'completed'` + captured output trimmed to the
  expected line → verified (:235-241). A bare `lifecycle.spawned` is not proof of provider-alive.
- Probe-capability gate (route-liveness.mjs:35-47): a route is probe-capable only when its adapter
  card is `turnCompletion: 'pausable'` — every real adapter claims it (grok-acp.mjs:238,
  claude-session.mjs:611, kimi-acp.mjs:182, codex-appserver.mjs:314; `GlmSessionCli`/
  `DeepseekSessionCli` extend the claude-session family). Non-pausable test doubles are
  honest-unsupported, never a block.
- Bounds (route-liveness.mjs:13-19): prompt ≤ 1KiB (`PROBE_PROMPT_MAX_BYTES = 1024`, :18); capture
  ≤ 2KiB (`PROBE_CAPTURE_MAX_BYTES = 2048`, :19; `output.slice(0, PROBE_CAPTURE_MAX_BYTES)` at :237);
  probe watchdog ≤ 120s (`DEFAULT_PROBE_TIMEOUT_MS = 120_000`, :16; `Promise.race([terminal, timeout])`
  at :216-222, `timer.unref()`); exactly one `resource.provider_call` receipt (minted at :342-355).
- Classification (route-liveness.mjs:189, :241, :243-244, :246): `probe_oversize` (bound escape),
  `probe_content_mismatch` (provider answered, not the pin), `authentication_refresh_required` (wire
  `invalid_grant|revok`), `provider_unreachable` (no terminal / network / timeout).
- Cache (route-liveness.mjs:249-309): per-route frozen tuple
  `{state: verified|failed|unsupported, verifiedAt, expiresAt, probeId, latencyMs, code?, credentialKey}`
  on `_verify` (:249-268); `_fail` (:270-309) records `failedAt` + `code`; credential-scoped
  invalidation (:311-321) fans `invalid_grant` to every row sharing `credentialKey` in the same write.
- Never probe per call (route-liveness.mjs:132-146 `ensure`): verified+unexpired → cache hit; failed
  within `failureWindowMs` → refuse with the typed code; otherwise one probe, single-flight per route
  (`_probeFlight`, :148-158). Concurrent stale triggers coalesce.
- Windows are cache-freshness derivations from vendor physical bounds (route-liveness.mjs:13-15,
  :160-164): grok 28 min (observed credential TTL), claude ~4.4h (observed access TTL), static-key
  routes 24h (non-expiring key).

### G3 — The doctor projection separates static from liveness, but the honest signal is a non-enumerable sibling

- `doctorReadiness()` (application-deployment.mjs:1329-1369) is the single projection function: it
  re-probes workspace capacity + claude/grok credential metadata fresh per read and reuses the frozen
  open-time route states. It attaches `liveness`/`occupancy` as NON-ENUMERABLE row fields
  (`Object.defineProperty`, :1346-1350) — visible to reading consumers, invisible to
  `Object.keys`/`JSON.stringify`.
- The roster row (application-deployment.mjs:1005-1016 `publicRosterRow`) carries `static` /
  `liveness` / `occupancy` / `learning`; the roster projection `#rosterProjection()` (:1419-1442)
  composes the same underlying rows (one projection function, no drift).
- The enumerable doctor row still reads `state: 'ready'` for a static-ready route (RT-4 pins this
  separation); the liveness class is only reachable through the non-enumerable `liveness` sibling or
  the roster's `liveness` field. This is the D2 gap: a consumer that reads the enumerable doctor row
  (or the raw application) sees "ready" with no `probedAt`/`verdict` anchor to a measurement.

### G4 — The wave preflight is a composed-row consumer; it refuses, it never reroutes

- `policy.preflight` (wave-driver.mjs:302-337): `baton.doctor()` once per wave; per member
  `matchRoute(member, routes)` (:161-172) matches against the MEMBER's exact route; a static
  not-ready member refuses `wave_driver_route_unready` (:313-319); a member whose liveness row is not
  `verified` probes once via the non-enumerable `probe` handle (:323-335) and refuses
  `wave_driver_route_unready` when the refreshed state is `failed` (:328-334). No route substitution
  exists in the seam — `matchRoute` only selects the member's own route.
- The probe handle is `project(route, { withProbe: true })` (route-liveness.mjs:359-389): a
  non-enumerable `probe` closure that runs `ensure(route)` then re-projects.

### G5 — The operator's on-demand probe surface is parsed but dead

- `baton doctor [--depth outline|connection|profile|evidence] [--check]` is parsed at
  application-cli.mjs:1261-1267 (`const check = flag(args, '--check')`, :1264). The doctor handler
  `if (parsed.kind === 'doctor') return client.doctor();` (:2213) DROPS `check` — it never reaches
  the deployment. The prior contract's promise of `baton doctor --check` as the operator's
  forced-retry surface (readiness-credentials-contract.md §4.1.3, fold F-7) is unwired at this HEAD.

### G6 — The probe's failure codes are not in the typed refusal vocabulary

- `PROVIDER_TERMINAL_GUIDANCE` (application-semantics.mjs:2063-2088) names exactly four codes:
  `authentication_required`, `authentication_refresh_required`, `wire_frame_oversize`,
  `provider_crashed`. `provider_unreachable`, `probe_content_mismatch`, `probe_oversize` are NOT
  there; `projectProviderTerminalCause` (:2127-2130) maps them to `GENERIC_PROVIDER_TERMINAL_GUIDANCE`
  (:2090-2095, "The provider route failed."). A probe's typed verdict therefore collapses to a
  generic failure at the terminal-cause projection.
- The ONLY wire-classified verdict is `invalid_grant|revok` → `authentication_refresh_required`
  (route-liveness.mjs:243-244, and the worker-turn finding at :113-118). A Grok 402 (payment/quota)
  or glm capacity death is indistinguishable from a transient network failure: it surfaces as
  `probe_content_mismatch` (:241) or `provider_unreachable` (:246).

### G7 — The probe's byte bounds are inline literals, not #89-registry rows

- `PROBE_PROMPT_MAX_BYTES`/`PROBE_CAPTURE_MAX_BYTES` are declared at route-liveness.mjs:18-19.
  `FRAME_LIMITS` (limits.mjs:53-106) has no probe lane. This is a #89 no-re-declare-law debt
  (limits.mjs:1-7, "the registry is the only source"), recorded here and in OQ5 — this rung
  introduces no NEW byte bound, so it does not add a registry row.

### G8 — The tier is opt-in per deployment and never blocks when unwired

- `advanced.liveness = {now, probeTimeoutMs, failureWindowMs}` is validated
  (application-deployment.mjs:1895-1906: `probeTimeoutMs`/`failureWindowMs` positive safe integers
  ≤ 120_000), `RouteLiveness` is constructed with the deployment adapters/coordinator/coordination/log
  (:1980-1988), and passed into `BatonDeployment` (:2044-2047). When `advanced.liveness` is absent,
  `#liveness` is `null` (:1268), `#livenessGate` no-ops (:1376-1381), and doctor `#composeLive`
  projects `{state: 'unobserved'}` (:1383-1388) — honest-unverified, never a block, never a probe.

---

## The question

An orchestrator reading the doctor today sees `grok-4.5@low: ready` (the static summary "The exact
route passed static deployment readiness") while the seat behind it will eat a real turn and die —
Grok's 402 and glm's capacity deaths each killed waves at turn time. The tier exists (#47) but
(a) there is no operator surface that forces a fresh probe on demand, (b) the readiness read's
honest signal is a non-enumerable sibling a serializing consumer cannot see, and (c) the probe's
verdicts collapse to a generic provider failure, so "quota-dead" and "momentarily unreachable" read
identically. Can the tier's honesty be closed — a bounded real probe with stated cost and triggers,
an unmissable `{static, probedAt, verdict}` projection, and an admission interaction that refuses or
informs but never silently reroutes?

---

## Control-law preamble (binding)

The campaign control law (bidirectional-v3-decisions.md:134-143) bans clocks as CONTROLS on agent
work. This contract's probe timeout and liveness windows are **resource circuit-breakers** — "they
bound spend, not progress" (bidirectional-v3-decisions.md:142-143) — never progress controls. The
distinction, stated honestly:

- **The probe timeout (≤120s) is a bound on the PROBE, not a workflow control.** It bounds how long
  the *measurement* waits for its own terminal event (`lifecycle.turn_completed` /
  `process_closed` / `crashed` / `exited`, route-liveness.mjs:20-22) before the probe is classified
  `provider_unreachable`. It never truncates a real worker turn, never judges an agent, never gates
  in-flight work. It is a spend bound: a probe that hangs is killed so a dead route stops consuming
  provider budget.
- **The windows (grok 28 min, claude 4.4h, static-key 24h) are cache-freshness derivations** from
  vendor-observed credential physical bounds (route-liveness.mjs:13-15) — they gate whether Baton
  re-probes, never whether a worker's work continues.
- **The failure window (`failureWindowMs`, default 10 min) bounds only the automatic re-probe
  cadence.** The explicit `baton doctor --check` surface (pinned A2) and the credential-refresh
  surfaces unstick a route immediately, independent of the window — the constructive carve-out the
  law names (the same classification fold F-7 recorded in readiness-credentials-contract.md §3).
- **No decision below introduces a per-turn limit or a liveness clock on real work.** The probe's
  one-shot bound and the cache's freshness checks are the whole story.

---

## Decisions

### D1 — The probe tier: bounded, real, one-token inference; cost honest; three triggers

**Probe shape (pins the landed #47 shape).** One bounded content-verified inference turn through the
projected private worker runtime, on the exact route's real adapter — the same code path a real
spawn rides (route-liveness.mjs:174-247). The probe prompt requires a deterministic,
content-verifiable answer (`<model>-probe ok`, one line); the verdict passes only when the
`lifecycle.turn_completed` receipt carries the exact expected output (:235-241). A bare
`lifecycle.spawned` is not proof of provider-alive.

**Exact bounds (the closed timeout class).**
- exactly one provider call per probe (one `resource.provider_call` receipt, route-liveness.mjs:342-355);
- prompt ≤ 1KiB, captured response ≤ 2KiB (route-liveness.mjs:18-19, :188, :237);
- probe watchdog ≤ 120s, deployment-configurable via `advanced.liveness.probeTimeoutMs` and validated
  ≤ 120_000 (application-deployment.mjs:1900-1906), default 120_000 (route-liveness.mjs:16);
- single-flight per route, so N concurrent stale triggers coalesce into one probe
  (route-liveness.mjs:148-158);
- exactly one verdict per probe — no retry, no loop (a timed-out probe is classified
  `provider_unreachable`, never awaited, route-liveness.mjs:216-222, :227-232).

The 120s probe timeout is a bound on the PROBE (a spend/liveness bound on the measurement), never a
workflow control — see the control-law preamble. It bounds the measurement's own terminal wait, not a
worker's turn.

**Cost honesty (say it plainly).** The probe spends **real provider budget** — one billed inference
turn per probe. The tier is not free. It is amortized by the cache: zero probes inside a fresh
window; ≤ 1 probe per stale route per window; single-flight so a cold 64-route deployment costs ≤ 64
one-token calls on its first wave, then 0 while windows are fresh. That bound is a resource
circuit-breaker, not a cap on agent work.

**When it runs — three triggers, all through the cache discipline (never per call):**
1. **Spawn/preflight gate** (application-deployment.mjs:1376-1381 `#livenessGate`): consult the
   cache, probe only on stale/absent (`RouteLiveness.ensure`, route-liveness.mjs:132-146).
2. **Wave preflight** (wave-driver.mjs:323-335): per member, cache-short-circuit, probe once per
   stale route, refuse `wave_driver_route_unready` on `failed`.
3. **On-demand operator surface** — `baton doctor --check` becomes the forced-probe verb (pinned A2,
   RED at HEAD): it propagates the parsed `check` flag (application-cli.mjs:1264) through the doctor
   handler (:2213) to the deployment, forcing one fresh probe per stale/absent liveness row and
   returning the updated honest projection. This is the operator's forced-retry surface the prior
   contract promised (readiness-credentials-contract.md §4.1.3) and the preflight uses only as a
   cache-short-circuited read.

**Opt-in per deployment.** The tier is wired only when `advanced.liveness` is supplied (G8). Absent →
`#liveness` is `null`, liveness projects `unobserved` (application-deployment.mjs:1383-1388), no
probe ever runs, nothing is blocked on liveness. A deployment that does not opt in reads static-only
and must never be misread as provider-alive — that is D2's law.

### D2 — The honest projection: `{static, probedAt, verdict}`, and the staleness law

**Shape.** The readiness read — the roster row and the doctor route row — carries the closed honest
projection (semantic order; no byte-stability claim):

```
{
  static: { state, code?, summary? },        # the deploymentReadiness verdict (G1) — unchanged
  probedAt: ISO-8601 | null,                 # last probe measurement time (verifiedAt or failedAt), content-derived
  verdict: 'alive' | 'unverified' | 'failed',# the liveness class — the honest signal
  expiresAt?, latencyMs?, code?, credentialKey   # bounded supporting atoms, unchanged from the landed tuple
}
```

**The cardinal law: a static-only read NEVER relabels itself alive.** `verdict: 'alive'` is produced
ONLY from a content-verified probe whose recorded window is unexpired (route-liveness.mjs:366-368).
Every other case produces `verdict: 'unverified'`:
- no probe ever recorded → `probedAt: null`, `verdict: 'unverified'`;
- window lapsed (`expiresAt ≤ now`) → `probedAt` still shows the last measurement,
  `verdict: 'unverified'` (route-liveness.mjs:368-371) — honest not-live, never stale-`alive`;
- route unsupported (non-pausable adapter) → `verdict: 'unverified'` (route-liveness.mjs:371-374) —
  additive tier, never a fabricated failure;
- deployment not opted in → `verdict: 'unverified'` (G8).

The projection must be **unmissable**: it is carried on the enumerable roster row and on the doctor
route row (as an enumerable additive field OR the stated non-enumerable sibling the doctor already
uses — either satisfies the pin, but the enumerable doctor `state: 'ready'` must never be the ONLY
signal a consumer can read). A consumer that reads the readiness read must see `verdict` and
`probedAt` without reaching into a private sibling.

**The staleness law.** A probe result ages; the projection says how old it is **from content**, never
TTL-guessing. "Content" = the `verifiedAt`/`expiresAt`/`latencyMs` recorded AT PROBE TIME into the
cache tuple (route-liveness.mjs:249-267). The projection's ONLY clock touch is the freshness check
`expiresAt > now` at read time (:366) — a cache-freshness check on recorded content, not a
re-derivation of age from `now − vendorWindow`. When the window lapses, the verdict becomes
`unverified` with `probedAt`/`expiresAt` reporting the actual recorded times, so an orchestrator
reads "static-ready, last live-verified at T, lapsed at E" — not a guessed age.

### D3 — The admission interaction: refuse or inform; never silently reroute

Wave admission may use the tier in exactly two honest ways:

1. **Refuse before commit.** A member whose route verdict is `failed` — or whose static state is
   `blocked` — is refused at preflight with the typed code `wave_driver_route_unready`
   (wave-driver.mjs:313-335). This is landed (RT-5/RT-5p) and stays.
2. **Inform before commit.** The roster/doctor advisory shows `verdict` + `probedAt` per route so an
   orchestrator can **defer a member to a live seat before commit** — by changing ITS OWN exact route
   choice. The tier never proposes a seat, never rewrites `member.exact`, never probes a fallback
   route, never consumes router advice on a member's behalf. The orchestrator's exact route is the
   sole selection authority; the tier only informs and refuses.

**Never silently reroute** is a hard invariant: the wave driver's `matchRoute` selects only the
member's own route (wave-driver.mjs:161-172); no code path substitutes a different route for a member
whose route is unverified or failed. The contract pins this with a dedicated test (A5) — no fallback
probing, no `member.exact` mutation, no silent seat swap. If an orchestrator wants a different seat,
it says so in the member's `exact` — that is its authority, not the tier's.

---

## Refusal vocabulary (closed, typed)

Extend the typed vocabulary so every probe verdict has a named code in `PROVIDER_TERMINAL_GUIDANCE`
(application-semantics.mjs:2063-2088) — a source-scan pin (A3):

| Code | Class | Summary | Remediation |
|---|---|---|---|
| `authentication_required` | provider_authentication | existing | existing |
| `authentication_refresh_required` | provider_authentication | existing; the `invalid_grant` class | existing + `baton doctor --check` / credential refresh |
| `provider_unreachable` | provider_runtime | the provider did not complete a turn within the probe bound (network/timeout) | retry after the bound; `baton doctor --check` forces a fresh probe |
| `probe_content_mismatch` | provider_protocol | the provider answered but not the content pin | inspect the route's bounded evidence; `baton doctor --check` |
| `probe_oversize` | provider_protocol | the probe exceeded its own bounds | a tier defect — report it; the bound is registry-declared (OQ5) |
| `provider_quota` (NEW) | provider_capacity | the provider's quota/capacity is exhausted (HTTP 402 / `insufficient_quota` / rate-capacity wire) | resolve the vendor quota/capacity condition; `baton doctor --check` after |

Every code carries `{category, summary, remediation, retryable}` in the existing table shape. A probe
or worker-turn verdict maps to its code — never a generic "not ready" — so the preflight refusal and
the terminal-cause projection (application-semantics.mjs:2127-2130) name the actual class.

---

## Non-goals (out of v1)

- **No probe-as-benchmark.** The probe is one bounded content-verified turn for liveness — never a
  throughput/latency/quality benchmark, never a second provider cost axis.
- **No auto-heal, no automatic re-login, no automatic quota purchase.** A failed probe, a latched
  credential, or a quota death reports the typed blocked state and the corrective action; the
  operator's explicit surfaces (`baton doctor --check`, credential refresh) are the only unlocks.
- **No auto-reroute.** The tier never selects a seat, never rewrites `member.exact`, never probes a
  fallback. The orchestrator's exact route is the sole authority.
- **No new store.** The liveness cache stays the deployment-side in-memory cache held by the resident
  process (G2/G8); a durable probe ledger is a v1.1 candidate.
- **No per-call probing.** The cache short-circuit is an invariant; a caller probing per call is a
  bug, not a policy.
- **No removal of the static substrate.** `deploymentReadiness` / `assertRouteReady` / DP3-DP5 stay
  byte-stable; the tier is additive.

---

## Acceptance (red-first — every pin RED at the current HEAD)

**A1 (D2 — the honest projection shape).** A static-only readiness read — no probe recorded, or
window lapsed, or route unsupported, or deployment not opted in — carries `verdict: 'unverified'`
with `probedAt: null` (or the recorded measurement when one exists), and NEVER `verdict: 'alive'`. A
`verdict: 'alive'` row requires a content-verified probe with an unexpired recorded window, and its
`probedAt` equals the recorded `verifiedAt` (content-derived, never a TTL guess). *RED at HEAD: no
`verdict`/`probedAt` fields exist; the doctor row's enumerable `state: 'ready'` is the only readable
signal and the roster's liveness tuple spells the class as `state`, not `verdict`.*

**A2 (D1 — the on-demand probe surface).** `baton doctor --check` propagates the parsed `check` flag
(application-cli.mjs:1264) through the doctor handler (:2213) to the deployment and forces exactly one
fresh probe per stale/absent liveness route before returning the updated honest projection; a
cache-fresh route probes zero times; a `failed` probe returns the typed verdict in the read. *RED at
HEAD: `check` is parsed at :1264 but dropped at :2213 (`if (parsed.kind === 'doctor') return
client.doctor();`).*

**A3 (refusal vocabulary — typed probe failures).** A source scan pins that `provider_unreachable`,
`probe_content_mismatch`, `probe_oversize`, and `provider_quota` each have a
`PROVIDER_TERMINAL_GUIDANCE` row with `{category, summary, remediation, retryable}`, and that a probe
verdict never projects through `GENERIC_PROVIDER_TERMINAL_GUIDANCE` ("The provider route failed.").
*RED at HEAD: only `authentication_required`/`authentication_refresh_required`/`wire_frame_oversize`/
`provider_crashed` are typed (application-semantics.mjs:2063-2088); the probe codes fall to the
generic (:2090-2095).*

**A4 (D1 — the capacity/quota death class).** A probe (or worker turn) whose output carries the
provider's quota/capacity wire — HTTP `402`, `insufficient_quota`, rate-limit/capacity wording,
`quota`/`capacity`/`overloaded`/`limit exceeded` — classifies to the typed `provider_quota` verdict,
distinct from `provider_unreachable` and `probe_content_mismatch`, and does NOT fire the
credential-scoped `invalid_grant` invalidation. *RED at HEAD: the only wire-classified verdict is
`invalid_grant|revok` → `authentication_refresh_required` (route-liveness.mjs:243-244); a 402/capacity
output falls to `probe_content_mismatch` (:241) or `provider_unreachable` (:246) with no distinction.
The exact wire grammar is a live-receipt question (OQ2); the pin pins the CLASSIFICATION SEPARATION.*

**A5 (D3 — refuse or inform, never silently reroute).** At wave preflight, a member whose route
verdict is `failed` is refused `wave_driver_route_unready` with the typed code BEFORE any member
spawn, and the driver performs NO route substitution — `member.exact` is unchanged, no alternate route
is probed, no router advice is consumed on the member's behalf. The refusal AND the no-substitution
property are both asserted (behavior + source-scan). *RED at HEAD: RT-5/RT-5p pin the refusal; no test
pins the no-reroute property.*

---

## Verification

```text
node --test impl/test/readiness-credentials-red.test.mjs      # the landed #47 suite stays green (26/26 at HEAD)
node --test impl/test/phase78-deployment-readiness-red.test.mjs   # DP3/DP3b/DP4/DP5 stay byte-stable
node --test <the new #167 red suite>                          # A1..A5, shipped red-first
```

Then the canonical suite fully green. Post-landing live receipts: the first `baton doctor --check`
forced probe of a quota-dead route records the observed `provider_quota` wire; the first lapsed-window
read records `probedAt`/`expiresAt` age truth — each in this evidence directory, mirroring the #47
live-receipt precedent (readiness-credentials-contract.md §6).

---

## Open questions (judgment calls, recorded)

- **OQ1 — verdict vocabulary vs the landed `liveness.state`.** The roster's `liveness` tuple
  currently spells the class as `state: 'verified'|'unverified'|'failed'|'unsupported'`. This contract
  adds `verdict` (`alive|unverified|failed`) + `probedAt` as the honest projection. Judgment: keep the
  landed `liveness.state` byte-stable for back-compat (RT-6/RT-4 read it) and ADD the honest fields;
  do not rename in place. A coordinator ruling could instead rename — either satisfies A1, but the
  additive path avoids touching the green RT suite.
- **OQ2 — the quota/capacity wire grammar.** The exact 402/`insufficient_quota`/capacity matcher is
  unverified against live provider wire (the same class of unverified-wire assumption RT-14b records
  in readiness-credentials-red.test.mjs:49-52). Judgment: A4 pins the CLASSIFICATION SEPARATION with a
  fixture; the exact grammar is a live-receipt question, folded later.
- **OQ3 — re-probe cadence for a quota death.** A quota death is non-transient within a billing cycle;
  the default 10-min failure window (route-liveness.mjs:17) would re-probe a quota-dead route every 10
  minutes, each probe spending budget on a dead route. Judgment: `provider_quota` should either use a
  longer window or treat `baton doctor --check` as the primary unstick; the contract leaves the exact
  window to the deployment (configurable `failureWindowMs`) but names the operator surface as the
  primary unstick.
- **OQ4 — the `--check` wire path.** The CLI client's `doctor()` (application-cli.mjs:2213) reads
  `/readyz` + `/v1/application-card`; carrying a `check` flag requires either a new doctor command
  envelope or a query parameter on the existing read. Judgment: the contract pins the surface BEHAVIOR
  (A2); the wire shape is an implementation choice, sibling-consistent with the existing doctor reads.
- **OQ5 — `probedAt` on a failed probe.** Judgment: `probedAt` records the last probe MEASUREMENT time
  (`verifiedAt` OR `failedAt`), so a failed row still tells the operator WHEN it was measured;
  `verdict` carries the class. A coordinator ruling preferring `probedAt` = verified-only is a one-line
  change to the pin's phrasing.
- **OQ6 — the #89 registry debt (G7).** The probe's byte bounds are inline at route-liveness.mjs:18-19,
  outside `FRAME_LIMITS`. This rung introduces no new byte bound, so it adds no registry row; relocating
  the existing bounds would bump `FRAME_LIMITS_DIGEST` (limits.mjs:130-131) and touch the frame-economics
  contract — out of scope for #167's honesty rung, recorded as a follow-on debt.
