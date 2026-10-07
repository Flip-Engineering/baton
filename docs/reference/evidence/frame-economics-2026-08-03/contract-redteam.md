# Frame-economics contract red team — issue #89 (contract v1.0)

Status: **NOT FOLD-READY — 11 blockers.** Every blocker has a named fix; none requires
reopening the settled design position (scanners shape-only, admission-side coaching
refusals, spill-digest-citation degradation, scan windows as substrate guards). The
position survives; the contract's *specification of it* does not — yet.

## Scope and method

Read-only, contract-level review of
`docs/reference/evidence/frame-economics-2026-08-03/frame-economics-contract.md` (426 lines,
9 decisions, 12 ground-truth blocks, acceptance pins A–F, open questions 1–5). Every
file:line citation was re-verified in this worktree with `grep -an` / targeted `sed -n`
reads (`application.mjs` and `coordination-store.mjs` carry NUL bytes — 2 and 3
respectively; `coordinator.mjs` currently has none). The full consumer graph of the
messages.mjs factories was traced tree-wide; the admission, replay, scanner, store, and
doctor/handshake seams were read at their current line numbers.

Verdicts:

- **HOLE** — the decision as written lets an implementer ship behavior that violates the
  settled position, or pins a claim that is false in the tree. A fix is named in every case.
- **SOUND** — the decision rejects the attack assuming the named seams are implemented as
  written. Amendments may still be attached where they harden, not rescue, the decision.

## Tree-state notice (load-bearing for the whole review)

The contract's anchor pass ("checked in this worktree … on 2026-08-03") predates two
same-day landings:

