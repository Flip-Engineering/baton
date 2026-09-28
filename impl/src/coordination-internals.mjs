// coordination-internals.mjs — issue #259, slice 1 (slice 2 added the last five members the store held):
// the CoordinationStore members that touch no runtime authority — payload keys, digests, segment paths,
// pure projections and predicates — plus the primitives they need (canonicalization, hashing, cloning,
// key derivation).
//
// Every function is a plain export, never a method: the state it reads is its first parameter, passed
// explicitly — `state` for the one collection the helper projects (or that collection's own name, where
// a local would shadow `state`), `store` when the body reads several of them or calls back into the
// store. The helper that reads no state takes no state parameter. Nothing here imports
// coordination-store.mjs — the store imports this module, so the layering stays acyclic.
//
// Moved verbatim from coordination-store.mjs: no behavior change, no renamed member, no changed durable
// format. The store keeps the same method names as one-line delegates, so every call site is untouched.
// Slice 2 relocated the five surface members two pinned source scans had exempted by file, which is why
// this module is a seam-map target: a moved member stays mapped, by name, in its new home.

import { compareCanonicalStrings } from './canonical-order.mjs';
import { goalPlanPage } from './goal-plan.mjs';
import { FRAME_LIMITS } from './limits.mjs';
import { readSwarm, swarmSnapshot } from './swarm-state.mjs';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── relocated primitives ─────────────────────────────────────────────────────────────────────────


export class CoordinationIntegrityError extends Error {
  constructor(message, code = 'coordination_integrity') { super(message); this.name = 'CoordinationIntegrityError'; this.code = code; }
}

export class CoordinationRefusal extends Error {
  // Issue #405: the declared detail travels on the class — the ONE canonical way a refusal
  // carries it; the neighbouring quarantine refusals' Object.assign overwrites this same
  // property, so both paths surface one `detail` shape.
  constructor(message, code, detail = null) { super(message); this.name = 'CoordinationRefusal'; this.code = code; this.detail = detail; }
}


// Issue #530: the contradiction policy carried the same caller-declared size and count ceilings as
// its five siblings; they are gone with every read of them. The identity is what a policy names.
export const KNOWLEDGE_CONTRADICTION_POLICY_FIELDS = ['repoId'];

export const KNOWLEDGE_PROJECTION_FIELDS = new Set(['contentDigest', 'observedSeq', 'observedAt', 'eventTimeSeq', 'eventTime', 'validityVersion', 'invalidatedBy', 'acceptanceInvalidation', 'derivedFromEvent', 'resolvedBy', 'winnerId', 'loserId', 'resolutionReason']);

export const MAD_METRIC = /(?<sign>[+-])?(?<number>\d+(?:\.\d+)?)\s*(?<unit>tok\/s|tokens?\/s|ms|us|ns|sec|seconds?|min|minutes?|GB|MB|KB|TFLOPS|GFLOPS|tokens?|%|x)/gu;

export const MAD_UNIT_CANON = new Map([
  ['tok/s', 'tok/s'], ['tokens/s', 'tok/s'], ['token/s', 'tok/s'],
  ['token', 'token'], ['tokens', 'token'],
  ['sec', 's'], ['second', 's'], ['seconds', 's'],
  ['min', 'min'], ['minute', 'min'], ['minutes', 'min'],
]);


/** Issue #465(4): the projection families the checkpoint CARRIES. `_events` (every parsed ledger
 * row) and `_byKey` (the same row objects indexed by idempotency key) are deliberately NOT among
 * them: the ledger file is their durable copy, replay reads it anyway, and carrying them made the
 * body a second copy of the event log — measured live at 193 MB + 195 MB on a 207 MB projection,
 * which is why every stop on a real ledger skipped its write as `release_checkpoint_unbounded`
 * (see PROJECTION_LEDGER_FIELDS). The successor rebuilds the two from the ledger at open and folds
 * only the rows past `coversSeq` (`coordination-replay.mjs` `_loadRun`).
 *
 * `_steeringRuns` is carried here because it is fold output the ledger copy cannot hand back: with
 * the events no longer cached, every family the restore installs must be one the body carries. */
export const PROJECTION_CHECKPOINT_FIELDS = Object.freeze([
  '_tasks', '_runs', '_artifacts',
  '_reuseDecisions', '_reuseSubjects', '_reuseRiskGuards', '_reusePolicyHeads',
  '_reusePolicyTransitions', '_routeObservations', '_representations',
  '_representationRequests', '_goals', '_goalHeads', '_plans', '_planHeads',
  '_planApprovals', '_planDispatches', '_planTaskLinks', '_planBudgetSettlements',
  '_reuseProviderContributions', '_reuseProviderCoordinateContributions',
  '_reuseProviderGuards', '_evidence', '_scratchFacts', '_scratchClaims', '_scratchReads',
  '_knowledgeNodes', '_knowledgeEdges', '_knowledgeNodeHistory', '_knowledgeEdgeHistory',
  '_knowledgeReads', '_knowledgeRecallAssessments', '_contamination', '_webCommands',
  '_webCommandScopes', '_mcpCalls', '_mcpCallScopes', '_fleetDrains', '_runStops',
  '_runStopByTarget',
  '_runVerificationRetries', '_runOrchestratorLeases', '_runLineages',
  '_runLineageEventSeqs', '_runChildrenByParent', '_recoveryDispatches',
  '_taskTopologies', '_recoveryAttemptsById', '_recoveryAttemptHeads',
  '_providerReceipts', '_providerDeliveryIds', '_providerProcessing', '_providerPending',
  '_providerSequences', '_providerSourceHealth',
  '_taskResourceReleases',
  // Epic #78: the per-worker generation records a replacement generation corrects (last write wins).
  '_workerGenerations',
  // Decision 4: digest-addressed spill artifacts (mint/materialize; durable, replay-derived).
  '_spills',
  // D9 (epic #103): replay-derived wave.closed campaign-state records by waveId.
  '_waveClosures',
  // D2.3 (epic #132): replay-derived wave.started registry rows by waveId.
  '_waveRegistry',
  // #286 G-31: the CURRENT run -> wave binding (last write wins), folded from `steering.registered`.
  // It answers "which wave does this run sit in NOW" — the one reading `_waveIdOf`/`_waveRoleOf` share.
  '_waveBindings',
  '_swarms',
  // Issue #33: task-ephemeral scratchpad entries, scope indexes/fences, live elevation
  // commitments, and bounded prose-free reap receipts are one ledger projection.
  '_scratchpadEntries', '_scratchpadEntriesByScope', '_scratchpadFences',
  '_scratchpadElevations', '_scratchpadReaps',
  // KG-1 (Part A rule 5): gains _projectionInputFence, a plain replay-derived counter.
  '_projectionInputFence',
  // Issue #465(4): the runs a `steering.registered` row folded — read by run/wave admission, and
  // fold state the ledger copy PROJECTION_LEDGER_FIELDS names cannot hand back.
  '_steeringRuns',
]);

