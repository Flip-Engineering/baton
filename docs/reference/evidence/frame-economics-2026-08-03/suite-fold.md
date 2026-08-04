# Suite-fold map — frame-economics red suite + contract, post-blue-team v1.2 (2026-08-04)

Authority: `suite-blueteam.md` (**NOT-READY, 4 blockers** — the suite itself verified honest and
sharp: 40/40 red rows at named stages, zero fixture bugs, zero false greens, fully hermetic).
Folded in place on 2026-08-04: **4/4 blockers folded, 0 rejected**. Every file:line citation
was re-verified in this tree before use (NUL-containing `coordinator.mjs` / `application.mjs`
/ `coordination-store.mjs` via `grep -an` + `sed -n` only). Two blue-team citations were
off by one and were folded at their VERIFIED lines: the reply envelope freeze is
`coordinator.mjs:12207-12209` (report said `:12206-12208`); the pack-body enforcement is
`coordination-store.mjs:13060` (report said `:13061`); the report-admission call is
`coordinator.mjs:12161` (report said `:12160`). The report's "17 schema/northbound hits"
enumerates 16 by its own list (7 application-semantics + 8 mcp-northbound + 1 web-northbound);
the 17th is the `application.mjs:1855` wave-member char door the byte law names separately.
Artifacts touched: the contract (`frame-economics-contract.md` v1.1 → v1.2), the suite
(`impl/test/frame-economics-red.test.mjs`), and this map. Nothing else.

## Before/after splits (exact, run from the repo root)

`node --test impl/test/frame-economics-red.test.mjs`, node v25.8.0, repo root:

| | tests | red | green pins | F1 unconsolidated hits |
|---|---|---|---|---|
| Before (v1.1, blue-team measured) | 47 | 40 | 7 (D2, D3, D4, D5, D6, F2, F3) | 46 |
| After (v1.2, this fold) | 50 | 43 | 7 (same seven) | 55 |

