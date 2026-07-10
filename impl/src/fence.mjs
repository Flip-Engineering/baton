// fence.mjs — version-stamps. Pure in-memory bookkeeping the coordinator consults
// before committing any state change. Every control op is checked against the worker's
// current fence; a stale op is rejected, never applied (reliability rule "fencing").

/**
 * @typedef {{fence:number, turnEpoch:number}} FenceStamp
 * @typedef {{ok:boolean, result:'ok'|'stale_fence'|'unknown_worker', current?:number, currentTurnEpoch?:number}} FenceCheckResult
 */

export class FenceTable {
  constructor() {
    /** @type {Map<string, FenceStamp>} */
    this._t = new Map();
  }

  /** Register a worker at fence/turnEpoch = 1. Idempotent — never resets an existing worker. */
  register(worker) {
    if (!this._t.has(worker)) this._t.set(worker, { fence: 1, turnEpoch: 1 });
  }

  /** @param {string} worker @returns {FenceStamp} current stamp (does NOT advance) @throws {RangeError} if unregistered */
  issue(worker) {
    const s = this._t.get(worker);
    if (!s) throw new RangeError(`issue: unregistered worker ${worker}`);
    return { fence: s.fence, turnEpoch: s.turnEpoch };
  }

  /** @param {string} worker @param {FenceStamp} stamp @returns {FenceCheckResult} */
  check(worker, stamp) {
    const s = this._t.get(worker);
    if (!s) return { ok: false, result: 'unknown_worker' };
    if (stamp && stamp.fence === s.fence) {
      return { ok: true, result: 'ok', current: s.fence, currentTurnEpoch: s.turnEpoch };
    }
    return { ok: false, result: 'stale_fence', current: s.fence, currentTurnEpoch: s.turnEpoch };
  }

  /** New turn: fence+1, turnEpoch+1. @param {string} worker @returns {FenceStamp} */
  bumpTurn(worker) {
    const s = this._require(worker);
    s.fence += 1; s.turnEpoch += 1;
    return { fence: s.fence, turnEpoch: s.turnEpoch };
  }

  /** Human-authority action: fence+1, turnEpoch unchanged. @param {string} worker @returns {FenceStamp} */
  bumpHuman(worker) {
    const s = this._require(worker);
    s.fence += 1;
    return { fence: s.fence, turnEpoch: s.turnEpoch };
  }

  /** @param {string} worker @returns {FenceStamp} snapshot, no advance/check */
  current(worker) {
    const s = this._require(worker);
    return { fence: s.fence, turnEpoch: s.turnEpoch };
  }

  /** @param {string} worker */
  _require(worker) {
    const s = this._t.get(worker);
    if (!s) throw new RangeError(`unregistered worker ${worker}`);
    return s;
  }
}
