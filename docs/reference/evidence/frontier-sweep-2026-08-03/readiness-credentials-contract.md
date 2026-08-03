# Readiness + Roster + Credential Controllers epic contract — #47 + #83 + #84 (v1.0, post-red-team fold)

**Fold header:** folded against `readiness-redteam.md` (this directory) on **2026-08-03** —
3 CONFIRMED-HOLEs rewritten in place, 4 NEEDS-AMENDMENTs applied, 6 DEFENDED verdicts noted;
numbered fold trail in §8.

(One feature three ways — **the controller keeps seats alive, the tier measures their
liveness, the roster projects both.** Red-teamed by the adversarial fleet per the campaign
methodology; v1.0 is the post-red-team shape — every verdict from readiness-redteam.md is
folded into the decisions below and recorded in §8 for traceability.
Spec-authoring only; the sole write target is this file. All file:line citations verified
with `grep -an` / `sed -n` at drafting time, and again at fold time, on the swept tree.)

---

## 0. The seed (why this epic exists)

The sweep's Lane C (frontier-sweep.md:50-58) is three issues that are **one feature**:

- **#47 — bounded actual-inference readiness tier per route.** Every provider failure this
  campaign has hit was discovered **at turn time** — "claude OAuth TTL rotation ×3 and a 401
  revocation mid-wave; grok's token dying 28 minutes after an interactive login; kimi's
  thinking option absent from its ACP surface; codex's monthly usage cap discovered at turn
  time; GLM's 529 era" (setup-token-decisions.md:112-116). Projection and doctor are
  **static-only**: the credential file looks ready, so the route reports `ready`, and the
  provider eats the first real turn. The tier adds a **bounded, cached, actual-inference
  probe** per route so "provider-alive" is a measured state, not an assumption.
- **#83 — fleet.roster.** A seat inventory that projects **routes × liveness × occupancy ×
  route-learning observations**. The store already keeps `routePolicy`/`routeObservations`
  (coordination-store.mjs:653-656, 1083, 11114); the router already keeps adaptive buckets
  (router.mjs:358-373); the coordinator already counts in-flight seats
  (coordinator.mjs:2800-2806). No single surface today projects them together — an
  orchestrator cannot answer "which exact routes can actually carry a turn right now, and
  how loaded are they?" without assembling four separate views by hand.
- **#84 — programmatic credential controllers.** The #11 v3 pattern
  (claude-credential-cache.mjs) is Claude-only. Grok's `~/.grok/auth.json` carries a
  per-scope `refresh_token` (application-deployment.mjs:441-443) whose OIDC
  `refresh_token` grant was verified **programmatically drivable** when #84 was filed
  (commit c3d7d15); Claude's refresh-capable runtime shape is the #11 substrate; the doctor
  findings on **refresh-token death** (the kimi revoked-tombstone recognition,
  application-deployment.mjs:360-375) are the model for the corrective-action taxonomy.

Fleet truth at drafting (PROGRESS.md:339-340): claude (opus/sonnet) and grok re-authorized,
codex gpt-5.6-sol back, GLM 5.2 back, deepseek-v4-flash the economic workhorse, kimi blocked
on #54. grok stays **opportunistic — "verify per launch — its 28-min TTL pattern makes it
unreliable for long implementation turns until #47 lands"** (frontier-sweep.md:100-101). #47
is the thing that lets grok become a reliable seat.

---

## 1. Ground truth (all verified this campaign)

### 1.1 The 28-min TTL and the turn-time-discovery problem

