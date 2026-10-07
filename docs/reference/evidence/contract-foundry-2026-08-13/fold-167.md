[attempt: 31545279-5f3c-49ad-809b-2492a09b0efc row-fold167]
# FOLD #167 — the bounded actual-inference readiness tier (contract v1 → v2)

- **Row:** row-fold167 (fold-foundry wave-b)
- **Folded contract:** `docs/reference/evidence/contract-foundry-2026-08-13/contract-167.md` (v2, in
  place — version bumped, fold record appended)
- **Raw material:** the v1 contract (same dir), `redteam-167.md` (same dir, NOT FOLD-READY),
  `review-foundry-2026-08-13-b/review-qa.md` §4 (blind QA).
- **Blind-QA law applied:** the QA's §4 "SOUND with one amendment" was written WITHOUT the row
  report; where it conflicts with the row report, the row report governs. The QA's §4.4 fold set is
  binding and is largely disjoint from the row blockers.
- **Verification HEAD:** `e371f704727cbca5fdff86af31ec8b154620a71f`. Every citation the fold touched
  was re-verified THIS session (`sed -n` / `grep -an`; NUL discipline on `application.mjs` +
  `coordination-store.mjs`) before writing.

---

## Resolution map

Every blocker / amendment / note in `redteam-167.md` and every numbered instruction in the QA's §4.4
set is resolved below: FOLDED (contract text changed — new section cited), STRUCK (with evidence), or
RECORDED (no text change needed). No silent drops.

### Red-team blockers

| # | Blocker | Resolution | Folded location |
|---|---|---|---|
| 1 | Shared-publish citation `coordinator.mjs:12693` "wrong"; re-cite to `coordinator.mjs:11103` | **STRUCK (evidence)** — the `:11103` re-anchor is refuted: `sed -n 11103p` yields `// generated leaves carry typed structural fields ONLY — free prose smuggled into a` (orientation-leaf code). `sed -n 12693p` yields `const receipt = this.writeScratchpad(workerId, payload?.entry, {` inside the `case 'scratchpad.write':` handler (:12690-12697) — the ORIGINAL anchor is correct. The coordinator's `writeScratchpad(workerId, entry, opts)` method is at `coordinator.mjs:10790`; the store side `writeScratchpad(fields, auth)` at `coordination-store.mjs:14064` (verified via `grep -an`) is correct as stated. Citation **FOLDED for precision**: the header's shared-publish note now cites `:12690-12697` (dispatch) + `:10790` (method) + `:14064` (store). | contract §header (Shared-scratchpad publish) |
| 2 | G5/A2 anchor the `--check` failure at `application-cli.mjs:2213`, but the operator never reaches that seam — the real `baton doctor --check` runs `impl/scripts/baton.mjs:79-98` → `BatonWebClient.doctor()` (`application-cli.mjs:1961`) → `/readyz` + `/v1/application-card`, never forcing a probe | **FOLDED** — G5 rewritten to pin the operative path (baton.mjs:79-98, `parsed.check` read at :81; BatonWebClient.doctor :1961-1978; web-northbound :1173/:1181). D1-trigger-3 re-anchored. A2 now asserts the operator surface end-to-end and that a fresh probe fires per stale/absent route on `baton doctor --check`, with a web-northbound forced-probe parameter on `/v1/application-card`. | contract §G5, §D1-trigger-3, §A2 |
| 3 | HOLE D2/A1 — the honest projection vanishes on the wire: non-enumerable `liveness`/`occupancy` dropped by JSON serialization (`application-deployment.mjs:1348-1349`); web-northbound re-adds only `briefing` (`web-northbound.mjs:1507-1513`); the roster's enumerable `liveness` has no wire surface | **FOLDED** — D2 requires enumerable (JSON-surviving) `verdict`/`probedAt` on the doctor route row; the "OR the stated non-enumerable sibling" clause struck (verified the defineProperty non-enumerability at application-deployment.mjs:1348-1349 and the `briefing`-only re-add at web-northbound.mjs:1504-1513). The northbound re-add (the D6c `briefing` precedent) is required for `/v1/application-card` (web-northbound.mjs:1504-1513), the CLI doctor read (application-cli.mjs:1961-1978), and `deployment.doctor` (mcp-northbound.mjs:1804-1808). A1 asserts an operator wire read carries `verdict` + `probedAt`. | contract §D2, §A1 |
| 4 | HOLE D1 — the probe gate covers only `run()` + wave preflight: `#livenessGate` wired only at `application-deployment.mjs:1446`; `startMany` (:1450-1457), `workflow` (:1459-1466), `explore` (:1468-1471), `review` (:1473-1480) call only `assertRouteReady` | **FOLDED** — D1-trigger-1 expanded to every provider-spawn surface; new pin A6 source-scans that `#livenessGate` is consulted on all five surfaces before any real turn (RED at HEAD: only `run()` :1446 wired). Until wired, an unwired surface is honest-read-only — the contract's claims shrink to the wiring rather than overstate it (verified: the four siblings call `assertRouteReady` only). | contract §D1-trigger-1, §A6, §Non-goals |

