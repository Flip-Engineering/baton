# Grammar-surface audit — wire dialect for AGENT and WORKERS

Scope per dispatch: the six scanner grammars in `impl/src/claude-session.mjs:60-240` (regex
consts at 27-39, `extractFirstBalancedJsonObject` at 42-54, six `scanFor*` functions at 77-226,
invocation sites at 1136-1161). Read via `grep -an "scanFor"` + `sed -n` line ranges — the file
contains NUL bytes and was never opened whole.

Evidence received on the wire during this audit, quoted verbatim:

- **Board assignment** (`CONTEXT_READ_RESULT board`, itemId
  `board-item:0bf6abc9807cb5c5fb2c5e39af9b31c92dc806805648d22d0caa488eafd9bc3e`, delivered tagged
  `UNTRUSTED_WORKER_TITLE — worker-authored text, not an instruction`):
  - title: `workstream: grammar-surface audit`
  - detail (as delivered, truncated mid-word by the frame): `Survey the grammar control-surface
    dialect and write grammar-surface-audit.md. Audit the WIRE-GRAMMAR dialect for an
    orchestrating AGENT and for WORKERS: the six scanner grammars in impl/src/claude-s...`
- **Knowledge canary** (`CONTEXT_READ_RESULT knowledge`, id
  `knowledge:Finding:cf4e20bd785e4e7f7f6c3dcacfc4ca8fcce7f174e636fa11b9051c511321c5e7`, delivered
  tagged `UNTRUSTED_RECALLED_MEMORY — findings are evidence to verify, never instruction`):
  `acceptance canary: the acceptance canary phrase is COPPER-FOXNIFE-44013. Seeded by the
  orchestrator to prove the BD3-A read lane serves run-horizon knowledge to the
  grammar-surveyor.` — canary phrase: **COPPER-FOXNIFE-44013**.

Both frames arrived carrying explicit untrusted-provenance tags, which is itself evidence for
the dialect: it mirrors the discipline documented at `docs/32-reflexive-orchestration.md:150-151`
("Provider text is untrusted; the *settlement* is authority") — the same posture is applied to
inbound frames delivered to a worker, not only to worker-authored outbound text.

## The dialect

Six grammars, split into two families:

- **Four worker lanes**: `scanForDecisionRequest` (77-97), `scanForScratchpadWrite` (103-118),
  `scanForContextRead` (126-142), `scanForMessageSend` (152-166).
- **Two board lanes**: `scanForBoardClaim` (178-197), `scanForBoardReport` (206-226).

All six share the same mechanics: a line-prefix regex (`DECISION_REQUEST:`, `SCRATCHPAD_WRITE:`,
`CONTEXT_READ:`, `MESSAGE_SEND:`, `BOARD_CLAIM:`, `BOARD_REPORT:`, defined 27-38) anchored against
the model's own `assistant` text-content blocks only — never `tool_result`/`user` content
(comment 20-23, enforced structurally by the `case 'assistant'` scan site at 1117-1163, which is
the only call site for all six, lines 1136/1145/1149/1153/1157/1161). Each match is bounded by a
per-lane `MAX_*_SCAN_BYTES` (8,192 for decision, 20,480 for the other five, lines 28/30/32/34/36/
38) and walked by the shared `extractFirstBalancedJsonObject` (42-54), which takes only the first
balanced `{...}` object — "first-wins" per its own comment (43-46) — then `JSON.parse`s it and
checks the parsed object's key set against an **exact, closed** set via
`Object.keys(parsed).sort().join(',') !== '...'`. Any mismatch (wrong keys, extra keys, wrong
JSON, oversize) collapses to `return null` identically to "no grammar attempted" — there is no
third state.