/** Issue #465(4): the projection's two LEDGER-copy families — every parsed ledger row, and those
 * same row objects indexed by idempotency key. They are projection state, but the durable copy of
 * them is the ledger file itself: the checkpoint carries NEITHER (they are absent from
 * PROJECTION_CHECKPOINT_FIELDS) and records the `coversSeq` it is entitled to instead, so a
 * successor rebuilds both by reading the ledger `_loadRun` shares with the cold replay path and
 * folds only the rows past that seq. Measured live (2026-09-18): these two were 193 MB and 195 MB
 * of a 207 MB body, the same rows counted twice. */
export const PROJECTION_LEDGER_FIELDS = Object.freeze(['_events', '_byKey']);

export const SCRATCHPAD_SCOPE = /^(?:shared|worker:[A-Za-z0-9._:-]{1,256})$/u;

export const SEGMENT_FILE_SUFFIX = '.jsonl';

export const SEGMENT_INDEX_FILE = 'index.json';

/** #286 G-41: the scratchpad partition ceiling DEFAULTS (128 worker / 512 shared) — admission
 * bounds a deployment may raise via scratchpadPartitionPolicy, never replay validation. Moved
 * out of coordination-store.mjs with the constructor that reads them (issue #259 slice 7); the
 * store re-exports them, so every existing import path resolves to the same binding. */
export const MAX_SCRATCHPAD_WORKER_ENTRIES = 128;
export const MAX_SCRATCHPAD_SHARED_ENTRIES = 512;

// Issue #290: the quarantine ledger lives beside events.jsonl and is written only through the
// supported repair verbs — never by editing the authoritative ledger. Each entry names one seq
// whose durable event the fold refused, so replay can skip exactly that fold after a restart.
export const COORDINATION_QUARANTINE_FILE = 'coordination-quarantine.json';
export const COORDINATION_QUARANTINE_TEMP_PREFIX = 'quarantine-temp-';

export const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

export function boundedText(value, maxBytes = Number.MAX_SAFE_INTEGER) { return typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value) <= maxBytes && !value.includes('\0'); }

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

export function canonicalBytes(value) { return Buffer.byteLength(JSON.stringify(canonical(value))); }

export function canonicalDigest(value) { return digest(canonical(value)); }

export function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

export function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

export function eventTime(events, evidence, fallback) {
  const seqs = (evidence ?? []).map((ref) => ref?.coordinationSeq).filter(Number.isInteger);
  const seq = seqs.length > 0 ? Math.min(...seqs) : fallback.seq;
  return { eventTimeSeq: seq, eventTime: events[seq - 1]?.ts ?? fallback.ts };
}

export function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

export function madCanonUnit(unit) { const lower = unit.toLowerCase(); return MAD_UNIT_CANON.get(lower) ?? lower; }

export function madConfidenceOf(body, maxMetrics = 100_000) {
  const text = recallBody(body); const groups = new Map(); let count = 0;
  MAD_METRIC.lastIndex = 0;
  for (let match = MAD_METRIC.exec(text); match !== null; match = MAD_METRIC.exec(text)) {
    if (count >= maxMetrics) break;
    count += 1;
    const value = (match.groups.sign === '-' ? -1 : 1) * Number(match.groups.number);
    if (!Number.isFinite(value)) continue;
    const unit = madCanonUnit(match.groups.unit);
    const rows = groups.get(unit) ?? []; rows.push(value); groups.set(unit, rows);
  }
  let best = null;
  for (const [unit, values] of [...groups.entries()].sort((a, b) => compareCanonicalStrings(a[0], b[0]))) {
    if (values.length < 3) continue;
    const sorted = [...values].sort((a, b) => a - b);
    const median = madMedian(sorted);
    const mad = madMedian(sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b));
    const bestDelta = Math.max(...sorted.map((v) => Math.abs(v - median)));
    const confidence = mad === 0 ? Infinity : bestDelta / mad;
    const label = !Number.isFinite(confidence) ? 'HIGH-INF' : confidence >= 2.0 ? 'HIGH' : confidence >= 1.0 ? 'MODERATE' : 'LOW';
    const candidate = { unit, samples: values.length, confidence, label };
    const better = best === null || candidate.samples > best.samples
      || (candidate.samples === best.samples && (candidate.confidence === Infinity ? best.confidence !== Infinity : (best.confidence !== Infinity && candidate.confidence > best.confidence)));
    if (better) best = candidate;
  }
  if (best === null) return null;
  return { label: best.label, value: best.confidence === Infinity ? null : best.confidence, unit: best.unit, samples: best.samples };
}

export function madMedian(sortedAscending) {
  const n = sortedAscending.length; const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sortedAscending[mid - 1] + sortedAscending[mid]) / 2 : sortedAscending[mid];
}

export function promotionActor(value) { return value === 'orchestrator' || (typeof value === 'string' && value.startsWith('operator:')); }

export function recallBody(value) { return typeof value === 'string' ? value : JSON.stringify(canonical(value ?? '')); }




export function scratchpadScopeKey(runId, scope) { return JSON.stringify([runId, scope]); }

export function sha256Bytes(value) { return createHash('sha256').update(value).digest('hex'); }

export function validKnowledgeContradictionPolicy(policy) {
  return !!policy && Object.keys(policy).sort().join(',') === [...KNOWLEDGE_CONTRADICTION_POLICY_FIELDS].sort().join(',')
    && typeof policy.repoId === 'string' && /^[A-Za-z0-9._:-]{1,256}$/.test(policy.repoId);
}

export function validRunId(value) { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/.test(value); }

export function validUnicodeScalarString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) { const next = value.charCodeAt(index + 1); if (!(next >= 0xDC00 && next <= 0xDFFF)) return false; index += 1; }
    else if (code >= 0xDC00 && code <= 0xDFFF) return false;
  }
  return true;
}

// ── the store's authority-free members ──────────────────────────────────────────────────────────

/** Moved from `CoordinationStore._taskTopologyHint` (issue #259 slice 1). State: the store, passed explicitly. */
export function _taskTopologyHint(store, event) {
  if (event.batch?.kind === 'settlement_task_create_claim') return 'root';
  if (event.batch?.kind === 'recovery_refinement_create_claim'
    || event.batch?.kind === 'goal_plan_recovery_dispatch') return 'recovery';
  if (event.batch?.kind === 'goal_plan_node_dispatch') {
    const dispatch = store._events[event.seq - 2];
    if (dispatch?.kind === 'plan.node_dispatched' && dispatch.payload?.preservedResume) return 'preserved_resume';
    if (dispatch?.kind === 'plan.node_dispatched' && dispatch.payload?.revision) return 'revision';
  }
  return null;
}

/** Moved from `CoordinationStore.repositoryId` (issue #259 slice 1). State: `this._repoId`, passed explicitly. */
export function repositoryId(state) { return state; }

/** Moved from `CoordinationStore._runIdentityHasEffects` (issue #259 slice 1). State: the store, passed explicitly. */
export function _runIdentityHasEffects(store, runId, ignoredSeq = null) {
  if (store._runLineages.has(runId) || store._runs.has(runId) || store._runStopByTarget.has(runId)
    || [...store._tasks.values()].some((task) => task.runId === runId)
    || [...store._goals.values()].some((goal) => goal.runId === runId)
    || [...store._plans.values()].some((plan) => plan.runId === runId)
    || [...store._runVerificationRetries.values()].some((row) => row.runId === runId)
    || [...store._recoveryAttemptsById.values()].some((row) => row.runId === runId)) return true;
  return store._events.some((row) => row.seq !== ignoredSeq && (
    row.payload?.runId === runId || row.payload?.childRunId === runId
    || row.payload?.goal?.runId === runId || row.payload?.plan?.runId === runId
  ));
}

