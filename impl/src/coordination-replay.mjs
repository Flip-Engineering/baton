// coordination-replay.mjs — issue #259, slice 1: the CoordinationStore restart seam.
//
// Every member here is a named replay/reconcile/recovery/startup path: it decides what a fresh process
// does with a prior process's durable state. The port is explicit — a path that reads the store takes it
// as its first parameter and names it `store`, and the validators that read no state take only their own
// arguments. None is bound to an implicit receiver and none reads module-level mutable state. Sibling
// replay paths call each other in this module; the store's own non-recovery members are reached as
// `store.<member>`.
//
// Moved verbatim from coordination-store.mjs: no behavior change, no renamed member, and every durable
// format, digest, and idempotency key is byte-identical. The store keeps the same method names as
// one-line delegates, so every call site is untouched.

import { compareCanonicalStrings } from './canonical-order.mjs';
import { goalPlanDigest, planBriefMatches } from './goal-plan.mjs';
import { normalizeRecoveryAttemptAdmission, normalizeRecoveryAttemptCompletion } from './recovery-attempt.mjs';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  COORDINATION_QUARANTINE_FILE,
  CoordinationIntegrityError, CoordinationRefusal, MAX_SCRATCHPAD_STOP_PARTITIONS_PER_PASS,
  SEGMENT_FILE_SUFFIX, SEGMENT_INDEX_FILE, TERMINAL, canonical, canonicalDigest, clone, digest,
  freeze, scratchpadScopeKey, sha256Bytes, validRunId,
} from './coordination-internals.mjs';

// ── the store's restart paths ───────────────────────────────────────────────────────────────────

/** Moved from `CoordinationStore._readCanonicalReceipt` (issue #259 slice 1). State: the store, passed explicitly. */
export function _readCanonicalReceipt(store, ledger = store._readCanonicalLedger()) {
  if (!existsSync(store._canonicalOrderReceiptFile)) return null;
  let stat;
  try { stat = lstatSync(store._canonicalOrderReceiptFile); }
  catch { store._canonicalOrderFail('canonical-order receipt is unavailable'); }
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > store._canonicalOrderPolicy.maxReceiptBytes) {
    store._canonicalOrderFail('canonical-order receipt path or size is invalid');
  }
  const bytes = readFileSync(store._canonicalOrderReceiptFile);
  let receipt;
  try { receipt = JSON.parse(bytes.toString('utf8')); }
  catch { store._canonicalOrderFail('canonical-order receipt is invalid JSON'); }
  return store._validateCanonicalReceipt(receipt, bytes, ledger);
}

/** Moved from `CoordinationStore._openCanonicalOrderLedger` (issue #259 slice 1). State: the store, passed explicitly. */
export function _openCanonicalOrderLedger(store) {
  const ledger = store._readCanonicalLedger();
  const receipt = _readCanonicalReceipt(store, ledger);
  if (receipt) {
    store._canonicalOrderReceipt = receipt;
    _load(store);
    return;
  }
  if (ledger.raw.byteLength === 0) {
    if (!store._canonicalOrderMigration) _load(store);
    return;
  }
  if (store._canonicalOrderMigration) return;
  store._canonicalOrderFail('non-empty coordination history requires explicit canonical-order adoption', 'canonical_order_migration_required');
}

/** Moved from `CoordinationStore._ensureCanonicalOrderReceipt` (issue #259 slice 1). State: the store, passed explicitly. */
export function _ensureCanonicalOrderReceipt(store) {
  if (!store._canonicalOrderPolicy) return null;
  store._assertWriterLease();
  const ledger = store._readCanonicalLedger();
  const current = _readCanonicalReceipt(store, ledger);
  if (current) {
    if (store._canonicalOrderMigration) {
      const migration = store._canonicalOrderMigration;
      const expectedMode = migration.mode === 'reset_empty' ? 'empty_bootstrap' : 'adopt_compatible';
      const requestedCut = Object.fromEntries(['maxEventBytes', 'maxEvents', 'maxLedgerBytes', 'maxReceiptBytes'].map((key) => [key, migration[key]]));
      if (current.mode !== expectedMode
        || canonicalDigest(current.cutPolicy) !== canonicalDigest(requestedCut)
        || (migration.mode === 'adopt_compatible' && (current.prefixDigest !== migration.expectedPrefixDigest || current.throughSeq !== migration.expectedEvents))) {
        store._canonicalOrderFail('canonical-order migration conflicts with the existing receipt', 'canonical_order_migration_invalid');
      }
    }
    store._canonicalOrderReceipt = current; return clone(current);
  }
  if (store._canonicalOrderMigration) {
    const migration = store._canonicalOrderMigration;
    if (Object.keys(migration).filter((key) => key !== 'mode' && !key.startsWith('expected')).some((key) => migration[key] > store._canonicalOrderPolicy[key])) {
      store._canonicalOrderFail('canonical-order migration exceeds deployment authority', 'canonical_order_migration_invalid');
    }
    if (migration.mode === 'reset_empty') {
      if (ledger.raw.byteLength !== 0 || ledger.events.length !== 0) store._canonicalOrderFail('canonical-order reset requires a newly selected empty ledger', 'canonical_order_migration_invalid');
      const cutPolicy = Object.fromEntries(['maxEventBytes', 'maxEvents', 'maxLedgerBytes', 'maxReceiptBytes'].map((key) => [key, migration[key]]));
      return store._writeCanonicalReceipt('empty_bootstrap', ledger, cutPolicy);
    }
    if (ledger.raw.byteLength === 0 || ledger.events.length !== migration.expectedEvents
      || sha256Bytes(ledger.raw) !== migration.expectedPrefixDigest) {
      store._canonicalOrderFail('canonical-order adoption identity differs from the ledger', 'canonical_order_migration_invalid');
    }
    store._resetProjection(); _load(store);
    const cutPolicy = Object.fromEntries(['maxEventBytes', 'maxEvents', 'maxLedgerBytes', 'maxReceiptBytes'].map((key) => [key, migration[key]]));
    return store._writeCanonicalReceipt('adopt_compatible', ledger, cutPolicy);
  }
  if (ledger.raw.byteLength !== 0) store._canonicalOrderFail('non-empty coordination history requires explicit canonical-order adoption', 'canonical_order_migration_required');
  return store._writeCanonicalReceipt('empty_bootstrap', ledger);
}

/** Moved from `CoordinationStore._reportStartup` (issue #259 slice 1). State: the store, passed explicitly. */
export function _reportStartup(store, value) {
  store._startupState = freeze(clone(value));
  if (store._startupProgress) {
    try { store._startupProgress(clone(store._startupState)); }
    catch { /* progress observation never becomes coordination authority */ }
  }
}

/** Moved from `CoordinationStore.startupStatus` (issue #259 slice 1). State: the store, passed explicitly. */
export function startupStatus(store) {
  const state = store._startupState ?? {
    schemaVersion: 1, state: 'starting', source: 'ledger', totalEvents: 0,
    checkpointEvents: 0, replayedEvents: 0, checkpoint: 'unchecked', failure: null,
  };
  // Issue #290: a live projection poison and the quarantine ledger are startup truth — both are
  // composed here at read time so a poisoned store's readers see the poison alongside the
  // startup state instead of served projections that quietly contradict eventCursor().
  return clone({
    ...state,
    poison: store._projectionPoison ?? null,
    quarantined: store._quarantine instanceof Map
      ? [...store._quarantine.keys()].sort((left, right) => left - right) : [],
  });
}

/** Moved from `CoordinationStore._reloadProjection` (issue #259 slice 1). State: the store, passed explicitly. */
export function _reloadProjection(store) { store._resetProjection(); _load(store); }

// ── the quarantine ledger (#290) ────────────────────────────────────────────────────────────────
//
// A fold-refused event is durable but must never make the store unreplayable. The quarantine
// ledger names such seqs; replay skips exactly those folds while the ledger bytes stay parsed
// (sequence contiguity, idempotent-retry adjudication, and checkpoint byte-equality all hold).
// It is written only through the supported repair verbs, atomically and fsynced like every
// other housekeeping artifact — never by editing events.jsonl.

function quarantineEntryProblem(entry) {
  const keys = ['actor', 'causeCode', 'kind', 'reason', 'schemaVersion', 'seq', 'ts'];
  return !entry || typeof entry !== 'object' || Array.isArray(entry)
    || Object.keys(entry).sort().join(',') !== keys.sort().join(',')
    || entry.schemaVersion !== 1
    || !Number.isSafeInteger(entry.seq) || entry.seq <= 0
    || typeof entry.kind !== 'string' || entry.kind.length === 0
    || typeof entry.causeCode !== 'string' || entry.causeCode.length === 0
    || typeof entry.reason !== 'string' || entry.reason.length === 0
    || typeof entry.actor !== 'string' || entry.actor.length === 0
    || !Number.isFinite(Date.parse(entry.ts));
}

/** Read and validate the durable quarantine entries for a coordination root. A malformed
 * quarantine ledger refuses startup typed: silently ignoring it would replay a fold the
 * deployment has already refused once. This is the module's ONE quarantine export — the store
 * reaches it through its `quarantineEntries()` delegate, and the loader below keeps it
 * module-local. */
export function quarantineEntries(root) {
  const file = join(root, COORDINATION_QUARANTINE_FILE);
  if (!existsSync(file)) return [];
  let parsed = null;
  try { parsed = JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new CoordinationIntegrityError('coordination quarantine ledger is not valid JSON', 'coordination_quarantine_invalid'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)
    || Object.keys(parsed).sort().join(',') !== 'entries,schemaVersion') {
    throw new CoordinationIntegrityError('coordination quarantine ledger is invalid', 'coordination_quarantine_invalid');
  }
  const seen = new Set();
  for (const entry of parsed.entries) {
    if (quarantineEntryProblem(entry) || seen.has(entry.seq)) {
      throw new CoordinationIntegrityError('coordination quarantine ledger is invalid', 'coordination_quarantine_invalid');
    }
    seen.add(entry.seq);
  }
  return clone(parsed.entries).sort((left, right) => left.seq - right.seq);
}

