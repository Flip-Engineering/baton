// coordination-replay.mjs — issue #259, slice 1 (slice 2 added the last nine members the store held):
// the CoordinationStore restart seam.
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
// one-line delegates, so every call site is untouched. Slice 2 relocated the nine recovery validators
// two pinned source scans had keyed to the store file, which is why this module is a seam-map target:
// a moved member stays mapped, by name, in its new home.

import { compareCanonicalStrings } from './canonical-order.mjs';
import { buildAuthoritativeBrief, goalPlanDigest, planBriefMatches, planRouteMatches } from './goal-plan.mjs';
import { normalizeRecoveryAttemptAdmission, normalizeRecoveryAttemptCompletion } from './recovery-attempt.mjs';
import { isPhysicalWorkspaceId } from './shared-workspace-custody.mjs';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { deserialize } from 'node:v8';
import { FRAME_LIMITS } from './limits.mjs';
import {
  COORDINATION_QUARANTINE_FILE,
  CoordinationIntegrityError,
  CoordinationRefusal,
  PROJECTION_CHECKPOINT_FIELDS,
  SEGMENT_FILE_SUFFIX,
  SEGMENT_INDEX_FILE,
  TERMINAL,
  boundedText,
  canonical,
  canonicalBytes,
  canonicalDigest,
  clone,
  digest,
  freeze,
  scratchpadScopeKey,
  sha256Bytes,
  validRunId,
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
  const report = clone({
    ...state,
    poison: store._projectionPoison ?? null,
    quarantined: store._quarantine instanceof Map
      ? [...store._quarantine.keys()].sort((left, right) => left - right) : [],
  });
  // Issue #397: 'checkpoint corrupt' never reports without the invariant that failed and the
  // compared values. They attach as NON-ENUMERABLE own properties: the startup report's
  // enumerable shape is the exact contract deepEqual-pinned by the phase92 and
  // coordination-internals suites, and JSON/spread surfaces compose from those pinned fields —
  // a reader that wants the diagnosis takes the properties directly (the flip line and the
  // doctor's coordination row must read them explicitly, never via spread/JSON).
  if (state.checkpoint === 'corrupt' || state.checkpoint === 'stale_authority'
    || state.checkpoint === 'stale_shape' || state.checkpoint === 'stale_ledger') {
    const restore = store._checkpointRestoreReport ?? null;
    if (restore !== null) {
      Object.defineProperty(report, 'checkpointReason', { value: restore.reason, enumerable: false });
      Object.defineProperty(report, 'checkpointDetail', { value: clone(restore.detail), enumerable: false });
    }
  }
  // Issue #449: the open's own two checkpoint facts — the rewrite it performed after replaying the
  // ledger in full for a stale shape, and the temp files it swept. Same discipline as #397's
  // reason/detail above, and for the same reason: the enumerable startup shape stays exact, so a
  // spread/JSON reader never sees them and the flip line / doctor row read them explicitly.
  if (store._checkpointRewrite !== null) {
    Object.defineProperty(report, 'checkpointRewrite', {
      value: clone(store._checkpointRewrite), enumerable: false,
    });
  }
  if (store._checkpointSweep !== null) {
    Object.defineProperty(report, 'checkpointSwept', {
      value: clone(store._checkpointSweep), enumerable: false,
    });
  }
  return report;
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

/** Issue #351 lane 2: the chunk bound every replay stretch obeys. DERIVED, never invented —
 * `view.wake_replay.items` is the registry's own ceiling for how many ledger rows one replay
 * carries (the same row that bounds the release-time checkpoint), so it is also the bound the
 * startup replay folds per synchronous stretch before the event loop is offered a breath. */
const REPLAY_CHUNK_EVENTS = FRAME_LIMITS['view.wake_replay.items'].value;

/** One macrotask of loop freedom between replay chunks. */
const _loopYield = () => new Promise((resolve) => setImmediate(resolve));

/** Moved from `CoordinationStore._load` (issue #259 slice 1). State: the store, passed explicitly.
 * Issue #351 lane 2: split at its only yieldable seam. `_loadPlan` does the bounded prelude
 * (ledger read, segment index, checkpoint restore, tail split — each a single bounded stretch
 * whose cost is the artifact format's own, not the history's), and `_loadRun` folds the history
 * in chunks of REPLAY_CHUNK_EVENTS events. One fold path, two cadences: the default drains the
 * chunk generator plainly (every fold error propagates SYNCHRONOUSLY — the constructor either
 * returns fully loaded or throws, never a half-loaded store), and `{ async: true }` awaits a
 * macrotask between chunks instead, so a startup heartbeat and a signal handler keep beating
 * however long the history is.
 *
 * Issue #285 G-7: ONE progress record (`{ folded, last }`) rides the whole open — the rows the
 * fold step has processed, and the report last composed from it. Every fold stretch republishes
 * as the count advances (the archived prefix included), and a failed open reports the counts it
 * already reached instead of zeros. */
export function _load(store, opts = {}) {
  const progress = { folded: 0, last: null };
  if (opts.async === true) {
    return (async () => {
      try {
        const plan = _loadPlan(store, progress);
        const run = _loadRun(store, plan, progress);
        for (;;) {
          const step = run.next();
          if (step.done) break;
          await _loopYield();
        }
      } catch (error) {
        _reportLoadFailure(store, error, progress);
        throw error;
      }
    })();
  }
  try {
    const plan = _loadPlan(store, progress);
    // Plain `.next()` drain: the fold errors propagate SYNCHRONOUSLY — no microtask can slip
    // into the synchronous open.
    const run = _loadRun(store, plan, progress);
    let step;
    do { step = run.next(); } while (!step.done);
  } catch (error) {
    _reportLoadFailure(store, error, progress);
    throw error;
  }
}

/** Compose one startup report and keep it as the open's live progress record (issue #285 G-7):
 * every republish and the failure report read the same record. */
function _reportProgress(store, progress, value) {
  progress.last = value;
  _reportStartup(store, value);
}

/** Issue #285 G-7: the failure report keeps the counts the open already had — the last report's
 * plan totals, source and checkpoint judgement, and the LIVE fold count, which is ahead of the
 * last republish by up to one chunk. The row that refused is still named, the one durable fact
 * an operator repairs from (issue #290). */
function _reportLoadFailure(store, error, progress = null) {
  const last = progress?.last ?? null;
  _reportProgress(store, progress ?? { last: null }, {
    schemaVersion: 1, state: 'failed',
    source: last?.source ?? 'ledger',
    totalEvents: last?.totalEvents ?? 0,
    checkpointEvents: last?.checkpointEvents ?? 0,
    replayedEvents: Math.max(last?.replayedEvents ?? 0, progress?.folded ?? 0),
    checkpoint: last?.checkpoint ?? 'unusable',
    failure: {
      code: error?.code ?? 'coordination_startup_failed',
      seq: error?.coordinationSeq ?? null,
    },
  });
}

/** Issue #465(4): the restore states whose checkpoint is not used — the ledger is folded in full and
 * the open owes the next open a cache (`_openCheckpointRefresh`). `valid` adopts its projections;
 * `absent`/`unchecked` had no cache to consider. */
const CHECKPOINT_FALLBACK_STATES = Object.freeze(['corrupt', 'stale_shape', 'stale_authority', 'stale_ledger']);

/** The source token the open reports for one restore state: which artifacts the rows came from. ONE
 * derivation, read by the plan's own report and by the fold when an adoption is abandoned mid-run. */
function _replaySource(checkpointState, { base, tailRows, ledgerBytes }) {
  if (checkpointState === 'valid') {
    if (base > 0) return tailRows > 0 ? 'segments_checkpoint_tail' : 'segments_checkpoint';
    return tailRows > 0 ? 'checkpoint_tail' : 'checkpoint';
  }
  if (CHECKPOINT_FALLBACK_STATES.includes(checkpointState)) {
    return base > 0 ? 'segments_ledger_fallback' : 'ledger_fallback';
  }
  if (base > 0) return 'segments_ledger';
  return ledgerBytes === 0 ? 'empty' : 'ledger';
}

function _loadPlan(store, progress) {
  const raw = existsSync(store.file) ? readFileSync(store.file) : Buffer.alloc(0);
  _reportProgress(store, progress, {
    schemaVersion: 1, state: 'starting', source: 'ledger', totalEvents: 0,
    checkpointEvents: 0, replayedEvents: 0, checkpoint: 'unchecked', failure: null,
  });
  // Issue #290: the quarantine ledger is loaded before any replay so every fold below (and
  // every checkpoint restore path) skips exactly the seqs a repair has durably quarantined.
  loadQuarantine(store);
  // Issue #449(3): a write that died mid-flight leaves its temp file beside the checkpoint and
  // nothing else ever removes it. Swept here, at the open's own housekeeping seam (before the
  // restore reads anything), with the names kept for the open's report/narration.
  store._checkpointSweep = store._sweepProjectionCheckpointTemps();
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
  // Issue #465(4): the ledger is read in TWO stretches — the rows the checkpoint's projection covers
  // (`1..coversSeq`, rebuilt and not folded) and the tail past them (rebuilt AND folded). A fallback
  // covers nothing (`coversSeq` is the archival cut), so the whole ledger is one tail. Both stretches
  // are parsed here, in the plan: the split is the checkpoint's own claim, and the fold below does
  // the work.
  const prefixLines = _ledgerLines(raw.subarray(0, checkpoint.prefixBytes));
  const lines = _ledgerLines(raw.subarray(checkpoint.prefixBytes));
  const totalEvents = checkpoint.coversSeq + lines.length;
  const source = _replaySource(checkpoint.state, { base, tailRows: lines.length, ledgerBytes: raw.byteLength });
  _reportProgress(store, progress, {
    schemaVersion: 1, state: 'replaying',
    source,
    totalEvents, checkpointEvents: checkpoint.coversSeq - base, replayedEvents: 0,
    checkpoint: checkpoint.state, failure: null,
  });
  return {
    raw, base, segments, checkpoint, prefixLines, lines, totalEvents, source,
  };
}

/** The lines of one ledger stretch, with the exact-UTF-8 law the ledger already obeys (issue #290:
 * a stretch that is not the exact bytes it claims is refused, never parsed loosely). */
function _ledgerLines(bytes) {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    throw new CoordinationIntegrityError('coordination stream is not exact UTF-8', 'invalid_utf8');
  }
  return text.length === 0 ? [] : text.slice(0, -1).split('\n');
}

/** The replay's fold work as a GENERATOR that yields at chunk boundaries — never awaiting on
 * its own. The default `_load` drains it with `.next()` in a plain loop, so every fold
 * error propagates SYNCHRONOUSLY to the constructor (a half-loaded store can never survive a
 * failed open); the `{ async: true }` mode awaits a macrotask between `.next()` calls instead.
 * One fold path, two cadences, no microtask can slip into the synchronous open. */