/** Moved from `CoordinationStore.runOrchestratorLease` (issue #259 slice 1). State: `this._runOrchestratorLeases`, passed explicitly. */
export function runOrchestratorLease(state, leaseId) {
  return clone(state.get(leaseId) ?? null);
}

/** Moved from `CoordinationStore.runLineage` (issue #259 slice 1). State: `this._runLineages`, passed explicitly. */
export function runLineage(state, runId) { return clone(state.get(runId) ?? null); }

/** Moved from `CoordinationStore.runChildren` (issue #259 slice 1). State: the store, passed explicitly. */
export function runChildren(store, runId) {
  return [...(store._runChildrenByParent.get(runId) ?? [])]
    .map((childRunId) => clone(store._runLineages.get(childRunId)))
    .filter(Boolean);
}

/** Moved from `CoordinationStore.runDescendants` (issue #259 slice 1). State: `this._runLineages`, passed explicitly. */
export function runDescendants(state, runId) {
  return [...state.values()]
    .filter((lineage) => lineage.ancestors.includes(runId))
    .map(clone);
}

/** Moved from `CoordinationStore.taskTopologyNode` (issue #259 slice 1). State: `this._taskTopologies`, passed explicitly. */
export function taskTopologyNode(state, taskId) {
  const node = state.get(taskId);
  if (!node) return null;
  const children = [...state.values()].filter((candidate) => candidate.parentTaskId === taskId);
  return freeze({
    ...clone(node), childCount: children.length,
    childrenByRelation: Object.fromEntries(
      ['follow_up', 'oracle', 'preserved_resume', 'recovery', 'review', 'revision']
        .map((relation) => [relation, children.filter((child) => child.relation === relation).length]),
    ),
  });
}

/** Moved from `CoordinationStore.taskTopology` (issue #259 slice 1). State: the store, passed explicitly. */
export function taskTopology(store, runId = null) {
  const tasks = [...store._taskTopologies.values()]
    .filter((node) => node.runId === runId)
    .map((node) => taskTopologyNode(store._taskTopologies, node.taskId))
    .sort((left, right) => left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0);
  return freeze({
    schemaVersion: 1, runId,
    policyDigest: store._taskTopologyPolicy ? canonicalDigest(store._taskTopologyPolicy) : null,
    tasks,
  });
}

/** Moved from `CoordinationStore._ttlTarget` (issue #259 slice 1). State: the store, passed explicitly. */
export function _ttlTarget(store, decision) {
  const node = store._knowledgeNodes.get(decision.nodeId); const findingId = `finding:dependency-dossier:${decision.dossierRef.digest}`;
  const finding = store._knowledgeNodes.get(findingId);
  return {
    decisionId: decision.id, nodeId: decision.nodeId, subjectDigest: decision.subjectDigest,
    expectedValidityVersion: node?.validityVersion ?? null, dossierFindingId: finding && !finding.validTo ? findingId : null,
    affectedDecisionReadEvents: store._knowledgeReads.filter((read) => read.nodeIds.includes(decision.nodeId)).map((read) => read.eventSeq),
    affectedFindingReadEvents: finding && !finding.validTo ? store._knowledgeReads.filter((read) => read.nodeIds.includes(findingId)).map((read) => read.eventSeq) : [],
  };
}

/** Moved from `CoordinationStore._providerAdverseCeilings` (issue #259 slice 1). State: `this._reusePolicyTransitions`, passed explicitly. */
export function _providerAdverseCeilings(state, repoId) {
  const transition = [...state].reverse().find((item) => item.repoId === repoId);
  return transition?.ceilings ?? { maxDecisionTargets: 100_000, maxGuardTargets: 100_000, maxAffectedReads: 1_000_000, maxStateRows: 1_000_000, maxEventBytes: 64 * 1024 * 1024 };
}

/** Moved from `CoordinationStore._providerContribution` (issue #259 slice 1). Reads no store state. */
export function _providerContribution(row, processing, policy) {
  const id = `provider-contribution:${canonicalDigest({ repoId: processing.repoId, coordinate: row.coordinate, providerId: processing.providerId, sourceEpoch: processing.sourceEpoch, officialFactDigest: row.snapshot.factDigest })}`;
  return freeze({ id, repoId: processing.repoId, coordinate: clone(row.coordinate), providerId: processing.providerId, sourceEpoch: processing.sourceEpoch, officialFactDigest: row.snapshot.factDigest, dossierDigest: row.dossierRef.digest, policyHash: policy.hash, recommendation: row.snapshot.recommendation, asOf: row.snapshot.asOf, expiresAt: row.snapshot.expiresAt, advisoryIds: clone(row.advisoryIds), maliciousAdvisoryIds: clone(row.maliciousAdvisoryIds) });
}

/** Moved from `CoordinationStore._setKnowledgeNode` (issue #259 slice 1). State: the store, passed explicitly. */
export function _setKnowledgeNode(store, event, id, value) {
  const node = freeze(clone(value)); store._knowledgeNodes.set(id, node);
  store._knowledgeWriteThisEvent = true;
  const history = store._knowledgeNodeHistory.get(id) ?? [];
  const version = freeze({ observedSeq: event.seq, observedAt: event.ts, value: node });
  if (history.at(-1)?.observedSeq === event.seq) history[history.length - 1] = version; else history.push(version);
  store._knowledgeNodeHistory.set(id, history);
}

/** Moved from `CoordinationStore._setKnowledgeEdge` (issue #259 slice 1). State: the store, passed explicitly. */
export function _setKnowledgeEdge(store, event, id, value) {
  const edge = freeze(clone(value)); store._knowledgeEdges.set(id, edge);
  store._knowledgeWriteThisEvent = true;
  const history = store._knowledgeEdgeHistory.get(id) ?? [];
  const version = freeze({ observedSeq: event.seq, observedAt: event.ts, value: edge });
  if (history.at(-1)?.observedSeq === event.seq) history[history.length - 1] = version; else history.push(version);
  store._knowledgeEdgeHistory.set(id, history);
}


/** Moved from `CoordinationStore.events` (issue #259 slice 1). State: `this._events`, passed explicitly. */
export function events(state, fromSeq = 1, limit = null) {
  const start = Number.isSafeInteger(fromSeq) ? Math.max(0, fromSeq - 1) : 0;
  if (limit !== null && (!Number.isSafeInteger(limit) || limit <= 0)) throw new TypeError('event read limit must be a positive safe integer');
  return state.slice(start, limit === null ? undefined : start + limit).map(clone);
}