- `a9f6598` (#92 — delivered frame carries the messageId): shifted `coordinator.mjs`
  anchors above the message lane by ~+9–16 lines.
- `9ec8e97` (#78 board worker-half): added the `BOARD_CLAIM` / `BOARD_REPORT` wire
  grammars and scanners (`impl/src/claude-session.mjs:35-38, 161-216`), the
  `board.claim` / `board.report` admission cases (`impl/src/coordinator.mjs:11777-11798`),
  and store machinery — shifting `claude-session.mjs` anchors below line 34 by up to +62
  and `coordinator.mjs` anchors below line ~11776 by ~+204.

Consequences: (1) most `coordinator.mjs` / `claude-session.mjs` / `application.mjs` /
`coordination-store.mjs` citations in the contract are stale (audit below); (2) the
contract's scanner model is factually out of date — it says "all four grammars" in a tree
that has six (blocker 2).

## Per-decision verdicts

| # | Decision | Verdict | One-line reason |
| --- | --- | --- | --- |
| 1 | `limits.mjs` module, not a store section | **HOLE** | Direction is right (dependency argument verified), but the named consumer set omits `coordination-store.mjs`, which hardcodes two cataloged-lane literals and silently floors the one deployment override the rationale celebrates (blocker 6). |
| 2 | Row schema, byte law, three classes | **HOLE** | The byte law itself is clean (tree-wide sweep found no un-named siblings), but the schema's `bound` vs `value` fields are never individually defined, and the catalog has factual gaps (blockers 7, 8). |
| 3 | Coaching refusal `{cap, actual, unit, gracefulPath}` | **SOUND** (one hardening pin) | `actual` is a scalar byte count returned to the payload's own author — self-disclosure, not a leak; no bucketing needed. Pin that refusals carry numbers, never body content. |
| 4 | Spillover: new store section, messages + objectives first | **HOLE** | Three gaps: no spill size ceiling (durable-log DoS from orchestrator-direct lanes), worker-bound delivery semantics unspecified, and the citation fields quietly amend BD3-C's closed reply envelope (blockers 3, 4, 11). The machinery choice itself (context-pack shape minus chaining/expiry/cap; store over artifacts/worktree) is verified accurate. |
| 5 | Scanner posture pin, all grammars | **HOLE** | Written for a four-grammar tree; #78 added two more scanners, one of which lacks the shape-only law sentence, and Acceptance A/D catalog four windows where six exist (blocker 2). The decision-question split itself is sound (AS-5). |
| 6 | Reply-lane 2,048 parity + spill | **SOUND** (contingent on Decision-4 fixes) | Admission-side parity with typed refusal + spill is the settled position implemented correctly, not a silent cap reintroduced (AS-5). |
| 7 | Doctor surfacing + handshake | **HOLE** | The digest's input is never pinned as declared-rows-only; if effective (override-adjusted) values feed it, a deployment override of `decision.need`/`rationale` breaks the CLI handshake between identical code (blocker 5). Mechanism otherwise verified present (AS-2). |
| 8 | Consolidation, not re-shaping, substrate/view | **SOUND** (widened scope) | True for every substrate/view lane checked — but "no module re-declares a byte literal" reaches further than the contract names: the store's literals and a duplicate exported constant come along (blockers 6, 7). |
| 9 | Refusal text composed by one helper | **SOUND** (one amendment) | A single composer is the right shape, but Acceptance B as written makes the helper self-certifying — nothing pins the text or the values against silent change (blocker 10). |

## Findings by attack surface

### AS-1 — Citations (probes every `file:line` claim)

Systemic drift plus three wrong-at-writing citations. Full audit in its own section below;
verdict: the fold needs a complete re-anchor pass, and pins should cite symbols/values
(Acceptance F already does — good), not lines. **Blocker 1.**

### AS-2 — The registry: frozen yet doctor-reportable; digest churn; dependency direction

- **Frozen + doctor-reportable: no conflict.** `doctorReadiness()`
  (`impl/src/application.mjs:12001-12009`) already returns a `deepFreeze`d projection
  derived from live state; projecting a frozen module is the same move. SOUND.
- **Dependency direction holds for the named consumers — but the set is incomplete.**
  `claude-session.mjs:17` importing `messages.mjs` is the verified precedent (GT12 ✓), and
  a pure data module keeps the wire layer store-free. `coordinator.mjs`, `application.mjs`,
  `wave-driver.mjs`, `application-cli.mjs` all import pure modules today. The hole:
  `coordination-store.mjs` is never named a consumer, yet it hardcodes literals for
  cataloged lanes — `boundedText(p.need, 2_048)` / `boundedText(p.rationale, 8_192)` at
  `coordination-store.mjs:3453` (byte-based ✓) and `MAX_SCRATCHPAD_ENTRY_BYTES = 8_192` at
  `:466` (enforced `:631-633`). Acceptance F's grep over `impl/src/` trips on these the day
  it lands; the store MUST become a registry consumer, and the contract never scopes that
  work. Worse, the store's `2_048`/`8_192` are a **hidden floor** under Decision 1(d)'s
  deployment-injected `_reuseDecisionPolicy.maxNeedBytes/maxRationaleBytes`
  (`coordinator.mjs:937-946`): a deployment setting `maxNeedBytes: 4096` is silently
  refused by the store at 2,049 — the "deployment override" is fiction above the store's
  hardcoded ceiling, and neither Decision 1(d) nor Open question 4 knows it. **Blocker 6**
  (and the honest answer to OQ4: the ceiling-of-ceilings already exists — move it into the
  registry and name it).
- **Digest churn: the failure mode is real but avoidable — and currently unspecified.**
  The CLI handshake refuses connection on registry-digest mismatch
  (`application-cli.mjs:1963-1977`, `cli_connection_incompatible`); the semantic-registry
  digest it checks is a static CLI-side import compared against the server's published
  value. Decision 7 says the doctor projection carries *effective* values where overrides
  exist AND that `card()` publishes `limitsRegistryDigest` verified the same way. If the
  digest is computed over anything containing effective values, a deployment that overrides
  `decision.need` changes its server-side digest and every CLI handshake fails despite
  identical code. The contract never says the digest covers **declared rows only**.
  Fix: one sentence — `FRAME_LIMITS_DIGEST` is derived from the declared registry, never
  from effective values — plus an Acceptance-E pin that injecting a
  `reuseDecisionPolicy` override leaves the published digest unchanged. **Blocker 5.**

### AS-3 — The spillover section: what invariant is left unguarded

Decision 4 takes the context-pack machinery (verified present: `mintContextPack`
`coordination-store.mjs:13035`, `contextPackHead` `:13052`, `materializeContextPack`
`:13058`, `reapExpiredContextPacks` `:13067`, digest-addressed ids `:13025`, body cap
`MAX_CONTEXT_PACK_BODY_BYTES = 8_192` `:469` enforced `:13011`) and strips family-head
chaining, expiry, and the 8,192 cap. What that leaves unguarded:

- **No size ceiling at all.** Worker-origin bodies are de-facto bounded by the scanner
  windows (20,480). Orchestrator-origin lanes are not: `sendMessage` is called directly by
  the orchestrator (no wire frame), and run objectives arrive over MCP/CLI (no
  claude-session transport bound). Today the 2,048/4,096 hard caps incidentally bound
  those lanes; post-Decision-4, oversize is *admitted* — a 100 MB objective or send body
  becomes a spill artifact **in the durable event log**, persisted forever and replayed at
  every open. "Spill must out-cap the inline lane" argues for removing 8,192, not for
  removing every bound. Fix: declare a substrate-class `spill.body` ceiling in the
  registry (align with `wire.frame` 1 MiB or name a value), with oversize-beyond-ceiling
  drawing the hard coaching refusal Decision 3 already reserves for spill-failure; add an
  Acceptance-C row. **Blocker 3.**
- **Reaping (Open question 1): conditionally deferrable.** With the ceiling, per-spill
  bytes are bounded and durable-log growth is the same asymptotic class as today's
  full-body `message.delivered` payloads — OQ1 is safely deferred. **Without** the
  ceiling, OQ1 is fold-blocking: shipping an unbounded, never-reaped durable section is
  minting garbage by design. The reaping design itself (run-terminal `reapRunSpills`
  sibling of `reapRunScratchpads`, or settlement reference-counting) is a legitimate
  follow-up either way.
- **Worker-bound semantics: unspecified, and both readings are shippable.** Decision 4's
  transparent-resolution readers ("message views, run views, and CLI/MCP projections")
  are all orchestrator-side. For an oversize orchestrator→worker send, the implementer
  must choose: (a) the provider-bound frame carries the full materialized body — the
  2,048 cap then does nothing for the worker's frame budget, the epic's namesake
  economics silently void; or (b) the frame carries head + citation — the worker receives
  a truncated message with **no resolution lane**: `materializeSpill` is store-side, the
  read port has no spill kind, and the worker cannot fetch the body. Acceptance C greens
  under either. Fix: name the worker-frame semantics; if head+citation, add a worker-side
  resolution path (a read-port kind or an explicit ask-for-more convention) and pin the
  delivered frame's content in C/D. **Blocker 4.**
- **Positive:** digest-addressing makes mint idempotency fall out of content addressing;
  the `_byKey` event-log pattern exists (`coordination-store.mjs:13035-13050`). The
  artifact-home rationale (task-terminal `registerArtifact` gates, commit-bound worktree
  capture) was spot-checked and is accurate.

### AS-4 — The coaching refusal shape: can `actual` leak?

`actual` is a scalar byte count surfaced to the entity that authored the payload (the
worker's own durable stream for `message.rejected`; the driver/operator for application
lanes). Self-disclosure is not a leak; a byte count of your own objective is not a side
channel. The credential-file example is already handled correctly in-tree:
`credentialError(providerLabel, 'credential_file_size')` (`claude-session.mjs:315, 329`)
surfaces to the operator who owns the file. No bucketing needed. **One hardening pin
(blocker-adjacent, folded into Decision 3):** refusal payloads and texts must carry
numbers only, never body content — an implementer "helpfully" quoting a head snippet
would put worker prose into `authority.rejected` driver-visible records and doctor
surfaces. Today's refusal machinery is clean on this (the `errors` lists are factory
strings, no content), and the contract's example texts name numbers only — make it a
pin, not an accident. Decision 3: SOUND with that pin.

### AS-5 — Reply-lane parity and the decision-question split

- **2,048 parity + spill implements the settled position, it does not contradict it.**
  The cap lives at admission (`coordinator.mjs:11815-11817` is shape-only today), the
  refusal is typed and lands on the worker's durable stream via the existing
  `refuse(reason, extra)` spread seam (`:11809-11814` — the exact seam Decision 3 needs ✓),
  and oversize degrades to spill rather than refusing. "No silent caps" is about the wire;
  this is not the wire. SOUND.
- **The split does not re-open the wire-refusal hole — provided both halves move.** Today
  `scanForDecisionRequest` calls `createDecisionRequest` and swallows `ValidationError` to
  `null` (`claude-session.mjs:86-91`); the admission seam re-calls the same factory and
  converts `ValidationError` to `control.malformed_interaction_rejected` +
  `authority.rejected {reason:'malformed_request'}` (`coordinator.mjs:11948-11963`).
  After the split the scanner needs a shape-only validator (so an oversize question
  PARSES and travels) and the seam needs the registry bound inserted around its factory
  call — the contract says exactly this, and the seam machinery exists. Pin D covers it;
  strengthen it to assert the seam refusal carries the **coaching payload** (cap, actual),
  not merely `malformed_request` with strings. `createDecisionRequest` has exactly two
  callers tree-wide (scanner + seam), so no third path loses its size gate.
- **Replay neutrality holds structurally — keep it that way.** The replay/reconstruction
  switch (`coordinator.mjs:13103` region) rebuilds pending-interaction state from durable
  events and never re-validates sizes. Registry bounds therefore apply at LIVE admission
  only; a future retune cannot fork replay. Say this once in the fold so nobody adds a
  size check to the replay path.
- **Residual silence band (acknowledge, by design):** a question over the 8,192 scan
  window is still scanner-`null` (prose). That is position 4 owned honestly — one
  sentence in the fold prevents a future bug report.
- **NEW — the four-grammar assumption is stale (blocker 2).** #78 landed
  `BOARD_CLAIM` / `BOARD_REPORT` grammars (`claude-session.mjs:35-38`, both 20,480-byte
  windows) with scanners at `:169` / `:195`. Decision 5's "all four grammars", its
  doc-comment extension list, Acceptance A's "the four scanner windows 8,192/20,480", and
  Acceptance D's "one row per grammar" all omit them. `scanForBoardClaim`'s doc comment
  already carries a shape-only sentence (`:167`); `scanForBoardReport`'s (`:191-194`)
  does **not**. Both scanners are inline shape-only (no factory, no `ValidationError`
  swallow ✓ — no new silent-cap leak of the ground-truth-5 class). Fix: extend the
  posture law to the two new doc comments, add `scanner.window.board_claim` /
  `scanner.window.board_report` substrate rows, and add one large-but-parseable admitted
  shape-only suite row per new grammar.

### AS-6 — The byte law: surviving char-length checks

Tree-wide sweep of `coordinator.mjs` / `application.mjs` / `messages.mjs` /
`wave-driver.mjs` / `coordination-store.mjs`: the only char-based check on a cataloged
text lane is the named wave-member one (`member.objective.length > 4096`,
`application.mjs:1854-1855` ✓ the contract names it). The remaining `.length > N` hits
are identity lanes (`actor.length > 256`) and array counts — out of catalog. The id-class
regexes (`SAFE_OPTION_ID` `{1,128}` etc.) count UTF-16 code units, not bytes; they are
not cataloged lanes, so the byte law does not reach them — but the fold should state the
law's scope ("every cataloged *text* lane") so nobody "fixes" or, worse, newly relies on
char semantics elsewhere. Note the orientation-note shrink loop
(`coordinator.mjs:8455-8460`) pops *characters* off `observed` while testing
`Buffer.byteLength(note) > 2_048` — terminates correctly (byte test), merely sloppy; not
a byte-law violation. Decision 2's byte law: SOUND.

### AS-7 — Acceptance pins: shallow-implementation audit

- **A (registry pins).** Alone, greenable with the registry exported but enforcement
  unwired — acceptable only because B/C/F interlock with it. Digest "byte-stable across
  processes" is achievable (`canonicalDigest` sorts keys, `coordinator.mjs:311`).
  Catalog content needs blockers 2, 6, 7, 8.
- **B (refusal coaching).** **Tautological as written (blocker 10).** "Exact-text pins
  composed by the Decision-9 helper" means test and implementation both derive from the
  registry: any value change, and any helper-wording change, greens both sides. The
  suite then cannot do the one job the Non-goals demand of it — make retuning a
  *deliberate* act — and the helper's text is pinned by nothing (the single-point-of-drift
  the probe asks about). Fix: at least one **hardcoded golden string** per refusal class
  (changing a value or the wording forces an intentional test edit), helper-composed
  pins for the rest, and extend F's grep to hand-typed byte prose (`<=\d+ bytes`,
  `limit \d+`) outside `limits.mjs`.
