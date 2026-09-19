// coordination-ledger-writes.mjs — issue #259, slice 7. The store's effect bucket
// (seam-map §2/§5): the ledger-write authorities — writer lease, segment writes and compaction, the
// canonical-order receipt, the projection checkpoint write, the ledger-append verbs that mint durable
// rows, and the waits/reads the map's name rules classified effect. Every function is a verbatim
// CoordinationStore member body with the receiver made explicit (`store`); the class keeps a
// same-name, same-arity delegate per member. One-way: this module never imports the store.
//
// The recorder port (runtime-recorder-port.mjs, slice 6) carries THIS store as its coordination
// authority — these functions are the ledger-write authorities that port adapts, which is why they
// extract with their bodies unchanged: the recording surface (store._append, the fsynced file
// writes) is the seam, not a consumer of it.


import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  appendFileSync, chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync,
  readFileSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { join } from 'node:path';
import { serialize } from 'node:v8';
import {
  CANONICAL_ORDER_MIGRATION, canonicalJson, compareCanonicalStrings, normalizeCanonicalOrderMigration,
  normalizeCanonicalOrderPolicy,
} from './canonical-order.mjs';
import { normalizeContextProgramPolicy } from './context-program-policy.mjs';
import { normalizeGoalPlanPolicy } from './goal-plan.mjs';
import * as coordinationInternals from './coordination-internals.mjs';
import {
  CoordinationIntegrityError, CoordinationRefusal, MAX_SCRATCHPAD_SHARED_ENTRIES,
  MAX_SCRATCHPAD_WORKER_ENTRIES, PROJECTION_CHECKPOINT_FIELDS, SEGMENT_INDEX_FILE, boundedText,
  canonicalDigest, clone, freeze, sha256Bytes, validRunId,
} from './coordination-internals.mjs';
import { RUN_ORCHESTRATOR_REVOCATION_REASONS, normalizeRunLineagePolicy } from './run-lineage.mjs';
import { normalizeTaskTopologyPolicy } from './task-topology.mjs';
import { normalizeWorkflowPolicy } from './workflow-policy.mjs';


const CANONICAL_ORDER_RECEIPT = 'canonical-order-receipt.json';

const CANONICAL_ORDER_TEMP_PREFIX = '.canonical-order-receipt.';

const PROJECTION_CHECKPOINT = 'projection.checkpoint';

const PROJECTION_CHECKPOINT_TEMP_PREFIX = '.projection.checkpoint.';

const SEGMENT_TEMP_PREFIX = '.segment.';

const SEGMENT_INDEX_TEMP_PREFIX = '.segment-index.';

const LEDGER_TEMP_PREFIX = '.events.jsonl.';