### Red-team amendments

| # | Amendment | Resolution | Folded location |
|---|---|---|---|
| (a) | State in D1's honesty paragraph that the probe is a liveness ping, not a capacity probe — a provider that answers the ping but 402s the real wave passes the probe | **FOLDED** — D1 cost-honesty paragraph now says exactly this ("What the probe does and does not prove"), names the residual, and points to A4's worker-turn classification as the post-hoc catch. | contract §D1 |
| (b) | Fold OQ4 into A1/A2 as a wire-survival requirement | **FOLDED** — OQ4 resolved; wire-survival is now part of A1 (enumerable + transport) and A2 (operator path); OQ4 marked FOLDED in the open questions. | contract §OQ4, §A1, §A2 |
| (c) | Give `provider_quota` a no-auto-re-probe window decision (OQ3) | **FOLDED** — `provider_quota` excludes automatic re-probe (operator surface only); carried in the refusal table, A4, OQ3 (DECIDED). | contract §Refusal vocabulary, §A4, §OQ3 |

### Red-team notes (RECORDED — each dispositioned, no silent drop)

| # | Note | Resolution |
|---|---|---|---|
| N1 | `resource.provider_call` receipt is self-attested (adapter is the trust boundary) | RECORDED + FOLDED — D1's honesty paragraph states the receipt "attests that the adapter reported a call, not a billing statement"; inherent, not a defect. |
| N2 | Preflight admits an unsupported (non-pausable) route unverified (`state: 'unsupported'` → `unverified`, never `failed`, wave-driver.mjs:325-335) | RECORDED — already stated (D2: unsupported → `unverified`, additive-never-block; wave-driver preflight); posture intentional (every real adapter is `pausable`). |
| N3 | Nit — `limits.mjs` FRAME_LIMITS span is :53-111, merged export at :115 | RECORDED + FOLDED — G7 re-cites `limits.mjs:53-111, merged export :115`. |
| N4 | Nit — the route-liveness header quote spans :3-6 | RECORDED + FOLDED — G2 re-cites `route-liveness.mjs:3-6`. |
| N5 | Nit — "they bound spend, not progress" sits at `bidirectional-v3-decisions.md:143-144` | RECORDED + FOLDED — control-law preamble re-cites `:143-144`. |
| N6 | §2-D3 coupling — the "inform" channel is wire-blind for any external orchestrator until the D2 fix lands | RECORDED + FOLDED — D3 states the external orchestrator's defer-to-a-live-seat read is gated on D2's enumerable + northbound re-add. |
| N7 | §3 note — the worker-turn finding classifies only `invalid_grant|revok`; a real-turn 402/capacity death collapses to the generic until the OQ2 wire grammar lands | RECORDED — OQ2's framing covers it (A4's "or worker turn" rides the same live-receipt wire grammar). |
| N8 | §8 corroborations — operator seam exercised (`baton doctor --check` consumed locally, never reaches :2213); `fleet_roster` zero wire exposure; no-reroute holds across the spawn layer (wave.mjs:90-99, :196-197); probe economics coalesce per route; shared-scratchpad publish non-executable | RECORDED — corroborate blockers 2/3, D3 SOUND, D1 economics, and the header's shared-publish note; no new blocker. |

### QA §4.4 fold set (#167) + verdict conflict + red-team pin verdicts