- **Grok's token dies 28 minutes after an interactive login.** Filed evidence:
  - setup-token-decisions.md:113 — "grok's token dying 28 minutes after an interactive login"
    (one of the campaign's credential-fragility receipts filed on #11 and #47).
  - dynamic-workflow-2026-07-24/ACCEPTANCE.md:22 — the identical failure reproduced: "grok's
    token had expired 28 min post-login" (a v2 wave where every seat failed identically).
  - frontier-sweep.md:100-101 — the fleet-seating consequence: "grok = opportunistic (verify
    per launch — its 28-min TTL pattern makes it unreliable for long implementation turns
    until #47 lands)".
- **Claude rotates and revokes mid-wave.** setup-token-decisions.md:113 — "claude OAuth TTL
  rotation ×3 and a 401 revocation mid-wave"; the #11 red-team binary-verified the CLI's own
  refresh (`/v1/oauth/token`, `invalid_grant` ×33 in the binary) and the observed TTLs
  (access 4.4h, refresh 21.4d) at setup-token-decisions.md:117-122.
- **Every one of these was discovered at turn time** because "projection is static and
  doctor is static-only" (setup-token-decisions.md:115-116). A turn-time failure costs a
  full spawn, a provider round-trip that dies, and — on the worker path — the retry-once
  machinery. The 28-min window is *smaller than a long implementation turn*, so a grok seat
  can die mid-edit with zero static warning.

### 1.2 The static readiness authority (#47's substrate)

- `deploymentReadiness()` (application-deployment.mjs:1019-1135) computes route states from
  **adapter cards + credential metadata + observed harness version**. A passing row says
  exactly what it is: **"The exact route passed static deployment readiness."**
  (application-deployment.mjs:1123).
- The static gates, in order (application-deployment.mjs:1037-1124): one adapter must match
  the exact route (`route_unavailable`/`route_ambiguous`); projected claude authentication
  (`projectedAdapterAuthentication`, application-deployment.mjs:971-1017 — a `claude auth
  status --json` probe in a private runtime, claude-session.mjs:389-432); native kimi /
  grok credential state; adapter-advertised `readiness` block; credential state not
  absent/expired/invalid/unavailable; harness version `observed`. All **static**.
- **One credential identity, N routes — the static path's established model.** Every
  vendor's static readiness treats the credential as a single identity shared across every
  route it backs: `nativeKimiAuthentication`/`nativeGrokAuthentication` are computed
  **once** per readiness pass (application-deployment.mjs:1585-1590) and applied to
  **every** matching route (application-deployment.mjs:1064-1096); `doctorReadiness()`
  maps one fresh claude credential probe onto every claude route
  (application-deployment.mjs:1256-1259); `ClaudeCredentialCache` is one object keyed on
  `credentialPath` (its single-flight key is `this.path`, claude-credential-cache.mjs:270),
  with a credential-scoped `revocationLatched`. The #47 tier's liveness cache joins this
  identity model (§4.1.3) rather than inventing a per-route one.
- `assertRouteReady()` (application-deployment.mjs:1155-1162) blocks spawns/waves on
  `blocked` routes — the enforcement seam the live tier extends.
- `doctorReadiness()` (application-deployment.mjs:1254-1264) re-probes **workspace capacity
  + claude credential** fresh per read (the `workspaceProbe`/`claudeCredentialProbe` pattern,
  application-deployment.mjs:1204-1205) but **reuses the frozen open-time route states** for
  everything else.
- The wave driver's preflight calls `baton.doctor()` per member and fails the wave with
  `wave_driver_route_unready` (wave-driver.mjs:274-282) — a 64-member wave can therefore
  fan 64 doctor reads at launch. This is the exact shape "never probe per call" must govern.
- Route readiness is **advisory at selection time**; ordinary Run/Workflow authority and
  execution-time authorization remain authoritative
  (docs/30-objective-review-and-route-readiness.md:55-56). The live tier inherits this
  posture: it gates, it never selects.
- The grok credential state machine (application-deployment.mjs:410-486) is already
  **expiry-aware**: per-scope `expires_at` (RFC3339) checked against `now + 5 min` early
  invalidation (`GROK_AUTH_EARLY_INVALIDATION_MS`, application-deployment.mjs:67), with a
  `refreshable` state when a refresh token is present but the access token is inside the
  early-invalidation window (application-deployment.mjs:455-458). `ready`/`credentialState:
  refreshable` is still **static** — it says a refresh *could* happen, not that inference
  *does* complete.

### 1.3 The #11 credential-cache pattern (#84's substrate)

- `ClaudeCredentialCache` (claude-credential-cache.mjs:172-352) is the landed #11 v3
  pattern (PROGRESS.md:373-376: "deployment credential cache, access-token-ONLY worker
  projection, per-credential single-flight with lockfile + Keychain-mtime CAS, revocation
  latch, spawn TTL gate, retry-once, claudeAuthenticationSummary; CC 10/10").
- The reusable seams, each with its line:
  - **Single-flight per credential**: `refresh()` (claude-credential-cache.mjs:265-285) via
    a `flights` Map keyed on the credential path.
  - **Advisory lockfile**: `acquireLock()` (claude-credential-cache.mjs:98-119) —
    `O_CREAT|O_EXCL`, 0600, timeout → `authentication_refresh_locked`.
  - **Keychain-mtime CAS**: `_refreshFlight()` (claude-credential-cache.mjs:287-346) —
    re-read before adopting a harvest; abort + re-read freshest if it changed under the
    flight.
  - **Harvest monotonicity + schema gate**: candidates are adopted only if strictly fresher
    (claude-credential-cache.mjs:332-335).
  - **Revocation latch**: `invalidGrant` (claude-credential-cache.mjs:315-317) latches to
    `expired_needs_login`; every further automatic trigger short-circuits until the explicit
    `baton credentials refresh claude` command (claude-credential-cache.mjs:348-350).
  - **Spawn-TTL gate**: `ensureFresh()` (claude-credential-cache.mjs:256-263) refreshes
    before projection when `expiresAt <= now` — wired at claude-session.mjs:590-601.
  - **Retry-once on the worker path**: claude-session.mjs:1066-1072, 1119-1129.
  - **Access-token-only projection**: `projectionEnv()` (claude-credential-cache.mjs:229-232)
    — the refresh token never enters a worker runtime.
  - **Vendor-executed refresh runtime**: `defaultRefreshRuntime()`
    (claude-credential-cache.mjs:121-159) — spawns the CLI in a throwaway HOME/CLAUDE_CONFIG_DIR
    with `--print`/`--output-format json`, captures bounded stdout/stderr, detects
    `invalid_grant|revok`, kills on timeout, reads the write-back target. Its projected-
    credential write is a **flat sibling file** (`directory/.credentials.json`,
    claude-credential-cache.mjs:122-123) under `HOME`/`CLAUDE_CONFIG_DIR: directory`
    (claude-credential-cache.mjs:131-132) — a claude-specific convention the grok port must
    NOT copy (§4.3.1).
- **Honest metadata already names the #47 tier**: `metadata()` (claude-credential-cache.mjs:
  236-254) exposes `{expiresAt, refreshTokenExpiresAt, state: fresh|stale|expired_needs_login}`
  and labels `stale` as **"refresh-unverified until attempted (#47 tier)"**
  (claude-credential-cache.mjs:250) — the static state machine already admits it cannot
  know the refresh token is alive without attempting it.
- `claudeAuthenticationSummary(code)` (application-deployment.mjs:328-336) is the typed
  corrective-action text (mirroring `kimiAuthenticationSummary`/`grokAuthenticationSummary`);
  `PROVIDER_TERMINAL_GUIDANCE` (application-semantics.mjs:1888) stays vendor-agnostic.
- **The no-cross-vendor-overreach rule stands** (setup-token-decisions.md:183-188, rule 7):
  grok's 28-min token and codex's monthly cap are vendor-lived constraints; projection
  surfaces them honestly but "does not fabricate refreshes the vendors don't offer."

### 1.4 The route-learning store and occupancy (#83's substrate)

- **The store keeps the policy and the observations.**
  - `_routePolicy` is set from deployment options and validated by `validRoutePolicy`
    (coordination-store.mjs:653-656; schema at 326-334: mode `round-robin|adaptive|auto`,
    halfLifeMs, explorationConstant, seedDiscount, minSamplesForAdaptive,
    defaultPriorSuccessRate).
  - `_routeObservations` is a task-keyed Map (coordination-store.mjs:1083); `routeObservations()`
    returns them sorted by eventSeq (coordination-store.mjs:11114).
  - The observation row schema is pinned closed:
    `['schemaVersion','policyDigest','taskId','expectedTaskVersion','taskType','runId',
    'routeKey','modelFamily','route','terminalStatus','verifiedWin','verificationEvidence',
    'observedAt','observationDigest']` (coordination-store.mjs:3360); a terminal batch can
    attach exactly `{taskType, runId, routeKey, modelFamily, route, verifiedWin,
    verificationEvidence}` (coordination-store.mjs:12502-12510). Events are
    `route.outcome_observed` with integrity + conflict refusal
    (coordination-store.mjs:7891, 3383-3385).
  - **Verification evidence is `verify.reverified`-sourced, digest-checked.** A route
    observation's `verificationEvidence` must trace to an `evidence.mapped` event whose
    payload is a `verify.reverified` operational event, checked digest-for-digest, with the
    operational source re-read and matched on task/accept/model/effort
    (coordination-store.mjs:3378-3381); the row's `observationDigest` binds the event's
    idempotency key (coordination-store.mjs:3384) and a conflicting prior digest is refused
    (coordination-store.mjs:3385). This is the evidence path the #47 probe's content
    verification rides (§4.1.1) — no bespoke probe-only verifier.
  - Wiring: `routeLearningPolicy` flows into the store and the router is hydrated from the
    observations at open (index.mjs:1238, 1258, 1292).
- **The router already computes adaptive stats** (router.mjs): `advice()` is pure/read-only
  over a closed candidate set with caller-provided `inFlight` vs `concurrencyCeiling`
  eligibility (router.mjs:289-316, 292); `record()` applies verified wins with decay
  (router.mjs:323-346); `snapshot()` exposes mode, half-life, buckets (weight/count/rate/
  seededFrom), appliedTaskIds, rrCursor (router.mjs:358-373).
- **The `route.advice` capability** is the bounded deterministic consumer of the same
  shape: it requires candidate rows `{routeKey, modelFamily, concurrencyCeiling, inFlight}`
  (cairn-run-scorecard.mjs:139-162), refuses if the observation time predates durable
  evidence or the router state mutates, and claims `routingMutationAuthority: false` — the
  roster must not change selection authority either. Note it lives in **Cairn's
  dot-namespaced knowledge-capability plane** (`op: 'route.advice'`,
  cairn-run-scorecard.mjs:162 — the only `route.advice` registration in `impl/src/`), a
  different plane from the ordinary capability plane the roster registers in (§4.2.2).
- **Occupancy already exists, twice**: the coordinator counts in-flight seats per adapter
  (`_inFlightCount(vendor)`, coordinator.mjs:2800-2806, feeding `inFlight` at
  coordinator.mjs:2745-2747), and the router advice consumes a caller-provided inFlight.
  No surface projects it per-route alongside liveness and learning.

### 1.5 The doctor / probe precedent (probe shape)

- The deepseek W1.4 probe is the campaign's one **actual-inference proof** and the #47
  probe's direct precedent (docs/reference/evidence/deepseek-2026-07-30/PROBE-RECEIPT.md):
  doctor → one bounded live run on the exact route → **real provider inference
  (`resource.provider_call` receipt)** → turn completed → content-verified pin
  (`git show aabf9fab:deepseek-probe/hello.md` → `deepseek-flash probe ok`, exactly one
  line). The probe script is probe-flash.mjs: bounded objective, exact route, `scope:
  ['deepseek-probe/**']`, 300s complete timeout, stop after the first parked turn.
- The probe's honesty discipline: the pin **content proof** distinguishes "a provider
  process started" from "the model actually produced the instructed output." Any #47 probe
  that cannot content-verify its result proves nothing.

---

## 2. The question

An orchestrator reading the doctor today sees `grok-4.5@low: ready ("The exact route passed
static deployment readiness")` while the seat behind it will eat a real turn, die 28 minutes
after its last login, and cost the wave a retry-once. Can Baton (a) prove — within a strict
cost bound and never per call — that a route can actually carry an inference turn right now,
(b) project that liveness together with per-route occupancy and the route-learning record as
one honest `fleet.roster` an orchestrator can read before a wave, and (c) keep the
OAuth-subscription seats alive programmatically — grok on the same single-flight/
CAS/revocation-latch pattern #11 built for claude — with doctor surfacing refresh-token death
with the corrective action, instead of discovering it at turn time?

---

## 3. Control-law preamble (binding)

The campaign control law (bidirectional-v3-decisions.md:134-143) is binding on this epic:
controls on agent work must be **eval-able, constructive, or conversational** — never
clocks/turn-limits. This epic's probe cadence and liveness windows are **resource
circuit-breakers** (they bound provider spend and cache freshness, a legitimate distinct
class, bidirectional-v3-decisions.md:142-143), never progress controls. Liveness is judged
from the **event vocabulary** (a `resource.provider_call` receipt, a turn-completed receipt,
a typed probe verdict) — not from a stopwatch on a worker. The 28-min TTL is a
**vendor-observed physical bound** on the credential, not a control on work: it is a
cache-freshness derivation and a cost bound, and it is deployment-configurable. No decision
below may introduce a per-turn limit or a "probe if the last activity was more than N
minutes ago" liveness clock on real work. **The sticky-failure window (§4.1.3) is not a
work clock either** (red-team §5, fold F-7): the explicit `baton doctor --check` and
`baton credentials refresh …` paths unstick a route immediately, independent of the
window's elapsed time — the window bounds only the automatic re-probe cadence, satisfying
the control law's "constructive" carve-out the same way the 28-min TTL satisfies its
"resource circuit-breaker" carve-out.

*(Defended as written, red-team §5: the probe TTL windows gate whether Baton re-probes,
never whether an agent's in-flight work continues or is judged — the resource
circuit-breaker carve-out fits cleanly, bidirectional-v3-decisions.md:142-143.)*

---

## 4. Decisions

*(Defended as written, red-team §3.1: the D1 → D2 → D3 ordering matches the real dependency
graph — §4.2.1's roster consumes the §4.1.3 cache tuple and the coordinator's occupancy
(coordinator.mjs:2800-2806), both prerequisites, never concurrent siblings.)*

### 4.1 D1 — the bounded actual-inference readiness tier per route (#47)

The tier is an **additive liveness attribute on the existing route state**, not a
replacement for static deployment readiness. Static readiness stays the substrate
(§1.2); the tier answers the question static readiness cannot: "did the provider actually
execute an inference turn within a bounded, cached window?"

#### 4.1.1 Probe shape

The #47 probe is a **minimal actual-inference probe**, deliberately smaller than the W1.4
full-run precedent (probe-flash.mjs) but with the same honesty discipline:

- One bounded prompt requiring a **deterministic, content-verifiable answer** (e.g., "Reply
  with exactly one line: `<route>-probe ok`. Nothing else." — the W1.4 pin pattern,
  PROBE-RECEIPT.md:10-11). The verdict is **content-verified**: the probe passes only when
  the turn-completed receipt carries the exact expected output. A bare
  `lifecycle.spawned` (a provider process started) is **not** proof of provider-alive.
- **Probe content-verification rides the existing evidence path, never a bespoke verifier**
  (red-team §2.2, fold F-4): the probe's expected-output check consumes the same
  `verify.reverified`-sourced evidence discipline route observations already require —
  evidence traced to a `verify.reverified` operational event, checked digest-for-digest
  (coordination-store.mjs:3378-3381, §1.4). A probe never ships its own parallel verifier;
  a subtly-different matcher (substring vs exact, adapter self-report vs receipt) silently
  reopens the probe-as-fake gap and is a red-first failure (RT-1), not an implementation
  detail.
- The probe executes through the **real adapter for the exact route** in an isolated
  runtime (the RuntimeIsolation shape, application-deployment.mjs:971-1017), with the
  deployment credential projected (access-token-only for claude;
  claude-credential-cache.mjs:229-232). It is the same code path a real spawn rides, so a
  probe pass proves the credential + adapter + provider execute a turn — the exact
  combination that fails at turn time today.
- The probe mints a **typed probe receipt**: a `resource.provider_call`-class receipt plus
  a `readiness.probe_verified`/`readiness.probe_failed` record carrying `{route, probeId,
  latencyMs, observedAt, expiresAt}`. This is evidence (up), never a control (down).
- A probe failure classifies its cause against the existing taxonomy — `invalid_grant` →
  `authentication_refresh_required` (and, for a revocation-latched credential controller,
  the latch fires per §4.3), network/timeout → `provider_unreachable`, adapter refusal →
  the adapter's typed code. The route's blocked state carries that code; it must never
  masquerade as a generic "not ready".

**Red-team targets:** probe-as-fake (a fixture that "passes" without real provider
inference — the probe must require the content-verified turn receipt, not an adapter
self-report, and the verification path is pinned to the shared `verify.reverified`
evidence path above — no bespoke probe-only verifier); probe-cost escape (a probe that
grows its prompt/response/timeout unbounded — see §4.1.2); probe-failure ambiguity (one
generic failure code that hides whether the credential or the provider is dead — the
classification above); probe-side-effect (a probe that mutates route state or learning
stats — the probe is read-only against the store).

*(Defended as written, red-team §2.2: the anti-fake-probe design stands on the W1.4 pin
precedent (PROBE-RECEIPT.md:6, 10-11) and the isolated-runtime-plus-real-adapter shape
(projectedAdapterAuthentication, application-deployment.mjs:971-1017); the existing static
check is confirmed local-only — `claude auth status --json`, 5s timeout, no model call
(claude-session.mjs:389-398) — so the static-vs-live distinction is coherent. The folded
gap — which verification path runs the check — is pinned by F-4 above.)*

#### 4.1.2 Cost bounds

- **One probe = one provider call, bounded prompt, bounded response, bounded wall time:**
  prompt ≤ 1KiB, expected-response capture ≤ 2KiB, probe timeout ≤ 120s, exactly one
  `resource.provider_call`. These are resource circuit-breakers (spend bounds), the
  legitimate class named in §3; they are configurable deployment-side and their defaults
  derive from the W1.4 precedent (one bounded turn, content pin).
- **The probe is a per-route cost, amortized by the cache (§4.1.3).** The 28-min grok TTL
  makes a grok liveness window cost-bounded at roughly one probe per TTL window — a small,
  bounded fraction of a wave's provider spend, and *zero* while the cache is fresh.
- **Probe concurrency is bounded by single-flight per route** (§4.1.3), so a cold wave
  cannot fan a probe storm: N concurrent stale spawns for one route coalesce into one probe.

**Red-team targets:** probe-storm (a 64-member wave preflight triggering 64 probes — the
single-flight + cache-fresh short-circuit must make it 0 or 1); unbounded probe spend (a
probe that retries or loops — exactly one provider call, then a typed verdict);
cost-vs-benefit inversion (probing a static-key route like deepseek/glm every wave — the
TTL for static-key routes is long/derived from the key's non-expiry, §4.1.3).

#### 4.1.3 Cache semantics — never probe per call

- **Per-route probe cache, joined to credential identity** (red-team §2.1, fold F-1). The
  deployment keeps, per route, a frozen `{state: 'verified'|'unverified'|'failed',
  verifiedAt, expiresAt, probeId, latencyMs, code?, credentialKey}` tuple, where
  `credentialKey` names the credential identity the route's liveness actually measures —
  SHA-256 of the credential path for claude (the same identity the cache's single-flight
  already keys on, claude-credential-cache.mjs:270), a fixed per-vendor key for the single
  global grok/kimi credentials. This matches the single-shared-credential-object identity
  every vendor's static path already uses (§1.2: computed once per pass,
  application-deployment.mjs:1585-1590; applied to every matching route, :1064-1096,
  :1256-1259). Reads are cheap (in-memory / per-read stat class); **never probe per call.**
- **Spawn/preflight path consults the cache, probes only on stale or absent:**
  `state === 'verified' && expiresAt > now` → no probe; `state === 'failed'` (within a
  bounded failure window) → no probe, the blocked taxonomy fires with the typed code
  (§4.1.1) and the corrective action; otherwise (absent/stale) → **one probe, single-flight
  per route** (the `flights`-Map discipline, claude-credential-cache.mjs:265-285, applied
  to probe identity). Concurrent stale triggers coalesce.
- **Credential-scoped invalidation** (red-team §2.1/§3.4, fold F-1). Any `invalid_grant`
  verdict — whether surfaced by a probe (§4.1.1) or a worker turn (§4.3.3) — invalidates
  **every** liveness row sharing that `credentialKey` to `failed` in the same write, not
  only the row for the route that produced the verdict. Without this join, a sibling route
  inside its own fresh window would keep reading `verified` on a credential the controller
  has already revocation-latched — a regression against the three-vendor static-path
  identity precedent (§1.2), not merely an edge case.
- **The wave-driver preflight** (wave-driver.mjs:274-282) becomes the first bounded
  consumer: its per-member doctor reads short-circuit on the cache; a stale route probes
  once, not per member.
- **Probe TTL is a cache-freshness bound, deployment-configurable, defaulted from vendor
  physical bounds:** grok OIDC-subscription routes default to a window ≤ the observed 28-min
  credential TTL (setup-token-decisions.md:113; dynamic-workflow ACCEPTANCE.md:22 — the
  vendor-observed bound), claude routes default to a window ≤ the observed 4.4h access TTL
  (setup-token-decisions.md:121), static-key routes (deepseek/glm) default to a long window
  because the key is non-expiring (application-deployment.mjs:91-98, 836-839). The exact
  defaults are derived numbers, configurable — never hardcoded as a work-control limit (§3).
- **`failed` is sticky within a bounded failure window** (probe-failure recovery backoff),
  so a dead provider is not re-probed on every spawn; the explicit `baton doctor --check`
  deep path and the credential controllers' explicit refresh remain the operator's
  forced-retry surfaces. This window is classified against the control law in §3 (fold
  F-7): the explicit paths unstick immediately, so the window bounds only the automatic
  re-probe cadence — constructive, never a bare clock on work.
- **Why an in-memory cache suffices** (red-team §3.2, fold F-6). The cache survives across
  separate CLI invocations because ordinary commands are thin `BatonWebClient`s of one
  resident `baton serve` process — `discoverBatonConnection`'s residency contract
  (connection.json schemaVersion 2 `deploymentId`/`incarnation`,
  application-cli.mjs:208-260); only the server opens and holds the facade. A `baton serve`
  restart resets every route to `absent`; the next wave's preflight probes each once,
  bounded by RT-5's existing cold-wave case — this is a known, accepted cost, not a gap.

**Red-team targets:** cache-staleness lying (a `verified` cache row served after the
provider died — the window default is bounded by the vendor TTL, and any `invalid_grant`
verdict, probe- or worker-sourced, invalidates every liveness row sharing the
`credentialKey`, so the next read on ANY route the credential backs sees `failed`, not
stale-`verified` — RT-14); cache-forever (a failed probe that never re-probes — the
bounded failure window + explicit check break it); probe-as-call-multiplier (a consumer
probing per spawn — the cache short-circuit is the invariant, tested); identity-skip
(a liveness row keyed per route only, orphaning sibling routes on the same credential —
the `credentialKey` join above, source-pinned to the static paths' shared-identity model).

*(Defended as written, red-team §2.3: replay/idempotency — a replayed or stale receipt
cannot extend its own window because expiry is enforced structurally at consult time
(`expiresAt > now`), and the reused precedents hold: single-flight keyed on credential
path (claude-credential-cache.mjs:265-285), observation digest binding + conflict refusal
(coordination-store.mjs:3384-3385).)*

#### 4.1.4 What counts as proof of provider-alive vs static-ready

- **static-ready** = the existing `deploymentReadiness` verdict (application-deployment.mjs:
  1123): adapter card matches the exact route, credential metadata is present and not
  statically expired, harness version observed. It proves *configuration*, nothing about a
  live provider.
- **provider-alive** = a passing actual-inference probe within the liveness window: the
  exact route executed one bounded turn, returned the content-verified expected output, and
  did so within `expiresAt`. It proves the credential + adapter + provider execute real
  inference now.
- **The distinction is load-bearing exactly for the 28-min TTL.** A grok route whose
  credential metadata says `available`/`refreshable` (application-deployment.mjs:465-470)
  is static-ready but **not** provider-alive once its probe window lapses. `fleet.roster`
  (§4.2) and the doctor must show both states separately so an orchestrator sees
  "static-ready, live-verified 3 min ago" vs "static-ready, live-window lapsed" vs
  "provider failed" — and the route gate (§4.1.3) refuses only the genuinely-failed case
  while the *advisory* view (docs/30:55-56) shows the stale-window case honestly.
- **No auto-heal.** A failed probe or a latched credential (§4.3) never triggers an
  automatic re-login; it reports the typed blocked state and the corrective action. The
  tier measures and gates; the controllers (§4.3) keep seats alive within the credential's
  own refresh mechanics; the operator's explicit surfaces stay the only unlock.

**Red-team targets:** state-conflation (roster/doctor merging static-ready and provider-
alive into one `ready` — the two MUST be separable fields, tested row-by-row);
auto-heal-overreach (any automatic path that re-runs vendor login or persists a harvested
credential without the explicit-command consent ceremony, claude-credential-cache.mjs:340,
348-350); proving-too-little (a probe whose "success" is a provider process start — §4.1.1's
content verification is mandatory, not decorative).

### 4.2 D2 — fleet.roster (#83)

The roster is a **projection**, not a new store. It reads four existing authorities —
deployment readiness (§1.2), the #47 liveness tier (§4.1), coordinator occupancy (§1.4),
and the route-learning store/router (§1.4) — and composes them into one bounded, sanitized,
advisory surface.

#### 4.2.1 Projection shape

`fleet.roster` returns a closed, bounded document:

```text
{
  schemaVersion: 1,
  observedAt,                     # single snapshot timestamp
  routes: [{
    harness, model, effort, provider,
    static:      { state, code?, summary? },        # from deploymentReadiness (§1.2)
    liveness:    { state: verified|unverified|failed, verifiedAt?, expiresAt?,
                   probeId?, latencyMs?, code?, credentialKey },  # #47 cache (§4.1.3)
    occupancy:   { inFlight, concurrencyCeiling }, # coordinator seats + adapter card ceiling
    learning:    { samples, winRate, weight, seededFrom?, mode } | null,  # router bucket
  }],
  observations: [ ...routeObservations, bounded tail... ],  # coordination-store.mjs:11114
}
```

- **Occupancy is derived from the coordinator's real seats** (`_inFlightCount`,
  coordinator.mjs:2800-2806), never caller-supplied for the projection; the caller-supplied
  `inFlight` shape belongs only to the route.advice consumption (router.mjs:292,
  cairn-run-scorecard.mjs:145-146), which the roster can feed but never confuses with the
  observed projection.
- **Learning is the router bucket projection** (router.mjs:358-373): winRate =
  weight/count (decayed), seededFrom for cross-model seed, mode from policy
  (coordination-store.mjs:326-334). A route with no bucket projects `learning: null` —
  honest-empty, never a fabricated prior.
- **Sanitization inherits the doctor discipline — and its function** (red-team §2.4, fold
  F-5): the roster's `liveness`/`occupancy`/`learning` fields extend `publicRouteRuntime`
  (application-deployment.mjs:940-969 — the whitelist projector over
  `publicCardAtom`/`publicHarnessVersion`, application-deployment.mjs:921-938) — or a
  stated named sibling of it — never a new, parallel, potentially weaker sanitizer. The
  policy stands (docs/30:46-50): no executable paths, no credential values, no private
  runtime paths, no adapter output, no provider tokens. `learning` and `liveness` carry
  only bounded, vendor-neutral atoms.
- **Bounded.** routes ≤ the deployment's configured route set (normalizeRoutes,
  application-deployment.mjs:228-249 caps at 64); observations truncated to a bounded tail;
  the document byte-capped like other projections (the cairn route-advice ceilings,
  cairn-run-scorecard.mjs:52-53, are the precedent).

