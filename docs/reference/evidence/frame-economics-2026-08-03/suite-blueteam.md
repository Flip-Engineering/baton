# Blue-team: frame-economics red suite (#89) — adversarial verification

(Target: `impl/test/frame-economics-red.test.mjs` — 47 rows: A ×6, B ×14, C ×9, D ×8
(incl. 5 pins), E ×6, F ×3 (incl. 2 pins), G ×1. Verified against the v1.1 post-fold
contract `docs/reference/evidence/frame-economics-2026-08-03/frame-economics-contract.md`
(+ `contract-fold.md`) and `impl/src/` ground truth at HEAD `ab678aa` (NUL-containing
files — coordinator.mjs, coordination-store.mjs, application.mjs — inspected via
`grep -an`/`sed -n` only), 2026-08-04. Suite run from repo root:
`node --test impl/test/frame-economics-red.test.mjs`, node v25.8.0.)

Verdict scale: **SOUND** = red for the named stage today, green only on a contract-correct
implementation, and a wrong implementation cannot pass it. **WEAK** = correctly staged and
discriminating in composition, but a named wrong implementation can pass it (false-green
hole). **VACUOUS** = passes without exercising the named behavior. **STAGED-WRONG** = the
row's red/green state does not track the named contract behavior.

## 0. Run record (exact counts)

```
ℹ tests 47
ℹ pass 7
ℹ fail 40
```

Passing (the 7 pins): D2, D3, D4, D5, D6, F2, F3 — exactly the 7 the header declares
(`impl/test/frame-economics-red.test.mjs:117-126`). Failing: the other 40. **The measured
40 red / 7 green split matches the declared split exactly — no divergent test,
reconciliation trivial.** Every red row fails AT its named stage or, where its behavior
sits downstream of another missing capability, at the first missing capability in its own
dependency chain (disclosed in the header for E; the same pattern covers C4/C5). No row
fails on a fixture bug, and none fails later than its named behavior:

| Stage named by the row | Rows | Observed failure |
|---|---|---|
| `registry-missing` (impl/src/limits.mjs absent) | A1, A2, A3, A4, A5, A6, E1, E2, E3, E5, E6 (11) | `ERR_MODULE_NOT_FOUND` on the dynamic import — the browser-use:96-99 precedent; E rows import first BY DESIGN (header :151-154), so their headline stages are reached only once the registry exists |
| `refusal-coaching-missing` | B1, B2, B3, B5, B6, B7, B8, B9, B10, B14 | typed seam refuses today with no `{cap, actual, unit, gracefulPath}` — B1: bare TypeError at coordinator.mjs:6634 (verified); B2: reply lane unbounded, 1 MiB admitted in full (ground truth 2 observed live); B3: `application_intent_invalid` no number (application.mjs:1406 verified); B5/B6: numberless `invalid_reuse_decision` (coordination-store.mjs:3485 verified); B7: bare TypeError (:6922 verified); B9/B10: numberless `invalid_board_title`/`_detail` (:14270-14272 verified); B14: numberless `scratchpad_entry_invalid` (:649-651 verified) |
| same stage, no literal `stage:` prefix | B4, B11, B12, B13 | `ValidationError` IS thrown today (first assert passes) but carries no coaching payload — fails at "the refusal payload carries the cap"; the named behavior exactly |
| `spill-lane-missing` | C1, C2 | `typeof store.mintSpill !== 'function'` |
| `spill-lane-missing` (one chain-stage before the headline frame/query stages) | C3, C4, C5 | the over-cap send is REFUSED outright with the live `message body is required (non-empty, <=2048 bytes)` — C4's frame-content and C5's `spill-query-kind-missing` stages sit behind admission by construction; honest dependency-chain staging |
| spill parity (reply) | C6 | the oversize reply IS admitted full-body today (ground truth 2 confirmed live), then fails at "the reply is marked spilled" — the envelope carries no citation keys |
| `spill-lane-missing` (objective) | C7 | `application_intent_invalid` with no number, the worker-AX receipt verbatim |
| `wave-driver-advisory-missing` | C8 | `createWaveDriver` throws on the unknown `onAdvisory` policy field — verified: `POLICY_FIELDS` gate at wave-driver.mjs:57/:79-81 throws `wave_driver_policy_invalid`; the 4,096 precheck wall verified at :321-329 |
| spill ceiling | C9 | beyond-ceiling send throws today (2,048 TypeError, first assert passes), then fails at "the beyond-ceiling refusal is typed" — no code, no payload |
| `scanner-split-missing` | D1 | `scanForDecisionRequest` returns `null` for the in-window oversize question — the `ValidationError` swallow verified at claude-session.mjs:87-92 |
| `scanner-law-sentence-missing` | D7 | fails first on `scanForDecisionRequest` (:69-74 lacks the sentence, verified); `scanForBoardClaim` (:160-168) and `scanForBoardReport` (:190-194) would also fail the `/resource guard/` + `/admission/` pair (verified); only `scanForMessageSend` carries it (:136-143, verified) |
| `refusal-coaching-missing` (split seam half) | D8 | the seam DOES reject today (`control.malformed_interaction_rejected` + `authority.rejected {reason:'malformed_request'}` at coordinator.mjs:12317-12329, verified reachable by the fixture) but the payload has no `cap` |
| `override-validation-missing` | E4 | `maxNeedBytes: 4096` / `maxRationaleBytes: 9000` ACCEPTED at injection today (independently smoke-verified, §0.2) |
| `handshake-digest-missing` | E5 | gated behind registry-missing today; positive arm smoke-verified (§0.2) |
| `single-source-not-landed` | F1 | exactly **46 unconsolidated hits** (counted in the failure diff) — see §3, teeth item 8 |
| `truncation-marker-missing` | G1 | positive control green (the finding read answers `ok:true` and IS capped at the attention ceiling) — fails only on the absent `[truncated]` marker; `boundedAttentionText` dropping `truncated` verified at messages.mjs:449-455 (`return capBytes(redacted, maxBytes).text;` :454) |

