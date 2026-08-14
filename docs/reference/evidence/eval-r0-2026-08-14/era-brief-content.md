# EVAL-R0 era brief-content inventory — the SOLO arm's brief sources (§3 recovery)

[attempt: c8714a30-7464-49c5-904e-58a05ad458d8 row-eval-r0]

Pre-registration §3 (SOLO arm): *"The worker gets the same brief-content the landed impl's
worker got (from the era's brief/manifest where recoverable; otherwise the contract's own
task statement)."* Recovery check, 2026-08-14: **all five rungs' era invocation manifests
survive in-repo**, each rendering exactly one `implementer` member whose `objective` field is
the verbatim brief the landed worker received. No rung needs the contract-statement fallback.

| Rung | Era manifest (repo-relative) | sha256[:16] | waveId | idempotencyKey | members | objective chars |
|---|---|---|---|---|---|---|
| #64 trust-gate | `docs/reference/evidence/trust-gate-steering-2026-08-02/impl-manifest.json` | `5d2dec4200039df7` | `wave:c12ac073e9b6cf0deda5a32a9f439ab8` | `trust-gate-steering-impl-2026-08-02` | implementer ×1 | 3392 |
| #63 kg-settle | `docs/reference/evidence/kg-settlement-2026-08-01/impl-manifest.json` | `8bc4d80c524c5be3` | `wave:8998ceadf467c383a847b9e2dfaa09cd` | `kg-settlement-impl-2026-08-01` | implementer ×1 | 3714 |
| S-1 wave-grammar | `docs/reference/evidence/control-surface-2026-07-31/s1-manifest.json` | `d44b1aea8d16cf1c` | `wave:bce3229c4013aa8f724bc32df74ff3f4` | `s1-wave-grammar-2026-08-01` | implementer ×1 | 2814 |
| DG-1 diagnostics | `docs/reference/evidence/diagnostics-2026-07-31/dg1-manifest.json` | `8cfb2654ef0e3bfa` | `wave:47120ba5eeb676b5d0ea16311b8037ae` | `diag-dg1-2026-08-01` | implementer ×1 | 2600 |
| M5 alias-sunset | `docs/reference/evidence/control-surface-2026-07-31/m5-manifest.json` | `05a1290b4141b85a` | `wave:b6b2b72e12247a60bd32977c0a4f1499` | `grammar-m5-2026-08-01` | implementer ×1 | 2975 |

Fingerprints computed 2026-08-14 over the raw manifest bytes (node `crypto.createHash`,
sha256, first 16 hex chars). Shape verified: `renderedMembers[].role === 'implementer'`,
single member per rung — i.e. every landed rung was itself a one-implementer wave, which makes
the SOLO/DRIVEN contrast a contrast of *cadence* (steering/finalization/settlement/trust-gate
on vs off), not of fleet size. That is exactly the pre-registration's framing (§3).

## Era result pins (the landed runs' recorded routes)

| Rung | Impl commit | Worker route (commit message, verbatim fragment) | Result pin present? |
|---|---|---|---|
| #64 | `ac5bd80` | "deepseek-v4-flash@high via baton.recipes, result a1e0a542, 47min one-shot" | yes — `refs/baton/results/a1e0a542…` (trailers verified: deepseek:deepseek / deepseek-v4-flash / high) |
| #63 | `e0f9d57` | "claude-opus-4-8 via baton.recipes, checkpoint 1b48aa89 harvested after a worktree_capacity kill" | final pin: see impl-receipt; the *checkpoint* pin `1b48aa89` is NOT in `refs/baton/results` (not retained) |
| S-1 | `480154a` | "grok-4.5@high via baton.recipes.implementContract — the RC-A dogfood, pin 6aa88bd3" | yes — `refs/baton/results/6aa88bd3…` |
| DG-1 | `6d0ca11` | "grok-4.5@high via baton.recipes, pin bfacbd2e" | yes — `refs/baton/results/bfacbd2e…` |
| M5 | `bb85e35` | "deepseek-v4-flash@high via baton.recipes — re-seated after grok's 28-min token 401'd, pin e6d3fbf7" | yes — `refs/baton/results/e6d3fbf7…` |

(Presence checked via `git for-each-ref refs/baton/results | grep <sha>`; commit-message
fragments via `git log -1 --format='%s' <impl>`.)

Note for the arms session: the *era* routes differed per rung (deepseek / opus / grok), while
the pre-registration pins BOTH arms to `deepseek-v4-flash@high` (§2 route note, §7) for
seat-comparability. The era routes above are context for brief-content reconstruction only —
they are not the arm route.

## Arm-session usage (nothing here was executed)

For each rung, the SOLO arm's brief = the era manifest's `renderedMembers[0].objective`
verbatim (paths above); the DRIVEN arm gets the same objective through the current
`implementContract` rendering. The eval session must re-fingerprint the manifests at load
time and pin the digests in each arm's manifest — the digests above are the 2026-08-14
reference values.