*(Defended as written, red-team §2.4: the sanitization policy is grounded —
`publicHarnessVersion`/`publicRouteRuntime` already whitelist-project only bounded,
regex-validated atoms, and no raw adapter output crosses that boundary today
(application-deployment.mjs:921-969). The folded precision gap — which function the new
fields extend — is named by F-5 above.)*

#### 4.2.2 Surfaces

- **Doctor route rows gain the roster fields.** `doctorReadiness()` (application-deployment.
  mjs:1254-1264) route rows extend with `liveness` and `occupancy` (and `learning` where a
  bucket exists) — so every existing consumer (CLI `baton doctor`/`route`, the wave-driver
  preflight, web/MCP doctor, docs/30:46-56) gains the honest multi-axis view without a new
  surface.
- **A `fleet_roster` command + capability** (red-team §4, fold F-2). CLI `baton fleet
  roster` and a **`fleet_roster` operation registered in the ordinary capability plane's
  advanced `fleet_*` family** (application-semantics.mjs:1099-1100 — sibling-consistent
  with `fleet_spawn`…`fleet_drain`) project the document directly. Its
  `routingMutationAuthority: false`/`workerAuthority: false` provenance fields are a **new
  precedent in that plane**, not borrowed from Cairn's `route.advice` envelope
  (`op: 'route.advice'`, cairn-run-scorecard.mjs:162 — a separate, dot-namespaced
  knowledge-capability plane this epic does not register in). (Pre-fold, this bullet cited
  both planes at once; the fold picks the ordinary plane. Honest nuance: the plane's
  *default* family is dot-namespaced — `application.help`, `runs.list`, `run.*`,
  application-semantics.mjs:1095-1096 — so the deciding rule is sibling consistency within
  the cited `fleet_*` family, not a plane-wide naming law.) It is **read-only advisory** —
  it never selects routes, never mutates the router, never claims verification or merge
  authority.