/** Moved from `CoordinationStore.observationTime` (issue #259 slice 1). State: the store, passed explicitly. */
export function observationTime(store, observedSeq = store._events.length) {
  if (!Number.isSafeInteger(observedSeq) || observedSeq < 0 || observedSeq > store._events.length) throw new TypeError('observation boundary must be a valid coordination sequence');
  return observedSeq === 0 ? null : store._events[observedSeq - 1].ts;
}

/** Moved from `CoordinationStore.task` (issue #259 slice 1). State: `this._tasks`, passed explicitly. */
export function task(state, id) { return clone(state.get(id) ?? null); }

/** Moved from `CoordinationStore.run` (issue #259 slice 1). State: `this._runs`, passed explicitly. */
export function run(state, id) { return clone(state.get(id) ?? null); }

/** Moved from `CoordinationStore.taskResourceRelease` (issue #259 slice 1). State: `this._taskResourceReleases`, passed explicitly. */
export function taskResourceRelease(state, taskId) {
  return clone(state.get(taskId) ?? null);
}

/** Moved from `CoordinationStore.unsettledPlanNodeTasks` (issue #259 slice 1). State: the store, passed explicitly. */
export function unsettledPlanNodeTasks(store) {
  return [...store._planTaskLinks.keys()].filter((taskId) => {
    const task = store._tasks.get(taskId);
    return task && Number.isSafeInteger(task.terminalEvent) && !store._planBudgetSettlements.has(taskId);
  }).sort();
}

/** Moved from `CoordinationStore.representationProduction` (issue #259 slice 1). State: `this._representations`, passed explicitly. */
export function representationProduction(state, identityDigest) { return clone(state.get(identityDigest) ?? null); }

/** Moved from `CoordinationStore.representationProductionByRequest` (issue #259 slice 1). State: the store, passed explicitly. */
export function representationProductionByRequest(store, requestDigest) {
  const binding = store._representationRequests.get(requestDigest);
  return binding ? representationProduction(store._representations, binding.identityDigest) : null;
}

/** Moved from `CoordinationStore.reverifyRepresentationProduction` (issue #259 slice 1). State: the store, passed explicitly. */
export function reverifyRepresentationProduction(store, identityDigest, expectedSource = null) {
  const representation = store._representations.get(identityDigest);
  if (!representation || !/^[a-f0-9]{64}$/.test(identityDigest ?? '')) throw new CoordinationRefusal('representation is unavailable', 'representation_reverify_unavailable');
  if (expectedSource !== null) {
    const sourceFields = Object.keys(representation.source).sort().join(',');
    const expectedStable = expectedSource && typeof expectedSource === 'object' && !Array.isArray(expectedSource)
      ? Object.fromEntries(Object.entries(expectedSource).filter(([key]) => key !== 'resultDigest')) : null;
    const durableStable = Object.fromEntries(Object.entries(representation.source).filter(([key]) => key !== 'resultDigest'));
    if (!expectedSource || Object.keys(expectedSource).sort().join(',') !== sourceFields
      || !/^[a-f0-9]{64}$/.test(expectedSource.resultDigest ?? '')
      || canonicalDigest(expectedStable) !== canonicalDigest(durableStable)) {
      throw new CoordinationRefusal('fresh source reverify diverged from durable representation', 'representation_reverify_diverged');
    }
  }
  const event = store._events[representation.recordedEvent - 1];
  const core = Object.fromEntries(Object.entries(event?.payload ?? {}).filter(([key]) => key !== 'productionDigest'));
  const sourceArtifact = store._artifacts.get(representation.sourceArtifact.id); const receiptArtifact = store._artifacts.get(representation.receiptArtifact.id);
  const node = store._knowledgeNodes.get(representation.representationId); const sourceNode = store._knowledgeNodes.get(representation.sourceNode.id);
  const task = store._tasks.get(representation.taskId); const taskNode = store._knowledgeNodes.get(`task:${representation.taskId}`);
  const edges = representation.edges.map((edge) => store._knowledgeEdges.get(edge.id));
  if (!event || event.kind !== 'knowledge.representation_produced' || event.payload?.identityDigest !== identityDigest
    || event.payload.productionDigest !== canonicalDigest(core) || !sourceArtifact || !receiptArtifact
    || sourceArtifact.supersededBy !== null || receiptArtifact.supersededBy !== null
    || Object.hasOwn(sourceArtifact, 'acceptanceInvalidation') || Object.hasOwn(receiptArtifact, 'acceptanceInvalidation')
    || !node || node.validTo !== null || node.grounding !== 'derived' || node.type !== 'Representation'
    || !sourceNode || sourceNode.validTo !== null || !task || (task.runId ?? null) !== representation.runId
    || !taskNode || taskNode.validTo !== null || edges.some((edge) => !edge || edge.validTo !== null)
    || canonicalDigest(sourceArtifact) !== canonicalDigest(representation.sourceArtifact)
    || canonicalDigest(receiptArtifact) !== canonicalDigest(representation.receiptArtifact)
    || canonicalDigest(node) !== canonicalDigest(representation.node)
    || canonicalDigest(sourceNode) !== canonicalDigest(representation.sourceNode)
    || canonicalDigest(edges) !== canonicalDigest(representation.edges)) {
    throw new CoordinationIntegrityError('durable representation projection diverged', 'representation_integrity');
  }
  return freeze({ ok: true, projection: clone(representation), grounding: 'derived' });
}

/** Moved from `CoordinationStore.goalPlanRunIds` (issue #259 slice 1). State: `this._goalHeads`, passed explicitly.
 * Issue #391 (C12): the answer is a PAGE of the Run index — the first `limit` ids past `cursor`
 * plus {truncated, nextCursor}, never the `goal_plan_status_oversize` refusal the row count used
 * to raise, so a caller walks the cursor to the whole index instead of asking for fewer rows. */
export function goalPlanRunIds(state, repoId, limit = 100_000, cursor = 0) {
  if (!boundedText(repoId, 256) || !Number.isSafeInteger(limit) || limit <= 0 || limit > 100_000
    || !Number.isSafeInteger(cursor) || cursor < 0) {
    throw new TypeError('goal/plan Run index request is invalid');
  }
  const ids = [];
  for (const goal of state.values()) {
    if (goal.repoId !== repoId || goal.runId === null) continue;
    ids.push(goal.runId);
  }
  return freeze(goalPlanPage([...new Set(ids)].sort(compareCanonicalStrings), limit, cursor));
}

/** Moved from `CoordinationStore.healthCheck` (issue #259 slice 1). State: the store, passed explicitly. */
export function healthCheck(store) { try { if (!existsSync(store.file)) return store._events.length === 0; const raw = readFileSync(store.file, 'utf8'); return raw.length === 0 || raw.endsWith('\n'); } catch { return false; } }

/** Moved from `CoordinationStore.readyTasks` (issue #259 slice 1). State: `this._tasks`, passed explicitly. */
export function readyTasks(state) {
  return [...state.values()].filter((task) => task.status === 'pending' && task.assignee == null
    && task.deps.every((dep) => state.get(dep)?.status === 'completed')).map(clone);
}

/** Moved from `CoordinationStore.fleetDrain` (issue #259 slice 1). State: `this._fleetDrains`, passed explicitly. */
export function fleetDrain(state, id) { return clone(state.get(id) ?? null); }

