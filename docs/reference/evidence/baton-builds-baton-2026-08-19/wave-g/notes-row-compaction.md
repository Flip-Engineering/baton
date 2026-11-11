# ROW NOTES — #223 ledger compaction/archival (row-compaction)

[attempt: 30cb5c9c-4134-407f-b460-b04f6a26768e row-compaction]

Scope touched: `impl/src/coordination-store.mjs`, `impl/test/ledger-compaction-223-red.test.mjs`, this wave dir. No other files modified.

## What landed

The compaction seam, red-first, at the store boundary (no store internals ripped open):

1. **RED pin** — `impl/test/ledger-compaction-223-red.test.mjs`: a store with 4 terminal tasks (12 events) + 3 live tasks (6 events), compacted at `beforeSeq = 13`:
   - **(a) THE INTEGRITY LAW**: a fresh store over the compacted directory replays byte-identically to a control store over the untouched ledger (events, task projection, cursor). Segment+window reassembly ≡ full replay.
   - **(b)** `events.jsonl` holds only the window's 6 events, starts at the cut seq, strictly smaller bytes.
   - **(c)** the checkpoint envelope carries `throughSeq` = window count, `prefixBytes` = window bytes, the parsed cache `_events` = window events, while `_byKey` still spans the FULL history.
   - Plus mechanics: one content-addressed segment (`sha256(file) === digest`), the index recording `[fromSeq, throughSeq] + digest`, appends after compaction continue the global seq (`total + 1`) and replay.
   - RED at HEAD confirmed: `TypeError: store.compact is not a function`.

2. **The seam** — `compact({ beforeSeq })` on `CoordinationStore` (explicit operator verb; NO automatic trigger — cadence policy is a later row):
   - Archives the terminal prefix `[1, beforeSeq)` into a content-addressed segment file under `<root>/segments/<sha256>.jsonl` (root is `state/coordination` in deployments), exact JSONL bytes, temp+rename+fsync+0600.
   - Rewrites `events.jsonl` to the live window; rebuilds the checkpoint for the window; records the compact segment index at `segments/index.json` (schemaVersion 1, `archivedThroughSeq`, ordered `segments[]`).
   - Refuses under canonical-order pinning (`coordination_compact_refused`) and on invalid cuts; drift-guards the ledger before touching anything; idempotent (a repeat cut returns `null`); returns a frozen receipt.
   - The in-memory projection is untouched (it already spans full history), so `eventCursor()`, `events()`, `waitAfter`, and `_byKey` idempotency never observe a discontinuity. `_loadedLedgerIdentity` is re-based to the window bytes so the rolling digest and the deferred/release checkpoint writer stay exact.
   - **Replay path**: `_load` now loads segments (index) + window. `_loadSegmentState` reconciles the archived prefix against the ledger's own coverage (first live seq): a ledger starting at seq 1 is the complete history; a consistent index is trusted (replay re-verifies each segment's digest); an absent/stale/corrupt index is rebuilt by scanning the immutable segment files (hash + range verified). Startup `source` gains compacted labels (`segments_checkpoint[_tail]`, `segments_ledger[_fallback]`); `checkpointEvents`/`replayedEvents`/`totalEvents` stay honest.
   - **Crash ordering** (single writer, verb serialized by the writer lease): segment file → segment index → ledger rewrite → checkpoint. The archived bytes always land before the ledger truncates; the two partial-commit windows and a corrupt index are each recoverable on the next open (pinned by test 2).

3. **GREEN + batteries**: coordinator, durable-retry, lease-zombie-reap, checkpoint-deferred-229, workflow-as-data — 98/98 pass. blind-waits: 22/34 with exactly the same 12 RED-pin failures at HEAD (auth lanes, scratchpad publish — unrelated rows; verified identical with my change stashed out). Nearest neighbors pinning my changed paths all pass: phase92-replay-verifier (startupStatus/checkpoint restore semantics unchanged for uncompacted stores), event-log-read-scaling, issue45-startup-reconcile, issue62-write-failure, phase85-projection-poison, turn-checkpoints-31a, phase92-linear-replay, phase78-application-profile-replay, phase79-plan-wave-replay, phase62-goal-plan-replay, phase60-coordination-recovery, phase11 (29/30 — one pre-existing failure, identical at HEAD), phase85/92 replay set.

## Design decisions worth reviewing

- **Checkpoint = window-only parsed cache**: for compacted stores the envelope `throughSeq` is the window count and the parsed `_events` cache covers the window only (its bytes still equal the ledger prefix, so the parsed-prefix integrity check holds unchanged). `_byKey` and the projection maps stay full — replay and idempotent retries need every key, archived or not. The checkpoint envelope shape/schemaVersion is unchanged; the segment index supplies the archived count (`base`), and restore validates `_byKey.size === base + throughSeq` and the last absolute seq.
- **The index is a cache, not authority**: the content-addressed segment files are the durable archive; load rebuilds the index by scan when it is missing, stale, or corrupt, so an index hiccup can never destroy history. "Nothing is destroyed" is enforced by the segment-file-first write order + scan-rebuild.
- **Terminality is the cadence row's call**: the seam takes the operator's `beforeSeq` cut as given; it does not inspect wave membership. The fixture's archived prefix is genuinely terminal (completed tasks).

## Sibling coordination / conflicts

Parallel siblings share `coordination-store.mjs` (goalplan row) and `application.mjs` (goalplan + git-batch). My edits to coordination-store.mjs are confined to the enumerated seam sites: constants, constructor init, `_projectionCheckpointPayload`, `_writeProjectionCheckpoint`, `_restoreProjectionCheckpoint`, new `compact`/segment helpers, and `_load`. No conflicts observed in this worktree; integration should be re-verified when the siblings land (the load/checkpoint paths are the shared surface).

## Verification (deployment contract)

Executable `true`, args `[]`, cwd `.` — exit 0 (executed). RED→GREEN run: `node --test test/ledger-compaction-223-red.test.mjs` → 2/2 pass; batteries → 98/98; neighbors → all green as listed.