- **The MCP/reflex table row.** The roster joins the derived registry-delta surface (S-3's
  reflexive surfacing) as a bounded read tool — the packaging epic owns the wire shape; this
  epic owns the projection and its honesty contract.
- **The wave-driver preflight** (wave-driver.mjs:274-282) becomes a roster consumer:
  per-member readiness reads the composed row (static + liveness), probing only per
  §4.1.3's cache discipline — the 64-member preflight stays cheap.

**Red-team targets:** roster-as-scheduler (any consumer reading the roster as selection
authority — it is advisory; selection stays with the existing router/advice + exact-route
authority); plane-conflation (a registration that cites both the ordinary `fleet_*` family
and Cairn's dot-namespaced plane — one plane, `fleet_roster`, sibling-consistent, with its
own provenance precedent); occupancy-lie (projecting a fabricated `inFlight` rather than
the coordinator's real count — the projection is derived from coordinator.mjs:2800-2806 and
a source-scan pins it); sanitization leak (a roster row carrying a credential value,
executable path, or provider token — the sanitizer is `publicRouteRuntime` or its stated
named sibling, never a parallel implementation, tested by content scan);
unbounded-bloat (an unbounded observations tail — the bounded tail is pinned);
cross-surface drift (doctor rows and `fleet_roster` disagreeing — one projection function,
both surfaces consume it).

