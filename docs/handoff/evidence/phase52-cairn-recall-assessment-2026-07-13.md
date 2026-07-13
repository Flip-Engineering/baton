# Phase 52 Cairn verified recall-outcome attribution — 2026-07-13

## Outcome

Phase 52 is implementation-complete. Baton can now measure which task-scoped Cairn recall
exposures preceded exact hub-verified terminal outcomes without claiming those exposures caused
the result. The resulting evidence is suitable for later policy research, not current automatic
learning authority.

No homelab or external project-manager runtime was added. Authenticated contradiction UX is the
next Cairn vertical; learned weighting, Playbook/Skill promotion, Scratch Board/Bench, Goal/Plan
authority, retention/checkpoints, deployment-neutral export, and the retained session,
representation, web-runtime, and trust/evaluation scope remain explicit.

## Delivered contracts

- `causal.assess_recall` accepts only a deployment-bounded `observedSeq`, reruns the critical graph
  audit at that prefix, and selects every eligible unassessed task-scoped Phase 48 receipt.
- Eligibility requires receipt before exact task/run/worker/route-mapped `verify.reverified`
  evidence before a compatible terminal transition. Actor-only, run-only, asserted, cancelled,
  post-terminal, borrowed-task, borrowed-worker, and borrowed-route evidence cannot qualify.
- The only outcomes are `verified_pass_after_recall` and `verified_fail_after_recall`, always with
  `causationClaimed:false`. Workers cannot rate memory and callers cannot nominate favorable
  receipts or outcomes.
- One compact append-before-return batch preserves historical node/version/score/contradiction,
  verification, terminal, route, request, policy, and digest commitments without storing recalled
  prose, queries, verification output, prompts, credentials, or provider payloads.
- Assessment never changes node grounding, validity, confidence, recall ranking, routing,
  promotion, or worker rating. Later invalidation is counted as contamination without rewriting
  the historical exposure.
- Audit reports task-scoped receipt count, eligible/assessed/unassessed coverage, pass/fail-after
  association, distinct assessed nodes, contamination, exact integer fractions, and the explicit
  non-causation marker.
- Exact no-op, idempotency conflict, concurrent race, restart, replay, reverify, and tamper behavior
  are deterministic. Scan, receipt, node-ref, evidence-ref, batch-byte, result-byte, and ACI
  envelope/payload ceilings fail before observable effect.
- Direct, authenticated HTTPS, and authenticated MCP calls share repository-bound,
  transport-derived actor and idempotency authority. Forged transport actors are refused.

## Validation

- Phase 52 focused gate: **9/9 grouped tests passing**.
- Phase 47–50 plus Phase 52 adjacent Cairn gate: **54/54 passing**.
- Canonical zero-quota suite: **1112/1112 passing** via `npm test` in `impl/`.
- Syntax and `git diff --check` passed.

## Recursive Baton evidence

The retained runner, bounded ledger, summary, and verified review are in
`docs/reference/evidence/phase52-recall-assessment-review-2026-07-13/`. The run is pinned to
`4fbc86217564c064bf9c0fe071fd581d081784b8` and resolves absolute executables through the logged-in
shell:

- Codex CLI 0.144.1, exact `gpt-5.6-sol`/low: PID/group `36573`, provider-ready and
  provider-observed exact, then hard-budget-cancelled after 140,526 reported tokens with an exact
  `SIGKILL` close. No unverified report is claimed.
- Claude Code 2.1.206 driving the ignored owner-only project GLM credential, exact
  `glm-4.7`/low: PID/group `36574`, provider-ready and provider-observed exact, 64,834 tokens and
  $0.825905, fresh verification accepted, then explicit `kill.requested` sequence 32 followed by
  exact close and `kill.confirmed` sequence 35. Its report says PASS with no P0/P1 correction.
- Grok 0.1.216 exact `grok-4.5`/low: PID/group `36575`, authentication refusal before provider
  readiness, exact close and full reap.
- Grok 0.1.216 exact `grok-build`/low: PID/group `36576`, authentication refusal before provider
  readiness, exact close and full reap.

Both Grok process groups were simultaneously alive, proving concurrent launch rather than a
serialized transcript. Every task was admitted with exact requested/resolved harness, model, and
low effort, with observed identity left null where the provider never became ready. All four
leaders and groups are gone; task worktrees, runtime scopes, task branches, and writer lease are
gone; the pre-run ownership snapshot is restored.

`implementationReviewPass` is true. `harnessMatrixPass` remains false because this installed Grok
CLI still reports `You are not authenticated` and cannot satisfy the every-provider-ready gate.
The Grok auth file is present and owner-only, but Baton correctly treats the CLI's live provider
response as authoritative. Credential values were never read into retained evidence and remain
absent from Git.

The Phase 51 runner was parameterized without changing its default Phase 51 behavior, allowing the
same exact route, lifecycle, bounded-ledger, verification, and cleanup acceptance machinery to
review Phase 52 instead of creating a second weaker state machine.

## Commits

- `e526602` — specify verified recall-outcome attribution.
- `86558db` — add the red Phase 52 contract suite.
- `bf6b089` — implement the audited assessment projection and ACI operation.
- `4fbc862` — synchronize the full-system goal and capability catalog.