/** Moved from `CoordinationStore.runStop` (issue #259 slice 1). State: the store, passed explicitly. */
export function runStop(store, runId) {
  const authorityRunId = store._runStopByTarget.get(runId) ?? runId;
  return clone(store._runStops.get(authorityRunId) ?? null);
}

/** Moved from `CoordinationStore.webCommand` (issue #259 slice 1). State: `this._webCommands`, passed explicitly. */
export function webCommand(state, id) { return clone(state.get(id) ?? null); }

/** Moved from `CoordinationStore.webCommandByScope` (issue #259 slice 1). State: the store, passed explicitly. */
export function webCommandByScope(store, scopeKey) {
  const commandId = store._webCommandScopes.get(scopeKey);
  return clone(commandId ? store._webCommands.get(commandId) ?? null : null);
}

/** Moved from `CoordinationStore.mcpCall` (issue #259 slice 1). State: `this._mcpCalls`, passed explicitly. */
export function mcpCall(state, id) { return clone(state.get(id) ?? null); }

/** Moved from `CoordinationStore.mcpCallByScope` (issue #259 slice 1). State: the store, passed explicitly. */
export function mcpCallByScope(store, scopeKey) {
  const callId = store._mcpCallScopes.get(scopeKey);
  return clone(callId ? store._mcpCalls.get(callId) ?? null : null);
}

/** Moved from `CoordinationStore.artifact` (issue #259 slice 1). State: `this._artifacts`, passed explicitly. */
export function artifact(state, id) { return clone(state.get(id) ?? null); }

/** Moved from `CoordinationStore.providerProcessing` (issue #259 slice 1). State: `this._providerProcessing`, passed explicitly. */
export function providerProcessing(state, id) { return clone(state.get(id) ?? null); }

/** Moved from `CoordinationStore.advisoryFeedCards` (issue #259 slice 1). State: `this._advisoryFeedCards`, passed explicitly. */
export function advisoryFeedCards(state) { return [...state.values()].map((entry) => freeze({ ...clone(entry.card), cardDigest: entry.cardDigest })).sort((a, b) => compareCanonicalStrings(a.providerId, b.providerId)); }

/** Moved from `CoordinationStore.dueProviderProcessing` (issue #259 slice 1). State: the store, passed explicitly. */
export function dueProviderProcessing(store, repoId, at) {
  if (!store._providerAttemptPolicy || !boundedText(repoId, 256) || !Number.isFinite(Date.parse(at)) || new Date(Date.parse(at)).toISOString() !== at) throw new CoordinationRefusal('provider due-read authority is invalid', 'provider_attempt_unavailable');
  const due = []; let examined = 0;
  for (const row of store._providerProcessing.values()) {
    examined += 1; if (examined > store._providerAttemptPolicy.maxStateRows) throw new CoordinationRefusal('provider due derivation exceeded deployment ceiling', 'provider_attempt_oversize');
    if (row.repoId !== repoId || row.status !== 'pending' || (row.attemptCount ?? 0) - (row.attemptWindowStart ?? 0) >= store._providerAttemptPolicy.maxAttempts || (row.nextAttemptAt && Date.parse(row.nextAttemptAt) > Date.parse(at))) continue;
    due.push(row.id);
  }
  return due.sort().slice(0, store._providerAttemptPolicy.maxBatch);
}

/** Moved from `CoordinationStore.reuseDecision` (issue #259 slice 1). State: `this._reuseDecisions`, passed explicitly. */
export function reuseDecision(state, id) { return clone(state.get(id) ?? null); }

/** Moved from `CoordinationStore.reuseSubjectHead` (issue #259 slice 1). State: the store, passed explicitly. */
export function reuseSubjectHead(store, subjectDigest) { const id = store._reuseSubjects.get(subjectDigest); return id ? reuseDecision(store._reuseDecisions, id) : null; }

/** Moved from `CoordinationStore.reuseRiskGuard` (issue #259 slice 1). State: `this._reuseRiskGuards`, passed explicitly. */
export function reuseRiskGuard(state, coordinate) { return clone(state.get(canonicalDigest(coordinate)) ?? null); }

/** Moved from `CoordinationStore.waveClosure` (issue #259 slice 1). State: `this._waveClosures`, passed explicitly. */
export function waveClosure(state, waveId) {
  if (typeof waveId !== 'string' || waveId.length === 0) return null;
  return clone(state.get(waveId) ?? null);
}

/** Moved from `CoordinationStore.waveClosures` (issue #259 slice 1). State: `this._waveClosures`, passed explicitly. */
export function waveClosures(state) {
  return [...state.values()].map(clone);
}

// ---------------------------------------------------------------------------
// Reading CURRENT state from the append-only log (issue #286 G-31).
//
// An append-only log has no updates: a later record for the same key is a correction, and the
// current fact is the LAST one. Every reader that asks "what is true now" therefore reads the
// last record, never the first — a first-binding reader answers with a superseded value, which
// for the wave binding means a run whose wave was re-declared still routes, closes and seats by
// its stale wave. The rule is one reading per fact, taken from the replay fold that already folds
// last-write-wins (`_waveBindings`, `_workerGenerations`), so a reader cannot disagree with the
// fold or with another reader.
// ---------------------------------------------------------------------------

/** The current run -> wave binding, from the `_waveBindings` replay fold (last write wins). */
export function waveBinding(state, runId) {
  if (typeof runId !== 'string' || runId.length === 0) return null;
  return clone(state.get(runId) ?? null);
}


/** Moved from `CoordinationStore.waveRegistry` (issue #259 slice 1). State: `this._waveRegistry`, passed explicitly. */
export function waveRegistry(state) {
  return [...state.values()].map(clone);
}

/** Moved from `CoordinationStore.swarm` (issue #259 slice 1). State: `this._swarms`, passed explicitly. */
export function swarm(state, swarmId) { return readSwarm(state, swarmId); }

/** Moved from `CoordinationStore.swarms` (issue #259 slice 1). State: `this._swarms`, passed explicitly. */
export function swarms(state) { return swarmSnapshot(state).swarms; }

/** Moved from `CoordinationStore.priorCoordinationEvent` (issue #259 slice 1). State: `this._byKey`, passed explicitly. */
export function priorCoordinationEvent(state, key) {
  const event = state.get(key) ?? null;
  return event ? clone(event) : null;
}


/** Moved from `CoordinationStore.scratchpadFence` (issue #259 slice 1). State: `this._scratchpadFences`, passed explicitly. */
export function scratchpadFence(state, runId, scope) {
  return state.get(scratchpadScopeKey(runId, scope)) ?? 0;
}