- **C (spill round-trip).** Strong: byte-identical materialize, UTF-8-scalar head,
  idempotent re-drive, reply parity. Add the ceiling row (blocker 3) and the
  worker-frame content row (blocker 4).
- **D (scanner posture).** Needs the six-grammar extension (blocker 2); strengthen the
  split row to assert the coaching payload shape at the seam (AS-5).
- **E (doctor).** Add the digest-stability-under-override pin (blocker 5). Trivial doc
  fix: the CLI depth is a `--depth` *flag* (`application-cli.mjs:1253-1259`), not a
  positional `[depth]` as the contract writes.
- **F (single-source).** **Spelling-gameable:** a re-declared `2048` (no underscore),
  `0x800`, or `2 * 1024` dodges a `2_048` grep. Fix: scan for the registry's *value set*
  across spellings outside `limits.mjs` (and its deliberate substrate/view re-exports),
  and decide the store-literal story (blocker 6) before this pin can pass honestly.

### AS-8 — Open questions: fold-blocking or safely deferred

1. **Spill lifecycle** — *conditionally deferrable*: safe once the spill ceiling exists
   (blocker 3); blocking without it. The reaping mechanism itself is a legitimate
   follow-up (durable-log asymptotics are unchanged from today's full-body message
   payloads).
2. **`boundedAttentionText` drops the truncated flag** — *fix here*. Verified:
   `messages.mjs:438` returns `capBytes(...).text`, discarding `truncated`, inside the
   BD3-A rows (`coordinator.mjs:10407-10414`; the contract's `:10365-10372` cite is
   drifted and was already short of the knowledge-row call at writing); the marker
   precedent exists at
   `messages.mjs:463-466` (`[briefing truncated]`). Same sin class as the epic, one
   marker + one row. Not fold-blocking, but folding it in is nearly free; note the
   sibling prior art `board_oversize_item` (`coordination-store.mjs:14808-14813`) for
   typed truncation markers.
