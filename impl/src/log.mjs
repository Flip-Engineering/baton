// log.mjs — the append-only event log (one JSONL file per worker) + at-least-once
// read cursor. The ONLY source of truth (reliability rule 5); every in-memory index
// elsewhere is a projection rebuildable from here.

import {
  appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync,
  readdirSync, renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';

/** Issue #285 G-13: the archive holding retired workers' logs — `<dir>/archive/`. */
const ARCHIVE_DIR = 'archive';
const ARCHIVE_MANIFEST_FILE = 'manifest.json';
const ARCHIVE_TEMP_PREFIX = '.manifest-tmp-';

/**
 * @typedef {Object} BatonEvent
 * @property {number} seq        - per-worker, gap-free, 1-based, monotonic
 * @property {string} ts         - ISO-8601, hub-stamped (never caller-supplied)
 * @property {string} worker
 * @property {string} harness
 * @property {number} turnEpoch
 * @property {string} kind
 * @property {'worker'|'orchestrator'|'human'|'policy'} actor
 * @property {boolean} [emulated]
 * @property {*} payload
 */

export class Log {
  /**
   * @param {string} dir - directory holding `<workerId>.jsonl`; created if absent.
   * @param {() => string} [clock] - injectable ISO clock.
   */
  constructor(dir, clock = () => new Date().toISOString()) {
    this.dir = dir;
    this.clock = clock;
    /** @type {Map<string, number>} in-memory last-seq cache */
    this._seq = new Map();
    /** Issue #285 G-13: the archive manifest, read lazily and cached. `null` means unread. */
    this._archive = null;
    /** One immutable parsed event vector per worker. Reads never reparse an already indexed file. */
    this._index = new Map();
    /** File identity and parsed byte frontier for append-aware cross-instance reads. */
    this._indexFiles = new Map();
    this._parsePasses = 0;
    this._parsedEvents = 0;
    /** Per-worker kind index: worker -> kind -> the frozen events of that kind, in seq order. Built
     * on the first `byKind` request for a kind, then appended to on `append` and on a later parse
     * pass — see `byKind`. */
    this._kinds = new Map();
    mkdirSync(dir, { recursive: true });
  }

  /** @param {string} worker */
  _file(worker) {
    return join(this.dir, `${worker}.jsonl`);
  }

  /** Current last seq for a worker, recovered from disk on first touch. @param {string} worker */
  _lastSeq(worker) {
    if (!this._index.has(worker)) this._load(worker);
    return this._seq.get(worker) ?? 0;
  }

  _load(worker) {
    const f = this._file(worker);
    const indexed = this._index.get(worker) ?? [];
    const prior = this._indexFiles.get(worker) ?? null;
    if (!existsSync(f)) {
      if (prior?.exists && prior.size > 0) {
        throw Object.assign(new Error(`operational log ${worker} disappeared after indexing`), {
          code: 'operational_log_replaced',
        });
      }
      // Issue #285 G-13: an archived worker's log is not a missing log — it reads refused,
      // with the graceful path, so no caller mistakes retirement for data loss.
      if (this._archivedEntry(worker) !== null) {
        throw Object.assign(new Error(`operational log ${worker} is archived`), {
          code: 'operational_log_archived',
          worker,
          gracefulPath: 'restoreWorker(worker) brings the archived log back to the live directory',
        });
      }
      if (!this._index.has(worker)) {
        this._index.set(worker, indexed);
        this._indexFiles.set(worker, { exists: false, dev: null, ino: null, size: 0, mtimeMs: 0 });
        this._seq.set(worker, 0);
        this._parsePasses += 1;
      }
      return indexed;
    }
    const stat = statSync(f);
    if (prior?.exists && (stat.dev !== prior.dev || stat.ino !== prior.ino || stat.size < prior.size)) {
      throw Object.assign(new Error(`operational log ${worker} was replaced or truncated`), {
        code: 'operational_log_replaced',
      });
    }
    if (prior?.exists && stat.size === prior.size) {
      if (stat.mtimeMs !== prior.mtimeMs) {
        throw Object.assign(new Error(`operational log ${worker} changed inside its indexed prefix`), {
          code: 'operational_log_changed',
        });
      }
      return indexed;
    }
    const start = prior?.exists ? prior.size : 0;
    const length = stat.size - start;
    const raw = Buffer.alloc(length);
    if (length > 0) {
      const fd = openSync(f, 'r');
      try {
        let read = 0;
        while (read < length) {
          const count = readSync(fd, raw, read, length - read, start + read);
          if (count === 0) throw new Error(`operational log ${worker} changed during indexed read`);
          read += count;
        }
      } finally { closeSync(fd); }
      if (raw.at(-1) !== 0x0a) {
        throw Object.assign(new Error(`operational log ${worker} has a truncated tail`), {
          code: 'operational_log_truncated',
        });
      }
      const text = raw.toString('utf8');
      if (!Buffer.from(text, 'utf8').equals(raw)) {
        throw Object.assign(new Error(`operational log ${worker} is not exact UTF-8`), {
          code: 'operational_log_invalid',
        });
      }
      const lines = text.slice(0, -1).split('\n');
      const added = lines.map((line, offset) => {
        const index = indexed.length + offset;
        let event;
        try { event = JSON.parse(line); }
        catch {
          throw Object.assign(new Error(`operational log ${worker} has invalid JSON at ${index + 1}`), {
            code: 'operational_log_invalid',
          });
        }
        if (event?.worker !== worker || event?.seq !== index + 1) {
          throw Object.assign(new Error(`operational log ${worker} has an invalid sequence at ${index + 1}`), {
            code: 'operational_log_sequence',
          });
        }
        return deepFreeze(event);
      });
      indexed.push(...added);
      this._extendKinds(worker, added);
      this._parsePasses += 1;
      this._parsedEvents += added.length;
    } else if (!this._index.has(worker)) {
      this._parsePasses += 1;
    }
    this._index.set(worker, indexed);
    this._indexFiles.set(worker, {
      exists: true, dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs,
    });
    this._seq.set(worker, indexed.length);
    return indexed;
  }

  /**
   * Append an event, stamping a gap-free `seq` and `ts`. The partial MUST NOT carry
   * `seq`/`ts` (rejected before any slot is consumed, so a rejected call never gaps).
   * @param {Omit<BatonEvent,'seq'|'ts'>} partial
   * @returns {BatonEvent}
   */
  append(partial) {
    if (partial == null || typeof partial !== 'object') throw new TypeError('append: event object required');
    if ('seq' in partial) throw new TypeError('append: caller must not supply seq');
    if ('ts' in partial) throw new TypeError('append: caller must not supply ts');
    if (typeof partial.worker !== 'string') throw new TypeError('append: worker required');
    const seq = this._lastSeq(partial.worker) + 1;
    /** @type {BatonEvent} */
    const full = deepFreeze({ ...partial, seq, ts: this.clock() });
    appendFileSync(this._file(partial.worker), JSON.stringify(full) + '\n', 'utf8');
    this._seq.set(partial.worker, seq);
    this._index.get(partial.worker).push(full);
    this._extendKinds(partial.worker, [full]);
    const stat = statSync(this._file(partial.worker));
    this._indexFiles.set(partial.worker, {
      exists: true, dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs,
    });
    return full;
  }

  /** @param {string} worker @param {number} [fromSeq=1] @returns {BatonEvent[]} */
  read(worker, fromSeq = 1) {
    const events = this._load(worker);
    if (!Number.isSafeInteger(fromSeq)) return [];
    return events.slice(Math.max(0, fromSeq - 1));
  }

  /** Keep this worker's already-requested kind buckets in step with events that arrived after the
   * bucket was built. A bucket that has been handed out is frozen, so the first append after a
   * hand-out replaces it with a MUTABLE successor — the following appends of that kind then push in
   * place. The cost is one copy per hand-out, never one per append. */
  _extendKinds(worker, added) {
    const buckets = this._kinds.get(worker);
    if (buckets === undefined || added.length === 0) return;
    for (const [kind, bucket] of buckets) {
      const extra = added.filter((event) => event.kind === kind);
      if (extra.length === 0) continue;
      if (Object.isFrozen(bucket)) {
        const successor = [...bucket];
        successor.push(...extra);
        buckets.set(kind, successor);
      } else {
        bucket.push(...extra);
      }
    }
  }

  /**
   * The per-kind vector for one worker, in seq order: the attention derivations read a handful of
   * kinds (write results, interactions, gate verdicts, pushes, lifecycle edges) and each one would
   * otherwise slice the worker's ENTIRE event vector per call. The bucket is built from the
   * already-parsed vector on the first request for that kind and updated by `_extendKinds`.
   *
   * The returned array is the index's own, FROZEN: a caller that needs different elements asks for
   * a different kind, and an append after the hand-out replaces the bucket rather than mutating the
   * vector the caller holds. Index the kinds a reader repeats, never a hot write-only kind.
   * @param {string} worker @param {string} kind @returns {BatonEvent[]}
   */
  byKind(worker, kind) {
    if (typeof worker !== 'string' || worker.length === 0) throw new TypeError('byKind: worker required');
    if (typeof kind !== 'string' || kind.length === 0) throw new TypeError('byKind: event kind required');
    const events = this._load(worker);
    let buckets = this._kinds.get(worker);
    if (buckets === undefined) { buckets = new Map(); this._kinds.set(worker, buckets); }
    let bucket = buckets.get(kind);
    if (bucket === undefined) {
      bucket = events.filter((event) => event.kind === kind);
      buckets.set(kind, bucket);
    }
    return Object.freeze(bucket);
  }

  /** Exact O(1) lookup after the worker's single parse pass. */
  at(worker, seq) {
    if (!Number.isSafeInteger(seq) || seq <= 0) return null;
    return this._load(worker)[seq - 1] ?? null;
  }

  /** Immutable prefix lookup after the worker's single parse pass. */
  range(worker, throughSeq) {
    if (!Number.isSafeInteger(throughSeq) || throughSeq < 0) return [];
    return this._load(worker).slice(0, throughSeq);
  }

  readStats() {
    return Object.freeze({
      schemaVersion: 1,
      parsedWorkers: this._index.size,
      parsePasses: this._parsePasses,
      parsedEvents: this._parsedEvents,
    });
  }

  /** @param {string} worker @returns {number} last seq, or 0 */
  tail(worker) {
    return this._lastSeq(worker);
  }

  /** @returns {string[]} every LIVE worker id with at least one event on disk (archived workers excluded) */
  workers() {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((n) => n.endsWith('.jsonl'))
      .map((n) => n.slice(0, -'.jsonl'.length));
  }

  // ── Issue #285 G-13: archival ─────────────────────────────────────────────
  //
  // A retired worker's JSONL file moves to `<dir>/archive/<worker>.jsonl` and the move is
  // recorded in `<dir>/archive/manifest.json`. `workers()` then excludes it, so construction
  // replay (`_replay` reads `workers()` and folds each file in full) never reads its bytes
  // again — archival is what bounds operational-log startup work. The manifest is the
  // record: a live file whose worker the manifest lists is refused, never served.

  _archiveDir() {
    return join(this.dir, ARCHIVE_DIR);
  }

  _archiveFile(worker) {
    return join(this._archiveDir(), `${worker}.jsonl`);
  }

  _manifestFile() {
    return join(this._archiveDir(), ARCHIVE_MANIFEST_FILE);
  }

  _fsyncDir(dir) {
    try {
      const fd = openSync(dir, 'r');
      try { fsyncSync(fd); } finally { closeSync(fd); }
    } catch { /* directory fsync is unavailable on some supported hosts */ }
  }

  /** The validated manifest entries, read lazily once per instance. */
  _manifestEntries() {
    if (this._archive !== null) return this._archive;
    const file = this._manifestFile();
    if (!existsSync(file)) {
      this._archive = [];
      return this._archive;
    }
    let parsed = null;
    try { parsed = JSON.parse(readFileSync(file, 'utf8')); }
    catch {
      throw Object.assign(new Error('the operational log archive manifest is not valid JSON'), {
        code: 'operational_log_archive_invalid',
      });
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)
      || Object.keys(parsed).sort().join(',') !== 'entries,schemaVersion') {
      throw Object.assign(new Error('the operational log archive manifest is invalid'), {
        code: 'operational_log_archive_invalid',
      });
    }
    const seen = new Set();
    for (const entry of parsed.entries) {
      const keys = ['archivedAt', 'bytes', 'digest', 'events', 'schemaVersion', 'worker'];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || Object.keys(entry).sort().join(',') !== [...keys].sort().join(',')
        || entry.schemaVersion !== 1
        || typeof entry.worker !== 'string' || entry.worker.length === 0
        || !Number.isSafeInteger(entry.events) || entry.events < 0
        || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0
        || typeof entry.digest !== 'string' || !/^[a-f0-9]{64}$/u.test(entry.digest)
        || !Number.isFinite(Date.parse(entry.archivedAt))
        || seen.has(entry.worker)) {
        throw Object.assign(new Error('the operational log archive manifest is invalid'), {
          code: 'operational_log_archive_invalid',
        });
      }
      seen.add(entry.worker);
    }
    this._archive = parsed.entries;
    return this._archive;
  }

  _writeManifest(entries) {
    const dir = this._archiveDir();
    mkdirSync(dir, { recursive: true });
    const bytes = Buffer.from(`${JSON.stringify({ schemaVersion: 1, entries })}\n`, 'utf8');
    const temporary = join(dir, `${ARCHIVE_TEMP_PREFIX}${randomUUID()}`);
    let fd = null;
    try {
      fd = openSync(temporary, 'wx', 0o600);
      writeFileSync(fd, bytes);
      fsyncSync(fd);
      closeSync(fd); fd = null;
      renameSync(temporary, this._manifestFile());
    } catch (error) {
      if (fd !== null) try { closeSync(fd); } catch { /* original write error wins */ }
      try { unlinkSync(temporary); } catch { /* rename or cleanup already completed */ }
      throw error;
    }
    this._fsyncDir(dir);
    this._archive = entries;
  }

  /** The manifest entry for a worker, or null. */
  _archivedEntry(worker) {
    return this._manifestEntries().find((entry) => entry.worker === worker) ?? null;
  }

  _dropIndex(worker) {
    this._index.delete(worker);
    this._seq.delete(worker);
    this._indexFiles.delete(worker);
    this._kinds.delete(worker);
  }

  /**
   * Retire a worker's log: move its live file into the archive and record the manifest
   * receipt. The worker must have a live file; an already-archived worker refuses with
   * `operational_log_archived`. Archival is for terminal workers only — a live worker's
   * newer events would land in a fresh file the next append creates, splitting history.
   * @param {string} worker
   * @returns {Readonly<{schemaVersion:number,worker:string,events:number,bytes:number,digest:string,archivedAt:string}>}
   */
  archiveWorker(worker) {
    if (typeof worker !== 'string' || worker.length === 0) throw new TypeError('archiveWorker: worker required');
    const archived = this._archivedEntry(worker);
    if (archived !== null) {
      throw Object.assign(new Error(`operational log ${worker} is already archived`), {
        code: 'operational_log_archived',
        worker,
        gracefulPath: 'restoreWorker(worker) brings the archived log back to the live directory',
      });
    }
    const file = this._file(worker);
    if (!existsSync(file)) {
      throw Object.assign(new Error(`operational log ${worker} has no live log to archive`), {
        code: 'operational_log_archive_missing',
        worker,
      });
    }
    // Load first: the move is recorded only for a log that parses cleanly.
    const events = this._load(worker);
    const bytes = readFileSync(file);
    const digest = createHash('sha256').update(bytes).digest('hex');
    mkdirSync(this._archiveDir(), { recursive: true });
    renameSync(file, this._archiveFile(worker));
    this._fsyncDir(this._archiveDir());
    this._fsyncDir(this.dir);
    const entry = {
      schemaVersion: 1,
      worker,
      events: events.length,
      bytes: bytes.byteLength,
      digest,
      archivedAt: this.clock(),
    };
    this._writeManifest([...this._manifestEntries(), entry]);
    this._dropIndex(worker);
    return Object.freeze({ ...entry });
  }

  /**
   * Bring an archived worker's log back to the live directory, byte-identical.
   * @param {string} worker
   */
  restoreWorker(worker) {
    if (typeof worker !== 'string' || worker.length === 0) throw new TypeError('restoreWorker: worker required');
    const entries = this._manifestEntries();
    if (!entries.some((entry) => entry.worker === worker)) {
      throw Object.assign(new Error(`operational log ${worker} is not archived`), {
        code: 'operational_log_archive_missing',
        worker,
      });
    }
    const archived = this._archiveFile(worker);
    if (!existsSync(archived)) {
      throw Object.assign(new Error(`operational log ${worker} is archived but its file is missing`), {
        code: 'operational_log_archive_invalid',
        worker,
      });
    }
    renameSync(archived, this._file(worker));
    this._fsyncDir(this._archiveDir());
    this._fsyncDir(this.dir);
    this._writeManifest(entries.filter((entry) => entry.worker !== worker));
    this._dropIndex(worker);
    const events = this._load(worker);
    const entry = { schemaVersion: 1, worker, events: events.length };
    return Object.freeze(entry);
  }

  /** @returns {ReadonlyArray<Readonly<{schemaVersion:number,worker:string,events:number,bytes:number,digest:string,archivedAt:string}>>} */
  archivedWorkers() {
    return Object.freeze(this._manifestEntries().map((entry) => Object.freeze({ ...entry })));
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

/**
 * A persisted floor is either a bare non-negative integer or `{floor: n}`. Anything else — a torn
 * write, a truncated rename, a foreign or hand-edited file, a value of the wrong type — is
 * UNREADABLE: the at-least-once position is unknown, and the file says so by name (G-34).
 */
function parseFloor(raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('the persisted cursor floor is not JSON'), { reason: 'invalid_json' });
  }
  const floor = typeof value === 'number' ? value : value && typeof value === 'object' ? value.floor : undefined;
  if (!Number.isSafeInteger(floor) || floor < 0) {
    throw Object.assign(new Error('the persisted cursor floor is not a non-negative integer'), { reason: 'invalid_floor' });
  }
  return floor;
}