/** Moved from `CoordinationStore.scratchpadSnapshotBatch` (issue #259 slice 1). State: the store, passed explicitly. */
export function scratchpadSnapshotBatch(store, runId, scopes, options = {}) {
  if (!validRunId(runId) || !Array.isArray(scopes) || scopes.length === 0
    || scopes.some((scope) => !SCRATCHPAD_SCOPE.test(scope))
    || new Set(scopes).size !== scopes.length) {
    throw new CoordinationRefusal('scratchpad snapshot request is invalid', 'scratchpad_read_invalid');
  }
  const fenceTuple = scopes.map((scope) => [scope, scratchpadFence(store._scratchpadFences, runId, scope)]);
  if (Object.hasOwn(options, 'expectedFenceTuple')
    && canonicalDigest(options.expectedFenceTuple) !== canonicalDigest(fenceTuple)) {
    throw new CoordinationRefusal('scratchpad cursor fence is stale', 'scratchpad_cursor_stale');
  }
  const slices = scopes.map((scope) => {
    const ids = store._scratchpadEntriesByScope.get(scratchpadScopeKey(runId, scope)) ?? [];
    return freeze({ scope, entries: freeze(ids.map((id) => clone(store._scratchpadEntries.get(id))).filter(Boolean)) });
  });
  return freeze({ runId, observedSeq: store._events.length, fenceTuple: freeze(clone(fenceTuple)), slices: freeze(slices) });
}

/** Moved from `CoordinationStore._scratchpadResolveForWorker` (issue #259 slice 1). State: `this._scratchpadEntries`, passed explicitly. */
export function _scratchpadResolveForWorker(state, runId, workerId, entryId, entryDigest, requirement = {}) {
  const row = state.get(entryId);
  if (!row || row.runId !== runId || row.entryDigest !== entryDigest) return null;
  if (requirement.kind && row.kind !== requirement.kind) return null;
  if (requirement.ownOnly && row.scope !== `worker:${workerId}`) return null;
  if (requirement.ownOrShared && row.scope !== `worker:${workerId}` && row.scope !== 'shared') return null;
  return row;
}

/** Moved from `CoordinationStore.eventFence` (issue #259 slice 1). State: `this._events`, passed explicitly. */
export function eventFence(state) {
  return state.length;
}

/** Moved from `CoordinationStore.workerGeneration` (issue #259 slice 1). State: `this._workerGenerations`, passed explicitly. */
export function workerGeneration(state, workerId) {
  const rec = state.get(workerId) ?? null;
  return rec ? clone(rec) : null;
}

/** Moved from `CoordinationStore._taskByRun` (issue #259 slice 1). State: `this._tasks`, passed explicitly. */
export function _taskByRun(state, runId) {
  for (const task of state.values()) {
    if (task.runId === runId) return task;
  }
  return null;
}

/** Moved from `CoordinationStore._waveMembershipOf` (issue #259 slice 1). State: `this._events`, passed explicitly. */
export function _waveMembershipOf(state, runId) {
  for (const event of state) {
    if (event.kind !== 'driver.recorded' || event.payload?.kind !== 'steering.registered') continue;
    const record = event.payload;
    if (record.runId === runId && record.waveId != null) {
      return { waveId: record.waveId, waveRole: record.waveRole ?? null, recordSeq: event.seq };
    }
  }
  return null;
}


/** Moved from `CoordinationStore._knowledgePayload` (issue #259 slice 1). Reads no store state. */
export function _knowledgePayload(fields, extras = {}) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).some((key) => KNOWLEDGE_PROJECTION_FIELDS.has(key))) throw new CoordinationRefusal('knowledge request uses lifecycle-owned fields', 'reserved_knowledge_field');
  const core = { ...clone(fields), ...clone(extras) };
  return { ...core, contentDigest: canonicalDigest(core) };
}

/** Moved from `CoordinationStore._supersessionWouldCycle` (issue #259 slice 1). State: `this._knowledgeEdges`, passed explicitly. */
export function _supersessionWouldCycle(state, from, to) {
  const pending = [to]; const seen = new Set();
  while (pending.length > 0) {
    const node = pending.pop(); if (node === from) return true; if (seen.has(node)) continue; seen.add(node);
    for (const edge of state.values()) if (edge.type === 'Supersedes' && !edge.validTo && edge.from === node) pending.push(edge.to);
  }
  return false;
}

/** Moved from `CoordinationStore._scratchCorrectionPrefix` (issue #259 slice 1). State: `this._events`, passed explicitly. */
export function _scratchCorrectionPrefix(state, observedSeq) {
  const prefix = state.slice(0, observedSeq); const tasks = new Map(); const scratch = new Map(); const scratchReads = []; const artifacts = []; const supersededArtifacts = new Set();
  for (const event of prefix) {
    if (event.kind === 'task.created') tasks.set(event.payload.id, { created: event, payload: clone(event.payload), status: 'pending', terminalEvent: null, routeKey: event.payload.routeKey ?? null });
    else if (event.kind === 'task.claimed') { const task = tasks.get(event.payload.id); if (task) { task.status = 'working'; task.routeKey = event.payload.routeKey ?? task.routeKey; task.claimed = event; } }
    else if (event.kind === 'task.transitioned') { const task = tasks.get(event.payload.id); if (task) { task.status = event.payload.to; if (TERMINAL.has(event.payload.to)) task.terminalEvent = event; } }
    else if (event.kind === 'task.acceptance_revoked') { const task = tasks.get(event.payload.taskId); if (task) { task.status = 'failed'; task.terminalEvent = event; } }
    else if (event.kind === 'scratch.fact_posted') scratch.set(event.payload.id, { event, active: true });
    else if (event.kind === 'scratch.fact_expired') { const fact = scratch.get(event.payload.id); if (fact) fact.active = false; }
    else if (event.kind === 'scratch.read') scratchReads.push(event);
    else if (event.kind === 'artifact.registered') artifacts.push(event);
    else if (event.kind === 'artifact.superseded') supersededArtifacts.add(event.payload.oldId);
  }
  return { prefix, tasks, scratch, scratchReads, artifacts, supersededArtifacts };
}

/** Moved from `CoordinationStore._knowledgeProjectFence` (issue #259 slice 1). State: the store, passed explicitly. */
export function _knowledgeProjectFence(store) {
  let fence = 0;
  for (const versions of store._knowledgeNodeHistory.values()) { const seq = versions.at(-1)?.observedSeq ?? 0; if (seq > fence) fence = seq; }
  for (const versions of store._knowledgeEdgeHistory.values()) { const seq = versions.at(-1)?.observedSeq ?? 0; if (seq > fence) fence = seq; }
  return fence;
}

/** Moved from `CoordinationStore._madConfidence` (issue #259 slice 1). Reads no store state. */
export function _madConfidence(body, maxMetrics = 100_000) { return madConfidenceOf(body, maxMetrics); }

/** Moved from `CoordinationStore._knowledgeStaleness` (issue #259 slice 1). State: `this._knowledgeReads`, passed explicitly. */
export function _knowledgeStaleness(state, node, fence, liveContradictNodeIds, liveSupersedeTargetIds, staleAfterSeq) {
  const reasons = [];
  if (node.validTo || liveSupersedeTargetIds.has(node.id)) reasons.push('superseded');
  if (liveContradictNodeIds.has(node.id)) reasons.push('contradicted');
  const referenced = state.some((read) => (read.nodeIds ?? []).includes(node.id));
  const age = Math.max(0, fence - (node.eventTimeSeq ?? node.observedSeq ?? 0));
  if (!referenced && age >= staleAfterSeq) reasons.push('unreferenced');
  return reasons.length === 0 ? null : { reasons, age };
}