/** Load the quarantine map a replay folds against. Called once at the start of every load. */
function loadQuarantine(store) {
  const entries = quarantineEntries(store.root);
  store._quarantine = new Map(entries.map((entry) => [entry.seq, freeze(entry)]));
  return store._quarantine;
}

/** Moved from `CoordinationStore._loadSegmentState` (issue #259 slice 1). State: the store, passed explicitly. */
export function _loadSegmentState(store, raw) {
  const dir = store._segmentDirectory();
  const indexFile = join(dir, SEGMENT_INDEX_FILE);
  let index = null;
  if (existsSync(indexFile)) {
    // The index is a CACHE over immutable segment files: a malformed index must never
    // brick startup — it falls through to the scan-rebuild path, which verifies the
    // actual segment content (digests, ranges) and reconstructs the coverage.
    let parsed = null;
    try { parsed = JSON.parse(readFileSync(indexFile, 'utf8')); } catch { /* malformed index → rebuild */ }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && parsed.schemaVersion === 1
      && Number.isSafeInteger(parsed.archivedThroughSeq) && parsed.archivedThroughSeq >= 0
      && Array.isArray(parsed.segments)) {
      let expected = 1;
      let valid = true;
      for (const segment of parsed.segments) {
        if (!segment || typeof segment !== 'object' || Array.isArray(segment)
          || !Number.isSafeInteger(segment.fromSeq) || !Number.isSafeInteger(segment.throughSeq)
          || segment.throughSeq < segment.fromSeq || segment.fromSeq !== expected
          || typeof segment.digest !== 'string' || !/^[a-f0-9]{64}$/u.test(segment.digest)
          || !Number.isSafeInteger(segment.bytes) || segment.bytes < 0) {
          valid = false; break;
        }
        expected = segment.throughSeq + 1;
      }
      if (valid && expected === parsed.archivedThroughSeq + 1) index = parsed;
    }
  }
  // The first live event seq anchors what the LEDGER itself covers.
  let firstSeq = null;
  if (raw.byteLength > 0) {
    const newline = raw.indexOf(0x0a);
    if (newline < 0) throw new CoordinationIntegrityError('coordination stream has a truncated tail', 'truncated_tail');
    let first;
    try { first = JSON.parse(raw.subarray(0, newline).toString('utf8')); }
    catch { throw new CoordinationIntegrityError('invalid JSON at coordination line 1', 'invalid_json'); }
    firstSeq = first?.seq;
    if (!Number.isSafeInteger(firstSeq) || firstSeq <= 0) {
      throw new CoordinationIntegrityError('coordination sequence gap at line 1', 'sequence_gap');
    }
  }
  // A ledger that still starts at seq 1 IS the complete history — no archived prefix is
  // required, and any on-disk index is a compaction whose ledger rewrite has not committed
  // (the next compaction self-heals it).
  if (firstSeq === 1) return { archivedThroughSeq: 0, segments: [] };
  // A consistent index (archived prefix + window == full history) is trusted; replay still
  // verifies every segment file's digest as it reads it.
  if (index !== null && (firstSeq === null || firstSeq === index.archivedThroughSeq + 1)) {
    return index;
  }
  // The index is absent or behind the ledger's truncation (a crash between the ledger
  // rewrite and the index write): rebuild from the immutable segment files.
  const segments = [];
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith(SEGMENT_FILE_SUFFIX) || !/^[a-f0-9]{64}\.jsonl$/u.test(name)) continue;
      const bytes = readFileSync(join(dir, name));
      if (sha256Bytes(bytes) !== name.slice(0, 64)) {
        throw new CoordinationIntegrityError('coordination segment digest mismatch', 'coordination_segment_integrity');
      }
      const text = bytes.toString('utf8');
      if (!Buffer.from(text, 'utf8').equals(bytes)) {
        throw new CoordinationIntegrityError('coordination segment is not exact UTF-8', 'invalid_utf8');
      }
      if (bytes.byteLength > 0 && bytes.at(-1) !== 0x0a) {
        throw new CoordinationIntegrityError('coordination segment has a truncated tail', 'coordination_segment_truncated');
      }
      const segmentLines = text.length === 0 ? [] : text.slice(0, -1).split('\n');
      if (segmentLines.length === 0) {
        throw new CoordinationIntegrityError('coordination segment is empty', 'coordination_segment_integrity');
      }
      let fromSeq; let throughSeq;
      try {
        fromSeq = JSON.parse(segmentLines[0]).seq;
        throughSeq = JSON.parse(segmentLines[segmentLines.length - 1]).seq;
      } catch { throw new CoordinationIntegrityError('coordination segment is invalid JSON', 'invalid_json'); }
      if (!Number.isSafeInteger(fromSeq) || !Number.isSafeInteger(throughSeq)
        || throughSeq < fromSeq || throughSeq - fromSeq + 1 !== segmentLines.length) {
        throw new CoordinationIntegrityError('coordination segment sequence range is invalid', 'coordination_segment_integrity');
      }
      segments.push({ fromSeq, throughSeq, digest: name.slice(0, 64), bytes: bytes.byteLength });
    }
  }
  segments.sort((left, right) => left.fromSeq - right.fromSeq);
  let expected = 1;
  for (const segment of segments) {
    if (segment.fromSeq !== expected) throw new CoordinationIntegrityError('coordination archived prefix has a gap', 'coordination_segment_gap');
    expected = segment.throughSeq + 1;
  }
  const scannedThroughSeq = segments.length === 0 ? 0 : segments[segments.length - 1].throughSeq;
  const needed = firstSeq === null ? scannedThroughSeq : firstSeq - 1;
  if (segments.length === 0) {
    // No segment files at all: a firstSeq > 1 ledger is a plain sequence gap, not a
    // compacted store (the segment file is always written BEFORE the ledger is truncated).
    if (needed > 0) throw new CoordinationIntegrityError('coordination sequence gap at line 1', 'sequence_gap');
    return { archivedThroughSeq: 0, segments: [] };
  }
  if (scannedThroughSeq < needed) {
    throw new CoordinationIntegrityError('coordination archived prefix is incomplete', 'coordination_segment_gap');
  }
  // Segments may cover more than the ledger needs (a compaction whose ledger rewrite
  // committed but whose index did not): the ledger is the window authority.
  const active = segments.filter((segment) => segment.throughSeq <= needed);
  if (needed > 0 && (active.length === 0 || active[active.length - 1].throughSeq !== needed)) {
    throw new CoordinationIntegrityError('coordination archived prefix is incomplete', 'coordination_segment_gap');
  }
  return { archivedThroughSeq: needed, segments: active };
}

/** Moved from `CoordinationStore._load` (issue #259 slice 1). State: the store, passed explicitly. */
export function _load(store) {
  const raw = existsSync(store.file) ? readFileSync(store.file) : Buffer.alloc(0);
  _reportStartup(store, {
    schemaVersion: 1, state: 'starting', source: 'ledger', totalEvents: 0,
    checkpointEvents: 0, replayedEvents: 0, checkpoint: 'unchecked', failure: null,
  });
  try {
    // Issue #290: the quarantine ledger is loaded before any replay so every fold below (and
    // every checkpoint restore path) skips exactly the seqs a repair has durably quarantined.
    loadQuarantine(store);
    // Issue #290 (accepted loss window): ledger appends are group-committed — fsynced on the
    // next drain tick and again on clean release — so an OS-level crash can lose at most the
    // events appended since the last drain. Such a loss can truncate the tail mid-line; this
    // refusal is the typed surface of exactly that window, and a restart re-reads whatever
    // complete prefix survived. The housekeeping artifacts (checkpoint, segments, receipts)
    // are fsynced individually, never ahead of the truth they accelerate beyond this window.
    if (raw.byteLength > 0 && raw.at(-1) !== 0x0a) {
      throw new CoordinationIntegrityError('coordination stream has a truncated tail', 'truncated_tail');
    }
    const segments = _loadSegmentState(store, raw);
    const base = segments.archivedThroughSeq;
    store._segmentIndex = base > 0 ? segments : null;
    const checkpoint = store._restoreProjectionCheckpoint(raw, base);
    const tail = raw.subarray(checkpoint.prefixBytes);
    const text = tail.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(tail)) {
      throw new CoordinationIntegrityError('coordination stream is not exact UTF-8', 'invalid_utf8');
    }
    const lines = text.length === 0 ? [] : text.slice(0, -1).split('\n');
    const segmentEvents = (segments.segments ?? []).reduce((sum, segment) => sum + (segment.throughSeq - segment.fromSeq + 1), 0);
    const totalEvents = base + checkpoint.throughSeq + lines.length;
    const replaySource = (checkpointState) => (base > 0
      ? (checkpointState === 'valid' ? (lines.length > 0 ? 'segments_checkpoint_tail' : 'segments_checkpoint')
        : checkpointState === 'corrupt' ? 'segments_ledger_fallback' : 'segments_ledger')
      : checkpointState === 'valid' ? (lines.length > 0 ? 'checkpoint_tail' : 'checkpoint')
        : checkpointState === 'corrupt' ? 'ledger_fallback'
          : raw.byteLength === 0 ? 'empty' : 'ledger');
    _reportStartup(store, {
      schemaVersion: 1, state: 'replaying',
      source: replaySource(checkpoint.state),
      totalEvents, checkpointEvents: checkpoint.throughSeq, replayedEvents: 0,
      checkpoint: checkpoint.state, failure: null,
    });
    store._loading = true;
    try {
      const applyReplayEvent = (event, index) => {
        if (event.schemaVersion !== 1) throw new CoordinationIntegrityError(`unsupported schema version at seq ${event.seq}`, 'schema_version');
        if (event.seq !== index + 1) throw new CoordinationIntegrityError(`coordination sequence gap at line ${index + 1}`, 'sequence_gap');
        if (typeof event.idempotencyKey !== 'string' || store._byKey.has(event.idempotencyKey)) {
          throw new CoordinationIntegrityError(`duplicate/missing idempotency key at seq ${event.seq}`, 'duplicate_key');
        }
        const frozen = freeze(event);
        store._events.push(frozen);
        store._byKey.set(frozen.idempotencyKey, frozen);
        // Issue #290: a quarantined seq keeps its durable bytes parsed in the ledger (sequence
        // contiguity, idempotent-retry adjudication, and checkpoint byte-equality all hold);
        // only the fold that refused is withheld. Any fold failure names its seq and kind so an
        // operator can pass exactly that seq to the quarantine verb.
        if (store._quarantine.has(frozen.seq)) return;
        try { store._apply(frozen); }
        catch (error) {
          error.coordinationSeq = frozen.seq;
          error.coordinationKind = frozen.kind;
          throw error;
        }
      };
      for (const segment of segments.segments ?? []) {
        const bytes = readFileSync(store._segmentFilePath(segment.digest));
        if (sha256Bytes(bytes) !== segment.digest) {
          throw new CoordinationIntegrityError('coordination segment digest mismatch', 'coordination_segment_integrity');
        }
        const text = bytes.toString('utf8');
        if (!Buffer.from(text, 'utf8').equals(bytes)) {
          throw new CoordinationIntegrityError('coordination segment is not exact UTF-8', 'invalid_utf8');
        }
        if (bytes.byteLength > 0 && bytes.at(-1) !== 0x0a) {
          throw new CoordinationIntegrityError('coordination segment has a truncated tail', 'coordination_segment_truncated');
        }
        const segmentLines = text.length === 0 ? [] : text.slice(0, -1).split('\n');
        for (let offset = 0; offset < segmentLines.length; offset += 1) {
          let event;
          try { event = JSON.parse(segmentLines[offset]); }
          catch { throw new CoordinationIntegrityError(`invalid JSON at coordination segment ${segment.digest} line ${offset + 1}`, 'invalid_json'); }
          applyReplayEvent(event, segment.fromSeq - 1 + offset);
        }
      }
      for (let index = 0; index < (checkpoint.events ?? []).length; index += 1) {
        applyReplayEvent(checkpoint.events[index], base + index);
      }
      for (let offset = 0; offset < lines.length; offset += 1) {
        const index = base + checkpoint.throughSeq + offset;
        let event;
        try { event = JSON.parse(lines[offset]); }
        catch { throw new CoordinationIntegrityError(`invalid JSON at coordination line ${index + 1}`, 'invalid_json'); }
        applyReplayEvent(event, index);
        if ((offset + 1) % 256 === 0) _reportStartup(store, {
          schemaVersion: 1, state: 'replaying',
          source: replaySource(checkpoint.state),
          totalEvents, checkpointEvents: checkpoint.throughSeq,
          replayedEvents: segmentEvents + offset + 1, checkpoint: checkpoint.state, failure: null,
        });
      }
      _validateRecoveryReplayTransactions(store);
      _validateGoalPlanReplayTransactions(store);
    } finally { store._loading = false; }
    const source = replaySource(checkpoint.state);
    _reportStartup(store, {
      schemaVersion: 1, state: 'ready', source, totalEvents,
      checkpointEvents: checkpoint.throughSeq, replayedEvents: segmentEvents + lines.length,
      checkpoint: checkpoint.state, failure: null,
    });
    store._loadedLedgerHash = createHash('sha256').update(raw);
    store._loadedLedgerIdentity = freeze({
      bytes: raw.byteLength, digest: store._loadedLedgerHash.copy().digest('hex'),
      events: store._events.length,
    });
  } catch (error) {
    _reportStartup(store, {
      schemaVersion: 1, state: 'failed', source: 'ledger', totalEvents: 0,
      checkpointEvents: 0, replayedEvents: 0, checkpoint: 'unusable',
      // Issue #290: a fold refusal names the seq it died on, so the operator can pass exactly
      // that seq to the quarantine verb — the failure record is the repair's warrant.
      failure: {
        code: error?.code ?? 'coordination_startup_failed',
        seq: error?.coordinationSeq ?? null,
      },
    });
    throw error;
  }
}

