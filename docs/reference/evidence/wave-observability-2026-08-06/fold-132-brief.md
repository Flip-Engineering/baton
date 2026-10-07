# #132 FOLD BRIEF — fold the red-team report into the wave-observability contract (v1.0 → v1.1)

You are folding an adversarial red-team report into the wave-observability contract. Read fully,
in order: (1) `contract-redteam.md` (NOT FOLD-READY — 3 blockers + 8 fix items + the §4
pinned-test drift); (2) `wave-observability-contract.md` (v1.0 — your edit target).

## Fold every item

- **B1** — D2.3's close-side fold targets the wrong envelope: `wave.closed` is a TOP-LEVEL event
  kind (#103 D9), not a `driver.recorded` payload. Fold `event.kind === 'wave.closed'` at the top
  level (beside the `context.pack_minted` fold, `coordination-store.mjs:8723`); keep only
  `wave.started` in the `driver.recorded` branch.
- **B2** — legacy-shape `wave.started` (string-array roster) must NOT throw under replay: pin a
  legacy gate in the fold (string roster → raw-string row with route/scope null), reserve
  `wave_registry_invalid` for malformed NEW-shape records, and add a legacy-store replay row to
  the A2 acceptance pin.
- **B3** — cross-deployment liveness has no mechanism in v1.0: either specify the shared
  topology or (recommended) scope v1.0 to `local`-only with `remote`/`stale` explicitly deferred
  and A4 amended to match. Say which and why.
- **F1** — the card lists dot-spelled names via the existing `([, name]) => name` map (fix the
  D1.4/A1 wording). **F2** — align the `waves_stop` arg set with the port's normalizer or pin the
  deliberate narrowing. **F3** — deploymentId wiring into the mint site. **F4** —
  `processState === 'unknown'` must not read `remote`. **F5** — pin the bare-`attach` shape.
  **F6** — wrap throwing member-start refusals into `wave_member_invalid`. **F7** — A6's red must
  use a refusal that fires at HEAD. **F8** — allowlist `wave_not_found` for the MCP surface.
- **§4 drift** — the A3 pin must explicitly own the MCP tool-list update (count + position of
  `baton_waves_list` in the four pinned enumerations: `mcp-reflex-surface-red.test.mjs:201-212`,
  `phase16-mcp-northbound.test.mjs:92-105`,
  `phase67-progressive-agent-experience.test.mjs:648-656`,
  `phase72-kimi-orchestrator-mcp.test.mjs:298-306`) and the `/v1/application-card` advertisement.
- **Open questions** — apply the red-team's verdicts (§3 of the report).

## Laws

No clocks; every citation verified (`grep -an`/`sed -n` on the two NUL files); sorted-key
literals in ACTUAL sorted order; `localeCompare` banned. Header to **v1.1** with the fold note.

## Deliverables (edit ONLY these)

`docs/reference/evidence/wave-observability-2026-08-06/wave-observability-contract.md` (v1.1) ·
`docs/reference/evidence/wave-observability-2026-08-06/contract-fold.md` (blocker/fix-item →
change map, all items resolved or explicitly deferred with the reason).
