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
import { ARTIFACT_LIFECYCLE_FIELDS, KNOWLEDGE_EDGE_TYPES, KNOWLEDGE_GROUNDINGS, KNOWLEDGE_NODE_TYPES, assertWaveStartedRoster, providerAttemptDelay, resourceOverlap, validEnvRef, validKnowledgePromotionPolicy, validKnowledgeRecallAssessmentPolicy, validKnowledgeRecallPolicy, validKnowledgeScratchCorrectionPolicy } from './coordination-ledger.mjs';
import { buildWorkflowRoleCatalog, normalizeWorkflowDefinition, validateWorkflowDefinitionLegacy, validateWorkflowDefinitionV3, workflowAttemptRoute, workflowCatalogRole } from './workflow-definition.mjs';
import { CANONICAL_ORDER_VERSION, canonicalJson, compareCanonicalStrings, normalizeCanonicalOrderPolicy } from './canonical-order.mjs';
import { CoordinationIntegrityError, CoordinationRefusal, KNOWLEDGE_CANDIDATE_TRIGGERS, TERMINAL, boundedText, canonical, canonicalBytes, canonicalDigest, clone, digest, freeze, promotionActor, sha256Bytes, validKnowledgeContradictionPolicy, validRunId } from './coordination-internals.mjs';
import { RUN_ORCHESTRATOR_CAPABILITIES, RUN_ORCHESTRATOR_REVOCATION_REASONS } from './run-lineage.mjs';
import { FRAME_LIMITS } from './limits.mjs';
import { GoalPlanValidationError, goalPlanDigest, normalizePlanRequest, planRouteMatches } from './goal-plan.mjs';
import { inferTaskTopologyRelation } from './task-topology.mjs';
import { LEGACY_WORKFLOW_POLICY } from './workflow-policy.mjs';
import { parseRouteTupleKey } from './route-tuple.mjs';
import { pathInScopes } from './path-scope.mjs';
import { usdFromNanos, usdToNanos } from './usd.mjs';
import { validProcessClosedPayload, validProcessStartedPayload, validRecoveryProcessAbsentPayload, validRecoveryProcessReapedPayload } from './process-lifecycle.mjs';

// ── relocated primitives ─────────────────────────────────────────────────────────────────────────





const SCRATCH_CORRECTION_ADMIN_EVENTS = new Set(['evidence.mapped', 'web.command_admitted', 'mcp.call_admitted']);

const CONTRADICTION_ADMIN_EVENTS = new Set(['evidence.mapped', 'web.command_admitted', 'mcp.call_admitted']);

const PROMOTION_DECISION_KINDS = new Set(['control.stop_requested', 'follow_up.requested']);

const PROMOTION_FAILURE_KINDS = new Set(['recovery.claimed_without_spawn']);

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

function validResultSha(value) { return typeof value === 'string' && /^[a-f0-9]{40,64}$/u.test(value); }

export function retainedResultRef(sha) { return `refs/baton/results/${sha}`; }

function officialCoordinateMatches(identity, coordinate) { const fields = Object.keys(identity ?? {}).sort().join(','); return ['ecosystem,package,version', 'ecosystem,package,system,version'].includes(fields) && identity.ecosystem === coordinate?.ecosystem && identity.package === coordinate?.package && identity.version === coordinate?.version && (!Object.hasOwn(identity, 'system') || (coordinate.ecosystem === 'npm' && identity.system === 'NPM')); }

// BU-2-3: the scratch-read web frame. A fact whose body references a web_fetch artifact
// handle (art:sha256:<digest>) is framed UNTRUSTED_WEB_CONTENT at read time — a read-side
// projection (the family's existing posture); the durable fact is never rewritten. Facts
// without the handle pass through byte-identical so the projection is scoped to web-sourced
// bodies only.

// REPL-2/REPL-3 (docs/reference/evidence/repl-kg-wave-2026-07-22/repl23-decisions.md, issues
// #22/#23). Binding identity/fences/history/citations are (runId, scope, name)-tupled via
// JSON-encoded map keys — never string concatenation (Part A rule 2).
const REPL_CELL_ID = /^cell:[a-f0-9]{64}$/u;

