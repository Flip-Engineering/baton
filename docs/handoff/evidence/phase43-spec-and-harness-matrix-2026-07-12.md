# Phase 43 specification and harness-matrix checkpoint — 2026-07-12

## Outcome

Phase 43 is specified but not shipped. `spec/phase43/adverse-provider-ingestion.md` now pins the
provider-delivery boundary before red tests or implementation: authenticated delivery becomes a
pending admission quarantine, while only a freshly reverified deployment-pinned official
observation can become an adverse guard. Existing adverse state is grow-only until a separate
future positive-clearance contract explicitly addresses every retained source.

The checkpoint keeps project-manager as local causal-graph inspiration only and adds no homelab or
project-manager runtime, credentials, query, mutation, or integration.

## Contract decisions

- Provider webhook/poll machine identity is deployment-pinned and separate from user OIDC/cookie/
  CSRF/control authority. Raw-byte authentication precedes strict parsing and durable receipt
  precedes acknowledgement/cursor advancement.
- Signed delivery proves sender/delivery, not package applicability. Candidate coordinates are
  quarantined pending a forced Quartermaster refresh; callback bytes cannot supply verdict, policy,
  targets, dossier, or clearance.
- An official adverse guard uses the official observation's `asOf` as `effectiveAt`, not receipt
  time. A green refresh may resolve only a pending hint and can never clear existing adverse state.
- Multi-source contributions retain `(sourceId, sourceEpoch, officialFactDigest)` identity. A later
  clearance contract must enumerate every active contribution; partial-source clearing is
  forbidden.
- Receipt/processing identities, policy races, fan-out, cursor order, crash continuation,
  single-flight poll lifetime, exact ceilings, replay/currentness, causal lineage, and machine-
  ingress non-authority are explicit AF1–AF12 gates.

## Recursive Baton harness matrix

Baton ran one concurrent three-harness review against isolated worktrees pinned to commit
`de6b344`, with exact low-effort routes:

- Claude `claude-opus-4-6` reached a distinct native PID and provider-observed model, then returned
  `Not logged in · Please run /login`; its empty report failed fresh verification.
- Codex `gpt-5.6-sol` reached a distinct native PID and provider-observed model, consumed a reported
  79,634 tokens against a 50,000-token brief ceiling, and was automatically killed before a report
  passed verification.
- GLM `glm-4.7` loaded the ignored project-local credential through `GlmSessionCli`, reached a
  distinct native PID and provider-observed model, wrote the scoped report, and passed fresh
  verification. The report found the temporal/clearance/grounding clarifications now folded into
  the spec.

The matrix is intentionally red as a combined gate. All three exact harness/model/effort routes
were requested, resolved, and provider-observed; all PIDs, worktrees, runtime scopes, metadata,
branches, and writer lease/claims were reaped. Sanitized evidence is in
`docs/reference/evidence/phase43-harness-matrix-review-2026-07-12/`. The GLM key value was never
parsed by the runner or emitted to evidence; only the adapter received the ignored file path.

## Frictions and project direction

- Grok remains separately authentication-red despite its projected auth file; no provider-live
  Grok concurrency claim is made for this checkpoint.
- Claude subscription state is not available inside the current isolated runtime posture. Baton
  needs an explicit, non-leaking Claude credential/keychain projection contract rather than an
  implicit ambient-login assumption.
- Codex low effort was still too expansive for a broad six-file review. Recursive review briefs
  need smaller addressed context slices or larger explicitly approved budgets.
- GLM reported 88,224 tokens and $0.733993 only at terminal despite the brief's 50,000-token/$0.50
  ceiling and the CLI `--max-budget-usd 0.50` argument. Baton fired its hard-stop policy only after
  receiving that lump. A provider that reports usage only at terminal cannot be preempted by
  telemetry-based thresholds; acceptance policy must explicitly decide whether a verified artifact
  produced beyond a hard ceiling is admissible, and adapters should use provider-native caps only
  where live evidence proves they are enforced.

## Next implementation gate

Write Phase 43 red tests for source-card/authentication closure, durable receipt/pending admission,
false signed hints, official effective time, multi-source non-clearing union, seedless coordinates,
race/fan-out/crash/cursor/replay/max+1 behavior, dedicated machine ingress, poll close/drain, and
secret/path/inventory non-leakage. Implement only after those reds prove the current absence.
