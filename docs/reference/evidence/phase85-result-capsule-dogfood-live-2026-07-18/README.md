# Phase 85 provider-result capsule dogfood

This evidence runner uses Baton's concise `openBaton().workflow()` surface to dispatch the same red
provider-result capsule contract to two exact Codex routes in parallel:

- `codex` / `gpt-5.6-sol` / `high` as the bounded implementation route;
- `codex` / `gpt-5.6-sol` / `xhigh` as the adversarial implementation/review route.

The runner supplies no caller-managed token, dollar, wall-time, export-file, or export-byte budgets.
It retains every Candidate patch, records route and attempt evidence, then invokes Baton's unified
Run stop and requires every observed process to be closed with zero remaining worker ownership.

The live Run was `run-72e246ec6172987cef1967e947e82d7a`. The high-effort builder produced the
freshly verified Candidate
`candidate:a1900dc5a183fb4ae44c9a7884b5f787dca9e8a5ce76522b85654323bb268672`
at retained commit `ec200099ad92315a086ea7f4e1cb9bc32b695505`. The xhigh adversary passed its
focused test but did not emit a terminal turn. Interrupting the foreground RTK wrapper also ended
the controller before its `finally` receipt was printed, so no cleanup was assumed. `recover.mjs`
reopened the exact deployment and Run through Baton, recovery-terminalized that incomplete Attempt,
retained the verified Candidate patch, and then issued the unified stop. The stop receipt records
two observed/two closed processes, zero remaining targets, and zero worker ownership; deployment
close is also clean.

Local integration treated that Candidate as implementation material, not authority. Adversarial
review strengthened it with full CAS-reference hashing, canonical path-scope and source-policy
binding, child/route/artifact/cleanup digests, `context-unit` compatibility, canonical retained-ref
enforcement, and all-or-nothing rejection when any changed path is unsupported or sensitive. The
focused capsule contract and the complete implementation suite are green at 2,081/2,081.

Run from the repository root with:

```sh
rtk proxy node docs/reference/evidence/phase85-result-capsule-dogfood-live-2026-07-18/run.mjs
```

If the foreground controller is interrupted, recover with the exact durable coordinates printed by
the Run rather than inspecting or killing provider processes directly:

```sh
rtk proxy node docs/reference/evidence/phase85-result-capsule-dogfood-live-2026-07-18/recover.mjs DEPLOYMENT_ROOT RUN_ID
```