3. **`decision.question` graceful or hard** — *safely deferred*. The declared hard
   default with coaching refusal is coherent for an interactive lane (the orchestrator
   must read the question to answer); promoting later is additive.
4. **Ceiling-of-ceilings for deployment overrides** — *deferrable only after blocker 6*.
   The hidden store floor (`coordination-store.mjs:3453`) already IS the
   ceiling-of-ceilings; the honest v1 move is naming it in the registry. The
   provider-read precedent the contract cites is real (deployment ceilings capped by
   hard ceilings, `coordinator.mjs:884` — `maxBytes > 16 * 1024 * 1024` — though the
   cited `:873-875` actually names the providerSchedule sibling block).
5. **Wave-driver precheck retention** — **NOT open; forced (blocker 9).** Acceptance A
   declares `wave.member.objective` `graceful: spill`, but the retained precheck
   (`wave-driver.mjs:305-312`) *refuses* oversize at 4,096 before the machinery ever
   sees it — a wall in front of a spill lane, recreating for wave members the exact
   asymmetry the epic deletes elsewhere, while direct `run.start` spills. The fold must
   resolve it: delete the precheck or downgrade it to a spill-aware advisory reading the
   same registry row, and pin an oversize-wave-member spill row.

### AS-9 — The one composer helper