const defaultLedgerSync = (file) => {
  const fd = openSync(file, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
};

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

function validRoutePolicy(policy) {
  const fields = ['mode', 'halfLifeMs', 'explorationConstant', 'seedDiscount', 'minSamplesForAdaptive', 'defaultPriorSuccessRate'];
  return policy && Object.keys(policy).sort().join(',') === fields.sort().join(',') && ['round-robin', 'adaptive', 'auto'].includes(policy.mode)
    && Number.isSafeInteger(policy.halfLifeMs) && policy.halfLifeMs > 0 && policy.halfLifeMs <= 10 * 365 * 24 * 60 * 60 * 1_000
    && Number.isFinite(policy.explorationConstant) && policy.explorationConstant > 0 && policy.explorationConstant <= 10
    && Number.isFinite(policy.seedDiscount) && policy.seedDiscount > 0 && policy.seedDiscount <= 1
    && Number.isSafeInteger(policy.minSamplesForAdaptive) && policy.minSamplesForAdaptive > 0 && policy.minSamplesForAdaptive <= 1_000_000
    && Number.isFinite(policy.defaultPriorSuccessRate) && policy.defaultPriorSuccessRate > 0 && policy.defaultPriorSuccessRate < 1;
}

// projection of the ledger (`_artifacts`, `_knowledgeNodes` and `_knowledgeReads` each grow only by
// an appended event, so none can exceed the ledger's event count) — the ledger is the physical
// resource, and a second literal ceiling on top of it refused operations the ledger had already
// accepted, including on replay, where it made a self-written ledger unloadable.
const REPRESENTATION_POLICY_FIELDS = [
  'maxArgumentBytes', 'maxEvidenceRefs', 'maxGraphBatchBytes', 'maxReceiptBytes',
  'maxResultBytes', 'maxResultItems', 'maxResultRefs', 'maxSourceRefBytes', 'maxSourceRefs', 'repoId', 'schemaVersion',
];

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

export function constructor(store, root, opts = {}) {
    store.root = root;
    // KG-3 rule 3/17: process-local, LRU-bounded, KG-fence-keyed preview cache. Never serialized
    // into the checkpoint (absent from PROJECTION_CHECKPOINT_FIELDS) — a preview is a pure function
    // of (projectFence, query, previewPolicy) and projectFence is derived from folded history, so
    // replay reconstructs the identical projection with no persisted cache.
    store._previewCache = new Map();
    store.file = join(root, 'events.jsonl');
    store._checkpointFile = join(root, PROJECTION_CHECKPOINT);
    store._startupProgress = opts.startupProgress ?? null;
    if (store._startupProgress !== null && typeof store._startupProgress !== 'function') {
      throw new TypeError('startupProgress must be a function');
    }
    store._checkpointInterval = opts.checkpointInterval ?? 256;
    if (!Number.isSafeInteger(store._checkpointInterval) || store._checkpointInterval < 16
      || store._checkpointInterval > 100_000) {
      throw new TypeError('checkpointInterval is invalid');
    }
    store._startupState = null;
    store._checkpointWriteFailure = null;
    // Issue #351: what the last clean release did with the projection checkpoint, and why. A
    // lifecycle path reports the skip instead of paying an unbounded main-thread serialization.
    store._checkpointRelease = null;
    // Issue #449: the open's own checkpoint facts — the rewrite it performed after a stale-shape
    // replay, and the temp files it swept. Both are reported through `startupStatus()`
    // non-enumerably, like #397's reason/detail, so the pinned enumerable shape stays exact.
    store._checkpointRewrite = null;
    store._checkpointSweep = null;
    // Issue #351: the resident's stop outcome, armed by the deployment that owns the stop and
    // minted by the release itself — see armHostStopOutcome.
    store._hostStopOutcome = null;
    store._canonicalOrderReceiptFile = join(root, CANONICAL_ORDER_RECEIPT);
    store._clock = opts.clock ?? (() => new Date().toISOString());
    if (opts.appendFile !== undefined && typeof opts.appendFile !== 'function') throw new TypeError('appendFile must be a function');
    store._appendFile = opts.appendFile ?? appendFileSync;
    // Issue #290: the ledger group-commit seam (default: one fsync of the ledger file per drain
    // tick), plus the sync's own state — a failed sync leaves the tail durable-unconfirmed and
    // the store refuses further writes until a restart re-verifies the bytes.
    if (opts.syncFile !== undefined && typeof opts.syncFile !== 'function') throw new TypeError('syncFile must be a function');
    store._syncFile = opts.syncFile ?? defaultLedgerSync;
    store._ledgerSyncScheduled = false;
    store._ledgerSyncFailure = null;
    store._appendWaiters = new Set();
    // Issue #483: this incarnation's own departure — the ONE fact a bounded wait torn down by a
    // stop or a reincarnation handoff needs. Folded from the deployment's own `host.*` rows on the
    // LIVE path only (a row replayed at open belongs to an incarnation that is already gone), and
    // deliberately NOT a projection-checkpoint field: it describes the process serving this store
    // NOW, so a checkpoint (cache of a replay) can never carry it into the next one.
    store._incarnationDeparture = null;
    store._incarnationHandoff = null;
    if (Object.hasOwn(opts, 'canonicalOrderMigration')) {
      throw new TypeError('canonical order migration is offline-only; use migrateCanonicalOrderLedger()');
    }
    store._canonicalOrderPolicy = opts.canonicalOrderPolicy === undefined
      ? null : normalizeCanonicalOrderPolicy(opts.canonicalOrderPolicy);
    store._canonicalOrderMigration = opts[CANONICAL_ORDER_MIGRATION] === undefined
      ? null : normalizeCanonicalOrderMigration(opts[CANONICAL_ORDER_MIGRATION], store._canonicalOrderPolicy);
    store._canonicalOrderReceipt = null;
    mkdirSync(root, { recursive: true });
    store._advisoryFeedCards = store._configureAdvisoryFeedCards(opts.advisoryFeedCards ?? []);
    store._advisoryReceiptReverify = opts.advisoryReceiptReverify ?? null;
    store._advisoryPollReverify = opts.advisoryPollReverify ?? null;
    store._providerAttemptPolicy = null;
    if (opts.providerAttemptPolicy !== undefined) {
      const policy = opts.providerAttemptPolicy; const fields = ['intervalMs', 'maxBatch', 'maxAttempts', 'initialBackoffMs', 'maxBackoffMs', 'maxStateRows'];
      if (!policy || Object.keys(policy).sort().join(',') !== fields.sort().join(',') || Object.values(policy).some((value) => !Number.isSafeInteger(value) || value <= 0)
        || policy.initialBackoffMs > policy.maxBackoffMs || policy.intervalMs > 24 * 60 * 60 * 1_000 || policy.maxBatch > 10_000 || policy.maxBatch > policy.maxStateRows || policy.maxAttempts > 1_000_000 || policy.maxBackoffMs > 24 * 60 * 60 * 1_000 || policy.maxStateRows > 1_000_000) throw new TypeError('provider attempt policy is invalid');
      store._providerAttemptPolicy = freeze(clone(policy));
    }
    // #286 G-41: the scratchpad partition ceilings are the deployment's own admitted bound, not a
    // bare literal — set `scratchpadPartitionPolicy` to raise them. The defaults are the documented
    // values (128 worker / 512 shared); they are ADMISSION bounds only, never replay validation, so
    // changing them cannot make an existing ledger unloadable.
    store._scratchpadPartitionPolicy = freeze({
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
      store._scratchpadPartitionPolicy = freeze(clone(policy));
    }
    store._routePolicy = null;
    if (opts.routePolicy !== undefined) {
      if (!validRoutePolicy(opts.routePolicy)) throw new TypeError('route learning policy is invalid');
      store._routePolicy = freeze(clone(opts.routePolicy));
    }
    store._representationPolicy = null;
    if (opts.representationPolicy !== undefined) {
      if (!validRepresentationPolicy(opts.representationPolicy)) throw new TypeError('representation policy is invalid');
      store._representationPolicy = freeze(clone(opts.representationPolicy));
    }
    store._goalPlanPolicy = null;
    if (opts.goalPlanPolicy !== undefined) {
      try { store._goalPlanPolicy = freeze(clone(normalizeGoalPlanPolicy(opts.goalPlanPolicy))); }
      catch (error) { throw new TypeError(error?.message ?? 'goal/plan policy is invalid'); }
    }
    try { store._workflowPolicy = normalizeWorkflowPolicy(opts.workflowPolicy); }
    catch (error) { throw new TypeError(error?.message ?? 'Workflow policy is invalid'); }
    store._contextProgramPolicy = null;
    store._deploymentBaseSha = opts.deploymentBaseSha ?? null;
    store._contextEnvironmentDigest = opts.contextEnvironmentDigest ?? null;
    store._contextReferenceIdentity = opts.contextReferenceIdentity ?? null;
    store._contextReferenceRead = opts.contextReferenceRead ?? null;
    store._contextSourceAttest = opts.contextSourceAttest ?? null;
    store._contextArtifactVerificationStorage = new AsyncLocalStorage();
    if (opts.contextProgramPolicy !== undefined) {
      try { store._contextProgramPolicy = normalizeContextProgramPolicy(opts.contextProgramPolicy); }
      catch (error) { throw new TypeError(error?.message ?? 'Context Program policy is invalid'); }
      if (!/^[a-f0-9]{40}$/u.test(store._deploymentBaseSha ?? '')
        || !/^[a-f0-9]{64}$/u.test(store._contextEnvironmentDigest ?? '')
        || !/^[a-f0-9]{64}$/u.test(store._contextReferenceIdentity ?? '')
        || typeof store._contextReferenceRead !== 'function'
        || typeof store._contextSourceAttest !== 'function') {
        throw new TypeError('Context Program authority requires one deployment tree, environment, and artifact resolver identity');
      }
    } else if (opts.contextEnvironmentDigest !== undefined
      || opts.contextReferenceIdentity !== undefined || opts.contextReferenceRead !== undefined
      || opts.contextSourceAttest !== undefined) {
      throw new TypeError('Context Program dependencies require Context Program policy');
    }
    store._repoId = opts.repoId ?? store._goalPlanPolicy?.repoId ?? null;
    if (store._repoId !== null && !validRunId(store._repoId)) {
      throw new TypeError('coordination repository identity is invalid');
    }
    if (store._goalPlanPolicy && store._repoId !== store._goalPlanPolicy.repoId) {
      throw new TypeError('coordination repository identity differs from goal/plan authority');
    }
    // Epic #81 (O-2): per-attempt constructive ceilings on orientation receipts/proposals — the
    // flood control that replaces the v1 maxScanEvents scan ceiling (a scan bound, not a write
    // bound). Checked BEFORE append; no clock participates (campaign law).
    store._orientationReceiptCeilings = null;
    if (opts.orientationReceiptCeilings !== undefined) {
      const c = opts.orientationReceiptCeilings;
      if (!c || typeof c !== 'object' || Array.isArray(c)
        || !Number.isSafeInteger(c.maxReceiptsPerAttempt) || c.maxReceiptsPerAttempt <= 0
        || !Number.isSafeInteger(c.maxReceiptBytesPerAttempt) || c.maxReceiptBytesPerAttempt <= 0
        || !Number.isSafeInteger(c.maxProposalsPerAttempt) || c.maxProposalsPerAttempt <= 0) {
        throw new TypeError('orientation receipt ceilings are invalid');
      }
      store._orientationReceiptCeilings = freeze(clone(c));
    }
    store._taskTopologyPolicy = opts.taskTopologyPolicy === undefined
      ? null : normalizeTaskTopologyPolicy(opts.taskTopologyPolicy);
    store._runLineagePolicy = opts.runLineagePolicy === undefined
      ? null : normalizeRunLineagePolicy(opts.runLineagePolicy);
    if (store._runLineagePolicy && store._repoId === null) {
      throw Object.assign(new TypeError('run lineage authority requires one deployment repository'), {
        code: 'run_lineage_policy_invalid',
      });
    }
    store._checkpointAuthorityDigest = canonicalDigest({
      schemaVersion: 1,
      repoId: store._repoId,
      advisoryFeedCards: [...store._advisoryFeedCards.values()]
        .map(({ card, cardDigest }) => ({ card, cardDigest }))
        .sort((left, right) => compareCanonicalStrings(left.card.providerId, right.card.providerId)),
      advisoryReceiptReverify: typeof store._advisoryReceiptReverify === 'function',
      advisoryPollReverify: typeof store._advisoryPollReverify === 'function',
      providerAttemptPolicy: store._providerAttemptPolicy,
      canonicalOrderPolicy: store._canonicalOrderPolicy,
      routePolicy: store._routePolicy,
      representationPolicy: store._representationPolicy,
      goalPlanPolicy: store._goalPlanPolicy,
      workflowPolicy: store._workflowPolicy,
      contextProgramPolicy: store._contextProgramPolicy,
      taskTopologyPolicy: store._taskTopologyPolicy,
      runLineagePolicy: store._runLineagePolicy,
      deploymentBaseSha: store._deploymentBaseSha,
      contextEnvironmentDigest: store._contextEnvironmentDigest,
      contextReferenceIdentity: store._contextReferenceIdentity,
    });
    // Issue #449(2): this build's projection shape — the digest of the sorted field list the
    // checkpoint's payload carries. It rides every envelope the store writes beside the commit that
    // served the write, and the restore compares it before it judges any shape-specific invariant,
    // so a checkpoint another build wrote is provably STALE (replay + rewrite) instead of being
    // reported as corruption (repair). Derived from PROJECTION_CHECKPOINT_FIELDS, the ONE field
    // list the durable payload is composed from — never a second declaration of it.
    store._projectionShapeDigest = createHash('sha256')
      .update([...PROJECTION_CHECKPOINT_FIELDS].sort().join(',')).digest('hex');
    store._resetProjection();
    if (opts.operationalRangeRead !== undefined && typeof opts.operationalRangeRead !== 'function') throw new TypeError('operationalRangeRead must be a function');
    store._operationalRead = opts.operationalRead ?? null;
    store._operationalRangeRead = opts.operationalRangeRead ?? null;
    store._writerLease = null;
    store._writerLeaseRequired = false;
    // #223: the in-memory segment index ({archivedThroughSeq, segments[]} or null) — ledger
    // metadata, NOT projection state. It records how much of the history lives in archived
    // content-addressed segments so the checkpoint can cache the live window only.
    store._segmentIndex = null;
    // Issue #351 lane 2: the chunked-yielding open. `deferLoad` leaves the projection unloaded
    // at construction; `openCoordinationStoreAsync` then drives the SAME replay through
    // `_loadAsync`, which offers the event loop a breath between chunks. The default
    // constructor load is untouched — every existing caller constructs loaded.
    if (opts.deferLoad === true) {
      if (store._canonicalOrderPolicy) throw new TypeError('deferLoad is unavailable under a canonical-order policy');
      // Issue #351 lane 3: remembered so claimWriterLease can skip the digest re-verification
      // of a projection that does not exist yet — the async load folds under the held lease.
      store._deferredLoad = true;
      return;
    }
    if (opts.deferLoad !== undefined) throw new TypeError('deferLoad must be true when provided');
    if (store._canonicalOrderPolicy) store._openCanonicalOrderLedger();
    else store._load();
  }

export function _cleanupCanonicalOrderTemps(store) {
    store._assertWriterLease();
    for (const name of readdirSync(store.root).filter((entry) => entry.startsWith(CANONICAL_ORDER_TEMP_PREFIX))) {
      try { unlinkSync(join(store.root, name)); } catch { store._canonicalOrderFail('canonical-order temporary receipt could not be removed'); }
    }
  }

export function _writeCanonicalReceipt(store, mode, ledger, cutPolicy = store._canonicalOrderPolicy) {
    store._assertWriterLease();
    store._cleanupCanonicalOrderTemps();
    const createdAt = store._clock();
    if (!Number.isFinite(Date.parse(createdAt)) || new Date(Date.parse(createdAt)).toISOString() !== createdAt) store._canonicalOrderFail('canonical-order receipt clock is invalid');
    const core = store._canonicalReceiptCore(mode, ledger, createdAt, cutPolicy);
    const receipt = { ...core, receiptDigest: sha256Bytes(Buffer.from(JSON.stringify(canonicalJson(core, { maxDepth: 16, maxNodes: 128 })), 'utf8')) };
    const bytes = store._receiptBytes(receipt);
    if (bytes.byteLength > store._canonicalOrderPolicy.maxReceiptBytes) store._canonicalOrderFail('canonical-order receipt exceeds its byte ceiling');
    const temp = join(store.root, `${CANONICAL_ORDER_TEMP_PREFIX}${randomUUID()}`);
    let fd = null;
    try {
      fd = openSync(temp, 'wx', 0o600); writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = null;
      renameSync(temp, store._canonicalOrderReceiptFile); chmodSync(store._canonicalOrderReceiptFile, 0o600);
      try { const rootFd = openSync(store.root, 'r'); try { fsyncSync(rootFd); } finally { closeSync(rootFd); } } catch { /* directory fsync is not supported on every host */ }
    } catch (error) {
      if (fd !== null) try { closeSync(fd); } catch { /* best effort after failed receipt write */ }
      try { unlinkSync(temp); } catch { /* rename may already have committed */ }
      throw error;
    }
    store._canonicalOrderReceipt = store._readCanonicalReceipt(ledger);
    return clone(store._canonicalOrderReceipt);
  }

export function *_projectionCheckpointWriteSteps(store, { costBound = null } = {}) {
    store._assertWriterLease();
    if (store._projectionPoison) return { written: false, bytes: 0, measured: false };
    // Each stretch below is a bounded step of its own — the ledger read and its digest, then each
    // `v8.serialize` (a large allocation on a real ledger), then the persist, then the durability
    // sync — so a caller that owns a loop never sees two of them in one stretch.
    const raw = existsSync(store.file) ? readFileSync(store.file) : Buffer.alloc(0);
    if (raw.byteLength > 0 && raw.at(-1) !== 0x0a) {
      throw new CoordinationIntegrityError('coordination stream has a truncated tail', 'truncated_tail');
    }
    if (!store._loadedLedgerIdentity
      || raw.byteLength !== store._loadedLedgerIdentity.bytes
      || sha256Bytes(raw) !== store._loadedLedgerIdentity.digest
      || store._events.length !== store._loadedLedgerIdentity.events) {
      throw new CoordinationIntegrityError(
        'coordination checkpoint refused because the ledger diverged from the loaded prefix',
        'coordination_checkpoint_ledger_drift',
      );
    }
    // The ledger is proven at the prefix the load folded; the encode that follows is its own step.
    yield;
    const payload = store._projectionCheckpointPayload();
    const projectionBytes = serialize(payload);
    // Issue #465(1): the byte breakdown is a READING of this one measurement — the same payload
    // object, put through the same `serialize` — never a second accounting that could disagree
    // with the ceiling above. Measured cost of the reading, on the clone's 288.87 MB projection
    // with 101 families: 0.26 s beside the 0.35 s the serialize itself costs. Issue #465(4): the two
    // families the body no longer carries are read off the store in O(1) (`_checkpointRebuiltFields`)
    // — the rows' own bytes are the ledger's, which is already in hand here.
    const windowCount = store._events.length - (store._segmentIndex?.archivedThroughSeq ?? 0);
    store._checkpointByteBreakdown = store._projectionByteBreakdown(payload, projectionBytes.byteLength, {
      rows: windowCount, bytes: raw.byteLength, keys: store._events.length,
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
      authorityDigest: store._checkpointAuthorityDigest,
      // Issue #449(2): the writer's own projection shape and the commit it served. A checkpoint
      // another build wrote is then STALE (its carried projection belongs to a different field set),
      // which the open answers with a full replay and a rewrite — never with the word 'corrupt',
      // whose remedy is a repair. Recorded here so the distinction is provable, not inferred.
      projectionShapeDigest: store._projectionShapeDigest,
      servedCommit: store._deploymentBaseSha ?? null,
      coversSeq: store._events.length,
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
    const temporary = join(store.root, `${PROJECTION_CHECKPOINT_TEMP_PREFIX}${randomUUID()}`);
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
      renameSync(temporary, store._checkpointFile);
      chmodSync(store._checkpointFile, 0o600);
      try {
        const rootFd = openSync(store.root, 'r');
        try { fsyncSync(rootFd); } finally { closeSync(rootFd); }
      } catch { /* directory fsync is unavailable on some supported hosts */ }
      store._checkpointWriteFailure = null;
      return { written: true, bytes: projectionBytes.byteLength, measured: true };
    } catch (error) {
      if (fd !== null) try { closeSync(fd); } catch { /* original write error wins */ }
      try { unlinkSync(temporary); } catch { /* rename or cleanup already completed */ }
      store._checkpointWriteFailure = freeze({
        code: typeof error?.code === 'string' ? error.code : 'checkpoint_write_failed',
      });
      throw Object.assign(new CoordinationRefusal(
        'coordination projection checkpoint could not be persisted',
        'coordination_checkpoint_write_failed',
      ), { cause: error });
    }
  }

export function _dropBorrowedWriterLease(store) {
    const lease = store._writerLease;
    if (lease === null) return;
    try {
      const observed = JSON.parse(readFileSync(lease.path, 'utf8'));
      if (observed?.token === lease.token && observed?.pid === process.pid
        && (observed.pidStart === undefined || observed.pidStart === lease.pidStart)) unlinkSync(lease.path);
    } catch { /* an absent or replaced lease is not this open's to remove */ }
    store._writerLease = null;
    store._writerLeaseRequired = false;
  }

export function _sweepProjectionCheckpointTemps(store) {
    const swept = [];
    for (const name of readdirSync(store.root).sort()) {
      if (!name.startsWith(PROJECTION_CHECKPOINT_TEMP_PREFIX)) continue;
      try { unlinkSync(join(store.root, name)); swept.push(name); }
      catch { /* a temp file another process holds is not this open's to remove */ }
    }
    return freeze(swept);
  }

export function claimWriterLease(store) {
    if (store._writerLease) throw new CoordinationRefusal('coordination writer is already active', 'coordination_writer_busy');
    const path = join(store.root, 'writer.lease'); const token = randomUUID(); const claimToken = randomUUID(); const claimPath = join(store.root, `writer.claim.${claimToken}`);
    const pidStart = writerProcessStartIdentity(process.pid);
    if (!pidStart) throw new CoordinationRefusal('coordination writer process identity is unavailable', 'coordination_writer_identity_unavailable');
    const payload = { schemaVersion: 2, pid: process.pid, pidStart, token, acquiredAt: store._clock() };
    const claim = () => writeFileSync(path, `${JSON.stringify(payload)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    writeFileSync(claimPath, `${JSON.stringify({ schemaVersion: 2, pid: process.pid, pidStart, token: claimToken, acquiredAt: store._clock() })}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    try {
      const liveClaims = [];
      for (const name of readdirSync(store.root).filter((item) => item.startsWith('writer.claim.')).sort()) {
        const candidatePath = join(store.root, name); let candidate;
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
    store._writerLease = freeze({ path, token, pid: process.pid, pidStart }); store._writerLeaseRequired = true;
    try {
      if (store._canonicalOrderPolicy) store._ensureCanonicalOrderReceipt();
      // Issue #351 lane 3: a deferred-load store folds its history later, under the lease this
      // call just claimed (the async open drives the same replay between chunks) — the digest
      // re-verification below applies only once a load has actually folded the ledger.
      if (!store._deferredLoad && !store._ledgerMatchesLoadedProjection()) store._reloadProjection();
    } catch (error) { store.releaseWriterLease(); throw error; }
    return clone(store._writerLease);
  }

export function releaseWriterLease(store, options = undefined) {
    if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(options).sort().join(',') !== 'requireOwned' || typeof options.requireOwned !== 'boolean')) {
      throw new TypeError('writer lease release options are invalid');
    }
    const requireOwned = options?.requireOwned === true;
    const lease = store._writerLease; if (!lease) return false;
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
      if (store._ledgerSyncScheduled) {
        store._ledgerSyncScheduled = false;
        store._flushLedgerSync();
      }
      store._releaseProjectionCheckpoint();
      // #351: the resident's stop outcome, minted while the writer authority the row needs is still
      // held — the release IS the converged stop, and the checkpoint decision travels with it.
      store._mintHostStopOutcome();
      try { unlinkSync(lease.path); }
      catch { throw new CoordinationRefusal('coordination writer lease could not be released', 'coordination_writer_lost'); }
      if (existsSync(lease.path)) throw new CoordinationRefusal('coordination writer lease release was not exact', 'coordination_writer_lost');
      store._writerLease = null; return true;
    }
    // Issue #290: the same flush on the non-owned release path.
    if (store._ledgerSyncScheduled) {
      store._ledgerSyncScheduled = false;
      store._flushLedgerSync();
    }
    store._releaseProjectionCheckpoint();
    try {
      const observed = JSON.parse(readFileSync(lease.path, 'utf8'));
      if (observed?.token === lease.token && observed?.pid === process.pid
        && (observed.pidStart === undefined || observed.pidStart === lease.pidStart)) unlinkSync(lease.path);
    }
    catch { /* absent or replaced lease is not ours to remove */ }
    store._writerLease = null; return true;
  }

export function _cleanupSegmentTemps(store) {
    const dir = store._segmentDirectory();
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (!name.startsWith(SEGMENT_TEMP_PREFIX) && !name.startsWith(SEGMENT_INDEX_TEMP_PREFIX)) continue;
      try { unlinkSync(join(dir, name)); }
      catch { throw new CoordinationRefusal('coordination segment temporary could not be removed', 'coordination_segment_write_failed'); }
    }
  }

export function _writeSegment(store, digest, bytes) {
    const dir = store._segmentDirectory();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = store._segmentFilePath(digest);
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

export function _writeSegmentIndex(store, index) {
    const dir = store._segmentDirectory();
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

export function compact(store, { beforeSeq }) {
    store._assertWriterLease();
    if (store._canonicalOrderPolicy) {
      throw new CoordinationRefusal('coordination compaction is refused while the ledger is canonical-order pinned', 'coordination_compact_refused');
    }
    if (!Number.isSafeInteger(beforeSeq) || beforeSeq < 2 || beforeSeq > store._events.length + 1) {
      throw new CoordinationRefusal('coordination compaction cut is outside the ledger', 'coordination_compact_invalid');
    }
    const prior = store._segmentIndex;
    const archivedThroughSeq = beforeSeq - 1;
    const startSeq = (prior?.archivedThroughSeq ?? 0) + 1;
    if (startSeq > archivedThroughSeq) return null; // the requested prefix is already archived
    const raw = existsSync(store.file) ? readFileSync(store.file) : Buffer.alloc(0);
    if (!store._loadedLedgerIdentity
      || raw.byteLength !== store._loadedLedgerIdentity.bytes
      || sha256Bytes(raw) !== store._loadedLedgerIdentity.digest
      || store._events.length !== store._loadedLedgerIdentity.events) {
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
    store._cleanupSegmentTemps();
    store._writeSegment(digest, segmentBytes);
    const next = {
      schemaVersion: 1,
      archivedThroughSeq,
      segments: [...(prior?.segments ?? []), { fromSeq: startSeq, throughSeq: archivedThroughSeq, digest, bytes: segmentBytes.byteLength }],
    };
    store._writeSegmentIndex(next);
    const windowBytes = Buffer.from(windowLines.length === 0 ? '' : `${windowLines.join('\n')}\n`, 'utf8');
    const temporary = join(store.root, `${LEDGER_TEMP_PREFIX}${randomUUID()}`);
    let fd = null;
    try {
      fd = openSync(temporary, 'wx', 0o600);
      writeFileSync(fd, windowBytes);
      fsyncSync(fd);
      closeSync(fd); fd = null;
      renameSync(temporary, store.file);
      chmodSync(store.file, 0o600);
      try { const rootFd = openSync(store.root, 'r'); try { fsyncSync(rootFd); } finally { closeSync(rootFd); } } catch { /* directory fsync is unavailable on some supported hosts */ }
    } catch (error) {
      if (fd !== null) try { closeSync(fd); } catch { /* original write error wins */ }
      try { unlinkSync(temporary); } catch { /* rename or cleanup already completed */ }
      throw error;
    }
    store._segmentIndex = next;
    // The ledger identity now tracks the LIVE WINDOW bytes (appends keep extending it); the
    // event count stays the full global history so seq allocation never regresses.
    store._loadedLedgerHash = createHash('sha256').update(windowBytes);
    store._loadedLedgerIdentity = freeze({
      bytes: windowBytes.byteLength,
      digest: store._loadedLedgerHash.copy().digest('hex'),
      events: store._events.length,
    });
    store._writeProjectionCheckpoint();
    return freeze({
      schemaVersion: 1, beforeSeq, archivedThroughSeq,
      windowEvents: store._events.length - archivedThroughSeq,
      segment: { fromSeq: startSeq, throughSeq: archivedThroughSeq, digest, bytes: segmentBytes.byteLength },
      segments: next.segments.length,
      ledgerBytes: windowBytes.byteLength,
    });
  }

export function revokeRunOrchestratorLease(store, fields, auth) {
    const expected = ['leaseDigest', 'leaseId', 'reason', 'schemaVersion'];
    if (!fields || Object.keys(fields).sort().join(',') !== expected.sort().join(',')
      || fields.schemaVersion !== 1 || !boundedText(fields.leaseId, 512)
      || !/^[a-f0-9]{64}$/.test(fields.leaseDigest ?? '')
      || !RUN_ORCHESTRATOR_REVOCATION_REASONS.includes(fields.reason)
      || !store._isRunOrchestratorLeaseRevokeKey(auth?.key, fields.leaseId)
      || !boundedText(auth?.actor, 256)) {
      store._runLineageFailure('run orchestrator lease revocation request is invalid', 'run_orchestrator_lease_invalid');
    }
    const core = clone(fields);
    const payload = freeze({ ...core, revocationDigest: canonicalDigest(core) });
    const prior = store._byKey.get(auth.key);
    if (prior) {
      if (prior.kind !== 'run.orchestrator_lease_revoked' || prior.actor !== auth.actor
        || canonicalDigest(prior.payload) !== canonicalDigest(payload)) {
        store._runLineageFailure('run orchestrator lease revocation conflict', 'run_orchestrator_lease_conflict');
      }
      return freeze({ ok: true, result: 'replay', event: clone(prior), lease: store.runOrchestratorLease(fields.leaseId) });
    }
    const preview = { seq: store._events.length + 1, actor: auth.actor, idempotencyKey: auth.key, payload };
    store._validateRunOrchestratorLeaseRevoked(payload, preview);
    const event = store._append('run.orchestrator_lease_revoked', payload, auth);
    return freeze({ ok: true, result: 'revoked', event: clone(event), lease: store.runOrchestratorLease(fields.leaseId) });
  }

export function waitAfter(store, afterSeq, timeoutMs, options = {}) {
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0 || afterSeq > store._events.length
      || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0
      || !options || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(options).some((key) => key !== 'signal')
      || (options.signal !== undefined && !(options.signal instanceof AbortSignal))) {
      throw new TypeError('coordination wait requires a current cursor, positive timeout, and optional AbortSignal');
    }
    if (store._events.length > afterSeq) {
      return Promise.resolve(freeze({ advanced: true, upperBound: store._events.length }));
    }
    if (options.signal?.aborted) {
      return Promise.reject(Object.assign(new Error('coordination wait aborted'), { code: 'coordination_wait_aborted' }));
    }
    return new Promise((resolve, reject) => {
      let timer = null;
      const onAbort = () => finish(null, Object.assign(new Error('coordination wait aborted'), { code: 'coordination_wait_aborted' }));
      const waiter = {
        afterSeq,
        finish: (advanced) => finish(freeze({ advanced, upperBound: store._events.length })),
      };
      const finish = (value, error = null) => {
        if (!store._appendWaiters.delete(waiter)) return;
        if (timer !== null) clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        if (error) reject(error); else resolve(value);
      };
      store._appendWaiters.add(waiter);
      options.signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => finish(freeze({ advanced: false, upperBound: store._events.length })), timeoutMs);
      if (store._events.length > afterSeq) waiter.finish(true);
    });
  }

export function attachContextPackage(store, fields, auth) {
    const prior = store._byKey.get(auth?.key);
    if (prior) {
      if (prior.kind !== 'package.attached'
        || canonicalDigest(prior.payload) !== canonicalDigest(fields)) {
        throw new CoordinationRefusal('context package attachment idempotency content changed',
          'board_replay_conflict');
      }
      return {
        ok: true, result: 'idempotent', event: clone(prior),
        attachment: store._contextPackageAttachmentView(prior),
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
    if (!store._contextPackages.has(fields.packageDigest)) {
      throw new CoordinationRefusal('Context package is unavailable', 'context_package_not_found');
    }
    const payload = { packageDigest: fields.packageDigest, runId: fields.runId, scope: fields.scope };
    const event = store._append('package.attached', payload, auth);
    return {
      ok: true, result: 'attached', event: clone(event),
      attachment: store._contextPackageAttachmentView(event),
    };
  }

export function revokeTaskAcceptance(store, fields, auth) {
    const request = store._acceptanceRevocationRequest(fields, auth);
    const requestDigest = canonicalDigest({ actor: auth.actor, idempotencyKey: auth.key, request });
    const prior = store._byKey.get(auth.key);
    if (prior) {
      const core = Object.fromEntries(Object.entries(prior.payload ?? {}).filter(([key]) => key !== 'receiptDigest'));
      if (prior.kind !== 'task.acceptance_revoked' || prior.actor !== auth.actor
        || prior.payload?.requestDigest !== requestDigest || prior.payload?.receiptDigest !== canonicalDigest(core)) {
        throw new CoordinationRefusal('task acceptance revocation idempotency conflict', 'acceptance_revocation_conflict');
      }
      return freeze({
        ok: true, result: 'idempotent', event: clone(prior), task: store.task(request.taskId),
        artifacts: prior.payload.artifactTargets.map((target) => store.artifact(target.artifactId)),
        knowledgeNodes: prior.payload.knowledgeTargets.map((target) => clone(store._knowledgeNodes.get(target.nodeId))),
      });
    }
    const task = store._tasks.get(request.taskId);
    if (!task || task.status !== 'completed' || task.version !== request.expectedTaskVersion) {
      const code = task && task.version !== request.expectedTaskVersion ? 'stale_version' : 'acceptance_revocation_unavailable';
      throw new CoordinationRefusal('task acceptance revocation requires the exact completed task version', code);
    }
    const evidence = store._acceptanceRevocationEvidence(task, request.evidence.coordinationSeq);
    const targets = store._acceptanceRevocationTargets(task, evidence.coordinationSeq);
    const core = {
      schemaVersion: 1, requestDigest, taskId: request.taskId, expectedTaskVersion: request.expectedTaskVersion,
      newTaskVersion: request.expectedTaskVersion + 1, evidence, ...targets,
    };
    const payload = { ...core, receiptDigest: canonicalDigest(core) };
    const fixedTs = store._clock();
    const prospective = { schemaVersion: 1, seq: store._events.length + 1, ts: fixedTs, kind: 'task.acceptance_revoked', actor: auth.actor, idempotencyKey: auth.key, payload };
    store._validateAcceptanceRevocationPayload(payload, prospective, false);
    const event = store._append('task.acceptance_revoked', payload, auth, fixedTs);
    return freeze({
      ok: true, result: 'revoked', event: clone(event), task: store.task(request.taskId),
      artifacts: targets.artifactTargets.map((target) => store.artifact(target.artifactId)),
      knowledgeNodes: targets.knowledgeTargets.map((target) => clone(store._knowledgeNodes.get(target.nodeId))),
    });
  }

export function materializeContextPack(store, packId) {
    const pack = store._contextPacks.get(packId);
    if (!pack) throw new CoordinationRefusal('context pack was not found', 'context_pack_not_found');
    if (Date.parse(store._clock()) >= Date.parse(pack.validity)) {
      throw new CoordinationRefusal('context pack has expired', 'context_pack_expired');
    }
    return freeze({ packId: pack.packId, family: pack.family, body: pack.body });
  }

export function materializeSpill(store, spillId) {
    const spill = store._resolvedSpill(spillId);
    return spill === null
      ? null
      : { spillId: spill.spillId, digest: spill.digest, bytes: spill.bytes, body: spill.body };
  }

export function grantContextPack(store, fields, auth) {
    const event = store._append('context.pack_granted', clone(fields), auth);
    return { ok: true, result: 'granted', event: clone(event) };
  }

export function proposeOrientationCandidate(store, { leafDigest, packDigest }, auth) {
    if (!/^[a-f0-9]{64}$/.test(leafDigest ?? '') || !/^[a-f0-9]{64}$/.test(packDigest ?? '')) {
      throw new CoordinationRefusal('orientation candidate leaf is invalid', 'orientation_propose_refused');
    }
    const workerId = typeof auth?.actor === 'string' && auth.actor.startsWith('worker:') ? auth.actor.slice('worker:'.length) : null;
    const source = store._orientationLatestSource();
    // #286 G-45: one fold lookup replaces the per-proposal ledger scan (at least one receipt for
    // this worker is exactly "the latest-receipt fold has this worker").
    const hasReceipt = store._orientationWorkerFreshness(workerId) !== null;
    if (!source && !hasReceipt) throw new CoordinationRefusal('orientation candidate was not received by the attempt', 'orientation_propose_refused');
    const freshnessDigest = source?.freshnessDigest ?? store._orientationWorkerFreshness(workerId) ?? '0'.repeat(64);
    const existing = store._orientationCandidate(leafDigest, freshnessDigest);
    if (existing) return { ok: true, result: 'idempotent', node: clone(existing) };
    store._assertOrientationProposalCeiling(workerId);
    const candidateId = `orientation:candidate:${canonicalDigest({ freshnessDigest, leafDigest })}`;
    const result = store.addKnowledgeNode({
      body: `orientation overlay candidate leaf ${leafDigest.slice(0, 12)}`, evidence: [],
      freshnessDigest, grounding: 'observed', id: candidateId, leafDigest, packDigest,
      promotion: { kind: 'Finding', trigger: 'orientation.overlay_proposed' }, type: 'Finding', workerId,
    }, auth);
    if (source) {
      try { store.addKnowledgeEdge({ evidence: [], from: candidateId, id: `knowledge-edge:cites:${candidateId}`, to: source.id, type: 'Cites' }, { actor: auth.actor, key: `${auth.key}:cites` }); }
      catch { /* the Cites edge is best-effort over the observed candidate */ }
    }
    return { ok: true, result: 'minted', node: clone(result.node) };
  }

export function _orientationLatestSource(store) {
    const sources = store.queryKnowledge({ types: ['Source'] }).sort((a, b) => (b.observedSeq ?? 0) - (a.observedSeq ?? 0));
    return sources[0] ?? null;
  }

export function orientationReadLatest(store, workerId) {
    return coordinationInternals.orientationReadLatest(store._contextReadLatest, workerId);
  }

export function _orientationWorkerFreshness(store, workerId) {
    return store.orientationReadLatest(workerId)?.freshnessDigest ?? null;
  }

export function orientationReadHead(store, workerId, packDigest) {
    return coordinationInternals.orientationReadHead(store._contextReadHeads, workerId, packDigest);
  }

export function _orientationCandidate(store, leafDigest, freshnessDigest) {
    return store.queryKnowledge({ types: ['Finding'] }).find((node) => node.promotion?.trigger === 'orientation.overlay_proposed'
      && node.leafDigest === leafDigest && node.freshnessDigest === freshnessDigest) ?? null;
  }

export function revokeBoardGrants(store, { workerId = null, taskId = null, cause = null, reason = null }, auth) {
    if (auth == null || typeof auth?.key !== 'string' || typeof auth?.actor !== 'string') {
      throw new TypeError('grant revocation requires explicit actor and idempotencyKey');
    }
    const causeText = reason ?? cause ?? 'lifecycle';
    const revoked = [];
    for (const grant of store.activeBoardGrants({ workerId, taskId })) {
      if (grant.state !== 'active') continue;
      const payload = { grantId: grant.grantId, board: grant.board, workerId: grant.workerId, taskId: grant.taskId, cause: causeText };
      const revokeKey = `${auth.key}:${grant.grantId}`;
      const prior = store._byKey.get(revokeKey) ?? null;
      if (prior && prior.kind === 'board.grant_revoked' && prior.payload?.grantId === grant.grantId) {
        revoked.push({ grantId: grant.grantId, result: 'idempotent', event: clone(prior) });
        continue;
      }
      const event = store._append('board.grant_revoked', payload, {
        actor: auth.actor, key: revokeKey,
      });
      revoked.push({ grantId: grant.grantId, result: 'revoked', event: clone(event) });
    }
    return { ok: true, revoked };
  }

