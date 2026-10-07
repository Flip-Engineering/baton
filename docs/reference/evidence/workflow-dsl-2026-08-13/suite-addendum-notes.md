# Suite-addendum notes — the #170 DSL package's addendum suite (orchestrator-authored)

**Date:** 2026-08-13 · **Suite:** `impl/test/workflow-dsl-package-red.test.mjs` · **Author:** the
campaign orchestrator (kimi) — a recorded judgment call: FOUR foundry attempts at this addendum
died to the member-creation silence (#199/#200 — no `task.created`, no capacity reservation, a
receipt claiming `failed` for a member that never existed). The red-first content is unchanged
by who types it; the wave path is re-proven by the impl wave that follows.

## Verified split (`node --test impl/test/workflow-dsl-package-red.test.mjs` from the repo root)

- Run 1: **12 tests — 4 pass / 8 fail** (the 4 PIN rows green; the 8 capability rows RED at
  their named stages)
- Run 2: identical (stable)

## Row map (issue → rows → named stage)

- **#183** — PK-A terminal-replay refusal (`stage: terminal-replay-not-refused`; at HEAD the
  replay silently returns the prior wave) · PK-PIN the live-dedupe contract (GREEN).
- **#176** — PG-A waves.send + PG-B waves.list under a sessionAuthority context refuse typed
  (`stage: pre-gate-dispatch`; at HEAD they dispatch before the recursive gate) · PG-PIN the
  facade direct ports keep their own `_authorize` (GREEN).
- **#171** — PS-A spawn pre-seeds the declared report file with the verbatim `[attempt: …]`
  header (`stage: preseed-absent`; at HEAD nothing pre-seeds) · PS-PIN closed-spec admission
  undisturbed (GREEN — an unknown field refuses `workflow_spec_invalid` naming it).
- **#180** — PV-A the driver-policy verification profile projects `verifiedBy` onto the member
  outcome + PV-B an unknown profile refuses typed naming the field (both
  `stage: verification-profile-absent`) · PV-PIN the member-facing top-level `verification`
  field stays REMOVED (B4 — GREEN). **B4 reconciliation (judgment call):** the per-wave profile
  rides the DRIVER policy object (`driver.verification`), not the member-facing spec fields —
  the recipes R-DC-6 removal law is untouched.
- **#195** — PA-A the adapter contract's Definition role as a named export (`stage:
  adapter-definition-missing`) · PA-B every semantic-registry command entry declares a
  `canonicalOutput` shape (`stage: canonical-output-missing`; at HEAD entries carry
  `outputView` only).

## Fixture hygiene

mkdtemp repos + log dirs, MockAdapter only, no network/providers/clocks; `watchdog.stallMs`
pinned 300_000 with the comment; application.mjs/coordination-store.mjs never read whole
(behavioral rows drive the application; static scans read NUL-free modules only).
