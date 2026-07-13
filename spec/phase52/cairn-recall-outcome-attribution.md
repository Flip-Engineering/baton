# Phase 52 — Cairn verified recall-outcome attribution

Status: normative implementation contract

Phase 52 closes the observability half of Cairn's recall feedback loop. It records that an exact,
receipted Phase 48 recall preceded an exact hub-verified terminal outcome. It does **not** claim the
recall helped or harmed, infer causation from task success, accept worker ratings, or mutate recall
ranking, graph grounding, confidence, routing, promotion, or validity.

The public operation is `cairn/causal.assess_recall`. Its only input is a pinned coordination
boundary. Baton deterministically selects every eligible, previously unassessed task-scoped recall
from that prefix. Callers cannot nominate a receipt, task, node, outcome, score, or assessment.

## RA1 — deployment-pinned authority and closed policy

The operation exists only when the deployment configures Phase 47 audit, Phase 48 recall, and a
separate recall-assessment policy for the same exact `repoId`. The assessment policy contains only
`repoId`, `maxScanEvents`, `maxReceipts`, `maxNodeRefs`, `maxEvidenceRefs`, `maxBatchBytes`, and
`maxResultBytes`; every numeric field is a positive safe integer within implementation maxima.
Unknown, missing, excessive, or cross-repository configuration is rejected at construction.

Direct calls require `orchestrator` or a non-transport-forged `operator:*`. Authenticated HTTPS and
MCP calls derive an operator identity from their admitted transport principal. Workers, policy,
unauthenticated callers, repository mismatches, forged `web:*`/`mcp:*` identities, mismatched
transport tags, and revoked/expired/CSRF-invalid sessions append nothing. Generic ACI budget,
idempotency, repository, capability, and output fences remain authoritative.

## RA2 — pinned-prefix, audit-gated deterministic scan

The request shape is exactly `{observedSeq}`. `observedSeq` names an existing coordination prefix
and cannot exceed `maxScanEvents`. Phase 47 audit runs at that exact prefix; a critical violation,
ceiling failure, cancellation, or repository mismatch refuses before assessment state changes.

The scan considers only Phase 48 `knowledge.recall` events at or before the prefix. Actor-only and
run-scoped receipts are retained but ineligible in Phase 52. A task-scoped receipt is eligible only
when it is not already assessed and the same task has, in order after the recall and by the pinned
prefix, an exact mapped hub `verify.reverified` event followed by a compatible terminal transition.
All eligible receipts are selected in ascending receipt-event order. The caller cannot filter or
truncate the set; exceeding any ceiling refuses instead of silently returning a partial batch.

## RA3 — exact task, run, worker, route, and verification binding

Replay resolves the mapped operational verification through the authoritative operational reader.
The source must be `verify.reverified` for the receipt's exact task, durable run, worker at receipt,
and committed route identity. It must precede the terminal transition and its accepted bit must
agree with the durable outcome: completed plus accepted is `verified_pass_after_recall`; failed plus
rejected is `verified_fail_after_recall`. Cancelled, input-required, asserted-only, self-reported,
missing, mixed-run, mixed-worker, borrowed-route, future, or contradictory evidence is ineligible or
an integrity failure as appropriate. One verification cannot be borrowed across tasks or receipts.

## RA4 — immutable historical exposure commitment

Each assessment binds the original recall event sequence and digest; task, run, reader actor and
worker; historical node IDs, validity versions, scores/reason digests, contradiction-edge IDs,
query/result projection digests; mapped verification event and digest; terminal event and status;
outcome code; policy digest; and an assessment digest. It stores no node bodies or snippets, raw
query prose or terms, prompts, briefs, worker output, verification output, credentials, secret
values, or local paths. The original historical receipt is authoritative; current recall ranking is
never rerun as a substitute.

Later invalidation, supersession, contradiction resolution, or contamination cannot rewrite the
assessment. The assessment is descriptive temporal association and carries
`causationClaimed:false`.

## RA5 — atomic compact batch and projection

A non-empty invocation appends exactly one `knowledge.recall_assessment_batch` event containing a
stable, content-addressed, ascending list of assessments. The event is appended before the public
result. Projection state is keyed uniquely by recall event sequence, so one recall can have at most
one assessment. The append and projection are atomic; append failure, race loss, cancellation, or
preflight refusal leaves no assessment residue.