The failing set after is EXACTLY the baseline 40 plus the three new rows (B15, B16, C10);
A6 was retargeted and stays red at the same named stage (`registry-missing`); D5's pin stays
green for the same legitimate reason with a corrected message. No red row was weakened; no
pin was touched behaviorally. F1's +9 hits are the de-exempted legacy-alias door literals
(`application-semantics.mjs:299/:523/:1596`, `mcp-northbound.mjs:357/:412/:485`,
`application.mjs:1797/:2930`, `coordination-store.mjs:4292`) — a cataloged lane's literals do
not hide behind exemptions; they retire on import like every other cataloged literal. The
mcp-northbound feedback-finding message schema (`:331`, `maxLength: 4_096`, uncataloged lane)
keeps an exemption under its proper class (it rode the removed alias regex's 4_096 arm).

## Blocker → change map

### BLOCKER 1 (headline) — the board.report.body contract/tree contradiction

Blue team: the v1.1 fold believed the store's board-report body check shape-only
(`coordination-store.mjs:14423-14425` — an anchor that lands in the doc comment/idempotency
prelude); the live tree enforces 4,096 BYTES at `submitBoardReport` (`:416` declared,
`:14442` enforced via `boardBounded` `:430-432` = `Buffer.byteLength(value) <= maxBytes`,
refusal `invalid_board_report`), second live door `application-semantics.mjs:1426`. Live code
is authoritative; the contract moved. All lines verified in this tree.

Contract (v1.2):
- Header fold note records the correction and the disposition.
- Ground truth 5: the "shape-only / only bound is the 20,480 window" claim replaced with the
  verified enforcement evidence (`:416`, `:14442`, `:430-432`, `:12161`,
  `application-semantics.mjs:1426`); the dead-factory ruling (blocker 8's core) stands.
- Decision 2: `board.report.body` added to the lane list; the "substrate-bounded in v1"
  paragraph replaced — the lane is a live ADMISSION row, hard, coaching,
  `refusalCode: 'board_report_exceeded'`, at the LIVE 4,096 value (the
  `board.title`/`board.detail` disposition; deleting the bound would smuggle a behavior
  removal in as "consolidation", the inverse of blocker 8's rationale); the
  `scanner.window.board_report` substrate row stays declared beside it. Store enumeration
  gains the `:416`/`:14442` entry.
- Non-goals: promoting the lane to spill is the operator-visible follow-up (was: "gains NO
  admission bound at all in v1").
- Acceptance A: catalog gains `board.report.body` 4,096 hard with the live-value citations.

Suite:
- A6 RETARGETED — was "carries NO admission row in v1"; now asserts the admission row EXISTS
  at the live value (class/value/unit/graceful null/refusalCode/enforcedAt) AND that the
  20,480 substrate row stays. Red today at `registry-missing` (same stage as A1-A5).
- B15 ADDED — the coaching row for the lane: `store.submitBoardReport` with an oversize body
  (every other field well-formed; the body check fires first at `:14442`) asserts code
  `board_report_exceeded`, payload `{cap: 4096, actual, unit, gracefulPath}`, both-numbers
  message, no body content, composed text vs the registry row. Red today at
  `refusal-coaching-missing` (numberless `invalid_board_report`).
- D5 MESSAGE FIXED (the blue team's exact fix) — the pin's behavior was always layer-correct
  (the scanner admits 5,000 bytes shape-only); its message taught the falsehood "the only
  live bound is the 20,480 scanner window". The message now names the store bound
  (`:416`/`:14442`), the schema second door (`:1426`), and the layer split (wire admits what
  admission refuses — B15). Retitled; still green.
- F1: the `:416` non-exemption note updated to record the resolution; `:416`/`:14442`/`:1426`
  remain ordinary hits that retire on import.

### BLOCKER 2 — the alias-door 16,384 unscoped

Blue team: the legacy `run.send` / `run.act send` / workstream-notify message args enforce
16,384 inline (`application.mjs:1797/:2930`, `coordination-store.mjs:4292`, plus schemas) —
a documented economy bypass unless adjudicated; three dispositions offered (inherit
`message.send.body`, own cataloged row at 16,384, legacy-out-of-scope time-boxed). Folded
disposition: **own cataloged row at the LIVE value** — the same disposition the fold applied
to every other live bound (no value change, no new spill machinery on a legacy path; the
bypass becomes named, doctor-visible, and digest-pinned; collapsing into
`message.send.body` stays an operator-visible follow-up). Verified live: the door family is
`run.send` / `run.act send` / `run.workstream.notify` / `waves.send` — schemas
`application-semantics.mjs:299/:523/:1596`, `mcp-northbound.mjs:357/:412/:485`.

Contract (v1.2):
- Decision 2: new paragraph — `run.legacy_send.body` 16,384 admission row, hard, coaching,
  `refusalCode: 'run_legacy_send_exceeded'`, at the LIVE value; the rejected disposition
  (silence) named. Lane list and store enumeration (`:4292` + sibling doors) updated.
- Non-goals: collapsing the alias into `message.send.body` (2,048 + spill) is an
  operator-visible follow-up.
- Acceptance A: catalog gains the lane with its live citations.

Suite:
- ADMISSION_LANES gains `['run.legacy_send.body', 16384, 'bytes', null,
  'run_legacy_send_exceeded']` (A2 covers it at `registry-missing`).
- B16 ADDED — drives the lightest real door, `application.notifyWorkstream`
  (argument validation fires before run state, `application.mjs:1797`), with a 16,400-byte
  message; asserts code `run_legacy_send_exceeded`, the coaching payload at cap 16,384, and
  the composed text. Red today at `refusal-coaching-missing`
  (`application_workstream_notify_invalid`, numberless).
- F1: the six alias-door exemption entries REMOVED (class retired — a cataloged lane's
  literals must not hide); the nine door literals join the hit set (46 → 55); the mcp
  feedback-finding message schema re-exempted under `uncataloged`. Header oracle note records
  the resolution.

### BLOCKER 3 — the schema/northbound second-door class

Blue team: 16 of F1's 46 hits are char `maxLength` / byte checks on CATALOGED lanes at the
application-semantics / northbound layers, all verified real; the suite's unconditional
reading of Decision 8 is correct per its letter; the contract's consumer list must name the
class. Suite row itself needed no change. (All 16 lines re-verified in this tree;
`application.mjs:1855` is the 17th by the report's headline count.)

Contract (v1.2):
- Decision 1: the consumer list now names `application-semantics.mjs` / `mcp-northbound.mjs`
  / `web-northbound.mjs` as registry consumers — their second doors import the registry row
  or retire their duplicate checks; exempting them would ratify the wave-member char-check
  sin class at the schema layer.
- Decision 8: new "layer-unconditional" sentence — no module re-declares reaches the
  arg-schema and northbound layers exactly as it reaches coordinator/store/application code;
  the suite's unconditional reading is ratified.

Suite:
- F1's scan and exemptions UNCHANGED for this class (the hits were never exempted); the
  header oracle note and the exemption-table comment updated from "flagged, blue team must
  resolve" to the ratified resolution.

### BLOCKER 4 — the wave-member byte law has no oracle

Blue team: the byte law explicitly fixes the wave-member character check
(`application.mjs:1854-1855`) and OQ5 mandates spill over wall, but C8 drives a fake
`baton.waves.start`; a surviving char-check refusal (`application_wave_attach_invalid` at
4,097 chars — the wall behind the advisory) greens the whole suite. Fix: a row driving an
oversize (ideally multibyte) wave member through the real application wave-start path,
asserting admit-with-spill (never refusal) and byte-measured accounting.

Suite:
- C10 ADDED — drives `application.startWave` (the driver's REAL path; the fake is not
  involved) with a member objective of `'é'.repeat(4100)` = 4,100 chars / 8,200 bytes — over
  4,096 in BOTH measures today, byte-vs-char discriminating under the correct implementation.
  Asserts: no refusal (the wave starts, the member produces a Run); a durable `spill.minted`
  event carries the byte-identical objective; `materializeSpill` serves it with
  `bytes === Buffer.byteLength(objective)` (8,200, never 4,100 chars); and a second arm
  through `application.attachWave` asserts the attach member door NEVER draws the size
  refusal (`application_wave_attach_invalid` — the named wrong implementation). Red today at
  the new named stage `wave-member-spill-missing` — observed failing on the real wall
  (`application_wave_start_invalid` via `validText`'s 4,096-byte default at
  `application.mjs:11506`), proving the fixture drives the genuine admission path.
- Contract (v1.2): Acceptance C gains the sentence naming the real-admission drive and the
  byte-measured accounting (behavior was already named; no decision text change).

### Re-anchor (blue-team §5, cosmetic, folded with BLOCKER 1 as instructed)

The third same-day tree shift's moved citations are re-anchored in place across the contract:
send TypeError `6609-6610` → `6633-6634`; orientation note `6898` → `6922`; reply seam
`11835-11878` → `12167-12217` (spread seam `12179-12184`, shape check `12177-12185`, reasons
`12186-12200`, mint `12204-12221`); closed envelope `11864-11866` → `12207-12209`; decision
seam `11974-11989` → `12317-12329`; renderer `10416-10452` → `10419-10472`; replay switch
`13129` → `13472` region; scope-refresh `8470-8475` → `8496`; serveKnowledge `10141-10147` →
`10188`; inspectCapturedFile `4610, 4620` → `4634, 4644`; wave-driver precheck `304-312` →
`321-329`; store reuse literals `3471` → `3485`; board title/detail enforcement
`14064-14066` → `14270-14272`; board-report check `14423-14425` → `14442`; pack body
enforcement `13042` → `13060`. Each new line verified in this tree before use.

## Rows added / changed (suite)

| Row | Change | Named stage today |
|---|---|---|
| A6 | Retargeted: asserts the live `board.report.body` admission row EXISTS at 4,096 (+ substrate row stays) | `registry-missing` (unchanged) |
| B15 | NEW: coaching refusal over `submitBoardReport` at 4,096 | `refusal-coaching-missing` |
| B16 | NEW: coaching refusal over `notifyWorkstream` at the live 16,384 | `refusal-coaching-missing` |
| C10 | NEW: wave-member byte-law oracle over real `startWave` + `attachWave` | `wave-member-spill-missing` (new stage) |
| D5 | Message/title fixed to name the live store bound; pin behavior unchanged, still green | — (pin) |
| F1 | Six alias-door exemptions removed (46 → 55 hits); comments record the v1.2 dispositions | `single-source-not-landed` (unchanged) |
| Header | v1.2 fold reference; inventory + split declaration; new named stage; refusal-code surface += `board_report_exceeded`, `run_legacy_send_exceeded`; three oracle notes resolved | — |

## Contract amendments (v1.1 → v1.2)

1. Header: v1.2 fold note (4/4 blue-team blockers, dispositions, re-anchor map).
2. GT5: board-report live-bound correction (the headline evidence).
3. Decision 1: consumer list += arg-schema/northbound layers (BLOCKER 3).
4. Decision 2: lane list += `board.report.body`, `run.legacy_send.body`; substrate-bounded
   paragraph replaced by the live-admission-row disposition (BLOCKER 1); legacy-alias
   adjudication paragraph (BLOCKER 2); store enumeration += `:416/:14442`, `:4292`.
5. Decision 8: layer-unconditional sentence (BLOCKER 3).
6. Non-goals: board.report spill promotion and alias collapse as operator-visible follow-ups.
7. Acceptance A: catalog += the two lanes with live citations; Acceptance C: the wave-member
   row drives the real admission, byte-measured (BLOCKER 4).
8. Re-anchored citations per the map above.

## Deliberately NOT folded (blue-team non-blocking strengthenings, unchanged)

U1 replay-neutrality (negative law, no oracle), U2 CLI doctor print cascade (no exported
seam), U3 spill-failure coaching refusal, U4 message-view/CLI transparent spill resolution;
the two borderline exemption dispositions (`cartographer-quartermaster.mjs:36`,
`MAX_SCRATCHPAD_WRITE_REQUEST_BYTES` 16,384) and the mislabeled
`coordination-store.mjs:2919` exemption reason; naming the `spill.minted` event kind in the
contract. These were strengthenings, not blockers; the wave may pick them up.