### 4.3 D3 — the credential controllers (#84)

#### 4.3.1 The grok OIDC refresh_token grant on the #11 pattern

- **Ground truth:** grok's `~/.grok/auth.json` is a scope-keyed record whose non-API-key
  scopes carry `access_token`, `refresh_token`, and an RFC3339 `expires_at`
  (application-deployment.mjs:429-458); the `xai::api_key` scope is the non-expiring API-key
  alternative (application-deployment.mjs:447). The **OIDC `refresh_token` grant is
  programmatically drivable** — verified when #84 was filed (commit c3d7d15). The vendor
  CLI owns refresh mechanics, exactly as the claude CLI does
  (setup-token-decisions.md:116-122).
- **A `GrokCredentialCache` on the #11 pattern.** `ensureFresh`/`refresh`/`projectionEnv`/
  revocation-latch, reusing the exact seams: single-flight per credential
  (claude-credential-cache.mjs:265-285), advisory lockfile (98-119), harvest monotonicity +
  schema gate (332-335), **mtime-CAS** on the operator `auth.json` where the claude pattern
  CASes the Keychain (287-346 — grok has no Keychain item, so the CAS target is the auth.json
  mtime; the "re-read immediately before adopting a harvest, abort if changed under the
  flight" rule is identical), spawn-TTL gate (256-263), access-token-only projection
  (229-232 — the refresh token never enters a grok worker runtime).
- **Vendor-executed refresh, with the vendor-native write-back target** (red-team §7
  amendment 6, fold F-3): the refresh runtime spawns the grok CLI (or the exact vendor
  refresh path pinned at #84 filing) in a scoped runtime with the cached credential
  projected, lets IT refresh, then harvests the freshest schema-valid credential from the
  write-back target. **Grok's credential path is HOME-relative, so the write-back target
  is NOT the claude flat-file convention:** grok's native sandbox grants its expected
  `~/.grok` tree with HOME kept private (runtime-isolation.mjs:64-66; `env.HOME = home`
  at :74; grok `GROK_HOME` pointed at the nested config at :81), so the grok runtime's
  projected-credential write AND its write-back read both target
  **`directory/.grok/auth.json`** with `HOME: directory`. It must not copy
  `defaultRefreshRuntime`'s flat sibling file (`directory/.credentials.json`,
  claude-credential-cache.mjs:122-123, under `HOME`/`CLAUDE_CONFIG_DIR: directory`,
  :131-132): a literal vendor-for-vendor port would write/read `directory/auth.json`, a
  path grok's CLI never touches. Everything else ports vendor-for-vendor: throwaway
  scoped HOME, bounded stdout/stderr capture, `invalid_grant|revok` detection, SIGKILL
  timeout, write-back-target read.
- **Honesty boundary (rule 7 stands):** Baton orchestrates the vendor refresh; it never
  reimplements x.ai OAuth internals, never invents a refresh where the vendor offers none,
  and never persists a harvested grok credential to the operator store except through the
  explicit consent command (mirroring claude-credential-cache.mjs:340, 348-350).
  `grokAuthenticationSummary` (application-deployment.mjs:400-408) stays the corrective text.

**Red-team targets:** vendor-refresh-fabrication (a controller that "refreshes" without the
vendor executing it — the vendor CLI must run and the harvest must be schema-gated, and the
write-back target is `directory/.grok/auth.json` per runtime-isolation.mjs:64-66, never the
claude flat sibling path); token-widening (a grok worker runtime receiving the refresh
token — access-token-only is enforced, pinned by the same projection-tree scan as #11's
CC-4, setup-token-decisions.md:205-209); latch-absence (a revoked grok refresh re-probing
forever — the `invalid_grant` latch fires, claude-credential-cache.mjs:315-317);
consent-violation (an automatic path persisting the harvest to the operator store).

#### 4.3.2 The Claude v3.1 refresh-capable runtime shape

- **Ground truth:** the claude CLI v3.x runtime is the refresh-capable vendor executable —
  binary-verified to own `/v1/oauth/token` refresh with rotation and `invalid_grant` ×33
  (setup-token-decisions.md:117-122); the deployment-side refresh runtime that drives it is
  `defaultRefreshRuntime` (claude-credential-cache.mjs:121-159): throwaway HOME +
  CLAUDE_CONFIG_DIR, `--print`/`--output-format json`, bounded stdout/stderr capture,
  `invalid_grant|revok` detection, SIGKILL timeout, write-back-target read.
- **This epic formalizes that runtime as a named, reusable shape** — the "vendor CLI owns
  refresh; the deployment owns a bounded, isolated refresh-runtime harness" contract — so
  the grok controller (§4.3.1) and any later OAuth controller implement the same seams
  rather than re-deriving them. Concretely: the runtime class takes
  `{cmd, cmdArgs, credential (wire), directory, timeoutMs}` and returns the closed result
  `{ok, invalidGrant, runtimeCredential, writeBackTarget}` — the exact envelope
  `defaultRefreshRuntime` already returns (claude-credential-cache.mjs:147-152). The
  write-back TARGET inside that envelope is vendor-specific (§4.3.1's
  `directory/.grok/auth.json` vs claude's flat sibling file) — the shared shape is the
  envelope and the isolation discipline, not the path convention.
- **The v3.1 refresh-capable runtime is the thing the retry-once worker path rides**
  (claude-session.mjs:1119-1129): one vendor-executed refresh → re-projection → exactly one
  retried turn. The tier's probe (§4.1) and the controller's spawn-TTL gate
  (claude-credential-cache.mjs:256-263) make that retry the rare path, not the common one.

**Red-team targets:** runtime-shape-drift (a second refresh implementation diverging from
the named envelope — one closed result shape, source-pinned); timeout/evidence asymmetry
(the refresh runtime's timeout producing an unresolvable `dispatch_unknown` instead of a
typed `authentication_refresh_timeout`); write-back-target ambiguity (the runtime reading a
target it did not write — the CAS re-read discipline of §4.3.1 applies, and each vendor's
target path is pinned: claude flat sibling, grok `directory/.grok/auth.json`).

#### 4.3.3 Doctor findings on refresh-token death with corrective action

- **Ground truth — the kimi model:** Kimi Code 0.27 persists a **closed tombstone after the
  OAuth server rejects a refresh token**: both secrets and both expiry counters cleared, the
  file intentionally retained. `kimiAuthenticationState` recognizes it exactly (empty
  access_token + empty refresh_token + zeroed expiry + a present scope + `token_type:
  bearer`, application-deployment.mjs:360-375) and maps it to `authentication_refresh_required`
  with the kimi corrective action ("Run the ordinary `kimi` login flow…",
  application-deployment.mjs:318-326). The recognition is exact so a partial/corrupt record
  cannot be promoted to a more convenient diagnosis (application-deployment.mjs:356-359).
- **The same doctor-finding discipline extends to every controller:** a grok refresh that
  returns `invalid_grant` latches (§4.3.1) and doctor surfaces `authentication_refresh_required`
  + the grok corrective action (application-deployment.mjs:400-408); a claude refresh that
  fails likewise (claudeAuthenticationSummary, application-deployment.mjs:328-336). The
  blocked taxonomy is shared; the remedy text is vendor-specific (the #11 R11V-4 fold,
  setup-token-decisions.md:46-51).
- **The #47 tier consumes these findings:** a probe that surfaces `invalid_grant`
  (§4.1.1's classification) is *itself* a refresh-token-death finding — it must propagate
  to the controller's latch, to the doctor's credential block, **and to every liveness
  cache row sharing the probe route's `credentialKey`** (§4.1.3's credential-scoped
  invalidation, fold F-1), so the "stale" label ("refresh-unverified until attempted (#47
  tier)", claude-credential-cache.mjs:250) upgrades to a truthful dead state — on every
  route the credential backs — the instant a probe or a worker turn attempts it.

**Red-team targets:** tombstone-misdiagnosis (a partial/corrupt record promoted to
revoked — the exact-token-wire recognition is mandatory); remedy-bleed (a vendor-specific
remedy text shared into another vendor's summary — the summaries stay per-vendor, the
`PROVIDER_TERMINAL_GUIDANCE` constant stays vendor-agnostic,
application-semantics.mjs:1888); finding-drop (a probe-discovered refresh-token death that
never reaches the latch, the doctor block, or the sibling liveness rows sharing the
`credentialKey` — the propagation path is a red-first test, RT-13/RT-14).

---

## 5. Non-goals (out of v1)

- **No scheduler, no selection.** The roster projects; the router/advice + exact-route
  authority selects. The roster claims `routingMutationAuthority: false` forever.
- **No per-call probing.** The cache short-circuit is an invariant; a caller probing per
  call is a bug, not a policy choice.
- **No auto-heal, no automatic re-login.** A failed probe, a latched credential, or a
  revoked refresh token reports the blocked taxonomy and the corrective action; the
  operator's explicit surfaces (`baton credentials refresh …`, `baton doctor --check`) are
  the only unlocks. No automatic path persists a harvested credential to the operator store
  (the #11 consent ceremony stands, claude-credential-cache.mjs:340).
- **No vendor-OAuth reimplementation.** Baton orchestrates vendor refresh; it never mints,
  rotates, or validates tokens itself, and it never invents refreshes for vendors that offer
  none (rule 7, setup-token-decisions.md:183-188).
- **No probe-as-benchmark.** The probe is one bounded content-verified turn for liveness,
  never a throughput/latency/quality benchmark, never a second provider cost axis.
- **No process-tree or host-level view in the roster.** Occupancy is seat counts per route
  (coordinator.mjs:2800-2806), not process forest inspection — that is a different concern.
- **No new store.** The roster is a projection over existing authorities (§1.4); the
  liveness cache is a deployment-side in-memory cache held by the resident `baton serve`
  process (§4.1.3, application-cli.mjs:208-260), not a durable store in v1 (a durable probe
  ledger is a v1.1 candidate).
  *(Defended as written, red-team §3.3: retention is disclaimed by this non-goal and the
  acceptance suite promises no cross-restart retention — consistent, no hole.)*
- **No kimi credential controller in v1** beyond the existing tombstone recognition
  (application-deployment.mjs:338-398): kimi's native login owns its refresh, kimi is
  blocked on #54, and rule 7 forbids fabricating a controller the vendor flow doesn't
  support programmatically.

---

## 6. Acceptance (red-first)

The red-first suite ships BEFORE implementation; every row is deterministic (fixture
adapters/shim executables, fixed clocks, no live providers unless explicitly an
operator-gated live probe):

**#47 (readiness tier) — RT-1..RT-5, RT-14**
- **RT-1 (probe shape + content proof):** a fixture route whose adapter reports
  `lifecycle.spawned` but never completes the content-verified turn is `probe_failed`, not
  `verified`; a fixture that completes with exactly the expected output is `verified` with a
  `readiness.probe_verified` receipt and a `resource.provider_call`-class receipt. The
  probe's content check rides the shared `verify.reverified`-sourced evidence path **by
  construction** (coordination-store.mjs:3378-3384): a fixture that substitutes a bespoke
  probe-only verifier fails the test (fold F-4).
- **RT-2 (never probe per call):** N spawns within a fresh liveness window perform zero
  probes; a stale window probes exactly once; N concurrent stale spawns coalesce to one
  probe (single-flight per route).
- **RT-3 (cost bounds):** the probe's prompt ≤ 1KiB, captured response ≤ 2KiB, timeout ≤
  120s, exactly one provider call; a fixture exceeding any bound produces the typed failure
  and no retry loop.
- **RT-4 (state separation):** doctor/roster rows carry `static.state` and `liveness.state`
  as separable fields; a static-ready route with a lapsed liveness window is NOT refused
  (advisory shows it honestly) while a `failed` liveness refuses spawns with the typed code;
  the blocked code classifies `invalid_grant` → `authentication_refresh_required` vs
  network → `provider_unreachable` vs adapter → the adapter's typed code.
- **RT-5 (wave preflight):** a 64-member wave whose routes are all cache-fresh performs no
  probes at preflight; a cold wave performs ≤1 probe per stale route. (This cold-wave case
  is also the post-`baton serve`-restart state — the in-memory cache resets to absent and
  the bound still holds, fold F-6.)
- **RT-14 (credential-identity invalidation, fold F-1):** a probe on route A surfaces
  `invalid_grant`; a concurrently-fresh route B sharing A's `credentialKey` reads `failed`
  on its very next read, not its own unexpired `verified` cache — and the same holds when
  the verdict arrives via a worker turn (§4.3.3) instead of a probe.

**#83 (roster) — RT-6..RT-9**
- **RT-6 (projection shape):** `fleet_roster` returns the closed document (§4.2.1); every
  route row carries static + liveness (incl. `credentialKey`) + occupancy +
  learning-or-null; observations are the bounded tail of `routeObservations()`
  (coordination-store.mjs:11114).
- **RT-7 (occupancy truth):** the projected `inFlight` equals the coordinator's real count
  (source-scan: derived from `_inFlightCount`, coordinator.mjs:2800-2806); a caller-supplied
  `inFlight` cannot alter the projection.
- **RT-8 (sanitization):** a content scan over roster output proves no credential value, no
  executable path, no private runtime path, no provider token appears (the #11 CC-4
  projection-tree scan precedent, setup-token-decisions.md:205-209) — and the new
  `liveness`/`occupancy`/`learning` fields are projected through `publicRouteRuntime`
  (application-deployment.mjs:940-969) or its stated named sibling; a parallel sanitizer is
  a test failure (fold F-5).
- **RT-9 (advisory + drift):** `fleet_roster` registers in the ordinary capability plane's
  advanced `fleet_*` family (application-semantics.mjs:1099-1100) and claims
  `routingMutationAuthority: false` and `workerAuthority: false` as that plane's own
  provenance precedent (fold F-2); doctor route rows and `fleet_roster` rows are
  byte-identical on shared fields (one projection function).

**#84 (credential controllers) — RT-10..RT-13**
- **RT-10 (grok cache on the #11 pattern):** a fixture grok executable that (a) rewrites the
  projected `directory/.grok/auth.json` — the HOME-relative vendor-native write-back target
  (runtime-isolation.mjs:64-66, fold F-3), never a flat sibling file — with a fresher
  `expires_at` → the harvest adopts it (monotonicity + schema gate); (b) emits the
  revocation wire shape → `invalid_grant` latches, a second trigger spawns NO second
  refresh runtime, and doctor surfaces `authentication_refresh_required` with the grok
  remedy; (c) the explicit command clears the latch and is the only persist-back path
  (source-scan).
- **RT-11 (single-flight + CAS):** N concurrent grok refresh triggers coalesce to one
  refresh runtime; an auth.json mtime change mid-flight aborts the adoption (the
  Keychain-mtime CAS discipline, vendor-adjusted to `directory/.grok/auth.json`); a
  cross-deployment flight blocks on the advisory lockfile.
- **RT-12 (access-token-only):** no grok worker runtime receives the refresh token; a
  projection-tree scan proves no projected worker file contains the cache's refresh-token
  bytes (the #11 CC-4 pin).
- **RT-13 (refresh-token-death findings):** a probe or worker turn surfacing `invalid_grant`
  propagates to the controller's latch AND the doctor credential block (and, per RT-14, to
  every liveness row sharing the `credentialKey`); the kimi tombstone recognition
  (application-deployment.mjs:360-375) stays exact — a partial/corrupt record is
  `authentication_metadata_invalid`, never promoted to revoked; every vendor's remedy text
  is its own (`PROVIDER_TERMINAL_GUIDANCE` stays vendor-agnostic).

**Live dogfood receipts (post-landing, operator-gated):** the first live grok refresh via
the #11 pattern records the observed write-back target (expected `directory/.grok/auth.json`
per fold F-3); the first live probe of a 28-min-TTL grok route records the verified window
vs the credential's expiry; the first live refresh-token-death (if reproduced) records the
actual terminal result against the matcher — each in this evidence directory, mirroring
#11's post-landing receipts (setup-token-decisions.md:90-92).

---

## 7. Verification

```text
node --test impl/test/readiness-credentials-red.test.mjs     # the red-first suite (RT-1..RT-14)
node --test impl/test/claude-credential-projection-red.test.mjs   # #11's suite stays green
```

then the canonical suite fully green. Post-landing live receipts per §6.

---

## 8. Fold trail (post-red-team amendments, folded 2026-08-03)

Folded against **readiness-redteam.md** (this directory; verdict summary §6, consolidated
amendment text §7) on 2026-08-03, per the bidirectional v3 discipline
(bidirectional-v3-decisions.md:1-7). Each entry records the pre-fold claim in one clause
for traceability; the amended text lives in the decision sections above.

**CONFIRMED-HOLEs (decision rewritten in place):**

- **F-1 (red-team §2.1/§3.4 → §1.2, §4.1.3, §4.2.1, §4.3.3, RT-6, RT-14): credential-
  identity granularity.** Pre-fold, the liveness cache was keyed per route only, so a
  sibling route inside its own fresh window would keep reading `verified` on a credential
  the controller had already revocation-latched — a regression against all three vendors'
  static paths, which compute one shared credential identity per pass and apply it to every
  matching route (application-deployment.mjs:1064-1096, 1256-1259, 1585-1590;
  claude-credential-cache.mjs:270). Fold: the tuple carries `credentialKey`; any
  `invalid_grant` verdict (probe or worker turn) invalidates every row sharing the key in
  the same write; RT-14 pins it.
- **F-2 (red-team §4 → §4.2.2, RT-9): capability-plane conflation.** Pre-fold, D2 justified
  the roster with the ordinary plane's `fleet_*` family (application-semantics.mjs:1099-1100)
  while borrowing its name shape and provenance envelope from Cairn's dot-namespaced
  `route.advice` (cairn-run-scorecard.mjs:162 — the only `route.advice` in `impl/src/`).
  Fold: the operation registers as `fleet_roster` in the ordinary capability plane's
  advanced family (sibling-consistent); the `routingMutationAuthority`/`workerAuthority`
  provenance fields are a new precedent in that plane. Recorded nuance: the ordinary
  plane's default family is dot-namespaced (application-semantics.mjs:1095-1096), so the
  rule is sibling consistency within the cited family, not a plane-wide naming law.
- **F-3 (red-team §7 amendment 6 → §1.3, §4.3.1, §4.3.2, RT-10, RT-11): grok write-back
  shape.** Pre-fold, the grok refresh runtime was described as a "vendor-for-vendor" port
  of `defaultRefreshRuntime`, whose flat sibling write-back (`directory/.credentials.json`,
  claude-credential-cache.mjs:122-123) is wrong for grok's HOME-relative credential path.
  Fold: both the projected write and the write-back read target `directory/.grok/auth.json`
  with `HOME: directory`, matching the established grok isolation shape
  (runtime-isolation.mjs:64-66, 74, 81); the shared runtime contract (§4.3.2) is the
  envelope + isolation discipline, not the path convention.

**NEEDS-AMENDMENTs (applied):**

- **F-4 (red-team §2.2 → §1.4, §4.1.1, RT-1): probe verification path pinned** — the
  probe's content check consumes the same `verify.reverified`-sourced,
  digest-for-digest evidence discipline route observations require
  (coordination-store.mjs:3378-3384); a bespoke probe-only verifier is forbidden by
  construction.
- **F-5 (red-team §2.4 → §4.2.1, RT-8): sanitizer function named** — the new roster fields
  extend `publicRouteRuntime` (application-deployment.mjs:940-969) or a stated named
  sibling, never a parallel sanitizer.
- **F-6 (red-team §3.2 → §4.1.3, §5, RT-5): in-memory cache grounded** — the resident-server
  model (`discoverBatonConnection`, application-cli.mjs:208-260) is why "never probe per
  call" holds across CLI invocations; a server restart's cold cache is exactly RT-5's
  bounded cold-wave case, an accepted cost.
- **F-7 (red-team §5 → §3, §4.1.3): sticky-failure window classified** against the control
  law's own forbidden-pattern language — the explicit unstick paths make it
  constructive-escape-hatch-bounded, not a bare clock.

**DEFENDED verdicts (one-line notes in place):** injection-lane probe design (§4.1.1),
replay/idempotency (§4.1.3), scope-leak sanitization policy (§4.2.1), D1→D2→D3 ordering
(§4 head), retention-by-non-goal (§5), probe-TTL control-law compliance (§3).

**Doc-honesty fixes (found while verifying this fold):** the §3 control-law citation moved
from `bidirectional-v3-decisions.md:115-125` (stale — that range is the BD3 synthesis
list) to `:134-143`; the red-team report repeats the stale cite in its own §5 and is
corrected here, not propagated. Runtime-isolation line numbers confirmed exact (:64-66 the
grok comment + nested config, :74 `env.HOME`, :81 grok `GROK_HOME`). Every file:line claim
added in this fold was re-verified with `grep -an`/`sed -n` on 2026-08-03.