/**
 * At-least-once read position over one worker's Log. `next()` serves everything after
 * the persisted floor and does NOT advance it; only `ack()` moves the floor. So a crash
 * between `next()` and durable processing re-serves the same page (spec I3) — dropping an
 * event could drop a worker's unanswered question.
 *
 * An unreadable floor is never silently read as 0: an unknown position that replayed every event
 * the worker ever emitted as new (or, worse, skipped a page) is a fabricated observation, not a
 * recovered one. Reads refuse with the typed reason until a caller explicitly accepts the replay
 * through `repair()`.
 */
export class Cursor {
  /** @param {string} stateFile - path the ack floor is persisted to. */
  constructor(stateFile) {
    this.stateFile = stateFile;
    this._floor = 0;
    /** @type {{code: string, path: string, reason: string, message: string}|null} */
    this._unreadable = null;
    if (existsSync(stateFile)) {
      try {
        this._floor = parseFloor(readFileSync(stateFile, 'utf8'));
      } catch (error) {
        this._unreadable = Object.freeze({
          code: 'cursor_floor_corrupt',
          path: stateFile,
          reason: error?.reason ?? 'unreadable',
          message: String(error?.message ?? error),
        });
      }
    }
  }

  /** The typed floor-integrity fact, or `null` when the persisted floor was read honestly. */
  floorIntegrity() {
    return this._unreadable;
  }

