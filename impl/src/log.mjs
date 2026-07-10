// log.mjs — the append-only event log (one JSONL file per worker) + at-least-once
// read cursor. The ONLY source of truth (reliability rule 5); every in-memory index
// elsewhere is a projection rebuildable from here.

import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
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
    mkdirSync(dir, { recursive: true });
  }

  /** @param {string} worker */
  _file(worker) {
    return join(this.dir, `${worker}.jsonl`);
  }

  /** Current last seq for a worker, recovered from disk on first touch. @param {string} worker */
  _lastSeq(worker) {
    if (this._seq.has(worker)) return this._seq.get(worker);
    let last = 0;
    const f = this._file(worker);
    if (existsSync(f)) {
      const lines = readFileSync(f, 'utf8').split('\n').filter((l) => l.length > 0);
      if (lines.length) last = JSON.parse(lines[lines.length - 1]).seq;
    }
    this._seq.set(worker, last);
    return last;
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
    const full = { ...partial, seq, ts: this.clock() };
    appendFileSync(this._file(partial.worker), JSON.stringify(full) + '\n', 'utf8');
    this._seq.set(partial.worker, seq);
    return full;
  }

  /** @param {string} worker @param {number} [fromSeq=1] @returns {BatonEvent[]} */
  read(worker, fromSeq = 1) {
    const f = this._file(worker);
    if (!existsSync(f)) return [];
    return readFileSync(f, 'utf8')
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l))
      .filter((e) => e.seq >= fromSeq);
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
