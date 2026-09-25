# Blue-team: readiness-credentials red suite — adversarial verification

(Target: `impl/test/readiness-credentials-red.test.mjs` — 21 rows: RT-1a/1b, RT-2, RT-3,
RT-4, RT-4p, RT-5, RT-5p, RT-14a/14b, RT-6..RT-9, RT-10a/10b, RT-11, RT-12, RT-13a/13b/13c,
plus fixture `impl/test/fixtures/fake-grok-credential-refresh.mjs`. Verified against the v1.0
post-fold contract `readiness-credentials-contract.md` (this directory) and `impl/src/`
ground truth — NUL-containing `application.mjs`/`coordinator.mjs`/`coordination-store.mjs`
inspected via `grep -an`/`sed -n` only, 2026-08-03. Suite run from repo root:
`node --test impl/test/readiness-credentials-red.test.mjs`, Node v25.8.0, **two consecutive
runs, identical results**.)

Verdict scale: **SOUND** = red for the named stage today, green only on a contract-correct
implementation, and a wrong implementation cannot pass it. **WEAK** = correctly staged and
discriminating in composition, but a named wrong implementation can pass it (false-green
hole). **VACUOUS** = passes without exercising the named behavior. **STAGED-WRONG** = the
row's red/green state does not track the named contract behavior (false-red on a correct
implementation, or green against its own declared stage).

## Verdict summary

