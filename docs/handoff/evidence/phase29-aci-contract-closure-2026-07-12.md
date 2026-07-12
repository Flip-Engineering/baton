# Phase 29 ACI contract-closure evidence — 2026-07-12

## Outcome

The post-Phase-29 exhaustive audit defects are implemented and locally closed. ACI results now
validate a closed status vocabulary, status/cursor invariant, bounded refs, normalized nonnegative
cost, summary bound, JSON shape, payload budget, full envelope, and authority flags. Completed
events include bounded cost and artifact identities without raw arguments/payloads. Cards derive
invoke/resume/reverify/cancel support and separate inline operations from task-class operations.
Every task-class action—invoke, resume, or reverify—refuses before module effect until a durable
task-DAG/cancel adapter exists.

Web and MCP require explicit action selection. MCP's advertised JSON Schema expresses three
mutually exclusive action shapes. Formal ACI, Phase-16 MCP, Phase-29 CI, `createDriver()` JSDoc,
README, the superseded Phase-25 status layer, and the living validation ledger are synchronized.

## Validation

- Registry/web/MCP focused tests: 42/42.
- Atlas compatibility after status/cursor normalization: 86/86.
- Governance plus ACI/northbound closure: 55/55.
- Canonical `npm test`: 797/797. One preceding canonical run hit the existing SC12 timing test;
  its isolated 16/16 rerun and the subsequent canonical owner both passed.
- `git diff --check` passed.

## Recursive Baton findings

The first exact concurrent `grok-4.5` plus `grok-composer-2.5-fast` run created two distinct native
PIDs and fully reaped both PIDs/worktrees/runtime scopes/branches. It found two concrete defects:

1. Grok 4.5 showed that task-class quarantine covered `invoke` but not `resume`/`reverify`. The gate
   now lives in the common operation validator, and a red proves all three actions refuse with zero
   capability effects.
2. Composer wrote its complete report using macOS's canonical `/private/tmp` spelling while the
   worktree was recorded through `/tmp`. The watchdog compared path aliases textually and killed
   the worker for a false scope violation. Action paths now resolve their deepest existing ancestor
   canonically, preserving symlink-escape detection while accepting filesystem aliases; the new
   governance red reproduces this exact case.

The corrected-commit retry fully reaped both tasks but both failed before provider initialization
with `Authentication required`. The source Grok auth file remained present. It is an inference—not
provider-confirmed—that concurrent workers refreshed private copied OAuth state without persisting
rotation to the source credential. This exposes a separate credential-broker/lease gap: immutable
file projection is suitable for static keys but not sufficient for rotatable OAuth sessions.

Evidence:

- `docs/reference/evidence/phase29-aci-contract-closure-grok-review-2026-07-12/`
- `docs/reference/evidence/phase29-aci-contract-closure-final-grok-review-2026-07-12/`

## Honest boundary

The implementation and local acceptance gates are green. The corrected commit does not yet have a
post-fix authenticated two-Grok verdict because reauthentication requires user account interaction.
No provider success is inferred from the present auth file. The earlier concurrent process/reap
test remains valid, and all failed retries were fully reaped. A rotatable credential broker and a
fresh final Grok pair remain explicit follow-ups; neither blocks beginning Cairn Rung 0 on the now
closed synchronous ACI contract. No homelab integration was added.