/** Moved from `CoordinationStore._recoveryBatchIdentity` (issue #259 slice 1). Reads no store state. */
export function _recoveryBatchIdentity(kind, events) {
  return canonicalDigest({
    schemaVersion: 1,
    kind,
    entries: events.map((event) => ({
      kind: event.kind,
      actor: event.actor,
      idempotencyKey: event.idempotencyKey,
      payload: event.payload,
    })),
  });
}

/** Moved from `CoordinationStore._validateRecoveryReplayTransactions` (issue #259 slice 1). State: the store, passed explicitly. */
export function _validateRecoveryReplayTransactions(store) {
  const fail = (message) => { throw new CoordinationIntegrityError(message, 'recovery_batch_integrity'); };
  for (let index = 0; index < store._events.length; index += 1) {
    const first = store._events[index];
    if (first.batch?.kind === 'goal_plan_recovery_dispatch') continue;
    const recoveryCreate = first.kind === 'task.created' && first.payload?.relation === 'recovery';
    const recoveryRefusal = first.kind === 'driver.recorded' && first.payload?.kind === 'recovery.dispatch_refused';
    const recoveryBatch = ['recovery_refinement_create_claim', 'recovery_dispatch_refusal'].includes(first.batch?.kind);
    if (!recoveryCreate && !recoveryRefusal && !recoveryBatch) continue;
    const expectedKind = recoveryCreate ? 'recovery_refinement_create_claim'
      : recoveryRefusal ? 'recovery_dispatch_refusal' : first.batch.kind;
    if (!first.batch || Object.keys(first.batch).sort().join(',') !== ['count', 'id', 'index', 'kind', 'schemaVersion'].sort().join(',')
      || first.batch.schemaVersion !== 1 || first.batch.kind !== expectedKind || first.batch.index !== 0
      || first.batch.count !== 2 || !/^[a-f0-9]{64}$/.test(first.batch.id ?? '')) {
      fail(`recovery transaction at seq ${first.seq} lacks an exact batch identity`);
    }
    const second = store._events[index + 1];
    if (!second || second.seq !== first.seq + 1 || second.ts !== first.ts
      || !second.batch || second.batch.schemaVersion !== 1 || second.batch.kind !== expectedKind
      || second.batch.id !== first.batch.id || second.batch.index !== 1 || second.batch.count !== 2
      || _recoveryBatchIdentity(expectedKind, [first, second]) !== first.batch.id) {
      fail(`recovery transaction at seq ${first.seq} is torn or mismatched`);
    }
    if (expectedKind === 'recovery_refinement_create_claim') {
      if (!recoveryCreate || second.kind !== 'task.claimed' || second.actor !== first.actor
        || second.idempotencyKey !== `${first.idempotencyKey}:claim`) {
        fail(`recovery refinement transaction at seq ${first.seq} is not an exact create/claim pair`);
      }
      _validateRecoveryRefinementPair(store, first, second, true);
    } else {
      if (!recoveryRefusal || second.kind !== 'task.transitioned' || second.actor !== first.actor
        || second.idempotencyKey !== `${first.idempotencyKey}:task`) {
        fail(`recovery refusal transaction at seq ${first.seq} is not an exact receipt/transition pair`);
      }
      const task = store._tasks.get(first.payload.taskId);
      const expectedTransition = {
        id: first.payload.taskId,
        from: 'working',
        to: 'failed',
        expectedVersion: 2,
        newVersion: 3,
        evidence: clone(first.payload.evidence),
      };
      if (canonicalDigest(second.payload) !== canonicalDigest(expectedTransition)
        || task?.status !== 'failed' || task?.terminalEvent !== second.seq) {
        fail(`recovery refusal transaction at seq ${first.seq} did not close its exact refinement`);
      }
    }
    index += 1;
  }
}