function* _loadRun(store, plan, progress) {
  const { raw, base, segments, checkpoint, prefixLines, lines, totalEvents, source } = plan;
  // The restore state this fold ends on: an adoption that the ledger does not back abandons the
  // checkpoint mid-fold (issue #465(4)), and the report, the source and the rewrite below then name
  // the ledger's own truth rather than the state the plan was composed with.
  let restoredState = checkpoint.state;
  let restoredCoversSeq = checkpoint.coversSeq;
  let restoredSource = source;
  let adopted = false;
  store._loading = true;
  try {
    // Issue #465(4): ONE derivation of "the ledger says this row" — shared by the cold replay path
    // and by the rebuild the checkpoint path performs, so a row is judged identically on both. It
    // reads the row (schema, sequence contiguity, idempotency key) into the projection's two
    // ledger-copy families and answers it, frozen; the FOLD is a separate step (`foldRow`), because
    // the rows a checkpoint's projection already covers are read back but never re-folded.
    const readRow = (event, index) => {
      if (event.schemaVersion !== 1) throw new CoordinationIntegrityError(`unsupported schema version at seq ${event.seq}`, 'schema_version');
      if (event.seq !== index + 1) throw new CoordinationIntegrityError(`coordination sequence gap at line ${index + 1}`, 'sequence_gap');
      if (typeof event.idempotencyKey !== 'string' || store._byKey.has(event.idempotencyKey)) {
        throw new CoordinationIntegrityError(`duplicate/missing idempotency key at seq ${event.seq}`, 'duplicate_key');
      }
      const frozen = freeze(event);
      store._events.push(frozen);
      store._byKey.set(frozen.idempotencyKey, frozen);
      return frozen;
    };
    // Issue #290: a quarantined seq keeps its durable bytes parsed in the ledger (sequence
    // contiguity, idempotent-retry adjudication, and checkpoint byte-equality all hold); only the
    // fold that refused is withheld. Any fold failure names its seq and kind so an operator can pass
    // exactly that seq to the quarantine verb.
    const foldRow = (frozen) => {
      // Issue #285 G-7: a quarantined row is still a row the fold step processed, and the counter
      // carries the arithmetic the live-window loop always published — every iterated row.
      if (store._quarantine.has(frozen.seq)) { progress.folded += 1; return; }
      try { store._apply(frozen); }
      catch (error) {
        error.coordinationSeq = frozen.seq;
        error.coordinationKind = frozen.kind;
        throw error;
      }
      progress.folded += 1;
    };
    const parsed = (line, label) => {
      try { return JSON.parse(line); }
      catch { throw new CoordinationIntegrityError(`invalid JSON at ${label}`, 'invalid_json'); }
    };
    // One bounded stretch = at most REPLAY_CHUNK_EVENTS read (or folded) events. The segment file
    // read and the checkpoint restore outside this counter are the artifact formats' own bounds.
    let sinceYield = 0;
    const breathe = () => { sinceYield += 1; if (sinceYield < REPLAY_CHUNK_EVENTS) return false; sinceYield = 0; return true; };
    // Issue #285 G-7: every fold stretch republishes as it advances. The report reads `progress`
    // (the live count) and the state the fold will END on — `restoredState`/`restoredCoversSeq`/
    // `restoredSource`, all fixed by the adoption decision before the first fold runs — so a
    // reader of the startup row sees the archived prefix's progress instead of a zero that moves
    // only once the live window is reached.
    const reportProgress = () => _reportProgress(store, progress, {
      schemaVersion: 1, state: 'replaying', source: restoredSource, totalEvents,
      checkpointEvents: restoredCoversSeq - base, replayedEvents: progress.folded,
      checkpoint: restoredState, failure: null,
    });
    // Issue #285 G-14: the archived prefix is read back but NOT folded here. The digest,
    // UTF-8 and truncation proofs above are the integrity boundary and stay unconditioned;
    // every row is still parsed and indexed (`readRow` rebuilds `_events`/`_byKey`, so the
    // event-sourcing law holds). The FOLD is the adoption decision's to skip: when the
    // checkpoint below adopts, its carried projection already IS the archived prefix's
    // state, and re-folding it would buy nothing; when nothing adopts, the cold path folds
    // these same rows in order with the covered window rows (`if (!adopted)` below), exactly
    // once — the previous shape folded them here AND there.
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
        const index = segment.fromSeq - 1 + offset;
        readRow(parsed(segmentLines[offset], `coordination segment ${segment.digest} line ${offset + 1}`), index);
        if (breathe()) yield;
      }
    }
    // The rows the checkpoint's projection covers: read back from the ledger file the checkpoint's
    // digest proved, indexed, and NOT folded — the state that fold produced is the body's.
    for (let offset = 0; offset < prefixLines.length; offset += 1) {
      readRow(parsed(prefixLines[offset], `coordination line ${base + offset + 1}`), base + offset);
      if (breathe()) yield;
    }
    if (checkpoint.projection !== null) {
      const problem = yield* _adoptProjectionCheckpoint(store, checkpoint);
      if (problem === null) {
        adopted = true;
        _reverifyAdoptedProviderDeliveries(store);
      } else {
        // The body and the ledger disagree (a reference the ledger cannot back): the body is not
        // adoptable, and the ledger is authoritative — every covered row folds after all.
        restoredState = 'stale_ledger';
        restoredCoversSeq = base;
        restoredSource = _replaySource('stale_ledger', { base, tailRows: lines.length, ledgerBytes: raw.byteLength });
        store._checkpointRestoreReport = freeze({ reason: 'reference_unresolved', detail: clone(problem) });
      }
    }
    if (!adopted) {
      // The covered rows — the archived segment rows read above first, then the covered
      // window rows, in the order they were read — folded exactly once: the cold path's
      // own work (issue #285 G-14: the segment loop above reads but never folds).
      for (let index = 0; index < store._events.length; index += 1) {
        foldRow(store._events[index]);
        if (breathe()) { reportProgress(); yield; }
      }
    }
    // The tail's first ledger position is the row count the covered stretch holds:
    // `checkpoint.coversSeq`, which the restore's claim proof pins to
    // `base + prefixLines.length` in every restore state. `restoredCoversSeq` carries the
    // report's adoption state (the abandon path holds `base`); the fold indexes ledger
    // positions, so it reads the position from the checkpoint's claim.
    const tailFrom = checkpoint.coversSeq;
    for (let offset = 0; offset < lines.length; offset += 1) {
      const index = tailFrom + offset;
      foldRow(readRow(parsed(lines[offset], `coordination line ${index + 1}`), index));
      if (breathe()) { reportProgress(); yield; }
    }
    _validateRecoveryReplayTransactions(store);
    _validateGoalPlanReplayTransactions(store);
  } finally { store._loading = false; }
  store._loadedLedgerHash = createHash('sha256').update(raw);
  store._loadedLedgerIdentity = freeze({
    bytes: raw.byteLength, digest: store._loadedLedgerHash.copy().digest('hex'),
    events: store._events.length,
  });
  // Issue #449: the open that could not serve itself from the checkpoint on disk has just folded the
  // projection by replaying, and owes the NEXT open a cache — `_openCheckpointRefresh` is the store's
  // ONE rule for which states those are and what the row says, so this call site names no state and
  // no reason of its own. It is a GENERATOR: `yield*` runs the write's own bounded stretches as
  // yields of THIS fold, so the async open breathes between them exactly as it does between replay
  // chunks (and the synchronous constructor drains them back-to-back). Recorded BEFORE 'ready' is
  // reported, so a reader that observes ready observes the cache; a write that cannot land is
  // reported, never raised — the ledger stays authoritative.
  store._checkpointRewrite = yield* store._openCheckpointRefresh(restoredState);
  _reportProgress(store, progress, {
    schemaVersion: 1, state: 'ready', source: restoredSource, totalEvents,
    checkpointEvents: restoredCoversSeq - base,
    replayedEvents: progress.folded,
    checkpoint: restoredState, failure: null,
  });
}

/** Issue #465(4): install the projection the checkpoint carries — the state rows 1..coversSeq were
 * folded into by the process that wrote it, which is why this fold does not redo that work. The
 * store's own rendering is inverted first (`_materializedProjectionCheckpoint`: every reference the
 * body minted is resolved back through the ledger rows this open just read), so what installs is
 * the state a cold replay would hold. It yields between families — a real body carries ~100 of them
 * and the open-liveness law (#351 lane 4) binds every open, not only the fold — and answers the
 * {field, reference} problem when a pair the body minted names text the ledger does not hold; the
 * caller then folds the ledger instead of adopting a body that disagrees with it. */
function* _adoptProjectionCheckpoint(store, checkpoint) {
  const { projection: materialized, problem } = store._materializedProjectionCheckpoint(
    checkpoint.projection, checkpoint.dictionaryFields,
  );
  if (problem !== null) return problem;
  for (const field of PROJECTION_CHECKPOINT_FIELDS) {
    store[field] = _adoptedRows(materialized[field]);
    yield;
  }
  return null;
}

/** Issue #465(4): freeze the ROWS an adopted family holds, never the container itself. Every row the
 * fold writes is frozen and every projection CONTAINER is mutable — the fold resolves an append by
 * `Map.set`/`Array.push` on it — so an adopted family must keep the body's own (deserialized,
 * extensible) container while its rows take the law the fold's rows already obey. Freezing the
 * container here would refuse the next append with `Cannot add property…, object is not extensible`.
 * A Map value that is itself an Array (e.g. _knowledgeNodeHistory) is also a mutable container:
 * the fold appends to it with `history.push(version)`, so the array stays extensible while each
 * element it holds is frozen. */
function _adoptedRows(container) {
  if (container instanceof Map || container instanceof Set || Array.isArray(container)) {
    for (const row of container.values()) {
      if (Array.isArray(row)) { for (const element of row) freeze(element); }
      else freeze(row);
    }
  }
  return container;
}

/** After a checkpoint adoption, covered provider delivery rows were read but never folded, so the
 * HMAC/ed25519 private CAS integrity gate in `_validateProviderDeliveryPayload` did not fire. This
 * pass reverifies every native-auth delivery the adopted projection covers. */
