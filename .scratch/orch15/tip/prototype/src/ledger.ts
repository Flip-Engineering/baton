// Append-only event ledger — the ONLY source of truth (doc 08 §4).
// One JSONL file per worker so concurrent appends never interleave. Any index
// (SQLite, in-memory) is a projection rebuilt from here; if it corrupts, replay.
//
// Cursors are AT-LEAST-ONCE (spec I3, corrected in doc 13 T1): we persist the
// START of each read and only advance on the NEXT read's arrival, so a reader
// that dies mid-page can re-see it rather than silently dropping an event.

import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BatonEvent, WorkerId } from "./types.js";

export class Ledger {
  private seqByWorker = new Map<WorkerId, number>();

  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private path(worker: WorkerId) {
    return join(this.dir, `${worker}.jsonl`);
  }

  /** Append an event, stamping the hub-authoritative seq + ts. Returns the stamped event. */
  append(e: Omit<BatonEvent, "seq" | "ts">): BatonEvent {
    const seq = (this.seqByWorker.get(e.worker) ?? 0) + 1;
    this.seqByWorker.set(e.worker, seq);
    // F4 fix: product code stamps a real hub-authoritative timestamp (the Date-ban is a
    // WORKFLOW-SCRIPT constraint, not a product one). Time-based signals (stall/loop/latency)
    // depend on this being real.
    const full: BatonEvent = { ...e, seq, ts: new Date().toISOString() };
    const p = this.path(e.worker);
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, JSON.stringify(full) + "\n", "utf8");
    return full;
  }

  /** Read events for a worker at or after `fromSeq`. At-least-once: caller dedups by seq. */
  read(worker: WorkerId, fromSeq = 0): BatonEvent[] {
    const p = this.path(worker);
    if (!existsSync(p)) return [];
    return readFileSync(p, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as BatonEvent)
      .filter((e) => e.seq >= fromSeq);
  }
}

/**
 * At-least-once cursor. Advances the durable position only after the caller ACKs the prior
 * page — so a consumer that died mid-page re-sees it rather than dropping events (spec I3).
 *
 * F5 fix: the acked position is PERSISTED to disk. The earlier in-memory version asserted
 * durability but died with the process it was meant to survive — the exact bug the design
 * warns about. `acked` now round-trips through a file so a restarted hub resumes correctly.
 */
export class Cursor {
  private acked: number;
  constructor(private stateFile: string) {
    this.acked = existsSync(stateFile) ? Number(readFileSync(stateFile, "utf8")) || 0 : 0;
  }

  /** Serve everything after the persisted ack. The caller MUST call `ack()` once it has durably consumed the page. */
  next(ledger: Ledger, worker: WorkerId): BatonEvent[] {
    return ledger.read(worker, this.acked + 1);
  }

  /** Persist the new floor. Idempotent; safe to replay. */
  ack(uptoSeq: number) {
    if (uptoSeq <= this.acked) return;
    this.acked = uptoSeq;
    mkdirSync(dirname(this.stateFile), { recursive: true });
    writeFileSync(this.stateFile, String(uptoSeq), "utf8");
  }
}