/** Moved from `CoordinationStore._validateGoalPlanReplayTransactions` (issue #259 slice 1). State: the store, passed explicitly. */
export function _validateGoalPlanReplayTransactions(store) {
  const fail = (message) => store._goalPlanFailure(message, 'goal_plan_batch_integrity', true);
  const failRecovery = (message) => store._goalPlanFailure(message, 'goal_plan_recovery_batch_integrity', true);
  for (let index = 0; index < store._events.length; index += 1) {
    const first = store._events[index];
    const isPlanRecovery = first.batch?.kind === 'goal_plan_recovery_dispatch';
    const isPlanWave = first.batch?.kind === 'goal_plan_wave_dispatch';
    const isDispatch = first.kind === 'plan.node_dispatched'
      || ['goal_plan_node_dispatch', 'goal_plan_wave_dispatch', 'goal_plan_recovery_dispatch'].includes(first.batch?.kind);
    const isBoundTask = first.kind === 'task.created' && first.payload?.brief?.goalPlan;
    if (!isDispatch && !isBoundTask) continue;
    if (isPlanWave) {
      const count = first.batch?.count;
      const events = Number.isSafeInteger(count) && count >= 4 && count % 2 === 0
        ? store._events.slice(index, index + count) : [];
      const exactBatch = events.length === count
        && first.kind === 'plan.node_dispatched' && first.batch.index === 0
        && /^[a-f0-9]{64}$/.test(first.batch.id ?? '')
        && _recoveryBatchIdentity('goal_plan_wave_dispatch', events) === first.batch.id
        && events.every((event, offset) => event.seq === first.seq + offset
          && event.ts === first.ts && event.actor === first.actor
          && event.batch?.schemaVersion === 1 && event.batch.kind === 'goal_plan_wave_dispatch'
          && event.batch.id === first.batch.id && event.batch.index === offset
          && event.batch.count === count)
        && events.every((event, offset) => offset % 2 === 0
          ? event.kind === 'plan.node_dispatched'
            && event.payload?.wave?.index === offset / 2
            && event.payload?.wave?.count === count / 2
          : event.kind === 'task.created'
            && event.idempotencyKey === `${events[offset - 1].idempotencyKey}:task`
            && events[offset - 1].payload?.taskId === event.payload?.id
            && events[offset - 1].payload?.taskPayloadDigest === canonicalDigest(event.payload)
            && canonicalDigest(events[offset - 1].payload?.binding) === canonicalDigest(event.payload?.brief?.goalPlan));
      const waveDigests = new Set(events.filter((_, offset) => offset % 2 === 0)
        .map((event) => event.payload?.wave?.digest));
      const reconstructedEntries = events.filter((_, offset) => offset % 2 === 0)
        .map((dispatch, memberIndex) => {
          const p = dispatch.payload; const binding = p?.binding;
          return {
            fields: events[memberIndex * 2 + 1]?.payload,
            gate: {
              goalId: binding?.goalId, goalVersion: binding?.goalVersion,
              goalDigest: binding?.goalDigest, planId: binding?.planId,
              planVersion: binding?.planVersion, planDigest: binding?.planDigest,
              nodeKey: binding?.nodeKey, expectedDispatchVersion: 0,
              capabilities: p?.capabilities, effects: p?.effects,
              ...(Object.hasOwn(p ?? {}, 'requiredEffects')
                ? { requiredEffects: p.requiredEffects } : {}),
            },
            route: p?.route,
          };
        });
      const expectedWaveDigest = goalPlanDigest({
        authority: first.payload?.authority,
        entries: reconstructedEntries,
      });
      if (!exactBatch || waveDigests.size !== 1
        || [...waveDigests][0] !== expectedWaveDigest) {
        fail(`goal/plan wave dispatch at seq ${first.seq} is torn or mismatched`);
      }
      for (let offset = 0; offset < count; offset += 2) {
        store._validateGoalPlanDispatchPair(events[offset], events[offset + 1], true);
      }
      index += count - 1;
      continue;
    }
    if (isPlanRecovery) {
      const second = store._events[index + 1]; const third = store._events[index + 2];
      const batchFields = ['count', 'id', 'index', 'kind', 'schemaVersion'].sort().join(',');
      const exactBatch = first.kind === 'plan.node_dispatched'
        && Object.keys(first.batch ?? {}).sort().join(',') === batchFields
        && Object.keys(second?.batch ?? {}).sort().join(',') === batchFields
        && Object.keys(third?.batch ?? {}).sort().join(',') === batchFields
        && first.batch?.schemaVersion === 1
        && first.batch.kind === 'goal_plan_recovery_dispatch' && first.batch.index === 0
        && first.batch.count === 3 && /^[a-f0-9]{64}$/.test(first.batch.id ?? '')
        && second?.kind === 'task.created' && second.seq === first.seq + 1 && second.ts === first.ts
        && second.actor === first.actor && second.idempotencyKey === `${first.idempotencyKey}:task`
        && second.batch?.schemaVersion === 1 && second.batch.kind === 'goal_plan_recovery_dispatch'
        && second.batch.id === first.batch.id && second.batch.index === 1 && second.batch.count === 3
        && third?.kind === 'task.claimed' && third.seq === second.seq + 1 && third.ts === first.ts
        && third.actor === first.actor && third.idempotencyKey === `${first.idempotencyKey}:claim`
        && third.batch?.schemaVersion === 1 && third.batch.kind === 'goal_plan_recovery_dispatch'
        && third.batch.id === first.batch.id && third.batch.index === 2 && third.batch.count === 3
        && _recoveryBatchIdentity('goal_plan_recovery_dispatch', [first, second, third]) === first.batch.id
        && first.payload?.taskId === second.payload?.id && second.payload?.id === third.payload?.id
        && first.payload?.taskPayloadDigest === canonicalDigest(second.payload)
        && first.payload?.claimPayloadDigest === canonicalDigest(third.payload)
        && canonicalDigest(first.payload?.binding) === canonicalDigest(second.payload?.brief?.goalPlan);
      if (!exactBatch) failRecovery(`goal/plan recovery dispatch at seq ${first.seq} is torn or mismatched`);
      store._validateGoalPlanRecoveryTriple(first, second, third, true);
      index += 2;
      continue;
    }
    if (first.kind !== 'plan.node_dispatched' || !first.batch || first.batch.schemaVersion !== 1
      || first.batch.kind !== 'goal_plan_node_dispatch' || first.batch.index !== 0 || first.batch.count !== 2
      || !/^[a-f0-9]{64}$/.test(first.batch.id ?? '')) fail(`goal/plan dispatch at seq ${first.seq} lacks an exact batch identity`);
    const second = store._events[index + 1];
    if (!second || second.kind !== 'task.created' || second.seq !== first.seq + 1 || second.ts !== first.ts
      || second.actor !== first.actor || second.idempotencyKey !== `${first.idempotencyKey}:task`
      || !second.batch || second.batch.schemaVersion !== 1 || second.batch.kind !== 'goal_plan_node_dispatch'
      || second.batch.id !== first.batch.id || second.batch.index !== 1 || second.batch.count !== 2
      || _recoveryBatchIdentity('goal_plan_node_dispatch', [first, second]) !== first.batch.id
      || first.payload.taskId !== second.payload.id || first.payload.taskPayloadDigest !== canonicalDigest(second.payload)
      || canonicalDigest(first.payload.binding) !== canonicalDigest(second.payload.brief?.goalPlan)) {
      fail(`goal/plan dispatch at seq ${first.seq} is torn or mismatched`);
    }
    store._validateGoalPlanDispatchPair(first, second, true);
    index += 1;
  }
}

/** Moved from `CoordinationStore._planRecoveryRequestFields` (issue #259 slice 1). Reads no store state. */
export function _planRecoveryRequestFields(createdPayload) {
  const fields = [
    'brief', 'deps', 'effortRequested', 'id', 'modelPolicy', 'modelRequested', 'refines',
    'relation', 'reservedWorkerId', 'runId', 'sessionRequest', 'taskType', 'vendorRequested',
  ];
  return Object.fromEntries(fields.map((field) => [field, clone(createdPayload[field])]));
}

/** Moved from `CoordinationStore._recoveryAttributionFromClaim` (issue #259 slice 1). Reads no store state. */
export function _recoveryAttributionFromClaim(claimedPayload) {
  const fields = [
    'harnessRequested', 'harnessResolved', 'modelRequested', 'modelResolved', 'modelObserved',
    'effortRequested', 'effortResolved', 'effortObserved', 'routeKey',
  ];
  return Object.fromEntries(fields.map((field) => [field, clone(claimedPayload[field])]));
}

/** Moved from `CoordinationStore._normalizedPlanRecoveryCreatedPayload` (issue #259 slice 1). State: the store, passed explicitly. */
export function _normalizedPlanRecoveryCreatedPayload(store, fields, priorTask) {
  return {
    ..._planRecoveryRequestFields(fields),
    worktreeBaseSha: priorTask.worktreeBaseSha ?? null,
    review: clone(priorTask.review ?? null),
  };
}

/** Moved from `CoordinationStore._recoveryFailure` (issue #259 slice 1). Reads no store state. */
export function _recoveryFailure(message, code, integrity) {
  throw integrity
    ? new CoordinationIntegrityError(message, code)
    : new CoordinationRefusal(message, code);
}

/** Moved from `CoordinationStore._verifiedRecoveryPrior` (issue #259 slice 1). State: the store, passed explicitly. */
export function _verifiedRecoveryPrior(store, task, integrity = false) {
  const fail = (message) => _recoveryFailure(message, 'recovery_refinement_unverified', integrity);
  const terminal = task?.terminalEvent ? store._events[task.terminalEvent - 1] : null;
  const evidenceSeq = terminal?.payload?.evidence?.coordinationSeq;
  const mapped = Number.isSafeInteger(evidenceSeq) ? store._events[evidenceSeq - 1] : null;
  const source = mapped?.kind === 'evidence.mapped'
    ? store._operationalRead?.(mapped.payload.worker, mapped.payload.workerSeq)
    : null;
  if (!task || (!integrity && task.status !== 'completed') || !terminal || terminal.kind !== 'task.transitioned'
    || terminal.payload?.id !== task.id || terminal.payload?.to !== 'completed'
    || mapped?.kind !== 'evidence.mapped' || mapped.payload?.kind !== 'verify.reverified'
    || mapped.payload?.worker !== task.assignee || source?.kind !== 'verify.reverified'
    || source.actor !== 'policy' || source.worker !== task.assignee || source.taskId !== task.id
    || source.payload?.accept !== true || digest(source) !== mapped.payload.digest) {
    fail('recovery refinement requires the exact completed hub-verified prior task');
  }
  return { terminal, mapped, source };
}

/** Moved from `CoordinationStore._recoveryAttemptFailure` (issue #259 slice 1). Reads no store state. */
export function _recoveryAttemptFailure(message, code, integrity = false) {
  throw integrity
    ? new CoordinationIntegrityError(message, 'recovery_attempt_integrity')
    : new CoordinationRefusal(message, code);
}

/** Moved from `CoordinationStore._normalizeRecoveryAttemptAdmission` (issue #259 slice 1). State: the store, passed explicitly. */
export function _normalizeRecoveryAttemptAdmission(store, payload, integrity = false) {
  try { return normalizeRecoveryAttemptAdmission(payload); }
  catch (error) {
    _recoveryAttemptFailure(error?.message ?? 'recovery attempt admission is invalid',
      'recovery_attempt_invalid', integrity,);
  }
}

/** Moved from `CoordinationStore._normalizeRecoveryAttemptCompletion` (issue #259 slice 1). State: the store, passed explicitly. */
export function _normalizeRecoveryAttemptCompletion(store, payload, integrity = false) {
  try { return normalizeRecoveryAttemptCompletion(payload); }
  catch (error) {
    _recoveryAttemptFailure(error?.message ?? 'recovery attempt completion is invalid',
      'recovery_attempt_completion_invalid', integrity,);
  }
}

/** Moved from `CoordinationStore._validateRecoveryAttemptCompletionPayload` (issue #259 slice 1). State: the store, passed explicitly. */
export function _validateRecoveryAttemptCompletionPayload(store, payload, event, integrity = false) {
  const p = _normalizeRecoveryAttemptCompletion(store, payload, integrity);
  const fail = (message, code) => _recoveryAttemptFailure(message, code, integrity);
  const attempt = store._recoveryAttemptsById.get(p.attemptId);
  if (!attempt || attempt.admissionDigest !== p.admissionDigest || attempt.state !== 'pending') {
    fail('recovery attempt completion does not bind one pending admission', 'recovery_attempt_completion_invalid');
  }
  if (event?.actor !== attempt.actor) {
    fail('recovery attempt completion actor differs from admission', 'recovery_attempt_conflict');
  }
  return { payload: p, attempt };
}