Single composer in `limits.mjs` is right (registry row → text, one move updates
refusals + doctor + tests). What pins the TEXT: nothing, as written (AS-7/B). The
golden-string amendment fixes it. Also note the example refusal text in Decision 3
("over-cap bodies spill to a durable artifact — resend with a digest-citable head")
describes the *graceful* path; for hard lanes the helper needs a distinct
`gracefulPath` phrasing, and for graceful lanes the refusal text is dead code (oversize
admits) except on spill-failure — the helper's contract should state which lanes can
ever emit it. Minor, fold into Decision 9's amendment.

### AS-10 — (beyond the brief) The closed reply envelope

Decision 4 puts citation fields `{spilled, bytes, digest, spill}` on the receipt record
and inline on the lane. The BD3-C v2.0 contract pins the reply envelope as CLOSED
`{messageId, inReplyTo, from, body}` (C1b asserts smuggled fields never reach the
receipt). The two contracts now contradict: frame-economics amends the envelope without
saying so. Fix: the fold explicitly amends BD3-C's closed shape to
`{messageId, inReplyTo, from, body, spilled?, bytes?, digest?, spill?}` (citation keys
present only when spilled) and adds a pin that ONLY those keys are added. **Blocker 11.**

### AS-11 — (beyond the brief) Dead factories presented as live bounds