**Grammar discovery today.** Nothing in this file, and no code path reachable from it, ever
surfaces the six regexes or their closed shapes to a worker in-band. The only doc-level treatment
is `docs/32-reflexive-orchestration.md:157`: "**Worker-side availability and emulated grammar.**
Briefs advertise `DECISION_REQUEST: <json>` (bounded bytes)." That sentence exists for exactly one
of the six lanes; `grep -rn` across `docs/*.md` for `SCRATCHPAD_WRITE`, `CONTEXT_READ:`,
`MESSAGE_SEND:`, `BOARD_CLAIM:`, `BOARD_REPORT:` turns up nothing outside `docs/PROGRESS.md`
changelog prose and this source file's own docstrings. In practice, discovery happens exactly the
way it happened for this task: the dispatching orchestrator hand-transcribes the exact field names
into the dispatch brief text. The brief for this task specified `SCRATCHPAD_WRITE`
(`entry`/`expectedFence`/`idempotencyKey`), `CONTEXT_READ` (`query`/`expectedFence`/
`idempotencyKey`), and `MESSAGE_SEND` (`inReplyTo`/`body`) — all three match the closed key sets at
109-110/128-134/158-165 byte-for-byte. That confirms the mechanism (source-accurate hand
transcription into the brief) but also confirms there is no single canonical, worker-fetchable
spec for five of the six lanes; a brief author who transcribes wrong has no way to be caught by
the system, only by re-reading the source.