/** Moved from `CoordinationStore._normalizedRecoveryCreatedPayload` (issue #259 slice 1). Reads no store state. */
export function _normalizedRecoveryCreatedPayload(fields, priorTask) {
  return {
    id: fields.id,
    brief: clone(priorTask.brief),
    deps: [],
    refines: priorTask.id,
    runId: priorTask.runId ?? null,
    taskType: priorTask.taskType ?? 'general',
    reservedWorkerId: priorTask.reservedWorkerId,
    vendorRequested: priorTask.vendorRequested ?? null,
    modelRequested: priorTask.modelRequested ?? null,
    modelPolicy: clone(priorTask.modelPolicy ?? null),
    effortRequested: priorTask.effortRequested ?? null,
    sessionRequest: clone(fields.sessionRequest),
    relation: 'recovery',
    worktreeBaseSha: priorTask.worktreeBaseSha ?? null,
    review: clone(priorTask.review ?? null),
  };
}

/** Moved from `CoordinationStore._normalizedRecoveryClaimedPayload` (issue #259 slice 1). Reads no store state. */
export function _normalizedRecoveryClaimedPayload(createdPayload, attribution) {
  return {
    id: createdPayload.id,
    worker: createdPayload.reservedWorkerId,
    expectedVersion: 1,
    newVersion: 2,
    harnessRequested: attribution.harnessRequested,
    harnessResolved: attribution.harnessResolved,
    modelRequested: createdPayload.modelRequested,
    modelResolved: attribution.modelResolved,
    modelObserved: attribution.modelObserved,
    effortRequested: createdPayload.effortRequested,
    effortResolved: attribution.effortResolved,
    effortObserved: attribution.effortObserved,
    routeKey: attribution.routeKey,
  };
}

/** Moved from `CoordinationStore._validateRecoveryRefinementPair` (issue #259 slice 1). State: the store, passed explicitly. */
export function _validateRecoveryRefinementPair(store, createdEvent, claimedEvent, integrity = false) {
  const fail = (message) => _recoveryFailure(message, 'recovery_batch_integrity', integrity);
  const created = createdEvent?.payload;
  const priorTask = store._tasks.get(created?.refines);
  const createdFields = [
    'brief', 'deps', 'effortRequested', 'id', 'modelPolicy', 'modelRequested', 'refines', 'relation',
    'reservedWorkerId', 'review', 'runId', 'sessionRequest', 'taskType', 'vendorRequested', 'worktreeBaseSha',
  ];
  const claimFields = [
    'effortObserved', 'effortRequested', 'effortResolved', 'expectedVersion', 'harnessRequested',
    'harnessResolved', 'id', 'modelObserved', 'modelRequested', 'modelResolved', 'newVersion', 'routeKey', 'worker',
  ];
  if (!created || Object.keys(created).sort().join(',') !== createdFields.sort().join(',')
    || !claimedEvent?.payload || Object.keys(claimedEvent.payload).sort().join(',') !== claimFields.sort().join(',')) {
    fail('recovery refinement batch payload is open or malformed');
  }
  _verifiedRecoveryPrior(store, priorTask, integrity);
  store._validateRecoverySessionRequest(created.sessionRequest, priorTask, fail);
  const expectedCreated = _normalizedRecoveryCreatedPayload(created, priorTask);
  const claimed = claimedEvent.payload;
  const expectedClaimed = _normalizedRecoveryClaimedPayload(created, {
    harnessRequested: claimed.harnessRequested,
    harnessResolved: claimed.harnessResolved,
    modelRequested: claimed.modelRequested,
    modelResolved: claimed.modelResolved,
    modelObserved: claimed.modelObserved,
    effortRequested: claimed.effortRequested,
    effortResolved: claimed.effortResolved,
    effortObserved: claimed.effortObserved,
    routeKey: claimed.routeKey,
  });
  if (canonicalDigest(created) !== canonicalDigest(expectedCreated)
    || canonicalDigest(claimed) !== canonicalDigest(expectedClaimed)) {
    fail('recovery refinement batch changes prior lineage or claim identity');
  }
  return { created: expectedCreated, claimed: expectedClaimed };
}

/** Moved from `CoordinationStore._validateRecoveryDispositionPayload` (issue #259 slice 1). State: the store, passed explicitly. */
export function _validateRecoveryDispositionPayload(store, p, event, integrity = false) {
  const disposition = p?.kind === 'recovery.dispatch_accepted'
    ? 'dispatch_accepted'
    : p?.kind === 'recovery.dispatch_refused' ? 'dispatch_refused' : null;
  const fields = [
    'adapterCardDigest', 'briefDigest', 'contextDigest', 'intentSeq', 'kind', 'priorTaskId',
    'processGeneration', 'routeDigest', 'schemaVersion', 'sessionId', 'taskId', 'workerId',
    ...(disposition === 'dispatch_refused' ? ['code', 'evidence'] : []),
  ];
  const fail = (message, code = 'recovery_dispatch_integrity') => _recoveryFailure(message, code, integrity);
  if (!disposition || !p || Object.keys(p).sort().join(',') !== fields.sort().join(',')
    || p.schemaVersion !== 1 || !Number.isSafeInteger(p.intentSeq) || p.intentSeq <= 0) {
    fail('recovery dispatch disposition is malformed');
  }
  const current = store._recoveryDispatches.get(p.workerId);
  const exact = current?.status === 'dispatch_unknown' && p.intentSeq === current.intentSeq
    && p.taskId === current.taskId && p.priorTaskId === current.priorTaskId
    && p.sessionId === current.sessionId && p.processGeneration === current.processGeneration
    && p.briefDigest === current.briefDigest && p.contextDigest === current.contextDigest
    && p.routeDigest === current.routeDigest && p.adapterCardDigest === current.adapterCardDigest;
  if (!exact) fail('recovery dispatch disposition does not close the exact unknown intent');
  if (disposition === 'dispatch_refused') {
    if (p.code !== 'not_sent' || !p.evidence || !Number.isSafeInteger(p.evidence.coordinationSeq)) {
      fail('recovery refusal lacks a closed not-sent proof');
    }
    const mapped = store._events[p.evidence.coordinationSeq - 1];
    if (mapped?.kind !== 'evidence.mapped'
      || canonicalDigest({ ...mapped.payload, coordinationSeq: mapped.seq }) !== canonicalDigest(p.evidence)) {
      fail('recovery refusal evidence is not authoritative');
    }
    const source = store._operationalRead?.(mapped.payload.worker, mapped.payload.workerSeq);
    const proofFields = [
      'action', 'adapterCardDigest', 'briefDigest', 'code', 'contextDigest', 'intentSeq',
      'observedDispatchFacts', 'priorTaskId', 'processGeneration', 'routeDigest', 'schemaVersion',
      'sessionId', 'taskId', 'workerId',
    ];
    const proof = source?.payload;
    if (mapped.payload.kind !== 'control.recovery_dispatch_refused'
      || source?.kind !== 'control.recovery_dispatch_refused' || source.actor !== 'policy'
      || source.worker !== p.workerId
      || digest(source) !== mapped.payload.digest
      || !proof || Object.keys(proof).sort().join(',') !== proofFields.sort().join(',')
      || proof.schemaVersion !== 1 || proof.code !== 'not_sent'
      || proof.action !== 'kill_untrusted_transport'
      || !Array.isArray(proof.observedDispatchFacts) || proof.observedDispatchFacts.length !== 0
      || proof.workerId !== p.workerId || proof.taskId !== p.taskId
      || proof.priorTaskId !== p.priorTaskId || proof.sessionId !== p.sessionId
      || proof.processGeneration !== p.processGeneration || proof.intentSeq !== p.intentSeq
      || proof.briefDigest !== p.briefDigest || proof.contextDigest !== p.contextDigest
      || proof.routeDigest !== p.routeDigest || proof.adapterCardDigest !== p.adapterCardDigest) {
      fail('recovery refusal evidence is not exact zero-fact not-sent testimony');
    }
  }
  return freeze({ ...clone(current), status: disposition, receiptSeq: event.seq });
}

/** Moved from `CoordinationStore._validPreservedContinuationReceipt` (issue #259 slice 1). Reads no store state. */
export function _validPreservedContinuationReceipt(receipt) {
  if (receipt === null) return true;
  const fields = [
    'preservationReceiptDigest', 'providerAdmissionSeq', 'receiptDigest', 'routeDigest',
    'schemaVersion', 'sessionDigest', 'state', 'taskBindingDigest', 'turnEpoch',
  ];
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
    || Object.keys(receipt).sort().join(',') !== fields.sort().join(',')
    || receipt.schemaVersion !== 1 || receipt.state !== 'admitted'
    || (receipt.providerAdmissionSeq !== null
      && (!Number.isSafeInteger(receipt.providerAdmissionSeq) || receipt.providerAdmissionSeq <= 0))
    || !Number.isSafeInteger(receipt.turnEpoch) || receipt.turnEpoch <= 0
    || ['preservationReceiptDigest', 'sessionDigest', 'taskBindingDigest', 'routeDigest',
      'receiptDigest'].some((field) => !/^[a-f0-9]{64}$/u.test(receipt[field] ?? ''))) return false;
  const core = clone(receipt); delete core.receiptDigest;
  return receipt.receiptDigest === canonicalDigest(core);
}

