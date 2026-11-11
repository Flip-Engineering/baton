# Red-Team: readiness-credentials-contract.md (#47+#83+#84)

Status: COMPLETE

Target: `docs/reference/evidence/frontier-sweep-2026-08-03/readiness-credentials-contract.md`
(v1.0, deepseek-drafted, 624 lines)

Anchors:
- `impl/src/claude-credential-cache.mjs` (the #11 pattern)
- `impl/src/application-deployment.mjs` (readiness assembly, `grokAuthenticationState`
  :410-486)
- the route-learning store (`_routePolicy`/`_routeObservations`,
  `impl/src/coordination-store.mjs`)
- Issues #47/#83/#84

## 0. Method

All claims grounded in `grep -an` + `sed -n` against the shipped codebase on this worktree
(no full-file reads >1500 lines). **Methodological limitation, disclosed up front:** `gh` is
not authenticated in this environment (`gh auth status` → not logged in), so issue #47/#83/#84
*comment threads* could not be read live. Ground truth was instead cross-checked against the
same evidence documents the contract itself cites as its issue-comment substrate
(`setup-token-decisions.md`, `frontier-sweep.md`, `PROGRESS.md`, `PROBE-RECEIPT.md`) — all of
which exist and were read directly. This closes most of the gap but is not a substitute for
the raw issue text; treat any finding that would hinge on issue-comment nuance not reproduced
in those docs as unverified, not refuted.

Each contract decision below is classified **CONFIRMED-HOLE** / **DEFENDED** /
**NEEDS-AMENDMENT**, with amendment text where applicable.

## 1. Contract Decision Inventory

| § | Decision | Substrate cited |
|---|----------|------------------|
| D1 (§4.1) | Bounded actual-inference readiness tier per route (#47) | `application-deployment.mjs` static readiness, `claude-credential-cache.mjs` single-flight |
| D2 (§4.2) | `fleet.roster` projection (#83) | `coordination-store.mjs` route-learning store, `router.mjs`, `coordinator.mjs` occupancy |
| D3 (§4.3) | Programmatic credential controllers (#84) | `claude-credential-cache.mjs` (#11 pattern) ported to grok |

## 2. Authority Attacks

### 2.1 Identity derivation — CONFIRMED-HOLE (cross-route credential identity)

The contract keys the new liveness cache **per route** (§4.1.3: "the deployment keeps, per
route, a frozen `{state, verifiedAt, expiresAt, ...}` tuple"), but the underlying credential
identity it measures is coarser than a route in the exact case the epic exists to fix.

Verified, and broader than claude alone: `deploymentReadiness()` (`application-deployment.mjs:
1019-1135`) takes `nativeKimiAuthentication`/`nativeGrokAuthentication` as **singular**
parameters — each computed exactly **once** per deployment-readiness pass
(`kimiAuthenticationState(...)` at line 1587, `grokAuthenticationState(...)` at line 1590 —
one call each, not one per route) — and applies that *same* object's `credentialState`/
`code`/`summary` to **every route** matching `route.harness === 'kimi-code'` (:1066-1080) or
`route.harness === 'grok'` (:1082-1096) respectively. `doctorReadiness()` does the identical
thing for claude at read time (`application-deployment.mjs:1256-1259`, mapping one fresh
`credential` probe onto every route with `route.harness === 'claude-code' && route.model.
startsWith('claude-')`). **All three vendors' existing static readiness path treats the
credential as a single identity shared across every route it backs** — one credential, N
routes. `ClaudeCredentialCache` (`claude-credential-cache.mjs:172-352`) is likewise a single
object keyed on `credentialPath`, not on route; its `revocationLatched` flag is
credential-scoped, and a hypothetical `GrokCredentialCache` (§4.3.1) would be exactly one
object per `~/.grok/auth.json`, not one per grok route.

The new #47 liveness tuple has no such credential-identity join. §4.1.1's failure
classification says an `invalid_grant` probe result "propagate[s] to the controller's latch"
(singular, credential-scoped) — but the *liveness cache row* that gets updated to `failed` is
only the **one route whose probe ran**. A sibling route sharing the same now-latched
credential (e.g. claude-sonnet, probed 3 minutes ago and still inside its liveness window)
keeps reading `state: 'verified', expiresAt > now` from its own independent per-route cache
entry — `fleet.roster` and doctor would report claude-sonnet **provider-alive** for the
remainder of its window, on a credential the controller has *already* revocation-latched.

This is exactly the failure class §4.1.3's own red-team-targets paragraph claims to close
("cache-staleness lying ... a probe that surfaces an auth failure latches via §4.3 so the next
read sees `failed`, not stale-`verified`") — but the claim is true only for the probed route,
not for every route sharing the identity that actually died. Static readiness does not have
this hole (every vendor path re-derives its single shared credential object fresh per read,
per the citations above), which is precisely why the additive per-route liveness cache is a
**regression against the codebase's own established, consistent, three-vendor precedent** for
how credential identity should be modeled — not merely an unaddressed edge case.

**Amendment:** the liveness cache tuple must carry (or be joined against) a **credential
identity key**, not just a route key — e.g. `credentialKey: sha256(credentialPath)` for
claude, `credentialKey: 'grok'` (single global grok credential) for grok. On
`revocationLatched` transition (or any `invalid_grant` probe verdict), the controller must
invalidate **every** liveness cache row sharing that `credentialKey`, not just the row for the
route that ran the probe. Add RT-14: "a probe on route A surfaces `invalid_grant`; a
concurrently-fresh route B sharing A's credential reads `failed` on its very next read, not
its own unexpired `verified` cache."

### 2.2 Injection lanes — DEFENDED, with a grounding gap

§4.1.1's anti-fake-probe design ("the probe must require the content-verified turn receipt,
not an adapter self-report") is real and precedented: the W1.4 probe
(`PROBE-RECEIPT.md`) content-verifies via `git show <sha>:deepseek-probe/hello.md` against an
exact expected line, and `projectedAdapterAuthentication` (`application-deployment.mjs:
971-1017`, confirmed exact line range) already demonstrates the isolated-runtime-plus-real-
adapter-call shape the #47 probe reuses. `authenticationReadiness()`
(`claude-session.mjs:389-432`) confirms the *existing* static check really is local-only
(`claude auth status --json`, 5s timeout, no model call) — so the contract's static-vs-live
distinction is coherent, not rhetorical.

**Gap:** the contract never names *which* code path performs the probe's content-verification,
nor states that it must be **the same** verification path a real turn's `verify.reverified`
event rides (the existing route-observation schema at `coordination-store.mjs:3360-3383`
already requires verification evidence to trace back to a `verify.reverified` operational
event, checked digest-for-digest at `coordination-store.mjs:3378-3382`). If the probe grows a
**bespoke** verifier instead of reusing that path, a subtly different bug (e.g. substring match
instead of exact match, or trusting adapter-reported success instead of the receipt) would
silently reopen exactly the "probe-as-fake" gap §4.1.1 red-teams against itself.

**Amendment:** D1 should state explicitly that probe content-verification rides the same
`verify.reverified`-sourced evidence path as `route.outcome_observed` (§1.4), not a new
parallel verifier, and RT-1 should assert this by construction (a bespoke-verifier fixture
must fail the test), not merely by behavior.

### 2.3 Replay / idempotency — DEFENDED

The liveness receipt `{route, probeId, latencyMs, observedAt, expiresAt}` (§4.1.1) is read
against `expiresAt > now` at cache-consult time (§4.1.3), so a replayed/stale receipt cannot
extend its own window — expiry is enforced structurally, not by trusting the receipt's
freshness claim. `refresh()`'s single-flight (`claude-credential-cache.mjs:265-285`, keyed on
credential path) and the route-observation schema's `observationDigest`/idempotency-key
binding (`coordination-store.mjs:3374-3381`) are the reused precedents; no hole found in the
replay surface specifically.

### 2.4 Scope leaks — DEFENDED, one precision gap

§4.2.1's sanitization claim ("no executable paths, no credential values, no private runtime
paths, no adapter output, no provider tokens", citing `application-deployment.mjs:921-969`) is
grounded: `publicHarnessVersion`/`publicRouteRuntime` (`application-deployment.mjs:926-969`,
confirmed) already whitelist-project only bounded, regex-validated atoms — no raw adapter
output ever crosses that boundary today. The roster's `learning`/`liveness`/`occupancy` fields
are new projections not yet covered by that exact sanitizer, so RT-8's "content scan proves no
credential/executable-path/token" is the right test, but the contract should name which
existing sanitizer function the new fields extend (`publicRouteRuntime`, or a new sibling) —
as written it asserts the *policy* inherits but not the *function*, leaving an implementer free
to write a parallel, potentially weaker, sanitizer for the three new fields.

## 3. Lifecycle Attacks

### 3.1 Ordering — DEFENDED

D1→ D2→D3 ordering in the contract (tier, then projection, then controllers) matches the
actual dependency graph: `fleet.roster` (§4.2.1) consumes the #47 cache tuple and coordinator
occupancy, both of which are prerequisites, not concurrent siblings. No ordering hole found.

### 3.2 Crash recovery — NEEDS-AMENDMENT (unstated, but the contract's own bound survives it)

§4.1.3/§5 state the liveness cache is **in-memory only, not a durable store in v1**. This
matters because Baton is a **resident-server** architecture, not a fresh-process-per-command
CLI: `impl/scripts/baton.mjs` shows ordinary commands (`doctor`, future `fleet roster`) are
thin `BatonWebClient`s that `discoverBatonConnection()` against a *running* `baton serve`
process (residency pinned via `connection.json` schemaVersion 2 `deploymentId`/`incarnation`,
`application-cli.mjs:208-260`) — only `baton serve` itself calls `openBaton()` and holds the
facade across calls. This is good news (it's what makes "never probe per call" true across
*separate CLI invocations*, not just within one wave-driver process) but the contract never
says so — §4.1.3 leaves the reader to assume the cache "just persists" without grounding
*why*, and never addresses what happens when the resident server restarts (crash, redeploy,
operator restart): every liveness cache row resets to absent in the new process.

This does **not** break the contract's own bound — RT-5's own worst case ("a cold wave
performs ≤1 probe per stale route") already covers "every route is absent," which is exactly
the post-restart state. So this is not a functional hole, but the contract's illustrative cost
claim (§4.1.2: "a small, bounded fraction of a wave's provider spend, and *zero* while the
cache is fresh") implicitly assumes long server uptime it never states, and a reviewer reading
§4.1.3 in isolation cannot tell whether "never probe per call" holds across CLI invocations at
all without independently discovering the resident-server model.

**Amendment:** cite `application-cli.mjs:208-260` (`discoverBatonConnection`'s residency
contract) as the reason the in-memory cache is safe to build without a durable store, and add
one sentence: "a `baton serve` restart resets every route to `absent`; the next wave's
preflight probes each once, bounded by RT-5's existing cold-wave case — this is a known,
accepted cost, not a gap."

### 3.3 Retention — DEFENDED (by explicit non-goal)

§5 explicitly disclaims a durable probe ledger as v1.1, and the acceptance suite doesn't
promise cross-restart retention. Consistent, no hole.

### 3.4 Freshness — CONFIRMED-HOLE (see §2.1 — this is the same hole, lifecycle-framed)

Restating for completeness under the lifecycle heading: the freshness invariant
("`state === 'verified' && expiresAt > now` → no probe", §4.1.3) is evaluated **per route**
and is *false* for a route whose credential died via a **different** route's probe. Freshness
here is a property of the credential, projected onto N route rows independently, with no
cross-row invalidation on write. Same fix as §2.1 (credential-keyed invalidation, not just
route-keyed reads).

## 4. Completeness — What the Contract Forgot

**Named missed hole (required by task scope): the `fleet.roster` capability-plane / naming
conflation (§4.2.2).**

§4.2.2 justifies `fleet.roster` as "registered in the ordinary capability plane
(`application-semantics.mjs:1099-1100` already lists the `fleet_*` operation family)" and in
the same breath says it mirrors "`route.advice`'s provenance (`cairn-run-scorecard.mjs:162`)."
Verified independently: `application-semantics.mjs:1099` lists
`['fleet_spawn', 'fleet_send', 'fleet_wait', 'fleet_respond', 'fleet_interrupt', 'fleet_result',
'fleet_list', 'fleet_kill', 'fleet_drain']` — **underscore-joined** operation names, in "the
ordinary capability plane." `route.advice` (`op: 'route.advice'`, `cairn-run-scorecard.mjs:
162`) is **dot-namespaced** and lives in Cairn's separate knowledge-capability plane
(`cairn-run-scorecard.mjs`), not `application-semantics.mjs` — `grep -n "route\.advice\|route_advice"`
across `impl/src/*.mjs` finds it *only* in `cairn-run-scorecard.mjs`. These are two different
registries with two different naming conventions that the contract borrows from
simultaneously: it wants `fleet.roster`'s **plane** from the `fleet_*` family (ordinary
capability plane) but its **name shape and provenance envelope** from `route.advice` (Cairn
plane). As drafted, an implementer has no single precedent to follow — `fleet_roster`
(matching its cited plane) and `fleet.roster` (matching its cited provenance shape) are not the
same registration and the contract picks neither explicitly.

**Amendment:** D2 must state which plane `fleet.roster` actually registers in. If it's the
ordinary capability plane (consistent with `application-semantics.mjs:1099-1100`), the
operation name should be `fleet_roster` for consistency with its siblings, and the
`routingMutationAuthority`/`workerAuthority` provenance fields need their own precedent in
that plane (not borrowed from Cairn's `_routeResult`). If it's meant to sit in Cairn's
knowledge-capability plane alongside `route.advice` (consistent with the dot name and the
provenance envelope), the citation should be `cairn-run-scorecard.mjs`, not
`application-semantics.mjs:1099-1100`, and RT-9's "one projection function" claim needs a
third consumer (Cairn's own capability dispatch) accounted for.

## 5. Campaign Control Law Compliance

Binding law (§3 of the contract, bidirectional-v3-decisions.md:115-125): controls on agent
work must be eval-able, constructive, or conversational — never clocks/turn-limits; no
"probe if idle > N minutes" liveness clock on real work.

**Probe TTL windows (§4.1.3) — DEFENDED.** These gate *whether Baton re-probes*, not whether
an agent's in-flight work continues or is judged. The exempt class the law names ("resource
circuit-breakers... a legitimate distinct class") fits cleanly.

**"`failed` is sticky within a bounded failure window" (§4.1.3) — NEEDS-AMENDMENT (textual,
not functional).** This mechanism is the one place in the contract that most closely mirrors
the law's own forbidden-pattern wording — "no decision below may introduce ... a 'probe if the
last activity was more than N minutes ago' liveness clock on real work." A sticky-failure
window is, read literally, "don't re-probe (and therefore don't unblock new spawns) until N
minutes have passed" — a clock gating whether **new real work** (a spawn) may start. The
contract's own §4.1.3 supplies the actual defense (the explicit `baton doctor --check` deep
path and the credential controllers' explicit refresh are **unstick** paths available
immediately, not gated by the window — the window only throttles the *automatic* re-check
cadence, satisfying "constructive" via the explicit ceremony), but §3's preamble never walks
through this specific mechanism against the law's own language, despite it being the
contract's closest call. **Amendment:** add one sentence to §4.1.3 or §3 explicitly
classifying the sticky-failure window as constructive-escape-hatch-bounded (not a bare clock),
the same way §3 already does for the 28-min TTL.

No other decision in the contract introduces a turn-limit, activity-idle clock, or per-turn
cap on agent work. The law is otherwise honored.

## 6. Verdict Summary

| # | Decision | Verdict | Amendment |
|---|----------|---------|-----------|
| 1 | §4.1.3 per-route liveness cache freshness (identity granularity) | **CONFIRMED-HOLE** | Join liveness cache rows to a `credentialKey`; invalidate all rows sharing a credential on `invalid_grant`/latch, not just the probed route. Add RT-14. |
| 2 | §4.1.1 probe content-verification path | NEEDS-AMENDMENT | Name the reused verification path (`verify.reverified`-sourced evidence, `coordination-store.mjs:3374-3382`); forbid a bespoke probe-only verifier. |
| 3 | §4.2.1 sanitizer reuse for new roster fields | NEEDS-AMENDMENT | Name the extended sanitizer function (`publicRouteRuntime` or a stated sibling), not just the policy. |
| 4 | §4.1.3 in-memory cache persistence across CLI invocations | NEEDS-AMENDMENT | Cite the resident-server/`discoverBatonConnection` model as why cross-invocation caching holds; state the post-restart cold-cache case is covered by RT-5, not a gap. |
| 5 | §4.2.2 `fleet.roster` capability-plane naming | **CONFIRMED-HOLE** | Pick one plane: `fleet_roster` in the ordinary capability plane (`application-semantics.mjs`), or `fleet.roster` in Cairn's knowledge plane (`cairn-run-scorecard.mjs`) — not citations from both. |
| 6 | §4.3.1 grok refresh runtime "vendor-for-vendor" port of `defaultRefreshRuntime` | **CONFIRMED-HOLE** | See detail below (§7 amendment 6) — grok's credential path is HOME-relative (`~/.grok/auth.json`), not an arbitrary-redirect env var; a literal port of Claude's sibling-file write-back target is wrong for grok. |
| 7 | §3 preamble vs. §4.1.3 sticky-failure window | NEEDS-AMENDMENT | Explicitly classify the sticky-failure window against the control law's own forbidden-pattern language, the way §3 already does for the 28-min TTL. |

## 7. Amendment Text (consolidated)

**Amendment 1 (credential-identity join, §4.1.3/§4.3.3):** *"The per-route liveness cache
tuple carries a `credentialKey` (the SHA-256 of the credential path for claude; a fixed
per-vendor key for grok/kimi — matching the single-shared-credential-object identity already
used by every vendor's static path: `nativeKimiAuthentication`/`nativeGrokAuthentication`
computed once and applied to every matching route, `application-deployment.mjs:1066-1096,
1585-1590`; `doctorReadiness()`'s claude credential block, `application-deployment.mjs:
1256-1259`). Any `invalid_grant` verdict — whether surfaced by a probe (§4.1.1) or a worker
turn (§4.3.3) — invalidates every liveness row sharing that `credentialKey` to `failed` in the
same write, not only the row for the route that produced the verdict."*

**Amendment 2 (verification path, §4.1.1):** *"Probe content-verification consumes the same
`verify.reverified`-sourced evidence path route-observations already require
(`coordination-store.mjs:3374-3382`); a probe never ships its own parallel verifier."*

**Amendment 3 (sanitizer, §4.2.1):** *"The roster's `liveness`/`occupancy`/`learning` fields
extend `publicRouteRuntime` (`application-deployment.mjs:939-969`) — or its stated named
sibling — not a new sanitizer."*

**Amendment 4 (cache persistence grounding, §4.1.3):** *"The liveness cache survives across
separate CLI invocations because ordinary commands are thin clients of one resident `baton
serve` process (`application-cli.mjs:208-260`'s residency contract); only a server restart
resets it, and that reset is exactly RT-5's already-bounded cold-wave case."*

**Amendment 5 (capability plane, §4.2.2):** *"`fleet.roster` registers as `fleet_roster` in
the ordinary capability plane (`application-semantics.mjs:1099-1100`'s `fleet_*` family);
its `routingMutationAuthority: false`/`workerAuthority: false` provenance fields are a new
precedent in that plane, not borrowed from Cairn's `route.advice` envelope."* (Alternative:
register in Cairn's plane instead and drop the `application-semantics.mjs` citation — either
is acceptable, but the contract must pick one.)

**Amendment 6 (grok refresh runtime write-back shape, §4.3.1):** Verified at
`impl/src/runtime-isolation.mjs:64-66`: *"Grok's native sandbox grants its expected `~/.grok`
tree, not an arbitrary `GROK_HOME` outside HOME. Keep HOME private and place the projected
config at that vendor-native path"* — the code sets `env.HOME = home` and nests the grok
config at `home/.grok` (`runtime-isolation.mjs:64,81`), because grok's CLI does **not** honor
an arbitrary redirect env var the way Claude's `CLAUDE_CONFIG_DIR` does. §4.3.1's claim that
`GrokCredentialCache` can reuse "the claude `defaultRefreshRuntime` shape (121-159),
vendor-for-vendor" elides this: `defaultRefreshRuntime` writes the projected credential to a
flat sibling file (`directory/.credentials.json`, `claude-credential-cache.mjs:132`) and reads
the write-back target from that same flat path. A literal vendor-for-vendor port for grok
would write/read `directory/auth.json` — the wrong path; grok's CLI, run with `HOME:
directory`, will look for and write `directory/.grok/auth.json`. Add: *"the grok refresh
runtime's projected-credential write and its write-back read both target
`directory/.grok/auth.json`, matching `runtime-isolation.mjs:64`'s established grok isolation
shape, not `claude-credential-cache.mjs`'s flat sibling-file convention."*

**Amendment 7 (control-law self-check, §3/§4.1.3):** *"The sticky-failure window (§4.1.3) is
not a work clock: the explicit `baton doctor --check` and `baton credentials refresh …` paths
unstick a route immediately, independent of the window's elapsed time — the window bounds only
the automatic re-probe cadence, satisfying the control law's 'constructive' carve-out the same
way the 28-min TTL satisfies its 'resource circuit-breaker' carve-out."*

---

*Cross-review note: this red-team is one of four parallel reviews of the L2 contract-storm
(#78 board worker-half, #81 orientation, #47+#83+#84 readiness-credentials — this doc, #85
browser-use). No cross-contamination with the other three contracts' findings was attempted or
assumed here.*
