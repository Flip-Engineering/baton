# Phase 52 GLM Adversarial Review

## Verdict

PASS

Phase 52 correctly implements verified recall-outcome attribution as a non-causal, read-only observability layer. The implementation enforces deployment-pinned authority, atomic batch appends with preflight validation, independent ceiling enforcement, and pre-effect ACI refusal. All RA1-RA9 contracts are satisfied with deterministic replay and honest utility audit metrics that explicitly disclaim causation.

## P0-P1 findings

No P0 or P1 defects found.

## Required corrections

None. The implementation correctly:

- **Enforces non-causal semantics (RA1-RA4)**: `causationClaimed: false` is set consistently throughout the assessment lifecycle (cairn-run-scorecard.mjs:281, coordination-store.mjs:2714, 2924). Assessments store only temporal associations and historical exposure commitments—no node bodies, query prose, verification output, or credentials. Later invalidation/contamination cannot rewrite historical assessments.

- **Implements deployment-pinned authority (RA1)**: Assessment requires Phase 47 audit, Phase 48 recall, and a separate recall-assessment policy for the same exact `repoId` (cairn-run-scorecard.mjs:75-79). Direct calls require `orchestrator` or non-transport-forged `operator:*`. Authenticated HTTPS and MCP calls derive operator identity via transport principal validation (cairn-run-scorecard.mjs:299-302). Workers, policy actors, forged `web:*`/`mcp:*` identities, and repository mismatches are rejected (phase52-cairn-recall-assessment.test.mjs:85).

- **Guarantees atomic batch append (RA5)**: The preflight callback executes before event append and throws if coordination state changes (coordination-store.mjs:2769). Cancelled preflights, failed appends, and concurrent races leave no assessment residue. The projection is keyed uniquely by recall event sequence, ensuring one assessment per recall. No-op invocations append no event (phase52-cairn-recall-assessment.test.mjs:89).

- **Enforces independent ceilings (RA6)**: Each ceiling has independent max and max+1 behavior:
  - `maxScanEvents` (coordination-store.mjs:2721)
  - `maxReceipts` (coordination-store.mjs:2730)
  - `maxNodeRefs` (coordination-store.mjs:2729-2730)
  - `maxEvidenceRefs` (coordination-store.mjs:2729-2730, computed as `assessments.length * 3`)
  - `maxBatchBytes` (coordination-store.mjs:2757)
  - `maxResultBytes` (cairn-run-scorecard.mjs:289)

  Exceeding any ceiling throws `causal_assessment_oversize` or `capability_result_oversize` and leaves no residue (phase52-cairn-recall-assessment.test.mjs:128-143).

- **Implements pre-effect ACI refusal (RA6)**: ACI output policy checks occur in the preflight callback before append (cairn-run-scorecard.mjs:292-296). The test at phase52-cairn-recall-assessment.test.mjs:168-172 confirms ACI refusal happens before assessment append. No-op invocations also undergo ACI checks (cairn-run-scorecard.mjs:309).

- **Validates exact binding (RA3)**: `_recallAssessmentCandidate` requires exact task, run, worker, and route identity (coordination-store.mjs:2688-2718). The receipt-before-verification-before-terminal ordering is enforced (coordination-store.mjs:2691, 2693). Mixed-task, mixed-worker, borrowed-route, and future evidence are excluded (phase52-cairn-recall-assessment.test.mjs:101-118).

- **Provides honest audit metrics (RA8)**: `recallUtility` reports association/coverage measures as integer fractions without claiming causation (coordination-store.mjs:2918-2925). The metrics explicitly disclaim causation with `causationClaimed: false` (coordination-store.mjs:2924). Malformed assessment lineage is a critical violation; unassessed eligible recalls are visible but not critical (coordination-store.mjs:2899-2905).

- **Supports exact replay and reverify (RA7)**: Rebuilding from the pinned prefix produces byte-identical results (phase52-cairn-recall-assessment.test.mjs:93-99). Live/replay tamper fails integrity checks (phase52-cairn-recall-assessment.test.mjs:97-99). Direct, HTTPS, and MCP invoke/reverify share one ACI (phase52-cairn-recall-assessment.test.mjs:152-166).

- **Passes adversarial gates (RA9)**: Zero-provider tests cover verified pass/failure, recall after terminal, actor-only/run-scoped recalls, unverified/cancelled/mixed evidence, later invalidation/contamination, request-shape smuggling, authority checks, idempotency conflicts, concurrent assessment, no-op, stale prefix, every max+1 ceiling, audit failure, cancellation, disk failure, live/replay tamper, and determinism (phase52-cairn-recall-assessment.test.mjs:43-173).