/** Moved from `CoordinationStore.reconcilePlanGatedTask` (issue #259 slice 1). State: the store, passed explicitly. */
export function reconcilePlanGatedTask(store, taskId, gate, route, auth) {
  if (!store._goalPlanPolicy) throw new CoordinationRefusal('goal/plan authority is not configured', 'goal_plan_unavailable');
  const prior = store._byKey.get(auth?.key); const taskEvent = prior ? store._events[prior.seq] : null;
  const binding = prior?.payload?.binding;
  const expectedBinding = gate && typeof gate === 'object' ? {
    goalId: gate.goalId, goalVersion: gate.goalVersion, goalDigest: gate.goalDigest,
    planId: gate.planId, planVersion: gate.planVersion, planDigest: gate.planDigest, nodeKey: gate.nodeKey,
  } : null;
  const observedBinding = binding ? {
    goalId: binding.goalId, goalVersion: binding.goalVersion, goalDigest: binding.goalDigest,
    planId: binding.planId, planVersion: binding.planVersion, planDigest: binding.planDigest, nodeKey: binding.nodeKey,
  } : null;
  if (!prior || prior.kind !== 'plan.node_dispatched' || prior.actor !== auth.actor
    || prior.payload?.taskId !== taskId || taskEvent?.kind !== 'task.created'
    || taskEvent.batch?.id !== prior.batch?.id || taskEvent.payload?.id !== taskId
    || gate?.expectedDispatchVersion !== 0
    || canonicalDigest(expectedBinding) !== canonicalDigest(observedBinding)
    || canonicalDigest(gate?.capabilities) !== canonicalDigest(prior.payload?.capabilities)
    || canonicalDigest(gate?.effects) !== canonicalDigest(prior.payload?.effects)
    || Object.hasOwn(gate ?? {}, 'requiredEffects') !== Object.hasOwn(prior.payload ?? {}, 'requiredEffects')
    || canonicalDigest(gate?.requiredEffects ?? []) !== canonicalDigest(prior.payload?.requiredEffects ?? [])
    || canonicalDigest(route) !== canonicalDigest(prior.payload?.route)) {
    throw new CoordinationRefusal('plan dispatch replay differs from the admitted transaction', 'plan_dispatch_conflict');
  }
  return freeze({ ok: true, result: 'reconciled', dispatchEvent: clone(prior), taskEvent: clone(taskEvent), task: store.task(taskId), dispatch: clone(prior.payload) });
}

/** Moved from `CoordinationStore.reconcilePlanRevisionTask` (issue #259 slice 1). State: the store, passed explicitly. */
export function reconcilePlanRevisionTask(store, taskId, gate, route, auth) {
  const prior = store._byKey.get(auth?.key); const taskEvent = prior ? store._events[prior.seq] : null;
  const binding = prior?.payload?.binding;
  const expected = gate && typeof gate === 'object' ? {
    goalId: gate.goalId, goalVersion: gate.goalVersion, goalDigest: gate.goalDigest,
    planId: gate.planId, planVersion: gate.planVersion, planDigest: gate.planDigest,
    nodeKey: gate.nodeKey,
  } : null;
  const observed = binding ? {
    goalId: binding.goalId, goalVersion: binding.goalVersion, goalDigest: binding.goalDigest,
    planId: binding.planId, planVersion: binding.planVersion, planDigest: binding.planDigest,
    nodeKey: binding.nodeKey,
  } : null;
  const plan = binding ? store._plans.get(store._planVersionKey(binding.planId, binding.planVersion)) : null;
  const node = plan?.nodes.find((row) => row.key === binding?.nodeKey);
  if (!prior || prior.kind !== 'plan.node_dispatched' || prior.actor !== auth?.actor
    || prior.payload?.taskId !== taskId || taskEvent?.kind !== 'task.created'
    || taskEvent.batch?.id !== prior.batch?.id || gate?.expectedDispatchVersion !== 0
    || canonicalDigest(expected) !== canonicalDigest(observed)
    || canonicalDigest(gate?.capabilities) !== canonicalDigest(prior.payload?.capabilities)
    || canonicalDigest(gate?.effects) !== canonicalDigest(prior.payload?.effects)
    || canonicalDigest(route) !== canonicalDigest(prior.payload?.route)
    || !node?.revision || canonicalDigest(node.revision) !== canonicalDigest(prior.payload?.revision)) {
    throw new CoordinationRefusal('Plan revision replay differs from the admitted transaction',
      'plan_revision_conflict');
  }
  return freeze({ ok: true, result: 'reconciled', dispatchEvent: clone(prior),
    taskEvent: clone(taskEvent), task: store.task(taskId), dispatch: clone(prior.payload) });
}

/** Moved from `CoordinationStore.createAndClaimPreservedResumeRefinement` (issue #259 slice 1). State: the store, passed explicitly. */
export function createAndClaimPreservedResumeRefinement(store, fields, gate, route, preservedResume, auth) {
  if (!store._goalPlanPolicy) throw new CoordinationRefusal('goal/plan authority is not configured', 'goal_plan_unavailable');
  const attestation = store._validPreservedResumeAttestation(preservedResume);
  if (!attestation) throw new CoordinationRefusal('preserved resume attestation is invalid', 'preserved_resume_invalid');
  if (!gate || !route || !auth || typeof auth !== 'object') throw new CoordinationRefusal('preserved resume request is invalid', 'preserved_resume_invalid');
  const requestDigest = goalPlanDigest({ principalId: auth.principalId, gate, route, task: fields, preservedResume: attestation });
  const prior = store._byKey.get(auth.key);
  if (prior) {
    const second = store._events[prior.seq];
    if (prior.kind !== 'plan.node_dispatched' || prior.actor !== auth.actor || prior.payload?.requestDigest !== requestDigest
      || second?.kind !== 'task.created' || second.batch?.id !== prior.batch?.id
      || !store._validPreservedResumeAttestation(prior.payload?.preservedResume)) {
      throw new CoordinationRefusal('preserved resume idempotency key is bound differently', 'preserved_resume_conflict');
    }
    return freeze({ ok: true, result: 'idempotent', dispatchEvent: clone(prior), taskEvent: clone(second), task: store.task(second.payload.id), dispatch: clone(prior.payload) });
  }
  const state = store._planDispatchState(gate, route, attestation);
  if (store._tasks.has(fields?.id)) throw new CoordinationRefusal('plan task id already exists', 'duplicate_task');
  if (!planBriefMatches(fields?.brief, state.brief, { goalPlanCoordinates: true })
    || canonicalDigest(fields?.brief?.goalPlan) !== canonicalDigest(state.binding)
    || canonicalDigest(fields?.brief?.capabilities) !== canonicalDigest(state.node.capabilities)
    || canonicalDigest(fields?.brief?.effects) !== canonicalDigest(state.node.effects)
    || canonicalDigest(fields?.brief?.requiredEffects ?? []) !== canonicalDigest(state.node.requiredEffects ?? [])
    || fields?.brief?.providerTurns !== state.node.budget.providerTurns) throw new CoordinationRefusal('task Brief differs from the approved authoritative Brief', 'plan_brief_mismatch');
  if (canonicalDigest(fields?.deps ?? []) !== canonicalDigest(state.resolvedDeps)) throw new CoordinationRefusal('task dependencies differ from the plan DAG', 'plan_dependency_mismatch');
  if (fields?.runId !== state.goal.runId || fields?.vendorRequested !== route.vendor || (fields?.modelRequested ?? null) !== route.model || (fields?.effortRequested ?? null) !== route.effort) throw new CoordinationRefusal('task route differs from the plan dispatch', 'plan_route_mismatch');
  // The resumed task carries the preserved lineage explicitly; it is not constrained to the
  // node's DAG dependencies because it re-dispatches the same node, not a successor.
  if (fields?.refines !== attestation.priorTaskId) throw new CoordinationRefusal('preserved resume lineage does not match the attested prior task', 'preserved_resume_lineage_mismatch');
  const taskPayload = clone(fields);
  const dispatchPayload = {
    schemaVersion: 1, requestDigest,
    authority: { principalId: auth.principalId, repoId: auth.repoId, runId: auth.runId ?? null },
    binding: clone(state.binding), taskId: taskPayload.id,
    taskPayloadDigest: canonicalDigest(taskPayload), expectedDispatchVersion: 0, newDispatchVersion: 1,
    resolvedDeps: clone(state.resolvedDeps), nodeBudget: clone(state.node.budget),
    route: clone(route), capabilities: clone(state.node.capabilities), effects: clone(state.node.effects),
    ...(Object.hasOwn(state.node, 'requiredEffects') ? { requiredEffects: clone(state.node.requiredEffects) } : {}),
    preservedResume: clone(attestation),
  };
  const fixedTs = store._clock();
  const prospectiveDispatch = { seq: store._events.length + 1, ts: fixedTs, payload: dispatchPayload };
  const prospectiveTask = { seq: store._events.length + 2, ts: fixedTs, payload: taskPayload };
  store._validateGoalPlanDispatchPair(prospectiveDispatch, prospectiveTask, false);
  const [dispatchEvent, taskEvent] = store._appendBatch([
    { kind: 'plan.node_dispatched', payload: dispatchPayload, auth: { actor: auth.actor, key: auth.key }, fixedTs },
    { kind: 'task.created', payload: taskPayload, auth: { actor: auth.actor, key: `${auth.key}:task` }, fixedTs },
  ], 'goal_plan_node_dispatch');
  return freeze({ ok: true, result: 'created', dispatchEvent: clone(dispatchEvent), taskEvent: clone(taskEvent), task: store.task(taskPayload.id), dispatch: clone(dispatchPayload) });
}

/** Moved from `CoordinationStore.recoveryDispatchState` (issue #259 slice 1). State: the store, passed explicitly. */
export function recoveryDispatchState(store, workerId) { return clone(store._recoveryDispatches.get(workerId) ?? null); }