function _reverifyAdoptedProviderDeliveries(store) {
  if (typeof store._advisoryReceiptReverify !== 'function') return;
  for (const event of store._events) {
    if (event.kind !== 'provider.delivery_received') continue;
    const receipt = event.payload?.receipt;
    if (!receipt) continue;
    const configured = store._advisoryFeedCards.get(receipt.providerId);
    if (!configured || !['hmac-sha256', 'ed25519'].includes(configured.card.auth?.scheme)) continue;
    const replayReceipt = { schemaVersion: 1, providerId: receipt.providerId, sourceEpoch: receipt.sourceEpoch, cardDigest: receipt.cardDigest, mode: receipt.mode, deliveryId: receipt.deliveryId, rawDigest: receipt.rawDigest, rawBytes: receipt.rawBytes, authReceiptDigest: receipt.authReceiptDigest, keyFingerprint: receipt.keyFingerprint, occurredAt: receipt.occurredAt, sequence: receipt.sequence, coordinates: clone(receipt.coordinates), advisoryIds: clone(receipt.advisoryIds), source: { handle: `art:sha256:${receipt.rawDigest}`, digest: receipt.rawDigest, bytes: receipt.rawBytes, mediaType: 'application/json' }, contentDigest: receipt.verificationDigest };
    let reverified;
    try { reverified = store._advisoryReceiptReverify(replayReceipt); }
    catch (error) { throw new CoordinationIntegrityError('native provider receipt private CAS replay failed', error?.code ?? 'provider_cas_invalid'); }
    if (reverified && typeof reverified.then === 'function') throw new CoordinationIntegrityError('native provider receipt replay must be synchronous', 'provider_cas_replay_required');
    if (canonicalDigest(reverified) !== canonicalDigest(replayReceipt)) throw new CoordinationIntegrityError('native provider receipt private CAS replay diverged', 'provider_cas_invalid');
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
 *
 * Issue #406 (audit C33, principle P5): the `repoId` parameter is a scope assertion, not a label.
 * Every deployment holds exactly one repoId (`store._repoId`) and packs carry no per-pack repoId,
 * so per-pack filtering is impossible — the scan covers this store's packs, which ARE the asserted
 * repo's packs. A repoId that is not this store's refuses instead of returning another repo's
 * counts under a foreign label. The receipt keeps the exact `{ expired, reaped }` shape.
 */
export function reapExpiredContextPacks(store, repoId) {
  const scope = repoId ?? store._repoId;
  if (scope !== store._repoId) {
    throw new CoordinationRefusal(
      'context pack reap repository scope differs from deployment authority',
      'context_pack_reap_scope_mismatch',
    );
  }
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

/** Moved from `CoordinationStore.reapRunScratchpads` (issue #259 slice 1). State: the store, passed
 * explicitly.
 *
 * #286 G-41: the pass bound is the CALLER's recorded deadline, never a partition count. `deadlineAt`
 * is a wall deadline the stopping run already owns (`null` = reap every partition this pass); the
 * pass always takes at least one partition, so it advances whatever the clock says. The per-run
 * partition count is not a physical quantity — the previous literal cap bought nothing but the
 * ability to observe `partial`.
 *
 * #403: that deadline is read through the store's OWN (injectable) clock unless the caller hands
 * its reading in — the host clock is never the authority for a window a fixture clock must expire. */
export function reapRunScratchpads(store, runId, { deadlineAt = null, now = () => Date.parse(store._clock()) } = {}) {
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
  const selected = [];
  for (const partition of partitions) {
    if (selected.length > 0 && deadlineAt !== null && now() >= deadlineAt) break;
    selected.push(partition);
  }
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

/** Moved from `CoordinationStore.orphans` (issue #259 slice 1). State: the store, passed explicitly.
 *
 * #286 G-31: "the claimant's current generation" is read from the SAME replay fold the rest of the
 * store reads (`_workerGenerations`, last write wins — a replacement generation is a correction, so
 * the first binding is dead state). Rescanning `store._events` here was a second reading of one
 * fact: the two could only ever disagree by drifting, and `coordination-internals.waveBinding` is
 * the same law for the run -> wave binding. */
export function orphans(store, { liveWorkers = [] } = {}) {
  const live = new Set(Array.isArray(liveWorkers) ? liveWorkers : []);
  const lastGeneration = store._workerGenerations;
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

// ── the pinned recovery validators (issue #259 slice 2) ───────────────────────────────────────────

/** Moved from `CoordinationStore._restoreProjectionCheckpoint` (issue #259 slice 2). State: the store, passed explicitly.
 * Issue #397 (audit C18, with GitHub #361's root diagnosis): a refused restore names the
 * invariant that failed — `{ state: 'corrupt', reason, detail }` with `reason` from the closed
 * set `path_invalid | envelope_shape | authority_digest | prefix_digest | projection_digest |
 * projection_shape | tail_anchor` and `detail` carrying the compared values (digests
 * abbreviated) — instead of one bare 'corrupt' with the evidence discarded. Every refusal also
 * lands the {reason, detail} on the store as `_checkpointRestoreReport` for `startupStatus()` to
 * compose.
 *
 * Issue #465(4): the checkpoint CARRIES the projection and the seq it covers, never the event log
 * (`PROJECTION_LEDGER_FIELDS`), so this reader answers the successor what to rebuild and what to
 * adopt:
 *   `valid`           the body is this build's, its claim holds against the ledger (`coversSeq`
 *                     rows are exactly the rows the covered prefix holds, and the last covered line
 *                     re-digests to the one the writer anchored), and both the state and the claim
 *                     are returned for `_loadRun` to rebuild rows 1..coversSeq and adopt.
 *   `stale_shape`     another projection shape wrote it (its field set, or its field set's digest,
 *                     is not this build's) — the ledger replays in full and the open rewrites.
 *   `stale_authority` the bytes are proven under another authority digest: its carried projection
 *                     was folded under OTHER cards and policies, so it is not this build's state —
 *                     the ledger replays in full and the open rewrites under this authority. (Before
 *                     #465(4) this state REUSED the cached rows; the rows are no longer carried, and
 *                     a foreign fold cannot be adopted.)
 *   `stale_ledger`    (issue #465(4)) the body's claim does not hold against the ledger — it covers
 *                     more rows than the ledger's prefix holds, or a reference it minted names a row
 *                     the ledger cannot back. The ledger is authoritative, so the successor folds it
 *                     and rewrites the cache.
 *   `corrupt`         an envelope invariant failed (#397: a repair, never a rewrite).
 * Nothing about the ADOPTION is decided here (the body's references resolve against the rows, which
 * are not parsed yet): the reader proves the envelope and the claim, and `_adoptProjectionCheckpoint`
 * answers whether the state installs. */
export function _restoreProjectionCheckpoint(store, raw, base = 0) {
  if (!existsSync(store._checkpointFile)) {
    store._checkpointRestoreReport = null;
    return { state: 'absent', coversSeq: base, prefixBytes: 0, projection: null };
  }
  const abbrev = (value) => (typeof value === 'string' ? `${value.slice(0, 12)}…` : String(value ?? null));
  const refuse = (reason, detail) => {
    store._checkpointRestoreReport = freeze({ reason, detail: clone(detail) });
    store._resetProjection();
    return {
      state: 'corrupt', coversSeq: base, prefixBytes: 0, projection: null,
      reason, detail: clone(detail),
    };
  };
  const stale = (state, reason, detail) => {
    store._checkpointRestoreReport = freeze({ reason, detail: clone(detail) });
    store._resetProjection();
    return { state, coversSeq: base, prefixBytes: 0, projection: null, reason, detail: clone(detail) };
  };
  let stat;
  try {
    stat = lstatSync(store._checkpointFile);
  } catch (error) {
    return refuse('path_invalid', { field: 'path', error: String(error?.code ?? error).slice(0, 64) });
  }
  // Issue #290: no size heuristic. A checkpoint is accepted only when its own recorded
  // shape proves it — the envelope's prefixBytes/prefixDigest must re-derive from the
  // authoritative ledger prefix, the projectionDigest must re-derive from the body it
  // carries, and the claim (coversSeq + the anchored last covered line) must hold against the
  // ledger. #397: each invariant below refuses under its own name, so the report says what failed.
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return refuse('path_invalid', { field: 'path', isFile: stat.isFile(), symbolicLink: stat.isSymbolicLink() });
  }
  let envelope;
  try {
    envelope = deserialize(readFileSync(store._checkpointFile));
  } catch (error) {
    return refuse('envelope_shape', { field: 'deserialize', error: String(error?.message ?? error).slice(0, 120) });
  }
  // Issue #449(2): THREE envelope shapes are recognized — this build's (#465(4): `coversSeq` and
  // the covered tail's digest), the #449 shape (`throughSeq`, shape and commit recorded), and the
  // pre-#449 shape (neither), which is the exact shape every older resident wrote. The two earlier
  // shapes are admitted so the open can answer them as STALE (replay + rewrite) instead of as a
  // corrupt envelope their owner has no remedy for; any other key set is still corruption.
  const keys = ['authorityDigest', 'coversLineDigest', 'coversSeq', 'prefixBytes', 'prefixDigest',
    'projectionBytes', 'projectionDigest', 'projectionShapeDigest', 'schemaVersion', 'servedCommit',
    'swarmDictionaryFields'];
  const previousKeys = ['authorityDigest', 'prefixBytes', 'prefixDigest', 'projectionBytes',
    'projectionDigest', 'projectionShapeDigest', 'schemaVersion', 'servedCommit', 'throughSeq'];
  const legacyKeys = ['authorityDigest', 'prefixBytes', 'prefixDigest', 'projectionBytes',
    'projectionDigest', 'schemaVersion', 'throughSeq'];
  const envelopeKeys = Object.keys(envelope).sort().join(',');
  const sorted = (names) => [...names].sort().join(',');
  const shapeRecorded = envelopeKeys === sorted(keys);
  const previousShape = envelopeKeys === sorted(previousKeys);
  if (!shapeRecorded && !previousShape && envelopeKeys !== sorted(legacyKeys)) {
    return refuse('envelope_shape', { field: 'keys', actual: abbrev(envelopeKeys) });
  }
  if (envelope.schemaVersion !== 1) {
    return refuse('envelope_shape', { field: 'schemaVersion', actual: abbrev(envelope.schemaVersion) });
  }
  if (!Number.isSafeInteger(envelope.prefixBytes) || envelope.prefixBytes < 0) {
    return refuse('envelope_shape', { field: 'prefixBytes', actual: abbrev(envelope.prefixBytes) });
  }
  if (envelope.prefixBytes > raw.byteLength) {
    return refuse('envelope_shape', {
      field: 'prefixBytes_window', actual: envelope.prefixBytes, ledgerBytes: raw.byteLength,
    });
  }
  if (!/^[a-f0-9]{64}$/u.test(envelope.prefixDigest)) {
    return refuse('envelope_shape', { field: 'prefixDigest', actual: abbrev(envelope.prefixDigest) });
  }
  if (!/^[a-f0-9]{64}$/u.test(envelope.projectionDigest)) {
    return refuse('envelope_shape', { field: 'projectionDigest', actual: abbrev(envelope.projectionDigest) });
  }
  if (!Buffer.isBuffer(envelope.projectionBytes)) {
    return refuse('envelope_shape', { field: 'projectionBytes', actual: typeof envelope.projectionBytes });
  }
  if (!shapeRecorded && !previousShape) {
    // The pre-#449 envelope recorded neither a shape nor a commit: no build can prove it belongs
    // to this one, so it is STALE (the next write records the shape and answers the question).
    const detail = {
      field: 'projectionShapeDigest',
      expected: abbrev(store._projectionShapeDigest),
      actual: null,
      servedCommit: null,
    };
    return stale('stale_shape', 'projection_shape_digest', detail);
  }
  if (!/^[a-f0-9]{64}$/u.test(envelope.projectionShapeDigest ?? '')) {
    return refuse('envelope_shape', {
      field: 'projectionShapeDigest', actual: abbrev(envelope.projectionShapeDigest),
    });
  }
  if (envelope.servedCommit !== null && !/^[a-f0-9]{40,64}$/u.test(envelope.servedCommit ?? '')) {
    return refuse('envelope_shape', { field: 'servedCommit', actual: abbrev(envelope.servedCommit) });
  }
  // Another shape wrote the body: either the #449 key set (which carried `_events`/`_byKey` and no
  // `_steeringRuns`) or THIS key set under another field list. Both are a rewrite, never a repair, so
  // the open records the shape change and replays the ledger. Checked BEFORE the authority digest:
  // a body of another shape is refused as such whatever authority wrote it (issue #397's order).
  if (previousShape || envelope.projectionShapeDigest !== store._projectionShapeDigest) {
    const detail = {
      field: 'projectionShapeDigest',
      expected: abbrev(store._projectionShapeDigest),
      actual: abbrev(envelope.projectionShapeDigest),
      servedCommit: envelope.servedCommit ?? null,
    };
    return stale('stale_shape', 'projection_shape_digest', detail);
  }
  if (!Number.isSafeInteger(envelope.coversSeq) || envelope.coversSeq < base) {
    return refuse('envelope_shape', { field: 'coversSeq', actual: abbrev(envelope.coversSeq) });
  }
  if (!/^[a-f0-9]{64}$/u.test(envelope.coversLineDigest ?? '')) {
    return refuse('envelope_shape', { field: 'coversLineDigest', actual: abbrev(envelope.coversLineDigest) });
  }
  if (!Array.isArray(envelope.swarmDictionaryFields)
    || envelope.swarmDictionaryFields.some((name) => typeof name !== 'string' || name.length === 0)) {
    return refuse('envelope_shape', {
      field: 'swarmDictionaryFields', actual: abbrev(envelope.swarmDictionaryFields),
    });
  }
  // GitHub #361: the authority digest derives from the repoId, the advisory feed cards and the
  // provider-attempt / canonical-order / route / representation / goal-plan policies — any of
  // those changing on a landing mismatches every existing checkpoint. That alone is NOT
  // corruption: the mismatch is recorded, and the invariants below must still prove the bytes
  // before the checkpoint is admitted as `stale_authority`.
  const authorityStale = envelope.authorityDigest !== store._checkpointAuthorityDigest;
  const prefix = raw.subarray(0, envelope.prefixBytes);
  const prefixDigest = sha256Bytes(prefix);
  if (prefixDigest !== envelope.prefixDigest) {
    return refuse('prefix_digest', {
      recorded: abbrev(envelope.prefixDigest), derived: abbrev(prefixDigest),
      prefixBytes: envelope.prefixBytes,
    });
  }
  if (sha256Bytes(envelope.projectionBytes) !== envelope.projectionDigest) {
    return refuse('projection_digest', {
      recorded: abbrev(envelope.projectionDigest),
      derived: abbrev(sha256Bytes(envelope.projectionBytes)),
      projectionBytes: envelope.projectionBytes.byteLength,
    });
  }
  if (envelope.prefixBytes > 0 && raw.at(envelope.prefixBytes - 1) !== 0x0a) {
    return refuse('tail_anchor', {
      field: 'newline_anchor', prefixBytes: envelope.prefixBytes, lastByte: raw.at(envelope.prefixBytes - 1),
    });
  }
  // Issue #465(4): the CLAIM. `coversSeq` counts the absolute seqs the body's projection covers, and
  // the covered window's rows are the ledger lines the prefix holds (rows past the archival cut), so
  // the two must agree row for row. This replaces the old proof that the cached `_events` matched the
  // claimed count: the rows are not carried any more, so the claim is judged against the ledger
  // directly. A prefix holding a different number of rows is a claim past the ledger's last row (a
  // truncated or rewritten ledger), and the ledger wins.
  const coveredRows = envelope.coversSeq - base;
  let prefixRows = 0;
  if (envelope.prefixBytes > 0) {
    // Counted without parsing (the parse is the replay's own bounded work, in `_loadRun`).
    prefixRows = 1;
    for (let index = 0; index < envelope.prefixBytes - 1; index += 1) {
      if (raw[index] === 0x0a) prefixRows += 1;
    }
  }
  if (prefixRows !== coveredRows) {
    return stale('stale_ledger', 'covers_beyond_ledger', {
      field: 'coversSeq', coversSeq: envelope.coversSeq, base, expectedRows: coveredRows, ledgerRows: prefixRows,
    });
  }
  // The anchored tail: the LAST covered ledger line must re-digest to the one the writer recorded.
  // It is the #229 append-drift proof the parsed cache used to carry (the last cached row had to
  // re-serialize to the prefix's final line) — now one digest of the line itself, which the body
  // does not have to hold. A prefix whose bytes were re-stamped without re-writing the checkpoint
  // shows here.
  if (envelope.coversSeq > base) {
    const lastLineStart = raw.lastIndexOf(0x0a, envelope.prefixBytes - 2) + 1;
    const lastLine = raw.subarray(lastLineStart, envelope.prefixBytes - 1);
    if (sha256Bytes(lastLine) !== envelope.coversLineDigest) {
      return refuse('tail_anchor', {
        field: 'last_line', prefixBytes: envelope.prefixBytes, coversSeq: envelope.coversSeq,
        ledgerLine: `${lastLine.subarray(0, 16).toString('hex')}…`,
        recorded: abbrev(envelope.coversLineDigest), derived: abbrev(sha256Bytes(lastLine)),
      });
    }
  }
  let projection;
  try {
    projection = deserialize(envelope.projectionBytes);
  } catch (error) {
    return refuse('projection_shape', { field: 'deserialize', error: String(error?.message ?? error).slice(0, 120) });
  }
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) {
    return refuse('projection_shape', {
      field: 'keys',
      actual: abbrev(projection === null ? 'null' : Array.isArray(projection) ? 'array' : typeof projection),
    });
  }
  const projectionKeys = Object.keys(projection).sort().join(',');
  if (projectionKeys !== sorted(PROJECTION_CHECKPOINT_FIELDS)) {
    return refuse('projection_shape', { field: 'keys', actual: abbrev(projectionKeys) });
  }
  // Issue #465(4): the state is not reusable under another authority digest. Before this lane the
  // checkpoint was a parsed-event cache and its rows replayed under the current cards exactly as a
  // valid checkpoint's did; the state it now carries was folded under the OTHER build's policies, so
  // adopting it would serve a projection this build would never derive. The ledger replays instead,
  // and `_openCheckpointRefresh` writes a cache this build's authority owns.
  if (authorityStale) {
    const detail = { expected: abbrev(store._checkpointAuthorityDigest), actual: abbrev(envelope.authorityDigest) };
    return stale('stale_authority', 'authority_digest', detail);
  }
  store._checkpointRestoreReport = null;
  return {
    state: 'valid', coversSeq: envelope.coversSeq, prefixBytes: envelope.prefixBytes,
    projection, dictionaryFields: envelope.swarmDictionaryFields, reused: true,
  };
}

/** Moved from `CoordinationStore._validPreservedResumeAttestation` (issue #259 slice 2). State: the store, passed explicitly. */
export function _validPreservedResumeAttestation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const names = ['priorTaskId', 'checkpointSha', 'checkpointRef'];
  if (Object.keys(value).sort().join(',') !== names.sort().join(',')) return null;
  const { priorTaskId, checkpointSha, checkpointRef } = value;
  if (!boundedText(priorTaskId, 4_096) || !/^[a-f0-9]{40,64}$/u.test(checkpointSha ?? '')
    || typeof checkpointRef !== 'string'
    || !/^refs\/baton\/checkpoints\/[a-f0-9]{40,64}$/u.test(checkpointRef)) return null;
  return freeze({ priorTaskId, checkpointSha, checkpointRef });
}

/** Moved from `CoordinationStore._validateGoalPlanDispatchPair` (issue #259 slice 2). State: the store, passed explicitly. */
export function _validateGoalPlanDispatchPair(store, dispatchEvent, taskEvent, integrity = false, recoveryClaimEvent = null) {
  const fail = (message) => store._goalPlanFailure(
    message,
    integrity ? 'goal_plan_dispatch_integrity' : 'plan_dispatch_invalid',
    integrity,
  );
  const p = dispatchEvent?.payload; const task = taskEvent?.payload;
  const planRecovery = recoveryClaimEvent !== null;
  const authorityFields = ['principalId', 'repoId', 'runId'];
  const bindingFields = ['schemaVersion', 'goalId', 'goalVersion', 'goalDigest', 'planId', 'planVersion', 'planDigest', 'nodeKey', 'approvalDigest', 'policyDigest', 'dispatchVersion'];
  // Issue #504/#518: the deployment identity a recorded dispatch must belong to comes from the
  // live authority when one is configured, else from the store's own repoId; a store that knows
  // neither (the probes) binds no identity and validates the row as recorded — the recorded
  // goal and plan below still have to agree with the recorded authority repoId.
  const deploymentRepoId = store._goalPlanPolicy?.repoId ?? store._repoId;
  if (!p || !task || !p.authority || Object.keys(p.authority).sort().join(',') !== authorityFields.sort().join(',')
    || !validRunId(p.authority.principalId) || (deploymentRepoId !== null && p.authority.repoId !== deploymentRepoId)
    || !(p.authority.runId === null || validRunId(p.authority.runId))
    || !p.binding || Object.keys(p.binding).sort().join(',') !== bindingFields.sort().join(',')) fail('goal/plan dispatch authority or binding is malformed');

  const prefix = store._events.filter((event) => event.seq < dispatchEvent.seq);
  const goalEvent = prefix.findLast((event) => event.kind === 'goal.version_defined'
    && event.payload.goal.goalId === p.binding.goalId && event.payload.goal.version === p.binding.goalVersion);
  const planEvent = prefix.findLast((event) => event.kind === 'plan.version_proposed'
    && event.payload.plan.planId === p.binding.planId && event.payload.plan.version === p.binding.planVersion);
  const goal = goalEvent?.payload?.goal; const plan = planEvent?.payload?.plan;
  if (!goal || !plan || goal.digest !== p.binding.goalDigest || plan.digest !== p.binding.planDigest
    || goal.repoId !== p.authority.repoId || goal.runId !== p.authority.runId
    || plan.repoId !== p.authority.repoId || plan.runId !== p.authority.runId
    || canonicalDigest(plan.goal) !== canonicalDigest({ goalId: goal.goalId, version: goal.version, digest: goal.digest })) fail('goal/plan dispatch references stale goal or plan authority');

  const goalHead = prefix.filter((event) => event.kind === 'goal.version_defined'
    && event.payload.goal.repoId === goal.repoId && event.payload.goal.runId === goal.runId).at(-1)?.payload?.goal;
  const planHead = prefix.filter((event) => event.kind === 'plan.version_proposed'
    && canonicalDigest(event.payload.plan.goal) === canonicalDigest(plan.goal)).at(-1)?.payload?.plan;
  if (goalHead?.goalId !== goal.goalId || goalHead.version !== goal.version || goalHead.digest !== goal.digest
    || planHead?.planId !== plan.planId || planHead.version !== plan.version || planHead.digest !== plan.digest) fail('goal/plan dispatch used superseded authority');

  const approvalEvent = prefix.findLast((event) => event.kind === 'plan.approval_decided'
    && event.payload.approval.plan.planId === plan.planId && event.payload.approval.plan.version === plan.version);
  const approval = approvalEvent?.payload?.approval;
  // Issue #325: the binding anchors on the RECORDED approval digest, never the live
  // policy — a dispatch recorded under an earlier policy stays authoritative, while a
  // forged binding digest still refuses against the recorded approval row. Replay re-derives
  // the recorded order (dispatch after approval). An approval does not expire with time.
  if (!approval || approval.disposition !== 'approved' || approval.digest !== p.binding.approvalDigest
    || p.binding.policyDigest !== approval.policyDigest
    || Date.parse(dispatchEvent.ts) < Date.parse(approval.decidedAt)) fail('goal/plan dispatch lacks current approval authority');

  const node = plan.nodes.find((row) => row.key === p.binding.nodeKey);
  const planRevision = Object.hasOwn(node ?? {}, 'revision');
  if (!node || p.binding.schemaVersion !== 1 || p.binding.dispatchVersion !== 1
    || p.expectedDispatchVersion !== 0 || p.newDispatchVersion !== 1
    || canonicalDigest(node.budget) !== canonicalDigest(p.nodeBudget)
    || canonicalDigest(node.capabilities) !== canonicalDigest(p.capabilities)
    || canonicalDigest(node.effects) !== canonicalDigest(p.effects)
    || Object.hasOwn(node, 'requiredEffects') !== Object.hasOwn(p, 'requiredEffects')
    || canonicalDigest(node.requiredEffects ?? []) !== canonicalDigest(p.requiredEffects ?? [])
    || planRevision !== Object.hasOwn(p, 'revision')
    || (planRevision && canonicalDigest(node.revision) !== canonicalDigest(p.revision))) fail('goal/plan dispatch node authority changed');
  if (planRevision) store._workflowRevisionAuthority(plan, node, dispatchEvent.seq - 1, integrity);
  // PS5: a preserved-resume re-dispatch is the one sanctioned exception to "one dispatch per
  // node". It is permitted only when a prior dispatch exists, the latest task is durably
  // terminal-cancelled, and the caller attested the exact preserved checkpoint lineage. The
  // coordination store records the attestation; the physical checkpoint ref is postchecked by
  // the Coordinator before this admission, so re-dispatch can never manufacture a fresh
  // identity for work that was not actually preserved.
  const priorDispatches = prefix.filter((event) => event.kind === 'plan.node_dispatched'
    && event.payload.binding.planId === plan.planId && event.payload.binding.planVersion === plan.version
    && event.payload.binding.nodeKey === node.key);
  const preservedResume = store._validPreservedResumeAttestation(p.preservedResume);
  if (preservedResume) {
    if (priorDispatches.length === 0) fail('preserved resume requires a prior node dispatch');
    // Recursive resource stops form a linear same-node recovery chain. Only the latest dispatch
    // is eligible, so an older cancelled checkpoint can never fork the current node authority.
    const priorTaskId = priorDispatches.at(-1).payload.taskId;
    const priorState = store._historicalTaskState(priorTaskId, dispatchEvent.seq - 1);
    if (!priorState || priorState.status !== 'cancelled') fail('preserved resume prior task was not cancelled');
    if (priorTaskId !== preservedResume.priorTaskId) fail('preserved resume prior task lineage changed');
  } else if (priorDispatches.length > 0) {
    fail('goal/plan node was dispatched more than once');
  }

  if (!p.route || Object.keys(p.route).sort().join(',') !== ['effort', 'model', 'vendor'].sort().join(',')
    || !planRouteMatches(node.routes, p.route, { historical: true })) {
    fail('goal/plan dispatch route is outside approved authority');
  }

  const resolvedDeps = [];
  for (const depKey of node.deps) {
    const depDispatch = prefix.findLast((event) => event.kind === 'plan.node_dispatched'
      && event.payload.binding.planId === plan.planId && event.payload.binding.planVersion === plan.version
      && event.payload.binding.nodeKey === depKey);
    const depTaskId = depDispatch?.payload?.taskId; const depState = depTaskId ? store._historicalTaskState(depTaskId, dispatchEvent.seq - 1) : null;
    if (!depTaskId || depState?.status !== 'completed' || depState.acceptanceRevocation) fail('goal/plan dispatch dependency was not durably accepted');
    resolvedDeps.push(depTaskId);
  }
  resolvedDeps.sort();
  if (canonicalDigest(resolvedDeps) !== canonicalDigest(p.resolvedDeps)) fail('goal/plan dispatch dependency linkage changed');

  // Issue #325: the expected binding carries the RECORDED digest (verified against the
  // recorded approval above). Live prospective bindings are built under the live digest
  // by _planDispatchState, so both lanes agree without the fold naming the live policy.
  const expectedBinding = {
    schemaVersion: 1, goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: plan.planId, planVersion: plan.version, planDigest: plan.digest, nodeKey: node.key,
    approvalDigest: approval.digest, policyDigest: p.binding.policyDigest, dispatchVersion: 1,
  };
  if (canonicalDigest(expectedBinding) !== canonicalDigest(p.binding)) fail('goal/plan dispatch binding changed');
  const expectedBrief = buildAuthoritativeBrief(goal, plan, node, expectedBinding);
  const resumeAttestation = store._validPreservedResumeAttestation(p.preservedResume);
  const expectedTaskFields = planRecovery
    ? ['id', 'brief', 'deps', 'refines', 'runId', 'taskType', 'reservedWorkerId', 'vendorRequested', 'modelRequested', 'modelPolicy', 'effortRequested', 'sessionRequest', 'relation', 'worktreeBaseSha', 'review']
    : resumeAttestation
      ? ['id', 'brief', 'deps', 'refines', 'runId', 'taskType', 'reservedWorkerId', 'vendorRequested', 'modelRequested', 'modelPolicy', 'effortRequested', 'effortResolved', 'effortObserved', 'routeKey', 'sessionRequest', 'relation', 'worktreeBaseSha']
      : planRevision
        ? ['id', 'brief', 'deps', 'refines', 'runId', 'taskType', 'reservedWorkerId', 'vendorRequested', 'modelRequested', 'modelPolicy', 'effortRequested', 'effortResolved', 'effortObserved', 'routeKey', 'sessionRequest', 'relation', 'worktreeBaseSha']
      : ['id', 'brief', 'deps', 'refines', 'runId', 'taskType', 'reservedWorkerId', 'vendorRequested', 'modelRequested', 'modelPolicy', 'effortRequested', 'effortResolved', 'effortObserved', 'routeKey', 'sessionRequest'];
  if (Object.keys(task).sort().join(',') !== expectedTaskFields.sort().join(',')) fail('goal/plan task field set changed');
  if (resumeAttestation && (!/^[a-f0-9]{40}$/.test(task.worktreeBaseSha ?? '') || task.refines !== resumeAttestation.priorTaskId)) {
    fail('preserved resume task base or lineage does not match its attestation');
  }
  if (task.id !== p.taskId || !boundedText(task.reservedWorkerId, 4_096)) fail('goal/plan task physical identity changed');
  if (canonicalDigest(task.brief) !== canonicalDigest(expectedBrief)) fail('goal/plan authoritative Brief changed');
  if (canonicalDigest(task.deps) !== canonicalDigest(resolvedDeps)) fail('goal/plan task dependencies changed');
  if (planRecovery) {
    if (!node.capabilities.includes('native_session_recovery') || !node.effects.includes('provider_call')) {
      store._goalPlanFailure('plan node does not explicitly authorize native session recovery', 'plan_recovery_not_authorized', integrity);
    }
    const priorTask = store._tasks.get(task.refines);
    if (!priorTask || !resolvedDeps.includes(priorTask.id)) fail('goal/plan recovery refinement is not an approved dependency');
    store._verifiedRecoveryPrior(priorTask, integrity);
    const recoveryFail = (message, code = 'recovery_refinement_invalid') => store._recoveryFailure(message, code, integrity);
    store._validateRecoverySessionRequest(task.sessionRequest, priorTask, recoveryFail);
    const claim = recoveryClaimEvent?.payload;
    const sameRequestedHarness = task.vendorRequested === priorTask.vendorRequested
      || (priorTask.vendorRequested === 'auto' && task.vendorRequested === claim?.harnessRequested);
    if (task.relation !== 'recovery' || task.runId !== goal.runId || task.taskType !== (priorTask.taskType ?? 'general')
      || task.reservedWorkerId !== priorTask.reservedWorkerId || task.reservedWorkerId !== priorTask.assignee
      || !sameRequestedHarness || task.vendorRequested !== p.route.vendor
      || canonicalDigest(task.modelRequested ?? null) !== canonicalDigest(priorTask.modelRequested ?? null)
      || task.modelRequested !== p.route.model
      || canonicalDigest(task.modelPolicy ?? null) !== canonicalDigest(priorTask.modelPolicy ?? null)
      || canonicalDigest(task.effortRequested ?? null) !== canonicalDigest(priorTask.effortRequested ?? null)
      || task.effortRequested !== p.route.effort
      || canonicalDigest(task.worktreeBaseSha ?? null) !== canonicalDigest(priorTask.worktreeBaseSha ?? null)
      || canonicalDigest(task.review ?? null) !== canonicalDigest(priorTask.review ?? null)) {
      store._recoveryFailure('plan recovery changes immutable prior-task lineage', 'recovery_refinement_conflict', integrity);
    }
  } else if (resumeAttestation) {
    // PS5: a preserved-resume task re-dispatches the same node from its pinned checkpoint. Its
    // lineage is the cancelled prior task; its route, session, and resolved fields stay exact.
    if (task.refines !== resumeAttestation.priorTaskId || task.runId !== goal.runId
      || task.taskType !== 'general' || task.relation !== 'preserved_resume') {
      fail('preserved resume task lineage, run, or type changed');
    }
    if (task.vendorRequested !== p.route.vendor || task.modelRequested !== p.route.model || task.modelPolicy !== null
      || task.effortRequested !== p.route.effort || task.effortResolved !== null || task.effortObserved !== null || task.routeKey !== null) {
      fail('preserved resume task route fields changed');
    }
    if (canonicalDigest(task.sessionRequest) !== canonicalDigest({ mode: 'new' })) fail('preserved resume task session fields changed');
  } else if (planRevision) {
    if (task.refines !== node.revision.parent.taskId || task.runId !== goal.runId
      || task.taskType !== 'general' || task.relation !== 'revision'
      || task.worktreeBaseSha !== node.revision.parent.resultSha) {
      fail('workflow revision task lineage, run, or base changed');
    }
    if (task.vendorRequested !== p.route.vendor || task.modelRequested !== p.route.model
      || task.modelPolicy !== null || task.effortRequested !== p.route.effort
      || task.effortResolved !== null || task.effortObserved !== null || task.routeKey !== null
      || canonicalDigest(task.sessionRequest) !== canonicalDigest({ mode: 'new' })) {
      fail('workflow revision task route or session fields changed');
    }
  } else {
    if (task.refines !== null || task.runId !== goal.runId || task.taskType !== 'general') fail('goal/plan task lineage, run, or type changed');
    if (task.vendorRequested !== p.route.vendor || task.modelRequested !== p.route.model || task.modelPolicy !== null
      || task.effortRequested !== p.route.effort || task.effortResolved !== null || task.effortObserved !== null || task.routeKey !== null) fail('goal/plan task route fields changed');
    if (canonicalDigest(task.sessionRequest) !== canonicalDigest({ mode: 'new' })) fail('goal/plan task session fields changed');
  }
  if (prefix.some((event) => event.kind === 'task.created' && event.payload.id === task.id)
    || p.taskPayloadDigest !== canonicalDigest(task)) fail('goal/plan task identity or payload digest changed');

  const gate = {
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
    nodeKey: node.key, expectedDispatchVersion: 0,
    capabilities: clone(node.capabilities), effects: clone(node.effects),
    ...(Object.hasOwn(node, 'requiredEffects') ? { requiredEffects: clone(node.requiredEffects) } : {}),
  };
  const requestTask = planRecovery ? store._planRecoveryRequestFields(task) : task;
  const expectedRequestDigest = goalPlanDigest({
    principalId: p.authority.principalId, gate, route: p.route, task: requestTask,
    ...(planRecovery ? { attribution: store._recoveryAttributionFromClaim(recoveryClaimEvent.payload) } : {}),
    ...(resumeAttestation ? { preservedResume: resumeAttestation } : {}),
  });
  if (p.requestDigest !== expectedRequestDigest) fail('goal/plan dispatch request digest changed');
  return true;
}

/** Moved from `CoordinationStore._validateGoalPlanRecoveryTriple` (issue #259 slice 2). State: the store, passed explicitly. */
export function _validateGoalPlanRecoveryTriple(store, dispatchEvent, createdEvent, claimedEvent, integrity = false) {
  const fail = (message) => store._goalPlanFailure(
    message,
    integrity ? 'goal_plan_recovery_batch_integrity' : 'plan_recovery_invalid',
    integrity,
  );
  try {
    // Issue #325: the pair replays under the recorded digest, so the recovery triple
    // replays with the same integrity flag instead of re-judging by the live policy.
    store._validateGoalPlanDispatchPair(dispatchEvent, createdEvent, integrity, claimedEvent);
    const created = createdEvent?.payload; const claimed = claimedEvent?.payload;
    const attribution = store._recoveryAttributionFromClaim(claimed ?? {});
    const attributionFields = [
      'effortObserved', 'effortRequested', 'effortResolved', 'harnessRequested', 'harnessResolved',
      'modelObserved', 'modelRequested', 'modelResolved', 'routeKey',
    ];
    const claimFields = [
      'effortObserved', 'effortRequested', 'effortResolved', 'expectedVersion', 'harnessRequested',
      'harnessResolved', 'id', 'modelObserved', 'modelRequested', 'modelResolved', 'newVersion', 'routeKey', 'worker',
    ];
    if (!created || !claimed || Object.keys(claimed).sort().join(',') !== claimFields.sort().join(',')
      || Object.keys(attribution).sort().join(',') !== attributionFields.sort().join(',')
      || !boundedText(attribution.harnessRequested, 512) || !boundedText(attribution.harnessResolved, 512)
      || [attribution.modelRequested, attribution.modelResolved, attribution.modelObserved,
        attribution.effortRequested, attribution.effortResolved, attribution.effortObserved,
        attribution.routeKey].some((value) => value !== null && !boundedText(value, 8_192))) {
      fail('goal/plan recovery claim is malformed');
    }
    const expected = store._normalizedRecoveryClaimedPayload(created, attribution);
    if (canonicalDigest(claimed) !== canonicalDigest(expected)
      || claimed.harnessRequested !== dispatchEvent.payload.route.vendor
      || claimed.modelRequested !== dispatchEvent.payload.route.model
      || claimed.modelResolved !== dispatchEvent.payload.route.model
      || (claimed.modelObserved !== null && claimed.modelObserved !== dispatchEvent.payload.route.model)
      || claimed.effortRequested !== dispatchEvent.payload.route.effort
      || claimed.effortResolved !== dispatchEvent.payload.route.effort
      || (claimed.effortObserved !== null && claimed.effortObserved !== dispatchEvent.payload.route.effort)
      || dispatchEvent.payload.claimPayloadDigest !== canonicalDigest(claimed)) {
      fail('goal/plan recovery claim changes approved route or worker authority');
    }
    return true;
  } catch (error) {
    if (integrity && !(error instanceof CoordinationIntegrityError && error.code === 'goal_plan_recovery_batch_integrity')) {
      fail(error?.message ?? 'goal/plan recovery transaction is invalid');
    }
    throw error;
  }
}

/** Moved from `CoordinationStore._validateRecoveryAttemptAdmissionPayload` (issue #259 slice 2). State: the store, passed explicitly. */
export function _validateRecoveryAttemptAdmissionPayload(store, payload, event, integrity = false) {
  const p = store._normalizeRecoveryAttemptAdmission(payload, integrity);
  const fail = (message, code) => store._recoveryAttemptFailure(message, code, integrity);
  const task = store._tasks.get(p.priorTask.id);
  if (!task || (task.runId ?? null) !== p.runId) {
    fail('recovery attempt belongs to a different or unavailable Run', 'recovery_attempt_run_mismatch');
  }
  if (store._runStops.has(p.runId)) fail(`run ${p.runId} is stopping`, 'run_stopping');
  if (task.version !== p.priorTask.version || task.terminalEvent !== p.priorTask.terminalEvent
    || task.status !== 'completed' || task.acceptanceRevocation) {
    fail('recovery attempt prior task binding is stale', 'recovery_attempt_stale');
  }
  if (task.assignee !== p.verifiedOwner.workerId) {
    fail('recovery attempt worker is not the prior task owner', 'recovery_attempt_owner_mismatch');
  }
  let verified;
  try { verified = store._verifiedRecoveryPrior(task, integrity); }
  catch (error) {
    // #400: the fold's own diagnosis says WHY the owner is unverified (a missing terminal
    // evidence row, a changed mapping); the owner label alone lost it.
    fail(error?.message ?? 'recovery attempt owner lacks exact hub verification',
      error?.code ?? 'recovery_attempt_owner_unverified');
  }
  if (verified.mapped.seq !== p.verifiedOwner.evidence.coordinationSeq) {
    fail('recovery attempt owner verification evidence differs', 'recovery_attempt_owner_unverified');
  }
  if (task.routeKey !== p.route.tupleKey) {
    fail('recovery attempt route differs from the verified prior task', 'recovery_attempt_invalid');
  }
  if (store._taskTopologyPolicy) {
    store._validateTaskTopology({
      id: p.recoveryTaskId, runId: p.runId, refines: p.priorTask.id,
      taskType: task.taskType ?? 'general', relation: 'recovery',
    }, 'recovery', integrity);
  }

  const headId = store._recoveryAttemptHeads.get(p.seriesId);
  const head = headId ? store._recoveryAttemptsById.get(headId) : null;
  if (head) {
    if (head.state === 'pending') fail('recovery attempt has an unresolved admitted effect', 'recovery_attempt_unresolved');
    if (['attached', 'unknown'].includes(head.state)) {
      fail('recovery attempt outcome forbids automatic continuation', 'recovery_attempt_continuation_forbidden');
    }
    if (head.maxAttempts !== p.maxAttempts
      || canonicalDigest(head.authority) !== canonicalDigest(p.authority)
      || canonicalDigest(head.route) !== canonicalDigest(p.route)
      || canonicalDigest(head.workerPolicy) !== canonicalDigest(p.workerPolicy)
      || head.session.idDigest !== p.session.idDigest
      || head.session.contextDigest !== p.session.contextDigest) {
      fail('recovery attempt series authority changed', 'recovery_attempt_authority_changed');
    }
    if (head.attempt >= head.maxAttempts || p.attempt > p.maxAttempts) {
      fail('recovery attempt ceiling is exhausted', 'recovery_attempt_exhausted');
    }
    if (p.attempt !== head.attempt + 1) {
      fail('recovery attempt sequence is not contiguous', 'recovery_attempt_sequence');
    }
    if (p.expectedAttemptHeadEvent !== head.completedEvent) {
      fail('recovery attempt head compare-and-set is stale', 'recovery_attempt_stale');
    }
  } else {
    const unresolved = [...store._recoveryAttemptsById.values()].find((attempt) => (
      attempt.priorTask.id === p.priorTask.id
      && attempt.verifiedOwner.workerId === p.verifiedOwner.workerId
      && ['pending', 'attached', 'unknown'].includes(attempt.state)
    ));
    if (unresolved) fail('recovery prior owner already has an unresolved effect', 'recovery_attempt_unresolved');
    if (p.attempt !== 1) fail('recovery attempt series must begin at one', 'recovery_attempt_sequence');
    if (p.expectedAttemptHeadEvent !== null) {
      fail('new recovery attempt series has a stale head', 'recovery_attempt_stale');
    }
  }
  if (store._recoveryAttemptsById.has(p.attemptId)) {
    fail('recovery attempt identity already exists', 'recovery_attempt_conflict');
  }
  if (!boundedText(event?.actor, 4_096)) fail('recovery attempt actor is invalid', 'recovery_attempt_invalid');
  return p;
}

/** Moved from `CoordinationStore._validateRecoveryContinuationPayload` (issue #259 slice 2). State: the store, passed explicitly. */
export function _validateRecoveryContinuationPayload(store, p, event, integrity = false) {
  const fields = [
    'adapterCardDigest', 'briefDigest', 'contextDigest', 'kind', 'priorTaskId',
    'processGeneration', 'routeDigest', 'schemaVersion', 'sessionId', 'taskId', 'workerId',
  ];
  const fail = (message, code = 'recovery_dispatch_integrity') => store._recoveryFailure(message, code, integrity);
  if (!p || Object.keys(p).sort().join(',') !== fields.sort().join(',')
    || p.kind !== 'recovery.continuation_intent' || p.schemaVersion !== 1
    || !boundedText(p.workerId, 256) || !boundedText(p.taskId, 4_096)
    || !boundedText(p.priorTaskId, 4_096) || !boundedText(p.sessionId, 4_096)
    || !Number.isSafeInteger(p.processGeneration) || p.processGeneration <= 0
    || !/^[a-f0-9]{64}$/.test(p.briefDigest ?? '')
    || !/^[a-f0-9]{64}$/.test(p.contextDigest ?? '')
    || !/^[a-f0-9]{64}$/.test(p.routeDigest ?? '')
    || !/^[a-f0-9]{64}$/.test(p.adapterCardDigest ?? '')) {
    fail('recovery continuation intent is malformed');
  }
  const task = store._tasks.get(p.taskId);
  const prior = store._tasks.get(p.priorTaskId);
  if (!task || !prior || task.status !== 'working' || task.assignee !== p.workerId
    || task.refines !== p.priorTaskId || task.relation !== 'recovery'
    || prior.status !== 'completed' || prior.assignee !== p.workerId
    || task.sessionRequest?.mode !== 'resume' || task.sessionRequest?.id !== p.sessionId
    || canonicalDigest(task.brief) !== p.briefDigest
    || canonicalDigest(task.sessionRequest?.context ?? null) !== p.contextDigest) {
    fail('recovery continuation intent disagrees with its claimed refinement');
  }
  store._verifiedRecoveryPrior(prior, integrity);
  const createdEvent = store._events[task.createdEvent - 1];
  const claimedEvent = store._events[task.claimedEvent - 1];
  if (createdEvent?.batch?.kind === 'recovery_refinement_create_claim') {
    if (claimedEvent?.batch?.id !== createdEvent.batch.id || claimedEvent?.seq !== createdEvent.seq + 1) {
      fail('recovery continuation intent is not bound to an atomic recovery refinement');
    }
    store._validateRecoveryRefinementPair(createdEvent, claimedEvent, integrity);
  } else if (createdEvent?.batch?.kind === 'goal_plan_recovery_dispatch') {
    const dispatchEvent = store._events[createdEvent.seq - 2];
    if (dispatchEvent?.batch?.id !== createdEvent.batch.id
      || dispatchEvent?.seq !== createdEvent.seq - 1
      || claimedEvent?.batch?.id !== createdEvent.batch.id
      || claimedEvent?.seq !== createdEvent.seq + 1) {
      fail('recovery continuation intent is not bound to an atomic Plan recovery dispatch');
    }
    store._validateGoalPlanRecoveryTriple(dispatchEvent, createdEvent, claimedEvent, integrity);
  } else {
    fail('recovery continuation intent is not bound to an atomic recovery refinement');
  }
  const route = {
    harness: task.harnessResolved ?? task.vendorRequested ?? null,
    model: task.modelResolved ?? null,
    effort: task.effortResolved ?? null,
    serviceTier: task.modelPolicy?.serviceTier ?? null,
    routeKey: task.routeKey ?? null,
    adapterCardDigest: p.adapterCardDigest,
  };
  if (canonicalDigest(route) !== p.routeDigest) fail('recovery continuation route digest is invalid');
  const current = store._recoveryDispatches.get(p.workerId);
  if (current) {
    const currentTask = store._tasks.get(current.taskId);
    if (!(current.status === 'dispatch_accepted' && currentTask?.status === 'completed')) {
      fail('worker already has an unresolved recovery continuation', 'recovery_dispatch_conflict');
    }
    if (p.priorTaskId !== current.taskId) {
      fail('recovery continuation does not extend the current accepted worker lineage', 'recovery_dispatch_conflict');
    }
  }
  return freeze({
    workerId: p.workerId, taskId: p.taskId, priorTaskId: p.priorTaskId,
    sessionId: p.sessionId, processGeneration: p.processGeneration,
    briefDigest: p.briefDigest, contextDigest: p.contextDigest,
    routeDigest: p.routeDigest, adapterCardDigest: p.adapterCardDigest,
    intentSeq: event.seq, status: 'dispatch_unknown', receiptSeq: null,
  });
}

/** Moved from `CoordinationStore._validateRecoveryRefinementRequest` (issue #259 slice 2). State: the store, passed explicitly. */
export function _validateRecoveryRefinementRequest(store, fields, attribution, priorTask, integrity = false) {
  const fail = (message, code = 'recovery_refinement_invalid') => store._recoveryFailure(message, code, integrity);
  const fieldNames = [
    'brief', 'deps', 'effortRequested', 'id', 'modelPolicy', 'modelRequested', 'refines',
    'relation', 'reservedWorkerId', 'runId', 'sessionRequest', 'taskType', 'vendorRequested',
  ];
  const attributionNames = [
    'effortObserved', 'effortRequested', 'effortResolved', 'harnessRequested', 'harnessResolved',
    'modelObserved', 'modelRequested', 'modelResolved', 'routeKey',
  ];
  if (!fields || Object.keys(fields).sort().join(',') !== fieldNames.sort().join(',')
    || !attribution || Object.keys(attribution).sort().join(',') !== attributionNames.sort().join(',')
    || !boundedText(fields.id, 4_096) || !boundedText(fields.refines, 4_096)
    || !boundedText(fields.reservedWorkerId, 256) || fields.relation !== 'recovery'
    || !Array.isArray(fields.deps) || fields.deps.length !== 0
    || !boundedText(attribution.harnessRequested, 512)
    || !boundedText(attribution.harnessResolved, 512)
    || [attribution.modelRequested, attribution.modelResolved, attribution.modelObserved,
      attribution.effortRequested, attribution.effortResolved, attribution.effortObserved,
      attribution.routeKey].some((value) => value !== null && !boundedText(value, 8_192))) {
    fail('recovery refinement request is malformed');
  }
  store._verifiedRecoveryPrior(priorTask, integrity);
  store._validateRecoverySessionRequest(fields.sessionRequest, priorTask, fail);
  const sameRequestedHarness = fields.vendorRequested === priorTask.vendorRequested
    || (priorTask.vendorRequested === 'auto' && fields.vendorRequested === attribution.harnessRequested);
  if (fields.refines !== priorTask.id || fields.reservedWorkerId !== priorTask.reservedWorkerId
    || fields.reservedWorkerId !== priorTask.assignee || (fields.runId ?? null) !== (priorTask.runId ?? null)
    || fields.taskType !== (priorTask.taskType ?? 'general') || !sameRequestedHarness
    || canonicalDigest(fields.brief) !== canonicalDigest(priorTask.brief)
    || canonicalDigest(fields.modelRequested ?? null) !== canonicalDigest(priorTask.modelRequested ?? null)
    || canonicalDigest(fields.modelPolicy ?? null) !== canonicalDigest(priorTask.modelPolicy ?? null)
    || canonicalDigest(fields.effortRequested ?? null) !== canonicalDigest(priorTask.effortRequested ?? null)
    || canonicalDigest(attribution.modelRequested ?? null) !== canonicalDigest(priorTask.modelRequested ?? null)
    || canonicalDigest(attribution.effortRequested ?? null) !== canonicalDigest(priorTask.effortRequested ?? null)) {
    fail('recovery refinement request changes immutable prior-task lineage', 'recovery_refinement_conflict');
  }
  return store._normalizedRecoveryCreatedPayload(fields, priorTask);
}

/** Moved from `CoordinationStore._validateRecoverySessionRequest` (issue #259 slice 2). State: the store, passed explicitly. */
export function _validateRecoverySessionRequest(sessionRequest, priorTask, fail) {
  const requestFields = ['context', 'id', 'mode'];
  const contextFields = new Set([
    'baseSha', 'branch', 'capacityReservation', 'logicalTaskId', 'ownerReceiptDigest', 'ownerTaskId', 'repoRoot',
    'sparseCheckoutIdentity', 'sparsePaths', 'toolchainProjection', 'worktree',
  ]);
  const context = sessionRequest?.context;
  let bytes = Number.POSITIVE_INFINITY;
  try { bytes = canonicalBytes(sessionRequest); } catch { /* malformed/cyclic values refuse below */ }
  if (!sessionRequest || typeof sessionRequest !== 'object' || Array.isArray(sessionRequest)
    || Object.keys(sessionRequest).sort().join(',') !== requestFields.sort().join(',')
    || sessionRequest.mode !== 'resume' || !boundedText(sessionRequest.id, 4_096)
    || !context || typeof context !== 'object' || Array.isArray(context)
    || Object.keys(context).some((key) => !contextFields.has(key))
    || !boundedText(context.worktree, 32_768)
    || !boundedText(context.ownerTaskId, 4_096)
    || (context.logicalTaskId !== undefined && !boundedText(context.logicalTaskId, 4_096))
    || (context.ownerReceiptDigest !== undefined && !/^[a-f0-9]{64}$/u.test(context.ownerReceiptDigest))
    || ['repoRoot', 'baseSha', 'branch'].some((key) => context[key] !== undefined
      && !boundedText(context[key], key === 'repoRoot' ? 32_768 : 4_096))
    || (context.sparsePaths !== undefined && (!Array.isArray(context.sparsePaths)
      || context.sparsePaths.length > 4_096
      || context.sparsePaths.some((path) => !boundedText(path, 32_768))))
    || ['sparseCheckoutIdentity', 'toolchainProjection', 'capacityReservation'].some((key) => context[key] !== undefined
      && (!context[key] || typeof context[key] !== 'object' || Array.isArray(context[key])))
    || bytes > 1024 * 1024) {
    fail('recovery refinement session context is malformed');
  }

  const priorContext = priorTask?.sessionRequest?.mode === 'resume'
    ? priorTask.sessionRequest.context
    : null;
  const expectedOwnerTaskId = priorContext?.ownerTaskId ?? priorTask?.id;
  const boundPhysicalOwner = priorContext === null
    && isPhysicalWorkspaceId(context.ownerTaskId)
    && context.logicalTaskId === priorTask?.id
    && /^[a-f0-9]{64}$/u.test(context.ownerReceiptDigest ?? '')
    && context.branch === `baton/${context.ownerTaskId}`
    && basename(context.worktree) === context.ownerTaskId;
  if ((context.ownerTaskId !== expectedOwnerTaskId && !boundPhysicalOwner)
    || (priorTask?.worktreeBaseSha != null && context.baseSha !== priorTask.worktreeBaseSha)
    || (priorContext && canonicalDigest(context) !== canonicalDigest(priorContext))) {
    fail('recovery refinement session context changes durable worktree lineage', 'recovery_refinement_conflict');
  }
}

/** Moved from `CoordinationStore.createAndClaimPlanRecoveryRefinement` (issue #259 slice 2). State: the store, passed explicitly. */
export function createAndClaimPlanRecoveryRefinement(store, fields, gate, route, attribution, auth) {
  if (!store._goalPlanPolicy) throw new CoordinationRefusal('goal/plan authority is not configured', 'goal_plan_unavailable');
  const requestDigest = goalPlanDigest({ principalId: auth?.principalId, gate, route, task: fields, attribution });
  const priorAdmission = store._byKey.get(auth?.key);
  if (priorAdmission) {
    const createdEvent = store._events[priorAdmission.seq];
    const claimedEvent = store._events[priorAdmission.seq + 1];
    const exact = priorAdmission.kind === 'plan.node_dispatched' && priorAdmission.actor === auth?.actor
      && priorAdmission.payload?.requestDigest === requestDigest
      && priorAdmission.batch?.kind === 'goal_plan_recovery_dispatch'
      && priorAdmission.batch.index === 0 && priorAdmission.batch.count === 3
      && createdEvent?.kind === 'task.created' && createdEvent.actor === priorAdmission.actor
      && createdEvent.idempotencyKey === `${auth.key}:task`
      && createdEvent.batch?.id === priorAdmission.batch.id && createdEvent.batch.index === 1 && createdEvent.batch.count === 3
      && claimedEvent?.kind === 'task.claimed' && claimedEvent.actor === priorAdmission.actor
      && claimedEvent.idempotencyKey === `${auth.key}:claim`
      && claimedEvent.batch?.id === priorAdmission.batch.id && claimedEvent.batch.index === 2 && claimedEvent.batch.count === 3
      && store._recoveryBatchIdentity('goal_plan_recovery_dispatch', [priorAdmission, createdEvent, claimedEvent]) === priorAdmission.batch.id;
    if (!exact) throw new CoordinationRefusal('plan recovery idempotency key is bound differently', 'plan_recovery_conflict');
    // #400: a triple that IS bound by this key can still fail fold adjudication — the live
    // predecessor this prospective lane re-reads may no longer be the completed, hub-verified task
    // the fold requires. That diagnosis is the caller's: the fold's own code crosses the surface
    // unchanged, the same way `_validateGoalPlanReplayTransactions` already lets it cross at
    // replay. Relabelling it `plan_recovery_conflict` makes a recorded transaction that can no
    // longer be adjudicated read as a key reuse.
    store._validateGoalPlanRecoveryTriple(priorAdmission, createdEvent, claimedEvent, false);
    return freeze({
      ok: true, result: 'idempotent', dispatchEvent: clone(priorAdmission),
      createdEvent: clone(createdEvent), claimedEvent: clone(claimedEvent),
      task: store.task(createdEvent.payload.id), dispatch: clone(priorAdmission.payload),
    });
  }

  const state = store._planDispatchState(gate, route);
  const fieldNames = [
    'brief', 'deps', 'effortRequested', 'id', 'modelPolicy', 'modelRequested', 'refines',
    'relation', 'reservedWorkerId', 'runId', 'sessionRequest', 'taskType', 'vendorRequested',
  ];
  const attributionNames = [
    'effortObserved', 'effortRequested', 'effortResolved', 'harnessRequested', 'harnessResolved',
    'modelObserved', 'modelRequested', 'modelResolved', 'routeKey',
  ];
  if (!fields || Object.keys(fields).sort().join(',') !== fieldNames.sort().join(',')
    || !attribution || Object.keys(attribution).sort().join(',') !== attributionNames.sort().join(',')
    || !boundedText(fields.id, 4_096) || !boundedText(fields.refines, 4_096)
    || !boundedText(fields.reservedWorkerId, 256) || fields.relation !== 'recovery'
    || !Array.isArray(fields.deps)
    || !boundedText(attribution.harnessRequested, 512) || !boundedText(attribution.harnessResolved, 512)
    || [attribution.modelRequested, attribution.modelResolved, attribution.modelObserved,
      attribution.effortRequested, attribution.effortResolved, attribution.effortObserved,
      attribution.routeKey].some((value) => value !== null && !boundedText(value, 8_192))) {
    throw new CoordinationRefusal('plan recovery refinement request is malformed', 'plan_recovery_invalid');
  }
  if (!state.node.capabilities.includes('native_session_recovery') || !state.node.effects.includes('provider_call')) {
    throw new CoordinationRefusal('plan node does not explicitly authorize native session recovery', 'plan_recovery_not_authorized');
  }
  if (store._tasks.has(fields.id)) throw new CoordinationRefusal('plan recovery task id already exists', 'duplicate_task');
  if (!planBriefMatches(fields.brief, state.brief, { goalPlanCoordinates: true })
    || canonicalDigest(fields.brief?.goalPlan) !== canonicalDigest(state.binding)
    || canonicalDigest(fields.brief?.capabilities) !== canonicalDigest(state.node.capabilities)
    || canonicalDigest(fields.brief?.effects) !== canonicalDigest(state.node.effects)
    || canonicalDigest(fields.brief?.requiredEffects ?? []) !== canonicalDigest(state.node.requiredEffects ?? [])
    || fields.brief?.providerTurns !== state.node.budget.providerTurns) {
    throw new CoordinationRefusal('task Brief differs from the approved recovery node', 'plan_brief_mismatch');
  }
  if (canonicalDigest(fields.deps) !== canonicalDigest(state.resolvedDeps) || !state.resolvedDeps.includes(fields.refines)) {
    throw new CoordinationRefusal('recovery lineage differs from the approved plan DAG', 'plan_dependency_mismatch');
  }
  const priorTask = store._tasks.get(fields.refines);
  if (!priorTask) throw new CoordinationRefusal('plan recovery prior task is unavailable', 'recovery_refinement_unverified');
  store._verifiedRecoveryPrior(priorTask, false);
  const recoveryFail = (message, code = 'recovery_refinement_invalid') => store._recoveryFailure(message, code, false);
  store._validateRecoverySessionRequest(fields.sessionRequest, priorTask, recoveryFail);
  const sameRequestedHarness = fields.vendorRequested === priorTask.vendorRequested
    || (priorTask.vendorRequested === 'auto' && fields.vendorRequested === attribution.harnessRequested);
  if (fields.runId !== state.goal.runId || fields.taskType !== (priorTask.taskType ?? 'general')
    || fields.reservedWorkerId !== priorTask.reservedWorkerId || fields.reservedWorkerId !== priorTask.assignee
    || !sameRequestedHarness || fields.vendorRequested !== route.vendor
    || canonicalDigest(fields.modelRequested ?? null) !== canonicalDigest(priorTask.modelRequested ?? null)
    || fields.modelRequested !== route.model
    || canonicalDigest(fields.modelPolicy ?? null) !== canonicalDigest(priorTask.modelPolicy ?? null)
    || canonicalDigest(fields.effortRequested ?? null) !== canonicalDigest(priorTask.effortRequested ?? null)
    || fields.effortRequested !== route.effort
    || attribution.harnessRequested !== route.vendor
    || attribution.modelRequested !== route.model || attribution.modelResolved !== route.model
    || (attribution.modelObserved !== null && attribution.modelObserved !== route.model)
    || attribution.effortRequested !== route.effort || attribution.effortResolved !== route.effort
    || (attribution.effortObserved !== null && attribution.effortObserved !== route.effort)) {
    throw new CoordinationRefusal('plan recovery changes immutable route or prior-task lineage', 'recovery_refinement_conflict');
  }

  const createdPayload = store._normalizedPlanRecoveryCreatedPayload(fields, priorTask);
  const claimedPayload = store._normalizedRecoveryClaimedPayload(createdPayload, attribution);
  const dispatchPayload = {
    schemaVersion: 1, requestDigest,
    authority: { principalId: auth.principalId, repoId: auth.repoId, runId: auth.runId ?? null },
    binding: clone(state.binding), taskId: createdPayload.id,
    taskPayloadDigest: canonicalDigest(createdPayload), claimPayloadDigest: canonicalDigest(claimedPayload),
    expectedDispatchVersion: 0, newDispatchVersion: 1,
    resolvedDeps: clone(state.resolvedDeps), nodeBudget: clone(state.node.budget),
    route: clone(route), capabilities: clone(state.node.capabilities), effects: clone(state.node.effects),
    ...(Object.hasOwn(state.node, 'requiredEffects') ? { requiredEffects: clone(state.node.requiredEffects) } : {}),
  };
  const fixedTs = store._clock();
  const prospectiveDispatch = { seq: store._events.length + 1, ts: fixedTs, payload: dispatchPayload };
  const prospectiveCreated = { seq: store._events.length + 2, ts: fixedTs, payload: createdPayload };
  const prospectiveClaimed = { seq: store._events.length + 3, ts: fixedTs, payload: claimedPayload };
  store._validateGoalPlanRecoveryTriple(prospectiveDispatch, prospectiveCreated, prospectiveClaimed, false);
  const [dispatchEvent, createdEvent, claimedEvent] = store._appendBatch([
    { kind: 'plan.node_dispatched', payload: dispatchPayload, auth: { actor: auth.actor, key: auth.key }, fixedTs },
    { kind: 'task.created', payload: createdPayload, auth: { actor: auth.actor, key: `${auth.key}:task` }, fixedTs },
    { kind: 'task.claimed', payload: claimedPayload, auth: { actor: auth.actor, key: `${auth.key}:claim` }, fixedTs },
  ], 'goal_plan_recovery_dispatch');
  const task = store.task(createdPayload.id);
  if (!task || task.status !== 'working' || task.assignee !== fields.reservedWorkerId || task.version !== 2) {
    throw new CoordinationIntegrityError('goal/plan recovery batch did not materialize exactly', 'goal_plan_recovery_batch_integrity');
  }
  return freeze({
    ok: true, result: 'claimed', dispatchEvent: clone(dispatchEvent), createdEvent: clone(createdEvent),
    claimedEvent: clone(claimedEvent), task, dispatch: clone(dispatchPayload),
  });
}
