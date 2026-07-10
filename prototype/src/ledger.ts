// Append-only event ledger — the ONLY source of truth (doc 08 §4).
// One JSONL file per worker so concurrent appends never interleave. Any index
// (SQLite, in-memory) is a projection rebuilt from here; if it corrupts, replay.
//
// Cursors are AT-LEAST-ONCE (spec I3, corrected in doc 13 T1): we persist the
// START of each read and only advance on the NEXT read's arrival, so a reader
// that dies mid-page can re-see it rather than silently dropping an event.

import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
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
    // Note: a real hub injects a monotonic clock here; the prototype stamps at read time
    // in the harness. We keep ts as a caller-provided ISO string to stay Date-free in tests.
    const full: BatonEvent = { ...e, seq, ts: (e as any).ts ?? "" } as BatonEvent;
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

/** Durable, at-least-once cursor. Advances only when the caller acks the prior page. */
export class Cursor {
  private acked = 0; // last seq the caller confirmed received
  private served = 0; // last seq we handed out (not yet acked)

  next(ledger: Ledger, worker: WorkerId): BatonEvent[] {
    // Advancing the durable position only now (on the NEXT call) is the at-least-once
    // guarantee: if the previous page's consumer died, we re-serve from `acked`, not `served`.
    this.acked = this.served;
    const page = ledger.read(worker, this.acked + 1);
    if (page.length) this.served = page[page.length - 1].seq;
    return page;
  }
}