/** Moved from `CoordinationStore.createAndClaimRecoveryRefinement` (issue #259 slice 1). State: the store, passed explicitly. */
export function createAndClaimRecoveryRefinement(store, fields, attribution, auth) {
  const priorTask = store._tasks.get(fields?.refines);
  if (!priorTask || (fields?.runId != null && store._runs.get(fields.runId)?.status === 'sealed')) {
    throw new CoordinationRefusal('recovery refinement target is unavailable', 'recovery_refinement_unavailable');
  }
  if (priorTask.brief?.goalPlan) {
    throw new CoordinationRefusal('plan-bound recovery requires a separately approved plan node', 'goal_plan_continuation_not_authorized');
  }
  const createdPayload = store._validateRecoveryRefinementRequest(fields, attribution, priorTask, false);
  const claimedPayload = _normalizedRecoveryClaimedPayload(createdPayload, attribution);
  const prior = store._byKey.get(auth?.key);
  if (prior) {
    const claimed = store._events[prior.seq];
    if (prior.kind !== 'task.created' || prior.actor !== auth.actor
      || canonicalDigest(prior.payload) !== canonicalDigest(createdPayload)
      || prior.batch?.kind !== 'recovery_refinement_create_claim'
      || claimed?.kind !== 'task.claimed' || claimed.actor !== auth.actor
      || claimed.batch?.id !== prior.batch.id
      || prior.batch.index !== 0 || claimed.batch?.index !== 1
      || prior.batch.count !== 2 || claimed.batch?.count !== 2 || claimed.ts !== prior.ts
      || claimed.idempotencyKey !== `${auth.key}:claim`
      || canonicalDigest(claimed.payload) !== canonicalDigest(claimedPayload)
      || _recoveryBatchIdentity('recovery_refinement_create_claim', [prior, claimed]) !== prior.batch.id) {
      throw new CoordinationRefusal('recovery refinement idempotency conflict', 'recovery_refinement_conflict');
    }
    _validateRecoveryRefinementPair(store, prior, claimed, false);
    return freeze({ ok: true, result: 'idempotent', createdEvent: clone(prior), claimedEvent: clone(claimed), task: store.task(fields.id) });
  }
  if (store._tasks.has(fields.id)) {
    throw new CoordinationRefusal('recovery refinement target is unavailable', 'recovery_refinement_unavailable');
  }
  store._assertRunAdmissionOpen(fields.runId ?? null);
  const fixedTs = store._clock();
  const [createdEvent, claimedEvent] = store._appendBatch([
    { kind: 'task.created', payload: createdPayload, auth, fixedTs },
    { kind: 'task.claimed', payload: claimedPayload, auth: { actor: auth.actor, key: `${auth.key}:claim` }, fixedTs },
  ], 'recovery_refinement_create_claim');
  const task = store.task(fields.id);
  if (!task || task.status !== 'working' || task.assignee !== fields.reservedWorkerId || task.version !== 2) {
    throw new CoordinationIntegrityError('recovery refinement batch did not materialize exactly', 'recovery_refinement_integrity');
  }
  return freeze({ ok: true, result: 'claimed', createdEvent: clone(createdEvent), claimedEvent: clone(claimedEvent), task });
}

/** Moved from `CoordinationStore.admitRecoveryAttempt` (issue #259 slice 1). State: the store, passed explicitly. */
export function admitRecoveryAttempt(store, fields, auth) {
  const prior = store._byKey.get(auth?.key);
  if (prior) {
    _normalizeRecoveryAttemptAdmission(store, fields, false);
    if (prior.kind !== 'recovery.attempt_admitted' || prior.actor !== auth?.actor
      || canonicalDigest(prior.payload) !== canonicalDigest(fields)) {
      throw new CoordinationRefusal('recovery attempt admission idempotency conflict', 'recovery_attempt_conflict');
    }
    const attempt = recoveryAttempt(store, prior.payload.attemptId);
    if (!attempt || attempt.admittedEvent !== prior.seq) {
      throw new CoordinationIntegrityError('recovery attempt projection is absent', 'recovery_attempt_integrity');
    }
    return freeze({ ok: true, result: 'replay', event: clone(prior), attempt });
  }
  const prospective = {
    schemaVersion: 1, seq: store._events.length + 1, ts: store._clock(),
    kind: 'recovery.attempt_admitted', actor: auth?.actor,
    idempotencyKey: auth?.key, payload: clone(fields),
  };
  const admission = store._validateRecoveryAttemptAdmissionPayload(fields, prospective, false);
  if (auth?.key !== `recovery.attempt:${admission.attemptId}`) {
    throw new CoordinationRefusal('recovery attempt idempotency key is invalid', 'recovery_attempt_invalid');
  }
  const event = store._append('recovery.attempt_admitted', clone(admission), auth, prospective.ts);
  const attempt = recoveryAttempt(store, admission.attemptId);
  if (!attempt || attempt.state !== 'pending' || attempt.admittedEvent !== event.seq) {
    throw new CoordinationIntegrityError('recovery attempt admission did not materialize', 'recovery_attempt_integrity');
  }
  return freeze({ ok: true, result: 'admitted', event: clone(event), attempt });
}

/** Moved from `CoordinationStore.completeRecoveryAttempt` (issue #259 slice 1). State: the store, passed explicitly. */
export function completeRecoveryAttempt(store, fields, auth) {
  const prior = store._byKey.get(auth?.key);
  if (prior) {
    if (prior.kind !== 'recovery.attempt_completed' || prior.actor !== auth?.actor
      || canonicalDigest(prior.payload) !== canonicalDigest(fields)) {
      throw new CoordinationRefusal('recovery attempt completion idempotency conflict', 'recovery_attempt_conflict');
    }
    const attempt = recoveryAttempt(store, prior.payload.attemptId);
    if (!attempt || attempt.completedEvent !== prior.seq) {
      throw new CoordinationIntegrityError('recovery attempt completion projection is absent', 'recovery_attempt_integrity');
    }
    return freeze({ ok: true, result: 'replay', event: clone(prior), attempt });
  }
  const prospective = {
    schemaVersion: 1, seq: store._events.length + 1, ts: store._clock(),
    kind: 'recovery.attempt_completed', actor: auth?.actor,
    idempotencyKey: auth?.key, payload: clone(fields),
  };
  const completion = _validateRecoveryAttemptCompletionPayload(store, fields, prospective, false);
  if (auth?.key !== `recovery.attempt.complete:${completion.payload.attemptId}`) {
    throw new CoordinationRefusal('recovery attempt completion key is invalid', 'recovery_attempt_completion_invalid');
  }
  const event = store._append('recovery.attempt_completed', clone(completion.payload), auth, prospective.ts);
  const attempt = recoveryAttempt(store, completion.payload.attemptId);
  if (!attempt || attempt.state !== completion.payload.state || attempt.completedEvent !== event.seq) {
    throw new CoordinationIntegrityError('recovery attempt completion did not materialize', 'recovery_attempt_integrity');
  }
  return freeze({ ok: true, result: 'completed', event: clone(event), attempt });
}

/** Moved from `CoordinationStore.recoveryAttempt` (issue #259 slice 1). State: the store, passed explicitly. */
export function recoveryAttempt(store, attemptId) {
  return clone(store._recoveryAttemptsById.get(attemptId) ?? null);
}

/** Moved from `CoordinationStore.recoveryAttemptHead` (issue #259 slice 1). State: the store, passed explicitly. */
export function recoveryAttemptHead(store, seriesId) {
  const attemptId = store._recoveryAttemptHeads.get(seriesId);
  return attemptId ? recoveryAttempt(store, attemptId) : null;
}

/** Moved from `CoordinationStore.pendingRecoveryAttempts` (issue #259 slice 1). State: the store, passed explicitly. */
export function pendingRecoveryAttempts(store, limit = 1_000) {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100_000) {
    throw new TypeError('recovery attempt scan limit is invalid');
  }
  return [...store._recoveryAttemptsById.values()].filter((attempt) => attempt.state === 'pending')
    .sort((left, right) => left.admittedEvent - right.admittedEvent)
    .slice(0, limit).map(clone);
}

/** Moved from `CoordinationStore.reapExpiredContextPacks` (issue #259 slice 1). State: the store, passed explicitly.
 *
 * The receipt names what the scan OBSERVED (2026-09-14 audit, swarm-b/lead.md finding 9): the store
 * keeps no reclamation path — a minted context pack is durable append-only history and nothing here
 * removes one — so `reaped` stays 0 and the packs past their validity are reported as `expired`.
 * Reporting them as `reaped: N` claimed N removals that never happened. A reclamation path, if one
 * is ever built, increments `reaped` in the same place it deletes the pack.
 */
export function reapExpiredContextPacks(store, repoId) {
  void repoId;
  const now = Date.parse(store._clock());
  let expired = 0;
  for (const pack of store._contextPacks.values()) {
    if (Date.parse(pack.validity) <= now) expired += 1;
  }
  return freeze({ expired, reaped: 0 });
}

/** Moved from `CoordinationStore.recordRecoveryContinuationIntent` (issue #259 slice 1). State: the store, passed explicitly. */
export function recordRecoveryContinuationIntent(store, fields, auth) {
  const payload = { kind: 'recovery.continuation_intent', ...clone(fields) };
  const prior = store._byKey.get(auth?.key);
  if (prior) {
    if (prior.kind !== 'driver.recorded' || prior.actor !== auth.actor
      || canonicalDigest(prior.payload) !== canonicalDigest(payload)) {
      throw new CoordinationRefusal('recovery intent idempotency conflict', 'recovery_dispatch_conflict');
    }
    const state = recoveryDispatchState(store, fields.workerId);
    if (!state || state.intentSeq !== prior.seq) throw new CoordinationIntegrityError('recovery intent projection is absent', 'recovery_dispatch_integrity');
    return freeze({ ok: true, result: 'idempotent', event: clone(prior), dispatch: state });
  }
  const prospective = {
    schemaVersion: 1, seq: store._events.length + 1, ts: store._clock(), kind: 'driver.recorded',
    actor: auth?.actor, idempotencyKey: auth?.key, payload,
  };
  store._validateRecoveryContinuationPayload(payload, prospective, false);
  const event = store._append('driver.recorded', payload, auth, prospective.ts);
  const dispatch = recoveryDispatchState(store, fields.workerId);
  if (dispatch?.intentSeq !== event.seq || dispatch.status !== 'dispatch_unknown') {
    throw new CoordinationIntegrityError('recovery intent did not materialize as unknown', 'recovery_dispatch_integrity');
  }
  return freeze({ ok: true, result: 'recorded', event: clone(event), dispatch });
}