/** Moved from `CoordinationStore._cachePreview` (issue #259 slice 1). State: the store, passed explicitly. */
export function _cachePreview(store, key, value, previewPolicy) {
  store._previewCache.set(key, value);
  while (store._previewCache.size > previewPolicy.maxPreviewCacheEntries) {
    const oldest = store._previewCache.keys().next().value;
    if (oldest === undefined) break;
    store._previewCache.delete(oldest);
  }
  return value;
}

/** Moved from `CoordinationStore._recallAssessmentCandidate` (issue #259 slice 1). State: the store, passed explicitly. */
export function _recallAssessmentCandidate(store, receipt, observedSeq) {
  if (!receipt || receipt.kind !== 'knowledge.recall' || receipt.seq > observedSeq || typeof receipt.payload?.taskId !== 'string' || receipt.payload.runId !== null || typeof receipt.payload.readerWorker !== 'string') return null;
  const task = store._tasks.get(receipt.payload.taskId); const terminal = Number.isSafeInteger(task?.terminalEvent) ? store._events[task.terminalEvent - 1] : null;
  if (!task || typeof task.runId !== 'string' || task.runId.length === 0 || !terminal || terminal.seq > observedSeq || terminal.seq <= receipt.seq || terminal.kind !== 'task.transitioned' || terminal.payload?.id !== task.id || terminal.payload?.to !== task.status) return null;
  const mappedSeq = terminal.payload?.evidence?.coordinationSeq; const mapped = Number.isSafeInteger(mappedSeq) ? store._events[mappedSeq - 1] : null;
  if (!mapped || mapped.seq <= receipt.seq || mapped.seq >= terminal.seq || mapped.kind !== 'evidence.mapped' || mapped.payload?.kind !== 'verify.reverified'
    || canonicalDigest({ ...clone(mapped.payload), coordinationSeq: mapped.seq }) !== canonicalDigest(terminal.payload.evidence)) return null;
  const source = store._operationalRead?.(mapped.payload.worker, mapped.payload.workerSeq);
  if (!source || digest(source) !== mapped.payload.digest || source.kind !== 'verify.reverified' || source.worker !== receipt.payload.readerWorker || mapped.payload.worker !== receipt.payload.readerWorker
    || source.taskId !== task.id || source.runId !== task.runId || source.harness !== task.harnessResolved || source.modelResolved !== task.modelResolved || source.effortResolved !== task.effortResolved || source.routeKey !== task.routeKey) return null;
  const outcome = task.status === 'completed' && source.payload?.accept === true
    ? 'verified_pass_after_recall'
    : task.status === 'failed' && source.payload?.accept === false
      ? 'verified_fail_after_recall'
      : null;
  if (outcome === null) return null;
  const exposure = {
    nodeIds: clone(receipt.payload.nodeIds), validityVersions: clone(receipt.payload.validityVersions), scores: clone(receipt.payload.scores), contradictionEdgeIds: clone(receipt.payload.contradictionEdgeIds),
    queryDigest: receipt.payload.query ? canonicalDigest(receipt.payload.query) : null, requestDigest: receipt.payload.requestDigest, resultProjectionDigest: receipt.payload.resultProjectionDigest,
  };
  const core = {
    schemaVersion: 1, recallEventSeq: receipt.seq, recallReceiptDigest: receipt.payload.receiptDigest,
    readerActor: receipt.payload.readerActor, readerWorker: receipt.payload.readerWorker, taskId: task.id, runId: task.runId,
    historicalExposureDigest: canonicalDigest(exposure), ...exposure,
    verificationEventSeq: mapped.seq, verificationDigest: mapped.payload.digest, terminalEventSeq: terminal.seq, terminalStatus: task.status,
    routeDigest: canonicalDigest({ harnessResolved: task.harnessResolved, modelResolved: task.modelResolved, effortResolved: task.effortResolved, routeKey: task.routeKey }),
    outcome, causationClaimed: false,
  };
  const assessmentId = `recall-assessment:${canonicalDigest({ repoId: receipt.payload.policy.repoId, recallEventSeq: receipt.seq, verificationEventSeq: mapped.seq, terminalEventSeq: terminal.seq, outcome })}`;
  const bound = { assessmentId, ...core }; return freeze({ ...bound, assessmentDigest: canonicalDigest(bound) });
}

/** Moved from `CoordinationStore.recallAssessments` (issue #259 slice 1). State: the store, passed explicitly. */
export function recallAssessments(store, { nodeId = null, taskId = null, observedSeq = store._events.length } = {}) {
  if ((nodeId !== null && typeof nodeId !== 'string') || (taskId !== null && typeof taskId !== 'string') || !Number.isSafeInteger(observedSeq) || observedSeq < 0 || observedSeq > store._events.length) throw new CoordinationRefusal('knowledge recall assessment query is invalid', 'causal_assessment_invalid');
  return [...store._knowledgeRecallAssessments.values()].filter((row) => row.eventSeq <= observedSeq && (nodeId === null || row.nodeIds.includes(nodeId)) && (taskId === null || row.taskId === taskId)).sort((a, b) => a.recallEventSeq - b.recallEventSeq).map(clone);
}

/** Moved from `CoordinationStore.KNOWLEDGE_CANDIDATE_TRIGGERS` (issue #259 slice 1). Reads no store state. */
export function KNOWLEDGE_CANDIDATE_TRIGGERS() {
  return Object.freeze({

    'scratch.cited_observed': 'scratchpad_settle',
    'verified_task_outcome': 'verification',
  });
}

/** Moved from `CoordinationStore.affectedReaders` (issue #259 slice 1). State: the store, passed explicitly. */
export function affectedReaders(store, nodeId) {
  return store._knowledgeReads.filter((read) => read.nodeIds.includes(nodeId)).map((read) => clone({
    readEvent: read.eventSeq,
    taskId: read.taskId ?? null,
    taskStatus: read.taskId ? store._tasks.get(read.taskId)?.status ?? null : null,
    runId: read.runId ?? null,
    readerWorker: read.readerWorker ?? null,
    readerActor: read.readerActor ?? null,
  }));
}

/** Moved from `CoordinationStore.traceKnowledge` (issue #259 slice 1). State: the store, passed explicitly. */
export function traceKnowledge(store, nodeId) {
  if (!store._knowledgeNodes.has(nodeId)) throw new CoordinationRefusal(`unknown knowledge node ${nodeId}`, 'not_found');
  const edges = [...store._knowledgeEdges.values()].filter((edge) => edge.from === nodeId || edge.to === nodeId).map(clone);
  return freeze({ node: clone(store._knowledgeNodes.get(nodeId)), evidence: clone(store._knowledgeNodes.get(nodeId).evidence ?? []), edges });
}

// ── the pinned authority-free members (issue #259 slice 2) ────────────────────────────────────────────

