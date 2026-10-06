# audit-surface: OUTPUT_LOG surface inventory and boundary recommendation (Root75 preliminary, source-only)

Source/design review only, at audit-native tip cf654367 and release fca7af87 (installed) plus docs at the root checkout. No compilation, tests, fixtures or removals; no behavior, bytes or evidence changed. My prior verdicts stay preserved.

## 1. What the two persistent copies are

- **Raw attempt stream**: keeper-spooled child stdout at `<attempt-directory>/stdout`, lifecycle-bound — BR_ACK writes `acknowledged`, sets finishing and UNLINKS `directory/stdout` (installed fca, bend2/src/host/process-spawn.c:725-736); BP_ACK closes the reader spool (:612-618); the orphan-ACK path records the marker without the same unlink (:602-605). docs/bend2/architecture.md:195-196 documents this: successful acknowledgment removes the temporary raw stdout file; the filtered native log remains.
- **OUTPUT_LOG (filtered)**: the `log` argument; writers are `record_frame`/`append_frame` (turn.bend:329-343 — every consumed line except message_update, plus the retained `baton_event_filter` completion note at :364). It survives ACK and is the documented durable artifact.

## 2. Actual supported callers/readers (with attribution)

Product source:
- Writers only: turn.bend:329-343,364 (above). No product code reads the OUTPUT_LOG's content.
- `.stderr` sibling is a separate product input: `refusal` reads `log.stderr` for resume-refusal detection (turn.bend:507).
- Path attribution into delivered parent reports: `result_missing` embeds "Output: <log>. Stderr: <stderr>" (turn.bend:53) and `Stop.exited`/`exited_sql` embeds `'output', <log>` in the session-stopped report JSON (stop.bend:92-95). Recipients are told the path as the record — a path-stability and append-stability obligation, not a content dependency.
- Nonretained `Turn.started` reads the child stdout through the keeper PIPE; no attempt-directory spool exists for direct attempts, so OUTPUT_LOG is the ONLY retained output artifact on that path.

MCP/plugin glue: the conductor adapter passes dispatch/receiver paths only; no OUTPUT_LOG read/write.
observed-usage: reads the native conversation session file — a different artifact; not an OUTPUT_LOG consumer.

Shipped example (product-adjacent documented contract): docs/bend2/examples/probe-recovery-real-models.py:318-330 records a byte offset in the OUTPUT_LOG, then reopens and `seek(log_offset)`s to read the RESUMED SUFFIX — a documented offset-follow consumer that requires the log to stay append-stable at the same path across resume/attempt continuation.

Tests (in-repo contracts pinning observable behavior): turn.py (exact frame lists, retained lines, the baton_event_filter note), receive.py (log-vs-DB report equality), accept-root-day.py:180,203 (waits on live public tool frames appearing in the log), receive-terminal-boundary.py/receive-retained-replay.py (the #669/#670 pin's new assertions).

External unknown consumers: any recipient of a delivered report may follow the embedded log path; absence cannot be proven from a single observed invocation. Classification: content-coupled product contracts are (3), (4), (example); test conveniences are the in-repo assertions; everything outside the repository is unknown-by-construction.

## 3. Answer to Root75's question

Yes — the second persistent OUTPUT_LOG copy is required by real supported operations: it is the post-ACK durable record (the raw spool is deleted at ACK by documented contract), the only retained output for nonretained attempts, and the file the documented offset-follow example and the delivered path-attribution reports point at. Projection state that would remove it is unsupported by the current evidence.

## 4. Recommended boundary for a native output read/export/follow interface

- Live-tail/follow = the attempt-directory raw stream, PRE-ACK only, with explicit documented EOF at ACK (raw deletion is the contract, not a failure).
- Historical read/export = OUTPUT_LOG (filtered), which is the sole post-ACK source.
- The interface switches source at ACK explicitly; it derives on read and creates no new projection state, no generic logging store, no frontend, no cutoff.
- Compatibility obligations: log paths stable and append-stable across resume (offset-follow example); `.stderr` sibling unchanged; message_update filtering policy and the retained note line unchanged (tests pin exact frame lists); embedded path attribution unchanged; legitimate identical frames and full raw bytes preserved; live-tail behavior preserved pre-ACK.
- Multi-attempt: several attempt directories can feed one OUTPUT_LOG path across resume; lines currently carry no attempt attribution — attribution is only recoverable by joining execution rows to time ranges. State this as an open attribution gap; do not add state to close it.

## 5. Actual entry-call fixtures to require before any implementation

1. Receive fixture asserting log-vs-DB report equality (Controls' identified assertion).
2. accept-root-day-style live tool-frame wait on the log.
3. probe-recovery byte-offset suffix resume across a retained resume.
4. Nonretained direct turn asserting OUTPUT_LOG completeness with no attempt spool present.
5. Post-ACK assertion: attempt raw stdout absent AND filtered log complete (both frames and note).
6. The #662 filter-note line presence on OMP completion.

## 6. Limits

Source-only; remote-only; no live instrumentation. A single observed invocation without file reads cannot prove external dependence absent. Receives owns reconstruction; Controls owns host/file effects; this review owns only the surface inventory and boundary recommendation. My prior verdicts (2f846fb7 qualified runtime-only ACCEPT; 5254/1e7de621 REQUEST CHANGES) stay preserved.