/** Moved from `CoordinationStore.completeRecoveryDispatch` (issue #259 slice 1). State: the store, passed explicitly. */
export function completeRecoveryDispatch(store, fields, auth) {
  const disposition = fields?.disposition;
  if (!['accepted', 'refused'].includes(disposition)) throw new CoordinationRefusal('recovery disposition is invalid', 'recovery_dispatch_invalid');
  const { disposition: _ignored, ...request } = clone(fields);
  const payload = {
    kind: disposition === 'accepted' ? 'recovery.dispatch_accepted' : 'recovery.dispatch_refused',
    ...request,
  };
  const prior = store._byKey.get(auth?.key);
  if (prior) {
    if (prior.kind !== 'driver.recorded' || prior.actor !== auth.actor
      || canonicalDigest(prior.payload) !== canonicalDigest(payload)) {
      throw new CoordinationRefusal('recovery disposition idempotency conflict', 'recovery_dispatch_conflict');
    }
    const dispatch = recoveryDispatchState(store, fields.workerId);
    if (!dispatch || dispatch.receiptSeq !== prior.seq) throw new CoordinationIntegrityError('recovery disposition projection is absent', 'recovery_dispatch_integrity');
    const task = store.task(fields.taskId);
    if (disposition === 'refused') {
      const transitioned = store._events[prior.seq];
      const expectedTransition = {
        id: fields.taskId, from: 'working', to: 'failed', expectedVersion: 2, newVersion: 3,
        evidence: clone(fields.evidence),
      };
      if (prior.batch?.kind !== 'recovery_dispatch_refusal' || prior.batch.index !== 0 || prior.batch.count !== 2
        || transitioned?.kind !== 'task.transitioned' || transitioned.actor !== prior.actor
        || transitioned.idempotencyKey !== `${auth.key}:task` || transitioned.ts !== prior.ts
        || transitioned.batch?.id !== prior.batch.id || transitioned.batch?.index !== 1
        || canonicalDigest(transitioned.payload) !== canonicalDigest(expectedTransition)
        || _recoveryBatchIdentity('recovery_dispatch_refusal', [prior, transitioned]) !== prior.batch.id
        || task?.status !== 'failed' || task.terminalEvent !== transitioned.seq) {
        throw new CoordinationIntegrityError('recovery refusal task closure is absent', 'recovery_dispatch_integrity');
      }
      return freeze({ ok: true, result: 'idempotent', event: clone(prior), taskEvent: clone(transitioned), task, dispatch });
    }
    return freeze({ ok: true, result: 'idempotent', event: clone(prior), task, dispatch });
  }
  const prospective = {
    schemaVersion: 1, seq: store._events.length + 1, ts: store._clock(), kind: 'driver.recorded',
    actor: auth?.actor, idempotencyKey: auth?.key, payload,
  };
  _validateRecoveryDispositionPayload(store, payload, prospective, false);
  if (disposition === 'accepted') {
    const event = store._append('driver.recorded', payload, auth, prospective.ts);
    const dispatch = recoveryDispatchState(store, fields.workerId);
    if (dispatch?.receiptSeq !== event.seq || dispatch.status !== 'dispatch_accepted') {
      throw new CoordinationIntegrityError('accepted recovery dispatch did not materialize', 'recovery_dispatch_integrity');
    }
    return freeze({ ok: true, result: 'accepted', event: clone(event), task: store.task(fields.taskId), dispatch });
  }
  const task = store._tasks.get(fields.taskId);
  if (!task || task.status !== 'working' || task.assignee !== fields.workerId) {
    throw new CoordinationRefusal('recovery refusal task is not the live claimed refinement', 'recovery_dispatch_conflict');
  }
  const transitionedPayload = {
    id: task.id, from: task.status, to: 'failed', expectedVersion: task.version,
    newVersion: task.version + 1, evidence: clone(fields.evidence),
  };
  const [event, taskEvent] = store._appendBatch([
    { kind: 'driver.recorded', payload, auth, fixedTs: prospective.ts },
    { kind: 'task.transitioned', payload: transitionedPayload, auth: { actor: auth.actor, key: `${auth.key}:task` }, fixedTs: prospective.ts },
  ], 'recovery_dispatch_refusal');
  const dispatch = recoveryDispatchState(store, fields.workerId);
  const closedTask = store.task(fields.taskId);
  if (dispatch?.receiptSeq !== event.seq || dispatch.status !== 'dispatch_refused' || closedTask?.status !== 'failed') {
    throw new CoordinationIntegrityError('refused recovery dispatch did not close atomically', 'recovery_dispatch_integrity');
  }
  return freeze({ ok: true, result: 'refused', event: clone(event), taskEvent: clone(taskEvent), task: closedTask, dispatch });
}

/** Moved from `CoordinationStore._scratchpadReapReceipt` (issue #259 slice 1). State: the store, passed explicitly. */
export function _scratchpadReapReceipt(store, prior, result = 'idempotent') {
  const reap = store._scratchpadReaps.find((row) => row.eventSeq === prior.seq);
  if (!reap) throw new CoordinationIntegrityError('scratchpad reap receipt is absent', 'scratchpad_reap_integrity');
  const elevated = reap.dispositions.filter((row) => row.result === 'elevated').map((row) => {
    const successor = [...store._scratchpadElevations.values()]
      .find((binding) => binding.sourceEntryId === row.entryId && binding.sharedEntryId === row.targetId);
    const shared = successor ? store._scratchpadEntries.get(successor.sharedEntryId) : null;
    return {
      sourceEntryId: row.entryId, sharedEntryId: row.targetId,
      sharedEntryDigest: successor?.sharedEntryDigest ?? null,
      scratchFactId: shared?.scratchFactId ?? null,
    };
  }).sort((a, b) => compareCanonicalStrings(a.sourceEntryId, b.sourceEntryId));
  return { reap, elevated, result };
}

/** Moved from `CoordinationStore.reapRunScratchpads` (issue #259 slice 1). State: the store, passed explicitly. */
export function reapRunScratchpads(store, runId) {
  if (!validRunId(runId) || (!store._runStopByTarget.has(runId) && !store._runStops.has(runId))) {
    throw new CoordinationRefusal('scratchpad stop cleanup requires a stopping Run', 'run_stopping');
  }
  const partitions = [];
  for (const [key, ids] of store._scratchpadEntriesByScope) {
    const [entryRunId, scope] = JSON.parse(key);
    if (entryRunId !== runId || ids.length === 0) continue;
    const first = store._scratchpadEntries.get(ids[0]);
    partitions.push({ scope, taskId: scope === 'shared' ? null : first.taskId, workerId: scope === 'shared' ? null : first.workerId });
  }
  partitions.sort((left, right) => {
    if (left.scope === 'shared') return 1;
    if (right.scope === 'shared') return -1;
    return compareCanonicalStrings(left.taskId, right.taskId)
      || compareCanonicalStrings(left.workerId, right.workerId);
  });
  const selected = partitions.slice(0, MAX_SCRATCHPAD_STOP_PARTITIONS_PER_PASS);
  const reaped = [];
  for (const partition of selected) {
    const scopeKey = scratchpadScopeKey(runId, partition.scope);
    const rows = (store._scratchpadEntriesByScope.get(scopeKey) ?? [])
      .map((id) => store._scratchpadEntries.get(id))
      .sort((a, b) => compareCanonicalStrings(a.entryId, b.entryId));
    const observedFence = store.scratchpadFence(runId, partition.scope);
    const dispositions = rows.map((row) => ({
      entryId: row.entryId, entryDigest: row.entryDigest,
      result: 'stopped', targetId: null, reasonCode: 'run_stopped',
    }));
    const dispositionDigest = canonicalDigest(dispositions);
    const reapKey = partition.scope === 'shared'
      ? `scratchpad.partition_reaped:${runId}:shared:${observedFence}`
      : `scratchpad.partition_reaped:${runId}:${partition.taskId}:${observedFence}`;
    const facts = partition.scope === 'shared'
      ? rows.filter((row) => row.scratchFactId).map((row) => store._scratchFacts.get(row.scratchFactId))
        .filter((fact) => fact?.active).sort((a, b) => compareCanonicalStrings(a.id, b.id))
      : [];
    const events = store._appendBatch([{
      kind: 'scratchpad.partition_reaped',
      payload: {
        schemaVersion: 1, runId, scope: partition.scope, taskId: partition.taskId,
        observedFence, dispositions, dispositionDigest, basis: 'run_stopped',
      },
      auth: { actor: 'policy', key: reapKey },
    }, ...facts.map((fact) => ({
      kind: 'scratch.fact_expired', payload: { id: fact.id },
      auth: { actor: 'policy', key: `${reapKey}:fact:${fact.id}` },
    }))], 'scratchpad_stop_cleanup');
    reaped.push({
      scope: partition.scope, taskId: partition.taskId, reapEventSeq: events[0].seq,
      dispositionDigest, expiredScratchFactIds: facts.map((fact) => fact.id),
    });
  }
  const remaining = partitions.slice(selected.length);
  let remainingEntries = 0; let remainingBridgeFacts = 0;
  for (const partition of remaining) {
    const ids = store._scratchpadEntriesByScope.get(scratchpadScopeKey(runId, partition.scope)) ?? [];
    remainingEntries += ids.length;
    remainingBridgeFacts += ids.map((id) => store._scratchpadEntries.get(id))
      .filter((row) => row?.scratchFactId && store._scratchFacts.get(row.scratchFactId)?.active).length;
  }
  const next = remaining[0] ?? null;
  return freeze({
    ok: true, result: remaining.length > 0 ? 'partial' : 'complete', runId, reaped,
    nextPartition: next ? { scope: next.scope, taskId: next.taskId, workerId: next.workerId } : null,
    remainingPartitions: remaining.length, remainingEntries, remainingBridgeFacts,
  });
}

/** Moved from `CoordinationStore.orphans` (issue #259 slice 1). State: the store, passed explicitly. */
export function orphans(store, { liveWorkers = [] } = {}) {
  const live = new Set(Array.isArray(liveWorkers) ? liveWorkers : []);
  const lastGeneration = new Map();
  for (const event of store._events) {
    if (event.kind === 'worker.generation_bound') {
      lastGeneration.set(event.payload.workerId, event.payload);
    }
  }
  const rows = [];
  for (const task of store._tasks.values()) {
    if (TERMINAL.has(task.status)) continue;
    const workerId = task.assignee ?? task.reservedWorkerId ?? null;
    if (workerId === null) continue;
    if (task.status === 'retry_pending') {
      rows.push({ taskId: task.id, workerId, status: task.status,
        processGeneration: lastGeneration.get(workerId)?.processGeneration ?? null });
      continue;
    }
    if (live.has(workerId)) continue;
    const generation = lastGeneration.get(workerId);
    // A claimed task with NO durable generation record is pre-A2-3 legacy state — surface it
    // (absence of the binding cannot prove the claimant lives).
    rows.push({ taskId: task.id, workerId, status: task.status,
      processGeneration: generation?.processGeneration ?? null });
  }
  return rows;
}