## 0.1 Hermeticity

**Fully hermetic.** Coordinator rows use `ScriptableAdapter` + fake worktrees over
`mkdtempSync` logs; store rows are pure `CoordinationStore` in tmpdirs; application rows
git-init tmp repos (`execFileSync git`, local); the supply-chain oracle's fetch is
`async () => { throw new Error('no network in tests') }`; E5's handshake uses an injected
`fetchImpl` against no socket; A5's cross-process digest check execs a child `node` on the
local tree; all tmpdirs cleaned via `test.after`. No network, no browser, no writes
outside `os.tmpdir()`.

## 0.2 Independent smoke verification (drafter flag 5)

- **E5 positive arm — VERIFIED.** Replicating the suite's connection fixture + injected
  fetch with a card carrying `agentExperience.limitsRegistryDigest: 'a'.repeat(64)`:
  `connectBaton` **connects today** (the unknown card field is ignored — exactly why the
  mismatch arm is red). The fixture is sound; only the digest check is missing.
- **E3 positive arm — VERIFIED.** Replicating `appFixture` with
  `reuseDecisionPolicy {maxNeedBytes: 1024, maxRationaleBytes: 4096}` and the full
  Quartermaster wiring: `createDriver` **accepts the injection** (no above/below
  validation exists — E4's red premise independently confirmed), `BatonApplication`
  constructs, `doctorReadiness()` returns today's four keys `{schemaVersion, repoId,
  routes, workspace}`, `card().agentExperience` carries no limits digest.

## 1. Coverage map (contract clause → enforcing test)

### Decision 1 — the declared module
- `limits.mjs`, one deep-frozen `FRAME_LIMITS` + `FRAME_LIMITS_VERSION` +
  `FRAME_LIMITS_DIGEST` → **A1, A5** (cross-process byte stability via child process)
- Consumers import (coordinator / application / wave-driver / **store**) → **F1** +
  behaviorally **B5, B6, B9, B10, B14** (store seams), **B1/B7/B8** (coordinator),
  **B3/C7** (application), **C8** (driver)
- Refuse-at-injection above the ceiling-of-ceilings, never silent `min()` → **E4**

### Decision 2 — row schema, byte law, three classes
- Admission rows with `{lane, class, value, unit, graceful, enforcedAt, refusalCode}` →
  **A2** (all 15 catalog lanes, exact values)
- Substrate rows, only `spill.body` mints a refusal → **A3**
- View rows `shed-flagged`, verified values → **A4**
- `board.report.body` substrate-bounded, no admission row → **A6** — **CONTESTED, see
  BLOCKER 1**: the premise is wrong about this tree
- Store literal enumeration / named deliberate locals → **B5, B6, B9, B10, B14** +
  **F2, F3** pins + **F1** exemption classes
- **The byte law per se (`Buffer.byteLength`, never `.length`)** — partially oracle'd:
  C1's multi-byte body pins `spill.bytes === Buffer.byteLength(body)`; C3/C4 pin the
  UTF-8-scalar head boundary. **The wave-member char-check fix (application.mjs:1854-1855)
  has NO oracle — C8's fake-baton fixture bypasses it entirely (BLOCKER 4).**

### Decision 3 — coaching refusal shape
- Payload `{cap, actual, unit, gracefulPath}` + both-numbers message, one row per
  admission lane → **B1–B14**
- Numbers-never-content (AS-4) → `assertNoBodyContent` in every B row
- Lane-emission contract (hard lanes distinct phrasing; graceful phrasing only on
  spill-failure/beyond-ceiling) → goldens **B1/B4** + composed-text asserts
- **Spill-failure path (store unavailable → coaching refusal on a graceful lane) → NO
  TEST anywhere** (named in Decision 3; coverage note U3)

### Decision 4 — the spill lane
- Mint, digest-addressed, byte-identical materialize → **C1**; idempotent by key +
  content-addressed across keys → **C2**
- Receipts carry head + citation (`message.sent`/`message.delivered`/`messageReceipt`) →
  **C3**; worker frame EXACTLY head + citation → **C4**; closed `spill` query kind through
  the BD3-A renderer → **C5**
- Envelope co-amendment (blocker 11, ONLY four keys) → **C6** (key-closure assert)
- Run-objective spill + transparent reader resolution → **C7**; wave-member advisory
  passthrough (OQ5) → **C8**; 1 MiB ceiling + `spill_body_exceeded` → **C9, B1, B2, B3**
- **Message-lane reader projections resolving spills transparently (item 4: "message
  views … CLI/MCP projections") → NO TEST** — C7 covers run views only; C3/C6 pin
  receipts, C5 the worker lane (coverage note U4)

### Decision 5 — scanner posture
- One row per grammar, six grammars → **D1** (DECISION_REQUEST, red) + **D2–D5** (pins) +
  **C0b** external (MESSAGE_SEND, verified present and green at
  bidirectional-v3-red.test.mjs:434-455, PIN comment :447-451, 2,049-byte body :452-454)
- Law sentence in all six doc comments (the named rung edit) → **D7**
- Decision-question split (scanner half / seam half) → **D1 / D8**
- Residual silence band owned (over-window question stays prose) → **D6** first leg
- **Replay neutrality (`coordinator.mjs:13129` region never re-validates sizes) → NO
  TEST** (negative law; nothing to drive red — coverage note U1)

### Decision 6 — reply-lane parity → **C6** (spill parity), **B2** (beyond-ceiling refusal
  on the worker stream, nothing delivered)

### Decision 7 — doctor surfacing
- Digest derivation over DECLARED rows only → **A5** + **E3** (byte-identical under
  override; `effective` rides the separate field; no-override rows carry none — **E6**)
- `doctorReadiness().limits` frozen projection → **E1**; full lane tabulation with the
  closed row shape → **E6**; `card().agentExperience.limitsRegistryDigest` → **E2**;
  handshake verify → **E5**
- MCP parity (`deployment.doctor` → `doctorReadiness()`, application.mjs:12099 verified) →
  covered by construction through E1/E6 (acceptable)
- **`baton doctor --check` evidence-depth lane table / outline concision → NO TEST** —
  disclosed suite-oracle gap (header :137-139; verified the CLI has no exported print
  seam) (coverage note U2)

### Decision 8 — consolidation, no value change
- No re-declared literals, store reached, `MAX_ATTENTION_TEXT_BYTES` duplicate collapses
  (messages.mjs:424 is in F1's 46) → **F1**; values pinned → **A3/A4**; substrate refusal
  preserved → **F3**

### Decision 9 — refusal-text provenance
- One composer, suite pins text against the registry → `assertComposedRefusalText` in
  **B2, B3, B5–B14**; does-not-self-certify (blocker 10) → hardcoded goldens **B1, B4**

### Non-goals / open questions
- No retuning → A-row value pins; no wire cap → D2–D6 pins; hard lanes stay hard →
  B4–B14 refusal rows; **OQ2 → G1**; OQ3 (question hard) → **A2/B4/D8**; OQ4 → **E4**;
  OQ5 → **C8**; OQ1 reaping — deferred, no test (correct).

### Untested inventory
- **U1** replay-neutrality (Decision 5) — negative law, no oracle (acceptable, named).
- **U2** CLI doctor print cascade — disclosed oracle gap (acceptable, named).
- **U3** spill-failure coaching refusal (Decision 3 names the path) — strengthen.
- **U4** message-view/CLI/MCP transparent spill resolution (Decision 4 item 4) —
  strengthen.
- **U5** wave-member byte law at application.mjs:1854-1855 — **BLOCKER 4**.

## 2. Per-pin verdicts (false-green hunt)

- **P1 · D2 (SCRATCHPAD_WRITE, 9 KB entry) — SOUND.** Green for the right reason:
  `scanForScratchpadWrite` is shape-only (claude-session.mjs:95-122 — balanced-JSON
  extraction against the 20,480 window, no size gate, verified). The 9,000-byte entry is
  deliberately OVER the store's 8,192 entry cap: the pin asserts the wire admits what
  admission (B14) refuses with coaching — the exact layer split. A wire cap at any value
  < 9,000 fails it; deleting the store cap fails B14.
- **P2 · D3 (CONTEXT_READ, 3 KB query) — SOUND.** Same construction; scanner verified
  shape-only (:114-133 region, :122 window call).
- **P3 · D4 (BOARD_CLAIM, 3 KB grantId) — SOUND.** Inline shape-only scanner, no factory,
  no `ValidationError` swallow (:169-188 verified).
- **P4 · D5 (BOARD_REPORT, 5,000-byte body over the dead factory's 4,096) — WEAK.**
  Behaviorally sound and NOT in contradiction with live code: the pin exercises the
  SCANNER layer (:195-216, inline shape-only — verified), which today admits 5,000 bytes;
  the live 4,096 enforcement sits at the STORE layer (:14442), a different seam the pin
  never touches. The weakness is that its assertion message teaches the implementer a
  falsehood — "the only live bound is the 20,480 scanner window" is wrong in this tree
  (store :416/:14442 + schema :1426, both live) — and an implementer who believes it may
  delete the live store bound to make the claim true, i.e. smuggle a behavior REMOVAL in
  as "consolidation", the inverse of the sin blocker 8 folded against. Keep the pin; fix
  the message; resolution rides BLOCKER 1.
- **P5 · D6 (over-window → prose, all six grammars) — SOUND.** Six over-window frames
  (8,300 > 8,192; 20,600 > 20,480 ×5) all return `null` today via
  `extractFirstBalancedJsonObject`'s byte window (:45-46 verified). Also pins Decision 5's
  owned residual silence band. A scanner that parsed over-window frames fails it — the
  substrate-guard posture is the pinned behavior.
- **P6 · F2 (note.text 2,049 → `scratchpad_entry_invalid`) — SOUND (with a design
  caveat).** The field cap fires at coordination-store.mjs:586
  (`scratchpadString(entry.text, 2_048)`, verified); the pin discriminates the two epic
  hazards — drop enforcement (no refusal → red) and promote-to-registry (code becomes
  `scratchpad_entry_exceeded` → red). It does NOT pin the exact 2,048 value (a retuned
  1,024 local would green) — deliberate: the value is a named local, and F1's exemption
  pins the literal textually.
- **P7 · F3 (pack body 8,193 → `context_pack_invalid`) — SOUND.** Verified at
  `_prepareContextPackPayload` (:13054-13065): in the pin's fixture the oversize body is
  the ONLY failing condition (type regex, validity ISO round-trip, predecessor all pass),
  so the green is caused by the byte check, not a sibling validation. Same
  value-discrimination caveat as F2; A3 pins the registry value and F1 the literal.

No VACUOUS or STAGED-WRONG pins. All seven greens are legitimate already-implemented
behavior, cited above — none is a false green. (P4's caveat is about its message, not its
oracle.)

## 3. Teeth check (red rows vs plausible wrong implementations)

The eight named wrong implementations from the verification brief:

1. **Registry-without-actual** → caught: every B row asserts `payload.actual` is the exact
   byte count (`assertCoachingPayload`), and `assertNamesBothNumbers` requires the actual
   in the message.
2. **Spill-without-ceiling** → caught: **C9** (1 MiB+1 send refused, code
   `spill_body_exceeded`, `cap: 1048576`, `actual: 1048577`, NO `spill.minted` event,
   nothing delivered) plus **B1/B2/B3** on all three lane families. A refusal at the wrong
   value fails the exact cap/actual asserts.
3. **Digest-over-effective-rows** → caught: **E3** (digest byte-identical under an
   injected override; override visible only as per-lane `effective`; `decision.question`
   carries NO effective field) + **A5** (digest === sha256 of the canonical FRAME_LIMITS
   serialization, byte-stable across processes) + **E6** (projected rows carry declared
   values, closed key set).
4. **Full-body frame** → caught: **C4** — the provider-bound frame must carry the citation
   AND must NOT contain the 900-char tail run; a full-body frame voids it.
5. **Head-only-no-resolution** → caught: **C4** (citation regex in the frame) + **C5**
   (`CONTEXT_READ {kind:'spill'}` resolves byte-identically, UNTRUSTED-framed, delivered
   frame and `context.read_result` receipt share the rendered object).
6. **Reply-refusing-instead-of-spilling** → caught: **C6** requires `message.delivered`
   with the citation keys and the exact amended-envelope key closure (a refusing reply
   mints no delivery); **B2** catches the inverse (beyond-ceiling must refuse, not
   deliver).
7. **Tautological composer helper** → caught: **B1/B4** pin HARDCODED verbatim goldens,
   one per refusal class (graceful/hard) — exactly the blocker-10 bar; a helper-wording or
   value change fails the golden until deliberately edited. The remaining lanes pin text
   against the helper + registry rows (A2 pins row fields), so a per-lane text divergence
   requires a registry-row divergence, which A2 catches.
8. **Unconsolidated literals (F1's 46 hits)** → real. Verified against live code (≥8
   required; 18 verified): application-semantics.mjs:1575 (and :163/:487/:1356/:1369/
   :1426/:1551) objective/answer/detail/report schemas; application.mjs:39, :49, :53, :60,
   :64, :74 (view constants), :289 (`validText` default 4,096), :331 (`<=160 bytes` prose
   comment), :1855 (wave-member char check); coordination-store.mjs:415, :416, :484, :487,
   :3485, :16289 (comment); coordinator.mjs:1000, :4634, :6633-6634, :6922, :8496, :10188;
   messages.mjs:213, :216, :314, :315, :424, :500 (comment), :568; wave-driver.mjs:27;
   mcp-northbound.mjs:314/:322/:444/:464/:607/:910/:927/:935; web-northbound.mjs:458.
   Spelling-regex factor boundaries verified sound (`16 * 1024` never reads as 16,384's
   decimal; `2 * 1024 * 1024` never reads as 2,048's KiB spelling; the `1024 * 1024`
   tail of `2 * 1024 * 1024` is lookbehind-blocked).

**Exemption-table sample (actual size 169 entries, not the ~130 pre-briefed):** 14
entries sampled against live code; no false exemption that lets a cataloged literal hide:

- `application-cli.mjs` `before.size/stat.size > 16 * 1024` — `readBoundedFile` on
  connection profile/token files (:116-132 verified). Uncataloged CLI config bound;
  value-collides with `credential.file` coincidentally. Legit.
- `cartographer-quartermaster.mjs:36` `Buffer.byteLength(value) > 2048` — generic
  capability-arg validator ('orientation/reuse text'), serving mostly uncataloged fields
  (lockfilePath, package identity); its `args.focus` (:527) / `args.need` (:570) uses are
  semantic cousins of `steering.focus` / `decision.need`. **Borderline, flagged:** the
  lane's true doors (mcp-northbound:910, web-northbound:458) are NON-exempted, so nothing
  cataloged hides — but the wave should decide import-vs-local deliberately, not inherit
  this exemption silently.
- `coordination-store.mjs` `MAX_SCRATCHPAD_WRITE_REQUEST_BYTES = 16_384` (:483, enforced
  :516/:521) — the raw REQUEST ceiling, distinct from the canonical entry lane.
  **Borderline, flagged:** an uncataloged byte guard on the scratchpad lane family;
  defensible as a resource guard, but it is exactly the class doctor should show — the
  wave should name it (substrate row or explicit local).
- `coordination-store.mjs` `bytes > 1024 * 1024` (:2919) — exemption reason says
  "attribution context bytes ceiling"; the code is a recovery-refinement session-context
  check. Exemption sound (uncataloged context-shape bound); **label slightly wrong**.
- `advisory-feed-registry.mjs` `{1,2048}$` / `maxIdentityBytes <= 4_096` /
  `maxHeaderBytes <= 256 * 1024`; `canonical-order.mjs` `MAX_RECEIPT_BYTES`;
  `supply-chain-oracle.mjs` `maxResponseBytes ?? 1_048_576`; `capability-registry.mjs`
  summary `2_048`; `route-liveness.mjs` `PROBE_CAPTURE_MAX_BYTES = 2048`;
  `web-oidc.mjs` `validText(code, 2048)`; `worktree.mjs` `SPARSE_MAX_PATH_BYTES = 2048`;
  `grok-acp.mjs` `Math.min(2048, …)` preview arithmetic — all spot-verified or structurally
  uncataloged (id-class regexes, sibling-transport/policy bounds per AS-6). Legit.
- The alias-door entries (`application-semantics.mjs`/`mcp-northbound.mjs` message
  `maxLength: 16384`; `application.mjs:1797/:2930` `validText(message, 16_384)`;
  `coordination-store.mjs:4292` `boundedText(p.message, 16_384)`) — all VERIFIED REAL.
  The exemption is honest and disclosed — the underlying hole is the contract's
  (BLOCKER 2).

Row-level flags beyond the named eight: none. C4/C5's earlier-than-headline staging is
dependency-chain honesty, not a teeth gap; D8's unprefixed first failing assert still
fails at the named behavior.

## 4. The drafter's five flags — adjudication

### Flag 1 (HEADLINE): the board-report-4096 contract/tree contradiction

**Question: which is authoritative — the contract's shape-only belief
(`coordination-store.mjs:14423-14425`, "the store's body check is shape-only") or the live
`MAX_STORE_BOARD_REPORT_BYTES` enforcement?**

**Answer: the live code is authoritative about what the tree does, and the contract's
belief is verifiably wrong in this tree.** Code evidence:

- `coordination-store.mjs:416` — `const MAX_STORE_BOARD_REPORT_BYTES = 4_096;` (sits
  beside the title/detail constants the contract itself catalogs as live).
- `coordination-store.mjs:14442` — `submitBoardReport` enforces it:
  `if (!boardBounded(fields.body, MAX_STORE_BOARD_REPORT_BYTES)) throw new
  CoordinationRefusal('board report body must be bounded non-empty',
  'invalid_board_report');` — and `boardBounded` (:430-432) is
  `Buffer.byteLength(value) <= maxBytes`, a BYTE BOUND, not a shape check. The fold's
  re-anchored range :14423-14425 lands inside the function's doc comment/idempotency
  prelude, ~17 lines short of the enforcement line; the check it calls "shape-only" is a
  numberless 4,096 cap refusal — precisely the sin class the epic exists to eliminate.
- The lane is LIVE, not dead-factory: the #78 grammar ships
  (`scanForBoardReport`, claude-session.mjs:195-216), the coordinator admits reports
  (`admitWorkerBoardCommand('report', …)`, coordinator.mjs:12160), and the
  application-semantics `board.report` command binds
  `liveMethod: 'admitWorkerBoardCommand → submitBoardReport'` with a SECOND live 4,096
  door (`body: {…, maxLength: 4096 }`, application-semantics.mjs:1426).
- The de-facto input bound on the lane is therefore 4,096, not 20,480: D5's 5,000-byte
  report parses at the wire (pin, correct) and is then REFUSED at the store, numberless.

**Consequence — the contract contradicts itself, not just the tree.** Implementing
Decision 2/A6 as written ("substrate-bounded, NO admission row") forces one of two
outcomes: (a) DELETE the live store bound — a behavior change smuggled in as
"consolidation", the exact inverse of blocker 8's stated reason for not cataloging the
dead factory's 4,096, and a violation of Decision 8's no-value-change law; or (b) keep
:416/:14442 — and F1 stays red forever, because F1 deliberately refuses the exemption.
The suite's stance (A6 pins the contract's text; F1 refuses to look away; D5 stays
layer-correct) is the honest one — **it is the contract that must move.**

**Fold needed (contract-side):** amend Decision 2 + Acceptance A to catalog
`board.report.body` 4,096 as a live ADMISSION row (hard, coaching; refusalCode
`board_report_exceeded`) — the board.title/board.detail disposition exactly — with a
matching B-row (B15) over `submitBoardReport`; retarget A6 to assert the row EXISTS at
the live value (keeping the `scanner.window.board_report` substrate row); fix D5's
message to name the store bound; F1's :416/:14442 and schema :1426 hits then retire on
import like every other cataloged literal. (The rejected alternative — declare the bound's
removal an operator-visible behavior change — reopens blocker 8's settled "no behavior
change" fold for no epistemic gain; the bound is live, worker-visible, and cheap to
catalog.) **BLOCKER 1.**

### Flag 2: schema second-door non-exemption

**Verdict: the suite's unconditional reading is correct per Decision 8's letter — and the
contract should say so explicitly.** The second doors are real and verified: char
`maxLength: 4096` on CATALOGED lanes at application-semantics.mjs:163/:1551/:1575
(run.objective), :487 (decision.text via answer_decision), :1356/:1369 (board.detail),
:1426 (board.report.body); mcp-northbound.mjs:314/:444/:464 (objective), :322 (answer
text), :927/:935 (board detail), :607 + :910 (orientation.note, char schema AND byte
check), web-northbound.mjs:458 (orientation.note byte check). The northbound
orientation.note doors ARE the cataloged lane's content at another admission point —
exempting them would ratify the wave-member char-check sin class at the schema layer. The
exempted `answer_question` schema (:477) was verified to be a DIFFERENT command (no
cataloged lane), so the exemption table is not hiding a swap. Decision 1's consumer list
not naming the northbound/schema modules is a **contract gap**: amend the consumer list
(or Decision 8) to name the schema/northbound layers as registry consumers — otherwise
the wave re-litigates 17 of F1's 46 hits one at a time. **BLOCKER 3** (contract
amendment; the suite row itself needs no change).

### Flag 3: alias-door 16,384 exemption

**Verdict: the exemption is honest and the door is real — and the contract's silence is a
frame-economy hole that needs adjudication.** Verified: the legacy `run.send` /
`run.act send` / workstream-notify path enforces 16,384 BYTES inline
(application.mjs:1797, :2930; coordination-store.mjs:4292; schemas at
application-semantics.mjs (`maxLength: 16384`) and mcp-northbound.mjs). The contract never
scopes the alias; v1 ships a 2,048+spill typed lane beside a 16,384 inline alias, and
every driver that can reach the alias routes around the economy. The suite's exemption is
the right suite-level choice (the row would otherwise be red on an unscoped surface), but
the QUESTION is the contract's: the alias inherits `message.send.body` (behavior change on
the alias, closes the hole), gets its own cataloged row (16,384, named), or is declared
legacy-out-of-scope (named, time-boxed). Any of the three unblocks F1's conscience;
silence does not. **BLOCKER 2** (contract adjudication).

### Flag 4: oracle gaps

**Verdict: confirmed, all acceptable-as-named except one that graduates to a blocker.**
- CLI print cascade (U2) — disclosed, verified (no exported seam; CLI returns payloads
  verbatim). Acceptable; same class as browser-use's assembly-site note.
- E rows gated behind registry-missing — disclosed; both positive arms independently
  smoke-verified (§0.2). Acceptable.
- Replay neutrality (U1), spill-failure path (U3), message-view transparent resolution
  (U4) — newly named here; strengthenings, not blockers.
- **Wave-member byte law (U5) — graduates to BLOCKER 4:** the contract's byte law
  explicitly "fixes the wave-member character check (application.mjs:1854-1855)", and OQ5
  mandates oversize wave members SPILL rather than wall. No row exercises
  application.mjs's wave-attach admission at all (C8's fake `baton.waves.start` bypasses
  it). A wrong implementation that LEAVES the char check as a refusal
  (`application_wave_attach_invalid` at 4,097 chars) — the wall-in-front-of-spill
  surviving behind the driver's new advisory — greens the entire suite. That is an
  acceptance-named behavior with no effective oracle.

### Flag 5: E3/E5 smoke-verification-only

**Verdict: SOUND — the drafter's claim holds.** Both positive arms independently
replicated green today (§0.2): the E5 fixture connects with a limits-bearing card (the
field is ignored — the red condition), and the E3 fixture's Quartermaster +
below-ceiling-override injection constructs and serves `doctorReadiness()`. The fixtures
are sound; the red arms fail at `registry-missing` by design.

## 5. Drift findings (suite header / contract vs shipped code)

Suite-side (verified accurate — implementers can trust the header):
- Invented surface honestly marked as invented (:49-109): `composeFrameLimitRefusal(row,
  actual, cap)` (contract names "one helper", not its name — template matches Decision 9's
  quoted graceful phrase verbatim; the hard-lane phrase is invented and disclosed);
  `mintSpill` (contract names `materializeSpill(handle)` and "mints a spill artifact" but
  no mint method name); the `spill.minted` event kind (contract says "appended as a
  durable event (`payload.spilled`)" — the parenthetical is ambiguous between a payload
  marker and an event kind; the suite's kind mirrors `context.pack_minted`; **recommend
  the contract name the event kind**, low-severity drift); `onAdvisory {role, bytes,
  limit, spill, lane}` (contract names advisory behavior only); the per-lane refusal codes
  beyond `spill_body_exceeded` (`decision_question_exceeded` etc. — contract requires
  `refusalCode` but does not enumerate strings); `FRAME_LIMITS` map keyed by lane with
  `view.*` lane names and `items` units (contract catalogs values, not the view-lane
  naming scheme). Nothing here contradicts the contract; all of it is disclosed in the
  header as adjustable-if-renamed.
- Contract-adopted names all check out: `FRAME_LIMITS` / `FRAME_LIMITS_VERSION` /
  `FRAME_LIMITS_DIGEST`; `spill:sha256:<digest>`; `CONTEXT_READ {kind:'spill', spill}`;
  doctor projection `{version, digest, lanes:[{lane, class, value, unit, graceful,
  effective?}]}`; `card().agentExperience.limitsRegistryDigest`;
  `cli_connection_incompatible`; the golden graceful phrase verbatim from Decision 9.
- Suite-comment line citations verified against THIS tree: coordinator.mjs:6634, :6922,
  coordination-store.mjs:3485, wave-driver.mjs:321-329, messages.mjs:230,
  application.mjs:1406, claude-session.mjs:87-92 — all accurate.
- Suite-count drift in the pre-briefing: the exemption table is **169 entries**, not
  ~130 (cosmetic).

Contract-side (the wave will trip — the tree moved a third time post-fold):
- Stale line citations (all verified at their new homes): coordinator.mjs send TypeError
  6609-6610 → **6633-6634**; orientation note 6898 → **6922**; reply seam 11835-11878 →
  **:12167-12217** (refuse spread seam :12179-12184); closed envelope 11864-11866 →
  **:12206-12208**; decision seam 11974-11989 → **:12317-12329**; renderer 10416-10452 →
  **:10419-10472** (unknown-kind throw :10465); replay switch :13129 region → **:13472
  region**; scope-refresh shrink 8470-8475 → **:8496**; serveKnowledge 10141-10147 →
  **:10188**; inspectCapturedFile :4610 → **:4634**; wave-driver precheck 304-312 →
  **:321-329**; store reuse literals :3471 → **:3485**; board title/detail enforcement
  :14064-14066 → **:14270-14272** (plus mutation/retitle paths :14110-14118, :14364-14365);
  board-report check :14423-14425 → **:14442** (the headline); pack body enforcement
  :13042 → **:13061**. The contract preamble already declares lines point-in-time, so this
  is cosmetic — but re-anchor in the same amendment as BLOCKER 1.
- Substantive: Decision 2's board paragraph, GT5's dead-factory note, and Acceptance A's
  board.report.body row are wrong about the live tree (BLOCKER 1); Decision 1's consumer
  list omits the northbound/schema layers (BLOCKER 3); the alias door is unscoped
  (BLOCKER 2).

Header split reconciliation: declared 40 red / 7 pins = measured 40 fail / 7 pass. No
divergence; nothing to adjudicate.

## 6. Closing verdict

**NOT-READY** — the suite itself is honest and sharp: 40/40 red rows fail at their named
stages, zero fixture bugs, zero false greens among the seven pins, fully hermetic, and
every named wrong implementation fails at least one row. But the contract it pins is
wrong about a live bound, and three acceptance-named surfaces have no effective oracle or
no contract answer; as written, the wave would either delete a live 4,096 bound against
the contract's own no-value-change law, or ship a permanently-red F1 and an economy with a
documented bypass.

Blockers:

1. **The board.report.body contract/tree contradiction (the headline).** What: the v1.1
   fold believes the store's board-report body check is shape-only
   (coordination-store.mjs:14423-14425) and declares the lane substrate-bounded with no
   admission row (A6); the live tree enforces 4,096 BYTES at `submitBoardReport`
   (:416 declared, :14442 enforced via `boardBounded` :430-432, refusal
   `invalid_board_report`) with a second live door at application-semantics.mjs:1426.
   Why: implementing the contract as written requires deleting a live bound (a behavior
   change masquerading as consolidation — the inverse of blocker 8's own rationale) or
   keeping it and failing F1 forever; D5's message currently teaches the falsehood.
   Fix: amend the contract (Decision 2 + Acceptance A): catalog `board.report.body` 4,096
   as a live admission row (hard, coaching, `board_report_exceeded`) at the LIVE value —
   the board.title/board.detail disposition; add suite row B15 over `submitBoardReport`;
   retarget A6 to assert the row exists; fix D5's message; F1's :416/:14442/:1426 hits
   retire on import.
2. **The alias door (16,384) is unscoped by the contract.** What: `run.send` /
   `run.act send` / workstream-notify enforce 16,384 inline (application.mjs:1797/:2930,
   coordination-store.mjs:4292, plus schemas) beside the cataloged 2,048+spill lane; F1
   exempts them as disclosed-alias-door. Why: v1 ships a documented bypass of the frame
   economy unless the contract adjudicates — alias inherits `message.send.body`, gets its
   own row, or is declared legacy (named, time-boxed). Fix: contract adjudication; the
   suite's exemption table then names the chosen disposition.
3. **The second-door class is not named as a registry consumer.** What: 17 of F1's 46
   hits are char `maxLength` / byte checks on CATALOGED lanes at the application-semantics
   and northbound layers (verified real); the suite reads Decision 8's "no module
   re-declares" as unconditional and the contract's consumer list does not name those
   modules. Why: without a contract sentence, the wave re-litigates each hit (or worse,
   exempts them and re-creates the char-check sin at the schema layer). Fix: amend
   Decision 1/8 to name the schema/northbound layers as consumers that import or retire
   their literals.
4. **The wave-member byte law has no oracle.** What: the byte law explicitly fixes the
   wave-member character check (application.mjs:1854-1855) and OQ5 mandates spill over
   wall, but C8 drives a fake `baton.waves.start` and nothing exercises the real
   wave-attach admission; a surviving char-check refusal (`application_wave_attach_invalid`
   at 4,097 chars — the wall behind the advisory) greens the whole suite. Fix: add a row
   driving an oversize (ideally multibyte) wave member through the real application
   wave-start path, asserting admit-with-spill (never refusal) and byte-measured
   accounting.

Non-blocking strengthenings (fold into the wave if convenient): a replay-neutrality guard
row or a named acceptance of that gap (U1); a spill-failure coaching-refusal row (U3);
a message-view/CLI transparent spill-resolution row (U4); the two borderline exemption
dispositions named deliberately (cartographer-quartermaster:36, scratchpad raw-request
16,384) and the mislabeled exemption reason at coordination-store.mjs:2919; naming the
`spill.minted` event kind in the contract; and re-anchoring the contract's moved line
citations per §5.
