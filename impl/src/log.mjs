// log.mjs — the append-only event log (one JSONL file per worker) + at-least-once
// read cursor. The ONLY source of truth (reliability rule 5); every in-memory index
// elsewhere is a projection rebuildable from here.

import {
  appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync,
  readdirSync, statSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

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
    /** One immutable parsed event vector per worker. Reads never reparse an already indexed file. */
    this._index = new Map();
    /** File identity and parsed byte frontier for append-aware cross-instance reads. */
    this._indexFiles = new Map();
    this._parsePasses = 0;
    this._parsedEvents = 0;
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

  /** @returns {string[]} every worker id with at least one event on disk */
  workers() {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((n) => n.endsWith('.jsonl'))
      .map((n) => n.slice(0, -'.jsonl'.length));
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

/**
 * At-least-once read position over one worker's Log. `next()` serves everything after
 * the persisted floor and does NOT advance it; only `ack()` moves the floor. So a crash
 * between `next()` and durable processing re-serves the same page (spec I3) — dropping an
 * event could drop a worker's unanswered question.
 */
export class Cursor {
  /** @param {string} stateFile - path the ack floor is persisted to. */
  constructor(stateFile) {
    this.stateFile = stateFile;
    this._floor = 0;
    if (existsSync(stateFile)) {
      try {
        const v = JSON.parse(readFileSync(stateFile, 'utf8'));
        this._floor = typeof v === 'number' ? v : (v.floor ?? 0);
      } catch { this._floor = 0; }
    }
  }

  /** @param {Log} log @param {string} worker @returns {BatonEvent[]} */
  next(log, worker) {
    return log.read(worker, this._floor + 1);
  }

  /** Persist the new floor. Monotonic (never regresses); idempotent. @param {number} uptoSeq */
  ack(uptoSeq) {
    if (typeof uptoSeq !== 'number' || uptoSeq <= this._floor) return;
    this._floor = uptoSeq;
    mkdirSync(join(this.stateFile, '..'), { recursive: true });
    writeFileSync(this.stateFile, JSON.stringify({ floor: uptoSeq }), 'utf8');
  }

  /** @returns {number} */
  floor() {
    return this._floor;
  }
}
