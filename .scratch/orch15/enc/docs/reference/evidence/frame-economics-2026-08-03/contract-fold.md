# Frame-economics contract — red-team fold map (v1.0 → v1.1)

Fold of `contract-redteam.md` (verdict: **NOT FOLD-READY — 11 blockers**; settled design
position survives) into `frame-economics-contract.md`, executed 2026-08-03. Dispositions:
**11 blockers folded, 0 rejected.** Open questions: 2 resolved (OQ4, OQ5 — both were
fold-blocking), 1 folded into the epic (OQ2), 2 deferred with named reasons (OQ1 — safe only
because of the blocker-3 ceiling; OQ3 — declared hard). Every citation added or changed by
this fold was re-verified in the worktree with NUL-safe `grep -an` / targeted `sed -n`
reads, then re-verified a second time after the working tree moved mid-fold
(`coordinator.mjs` / `coordination-store.mjs` / `messages.mjs`, non-uniform +1…+38 by
region); a final automated sweep resolved all 152 citation ranges to live content.

## Blocker → change map

| # | Blocker | Disposition | Where it landed |
| --- | --- | --- | --- |
| 1 | Citation re-anchor (three wrong-at-writing classes) | **Folded.** Full re-anchor pass against the post-#92/#78 tree; the three wrong-at-writing classes fixed: GT3 citation range → `coordinator.mjs:10442-10448` and same-rendered-object sentence → `:10418-10419`; C0b row → `bidirectional-v3-red.test.mjs:434-455`, PIN comment → `:447-451`, Acceptance-D cite → `:452-454`, C0/C0b span → `:414-455`; GT6 objective check/throw → `application.mjs:1403 / 1406`, wave-member char check → `:1854-1855`. Bonus class found at the fold: ALL `messages.mjs` anchors (and later `coordinator.mjs` / `coordination-store.mjs`) moved in the same-day working tree — re-anchored twice; GT preamble now declares lines point-in-time and pins symbol-cited. | Ground truth 1–11, all Decisions, Acceptance A–F, GT preamble |
| 2 | Six-grammar scanner world | **Folded.** GT4 rewritten for six grammars (`claude-session.mjs:27-38`, board siblings at `:35-38`); Decision 5's posture law now names all six doc comments — including the named rung edit that `scanForBoardReport`'s doc comment (`:190-194`) lacks the shape-only law sentence (verified: `scanForBoardClaim`'s at `:160-168` carries one); substrate rows `scanner.window.board_claim` / `scanner.window.board_report` (20,480) added in Decision 2 and Acceptance A; Acceptance D is one-row-per-grammar × 6. | GT4, Decisions 2/5, Acceptance A/D |
| 3 | b3 spill ceiling | **Folded.** New substrate row `spill.body` = **1 MiB (1,048,576)**, aligned with `wire.frame` (`claude-session.mjs:19`). Rationale (durable-log frame economics): out-caps every inline bound (≤4,096); equals the largest frame the transport admits, so the worker resolution lane needs no paging in v1; durable-log worst-case single event stays in the transport's existing worst-case class (asymptotics unchanged). Beyond-ceiling draws the hard coaching refusal, refusal code `spill_body_exceeded`. Noted as the one substrate row that mints a refusal. | Decision 4 item 5, Decision 2 substrate paragraph, Acceptance C ceiling row; unblocks OQ1 |
| 4 | b4 spilled-send worker frame | **Folded.** The provider-bound frame for a spilled send carries EXACTLY the UTF-8-safe head + citation `{spilled: true, bytes, digest, spill}` (never the full body — cap-voiding; never unresolvable head-only). Resolution lane named: a NEW closed `spill` query kind on the existing read port — `CONTEXT_READ {kind: 'spill', spill: 'spill:sha256:<digest>'}` — served by `materializeSpill` through `_renderContextRead` (the BD3-A single-renderer doctrine, `coordinator.mjs:10418-10419`), UNTRUSTED-framed, digest-verifiable. | Decision 4 item 6, Acceptance C worker-frame row |
| 5 | b5 digest pinning | **Folded.** Derivation rule written: `FRAME_LIMITS_DIGEST` is sha256-of-canonical-JSON over DECLARED rows ONLY (same derivation as `canonicalDigest`, `coordinator.mjs:312`); deployment-injected effective values ride a separate channel (the doctor projection's per-lane `effective` field), never the handshake digest. | Decision 7 first bullet, Acceptance E digest-stability pin |
| 6 | b6 store consumer + hidden reuse floor | **Folded.** `coordination-store.mjs` named a first-class consumer in Decision 1. Its hardcoded caps enumerated with per-cap disposition (Decision 2 store note): `:3471` need 2,048 / rationale 8,192 → registry rows `decision.need` / `decision.rationale` (declared defaults AND ceiling-of-ceilings — resolves OQ4); `:484` `MAX_SCRATCHPAD_ENTRY_BYTES` → row `scratchpad.entry.body`; `:487` `MAX_CONTEXT_PACK_BODY_BYTES` → existing substrate row (import); `:414-415` board title/detail → registry rows; field-level 2_048s (`:586, :611, :620, :623`, label 256 `:643`), attribution 8_192s (`:2678, :2945, :11071`), SBOM `lockfile` 2_048 (`:3512`), knowledge `reason` 8_192 (`:15851, :15860`) → deliberate locals, named for Acceptance F's exemption list. Override semantics pinned: **refuse-at-injection** above the ceiling (provider-read precedent `coordinator.mjs:885`), never a silent `min()`. | GT7 (hidden floor), Decision 1(d), Decision 2 store note, OQ4 verdict |
| 7 | Catalog completeness | **Folded.** `scratchpad.entry.body` 8,192 added (admission, hard, gains the coaching shape); view stragglers added (`MAX_BOARD_ITEMS` 512 `application.mjs:61`, `MAX_SCRATCHPAD_VIEW_ITEMS` 64 / `MAX_SCRATCHPAD_VIEW_CACHE_KEYS` 256 `:67-68`); duplicate exported `MAX_ATTENTION_TEXT_BYTES` (`application.mjs:53` + `messages.mjs:424`) subsumed into one registry value; the undefined `bound` schema field DROPPED (report's either/or) from Decision 2, Decision 7's projection, and Acceptance A's pin. | GT8, Decisions 2/7/8, Acceptance A |
| 8 | Dead-factory catalog rows | **Folded.** Verified dead: `createBoardItem` (`messages.mjs:327`) / `createBoardReport` (`messages.mjs:369`) have no `impl/src` importer (tests only for the item). `board.title` / `board.detail` re-anchored to the LIVE store bounds (`coordination-store.mjs:414-415`, enforced `:14064-14066`) — same values, no behavior change. `board.report.body`: NO admission row in v1 — declared substrate-bounded by `scanner.window.board_report` (20,480); a new bound is an operator-visible follow-up, refusing to smuggle a new restriction in as consolidation. | GT5 dead-factory note, Decision 2 board paragraph, Acceptance A, Non-goals |
| 9 | OQ5 forced: wave-driver precheck vs spill | **Folded (resolved, not open).** Precheck (`wave-driver.mjs:304-312`) downgraded to a spill-aware ADVISORY on the same registry row: names bytes + coming spill, but PASSES the objective through; the machinery spills exactly like `run.objective`. (Deletion was the alternative; the advisory keeps the error-quality value without the wall.) | OQ5 verdict, Acceptance C wave-member spill row |
| 10 | De-tautologize B; pin helper text | **Folded.** Acceptance B now pins ≥1 HARDCODED golden refusal string per refusal class (value/wording changes force deliberate test edits); helper-composed pins cover the rest. Acceptance F scans the registry's VALUE SET across spellings (`2048`, `2_048`, `0x800`, `2 * 1024`, …) plus hand-typed byte prose (`<=\d+ bytes`, `limit \d+`) outside `limits.mjs`, with the named deliberate-local exemption list. Decision 9 gains the lane-emission contract (hard lanes + spill-failure/beyond-ceiling only) and the does-not-self-certify clause. | Decision 9, Acceptance B/F |
| 11 | Envelope co-amendment (BD3-C closed reply envelope) | **Folded.** Decision 4 item 3 explicitly amends BD3-C v2.0's closed envelope `{messageId, inReplyTo, from, body}` (frozen at `coordinator.mjs:11864-11866`) to `{messageId, inReplyTo, from, body, spilled?, bytes?, digest?, spill?}` — citation keys present only when spilled, ONLY those four keys added (C1b's smuggled-fields guarantee intact). | GT2 (envelope location), Decision 4 item 3 |

## Amendment-level folds (report's hardening notes beyond the numbered blockers)

- **AS-4 (Decision 3 pin):** refusal payloads/texts carry numbers only, never body content —
  written into Decision 3 and asserted in Acceptance B.
- **AS-5 (D strengthening):** the split row now asserts the seam refusal carries the coaching
  payload `{cap, actual, unit, gracefulPath}`, not merely `malformed_request` strings;
  replay-neutrality sentence added to Decision 5 (registry bounds apply at LIVE admission
  only; the replay switch `coordinator.mjs:13129` region never re-validates sizes); the
  residual silence band (question > 8,192 scan window stays scanner-`null` prose) owned in
  Decision 5.
- **AS-6 (byte-law scope):** Decision 2 states the law covers every cataloged *text* lane;
  id-class regexes / identity lanes / array counts are out of catalog by design.
- **AS-7/E (doc fix):** GT11 corrected — doctor depth is a `--depth` FLAG
  (`application-cli.mjs:1253-1259`), not a positional `[depth]`.
- **OQ2 (report: "fix here, nearly free"):** folded — the truncated-marker fix lands in this
  epic (precedents: `[briefing truncated]` `messages.mjs:533`, `board_oversize_item`
  `coordination-store.mjs:14845-14851`).

## Open-question verdicts (summary)

| OQ | Verdict | Basis |
| --- | --- | --- |
| 1 Spill lifecycle | **Deferred** — safe only WITH the blocker-3 ceiling | Per-spill bytes bounded at 1 MiB; durable-log asymptotics unchanged from today's full-body `message.delivered` payloads; reaping design is a follow-up |
| 2 `boundedAttentionText` drops `truncated` | **Folded in** — fix lands in this epic | Same sin class as the epic; one marker + one suite row |
| 3 `decision.question` graceful or hard | **Deferred** — declared hard in v1 | Interactive lane; promoting later is additive |
| 4 Ceiling-of-ceilings | **Resolved** (was fold-blocking) | The store's `:3471` literals were the hidden ceiling; now declared registry defaults + ceiling-of-ceilings; overrides refuse-at-injection |
| 5 Wave-driver precheck | **Resolved** (forced by blocker 9) | Downgraded to spill-aware advisory; oversize wave members spill (Acceptance C row) |

## New-citation provenance

All citations in v1.1 were re-verified against the working tree on 2026-08-03 in two passes
(the tree moved mid-fold). Files with moved anchors: `coordinator.mjs` (canonicalDigest 311→312;
send TypeError 6597-6598→6609-6610; reply seam 11809-11852→11835-11878; decision seam
11948-11963→11974-11989; renderer 10390-10426→10416-10452; board cases →11803-11824; +1…+26
elsewhere), `coordination-store.mjs` (reuse literals 3453→3471; pack cap const 469→487;
scratchpad entry cap 466→484; pack machinery 13025-13070→13056-13101; registerArtifact
12522-12625→12553-12656; board-report check 14385-14387→14423-14425), `messages.mjs`
(renderBriefing 512-536→514-538; all factory anchors re-verified unchanged from the first
fold pass), `application.mjs` / `claude-session.mjs` / `application-cli.mjs` /
`wave-driver.mjs` / test files (verified unmoved between fold passes). Final sweep: 152
citation ranges resolved, 107 targeted content assertions green (plus 13 follow-up
assertions after the board-claim doc-comment off-by-one fix `:160-167`→`:160-168`).