| Row | Named behavior | Verdict | One-line basis |
|-----|----------------|---------|----------------|
| RT-1a | Content-verified probe → verified + receipts + F-4 evidence path | WEAK | Real teeth on tier-missing/proving-too-little, but the F-4 evidence assertion pins event-chain SHAPE only — a synthetic `evidence.mapped`/`verify.reverified` event without the digest-for-digest discipline greens it |
| RT-1b | spawned-but-not-verified / wrong-content probes are probe_failed | SOUND | `die` and `wrong` modes both force refusal + zero `probe_verified`; proving-too-little and status-trusting impls fail at :445 |
| RT-2 | never probe per call; coalescing; ≤28-min window | WEAK (one leg) | Fresh-window/cold/coalescing legs have exact-count teeth; the contract's "a stale window probes exactly once" leg has NO oracle (no clock injection) — cache-forever-after-first-probe passes |
| RT-3 | probe cost bounds | WEAK (timeout leg) | ≤1KiB prompt and ≤2KiB capture (`noisy` mode) have real teeth; the ≤120s timeout is checked only as a REPORTED `latencyMs` on a fast fixture — a probe with no kill timer passes |
| RT-4 | static/liveness separation, typed classification, sticky failure | SOUND | Separate-field assertions, three-way code classification (`invalid_grant`→`authentication_refresh_required` / `die`→`provider_unreachable` / adapter typed code), and a zero-re-probe sticky check all bite; conflation impls fail RT-4, generic-code impls fail the equalities |
| RT-4p (pin) | static substrate unchanged | SOUND | Codex orphan blocks at the real credential gate (application-deployment.mjs:1109-1114 via :952), exact summary :1123, typed refusal via assertRouteReady :1155-1162 — wrong-reason blocks yield different codes and fail |
| RT-5 | wave preflight rides the cache | SOUND | Drives the REAL wave driver (wave-driver.mjs:274-292) through a boundary facade; warm=0 probes, cold=exactly 1, provider-dead→`wave_driver_route_unready` with ≤1 probe; conflation cheats fail RT-4 upstream |
| RT-5p (pin) | existing preflight refuses static-blocked member | SOUND | Real `wave_driver_route_unready` at :285-290 on a genuinely blocked route (state pinned by RT-4p) |
| RT-14a | probe-sourced invalid_grant fans out over credentialKey | WEAK | Core join has teeth (per-route keys fail the shared-key equality; missing fan-out fails row B), but NO negative control — an invalidate-ALL-routes impl (a claude route dies when grok's token dies) passes |
| RT-14b | worker-turn invalid_grant fans out the same way | WEAK | Same missing negative control; detection grammar is the header's declared UNVERIFIED wire-shape assumption (propagation pinned, detection not) |
| RT-6 | roster closed document | SOUND (one bound untested) | Closed doc keys, closed row keys, vocabulary, learning-null, observations deep-equal to `routeObservations()`; the "bounded tail" truncation bound itself is unexercised (fixture has ~0 observations; only a 16MiB doc cap) |
| RT-7 | occupancy truth from `_inFlightCount` | SOUND (attribution note) | Real 3-seat differential against `coordinator._inFlightCount('grok')` (:2816-2823) + caller-supplied-inFlight override attempt + source pin; per-route-vs-per-vendor attribution for the sibling HIGH row unpinned |
| RT-8 | sanitization + F-5 sanitizer identity | WEAK (source-pin breadth) | Canary content scan (card description + objective + `/Users/`) has real teeth; the F-5 source pin accepts only `publicRouteRuntime` or `/publicRoster[A-Za-z]*/` — a contract-compliant "stated named sibling" outside that pattern false-reds |
| RT-9 | registration, provenance, no doctor/roster drift | STAGED-WRONG (composition with RT-6) | Requires `"routingMutationAuthority":false`/`"workerAuthority":false` in the serialized DOCUMENT; RT-6 closes doc keys to 4 and row keys to 8, leaving no contract-sanctioned home for them (the contract assigns provenance to the OPERATION's envelope, §4.2.2) — a contract-literal implementation false-reds one of the two rows |
| RT-10a | grok harvest from the vendor-native write-back target | WEAK (two staging defects) | Harvest/spawn-count/F-3-shape assertions have real teeth via the fixture's independent observation, but :910-913 `readFileSync(src/grok-credential-cache.mjs)` throws on the header-sanctioned re-export home (false red), and the `.credentials.json` absence scan trips on COMMENTS naming the claude convention |
| RT-10b | invalid_grant latch; explicit-only persist | SOUND | Sibling-exact API (`explicitRefresh` claude-credential-cache.mjs:348-351, metadata vocabulary :236-254, mock envelope honored at :315/:329); latch-absence (spawns 2≠1) and consent-violation (persists>0) both fail |
| RT-11 | single-flight + mtime-CAS + lockfile | WEAK (same home defect) | 32-way coalescing, mid-flight abort (adopts `access-midflight-7000`, never `access-runtime-9000`), and `authentication_refresh_locked` all have teeth; :997 repeats the readFileSync false-red on the re-export home |
| RT-12 | access-token-only worker projection | WEAK (named scan vacuous) | `projectionEnv()` half has teeth; the named projection-TREE scan is vacuous in composition — the suite wires `credentialFiles: {}` and only the env channel, while grok's real worker projection is file-based (`defaultCredentialProjection`, application-deployment.mjs:604-608, copies `~/.grok/auth.json` wholesale, refresh_token included, TODAY) — the exact token-widening hole greens the row |
| RT-13a | deployment wiring + doctor corrective action | SOUND (minor shallowness) | Red honestly on the closed `advanced` list (:1547); wrong code fails, latch-to-doctor propagation pinned; remedy assertion requires only `/grok login/i` presence anywhere in the row JSON (mixed-remedy rows pass — compensated by RT-13c at source) |
| RT-13b (pin) | kimi tombstone exactness | WEAK | Source-slice presence checks cannot see the conjunction: flipping `&&`→`||` between the four tombstone conditions (promoting a partial record to revoked — the exact bug RT-13 names) keeps every asserted string and passes |
| RT-13c (pin) | per-vendor remedy; guidance stays agnostic | SOUND | Claude half is BEHAVIORAL (executes the exported `claudeAuthenticationSummary`); grok/kimi remedy strings pinned in their pure-text builders; guidance regex captures the one `authentication_refresh_required` block (application-semantics.mjs:1953) and it is vendor-agnostic. Cosmetic: the message cites :1888, actual :1946 |

Observed split (two runs, identical): **17 red / 4 green** (pins RT-4p, RT-5p, RT-13b,
RT-13c). The suite header declares no numeric split; the measured split matches the
tasking's verified 17/4. **Every red row fails at its named stage** — RT-1a :394 (0 probe
invocations), RT-1b :445 (unrefused spawn), RT-2 :467 (0≠1 probes), RT-3 :501 (0 probes),
RT-4 :536 (`liveness.state` null≠`unverified`), RT-5 :607 (0≠1), RT-14a :665 / RT-14b :704
(route liveness null≠`verified`), RT-6 :735 / RT-7 :779 / RT-8 :814 (no `fleet.roster()`),
RT-9 :841 (`fleet_roster` absent from the advanced block), RT-10a :887 / RT-10b :918 /
RT-11 :951 / RT-12 :1003 (`GrokCredentialCache` resolves null), RT-13a :1045
(`deployment_config_invalid: advanced contains unsupported field grokCredentials`). Absence
greps confirm zero occurrences of `GrokCredentialCache`, `fleet_roster`, `fleetRoster`,
`grokCredentials`, `readiness.probe`, `probe_verified`, `probe_failed`, `credentialKey`
across `impl/src/` — the "machinery missing" stage is honest; the only `liveness` hits are
unrelated domains (npm-proposal-resolver, wave-driver comments, result-export).

## Closing verdict

**GATE-NOT-READY.** The red stage is honest (17/17 at named stages, no harness bug in the
red half), the fixture is hermetic and deterministic in composition, and the four pins are
green for real reasons. But one row's named acceptance is vacuous against the hole it
exists to catch (RT-12 file-channel token-widening), one row pair is mutually ungreenable
on a contract-literal reading (RT-6×RT-9 provenance home), two rows false-red on a
suite-sanctioned implementation home (RT-10a/RT-11 module pins), the epic's keystone fold
(RT-14) cannot distinguish credential-scoped fan-out from invalidate-everything, the
fixture can clobber a developer's real `~/.grok/auth.json` when run against a broken
implementation, and eight contract requirements have no oracle. Blocking items in §6.

---

## 1. Fixture authority — `fake-grok-credential-refresh.mjs`

Verified by direct execution in a sandboxed HOME (not just source reading):

- **Inert by default.** Without `--baton-grok-refresh-fixture` → exit 0, silent (so
  `node --test` discovery over `impl/test/` executes it harmlessly). With the gate but HOME
  unset → exit 0, silent. Verified live.
- **Hermetic in composition.** Imports only `node:fs`/`node:path` — no keychain
  (`/usr/bin/security`), no network, no `child_process`. With a sandbox HOME it writes
  exactly three files, all inside the sandbox: `dirname(HOME)/fixture-spawns` (counter),
  `dirname(HOME)/fixture-writeback.json` (the independent observation:
  `{projectedGrokTree, flatClaudeSibling, target}`), and `HOME/.grok/auth.json`. Verified
  live (`find` over the sandbox).
- **Deterministic.** Fixed tokens (`access-fresher-9000`/`refresh-fresher-9000`), fixed
  `expires_at: 2099-01-01`; the counter increments 1→2 across runs; `--revoke` exits 1 with
  the `invalid_grant` wire text on stderr. Verified live. No wall-clock, no randomness.
- **Cleanup.** The fixture intentionally leaves its observation files (they are the rows'
  oracle input); the suite's `test.after` (`:69`) `rm -rf`s every tmpdir it minted. No
  module-level/global state.
- **Location assumption (undeclared but sibling-consistent).** RT-10a/RT-11 read
  `join(root, 'refresh', 'fixture-spawns')`, i.e. they assume `dirname(HOME) ===` the
  cache's `refreshRoot` option — the throwaway HOME must be a CHILD of `refreshRoot`. This
  matches the claude sibling (`join(this.refreshRoot, pid-random)`,
  claude-credential-cache.mjs:291) but the header does not say so.

Two defects, one blocking:

1. **BLOCKING (safety): the fixture trusts HOME blindly.** It writes
   `join(HOME, '.grok', 'auth.json')` with fake tokens and no confinement check. A red-first
   suite runs against WRONG implementations by design; an early implementation that spawns
   the fixture without scoping HOME (the exact F-3 bug class) makes the fixture overwrite
   the developer's REAL `~/.grok/auth.json` with `access-fresher-9000`, destroying the
   operator credential. Fix: refuse to run unless a marker env is set
   (`BATON_GROK_FIXTURE_HOME=1`) or `HOME` resolves under `os.tmpdir()` — belt and braces
   cost two lines.
2. **Non-blocking (precision):** `writeFileSync(grokPath, …, { mode: 0o600 })` applies the
   mode only on creation; in the real flow the runtime pre-projects `auth.json`, so the
   fixture overwrites it and the mode is a no-op (observed 0644 on a pre-existing file in
   the sandbox). The runtime owns projection modes (the claude sibling writes 0600,
   claude-credential-cache.mjs:123) — note only, no fix required.

## 2. Coverage ledger — contract requirements vs rows

### #47 D1 (§4.1, RT-1..RT-5, RT-14)

| Contract requirement | Row | Effective? |
|---|---|---|
| §4.1.1 content-verified verdict; bare `lifecycle.spawned` is not proof | RT-1a/RT-1b | YES |
| §4.1.1 typed receipts (`readiness.probe_verified`/`_failed` + provider_call-class) | RT-1a/RT-1b | YES |
| §4.1.1 failure classification (invalid_grant / network / adapter typed code) | RT-4 | YES |
| Fold F-4 shared `verify.reverified` evidence path | RT-1a | PARTIAL — chain shape pinned; digest-for-digest binding (coordination-store.mjs:3378-3381) NOT asserted |
| §4.1.2 prompt ≤1KiB / capture ≤2KiB / one call, no retry | RT-3 | YES |
| §4.1.2 timeout ≤120s ENFORCEMENT | — | **NO ORACLE** (only reported `latencyMs` checked) |
| §4.1.2 probe single-flight (storm coalescing) | RT-2 | YES (8 concurrent → 1) |
| §4.1.3 tuple carries credentialKey | RT-1a/RT-6 | YES |
| §4.1.3 fresh window → no probe; cold → one probe | RT-2 | YES |
| §4.1.3 **stale window → exactly one re-probe** (RT-2 acceptance text) | — | **NO ORACLE** (no deployment clock injection; cache-forever passes) |
| §4.1.3 failed sticky window → no re-probe; explicit unstick | RT-4 (sticky half) | PARTIAL — `baton doctor --check` unstick path has no row |
| §4.1.3 credential-scoped invalidation (fold F-1), probe- and worker-sourced | RT-14a/RT-14b | PARTIAL — fan-out pinned; NO negative control (unrelated-credential route must stay verified) |
| §4.1.3 TTL defaults: grok ≤28min | RT-2 | YES; claude ≤4.4h and static-key long windows: NO ROW |
| §4.1.3 wave-driver preflight consumer (RT-5) | RT-5 | YES (real wave driver) |
| §4.1.4 static/liveness separation; advisory≠refused; failed refuses typed | RT-4 + RT-4p | YES |
| §4.1.1 red-team: probe-side-effect (probe read-only against store/learning) | — | **NO ROW** |
| §4.1.4 red-team: auto-heal-overreach | RT-4/RT-10b (composition) | PARTIAL (no-persist pinned; no explicit no-auto-relogin row) |

### #83 D2 (§4.2, RT-6..RT-9)

| Contract requirement | Row | Effective? |
|---|---|---|
| §4.2.1 closed document shape (schemaVersion, observedAt, closed row keys) | RT-6 | YES |
| §4.2.1 learning = router bucket projection (winRate/weight/seededFrom/mode) | RT-6 (null half) | PARTIAL — **no populated-bucket row**; honest-empty pinned, real projection not |
| §4.2.1 occupancy from coordinator seats, never caller-supplied | RT-7 | YES (+ source pin) |
| §4.2.1 sanitization + fold F-5 named sanitizer | RT-8 | YES, with the source-pin breadth caveat (§4) |
| §4.2.1 observations bounded TAIL | RT-6 (16MiB doc cap only) | **NO** — truncation bound unexercised |
| §4.2.2 doctor rows gain liveness + occupancy (+learning) | RT-4/RT-9 (liveness) | PARTIAL — **occupancy on doctor rows: NO ROW** |
| §4.2.2 `fleet_roster` in the ordinary plane advanced `fleet_*` family (fold F-2) | RT-9 | YES (source regex over application-semantics.mjs:1097-1102) |
| §4.2.2 provenance precedent (`routingMutationAuthority`/`workerAuthority` false) | RT-9 | CONFLICTED — see §4/§5 (document vs operation envelope) |
| §4.2.2 one projection function, no cross-surface drift | RT-9 | YES (deepEqual static + liveness) |
| §4.2.2 MCP/reflex row | — | NO ROW — deferred to the packaging epic (deliberate, mirrors the bidirectional-v3 precedent) |

### #84 D3 (§4.3, RT-10..RT-13)

| Contract requirement | Row | Effective? |
|---|---|---|
| §4.3.1 harvest adopts strictly fresher schema-valid write-back | RT-10a | YES (fresher half); **staler-candidate rejection: NO ROW** |
| §4.3.1 schema GATE (invalid candidate refused) | — | **NO ROW** (fixture has no invalid-schema mode) |
| §4.3.1 vendor-executed refresh + fold F-3 write-back target | RT-10a | YES (fixture independently observes the tree) |
| §4.3.1 revocation latch, no re-probe, `expired_needs_login` | RT-10b | YES |
| §4.3.1 explicit-command-only persist (consent) | RT-10b | YES (behavioral, stronger than the contract's source-scan) |
| §4.3.1 single-flight; mtime-CAS; advisory lockfile | RT-11 | YES |
| §4.3.1 access-token-only worker projection (RT-12) | RT-12 | PARTIAL — env channel YES; **file channel (grok's native) VACUOUS** (§4) |
| §4.3.2 formalized runtime envelope `{ok, invalidGrant, runtimeCredential, writeBackTarget}`; typed `authentication_refresh_timeout` | — | **NO ROW** |
| §4.3.3 deployment wiring + doctor block + grok remedy | RT-13a | YES |
| §4.3.3 kimi tombstone exactness | RT-13b (pin) | PARTIAL (source-grep; conjunction blind, §3) |
| §4.3.3 per-vendor remedy; `PROVIDER_TERMINAL_GUIDANCE` agnostic | RT-13c (pin) | YES |
| §4.3.3 probe/worker verdict → controller LATCH (deployment-level propagation) | — | **NO ROW** (RT-10b latches in isolation; RT-14a/b check liveness rows; the probe→latch wire is untested) |
| §6 live dogfood receipts | — | N/A (post-landing, operator-gated) |

## 3. FALSE-GREEN hunt — the four passing pins

**RT-4p (SOUND).** Two-route fixture: grok/low ready with the exact static summary
(application-deployment.mjs:1123), codex orphan blocked `authentication_required` at the
real credential gate (:1109-1114 — the card's `providerCompatibility.credentialState:
'absent'` surfaces as `runtime.authentication.state` via :952), and `assertRouteReady`
(:1155-1162) refuses the gated spawn with the typed code. Wrong-reason blocks
(`route_unavailable`/`route_ambiguous`) carry different codes and fail the equalities, so
the pin cannot pass for the wrong reason. It also cannot mask the tier: it never touches
`liveness`, so it stays green when the tier lands — additive, as named.

**RT-5p (SOUND).** Drives the real wave driver (`createWaveDriver`, wave-driver.mjs:274-292)
with a boundary facade whose `waves.start` throws `fixture_preflight_passed` — so the
`wave_driver_route_unready` outcome at :285-290 is attributable to the preflight refusal,
not to wave execution. The route's blocked state is itself pinned by RT-4p, closing the
"refused for the wrong reason" escape.

**RT-13b (WEAK).** Source-slice pin over `kimiAuthenticationState`→`grokAuthenticationSummary`.
It verifies the four cleared-field conditions exist, the tombstone is recognized BEFORE the
generic gate (indexOf ordering — matches the real code, application-deployment.mjs:365 vs
:377), and both terminal codes appear. But the four conditions are asserted as INDEPENDENT
substrings: an implementation that re-joins them with `||` — promoting a partial/corrupt
record to `revoked`, the exact tombstone-misdiagnosis RT-13 names — keeps every asserted
string and passes. One-line fix: assert the conjoined literals (they sit on single lines,
`value.access_token === '' && value.refresh_token === ''` at :366 and
`value.expires_at === 0 && value.expires_in === 0` at :367).

**RT-13c (SOUND).** The claude half is behavioral — it executes the exported
`claudeAuthenticationSummary('authentication_refresh_required')` and matches the real text
(:328-336). The grok/kimi halves grep pure-text builders (`grok login` at :400-408; `` `kimi`
login flow `` at :318-326) — a remedy swap drops the match and fails. The guidance regex
captures the file's only `authentication_refresh_required:` block
(application-semantics.mjs:1953, inside `PROVIDER_TERMINAL_GUIDANCE` :1946) and it is
vendor-agnostic. Cosmetic only: the assertion message cites :1888; the constant moved to
:1946.

## 4. Teeth check — the seventeen red rows

For each: would the plausible wrong implementations (credential leak into logs/frames,
clock-based gate, secret in payloads, unscoped credentialKey, missing fan-out,
shallow-but-compliant) actually fail it?

- **RT-1a (WEAK, F-4 half).** Tier-missing, per-call probing, and adapter-self-report impls
  all fail (probe count, RT-1b composition). The fold F-4 assertions require
  `record.verificationEvidence.coordinationSeq` to resolve to an `evidence.mapped` event
  whose payload is `verify.reverified` — a bespoke verifier that never touches the shared
  evidence path fails. But a compliant-but-shallow impl that MINTS a synthetic
  `evidence.mapped`/`verify.reverified` event with no digest-for-digest binding and no
  operational-source re-read (coordination-store.mjs:3378-3381) greens the row: the
  assertions check the chain's shape, never the digests. Fix: assert the evidence payload's
  digest binds the probe turn's receipt (digest-for-digest), not just the event kinds.
- **RT-1b (SOUND).** Both failure modes force refusal AND zero `probe_verified`; a
  status-trusting or spawn-counting impl greens `probe_verified` in `die`/`wrong` mode and
  fails. No named wrong implementation survives.
- **RT-2 (WEAK, stale leg).** Exact-count assertions kill per-call probing (fresh loop
  holds at 1) and missing single-flight (8 concurrent → 1). The contract's own acceptance
  leg — "a stale window probes exactly once" — has no oracle anywhere in the suite (no
  clock injection at the deployment seam): a cache-forever impl that never re-probes after
  the first window passes every count. The ≤28-min window assertion (doctor-row
  `expiresAt − verifiedAt`) does bound the default TTL, which partially compensates.
- **RT-3 (WEAK, timeout leg).** The ≤1KiB prompt and ≤2KiB capture (`noisy` mode places the
  pin beyond the bound; an unbounded-capture impl verifies and fails the refusal) have real
  teeth; the one-call/no-retry count is exact. The ≤120s timeout is asserted only as a
  REPORTED `latencyMs` on a fixture that completes in milliseconds — a probe with no kill
  timer reports a small number and passes. Enforcement needs a hanging-probe fixture with
  an injected clock.
- **RT-4 (SOUND).** State-conflation impls fail the separate-field assertions; generic-code
  impls fail the three typed equalities; re-probe-on-failure impls fail the sticky count;
  a missing vendor remedy fails `/grok login/i`. The classification matrix
  (`invalid_grant`→`authentication_refresh_required`, `die`→`provider_unreachable`,
  adapter→typed code) is exactly §4.1.1's taxonomy.
- **RT-5 (SOUND).** Preflight-per-member probing fails the warm count (1); never-consulting
  fails the cold exact-1; a provider-dead route must fail the wave with the existing typed
  code at ≤1 probe. Drives the real wave driver, and the conflation escape (making
  static.state blocked on liveness failure) is closed by RT-4 upstream.
- **RT-14a / RT-14b (WEAK, missing negative control).** Unscoped credentialKey (per-route
  keys) fails the A-key===B-key equality; missing fan-out fails row B; a re-probe storm
  fails the probes-before/after equality. But an implementation that invalidates EVERY
  liveness row on any `invalid_grant` — killing a claude route when grok's token dies, a
  direct violation of "every row SHARING that credentialKey" — passes both rows: the
  fixture contains only one credential identity (two grok effort variants on one adapter).
  Fix: add a third route on a second credential (e.g., a claude fixture route) asserted to
  stay `verified`. RT-14b additionally rides the header's declared UNVERIFIED wire-shape
  assumption (worker-turn `invalid_grant` in failed output; the only `invalid_grant`
  handling in `impl/src` today is the refresh-runtime matcher, claude-credential-cache.mjs
  :149/:317 — no worker-turn detection exists) — honestly flagged in the header; the live
  receipt must confirm the grammar.
- **RT-6 (SOUND, bound untested).** Closed-set assertions fail additive-field impls;
  fabricated-prior impls fail `learning: null`; the observations deep-equal binds the
  projection to `routeObservations()`. The "bounded tail" bound itself is unexercised
  (fixture mints ~0 observations; the 16MiB cap is decorative at that scale).
- **RT-7 (SOUND, attribution note).** A real 3-seat differential against the coordinator's
  `_inFlightCount` (:2816-2823), a caller-supplied-`inFlight: 99` override attempt, and the
  contract-sanctioned source pin. Note: with two routes on one vendor the row pins the
  VENDOR count on the LOW row and leaves the HIGH row's attribution unconstrained — a
  per-route double-counting impl passes. The contract's projection shape doesn't resolve
  this either; worth one clarifying line in the contract.
- **RT-8 (WEAK, source-pin breadth).** The canary scan has real teeth (a verbatim-`description`
  projector or brief-echoing roster fails on three independent needles). The F-5 half
  accepts `publicRouteRuntime` or `/publicRoster[A-Za-z]*/` only; the contract's text is "or
  a stated named sibling" — a compliant sibling named e.g. `publicFleetProjection`
  false-reds. Fix: accept `/public[A-Z][A-Za-z]*/` with a stated-name assertion, or have the
  contract enumerate acceptable names.
- **RT-9 (STAGED-WRONG in composition with RT-6).** Registration regex and drift deepEquals
  are fine. The provenance assertions require `"routingMutationAuthority":false` and
  `"workerAuthority":false` in the serialized DOCUMENT — but RT-6 closes the document to
  exactly `{schemaVersion, observedAt, routes, observations}` and every row to exactly
  `{harness, model, effort, provider, static, liveness, occupancy, learning}`. The only
  remaining home is inside a sub-object (`liveness`/`occupancy`/…), which the contract
  never describes — the contract assigns these fields to the fleet_roster OPERATION's
  provenance (§4.2.2: "Its … provenance fields are a new precedent in that plane", the
  route.advice-envelope analogy). A contract-literal implementation (provenance on the
  capability registration, document per §4.2.1's shape) false-reds RT-9; one that puts
  provenance top-level false-reds RT-6. Fix: scope RT-9's provenance assertions to the
  capability registration surface, or amend contract+suite to state the provenance's
  document home and relax one closed set.
- **RT-10a (WEAK, two staging defects).** The behavioral core has real teeth, exercised
  through the fixture's INDEPENDENT observation (not the runtime's self-report): a
  fabricating controller (never spawns the vendor CLI) fails the `fixture-spawns` read; a
  flat-sibling port fails `flatClaudeSibling === false` and `projectedGrokTree === true`;
  non-adopting harvests fail the fresher-token assertion. Defect 1: :910-913 unconditionally
  `readFileSync(src/grok-credential-cache.mjs)` — the header says the class may live in
  `grok-credential-cache.mjs` OR be re-exported from `application-deployment.mjs` ("either
  home satisfies the row"), but under the re-export home this read throws ENOENT → false
  red after a fully correct implementation. Defect 2: the `.credentials.json` absence scan
  is raw-text — a module COMMENT explaining the F-3 distinction by naming the claude
  convention trips it. Also missing (coverage): schema-gate and staler-candidate negatives
  — the fixture only ever writes a fresher, schema-valid candidate.
- **RT-10b (SOUND).** The suite's mock envelope (`{invalidGrant: true}` / `{candidate: …}`)
  is honored by the sibling implementation (:315, :329-331), and `explicitRefresh` (:348),
  `metadata().state` (:236-254), and the persist seam (:196/:340) are the exact claude
  vocabulary. Latch-absence (second refresh spawns a second runtime), wrong terminal code,
  auto-persist, and persist-on-automatic-path all fail. The contract's source-scan
  acceptance (RT-10c) is exceeded behaviorally.
- **RT-11 (WEAK, home defect only).** 32-way coalescing → exactly 1 vendor spawn; the CAS
  half forces adoption of the mid-flight operator value (`access-midflight-7000`, 2027)
  over the fresher runtime candidate (`access-runtime-9000`, 2028) — a CAS-less impl adopts
  the wrong one and fails both the adoption and the `projectionEnv` exclusion; the lockfile
  half pins `authentication_refresh_locked` against a pre-held lock and the `O_EXCL` seam
  (sibling :98-119). Same :997 readFileSync false-red as RT-10a on the re-export home.
- **RT-12 (WEAK — the named scan is vacuous).** `projectionEnv()` excluding the refresh
  token while including the access token has teeth. But the row's own named acceptance is
  "a projection-tree scan proves no projected worker FILE contains the cache's
  refresh-token bytes (the #11 CC-4 pin)" — and the suite wires the `RuntimeIsolation` with
  `credentialFiles: {}` and only `credentialEnv` (the claude channel). Grok's real worker
  projection is FILE-based: `defaultCredentialProjection` (application-deployment.mjs:
  604-608) copies `~/.grok/auth.json` — refresh_token included — into every grok worker
  tree TODAY. An implementation that lands the cache, greens RT-12 via the env channel, and
  leaves the file channel widened ships the exact token-widening hole §4.3.1 forbids, with
  a green test. Fix: have the cache expose its file-projection surface (projected
  `.grok/auth.json` tree), wire THAT into the isolation fixture, and scan the projected
  files; keep the env half.
- **RT-13a (SOUND, minor shallowness).** Red honestly on the closed `advanced` list
  (:1547). The `credentials.refresh('grok')` seam is sibling-consistent (the facade's
  `credentials.refresh` exists and today throws `credential_refresh_unavailable` for
  non-claude, :1237-1247). Wrong code fails; missing doctor finding fails; remedy assertion
  is presence-only over the row JSON (a mixed all-vendors remedy block passes) — direction
  compensated by RT-13c at the source. Acceptable.

## 5. Drift findings — suite-chosen seams vs contract-adopted names

1. **`deployment.fleet.roster()` is unadopted surface (four rows hang on it).** The
   contract adopts the CLI `baton fleet roster` and the `fleet_roster` capability; no
   facade spelling. The suite reads `deployment.fleet.roster()` (header: "sibling of
   `waves.start`" — verified the facade has `waves` at application-deployment.mjs:1219).
   An implementation exposing only the contract-named surfaces false-reds RT-6/7/8/9. The
   bidirectional-v3 precedent (C3's `messageReceipt`) treated exactly this as a blocking
   contract-adoption item. Fix: the contract adopts `fleet.roster()`, or the rows read the
   capability plane.
2. **"Either home satisfies the row" is false for RT-10a/RT-11.** Header-sanctioned
   re-export home false-reds on the unconditional `grok-credential-cache.mjs` source reads
   (:910, :997). Fix: resolve the source path from wherever `resolveGrokCredentialCache()`
   found the class, or skip the source pins when the dedicated module is absent.
3. **`advanced.grokCredentials` — sibling-consistent, SOUND.** Verified against the closed
   `advanced` list (:1547, which is exactly why RT-13a reds honestly) and the
   `claudeCredentials` validation block (:1602-1642). The INNER option vocabulary is
   undeclared; RT-13a exercises only `{refreshRuntime}`. Header should say the accepted
   fields mirror claude's.
4. **Probe-on-real-adapter seam — declared and contract-consistent.** The fixture detects
   probe turns by `/probe/i` and parses the expected line out of the contract's pinned
   instruction phrasing ("Reply with exactly one line: `<route>-probe ok`"); an
   implementation phrasing the instruction differently gets the fallback line and
   false-reds. The contract pins that phrasing as its example and the header declares the
   parsing — acceptable, worth one sentence in the contract making the phrasing normative.
5. **RT-14b wire-shape assumption — honestly declared UNVERIFIED** in the suite header;
   the matcher class it cites (claude-credential-cache.mjs:149) is the refresh-runtime
   matcher, and no worker-turn `invalid_grant` detection exists in `impl/src` today. The
   assumption shapes surface the contract never spells out; the live dogfood receipt (§6 of
   the contract) must confirm it.
6. **Undeclared but sibling-exact cache vocabulary.** `GrokCredentialCache.open` options
   (`credentialPath`, `refreshRoot`, `now`, `fileRead`, `fileProbe`, `refreshRuntime`,
   `persist`, `lockPath`, `lockTimeoutMs`, `lockPollMs`, `cmd`, `cmdArgs`), the
   `explicitRefresh()` method, the `metadata()` state vocabulary, and the mock runtime
   envelope (`{invalidGrant}`/`{candidate}`) all verified field-for-field against
   `ClaudeCredentialCache` (:180-199, :236-254, :315, :329, :348). Not drift — but the
   header names only four seams; implementers must read the suite to learn the rest. One
   doc note: the contract's §4.3.2 envelope enumeration omits `candidate`, which the landed
   claude code honors (:329) and the suite exercises — the contract should record it.
7. **Contract-side citation drift (informational, contract fixes — not suite blockers):**
   - `PROVIDER_TERMINAL_GUIDANCE` cited as application-semantics.mjs:1888 — actual :1946
     (RT-13c's message repeats :1888).
   - `_inFlightCount` cited as coordinator.mjs:2800-2806 — actual definition :2816-2823
     (call sites :2705, :2762; the "feeding inFlight at :2745-2747" cite → :2762).
   - The `fleet_*` family cited as application-semantics.mjs:1099-1100 — actual :1099-1101.
   - §1.2's claim that the wave-driver preflight "calls `baton.doctor()` per member" and
     that "a 64-member wave can therefore fan 64 doctor reads" is factually wrong against
     wave-driver.mjs:274-292 — `doctor()` is called ONCE per `run()`. Harmless to the suite
     (RT-5 gates probe counts, not doctor reads), but the cost premise behind §4.1.3's
     "first bounded consumer" is overstated and should be corrected in the contract.
   - runtime-isolation.mjs:64-66/:74/:81 (fold F-3 anchors) — verified exact.

**Split reconciliation.** The header claims no numeric split; the measured 17 red / 4
green (two runs, identical) matches the tasking's verified split exactly. No divergent
tests; no legitimate-already-implemented rows; no false greens among the pins beyond the
WEAK verdicts recorded above.

## 6. Blocking items (GATE-NOT-READY)

1. **Fixture HOME confinement (safety).** `fake-grok-credential-refresh.mjs` writes
   `HOME/.grok/auth.json` with no confinement check; against a wrong implementation that
   fails to scope HOME (the exact F-3 bug class the suite exists to catch) it overwrites
   the developer's real `~/.grok/auth.json` with fake tokens. Fix: before any write, refuse
   unless a marker env (e.g. `BATON_GROK_FIXTURE=1`) is present AND `HOME` resolves under
   `os.tmpdir()`; exit 0 silently otherwise (the inert-discovery behavior already
   established).
2. **RT-12: wire the file channel.** The named projection-tree scan is vacuous as composed
   (`credentialFiles: {}`, env-only) while grok's real worker projection copies
   `~/.grok/auth.json` wholesale (application-deployment.mjs:604-608). Fix: expose the
   cache's file-projection surface (projected `.grok/auth.json` tree), pass it to the
   `RuntimeIsolation` fixture via `credentialFiles`/an equivalent seam, and assert the
   projected FILES carry the access token and never the refresh-token bytes.
3. **RT-6 × RT-9 provenance conflict.** Decide where `routingMutationAuthority: false` /
   `workerAuthority: false` live. Contract-literal reading: the fleet_roster OPERATION's
   registration envelope (then RT-9 must assert on the capability registration, not the
   serialized document). Document reading: amend the contract's §4.2.1 shape and relax one
   of RT-6's closed sets. As written, no implementation greens both rows.
4. **RT-10a/RT-11 module-home false-red.** Resolve the source pin to the class's actual
   home (or guard it on the dedicated module existing) so the header-sanctioned re-export
   home greens; and make the `.credentials.json` absence scan comment-tolerant (strip
   comments or assert on the write-back path expression, not raw text).
5. **RT-14 negative control.** Add a route on a SECOND credential identity (e.g., a claude
   fixture route) to RT-14a/RT-14b, asserted to stay `verified` through the grok
   `invalid_grant` — otherwise invalidate-everything greens the epic's keystone fold (F-1).
6. **Contract adoption of suite surface.** Adopt `deployment.fleet.roster()` (or repoint
   the rows at the capability plane), record the `candidate` field in the §4.3.2 envelope,
   make the probe instruction phrasing normative, and correct the stale citations
   (PROVIDER_TERMINAL_GUIDANCE :1946; `_inFlightCount` :2816; the wave-driver
   doctor-per-member premise).
7. **Coverage rows to add (contract requirements with no oracle).** (a) Stale-window
   re-probe (RT-2's own acceptance leg) via a clock-injected deployment seam; (b) probe
   timeout ENFORCEMENT (hanging-probe fixture, injected clock — §4.1.2); (c) populated
   learning bucket projection (§4.2.1 winRate/weight/seededFrom/mode) and the bounded
   observations tail; (d) occupancy on DOCTOR rows (§4.2.2); (e) schema-gate and
   staler-candidate negatives for the grok harvest (§4.3.1); (f) probe/worker verdict →
   controller LATCH at the deployment level (§4.3.3 — currently only liveness rows and the
   isolated cache are pinned); (g) the §4.3.2 shared runtime envelope + typed
   `authentication_refresh_timeout`; (h) probe read-only side-effect assertion (§4.1.1
   red-team target — route observations/router state unchanged across a probe).

## Appendix — verification record

- Suite: `node --test impl/test/readiness-credentials-red.test.mjs` from repo root, Node
  v25.8.0 — two consecutive runs, identical: 21 tests, 4 pass (RT-4p, RT-5p, RT-13b,
  RT-13c) / 17 fail; exit code 1; failure line+message per red row as listed in the summary
  (each at its named stage).
- Absence greps (zero hits across `impl/src/`): `GrokCredentialCache`, `fleet_roster`,
  `fleetRoster`, `grokCredentials`, `readiness.probe`, `probe_verified`, `probe_failed`,
  `credentialKey`. `liveness` hits are unrelated (npm-proposal-resolver, wave-driver,
  result-export, worktree, coordinator comments).
- Fixture live-run (sandboxed HOME, since removed): no-gate → exit 0 silent; HOME-unset →
  exit 0 silent; gated → writes `fixture-spawns` (=1, =2 on re-run),
  `fixture-writeback.json` (`{"projectedGrokTree":true,"flatClaudeSibling":false,"target":
  "…/home/.grok/auth.json"}`), fresher `auth.json`; `--revoke` → stderr `invalid_grant`,
  exit 1. No writes outside the sandbox.
- Source anchors: static gates application-deployment.mjs:1109-1124 (summary :1123);
  `assertRouteReady` :1155-1162; `advanced` closed list :1547; `claudeCredentials`
  validation :1602-1642; facade `credentials.refresh` :1237-1247; facade `waves` :1219;
  `defaultCredentialProjection` grok file channel :604-608; `grokAuthenticationSummary`
  :400-408; kimi tombstone :360-380 (conjunctions :366-367, ordering :365<:377);
  `PROVIDER_TERMINAL_GUIDANCE` application-semantics.mjs:1946 (`authentication_refresh_required`
  :1953); advanced `fleet_*` family application-semantics.mjs:1097-1102;
  `ClaudeCredentialCache` options claude-credential-cache.mjs:180-199, envelope :147-152,
  `candidate` honored :329, latch :315-317, `explicitRefresh` :348-351, metadata :236-254,
  lock :98-119, refreshRoot child dir :291; wave-driver preflight wave-driver.mjs:274-292
  (one `doctor()` per run); `_inFlightCount` coordinator.mjs:2816-2823 (grep -an only, NUL
  file); `RuntimeIsolation.create` grok tree runtime-isolation.mjs:64-66, `env.HOME` :74,
  `GROK_HOME` :81, `credentialEnv` projection :104-112.
- No `impl/` files were edited; the suite, contract, and fixture are untouched. This report
  is the only write.
