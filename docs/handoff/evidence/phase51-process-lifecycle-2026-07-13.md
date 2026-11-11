# Phase 51 exact provider process lifecycle and reap — 2026-07-13

## Outcome

Phase 51 is implementation-complete. Baton now treats owned OS process existence, provider
readiness, provider session identity, process close, group reap, task/runtime cleanup, and writer
release as separately evidenced facts. The implementation is green; the retained live provider
matrix is intentionally red only at the current Grok authentication boundary.

No homelab or external project-manager runtime was added. The full shared causal-knowledge,
authenticated web/runtime, AST/CST/SCIP/CPG/IR, trust/evaluation, and session-depth scope remains in
`docs/26-full-system-goal.md` and `docs/28-exhaustive-capability-audit.md`.

## Delivered contracts

- Every shipped real-child tier—Claude/GLM session, Codex app-server, Grok ACP, and live one-shot—
  emits one exact `lifecycle.process_started` before provider I/O and one exact
  `lifecycle.process_closed` before close-derived terminal events.
- Coordinator-selected generation, PID, process-group ID, readiness, and adapter source are exact.
  Invalid events retain only bounded key/type shape and safe correlation evidence, then trigger a
  safe stop without replacing authority.
- Provider readiness remains `lifecycle.spawned`; transactional admission persists only sanitized
  `lifecycle.process_ready` until provider session identity is accepted.
- Kill confirmation requires adapter Ack plus exact close. Descendant process groups are boundedly
  probed/reaped; timeout, permission, and probe failures cannot fabricate closure.
- Confirmed interrupt retains reusable-session and writer authority. Forced disposition records
  `unconfirmed_after_restart`; a later ordinary or poisoned emergency kill retries exact reap.
- Cleanup failure, verification deferral, pending spawn poison, recovery identity mismatch,
  recovery fast-close, replay, and late exact close all retain the correct authority.
- Direct, authenticated HTTPS, and authenticated MCP status expose only the bounded `processRef`.
- Harness/model/effort remain independently selected. The default Codex and Grok version probes now
  bind to the injected executable, closing a recursive-run attribution bug caused by duplicate
  global Codex installations.

## Review-driven corrections

Three parallel source reviews supplied adversarial authority/recovery/replay cases. The completed
corrections include interrupt authority retention, forced-stop writer retention and retry, pending
spawn poison drainage, transactional recovery readiness, rejected-session identity non-pivot,
verification runtime-cleanup retry, readiness-preserving replay, exact source binding, close-before-
kill confirmation, terminal-without-close refusal, poisoned exact-close handling, and cleanup-before-
writer release.

Recursive Baton then found two additional operational frictions:

1. A clean detached worktree does not contain ignored `impl/node_modules`; the runner therefore
   executes from the dependency-bearing checkout while targeting a separate clean committed repo.
2. Bare `codex` resolved to an old 0.5.0 install in the non-interactive runner but to 0.144.1 in the
   login shell. The runner now selects absolute login-resolved harness executables, and adapter
   cards probe that same selected executable. The mismatch was reproduced red-first and fixed in
   both Codex and Grok adapters.

## Validation

- Phase 51 focused gate: **63/63 passing**.
- Phase 14 route plus Phase 51 combined gate: **72/72 passing**.
- Persistent-session, startup-rejoin, web/MCP, provider-close, coordination, and Cairn adjacency
  gates passed during the phase.
- Canonical zero-quota suite: **1103/1103 passing** via `npm test` in `impl/`.
- Syntax and `git diff --check` passed.

## Final recursive Baton evidence

The retained runner and bounded ledger are in
`docs/reference/evidence/phase51-process-lifecycle-review-2026-07-13/`. The final run is pinned to
`8ec62516b7dc4dcebf6478e2d51db5613352b9e7` and resolves absolute logged-in executables:

- Codex CLI 0.144.1, exact `gpt-5.6-sol`/low: PID/group `67711`, provider-ready, model-observed
  exact, budget-cancelled after 124,545 reported tokens, then exact `SIGKILL` close.
- Claude Code 2.1.206 driving project-key GLM, exact `glm-4.7`/low: PID/group `67712`,
  provider-ready/model-observed exact, 83,053 tokens and $1.09535, fresh verification accepted,
  then explicit `kill.requested` → exact close → `kill.confirmed`.
- Grok 0.1.216 exact `grok-4.5`/low: PID/group `67713`, authentication refusal before provider
  readiness, exact close and full reap.
- Grok 0.1.216 exact `grok-build`/low: PID/group `67714`, authentication refusal before provider
  readiness, exact close and full reap.

Both Grok process groups were simultaneously alive, proving concurrent launch rather than a
serialized transcript. Every route was admitted with exact requested/resolved harness/model/effort
and honest observed fields. All four leaders and groups are gone; task worktrees, runtime scopes,
task branches, and writer lease are gone; the ownership snapshot is restored. The project-key GLM
report says PASS with no P0/P1 correction.

`implementationReviewPass` is true. `harnessMatrixPass` remains false because both Grok routes are
currently unauthenticated and therefore cannot satisfy all-provider-ready acceptance. That red is
an environment/provider-auth fact, not rewritten as an implementation pass. Credential files were
only presence/mode-checked and privately projected; credential values are absent from Git and the
retained evidence.

## Commits

- `c17cb45` — implement exact provider process lifecycle.
- `23aa0b7` — harden authority across interruption, poison, cleanup, replay, and recovery.
- `cdd83f0` — document Phase 51 closure and retain the recursive runner.
- `1038f14` — pin recursive harness executables.
- `d2c4067` — bind harness version attribution to the selected executable.
- `8ec6251` — synchronize the full-system status and 1103-test gate.
