[attempt: 2344e0b7-8929-4768-bbcf-695ec5dcb0c6 row-bt167]
# #167 BLUE-TEAM REPORT — attack on the readiness-honesty-red suite

- **Row:** `row-bt167`. Frame: `blue-team-2026-08-13-b/foundry-brief.md` (wave-b blue-team law — per-row
  cheapest-wrong-impl attacks, pin-bite attacks, split-twice, law re-check, attempt-echo).
- **Target:** `impl/test/readiness-honesty-red.test.mjs` (17 rows: 8 PIN green + 9 capability red; the #167
  red-first acceptance suite for the FOLDED v2 contract, header `[attempt: ea57954b-95c1-4918-a494-41b0249738ee row-suite-167]`).
- **Authority contract:** `docs/reference/evidence/contract-foundry-2026-08-13/contract-167.md` (v2 FOLDED).
  Companions read: `redteam-167.md` (2 citation/mechanism blockers + 2 structural holes + amendments), `fold-167.md`
  (blocker→resolution map), `suite-notes-167.md` (row↔stage inventory + measured splits + judgment calls). The attack
  is against the SUITE's ability to enforce that intent — the contract is the map, not the target.
- **Verification HEAD:** this worktree is pinned to `e371f70` (the contract's and suite's declared HEAD). The suite
  file is not present in this worktree (it landed after `e371f70`); it was read from master and temporarily copied in
  to run the splits and bite-tests, then removed. All bite-test source mutations were reverted from backups; `git
  status` clean at close.

---

## 0. Split record (split-twice law — run from the repo root, worktree at HEAD `e371f70`)

```
node --test impl/test/readiness-honesty-red.test.mjs
```

| Run | tests | pass | fail | Result |
|---|---|---|---|---|
| Run 1 | 17 | 8 | 9 | 8 PIN rows green; 9 capability rows red |
| Run 2 | 17 | 8 | 9 | identical split (stable) |
| Close (after all bite-tests reverted) | 17 | 8 | 9 | identical split (mutations cleanly reverted) |