If no eligible unassessed receipt exists, the operation is a deterministic no-op: it appends no
event and returns `noOp:true`. Same-authority retries replay the exact event or exact no-op. A reused
idempotency key with a changed repository, actor, boundary, policy, or request conflicts.

## RA6 — bounded append-before-return publication

The scan, receipt count, total historical node references, evidence references, canonical batch
bytes, public result bytes, and ACI envelope/payload bytes each have independent max and max+1
behavior. A non-empty result is preflighted before append using exact publication sizes. No public
success may be published unless its event is durable. The result exposes only stable identifiers,
digests, outcome codes, counts, the pinned prefix, receipt reference, and
`causationClaimed:false`; it grants zero worker, edit, verification, merge, approval, publication,
routing, policy, note, promotion, validity, confidence, or skill-install authority.

## RA7 — exact replay and reverify

Replay validates the event schema, repository, actor, idempotency identity, pinned prefix, policy
and digest, stable ordering, unique receipt IDs, original Phase 48 receipt integrity, receipt-before-
verification-before-terminal ordering, exact task/run/worker/route attribution, operational evidence
digest, terminal compatibility, historical node/version/score/contradiction commitments, per-row
digest, batch projection digest, and every ceiling. Substitution of any self-consistent inner digest
plus an altered outer digest remains an integrity failure.

`reverify` requires the caller's original explicit `observedSeq`, finds the exact durable assessment
event, rebuilds from the historical pinned prefix and operational evidence without appending, and
compares the complete transport-normalized public claim. Restarted reverify is byte-identical.

## RA8 — honest utility audit

Phase 47 `recallUtility` is extended without causal overclaim. At a pinned boundary it reports total
recalls, task-scoped receipts, eligible verified-outcome receipts, assessed and unassessed eligible
receipts, `verifiedPassAfterRecall`, `verifiedFailAfterRecall`, distinct recalled nodes, distinct
assessed nodes, and assessments whose nodes were later recorded as contaminated. Rates are integer
fractions `{numerator, denominator}` rather than floating-point confidence: receipt coverage and
observed verified-pass association. These are association/coverage measures, not helped-rate.

Malformed assessment lineage is a critical causal/grounding violation. Unassessed eligible recalls
remain visible but are not themselves a critical violation. Phase 52 does not down-rank recalled
nodes or implement automatic poison decay; a later versioned policy may consume sufficient evidence
only after explicit minimum-sample and confound controls.

## RA9 — adversarial gates

Zero-provider tests cover verified pass and verified failure; recall after terminal; actor-only and
run-only recall; unverified, cancelled, mixed-task/run/worker/route, future, and borrowed evidence;
contradiction bundles; later invalidation/contamination; request-shape smuggling; worker and forged
transport authority; same-key conflict; concurrent assessment; no-op; stale prefix; every max+1
ceiling; audit failure; cancellation at audit/scan/preflight/append seams; disk failure; live/replay
tamper; restart determinism; exact direct/HTTPS/MCP invoke and reverify parity; seeded secret/path/
prompt/prose non-retention; and proof that ranking, grounding, validity, confidence, promotion, and
routing remain unchanged.

Only after these gates pass may Baton recursively review Phase 52. Recursive evidence must use
explicit harness, model, and effort routes, include the configured GLM harness and concurrent Grok
attempts when available, distinguish provider-ready success from authentication refusal, and finish
with exact process/group, task, worktree, branch, runtime-home, writer-lease, and ownership reaping.

## RA10 — retained next scope

Phase 52 does not retire authenticated contradiction review/resolution UX, a later explicitly
versioned recall-learning policy, generalized cross-run Finding promotion, Playbook/Skill promotion
and activation controls, Scratch Board/REPL/Bench, first-class Goal/Plan authority, retention/
checkpoint compaction, approval-gated deployment-neutral export, or the remaining representation,
control, session, trust, and full-system goal. Project-manager contributes local causal and health-
axis inspiration only; Baton remains self-contained and has no project-manager or homelab runtime
integration.