`createBoardReport` and `createBoardItem` are used **nowhere** tree-wide except inside
`messages.mjs` itself (verified: no importer in `impl/src`). The live board-report lane
is: scanner shape-only (`claude-session.mjs:195-216`) → admission
(`coordinator.mjs:11789-11797`) → store shape-only body check
(`coordination-store.mjs:14385-14387`) — the ONLY live body bound is the 20,480 scanner
window. So Acceptance A's `board.report.body` "(values as in `messages.mjs:318-319,
362`)" catalogs a dead factory's 4,096 as if it were the lane's existing bound:
enforcing it is a NEW restriction (today ~20 KB reports are admitted), smuggled in as
"consolidation" — the same move the epic exists to eliminate, and a quiet violation of
Decision 8's "no lane changes VALUE or behavior" and the retuning Non-goal. Same class
for `board.title` / `board.detail` (dead factories; board posts are hub-side so the
stakes are lower, but the catalog must not present the values as live). Fix: decide
honestly per lane — either declare `board.report.body` a NEW bound (operator-visible
decision, pinned as a behavior change, with coaching refusal) or declare the lane
substrate-bounded in v1. **Blocker 8.**

## Citation audit

Verified exact (current tree): GT1 doc comment region; GT4 in full (grammar constants
`:27-34` pre-#78 numbering — the four-grammar claims were true when written);
`claude-session.mjs:17, 19`; all `messages.mjs` anchors (`:197, 202-204, 213-214,
234-235, 278, 318-319, 362, 419-430, 432-438, 446-465, 500, 525-526`);
`application-client.mjs:113`; `application-cli.mjs:1253-1259, 1965-1975`;
`wave-driver.mjs:27, 304-311`; `application.mjs:39-74` constants, `:305-306, 339-341,
289-290`; docs/37-wave-driver.md:90-96 (content verified); GT12.

Drifted by the two landings (claim re-verified TRUE at the new location; line stale):

| Contract cites | Now at | Drift |
| --- | --- | --- |
| `coordinator.mjs:302` canonicalDigest | `:311` | +9 |
| `coordinator.mjs:6582-6583` send TypeError | `:6597-6598` | +15 |
| `coordinator.mjs:6866` orientation note | `:6883` | +17 |
| `coordinator.mjs:8435-8440` shrink loop | `:8455-8460` | +20 |
| `coordinator.mjs:507-508` normalizedDecisionText | `:516-517` | +9 |
| `coordinator.mjs:514-518` art:sha256 convention | `:522-526` | +8 |
| `coordinator.mjs:4583, 4593` inspectCapturedFile | `:4598, 4608` | +15 |
| `coordinator.mjs:10101, 10113` serveKnowledge | `:10116, 10121` | +8/+15 |
| `coordinator.mjs:11604-11647` reply admission seam | `:11809-11851` | +204 |
| `coordinator.mjs:11742-11757` decision refusal seam | `:11948-11963` | +206 |
| `coordinator.mjs:10231-10235, 10349-10384` doctrine/renderer | ~`:10240+, :10391+` | +16..42 |
| `application.mjs:529-530, 572-573, 691` shed loops | `:552, 595, ~714` | +23 |
| `application.mjs:11931-11948, 12029` doctor/card/MCP | `:12001, 12011-12018, 12094-12099` | +65..+70 |
| `claude-session.mjs:188, 253, 267` credential | `:250, 315, 329` | +62 |
| `claude-session.mjs:402-403` wire config | `:464` | +62 |
| `coordination-store.mjs:442` pack body cap const | `:469` | +27 |
| `coordination-store.mjs:12921-12989` pack machinery | `:13011-13067` | ~+85 |

Wrong at writing time (not drift):

- GT3 "citation at `coordinator.mjs:10376-10379`" — the digest-citation line was at
  `:10381` even before the drift; the cited range covers `const truncated` / `frame,` /
  `kind,`. Likewise "share the SAME rendered object (`:10349-10352`)" — the sentence
  spans `:10352-10353`.
- C0b ranges: the row spans `impl/test/bidirectional-v3-red.test.mjs:434-455` (contract:
  `:434-458`); the PIN comment is `:447-451` (contract: `:450-455`); Acceptance D's
  "`bidirectional-v3-red.test.mjs:456-458`" points at a blank line and C1's first two
  lines; "beside C0/C0b (`:414-458`)" overshoots by 3.
- GT6's application anchors were already stale when written: the objective check and
  throw are `application.mjs:1403 / 1406` (contract: `:1380 / :1383`) and the wave-member
  char check is `:1854-1855` (contract: `:1831-1832`) — the 93B waveStart block predates
  the anchor pass. (The contract's own neighbors got it right — `validText` `:289-290` ✓ —
  and note the wave driver's comment at `wave-driver.mjs:306-307` and
  docs/37-wave-driver.md:90-94 carry yet another, older set of stale anchors —
  `application.mjs:1094-1096`, `application-client.mjs:112`, `:225-226`. Cite symbols,
  not lines.)

**Blocker 1** = full re-anchor at fold; pins cite symbols/values.

## Blockers (numbered, each with its fix)

1. **Citation re-anchor.** Re-verify every anchor at fold time; prefer symbol citations
   in pins. Fix the three wrong-at-writing classes (GT3 citation ranges, C0b ranges, GT6
   application anchors).
2. **Six-grammar scanner world.** Extend Decision 5's posture law and doc comments to
   `BOARD_CLAIM` / `BOARD_REPORT`; add `scanner.window.board_claim` /
   `scanner.window.board_report` (20,480) substrate rows to the registry and Acceptance
   A; add one large-but-parseable admitted-shape-only suite row per new grammar in D.
3. **Spill ceiling.** Declare a substrate-class `spill.body` ceiling in the registry
   (recommend aligning with `wire.frame` 1 MiB); oversize beyond it draws the hard
   coaching refusal; Acceptance-C row. This also unblocks OQ1.
4. **Worker-bound spilled-send semantics.** Name what the provider-bound frame carries
   for a spilled send; if head+citation, add a worker-side resolution lane and pin the
   delivered frame's content in C/D. Without this, C greens under both a cap-voiding and
   a data-stranding implementation.
5. **Digest input.** One sentence: `FRAME_LIMITS_DIGEST` covers DECLARED rows only,
   never effective values; Acceptance-E pin that a `reuseDecisionPolicy` override leaves
   the published digest unchanged.
6. **The store is a registry consumer; the hidden reuse floor.** Name
   `coordination-store.mjs` a consumer in Decision 1; move the `:3453` `2_048`/`8_192`
   reuse literals into the registry as the declared `decision.need` /
   `decision.rationale` defaults AND the ceiling-of-ceilings (this resolves OQ4
   honestly); define override semantics (deployment value validated against the registry
   row; effective = min(deployment, ceiling) or refuse-at-injection — pick one and pin
   it).
7. **Catalog completeness.** Add `scratchpad.entry.body` (8,192,
   `coordination-store.mjs:466, 631-633` — worker wire lane, typed but numberless
   refusal today; gains the Decision-3 coaching shape), the view-class stragglers
   (`MAX_SCRATCHPAD_VIEW_ITEMS` 64 / `MAX_SCRATCHPAD_VIEW_CACHE_KEYS` 256,
   `application.mjs:67-68`; `MAX_BOARD_ITEMS`, referenced `:63`), and subsume the
   duplicated `MAX_ATTENTION_TEXT_BYTES` (`application.mjs:53` + `messages.mjs:408`).
   Define the row schema's `bound` vs `value` fields or drop one.
8. **Dead-factory catalog rows.** `board.report.body` (and `board.title` /
   `board.detail`) must not catalog `messages.mjs` values as live bounds: either declare
   them NEW bounds (operator-visible, pinned as behavior change) or substrate-bounded in
   v1.
9. **Resolve OQ5 in the fold.** The wave-driver precheck cannot keep refusing what
   Decision 4 spills; delete it or make it a spill-aware advisory on the same registry
   row, and pin an oversize-wave-member spill row.
10. **De-tautologize B; pin the helper's text.** Hardcoded golden refusal strings (one
    per class) so value/wording changes are deliberate test edits; F greps for
    hand-typed byte prose across spellings; F scans the registry's value set, not the
    literal strings `2_048`/`4_096`.
11. **Envelope co-amendment.** Amend BD3-C v2.0's closed reply envelope to name the
    optional citation keys; pin that no other keys appear (keeps C1b's smuggled-fields
    guarantee intact).

## What held up

The settled position is implementable as intended: the `refuse(reason, extra)` spread
seam exists exactly where Decision 3 needs it; the decision-lane refusal machinery
(`control.malformed_interaction_rejected` + `authority.rejected`) is real and carries an
extensible payload; the context-pack machinery matches the contract's description
function-for-function; the doctor/handshake digest machinery is present and the CLI
refuses mismatches; the byte-law sweep found no un-named char-length siblings; the
replay path never re-validates sizes (registry retunes cannot fork replay); the `actual`
field is self-disclosure, not a leak. The contract's *design* is right. Its *map of the
tree* is one landing behind, its spill lane is missing a ceiling and a delivery
semantics, and its acceptance pins certify themselves in two places. Fix the eleven
blockers and it folds.