All three runs match the suite's declared split and `suite-notes-167.md`'s measured splits exactly ("17 tests, 8 pass /
9 fail"; GREEN = A1p, A3p, A4p, A5p, A6p, P-stale, A-L, A-Lcap; RED = V-stale, A1a, A1b, A1c, A2, A3, A4, A5, A6).
Every RED row fails at its NAMED stage (the `stage X:` message was captured for all nine). **Split-twice law:
satisfied** (three runs on the pristine tree — two for the split record, one at close to prove the bite-test
mutations left no residue).

---

## 1. Per-row verdicts

### Capability rows (RED at HEAD) — cheapest wrong impl per row

| Row | Verdict | Cheapest wrong impl that turns it green (or none found) |
|---|---|---|
| A1a `[enumerable honest projection]` | **SOUND** | None found. The three legs — static-only `unverified`/null, fresh content-verified → `probe-verified` with `probedAt` = ISO(verifiedAt), and JSON-survival — require the projection to actually read the liveness cache and map `state`→`verdict` + `verifiedAt`→ISO `probedAt`. That mapping IS the contract; no cheaper wrong impl exists (a constant `unverified` fails the probe-verified leg; a sticky `probe-verified` fails the static-only leg; a raw-number `probedAt` fails the ISO leg). |
| A1b `[roster projection]` | **SHALLOW** | Hardcode `verdict: 'unverified', probedAt: null` on the roster row. **Demonstrated:** the two-line hardcode on the `publicRosterRow` literal flips it green with zero liveness wiring — a real probe would be misreported on the fleet view. A1b asserts only the static-only form (never drives a probe and checks the roster's `probe-verified` form). Backstopped only by A1a's behavior IF the roster composes the same row (`#rosterProjection`); the row itself does not pin that. |
| A1c `[northbound re-add]` | **SHALLOW** | Dead token references in the three re-add slices. **Demonstrated:** adding `const honest = { probedAt: null, verdict: 'unverified' }; void honest;` to `_handleOperatorRead`, `BatonWebClient.doctor()`, and `_freshDoctorReadiness` flips A1c green while the wire payload still drops the honest fields. The D2 wire-survival law (fold blocker 3) is asserted only as token presence; the actual HTTP/MCP response is never inspected. |
| A2 `[on-demand forced probe]` | **SHALLOW** | Dead `forceProbe` tokens in the baton.mjs doctor branch, `BatonWebClient.doctor()`, and `_handleOperatorRead`. **Demonstrated:** adding `const forceProbe = false;` to each flips A2 green while NO probe ever fires. The row's name claims "forces exactly one fresh probe per stale route" — the suite never runs the operator chain, never counts probes, and never asserts a cache-fresh route probes zero times. Purely a source scan. |
| A3 `[typed refusal vocabulary]` | **SHALLOW** | Add the four probe-code rows to `PROVIDER_TERMINAL_GUIDANCE` (+ include a "re-probe" token in the quota row text). **Demonstrated:** adding the four rows as PURE DATA (no behavior change — `projectProviderTerminalCause`'s existing table lookup then resolves) flips it green. The behavior leg drives only `probe_content_mismatch`; `provider_unreachable`/`probe_oversize`/`provider_quota` are source-scan-only. The no-auto-re-probe law is text-pinned: `/no automatic re-probe|operator surface|re-probe/` passes for a row that merely mentions "re-probe" while the automatic cadence is unchanged — a false green. |
| A4 `[quota/capacity death class]` | **SOUND (classification) / SHALLOW (cadence)** | Classification separation is behavioral and real: a completed AND a failed quota wire both must classify `provider_quota` (RED at HEAD, where they collapse to `probe_content_mismatch`/`provider_unreachable`). **Demonstrated:** the two-line wrong impl (quota-wire regex branch in the probe classifier + a `provider_quota` return inside `ensure`, both dead relative to the contract) flips the WHOLE row green — no typed projection, no real cadence exclusion — while A4p correctly stays GREEN (quota ≠ invalid_grant). The **no-auto-re-probe leg is a token scan** on the `ensure` slice (`/provider_quota|quota/`): a wrong impl that classifies quota but never excludes the automatic `failureWindowMs` cadence passes. |
| A5 `[honest-projection refusal]` | **SOUND (refusal) / heuristic (no-substitution)** | The refusal leg is behavioral: a `die`-mode probe → `failed` verdict → preflight refuses `wave_driver_route_unready` BEFORE any member spawn (the fixture's `waves.start` throws `fixture_preflight_passed`, so the distinction is real). The no-substitution leg is the token heuristic below. |
| A6 `[spawn-gate coverage]` | **SHALLOW** | Dead `void this.#livenessGate;` references in `startMany`/`workflow`/`explore`/`review`. **Demonstrated:** adding one to each flips A6 green while no spawn is ever gated. The contract's D1 trigger-1 claim ("the cache is consulted before ANY real provider turn" on all five surfaces) is asserted only as token presence in each method slice — no sibling-surface spawn is ever driven against a dead route. |
| V-stale `[lapsed-window verdict]` | **SOUND** | None found. The lapsed-transition is behavioral: probe, advance the injected `now` past the grok window, re-read, assert `verdict: 'unverified'` + `probedAt` = ISO(recorded verifiedAt). This bites a sticky verdict AND a projection that uses the real clock (the injected-`now` advance would not move `Date.now()`, so a real-clock impl still reads `probe-verified` and fails). |

### PIN rows (GREEN at HEAD) — the plausible wrong impl each kills

| Row | Verdict | Plausible wrong impl it kills (or decorative) |
|---|---|---|
| A1p `[static substrate]` | **SOUND** | Kills relabeling a static-only read `probe-verified` (cardinal law), leaking `liveness`/`occupancy` into the enumerable row (DP5), or losing the honest `unverified`. Green for the right reason — the substrate is genuinely byte-stable at HEAD. |
| A3p `[existing refusal table]` | **SOUND** | Kills rewriting the typed vocabulary without the four landed codes and their `{category, summary, remediation, retryable}` shape. |
| A4p `[F-1 fan-out + quota negative control]` | **SOUND** | Behavioral: a quota/capacity worker-turn death fires NO invalid_grant credential fan-out (the grok sibling and the codex negative control survive); the landed `invalid_grant` class still invalidates every same-`credentialKey` row and only those. Bites both directions. |
| A5p `[static preflight refusal + no substitution]` | **SOUND** | Kills admitting a static-blocked member to preflight instead of refusing `wave_driver_route_unready`. (The no-substitution leg shares the token heuristic below.) |
| A6p `[assertRouteReady all five surfaces]` | **SOUND** | Kills removing the static gate from a spawn surface while folding in the liveness gate (the gate is additive, never a replacement — G1). |
| P-stale `[landed staleness law]` | **SOUND** | Kills a sticky `liveness.state` (once verified, always verified) or a projection that reports stale-`verified` after the window lapses. Direct RouteLiveness drive with injected mutable `now`. |
| A-L `[fixture-lint]` | **SOUND** | Kills a vacuous fixture — a mode claiming a wire it does not plant. Proves each `LivenessAdapter` mode emits the exact wire it names (complete pin, quota wire, die/process_closed, wrong non-pin, invalid_grant, noisy-beyond-bound). |
| A-Lcap `[bounded-capture law]` | **SOUND** | Kills an unbounded contains-scan verify: a probe whose exact pin sits beyond the 2KiB capture bound fails `probe_content_mismatch` through the REAL RouteLiveness classification (route-liveness.mjs:237-241), never a fabricated verify. Behavioral, against the live controller. |

**No PIN row is decorative; no capability row is trivially green by accident.** The suite's genuine teeth are the
behavioral rows — A1a (projection), A4 (quota classification), A5 (preflight refusal), V-stale (staleness), and the
eight pins. The shallow rows are the source-scan rows (A1c, A2, A6, A3's 3-of-4 codes, A1b's static form), each of
which asserts token EXISTENCE rather than the behavior its name claims.

### Empirical bite-test matrix (reproduced this session)

Two directions: (a) **PIN rows** — mutate the impl byte the pin guards and confirm the pin flips RED; (b) **capability
rows** — add the cheapest wrong impl and confirm the row flips GREEN. Each mutation was applied to a pristine source
file, the row re-run, then the file reverted from backup. The pristine split (17 · 8/9) was re-confirmed after every
round and at close.

**PIN bite-tests — every pin flips RED under its named wrong impl:**

| Pin | Wrong impl mutation (the bug the pin guards) | Pin result |
|---|---|---|
| A1p | `liveness` sibling re-defined `enumerable: true` (leaks into `Object.keys`) | ✖ RED — `Object.keys(row).includes('liveness')` fails |
| A3p | `provider_crashed` row deleted from `PROVIDER_TERMINAL_GUIDANCE` | ✖ RED — the row is gone |
| A4p | quota/capacity wire added to the worker-turn `invalid_grant` matcher (`_onAdapterEvent`, route-liveness.mjs:115) | ✖ RED — the quota death fans out and kills the grok sibling |
| A5p | dead `const fallback = null;` token inside `matchRoute` (a substitution seam) | ✖ RED — `matchSlice.includes('fallback')` fires |
| A6p | `assertRouteReady` removed from `explore()` | ✖ RED — the surface no longer consults the static gate |
| P-stale | lapsed-`verified` branch made sticky (`projected = { ...row }`, route-liveness.mjs:368-370) | ✖ RED — and its twin **V-stale also flipped RED** in the same run |
| A-L | (fixture self-lint — no impl byte) the wrong impl it kills is a vacuous fixture: an adapter mode that claims a wire it never plants fails its own lint at A-L's assertion lines | green-for-the-right-reason |
| A-Lcap | verify changed to contains-scan over the FULL (unbounded) output | ✖ RED — the beyond-bound pin verifies |

**A-Lcap resistance note:** the naive "drop the bound only" mutation (`output.slice(0, PROBE_CAPTURE_MAX_BYTES)` →
full output, keeping the exact-match `===`) did **NOT** flip A-Lcap — the noisy output still is not exactly the pin,
so it still fails `probe_content_mismatch`. The pin only falls to the two-change wrong impl (unbounded **and**
contains-scan). This is a genuinely strong pin.

**Capability rows — SHALLOW verdicts demonstrated green under a wrong impl that does NOT perform the named behavior:**

| Row | Cheapest wrong impl (demonstrated) | Row result |
|---|---|---|
| A2 | `const forceProbe = false;` in the baton.mjs doctor branch, `BatonWebClient.doctor()`, `_handleOperatorRead` | ✔ GREEN — no probe ever fires |
| A6 | `void this.#livenessGate;` in `startMany`, `workflow`, `explore`, `review` | ✔ GREEN — no spawn is ever gated |
| A1c | `const honest = { probedAt: null, verdict: 'unverified' }; void honest;` in the three re-add slices | ✔ GREEN — the wire payload still drops the honest fields |
| A1b | `verdict: 'unverified', probedAt: null` hardcoded on the `publicRosterRow` literal | ✔ GREEN — zero liveness wiring; the roster carries static shape |
| A3 | the four probe-code rows added to `PROVIDER_TERMINAL_GUIDANCE` as pure data (no behavior change; `projectProviderTerminalCause`'s existing table lookup then resolves) | ✔ GREEN — only data existence + one table lookup are pinned |
| A4 | quota-wire regex branch in the probe classifier (`_settleProbe`) + a `provider_quota` return in `ensure()` (two dead lines, no typed projection, no cadence change) | ✔ GREEN — A4p correctly stayed GREEN (quota ≠ invalid_grant) |

All mutations reverted; the final pristine split re-ran at 17 · 8/9 and `git status` shows only the deliverable
directory. This is the strongest evidence of the SHALLOW verdicts: **a wrong implementation that never performs the
claimed behavior turns each of these six acceptance rows green**, and the behavioral rows (A1a, A5-refusal, V-stale)
plus the A4p/A-Lcap pins resisted every cheaper attempt this session.

---

## 2. Law re-check (frame checklist against the suite)

- **Named stages on every capability row** — yes: every capability test name carries its canonical stage and every
  failing assertion carries the granular `stage[<…>]` message (captured for all nine RED rows in §0). No row fails at
  a later stage than the one it names.
- **Hermetic (mkdtemp + after-cleanup, no network/provider)** — yes: every root is `mkdtempSync` under `os.tmpdir()`
  and removed in `test.after`; the only subprocesses are `git init` on temp roots and the `true` verification; probes
  are faked at the `LivenessAdapter` seam (never a real provider spawn); no network surface is touched.
- **No clocks as controls** — yes: the only clock touches are the deterministic injected epoch (`NOW`, a constant) and
  bounded async settling (`setTimeout(0)` + flush loops); `Date` appears only as content-derived ISO formatting of the
  recorded measurement. No `Date.now`, no timers as workflow gates.
- **Namespace imports for invented surfaces** — yes: imports only real exports (`openBatonDeployment`, `createDriver`,
  `createWaveDriver`, `RouteLiveness`, `projectTypedTerminalCause`). The invented `forceProbe`/`verdict`/`probedAt`
  surfaces are asserted by source scans, never imported.
- **Sorted-key literals ACTUAL order** — **FLAG (see finding 5).** The `LivenessAdapter.card()` fixture literals
  (`permissions: { mode, boundary }`, `workerPolicy.autonomy/access/containment`) are NOT in ACTUAL code-unit order.
  The suite header documents the author's carve-out ("no key-order literal is asserted") — and indeed no assertion
  ever serializes/compares these fixture keys — but under the frame's strict "Sorted-key literals ACTUAL order"
  wording this is a divergence to record. `localeCompare`: none (only the header's law statement).
- **watchdog.stallMs 60_000 + comment** — yes: every `openFixture` overrides `stallMs: 60_000` with an explicit
  suite-law comment (line 338); `stallAction` stays 'escalate'.
- **No absolute line-window anchors (#166)** — yes: source extraction is `methodSlice` (brace-balanced on the method
  signature) and `sliceBetween` (anchor-pair), never absolute line windows.
- **Verbatim `[attempt: …]` line in the suite header** — yes (line 1).

---

## 3. Findings (blue-team, against the contract's intent)

1. **[missing-behavior / HIGH] A2 never exercises the on-demand probe — the operator's primary unstick is token-pinned.**
   The contract's A2 acceptance is behavioral: "`baton doctor --check` forces exactly one fresh probe per
   stale/absent liveness route before returning the updated honest projection; … a cache-fresh route probes zero
   times; a failed probe returns the typed verdict in the read." The suite asserts NONE of that — it only checks that
   the tokens `forceProbe`/`probedAt` appear in three method slices. A wrong impl that accepts a `forceProbe` signal
   but never forces a probe (demonstrated: a dead `const forceProbe = false;` flips the row green) passes. The fold
   should drive the operator chain behaviorally: a liveness-wired fixture with one stale route → `baton doctor
   --check` → assert exactly one probe fired (`probeInvocations` count), a cache-fresh route → zero, and the returned
   read carries the typed verdict.

2. **[missing-behavior / HIGH] A6 never gates a spawn — the five-surface `#livenessGate` claim is token-pinned.**
   D1 trigger-1's core is "the cache is consulted before ANY real provider turn" on all five spawn surfaces. The
   suite scans each method slice for the token `#livenessGate`; a dead `void this.#livenessGate;` reference
   (demonstrated) turns it green while a `startMany`/`workflow`/`explore`/`review` spawn still rides no liveness
   check. Only `run()` (and wave preflight via A5) is behaviorally gated. The fold should drive one sibling surface
   (e.g. `startMany` or `explore`) against a liveness-failed route and assert the typed refusal before any provider
   turn — mirroring the `run()` gate semantics the contract claims.

3. **[oracle-weakness / MEDIUM] A1c pins token presence, not the wire payload — the D2 wire-survival law (fold
   blocker 3) is unpinned at the transport.** The fold required enumerable `verdict`/`probedAt` that "an operator wire
   read … carries". A1a proves the fields are enumerable on the row object (and survive `JSON.parse(JSON.stringify(row))`),
   but A1c — the actual northbound re-add — asserts only that each re-add site's source mentions `probedAt`/`verdict`.
   A dead reference (demonstrated) passes while the HTTP/MCP response still drops the fields. The fold should assert
   the wire payload itself: drive `_handleOperatorRead`/`BatonWebClient.doctor()`/`_freshDoctorReadiness` against a
   liveness-wired fixture and inspect the serialized response for `verdict` + `probedAt`.

4. **[coverage-gap / MEDIUM] A3 behaviorally pins one of four probe codes; A4 pins the cadence by token.** The A3
   behavior leg drives only `probe_content_mismatch` through `projectTypedTerminalCause`; `provider_unreachable`,
   `probe_oversize`, and `provider_quota` are source-scan-only, so a projection that special-cases one code passes
   while the others still collapse to `GENERIC_PROVIDER_TERMINAL_GUIDANCE`. A4's no-auto-re-probe (OQ3) is a token
   scan (`/provider_quota|quota/` on the `ensure` slice) — a wrong impl that classifies quota but never excludes the
   automatic cadence passes. The fold should drive all four probe codes through the projection and assert the
   no-auto-re-probe cadence behaviorally (probe-count stays flat across an elapsed `failureWindowMs` on a quota-dead
   route, vs. re-probing on a non-quota failure).

5. **[law-flag / LOW] Unsorted-key fixture literals in `LivenessAdapter.card()`.** `permissions: { mode, boundary }`
   and `workerPolicy.autonomy/access/containment` are not in ACTUAL sorted-key order. The suite's header documents the
   author's carve-out ("no key-order literal is asserted"), and the literals are property-accessed, never
   serialized-compared — so the divergence is inert today. Under the frame's strict wording it is still a flag: sort
   the fixture keys or record the carve-out in `suite-notes-167.md`.

6. **[heuristic / LOW] The no-substitution scans (A5, A5p) are token-name-dependent.** `matchRoute` absence of
   `fallback|alternate|substitute|router` is defeated by an impl that names its substitution differently (`pick`,
   `seat`, `otherRoute`). This matches the contract's own source-scan floor ("behavior + source-scan"), and no reroute
   code exists at HEAD — recorded as the known limit of the heuristic, not a new hole.

---

## 4. Fold instruction set (concrete)

1. **Add a behavioral leg to A2** (finding 1) — drive `baton doctor --check` / the operator chain against a
   liveness-wired fixture: exactly one probe per stale route, zero for cache-fresh, typed verdict in the read.
2. **Add a behavioral leg to A6** (finding 2) — drive one sibling spawn surface against a liveness-failed route and
   assert the typed refusal before any provider turn.
3. **Pin the A1c wire payload** (finding 3) — inspect the actual serialized HTTP/MCP response for `verdict` +
   `probedAt`, not just the re-add site's source.
4. **Widen A3's behavior leg to all four probe codes** and pin the A4 no-auto-re-probe cadence behaviorally
   (finding 4).
5. **Sort the `card()` fixture literal keys** or record the carve-out (finding 5).
6. Fold-along: extend A1b to assert the roster's `probe-verified` form (kills the hardcoded `unverified` roster), so
   the fleet view's honesty is pinned behaviorally, not just shape-only.

---

## 5. Final verdict — **NEEDS-FOLD**

The split is deterministic (17 · 8/9, twice, matching the declared notes) and stage honesty is clean — no row is red
for the wrong reason at HEAD, no fixture bug, no vacuous pin: the fixture-lint (A-L) and the bounded-capture pin
(A-Lcap) both prove their wires behaviorally, and the eight PIN rows all bite a named mutation. The suite's behavioral
core is genuine: A1a pins the honest projection's cardinal law, A4 pins the quota-classification separation, A5 pins
the preflight refusal before spawn, V-stale pins the verdict-level staleness law, and A4p pins the credential fan-out
negative control.

But the suite is not implementation-safe for the #167 acceptance it claims to be: **six acceptance rows are green
under a wrong implementation that performs none (or none-but-the-shape) of the behavior their names claim** — A2
(on-demand forced probe, demonstrated dead-token green), A6 (five-surface spawn gate, demonstrated dead-token green),
A1c (D2 wire survival, demonstrated dead-token green), A1b (roster projection, demonstrated hardcoded-shape green),
A3 (typed refusal vocabulary, demonstrated pure-data green), A4 (quota class + cadence, demonstrated two-dead-line
green) — while **A3 behaviorally covers one of four probe codes** and the no-auto-re-probe cadence (OQ3) is
text/token-pinned. These are core acceptance pins (A1's wire leg, A2, A3, A4, A6), so the suite "manufactures
confidence" on exactly the surfaces the fold's blockers 2/3/4 resolved. Findings 1–3 are blocking; 4–6 are
fold-along. The per-row SHALLOW verdicts on A1b/A1c/A2/A3/A4/A6 are not individually fixable as one-line edits —
each needs a behavioral (or payload-inspecting) leg.

**Named rows for the fold:** A2 (behavioral forced-probe), A6 (behavioral spawn-gate), A1c (wire-payload pin), A3
(all-four-code projection), A4 (cadence), A1b (probe-verified roster form), plus the sorted-key law flag.

---

## 6. Shared-scratchpad publish — failed; exact refusal recorded

Per the frame, the report was to be published to the `shared` scratchpad partition (title `#167`). Attempted from
this worktree at HEAD `e371f70`:

```
node impl/scripts/baton.mjs run scratchpad write shared "#167 blue-team report"
   →  baton: cli_invalid: unexpected argument write   (exit 2 — the refusal is the CLI's)
```

**Exact refusal:** the scratchpad facade at HEAD exposes only `run.scratchpad.read` and `run.scratchpad.elevate`
(`application-cli.mjs:1476-1506`); there is **no client-addressable scratchpad write verb**, so a `kind=note` publish
to the `shared` partition cannot be addressed from the client surface. This is the same refusal the binding contract's
own header records (`contract-167.md:30-45`: the only write up-channel is the coordinator's `scratchpad.write` dispatch,
scoped to `worker:<id>` and reachable only inside a live authenticated worker stream; promotion to `shared` is a
coordinator/steering elevation) and `suite-notes-167.md` §Shared-scratchpad-publish. Per `coordinator-brief.md`
(line 12) the coordinator falls back to the durable files where the shared post is absent — **this file IS the
publish**; the refusal is the evidence.

## 7. Deployment verification

Executable `"true"`, args `[]`, cwd `"."` — expected exit 0:

```
true   →   exit 0   (verified)
```
