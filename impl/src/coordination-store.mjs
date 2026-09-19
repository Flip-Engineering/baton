import {
  appendFileSync, chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { serialize } from 'node:v8';
import {
  GoalPlanValidationError, assertGoalSuccessor, goalPlanDigest, normalizeGoalPlanPolicy, normalizePlanRequest, planRouteMatches
} from './goal-plan.mjs';
import { SwarmIntegrityError } from './swarm-state.mjs';
import { usdFromNanos, usdToNanos } from './usd.mjs';
import {
  CANONICAL_ORDER_VERSION, canonicalJson, compareCanonicalStrings, normalizeCanonicalOrderMigration, normalizeCanonicalOrderPolicy
} from './canonical-order.mjs';
import { parseRouteTupleKey } from './route-tuple.mjs';
import { inferTaskTopologyRelation, normalizeTaskTopologyPolicy } from './task-topology.mjs';
import {
  DEFAULT_MAX_REPL_MANIFESTS_PER_RUN, normalizeRunLineagePolicy, RUN_ORCHESTRATOR_CAPABILITIES, RUN_ORCHESTRATOR_REVOCATION_REASONS
} from './run-lineage.mjs';
import { LEGACY_WORKFLOW_POLICY, normalizeWorkflowPolicy } from './workflow-policy.mjs';
import {
  buildWorkflowRoleCatalog, normalizeWorkflowDefinition, validateWorkflowDefinitionLegacy, validateWorkflowDefinitionV3, workflowAttemptRoute, workflowCatalogRole
} from './workflow-definition.mjs';
import { normalizeContextProgramPolicy } from './context-program-policy.mjs';
import {
  contextCellIdentity, contextProgramIsPure, contextSessionIdentity, normalizeContextArtifactRef, normalizeContextAuthority
} from './context-authority.mjs';
import {
  contextValueDigest, normalizeContextManifest, normalizeContextProgram, normalizeReplManifest
} from './context-program.mjs';
import { validatePureContextOutputLineage } from './context-lineage.mjs';
import { validateContextMapResultLineage } from './context-result-lineage.mjs';
import { validateContextEffectResultLineage } from './context-effect-result-lineage.mjs';
import { contextEffectNodeBinding, normalizeContextEffectCall, normalizeContextEffectSource } from './context-call.mjs';
import { contextMapCallIdentity, contextMapNodeBinding, normalizeContextMapCall } from './context-map.mjs';
import { normalizeContextResultPathScope, validateContextProviderResultReference } from './context-result.mjs';
import { pathInScopes } from './path-scope.mjs';
import {
  validProcessClosedPayload, validProcessStartedPayload, validRecoveryProcessAbsentPayload, validRecoveryProcessReapedPayload
} from './process-lifecycle.mjs';
import { FRAME_LIMITS } from './limits.mjs';

import * as coordinationInternals from './coordination-internals.mjs';
import * as coordinationReplay from './coordination-replay.mjs';
import {
  BRIEFING_SCHEMA_FIELD_SOURCES, CoordinationIntegrityError, CoordinationRefusal, MAX_CONTEXT_PACK_BODY_BYTES, PROJECTION_CHECKPOINT_FIELDS, SEGMENT_INDEX_FILE, TERMINAL, boundedText, canonical, canonicalBytes, canonicalDigest, clone, digest, eventTime, freeze, madConfidenceOf, promotionActor, sha256Bytes, validKnowledgeContradictionPolicy, validRunId, validUnicodeScalarString
} from './coordination-internals.mjs';

import * as coordinationLedger from './coordination-ledger.mjs';
import {
  ARTIFACT_LIFECYCLE_FIELDS,
  BRIEFING_FAMILY,
  KNOWLEDGE_EDGE_TYPES,
  KNOWLEDGE_GROUNDINGS,
  KNOWLEDGE_NODE_TYPES,
  MAX_SCRATCHPAD_BATCH_BYTES,
  MAX_SCRATCHPAD_ENTRY_BYTES,
  MAX_SCRATCHPAD_SNAPSHOT_REAPS,
  MAX_SCRATCHPAD_SNAPSHOT_REAP_BYTES,
  MAX_SCRATCHPAD_WRITE_REQUEST_BYTES,
  MAX_STORE_BOARD_DETAIL_BYTES,
  MAX_STORE_BOARD_EVIDENCE,
  MAX_STORE_BOARD_TITLE_BYTES,
  PROJECTION_REFERENCES,
  REPL_DIGEST,
  SAFE_BOARD_ID,
  SAFE_BOARD_OWNER,
  SAFE_REPL_NAME,
  SAFE_REPL_SCOPE,
  SwarmReplayRefusal,
  assertWaveStartedRoster,
  boardBounded,
  boardReportRequestDigest,
  coachingRefusal,
  contextChildAccepted,
  contextReadAttemptKey,
  normalizedRecallText,
  providerAttemptDelay,
  recallTerms,
  replBindingContentDigest,
  replBindingKey,
  resourceOverlap,
  validBoardEvidenceRef,
  validEnvRef,
  validKnowledgePreviewPolicy,
  validKnowledgePromotionPolicy,
  validKnowledgeRecallAssessmentPolicy,
  validKnowledgeRecallPolicy,
  validKnowledgeScratchCorrectionPolicy,
  writeQuarantineEntry,
} from './coordination-ledger.mjs';
export { BRIEFING_FAMILY, MAX_SCRATCHPAD_BATCH_BYTES, MAX_SCRATCHPAD_ENTRY_BYTES, MAX_SCRATCHPAD_SNAPSHOT_REAPS, MAX_SCRATCHPAD_SNAPSHOT_REAP_BYTES, MAX_SCRATCHPAD_WRITE_REQUEST_BYTES, SwarmReplayRefusal };

export {
  BRIEFING_SCHEMA_FIELD_SOURCES,
  CoordinationIntegrityError,
  CoordinationRefusal,
  MAX_CONTEXT_PACK_BODY_BYTES,
};

function writerProcessStartIdentity(pid) {
  try {
    const value = execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8', maxBuffer: 4_096, stdio: ['ignore', 'pipe', 'ignore'], timeout: 1_000,
    }).trim();
    return value && Buffer.byteLength(value) <= 256 ? value : null;
  } catch { return null; }
}

function writerOwnerState(owner) {
  if (!Number.isSafeInteger(owner?.pid) || owner.pid <= 0) return 'unknown';
  let alive = false;
  try { process.kill(owner.pid, 0); alive = true; }
  catch (error) {
    if (error?.code === 'EPERM') alive = true;
    else if (error?.code !== 'ESRCH') return 'unknown';
  }
  if (!alive) return 'stale';
  // Legacy v1 records remain fail-closed while a PID is alive. Every newly-created v2 record binds
  // the kernel-observed process start, so PID reuse is distinguishable on all new deployments.
  if (owner.schemaVersion !== 2 || typeof owner.pidStart !== 'string') return 'active';
  const observed = writerProcessStartIdentity(owner.pid);
  if (!observed) return 'unknown';
  return observed === owner.pidStart ? 'active' : 'stale';
}

const CANONICAL_ORDER_MIGRATION = Symbol('canonical-order-migration');
const CANONICAL_ORDER_RECEIPT = 'canonical-order-receipt.json';
const CANONICAL_ORDER_TEMP_PREFIX = '.canonical-order-receipt.';
const PROJECTION_CHECKPOINT = 'projection.checkpoint';
const PROJECTION_CHECKPOINT_TEMP_PREFIX = '.projection.checkpoint.';

/** Issue #449: the opens that owe the NEXT open a checkpoint, by the restore state that made them
 * replay, with the reason token each refresh reports. `valid` needs nothing, `corrupt` keeps its
 * landed remedy (#397: a repair, never a rewrite over the refused bytes), and an empty ledger has
 * nothing to cache — `_openCheckpointRefresh` names all three refusals. */

/** Issue #465(3): the projection's REFERENCE grammar — the ledger kinds a projection row may point
 * at, and where inside that row's payload the referenced value lives. ONE table, so every writer of
 * a `{kind, seq}` reference and the ONE reader (`_projectionReferenceValue`) cannot disagree about
 * what a pair means; a kind that is not in here is not a reference and resolves to null, never to a
 * guessed value. The pairing is the #464/#469 derivation (a `roleRef`/`briefRef`/`objectiveRef`
 * names the `swarm.participant_joined` row that holds the text), applied to the families the
 * checkpoint measured as second copies of their own ledger rows. */

/** Issue #465(4): the swarm family's null-prototype dictionaries, read off the body the write is
 * about to persist. A row's dictionary is built with an EMPTY prototype (swarm-state.mjs `nullDict`)
 * so a key named `__proto__` is data and not a prototype write, and `v8`'s round trip flattens every
 * container to a plain object — so the names are recorded on the envelope and the open restores
 * them. Derived from the rows themselves (never a second declaration of the fold's shape), in a
 * stable order, and empty for a body with no such family. */
function nullPrototypeFields(swarms) {
  if (!(swarms instanceof Map) || swarms.size === 0) return Object.freeze([]);
  const names = new Set();
  for (const swarm of swarms.values()) {
    if (swarm === null || typeof swarm !== 'object' || Array.isArray(swarm)) continue;
    for (const [name, value] of Object.entries(swarm)) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)
        && !(value instanceof Map) && !(value instanceof Set)
        && Object.getPrototypeOf(value) === null) names.add(name);
    }
  }
  return Object.freeze([...names].sort());
}

/** Issue #465(3): what a reference stands for, in bytes — the text a reader carries if it resolves
 * the pair: the exact UTF-8 length of a string, or of the JSON text an object-valued field
 * serializes to. ONE derivation, so every family's `<field>Bytes` is the same measurement (and the
 * spill row's existing `bytes` — minted as `Buffer.byteLength(body)` — is the same number). */
function referencedBytes(value) {
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

/** Issue #290: the wave.started roster well-formedness rule, shared by the replay fold and the
 * prospective write gate so the two can never drift — the fold refuses a genuinely malformed
 * roster (neither a well-formed object-array nor a well-formed string-array) as an integrity
 * failure; the write gate refuses the same payloads typed BEFORE the durable append. */

/** Epic #81 (O-2, issue #367): the per-attempt receipt identity — the ONE key derivation the
 * context.read fold and the O-2 ceiling admission share, so the fold's `{count, bytes}` row
 * and the admission's lookup can never drift apart. */

/** Issue #290: the default ledger group-commit — one fsync per drain tick regardless of how
 * many events landed inside it, so the authoritative ledger is at least as durable as the
 * fsynced housekeeping (checkpoint, segments, receipts) that accelerates its replay. */
const defaultLedgerSync = (file) => {
  const fd = openSync(file, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
};

/** Issue #290: durably record one quarantine entry beside the ledger (atomic temp + fsync +
 * rename, matching the receipt and checkpoint discipline). A repeat naming an already-quarantined
 * seq with the same entry is idempotent; a different entry for the same seq is a conflict. */

// Issue #223 ledger compaction: terminal-wave event prefixes are archived into
// content-addressed segment files under <root>/segments/ (segment = the event range
// [fromSeq, throughSeq] + sha256 of the exact JSONL bytes). The segment INDEX is a compact
// ordered roster of the archived prefix; it is a cache — the segment files are immutable
// and the index is rebuilt by scanning them if it is absent or behind the ledger's
// truncation. `compact({ beforeSeq })` is the operator verb that lands this seam; a later
// row wires the cadence policy that decides which waves are terminal and picks the cut.
/** Issue #304: the typed startup refusal for a RECORDED swarm row the fold rejects. The bare
 * SwarmIntegrityError a resident died with named a code but not the row, and left the operator
 * no repairable coordinate. This refusal carries the offending row's seq and kind, the fold's
 * own code (kept as `code`, so a quarantine entry records the true cause), the original
 * message, and the remedy — quarantine the seq per #290's verb, or land the rule with the
 * replay corpus so no fold refuses recorded history again. Raised only at the fold site during
 * replay (`_loading`); a live append failure still poisons the projection the #290 way. */

/** Issue #304: the read-only probe behind `baton doctor`'s coordination row. It runs the REAL
 * startup — one store construction, no writer lease, no writes (the #290 quarantine probe's
 * idiom) — and reports the typed refusal a restart would die with, or null when the ledger
 * replays clean. */
export function coordinationReplayFailure(root) {
  try {
    new CoordinationStore(root);
    return null;
  } catch (error) {
    return freeze({
      state: 'replay_refused',
      name: error?.name ?? null,
      seq: error?.coordinationSeq ?? null,
      kind: error?.coordinationKind ?? null,
      code: error?.code ?? 'coordination_startup_failed',
      message: error?.message ?? String(error),
      remedy: error?.remedy ?? 'restart after repairing the coordination ledger',
    });
  }
}

const SEGMENT_TEMP_PREFIX = '.segment.';
const SEGMENT_INDEX_TEMP_PREFIX = '.segment-index.';
const LEDGER_TEMP_PREFIX = '.events.jsonl.';

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
// #286 G-41: the acceptance-revocation scan is bounded by the STATE ITSELF, and that state is a
// projection of the ledger (`_artifacts`, `_knowledgeNodes` and `_knowledgeReads` each grow only by
// an appended event, so none can exceed the ledger's event count) — the ledger is the physical
// resource, and a second literal ceiling on top of it refused operations the ledger had already
// accepted, including on replay, where it made a self-written ledger unloadable.
const REPRESENTATION_POLICY_FIELDS = [
  'maxArgumentBytes', 'maxEvidenceRefs', 'maxGraphBatchBytes', 'maxReceiptBytes',
  'maxResultBytes', 'maxResultItems', 'maxResultRefs', 'maxSourceRefBytes', 'maxSourceRefs', 'repoId', 'schemaVersion',
];
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


// KG-3/KG-4 (v2-P1-3, P2-7). The preview policy is a two-level split so `policy.recall` stays
// byte-exactly the 11 recall fields (accepted verbatim by validKnowledgeRecallPolicy) while
// `policy.preview` carries the composite weights, byte caps, per-type auto-link thresholds, K,
// the LRU cache bound, and the staleness age. Unlike the recall numeric guard (≤0 ⇒ invalid) the
// composite weights admit 0 — a disabled term is legal (v2-P2-12).

function validKnowledgeWorkflowAdmissionPolicy(policy) {
  if (!policy || Object.keys(policy).sort().join(',') !== [...KNOWLEDGE_WORKFLOW_ADMISSION_POLICY_FIELDS].sort().join(',') || typeof policy.repoId !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(policy.repoId)) return false;
  const numeric = KNOWLEDGE_WORKFLOW_ADMISSION_POLICY_FIELDS.filter((name) => name !== 'repoId');
  if (numeric.some((name) => !Number.isSafeInteger(policy[name]) || policy[name] <= 0)) return false;
  return policy.maxBatchBytes <= 16 * 1024 * 1024 && policy.maxResultBytes <= 16 * 1024 * 1024;
}

function validRoutePolicy(policy) {
  const fields = ['mode', 'halfLifeMs', 'explorationConstant', 'seedDiscount', 'minSamplesForAdaptive', 'defaultPriorSuccessRate'];
  return policy && Object.keys(policy).sort().join(',') === fields.sort().join(',') && ['round-robin', 'adaptive', 'auto'].includes(policy.mode)
    && Number.isSafeInteger(policy.halfLifeMs) && policy.halfLifeMs > 0 && policy.halfLifeMs <= 10 * 365 * 24 * 60 * 60 * 1_000
    && Number.isFinite(policy.explorationConstant) && policy.explorationConstant > 0 && policy.explorationConstant <= 10
    && Number.isFinite(policy.seedDiscount) && policy.seedDiscount > 0 && policy.seedDiscount <= 1
    && Number.isSafeInteger(policy.minSamplesForAdaptive) && policy.minSamplesForAdaptive > 0 && policy.minSamplesForAdaptive <= 1_000_000
    && Number.isFinite(policy.defaultPriorSuccessRate) && policy.defaultPriorSuccessRate > 0 && policy.defaultPriorSuccessRate < 1;
}
function validRepresentationPolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)
    || Object.keys(policy).sort().join(',') !== [...REPRESENTATION_POLICY_FIELDS].sort().join(',')
    || policy.schemaVersion !== 1 || !/^[A-Za-z0-9._:-]{1,256}$/.test(policy.repoId ?? '')) return false;
  const numeric = REPRESENTATION_POLICY_FIELDS.filter((field) => !['repoId', 'schemaVersion'].includes(field));
  if (numeric.some((field) => !Number.isSafeInteger(policy[field]) || policy[field] <= 0)) return false;
  return policy.maxArgumentBytes <= 16 * 1024 * 1024 && policy.maxSourceRefs <= 256 && policy.maxSourceRefBytes <= 16 * 1024 * 1024
    && policy.maxEvidenceRefs <= 100_000 && policy.maxReceiptBytes <= 16 * 1024 * 1024
    && policy.maxGraphBatchBytes <= 16 * 1024 * 1024 && policy.maxResultItems <= 1024
    && policy.maxResultRefs <= 256 && policy.maxResultBytes <= 16 * 1024 * 1024;
}
function validResultSha(value) { return typeof value === 'string' && /^[a-f0-9]{40,64}$/u.test(value); }
function retainedResultRef(sha) { return `refs/baton/results/${sha}`; }

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
/** bindingDigest = H(scope, name, bindingVersion, state, cellId), hub-recomputed (Part A rule 1). */

// Issue #33 — typed task-horizon scratchpad bounds. These are deployment constants, not
// caller policy, so live admission and replay use the same ceilings.
// The closed top-level field set (D1); the same sorted set the schema table keys.
const BRIEFING_TOP_LEVEL_FIELDS = Object.freeze([
  'blockedOn', 'composedAtEventSeq', 'family', 'landings', 'lanes',
  'parked', 'rings', 'schemaVersion', 'sources', 'standingLaws',
]);
// The orchestrator-briefing family constant (D3's family-scoped authority rule). Exported so the
// application and northbound surfaces share ONE family name with the store that mints it (D7).
/** The DOCUMENTED DEFAULT partition admission bounds (#286 G-41): a worker's own partition and the
 * run's shared partition. They are the defaults of `scratchpadPartitionPolicy`, which the deployment
 * may raise — they are not ceilings of the store, and they are never applied on replay. */
export const MAX_SCRATCHPAD_WORKER_ENTRIES = 128;
export const MAX_SCRATCHPAD_SHARED_ENTRIES = 512;



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

export class CoordinationStore {
  constructor(root, opts = {}) {
    this.root = root;
    // KG-3 rule 3/17: process-local, LRU-bounded, KG-fence-keyed preview cache. Never serialized
    // into the checkpoint (absent from PROJECTION_CHECKPOINT_FIELDS) — a preview is a pure function
    // of (projectFence, query, previewPolicy) and projectFence is derived from folded history, so
    // replay reconstructs the identical projection with no persisted cache.
    this._previewCache = new Map();
    this.file = join(root, 'events.jsonl');
    this._checkpointFile = join(root, PROJECTION_CHECKPOINT);
    this._startupProgress = opts.startupProgress ?? null;
    if (this._startupProgress !== null && typeof this._startupProgress !== 'function') {
      throw new TypeError('startupProgress must be a function');
    }
    this._checkpointInterval = opts.checkpointInterval ?? 256;
    if (!Number.isSafeInteger(this._checkpointInterval) || this._checkpointInterval < 16
      || this._checkpointInterval > 100_000) {
      throw new TypeError('checkpointInterval is invalid');
    }
    this._startupState = null;
    this._checkpointWriteFailure = null;
    // Issue #351: what the last clean release did with the projection checkpoint, and why. A
    // lifecycle path reports the skip instead of paying an unbounded main-thread serialization.
    this._checkpointRelease = null;
    // Issue #449: the open's own checkpoint facts — the rewrite it performed after a stale-shape
    // replay, and the temp files it swept. Both are reported through `startupStatus()`
    // non-enumerably, like #397's reason/detail, so the pinned enumerable shape stays exact.
    this._checkpointRewrite = null;
    this._checkpointSweep = null;
    // Issue #351: the resident's stop outcome, armed by the deployment that owns the stop and
    // minted by the release itself — see armHostStopOutcome.
    this._hostStopOutcome = null;
    this._canonicalOrderReceiptFile = join(root, CANONICAL_ORDER_RECEIPT);
    this._clock = opts.clock ?? (() => new Date().toISOString());
    if (opts.appendFile !== undefined && typeof opts.appendFile !== 'function') throw new TypeError('appendFile must be a function');
    this._appendFile = opts.appendFile ?? appendFileSync;
    // Issue #290: the ledger group-commit seam (default: one fsync of the ledger file per drain
    // tick), plus the sync's own state — a failed sync leaves the tail durable-unconfirmed and
    // the store refuses further writes until a restart re-verifies the bytes.
    if (opts.syncFile !== undefined && typeof opts.syncFile !== 'function') throw new TypeError('syncFile must be a function');
    this._syncFile = opts.syncFile ?? defaultLedgerSync;
    this._ledgerSyncScheduled = false;
    this._ledgerSyncFailure = null;
    this._appendWaiters = new Set();
    // Issue #483: this incarnation's own departure — the ONE fact a bounded wait torn down by a
    // stop or a reincarnation handoff needs. Folded from the deployment's own `host.*` rows on the
    // LIVE path only (a row replayed at open belongs to an incarnation that is already gone), and
    // deliberately NOT a projection-checkpoint field: it describes the process serving this store
    // NOW, so a checkpoint (cache of a replay) can never carry it into the next one.
    this._incarnationDeparture = null;
    this._incarnationHandoff = null;
    if (Object.hasOwn(opts, 'canonicalOrderMigration')) {
      throw new TypeError('canonical order migration is offline-only; use migrateCanonicalOrderLedger()');
    }
    this._canonicalOrderPolicy = opts.canonicalOrderPolicy === undefined
      ? null : normalizeCanonicalOrderPolicy(opts.canonicalOrderPolicy);
    this._canonicalOrderMigration = opts[CANONICAL_ORDER_MIGRATION] === undefined
      ? null : normalizeCanonicalOrderMigration(opts[CANONICAL_ORDER_MIGRATION], this._canonicalOrderPolicy);
    this._canonicalOrderReceipt = null;
    mkdirSync(root, { recursive: true });
    this._advisoryFeedCards = this._configureAdvisoryFeedCards(opts.advisoryFeedCards ?? []);
    this._advisoryReceiptReverify = opts.advisoryReceiptReverify ?? null;
    this._advisoryPollReverify = opts.advisoryPollReverify ?? null;
    this._providerAttemptPolicy = null;
    if (opts.providerAttemptPolicy !== undefined) {
      const policy = opts.providerAttemptPolicy; const fields = ['intervalMs', 'maxBatch', 'maxAttempts', 'initialBackoffMs', 'maxBackoffMs', 'maxStateRows'];
      if (!policy || Object.keys(policy).sort().join(',') !== fields.sort().join(',') || Object.values(policy).some((value) => !Number.isSafeInteger(value) || value <= 0)
        || policy.initialBackoffMs > policy.maxBackoffMs || policy.intervalMs > 24 * 60 * 60 * 1_000 || policy.maxBatch > 10_000 || policy.maxBatch > policy.maxStateRows || policy.maxAttempts > 1_000_000 || policy.maxBackoffMs > 24 * 60 * 60 * 1_000 || policy.maxStateRows > 1_000_000) throw new TypeError('provider attempt policy is invalid');
      this._providerAttemptPolicy = freeze(clone(policy));
    }
    // #286 G-41: the scratchpad partition ceilings are the deployment's own admitted bound, not a
    // bare literal — set `scratchpadPartitionPolicy` to raise them. The defaults are the documented
    // values (128 worker / 512 shared); they are ADMISSION bounds only, never replay validation, so
    // changing them cannot make an existing ledger unloadable.
    this._scratchpadPartitionPolicy = freeze({
      workerEntries: MAX_SCRATCHPAD_WORKER_ENTRIES, sharedEntries: MAX_SCRATCHPAD_SHARED_ENTRIES,
    });
    if (opts.scratchpadPartitionPolicy !== undefined) {
      const policy = opts.scratchpadPartitionPolicy;
      const fields = ['sharedEntries', 'workerEntries'];
      if (!policy || Object.keys(policy).sort().join(',') !== fields.join(',')
        || !Number.isSafeInteger(policy.workerEntries) || policy.workerEntries <= 0
        || !Number.isSafeInteger(policy.sharedEntries) || policy.sharedEntries <= 0) {
        throw new TypeError('scratchpad partition policy is invalid');
      }
      this._scratchpadPartitionPolicy = freeze(clone(policy));
    }
    this._routePolicy = null;
    if (opts.routePolicy !== undefined) {
      if (!validRoutePolicy(opts.routePolicy)) throw new TypeError('route learning policy is invalid');
      this._routePolicy = freeze(clone(opts.routePolicy));
    }
    this._representationPolicy = null;
    if (opts.representationPolicy !== undefined) {
      if (!validRepresentationPolicy(opts.representationPolicy)) throw new TypeError('representation policy is invalid');
      this._representationPolicy = freeze(clone(opts.representationPolicy));
    }
    this._goalPlanPolicy = null;
    if (opts.goalPlanPolicy !== undefined) {
      try { this._goalPlanPolicy = freeze(clone(normalizeGoalPlanPolicy(opts.goalPlanPolicy))); }
      catch (error) { throw new TypeError(error?.message ?? 'goal/plan policy is invalid'); }
    }
    try { this._workflowPolicy = normalizeWorkflowPolicy(opts.workflowPolicy); }
    catch (error) { throw new TypeError(error?.message ?? 'Workflow policy is invalid'); }
    this._contextProgramPolicy = null;
    this._deploymentBaseSha = opts.deploymentBaseSha ?? null;
    this._contextEnvironmentDigest = opts.contextEnvironmentDigest ?? null;
    this._contextReferenceIdentity = opts.contextReferenceIdentity ?? null;
    this._contextReferenceRead = opts.contextReferenceRead ?? null;
    this._contextSourceAttest = opts.contextSourceAttest ?? null;
    this._contextArtifactVerificationStorage = new AsyncLocalStorage();
    if (opts.contextProgramPolicy !== undefined) {
      try { this._contextProgramPolicy = normalizeContextProgramPolicy(opts.contextProgramPolicy); }
      catch (error) { throw new TypeError(error?.message ?? 'Context Program policy is invalid'); }
      if (!/^[a-f0-9]{40}$/u.test(this._deploymentBaseSha ?? '')
        || !/^[a-f0-9]{64}$/u.test(this._contextEnvironmentDigest ?? '')
        || !/^[a-f0-9]{64}$/u.test(this._contextReferenceIdentity ?? '')
        || typeof this._contextReferenceRead !== 'function'
        || typeof this._contextSourceAttest !== 'function') {
        throw new TypeError('Context Program authority requires one deployment tree, environment, and artifact resolver identity');
      }
    } else if (opts.contextEnvironmentDigest !== undefined
      || opts.contextReferenceIdentity !== undefined || opts.contextReferenceRead !== undefined
      || opts.contextSourceAttest !== undefined) {
      throw new TypeError('Context Program dependencies require Context Program policy');
    }
    this._repoId = opts.repoId ?? this._goalPlanPolicy?.repoId ?? null;
    if (this._repoId !== null && !validRunId(this._repoId)) {
      throw new TypeError('coordination repository identity is invalid');
    }
    if (this._goalPlanPolicy && this._repoId !== this._goalPlanPolicy.repoId) {
      throw new TypeError('coordination repository identity differs from goal/plan authority');
    }
    // Epic #81 (O-2): per-attempt constructive ceilings on orientation receipts/proposals — the
    // flood control that replaces the v1 maxScanEvents scan ceiling (a scan bound, not a write
    // bound). Checked BEFORE append; no clock participates (campaign law).
    this._orientationReceiptCeilings = null;
    if (opts.orientationReceiptCeilings !== undefined) {
      const c = opts.orientationReceiptCeilings;
      if (!c || typeof c !== 'object' || Array.isArray(c)
        || !Number.isSafeInteger(c.maxReceiptsPerAttempt) || c.maxReceiptsPerAttempt <= 0
        || !Number.isSafeInteger(c.maxReceiptBytesPerAttempt) || c.maxReceiptBytesPerAttempt <= 0
        || !Number.isSafeInteger(c.maxProposalsPerAttempt) || c.maxProposalsPerAttempt <= 0) {
        throw new TypeError('orientation receipt ceilings are invalid');
      }
      this._orientationReceiptCeilings = freeze(clone(c));
    }
    this._taskTopologyPolicy = opts.taskTopologyPolicy === undefined
      ? null : normalizeTaskTopologyPolicy(opts.taskTopologyPolicy);
    this._runLineagePolicy = opts.runLineagePolicy === undefined
      ? null : normalizeRunLineagePolicy(opts.runLineagePolicy);
    if (this._runLineagePolicy && this._repoId === null) {
      throw Object.assign(new TypeError('run lineage authority requires one deployment repository'), {
        code: 'run_lineage_policy_invalid',
      });
    }
    this._checkpointAuthorityDigest = canonicalDigest({
      schemaVersion: 1,
      repoId: this._repoId,
      advisoryFeedCards: [...this._advisoryFeedCards.values()]
        .map(({ card, cardDigest }) => ({ card, cardDigest }))
        .sort((left, right) => compareCanonicalStrings(left.card.providerId, right.card.providerId)),
      advisoryReceiptReverify: typeof this._advisoryReceiptReverify === 'function',
      advisoryPollReverify: typeof this._advisoryPollReverify === 'function',
      providerAttemptPolicy: this._providerAttemptPolicy,
      canonicalOrderPolicy: this._canonicalOrderPolicy,
      routePolicy: this._routePolicy,
      representationPolicy: this._representationPolicy,
      goalPlanPolicy: this._goalPlanPolicy,
      workflowPolicy: this._workflowPolicy,
      contextProgramPolicy: this._contextProgramPolicy,
      taskTopologyPolicy: this._taskTopologyPolicy,
      runLineagePolicy: this._runLineagePolicy,
      deploymentBaseSha: this._deploymentBaseSha,
      contextEnvironmentDigest: this._contextEnvironmentDigest,
      contextReferenceIdentity: this._contextReferenceIdentity,
    });
    // Issue #449(2): this build's projection shape — the digest of the sorted field list the
    // checkpoint's payload carries. It rides every envelope the store writes beside the commit that
    // served the write, and the restore compares it before it judges any shape-specific invariant,
    // so a checkpoint another build wrote is provably STALE (replay + rewrite) instead of being
    // reported as corruption (repair). Derived from PROJECTION_CHECKPOINT_FIELDS, the ONE field
    // list the durable payload is composed from — never a second declaration of it.
    this._projectionShapeDigest = createHash('sha256')
      .update([...PROJECTION_CHECKPOINT_FIELDS].sort().join(',')).digest('hex');
    this._resetProjection();
    if (opts.operationalRangeRead !== undefined && typeof opts.operationalRangeRead !== 'function') throw new TypeError('operationalRangeRead must be a function');
    this._operationalRead = opts.operationalRead ?? null;
    this._operationalRangeRead = opts.operationalRangeRead ?? null;
    this._writerLease = null;
    this._writerLeaseRequired = false;
    // #223: the in-memory segment index ({archivedThroughSeq, segments[]} or null) — ledger
    // metadata, NOT projection state. It records how much of the history lives in archived
    // content-addressed segments so the checkpoint can cache the live window only.
    this._segmentIndex = null;
    // Issue #351 lane 2: the chunked-yielding open. `deferLoad` leaves the projection unloaded
    // at construction; `openCoordinationStoreAsync` then drives the SAME replay through
    // `_loadAsync`, which offers the event loop a breath between chunks. The default
    // constructor load is untouched — every existing caller constructs loaded.
    if (opts.deferLoad === true) {
      if (this._canonicalOrderPolicy) throw new TypeError('deferLoad is unavailable under a canonical-order policy');
      // Issue #351 lane 3: remembered so claimWriterLease can skip the digest re-verification
      // of a projection that does not exist yet — the async load folds under the held lease.
      this._deferredLoad = true;
      return;
    }
    if (opts.deferLoad !== undefined) throw new TypeError('deferLoad must be true when provided');
    if (this._canonicalOrderPolicy) this._openCanonicalOrderLedger();
    else this._load();
  }

  _canonicalOrderFail(message, code = 'canonical_order_integrity') { return coordinationLedger._canonicalOrderFail(message, code); }

  _readCanonicalLedger() { return coordinationLedger._readCanonicalLedger(this); }

  _canonicalPrefixEventDigest(events) { return coordinationLedger._canonicalPrefixEventDigest(this, events); }

  _canonicalReceiptCore(mode, ledger, createdAt, cutPolicy = this._canonicalOrderPolicy) { return coordinationLedger._canonicalReceiptCore(this, mode, ledger, createdAt, cutPolicy); }

  _receiptBytes(receipt) { return coordinationLedger._receiptBytes(receipt); }

  _validateCanonicalReceipt(receipt, bytes, ledger) {
    const fields = ['canonicalOrderVersion', 'createdAt', 'cutPolicy', 'mode', 'policy', 'prefixBytes', 'prefixDigest', 'prefixEventDigest', 'receiptDigest', 'schemaVersion', 'throughSeq'];
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
      || Object.keys(receipt).sort(compareCanonicalStrings).join(',') !== fields.sort(compareCanonicalStrings).join(',')) {
      this._canonicalOrderFail('canonical-order receipt has unknown or missing fields');
    }
    if (receipt.schemaVersion !== 1 || receipt.canonicalOrderVersion !== CANONICAL_ORDER_VERSION
      || !['empty_bootstrap', 'adopt_compatible'].includes(receipt.mode)
      || !Number.isSafeInteger(receipt.throughSeq) || receipt.throughSeq < 0
      || !Number.isSafeInteger(receipt.prefixBytes) || receipt.prefixBytes < 0
      || !/^[a-f0-9]{64}$/.test(receipt.prefixDigest ?? '')
      || !/^[a-f0-9]{64}$/.test(receipt.prefixEventDigest ?? '')
      || !/^[a-f0-9]{64}$/.test(receipt.receiptDigest ?? '')
      || !Number.isFinite(Date.parse(receipt.createdAt)) || new Date(Date.parse(receipt.createdAt)).toISOString() !== receipt.createdAt) {
      this._canonicalOrderFail('canonical-order receipt is malformed or from an unsupported version');
    }
    let receiptPolicy; let cutPolicy;
    try { receiptPolicy = normalizeCanonicalOrderPolicy(receipt.policy); cutPolicy = normalizeCanonicalOrderPolicy(receipt.cutPolicy); }
    catch { this._canonicalOrderFail('canonical-order receipt policy is malformed'); }
    if (canonicalDigest(receiptPolicy) !== canonicalDigest(this._canonicalOrderPolicy)) this._canonicalOrderFail('canonical-order receipt policy differs from deployment authority');
    if (Object.keys(cutPolicy).some((key) => cutPolicy[key] > receiptPolicy[key])) this._canonicalOrderFail('canonical-order receipt cut exceeds deployment authority');
    const core = Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== 'receiptDigest'));
    if (receipt.receiptDigest !== sha256Bytes(Buffer.from(JSON.stringify(canonicalJson(core, { maxDepth: 16, maxNodes: 128 })), 'utf8'))) {
      this._canonicalOrderFail('canonical-order receipt digest is invalid');
    }
    const canonicalBytesValue = this._receiptBytes(receipt);
    if (bytes.byteLength > this._canonicalOrderPolicy.maxReceiptBytes || !bytes.equals(canonicalBytesValue)) {
      this._canonicalOrderFail('canonical-order receipt bytes are non-canonical or oversized');
    }
    if (receipt.throughSeq > ledger.events.length) this._canonicalOrderFail('canonical-order receipt names a missing prefix');
    const prefixBytes = receipt.throughSeq === 0 ? 0 : ledger.offsets[receipt.throughSeq - 1];
    const prefix = ledger.raw.subarray(0, prefixBytes);
    if (receipt.prefixBytes !== prefixBytes || receipt.prefixDigest !== sha256Bytes(prefix)
      || receipt.prefixEventDigest !== this._canonicalPrefixEventDigest(ledger.events.slice(0, receipt.throughSeq))) {
      this._canonicalOrderFail('canonical-order pinned prefix diverged');
    }
    if ((receipt.mode === 'empty_bootstrap') !== (receipt.throughSeq === 0)) this._canonicalOrderFail('canonical-order receipt mode conflicts with its prefix');
    return freeze(clone(receipt));
  }
  _readCanonicalReceipt(ledger = this._readCanonicalLedger()) {
    return coordinationReplay._readCanonicalReceipt(this, ledger);
  }
  _openCanonicalOrderLedger() {
    return coordinationReplay._openCanonicalOrderLedger(this);
  }

  _cleanupCanonicalOrderTemps() {
    this._assertWriterLease();
    for (const name of readdirSync(this.root).filter((entry) => entry.startsWith(CANONICAL_ORDER_TEMP_PREFIX))) {
      try { unlinkSync(join(this.root, name)); } catch { this._canonicalOrderFail('canonical-order temporary receipt could not be removed'); }
    }
  }

  _writeCanonicalReceipt(mode, ledger, cutPolicy = this._canonicalOrderPolicy) {
    this._assertWriterLease();
    this._cleanupCanonicalOrderTemps();
    const createdAt = this._clock();
    if (!Number.isFinite(Date.parse(createdAt)) || new Date(Date.parse(createdAt)).toISOString() !== createdAt) this._canonicalOrderFail('canonical-order receipt clock is invalid');
    const core = this._canonicalReceiptCore(mode, ledger, createdAt, cutPolicy);
    const receipt = { ...core, receiptDigest: sha256Bytes(Buffer.from(JSON.stringify(canonicalJson(core, { maxDepth: 16, maxNodes: 128 })), 'utf8')) };
    const bytes = this._receiptBytes(receipt);
    if (bytes.byteLength > this._canonicalOrderPolicy.maxReceiptBytes) this._canonicalOrderFail('canonical-order receipt exceeds its byte ceiling');
    const temp = join(this.root, `${CANONICAL_ORDER_TEMP_PREFIX}${randomUUID()}`);
    let fd = null;
    try {
      fd = openSync(temp, 'wx', 0o600); writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = null;
      renameSync(temp, this._canonicalOrderReceiptFile); chmodSync(this._canonicalOrderReceiptFile, 0o600);
      try { const rootFd = openSync(this.root, 'r'); try { fsyncSync(rootFd); } finally { closeSync(rootFd); } } catch { /* directory fsync is not supported on every host */ }
    } catch (error) {
      if (fd !== null) try { closeSync(fd); } catch { /* best effort after failed receipt write */ }
      try { unlinkSync(temp); } catch { /* rename may already have committed */ }
      throw error;
    }
    this._canonicalOrderReceipt = this._readCanonicalReceipt(ledger);
    return clone(this._canonicalOrderReceipt);
  }
  _ensureCanonicalOrderReceipt() {
    return coordinationReplay._ensureCanonicalOrderReceipt(this);
  }

  canonicalOrderReceipt() { return coordinationLedger.canonicalOrderReceipt(this._canonicalOrderReceipt); }
  _reportStartup(value) {
    return coordinationReplay._reportStartup(this, value);
  }
  startupStatus() {
    return coordinationReplay.startupStatus(this);
  }

  _projectionCheckpointPayload() { return coordinationLedger._projectionCheckpointPayload(this); }

  /** Issue #465(2): the swarm family AS THE PROJECTION CARRIES IT — a participant row's composed
   * brief is referenced instead of copied. The reference is the fold's OWN (`briefBytes` +
   * `briefRef {kind, seq}`, the `participantBriefReach` derivation minted at the join (#464 third half) and carried
   * through every later re-mint): the body renders `brief: null` where the row names the row that
   * holds the text, and derives nothing of its own — ONE derivation, so the checkpoint and the
   * view cannot disagree about where a brief lives.
   *
   * The store's own fold rows are untouched — the live view still renders the whole text — and this
   * is the body's rendering of the same row. Issue #465(4) makes the body the STATE the next open
   * installs, so the rendering is reversible: `_materializedProjectionCheckpoint` puts the whole
   * `brief` back from the row `briefRef` names (the `briefBytes`/`briefRef` pair is the fold's own
   * and stays on the row). A swarm whose rows carry no brief is passed through untouched (the
   * identity the write's own measurement then reports). */
  _boundedSwarmProjection(swarms) { return coordinationLedger._boundedSwarmProjection(swarms); }

  /** Issue #465(1)(3): the checkpoint body's SECOND-COPY families — a row whose text is
   * byte-identical to a ledger row's own field hands the text back to the row that holds it. Measured
   * on the clone's checkpoint, these are what the non-window families keep: `_webCommands`
   * 39 206 146 B, `_tasks` 12 141 185 B, `_plans` 12 071 920 B, `_goals` 11 971 429 B and `_spills`
   * 5 845 234 B of the 288 871 406-byte body — every byte of it text the `web.command_completed` /
   * `task.created` / `plan.version_proposed` / `goal.version_defined` / `spill.minted` row already
   * carries. The row keeps its identity (id, version, digest, the event seqs it was folded from, the
   * derived state) and the body carries `<field>: null`, `<field>Bytes` and `<field>Ref {kind, seq}`
   * — the pair the ONE reader resolves through.
   *
   * A `_spills` row carries its pair from the FOLD (every reader of a spill row is this store's own
   * accessor, so the fold hands the bytes back and `materializeSpill` composes them again). The
   * `_webCommands`, goal, plan and task rows are rendered HERE: the two web-command readers are
   * delegates into the extracted internals port whose bijection pin requires them to stay bare calls,
   * and consumers outside this store read the goal/plan/task rows whole (`coordination-replay.mjs`'s
   * `plan.nodes`, the application's goal/plan readers) — so the fold keeps those rows and the body
   * points at the ledger row.
   *
   * Rendering is memoized BY ROW IDENTITY for the duration of one payload: a family and its head map
   * are set from the SAME frozen row (the fold does `this._plans.set(key, frozen);
   * this._planHeads.set(headKey, frozen)`), so both families render to the one rendered row and the
   * body never pays for the text a second time — nor does it lose the alias. A row whose field is
   * absent, or whose seq is not the row's own event, is passed through untouched: the reference is
   * only minted where the pair it names is provable from the row itself. */
  _referencedSecondCopies(payload) {
    const memo = new Map();
    const rendered = (row, render) => {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) return row;
      const prior = memo.get(row);
      if (prior !== undefined) return prior;
      const next = render(row) ?? row;
      memo.set(row, next);
      return next;
    };
    const family = (rows, render) => {
      if (!(rows instanceof Map) || rows.size === 0) return rows;
      let changed = false;
      const out = new Map();
      for (const [key, row] of rows) {
        const next = rendered(row, render);
        if (next !== row) changed = true;
        out.set(key, next);
      }
      return changed ? out : rows;
    };
    /** A row whose OWN `<name>` field is byte-identical to a field of the ledger row `seqField`
     * names — the goal objective, the plan nodes, the task brief. */
    const own = (name, kind, seqField) => (row) => {
      const text = row[name];
      const seq = row[seqField];
      if (text === null || text === undefined || !Number.isSafeInteger(seq)) return row;
      return freeze({
        ...row,
        [name]: null,
        [`${name}Bytes`]: referencedBytes(text),
        [`${name}Ref`]: freeze({ kind, seq }),
      });
    };
    payload._goals = family(payload._goals, own('objective', 'goal.version_defined', 'definedEvent'));
    payload._goalHeads = family(payload._goalHeads, own('objective', 'goal.version_defined', 'definedEvent'));
    payload._plans = family(payload._plans, own('nodes', 'plan.version_proposed', 'proposedEvent'));
    payload._planHeads = family(payload._planHeads, own('nodes', 'plan.version_proposed', 'proposedEvent'));
    payload._tasks = family(payload._tasks, own('brief', 'task.created', 'createdEvent'));
    // #465(1): a completed web command's ANSWER body, inside the outcome the row keeps. Measured on
    // the clone, `_webCommands` was 39 206 146 B of the 288 871 406-byte body and the whole of it
    // was `outcome.body`; the request content is not a copy at all (the row carries `requestDigest`
    // and a `requestAxes` digest map — the ledger deliberately carries no request content), so the
    // answer body is the one thing to point at. The row keeps the OUTCOME a reader decides on
    // (`httpStatus`) and the pair names the terminal ledger row — the kind its own `status` was
    // minted from in the fold. An outcome with no body has nothing to reference and is passed on.
    payload._webCommands = family(payload._webCommands, (row) => {
      const outcome = row.outcome;
      const seq = row.completedEvent;
      if (outcome === null || typeof outcome !== 'object' || Array.isArray(outcome)
        || outcome.body === null || outcome.body === undefined || !Number.isSafeInteger(seq)) return row;
      const { body, ...head } = outcome;
      return freeze({
        ...row,
        outcome: freeze({
          ...head,
          body: null,
          bodyBytes: referencedBytes(body),
          bodyRef: freeze({
            kind: row.status === 'failed' ? 'web.command_failed' : 'web.command_completed', seq,
          }),
        }),
      });
    });
  }

  /** Issue #465: the ONE reader of a projection REFERENCE (`{kind, seq}`). It answers the value the
   * ledger row the pair names holds — a composed brief, a web command's response body, a spill's
   * bytes, a task brief, a goal's objective, a plan's nodes — read from `_events`, which carries the
   * FULL history (archived rows included; compaction only decides what the checkpoint caches), so a
   * reference resolves in O(1) and never needs a disk read. A pair that names an absent row, or a
   * row of another kind, resolves to null: a reference that cannot be read is absence, never a
   * guessed value. The kind's reader is the PROJECTION_REFERENCES row — never a second grammar. */
  _projectionReferenceValue(reference) { return coordinationLedger._projectionReferenceValue(this._events, reference); }

  /** Issue #465(4): the body's rendering, INVERTED — the family-by-family half of the open
   * (`coordination-replay.mjs` `_adoptProjectionCheckpoint` drives it). The checkpoint carries the
   * projection, so every reference the body minted (`_boundedSwarmProjection`,
   * `_referencedSecondCopies`) is resolved back through `_projectionReferenceValue` before the
   * families are installed as state: the store a checkpoint serves must answer exactly what a cold
   * replay answers, and a reader that read `task.brief`, a goal's `objective`, a plan's `nodes` or a
   * web command's `outcome.body` must find the text, not the pair.
   *
   * The marker is the pair the WRITE minted, not the pair the FOLD mints: a `_spills` row carries
   * `bodyRef` from the fold (its reader composes the bytes), so a row whose field is `null` and
   * whose pair has no `<field>Bytes` beside it is passed through untouched, and a participant row's
   * `briefBytes`/`briefRef` (the fold's own reach) stays on the row while only `brief` is put back.
   * Rendering is memoized BY ROW IDENTITY, exactly as the write's rendering is, so the alias a
   * family and its head map share survives: `_goalHeads` keeps naming the same row as `_goals`.
   *
   * A pair that does not resolve names text the ledger does not carry — the body and the ledger
   * disagree — so the caller abandons the adoption and folds the ledger instead (never a silent
   * absence, never a guessed value). */
  _materializedProjectionCheckpoint(payload, dictionaryFields) { return coordinationLedger._materializedProjectionCheckpoint(this, payload, dictionaryFields); }

  /** Issue #465(4): the swarm family's half of the inversion. Two facts the body cannot carry by
   * itself are put back:
   *   • a participant row's `brief` — rendered back from `briefRef`, whose `briefBytes`/`briefRef`
   *     pair is the FOLD's own reach and stays on the row (`keepPair`);
   *   • the swarm row's null-prototype DICTIONARIES — the fold builds them with an empty prototype so
   *     a key named `__proto__` is data rather than a prototype write, and `v8`'s round trip flattens
   *     every container to a plain object. The names are the writer's own reading of the body it
   *     persisted (`nullPrototypeFields` below, recorded on the envelope), so the restore re-creates
   *     exactly the dictionaries the fold had — never a hand-typed list of them. */
  _materializedSwarmProjection(swarms, render, dictionaryFields) { return coordinationLedger._materializedSwarmProjection(swarms, render, dictionaryFields); }


  /** Issue #449: the ONE writer of the projection checkpoint. It returns the bytes it MEASURED
   * (`bytes`), whether the checkpoint was written (`written`), and whether those bytes ARE a
   * measurement (`measured` — false only for a poisoned projection, which is refused before
   * anything is serialized) — the serialize is paid once and the exact bytes are reused for the
   * envelope, so no caller measures the same projection twice. `costBound` (bytes) is the declared
   * ceiling a housewriting caller judges the checkpoint's own cost against: the measurement is the
   * cost, so the ceiling is applied HERE, on the bytes the write would actually persist, and a
   * checkpoint past it is reported (never written) with its measured size. The operator's
   * `compact()` calls this with no ceiling — it is not housewriting. */
  _writeProjectionCheckpoint({ costBound = null } = {}) { return coordinationLedger._writeProjectionCheckpoint(this, { costBound }); }

  /** Issue #449: the checkpoint write as STEPS that yield between their bounded stretches — the same
   * seam the replay already hands the loop back on (`coordination-replay.mjs` `_loadRun` drives this
   * generator with `yield*`, so the async open yields a macrotask between the encode, the persist and
   * the fsync while the synchronous constructor drains it back-to-back). Without the seam an open on
   * a real ledger writes its cache as ONE synchronous stretch — measured at 665ms for a 58MB cache
   * over a 150 000-row ledger — which is the open-liveness law #351 lane 4 pinned (the loop must beat
   * through the open at any ledger size), and the reason a stop could never pay this write either.
   *
   * It returns the bytes it MEASURED (`bytes`), whether the checkpoint was written (`written`), and
   * whether those bytes ARE a measurement (`measured` — false only for a poisoned projection, which
   * is refused before anything is serialized) — the serialize is paid once and the exact bytes are
   * reused for the envelope, so no caller measures the same projection twice. `costBound` (bytes) is
   * the declared ceiling a housewriting caller judges the checkpoint's own cost against: the
   * measurement is the cost, so the ceiling is applied HERE, on the bytes the write would actually
   * persist, and a checkpoint past it is reported (never written) with its measured size. The
   * operator's `compact()` calls this with no ceiling — it is not housewriting. */
  *_projectionCheckpointWriteSteps({ costBound = null } = {}) {
    this._assertWriterLease();
    if (this._projectionPoison) return { written: false, bytes: 0, measured: false };
    // Each stretch below is a bounded step of its own — the ledger read and its digest, then each
    // `v8.serialize` (a large allocation on a real ledger), then the persist, then the durability
    // sync — so a caller that owns a loop never sees two of them in one stretch.
    const raw = existsSync(this.file) ? readFileSync(this.file) : Buffer.alloc(0);
    if (raw.byteLength > 0 && raw.at(-1) !== 0x0a) {
      throw new CoordinationIntegrityError('coordination stream has a truncated tail', 'truncated_tail');
    }
    if (!this._loadedLedgerIdentity
      || raw.byteLength !== this._loadedLedgerIdentity.bytes
      || sha256Bytes(raw) !== this._loadedLedgerIdentity.digest
      || this._events.length !== this._loadedLedgerIdentity.events) {
      throw new CoordinationIntegrityError(
        'coordination checkpoint refused because the ledger diverged from the loaded prefix',
        'coordination_checkpoint_ledger_drift',
      );
    }
    // The ledger is proven at the prefix the load folded; the encode that follows is its own step.
    yield;
    const payload = this._projectionCheckpointPayload();
    const projectionBytes = serialize(payload);
    // Issue #465(1): the byte breakdown is a READING of this one measurement — the same payload
    // object, put through the same `serialize` — never a second accounting that could disagree
    // with the ceiling above. Measured cost of the reading, on the clone's 288.87 MB projection
    // with 101 families: 0.26 s beside the 0.35 s the serialize itself costs. Issue #465(4): the two
    // families the body no longer carries are read off the store in O(1) (`_checkpointRebuiltFields`)
    // — the rows' own bytes are the ledger's, which is already in hand here.
    const windowCount = this._events.length - (this._segmentIndex?.archivedThroughSeq ?? 0);
    this._checkpointByteBreakdown = this._projectionByteBreakdown(payload, projectionBytes.byteLength, {
      rows: windowCount, bytes: raw.byteLength, keys: this._events.length,
    });
    if (costBound !== null && projectionBytes.byteLength > costBound) {
      return { written: false, bytes: projectionBytes.byteLength, measured: true };
    }
    yield;
    // Issue #465(4): `coversSeq` is the ABSOLUTE seq this checkpoint's projections cover — every row
    // on the ledger at write time (the ledger-divergence check above proves the store folded exactly
    // these), archived rows included. It is the claim the successor reads: rows 1..coversSeq are
    // rebuilt from the ledger and NOT folded, rows past it are folded. `prefixBytes` is the same
    // claim in bytes of the ledger file, which holds the window rows (rows past the archival cut).
    // `coversLineDigest` anchors the claim's LAST line — the #229 append-drift proof the parsed cache
    // used to carry, now one digest of the line itself instead of a copy of the row.
    const lastCoveredStart = raw.byteLength === 0 ? 0 : raw.lastIndexOf(0x0a, raw.byteLength - 2) + 1;
    const envelope = {
      schemaVersion: 1,
      authorityDigest: this._checkpointAuthorityDigest,
      // Issue #449(2): the writer's own projection shape and the commit it served. A checkpoint
      // another build wrote is then STALE (its carried projection belongs to a different field set),
      // which the open answers with a full replay and a rewrite — never with the word 'corrupt',
      // whose remedy is a repair. Recorded here so the distinction is provable, not inferred.
      projectionShapeDigest: this._projectionShapeDigest,
      servedCommit: this._deploymentBaseSha ?? null,
      coversSeq: this._events.length,
      // The last COMPLETE line of the ledger (its trailing newline is excluded): for an empty ledger
      // this is the empty digest, and the reader only judges it when the claim covers rows.
      coversLineDigest: sha256Bytes(raw.subarray(lastCoveredStart, raw.byteLength - 1)),
      // The swarm family's null-prototype dictionaries, read off the very body this envelope carries
      // (`nullPrototypeFields`): `v8`'s round trip cannot preserve a prototype, so the open needs the
      // names to put them back. Sorted, and empty for a body without that family.
      swarmDictionaryFields: nullPrototypeFields(payload._swarms),
      prefixBytes: raw.byteLength,
      prefixDigest: sha256Bytes(raw),
      projectionDigest: sha256Bytes(projectionBytes),
      projectionBytes,
    };
    const checkpointBytes = serialize(envelope);
    const temporary = join(this.root, `${PROJECTION_CHECKPOINT_TEMP_PREFIX}${randomUUID()}`);
    let fd = null;
    try {
      fd = openSync(temporary, 'wx', 0o600);
      // The bytes are in memory here: the persist and the durability sync that follows it are steps
      // of their own for a caller that owns a loop.
      yield;
      writeFileSync(fd, checkpointBytes);
      yield;
      fsyncSync(fd);
      closeSync(fd); fd = null;
      renameSync(temporary, this._checkpointFile);
      chmodSync(this._checkpointFile, 0o600);
      try {
        const rootFd = openSync(this.root, 'r');
        try { fsyncSync(rootFd); } finally { closeSync(rootFd); }
      } catch { /* directory fsync is unavailable on some supported hosts */ }
      this._checkpointWriteFailure = null;
      return { written: true, bytes: projectionBytes.byteLength, measured: true };
    } catch (error) {
      if (fd !== null) try { closeSync(fd); } catch { /* original write error wins */ }
      try { unlinkSync(temporary); } catch { /* rename or cleanup already completed */ }
      this._checkpointWriteFailure = freeze({
        code: typeof error?.code === 'string' ? error.code : 'checkpoint_write_failed',
      });
      throw Object.assign(new CoordinationRefusal(
        'coordination projection checkpoint could not be persisted',
        'coordination_checkpoint_write_failed',
      ), { cause: error });
    }
  }

  /** Issue #465(1): WHICH family the measured projection's bytes belong to. The write above judges
   * the checkpoint on ONE number — the serialized projection — and a reader of that number could
   * not see where it came from (the issue's own guess-list ran from briefs to tool rows while the
   * measured answer was the parsed window). This reads the SAME payload through the SAME
   * serializer, once per family, in the payload's own key order (never a hand-typed list of
   * families: it iterates the object it was handed), and reports three measured numbers:
   *
   *   `bytesByFamily[f]`       f's OWN serialization — what the family costs when it is the thing
   *                            being encoded (measured on the clone: `_events` 180.16 MB of the
   *                            288.87 MB projection, `_webCommands` 39.21 MB, `_swarms`
   *                            18.04 MB, `_byKey` 181.83 MB — the last one a TRAP the breakdown
   *                            exists to expose, see below);
   *   `projectionBaselineBytes` the framing the whole body pays for its own key set (the payload
   *                            with every family emptied — hundreds of bytes, not a share);
   *   `sharedBytes`            what the families' own serializations count MORE THAN ONCE. `v8`
   *                            encodes a repeated OBJECT as a back-reference, so a family that
   *                            re-references an earlier family's objects is nearly free in the
   *                            stream while its own serialization is not: `_planHeads`/`_goalHeads`
   *                            alias the plans and goals. The breakdown reports it rather than
   *                            hiding it, and the identity it closes on is exact:
   *
   *       Σ bytesByFamily + projectionBaselineBytes − sharedBytes === bytes
   *
   * Issue #465(4): the two families the body does NOT carry (`_events`, `_byKey`) are reported
   * beside that sum, never inside it — the identity above is the BODY's own accounting, and the
   * ledger it points at is not. `rebuiltFamilies` names what the successor rebuilds them from: the
   * rows and the durable bytes of the file that holds them (`_events`, read in O(1) — the write
   * already holds the ledger bytes, so no history is serialized to measure it) and the index's key
   * count with ZERO bytes of its own (`_byKey` indexes the very rows `_events` owns, so counting it
   * as bytes is the double count this row exists to refuse). Every row object is therefore
   * attributed exactly once. */
  _projectionByteBreakdown(payload, projectionBytes, rebuilt) { return coordinationLedger._projectionByteBreakdown(this, payload, projectionBytes, rebuilt); }

  /** Issue #465(1): the payload's own shape with every family EMPTIED — the key set and its
   * container headers, nothing else. Derived from the object it is handed (each family keeps its
   * own container kind), so the baseline moves with the projection's shape instead of a literal. */
  _emptyProjectionShape(payload) { return coordinationLedger._emptyProjectionShape(payload); }

  /** Issue #351/#449: a clean release writes the projection checkpoint while the checkpoint is
   * still a BOUNDED record. The checkpoint is housekeeping (#229: crash-recovery acceleration; the
   * ledger stays authoritative), but `_writeProjectionCheckpoint` pays `readFileSync` of the whole
   * ledger, two digests over it, and one `v8.serialize` of the ENTIRE projection — including the
   * parsed `_events` cache, a second copy of the same ledger — synchronously on the main thread. On
   * the stop path that cost is proportional to the projection (and to a live campaign's projection,
   * which is larger than the ledger it folds): a SIGTERM drain that must serve an operator's
   * deadline may not spend it re-encoding history nobody asked it to cache.
   *
   * The bound is DERIVED from the checkpoint's OWN cost (#449): the ceiling is the registry's row
   * `checkpoint.projection_bytes`, and the quantity judged against it is the serialized projection
   * measured at write time — never the ledger's row count, which is not the cache's cost. The
   * deferred append-path checkpoint and the operator's `compact()` write are untouched: neither is
   * a lifecycle path (`compact()` is not housewriting and keeps its unconditional write). */
  _releaseProjectionCheckpoint() { return coordinationLedger._releaseProjectionCheckpoint(this); }

  /** Issue #449: the one bound every HOUSEWRITING checkpoint obeys (#229's deferred append-path
   * write and #351's release write): housekeeping may only ever re-encode a checkpoint whose OWN
   * cost is bounded — the bytes of its serialized projection, against the registry's declared
   * ceiling for that quantity (`checkpoint.projection_bytes`; both ceilings that apply are named on
   * the outcome, and the row count is reported beside them).
   *
   * The ledger's bytes are EVIDENCE on the outcome (`ledgerBytes`), never the gate. The pre-#449
   * bound applied the wake-replay FRAME's row ceiling to the ledger's row count, and lane 1 replaced
   * that row count with the cost ceiling while keeping the window's ledger bytes as an O(1)
   * early-out — but the projection is not the ledger's size on either side of the ratio, so the
   * bigger the history the LESS likely the checkpoint: the live residents skipped every release on
   * the ledger's bytes alone, no stop could write a cache, and every restart replayed the whole
   * ledger (#449: 65 s of republish on the primary). A projection past the ceiling is skipped WITH
   * its measured size, and the open that follows writes the cache the next open needs
   * (`_openCheckpointRefresh`).
   *
   * The deferred path is the one caller on the resident's own loop, so it reuses the last
   * measurement while the window has only grown since it: a body already measured past the ceiling
   * is not serialized a second time to re-derive the same verdict (issue #465(4) removed the rows
   * from the body, so what grows it is the families a fold writes, not the ledger's row count — the
   * reuse is safe either way because it only ever DECLINES to measure: nothing is written on a
   * reused verdict, and the next release, which measures unconditionally, re-derives it). The
   * verdict is dropped with the projection it judged (`_resetProjection`) and is ignored whenever
   * the window has fallen under the row count it was taken at (#223's `compact()` trims the window). */
  _boundedCheckpointWrite(phase) { return coordinationLedger._boundedCheckpointWrite(this, phase); }

  /** Issue #449: the fields every checkpoint outcome names — the seq the carried projections cover
   * (`coversSeq`, issue #465(4): the absolute ledger seq rows 1..coversSeq the successor does NOT
   * fold), the WINDOW's row count, the ledger's own bytes (evidence on the row, never the gate), the
   * replay frame's row ceiling and the checkpoint's own cost ceiling in bytes. */
  _checkpointOutcomeFields() { return coordinationLedger._checkpointOutcomeFields(this); }

  /** Issue #465(1): the measured breakdown a checkpoint row carries — the three numbers
   * `_projectionByteBreakdown` read from the SAME serialize the cost ceiling judged, and the two
   * ledger families' rebuild facts. Reported on every outcome that reached a measurement (a write,
   * a skip past the ceiling, or the deferred path's reused verdict, whose row already names the row
   * count it was taken at). Empty before the first measurement of a projection, and empty on a
   * poisoned projection's row: nothing was encoded, so there is nothing to break down. */
  _checkpointByteFields() { return coordinationLedger._checkpointByteFields(this._checkpointByteBreakdown); }

  /** Issue #449: WHICH opens write the cache the next open needs — the store's own rule, and the
   * ONE checkpoint write that is NOT judged against the housewriting ceiling. An open reaches here
   * when it could not serve itself from the checkpoint on disk and has just folded the projection by
   * replaying: `absent` (there is no cache at all), `stale_shape` (the envelope was written by
   * another projection shape or commit), `stale_authority` (another authority digest — its carried
   * projection was folded under other cards and policies) and `stale_ledger` (issue #465(4): the
   * checkpoint claims rows the ledger does not hold) all replay the ledger and land here, so the NEXT
   * open is served by a cache that is this build's own. `valid` needs nothing, `corrupt` keeps its
   * landed remedy (#397: a repair, never a rewrite over the refused bytes), and an empty ledger has
   * nothing to cache.
   *
   * Its bound is the load that just completed: the open has already parsed and folded exactly these
   * rows, so the write is the same order of work behind a load that holds no stop's deadline — and it
   * is the only write that makes the NEXT open bounded, which is what #449's live proof asks for (a
   * restart after a landing replays once, not on every restart). The write's own stretches yield
   * through the SAME seam the replay does, so the open keeps beating (see
   * `_projectionCheckpointWriteSteps`); the row reports the measured bytes and `refreshed: true`, and
   * a failure costs the open nothing. Returns null when this open owes nothing. */
  *_openCheckpointRefresh(state) { return yield* coordinationLedger._openCheckpointRefresh(this, state); }

  /** Issue #449: give back the lease an open minted for its own housekeeping write. The file is
   * removed only while it still names THIS store's token, pid and process start — a lease another
   * writer claimed inside the window is never deleted — and `_writerLeaseRequired` returns to false,
   * so a later write claims rather than refuses: exactly the posture the open had before it wrote. */
  _dropBorrowedWriterLease() {
    const lease = this._writerLease;
    if (lease === null) return;
    try {
      const observed = JSON.parse(readFileSync(lease.path, 'utf8'));
      if (observed?.token === lease.token && observed?.pid === process.pid
        && (observed.pidStart === undefined || observed.pidStart === lease.pidStart)) unlinkSync(lease.path);
    } catch { /* an absent or replaced lease is not this open's to remove */ }
    this._writerLease = null;
    this._writerLeaseRequired = false;
  }

  /** Issue #449(3): a checkpoint write that dies mid-flight leaves its temp file behind — the
   * atomic rename never ran, and nothing ever removed it (the observed resident carried a 135 MB
   * `.projection.checkpoint.<uuid>` beside its live checkpoint from a crash a month earlier). The
   * open sweeps them and names what it swept: the writer lease makes the store the only author of
   * these names, so a temp file an open can see is one whose writer is gone. */
  _sweepProjectionCheckpointTemps() {
    const swept = [];
    for (const name of readdirSync(this.root).sort()) {
      if (!name.startsWith(PROJECTION_CHECKPOINT_TEMP_PREFIX)) continue;
      try { unlinkSync(join(this.root, name)); swept.push(name); }
      catch { /* a temp file another process holds is not this open's to remove */ }
    }
    return freeze(swept);
  }

  /** Issue #351: what the last clean release did with the projection checkpoint, and why. `null`
   * until a release has decided; the stop path records this row so a skipped cache is never a
   * silent one. */
  checkpointReleaseState() { return coordinationLedger.checkpointReleaseState(this._checkpointRelease); }

  /** Issue #351(2): arm the resident's stop outcome, which the RELEASE then mints.
   *
   * The release is a drain's last act and the writer authority it needs exists only until it
   * returns — so the outcome of a stop that CONVERGED cannot be written after the fact by the host
   * that observed it (`_assertWriterLease` refuses an append once the lease is dropped). The
   * release mints it instead, carrying the checkpoint decision it has just made, because a release
   * that returns IS the converged stop. Armed by the deployment that owns the stop; a store whose
   * release is not a resident's stop is never armed and writes only the checkpoint it always did.
   *
   * Issue #351's stage clock rides the same arming, but as a READER rather than a snapshot: the
   * stages that follow the arming — the fleet drain the release runs inside, the publication
   * withdrawal after it — are exactly the ones a slow stop has to name, so only the mint knows
   * when the timeline ended. Optional; a stop that marks no stage still writes its outcome. */
  armHostStopOutcome(fields) {
    const keys = ['actor', 'key', 'state'];
    const stages = fields?.stages ?? null;
    // Issue #450: the resources the stop released ({workerId, resource, how}) are read at the
    // mint the same way the stage timeline is — a reader the drain keeps current until the release.
    const released = fields?.released ?? null;
    // Issue #472: the workers the stop STOPPED WAITING ON ({workerId, attempt, alive}) are read at
    // the mint too, and minted BESIDE `released` — an abandoned worker is not a release and never
    // rides a release row.
    const abandoned = fields?.abandoned ?? null;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)
      || Object.keys(fields).sort().join('\0')
        !== [...keys, ...(stages === null ? [] : ['stages']), ...(released === null ? [] : ['released']),
          ...(abandoned === null ? [] : ['abandoned'])].sort().join('\0')
      || keys.some((name) => typeof fields[name] !== 'string' || fields[name].length === 0)
      || (stages !== null && typeof stages !== 'function')
      || (released !== null && typeof released !== 'function')
      || (abandoned !== null && typeof abandoned !== 'function')) {
      throw new TypeError('host stop outcome arming is invalid');
    }
    this._hostStopOutcome = freeze({ ...fields });
    return true;
  }

  _mintHostStopOutcome() { return coordinationLedger._mintHostStopOutcome(this); }

  _restoreProjectionCheckpoint(raw, base = 0) {
    return coordinationReplay._restoreProjectionCheckpoint(this, raw, base);
  }

  _resetProjection() { return coordinationLedger._resetProjection(this); }

  _configureAdvisoryFeedCards(cards) {
    if (!Array.isArray(cards)) throw new TypeError('advisory feed cards must be an array');
    const configured = new Map();
    for (const value of cards) {
      const card = clone(value); const cardDigest = card?.cardDigest; if (card && typeof card === 'object') delete card.cardDigest;
      if (!boundedText(card?.providerId, 128) || !/^[a-f0-9]{64}$/.test(cardDigest ?? '') || canonicalDigest(card) !== cardDigest || configured.has(card.providerId)) throw new TypeError('advisory feed card is invalid');
      configured.set(card.providerId, freeze({ card: freeze(card), cardDigest }));
    }
    return configured;
  }
  _reloadProjection() {
    return coordinationReplay._reloadProjection(this);
  }

  _ledgerMatchesLoadedProjection() { return coordinationLedger._ledgerMatchesLoadedProjection(this); }

  claimWriterLease() {
    if (this._writerLease) throw new CoordinationRefusal('coordination writer is already active', 'coordination_writer_busy');
    const path = join(this.root, 'writer.lease'); const token = randomUUID(); const claimToken = randomUUID(); const claimPath = join(this.root, `writer.claim.${claimToken}`);
    const pidStart = writerProcessStartIdentity(process.pid);
    if (!pidStart) throw new CoordinationRefusal('coordination writer process identity is unavailable', 'coordination_writer_identity_unavailable');
    const payload = { schemaVersion: 2, pid: process.pid, pidStart, token, acquiredAt: this._clock() };
    const claim = () => writeFileSync(path, `${JSON.stringify(payload)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    writeFileSync(claimPath, `${JSON.stringify({ schemaVersion: 2, pid: process.pid, pidStart, token: claimToken, acquiredAt: this._clock() })}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    try {
      const liveClaims = [];
      for (const name of readdirSync(this.root).filter((item) => item.startsWith('writer.claim.')).sort()) {
        const candidatePath = join(this.root, name); let candidate;
        try { candidate = JSON.parse(readFileSync(candidatePath, 'utf8')); } catch { throw new CoordinationRefusal('coordination writer claim is malformed', 'coordination_writer_busy'); }
        if (![1, 2].includes(candidate?.schemaVersion) || !Number.isSafeInteger(candidate.pid)
          || candidate.pid <= 0 || typeof candidate.token !== 'string'
          || (candidate.schemaVersion === 2 && (typeof candidate.pidStart !== 'string'
            || candidate.pidStart.length === 0 || Buffer.byteLength(candidate.pidStart) > 256))
          || name !== `writer.claim.${candidate.token}`) {
          throw new CoordinationRefusal('coordination writer claim is malformed', 'coordination_writer_busy');
        }
        const candidateState = writerOwnerState(candidate);
        if (candidateState === 'stale') { unlinkSync(candidatePath); continue; }
        if (candidateState === 'unknown') throw new CoordinationRefusal('coordination writer claim ownership is ambiguous', 'coordination_writer_busy');
        liveClaims.push(name);
      }
      // A claim is intentionally a short fail-closed exclusion window, not an election.
      // If two claimants overlap, both may retry after their unique claims are removed; neither
      // may infer that lexicographic ordering grants authority over an already-live claimant.
      if (liveClaims.some((name) => name !== `writer.claim.${claimToken}`)) throw new CoordinationRefusal('coordination writer claim is already active', 'coordination_writer_busy');
      if (existsSync(path)) {
        let prior; try { prior = JSON.parse(readFileSync(path, 'utf8')); } catch { throw new CoordinationRefusal('coordination writer lease is malformed', 'coordination_writer_busy'); }
        const priorState = writerOwnerState(prior);
        if (priorState !== 'stale') throw new CoordinationRefusal(
          priorState === 'active' ? 'coordination writer is already active' : 'coordination writer ownership is ambiguous',
          'coordination_writer_busy');
        unlinkSync(path);
      }
      try { claim(); } catch (error) { if (error?.code === 'EEXIST') throw new CoordinationRefusal('coordination writer is already active', 'coordination_writer_busy'); throw error; }
    } finally {
      try { const observed = JSON.parse(readFileSync(claimPath, 'utf8')); if (observed?.token === claimToken) unlinkSync(claimPath); } catch { /* claim guard was already removed or replaced */ }
    }
    this._writerLease = freeze({ path, token, pid: process.pid, pidStart }); this._writerLeaseRequired = true;
    try {
      if (this._canonicalOrderPolicy) this._ensureCanonicalOrderReceipt();
      // Issue #351 lane 3: a deferred-load store folds its history later, under the lease this
      // call just claimed (the async open drives the same replay between chunks) — the digest
      // re-verification below applies only once a load has actually folded the ledger.
      if (!this._deferredLoad && !this._ledgerMatchesLoadedProjection()) this._reloadProjection();
    } catch (error) { this.releaseWriterLease(); throw error; }
    return clone(this._writerLease);
  }

  _assertWriterLease() {
    if (this._projectionPoison) {
      throw new CoordinationIntegrityError(
        `coordination projection is poisoned after durable seq ${this._projectionPoison.seq}; restart and replay are required`,
        'coordination_projection_poisoned',
      );
    }
    if (this._ledgerSyncFailure) {
      // Issue #290: the last group-commit failed, so the durable tail is unconfirmed — the
      // store refuses to hand out further durable authority until a restart re-reads and
      // re-verifies the ledger. Readers keep working; the ledger stays authoritative.
      throw new CoordinationIntegrityError(
        `coordination ledger durability is unconfirmed after a failed sync (${this._ledgerSyncFailure.code}); restart and replay are required`,
        'coordination_ledger_unsynced',
      );
    }
    this._assertLeaseOwnership();
  }

  /** Lease ownership only — deliberately WITHOUT the poison and sync-failure gates: the
   * quarantine verb (#290) is those gates' own repair and must stay reachable while they hold. */
  _assertLeaseOwnership() {
    const path = join(this.root, 'writer.lease');
    if (!this._writerLease) {
      if (this._writerLeaseRequired || existsSync(path)) throw new CoordinationRefusal('coordination writer authority is absent', 'coordination_writer_lost');
      this.claimWriterLease(); return;
    }
    let observed; try { observed = JSON.parse(readFileSync(path, 'utf8')); } catch { throw new CoordinationRefusal('coordination writer lease is absent or malformed', 'coordination_writer_lost'); }
    if (observed?.token !== this._writerLease.token || observed?.pid !== this._writerLease.pid
      || (observed.pidStart !== undefined && observed.pidStart !== this._writerLease.pidStart)) {
      throw new CoordinationRefusal('coordination writer lease was replaced', 'coordination_writer_lost');
    }
  }

  /** Issue #290: schedule the ledger's group-commit — one fsync per drain tick coalesces any
   * number of appends, keeping the authoritative ledger at least as durable as the fsynced
   * housekeeping artifacts. The accepted residual window (appends since the last drain) is
   * documented beside replay's truncated_tail refusal. */
  _scheduleLedgerSync() { return coordinationLedger._scheduleLedgerSync(this); }

  _flushLedgerSync() { return coordinationLedger._flushLedgerSync(this); }

  /** Issue #290: the poison is startup truth — readable beside the projection it contradicts. */
  projectionPoison() { return coordinationLedger.projectionPoison(this._projectionPoison); }

  /** Issue #290: the durable repair ledger, readable through the store like every other
   * housekeeping artifact. */
  quarantineEntries() {
    return coordinationReplay.quarantineEntries(this.root);
  }

  /** Issue #290: the supported repair verb for a poisoned store. Names the offending seq (the
   * poison itself names it — a mismatch refuses typed), records the quarantine durably beside
   * the ledger (never a hand edit of events.jsonl), clears the poison, and resumes authority.
   * Replay skips exactly this seq's fold after any restart, so the repair survives. */
  quarantineProjectionEvent(seq, { reason, actor } = {}) { return coordinationLedger.quarantineProjectionEvent(this, seq, { reason, actor }); }

  _poisonProjection(event, error) { return coordinationLedger._poisonProjection(this, event, error); }

  releaseWriterLease(options = undefined) {
    if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(options).sort().join(',') !== 'requireOwned' || typeof options.requireOwned !== 'boolean')) {
      throw new TypeError('writer lease release options are invalid');
    }
    const requireOwned = options?.requireOwned === true;
    const lease = this._writerLease; if (!lease) return false;
    if (requireOwned) {
      let observed;
      try { observed = JSON.parse(readFileSync(lease.path, 'utf8')); }
      catch { throw new CoordinationRefusal('coordination writer lease is absent or malformed', 'coordination_writer_lost'); }
      if (observed?.token !== lease.token || observed?.pid !== lease.pid
        || (observed.pidStart !== undefined && observed.pidStart !== lease.pidStart)) {
        throw new CoordinationRefusal('coordination writer lease was replaced', 'coordination_writer_lost');
      }
      // Issue #290: a clean release flushes the pending group-commit first — the lease is never
      // dropped with an un-synced ledger tail behind it.
      if (this._ledgerSyncScheduled) {
        this._ledgerSyncScheduled = false;
        this._flushLedgerSync();
      }
      this._releaseProjectionCheckpoint();
      // #351: the resident's stop outcome, minted while the writer authority the row needs is still
      // held — the release IS the converged stop, and the checkpoint decision travels with it.
      this._mintHostStopOutcome();
      try { unlinkSync(lease.path); }
      catch { throw new CoordinationRefusal('coordination writer lease could not be released', 'coordination_writer_lost'); }
      if (existsSync(lease.path)) throw new CoordinationRefusal('coordination writer lease release was not exact', 'coordination_writer_lost');
      this._writerLease = null; return true;
    }
    // Issue #290: the same flush on the non-owned release path.
    if (this._ledgerSyncScheduled) {
      this._ledgerSyncScheduled = false;
      this._flushLedgerSync();
    }
    this._releaseProjectionCheckpoint();
    try {
      const observed = JSON.parse(readFileSync(lease.path, 'utf8'));
      if (observed?.token === lease.token && observed?.pid === process.pid
        && (observed.pidStart === undefined || observed.pidStart === lease.pidStart)) unlinkSync(lease.path);
    }
    catch { /* absent or replaced lease is not ours to remove */ }
    this._writerLease = null; return true;
  }

  _segmentDirectory() { return coordinationLedger._segmentDirectory(this); }

  _segmentFilePath(digest) { return coordinationLedger._segmentFilePath(this, digest); }

  _cleanupSegmentTemps() {
    const dir = this._segmentDirectory();
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (!name.startsWith(SEGMENT_TEMP_PREFIX) && !name.startsWith(SEGMENT_INDEX_TEMP_PREFIX)) continue;
      try { unlinkSync(join(dir, name)); }
      catch { throw new CoordinationRefusal('coordination segment temporary could not be removed', 'coordination_segment_write_failed'); }
    }
  }

  _writeSegment(digest, bytes) {
    const dir = this._segmentDirectory();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = this._segmentFilePath(digest);
    // Content-addressed: the file name IS the sha256 of its exact bytes, so an existing
    // file under the same name is byte-identical and the write is idempotent.
    if (existsSync(path)) return path;
    const temporary = join(dir, `${SEGMENT_TEMP_PREFIX}${randomUUID()}`);
    let fd = null;
    try {
      fd = openSync(temporary, 'wx', 0o600);
      writeFileSync(fd, bytes);
      fsyncSync(fd);
      closeSync(fd); fd = null;
      renameSync(temporary, path);
      chmodSync(path, 0o600);
      try { const rootFd = openSync(dir, 'r'); try { fsyncSync(rootFd); } finally { closeSync(rootFd); } } catch { /* directory fsync is unavailable on some supported hosts */ }
    } catch (error) {
      if (fd !== null) try { closeSync(fd); } catch { /* original write error wins */ }
      try { unlinkSync(temporary); } catch { /* rename or cleanup already completed */ }
      throw error;
    }
    return path;
  }

  _writeSegmentIndex(index) {
    const dir = this._segmentDirectory();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const bytes = Buffer.from(`${JSON.stringify(index)}\n`, 'utf8');
    const temporary = join(dir, `${SEGMENT_INDEX_TEMP_PREFIX}${randomUUID()}`);
    let fd = null;
    try {
      fd = openSync(temporary, 'wx', 0o600);
      writeFileSync(fd, bytes);
      fsyncSync(fd);
      closeSync(fd); fd = null;
      renameSync(temporary, join(dir, SEGMENT_INDEX_FILE));
      chmodSync(join(dir, SEGMENT_INDEX_FILE), 0o600);
      try { const rootFd = openSync(dir, 'r'); try { fsyncSync(rootFd); } finally { closeSync(rootFd); } } catch { /* directory fsync is unavailable on some supported hosts */ }
    } catch (error) {
      if (fd !== null) try { closeSync(fd); } catch { /* original write error wins */ }
      try { unlinkSync(temporary); } catch { /* rename or cleanup already completed */ }
      throw error;
    }
  }

  // #223 replay path — load segments (index) + window. The index is a cache: the immutable
  // content-addressed segment files are the durable archive, so an absent or stale index is
  // rebuilt by scanning them. Returns { archivedThroughSeq, segments: [{fromSeq, throughSeq,
  // digest, bytes}] } — the archived prefix coverage the LEDGER's own coverage requires.
  _loadSegmentState(raw) {
    return coordinationReplay._loadSegmentState(this, raw);
  }

  // Issue #223 — the operator verb that lands the compaction seam. `beforeSeq` is the first
  // seq that stays LIVE; the terminal prefix [1, beforeSeq) is archived into a
  // content-addressed segment, the live events.jsonl is rewritten to the window, the
  // checkpoint is rebuilt for the window, and the segment index records the archive. The
  // in-memory projection is UNTOUCHED (it already spans the full history), so no waiter or
  // reader observes a discontinuity. Deciding which waves are terminal and picking the cut
  // is the cadence row's policy; this verb takes the operator's cut as given.
  //
  // Crash ordering (single writer, verb serialized by the writer lease): segment file →
  // segment index → ledger rewrite → checkpoint. The segment file lands before the ledger
  // truncates, so the archived events always exist on disk before the live window loses
  // them; an index write that committed without the ledger rewrite (or vice versa) is
  // reconciled by _loadSegmentState on the next open.
  compact({ beforeSeq }) {
    this._assertWriterLease();
    if (this._canonicalOrderPolicy) {
      throw new CoordinationRefusal('coordination compaction is refused while the ledger is canonical-order pinned', 'coordination_compact_refused');
    }
    if (!Number.isSafeInteger(beforeSeq) || beforeSeq < 2 || beforeSeq > this._events.length + 1) {
      throw new CoordinationRefusal('coordination compaction cut is outside the ledger', 'coordination_compact_invalid');
    }
    const prior = this._segmentIndex;
    const archivedThroughSeq = beforeSeq - 1;
    const startSeq = (prior?.archivedThroughSeq ?? 0) + 1;
    if (startSeq > archivedThroughSeq) return null; // the requested prefix is already archived
    const raw = existsSync(this.file) ? readFileSync(this.file) : Buffer.alloc(0);
    if (!this._loadedLedgerIdentity
      || raw.byteLength !== this._loadedLedgerIdentity.bytes
      || sha256Bytes(raw) !== this._loadedLedgerIdentity.digest
      || this._events.length !== this._loadedLedgerIdentity.events) {
      throw new CoordinationIntegrityError(
        'coordination compaction refused because the ledger diverged from the loaded prefix',
        'coordination_compact_ledger_drift',
      );
    }
    const text = raw.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(raw)) {
      throw new CoordinationIntegrityError('coordination stream is not exact UTF-8', 'invalid_utf8');
    }
    const lines = raw.byteLength === 0 ? [] : text.slice(0, -1).split('\n');
    const take = archivedThroughSeq - startSeq + 1;
    if (lines.length < take) {
      throw new CoordinationIntegrityError('coordination window is missing events at the compaction cut', 'coordination_compact_window_gap');
    }
    const archivedLines = lines.slice(0, take);
    const windowLines = lines.slice(take);
    let firstArchived; let firstWindow = null;
    try {
      firstArchived = JSON.parse(archivedLines[0]);
      if (windowLines.length > 0) firstWindow = JSON.parse(windowLines[0]);
    } catch {
      throw new CoordinationIntegrityError('coordination stream has invalid JSON at the compaction cut', 'invalid_json');
    }
    if (!Number.isSafeInteger(firstArchived?.seq) || firstArchived.seq !== startSeq
      || (firstWindow !== null && (!Number.isSafeInteger(firstWindow?.seq) || firstWindow.seq !== beforeSeq))) {
      throw new CoordinationIntegrityError('coordination compaction cut sequence is invalid', 'coordination_compact_cut_mismatch');
    }
    const segmentBytes = Buffer.from(`${archivedLines.join('\n')}\n`, 'utf8');
    const digest = sha256Bytes(segmentBytes);
    this._cleanupSegmentTemps();
    this._writeSegment(digest, segmentBytes);
    const next = {
      schemaVersion: 1,
      archivedThroughSeq,
      segments: [...(prior?.segments ?? []), { fromSeq: startSeq, throughSeq: archivedThroughSeq, digest, bytes: segmentBytes.byteLength }],
    };
    this._writeSegmentIndex(next);
    const windowBytes = Buffer.from(windowLines.length === 0 ? '' : `${windowLines.join('\n')}\n`, 'utf8');
    const temporary = join(this.root, `${LEDGER_TEMP_PREFIX}${randomUUID()}`);
    let fd = null;
    try {
      fd = openSync(temporary, 'wx', 0o600);
      writeFileSync(fd, windowBytes);
      fsyncSync(fd);
      closeSync(fd); fd = null;
      renameSync(temporary, this.file);
      chmodSync(this.file, 0o600);
      try { const rootFd = openSync(this.root, 'r'); try { fsyncSync(rootFd); } finally { closeSync(rootFd); } } catch { /* directory fsync is unavailable on some supported hosts */ }
    } catch (error) {
      if (fd !== null) try { closeSync(fd); } catch { /* original write error wins */ }
      try { unlinkSync(temporary); } catch { /* rename or cleanup already completed */ }
      throw error;
    }
    this._segmentIndex = next;
    // The ledger identity now tracks the LIVE WINDOW bytes (appends keep extending it); the
    // event count stays the full global history so seq allocation never regresses.
    this._loadedLedgerHash = createHash('sha256').update(windowBytes);
    this._loadedLedgerIdentity = freeze({
      bytes: windowBytes.byteLength,
      digest: this._loadedLedgerHash.copy().digest('hex'),
      events: this._events.length,
    });
    this._writeProjectionCheckpoint();
    return freeze({
      schemaVersion: 1, beforeSeq, archivedThroughSeq,
      windowEvents: this._events.length - archivedThroughSeq,
      segment: { fromSeq: startSeq, throughSeq: archivedThroughSeq, digest, bytes: segmentBytes.byteLength },
      segments: next.segments.length,
      ledgerBytes: windowBytes.byteLength,
    });
  }
  _load() {
    return coordinationReplay._load(this);
  }
  /** Issue #290: the prospective fold gate for the pass-through recording kinds. A payload the
   * replay fold would refuse is refused typed here — BEFORE _appendFile — so a malformed event
   * can never reach disk and poison replay. mcp.audit/web.audit own no fold state but still
   * require a plain-object payload (the audit GAP: these lanes accepted any shape); the
   * driver.recorded kinds the fold actively validates are checked with the fold's own rule. */
  _validateRecordedPayload(kind, payload) {
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

  _append(kind, payload, { actor, key }, fixedTs = null, beforeWrite = null) { return coordinationLedger._append(this, kind, payload, { actor, key }, fixedTs, beforeWrite); }

  _appendBatch(entries, batchKind = null, beforeWrite = null) { return coordinationLedger._appendBatch(this, entries, batchKind, beforeWrite); }

  _notifyAppend() { return coordinationLedger._notifyAppend(this); }
  _taskTopologyHint(event) {
    return coordinationInternals._taskTopologyHint(this, event);
  }

  _taskTopologyFailure(message, code, integrity) {
    throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code);
  }

  _validateTaskTopology(fields, hint = null, integrity = false) {
    if (!this._taskTopologyPolicy) return null;
    const fail = (message, code) => this._taskTopologyFailure(message, code, integrity);
    const relation = inferTaskTopologyRelation(fields, hint);
    if (!relation) fail('task refinement relation is missing or unsupported', 'task_topology_relation_invalid');
    const taskId = fields?.id;
    const runId = fields?.runId ?? null;
    if (typeof taskId !== 'string' || taskId.length === 0) fail('task topology identity is invalid', 'task_topology_invalid');
    if (this._taskTopologies.has(taskId)) fail('task topology identity already exists', 'duplicate_task');
    const sameRun = [...this._taskTopologies.values()].filter((node) => node.runId === runId);
    if (sameRun.length >= this._taskTopologyPolicy.maxTasksPerRun) {
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
    const parent = this._tasks.get(parentTaskId);
    const parentTopology = this._taskTopologies.get(parentTaskId);
    if (!parent || !parentTopology) fail('task refinement parent is unavailable', 'task_topology_parent_missing');
    if (parentTopology.ancestors.includes(taskId)) {
      fail('task refinement would create a lineage cycle', 'task_topology_cycle');
    }
    if ((parent.runId ?? null) !== runId || parentTopology.runId !== runId) {
      fail('task refinement parent belongs to a different Run', 'task_topology_run_mismatch');
    }
    const children = [...this._taskTopologies.values()].filter((node) => node.parentTaskId === parentTaskId);
    if (children.length >= this._taskTopologyPolicy.maxChildrenPerTask) {
      fail('task refinement reached the deployment parent fanout ceiling', 'task_topology_fanout_limit');
    }
    if (children.filter((node) => node.relation === relation).length
      >= this._taskTopologyPolicy.maxChildrenByRelation[relation]) {
      fail('task refinement reached its deployment relation fanout ceiling', 'task_topology_relation_limit');
    }
    const depth = parentTopology.depth + 1;
    if (depth > this._taskTopologyPolicy.maxDepth) {
      fail('task refinement reached the deployment lineage depth ceiling', 'task_topology_depth_limit');
    }
    return freeze({
      schemaVersion: 1, taskId, runId, relation, parentTaskId, depth,
      ancestors: [...parentTopology.ancestors, parentTaskId],
    });
  }

  previewTaskTopology(fields, hint = null) {
    const node = this._validateTaskTopology(fields, hint, false);
    return node === null ? null : clone(node);
  }

  taskTopologyPolicy() { return coordinationLedger.taskTopologyPolicy(this._taskTopologyPolicy); }
  repositoryId() {
    return coordinationInternals.repositoryId(this._repoId);
  }

  runLineagePolicy() { return coordinationLedger.runLineagePolicy(this._runLineagePolicy); }

  runLineagePolicyDigest() { return coordinationLedger.runLineagePolicyDigest(this._runLineagePolicy); }

  _runLineageFailure(message, code, integrity = false) {
    if (integrity) {
      const replayCode = code.startsWith('run_orchestrator_')
        ? 'run_orchestrator_lease_integrity' : 'run_lineage_integrity';
      throw new CoordinationIntegrityError(message, replayCode);
    }
    throw new CoordinationRefusal(message, code);
  }

  _normalizeRunOrchestratorLeaseRequest(fields, integrity = false) {
    const fail = (message) => this._runLineageFailure(message, 'run_orchestrator_lease_invalid', integrity);
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

  _deriveRunOrchestratorLeasePayload(request, event, integrity = false) {
    const fail = (message, code = 'run_orchestrator_lease_invalid') => this._runLineageFailure(message, code, integrity);
    if (!this._runLineagePolicy) fail('run lineage authority is not configured', 'run_lineage_policy_invalid');
    if (request.repoId !== this._repoId) {
      fail('run orchestrator repository differs from deployment authority', 'run_orchestrator_repository_mismatch');
    }
    const task = this._tasks.get(request.parentTask.id);
    if (!task || task.version !== request.parentTask.version) fail('run orchestrator parent task is stale', 'run_orchestrator_parent_stale');
    if (task.status !== 'working' || !validRunId(task.assignee) || !validRunId(task.runId)) {
      fail('run orchestrator parent task is inactive', 'run_orchestrator_parent_inactive');
    }
    if (!Array.isArray(task.brief?.capabilities) || !task.brief.capabilities.includes('baton_orchestrator')) {
      fail('run orchestrator capability is required', 'run_orchestrator_capability_required');
    }
    this._assertRunAdmissionOpen(task.runId, integrity);
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
      Date.parse(issuedAt) + this._runLineagePolicy.leaseTtlMs,
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
      policyDigest: canonicalDigest(this._runLineagePolicy),
      requestDigest: canonicalDigest(request),
    };
    return freeze({ ...core, leaseDigest: canonicalDigest(core) });
  }

  _validateRunOrchestratorLeaseIssued(payload, event, integrity = false) {
    const fail = (message, code = 'run_orchestrator_lease_invalid') => this._runLineageFailure(message, code, integrity);
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
    if (integrity && !this._runLineagePolicy) {
      const { leaseDigest, ...core } = payload;
      if (leaseDigest !== canonicalDigest(core)) fail('run orchestrator lease binding is invalid');
      if (event.idempotencyKey !== `run.orchestrator_lease:${payload.leaseId}`) fail('run orchestrator lease binding is invalid');
      return payload;
    }
    const request = this._normalizeRunOrchestratorLeaseRequest({
      schemaVersion: 1,
      repoId: payload.repoId,
      parentTask: { id: payload.parent?.taskId, version: payload.parent?.taskVersion },
      session: payload.session,
    }, integrity);
    const expected = this._deriveRunOrchestratorLeasePayload(request, event, integrity);
    if (canonicalDigest(payload) !== canonicalDigest(expected)
      || event.idempotencyKey !== `run.orchestrator_lease:${expected.leaseId}`
      || !boundedText(event.actor, 256)) fail('run orchestrator lease binding is invalid');
    return expected;
  }

  // The lease revocation idempotency key accepts either the recursive-lineage form
  // (`run.orchestrator_lease.revoke:<id>`) or the settlement-ritual form
  // (`run.orchestrator_lease_revoked:<id>`, rule 16b's revoke step) — the same leaseId is bound
  // either way, so the settlement promote command's revoke replays exactly like a manual revoke.
  _isRunOrchestratorLeaseRevokeKey(key, leaseId) {
    return key === `run.orchestrator_lease.revoke:${leaseId}`
      || key === `run.orchestrator_lease_revoked:${leaseId}`;
  }

  _validateRunOrchestratorLeaseRevoked(payload, event, integrity = false) {
    const fail = (message, code = 'run_orchestrator_lease_invalid') => this._runLineageFailure(message, code, integrity);
    const fields = ['leaseDigest', 'leaseId', 'reason', 'revocationDigest', 'schemaVersion'];
    if (!payload || Object.keys(payload).sort().join(',') !== fields.sort().join(',')
      || payload.schemaVersion !== 1 || !RUN_ORCHESTRATOR_REVOCATION_REASONS.includes(payload.reason)
      || !/^[a-f0-9]{64}$/.test(payload.leaseDigest ?? '')
      || !/^[a-f0-9]{64}$/.test(payload.revocationDigest ?? '')) fail('run orchestrator lease revocation is invalid');
    const lease = this._runOrchestratorLeases.get(payload.leaseId);
    if (!lease || lease.status !== 'active' || lease.leaseDigest !== payload.leaseDigest) {
      fail('run orchestrator lease revocation has no active authority', 'run_orchestrator_lease_not_found');
    }
    const { revocationDigest, ...core } = payload;
    if (revocationDigest !== canonicalDigest(core)
      || !this._isRunOrchestratorLeaseRevokeKey(event.idempotencyKey, payload.leaseId)
      || !boundedText(event.actor, 256)) fail('run orchestrator lease revocation binding is invalid');
    return lease;
  }

  _activeRunOrchestratorLease(auth, now = this._clock()) { return coordinationLedger._activeRunOrchestratorLease(this, auth, now); }
  _runIdentityHasEffects(runId, ignoredSeq = null) {
    return coordinationInternals._runIdentityHasEffects(this, runId, ignoredSeq);
  }

  _deriveRunLineagePayload(request, lease, ignoredSeq = null, integrity = false) {
    const fail = (message, code = 'run_lineage_invalid') => this._runLineageFailure(message, code, integrity);
    if (request.repoId !== lease.repoId) fail('run lineage repository differs from its lease', 'run_lineage_invalid');
    if (this._runIdentityHasEffects(request.childRunId, ignoredSeq)) fail('child Run identity already has effects', 'run_lineage_conflict');
    const parentLineage = this._runLineages.get(lease.parent.runId) ?? null;
    const rootRunId = parentLineage?.rootRunId ?? lease.parent.runId;
    const depth = (parentLineage?.depth ?? 0) + 1;
    const ancestors = parentLineage
      ? [...parentLineage.ancestors, lease.parent.runId] : [lease.parent.runId];
    if (ancestors.includes(request.childRunId)) fail('run lineage would create a cycle', 'run_lineage_cycle');
    if (depth > this._runLineagePolicy.maxDepth) fail('run lineage depth ceiling reached', 'run_lineage_depth');
    if (this.runChildren(lease.parent.runId).length >= this._runLineagePolicy.maxChildrenPerRun) {
      fail('run lineage child ceiling reached', 'run_lineage_children');
    }
    if (this.runDescendants(rootRunId).length >= this._runLineagePolicy.maxDescendantsPerRoot) {
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
        ? this._runLineageEventSeqs.get(parentLineage.childRunId) : null,
      lease: { id: lease.leaseId, digest: lease.leaseDigest, issuedEvent: lease.issuedEvent },
      intentDigest: request.intentDigest,
      policyDigest: canonicalDigest(this._runLineagePolicy),
      requestDigest: canonicalDigest({ ...request, orchestratorLeaseId: lease.leaseId }),
    };
    return freeze({ ...core, admissionDigest: canonicalDigest(core) });
  }

  _validateRunLineageAdmission(payload, event, integrity = false) {
    const fail = (message, code = 'run_lineage_invalid') => this._runLineageFailure(message, code, integrity);
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
    const lease = this._runOrchestratorLeases.get(payload.lease?.id);
    if (!lease || lease.status !== 'active' || lease.leaseDigest !== payload.lease?.digest
      || lease.issuedEvent !== payload.lease?.issuedEvent) fail('run lineage lease binding is invalid', 'run_orchestrator_lease_not_found');
    const request = freeze({
      schemaVersion: 1, repoId: payload.repoId,
      childRunId: payload.childRunId, intentDigest: payload.intentDigest,
    });
    const expected = this._deriveRunLineagePayload(request, lease, event.seq, integrity);
    if (canonicalDigest(payload) !== canonicalDigest(expected)
      || event.idempotencyKey !== `run.lineage:${payload.childRunId}`
      || !boundedText(event.actor, 256)) fail('run lineage admission binding is invalid');
    return expected;
  }

  issueRunOrchestratorLease(fields, auth) { return coordinationLedger.issueRunOrchestratorLease(this, fields, auth); }

  revokeRunOrchestratorLease(fields, auth) {
    const expected = ['leaseDigest', 'leaseId', 'reason', 'schemaVersion'];
    if (!fields || Object.keys(fields).sort().join(',') !== expected.sort().join(',')
      || fields.schemaVersion !== 1 || !boundedText(fields.leaseId, 512)
      || !/^[a-f0-9]{64}$/.test(fields.leaseDigest ?? '')
      || !RUN_ORCHESTRATOR_REVOCATION_REASONS.includes(fields.reason)
      || !this._isRunOrchestratorLeaseRevokeKey(auth?.key, fields.leaseId)
      || !boundedText(auth?.actor, 256)) {
      this._runLineageFailure('run orchestrator lease revocation request is invalid', 'run_orchestrator_lease_invalid');
    }
    const core = clone(fields);
    const payload = freeze({ ...core, revocationDigest: canonicalDigest(core) });
    const prior = this._byKey.get(auth.key);
    if (prior) {
      if (prior.kind !== 'run.orchestrator_lease_revoked' || prior.actor !== auth.actor
        || canonicalDigest(prior.payload) !== canonicalDigest(payload)) {
        this._runLineageFailure('run orchestrator lease revocation conflict', 'run_orchestrator_lease_conflict');
      }
      return freeze({ ok: true, result: 'replay', event: clone(prior), lease: this.runOrchestratorLease(fields.leaseId) });
    }
    const preview = { seq: this._events.length + 1, actor: auth.actor, idempotencyKey: auth.key, payload };
    this._validateRunOrchestratorLeaseRevoked(payload, preview);
    const event = this._append('run.orchestrator_lease_revoked', payload, auth);
    return freeze({ ok: true, result: 'revoked', event: clone(event), lease: this.runOrchestratorLease(fields.leaseId) });
  }
  runOrchestratorLease(leaseId) {
    return coordinationInternals.runOrchestratorLease(this._runOrchestratorLeases, leaseId);
  }

  activeRunOrchestratorLeaseForSession(fields) { return coordinationLedger.activeRunOrchestratorLeaseForSession(this, fields); }

  admitRunLineage(fields, auth) {
    const expected = ['childRunId', 'intentDigest', 'repoId', 'schemaVersion'];
    if (!fields || Object.keys(fields).sort().join(',') !== expected.sort().join(',')
      || fields.schemaVersion !== 1 || !validRunId(fields.repoId) || !validRunId(fields.childRunId)
      || !/^[a-f0-9]{64}$/.test(fields.intentDigest ?? '') || !boundedText(auth?.actor, 256)
      || !boundedText(auth?.key, 512) || !boundedText(auth?.orchestratorLeaseId, 512)) {
      this._runLineageFailure('run lineage request is invalid', 'run_lineage_invalid');
    }
    const request = freeze(clone(fields));
    const prior = this._byKey.get(auth.key);
    if (prior) {
      const lease = this._runOrchestratorLeases.get(auth.orchestratorLeaseId);
      const sameSession = lease && auth.principalId === lease.session.principalId
        && auth.sessionId === lease.session.sessionId
        && auth.sessionAuthorityDigest === lease.session.authorityDigest;
      if (prior.kind !== 'run.lineage_admitted' || prior.actor !== auth.actor || !sameSession
        || prior.payload?.requestDigest !== canonicalDigest({ ...request, orchestratorLeaseId: auth.orchestratorLeaseId })) {
        this._runLineageFailure('run lineage idempotency conflict', 'run_lineage_conflict');
      }
      return freeze({ ok: true, result: 'replay', event: clone(prior), lineage: this.runLineage(prior.payload.childRunId) });
    }
    if (auth.key !== `run.lineage:${request.childRunId}`) {
      this._runLineageFailure('run lineage authority is invalid', 'run_lineage_invalid');
    }
    const lease = this._activeRunOrchestratorLease(auth);
    const payload = this._deriveRunLineagePayload(request, lease);
    const event = this._append('run.lineage_admitted', payload, auth);
    return freeze({ ok: true, result: 'admitted', event: clone(event), lineage: this.runLineage(request.childRunId) });
  }
  runLineage(runId) {
    return coordinationInternals.runLineage(this._runLineages, runId);
  }
  runChildren(runId) {
    return coordinationInternals.runChildren(this, runId);
  }
  runDescendants(runId) {
    return coordinationInternals.runDescendants(this._runLineages, runId);
  }

  authorizeRunOrchestratorCommand(fields, auth) {
    const expected = ['command', 'repoId', 'runId', 'schemaVersion'];
    if (!fields || Object.keys(fields).sort().join(',') !== expected.sort().join(',')
      || fields.schemaVersion !== 1 || !validRunId(fields.repoId) || !validRunId(fields.runId)
      || !boundedText(fields.command, 256)) {
      this._runLineageFailure('run orchestrator command is invalid', 'run_orchestrator_command_forbidden');
    }
    const lease = this._activeRunOrchestratorLease(auth);
    if (!RUN_ORCHESTRATOR_CAPABILITIES.includes(fields.command)) {
      this._runLineageFailure('run orchestrator command is forbidden', 'run_orchestrator_command_forbidden');
    }
    const target = this._runLineages.get(fields.runId);
    const ancestorIndex = target?.ancestors.indexOf(lease.parent.runId) ?? -1;
    const firstChildRunId = ancestorIndex < 0 ? null
      : (ancestorIndex + 1 < target.ancestors.length
        ? target.ancestors[ancestorIndex + 1] : target.childRunId);
    const firstLineage = firstChildRunId ? this._runLineages.get(firstChildRunId) : null;
    if (fields.repoId !== lease.repoId || !target || !firstLineage
      || firstLineage.parentRunId !== lease.parent.runId || firstLineage.lease.id !== lease.leaseId) {
      this._runLineageFailure('run orchestrator command is outside the lease subtree', 'run_orchestrator_scope_forbidden');
    }
    return freeze({
      ok: true, leaseId: lease.leaseId, command: fields.command,
      repoId: fields.repoId, runId: fields.runId,
    });
  }
  taskTopologyNode(taskId) {
    return coordinationInternals.taskTopologyNode(this._taskTopologies, taskId);
  }
  taskTopology(runId = null) {
    return coordinationInternals.taskTopology(this, runId);
  }
  _recoveryBatchIdentity(kind, events) {
    return coordinationReplay._recoveryBatchIdentity(kind, events);
  }
  _validateRecoveryReplayTransactions() {
    return coordinationReplay._validateRecoveryReplayTransactions(this);
  }

  _goalPlanFailure(message, code, integrity = false) {
    throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code);
  }

  _goalScopeKey(repoId, runId) { return coordinationLedger._goalScopeKey(repoId, runId); }
  _goalVersionKey(goalId, version) { return coordinationLedger._goalVersionKey(goalId, version); }
  _planVersionKey(planId, version) { return coordinationLedger._planVersionKey(planId, version); }
  _planHeadKey(goal) { return coordinationLedger._planHeadKey(goal); }
  _planNodeKey(planId, version, nodeKey) { return coordinationLedger._planNodeKey(planId, version, nodeKey); }
  _validateGoalPlanReplayTransactions() {
    return coordinationReplay._validateGoalPlanReplayTransactions(this);
  }

  _historicalTaskState(taskId, throughSeq) { return coordinationLedger._historicalTaskState(this._events, taskId, throughSeq); }

  _validPreservedResumeAttestation(value) {
    return coordinationReplay._validPreservedResumeAttestation(value);
  }

  _workflowRevisionAuthority(plan, node, throughSeq = this._events.length, integrity = false) { return coordinationLedger._workflowRevisionAuthority(this, plan, node, throughSeq, integrity); }

  _validateGoalPlanDispatchPair(dispatchEvent, taskEvent, integrity = false, recoveryClaimEvent = null) {
    return coordinationReplay._validateGoalPlanDispatchPair(this, dispatchEvent, taskEvent, integrity, recoveryClaimEvent);
  }
  _planRecoveryRequestFields(createdPayload) {
    return coordinationReplay._planRecoveryRequestFields(createdPayload);
  }
  _recoveryAttributionFromClaim(claimedPayload) {
    return coordinationReplay._recoveryAttributionFromClaim(claimedPayload);
  }
  _normalizedPlanRecoveryCreatedPayload(fields, priorTask) {
    return coordinationReplay._normalizedPlanRecoveryCreatedPayload(this, fields, priorTask);
  }

  _validateGoalPlanRecoveryTriple(dispatchEvent, createdEvent, claimedEvent, integrity = false) {
    return coordinationReplay._validateGoalPlanRecoveryTriple(this, dispatchEvent, createdEvent, claimedEvent, integrity);
  }
  _recoveryFailure(message, code, integrity) {
    return coordinationReplay._recoveryFailure(message, code, integrity);
  }
  _verifiedRecoveryPrior(task, integrity = false) {
    return coordinationReplay._verifiedRecoveryPrior(this, task, integrity);
  }
  _recoveryAttemptFailure(message, code, integrity = false) {
    return coordinationReplay._recoveryAttemptFailure(message, code, integrity);
  }
  _normalizeRecoveryAttemptAdmission(payload, integrity = false) {
    return coordinationReplay._normalizeRecoveryAttemptAdmission(this, payload, integrity);
  }
  _normalizeRecoveryAttemptCompletion(payload, integrity = false) {
    return coordinationReplay._normalizeRecoveryAttemptCompletion(this, payload, integrity);
  }

  _validateRecoveryAttemptAdmissionPayload(payload, event, integrity = false) {
    return coordinationReplay._validateRecoveryAttemptAdmissionPayload(this, payload, event, integrity);
  }
  _validateRecoveryAttemptCompletionPayload(payload, event, integrity = false) {
    return coordinationReplay._validateRecoveryAttemptCompletionPayload(this, payload, event, integrity);
  }
  _normalizedRecoveryCreatedPayload(fields, priorTask) {
    return coordinationReplay._normalizedRecoveryCreatedPayload(fields, priorTask);
  }
  _normalizedRecoveryClaimedPayload(createdPayload, attribution) {
    return coordinationReplay._normalizedRecoveryClaimedPayload(createdPayload, attribution);
  }

  _validateRecoverySessionRequest(sessionRequest, priorTask, fail) {
    return coordinationReplay._validateRecoverySessionRequest(sessionRequest, priorTask, fail);
  }

  _validateRecoveryRefinementRequest(fields, attribution, priorTask, integrity = false) {
    return coordinationReplay._validateRecoveryRefinementRequest(this, fields, attribution, priorTask, integrity);
  }
  _validateRecoveryRefinementPair(createdEvent, claimedEvent, integrity = false) {
    return coordinationReplay._validateRecoveryRefinementPair(this, createdEvent, claimedEvent, integrity);
  }

  _validateRecoveryContinuationPayload(p, event, integrity = false) {
    return coordinationReplay._validateRecoveryContinuationPayload(this, p, event, integrity);
  }
  _validateRecoveryDispositionPayload(p, event, integrity = false) {
    return coordinationReplay._validateRecoveryDispositionPayload(this, p, event, integrity);
  }

  _representationFailure(message, code = 'representation_integrity', integrity = false) {
    throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code);
  }

  _representationRequest(request, auth, integrity = false, requireLive = true) {
    const fail = (message, code = 'representation_invalid') => this._representationFailure(message, code, integrity);
    const idempotencyKey = auth?.key ?? auth?.idempotencyKey;
    if (!this._representationPolicy) fail('representation production is not deployment configured', 'representation_policy_unavailable');
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
    if (request.sourceArguments.bytes > this._representationPolicy.maxArgumentBytes) fail('representation arguments exceeded deployment ceiling', 'representation_oversize');
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
    if (request.repoId !== this._representationPolicy.repoId) fail('representation repository disagrees with deployment', 'representation_scope_mismatch');
    const task = this._tasks.get(request.taskId); const taskNode = this._knowledgeNodes.get(`task:${request.taskId}`);
    if (!task || !taskNode || task.createdEvent >= (auth.seq ?? this._events.length + 1)
      || (requireLive && !['working', 'input_required', 'paused'].includes(task.status))) fail('representation requires an exact live durable task', 'representation_task_unavailable');
    if ((task.runId ?? null) !== request.runId) fail('representation run membership disagrees with its task', 'representation_scope_mismatch');
    const policyDigest = canonicalDigest(this._representationPolicy);
    const requestDigest = canonicalDigest({ actor: auth.actor, idempotencyKey, request, policyDigest });
    return freeze({ request: clone(request), task, mapping, policyDigest, requestDigest, environmentDigest: canonicalDigest(environment) });
  }

  _representationEvidence(evidence, requestState, source, event, integrity = false) { return coordinationLedger._representationEvidence(this, evidence, requestState, source, event, integrity); }

  _representationSource(source, requestState, evidence, event, integrity = false) {
    const fail = (message, code = 'representation_invalid') => this._representationFailure(message, code, integrity);
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
    if (canonicalBytes(source.artifact) > this._representationPolicy.maxSourceRefBytes) fail('representation source reference exceeded deployment ceiling', 'representation_oversize');
    this._representationEvidence(evidence, requestState, source, event, integrity);
    return clone(source);
  }

  _representationArtifactManifest(id, expected, event, integrity = false) { return coordinationLedger._representationArtifactManifest(this, id, expected, event, integrity); }

  _representationGraphTemplate(fields, auth, integrity = false, requireLive = true) {
    const event = auth; const requestState = this._representationRequest(fields?.request, event, integrity, requireLive);
    const fail = (message, code = 'representation_invalid') => this._representationFailure(message, code, integrity);
    const fieldNames = ['evidence', 'request', 'requestDigest', 'source'];
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)
      || Object.keys(fields).sort().join(',') !== fieldNames.sort().join(',')
      || fields.requestDigest !== requestState.requestDigest) fail('representation production fields are open or request-bound incorrectly');
    const source = this._representationSource(fields.source, requestState, fields.evidence, event, integrity);
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
    if (receiptRef.bytes > this._representationPolicy.maxReceiptBytes) fail('representation receipt exceeded deployment ceiling', 'representation_oversize');
    const sourceArtifactId = `representation-source:${canonicalDigest({ repoId: fields.request.repoId, digest: source.artifact.digest })}`;
    const receiptArtifactId = `representation-receipt:${receiptDigest}`;
    const provenance = [clone(fields.evidence.invoke), clone(fields.evidence.reverify)];
    const newSourceArtifact = {
      id: sourceArtifactId, owner: { kind: 'representation-source', repoId: fields.request.repoId }, repoId: fields.request.repoId,
      kind: source.artifact.kind, mediaType: source.artifact.mediaType, digest: source.artifact.digest,
      bytes: source.artifact.bytes, refs: [clone(source.artifact)], accepted: true, provenance,
    };
    const sourceArtifact = this._representationArtifactManifest(sourceArtifactId, newSourceArtifact, event, integrity);
    const receiptArtifact = {
      id: receiptArtifactId, owner: { kind: 'representation', id: representationId }, repoId: fields.request.repoId,
      taskId: fields.request.taskId, kind: receiptRef.kind, mediaType: receiptRef.mediaType,
      digest: receiptRef.digest, bytes: receiptRef.bytes, refs: [{ artifactId: sourceArtifactId }], accepted: true, provenance,
    };
    const graphEvidence = [{ coordinationSeq: fields.evidence.invoke.coordinationSeq }, { coordinationSeq: fields.evidence.reverify.coordinationSeq }];
    const representationNode = this._knowledgePayload({
      id: representationId, type: 'Representation', grounding: 'derived', body: mapping.body,
      evidence: [...clone(graphEvidence), { artifactId: receiptArtifactId }],
      promotion: { kind: 'Representation', trigger: 'representation.produce' }, repoId: fields.request.repoId,
      taskId: fields.request.taskId, runId: fields.request.runId, identityDigest,
      producerKind: fields.request.producerKind, rung: mapping.rung, representationType: mapping.representationType,
      sourceDigest: source.artifact.digest, environmentDigest: requestState.environmentDigest, policyDigest: requestState.policyDigest,
    });
    const sourceNodeId = `artifact:${sourceArtifactId}`;
    const sourceNode = this._knowledgePayload({
      id: sourceNodeId, type: 'Artifact', grounding: 'verified', body: `Reverified ${source.artifact.kind} representation source artifact`,
      evidence: [{ artifactId: sourceArtifactId }], promotion: { kind: 'RepresentationSource', trigger: 'representation.produce' },
      repoId: fields.request.repoId, artifactId: sourceArtifactId, digest: source.artifact.digest,
    });
    const taskNodeId = `task:${fields.request.taskId}`;
    const edges = [
      this._knowledgePayload({ id: `knowledge-edge:derivedfrom:${representationId}:${sourceNodeId}`, type: 'DerivedFrom', from: representationId, to: sourceNodeId, evidence: clone(graphEvidence) }),
      this._knowledgePayload({ id: `knowledge-edge:producedby:${sourceNodeId}:${taskNodeId}`, type: 'ProducedBy', from: sourceNodeId, to: taskNodeId, evidence: [{ artifactId: sourceArtifactId }] }),
      this._knowledgePayload({ id: `knowledge-edge:observedin:${representationId}:${taskNodeId}`, type: 'ObservedIn', from: representationId, to: taskNodeId, evidence: clone(graphEvidence) }),
    ];
    const nodes = [representationNode, sourceNode]; const graphDigest = canonicalDigest({ nodes, edges });
    const projection = {
      identityDigest, representationId, receiptRef: clone(receiptRef), sourceArtifact: clone(sourceArtifact),
      receiptArtifact: clone(receiptArtifact), node: clone(representationNode), sourceNode: clone(sourceNode), edges: clone(edges), graphDigest,
    };
    const core = {
      schemaVersion: 1, request: clone(fields.request), requestDigest: fields.requestDigest,
      policy: clone(this._representationPolicy), policyDigest: requestState.policyDigest,
      mapping: { kind: fields.request.producerKind, capability: mapping.capability, operation: mapping.operation, rung: mapping.rung, representationType: mapping.representationType },
      source, evidence: clone(fields.evidence), identity, identityDigest, receipt, receiptRef,
      sourceArtifact, receiptArtifact, nodes, edges, graphDigest,
    };
    const payload = { ...core, productionDigest: canonicalDigest(core) };
    if (canonicalBytes(payload) > this._representationPolicy.maxGraphBatchBytes) fail('representation graph batch exceeded deployment ceiling', 'representation_oversize');
    if (canonicalBytes(projection) > this._representationPolicy.maxResultBytes) fail('representation result exceeded deployment ceiling', 'representation_oversize');
    return freeze({ requestState, source, receipt, receiptSerialized, receiptRef, identityDigest, representationId, projection, payload });
  }

  _validateRepresentationNamespaces(derived, integrity = false) {
    const fail = (message) => this._representationFailure(message, 'representation_namespace_conflict', integrity);
    const existingRepresentation = this._representations.get(derived.identityDigest);
    const nodeLifecycle = new Set(['derivedFromEvent', 'eventTime', 'eventTimeSeq', 'invalidatedBy', 'observedAt', 'observedSeq', 'validFrom', 'validTo', 'validityVersion']);
    for (const node of derived.payload.nodes) {
      const prior = this._knowledgeNodes.get(node.id); if (!prior) continue;
      const manifest = Object.fromEntries(Object.entries(prior).filter(([key]) => !nodeLifecycle.has(key)));
      const sourceReuse = node.id === derived.projection.sourceNode.id && canonicalDigest(manifest) === canonicalDigest(node) && prior.validTo === null;
      const sameRepresentation = !integrity && node.id === derived.representationId && existingRepresentation?.identityDigest === derived.identityDigest;
      if (!sourceReuse && !sameRepresentation) fail('reserved representation node identity is occupied');
    }
    for (const edge of derived.payload.edges) {
      const prior = this._knowledgeEdges.get(edge.id); if (!prior) continue;
      const manifest = Object.fromEntries(Object.entries(prior).filter(([key]) => !nodeLifecycle.has(key)));
      const reusableProducedBy = edge.type === 'ProducedBy' && canonicalDigest(manifest) === canonicalDigest(edge) && prior.validTo === null;
      const sameRepresentation = !integrity && existingRepresentation?.edges?.some((item) => item.id === edge.id);
      if (!reusableProducedBy && !sameRepresentation) fail('reserved representation edge identity is occupied');
    }
    const receiptPrior = this._artifacts.get(derived.projection.receiptArtifact.id);
    if (receiptPrior && (integrity || existingRepresentation?.receiptArtifact?.id !== receiptPrior.id)) fail('reserved representation receipt identity is occupied');
  }

  _validateRepresentationPayload(payload, event, integrity = false) {
    const fail = (message, code = 'representation_integrity') => this._representationFailure(message, code, integrity);
    const fields = ['edges', 'evidence', 'graphDigest', 'identity', 'identityDigest', 'mapping', 'nodes', 'policy', 'policyDigest', 'productionDigest', 'receipt', 'receiptArtifact', 'receiptRef', 'request', 'requestDigest', 'schemaVersion', 'source', 'sourceArtifact'];
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Object.keys(payload).sort().join(',') !== fields.sort().join(',') || payload.schemaVersion !== 1
      || canonicalDigest(payload.policy) !== canonicalDigest(this._representationPolicy)
      || payload.policyDigest !== canonicalDigest(this._representationPolicy)) fail('representation event shape or policy diverged');
    const derived = this._representationGraphTemplate({
      request: payload.request, requestDigest: payload.requestDigest, source: payload.source, evidence: payload.evidence,
    }, event, integrity);
    if (canonicalDigest(payload) !== canonicalDigest(derived.payload)) fail('representation event projection diverged');
    this._validateRepresentationNamespaces(derived, integrity);
    return derived;
  }

  _validateRunSealPayload(p, eventSeq, integrity = false) {
    const fail = (message, code) => {
      throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code);
    };
    if (!validRunId(p?.runId)) fail('runId is invalid', 'invalid_run_id');
    if (this._runs.has(p.runId)) fail(`duplicate run seal ${p.runId}`, 'duplicate_run_seal');
    if (!Number.isSafeInteger(p.coordinationUpperBound) || p.coordinationUpperBound !== eventSeq - 1) fail('run coordination prefix is invalid', 'run_prefix_changed');
    const members = [...this._tasks.values()].filter((task) => task.runId === p.runId).sort((a, b) => compareCanonicalStrings(a.id, b.id));
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
      if (!Number.isInteger(ref?.coordinationSeq) || ref.coordinationSeq < 1 || ref.coordinationSeq > p.coordinationUpperBound || !this._events[ref.coordinationSeq - 1]) fail('run scorecard evidence is invalid', 'run_evidence_invalid');
      evidenceSeqs.add(ref.coordinationSeq);
    }
    if (members.some((task) => !evidenceSeqs.has(task.terminalEvent))) fail('run scorecard omits terminal task evidence', 'run_evidence_invalid');
    const runNodeId = `run:${p.runId}`; const artifactNodeId = `run-scorecard:${p.scorecardDigest}`;
    if (this._knowledgeNodes.has(runNodeId) || this._knowledgeNodes.has(artifactNodeId)) fail('run scorecard graph identity already exists', 'duplicate_node');
    return { members, evidence: clone(evidence), runNodeId, artifactNodeId };
  }

  _validateRouteObservationPayload(p, event, integrity = false) {
    const fail = (message, code = 'route_observation_integrity') => { throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code); };
    const fields = ['schemaVersion', 'policyDigest', 'taskId', 'expectedTaskVersion', 'taskType', 'runId', 'routeKey', 'modelFamily', 'route', 'terminalStatus', 'verifiedWin', 'verificationEvidence', 'observedAt', 'observationDigest'];
    const routeFields = ['harnessRequested', 'harnessResolved', 'modelRequested', 'modelResolved', 'modelObserved', 'effortRequested', 'effortResolved', 'effortObserved'];
    if (!p || Object.keys(p).sort().join(',') !== fields.sort().join(',') || p.schemaVersion !== 1 || !this._routePolicy || p.policyDigest !== canonicalDigest(this._routePolicy)
      || !boundedText(p.taskId, 256) || !boundedText(p.taskType, 256) || (p.runId !== null && !validRunId(p.runId)) || !boundedText(p.routeKey, 4096) || !boundedText(p.modelFamily, 128)
      || !p.route || Object.keys(p.route).sort().join(',') !== routeFields.sort().join(',') || !['completed', 'failed'].includes(p.terminalStatus) || p.verifiedWin !== (p.terminalStatus === 'completed')
      || !Number.isSafeInteger(p.expectedTaskVersion) || !Number.isFinite(Date.parse(p.observedAt)) || new Date(Date.parse(p.observedAt)).toISOString() !== p.observedAt || p.observedAt !== event.ts
      || !/^[a-f0-9]{64}$/.test(p.observationDigest ?? '') || event.actor !== 'policy') fail('route observation shape is invalid');
    let tuple; try { tuple = parseRouteTupleKey(p.routeKey); } catch { fail('route observation key is invalid'); }
    if (tuple.modelFamily !== p.modelFamily || tuple.taskType !== p.taskType || `${tuple.harness}@${tuple.version}` !== p.route.harnessResolved
      || tuple.model !== (p.route.modelResolved ?? 'default') || tuple.effort !== (p.route.effortResolved ?? 'default')) fail('route observation tuple is invalid');
    const task = this._tasks.get(p.taskId); if (!task || task.taskType !== p.taskType || (task.runId ?? null) !== p.runId) fail('route observation task is invalid', 'route_observation_stale');
    if (integrity) {
      if (task.status !== p.terminalStatus || task.version !== p.expectedTaskVersion + 1) fail('route observation terminal task diverged', 'route_observation_stale');
      const terminal = this._events[task.terminalEvent - 1]; if (!terminal || event.idempotencyKey !== `${terminal.idempotencyKey}:route:${p.taskId}`) fail('route observation idempotency identity diverged');
    } else if (task.status !== 'working' || task.version !== p.expectedTaskVersion) fail('route observation target is stale', 'route_observation_stale');
    for (const field of routeFields.filter((name) => !['modelObserved', 'effortObserved'].includes(name))) if ((task[field] ?? null) !== p.route[field]) fail('route observation attribution diverged');
    if ((task.routeKey ?? null) !== p.routeKey) fail('route observation route key diverged');
    const evidence = p.verificationEvidence; const mapped = this._events[evidence?.coordinationSeq - 1];
    if (!evidence || !Number.isSafeInteger(evidence.coordinationSeq) || mapped?.kind !== 'evidence.mapped' || mapped.payload?.kind !== 'verify.reverified'
      || canonicalDigest({ ...mapped.payload, coordinationSeq: mapped.seq }) !== canonicalDigest(evidence)) fail('route observation verification evidence is invalid');
    const source = this._operationalRead?.(mapped.payload.worker, mapped.payload.workerSeq);
    if (!source || source.kind !== 'verify.reverified' || source.taskId !== p.taskId || source.payload?.accept !== p.verifiedWin
      || (source.modelObserved ?? null) !== p.route.modelObserved || (source.effortObserved ?? null) !== p.route.effortObserved) fail('route observation verification outcome diverged');
    const core = Object.fromEntries(Object.entries(p).filter(([key]) => key !== 'observationDigest'));
    if (p.observationDigest !== canonicalDigest({ ...core, idempotencyKey: event.idempotencyKey })) fail('route observation digest is invalid');
    const prior = this._routeObservations.get(p.taskId); if (prior && prior.observationDigest !== p.observationDigest) fail('task route observation conflicts', 'route_observation_conflict');
    return task;
  }

  _validateReuseDecisionPayload(p, event, integrity = false) {
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
    if (this._providerPendingFor(p.envRef.repoId, coordinate).length > 0) fail('exact package coordinate has an unresolved authenticated provider delivery', 'reuse_provider_pending');
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
    const policyHead = this._reusePolicyHeads.get(p.envRef.repoId);
    if (policyHead && dossier.policyHash !== policyHead.policyHash) fail('reuse dossier policy is not current', 'reuse_policy_reconciliation_required');
    const asOf = Date.parse(dossier.asOf); const expiresAt = Date.parse(dossier.expiresAt); const decisionAt = Date.parse(event.ts);
    if (!Number.isFinite(asOf) || !Number.isFinite(expiresAt) || !Number.isFinite(decisionAt) || asOf > decisionAt || decisionAt >= expiresAt) fail('reuse dossier is stale or temporally incoherent', 'reuse_evidence_stale');
    const riskGuard = this._reuseRiskGuards.get(canonicalDigest(coordinate));
    if (riskGuard?.blocked === true) {
      if (p.choice === 'borrow') fail('exact package coordinate is blocked by a newer advisory observation', 'reuse_risk_guarded');
      if (asOf < Date.parse(riskGuard.asOf) || dossier.factDigest !== riskGuard.factDigest) fail('reuse decision evidence predates the active advisory guard', 'reuse_risk_guarded');
    }
    if (this._reuseProviderGuards.get(this._providerCoordinateKey(p.envRef.repoId, coordinate))?.blocked === true) fail('exact package coordinate is blocked by retained official provider evidence', 'reuse_provider_guarded');
    if (p.choice === 'borrow' && dossier.recommendation !== 'borrow_candidate') fail('blocked dossier cannot authorize borrowing', 'reuse_borrow_blocked');
    const sbom = p.sbomSnapshot;
    if (!sbom || sbom.grounding !== 'actual_lockfile' || !/^[a-f0-9]{64}$/.test(sbom.lockfileDigest ?? '')
      || !Number.isSafeInteger(sbom.componentCount) || sbom.componentCount < 0 || !boundedText(sbom.lockfile, 2_048)) fail('reuse SBOM projection is invalid', 'reuse_evidence_invalid');
    if (p.envRef.lockfileDigest !== sbom.lockfileDigest) fail('reuse SBOM is not bound to the effective tree', 'reuse_environment_mismatch');
    if (p.evidenceProjectionDigest !== canonicalDigest({ dossierRef: p.dossierRef, dossierSnapshot: dossier, sbomRef: p.sbomRef, sbomSnapshot: sbom })) fail('reuse evidence projection digest is invalid', 'reuse_decision_integrity');
    const evidenceSeq = p.reverifyEvidence?.coordinationSeq;
    const mapped = Number.isInteger(evidenceSeq) ? this._events[evidenceSeq - 1] : null;
    if (!mapped || mapped.kind !== 'evidence.mapped' || mapped.seq >= event.seq || mapped.payload?.kind !== 'knowledge.reuse_evidence_reverified') fail('reuse decision reverify evidence is invalid', 'reuse_evidence_invalid');
    const authoritativeEvidence = this._evidence.get(`${mapped.payload.worker}:${mapped.payload.workerSeq}`);
    if (!authoritativeEvidence || canonicalDigest(authoritativeEvidence) !== canonicalDigest(p.reverifyEvidence)) fail('reuse decision mapped evidence projection is invalid', 'reuse_evidence_invalid');
    const source = this._operationalRead?.(mapped.payload.worker, mapped.payload.workerSeq);
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
      const prior = this._artifacts.get(artifact.id);
      if (prior && this._events[prior.createdEvent - 1]?.kind !== 'knowledge.reuse_decided') fail('reserved reuse artifact identity was preoccupied', 'reuse_namespace_conflict');
      const allowedArtifactFields = new Set(['id', 'owner', 'kind', 'mediaType', 'digest', 'refs', 'accepted', 'provenance', ...(artifact.id === expectedArtifacts[2] ? ['content'] : [])]);
      if (Object.keys(artifact).some((key) => !allowedArtifactFields.has(key))) fail('reuse artifact manifest has unknown fields', 'reuse_decision_integrity');
      if (!artifact.owner || !['capability-evidence', 'decision'].includes(artifact.owner.kind) || artifact.accepted !== true
        || !Array.isArray(artifact.provenance) || artifact.provenance.length === 0) fail('reuse artifact ownership/provenance is invalid', 'reuse_decision_integrity');
      if (prior) {
        const created = this._events[prior.createdEvent - 1];
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
    const currentId = this._reuseSubjects.get(p.subjectDigest);
    const supersedes = p.supersedes ?? null;
    if (supersedes && (Object.keys(supersedes).sort().join(',') !== 'decisionId,expectedValidityVersion'
      || typeof supersedes.decisionId !== 'string' || !Number.isSafeInteger(supersedes.expectedValidityVersion) || supersedes.expectedValidityVersion <= 0)) fail('reuse supersession is invalid', 'reuse_decision_integrity');
    if (currentId && !supersedes) fail('reuse subject already has a live decision', 'reuse_decision_exists');
    if (supersedes) {
      const prior = this._reuseDecisions.get(supersedes.decisionId);
      const priorNode = prior ? this._knowledgeNodes.get(prior.nodeId) : null;
      if (!prior || prior.subjectDigest !== p.subjectDigest || currentId !== prior.id || !priorNode
        || priorNode.validityVersion !== supersedes.expectedValidityVersion) fail('reuse decision supersession is stale or mismatched', 'stale_version');
      const affected = priorNode.validTo ? [] : this._knowledgeReads.filter((read) => read.nodeIds.includes(prior.nodeId)).map((read) => read.eventSeq);
      if (JSON.stringify(affected) !== JSON.stringify(p.affectedReadEvents ?? [])) fail('reuse contamination projection is invalid', 'reuse_decision_integrity');
    } else if (p.affectedReadEvents.length > 0) fail('unexpected reuse contamination projection', 'reuse_decision_integrity');
    const reservedNodes = [
      [`artifact:${p.artifacts[0].id}`, 'Artifact'], [`artifact:${p.artifacts[1].id}`, 'Artifact'], [`artifact:${p.artifacts[2].id}`, 'Artifact'],
      [`finding:dependency-dossier:${p.dossierRef.digest}`, 'Finding'], [`finding:lockfile-sbom:${p.sbomRef.digest}`, 'Finding'],
    ];
    for (const [id, type] of reservedNodes) {
      const node = this._knowledgeNodes.get(id); if (!node) continue;
      const created = this._events[node.observedSeq - 1];
      if (created?.kind !== 'knowledge.reuse_decided' || node.type !== type || node.promotion?.trigger !== 'reuse.decision' || node.validTo) fail('reserved reuse knowledge identity was preoccupied or invalid', 'reuse_namespace_conflict');
    }
    if (this._knowledgeNodes.has(`decision:reuse:${p.decisionDigest}`)) fail('reuse Decision identity already exists', 'reuse_namespace_conflict');
    const dossierFinding = `finding:dependency-dossier:${p.dossierRef.digest}`; const sbomFinding = `finding:lockfile-sbom:${p.sbomRef.digest}`;
    for (const [id, from, to] of [
      [`knowledge-edge:derived:${dossierFinding}:${p.artifacts[0].id}`, dossierFinding, `artifact:${p.artifacts[0].id}`],
      [`knowledge-edge:derived:${sbomFinding}:${p.artifacts[1].id}`, sbomFinding, `artifact:${p.artifacts[1].id}`],
    ]) {
      const edge = this._knowledgeEdges.get(id); if (!edge) continue; const created = this._events[edge.observedSeq - 1];
      if (created?.kind !== 'knowledge.reuse_decided' || edge.type !== 'DerivedFrom' || edge.from !== from || edge.to !== to || edge.validTo) fail('reserved reuse knowledge edge was preoccupied or invalid', 'reuse_namespace_conflict');
    }
    const decisionNodeId = `decision:reuse:${p.decisionDigest}`;
    const newEdgeIds = [
      `knowledge-edge:informed:${decisionNodeId}:${dossierFinding}`, `knowledge-edge:informed:${decisionNodeId}:${sbomFinding}`,
      ...(policyHead?.constraintId ? [`knowledge-edge:informed:${decisionNodeId}:${policyHead.constraintId}`] : []),
      `knowledge-edge:producedby:${p.artifacts[2].id}:${decisionNodeId}`,
      ...(p.supersedes ? [`knowledge-edge:supersedes:${p.id}:${p.supersedes.decisionId}`] : []),
    ];
    if (newEdgeIds.some((id) => this._knowledgeEdges.has(id))) fail('reuse decision edge identity already exists', 'reuse_namespace_conflict');
    return { evidenceSeq };
  }

  _reusePolicyTargets(repoId, policyHash, ceilings = {}) { return coordinationLedger._reusePolicyTargets(this, repoId, policyHash, ceilings); }

  _validateReusePolicyPayload(p, event, integrity = false) {
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
    const head = this._reusePolicyHeads.get(p.repoId) ?? null;
    if (p.expectedPolicyVersion !== (head?.version ?? 0) || p.previousPolicyHash !== (head?.policyHash ?? null)) fail('reuse policy version is stale', 'reuse_policy_stale');
    const eventAt = Date.parse(event.ts);
    const priorEventAt = Date.parse(this._events[event.seq - 2]?.ts ?? event.ts);
    if (!Number.isFinite(eventAt) || new Date(eventAt).toISOString() !== event.ts || !Number.isFinite(priorEventAt) || eventAt < priorEventAt || (head && eventAt < Date.parse(head.activatedAt))) fail('reuse policy effective time is invalid');
    const expectedRequestDigest = canonicalDigest({ actor: event.actor, repoId: p.repoId, expectedPolicyVersion: p.expectedPolicyVersion, previousPolicyHash: p.previousPolicyHash, currentPolicyHash: policy.hash, policyCardDigest: p.policyCardDigest, trigger: 'deployment_policy_activation' });
    if (p.requestDigest !== expectedRequestDigest) fail('reuse policy request identity is invalid');
    const ceilings = p.ceilings;
    if (!ceilings || Object.keys(ceilings).sort().join(',') !== ['maxDecisionTargets', 'maxGuardTargets', 'maxAffectedReads', 'maxStateRows', 'maxObservedPolicyHashes', 'maxEventBytes'].sort().join(',')
      || Object.values(ceilings).some((value) => !Number.isSafeInteger(value) || value <= 0) || ceilings.maxDecisionTargets > 100_000 || ceilings.maxGuardTargets > 100_000 || ceilings.maxAffectedReads > 1_000_000 || ceilings.maxStateRows > 10_000_000 || ceilings.maxObservedPolicyHashes > 100_000 || ceilings.maxEventBytes > 64 * 1024 * 1024) fail('reuse policy ceilings are invalid', 'reuse_policy_oversize');
    const expected = this._reusePolicyTargets(p.repoId, policy.hash, ceilings);
    if (canonicalDigest(expected.decisionTargets) !== canonicalDigest(p.decisionTargets) || canonicalDigest(expected.bindingTargets) !== canonicalDigest(p.bindingTargets) || canonicalDigest(expected.findingTargets) !== canonicalDigest(p.findingTargets) || canonicalDigest(expected.guardTargets) !== canonicalDigest(p.guardTargets) || canonicalDigest(expected.priorConstraintTarget) !== canonicalDigest(p.priorConstraintTarget) || canonicalDigest(expected.observedPolicyHashes) !== canonicalDigest(p.observedPolicyHashes) || expected.examinedStateRows !== p.examinedStateRows || expected.derivationOverflow !== p.derivationOverflow) fail('reuse policy target projection is invalid');
    const affectedReads = [...p.decisionTargets, ...p.bindingTargets, ...p.findingTargets, ...(p.priorConstraintTarget ? [p.priorConstraintTarget] : [])].reduce((sum, target) => sum + target.affectedReadEvents.length, 0) + p.guardTargets.reduce((sum, target) => sum + target.affectedRiskFindingReadEvents.length, 0);
    if (p.derivationOverflow || p.examinedStateRows > ceilings.maxStateRows || p.observedPolicyHashes.length > ceilings.maxObservedPolicyHashes || p.decisionTargets.length + p.bindingTargets.length > ceilings.maxDecisionTargets || p.findingTargets.length > ceilings.maxDecisionTargets + ceilings.maxGuardTargets || p.guardTargets.length > ceilings.maxGuardTargets || affectedReads > ceilings.maxAffectedReads) fail('reuse policy target projection exceeded deployment ceiling', 'reuse_policy_oversize');
    for (const target of [...p.decisionTargets, ...p.bindingTargets, ...p.findingTargets, ...(p.priorConstraintTarget ? [p.priorConstraintTarget] : [])]) if (eventAt < Date.parse(this._knowledgeNodes.get(target.nodeId)?.validFrom ?? '')) fail('reuse policy transition predates a target');
    for (const target of p.guardTargets) { const guard = target.guardKind === 'provider' ? this._reuseProviderGuards.get(target.coordinateKey) : this._reuseRiskGuards.get(target.coordinateKey); if (eventAt < Date.parse(guard?.asOf ?? '')) fail('reuse policy transition predates a guard'); }
    const targetSet = { decisionTargets: p.decisionTargets, bindingTargets: p.bindingTargets, findingTargets: p.findingTargets, guardTargets: p.guardTargets, priorConstraintTarget: p.priorConstraintTarget, observedPolicyHashes: p.observedPolicyHashes, examinedStateRows: p.examinedStateRows, derivationOverflow: p.derivationOverflow };
    if (p.targetSetDigest !== canonicalDigest(targetSet)) fail('reuse policy target digest is invalid');
    const version = p.expectedPolicyVersion + 1; const expectedConstraint = `constraint:reuse-policy:${canonicalDigest({ repoId: p.repoId, policyHash: policy.hash, version })}`;
    if (p.constraintId !== expectedConstraint || this._knowledgeNodes.has(expectedConstraint)) fail('reuse policy constraint identity is invalid', 'reuse_namespace_conflict');
    for (const target of [...p.decisionTargets, ...p.findingTargets, ...p.guardTargets.filter((item) => item.riskFindingId).map((item) => ({ nodeId: item.riskFindingId }))]) if (this._knowledgeEdges.has(`knowledge-edge:affects:${expectedConstraint}:${target.nodeId}`)) fail('reuse policy edge identity is preoccupied', 'reuse_namespace_conflict');
    for (const target of p.bindingTargets) if (this._knowledgeEdges.has(`knowledge-edge:informed:${target.nodeId}:${expectedConstraint}`)) fail('reuse policy binding edge identity is preoccupied', 'reuse_namespace_conflict');
    if (p.priorConstraintTarget && this._knowledgeEdges.has(`knowledge-edge:supersedes:${expectedConstraint}:${p.priorConstraintTarget.nodeId}`)) fail('reuse policy lineage edge identity is preoccupied', 'reuse_namespace_conflict');
    const core = Object.fromEntries(Object.entries(p).filter(([key]) => key !== 'transitionDigest'));
    if (p.transitionDigest !== canonicalDigest(core)) fail('reuse policy transition digest is invalid');
    const exactEvent = { schemaVersion: 1, seq: event.seq, ts: event.ts, kind: 'knowledge.reuse_policy_reconciled', actor: event.actor, idempotencyKey: event.idempotencyKey, payload: p };
    if (Buffer.byteLength(`${JSON.stringify(exactEvent)}\n`) > ceilings.maxEventBytes) fail('reuse policy transition exceeded event byte ceiling', 'reuse_policy_oversize');
    return { version, head };
  }

  _guardFromRiskPayload(p, event) {
    const seed = this._reuseDecisions.get(p.seedDecisionId); const prior = this._reuseRiskGuards.get(canonicalDigest(p.coordinate));
    return freeze({ coordinate: clone(p.coordinate), repoId: seed.envRef.repoId, blocked: true, dossierDigest: p.dossierRef.digest, factDigest: p.dossierSnapshot.factDigest, policyHash: p.dossierSnapshot.policyHash, recommendation: p.dossierSnapshot.recommendation, asOf: p.dossierSnapshot.asOf, expiresAt: p.dossierSnapshot.expiresAt, advisoryIds: clone(p.advisoryIds), maliciousAdvisoryIds: clone(p.maliciousAdvisoryIds), eventSeq: event.seq, guardDigest: p.guardDigest, supersedesGuardDigest: prior?.guardDigest ?? null, policyValidityVersion: (prior?.policyValidityVersion ?? 0) + 1, policyStale: false, inheritedAdverse: false });
  }

  _reuseRiskTargets(coordinate, snapshot) { return coordinationLedger._reuseRiskTargets(this, coordinate, snapshot); }

  _validateReuseRiskPayload(p, event, integrity = false) {
    const fail = (message, code) => { throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code); };
    const fields = ['schemaVersion', 'requestDigest', 'guardDigest', 'seedDecisionId', 'seedExpectedValidityVersion', 'coordinate', 'dossierRef', 'dossierSnapshot', 'advisoryIds', 'maliciousAdvisoryIds', 'reverifyEvidence', 'adverse', 'effectiveAt', 'targets', 'targetSetDigest'];
    if (!p || Object.keys(p).sort().join(',') !== fields.sort().join(',') || p.schemaVersion !== 1
      || !/^[a-f0-9]{64}$/.test(p.requestDigest ?? '') || !/^[a-f0-9]{64}$/.test(p.guardDigest ?? '')) fail('reuse risk review shape is invalid', 'reuse_risk_integrity');
    const seed = this._reuseDecisions.get(p.seedDecisionId); const seedNode = seed ? this._knowledgeNodes.get(seed.nodeId) : null;
    if (!seed || !seedNode || seed.envRef.repoId.length === 0 || canonicalDigest(seed.coordinate) !== canonicalDigest(p.coordinate)
      || !Number.isSafeInteger(p.seedExpectedValidityVersion) || p.seedExpectedValidityVersion <= 0
      || p.seedExpectedValidityVersion > seedNode.validityVersion) fail('reuse risk seed is stale or mismatched', 'stale_version');
    const expectedRequestDigest = canonicalDigest({ actor: event.actor, repoId: seed.envRef.repoId, decisionId: p.seedDecisionId, expectedValidityVersion: p.seedExpectedValidityVersion, trigger: 'advisory_refresh' });
    if (p.requestDigest !== expectedRequestDigest) fail('reuse risk request identity is invalid', 'reuse_risk_integrity');
    if (p.dossierRef?.kind !== 'dependency-dossier' || p.dossierRef?.mediaType !== 'application/vnd.baton.dependency-dossier+json'
      || !/^[a-f0-9]{64}$/.test(p.dossierRef?.digest ?? '') || p.dossierRef.handle !== `art:sha256:${p.dossierRef.digest}`
      || !Number.isSafeInteger(p.dossierRef.bytes) || p.dossierRef.bytes <= 0) fail('reuse risk dossier reference is invalid', 'reuse_evidence_invalid');
    const snapshot = p.dossierSnapshot;
    const policyHead = this._reusePolicyHeads.get(seed.envRef.repoId);
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
    const activeGuard = this._reuseRiskGuards.get(canonicalDigest(p.coordinate));
    if (activeGuard && asOf <= Date.parse(activeGuard.asOf)) fail('reuse risk observation is older than the active guard', 'reuse_risk_stale');
    const evidenceSeq = p.reverifyEvidence?.coordinationSeq; const mapped = Number.isInteger(evidenceSeq) ? this._events[evidenceSeq - 1] : null;
    const source = mapped ? this._operationalRead?.(mapped.payload?.worker, mapped.payload?.workerSeq) : null;
    const authoritativeEvidence = mapped ? this._evidence.get(`${mapped.payload.worker}:${mapped.payload.workerSeq}`) : null;
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
    const expectedTargets = adverse ? this._reuseRiskTargets(p.coordinate, snapshot) : [];
    if (canonicalDigest(expectedTargets) !== canonicalDigest(p.targets) || p.targetSetDigest !== canonicalDigest(p.targets)) fail('reuse risk target projection is invalid', 'reuse_risk_integrity');
    const core = { requestDigest: p.requestDigest, seedDecisionId: p.seedDecisionId, seedExpectedValidityVersion: p.seedExpectedValidityVersion, coordinate: p.coordinate, dossierRef: p.dossierRef, dossierSnapshot: snapshot, advisoryIds: p.advisoryIds, maliciousAdvisoryIds: p.maliciousAdvisoryIds, reverifyEvidence: p.reverifyEvidence, adverse, effectiveAt: p.effectiveAt, targetSetDigest: p.targetSetDigest };
    if (p.guardDigest !== canonicalDigest(core)) fail('reuse risk digest is invalid', 'reuse_risk_integrity');
    const inheritedMigration = !adverse && activeGuard?.blocked === true && activeGuard.policyStale === true;
    let inheritedSourceFindingId = null; let predecessorFindingId = null;
    if (adverse || inheritedMigration) {
      const findingId = `finding:reuse-risk:${p.guardDigest}`;
      if (this._knowledgeNodes.has(findingId) || p.targets.some((target) => this._knowledgeEdges.has(`knowledge-edge:affects:${findingId}:${target.nodeId}`))) fail('reuse risk graph identity is preoccupied', 'reuse_namespace_conflict');
      if (inheritedMigration) {
        inheritedSourceFindingId = `finding:reuse-risk:${activeGuard.inheritedFromGuardDigest ?? activeGuard.guardDigest}`;
        if (!this._knowledgeNodes.has(inheritedSourceFindingId) || this._knowledgeEdges.has(`knowledge-edge:derived:${findingId}:${inheritedSourceFindingId}`)) fail('inherited adverse source is absent or preoccupied', 'reuse_namespace_conflict');
      }
      if (adverse && activeGuard) {
        predecessorFindingId = `finding:reuse-risk:${activeGuard.guardDigest}`;
        if (!this._knowledgeNodes.has(predecessorFindingId) || this._knowledgeEdges.has(`knowledge-edge:derived:${findingId}:${predecessorFindingId}`)) fail('adverse predecessor source is absent or preoccupied', 'reuse_namespace_conflict');
      }
    }
    return { adverse, inheritedMigration, inheritedSourceFindingId, predecessorFindingId };
  }
  _ttlTarget(decision) {
    return coordinationInternals._ttlTarget(this, decision);
  }

  _validateReuseTtlPayload(p, event, integrity = false) {
    const fail = (message, code) => { throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code); };
    const fields = ['schemaVersion', 'requestDigest', 'invalidationDigest', 'decisionId', 'expectedValidityVersion', 'effectiveAt', 'actor', 'repoId', 'trigger', 'target'];
    if (!p || Object.keys(p).sort().join(',') !== fields.sort().join(',') || p.schemaVersion !== 1
      || !/^[a-f0-9]{64}$/.test(p.requestDigest ?? '') || !/^[a-f0-9]{64}$/.test(p.invalidationDigest ?? '')) fail('reuse TTL invalidation shape is invalid', 'reuse_ttl_integrity');
    const decision = this._reuseDecisions.get(p.decisionId); const node = decision ? this._knowledgeNodes.get(decision.nodeId) : null;
    if (!decision || !node) fail('reuse TTL target was not found', 'reuse_decision_not_found');
    if (p.actor !== event.actor || p.repoId !== decision.envRef.repoId || p.trigger !== 'ttl_expired'
      || !Number.isSafeInteger(p.expectedValidityVersion) || p.expectedValidityVersion <= 0) fail('reuse TTL authority projection is invalid', 'reuse_ttl_integrity');
    const expectedRequestDigest = canonicalDigest({ actor: p.actor, repoId: p.repoId, decisionId: p.decisionId, expectedValidityVersion: p.expectedValidityVersion, trigger: p.trigger });
    if (p.requestDigest !== expectedRequestDigest) fail('reuse TTL request identity is invalid', 'reuse_ttl_integrity');
    if (this._reuseSubjects.get(decision.subjectDigest) !== decision.id || node.validTo || node.validityVersion !== p.expectedValidityVersion) fail('reuse TTL target is stale', 'stale_version');
    const eventAt = Date.parse(event.ts); const expiry = Date.parse(p.effectiveAt);
    if (p.effectiveAt !== decision.dossierSnapshot.expiresAt || !Number.isFinite(eventAt) || !Number.isFinite(expiry) || eventAt < expiry) fail('reuse TTL target is not expired', 'reuse_not_expired');
    const expectedTarget = this._ttlTarget(decision);
    if (canonicalDigest(expectedTarget) !== canonicalDigest(p.target)) fail('reuse TTL target projection is invalid', 'reuse_ttl_integrity');
    const core = { requestDigest: p.requestDigest, decisionId: p.decisionId, expectedValidityVersion: p.expectedValidityVersion, effectiveAt: p.effectiveAt, actor: p.actor, repoId: p.repoId, trigger: p.trigger, target: p.target };
    if (p.invalidationDigest !== canonicalDigest(core)) fail('reuse TTL invalidation digest is invalid', 'reuse_ttl_integrity');
  }

  _providerCoordinateKey(repoId, coordinate) { return coordinationLedger._providerCoordinateKey(repoId, coordinate); }
  _providerSourceKey(repoId, providerId, sourceEpoch) { return coordinationLedger._providerSourceKey(repoId, providerId, sourceEpoch); }

  _providerPendingFor(repoId, coordinate) { return coordinationLedger._providerPendingFor(this, repoId, coordinate); }
  _providerAdverseCeilings(repoId) {
    return coordinationInternals._providerAdverseCeilings(this._reusePolicyTransitions, repoId);
  }

  _providerAdverseTargets(repoId, coordinate, ceilings = this._providerAdverseCeilings(repoId)) { return coordinationLedger._providerAdverseTargets(this, repoId, coordinate, ceilings); }
  _providerContribution(row, processing, policy) {
    return coordinationInternals._providerContribution(row, processing, policy);
  }

  _providerAggregate(repoId, coordinate, contribution, policy) { return coordinationLedger._providerAggregate(this, repoId, coordinate, contribution, policy); }

  _providerAggregateTarget(repoId, coordinate) { return coordinationLedger._providerAggregateTarget(this, repoId, coordinate); }

  _validateProviderDeliveryPayload(p, event, integrity = false) {
    const fail = (message, code) => { throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code); };
    if (!p || Object.keys(p).sort().join(',') !== ['contentIdentity', 'processingId', 'receipt', 'receiptDigest', 'receiptId', 'repoId', 'schemaVersion'].sort().join(',') || p.schemaVersion !== 1
      || !boundedText(p.repoId, 256) || !/^provider:[A-Za-z0-9._:-]{1,128}$/.test(event.actor ?? '')) fail('provider delivery authority is invalid', 'provider_delivery_integrity');
    const receipt = p.receipt; const fields = ['schemaVersion', 'providerId', 'sourceEpoch', 'cardDigest', 'mode', 'deliveryId', 'rawDigest', 'rawBytes', 'authReceiptDigest', 'keyFingerprint', 'occurredAt', 'receivedAt', 'sequence', 'coordinates', 'advisoryIds', 'verificationDigest'];
    if (!receipt || Object.keys(receipt).sort().join(',') !== fields.sort().join(',') || receipt.schemaVersion !== 1 || event.actor !== `provider:${receipt.providerId}`
      || !boundedText(receipt.providerId, 128) || !boundedText(receipt.deliveryId, 4_096) || !/^[a-f0-9]{64}$/.test(receipt.sourceEpoch ?? '') || receipt.sourceEpoch !== receipt.cardDigest
      || !/^[a-f0-9]{64}$/.test(receipt.rawDigest ?? '') || !/^[a-f0-9]{64}$/.test(receipt.authReceiptDigest ?? '') || !/^[a-f0-9]{64}$/.test(receipt.keyFingerprint ?? '')
      || !/^[a-f0-9]{64}$/.test(receipt.verificationDigest ?? '') || receipt.receivedAt !== event.ts || !Number.isFinite(Date.parse(receipt.occurredAt)) || new Date(Date.parse(receipt.occurredAt)).toISOString() !== receipt.occurredAt
      || (receipt.sequence !== null && (!Number.isSafeInteger(receipt.sequence) || receipt.sequence < 0))) fail('provider delivery receipt is invalid', 'provider_delivery_integrity');
    const configured = this._advisoryFeedCards.get(receipt.providerId);
    if (!configured) fail('provider source card is required for replay', 'provider_card_required');
    const card = configured.card;
    if (configured.cardDigest !== receipt.cardDigest || !card.modes?.includes(receipt.mode) || !card.auth?.keyFingerprints?.includes(receipt.keyFingerprint)
      || !Number.isSafeInteger(receipt.rawBytes) || receipt.rawBytes <= 0 || receipt.rawBytes > card.ceilings?.maxDeliveryBytes) fail('provider delivery is not bound to its source card', 'provider_card_mismatch');
    if (integrity && this._loading === true && ['hmac-sha256', 'ed25519'].includes(card.auth?.scheme)) {
      if (typeof this._advisoryReceiptReverify !== 'function') fail('native provider receipt requires private CAS replay before readiness', 'provider_cas_replay_required');
      const replayReceipt = { schemaVersion: 1, providerId: receipt.providerId, sourceEpoch: receipt.sourceEpoch, cardDigest: receipt.cardDigest, mode: receipt.mode, deliveryId: receipt.deliveryId, rawDigest: receipt.rawDigest, rawBytes: receipt.rawBytes, authReceiptDigest: receipt.authReceiptDigest, keyFingerprint: receipt.keyFingerprint, occurredAt: receipt.occurredAt, sequence: receipt.sequence, coordinates: clone(receipt.coordinates), advisoryIds: clone(receipt.advisoryIds), source: { handle: `art:sha256:${receipt.rawDigest}`, digest: receipt.rawDigest, bytes: receipt.rawBytes, mediaType: 'application/json' }, contentDigest: receipt.verificationDigest };
      let reverified; try { reverified = this._advisoryReceiptReverify(replayReceipt); } catch (error) { throw integrity ? new CoordinationIntegrityError('native provider receipt private CAS replay failed', error?.code ?? 'provider_cas_invalid') : error; }
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
    const priorId = this._providerDeliveryIds.get(deliveryKey);
    if (priorId) fail('provider delivery identity already exists in the ledger', 'provider_delivery_duplicate');
    const sourceKey = this._providerSourceKey(p.repoId, receipt.providerId, receipt.sourceEpoch); const priorSequence = receipt.sequence === null ? null : this._providerSequences.get(sourceKey)?.get(receipt.sequence);
    if (priorSequence && priorSequence.rawDigest !== receipt.rawDigest) fail('provider sequence was rebound to different authenticated bytes', 'provider_sequence_conflict');
    return { deliveryKey, sourceKey };
  }

  _validateProviderReconciliationPayload(p, event, integrity = false) {
    const fail = (message, code = 'provider_reconciliation_integrity') => { throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code); };
    const fields = ['schemaVersion', 'requestDigest', 'completionDigest', 'repoId', 'providerId', 'sourceEpoch', 'expectedHealthEvent', 'proof', 'receiptIds', 'sequenceRows', 'completedAt'];
    if (!p || Object.keys(p).sort().join(',') !== fields.sort().join(',') || p.schemaVersion !== 1 || !boundedText(p.repoId, 256) || !boundedText(p.providerId, 128) || !/^[a-f0-9]{64}$/.test(p.sourceEpoch ?? '') || !/^[a-f0-9]{64}$/.test(p.requestDigest ?? '') || !/^[a-f0-9]{64}$/.test(p.completionDigest ?? '') || p.completedAt !== event.ts || event.actor !== `provider-poller:${p.providerId}`) fail('provider reconciliation authority is invalid');
    const configured = this._advisoryFeedCards.get(p.providerId); if (!configured || configured.cardDigest !== p.sourceEpoch || !configured.card.modes?.includes('poll')) fail('provider poll card is unavailable', 'provider_card_mismatch');
    const proof = p.proof; const proofFields = ['schemaVersion', 'providerId', 'sourceEpoch', 'cardDigest', 'pollId', 'observedAt', 'window', 'finalSequence', 'cursorDigest', 'authReceiptDigest', 'keyFingerprint', 'pageDigests', 'itemDigests', 'totalBytes', 'receiptRawDigests', 'proofDigest'];
    if (!proof || Object.keys(proof).sort().join(',') !== proofFields.sort().join(',') || proof.schemaVersion !== 1 || proof.providerId !== p.providerId || proof.sourceEpoch !== p.sourceEpoch || proof.cardDigest !== p.sourceEpoch || !boundedText(proof.pollId, configured.card.ceilings.maxIdentityBytes)
      || !Number.isFinite(Date.parse(proof.observedAt)) || new Date(Date.parse(proof.observedAt)).toISOString() !== proof.observedAt || Date.parse(proof.observedAt) > Date.parse(event.ts) || !proof.window || Object.keys(proof.window).sort().join(',') !== 'fromSequence,toSequence'
      || !Number.isSafeInteger(proof.window.fromSequence) || !Number.isSafeInteger(proof.window.toSequence) || proof.window.fromSequence < configured.card.poll.initialSequence || proof.window.toSequence < proof.window.fromSequence || proof.finalSequence !== proof.window.toSequence
      || !/^[a-f0-9]{64}$/.test(proof.cursorDigest ?? '') || !/^[a-f0-9]{64}$/.test(proof.authReceiptDigest ?? '') || !configured.card.auth.keyFingerprints.includes(proof.keyFingerprint) || !/^[a-f0-9]{64}$/.test(proof.proofDigest ?? '')) fail('provider poll proof is invalid');
    const proofCore = Object.fromEntries(Object.entries(proof).filter(([key]) => key !== 'proofDigest')); if (proof.proofDigest !== canonicalDigest(proofCore)) fail('provider poll proof digest is invalid');
    if (typeof this._advisoryPollReverify !== 'function') fail('provider poll replay authority is required', 'provider_poll_replay_required');
    let reverified; try { reverified = this._advisoryPollReverify(clone(proof)); } catch (error) { fail('provider poll replay failed', error?.code ?? 'provider_poll_replay_invalid'); }
    if (reverified && typeof reverified.then === 'function') fail('provider poll replay must be synchronous', 'provider_poll_replay_required');
    if (canonicalDigest(reverified) !== canonicalDigest(proof)) fail('provider poll replay diverged', 'provider_poll_replay_invalid');
    const sourceKey = this._providerSourceKey(p.repoId, p.providerId, p.sourceEpoch); const health = this._providerSourceHealth.get(sourceKey);
    if (!health || health.status !== 'reconciliation_required' || health.lastEvent !== p.expectedHealthEvent || proof.finalSequence < health.highSequence || proof.window.fromSequence > (health.firstGap?.from ?? health.highSequence)) fail('provider source health changed before reconciliation', 'provider_reconciliation_stale');
    const degradedEvent = this._events[p.expectedHealthEvent - 1];
    const observedAt = Date.parse(proof.observedAt); const completedAt = Date.parse(event.ts); const degradedAt = Date.parse(degradedEvent?.ts);
    if (!degradedEvent || degradedEvent.seq !== p.expectedHealthEvent || observedAt + configured.card.poll.maxClockSkewMs < degradedAt || observedAt + configured.card.poll.maxWallMs + configured.card.poll.maxClockSkewMs < completedAt) fail('provider poll is not fresh for degraded source health', 'provider_reconciliation_stale');
    const sequenceMap = this._providerSequences.get(sourceKey) ?? new Map(); const expectedRows = []; const expectedReceipts = [];
    for (let sequence = proof.window.fromSequence; sequence <= proof.window.toSequence; sequence += 1) { const row = sequenceMap.get(sequence); const receipt = row ? this._providerReceipts.get(row.receiptId) : null; if (!row || !receipt || receipt.providerId !== p.providerId || receipt.sourceEpoch !== p.sourceEpoch) fail('provider poll sequence window is incomplete', 'provider_reconciliation_incomplete'); expectedRows.push(clone(row)); expectedReceipts.push(receipt); }
    if (canonicalDigest(p.sequenceRows) !== canonicalDigest(expectedRows) || JSON.stringify(p.receiptIds) !== JSON.stringify(expectedReceipts.map((row) => row.id)) || JSON.stringify(proof.receiptRawDigests) !== JSON.stringify(expectedReceipts.map((row) => row.rawDigest))) fail('provider poll receipt projection is incomplete', 'provider_reconciliation_incomplete');
    const expectedRequestDigest = canonicalDigest({ actor: event.actor, repoId: p.repoId, providerId: p.providerId, sourceEpoch: p.sourceEpoch, expectedHealthEvent: p.expectedHealthEvent, proofDigest: proof.proofDigest, trigger: 'provider_full_poll_reconciliation' }); if (p.requestDigest !== expectedRequestDigest) fail('provider reconciliation request identity is invalid');
    const core = Object.fromEntries(Object.entries(p).filter(([key]) => key !== 'completionDigest')); if (p.completionDigest !== canonicalDigest(core)) fail('provider reconciliation completion digest is invalid');
    return { sourceKey, health };
  }

  _validateProviderDeferralPayload(p, event, integrity = false) {
    const fail = (message, code = 'provider_deferral_integrity') => { throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code); };
    const fields = ['schemaVersion', 'requestDigest', 'deferralDigest', 'policyDigest', 'repoId', 'processingId', 'providerId', 'sourceEpoch', 'expectedProcessingVersion', 'expectedLastReceiptEvent', 'attempt', 'failureCode', 'delayMs', 'nextAttemptAt'];
    if (!p || Object.keys(p).sort().join(',') !== fields.sort().join(',') || p.schemaVersion !== 1 || !this._providerAttemptPolicy || p.policyDigest !== canonicalDigest(this._providerAttemptPolicy)
      || !/^[a-f0-9]{64}$/.test(p.requestDigest ?? '') || !/^[a-f0-9]{64}$/.test(p.deferralDigest ?? '') || !boundedText(p.repoId, 256) || !boundedText(p.processingId, 256) || !boundedText(p.providerId, 128)
      || !/^[a-f0-9]{64}$/.test(p.sourceEpoch ?? '') || !Number.isSafeInteger(p.expectedProcessingVersion) || !Number.isSafeInteger(p.expectedLastReceiptEvent) || !Number.isSafeInteger(p.attempt)
      || !PROVIDER_FAILURE_CODES.has(p.failureCode) || !Number.isSafeInteger(p.delayMs) || !Number.isFinite(Date.parse(p.nextAttemptAt)) || new Date(Date.parse(p.nextAttemptAt)).toISOString() !== p.nextAttemptAt
      || !Number.isFinite(Date.parse(event.ts)) || new Date(Date.parse(event.ts)).toISOString() !== event.ts || !boundedText(event.idempotencyKey, 512) || event.actor !== `provider-reconciler:${p.providerId}`) fail('provider deferral shape is invalid');
    const processing = this._providerProcessing.get(p.processingId); if (!processing || processing.status !== 'pending' || processing.repoId !== p.repoId || processing.providerId !== p.providerId || processing.sourceEpoch !== p.sourceEpoch || processing.version !== p.expectedProcessingVersion || processing.lastReceiptEvent !== p.expectedLastReceiptEvent) fail('provider deferral target is stale', 'provider_processing_stale');
    if (processing.nextAttemptAt && Date.parse(event.ts) < Date.parse(processing.nextAttemptAt)) fail('provider deferral was recorded before it became due', 'provider_processing_not_due');
    const expectedAttempt = (processing.attemptCount ?? 0) + 1; const windowAttempt = expectedAttempt - (processing.attemptWindowStart ?? 0); const expectedDelay = providerAttemptDelay(this._providerAttemptPolicy, windowAttempt);
    if (p.attempt !== expectedAttempt || windowAttempt > this._providerAttemptPolicy.maxAttempts || p.delayMs !== expectedDelay || p.nextAttemptAt !== new Date(Date.parse(event.ts) + expectedDelay).toISOString()) fail('provider deferral policy derivation is invalid');
    const requestCore = { actor: event.actor, idempotencyKey: event.idempotencyKey, repoId: p.repoId, processingId: p.processingId, providerId: p.providerId, sourceEpoch: p.sourceEpoch, expectedProcessingVersion: p.expectedProcessingVersion, expectedLastReceiptEvent: p.expectedLastReceiptEvent, attempt: p.attempt, failureCode: p.failureCode, policyDigest: p.policyDigest };
    if (p.requestDigest !== canonicalDigest(requestCore)) fail('provider deferral request identity is invalid'); const core = Object.fromEntries(Object.entries(p).filter(([key]) => key !== 'deferralDigest')); if (p.deferralDigest !== canonicalDigest(core)) fail('provider deferral digest is invalid');
    return processing;
  }

  _validateProviderGreenPayload(p, event, integrity = false) {
    const fail = (message, code) => { throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code); };
    const fields = ['schemaVersion', 'requestDigest', 'completionDigest', 'processingId', 'expectedProcessingVersion', 'repoId', 'providerId', 'sourceEpoch', 'receiptIds', 'policy', 'indexBinding', 'observations', 'result'];
    if (!p || Object.keys(p).sort().join(',') !== fields.sort().join(',') || p.schemaVersion !== 1 || p.result !== 'ignored_non_adverse' || !/^[a-f0-9]{64}$/.test(p.requestDigest ?? '') || !/^[a-f0-9]{64}$/.test(p.completionDigest ?? '')) fail('provider green completion shape is invalid', 'provider_processing_integrity');
    const processing = this._providerProcessing.get(p.processingId);
    if (!processing || processing.status !== 'pending' || processing.version !== p.expectedProcessingVersion || processing.repoId !== p.repoId || processing.providerId !== p.providerId || processing.sourceEpoch !== p.sourceEpoch
      || JSON.stringify(processing.receiptIds) !== JSON.stringify(p.receiptIds)) fail('provider green completion target is stale or mismatched', 'provider_processing_stale');
    if (event.actor !== `provider-reconciler:${p.providerId}`) fail('provider reconciler actor is invalid', 'provider_processing_integrity');
    const head = this._reusePolicyHeads.get(p.repoId); const policyFields = ['hash', 'version', 'constraintId'];
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
      const evidenceSeq = row.reverifyEvidence?.coordinationSeq; const mapped = Number.isSafeInteger(evidenceSeq) ? this._events[evidenceSeq - 1] : null; const authoritative = mapped ? this._evidence.get(`${mapped.payload?.worker}:${mapped.payload?.workerSeq}`) : null; const source = mapped ? this._operationalRead?.(mapped.payload?.worker, mapped.payload?.workerSeq) : null;
      const projection = { processingId: p.processingId, coordinate: row.coordinate, dossierDigest: row.dossierRef.digest, factDigest: row.snapshot.factDigest, policyHash: p.policy.hash, indexBindingDigest: p.indexBinding.bindingDigest, recommendation: row.snapshot.recommendation, asOf: row.snapshot.asOf, expiresAt: row.snapshot.expiresAt, advisoryIds: row.advisoryIds, maliciousAdvisoryIds: row.maliciousAdvisoryIds };
      if (!mapped || mapped.kind !== 'evidence.mapped' || mapped.seq >= event.seq || mapped.payload?.kind !== 'knowledge.reuse_provider_reverified' || !authoritative || canonicalDigest(authoritative) !== canonicalDigest(row.reverifyEvidence)
        || !source || source.kind !== 'knowledge.reuse_provider_reverified' || digest(source) !== mapped.payload.digest || source.actor !== event.actor || canonicalDigest(source.payload) !== canonicalDigest({ ...projection, officialDigest: canonicalDigest(projection) }) || row.officialDigest !== canonicalDigest(projection)) fail('provider official reverify evidence is invalid', 'provider_processing_integrity');
    }
    const core = Object.fromEntries(Object.entries(p).filter(([key]) => key !== 'completionDigest'));
    if (p.completionDigest !== canonicalDigest(core)) fail('provider green completion digest is invalid', 'provider_processing_integrity');
  }

  _validateProviderAdversePayload(p, event, integrity = false) {
    const fail = (message, code = 'provider_processing_integrity') => { throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code); };
    const fields = ['schemaVersion', 'requestDigest', 'completionDigest', 'processingId', 'expectedProcessingVersion', 'repoId', 'providerId', 'sourceEpoch', 'receiptIds', 'policy', 'indexBinding', 'observations', 'result'];
    if (!p || Object.keys(p).sort().join(',') !== fields.sort().join(',') || p.schemaVersion !== 1 || p.result !== 'guarded_adverse' || !/^[a-f0-9]{64}$/.test(p.requestDigest ?? '') || !/^[a-f0-9]{64}$/.test(p.completionDigest ?? '')) fail('provider adverse completion shape is invalid');
    const processing = this._providerProcessing.get(p.processingId);
    if (!processing || processing.status !== 'pending' || processing.version !== p.expectedProcessingVersion || processing.repoId !== p.repoId || processing.providerId !== p.providerId || processing.sourceEpoch !== p.sourceEpoch || JSON.stringify(processing.receiptIds) !== JSON.stringify(p.receiptIds)) fail('provider adverse completion target is stale or mismatched', 'provider_processing_stale');
    if (event.actor !== `provider-reconciler:${p.providerId}`) fail('provider reconciler actor is invalid');
    const head = this._reusePolicyHeads.get(p.repoId); const policyFields = ['hash', 'version', 'constraintId'];
    if (!head || !p.policy || Object.keys(p.policy).sort().join(',') !== policyFields.sort().join(',') || p.policy.hash !== head.policyHash || p.policy.version !== head.version || p.policy.constraintId !== head.constraintId) fail('provider processing policy changed', 'reuse_policy_reconciliation_required');
    const bindingFields = ['schemaVersion', 'repoId', 'treeSha', 'indexEpoch', 'atlasCardDigest', 'bindingDigest'];
    if (!p.indexBinding || Object.keys(p.indexBinding).sort().join(',') !== bindingFields.sort().join(',') || p.indexBinding.schemaVersion !== 1 || p.indexBinding.repoId !== p.repoId || !/^[a-f0-9]{4,128}$/.test(p.indexBinding.treeSha ?? '') || !/^[a-f0-9]{64}$/.test(p.indexBinding.indexEpoch ?? '') || !/^[a-f0-9]{64}$/.test(p.indexBinding.atlasCardDigest ?? '') || p.indexBinding.bindingDigest !== canonicalDigest(Object.fromEntries(Object.entries(p.indexBinding).filter(([key]) => key !== 'bindingDigest')))) fail('provider index binding is invalid', 'provider_index_changed');
    if (!Array.isArray(p.observations) || p.observations.length !== processing.coordinates.length || JSON.stringify(p.observations.map((row) => row.coordinate)) !== JSON.stringify(processing.coordinates) || !p.observations.some((row) => row.adverse === true)) fail('provider adverse coordinate set is incomplete');
    const ceilings = this._providerAdverseCeilings(p.repoId);
    for (const row of p.observations) {
      const rowFields = ['coordinate', 'dossierRef', 'snapshot', 'advisoryIds', 'maliciousAdvisoryIds', 'reverifyEvidence', 'officialDigest', 'adverse', 'contribution', 'aggregate', 'priorAggregateTarget', 'targets', 'targetSetDigest', 'examinedStateRows'];
      const snapshotFields = ['identity', 'recommendation', 'policyHash', 'policy', 'factDigest', 'asOf', 'expiresAt', 'indexEpoch', 'overlayDigest'];
      if (!row || Object.keys(row).sort().join(',') !== rowFields.sort().join(',') || !row.snapshot || Object.keys(row.snapshot).sort().join(',') !== snapshotFields.sort().join(',') || ![true, false].includes(row.adverse) || row.adverse !== (row.snapshot.recommendation !== 'borrow_candidate') || row.snapshot.policyHash !== p.policy.hash || row.snapshot.indexEpoch !== p.indexBinding.indexEpoch || !officialCoordinateMatches(row.snapshot.identity, row.coordinate) || !/^[a-f0-9]{64}$/.test(row.snapshot.factDigest ?? '') || !/^[a-f0-9]{64}$/.test(row.officialDigest ?? '')) fail('provider official observation is invalid');
      if (Object.keys(row.dossierRef ?? {}).sort().join(',') !== ['kind', 'mediaType', 'handle', 'digest', 'bytes'].sort().join(',') || row.dossierRef.kind !== 'dependency-dossier' || row.dossierRef.mediaType !== 'application/vnd.baton.dependency-dossier+json' || row.dossierRef.handle !== `art:sha256:${row.dossierRef.digest}` || !/^[a-f0-9]{64}$/.test(row.dossierRef.digest ?? '') || !Number.isSafeInteger(row.dossierRef.bytes) || row.dossierRef.bytes <= 0) fail('provider official dossier reference is invalid');
      if (!Array.isArray(row.advisoryIds) || JSON.stringify(row.advisoryIds) !== JSON.stringify([...new Set(row.advisoryIds)].sort()) || row.advisoryIds.some((id) => !boundedText(id, 256)) || !Array.isArray(row.maliciousAdvisoryIds) || JSON.stringify(row.maliciousAdvisoryIds) !== JSON.stringify([...new Set(row.maliciousAdvisoryIds)].sort()) || row.maliciousAdvisoryIds.some((id) => !row.advisoryIds.includes(id)) || (row.adverse && row.advisoryIds.length === 0)) fail('provider official advisory identities are invalid');
      const asOf = Date.parse(row.snapshot.asOf); const expires = Date.parse(row.snapshot.expiresAt); const at = Date.parse(event.ts); if (!Number.isFinite(asOf) || !Number.isFinite(expires) || !Number.isFinite(at) || asOf > at || at >= expires) fail('provider official observation is stale or incoherent');
      const evidenceSeq = row.reverifyEvidence?.coordinationSeq; const mapped = Number.isSafeInteger(evidenceSeq) ? this._events[evidenceSeq - 1] : null; const authoritative = mapped ? this._evidence.get(`${mapped.payload?.worker}:${mapped.payload?.workerSeq}`) : null; const source = mapped ? this._operationalRead?.(mapped.payload?.worker, mapped.payload?.workerSeq) : null;
      const projection = { processingId: p.processingId, coordinate: row.coordinate, dossierDigest: row.dossierRef.digest, factDigest: row.snapshot.factDigest, policyHash: p.policy.hash, indexBindingDigest: p.indexBinding.bindingDigest, recommendation: row.snapshot.recommendation, asOf: row.snapshot.asOf, expiresAt: row.snapshot.expiresAt, advisoryIds: row.advisoryIds, maliciousAdvisoryIds: row.maliciousAdvisoryIds };
      if (!mapped || mapped.kind !== 'evidence.mapped' || mapped.seq >= event.seq || mapped.payload?.kind !== 'knowledge.reuse_provider_reverified' || !authoritative || canonicalDigest(authoritative) !== canonicalDigest(row.reverifyEvidence) || !source || source.kind !== 'knowledge.reuse_provider_reverified' || digest(source) !== mapped.payload.digest || source.actor !== event.actor || canonicalDigest(source.payload) !== canonicalDigest({ ...projection, officialDigest: canonicalDigest(projection) }) || row.officialDigest !== canonicalDigest(projection)) fail('provider official reverify evidence is invalid');
      const targetProjection = row.adverse ? this._providerAdverseTargets(p.repoId, row.coordinate, ceilings) : { targets: [], examinedStateRows: 0, affectedReads: 0, derivationOverflow: false };
      const expectedPriorAggregateTarget = row.adverse ? this._providerAggregateTarget(p.repoId, row.coordinate) : null; const aggregateReads = expectedPriorAggregateTarget?.affectedReadEvents.length ?? 0;
      if (targetProjection.derivationOverflow || targetProjection.targets.length > ceilings.maxDecisionTargets || targetProjection.affectedReads + aggregateReads > ceilings.maxAffectedReads || targetProjection.examinedStateRows > ceilings.maxStateRows) fail('provider adverse target projection exceeded deployment ceiling', 'reuse_risk_oversize');
      if (canonicalDigest(row.targets) !== canonicalDigest(targetProjection.targets) || canonicalDigest(row.priorAggregateTarget) !== canonicalDigest(expectedPriorAggregateTarget) || row.examinedStateRows !== targetProjection.examinedStateRows || row.targetSetDigest !== canonicalDigest({ targets: row.targets, priorAggregateTarget: row.priorAggregateTarget, examinedStateRows: row.examinedStateRows })) fail('provider adverse target projection is invalid');
      if (row.adverse) {
        const expectedContribution = this._providerContribution(row, processing, p.policy); const existingContribution = this._reuseProviderContributions.get(expectedContribution.id);
        if (canonicalDigest(row.contribution) !== canonicalDigest(expectedContribution) || (existingContribution && canonicalDigest(existingContribution) !== canonicalDigest(expectedContribution))) fail('provider adverse contribution identity conflicts', 'provider_contribution_conflict');
        const expectedAggregate = this._providerAggregate(p.repoId, row.coordinate, expectedContribution, p.policy);
        if (expectedAggregate.contributionIds.length > ceilings.maxGuardTargets || canonicalDigest(row.aggregate) !== canonicalDigest(expectedAggregate)) fail('provider adverse aggregate is invalid', 'reuse_risk_oversize');
        const officialNodeId = `source:provider-official:${row.officialDigest}`; const findingId = `finding:reuse-provider:${expectedContribution.id.slice('provider-contribution:'.length)}`; const aggregateFindingId = `finding:reuse-provider-aggregate:${expectedAggregate.guardDigest}`;
        if (this._knowledgeNodes.has(officialNodeId)) fail('provider official Source identity is preoccupied', 'reuse_namespace_conflict');
        if (!existingContribution && this._knowledgeNodes.has(findingId)) fail('provider contribution Finding identity is preoccupied', 'reuse_namespace_conflict');
        if (this._knowledgeNodes.has(aggregateFindingId)) fail('provider aggregate Finding identity is preoccupied', 'reuse_namespace_conflict');
        for (const target of row.targets) if (this._knowledgeEdges.has(`knowledge-edge:affects:${aggregateFindingId}:${target.nodeId}`)) fail('provider adverse Affects identity is preoccupied', 'reuse_namespace_conflict');
      } else if (row.contribution !== null || row.aggregate !== null || row.priorAggregateTarget !== null || row.targets.length !== 0 || row.examinedStateRows !== 0) fail('provider green coordinate cannot carry adverse authority');
    }
    const core = Object.fromEntries(Object.entries(p).filter(([key]) => key !== 'completionDigest'));
    if (p.completionDigest !== canonicalDigest(core)) fail('provider adverse completion digest is invalid');
    const exactEvent = { schemaVersion: 1, seq: event.seq, ts: event.ts, kind: 'knowledge.reuse_provider_guarded', actor: event.actor, idempotencyKey: event.idempotencyKey, payload: p };
    if (Buffer.byteLength(`${JSON.stringify(exactEvent)}\n`) > ceilings.maxEventBytes) fail('provider adverse completion exceeded event byte ceiling', 'reuse_risk_oversize');
  }
  _setKnowledgeNode(event, id, value) {
    return coordinationInternals._setKnowledgeNode(this, event, id, value);
  }
  _setKnowledgeEdge(event, id, value) {
    return coordinationInternals._setKnowledgeEdge(this, event, id, value);
  }

  _knowledgeVersionsAt(history, observedSeq, observedAt) { return coordinationLedger._knowledgeVersionsAt(history, observedSeq, observedAt); }

  _validateFleetDrainAdmission(p, event, integrity = false) {
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

  _validateFleetDrainCompletion(p, event, integrity = false) {
    const fail = (message) => { throw integrity ? new CoordinationIntegrityError(message, 'fleet_drain_integrity') : new CoordinationRefusal(message, 'fleet_drain_integrity'); };
    const fields = ['schemaVersion', 'drainId', 'receipt'];
    if (!p || Object.keys(p).sort().join(',') !== fields.sort().join(',') || p.schemaVersion !== 1 || typeof p.drainId !== 'string') fail('fleet drain completion is invalid');
    const drain = this._fleetDrains.get(p.drainId);
    if (!drain || drain.status !== 'admitted' || drain.receipt !== null) fail('fleet drain completion has no open admission');
    const admissionEvent = this._events[drain.admittedEvent - 1];
    const idempotencyKey = this._validateFleetDrainAdmission(admissionEvent?.payload, admissionEvent ?? {}, integrity);
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

  _validateFleetDrainDisposition(p, event, integrity = false) {
    const fail = (message) => { throw integrity ? new CoordinationIntegrityError(message, 'fleet_drain_integrity') : new CoordinationRefusal(message, 'fleet_drain_integrity'); };
    const fields = ['schemaVersion', 'drainId', 'workerId', 'disposition'];
    if (!p || Object.keys(p).sort().join(',') !== fields.sort().join(',') || p.schemaVersion !== 1
      || typeof p.drainId !== 'string' || !validRunId(p.workerId)
      || !['pendingCancelled', 'killConfirmed', 'alreadyTerminal'].includes(p.disposition)) fail('fleet drain disposition is invalid');
    const drain = this._fleetDrains.get(p.drainId);
    if (!drain || drain.status !== 'admitted' || !drain.targetWorkerIds.includes(p.workerId)) fail('fleet drain disposition has no open target');
    const admissionEvent = this._events[drain.admittedEvent - 1];
    const expectedKey = `fleet.drain.disposition:${canonicalDigest({ drainId: p.drainId, workerId: p.workerId })}`;
    if (event.actor !== admissionEvent?.actor || event.idempotencyKey !== expectedKey) fail('fleet drain disposition authority is invalid');
    const prior = (drain.dispositions ?? []).find((row) => row.workerId === p.workerId);
    if (prior && prior.disposition !== p.disposition) fail('fleet drain disposition conflicts with durable history');
    return drain;
  }

  _runStopContextTargets(targetRunIds) { return coordinationLedger._runStopContextTargets(this, targetRunIds); }

  _runStopTargets(runId, throughSeq = this._events.length, contextVersion = 3) { return coordinationLedger._runStopTargets(this, runId, throughSeq, contextVersion); }

  _validSessionPreservationReceipt(receipt, allowHistorical = false) { return coordinationLedger._validSessionPreservationReceipt(receipt, allowHistorical); }
  _validPreservedContinuationReceipt(receipt) {
    return coordinationReplay._validPreservedContinuationReceipt(receipt);
  }

  _validateRunControlAdmission(p, event, integrity = false) {
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
    if (this.runStop(p.runId)) fail(`run ${p.runId} is stopping`, 'run_stopping');
    return p;
  }

  _validateRunControlEffect(p, event, integrity = false) {
    const fail = (message, code = 'run_control_integrity') => {
      throw integrity ? new CoordinationIntegrityError(message, code)
        : new CoordinationRefusal(message, code);
    };
    const fields = [
      'admissionDigest', 'controlId', 'effectDigest', 'providerRequestId',
      'schemaVersion', 'targetDigest',
      ...(p?.schemaVersion >= 2 ? ['turnDisposition'] : []),
    ];
    const control = this._runControls.get(p?.controlId);
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
    if (this.runStop(control.runId)) fail(`run ${control.runId} is stopping`, 'run_stopping');
    return control;
  }

  _validateRunControlProviderAck(p, event, integrity = false) {
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
    const control = this._runControls.get(p?.controlId);
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
        || !this._validSessionPreservationReceipt(p.outcome.preservation, integrity)
        || !this._validPreservedContinuationReceipt(p.outcome.continuation)
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

  _validateRunControlSettlement(p, event, integrity = false) {
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
    const control = this._runControls.get(p?.controlId);
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
        || !this._validSessionPreservationReceipt(
          p.outcome.preservation, integrity || continuesHistoricalAck,
        )
        || !this._validPreservedContinuationReceipt(p.outcome.continuation)
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

  _validateRunStopAdmission(p, event, integrity = false) {
    const fail = (message, code = 'run_stop_integrity') => {
      throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code);
    };
    const version = p?.schemaVersion;
    const contextFields = version >= 2 ? [
      'targetContextSessionIds', 'targetContextCellIds',
      ...(version >= 3 ? ['targetContextCallIds'] : []),
    ] : [];
    const fields = this._runLineagePolicy
      ? ['schemaVersion', 'scope', 'repoId', 'runId', 'reasonDigest', 'requestDigest', 'throughSeq', 'targetRunIds', 'targetTaskIds', 'targetWorkerIds', 'targetDigest', ...contextFields]
      : ['schemaVersion', 'repoId', 'runId', 'reasonDigest', 'requestDigest', 'targetTaskIds', 'targetWorkerIds', 'targetDigest', ...contextFields];
    if (!p || Object.keys(p).sort().join(',') !== fields.sort().join(',') || ![1, 2, 3].includes(version)
      || !validRunId(p.repoId) || !validRunId(p.runId) || !/^[a-f0-9]{64}$/.test(p.reasonDigest ?? '')
      || !/^[a-f0-9]{64}$/.test(p.requestDigest ?? '') || !/^[a-f0-9]{64}$/.test(p.targetDigest ?? '')
      || !Array.isArray(p.targetTaskIds) || !Array.isArray(p.targetWorkerIds)
      || p.targetTaskIds.some((id) => !boundedText(id, 4_096)) || p.targetWorkerIds.some((id) => !validRunId(id))
      || (this._runLineagePolicy && (p.scope !== 'run_subtree'
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
      assertTargetSetAdmissible('targetTaskIds', p.targetTaskIds.length, this._events.length);
      assertTargetSetAdmissible('targetWorkerIds', p.targetWorkerIds.length, this._events.length);
      if (version >= 2) {
        assertTargetSetAdmissible('targetContextSessionIds', p.targetContextSessionIds.length, this._events.length);
        assertTargetSetAdmissible('targetContextCellIds', p.targetContextCellIds.length, this._events.length);
      }
      if (version >= 3) assertTargetSetAdmissible('targetContextCallIds', p.targetContextCallIds.length, this._events.length);
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
    const digestCore = this._runLineagePolicy ? {
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
      || (this._runLineagePolicy
        ? (new Set(p.targetRunIds).size !== p.targetRunIds.length
          || JSON.stringify([...p.targetRunIds].sort(compareCanonicalStrings)) !== JSON.stringify(p.targetRunIds)
          || p.targetDigest !== canonicalDigest(digestCore))
        : p.targetDigest !== canonicalDigest(digestCore))) {
      fail('run stop admission binding is invalid');
    }
    if (event.idempotencyKey !== `run.stop:${p.runId}` || !boundedText(event.actor, 256)) fail('run stop authority is invalid');
    const targets = this._runStopTargets(
      p.runId, this._runLineagePolicy ? p.throughSeq : undefined, version,
    );
    const observed = this._runLineagePolicy ? {
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

  _validateRunStopCompletion(p, event, integrity = false) {
    const fail = (message) => {
      throw integrity ? new CoordinationIntegrityError(message, 'run_stop_integrity') : new CoordinationRefusal(message, 'run_stop_integrity');
    };
    if (!p || Object.keys(p).sort().join(',') !== ['receipt', 'runId', 'schemaVersion'].join(',')
      || ![1, 2, 3].includes(p.schemaVersion) || !validRunId(p.runId)) fail('run stop completion is invalid');
    const stop = this._runStops.get(p.runId);
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
        this._contextSessions.get(sessionId)?.state ?? null
      ));
      const cellStates = stop.targetContextCellIds.map((cellId) => (
        this._contextCells.get(cellId)?.state ?? null
      ));
      const callStates = (stop.targetContextCallIds ?? []).map((callId) => (
        this._contextCalls.get(callId)?.state ?? null
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

  _runResultAdoptionKey(runId, nodeKey) { return coordinationLedger._runResultAdoptionKey(runId, nodeKey); }

  _runResultAdoptionFailure(message, code = 'run_result_adoption_integrity', integrity = false) {
    throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code);
  }

  _normalizeRunResultAdoptionRequest(fields, event, integrity = false) {
    const fail = (message, code = 'run_result_adoption_invalid') => this._runResultAdoptionFailure(message, code, integrity);
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

  _deriveRunResultAdoptionBinding(request, integrity = false) {
    const fail = (message, code = 'run_result_adoption_unavailable') => this._runResultAdoptionFailure(message, code, integrity);
    const task = this._tasks.get(request.taskId);
    const dispatch = this._planTaskLinks.get(request.taskId);
    const goalPlan = task?.brief?.goalPlan;
    if (!task || task.runId !== request.runId || task.status !== 'completed' || task.acceptanceRevocation
      || !dispatch || !goalPlan || dispatch.taskId !== task.id || dispatch.binding?.nodeKey !== request.nodeKey
      || canonicalDigest(dispatch.binding) !== canonicalDigest(goalPlan)) {
      fail('run result adoption requires the exact completed approved Plan task');
    }
    const goal = this._goals.get(this._goalVersionKey(goalPlan.goalId, goalPlan.goalVersion));
    const plan = this._plans.get(this._planVersionKey(goalPlan.planId, goalPlan.planVersion));
    const approval = this._planApprovals.get(this._planVersionKey(goalPlan.planId, goalPlan.planVersion));
    const node = plan?.nodes?.find((row) => row.key === request.nodeKey);
    if (!goal || !plan || !approval || approval.disposition !== 'approved' || !node
      || goal.repoId !== request.repoId || goal.runId !== request.runId
      || plan.repoId !== request.repoId || plan.runId !== request.runId
      || goal.digest !== goalPlan.goalDigest || plan.digest !== goalPlan.planDigest
      || approval.digest !== goalPlan.approvalDigest) {
      fail('run result adoption Plan authority is unavailable');
    }
    const artifacts = task.artifactIds.map((id) => this._artifacts.get(id)).filter(Boolean);
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
    const mapped = this._events[shared[0] - 1];
    const source = mapped?.kind === 'evidence.mapped'
      ? this._operationalRead?.(mapped.payload.worker, mapped.payload.workerSeq) : null;
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

  _validateRunResultAdoptionAdmission(p, event, integrity = false) {
    const fail = (message, code = 'run_result_adoption_integrity') => this._runResultAdoptionFailure(message, code, integrity);
    const fields = ['adoptionDigest', 'binding', 'evidenceDigest', 'nodeKey', 'reasonDigest', 'repoId', 'requestDigest', 'resultSha', 'retainedResultRef', 'runId', 'schemaVersion', 'taskId'];
    if (!p || typeof p !== 'object' || Array.isArray(p)
      || Object.keys(p).sort().join(',') !== fields.sort().join(',') || p.schemaVersion !== 1
      || !/^[a-f0-9]{64}$/.test(p.adoptionDigest ?? '')) fail('run result adoption admission is malformed');
    const request = this._normalizeRunResultAdoptionRequest(Object.fromEntries(
      ['schemaVersion', 'repoId', 'runId', 'nodeKey', 'taskId', 'resultSha', 'evidenceDigest', 'reasonDigest', 'requestDigest']
        .map((key) => [key, p[key]]),
    ), event, integrity);
    if (p.retainedResultRef !== retainedResultRef(request.resultSha)) fail('run result adoption retained ref is invalid');
    const binding = this._deriveRunResultAdoptionBinding(request, integrity);
    if (canonicalDigest(p.binding) !== canonicalDigest(binding)) fail('run result adoption binding diverged');
    const core = Object.fromEntries(Object.entries(p).filter(([key]) => key !== 'adoptionDigest'));
    if (p.adoptionDigest !== canonicalDigest(core)) fail('run result adoption admission digest is invalid');
    if (this._runResultAdoptions.has(this._runResultAdoptionKey(p.runId, p.nodeKey))) fail('run result adoption identity is already occupied');
    return binding;
  }

  _validateRunResultAdoptionCompletion(p, event, integrity = false) {
    const fail = (message, code = 'run_result_adoption_integrity') => this._runResultAdoptionFailure(message, code, integrity);
    if (!p || typeof p !== 'object' || Array.isArray(p)
      || Object.keys(p).sort().join(',') !== ['nodeKey', 'receipt', 'runId', 'schemaVersion'].join(',')
      || p.schemaVersion !== 1 || !validRunId(p.runId) || !boundedText(p.nodeKey, 256)) {
      fail('run result adoption completion is malformed');
    }
    const adoption = this._runResultAdoptions.get(this._runResultAdoptionKey(p.runId, p.nodeKey));
    if (!adoption || adoption.status !== 'pending' || adoption.receipt !== null) fail('run result adoption completion has no pending admission');
    if (event?.idempotencyKey !== `run.result_adoption.complete:${p.runId}:${p.nodeKey}` || event.actor !== adoption.actor) {
      fail('run result adoption completion authority is invalid');
    }
    const binding = this._deriveRunResultAdoptionBinding(adoption, integrity);
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

  _runResultExportFailure(message, code = 'run_result_export_integrity', integrity = false) {
    throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code);
  }

  _normalizeRunResultExportRequest(fields, event, integrity = false) {
    const fail = (message, code = 'run_result_export_invalid') => this._runResultExportFailure(message, code, integrity);
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

  _deriveRunResultExportBinding(request, integrity = false) {
    const fail = (message, code = 'run_result_export_unavailable') => this._runResultExportFailure(message, code, integrity);
    const accepted = this._deriveRunResultAdoptionBinding(request, integrity);
    let adoption = null;
    if (request.adoptionReceiptDigest !== null) {
      const state = this._runResultAdoptions.get(this._runResultAdoptionKey(request.runId, request.nodeKey));
      if (!state || state.status !== 'adopted' || state.resultSha !== request.resultSha
        || state.receipt?.receiptDigest !== request.adoptionReceiptDigest) {
        fail('run result export adoption receipt is unavailable');
      }
      adoption = { admissionDigest: state.adoptionDigest, receiptDigest: state.receipt.receiptDigest };
    }
    let semanticReview = null;
    if (request.semanticReviewReceiptDigest !== null) {
      const review = this._tasks.get(request.semanticReviewTaskId);
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
      const task = this._tasks.get(request.taskId);
      const reports = (task?.artifactIds ?? []).map((id) => this._artifacts.get(id)).filter((artifact) => artifact
        && artifact.accepted === true && artifact.supersededBy === null
        && !Object.hasOwn(artifact, 'acceptanceInvalidation')
        && artifact.mediaType === 'application/vnd.baton.integration+json'
        && artifact.refs?.resultSha === request.resultSha && artifact.refs?.afterSha === request.integrationAfterSha);
      if (reports.length !== 1) fail('run result export integration receipt is unavailable');
      integration = { artifactId: reports[0].id, artifactDigest: reports[0].digest, afterSha: request.integrationAfterSha };
    }
    return freeze({ accepted, adoption, semanticReview, integration });
  }

  _validateRunResultExportAdmission(p, event, integrity = false) {
    const fail = (message, code = 'run_result_export_integrity') => this._runResultExportFailure(message, code, integrity);
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
    const request = this._normalizeRunResultExportRequest(
      Object.fromEntries(requestFields.map((key) => [key, clone(p[key])])), event, integrity,
    );
    this._assertRunAdmissionOpen(request.runId);
    if (p.locator !== `export:${request.exportId}`) fail('run result export locator is invalid');
    const binding = this._deriveRunResultExportBinding(request, integrity);
    if (canonicalDigest(p.binding) !== canonicalDigest(binding)) fail('run result export binding diverged');
    const core = Object.fromEntries(Object.entries(p).filter(([key]) => key !== 'admissionDigest'));
    if (p.admissionDigest !== canonicalDigest(core)) fail('run result export admission digest is invalid');
    if ([...this._runResultExports.values()].some((state) => state.runId === request.runId && state.nodeKey === request.nodeKey)) {
      fail('run result export identity is already occupied');
    }
    return binding;
  }

  _validateRunResultExportCompletion(p, event, integrity = false) {
    const fail = (message, code = 'run_result_export_integrity') => this._runResultExportFailure(message, code, integrity);
    if (!p || typeof p !== 'object' || Array.isArray(p)
      || Object.keys(p).sort().join(',') !== ['exportId', 'receipt', 'schemaVersion'].join(',')
      || p.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(p.exportId ?? '')) fail('run result export completion is malformed');
    const state = this._runResultExports.get(p.exportId);
    if (!state || state.status !== 'pending' || state.receipt !== null) fail('run result export completion has no pending admission');
    if (event?.idempotencyKey !== `run.result_export.complete:${p.exportId}` || event.actor !== state.actor) {
      fail('run result export completion authority is invalid');
    }
    this._assertRunAdmissionOpen(state.runId);
    const binding = this._deriveRunResultExportBinding(state, integrity);
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

  _contextFailure(message, code, integrity = false) {
    if (integrity) throw new CoordinationIntegrityError(message, code);
    throw new CoordinationRefusal(message, code);
  }

  _contextDefinition(manifest, integrity = false) {
    const records = this._events.filter((event) => event.kind === 'driver.recorded'
      && event.payload?.kind === 'application.workflow_definition_bound'
      && event.payload?.repoId === manifest.repoId
      && event.payload?.runId === manifest.workflow.runId
      && event.payload?.planDigest === manifest.workflow.plan.digest
      && event.payload?.definitionDigest === manifest.workflow.definitionDigest);
    if (records.length !== 1) {
      this._contextFailure('Context Workflow definition is absent or ambiguous',
        'context_session_invalid', integrity);
    }
    const event = records[0];
    const { kind, definitionDigest, ...core } = event.payload;
    void kind;
    if (event.actor !== 'application:workflow-registry'
      || event.idempotencyKey
        !== `application.workflow_definition_bound:${manifest.workflow.runId}:${manifest.workflow.plan.digest}`
      || definitionDigest !== canonicalDigest(core)) {
      this._contextFailure('Context Workflow definition failed integrity validation',
        'context_session_invalid', integrity);
    }
    const plan = this._plans.get(this._planVersionKey(
      manifest.workflow.plan.planId, manifest.workflow.plan.version,
    ));
    if (event.payload.schemaVersion === 3) {
      const ancestors = this._events.filter((candidate) => (
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
        this._contextFailure(error.message, 'context_session_invalid', integrity);
      }
    } else if (Array.isArray(event.payload.attempts)) {
      try {
        if (!plan || plan.digest !== manifest.workflow.plan.digest) {
          throw new TypeError('Context Workflow Plan is unavailable');
        }
        validateWorkflowDefinitionLegacy(event.payload, { nodes: plan.nodes });
      } catch (error) {
        this._contextFailure(error.message, 'context_session_invalid', integrity);
      }
    }
    return event;
  }

  _currentContextDeployment() { return coordinationLedger._currentContextDeployment(this); }

  _normalizeContextDeployment(value, integrity = false) {
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
      this._contextFailure('Context deployment authority is malformed',
        integrity ? 'context_session_integrity' : 'context_session_invalid', integrity);
    }
    let policy;
    try { policy = normalizeContextProgramPolicy(value.policy); }
    catch (error) {
      this._contextFailure(error.message,
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
      this._contextFailure('Context deployment authority digest changed',
        integrity ? 'context_session_integrity' : 'context_session_invalid', integrity);
    }
    return freeze({ ...body, authorityDigest: value.authorityDigest });
  }

  _normalizeContextSourceAttestation(value, { deployment, manifest, node, branch, source = null },
    integrity = false) {
    const fail = (message) => this._contextFailure(message,
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
        value.repoId !== this._repoId || value.repoId !== manifest.repoId
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

  _assertContextSessionCurrent(session, integrity = false) {
    const manifest = session?.manifest;
    const deployment = this._normalizeContextDeployment(session?.deployment, integrity);
    if (!manifest || manifest.tree.source !== 'deployment_snapshot'
      || manifest.tree.sha !== deployment.deploymentBaseSha
      || session.environmentDigest !== deployment.environmentDigest
      || manifest.policyDigest !== deployment.policy.policyDigest
      || (!integrity && canonicalDigest(deployment)
        !== canonicalDigest(this._currentContextDeployment()))) {
      this._contextFailure('Context session tree, environment, or policy is stale',
        integrity ? 'context_session_integrity' : 'context_session_stale', integrity);
    }
    // REPL-1 rule 12: the cell-admission currency gate for a ReplManifest session keys on the
    // settled admission record, not a working Plan-gated dispatch. `admitContextCell`'s
    // caller-principal pin (canonicalDigest(authority) !== session.authority) then remains the
    // load-bearing authorization: only the admitting principal may compute REPL cells.
    if (manifest.kind === 'baton.repl_manifest') {
      const admission = this._replManifestAdmissions.get(session.manifestDigest);
      if (!admission || admission.runId !== session.runId
        || admission.replRole !== manifest.repl.replRole) {
        this._contextFailure('Context REPL session admission is stale',
          integrity ? 'context_session_integrity' : 'context_session_stale', integrity);
      }
      this._assertRunAdmissionOpen(session.runId, integrity);
      return freeze({ goal: null, plan: null, node: null, task: null });
    }
    const goal = this._goals.get(this._goalVersionKey(
      manifest.workflow.goal.goalId, manifest.workflow.goal.version,
    ));
    const plan = this._plans.get(this._planVersionKey(
      manifest.workflow.plan.planId, manifest.workflow.plan.version,
    ));
    const goalHead = this._goalHeads.get(this._goalScopeKey(this._repoId, session.runId));
    const planHead = goal ? this._planHeads.get(this._planHeadKey(goal)) : null;
    const approval = plan
      ? this._planApprovals.get(this._planVersionKey(plan.planId, plan.version)) : null;
    if (!goal || !plan
      || goal.digest !== manifest.workflow.goal.digest
      || plan.digest !== manifest.workflow.plan.digest
      || goal.repoId !== this._repoId || goal.runId !== session.runId
      || plan.repoId !== this._repoId || plan.runId !== session.runId
      || canonicalDigest(plan.goal) !== canonicalDigest(manifest.workflow.goal)
      || goalHead?.digest !== goal.digest || planHead?.digest !== plan.digest
      || approval?.disposition !== 'approved') {
      this._contextFailure('Context session Goal or Plan authority is stale',
        integrity ? 'context_session_integrity' : 'context_session_stale', integrity);
    }
    this._contextDefinition(manifest, integrity);
    const node = plan.nodes.find((candidate) => candidate.key === manifest.workflow.node.key);
    const task = this._tasks.get(manifest.workflow.task.taskId);
    const dispatch = this._planTaskLinks.get(manifest.workflow.task.taskId);
    if (!node || contextValueDigest(node) !== manifest.workflow.node.digest
      || !task || task.runId !== session.runId || task.status !== 'working'
      || task.version !== manifest.workflow.task.version
      || task.createdEvent !== manifest.workflow.task.createdEvent
      || task.claimedEvent !== manifest.workflow.task.claimedEvent
      || dispatch?.binding?.planId !== plan.planId
      || dispatch?.binding?.planVersion !== plan.version
      || dispatch?.binding?.planDigest !== plan.digest
      || dispatch?.binding?.nodeKey !== node.key) {
      this._contextFailure('Context session node or claimed task authority is stale',
        integrity ? 'context_session_integrity' : 'context_session_stale', integrity);
    }
    this._assertRunAdmissionOpen(session.runId, integrity);
    return freeze({ goal, plan, node, task });
  }

  _validateContextSessionPayload(payload, event, integrity = false) {
    if (!this._contextProgramPolicy) {
      this._contextFailure('Context Program authority is unavailable',
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
      this._contextFailure('Context session event is malformed', 'context_session_integrity', integrity);
    }
    try { normalizeContextAuthority(payload.authority); }
    catch (error) {
      this._contextFailure(error.message,
        integrity ? 'context_session_integrity' : 'context_session_invalid', integrity);
    }
    const deployment = this._normalizeContextDeployment(payload.deployment, integrity);
    let session;
    try {
      session = contextSessionIdentity({
        manifest: payload.session?.manifest,
        environmentDigest: payload.session?.environmentDigest,
        policy: deployment.policy,
      });
    } catch (error) {
      this._contextFailure(error.message, integrity ? 'context_session_integrity' : 'context_session_invalid',
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
    if (payload.authority.repoId !== this._repoId
      || payload.authority.runId !== session.runId
      || session.repoId !== this._repoId
      || payload.requestDigest !== canonicalDigest(requestCore)
      || payload.admissionDigest !== canonicalDigest(admissionCore)
      || canonicalDigest(payload.session) !== canonicalDigest(expectedSession)
      || canonicalDigest(payload.deployment) !== canonicalDigest(deployment)
      || event.idempotencyKey !== `context.session:${session.manifestDigest}`
      || event.actor !== payload.authority.actor) {
      this._contextFailure('Context session authority or identity changed',
        integrity ? 'context_session_integrity' : 'context_session_invalid', integrity);
    }
    const manifest = session.manifest;
    if (manifest.tree.source !== 'deployment_snapshot'
      || manifest.tree.sha !== deployment.deploymentBaseSha
      || session.environmentDigest !== deployment.environmentDigest
      || manifest.policyDigest !== deployment.policy.policyDigest
      || (!integrity && canonicalDigest(deployment)
        !== canonicalDigest(this._currentContextDeployment()))) {
      this._contextFailure('Context session tree, environment, or policy differs from deployment authority',
        integrity ? 'context_session_integrity' : 'context_session_invalid', integrity);
    }
    // REPL-1 rule 10a: a ReplManifest session skips the Workflow goal/plan/approval and
    // node/task/dispatch blocks entirely and is instead grounded by its settled
    // `repl.manifest_admitted` record (which folds at a lower seq, so this is replay-derivable).
    if (manifest.kind === 'baton.repl_manifest') {
      const admission = this._replManifestAdmissions.get(session.manifestDigest);
      if (!admission || admission.runId !== session.runId
        || admission.replRole !== manifest.repl.replRole
        || admission.principal?.actor !== payload.authority.actor
        || admission.principal?.principalId !== payload.authority.principalId) {
        this._contextFailure('Context REPL session has no settled manifest admission',
          integrity ? 'context_session_integrity' : 'context_session_invalid', integrity);
      }
      this._assertRunAdmissionOpen(session.runId, integrity);
      return freeze({
        session: freeze({ ...session, deployment, sourceAttestations: [] }),
        requestCore, admissionCore,
      });
    }
    const goal = this._goals.get(this._goalVersionKey(
      manifest.workflow.goal.goalId, manifest.workflow.goal.version,
    ));
    const plan = this._plans.get(this._planVersionKey(
      manifest.workflow.plan.planId, manifest.workflow.plan.version,
    ));
    const goalHead = this._goalHeads.get(this._goalScopeKey(this._repoId, session.runId));
    const planHead = goal ? this._planHeads.get(this._planHeadKey(goal)) : null;
    const approval = plan ? this._planApprovals.get(this._planVersionKey(plan.planId, plan.version)) : null;
    if (!goal || !plan
      || goal.digest !== manifest.workflow.goal.digest
      || plan.digest !== manifest.workflow.plan.digest
      || goal.repoId !== this._repoId || goal.runId !== session.runId
      || plan.repoId !== this._repoId || plan.runId !== session.runId
      || canonicalDigest(plan.goal) !== canonicalDigest(manifest.workflow.goal)
      || goalHead?.digest !== goal.digest || planHead?.digest !== plan.digest
      || approval?.disposition !== 'approved') {
      this._contextFailure('Context session Goal or Plan authority is stale',
        integrity ? 'context_session_integrity' : 'context_session_invalid', integrity);
    }
    this._contextDefinition(manifest, integrity);
    const node = plan.nodes.find((candidate) => candidate.key === manifest.workflow.node.key);
    const task = this._tasks.get(manifest.workflow.task.taskId);
    const dispatch = this._planTaskLinks.get(manifest.workflow.task.taskId);
    if (!node || contextValueDigest(node) !== manifest.workflow.node.digest
      || !task || task.runId !== session.runId || task.status !== 'working'
      || task.version !== manifest.workflow.task.version
      || task.createdEvent !== manifest.workflow.task.createdEvent
      || task.claimedEvent !== manifest.workflow.task.claimedEvent
      || dispatch?.binding?.planId !== plan.planId
      || dispatch?.binding?.planVersion !== plan.version
      || dispatch?.binding?.planDigest !== plan.digest
      || dispatch?.binding?.nodeKey !== node.key) {
      this._contextFailure('Context session node or claimed task authority changed',
        integrity ? 'context_session_integrity' : 'context_session_invalid', integrity);
    }
    let sourceAttestations = [];
    if (payload.schemaVersion === 2) {
      if (!Array.isArray(payload.sourceAttestations)
        || payload.sourceAttestations.length !== manifest.branches.length) {
        this._contextFailure('Context session source attestations are incomplete',
          integrity ? 'context_session_integrity' : 'context_session_invalid', integrity);
      }
      sourceAttestations = manifest.branches.map((branch, index) => (
        this._normalizeContextSourceAttestation(payload.sourceAttestations[index], {
          deployment, manifest, node, branch,
        }, integrity)
      ));
    }
    this._assertRunAdmissionOpen(session.runId, integrity);
    return freeze({
      session: freeze({ ...session, deployment, sourceAttestations }),
      requestCore, admissionCore,
    });
  }

  _validateContextCellAdmissionPayload(payload, event, integrity = false) {
    const fields = ['admissionDigest', 'authority', 'cell', 'requestDigest', 'schemaVersion'];
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Object.keys(payload).sort().join(',') !== fields.sort().join(',')
      || payload.schemaVersion !== 1
      || !payload.authority || typeof payload.authority !== 'object'
      || Array.isArray(payload.authority)
      || Object.keys(payload.authority).sort().join(',')
        !== ['actor', 'principalId', 'repoId', 'runId'].sort().join(',')) {
      this._contextFailure('Context cell admission is malformed',
        'context_cell_integrity', integrity);
    }
    try { normalizeContextAuthority(payload.authority); }
    catch (error) {
      this._contextFailure(error.message,
        integrity ? 'context_cell_integrity' : 'context_cell_invalid', integrity);
    }
    const session = this._contextSessions.get(payload.cell?.sessionId);
    if (!session) this._contextFailure('Context cell session is unavailable',
      integrity ? 'context_cell_integrity' : 'context_cell_invalid', integrity);
    let cell;
    const contextPolicy = this._normalizeContextDeployment(session.deployment, integrity).policy;
    try {
      cell = contextCellIdentity({
        session, program: payload.cell?.program, ordinal: payload.cell?.ordinal,
        predecessor: payload.cell?.predecessor ?? null, policy: contextPolicy,
      });
    } catch (error) {
      this._contextFailure(error.message, integrity ? 'context_cell_integrity' : 'context_cell_invalid',
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
      this._contextFailure('Context cell principal differs from session admission',
        integrity ? 'context_cell_integrity' : 'context_cell_unauthorized', integrity);
    }
    if (payload.authority.repoId !== this._repoId || payload.authority.runId !== session.runId
      || payload.requestDigest !== canonicalDigest(requestCore)
      || payload.admissionDigest !== cell.admissionDigest
      || canonicalDigest(payload.cell) !== canonicalDigest(cell)
      || event.idempotencyKey !== `context.cell:${session.sessionId}:${cell.programDigest}`
      || event.actor !== payload.authority.actor
      || !contextProgramIsPure(cell.program, contextPolicy)) {
      this._contextFailure('Context cell authority or identity changed',
        integrity ? 'context_cell_integrity' : 'context_cell_invalid', integrity);
    }
    const cells = [...this._contextCells.values()].filter((row) => row.sessionId === session.sessionId);
    const expectedOrdinal = cells.length + 1;
    const expectedPredecessor = cells.length === 0 ? null : cells.at(-1).cellId;
    if (cell.ordinal !== expectedOrdinal || cell.predecessor !== expectedPredecessor
      || cells.length >= contextPolicy.maxCellsPerSession) {
      this._contextFailure('Context cell sequence is stale or exhausted',
        integrity ? 'context_cell_integrity' : 'context_cell_invalid', integrity);
    }
    this._assertContextSessionCurrent(session, integrity);
    return cell;
  }

  _validateContextCellSettlementPayload(payload, event, integrity = false) {
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
      this._contextFailure('Context cell settlement is malformed',
        'context_cell_settlement_integrity', integrity);
    }
    try { normalizeContextAuthority(payload.authority); }
    catch (error) {
      this._contextFailure(error.message,
        integrity ? 'context_cell_settlement_integrity' : 'context_cell_settlement_invalid', integrity);
    }
    const cell = this._contextCells.get(payload.cellId);
    if (!cell || cell.state !== 'admitted' || cell.version !== payload.expectedVersion) {
      this._contextFailure('Context cell settlement target is stale',
        integrity ? 'context_cell_settlement_integrity' : 'context_cell_settlement_invalid', integrity);
    }
    if (canonicalDigest(payload.authority) !== canonicalDigest(cell.authority)
      || event.actor !== payload.authority.actor) {
      this._contextFailure('Context cell settlement principal differs from admission',
        integrity ? 'context_cell_settlement_integrity'
          : 'context_cell_settlement_unauthorized', integrity);
    }
    const session = this._contextSessions.get(cell.sessionId);
    const contextPolicy = this._normalizeContextDeployment(session?.deployment, integrity).policy;
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
      this._contextFailure(error.message,
        integrity ? 'context_cell_settlement_integrity' : 'context_cell_settlement_invalid', integrity);
    }
    const settlementCore = {
      authority: payload.authority,
      cellId: cell.cellId, admissionDigest: cell.admissionDigest,
      expectedVersion: 1, newVersion: 2, result: expectedResult,
    };
    if (payload.settlementDigest !== canonicalDigest(settlementCore)
      || event.idempotencyKey !== `context.cell.settle:${cell.cellId}:${cell.admissionDigest}`) {
      this._contextFailure('Context cell settlement identity changed',
        integrity ? 'context_cell_settlement_integrity' : 'context_cell_settlement_invalid', integrity);
    }
    return freeze({ cell, result: freeze(clone(expectedResult)), settlementCore });
  }
  _contextCallRunId(call) {
    return coordinationInternals._contextCallRunId(call);
  }

  _validateContextMapCallAdmissionPayload(payload, event, integrity = false) {
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
      this._contextFailure('Context map call admission is malformed',
        'context_map_call_integrity', integrity);
    }
    let authority; let call;
    try {
      authority = normalizeContextAuthority(payload.authority);
      call = normalizeContextMapCall(payload.call);
    } catch (error) {
      this._contextFailure(error.message,
        integrity ? 'context_map_call_integrity' : 'context_map_call_invalid', integrity);
    }
    const source = call.source;
    const session = this._contextSessions.get(source.sessionId);
    const cell = this._contextCells.get(source.cellId);
    if (!session || !cell || cell.sessionId !== session.sessionId || cell.state !== 'completed'
      || !cell.result || authority.repoId !== this._repoId || authority.runId !== source.runId
      || canonicalDigest(authority) !== canonicalDigest(cell.authority)
      || source.repoId !== this._repoId || source.runId !== session.runId
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
      this._contextFailure('Context map source authority changed',
        integrity ? 'context_map_call_integrity' : 'context_map_source_stale', integrity);
    }

    // The source Context session is current at call admission. The successor Plan deliberately
    // advances the head immediately afterward, so replay/recovery must validate these historical
    // coordinates rather than call _assertContextSessionCurrent after proposal.
    const predecessor = this._plans.get(this._planVersionKey(
      source.predecessorPlan.planId, source.predecessorPlan.version,
    ));
    const goal = predecessor ? this._goals.get(this._goalVersionKey(
      predecessor.goal.goalId, predecessor.goal.version,
    )) : null;
    const goalHead = goal ? this._goalHeads.get(this._goalScopeKey(this._repoId, source.runId)) : null;
    const planHead = goal ? this._planHeads.get(this._planHeadKey(goal)) : null;
    if (!predecessor || predecessor.digest !== source.predecessorPlan.digest || !goal
      || goalHead?.digest !== goal.digest || planHead?.digest !== predecessor.digest) {
      this._contextFailure('Context map predecessor is not the current Plan head',
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
      }, this._goalPlanPolicy, goal, { preserveLegacyRoutes: integrity });
      if (canonicalDigest(payload.planRequest.totals) !== canonicalDigest(normalizedPlan.totals)) {
        throw new GoalPlanValidationError('Context map Plan totals changed',
          'context_map_plan_invalid');
      }
    }
    catch (error) {
      this._contextFailure(error.message,
        integrity ? 'context_map_call_integrity' : (error.code ?? 'context_map_plan_invalid'), integrity);
    }
    const expectedPlanDigest = goalPlanDigest({
      schemaVersion: 1, repoId: this._repoId, runId: source.runId,
      goal: normalizedPlan.goal, predecessor: normalizedPlan.predecessor,
      nodes: normalizedPlan.nodes, totals: normalizedPlan.totals,
      policyDigest: this._goalPlanPolicy.policyDigest,
    });
    if (payload.expectedPlanDigest !== expectedPlanDigest
      || normalizedPlan.predecessor?.planId !== predecessor.planId
      || normalizedPlan.predecessor?.version !== predecessor.version
      || normalizedPlan.predecessor?.digest !== predecessor.digest
      || normalizedPlan.nodes.length !== call.partitions.length
      || normalizedPlan.nodes.length < 2
      || normalizedPlan.nodes.length > this._goalPlanPolicy.limits.maxNodes) {
      this._contextFailure('Context map successor Plan identity changed',
        integrity ? 'context_map_call_integrity' : 'context_map_plan_invalid', integrity);
    }
    const partitions = new Set();
    for (const node of normalizedPlan.nodes) {
      const binding = node.contextCall;
      if (!binding || binding.callId !== call.callId || binding.callDigest !== call.callDigest
        || binding.programDigest !== call.programDigest || binding.logicalRole !== call.role
        || binding.source.predecessorPlan.digest !== predecessor.digest
        || canonicalDigest(binding.source) !== canonicalDigest(call.source)) {
        this._contextFailure('Context map Plan node differs from its admitted call',
          integrity ? 'context_map_call_integrity' : 'context_map_plan_invalid', integrity);
      }
      let expectedBinding;
      try { expectedBinding = contextMapNodeBinding(call, binding.partition); }
      catch (error) {
        this._contextFailure(error.message,
          integrity ? 'context_map_call_integrity' : 'context_map_plan_invalid', integrity);
      }
      if (canonicalDigest(binding) !== canonicalDigest(expectedBinding)
        || partitions.has(binding.partition.partitionId)) {
        this._contextFailure('Context map partition binding changed or repeated',
          integrity ? 'context_map_call_integrity' : 'context_map_plan_invalid', integrity);
      }
      partitions.add(binding.partition.partitionId);
    }
    if (partitions.size !== call.partitions.length
      || call.partitions.some(({ partitionId }) => !partitions.has(partitionId))) {
      this._contextFailure('Context map Plan does not cover the exact partition set',
        integrity ? 'context_map_call_integrity' : 'context_map_plan_invalid', integrity);
    }

    const prefix = this._events.filter((candidate) => candidate.seq < event.seq);
    const sourceDefinitions = prefix.filter((candidate) => candidate.kind === 'driver.recorded'
      && candidate.payload?.kind === 'application.workflow_definition_bound'
      && candidate.payload?.repoId === this._repoId
      && candidate.payload?.runId === source.runId
      && candidate.payload?.planDigest === predecessor.digest
      && candidate.payload?.definitionDigest === source.definitionDigest);
    const successorDefinitions = prefix.filter((candidate) => candidate.kind === 'driver.recorded'
      && candidate.payload?.kind === 'application.workflow_definition_bound'
      && candidate.payload?.repoId === this._repoId
      && candidate.payload?.runId === source.runId
      && candidate.payload?.planDigest === expectedPlanDigest);
    if (sourceDefinitions.length !== 1 || successorDefinitions.length !== 1) {
      this._contextFailure('Context map Workflow definition binding is absent or ambiguous',
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
      this._contextFailure('Context map Workflow definition authority is invalid',
        integrity ? 'context_map_call_integrity' : 'context_map_definition_invalid', integrity);
    }
    const sourceDefinition = sourceDefinitionEvent.payload;
    const successorDefinition = successorDefinitionEvent.payload;
    if (successorDefinition.schemaVersion === 3) {
      const ancestry = prefix.filter((candidate) => (
        candidate.kind === 'driver.recorded'
          && candidate.payload?.kind === 'application.workflow_definition_bound'
          && candidate.payload?.repoId === this._repoId
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
        this._contextFailure(error.message,
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
        this._contextFailure('Context map logical role is outside Workflow authority',
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
          this._contextFailure('Context map route differs from the approved logical role',
            integrity ? 'context_map_call_integrity' : 'context_map_route_invalid', integrity);
        }
      }
    } else {
      if (sourceDefinition.schemaVersion === 3) {
        this._contextFailure('Context map Workflow definition cannot downgrade its schema',
          integrity ? 'context_map_call_integrity' : 'context_map_definition_invalid', integrity);
      }
      try {
        validateWorkflowDefinitionLegacy(sourceDefinition, { nodes: predecessor.nodes });
        validateWorkflowDefinitionLegacy(successorDefinition, { nodes: normalizedPlan.nodes });
      } catch (error) {
        this._contextFailure(error.message,
          integrity ? 'context_map_call_integrity'
            : (error.code ?? 'context_map_definition_invalid'), integrity);
      }
      const sourceAttempt = sourceDefinition.attempts?.find((attempt) => attempt.role === call.role);
      if (!sourceAttempt || sourceDefinition.profileDigest !== source.profileDigest
        || successorDefinition.profileDigest !== source.profileDigest
        || !Array.isArray(successorDefinition.attempts)
        || successorDefinition.attempts.length !== normalizedPlan.nodes.length) {
        this._contextFailure('Context map logical role is outside Workflow authority',
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
          this._contextFailure('Context map route differs from the approved logical role',
            integrity ? 'context_map_call_integrity' : 'context_map_route_invalid', integrity);
        }
      }
    }

    if (!integrity) {
      let output; let evidence;
      try {
        output = this._contextReferenceRead(cell.result.outputRef);
        evidence = this._contextReferenceRead(cell.result.evidenceRef);
      } catch (error) {
        this._contextFailure(error?.message ?? 'Context map source artifact is unavailable',
          error?.code ?? 'context_map_source_unavailable', false);
      }
      const verified = this._validateContextCompletionArtifacts(
        cell, cell.result, output, evidence, true,
      );
      if (call.schemaVersion !== 2 || verified.evidence.schemaVersion !== 2) {
        this._contextFailure(
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
        this._contextFailure('Context map partitions differ from the verified source cell',
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
      this._contextFailure('Context map call admission identity changed',
        integrity ? 'context_map_call_integrity' : 'context_map_call_invalid', integrity);
    }
    this._assertRunAdmissionOpen(source.runId, integrity);
    return freeze({
      call, authority, planRequest: normalizedPlan, expectedPlanDigest,
      requestCore, admissionCore,
    });
  }

  _validateContextEffectCallAdmissionPayload(payload, event, integrity = false) {
    const fail = (message, code = 'context_call_invalid') => this._contextFailure(
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
      || principal.repoId !== this._repoId || principal.actor !== 'deployment:context'
      || event.actor !== principal.actor
      || event.idempotencyKey !== `context.call:${call.callId}`) {
      return fail('Context effect-call principal authority changed',
        'context_call_unauthorized');
    }
    const session = this._contextSessions.get(authority.sessionId);
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
      const predecessorCall = this._contextCalls.get(call.predecessorCall.callId);
      let selection;
      try { selection = this._contextRetrySelection(call.predecessorCall.callId, integrity); }
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
    const predecessor = this._plans.get(this._planVersionKey(
      predecessorRef.planId, predecessorRef.version,
    ));
    const goal = predecessor ? this._goals.get(this._goalVersionKey(
      predecessor.goal.goalId, predecessor.goal.version,
    )) : null;
    const goalHead = goal ? this._goalHeads.get(this._goalScopeKey(this._repoId, runId)) : null;
    const planHead = goal ? this._planHeads.get(this._planHeadKey(goal)) : null;
    if (!predecessor || predecessor.digest !== predecessorRef.digest || !goal
      || predecessor.repoId !== this._repoId || predecessor.runId !== runId
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
      }, this._goalPlanPolicy, goal, { preserveLegacyRoutes: integrity });
      if (canonicalDigest(payload.planRequest.totals) !== canonicalDigest(normalizedPlan.totals)) {
        throw new GoalPlanValidationError('Context effect-call Plan totals changed',
          'context_call_plan_invalid');
      }
    } catch (error) {
      return fail(error.message, error.code ?? 'context_call_plan_invalid');
    }
    const expectedPlanDigest = goalPlanDigest({
      schemaVersion: 1, repoId: this._repoId, runId,
      goal: normalizedPlan.goal, predecessor: normalizedPlan.predecessor,
      nodes: normalizedPlan.nodes, totals: normalizedPlan.totals,
      policyDigest: this._goalPlanPolicy.policyDigest,
    });
    if (payload.expectedPlanDigest !== expectedPlanDigest
      || normalizedPlan.predecessor?.planId !== predecessor.planId
      || normalizedPlan.predecessor?.version !== predecessor.version
      || normalizedPlan.predecessor?.digest !== predecessor.digest
      || normalizedPlan.nodes.length !== call.executionUnitIds.length
      || normalizedPlan.nodes.length === 0
      || normalizedPlan.nodes.length > this._goalPlanPolicy.limits.maxNodes) {
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

    const prefix = this._events.filter((candidate) => candidate.seq < event.seq);
    const definitions = prefix.filter((candidate) => (
      candidate.kind === 'driver.recorded'
        && candidate.payload?.kind === 'application.workflow_definition_bound'
        && candidate.payload?.repoId === this._repoId
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
        const cell = this._contextCells.get(call.source.id);
        if (!cell || cell.state !== 'completed' || cell.sessionId !== session.sessionId
          || !cell.result || cell.admissionDigest !== call.source.admissionDigest
          || cell.settlementDigest !== call.source.settlementDigest
          || canonicalDigest(cell.result.outputRef) !== canonicalDigest(call.source.outputRef)
          || canonicalDigest(cell.result.evidenceRef) !== canonicalDigest(call.source.evidenceRef)
          || cell.result.coordinateDigest !== call.source.coordinateDigest) {
          return fail('Context effect-call cell source is stale', 'context_call_source_stale');
        }
        const artifacts = this.contextCellArtifacts(cell.cellId);
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
        const sourceCall = this._contextCalls.get(call.source.id);
        if (!sourceCall || this._contextCallRunId(sourceCall) !== runId) {
          return fail('Context effect-call call source is outside its Run',
            'context_call_source_stale');
        }
        const expectedSource = this.contextCompletedCallSource(call.source.id);
        const artifacts = this.contextCallArtifacts(call.source.id);
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
    this._assertRunAdmissionOpen(runId, integrity);
    return freeze({
      call, authority: admissionAuthority, planRequest: normalizedPlan, expectedPlanDigest,
      requestCore, admissionCore,
    });
  }

  _contextSettlementChildren(call, kind, integrity = false, cleanup = null) { return coordinationLedger._contextSettlementChildren(this, call, kind, integrity, cleanup); }

  _contextMapSettlementChildren(call, integrity = false, cleanup = null) { return coordinationLedger._contextMapSettlementChildren(this, call, integrity, cleanup); }

  _contextEffectSettlementChildren(call, integrity = false, cleanup = null) { return coordinationLedger._contextEffectSettlementChildren(this, call, integrity, cleanup); }

  _validateTaskResourceReleasePayload(payload, event, integrity = false) {
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
    const task = this._tasks.get(payload.taskId);
    if (!task || !TERMINAL.has(task.status) || task.version !== payload.taskVersion
      || task.terminalEvent !== payload.terminalEvent || task.assignee !== payload.workerId) {
      return fail('task resource-release target is stale');
    }
    const mapped = this._events[payload.evidence.coordinationSeq - 1];
    const mappedEvidence = mapped?.kind === 'evidence.mapped'
      ? { ...mapped.payload, coordinationSeq: mapped.seq } : null;
    const source = mappedEvidence ? this._operationalRead?.(
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
    const prefix = this._operationalRangeRead?.(payload.workerId, payload.evidence.workerSeq);
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

  _normalizeContextCleanupReceipt(call, kind, children, value, integrity = false) {
    const generic = kind === 'effect';
    const subject = generic ? 'effect' : 'map';
    const fail = (message) => this._contextFailure(message,
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
      const release = this._taskResourceReleases.get(child.taskId);
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
        const release = this._taskResourceReleases.get(target.taskId);
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

  _normalizeContextMapCleanupReceipt(call, children, value, integrity = false) {
    return this._normalizeContextCleanupReceipt(call, 'map', children, value, integrity);
  }

  _normalizeContextEffectCleanupReceipt(call, children, value, integrity = false) {
    return this._normalizeContextCleanupReceipt(call, 'effect', children, value, integrity);
  }
  _contextArtifactVerification() {
    return coordinationInternals._contextArtifactVerification(this._contextArtifactVerificationStorage);
  }
  withContextArtifactVerification(operation) {
    return coordinationInternals.withContextArtifactVerification(this._contextArtifactVerificationStorage, operation);
  }
  _contextArtifactRead(reference, verification) {
    return coordinationInternals._contextArtifactRead(this, reference, verification);
  }

  _validateContextProviderResults(call, kind, children, cleanup, values, integrity = false,
    verification = this._contextArtifactVerification()) {
    const generic = kind === 'effect';
    const subject = generic ? 'effect' : 'map';
    const fail = (message) => this._contextFailure(message,
      integrity
        ? (generic ? 'context_call_settlement_integrity'
          : 'context_map_call_settlement_integrity')
        : (generic ? 'context_call_settlement_invalid'
          : 'context_map_call_settlement_invalid'), integrity);
    const acceptedChildren = children.filter(contextChildAccepted);
    if (!Array.isArray(values) || values.length !== acceptedChildren.length) {
      return fail(`Context ${subject} provider-result set does not match accepted children`);
    }
    const plan = [...this._plans.values()].find((candidate) => (
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
        const predecessor = this._contextCalls.get(child.originCallId);
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
          this._contextCallArtifacts(predecessor.callId, verification);
          capsule = this._contextArtifactRead(value?.capsuleRef, verification);
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
        capsule = this._contextArtifactRead(value?.capsuleRef, verification);
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

  _validateContextMapProviderResults(call, children, cleanup, values, integrity = false,
    verification = this._contextArtifactVerification()) {
    return this._validateContextProviderResults(
      call, 'map', children, cleanup, values, integrity, verification,
    );
  }

  _validateContextEffectProviderResults(call, children, cleanup, values, integrity = false,
    verification = this._contextArtifactVerification()) {
    return this._validateContextProviderResults(
      call, 'effect', children, cleanup, values, integrity, verification,
    );
  }

  _validateContextMapPlanProposal(plan, integrity = false) {
    const bindings = plan?.nodes?.map((node) => node.contextCall).filter(Boolean) ?? [];
    if (bindings.length === 0) return null;
    const fail = (message) => this._contextFailure(message,
      'context_map_plan_integrity', integrity);
    if (bindings.length !== plan.nodes.length
      || new Set(bindings.map((binding) => binding.callId)).size !== 1) {
      return fail('Context map Plan bindings are incomplete or ambiguous');
    }
    const call = this._contextCalls.get(bindings[0].callId);
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

  _validateContextCallPlanProposal(plan, integrity = false) {
    const bindings = plan?.nodes?.map((node) => node.contextCall).filter(Boolean) ?? [];
    if (bindings.length === 0 || bindings[0]?.kind === 'context_map_child') {
      return this._validateContextMapPlanProposal(plan, integrity);
    }
    const fail = (message) => this._contextFailure(message,
      'context_call_plan_integrity', integrity);
    if (bindings.length !== plan.nodes.length
      || new Set(bindings.map((binding) => binding.callId)).size !== 1) {
      return fail('Context effect Plan bindings are incomplete or ambiguous');
    }
    const call = this._contextCalls.get(bindings[0].callId);
    if (!call || call.kind !== 'baton.context_effect_call' || call.state !== 'plan_pending'
      || call.expectedPlanDigest !== plan.digest
      || this._contextCallRunId(call) !== plan.runId
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

  _validateContextMapResultLineageEvidence(
    call, evidence, children, providerResults, cleanup, integrity = false,
    verification = this._contextArtifactVerification(),
  ) {
    const fail = (message) => this._contextFailure(message,
      integrity ? 'context_map_call_settlement_integrity'
        : 'context_map_call_settlement_invalid', integrity);
    if (evidence?.schemaVersion !== 3) {
      return fail('Context map result lineage evidence is unavailable');
    }
    try {
      const sourceOutput = this._contextArtifactRead(call.source.outputRef, verification);
      const sourceEvidence = this._contextArtifactRead(call.source.evidenceRef, verification);
      const capsules = providerResults.map((providerResult) => (
        this._contextArtifactRead(providerResult.capsuleRef, verification)
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
  _contextEffectCallCore(call) {
    return coordinationInternals._contextEffectCallCore(call);
  }

  _validateContextEffectResultLineageEvidence(
    call, evidence, children, providerResults, cleanup, integrity = false,
    verification = this._contextArtifactVerification(),
  ) {
    const fail = (message) => this._contextFailure(message,
      integrity ? 'context_call_settlement_integrity'
        : 'context_call_settlement_invalid', integrity);
    if (evidence?.schemaVersion !== 4) {
      return fail('Context effect result lineage evidence is unavailable');
    }
    try {
      const sourceOutput = this._contextArtifactRead(call.source.outputRef, verification);
      const sourceEvidence = this._contextArtifactRead(call.source.evidenceRef, verification);
      const capsules = providerResults.map((providerResult) => (
        this._contextArtifactRead(providerResult.capsuleRef, verification)
      ));
      return validateContextEffectResultLineage({
        call: this._contextEffectCallCore(call),
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

  _validateContextMapCallSettlementPayload(payload, event, integrity = false) {
    const fields = [
      'authority', 'callId', 'expectedVersion', 'newVersion', 'result', 'schemaVersion',
      'settlementDigest',
    ];
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Object.keys(payload).sort().join(',') !== fields.sort().join(',')
      || payload.schemaVersion !== 1 || payload.expectedVersion !== 1 || payload.newVersion !== 2
      || !payload.result || typeof payload.result !== 'object' || Array.isArray(payload.result)) {
      this._contextFailure('Context map call settlement is malformed',
        'context_map_call_settlement_integrity', integrity);
    }
    let authority;
    try { authority = normalizeContextAuthority(payload.authority); }
    catch (error) {
      this._contextFailure(error.message,
        integrity ? 'context_map_call_settlement_integrity'
          : 'context_map_call_settlement_invalid', integrity);
    }
    const call = this._contextCalls.get(payload.callId);
    if (!call || call.version !== 1 || call.state !== 'plan_pending'
      || canonicalDigest(authority) !== canonicalDigest(call.authority)
      || event.actor !== authority.actor) {
      this._contextFailure('Context map call settlement target or authority is stale',
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
      const baseChildren = this._contextMapSettlementChildren(call, integrity);
      cleanup = this._normalizeContextMapCleanupReceipt(
        call, baseChildren, payload.result.cleanup, integrity,
      );
      children = this._contextMapSettlementChildren(call, integrity, cleanup);
      state = children.every(contextChildAccepted) ? 'completed' : 'failed';
      providerResults = this._validateContextMapProviderResults(
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
          payload.result.outputRef, 'context_value', this._contextProgramPolicy,
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
        payload.result.evidenceRef, 'context_call_evidence', this._contextProgramPolicy,
      );
    } catch (error) {
      this._contextFailure(error.message,
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
      output = outputRef === null ? null : this._contextReferenceRead(outputRef);
      evidence = this._contextReferenceRead(evidenceRef);
    } catch (error) {
      this._contextFailure(error?.message ?? 'Context map settlement artifact is unavailable',
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
      this._contextFailure('Context map settlement artifacts changed',
        integrity ? 'context_map_call_settlement_integrity'
          : 'context_map_call_settlement_invalid', integrity);
    }
    if (state === 'completed' && evidence.schemaVersion === 3) {
      this._validateContextMapResultLineageEvidence(
        call, evidence, children, providerResults, cleanup, integrity,
      );
    }
    const settlementCore = {
      authority, callId: call.callId, admissionDigest: call.admissionDigest,
      expectedVersion: 1, newVersion: 2, result,
    };
    if (payload.settlementDigest !== canonicalDigest(settlementCore)
      || event.idempotencyKey !== `context.call.settle:${call.callId}:${call.admissionDigest}`) {
      this._contextFailure('Context map call settlement identity changed',
        integrity ? 'context_map_call_settlement_integrity'
          : 'context_map_call_settlement_invalid', integrity);
    }
    this._assertRunAdmissionOpen(call.source.runId, integrity);
    return freeze({ call, result, settlementCore });
  }

  _validateContextEffectCallSettlementPayload(payload, event, integrity = false) {
    const fail = (message, code = 'context_call_settlement_invalid') => (
      this._contextFailure(message,
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
    const call = this._contextCalls.get(payload.callId);
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
      const baseChildren = this._contextEffectSettlementChildren(call, integrity);
      cleanup = this._normalizeContextEffectCleanupReceipt(
        call, baseChildren, payload.result.cleanup, integrity,
      );
      children = this._contextEffectSettlementChildren(call, integrity, cleanup);
      state = children.every(contextChildAccepted) ? 'completed' : 'failed';
      providerResults = this._validateContextEffectProviderResults(
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
          payload.result.outputRef, 'context_value', this._contextProgramPolicy,
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
        payload.result.evidenceRef, 'context_call_evidence', this._contextProgramPolicy,
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
      output = outputRef === null ? null : this._contextReferenceRead(outputRef);
      evidence = this._contextReferenceRead(evidenceRef);
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
      || canonicalDigest(evidence.call) !== canonicalDigest(this._contextEffectCallCore(call))
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
      this._validateContextEffectResultLineageEvidence(
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
    this._assertRunAdmissionOpen(this._contextCallRunId(call), integrity);
    return freeze({ call, result, settlementCore });
  }

  _assertRunAdmissionOpen(runId, integrity = false) {
    if (runId != null && (this._runStopByTarget.has(runId) || this._runStops.has(runId))) {
      if (integrity) throw new CoordinationIntegrityError(`run ${runId} is stopping`, 'run_stopping');
      throw new CoordinationRefusal(`run ${runId} is stopping`, 'run_stopping');
    }
  }

  _acceptanceRevocationFailure(message, code, integrity = false) {
    throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code);
  }

  _acceptanceRevocationRequest(fields, auth) {
    return coordinationInternals._acceptanceRevocationRequest(fields, auth);
  }

  _acceptanceRevocationEvidence(task, coordinationSeq, integrity = false) { return coordinationLedger._acceptanceRevocationEvidence(this, task, coordinationSeq, integrity); }

  _acceptanceRevocationTargets(task, evidenceSeq, integrity = false) { return coordinationLedger._acceptanceRevocationTargets(this, task, evidenceSeq, integrity); }

  _validateAcceptanceRevocationPayload(p, event, integrity = false) {
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
      this._acceptanceRevocationFailure('task acceptance revocation payload is malformed', 'acceptance_revocation_integrity', integrity);
    }
    // #286 G-41: no payload ceiling. The payload is a function of the targets above, which are a
    // view of the ledger — its size is bounded by the state that produced it, and a second literal
    // bound here refused a replayed event the append path had already accepted.
    const request = { schemaVersion: 1, taskId: p.taskId, expectedTaskVersion: p.expectedTaskVersion, evidence: { coordinationSeq: p.evidence?.coordinationSeq } };
    const expectedRequestDigest = canonicalDigest({ actor: event.actor, idempotencyKey: event.idempotencyKey, request });
    if (p.requestDigest !== expectedRequestDigest || p.newTaskVersion !== p.expectedTaskVersion + 1) {
      this._acceptanceRevocationFailure('task acceptance revocation request or task version is malformed', 'acceptance_revocation_integrity', integrity);
    }
    const task = this._tasks.get(p.taskId);
    const terminal = Number.isSafeInteger(task?.terminalEvent) ? this._events[task.terminalEvent - 1] : null;
    if (!task || task.status !== 'completed' || task.version !== p.expectedTaskVersion
      || terminal?.kind !== 'task.transitioned' || terminal.payload?.id !== task.id || terminal.payload?.to !== 'completed') {
      const code = task && task.version !== p.expectedTaskVersion ? 'stale_version' : 'acceptance_revocation_unavailable';
      this._acceptanceRevocationFailure('task acceptance revocation requires the exact completed task version', code, integrity);
    }
    const evidence = this._acceptanceRevocationEvidence(task, p.evidence?.coordinationSeq, integrity);
    if (canonicalDigest(p.evidence) !== canonicalDigest(evidence)) {
      this._acceptanceRevocationFailure('task acceptance revocation evidence snapshot changed', 'acceptance_revocation_evidence_invalid', integrity);
    }
    const targets = this._acceptanceRevocationTargets(task, evidence.coordinationSeq, integrity);
    if (targets.knowledgeTargets.some((target) => Date.parse(this._knowledgeNodes.get(target.nodeId)?.validFrom) > Date.parse(event.ts))) {
      this._acceptanceRevocationFailure('task acceptance revocation would create an invalid knowledge interval', 'acceptance_revocation_integrity', integrity);
    }
    if (canonicalDigest(p.artifactTargets) !== canonicalDigest(targets.artifactTargets)
      || canonicalDigest(p.knowledgeTargets) !== canonicalDigest(targets.knowledgeTargets)) {
      this._acceptanceRevocationFailure('task acceptance revocation target versions changed', 'acceptance_revocation_target_changed', integrity);
    }
    return targets;
  }

  _planBudgetFailure(message, code, integrity = false) {
    this._goalPlanFailure(message, code, integrity);
  }

  _derivePlanBudgetSettlement(taskId, integrity = false) {
    const dispatch = this._planTaskLinks.get(taskId); const task = this._tasks.get(taskId);
    const terminalEvent = task?.acceptanceRevocation?.priorTerminalEvent ?? task?.terminalEvent;
    const terminal = Number.isSafeInteger(terminalEvent) ? this._events[terminalEvent - 1] : null;
    if (!dispatch || !task || !terminal || terminal.kind !== 'task.transitioned' || terminal.payload?.id !== taskId
      || !TERMINAL.has(terminal.payload?.to) || terminal.seq <= dispatch.eventSeq) {
      this._planBudgetFailure('plan node budget settlement requires one exact terminal plan task', 'plan_budget_not_terminal', integrity);
    }
    const initial = clone(dispatch.nodeBudget); const claimed = task.claimedEvent ? this._events[task.claimedEvent - 1] : null;
    const started = claimed && claimed.seq < terminal.seq ? claimed : this._events[dispatch.eventSeq - 1];
    const wallMin = Math.ceil(Math.max(0, Date.parse(terminal.ts) - Date.parse(started.ts)) / 60_000 * 1_000_000) / 1_000_000;
    const evidenceSeq = terminal.payload?.evidence?.coordinationSeq;
    const mapped = Number.isSafeInteger(evidenceSeq) && evidenceSeq < terminal.seq ? this._events[evidenceSeq - 1] : null;
    const source = mapped?.kind === 'evidence.mapped' ? this._operationalRead?.(mapped.payload.worker, mapped.payload.workerSeq) : null;
    const mappedExact = mapped?.kind === 'evidence.mapped' && mapped.payload.worker === (task.assignee ?? mapped.payload.worker)
      && source && digest(source) === mapped.payload.digest && source.kind === mapped.payload.kind;
    let rows = null;
    if (mappedExact && this._operationalRangeRead) {
      const ceiling = Math.min(1_000_000, Math.max(1_024, this._goalPlanPolicy.limits.maxProviderTurns * 1_024));
      if (mapped.payload.workerSeq > ceiling) this._planBudgetFailure('plan node operational settlement evidence exceeds its ceiling', 'plan_budget_evidence_oversize', integrity);
      rows = this._operationalRangeRead(mapped.payload.worker, mapped.payload.workerSeq);
      if (!Array.isArray(rows) || rows.length !== mapped.payload.workerSeq
        || rows.some((row, index) => row?.worker !== mapped.payload.worker || row.seq !== index + 1 || row.seq > mapped.payload.workerSeq)) {
        this._planBudgetFailure('plan node operational settlement prefix is incomplete', 'plan_budget_evidence_invalid', integrity);
      }
    }
    const usageRows = rows?.filter((event) => event.kind === 'resource.tokens' && event.actor === 'worker') ?? [];
    const tokenUsageValid = usageRows.every((event) => Number.isFinite(event.payload?.tokens) && event.payload.tokens >= 0);
    const usdNanoRows = usageRows.map((event) => usdToNanos(event.payload?.usd));
    const totalUsdNanos = usdNanoRows.reduce((sum, value) => value === null ? Number.NaN : sum + value, 0);
    const projectedUsd = Number.isSafeInteger(totalUsdNanos) ? usdFromNanos(totalUsdNanos) : null;
    const initialUsdNanos = usdToNanos(initial.usd);
    const releasedUsd = projectedUsd === null || initialUsdNanos === null
      ? null
      : usdFromNanos(Math.max(0, initialUsdNanos - totalUsdNanos));
    const overrunUsd = projectedUsd === null || initialUsdNanos === null
      ? null
      : usdFromNanos(Math.max(0, totalUsdNanos - initialUsdNanos));
    const usdUsageValid = projectedUsd !== null && releasedUsd !== null && overrunUsd !== null;
    const seal = rows?.findLast((event) => event.payload?.usageSeal && typeof event.payload.usageSeal === 'object')?.payload?.usageSeal ?? null;
    const tokensExact = tokenUsageValid && seal?.tokens === 'reported'; const usdExact = usdUsageValid && seal?.usd === 'reported';
    const tokens = tokensExact ? usageRows.reduce((sum, event) => sum + event.payload.tokens, 0) : null;
    const usd = usdExact ? projectedUsd : null;
    const providerTurns = rows ? rows.filter((event) => event.kind === 'lifecycle.turn_started' && event.actor === 'orchestrator').length : null;
    const availability = {
      tokens: tokensExact ? 'exact' : 'unavailable', usd: usdExact ? 'exact' : 'unavailable',
      wallMin: 'exact', providerTurns: rows ? 'exact' : 'unavailable',
    };
    const consumed = { tokens, usd, wallMin, providerTurns };
    const dimension = (key) => {
      if (availability[key] !== 'exact') return { released: null, held: initial[key], overrun: null };
      if (key !== 'usd') return { released: Math.max(0, initial[key] - consumed[key]), held: 0, overrun: Math.max(0, consumed[key] - initial[key]) };
      return { released: releasedUsd, held: 0, overrun: overrunUsd };
    };
    const dimensions = Object.fromEntries(Object.keys(initial).map((key) => [key, dimension(key)]));
    return {
      schemaVersion: 1, taskId, binding: clone(dispatch.binding), terminalEvent: terminal.seq, terminalStatus: terminal.payload.to,
      initial, consumed,
      released: Object.fromEntries(Object.entries(dimensions).map(([key, value]) => [key, value.released])),
      held: Object.fromEntries(Object.entries(dimensions).map(([key, value]) => [key, value.held])),
      overrun: Object.fromEntries(Object.entries(dimensions).map(([key, value]) => [key, value.overrun])),
      availability,
      operational: {
        worker: mappedExact ? mapped.payload.worker : task.assignee ?? task.reservedWorkerId ?? null,
        throughSeq: rows ? mapped.payload.workerSeq : null,
        prefixDigest: rows ? canonicalDigest(rows) : null,
      },
    };
  }

  _validatePlanBudgetSettlement(p, event, integrity = false) {
    const core = Object.fromEntries(Object.entries(p ?? {}).filter(([key]) => key !== 'receiptDigest'));
    const expected = this._derivePlanBudgetSettlement(p?.taskId, integrity);
    if (!p || Object.keys(p).sort().join(',') !== [...Object.keys(expected), 'receiptDigest'].sort().join(',')
      || event?.actor !== 'policy' || !validRunId(event?.idempotencyKey)
      || p.receiptDigest !== canonicalDigest(core) || canonicalDigest(core) !== canonicalDigest(expected)
      || this._planBudgetSettlements.has(p.taskId)) {
      this._planBudgetFailure('plan node budget settlement is malformed or duplicated', 'plan_budget_settlement_integrity', integrity);
    }
    return expected;
  }

  // Issue #325: the replay half of assertGoalSuccessor, decided from RECORDED content
  // only. The definitionOfDone/constraint supersets and the budget containment re-derive
  // from the replayed rows, so a weakened successor still refuses; the risk-tier ordering
  // is the live policy's taxonomy (assertGoalSuccessor's riskIndex), which a policy edit
  // may reorder or prune — replaying it would re-judge recorded history, so replay does
  // not order risks. Live defineGoal still enforces the full relation at admission.
  _goalSuccessorWeakeningReplay(prior, next) {
    const malformed = (message = 'goal/plan event is malformed') => this._goalPlanFailure(message, 'goal_plan_integrity', true);
    const includes = (values, required) => Array.isArray(values) && Array.isArray(required)
      && required.every((item) => values.includes(item));
    const within = (a, b) => {
      if (!a || !b) return false;
      const aUsd = usdToNanos(a.usd); const bUsd = usdToNanos(b.usd);
      return aUsd !== null && bUsd !== null && a.tokens <= b.tokens && aUsd <= bUsd
        && a.wallMin <= b.wallMin && a.providerTurns <= b.providerTurns;
    };
    if (!prior || !includes(next.definitionOfDone, prior.definitionOfDone)
      || !includes(next.constraints, prior.constraints) || !within(next.budget, prior.budget)) {
      malformed('goal amendment weakens an established constraint');
    }
  }

  _applyGoalPlanEvent(event) { return coordinationLedger._applyGoalPlanEvent(this, event); }

  _apply(event) { return coordinationLedger._apply(this, event); }
  /** Issue #483: the deployment's own incarnation lifecycle, folded one row at a time — the six
   * `host.*` kinds an incarnation writes about itself, read by `incarnationDeparture()` when a
   * bounded wait is torn down. Last write wins per kind, exactly as the log reads:
   *
   *   host.reincarnation_requested — a handoff began (new-turn admission closes; RECOVERABLE: a
   *                                  handoff that fails re-publishes and this incarnation serves on)
   *   host.successor_started       — the successor incarnation the handoff minted
   *   host.successor_published     — …and its publication
   *   host.reincarnated            — the handoff settled IN FAVOUR OF THE SUCCESSOR: this process
   *                                  is not (or is no longer) the departure's incarnation
   *   host.reincarnation_failed    — the handoff settled against the successor; this incarnation
   *                                  went on serving
   *   host.stop_requested          — an ordinary stop's first durable act
   *   host.stop_waiting            — the stop's own named wait
   *   host.stopped                 — the release that ENDED this incarnation's authority
   *
   * A handoff's own stop rows are not a departure on their own — the window can still fail — so
   * the handoff decides at the release, where the successor is already named. */
  _foldIncarnationLifecycle(row) {
    const kind = row.kind;
    if (kind === 'host.reincarnation_requested') {
      this._incarnationHandoff = freeze({ successor: null });
      return;
    }
    if (kind === 'host.successor_started' || kind === 'host.successor_published') {
      if (this._incarnationHandoff === null) return; // a publication with no request belongs to another incarnation
      if (typeof row.incarnation === 'string' && row.incarnation.length > 0) {
        this._incarnationHandoff = freeze({ successor: row.incarnation });
      }
      return;
    }
    if (kind === 'host.reincarnated' || kind === 'host.reincarnation_failed') {
      this._incarnationHandoff = null;
      this._incarnationDeparture = null;
      return;
    }
    if (kind === 'host.stop_requested' || kind === 'host.stop_waiting') {
      if (this._incarnationHandoff !== null) return; // the handoff's own stop: the window still decides
      this._incarnationDeparture = freeze({ reason: 'resident_stopping', successor: null });
      return;
    }
    if (kind === 'host.stopped') {
      // The release: this incarnation's authority ended — the ONE row a handoff's stop and an
      // ordinary stop both mint, which is why the handoff decides HERE (the successor is named by
      // then) and an ordinary stop re-states the reason its own request already set.
      if (this._incarnationHandoff === null) {
        this._incarnationDeparture = freeze({ reason: 'resident_stopping', successor: null });
        return;
      }
      const successor = this._incarnationHandoff.successor;
      this._incarnationDeparture = freeze({
        reason: 'incarnation_withdrawn',
        successor: successor === null ? null : freeze({ incarnation: successor }),
      });
    }
  }
  events(fromSeq = 1, limit = null) {
    return coordinationInternals.events(this._events, fromSeq, limit);
  }

  // #227 (2026-08-15): the O(1) ledger cursor. Delta consumers (waves.progress sinceSeq)
  // need the current tail position WITHOUT materializing the ledger — eventsView() with no
  // arguments copies the world (the #210 class). Length only, never a copy.
  eventCursor() { return coordinationLedger.eventCursor(this._events); }

  // Clone-free read view: every event in _events is frozen at append (load path and both
  // runtime append paths), so read-only consumers share the store's frozen references
  // instead of paying a full-log deep clone per call (the loop-starvation furnace).
  eventsView(fromSeq = 1, limit = null) { return coordinationLedger.eventsView(this._events, fromSeq, limit); }
  /** Issue #483: is the incarnation that holds this store LEAVING, and — when the departure is a
   * reincarnation handoff — which incarnation takes the deployment over? Null while none is.
   *
   * The state is folded from the deployment's own `host.*` rows APPENDED LIVE to this store (see
   * `_foldIncarnationLifecycle`); a row this store replayed at open belongs to an incarnation that
   * is already gone and never reads as this one's departure. The reasons are the closed set a
   * torn-down wait crosses with: `incarnation_withdrawn` (a handoff whose release ended this
   * incarnation's authority — `successor` names the incarnation it minted), `resident_stopping`
   * (an ordinary stop, `successor: null`). The third crossing reason, `store_closed`, is minted by
   * the caller of a wait whose store closed with NO live departure on its ledger. */
  incarnationDeparture() { return this._incarnationDeparture; }
  waitAfter(afterSeq, timeoutMs, options = {}) {
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0 || afterSeq > this._events.length
      || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0
      || !options || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(options).some((key) => key !== 'signal')
      || (options.signal !== undefined && !(options.signal instanceof AbortSignal))) {
      throw new TypeError('coordination wait requires a current cursor, positive timeout, and optional AbortSignal');
    }
    if (this._events.length > afterSeq) {
      return Promise.resolve(freeze({ advanced: true, upperBound: this._events.length }));
    }
    if (options.signal?.aborted) {
      return Promise.reject(Object.assign(new Error('coordination wait aborted'), { code: 'coordination_wait_aborted' }));
    }
    return new Promise((resolve, reject) => {
      let timer = null;
      const onAbort = () => finish(null, Object.assign(new Error('coordination wait aborted'), { code: 'coordination_wait_aborted' }));
      const waiter = {
        afterSeq,
        finish: (advanced) => finish(freeze({ advanced, upperBound: this._events.length })),
      };
      const finish = (value, error = null) => {
        if (!this._appendWaiters.delete(waiter)) return;
        if (timer !== null) clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        if (error) reject(error); else resolve(value);
      };
      this._appendWaiters.add(waiter);
      options.signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => finish(freeze({ advanced: false, upperBound: this._events.length })), timeoutMs);
      if (this._events.length > afterSeq) waiter.finish(true);
    });
  }
  observationTime(observedSeq = this._events.length) {
    return coordinationInternals.observationTime(this, observedSeq);
  }
  task(id) {
    return coordinationInternals.task(this._tasks, id);
  }
  run(id) {
    return coordinationInternals.run(this._runs, id);
  }
  routePolicy() { return coordinationLedger.routePolicy(this._routePolicy); }
  representationPolicy() { return coordinationLedger.representationPolicy(this._representationPolicy); }
  goalPlanPolicy() { return coordinationLedger.goalPlanPolicy(this._goalPlanPolicy); }
  workflowPolicy() { return coordinationLedger.workflowPolicy(this._workflowPolicy); }
  contextProgramPolicy() { return coordinationLedger.contextProgramPolicy(this._contextProgramPolicy); }
  contextProgramAuthority() {
    return coordinationInternals.contextProgramAuthority(this);
  }
  contextSession(sessionId) {
    return coordinationInternals.contextSession(this._contextSessions, sessionId);
  }
  contextCell(cellId) {
    return coordinationInternals.contextCell(this._contextCells, cellId);
  }
  contextCall(callId) { return coordinationLedger.contextCall(this, callId); }
  contextCalls({ runId = null } = {}) {
    if (runId !== null && (typeof runId !== 'string' || runId.length === 0)) {
      throw new TypeError('Context call Run filter is invalid');
    }
    return [...this._contextCalls.keys()].map((callId) => this.contextCall(callId))
      .filter((call) => runId === null || this._contextCallRunId(call) === runId)
      .sort((left, right) => left.admittedEvent - right.admittedEvent);
  }
  _contextRetrySelection(callId, integrity = false) {
    const fail = (message, code) => this._contextFailure(
      message, integrity ? 'context_call_integrity' : code, integrity,
    );
    const call = this._contextCalls.get(callId);
    if (!call || call.kind !== 'baton.context_effect_call') {
      return fail('Context retry predecessor is unavailable', 'context_retry_not_found');
    }
    if (call.state !== 'failed' || !call.result || !call.settlementDigest
      || call.result.cleanup?.remainingCount !== 0) {
      return fail('Context retry requires one failed terminal generation with exact cleanup',
        'context_retry_not_eligible');
    }
    this.contextCallArtifacts(callId);
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
    const successor = [...this._contextCalls.values()].find((candidate) => (
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
  contextRetryEligibility(callId) {
    try {
      return clone({ eligible: true, ...this._contextRetrySelection(callId, false) });
    } catch (error) {
      if (!(error instanceof CoordinationRefusal)) throw error;
      return freeze({
        eligible: false, callId, code: error.code ?? 'context_retry_not_eligible',
        summary: error.message,
      });
    }
  }
  contextCallSettlementChildren(callId, cleanupReceipt = null) {
    const call = this._contextCalls.get(callId);
    const generic = call?.kind === 'baton.context_effect_call';
    if (!call) throw new CoordinationRefusal('Context call is unavailable',
      'context_call_not_found');
    const children = generic
      ? this._contextEffectSettlementChildren(call, false)
      : this._contextMapSettlementChildren(call, false);
    if (cleanupReceipt === null) return clone(children);
    const cleanup = generic
      ? this._normalizeContextEffectCleanupReceipt(call, children, cleanupReceipt, false)
      : this._normalizeContextMapCleanupReceipt(call, children, cleanupReceipt, false);
    return clone(generic
      ? this._contextEffectSettlementChildren(call, false, cleanup)
      : this._contextMapSettlementChildren(call, false, cleanup));
  }
  contextCallArtifacts(callId) {
    return clone(this._contextCallArtifacts(callId, this._contextArtifactVerification()));
  }
  contextCallContents(callId) {
    const verification = this._contextArtifactVerification();
    const artifacts = this._contextCallArtifacts(callId, verification);
    if (!artifacts.output || !Array.isArray(artifacts.output.items)) {
      throw new CoordinationRefusal('Context call has no completed result content',
        'context_call_content_unavailable');
    }
    const results = artifacts.output.items.map((candidate, index) => {
      let capsule; let resultRef; let source;
      try {
        capsule = this._contextArtifactRead(candidate?.capsuleRef, verification);
        resultRef = validateContextProviderResultReference(candidate, capsule);
        source = this._contextArtifactRead(capsule.sourceRef, verification);
      } catch (error) {
        throw new CoordinationIntegrityError(
          error?.message ?? 'Context provider result content is unavailable',
          'context_call_settlement_integrity',
        );
      }
      if (!Array.isArray(source) || source.length !== capsule.sourceRef.itemCount
        || contextValueDigest(source) !== capsule.sourceRef.digest) {
        throw new CoordinationIntegrityError('Context provider result content changed',
          'context_call_settlement_integrity');
      }
      return freeze({
        index, unitId: resultRef.unitId, capsuleId: resultRef.capsuleId,
        route: clone(capsule.route),
        result: {
          resultSha: capsule.result.resultSha,
          retainedResultRef: capsule.result.retainedResultRef,
          changedPaths: clone(capsule.result.changedPaths),
          pathScope: clone(capsule.result.pathScope),
        },
        source: clone(source),
      });
    });
    return clone(freeze({
      schemaVersion: 1, kind: 'baton.context_call_content', callId,
      resultCount: results.length, results: freeze(results),
    }));
  }
  _contextCallArtifacts(callId, verification) {
    if (verification.calls.has(callId)) return verification.calls.get(callId);
    const call = this._contextCalls.get(callId);
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
        ? this._validateContextEffectProviderResults(
          call, call.result.children, call.result.cleanup, call.result.providerResults, true,
          verification,
        )
        : this._validateContextMapProviderResults(
          call, call.result.children, call.result.cleanup, call.result.providerResults, true,
          verification,
        );
      if (canonicalDigest(providerResults) !== call.result.providerResultDigest) {
        throw new CoordinationIntegrityError('Context call provider-result set changed',
          generic ? 'context_call_settlement_integrity'
            : 'context_map_call_settlement_integrity');
      }
      output = call.result.outputRef === null
        ? null : this._contextArtifactRead(call.result.outputRef, verification);
      evidence = this._contextArtifactRead(call.result.evidenceRef, verification);
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
      ? canonicalDigest(evidence?.call) === canonicalDigest(this._contextEffectCallCore(call))
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
        this._validateContextEffectResultLineageEvidence(
          call, evidence, call.result.children, providerResults, call.result.cleanup, true,
          verification,
        );
      } else if (evidence.schemaVersion === 3) {
        this._validateContextMapResultLineageEvidence(
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
  contextCompletedCallSource(callId) {
    return this.contextCompletedCallSourceAndArtifacts(callId).source;
  }
  contextCompletedCallSourceAndArtifacts(callId) {
    const call = this._contextCalls.get(callId);
    if (!call) throw new CoordinationRefusal('Context call is unavailable',
      'context_map_call_not_found');
    if (call.state !== 'completed' || !call.result) {
      throw new CoordinationRefusal('Context call is not a completed source',
        'context_map_call_not_completed');
    }
    const verification = this._contextArtifactVerification();
    const artifacts = this._contextCallArtifacts(callId, verification);
    const expectedEvidenceVersion = call.kind === 'baton.context_effect_call' ? 4 : 3;
    if (artifacts.evidence.schemaVersion !== expectedEvidenceVersion) {
      throw new CoordinationRefusal(
        'Historical Context call output has no exact per-item lineage',
        'context_output_lineage_required',
      );
    }
    try {
      const source = clone(normalizeContextEffectSource({
        kind: 'call', id: call.callId, callDigest: call.callDigest,
        generation: call.generation, settlementDigest: call.settlementDigest,
        outputRef: call.result.outputRef, evidenceRef: call.result.evidenceRef,
        itemCount: artifacts.output.items.length,
        coordinateDigest: artifacts.evidence.coordinateDigest,
        outputLineageDigest: artifacts.evidence.outputLineageDigest,
      }));
      return freeze({ source, artifacts: clone(artifacts) });
    } catch (error) {
      throw new CoordinationIntegrityError(
        error?.message ?? 'Completed Context call source changed',
        'context_map_call_settlement_integrity',
      );
    }
  }
  pendingContextCells(limit = 1_000) { return coordinationLedger.pendingContextCells(this._contextCells, limit); }
  _validateContextCompletionArtifacts(cell, result, output, evidence, integrity = false) {
    const session = this._contextSessions.get(cell.sessionId);
    const contextPolicy = this._normalizeContextDeployment(session?.deployment, integrity).policy;
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
      this._contextFailure(message, code, integrity);
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
          source = this._contextReferenceRead({
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
  contextCellArtifacts(cellId) {
    const cell = this._contextCells.get(cellId);
    if (!cell) throw new CoordinationRefusal('Context cell is unavailable', 'context_cell_not_found');
    if (cell.state !== 'completed' || !cell.result) {
      throw new CoordinationRefusal('Context cell has no completed artifacts',
        'context_cell_not_completed');
    }
    let output; let evidence;
    try {
      output = this._contextReferenceRead(cell.result.outputRef);
      evidence = this._contextReferenceRead(cell.result.evidenceRef);
    } catch (error) {
      if (error?.code === 'context_artifact_unavailable') throw error;
      throw new CoordinationIntegrityError(error?.message ?? 'Context artifact reverify failed',
        'context_artifact_integrity');
    }
    return this._validateContextCompletionArtifacts(cell, cell.result, output, evidence, true);
  }
  canonicalOrderPolicy() { return coordinationLedger.canonicalOrderPolicy(this._canonicalOrderPolicy); }
  goalVersion(goalId, version) { return coordinationLedger.goalVersion(this, goalId, version); }
  planVersion(planId, version) { return coordinationLedger.planVersion(this, planId, version); }

  // REFLEX-3 (docs/32 §3.3, issue #18; contract: docs/reference/evidence/
  // reflex-wave-live-2026-07-21/reflex3-packages-decisions.md, red-team F11/F14 lines 205-231,
  // 282-294): a typed, immutable, replay-safe knowledge/context hand-off package.
  //
  // Provenance (Part A): `provenance.packageEvent` is never submitted (refused
  // `reserved_package_field` — the `_knowledgePayload` reserved-field stance, :11648-11651) and is
  // hub-derived from the admission ledger event itself, exactly the `scratchFactOracleTarget`
  // ledger-binding pattern (:11566-11585): `_contextPackageProvenance` dereferences
  // `this._events[admittedEvent - 1]`, cross-checks it still matches the durable projection, and
  // raises the loud `package_provenance_integrity` (never a silent accept) on any divergence — a
  // fresh derivation every read, so replay reproduces the identical binding.
  //
  // Shape (Part B): `_normalizeContextPackage` runs the `normalizeContextManifest` mold
  // (context-program.mjs:183-192) — delete-and-recompute `packageDigest` without `packageEvent`,
  // exact()-check every field, reject unknown fields, unique branch names
  // (`package_branch_name_conflict`), and every branch requires >=1 of source/artifact/valueRef
  // (`package_branch_empty` — a `schema` alone is not content).
  //
  // Attach vs resolve (Part C): admission resolves every branch ref exactly once
  // (`_resolveContextPackageBranchContent`, called from `admitContextPackage`).
  // `attachContextPackage` is a fenced O(1) pointer binding — it never re-reads branch bytes.
  // `resolveContextPackageBranch` is the lazy, resolve-time revalidation point per §93.5, settling
  // `context_artifact_unavailable` on missing/changed bytes; callers wrap it in
  // `withContextArtifactVerification` exactly like the existing Context Program read paths.
  //
  // Sanitization (Part D, F14): branch content is untrusted input to every reader — the
  // application layer projects it through `boundedAttentionText`/`SECRET_SHAPED_TEXT` with
  // untrusted-prose provenance marking before it reaches a Brief/RunView/MCP surface.
  contextPackage(packageDigest) {
    return coordinationInternals.contextPackage(this, packageDigest);
  }
  contextPackageAttachments(runId) {
    return coordinationInternals.contextPackageAttachments(this._contextPackageAttachments, runId);
  }
  _contextPackageProvenance(record) {
    return coordinationInternals._contextPackageProvenance(this, record);
  }

  _normalizeContextPackageSourceRef(value, integrity) {
    if (value === null || value === undefined) return null;
    const fail = (message) => this._contextFailure(message, 'context_package_invalid', integrity);
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

  _normalizeContextPackageArtifactRef(value, integrity) {
    if (value === null || value === undefined) return null;
    const fail = (message) => this._contextFailure(message, 'context_package_invalid', integrity);
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

  _normalizeContextPackageValueRef(value, integrity) {
    if (value === null || value === undefined) return null;
    const fail = (message) => this._contextFailure(message, 'context_package_invalid', integrity);
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

  _normalizeContextPackageSchemaRef(value, integrity) {
    if (value === null || value === undefined) return null;
    const fail = (message) => this._contextFailure(message, 'context_package_invalid', integrity);
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

  _normalizeContextPackageBranch(value, integrity) {
    const fail = (message, code = 'context_package_invalid') => this._contextFailure(message, code, integrity);
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== ['artifact', 'name', 'schema', 'source', 'valueRef'].sort().join(',')) {
      fail('context package branch has unknown or missing fields');
    }
    if (typeof value.name !== 'string' || value.name.length === 0 || Buffer.byteLength(value.name) > 512
      || !/^[A-Za-z0-9._:-]+$/u.test(value.name)) fail('context package branch name is invalid');
    const source = this._normalizeContextPackageSourceRef(value.source, integrity);
    const artifact = this._normalizeContextPackageArtifactRef(value.artifact, integrity);
    const valueRef = this._normalizeContextPackageValueRef(value.valueRef, integrity);
    const schema = this._normalizeContextPackageSchemaRef(value.schema, integrity);
    if (source === null && artifact === null && valueRef === null) {
      fail(`context package branch ${value.name} has no content reference`, 'package_branch_empty');
    }
    return freeze({ name: value.name, source, artifact, valueRef, schema });
  }

  _normalizeContextPackage(fields, integrity = false) {
    const fail = (message, code = 'context_package_invalid') => this._contextFailure(message, code, integrity);
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
    if (!this._contextProgramPolicy) fail('Context Program authority is unavailable', 'context_package_unavailable');
    if (!Array.isArray(raw.branches) || raw.branches.length === 0
      || raw.branches.length > this._contextProgramPolicy.maxManifestBranches) {
      fail('context package branches are invalid');
    }
    const branches = raw.branches.map((branch) => this._normalizeContextPackageBranch(branch, integrity))
      .sort((left, right) => compareCanonicalStrings(left.name, right.name));
    if (new Set(branches.map((branch) => branch.name)).size !== branches.length) {
      fail('context package branches must have unique names', 'package_branch_name_conflict');
    }
    if (!/^[a-f0-9]{64}$/.test(raw.policyDigest ?? '')
      || raw.policyDigest !== this._contextProgramPolicy.policyDigest) {
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

  _resolveContextPackageBranchContent(branch, integrity) {
    const fail = (message, code = 'context_artifact_unavailable') => this._contextFailure(message, code, integrity);
    const verification = this._contextArtifactVerification();
    let source = null; let artifact = null; let value = null;
    try {
      if (branch.source) source = this._contextArtifactRead(branch.source, verification);
      if (branch.artifact) artifact = this._contextArtifactRead(branch.artifact, verification);
    } catch (error) {
      fail(error?.message ?? `context package branch ${branch.name} content is unavailable`,
        error?.code ?? 'context_artifact_unavailable');
    }
    if (branch.valueRef) {
      const registered = this._artifacts.get(branch.valueRef.artifactId);
      if (!registered || registered.digest !== branch.valueRef.artifactDigest) {
        fail(`context package branch ${branch.name} value is unavailable`);
      }
      value = registered;
    }
    return { source, artifact, value };
  }

  resolveContextPackageBranch(packageDigest, branchName) {
    const record = this._contextPackages.get(packageDigest);
    if (!record) throw new CoordinationRefusal('Context package is unavailable', 'context_package_not_found');
    const branch = record.branches.find((candidate) => candidate.name === branchName);
    if (!branch) {
      throw new CoordinationRefusal(`Context package branch ${branchName} is unavailable`,
        'context_package_branch_not_found');
    }
    const resolved = this._resolveContextPackageBranchContent(branch, false);
    return freeze({
      name: branch.name, schema: branch.schema,
      source: resolved.source === null ? null : clone(resolved.source),
      artifact: resolved.artifact === null ? null : clone(resolved.artifact),
      valueRef: resolved.value === null ? null : clone(resolved.value),
    });
  }

  /** S-2 v2 package side of the shared session-authority posture. Package provenance/attachment
   * Run coordinates are required to agree with both the envelope and the proof's lease. */
  admitPackageCommand(envelope) {
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
      ? this._normalizeContextPackage(envelope.package, false) : null;
    const proof = envelope.sessionAuthority;
    if (proof == null) fail('an active package lease is required', 'board_lease_required');
    const proofFields = ['authorityDigest', 'expiresAt', 'orchestratorLeaseId', 'schemaVersion'];
    if (typeof proof !== 'object' || Array.isArray(proof)
      || Object.keys(proof).sort().join(',') !== proofFields.sort().join(',')
      || proof.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(proof.authorityDigest ?? '')
      || !boundedText(proof.orchestratorLeaseId, 512)
      || !Number.isFinite(Date.parse(proof.expiresAt ?? ''))) fail('package authority proof is invalid');
    const lease = this._runOrchestratorLeases.get(proof.orchestratorLeaseId);
    if (!lease || lease.status !== 'active' || Date.parse(this._clock()) >= Date.parse(lease.expiresAt)) {
      fail('an active package lease is required', 'board_lease_required');
    }
    if (proof.authorityDigest !== lease.session.authorityDigest
      || proof.expiresAt !== lease.session.expiresAt || lease.parent.runId !== envelope.runId) {
      fail('package session authority does not match its Run', 'board_session_mismatch');
    }
    const parent = this._tasks.get(lease.parent.taskId);
    if (!parent || parent.version !== lease.parent.taskVersion
      || parent.assignee !== lease.parent.workerId || parent.status !== 'working') {
      fail('an active package lease is required', 'board_lease_required');
    }
    if (kind === 'admit' && normalizedPackage.provenance.runId !== envelope.runId) {
      fail('package provenance is bound to a different Run', 'board_session_mismatch');
    }
    if (this._runStopByTarget.has(envelope.runId) || this._runStops.has(envelope.runId)
      || this._runs.get(envelope.runId)?.status === 'sealed') fail('package Run is closed', 'board_run_closed');

    const auth = {
      actor: lease.session.principalId, key: envelope.idempotencyKey,
      requestDigest: canonicalDigest(envelope),
    };
    if (kind === 'admit') {
      return this.admitContextPackage(envelope.package, auth);
    }
    return this.attachContextPackage({
      packageDigest: envelope.package, runId: envelope.runId, scope: envelope.mutation.scope,
    }, auth);
  }

  admitContextPackage(fields, auth) {
    const prior = this._byKey.get(auth?.key);
    if (prior) {
      const normalizedReplay = this._normalizeContextPackage(fields, false);
      if (prior.kind !== 'package.admitted'
        || prior.payload?.packageDigest !== normalizedReplay.packageDigest) {
        throw new CoordinationRefusal('context package idempotency content changed', 'board_replay_conflict');
      }
      return {
        ok: true, result: 'idempotent', event: clone(prior),
        package: this.contextPackage(prior.payload?.packageDigest),
      };
    }
    if (!this._contextProgramPolicy) {
      throw new CoordinationRefusal('Context Program authority is unavailable', 'context_package_unavailable');
    }
    const normalized = this._normalizeContextPackage(fields, false);
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
    if (this._contextPackages.has(normalized.packageDigest)) {
      const reused = this.contextPackage(normalized.packageDigest);
      return {
        ok: true, result: 'reused', reused: true,
        event: clone(this._events[reused.admittedEvent - 1]),
        package: reused,
      };
    }
    for (const branch of normalized.branches) this._resolveContextPackageBranchContent(branch, false);
    const { packageId: _packageId, ...payload } = normalized;
    // KG-2 Part C rules 11-13: one Source node per unique wrapped-cell content digest
    // (check-before-write against a live queryKnowledge read, so re-wrapping an already-cited
    // cell mints nothing new), one package Finding unconditionally, and one DerivedFrom edge per
    // unique wrapped-cell Source (fresh or already present) — all atomic with the admission.
    const admitSeq = this._events.length + 1;
    const uniqueDigests = [...new Set(normalized.branches.filter((branch) => branch.valueRef).map((branch) => branch.valueRef.valueDigest))];
    const sourceIds = uniqueDigests.map((valueDigest) => `source:cell:${valueDigest}`);
    const existingSourceIds = sourceIds.length === 0
      ? new Set()
      : new Set(this.queryKnowledge({ ids: sourceIds }).map((node) => node.id));
    const findingId = `finding:package:${normalized.packageDigest}`;
    const entries = [{ kind: 'package.admitted', payload, auth }];
    for (let index = 0; index < sourceIds.length; index += 1) {
      const sourceId = sourceIds[index];
      if (existingSourceIds.has(sourceId)) continue;
      const sourcePayload = this._prepareKnowledgeNode({
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
    const findingPayload = this._prepareKnowledgeNode({
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
      const edgePayload = this._knowledgePayload(
        { from: findingId, to: sourceId, type: 'DerivedFrom', evidence: [{ coordinationSeq: admitSeq }] },
        { id: edgeId },
      );
      entries.push({
        kind: 'knowledge.edge_added', payload: edgePayload,
        auth: { actor: 'policy', key: `knowledge.edge_added:${edgeId}` },
      });
    }
    const [event] = this._appendBatch(entries);
    const pkg = this.contextPackage(normalized.packageDigest);
    if (!pkg || pkg.admittedEvent !== event.seq) {
      throw new CoordinationIntegrityError('Context package admission did not materialize',
        'context_package_integrity');
    }
    return { ok: true, result: 'admitted', event: clone(event), package: pkg };
  }

  _contextPackageAttachmentView(event) { return coordinationLedger._contextPackageAttachmentView(event); }

  attachContextPackage(fields, auth) {
    const prior = this._byKey.get(auth?.key);
    if (prior) {
      if (prior.kind !== 'package.attached'
        || canonicalDigest(prior.payload) !== canonicalDigest(fields)) {
        throw new CoordinationRefusal('context package attachment idempotency content changed',
          'board_replay_conflict');
      }
      return {
        ok: true, result: 'idempotent', event: clone(prior),
        attachment: this._contextPackageAttachmentView(prior),
      };
    }
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)
      || Object.keys(fields).sort().join(',') !== ['packageDigest', 'runId', 'scope'].sort().join(',')
      || !/^[a-f0-9]{64}$/.test(fields.packageDigest ?? '') || !validRunId(fields.runId)
      || !/^(run|worker:[A-Za-z0-9._:-]{1,256}|board:[A-Za-z0-9._:-]{1,256})$/u.test(fields.scope ?? '')) {
      throw new CoordinationRefusal('context package attach request is invalid', 'context_package_attach_invalid');
    }
    if (auth?.key !== `package.attach:${fields.packageDigest}:${fields.runId}:${fields.scope}`) {
      throw new CoordinationRefusal('context package attach authority is invalid', 'context_package_attach_invalid');
    }
    if (!this._contextPackages.has(fields.packageDigest)) {
      throw new CoordinationRefusal('Context package is unavailable', 'context_package_not_found');
    }
    const payload = { packageDigest: fields.packageDigest, runId: fields.runId, scope: fields.scope };
    const event = this._append('package.attached', payload, auth);
    return {
      ok: true, result: 'attached', event: clone(event),
      attachment: this._contextPackageAttachmentView(event),
    };
  }

  admitContextSession(fields, auth) {
    if (!this._contextProgramPolicy) {
      throw new CoordinationRefusal('Context Program authority is unavailable',
        'context_session_unavailable');
    }
    const deployment = this._currentContextDeployment();
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
    const prior = this._byKey.get(auth?.key);
    if (prior) {
      if (prior.kind !== 'context.session_admitted' || prior.actor !== auth.actor
        || canonicalDigest(prior.payload?.authority) !== canonicalDigest(authority)
        || canonicalDigest(prior.payload?.deployment) !== canonicalDigest(deployment)
        || canonicalDigest(prior.payload?.session) !== canonicalDigest(session)
        || prior.payload?.requestDigest !== canonicalDigest(requestCore)) {
        throw new CoordinationRefusal('Context session idempotency key is bound differently',
          'context_session_conflict');
      }
      const projected = this.contextSession(session.sessionId);
      if (!projected || projected.admittedEvent !== prior.seq) {
        throw new CoordinationIntegrityError('Context session projection is absent',
          'context_session_integrity');
      }
      return freeze({ ok: true, result: 'idempotent', event: clone(prior), session: projected });
    }
    const plan = this._plans.get(this._planVersionKey(
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
        source = this._contextReferenceRead({
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
        attestation = this._contextSourceAttest({
          manifest: session.manifest, branch: clone(branch), source: clone(source),
        });
      } catch (error) {
        throw new CoordinationRefusal(error?.message ?? 'Context source attestation is unavailable',
          error?.code ?? 'context_source_attestation_invalid');
      }
      sourceAttestations.push(this._normalizeContextSourceAttestation(attestation, {
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
      schemaVersion: 1, seq: this._events.length + 1, ts: this._clock(),
      kind: 'context.session_admitted', actor: auth?.actor,
      idempotencyKey: auth?.key, payload,
    };
    this._validateContextSessionPayload(payload, prospective, false);
    const event = this._append('context.session_admitted', payload, auth, prospective.ts);
    const projected = this.contextSession(session.sessionId);
    if (projected?.admittedEvent !== event.seq) {
      throw new CoordinationIntegrityError('Context session admission did not materialize',
        'context_session_integrity');
    }
    return freeze({ ok: true, result: 'admitted', event: clone(event), session: projected });
  }

  replManifestAdmission(manifestDigest) {
    return clone(this._replManifestAdmissions.get(manifestDigest) ?? null);
  }

  _replManifestFailure(message, code, integrity = false) {
    if (integrity) throw new CoordinationIntegrityError(message, code);
    throw new CoordinationRefusal(message, code);
  }

  // REPL-1 rule 5–9: admit a ReplManifest as a single evented authority record. The principal is
  // lease-authenticated for `shared` (run-pinned) and wrapper-forced for `worker:<id>` (store
  // equality) — no caller-supplied `principal`/`replRole` string is ever trusted as authority.
  _validateReplManifestAdmissionPayload(payload, event, integrity = false) {
    const fail = (message, code) => this._replManifestFailure(message, code, integrity);
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

  admitReplManifest(fields, auth) {
    if (!this._contextProgramPolicy) {
      throw new CoordinationRefusal('Context Program authority is unavailable', 'repl_manifest_unavailable');
    }
    const deployment = this._currentContextDeployment();
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
            ? this._resolveReplManifestBranch(branch) : branch)),
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
    // (c) repoId provenance pin (mirrors the Workflow path authority.repoId !== this._repoId).
    if (auth?.repoId !== this._repoId) {
      throw new CoordinationRefusal('Context REPL manifest repository differs from deployment authority',
        'repl_manifest_authority_denied');
    }
    // (c) principal authority: lease-authenticated + run-pinned for `shared`; store-verified
    // equality against the wrapper-derived principalId for `worker:<id>`.
    let principal;
    if (replRole === 'shared') {
      let lease;
      try { lease = this._activeRunOrchestratorLease(auth); }
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
    const prior = this._byKey.get(auth?.key);
    if (prior) {
      if (prior.kind !== 'repl.manifest_admitted' || prior.actor !== auth?.actor
        || prior.payload?.requestDigest !== payload.requestDigest
        || prior.payload?.manifestDigest !== payload.manifestDigest) {
        throw new CoordinationRefusal('Context REPL manifest idempotency key is bound differently',
          'repl_manifest_conflict');
      }
      const projected = this.replManifestAdmission(manifest.digest);
      if (!projected || projected.admittedEvent !== prior.seq) {
        throw new CoordinationIntegrityError('Context REPL manifest projection is absent',
          'repl_manifest_integrity');
      }
      return freeze({ ok: true, result: 'idempotent', event: clone(prior), record: projected });
    }
    // Then the digest level (the map is keyed by manifestDigest, so a divergent principal under a
    // different key would otherwise be last-wins).
    const existing = this._replManifestAdmissions.get(manifest.digest);
    if (existing) {
      if (existing.requestDigest === payload.requestDigest) {
        return freeze({
          ok: true, result: 'idempotent',
          event: clone(this._events[existing.admittedEvent - 1]), record: clone(existing),
        });
      }
      throw new CoordinationRefusal('Context REPL manifest admission principal diverged',
        'repl_manifest_conflict');
    }
    // (d) the run must not be stopping.
    this._assertRunAdmissionOpen(runId);
    // (e) per-run bounds (a named, digest-safe run-lineage ceiling; never a magic store constant).
    const ceiling = this._runLineagePolicy?.maxReplManifestsPerRun ?? DEFAULT_MAX_REPL_MANIFESTS_PER_RUN;
    const perRun = [...this._replManifestAdmissions.values()].filter((row) => row.runId === runId).length;
    if (perRun >= ceiling) {
      throw new CoordinationRefusal('Context REPL manifest per-run ceiling reached', 'repl_manifest_limit');
    }
    const prospective = {
      schemaVersion: 1, seq: this._events.length + 1, ts: this._clock(),
      kind: 'repl.manifest_admitted', actor: auth?.actor, idempotencyKey: auth?.key, payload,
    };
    this._validateReplManifestAdmissionPayload(payload, prospective, false);
    const event = this._append('repl.manifest_admitted', payload, auth, prospective.ts);
    const projected = this.replManifestAdmission(manifest.digest);
    if (projected?.admittedEvent !== event.seq) {
      throw new CoordinationIntegrityError('Context REPL manifest admission did not materialize',
        'repl_manifest_integrity');
    }
    return freeze({ ok: true, result: 'admitted', event: clone(event), record: projected });
  }

  // REPL-1 rule 10: a session admission for a ReplManifest WITHOUT the Plan-node requirement. It
  // reuses contextSessionIdentity (kind-dispatching) and the per-branch byte-proof loop, but does
  // NOT call the Plan-node-coupled attestation, so it mints at schemaVersion 1.
  admitReplSession(fields, auth) {
    if (!this._contextProgramPolicy) {
      throw new CoordinationRefusal('Context Program authority is unavailable', 'context_session_unavailable');
    }
    const deployment = this._currentContextDeployment();
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
    const admission = this._replManifestAdmissions.get(session.manifestDigest);
    if (!admission || admission.runId !== session.runId
      || admission.replRole !== session.manifest.repl.replRole) {
      throw new CoordinationRefusal('Context REPL manifest is not admitted', 'repl_session_unadmitted');
    }
    let authority;
    try {
      authority = normalizeContextAuthority({
        actor: admission.principal.actor, principalId: admission.principal.principalId,
        repoId: this._repoId, runId: session.runId,
      });
    } catch (error) {
      throw new CoordinationRefusal(error.message, 'context_session_invalid');
    }
    const requestCore = {
      actor: authority.actor, principalId: authority.principalId,
      repoId: authority.repoId, runId: authority.runId,
      manifestDigest: session.manifestDigest, environmentDigest: session.environmentDigest,
    };
    const prior = this._byKey.get(auth?.key);
    if (prior) {
      if (prior.kind !== 'context.session_admitted' || prior.actor !== auth.actor
        || canonicalDigest(prior.payload?.authority) !== canonicalDigest(authority)
        || canonicalDigest(prior.payload?.deployment) !== canonicalDigest(deployment)
        || canonicalDigest(prior.payload?.session) !== canonicalDigest(session)
        || prior.payload?.requestDigest !== canonicalDigest(requestCore)) {
        throw new CoordinationRefusal('Context session idempotency key is bound differently',
          'context_session_conflict');
      }
      const projected = this.contextSession(session.sessionId);
      if (!projected || projected.admittedEvent !== prior.seq) {
        throw new CoordinationIntegrityError('Context session projection is absent',
          'context_session_integrity');
      }
      return freeze({ ok: true, result: 'idempotent', event: clone(prior), session: projected });
    }
    for (const branch of session.manifest.branches) {
      let source;
      try {
        source = this._contextReferenceRead({
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
      schemaVersion: 1, seq: this._events.length + 1, ts: this._clock(),
      kind: 'context.session_admitted', actor: auth?.actor,
      idempotencyKey: auth?.key, payload,
    };
    this._validateContextSessionPayload(payload, prospective, false);
    const event = this._append('context.session_admitted', payload, auth, prospective.ts);
    const projected = this.contextSession(session.sessionId);
    if (projected?.admittedEvent !== event.seq) {
      throw new CoordinationIntegrityError('Context session admission did not materialize',
        'context_session_integrity');
    }
    return freeze({ ok: true, result: 'admitted', event: clone(event), session: projected });
  }

  admitContextCell(fields, auth) {
    if (!this._contextProgramPolicy) {
      throw new CoordinationRefusal('Context Program authority is unavailable',
        'context_cell_unavailable');
    }
    const session = this._contextSessions.get(fields?.sessionId);
    if (!session) throw new CoordinationRefusal('Context session is unavailable',
      'context_cell_invalid');
    const contextPolicy = this._normalizeContextDeployment(session.deployment, false).policy;
    let program;
    try { program = normalizeContextProgram(fields?.program, contextPolicy); }
    catch (error) { throw new CoordinationRefusal(error.message, 'context_cell_invalid'); }
    if (!contextProgramIsPure(program, contextPolicy)) {
      throw new CoordinationRefusal('Provider-effect Context Program requires Workflow authority',
        'context_cell_effect_requires_workflow');
    }
    const prior = this._byKey.get(auth?.key);
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
      const projected = this.contextCell(priorCell.cellId);
      if (!projected || projected.admittedEvent !== prior.seq) {
        throw new CoordinationIntegrityError('Context cell projection is absent',
          'context_cell_integrity');
      }
      return freeze({ ok: true, result: 'idempotent', event: clone(prior), cell: projected });
    }
    const cells = [...this._contextCells.values()].filter((row) => row.sessionId === session.sessionId);
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
      schemaVersion: 1, seq: this._events.length + 1, ts: this._clock(),
      kind: 'context.cell_admitted', actor: auth?.actor,
      idempotencyKey: auth?.key, payload,
    };
    this._validateContextCellAdmissionPayload(payload, prospective, false);
    const event = this._append('context.cell_admitted', payload, auth, prospective.ts);
    const projected = this.contextCell(cell.cellId);
    if (projected?.admittedEvent !== event.seq) {
      throw new CoordinationIntegrityError('Context cell admission did not materialize',
        'context_cell_integrity');
    }
    return freeze({ ok: true, result: 'admitted', event: clone(event), cell: projected });
  }

  settleContextCell(fields, auth) { return coordinationLedger.settleContextCell(this, fields, auth); }

  admitContextMapCall(fields, auth) {
    if (!this._contextProgramPolicy || !this._goalPlanPolicy) {
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
    const predecessor = this._plans.get(this._planVersionKey(
      call.source.predecessorPlan.planId, call.source.predecessorPlan.version,
    ));
    const goal = predecessor ? this._goals.get(this._goalVersionKey(
      predecessor.goal.goalId, predecessor.goal.version,
    )) : null;
    if (!goal) throw new CoordinationRefusal('Context map Goal is unavailable',
      'context_map_plan_invalid');
    let planRequest;
    try { planRequest = normalizePlanRequest(fields?.planRequest, this._goalPlanPolicy, goal); }
    catch (error) {
      throw new CoordinationRefusal(error.message, error.code ?? 'context_map_plan_invalid');
    }
    const expectedPlanDigest = goalPlanDigest({
      schemaVersion: 1, repoId: this._repoId, runId: call.source.runId,
      goal: planRequest.goal, predecessor: planRequest.predecessor,
      nodes: planRequest.nodes, totals: planRequest.totals,
      policyDigest: this._goalPlanPolicy.policyDigest,
    });
    if (fields?.expectedPlanDigest !== expectedPlanDigest) {
      throw new CoordinationRefusal('Context map expected Plan digest changed',
        'context_map_plan_invalid');
    }
    const requestCore = { authority, call, planRequest, expectedPlanDigest };
    const cell = this._contextCells.get(call.source.cellId);
    const admissionCore = {
      ...requestCore, sourceCellSettlementDigest: cell?.settlementDigest ?? null,
    };
    const payload = {
      schemaVersion: 1, authority, call, planRequest, expectedPlanDigest,
      requestDigest: canonicalDigest(requestCore),
      admissionDigest: canonicalDigest(admissionCore),
    };
    const prior = this._byKey.get(auth?.key);
    if (prior) {
      if (prior.kind !== 'context.call_admitted' || prior.actor !== auth.actor
        || canonicalDigest(prior.payload) !== canonicalDigest(payload)) {
        throw new CoordinationRefusal('Context map call idempotency key is bound differently',
          'context_map_call_conflict');
      }
      const projected = this.contextCall(call.callId);
      if (!projected || projected.admittedEvent !== prior.seq) {
        throw new CoordinationIntegrityError('Context map call projection is absent',
          'context_map_call_integrity');
      }
      return freeze({ ok: true, result: 'idempotent', event: clone(prior), call: projected });
    }
    const prospective = {
      schemaVersion: 1, seq: this._events.length + 1, ts: this._clock(),
      kind: 'context.call_admitted', actor: auth?.actor,
      idempotencyKey: auth?.key, payload,
    };
    this._validateContextMapCallAdmissionPayload(payload, prospective, false);
    const event = this._append('context.call_admitted', payload, auth, prospective.ts);
    const projected = this.contextCall(call.callId);
    if (projected?.admittedEvent !== event.seq) {
      throw new CoordinationIntegrityError('Context map call admission did not materialize',
        'context_map_call_integrity');
    }
    return freeze({ ok: true, result: 'admitted', event: clone(event), call: projected });
  }

  admitContextEffectCall(fields, auth) {
    if (!this._contextProgramPolicy || !this._goalPlanPolicy) {
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
    const predecessor = this._plans.get(this._planVersionKey(
      callAuthority.predecessorPlan.planId, callAuthority.predecessorPlan.version,
    ));
    const goal = predecessor ? this._goals.get(this._goalVersionKey(
      predecessor.goal.goalId, predecessor.goal.version,
    )) : null;
    if (!goal) throw new CoordinationRefusal('Context effect-call Goal is unavailable',
      'context_call_plan_invalid');
    let planRequest;
    try { planRequest = normalizePlanRequest(fields?.planRequest, this._goalPlanPolicy, goal); }
    catch (error) {
      throw new CoordinationRefusal(error.message, error.code ?? 'context_call_plan_invalid');
    }
    const expectedPlanDigest = goalPlanDigest({
      schemaVersion: 1, repoId: this._repoId, runId: principal.runId,
      goal: planRequest.goal, predecessor: planRequest.predecessor,
      nodes: planRequest.nodes, totals: planRequest.totals,
      policyDigest: this._goalPlanPolicy.policyDigest,
    });
    if (fields?.expectedPlanDigest !== expectedPlanDigest) {
      throw new CoordinationRefusal('Context effect-call expected Plan digest changed',
        'context_call_plan_invalid');
    }
    const sourceSettlementDigest = call.operator === 'map'
      ? this._contextCells.get(call.source.id)?.settlementDigest ?? null
      : this._contextCalls.get(call.source.id)?.settlementDigest ?? null;
    const requestCore = { authority, call, planRequest, expectedPlanDigest };
    const admissionCore = {
      ...requestCore, sourceSettlementDigest,
    };
    const payload = {
      schemaVersion: 2, authority, call, planRequest, expectedPlanDigest,
      requestDigest: canonicalDigest(requestCore),
      admissionDigest: canonicalDigest(admissionCore),
    };
    const prior = this._byKey.get(auth?.key);
    if (prior) {
      if (prior.kind !== 'context.call_admitted' || prior.actor !== auth.actor
        || canonicalDigest(prior.payload) !== canonicalDigest(payload)) {
        throw new CoordinationRefusal('Context effect-call idempotency key is bound differently',
          'context_call_conflict');
      }
      const projected = this.contextCall(call.callId);
      if (!projected || projected.admittedEvent !== prior.seq) {
        throw new CoordinationIntegrityError('Context effect-call projection is absent',
          'context_call_integrity');
      }
      return freeze({ ok: true, result: 'idempotent', event: clone(prior), call: projected });
    }
    const prospective = {
      schemaVersion: 1, seq: this._events.length + 1, ts: this._clock(),
      kind: 'context.call_admitted', actor: auth?.actor,
      idempotencyKey: auth?.key, payload,
    };
    this._validateContextEffectCallAdmissionPayload(payload, prospective, false);
    const event = this._append('context.call_admitted', payload, auth, prospective.ts);
    const projected = this.contextCall(call.callId);
    if (projected?.admittedEvent !== event.seq) {
      throw new CoordinationIntegrityError('Context effect-call admission did not materialize',
        'context_call_integrity');
    }
    return freeze({ ok: true, result: 'admitted', event: clone(event), call: projected });
  }
  taskResourceRelease(taskId) {
    return coordinationInternals.taskResourceRelease(this._taskResourceReleases, taskId);
  }

  recordTaskResourceRelease(fields, auth) { return coordinationLedger.recordTaskResourceRelease(this, fields, auth); }

  _settleContextCall(fields, auth, expectedKind = null) { return coordinationLedger._settleContextCall(this, fields, auth, expectedKind); }

  settleContextCall(fields, auth) { return coordinationLedger.settleContextCall(this, fields, auth); }

  settleContextMapCall(fields, auth) { return coordinationLedger.settleContextMapCall(this, fields, auth); }

  settleContextEffectCall(fields, auth) { return coordinationLedger.settleContextEffectCall(this, fields, auth); }

  defineGoal(fields, auth) { return coordinationLedger.defineGoal(this, fields, auth); }

  proposePlan(fields, auth) { return coordinationLedger.proposePlan(this, fields, auth); }

  approvePlan(fields, auth) { return coordinationLedger.approvePlan(this, fields, auth); }

  _planDispatchState(gate, route, preservedResumeClaim = null, options = {}) { return coordinationLedger._planDispatchState(this, gate, route, preservedResumeClaim, options); }

  previewPlanDispatch(gate, route, preservedResumeClaim = null) { return this._planDispatchState(gate, route, preservedResumeClaim); }

  previewPlanRevision(gate, route) {
    const state = this._planDispatchState(gate, route, null, { allowRevision: true });
    this._workflowRevisionAuthority(state.plan, state.node);
    return state;
  }
  reconcilePlanGatedTask(taskId, gate, route, auth) {
    return coordinationReplay.reconcilePlanGatedTask(this, taskId, gate, route, auth);
  }
  reconcilePlanRevisionTask(taskId, gate, route, auth) {
    return coordinationReplay.reconcilePlanRevisionTask(this, taskId, gate, route, auth);
  }

  createPlanRevisionTask(fields, gate, route, auth) { return coordinationLedger.createPlanRevisionTask(this, fields, gate, route, auth); }

  createPlanGatedTask(fields, gate, route, auth) { return coordinationLedger.createPlanGatedTask(this, fields, gate, route, auth); }

  createPlanGatedWave(rawEntries, auth) { return coordinationLedger.createPlanGatedWave(this, rawEntries, auth); }

  // PS5: re-dispatch one approved Plan node from a preserved progress checkpoint. The caller
  // (Coordinator) has already postchecked the immutable checkpoint ref; this admission only
  // records the attestation and validates that the prior dispatch's task is durably terminal-
  // cancelled, so a fresh owned task may continue the same Plan node at the preserved commit.
  // Reuses the ordinary two-event goal_plan_node_dispatch batch so the integrity walker and the
  // last-wins plan projection pick up the resumed task as the node's current dispatch.
  createAndClaimPreservedResumeRefinement(fields, gate, route, preservedResume, auth) {
    return coordinationReplay.createAndClaimPreservedResumeRefinement(this, fields, gate, route, preservedResume, auth);
  }

  createAndClaimPlanRecoveryRefinement(fields, gate, route, attribution, auth) {
    return coordinationReplay.createAndClaimPlanRecoveryRefinement(this, fields, gate, route, attribution, auth);
  }
  unsettledPlanNodeTasks() {
    return coordinationInternals.unsettledPlanNodeTasks(this);
  }

  settlePlanNodeBudget(taskId, auth) { return coordinationLedger.settlePlanNodeBudget(this, taskId, auth); }

  goalPlanStatus(fields, auth) { return coordinationLedger.goalPlanStatus(this, fields, auth); }
  routeObservations() { return coordinationLedger.routeObservations(this._routeObservations); }
  recoveryDispatchState(workerId) {
    return coordinationReplay.recoveryDispatchState(this, workerId);
  }
  representationProduction(identityDigest) {
    return coordinationInternals.representationProduction(this._representations, identityDigest);
  }
  representationProductionByRequest(requestDigest) {
    return coordinationInternals.representationProductionByRequest(this, requestDigest);
  }
  representationProductionAdmission(request, auth) {
    const preview = { actor: auth?.actor, idempotencyKey: auth?.key, seq: this._events.length + 1 };
    const state = this._representationRequest(request, preview, false, false);
    const prior = this._byKey.get(auth?.key);
    if (prior) {
      const binding = this._representationRequests.get(state.requestDigest);
      if (!['knowledge.representation_produced', 'knowledge.representation_request_bound'].includes(prior.kind)
        || prior.actor !== auth.actor || prior.payload?.requestDigest !== state.requestDigest || !binding) {
        throw new CoordinationRefusal('representation idempotency key is bound differently', 'representation_conflict');
      }
      return freeze({ ok: true, result: 'idempotent', requestDigest: state.requestDigest, policyDigest: state.policyDigest, representation: this.representationProduction(binding.identityDigest) });
    }
    this._representationRequest(request, preview, false, true);
    return freeze({ ok: true, result: 'admitted', requestDigest: state.requestDigest, policyDigest: state.policyDigest, representation: null });
  }
  prepareRepresentationProduction(fields, auth) {
    const preview = { schemaVersion: 1, seq: this._events.length + 1, ts: this._clock(), kind: 'knowledge.representation_produced', actor: auth?.actor, idempotencyKey: auth?.key };
    const prior = this._byKey.get(auth?.key);
    const derived = this._representationGraphTemplate(fields, preview, false, !prior);
    this._validateRepresentationNamespaces(derived, false);
    return freeze({
      identityDigest: derived.identityDigest, eventSeq: preview.seq, receipt: clone(derived.receipt), receiptSerialized: derived.receiptSerialized,
      receiptRef: clone(derived.receiptRef), projection: clone(derived.projection),
    });
  }
  recordRepresentationProduction(fields, receiptRef, auth) { return coordinationLedger.recordRepresentationProduction(this, fields, receiptRef, auth); }
  reverifyRepresentationProduction(identityDigest, expectedSource = null) {
    return coordinationInternals.reverifyRepresentationProduction(this, identityDigest, expectedSource);
  }

  _effectiveRunOrchestratorLeaseState(lease, now = this._clock()) {
    if (lease.status === 'revoked') return freeze({ state: 'revoked', reason: lease.revocation?.reason ?? 'session_revoked' });
    if (Date.parse(now) >= Date.parse(lease.expiresAt)) return freeze({ state: 'expired', reason: 'expired' });
    const task = this._tasks.get(lease.parent.taskId);
    if (!task || task.version !== lease.parent.taskVersion || task.assignee !== lease.parent.workerId) {
      return freeze({ state: 'inactive', reason: 'parent_stale' });
    }
    if (task.status !== 'working') return freeze({ state: 'inactive', reason: 'parent_terminal' });
    if (this.runStop(lease.parent.runId)) return freeze({ state: 'inactive', reason: 'parent_run_stopping' });
    return freeze({ state: 'active', reason: null });
  }

  runAuthoritySnapshot() { return coordinationLedger.runAuthoritySnapshot(this); }

  runOrchestrationView(runId) { return coordinationLedger.runOrchestrationView(this, runId); }

  _scratchpadSnapshot() { return coordinationLedger._scratchpadSnapshot(this); }

  snapshot() { return coordinationLedger.snapshot(this); }

  /** Narrow current Goal/Plan index used by resident startup reconciliation. This avoids cloning
   * unrelated tasks, evidence, knowledge, Web/MCP receipts, or historical Goal/Plan versions. */
  goalPlanRun(repoId, runId) { return coordinationLedger.goalPlanRun(this, repoId, runId); }

  /** Issue #391 (C12): the Plan history of one Run's current durable Goal, as a PAGE — the first
   * `limit` generations past `cursor` plus {truncated, nextCursor}. `limit` is a page size: a Run
   * holding more generations than the caller asked for is a truncated page, never the
   * `goal_plan_status_oversize` refusal this accessor used to raise for the row count, so the
   * caller walks the cursor to the whole bounded set instead of being told it asked for too much. */
  goalPlanRunPlans(repoId, runId, limit = 100_000, cursor = 0) { return coordinationLedger.goalPlanRunPlans(this, repoId, runId, limit, cursor); }
  goalPlanRunIds(repoId, limit = 100_000, cursor = 0) {
    return coordinationInternals.goalPlanRunIds(this._goalHeads, repoId, limit, cursor);
  }

  /** Issue #391 (C12): the dispatches across every Plan generation of one Run's current Goal, as
   * a PAGE (`limit` is a page size, `cursor` resumes past the last row served) — the narrow read
   * behind semantic control-target resolution (workflow interrupt recipients), which previously
   * cloned the entire store through snapshot().goalPlan.dispatches and refused a bounded request
   * for the row count. */
  goalPlanDispatches(repoId, runId, limit = 100_000, cursor = 0) { return coordinationLedger.goalPlanDispatches(this, repoId, runId, limit, cursor); }

  /** Approval + dispatches for ONE Plan generation of one Run's current Goal — the narrow read
   * behind workflow Plan-history projections (_runAtPlan), which previously cloned the entire
   * store through snapshot().goalPlan (approvals + dispatches). */
  goalPlanPlanState(repoId, runId, planId, version, digest) { return coordinationLedger.goalPlanPlanState(this, repoId, runId, planId, version, digest); }

  /** Issue #391 (C12): the current Goal/Plan heads for one repo, as a PAGE of head rows — the
   * first `limit` heads past `cursor`, each carrying the plan head it owns, plus
   * {truncated, nextCursor}. The projection behind runs.list, which previously cloned the entire
   * store through snapshot().goalPlan and refused a bounded request for the row count; runs.list
   * walks these pages to the whole bounded head set, so a deployment that outgrew one page is
   * paged rather than told to ask for fewer rows. Heads only: no historical versions, no
   * dispatch bodies. */
  goalPlanSummary(repoId, limit = 100_000, cursor = 0) { return coordinationLedger.goalPlanSummary(this, repoId, limit, cursor); }
  healthCheck() {
    return coordinationInternals.healthCheck(this);
  }
  readyTasks() {
    return coordinationInternals.readyTasks(this._tasks);
  }
  fleetDrain(id) {
    return coordinationInternals.fleetDrain(this._fleetDrains, id);
  }
  runStop(runId) {
    return coordinationInternals.runStop(this, runId);
  }

  runResultAdoption(runId, nodeKey) { return coordinationLedger.runResultAdoption(this, runId, nodeKey); }

  pendingRunResultAdoptions(limit = 1_000) { return coordinationLedger.pendingRunResultAdoptions(this._runResultAdoptions, limit); }

  admitRunResultAdoption(fields, auth) {
    const preview = { actor: auth?.actor, idempotencyKey: auth?.key };
    const request = this._normalizeRunResultAdoptionRequest(fields, preview, false);
    const prior = this._byKey.get(auth.key);
    if (prior) {
      if (prior.kind !== 'run.result_adoption_admitted' || prior.actor !== auth.actor
        || prior.payload?.requestDigest !== request.requestDigest) {
        throw new CoordinationRefusal('run result adoption idempotency conflict', 'run_result_adoption_conflict');
      }
      return freeze({ ok: true, result: 'replay', event: clone(prior), adoption: this.runResultAdoption(fields.runId, fields.nodeKey) });
    }
    if (this._runResultAdoptions.has(this._runResultAdoptionKey(fields.runId, fields.nodeKey))) {
      throw new CoordinationRefusal('run result adoption identity conflict', 'run_result_adoption_conflict');
    }
    const binding = this._deriveRunResultAdoptionBinding(request, false);
    const core = {
      schemaVersion: 1, ...clone(request), retainedResultRef: retainedResultRef(request.resultSha), binding: clone(binding),
    };
    const payload = { ...core, adoptionDigest: canonicalDigest(core) };
    this._validateRunResultAdoptionAdmission(payload, { ...preview, payload }, false);
    const event = this._append('run.result_adoption_admitted', payload, auth);
    return freeze({ ok: true, result: 'admitted', event: clone(event), adoption: this.runResultAdoption(fields.runId, fields.nodeKey) });
  }

  completeRunResultAdoption(fields, auth) { return coordinationLedger.completeRunResultAdoption(this, fields, auth); }

  // ==========================================================================
  // Phase 69 VR6 — durable verifier retry cascade (two-phase, response-loss safe)
  // ==========================================================================

  _runVerificationRetryKey(runId, nodeKey) { return coordinationLedger._runVerificationRetryKey(runId, nodeKey); }

  _runVerificationRetryFailure(message, code = 'run_verification_retry_integrity', integrity = false) {
    throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code);
  }

  runVerificationRetry(runId, nodeKey) { return coordinationLedger.runVerificationRetry(this, runId, nodeKey); }

  pendingRunVerificationRetries(limit = 1_000) { return coordinationLedger.pendingRunVerificationRetries(this._runVerificationRetries, limit); }

  _readRetryVerificationEvidence(reference, integrity) { return coordinationLedger._readRetryVerificationEvidence(this, reference, integrity); }

  _normalizeRunVerificationRetryRequest(fields, event, integrity = false) {
    const fail = (message, code = 'run_verification_retry_invalid') => this._runVerificationRetryFailure(message, code, integrity);
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

  _validateRunVerificationRetryAdmission(p, event, integrity = false) {
    const fail = (message, code = 'run_verification_retry_unavailable') => this._runVerificationRetryFailure(message, code, integrity);
    const request = this._normalizeRunVerificationRetryRequest(
      Object.fromEntries(Object.entries(p ?? {}).filter(([key]) => key !== 'admissionDigest')), event, integrity,
    );
    if (!/^[a-f0-9]{64}$/.test(p?.admissionDigest ?? '')
      || p.admissionDigest !== canonicalDigest(Object.fromEntries(Object.entries(p).filter(([key]) => key !== 'admissionDigest')))) {
      this._runVerificationRetryFailure('run verification retry admission digest is invalid', 'run_verification_retry_integrity', integrity);
    }
    const task = this._tasks.get(request.taskId);
    const dispatch = this._planTaskLinks.get(request.taskId);
    const goalPlan = task?.brief?.goalPlan;
    if (!task || task.runId !== request.runId || task.status !== 'failed' || task.acceptanceRevocation
      || !dispatch || !goalPlan || dispatch.taskId !== task.id || dispatch.binding?.nodeKey !== request.nodeKey
      || canonicalDigest(dispatch.binding) !== canonicalDigest(goalPlan)) {
      fail('run verification retry requires the exact failed approved Plan task');
    }
    const plan = this._plans.get(this._planVersionKey(goalPlan.planId, goalPlan.planVersion));
    const approval = this._planApprovals.get(this._planVersionKey(goalPlan.planId, goalPlan.planVersion));
    const node = plan?.nodes?.find((row) => row.key === request.nodeKey);
    if (!plan || !approval || approval.disposition !== 'approved' || !node
      || plan.repoId !== request.repoId || plan.runId !== request.runId
      || plan.digest !== request.planDigest || plan.digest !== goalPlan.planDigest
      || canonicalDigest(node.verification) !== request.verificationDigest) {
      fail('run verification retry Plan authority is unavailable or changed');
    }
    const { source } = this._readRetryVerificationEvidence(request.priorEvidence, integrity);
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
    const existing = this._runVerificationRetries.get(this._runVerificationRetryKey(request.runId, request.nodeKey));
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

  _validateRunVerificationRetryCompletion(p, event, integrity = false) {
    const fail = (message, code = 'run_verification_retry_integrity') => this._runVerificationRetryFailure(message, code, integrity);
    if (!p || typeof p !== 'object' || Array.isArray(p)
      || Object.keys(p).sort().join(',') !== ['attempt', 'nodeKey', 'receipt', 'runId', 'schemaVersion'].join(',')
      || p.schemaVersion !== 1 || !validRunId(p.runId) || !boundedText(p.nodeKey, 256)
      || !Number.isSafeInteger(p.attempt) || p.attempt < 1) {
      fail('run verification retry completion is malformed');
    }
    const retry = this._runVerificationRetries.get(this._runVerificationRetryKey(p.runId, p.nodeKey));
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
    const task = this._tasks.get(retry.taskId);
    if (!task || task.status !== 'failed') fail('run verification retry completion requires the admitted failed task');
    if (receipt.state === 'cancelled') {
      if (receipt.evidence !== null || receipt.result !== null || receipt.stability !== null) {
        fail('a cancelled retry carries no verification evidence, result, or stability');
      }
      return retry;
    }
    const { mapped, source } = this._readRetryVerificationEvidence(receipt.evidence, integrity);
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

  admitRunVerificationRetry(fields, auth) {
    const preview = { actor: auth?.actor, idempotencyKey: auth?.key };
    const prior = this._byKey.get(auth?.key);
    if (prior) {
      if (prior.kind !== 'run.verification_retry_admitted' || prior.actor !== auth.actor
        || prior.payload?.requestDigest !== fields?.requestDigest) {
        throw new CoordinationRefusal('run verification retry idempotency conflict', 'run_verification_retry_conflict');
      }
      return freeze({ ok: true, result: 'replay', event: clone(prior), retry: this.runVerificationRetry(fields.runId, fields.nodeKey) });
    }
    const request = this._normalizeRunVerificationRetryRequest(fields, preview, false);
    const payload = { ...clone(request), admissionDigest: canonicalDigest(clone(request)) };
    this._validateRunVerificationRetryAdmission(payload, { ...preview, payload }, false);
    const event = this._append('run.verification_retry_admitted', payload, auth);
    return freeze({ ok: true, result: 'admitted', event: clone(event), retry: this.runVerificationRetry(request.runId, request.nodeKey) });
  }

  completeRunVerificationRetry(fields, auth) { return coordinationLedger.completeRunVerificationRetry(this, fields, auth); }
  runResultExport(runId, nodeKey) {
    return coordinationInternals.runResultExport(this._runResultExports, runId, nodeKey);
  }

  pendingRunResultExports(limit = 1_000) { return coordinationLedger.pendingRunResultExports(this._runResultExports, limit); }

  admitRunResultExport(fields, auth) {
    const preview = { actor: auth?.actor, idempotencyKey: auth?.key };
    const request = this._normalizeRunResultExportRequest(fields, preview, false);
    const prior = this._byKey.get(auth?.key);
    if (prior) {
      if (prior.kind !== 'run.result_export_admitted' || prior.actor !== auth.actor
        || prior.payload?.requestDigest !== request.requestDigest) {
        throw new CoordinationRefusal('run result export idempotency conflict', 'run_result_export_conflict');
      }
      return freeze({ ok: true, result: 'replay', event: clone(prior), export: this.runResultExport(fields.runId, fields.nodeKey) });
    }
    if ([...this._runResultExports.values()].some((state) => state.runId === fields.runId && state.nodeKey === fields.nodeKey)) {
      throw new CoordinationRefusal('run result export identity conflict', 'run_result_export_conflict');
    }
    const binding = this._deriveRunResultExportBinding(request, false);
    const core = { schemaVersion: 1, ...clone(request), locator: `export:${request.exportId}`, binding: clone(binding) };
    const payload = { ...core, admissionDigest: canonicalDigest(core) };
    this._validateRunResultExportAdmission(payload, { ...preview, payload }, false);
    const event = this._append('run.result_export_admitted', payload, auth);
    return freeze({ ok: true, result: 'admitted', event: clone(event), export: this.runResultExport(fields.runId, fields.nodeKey) });
  }

  completeRunResultExport(fields, auth) { return coordinationLedger.completeRunResultExport(this, fields, auth); }
  runControl(controlId) {
    return coordinationInternals.runControl(this._runControls, controlId);
  }
  runControls(runId, limit = 100_000) {
    return coordinationInternals.runControls(this._runControls, runId, limit);
  }

  pendingRunControls(limit = 1_000) { return coordinationLedger.pendingRunControls(this._runControls, limit); }

  admitRunControl(fields, auth) {
    const preview = {
      seq: this._events.length + 1,
      actor: auth?.actor,
      idempotencyKey: auth?.key,
      payload: fields,
    };
    this._validateRunControlAdmission(fields, preview);
    const prior = this._byKey.get(auth.key);
    if (prior) {
      if (prior.kind !== 'run.control_admitted' || prior.actor !== auth.actor
        || canonicalDigest(prior.payload) !== canonicalDigest(fields)) {
        throw new CoordinationRefusal('run control idempotency conflict', 'run_control_conflict');
      }
      return freeze({
        ok: true, result: 'replay', event: clone(prior),
        control: this.runControl(fields.controlId),
      });
    }
    if (this._runControls.has(fields.controlId)) {
      throw new CoordinationRefusal('run control identity conflict', 'run_control_conflict');
    }
    const event = this._append('run.control_admitted', clone(fields), auth);
    return freeze({
      ok: true, result: 'admitted', event: clone(event),
      control: this.runControl(fields.controlId),
    });
  }

  beginRunControlEffect(fields, auth) { return coordinationLedger.beginRunControlEffect(this, fields, auth); }

  acknowledgeRunControl(fields, auth) { return coordinationLedger.acknowledgeRunControl(this, fields, auth); }

  settleRunControl(fields, auth) { return coordinationLedger.settleRunControl(this, fields, auth); }

  pendingRunStops(limit = 1_000) { return coordinationLedger.pendingRunStops(this._runStops, limit); }

  admitRunStop(fields, auth) {
    const expectedFields = ['schemaVersion', 'repoId', 'runId', 'reasonDigest', 'requestDigest'];
    if (!fields || Object.keys(fields).sort().join(',') !== expectedFields.sort().join(',') || fields.schemaVersion !== 1
      || !validRunId(fields.repoId) || !validRunId(fields.runId) || !/^[a-f0-9]{64}$/.test(fields.reasonDigest ?? '')
      || fields.requestDigest !== canonicalDigest({ repoId: fields.repoId, runId: fields.runId, reasonDigest: fields.reasonDigest })
      || auth?.key !== `run.stop:${fields.runId}` || !boundedText(auth?.actor, 256)) {
      throw new CoordinationRefusal('run stop request is invalid', 'run_stop_invalid');
    }
    const prior = this._byKey.get(auth.key);
    if (prior) {
      if (prior.kind !== 'run.stop_admitted' || prior.actor !== auth.actor || prior.payload?.requestDigest !== fields.requestDigest) {
        throw new CoordinationRefusal('run stop idempotency conflict', 'run_stop_conflict');
      }
      return freeze({ ok: true, result: 'replay', event: clone(prior), stop: this.runStop(fields.runId) });
    }
    if (this.runStop(fields.runId)) throw new CoordinationRefusal('run stop identity conflict', 'run_stop_conflict');
    const lineage = this._runLineages.get(fields.runId) ?? null;
    if (this._runLineagePolicy && (fields.repoId !== this._repoId
      || (lineage && lineage.repoId !== fields.repoId))) {
      throw new CoordinationRefusal('run stop repository differs from Run authority', 'run_stop_repository_mismatch');
    }
    const known = this._goalHeads.has(this._goalScopeKey(fields.repoId, fields.runId))
      || lineage?.repoId === fields.repoId
      || [...this._tasks.values()].some((task) => task.runId === fields.runId)
      // A run that owns a board (the facade/epic #87+#48 orchestrator posture records a
      // boardAdmission binding) is a real run for the stop lane too — a board-bound run must be
      // closable so the facade's board run-open check can observe the closed state.
      || [...this._boardRunBindings.values()].some((binding) => binding.runId === fields.runId);
    if (!known) throw new CoordinationRefusal(`unknown run ${fields.runId}`, 'not_found');
    const targets = this._runStopTargets(fields.runId);
    const schemaVersion = targets.targetContextCallIds?.length > 0 ? 3
      : targets.targetContextSessionIds?.length > 0
        || targets.targetContextCellIds?.length > 0 ? 2 : 1;
    const payload = { ...clone(fields), schemaVersion, ...targets };
    const preview = { seq: this._events.length + 1, actor: auth.actor, idempotencyKey: auth.key, payload };
    this._validateRunStopAdmission(payload, preview);
    const event = this._append('run.stop_admitted', payload, auth);
    return freeze({ ok: true, result: 'admitted', event: clone(event), stop: this.runStop(fields.runId) });
  }

  completeRunStop(runId, receipt, auth) { return coordinationLedger.completeRunStop(this, runId, receipt, auth); }

  admitFleetDrain(fields, auth) {
    const preview = { actor: auth?.actor, idempotencyKey: auth?.key, payload: fields };
    this._validateFleetDrainAdmission(fields, preview);
    const prior = this._byKey.get(auth.key);
    if (prior) {
      if (prior.kind !== 'fleet.drain_admitted' || prior.actor !== auth.actor || canonicalDigest(prior.payload) !== canonicalDigest(fields)) throw new CoordinationRefusal('fleet drain idempotency conflict', 'fleet_drain_conflict');
      return freeze({ ok: true, result: 'replay', event: clone(prior), drain: this.fleetDrain(fields.drainId) });
    }
    const existing = this._fleetDrains.get(fields.drainId);
    if (existing) throw new CoordinationRefusal('fleet drain identity conflict', 'fleet_drain_conflict');
    const event = this._append('fleet.drain_admitted', clone(fields), auth);
    return freeze({ ok: true, result: 'admitted', event: clone(event), drain: this.fleetDrain(fields.drainId) });
  }

  recordFleetDrainDisposition(drainId, workerId, disposition, auth) { return coordinationLedger.recordFleetDrainDisposition(this, drainId, workerId, disposition, auth); }

  completeFleetDrain(drainId, receipt, auth) { return coordinationLedger.completeFleetDrain(this, drainId, receipt, auth); }
  webCommand(id) {
    return coordinationInternals.webCommand(this._webCommands, id);
  }
  webCommandByScope(scopeKey) {
    return coordinationInternals.webCommandByScope(this, scopeKey);
  }

  admitWebCommand(fields, auth) {
    if (!fields?.commandId || !fields?.scopeKey || !fields?.requestDigest) throw new TypeError('web command identity, scope, and digest required');
    const priorId = this._webCommandScopes.get(fields.scopeKey);
    if (priorId) {
      const prior = this._webCommands.get(priorId);
      if (prior.requestDigest !== fields.requestDigest) return freeze({ ok: false, result: 'idempotency_conflict' });
      return freeze({ ok: true, result: 'replay', command: clone(prior) });
    }
    if (this._webCommands.has(fields.commandId)) return freeze({ ok: false, result: 'command_id_conflict' });
    const event = this._append('web.command_admitted', clone(fields), auth);
    return freeze({ ok: true, result: 'admitted', event: clone(event), command: this.webCommand(fields.commandId) });
  }

  completeWebCommand(commandId, outcome, auth) { return coordinationLedger.completeWebCommand(this, commandId, outcome, auth); }

  failWebCommand(commandId, outcome, auth) { return coordinationLedger.failWebCommand(this, commandId, outcome, auth); }
  mcpCall(id) {
    return coordinationInternals.mcpCall(this._mcpCalls, id);
  }
  mcpCallByScope(scopeKey) {
    return coordinationInternals.mcpCallByScope(this, scopeKey);
  }

  admitMcpCall(fields, auth) {
    if (!fields?.callId || !fields?.scopeKey || !fields?.requestDigest) throw new TypeError('MCP call identity, scope, and digest required');
    const priorId = this._mcpCallScopes.get(fields.scopeKey);
    if (priorId) {
      const prior = this._mcpCalls.get(priorId);
      if (prior.requestDigest !== fields.requestDigest) return freeze({ ok: false, result: 'idempotency_conflict' });
      return freeze({ ok: true, result: 'replay', call: clone(prior) });
    }
    if (this._mcpCalls.has(fields.callId)) return freeze({ ok: false, result: 'call_id_conflict' });
    const event = this._append('mcp.call_admitted', clone(fields), auth);
    return freeze({ ok: true, result: 'admitted', event: clone(event), call: this.mcpCall(fields.callId) });
  }

  completeMcpCall(callId, outcome, auth) { return coordinationLedger.completeMcpCall(this, callId, outcome, auth); }

  failMcpCall(callId, outcome, auth) { return coordinationLedger.failMcpCall(this, callId, outcome, auth); }

  recordMcpAudit(fields, auth) { return coordinationLedger.recordMcpAudit(this, fields, auth); }

  recordWebAudit(fields, auth) { return coordinationLedger.recordWebAudit(this, fields, auth); }

  _isDerivedPlanSemanticReview(fields) {
    const parent = this._tasks.get(fields?.refines);
    const review = fields?.review;
    const structured = review?.structured;
    const target = structured?.target;
    const gate = parent?.brief?.goalPlan;
    if (!parent || parent.status !== 'completed' || parent.acceptanceRevocation
      || fields?.taskType !== 'review' || fields?.runId == null || fields.runId !== parent.runId
      || review?.kind !== 'review' || review.parentTaskId !== parent.id || review.parentWorkerId !== parent.assignee
      || structured?.purpose !== 'run_semantic_review' || !target
      || target.repoId !== this._goalPlanPolicy?.repoId || target.runId !== fields.runId
      || target.taskId !== parent.id || target.resultSha !== review.resultSha
      || target.goalDigest !== gate?.goalDigest || target.planDigest !== gate?.planDigest
      || target.approvalDigest !== gate?.approvalDigest) return false;
    const approval = this._planApprovals.get(this._planVersionKey(gate.planId, gate.planVersion));
    if (!approval || approval.disposition !== 'approved' || approval.digest !== gate.approvalDigest) return false;
    const artifacts = parent.artifactIds.map((id) => this._artifacts.get(id)).filter(Boolean);
    const active = (artifact) => artifact.accepted === true && artifact.supersededBy === null
      && !Object.hasOwn(artifact, 'acceptanceInvalidation');
    return artifacts.some((artifact) => active(artifact) && artifact.kind === 'commit'
      && artifact.refs?.sha === target.resultSha && artifact.id === target.commitArtifact?.id
      && artifact.digest === target.commitArtifact?.digest)
      && artifacts.some((artifact) => active(artifact) && artifact.kind === 'verification'
        && artifact.id === target.verificationArtifact?.id && artifact.digest === target.verificationArtifact?.digest);
  }

  createTask(fields, auth) { return coordinationLedger.createTask(this, fields, auth); }
  createAndClaimRecoveryRefinement(fields, attribution, auth) {
    return coordinationReplay.createAndClaimRecoveryRefinement(this, fields, attribution, auth);
  }

  // D1 (KG settlement contract): the dedicated atomic settlement-task API — one hub-internal
  // lease anchor per wave. Mirrors createAndClaimRecoveryRefinement's create+claim batch shape
  // (relation 'settlement', capabilities exactly ['baton_orchestrator'], orchestrator actor
  // only), bypassing plan-mandatory the same way. The objective is a hub-fixed constant carrying
  // only the waveId; the caller supplies NO prose. Closed fields {id, runId, reservedWorkerId}
  // are pinned to settlement-task:<waveId> / run-settlement:<waveId> so the lease identity is
  // stable across re-drive. Idempotency by caller key, replay-exact.
  createAndClaimSettlementTask(fields, auth) { return coordinationLedger.createAndClaimSettlementTask(this, fields, auth); }

  // Sweep (KG settlement D3 step 0, DRIVER-TRIGGERED, NO TIMERS): at wave close, retire every
  // PRIOR settlement lease (a wave other than the one now closing) that carries no admission — its
  // review window is over precisely because a later wave has closed, so the window is bounded by
  // driver cadence, not a wall clock. Revokes with reason `review_window_expired`, cancels the
  // settlement task, and retires un-admitted candidate board items. Bounded ≤ maxLeases per pass;
  // each step is idempotent (a revoked lease is skipped next pass, a terminal task is left alone),
  // so repeated driver passes finish the residue. The currently-closing wave is excluded so its own
  // freshly-materialized lease is never swept (re-drive stays exactly-once).
  sweepSettlementLeases(repoId, options = {}) { return coordinationLedger.sweepSettlementLeases(this, repoId, options); }

  sealRunScorecard(fields, auth) { return coordinationLedger.sealRunScorecard(this, fields, auth); }

  claimTask(id, worker, expectedVersion, auth, attribution = {}) { return coordinationLedger.claimTask(this, id, worker, expectedVersion, auth, attribution); }

  transitionTask(id, to, expectedVersion, auth, evidence = null) { return coordinationLedger.transitionTask(this, id, to, expectedVersion, auth, evidence); }

  revokeTaskAcceptance(fields, auth) {
    const request = this._acceptanceRevocationRequest(fields, auth);
    const requestDigest = canonicalDigest({ actor: auth.actor, idempotencyKey: auth.key, request });
    const prior = this._byKey.get(auth.key);
    if (prior) {
      const core = Object.fromEntries(Object.entries(prior.payload ?? {}).filter(([key]) => key !== 'receiptDigest'));
      if (prior.kind !== 'task.acceptance_revoked' || prior.actor !== auth.actor
        || prior.payload?.requestDigest !== requestDigest || prior.payload?.receiptDigest !== canonicalDigest(core)) {
        throw new CoordinationRefusal('task acceptance revocation idempotency conflict', 'acceptance_revocation_conflict');
      }
      return freeze({
        ok: true, result: 'idempotent', event: clone(prior), task: this.task(request.taskId),
        artifacts: prior.payload.artifactTargets.map((target) => this.artifact(target.artifactId)),
        knowledgeNodes: prior.payload.knowledgeTargets.map((target) => clone(this._knowledgeNodes.get(target.nodeId))),
      });
    }
    const task = this._tasks.get(request.taskId);
    if (!task || task.status !== 'completed' || task.version !== request.expectedTaskVersion) {
      const code = task && task.version !== request.expectedTaskVersion ? 'stale_version' : 'acceptance_revocation_unavailable';
      throw new CoordinationRefusal('task acceptance revocation requires the exact completed task version', code);
    }
    const evidence = this._acceptanceRevocationEvidence(task, request.evidence.coordinationSeq);
    const targets = this._acceptanceRevocationTargets(task, evidence.coordinationSeq);
    const core = {
      schemaVersion: 1, requestDigest, taskId: request.taskId, expectedTaskVersion: request.expectedTaskVersion,
      newTaskVersion: request.expectedTaskVersion + 1, evidence, ...targets,
    };
    const payload = { ...core, receiptDigest: canonicalDigest(core) };
    const fixedTs = this._clock();
    const prospective = { schemaVersion: 1, seq: this._events.length + 1, ts: fixedTs, kind: 'task.acceptance_revoked', actor: auth.actor, idempotencyKey: auth.key, payload };
    this._validateAcceptanceRevocationPayload(payload, prospective, false);
    const event = this._append('task.acceptance_revoked', payload, auth, fixedTs);
    return freeze({
      ok: true, result: 'revoked', event: clone(event), task: this.task(request.taskId),
      artifacts: targets.artifactTargets.map((target) => this.artifact(target.artifactId)),
      knowledgeNodes: targets.knowledgeTargets.map((target) => clone(this._knowledgeNodes.get(target.nodeId))),
    });
  }

  mapOperationalEvent(operationalEvent, auth) { return coordinationLedger.mapOperationalEvent(this, operationalEvent, auth); }

  registerArtifact(fields, auth) { return coordinationLedger.registerArtifact(this, fields, auth); }

  _validateProvisionalResultRef(manifest, integrity = false) {
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

  _prepareArtifact(fields, terminalStatus) {
    const task = this._tasks.get(fields?.taskId);
    if (!task) throw new CoordinationRefusal(`unknown artifact task ${fields?.taskId}`, 'not_found');
    const manifest = clone(fields);
    if (Object.keys(manifest).some((field) => ARTIFACT_LIFECYCLE_FIELDS.has(field))) throw new CoordinationRefusal('artifact manifest uses lifecycle-owned fields', 'reserved_artifact_field');
    manifest.digest ??= digest({ taskId: manifest.taskId, kind: manifest.kind, refs: manifest.refs, provenance: manifest.provenance });
    manifest.id ??= `artifact:${manifest.digest}`;
    this._validateProvisionalResultRef(manifest, false);
    if (this._artifacts.has(manifest.id)) throw new CoordinationRefusal(`duplicate artifact ${manifest.id}`, 'duplicate_artifact');
    if (manifest.accepted === true && (!Array.isArray(manifest.provenance) || manifest.provenance.length === 0)) {
      throw new CoordinationRefusal('accepted artifact requires provenance', 'missing_provenance');
    }
    if (manifest.accepted === true) {
      if (terminalStatus !== 'completed') throw new CoordinationRefusal('accepted artifact requires a completed task', 'task_not_completed');
      const verified = manifest.provenance.some((ref) => {
        if (!Number.isInteger(ref?.coordinationSeq)) return false;
        const mapped = this._events[ref.coordinationSeq - 1];
        if (mapped?.kind !== 'evidence.mapped' || mapped.payload?.kind !== 'verify.reverified') return false;
        const source = this._operationalRead?.(mapped.payload.worker, mapped.payload.workerSeq);
        return source?.kind === 'verify.reverified' && source?.payload?.accept === true;
      });
      if (!verified) throw new CoordinationRefusal('accepted artifact requires accepted hub-verification provenance', 'unverified_provenance');
    }
    return manifest;
  }

  transitionTaskWithArtifacts(id, to, expectedVersion, fields, auth, evidence = null) { return coordinationLedger.transitionTaskWithArtifacts(this, id, to, expectedVersion, fields, auth, evidence); }
  artifact(id) {
    return coordinationInternals.artifact(this._artifacts, id);
  }

  reusePolicyState(repoId) { return coordinationLedger.reusePolicyState(this._reusePolicyHeads, repoId); }
  activateReusePolicy(fields, auth) { return coordinationLedger.activateReusePolicy(this, fields, auth); }

  providerReceipt(id) { return coordinationLedger.providerReceipt(this._providerReceipts, id); }
  providerProcessing(id) {
    return coordinationInternals.providerProcessing(this._providerProcessing, id);
  }
  providerSourceHealth(repoId, providerId, sourceEpoch) { return coordinationLedger.providerSourceHealth(this, repoId, providerId, sourceEpoch); }
  providerAttemptPolicy() { return coordinationLedger.providerAttemptPolicy(this._providerAttemptPolicy); }
  advisoryFeedCards() {
    return coordinationInternals.advisoryFeedCards(this._advisoryFeedCards);
  }
  pendingProviderReconciliation(repoId, coordinate) { return coordinationLedger.pendingProviderReconciliation(this, repoId, coordinate); }
  dueProviderProcessing(repoId, at) {
    return coordinationInternals.dueProviderProcessing(this, repoId, at);
  }

  recordProviderProcessingDeferral(fields, auth) { return coordinationLedger.recordProviderProcessingDeferral(this, fields, auth); }

  readProviderStatus(repoId, request, ceilings) { return coordinationLedger.readProviderStatus(this, repoId, request, ceilings); }

  recordProviderSourceReconciliation(fields, auth) { return coordinationLedger.recordProviderSourceReconciliation(this, fields, auth); }

  providerProcessingAdmission(key, requestDigest) {
    const prior = this._byKey.get(key); if (!prior) return null;
    if (!['provider.processing_checked', 'knowledge.reuse_provider_guarded'].includes(prior.kind) || prior.payload?.requestDigest !== requestDigest) throw new CoordinationRefusal('provider processing idempotency conflict', 'provider_processing_conflict');
    return freeze({ ok: true, result: 'idempotent', event: clone(prior), processing: this.providerProcessing(prior.payload.processingId) });
  }

  recordProviderGreenCompletion(fields, auth) { return coordinationLedger.recordProviderGreenCompletion(this, fields, auth); }

  recordProviderAdverseCompletion(fields, auth) { return coordinationLedger.recordProviderAdverseCompletion(this, fields, auth); }

  recordProviderDelivery(fields, auth) { return coordinationLedger.recordProviderDelivery(this, fields, auth); }
  reuseDecision(id) {
    return coordinationInternals.reuseDecision(this._reuseDecisions, id);
  }
  reuseSubjectHead(subjectDigest) {
    return coordinationInternals.reuseSubjectHead(this, subjectDigest);
  }
  currentReuseDecision(subjectDigest) { return coordinationLedger.currentReuseDecision(this, subjectDigest); }
  reuseRiskGuard(coordinate) {
    return coordinationInternals.reuseRiskGuard(this._reuseRiskGuards, coordinate);
  }
  reuseProviderGuard(repoId, coordinate) { return coordinationLedger.reuseProviderGuard(this, repoId, coordinate); }
  reuseAdverseState(repoId, coordinate) { return coordinationLedger.reuseAdverseState(this, repoId, coordinate); }
  reuseDecisionAdmission(key, requestDigest) {
    const prior = this._byKey.get(key); if (!prior) return null;
    if (!['knowledge.reuse_decided', 'reuse.decision_request_bound'].includes(prior.kind) || prior.payload?.requestDigest !== requestDigest) throw new CoordinationRefusal('reuse decision idempotency conflict', 'reuse_decision_conflict');
    const decision = this.reuseDecision(prior.payload.id ?? prior.payload.decisionId); const current = Boolean(decision && this.currentReuseDecision(decision.subjectDigest)?.id === decision.id); const historical = !current;
    return freeze({ ok: true, result: historical ? 'historical' : 'idempotent', current, historical, event: clone(prior), decision });
  }

  reuseRiskAdmission(key, requestDigest) {
    const prior = this._byKey.get(key); if (!prior) return null;
    if (prior.kind !== 'knowledge.reuse_risk_guarded' || prior.payload?.requestDigest !== requestDigest) throw new CoordinationRefusal('reuse risk idempotency conflict', 'reuse_risk_conflict');
    const p = prior.payload; const seed = this._reuseDecisions.get(p.seedDecisionId); const head = seed ? this._reusePolicyHeads.get(seed.envRef?.repoId) : null;
    const active = this._reuseRiskGuards.get(canonicalDigest(p.coordinate));
    const laterReview = this._events.slice(prior.seq).find((item) => item.kind === 'knowledge.reuse_risk_guarded' && canonicalDigest(item.payload?.coordinate) === canonicalDigest(p.coordinate));
    const inheritedEvent = !p.adverse ? [...this._events.slice(0, prior.seq - 1)].reverse().find((item) => item.kind === 'knowledge.reuse_risk_guarded' && item.payload?.adverse === true && canonicalDigest(item.payload.coordinate) === canonicalDigest(p.coordinate)) : null;
    const currentGuard = Boolean(active && active.guardDigest === p.guardDigest && active.policyHash === p.dossierSnapshot.policyHash && active.policyStale !== true && (!head || active.policyHash === head.policyHash));
    const currentGreenObservation = Boolean(!p.adverse && !inheritedEvent && !laterReview && (!head || p.dossierSnapshot.policyHash === head.policyHash)); const current = currentGuard || currentGreenObservation;
    let guard = current ? clone(active ?? null) : null;
    if (!guard && (p.adverse || inheritedEvent)) {
      guard = { coordinate: clone(p.coordinate), repoId: seed?.envRef?.repoId ?? null, blocked: true, dossierDigest: p.dossierRef.digest, factDigest: p.dossierSnapshot.factDigest, policyHash: p.dossierSnapshot.policyHash, recommendation: p.dossierSnapshot.recommendation, asOf: p.dossierSnapshot.asOf, expiresAt: p.dossierSnapshot.expiresAt, advisoryIds: clone(p.advisoryIds), maliciousAdvisoryIds: clone(p.maliciousAdvisoryIds), eventSeq: prior.seq, guardDigest: p.guardDigest, policyStale: Boolean(head && p.dossierSnapshot.policyHash !== head.policyHash), inheritedAdverse: !p.adverse,
        ...(!p.adverse && inheritedEvent ? { inheritedFromGuardDigest: inheritedEvent.payload.guardDigest, inheritedFactDigest: inheritedEvent.payload.dossierSnapshot.factDigest, inheritedPolicyHash: inheritedEvent.payload.dossierSnapshot.policyHash, inheritedAdvisoryIds: clone(inheritedEvent.payload.advisoryIds), inheritedMaliciousAdvisoryIds: clone(inheritedEvent.payload.maliciousAdvisoryIds), inheritedEventSeq: inheritedEvent.seq } : {}) };
    }
    return freeze({ ok: true, result: current ? 'idempotent' : 'historical', current, historical: !current, event: clone(prior), guard: clone(guard), targets: clone(p.targets) });
  }

  recordReuseRiskGuard(fields, auth) { return coordinationLedger.recordReuseRiskGuard(this, fields, auth); }

  reuseTtlAdmission(key, requestDigest) {
    const prior = this._byKey.get(key); if (!prior) return null;
    if (prior.kind !== 'knowledge.reuse_ttl_invalidated' || prior.payload?.requestDigest !== requestDigest) throw new CoordinationRefusal('reuse TTL idempotency conflict', 'reuse_ttl_conflict');
    return freeze({ ok: true, result: 'idempotent', event: clone(prior), decision: this.reuseDecision(prior.payload.decisionId) });
  }

  recordReuseTtlInvalidation(fields, auth) { return coordinationLedger.recordReuseTtlInvalidation(this, fields, auth); }

  recordReuseDecision(fields, auth) { return coordinationLedger.recordReuseDecision(this, fields, auth); }

  supersedeArtifact(oldId, newId, expectedVersion, auth) { return coordinationLedger.supersedeArtifact(this, oldId, newId, expectedVersion, auth); }
  admitRecoveryAttempt(fields, auth) {
    return coordinationReplay.admitRecoveryAttempt(this, fields, auth);
  }
  completeRecoveryAttempt(fields, auth) {
    return coordinationReplay.completeRecoveryAttempt(this, fields, auth);
  }
  recoveryAttempt(attemptId) {
    return coordinationReplay.recoveryAttempt(this, attemptId);
  }
  recoveryAttemptHead(seriesId) {
    return coordinationReplay.recoveryAttemptHead(this, seriesId);
  }
  pendingRecoveryAttempts(limit = 1_000) {
    return coordinationReplay.pendingRecoveryAttempts(this, limit);
  }

  recordDriver(kind, payload, auth) { return coordinationLedger.recordDriver(this, kind, payload, auth); }

  /** Issue #10 D5 Arm 1: the durable ceiling-deferral receipt. Minted at the coordinator's
   * `_dispatchPass` concurrencyCeiling skip, once per task dispatch — idempotency-keyed
   * (`task.dispatch_deferred:<taskId>:<taskCreatedSeq>`), so re-skips never re-mint. The payload
   * is MINT-TIME data (inFlight is frozen, never live queue depth). */
  deferTaskDispatch(fields, auth) { return coordinationLedger.deferTaskDispatch(this, fields, auth); }

  /** Authority refusals are their own durable event kind (never a driver.recorded wrapper), so
   * the coordinator's typed refusal surfaces on the store ledger as `authority.rejected` — the
   * seam's coaching payload rides the event payload directly (Decision 5). */
  recordAuthorityRejected(payload, auth) { return coordinationLedger.recordAuthorityRejected(this, payload, auth); }

  // -------------------------------------------------------------------------
  // BD3-B context packs — a server-owned supersession chain per family. A pack is minted with
  // a family (= type), a bounded body, a validity deadline, and an optional predecessor that
  // MUST be the current live head (a stale predecessor refuses context_pack_stale). The store
  // maintains the head per family; superseded versions stay resolvable as content history.
  // Expiry is distinct from supersession: an expired pack refuses materialization with
  // context_pack_expired without ever being superseded.
  // -------------------------------------------------------------------------
  _prepareContextPackPayload(fields) {
    return coordinationInternals._prepareContextPackPayload(this, fields);
  }

  mintContextPack(fields, auth) { return coordinationLedger.mintContextPack(this, fields, auth); }
  contextPack(packId) {
    return coordinationInternals.contextPack(this._contextPacks, packId);
  }
  contextPackHead(family) {
    return coordinationInternals.contextPackHead(this, family);
  }

  materializeContextPack(packId) {
    const pack = this._contextPacks.get(packId);
    if (!pack) throw new CoordinationRefusal('context pack was not found', 'context_pack_not_found');
    if (Date.parse(this._clock()) >= Date.parse(pack.validity)) {
      throw new CoordinationRefusal('context pack has expired', 'context_pack_expired');
    }
    return freeze({ packId: pack.packId, family: pack.family, body: pack.body });
  }

  // -------------------------------------------------------------------------
  // D9 (epic #103) — the wave.closed campaign-state record. A wave driver appends exactly one
  // closed-shape record per wave in the guaranteed post-close window; the replay fold derives a
  // _waveClosures map by waveId. The record is advisory (non-gating) and clock-free: its own event
  // seq is the epoch anchor for closedAtEventSeq (G10).
  // -------------------------------------------------------------------------

  _validateWaveClosedPayload(fields) {
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

  appendWaveClosed(fields, auth) { return coordinationLedger.appendWaveClosed(this, fields, auth); }

  /** #161 (D2/P6): the at-wave-close plan elevation, folded from the closure itself. Completed
   * tasks keep done and gain DURABLE elevation evidence links (plan.task_evidence_linked on this
   * ledger, never a hand-edited projection field); a doing task reverts to todo for the next wave
   * (the honest remainder) through the registered plan_auto_demote batch. No silent
   * auto-promotion: an unreviewed or incomplete task never reads done. The reviewed-reject
   * re-open (done -> todo, H4.2) stays the surfaced review-authority write — the hook never
   * re-opens. Replay re-folds the appended events; this hook runs at admission only. */
  _planElevationAtWaveClose(waveId, auth, closedEventSeq) { return coordinationLedger._planElevationAtWaveClose(this, waveId, auth, closedEventSeq); }
  waveClosure(waveId) {
    return coordinationInternals.waveClosure(this._waveClosures, waveId);
  }
  /** #286 G-31: the CURRENT run -> wave binding (last write wins), the one reading of "which wave
   * does this run sit in now" that the coordinator's `_waveIdOf`/`_waveRoleOf` share. */
  waveBinding(runId) {
    return coordinationInternals.waveBinding(this._waveBindings, runId);
  }
  waveClosures() {
    return coordinationInternals.waveClosures(this._waveClosures);
  }

  // D2.3 (epic #132): the wave registry projection read — the open+closed rows of the
  // replay-derived _waveRegistry map, cloned so a reader never mutates the projection.
  waveRegistry() {
    return coordinationInternals.waveRegistry(this._waveRegistry);
  }

  /** Issue #465(2): the ONE reader of a spill row — the digest-addressed identity the fold kept
   * (spillId, digest, `bytes` — the body's exact length — lane, the observed seqs) with the body
   * resolved from the `spill.minted` ledger row the row references. Every caller that used to
   * receive the row with the body inline (`mintSpill`, `materializeSpill`) receives exactly that,
   * composed in one place; a reference that cannot be read answers null, never the text of another
   * spill. */
  _resolvedSpill(spillId) {
    const spill = this._spills.get(spillId);
    if (spill === undefined) return null;
    // The row's own shape, exactly — the pair is the projection's bookkeeping and the body is what
    // every caller of this reader asked for (`mintSpill`'s receipt, `materializeSpill`'s answer).
    const { bodyRef, ...rest } = spill;
    return { ...clone(rest), body: bodyRef === undefined ? spill.body ?? null : this._projectionReferenceValue(bodyRef) };
  }

  // #161: the plan-object projection reads — cloned snapshots so a reader never mutates the
  // replay-derived _campaignPlans map (folds apply events; they never authorize, H2.3).
  /** Validate against current state before appending: rejected edits must never poison replay. */
  recordSwarm(kind, payload, auth) { return coordinationLedger.recordSwarm(this, kind, payload, auth); }
  swarm(swarmId) {
    return coordinationInternals.swarm(this._swarms, swarmId);
  }
  swarms() {
    return coordinationInternals.swarms(this._swarms);
  }

  // Membership changes do not change the native session's turn protocol. Once recruited as
  // a continuing participant, a Run remains pausable even after leaving or closing its group.
  hasSwarmParticipantRun(runId) {
    if (!runId) return false;
    return [...this._swarms.values()].some((swarm) => Object.values(swarm.participants)
      .some((participant) => participant.runId === runId));
  }
  campaignPlans() {
    return coordinationInternals.campaignPlans(this._campaignPlans);
  }
  campaignPlan(planId) {
    return coordinationInternals.campaignPlan(this._campaignPlans, planId);
  }

  // #161 (G4/H1.1): the idempotency-keyed prior event for a plan mutation key — the write lane's
  // replay adjudication (exactly-once retries) without exposing the raw _byKey index.
  priorCoordinationEvent(key) {
    return coordinationInternals.priorCoordinationEvent(this._byKey, key);
  }

  // #161 (H2.2): the wave-role roster run resolution — ownedBy.run (null, pre-decomposed) resolves
  // from the steering.registered fold at claim time.
  waveRoleRun(waveId, waveRole) {
    return coordinationInternals.waveRoleRun(this._waveRoleRuns, waveId, waveRole);
  }

  ledgerHeadSeq() { return coordinationLedger.ledgerHeadSeq(this._events); }

  // -------------------------------------------------------------------------
  // Epic #103 — the orchestrator-briefing composition (D1/D8). Composition reads ONLY store
  // projections the orchestrator lane owns: the wave.closed campaign-state records (D9) and the
  // live snapshot(); the standing-law list is the ONE named non-ledger input (D8/OQ2, pinned
  // deployment config). Unknown fields refuse by name (F15); degradation runs the pinned order
  // until the body fits or briefing_pack_overflow with the drop ledger.
  // -------------------------------------------------------------------------
  composeBriefingPack(rawInput) {
    return coordinationInternals.composeBriefingPack(rawInput);
  }

  composeCampaignBriefing(standingLaws = []) {
    const closures = this.waveClosures();
    const latest = closures.length > 0 ? closures[closures.length - 1] : null;
    const lawListDigest = canonicalDigest(standingLaws);
    return this.composeBriefingPack({
      schemaVersion: 1, family: BRIEFING_FAMILY,
      composedAtEventSeq: this._events.length + 1,
      rings: latest?.rings ?? [], lanes: latest?.lanes ?? [],
      landings: closures.map((record) => ({
        waveId: record.waveId, closedAtEventSeq: record.closedAtEventSeq,
        gates: {
          admitted: record.knowledge?.admittedThisRun ?? 0,
          refused: record.settlementErrors?.length ?? 0,
          candidatesAwaitingAdmission: record.knowledge?.candidatesAwaitingAdmission ?? 0,
        },
        receiptDigest: record.receiptDigest,
      })),
      parked: latest?.parked ?? [], blockedOn: latest?.blockedOn ?? [],
      standingLaws, sources: { snapshotDigest: canonicalDigest(this.snapshot()), lawListDigest },
    });
  }

  backfillBriefingPack({ family }, auth) { return coordinationLedger.backfillBriefingPack(this, { family }, auth); }

  // -------------------------------------------------------------------------
  // Decision 4 — the spill lane. Digest-addressed durable artifacts (spill:sha256:<digest>),
  // content-addressed and idempotent by auth key, with a 1 MiB ceiling (spill.body, blocker 3).
  // Spill lives exactly as long as its referencing receipt; reaping is Open question 1 (deferred,
  // safe under the ceiling).
  // -------------------------------------------------------------------------

  mintSpill(fields, auth) { return coordinationLedger.mintSpill(this, fields, auth); }

  materializeSpill(spillId) {
    const spill = this._resolvedSpill(spillId);
    return spill === null
      ? null
      : { spillId: spill.spillId, digest: spill.digest, bytes: spill.bytes, body: spill.body };
  }

  /** Epic #81 (O-6): append an attempt-scoped context.pack_granted receipt, atomically with the
   * spawn binding and BEFORE provider dispatch. Idempotent by the caller key (the coordinator
   * derives task+pack-scoped keys so a retried spawn of the same attempt never mints a second
   * grant, while two attempts citing the same head hold two grants — authority never collapses). */
  grantContextPack(fields, auth) {
    const event = this._append('context.pack_granted', clone(fields), auth);
    return { ok: true, result: 'granted', event: clone(event) };
  }
  reapExpiredContextPacks(repoId) {
    return coordinationReplay.reapExpiredContextPacks(this, repoId);
  }

  /** BD3-A: the read-lane audit class — bounded, content-digested, and deliberately NOT the
   * scratch.read family (zero promotion weight; minScratchReaders never counts these). */
  recordContextRead(fields, auth) { return coordinationLedger.recordContextRead(this, fields, auth); }

  /** Epic #81 (O-2): per-attempt constructive receipt ceilings — count AND byte bounds checked
   * BEFORE append. No clock (campaign law); the bound is the constructive flood control. */
  _assertOrientationReceiptCeiling(payload) {
    if (!this._orientationReceiptCeilings) return;
    const ceilings = this._orientationReceiptCeilings;
    // #367: the per-attempt counter fold (built in the context.read arm of _apply) answers the
    // count and cumulative-byte bounds in O(1) — the one canonicalBytes call below is for the
    // INCOMING row; prior receipts are never re-scanned or re-serialized here.
    const counter = this._contextReadAttemptCounters.get(contextReadAttemptKey(payload));
    if ((counter?.count ?? 0) >= ceilings.maxReceiptsPerAttempt) {
      throw new CoordinationRefusal('orientation receipt count ceiling exceeded', 'orientation_receipt_ceiling');
    }
    if ((counter?.bytes ?? 0) + canonicalBytes(payload) > ceilings.maxReceiptBytesPerAttempt) {
      throw new CoordinationRefusal('orientation receipt byte ceiling exceeded', 'orientation_receipt_ceiling');
    }
  }

  /** Epic #81 (O-4): a hub-derived KG Source node per orientation module coordinate — the anchor
   * curated-overlay leaves Cite. Source is a closed KG node type; the coordinate is the overlay's
   * citation identity (match/omit decisions ride moduleDigest + freshnessDigest). */
  mintOrientationSource(fields, auth) { return coordinationLedger.mintOrientationSource(this, fields, auth); }

  /** Epic #81 (O-2/O-4): orientation.candidate.propose. The candidate is hub-minted observed
   * (callers supply only {packDigest, leafDigest}); it verifies the proposing attempt previously
   * received the orientation surface (a context.read receipt or an operator Source), coalesces
   * duplicates by {leafDigest, freshnessDigest}, and is bounded by the per-attempt proposal
   * ceiling. Never caller-authored body/grounding/scope. */
  proposeOrientationCandidate({ leafDigest, packDigest }, auth) {
    if (!/^[a-f0-9]{64}$/.test(leafDigest ?? '') || !/^[a-f0-9]{64}$/.test(packDigest ?? '')) {
      throw new CoordinationRefusal('orientation candidate leaf is invalid', 'orientation_propose_refused');
    }
    const workerId = typeof auth?.actor === 'string' && auth.actor.startsWith('worker:') ? auth.actor.slice('worker:'.length) : null;
    const source = this._orientationLatestSource();
    // #286 G-45: one fold lookup replaces the per-proposal ledger scan (at least one receipt for
    // this worker is exactly "the latest-receipt fold has this worker").
    const hasReceipt = this._orientationWorkerFreshness(workerId) !== null;
    if (!source && !hasReceipt) throw new CoordinationRefusal('orientation candidate was not received by the attempt', 'orientation_propose_refused');
    const freshnessDigest = source?.freshnessDigest ?? this._orientationWorkerFreshness(workerId) ?? '0'.repeat(64);
    const existing = this._orientationCandidate(leafDigest, freshnessDigest);
    if (existing) return { ok: true, result: 'idempotent', node: clone(existing) };
    this._assertOrientationProposalCeiling(workerId);
    const candidateId = `orientation:candidate:${canonicalDigest({ freshnessDigest, leafDigest })}`;
    const result = this.addKnowledgeNode({
      body: `orientation overlay candidate leaf ${leafDigest.slice(0, 12)}`, evidence: [],
      freshnessDigest, grounding: 'observed', id: candidateId, leafDigest, packDigest,
      promotion: { kind: 'Finding', trigger: 'orientation.overlay_proposed' }, type: 'Finding', workerId,
    }, auth);
    if (source) {
      try { this.addKnowledgeEdge({ evidence: [], from: candidateId, id: `knowledge-edge:cites:${candidateId}`, to: source.id, type: 'Cites' }, { actor: auth.actor, key: `${auth.key}:cites` }); }
      catch { /* the Cites edge is best-effort over the observed candidate */ }
    }
    return { ok: true, result: 'minted', node: clone(result.node) };
  }

  /** Epic #81 (O-4): merge generated module structure with the curated overlay. A curated leaf
   * applies only on EXACT moduleDigest + freshnessDigest match; a stale leaf is omitted WITH
   * structured trace (overlay_dangling) and the generated map serves partial; conflicting live
   * leaves without a Supersedes winner all omit with overlay_conflict (never event-time/insertion
   * order). Generated structure always answers for the requested coordinate. */
  mergeOrientationMap({ moduleDigest, moduleKey, freshnessDigest, repoId: repoIdArg } = {}) { return coordinationLedger.mergeOrientationMap(this, { moduleDigest, moduleKey, freshnessDigest, repoId: repoIdArg }); }

  /** Epic #81 (O-7): the closed rating event. The hub mints orientation.rating_recorded with the
   * attempt identity (hub-derived — the worker is verified against the task record, never trusted
   * from transport) and a prior grant/read proof. One rating per task attempt: exact replay
   * returns the prior event, an opposite same-pack rating refuses orientation_rating_conflict,
   * and a second pack under the same attempt refuses the constant orientation_rating_refused. */
  recordOrientationRating({ packDigest, rating }, auth) { return coordinationLedger.recordOrientationRating(this, { packDigest, rating }, auth); }

  _orientationLatestSource() {
    const sources = this.queryKnowledge({ types: ['Source'] }).sort((a, b) => (b.observedSeq ?? 0) - (a.observedSeq ?? 0));
    return sources[0] ?? null;
  }

  /** #286 G-45: the LATEST `context.read` receipt for one worker — the freshness digest and
   * citation seq the orientation lane reads — as a fold lookup, never a ledger scan. */
  orientationReadLatest(workerId) {
    return coordinationInternals.orientationReadLatest(this._contextReadLatest, workerId);
  }

  _orientationWorkerFreshness(workerId) {
    return this.orientationReadLatest(workerId)?.freshnessDigest ?? null;
  }

  /** #286 G-45: the FIRST `context.read` receipt for one (worker, pack) — the receipt an
   * orientation rating cites — as a fold lookup, never a ledger scan. */
  orientationReadHead(workerId, packDigest) {
    return coordinationInternals.orientationReadHead(this._contextReadHeads, workerId, packDigest);
  }

  _orientationCandidate(leafDigest, freshnessDigest) {
    return this.queryKnowledge({ types: ['Finding'] }).find((node) => node.promotion?.trigger === 'orientation.overlay_proposed'
      && node.leafDigest === leafDigest && node.freshnessDigest === freshnessDigest) ?? null;
  }

  _assertOrientationProposalCeiling(workerId) {
    if (!this._orientationReceiptCeilings) return;
    const proposals = this.queryKnowledge({ types: ['Finding'] }).filter((node) => node.promotion?.trigger === 'orientation.overlay_proposed'
      && (workerId === null || node.workerId === workerId));
    if (proposals.length >= this._orientationReceiptCeilings.maxProposalsPerAttempt) {
      throw new CoordinationRefusal('orientation proposal ceiling exceeded', 'orientation_receipt_ceiling');
    }
  }

  /** BD3-C: append-only lane audit receipts (message.sent / message.delivered). The delivery
   * state machine (delivered/read/actedOn/reply) is process-scoped coordinator state. */
  recordMessage(kind, fields, auth) { return coordinationLedger.recordMessage(this, kind, fields, auth); }
  recordRecoveryContinuationIntent(fields, auth) {
    return coordinationReplay.recordRecoveryContinuationIntent(this, fields, auth);
  }
  completeRecoveryDispatch(fields, auth) {
    return coordinationReplay.completeRecoveryDispatch(this, fields, auth);
  }
  integrationAuthority(taskId, operationalEvent) {
    return coordinationInternals.integrationAuthority(this, taskId, operationalEvent);
  }

  completeIntegration(fields, auth) { return coordinationLedger.completeIntegration(this, fields, auth); }

  /** Verify the complete post-effect publication authority tuple during replay. Merely finding a
   * promoted decision is insufficient: the mapped operational digest, paired driver record,
   * adjacency, batch-key lineage, task, evidence, and publication payload must all agree. */
  publicationAuthority(taskId, operationalEvent) {
    return coordinationInternals.publicationAuthority(this, taskId, operationalEvent);
  }

  /** Atomically make a post-effect publication authoritative. The operational completion may
   * already exist because the publisher is an outside effect; neither the graph decision nor the
   * driver completion is visible unless both append in one fs write. */
  completePublication(fields, auth) { return coordinationLedger.completePublication(this, fields, auth); }

  postScratchFact(fields, auth) { return coordinationLedger.postScratchFact(this, fields, auth); }

  /** Bind an oracle Brief to the exact durable Scratch assertion without asking a caller to
   * echo or nominate any source fields. The private snapshot is returned only to Coordinator. */
  scratchFactOracleTarget(id, repoId, maxTargetBytes) {
    return coordinationInternals.scratchFactOracleTarget(this, id, repoId, maxTargetBytes);
  }

  expireScratchFact(id, auth) { return coordinationLedger.expireScratchFact(this, id, auth); }

  claimScratch(fields, auth) { return coordinationLedger.claimScratch(this, fields, auth); }

  expireScratchClaim(id, expectedVersion, auth) { return coordinationLedger.expireScratchClaim(this, id, expectedVersion, auth); }

  activeScratchClaims({ workerId = null, taskId = null } = {}) { return coordinationLedger.activeScratchClaims(this._scratchClaims, { workerId, taskId }); }

  checkScratch(resource, envRef) {
    if (!validEnvRef(envRef)) throw new CoordinationRefusal('scratch check requires immutable repoId/treeSha envRef', 'invalid_env_ref');
    const claims = [...this._scratchClaims.values()].filter((claim) => claim.active && claim.envRef.repoId === envRef.repoId && resourceOverlap(claim.resource, resource)).map((claim) => ({
      ...clone(claim), warning: claim.envRef.treeSha === envRef.treeSha ? null : `observed on ${claim.envRef.treeSha} — not your tree`,
    }));
    const facts = [...this._scratchFacts.values()].filter((fact) => fact.active && fact.envRef.repoId === envRef.repoId && (fact.key === resource || fact.resource === resource)).map((fact) => ({
      ...clone(fact), warning: fact.envRef.treeSha === envRef.treeSha ? null : `observed on ${fact.envRef.treeSha} — not your tree`,
    }));
    return freeze({ clear: claims.length === 0, claims, facts });
  }

  readScratch(resource, envRef, reader, auth) { return coordinationLedger.readScratch(this, resource, envRef, reader, auth); }

  // -------------------------------------------------------------------------
  // Issue #33 scratchpad — typed worker writes, pure scoped reads, and the two
  // settlement boundaries. All projection mutation remains in _apply above.
  // -------------------------------------------------------------------------
  scratchpadFence(runId, scope) {
    return coordinationInternals.scratchpadFence(this._scratchpadFences, runId, scope);
  }
  scratchpadSnapshotBatch(runId, scopes, options = {}) {
    return coordinationInternals.scratchpadSnapshotBatch(this, runId, scopes, options);
  }

  scratchpadSnapshot(runId, scope, options = {}) { return coordinationLedger.scratchpadSnapshot(this, runId, scope, options); }
  _scratchpadResolveForWorker(runId, workerId, entryId, entryDigest, requirement = {}) {
    return coordinationInternals._scratchpadResolveForWorker(this._scratchpadEntries, runId, workerId, entryId, entryDigest, requirement);
  }

  writeScratchpad(fields, auth) { return coordinationLedger.writeScratchpad(this, fields, auth); }

  // Issue #158 — the surface append verb's write (the unlanded tight-cell D-depth-2 direct
  // shared-tier write, G8). The entry's scope is EXPLICIT — `shared` or a member partition —
  // while the author identity is server-bound to auth.principalId (H1.3), never a caller field
  // (D2.1 excludes workerId). The D1 scope law is enforced at the surface authorize seam; this
  // fold only enforces the closed envelope, the declared partition caps (D3: 128 worker / 512
  // shared), and the _byKey replay binding {kind, actor, runId, taskId, workerId, contentDigest}
  // with NO scope term (P-A4 — the surface disambiguates the two-scope verb's keys by namespacing
  // every key by scope, H3.1). Absent caller keys derive run.scratchpad.append:<runId>:<scope>:
  // <contentDigest> (OQ2) so the surface need not compute the kernel's content digest. A written
  // append is workflow-ephemeral (law 4): it never mints a scratch-fact / KG candidacy.
  appendScratchpad(fields, auth) { return coordinationLedger.appendScratchpad(this, fields, auth); }
  _scratchpadReapReceipt(prior, result = 'idempotent') {
    return coordinationReplay._scratchpadReapReceipt(this, prior, result);
  }

  elevateTaskScratchpad(fields, auth) { return coordinationLedger.elevateTaskScratchpad(this, fields, auth); }

  settleWorkflowScratchpad(fields, auth) { return coordinationLedger.settleWorkflowScratchpad(this, fields, auth); }
  /** #286 G-41: `deadlineAt` is the caller's own recorded stop deadline; without one the pass reaps
   * every partition of the stopping run (there is no partition-count ceiling any more). */
  reapRunScratchpads(runId, opts = {}) {
    return coordinationReplay.reapRunScratchpads(this, runId, opts);
  }

  // -------------------------------------------------------------------------
  // REFLEX-2 boards (issue #17, docs/32 §3.2). Immutable versioned items with
  // successor versions and claim migration keyed to itemId (F8); a board-scoped,
  // replay-derivable fence — NEVER the worker FenceTable (F9); non-evented reads
  // (no board.read event kind; a poll never appends to the ledger — F10).
  // -------------------------------------------------------------------------

  /** The board fence: the count of admitted orchestrator-authority events for the board,
   * derived purely by re-counting in _apply. Replay reconstructs it exactly. */
  boardFence(board) {
    return coordinationInternals.boardFence(this._boardFences, board);
  }

  /** KG-1 Part A rule 5 (P1-1 fix): store-level, global, replay-derived counter incremented once
   * per applied event of a kind that can change a task/workflow projection's output without
   * already being counted by boardFence's five orchestrator-authority transitions. */
  projectionInputFence() { return coordinationLedger.projectionInputFence(this._projectionInputFence); }

  /** KG-1 Part A rule 4: the project horizon fence — the store's own applied-event position,
   * already a strict superset of every other fence component. */
  eventFence() {
    return coordinationInternals.eventFence(this._events);
  }

  _boardAdmissionFailure(message, code) {
    throw new CoordinationRefusal(message, code);
  }

  /** S-2 v2's single serialized authority entry for transported/facade board commands.
   * Shape is closed before any state lookup. The caller supplies the session proof; identity is
   * recovered only from the matching lease. The final fence/parent compare is repeated by the
   * append's before-write gate, so no adapter-side check-then-write window exists. */
  admitBoardCommand(envelope) {
    const fail = (message, code = 'board_admission_invalid') => this._boardAdmissionFailure(message, code);
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
    const lease = this._runOrchestratorLeases.get(proof.orchestratorLeaseId);
    if (!lease || lease.status !== 'active' || Date.parse(this._clock()) >= Date.parse(lease.expiresAt)) {
      fail('an active board lease is required', 'board_lease_required');
    }
    if (proof.authorityDigest !== lease.session.authorityDigest
      || proof.expiresAt !== lease.session.expiresAt) {
      fail('board session authority does not match its lease', 'board_session_mismatch');
    }
    const parent = this._tasks.get(lease.parent.taskId);
    if (!parent || parent.version !== lease.parent.taskVersion
      || parent.assignee !== lease.parent.workerId || parent.status !== 'working') {
      fail('an active board lease is required', 'board_lease_required');
    }
    if (lease.parent.runId !== envelope.runId) {
      fail('board command Run does not match its lease', 'board_session_mismatch');
    }
    const binding = this._boardRunBindings.get(envelope.board) ?? null;
    if (binding && binding.runId !== envelope.runId) {
      fail('board is bound to a different Run', 'board_session_mismatch');
    }
    if (this._runStopByTarget.has(envelope.runId) || this._runStops.has(envelope.runId)
      || this._runs.get(envelope.runId)?.status === 'sealed') {
      fail('board Run is closed', 'board_run_closed');
    }

    let item = null;
    if (!['post', 'read'].includes(kind)) {
      item = this._boardItems.get(envelope.item.itemId) ?? null;
      if (!item || item.board !== envelope.board) fail('board item was not found', 'board_item_not_found');
    }

    const normalized = freeze(clone(envelope));
    const requestDigest = canonicalDigest(normalized);
    const prior = this._byKey.get(envelope.idempotencyKey) ?? null;
    const priorDigest = prior?.payload?.boardAdmission?.requestDigest ?? null;

    const gate = () => {
      if (this.boardFence(envelope.board) !== envelope.expectedBoardFence) {
        fail('board fence is stale', 'stale_board_fence');
      }
      if (item) {
        const current = this._boardItems.get(item.itemId);
        if (current?.itemVersion !== envelope.item.itemVersion) {
          fail('board item parent is stale', 'board_parent_stale');
        }
        if (current?.state !== 'open') fail('board item is not open', 'board_parent_stale');
      }
    };

    // Reads are non-evented but pass through the identical proof/run/binding posture.
    if (kind === 'read') {
      return freeze({ ok: true, result: 'read', snapshot: this.boardSnapshot(envelope.board) });
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
      const replayItem = this._boardItems.get(prior.payload.itemId) ?? null;
      return freeze({
        ok: true, result: 'idempotent', event: clone(prior), item: clone(replayItem),
        boardRunBinding: {
          runId: envelope.runId, result: prior.payload.boardAdmission?.adopted ? 'adopted' : 'bound',
        },
      });
    }

    const adopting = !binding && (this._boardItemsByBoard.get(envelope.board)?.length ?? 0) > 0;
    const boardAdmission = freeze({
      schemaVersion: 1, runId: envelope.runId, requestDigest, adopted: adopting,
      leaseId: lease.leaseId, expectedBoardFence: envelope.expectedBoardFence,
      itemVersion: envelope.item?.itemVersion ?? null,
    });
    const auth = { actor: lease.session.principalId, key: envelope.idempotencyKey };
    const appendGate = () => {
      // Test-only instrumentation shares the actual before-write callback. A mutation injected
      // here changes the replay-derived fence before the compare below and therefore loses CAS.
      if (typeof this._boardAdmissionInterleave === 'function') this._boardAdmissionInterleave();
      gate();
    };
    let receipt;
    if (kind === 'post') {
      receipt = this.postBoardItem({
        board: envelope.board, title: mutation.title, detail: mutation.detail,
        owner: mutation.owner, evidence: mutation.evidence,
      }, auth, appendGate, boardAdmission);
    } else if (kind === 'retitle') {
      receipt = this.retitleBoardItem(item.itemId, {
        title: mutation.title, detail: mutation.detail,
      }, auth, appendGate, boardAdmission);
    } else if (kind === 'reorder') {
      receipt = this.reorderBoardItem(item.itemId, mutation.ordinal, auth, appendGate, boardAdmission);
    } else if (kind === 'close') {
      receipt = this.closeBoardItem(item.itemId, auth, appendGate, boardAdmission);
    } else {
      receipt = this.dropBoardItem(item.itemId, auth, appendGate, boardAdmission);
    }
    return freeze({
      ...receipt,
      boardRunBinding: { runId: envelope.runId, result: adopting ? 'adopted' : 'bound' },
    });
  }

  postBoardItem(fields, auth, appendGate = null, boardAdmission = null) { return coordinationLedger.postBoardItem(this, fields, auth, appendGate, boardAdmission); }

  /** A successor version under the SAME itemId (immutable prior version retained). If a granted
   * claim exists, a benign edit (retitle/reorder) carries it forward via board.claim_migrated —
   * the worker is never forced to re-claim (F8, rule 3). */
  _boardSuccessor(itemId, kind, changes, auth, appendGate = null, boardAdmission = null) { return coordinationLedger._boardSuccessor(this, itemId, kind, changes, auth, appendGate, boardAdmission); }

  retitleBoardItem(itemId, fields, auth, appendGate = null, boardAdmission = null) { return coordinationLedger.retitleBoardItem(this, itemId, fields, auth, appendGate, boardAdmission); }

  reorderBoardItem(itemId, ordinal, auth, appendGate = null, boardAdmission = null) { return coordinationLedger.reorderBoardItem(this, itemId, ordinal, auth, appendGate, boardAdmission); }

  closeBoardItem(itemId, auth, appendGate = null, boardAdmission = null) { return coordinationLedger.closeBoardItem(this, itemId, auth, appendGate, boardAdmission); }

  dropBoardItem(itemId, auth, appendGate = null, boardAdmission = null) { return coordinationLedger.dropBoardItem(this, itemId, auth, appendGate, boardAdmission); }

  /** First claim wins, exactly-once, only if expectedBoardFence === boardFence(board) at apply
   * time (F9, rule 8); else stale_board_fence (rejected, cheap re-read). Never the worker fence.
   * Epic #78 Decision 6 rule 3: prior-key lookups digest-adjudicate — changed content under one
   * key refuses board_replay_conflict, never a blind return of the old success. `beforeWrite`
   * (the seam's in-append gate, Decision 3 step 7) re-checks the fence/item/open/claim state
   * inside the append window. */
  requestBoardClaim(fields, auth, beforeWrite = null) { return coordinationLedger.requestBoardClaim(this, fields, auth, beforeWrite); }

  /** A report binds the EXACT (itemVersion, itemDigest) the worker observed; a later retitle can
   * never silently re-point its evidence (F8, rule 3). Epic #78 Decision 6 rule 3: prior-key
   * lookups digest-adjudicate (changed content/op under one key refuses board_replay_conflict).
   * The envelope coordinates (claimVersion, ownerTask, grantDigest) are derived from the active
   * claim — authority, not content, so they are excluded from the request digest. `beforeWrite`
   * (the seam's in-append gate, Decision 3 step 7) re-checks the item-open/claim-owner/version
   * state inside the append window. */
  submitBoardReport(fields, auth, beforeWrite = null) { return coordinationLedger.submitBoardReport(this, fields, auth, beforeWrite); }

  /** Version-CAS expiry mirroring expireScratchClaim; returns the item to claimable (never a
   * phantom done). Does not bump the board fence (F9, rule 7). Epic #78 Decision 6 rule 3:
   * prior-key lookups digest-adjudicate — changed expiry content under one key refuses
   * board_replay_conflict, never a stale success. */
  expireBoardClaim(itemId, expectedVersion, auth) { return coordinationLedger.expireBoardClaim(this, itemId, expectedVersion, auth); }

  activeBoardClaims({ workerId = null, taskId = null } = {}) { return coordinationLedger.activeBoardClaims(this._boardClaims, { workerId, taskId }); }
  boardItem(itemId) {
    return coordinationInternals.boardItem(this._boardItems, itemId);
  }
  boardItemVersions(itemId) {
    return coordinationInternals.boardItemVersions(this._boardItemHistory, itemId);
  }

  /** Non-evented board read (F10, rule 9): a poll appends nothing to the ledger and drives the
   * per-board indexed item map, never a full claim/fact scan. */
  boardSnapshot(board) { return coordinationLedger.boardSnapshot(this, board); }

  // -------------------------------------------------------------------------
  // Epic #78 (board worker-half) — worker grants, the worker admission seam, and
  // the grant-scoped L1 read lane (Decisions 2/3/5). All state derives from
  // board.grant_minted / board.grant_revoked / worker.generation_bound events.
  // -------------------------------------------------------------------------
  boardGrant(grantId) {
    return coordinationInternals.boardGrant(this._boardGrants, grantId);
  }

  activeBoardGrants({ workerId = null, taskId = null } = {}) { return coordinationLedger.activeBoardGrants(this._boardGrants, { workerId, taskId }); }
  workerGeneration(workerId) {
    return coordinationInternals.workerGeneration(this._workerGenerations, workerId);
  }

  /** A2-3: the durable per-worker generation record. processGeneration is currently only an
   * in-memory worker-handle property; without this event replay cannot derive which grants a
   * replacement generation invalidates. Appended at worker (re)attachment/spawn. */
  recordWorkerGeneration(fields, auth) { return coordinationLedger.recordWorkerGeneration(this, fields, auth); }

  /** #201 A3: the successor-incarnation orphan scan — tasks claimed by workers whose durable
   * generation is absent from the caller's live-worker set (or parked retry_pending) surface
   * as reclaimable. Pure read over the replayed ledger: a task with an assignee whose LAST
   * worker.generation_bound names a generation the caller did not present is an orphan; a task
   * claimed by a live worker, unclaimed, or terminal never surfaces. */
  orphans({ liveWorkers = [] } = {}) {
    return coordinationReplay.orphans(this, { liveWorkers });
  }

  /** Decision 2: the durable grant revoke. Every terminator (member task terminalization,
   * reassignment, process generation replacement, member Run/wave stop) appends one
   * board.grant_revoked event naming the cause; replay derives active/revoked solely from the
   * mint and revoke events. */
  revokeBoardGrants({ workerId = null, taskId = null, cause = null, reason = null }, auth) {
    if (auth == null || typeof auth?.key !== 'string' || typeof auth?.actor !== 'string') {
      throw new TypeError('grant revocation requires explicit actor and idempotencyKey');
    }
    const causeText = reason ?? cause ?? 'lifecycle';
    const revoked = [];
    for (const grant of this.activeBoardGrants({ workerId, taskId })) {
      if (grant.state !== 'active') continue;
      const payload = { grantId: grant.grantId, board: grant.board, workerId: grant.workerId, taskId: grant.taskId, cause: causeText };
      const revokeKey = `${auth.key}:${grant.grantId}`;
      const prior = this._byKey.get(revokeKey) ?? null;
      if (prior && prior.kind === 'board.grant_revoked' && prior.payload?.grantId === grant.grantId) {
        revoked.push({ grantId: grant.grantId, result: 'idempotent', event: clone(prior) });
        continue;
      }
      const event = this._append('board.grant_revoked', payload, {
        actor: auth.actor, key: revokeKey,
      });
      revoked.push({ grantId: grant.grantId, result: 'revoked', event: clone(event) });
    }
    return { ok: true, revoked };
  }

  /** The S-2-shaped worker admission seam for claim/report (Decision 3). One entry point from
   * every adapter. Steps in order: (1) close the wire shape; (2) resolve+prove the grant against
   * the authenticated worker/task/generation; (3) derive scope from the grant; (4) verify board
   * binding, grant permission, and Run/wave state before item existence; (5) normalize the
   * request digest; (6) authority-before-replay — the effective key is namespaced
   * <opKind>:<grantDigest>:<callerKey> so cross-worker/cross-op collisions cannot occur; (7) the
   * kernel's in-append CAS re-check (final fence/item/open/claim gate). An absent, revoked,
   * foreign, or generation-stale grant receives the SAME constant board_worker_scope_refused
   * before any board/item lookup. */
  admitWorkerBoardCommand({ kind, grantId, payload, workerId, taskId, taskVersion, processGeneration, idempotencyKey }) {
    const fail = (message, code = 'board_worker_scope_refused') => this._boardAdmissionFailure(message, code);
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
    const grant = this._boardGrants.get(grantId) ?? null;
    if (!grant || grant.state !== 'active' || !grant.active
      || grant.workerId !== workerId || grant.taskId !== taskId
      || grant.processGeneration !== processGeneration) {
      fail('worker board scope is refused', 'board_worker_scope_refused');
    }
    // Step 3/4 — derive scope from the grant; verify binding, permission, and live state before
    // any item existence.
    const board = grant.board;
    const binding = this._boardRunBindings.get(board) ?? null;
    if (!binding || binding.runId !== grant.boardRunId) {
      fail('worker board scope is refused', 'board_worker_scope_refused');
    }
    const permission = kind === 'claim' ? 'claim' : 'report';
    if (!Array.isArray(grant.permissions) || !grant.permissions.includes(permission)) {
      fail('worker board scope is refused', 'board_worker_scope_refused');
    }
    if (this._runStopByTarget.has(grant.boardRunId) || this._runStops.has(grant.boardRunId)
      || this._runs.get(grant.boardRunId)?.status === 'sealed') {
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
      const scopedItem = this._boardItems.get(itemId);
      if (!scopedItem || scopedItem.board !== board) {
        fail('worker board scope is refused', 'board_worker_scope_refused');
      }
      const gate = () => {
        if (typeof this._boardAdmissionInterleave === 'function') this._boardAdmissionInterleave();
        if (this.boardFence(board) !== expectedBoardFence) {
          this._boardAdmissionFailure('board fence is stale', 'stale_board_fence');
        }
        const current = this._boardItems.get(itemId);
        if (!current || current.board !== board || current.state !== 'open') {
          this._boardAdmissionFailure(`board item ${itemId} is not open`, 'board_item_not_open');
        }
        const existing = this._boardClaims.get(itemId);
        if (existing && existing.active) throw new CoordinationRefusal(`board item ${itemId} is already claimed`, 'conflict');
      };
      return this.requestBoardClaim({
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
    const scopedItem = this._boardItems.get(itemId);
    if (!scopedItem || scopedItem.board !== board) {
      fail('worker board scope is refused', 'board_worker_scope_refused');
    }
    // Decision 6 rule 4: after authorization, an EXACT prior replay returns the original success
    // WITHOUT re-judging later live-state changes (a lost successful receipt is recovered even
    // after the orchestrator closes the item). The kernel's own prior lookup adjudicates this.
    const priorReport = this._byKey.get(effectiveKey) ?? null;
    if (priorReport) {
      if (priorReport.kind !== 'board.report_submitted'
        || priorReport.payload?.requestDigest !== reportRequestDigest) {
        fail('board report idempotency content changed', 'board_replay_conflict');
      }
      return this.submitBoardReport({
        itemId, itemVersion: payload.itemVersion, itemDigest: payload.itemDigest,
        owner: workerId, ownerTask: taskId, body: payload.body,
      }, { actor: workerId, key: effectiveKey }, null);
    }
    // Decision 4: report admission requires an active owned claim, the exact claim version, and
    // an open item — checked BEFORE the kernel (authority-before-replay) and re-checked by the
    // in-append gate.
    const activeClaim = this._boardClaims.get(itemId);
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
      if (typeof this._boardAdmissionInterleave === 'function') this._boardAdmissionInterleave();
      const current = this._boardItems.get(itemId);
      if (!current || current.board !== board || current.state !== 'open') {
        this._boardAdmissionFailure(`board item ${itemId} is not open`, 'board_item_not_open');
      }
      const claim = this._boardClaims.get(itemId);
      if (!claim || !claim.active || claim.owner !== workerId || claim.ownerTask !== taskId) {
        this._boardAdmissionFailure('worker board report has no active owned claim', 'board_report_no_active_claim');
      }
      if (claim.version !== payload.expectedClaimVersion) {
        this._boardAdmissionFailure('worker board report claim version is stale', 'board_report_stale_claim_version');
      }
    };
    return this.submitBoardReport({
      itemId, itemVersion: payload.itemVersion, itemDigest: payload.itemDigest,
      owner: workerId, ownerTask: taskId, body: payload.body,
    }, { actor: workerId, key: effectiveKey }, gate);
  }

  /** Decision 2/3: the S-2-shaped grant mint behind waves.send claimGrant. The caller names no
   * grantee and no permissions; the hub proves the orchestrator's session authority, resolves
   * the member coordinates server-side, derives the wave, verifies board binding and wave
   * membership, records the orchestrator-selected permission subset, and durably mints one
   * closed grant BEFORE the steer is deliverable. The effective replay key
   * <grant.mint>:<grantDigest>:<callerKey> plus the caller-key digest index make an exact retry
   * exactly-once and a changed-content retry a typed board_replay_conflict. */
  mintBoardGrant(entry, auth) { return coordinationLedger.mintBoardGrant(this, entry, auth); }
  _taskByRun(runId) {
    return coordinationInternals._taskByRun(this._tasks, runId);
  }
  _waveMembershipOf(runId) {
    return coordinationInternals._waveMembershipOf(this._events, runId);
  }

  // -------------------------------------------------------------------------
  // Decision 5 — the grant-scoped L1 board read. One board, every item (unowned open work
  // included), stable pages of at most 16 items and 28 KiB, stable (ordinal,itemId) ordering,
  // in-item report continuation by (itemId, lastReportSeq), and typed board_oversize_item
  // truncation. The cursor digest binds grant digest, board, board Run, member Run, page
  // position, and both fence components.
  // -------------------------------------------------------------------------

  boardGrantPage({ grantId, cursor, workerId, taskId, taskVersion, processGeneration }) { return coordinationLedger.boardGrantPage(this, { grantId, cursor, workerId, taskId, taskVersion, processGeneration }); }

  _mintBoardCursor(grant, { page, itemId = null, lastReportSeq = null }) { return coordinationLedger._mintBoardCursor(this, grant, { page, itemId, lastReportSeq }); }

  _verifyBoardCursor(cursor, grant) { return coordinationLedger._verifyBoardCursor(this, cursor, grant); }
  _sortedBoardItems(board) {
    return coordinationInternals._sortedBoardItems(this, board);
  }

  _reportsForItem(itemId) { return coordinationLedger._reportsForItem(this._boardReports, itemId); }
  _boardGrantItemRow(item, frame) {
    return coordinationInternals._boardGrantItemRow(this._boardClaims, item, frame);
  }
  _boardGrantReportRow(report, frame) {
    return coordinationInternals._boardGrantReportRow(report, frame);
  }

  _renderBoardGrantPage(grant, state) { return coordinationLedger._renderBoardGrantPage(this, grant, state); }

  // -------------------------------------------------------------------------
  // REPL-3 branch resolution (repl23-decisions.md Part F rules 17-19). Wired into the real
  // REPL-1 admission path (admitReplManifest pre-normalization splice): ordinary branches are
  // caller-submitted and hub-validated; `cell:`-typed branches are resolved here at admission —
  // settled-only (rule 18) — and their five coordinate fields are entirely hub-computed, never
  // accepted from the caller for that branch kind.
  // -------------------------------------------------------------------------

  /** Normalizes one caller-submitted ReplManifest branch. An ordinary
   * branch is caller-submitted and hub-validated; a `cell:`-typed branch (REPL-3, Part F rule
   * 17-19) is resolved here at admission — settled-only (rule 18) — and its five coordinate
   * fields (digest/ref/itemCount/mediaType/summary) are entirely hub-computed, never accepted
   * from the caller for that branch kind. */
  _resolveReplManifestBranch(branch) {
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
      const cell = this.contextCell(cellId);
      if (!cell || cell.state !== 'completed') {
        throw new CoordinationRefusal(`ReplManifest cell branch ${branch.name} names a cell that is not settled`,
          'repl_manifest_cell_not_settled');
      }
      const outputRef = cell.result.outputRef;
      // Reverify through the identical discipline settleContextCell's completion path already
      // uses (coordination-store.mjs settleContextCell) — never poisoned, only never-happened.
      try { this._contextReferenceRead(outputRef); }
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

  // -------------------------------------------------------------------------
  // REPL-2 (issue #22, repl23-decisions.md): named bindings, immutable versions under
  // (runId, scope, name); no `repl.read` event kind (F10); cached, non-evented reads own the
  // per-(runId, scope) fence (Part C/D). Never the board fence or FenceTable (Part I).
  // -------------------------------------------------------------------------

  /** The binding fence: EVERY write to (runId, scope) — worker writes included, unlike
   * boardFence's orchestrator-authority-only carve-out (Part C rule 7). Replay-derivable,
   * never a separately durable counter (rule 8). */
  bindingFence(runId, scope) {
    return coordinationInternals.bindingFence(this._replBindingFences, runId, scope);
  }

  admitReplBinding(fields, auth) {
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
    const prior = this._byKey.get(auth?.key);
    if (prior) {
      const runId = this._replManifestAdmissions.get(prior.payload?.manifestDigest)?.runId ?? null;
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
      const projected = runId !== null ? this._replBindings.get(replBindingKey(runId, fields.scope, fields.name)) : null;
      return freeze({ ok: true, result: 'idempotent', event: clone(prior), binding: clone(projected) });
    }

    // Part B rule 4: authorized by, and inherits its runId from, the manifest_admitted record
    // its manifestDigest names — never a caller-supplied runId, never a wrapper-forced scope.
    const record = this._replManifestAdmissions.get(fields.manifestDigest);
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
    this._assertRunAdmissionOpen(runId, false);

    const key = replBindingKey(runId, fields.scope, fields.name);
    const current = this._replBindings.get(key);
    if (current) {
      // Part C rule 9: a version CAS, not a fence CAS — concurrent binds to different names in
      // the same scope never spuriously conflict with each other.
      if (expectedBindingVersion !== current.bindingVersion) {
        throw new CoordinationRefusal('REPL binding expectedBindingVersion is stale', 'stale_binding_version');
      }
    } else {
      const distinctNames = new Set([...this._replBindings.keys()]
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
    const cell = this.contextCell(fields.cellId);
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
    const event = this._append('repl.binding_set', payload, auth);
    return freeze({
      ok: true, result: current ? 'rebound' : 'bound', event: clone(event),
      binding: clone(this._replBindings.get(key)),
    });
  }

  dropReplBinding(fields, auth) { return coordinationLedger.dropReplBinding(this, fields, auth); }

  /** Non-evented read (F10, rule 10): a poll appends nothing to the ledger. Active bindings
   * only (state: 'bound'), one row per name keyed to its latest version (Part D rule 11). */
  replBindingSnapshot(runId, scope) { return coordinationLedger.replBindingSnapshot(this, runId, scope); }

  /** `repl:<scope>:<name>@<version>` resolves the EXACT (runId, scope, name, bindingVersion)
   * row from history — never "latest" — even if the binding has since been dropped or
   * superseded (Part A rule 2; Part E rule 15). */
  resolveReplCitation(runId, citation) {
    const match = typeof citation === 'string' ? REPL_CITATION.exec(citation) : null;
    if (!match) throw new CoordinationRefusal('REPL citation is unparseable', 'repl_binding_citation_not_found');
    const [, scope, name, versionText] = match;
    const version = Number(versionText);
    const history = this._replBindingHistory.get(replBindingKey(runId, scope, name)) ?? [];
    const row = history.find((rec) => rec.bindingVersion === version);
    if (!row) throw new CoordinationRefusal('REPL citation does not resolve', 'repl_binding_citation_not_found');
    return clone(row);
  }

  _knowledgeFailure(message, code, integrity = false) {
    throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code);
  }
  _knowledgePayload(fields, extras = {}) {
    return coordinationInternals._knowledgePayload(fields, extras);
  }

  _validateKnowledgeContent(fields, integrity = false) {
    const core = Object.fromEntries(Object.entries(fields ?? {}).filter(([key]) => key !== 'contentDigest'));
    if (!/^[a-f0-9]{64}$/.test(fields?.contentDigest ?? '') || fields.contentDigest !== canonicalDigest(core)) this._knowledgeFailure('knowledge payload content binding is invalid', 'knowledge_content_integrity', integrity);
  }

  _knowledgeLiveAt(row, at) { return coordinationLedger._knowledgeLiveAt(row, at); }

  _validateKnowledgeEvidence(evidence = [], eventSeq = this._events.length + 1, integrity = false) {
    if (!Array.isArray(evidence)) this._knowledgeFailure('knowledge evidence must be an array', 'invalid_evidence', integrity);
    for (const ref of evidence) {
      if (Number.isInteger(ref.coordinationSeq)) {
        if (Object.keys(ref).join(',') !== 'coordinationSeq' || ref.coordinationSeq < 1 || ref.coordinationSeq >= eventSeq || !this._events[ref.coordinationSeq - 1]) this._knowledgeFailure(`future/missing evidence seq ${ref.coordinationSeq}`, 'temporal_incoherence', integrity);
      } else if (typeof ref.artifactId === 'string') {
        if (Object.keys(ref).join(',') !== 'artifactId' || !this._artifacts.has(ref.artifactId)) this._knowledgeFailure(`missing evidence artifact ${ref.artifactId}`, 'missing_evidence', integrity);
      } else this._knowledgeFailure('knowledge evidence must reference coordinationSeq or artifactId', 'invalid_evidence', integrity);
    }
  }

  _validateKnowledgeTimes(fields, integrity = false) {
    const from = fields.validFrom == null ? null : Date.parse(fields.validFrom); const to = fields.validTo == null ? null : Date.parse(fields.validTo);
    if ((fields.validFrom != null && !Number.isFinite(from)) || (fields.validTo != null && !Number.isFinite(to)) || (from !== null && to !== null && to < from)) this._knowledgeFailure('knowledge valid time is invalid', 'invalid_valid_time', integrity);
  }

  _validateKnowledgeNodePayload(fields, event, integrity = false) {
    this._validateKnowledgeContent(fields, integrity);
    if (!KNOWLEDGE_NODE_TYPES.has(fields?.type)) this._knowledgeFailure(`unknown knowledge node type ${fields?.type}`, 'invalid_node_type', integrity);
    if (!KNOWLEDGE_GROUNDINGS.has(fields?.grounding)) this._knowledgeFailure(`unknown knowledge grounding ${fields?.grounding}`, 'invalid_grounding', integrity);
    if (typeof fields.id !== 'string' || fields.id.length === 0 || Buffer.byteLength(fields.id) > 4_096 || this._knowledgeNodes.has(fields.id)) this._knowledgeFailure(`duplicate/invalid knowledge node ${fields?.id}`, 'duplicate_node', integrity);
    this._validateKnowledgeEvidence(fields.evidence ?? [], event.seq, integrity); this._validateKnowledgeTimes(fields, integrity);
    if (fields.type === 'Decision') {
      if ((fields.evidence?.length ?? 0) === 0 || !Array.isArray(fields.informedBy) || fields.informedBy.length === 0) this._knowledgeFailure('Decision requires Informed evidence and graph source', 'causal_orphan', integrity);
      const effectiveAt = fields.validFrom ?? event.ts ?? this._clock();
      for (const id of fields.informedBy) if (!this._knowledgeLiveAt(this._knowledgeNodes.get(id), effectiveAt)) this._knowledgeFailure(`missing or non-live Informed source ${id}`, 'missing_endpoint', integrity);
    }
    if (fields.type === 'Finding' && fields.grounding === 'verified' && (fields.evidence?.length ?? 0) === 0) this._knowledgeFailure('verified Finding requires evidence', 'causal_orphan', integrity);
    if (fields.promotion?.trigger === 'verified_task_outcome' && (typeof fields.taskId !== 'string' || !this._knowledgeNodes.has(`task:${fields.taskId}`))) this._knowledgeFailure('verified task outcome requires its durable task', 'missing_endpoint', integrity);
  }
  _supersessionWouldCycle(from, to) {
    return coordinationInternals._supersessionWouldCycle(this._knowledgeEdges, from, to);
  }

  _validateKnowledgeEdgePayload(fields, event, integrity = false) {
    this._validateKnowledgeContent(fields, integrity);
    if (!KNOWLEDGE_EDGE_TYPES.has(fields?.type)) this._knowledgeFailure(`unknown knowledge edge type ${fields?.type}`, 'invalid_edge_type', integrity);
    if (fields?.type === 'Contradicts' && this._knowledgeEdges.has(fields.id)) this._knowledgeFailure('knowledge contradiction already exists', 'duplicate_contradiction', integrity);
    if (typeof fields.id !== 'string' || fields.id.length === 0 || Buffer.byteLength(fields.id) > 4_096 || this._knowledgeEdges.has(fields.id)) this._knowledgeFailure(`duplicate/invalid knowledge edge ${fields?.id}`, 'duplicate_edge', integrity);
    const from = this._knowledgeNodes.get(fields.from); const to = this._knowledgeNodes.get(fields.to);
    if (!from || !to) this._knowledgeFailure('knowledge edge endpoints must exist', 'missing_endpoint', integrity);
    this._validateKnowledgeEvidence(fields.evidence ?? [], event.seq, integrity); this._validateKnowledgeTimes(fields, integrity);
    if (fields.type === 'Supersedes') {
      const effective = Date.parse(fields.validFrom ?? event.ts); const openContradiction = [...this._knowledgeEdges.values()].some((edge) => edge.type === 'Contradicts' && !edge.resolvedBy && !edge.validTo && [edge.from, edge.to].includes(fields.to));
      if (fields.from === fields.to || from.type !== to.type || !this._knowledgeLiveAt(from, effective) || !this._knowledgeLiveAt(to, effective) || openContradiction || this._supersessionWouldCycle(fields.from, fields.to)) this._knowledgeFailure('knowledge supersession is invalid', 'invalid_supersession', integrity);
      if (fields.expectedValidityVersion !== to.validityVersion) this._knowledgeFailure('stale validity version', 'stale_version', integrity);
      const floor = Math.max(Date.parse(from.validFrom), Date.parse(to.validFrom));
      if (!Number.isFinite(effective) || effective < floor) this._knowledgeFailure('knowledge supersession is backdated', 'invalid_supersession', integrity);
    }
    if (fields.type === 'Contradicts') {
      const pair = [fields.from, fields.to].sort(); const canonicalId = `knowledge-edge:contradicts:${canonicalDigest(pair)}`;
      const effective = fields.validFrom ?? event.ts; const lifecycleFields = ['validTo', 'resolvedBy', 'winnerId', 'loserId', 'resolutionReason'];
      if (lifecycleFields.some((key) => Object.hasOwn(fields, key)) || fields.from === fields.to || from.type !== to.type || !this._knowledgeLiveAt(from, effective) || !this._knowledgeLiveAt(to, effective) || (fields.evidence?.length ?? 0) === 0 || fields.id !== canonicalId) this._knowledgeFailure('knowledge contradiction is invalid', 'invalid_contradiction', integrity);
      if ([...this._knowledgeEdges.values()].some((edge) => edge.type === 'Contradicts' && !edge.validTo && canonicalDigest([edge.from, edge.to].sort()) === canonicalDigest(pair))) this._knowledgeFailure('knowledge contradiction already exists', 'duplicate_contradiction', integrity);
    }
  }

  _deriveKnowledgePromotion(repoId, observedSeq, policy, beforeEventSeq = this._events.length + 1) {
    if (!validKnowledgePromotionPolicy(policy) || policy.repoId !== repoId || !Number.isSafeInteger(observedSeq) || observedSeq < 0 || observedSeq >= beforeEventSeq || observedSeq > this._events.length) throw new CoordinationRefusal('knowledge promotion request is invalid', 'causal_promotion_invalid');
    if (observedSeq > policy.maxScanEvents) throw new CoordinationRefusal('knowledge promotion scan exceeded deployment ceiling', 'causal_promotion_oversize');
    const prefix = this._events.slice(0, observedSeq); const nodesAtBoundary = this.queryKnowledge({ observedSeq }); const edgesAtBoundary = this.queryKnowledgeEdges({ observedSeq }); const nodeMap = new Map(nodesAtBoundary.map((node) => [node.id, node]));
    const promoted = new Set(this._events.slice(0, Math.max(0, beforeEventSeq - 1)).filter((event) => event.kind === 'knowledge.promotion_batch').flatMap((event) => event.payload?.candidates?.map((row) => `${row.sourceSeq}:${row.sourceKind}`) ?? []));
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
      const node = this._knowledgePayload(fields); const edgeType = type === 'Decision' ? 'Informed' : 'ObservedIn'; const edgeId = `knowledge-edge:${edgeType.toLowerCase()}:${nodeId}:task:${taskId}`;
      const edge = this._knowledgePayload({ id: edgeId, type: edgeType, from: nodeId, to: `task:${taskId}`, evidence });
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
      const sourceNode = this._knowledgePayload({ id: sourceNodeId, type: 'ScratchFact', grounding: 'observed', body: 'Observed Scratch fact metadata', evidence: sourceEvidence, promotion: { kind: 'ScratchFact', trigger: 'scratch.observed_source' }, repoId, sourceSeq: source.seq, sourceKind, scratchFactDigest, namespaceDigest: canonicalDigest(fact.namespace ?? null), keyDigest: canonicalDigest(fact.key ?? null), envRefDigest: canonicalDigest(fact.envRef) });
      const finding = this._knowledgePayload({ id: nodeId, type: 'Finding', grounding: 'observed', body: 'Cited observed Scratch fact', evidence, promotion: { kind: 'Finding', trigger: 'scratch.cited_observed' }, repoId, sourceSeq: source.seq, sourceKind, scratchFactDigest, readerTaskIds, sourceDigest: canonicalDigest(source) });
      const derived = this._knowledgePayload({ id: `knowledge-edge:derivedfrom:${nodeId}:${sourceNodeId}`, type: 'DerivedFrom', from: nodeId, to: sourceNodeId, evidence: sourceEvidence });
      const verified = readerTaskIds.map((taskId) => { const outcome = verifiedOutcomes.get(taskId); return this._knowledgePayload({ id: `knowledge-edge:verifiedby:${nodeId}:${outcome.id}`, type: 'VerifiedBy', from: nodeId, to: outcome.id, evidence: [{ coordinationSeq: byTask.get(taskId).seq }, { coordinationSeq: outcome.observedSeq }] }); });
      candidates.push({ nodeId, type: 'Finding', trigger: 'scratch.cited_observed', sourceSeq: source.seq, sourceKind, sourceDigest: canonicalDigest(source) }); nodes.push(sourceNode, finding); edges.push(derived, ...verified);
    }
    const order = (a, b) => a.sourceSeq - b.sourceSeq || compareCanonicalStrings(a.sourceKind, b.sourceKind) || compareCanonicalStrings(a.nodeId, b.nodeId); candidates.sort(order);
    const candidateOrder = new Map(candidates.map((row, index) => [row.nodeId, index])); nodes.sort((a, b) => (candidateOrder.get(a.id) ?? candidateOrder.get(a.id.replace(/^scratch-source:/, 'promotion:')) ?? Number.MAX_SAFE_INTEGER) - (candidateOrder.get(b.id) ?? candidateOrder.get(b.id.replace(/^scratch-source:/, 'promotion:')) ?? Number.MAX_SAFE_INTEGER) || compareCanonicalStrings(a.id, b.id)); edges.sort((a, b) => compareCanonicalStrings(a.id, b.id));
    if (candidates.length > policy.maxCandidates) throw new CoordinationRefusal('knowledge promotion candidates exceeded deployment ceiling', 'causal_promotion_oversize');
    const candidateBytes = candidates.reduce((sum, candidate) => sum + canonicalBytes({ candidate, nodes: nodes.filter((node) => node.id === candidate.nodeId || node.sourceSeq === candidate.sourceSeq), edges: edges.filter((edge) => edge.from === candidate.nodeId) }), 0);
    const evidenceRefs = [...nodes, ...edges].reduce((sum, row) => sum + (row.evidence?.length ?? 0), 0);
    if (candidateBytes > policy.maxCandidateBytes || evidenceRefs > policy.maxEvidenceRefs) throw new CoordinationRefusal('knowledge promotion projection exceeded deployment ceiling', 'causal_promotion_oversize');
    for (const node of nodes) if ((this._knowledgeNodeHistory.get(node.id) ?? []).some((version) => version.observedSeq < beforeEventSeq)) throw new CoordinationRefusal('knowledge promotion node namespace is occupied', 'causal_promotion_conflict');
    for (const edge of edges) if ((this._knowledgeEdgeHistory.get(edge.id) ?? []).some((version) => version.observedSeq < beforeEventSeq)) throw new CoordinationRefusal('knowledge promotion edge namespace is occupied', 'causal_promotion_conflict');
    return freeze({ candidates, nodes, edges, candidateBytes, evidenceRefs, projectionDigest: canonicalDigest({ candidates, nodes, edges }) });
  }

  _promotionProjection(payload, event = null) { return coordinationLedger._promotionProjection(payload, event); }

  _validateKnowledgePromotionPayload(payload, event, integrity = false) {
    const fail = (message, code) => { throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code); };
    const fields = ['schemaVersion', 'repoId', 'observedSeq', 'observedAt', 'policy', 'policyDigest', 'candidates', 'nodes', 'edges', 'requestDigest', 'projectionDigest', 'receiptDigest'];
    if (!payload || Object.keys(payload).sort().join(',') !== fields.sort().join(',') || payload.schemaVersion !== 1 || !promotionActor(event.actor) || !validKnowledgePromotionPolicy(payload.policy) || payload.repoId !== payload.policy.repoId || payload.policyDigest !== canonicalDigest(payload.policy)
      || !Number.isSafeInteger(payload.observedSeq) || payload.observedSeq < 0 || payload.observedSeq >= event.seq || payload.observedAt !== this.observationTime(payload.observedSeq)) fail('knowledge promotion receipt shape is invalid', 'causal_promotion_integrity');
    const expectedRequest = canonicalDigest({ actor: event.actor, idempotencyKey: event.idempotencyKey, repoId: payload.repoId, observedSeq: payload.observedSeq, policyDigest: payload.policyDigest });
    if (payload.requestDigest !== expectedRequest) fail('knowledge promotion request binding is invalid', 'causal_promotion_integrity');
    let derived; try { derived = this._deriveKnowledgePromotion(payload.repoId, payload.observedSeq, payload.policy, event.seq); } catch (error) { fail(error.message, error.code ?? 'causal_promotion_integrity'); }
    if (derived.candidates.length === 0 || canonicalDigest(payload.candidates) !== canonicalDigest(derived.candidates) || canonicalDigest(payload.nodes) !== canonicalDigest(derived.nodes) || canonicalDigest(payload.edges) !== canonicalDigest(derived.edges) || payload.projectionDigest !== derived.projectionDigest) fail('knowledge promotion projection diverged', 'causal_promotion_integrity');
    const core = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'receiptDigest'));
    if (payload.receiptDigest !== canonicalDigest(core) || canonicalBytes(payload) > payload.policy.maxBatchBytes) fail('knowledge promotion receipt is invalid or oversized', 'causal_promotion_integrity');
    return derived;
  }

  promoteKnowledgeBatch(repoId, observedSeq, policy, auth, beforeAppend = null) { return coordinationLedger.promoteKnowledgeBatch(this, repoId, observedSeq, policy, auth, beforeAppend); }

  reverifyKnowledgePromotion(repoId, observedSeq, policy, actor, eventSeq) {
    if (!validKnowledgePromotionPolicy(policy) || policy.repoId !== repoId || !promotionActor(actor) || !Number.isSafeInteger(eventSeq)) throw new CoordinationRefusal('knowledge promotion reverify request is invalid', 'causal_promotion_invalid');
    const event = this._events[eventSeq - 1]; if (!event || event.kind !== 'knowledge.promotion_batch' || event.actor !== actor || event.payload?.repoId !== repoId || event.payload?.observedSeq !== observedSeq || event.payload?.policyDigest !== canonicalDigest(policy)) throw new CoordinationRefusal('knowledge promotion receipt does not match authority', 'causal_promotion_conflict');
    this._validateKnowledgePromotionPayload(event.payload, event, false); return freeze({ event: clone(event), projection: this._promotionProjection(event.payload, event), replayed: true, noOp: false });
  }

  reverifyKnowledgePromotionNoOp(repoId, observedSeq, policy) {
    if (!validKnowledgePromotionPolicy(policy) || policy.repoId !== repoId) throw new CoordinationRefusal('knowledge promotion no-op reverify request is invalid', 'causal_promotion_invalid');
    const derived = this._deriveKnowledgePromotion(repoId, observedSeq, policy);
    if (derived.candidates.length !== 0) throw new CoordinationRefusal('knowledge promotion no-op is no longer reproducible', 'causal_promotion_conflict');
    return freeze({ event: null, projection: { repoId, observedSeq, observedAt: this.observationTime(observedSeq), policyDigest: canonicalDigest(policy), projectionDigest: derived.projectionDigest, receiptDigest: null, eventSeq: null, summaries: [] }, replayed: true, noOp: true });
  }

  _scratchCorrectionRequest(request) {
    return coordinationInternals._scratchCorrectionRequest(request);
  }
  _scratchCorrectionPrefix(observedSeq) {
    return coordinationInternals._scratchCorrectionPrefix(this._events, observedSeq);
  }

  _eligibleScratchOracle(repoId, factRow, oracleTaskId, state, nodeMap) {
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
        const source = this._operationalRead?.(mapped.payload.worker, mapped.payload.workerSeq); return source?.kind === 'verify.reverified' && source?.taskId === oracleTaskId && source?.runId === task.payload.runId && source?.payload?.accept === true && source?.routeKey === task.routeKey
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

  _deriveScratchCorrection(repoId, observedSeq, policy, rawRequest, beforeEventSeq = this._events.length + 1) {
    if (!validKnowledgeScratchCorrectionPolicy(policy) || policy.repoId !== repoId || !Number.isSafeInteger(observedSeq) || observedSeq < 0 || observedSeq >= beforeEventSeq || observedSeq > this._events.length) throw new CoordinationRefusal('Scratch correction boundary or policy is invalid', 'causal_correction_invalid');
    if (this._events.slice(observedSeq, Math.max(observedSeq, beforeEventSeq - 1)).some((event) => !SCRATCH_CORRECTION_ADMIN_EVENTS.has(event.kind))) throw new CoordinationRefusal('Scratch correction boundary became stale', 'causal_correction_conflict');
    if (observedSeq > policy.maxScanEvents) throw new CoordinationRefusal('Scratch correction scan exceeded deployment ceiling', 'causal_correction_oversize');
    const request = this._scratchCorrectionRequest(rawRequest); const state = this._scratchCorrectionPrefix(observedSeq); const nodesAtBoundary = this.queryKnowledge({ observedSeq }); const edgesAtBoundary = this.queryKnowledgeEdges({ observedSeq }); const nodeMap = new Map(nodesAtBoundary.map((node) => [node.id, node]));
    const targetNodeId = request.targetNodeId ?? null; let target = null;
    if (targetNodeId) {
      const node = nodeMap.get(targetNodeId); const allowedTrigger = ['scratch.cited_observed', 'scratch.oracle_verified', 'scratch.corrected'].includes(node?.promotion?.trigger);
      const source = Number.isSafeInteger(node?.derivedFromEvent) ? state.prefix[node.derivedFromEvent - 1] : null; const validSource = source?.kind === 'knowledge.promotion_batch' || source?.kind === 'knowledge.scratch_corrected';
      const openContradiction = edgesAtBoundary.some((edge) => edge.type === 'Contradicts' && !edge.validTo && [edge.from, edge.to].includes(targetNodeId));
      if (!node || node.type !== 'Finding' || node.repoId !== repoId || !allowedTrigger || !validSource || node.validityVersion !== request.expectedValidityVersion || openContradiction) throw new CoordinationRefusal('Scratch correction target is stale or ineligible', openContradiction ? 'unresolved_contradiction' : 'causal_correction_conflict');
      target = { nodeId: targetNodeId, expectedValidityVersion: request.expectedValidityVersion, observedSeq: node.observedSeq, contentDigest: node.contentDigest };
    }
    if (request.action === 'retract') {
      const affectedReadEvents = this._knowledgeReads.filter((read) => read.eventSeq <= observedSeq && read.nodeIds.includes(targetNodeId)).map((read) => read.eventSeq);
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
      oracle = this._eligibleScratchOracle(repoId, factRow, request.oracleTaskId, state, nodeMap); if (!oracle) throw new CoordinationRefusal('Derived Scratch oracle evidence is ineligible', 'causal_correction_conflict'); evidenceSeqs.push(...oracle.evidenceSeqs);
    }
    evidenceSeqs = [...new Set(evidenceSeqs)].sort((a, b) => a - b); const sourceKind = 'scratch.fact_posted'; const sourceNodeId = `scratch-source:${canonicalDigest({ repoId, sourceSeq: factRow.event.seq, sourceKind })}`;
    const findingId = `scratch-correction:${canonicalDigest({ repoId, action: request.action, sourceSeq: factRow.event.seq, targetNodeId, oracleTaskId: oracle?.taskId ?? null })}`; const sourceEvidence = [{ coordinationSeq: factRow.event.seq }]; const findingEvidence = evidenceSeqs.map((coordinationSeq) => ({ coordinationSeq }));
    const sourceNode = this._knowledgePayload({ id: sourceNodeId, type: 'ScratchFact', grounding: fact.grounding, body: `${fact.grounding === 'derived' ? 'Derived' : 'Observed'} Scratch fact metadata`, evidence: sourceEvidence, promotion: { kind: 'ScratchFact', trigger: fact.grounding === 'derived' ? 'scratch.derived_source' : 'scratch.observed_source' }, repoId, sourceSeq: factRow.event.seq, sourceKind, scratchFactDigest: canonicalDigest(fact.id), scratchFactFullDigest, namespaceDigest: canonicalDigest(fact.namespace ?? null), keyDigest: canonicalDigest(fact.key ?? null), envRefDigest: canonicalDigest(fact.envRef) });
    const trigger = request.action === 'release' ? 'scratch.oracle_verified' : 'scratch.corrected'; const grounding = fact.grounding === 'derived' ? 'verified' : 'observed';
    const finding = this._knowledgePayload({ id: findingId, type: 'Finding', grounding, body: request.action === 'release' ? 'Independently verified derived Scratch fact' : 'Corrected Scratch fact', evidence: findingEvidence, promotion: { kind: 'Finding', trigger }, repoId, sourceSeq: factRow.event.seq, sourceKind, scratchFactDigest: canonicalDigest(fact.id), scratchFactFullDigest, readerTaskIds, oracleTaskId: oracle?.taskId ?? null, sourceDigest });
    const edges = [this._knowledgePayload({ id: `knowledge-edge:derivedfrom:${findingId}:${sourceNodeId}`, type: 'DerivedFrom', from: findingId, to: sourceNodeId, evidence: sourceEvidence })];
    for (const row of verifiedTargets) edges.push(this._knowledgePayload({ id: `knowledge-edge:verifiedby:${findingId}:${row.nodeId}`, type: 'VerifiedBy', from: findingId, to: row.nodeId, evidence: row.evidence.map((coordinationSeq) => ({ coordinationSeq })) }));
    if (oracle) {
      edges.push(this._knowledgePayload({ id: `knowledge-edge:verifiedby:${findingId}:${oracle.taskNodeId}`, type: 'VerifiedBy', from: findingId, to: oracle.taskNodeId, evidence: oracle.evidenceSeqs.map((coordinationSeq) => ({ coordinationSeq })) }));
      edges.push(this._knowledgePayload({ id: `knowledge-edge:verifiedby:${findingId}:${oracle.artifactNodeId}`, type: 'VerifiedBy', from: findingId, to: oracle.artifactNodeId, evidence: [{ coordinationSeq: oracle.artifactEventSeq }, { artifactId: oracle.artifactId }] }));
    }
    if (target) edges.push(this._knowledgePayload({ id: `knowledge-edge:supersedes:${findingId}:${target.nodeId}`, type: 'Supersedes', from: findingId, to: target.nodeId, evidence: findingEvidence, expectedValidityVersion: target.expectedValidityVersion }));
    const nodes = [sourceNode, finding].sort((a, b) => compareCanonicalStrings(a.id, b.id)); edges.sort((a, b) => compareCanonicalStrings(a.id, b.id));
    for (const node of nodes) if ((this._knowledgeNodeHistory.get(node.id) ?? []).some((version) => version.observedSeq < beforeEventSeq)) throw new CoordinationRefusal('Scratch correction node namespace is occupied', 'causal_correction_conflict');
    for (const edge of edges) if ((this._knowledgeEdgeHistory.get(edge.id) ?? []).some((version) => version.observedSeq < beforeEventSeq)) throw new CoordinationRefusal('Scratch correction edge namespace is occupied', 'causal_correction_conflict');
    const affectedReadEvents = target ? this._knowledgeReads.filter((read) => read.eventSeq <= observedSeq && read.nodeIds.includes(target.nodeId)).map((read) => read.eventSeq) : [];
    const evidenceRefs = [...nodes, ...edges].reduce((sum, row) => sum + (row.evidence?.length ?? 0), 0); if (affectedReadEvents.length > policy.maxAffectedReads || evidenceRefs > policy.maxEvidenceRefs) throw new CoordinationRefusal('Scratch correction projection exceeded deployment ceiling', 'causal_correction_oversize');
    const evidenceDigest = canonicalDigest({ sourceEventSeq: factRow.event.seq, evidenceSeqs, target, affectedReadEvents, oracleTaskId: oracle?.taskId ?? null, producerRouteDigest: oracle?.producerRouteDigest ?? null, reviewerRouteDigest: oracle?.reviewerRouteDigest ?? null }); const projectionDigest = canonicalDigest({ action: request.action, target, nodes, edges, affectedReadEvents, evidenceDigest });
    return freeze({ request, target, nodes, edges, affectedReadEvents, evidenceRefs, evidenceDigest, projectionDigest, replacement: { nodeId: findingId, grounding }, oracleTaskId: oracle?.taskId ?? null });
  }

  _scratchCorrectionProjection(payload, event = null) { return coordinationLedger._scratchCorrectionProjection(payload, event); }

  _validateScratchCorrectionPayload(payload, event, integrity = false) {
    const fail = (message, code = 'causal_correction_integrity') => { throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code); };
    const fields = ['schemaVersion', 'action', 'repoId', 'observedSeq', 'observedAt', 'policy', 'policyDigest', 'request', 'requestDigest', 'target', 'nodes', 'edges', 'affectedReadEvents', 'evidenceDigest', 'projectionDigest', 'receiptDigest'];
    if (!payload || Object.keys(payload).sort().join(',') !== fields.sort().join(',') || payload.schemaVersion !== 1 || !promotionActor(event.actor) || !validKnowledgeScratchCorrectionPolicy(payload.policy) || payload.repoId !== payload.policy.repoId || payload.action !== payload.request?.action || payload.policyDigest !== canonicalDigest(payload.policy)
      || !Number.isSafeInteger(payload.observedSeq) || payload.observedSeq < 0 || payload.observedSeq >= event.seq || payload.observedAt !== this.observationTime(payload.observedSeq)) fail('Scratch correction receipt shape is invalid');
    const requestDigest = canonicalDigest({ actor: event.actor, idempotencyKey: event.idempotencyKey, repoId: payload.repoId, observedSeq: payload.observedSeq, policyDigest: payload.policyDigest, request: payload.request }); if (payload.requestDigest !== requestDigest) fail('Scratch correction request binding is invalid');
    let derived; try { derived = this._deriveScratchCorrection(payload.repoId, payload.observedSeq, payload.policy, payload.request, event.seq); } catch (error) { fail(error.message, error.code ?? 'causal_correction_integrity'); }
    if (canonicalDigest(payload.target) !== canonicalDigest(derived.target) || canonicalDigest(payload.nodes) !== canonicalDigest(derived.nodes) || canonicalDigest(payload.edges) !== canonicalDigest(derived.edges) || canonicalDigest(payload.affectedReadEvents) !== canonicalDigest(derived.affectedReadEvents) || payload.evidenceDigest !== derived.evidenceDigest || payload.projectionDigest !== derived.projectionDigest) fail('Scratch correction projection diverged');
    const core = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'receiptDigest')); if (payload.receiptDigest !== canonicalDigest(core) || canonicalBytes(payload) > payload.policy.maxBatchBytes) fail('Scratch correction receipt is invalid or oversized'); return derived;
  }

  correctScratchKnowledge(repoId, observedSeq, policy, request, auth, beforeAppend = null) { return coordinationLedger.correctScratchKnowledge(this, repoId, observedSeq, policy, request, auth, beforeAppend); }

  reverifyScratchCorrection(repoId, observedSeq, policy, actor, eventSeq, request) {
    if (!validKnowledgeScratchCorrectionPolicy(policy) || policy.repoId !== repoId || !promotionActor(actor) || !Number.isSafeInteger(eventSeq)) throw new CoordinationRefusal('Scratch correction reverify request is invalid', 'causal_correction_invalid'); const event = this._events[eventSeq - 1];
    const normalized = this._scratchCorrectionRequest(request); const policyDigest = canonicalDigest(policy); const requestDigest = event ? canonicalDigest({ actor, idempotencyKey: event.idempotencyKey, repoId, observedSeq, policyDigest, request: normalized }) : null;
    if (!event || event.kind !== 'knowledge.scratch_corrected' || event.actor !== actor || event.payload?.repoId !== repoId || event.payload?.observedSeq !== observedSeq || event.payload?.policyDigest !== policyDigest || event.payload?.requestDigest !== requestDigest || canonicalDigest(event.payload?.request) !== canonicalDigest(normalized)) throw new CoordinationRefusal('Scratch correction receipt does not match authority', 'causal_correction_conflict'); this._validateScratchCorrectionPayload(event.payload, event, false); return freeze({ event: clone(event), projection: this._scratchCorrectionProjection(event.payload, event), replayed: true });
  }

  // -------------------------------------------------------------------------
  // KG-2 Part D (rule 14): the settle-time orchestrator-admit gate. A new event kind,
  // structurally modeled on knowledge.scratch_corrected (not a reuse of
  // knowledge.promotion_batch — that event's validator re-derives its candidate set from the
  // scratch/verified-outcome scan policy and would reject a board/package Finding candidate).
  // -------------------------------------------------------------------------

  /** Rule 15 eligibility, checked against the state strictly before beforeEventSeq (so a replay
   * of this exact event reproduces the identical derivation regardless of what happened after
   * it was first applied — the same discipline _deriveScratchCorrection uses). Rule 17: the
   * admitted Finding's evidence carries the candidate's own evidence plus
   * { coordinationSeq: candidate.observedSeq } — the candidate's own, necessarily-prior minting
   * seq — never this event's own prospective seq (P1-2 fix). */
  _deriveWorkflowAdmission(repoId, runId, candidateFindingId, policy, beforeEventSeq = this._events.length + 1) {
    if (!validKnowledgeWorkflowAdmissionPolicy(policy) || policy.repoId !== repoId || !validRunId(runId)
      || typeof candidateFindingId !== 'string' || candidateFindingId.length === 0) {
      throw new CoordinationRefusal('workflow admission request is invalid', 'workflow_admit_invalid');
    }
    const boundary = beforeEventSeq - 1;
    const nodesAtBoundary = this.queryKnowledge({ observedSeq: boundary });
    const edgesAtBoundary = this.queryKnowledgeEdges({ observedSeq: boundary });
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
    const finding = this._knowledgePayload({
      id: admittedId, type: 'Finding', grounding: 'verified', evidence,
      promotion: { kind: 'Finding', trigger: 'workflow.admitted' }, repoId, runId,
    });
    const edgeId = `knowledge-edge:derivedfrom:${admittedId}:${candidateFindingId}`;
    const edge = this._knowledgePayload({
      id: edgeId, type: 'DerivedFrom', from: admittedId, to: candidateFindingId,
      evidence: [{ coordinationSeq: candidate.observedSeq }],
    });
    const projectionDigest = canonicalDigest({ candidateFindingId, nodes: [finding], edges: [edge] });
    return freeze({ candidateFindingId, nodes: [finding], edges: [edge], projectionDigest });
  }

  _validateWorkflowAdmissionPayload(payload, event, integrity = false) {
    const fail = (message, code = 'workflow_admit_integrity') => { throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code); };
    const fields = ['schemaVersion', 'repoId', 'runId', 'policy', 'policyDigest', 'candidateFindingId', 'requestDigest', 'nodes', 'edges', 'projectionDigest', 'receiptDigest'];
    if (!payload || Object.keys(payload).sort().join(',') !== fields.sort().join(',') || payload.schemaVersion !== 1
      || !promotionActor(event.actor) || !validKnowledgeWorkflowAdmissionPolicy(payload.policy)
      || payload.repoId !== payload.policy.repoId || !validRunId(payload.runId)
      || payload.policyDigest !== canonicalDigest(payload.policy)) fail('workflow admission receipt shape is invalid');
    const requestDigest = canonicalDigest({ actor: event.actor, idempotencyKey: event.idempotencyKey, repoId: payload.repoId, runId: payload.runId, policyDigest: payload.policyDigest, candidateFindingId: payload.candidateFindingId });
    if (payload.requestDigest !== requestDigest) fail('workflow admission request binding is invalid');
    let derived;
    try { derived = this._deriveWorkflowAdmission(payload.repoId, payload.runId, payload.candidateFindingId, payload.policy, event.seq); }
    catch (error) { fail(error.message, error.code ?? 'workflow_admit_integrity'); }
    if (canonicalDigest(payload.nodes) !== canonicalDigest(derived.nodes) || canonicalDigest(payload.edges) !== canonicalDigest(derived.edges)
      || payload.projectionDigest !== derived.projectionDigest) fail('workflow admission projection diverged');
    const core = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'receiptDigest'));
    if (payload.receiptDigest !== canonicalDigest(core) || canonicalBytes(payload) > payload.policy.maxBatchBytes) fail('workflow admission receipt is invalid or oversized');
    return derived;
  }

  /** Rule 16: two store-enforced checks, neither a free-string actor. (a) promotionActor — only
   * 'orchestrator'/'operator:<id>', the same guard promoteKnowledgeBatch already enforces. (b) an
   * active run-orchestrator lease bound into the request, validated exactly as
   * _validateRunLineageAdmission already does for child-run admission — a consistency/ordering
   * device layered on the single-writer trust model, not an independent authority proof. */
  admitWorkflowFinding(repoId, runId, candidateFindingId, policy, auth, lease) {
    if (!promotionActor(auth?.actor) || typeof auth?.key !== 'string' || auth.key.length === 0
      || !validKnowledgeWorkflowAdmissionPolicy(policy) || policy.repoId !== repoId) {
      throw new CoordinationRefusal('workflow admission authority is invalid', 'workflow_admit_invalid');
    }
    const policyDigest = canonicalDigest(policy);
    const requestDigest = canonicalDigest({ actor: auth.actor, idempotencyKey: auth.key, repoId, runId, policyDigest, candidateFindingId });
    const prior = this._byKey.get(auth.key);
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
      const leaseRecord = this._runOrchestratorLeases.get(lease?.id);
      if (!leaseRecord) this._runLineageFailure('run orchestrator lease was not found', 'run_orchestrator_lease_not_found');
      if (auth?.principalId !== leaseRecord.session.principalId
        || auth?.sessionId !== leaseRecord.session.sessionId
        || auth?.sessionAuthorityDigest !== leaseRecord.session.authorityDigest) {
        this._runLineageFailure('run orchestrator session does not match the lease', 'run_orchestrator_session_mismatch');
      }
      if (prior) {
        // Replay path: the binding already passed; refuse only a now-expired session. The lease's
        // own post-admit revocation is the normal KS7 resume state and must not refuse the retry.
        if (Date.parse(this._clock()) >= Date.parse(leaseRecord.session.expiresAt)) {
          this._runLineageFailure('run orchestrator session is expired', 'run_orchestrator_session_mismatch');
        }
      } else {
        const activeLease = this._activeRunOrchestratorLease({
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
      const leaseRecord = this._runOrchestratorLeases.get(lease?.id);
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
      this._validateWorkflowAdmissionPayload(prior.payload, prior, false);
      return freeze({ event: clone(prior), finding: clone(this._knowledgeNodes.get(prior.payload.nodes[0].id)), replayed: true });
    }
    const derived = this._deriveWorkflowAdmission(repoId, runId, candidateFindingId, policy);
    const core = {
      schemaVersion: 1, repoId, runId, policy: clone(policy), policyDigest,
      candidateFindingId, requestDigest, nodes: clone(derived.nodes), edges: clone(derived.edges),
      projectionDigest: derived.projectionDigest,
    };
    const payload = { ...core, receiptDigest: canonicalDigest(core) };
    if (canonicalBytes(payload) > policy.maxBatchBytes) throw new CoordinationRefusal('workflow admission batch exceeded deployment ceiling', 'workflow_admit_oversize');
    const fixedTs = this._clock();
    const prospective = { schemaVersion: 1, seq: this._events.length + 1, ts: fixedTs, kind: 'knowledge.workflow_admitted', actor: auth.actor, idempotencyKey: auth.key, payload };
    this._validateWorkflowAdmissionPayload(payload, prospective, false);
    const event = this._append('knowledge.workflow_admitted', payload, auth, fixedTs);
    return freeze({ event: clone(event), finding: clone(this._knowledgeNodes.get(derived.nodes[0].id)), replayed: false });
  }

  addKnowledgeNode(fields, auth) { return coordinationLedger.addKnowledgeNode(this, fields, auth); }

  _prepareKnowledgeNode(fields, promotion = null, validate = true) {
    const evidence = clone(fields.evidence ?? []);
    const extras = { evidence, id: fields.id ?? `knowledge:${fields.type}:${digest(fields)}`, ...(promotion === null ? {} : { promotion: clone(promotion) }) };
    const payload = this._knowledgePayload(fields, extras);
    if (validate) this._validateKnowledgeNodePayload(payload, { seq: this._events.length + 1, ts: this._clock() }, false);
    return payload;
  }

  promoteKnowledgeNode(fields, promotion, auth) { return coordinationLedger.promoteKnowledgeNode(this, fields, promotion, auth); }

  addKnowledgeEdge(fields, auth) { return coordinationLedger.addKnowledgeEdge(this, fields, auth); }

  _contradictionListRequest(request, policy) {
    return coordinationInternals._contradictionListRequest(this, request, policy);
  }

  listKnowledgeContradictions(repoId, rawRequest, policy) { return coordinationLedger.listKnowledgeContradictions(this, repoId, rawRequest, policy); }

  _contradictionResolutionRequest(request, policy) {
    return coordinationInternals._contradictionResolutionRequest(request, policy);
  }

  _deriveBoundedContradictionResolution(repoId, observedSeq, policy, rawRequest, beforeEventSeq = this._events.length + 1) {
    if (!validKnowledgeContradictionPolicy(policy) || policy.repoId !== repoId || !Number.isSafeInteger(observedSeq) || observedSeq < 0 || observedSeq >= beforeEventSeq || observedSeq > this._events.length) throw new CoordinationRefusal('knowledge contradiction resolution boundary is invalid', 'causal_contradiction_invalid');
    if (observedSeq > policy.maxScanEvents) throw new CoordinationRefusal('knowledge contradiction resolution scan exceeded deployment ceiling', 'causal_contradiction_oversize');
    if (this._events.slice(observedSeq, Math.max(observedSeq, beforeEventSeq - 1)).some((event) => !CONTRADICTION_ADMIN_EVENTS.has(event.kind))) throw new CoordinationRefusal('knowledge contradiction resolution boundary became stale', 'causal_contradiction_conflict');
    const request = this._contradictionResolutionRequest(rawRequest, policy); const nodes = this.queryKnowledge({ observedSeq }); const edges = this.queryKnowledgeEdges({ observedSeq });
    if (edges.length > policy.maxScanEdges) throw new CoordinationRefusal('knowledge contradiction resolution edge scan exceeded deployment ceiling', 'causal_contradiction_oversize');
    const nodeMap = new Map(nodes.map((node) => [node.id, node])); const edge = edges.find((row) => row.id === request.edgeId); const winner = nodeMap.get(request.winnerId); const loser = nodeMap.get(request.loserId);
    const preAppendNodes = new Map(this.queryKnowledge({ observedSeq: beforeEventSeq - 1 }).map((node) => [node.id, node])); const preAppendEdges = new Map(this.queryKnowledgeEdges({ observedSeq: beforeEventSeq - 1 }).map((row) => [row.id, row]));
    const currentEdge = preAppendEdges.get(request.edgeId); const currentWinner = preAppendNodes.get(request.winnerId); const currentLoser = preAppendNodes.get(request.loserId);
    if (!edge || edge.type !== 'Contradicts' || edge.validTo || edge.resolvedBy || !winner || !loser || winner.validTo || loser.validTo || ![edge.from, edge.to].includes(winner.id) || ![edge.from, edge.to].includes(loser.id)
      || !currentEdge || currentEdge.validTo || currentEdge.resolvedBy || !currentWinner || currentWinner.validTo || !currentLoser || currentLoser.validTo
      || canonicalDigest(edge) !== canonicalDigest(currentEdge) || canonicalDigest(winner) !== canonicalDigest(currentWinner) || canonicalDigest(loser) !== canonicalDigest(currentLoser)) throw new CoordinationRefusal('knowledge contradiction is stale, resolved, or mismatched', 'causal_contradiction_conflict');
    if (edge.validityVersion !== request.expectedEdgeValidityVersion || winner.validityVersion !== request.expectedWinnerValidityVersion || loser.validityVersion !== request.expectedLoserValidityVersion) throw new CoordinationRefusal('knowledge contradiction versions are stale', 'causal_contradiction_conflict');
    const affectedReadEvents = this._knowledgeReads.filter((read) => read.eventSeq <= observedSeq && read.nodeIds.includes(loser.id)).map((read) => read.eventSeq); const evidenceRefs = (edge.evidence ?? []).length + (winner.evidence ?? []).length + (loser.evidence ?? []).length;
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

  _boundedContradictionResolutionProjection(payload, event = null) { return coordinationLedger._boundedContradictionResolutionProjection(payload, event); }

  _validateBoundedContradictionResolutionPayload(payload, event, integrity = false) {
    const fail = (message, code = 'causal_contradiction_integrity') => { throw integrity ? new CoordinationIntegrityError(message, code) : new CoordinationRefusal(message, code); };
    const fields = ['schemaVersion', 'repoId', 'observedSeq', 'observedAt', 'policy', 'policyDigest', 'request', 'requestDigest', 'edgeId', 'winnerId', 'loserId', 'affectedReadEvents', 'projectionDigest', 'receiptDigest'];
    if (!payload || Object.keys(payload).sort().join(',') !== fields.sort().join(',') || payload.schemaVersion !== 2 || !promotionActor(event.actor) || !validKnowledgeContradictionPolicy(payload.policy) || payload.repoId !== payload.policy.repoId
      || payload.policyDigest !== canonicalDigest(payload.policy) || payload.edgeId !== payload.request?.edgeId || payload.winnerId !== payload.request?.winnerId || payload.loserId !== payload.request?.loserId
      || !Number.isSafeInteger(payload.observedSeq) || payload.observedSeq < 0 || payload.observedSeq >= event.seq || payload.observedAt !== this.observationTime(payload.observedSeq)) fail('knowledge contradiction resolution receipt shape is invalid');
    const requestDigest = canonicalDigest({ actor: event.actor, idempotencyKey: event.idempotencyKey, repoId: payload.repoId, observedSeq: payload.observedSeq, policyDigest: payload.policyDigest, request: payload.request });
    if (payload.requestDigest !== requestDigest) fail('knowledge contradiction resolution request binding is invalid');
    let derived; try { derived = this._deriveBoundedContradictionResolution(payload.repoId, payload.observedSeq, payload.policy, payload.request, event.seq); } catch (error) { fail(error.message, error.code === 'causal_contradiction_oversize' ? error.code : 'causal_contradiction_integrity'); }
    if (canonicalDigest(payload.affectedReadEvents) !== canonicalDigest(derived.affectedReadEvents) || payload.projectionDigest !== derived.projectionDigest) fail('knowledge contradiction resolution projection diverged');
    const core = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'receiptDigest'));
    if (!/^[a-f0-9]{64}$/.test(payload.receiptDigest ?? '') || payload.receiptDigest !== canonicalDigest(core) || canonicalBytes(payload) > payload.policy.maxBatchBytes) fail('knowledge contradiction resolution receipt is invalid or oversized');
    return derived;
  }

  resolveKnowledgeContradictionBounded(repoId, observedSeq, policy, rawRequest, auth, beforeAppend = null) { return coordinationLedger.resolveKnowledgeContradictionBounded(this, repoId, observedSeq, policy, rawRequest, auth, beforeAppend); }

  reverifyKnowledgeContradictionResolution(repoId, observedSeq, policy, actor, eventSeq, rawRequest) {
    if (!validKnowledgeContradictionPolicy(policy) || policy.repoId !== repoId || !promotionActor(actor) || !Number.isSafeInteger(eventSeq)) throw new CoordinationRefusal('knowledge contradiction reverify request is invalid', 'causal_contradiction_invalid');
    const event = this._events[eventSeq - 1]; const request = this._contradictionResolutionRequest(rawRequest, policy); const policyDigest = canonicalDigest(policy); const requestDigest = event ? canonicalDigest({ actor, idempotencyKey: event.idempotencyKey, repoId, observedSeq, policyDigest, request }) : null;
    if (!event || event.kind !== 'knowledge.contradiction_resolved' || event.payload?.schemaVersion !== 2 || event.actor !== actor || event.payload.repoId !== repoId || event.payload.observedSeq !== observedSeq || event.payload.policyDigest !== policyDigest || event.payload.requestDigest !== requestDigest || canonicalDigest(event.payload.request) !== canonicalDigest(request)) throw new CoordinationRefusal('knowledge contradiction resolution receipt does not match authority', 'causal_contradiction_conflict');
    this._validateBoundedContradictionResolutionPayload(event.payload, event, false); return freeze({ event: clone(event), projection: this._boundedContradictionResolutionProjection(event.payload, event), replayed: true });
  }

  _validateContradictionResolution(fields, integrity = false, actor = null) {
    const expected = ['edgeId', 'expectedEdgeValidityVersion', 'expectedLoserValidityVersion', 'expectedWinnerValidityVersion', 'loserId', 'reason', 'requestDigest', 'winnerId'];
    const request = Object.fromEntries(Object.entries(fields ?? {}).filter(([key]) => key !== 'requestDigest'));
    if (!fields || Object.keys(fields).sort().join(',') !== expected.sort().join(',') || fields.requestDigest !== canonicalDigest(request) || !boundedText(fields.reason, 8_192) || (actor !== null && actor !== 'orchestrator' && !(typeof actor === 'string' && actor.startsWith('operator:')))) this._knowledgeFailure('knowledge contradiction resolution is invalid', 'invalid_contradiction_resolution', integrity);
    const edge = this._knowledgeEdges.get(fields.edgeId); const winner = this._knowledgeNodes.get(fields.winnerId); const loser = this._knowledgeNodes.get(fields.loserId);
    if (!edge || edge.type !== 'Contradicts' || edge.validTo || edge.resolvedBy || !winner || !loser || winner.validTo || loser.validTo || new Set([fields.winnerId, fields.loserId]).size !== 2 || ![edge.from, edge.to].includes(fields.winnerId) || ![edge.from, edge.to].includes(fields.loserId)) this._knowledgeFailure('knowledge contradiction is already resolved or mismatched', 'contradiction_resolved', integrity);
    if (edge.validityVersion !== fields.expectedEdgeValidityVersion || winner.validityVersion !== fields.expectedWinnerValidityVersion || loser.validityVersion !== fields.expectedLoserValidityVersion) this._knowledgeFailure('stale validity version', 'stale_version', integrity);
  }

  _validateKnowledgeInvalidation(fields, event, integrity = false) {
    const expected = ['expectedValidityVersion', 'nodeId', 'reason', 'requestDigest']; const core = Object.fromEntries(Object.entries(fields ?? {}).filter(([key]) => key !== 'requestDigest'));
    const target = this._knowledgeNodes.get(fields?.nodeId);
    if (!fields || Object.keys(fields).sort().join(',') !== expected.sort().join(',') || fields.requestDigest !== canonicalDigest(core) || !boundedText(fields.reason, 8_192)) this._knowledgeFailure('knowledge invalidation is malformed', 'invalid_invalidation', integrity);
    if (!target || target.validTo || target.validityVersion !== fields.expectedValidityVersion) this._knowledgeFailure('knowledge invalidation is stale', 'stale_version', integrity);
    if ([...this._knowledgeEdges.values()].some((edge) => edge.type === 'Contradicts' && !edge.resolvedBy && !edge.validTo && [edge.from, edge.to].includes(fields.nodeId))) this._knowledgeFailure('knowledge endpoint has an unresolved contradiction', 'unresolved_contradiction', integrity);
    if (!Number.isSafeInteger(event.seq) || !Number.isFinite(Date.parse(event.ts))) this._knowledgeFailure('knowledge invalidation event time is invalid', 'invalid_invalidation', integrity);
  }

  _validateContaminationRecord(fields, event, integrity = false) {
    const expected = ['affectedReadEvents', 'invalidationEvent', 'nodeId'];
    const source = this._events[fields?.invalidationEvent - 1]; let nodeId = null;
    if (source?.kind === 'knowledge.edge_added' && source.payload?.type === 'Supersedes') nodeId = source.payload.to;
    else if (source?.kind === 'knowledge.contradiction_resolved') nodeId = source.payload.loserId;
    else if (source?.kind === 'knowledge.invalidated') nodeId = source.payload.nodeId;
    const reads = this._knowledgeReads.filter((read) => read.eventSeq < (source?.seq ?? 0) && read.nodeIds.includes(fields?.nodeId)).map((read) => read.eventSeq);
    if (!fields || Object.keys(fields).sort().join(',') !== expected.sort().join(',') || typeof fields.nodeId !== 'string' || source?.seq + 1 !== event.seq || source?.actor !== event.actor || event.idempotencyKey !== `${source?.idempotencyKey}:contamination` || nodeId !== fields.nodeId
      || !Array.isArray(fields.affectedReadEvents) || new Set(fields.affectedReadEvents).size !== fields.affectedReadEvents.length || canonicalDigest(fields.affectedReadEvents) !== canonicalDigest(reads)) this._knowledgeFailure('knowledge contamination record is invalid', 'contamination_integrity', integrity);
  }

  resolveKnowledgeContradiction(fields, auth) { return coordinationLedger.resolveKnowledgeContradiction(this, fields, auth); }

  /** KG-3 rule 3: the KG's last-applied graph event seq — the `max` observedSeq over the folded
   * knowledge node + edge history, or 0 when empty. NOT `this._events.length`: a non-KG event
   * (task claim, lifecycle) does not advance it, so previews are served from cache through
   * dispatch bursts and recompute only when a node/edge actually folds. Derived from folded
   * state, so replay reconstructs the identical fence. */
  _knowledgeProjectFence() {
    return coordinationInternals._knowledgeProjectFence(this);
  }

  /** KG-4 rule 15/15a: read-time MAD confidence over a Finding body. Exposed for direct
   * verification; the preview overlays it via madConfidenceOf. Never stored node state. */
  _madConfidence(body, maxMetrics = 100_000) {
    return coordinationInternals._madConfidence(body, maxMetrics);
  }

  /** KG-4 rule 16: read-time staleness overlay. `unreferenced` is scoped to *evented* reads
   * (`_knowledgeReads`); preview traffic is non-evented (Part A) so it never counts as a
   * reference. Read-time only — never a stored flag, never a mutation. */
  _knowledgeStaleness(node, fence, liveContradictNodeIds, liveSupersedeTargetIds, staleAfterSeq) {
    return coordinationInternals._knowledgeStaleness(this._knowledgeReads, node, fence, liveContradictNodeIds, liveSupersedeTargetIds, staleAfterSeq);
  }
  _cachePreview(key, value, previewPolicy) {
    return coordinationInternals._cachePreview(this, key, value, previewPolicy);
  }

  /** KG-3 Parts A/C/D/F/G: a pure, non-evented, LRU-cached, fail-open read projection that
   * reuses the recall candidate/graph/ranking body (`_buildKnowledgeRecall`) with every append
   * path severed. Overlays the KG-4 read-time `confidence` (MAD) and `staleness`, ranks
   * contradiction parties first with `warning:true`, and peels the ranked tail before ever
   * degrading. Returns a RecallPreview or, on a ceiling breach, a `briefingUnavailable:true`
   * marker — never throws except on a caller-shape fault (`causal_recall_invalid`). */
  recallPreview(repoId, request, policy) {
    if (typeof repoId !== 'string' || !policy || typeof policy !== 'object' || Array.isArray(policy)
      || Object.keys(policy).sort().join(',') !== 'preview,recall'
      || !validKnowledgeRecallPolicy(policy.recall) || policy.recall.repoId !== repoId
      || !validKnowledgePreviewPolicy(policy.preview)) {
      throw new CoordinationRefusal('knowledge preview policy is invalid', 'causal_recall_invalid');
    }
    const recallPolicy = policy.recall; const previewPolicy = policy.preview;
    const allowed = new Set(['text', 'types', 'grounding', 'seedNodeIds', 'limit']);
    if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some((key) => !allowed.has(key))
      || typeof request.text !== 'string' || request.text.trim().length === 0 || request.text.includes('\0') || !validUnicodeScalarString(request.text)
      || !Number.isSafeInteger(request.limit) || request.limit <= 0 || request.limit > recallPolicy.maxResults) {
      throw new CoordinationRefusal('knowledge preview request is invalid', 'causal_recall_invalid');
    }
    const terms = recallTerms(request.text);
    if (terms.length === 0) throw new CoordinationRefusal('knowledge preview query has no searchable terms', 'causal_recall_invalid');
    const types = request.types ?? []; const grounding = request.grounding ?? []; const seedNodeIds = request.seedNodeIds ?? [];
    if (!Array.isArray(types) || new Set(types).size !== types.length || types.some((type) => !KNOWLEDGE_NODE_TYPES.has(type))
      || !Array.isArray(grounding) || new Set(grounding).size !== grounding.length || grounding.some((value) => !KNOWLEDGE_GROUNDINGS.has(value))
      || !Array.isArray(seedNodeIds) || new Set(seedNodeIds).size !== seedNodeIds.length || seedNodeIds.length > request.limit || seedNodeIds.some((id) => !boundedText(id, 4_096))) {
      throw new CoordinationRefusal('knowledge preview filters or seeds are invalid', 'causal_recall_invalid');
    }
    const projectFence = this._knowledgeProjectFence();
    const observedAt = this.observationTime(projectFence);
    const degrade = (reason, extra = {}) => freeze({ schemaVersion: 1, repoId, projectFence, briefingUnavailable: true, reason, ...extra, nodes: [], contradictions: [] });
    if (Buffer.byteLength(request.text) > recallPolicy.maxQueryBytes || terms.length > recallPolicy.maxQueryTerms) {
      return degrade('causal_recall_oversize');
    }
    // Rule 10a: pre-filter seeds against current eligibility so the body's :12876 seed gate can
    // never fire on ordinary KG churn; dropped seeds are counted, never silently discarded.
    const eligibleNodes = this.queryKnowledge({ observedSeq: projectFence, asOf: observedAt })
      .filter((node) => (types.length === 0 || types.includes(node.type)) && (grounding.length === 0 || grounding.includes(node.grounding)));
    const eligibleMap = new Map(eligibleNodes.map((node) => [node.id, node]));
    const seedsDropped = seedNodeIds.filter((id) => !eligibleMap.has(id)).sort();
    const eligibleSeeds = seedNodeIds.filter((id) => eligibleMap.has(id)).sort();
    const query = freeze({
      schemaVersion: 1,
      normalizedTextDigest: canonicalDigest(normalizedRecallText(request.text)),
      termDigests: terms.map((term) => canonicalDigest(term)).sort(),
      types: [...types].sort(), grounding: [...grounding].sort(), seedNodeIds: [...eligibleSeeds].sort(),
      limit: request.limit, observedSeq: projectFence, asOf: observedAt,
    });
    const cacheKey = `${repoId} ${projectFence} ${canonicalDigest(query)} ${canonicalDigest(previewPolicy)}`;
    const hit = this._previewCache.get(cacheKey);
    if (hit !== undefined) { this._previewCache.delete(cacheKey); this._previewCache.set(cacheKey, hit); return hit; }

    let projection; let contradictionPeeled = 0;
    try {
      projection = this._buildKnowledgeRecall(query, recallPolicy);
    } catch (error) {
      if (!(error instanceof CoordinationRefusal) || error.code !== 'causal_recall_oversize') throw error;
      if (!/contradiction bundle/.test(error.message)) {
        return this._cachePreview(cacheKey, degrade('causal_recall_oversize'), previewPolicy);
      }
      // Rule 11a: contradiction-peel. Re-run against the maxResults ceiling with a shrinking
      // SELECTION cap, preserving the top node + its live-Contradicts peers, until the bundle
      // fits. Only a single-node bundle that still overflows degrades — with contradictionFlood.
      const peelQuery = freeze({ ...query, limit: recallPolicy.maxResults });
      let peeled = null;
      for (let selectionLimit = request.limit - 1; selectionLimit >= 1; selectionLimit -= 1) {
        try { peeled = this._buildKnowledgeRecall(peelQuery, recallPolicy, { selectionLimit }); contradictionPeeled = request.limit - selectionLimit; break; }
        catch (peelError) { if (!(peelError instanceof CoordinationRefusal) || peelError.code !== 'causal_recall_oversize' || !/contradiction bundle/.test(peelError.message)) throw peelError; }
      }
      if (peeled === null) {
        return this._cachePreview(cacheKey, degrade('causal_recall_oversize', { contradictionFlood: true }), previewPolicy);
      }
      projection = peeled;
    }

    const fenceEdges = this.queryKnowledgeEdges({ observedSeq: projectFence, asOf: observedAt });
    const incident = new Map();
    const liveContradictNodeIds = new Set(); const liveSupersedeTargetIds = new Set();
    for (const edge of fenceEdges) {
      if (edge.type === 'Contradicts') { liveContradictNodeIds.add(edge.from); liveContradictNodeIds.add(edge.to); }
      if (edge.type === 'Supersedes') liveSupersedeTargetIds.add(edge.to);
      if (edge.type === 'ReadBy') continue;
      for (const id of [edge.from, edge.to]) incident.set(id, (incident.get(id) ?? 0) + 1);
    }
    const warningIds = new Set(); for (const edge of projection.contradictions) { warningIds.add(edge.from); warningIds.add(edge.to); }
    const rows = projection.nodes.map((pn) => {
      const full = eligibleMap.get(pn.id);
      const termScore = pn.score - (pn.reason?.graphScore ?? 0);
      const edgeDegree = incident.get(pn.id) ?? 0;
      const evidenceCount = full?.evidence?.length ?? 0;
      const eventSeq = full?.eventTimeSeq ?? full?.observedSeq ?? pn.eventTimeSeq ?? pn.observedSeq ?? 0;
      const recency = projectFence > 0 ? Math.max(0, Math.min(1, eventSeq / projectFence)) : 0;
      const composite = previewPolicy.weightTerm * termScore + previewPolicy.weightEdgeDegree * edgeDegree
        + previewPolicy.weightEvidence * evidenceCount + previewPolicy.weightRecency * recency;
      const confidence = full?.type === 'Finding' ? madConfidenceOf(full.body, recallPolicy.maxCandidates) : null;
      const staleness = full ? this._knowledgeStaleness(full, projectFence, liveContradictNodeIds, liveSupersedeTargetIds, previewPolicy.staleAfterSeq) : null;
      return { ...clone(pn), composite, confidence, staleness, warning: warningIds.has(pn.id) };
    });
    rows.sort((a, b) => (Number(b.warning) - Number(a.warning)) || (b.composite - a.composite) || compareCanonicalStrings(a.id, b.id));
    const publicQuery = { normalizedTextDigest: query.normalizedTextDigest, termDigests: [...query.termDigests], types: [...query.types], grounding: [...query.grounding], seedNodeIds: [...query.seedNodeIds], limit: query.limit };
    const core = { schemaVersion: 1, repoId, projectFence, asOf: observedAt, query: publicQuery, nodes: rows, contradictions: clone(projection.contradictions), seedsDropped, contradictionPeeled, briefingUnavailable: false };
    return this._cachePreview(cacheKey, freeze({ ...core, projectionDigest: canonicalDigest(core) }), previewPolicy);
  }

  /** KG-4 rules 12–14: auto-link on admission, restricted to Supports/Refines/Cites (edges carry
   * NO grounding — v2-P2-9). The wave proposes scored candidates; this admits only allowed types
   * clearing their per-type threshold, each under a DETERMINISTIC `auth.key` so a re-proposal is a
   * clean idempotent no-op (v2-P2-10). Contradicts/Supersedes are never auto-minted — the store
   * refuses them (rule 13 red test drives that path directly). Every drop is counted, never
   * silently discarded (No-Arbitrary-Limits honesty). */
  autoLinkKnowledgeNode(nodeId, candidates, policy, auth) { return coordinationLedger.autoLinkKnowledgeNode(this, nodeId, candidates, policy, auth); }

  queryKnowledge(query = {}) { return coordinationLedger.queryKnowledge(this, query); }

  queryKnowledgeEdges(query = {}) { return coordinationLedger.queryKnowledgeEdges(this, query); }

  _prepareKnowledgeRecall(request, policy, actor) { return coordinationLedger._prepareKnowledgeRecall(this, request, policy, actor); }

  _buildKnowledgeRecall(query, policy, opts = {}) { return coordinationLedger._buildKnowledgeRecall(this, query, policy, opts); }

  _validateKnowledgeRecallPayload(payload, event, integrity = false) {
    const fail = (message, code = 'knowledge_recall_integrity') => this._knowledgeFailure(message, code, integrity);
    const fields = ['schemaVersion', 'readerActor', 'readerWorker', 'taskId', 'runId', 'query', 'policy', 'policyDigest', 'observedSeq', 'observedAt', 'asOf', 'nodeIds', 'validityVersions', 'scores', 'contradictionEdgeIds', 'requestDigest', 'resultProjectionDigest', 'receiptDigest'];
    if (!payload || Object.keys(payload).sort().join(',') !== fields.sort().join(',') || payload.schemaVersion !== 1 || payload.readerActor !== event.actor || !validKnowledgeRecallPolicy(payload.policy)
      || payload.policyDigest !== canonicalDigest(payload.policy) || !/^[a-f0-9]{64}$/.test(payload.requestDigest ?? '') || !/^[a-f0-9]{64}$/.test(payload.resultProjectionDigest ?? '')
      || payload.observedSeq !== payload.query?.observedSeq || payload.asOf !== payload.query?.asOf || payload.observedAt !== this.observationTime(payload.observedSeq)) fail('knowledge recall receipt shape is invalid');
    const core = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'receiptDigest'));
    if (!/^[a-f0-9]{64}$/.test(payload.receiptDigest ?? '') || payload.receiptDigest !== canonicalDigest(core) || canonicalBytes(payload) > payload.policy.maxReceiptBytes) fail('knowledge recall receipt binding is invalid');
    const expectedRequestDigest = canonicalDigest({ query: payload.query, reader: { readerActor: payload.readerActor, taskId: payload.taskId ?? null, runId: payload.runId ?? null }, policyDigest: payload.policyDigest });
    if (payload.requestDigest !== expectedRequestDigest) fail('knowledge recall request identity is invalid');
    const taskId = payload.taskId ?? null; const runId = payload.runId ?? null; const task = taskId === null ? null : this._tasks.get(taskId);
    const readerWorkerAtReceipt = task?.claimedEvent && task.claimedEvent < event.seq ? task.assignee : null;
    if ((taskId !== null && (!task || payload.readerWorker !== readerWorkerAtReceipt || runId !== null))
      || (runId !== null && (!this._runs.has(runId) || !this._knowledgeNodes.has(`run:${runId}`) || taskId !== null || payload.readerWorker !== null))
      || (taskId === null && runId === null && payload.readerWorker !== null)) fail('knowledge recall reader projection is invalid');
    let projection; try { projection = this._buildKnowledgeRecall(payload.query, payload.policy); } catch (error) { if (integrity) throw new CoordinationIntegrityError('knowledge recall projection cannot be rebuilt', 'knowledge_recall_integrity'); throw error; }
    const expectedScores = projection.nodes.map((node) => ({ id: node.id, score: node.score, reasonDigest: node.reasonDigest }));
    if (canonicalDigest(payload.nodeIds) !== canonicalDigest(projection.nodes.map((node) => node.id))
      || canonicalDigest(payload.validityVersions) !== canonicalDigest(Object.fromEntries(projection.nodes.map((node) => [node.id, node.validityVersion])))
      || canonicalDigest(payload.scores) !== canonicalDigest(expectedScores) || canonicalDigest(payload.contradictionEdgeIds) !== canonicalDigest(projection.contradictions.map((edge) => edge.edgeId))
      || payload.resultProjectionDigest !== projection.projectionDigest) fail('knowledge recall ranked projection diverged');
    return projection;
  }

  _newKnowledgeRecallReceipt(prepared) { return coordinationLedger._newKnowledgeRecallReceipt(this, prepared); }

  #knowledgeRecallPreview(request, policy, auth) { return coordinationLedger.knowledgeRecallPreview(this, request, policy, auth); }

  recallKnowledgeBounded(request, policy, auth, beforeAppend = null) { return coordinationLedger.recallKnowledgeBounded(this, request, policy, auth, beforeAppend); }

  reverifyKnowledgeRecall(request, policy, actor, eventSeq) { return coordinationLedger.reverifyKnowledgeRecall(this, request, policy, actor, eventSeq); }
  _recallAssessmentCandidate(receipt, observedSeq) {
    return coordinationInternals._recallAssessmentCandidate(this, receipt, observedSeq);
  }

  _buildKnowledgeRecallAssessment(repoId, observedSeq, policy, actor, assessmentEventSeq = this._events.length + 1) { return coordinationLedger._buildKnowledgeRecallAssessment(this, repoId, observedSeq, policy, actor, assessmentEventSeq); }

  _validateKnowledgeRecallAssessmentPayload(payload, event, integrity = false) {
    const fail = (message, code = 'knowledge_recall_assessment_integrity') => this._knowledgeFailure(message, code, integrity);
    const fields = ['schemaVersion', 'repoId', 'observedSeq', 'observedAt', 'policy', 'policyDigest', 'requestDigest', 'assessments', 'causationClaimed', 'projectionDigest', 'receiptDigest'];
    if (!payload || Object.keys(payload).sort().join(',') !== fields.sort().join(',') || payload.schemaVersion !== 1 || !validKnowledgeRecallAssessmentPolicy(payload.policy) || payload.repoId !== payload.policy.repoId || payload.policyDigest !== canonicalDigest(payload.policy)
      || payload.observedAt !== this.observationTime(payload.observedSeq) || payload.causationClaimed !== false || !Array.isArray(payload.assessments) || payload.assessments.length === 0) fail('knowledge recall assessment batch shape is invalid');
    let rebuilt; try { rebuilt = this._buildKnowledgeRecallAssessment(payload.repoId, payload.observedSeq, payload.policy, event.actor, event.seq); } catch { fail('knowledge recall assessment batch cannot be rebuilt'); }
    const projection = { schemaVersion: 1, repoId: payload.repoId, observedSeq: payload.observedSeq, observedAt: payload.observedAt, policyDigest: payload.policyDigest, requestDigest: payload.requestDigest, assessments: payload.assessments, causationClaimed: false };
    if (payload.requestDigest !== rebuilt.requestDigest || payload.projectionDigest !== canonicalDigest(projection) || canonicalDigest(payload.assessments) !== canonicalDigest(rebuilt.assessments)) fail('knowledge recall assessment batch diverged');
    for (const row of payload.assessments) {
      const { assessmentDigest, ...core } = row ?? {}; if (!/^[a-f0-9]{64}$/.test(assessmentDigest ?? '') || assessmentDigest !== canonicalDigest(core)) fail('knowledge recall assessment row binding is invalid');
    }
    const { receiptDigest, ...receiptCore } = payload;
    if (!/^[a-f0-9]{64}$/.test(receiptDigest ?? '') || receiptDigest !== canonicalDigest(receiptCore) || canonicalBytes(payload) > payload.policy.maxBatchBytes) fail('knowledge recall assessment batch binding is invalid');
    return freeze({ ...clone(rebuilt), eventSeq: event.seq, receiptDigest: payload.receiptDigest });
  }

  _newKnowledgeRecallAssessment(repoId, observedSeq, policy, auth) { return coordinationLedger._newKnowledgeRecallAssessment(this, repoId, observedSeq, policy, auth); }

  assessKnowledgeRecallBatch(repoId, observedSeq, policy, auth, beforeAppend = null) { return coordinationLedger.assessKnowledgeRecallBatch(this, repoId, observedSeq, policy, auth, beforeAppend); }

  reverifyKnowledgeRecallAssessment(repoId, observedSeq, policy, actor, eventSeq) { return coordinationLedger.reverifyKnowledgeRecallAssessment(this, repoId, observedSeq, policy, actor, eventSeq); }
  recallAssessments({ nodeId = null, taskId = null, observedSeq = this._events.length } = {}) {
    return coordinationInternals.recallAssessments(this, { nodeId, taskId, observedSeq });
  }

  readKnowledge(query, reader, auth) { return coordinationLedger.readKnowledge(this, query, reader, auth); }

  // KG activation rules 2/3/4/5 — additive projections over the existing knowledge records. They
  // read nodes/edges/events and never mutate; the admit gate (admitWorkflowFinding) stays the only
  // promotion path. The candidacy queue is derived from the store's candidate Findings (never stored
  // twice); the ritual counts feed the wave receipt / terminal outline; the content digest feeds the
  // workflow horizon's knowledgeDigest (cache-correct — content-addressed, recomputed only on a fence
  // miss, byte-identical when the knowledge content is unchanged).
  static get KNOWLEDGE_CANDIDATE_TRIGGERS() {
    return coordinationInternals.KNOWLEDGE_CANDIDATE_TRIGGERS();
  }

  /** A content-addressed digest of the live knowledge graph (nodes + edges). Stable across non-
   * knowledge state moves; moves whenever a node/edge is added, invalidated, or superseded. */
  knowledgeContentDigest() { return coordinationLedger.knowledgeContentDigest(this); }

  /** Rule 2: the candidacy queue — a first-class projection over the store's candidate Findings.
   * A candidate is a live Finding minted by one of the four source kinds, not yet admitted (no
   * DerivedFrom edge from a `workflow.admitted` finding to it). Bounded ≤ 16, stable minting order,
   * derived live (never stored twice). Admitting removes exactly that candidate. */
  knowledgeCandidateQueue({ now } = {}) { return coordinationLedger.knowledgeCandidateQueue(this, { now }); }

  /** Rule 3: the ritual counts — `candidates` (pending queue size, repo-scoped) and
   * `admittedThisRun` (workflow admits bound to this run). Zero is surfaced as 0, never a missing
   * field. Ergonomics only — the admit decision stays manual and gated. */
  knowledgeRitual(runId, { now } = {}) { return coordinationLedger.knowledgeRitual(this, runId, { now }); }

  invalidateKnowledge(nodeId, expectedValidityVersion, reason, auth) { return coordinationLedger.invalidateKnowledge(this, nodeId, expectedValidityVersion, reason, auth); }
  affectedReaders(nodeId) {
    return coordinationInternals.affectedReaders(this, nodeId);
  }
  traceKnowledge(nodeId) {
    return coordinationInternals.traceKnowledge(this, nodeId);
  }

  traceKnowledgeBounded(nodeId, options = {}) {
    const observedSeq = options.observedSeq ?? this._events.length; const maxDepth = options.maxDepth; const maxRows = options.maxRows; const maxEvidenceRefs = options.maxEvidenceRefs; const maxStateRows = options.maxStateRows; const maxNodes = options.maxNodes; const maxEdges = options.maxEdges;
    if (typeof nodeId !== 'string' || !Number.isSafeInteger(observedSeq) || observedSeq < 0 || observedSeq > this._events.length || !Number.isSafeInteger(maxDepth) || maxDepth < 0 || !Number.isSafeInteger(maxRows) || maxRows <= 0 || !Number.isSafeInteger(maxEvidenceRefs) || maxEvidenceRefs <= 0
      || !Number.isSafeInteger(maxStateRows) || maxStateRows <= 0 || !Number.isSafeInteger(maxNodes) || maxNodes <= 0 || !Number.isSafeInteger(maxEdges) || maxEdges <= 0) throw new CoordinationRefusal('causal trace request is invalid', 'causal_trace_invalid');
    if (this._knowledgeNodeHistory.size > maxNodes || this._knowledgeEdgeHistory.size > maxEdges || this._knowledgeNodeHistory.size + this._knowledgeEdgeHistory.size > maxStateRows) throw new CoordinationRefusal('causal trace exceeded deployment state ceiling', 'causal_trace_oversize');
    const allNodes = this.queryKnowledge({ observedSeq }); const allEdges = this.queryKnowledgeEdges({ observedSeq });
    const nodeMap = new Map(allNodes.map((node) => [node.id, node])); if (!nodeMap.has(nodeId)) throw new CoordinationRefusal(`unknown or non-current knowledge node ${nodeId}`, 'not_found');
    const causalTypes = new Set(['Supports', 'Contradicts', 'Supersedes', 'Informed', 'ProducedBy', 'Contains', 'DependsOn', 'Refines', 'VerifiedBy', 'DerivedFrom', 'Affects', 'Cites', 'ObservedIn']);
    const incident = new Map(); for (const edge of allEdges.filter((row) => causalTypes.has(row.type) && nodeMap.has(row.from) && nodeMap.has(row.to)).sort((a, b) => compareCanonicalStrings(a.id, b.id))) for (const id of [edge.from, edge.to]) { const rows = incident.get(id) ?? []; rows.push(edge); incident.set(id, rows); }
    const queue = [{ id: nodeId, depth: 0 }]; const seenNodes = new Set(); const seenEdges = new Set(); const selectedNodes = []; const selectedEdges = []; const frontier = new Set(); let evidenceRefs = 0;
    const assertRows = () => { if (selectedNodes.length + selectedEdges.length + evidenceRefs + frontier.size > maxRows || evidenceRefs > maxEvidenceRefs) throw new CoordinationRefusal('causal trace exceeded deployment ceiling', 'causal_trace_oversize'); };
    while (queue.length > 0) {
      const current = queue.shift(); if (seenNodes.has(current.id)) continue; const node = nodeMap.get(current.id); if (!node) continue;
      seenNodes.add(current.id); frontier.delete(current.id); selectedNodes.push(node); evidenceRefs += (node.evidence?.length ?? 0); assertRows();
      const edges = incident.get(current.id) ?? [];
      if (current.depth >= maxDepth) { for (const edge of edges) { const next = edge.from === current.id ? edge.to : edge.from; if (!seenNodes.has(next)) frontier.add(next); } continue; }
      for (const edge of edges) {
        if (!seenEdges.has(edge.id)) { seenEdges.add(edge.id); selectedEdges.push(edge); evidenceRefs += (edge.evidence?.length ?? 0); assertRows(); }
        const next = edge.from === current.id ? edge.to : edge.from; if (!seenNodes.has(next)) queue.push({ id: next, depth: current.depth + 1 });
      }
    }
    for (const id of seenNodes) frontier.delete(id); assertRows();
    const safeNode = (node) => Object.fromEntries(['id', 'type', 'grounding', 'observedSeq', 'eventTimeSeq', 'validFrom', 'validTo', 'validityVersion'].filter((key) => Object.hasOwn(node, key)).map((key) => [key, clone(node[key])]));
    const safeEdge = (edge) => Object.fromEntries(['id', 'type', 'from', 'to', 'observedSeq', 'eventTimeSeq', 'validFrom', 'validTo', 'validityVersion', 'resolvedBy', 'winnerId', 'loserId'].filter((key) => Object.hasOwn(edge, key)).map((key) => [key, clone(edge[key])]));
    const evidence = [...selectedNodes, ...selectedEdges].flatMap((row) => (row.evidence ?? []).map((ref) => ({ ownerId: row.id, ...clone(ref) })));
    return freeze({ nodeId, observedSeq, observedAt: this.observationTime(observedSeq), complete: frontier.size === 0, frontier: [...frontier].sort(), nodes: selectedNodes.sort((a, b) => compareCanonicalStrings(a.id, b.id)).map(safeNode), edges: selectedEdges.sort((a, b) => compareCanonicalStrings(a.id, b.id)).map(safeEdge), evidence });
  }

  auditKnowledge(options = {}) { return coordinationLedger.auditKnowledge(this, options); }
}

/** Issue #290: the standalone repair verb for a store whose replay already refuses — the state a
 * poisoned older ledger leaves after a restart. It probes with the REAL startup path first: the
 * ledger that replays clean is refused by name. The entry is recorded durably beside the ledger
 * (never a hand edit of events.jsonl) and the deployment then restarts with the event's fold
 * skipped. seq must name exactly the seq the startup failure reported. */
export async function quarantineCoordinationLedgerEvent(root, { seq, reason, actor } = {}) {
  if (typeof root !== 'string' || root.length === 0 || root.includes('\0')) throw new TypeError('coordination quarantine root is invalid');
  if (!Number.isSafeInteger(seq) || seq <= 0) throw new TypeError('coordination quarantine requires a positive safe integer seq');
  if (typeof reason !== 'string' || reason.length === 0) throw new TypeError('coordination quarantine requires a non-empty reason');
  if (typeof actor !== 'string' || actor.length === 0) throw new TypeError('coordination quarantine requires a non-empty actor');
  const existing = coordinationReplay.quarantineEntries(root).find((entry) => entry.seq === seq);
  let failure = null;
  try {
    // The probe holds no writer lease (leases are claimed lazily on write) and performs no
    // writes; it exists to reproduce exactly the startup the deployment will attempt.
    new CoordinationStore(root);
  } catch (error) {
    failure = {
      code: error?.code ?? 'coordination_startup_failed',
      seq: error?.coordinationSeq ?? null,
      kind: error?.coordinationKind ?? null,
      message: error?.message ?? String(error),
    };
  }
  if (!failure) {
    throw Object.assign(new CoordinationRefusal(
      'coordination ledger replays clean — quarantine is not warranted; this verb only records a fold refusal an operator has already observed',
      'coordination_quarantine_replays_clean',
    ), { detail: { requestedSeq: seq } });
  }
  if (failure.seq !== seq) {
    throw Object.assign(new CoordinationRefusal(
      `coordination replay refuses at ${failure.seq === null ? 'an unsequenced failure' : `seq ${failure.seq}`} (${failure.code}), not seq ${seq}`,
      'coordination_quarantine_refused',
    ), { detail: { requestedSeq: seq, failureSeq: failure.seq, failureCode: failure.code } });
  }
  const probed = writeQuarantineEntry(root, freeze({
    schemaVersion: 1, seq, kind: failure.kind ?? 'unknown',
    causeCode: failure.code, reason, actor, ts: new Date().toISOString(),
  }));
  return { ok: true, result: probed.duplicate ? 'already-quarantined' : 'quarantined', entry: probed.entry };
}

/** Offline-only canonical-order compatibility cut. This acquires the same exclusive writer lease
 * as the live store, validates/replays the exact raw prefix, commits only the private receipt, and
 * never rewrites a coordination byte. It is intentionally absent from Coordinator/web/MCP. */
export function migrateCanonicalOrderLedger(root, options) {
  if (typeof root !== 'string' || root.length === 0 || root.includes('\0')) throw new TypeError('canonical-order migration root is invalid');
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some((key) => !['clock', 'migration', 'policy'].includes(key))
    || !options.policy || !options.migration || (options.clock !== undefined && typeof options.clock !== 'function')) {
    throw new TypeError('canonical-order offline migration options are invalid');
  }
  const policy = normalizeCanonicalOrderPolicy(options.policy);
  const migration = normalizeCanonicalOrderMigration(options.migration, policy);
  const store = new CoordinationStore(root, {
    canonicalOrderPolicy: policy,
    [CANONICAL_ORDER_MIGRATION]: migration,
    ...(options.clock ? { clock: options.clock } : {}),
  });
  store.claimWriterLease();
  try {
    const receipt = store.canonicalOrderReceipt();
    if (!receipt) throw new CoordinationRefusal('canonical-order migration did not commit a receipt', 'canonical_order_migration_invalid');
    return receipt;
  } finally { store.releaseWriterLease({ requireOwned: true }); }
}

/** Convenience for explicit hand-wired assemblies and tests. Production `createDriver()` still
 * chooses and owns the path itself; Coordinator never synthesizes an optional sidecar. */
export function coordinationForLog(log, root = join(log.dir, 'coordination')) {
  if (!log || typeof log.read !== 'function' || typeof log.dir !== 'string') throw new TypeError('coordinationForLog requires a durable Log');
  return new CoordinationStore(root, {
    operationalRead: (worker, seq) => log.read(worker, seq).find((event) => event.seq === seq) ?? null,
  });
}

/** Issue #351 lane 2: the loop-friendly open — a module-level factory beside the other
 * hand-wired assemblies, deliberately NOT an open-time member of the class census: the
 * constructor's synchronous load stays the store's one authoritative open. The replay runs
 * chunked at the registry's own `view.wake_replay.items` bound with a yield to the event loop
 * between chunks, so a startup heartbeat (and a signal handler) keeps beating however long the
 * history is. The returned store is fully loaded; every fold error rejects the promise. */
export async function openCoordinationStoreAsync(root, opts = {}) {
  const store = new CoordinationStore(root, { ...opts, deferLoad: true });
  await coordinationReplay._load(store, { async: true });
  return store;
}

/** Issue #351 lane 3: the same loop-friendly replay, driven on a store the caller constructed
 * (the production `createDriver` assembles the store with its own policy wiring, defers the
 * load, claims the writer lease, and awaits THIS). Every fold error rejects the promise — the
 * #304 replay-refusal contract, typed as ever, now from the async open. */
export async function loadCoordinationStoreAsync(store) {
  if (!(store instanceof CoordinationStore)) throw new TypeError('loadCoordinationStoreAsync requires a CoordinationStore');
  if (store._deferredLoad !== true) throw new TypeError('loadCoordinationStoreAsync requires a deferLoad-constructed store');
  await coordinationReplay._load(store, { async: true });
  // Issue #434: the projection now exists — appends are admitted and the ledger/projection
  // equality check (#331's reload) is live again.
  store._deferredLoad = false;
  return store;
}