/** Moved from `CoordinationStore._acceptanceRevocationRequest` (issue #259 slice 2). Reads no store state. */
export function _acceptanceRevocationRequest(fields, auth) {
  const expected = ['evidence', 'expectedTaskVersion', 'schemaVersion', 'taskId'];
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)
    || Object.keys(fields).sort().join(',') !== expected.sort().join(',') || fields.schemaVersion !== 1
    || typeof fields.taskId !== 'string' || fields.taskId.length === 0 || Buffer.byteLength(fields.taskId) > 4_096
    || !Number.isSafeInteger(fields.expectedTaskVersion) || fields.expectedTaskVersion <= 0
    || !fields.evidence || typeof fields.evidence !== 'object' || Array.isArray(fields.evidence)
    || Object.keys(fields.evidence).join(',') !== 'coordinationSeq'
    || !Number.isSafeInteger(fields.evidence.coordinationSeq) || fields.evidence.coordinationSeq <= 0) {
    throw new CoordinationRefusal('task acceptance revocation request is invalid', 'acceptance_revocation_invalid');
  }
  if (!promotionActor(auth?.actor) || typeof auth?.key !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(auth.key)) {
    throw new CoordinationRefusal('task acceptance revocation authority is invalid', 'acceptance_revocation_unauthorized');
  }
  return clone(fields);
}

/** Moved from `CoordinationStore._contradictionListRequest` (issue #259 slice 2). State: the store, passed explicitly. */
export function _contradictionListRequest(store, request, policy) {
  const fields = ['observedSeq', 'afterEdgeId', 'limit'];
  if (!validKnowledgeContradictionPolicy(policy) || !request || Object.keys(request).sort().join(',') !== fields.sort().join(',')
    || !Number.isSafeInteger(request.observedSeq) || request.observedSeq < 0 || request.observedSeq > store._events.length
    || (request.afterEdgeId !== null && !boundedText(request.afterEdgeId, 4_096)) || !Number.isSafeInteger(request.limit) || request.limit <= 0) throw new CoordinationRefusal('knowledge contradiction list request is invalid', 'causal_contradiction_invalid');
  return freeze(clone(request));
}

/** Moved from `CoordinationStore._contradictionResolutionRequest` (issue #259 slice 2). Reads no store state. */
export function _contradictionResolutionRequest(request, policy) {
  const fields = ['edgeId', 'winnerId', 'loserId', 'expectedEdgeValidityVersion', 'expectedWinnerValidityVersion', 'expectedLoserValidityVersion', 'reason'];
  if (!validKnowledgeContradictionPolicy(policy) || !request || Object.keys(request).sort().join(',') !== fields.sort().join(',')
    || !boundedText(request.edgeId, 4_096) || !boundedText(request.winnerId, 4_096) || !boundedText(request.loserId, 4_096) || request.winnerId === request.loserId
    || !Number.isSafeInteger(request.expectedEdgeValidityVersion) || request.expectedEdgeValidityVersion <= 0
    || !Number.isSafeInteger(request.expectedWinnerValidityVersion) || request.expectedWinnerValidityVersion <= 0
    || !Number.isSafeInteger(request.expectedLoserValidityVersion) || request.expectedLoserValidityVersion <= 0
    || typeof request.reason !== 'string' || request.reason.trim().length === 0 || request.reason.includes('\0') || !validUnicodeScalarString(request.reason)) throw new CoordinationRefusal('knowledge contradiction resolution request is invalid', 'causal_contradiction_invalid');
  return freeze(clone(request));
}

/** Moved from `CoordinationStore._scratchCorrectionRequest` (issue #259 slice 2). Reads no store state. */
export function _scratchCorrectionRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request) || !['release', 'supersede', 'retract'].includes(request.action)) throw new CoordinationRefusal('Scratch correction request is invalid', 'causal_correction_invalid');
  const fields = request.action === 'release' ? ['action', 'oracleTaskId', 'scratchFactId']
    : request.action === 'supersede' ? ['action', 'expectedValidityVersion', 'replacementScratchFactId', 'targetNodeId', ...(Object.hasOwn(request, 'oracleTaskId') ? ['oracleTaskId'] : [])]
      : ['action', 'expectedValidityVersion', 'reason', 'targetNodeId'];
  if (Object.keys(request).sort().join(',') !== fields.sort().join(',')) throw new CoordinationRefusal('Scratch correction request shape is invalid', 'causal_correction_invalid');
  for (const name of ['scratchFactId', 'replacementScratchFactId', 'targetNodeId', 'oracleTaskId']) if (Object.hasOwn(request, name) && (typeof request[name] !== 'string' || request[name].length === 0 || Buffer.byteLength(request[name]) > 4_096)) throw new CoordinationRefusal('Scratch correction identifier is invalid', 'causal_correction_invalid');
  if (request.action !== 'release' && (!Number.isSafeInteger(request.expectedValidityVersion) || request.expectedValidityVersion <= 0)) throw new CoordinationRefusal('Scratch correction target version is invalid', 'causal_correction_invalid');
  if (request.action === 'retract' && !['source_expired', 'oracle_withdrawn', 'operator_correction'].includes(request.reason)) throw new CoordinationRefusal('Scratch correction reason is invalid', 'causal_correction_invalid');
  return clone(request);
}

/** Moved from `CoordinationStore.scratchFactOracleTarget` (issue #259 slice 2). State: the store, passed explicitly. */
export function scratchFactOracleTarget(store, id, repoId, maxTargetBytes) {
  if (typeof id !== 'string' || id.length === 0 || Buffer.byteLength(id) > 4_096 || typeof repoId !== 'string' || repoId.length === 0
    || !Number.isSafeInteger(maxTargetBytes) || maxTargetBytes <= 0) throw new CoordinationRefusal('Scratch oracle target request is invalid', 'scratch_oracle_invalid');
  const fact = store._scratchFacts.get(id);
  if (!fact || !fact.active || fact.grounding !== 'derived') throw new CoordinationRefusal('Scratch oracle requires an active derived fact', 'scratch_oracle_target_ineligible');
  if (fact.envRef?.repoId !== repoId || typeof fact.ownerTask !== 'string' || fact.ownerTask.length === 0) throw new CoordinationRefusal('Scratch oracle target repository or producer is invalid', 'scratch_oracle_target_ineligible');
  const source = store._events[fact.createdEvent - 1];
  const projectedFact = Object.fromEntries(Object.entries(fact).filter(([key]) => !['active', 'createdEvent'].includes(key)));
  if (!source || source.kind !== 'scratch.fact_posted' || source.payload?.id !== id || canonicalDigest(source.payload) !== canonicalDigest(projectedFact)) {
    throw new CoordinationIntegrityError('Scratch oracle source binding is invalid', 'scratch_oracle_integrity');
  }
  const snapshot = clone(source.payload); const targetBytes = canonicalBytes(snapshot);
  if (targetBytes > maxTargetBytes) throw new CoordinationRefusal('Scratch oracle target exceeded deployment ceiling', 'scratch_oracle_oversize');
  const commitment = freeze({
    schemaVersion: 1, kind: 'scratch.fact', scratchFactId: id,
    scratchFactDigest: canonicalDigest(snapshot), sourceEventSeq: source.seq,
    sourceEventDigest: canonicalDigest(source), repoId,
    envRefDigest: canonicalDigest(snapshot.envRef), producerTaskId: snapshot.ownerTask,
  });
  return freeze({ commitment, snapshot, targetBytes });
}
