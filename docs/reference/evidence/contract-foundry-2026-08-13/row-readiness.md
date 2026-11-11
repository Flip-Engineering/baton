# ROW BRIEF — row-readiness: contract for issue #167 (actual-inference readiness tier)

Read `foundry-brief.md` first (the shared frame binds you). Your contract:
`docs/reference/evidence/contract-foundry-2026-08-13/contract-167.md`.

## The problem (verify, then contract)

Static readiness (credential present + executable compatible) is not provider-alive: Grok's
402 and glm's capacity deaths each killed waves at turn time while reading "ready". Read:
the readiness/projection machinery (`grep -n "readiness" impl/src/application-deployment.mjs |
head`, the DP3/DP4 honest auth-red posture tests in
`impl/test/phase57-provider-governance.test.mjs`-adjacent files — find the exact ones), the
doctor surface (`doctorReadiness` in `application.mjs`), and #146's ask (`gh issue view 146`)
+ #167 itself (`gh issue view 167`).

## Your contract must answer

- **D1 — the probe tier.** A bounded, real, one-token inference through the projected private
  worker runtime: its exact bounds (one request, the closed timeout class — careful: the
  control law bans clocks as CONTROLS; a probe timeout is a bound on the PROBE, not a
  workflow control — state this distinction honestly), its cost honesty (it spends real
  provider budget — say so), and when it runs (on demand via a surface verb? pre-admission?
  opt-in per deployment?).
- **D2 — the honest projection.** The readiness read carries `{static, probedAt, verdict}`
  where a static-only read NEVER relabels itself alive — the shape and the staleness law
  (a probe result ages; the projection says how old it is, content-derived, never TTL-guessing).
- **D3 — the admission interaction.** How wave admission may use the tier (defer a member to
  a live seat before commit — never silently reroute; the orchestrator's exact route choice
  is authority, the tier only informs/refuses honestly).
- Refusal vocabulary + red-first acceptance pins + open questions, per the frame.
