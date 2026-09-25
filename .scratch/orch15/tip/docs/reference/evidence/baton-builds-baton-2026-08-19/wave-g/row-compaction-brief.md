# ROW — #223 ledger compaction/archival (the flagship — highest leverage)

Measured context (binds): events.jsonl 85MB (142k events), projection.checkpoint
140MB. Boot replay ≈40s; the deferred checkpoint (95d5a67c) still pays the 140MB
serialize on-loop; every surface inherits these costs (#250's frame seam, the boot
settle window that ate 4 fleet-drive fires today, the OOM risk the campaign hit).

The contract sketch (from #223's issue + the #229 chain evidence):
- Archival of TERMINAL waves' event prefixes into content-addressed segments
  (segment = the event range [fromSeq, throughSeq] + sha256; the ledger keeps a
  compact index of segments).
- Live replay window = the active set (open waves' events + a bounded recent tail).
- projection.checkpoint = the live window only.
- The full ledger stays recoverable (segments reassemble deterministically —
  the event-sourcing law holds; nothing is destroyed).

Deliverable (red-first, SEAM-LEVEL — do not rip the store open):
1. RED pin impl/test/ledger-compaction-223-red.test.mjs: a store with N terminal
   events + M live events, compacted, (a) replays to the identical state
   (segment+window reassembly ≡ full replay — THE integrity law), (b) the live
   ledger file contains only the window's events (bounded bytes), (c) the
   checkpoint serializes the window only. RED at HEAD (no compaction).
2. Implement the seam: `compact({ beforeSeq })` on CoordinationStore — writes the
   segment file (content-addressed, under state/coordination/segments/), rewrites
   events.jsonl to the live window, rebuilds the checkpoint for the window, and
   records the segment index. Replay path: load segments (index) + window.
   NO automatic trigger yet — compaction is an explicit operator verb (a later row
   wires cadence policy); this row lands the mechanism + integrity law.
3. GREEN + batteries: coordinator, durable-retry, lease-zombie-reap,
   checkpoint-deferred-229, workflow-as-data, blind-waits (own RED roster aside).

Your [attempt:] line verbatim in the first five lines of your notes file.
Scope: impl/src/coordination-store.mjs, impl/test/**, this wave dir.
Report: docs/reference/evidence/baton-builds-baton-2026-08-19/wave-g/notes-row-compaction.md