// The citation grammar lives in coordination-internals.mjs (declared ONCE, read by both this
// admission path and the coordinator's serving-path addressing check).

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
  if (receipt.receiptDigest !== sha256Bytes(Buffer.from(JSON.stringify(canonicalJson(core)), 'utf8'))) {
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
  if (!['borrow', 'build'].includes(p.choice)) fail('reuse decision choice/need/rationale is invalid', 'invalid_reuse_decision');
  if (typeof p.need !== 'string' || p.need.trim().length === 0 || p.need.includes('\0')) fail('reuse decision choice/need/rationale is invalid', 'invalid_reuse_decision');
  if (typeof p.rationale !== 'string' || p.rationale.trim().length === 0 || p.rationale.includes('\0')) fail('reuse decision choice/need/rationale is invalid', 'invalid_reuse_decision');
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
  // again on every replay and refused a drain the ledger had already accepted. A drain's target set
  // is NOT a projection of this ledger — it is the local controller's live fleet, and phase56's DC6
  // admits two targets onto an empty store — so no bound can be derived from the ledger here.
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
    || (p.operation === 'send' && (!boundedText(p.message)
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

/** Issue #560: whether a RECORDED stop admission carries the run-lineage scope — the three fields
 * (`scope`, `throughSeq`, `targetRunIds`) a policy-carrying writer adds. The fold reads the scope
 * from the row itself (see `_validateRunStopAdmission`), so the read-only probes that assemble a
 * store with no policies fold such a row from its own bytes. */
function recordedRunStopScope(p) {
  return typeof p === 'object' && p !== null
    && Object.hasOwn(p, 'scope') && Object.hasOwn(p, 'throughSeq') && Object.hasOwn(p, 'targetRunIds');
}

export function _validateRunStopAdmission(store, p, event, integrity = false) {
  const fail = (message, code = 'run_stop_integrity') => {
    throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code);
  };
  const version = p?.schemaVersion;
  // Issue #560: which field set this admission is judged against. LIVE admission answers to the
  // configured policy, its authority. The FOLD (integrity) reads the scope from the row it folds:
  // a recorded row replays from its own bytes (#325/#504), so a store assembled without the
  // deployment's policies folds a lineage-scoped stop exactly as it was recorded, instead of
  // reporting `run_stop_integrity` and having the doctor propose a quarantine it cannot justify.
  const scoped = integrity ? recordedRunStopScope(p) : store._runLineagePolicy !== null;
  const fields = scoped
    ? ['schemaVersion', 'scope', 'repoId', 'runId', 'reasonDigest', 'requestDigest', 'throughSeq', 'targetRunIds', 'targetTaskIds', 'targetWorkerIds', 'targetDigest']
    : ['schemaVersion', 'repoId', 'runId', 'reasonDigest', 'requestDigest', 'targetTaskIds', 'targetWorkerIds', 'targetDigest'];
  if (!p || Object.keys(p).sort().join(',') !== fields.sort().join(',') || version !== 1
    || !validRunId(p.repoId) || !validRunId(p.runId) || !/^[a-f0-9]{64}$/.test(p.reasonDigest ?? '')
    || !/^[a-f0-9]{64}$/.test(p.requestDigest ?? '') || !/^[a-f0-9]{64}$/.test(p.targetDigest ?? '')
    || !Array.isArray(p.targetTaskIds) || !Array.isArray(p.targetWorkerIds)
    || p.targetTaskIds.some((id) => !boundedText(id, 4_096)) || p.targetWorkerIds.some((id) => !validRunId(id))
    || (scoped && (p.scope !== 'run_subtree'
      || !Number.isSafeInteger(p.throughSeq) || p.throughSeq !== event.seq - 1
      || !Array.isArray(p.targetRunIds) || p.targetRunIds.length === 0 || p.targetRunIds.length > 1_000_000
      || p.targetRunIds.some((id) => !validRunId(id))))) {
    fail('run stop admission is invalid');
  }
  // #366: the ONE target-set ceiling, and it is ADMISSION-only — the fold (integrity) applies
  // none, because a recorded row is never re-judged for size on replay (see
  // assertTargetSetAdmissible, which reads the ONE registry row and names field/count/bound).
  if (!integrity) {
    assertTargetSetAdmissible('targetTaskIds', p.targetTaskIds.length, store._events.length);
    assertTargetSetAdmissible('targetWorkerIds', p.targetWorkerIds.length, store._events.length);
  }
  const digestCore = scoped ? {
    throughSeq: p.throughSeq, targetRunIds: p.targetRunIds,
    targetTaskIds: p.targetTaskIds, targetWorkerIds: p.targetWorkerIds,
  } : {
    targetTaskIds: p.targetTaskIds, targetWorkerIds: p.targetWorkerIds,
  };
  if (new Set(p.targetTaskIds).size !== p.targetTaskIds.length || new Set(p.targetWorkerIds).size !== p.targetWorkerIds.length
    || JSON.stringify([...p.targetTaskIds].sort(compareCanonicalStrings)) !== JSON.stringify(p.targetTaskIds)
    || JSON.stringify([...p.targetWorkerIds].sort(compareCanonicalStrings)) !== JSON.stringify(p.targetWorkerIds)
    || p.requestDigest !== canonicalDigest({ repoId: p.repoId, runId: p.runId, reasonDigest: p.reasonDigest })
    || (scoped
      ? (new Set(p.targetRunIds).size !== p.targetRunIds.length
        || JSON.stringify([...p.targetRunIds].sort(compareCanonicalStrings)) !== JSON.stringify(p.targetRunIds)
        || p.targetDigest !== canonicalDigest(digestCore))
      : p.targetDigest !== canonicalDigest(digestCore))) {
    fail('run stop admission binding is invalid');
  }
  if (event.idempotencyKey !== `run.stop:${p.runId}` || !boundedText(event.actor, 256)) fail('run stop authority is invalid');
  const targets = store._runStopTargets(
    p.runId, scoped ? p.throughSeq : undefined, scoped,
  );
  const observed = scoped ? {
    scope: p.scope, throughSeq: p.throughSeq, targetRunIds: p.targetRunIds,
    targetTaskIds: p.targetTaskIds, targetWorkerIds: p.targetWorkerIds, targetDigest: p.targetDigest,
  } : {
    targetTaskIds: p.targetTaskIds, targetWorkerIds: p.targetWorkerIds,
    targetDigest: p.targetDigest,
  };
  if (canonicalDigest(targets) !== canonicalDigest(observed)) fail('run stop target snapshot diverged');
  return targets;
}

export function _validateRunStopCompletion(store, p, event, integrity = false) {
  const fail = (message) => {
    throw integrity ? new CoordinationIntegrityError(message, 'run_stop_integrity') : new CoordinationRefusal(message, 'run_stop_integrity');
  };
  if (!p || Object.keys(p).sort().join(',') !== ['receipt', 'runId', 'schemaVersion'].join(',')
    || p.schemaVersion !== 1 || !validRunId(p.runId)) fail('run stop completion is invalid');
  const stop = store._runStops.get(p.runId);
  if (!stop || stop.status !== 'stopping' || stop.receipt !== null) fail('run stop completion has no open admission');
  if (p.schemaVersion !== stop.schemaVersion) fail('run stop completion version differs from admission');
  if (event.idempotencyKey !== `run.stop.complete:${p.runId}` || event.actor !== stop.actor) fail('run stop completion authority is invalid');
  const receipt = p.receipt;
  const receiptFields = ['schemaVersion', 'state', 'scope', 'repoId', 'runId', 'targetCount', 'remainingCount', 'targetDigest', 'counts', 'checks', 'effects', 'receiptDigest'];
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
  const { receiptDigest, ...core } = receipt;
  if (receiptDigest !== canonicalDigest(core)) fail('run stop receipt digest is invalid');
  return stop;
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












































/** R11/F5 — the per-member fan-out admission. A #94-style dynamic wave's members carry DISTINCT
 * runIds, and a binding is keyed `(runId, scope, name)`, so one `shared` admission renders only
 * into the members of that one run. The workflow tier is realized by replicating the source
 * admission into EACH member's own runId at spawn: every member gets its own `shared` manifest
 * (whose repl coordinate names the member run) and the `shared:<name>` binding over the same
 * settled cell. Every member then resolves the same citation grammar in ITS OWN run, so no
 * cross-run resolution is ever needed (D3's boundary stays intact) and an unlisted run resolves
 * nothing.
 *
 * Authority is the SOURCE admission itself: the caller must be the principal that admitted it and
 * the source must be a `shared` manifest. The replication copies that principal verbatim, so a
 * fan-out cannot name an authority it does not already hold, and every member event is attributed
 * to the orchestrator that authored the object. */










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
    || [...store._tasks.values()].some((task) => task.runId === fields.runId);
  if (!known) throw new CoordinationRefusal(`unknown run ${fields.runId}`, 'not_found');
  const targets = store._runStopTargets(fields.runId);
  const schemaVersion = 1;
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
    || !['candidates', 'candidatesAwaitingAdmission', 'settlementRunId']
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
  
  const candidateBytes = candidates.reduce((sum, candidate) => sum + canonicalBytes({ candidate, nodes: nodes.filter((node) => node.id === candidate.nodeId || node.sourceSeq === candidate.sourceSeq), edges: edges.filter((edge) => edge.from === candidate.nodeId) }), 0);
  const evidenceRefs = [...nodes, ...edges].reduce((sum, row) => sum + (row.evidence?.length ?? 0), 0);
  
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
  if (payload.receiptDigest !== canonicalDigest(core)) fail('knowledge promotion receipt is invalid', 'causal_promotion_integrity');
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
  const evidenceRefs = [...nodes, ...edges].reduce((sum, row) => sum + (row.evidence?.length ?? 0), 0); 
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
  const core = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'receiptDigest')); if (payload.receiptDigest !== canonicalDigest(core)) fail('Scratch correction receipt is invalid'); return derived;
}

