// coordination-admission.mjs — issue #259, slice 5: the CoordinationStore members
// the seam map classifies `admission` — 172 of them — moved out of coordination-store.mjs verbatim,
// with the store primitives their bodies read.
//
// Every function is a plain export, never a method: the state it reads is its first parameter, passed
// explicitly — `state` for the one collection the helper projects, `store` when the body reads several
// of them or calls back into the store. A helper that reads no state takes only its own arguments.
// Nothing here imports coordination-store.mjs — the store imports this module, so the layering stays
// acyclic, and every moved member keeps a same-name, same-arity delegate on the class.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARTIFACT_LIFECYCLE_FIELDS, KNOWLEDGE_EDGE_TYPES, KNOWLEDGE_GROUNDINGS, KNOWLEDGE_NODE_TYPES, MAX_STORE_BOARD_DETAIL_BYTES, MAX_STORE_BOARD_EVIDENCE, MAX_STORE_BOARD_TITLE_BYTES, REPL_DIGEST, SAFE_BOARD_ID, SAFE_BOARD_OWNER, SAFE_REPL_NAME, SAFE_REPL_SCOPE, assertWaveStartedRoster, boardBounded, boardReportRequestDigest, coachingRefusal, contextChildAccepted, contextReadAttemptKey, providerAttemptDelay, replBindingContentDigest, replBindingKey, resourceOverlap, validBoardEvidenceRef, validEnvRef, validKnowledgePromotionPolicy, validKnowledgeRecallAssessmentPolicy, validKnowledgeRecallPolicy, validKnowledgeScratchCorrectionPolicy } from './coordination-ledger.mjs';
import { buildWorkflowRoleCatalog, normalizeWorkflowDefinition, validateWorkflowDefinitionLegacy, validateWorkflowDefinitionV3, workflowAttemptRoute, workflowCatalogRole } from './workflow-definition.mjs';
import { CANONICAL_ORDER_VERSION, canonicalJson, compareCanonicalStrings, normalizeCanonicalOrderPolicy } from './canonical-order.mjs';
import { contextCellIdentity, contextProgramIsPure, contextSessionIdentity, normalizeContextArtifactRef, normalizeContextAuthority } from './context-authority.mjs';
import { contextEffectNodeBinding, normalizeContextEffectCall } from './context-call.mjs';
import { contextMapCallIdentity, contextMapNodeBinding, normalizeContextMapCall } from './context-map.mjs';
import { contextValueDigest, normalizeContextProgram, normalizeReplManifest } from './context-program.mjs';
import { CoordinationIntegrityError, CoordinationRefusal, KNOWLEDGE_CANDIDATE_TRIGGERS, TERMINAL, boundedText, canonical, canonicalBytes, canonicalDigest, clone, digest, freeze, promotionActor, sha256Bytes, validKnowledgeContradictionPolicy, validRunId } from './coordination-internals.mjs';
import { DEFAULT_MAX_REPL_MANIFESTS_PER_RUN, RUN_ORCHESTRATOR_CAPABILITIES, RUN_ORCHESTRATOR_REVOCATION_REASONS } from './run-lineage.mjs';
import { FRAME_LIMITS } from './limits.mjs';
import { GoalPlanValidationError, goalPlanDigest, normalizePlanRequest, planRouteMatches } from './goal-plan.mjs';
import { inferTaskTopologyRelation } from './task-topology.mjs';
import { LEGACY_WORKFLOW_POLICY } from './workflow-policy.mjs';
import { normalizeContextProgramPolicy } from './context-program-policy.mjs';
import { normalizeContextResultPathScope, validateContextProviderResultReference } from './context-result.mjs';
import { parseRouteTupleKey } from './route-tuple.mjs';
import { pathInScopes } from './path-scope.mjs';
import { usdFromNanos, usdToNanos } from './usd.mjs';
import { validateContextEffectResultLineage } from './context-effect-result-lineage.mjs';
import { validateContextMapResultLineage } from './context-result-lineage.mjs';
import { validatePureContextOutputLineage } from './context-lineage.mjs';
import { validProcessClosedPayload, validProcessStartedPayload, validRecoveryProcessAbsentPayload, validRecoveryProcessReapedPayload } from './process-lifecycle.mjs';

// ── relocated primitives ─────────────────────────────────────────────────────────────────────────


// The non-knowledge half of the projection-input fence (see _apply's closing note): board
// claim/report traffic (deliberately non-board-fence-bumping) and package admission/attach —
// the only non-knowledge inputs the horizons read, closed by design.

// KG-2 Part D (rule 14): knowledge.workflow_admitted, structurally modeled on
// knowledge.scratch_corrected but with a single-candidate admission surface, not a scan policy.
const KNOWLEDGE_WORKFLOW_ADMISSION_POLICY_FIELDS = ['repoId', 'maxBatchBytes', 'maxResultBytes'];

const SCRATCH_CORRECTION_ADMIN_EVENTS = new Set(['evidence.mapped', 'web.command_admitted', 'mcp.call_admitted']);

const CONTRADICTION_ADMIN_EVENTS = new Set(['evidence.mapped', 'web.command_admitted', 'mcp.call_admitted']);

const PROMOTION_DECISION_KINDS = new Set(['control.stop_requested', 'follow_up.requested', 'publication.authorized', 'publication.denied']);

const PROMOTION_FAILURE_KINDS = new Set(['integration.incomplete', 'integration.refused', 'publication.refused', 'recovery.claimed_without_spawn']);

const PROVIDER_FAILURE_CODES = new Set(['provider_index_changed', 'reuse_policy_reconciliation_required', 'reuse_evidence_diverged', 'capability_refused', 'provider_processing_failed']);

const REPRESENTATION_PRODUCERS = Object.freeze({
  structural_delta: Object.freeze({ capability: 'atlas-structural', version: '0.1.0', operation: 'diff.structural', artifactKind: 'structural_delta', mediaType: 'application/vnd.baton.atlas-structural+json', rung: 'R1', representationType: 'ast_cst_structural_delta', body: 'Derived Atlas structural delta representation', environmentKind: 'tree_delta' }),
  symbol_snapshot: Object.freeze({ capability: 'atlas-index', version: '0.1.0', operation: 'scip.export', artifactKind: 'scip_json', mediaType: 'application/scip+json', rung: 'R2', representationType: 'scip_symbol_snapshot', body: 'Derived Atlas SCIP symbol snapshot representation', environmentKind: 'index_snapshot' }),
  cpg_semantic_delta: Object.freeze({ capability: 'atlas-cpg-delta', version: '0.1.0', operation: 'cpg.delta', artifactKind: 'cpg_delta', mediaType: 'application/vnd.baton.atlas-cpg-delta+json', rung: 'R3', representationType: 'bounded_cpg_semantic_delta', body: 'Derived Atlas bounded binding-aware reachability delta representation; not behavioral semantics or proof', environmentKind: 'tree_delta' }),
});

const REPRESENTATION_AUTHORITY = Object.freeze({
  approval: false, deployment: false, edit: false, integration: false, merge: false,
  policyAuthoring: false, proof: false, publication: false, route: false,
  verification: false, workerControl: false,
});

function validKnowledgeWorkflowAdmissionPolicy(policy) {
  if (!policy || Object.keys(policy).sort().join(',') !== [...KNOWLEDGE_WORKFLOW_ADMISSION_POLICY_FIELDS].sort().join(',') || typeof policy.repoId !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(policy.repoId)) return false;
  const numeric = KNOWLEDGE_WORKFLOW_ADMISSION_POLICY_FIELDS.filter((name) => name !== 'repoId');
  if (numeric.some((name) => !Number.isSafeInteger(policy[name]) || policy[name] <= 0)) return false;
  return policy.maxBatchBytes <= 16 * 1024 * 1024 && policy.maxResultBytes <= 16 * 1024 * 1024;
}

function validResultSha(value) { return typeof value === 'string' && /^[a-f0-9]{40,64}$/u.test(value); }

export function retainedResultRef(sha) { return `refs/baton/results/${sha}`; }

function officialCoordinateMatches(identity, coordinate) { const fields = Object.keys(identity ?? {}).sort().join(','); return ['ecosystem,package,version', 'ecosystem,package,system,version'].includes(fields) && identity.ecosystem === coordinate?.ecosystem && identity.package === coordinate?.package && identity.version === coordinate?.version && (!Object.hasOwn(identity, 'system') || (coordinate.ecosystem === 'npm' && identity.system === 'NPM')); }

// BU-2-3: the scratch-read web frame. A fact whose body references a web_fetch artifact
// handle (art:sha256:<digest>) is framed UNTRUSTED_WEB_CONTENT at read time — a read-side
// projection (the family's existing posture); the durable fact is never rewritten. Facts
// without the handle pass through byte-identical so the projection is scoped to web-sourced
// bodies only.
// REFLEX-2 board bounds. A board item's identity (itemId/itemVersion/itemDigest/ordinal)
// is hub-minted; the content core that the itemDigest content-addresses is exactly these
// nine fields, in the delete-and-recompute discipline (never accepted from a submitter).
// Live board bounds imported from the registry (Decision 8 / v1.2 blue-team blocker 1) — the
// store is a first-class registry consumer, never a second door for a cataloged lane.
// Epic #78 Decision 5: the L1 worker read page is at most 16 items and 28 KiB serialized (the
// receipt wrapper carries the ok/kind/renderedText/idempotencyKey overhead, so the page budget
// is deliberately below the 32 KiB wire ceiling to leave room for it).
/** Epic #78 Decision 6 rule 3: the kernel-level request digest for worker board mutations. It
 * covers ONLY the content the caller submitted (the derived owner/claim/grant coordinates are
 * authority, not content — a replay after a close must not re-judge the original request). The
 * seam additionally namespaces the effective replay key with the grant digest so cross-worker
 * key-string collisions cannot occur. */
/** itemDigest = H(the nine content-core fields), recomputed by the hub, never trusted from input. */

// REPL-2/REPL-3 (docs/reference/evidence/repl-kg-wave-2026-07-22/repl23-decisions.md, issues
// #22/#23). Binding identity/fences/history/citations are (runId, scope, name)-tupled via
// JSON-encoded map keys — never string concatenation (Part A rule 2).
const REPL_CELL_ID = /^cell:[a-f0-9]{64}$/u;

const REPL_CITATION = /^repl:(shared|worker:[A-Za-z0-9._:-]{1,256}):([A-Za-z0-9._-]{1,128})@([1-9][0-9]*)$/u;

const REPL_CELL_MEDIA_TYPE = 'application/vnd.baton.context-value+json';

const MAX_REPL_BINDINGS = 512;




// Short-circuiting JSON-compatible own-data-property walker. It deliberately never reads a
// property before checking its descriptor and never invokes JSON.stringify on untrusted input.



/** Decision 3: a size refusal on a cataloged admission lane carries {cap, actual, unit,
 * gracefulPath} on the thrown error AND a human message composed by the ONE helper — numbers
 * only, never body content (AS-4). */

/** Issue #366 — the ONE bound a run-stop ADMISSION is judged against, read from the ONE registry
 * row (`target_set.per_ledger_event`). The bound is DERIVED, never invented: the run-stop target
 * set is a projection of the ledger — every target is a task/worker the ledger already holds, and
 * each such row costs the ledger at least one event — so the physical bound is the ledger's own
 * event count, exactly the #286 G-41 law stated for `_artifacts`. A second literal ceiling on top
 * of the ledger refused operations the ledger had already accepted, including on replay, where it
 * re-judged a recorded row and made a self-written ledger unloadable; this helper is therefore
 * called at ADMISSION only — the fold (`integrity`) judges no target-set size at all. The refusal
 * names the field, the observed count and the bound. A fleet drain's target set is not a projection
 * of this ledger (see `_validateFleetDrainAdmission`), so that admission derives no bound here. */
function assertTargetSetAdmissible(field, actual, ledgerEvents) {
  const row = FRAME_LIMITS['target_set.per_ledger_event'];
  const bound = row.value * ledgerEvents;
  if (actual <= bound) return;
  throw Object.assign(new CoordinationRefusal(
    `${field} is ${actual} targets (bound ${bound} = ${row.value} × ${ledgerEvents} ledger events,`
    + ` ${row.unit}); a target set is a projection of the ledger — every target is a task or`
    + ' worker the ledger already holds',
    row.refusalCode,
  ), { field, actual, bound, detail: { lane: row.lane, field, actual, bound } });
}

// ── the admission bucket ───────────────────────────────────────────────────────────────────────────

export function _validateCanonicalReceipt(store, receipt, bytes, ledger) {
  const fields = ['canonicalOrderVersion', 'createdAt', 'cutPolicy', 'mode', 'policy', 'prefixBytes', 'prefixDigest', 'prefixEventDigest', 'receiptDigest', 'schemaVersion', 'throughSeq'];
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
    || Object.keys(receipt).sort(compareCanonicalStrings).join(',') !== fields.sort(compareCanonicalStrings).join(',')) {
    store._canonicalOrderFail('canonical-order receipt has unknown or missing fields');
  }
  if (receipt.schemaVersion !== 1 || receipt.canonicalOrderVersion !== CANONICAL_ORDER_VERSION
    || !['empty_bootstrap', 'adopt_compatible'].includes(receipt.mode)
    || !Number.isSafeInteger(receipt.throughSeq) || receipt.throughSeq < 0
    || !Number.isSafeInteger(receipt.prefixBytes) || receipt.prefixBytes < 0
    || !/^[a-f0-9]{64}$/.test(receipt.prefixDigest ?? '')
    || !/^[a-f0-9]{64}$/.test(receipt.prefixEventDigest ?? '')
    || !/^[a-f0-9]{64}$/.test(receipt.receiptDigest ?? '')
    || !Number.isFinite(Date.parse(receipt.createdAt)) || new Date(Date.parse(receipt.createdAt)).toISOString() !== receipt.createdAt) {
    store._canonicalOrderFail('canonical-order receipt is malformed or from an unsupported version');
  }
  let receiptPolicy; let cutPolicy;
  try { receiptPolicy = normalizeCanonicalOrderPolicy(receipt.policy); cutPolicy = normalizeCanonicalOrderPolicy(receipt.cutPolicy); }
  catch { store._canonicalOrderFail('canonical-order receipt policy is malformed'); }
  if (canonicalDigest(receiptPolicy) !== canonicalDigest(store._canonicalOrderPolicy)) store._canonicalOrderFail('canonical-order receipt policy differs from deployment authority');
  if (Object.keys(cutPolicy).some((key) => cutPolicy[key] > receiptPolicy[key])) store._canonicalOrderFail('canonical-order receipt cut exceeds deployment authority');
  const core = Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== 'receiptDigest'));
  if (receipt.receiptDigest !== sha256Bytes(Buffer.from(JSON.stringify(canonicalJson(core, { maxDepth: 16, maxNodes: 128 })), 'utf8'))) {
    store._canonicalOrderFail('canonical-order receipt digest is invalid');
  }
  const canonicalBytesValue = store._receiptBytes(receipt);
  if (bytes.byteLength > store._canonicalOrderPolicy.maxReceiptBytes || !bytes.equals(canonicalBytesValue)) {
    store._canonicalOrderFail('canonical-order receipt bytes are non-canonical or oversized');
  }
  if (receipt.throughSeq > ledger.events.length) store._canonicalOrderFail('canonical-order receipt names a missing prefix');
  const prefixBytes = receipt.throughSeq === 0 ? 0 : ledger.offsets[receipt.throughSeq - 1];
  const prefix = ledger.raw.subarray(0, prefixBytes);
  if (receipt.prefixBytes !== prefixBytes || receipt.prefixDigest !== sha256Bytes(prefix)
    || receipt.prefixEventDigest !== store._canonicalPrefixEventDigest(ledger.events.slice(0, receipt.throughSeq))) {
    store._canonicalOrderFail('canonical-order pinned prefix diverged');
  }
  if ((receipt.mode === 'empty_bootstrap') !== (receipt.throughSeq === 0)) store._canonicalOrderFail('canonical-order receipt mode conflicts with its prefix');
  return freeze(clone(receipt));
}

export function _configureAdvisoryFeedCards(cards) {
  if (!Array.isArray(cards)) throw new TypeError('advisory feed cards must be an array');
  const configured = new Map();
  for (const value of cards) {
    const card = clone(value); const cardDigest = card?.cardDigest; if (card && typeof card === 'object') delete card.cardDigest;
    if (!boundedText(card?.providerId, 128) || !/^[a-f0-9]{64}$/.test(cardDigest ?? '') || canonicalDigest(card) !== cardDigest || configured.has(card.providerId)) throw new TypeError('advisory feed card is invalid');
    configured.set(card.providerId, freeze({ card: freeze(card), cardDigest }));
  }
  return configured;
}

export function _assertWriterLease(store) {
  if (store._projectionPoison) {
    throw new CoordinationIntegrityError(
      `coordination projection is poisoned after durable seq ${store._projectionPoison.seq}; restart and replay are required`,
      'coordination_projection_poisoned',
    );
  }
  if (store._ledgerSyncFailure) {
    // Issue #290: the last group-commit failed, so the durable tail is unconfirmed — the
    // store refuses to hand out further durable authority until a restart re-reads and
    // re-verifies the ledger. Readers keep working; the ledger stays authoritative.
    throw new CoordinationIntegrityError(
      `coordination ledger durability is unconfirmed after a failed sync (${store._ledgerSyncFailure.code}); restart and replay are required`,
      'coordination_ledger_unsynced',
    );
  }
  store._assertLeaseOwnership();
}

export function _assertLeaseOwnership(store) {
  const path = join(store.root, 'writer.lease');
  if (!store._writerLease) {
    if (store._writerLeaseRequired || existsSync(path)) throw new CoordinationRefusal('coordination writer authority is absent', 'coordination_writer_lost');
    store.claimWriterLease(); return;
  }
  let observed; try { observed = JSON.parse(readFileSync(path, 'utf8')); } catch { throw new CoordinationRefusal('coordination writer lease is absent or malformed', 'coordination_writer_lost'); }
  if (observed?.token !== store._writerLease.token || observed?.pid !== store._writerLease.pid
    || (observed.pidStart !== undefined && observed.pidStart !== store._writerLease.pidStart)) {
    throw new CoordinationRefusal('coordination writer lease was replaced', 'coordination_writer_lost');
  }
}

export function _validateRecordedPayload(kind, payload) {
  if (kind !== 'mcp.audit' && kind !== 'web.audit' && kind !== 'driver.recorded') return;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new CoordinationRefusal(`coordination ${kind} payload must be a plain object`, 'coordination_record_invalid');
  }
  if (kind === 'driver.recorded') {
    if (typeof payload.kind !== 'string' || payload.kind.length === 0) {
      throw new CoordinationRefusal('driver.recorded requires a non-empty payload kind', 'coordination_record_invalid');
    }
    if (payload.kind === 'wave.started') {
      try { assertWaveStartedRoster(payload); }
      catch (error) {
        throw Object.assign(new CoordinationRefusal('driver.recorded wave.started roster is malformed', 'coordination_record_invalid'), { cause: error });
      }
    }
  }
}

export function _taskTopologyFailure(message, code, integrity) {
  throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code);
}

export function _validateTaskTopology(store, fields, hint = null, integrity = false) {
  if (!store._taskTopologyPolicy) return null;
  const fail = (message, code) => store._taskTopologyFailure(message, code, integrity);
  const relation = inferTaskTopologyRelation(fields, hint);
  if (!relation) fail('task refinement relation is missing or unsupported', 'task_topology_relation_invalid');
  const taskId = fields?.id;
  const runId = fields?.runId ?? null;
  if (typeof taskId !== 'string' || taskId.length === 0) fail('task topology identity is invalid', 'task_topology_invalid');
  if (store._taskTopologies.has(taskId)) fail('task topology identity already exists', 'duplicate_task');
  const sameRun = [...store._taskTopologies.values()].filter((node) => node.runId === runId);
  if (sameRun.length >= store._taskTopologyPolicy.maxTasksPerRun) {
    fail('task topology reached the deployment Run task ceiling', 'task_topology_run_limit');
  }
  if (relation === 'root') {
    if (fields.refines != null) fail('root task cannot refine another task', 'task_topology_relation_invalid');
    return freeze({ schemaVersion: 1, taskId, runId, relation, parentTaskId: null, depth: 0, ancestors: [] });
  }
  const parentTaskId = fields.refines;
  if (parentTaskId === taskId) {
    fail('task cannot refine itself', 'task_topology_self_refinement');
  }
  const parent = store._tasks.get(parentTaskId);
  const parentTopology = store._taskTopologies.get(parentTaskId);
  if (!parent || !parentTopology) fail('task refinement parent is unavailable', 'task_topology_parent_missing');
  if (parentTopology.ancestors.includes(taskId)) {
    fail('task refinement would create a lineage cycle', 'task_topology_cycle');
  }
  if ((parent.runId ?? null) !== runId || parentTopology.runId !== runId) {
    fail('task refinement parent belongs to a different Run', 'task_topology_run_mismatch');
  }
  const children = [...store._taskTopologies.values()].filter((node) => node.parentTaskId === parentTaskId);
  if (children.length >= store._taskTopologyPolicy.maxChildrenPerTask) {
    fail('task refinement reached the deployment parent fanout ceiling', 'task_topology_fanout_limit');
  }
  if (children.filter((node) => node.relation === relation).length
    >= store._taskTopologyPolicy.maxChildrenByRelation[relation]) {
    fail('task refinement reached its deployment relation fanout ceiling', 'task_topology_relation_limit');
  }
  const depth = parentTopology.depth + 1;
  if (depth > store._taskTopologyPolicy.maxDepth) {
    fail('task refinement reached the deployment lineage depth ceiling', 'task_topology_depth_limit');
  }
  return freeze({
    schemaVersion: 1, taskId, runId, relation, parentTaskId, depth,
    ancestors: [...parentTopology.ancestors, parentTaskId],
  });
}

export function previewTaskTopology(store, fields, hint = null) {
  const node = store._validateTaskTopology(fields, hint, false);
  return node === null ? null : clone(node);
}

export function _runLineageFailure(message, code, integrity = false) {
  if (integrity) {
    const replayCode = code.startsWith('run_orchestrator_')
      ? 'run_orchestrator_lease_integrity' : 'run_lineage_integrity';
    throw new CoordinationIntegrityError(message, replayCode);
  }
  throw new CoordinationRefusal(message, code);
}

export function _normalizeRunOrchestratorLeaseRequest(store, fields, integrity = false) {
  const fail = (message) => store._runLineageFailure(message, 'run_orchestrator_lease_invalid', integrity);
  const expected = ['parentTask', 'repoId', 'schemaVersion', 'session'];
  const parentFields = ['id', 'version'];
  const sessionFields = ['authorityDigest', 'expiresAt', 'principalId', 'sessionId'];
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)
    || Object.keys(fields).sort().join(',') !== expected.join(',') || fields.schemaVersion !== 1
    || !validRunId(fields.repoId) || !fields.parentTask || Array.isArray(fields.parentTask)
    || Object.keys(fields.parentTask).sort().join(',') !== parentFields.join(',')
    || !boundedText(fields.parentTask.id, 4_096)
    || !Number.isSafeInteger(fields.parentTask.version) || fields.parentTask.version <= 0
    || !fields.session || Array.isArray(fields.session)
    || Object.keys(fields.session).sort().join(',') !== sessionFields.join(',')
    || !validRunId(fields.session.principalId) || !validRunId(fields.session.sessionId)
    || !/^[a-f0-9]{64}$/.test(fields.session.authorityDigest ?? '')
    || !Number.isFinite(Date.parse(fields.session.expiresAt ?? ''))
    || new Date(Date.parse(fields.session.expiresAt)).toISOString() !== fields.session.expiresAt) {
    fail('run orchestrator lease request is invalid');
  }
  return freeze(clone(fields));
}

export function _deriveRunOrchestratorLeasePayload(store, request, event, integrity = false) {
  const fail = (message, code = 'run_orchestrator_lease_invalid') => store._runLineageFailure(message, code, integrity);
  if (!store._runLineagePolicy) fail('run lineage authority is not configured', 'run_lineage_policy_invalid');
  if (request.repoId !== store._repoId) {
    fail('run orchestrator repository differs from deployment authority', 'run_orchestrator_repository_mismatch');
  }
  const task = store._tasks.get(request.parentTask.id);
  if (!task || task.version !== request.parentTask.version) fail('run orchestrator parent task is stale', 'run_orchestrator_parent_stale');
  if (task.status !== 'working' || !validRunId(task.assignee) || !validRunId(task.runId)) {
    fail('run orchestrator parent task is inactive', 'run_orchestrator_parent_inactive');
  }
  if (!Array.isArray(task.brief?.capabilities) || !task.brief.capabilities.includes('baton_orchestrator')) {
    fail('run orchestrator capability is required', 'run_orchestrator_capability_required');
  }
  store._assertRunAdmissionOpen(task.runId, integrity);
  const issuedAt = event.ts;
  if (!Number.isFinite(Date.parse(issuedAt ?? ''))
    || new Date(Date.parse(issuedAt)).toISOString() !== issuedAt
    || Date.parse(request.session.expiresAt) <= Date.parse(issuedAt)) {
    fail('run orchestrator lease timestamp is invalid');
  }
  const identity = {
    repoId: request.repoId,
    parentRunId: task.runId,
    parentTaskId: request.parentTask.id,
    parentTaskVersion: request.parentTask.version,
    workerId: task.assignee,
    principalId: request.session.principalId,
    sessionId: request.session.sessionId,
    sessionAuthorityDigest: request.session.authorityDigest,
  };
  const leaseId = `run-orchestrator-lease:${canonicalDigest(identity)}`;
  const expiresAt = new Date(Math.min(
    Date.parse(request.session.expiresAt),
    Date.parse(issuedAt) + store._runLineagePolicy.leaseTtlMs,
  )).toISOString();
  const core = {
    schemaVersion: 1,
    scope: 'application_run_subtree',
    repoId: request.repoId,
    leaseId,
    parent: {
      runId: task.runId, taskId: task.id, taskVersion: task.version, workerId: task.assignee,
    },
    session: clone(request.session),
    capabilities: [...RUN_ORCHESTRATOR_CAPABILITIES],
    issuedAt,
    expiresAt,
    policyDigest: canonicalDigest(store._runLineagePolicy),
    requestDigest: canonicalDigest(request),
  };
  return freeze({ ...core, leaseDigest: canonicalDigest(core) });
}

export function _validateRunOrchestratorLeaseIssued(store, payload, event, integrity = false) {
  const fail = (message, code = 'run_orchestrator_lease_invalid') => store._runLineageFailure(message, code, integrity);
  const fields = [
    'capabilities', 'expiresAt', 'issuedAt', 'leaseDigest', 'leaseId', 'parent', 'policyDigest',
    'repoId', 'requestDigest', 'schemaVersion', 'scope', 'session',
  ];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).sort().join(',') !== fields.sort().join(',')
    || payload.schemaVersion !== 1 || payload.scope !== 'application_run_subtree') {
    fail('run orchestrator lease payload is invalid');
  }
  // Epic #78 Decision 6 rule 6: replay reconstructs byte-identically across store restart even
  // when the issuing run-lineage policy is not re-supplied to the reopened store. The policy
  // was authoritative at issue time; replay re-validates the payload's internal
  // self-consistency (leaseDigest recomputes from the payload's own fields) and the lease
  // identity without re-deriving policy-dependent fields.
  if (integrity && !store._runLineagePolicy) {
    const { leaseDigest, ...core } = payload;
    if (leaseDigest !== canonicalDigest(core)) fail('run orchestrator lease binding is invalid');
    if (event.idempotencyKey !== `run.orchestrator_lease:${payload.leaseId}`) fail('run orchestrator lease binding is invalid');
    return payload;
  }
  const request = store._normalizeRunOrchestratorLeaseRequest({
    schemaVersion: 1,
    repoId: payload.repoId,
    parentTask: { id: payload.parent?.taskId, version: payload.parent?.taskVersion },
    session: payload.session,
  }, integrity);
  const expected = store._deriveRunOrchestratorLeasePayload(request, event, integrity);
  if (canonicalDigest(payload) !== canonicalDigest(expected)
    || event.idempotencyKey !== `run.orchestrator_lease:${expected.leaseId}`
    || !boundedText(event.actor, 256)) fail('run orchestrator lease binding is invalid');
  return expected;
}

export function _isRunOrchestratorLeaseRevokeKey(key, leaseId) {
  return key === `run.orchestrator_lease.revoke:${leaseId}`
    || key === `run.orchestrator_lease_revoked:${leaseId}`;
}

export function _validateRunOrchestratorLeaseRevoked(store, payload, event, integrity = false) {
  const fail = (message, code = 'run_orchestrator_lease_invalid') => store._runLineageFailure(message, code, integrity);
  const fields = ['leaseDigest', 'leaseId', 'reason', 'revocationDigest', 'schemaVersion'];
  if (!payload || Object.keys(payload).sort().join(',') !== fields.sort().join(',')
    || payload.schemaVersion !== 1 || !RUN_ORCHESTRATOR_REVOCATION_REASONS.includes(payload.reason)
    || !/^[a-f0-9]{64}$/.test(payload.leaseDigest ?? '')
    || !/^[a-f0-9]{64}$/.test(payload.revocationDigest ?? '')) fail('run orchestrator lease revocation is invalid');
  const lease = store._runOrchestratorLeases.get(payload.leaseId);
  if (!lease || lease.status !== 'active' || lease.leaseDigest !== payload.leaseDigest) {
    fail('run orchestrator lease revocation has no active authority', 'run_orchestrator_lease_not_found');
  }
  const { revocationDigest, ...core } = payload;
  if (revocationDigest !== canonicalDigest(core)
    || !store._isRunOrchestratorLeaseRevokeKey(event.idempotencyKey, payload.leaseId)
    || !boundedText(event.actor, 256)) fail('run orchestrator lease revocation binding is invalid');
  return lease;
}

export function _deriveRunLineagePayload(store, request, lease, ignoredSeq = null, integrity = false) {
  const fail = (message, code = 'run_lineage_invalid') => store._runLineageFailure(message, code, integrity);
  if (request.repoId !== lease.repoId) fail('run lineage repository differs from its lease', 'run_lineage_invalid');
  if (store._runIdentityHasEffects(request.childRunId, ignoredSeq)) fail('child Run identity already has effects', 'run_lineage_conflict');
  const parentLineage = store._runLineages.get(lease.parent.runId) ?? null;
  const rootRunId = parentLineage?.rootRunId ?? lease.parent.runId;
  const depth = (parentLineage?.depth ?? 0) + 1;
  const ancestors = parentLineage
    ? [...parentLineage.ancestors, lease.parent.runId] : [lease.parent.runId];
  if (ancestors.includes(request.childRunId)) fail('run lineage would create a cycle', 'run_lineage_cycle');
  if (depth > store._runLineagePolicy.maxDepth) fail('run lineage depth ceiling reached', 'run_lineage_depth');
  if (store.runChildren(lease.parent.runId).length >= store._runLineagePolicy.maxChildrenPerRun) {
    fail('run lineage child ceiling reached', 'run_lineage_children');
  }
  if (store.runDescendants(rootRunId).length >= store._runLineagePolicy.maxDescendantsPerRoot) {
    fail('run lineage descendant ceiling reached', 'run_lineage_descendants');
  }
  const core = {
    schemaVersion: 1,
    scope: 'application_run_child',
    repoId: request.repoId,
    rootRunId,
    parentRunId: lease.parent.runId,
    childRunId: request.childRunId,
    depth,
    ancestors,
    parent: {
      taskId: lease.parent.taskId,
      taskVersion: lease.parent.taskVersion,
      workerId: lease.parent.workerId,
    },
    parentLineageEvent: parentLineage
      ? store._runLineageEventSeqs.get(parentLineage.childRunId) : null,
    lease: { id: lease.leaseId, digest: lease.leaseDigest, issuedEvent: lease.issuedEvent },
    intentDigest: request.intentDigest,
    policyDigest: canonicalDigest(store._runLineagePolicy),
    requestDigest: canonicalDigest({ ...request, orchestratorLeaseId: lease.leaseId }),
  };
  return freeze({ ...core, admissionDigest: canonicalDigest(core) });
}

export function _validateRunLineageAdmission(store, payload, event, integrity = false) {
  const fail = (message, code = 'run_lineage_invalid') => store._runLineageFailure(message, code, integrity);
  const fields = [
    'admissionDigest', 'ancestors', 'childRunId', 'depth', 'intentDigest', 'lease',
    'parent', 'parentLineageEvent', 'parentRunId', 'policyDigest', 'repoId', 'requestDigest',
    'rootRunId', 'schemaVersion', 'scope',
  ];
  if (!payload || Object.keys(payload).sort().join(',') !== fields.sort().join(',')
    || payload.schemaVersion !== 1 || payload.scope !== 'application_run_child'
    || !validRunId(payload.childRunId) || !/^[a-f0-9]{64}$/.test(payload.intentDigest ?? '')) {
    fail('run lineage admission is invalid');
  }
  const lease = store._runOrchestratorLeases.get(payload.lease?.id);
  if (!lease || lease.status !== 'active' || lease.leaseDigest !== payload.lease?.digest
    || lease.issuedEvent !== payload.lease?.issuedEvent) fail('run lineage lease binding is invalid', 'run_orchestrator_lease_not_found');
  const request = freeze({
    schemaVersion: 1, repoId: payload.repoId,
    childRunId: payload.childRunId, intentDigest: payload.intentDigest,
  });
  const expected = store._deriveRunLineagePayload(request, lease, event.seq, integrity);
  if (canonicalDigest(payload) !== canonicalDigest(expected)
    || event.idempotencyKey !== `run.lineage:${payload.childRunId}`
    || !boundedText(event.actor, 256)) fail('run lineage admission binding is invalid');
  return expected;
}

export function admitRunLineage(store, fields, auth) {
  const expected = ['childRunId', 'intentDigest', 'repoId', 'schemaVersion'];
  if (!fields || Object.keys(fields).sort().join(',') !== expected.sort().join(',')
    || fields.schemaVersion !== 1 || !validRunId(fields.repoId) || !validRunId(fields.childRunId)
    || !/^[a-f0-9]{64}$/.test(fields.intentDigest ?? '') || !boundedText(auth?.actor, 256)
    || !boundedText(auth?.key, 512) || !boundedText(auth?.orchestratorLeaseId, 512)) {
    store._runLineageFailure('run lineage request is invalid', 'run_lineage_invalid');
  }
  const request = freeze(clone(fields));
  const prior = store._byKey.get(auth.key);
  if (prior) {
    const lease = store._runOrchestratorLeases.get(auth.orchestratorLeaseId);
    const sameSession = lease && auth.principalId === lease.session.principalId
      && auth.sessionId === lease.session.sessionId
      && auth.sessionAuthorityDigest === lease.session.authorityDigest;
    if (prior.kind !== 'run.lineage_admitted' || prior.actor !== auth.actor || !sameSession
      || prior.payload?.requestDigest !== canonicalDigest({ ...request, orchestratorLeaseId: auth.orchestratorLeaseId })) {
      store._runLineageFailure('run lineage idempotency conflict', 'run_lineage_conflict');
    }
    return freeze({ ok: true, result: 'replay', event: clone(prior), lineage: store.runLineage(prior.payload.childRunId) });
  }
  if (auth.key !== `run.lineage:${request.childRunId}`) {
    store._runLineageFailure('run lineage authority is invalid', 'run_lineage_invalid');
  }
  const lease = store._activeRunOrchestratorLease(auth);
  const payload = store._deriveRunLineagePayload(request, lease);
  const event = store._append('run.lineage_admitted', payload, auth);
  return freeze({ ok: true, result: 'admitted', event: clone(event), lineage: store.runLineage(request.childRunId) });
}

export function authorizeRunOrchestratorCommand(store, fields, auth) {
  const expected = ['command', 'repoId', 'runId', 'schemaVersion'];
  if (!fields || Object.keys(fields).sort().join(',') !== expected.sort().join(',')
    || fields.schemaVersion !== 1 || !validRunId(fields.repoId) || !validRunId(fields.runId)
    || !boundedText(fields.command, 256)) {
    store._runLineageFailure('run orchestrator command is invalid', 'run_orchestrator_command_forbidden');
  }
  const lease = store._activeRunOrchestratorLease(auth);
  if (!RUN_ORCHESTRATOR_CAPABILITIES.includes(fields.command)) {
    store._runLineageFailure('run orchestrator command is forbidden', 'run_orchestrator_command_forbidden');
  }
  const target = store._runLineages.get(fields.runId);
  const ancestorIndex = target?.ancestors.indexOf(lease.parent.runId) ?? -1;
  const firstChildRunId = ancestorIndex < 0 ? null
    : (ancestorIndex + 1 < target.ancestors.length
      ? target.ancestors[ancestorIndex + 1] : target.childRunId);
  const firstLineage = firstChildRunId ? store._runLineages.get(firstChildRunId) : null;
  if (fields.repoId !== lease.repoId || !target || !firstLineage
    || firstLineage.parentRunId !== lease.parent.runId || firstLineage.lease.id !== lease.leaseId) {
    store._runLineageFailure('run orchestrator command is outside the lease subtree', 'run_orchestrator_scope_forbidden');
  }
  return freeze({
    ok: true, leaseId: lease.leaseId, command: fields.command,
    repoId: fields.repoId, runId: fields.runId,
  });
}

export function _goalPlanFailure(message, code, integrity = false) {
  throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code);
}

export function _representationFailure(message, code = 'representation_integrity', integrity = false) {
  throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code);
}

export function _representationRequest(store, request, auth, integrity = false, requireLive = true) {
  const fail = (message, code = 'representation_invalid') => store._representationFailure(message, code, integrity);
  const idempotencyKey = auth?.key ?? auth?.idempotencyKey;
  if (!store._representationPolicy) fail('representation production is not deployment configured', 'representation_policy_unavailable');
  const requestFields = ['environment', 'producerKind', 'repoId', 'runId', 'schemaVersion', 'sourceArguments', 'taskId'];
  const argumentFields = ['bytes', 'digest'];
  if (!request || typeof request !== 'object' || Array.isArray(request)
    || Object.keys(request).sort().join(',') !== requestFields.sort().join(',') || request.schemaVersion !== 1
    || !boundedText(request.repoId, 256) || !boundedText(request.taskId, 4_096)
    || (request.runId !== null && !validRunId(request.runId))
    || !Object.hasOwn(REPRESENTATION_PRODUCERS, request.producerKind)
    || !request.sourceArguments || typeof request.sourceArguments !== 'object' || Array.isArray(request.sourceArguments)
    || Object.keys(request.sourceArguments).sort().join(',') !== argumentFields.sort().join(',')
    || !/^[a-f0-9]{64}$/.test(request.sourceArguments.digest ?? '')
    || !Number.isSafeInteger(request.sourceArguments.bytes) || request.sourceArguments.bytes <= 0
    || !boundedText(auth?.actor, 256) || !boundedText(idempotencyKey, 512)) fail('representation production request is malformed');
  if (request.sourceArguments.bytes > store._representationPolicy.maxArgumentBytes) fail('representation arguments exceeded deployment ceiling', 'representation_oversize');
  const mapping = REPRESENTATION_PRODUCERS[request.producerKind]; const environment = request.environment;
  const deltaFields = ['afterOverlayDigest', 'afterTreeSha', 'beforeOverlayDigest', 'beforeTreeSha', 'kind', 'repoId', 'schemaVersion'];
  const indexFields = ['indexEpoch', 'kind', 'overlayDigest', 'repoId', 'schemaVersion', 'treeSha'];
  const expectedEnvironmentFields = mapping.environmentKind === 'tree_delta' ? deltaFields : indexFields;
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)
    || Object.keys(environment).sort().join(',') !== expectedEnvironmentFields.sort().join(',')
    || environment.schemaVersion !== 1 || environment.kind !== mapping.environmentKind
    || environment.repoId !== request.repoId
    || (mapping.environmentKind === 'tree_delta'
      ? !/^[a-f0-9]{4,128}$/.test(environment.beforeTreeSha ?? '')
        || !/^[a-f0-9]{64}$/.test(environment.beforeOverlayDigest ?? '')
        || !/^[a-f0-9]{4,128}$/.test(environment.afterTreeSha ?? '')
        || !/^[a-f0-9]{64}$/.test(environment.afterOverlayDigest ?? '')
      : !/^[a-f0-9]{4,128}$/.test(environment.treeSha ?? '')
        || !/^[a-f0-9]{64}$/.test(environment.indexEpoch ?? '')
        || (environment.overlayDigest !== null && !/^[a-f0-9]{64}$/.test(environment.overlayDigest ?? '')))) fail('representation environment identity is malformed');
  if (request.repoId !== store._representationPolicy.repoId) fail('representation repository disagrees with deployment', 'representation_scope_mismatch');
  const task = store._tasks.get(request.taskId); const taskNode = store._knowledgeNodes.get(`task:${request.taskId}`);
  if (!task || !taskNode || task.createdEvent >= (auth.seq ?? store._events.length + 1)
    || (requireLive && !['working', 'input_required', 'paused'].includes(task.status))) fail('representation requires an exact live durable task', 'representation_task_unavailable');
  if ((task.runId ?? null) !== request.runId) fail('representation run membership disagrees with its task', 'representation_scope_mismatch');
  const policyDigest = canonicalDigest(store._representationPolicy);
  const requestDigest = canonicalDigest({ actor: auth.actor, idempotencyKey, request, policyDigest });
  return freeze({ request: clone(request), task, mapping, policyDigest, requestDigest, environmentDigest: canonicalDigest(environment) });
}

export function _representationSource(store, source, requestState, evidence, event, integrity = false) {
  const fail = (message, code = 'representation_invalid') => store._representationFailure(message, code, integrity);
  const sourceFields = ['artifact', 'capability', 'operation', 'resultDigest', 'resultProjectionDigest', 'reverifyResultDigest'];
  const capabilityFields = ['cardDigest', 'name', 'version']; const artifactFields = ['bytes', 'digest', 'handle', 'kind', 'mediaType'];
  if (!source || typeof source !== 'object' || Array.isArray(source)
    || Object.keys(source).sort().join(',') !== sourceFields.sort().join(',')
    || !source.capability || Object.keys(source.capability).sort().join(',') !== capabilityFields.sort().join(',')
    || source.capability.name !== requestState.mapping.capability || source.capability.version !== requestState.mapping.version
    || !/^[a-f0-9]{64}$/.test(source.capability.cardDigest ?? '') || source.operation !== requestState.mapping.operation
    || !source.artifact || Object.keys(source.artifact).sort().join(',') !== artifactFields.sort().join(',')
    || source.artifact.kind !== requestState.mapping.artifactKind || source.artifact.mediaType !== requestState.mapping.mediaType
    || !/^[a-f0-9]{64}$/.test(source.artifact.digest ?? '')
    || source.artifact.handle !== `art:sha256:${source.artifact.digest}`
    || !Number.isSafeInteger(source.artifact.bytes) || source.artifact.bytes <= 0
    || [source.resultDigest, source.resultProjectionDigest, source.reverifyResultDigest].some((value) => !/^[a-f0-9]{64}$/.test(value ?? ''))) fail('representation source projection is malformed');
  if (canonicalBytes(source.artifact) > store._representationPolicy.maxSourceRefBytes) fail('representation source reference exceeded deployment ceiling', 'representation_oversize');
  store._representationEvidence(evidence, requestState, source, event, integrity);
  return clone(source);
}

export function _representationGraphTemplate(store, fields, auth, integrity = false, requireLive = true) {
  const event = auth; const requestState = store._representationRequest(fields?.request, event, integrity, requireLive);
  const fail = (message, code = 'representation_invalid') => store._representationFailure(message, code, integrity);
  const fieldNames = ['evidence', 'request', 'requestDigest', 'source'];
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)
    || Object.keys(fields).sort().join(',') !== fieldNames.sort().join(',')
    || fields.requestDigest !== requestState.requestDigest) fail('representation production fields are open or request-bound incorrectly');
  const source = store._representationSource(fields.source, requestState, fields.evidence, event, integrity);
  const mapping = requestState.mapping;
  const identity = {
    repoId: fields.request.repoId, taskId: fields.request.taskId, runId: fields.request.runId,
    producerKind: fields.request.producerKind, rung: mapping.rung, representationType: mapping.representationType,
    capabilityName: source.capability.name, capabilityVersion: source.capability.version,
    capabilityCardDigest: source.capability.cardDigest, operation: source.operation,
    sourceArgumentsDigest: fields.request.sourceArguments.digest, sourceArtifactKind: source.artifact.kind,
    sourceArtifactDigest: source.artifact.digest, sourceArtifactBytes: source.artifact.bytes,
    resultProjectionDigest: source.resultProjectionDigest, reverifyResultDigest: source.reverifyResultDigest,
    environment: clone(fields.request.environment), producerSchemaVersion: 1, policyDigest: requestState.policyDigest,
  };
  const identityDigest = canonicalDigest(identity); const representationId = `representation:${identityDigest}`;
  const receipt = {
    schemaVersion: 1, kind: 'graph-backed-representation', identityDigest, repoId: fields.request.repoId,
    taskId: fields.request.taskId, runId: fields.request.runId, grounding: 'derived',
    producer: { schemaVersion: 1, kind: fields.request.producerKind, rung: mapping.rung, representationType: mapping.representationType, policyDigest: requestState.policyDigest },
    capability: clone(source.capability), operation: source.operation,
    sourceArgumentsDigest: fields.request.sourceArguments.digest, sourceArtifact: clone(source.artifact),
    resultDigest: source.resultDigest, resultProjectionDigest: source.resultProjectionDigest,
    reverifyResultDigest: source.reverifyResultDigest, environment: clone(fields.request.environment),
    authority: clone(REPRESENTATION_AUTHORITY),
  };
  const receiptSerialized = JSON.stringify(canonical(receipt));
  const receiptDigest = canonicalDigest(receipt); const receiptRef = {
    kind: 'representation-receipt', mediaType: 'application/vnd.baton.representation-receipt+json',
    handle: `art:sha256:${receiptDigest}`, digest: receiptDigest, bytes: Buffer.byteLength(receiptSerialized),
  };
  if (receiptRef.bytes > store._representationPolicy.maxReceiptBytes) fail('representation receipt exceeded deployment ceiling', 'representation_oversize');
  const sourceArtifactId = `representation-source:${canonicalDigest({ repoId: fields.request.repoId, digest: source.artifact.digest })}`;
  const receiptArtifactId = `representation-receipt:${receiptDigest}`;
  const provenance = [clone(fields.evidence.invoke), clone(fields.evidence.reverify)];
  const newSourceArtifact = {
    id: sourceArtifactId, owner: { kind: 'representation-source', repoId: fields.request.repoId }, repoId: fields.request.repoId,
    kind: source.artifact.kind, mediaType: source.artifact.mediaType, digest: source.artifact.digest,
    bytes: source.artifact.bytes, refs: [clone(source.artifact)], accepted: true, provenance,
  };
  const sourceArtifact = store._representationArtifactManifest(sourceArtifactId, newSourceArtifact, event, integrity);
  const receiptArtifact = {
    id: receiptArtifactId, owner: { kind: 'representation', id: representationId }, repoId: fields.request.repoId,
    taskId: fields.request.taskId, kind: receiptRef.kind, mediaType: receiptRef.mediaType,
    digest: receiptRef.digest, bytes: receiptRef.bytes, refs: [{ artifactId: sourceArtifactId }], accepted: true, provenance,
  };
  const graphEvidence = [{ coordinationSeq: fields.evidence.invoke.coordinationSeq }, { coordinationSeq: fields.evidence.reverify.coordinationSeq }];
  const representationNode = store._knowledgePayload({
    id: representationId, type: 'Representation', grounding: 'derived', body: mapping.body,
    evidence: [...clone(graphEvidence), { artifactId: receiptArtifactId }],
    promotion: { kind: 'Representation', trigger: 'representation.produce' }, repoId: fields.request.repoId,
    taskId: fields.request.taskId, runId: fields.request.runId, identityDigest,
    producerKind: fields.request.producerKind, rung: mapping.rung, representationType: mapping.representationType,
    sourceDigest: source.artifact.digest, environmentDigest: requestState.environmentDigest, policyDigest: requestState.policyDigest,
  });
  const sourceNodeId = `artifact:${sourceArtifactId}`;
  const sourceNode = store._knowledgePayload({
    id: sourceNodeId, type: 'Artifact', grounding: 'verified', body: `Reverified ${source.artifact.kind} representation source artifact`,
    evidence: [{ artifactId: sourceArtifactId }], promotion: { kind: 'RepresentationSource', trigger: 'representation.produce' },
    repoId: fields.request.repoId, artifactId: sourceArtifactId, digest: source.artifact.digest,
  });
  const taskNodeId = `task:${fields.request.taskId}`;
  const edges = [
    store._knowledgePayload({ id: `knowledge-edge:derivedfrom:${representationId}:${sourceNodeId}`, type: 'DerivedFrom', from: representationId, to: sourceNodeId, evidence: clone(graphEvidence) }),
    store._knowledgePayload({ id: `knowledge-edge:producedby:${sourceNodeId}:${taskNodeId}`, type: 'ProducedBy', from: sourceNodeId, to: taskNodeId, evidence: [{ artifactId: sourceArtifactId }] }),
    store._knowledgePayload({ id: `knowledge-edge:observedin:${representationId}:${taskNodeId}`, type: 'ObservedIn', from: representationId, to: taskNodeId, evidence: clone(graphEvidence) }),
  ];
  const nodes = [representationNode, sourceNode]; const graphDigest = canonicalDigest({ nodes, edges });
  const projection = {
    identityDigest, representationId, receiptRef: clone(receiptRef), sourceArtifact: clone(sourceArtifact),
    receiptArtifact: clone(receiptArtifact), node: clone(representationNode), sourceNode: clone(sourceNode), edges: clone(edges), graphDigest,
  };
  const core = {
    schemaVersion: 1, request: clone(fields.request), requestDigest: fields.requestDigest,
    policy: clone(store._representationPolicy), policyDigest: requestState.policyDigest,
    mapping: { kind: fields.request.producerKind, capability: mapping.capability, operation: mapping.operation, rung: mapping.rung, representationType: mapping.representationType },
    source, evidence: clone(fields.evidence), identity, identityDigest, receipt, receiptRef,
    sourceArtifact, receiptArtifact, nodes, edges, graphDigest,
  };
  const payload = { ...core, productionDigest: canonicalDigest(core) };
  if (canonicalBytes(payload) > store._representationPolicy.maxGraphBatchBytes) fail('representation graph batch exceeded deployment ceiling', 'representation_oversize');
  if (canonicalBytes(projection) > store._representationPolicy.maxResultBytes) fail('representation result exceeded deployment ceiling', 'representation_oversize');
  return freeze({ requestState, source, receipt, receiptSerialized, receiptRef, identityDigest, representationId, projection, payload });
}

export function _validateRepresentationNamespaces(store, derived, integrity = false) {
  const fail = (message) => store._representationFailure(message, 'representation_namespace_conflict', integrity);
  const existingRepresentation = store._representations.get(derived.identityDigest);
  const nodeLifecycle = new Set(['derivedFromEvent', 'eventTime', 'eventTimeSeq', 'invalidatedBy', 'observedAt', 'observedSeq', 'validFrom', 'validTo', 'validityVersion']);
  for (const node of derived.payload.nodes) {
    const prior = store._knowledgeNodes.get(node.id); if (!prior) continue;
    const manifest = Object.fromEntries(Object.entries(prior).filter(([key]) => !nodeLifecycle.has(key)));
    const sourceReuse = node.id === derived.projection.sourceNode.id && canonicalDigest(manifest) === canonicalDigest(node) && prior.validTo === null;
    const sameRepresentation = !integrity && node.id === derived.representationId && existingRepresentation?.identityDigest === derived.identityDigest;
    if (!sourceReuse && !sameRepresentation) fail('reserved representation node identity is occupied');
  }
  for (const edge of derived.payload.edges) {
    const prior = store._knowledgeEdges.get(edge.id); if (!prior) continue;
    const manifest = Object.fromEntries(Object.entries(prior).filter(([key]) => !nodeLifecycle.has(key)));
    const reusableProducedBy = edge.type === 'ProducedBy' && canonicalDigest(manifest) === canonicalDigest(edge) && prior.validTo === null;
    const sameRepresentation = !integrity && existingRepresentation?.edges?.some((item) => item.id === edge.id);
    if (!reusableProducedBy && !sameRepresentation) fail('reserved representation edge identity is occupied');
  }
  const receiptPrior = store._artifacts.get(derived.projection.receiptArtifact.id);
  if (receiptPrior && (integrity || existingRepresentation?.receiptArtifact?.id !== receiptPrior.id)) fail('reserved representation receipt identity is occupied');
}

export function _validateRepresentationPayload(store, payload, event, integrity = false) {
  const fail = (message, code = 'representation_integrity') => store._representationFailure(message, code, integrity);
  const fields = ['edges', 'evidence', 'graphDigest', 'identity', 'identityDigest', 'mapping', 'nodes', 'policy', 'policyDigest', 'productionDigest', 'receipt', 'receiptArtifact', 'receiptRef', 'request', 'requestDigest', 'schemaVersion', 'source', 'sourceArtifact'];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).sort().join(',') !== fields.sort().join(',') || payload.schemaVersion !== 1
    || canonicalDigest(payload.policy) !== canonicalDigest(store._representationPolicy)
    || payload.policyDigest !== canonicalDigest(store._representationPolicy)) fail('representation event shape or policy diverged');
  const derived = store._representationGraphTemplate({
    request: payload.request, requestDigest: payload.requestDigest, source: payload.source, evidence: payload.evidence,
  }, event, integrity);
  if (canonicalDigest(payload) !== canonicalDigest(derived.payload)) fail('representation event projection diverged');
  store._validateRepresentationNamespaces(derived, integrity);
  return derived;
}

export function _validateRunSealPayload(store, p, eventSeq, integrity = false) {
  const fail = (message, code) => {
    throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code);
  };
  if (!validRunId(p?.runId)) fail('runId is invalid', 'invalid_run_id');
  if (store._runs.has(p.runId)) fail(`duplicate run seal ${p.runId}`, 'duplicate_run_seal');
  if (!Number.isSafeInteger(p.coordinationUpperBound) || p.coordinationUpperBound !== eventSeq - 1) fail('run coordination prefix is invalid', 'run_prefix_changed');
  const members = [...store._tasks.values()].filter((task) => task.runId === p.runId).sort((a, b) => compareCanonicalStrings(a.id, b.id));
  if (members.length === 0) fail(`unknown run ${p.runId}`, 'run_not_found');
  const taskIds = Array.isArray(p.taskIds) ? [...p.taskIds].sort() : [];
  if (JSON.stringify(taskIds) !== JSON.stringify(members.map((task) => task.id))) fail('run membership is invalid', 'run_membership_changed');
  if (members.some((task) => !TERMINAL.has(task.status))) fail(`run ${p.runId} has nonterminal tasks`, 'run_not_terminal');
  if (!Array.isArray(p.operationalTails) || p.operationalTails.length !== members.length) fail('run operational tails are incomplete', 'run_tail_invalid');
  const tails = new Map(p.operationalTails.map((tail) => [tail?.taskId, tail]));
  for (const task of members) {
    const tail = tails.get(task.id);
    if (!tail || tail.worker !== task.assignee || !Number.isSafeInteger(tail.tail) || tail.tail < 1) fail(`invalid operational tail for ${task.id}`, 'run_tail_invalid');
  }
  if (!/^[a-f0-9]{64}$/.test(p.scorecardDigest ?? '') || !p.scorecard || typeof p.scorecard !== 'object' || Array.isArray(p.scorecard)) fail('run scorecard digest/row invalid', 'run_scorecard_invalid');
  if (!p.artifact || typeof p.artifact.path !== 'string' || p.artifact.path.length === 0 || p.artifact.digest !== p.scorecardDigest || !Number.isSafeInteger(p.artifact.bytes) || p.artifact.bytes <= 0) fail('run scorecard artifact invalid', 'run_artifact_invalid');
  const evidence = Array.isArray(p.evidence) ? p.evidence : [];
  const evidenceSeqs = new Set();
  for (const ref of evidence) {
    if (!Number.isInteger(ref?.coordinationSeq) || ref.coordinationSeq < 1 || ref.coordinationSeq > p.coordinationUpperBound || !store._events[ref.coordinationSeq - 1]) fail('run scorecard evidence is invalid', 'run_evidence_invalid');
    evidenceSeqs.add(ref.coordinationSeq);
  }
  if (members.some((task) => !evidenceSeqs.has(task.terminalEvent))) fail('run scorecard omits terminal task evidence', 'run_evidence_invalid');
  const runNodeId = `run:${p.runId}`; const artifactNodeId = `run-scorecard:${p.scorecardDigest}`;
  if (store._knowledgeNodes.has(runNodeId) || store._knowledgeNodes.has(artifactNodeId)) fail('run scorecard graph identity already exists', 'duplicate_node');
  return { members, evidence: clone(evidence), runNodeId, artifactNodeId };
}

export function _validateRouteObservationPayload(store, p, event, integrity = false) {
  const fail = (message, code = 'route_observation_integrity') => { throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code); };
  const fields = ['schemaVersion', 'policyDigest', 'taskId', 'expectedTaskVersion', 'taskType', 'runId', 'routeKey', 'modelFamily', 'route', 'terminalStatus', 'verifiedWin', 'verificationEvidence', 'observedAt', 'observationDigest'];
  const routeFields = ['harnessRequested', 'harnessResolved', 'modelRequested', 'modelResolved', 'modelObserved', 'effortRequested', 'effortResolved', 'effortObserved'];
  if (!p || Object.keys(p).sort().join(',') !== fields.sort().join(',') || p.schemaVersion !== 1 || !store._routePolicy || p.policyDigest !== canonicalDigest(store._routePolicy)
    || !boundedText(p.taskId, 256) || !boundedText(p.taskType, 256) || (p.runId !== null && !validRunId(p.runId)) || !boundedText(p.routeKey, 4096) || !boundedText(p.modelFamily, 128)
    || !p.route || Object.keys(p.route).sort().join(',') !== routeFields.sort().join(',') || !['completed', 'failed'].includes(p.terminalStatus) || p.verifiedWin !== (p.terminalStatus === 'completed')
    || !Number.isSafeInteger(p.expectedTaskVersion) || !Number.isFinite(Date.parse(p.observedAt)) || new Date(Date.parse(p.observedAt)).toISOString() !== p.observedAt || p.observedAt !== event.ts
    || !/^[a-f0-9]{64}$/.test(p.observationDigest ?? '') || event.actor !== 'policy') fail('route observation shape is invalid');
  let tuple; try { tuple = parseRouteTupleKey(p.routeKey); } catch { fail('route observation key is invalid'); }
  if (tuple.modelFamily !== p.modelFamily || tuple.taskType !== p.taskType || `${tuple.harness}@${tuple.version}` !== p.route.harnessResolved
    || tuple.model !== (p.route.modelResolved ?? 'default') || tuple.effort !== (p.route.effortResolved ?? 'default')) fail('route observation tuple is invalid');
  const task = store._tasks.get(p.taskId); if (!task || task.taskType !== p.taskType || (task.runId ?? null) !== p.runId) fail('route observation task is invalid', 'route_observation_stale');
  if (integrity) {
    if (task.status !== p.terminalStatus || task.version !== p.expectedTaskVersion + 1) fail('route observation terminal task diverged', 'route_observation_stale');
    const terminal = store._events[task.terminalEvent - 1]; if (!terminal || event.idempotencyKey !== `${terminal.idempotencyKey}:route:${p.taskId}`) fail('route observation idempotency identity diverged');
  } else if (task.status !== 'working' || task.version !== p.expectedTaskVersion) fail('route observation target is stale', 'route_observation_stale');
  for (const field of routeFields.filter((name) => !['modelObserved', 'effortObserved'].includes(name))) if ((task[field] ?? null) !== p.route[field]) fail('route observation attribution diverged');
  if ((task.routeKey ?? null) !== p.routeKey) fail('route observation route key diverged');
  const evidence = p.verificationEvidence; const mapped = store._events[evidence?.coordinationSeq - 1];
  if (!evidence || !Number.isSafeInteger(evidence.coordinationSeq) || mapped?.kind !== 'evidence.mapped' || mapped.payload?.kind !== 'verify.reverified'
    || canonicalDigest({ ...mapped.payload, coordinationSeq: mapped.seq }) !== canonicalDigest(evidence)) fail('route observation verification evidence is invalid');
  const source = store._operationalRead?.(mapped.payload.worker, mapped.payload.workerSeq);
  if (!source || source.kind !== 'verify.reverified' || source.taskId !== p.taskId || source.payload?.accept !== p.verifiedWin
    || (source.modelObserved ?? null) !== p.route.modelObserved || (source.effortObserved ?? null) !== p.route.effortObserved) fail('route observation verification outcome diverged');
  const core = Object.fromEntries(Object.entries(p).filter(([key]) => key !== 'observationDigest'));
  if (p.observationDigest !== canonicalDigest({ ...core, idempotencyKey: event.idempotencyKey })) fail('route observation digest is invalid');
  const prior = store._routeObservations.get(p.taskId); if (prior && prior.observationDigest !== p.observationDigest) fail('task route observation conflicts', 'route_observation_conflict');
  return task;
}

export function _validateReuseDecisionPayload(store, p, event, integrity = false) {
  const fail = (message, code) => {
    throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code);
  };
  const topFields = new Set(['schemaVersion', 'id', 'requestDigest', 'decisionDigest', 'decisionArtifactDigest', 'subjectDigest', 'envRef', 'indexEpoch', 'need', 'choice', 'rationale', 'coordinate', 'actor', 'dossierDigest', 'sbomDigest', 'evidenceProjectionDigest', 'supersedes', 'dossierRef', 'sbomRef', 'dossierSnapshot', 'sbomSnapshot', 'reverifyEvidence', 'artifacts', 'affectedReadEvents']);
  if (!p || Object.keys(p).some((key) => !topFields.has(key)) || p.schemaVersion !== 1 || !validEnvRef(p.envRef)
    || Object.keys(p.envRef).sort().join(',') !== ['indexEpoch', 'lockfileDigest', 'overlayDigest', 'repoId', 'treeSha'].sort().join(',')) fail('reuse decision environment is invalid', 'invalid_reuse_decision');
  // Decision 2 (blocker 6): the registry's decision.need / decision.rationale rows are the
  // declared defaults AND the ceiling-of-ceilings. Oversize draws the coaching refusal on the
  // LIVE admission path; replay (integrity=true) never re-validates sizes (Decision 5).
  if (!['borrow', 'build'].includes(p.choice)) fail('reuse decision choice/need/rationale is invalid', 'invalid_reuse_decision');
  const needCap = FRAME_LIMITS['decision.need'].value;
  const rationaleCap = FRAME_LIMITS['decision.rationale'].value;
  if (typeof p.need !== 'string' || p.need.trim().length === 0 || p.need.includes('\0')) fail('reuse decision choice/need/rationale is invalid', 'invalid_reuse_decision');
  if (Buffer.byteLength(p.need) > needCap) {
    if (!integrity) throw coachingRefusal(FRAME_LIMITS['decision.need'], Buffer.byteLength(p.need), needCap);
    fail('reuse decision choice/need/rationale is invalid', 'invalid_reuse_decision');
  }
  if (typeof p.rationale !== 'string' || p.rationale.trim().length === 0 || p.rationale.includes('\0')) fail('reuse decision choice/need/rationale is invalid', 'invalid_reuse_decision');
  if (Buffer.byteLength(p.rationale) > rationaleCap) {
    if (!integrity) throw coachingRefusal(FRAME_LIMITS['decision.rationale'], Buffer.byteLength(p.rationale), rationaleCap);
    fail('reuse decision choice/need/rationale is invalid', 'invalid_reuse_decision');
  }
  if (!Array.isArray(p.affectedReadEvents) || new Set(p.affectedReadEvents).size !== p.affectedReadEvents.length
    || p.affectedReadEvents.some((seq) => !Number.isSafeInteger(seq) || seq < 1 || seq >= event.seq)) fail('reuse affected-reader projection is invalid', 'reuse_decision_integrity');
  const coordinate = p.coordinate;
  if (!coordinate || Object.keys(coordinate).sort().join(',') !== 'ecosystem,package,version' || coordinate.ecosystem !== 'npm' || !boundedText(coordinate.package, 256) || !boundedText(coordinate.version, 256)) fail('reuse decision exact package coordinate is invalid', 'invalid_reuse_coordinate');
  if (store._providerPendingFor(p.envRef.repoId, coordinate).length > 0) fail('exact package coordinate has an unresolved authenticated provider delivery', 'reuse_provider_pending');
  if (!/^[a-f0-9]{64}$/.test(p.indexEpoch ?? '') || !/^[a-f0-9]{64}$/.test(p.requestDigest ?? '') || !/^[a-f0-9]{64}$/.test(p.evidenceProjectionDigest ?? '')
    || !/^[a-f0-9]{64}$/.test(p.subjectDigest ?? '') || !/^[a-f0-9]{64}$/.test(p.decisionDigest ?? '') || !/^[a-f0-9]{64}$/.test(p.decisionArtifactDigest ?? '')
    || p.subjectDigest !== canonicalDigest({ envRef: p.envRef, indexEpoch: p.indexEpoch, need: p.need, coordinate, policyHash: p.dossierSnapshot?.policyHash })) fail('reuse decision subject identity is invalid', 'reuse_decision_integrity');
  if (p.id !== `reuse-decision:${p.decisionDigest}` || p.actor !== event.actor) fail('reuse decision actor/identity is invalid', 'reuse_decision_integrity');
  const expectedDecision = {
    envRef: p.envRef, indexEpoch: p.indexEpoch, need: p.need, choice: p.choice, rationale: p.rationale, coordinate,
    actor: p.actor, dossierDigest: p.dossierRef?.digest, sbomDigest: p.sbomRef?.digest,
    subjectDigest: p.subjectDigest, evidenceProjectionDigest: p.evidenceProjectionDigest, supersedes: p.supersedes ?? null,
  };
  if (p.decisionDigest !== canonicalDigest(expectedDecision)) fail('reuse decision digest is invalid', 'reuse_decision_integrity');
  const refs = [[p.dossierRef, 'dependency-dossier', 'application/vnd.baton.dependency-dossier+json'], [p.sbomRef, 'lockfile-sbom', 'application/vnd.cyclonedx+json']];
  for (const [ref, kind, mediaType] of refs) {
    if (ref?.kind !== kind || ref?.mediaType !== mediaType || !/^[a-f0-9]{64}$/.test(ref?.digest ?? '')
      || ref.handle !== `art:sha256:${ref.digest}` || !Number.isSafeInteger(ref.bytes) || ref.bytes <= 0) fail('reuse decision artifact reference is invalid', 'reuse_evidence_invalid');
  }
  if (p.dossierDigest !== p.dossierRef.digest || p.sbomDigest !== p.sbomRef.digest) fail('reuse evidence digest aliases are invalid', 'reuse_decision_integrity');
  const dossier = p.dossierSnapshot;
  if (!dossier || !/^[a-f0-9]{64}$/.test(dossier.factDigest ?? '') || !/^[a-f0-9]{64}$/.test(dossier.policyHash ?? '') || dossier.identity?.ecosystem !== coordinate.ecosystem
    || dossier.identity?.package !== coordinate.package || dossier.identity?.version !== coordinate.version
    || dossier.indexEpoch !== p.indexEpoch || !['borrow_candidate', 'block', 'blocked_pending_vet'].includes(dossier.recommendation)) fail('reuse dossier projection is invalid', 'reuse_evidence_invalid');
  if (!/^[a-f0-9]{64}$/.test(dossier.overlayDigest ?? '') || p.envRef.indexEpoch !== p.indexEpoch
    || p.envRef.overlayDigest !== dossier.overlayDigest) fail('reuse dossier is not bound to the effective tree', 'reuse_environment_mismatch');
  const policyHead = store._reusePolicyHeads.get(p.envRef.repoId);
  if (policyHead && dossier.policyHash !== policyHead.policyHash) fail('reuse dossier policy is not current', 'reuse_policy_reconciliation_required');
  const asOf = Date.parse(dossier.asOf); const expiresAt = Date.parse(dossier.expiresAt); const decisionAt = Date.parse(event.ts);
  if (!Number.isFinite(asOf) || !Number.isFinite(expiresAt) || !Number.isFinite(decisionAt) || asOf > decisionAt || decisionAt >= expiresAt) fail('reuse dossier is stale or temporally incoherent', 'reuse_evidence_stale');
  const riskGuard = store._reuseRiskGuards.get(canonicalDigest(coordinate));
  if (riskGuard?.blocked === true) {
    if (p.choice === 'borrow') fail('exact package coordinate is blocked by a newer advisory observation', 'reuse_risk_guarded');
    if (asOf < Date.parse(riskGuard.asOf) || dossier.factDigest !== riskGuard.factDigest) fail('reuse decision evidence predates the active advisory guard', 'reuse_risk_guarded');
  }
  if (store._reuseProviderGuards.get(store._providerCoordinateKey(p.envRef.repoId, coordinate))?.blocked === true) fail('exact package coordinate is blocked by retained official provider evidence', 'reuse_provider_guarded');
  if (p.choice === 'borrow' && dossier.recommendation !== 'borrow_candidate') fail('blocked dossier cannot authorize borrowing', 'reuse_borrow_blocked');
  const sbom = p.sbomSnapshot;
  if (!sbom || sbom.grounding !== 'actual_lockfile' || !/^[a-f0-9]{64}$/.test(sbom.lockfileDigest ?? '')
    || !Number.isSafeInteger(sbom.componentCount) || sbom.componentCount < 0 || !boundedText(sbom.lockfile, 2_048)) fail('reuse SBOM projection is invalid', 'reuse_evidence_invalid');
  if (p.envRef.lockfileDigest !== sbom.lockfileDigest) fail('reuse SBOM is not bound to the effective tree', 'reuse_environment_mismatch');
  if (p.evidenceProjectionDigest !== canonicalDigest({ dossierRef: p.dossierRef, dossierSnapshot: dossier, sbomRef: p.sbomRef, sbomSnapshot: sbom })) fail('reuse evidence projection digest is invalid', 'reuse_decision_integrity');
  const evidenceSeq = p.reverifyEvidence?.coordinationSeq;
  const mapped = Number.isInteger(evidenceSeq) ? store._events[evidenceSeq - 1] : null;
  if (!mapped || mapped.kind !== 'evidence.mapped' || mapped.seq >= event.seq || mapped.payload?.kind !== 'knowledge.reuse_evidence_reverified') fail('reuse decision reverify evidence is invalid', 'reuse_evidence_invalid');
  const authoritativeEvidence = store._evidence.get(`${mapped.payload.worker}:${mapped.payload.workerSeq}`);
  if (!authoritativeEvidence || canonicalDigest(authoritativeEvidence) !== canonicalDigest(p.reverifyEvidence)) fail('reuse decision mapped evidence projection is invalid', 'reuse_evidence_invalid');
  const source = store._operationalRead?.(mapped.payload.worker, mapped.payload.workerSeq);
  if (!source || source.kind !== 'knowledge.reuse_evidence_reverified' || digest(source) !== mapped.payload.digest
    || source.actor !== event.actor || source.payload?.dossierDigest !== p.dossierRef.digest || source.payload?.sbomDigest !== p.sbomRef.digest
    || source.payload?.dossierFactDigest !== dossier.factDigest || source.payload?.policyHash !== dossier.policyHash
    || source.payload?.recommendation !== dossier.recommendation || source.payload?.evidenceExpiresAt !== dossier.expiresAt
    || source.payload?.indexEpoch !== p.indexEpoch || source.payload?.requestDigest !== p.requestDigest || source.payload?.decisionDigest !== p.decisionDigest
    || source.payload?.evidenceProjectionDigest !== p.evidenceProjectionDigest || source.payload?.decisionArtifactDigest !== p.decisionArtifactDigest
    || source.payload?.lockfileDigest !== sbom.lockfileDigest) fail('reuse reverify evidence does not match decision inputs', 'reuse_evidence_invalid');
  const expectedArtifacts = [
    `capability-evidence:${p.dossierRef.digest}`, `capability-evidence:${p.sbomRef.digest}`, `reuse-decision-artifact:${p.decisionArtifactDigest}`,
  ];
  if (!Array.isArray(p.artifacts) || JSON.stringify(p.artifacts.map((item) => item?.id)) !== JSON.stringify(expectedArtifacts)) fail('reuse artifact manifests are invalid', 'reuse_decision_integrity');
  for (const artifact of p.artifacts) {
    const prior = store._artifacts.get(artifact.id);
    if (prior && store._events[prior.createdEvent - 1]?.kind !== 'knowledge.reuse_decided') fail('reserved reuse artifact identity was preoccupied', 'reuse_namespace_conflict');
    const allowedArtifactFields = new Set(['id', 'owner', 'kind', 'mediaType', 'digest', 'refs', 'accepted', 'provenance', ...(artifact.id === expectedArtifacts[2] ? ['content'] : [])]);
    if (Object.keys(artifact).some((key) => !allowedArtifactFields.has(key))) fail('reuse artifact manifest has unknown fields', 'reuse_decision_integrity');
    if (!artifact.owner || !['capability-evidence', 'decision'].includes(artifact.owner.kind) || artifact.accepted !== true
      || !Array.isArray(artifact.provenance) || artifact.provenance.length === 0) fail('reuse artifact ownership/provenance is invalid', 'reuse_decision_integrity');
    if (prior) {
      const created = store._events[prior.createdEvent - 1];
      const priorManifest = Object.fromEntries(Object.entries(prior).filter(([key]) => !['createdEvent', 'version', 'supersededBy', 'supersededEvent'].includes(key)));
      if (created?.kind !== 'knowledge.reuse_decided' || canonicalDigest(priorManifest) !== canonicalDigest(artifact)) fail('reserved reuse artifact identity was preoccupied', 'reuse_namespace_conflict');
    } else if (canonicalDigest(artifact.provenance) !== canonicalDigest([p.reverifyEvidence])) fail('new reuse artifact lacks exact current reverify provenance', 'reuse_decision_integrity');
  }
  if (p.artifacts[0].kind !== p.dossierRef.kind || p.artifacts[0].mediaType !== p.dossierRef.mediaType || p.artifacts[0].digest !== p.dossierRef.digest
    || canonicalDigest(p.artifacts[0].refs) !== canonicalDigest([p.dossierRef]) || canonicalDigest(p.artifacts[0].owner) !== canonicalDigest({ kind: 'capability-evidence', id: `cartographer-quartermaster:reuse.vet:${p.dossierRef.digest}` })
    || p.artifacts[1].kind !== p.sbomRef.kind || p.artifacts[1].mediaType !== p.sbomRef.mediaType || p.artifacts[1].digest !== p.sbomRef.digest
    || canonicalDigest(p.artifacts[1].refs) !== canonicalDigest([p.sbomRef]) || canonicalDigest(p.artifacts[1].owner) !== canonicalDigest({ kind: 'capability-evidence', id: `cartographer-quartermaster:provenance.sbom:${p.sbomRef.digest}` })
    || p.artifacts[2].kind !== 'reuse-decision' || p.artifacts[2].mediaType !== 'application/vnd.baton.reuse-decision+json'
    || p.artifacts[2].digest !== p.decisionArtifactDigest || canonicalDigest(p.artifacts[2].owner) !== canonicalDigest({ kind: 'decision', id: p.id })
    || canonicalDigest(p.artifacts[2].refs) !== canonicalDigest([{ artifactId: p.artifacts[0].id }, { artifactId: p.artifacts[1].id }])
    || canonicalDigest(p.artifacts[2].content) !== canonicalDigest({ ...expectedDecision, installAuthority: false, mergeAuthority: false, verificationAuthority: false, policyOverride: false })
    || p.decisionArtifactDigest !== canonicalDigest(p.artifacts[2].content)
    || p.artifacts[2].content?.installAuthority !== false || p.artifacts[2].content?.mergeAuthority !== false
    || p.artifacts[2].content?.verificationAuthority !== false || p.artifacts[2].content?.policyOverride !== false) fail('reuse artifact manifests do not match decision evidence', 'reuse_decision_integrity');
  const currentId = store._reuseSubjects.get(p.subjectDigest);
  const supersedes = p.supersedes ?? null;
  if (supersedes && (Object.keys(supersedes).sort().join(',') !== 'decisionId,expectedValidityVersion'
    || typeof supersedes.decisionId !== 'string' || !Number.isSafeInteger(supersedes.expectedValidityVersion) || supersedes.expectedValidityVersion <= 0)) fail('reuse supersession is invalid', 'reuse_decision_integrity');
  if (currentId && !supersedes) fail('reuse subject already has a live decision', 'reuse_decision_exists');
  if (supersedes) {
    const prior = store._reuseDecisions.get(supersedes.decisionId);
    const priorNode = prior ? store._knowledgeNodes.get(prior.nodeId) : null;
    if (!prior || prior.subjectDigest !== p.subjectDigest || currentId !== prior.id || !priorNode
      || priorNode.validityVersion !== supersedes.expectedValidityVersion) fail('reuse decision supersession is stale or mismatched', 'stale_version');
    const affected = priorNode.validTo ? [] : store._knowledgeReads.filter((read) => read.nodeIds.includes(prior.nodeId)).map((read) => read.eventSeq);
    if (JSON.stringify(affected) !== JSON.stringify(p.affectedReadEvents ?? [])) fail('reuse contamination projection is invalid', 'reuse_decision_integrity');
  } else if (p.affectedReadEvents.length > 0) fail('unexpected reuse contamination projection', 'reuse_decision_integrity');
  const reservedNodes = [
    [`artifact:${p.artifacts[0].id}`, 'Artifact'], [`artifact:${p.artifacts[1].id}`, 'Artifact'], [`artifact:${p.artifacts[2].id}`, 'Artifact'],
    [`finding:dependency-dossier:${p.dossierRef.digest}`, 'Finding'], [`finding:lockfile-sbom:${p.sbomRef.digest}`, 'Finding'],
  ];
  for (const [id, type] of reservedNodes) {
    const node = store._knowledgeNodes.get(id); if (!node) continue;
    const created = store._events[node.observedSeq - 1];
    if (created?.kind !== 'knowledge.reuse_decided' || node.type !== type || node.promotion?.trigger !== 'reuse.decision' || node.validTo) fail('reserved reuse knowledge identity was preoccupied or invalid', 'reuse_namespace_conflict');
  }
  if (store._knowledgeNodes.has(`decision:reuse:${p.decisionDigest}`)) fail('reuse Decision identity already exists', 'reuse_namespace_conflict');
  const dossierFinding = `finding:dependency-dossier:${p.dossierRef.digest}`; const sbomFinding = `finding:lockfile-sbom:${p.sbomRef.digest}`;
  for (const [id, from, to] of [
    [`knowledge-edge:derived:${dossierFinding}:${p.artifacts[0].id}`, dossierFinding, `artifact:${p.artifacts[0].id}`],
    [`knowledge-edge:derived:${sbomFinding}:${p.artifacts[1].id}`, sbomFinding, `artifact:${p.artifacts[1].id}`],
  ]) {
    const edge = store._knowledgeEdges.get(id); if (!edge) continue; const created = store._events[edge.observedSeq - 1];
    if (created?.kind !== 'knowledge.reuse_decided' || edge.type !== 'DerivedFrom' || edge.from !== from || edge.to !== to || edge.validTo) fail('reserved reuse knowledge edge was preoccupied or invalid', 'reuse_namespace_conflict');
  }
  const decisionNodeId = `decision:reuse:${p.decisionDigest}`;
  const newEdgeIds = [
    `knowledge-edge:informed:${decisionNodeId}:${dossierFinding}`, `knowledge-edge:informed:${decisionNodeId}:${sbomFinding}`,
    ...(policyHead?.constraintId ? [`knowledge-edge:informed:${decisionNodeId}:${policyHead.constraintId}`] : []),
    `knowledge-edge:producedby:${p.artifacts[2].id}:${decisionNodeId}`,
    ...(p.supersedes ? [`knowledge-edge:supersedes:${p.id}:${p.supersedes.decisionId}`] : []),
  ];
  if (newEdgeIds.some((id) => store._knowledgeEdges.has(id))) fail('reuse decision edge identity already exists', 'reuse_namespace_conflict');
  return { evidenceSeq };
}

export function _validateReusePolicyPayload(store, p, event, integrity = false) {
  const fail = (message, code = 'reuse_policy_integrity') => { throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code); };
  const fields = ['schemaVersion', 'requestDigest', 'transitionDigest', 'repoId', 'expectedPolicyVersion', 'previousPolicyHash', 'policy', 'policyCardDigest', 'effectiveAt', 'ceilings', 'decisionTargets', 'bindingTargets', 'findingTargets', 'guardTargets', 'priorConstraintTarget', 'observedPolicyHashes', 'examinedStateRows', 'derivationOverflow', 'targetSetDigest', 'constraintId'];
  if (!p || Object.keys(p).sort().join(',') !== fields.sort().join(',') || p.schemaVersion !== 1 || !boundedText(p.repoId, 256) || p.effectiveAt !== event.ts
    || !boundedText(event.actor, 256) || typeof event.idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(event.idempotencyKey)
    || !/^[a-f0-9]{64}$/.test(p.requestDigest ?? '') || !/^[a-f0-9]{64}$/.test(p.transitionDigest ?? '') || !/^[a-f0-9]{64}$/.test(p.policyCardDigest ?? '')) fail('reuse policy transition shape is invalid');
  const policy = p.policy; const projectionFields = ['blockDeprecated', 'licenseAllow', 'licenseDeny', 'minScorecard', 'requireProviderVerifiedProvenance', 'ttlMs'];
  if (!policy || Object.keys(policy).sort().join(',') !== ['schemaVersion', 'policyId', 'hash', 'projection'].sort().join(',') || policy.schemaVersion !== 1 || policy.policyId !== 'quartermaster-vet-policy-v1' || !/^[a-f0-9]{64}$/.test(policy.hash ?? '')
    || !policy.projection || Object.keys(policy.projection).sort().join(',') !== projectionFields.sort().join(',') || canonicalDigest(policy.projection) !== policy.hash || canonicalDigest(policy) !== p.policyCardDigest) fail('reuse policy identity is invalid');
  const projection = policy.projection;
  if (!Number.isSafeInteger(projection.ttlMs) || projection.ttlMs <= 0 || !Array.isArray(projection.licenseAllow) || !Array.isArray(projection.licenseDeny) || projection.licenseAllow.length > 256 || projection.licenseDeny.length > 256
    || projection.licenseAllow.some((item) => !boundedText(item, 256)) || projection.licenseDeny.some((item) => !boundedText(item, 256)) || ![true, false].includes(projection.requireProviderVerifiedProvenance) || ![true, false].includes(projection.blockDeprecated)
    || JSON.stringify(projection.licenseAllow) !== JSON.stringify([...new Set(projection.licenseAllow)].sort()) || JSON.stringify(projection.licenseDeny) !== JSON.stringify([...new Set(projection.licenseDeny)].sort()) || projection.licenseAllow.some((item) => projection.licenseDeny.includes(item))
    || (projection.minScorecard !== null && (!Number.isFinite(projection.minScorecard) || projection.minScorecard < 0 || projection.minScorecard > 10))) fail('reuse policy projection is invalid');
  const head = store._reusePolicyHeads.get(p.repoId) ?? null;
  if (p.expectedPolicyVersion !== (head?.version ?? 0) || p.previousPolicyHash !== (head?.policyHash ?? null)) fail('reuse policy version is stale', 'reuse_policy_stale');
  const eventAt = Date.parse(event.ts);
  const priorEventAt = Date.parse(store._events[event.seq - 2]?.ts ?? event.ts);
  if (!Number.isFinite(eventAt) || new Date(eventAt).toISOString() !== event.ts || !Number.isFinite(priorEventAt) || eventAt < priorEventAt || (head && eventAt < Date.parse(head.activatedAt))) fail('reuse policy effective time is invalid');
  const expectedRequestDigest = canonicalDigest({ actor: event.actor, repoId: p.repoId, expectedPolicyVersion: p.expectedPolicyVersion, previousPolicyHash: p.previousPolicyHash, currentPolicyHash: policy.hash, policyCardDigest: p.policyCardDigest, trigger: 'deployment_policy_activation' });
  if (p.requestDigest !== expectedRequestDigest) fail('reuse policy request identity is invalid');
  const ceilings = p.ceilings;
  if (!ceilings || Object.keys(ceilings).sort().join(',') !== ['maxDecisionTargets', 'maxGuardTargets', 'maxAffectedReads', 'maxStateRows', 'maxObservedPolicyHashes', 'maxEventBytes'].sort().join(',')
    || Object.values(ceilings).some((value) => !Number.isSafeInteger(value) || value <= 0) || ceilings.maxDecisionTargets > 100_000 || ceilings.maxGuardTargets > 100_000 || ceilings.maxAffectedReads > 1_000_000 || ceilings.maxStateRows > 10_000_000 || ceilings.maxObservedPolicyHashes > 100_000 || ceilings.maxEventBytes > 64 * 1024 * 1024) fail('reuse policy ceilings are invalid', 'reuse_policy_oversize');
  const expected = store._reusePolicyTargets(p.repoId, policy.hash, ceilings);
  if (canonicalDigest(expected.decisionTargets) !== canonicalDigest(p.decisionTargets) || canonicalDigest(expected.bindingTargets) !== canonicalDigest(p.bindingTargets) || canonicalDigest(expected.findingTargets) !== canonicalDigest(p.findingTargets) || canonicalDigest(expected.guardTargets) !== canonicalDigest(p.guardTargets) || canonicalDigest(expected.priorConstraintTarget) !== canonicalDigest(p.priorConstraintTarget) || canonicalDigest(expected.observedPolicyHashes) !== canonicalDigest(p.observedPolicyHashes) || expected.examinedStateRows !== p.examinedStateRows || expected.derivationOverflow !== p.derivationOverflow) fail('reuse policy target projection is invalid');
  const affectedReads = [...p.decisionTargets, ...p.bindingTargets, ...p.findingTargets, ...(p.priorConstraintTarget ? [p.priorConstraintTarget] : [])].reduce((sum, target) => sum + target.affectedReadEvents.length, 0) + p.guardTargets.reduce((sum, target) => sum + target.affectedRiskFindingReadEvents.length, 0);
  if (p.derivationOverflow || p.examinedStateRows > ceilings.maxStateRows || p.observedPolicyHashes.length > ceilings.maxObservedPolicyHashes || p.decisionTargets.length + p.bindingTargets.length > ceilings.maxDecisionTargets || p.findingTargets.length > ceilings.maxDecisionTargets + ceilings.maxGuardTargets || p.guardTargets.length > ceilings.maxGuardTargets || affectedReads > ceilings.maxAffectedReads) fail('reuse policy target projection exceeded deployment ceiling', 'reuse_policy_oversize');
  for (const target of [...p.decisionTargets, ...p.bindingTargets, ...p.findingTargets, ...(p.priorConstraintTarget ? [p.priorConstraintTarget] : [])]) if (eventAt < Date.parse(store._knowledgeNodes.get(target.nodeId)?.validFrom ?? '')) fail('reuse policy transition predates a target');
  for (const target of p.guardTargets) { const guard = target.guardKind === 'provider' ? store._reuseProviderGuards.get(target.coordinateKey) : store._reuseRiskGuards.get(target.coordinateKey); if (eventAt < Date.parse(guard?.asOf ?? '')) fail('reuse policy transition predates a guard'); }
  const targetSet = { decisionTargets: p.decisionTargets, bindingTargets: p.bindingTargets, findingTargets: p.findingTargets, guardTargets: p.guardTargets, priorConstraintTarget: p.priorConstraintTarget, observedPolicyHashes: p.observedPolicyHashes, examinedStateRows: p.examinedStateRows, derivationOverflow: p.derivationOverflow };
  if (p.targetSetDigest !== canonicalDigest(targetSet)) fail('reuse policy target digest is invalid');
  const version = p.expectedPolicyVersion + 1; const expectedConstraint = `constraint:reuse-policy:${canonicalDigest({ repoId: p.repoId, policyHash: policy.hash, version })}`;
  if (p.constraintId !== expectedConstraint || store._knowledgeNodes.has(expectedConstraint)) fail('reuse policy constraint identity is invalid', 'reuse_namespace_conflict');
  for (const target of [...p.decisionTargets, ...p.findingTargets, ...p.guardTargets.filter((item) => item.riskFindingId).map((item) => ({ nodeId: item.riskFindingId }))]) if (store._knowledgeEdges.has(`knowledge-edge:affects:${expectedConstraint}:${target.nodeId}`)) fail('reuse policy edge identity is preoccupied', 'reuse_namespace_conflict');
  for (const target of p.bindingTargets) if (store._knowledgeEdges.has(`knowledge-edge:informed:${target.nodeId}:${expectedConstraint}`)) fail('reuse policy binding edge identity is preoccupied', 'reuse_namespace_conflict');
  if (p.priorConstraintTarget && store._knowledgeEdges.has(`knowledge-edge:supersedes:${expectedConstraint}:${p.priorConstraintTarget.nodeId}`)) fail('reuse policy lineage edge identity is preoccupied', 'reuse_namespace_conflict');
  const core = Object.fromEntries(Object.entries(p).filter(([key]) => key !== 'transitionDigest'));
  if (p.transitionDigest !== canonicalDigest(core)) fail('reuse policy transition digest is invalid');
  const exactEvent = { schemaVersion: 1, seq: event.seq, ts: event.ts, kind: 'knowledge.reuse_policy_reconciled', actor: event.actor, idempotencyKey: event.idempotencyKey, payload: p };
  if (Buffer.byteLength(`${JSON.stringify(exactEvent)}\n`) > ceilings.maxEventBytes) fail('reuse policy transition exceeded event byte ceiling', 'reuse_policy_oversize');
  return { version, head };
}

export function _guardFromRiskPayload(store, p, event) {
  const seed = store._reuseDecisions.get(p.seedDecisionId); const prior = store._reuseRiskGuards.get(canonicalDigest(p.coordinate));
  return freeze({ coordinate: clone(p.coordinate), repoId: seed.envRef.repoId, blocked: true, dossierDigest: p.dossierRef.digest, factDigest: p.dossierSnapshot.factDigest, policyHash: p.dossierSnapshot.policyHash, recommendation: p.dossierSnapshot.recommendation, asOf: p.dossierSnapshot.asOf, expiresAt: p.dossierSnapshot.expiresAt, advisoryIds: clone(p.advisoryIds), maliciousAdvisoryIds: clone(p.maliciousAdvisoryIds), eventSeq: event.seq, guardDigest: p.guardDigest, supersedesGuardDigest: prior?.guardDigest ?? null, policyValidityVersion: (prior?.policyValidityVersion ?? 0) + 1, policyStale: false, inheritedAdverse: false });
}

export function _validateReuseRiskPayload(store, p, event, integrity = false) {
  const fail = (message, code) => { throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code); };
  const fields = ['schemaVersion', 'requestDigest', 'guardDigest', 'seedDecisionId', 'seedExpectedValidityVersion', 'coordinate', 'dossierRef', 'dossierSnapshot', 'advisoryIds', 'maliciousAdvisoryIds', 'reverifyEvidence', 'adverse', 'effectiveAt', 'targets', 'targetSetDigest'];
  if (!p || Object.keys(p).sort().join(',') !== fields.sort().join(',') || p.schemaVersion !== 1
    || !/^[a-f0-9]{64}$/.test(p.requestDigest ?? '') || !/^[a-f0-9]{64}$/.test(p.guardDigest ?? '')) fail('reuse risk review shape is invalid', 'reuse_risk_integrity');
  const seed = store._reuseDecisions.get(p.seedDecisionId); const seedNode = seed ? store._knowledgeNodes.get(seed.nodeId) : null;
  if (!seed || !seedNode || seed.envRef.repoId.length === 0 || canonicalDigest(seed.coordinate) !== canonicalDigest(p.coordinate)
    || !Number.isSafeInteger(p.seedExpectedValidityVersion) || p.seedExpectedValidityVersion <= 0
    || p.seedExpectedValidityVersion > seedNode.validityVersion) fail('reuse risk seed is stale or mismatched', 'stale_version');
  const expectedRequestDigest = canonicalDigest({ actor: event.actor, repoId: seed.envRef.repoId, decisionId: p.seedDecisionId, expectedValidityVersion: p.seedExpectedValidityVersion, trigger: 'advisory_refresh' });
  if (p.requestDigest !== expectedRequestDigest) fail('reuse risk request identity is invalid', 'reuse_risk_integrity');
  if (p.dossierRef?.kind !== 'dependency-dossier' || p.dossierRef?.mediaType !== 'application/vnd.baton.dependency-dossier+json'
    || !/^[a-f0-9]{64}$/.test(p.dossierRef?.digest ?? '') || p.dossierRef.handle !== `art:sha256:${p.dossierRef.digest}`
    || !Number.isSafeInteger(p.dossierRef.bytes) || p.dossierRef.bytes <= 0) fail('reuse risk dossier reference is invalid', 'reuse_evidence_invalid');
  const snapshot = p.dossierSnapshot;
  const policyHead = store._reusePolicyHeads.get(seed.envRef.repoId);
  if (!snapshot || snapshot.identity?.ecosystem !== p.coordinate.ecosystem || snapshot.identity?.package !== p.coordinate.package
    || snapshot.identity?.version !== p.coordinate.version || snapshot.indexEpoch !== seed.indexEpoch
    || snapshot.overlayDigest !== seed.envRef.overlayDigest || snapshot.policyHash !== (policyHead?.policyHash ?? seed.dossierSnapshot.policyHash)
    || !/^[a-f0-9]{64}$/.test(snapshot.factDigest ?? '') || !['borrow_candidate', 'block', 'blocked_pending_vet'].includes(snapshot.recommendation)) fail('reuse risk dossier projection is invalid', 'reuse_evidence_invalid');
  const asOf = Date.parse(snapshot.asOf); const expiresAt = Date.parse(snapshot.expiresAt); const eventAt = Date.parse(event.ts);
  if (!Number.isFinite(asOf) || !Number.isFinite(expiresAt) || !Number.isFinite(eventAt) || asOf > eventAt || eventAt >= expiresAt
    || asOf <= Date.parse(seed.dossierSnapshot.asOf)) fail('reuse risk observation is not a newer live refresh', 'reuse_evidence_stale');
  const adverse = snapshot.recommendation !== 'borrow_candidate';
  if (p.adverse !== adverse || p.effectiveAt !== snapshot.asOf || !Array.isArray(p.advisoryIds) || !Array.isArray(p.maliciousAdvisoryIds)
    || p.advisoryIds.some((id) => !boundedText(id, 256)) || p.maliciousAdvisoryIds.some((id) => !p.advisoryIds.includes(id))) fail('reuse risk verdict projection is invalid', 'reuse_risk_integrity');
  const activeGuard = store._reuseRiskGuards.get(canonicalDigest(p.coordinate));
  if (activeGuard && asOf <= Date.parse(activeGuard.asOf)) fail('reuse risk observation is older than the active guard', 'reuse_risk_stale');
  const evidenceSeq = p.reverifyEvidence?.coordinationSeq; const mapped = Number.isInteger(evidenceSeq) ? store._events[evidenceSeq - 1] : null;
  const source = mapped ? store._operationalRead?.(mapped.payload?.worker, mapped.payload?.workerSeq) : null;
  const authoritativeEvidence = mapped ? store._evidence.get(`${mapped.payload.worker}:${mapped.payload.workerSeq}`) : null;
  if (!mapped || mapped.kind !== 'evidence.mapped' || mapped.seq >= event.seq || mapped.payload?.kind !== 'knowledge.reuse_risk_reverified'
    || !authoritativeEvidence || canonicalDigest(authoritativeEvidence) !== canonicalDigest(p.reverifyEvidence)
    || !source || source.kind !== 'knowledge.reuse_risk_reverified' || digest(source) !== mapped.payload.digest || source.actor !== event.actor
    || source.payload?.requestDigest !== p.requestDigest || source.payload?.seedDecisionId !== p.seedDecisionId
    || source.payload?.expectedValidityVersion !== p.seedExpectedValidityVersion
    || source.payload?.dossierDigest !== p.dossierRef.digest || source.payload?.factDigest !== snapshot.factDigest
    || source.payload?.policyHash !== snapshot.policyHash
    || source.payload?.recommendation !== snapshot.recommendation || source.payload?.asOf !== snapshot.asOf
    || source.payload?.expiresAt !== snapshot.expiresAt
    || canonicalDigest(source.payload?.advisoryIds) !== canonicalDigest(p.advisoryIds)
    || canonicalDigest(source.payload?.maliciousAdvisoryIds) !== canonicalDigest(p.maliciousAdvisoryIds)
    || source.payload?.riskProjectionDigest !== canonicalDigest({ coordinate: p.coordinate, dossierRef: p.dossierRef, dossierSnapshot: snapshot, advisoryIds: p.advisoryIds, maliciousAdvisoryIds: p.maliciousAdvisoryIds, adverse })) fail('reuse risk mapped evidence is invalid', 'reuse_evidence_invalid');
  const expectedTargets = adverse ? store._reuseRiskTargets(p.coordinate, snapshot) : [];
  if (canonicalDigest(expectedTargets) !== canonicalDigest(p.targets) || p.targetSetDigest !== canonicalDigest(p.targets)) fail('reuse risk target projection is invalid', 'reuse_risk_integrity');
  const core = { requestDigest: p.requestDigest, seedDecisionId: p.seedDecisionId, seedExpectedValidityVersion: p.seedExpectedValidityVersion, coordinate: p.coordinate, dossierRef: p.dossierRef, dossierSnapshot: snapshot, advisoryIds: p.advisoryIds, maliciousAdvisoryIds: p.maliciousAdvisoryIds, reverifyEvidence: p.reverifyEvidence, adverse, effectiveAt: p.effectiveAt, targetSetDigest: p.targetSetDigest };
  if (p.guardDigest !== canonicalDigest(core)) fail('reuse risk digest is invalid', 'reuse_risk_integrity');
  const inheritedMigration = !adverse && activeGuard?.blocked === true && activeGuard.policyStale === true;
  let inheritedSourceFindingId = null; let predecessorFindingId = null;
  if (adverse || inheritedMigration) {
    const findingId = `finding:reuse-risk:${p.guardDigest}`;
    if (store._knowledgeNodes.has(findingId) || p.targets.some((target) => store._knowledgeEdges.has(`knowledge-edge:affects:${findingId}:${target.nodeId}`))) fail('reuse risk graph identity is preoccupied', 'reuse_namespace_conflict');
    if (inheritedMigration) {
      inheritedSourceFindingId = `finding:reuse-risk:${activeGuard.inheritedFromGuardDigest ?? activeGuard.guardDigest}`;
      if (!store._knowledgeNodes.has(inheritedSourceFindingId) || store._knowledgeEdges.has(`knowledge-edge:derived:${findingId}:${inheritedSourceFindingId}`)) fail('inherited adverse source is absent or preoccupied', 'reuse_namespace_conflict');
    }
    if (adverse && activeGuard) {
      predecessorFindingId = `finding:reuse-risk:${activeGuard.guardDigest}`;
      if (!store._knowledgeNodes.has(predecessorFindingId) || store._knowledgeEdges.has(`knowledge-edge:derived:${findingId}:${predecessorFindingId}`)) fail('adverse predecessor source is absent or preoccupied', 'reuse_namespace_conflict');
    }
  }
  return { adverse, inheritedMigration, inheritedSourceFindingId, predecessorFindingId };
}

export function _validateReuseTtlPayload(store, p, event, integrity = false) {
  const fail = (message, code) => { throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code); };
  const fields = ['schemaVersion', 'requestDigest', 'invalidationDigest', 'decisionId', 'expectedValidityVersion', 'effectiveAt', 'actor', 'repoId', 'trigger', 'target'];
  if (!p || Object.keys(p).sort().join(',') !== fields.sort().join(',') || p.schemaVersion !== 1
    || !/^[a-f0-9]{64}$/.test(p.requestDigest ?? '') || !/^[a-f0-9]{64}$/.test(p.invalidationDigest ?? '')) fail('reuse TTL invalidation shape is invalid', 'reuse_ttl_integrity');
  const decision = store._reuseDecisions.get(p.decisionId); const node = decision ? store._knowledgeNodes.get(decision.nodeId) : null;
  if (!decision || !node) fail('reuse TTL target was not found', 'reuse_decision_not_found');
  if (p.actor !== event.actor || p.repoId !== decision.envRef.repoId || p.trigger !== 'ttl_expired'
    || !Number.isSafeInteger(p.expectedValidityVersion) || p.expectedValidityVersion <= 0) fail('reuse TTL authority projection is invalid', 'reuse_ttl_integrity');
  const expectedRequestDigest = canonicalDigest({ actor: p.actor, repoId: p.repoId, decisionId: p.decisionId, expectedValidityVersion: p.expectedValidityVersion, trigger: p.trigger });
  if (p.requestDigest !== expectedRequestDigest) fail('reuse TTL request identity is invalid', 'reuse_ttl_integrity');
  if (store._reuseSubjects.get(decision.subjectDigest) !== decision.id || node.validTo || node.validityVersion !== p.expectedValidityVersion) fail('reuse TTL target is stale', 'stale_version');
  const eventAt = Date.parse(event.ts); const expiry = Date.parse(p.effectiveAt);
  if (p.effectiveAt !== decision.dossierSnapshot.expiresAt || !Number.isFinite(eventAt) || !Number.isFinite(expiry) || eventAt < expiry) fail('reuse TTL target is not expired', 'reuse_not_expired');
  const expectedTarget = store._ttlTarget(decision);
  if (canonicalDigest(expectedTarget) !== canonicalDigest(p.target)) fail('reuse TTL target projection is invalid', 'reuse_ttl_integrity');
  const core = { requestDigest: p.requestDigest, decisionId: p.decisionId, expectedValidityVersion: p.expectedValidityVersion, effectiveAt: p.effectiveAt, actor: p.actor, repoId: p.repoId, trigger: p.trigger, target: p.target };
  if (p.invalidationDigest !== canonicalDigest(core)) fail('reuse TTL invalidation digest is invalid', 'reuse_ttl_integrity');
}

export function _validateProviderDeliveryPayload(store, p, event, integrity = false) {
  const fail = (message, code) => { throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code); };
  if (!p || Object.keys(p).sort().join(',') !== ['contentIdentity', 'processingId', 'receipt', 'receiptDigest', 'receiptId', 'repoId', 'schemaVersion'].sort().join(',') || p.schemaVersion !== 1
    || !boundedText(p.repoId, 256) || !/^provider:[A-Za-z0-9._:-]{1,128}$/.test(event.actor ?? '')) fail('provider delivery authority is invalid', 'provider_delivery_integrity');
  const receipt = p.receipt; const fields = ['schemaVersion', 'providerId', 'sourceEpoch', 'cardDigest', 'mode', 'deliveryId', 'rawDigest', 'rawBytes', 'authReceiptDigest', 'keyFingerprint', 'occurredAt', 'receivedAt', 'sequence', 'coordinates', 'advisoryIds', 'verificationDigest'];
  if (!receipt || Object.keys(receipt).sort().join(',') !== fields.sort().join(',') || receipt.schemaVersion !== 1 || event.actor !== `provider:${receipt.providerId}`
    || !boundedText(receipt.providerId, 128) || !boundedText(receipt.deliveryId, 4_096) || !/^[a-f0-9]{64}$/.test(receipt.sourceEpoch ?? '') || receipt.sourceEpoch !== receipt.cardDigest
    || !/^[a-f0-9]{64}$/.test(receipt.rawDigest ?? '') || !/^[a-f0-9]{64}$/.test(receipt.authReceiptDigest ?? '') || !/^[a-f0-9]{64}$/.test(receipt.keyFingerprint ?? '')
    || !/^[a-f0-9]{64}$/.test(receipt.verificationDigest ?? '') || receipt.receivedAt !== event.ts || !Number.isFinite(Date.parse(receipt.occurredAt)) || new Date(Date.parse(receipt.occurredAt)).toISOString() !== receipt.occurredAt
    || (receipt.sequence !== null && (!Number.isSafeInteger(receipt.sequence) || receipt.sequence < 0))) fail('provider delivery receipt is invalid', 'provider_delivery_integrity');
  const configured = store._advisoryFeedCards.get(receipt.providerId);
  if (!configured) fail('provider source card is required for replay', 'provider_card_required');
  const card = configured.card;
  if (configured.cardDigest !== receipt.cardDigest || !card.modes?.includes(receipt.mode) || !card.auth?.keyFingerprints?.includes(receipt.keyFingerprint)
    || !Number.isSafeInteger(receipt.rawBytes) || receipt.rawBytes <= 0 || receipt.rawBytes > card.ceilings?.maxDeliveryBytes) fail('provider delivery is not bound to its source card', 'provider_card_mismatch');
  if (integrity && store._loading === true && ['hmac-sha256', 'ed25519'].includes(card.auth?.scheme)) {
    if (typeof store._advisoryReceiptReverify !== 'function') fail('native provider receipt requires private CAS replay before readiness', 'provider_cas_replay_required');
    const replayReceipt = { schemaVersion: 1, providerId: receipt.providerId, sourceEpoch: receipt.sourceEpoch, cardDigest: receipt.cardDigest, mode: receipt.mode, deliveryId: receipt.deliveryId, rawDigest: receipt.rawDigest, rawBytes: receipt.rawBytes, authReceiptDigest: receipt.authReceiptDigest, keyFingerprint: receipt.keyFingerprint, occurredAt: receipt.occurredAt, sequence: receipt.sequence, coordinates: clone(receipt.coordinates), advisoryIds: clone(receipt.advisoryIds), source: { handle: `art:sha256:${receipt.rawDigest}`, digest: receipt.rawDigest, bytes: receipt.rawBytes, mediaType: 'application/json' }, contentDigest: receipt.verificationDigest };
    let reverified; try { reverified = store._advisoryReceiptReverify(replayReceipt); } catch (error) { throw integrity ? new CoordinationIntegrityError('native provider receipt private CAS replay failed', error?.code ?? 'provider_cas_invalid') : error; }
    if (reverified && typeof reverified.then === 'function') fail('native provider receipt replay must be synchronous', 'provider_cas_replay_required');
    if (canonicalDigest(reverified) !== canonicalDigest(replayReceipt)) fail('native provider receipt private CAS replay diverged', 'provider_cas_invalid');
  }
  const coordinateKey = (coordinate) => `${coordinate?.ecosystem}\0${coordinate?.package}\0${coordinate?.version}`;
  const sortedCoordinates = Array.isArray(receipt.coordinates) && JSON.stringify(receipt.coordinates.map(coordinateKey)) === JSON.stringify([...new Set(receipt.coordinates.map(coordinateKey))].sort());
  if (!sortedCoordinates || receipt.coordinates.length === 0 || receipt.coordinates.length > card.ceilings.maxCoordinates || receipt.coordinates.some((coordinate) => !coordinate || Object.keys(coordinate).sort().join(',') !== 'ecosystem,package,version'
    || coordinate.ecosystem !== card.ecosystem || !boundedText(coordinate.package, 256) || !boundedText(coordinate.version, 256))) fail('provider delivery coordinates are invalid', 'provider_delivery_integrity');
  if (!Array.isArray(receipt.advisoryIds) || receipt.advisoryIds.length > card.ceilings.maxAdvisoryIds || JSON.stringify(receipt.advisoryIds) !== JSON.stringify([...new Set(receipt.advisoryIds)].sort())
    || receipt.advisoryIds.some((id) => !boundedText(id, card.ceilings.maxIdentityBytes))) fail('provider advisory identities are invalid', 'provider_delivery_integrity');
  const expectedIdentity = canonicalDigest({ repoId: p.repoId, providerId: receipt.providerId, sourceEpoch: receipt.sourceEpoch, coordinates: receipt.coordinates, advisoryIds: receipt.advisoryIds });
  const expectedProcessingId = `provider-processing:${expectedIdentity}`; const expectedReceiptId = `provider-receipt:${canonicalDigest({ repoId: p.repoId, providerId: receipt.providerId, sourceEpoch: receipt.sourceEpoch, deliveryId: receipt.deliveryId, rawDigest: receipt.rawDigest })}`;
  if (p.contentIdentity !== expectedIdentity || p.processingId !== expectedProcessingId || p.receiptId !== expectedReceiptId || p.receiptDigest !== canonicalDigest({ repoId: p.repoId, receipt })) fail('provider delivery identities are invalid', 'provider_delivery_integrity');
  const deliveryKey = canonicalDigest({ repoId: p.repoId, providerId: receipt.providerId, sourceEpoch: receipt.sourceEpoch, deliveryId: receipt.deliveryId });
  const priorId = store._providerDeliveryIds.get(deliveryKey);
  if (priorId) fail('provider delivery identity already exists in the ledger', 'provider_delivery_duplicate');
  const sourceKey = store._providerSourceKey(p.repoId, receipt.providerId, receipt.sourceEpoch); const priorSequence = receipt.sequence === null ? null : store._providerSequences.get(sourceKey)?.get(receipt.sequence);
  if (priorSequence && priorSequence.rawDigest !== receipt.rawDigest) fail('provider sequence was rebound to different authenticated bytes', 'provider_sequence_conflict');
  return { deliveryKey, sourceKey };
}

export function _validateProviderReconciliationPayload(store, p, event, integrity = false) {
  const fail = (message, code = 'provider_reconciliation_integrity') => { throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code); };
  const fields = ['schemaVersion', 'requestDigest', 'completionDigest', 'repoId', 'providerId', 'sourceEpoch', 'expectedHealthEvent', 'proof', 'receiptIds', 'sequenceRows', 'completedAt'];
  if (!p || Object.keys(p).sort().join(',') !== fields.sort().join(',') || p.schemaVersion !== 1 || !boundedText(p.repoId, 256) || !boundedText(p.providerId, 128) || !/^[a-f0-9]{64}$/.test(p.sourceEpoch ?? '') || !/^[a-f0-9]{64}$/.test(p.requestDigest ?? '') || !/^[a-f0-9]{64}$/.test(p.completionDigest ?? '') || p.completedAt !== event.ts || event.actor !== `provider-poller:${p.providerId}`) fail('provider reconciliation authority is invalid');
  const configured = store._advisoryFeedCards.get(p.providerId); if (!configured || configured.cardDigest !== p.sourceEpoch || !configured.card.modes?.includes('poll')) fail('provider poll card is unavailable', 'provider_card_mismatch');
  const proof = p.proof; const proofFields = ['schemaVersion', 'providerId', 'sourceEpoch', 'cardDigest', 'pollId', 'observedAt', 'window', 'finalSequence', 'cursorDigest', 'authReceiptDigest', 'keyFingerprint', 'pageDigests', 'itemDigests', 'totalBytes', 'receiptRawDigests', 'proofDigest'];
  if (!proof || Object.keys(proof).sort().join(',') !== proofFields.sort().join(',') || proof.schemaVersion !== 1 || proof.providerId !== p.providerId || proof.sourceEpoch !== p.sourceEpoch || proof.cardDigest !== p.sourceEpoch || !boundedText(proof.pollId, configured.card.ceilings.maxIdentityBytes)
    || !Number.isFinite(Date.parse(proof.observedAt)) || new Date(Date.parse(proof.observedAt)).toISOString() !== proof.observedAt || Date.parse(proof.observedAt) > Date.parse(event.ts) || !proof.window || Object.keys(proof.window).sort().join(',') !== 'fromSequence,toSequence'
    || !Number.isSafeInteger(proof.window.fromSequence) || !Number.isSafeInteger(proof.window.toSequence) || proof.window.fromSequence < configured.card.poll.initialSequence || proof.window.toSequence < proof.window.fromSequence || proof.finalSequence !== proof.window.toSequence
    || !/^[a-f0-9]{64}$/.test(proof.cursorDigest ?? '') || !/^[a-f0-9]{64}$/.test(proof.authReceiptDigest ?? '') || !configured.card.auth.keyFingerprints.includes(proof.keyFingerprint) || !/^[a-f0-9]{64}$/.test(proof.proofDigest ?? '')) fail('provider poll proof is invalid');
  const proofCore = Object.fromEntries(Object.entries(proof).filter(([key]) => key !== 'proofDigest')); if (proof.proofDigest !== canonicalDigest(proofCore)) fail('provider poll proof digest is invalid');
  if (typeof store._advisoryPollReverify !== 'function') fail('provider poll replay authority is required', 'provider_poll_replay_required');
  let reverified; try { reverified = store._advisoryPollReverify(clone(proof)); } catch (error) { fail('provider poll replay failed', error?.code ?? 'provider_poll_replay_invalid'); }
  if (reverified && typeof reverified.then === 'function') fail('provider poll replay must be synchronous', 'provider_poll_replay_required');
  if (canonicalDigest(reverified) !== canonicalDigest(proof)) fail('provider poll replay diverged', 'provider_poll_replay_invalid');
  const sourceKey = store._providerSourceKey(p.repoId, p.providerId, p.sourceEpoch); const health = store._providerSourceHealth.get(sourceKey);
  if (!health || health.status !== 'reconciliation_required' || health.lastEvent !== p.expectedHealthEvent || proof.finalSequence < health.highSequence || proof.window.fromSequence > (health.firstGap?.from ?? health.highSequence)) fail('provider source health changed before reconciliation', 'provider_reconciliation_stale');
  const degradedEvent = store._events[p.expectedHealthEvent - 1];
  const observedAt = Date.parse(proof.observedAt); const completedAt = Date.parse(event.ts); const degradedAt = Date.parse(degradedEvent?.ts);
  if (!degradedEvent || degradedEvent.seq !== p.expectedHealthEvent || observedAt + configured.card.poll.maxClockSkewMs < degradedAt || observedAt + configured.card.poll.maxWallMs + configured.card.poll.maxClockSkewMs < completedAt) fail('provider poll is not fresh for degraded source health', 'provider_reconciliation_stale');
  const sequenceMap = store._providerSequences.get(sourceKey) ?? new Map(); const expectedRows = []; const expectedReceipts = [];
  for (let sequence = proof.window.fromSequence; sequence <= proof.window.toSequence; sequence += 1) { const row = sequenceMap.get(sequence); const receipt = row ? store._providerReceipts.get(row.receiptId) : null; if (!row || !receipt || receipt.providerId !== p.providerId || receipt.sourceEpoch !== p.sourceEpoch) fail('provider poll sequence window is incomplete', 'provider_reconciliation_incomplete'); expectedRows.push(clone(row)); expectedReceipts.push(receipt); }
  if (canonicalDigest(p.sequenceRows) !== canonicalDigest(expectedRows) || JSON.stringify(p.receiptIds) !== JSON.stringify(expectedReceipts.map((row) => row.id)) || JSON.stringify(proof.receiptRawDigests) !== JSON.stringify(expectedReceipts.map((row) => row.rawDigest))) fail('provider poll receipt projection is incomplete', 'provider_reconciliation_incomplete');
  const expectedRequestDigest = canonicalDigest({ actor: event.actor, repoId: p.repoId, providerId: p.providerId, sourceEpoch: p.sourceEpoch, expectedHealthEvent: p.expectedHealthEvent, proofDigest: proof.proofDigest, trigger: 'provider_full_poll_reconciliation' }); if (p.requestDigest !== expectedRequestDigest) fail('provider reconciliation request identity is invalid');
  const core = Object.fromEntries(Object.entries(p).filter(([key]) => key !== 'completionDigest')); if (p.completionDigest !== canonicalDigest(core)) fail('provider reconciliation completion digest is invalid');
  return { sourceKey, health };
}

export function _validateProviderDeferralPayload(store, p, event, integrity = false) {
  const fail = (message, code = 'provider_deferral_integrity') => { throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code); };
  const fields = ['schemaVersion', 'requestDigest', 'deferralDigest', 'policyDigest', 'repoId', 'processingId', 'providerId', 'sourceEpoch', 'expectedProcessingVersion', 'expectedLastReceiptEvent', 'attempt', 'failureCode', 'delayMs', 'nextAttemptAt'];
  if (!p || Object.keys(p).sort().join(',') !== fields.sort().join(',') || p.schemaVersion !== 1 || !store._providerAttemptPolicy || p.policyDigest !== canonicalDigest(store._providerAttemptPolicy)
    || !/^[a-f0-9]{64}$/.test(p.requestDigest ?? '') || !/^[a-f0-9]{64}$/.test(p.deferralDigest ?? '') || !boundedText(p.repoId, 256) || !boundedText(p.processingId, 256) || !boundedText(p.providerId, 128)
    || !/^[a-f0-9]{64}$/.test(p.sourceEpoch ?? '') || !Number.isSafeInteger(p.expectedProcessingVersion) || !Number.isSafeInteger(p.expectedLastReceiptEvent) || !Number.isSafeInteger(p.attempt)
    || !PROVIDER_FAILURE_CODES.has(p.failureCode) || !Number.isSafeInteger(p.delayMs) || !Number.isFinite(Date.parse(p.nextAttemptAt)) || new Date(Date.parse(p.nextAttemptAt)).toISOString() !== p.nextAttemptAt
    || !Number.isFinite(Date.parse(event.ts)) || new Date(Date.parse(event.ts)).toISOString() !== event.ts || !boundedText(event.idempotencyKey, 512) || event.actor !== `provider-reconciler:${p.providerId}`) fail('provider deferral shape is invalid');
  const processing = store._providerProcessing.get(p.processingId); if (!processing || processing.status !== 'pending' || processing.repoId !== p.repoId || processing.providerId !== p.providerId || processing.sourceEpoch !== p.sourceEpoch || processing.version !== p.expectedProcessingVersion || processing.lastReceiptEvent !== p.expectedLastReceiptEvent) fail('provider deferral target is stale', 'provider_processing_stale');
  if (processing.nextAttemptAt && Date.parse(event.ts) < Date.parse(processing.nextAttemptAt)) fail('provider deferral was recorded before it became due', 'provider_processing_not_due');
  const expectedAttempt = (processing.attemptCount ?? 0) + 1; const windowAttempt = expectedAttempt - (processing.attemptWindowStart ?? 0); const expectedDelay = providerAttemptDelay(store._providerAttemptPolicy, windowAttempt);
  if (p.attempt !== expectedAttempt || windowAttempt > store._providerAttemptPolicy.maxAttempts || p.delayMs !== expectedDelay || p.nextAttemptAt !== new Date(Date.parse(event.ts) + expectedDelay).toISOString()) fail('provider deferral policy derivation is invalid');
  const requestCore = { actor: event.actor, idempotencyKey: event.idempotencyKey, repoId: p.repoId, processingId: p.processingId, providerId: p.providerId, sourceEpoch: p.sourceEpoch, expectedProcessingVersion: p.expectedProcessingVersion, expectedLastReceiptEvent: p.expectedLastReceiptEvent, attempt: p.attempt, failureCode: p.failureCode, policyDigest: p.policyDigest };
  if (p.requestDigest !== canonicalDigest(requestCore)) fail('provider deferral request identity is invalid'); const core = Object.fromEntries(Object.entries(p).filter(([key]) => key !== 'deferralDigest')); if (p.deferralDigest !== canonicalDigest(core)) fail('provider deferral digest is invalid');
  return processing;
}

export function _validateProviderGreenPayload(store, p, event, integrity = false) {
  const fail = (message, code) => { throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code); };
  const fields = ['schemaVersion', 'requestDigest', 'completionDigest', 'processingId', 'expectedProcessingVersion', 'repoId', 'providerId', 'sourceEpoch', 'receiptIds', 'policy', 'indexBinding', 'observations', 'result'];
  if (!p || Object.keys(p).sort().join(',') !== fields.sort().join(',') || p.schemaVersion !== 1 || p.result !== 'ignored_non_adverse' || !/^[a-f0-9]{64}$/.test(p.requestDigest ?? '') || !/^[a-f0-9]{64}$/.test(p.completionDigest ?? '')) fail('provider green completion shape is invalid', 'provider_processing_integrity');
  const processing = store._providerProcessing.get(p.processingId);
  if (!processing || processing.status !== 'pending' || processing.version !== p.expectedProcessingVersion || processing.repoId !== p.repoId || processing.providerId !== p.providerId || processing.sourceEpoch !== p.sourceEpoch
    || JSON.stringify(processing.receiptIds) !== JSON.stringify(p.receiptIds)) fail('provider green completion target is stale or mismatched', 'provider_processing_stale');
  if (event.actor !== `provider-reconciler:${p.providerId}`) fail('provider reconciler actor is invalid', 'provider_processing_integrity');
  const head = store._reusePolicyHeads.get(p.repoId); const policyFields = ['hash', 'version', 'constraintId'];
  if (!head || !p.policy || Object.keys(p.policy).sort().join(',') !== policyFields.sort().join(',') || p.policy.hash !== head.policyHash || p.policy.version !== head.version || p.policy.constraintId !== head.constraintId) fail('provider processing policy changed', 'reuse_policy_reconciliation_required');
  const bindingFields = ['schemaVersion', 'repoId', 'treeSha', 'indexEpoch', 'atlasCardDigest', 'bindingDigest'];
  if (!p.indexBinding || Object.keys(p.indexBinding).sort().join(',') !== bindingFields.sort().join(',') || p.indexBinding.schemaVersion !== 1 || p.indexBinding.repoId !== p.repoId || !/^[a-f0-9]{4,128}$/.test(p.indexBinding.treeSha ?? '')
    || !/^[a-f0-9]{64}$/.test(p.indexBinding.indexEpoch ?? '') || !/^[a-f0-9]{64}$/.test(p.indexBinding.atlasCardDigest ?? '') || p.indexBinding.bindingDigest !== canonicalDigest(Object.fromEntries(Object.entries(p.indexBinding).filter(([key]) => key !== 'bindingDigest')))) fail('provider index binding is invalid', 'provider_index_changed');
  if (!Array.isArray(p.observations) || p.observations.length !== processing.coordinates.length || JSON.stringify(p.observations.map((row) => row.coordinate)) !== JSON.stringify(processing.coordinates)) fail('provider green coordinate set is incomplete', 'provider_processing_integrity');
  for (const row of p.observations) {
    const rowFields = ['coordinate', 'dossierRef', 'snapshot', 'advisoryIds', 'maliciousAdvisoryIds', 'reverifyEvidence', 'officialDigest'];
    const snapshotFields = ['identity', 'recommendation', 'policyHash', 'policy', 'factDigest', 'asOf', 'expiresAt', 'indexEpoch', 'overlayDigest'];
    if (!row || Object.keys(row).sort().join(',') !== rowFields.sort().join(',') || !row.snapshot || Object.keys(row.snapshot).sort().join(',') !== snapshotFields.sort().join(',') || row.snapshot.recommendation !== 'borrow_candidate' || row.snapshot.policyHash !== p.policy.hash || row.snapshot.indexEpoch !== p.indexBinding.indexEpoch
      || !officialCoordinateMatches(row.snapshot?.identity, row.coordinate) || !/^[a-f0-9]{64}$/.test(row.snapshot?.factDigest ?? '') || !/^[a-f0-9]{64}$/.test(row.officialDigest ?? '')) fail('provider official green observation is invalid', 'provider_processing_integrity');
    if (Object.keys(row.dossierRef ?? {}).sort().join(',') !== ['kind', 'mediaType', 'handle', 'digest', 'bytes'].sort().join(',') || row.dossierRef.kind !== 'dependency-dossier' || row.dossierRef.mediaType !== 'application/vnd.baton.dependency-dossier+json' || row.dossierRef.handle !== `art:sha256:${row.dossierRef.digest}` || !/^[a-f0-9]{64}$/.test(row.dossierRef.digest ?? '') || !Number.isSafeInteger(row.dossierRef.bytes) || row.dossierRef.bytes <= 0) fail('provider official dossier reference is invalid', 'provider_processing_integrity');
    if (!Array.isArray(row.advisoryIds) || JSON.stringify(row.advisoryIds) !== JSON.stringify([...new Set(row.advisoryIds)].sort()) || !Array.isArray(row.maliciousAdvisoryIds) || JSON.stringify(row.maliciousAdvisoryIds) !== JSON.stringify([...new Set(row.maliciousAdvisoryIds)].sort())) fail('provider official advisory identities are invalid', 'provider_processing_integrity');
    const asOf = Date.parse(row.snapshot.asOf); const expires = Date.parse(row.snapshot.expiresAt); const at = Date.parse(event.ts); if (!Number.isFinite(asOf) || !Number.isFinite(expires) || !Number.isFinite(at) || asOf > at || at >= expires) fail('provider official observation is stale or incoherent', 'provider_processing_integrity');
    const evidenceSeq = row.reverifyEvidence?.coordinationSeq; const mapped = Number.isSafeInteger(evidenceSeq) ? store._events[evidenceSeq - 1] : null; const authoritative = mapped ? store._evidence.get(`${mapped.payload?.worker}:${mapped.payload?.workerSeq}`) : null; const source = mapped ? store._operationalRead?.(mapped.payload?.worker, mapped.payload?.workerSeq) : null;
    const projection = { processingId: p.processingId, coordinate: row.coordinate, dossierDigest: row.dossierRef.digest, factDigest: row.snapshot.factDigest, policyHash: p.policy.hash, indexBindingDigest: p.indexBinding.bindingDigest, recommendation: row.snapshot.recommendation, asOf: row.snapshot.asOf, expiresAt: row.snapshot.expiresAt, advisoryIds: row.advisoryIds, maliciousAdvisoryIds: row.maliciousAdvisoryIds };
    if (!mapped || mapped.kind !== 'evidence.mapped' || mapped.seq >= event.seq || mapped.payload?.kind !== 'knowledge.reuse_provider_reverified' || !authoritative || canonicalDigest(authoritative) !== canonicalDigest(row.reverifyEvidence)
      || !source || source.kind !== 'knowledge.reuse_provider_reverified' || digest(source) !== mapped.payload.digest || source.actor !== event.actor || canonicalDigest(source.payload) !== canonicalDigest({ ...projection, officialDigest: canonicalDigest(projection) }) || row.officialDigest !== canonicalDigest(projection)) fail('provider official reverify evidence is invalid', 'provider_processing_integrity');
  }
  const core = Object.fromEntries(Object.entries(p).filter(([key]) => key !== 'completionDigest'));
  if (p.completionDigest !== canonicalDigest(core)) fail('provider green completion digest is invalid', 'provider_processing_integrity');
}

export function _validateProviderAdversePayload(store, p, event, integrity = false) {
  const fail = (message, code = 'provider_processing_integrity') => { throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code); };
  const fields = ['schemaVersion', 'requestDigest', 'completionDigest', 'processingId', 'expectedProcessingVersion', 'repoId', 'providerId', 'sourceEpoch', 'receiptIds', 'policy', 'indexBinding', 'observations', 'result'];
  if (!p || Object.keys(p).sort().join(',') !== fields.sort().join(',') || p.schemaVersion !== 1 || p.result !== 'guarded_adverse' || !/^[a-f0-9]{64}$/.test(p.requestDigest ?? '') || !/^[a-f0-9]{64}$/.test(p.completionDigest ?? '')) fail('provider adverse completion shape is invalid');
  const processing = store._providerProcessing.get(p.processingId);
  if (!processing || processing.status !== 'pending' || processing.version !== p.expectedProcessingVersion || processing.repoId !== p.repoId || processing.providerId !== p.providerId || processing.sourceEpoch !== p.sourceEpoch || JSON.stringify(processing.receiptIds) !== JSON.stringify(p.receiptIds)) fail('provider adverse completion target is stale or mismatched', 'provider_processing_stale');
  if (event.actor !== `provider-reconciler:${p.providerId}`) fail('provider reconciler actor is invalid');
  const head = store._reusePolicyHeads.get(p.repoId); const policyFields = ['hash', 'version', 'constraintId'];
  if (!head || !p.policy || Object.keys(p.policy).sort().join(',') !== policyFields.sort().join(',') || p.policy.hash !== head.policyHash || p.policy.version !== head.version || p.policy.constraintId !== head.constraintId) fail('provider processing policy changed', 'reuse_policy_reconciliation_required');
  const bindingFields = ['schemaVersion', 'repoId', 'treeSha', 'indexEpoch', 'atlasCardDigest', 'bindingDigest'];
  if (!p.indexBinding || Object.keys(p.indexBinding).sort().join(',') !== bindingFields.sort().join(',') || p.indexBinding.schemaVersion !== 1 || p.indexBinding.repoId !== p.repoId || !/^[a-f0-9]{4,128}$/.test(p.indexBinding.treeSha ?? '') || !/^[a-f0-9]{64}$/.test(p.indexBinding.indexEpoch ?? '') || !/^[a-f0-9]{64}$/.test(p.indexBinding.atlasCardDigest ?? '') || p.indexBinding.bindingDigest !== canonicalDigest(Object.fromEntries(Object.entries(p.indexBinding).filter(([key]) => key !== 'bindingDigest')))) fail('provider index binding is invalid', 'provider_index_changed');
  if (!Array.isArray(p.observations) || p.observations.length !== processing.coordinates.length || JSON.stringify(p.observations.map((row) => row.coordinate)) !== JSON.stringify(processing.coordinates) || !p.observations.some((row) => row.adverse === true)) fail('provider adverse coordinate set is incomplete');
  const ceilings = store._providerAdverseCeilings(p.repoId);
  for (const row of p.observations) {
    const rowFields = ['coordinate', 'dossierRef', 'snapshot', 'advisoryIds', 'maliciousAdvisoryIds', 'reverifyEvidence', 'officialDigest', 'adverse', 'contribution', 'aggregate', 'priorAggregateTarget', 'targets', 'targetSetDigest', 'examinedStateRows'];
    const snapshotFields = ['identity', 'recommendation', 'policyHash', 'policy', 'factDigest', 'asOf', 'expiresAt', 'indexEpoch', 'overlayDigest'];
    if (!row || Object.keys(row).sort().join(',') !== rowFields.sort().join(',') || !row.snapshot || Object.keys(row.snapshot).sort().join(',') !== snapshotFields.sort().join(',') || ![true, false].includes(row.adverse) || row.adverse !== (row.snapshot.recommendation !== 'borrow_candidate') || row.snapshot.policyHash !== p.policy.hash || row.snapshot.indexEpoch !== p.indexBinding.indexEpoch || !officialCoordinateMatches(row.snapshot.identity, row.coordinate) || !/^[a-f0-9]{64}$/.test(row.snapshot.factDigest ?? '') || !/^[a-f0-9]{64}$/.test(row.officialDigest ?? '')) fail('provider official observation is invalid');
    if (Object.keys(row.dossierRef ?? {}).sort().join(',') !== ['kind', 'mediaType', 'handle', 'digest', 'bytes'].sort().join(',') || row.dossierRef.kind !== 'dependency-dossier' || row.dossierRef.mediaType !== 'application/vnd.baton.dependency-dossier+json' || row.dossierRef.handle !== `art:sha256:${row.dossierRef.digest}` || !/^[a-f0-9]{64}$/.test(row.dossierRef.digest ?? '') || !Number.isSafeInteger(row.dossierRef.bytes) || row.dossierRef.bytes <= 0) fail('provider official dossier reference is invalid');
    if (!Array.isArray(row.advisoryIds) || JSON.stringify(row.advisoryIds) !== JSON.stringify([...new Set(row.advisoryIds)].sort()) || row.advisoryIds.some((id) => !boundedText(id, 256)) || !Array.isArray(row.maliciousAdvisoryIds) || JSON.stringify(row.maliciousAdvisoryIds) !== JSON.stringify([...new Set(row.maliciousAdvisoryIds)].sort()) || row.maliciousAdvisoryIds.some((id) => !row.advisoryIds.includes(id)) || (row.adverse && row.advisoryIds.length === 0)) fail('provider official advisory identities are invalid');
    const asOf = Date.parse(row.snapshot.asOf); const expires = Date.parse(row.snapshot.expiresAt); const at = Date.parse(event.ts); if (!Number.isFinite(asOf) || !Number.isFinite(expires) || !Number.isFinite(at) || asOf > at || at >= expires) fail('provider official observation is stale or incoherent');
    const evidenceSeq = row.reverifyEvidence?.coordinationSeq; const mapped = Number.isSafeInteger(evidenceSeq) ? store._events[evidenceSeq - 1] : null; const authoritative = mapped ? store._evidence.get(`${mapped.payload?.worker}:${mapped.payload?.workerSeq}`) : null; const source = mapped ? store._operationalRead?.(mapped.payload?.worker, mapped.payload?.workerSeq) : null;
    const projection = { processingId: p.processingId, coordinate: row.coordinate, dossierDigest: row.dossierRef.digest, factDigest: row.snapshot.factDigest, policyHash: p.policy.hash, indexBindingDigest: p.indexBinding.bindingDigest, recommendation: row.snapshot.recommendation, asOf: row.snapshot.asOf, expiresAt: row.snapshot.expiresAt, advisoryIds: row.advisoryIds, maliciousAdvisoryIds: row.maliciousAdvisoryIds };
    if (!mapped || mapped.kind !== 'evidence.mapped' || mapped.seq >= event.seq || mapped.payload?.kind !== 'knowledge.reuse_provider_reverified' || !authoritative || canonicalDigest(authoritative) !== canonicalDigest(row.reverifyEvidence) || !source || source.kind !== 'knowledge.reuse_provider_reverified' || digest(source) !== mapped.payload.digest || source.actor !== event.actor || canonicalDigest(source.payload) !== canonicalDigest({ ...projection, officialDigest: canonicalDigest(projection) }) || row.officialDigest !== canonicalDigest(projection)) fail('provider official reverify evidence is invalid');
    const targetProjection = row.adverse ? store._providerAdverseTargets(p.repoId, row.coordinate, ceilings) : { targets: [], examinedStateRows: 0, affectedReads: 0, derivationOverflow: false };
    const expectedPriorAggregateTarget = row.adverse ? store._providerAggregateTarget(p.repoId, row.coordinate) : null; const aggregateReads = expectedPriorAggregateTarget?.affectedReadEvents.length ?? 0;
    if (targetProjection.derivationOverflow || targetProjection.targets.length > ceilings.maxDecisionTargets || targetProjection.affectedReads + aggregateReads > ceilings.maxAffectedReads || targetProjection.examinedStateRows > ceilings.maxStateRows) fail('provider adverse target projection exceeded deployment ceiling', 'reuse_risk_oversize');
    if (canonicalDigest(row.targets) !== canonicalDigest(targetProjection.targets) || canonicalDigest(row.priorAggregateTarget) !== canonicalDigest(expectedPriorAggregateTarget) || row.examinedStateRows !== targetProjection.examinedStateRows || row.targetSetDigest !== canonicalDigest({ targets: row.targets, priorAggregateTarget: row.priorAggregateTarget, examinedStateRows: row.examinedStateRows })) fail('provider adverse target projection is invalid');
    if (row.adverse) {
      const expectedContribution = store._providerContribution(row, processing, p.policy); const existingContribution = store._reuseProviderContributions.get(expectedContribution.id);
      if (canonicalDigest(row.contribution) !== canonicalDigest(expectedContribution) || (existingContribution && canonicalDigest(existingContribution) !== canonicalDigest(expectedContribution))) fail('provider adverse contribution identity conflicts', 'provider_contribution_conflict');
      const expectedAggregate = store._providerAggregate(p.repoId, row.coordinate, expectedContribution, p.policy);
      if (expectedAggregate.contributionIds.length > ceilings.maxGuardTargets || canonicalDigest(row.aggregate) !== canonicalDigest(expectedAggregate)) fail('provider adverse aggregate is invalid', 'reuse_risk_oversize');
      const officialNodeId = `source:provider-official:${row.officialDigest}`; const findingId = `finding:reuse-provider:${expectedContribution.id.slice('provider-contribution:'.length)}`; const aggregateFindingId = `finding:reuse-provider-aggregate:${expectedAggregate.guardDigest}`;
      if (store._knowledgeNodes.has(officialNodeId)) fail('provider official Source identity is preoccupied', 'reuse_namespace_conflict');
      if (!existingContribution && store._knowledgeNodes.has(findingId)) fail('provider contribution Finding identity is preoccupied', 'reuse_namespace_conflict');
      if (store._knowledgeNodes.has(aggregateFindingId)) fail('provider aggregate Finding identity is preoccupied', 'reuse_namespace_conflict');
      for (const target of row.targets) if (store._knowledgeEdges.has(`knowledge-edge:affects:${aggregateFindingId}:${target.nodeId}`)) fail('provider adverse Affects identity is preoccupied', 'reuse_namespace_conflict');
    } else if (row.contribution !== null || row.aggregate !== null || row.priorAggregateTarget !== null || row.targets.length !== 0 || row.examinedStateRows !== 0) fail('provider green coordinate cannot carry adverse authority');
  }
  const core = Object.fromEntries(Object.entries(p).filter(([key]) => key !== 'completionDigest'));
  if (p.completionDigest !== canonicalDigest(core)) fail('provider adverse completion digest is invalid');
  const exactEvent = { schemaVersion: 1, seq: event.seq, ts: event.ts, kind: 'knowledge.reuse_provider_guarded', actor: event.actor, idempotencyKey: event.idempotencyKey, payload: p };
  if (Buffer.byteLength(`${JSON.stringify(exactEvent)}\n`) > ceilings.maxEventBytes) fail('provider adverse completion exceeded event byte ceiling', 'reuse_risk_oversize');
}

export function _validateFleetDrainAdmission(p, event, integrity = false) {
  const fail = (message) => { throw integrity ? new CoordinationIntegrityError(message, 'fleet_drain_integrity') : new CoordinationRefusal(message, 'fleet_drain_integrity'); };
  const fields = ['schemaVersion', 'drainId', 'repoId', 'requestDigest', 'targetWorkerIds', 'targetDigest'];
  if (!p || Object.keys(p).sort().join(',') !== fields.sort().join(',') || p.schemaVersion !== 1
    || !validRunId(p.repoId) || !/^[a-f0-9]{64}$/.test(p.requestDigest ?? '')
    || p.drainId !== `fleet-drain:${p.requestDigest}` || !Array.isArray(p.targetWorkerIds)
    || p.targetWorkerIds.some((id) => !validRunId(id))) fail('fleet drain admission is invalid');
  // #366 (with #286 G-41): NO target-set ceiling. The literal ceiling that stood here was judged
  // again on every replay and refused a drain the ledger had already accepted. Unlike a run
  // stop's target set, a drain's target set is NOT a projection of this ledger — it is the local
  // controller's live fleet, and phase56's DC6 admits two targets onto an empty store — so no
  // bound can be derived from the ledger here. The bound this admission used to carry belongs to
  // the deployment that owns the fleet (coordinator.mjs `_drainPolicy.maxWorkers`), exactly as
  // #286 G-41 left the scratchpad partition bound to the deployment's own policy.
  const sorted = [...p.targetWorkerIds].sort();
  if (new Set(p.targetWorkerIds).size !== p.targetWorkerIds.length || JSON.stringify(sorted) !== JSON.stringify(p.targetWorkerIds)
    || p.targetDigest !== canonicalDigest(p.targetWorkerIds)) fail('fleet drain targets are invalid');
  const prefix = 'fleet.drain:';
  if (typeof event.idempotencyKey !== 'string' || !event.idempotencyKey.startsWith(prefix) || event.idempotencyKey.length === prefix.length) fail('fleet drain identity is invalid');
  const idempotencyKey = event.idempotencyKey.slice(prefix.length);
  if (!validRunId(idempotencyKey)) fail('fleet drain identity is invalid');
  if (p.requestDigest !== canonicalDigest({ repoId: p.repoId, idempotencyKey })) fail('fleet drain request binding is invalid');
  return idempotencyKey;
}

export function _validateFleetDrainCompletion(store, p, event, integrity = false) {
  const fail = (message) => { throw integrity ? new CoordinationIntegrityError(message, 'fleet_drain_integrity') : new CoordinationRefusal(message, 'fleet_drain_integrity'); };
  const fields = ['schemaVersion', 'drainId', 'receipt'];
  if (!p || Object.keys(p).sort().join(',') !== fields.sort().join(',') || p.schemaVersion !== 1 || typeof p.drainId !== 'string') fail('fleet drain completion is invalid');
  const drain = store._fleetDrains.get(p.drainId);
  if (!drain || drain.status !== 'admitted' || drain.receipt !== null) fail('fleet drain completion has no open admission');
  const admissionEvent = store._events[drain.admittedEvent - 1];
  const idempotencyKey = store._validateFleetDrainAdmission(admissionEvent?.payload, admissionEvent ?? {}, integrity);
  if (event.idempotencyKey !== `fleet.drain.complete:${idempotencyKey}` || event.actor !== admissionEvent.actor) fail('fleet drain completion authority is invalid');

  const receipt = p.receipt;
  const receiptFields = ['schemaVersion', 'state', 'scope', 'repoId', 'targetCount', 'remainingCount', 'targetDigest', 'counts', 'checks', 'effects', 'receiptDigest'];
  const countFields = ['pendingCancelled', 'killConfirmed', 'alreadyTerminal', 'processesObserved', 'processesClosed'];
  const checkFields = ['admissionClosed', 'authorityOpsDrained', 'stopWaitersDrained', 'cleanupDrained', 'localWorkerAuthorityReleased'];
  const effectFields = ['coordinatorClosed', 'writerReleased', 'transportsClosed'];
  const dispositionCount = receipt?.counts?.pendingCancelled + receipt?.counts?.killConfirmed + receipt?.counts?.alreadyTerminal;
  const durableCounts = { pendingCancelled: 0, killConfirmed: 0, alreadyTerminal: 0 };
  for (const row of drain.dispositions ?? []) {
    if (!Object.hasOwn(durableCounts, row.disposition)) fail('fleet drain durable disposition is invalid');
    durableCounts[row.disposition] += 1;
  }
  if (!receipt || Object.keys(receipt).sort().join(',') !== receiptFields.sort().join(',') || receipt.schemaVersion !== 1
    || receipt.state !== 'drained' || receipt.scope !== 'local-controller' || receipt.repoId !== drain.repoId
    || receipt.targetCount !== drain.targetWorkerIds.length || receipt.remainingCount !== 0 || receipt.targetDigest !== drain.targetDigest
    || !receipt.counts || Object.keys(receipt.counts).sort().join(',') !== countFields.sort().join(',')
    || countFields.some((field) => !Number.isSafeInteger(receipt.counts[field]) || receipt.counts[field] < 0 || receipt.counts[field] > receipt.targetCount)
    || dispositionCount !== receipt.targetCount
    || (drain.dispositions ?? []).length !== receipt.targetCount
    || durableCounts.pendingCancelled !== receipt.counts.pendingCancelled
    || durableCounts.killConfirmed !== receipt.counts.killConfirmed
    || durableCounts.alreadyTerminal !== receipt.counts.alreadyTerminal
    || receipt.counts.processesObserved !== receipt.counts.processesClosed
    || receipt.counts.processesObserved > receipt.counts.killConfirmed + receipt.counts.alreadyTerminal
    || !receipt.checks || Object.keys(receipt.checks).sort().join(',') !== checkFields.sort().join(',')
    || checkFields.some((field) => receipt.checks[field] !== true)
    || !receipt.effects || Object.keys(receipt.effects).sort().join(',') !== effectFields.sort().join(',')
    || effectFields.some((field) => receipt.effects[field] !== false)
    || !/^[a-f0-9]{64}$/.test(receipt.receiptDigest ?? '')) fail('fleet drain receipt is invalid');
  const { receiptDigest, ...receiptCore } = receipt;
  if (receiptDigest !== canonicalDigest(receiptCore)) fail('fleet drain receipt digest is invalid');
  return drain;
}

export function _validateFleetDrainDisposition(store, p, event, integrity = false) {
  const fail = (message) => { throw integrity ? new CoordinationIntegrityError(message, 'fleet_drain_integrity') : new CoordinationRefusal(message, 'fleet_drain_integrity'); };
  const fields = ['schemaVersion', 'drainId', 'workerId', 'disposition'];
  if (!p || Object.keys(p).sort().join(',') !== fields.sort().join(',') || p.schemaVersion !== 1
    || typeof p.drainId !== 'string' || !validRunId(p.workerId)
    || !['pendingCancelled', 'killConfirmed', 'alreadyTerminal'].includes(p.disposition)) fail('fleet drain disposition is invalid');
  const drain = store._fleetDrains.get(p.drainId);
  if (!drain || drain.status !== 'admitted' || !drain.targetWorkerIds.includes(p.workerId)) fail('fleet drain disposition has no open target');
  const admissionEvent = store._events[drain.admittedEvent - 1];
  const expectedKey = `fleet.drain.disposition:${canonicalDigest({ drainId: p.drainId, workerId: p.workerId })}`;
  if (event.actor !== admissionEvent?.actor || event.idempotencyKey !== expectedKey) fail('fleet drain disposition authority is invalid');
  const prior = (drain.dispositions ?? []).find((row) => row.workerId === p.workerId);
  if (prior && prior.disposition !== p.disposition) fail('fleet drain disposition conflicts with durable history');
  return drain;
}

export function _validateRunControlAdmission(store, p, event, integrity = false) {
  const fail = (message, code = 'run_control_integrity') => {
    throw integrity ? new CoordinationIntegrityError(message, code)
      : new CoordinationRefusal(message, code);
  };
  const version = p?.schemaVersion;
  const fields = [
    'actionId', 'admissionDigest', 'controlId', 'delivery', 'message', 'messageDigest',
    'operation', 'reasonDigest', 'recipient', 'registryDigest', 'repoId', 'requestDigest',
    'runId', 'schemaVersion', 'source', 'target', 'targetDigest',
    ...(version >= 2 ? ['turnDisposition'] : []),
  ];
  const sourceFields = ['actor', 'principalId', 'sessionId'];
  const targetFields = ['activeCount', 'fence', 'role', 'taskId', 'workerId',
    ...(version >= 2 ? [
      'planBindingDigest', 'processGeneration', 'routeDigest', 'runAuthorityDigest',
      'sessionDigest', 'preservationReceiptDigest', 'turnEpoch', 'turnState',
      'worktreeDigest',
    ] : [])];
  if (!p || Object.keys(p).sort().join(',') !== fields.sort().join(',')
    || ![1, 2].includes(version) || !validRunId(p.repoId) || !validRunId(p.runId)
    || !/^control:[a-f0-9]{64}$/u.test(p.controlId ?? '')
    || !/^[a-f0-9]{64}$/u.test(p.actionId ?? '')
    || !['send', 'interrupt'].includes(p.operation) || !boundedText(p.recipient, 256)
    || (p.operation === 'send' && (!boundedText(p.message, FRAME_LIMITS['run.legacy_send.body'].value)
      || !['nudge', 'now', 'turn'].includes(p.delivery)))
    || (p.operation === 'interrupt' && (p.message !== null || p.delivery !== null))
    || (version >= 2 && p.turnDisposition !== (p.operation === 'interrupt' ? 'preserve_turn' : null))
    || p.messageDigest !== (p.message === null ? null : canonicalDigest(p.message))
    || !/^[a-f0-9]{64}$/u.test(p.reasonDigest ?? '')
    || !/^[a-f0-9]{64}$/u.test(p.registryDigest ?? '')
    || !/^[a-f0-9]{64}$/u.test(p.requestDigest ?? '')
    || !/^[a-f0-9]{64}$/u.test(p.targetDigest ?? '')
    || !/^[a-f0-9]{64}$/u.test(p.admissionDigest ?? '')
    || !p.source || Object.keys(p.source).sort().join(',') !== sourceFields.sort().join(',')
    || !boundedText(p.source.actor, 256) || !validRunId(p.source.principalId)
    || !validRunId(p.source.sessionId) || event.actor !== p.source.actor
    || !p.target || Object.keys(p.target).sort().join(',') !== targetFields.sort().join(',')
    || !validRunId(p.target.workerId) || !boundedText(p.target.taskId, 4_096)
    || !Number.isSafeInteger(p.target.fence) || p.target.fence < 0
    || (p.target.role !== null && !boundedText(p.target.role, 256))
    || !Number.isSafeInteger(p.target.activeCount) || p.target.activeCount <= 0
    || (version >= 2 && (
      !Number.isSafeInteger(p.target.turnEpoch) || p.target.turnEpoch < 0
      || !['working', 'blocked', 'interrupted'].includes(p.target.turnState)
      || (p.target.sessionDigest !== null && !/^[a-f0-9]{64}$/u.test(p.target.sessionDigest ?? ''))
      || (p.target.preservationReceiptDigest !== null
        && !/^[a-f0-9]{64}$/u.test(p.target.preservationReceiptDigest ?? ''))
      || (p.target.turnState === 'interrupted')
        !== (p.target.preservationReceiptDigest !== null)
      || !Number.isSafeInteger(p.target.processGeneration) || p.target.processGeneration < 0
      || ['worktreeDigest', 'routeDigest', 'planBindingDigest', 'runAuthorityDigest']
        .some((field) => !/^[a-f0-9]{64}$/u.test(p.target[field] ?? ''))
    ))
    || event.idempotencyKey !== `run.control.admit:${p.controlId}`) {
    fail('run control admission is invalid');
  }
  const core = clone(p); delete core.admissionDigest;
  const request = {
    actionId: p.actionId, operation: p.operation, recipient: p.recipient,
    delivery: p.delivery, message: p.message, reasonDigest: p.reasonDigest,
    source: p.source, target: p.target, registryDigest: p.registryDigest,
    ...(version >= 2 ? { turnDisposition: p.turnDisposition } : {}),
  };
  if (p.targetDigest !== canonicalDigest(p.target)
    || p.requestDigest !== canonicalDigest(request)
    || p.admissionDigest !== canonicalDigest(core)) {
    fail('run control admission binding is invalid');
  }
  if (store.runStop(p.runId)) fail(`run ${p.runId} is stopping`, 'run_stopping');
  return p;
}

export function _validateRunControlEffect(store, p, event, integrity = false) {
  const fail = (message, code = 'run_control_integrity') => {
    throw integrity ? new CoordinationIntegrityError(message, code)
      : new CoordinationRefusal(message, code);
  };
  const fields = [
    'admissionDigest', 'controlId', 'effectDigest', 'providerRequestId',
    'schemaVersion', 'targetDigest',
    ...(p?.schemaVersion >= 2 ? ['turnDisposition'] : []),
  ];
  const control = store._runControls.get(p?.controlId);
  if (!p || Object.keys(p).sort().join(',') !== fields.sort().join(',')
    || p.schemaVersion !== control?.schemaVersion || !control || control.status !== 'admitted'
    || p.admissionDigest !== control.admissionDigest
    || p.targetDigest !== control.targetDigest
    || (p.schemaVersion >= 2 && p.turnDisposition !== control.turnDisposition)
    || !/^provider-control:[a-f0-9]{64}$/u.test(p.providerRequestId ?? '')
    || event.actor !== control.source.actor
    || event.idempotencyKey !== `run.control.begin:${p.controlId}`) {
    fail('run control effect start is invalid');
  }
  const core = clone(p); delete core.effectDigest;
  if (p.providerRequestId !== `provider-control:${canonicalDigest({
      controlId: control.controlId,
      targetDigest: control.targetDigest,
      admittedEvent: control.admittedEvent,
    })}` || p.effectDigest !== canonicalDigest(core)) {
    fail('run control effect binding is invalid');
  }
  if (store.runStop(control.runId)) fail(`run ${control.runId} is stopping`, 'run_stopping');
  return control;
}

export function _validateRunControlProviderAck(store, p, event, integrity = false) {
  const fail = (message, code = 'run_control_integrity') => {
    throw integrity ? new CoordinationIntegrityError(message, code)
      : new CoordinationRefusal(message, code);
  };
  const fields = [
    'ackDigest', 'controlId', 'effectDigest', 'outcome', 'providerRequestId',
    'schemaVersion', 'state',
  ];
  const outcomeFields = ['code', 'deliveredDespiteStale', 'emulated', 'result',
    ...(p?.schemaVersion >= 2 ? ['actualDelivery', 'continuation', 'preservation'] : [])];
  const control = store._runControls.get(p?.controlId);
  if (!p || Object.keys(p).sort().join(',') !== fields.sort().join(',')
    || p.schemaVersion !== control?.schemaVersion || !control || control.status !== 'effect_started'
    || p.effectDigest !== control.effect?.effectDigest
    || p.providerRequestId !== control.effect?.providerRequestId
    || !['confirmed', 'refused', 'outcome_unknown'].includes(p.state)
    || !p.outcome || Object.keys(p.outcome).sort().join(',') !== outcomeFields.sort().join(',')
    || !boundedText(p.outcome.result, 256)
    || (p.outcome.code !== null && !boundedText(p.outcome.code, 256))
    || typeof p.outcome.emulated !== 'boolean'
    || typeof p.outcome.deliveredDespiteStale !== 'boolean'
    || (p.schemaVersion >= 2 && (
      (p.outcome.actualDelivery !== null
        && !['nudge', 'now', 'turn'].includes(p.outcome.actualDelivery))
      || !store._validSessionPreservationReceipt(p.outcome.preservation, integrity)
      || !store._validPreservedContinuationReceipt(p.outcome.continuation)
      || (control.operation === 'interrupt'
        && (p.outcome.actualDelivery !== null || p.outcome.continuation !== null))
      || (control.operation === 'interrupt' && p.state !== 'confirmed'
        && p.outcome.preservation !== null)
      || (control.operation === 'interrupt' && p.state === 'confirmed'
        && p.outcome.preservation?.state !== 'preserved')
      || (control.operation === 'interrupt' && p.state === 'confirmed' && (
        p.outcome.preservation.sessionDigest !== control.target.sessionDigest
        || p.outcome.preservation.processGeneration !== control.target.processGeneration
        || p.outcome.preservation.worktreeDigest !== control.target.worktreeDigest
        || p.outcome.preservation.routeDigest !== control.target.routeDigest
        || p.outcome.preservation.planBindingDigest !== control.target.planBindingDigest
        || p.outcome.preservation.runAuthorityDigest !== control.target.runAuthorityDigest
      ))
      || (control.operation === 'send' && control.target.turnState === 'interrupted'
        && p.state === 'confirmed' && (
          p.outcome.actualDelivery !== 'turn'
          || p.outcome.continuation?.state !== 'admitted'
          || p.outcome.continuation.preservationReceiptDigest
            !== control.target.preservationReceiptDigest
          || p.outcome.continuation.sessionDigest !== control.target.sessionDigest
          || p.outcome.continuation.taskBindingDigest !== control.target.planBindingDigest
          || p.outcome.continuation.routeDigest !== control.target.routeDigest
        ))
      || (control.operation === 'send' && (p.state !== 'confirmed'
        || control.target.turnState !== 'interrupted')
        && p.outcome.continuation !== null)
      || (control.operation !== 'interrupt' && p.outcome.preservation !== null)
    ))
    || event.actor !== control.source.actor
    || event.idempotencyKey !== `run.control.ack:${p.controlId}`) {
    fail('run control provider acknowledgement is invalid');
  }
  const core = clone(p); delete core.ackDigest;
  if (p.ackDigest !== canonicalDigest(core)) {
    fail('run control provider acknowledgement binding is invalid');
  }
  return control;
}

export function _validateRunControlSettlement(store, p, event, integrity = false) {
  const fail = (message, code = 'run_control_integrity') => {
    throw integrity ? new CoordinationIntegrityError(message, code)
      : new CoordinationRefusal(message, code);
  };
  const fields = [
    'admissionDigest', 'controlId', 'operation', 'outcome', 'repoId', 'runId',
    'schemaVersion', 'settlementDigest', 'state',
  ];
  const outcomeFields = ['code', 'deliveredDespiteStale', 'emulated', 'result',
    ...(p?.schemaVersion >= 2 ? ['actualDelivery', 'continuation', 'preservation'] : [])];
  const control = store._runControls.get(p?.controlId);
  const continuesHistoricalAck = control?.status === 'provider_acked'
    && control.providerAck?.outcome?.preservation?.schemaVersion === 1;
  if (!p || Object.keys(p).sort().join(',') !== fields.sort().join(',')
    || p.schemaVersion !== control?.schemaVersion || !control
    || !['admitted', 'provider_acked'].includes(control.status)
    || p.repoId !== control.repoId || p.runId !== control.runId
    || p.operation !== control.operation || p.admissionDigest !== control.admissionDigest
    || !['confirmed', 'refused', 'outcome_unknown'].includes(p.state)
    || !p.outcome || Object.keys(p.outcome).sort().join(',') !== outcomeFields.sort().join(',')
    || !boundedText(p.outcome.result, 256)
    || (p.outcome.code !== null && !boundedText(p.outcome.code, 256))
    || typeof p.outcome.emulated !== 'boolean'
    || typeof p.outcome.deliveredDespiteStale !== 'boolean'
    || (p.schemaVersion >= 2 && (
      (p.outcome.actualDelivery !== null
        && !['nudge', 'now', 'turn'].includes(p.outcome.actualDelivery))
      || !store._validSessionPreservationReceipt(
        p.outcome.preservation, integrity || continuesHistoricalAck,
      )
      || !store._validPreservedContinuationReceipt(p.outcome.continuation)
      || (control.operation === 'interrupt'
        && (p.outcome.actualDelivery !== null || p.outcome.continuation !== null))
      || (control.operation === 'interrupt' && p.state !== 'confirmed'
        && p.outcome.preservation !== null)
      || (control.operation === 'interrupt' && p.state === 'confirmed'
        && p.outcome.preservation?.state !== 'preserved')
      || (control.operation === 'interrupt' && p.state === 'confirmed' && (
        p.outcome.preservation.sessionDigest !== control.target.sessionDigest
        || p.outcome.preservation.processGeneration !== control.target.processGeneration
        || p.outcome.preservation.worktreeDigest !== control.target.worktreeDigest
        || p.outcome.preservation.routeDigest !== control.target.routeDigest
        || p.outcome.preservation.planBindingDigest !== control.target.planBindingDigest
        || p.outcome.preservation.runAuthorityDigest !== control.target.runAuthorityDigest
      ))
      || (control.operation === 'send' && control.target.turnState === 'interrupted'
        && p.state === 'confirmed' && (
          p.outcome.actualDelivery !== 'turn'
          || p.outcome.continuation?.state !== 'admitted'
          || p.outcome.continuation.preservationReceiptDigest
            !== control.target.preservationReceiptDigest
          || p.outcome.continuation.sessionDigest !== control.target.sessionDigest
          || p.outcome.continuation.taskBindingDigest !== control.target.planBindingDigest
          || p.outcome.continuation.routeDigest !== control.target.routeDigest
        ))
      || (control.operation === 'send' && (p.state !== 'confirmed'
        || control.target.turnState !== 'interrupted')
        && p.outcome.continuation !== null)
      || (control.operation !== 'interrupt' && p.outcome.preservation !== null)
    ))
    || event.actor !== control.source.actor
    || event.idempotencyKey !== `run.control.settle:${p.controlId}`) {
    fail('run control settlement is invalid');
  }
  const core = clone(p); delete core.settlementDigest;
  if (p.settlementDigest !== canonicalDigest(core)) {
    fail('run control settlement binding is invalid');
  }
  if (control.status === 'provider_acked'
    && (p.state !== control.providerAck.state
      || canonicalDigest(p.outcome) !== canonicalDigest(control.providerAck.outcome))) {
    fail('run control settlement differs from provider acknowledgement');
  }
  return control;
}

export function _validateRunStopAdmission(store, p, event, integrity = false) {
  const fail = (message, code = 'run_stop_integrity') => {
    throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code);
  };
  const version = p?.schemaVersion;
  const contextFields = version >= 2 ? [
    'targetContextSessionIds', 'targetContextCellIds',
    ...(version >= 3 ? ['targetContextCallIds'] : []),
  ] : [];
  const fields = store._runLineagePolicy
    ? ['schemaVersion', 'scope', 'repoId', 'runId', 'reasonDigest', 'requestDigest', 'throughSeq', 'targetRunIds', 'targetTaskIds', 'targetWorkerIds', 'targetDigest', ...contextFields]
    : ['schemaVersion', 'repoId', 'runId', 'reasonDigest', 'requestDigest', 'targetTaskIds', 'targetWorkerIds', 'targetDigest', ...contextFields];
  if (!p || Object.keys(p).sort().join(',') !== fields.sort().join(',') || ![1, 2, 3].includes(version)
    || !validRunId(p.repoId) || !validRunId(p.runId) || !/^[a-f0-9]{64}$/.test(p.reasonDigest ?? '')
    || !/^[a-f0-9]{64}$/.test(p.requestDigest ?? '') || !/^[a-f0-9]{64}$/.test(p.targetDigest ?? '')
    || !Array.isArray(p.targetTaskIds) || !Array.isArray(p.targetWorkerIds)
    || p.targetTaskIds.some((id) => !boundedText(id, 4_096)) || p.targetWorkerIds.some((id) => !validRunId(id))
    || (store._runLineagePolicy && (p.scope !== 'run_subtree'
      || !Number.isSafeInteger(p.throughSeq) || p.throughSeq !== event.seq - 1
      || !Array.isArray(p.targetRunIds) || p.targetRunIds.length === 0 || p.targetRunIds.length > 1_000_000
      || p.targetRunIds.some((id) => !validRunId(id))))
    || (version >= 2 && (!Array.isArray(p.targetContextSessionIds)
      || !Array.isArray(p.targetContextCellIds)
      || p.targetContextSessionIds.some((id) => !/^context-session:[a-f0-9]{64}$/u.test(id))
      || p.targetContextCellIds.some((id) => !/^cell:[a-f0-9]{64}$/u.test(id))))
    || (version >= 3 && (!Array.isArray(p.targetContextCallIds)
      || p.targetContextCallIds.some((id) => !/^context-call:[a-f0-9]{64}$/u.test(id))))) {
    fail('run stop admission is invalid');
  }
  // #366: the ONE target-set ceiling, and it is ADMISSION-only — the fold (integrity) applies
  // none, because a recorded row is never re-judged for size on replay (see
  // assertTargetSetAdmissible, which reads the ONE registry row and names field/count/bound).
  if (!integrity) {
    assertTargetSetAdmissible('targetTaskIds', p.targetTaskIds.length, store._events.length);
    assertTargetSetAdmissible('targetWorkerIds', p.targetWorkerIds.length, store._events.length);
    if (version >= 2) {
      assertTargetSetAdmissible('targetContextSessionIds', p.targetContextSessionIds.length, store._events.length);
      assertTargetSetAdmissible('targetContextCellIds', p.targetContextCellIds.length, store._events.length);
    }
    if (version >= 3) assertTargetSetAdmissible('targetContextCallIds', p.targetContextCallIds.length, store._events.length);
  }
  const contextCanonical = version === 1 || (
    new Set(p.targetContextSessionIds).size === p.targetContextSessionIds.length
    && new Set(p.targetContextCellIds).size === p.targetContextCellIds.length
    && (version < 3 || new Set(p.targetContextCallIds).size === p.targetContextCallIds.length)
    && JSON.stringify([...p.targetContextSessionIds].sort(compareCanonicalStrings))
      === JSON.stringify(p.targetContextSessionIds)
    && JSON.stringify([...p.targetContextCellIds].sort(compareCanonicalStrings))
      === JSON.stringify(p.targetContextCellIds)
    && (version < 3 || JSON.stringify([...p.targetContextCallIds].sort(compareCanonicalStrings))
      === JSON.stringify(p.targetContextCallIds))
  );
  const digestCore = store._runLineagePolicy ? {
    throughSeq: p.throughSeq, targetRunIds: p.targetRunIds,
    targetTaskIds: p.targetTaskIds, targetWorkerIds: p.targetWorkerIds,
    ...(version >= 2 ? {
      targetContextSessionIds: p.targetContextSessionIds,
      targetContextCellIds: p.targetContextCellIds,
      ...(version >= 3 ? { targetContextCallIds: p.targetContextCallIds } : {}),
    } : {}),
  } : {
    targetTaskIds: p.targetTaskIds, targetWorkerIds: p.targetWorkerIds,
    ...(version >= 2 ? {
      targetContextSessionIds: p.targetContextSessionIds,
      targetContextCellIds: p.targetContextCellIds,
      ...(version >= 3 ? { targetContextCallIds: p.targetContextCallIds } : {}),
    } : {}),
  };
  if (new Set(p.targetTaskIds).size !== p.targetTaskIds.length || new Set(p.targetWorkerIds).size !== p.targetWorkerIds.length
    || JSON.stringify([...p.targetTaskIds].sort(compareCanonicalStrings)) !== JSON.stringify(p.targetTaskIds)
    || JSON.stringify([...p.targetWorkerIds].sort(compareCanonicalStrings)) !== JSON.stringify(p.targetWorkerIds)
    || !contextCanonical
    || p.requestDigest !== canonicalDigest({ repoId: p.repoId, runId: p.runId, reasonDigest: p.reasonDigest })
    || (store._runLineagePolicy
      ? (new Set(p.targetRunIds).size !== p.targetRunIds.length
        || JSON.stringify([...p.targetRunIds].sort(compareCanonicalStrings)) !== JSON.stringify(p.targetRunIds)
        || p.targetDigest !== canonicalDigest(digestCore))
      : p.targetDigest !== canonicalDigest(digestCore))) {
    fail('run stop admission binding is invalid');
  }
  if (event.idempotencyKey !== `run.stop:${p.runId}` || !boundedText(event.actor, 256)) fail('run stop authority is invalid');
  const targets = store._runStopTargets(
    p.runId, store._runLineagePolicy ? p.throughSeq : undefined, version,
  );
  const observed = store._runLineagePolicy ? {
    scope: p.scope, throughSeq: p.throughSeq, targetRunIds: p.targetRunIds,
    targetTaskIds: p.targetTaskIds, targetWorkerIds: p.targetWorkerIds, targetDigest: p.targetDigest,
    ...(version >= 2 ? {
      targetContextSessionIds: p.targetContextSessionIds,
      targetContextCellIds: p.targetContextCellIds,
      ...(version >= 3 ? { targetContextCallIds: p.targetContextCallIds } : {}),
    } : {}),
  } : {
    targetTaskIds: p.targetTaskIds, targetWorkerIds: p.targetWorkerIds,
    targetDigest: p.targetDigest,
    ...(version >= 2 ? {
      targetContextSessionIds: p.targetContextSessionIds,
      targetContextCellIds: p.targetContextCellIds,
      ...(version >= 3 ? { targetContextCallIds: p.targetContextCallIds } : {}),
    } : {}),
  };
  if (canonicalDigest(targets) !== canonicalDigest(observed)) fail('run stop target snapshot diverged');
  return targets;
}

export function _validateRunStopCompletion(store, p, event, integrity = false) {
  const fail = (message) => {
    throw integrity ? new CoordinationIntegrityError(message, 'run_stop_integrity') : new CoordinationRefusal(message, 'run_stop_integrity');
  };
  if (!p || Object.keys(p).sort().join(',') !== ['receipt', 'runId', 'schemaVersion'].join(',')
    || ![1, 2, 3].includes(p.schemaVersion) || !validRunId(p.runId)) fail('run stop completion is invalid');
  const stop = store._runStops.get(p.runId);
  if (!stop || stop.status !== 'stopping' || stop.receipt !== null) fail('run stop completion has no open admission');
  if (p.schemaVersion !== stop.schemaVersion) fail('run stop completion version differs from admission');
  if (event.idempotencyKey !== `run.stop.complete:${p.runId}` || event.actor !== stop.actor) fail('run stop completion authority is invalid');
  const receipt = p.receipt;
  const receiptFields = ['schemaVersion', 'state', 'scope', 'repoId', 'runId', 'targetCount', 'remainingCount', 'targetDigest', 'counts', 'checks', 'effects', 'receiptDigest',
    ...(stop.schemaVersion >= 2 ? ['context'] : [])];
  const countFields = ['pendingCancelled', 'killConfirmed', 'alreadyTerminal', 'processesObserved', 'processesClosed'];
  const checkFields = ['dispatchClosed', 'interactionsResolved', 'runAuthorityReleased'];
  const effectFields = ['coordinatorClosed', 'writerReleased', 'transportsClosed'];
  if (!receipt || Object.keys(receipt).sort().join(',') !== receiptFields.sort().join(',') || receipt.schemaVersion !== stop.schemaVersion
    || receipt.state !== 'stopped' || receipt.scope !== (stop.scope ?? 'run') || receipt.repoId !== stop.repoId || receipt.runId !== stop.runId
    || receipt.targetCount !== stop.targetWorkerIds.length || receipt.remainingCount !== 0 || receipt.targetDigest !== stop.targetDigest
    || !receipt.counts || Object.keys(receipt.counts).sort().join(',') !== countFields.sort().join(',')
    || countFields.some((field) => !Number.isSafeInteger(receipt.counts[field]) || receipt.counts[field] < 0 || receipt.counts[field] > receipt.targetCount)
    || receipt.counts.pendingCancelled + receipt.counts.killConfirmed + receipt.counts.alreadyTerminal !== receipt.targetCount
    || receipt.counts.processesObserved !== receipt.counts.processesClosed
    || !receipt.checks || Object.keys(receipt.checks).sort().join(',') !== checkFields.sort().join(',')
    || checkFields.some((field) => receipt.checks[field] !== true)
    || !receipt.effects || Object.keys(receipt.effects).sort().join(',') !== effectFields.sort().join(',')
    || effectFields.some((field) => receipt.effects[field] !== false)
    || !/^[a-f0-9]{64}$/.test(receipt.receiptDigest ?? '')) fail('run stop receipt is invalid');
  if (stop.schemaVersion >= 2) {
    const contextFields = [
      'targetSessionCount', 'targetCellCount', 'remainingSessionCount', 'remainingCellCount',
      ...(stop.schemaVersion >= 3 ? ['targetCallCount', 'remainingCallCount'] : []),
    ];
    const context = receipt.context;
    const sessionStates = stop.targetContextSessionIds.map((sessionId) => (
      store._contextSessions.get(sessionId)?.state ?? null
    ));
    const cellStates = stop.targetContextCellIds.map((cellId) => (
      store._contextCells.get(cellId)?.state ?? null
    ));
    const callStates = (stop.targetContextCallIds ?? []).map((callId) => (
      store._contextCalls.get(callId)?.state ?? null
    ));
    const remainingSessionCount = sessionStates.filter((state) => state !== 'stopped').length;
    const remainingCellCount = cellStates.filter((state) => state !== 'stopped').length;
    const remainingCallCount = callStates.filter((state) => (
      !['completed', 'failed', 'stopped'].includes(state)
    )).length;
    if (!context || Object.keys(context).sort().join(',') !== contextFields.sort().join(',')
      || context.targetSessionCount !== stop.targetContextSessionIds.length
      || context.targetCellCount !== stop.targetContextCellIds.length
      || context.remainingSessionCount !== remainingSessionCount
      || context.remainingCellCount !== remainingCellCount
      || (stop.schemaVersion >= 3 && (
        context.targetCallCount !== stop.targetContextCallIds.length
        || context.remainingCallCount !== remainingCallCount
      ))
      || remainingSessionCount !== 0 || remainingCellCount !== 0 || remainingCallCount !== 0) {
      fail('run stop Context receipt is invalid');
    }
  }
  const { receiptDigest, ...core } = receipt;
  if (receiptDigest !== canonicalDigest(core)) fail('run stop receipt digest is invalid');
  return stop;
}

export function _runResultAdoptionFailure(message, code = 'run_result_adoption_integrity', integrity = false) {
  throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code);
}

export function _normalizeRunResultAdoptionRequest(store, fields, event, integrity = false) {
  const fail = (message, code = 'run_result_adoption_invalid') => store._runResultAdoptionFailure(message, code, integrity);
  const expected = ['evidenceDigest', 'nodeKey', 'reasonDigest', 'repoId', 'requestDigest', 'resultSha', 'runId', 'schemaVersion', 'taskId'];
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)
    || Object.keys(fields).sort().join(',') !== expected.sort().join(',') || fields.schemaVersion !== 1
    || !validRunId(fields.repoId) || !validRunId(fields.runId) || !boundedText(fields.nodeKey, 256)
    || !boundedText(fields.taskId, 4_096) || !validResultSha(fields.resultSha)
    || !/^[a-f0-9]{64}$/.test(fields.evidenceDigest ?? '') || !/^[a-f0-9]{64}$/.test(fields.reasonDigest ?? '')
    || !/^[a-f0-9]{64}$/.test(fields.requestDigest ?? '')) fail('run result adoption request is invalid');
  const requestCore = {
    repoId: fields.repoId, runId: fields.runId, nodeKey: fields.nodeKey, taskId: fields.taskId,
    resultSha: fields.resultSha, evidenceDigest: fields.evidenceDigest, reasonDigest: fields.reasonDigest,
  };
  if (fields.requestDigest !== canonicalDigest(requestCore)) fail('run result adoption request digest is invalid');
  const expectedKey = `run.result_adoption:${fields.runId}:${fields.nodeKey}`;
  if (event?.idempotencyKey !== expectedKey || !boundedText(event?.actor, 256)) fail('run result adoption authority is invalid');
  return freeze({ ...clone(requestCore), requestDigest: fields.requestDigest });
}

export function _deriveRunResultAdoptionBinding(store, request, integrity = false) {
  const fail = (message, code = 'run_result_adoption_unavailable') => store._runResultAdoptionFailure(message, code, integrity);
  const task = store._tasks.get(request.taskId);
  const dispatch = store._planTaskLinks.get(request.taskId);
  const goalPlan = task?.brief?.goalPlan;
  if (!task || task.runId !== request.runId || task.status !== 'completed' || task.acceptanceRevocation
    || !dispatch || !goalPlan || dispatch.taskId !== task.id || dispatch.binding?.nodeKey !== request.nodeKey
    || canonicalDigest(dispatch.binding) !== canonicalDigest(goalPlan)) {
    fail('run result adoption requires the exact completed approved Plan task');
  }
  const goal = store._goals.get(store._goalVersionKey(goalPlan.goalId, goalPlan.goalVersion));
  const plan = store._plans.get(store._planVersionKey(goalPlan.planId, goalPlan.planVersion));
  const approval = store._planApprovals.get(store._planVersionKey(goalPlan.planId, goalPlan.planVersion));
  const node = plan?.nodes?.find((row) => row.key === request.nodeKey);
  if (!goal || !plan || !approval || approval.disposition !== 'approved' || !node
    || goal.repoId !== request.repoId || goal.runId !== request.runId
    || plan.repoId !== request.repoId || plan.runId !== request.runId
    || goal.digest !== goalPlan.goalDigest || plan.digest !== goalPlan.planDigest
    || approval.digest !== goalPlan.approvalDigest) {
    fail('run result adoption Plan authority is unavailable');
  }
  const artifacts = task.artifactIds.map((id) => store._artifacts.get(id)).filter(Boolean);
  const active = (artifact) => artifact.accepted === true && artifact.supersededBy === null
    && !Object.hasOwn(artifact, 'acceptanceInvalidation');
  const commits = artifacts.filter((artifact) => active(artifact) && artifact.kind === 'commit'
    && artifact.refs?.sha === request.resultSha
    && artifact.refs?.retainedResultRef === retainedResultRef(request.resultSha));
  if (commits.length !== 1) fail('run result adoption requires one active accepted retained commit artifact');
  const commit = commits[0];
  const commitEvidence = new Set((commit.provenance ?? []).map((ref) => ref?.coordinationSeq).filter(Number.isSafeInteger));
  const verifications = artifacts.filter((artifact) => active(artifact) && artifact.kind === 'verification'
    && (artifact.provenance ?? []).some((ref) => commitEvidence.has(ref?.coordinationSeq)));
  if (verifications.length !== 1) fail('run result adoption requires one active accepted verification artifact');
  const verification = verifications[0];
  const shared = (verification.provenance ?? []).map((ref) => ref?.coordinationSeq)
    .filter((seq) => Number.isSafeInteger(seq) && commitEvidence.has(seq)).sort((a, b) => a - b);
  if (shared.length !== 1) fail('run result adoption verification provenance is ambiguous');
  const mapped = store._events[shared[0] - 1];
  const source = mapped?.kind === 'evidence.mapped'
    ? store._operationalRead?.(mapped.payload.worker, mapped.payload.workerSeq) : null;
  if (!mapped || mapped.payload?.kind !== 'verify.reverified' || source?.kind !== 'verify.reverified'
    || source.actor !== 'policy' || source.worker !== task.assignee || source.taskId !== task.id
    || source.payload?.accept !== true || digest(source) !== mapped.payload.digest
    || verification.refs?.worker !== mapped.payload.worker || verification.refs?.workerSeq !== mapped.payload.workerSeq) {
    fail('run result adoption verification evidence is not the accepted task result');
  }
  return freeze({
    taskVersion: task.version,
    goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest },
    plan: { planId: plan.planId, version: plan.version, digest: plan.digest },
    approvalDigest: approval.digest,
    commitArtifact: { id: commit.id, digest: commit.digest },
    verificationArtifact: { id: verification.id, digest: verification.digest },
    verificationEvidence: {
      coordinationSeq: mapped.seq, worker: mapped.payload.worker,
      workerSeq: mapped.payload.workerSeq, digest: mapped.payload.digest,
    },
  });
}

export function _validateRunResultAdoptionAdmission(store, p, event, integrity = false) {
  const fail = (message, code = 'run_result_adoption_integrity') => store._runResultAdoptionFailure(message, code, integrity);
  const fields = ['adoptionDigest', 'binding', 'evidenceDigest', 'nodeKey', 'reasonDigest', 'repoId', 'requestDigest', 'resultSha', 'retainedResultRef', 'runId', 'schemaVersion', 'taskId'];
  if (!p || typeof p !== 'object' || Array.isArray(p)
    || Object.keys(p).sort().join(',') !== fields.sort().join(',') || p.schemaVersion !== 1
    || !/^[a-f0-9]{64}$/.test(p.adoptionDigest ?? '')) fail('run result adoption admission is malformed');
  const request = store._normalizeRunResultAdoptionRequest(Object.fromEntries(
    ['schemaVersion', 'repoId', 'runId', 'nodeKey', 'taskId', 'resultSha', 'evidenceDigest', 'reasonDigest', 'requestDigest']
      .map((key) => [key, p[key]]),
  ), event, integrity);
  if (p.retainedResultRef !== retainedResultRef(request.resultSha)) fail('run result adoption retained ref is invalid');
  const binding = store._deriveRunResultAdoptionBinding(request, integrity);
  if (canonicalDigest(p.binding) !== canonicalDigest(binding)) fail('run result adoption binding diverged');
  const core = Object.fromEntries(Object.entries(p).filter(([key]) => key !== 'adoptionDigest'));
  if (p.adoptionDigest !== canonicalDigest(core)) fail('run result adoption admission digest is invalid');
  if (store._runResultAdoptions.has(store._runResultAdoptionKey(p.runId, p.nodeKey))) fail('run result adoption identity is already occupied');
  return binding;
}

export function _validateRunResultAdoptionCompletion(store, p, event, integrity = false) {
  const fail = (message, code = 'run_result_adoption_integrity') => store._runResultAdoptionFailure(message, code, integrity);
  if (!p || typeof p !== 'object' || Array.isArray(p)
    || Object.keys(p).sort().join(',') !== ['nodeKey', 'receipt', 'runId', 'schemaVersion'].join(',')
    || p.schemaVersion !== 1 || !validRunId(p.runId) || !boundedText(p.nodeKey, 256)) {
    fail('run result adoption completion is malformed');
  }
  const adoption = store._runResultAdoptions.get(store._runResultAdoptionKey(p.runId, p.nodeKey));
  if (!adoption || adoption.status !== 'pending' || adoption.receipt !== null) fail('run result adoption completion has no pending admission');
  if (event?.idempotencyKey !== `run.result_adoption.complete:${p.runId}:${p.nodeKey}` || event.actor !== adoption.actor) {
    fail('run result adoption completion authority is invalid');
  }
  const binding = store._deriveRunResultAdoptionBinding(adoption, integrity);
  if (canonicalDigest(binding) !== canonicalDigest(adoption.binding)) fail('run result adoption accepted authority changed before completion');
  const receipt = p.receipt;
  const receiptFields = ['binding', 'checks', 'effects', 'nodeKey', 'receiptDigest', 'repoId', 'result', 'runId', 'schemaVersion', 'scope', 'state', 'taskId'];
  const bindingFields = ['admissionDigest', 'approvalDigest', 'commitArtifactDigest', 'commitArtifactId', 'evidenceDigest', 'goalDigest', 'planDigest', 'verificationArtifactDigest', 'verificationArtifactId'];
  const checkFields = ['mainUnchanged', 'refPinned', 'taskAccepted', 'verificationAccepted', 'worktreeIndependent'];
  const effectFields = ['indexChanged', 'mainHeadChanged', 'published', 'workingTreeChanged'];
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
    || Object.keys(receipt).sort().join(',') !== receiptFields.sort().join(',') || receipt.schemaVersion !== 1
    || receipt.state !== 'adopted' || receipt.scope !== 'run-result' || receipt.repoId !== adoption.repoId
    || receipt.runId !== adoption.runId || receipt.nodeKey !== adoption.nodeKey || receipt.taskId !== adoption.taskId
    || !receipt.binding || Object.keys(receipt.binding).sort().join(',') !== bindingFields.sort().join(',')
    || canonicalDigest(receipt.binding) !== canonicalDigest({
      admissionDigest: adoption.adoptionDigest, evidenceDigest: adoption.evidenceDigest,
      goalDigest: adoption.binding.goal.digest, planDigest: adoption.binding.plan.digest,
      approvalDigest: adoption.binding.approvalDigest,
      commitArtifactId: adoption.binding.commitArtifact.id, commitArtifactDigest: adoption.binding.commitArtifact.digest,
      verificationArtifactId: adoption.binding.verificationArtifact.id,
      verificationArtifactDigest: adoption.binding.verificationArtifact.digest,
    })
    || !receipt.result || Object.keys(receipt.result).sort().join(',') !== ['ref', 'sha'].join(',')
    || receipt.result.sha !== adoption.resultSha || receipt.result.ref !== adoption.retainedResultRef
    || !receipt.checks || Object.keys(receipt.checks).sort().join(',') !== checkFields.sort().join(',')
    || checkFields.some((field) => receipt.checks[field] !== true)
    || !receipt.effects || Object.keys(receipt.effects).sort().join(',') !== effectFields.sort().join(',')
    || effectFields.some((field) => receipt.effects[field] !== false)
    || !/^[a-f0-9]{64}$/.test(receipt.receiptDigest ?? '')) fail('run result adoption receipt is invalid');
  const { receiptDigest, ...core } = receipt;
  if (receiptDigest !== canonicalDigest(core)) fail('run result adoption receipt digest is invalid');
  return adoption;
}

export function _runResultExportFailure(message, code = 'run_result_export_integrity', integrity = false) {
  throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code);
}

export function _normalizeRunResultExportRequest(store, fields, event, integrity = false) {
  const fail = (message, code = 'run_result_export_invalid') => store._runResultExportFailure(message, code, integrity);
  const expected = [
    'schemaVersion', 'repoId', 'runId', 'nodeKey', 'taskId', 'resultSha', 'evidenceDigest',
    'profileDigest', 'exportPolicyDigest', 'exportRootDigest', 'adoptionReceiptDigest',
    'semanticReviewTaskId', 'semanticReviewReceiptDigest', 'integrationAfterSha', 'format',
    'maxFiles', 'maxBytes', 'stagingNonce', 'exportId', 'requestDigest',
  ];
  const nullableDigest = (value) => value === null || /^[a-f0-9]{64}$/.test(value ?? '');
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)
    || Object.keys(fields).sort().join(',') !== expected.sort().join(',') || fields.schemaVersion !== 1
    || !validRunId(fields.repoId) || !validRunId(fields.runId) || !boundedText(fields.nodeKey, 256)
    || !boundedText(fields.taskId, 4_096) || !validResultSha(fields.resultSha)
    || ![fields.evidenceDigest, fields.profileDigest, fields.exportPolicyDigest, fields.exportRootDigest,
      fields.exportId, fields.requestDigest].every((value) => /^[a-f0-9]{64}$/.test(value ?? ''))
    || !nullableDigest(fields.adoptionReceiptDigest) || !nullableDigest(fields.semanticReviewReceiptDigest)
    || (fields.semanticReviewTaskId !== null && !boundedText(fields.semanticReviewTaskId, 4_096))
    || (fields.integrationAfterSha !== null && !validResultSha(fields.integrationAfterSha))
    || (fields.semanticReviewReceiptDigest === null) !== (fields.semanticReviewTaskId === null)
    || fields.format !== 'directory-v1'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(fields.stagingNonce ?? '')
    || !Number.isSafeInteger(fields.maxFiles) || fields.maxFiles <= 0
    || !Number.isSafeInteger(fields.maxBytes) || fields.maxBytes <= 0) fail('run result export request is invalid');
  const requestCore = Object.fromEntries(expected
    .filter((key) => !['schemaVersion', 'exportId', 'requestDigest'].includes(key))
    .map((key) => [key, clone(fields[key])]));
  const identity = canonicalDigest(requestCore);
  if (fields.exportId !== identity || fields.requestDigest !== identity) fail('run result export identity is invalid');
  if (event?.idempotencyKey !== `run.result_export:${fields.runId}:${fields.nodeKey}`
    || !boundedText(event?.actor, 256)) fail('run result export authority is invalid');
  return freeze({ ...requestCore, exportId: identity, requestDigest: identity });
}

export function _deriveRunResultExportBinding(store, request, integrity = false) {
  const fail = (message, code = 'run_result_export_unavailable') => store._runResultExportFailure(message, code, integrity);
  const accepted = store._deriveRunResultAdoptionBinding(request, integrity);
  let adoption = null;
  if (request.adoptionReceiptDigest !== null) {
    const state = store._runResultAdoptions.get(store._runResultAdoptionKey(request.runId, request.nodeKey));
    if (!state || state.status !== 'adopted' || state.resultSha !== request.resultSha
      || state.receipt?.receiptDigest !== request.adoptionReceiptDigest) {
      fail('run result export adoption receipt is unavailable');
    }
    adoption = { admissionDigest: state.adoptionDigest, receiptDigest: state.receipt.receiptDigest };
  }
  let semanticReview = null;
  if (request.semanticReviewReceiptDigest !== null) {
    const review = store._tasks.get(request.semanticReviewTaskId);
    const structured = review?.review?.structured;
    const target = structured?.target;
    if (!review || review.status !== 'completed' || review.acceptanceRevocation || review.runId !== request.runId
      || review.refines !== request.taskId || review.taskType !== 'review'
      || structured?.purpose !== 'run_semantic_review' || target?.taskId !== request.taskId
      || target?.runId !== request.runId || target?.nodeKey !== request.nodeKey
      || target?.resultSha !== request.resultSha) fail('run result export semantic review is unavailable');
    semanticReview = { taskId: review.id, taskVersion: review.version, receiptDigest: request.semanticReviewReceiptDigest };
  }
  let integration = null;
  if (request.integrationAfterSha !== null) {
    const task = store._tasks.get(request.taskId);
    const reports = (task?.artifactIds ?? []).map((id) => store._artifacts.get(id)).filter((artifact) => artifact
      && artifact.accepted === true && artifact.supersededBy === null
      && !Object.hasOwn(artifact, 'acceptanceInvalidation')
      && artifact.mediaType === 'application/vnd.baton.integration+json'
      && artifact.refs?.resultSha === request.resultSha && artifact.refs?.afterSha === request.integrationAfterSha);
    if (reports.length !== 1) fail('run result export integration receipt is unavailable');
    integration = { artifactId: reports[0].id, artifactDigest: reports[0].digest, afterSha: request.integrationAfterSha };
  }
  return freeze({ accepted, adoption, semanticReview, integration });
}

export function _validateRunResultExportAdmission(store, p, event, integrity = false) {
  const fail = (message, code = 'run_result_export_integrity') => store._runResultExportFailure(message, code, integrity);
  const requestFields = [
    'schemaVersion', 'repoId', 'runId', 'nodeKey', 'taskId', 'resultSha', 'evidenceDigest',
    'profileDigest', 'exportPolicyDigest', 'exportRootDigest', 'adoptionReceiptDigest',
    'semanticReviewTaskId', 'semanticReviewReceiptDigest', 'integrationAfterSha', 'format',
    'maxFiles', 'maxBytes', 'stagingNonce', 'exportId', 'requestDigest',
  ];
  const expected = [...requestFields, 'locator', 'binding', 'admissionDigest'];
  if (!p || typeof p !== 'object' || Array.isArray(p)
    || Object.keys(p).sort().join(',') !== expected.sort().join(',')
    || !/^[a-f0-9]{64}$/.test(p.admissionDigest ?? '')) fail('run result export admission is malformed');
  const request = store._normalizeRunResultExportRequest(
    Object.fromEntries(requestFields.map((key) => [key, clone(p[key])])), event, integrity,
  );
  store._assertRunAdmissionOpen(request.runId);
  if (p.locator !== `export:${request.exportId}`) fail('run result export locator is invalid');
  const binding = store._deriveRunResultExportBinding(request, integrity);
  if (canonicalDigest(p.binding) !== canonicalDigest(binding)) fail('run result export binding diverged');
  const core = Object.fromEntries(Object.entries(p).filter(([key]) => key !== 'admissionDigest'));
  if (p.admissionDigest !== canonicalDigest(core)) fail('run result export admission digest is invalid');
  if ([...store._runResultExports.values()].some((state) => state.runId === request.runId && state.nodeKey === request.nodeKey)) {
    fail('run result export identity is already occupied');
  }
  return binding;
}

export function _validateRunResultExportCompletion(store, p, event, integrity = false) {
  const fail = (message, code = 'run_result_export_integrity') => store._runResultExportFailure(message, code, integrity);
  if (!p || typeof p !== 'object' || Array.isArray(p)
    || Object.keys(p).sort().join(',') !== ['exportId', 'receipt', 'schemaVersion'].join(',')
    || p.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(p.exportId ?? '')) fail('run result export completion is malformed');
  const state = store._runResultExports.get(p.exportId);
  if (!state || state.status !== 'pending' || state.receipt !== null) fail('run result export completion has no pending admission');
  if (event?.idempotencyKey !== `run.result_export.complete:${p.exportId}` || event.actor !== state.actor) {
    fail('run result export completion authority is invalid');
  }
  store._assertRunAdmissionOpen(state.runId);
  const binding = store._deriveRunResultExportBinding(state, integrity);
  if (canonicalDigest(binding) !== canonicalDigest(state.binding)) fail('run result export authority changed before completion');
  const receipt = p.receipt;
  const receiptFields = [
    'schemaVersion', 'state', 'format', 'runId', 'nodeKey', 'resultSha', 'evidenceDigest',
    'exportId', 'locator', 'treeOid', 'manifestDigest', 'fileCount', 'byteCount',
    'checks', 'effects', 'receiptDigest',
  ];
  const checkFields = ['acceptedResultReverified', 'manifestVerified', 'treeExact'];
  const effectFields = ['adopted', 'checkoutChanged', 'deployed', 'integrated', 'published'];
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
    || Object.keys(receipt).sort().join(',') !== receiptFields.sort().join(',')
    || receipt.schemaVersion !== 1 || receipt.state !== 'completed' || receipt.format !== state.format
    || receipt.runId !== state.runId || receipt.nodeKey !== state.nodeKey || receipt.resultSha !== state.resultSha
    || receipt.evidenceDigest !== state.evidenceDigest || receipt.exportId !== state.exportId
    || receipt.locator !== state.locator || !validResultSha(receipt.treeOid)
    || !/^[a-f0-9]{64}$/.test(receipt.manifestDigest ?? '')
    || !Number.isSafeInteger(receipt.fileCount) || receipt.fileCount < 0 || receipt.fileCount > state.maxFiles
    || !Number.isSafeInteger(receipt.byteCount) || receipt.byteCount < 0 || receipt.byteCount > state.maxBytes
    || !receipt.checks || Object.keys(receipt.checks).sort().join(',') !== checkFields.sort().join(',')
    || checkFields.some((field) => receipt.checks[field] !== true)
    || !receipt.effects || Object.keys(receipt.effects).sort().join(',') !== effectFields.sort().join(',')
    || effectFields.some((field) => receipt.effects[field] !== false)
    || !/^[a-f0-9]{64}$/.test(receipt.receiptDigest ?? '')) fail('run result export receipt is invalid');
  const { receiptDigest, ...core } = receipt;
  if (receiptDigest !== canonicalDigest(core)) fail('run result export receipt digest is invalid');
  return state;
}

export function _contextFailure(message, code, integrity = false) {
  if (integrity) throw new CoordinationIntegrityError(message, code);
  throw new CoordinationRefusal(message, code);
}

export function _contextDefinition(store, manifest, integrity = false) {
  const records = store._events.filter((event) => event.kind === 'driver.recorded'
    && event.payload?.kind === 'application.workflow_definition_bound'
    && event.payload?.repoId === manifest.repoId
    && event.payload?.runId === manifest.workflow.runId
    && event.payload?.planDigest === manifest.workflow.plan.digest
    && event.payload?.definitionDigest === manifest.workflow.definitionDigest);
  if (records.length !== 1) {
    store._contextFailure('Context Workflow definition is absent or ambiguous',
      'context_session_invalid', integrity);
  }
  const event = records[0];
  const { kind, definitionDigest, ...core } = event.payload;
  void kind;
  if (event.actor !== 'application:workflow-registry'
    || event.idempotencyKey
      !== `application.workflow_definition_bound:${manifest.workflow.runId}:${manifest.workflow.plan.digest}`
    || definitionDigest !== canonicalDigest(core)) {
    store._contextFailure('Context Workflow definition failed integrity validation',
      'context_session_invalid', integrity);
  }
  const plan = store._plans.get(store._planVersionKey(
    manifest.workflow.plan.planId, manifest.workflow.plan.version,
  ));
  if (event.payload.schemaVersion === 3) {
    const ancestors = store._events.filter((candidate) => (
      candidate.seq < event.seq && candidate.kind === 'driver.recorded'
        && candidate.payload?.kind === 'application.workflow_definition_bound'
        && candidate.payload?.repoId === manifest.repoId
        && candidate.payload?.runId === manifest.workflow.runId
    )).map((candidate) => candidate.payload);
    try {
      if (!plan || plan.digest !== manifest.workflow.plan.digest) {
        throw new TypeError('Context Workflow Plan is unavailable');
      }
      validateWorkflowDefinitionV3(event.payload, { nodes: plan.nodes, ancestors });
    } catch (error) {
      store._contextFailure(error.message, 'context_session_invalid', integrity);
    }
  } else if (Array.isArray(event.payload.attempts)) {
    try {
      if (!plan || plan.digest !== manifest.workflow.plan.digest) {
        throw new TypeError('Context Workflow Plan is unavailable');
      }
      validateWorkflowDefinitionLegacy(event.payload, { nodes: plan.nodes });
    } catch (error) {
      store._contextFailure(error.message, 'context_session_invalid', integrity);
    }
  }
  return event;
}

export function _normalizeContextDeployment(store, value, integrity = false) {
  const fields = [
    'authorityDigest', 'deploymentBaseSha', 'environmentDigest', 'kind', 'policy',
    'referenceIdentity', 'schemaVersion',
  ];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== fields.sort().join(',')
    || value.schemaVersion !== 1 || value.kind !== 'baton.context_deployment_authority'
    || !/^[a-f0-9]{40}$/u.test(value.deploymentBaseSha ?? '')
    || !/^[a-f0-9]{64}$/u.test(value.environmentDigest ?? '')
    || !/^[a-f0-9]{64}$/u.test(value.referenceIdentity ?? '')) {
    store._contextFailure('Context deployment authority is malformed',
      integrity ? 'context_session_integrity' : 'context_session_invalid', integrity);
  }
  let policy;
  try { policy = normalizeContextProgramPolicy(value.policy); }
  catch (error) {
    store._contextFailure(error.message,
      integrity ? 'context_session_integrity' : 'context_session_invalid', integrity);
  }
  const body = {
    schemaVersion: 1,
    kind: 'baton.context_deployment_authority',
    deploymentBaseSha: value.deploymentBaseSha,
    environmentDigest: value.environmentDigest,
    referenceIdentity: value.referenceIdentity,
    policy,
  };
  if (value.authorityDigest !== canonicalDigest(body)) {
    store._contextFailure('Context deployment authority digest changed',
      integrity ? 'context_session_integrity' : 'context_session_invalid', integrity);
  }
  return freeze({ ...body, authorityDigest: value.authorityDigest });
}

export function _normalizeContextSourceAttestation(store, value, { deployment, manifest, node, branch, source = null },
    integrity = false) {
  const fail = (message) => store._contextFailure(message,
    integrity ? 'context_source_attestation_integrity' : 'context_source_attestation_invalid',
    integrity);
  const fields = [
    'branch', 'coverage', 'itemCount', 'kind', 'nodeDigest', 'producerIdentity', 'proofDigest',
    'receiptDigest', 'schemaVersion', 'scopeDigest', 'sourceDigest', 'sourceRef', 'treeSha',
    ...(value?.schemaVersion === 2 ? [
      'gitObjectFormat', 'repoId', 'rootTreeOid', 'sourcePolicyDigest',
    ] : []),
  ];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== fields.sort().join(',')
    || ![1, 2].includes(value.schemaVersion)
    || value.kind !== 'baton.context_source_attestation'
    || value.producerIdentity !== deployment.referenceIdentity
    || value.treeSha !== manifest.tree.sha || value.nodeDigest !== manifest.workflow.node.digest
    || value.scopeDigest !== contextValueDigest([...(node.contextScope ?? node.pathScope)].sort())
    || value.branch !== branch.name || value.sourceRef !== branch.ref
    || value.sourceDigest !== branch.digest || value.itemCount !== branch.itemCount
    || !/^[a-f0-9]{64}$/u.test(value.proofDigest ?? '')
    || (value.schemaVersion === 2 && (
      value.repoId !== store._repoId || value.repoId !== manifest.repoId
      || value.gitObjectFormat !== 'sha1'
      || !/^[a-f0-9]{40}$/u.test(value.rootTreeOid ?? '')
      || !/^[a-f0-9]{64}$/u.test(value.sourcePolicyDigest ?? '')
    ))
    || !/^[a-f0-9]{64}$/u.test(value.receiptDigest ?? '')) {
    fail('Context source attestation is malformed or outside Plan authority');
  }
  const coverageFields = [
    'complete', 'excludedBinaryOrInvalidText', 'excludedOversizeFiles',
    'excludedSensitiveContent', 'excludedSensitivePaths', 'excludedUnsupportedTypes',
    'includedFiles', 'includedItems', 'listedEntries', 'outsideScopeEntries', 'scopedEntries',
  ];
  const coverage = value.coverage;
  const countFields = coverageFields.filter((field) => field !== 'complete');
  if (!coverage || typeof coverage !== 'object' || Array.isArray(coverage)
    || Object.keys(coverage).sort().join(',') !== coverageFields.sort().join(',')
    || coverage.complete !== true
    || countFields.some((field) => !Number.isSafeInteger(coverage[field]) || coverage[field] < 0)
    || coverage.includedItems !== branch.itemCount
    || coverage.listedEntries !== coverage.outsideScopeEntries + coverage.scopedEntries
    || coverage.scopedEntries !== coverage.includedFiles
      + coverage.excludedBinaryOrInvalidText + coverage.excludedOversizeFiles
      + coverage.excludedSensitiveContent + coverage.excludedSensitivePaths
      + coverage.excludedUnsupportedTypes) {
    fail('Context source attestation coverage is malformed');
  }
  const { receiptDigest, ...core } = value;
  if (receiptDigest !== contextValueDigest(core)) {
    fail('Context source attestation receipt digest changed');
  }
  if (source !== null) {
    if (!Array.isArray(source) || contextValueDigest(source) !== branch.digest
      || source.length !== branch.itemCount) {
      fail('Context source attestation content differs from its branch');
    }
    const coordinates = [];
    const files = new Map();
    let priorPath = null;
    let priorChunk = -1;
    for (const item of source) {
      const itemFields = [
        'byteEnd', 'byteStart', 'chunk', 'contentDigest', 'gitBlobOid', 'language',
        'path', 'text',
        ...(value.schemaVersion === 2 ? ['blobBytes', 'gitMode'] : []),
      ];
      if (!item || typeof item !== 'object' || Array.isArray(item)
        || Object.keys(item).sort().join(',') !== itemFields.sort().join(',')
        || !boundedText(item.path, 4_096) || item.path.startsWith('/')
        || item.path.includes('\\') || item.path.split('/').includes('..')
        || !Number.isSafeInteger(item.chunk) || item.chunk < 0
        || !Number.isSafeInteger(item.byteStart) || item.byteStart < 0
        || !Number.isSafeInteger(item.byteEnd) || item.byteEnd <= item.byteStart
        || Buffer.byteLength(item.text ?? '') !== item.byteEnd - item.byteStart
        || !/^[a-f0-9]{40}$/u.test(item.gitBlobOid ?? '')
        || !/^[a-f0-9]{64}$/u.test(item.contentDigest ?? '')
        || (value.schemaVersion === 2 && (
          !['100644', '100755'].includes(item.gitMode)
          || !Number.isSafeInteger(item.blobBytes) || item.blobBytes <= 0
          || item.byteEnd > item.blobBytes
        ))
        || !boundedText(item.language, 128)) {
        fail('Context source attestation item is malformed');
      }
      if (priorPath !== null && (item.path < priorPath
        || (item.path === priorPath && item.chunk <= priorChunk))) {
        fail('Context source attestation items are not canonically ordered');
      }
      priorPath = item.path;
      priorChunk = item.chunk;
      const scopeAllows = pathInScopes(item.path, node.contextScope ?? node.pathScope);
      if (!scopeAllows) fail('Context source attestation item escaped Plan path scope');
      const file = files.get(item.path) ?? {
        gitBlobOid: item.gitBlobOid, contentDigest: item.contentDigest,
        gitMode: item.gitMode ?? null, blobBytes: item.blobBytes ?? null,
        nextChunk: 0, nextByte: 0, text: '',
      };
      if (item.gitBlobOid !== file.gitBlobOid || item.contentDigest !== file.contentDigest
        || (value.schemaVersion === 2
          && (item.gitMode !== file.gitMode || item.blobBytes !== file.blobBytes))
        || item.chunk !== file.nextChunk || item.byteStart !== file.nextByte) {
        fail('Context source attestation file coordinates are discontinuous');
      }
      file.nextChunk += 1;
      file.nextByte = item.byteEnd;
      file.text += item.text;
      files.set(item.path, file);
      coordinates.push({
        path: item.path, chunk: item.chunk,
        ...(value.schemaVersion === 2 ? {
          gitMode: item.gitMode, gitBlobOid: item.gitBlobOid, blobBytes: item.blobBytes,
        } : { gitBlobOid: item.gitBlobOid }),
        byteStart: item.byteStart, byteEnd: item.byteEnd, contentDigest: item.contentDigest,
      });
    }
    for (const file of files.values()) {
      const bytes = Buffer.from(file.text);
      const gitBlobOid = createHash('sha1')
        .update(Buffer.from(`blob ${bytes.byteLength}\0`)).update(bytes).digest('hex');
      if (gitBlobOid !== file.gitBlobOid || contextValueDigest(file.text) !== file.contentDigest
        || (value.schemaVersion === 2 && bytes.byteLength !== file.blobBytes)) {
        fail('Context source attestation blob content failed identity');
      }
    }
    if (contextValueDigest(coordinates) !== value.proofDigest) {
      fail('Context source attestation coordinate proof changed');
    }
  }
  return freeze(clone(value));
}

export function _assertContextSessionCurrent(store, session, integrity = false) {
  const manifest = session?.manifest;
  const deployment = store._normalizeContextDeployment(session?.deployment, integrity);
  if (!manifest || manifest.tree.source !== 'deployment_snapshot'
    || manifest.tree.sha !== deployment.deploymentBaseSha
    || session.environmentDigest !== deployment.environmentDigest
    || manifest.policyDigest !== deployment.policy.policyDigest
    || (!integrity && canonicalDigest(deployment)
      !== canonicalDigest(store._currentContextDeployment()))) {
    store._contextFailure('Context session tree, environment, or policy is stale',
      integrity ? 'context_session_integrity' : 'context_session_stale', integrity);
  }
  // REPL-1 rule 12: the cell-admission currency gate for a ReplManifest session keys on the
  // settled admission record, not a working Plan-gated dispatch. `admitContextCell`'s
  // caller-principal pin (canonicalDigest(authority) !== session.authority) then remains the
  // load-bearing authorization: only the admitting principal may compute REPL cells.
  if (manifest.kind === 'baton.repl_manifest') {
    const admission = store._replManifestAdmissions.get(session.manifestDigest);
    if (!admission || admission.runId !== session.runId
      || admission.replRole !== manifest.repl.replRole) {
      store._contextFailure('Context REPL session admission is stale',
        integrity ? 'context_session_integrity' : 'context_session_stale', integrity);
    }
    store._assertRunAdmissionOpen(session.runId, integrity);
    return freeze({ goal: null, plan: null, node: null, task: null });
  }
  const goal = store._goals.get(store._goalVersionKey(
    manifest.workflow.goal.goalId, manifest.workflow.goal.version,
  ));
  const plan = store._plans.get(store._planVersionKey(
    manifest.workflow.plan.planId, manifest.workflow.plan.version,
  ));
  const goalHead = store._goalHeads.get(store._goalScopeKey(store._repoId, session.runId));
  const planHead = goal ? store._planHeads.get(store._planHeadKey(goal)) : null;
  const approval = plan
    ? store._planApprovals.get(store._planVersionKey(plan.planId, plan.version)) : null;
  if (!goal || !plan
    || goal.digest !== manifest.workflow.goal.digest
    || plan.digest !== manifest.workflow.plan.digest
    || goal.repoId !== store._repoId || goal.runId !== session.runId
    || plan.repoId !== store._repoId || plan.runId !== session.runId
    || canonicalDigest(plan.goal) !== canonicalDigest(manifest.workflow.goal)
    || goalHead?.digest !== goal.digest || planHead?.digest !== plan.digest
    || approval?.disposition !== 'approved') {
    store._contextFailure('Context session Goal or Plan authority is stale',
      integrity ? 'context_session_integrity' : 'context_session_stale', integrity);
  }
  store._contextDefinition(manifest, integrity);
  const node = plan.nodes.find((candidate) => candidate.key === manifest.workflow.node.key);
  const task = store._tasks.get(manifest.workflow.task.taskId);
  const dispatch = store._planTaskLinks.get(manifest.workflow.task.taskId);
  if (!node || contextValueDigest(node) !== manifest.workflow.node.digest
    || !task || task.runId !== session.runId || task.status !== 'working'
    || task.version !== manifest.workflow.task.version
    || task.createdEvent !== manifest.workflow.task.createdEvent
    || task.claimedEvent !== manifest.workflow.task.claimedEvent
    || dispatch?.binding?.planId !== plan.planId
    || dispatch?.binding?.planVersion !== plan.version
    || dispatch?.binding?.planDigest !== plan.digest
    || dispatch?.binding?.nodeKey !== node.key) {
    store._contextFailure('Context session node or claimed task authority is stale',
      integrity ? 'context_session_integrity' : 'context_session_stale', integrity);
  }
  store._assertRunAdmissionOpen(session.runId, integrity);
  return freeze({ goal, plan, node, task });
}

export function _validateContextSessionPayload(store, payload, event, integrity = false) {
  if (!store._contextProgramPolicy) {
    store._contextFailure('Context Program authority is unavailable',
      'context_session_unavailable', integrity);
  }
  const fields = [
    'admissionDigest', 'authority', 'deployment', 'requestDigest', 'schemaVersion', 'session',
    ...(payload?.schemaVersion === 2 ? ['sourceAttestations'] : []),
  ];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).sort().join(',') !== fields.sort().join(',')
    || ![1, 2].includes(payload.schemaVersion)
    || !payload.authority || typeof payload.authority !== 'object'
    || Array.isArray(payload.authority)
    || Object.keys(payload.authority).sort().join(',')
      !== ['actor', 'principalId', 'repoId', 'runId'].sort().join(',')) {
    store._contextFailure('Context session event is malformed', 'context_session_integrity', integrity);
  }
  try { normalizeContextAuthority(payload.authority); }
  catch (error) {
    store._contextFailure(error.message,
      integrity ? 'context_session_integrity' : 'context_session_invalid', integrity);
  }
  const deployment = store._normalizeContextDeployment(payload.deployment, integrity);
  let session;
  try {
    session = contextSessionIdentity({
      manifest: payload.session?.manifest,
      environmentDigest: payload.session?.environmentDigest,
      policy: deployment.policy,
    });
  } catch (error) {
    store._contextFailure(error.message, integrity ? 'context_session_integrity' : 'context_session_invalid',
      integrity);
  }
  const expectedSession = { ...session };
  const requestCore = {
    actor: payload.authority.actor, principalId: payload.authority.principalId,
    repoId: payload.authority.repoId,
    runId: payload.authority.runId,
    manifestDigest: session.manifestDigest,
    environmentDigest: session.environmentDigest,
  };
  const admissionCore = {
    authority: payload.authority, deployment, session: expectedSession,
    ...(payload.schemaVersion === 2 ? { sourceAttestations: payload.sourceAttestations } : {}),
  };
  if (payload.authority.repoId !== store._repoId
    || payload.authority.runId !== session.runId
    || session.repoId !== store._repoId
    || payload.requestDigest !== canonicalDigest(requestCore)
    || payload.admissionDigest !== canonicalDigest(admissionCore)
    || canonicalDigest(payload.session) !== canonicalDigest(expectedSession)
    || canonicalDigest(payload.deployment) !== canonicalDigest(deployment)
    || event.idempotencyKey !== `context.session:${session.manifestDigest}`
    || event.actor !== payload.authority.actor) {
    store._contextFailure('Context session authority or identity changed',
      integrity ? 'context_session_integrity' : 'context_session_invalid', integrity);
  }
  const manifest = session.manifest;
  if (manifest.tree.source !== 'deployment_snapshot'
    || manifest.tree.sha !== deployment.deploymentBaseSha
    || session.environmentDigest !== deployment.environmentDigest
    || manifest.policyDigest !== deployment.policy.policyDigest
    || (!integrity && canonicalDigest(deployment)
      !== canonicalDigest(store._currentContextDeployment()))) {
    store._contextFailure('Context session tree, environment, or policy differs from deployment authority',
      integrity ? 'context_session_integrity' : 'context_session_invalid', integrity);
  }
  // REPL-1 rule 10a: a ReplManifest session skips the Workflow goal/plan/approval and
  // node/task/dispatch blocks entirely and is instead grounded by its settled
  // `repl.manifest_admitted` record (which folds at a lower seq, so this is replay-derivable).
  if (manifest.kind === 'baton.repl_manifest') {
    const admission = store._replManifestAdmissions.get(session.manifestDigest);
    if (!admission || admission.runId !== session.runId
      || admission.replRole !== manifest.repl.replRole
      || admission.principal?.actor !== payload.authority.actor
      || admission.principal?.principalId !== payload.authority.principalId) {
      store._contextFailure('Context REPL session has no settled manifest admission',
        integrity ? 'context_session_integrity' : 'context_session_invalid', integrity);
    }
    store._assertRunAdmissionOpen(session.runId, integrity);
    return freeze({
      session: freeze({ ...session, deployment, sourceAttestations: [] }),
      requestCore, admissionCore,
    });
  }
  const goal = store._goals.get(store._goalVersionKey(
    manifest.workflow.goal.goalId, manifest.workflow.goal.version,
  ));
  const plan = store._plans.get(store._planVersionKey(
    manifest.workflow.plan.planId, manifest.workflow.plan.version,
  ));
  const goalHead = store._goalHeads.get(store._goalScopeKey(store._repoId, session.runId));
  const planHead = goal ? store._planHeads.get(store._planHeadKey(goal)) : null;
  const approval = plan ? store._planApprovals.get(store._planVersionKey(plan.planId, plan.version)) : null;
  if (!goal || !plan
    || goal.digest !== manifest.workflow.goal.digest
    || plan.digest !== manifest.workflow.plan.digest
    || goal.repoId !== store._repoId || goal.runId !== session.runId
    || plan.repoId !== store._repoId || plan.runId !== session.runId
    || canonicalDigest(plan.goal) !== canonicalDigest(manifest.workflow.goal)
    || goalHead?.digest !== goal.digest || planHead?.digest !== plan.digest
    || approval?.disposition !== 'approved') {
    store._contextFailure('Context session Goal or Plan authority is stale',
      integrity ? 'context_session_integrity' : 'context_session_invalid', integrity);
  }
  store._contextDefinition(manifest, integrity);
  const node = plan.nodes.find((candidate) => candidate.key === manifest.workflow.node.key);
  const task = store._tasks.get(manifest.workflow.task.taskId);
  const dispatch = store._planTaskLinks.get(manifest.workflow.task.taskId);
  if (!node || contextValueDigest(node) !== manifest.workflow.node.digest
    || !task || task.runId !== session.runId || task.status !== 'working'
    || task.version !== manifest.workflow.task.version
    || task.createdEvent !== manifest.workflow.task.createdEvent
    || task.claimedEvent !== manifest.workflow.task.claimedEvent
    || dispatch?.binding?.planId !== plan.planId
    || dispatch?.binding?.planVersion !== plan.version
    || dispatch?.binding?.planDigest !== plan.digest
    || dispatch?.binding?.nodeKey !== node.key) {
    store._contextFailure('Context session node or claimed task authority changed',
      integrity ? 'context_session_integrity' : 'context_session_invalid', integrity);
  }
  let sourceAttestations = [];
  if (payload.schemaVersion === 2) {
    if (!Array.isArray(payload.sourceAttestations)
      || payload.sourceAttestations.length !== manifest.branches.length) {
      store._contextFailure('Context session source attestations are incomplete',
        integrity ? 'context_session_integrity' : 'context_session_invalid', integrity);
    }
    sourceAttestations = manifest.branches.map((branch, index) => (
      store._normalizeContextSourceAttestation(payload.sourceAttestations[index], {
        deployment, manifest, node, branch,
      }, integrity)
    ));
  }
  store._assertRunAdmissionOpen(session.runId, integrity);
  return freeze({
    session: freeze({ ...session, deployment, sourceAttestations }),
    requestCore, admissionCore,
  });
}

export function _validateContextCellAdmissionPayload(store, payload, event, integrity = false) {
  const fields = ['admissionDigest', 'authority', 'cell', 'requestDigest', 'schemaVersion'];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).sort().join(',') !== fields.sort().join(',')
    || payload.schemaVersion !== 1
    || !payload.authority || typeof payload.authority !== 'object'
    || Array.isArray(payload.authority)
    || Object.keys(payload.authority).sort().join(',')
      !== ['actor', 'principalId', 'repoId', 'runId'].sort().join(',')) {
    store._contextFailure('Context cell admission is malformed',
      'context_cell_integrity', integrity);
  }
  try { normalizeContextAuthority(payload.authority); }
  catch (error) {
    store._contextFailure(error.message,
      integrity ? 'context_cell_integrity' : 'context_cell_invalid', integrity);
  }
  const session = store._contextSessions.get(payload.cell?.sessionId);
  if (!session) store._contextFailure('Context cell session is unavailable',
    integrity ? 'context_cell_integrity' : 'context_cell_invalid', integrity);
  let cell;
  const contextPolicy = store._normalizeContextDeployment(session.deployment, integrity).policy;
  try {
    cell = contextCellIdentity({
      session, program: payload.cell?.program, ordinal: payload.cell?.ordinal,
      predecessor: payload.cell?.predecessor ?? null, policy: contextPolicy,
    });
  } catch (error) {
    store._contextFailure(error.message, integrity ? 'context_cell_integrity' : 'context_cell_invalid',
      integrity);
  }
  const requestCore = {
    actor: payload.authority.actor, principalId: payload.authority.principalId,
    repoId: payload.authority.repoId,
    runId: payload.authority.runId,
    sessionId: session.sessionId,
    programDigest: cell.programDigest,
  };
  if (canonicalDigest(payload.authority) !== canonicalDigest(session.authority)) {
    store._contextFailure('Context cell principal differs from session admission',
      integrity ? 'context_cell_integrity' : 'context_cell_unauthorized', integrity);
  }
  if (payload.authority.repoId !== store._repoId || payload.authority.runId !== session.runId
    || payload.requestDigest !== canonicalDigest(requestCore)
    || payload.admissionDigest !== cell.admissionDigest
    || canonicalDigest(payload.cell) !== canonicalDigest(cell)
    || event.idempotencyKey !== `context.cell:${session.sessionId}:${cell.programDigest}`
    || event.actor !== payload.authority.actor
    || !contextProgramIsPure(cell.program, contextPolicy)) {
    store._contextFailure('Context cell authority or identity changed',
      integrity ? 'context_cell_integrity' : 'context_cell_invalid', integrity);
  }
  const cells = [...store._contextCells.values()].filter((row) => row.sessionId === session.sessionId);
  const expectedOrdinal = cells.length + 1;
  const expectedPredecessor = cells.length === 0 ? null : cells.at(-1).cellId;
  if (cell.ordinal !== expectedOrdinal || cell.predecessor !== expectedPredecessor
    || cells.length >= contextPolicy.maxCellsPerSession) {
    store._contextFailure('Context cell sequence is stale or exhausted',
      integrity ? 'context_cell_integrity' : 'context_cell_invalid', integrity);
  }
  store._assertContextSessionCurrent(session, integrity);
  return cell;
}

export function _validateContextCellSettlementPayload(store, payload, event, integrity = false) {
  const fields = [
    'authority', 'cellId', 'expectedVersion', 'newVersion', 'result', 'schemaVersion',
    'settlementDigest',
  ];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).sort().join(',') !== fields.sort().join(',')
    || payload.schemaVersion !== 1 || payload.expectedVersion !== 1 || payload.newVersion !== 2
    || !payload.result || typeof payload.result !== 'object' || Array.isArray(payload.result)
    || !payload.authority || typeof payload.authority !== 'object'
    || Array.isArray(payload.authority)
    || Object.keys(payload.authority).sort().join(',')
      !== ['actor', 'principalId', 'repoId', 'runId'].sort().join(',')) {
    store._contextFailure('Context cell settlement is malformed',
      'context_cell_settlement_integrity', integrity);
  }
  try { normalizeContextAuthority(payload.authority); }
  catch (error) {
    store._contextFailure(error.message,
      integrity ? 'context_cell_settlement_integrity' : 'context_cell_settlement_invalid', integrity);
  }
  const cell = store._contextCells.get(payload.cellId);
  if (!cell || cell.state !== 'admitted' || cell.version !== payload.expectedVersion) {
    store._contextFailure('Context cell settlement target is stale',
      integrity ? 'context_cell_settlement_integrity' : 'context_cell_settlement_invalid', integrity);
  }
  if (canonicalDigest(payload.authority) !== canonicalDigest(cell.authority)
    || event.actor !== payload.authority.actor) {
    store._contextFailure('Context cell settlement principal differs from admission',
      integrity ? 'context_cell_settlement_integrity'
        : 'context_cell_settlement_unauthorized', integrity);
  }
  const session = store._contextSessions.get(cell.sessionId);
  const contextPolicy = store._normalizeContextDeployment(session?.deployment, integrity).policy;
  let expectedResult;
  try {
    if (payload.result.state === 'completed') {
      const resultFields = [
        'coordinateDigest', 'evidenceRef', 'outputRef', 'providerEffects',
        'sourceCoordinateCount', 'state',
      ];
      if (Object.keys(payload.result).sort().join(',') !== resultFields.sort().join(',')
        || payload.result.providerEffects !== 0
        || !Number.isSafeInteger(payload.result.sourceCoordinateCount)
        || payload.result.sourceCoordinateCount < 0
        || payload.result.sourceCoordinateCount > contextPolicy.maxEvidenceCoordinates
        || !/^[a-f0-9]{64}$/u.test(payload.result.coordinateDigest ?? '')) {
        throw new TypeError('Context completion result is invalid');
      }
      const outputRef = normalizeContextArtifactRef(
        payload.result.outputRef, 'context_value', contextPolicy,
      );
      const evidenceRef = normalizeContextArtifactRef(
        payload.result.evidenceRef, 'context_evidence', contextPolicy,
      );
      expectedResult = { ...payload.result, outputRef, evidenceRef };
    } else {
      const resultFields = ['providerEffects', 'state', 'termination'];
      const termination = payload.result.termination;
      if (!['failed', 'attention', 'stopped'].includes(payload.result.state)
        || Object.keys(payload.result).sort().join(',') !== resultFields.sort().join(',')
        || payload.result.providerEffects !== 0
        || !termination || typeof termination !== 'object' || Array.isArray(termination)
        || Object.keys(termination).sort().join(',') !== ['code', 'retryable', 'summary'].sort().join(',')
        || !/^[a-z0-9_:-]{1,128}$/u.test(termination.code ?? '')
        || !boundedText(termination.summary, 1_024)
        || typeof termination.retryable !== 'boolean') {
        throw new TypeError('Context terminal result is invalid');
      }
      expectedResult = clone(payload.result);
    }
  } catch (error) {
    store._contextFailure(error.message,
      integrity ? 'context_cell_settlement_integrity' : 'context_cell_settlement_invalid', integrity);
  }
  const settlementCore = {
    authority: payload.authority,
    cellId: cell.cellId, admissionDigest: cell.admissionDigest,
    expectedVersion: 1, newVersion: 2, result: expectedResult,
  };
  if (payload.settlementDigest !== canonicalDigest(settlementCore)
    || event.idempotencyKey !== `context.cell.settle:${cell.cellId}:${cell.admissionDigest}`) {
    store._contextFailure('Context cell settlement identity changed',
      integrity ? 'context_cell_settlement_integrity' : 'context_cell_settlement_invalid', integrity);
  }
  return freeze({ cell, result: freeze(clone(expectedResult)), settlementCore });
}

export function _validateContextMapCallAdmissionPayload(store, payload, event, integrity = false) {
  const fields = [
    'admissionDigest', 'authority', 'call', 'expectedPlanDigest', 'planRequest',
    'requestDigest', 'schemaVersion',
  ];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).sort().join(',') !== fields.sort().join(',')
    || payload.schemaVersion !== 1
    || !payload.authority || typeof payload.authority !== 'object'
    || Array.isArray(payload.authority)
    || Object.keys(payload.authority).sort().join(',')
      !== ['actor', 'principalId', 'repoId', 'runId'].sort().join(',')) {
    store._contextFailure('Context map call admission is malformed',
      'context_map_call_integrity', integrity);
  }
  let authority; let call;
  try {
    authority = normalizeContextAuthority(payload.authority);
    call = normalizeContextMapCall(payload.call);
  } catch (error) {
    store._contextFailure(error.message,
      integrity ? 'context_map_call_integrity' : 'context_map_call_invalid', integrity);
  }
  const source = call.source;
  const session = store._contextSessions.get(source.sessionId);
  const cell = store._contextCells.get(source.cellId);
  if (!session || !cell || cell.sessionId !== session.sessionId || cell.state !== 'completed'
    || !cell.result || authority.repoId !== store._repoId || authority.runId !== source.runId
    || canonicalDigest(authority) !== canonicalDigest(cell.authority)
    || source.repoId !== store._repoId || source.runId !== session.runId
    || source.cellAdmissionDigest !== cell.admissionDigest
    || source.cellSettlementDigest !== cell.settlementDigest
    || source.manifestDigest !== session.manifestDigest
    || source.sourceProgramDigest !== cell.programDigest
    || source.coordinateDigest !== cell.result.coordinateDigest
    || canonicalDigest(source.outputRef) !== canonicalDigest(cell.result.outputRef)
    || canonicalDigest(source.evidenceRef) !== canonicalDigest(cell.result.evidenceRef)
    || source.predecessorPlan.planId !== session.manifest.workflow.plan.planId
    || source.predecessorPlan.version !== session.manifest.workflow.plan.version
    || source.predecessorPlan.digest !== session.manifest.workflow.plan.digest
    || source.definitionDigest !== session.manifest.workflow.definitionDigest
    || source.treeSha !== session.manifest.tree.sha
    || source.environmentDigest !== session.environmentDigest
    || source.policyDigest !== session.policyDigest) {
    store._contextFailure('Context map source authority changed',
      integrity ? 'context_map_call_integrity' : 'context_map_source_stale', integrity);
  }

  // The source Context session is current at call admission. The successor Plan deliberately
  // advances the head immediately afterward, so replay/recovery must validate these historical
  // coordinates rather than call _assertContextSessionCurrent after proposal.
  const predecessor = store._plans.get(store._planVersionKey(
    source.predecessorPlan.planId, source.predecessorPlan.version,
  ));
  const goal = predecessor ? store._goals.get(store._goalVersionKey(
    predecessor.goal.goalId, predecessor.goal.version,
  )) : null;
  const goalHead = goal ? store._goalHeads.get(store._goalScopeKey(store._repoId, source.runId)) : null;
  const planHead = goal ? store._planHeads.get(store._planHeadKey(goal)) : null;
  if (!predecessor || predecessor.digest !== source.predecessorPlan.digest || !goal
    || goalHead?.digest !== goal.digest || planHead?.digest !== predecessor.digest) {
    store._contextFailure('Context map predecessor is not the current Plan head',
      integrity ? 'context_map_call_integrity' : 'context_map_predecessor_stale', integrity);
  }

  let normalizedPlan;
  try {
    if (!payload.planRequest || typeof payload.planRequest !== 'object'
      || Array.isArray(payload.planRequest)
      || Object.keys(payload.planRequest).sort().join(',')
        !== ['goal', 'nodes', 'predecessor', 'totals'].sort().join(',')) {
      throw new GoalPlanValidationError('Context map normalized Plan request is malformed',
        'context_map_plan_invalid');
    }
    normalizedPlan = normalizePlanRequest({
      goal: payload.planRequest.goal,
      predecessor: payload.planRequest.predecessor,
      nodes: payload.planRequest.nodes,
    }, store._goalPlanPolicy, goal, { preserveLegacyRoutes: integrity });
    if (canonicalDigest(payload.planRequest.totals) !== canonicalDigest(normalizedPlan.totals)) {
      throw new GoalPlanValidationError('Context map Plan totals changed',
        'context_map_plan_invalid');
    }
  }
  catch (error) {
    store._contextFailure(error.message,
      integrity ? 'context_map_call_integrity' : (error.code ?? 'context_map_plan_invalid'), integrity);
  }
  const expectedPlanDigest = goalPlanDigest({
    schemaVersion: 1, repoId: store._repoId, runId: source.runId,
    goal: normalizedPlan.goal, predecessor: normalizedPlan.predecessor,
    nodes: normalizedPlan.nodes, totals: normalizedPlan.totals,
    policyDigest: store._goalPlanPolicy.policyDigest,
  });
  if (payload.expectedPlanDigest !== expectedPlanDigest
    || normalizedPlan.predecessor?.planId !== predecessor.planId
    || normalizedPlan.predecessor?.version !== predecessor.version
    || normalizedPlan.predecessor?.digest !== predecessor.digest
    || normalizedPlan.nodes.length !== call.partitions.length
    || normalizedPlan.nodes.length < 2
    || normalizedPlan.nodes.length > store._goalPlanPolicy.limits.maxNodes) {
    store._contextFailure('Context map successor Plan identity changed',
      integrity ? 'context_map_call_integrity' : 'context_map_plan_invalid', integrity);
  }
  const partitions = new Set();
  for (const node of normalizedPlan.nodes) {
    const binding = node.contextCall;
    if (!binding || binding.callId !== call.callId || binding.callDigest !== call.callDigest
      || binding.programDigest !== call.programDigest || binding.logicalRole !== call.role
      || binding.source.predecessorPlan.digest !== predecessor.digest
      || canonicalDigest(binding.source) !== canonicalDigest(call.source)) {
      store._contextFailure('Context map Plan node differs from its admitted call',
        integrity ? 'context_map_call_integrity' : 'context_map_plan_invalid', integrity);
    }
    let expectedBinding;
    try { expectedBinding = contextMapNodeBinding(call, binding.partition); }
    catch (error) {
      store._contextFailure(error.message,
        integrity ? 'context_map_call_integrity' : 'context_map_plan_invalid', integrity);
    }
    if (canonicalDigest(binding) !== canonicalDigest(expectedBinding)
      || partitions.has(binding.partition.partitionId)) {
      store._contextFailure('Context map partition binding changed or repeated',
        integrity ? 'context_map_call_integrity' : 'context_map_plan_invalid', integrity);
    }
    partitions.add(binding.partition.partitionId);
  }
  if (partitions.size !== call.partitions.length
    || call.partitions.some(({ partitionId }) => !partitions.has(partitionId))) {
    store._contextFailure('Context map Plan does not cover the exact partition set',
      integrity ? 'context_map_call_integrity' : 'context_map_plan_invalid', integrity);
  }

  const prefix = store._events.filter((candidate) => candidate.seq < event.seq);
  const sourceDefinitions = prefix.filter((candidate) => candidate.kind === 'driver.recorded'
    && candidate.payload?.kind === 'application.workflow_definition_bound'
    && candidate.payload?.repoId === store._repoId
    && candidate.payload?.runId === source.runId
    && candidate.payload?.planDigest === predecessor.digest
    && candidate.payload?.definitionDigest === source.definitionDigest);
  const successorDefinitions = prefix.filter((candidate) => candidate.kind === 'driver.recorded'
    && candidate.payload?.kind === 'application.workflow_definition_bound'
    && candidate.payload?.repoId === store._repoId
    && candidate.payload?.runId === source.runId
    && candidate.payload?.planDigest === expectedPlanDigest);
  if (sourceDefinitions.length !== 1 || successorDefinitions.length !== 1) {
    store._contextFailure('Context map Workflow definition binding is absent or ambiguous',
      integrity ? 'context_map_call_integrity' : 'context_map_definition_invalid', integrity);
  }
  const sourceDefinitionEvent = sourceDefinitions[0];
  const successorDefinitionEvent = successorDefinitions[0];
  if (sourceDefinitionEvent.actor !== 'application:workflow-registry'
    || sourceDefinitionEvent.idempotencyKey
      !== `application.workflow_definition_bound:${source.runId}:${predecessor.digest}`
    || successorDefinitionEvent.actor !== 'application:workflow-registry'
    || successorDefinitionEvent.idempotencyKey
      !== `application.workflow_definition_bound:${source.runId}:${expectedPlanDigest}`) {
    store._contextFailure('Context map Workflow definition authority is invalid',
      integrity ? 'context_map_call_integrity' : 'context_map_definition_invalid', integrity);
  }
  const sourceDefinition = sourceDefinitionEvent.payload;
  const successorDefinition = successorDefinitionEvent.payload;
  if (successorDefinition.schemaVersion === 3) {
    const ancestry = prefix.filter((candidate) => (
      candidate.kind === 'driver.recorded'
        && candidate.payload?.kind === 'application.workflow_definition_bound'
        && candidate.payload?.repoId === store._repoId
        && candidate.payload?.runId === source.runId
    )).map((candidate) => candidate.payload);
    let sourceCatalog;
    try {
      if (sourceDefinition.schemaVersion === 3) {
        validateWorkflowDefinitionV3(sourceDefinition, {
          nodes: predecessor.nodes,
          ancestors: ancestry.filter((candidate) => (
            candidate.definitionDigest !== sourceDefinition.definitionDigest
          )),
        });
        sourceCatalog = sourceDefinition.roleCatalog;
      } else {
        normalizeWorkflowDefinition(sourceDefinition, { nodes: predecessor.nodes });
        if (!Array.isArray(sourceDefinition.attempts)
          || sourceDefinition.attempts.length !== predecessor.nodes.length) {
          throw new TypeError('Historical Workflow Attempt set does not cover its exact Plan');
        }
        const nodesByKey = new Map(predecessor.nodes.map((node) => [node.key, node]));
        const boundNodes = new Set();
        sourceCatalog = buildWorkflowRoleCatalog(sourceDefinition.attempts.map((attempt) => {
          const node = nodesByKey.get(attempt?.nodeKey);
          const route = attempt?.route ?? null;
          if (!node || boundNodes.has(node.key)
            || !planRouteMatches(node.routes, route)
            || canonicalDigest(attempt.route) !== canonicalDigest(route)) {
            throw new TypeError('Historical Workflow Attempt differs from its exact Plan node');
          }
          boundNodes.add(node.key);
          return { role: attempt.role, route: attempt.route, node };
        }));
        if (boundNodes.size !== predecessor.nodes.length) {
          throw new TypeError('Historical Workflow Attempt set does not cover its exact Plan');
        }
      }
      validateWorkflowDefinitionV3(successorDefinition, {
        nodes: normalizedPlan.nodes,
        ancestors: ancestry.filter((candidate) => (
          candidate.definitionDigest !== successorDefinition.definitionDigest
        )),
      });
    } catch (error) {
      store._contextFailure(error.message,
        integrity ? 'context_map_call_integrity'
          : (error.code ?? 'context_map_definition_invalid'), integrity);
    }
    const sourceRole = sourceDefinition.schemaVersion === 3
      ? workflowCatalogRole(sourceDefinition, call.role)
      : sourceCatalog.roles.find((role) => role.role === call.role) ?? null;
    const expectedGeneration = sourceDefinition.schemaVersion === 3
      ? sourceDefinition.lineage.generation + 1 : 2;
    const expectedRoot = sourceDefinition.schemaVersion === 3
      && sourceDefinition.lineage.generation > 1
      ? sourceDefinition.lineage.rootDefinitionDigest : sourceDefinition.definitionDigest;
    const sourcePolicyDigest = sourceDefinition.schemaVersion === 3
      ? sourceDefinition.workflowPolicyDigest
      : sourceDefinition.schemaVersion === 2
        ? sourceDefinition.workflowPolicyDigest : LEGACY_WORKFLOW_POLICY.policyDigest;
    if (!sourceRole || sourceDefinition.profileDigest !== source.profileDigest
      || successorDefinition.profileDigest !== source.profileDigest
      || successorDefinition.workflowPolicyDigest !== sourcePolicyDigest
      || canonicalDigest(successorDefinition.workItem)
        !== canonicalDigest(sourceDefinition.workItem)
      || canonicalDigest(successorDefinition.roleCatalog)
        !== canonicalDigest(sourceCatalog)
      || successorDefinition.lineage.generation !== expectedGeneration
      || successorDefinition.lineage.parentDefinitionDigest
        !== sourceDefinition.definitionDigest
      || successorDefinition.lineage.rootDefinitionDigest !== expectedRoot) {
      store._contextFailure('Context map logical role is outside Workflow authority',
        integrity ? 'context_map_call_integrity' : 'context_map_role_invalid', integrity);
    }
    const nodes = new Map(normalizedPlan.nodes.map((node) => [node.key, node]));
    for (const attempt of successorDefinition.attempts) {
      const node = nodes.get(attempt.nodeKey);
      const partitionIndex = node?.contextCall?.partition?.index;
      const expectedRole = Number.isSafeInteger(partitionIndex)
        ? `${call.role}:${String(partitionIndex + 1).padStart(4, '0')}` : null;
      const route = node ? workflowAttemptRoute(successorDefinition, attempt) : null;
      if (!node || attempt.logicalRole !== call.role
        || attempt.role !== expectedRole || node.key !== `attempt:${expectedRole}`
        || !planRouteMatches(node.routes, route)
        || canonicalDigest(workflowAttemptRoute(successorDefinition, attempt))
          !== canonicalDigest(route)
        || canonicalDigest(route) !== canonicalDigest(sourceRole.route)) {
        store._contextFailure('Context map route differs from the approved logical role',
          integrity ? 'context_map_call_integrity' : 'context_map_route_invalid', integrity);
      }
    }
  } else {
    if (sourceDefinition.schemaVersion === 3) {
      store._contextFailure('Context map Workflow definition cannot downgrade its schema',
        integrity ? 'context_map_call_integrity' : 'context_map_definition_invalid', integrity);
    }
    try {
      validateWorkflowDefinitionLegacy(sourceDefinition, { nodes: predecessor.nodes });
      validateWorkflowDefinitionLegacy(successorDefinition, { nodes: normalizedPlan.nodes });
    } catch (error) {
      store._contextFailure(error.message,
        integrity ? 'context_map_call_integrity'
          : (error.code ?? 'context_map_definition_invalid'), integrity);
    }
    const sourceAttempt = sourceDefinition.attempts?.find((attempt) => attempt.role === call.role);
    if (!sourceAttempt || sourceDefinition.profileDigest !== source.profileDigest
      || successorDefinition.profileDigest !== source.profileDigest
      || !Array.isArray(successorDefinition.attempts)
      || successorDefinition.attempts.length !== normalizedPlan.nodes.length) {
      store._contextFailure('Context map logical role is outside Workflow authority',
        integrity ? 'context_map_call_integrity' : 'context_map_role_invalid', integrity);
    }
    const nodes = new Map(normalizedPlan.nodes.map((node) => [node.key, node]));
    for (const attempt of successorDefinition.attempts) {
      const node = nodes.get(attempt.nodeKey);
      const partitionIndex = node?.contextCall?.partition?.index;
      const expectedRole = Number.isSafeInteger(partitionIndex)
        ? `${call.role}:${String(partitionIndex + 1).padStart(4, '0')}` : null;
      const route = attempt?.route ?? null;
      if (!node || attempt.role !== expectedRole || node.key !== `attempt:${expectedRole}`
        || !planRouteMatches(node.routes, route)
        || canonicalDigest(attempt.route) !== canonicalDigest(route)
        || canonicalDigest(attempt.route) !== canonicalDigest(sourceAttempt.route)) {
        store._contextFailure('Context map route differs from the approved logical role',
          integrity ? 'context_map_call_integrity' : 'context_map_route_invalid', integrity);
      }
    }
  }

  if (!integrity) {
    let output; let evidence;
    try {
      output = store._contextReferenceRead(cell.result.outputRef);
      evidence = store._contextReferenceRead(cell.result.evidenceRef);
    } catch (error) {
      store._contextFailure(error?.message ?? 'Context map source artifact is unavailable',
        error?.code ?? 'context_map_source_unavailable', false);
    }
    const verified = store._validateContextCompletionArtifacts(
      cell, cell.result, output, evidence, true,
    );
    if (call.schemaVersion !== 2 || verified.evidence.schemaVersion !== 2) {
      store._contextFailure(
        'Context map admission requires exact per-output source lineage',
        'context_output_lineage_required',
        false,
      );
    }
    const outputLineages = verified.evidence.outputLineages;
    if (!Array.isArray(verified.output.items)
      || !Array.isArray(outputLineages)
      || verified.output.items.length !== call.partitions.length
      || outputLineages.length !== call.partitions.length
      || call.source.outputLineageDigest !== verified.evidence.outputLineageDigest
      || call.partitions.some((partition) => (
        contextValueDigest(verified.output.items[partition.index]) !== partition.itemDigest
        || outputLineages[partition.index]?.itemDigest !== partition.itemDigest
        || outputLineages[partition.index]?.coordinateDigest !== partition.coordinateDigest
        || outputLineages[partition.index]?.lineageDigest !== partition.lineageDigest
      ))) {
      store._contextFailure('Context map partitions differ from the verified source cell',
        'context_map_partition_invalid', false);
    }
  }

  const requestCore = {
    authority, call, planRequest: normalizedPlan, expectedPlanDigest,
  };
  const admissionCore = { ...requestCore, sourceCellSettlementDigest: cell.settlementDigest };
  if (payload.requestDigest !== canonicalDigest(requestCore)
    || payload.admissionDigest !== canonicalDigest(admissionCore)
    || event.actor !== authority.actor
    || event.idempotencyKey !== `context.call:${call.callId}`) {
    store._contextFailure('Context map call admission identity changed',
      integrity ? 'context_map_call_integrity' : 'context_map_call_invalid', integrity);
  }
  store._assertRunAdmissionOpen(source.runId, integrity);
  return freeze({
    call, authority, planRequest: normalizedPlan, expectedPlanDigest,
    requestCore, admissionCore,
  });
}

export function _validateContextEffectCallAdmissionPayload(store, payload, event, integrity = false) {
  const fail = (message, code = 'context_call_invalid') => store._contextFailure(
    message, integrity ? 'context_call_integrity' : code, integrity,
  );
  const fields = [
    'admissionDigest', 'authority', 'call', 'expectedPlanDigest', 'planRequest',
    'requestDigest', 'schemaVersion',
  ];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).sort().join(',') !== fields.sort().join(',')
    || payload.schemaVersion !== 2) {
    return fail('Context effect-call admission is malformed');
  }
  let call; let admissionAuthority;
  try {
    call = normalizeContextEffectCall(payload.call);
    admissionAuthority = normalizeContextAuthority(payload.authority);
  }
  catch (error) { return fail(error.message, error.code ?? 'context_call_invalid'); }
  const authority = call.authority;
  const principal = authority.contextPrincipal;
  const runId = principal.runId;
  if (canonicalDigest(admissionAuthority) !== canonicalDigest(principal)
    || principal.repoId !== store._repoId || principal.actor !== 'deployment:context'
    || event.actor !== principal.actor
    || event.idempotencyKey !== `context.call:${call.callId}`) {
    return fail('Context effect-call principal authority changed',
      'context_call_unauthorized');
  }
  const session = store._contextSessions.get(authority.sessionId);
  if (!session || session.state !== 'active' || session.runId !== runId
    || canonicalDigest(session.authority) !== canonicalDigest(principal)
    || session.manifestDigest !== authority.manifestDigest
    || session.manifest.tree.sha !== authority.treeSha
    || session.environmentDigest !== authority.environmentDigest
    || session.policyDigest !== authority.policyDigest) {
    return fail('Context effect-call session authority changed',
      'context_call_authority_stale');
  }

  if (call.generation > 1) {
    const predecessorCall = store._contextCalls.get(call.predecessorCall.callId);
    let selection;
    try { selection = store._contextRetrySelection(call.predecessorCall.callId, integrity); }
    catch (error) { return fail(error.message, error.code ?? 'context_retry_not_eligible'); }
    const invariantAuthority = (candidate) => ({
      contextPrincipal: candidate.contextPrincipal,
      requester: {
        principalId: candidate.requester.principalId,
        sessionId: candidate.requester.sessionId,
      },
      sessionId: candidate.sessionId, manifestDigest: candidate.manifestDigest,
      treeSha: candidate.treeSha, environmentDigest: candidate.environmentDigest,
      policyDigest: candidate.policyDigest, profileDigest: candidate.profileDigest,
      roleCatalogDigest: candidate.roleCatalogDigest,
    });
    if (!predecessorCall || call.generation !== predecessorCall.generation + 1
      || call.predecessorCall.callDigest !== predecessorCall.callDigest
      || call.predecessorCall.generation !== predecessorCall.generation
      || call.predecessorCall.settlementDigest !== predecessorCall.settlementDigest
      || call.requestId !== predecessorCall.requestId
      || call.requestDigest !== predecessorCall.requestDigest
      || call.operator !== predecessorCall.operator
      || call.role !== predecessorCall.role || call.instruction !== predecessorCall.instruction
      || canonicalDigest(call.source) !== canonicalDigest(predecessorCall.source)
      || canonicalDigest(call.units) !== canonicalDigest(predecessorCall.units)
      || canonicalDigest(invariantAuthority(call.authority))
        !== canonicalDigest(invariantAuthority(predecessorCall.authority))
      || canonicalDigest(call.executionUnitIds)
        !== canonicalDigest(selection.retryUnitIds)
      || canonicalDigest(call.inheritedChildren)
        !== canonicalDigest(selection.inheritedChildren)
      || canonicalDigest(call.predecessorCall.retryUnitIds)
        !== canonicalDigest(selection.retryUnitIds)
      || canonicalDigest(call.predecessorCall.inheritedChildren)
        !== canonicalDigest(selection.inheritedChildren)) {
      return fail('Context retry generation differs from its exact terminal predecessor',
        'context_retry_integrity');
    }
  }

  const predecessorRef = authority.predecessorPlan;
  const predecessor = store._plans.get(store._planVersionKey(
    predecessorRef.planId, predecessorRef.version,
  ));
  const goal = predecessor ? store._goals.get(store._goalVersionKey(
    predecessor.goal.goalId, predecessor.goal.version,
  )) : null;
  const goalHead = goal ? store._goalHeads.get(store._goalScopeKey(store._repoId, runId)) : null;
  const planHead = goal ? store._planHeads.get(store._planHeadKey(goal)) : null;
  if (!predecessor || predecessor.digest !== predecessorRef.digest || !goal
    || predecessor.repoId !== store._repoId || predecessor.runId !== runId
    || goalHead?.digest !== goal.digest || planHead?.digest !== predecessor.digest) {
    return fail('Context effect-call predecessor is not the current Plan head',
      'context_call_predecessor_stale');
  }

  let normalizedPlan;
  try {
    if (!payload.planRequest || typeof payload.planRequest !== 'object'
      || Array.isArray(payload.planRequest)
      || Object.keys(payload.planRequest).sort().join(',')
        !== ['goal', 'nodes', 'predecessor', 'totals'].sort().join(',')) {
      throw new GoalPlanValidationError('Context effect-call normalized Plan request is malformed',
        'context_call_plan_invalid');
    }
    normalizedPlan = normalizePlanRequest({
      goal: payload.planRequest.goal,
      predecessor: payload.planRequest.predecessor,
      nodes: payload.planRequest.nodes,
    }, store._goalPlanPolicy, goal, { preserveLegacyRoutes: integrity });
    if (canonicalDigest(payload.planRequest.totals) !== canonicalDigest(normalizedPlan.totals)) {
      throw new GoalPlanValidationError('Context effect-call Plan totals changed',
        'context_call_plan_invalid');
    }
  } catch (error) {
    return fail(error.message, error.code ?? 'context_call_plan_invalid');
  }
  const expectedPlanDigest = goalPlanDigest({
    schemaVersion: 1, repoId: store._repoId, runId,
    goal: normalizedPlan.goal, predecessor: normalizedPlan.predecessor,
    nodes: normalizedPlan.nodes, totals: normalizedPlan.totals,
    policyDigest: store._goalPlanPolicy.policyDigest,
  });
  if (payload.expectedPlanDigest !== expectedPlanDigest
    || normalizedPlan.predecessor?.planId !== predecessor.planId
    || normalizedPlan.predecessor?.version !== predecessor.version
    || normalizedPlan.predecessor?.digest !== predecessor.digest
    || normalizedPlan.nodes.length !== call.executionUnitIds.length
    || normalizedPlan.nodes.length === 0
    || normalizedPlan.nodes.length > store._goalPlanPolicy.limits.maxNodes) {
    return fail('Context effect-call successor Plan identity changed',
      'context_call_plan_invalid');
  }
  const units = new Set();
  for (const node of normalizedPlan.nodes) {
    const binding = node.contextCall;
    if (!binding || binding.kind !== 'context_effect_child'
      || binding.callId !== call.callId || binding.callDigest !== call.callDigest
      || binding.requestId !== call.requestId || binding.requestDigest !== call.requestDigest
      || binding.logicalRole !== call.role || binding.operator !== call.operator
      || canonicalDigest(binding.source) !== canonicalDigest(call.source)) {
      return fail('Context effect-call Plan node differs from its admitted call',
        'context_call_plan_invalid');
    }
    let expectedBinding;
    try { expectedBinding = contextEffectNodeBinding(call, binding.unit); }
    catch (error) { return fail(error.message, 'context_call_plan_invalid'); }
    if (canonicalDigest(binding) !== canonicalDigest(expectedBinding)
      || units.has(binding.unit.unitId)) {
      return fail('Context effect-call unit binding changed or repeated',
        'context_call_plan_invalid');
    }
    units.add(binding.unit.unitId);
  }
  if (units.size !== call.executionUnitIds.length
    || call.executionUnitIds.some((unitId) => !units.has(unitId))) {
    return fail('Context effect-call Plan does not cover the exact execution unit set',
      'context_call_plan_invalid');
  }

  const prefix = store._events.filter((candidate) => candidate.seq < event.seq);
  const definitions = prefix.filter((candidate) => (
    candidate.kind === 'driver.recorded'
      && candidate.payload?.kind === 'application.workflow_definition_bound'
      && candidate.payload?.repoId === store._repoId
      && candidate.payload?.runId === runId
  ));
  const sourceDefinitions = definitions.filter((candidate) => (
    candidate.payload?.planDigest === predecessor.digest
      && candidate.payload?.definitionDigest === authority.definitionDigest
  ));
  const successorDefinitions = definitions.filter((candidate) => (
    candidate.payload?.planDigest === expectedPlanDigest
  ));
  if (sourceDefinitions.length !== 1 || successorDefinitions.length !== 1) {
    return fail('Context effect-call Workflow definition binding is absent or ambiguous',
      'context_call_definition_invalid');
  }
  const sourceEvent = sourceDefinitions[0];
  const successorEvent = successorDefinitions[0];
  const sourceDefinition = sourceEvent.payload;
  const successorDefinition = successorEvent.payload;
  if (sourceEvent.actor !== 'application:workflow-registry'
    || sourceEvent.idempotencyKey
      !== `application.workflow_definition_bound:${runId}:${predecessor.digest}`
    || successorEvent.actor !== 'application:workflow-registry'
    || successorEvent.idempotencyKey
      !== `application.workflow_definition_bound:${runId}:${expectedPlanDigest}`
    || ![1, 2, 3].includes(sourceDefinition.schemaVersion)
    || successorDefinition.schemaVersion !== 3) {
    return fail('Context effect-call Workflow definition authority is invalid',
      'context_call_definition_invalid');
  }
  let sourceCatalog;
  try {
    const ancestry = definitions.map((candidate) => candidate.payload);
    if (sourceDefinition.schemaVersion === 3) {
      validateWorkflowDefinitionV3(sourceDefinition, {
        nodes: predecessor.nodes,
        ancestors: ancestry.filter((candidate) => (
          candidate.definitionDigest !== sourceDefinition.definitionDigest
        )),
      });
      sourceCatalog = sourceDefinition.roleCatalog;
    } else {
      normalizeWorkflowDefinition(sourceDefinition, { nodes: predecessor.nodes });
      if (!Array.isArray(sourceDefinition.attempts)
        || sourceDefinition.attempts.length !== predecessor.nodes.length) {
        throw new TypeError('Historical Workflow Attempt set does not cover its exact Plan');
      }
      const nodesByKey = new Map(predecessor.nodes.map((node) => [node.key, node]));
      const boundNodes = new Set();
      sourceCatalog = buildWorkflowRoleCatalog(sourceDefinition.attempts.map((attempt) => {
        const node = nodesByKey.get(attempt?.nodeKey);
        const route = attempt?.route ?? null;
        if (!node || boundNodes.has(node.key)
          || !planRouteMatches(node.routes, route)
          || canonicalDigest(attempt.route) !== canonicalDigest(route)) {
          throw new TypeError('Historical Workflow Attempt differs from its exact Plan node');
        }
        boundNodes.add(node.key);
        return { role: attempt.role, route: attempt.route, node };
      }));
      if (boundNodes.size !== predecessor.nodes.length) {
        throw new TypeError('Historical Workflow Attempt set does not cover its exact Plan');
      }
    }
    validateWorkflowDefinitionV3(successorDefinition, {
      nodes: normalizedPlan.nodes,
      ancestors: ancestry.filter((candidate) => (
        candidate.definitionDigest !== successorDefinition.definitionDigest
      )),
    });
  } catch (error) {
    return fail(error.message, error.code ?? 'context_call_definition_invalid');
  }
  const catalogRole = sourceDefinition.schemaVersion === 3
    ? workflowCatalogRole(sourceDefinition, call.role)
    : sourceCatalog.roles.find((role) => role.role === call.role) ?? null;
  const expectedGeneration = sourceDefinition.schemaVersion === 3
    ? sourceDefinition.lineage.generation + 1 : 2;
  const expectedRoot = sourceDefinition.schemaVersion === 3
    && sourceDefinition.lineage.generation > 1
    ? sourceDefinition.lineage.rootDefinitionDigest : sourceDefinition.definitionDigest;
  const sourcePolicyDigest = sourceDefinition.schemaVersion === 3
    ? sourceDefinition.workflowPolicyDigest
    : sourceDefinition.schemaVersion === 2
      ? sourceDefinition.workflowPolicyDigest : LEGACY_WORKFLOW_POLICY.policyDigest;
  if (!catalogRole || authority.roleCatalogDigest !== sourceCatalog.catalogDigest
    || authority.profileDigest !== sourceDefinition.profileDigest
    || successorDefinition.profileDigest !== sourceDefinition.profileDigest
    || successorDefinition.workflowPolicyDigest !== sourcePolicyDigest
    || canonicalDigest(successorDefinition.workItem)
      !== canonicalDigest(sourceDefinition.workItem)
    || canonicalDigest(successorDefinition.roleCatalog) !== canonicalDigest(sourceCatalog)
    || successorDefinition.lineage.generation !== expectedGeneration
    || successorDefinition.lineage.parentDefinitionDigest !== sourceDefinition.definitionDigest
    || successorDefinition.lineage.rootDefinitionDigest !== expectedRoot
    || successorDefinition.attempts.length !== call.executionUnitIds.length) {
    return fail('Context effect-call logical role is outside Workflow authority',
      'context_call_role_invalid');
  }
  const planNodes = new Map(normalizedPlan.nodes.map((node) => [node.key, node]));
  const attemptedUnits = new Set();
  for (const attempt of successorDefinition.attempts) {
    const node = planNodes.get(attempt.nodeKey);
    const unit = node?.contextCall?.unit;
    const expectedRole = Number.isSafeInteger(unit?.index)
      ? `${call.role}:${String(unit.index + 1).padStart(4, '0')}` : null;
    const route = node ? workflowAttemptRoute(successorDefinition, attempt) : null;
    if (!node || attemptedUnits.has(unit?.unitId)
      || attempt.logicalRole !== call.role || attempt.role !== expectedRole
      || node.key !== `attempt:${expectedRole}`
      || !planRouteMatches(node.routes, route)
      || canonicalDigest(workflowAttemptRoute(successorDefinition, attempt))
        !== canonicalDigest(route)
      || canonicalDigest(route) !== canonicalDigest(catalogRole.route)) {
      return fail('Context effect-call route differs from the approved logical role',
        'context_call_route_invalid');
    }
    attemptedUnits.add(unit.unitId);
  }
  if (attemptedUnits.size !== call.executionUnitIds.length
    || call.executionUnitIds.some((unitId) => !attemptedUnits.has(unitId))) {
    return fail('Context effect-call Workflow Attempts do not cover its execution units',
      'context_call_definition_invalid');
  }

  let sourceSettlementDigest = null;
  try {
    if (call.operator === 'map') {
      const cell = store._contextCells.get(call.source.id);
      if (!cell || cell.state !== 'completed' || cell.sessionId !== session.sessionId
        || !cell.result || cell.admissionDigest !== call.source.admissionDigest
        || cell.settlementDigest !== call.source.settlementDigest
        || canonicalDigest(cell.result.outputRef) !== canonicalDigest(call.source.outputRef)
        || canonicalDigest(cell.result.evidenceRef) !== canonicalDigest(call.source.evidenceRef)
        || cell.result.coordinateDigest !== call.source.coordinateDigest) {
        return fail('Context effect-call cell source is stale', 'context_call_source_stale');
      }
      const artifacts = store.contextCellArtifacts(cell.cellId);
      const lineages = artifacts.evidence?.outputLineages;
      if (artifacts.evidence?.schemaVersion !== 2
        || artifacts.evidence.outputLineageDigest !== call.source.outputLineageDigest
        || artifacts.output?.items?.length !== call.source.itemCount
        || lineages?.length !== call.source.itemCount
        || call.units.some((unit) => {
          const input = unit.inputs[0]; const lineage = lineages?.[input.index];
          return contextValueDigest(artifacts.output.items[input.index]) !== input.itemDigest
            || lineage?.itemDigest !== input.itemDigest
            || lineage?.lineageDigest !== input.lineageDigest
            || lineage?.coordinateDigest !== unit.coordinateDigest;
        })) {
        return fail('Context effect-call map units differ from verified cell outputs',
          'context_call_source_invalid');
      }
      sourceSettlementDigest = cell.settlementDigest;
    } else {
      const sourceCall = store._contextCalls.get(call.source.id);
      if (!sourceCall || store._contextCallRunId(sourceCall) !== runId) {
        return fail('Context effect-call call source is outside its Run',
          'context_call_source_stale');
      }
      const expectedSource = store.contextCompletedCallSource(call.source.id);
      const artifacts = store.contextCallArtifacts(call.source.id);
      const lineages = artifacts.evidence?.outputLineages;
      const unit = call.units[0];
      const sourceEvidenceVersion = sourceCall.kind === 'baton.context_effect_call' ? 4 : 3;
      if (canonicalDigest(expectedSource) !== canonicalDigest(call.source)
        || artifacts.evidence?.schemaVersion !== sourceEvidenceVersion
        || artifacts.output?.items?.length !== call.source.itemCount
        || lineages?.length !== call.source.itemCount
        || unit.coordinateDigest !== call.source.coordinateDigest
        || unit.inputs.some((input) => {
          const lineage = lineages?.[input.index];
          return contextValueDigest(artifacts.output.items[input.index]) !== input.itemDigest
            || lineage?.itemDigest !== input.itemDigest
            || lineage?.lineageDigest !== input.lineageDigest;
        })) {
        return fail('Context effect-call reduce unit differs from verified call outputs',
          'context_call_source_invalid');
      }
      sourceSettlementDigest = sourceCall?.settlementDigest ?? null;
    }
  } catch (error) {
    if (error instanceof CoordinationRefusal || error instanceof CoordinationIntegrityError) {
      return fail(error.message, error.code ?? 'context_call_source_invalid');
    }
    return fail(error?.message ?? 'Context effect-call source is unavailable',
      'context_call_source_invalid');
  }

  const requestCore = {
    authority: admissionAuthority, call, planRequest: normalizedPlan, expectedPlanDigest,
  };
  const admissionCore = {
    ...requestCore, sourceSettlementDigest,
  };
  if (payload.requestDigest !== canonicalDigest(requestCore)
    || payload.admissionDigest !== canonicalDigest(admissionCore)) {
    return fail('Context effect-call admission identity changed');
  }
  store._assertRunAdmissionOpen(runId, integrity);
  return freeze({
    call, authority: admissionAuthority, planRequest: normalizedPlan, expectedPlanDigest,
    requestCore, admissionCore,
  });
}

export function _validateTaskResourceReleasePayload(store, payload, event, integrity = false) {
  const fail = (message) => {
    if (integrity) throw new CoordinationIntegrityError(message, 'task_resource_release_integrity');
    throw new CoordinationRefusal(message, 'task_resource_release_invalid');
  };
  const fields = [
    'evidence', 'releaseDigest', 'taskId', 'taskVersion', 'terminalEvent', 'workerId',
  ];
  const evidenceFields = ['coordinationSeq', 'digest', 'kind', 'ts', 'worker', 'workerSeq'];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).sort().join(',') !== fields.sort().join(',')
    || !validRunId(payload.taskId) || !validRunId(payload.workerId)
    || !Number.isSafeInteger(payload.taskVersion) || payload.taskVersion <= 0
    || !Number.isSafeInteger(payload.terminalEvent) || payload.terminalEvent <= 0
    || !/^[a-f0-9]{64}$/u.test(payload.releaseDigest ?? '')
    || !payload.evidence || typeof payload.evidence !== 'object'
    || Object.keys(payload.evidence).sort().join(',') !== evidenceFields.sort().join(',')) {
    return fail('task resource-release record is malformed');
  }
  const task = store._tasks.get(payload.taskId);
  if (!task || !TERMINAL.has(task.status) || task.version !== payload.taskVersion
    || task.terminalEvent !== payload.terminalEvent || task.assignee !== payload.workerId) {
    return fail('task resource-release target is stale');
  }
  const mapped = store._events[payload.evidence.coordinationSeq - 1];
  const mappedEvidence = mapped?.kind === 'evidence.mapped'
    ? { ...mapped.payload, coordinationSeq: mapped.seq } : null;
  const source = mappedEvidence ? store._operationalRead?.(
    mappedEvidence.worker, mappedEvidence.workerSeq,
  ) : null;
  if (!mappedEvidence) return fail('task resource release lacks mapped operational evidence');
  if (canonicalDigest(mappedEvidence) !== canonicalDigest(payload.evidence)) {
    return fail('task resource release mapped coordinate changed');
  }
  if (!source || digest(source) !== payload.evidence.digest) {
    return fail('task resource release operational bytes changed');
  }
  if (source.kind !== 'resource.worker_cleanup_attested' || source.actor !== 'policy') {
    return fail('task resource release operational kind or actor changed');
  }
  if (source.worker !== payload.workerId || source.taskId !== payload.taskId
    || source.runId !== task.runId || source.payload?.releaseDigest !== payload.releaseDigest) {
    return fail('task resource release operational target changed');
  }
  const release = source.payload;
  const releaseFields = [
    'checks', 'process', 'releaseDigest', 'runId', 'runtime', 'schemaVersion', 'session',
    'taskId', 'taskTerminalEvent', 'taskVersion', 'workerId', 'worktree',
  ];
  const checkFields = [
    'interactionsResolved', 'localAuthorityReleased', 'processClosed', 'runtimeAbsent',
    'sessionDetached', 'worktreeAbsent',
  ];
  const processFields = [
    'generation', 'pid', 'processGroupId', 'state', 'terminalKind', 'terminalSeq',
  ];
  if (Object.keys(release).sort().join(',') !== releaseFields.sort().join(',')
    || release.schemaVersion !== 1 || release.taskId !== task.id
    || release.taskVersion !== task.version || release.taskTerminalEvent !== task.terminalEvent
    || release.workerId !== task.assignee || release.runId !== task.runId
    || !release.checks || Object.keys(release.checks).sort().join(',') !== checkFields.sort().join(',')
    || checkFields.some((field) => release.checks[field] !== true)
    || !release.process || Object.keys(release.process).sort().join(',') !== processFields.sort().join(',')
    || !release.worktree || release.worktree.state !== 'absent'
    || release.worktree.ownerTaskId !== task.id
    || !release.runtime || release.runtime.state !== 'absent'
    || !release.session || !['not_created', 'historical_only'].includes(release.session.state)
    || release.session.recoveryClosed !== true) {
    return fail('task resource-release operational proof is malformed');
  }
  const core = Object.fromEntries(Object.entries(release)
    .filter(([key]) => key !== 'releaseDigest'));
  if (release.releaseDigest !== canonicalDigest(core)) {
    return fail('task resource-release operational identity changed');
  }
  const prefix = store._operationalRangeRead?.(payload.workerId, payload.evidence.workerSeq);
  if (!Array.isArray(prefix) || prefix.length !== payload.evidence.workerSeq
    || prefix.some((row, index) => row.seq !== index + 1)) {
    return fail('task resource-release operational prefix is incomplete');
  }
  if (release.process.state === 'not_started') {
    if (['generation', 'pid', 'processGroupId', 'terminalKind', 'terminalSeq']
      .some((field) => release.process[field] !== null)
      || prefix.some((row) => (
        row.kind === 'lifecycle.process_started' && row.worker === payload.workerId
          && row.taskId === task.id && row.runId === task.runId
      ))) {
      return fail('task resource-release invented a process-free state');
    }
  } else {
    if (!['closed', 'absent_after_restart', 'reaped_after_restart'].includes(release.process.state)
      || !Number.isSafeInteger(release.process.generation) || release.process.generation <= 0
      || !Number.isSafeInteger(release.process.pid) || release.process.pid <= 0
      || !Number.isSafeInteger(release.process.processGroupId)
      || release.process.processGroupId !== release.process.pid
      || !Number.isSafeInteger(release.process.terminalSeq)
      || !['lifecycle.process_closed', 'control.recovery_process_absent',
        'control.recovery_process_reaped']
        .includes(release.process.terminalKind)
      || (release.process.state === 'closed'
        && release.process.terminalKind !== 'lifecycle.process_closed')
      || (release.process.state === 'absent_after_restart'
        && release.process.terminalKind !== 'control.recovery_process_absent')
      || (release.process.state === 'reaped_after_restart'
        && release.process.terminalKind !== 'control.recovery_process_reaped')) {
      return fail('task resource-release process proof is invalid');
    }
    const terminal = prefix.find((row) => row.seq === release.process.terminalSeq);
    const startsReleasedTask = (row) => (
      row.kind === 'lifecycle.process_started'
        && row.worker === payload.workerId
        && row.taskId === task.id
        && row.runId === task.runId
    );
    const started = prefix.slice(0, release.process.terminalSeq - 1)
      .findLast(startsReleasedTask);
    const terminalActor = release.process.terminalKind === 'lifecycle.process_closed'
      ? 'worker' : 'policy';
    const terminalPayloadValid = release.process.terminalKind === 'lifecycle.process_closed'
      ? validProcessClosedPayload(terminal?.payload)
      : release.process.terminalKind === 'control.recovery_process_absent'
        ? validRecoveryProcessAbsentPayload(terminal?.payload)
        : validRecoveryProcessReapedPayload(terminal?.payload);
    if (!started || started.actor !== 'worker'
      || started.worker !== payload.workerId
      || started.taskId !== task.id || started.runId !== task.runId
      || !validProcessStartedPayload(started.payload)
      || started.payload.generation !== release.process.generation
      || started.payload.pid !== release.process.pid
      || started.payload.processGroupId !== release.process.processGroupId
      || !terminal || terminal.kind !== release.process.terminalKind
      || terminal.worker !== payload.workerId
      || terminal.actor !== terminalActor
      || terminal.taskId !== task.id || terminal.runId !== task.runId
      || !terminalPayloadValid
      || terminal.payload?.generation !== release.process.generation
      || terminal.payload?.pid !== release.process.pid
      || terminal.payload?.processGroupId !== release.process.processGroupId
      || !started
      || prefix.slice(release.process.terminalSeq)
        .some(startsReleasedTask)) {
      return fail('task resource-release process lifecycle is not closed');
    }
  }
  if (event.actor !== 'policy'
    || event.idempotencyKey !== `task.resources_released:${task.id}:${task.terminalEvent}`) {
    return fail('task resource-release authority changed');
  }
  return freeze({
    schemaVersion: 1, taskId: task.id, taskVersion: task.version,
    terminalEvent: task.terminalEvent, workerId: task.assignee,
    releaseDigest: payload.releaseDigest, evidence: clone(payload.evidence),
    releaseEvent: event.seq, releasedAt: event.ts,
  });
}

export function _normalizeContextCleanupReceipt(store, call, kind, children, value, integrity = false) {
  const generic = kind === 'effect';
  const subject = generic ? 'effect' : 'map';
  const fail = (message) => store._contextFailure(message,
    integrity
      ? (generic ? 'context_call_settlement_integrity'
        : 'context_map_call_settlement_integrity')
      : (generic ? 'context_cleanup_invalid' : 'context_map_cleanup_invalid'),
    integrity);
  const fields = [
    'admissionDigest', 'callId', 'cleanupDigest', 'remainingCount', 'schemaVersion',
    'targetCount', 'targetDigest', 'targets',
  ];
  const cleanupChildren = generic
    ? children.filter((child) => child.origin !== 'inherited') : children;
  const targets = cleanupChildren.map((child) => {
    const release = store._taskResourceReleases.get(child.taskId);
    return release ? {
      ...(generic ? { unitId: child.unitId } : { partitionId: child.partitionId }),
      taskId: child.taskId, workerId: child.workerId,
      releaseEvent: release.releaseEvent, releaseDigest: release.releaseDigest,
      evidence: clone(release.evidence),
    } : null;
  });
  if (targets.some((target) => !target || typeof target.workerId !== 'string'
    || target.workerId.length === 0)) {
    return fail(`Context ${subject} cleanup target lacks an exact durable resource release`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== fields.sort().join(',')
    || value.schemaVersion !== (generic ? 2 : 1) || value.callId !== call.callId
    || value.admissionDigest !== call.admissionDigest
    || canonicalDigest(value.targets) !== canonicalDigest(targets)
    || value.targetDigest !== canonicalDigest(targets)
    || value.targetCount !== targets.length || value.remainingCount !== 0
    || targets.some((target) => {
      const release = store._taskResourceReleases.get(target.taskId);
      return !release || release.workerId !== target.workerId
        || release.releaseEvent !== target.releaseEvent
        || release.releaseDigest !== target.releaseDigest
        || canonicalDigest(release.evidence) !== canonicalDigest(target.evidence);
    })) {
    return fail(`Context ${subject} cleanup receipt does not prove its exact descendant union`);
  }
  const core = {
    schemaVersion: generic ? 2 : 1,
    callId: call.callId, admissionDigest: call.admissionDigest,
    targets, targetDigest: canonicalDigest(targets), targetCount: targets.length,
    remainingCount: 0,
  };
  if (value.cleanupDigest !== canonicalDigest(core)) {
    return fail(`Context ${subject} cleanup receipt identity changed`);
  }
  return freeze({ ...core, cleanupDigest: value.cleanupDigest });
}

export function _normalizeContextMapCleanupReceipt(store, call, children, value, integrity = false) {
  return store._normalizeContextCleanupReceipt(call, 'map', children, value, integrity);
}

export function _normalizeContextEffectCleanupReceipt(store, call, children, value, integrity = false) {
  return store._normalizeContextCleanupReceipt(call, 'effect', children, value, integrity);
}

export function _validateContextProviderResults(store, call, kind, children, cleanup, values, integrity = false,
    verification = store._contextArtifactVerification()) {
  const generic = kind === 'effect';
  const subject = generic ? 'effect' : 'map';
  const fail = (message) => store._contextFailure(message,
    integrity
      ? (generic ? 'context_call_settlement_integrity'
        : 'context_map_call_settlement_integrity')
      : (generic ? 'context_call_settlement_invalid'
        : 'context_map_call_settlement_invalid'), integrity);
  const acceptedChildren = children.filter(contextChildAccepted);
  if (!Array.isArray(values) || values.length !== acceptedChildren.length) {
    return fail(`Context ${subject} provider-result set does not match accepted children`);
  }
  const plan = [...store._plans.values()].find((candidate) => (
    candidate.digest === call.expectedPlanDigest
  ));
  if (!plan) {
    return fail(`Context ${subject} provider-result Plan is unavailable`);
  }
  const normalized = [];
  for (let index = 0; index < acceptedChildren.length; index += 1) {
    const child = acceptedChildren[index];
    const value = values[index];
    if (generic && child.origin === 'inherited') {
      const predecessor = store._contextCalls.get(child.originCallId);
      const originChild = predecessor?.result?.children?.find((candidate) => (
        candidate.unitId === child.unitId
          && candidate.childDigest === child.originChildDigest
      ));
      const originResult = predecessor?.result?.providerResults?.find((candidate) => (
        candidate.unitId === child.unitId
      ));
      let capsule; let resultRef;
      try {
        if (!predecessor || predecessor.callId !== call.predecessorCall?.callId
          || !(originChild?.origin === 'inherited' || originChild?.state === 'accepted')
          || canonicalDigest(originResult) !== child.resultRefDigest
          || canonicalDigest(value) !== canonicalDigest(originResult)) {
          throw new TypeError('Context inherited provider-result predecessor changed');
        }
        store._contextCallArtifacts(predecessor.callId, verification);
        capsule = store._contextArtifactRead(value?.capsuleRef, verification);
        resultRef = validateContextProviderResultReference(value, capsule);
      } catch (error) {
        return fail(error?.message ?? 'Context inherited provider-result is unavailable');
      }
      if (resultRef.unitId !== child.unitId
        || resultRef.childDigest !== originResult.childDigest
        || resultRef.capsuleId !== capsule.capsuleId
        || resultRef.capsuleDigest !== capsule.capsuleDigest
        || resultRef.resultSourceDigest !== capsule.resultSourceDigest) {
        return fail('Context inherited provider-result authority changed');
      }
      normalized.push(resultRef);
      continue;
    }
    const node = plan.nodes.find((candidate) => (
      candidate.key === child.nodeKey
        && candidate.contextCall?.callId === call.callId
        && (generic
          ? candidate.contextCall?.unit?.unitId === child.unitId
          : candidate.contextCall?.partition?.partitionId === child.partitionId)
    ));
    const commits = child.artifacts.filter((artifact) => artifact.kind === 'commit');
    let capsule; let resultRef; let pathScope;
    try {
      capsule = store._contextArtifactRead(value?.capsuleRef, verification);
      resultRef = validateContextProviderResultReference(value, capsule);
      pathScope = normalizeContextResultPathScope(node?.pathScope);
    } catch (error) {
      return fail(error?.message ?? `Context ${subject} provider-result CAS is unavailable`);
    }
    if (!node || canonicalDigest(node) !== child.nodeDigest || commits.length !== 1
      || commits[0].refs?.sha !== child.resultSha
      || commits[0].refs?.retainedResultRef !== retainedResultRef(child.resultSha)
      || resultRef.unitId !== (generic ? child.unitId : child.partitionId)
      || resultRef.childDigest !== child.childDigest
      || resultRef.capsuleId !== capsule.capsuleId
      || resultRef.capsuleDigest !== capsule.capsuleDigest
      || resultRef.resultSourceDigest !== capsule.resultSourceDigest
      || capsule.callId !== call.callId
      || capsule.unitId !== (generic ? child.unitId : child.partitionId)
      || capsule.taskId !== child.taskId || capsule.taskVersion !== child.taskVersion
      || capsule.terminalEvent !== child.terminalEvent
      || capsule.childDigest !== child.childDigest
      || canonicalDigest(capsule.route) !== canonicalDigest(child.route)
      || capsule.artifactDigest !== child.artifactDigest
      || capsule.cleanupDigest !== cleanup.cleanupDigest
      || child.cleanupDigest !== cleanup.cleanupDigest
      || capsule.result.baseSha !== (generic ? call.authority.treeSha : call.source.treeSha)
      || capsule.result.resultSha !== child.resultSha
      || capsule.result.retainedResultRef !== commits[0].refs.retainedResultRef
      || canonicalDigest(capsule.result.pathScope) !== canonicalDigest(pathScope)) {
      return fail(`Context ${subject} provider-result authority changed`);
    }
    normalized.push(resultRef);
  }
  return freeze(normalized);
}

export function _validateContextMapProviderResults(store, call, children, cleanup, values, integrity = false,
    verification = store._contextArtifactVerification()) {
  return store._validateContextProviderResults(
    call, 'map', children, cleanup, values, integrity, verification,
  );
}

export function _validateContextEffectProviderResults(store, call, children, cleanup, values, integrity = false,
    verification = store._contextArtifactVerification()) {
  return store._validateContextProviderResults(
    call, 'effect', children, cleanup, values, integrity, verification,
  );
}

export function _validateContextMapPlanProposal(store, plan, integrity = false) {
  const bindings = plan?.nodes?.map((node) => node.contextCall).filter(Boolean) ?? [];
  if (bindings.length === 0) return null;
  const fail = (message) => store._contextFailure(message,
    'context_map_plan_integrity', integrity);
  if (bindings.length !== plan.nodes.length
    || new Set(bindings.map((binding) => binding.callId)).size !== 1) {
    return fail('Context map Plan bindings are incomplete or ambiguous');
  }
  const call = store._contextCalls.get(bindings[0].callId);
  if (!call || call.state !== 'plan_pending'
    || call.expectedPlanDigest !== plan.digest
    || call.source.runId !== plan.runId
    || canonicalDigest(call.planRequest) !== canonicalDigest({
      goal: plan.goal, predecessor: plan.predecessor,
      nodes: plan.nodes, totals: plan.totals,
    })) {
    return fail('Context map Plan has no exact durable call admission');
  }
  const callCore = {
    schemaVersion: call.schemaVersion,
    kind: call.kind,
    generation: call.generation,
    source: clone(call.source),
    role: call.role,
    instruction: call.instruction,
    partitions: clone(call.partitions),
    programDigest: call.programDigest,
    callId: call.callId,
    callDigest: call.callDigest,
  };
  const partitions = new Set();
  for (const binding of bindings) {
    const partition = call.partitions.find((candidate) => (
      candidate.partitionId === binding.partition.partitionId
    ));
    let expected;
    try { expected = partition ? contextMapNodeBinding(callCore, partition) : null; }
    catch { expected = null; }
    if (!expected || canonicalDigest(expected) !== canonicalDigest(binding)
      || partitions.has(partition.partitionId)) {
      return fail('Context map Plan substituted or repeated an admitted partition');
    }
    partitions.add(partition.partitionId);
  }
  if (partitions.size !== call.partitions.length) {
    return fail('Context map Plan does not cover its admitted partition set');
  }
  return call;
}

export function _validateContextCallPlanProposal(store, plan, integrity = false) {
  const bindings = plan?.nodes?.map((node) => node.contextCall).filter(Boolean) ?? [];
  if (bindings.length === 0 || bindings[0]?.kind === 'context_map_child') {
    return store._validateContextMapPlanProposal(plan, integrity);
  }
  const fail = (message) => store._contextFailure(message,
    'context_call_plan_integrity', integrity);
  if (bindings.length !== plan.nodes.length
    || new Set(bindings.map((binding) => binding.callId)).size !== 1) {
    return fail('Context effect Plan bindings are incomplete or ambiguous');
  }
  const call = store._contextCalls.get(bindings[0].callId);
  if (!call || call.kind !== 'baton.context_effect_call' || call.state !== 'plan_pending'
    || call.expectedPlanDigest !== plan.digest
    || store._contextCallRunId(call) !== plan.runId
    || canonicalDigest(call.planRequest) !== canonicalDigest({
      goal: plan.goal, predecessor: plan.predecessor,
      nodes: plan.nodes, totals: plan.totals,
    })) {
    return fail('Context effect Plan has no exact durable call admission');
  }
  const callCore = {
    schemaVersion: call.schemaVersion, kind: call.kind, operator: call.operator,
    requestId: call.requestId, requestDigest: call.requestDigest,
    generation: call.generation, predecessorCall: clone(call.predecessorCall),
    executionUnitIds: clone(call.executionUnitIds),
    inheritedChildren: clone(call.inheritedChildren), authority: clone(call.authority),
    source: clone(call.source), role: call.role, instruction: call.instruction,
    units: clone(call.units), callId: call.callId, callDigest: call.callDigest,
  };
  const units = new Set();
  for (const binding of bindings) {
    const unit = call.units.find((candidate) => candidate.unitId === binding.unit?.unitId);
    let expected;
    try { expected = unit ? contextEffectNodeBinding(callCore, unit) : null; }
    catch { expected = null; }
    if (!expected || canonicalDigest(expected) !== canonicalDigest(binding)
      || units.has(unit.unitId)) {
      return fail('Context effect Plan substituted or repeated an admitted unit');
    }
    units.add(unit.unitId);
  }
  if (units.size !== call.executionUnitIds.length
    || call.executionUnitIds.some((unitId) => !units.has(unitId))) {
    return fail('Context effect Plan does not cover its admitted execution unit set');
  }
  return call;
}

export function _validateContextMapResultLineageEvidence(store, call, evidence, children, providerResults, cleanup, integrity = false,
    verification = store._contextArtifactVerification(),) {
  const fail = (message) => store._contextFailure(message,
    integrity ? 'context_map_call_settlement_integrity'
      : 'context_map_call_settlement_invalid', integrity);
  if (evidence?.schemaVersion !== 3) {
    return fail('Context map result lineage evidence is unavailable');
  }
  try {
    const sourceOutput = store._contextArtifactRead(call.source.outputRef, verification);
    const sourceEvidence = store._contextArtifactRead(call.source.evidenceRef, verification);
    const capsules = providerResults.map((providerResult) => (
      store._contextArtifactRead(providerResult.capsuleRef, verification)
    ));
    return validateContextMapResultLineage({
      call: {
        schemaVersion: call.schemaVersion, kind: call.kind, generation: call.generation,
        source: clone(call.source), role: call.role, instruction: call.instruction,
        partitions: clone(call.partitions), programDigest: call.programDigest,
        callId: call.callId, callDigest: call.callDigest,
      },
      children, providerResults, capsules, sourceOutput, sourceEvidence,
      planDigest: call.expectedPlanDigest, cleanupDigest: cleanup.cleanupDigest,
      outputLineages: evidence.outputLineages,
      outputLineageDigest: evidence.outputLineageDigest,
      sourceCoordinates: evidence.sourceCoordinates,
      coordinateDigest: evidence.coordinateDigest,
    });
  } catch (error) {
    return fail(error?.message ?? 'Context map result lineage changed');
  }
}

export function _validateContextEffectResultLineageEvidence(store, call, evidence, children, providerResults, cleanup, integrity = false,
    verification = store._contextArtifactVerification(),) {
  const fail = (message) => store._contextFailure(message,
    integrity ? 'context_call_settlement_integrity'
      : 'context_call_settlement_invalid', integrity);
  if (evidence?.schemaVersion !== 4) {
    return fail('Context effect result lineage evidence is unavailable');
  }
  try {
    const sourceOutput = store._contextArtifactRead(call.source.outputRef, verification);
    const sourceEvidence = store._contextArtifactRead(call.source.evidenceRef, verification);
    const capsules = providerResults.map((providerResult) => (
      store._contextArtifactRead(providerResult.capsuleRef, verification)
    ));
    return validateContextEffectResultLineage({
      call: store._contextEffectCallCore(call),
      children, providerResults, capsules, sourceOutput, sourceEvidence,
      planDigest: call.expectedPlanDigest, cleanupDigest: cleanup.cleanupDigest,
      outputLineages: evidence.outputLineages,
      outputLineageDigest: evidence.outputLineageDigest,
      sourceCoordinates: evidence.sourceCoordinates,
      coordinateDigest: evidence.coordinateDigest,
    });
  } catch (error) {
    return fail(error?.message ?? 'Context effect result lineage changed');
  }
}

export function _validateContextMapCallSettlementPayload(store, payload, event, integrity = false) {
  const fields = [
    'authority', 'callId', 'expectedVersion', 'newVersion', 'result', 'schemaVersion',
    'settlementDigest',
  ];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).sort().join(',') !== fields.sort().join(',')
    || payload.schemaVersion !== 1 || payload.expectedVersion !== 1 || payload.newVersion !== 2
    || !payload.result || typeof payload.result !== 'object' || Array.isArray(payload.result)) {
    store._contextFailure('Context map call settlement is malformed',
      'context_map_call_settlement_integrity', integrity);
  }
  let authority;
  try { authority = normalizeContextAuthority(payload.authority); }
  catch (error) {
    store._contextFailure(error.message,
      integrity ? 'context_map_call_settlement_integrity'
        : 'context_map_call_settlement_invalid', integrity);
  }
  const call = store._contextCalls.get(payload.callId);
  if (!call || call.version !== 1 || call.state !== 'plan_pending'
    || canonicalDigest(authority) !== canonicalDigest(call.authority)
    || event.actor !== authority.actor) {
    store._contextFailure('Context map call settlement target or authority is stale',
      integrity ? 'context_map_call_settlement_integrity'
        : 'context_map_call_settlement_stale', integrity);
  }
  const completedResultFields = [
    'childDigest', 'children', 'cleanup', 'evidenceRef', 'outputRef', 'providerEffects',
    'providerResultDigest', 'providerResults', 'state',
  ];
  const failedResultFields = [...completedResultFields, 'termination'];
  let outputRef; let evidenceRef; let children; let cleanup; let state; let termination;
  let providerResults; let providerResultDigest;
  try {
    if (!['completed', 'failed'].includes(payload.result.state)
      || Object.keys(payload.result).sort().join(',') !== (payload.result.state === 'failed'
        ? failedResultFields : completedResultFields).sort().join(',')
      || !Array.isArray(payload.result.children)
      || payload.result.providerEffects !== call.partitions.length) {
      throw new TypeError('Context map terminal result is invalid');
    }
    const baseChildren = store._contextMapSettlementChildren(call, integrity);
    cleanup = store._normalizeContextMapCleanupReceipt(
      call, baseChildren, payload.result.cleanup, integrity,
    );
    children = store._contextMapSettlementChildren(call, integrity, cleanup);
    state = children.every(contextChildAccepted) ? 'completed' : 'failed';
    providerResults = store._validateContextMapProviderResults(
      call, children, cleanup, payload.result.providerResults, integrity,
    );
    providerResultDigest = canonicalDigest(providerResults);
    if (canonicalDigest(payload.result.children) !== canonicalDigest(children)
      || payload.result.childDigest !== canonicalDigest(children)
      || payload.result.providerResultDigest !== providerResultDigest
      || payload.result.state !== state) {
      throw new TypeError('Context map terminal child identities changed');
    }
    if (state === 'completed') {
      outputRef = normalizeContextArtifactRef(
        payload.result.outputRef, 'context_value', store._contextProgramPolicy,
      );
    } else {
      termination = payload.result.termination;
      if (payload.result.outputRef !== null || !termination
        || typeof termination !== 'object' || Array.isArray(termination)
        || Object.keys(termination).sort().join(',')
          !== ['code', 'retryable', 'summary'].sort().join(',')
        || termination.code !== 'context_child_failed' || termination.retryable !== true
        || termination.summary
          !== 'One or more Context map children failed before acceptance.') {
        throw new TypeError('Context map failure termination is invalid');
      }
      outputRef = null;
      termination = clone(termination);
    }
    evidenceRef = normalizeContextArtifactRef(
      payload.result.evidenceRef, 'context_call_evidence', store._contextProgramPolicy,
    );
  } catch (error) {
    store._contextFailure(error.message,
      integrity ? 'context_map_call_settlement_integrity'
        : 'context_map_call_settlement_invalid', integrity);
  }
  const result = freeze({
    state, providerEffects: call.partitions.length,
    children, childDigest: canonicalDigest(children),
    providerResults, providerResultDigest, cleanup, outputRef, evidenceRef,
    ...(state === 'failed' ? { termination } : {}),
  });
  let output; let evidence;
  try {
    output = outputRef === null ? null : store._contextReferenceRead(outputRef);
    evidence = store._contextReferenceRead(evidenceRef);
  } catch (error) {
    store._contextFailure(error?.message ?? 'Context map settlement artifact is unavailable',
      integrity ? 'context_map_call_settlement_integrity'
        : (error?.code ?? 'context_map_call_settlement_invalid'), integrity);
  }
  const outputFields = [
    'chunks', 'items', 'kind', 'schemaVersion', 'selectedSourceItems', 'sourceBranches',
    'sourceItems',
  ];
  const lineageEvidence = state === 'completed' && evidence?.schemaVersion === 3;
  const evidenceFields = [
    'callDigest', 'callId', 'childDigest', 'children', 'cleanup', 'coordinateDigest',
    'generation', 'kind', 'outputRef', 'partitions', 'programDigest', 'providerEffects',
    'providerResultDigest', 'providerResults', 'schemaVersion', 'source',
    ...(lineageEvidence
      ? ['outputLineageDigest', 'outputLineages', 'sourceCoordinates'] : []),
    ...(state === 'failed' ? ['state', 'termination'] : []),
  ];
  const outputValid = state === 'failed' ? output === null
    : output?.schemaVersion === 1 && output.kind === 'baton.context_value'
      && Object.keys(output).sort().join(',') === outputFields.sort().join(',')
      && canonicalDigest(output.items) === canonicalDigest(providerResults)
      && canonicalDigest(output.sourceBranches) === canonicalDigest([
        'context_provider_results',
      ])
      && output.sourceItems === children.length
      && output.selectedSourceItems === providerResults.length
      && output.chunks === providerResults.length;
  const failureEvidenceValid = state === 'completed' || (
    evidence?.state === 'failed' && evidence.outputRef === null
    && canonicalDigest(evidence.termination) === canonicalDigest(termination)
  );
  const evidenceVersionValid = state === 'failed'
    ? evidence?.schemaVersion === 2
    : integrity ? [2, 3].includes(evidence?.schemaVersion) : evidence?.schemaVersion === 3;
  if (!outputValid || !evidence || !evidenceVersionValid
    || evidence.kind !== 'baton.context_call_evidence'
    || Object.keys(evidence).sort().join(',') !== evidenceFields.sort().join(',')
    || evidence.callId !== call.callId || evidence.callDigest !== call.callDigest
    || evidence.programDigest !== call.programDigest || evidence.generation !== call.generation
    || evidence.childDigest !== result.childDigest
    || evidence.providerResultDigest !== providerResultDigest
    || evidence.providerEffects !== children.length
    || evidence.coordinateDigest !== call.source.coordinateDigest
    || canonicalDigest(evidence.source) !== canonicalDigest(call.source)
    || canonicalDigest(evidence.partitions) !== canonicalDigest(call.partitions)
    || canonicalDigest(evidence.children) !== canonicalDigest(children)
    || canonicalDigest(evidence.providerResults) !== canonicalDigest(providerResults)
    || canonicalDigest(evidence.cleanup) !== canonicalDigest(cleanup)
    || canonicalDigest(evidence.outputRef) !== canonicalDigest(outputRef)
    || !failureEvidenceValid) {
    store._contextFailure('Context map settlement artifacts changed',
      integrity ? 'context_map_call_settlement_integrity'
        : 'context_map_call_settlement_invalid', integrity);
  }
  if (state === 'completed' && evidence.schemaVersion === 3) {
    store._validateContextMapResultLineageEvidence(
      call, evidence, children, providerResults, cleanup, integrity,
    );
  }
  const settlementCore = {
    authority, callId: call.callId, admissionDigest: call.admissionDigest,
    expectedVersion: 1, newVersion: 2, result,
  };
  if (payload.settlementDigest !== canonicalDigest(settlementCore)
    || event.idempotencyKey !== `context.call.settle:${call.callId}:${call.admissionDigest}`) {
    store._contextFailure('Context map call settlement identity changed',
      integrity ? 'context_map_call_settlement_integrity'
        : 'context_map_call_settlement_invalid', integrity);
  }
  store._assertRunAdmissionOpen(call.source.runId, integrity);
  return freeze({ call, result, settlementCore });
}

export function _validateContextEffectCallSettlementPayload(store, payload, event, integrity = false) {
  const fail = (message, code = 'context_call_settlement_invalid') => (
    store._contextFailure(message,
      integrity ? 'context_call_settlement_integrity' : code, integrity)
  );
  const fields = [
    'authority', 'callId', 'expectedVersion', 'newVersion', 'result', 'schemaVersion',
    'settlementDigest',
  ];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).sort().join(',') !== fields.sort().join(',')
    || payload.schemaVersion !== 2 || payload.expectedVersion !== 1 || payload.newVersion !== 2
    || !payload.result || typeof payload.result !== 'object' || Array.isArray(payload.result)) {
    return fail('Context effect call settlement is malformed');
  }
  let authority;
  try { authority = normalizeContextAuthority(payload.authority); }
  catch (error) { return fail(error.message); }
  const call = store._contextCalls.get(payload.callId);
  if (!call || call.kind !== 'baton.context_effect_call'
    || call.version !== 1 || call.state !== 'plan_pending'
    || canonicalDigest(authority) !== canonicalDigest(call.admissionAuthority)
    || event.actor !== authority.actor) {
    return fail('Context effect call settlement target or authority is stale',
      'context_call_settlement_stale');
  }
  const completedResultFields = [
    'childDigest', 'children', 'cleanup', 'evidenceRef', 'outputRef', 'providerEffects',
    'providerResultDigest', 'providerResults', 'state',
  ];
  const failedResultFields = [...completedResultFields, 'termination'];
  let outputRef; let evidenceRef; let children; let cleanup; let state; let termination;
  let providerResults; let providerResultDigest;
  try {
    if (!['completed', 'failed'].includes(payload.result.state)
      || Object.keys(payload.result).sort().join(',') !== (payload.result.state === 'failed'
        ? failedResultFields : completedResultFields).sort().join(',')
      || !Array.isArray(payload.result.children)
      || payload.result.providerEffects !== call.executionUnitIds.length) {
      throw new TypeError('Context effect terminal result is invalid');
    }
    const baseChildren = store._contextEffectSettlementChildren(call, integrity);
    cleanup = store._normalizeContextEffectCleanupReceipt(
      call, baseChildren, payload.result.cleanup, integrity,
    );
    children = store._contextEffectSettlementChildren(call, integrity, cleanup);
    state = children.every(contextChildAccepted) ? 'completed' : 'failed';
    providerResults = store._validateContextEffectProviderResults(
      call, children, cleanup, payload.result.providerResults, integrity,
    );
    providerResultDigest = canonicalDigest(providerResults);
    if (canonicalDigest(payload.result.children) !== canonicalDigest(children)
      || payload.result.childDigest !== canonicalDigest(children)
      || payload.result.providerResultDigest !== providerResultDigest
      || payload.result.state !== state) {
      throw new TypeError('Context effect terminal child identities changed');
    }
    if (state === 'completed') {
      outputRef = normalizeContextArtifactRef(
        payload.result.outputRef, 'context_value', store._contextProgramPolicy,
      );
    } else {
      termination = payload.result.termination;
      if (payload.result.outputRef !== null || !termination
        || typeof termination !== 'object' || Array.isArray(termination)
        || Object.keys(termination).sort().join(',')
          !== ['code', 'retryable', 'summary'].sort().join(',')
        || termination.code !== 'context_child_failed' || termination.retryable !== true
        || termination.summary
          !== `One or more Context ${call.operator} children failed before acceptance.`) {
        throw new TypeError('Context effect failure termination is invalid');
      }
      outputRef = null;
      termination = clone(termination);
    }
    evidenceRef = normalizeContextArtifactRef(
      payload.result.evidenceRef, 'context_call_evidence', store._contextProgramPolicy,
    );
  } catch (error) {
    return fail(error.message);
  }
  const result = freeze({
    state, providerEffects: call.executionUnitIds.length,
    children, childDigest: canonicalDigest(children),
    providerResults, providerResultDigest, cleanup, outputRef, evidenceRef,
    ...(state === 'failed' ? { termination } : {}),
  });
  let output; let evidence;
  try {
    output = outputRef === null ? null : store._contextReferenceRead(outputRef);
    evidence = store._contextReferenceRead(evidenceRef);
  } catch (error) {
    return fail(error?.message ?? 'Context effect settlement artifact is unavailable',
      error?.code ?? 'context_call_settlement_invalid');
  }
  const outputFields = [
    'chunks', 'items', 'kind', 'schemaVersion', 'selectedSourceItems', 'sourceBranches',
    'sourceItems',
  ];
  const evidenceFields = [
    'call', 'childDigest', 'children', 'cleanup', 'coordinateDigest', 'kind', 'outputRef',
    'providerEffects', 'providerResultDigest', 'providerResults', 'schemaVersion',
    ...(state === 'completed'
      ? ['outputLineageDigest', 'outputLineages', 'sourceCoordinates']
      : ['state', 'termination']),
  ];
  const outputValid = state === 'failed' ? output === null
    : output?.schemaVersion === 1 && output.kind === 'baton.context_value'
      && Object.keys(output).sort().join(',') === outputFields.sort().join(',')
      && canonicalDigest(output.items) === canonicalDigest(providerResults)
      && canonicalDigest(output.sourceBranches) === canonicalDigest([
        'context_provider_results',
      ])
      && output.sourceItems === call.source.itemCount
      && output.selectedSourceItems === providerResults.length
      && output.chunks === providerResults.length;
  const failureEvidenceValid = state === 'completed' || (
    evidence?.state === 'failed' && evidence.outputRef === null
    && canonicalDigest(evidence.termination) === canonicalDigest(termination)
  );
  if (!outputValid || evidence?.schemaVersion !== 4
    || evidence.kind !== 'baton.context_call_evidence'
    || Object.keys(evidence).sort().join(',') !== evidenceFields.sort().join(',')
    || canonicalDigest(evidence.call) !== canonicalDigest(store._contextEffectCallCore(call))
    || evidence.childDigest !== result.childDigest
    || evidence.providerResultDigest !== providerResultDigest
    || evidence.providerEffects !== call.executionUnitIds.length
    || evidence.coordinateDigest !== call.source.coordinateDigest
    || canonicalDigest(evidence.children) !== canonicalDigest(children)
    || canonicalDigest(evidence.providerResults) !== canonicalDigest(providerResults)
    || canonicalDigest(evidence.cleanup) !== canonicalDigest(cleanup)
    || canonicalDigest(evidence.outputRef) !== canonicalDigest(outputRef)
    || !failureEvidenceValid) {
    return fail('Context effect settlement artifacts changed');
  }
  if (state === 'completed') {
    store._validateContextEffectResultLineageEvidence(
      call, evidence, children, providerResults, cleanup, integrity,
    );
  }
  const settlementCore = {
    authority, callId: call.callId, admissionDigest: call.admissionDigest,
    expectedVersion: 1, newVersion: 2, result,
  };
  if (payload.settlementDigest !== canonicalDigest(settlementCore)
    || event.idempotencyKey !== `context.call.settle:${call.callId}:${call.admissionDigest}`) {
    return fail('Context effect call settlement identity changed');
  }
  store._assertRunAdmissionOpen(store._contextCallRunId(call), integrity);
  return freeze({ call, result, settlementCore });
}

export function _assertRunAdmissionOpen(store, runId, integrity = false) {
  if (runId != null && (store._runStopByTarget.has(runId) || store._runStops.has(runId))) {
    if (integrity) throw new CoordinationIntegrityError(`run ${runId} is stopping`, 'run_stopping');
    throw new CoordinationRefusal(`run ${runId} is stopping`, 'run_stopping');
  }
}

export function _acceptanceRevocationFailure(message, code, integrity = false) {
  throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code);
}

export function _validateAcceptanceRevocationPayload(store, p, event, integrity = false) {
  const expected = ['artifactTargets', 'evidence', 'expectedTaskVersion', 'knowledgeTargets', 'newTaskVersion', 'receiptDigest', 'requestDigest', 'schemaVersion', 'taskId'];
  const evidenceFields = ['coordinationSeq', 'digest', 'kind', 'providerCode', 'worker', 'workerSeq'];
  const core = Object.fromEntries(Object.entries(p ?? {}).filter(([key]) => key !== 'receiptDigest'));
  if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).sort().join(',') !== expected.sort().join(',')
    || p.schemaVersion !== 1 || p.receiptDigest !== canonicalDigest(core)
    || !/^[a-f0-9]{64}$/.test(p.requestDigest ?? '') || !/^[a-f0-9]{64}$/.test(p.receiptDigest ?? '')
    || typeof p.taskId !== 'string' || p.taskId.length === 0 || Buffer.byteLength(p.taskId) > 4_096
    || !Number.isSafeInteger(p.expectedTaskVersion) || p.expectedTaskVersion <= 0
    || !Number.isSafeInteger(p.newTaskVersion) || !Array.isArray(p.artifactTargets) || !Array.isArray(p.knowledgeTargets)
    || !p.evidence || typeof p.evidence !== 'object' || Array.isArray(p.evidence)
    || Object.keys(p.evidence).sort().join(',') !== evidenceFields.sort().join(',')
    || !promotionActor(event?.actor) || typeof event?.idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(event.idempotencyKey)
    || !Number.isSafeInteger(event.seq) || !Number.isFinite(Date.parse(event.ts))) {
    store._acceptanceRevocationFailure('task acceptance revocation payload is malformed', 'acceptance_revocation_integrity', integrity);
  }
  // #286 G-41: no payload ceiling. The payload is a function of the targets above, which are a
  // view of the ledger — its size is bounded by the state that produced it, and a second literal
  // bound here refused a replayed event the append path had already accepted.
  const request = { schemaVersion: 1, taskId: p.taskId, expectedTaskVersion: p.expectedTaskVersion, evidence: { coordinationSeq: p.evidence?.coordinationSeq } };
  const expectedRequestDigest = canonicalDigest({ actor: event.actor, idempotencyKey: event.idempotencyKey, request });
  if (p.requestDigest !== expectedRequestDigest || p.newTaskVersion !== p.expectedTaskVersion + 1) {
    store._acceptanceRevocationFailure('task acceptance revocation request or task version is malformed', 'acceptance_revocation_integrity', integrity);
  }
  const task = store._tasks.get(p.taskId);
  const terminal = Number.isSafeInteger(task?.terminalEvent) ? store._events[task.terminalEvent - 1] : null;
  if (!task || task.status !== 'completed' || task.version !== p.expectedTaskVersion
    || terminal?.kind !== 'task.transitioned' || terminal.payload?.id !== task.id || terminal.payload?.to !== 'completed') {
    const code = task && task.version !== p.expectedTaskVersion ? 'stale_version' : 'acceptance_revocation_unavailable';
    store._acceptanceRevocationFailure('task acceptance revocation requires the exact completed task version', code, integrity);
  }
  const evidence = store._acceptanceRevocationEvidence(task, p.evidence?.coordinationSeq, integrity);
  if (canonicalDigest(p.evidence) !== canonicalDigest(evidence)) {
    store._acceptanceRevocationFailure('task acceptance revocation evidence snapshot changed', 'acceptance_revocation_evidence_invalid', integrity);
  }
  const targets = store._acceptanceRevocationTargets(task, evidence.coordinationSeq, integrity);
  if (targets.knowledgeTargets.some((target) => Date.parse(store._knowledgeNodes.get(target.nodeId)?.validFrom) > Date.parse(event.ts))) {
    store._acceptanceRevocationFailure('task acceptance revocation would create an invalid knowledge interval', 'acceptance_revocation_integrity', integrity);
  }
  if (canonicalDigest(p.artifactTargets) !== canonicalDigest(targets.artifactTargets)
    || canonicalDigest(p.knowledgeTargets) !== canonicalDigest(targets.knowledgeTargets)) {
    store._acceptanceRevocationFailure('task acceptance revocation target versions changed', 'acceptance_revocation_target_changed', integrity);
  }
  return targets;
}

export function _planBudgetFailure(store, message, code, integrity = false) {
  store._goalPlanFailure(message, code, integrity);
}

/** Issue #518: the ledger-anchored half of a plan-budget settlement — the dispatch the node
 * was bound by, its task, the terminal transition the settlement is for, and the wall time
 * between them. Every field here re-derives from rows the coordination ledger itself carries.
 * The operational log is a SEPARATE store (the worker's own event file) that a cold replay
 * does not carry, so it is not part of this anchor: the derivation below reads it when it is
 * wired, and the replay validator never requires it. */
function _planBudgetLedgerAnchor(store, taskId, integrity = false) {
  const dispatch = store._planTaskLinks.get(taskId); const task = store._tasks.get(taskId);
  const terminalEvent = task?.acceptanceRevocation?.priorTerminalEvent ?? task?.terminalEvent;
  const terminal = Number.isSafeInteger(terminalEvent) ? store._events[terminalEvent - 1] : null;
  if (!dispatch || !task || !terminal || terminal.kind !== 'task.transitioned' || terminal.payload?.id !== taskId
    || !TERMINAL.has(terminal.payload?.to) || terminal.seq <= dispatch.eventSeq) {
    store._planBudgetFailure('plan node budget settlement requires one exact terminal plan task', 'plan_budget_not_terminal', integrity);
  }
  const claimed = task.claimedEvent ? store._events[task.claimedEvent - 1] : null;
  const started = claimed && claimed.seq < terminal.seq ? claimed : store._events[dispatch.eventSeq - 1];
  const wallMin = Math.ceil(Math.max(0, Date.parse(terminal.ts) - Date.parse(started.ts)) / 60_000 * 1_000_000) / 1_000_000;
  const evidenceSeq = terminal.payload?.evidence?.coordinationSeq;
  const mapped = Number.isSafeInteger(evidenceSeq) && evidenceSeq < terminal.seq ? store._events[evidenceSeq - 1] : null;
  const assignee = task.assignee ?? task.reservedWorkerId ?? null;
  return {
    dispatch, task, terminal, wallMin, initial: clone(dispatch.nodeBudget), assignee,
    mapped: mapped?.kind === 'evidence.mapped' && mapped.payload?.worker === (task.assignee ?? mapped.payload?.worker) ? mapped : null,
  };
}

/** The USD released/overrun arithmetic in nanos, or null when the amounts are not
 * representable at that scale. One definition: the live derivation needs it to decide whether
 * recorded usd consumption is exact, and both lanes need it to recompute the dimensions. */
function _planBudgetUsdDimension(initial, consumed) {
  const initialNanos = usdToNanos(initial.usd); const consumedNanos = usdToNanos(consumed.usd);
  if (initialNanos === null || consumedNanos === null) return null;
  const released = usdFromNanos(Math.max(0, initialNanos - consumedNanos));
  const overrun = usdFromNanos(Math.max(0, consumedNanos - initialNanos));
  return released === null || overrun === null ? null : { released, held: 0, overrun };
}

/** The released/held/overrun dimension of one settlement. The live derivation feeds it the
 * consumption it measured from the operational rows; the replay validator feeds it the
 * consumption the row recorded. Both lanes must produce the recorded dimensions, so a replay
 * recomputes the arithmetic instead of trusting it. */
function _planBudgetDimensions(initial, consumed, availability) {
  const dimension = (key) => {
    if (availability[key] !== 'exact') return { released: null, held: initial[key], overrun: null };
    if (key === 'usd') {
      return _planBudgetUsdDimension(initial, consumed)
        ?? { released: null, held: initial.usd, overrun: null };
    }
    return { released: Math.max(0, initial[key] - consumed[key]), held: 0, overrun: Math.max(0, consumed[key] - initial[key]) };
  };
  return Object.fromEntries(Object.keys(initial).map((key) => [key, dimension(key)]));
}

export function _derivePlanBudgetSettlement(store, taskId, integrity = false) {
  const anchor = _planBudgetLedgerAnchor(store, taskId, integrity);
  const { dispatch, terminal, mapped } = anchor;
  const source = mapped ? store._operationalRead?.(mapped.payload.worker, mapped.payload.workerSeq) : null;
  const mappedExact = mapped !== null && Boolean(source) && digest(source) === mapped.payload.digest && source.kind === mapped.payload.kind;
  let rows = null;
  if (mappedExact && store._operationalRangeRead) {
    // Issue #504: the evidence ceiling is the live authority's; a store that carries no
    // goal/plan authority (the probes) has no ceiling to apply and must not read one off a
    // policy it does not have.
    const ceiling = store._goalPlanPolicy === null ? null
      : Math.min(1_000_000, Math.max(1_024, store._goalPlanPolicy.limits.maxProviderTurns * 1_024));
    if (ceiling !== null && mapped.payload.workerSeq > ceiling) store._planBudgetFailure('plan node operational settlement evidence exceeds its ceiling', 'plan_budget_evidence_oversize', integrity);
    rows = store._operationalRangeRead(mapped.payload.worker, mapped.payload.workerSeq);
    if (!Array.isArray(rows) || rows.length !== mapped.payload.workerSeq
      || rows.some((row, index) => row?.worker !== mapped.payload.worker || row.seq !== index + 1 || row.seq > mapped.payload.workerSeq)) {
      store._planBudgetFailure('plan node operational settlement prefix is incomplete', 'plan_budget_evidence_invalid', integrity);
    }
  }
  const initial = anchor.initial;
  const usageRows = rows?.filter((event) => event.kind === 'resource.tokens' && event.actor === 'worker') ?? [];
  const tokenUsageValid = usageRows.every((event) => Number.isFinite(event.payload?.tokens) && event.payload.tokens >= 0);
  const usdNanoRows = usageRows.map((event) => usdToNanos(event.payload?.usd));
  const totalUsdNanos = usdNanoRows.reduce((sum, value) => value === null ? Number.NaN : sum + value, 0);
  const projectedUsd = Number.isSafeInteger(totalUsdNanos) ? usdFromNanos(totalUsdNanos) : null;
  const seal = rows?.findLast((event) => event.payload?.usageSeal && typeof event.payload.usageSeal === 'object')?.payload?.usageSeal ?? null;
  const tokensExact = tokenUsageValid && seal?.tokens === 'reported';
  const usdExact = projectedUsd !== null && _planBudgetUsdDimension(initial, { usd: projectedUsd }) !== null && seal?.usd === 'reported';
  const tokens = tokensExact ? usageRows.reduce((sum, event) => sum + event.payload.tokens, 0) : null;
  const usd = usdExact ? projectedUsd : null;
  const providerTurns = rows ? rows.filter((event) => event.kind === 'lifecycle.turn_started' && event.actor === 'orchestrator').length : null;
  const availability = {
    tokens: tokensExact ? 'exact' : 'unavailable', usd: usdExact ? 'exact' : 'unavailable',
    wallMin: 'exact', providerTurns: rows ? 'exact' : 'unavailable',
  };
  const consumed = { tokens, usd, wallMin: anchor.wallMin, providerTurns };
  const dimensions = _planBudgetDimensions(initial, consumed, availability);
  const slice = (key) => Object.fromEntries(Object.keys(initial).map((name) => [name, dimensions[name][key]]));
  return {
    schemaVersion: 1, taskId, binding: clone(dispatch.binding), terminalEvent: terminal.seq, terminalStatus: terminal.payload.to,
    initial, consumed,
    released: slice('released'), held: slice('held'), overrun: slice('overrun'),
    availability,
    operational: {
      worker: mappedExact ? mapped.payload.worker : anchor.assignee,
      throughSeq: rows ? mapped.payload.workerSeq : null,
      prefixDigest: rows ? canonicalDigest(rows) : null,
    },
  };
}

export function _validatePlanBudgetSettlement(store, p, event, integrity = false) {
  const fail = (message) => store._planBudgetFailure(message, 'plan_budget_settlement_integrity', integrity);
  const core = Object.fromEntries(Object.entries(p ?? {}).filter(([key]) => key !== 'receiptDigest'));
  // Issue #518: replay judges a recorded settlement by what the row carries and by the ledger
  // rows it cites, never by the live operational log — the probe behind `baton doctor`
  // constructs the store with no operational resolver at all, so re-deriving consumption from
  // that log refuses a deployment's own healthy history (the #325 class, #504's residual).
  if (!p || typeof p !== 'object' || Array.isArray(p) || event?.actor !== 'policy' || !validRunId(event?.idempotencyKey)
    || p.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(p.receiptDigest ?? '')
    || p.receiptDigest !== canonicalDigest(core) || store._planBudgetSettlements.has(p.taskId)) fail('plan node budget settlement is malformed or duplicated');
  const anchor = _planBudgetLedgerAnchor(store, p.taskId, integrity);
  const settlementFields = ['availability', 'binding', 'consumed', 'held', 'initial', 'operational', 'overrun', 'released', 'receiptDigest', 'schemaVersion', 'taskId', 'terminalEvent', 'terminalStatus'];
  if (Object.keys(p).sort().join(',') !== settlementFields.sort().join(',')
    || canonicalDigest(p.binding) !== canonicalDigest(anchor.dispatch.binding)
    || p.terminalEvent !== anchor.terminal.seq || p.terminalStatus !== anchor.terminal.payload.to
    || canonicalDigest(p.initial) !== canonicalDigest(anchor.initial)) fail('plan node budget settlement does not match its recorded dispatch');
  const dimensionKeys = Object.keys(anchor.initial).sort();
  const blockShape = (block) => block !== null && typeof block === 'object' && !Array.isArray(block)
    && Object.keys(block).sort().join(',') === dimensionKeys.join(',');
  if (!blockShape(p.consumed) || !blockShape(p.availability) || !blockShape(p.released) || !blockShape(p.held) || !blockShape(p.overrun)) {
    fail('plan node budget settlement consumption is malformed');
  }
  // A recorded consumption is what a live derivation can record: null exactly when the
  // dimension was unavailable, otherwise a representable non-negative amount.
  const recorded = (key) => {
    const value = p.consumed[key];
    if (p.availability[key] === 'unavailable') return value === null;
    if (p.availability[key] !== 'exact' || typeof value !== 'number' || !Number.isFinite(value) || value < 0) return false;
    if (key === 'wallMin') return true;
    if (key === 'usd') return usdFromNanos(usdToNanos(value)) === value;
    return Number.isSafeInteger(value);
  };
  for (const key of dimensionKeys) if (!recorded(key)) fail('plan node budget settlement consumption is malformed');
  // The wall time is the ledger's own: the recorded start and terminal rows are both replayed.
  if (p.availability.wallMin !== 'exact' || p.consumed.wallMin !== anchor.wallMin) fail('plan node budget settlement wall time changed');
  // The operational ROWS are not carried by a cold replay; the row's own operational claim is
  // judged against the evidence mapping the ledger carries, and stays internally consistent.
  const operationalKeys = ['prefixDigest', 'throughSeq', 'worker'];
  if (p.operational === null || typeof p.operational !== 'object' || Array.isArray(p.operational)
    || Object.keys(p.operational).sort().join(',') !== operationalKeys.sort().join(',')) {
    fail('plan node budget settlement operational evidence is malformed');
  }
  const { worker, throughSeq, prefixDigest } = p.operational;
  const rowsClaimed = throughSeq !== null;
  if (rowsClaimed && (anchor.mapped === null || !Number.isSafeInteger(throughSeq) || throughSeq <= 0
    || throughSeq !== anchor.mapped.payload.workerSeq || worker !== anchor.mapped.payload.worker
    || !/^[a-f0-9]{64}$/.test(prefixDigest ?? ''))) fail('plan node budget settlement operational evidence changed');
  // A null throughSeq means no rows were read: the worker is then the recorded assignee, or
  // the mapped evidence worker a store with a resolver but no range read records.
  if (!rowsClaimed && (prefixDigest !== null
    || !(worker === anchor.assignee || (anchor.mapped !== null && worker === anchor.mapped.payload.worker)))) {
    fail('plan node budget settlement operational evidence changed');
  }
  // Provider turns come from the rows; tokens and USD can only be exact over rows as well.
  if ((p.availability.providerTurns === 'exact') !== rowsClaimed
    || (p.availability.tokens === 'exact' && !rowsClaimed) || (p.availability.usd === 'exact' && !rowsClaimed)) {
    fail('plan node budget settlement availability is malformed');
  }
  // The arithmetic is recomputed from the recorded consumption and the ledger's own initial
  // budget and wall time, so a rewritten total still refuses even with a recomputed receipt.
  const dimensions = _planBudgetDimensions(anchor.initial, p.consumed, p.availability);
  for (const key of dimensionKeys) {
    if (p.released[key] !== dimensions[key].released || p.held[key] !== dimensions[key].held
      || p.overrun[key] !== dimensions[key].overrun) fail('plan node budget settlement arithmetic changed');
  }
  return core;
}

export function _contextRetrySelection(store, callId, integrity = false) {
  const fail = (message, code) => store._contextFailure(
    message, integrity ? 'context_call_integrity' : code, integrity,
  );
  const call = store._contextCalls.get(callId);
  if (!call || call.kind !== 'baton.context_effect_call') {
    return fail('Context retry predecessor is unavailable', 'context_retry_not_found');
  }
  if (call.state !== 'failed' || !call.result || !call.settlementDigest
    || call.result.cleanup?.remainingCount !== 0) {
    return fail('Context retry requires one failed terminal generation with exact cleanup',
      'context_retry_not_eligible');
  }
  store.contextCallArtifacts(callId);
  const children = call.result.children;
  if (!Array.isArray(children) || children.length !== call.units.length) {
    return fail('Context retry predecessor logical children are incomplete',
      'context_retry_not_eligible');
  }
  const inheritedChildren = [];
  const retryUnitIds = [];
  for (let index = 0; index < call.units.length; index += 1) {
    const unit = call.units[index];
    const child = children[index];
    if (child?.unitId !== unit.unitId || child?.unitDigest !== unit.unitDigest) {
      return fail('Context retry predecessor child identity changed',
        'context_retry_not_eligible');
    }
    if (child.origin === 'inherited' || child.state === 'accepted') {
      inheritedChildren.push({
        unitId: unit.unitId, originCallId: call.callId, childDigest: child.childDigest,
      });
    } else if (child.termination?.retryable === true) {
      retryUnitIds.push(unit.unitId);
    } else {
      return fail('Context retry predecessor contains a nonretryable logical child',
        'context_retry_nonretryable');
    }
  }
  if (retryUnitIds.length === 0) {
    return fail('Context retry predecessor has no retryable logical units',
      'context_retry_not_eligible');
  }
  const successor = [...store._contextCalls.values()].find((candidate) => (
    candidate.kind === 'baton.context_effect_call'
      && candidate.predecessorCall?.callId === call.callId
  ));
  if (successor) {
    return fail('Context retry predecessor already has a successor generation',
      'context_retry_fork');
  }
  return freeze({
    schemaVersion: 1, kind: 'baton.context_retry_selection',
    callId: call.callId, callDigest: call.callDigest, generation: call.generation,
    settlementDigest: call.settlementDigest,
    inheritedChildren: freeze(inheritedChildren), retryUnitIds: freeze(retryUnitIds),
  });
}

export function contextRetryEligibility(store, callId) {
  try {
    return clone({ eligible: true, ...store._contextRetrySelection(callId, false) });
  } catch (error) {
    if (!(error instanceof CoordinationRefusal)) throw error;
    return freeze({
      eligible: false, callId, code: error.code ?? 'context_retry_not_eligible',
      summary: error.message,
    });
  }
}

export function contextCallSettlementChildren(store, callId, cleanupReceipt = null) {
  const call = store._contextCalls.get(callId);
  const generic = call?.kind === 'baton.context_effect_call';
  if (!call) throw new CoordinationRefusal('Context call is unavailable',
    'context_call_not_found');
  const children = generic
    ? store._contextEffectSettlementChildren(call, false)
    : store._contextMapSettlementChildren(call, false);
  if (cleanupReceipt === null) return clone(children);
  const cleanup = generic
    ? store._normalizeContextEffectCleanupReceipt(call, children, cleanupReceipt, false)
    : store._normalizeContextMapCleanupReceipt(call, children, cleanupReceipt, false);
  return clone(generic
    ? store._contextEffectSettlementChildren(call, false, cleanup)
    : store._contextMapSettlementChildren(call, false, cleanup));
}

export function _contextCallArtifacts(store, callId, verification) {
  if (verification.calls.has(callId)) return verification.calls.get(callId);
  const call = store._contextCalls.get(callId);
  const generic = call?.kind === 'baton.context_effect_call';
  if (!call) throw new CoordinationRefusal('Context call is unavailable',
    'context_call_not_found');
  if (!['completed', 'failed'].includes(call.state) || !call.result) {
    throw new CoordinationRefusal('Context call has no terminal artifacts',
      'context_call_not_completed');
  }
  let output; let evidence; let providerResults;
  try {
    providerResults = generic
      ? store._validateContextEffectProviderResults(
        call, call.result.children, call.result.cleanup, call.result.providerResults, true,
        verification,
      )
      : store._validateContextMapProviderResults(
        call, call.result.children, call.result.cleanup, call.result.providerResults, true,
        verification,
      );
    if (canonicalDigest(providerResults) !== call.result.providerResultDigest) {
      throw new CoordinationIntegrityError('Context call provider-result set changed',
        generic ? 'context_call_settlement_integrity'
          : 'context_map_call_settlement_integrity');
    }
    output = call.result.outputRef === null
      ? null : store._contextArtifactRead(call.result.outputRef, verification);
    evidence = store._contextArtifactRead(call.result.evidenceRef, verification);
  } catch (error) {
    if (error?.code === 'context_artifact_unavailable') throw error;
    throw new CoordinationIntegrityError(error?.message ?? 'Context call artifact reverify failed',
      generic ? 'context_call_settlement_integrity'
        : 'context_map_call_settlement_integrity');
  }
  const outputValid = call.state === 'failed'
    ? output === null && evidence?.state === 'failed' && evidence.outputRef === null
      && canonicalDigest(evidence?.cleanup) === canonicalDigest(call.result.cleanup)
      && canonicalDigest(evidence?.termination) === canonicalDigest(call.result.termination)
    : canonicalDigest(output?.items) === canonicalDigest(call.result.providerResults);
  const evidenceCallValid = generic
    ? canonicalDigest(evidence?.call) === canonicalDigest(store._contextEffectCallCore(call))
    : evidence?.callId === call.callId && evidence?.callDigest === call.callDigest;
  if (!outputValid
    || !evidenceCallValid
    || evidence?.childDigest !== call.result.childDigest
    || evidence?.providerResultDigest !== call.result.providerResultDigest
    || canonicalDigest(evidence?.children) !== canonicalDigest(call.result.children)
    || canonicalDigest(evidence?.providerResults)
      !== canonicalDigest(call.result.providerResults)
    || canonicalDigest(evidence?.cleanup) !== canonicalDigest(call.result.cleanup)
    || canonicalDigest(evidence?.outputRef) !== canonicalDigest(call.result.outputRef)) {
    throw new CoordinationIntegrityError('Context call artifacts changed',
      generic ? 'context_call_settlement_integrity'
        : 'context_map_call_settlement_integrity');
  }
  if (call.state === 'completed') {
    if (generic ? evidence?.schemaVersion !== 4 : ![2, 3].includes(evidence?.schemaVersion)) {
      throw new CoordinationIntegrityError('Context call evidence version changed',
        generic ? 'context_call_settlement_integrity'
          : 'context_map_call_settlement_integrity');
    }
    if (generic) {
      store._validateContextEffectResultLineageEvidence(
        call, evidence, call.result.children, providerResults, call.result.cleanup, true,
        verification,
      );
    } else if (evidence.schemaVersion === 3) {
      store._validateContextMapResultLineageEvidence(
        call, evidence, call.result.children, providerResults, call.result.cleanup, true,
        verification,
      );
    }
  } else if (evidence?.schemaVersion !== (generic ? 4 : 2)) {
    throw new CoordinationIntegrityError('Failed Context call evidence version changed',
      generic ? 'context_call_settlement_integrity'
        : 'context_map_call_settlement_integrity');
  }
  const artifacts = freeze({ output: clone(output), evidence: clone(evidence) });
  verification.calls.set(callId, artifacts);
  return artifacts;
}

export function _validateContextCompletionArtifacts(store, cell, result, output, evidence, integrity = false) {
  const session = store._contextSessions.get(cell.sessionId);
  const contextPolicy = store._normalizeContextDeployment(session?.deployment, integrity).policy;
  const evidenceFields = [
    'cellId', 'coordinateDigest', 'environmentDigest', 'kind', 'manifestDigest',
    'outputRef', 'policyDigest', 'programDigest', 'providerEffects', 'schemaVersion',
    'selectedSourceItems', 'sourceBranches', 'sourceCoordinates', 'sourceItems',
    ...(evidence?.schemaVersion === 2 ? ['outputLineageDigest', 'outputLineages'] : []),
  ];
  const outputFields = [
    'chunks', 'items', 'kind', 'schemaVersion', 'selectedSourceItems',
    'sourceBranches', 'sourceItems',
  ];
  const fail = (message, code = 'context_artifact_integrity') => {
    store._contextFailure(message, code, integrity);
  };
  if (contextValueDigest(output) !== result.outputRef.digest
    || contextValueDigest(evidence) !== result.evidenceRef.digest
    || !output || typeof output !== 'object' || Array.isArray(output)
    || Object.keys(output).sort().join(',') !== outputFields.sort().join(',')
    || output.schemaVersion !== 1 || output.kind !== 'baton.context_value'
    || !Array.isArray(output.items)
    || output.items.length > contextPolicy.maxResultItems
    || !Number.isSafeInteger(output.chunks) || output.chunks < 0
    || !Number.isSafeInteger(output.sourceItems) || output.sourceItems < 0
    || !Number.isSafeInteger(output.selectedSourceItems) || output.selectedSourceItems < 0
    || !evidence || typeof evidence !== 'object' || Array.isArray(evidence)
    || Object.keys(evidence).sort().join(',') !== evidenceFields.sort().join(',')
    || ![1, 2].includes(evidence.schemaVersion)
    || evidence.kind !== 'baton.context_cell_evidence'
    || evidence.cellId !== cell.cellId
    || evidence.manifestDigest !== cell.manifestDigest
    || evidence.programDigest !== cell.programDigest
    || evidence.environmentDigest !== cell.environmentDigest
    || evidence.policyDigest !== cell.policyDigest
    || evidence.providerEffects !== 0
    || canonicalDigest(evidence.outputRef) !== canonicalDigest(result.outputRef)
    || canonicalDigest(evidence.sourceBranches) !== canonicalDigest(output.sourceBranches)
    || evidence.sourceItems !== output.sourceItems
    || evidence.selectedSourceItems !== output.selectedSourceItems
    || !Array.isArray(evidence.sourceCoordinates)
    || evidence.sourceCoordinates.length !== result.sourceCoordinateCount
    || contextValueDigest(evidence.sourceCoordinates) !== result.coordinateDigest
    || evidence.coordinateDigest !== result.coordinateDigest) {
    fail('Context cell artifact evidence changed');
  }
  if (evidence.schemaVersion === 2) {
    try {
      validatePureContextOutputLineage({
        items: output.items,
        outputLineages: evidence.outputLineages,
        outputLineageDigest: evidence.outputLineageDigest,
        sourceCoordinates: evidence.sourceCoordinates,
        coordinateDigest: evidence.coordinateDigest,
      });
    } catch (error) {
      fail(error?.message ?? 'Context output lineage changed');
    }
  }
  if (!Array.isArray(evidence.sourceBranches)
    || new Set(evidence.sourceBranches).size !== evidence.sourceBranches.length
    || evidence.sourceBranches.some((branch) => typeof branch !== 'string')) {
    fail('Context cell source-branch evidence is invalid');
  }
  const inputs = new Map(cell.inputRefs.map((input) => [input.branch, input]));
  const branches = new Map((session?.manifest?.branches ?? [])
    .map((branch) => [branch.name, branch]));
  if (evidence.sourceBranches.some((branch) => !inputs.has(branch) || !branches.has(branch))) {
    fail('Context cell evidence cites a source outside its admitted program');
  }
  const resolved = new Map();
  const coordinateIdentities = new Set();
  for (const coordinate of evidence.sourceCoordinates) {
    const fields = ['branch', 'itemDigest', 'itemIndex', 'sourceDigest', 'sourceRef'];
    if (!coordinate || typeof coordinate !== 'object' || Array.isArray(coordinate)
      || Object.keys(coordinate).sort().join(',') !== fields.sort().join(',')
      || !Number.isSafeInteger(coordinate.itemIndex) || coordinate.itemIndex < 0
      || !/^[a-f0-9]{64}$/u.test(coordinate.itemDigest ?? '')) {
      fail('Context cell source coordinate is malformed');
    }
    const input = inputs.get(coordinate.branch);
    const branch = branches.get(coordinate.branch);
    if (!input || !branch || coordinate.sourceRef !== input.ref
      || coordinate.sourceDigest !== input.digest
      || coordinate.sourceRef !== branch.ref || coordinate.sourceDigest !== branch.digest
      || coordinate.itemIndex >= branch.itemCount) {
      fail('Context cell source coordinate is outside its manifest');
    }
    const identity = canonicalDigest(coordinate);
    if (coordinateIdentities.has(identity)) fail('Context cell source coordinates repeat');
    coordinateIdentities.add(identity);
    let source = resolved.get(branch.ref);
    if (!source) {
      try {
        source = store._contextReferenceRead({
          kind: 'context_source', ref: branch.ref, digest: branch.digest,
          mediaType: branch.mediaType, itemCount: branch.itemCount,
        });
      } catch (error) {
        fail(error?.message ?? 'Context source evidence is unavailable',
          error?.code ?? 'context_source_unavailable');
      }
      resolved.set(branch.ref, source);
    }
    const items = Array.isArray(source) ? source : [source];
    if (contextValueDigest(source) !== branch.digest || items.length !== branch.itemCount
      || contextValueDigest(items[coordinate.itemIndex]) !== coordinate.itemDigest) {
      fail('Context cell source item evidence changed');
    }
  }
  return freeze({ output: clone(output), evidence: clone(evidence) });
}

export function contextCellArtifacts(store, cellId) {
  const cell = store._contextCells.get(cellId);
  if (!cell) throw new CoordinationRefusal('Context cell is unavailable', 'context_cell_not_found');
  if (cell.state !== 'completed' || !cell.result) {
    throw new CoordinationRefusal('Context cell has no completed artifacts',
      'context_cell_not_completed');
  }
  let output; let evidence;
  try {
    output = store._contextReferenceRead(cell.result.outputRef);
    evidence = store._contextReferenceRead(cell.result.evidenceRef);
  } catch (error) {
    if (error?.code === 'context_artifact_unavailable') throw error;
    throw new CoordinationIntegrityError(error?.message ?? 'Context artifact reverify failed',
      'context_artifact_integrity');
  }
  return store._validateContextCompletionArtifacts(cell, cell.result, output, evidence, true);
}

export function _normalizeContextPackageSourceRef(store, value, integrity) {
  if (value === null || value === undefined) return null;
  const fail = (message) => store._contextFailure(message, 'context_package_invalid', integrity);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== ['digest', 'itemCount', 'kind', 'mediaType', 'ref'].sort().join(',')
    || value.kind !== 'context_source') fail('context package branch source is invalid');
  if (!/^[a-f0-9]{64}$/.test(value.digest ?? '')) fail('context package branch source digest is invalid');
  if (value.ref !== `ctx:sha256:${value.digest}`) fail('context package branch source ref is invalid');
  if (!Number.isSafeInteger(value.itemCount) || value.itemCount < 0) {
    fail('context package branch source item count is invalid');
  }
  if (typeof value.mediaType !== 'string'
    || !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/u.test(value.mediaType)) {
    fail('context package branch source media type is invalid');
  }
  return {
    kind: 'context_source', ref: value.ref, digest: value.digest,
    mediaType: value.mediaType, itemCount: value.itemCount,
  };
}

export function _normalizeContextPackageArtifactRef(store, value, integrity) {
  if (value === null || value === undefined) return null;
  const fail = (message) => store._contextFailure(message, 'context_package_invalid', integrity);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== ['bytes', 'digest', 'handle', 'kind', 'mediaType'].sort().join(',')
    || typeof value.kind !== 'string' || value.kind.length === 0 || Buffer.byteLength(value.kind) > 128) {
    fail('context package branch artifact is invalid');
  }
  if (!/^[a-f0-9]{64}$/.test(value.digest ?? '')) fail('context package branch artifact digest is invalid');
  if (value.handle !== `art:sha256:${value.digest}`) fail('context package branch artifact handle is invalid');
  if (typeof value.mediaType !== 'string'
    || !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/u.test(value.mediaType)) {
    fail('context package branch artifact media type is invalid');
  }
  if (!Number.isSafeInteger(value.bytes) || value.bytes <= 0) fail('context package branch artifact bytes is invalid');
  return {
    kind: value.kind, digest: value.digest, handle: value.handle,
    mediaType: value.mediaType, bytes: value.bytes,
  };
}

export function _normalizeContextPackageValueRef(store, value, integrity) {
  if (value === null || value === undefined) return null;
  const fail = (message) => store._contextFailure(message, 'context_package_invalid', integrity);
  const fields = ['artifactDigest', 'artifactId', 'kind', 'lineageDigest', 'schemaId', 'valueDigest', 'valueId'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== fields.sort().join(',')
    || value.kind !== 'value_ref') fail('context package branch value ref is invalid');
  if (!/^[a-f0-9]{64}$/.test(value.artifactDigest ?? '')) fail('context package branch value artifact digest is invalid');
  if (typeof value.artifactId !== 'string' || value.artifactId.length === 0
    || Buffer.byteLength(value.artifactId) > 512) fail('context package branch value artifact id is invalid');
  if (!/^[a-f0-9]{64}$/.test(value.valueDigest ?? '')) fail('context package branch value digest is invalid');
  if (!/^[a-f0-9]{64}$/.test(value.lineageDigest ?? '')) fail('context package branch value lineage digest is invalid');
  if (typeof value.schemaId !== 'string' || value.schemaId.length === 0
    || Buffer.byteLength(value.schemaId) > 512) fail('context package branch value schema id is invalid');
  const expectedValueId = `pvalue:${canonicalDigest({
      artifactDigest: value.artifactDigest, schemaId: value.schemaId,
      valueDigest: value.valueDigest, lineageDigest: value.lineageDigest,
    })}`;
  if (value.valueId !== expectedValueId) fail('context package branch value id is invalid');
  return {
    kind: 'value_ref', valueId: value.valueId, artifactId: value.artifactId,
    artifactDigest: value.artifactDigest, schemaId: value.schemaId,
    valueDigest: value.valueDigest, lineageDigest: value.lineageDigest,
  };
}

export function _normalizeContextPackageSchemaRef(store, value, integrity) {
  if (value === null || value === undefined) return null;
  const fail = (message) => store._contextFailure(message, 'context_package_invalid', integrity);
  const fields = ['digest', 'kind', 'name', 'schemaId', 'version'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== fields.sort().join(',')
    || value.kind !== 'schema_ref') fail('context package branch schema ref is invalid');
  if (typeof value.name !== 'string' || value.name.length === 0 || Buffer.byteLength(value.name) > 256
    || !/^[A-Za-z0-9._:-]+$/u.test(value.name)) fail('context package branch schema name is invalid');
  if (!Number.isSafeInteger(value.version) || value.version <= 0) fail('context package branch schema version is invalid');
  if (!/^[a-f0-9]{64}$/.test(value.digest ?? '')) fail('context package branch schema digest is invalid');
  if (value.schemaId !== `schema:${value.digest}`) fail('context package branch schema id is invalid');
  return {
    kind: 'schema_ref', schemaId: value.schemaId, name: value.name,
    version: value.version, digest: value.digest,
  };
}

export function _normalizeContextPackageBranch(store, value, integrity) {
  const fail = (message, code = 'context_package_invalid') => store._contextFailure(message, code, integrity);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== ['artifact', 'name', 'schema', 'source', 'valueRef'].sort().join(',')) {
    fail('context package branch has unknown or missing fields');
  }
  if (typeof value.name !== 'string' || value.name.length === 0 || Buffer.byteLength(value.name) > 512
    || !/^[A-Za-z0-9._:-]+$/u.test(value.name)) fail('context package branch name is invalid');
  const source = store._normalizeContextPackageSourceRef(value.source, integrity);
  const artifact = store._normalizeContextPackageArtifactRef(value.artifact, integrity);
  const valueRef = store._normalizeContextPackageValueRef(value.valueRef, integrity);
  const schema = store._normalizeContextPackageSchemaRef(value.schema, integrity);
  if (source === null && artifact === null && valueRef === null) {
    fail(`context package branch ${value.name} has no content reference`, 'package_branch_empty');
  }
  return freeze({ name: value.name, source, artifact, valueRef, schema });
}

export function _normalizeContextPackage(store, fields, integrity = false) {
  const fail = (message, code = 'context_package_invalid') => store._contextFailure(message, code, integrity);
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) fail('context package request is invalid');
  const raw = clone(fields);
  const suppliedDigest = raw.packageDigest;
  delete raw.packageDigest;
  if (!raw.provenance || typeof raw.provenance !== 'object' || Array.isArray(raw.provenance)) {
    fail('context package provenance is invalid');
  }
  if (Object.hasOwn(raw.provenance, 'packageEvent')) {
    fail('context package submission uses a lifecycle-owned field', 'reserved_package_field');
  }
  if (Object.keys(raw).sort().join(',')
    !== ['branches', 'kind', 'policyDigest', 'provenance', 'schemaVersion'].sort().join(',')) {
    fail('context package has unknown or missing fields');
  }
  if (raw.schemaVersion !== 1 || raw.kind !== 'baton.context_package') fail('context package header is invalid');
  if (Object.keys(raw.provenance).sort().join(',') !== ['principalId', 'runId'].sort().join(',')) {
    fail('context package provenance has unknown or missing fields');
  }
  if (raw.provenance.runId !== null && !validRunId(raw.provenance.runId)) {
    fail('context package provenance runId is invalid');
  }
  if (typeof raw.provenance.principalId !== 'string' || raw.provenance.principalId.length === 0
    || Buffer.byteLength(raw.provenance.principalId) > 512
    || !/^[A-Za-z0-9._:@-]+$/u.test(raw.provenance.principalId)) {
    fail('context package provenance principalId is invalid');
  }
  if (!store._contextProgramPolicy) fail('Context Program authority is unavailable', 'context_package_unavailable');
  if (!Array.isArray(raw.branches) || raw.branches.length === 0
    || raw.branches.length > store._contextProgramPolicy.maxManifestBranches) {
    fail('context package branches are invalid');
  }
  const branches = raw.branches.map((branch) => store._normalizeContextPackageBranch(branch, integrity))
    .sort((left, right) => compareCanonicalStrings(left.name, right.name));
  if (new Set(branches.map((branch) => branch.name)).size !== branches.length) {
    fail('context package branches must have unique names', 'package_branch_name_conflict');
  }
  if (!/^[a-f0-9]{64}$/.test(raw.policyDigest ?? '')
    || raw.policyDigest !== store._contextProgramPolicy.policyDigest) {
    fail('context package policy differs from the normalization authority');
  }
  const body = {
    schemaVersion: 1, kind: 'baton.context_package', branches,
    provenance: { runId: raw.provenance.runId, principalId: raw.provenance.principalId },
    policyDigest: raw.policyDigest,
  };
  const packageDigest = canonicalDigest(body);
  if (suppliedDigest !== undefined && suppliedDigest !== packageDigest) fail('context package digest is invalid');
  return freeze({ ...body, packageDigest, packageId: `context-package:${packageDigest}` });
}

export function _resolveContextPackageBranchContent(store, branch, integrity) {
  const fail = (message, code = 'context_artifact_unavailable') => store._contextFailure(message, code, integrity);
  const verification = store._contextArtifactVerification();
  let source = null; let artifact = null; let value = null;
  try {
    if (branch.source) source = store._contextArtifactRead(branch.source, verification);
    if (branch.artifact) artifact = store._contextArtifactRead(branch.artifact, verification);
  } catch (error) {
    fail(error?.message ?? `context package branch ${branch.name} content is unavailable`,
      error?.code ?? 'context_artifact_unavailable');
  }
  if (branch.valueRef) {
    const registered = store._artifacts.get(branch.valueRef.artifactId);
    if (!registered || registered.digest !== branch.valueRef.artifactDigest) {
      fail(`context package branch ${branch.name} value is unavailable`);
    }
    value = registered;
  }
  return { source, artifact, value };
}

export function resolveContextPackageBranch(store, packageDigest, branchName) {
  const record = store._contextPackages.get(packageDigest);
  if (!record) throw new CoordinationRefusal('Context package is unavailable', 'context_package_not_found');
  const branch = record.branches.find((candidate) => candidate.name === branchName);
  if (!branch) {
    throw new CoordinationRefusal(`Context package branch ${branchName} is unavailable`,
      'context_package_branch_not_found');
  }
  const resolved = store._resolveContextPackageBranchContent(branch, false);
  return freeze({
    name: branch.name, schema: branch.schema,
    source: resolved.source === null ? null : clone(resolved.source),
    artifact: resolved.artifact === null ? null : clone(resolved.artifact),
    valueRef: resolved.value === null ? null : clone(resolved.value),
  });
}

export function admitPackageCommand(store, envelope) {
  const fail = (message, code = 'board_admission_invalid') => {
    throw new CoordinationRefusal(message, code);
  };
  const fields = ['idempotencyKey', 'mutation', 'package', 'runId', 'sessionAuthority'];
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
    || Object.keys(envelope).sort().join(',') !== fields.sort().join(',')
    || !validRunId(envelope.runId) || !boundedText(envelope.idempotencyKey, 512)
    || !envelope.mutation || typeof envelope.mutation !== 'object'
    || Array.isArray(envelope.mutation)) fail('package authority envelope is invalid');
  const kind = envelope.mutation.kind;
  const mutationFields = kind === 'admit' ? ['kind'] : ['kind', 'scope'];
  if (!['admit', 'attach'].includes(kind)
    || Object.keys(envelope.mutation).sort().join(',') !== mutationFields.sort().join(',')
    || (kind === 'attach' && !/^(run|worker:[A-Za-z0-9._:-]{1,256}|board:[A-Za-z0-9._:-]{1,256})$/u.test(envelope.mutation.scope ?? ''))
    || (kind === 'admit' && (!envelope.package || typeof envelope.package !== 'object' || Array.isArray(envelope.package)))
    || (kind === 'attach' && !/^[a-f0-9]{64}$/.test(envelope.package ?? ''))) {
    fail('package authority mutation is invalid');
  }
  // Package normalization is part of closed-envelope shape. It intentionally precedes proof
  // lookup, matching the board contract's shape -> authority refusal order.
  const normalizedPackage = kind === 'admit'
    ? store._normalizeContextPackage(envelope.package, false) : null;
  const proof = envelope.sessionAuthority;
  if (proof == null) fail('an active package lease is required', 'board_lease_required');
  const proofFields = ['authorityDigest', 'expiresAt', 'orchestratorLeaseId', 'schemaVersion'];
  if (typeof proof !== 'object' || Array.isArray(proof)
    || Object.keys(proof).sort().join(',') !== proofFields.sort().join(',')
    || proof.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(proof.authorityDigest ?? '')
    || !boundedText(proof.orchestratorLeaseId, 512)
    || !Number.isFinite(Date.parse(proof.expiresAt ?? ''))) fail('package authority proof is invalid');
  const lease = store._runOrchestratorLeases.get(proof.orchestratorLeaseId);
  if (!lease || lease.status !== 'active' || Date.parse(store._clock()) >= Date.parse(lease.expiresAt)) {
    fail('an active package lease is required', 'board_lease_required');
  }
  if (proof.authorityDigest !== lease.session.authorityDigest
    || proof.expiresAt !== lease.session.expiresAt || lease.parent.runId !== envelope.runId) {
    fail('package session authority does not match its Run', 'board_session_mismatch');
  }
  const parent = store._tasks.get(lease.parent.taskId);
  if (!parent || parent.version !== lease.parent.taskVersion
    || parent.assignee !== lease.parent.workerId || parent.status !== 'working') {
    fail('an active package lease is required', 'board_lease_required');
  }
  if (kind === 'admit' && normalizedPackage.provenance.runId !== envelope.runId) {
    fail('package provenance is bound to a different Run', 'board_session_mismatch');
  }
  if (store._runStopByTarget.has(envelope.runId) || store._runStops.has(envelope.runId)
    || store._runs.get(envelope.runId)?.status === 'sealed') fail('package Run is closed', 'board_run_closed');

  const auth = {
    actor: lease.session.principalId, key: envelope.idempotencyKey,
    requestDigest: canonicalDigest(envelope),
  };
  if (kind === 'admit') {
    return store.admitContextPackage(envelope.package, auth);
  }
  return store.attachContextPackage({
    packageDigest: envelope.package, runId: envelope.runId, scope: envelope.mutation.scope,
  }, auth);
}

export function admitContextPackage(store, fields, auth) {
  const prior = store._byKey.get(auth?.key);
  if (prior) {
    const normalizedReplay = store._normalizeContextPackage(fields, false);
    if (prior.kind !== 'package.admitted'
      || prior.payload?.packageDigest !== normalizedReplay.packageDigest) {
      throw new CoordinationRefusal('context package idempotency content changed', 'board_replay_conflict');
    }
    return {
      ok: true, result: 'idempotent', event: clone(prior),
      package: store.contextPackage(prior.payload?.packageDigest),
    };
  }
  if (!store._contextProgramPolicy) {
    throw new CoordinationRefusal('Context Program authority is unavailable', 'context_package_unavailable');
  }
  const normalized = store._normalizeContextPackage(fields, false);
  // Issue #455: a ContextPackage is CONTENT-ADDRESSED — the digest IS `canonicalDigest` of the
  // normalized body above (docs/32 §3.3's immutable, digest-named branches; docs/47 §6's "no
  // mutable refs") — so a second admission of an already-admitted digest is not a conflict: it is
  // the SAME package, and the record that already holds it is this call's answer. What stood here
  // was a `context_package_conflict` refusal, and it refused every second lane on one issue, every
  // `--resume-from` successor and every re-recruit after a provider fault (#442's own remedy) at
  // the door — the #441 recruit leg could never re-read the world it had already read.
  //
  // `context_package_conflict` is RETIRED from this path rather than narrowed to "a different
  // package claiming the same identity": equal digest implies an equal normalized body, so no such
  // pair exists to judge here. A reuse appends nothing and re-resolves nothing — the admission is
  // the durable fact, and `resolveContextPackageBranch` stays the one lazy revalidation point
  // (docs/47 §93.5) — while a changed body or a changed doc ref is a different digest and takes
  // the fresh-admission path below, leaving every older run on the package it was admitted with.
  if (store._contextPackages.has(normalized.packageDigest)) {
    const reused = store.contextPackage(normalized.packageDigest);
    return {
      ok: true, result: 'reused', reused: true,
      event: clone(store._events[reused.admittedEvent - 1]),
      package: reused,
    };
  }
  for (const branch of normalized.branches) store._resolveContextPackageBranchContent(branch, false);
  const { packageId: _packageId, ...payload } = normalized;
  // KG-2 Part C rules 11-13: one Source node per unique wrapped-cell content digest
  // (check-before-write against a live queryKnowledge read, so re-wrapping an already-cited
  // cell mints nothing new), one package Finding unconditionally, and one DerivedFrom edge per
  // unique wrapped-cell Source (fresh or already present) — all atomic with the admission.
  const admitSeq = store._events.length + 1;
  const uniqueDigests = [...new Set(normalized.branches.filter((branch) => branch.valueRef).map((branch) => branch.valueRef.valueDigest))];
  const sourceIds = uniqueDigests.map((valueDigest) => `source:cell:${valueDigest}`);
  const existingSourceIds = sourceIds.length === 0
    ? new Set()
    : new Set(store.queryKnowledge({ ids: sourceIds }).map((node) => node.id));
  const findingId = `finding:package:${normalized.packageDigest}`;
  const entries = [{ kind: 'package.admitted', payload, auth }];
  for (let index = 0; index < sourceIds.length; index += 1) {
    const sourceId = sourceIds[index];
    if (existingSourceIds.has(sourceId)) continue;
    const sourcePayload = store._prepareKnowledgeNode({
      id: sourceId, type: 'Source', grounding: 'observed',
      evidence: [{ coordinationSeq: admitSeq }],
      promotion: { kind: 'Source', trigger: 'package.wrapped_cell' },
      cellDigest: uniqueDigests[index], runId: normalized.provenance.runId,
    }, null, false);
    entries.push({
      kind: 'knowledge.node_added', payload: sourcePayload,
      auth: { actor: 'policy', key: `knowledge.node_added:${sourceId}` },
    });
  }
  const findingPayload = store._prepareKnowledgeNode({
    id: findingId, type: 'Finding', grounding: 'observed',
    evidence: [{ coordinationSeq: admitSeq }],
    promotion: { kind: 'Finding', trigger: 'package.admitted' },
  }, null, false);
  entries.push({
    kind: 'knowledge.node_added', payload: findingPayload,
    auth: { actor: 'policy', key: `knowledge.node_added:${findingId}` },
  });
  for (const sourceId of sourceIds) {
    const edgeId = `knowledge-edge:derivedfrom:${findingId}:${sourceId}`;
    const edgePayload = store._knowledgePayload(
      { from: findingId, to: sourceId, type: 'DerivedFrom', evidence: [{ coordinationSeq: admitSeq }] },
      { id: edgeId },
    );
    entries.push({
      kind: 'knowledge.edge_added', payload: edgePayload,
      auth: { actor: 'policy', key: `knowledge.edge_added:${edgeId}` },
    });
  }
  const [event] = store._appendBatch(entries);
  const pkg = store.contextPackage(normalized.packageDigest);
  if (!pkg || pkg.admittedEvent !== event.seq) {
    throw new CoordinationIntegrityError('Context package admission did not materialize',
      'context_package_integrity');
  }
  return { ok: true, result: 'admitted', event: clone(event), package: pkg };
}

export function admitContextSession(store, fields, auth) {
  if (!store._contextProgramPolicy) {
    throw new CoordinationRefusal('Context Program authority is unavailable',
      'context_session_unavailable');
  }
  const deployment = store._currentContextDeployment();
  let session;
  try {
    session = contextSessionIdentity({
      manifest: fields?.manifest, environmentDigest: fields?.environmentDigest,
      policy: deployment.policy,
    });
  } catch (error) {
    throw new CoordinationRefusal(error.message, 'context_session_invalid');
  }
  let authority;
  try {
    authority = normalizeContextAuthority({
      actor: auth?.actor, principalId: auth?.principalId,
      repoId: auth?.repoId, runId: auth?.runId,
    });
  } catch (error) {
    throw new CoordinationRefusal(error.message, 'context_session_invalid');
  }
  const requestCore = {
    actor: authority.actor, principalId: authority.principalId,
    repoId: authority.repoId, runId: authority.runId,
    manifestDigest: session.manifestDigest, environmentDigest: session.environmentDigest,
  };
  const prior = store._byKey.get(auth?.key);
  if (prior) {
    if (prior.kind !== 'context.session_admitted' || prior.actor !== auth.actor
      || canonicalDigest(prior.payload?.authority) !== canonicalDigest(authority)
      || canonicalDigest(prior.payload?.deployment) !== canonicalDigest(deployment)
      || canonicalDigest(prior.payload?.session) !== canonicalDigest(session)
      || prior.payload?.requestDigest !== canonicalDigest(requestCore)) {
      throw new CoordinationRefusal('Context session idempotency key is bound differently',
        'context_session_conflict');
    }
    const projected = store.contextSession(session.sessionId);
    if (!projected || projected.admittedEvent !== prior.seq) {
      throw new CoordinationIntegrityError('Context session projection is absent',
        'context_session_integrity');
    }
    return freeze({ ok: true, result: 'idempotent', event: clone(prior), session: projected });
  }
  const plan = store._plans.get(store._planVersionKey(
    session.manifest.workflow.plan.planId, session.manifest.workflow.plan.version,
  ));
  const node = plan?.nodes.find((candidate) => (
    candidate.key === session.manifest.workflow.node.key
  ));
  if (!node) {
    throw new CoordinationRefusal('Context source has no Plan node authority',
      'context_source_attestation_invalid');
  }
  const sourceAttestations = [];
  for (const branch of session.manifest.branches) {
    let source;
    try {
      source = store._contextReferenceRead({
        kind: 'context_source', ref: branch.ref, digest: branch.digest,
        mediaType: branch.mediaType, itemCount: branch.itemCount,
      });
    } catch (error) {
      throw new CoordinationRefusal(error?.message ?? 'Context source is unavailable',
        error?.code ?? 'context_source_unavailable');
    }
    const items = Array.isArray(source) ? source : [source];
    if (contextValueDigest(source) !== branch.digest || items.length !== branch.itemCount) {
      throw new CoordinationRefusal('Context source differs from its manifest',
        'context_source_integrity');
    }
    let attestation;
    try {
      attestation = store._contextSourceAttest({
        manifest: session.manifest, branch: clone(branch), source: clone(source),
      });
    } catch (error) {
      throw new CoordinationRefusal(error?.message ?? 'Context source attestation is unavailable',
        error?.code ?? 'context_source_attestation_invalid');
    }
    sourceAttestations.push(store._normalizeContextSourceAttestation(attestation, {
      deployment, manifest: session.manifest, node, branch, source,
    }, false));
  }
  const admissionCore = { authority, deployment, session, sourceAttestations };
  const payload = {
    schemaVersion: 2, authority, requestDigest: canonicalDigest(requestCore),
    deployment, session, sourceAttestations,
    admissionDigest: canonicalDigest(admissionCore),
  };
  const prospective = {
    schemaVersion: 1, seq: store._events.length + 1, ts: store._clock(),
    kind: 'context.session_admitted', actor: auth?.actor,
    idempotencyKey: auth?.key, payload,
  };
  store._validateContextSessionPayload(payload, prospective, false);
  const event = store._append('context.session_admitted', payload, auth, prospective.ts);
  const projected = store.contextSession(session.sessionId);
  if (projected?.admittedEvent !== event.seq) {
    throw new CoordinationIntegrityError('Context session admission did not materialize',
      'context_session_integrity');
  }
  return freeze({ ok: true, result: 'admitted', event: clone(event), session: projected });
}

export function replManifestAdmission(state, manifestDigest) {
  return clone(state.get(manifestDigest) ?? null);
}

export function _replManifestFailure(message, code, integrity = false) {
  if (integrity) throw new CoordinationIntegrityError(message, code);
  throw new CoordinationRefusal(message, code);
}

export function _validateReplManifestAdmissionPayload(store, payload, event, integrity = false) {
  const fail = (message, code) => store._replManifestFailure(message, code, integrity);
  const fields = ['branches', 'manifestDigest', 'principal', 'replRole', 'requestDigest', 'runId', 'schemaVersion'];
  const workerRole = /^worker:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).sort().join(',') !== fields.join(',')
    || payload.schemaVersion !== 1
    || !/^[a-f0-9]{64}$/u.test(payload.manifestDigest ?? '')
    || !validRunId(payload.runId)
    || (payload.replRole !== 'shared' && !workerRole.test(payload.replRole ?? ''))
    || !payload.principal || typeof payload.principal !== 'object' || Array.isArray(payload.principal)
    || Object.keys(payload.principal).sort().join(',') !== 'actor,principalId'
    || typeof payload.principal.actor !== 'string' || payload.principal.actor.length === 0
    || !validRunId(payload.principal.principalId)
    || !/^[a-f0-9]{64}$/u.test(payload.requestDigest ?? '')) {
    fail('Context REPL manifest admission is malformed', 'repl_manifest_integrity');
  }
  // REPL-3 (docs/33 v2 rule 8): the event carries the RESOLVED branch list, so replay
  // reconstructs the exact coordinates with zero store lookups. Shapes only — the fold
  // must stay pure (no cell/CAS reads here).
  if (!Array.isArray(payload.branches) || payload.branches.length === 0
    || payload.branches.length > 1_024
    || payload.branches.some((branch) => !branch || typeof branch !== 'object' || Array.isArray(branch)
      || Object.keys(branch).sort().join(',') !== 'digest,itemCount,mediaType,name,ref,summary'
      || typeof branch.name !== 'string' || branch.name.length === 0 || branch.name.length > 1_024
      || !/^[a-f0-9]{64}$/u.test(branch.digest ?? '')
      || branch.ref !== `ctx:sha256:${branch.digest}`
      || !Number.isSafeInteger(branch.itemCount) || branch.itemCount < 0
      || typeof branch.mediaType !== 'string' || branch.mediaType.length === 0 || branch.mediaType.length > 256
      || typeof branch.summary !== 'string' || branch.summary.length === 0 || branch.summary.length > 4_096)
    || new Set(payload.branches.map((branch) => branch.name)).size !== payload.branches.length
    || new Set(payload.branches.map((branch) => branch.ref)).size !== payload.branches.length) {
    fail('Context REPL manifest admission branches are malformed', 'repl_manifest_integrity');
  }
  const requestCore = {
    manifestDigest: payload.manifestDigest, runId: payload.runId,
    replRole: payload.replRole, principal: payload.principal,
  };
  if (payload.requestDigest !== canonicalDigest(requestCore)
    || event.actor !== payload.principal.actor
    || (workerRole.test(payload.replRole)
      && payload.replRole !== `worker:${payload.principal.principalId}`)) {
    fail('Context REPL manifest admission authority changed', 'repl_manifest_integrity');
  }
  return freeze(clone(payload));
}

export function admitReplManifest(store, fields, auth) {
  if (!store._contextProgramPolicy) {
    throw new CoordinationRefusal('Context Program authority is unavailable', 'repl_manifest_unavailable');
  }
  const deployment = store._currentContextDeployment();
  // (a) re-normalize the submitted manifest and prove its digest. REPL-3: `cell:`-typed raw
  // branches are resolved FIRST (settled-only, hub-computed coordinates — Part F rules 17-19),
  // so normalization and the digest cover the resolved coordinates (docs/33 v2 rule 8).
  let manifestInput = fields?.manifest;
  if (manifestInput && Array.isArray(manifestInput.branches)
    && manifestInput.branches.some((branch) => branch && typeof branch === 'object'
      && !Array.isArray(branch) && Object.hasOwn(branch, 'cell'))) {
    manifestInput = {
      ...clone(manifestInput),
      branches: manifestInput.branches.map((branch) => (
        branch && typeof branch === 'object' && !Array.isArray(branch) && Object.hasOwn(branch, 'cell')
          ? store._resolveReplManifestBranch(branch) : branch)),
    };
  }
  let manifest;
  try { manifest = normalizeReplManifest(manifestInput, deployment.policy); }
  catch (error) { throw new CoordinationRefusal(error.message, error.code ?? 'repl_manifest_invalid'); }
  if (fields?.manifestDigest !== undefined && fields.manifestDigest !== manifest.digest) {
    throw new CoordinationRefusal('Context REPL manifest digest differs from its bytes',
      'repl_manifest_digest_mismatch');
  }
  const runId = manifest.repl.runId;
  const replRole = manifest.repl.replRole;
  // (c) repoId provenance pin (mirrors the Workflow path authority.repoId !== store._repoId).
  if (auth?.repoId !== store._repoId) {
    throw new CoordinationRefusal('Context REPL manifest repository differs from deployment authority',
      'repl_manifest_authority_denied');
  }
  // (c) principal authority: lease-authenticated + run-pinned for `shared`; store-verified
  // equality against the wrapper-derived principalId for `worker:<id>`.
  let principal;
  if (replRole === 'shared') {
    let lease;
    try { lease = store._activeRunOrchestratorLease(auth); }
    catch (error) {
      throw new CoordinationRefusal(error?.message ?? 'Context REPL shared manifest lacks orchestrator authority',
        'repl_manifest_authority_denied');
    }
    if (lease.parent.runId !== runId) {
      throw new CoordinationRefusal('Context REPL shared manifest run differs from its orchestrator lease',
        'repl_manifest_authority_denied');
    }
    principal = { actor: auth.actor, principalId: lease.session.principalId };
  } else if (replRole === `worker:${auth?.principalId}`) {
    principal = { actor: auth?.actor, principalId: auth.principalId };
  } else {
    throw new CoordinationRefusal('Context REPL worker manifest names another worker',
      'repl_manifest_authority_denied');
  }
  const requestCore = { manifestDigest: manifest.digest, runId, replRole, principal };
  const payload = {
    schemaVersion: 1, manifestDigest: manifest.digest, runId, replRole,
    principal: { actor: principal.actor, principalId: principal.principalId },
    requestDigest: canonicalDigest(requestCore),
    // REPL-3 (docs/33 v2 rule 8): the RESOLVED branch list, replay-derivable with zero
    // store lookups (cell: coordinates were baked by the pre-normalization splice above).
    branches: clone(manifest.branches),
  };
  // (f) two-level idempotency/conflict. First the key level.
  const prior = store._byKey.get(auth?.key);
  if (prior) {
    if (prior.kind !== 'repl.manifest_admitted' || prior.actor !== auth?.actor
      || prior.payload?.requestDigest !== payload.requestDigest
      || prior.payload?.manifestDigest !== payload.manifestDigest) {
      throw new CoordinationRefusal('Context REPL manifest idempotency key is bound differently',
        'repl_manifest_conflict');
    }
    const projected = store.replManifestAdmission(manifest.digest);
    if (!projected || projected.admittedEvent !== prior.seq) {
      throw new CoordinationIntegrityError('Context REPL manifest projection is absent',
        'repl_manifest_integrity');
    }
    return freeze({ ok: true, result: 'idempotent', event: clone(prior), record: projected });
  }
  // Then the digest level (the map is keyed by manifestDigest, so a divergent principal under a
  // different key would otherwise be last-wins).
  const existing = store._replManifestAdmissions.get(manifest.digest);
  if (existing) {
    if (existing.requestDigest === payload.requestDigest) {
      return freeze({
        ok: true, result: 'idempotent',
        event: clone(store._events[existing.admittedEvent - 1]), record: clone(existing),
      });
    }
    throw new CoordinationRefusal('Context REPL manifest admission principal diverged',
      'repl_manifest_conflict');
  }
  // (d) the run must not be stopping.
  store._assertRunAdmissionOpen(runId);
  // (e) per-run bounds (a named, digest-safe run-lineage ceiling; never a magic store constant).
  const ceiling = store._runLineagePolicy?.maxReplManifestsPerRun ?? DEFAULT_MAX_REPL_MANIFESTS_PER_RUN;
  const perRun = [...store._replManifestAdmissions.values()].filter((row) => row.runId === runId).length;
  if (perRun >= ceiling) {
    throw new CoordinationRefusal('Context REPL manifest per-run ceiling reached', 'repl_manifest_limit');
  }
  const prospective = {
    schemaVersion: 1, seq: store._events.length + 1, ts: store._clock(),
    kind: 'repl.manifest_admitted', actor: auth?.actor, idempotencyKey: auth?.key, payload,
  };
  store._validateReplManifestAdmissionPayload(payload, prospective, false);
  const event = store._append('repl.manifest_admitted', payload, auth, prospective.ts);
  const projected = store.replManifestAdmission(manifest.digest);
  if (projected?.admittedEvent !== event.seq) {
    throw new CoordinationIntegrityError('Context REPL manifest admission did not materialize',
      'repl_manifest_integrity');
  }
  return freeze({ ok: true, result: 'admitted', event: clone(event), record: projected });
}

export function admitReplSession(store, fields, auth) {
  if (!store._contextProgramPolicy) {
    throw new CoordinationRefusal('Context Program authority is unavailable', 'context_session_unavailable');
  }
  const deployment = store._currentContextDeployment();
  let session;
  try {
    session = contextSessionIdentity({
      manifest: fields?.manifest, environmentDigest: fields?.environmentDigest,
      policy: deployment.policy,
    });
  } catch (error) {
    throw new CoordinationRefusal(error.message, 'context_session_invalid');
  }
  if (session.manifest.kind !== 'baton.repl_manifest') {
    throw new CoordinationRefusal('Context REPL session requires a repl manifest', 'context_session_invalid');
  }
  const admission = store._replManifestAdmissions.get(session.manifestDigest);
  if (!admission || admission.runId !== session.runId
    || admission.replRole !== session.manifest.repl.replRole) {
    throw new CoordinationRefusal('Context REPL manifest is not admitted', 'repl_session_unadmitted');
  }
  let authority;
  try {
    authority = normalizeContextAuthority({
      actor: admission.principal.actor, principalId: admission.principal.principalId,
      repoId: store._repoId, runId: session.runId,
    });
  } catch (error) {
    throw new CoordinationRefusal(error.message, 'context_session_invalid');
  }
  const requestCore = {
    actor: authority.actor, principalId: authority.principalId,
    repoId: authority.repoId, runId: authority.runId,
    manifestDigest: session.manifestDigest, environmentDigest: session.environmentDigest,
  };
  const prior = store._byKey.get(auth?.key);
  if (prior) {
    if (prior.kind !== 'context.session_admitted' || prior.actor !== auth.actor
      || canonicalDigest(prior.payload?.authority) !== canonicalDigest(authority)
      || canonicalDigest(prior.payload?.deployment) !== canonicalDigest(deployment)
      || canonicalDigest(prior.payload?.session) !== canonicalDigest(session)
      || prior.payload?.requestDigest !== canonicalDigest(requestCore)) {
      throw new CoordinationRefusal('Context session idempotency key is bound differently',
        'context_session_conflict');
    }
    const projected = store.contextSession(session.sessionId);
    if (!projected || projected.admittedEvent !== prior.seq) {
      throw new CoordinationIntegrityError('Context session projection is absent',
        'context_session_integrity');
    }
    return freeze({ ok: true, result: 'idempotent', event: clone(prior), session: projected });
  }
  for (const branch of session.manifest.branches) {
    let source;
    try {
      source = store._contextReferenceRead({
        kind: 'context_source', ref: branch.ref, digest: branch.digest,
        mediaType: branch.mediaType, itemCount: branch.itemCount,
      });
    } catch (error) {
      throw new CoordinationRefusal(error?.message ?? 'Context source is unavailable',
        error?.code ?? 'context_source_unavailable');
    }
    const items = Array.isArray(source) ? source : [source];
    if (contextValueDigest(source) !== branch.digest || items.length !== branch.itemCount) {
      throw new CoordinationRefusal('Context source differs from its manifest',
        'context_source_integrity');
    }
  }
  const admissionCore = { authority, deployment, session };
  const payload = {
    schemaVersion: 1, authority, requestDigest: canonicalDigest(requestCore),
    deployment, session, admissionDigest: canonicalDigest(admissionCore),
  };
  const prospective = {
    schemaVersion: 1, seq: store._events.length + 1, ts: store._clock(),
    kind: 'context.session_admitted', actor: auth?.actor,
    idempotencyKey: auth?.key, payload,
  };
  store._validateContextSessionPayload(payload, prospective, false);
  const event = store._append('context.session_admitted', payload, auth, prospective.ts);
  const projected = store.contextSession(session.sessionId);
  if (projected?.admittedEvent !== event.seq) {
    throw new CoordinationIntegrityError('Context session admission did not materialize',
      'context_session_integrity');
  }
  return freeze({ ok: true, result: 'admitted', event: clone(event), session: projected });
}

export function admitContextCell(store, fields, auth) {
  if (!store._contextProgramPolicy) {
    throw new CoordinationRefusal('Context Program authority is unavailable',
      'context_cell_unavailable');
  }
  const session = store._contextSessions.get(fields?.sessionId);
  if (!session) throw new CoordinationRefusal('Context session is unavailable',
    'context_cell_invalid');
  const contextPolicy = store._normalizeContextDeployment(session.deployment, false).policy;
  let program;
  try { program = normalizeContextProgram(fields?.program, contextPolicy); }
  catch (error) { throw new CoordinationRefusal(error.message, 'context_cell_invalid'); }
  if (!contextProgramIsPure(program, contextPolicy)) {
    throw new CoordinationRefusal('Provider-effect Context Program requires Workflow authority',
      'context_cell_effect_requires_workflow');
  }
  const prior = store._byKey.get(auth?.key);
  if (prior) {
    const priorCell = prior.payload?.cell;
    const expectedAuthority = {
      actor: auth?.actor, principalId: auth?.principalId,
      repoId: auth?.repoId, runId: auth?.runId ?? null,
    };
    if (prior.kind !== 'context.cell_admitted' || prior.actor !== auth.actor
      || priorCell?.sessionId !== session.sessionId
      || canonicalDigest(priorCell?.program) !== canonicalDigest(program)
      || canonicalDigest(prior.payload?.authority) !== canonicalDigest(expectedAuthority)) {
      throw new CoordinationRefusal('Context cell idempotency key is bound differently',
        'context_cell_conflict');
    }
    const projected = store.contextCell(priorCell.cellId);
    if (!projected || projected.admittedEvent !== prior.seq) {
      throw new CoordinationIntegrityError('Context cell projection is absent',
        'context_cell_integrity');
    }
    return freeze({ ok: true, result: 'idempotent', event: clone(prior), cell: projected });
  }
  const cells = [...store._contextCells.values()].filter((row) => row.sessionId === session.sessionId);
  const cell = contextCellIdentity({
    session, program, ordinal: cells.length + 1,
    predecessor: cells.length === 0 ? null : cells.at(-1).cellId,
    policy: contextPolicy,
  });
  let authority;
  try {
    authority = normalizeContextAuthority({
      actor: auth?.actor, principalId: auth?.principalId,
      repoId: auth?.repoId, runId: auth?.runId,
    });
  } catch (error) {
    throw new CoordinationRefusal(error.message, 'context_cell_invalid');
  }
  if (canonicalDigest(authority) !== canonicalDigest(session.authority)) {
    throw new CoordinationRefusal('Context cell principal differs from session admission',
      'context_cell_unauthorized');
  }
  const requestCore = {
    actor: authority.actor, principalId: authority.principalId,
    repoId: authority.repoId, runId: authority.runId,
    sessionId: session.sessionId, programDigest: program.programDigest,
  };
  const payload = {
    schemaVersion: 1, authority, requestDigest: canonicalDigest(requestCore),
    cell, admissionDigest: cell.admissionDigest,
  };
  const prospective = {
    schemaVersion: 1, seq: store._events.length + 1, ts: store._clock(),
    kind: 'context.cell_admitted', actor: auth?.actor,
    idempotencyKey: auth?.key, payload,
  };
  store._validateContextCellAdmissionPayload(payload, prospective, false);
  const event = store._append('context.cell_admitted', payload, auth, prospective.ts);
  const projected = store.contextCell(cell.cellId);
  if (projected?.admittedEvent !== event.seq) {
    throw new CoordinationIntegrityError('Context cell admission did not materialize',
      'context_cell_integrity');
  }
  return freeze({ ok: true, result: 'admitted', event: clone(event), cell: projected });
}

export function admitContextMapCall(store, fields, auth) {
  if (!store._contextProgramPolicy || !store._goalPlanPolicy) {
    throw new CoordinationRefusal('Context map authority is unavailable',
      'context_map_unavailable');
  }
  let authority; let call;
  try {
    authority = normalizeContextAuthority({
      actor: auth?.actor, principalId: auth?.principalId,
      repoId: auth?.repoId, runId: auth?.runId,
    });
    call = contextMapCallIdentity(fields?.call);
  } catch (error) {
    throw new CoordinationRefusal(error.message, 'context_map_call_invalid');
  }
  const predecessor = store._plans.get(store._planVersionKey(
    call.source.predecessorPlan.planId, call.source.predecessorPlan.version,
  ));
  const goal = predecessor ? store._goals.get(store._goalVersionKey(
    predecessor.goal.goalId, predecessor.goal.version,
  )) : null;
  if (!goal) throw new CoordinationRefusal('Context map Goal is unavailable',
    'context_map_plan_invalid');
  let planRequest;
  try { planRequest = normalizePlanRequest(fields?.planRequest, store._goalPlanPolicy, goal); }
  catch (error) {
    throw new CoordinationRefusal(error.message, error.code ?? 'context_map_plan_invalid');
  }
  const expectedPlanDigest = goalPlanDigest({
    schemaVersion: 1, repoId: store._repoId, runId: call.source.runId,
    goal: planRequest.goal, predecessor: planRequest.predecessor,
    nodes: planRequest.nodes, totals: planRequest.totals,
    policyDigest: store._goalPlanPolicy.policyDigest,
  });
  if (fields?.expectedPlanDigest !== expectedPlanDigest) {
    throw new CoordinationRefusal('Context map expected Plan digest changed',
      'context_map_plan_invalid');
  }
  const requestCore = { authority, call, planRequest, expectedPlanDigest };
  const cell = store._contextCells.get(call.source.cellId);
  const admissionCore = {
    ...requestCore, sourceCellSettlementDigest: cell?.settlementDigest ?? null,
  };
  const payload = {
    schemaVersion: 1, authority, call, planRequest, expectedPlanDigest,
    requestDigest: canonicalDigest(requestCore),
    admissionDigest: canonicalDigest(admissionCore),
  };
  const prior = store._byKey.get(auth?.key);
  if (prior) {
    if (prior.kind !== 'context.call_admitted' || prior.actor !== auth.actor
      || canonicalDigest(prior.payload) !== canonicalDigest(payload)) {
      throw new CoordinationRefusal('Context map call idempotency key is bound differently',
        'context_map_call_conflict');
    }
    const projected = store.contextCall(call.callId);
    if (!projected || projected.admittedEvent !== prior.seq) {
      throw new CoordinationIntegrityError('Context map call projection is absent',
        'context_map_call_integrity');
    }
    return freeze({ ok: true, result: 'idempotent', event: clone(prior), call: projected });
  }
  const prospective = {
    schemaVersion: 1, seq: store._events.length + 1, ts: store._clock(),
    kind: 'context.call_admitted', actor: auth?.actor,
    idempotencyKey: auth?.key, payload,
  };
  store._validateContextMapCallAdmissionPayload(payload, prospective, false);
  const event = store._append('context.call_admitted', payload, auth, prospective.ts);
  const projected = store.contextCall(call.callId);
  if (projected?.admittedEvent !== event.seq) {
    throw new CoordinationIntegrityError('Context map call admission did not materialize',
      'context_map_call_integrity');
  }
  return freeze({ ok: true, result: 'admitted', event: clone(event), call: projected });
}

export function admitContextEffectCall(store, fields, auth) {
  if (!store._contextProgramPolicy || !store._goalPlanPolicy) {
    throw new CoordinationRefusal('Context effect-call authority is unavailable',
      'context_call_unavailable');
  }
  let call;
  try { call = normalizeContextEffectCall(fields?.call); }
  catch (error) {
    throw new CoordinationRefusal(error.message, error.code ?? 'context_call_invalid');
  }
  const callAuthority = call.authority;
  const principal = callAuthority.contextPrincipal;
  const requester = callAuthority.requester;
  if (auth?.actor !== principal.actor || auth?.principalId !== principal.principalId
    || auth?.repoId !== principal.repoId || auth?.runId !== principal.runId
    || auth?.requesterPrincipalId !== requester.principalId
    || auth?.requesterSessionId !== requester.sessionId) {
    throw new CoordinationRefusal('Context effect-call service or requester authority differs',
      'context_call_unauthorized');
  }
  const authority = normalizeContextAuthority({
    actor: auth.actor, principalId: auth.principalId,
    repoId: auth.repoId, runId: auth.runId,
  });
  const predecessor = store._plans.get(store._planVersionKey(
    callAuthority.predecessorPlan.planId, callAuthority.predecessorPlan.version,
  ));
  const goal = predecessor ? store._goals.get(store._goalVersionKey(
    predecessor.goal.goalId, predecessor.goal.version,
  )) : null;
  if (!goal) throw new CoordinationRefusal('Context effect-call Goal is unavailable',
    'context_call_plan_invalid');
  let planRequest;
  try { planRequest = normalizePlanRequest(fields?.planRequest, store._goalPlanPolicy, goal); }
  catch (error) {
    throw new CoordinationRefusal(error.message, error.code ?? 'context_call_plan_invalid');
  }
  const expectedPlanDigest = goalPlanDigest({
    schemaVersion: 1, repoId: store._repoId, runId: principal.runId,
    goal: planRequest.goal, predecessor: planRequest.predecessor,
    nodes: planRequest.nodes, totals: planRequest.totals,
    policyDigest: store._goalPlanPolicy.policyDigest,
  });
  if (fields?.expectedPlanDigest !== expectedPlanDigest) {
    throw new CoordinationRefusal('Context effect-call expected Plan digest changed',
      'context_call_plan_invalid');
  }
  const sourceSettlementDigest = call.operator === 'map'
    ? store._contextCells.get(call.source.id)?.settlementDigest ?? null
    : store._contextCalls.get(call.source.id)?.settlementDigest ?? null;
  const requestCore = { authority, call, planRequest, expectedPlanDigest };
  const admissionCore = {
    ...requestCore, sourceSettlementDigest,
  };
  const payload = {
    schemaVersion: 2, authority, call, planRequest, expectedPlanDigest,
    requestDigest: canonicalDigest(requestCore),
    admissionDigest: canonicalDigest(admissionCore),
  };
  const prior = store._byKey.get(auth?.key);
  if (prior) {
    if (prior.kind !== 'context.call_admitted' || prior.actor !== auth.actor
      || canonicalDigest(prior.payload) !== canonicalDigest(payload)) {
      throw new CoordinationRefusal('Context effect-call idempotency key is bound differently',
        'context_call_conflict');
    }
    const projected = store.contextCall(call.callId);
    if (!projected || projected.admittedEvent !== prior.seq) {
      throw new CoordinationIntegrityError('Context effect-call projection is absent',
        'context_call_integrity');
    }
    return freeze({ ok: true, result: 'idempotent', event: clone(prior), call: projected });
  }
  const prospective = {
    schemaVersion: 1, seq: store._events.length + 1, ts: store._clock(),
    kind: 'context.call_admitted', actor: auth?.actor,
    idempotencyKey: auth?.key, payload,
  };
  store._validateContextEffectCallAdmissionPayload(payload, prospective, false);
  const event = store._append('context.call_admitted', payload, auth, prospective.ts);
  const projected = store.contextCall(call.callId);
  if (projected?.admittedEvent !== event.seq) {
    throw new CoordinationIntegrityError('Context effect-call admission did not materialize',
      'context_call_integrity');
  }
  return freeze({ ok: true, result: 'admitted', event: clone(event), call: projected });
}

export function previewPlanDispatch(store, gate, route, preservedResumeClaim = null) { return store._planDispatchState(gate, route, preservedResumeClaim); }

export function previewPlanRevision(store, gate, route) {
  const state = store._planDispatchState(gate, route, null, { allowRevision: true });
  store._workflowRevisionAuthority(state.plan, state.node);
  return state;
}

export function representationProductionAdmission(store, request, auth) {
  const preview = { actor: auth?.actor, idempotencyKey: auth?.key, seq: store._events.length + 1 };
  const state = store._representationRequest(request, preview, false, false);
  const prior = store._byKey.get(auth?.key);
  if (prior) {
    const binding = store._representationRequests.get(state.requestDigest);
    if (!['knowledge.representation_produced', 'knowledge.representation_request_bound'].includes(prior.kind)
      || prior.actor !== auth.actor || prior.payload?.requestDigest !== state.requestDigest || !binding) {
      throw new CoordinationRefusal('representation idempotency key is bound differently', 'representation_conflict');
    }
    return freeze({ ok: true, result: 'idempotent', requestDigest: state.requestDigest, policyDigest: state.policyDigest, representation: store.representationProduction(binding.identityDigest) });
  }
  store._representationRequest(request, preview, false, true);
  return freeze({ ok: true, result: 'admitted', requestDigest: state.requestDigest, policyDigest: state.policyDigest, representation: null });
}

export function prepareRepresentationProduction(store, fields, auth) {
  const preview = { schemaVersion: 1, seq: store._events.length + 1, ts: store._clock(), kind: 'knowledge.representation_produced', actor: auth?.actor, idempotencyKey: auth?.key };
  const prior = store._byKey.get(auth?.key);
  const derived = store._representationGraphTemplate(fields, preview, false, !prior);
  store._validateRepresentationNamespaces(derived, false);
  return freeze({
    identityDigest: derived.identityDigest, eventSeq: preview.seq, receipt: clone(derived.receipt), receiptSerialized: derived.receiptSerialized,
    receiptRef: clone(derived.receiptRef), projection: clone(derived.projection),
  });
}

export function _effectiveRunOrchestratorLeaseState(store, lease, now = store._clock()) {
  if (lease.status === 'revoked') return freeze({ state: 'revoked', reason: lease.revocation?.reason ?? 'session_revoked' });
  if (Date.parse(now) >= Date.parse(lease.expiresAt)) return freeze({ state: 'expired', reason: 'expired' });
  const task = store._tasks.get(lease.parent.taskId);
  if (!task || task.version !== lease.parent.taskVersion || task.assignee !== lease.parent.workerId) {
    return freeze({ state: 'inactive', reason: 'parent_stale' });
  }
  if (task.status !== 'working') return freeze({ state: 'inactive', reason: 'parent_terminal' });
  if (store.runStop(lease.parent.runId)) return freeze({ state: 'inactive', reason: 'parent_run_stopping' });
  return freeze({ state: 'active', reason: null });
}

export function admitRunResultAdoption(store, fields, auth) {
  const preview = { actor: auth?.actor, idempotencyKey: auth?.key };
  const request = store._normalizeRunResultAdoptionRequest(fields, preview, false);
  const prior = store._byKey.get(auth.key);
  if (prior) {
    if (prior.kind !== 'run.result_adoption_admitted' || prior.actor !== auth.actor
      || prior.payload?.requestDigest !== request.requestDigest) {
      throw new CoordinationRefusal('run result adoption idempotency conflict', 'run_result_adoption_conflict');
    }
    return freeze({ ok: true, result: 'replay', event: clone(prior), adoption: store.runResultAdoption(fields.runId, fields.nodeKey) });
  }
  if (store._runResultAdoptions.has(store._runResultAdoptionKey(fields.runId, fields.nodeKey))) {
    throw new CoordinationRefusal('run result adoption identity conflict', 'run_result_adoption_conflict');
  }
  const binding = store._deriveRunResultAdoptionBinding(request, false);
  const core = {
    schemaVersion: 1, ...clone(request), retainedResultRef: retainedResultRef(request.resultSha), binding: clone(binding),
  };
  const payload = { ...core, adoptionDigest: canonicalDigest(core) };
  store._validateRunResultAdoptionAdmission(payload, { ...preview, payload }, false);
  const event = store._append('run.result_adoption_admitted', payload, auth);
  return freeze({ ok: true, result: 'admitted', event: clone(event), adoption: store.runResultAdoption(fields.runId, fields.nodeKey) });
}

export function _runVerificationRetryFailure(message, code = 'run_verification_retry_integrity', integrity = false) {
  throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code);
}

export function _normalizeRunVerificationRetryRequest(store, fields, event, integrity = false) {
  const fail = (message, code = 'run_verification_retry_invalid') => store._runVerificationRetryFailure(message, code, integrity);
  const expected = ['attempt', 'baseSha', 'checkpointRef', 'checkpointSha', 'nodeKey', 'originOutcome',
    'planDigest', 'priorEvidence', 'reasonDigest', 'repoId', 'requestDigest', 'runId',
    'runtimePolicyDigest', 'schemaVersion', 'taskId', 'toolchainDigest', 'verificationDigest'];
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)
    || Object.keys(fields).sort().join(',') !== expected.join(',') || fields.schemaVersion !== 1
    || !validRunId(fields.repoId) || !validRunId(fields.runId) || !boundedText(fields.nodeKey, 256)
    || !boundedText(fields.taskId, 4_096) || !Number.isSafeInteger(fields.attempt) || fields.attempt < 1
    || !validResultSha(fields.checkpointSha)
    || !validResultSha(fields.baseSha)
    || fields.checkpointRef !== `refs/baton/checkpoints/${fields.checkpointSha}`
    || !['inconclusive', 'candidate_failed'].includes(fields.originOutcome)
    || !fields.priorEvidence || typeof fields.priorEvidence !== 'object' || Array.isArray(fields.priorEvidence)
    || Object.keys(fields.priorEvidence).join(',') !== 'coordinationSeq'
    || !Number.isSafeInteger(fields.priorEvidence.coordinationSeq)
    || !/^[a-f0-9]{64}$/.test(fields.planDigest ?? '') || !/^[a-f0-9]{64}$/.test(fields.verificationDigest ?? '')
    || !/^[a-f0-9]{64}$/.test(fields.runtimePolicyDigest ?? '') || !/^[a-f0-9]{64}$/.test(fields.toolchainDigest ?? '')
    || !/^[a-f0-9]{64}$/.test(fields.reasonDigest ?? '')
    || !/^[a-f0-9]{64}$/.test(fields.requestDigest ?? '')) fail('run verification retry request is invalid');
  const requestCore = Object.fromEntries(expected.filter((key) => key !== 'requestDigest')
    .map((key) => [key, clone(fields[key])]));
  if (fields.requestDigest !== canonicalDigest(requestCore)) fail('run verification retry request digest is invalid');
  const expectedKey = `run.verification_retry:${fields.runId}:${fields.nodeKey}:${fields.attempt}`;
  if (event?.idempotencyKey !== expectedKey || !boundedText(event?.actor, 256)) fail('run verification retry authority is invalid');
  return freeze({ ...clone(requestCore), requestDigest: fields.requestDigest });
}

export function _validateRunVerificationRetryAdmission(store, p, event, integrity = false) {
  const fail = (message, code = 'run_verification_retry_unavailable') => store._runVerificationRetryFailure(message, code, integrity);
  const request = store._normalizeRunVerificationRetryRequest(
    Object.fromEntries(Object.entries(p ?? {}).filter(([key]) => key !== 'admissionDigest')), event, integrity,
  );
  if (!/^[a-f0-9]{64}$/.test(p?.admissionDigest ?? '')
    || p.admissionDigest !== canonicalDigest(Object.fromEntries(Object.entries(p).filter(([key]) => key !== 'admissionDigest')))) {
    store._runVerificationRetryFailure('run verification retry admission digest is invalid', 'run_verification_retry_integrity', integrity);
  }
  const task = store._tasks.get(request.taskId);
  const dispatch = store._planTaskLinks.get(request.taskId);
  const goalPlan = task?.brief?.goalPlan;
  if (!task || task.runId !== request.runId || task.status !== 'failed' || task.acceptanceRevocation
    || !dispatch || !goalPlan || dispatch.taskId !== task.id || dispatch.binding?.nodeKey !== request.nodeKey
    || canonicalDigest(dispatch.binding) !== canonicalDigest(goalPlan)) {
    fail('run verification retry requires the exact failed approved Plan task');
  }
  const plan = store._plans.get(store._planVersionKey(goalPlan.planId, goalPlan.planVersion));
  const approval = store._planApprovals.get(store._planVersionKey(goalPlan.planId, goalPlan.planVersion));
  const node = plan?.nodes?.find((row) => row.key === request.nodeKey);
  if (!plan || !approval || approval.disposition !== 'approved' || !node
    || plan.repoId !== request.repoId || plan.runId !== request.runId
    || plan.digest !== request.planDigest || plan.digest !== goalPlan.planDigest
    || canonicalDigest(node.verification) !== request.verificationDigest) {
    fail('run verification retry Plan authority is unavailable or changed');
  }
  const { source } = store._readRetryVerificationEvidence(request.priorEvidence, integrity);
  if (source.worker !== task.assignee || source.payload?.accept === true
    || source.payload?.verdict?.outcome !== request.originOutcome
    || source.payload?.capture?.checkpoint?.sha !== request.checkpointSha
    || source.payload?.capture?.checkpoint?.ref !== request.checkpointRef
    || source.payload?.capture?.checkpoint?.state !== 'pinned'
    || source.payload?.capture?.checkpoint?.originOutcome !== request.originOutcome
    || source.payload?.capture?.baseSha !== request.baseSha
    || canonicalDigest(source.payload?.capture?.toolchainProjection ?? null) !== request.toolchainDigest
    || (request.originOutcome === 'candidate_failed'
      && source.payload?.verdict?.runtimeDigest !== request.runtimePolicyDigest)) {
    fail('run verification retry evidence is not the exact diagnostic checkpointed attempt');
  }
  const existing = store._runVerificationRetries.get(store._runVerificationRetryKey(request.runId, request.nodeKey));
  if (existing?.status === 'pending') fail('run verification retry admission is already pending', 'run_verification_retry_conflict');
  if (existing?.originOutcome === 'candidate_failed') {
    fail('candidate failure confirmation is already consumed', 'run_verification_retry_conflict');
  }
  if (existing && !['inconclusive', 'cancelled'].includes(existing.status)) {
    fail('run verification retry identity is already settled', 'run_verification_retry_conflict');
  }
  const expectedAttempt = request.originOutcome === 'candidate_failed' ? 1 : existing ? existing.attempt + 1 : 1;
  if (request.attempt !== expectedAttempt) fail('run verification retry attempt sequence is invalid', 'run_verification_retry_conflict');
  return request;
}

export function _validateRunVerificationRetryCompletion(store, p, event, integrity = false) {
  const fail = (message, code = 'run_verification_retry_integrity') => store._runVerificationRetryFailure(message, code, integrity);
  if (!p || typeof p !== 'object' || Array.isArray(p)
    || Object.keys(p).sort().join(',') !== ['attempt', 'nodeKey', 'receipt', 'runId', 'schemaVersion'].join(',')
    || p.schemaVersion !== 1 || !validRunId(p.runId) || !boundedText(p.nodeKey, 256)
    || !Number.isSafeInteger(p.attempt) || p.attempt < 1) {
    fail('run verification retry completion is malformed');
  }
  const retry = store._runVerificationRetries.get(store._runVerificationRetryKey(p.runId, p.nodeKey));
  if (!retry || retry.status !== 'pending' || retry.attempt !== p.attempt || retry.receipt !== null) {
    fail('run verification retry completion has no pending admission');
  }
  if (event?.idempotencyKey !== `run.verification_retry.complete:${p.runId}:${p.nodeKey}:${p.attempt}`
    || event.actor !== retry.actor) {
    fail('run verification retry completion authority is invalid');
  }
  const receipt = p.receipt;
  const receiptFields = ['attempt', 'admissionDigest', 'checkpoint', 'evidence', 'nodeKey', 'originOutcome', 'outcome',
    'receiptDigest', 'repoId', 'result', 'runId', 'schemaVersion', 'scope', 'stability', 'state', 'taskId'];
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
    || Object.keys(receipt).sort().join(',') !== [...receiptFields].sort().join(',') || receipt.schemaVersion !== 1
    || receipt.scope !== 'run-verification-retry'
    || !['accepted', 'candidate_failed', 'inconclusive', 'cancelled'].includes(receipt.state)
    || receipt.repoId !== retry.repoId || receipt.runId !== retry.runId || receipt.nodeKey !== retry.nodeKey
    || receipt.taskId !== retry.taskId || receipt.attempt !== retry.attempt
    || receipt.originOutcome !== retry.originOutcome
    || ![null, 'passed_after_candidate_failure'].includes(receipt.stability)
    || receipt.admissionDigest !== retry.admissionDigest
    || !/^[a-f0-9]{64}$/.test(receipt.receiptDigest ?? '')) fail('run verification retry receipt is invalid');
  const { receiptDigest, ...receiptCore } = receipt;
  if (receiptDigest !== canonicalDigest(receiptCore)) fail('run verification retry receipt digest is invalid');
  const task = store._tasks.get(retry.taskId);
  if (!task || task.status !== 'failed') fail('run verification retry completion requires the admitted failed task');
  if (receipt.state === 'cancelled') {
    if (receipt.evidence !== null || receipt.result !== null || receipt.stability !== null) {
      fail('a cancelled retry carries no verification evidence, result, or stability');
    }
    return retry;
  }
  const { mapped, source } = store._readRetryVerificationEvidence(receipt.evidence, integrity);
  if (receipt.evidence.worker !== mapped.payload.worker || receipt.evidence.workerSeq !== mapped.payload.workerSeq
    || receipt.evidence.digest !== mapped.payload.digest
    || source.worker !== task.assignee || source.payload?.retry?.attempt !== retry.attempt) {
    fail('run verification retry completion evidence is not this attempt');
  }
  const outcome = source.payload?.verdict?.outcome;
  if (receipt.state === 'accepted') {
    if (source.payload?.accept !== true || outcome !== 'passed'
      || source.payload?.stability !== receipt.stability
      || (retry.originOutcome === 'candidate_failed'
        ? receipt.stability !== 'passed_after_candidate_failure' : receipt.stability !== null)
      || source.payload?.capture?.sha !== retry.checkpointSha
      || !receipt.result || Object.keys(receipt.result).sort().join(',') !== ['ref', 'sha'].join(',')
      || receipt.result.sha !== retry.checkpointSha
      || receipt.result.ref !== retainedResultRef(retry.checkpointSha)) {
      fail('an accepted retry requires the hub-accepted verification of the exact checkpointed commit');
    }
  } else if (source.payload?.accept === true
    || (receipt.state === 'candidate_failed' && outcome !== 'candidate_failed')
    || (receipt.state === 'inconclusive' && outcome !== 'inconclusive')
    || receipt.stability !== null || source.payload?.stability !== null) {
    fail('run verification retry completion state contradicts its verification evidence');
  }
  if (receipt.state !== 'accepted' && receipt.result !== null) fail('only an accepted retry carries a result');
  if (receipt.state !== 'accepted'
    && (receipt.checkpoint?.state !== 'pinned' || receipt.checkpoint?.sha !== retry.checkpointSha
      || receipt.checkpoint?.originOutcome !== retry.originOutcome)) {
    fail('a nonaccepted retry must retain the exact original diagnostic checkpoint');
  }
  return retry;
}

export function admitRunVerificationRetry(store, fields, auth) {
  const preview = { actor: auth?.actor, idempotencyKey: auth?.key };
  const prior = store._byKey.get(auth?.key);
  if (prior) {
    if (prior.kind !== 'run.verification_retry_admitted' || prior.actor !== auth.actor
      || prior.payload?.requestDigest !== fields?.requestDigest) {
      throw new CoordinationRefusal('run verification retry idempotency conflict', 'run_verification_retry_conflict');
    }
    return freeze({ ok: true, result: 'replay', event: clone(prior), retry: store.runVerificationRetry(fields.runId, fields.nodeKey) });
  }
  const request = store._normalizeRunVerificationRetryRequest(fields, preview, false);
  const payload = { ...clone(request), admissionDigest: canonicalDigest(clone(request)) };
  store._validateRunVerificationRetryAdmission(payload, { ...preview, payload }, false);
  const event = store._append('run.verification_retry_admitted', payload, auth);
  return freeze({ ok: true, result: 'admitted', event: clone(event), retry: store.runVerificationRetry(request.runId, request.nodeKey) });
}

export function admitRunResultExport(store, fields, auth) {
  const preview = { actor: auth?.actor, idempotencyKey: auth?.key };
  const request = store._normalizeRunResultExportRequest(fields, preview, false);
  const prior = store._byKey.get(auth?.key);
  if (prior) {
    if (prior.kind !== 'run.result_export_admitted' || prior.actor !== auth.actor
      || prior.payload?.requestDigest !== request.requestDigest) {
      throw new CoordinationRefusal('run result export idempotency conflict', 'run_result_export_conflict');
    }
    return freeze({ ok: true, result: 'replay', event: clone(prior), export: store.runResultExport(fields.runId, fields.nodeKey) });
  }
  if ([...store._runResultExports.values()].some((state) => state.runId === fields.runId && state.nodeKey === fields.nodeKey)) {
    throw new CoordinationRefusal('run result export identity conflict', 'run_result_export_conflict');
  }
  const binding = store._deriveRunResultExportBinding(request, false);
  const core = { schemaVersion: 1, ...clone(request), locator: `export:${request.exportId}`, binding: clone(binding) };
  const payload = { ...core, admissionDigest: canonicalDigest(core) };
  store._validateRunResultExportAdmission(payload, { ...preview, payload }, false);
  const event = store._append('run.result_export_admitted', payload, auth);
  return freeze({ ok: true, result: 'admitted', event: clone(event), export: store.runResultExport(fields.runId, fields.nodeKey) });
}

export function admitRunControl(store, fields, auth) {
  const preview = {
    seq: store._events.length + 1,
    actor: auth?.actor,
    idempotencyKey: auth?.key,
    payload: fields,
  };
  store._validateRunControlAdmission(fields, preview);
  const prior = store._byKey.get(auth.key);
  if (prior) {
    if (prior.kind !== 'run.control_admitted' || prior.actor !== auth.actor
      || canonicalDigest(prior.payload) !== canonicalDigest(fields)) {
      throw new CoordinationRefusal('run control idempotency conflict', 'run_control_conflict');
    }
    return freeze({
      ok: true, result: 'replay', event: clone(prior),
      control: store.runControl(fields.controlId),
    });
  }
  if (store._runControls.has(fields.controlId)) {
    throw new CoordinationRefusal('run control identity conflict', 'run_control_conflict');
  }
  const event = store._append('run.control_admitted', clone(fields), auth);
  return freeze({
    ok: true, result: 'admitted', event: clone(event),
    control: store.runControl(fields.controlId),
  });
}

export function admitRunStop(store, fields, auth) {
  const expectedFields = ['schemaVersion', 'repoId', 'runId', 'reasonDigest', 'requestDigest'];
  if (!fields || Object.keys(fields).sort().join(',') !== expectedFields.sort().join(',') || fields.schemaVersion !== 1
    || !validRunId(fields.repoId) || !validRunId(fields.runId) || !/^[a-f0-9]{64}$/.test(fields.reasonDigest ?? '')
    || fields.requestDigest !== canonicalDigest({ repoId: fields.repoId, runId: fields.runId, reasonDigest: fields.reasonDigest })
    || auth?.key !== `run.stop:${fields.runId}` || !boundedText(auth?.actor, 256)) {
    throw new CoordinationRefusal('run stop request is invalid', 'run_stop_invalid');
  }
  const prior = store._byKey.get(auth.key);
  if (prior) {
    if (prior.kind !== 'run.stop_admitted' || prior.actor !== auth.actor || prior.payload?.requestDigest !== fields.requestDigest) {
      throw new CoordinationRefusal('run stop idempotency conflict', 'run_stop_conflict');
    }
    return freeze({ ok: true, result: 'replay', event: clone(prior), stop: store.runStop(fields.runId) });
  }
  if (store.runStop(fields.runId)) throw new CoordinationRefusal('run stop identity conflict', 'run_stop_conflict');
  const lineage = store._runLineages.get(fields.runId) ?? null;
  if (store._runLineagePolicy && (fields.repoId !== store._repoId
    || (lineage && lineage.repoId !== fields.repoId))) {
    throw new CoordinationRefusal('run stop repository differs from Run authority', 'run_stop_repository_mismatch');
  }
  const known = store._goalHeads.has(store._goalScopeKey(fields.repoId, fields.runId))
    || lineage?.repoId === fields.repoId
    || [...store._tasks.values()].some((task) => task.runId === fields.runId)
    // A run that owns a board (the facade/epic #87+#48 orchestrator posture records a
    // boardAdmission binding) is a real run for the stop lane too — a board-bound run must be
    // closable so the facade's board run-open check can observe the closed state.
    || [...store._boardRunBindings.values()].some((binding) => binding.runId === fields.runId);
  if (!known) throw new CoordinationRefusal(`unknown run ${fields.runId}`, 'not_found');
  const targets = store._runStopTargets(fields.runId);
  const schemaVersion = targets.targetContextCallIds?.length > 0 ? 3
    : targets.targetContextSessionIds?.length > 0
      || targets.targetContextCellIds?.length > 0 ? 2 : 1;
  const payload = { ...clone(fields), schemaVersion, ...targets };
  const preview = { seq: store._events.length + 1, actor: auth.actor, idempotencyKey: auth.key, payload };
  store._validateRunStopAdmission(payload, preview);
  const event = store._append('run.stop_admitted', payload, auth);
  return freeze({ ok: true, result: 'admitted', event: clone(event), stop: store.runStop(fields.runId) });
}

export function admitFleetDrain(store, fields, auth) {
  const preview = { actor: auth?.actor, idempotencyKey: auth?.key, payload: fields };
  store._validateFleetDrainAdmission(fields, preview);
  const prior = store._byKey.get(auth.key);
  if (prior) {
    if (prior.kind !== 'fleet.drain_admitted' || prior.actor !== auth.actor || canonicalDigest(prior.payload) !== canonicalDigest(fields)) throw new CoordinationRefusal('fleet drain idempotency conflict', 'fleet_drain_conflict');
    return freeze({ ok: true, result: 'replay', event: clone(prior), drain: store.fleetDrain(fields.drainId) });
  }
  const existing = store._fleetDrains.get(fields.drainId);
  if (existing) throw new CoordinationRefusal('fleet drain identity conflict', 'fleet_drain_conflict');
  const event = store._append('fleet.drain_admitted', clone(fields), auth);
  return freeze({ ok: true, result: 'admitted', event: clone(event), drain: store.fleetDrain(fields.drainId) });
}

export function admitWebCommand(store, fields, auth) {
  if (!fields?.commandId || !fields?.scopeKey || !fields?.requestDigest) throw new TypeError('web command identity, scope, and digest required');
  const priorId = store._webCommandScopes.get(fields.scopeKey);
  if (priorId) {
    const prior = store._webCommands.get(priorId);
    if (prior.requestDigest !== fields.requestDigest) return freeze({ ok: false, result: 'idempotency_conflict' });
    return freeze({ ok: true, result: 'replay', command: clone(prior) });
  }
  if (store._webCommands.has(fields.commandId)) return freeze({ ok: false, result: 'command_id_conflict' });
  const event = store._append('web.command_admitted', clone(fields), auth);
  return freeze({ ok: true, result: 'admitted', event: clone(event), command: store.webCommand(fields.commandId) });
}

export function admitMcpCall(store, fields, auth) {
  if (!fields?.callId || !fields?.scopeKey || !fields?.requestDigest) throw new TypeError('MCP call identity, scope, and digest required');
  const priorId = store._mcpCallScopes.get(fields.scopeKey);
  if (priorId) {
    const prior = store._mcpCalls.get(priorId);
    if (prior.requestDigest !== fields.requestDigest) return freeze({ ok: false, result: 'idempotency_conflict' });
    return freeze({ ok: true, result: 'replay', call: clone(prior) });
  }
  if (store._mcpCalls.has(fields.callId)) return freeze({ ok: false, result: 'call_id_conflict' });
  const event = store._append('mcp.call_admitted', clone(fields), auth);
  return freeze({ ok: true, result: 'admitted', event: clone(event), call: store.mcpCall(fields.callId) });
}

export function _isDerivedPlanSemanticReview(store, fields) {
  const parent = store._tasks.get(fields?.refines);
  const review = fields?.review;
  const structured = review?.structured;
  const target = structured?.target;
  const gate = parent?.brief?.goalPlan;
  if (!parent || parent.status !== 'completed' || parent.acceptanceRevocation
    || fields?.taskType !== 'review' || fields?.runId == null || fields.runId !== parent.runId
    || review?.kind !== 'review' || review.parentTaskId !== parent.id || review.parentWorkerId !== parent.assignee
    || structured?.purpose !== 'run_semantic_review' || !target
    || target.repoId !== store._goalPlanPolicy?.repoId || target.runId !== fields.runId
    || target.taskId !== parent.id || target.resultSha !== review.resultSha
    || target.goalDigest !== gate?.goalDigest || target.planDigest !== gate?.planDigest
    || target.approvalDigest !== gate?.approvalDigest) return false;
  const approval = store._planApprovals.get(store._planVersionKey(gate.planId, gate.planVersion));
  if (!approval || approval.disposition !== 'approved' || approval.digest !== gate.approvalDigest) return false;
  const artifacts = parent.artifactIds.map((id) => store._artifacts.get(id)).filter(Boolean);
  const active = (artifact) => artifact.accepted === true && artifact.supersededBy === null
    && !Object.hasOwn(artifact, 'acceptanceInvalidation');
  return artifacts.some((artifact) => active(artifact) && artifact.kind === 'commit'
    && artifact.refs?.sha === target.resultSha && artifact.id === target.commitArtifact?.id
    && artifact.digest === target.commitArtifact?.digest)
    && artifacts.some((artifact) => active(artifact) && artifact.kind === 'verification'
      && artifact.id === target.verificationArtifact?.id && artifact.digest === target.verificationArtifact?.digest);
}

export function _validateProvisionalResultRef(manifest, integrity = false) {
  if (!Object.hasOwn(manifest?.refs ?? {}, 'retainedResultRef')) return true;
  const valid = manifest.kind === 'commit' && manifest.accepted === true
    && validResultSha(manifest.refs?.sha)
    && manifest.refs.retainedResultRef === retainedResultRef(manifest.refs.sha);
  if (!valid) {
    if (integrity) throw new CoordinationIntegrityError('accepted result artifact retained ref is invalid', 'run_result_ref_integrity');
    throw new CoordinationRefusal('accepted result artifact retained ref is invalid', 'result_ref_invalid');
  }
  return true;
}

export function _prepareArtifact(store, fields, terminalStatus) {
  const task = store._tasks.get(fields?.taskId);
  if (!task) throw new CoordinationRefusal(`unknown artifact task ${fields?.taskId}`, 'not_found');
  const manifest = clone(fields);
  if (Object.keys(manifest).some((field) => ARTIFACT_LIFECYCLE_FIELDS.has(field))) throw new CoordinationRefusal('artifact manifest uses lifecycle-owned fields', 'reserved_artifact_field');
  manifest.digest ??= digest({ taskId: manifest.taskId, kind: manifest.kind, refs: manifest.refs, provenance: manifest.provenance });
  manifest.id ??= `artifact:${manifest.digest}`;
  store._validateProvisionalResultRef(manifest, false);
  if (store._artifacts.has(manifest.id)) throw new CoordinationRefusal(`duplicate artifact ${manifest.id}`, 'duplicate_artifact');
  if (manifest.accepted === true && (!Array.isArray(manifest.provenance) || manifest.provenance.length === 0)) {
    throw new CoordinationRefusal('accepted artifact requires provenance', 'missing_provenance');
  }
  if (manifest.accepted === true) {
    if (terminalStatus !== 'completed') throw new CoordinationRefusal('accepted artifact requires a completed task', 'task_not_completed');
    const verified = manifest.provenance.some((ref) => {
      if (!Number.isInteger(ref?.coordinationSeq)) return false;
      const mapped = store._events[ref.coordinationSeq - 1];
      if (mapped?.kind !== 'evidence.mapped' || mapped.payload?.kind !== 'verify.reverified') return false;
      const source = store._operationalRead?.(mapped.payload.worker, mapped.payload.workerSeq);
      return source?.kind === 'verify.reverified' && source?.payload?.accept === true;
    });
    if (!verified) throw new CoordinationRefusal('accepted artifact requires accepted hub-verification provenance', 'unverified_provenance');
  }
  return manifest;
}

export function providerProcessingAdmission(store, key, requestDigest) {
  const prior = store._byKey.get(key); if (!prior) return null;
  if (!['provider.processing_checked', 'knowledge.reuse_provider_guarded'].includes(prior.kind) || prior.payload?.requestDigest !== requestDigest) throw new CoordinationRefusal('provider processing idempotency conflict', 'provider_processing_conflict');
  return freeze({ ok: true, result: 'idempotent', event: clone(prior), processing: store.providerProcessing(prior.payload.processingId) });
}

export function reuseDecisionAdmission(store, key, requestDigest) {
  const prior = store._byKey.get(key); if (!prior) return null;
  if (!['knowledge.reuse_decided', 'reuse.decision_request_bound'].includes(prior.kind) || prior.payload?.requestDigest !== requestDigest) throw new CoordinationRefusal('reuse decision idempotency conflict', 'reuse_decision_conflict');
  const decision = store.reuseDecision(prior.payload.id ?? prior.payload.decisionId); const current = Boolean(decision && store.currentReuseDecision(decision.subjectDigest)?.id === decision.id); const historical = !current;
  return freeze({ ok: true, result: historical ? 'historical' : 'idempotent', current, historical, event: clone(prior), decision });
}

export function reuseRiskAdmission(store, key, requestDigest) {
  const prior = store._byKey.get(key); if (!prior) return null;
  if (prior.kind !== 'knowledge.reuse_risk_guarded' || prior.payload?.requestDigest !== requestDigest) throw new CoordinationRefusal('reuse risk idempotency conflict', 'reuse_risk_conflict');
  const p = prior.payload; const seed = store._reuseDecisions.get(p.seedDecisionId); const head = seed ? store._reusePolicyHeads.get(seed.envRef?.repoId) : null;
  const active = store._reuseRiskGuards.get(canonicalDigest(p.coordinate));
  const laterReview = store._events.slice(prior.seq).find((item) => item.kind === 'knowledge.reuse_risk_guarded' && canonicalDigest(item.payload?.coordinate) === canonicalDigest(p.coordinate));
  const inheritedEvent = !p.adverse ? [...store._events.slice(0, prior.seq - 1)].reverse().find((item) => item.kind === 'knowledge.reuse_risk_guarded' && item.payload?.adverse === true && canonicalDigest(item.payload.coordinate) === canonicalDigest(p.coordinate)) : null;
  const currentGuard = Boolean(active && active.guardDigest === p.guardDigest && active.policyHash === p.dossierSnapshot.policyHash && active.policyStale !== true && (!head || active.policyHash === head.policyHash));
  const currentGreenObservation = Boolean(!p.adverse && !inheritedEvent && !laterReview && (!head || p.dossierSnapshot.policyHash === head.policyHash)); const current = currentGuard || currentGreenObservation;
  let guard = current ? clone(active ?? null) : null;
  if (!guard && (p.adverse || inheritedEvent)) {
    guard = { coordinate: clone(p.coordinate), repoId: seed?.envRef?.repoId ?? null, blocked: true, dossierDigest: p.dossierRef.digest, factDigest: p.dossierSnapshot.factDigest, policyHash: p.dossierSnapshot.policyHash, recommendation: p.dossierSnapshot.recommendation, asOf: p.dossierSnapshot.asOf, expiresAt: p.dossierSnapshot.expiresAt, advisoryIds: clone(p.advisoryIds), maliciousAdvisoryIds: clone(p.maliciousAdvisoryIds), eventSeq: prior.seq, guardDigest: p.guardDigest, policyStale: Boolean(head && p.dossierSnapshot.policyHash !== head.policyHash), inheritedAdverse: !p.adverse,
      ...(!p.adverse && inheritedEvent ? { inheritedFromGuardDigest: inheritedEvent.payload.guardDigest, inheritedFactDigest: inheritedEvent.payload.dossierSnapshot.factDigest, inheritedPolicyHash: inheritedEvent.payload.dossierSnapshot.policyHash, inheritedAdvisoryIds: clone(inheritedEvent.payload.advisoryIds), inheritedMaliciousAdvisoryIds: clone(inheritedEvent.payload.maliciousAdvisoryIds), inheritedEventSeq: inheritedEvent.seq } : {}) };
  }
  return freeze({ ok: true, result: current ? 'idempotent' : 'historical', current, historical: !current, event: clone(prior), guard: clone(guard), targets: clone(p.targets) });
}

export function reuseTtlAdmission(store, key, requestDigest) {
  const prior = store._byKey.get(key); if (!prior) return null;
  if (prior.kind !== 'knowledge.reuse_ttl_invalidated' || prior.payload?.requestDigest !== requestDigest) throw new CoordinationRefusal('reuse TTL idempotency conflict', 'reuse_ttl_conflict');
  return freeze({ ok: true, result: 'idempotent', event: clone(prior), decision: store.reuseDecision(prior.payload.decisionId) });
}

export function _validateWaveClosedPayload(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new CoordinationRefusal('wave.closed payload is invalid', 'wave_closed_invalid');
  }
  const closedShape = ['blockedOn', 'knowledge', 'lanes', 'parked', 'receiptDigest', 'rings', 'settlementErrors', 'waveId'];
  const keys = Object.keys(fields);
  if (keys.length !== 8 || keys.slice().sort().join(',') !== closedShape.join(',')) {
    throw new CoordinationRefusal('wave.closed payload must be the closed 8-key shape', 'wave_closed_invalid');
  }
  if (typeof fields.waveId !== 'string' || fields.waveId.length === 0
    || typeof fields.receiptDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(fields.receiptDigest)) {
    throw new CoordinationRefusal('wave.closed identity is invalid', 'wave_closed_invalid');
  }
  if (!Array.isArray(fields.rings) || fields.rings.length > 8
    || fields.rings.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.id !== 'string')) {
    throw new CoordinationRefusal('wave.closed rings block is invalid', 'wave_closed_invalid');
  }
  if (!Array.isArray(fields.lanes) || fields.lanes.length > 16
    || fields.lanes.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.lane !== 'string')) {
    throw new CoordinationRefusal('wave.closed lanes block is invalid', 'wave_closed_invalid');
  }
  if (!Array.isArray(fields.parked) || fields.parked.length > 8
    || fields.parked.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.id !== 'string')) {
    throw new CoordinationRefusal('wave.closed parked block is invalid', 'wave_closed_invalid');
  }
  if (!Array.isArray(fields.blockedOn) || fields.blockedOn.length > 8
    || fields.blockedOn.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.item !== 'string')) {
    throw new CoordinationRefusal('wave.closed blockedOn block is invalid', 'wave_closed_invalid');
  }
  if (!fields.knowledge || typeof fields.knowledge !== 'object' || Array.isArray(fields.knowledge)
    || !['candidates', 'admittedThisRun', 'candidatesAwaitingAdmission', 'settlementRunId']
      .every((key) => Object.hasOwn(fields.knowledge, key))) {
    throw new CoordinationRefusal('wave.closed knowledge block is invalid', 'wave_closed_invalid');
  }
  if (!Array.isArray(fields.settlementErrors) || fields.settlementErrors.length > 8
    || fields.settlementErrors.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.code !== 'string')) {
    throw new CoordinationRefusal('wave.closed settlementErrors block is invalid', 'wave_closed_invalid');
  }
  return clone(fields);
}

export function _resolvedSpill(store, spillId) {
  const spill = store._spills.get(spillId);
  if (spill === undefined) return null;
  // The row's own shape, exactly — the pair is the projection's bookkeeping and the body is what
  // every caller of this reader asked for (`mintSpill`'s receipt, `materializeSpill`'s answer).
  const { bodyRef, ...rest } = spill;
  return { ...clone(rest), body: bodyRef === undefined ? spill.body ?? null : store._projectionReferenceValue(bodyRef) };
}

export function hasSwarmParticipantRun(state, runId) {
  if (!runId) return false;
  return [...state.values()].some((swarm) => Object.values(swarm.participants)
    .some((participant) => participant.runId === runId));
}

export function _assertOrientationReceiptCeiling(store, payload) {
  if (!store._orientationReceiptCeilings) return;
  const ceilings = store._orientationReceiptCeilings;
  // #367: the per-attempt counter fold (built in the context.read arm of _apply) answers the
  // count and cumulative-byte bounds in O(1) — the one canonicalBytes call below is for the
  // INCOMING row; prior receipts are never re-scanned or re-serialized here.
  const counter = store._contextReadAttemptCounters.get(contextReadAttemptKey(payload));
  if ((counter?.count ?? 0) >= ceilings.maxReceiptsPerAttempt) {
    throw new CoordinationRefusal('orientation receipt count ceiling exceeded', 'orientation_receipt_ceiling');
  }
  if ((counter?.bytes ?? 0) + canonicalBytes(payload) > ceilings.maxReceiptBytesPerAttempt) {
    throw new CoordinationRefusal('orientation receipt byte ceiling exceeded', 'orientation_receipt_ceiling');
  }
}

export function _assertOrientationProposalCeiling(store, workerId) {
  if (!store._orientationReceiptCeilings) return;
  const proposals = store.queryKnowledge({ types: ['Finding'] }).filter((node) => node.promotion?.trigger === 'orientation.overlay_proposed'
    && (workerId === null || node.workerId === workerId));
  if (proposals.length >= store._orientationReceiptCeilings.maxProposalsPerAttempt) {
    throw new CoordinationRefusal('orientation proposal ceiling exceeded', 'orientation_receipt_ceiling');
  }
}

export function checkScratch(store, resource, envRef) {
  if (!validEnvRef(envRef)) throw new CoordinationRefusal('scratch check requires immutable repoId/treeSha envRef', 'invalid_env_ref');
  const claims = [...store._scratchClaims.values()].filter((claim) => claim.active && claim.envRef.repoId === envRef.repoId && resourceOverlap(claim.resource, resource)).map((claim) => ({
    ...clone(claim), warning: claim.envRef.treeSha === envRef.treeSha ? null : `observed on ${claim.envRef.treeSha} — not your tree`,
  }));
  const facts = [...store._scratchFacts.values()].filter((fact) => fact.active && fact.envRef.repoId === envRef.repoId && (fact.key === resource || fact.resource === resource)).map((fact) => ({
    ...clone(fact), warning: fact.envRef.treeSha === envRef.treeSha ? null : `observed on ${fact.envRef.treeSha} — not your tree`,
  }));
  return freeze({ clear: claims.length === 0, claims, facts });
}

export function _boardAdmissionFailure(message, code) {
  throw new CoordinationRefusal(message, code);
}

export function admitBoardCommand(store, envelope) {
  const fail = (message, code = 'board_admission_invalid') => store._boardAdmissionFailure(message, code);
  const topFields = [
    'board', 'expectedBoardFence', 'idempotencyKey', 'item', 'mutation', 'runId',
    'sessionAuthority',
  ];
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
    || Object.keys(envelope).sort().join(',') !== topFields.sort().join(',')
    || !validRunId(envelope.runId) || typeof envelope.board !== 'string'
    || !SAFE_BOARD_ID.test(envelope.board) || !boundedText(envelope.idempotencyKey, 512)) {
    fail('board admission envelope is invalid');
  }

  const mutation = envelope.mutation;
  const kind = mutation?.kind;
  const exactMutation = (fields) => mutation && typeof mutation === 'object'
    && !Array.isArray(mutation)
    && Object.keys(mutation).sort().join(',') === fields.sort().join(',');
  if (kind === 'post') {
    if (!exactMutation(['detail', 'evidence', 'kind', 'owner', 'title'])
      || envelope.item !== null || !Number.isSafeInteger(envelope.expectedBoardFence)
      || envelope.expectedBoardFence < 0
      || !boardBounded(mutation.title, MAX_STORE_BOARD_TITLE_BYTES)
      || (mutation.detail !== null && !boardBounded(mutation.detail, MAX_STORE_BOARD_DETAIL_BYTES))
      || (mutation.owner !== null && (typeof mutation.owner !== 'string' || !SAFE_BOARD_OWNER.test(mutation.owner)))
      || !Array.isArray(mutation.evidence) || mutation.evidence.length > MAX_STORE_BOARD_EVIDENCE
      || !mutation.evidence.every(validBoardEvidenceRef)) fail('board post admission is invalid');
  } else if (kind === 'retitle') {
    if (!exactMutation(['detail', 'kind', 'title'])
      || !boardBounded(mutation.title, MAX_STORE_BOARD_TITLE_BYTES)
      || (mutation.detail !== null && !boardBounded(mutation.detail, MAX_STORE_BOARD_DETAIL_BYTES))) {
      fail('board retitle admission is invalid');
    }
  } else if (kind === 'reorder') {
    if (!exactMutation(['kind', 'ordinal']) || !Number.isSafeInteger(mutation.ordinal)
      || mutation.ordinal <= 0) fail('board reorder admission is invalid');
  } else if (kind === 'close' || kind === 'drop') {
    if (!exactMutation(['kind'])) fail('board successor admission is invalid');
  } else if (kind === 'read') {
    if (!exactMutation(['kind']) || envelope.item !== null
      || envelope.expectedBoardFence !== null) fail('board read admission is invalid');
  } else fail('board mutation kind is invalid');

  if (!['post', 'read'].includes(kind)) {
    if (!envelope.item || typeof envelope.item !== 'object' || Array.isArray(envelope.item)
      || Object.keys(envelope.item).sort().join(',') !== 'itemId,itemVersion'
      || !boundedText(envelope.item.itemId, 512)
      || !Number.isSafeInteger(envelope.item.itemVersion) || envelope.item.itemVersion <= 0
      || !Number.isSafeInteger(envelope.expectedBoardFence) || envelope.expectedBoardFence < 0) {
      fail('board item coordinates are invalid');
    }
  }

  // Proof is an authority concern, not a caller-named principal. Null/absent proof therefore
  // receives the lease code rather than being allowed to fall through to item existence.
  const proof = envelope.sessionAuthority;
  if (proof == null) fail('an active board lease is required', 'board_lease_required');
  const proofFields = ['authorityDigest', 'expiresAt', 'orchestratorLeaseId', 'schemaVersion'];
  if (typeof proof !== 'object' || Array.isArray(proof)
    || Object.keys(proof).sort().join(',') !== proofFields.sort().join(',')
    || proof.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(proof.authorityDigest ?? '')
    || !boundedText(proof.orchestratorLeaseId, 512)
    || !Number.isFinite(Date.parse(proof.expiresAt ?? ''))
    || new Date(Date.parse(proof.expiresAt)).toISOString() !== proof.expiresAt) {
    fail('board authority proof is invalid');
  }
  const lease = store._runOrchestratorLeases.get(proof.orchestratorLeaseId);
  if (!lease || lease.status !== 'active' || Date.parse(store._clock()) >= Date.parse(lease.expiresAt)) {
    fail('an active board lease is required', 'board_lease_required');
  }
  if (proof.authorityDigest !== lease.session.authorityDigest
    || proof.expiresAt !== lease.session.expiresAt) {
    fail('board session authority does not match its lease', 'board_session_mismatch');
  }
  const parent = store._tasks.get(lease.parent.taskId);
  if (!parent || parent.version !== lease.parent.taskVersion
    || parent.assignee !== lease.parent.workerId || parent.status !== 'working') {
    fail('an active board lease is required', 'board_lease_required');
  }
  if (lease.parent.runId !== envelope.runId) {
    fail('board command Run does not match its lease', 'board_session_mismatch');
  }
  const binding = store._boardRunBindings.get(envelope.board) ?? null;
  if (binding && binding.runId !== envelope.runId) {
    fail('board is bound to a different Run', 'board_session_mismatch');
  }
  if (store._runStopByTarget.has(envelope.runId) || store._runStops.has(envelope.runId)
    || store._runs.get(envelope.runId)?.status === 'sealed') {
    fail('board Run is closed', 'board_run_closed');
  }

  let item = null;
  if (!['post', 'read'].includes(kind)) {
    item = store._boardItems.get(envelope.item.itemId) ?? null;
    if (!item || item.board !== envelope.board) fail('board item was not found', 'board_item_not_found');
  }

  const normalized = freeze(clone(envelope));
  const requestDigest = canonicalDigest(normalized);
  const prior = store._byKey.get(envelope.idempotencyKey) ?? null;
  const priorDigest = prior?.payload?.boardAdmission?.requestDigest ?? null;

  const gate = () => {
    if (store.boardFence(envelope.board) !== envelope.expectedBoardFence) {
      fail('board fence is stale', 'stale_board_fence');
    }
    if (item) {
      const current = store._boardItems.get(item.itemId);
      if (current?.itemVersion !== envelope.item.itemVersion) {
        fail('board item parent is stale', 'board_parent_stale');
      }
      if (current?.state !== 'open') fail('board item is not open', 'board_parent_stale');
    }
  };

  // Reads are non-evented but pass through the identical proof/run/binding posture.
  if (kind === 'read') {
    return freeze({ ok: true, result: 'read', snapshot: store.boardSnapshot(envelope.board) });
  }

  if (!prior) gate(); // refusal precedence before request construction.
  if (prior) {
    const priorAdmission = prior.payload?.boardAdmission;
    if (priorDigest !== requestDigest) {
      if (priorAdmission?.expectedBoardFence !== envelope.expectedBoardFence) {
        fail('board fence differs from the replay parent', 'stale_board_fence');
      }
      if (item && priorAdmission?.itemVersion !== envelope.item.itemVersion) {
        fail('board item replay parent is stale', 'board_parent_stale');
      }
      fail('board idempotency content changed', 'board_replay_conflict');
    }
    const replayItem = store._boardItems.get(prior.payload.itemId) ?? null;
    return freeze({
      ok: true, result: 'idempotent', event: clone(prior), item: clone(replayItem),
      boardRunBinding: {
        runId: envelope.runId, result: prior.payload.boardAdmission?.adopted ? 'adopted' : 'bound',
      },
    });
  }

  const adopting = !binding && (store._boardItemsByBoard.get(envelope.board)?.length ?? 0) > 0;
  const boardAdmission = freeze({
    schemaVersion: 1, runId: envelope.runId, requestDigest, adopted: adopting,
    leaseId: lease.leaseId, expectedBoardFence: envelope.expectedBoardFence,
    itemVersion: envelope.item?.itemVersion ?? null,
  });
  const auth = { actor: lease.session.principalId, key: envelope.idempotencyKey };
  const appendGate = () => {
    // Test-only instrumentation shares the actual before-write callback. A mutation injected
    // here changes the replay-derived fence before the compare below and therefore loses CAS.
    if (typeof store._boardAdmissionInterleave === 'function') store._boardAdmissionInterleave();
    gate();
  };
  let receipt;
  if (kind === 'post') {
    receipt = store.postBoardItem({
      board: envelope.board, title: mutation.title, detail: mutation.detail,
      owner: mutation.owner, evidence: mutation.evidence,
    }, auth, appendGate, boardAdmission);
  } else if (kind === 'retitle') {
    receipt = store.retitleBoardItem(item.itemId, {
      title: mutation.title, detail: mutation.detail,
    }, auth, appendGate, boardAdmission);
  } else if (kind === 'reorder') {
    receipt = store.reorderBoardItem(item.itemId, mutation.ordinal, auth, appendGate, boardAdmission);
  } else if (kind === 'close') {
    receipt = store.closeBoardItem(item.itemId, auth, appendGate, boardAdmission);
  } else {
    receipt = store.dropBoardItem(item.itemId, auth, appendGate, boardAdmission);
  }
  return freeze({
    ...receipt,
    boardRunBinding: { runId: envelope.runId, result: adopting ? 'adopted' : 'bound' },
  });
}

export function admitWorkerBoardCommand(store, { kind, grantId, payload, workerId, taskId, taskVersion, processGeneration, idempotencyKey }) {
  const fail = (message, code = 'board_worker_scope_refused') => store._boardAdmissionFailure(message, code);
  if (kind !== 'claim' && kind !== 'report') fail('worker board command kind is invalid', 'board_worker_command_invalid');
  if (typeof grantId !== 'string' || grantId.length === 0
    || typeof workerId !== 'string' || workerId.length === 0
    || typeof taskId !== 'string' || taskId.length === 0
    || !Number.isSafeInteger(taskVersion) || taskVersion <= 0
    || !Number.isSafeInteger(processGeneration) || processGeneration <= 0
    || typeof idempotencyKey !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(idempotencyKey)) {
    fail('worker board command envelope is invalid', 'board_worker_command_invalid');
  }
  if (kind === 'claim') {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Object.keys(payload).sort().join(',') !== 'expectedBoardFence,grantId,idempotencyKey,itemId'
      || typeof payload.itemId !== 'string' || payload.itemId.length === 0
      || !Number.isSafeInteger(payload.expectedBoardFence) || payload.expectedBoardFence < 0) {
      fail('worker board claim frame is invalid', 'board_claim_invalid');
    }
  } else if (kind === 'report') {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Object.keys(payload).sort().join(',') !== 'body,expectedClaimVersion,grantId,idempotencyKey,itemDigest,itemId,itemVersion'
      || typeof payload.itemId !== 'string' || payload.itemId.length === 0
      || !Number.isSafeInteger(payload.itemVersion) || payload.itemVersion <= 0
      || typeof payload.itemDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(payload.itemDigest)
      || !Number.isSafeInteger(payload.expectedClaimVersion) || payload.expectedClaimVersion <= 0
      || typeof payload.body !== 'string' || payload.body.length === 0) {
      fail('worker board report frame is invalid', 'board_report_invalid');
    }
  }

  // Step 2 — resolve + prove the grant. Possession of a grant id is never authority. The
  // member identity predicate is workerId + taskId + processGeneration (Decision 2/8): a
  // non-terminal status transition (e.g. working→paused) bumps the task's coordination version
  // but is NOT a reassignment or generation replacement — the grant survives it (Decision 1:
  // paused is a live task status for the gate).
  const grant = store._boardGrants.get(grantId) ?? null;
  if (!grant || grant.state !== 'active' || !grant.active
    || grant.workerId !== workerId || grant.taskId !== taskId
    || grant.processGeneration !== processGeneration) {
    fail('worker board scope is refused', 'board_worker_scope_refused');
  }
  // Step 3/4 — derive scope from the grant; verify binding, permission, and live state before
  // any item existence.
  const board = grant.board;
  const binding = store._boardRunBindings.get(board) ?? null;
  if (!binding || binding.runId !== grant.boardRunId) {
    fail('worker board scope is refused', 'board_worker_scope_refused');
  }
  const permission = kind === 'claim' ? 'claim' : 'report';
  if (!Array.isArray(grant.permissions) || !grant.permissions.includes(permission)) {
    fail('worker board scope is refused', 'board_worker_scope_refused');
  }
  if (store._runStopByTarget.has(grant.boardRunId) || store._runStops.has(grant.boardRunId)
    || store._runs.get(grant.boardRunId)?.status === 'sealed') {
    fail('worker board scope is refused', 'board_worker_scope_refused');
  }
  const effectiveKey = `${kind === 'claim' ? 'board.claim' : 'board.report'}:${grant.grantDigest}:${idempotencyKey}`;
  const opKind = kind === 'claim' ? 'claim' : 'report';

  if (opKind === 'claim') {
    const itemId = payload.itemId;
    const expectedBoardFence = payload.expectedBoardFence;
    // The grant scopes exactly one board (Decision 5). A frame naming an item on any other
    // board — or no item at all — draws the SAME constant scope refusal before item lookup, so
    // the caller learns nothing about a foreign board's existence (Decision 3/4).
    const scopedItem = store._boardItems.get(itemId);
    if (!scopedItem || scopedItem.board !== board) {
      fail('worker board scope is refused', 'board_worker_scope_refused');
    }
    const gate = () => {
      if (typeof store._boardAdmissionInterleave === 'function') store._boardAdmissionInterleave();
      if (store.boardFence(board) !== expectedBoardFence) {
        store._boardAdmissionFailure('board fence is stale', 'stale_board_fence');
      }
      const current = store._boardItems.get(itemId);
      if (!current || current.board !== board || current.state !== 'open') {
        store._boardAdmissionFailure(`board item ${itemId} is not open`, 'board_item_not_open');
      }
      const existing = store._boardClaims.get(itemId);
      if (existing && existing.active) throw new CoordinationRefusal(`board item ${itemId} is already claimed`, 'conflict');
    };
    return store.requestBoardClaim({
      itemId, owner: workerId, ownerTask: taskId, expectedBoardFence,
      grantDigest: grant.grantDigest,
    }, { actor: workerId, key: effectiveKey }, gate);
  }
  // report
  const itemId = payload.itemId;
  const reportRequestDigest = boardReportRequestDigest({
    itemId, itemVersion: payload.itemVersion, itemDigest: payload.itemDigest,
    owner: workerId, body: payload.body,
  });
  // The grant scopes exactly one board (Decision 5) — a frame naming an item on any other
  // board draws the same constant scope refusal before item lookup.
  const scopedItem = store._boardItems.get(itemId);
  if (!scopedItem || scopedItem.board !== board) {
    fail('worker board scope is refused', 'board_worker_scope_refused');
  }
  // Decision 6 rule 4: after authorization, an EXACT prior replay returns the original success
  // WITHOUT re-judging later live-state changes (a lost successful receipt is recovered even
  // after the orchestrator closes the item). The kernel's own prior lookup adjudicates store.
  const priorReport = store._byKey.get(effectiveKey) ?? null;
  if (priorReport) {
    if (priorReport.kind !== 'board.report_submitted'
      || priorReport.payload?.requestDigest !== reportRequestDigest) {
      fail('board report idempotency content changed', 'board_replay_conflict');
    }
    return store.submitBoardReport({
      itemId, itemVersion: payload.itemVersion, itemDigest: payload.itemDigest,
      owner: workerId, ownerTask: taskId, body: payload.body,
    }, { actor: workerId, key: effectiveKey }, null);
  }
  // Decision 4: report admission requires an active owned claim, the exact claim version, and
  // an open item — checked BEFORE the kernel (authority-before-replay) and re-checked by the
  // in-append gate.
  const activeClaim = store._boardClaims.get(itemId);
  if (!activeClaim || !activeClaim.active || activeClaim.owner !== workerId
    || activeClaim.ownerTask !== taskId) {
    fail('worker board report has no active owned claim', 'board_report_no_active_claim');
  }
  if (activeClaim.version !== payload.expectedClaimVersion) {
    fail('worker board report claim version is stale', 'board_report_stale_claim_version');
  }
  if (scopedItem.state !== 'open') {
    fail(`board item ${itemId} is not open`, 'board_item_not_open');
  }
  const gate = () => {
    if (typeof store._boardAdmissionInterleave === 'function') store._boardAdmissionInterleave();
    const current = store._boardItems.get(itemId);
    if (!current || current.board !== board || current.state !== 'open') {
      store._boardAdmissionFailure(`board item ${itemId} is not open`, 'board_item_not_open');
    }
    const claim = store._boardClaims.get(itemId);
    if (!claim || !claim.active || claim.owner !== workerId || claim.ownerTask !== taskId) {
      store._boardAdmissionFailure('worker board report has no active owned claim', 'board_report_no_active_claim');
    }
    if (claim.version !== payload.expectedClaimVersion) {
      store._boardAdmissionFailure('worker board report claim version is stale', 'board_report_stale_claim_version');
    }
  };
  return store.submitBoardReport({
    itemId, itemVersion: payload.itemVersion, itemDigest: payload.itemDigest,
    owner: workerId, ownerTask: taskId, body: payload.body,
  }, { actor: workerId, key: effectiveKey }, gate);
}

export function _resolveReplManifestBranch(store, branch) {
  if (!branch || typeof branch !== 'object' || Array.isArray(branch)
    || typeof branch.name !== 'string' || !SAFE_REPL_NAME.test(branch.name)) {
    throw new CoordinationRefusal('ReplManifest branch name is invalid', 'repl_manifest_branch_invalid');
  }
  if (Object.hasOwn(branch, 'cell')) {
    if (!branch.cell || typeof branch.cell !== 'object' || Array.isArray(branch.cell)
      || Object.keys(branch.cell).sort().join(',') !== 'digest'
      || !REPL_DIGEST.test(branch.cell.digest ?? '')) {
      throw new CoordinationRefusal('ReplManifest cell branch ref is invalid', 'repl_manifest_branch_invalid');
    }
    const cellId = `cell:${branch.cell.digest}`;
    const cell = store.contextCell(cellId);
    if (!cell || cell.state !== 'completed') {
      throw new CoordinationRefusal(`ReplManifest cell branch ${branch.name} names a cell that is not settled`,
        'repl_manifest_cell_not_settled');
    }
    const outputRef = cell.result.outputRef;
    // Reverify through the identical discipline settleContextCell's completion path already
    // uses (coordination-store.mjs settleContextCell) — never poisoned, only never-happened.
    try { store._contextReferenceRead(outputRef); }
    catch (error) {
      throw new CoordinationRefusal(error?.message ?? 'Context artifact is unavailable',
        error?.code ?? 'context_artifact_unavailable');
    }
    return {
      name: branch.name, digest: outputRef.digest, ref: `ctx:sha256:${outputRef.digest}`,
      itemCount: 1, mediaType: REPL_CELL_MEDIA_TYPE, summary: `resolved from cell:${branch.cell.digest}`,
    };
  }
  if (typeof branch.digest !== 'string' || !REPL_DIGEST.test(branch.digest)
    || typeof branch.ref !== 'string' || branch.ref !== `ctx:sha256:${branch.digest}`
    || !Number.isSafeInteger(branch.itemCount) || branch.itemCount < 0
    || typeof branch.mediaType !== 'string' || branch.mediaType.length === 0
    || typeof branch.summary !== 'string' || branch.summary.length === 0) {
    throw new CoordinationRefusal(`ReplManifest branch ${branch.name} is invalid`, 'repl_manifest_branch_invalid');
  }
  return {
    name: branch.name, digest: branch.digest, ref: branch.ref,
    itemCount: branch.itemCount, mediaType: branch.mediaType, summary: branch.summary,
  };
}

export function admitReplBinding(store, fields, auth) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)
    || typeof fields.scope !== 'string' || !SAFE_REPL_SCOPE.test(fields.scope)
    || typeof fields.name !== 'string' || !SAFE_REPL_NAME.test(fields.name)
    || typeof fields.cellId !== 'string' || !REPL_CELL_ID.test(fields.cellId)
    || typeof fields.manifestDigest !== 'string' || !REPL_DIGEST.test(fields.manifestDigest)) {
    throw new CoordinationRefusal('REPL binding requires a valid scope/name/cellId/manifestDigest',
      'invalid_repl_binding');
  }
  const expectedBindingVersion = Object.hasOwn(fields, 'expectedBindingVersion')
    ? fields.expectedBindingVersion : null;
  if (expectedBindingVersion !== null
    && (!Number.isSafeInteger(expectedBindingVersion) || expectedBindingVersion <= 0)) {
    throw new CoordinationRefusal('REPL binding expectedBindingVersion must be null or a positive integer',
      'invalid_repl_binding');
  }
  // Idempotency (Part B rule 6, P1-4): an explicit payload-comparison block, never the bare
  // `_append` blind-key-return discipline board writes fall back to.
  const prior = store._byKey.get(auth?.key);
  if (prior) {
    const runId = store._replManifestAdmissions.get(prior.payload?.manifestDigest)?.runId ?? null;
    const identity = {
      scope: fields.scope, name: fields.name, cellId: fields.cellId,
      manifestDigest: fields.manifestDigest, expectedBindingVersion,
    };
    const priorIdentity = {
      scope: prior.payload?.scope, name: prior.payload?.name, cellId: prior.payload?.cellId,
      manifestDigest: prior.payload?.manifestDigest,
      expectedBindingVersion: prior.payload?.expectedBindingVersion ?? null,
    };
    if (prior.kind !== 'repl.binding_set' || prior.actor !== auth.actor
      || canonicalDigest(priorIdentity) !== canonicalDigest(identity)) {
      throw new CoordinationRefusal('REPL binding idempotency key is bound differently',
        'repl_binding_conflict');
    }
    const projected = runId !== null ? store._replBindings.get(replBindingKey(runId, fields.scope, fields.name)) : null;
    return freeze({ ok: true, result: 'idempotent', event: clone(prior), binding: clone(projected) });
  }

  // Part B rule 4: authorized by, and inherits its runId from, the manifest_admitted record
  // its manifestDigest names — never a caller-supplied runId, never a wrapper-forced scope.
  const record = store._replManifestAdmissions.get(fields.manifestDigest);
  if (!record) {
    throw new CoordinationRefusal('REPL binding cites an unadmitted manifestDigest',
      'repl_binding_manifest_unadmitted');
  }
  if (record.replRole !== fields.scope) {
    throw new CoordinationRefusal('REPL binding scope disagrees with the cited manifest replRole',
      'repl_binding_scope_manifest_mismatch');
  }
  const callerPrincipal = { actor: auth?.actor ?? null, principalId: auth?.principalId ?? null };
  if (canonicalDigest(callerPrincipal) !== canonicalDigest(record.principal)) {
    throw new CoordinationRefusal('REPL binding caller identity disagrees with the cited manifest principal',
      'repl_binding_unauthorized');
  }
  const runId = record.runId;
  store._assertRunAdmissionOpen(runId, false);

  const key = replBindingKey(runId, fields.scope, fields.name);
  const current = store._replBindings.get(key);
  if (current) {
    // Part C rule 9: a version CAS, not a fence CAS — concurrent binds to different names in
    // the same scope never spuriously conflict with each other.
    if (expectedBindingVersion !== current.bindingVersion) {
      throw new CoordinationRefusal('REPL binding expectedBindingVersion is stale', 'stale_binding_version');
    }
  } else {
    const distinctNames = new Set([...store._replBindings.keys()]
      .map((rowKey) => JSON.parse(rowKey))
      .filter(([rId, scope]) => rId === runId && scope === fields.scope)
      .map(([, , name]) => name));
    if (distinctNames.size >= MAX_REPL_BINDINGS) {
      throw new CoordinationRefusal('REPL bindings exhausted for this (runId, scope)',
        'repl_bindings_exhausted');
    }
  }
  // Part A rule 3: the new cellId must resolve to a completed cell via the same global
  // projection REPL-3 resolution uses — an admitted-but-unsettled/non-completed cell refuses.
  const cell = store.contextCell(fields.cellId);
  if (!cell || cell.state !== 'completed') {
    throw new CoordinationRefusal('REPL binding names a cell that is not settled',
      'repl_binding_cell_not_settled');
  }
  const bindingVersion = current ? current.bindingVersion + 1 : 1;
  const bindingDigest = replBindingContentDigest({
    scope: fields.scope, name: fields.name, bindingVersion, state: 'bound', cellId: fields.cellId,
  });
  if (Object.hasOwn(fields, 'bindingDigest') && fields.bindingDigest !== bindingDigest) {
    throw new CoordinationRefusal('REPL binding digest does not match the hub recompute',
      'repl_binding_digest_mismatch');
  }
  const payload = {
    schemaVersion: 1, scope: fields.scope, name: fields.name, bindingVersion, state: 'bound',
    cellId: fields.cellId, bindingDigest, manifestDigest: fields.manifestDigest, expectedBindingVersion,
  };
  const event = store._append('repl.binding_set', payload, auth);
  return freeze({
    ok: true, result: current ? 'rebound' : 'bound', event: clone(event),
    binding: clone(store._replBindings.get(key)),
  });
}

export function resolveReplCitation(state, runId, citation) {
  const match = typeof citation === 'string' ? REPL_CITATION.exec(citation) : null;
  if (!match) throw new CoordinationRefusal('REPL citation is unparseable', 'repl_binding_citation_not_found');
  const [, scope, name, versionText] = match;
  const version = Number(versionText);
  const history = state.get(replBindingKey(runId, scope, name)) ?? [];
  const row = history.find((rec) => rec.bindingVersion === version);
  if (!row) throw new CoordinationRefusal('REPL citation does not resolve', 'repl_binding_citation_not_found');
  return clone(row);
}

export function _knowledgeFailure(message, code, integrity = false) {
  throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code);
}

export function _validateKnowledgeContent(store, fields, integrity = false) {
  const core = Object.fromEntries(Object.entries(fields ?? {}).filter(([key]) => key !== 'contentDigest'));
  if (!/^[a-f0-9]{64}$/.test(fields?.contentDigest ?? '') || fields.contentDigest !== canonicalDigest(core)) store._knowledgeFailure('knowledge payload content binding is invalid', 'knowledge_content_integrity', integrity);
}

export function _validateKnowledgeEvidence(store, evidence = [], eventSeq = store._events.length + 1, integrity = false) {
  if (!Array.isArray(evidence)) store._knowledgeFailure('knowledge evidence must be an array', 'invalid_evidence', integrity);
  for (const ref of evidence) {
    if (Number.isInteger(ref.coordinationSeq)) {
      if (Object.keys(ref).join(',') !== 'coordinationSeq' || ref.coordinationSeq < 1 || ref.coordinationSeq >= eventSeq || !store._events[ref.coordinationSeq - 1]) store._knowledgeFailure(`future/missing evidence seq ${ref.coordinationSeq}`, 'temporal_incoherence', integrity);
    } else if (typeof ref.artifactId === 'string') {
      if (Object.keys(ref).join(',') !== 'artifactId' || !store._artifacts.has(ref.artifactId)) store._knowledgeFailure(`missing evidence artifact ${ref.artifactId}`, 'missing_evidence', integrity);
    } else store._knowledgeFailure('knowledge evidence must reference coordinationSeq or artifactId', 'invalid_evidence', integrity);
  }
}

export function _validateKnowledgeTimes(store, fields, integrity = false) {
  const from = fields.validFrom == null ? null : Date.parse(fields.validFrom); const to = fields.validTo == null ? null : Date.parse(fields.validTo);
  if ((fields.validFrom != null && !Number.isFinite(from)) || (fields.validTo != null && !Number.isFinite(to)) || (from !== null && to !== null && to < from)) store._knowledgeFailure('knowledge valid time is invalid', 'invalid_valid_time', integrity);
}

export function _validateKnowledgeNodePayload(store, fields, event, integrity = false) {
  store._validateKnowledgeContent(fields, integrity);
  if (!KNOWLEDGE_NODE_TYPES.has(fields?.type)) store._knowledgeFailure(`unknown knowledge node type ${fields?.type}`, 'invalid_node_type', integrity);
  if (!KNOWLEDGE_GROUNDINGS.has(fields?.grounding)) store._knowledgeFailure(`unknown knowledge grounding ${fields?.grounding}`, 'invalid_grounding', integrity);
  if (typeof fields.id !== 'string' || fields.id.length === 0 || Buffer.byteLength(fields.id) > 4_096 || store._knowledgeNodes.has(fields.id)) store._knowledgeFailure(`duplicate/invalid knowledge node ${fields?.id}`, 'duplicate_node', integrity);
  store._validateKnowledgeEvidence(fields.evidence ?? [], event.seq, integrity); store._validateKnowledgeTimes(fields, integrity);
  if (fields.type === 'Decision') {
    if ((fields.evidence?.length ?? 0) === 0 || !Array.isArray(fields.informedBy) || fields.informedBy.length === 0) store._knowledgeFailure('Decision requires Informed evidence and graph source', 'causal_orphan', integrity);
    const effectiveAt = fields.validFrom ?? event.ts ?? store._clock();
    for (const id of fields.informedBy) if (!store._knowledgeLiveAt(store._knowledgeNodes.get(id), effectiveAt)) store._knowledgeFailure(`missing or non-live Informed source ${id}`, 'missing_endpoint', integrity);
  }
  if (fields.type === 'Finding' && fields.grounding === 'verified' && (fields.evidence?.length ?? 0) === 0) store._knowledgeFailure('verified Finding requires evidence', 'causal_orphan', integrity);
  if (fields.promotion?.trigger === 'verified_task_outcome' && (typeof fields.taskId !== 'string' || !store._knowledgeNodes.has(`task:${fields.taskId}`))) store._knowledgeFailure('verified task outcome requires its durable task', 'missing_endpoint', integrity);
}

export function _validateKnowledgeEdgePayload(store, fields, event, integrity = false) {
  store._validateKnowledgeContent(fields, integrity);
  if (!KNOWLEDGE_EDGE_TYPES.has(fields?.type)) store._knowledgeFailure(`unknown knowledge edge type ${fields?.type}`, 'invalid_edge_type', integrity);
  if (fields?.type === 'Contradicts' && store._knowledgeEdges.has(fields.id)) store._knowledgeFailure('knowledge contradiction already exists', 'duplicate_contradiction', integrity);
  if (typeof fields.id !== 'string' || fields.id.length === 0 || Buffer.byteLength(fields.id) > 4_096 || store._knowledgeEdges.has(fields.id)) store._knowledgeFailure(`duplicate/invalid knowledge edge ${fields?.id}`, 'duplicate_edge', integrity);
  const from = store._knowledgeNodes.get(fields.from); const to = store._knowledgeNodes.get(fields.to);
  if (!from || !to) store._knowledgeFailure('knowledge edge endpoints must exist', 'missing_endpoint', integrity);
  store._validateKnowledgeEvidence(fields.evidence ?? [], event.seq, integrity); store._validateKnowledgeTimes(fields, integrity);
  if (fields.type === 'Supersedes') {
    const effective = Date.parse(fields.validFrom ?? event.ts); const openContradiction = [...store._knowledgeEdges.values()].some((edge) => edge.type === 'Contradicts' && !edge.resolvedBy && !edge.validTo && [edge.from, edge.to].includes(fields.to));
    if (fields.from === fields.to || from.type !== to.type || !store._knowledgeLiveAt(from, effective) || !store._knowledgeLiveAt(to, effective) || openContradiction || store._supersessionWouldCycle(fields.from, fields.to)) store._knowledgeFailure('knowledge supersession is invalid', 'invalid_supersession', integrity);
    if (fields.expectedValidityVersion !== to.validityVersion) store._knowledgeFailure('stale validity version', 'stale_version', integrity);
    const floor = Math.max(Date.parse(from.validFrom), Date.parse(to.validFrom));
    if (!Number.isFinite(effective) || effective < floor) store._knowledgeFailure('knowledge supersession is backdated', 'invalid_supersession', integrity);
  }
  if (fields.type === 'Contradicts') {
    const pair = [fields.from, fields.to].sort(); const canonicalId = `knowledge-edge:contradicts:${canonicalDigest(pair)}`;
    const effective = fields.validFrom ?? event.ts; const lifecycleFields = ['validTo', 'resolvedBy', 'winnerId', 'loserId', 'resolutionReason'];
    if (lifecycleFields.some((key) => Object.hasOwn(fields, key)) || fields.from === fields.to || from.type !== to.type || !store._knowledgeLiveAt(from, effective) || !store._knowledgeLiveAt(to, effective) || (fields.evidence?.length ?? 0) === 0 || fields.id !== canonicalId) store._knowledgeFailure('knowledge contradiction is invalid', 'invalid_contradiction', integrity);
    if ([...store._knowledgeEdges.values()].some((edge) => edge.type === 'Contradicts' && !edge.validTo && canonicalDigest([edge.from, edge.to].sort()) === canonicalDigest(pair))) store._knowledgeFailure('knowledge contradiction already exists', 'duplicate_contradiction', integrity);
  }
}

export function _deriveKnowledgePromotion(store, repoId, observedSeq, policy, beforeEventSeq = store._events.length + 1) {
  if (!validKnowledgePromotionPolicy(policy) || policy.repoId !== repoId || !Number.isSafeInteger(observedSeq) || observedSeq < 0 || observedSeq >= beforeEventSeq || observedSeq > store._events.length) throw new CoordinationRefusal('knowledge promotion request is invalid', 'causal_promotion_invalid');
  if (observedSeq > policy.maxScanEvents) throw new CoordinationRefusal('knowledge promotion scan exceeded deployment ceiling', 'causal_promotion_oversize');
  const prefix = store._events.slice(0, observedSeq); const nodesAtBoundary = store.queryKnowledge({ observedSeq }); const edgesAtBoundary = store.queryKnowledgeEdges({ observedSeq }); const nodeMap = new Map(nodesAtBoundary.map((node) => [node.id, node]));
  const promoted = new Set(store._events.slice(0, Math.max(0, beforeEventSeq - 1)).filter((event) => event.kind === 'knowledge.promotion_batch').flatMap((event) => event.payload?.candidates?.map((row) => `${row.sourceSeq}:${row.sourceKind}`) ?? []));
  const taskStatus = new Map(); const scratch = new Map(); const scratchReads = [];
  for (const event of prefix) {
    if (event.kind === 'task.created') taskStatus.set(event.payload.id, 'pending');
    else if (event.kind === 'task.transitioned') taskStatus.set(event.payload.id, event.payload.to);
    else if (event.kind === 'task.acceptance_revoked') taskStatus.set(event.payload.taskId, 'failed');
    else if (event.kind === 'scratch.fact_posted') scratch.set(event.payload.id, { event, active: true });
    else if (event.kind === 'scratch.fact_expired') { const row = scratch.get(event.payload.id); if (row) row.active = false; }
    else if (event.kind === 'scratch.read') scratchReads.push(event);
  }
  const verifiedOutcomes = new Map(nodesAtBoundary.filter((node) => node.type === 'Finding' && node.grounding === 'verified' && node.promotion?.trigger === 'verified_task_outcome' && typeof node.taskId === 'string' && !node.validTo
    && edgesAtBoundary.some((edge) => edge.type === 'VerifiedBy' && edge.from === node.id && edge.to === `task:${node.taskId}`)).map((node) => [node.taskId, node]));
  const candidates = []; const nodes = []; const edges = [];
  const push = (source, type, trigger, taskId, actorRequired = false) => {
    const sourceKind = source.kind === 'driver.recorded' ? `driver.${source.payload.kind}` : source.kind; const commitment = `${source.seq}:${sourceKind}`;
    if (promoted.has(commitment) || (actorRequired && !promotionActor(source.actor))) return;
    if (typeof taskId !== 'string' || !nodeMap.has(`task:${taskId}`)) return;
    const nodeId = `promotion:${canonicalDigest({ repoId, sourceSeq: source.seq, sourceKind })}`;
    const evidence = [{ coordinationSeq: source.seq }]; const promotion = { kind: type, trigger }; const body = type === 'Decision' ? `Consequential coordination decision: ${trigger}` : `Observed coordination failure: ${trigger}`;
    const fields = { id: nodeId, type, grounding: 'observed', body, evidence, promotion, repoId, taskId, sourceSeq: source.seq, sourceKind, sourceDigest: canonicalDigest(source), ...(type === 'Decision' ? { informedBy: [`task:${taskId}`] } : {}) };
    const node = store._knowledgePayload(fields); const edgeType = type === 'Decision' ? 'Informed' : 'ObservedIn'; const edgeId = `knowledge-edge:${edgeType.toLowerCase()}:${nodeId}:task:${taskId}`;
    const edge = store._knowledgePayload({ id: edgeId, type: edgeType, from: nodeId, to: `task:${taskId}`, evidence });
    candidates.push({ nodeId, type, trigger, sourceSeq: source.seq, sourceKind, sourceDigest: canonicalDigest(source) }); nodes.push(node); edges.push(edge);
  };
  for (const source of prefix) {
    if (source.kind === 'task.created') push(source, 'Decision', 'coordination.spawn', source.payload.id, true);
    else if (source.kind === 'driver.recorded' && PROMOTION_DECISION_KINDS.has(source.payload?.kind)) push(source, 'Decision', `coordination.${source.payload.kind}`, source.payload.taskId, true);
    else if (source.kind === 'driver.recorded' && source.actor === 'policy' && PROMOTION_FAILURE_KINDS.has(source.payload?.kind)) push(source, 'Counterexample', `coordination.${source.payload.kind}`, source.payload.taskId, false);
  }
  for (const { event: source, active } of [...scratch.values()].sort((a, b) => a.event.seq - b.event.seq)) {
    const fact = source.payload; const sourceKind = 'scratch.fact_posted'; const commitment = `${source.seq}:${sourceKind}`;
    if (!active || promoted.has(commitment) || fact.grounding !== 'observed' || fact.envRef?.repoId !== repoId) continue;
    const reads = scratchReads.filter((event) => event.payload?.result?.facts?.some((row) => row.id === fact.id) && typeof event.payload?.taskId === 'string');
    const byTask = new Map(); for (const read of reads) if (taskStatus.get(read.payload.taskId) === 'completed' && verifiedOutcomes.has(read.payload.taskId) && !byTask.has(read.payload.taskId)) byTask.set(read.payload.taskId, read);
    const readerTaskIds = [...byTask.keys()].sort(); if (readerTaskIds.length < policy.minScratchReaders) continue;
    // BD3-A/A6b: a fact's author task never satisfies minScratchReaders ALONE — a candidate
    // requires at least one reader outside the producing task (the phase49-shaped A6b row).
    // Independent readers still count normally, so author+independent at minScratchReaders 2
    // promotes exactly as before while an author-only read at minScratchReaders 1 never does.
    if (typeof fact.ownerTask === 'string' && fact.ownerTask.length > 0
      && readerTaskIds.every((taskId) => taskId === fact.ownerTask)) continue;
    const sourceNodeId = `scratch-source:${canonicalDigest({ repoId, sourceSeq: source.seq, sourceKind })}`; const nodeId = `promotion:${canonicalDigest({ repoId, sourceSeq: source.seq, sourceKind })}`;
    const sourceEvidence = [{ coordinationSeq: source.seq }]; const readEvidence = readerTaskIds.map((taskId) => ({ coordinationSeq: byTask.get(taskId).seq })); const outcomeEvidence = readerTaskIds.map((taskId) => ({ coordinationSeq: verifiedOutcomes.get(taskId).observedSeq }));
    const evidence = [...sourceEvidence, ...readEvidence, ...outcomeEvidence].sort((a, b) => a.coordinationSeq - b.coordinationSeq);
    const scratchFactDigest = canonicalDigest(fact.id);
    const sourceNode = store._knowledgePayload({ id: sourceNodeId, type: 'ScratchFact', grounding: 'observed', body: 'Observed Scratch fact metadata', evidence: sourceEvidence, promotion: { kind: 'ScratchFact', trigger: 'scratch.observed_source' }, repoId, sourceSeq: source.seq, sourceKind, scratchFactDigest, namespaceDigest: canonicalDigest(fact.namespace ?? null), keyDigest: canonicalDigest(fact.key ?? null), envRefDigest: canonicalDigest(fact.envRef) });
    const finding = store._knowledgePayload({ id: nodeId, type: 'Finding', grounding: 'observed', body: 'Cited observed Scratch fact', evidence, promotion: { kind: 'Finding', trigger: 'scratch.cited_observed' }, repoId, sourceSeq: source.seq, sourceKind, scratchFactDigest, readerTaskIds, sourceDigest: canonicalDigest(source) });
    const derived = store._knowledgePayload({ id: `knowledge-edge:derivedfrom:${nodeId}:${sourceNodeId}`, type: 'DerivedFrom', from: nodeId, to: sourceNodeId, evidence: sourceEvidence });
    const verified = readerTaskIds.map((taskId) => { const outcome = verifiedOutcomes.get(taskId); return store._knowledgePayload({ id: `knowledge-edge:verifiedby:${nodeId}:${outcome.id}`, type: 'VerifiedBy', from: nodeId, to: outcome.id, evidence: [{ coordinationSeq: byTask.get(taskId).seq }, { coordinationSeq: outcome.observedSeq }] }); });
    candidates.push({ nodeId, type: 'Finding', trigger: 'scratch.cited_observed', sourceSeq: source.seq, sourceKind, sourceDigest: canonicalDigest(source) }); nodes.push(sourceNode, finding); edges.push(derived, ...verified);
  }
  const order = (a, b) => a.sourceSeq - b.sourceSeq || compareCanonicalStrings(a.sourceKind, b.sourceKind) || compareCanonicalStrings(a.nodeId, b.nodeId); candidates.sort(order);
  const candidateOrder = new Map(candidates.map((row, index) => [row.nodeId, index])); nodes.sort((a, b) => (candidateOrder.get(a.id) ?? candidateOrder.get(a.id.replace(/^scratch-source:/, 'promotion:')) ?? Number.MAX_SAFE_INTEGER) - (candidateOrder.get(b.id) ?? candidateOrder.get(b.id.replace(/^scratch-source:/, 'promotion:')) ?? Number.MAX_SAFE_INTEGER) || compareCanonicalStrings(a.id, b.id)); edges.sort((a, b) => compareCanonicalStrings(a.id, b.id));
  if (candidates.length > policy.maxCandidates) throw new CoordinationRefusal('knowledge promotion candidates exceeded deployment ceiling', 'causal_promotion_oversize');
  const candidateBytes = candidates.reduce((sum, candidate) => sum + canonicalBytes({ candidate, nodes: nodes.filter((node) => node.id === candidate.nodeId || node.sourceSeq === candidate.sourceSeq), edges: edges.filter((edge) => edge.from === candidate.nodeId) }), 0);
  const evidenceRefs = [...nodes, ...edges].reduce((sum, row) => sum + (row.evidence?.length ?? 0), 0);
  if (candidateBytes > policy.maxCandidateBytes || evidenceRefs > policy.maxEvidenceRefs) throw new CoordinationRefusal('knowledge promotion projection exceeded deployment ceiling', 'causal_promotion_oversize');
  for (const node of nodes) if ((store._knowledgeNodeHistory.get(node.id) ?? []).some((version) => version.observedSeq < beforeEventSeq)) throw new CoordinationRefusal('knowledge promotion node namespace is occupied', 'causal_promotion_conflict');
  for (const edge of edges) if ((store._knowledgeEdgeHistory.get(edge.id) ?? []).some((version) => version.observedSeq < beforeEventSeq)) throw new CoordinationRefusal('knowledge promotion edge namespace is occupied', 'causal_promotion_conflict');
  return freeze({ candidates, nodes, edges, candidateBytes, evidenceRefs, projectionDigest: canonicalDigest({ candidates, nodes, edges }) });
}

export function _validateKnowledgePromotionPayload(store, payload, event, integrity = false) {
  const fail = (message, code) => { throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code); };
  const fields = ['schemaVersion', 'repoId', 'observedSeq', 'observedAt', 'policy', 'policyDigest', 'candidates', 'nodes', 'edges', 'requestDigest', 'projectionDigest', 'receiptDigest'];
  if (!payload || Object.keys(payload).sort().join(',') !== fields.sort().join(',') || payload.schemaVersion !== 1 || !promotionActor(event.actor) || !validKnowledgePromotionPolicy(payload.policy) || payload.repoId !== payload.policy.repoId || payload.policyDigest !== canonicalDigest(payload.policy)
    || !Number.isSafeInteger(payload.observedSeq) || payload.observedSeq < 0 || payload.observedSeq >= event.seq || payload.observedAt !== store.observationTime(payload.observedSeq)) fail('knowledge promotion receipt shape is invalid', 'causal_promotion_integrity');
  const expectedRequest = canonicalDigest({ actor: event.actor, idempotencyKey: event.idempotencyKey, repoId: payload.repoId, observedSeq: payload.observedSeq, policyDigest: payload.policyDigest });
  if (payload.requestDigest !== expectedRequest) fail('knowledge promotion request binding is invalid', 'causal_promotion_integrity');
  let derived; try { derived = store._deriveKnowledgePromotion(payload.repoId, payload.observedSeq, payload.policy, event.seq); } catch (error) { fail(error.message, error.code ?? 'causal_promotion_integrity'); }
  if (derived.candidates.length === 0 || canonicalDigest(payload.candidates) !== canonicalDigest(derived.candidates) || canonicalDigest(payload.nodes) !== canonicalDigest(derived.nodes) || canonicalDigest(payload.edges) !== canonicalDigest(derived.edges) || payload.projectionDigest !== derived.projectionDigest) fail('knowledge promotion projection diverged', 'causal_promotion_integrity');
  const core = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'receiptDigest'));
  if (payload.receiptDigest !== canonicalDigest(core) || canonicalBytes(payload) > payload.policy.maxBatchBytes) fail('knowledge promotion receipt is invalid or oversized', 'causal_promotion_integrity');
  return derived;
}

export function reverifyKnowledgePromotion(store, repoId, observedSeq, policy, actor, eventSeq) {
  if (!validKnowledgePromotionPolicy(policy) || policy.repoId !== repoId || !promotionActor(actor) || !Number.isSafeInteger(eventSeq)) throw new CoordinationRefusal('knowledge promotion reverify request is invalid', 'causal_promotion_invalid');
  const event = store._events[eventSeq - 1]; if (!event || event.kind !== 'knowledge.promotion_batch' || event.actor !== actor || event.payload?.repoId !== repoId || event.payload?.observedSeq !== observedSeq || event.payload?.policyDigest !== canonicalDigest(policy)) throw new CoordinationRefusal('knowledge promotion receipt does not match authority', 'causal_promotion_conflict');
  store._validateKnowledgePromotionPayload(event.payload, event, false); return freeze({ event: clone(event), projection: store._promotionProjection(event.payload, event), replayed: true, noOp: false });
}

export function reverifyKnowledgePromotionNoOp(store, repoId, observedSeq, policy) {
  if (!validKnowledgePromotionPolicy(policy) || policy.repoId !== repoId) throw new CoordinationRefusal('knowledge promotion no-op reverify request is invalid', 'causal_promotion_invalid');
  const derived = store._deriveKnowledgePromotion(repoId, observedSeq, policy);
  if (derived.candidates.length !== 0) throw new CoordinationRefusal('knowledge promotion no-op is no longer reproducible', 'causal_promotion_conflict');
  return freeze({ event: null, projection: { repoId, observedSeq, observedAt: store.observationTime(observedSeq), policyDigest: canonicalDigest(policy), projectionDigest: derived.projectionDigest, receiptDigest: null, eventSeq: null, summaries: [] }, replayed: true, noOp: true });
}

export function _eligibleScratchOracle(store, repoId, factRow, oracleTaskId, state, nodeMap) {
  const fact = factRow?.event?.payload; const task = state.tasks.get(oracleTaskId);
  if (!factRow?.active || fact?.grounding !== 'derived' || fact?.envRef?.repoId !== repoId || typeof fact.ownerTask !== 'string' || !task || task.status !== 'completed' || !task.terminalEvent || !nodeMap.has(`task:${oracleTaskId}`)) return null;
  if (!/^scratch-fact:[a-f0-9]{64}$/.test(fact.id)) return null;
  const producer = state.tasks.get(fact.ownerTask); let producerRoute; let reviewerRoute;
  try { producerRoute = parseRouteTupleKey(producer?.routeKey); reviewerRoute = parseRouteTupleKey(task.routeKey); } catch { return null; }
  const producerTuple = producerRoute.fields; const reviewerTuple = reviewerRoute.fields;
  if (producerTuple[0] === reviewerTuple[0] || producerTuple[4] === reviewerTuple[4]) return null;
  const routeMatchesTask = (row, tuple) => row?.claimed?.payload?.routeKey === row.routeKey && row.claimed.payload.harnessResolved === `${tuple[0]}@${tuple[1]}`
    && (row.claimed.payload.modelResolved ?? 'default') === tuple[2] && (row.claimed.payload.effortResolved ?? 'default') === tuple[3] && row.payload.taskType === tuple[5];
  if (!routeMatchesTask(producer, producerTuple) || !routeMatchesTask(task, reviewerTuple)) return null;
  const commitment = { schemaVersion: 1, kind: 'scratch.fact', scratchFactId: fact.id, scratchFactDigest: canonicalDigest(fact), sourceEventSeq: factRow.event.seq, sourceEventDigest: canonicalDigest(factRow.event), repoId, envRefDigest: canonicalDigest(fact.envRef), producerTaskId: fact.ownerTask, producerHarness: producerTuple[0], producerFamily: producerTuple[4], reviewerHarness: reviewerTuple[0], reviewerFamily: reviewerTuple[4] };
  const review = task.payload.review;
  if (!review || review.kind !== 'oracle' || review.independent !== true || review.parentTaskId !== fact.ownerTask || review.baseSha !== fact.envRef.treeSha || task.payload.worktreeBaseSha !== fact.envRef.treeSha || canonicalDigest(review.knowledgeTarget) !== canonicalDigest(commitment)) return null;
  const acceptedByOracle = (artifact) => (artifact.provenance ?? []).some((ref) => {
      const mapped = Number.isSafeInteger(ref?.coordinationSeq) ? state.prefix[ref.coordinationSeq - 1] : null; if (mapped?.kind !== 'evidence.mapped' || mapped.payload?.kind !== 'verify.reverified') return false;
      if (mapped.payload.worker !== task.claimed?.payload?.worker || mapped.payload.worker !== task.payload.reservedWorkerId) return false;
      const source = store._operationalRead?.(mapped.payload.worker, mapped.payload.workerSeq); return source?.kind === 'verify.reverified' && source?.taskId === oracleTaskId && source?.runId === task.payload.runId && source?.payload?.accept === true && source?.routeKey === task.routeKey
        && source?.harness === `${reviewerTuple[0]}@${reviewerTuple[1]}` && source?.modelResolved === reviewerTuple[2] && source?.effortResolved === reviewerTuple[3]
        && source?.payload?.capture?.sha === artifact.refs?.sha && source?.payload?.capture?.baseSha === fact.envRef.treeSha && source?.payload?.capture?.model === reviewerTuple[2] && source?.payload?.capture?.effort === reviewerTuple[3] && source?.payload?.capture?.routeKey === task.routeKey;
    });
  const eligible = state.artifacts.filter((event) => {
    const artifact = event.payload; if (artifact.taskId !== oracleTaskId || artifact.kind !== 'review' || artifact.mediaType !== 'application/vnd.baton.review+json' || artifact.accepted !== true || canonicalDigest(artifact.review) !== canonicalDigest(review) || !nodeMap.has(`artifact:${artifact.id}`)) return false;
    if (!artifact.refs || Object.keys(artifact.refs).sort().join(',') !== ['parentTaskId', 'sha'].sort().join(',') || artifact.refs.parentTaskId !== fact.ownerTask || typeof artifact.refs.sha !== 'string' || artifact.refs.sha.length === 0) return false;
    const pairedCommit = state.artifacts.some((candidate) => !state.supersededArtifacts.has(candidate.payload?.id) && candidate.payload?.taskId === oracleTaskId && candidate.payload?.kind === 'commit' && candidate.payload?.mediaType === 'application/vnd.git.commit'
      && candidate.payload?.accepted === true && candidate.payload?.refs?.sha === artifact.refs.sha && acceptedByOracle(candidate.payload));
    return !state.supersededArtifacts.has(artifact.id) && pairedCommit && acceptedByOracle(artifact);
  }).sort((a, b) => a.seq - b.seq);
  if (eligible.length !== 1) return null;
  const artifactEvent = eligible[0]; const mappedSeqs = artifactEvent.payload.provenance.map((ref) => ref.coordinationSeq).filter(Number.isSafeInteger).sort((a, b) => a - b);
  return { taskId: oracleTaskId, taskNodeId: `task:${oracleTaskId}`, artifactId: artifactEvent.payload.id, artifactNodeId: `artifact:${artifactEvent.payload.id}`, artifactEventSeq: artifactEvent.seq, terminalEventSeq: task.terminalEvent.seq, evidenceSeqs: [...new Set([factRow.event.seq, task.terminalEvent.seq, artifactEvent.seq, ...mappedSeqs])].sort((a, b) => a - b), producerRoute: producerTuple, reviewerRoute: reviewerTuple, producerRouteDigest: canonicalDigest(producerTuple), reviewerRouteDigest: canonicalDigest(reviewerTuple) };
}

export function _deriveScratchCorrection(store, repoId, observedSeq, policy, rawRequest, beforeEventSeq = store._events.length + 1) {
  if (!validKnowledgeScratchCorrectionPolicy(policy) || policy.repoId !== repoId || !Number.isSafeInteger(observedSeq) || observedSeq < 0 || observedSeq >= beforeEventSeq || observedSeq > store._events.length) throw new CoordinationRefusal('Scratch correction boundary or policy is invalid', 'causal_correction_invalid');
  if (store._events.slice(observedSeq, Math.max(observedSeq, beforeEventSeq - 1)).some((event) => !SCRATCH_CORRECTION_ADMIN_EVENTS.has(event.kind))) throw new CoordinationRefusal('Scratch correction boundary became stale', 'causal_correction_conflict');
  if (observedSeq > policy.maxScanEvents) throw new CoordinationRefusal('Scratch correction scan exceeded deployment ceiling', 'causal_correction_oversize');
  const request = store._scratchCorrectionRequest(rawRequest); const state = store._scratchCorrectionPrefix(observedSeq); const nodesAtBoundary = store.queryKnowledge({ observedSeq }); const edgesAtBoundary = store.queryKnowledgeEdges({ observedSeq }); const nodeMap = new Map(nodesAtBoundary.map((node) => [node.id, node]));
  const targetNodeId = request.targetNodeId ?? null; let target = null;
  if (targetNodeId) {
    const node = nodeMap.get(targetNodeId); const allowedTrigger = ['scratch.cited_observed', 'scratch.oracle_verified', 'scratch.corrected'].includes(node?.promotion?.trigger);
    const source = Number.isSafeInteger(node?.derivedFromEvent) ? state.prefix[node.derivedFromEvent - 1] : null; const validSource = source?.kind === 'knowledge.promotion_batch' || source?.kind === 'knowledge.scratch_corrected';
    const openContradiction = edgesAtBoundary.some((edge) => edge.type === 'Contradicts' && !edge.validTo && [edge.from, edge.to].includes(targetNodeId));
    if (!node || node.type !== 'Finding' || node.repoId !== repoId || !allowedTrigger || !validSource || node.validityVersion !== request.expectedValidityVersion || openContradiction) throw new CoordinationRefusal('Scratch correction target is stale or ineligible', openContradiction ? 'unresolved_contradiction' : 'causal_correction_conflict');
    target = { nodeId: targetNodeId, expectedValidityVersion: request.expectedValidityVersion, observedSeq: node.observedSeq, contentDigest: node.contentDigest };
  }
  if (request.action === 'retract') {
    const affectedReadEvents = store._knowledgeReads.filter((read) => read.eventSeq <= observedSeq && read.nodeIds.includes(targetNodeId)).map((read) => read.eventSeq);
    if (affectedReadEvents.length > policy.maxAffectedReads) throw new CoordinationRefusal('Scratch correction contamination exceeded deployment ceiling', 'causal_correction_oversize');
    const evidenceDigest = canonicalDigest({ target, affectedReadEvents }); const projectionDigest = canonicalDigest({ action: request.action, target, nodes: [], edges: [], affectedReadEvents, evidenceDigest });
    return freeze({ request, target, nodes: [], edges: [], affectedReadEvents, evidenceRefs: 0, evidenceDigest, projectionDigest, replacement: null, oracleTaskId: null });
  }

  const factId = request.action === 'release' ? request.scratchFactId : request.replacementScratchFactId; const factRow = state.scratch.get(factId); const fact = factRow?.event?.payload;
  if (!factRow?.active || fact?.envRef?.repoId !== repoId || !['observed', 'derived'].includes(fact?.grounding)) throw new CoordinationRefusal('Scratch correction source is ineligible', 'causal_correction_conflict');
  if (request.action === 'release' && fact.grounding !== 'derived') throw new CoordinationRefusal('Scratch release requires a derived fact', 'causal_correction_conflict');
  const scratchFactFullDigest = canonicalDigest(fact); const sourceDigest = canonicalDigest(factRow.event);
  const representsFact = (node) => node?.scratchFactFullDigest === scratchFactFullDigest || (node?.sourceSeq === factRow.event.seq && node?.sourceDigest === sourceDigest);
  if (target && targetNodeId && representsFact(nodeMap.get(targetNodeId))) throw new CoordinationRefusal('Scratch correction cannot replace a Finding with the same fact', 'causal_correction_conflict');
  if (nodesAtBoundary.some((node) => node.type === 'Finding' && !node.validTo && representsFact(node))) throw new CoordinationRefusal('Scratch fact already has a live Finding', 'causal_correction_conflict');

  const verifiedOutcomes = new Map(nodesAtBoundary.filter((node) => node.type === 'Finding' && !node.validTo && node.grounding === 'verified' && node.promotion?.trigger === 'verified_task_outcome' && typeof node.taskId === 'string'
    && edgesAtBoundary.some((edge) => edge.type === 'VerifiedBy' && edge.from === node.id && edge.to === `task:${node.taskId}`)).map((node) => [node.taskId, node]));
  let oracle = null; let readerTaskIds = []; let evidenceSeqs = [factRow.event.seq]; const verifiedTargets = [];
  if (fact.grounding === 'observed') {
    if (Object.hasOwn(request, 'oracleTaskId')) throw new CoordinationRefusal('Observed Scratch correction cannot nominate an oracle', 'causal_correction_invalid');
    const byTask = new Map(); for (const read of state.scratchReads) if (read.payload?.result?.facts?.some((row) => row.id === fact.id) && typeof read.payload?.taskId === 'string' && state.tasks.get(read.payload.taskId)?.status === 'completed' && verifiedOutcomes.has(read.payload.taskId) && !byTask.has(read.payload.taskId)) byTask.set(read.payload.taskId, read);
    readerTaskIds = [...byTask.keys()].sort(); if (readerTaskIds.length < policy.minScratchReaders) throw new CoordinationRefusal('Observed Scratch replacement is under-qualified', 'causal_correction_conflict');
    for (const taskId of readerTaskIds) { const outcome = verifiedOutcomes.get(taskId); verifiedTargets.push({ nodeId: outcome.id, evidence: [byTask.get(taskId).seq, outcome.observedSeq] }); evidenceSeqs.push(byTask.get(taskId).seq, outcome.observedSeq); }
  } else {
    if (typeof request.oracleTaskId !== 'string') throw new CoordinationRefusal('Derived Scratch correction requires an oracle task', 'causal_correction_invalid');
    oracle = store._eligibleScratchOracle(repoId, factRow, request.oracleTaskId, state, nodeMap); if (!oracle) throw new CoordinationRefusal('Derived Scratch oracle evidence is ineligible', 'causal_correction_conflict'); evidenceSeqs.push(...oracle.evidenceSeqs);
  }
  evidenceSeqs = [...new Set(evidenceSeqs)].sort((a, b) => a - b); const sourceKind = 'scratch.fact_posted'; const sourceNodeId = `scratch-source:${canonicalDigest({ repoId, sourceSeq: factRow.event.seq, sourceKind })}`;
  const findingId = `scratch-correction:${canonicalDigest({ repoId, action: request.action, sourceSeq: factRow.event.seq, targetNodeId, oracleTaskId: oracle?.taskId ?? null })}`; const sourceEvidence = [{ coordinationSeq: factRow.event.seq }]; const findingEvidence = evidenceSeqs.map((coordinationSeq) => ({ coordinationSeq }));
  const sourceNode = store._knowledgePayload({ id: sourceNodeId, type: 'ScratchFact', grounding: fact.grounding, body: `${fact.grounding === 'derived' ? 'Derived' : 'Observed'} Scratch fact metadata`, evidence: sourceEvidence, promotion: { kind: 'ScratchFact', trigger: fact.grounding === 'derived' ? 'scratch.derived_source' : 'scratch.observed_source' }, repoId, sourceSeq: factRow.event.seq, sourceKind, scratchFactDigest: canonicalDigest(fact.id), scratchFactFullDigest, namespaceDigest: canonicalDigest(fact.namespace ?? null), keyDigest: canonicalDigest(fact.key ?? null), envRefDigest: canonicalDigest(fact.envRef) });
  const trigger = request.action === 'release' ? 'scratch.oracle_verified' : 'scratch.corrected'; const grounding = fact.grounding === 'derived' ? 'verified' : 'observed';
  const finding = store._knowledgePayload({ id: findingId, type: 'Finding', grounding, body: request.action === 'release' ? 'Independently verified derived Scratch fact' : 'Corrected Scratch fact', evidence: findingEvidence, promotion: { kind: 'Finding', trigger }, repoId, sourceSeq: factRow.event.seq, sourceKind, scratchFactDigest: canonicalDigest(fact.id), scratchFactFullDigest, readerTaskIds, oracleTaskId: oracle?.taskId ?? null, sourceDigest });
  const edges = [store._knowledgePayload({ id: `knowledge-edge:derivedfrom:${findingId}:${sourceNodeId}`, type: 'DerivedFrom', from: findingId, to: sourceNodeId, evidence: sourceEvidence })];
  for (const row of verifiedTargets) edges.push(store._knowledgePayload({ id: `knowledge-edge:verifiedby:${findingId}:${row.nodeId}`, type: 'VerifiedBy', from: findingId, to: row.nodeId, evidence: row.evidence.map((coordinationSeq) => ({ coordinationSeq })) }));
  if (oracle) {
    edges.push(store._knowledgePayload({ id: `knowledge-edge:verifiedby:${findingId}:${oracle.taskNodeId}`, type: 'VerifiedBy', from: findingId, to: oracle.taskNodeId, evidence: oracle.evidenceSeqs.map((coordinationSeq) => ({ coordinationSeq })) }));
    edges.push(store._knowledgePayload({ id: `knowledge-edge:verifiedby:${findingId}:${oracle.artifactNodeId}`, type: 'VerifiedBy', from: findingId, to: oracle.artifactNodeId, evidence: [{ coordinationSeq: oracle.artifactEventSeq }, { artifactId: oracle.artifactId }] }));
  }
  if (target) edges.push(store._knowledgePayload({ id: `knowledge-edge:supersedes:${findingId}:${target.nodeId}`, type: 'Supersedes', from: findingId, to: target.nodeId, evidence: findingEvidence, expectedValidityVersion: target.expectedValidityVersion }));
  const nodes = [sourceNode, finding].sort((a, b) => compareCanonicalStrings(a.id, b.id)); edges.sort((a, b) => compareCanonicalStrings(a.id, b.id));
  for (const node of nodes) if ((store._knowledgeNodeHistory.get(node.id) ?? []).some((version) => version.observedSeq < beforeEventSeq)) throw new CoordinationRefusal('Scratch correction node namespace is occupied', 'causal_correction_conflict');
  for (const edge of edges) if ((store._knowledgeEdgeHistory.get(edge.id) ?? []).some((version) => version.observedSeq < beforeEventSeq)) throw new CoordinationRefusal('Scratch correction edge namespace is occupied', 'causal_correction_conflict');
  const affectedReadEvents = target ? store._knowledgeReads.filter((read) => read.eventSeq <= observedSeq && read.nodeIds.includes(target.nodeId)).map((read) => read.eventSeq) : [];
  const evidenceRefs = [...nodes, ...edges].reduce((sum, row) => sum + (row.evidence?.length ?? 0), 0); if (affectedReadEvents.length > policy.maxAffectedReads || evidenceRefs > policy.maxEvidenceRefs) throw new CoordinationRefusal('Scratch correction projection exceeded deployment ceiling', 'causal_correction_oversize');
  const evidenceDigest = canonicalDigest({ sourceEventSeq: factRow.event.seq, evidenceSeqs, target, affectedReadEvents, oracleTaskId: oracle?.taskId ?? null, producerRouteDigest: oracle?.producerRouteDigest ?? null, reviewerRouteDigest: oracle?.reviewerRouteDigest ?? null }); const projectionDigest = canonicalDigest({ action: request.action, target, nodes, edges, affectedReadEvents, evidenceDigest });
  return freeze({ request, target, nodes, edges, affectedReadEvents, evidenceRefs, evidenceDigest, projectionDigest, replacement: { nodeId: findingId, grounding }, oracleTaskId: oracle?.taskId ?? null });
}

export function _validateScratchCorrectionPayload(store, payload, event, integrity = false) {
  const fail = (message, code = 'causal_correction_integrity') => { throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code); };
  const fields = ['schemaVersion', 'action', 'repoId', 'observedSeq', 'observedAt', 'policy', 'policyDigest', 'request', 'requestDigest', 'target', 'nodes', 'edges', 'affectedReadEvents', 'evidenceDigest', 'projectionDigest', 'receiptDigest'];
  if (!payload || Object.keys(payload).sort().join(',') !== fields.sort().join(',') || payload.schemaVersion !== 1 || !promotionActor(event.actor) || !validKnowledgeScratchCorrectionPolicy(payload.policy) || payload.repoId !== payload.policy.repoId || payload.action !== payload.request?.action || payload.policyDigest !== canonicalDigest(payload.policy)
    || !Number.isSafeInteger(payload.observedSeq) || payload.observedSeq < 0 || payload.observedSeq >= event.seq || payload.observedAt !== store.observationTime(payload.observedSeq)) fail('Scratch correction receipt shape is invalid');
  const requestDigest = canonicalDigest({ actor: event.actor, idempotencyKey: event.idempotencyKey, repoId: payload.repoId, observedSeq: payload.observedSeq, policyDigest: payload.policyDigest, request: payload.request }); if (payload.requestDigest !== requestDigest) fail('Scratch correction request binding is invalid');
  let derived; try { derived = store._deriveScratchCorrection(payload.repoId, payload.observedSeq, payload.policy, payload.request, event.seq); } catch (error) { fail(error.message, error.code ?? 'causal_correction_integrity'); }
  if (canonicalDigest(payload.target) !== canonicalDigest(derived.target) || canonicalDigest(payload.nodes) !== canonicalDigest(derived.nodes) || canonicalDigest(payload.edges) !== canonicalDigest(derived.edges) || canonicalDigest(payload.affectedReadEvents) !== canonicalDigest(derived.affectedReadEvents) || payload.evidenceDigest !== derived.evidenceDigest || payload.projectionDigest !== derived.projectionDigest) fail('Scratch correction projection diverged');
  const core = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'receiptDigest')); if (payload.receiptDigest !== canonicalDigest(core) || canonicalBytes(payload) > payload.policy.maxBatchBytes) fail('Scratch correction receipt is invalid or oversized'); return derived;
}

export function reverifyScratchCorrection(store, repoId, observedSeq, policy, actor, eventSeq, request) {
  if (!validKnowledgeScratchCorrectionPolicy(policy) || policy.repoId !== repoId || !promotionActor(actor) || !Number.isSafeInteger(eventSeq)) throw new CoordinationRefusal('Scratch correction reverify request is invalid', 'causal_correction_invalid'); const event = store._events[eventSeq - 1];
  const normalized = store._scratchCorrectionRequest(request); const policyDigest = canonicalDigest(policy); const requestDigest = event ? canonicalDigest({ actor, idempotencyKey: event.idempotencyKey, repoId, observedSeq, policyDigest, request: normalized }) : null;
  if (!event || event.kind !== 'knowledge.scratch_corrected' || event.actor !== actor || event.payload?.repoId !== repoId || event.payload?.observedSeq !== observedSeq || event.payload?.policyDigest !== policyDigest || event.payload?.requestDigest !== requestDigest || canonicalDigest(event.payload?.request) !== canonicalDigest(normalized)) throw new CoordinationRefusal('Scratch correction receipt does not match authority', 'causal_correction_conflict'); store._validateScratchCorrectionPayload(event.payload, event, false); return freeze({ event: clone(event), projection: store._scratchCorrectionProjection(event.payload, event), replayed: true });
}

export function _deriveWorkflowAdmission(store, repoId, runId, candidateFindingId, policy, beforeEventSeq = store._events.length + 1) {
  if (!validKnowledgeWorkflowAdmissionPolicy(policy) || policy.repoId !== repoId || !validRunId(runId)
    || typeof candidateFindingId !== 'string' || candidateFindingId.length === 0) {
    throw new CoordinationRefusal('workflow admission request is invalid', 'workflow_admit_invalid');
  }
  const boundary = beforeEventSeq - 1;
  const nodesAtBoundary = store.queryKnowledge({ observedSeq: boundary });
  const edgesAtBoundary = store.queryKnowledgeEdges({ observedSeq: boundary });
  const nodeMap = new Map(nodesAtBoundary.map((node) => [node.id, node]));
  const candidate = nodeMap.get(candidateFindingId);
  const alreadyPromoted = edgesAtBoundary.some((edge) => edge.type === 'DerivedFrom' && edge.to === candidateFindingId
    && nodeMap.get(edge.from)?.promotion?.trigger === 'workflow.admitted');
  if (!candidate || candidate.type !== 'Finding' || candidate.grounding !== 'observed'
    || !['board.item_closed', 'package.admitted', 'orientation.leaf_proposed'].includes(candidate.promotion?.trigger) || alreadyPromoted) {
    throw new CoordinationRefusal('workflow admission candidate is ineligible', 'workflow_admit_ineligible');
  }
  const admittedId = `finding:workflow-admitted:${candidateFindingId}`;
  const evidence = [...(candidate.evidence ?? []), { coordinationSeq: candidate.observedSeq }];
  const finding = store._knowledgePayload({
    id: admittedId, type: 'Finding', grounding: 'verified', evidence,
    promotion: { kind: 'Finding', trigger: 'workflow.admitted' }, repoId, runId,
  });
  const edgeId = `knowledge-edge:derivedfrom:${admittedId}:${candidateFindingId}`;
  const edge = store._knowledgePayload({
    id: edgeId, type: 'DerivedFrom', from: admittedId, to: candidateFindingId,
    evidence: [{ coordinationSeq: candidate.observedSeq }],
  });
  const projectionDigest = canonicalDigest({ candidateFindingId, nodes: [finding], edges: [edge] });
  return freeze({ candidateFindingId, nodes: [finding], edges: [edge], projectionDigest });
}

export function _validateWorkflowAdmissionPayload(store, payload, event, integrity = false) {
  const fail = (message, code = 'workflow_admit_integrity') => { throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code); };
  const fields = ['schemaVersion', 'repoId', 'runId', 'policy', 'policyDigest', 'candidateFindingId', 'requestDigest', 'nodes', 'edges', 'projectionDigest', 'receiptDigest'];
  if (!payload || Object.keys(payload).sort().join(',') !== fields.sort().join(',') || payload.schemaVersion !== 1
    || !promotionActor(event.actor) || !validKnowledgeWorkflowAdmissionPolicy(payload.policy)
    || payload.repoId !== payload.policy.repoId || !validRunId(payload.runId)
    || payload.policyDigest !== canonicalDigest(payload.policy)) fail('workflow admission receipt shape is invalid');
  const requestDigest = canonicalDigest({ actor: event.actor, idempotencyKey: event.idempotencyKey, repoId: payload.repoId, runId: payload.runId, policyDigest: payload.policyDigest, candidateFindingId: payload.candidateFindingId });
  if (payload.requestDigest !== requestDigest) fail('workflow admission request binding is invalid');
  let derived;
  try { derived = store._deriveWorkflowAdmission(payload.repoId, payload.runId, payload.candidateFindingId, payload.policy, event.seq); }
  catch (error) { fail(error.message, error.code ?? 'workflow_admit_integrity'); }
  if (canonicalDigest(payload.nodes) !== canonicalDigest(derived.nodes) || canonicalDigest(payload.edges) !== canonicalDigest(derived.edges)
    || payload.projectionDigest !== derived.projectionDigest) fail('workflow admission projection diverged');
  const core = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'receiptDigest'));
  if (payload.receiptDigest !== canonicalDigest(core) || canonicalBytes(payload) > payload.policy.maxBatchBytes) fail('workflow admission receipt is invalid or oversized');
  return derived;
}

export function admitWorkflowFinding(store, repoId, runId, candidateFindingId, policy, auth, lease) {
  if (!promotionActor(auth?.actor) || typeof auth?.key !== 'string' || auth.key.length === 0
    || !validKnowledgeWorkflowAdmissionPolicy(policy) || policy.repoId !== repoId) {
    throw new CoordinationRefusal('workflow admission authority is invalid', 'workflow_admit_invalid');
  }
  const policyDigest = canonicalDigest(policy);
  const requestDigest = canonicalDigest({ actor: auth.actor, idempotencyKey: auth.key, repoId, runId, policyDigest, candidateFindingId });
  const prior = store._byKey.get(auth.key);
  // XB (lifecycle keystone): when the admission auth carries session fields (the settlement
  // command derives them from the calling principal), admission binds to the session that
  // ACQUIRED the lease — never a bearer of the digest. Codex #2b: the SESSION GATE precedes the
  // idempotent-replay path, so a replayed admit with a foreign/expired session refuses with the
  // typed session code, never a replay shortcut. The full _activeRunOrchestratorLease gate
  // (not_found / revoked / expired / session_mismatch / parent_inactive / parent_stale /
  // run_stopping) applies to first-time admits; a replay re-validates only the session binding,
  // so a crash after the admit's own revoke step (rule 16b / KS7) still replays idempotently.
  // Absent session fields, the original structural binding check applies (the shipped
  // primitive's contract is unchanged for callers that do not present a session).
  const carriesSession = auth?.principalId !== undefined || auth?.sessionId !== undefined
    || auth?.sessionAuthorityDigest !== undefined;
  if (carriesSession) {
    const leaseRecord = store._runOrchestratorLeases.get(lease?.id);
    if (!leaseRecord) store._runLineageFailure('run orchestrator lease was not found', 'run_orchestrator_lease_not_found');
    if (auth?.principalId !== leaseRecord.session.principalId
      || auth?.sessionId !== leaseRecord.session.sessionId
      || auth?.sessionAuthorityDigest !== leaseRecord.session.authorityDigest) {
      store._runLineageFailure('run orchestrator session does not match the lease', 'run_orchestrator_session_mismatch');
    }
    if (prior) {
      // Replay path: the binding already passed; refuse only a now-expired session. The lease's
      // own post-admit revocation is the normal KS7 resume state and must not refuse the retry.
      if (Date.parse(store._clock()) >= Date.parse(leaseRecord.session.expiresAt)) {
        store._runLineageFailure('run orchestrator session is expired', 'run_orchestrator_session_mismatch');
      }
    } else {
      const activeLease = store._activeRunOrchestratorLease({
        orchestratorLeaseId: lease?.id,
        principalId: auth?.principalId, sessionId: auth?.sessionId,
        sessionAuthorityDigest: auth?.sessionAuthorityDigest,
      });
      if (activeLease.leaseDigest !== lease?.digest || activeLease.issuedEvent !== lease?.issuedEvent
        || activeLease.parent?.runId !== runId) {
        throw new CoordinationRefusal('workflow admission lease binding is invalid', 'workflow_admit_lease_invalid');
      }
    }
  } else if (!prior) {
    const leaseRecord = store._runOrchestratorLeases.get(lease?.id);
    if (!leaseRecord || leaseRecord.status !== 'active' || leaseRecord.leaseDigest !== lease?.digest
      || leaseRecord.issuedEvent !== lease?.issuedEvent || leaseRecord.parent?.runId !== runId) {
      throw new CoordinationRefusal('workflow admission lease binding is invalid', 'workflow_admit_lease_invalid');
    }
  }
  if (prior) {
    // Replay-exactness is still validated after the session gate (codex #2b): the prior event
    // must be the exact same admission.
    if (prior.kind !== 'knowledge.workflow_admitted' || prior.actor !== auth.actor || prior.payload?.requestDigest !== requestDigest) {
      throw new CoordinationRefusal('workflow admission idempotency conflict', 'workflow_admit_conflict');
    }
    store._validateWorkflowAdmissionPayload(prior.payload, prior, false);
    return freeze({ event: clone(prior), finding: clone(store._knowledgeNodes.get(prior.payload.nodes[0].id)), replayed: true });
  }
  const derived = store._deriveWorkflowAdmission(repoId, runId, candidateFindingId, policy);
  const core = {
    schemaVersion: 1, repoId, runId, policy: clone(policy), policyDigest,
    candidateFindingId, requestDigest, nodes: clone(derived.nodes), edges: clone(derived.edges),
    projectionDigest: derived.projectionDigest,
  };
  const payload = { ...core, receiptDigest: canonicalDigest(core) };
  if (canonicalBytes(payload) > policy.maxBatchBytes) throw new CoordinationRefusal('workflow admission batch exceeded deployment ceiling', 'workflow_admit_oversize');
  const fixedTs = store._clock();
  const prospective = { schemaVersion: 1, seq: store._events.length + 1, ts: fixedTs, kind: 'knowledge.workflow_admitted', actor: auth.actor, idempotencyKey: auth.key, payload };
  store._validateWorkflowAdmissionPayload(payload, prospective, false);
  const event = store._append('knowledge.workflow_admitted', payload, auth, fixedTs);
  return freeze({ event: clone(event), finding: clone(store._knowledgeNodes.get(derived.nodes[0].id)), replayed: false });
}

export function _prepareKnowledgeNode(store, fields, promotion = null, validate = true) {
  const evidence = clone(fields.evidence ?? []);
  const extras = { evidence, id: fields.id ?? `knowledge:${fields.type}:${digest(fields)}`, ...(promotion === null ? {} : { promotion: clone(promotion) }) };
  const payload = store._knowledgePayload(fields, extras);
  if (validate) store._validateKnowledgeNodePayload(payload, { seq: store._events.length + 1, ts: store._clock() }, false);
  return payload;
}

export function _deriveBoundedContradictionResolution(store, repoId, observedSeq, policy, rawRequest, beforeEventSeq = store._events.length + 1) {
  if (!validKnowledgeContradictionPolicy(policy) || policy.repoId !== repoId || !Number.isSafeInteger(observedSeq) || observedSeq < 0 || observedSeq >= beforeEventSeq || observedSeq > store._events.length) throw new CoordinationRefusal('knowledge contradiction resolution boundary is invalid', 'causal_contradiction_invalid');
  if (observedSeq > policy.maxScanEvents) throw new CoordinationRefusal('knowledge contradiction resolution scan exceeded deployment ceiling', 'causal_contradiction_oversize');
  if (store._events.slice(observedSeq, Math.max(observedSeq, beforeEventSeq - 1)).some((event) => !CONTRADICTION_ADMIN_EVENTS.has(event.kind))) throw new CoordinationRefusal('knowledge contradiction resolution boundary became stale', 'causal_contradiction_conflict');
  const request = store._contradictionResolutionRequest(rawRequest, policy); const nodes = store.queryKnowledge({ observedSeq }); const edges = store.queryKnowledgeEdges({ observedSeq });
  if (edges.length > policy.maxScanEdges) throw new CoordinationRefusal('knowledge contradiction resolution edge scan exceeded deployment ceiling', 'causal_contradiction_oversize');
  const nodeMap = new Map(nodes.map((node) => [node.id, node])); const edge = edges.find((row) => row.id === request.edgeId); const winner = nodeMap.get(request.winnerId); const loser = nodeMap.get(request.loserId);
  const preAppendNodes = new Map(store.queryKnowledge({ observedSeq: beforeEventSeq - 1 }).map((node) => [node.id, node])); const preAppendEdges = new Map(store.queryKnowledgeEdges({ observedSeq: beforeEventSeq - 1 }).map((row) => [row.id, row]));
  const currentEdge = preAppendEdges.get(request.edgeId); const currentWinner = preAppendNodes.get(request.winnerId); const currentLoser = preAppendNodes.get(request.loserId);
  if (!edge || edge.type !== 'Contradicts' || edge.validTo || edge.resolvedBy || !winner || !loser || winner.validTo || loser.validTo || ![edge.from, edge.to].includes(winner.id) || ![edge.from, edge.to].includes(loser.id)
    || !currentEdge || currentEdge.validTo || currentEdge.resolvedBy || !currentWinner || currentWinner.validTo || !currentLoser || currentLoser.validTo
    || canonicalDigest(edge) !== canonicalDigest(currentEdge) || canonicalDigest(winner) !== canonicalDigest(currentWinner) || canonicalDigest(loser) !== canonicalDigest(currentLoser)) throw new CoordinationRefusal('knowledge contradiction is stale, resolved, or mismatched', 'causal_contradiction_conflict');
  if (edge.validityVersion !== request.expectedEdgeValidityVersion || winner.validityVersion !== request.expectedWinnerValidityVersion || loser.validityVersion !== request.expectedLoserValidityVersion) throw new CoordinationRefusal('knowledge contradiction versions are stale', 'causal_contradiction_conflict');
  const affectedReadEvents = store._knowledgeReads.filter((read) => read.eventSeq <= observedSeq && read.nodeIds.includes(loser.id)).map((read) => read.eventSeq); const evidenceRefs = (edge.evidence ?? []).length + (winner.evidence ?? []).length + (loser.evidence ?? []).length;
  if (affectedReadEvents.length > policy.maxAffectedReads || evidenceRefs > policy.maxEvidenceRefs) throw new CoordinationRefusal('knowledge contradiction resolution evidence exceeded deployment ceiling', 'causal_contradiction_oversize');
  const projectionCore = {
    edgeId: edge.id, winnerId: winner.id, loserId: loser.id,
    expectedEdgeValidityVersion: edge.validityVersion, expectedWinnerValidityVersion: winner.validityVersion, expectedLoserValidityVersion: loser.validityVersion,
    edgeValidityVersion: edge.validityVersion + 1, winnerValidityVersion: winner.validityVersion, loserValidityVersion: loser.validityVersion + 1,
    edgeContentDigest: edge.contentDigest, winnerContentDigest: winner.contentDigest, loserContentDigest: loser.contentDigest,
    reasonDigest: canonicalDigest(request.reason), affectedReadEvents, evidenceRefs,
  };
  return freeze({ request, affectedReadEvents, evidenceRefs, projectionCore, projectionDigest: canonicalDigest(projectionCore) });
}

export function _validateBoundedContradictionResolutionPayload(store, payload, event, integrity = false) {
  const fail = (message, code = 'causal_contradiction_integrity') => { throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code); };
  const fields = ['schemaVersion', 'repoId', 'observedSeq', 'observedAt', 'policy', 'policyDigest', 'request', 'requestDigest', 'edgeId', 'winnerId', 'loserId', 'affectedReadEvents', 'projectionDigest', 'receiptDigest'];
  if (!payload || Object.keys(payload).sort().join(',') !== fields.sort().join(',') || payload.schemaVersion !== 2 || !promotionActor(event.actor) || !validKnowledgeContradictionPolicy(payload.policy) || payload.repoId !== payload.policy.repoId
    || payload.policyDigest !== canonicalDigest(payload.policy) || payload.edgeId !== payload.request?.edgeId || payload.winnerId !== payload.request?.winnerId || payload.loserId !== payload.request?.loserId
    || !Number.isSafeInteger(payload.observedSeq) || payload.observedSeq < 0 || payload.observedSeq >= event.seq || payload.observedAt !== store.observationTime(payload.observedSeq)) fail('knowledge contradiction resolution receipt shape is invalid');
  const requestDigest = canonicalDigest({ actor: event.actor, idempotencyKey: event.idempotencyKey, repoId: payload.repoId, observedSeq: payload.observedSeq, policyDigest: payload.policyDigest, request: payload.request });
  if (payload.requestDigest !== requestDigest) fail('knowledge contradiction resolution request binding is invalid');
  let derived; try { derived = store._deriveBoundedContradictionResolution(payload.repoId, payload.observedSeq, payload.policy, payload.request, event.seq); } catch (error) { fail(error.message, error.code === 'causal_contradiction_oversize' ? error.code : 'causal_contradiction_integrity'); }
  if (canonicalDigest(payload.affectedReadEvents) !== canonicalDigest(derived.affectedReadEvents) || payload.projectionDigest !== derived.projectionDigest) fail('knowledge contradiction resolution projection diverged');
  const core = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'receiptDigest'));
  if (!/^[a-f0-9]{64}$/.test(payload.receiptDigest ?? '') || payload.receiptDigest !== canonicalDigest(core) || canonicalBytes(payload) > payload.policy.maxBatchBytes) fail('knowledge contradiction resolution receipt is invalid or oversized');
  return derived;
}

export function reverifyKnowledgeContradictionResolution(store, repoId, observedSeq, policy, actor, eventSeq, rawRequest) {
  if (!validKnowledgeContradictionPolicy(policy) || policy.repoId !== repoId || !promotionActor(actor) || !Number.isSafeInteger(eventSeq)) throw new CoordinationRefusal('knowledge contradiction reverify request is invalid', 'causal_contradiction_invalid');
  const event = store._events[eventSeq - 1]; const request = store._contradictionResolutionRequest(rawRequest, policy); const policyDigest = canonicalDigest(policy); const requestDigest = event ? canonicalDigest({ actor, idempotencyKey: event.idempotencyKey, repoId, observedSeq, policyDigest, request }) : null;
  if (!event || event.kind !== 'knowledge.contradiction_resolved' || event.payload?.schemaVersion !== 2 || event.actor !== actor || event.payload.repoId !== repoId || event.payload.observedSeq !== observedSeq || event.payload.policyDigest !== policyDigest || event.payload.requestDigest !== requestDigest || canonicalDigest(event.payload.request) !== canonicalDigest(request)) throw new CoordinationRefusal('knowledge contradiction resolution receipt does not match authority', 'causal_contradiction_conflict');
  store._validateBoundedContradictionResolutionPayload(event.payload, event, false); return freeze({ event: clone(event), projection: store._boundedContradictionResolutionProjection(event.payload, event), replayed: true });
}

export function _validateContradictionResolution(store, fields, integrity = false, actor = null) {
  const expected = ['edgeId', 'expectedEdgeValidityVersion', 'expectedLoserValidityVersion', 'expectedWinnerValidityVersion', 'loserId', 'reason', 'requestDigest', 'winnerId'];
  const request = Object.fromEntries(Object.entries(fields ?? {}).filter(([key]) => key !== 'requestDigest'));
  if (!fields || Object.keys(fields).sort().join(',') !== expected.sort().join(',') || fields.requestDigest !== canonicalDigest(request) || !boundedText(fields.reason, 8_192) || (actor !== null && actor !== 'orchestrator' && !(typeof actor === 'string' && actor.startsWith('operator:')))) store._knowledgeFailure('knowledge contradiction resolution is invalid', 'invalid_contradiction_resolution', integrity);
  const edge = store._knowledgeEdges.get(fields.edgeId); const winner = store._knowledgeNodes.get(fields.winnerId); const loser = store._knowledgeNodes.get(fields.loserId);
  if (!edge || edge.type !== 'Contradicts' || edge.validTo || edge.resolvedBy || !winner || !loser || winner.validTo || loser.validTo || new Set([fields.winnerId, fields.loserId]).size !== 2 || ![edge.from, edge.to].includes(fields.winnerId) || ![edge.from, edge.to].includes(fields.loserId)) store._knowledgeFailure('knowledge contradiction is already resolved or mismatched', 'contradiction_resolved', integrity);
  if (edge.validityVersion !== fields.expectedEdgeValidityVersion || winner.validityVersion !== fields.expectedWinnerValidityVersion || loser.validityVersion !== fields.expectedLoserValidityVersion) store._knowledgeFailure('stale validity version', 'stale_version', integrity);
}

export function _validateKnowledgeInvalidation(store, fields, event, integrity = false) {
  const expected = ['expectedValidityVersion', 'nodeId', 'reason', 'requestDigest']; const core = Object.fromEntries(Object.entries(fields ?? {}).filter(([key]) => key !== 'requestDigest'));
  const target = store._knowledgeNodes.get(fields?.nodeId);
  if (!fields || Object.keys(fields).sort().join(',') !== expected.sort().join(',') || fields.requestDigest !== canonicalDigest(core) || !boundedText(fields.reason, 8_192)) store._knowledgeFailure('knowledge invalidation is malformed', 'invalid_invalidation', integrity);
  if (!target || target.validTo || target.validityVersion !== fields.expectedValidityVersion) store._knowledgeFailure('knowledge invalidation is stale', 'stale_version', integrity);
  if ([...store._knowledgeEdges.values()].some((edge) => edge.type === 'Contradicts' && !edge.resolvedBy && !edge.validTo && [edge.from, edge.to].includes(fields.nodeId))) store._knowledgeFailure('knowledge endpoint has an unresolved contradiction', 'unresolved_contradiction', integrity);
  if (!Number.isSafeInteger(event.seq) || !Number.isFinite(Date.parse(event.ts))) store._knowledgeFailure('knowledge invalidation event time is invalid', 'invalid_invalidation', integrity);
}

export function _validateContaminationRecord(store, fields, event, integrity = false) {
  const expected = ['affectedReadEvents', 'invalidationEvent', 'nodeId'];
  const source = store._events[fields?.invalidationEvent - 1]; let nodeId = null;
  if (source?.kind === 'knowledge.edge_added' && source.payload?.type === 'Supersedes') nodeId = source.payload.to;
  else if (source?.kind === 'knowledge.contradiction_resolved') nodeId = source.payload.loserId;
  else if (source?.kind === 'knowledge.invalidated') nodeId = source.payload.nodeId;
  const reads = store._knowledgeReads.filter((read) => read.eventSeq < (source?.seq ?? 0) && read.nodeIds.includes(fields?.nodeId)).map((read) => read.eventSeq);
  if (!fields || Object.keys(fields).sort().join(',') !== expected.sort().join(',') || typeof fields.nodeId !== 'string' || source?.seq + 1 !== event.seq || source?.actor !== event.actor || event.idempotencyKey !== `${source?.idempotencyKey}:contamination` || nodeId !== fields.nodeId
    || !Array.isArray(fields.affectedReadEvents) || new Set(fields.affectedReadEvents).size !== fields.affectedReadEvents.length || canonicalDigest(fields.affectedReadEvents) !== canonicalDigest(reads)) store._knowledgeFailure('knowledge contamination record is invalid', 'contamination_integrity', integrity);
}

export function _validateKnowledgeRecallPayload(store, payload, event, integrity = false) {
  const fail = (message, code = 'knowledge_recall_integrity') => store._knowledgeFailure(message, code, integrity);
  const fields = ['schemaVersion', 'readerActor', 'readerWorker', 'taskId', 'runId', 'query', 'policy', 'policyDigest', 'observedSeq', 'observedAt', 'asOf', 'nodeIds', 'validityVersions', 'scores', 'contradictionEdgeIds', 'requestDigest', 'resultProjectionDigest', 'receiptDigest'];
  if (!payload || Object.keys(payload).sort().join(',') !== fields.sort().join(',') || payload.schemaVersion !== 1 || payload.readerActor !== event.actor || !validKnowledgeRecallPolicy(payload.policy)
    || payload.policyDigest !== canonicalDigest(payload.policy) || !/^[a-f0-9]{64}$/.test(payload.requestDigest ?? '') || !/^[a-f0-9]{64}$/.test(payload.resultProjectionDigest ?? '')
    || payload.observedSeq !== payload.query?.observedSeq || payload.asOf !== payload.query?.asOf || payload.observedAt !== store.observationTime(payload.observedSeq)) fail('knowledge recall receipt shape is invalid');
  const core = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'receiptDigest'));
  if (!/^[a-f0-9]{64}$/.test(payload.receiptDigest ?? '') || payload.receiptDigest !== canonicalDigest(core) || canonicalBytes(payload) > payload.policy.maxReceiptBytes) fail('knowledge recall receipt binding is invalid');
  const expectedRequestDigest = canonicalDigest({ query: payload.query, reader: { readerActor: payload.readerActor, taskId: payload.taskId ?? null, runId: payload.runId ?? null }, policyDigest: payload.policyDigest });
  if (payload.requestDigest !== expectedRequestDigest) fail('knowledge recall request identity is invalid');
  const taskId = payload.taskId ?? null; const runId = payload.runId ?? null; const task = taskId === null ? null : store._tasks.get(taskId);
  const readerWorkerAtReceipt = task?.claimedEvent && task.claimedEvent < event.seq ? task.assignee : null;
  if ((taskId !== null && (!task || payload.readerWorker !== readerWorkerAtReceipt || runId !== null))
    || (runId !== null && (!store._runs.has(runId) || !store._knowledgeNodes.has(`run:${runId}`) || taskId !== null || payload.readerWorker !== null))
    || (taskId === null && runId === null && payload.readerWorker !== null)) fail('knowledge recall reader projection is invalid');
  let projection; try { projection = store._buildKnowledgeRecall(payload.query, payload.policy); } catch (error) { if (integrity) throw new CoordinationIntegrityError('knowledge recall projection cannot be rebuilt', 'knowledge_recall_integrity'); throw error; }
  const expectedScores = projection.nodes.map((node) => ({ id: node.id, score: node.score, reasonDigest: node.reasonDigest }));
  if (canonicalDigest(payload.nodeIds) !== canonicalDigest(projection.nodes.map((node) => node.id))
    || canonicalDigest(payload.validityVersions) !== canonicalDigest(Object.fromEntries(projection.nodes.map((node) => [node.id, node.validityVersion])))
    || canonicalDigest(payload.scores) !== canonicalDigest(expectedScores) || canonicalDigest(payload.contradictionEdgeIds) !== canonicalDigest(projection.contradictions.map((edge) => edge.edgeId))
    || payload.resultProjectionDigest !== projection.projectionDigest) fail('knowledge recall ranked projection diverged');
  return projection;
}

export function _validateKnowledgeRecallAssessmentPayload(store, payload, event, integrity = false) {
  const fail = (message, code = 'knowledge_recall_assessment_integrity') => store._knowledgeFailure(message, code, integrity);
  const fields = ['schemaVersion', 'repoId', 'observedSeq', 'observedAt', 'policy', 'policyDigest', 'requestDigest', 'assessments', 'causationClaimed', 'projectionDigest', 'receiptDigest'];
  if (!payload || Object.keys(payload).sort().join(',') !== fields.sort().join(',') || payload.schemaVersion !== 1 || !validKnowledgeRecallAssessmentPolicy(payload.policy) || payload.repoId !== payload.policy.repoId || payload.policyDigest !== canonicalDigest(payload.policy)
    || payload.observedAt !== store.observationTime(payload.observedSeq) || payload.causationClaimed !== false || !Array.isArray(payload.assessments) || payload.assessments.length === 0) fail('knowledge recall assessment batch shape is invalid');
  let rebuilt; try { rebuilt = store._buildKnowledgeRecallAssessment(payload.repoId, payload.observedSeq, payload.policy, event.actor, event.seq); } catch { fail('knowledge recall assessment batch cannot be rebuilt'); }
  const projection = { schemaVersion: 1, repoId: payload.repoId, observedSeq: payload.observedSeq, observedAt: payload.observedAt, policyDigest: payload.policyDigest, requestDigest: payload.requestDigest, assessments: payload.assessments, causationClaimed: false };
  if (payload.requestDigest !== rebuilt.requestDigest || payload.projectionDigest !== canonicalDigest(projection) || canonicalDigest(payload.assessments) !== canonicalDigest(rebuilt.assessments)) fail('knowledge recall assessment batch diverged');
  for (const row of payload.assessments) {
    const { assessmentDigest, ...core } = row ?? {}; if (!/^[a-f0-9]{64}$/.test(assessmentDigest ?? '') || assessmentDigest !== canonicalDigest(core)) fail('knowledge recall assessment row binding is invalid');
  }
  const { receiptDigest, ...receiptCore } = payload;
  if (!/^[a-f0-9]{64}$/.test(receiptDigest ?? '') || receiptDigest !== canonicalDigest(receiptCore) || canonicalBytes(payload) > payload.policy.maxBatchBytes) fail('knowledge recall assessment batch binding is invalid');
  return freeze({ ...clone(rebuilt), eventSeq: event.seq, receiptDigest: payload.receiptDigest });
}
