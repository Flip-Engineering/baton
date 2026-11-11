# #132 RED-TEAM BRIEF — adversarial attack on the wave-observability contract v1.0

You are the ADVERSARIAL RED TEAM for `wave-observability-contract.md` (v1.0, same dir — issue
#132, the orchestrator's wave lane). Read it FULLY first, then attack:

1. **Re-verify every `file:line` citation** (`grep -an`/`sed -n`; NUL files: `application.mjs` +
   `coordination-store.mjs` only) — a wrong citation is an automatic blocker. Note: citations
   marked spec-referenced point at OTHER contracts, not the tree; verify those files exist and
   carry the named section.
2. **D1 (web admission)** — the verbs are direct ports, not definition entries. Does the
   contract's admission path actually work (what does `validateApplicationCommandArgs` do to a
   port-shaped command? does the byte-stable command-table key-set note at
   `application.mjs:12214-12216` survive the change — a new definition entry CHANGES the key set;
   does the contract own that drift and its golden tests?)? Capability mapping per verb vs the
   resident session's issued set (`application-deployment.mjs` host(): observe/control/approve/
   emergency_stop/export_result/retry_verification/goal:*/plan:*) — does any verb demand a
   capability the resident does NOT issue?
3. **D2 (registry projection)** — `wave.started` payload extension: is the extension
   replay-safe against stores that already carry the old-shape record? The strict-vs-advisory
   split (OQ4): is `wave_registry_invalid` as a REPLAY INTEGRITY FAILURE too strong (one malformed
   record poisons every replay — including stores that predate the projection)? Exactly-once
   minting on re-start / attach / re-drive?
4. **D3 (liveness honesty)** — can `local | remote | stale` be spoofed or misread (a crashed
   writer whose lease lingers? a deploymentId collision across repos?)?
5. **D4 (CLI parity)** — does the plural-family parse conflict with the singular corrective
   (`application-cli.mjs:1309-1314`)? Does `waves attach` with no args change its existing
   refusal in a way a pinned test holds?
6. **D5 (#129 interaction)** — is the typed admission refusal named, and does it hold on facade +
   web + MCP identically (the #114 B3 payload-accessor discipline)?
7. **Refusal vocabulary** — every code: typed, named, surface-constant, and not colliding with
   the `workflow_*` five (#114 B3) or `wave_already_closed` (#103).
8. **Open questions** — verdict each (fold-blocking or deferred).

Verdict per decision SOUND/HOLE with the fix; final FOLD-READY or NOT with numbered blockers
(each: what + why + the concrete fix). Write ONLY
`docs/reference/evidence/wave-observability-2026-08-06/contract-redteam.md`. Laws: no clocks;
every citation re-verified at the current HEAD.