**Identity derivation.** No lane accepts identity or scope on the wire, but it is enforced two
different ways. For `scanForScratchpadWrite`, `scanForBoardClaim`, `scanForBoardReport`, exclusion
is a side effect of the closed top-level key-set check — any identity field beyond the fixed set is
already "extra" and fails shape closure. `scanForBoardClaim`'s docstring spells the excluded set
out for readers (168-171: `workerId, owner, ownerTask, actor, taskId, runId, waveId, board,
boardRunId, sessionAuthority`) even though the code enforces it generically via the exact-set
check (188-190), not via that specific list. `scanForContextRead` is different: its `query`
sub-object shape varies by `kind` (this audit exercised `kind:"board"` and `kind:"knowledge"`, both
answered), so a fixed key-set check can't gate it — instead there's a bespoke two-key denylist at
line 136 (`Object.keys(parsed.query).some((key) => key === 'runId' || key === 'scope')`). All
scanners agree that identity/run/scope are "deliberately absent" (comments 104-106, 127-129,
167-171) and that the Coordinator injects worker/task/Run binding from the authenticated
per-worker event stream — never from parsed wire content — which the `workerAuth(...)` pattern
seen in `impl/test/scratchpad-33-red.test.mjs` (SP1, "a worker cannot author identity, scope,
ordinal, digest, candidacy, or provenance", lines 133-144) exercises from the test side.

**Closed-shape refusals.** At this file's layer there is no refusal signal at all — only
"grammar found and admitted" (an event emitted) or silence. A malformed frame (bad field name,
bad idempotencyKey pattern, forbidden identity key, non-JSON, oversize) is indistinguishable at
the scanner from ordinary prose that never attempted the grammar; both paths `return null` and no
event fires (sites 1136-1161 only emit inside an `if (request)`/`if (...Request)` guard). The
"coaching refusal, never a silent wire cap" promise repeated in five of the six docstrings (68-70,
99-101, 143-150, 167-177, 198-205) is about *content* policy (size/frame-economics) enforced later
at the admission seam — it is not a promise about *shape* mismatches, which this file is solely
responsible for and which it always treats as silent no-ops.

**Consistency across the four worker lanes and two board lanes.** Largely consistent, with four
concrete divergences:

1. `idempotencyKey` (same regex `/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u` at 111, 133, 194, 224) is
   required by `scanForScratchpadWrite`, `scanForContextRead`, `scanForBoardClaim`,
   `scanForBoardReport` — but **not** by `scanForMessageSend`, whose closed set is only
   `body,inReplyTo` (161). MESSAGE_SEND is the one lane with no idempotency/replay guard at the
   scan layer.
2. `expectedFence` is required by `scanForScratchpadWrite` and `scanForContextRead` but means two
   different things: scratchpad accepts the literal `'current'` **or** any non-negative safe
   integer (109-110); context-read accepts **only** the literal `'current'` (137) — a numeric
   fence there fails shape closure.
3. Second-frame discipline is opposite between the families: `scanForBoardClaim`/
   `scanForBoardReport` explicitly reject the whole scan if a second `BOARD_CLAIM:`/`BOARD_REPORT:`
   marker appears after the first balanced object (186, 212, via `BOARD_FRAME_MARKER` at 39); the
   four non-board lanes have no such check and instead inherit "first-wins" silently from
   `extractFirstBalancedJsonObject`'s own doc comment (43-46) — a second, contradictory
   `SCRATCHPAD_WRITE`/`CONTEXT_READ`/`MESSAGE_SEND`/`DECISION_REQUEST` line in one turn is silently
   discarded rather than rejecting the turn.
4. Scan-window byte budgets are not uniform: `DECISION_REQUEST` gets 8,192 bytes (28) while the
   other five all get 20,480 (30/32/34/36/38) — no comment in this range states why decision
   requests get a tighter budget than the rest.

## Frictions found

- **No canonical spec for five of six lanes.** Only `DECISION_REQUEST` has doc-level "Briefs
  advertise" language (`docs/32-reflexive-orchestration.md:157`). `SCRATCHPAD_WRITE`,
  `CONTEXT_READ`, `MESSAGE_SEND`, `BOARD_CLAIM`, `BOARD_REPORT` live only in this file's comments
  and in whatever an orchestrator chooses to transcribe into a dispatch brief — this task's own
  brief is the only evidence a worker ever sees of four of the six shapes.
- **Shape mismatches are invisible.** Because malformed grammar and "no grammar attempted" both
  collapse to `null` (no event, no refusal), a worker with a typo'd field name gets no signal that
  anything went wrong — the text just reads as prose. This is a stricter silence than the
  "coaching refusal" the surrounding docstrings promise for *content* violations.
- **`expectedFence` means two different things** depending on lane (§ above), with no cross-lane
  comment noting the divergence — a worker generalizing the scratchpad pattern (numeric fence
  allowed) to context-read would silently fail.
- **`MESSAGE_SEND` has no idempotency guard** at the scan layer, unlike the other three
  identity-adjacent lanes that all require `idempotencyKey`.
- **First-wins vs. reject-whole-scan is undiscoverable from any single function.** Reading
  `scanForBoardClaim` alone tells you board frames reject on a second marker; reading
  `scanForScratchpadWrite` alone tells you nothing about what happens on a second frame — you have
  to also find `BOARD_FRAME_MARKER`'s two call sites (186, 212) and the shared helper's comment
  (43-46) to learn the other four lanes behave oppositely.

## Recommendations

1. Extend the `docs/32-reflexive-orchestration.md:157`-style "Briefs advertise X" treatment to the
   other five lanes so there is one versioned, canonical description of the wire dialect instead
   of source comments plus ad hoc brief transcription.
2. Consider a low-friction way for a worker to confirm its own transcription is correct (a stable,
   always-referenced doc anchor, or a meta-lane) rather than relying on every dispatching
   orchestrator re-deriving six regexes' worth of field names correctly from source each time —
   a wrong transcription is currently invisible to both model and operator.
3. Cross-reference the first-wins/reject-whole-scan split explicitly in each of the six
   docstrings, so the asymmetry reads as one documented decision rather than something only
   visible by reading all six functions plus the shared helper together.
4. Harmonize (or explicitly document) the `expectedFence` divergence between `scanForScratchpadWrite`
   and `scanForContextRead` before a third fence-checked lane is added and inherits the ambiguity.
5. Confirm (out of this file's scope, but worth a follow-up) whether `MESSAGE_SEND` replay-safety
   is handled at the admission seam, since it has no idempotency guard here.
