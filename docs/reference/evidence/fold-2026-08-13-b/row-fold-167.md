# ROW BRIEF — row-fold167: fold the #167 readiness-honesty contract

Read `docs/reference/evidence/fold-2026-08-13-b/foundry-brief.md` first — it binds you, INCLUDING
the blind-QA law (row report governs on conflict — the QA's §4 "SOUND with one amendment" was
written WITHOUT the row report; the row's blockers stand). Your material:

- Contract: `docs/reference/evidence/contract-foundry-2026-08-13/contract-167.md` (FULL read)
- Red-team: `docs/reference/evidence/contract-foundry-2026-08-13/redteam-167.md` — **2 citation blockers + 2 structural holes, all binding**:
  - Citation: `coordinator.mjs:12693` → re-cite the shared-publish note's anchor to
    `coordinator.mjs:11103` (`writeScratchpad`; the store side `coordination-store.mjs:14064`
    is correct).
  - Citation/mechanism: G5/A2's `--check` anchor (`application-cli.mjs:2213`) is not the
    operator path — the real `baton doctor --check` runs `impl/scripts/baton.mjs:79-98` →
    `BatonWebClient.doctor()` (`application-cli.mjs:1961`) → `/readyz` + `/v1/application-card`,
    never forcing a probe. Pin THAT path end-to-end (baton.mjs branch → web client →
    web-northbound forced-probe parameter) and assert a fresh probe fires per stale/absent
    route on `baton doctor --check`.
  - HOLE D2/A1 (the honest projection vanishes on the wire): non-enumerable per-route
    `liveness`/`occupancy` are dropped by JSON serialization
    (`application-deployment.mjs:1348-1349`); web-northbound re-adds only `briefing`
    (`web-northbound.mjs:1507-1513`). Require enumerable `verdict`/`probedAt` on the doctor
    route row and/or pin the northbound re-add for `/v1/application-card` + `deployment.doctor`
    + MCP result; add the pin asserting an operator wire read carries `verdict` + `probedAt`.
  - HOLE D1 (probe gate covers only `run()` + wave preflight): read the report's full D1 text
    and fold its fix (the gate's coverage must match the contract's claims or the claims
    shrink).
- QA: `docs/reference/evidence/review-foundry-2026-08-13-b/review-qa.md` §4 — the §4.4 set:
  H1 (rename/re-scope `verdict: 'alive'` → names the probe's real probative power, e.g.
  `probe-verified`; carry the caveat into D2.3's teaching sentence), keep the bounded probe
  shape + `{static, probedAt, verdict}` projection + staleness law + refuse-or-inform-
  never-reroute admission as written, fold OQ2 (quota/capacity wire grammar) as a live-receipt
  follow-on with A4's classification-separation fixture as the pinned floor.

Deliverables per the shared frame: the folded contract in place +
`docs/reference/evidence/contract-foundry-2026-08-13/fold-167.md` (attempt line in the FIRST
FIVE lines).