| # | Instruction | Resolution | Folded location |
|---|---|---|---|
| — | QA §4.1 verdict "SOUND with one amendment" vs the row report's NOT FOLD-READY | RESOLVED per the blind-QA law — the row report governs on conflict; the row's 4 blockers stand and are folded above. The QA's own amendment (H1) is folded; its §4.4.2/3 set is kept/folded. | header + §Fold record |
| — | Red-team §4 pin verdicts: A3 (typed probe failures) RED-at-HEAD, SOUND; A5 (never reroute) RED-at-HEAD, SOUND | KEPT as written — both pins are not shallow-greenable (source-scan / behavior+source-scan); no text change. | contract §A3, §A5 |
| 1 | H1 — rename/re-scope `verdict: 'alive'` → `probe-verified`; carry the caveat into the D2.3 teaching sentence | **FOLDED** — D2 shape + cardinal law use `probe-verified`; the teaching sentence ("probe-verified means passed a bounded one-token content-verified probe within the recorded window — NEVER will complete a real turn") added. | contract §D2 |
| 2 | Keep the bounded probe shape, the `{static, probedAt, verdict}` projection + staleness law, and the refuse-or-inform-never-reroute admission as written | **KEPT** — D1 bounds, D2 staleness law, D3 admission unchanged in substance (only the label + wire-survival amendments from the row blockers ride them). | contract §D1, §D2, §D3 |
| 3 | Fold OQ2 (quota/capacity wire grammar) as a live-receipt follow-on; keep A4's classification-separation fixture as the pinned floor | **FOLDED** — OQ2 retained as the live-receipt follow-on (the first `baton doctor --check` forced probe of a quota-dead route records the observed wire); A4 keeps the classification-separation fixture as the pinned floor. | contract §OQ2, §A4, §Verification |

---

## Verification record (fold-time)

- `coordinator.mjs:12693` → `const receipt = this.writeScratchpad(workerId, payload?.entry, {` (dispatch `case 'scratchpad.write':` :12690-12697). `:10790` → `writeScratchpad(workerId, entry, opts = {})`. `:11103` → orientation-leaf comment (NOT writeScratchpad — the red-team's re-anchor is refuted).
- `coordination-store.mjs:14064` → `writeScratchpad(fields, auth) {` (grep -an, NUL file).
- `impl/scripts/baton.mjs:79-98` → the inline `parsed.kind === 'doctor'` branch; `if (!parsed.check || local.state !== 'configured')` at :81; `clientFor(discoverBatonConnection()).doctor()` in the else branch.
- `application-cli.mjs:1961-1978` → `async doctor()` reads `/readyz` + `/v1/application-card`; `:2213` → `if (parsed.kind === 'doctor') return client.doctor();` (library seam — the operator does not reach it).
- `web-northbound.mjs:1173` (`/readyz`), `:1181` (`/v1/application-card`), `:1470` (`_handleOperatorRead`), `:1504-1513` (re-adds only `briefing`).
- `application-deployment.mjs:1348-1349` → `Object.defineProperty(composed, 'liveness'/'occupancy', { enumerable: false })`; `:1444-1447` `run()` with `#livenessGate` at :1446; `:1450-1480` `startMany`/`workflow`/`explore`/`review` call `assertRouteReady` only; `#livenessGate` method :1376-1381.
- `mcp-northbound.mjs:1804-1808` → `baton_deployment_doctor` result via `_freshDoctorReadiness()`.
- `wave-driver.mjs:302-337` → preflight; `matchRoute` :161-172 (no substitution).
- `route-liveness.mjs:3-6` → the tier header comment (G2 re-cites :3-6; the red-team's span nit absorbed).
- `bidirectional-v3-decisions.md:143-144` → control law :134-143; "they bound spend, not progress" at :144 (control-law preamble re-cites :143-144).

## Bottom line

Every row-report item and every QA instruction is dispositioned — no silent drops:
- **4 red-team blockers** — 1 STRUCK with evidence (`:11103` re-anchor refuted; the original
  `:12693` anchor verified correct, method at `:10790`) + 3 FOLDED (bl.2 operator path, bl.3 wire
  survival, bl.4 spawn-surface coverage via new pin A6).
- **3 red-team amendments** — (a) liveness-ping honesty, (b) OQ4→A1/A2, (c) `provider_quota`
  no-auto-re-probe — all FOLDED.
- **8 red-team notes (N1-N8)** — all RECORDED; 5 FOLDED into the re-verified citations/teaching
  text (N1 receipt self-attested; N3/N4/N5 span nits; N6 D3 inform-channel coupling), 3 RECORDED-only
  (N2 unsupported-admission posture; N7 worker-turn OQ2 framing; N8 §8 corroborations).
- **QA §4.4 set** — 1 FOLDED (H1 `alive`→`probe-verified` + teaching caveat), 2 KEPT (bounded
  probe shape / projection+staleness law / refuse-or-inform-never-reroute), 1 FOLDED (OQ2 as
  live-receipt follow-on, A4 floor kept). The QA's "SOUND" verdict is overridden by the row report
  per the blind-QA law — the row blockers stand. Red-team pin verdicts A3/A5 (SOUND) KEPT as
  written.

The folded contract is v2 in place, all six acceptance pins RED at HEAD, and the fold record
documents every resolution.