  /** Explicit fresh start after an unreadable floor. Only a caller that has read the reason may
   * ask for it: it accepts that events served before the corruption are served again. */
  repair() {
    if (!this._unreadable) return Object.freeze({ repaired: false, reason: 'floor_readable', floor: this._floor });
    const unreadable = this._unreadable;
    this._unreadable = null;
    this._floor = 0;
    this._persist(0);
    return Object.freeze({ repaired: true, path: this.stateFile, reason: unreadable.reason, floor: 0 });
  }

  /** @param {Log} log @param {string} worker @returns {BatonEvent[]} */
  next(log, worker) {
    this._assertReadable();
    return log.read(worker, this._floor + 1);
  }

  /** Persist the new floor. Monotonic (never regresses); idempotent. @param {number} uptoSeq */
  ack(uptoSeq) {
    this._assertReadable();
    if (typeof uptoSeq !== 'number' || uptoSeq <= this._floor) return;
    this._floor = uptoSeq;
    this._persist(uptoSeq);
  }

  /** @returns {number} */
  floor() {
    return this._floor;
  }

  /** The one refusal every read path shares: the reason, the path, and the graceful path. */
  _assertReadable() {
    const unreadable = this._unreadable;
    if (!unreadable) return;
    throw Object.assign(
      new Error(`cursor floor ${this.stateFile} is unreadable (${unreadable.reason}): the at-least-once position is unknown`),
      {
        name: 'CursorFloorUnreadable',
        code: unreadable.code,
        path: unreadable.path,
        reason: unreadable.reason,
        floorIntegrity: unreadable,
        gracefulPath: 'repair() clears the unreadable floor and explicitly accepts a replay from the beginning',
      },
    );
  }

  _persist(floor) {
    mkdirSync(join(this.stateFile, '..'), { recursive: true });
    writeFileSync(this.stateFile, JSON.stringify({ floor }), 'utf8');
  }
}