export function reverifyScratchCorrection(store, repoId, observedSeq, policy, actor, eventSeq, request) {
  if (!validKnowledgeScratchCorrectionPolicy(policy) || policy.repoId !== repoId || !promotionActor(actor) || !Number.isSafeInteger(eventSeq)) throw new CoordinationRefusal('Scratch correction reverify request is invalid', 'causal_correction_invalid'); const event = store._events[eventSeq - 1];
  const normalized = store._scratchCorrectionRequest(request); const policyDigest = canonicalDigest(policy); const requestDigest = event ? canonicalDigest({ actor, idempotencyKey: event.idempotencyKey, repoId, observedSeq, policyDigest, request: normalized }) : null;
  if (!event || event.kind !== 'knowledge.scratch_corrected' || event.actor !== actor || event.payload?.repoId !== repoId || event.payload?.observedSeq !== observedSeq || event.payload?.policyDigest !== policyDigest || event.payload?.requestDigest !== requestDigest || canonicalDigest(event.payload?.request) !== canonicalDigest(normalized)) throw new CoordinationRefusal('Scratch correction receipt does not match authority', 'causal_correction_conflict'); store._validateScratchCorrectionPayload(event.payload, event, false); return freeze({ event: clone(event), projection: store._scratchCorrectionProjection(event.payload, event), replayed: true });
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
  
  if (store._events.slice(observedSeq, Math.max(observedSeq, beforeEventSeq - 1)).some((event) => !CONTRADICTION_ADMIN_EVENTS.has(event.kind))) throw new CoordinationRefusal('knowledge contradiction resolution boundary became stale', 'causal_contradiction_conflict');
  const request = store._contradictionResolutionRequest(rawRequest, policy); const nodes = store.queryKnowledge({ observedSeq }); const edges = store.queryKnowledgeEdges({ observedSeq });
  
  const nodeMap = new Map(nodes.map((node) => [node.id, node])); const edge = edges.find((row) => row.id === request.edgeId); const winner = nodeMap.get(request.winnerId); const loser = nodeMap.get(request.loserId);
  const preAppendNodes = new Map(store.queryKnowledge({ observedSeq: beforeEventSeq - 1 }).map((node) => [node.id, node])); const preAppendEdges = new Map(store.queryKnowledgeEdges({ observedSeq: beforeEventSeq - 1 }).map((row) => [row.id, row]));
  const currentEdge = preAppendEdges.get(request.edgeId); const currentWinner = preAppendNodes.get(request.winnerId); const currentLoser = preAppendNodes.get(request.loserId);
  if (!edge || edge.type !== 'Contradicts' || edge.validTo || edge.resolvedBy || !winner || !loser || winner.validTo || loser.validTo || ![edge.from, edge.to].includes(winner.id) || ![edge.from, edge.to].includes(loser.id)
    || !currentEdge || currentEdge.validTo || currentEdge.resolvedBy || !currentWinner || currentWinner.validTo || !currentLoser || currentLoser.validTo
    || canonicalDigest(edge) !== canonicalDigest(currentEdge) || canonicalDigest(winner) !== canonicalDigest(currentWinner) || canonicalDigest(loser) !== canonicalDigest(currentLoser)) throw new CoordinationRefusal('knowledge contradiction is stale, resolved, or mismatched', 'causal_contradiction_conflict');
  if (edge.validityVersion !== request.expectedEdgeValidityVersion || winner.validityVersion !== request.expectedWinnerValidityVersion || loser.validityVersion !== request.expectedLoserValidityVersion) throw new CoordinationRefusal('knowledge contradiction versions are stale', 'causal_contradiction_conflict');
  const affectedReadEvents = store._knowledgeReads.filter((read) => read.eventSeq <= observedSeq && read.nodeIds.includes(loser.id)).map((read) => read.eventSeq); const evidenceRefs = (edge.evidence ?? []).length + (winner.evidence ?? []).length + (loser.evidence ?? []).length;
  
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
  if (!/^[a-f0-9]{64}$/.test(payload.receiptDigest ?? '') || payload.receiptDigest !== canonicalDigest(core)) fail('knowledge contradiction resolution receipt is invalid');
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
  if (!/^[a-f0-9]{64}$/.test(payload.receiptDigest ?? '') || payload.receiptDigest !== canonicalDigest(core)) fail('knowledge recall receipt binding is invalid');
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
  if (!/^[a-f0-9]{64}$/.test(receiptDigest ?? '') || receiptDigest !== canonicalDigest(receiptCore)) fail('knowledge recall assessment batch binding is invalid');
  return freeze({ ...clone(rebuilt), eventSeq: event.seq, receiptDigest: payload.receiptDigest });
}
