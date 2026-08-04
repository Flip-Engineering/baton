# Issue #89 — Frame-economics contract (v1.1)

Fold: post-red-team v1.1 — the verdicts of
`docs/reference/evidence/frame-economics-2026-08-03/contract-redteam.md` (**NOT FOLD-READY,
11 blockers**; the settled design position itself survives) are folded in place on
2026-08-03: **11/11 blockers folded, 0 rejected**; open questions 1–5 resolved (OQ4/OQ5 were
fold-blocking and are resolved in Decisions 1/2/4 and Acceptance C; OQ1 is deferred, safe
under the blocker-3 spill ceiling; OQ2 is folded into the epic; OQ3 is deferred hard). Every
file:line citation was re-verified at the fold in this worktree with NUL-safe `grep -an`
searches and targeted `sed -n` reads (post-#92/#78 tree; the working tree moved twice more
the same day — `messages.mjs` between the red-team pass and the fold, then
`coordinator.mjs` / `coordination-store.mjs` mid-fold — and all anchors were re-verified a
second time against the final state). The three wrong-at-writing citation classes the report
names (GT3 digest-citation range, C0b ranges, GT6 application anchors) are fixed; pins cite
symbols/values where the tree is hot. The blocker → change map is `contract-fold.md` beside
this file.

Status: implementation contract, red-team-folded. This specifies behavior; it does not amend
implementation in this artifact. Structure mirrors the L2 contracts of
`docs/reference/evidence/frontier-sweep-2026-08-03/` (Seed → Code-verified ground truth →
Contract question → Decisions → Non-goals → Red-first acceptance).

## Seed

Issue #89 (operator-challenged twice during #86, position settled) names the frame-economics
policy: declared per-lane limits, coaching refusals at admission, graceful spillover. The
settled position:

1. Scanners detect frames only; `null` means "prose", never "policy violation" — a wire-level
   content cap is silent data loss of a well-intentioned act (the worker believes it replied;
   nothing arrives).
2. Policy bounds belong at ADMISSION as typed refusals on the worker's durable stream
   (`message.rejected {reason}`) — visible, coachable, naming the cap AND the actual size sent.
3. Oversize degrades gracefully: spill the payload to a durable artifact, inline the head + a
   digest citation — the BD3-A renderer's established oversize pattern — never a bare wall.
4. Parser scan windows (the 20,480 / 8,192 grammar windows) are substrate resource guards, not
   policy, and are the de-facto input bound regardless.

The sins this replaces, from the issue body and verified below: `coordinator.sendMessage`
throws a bare TypeError over 2,048 bytes (magic constant, no spillover); the reply lane's
admission has NO body bound at all (the two directions of one lane are inconsistent); bounds
are scattered magic constants across `coordinator.mjs` / `claude-session.mjs` /
`application.mjs` with no declared registry, so doctor output and refusals cannot surface them
by name. The worker AX feedback's error-quality item receipted the same class: a >4KiB run
objective drew `'Run objective is required'` / `application_intent_invalid` with the cap
nowhere in the message — the wave driver already carries an admission precheck workaround that
names the byte count because the machinery does not (`docs/37-wave-driver.md:90-94`;
`impl/src/wave-driver.mjs:304-312`). Refs: #86 (the exchange that spawned this), #10 (AX spine
— error quality is its item 5), #88.

## Code-verified ground truth

The anchors below were checked in this worktree with NUL-safe `grep -an` searches and targeted
`sed -n` reads on 2026-08-03, and re-verified at the v1.1 fold the same day — post-#92
(`a9f6598`, delivered frame carries the messageId: `coordinator.mjs` anchors above the message
lane shifted ~+9–16) and post-#78 (`9ec8e97`, board worker-half: the `BOARD_CLAIM` /
`BOARD_REPORT` grammars, shifting `claude-session.mjs` below line 34 and `coordinator.mjs`
below ~11776), then once more after further same-day working-tree landings in
`coordinator.mjs` / `coordination-store.mjs` / `messages.mjs` (non-uniform +1…+38 by region).
Line numbers are point-in-time against a live tree; the pins in Decisions and Acceptance cite
symbols/values. `impl/src/coordinator.mjs`, `application.mjs`, `coordination-store.mjs`, and
`claude-session.mjs` contain NUL bytes and were never read whole.

1. **The send-lane sin.** `sendMessage` validates
   `Buffer.byteLength(body) > 2_048` and throws
   `new TypeError('message body is required (non-empty, <=2048 bytes)')`
   (`impl/src/coordinator.mjs:6609-6610`). The cap appears in prose, the actual size does not,
   there is no payload carrying either number, and there is no spillover path. The lane's doc
   comment promises durable-stream receipts (`coordinator.mjs:6599-6603`).

2. **The reply lane has no body bound.** The `message.send` admission case checks only that
   `frameBody` is a non-empty string (`coordinator.mjs:11841-11844`). Its refusal helper
   `refuse(reason, extra)` appends `message.rejected` with payload `{reason, inReplyTo,
   ...extra}` (`coordinator.mjs:11835-11840`) — the spread seam a coaching payload needs
   already exists. Existing reasons: `message_frame_invalid`, `message_target_caller_named`,
   `message_parent_not_found`, `message_depth_exceeded` (`coordinator.mjs:11841-11859`).
   Delivered replies mint `message:<digest>` ids and append `message.delivered`
   (`coordinator.mjs:11861-11878`); the closed reply envelope `{messageId, inReplyTo, from,
   body}` is frozen at `coordinator.mjs:11864-11866` (Decision 4 amends it explicitly).

3. **The BD3-A oversize pattern (the model to generalize).** `_renderContextRead` is the
   closed read-port renderer: bounded per kind (`maxItems` 8 for knowledge, 64 otherwise),
   every model-authored leaf UNTRUSTED-framed, and an oversize result degrades to
   `{truncated: true, digest: canonicalDigest(sorted ids)}` — a digest citation, never raw
   overflow (`coordinator.mjs:10416-10452`; the truncation + digest citation at
   `:10442-10448`). The delivered frame and the `context.read_result` receipt share the SAME
   rendered object (`coordinator.mjs:10418-10419`), and the doctrine comment declares this
   renderer the ONLY path (`coordinator.mjs:10277-10280`). `canonicalDigest` is the
   sha256-of-canonical-JSON helper (`coordinator.mjs:312`).

4. **The scanner posture and its pin — SIX grammars (post-#78).** All six grammars scan
   assistant text only, with byte scan windows as resource guards: `DECISION_REQUEST` 8,192
   (`impl/src/claude-session.mjs:27-28`), `SCRATCHPAD_WRITE` 20,480 (`:29-30`), `CONTEXT_READ`
   20,480 (`:31-32`), `MESSAGE_SEND` 20,480 (`:33-34`), `BOARD_CLAIM` 20,480 (`:35-36`),
   `BOARD_REPORT` 20,480 (`:37-38`); `extractFirstBalancedJsonObject` returns `null` over the
   window (`:45-46`). The `MESSAGE_SEND` doc comment ALREADY carries the shape-only law: "The
   body is shape-checked only (non-empty string): the 20,480-byte scan window is the parser's
   resource guard; any frame-economics policy belongs at admission with a graceful spillover
   path, never as a silent wire cap" (`claude-session.mjs:136-143`). `scanForBoardClaim`'s doc
   comment carries a shape-only sentence ("Shape-only per the #86 campaign law — no content
   caps at the wire", `:160-168`); `scanForBoardReport`'s (`:190-194`) does **NOT** — Decision
   5 names the edit. The `DECISION_REQUEST` / `SCRATCHPAD_WRITE` / `CONTEXT_READ` doc comments
   carry the weaker "malformed = prose" posture only (`:69-74`, `:95-96`, `:114-117`). Both
   board scanners are inline shape-only — no factory call, no `ValidationError` swallow, so no
   new silent-cap leak of the ground-truth-5 class (scanners at `:169-188`, `:195-216`). The
   C0b row pins a 2,049-byte body ADMITTED shape-only with the campaign-law comment
   (`impl/test/bidirectional-v3-red.test.mjs:434-455`; PIN comment `:447-451`).

5. **The decision-question leak (a live wire-level cap).** `createDecisionRequest` enforces
   `MAX_DECISION_QUESTION_BYTES = 2_048` via `boundedNonEmpty` (`impl/src/messages.mjs:213,
   218-220, 229-230`) and raises `ValidationError`. The scanner swallows `ValidationError` to
   `null` (`claude-session.mjs:87-92`) — so an oversize question never reaches the admission
   refusal at `coordinator.mjs:11974-11989` (`control.malformed_interaction_rejected` +
   `authority.rejected {reason:'malformed_request'}`); the worker believes it asked and nothing
   arrives. This is position-1's silent data loss, shipping today. Sibling factories carry the
   same pattern: option label/summary (`messages.mjs:250-252`; constants `:214-215`), decision
   text (`:294-295`; constant `:216`), board title/detail (`:334-336`; constants `:313-314`),
   board report body (`:378`; constant `:315`). **Dead factories (fold, blocker 8):**
   `createBoardItem` (`messages.mjs:327`) and `createBoardReport` (`messages.mjs:369`) have NO
   importer in `impl/src` — their values must not be cataloged as live bounds. The LIVE
   `board.title` / `board.detail` bounds are the store's `MAX_STORE_BOARD_TITLE_BYTES` 160 /
   `MAX_STORE_BOARD_DETAIL_BYTES` 4_096 (`coordination-store.mjs:414-415`, enforced in
   `postBoardItem` at `:14064-14066`), and the live board-report lane's only bound is the
   20,480 scanner window (the store's body check is shape-only,
   `coordination-store.mjs:14423-14425`) — see Decision 2.

6. **The run-objective class.** Run intent validates `validText(value.objective)` whose
   default ceiling is 4,096 BYTES (`impl/src/application.mjs:289-290, 1403`) and throws
   `applicationError('run intent is invalid', 'application_intent_invalid')`
   (`application.mjs:1406`) — no cap, no actual. The empty-objective client error is
   `'Run objective is required'` (`impl/src/application-client.mjs:113`). Wave members are
   checked in CHARACTERS (`member.objective.length > 4096`, `application.mjs:1854-1855`) — a
   byte/char inconsistency for the same logical lane. The wave driver works around the silence
   with `OBJECTIVE_MAX_BYTES = 4096` and a precheck error naming bytes and limit, code
   `wave_driver_objective_oversize` (`impl/src/wave-driver.mjs:27, 304-312`), receipted at
   `docs/37-wave-driver.md:90-94`.

7. **Other admission-side caps.** Orientation push note ≤2,048, bare TypeError 'orientation
   push note is invalid' (`coordinator.mjs:6898`); its internal scope-refresh caller already
   degrades gracefully by shrinking the observed path until the note fits
   (`coordinator.mjs:8470-8475`). Steering policy focus ≤2,048 (`coordinator.mjs:1000`). Reuse
   decision need/rationale ceilings are DEPLOYMENT-INJECTED
   (`_reuseDecisionPolicy.maxNeedBytes/maxRationaleBytes`, `coordinator.mjs:948-957`) and
   applied through `normalizedDecisionText` (`coordinator.mjs:517-518, 9998-9999`). **The
   hidden floor (fold, blocker 6):** the store independently hardcodes the same lane literals —
   `boundedText(p.need, 2_048)` / `boundedText(p.rationale, 8_192)`, byte-based
   (`coordination-store.mjs:3471`; `boundedText` at `:357`) — silently flooring the deployment
   override: `maxNeedBytes: 4096` passes the coordinator's policy check and is refused by the
   store at 2,049. Decisions 1(d)/2 move the literals into the registry as the declared
   defaults AND the ceiling-of-ceilings (Open question 4, resolved).

8. **View-side ceilings already degrade gracefully with a flag — the precedent class.** Board
   view sheds trailing items and re-flags until under `MAX_BOARD_VIEW_BYTES` "never silent"
   (`application.mjs:60, 552-554`); same shape for REPL (`:64, 595-597`) and scratchpad
   (`:66, 714-715`; `MAX_SCRATCHPAD_VIEW_BYTES = 32_768` is an EXPORTED constant — the export
   precedent). Attention text truncates with an ellipsis marker (`application.mjs:53,
   305-306`), blocked-interaction summaries at 160 (`:54, 339-341`). Knowledge slices break at
   the byte boundary (`messages.mjs:527, 531-533`; served with defaults maxFindings 8 /
   maxBytes 2,048 at `coordinator.mjs:10141-10147`). Remaining view ceilings:
   `MAX_PROFILE_BYTES` 256KiB (`application.mjs:39`), `MAX_RUN_VIEW_BYTES` 512KiB (`:49`),
   `MAX_REVIEW_SOURCE_BYTES` 4MiB (`:74`), `MAX_BOARD_ITEMS` 512 (`:61`),
   `MAX_SCRATCHPAD_VIEW_ITEMS` 64 / `MAX_SCRATCHPAD_VIEW_CACHE_KEYS` 256 (`:67-68`),
   `inspectCapturedFile` 4MiB (`coordinator.mjs:4610, 4620`). NOTE: `boundedAttentionText`
   caps text but DROPS `capBytes`'s `truncated` flag (`messages.mjs:436-445, 449-455`) —
   silent truncation inside the BD3-A renderer's rows (`coordinator.mjs:10433-10440`); see
   Open question 2 (folded: the fix lands in this epic). `MAX_ATTENTION_TEXT_BYTES` is
   declared TWICE today (`application.mjs:53` and an exported duplicate at
   `messages.mjs:424`) — Decision 2 subsumes both into one registry value.

9. **Substrate guards (not policy).** `DEFAULT_MAX_WIRE_FRAME_BYTES` 1MiB
   (`claude-session.mjs:19`), configured at `:464-465` and enforced on the transport
   (`:911, 955, 980`); `CREDENTIAL_MAX_BYTES` 16KiB (`:250, 315, 329`); context-pack bodies
   ≤8,192 (`impl/src/coordination-store.mjs:487`, enforced at `:13042`).

10. **The artifact machinery — and why none of it fits spillover verbatim.**
    `registerArtifact` is idempotent by auth key (`coordination-store.mjs:12553-12559`) but
    `_prepareArtifact` requires a known task (`:12574-12575`) and `accepted` requires a
    COMPLETED task plus hub-verification provenance (`:12586-12595`) — task-terminal work
    product, the wrong lifecycle for a message body or run objective. `artifact(id)` is the
    digest reader (`:12656`). Worktree capture reads commit files by sha
    (`coordinator.mjs:4609-4621`) — VCS-bound, and a message has no commit. The closest model
    is the context-pack section: digest-addressed `context-pack:<canonicalDigest(...)>` ids
    (`coordination-store.mjs:13056-13059`), idempotent mint on the event log
    (`:13066-13076`), head tracking (`:13083-13087`), and a materialize read that serves the
    body (`:13089-13096`) — but packs carry family-head chaining, validity expiry
    (`:13039-13055, 13092-13094`), reaping (`:13098-13101`), and the 8,192 body cap
    (`:487`, enforced `:13042`) — all wrong for spill, which must out-cap the inline lane and
    live exactly as long as its referencing receipt.

11. **The doctor surfaces.** `doctorReadiness()` returns a frozen `{schemaVersion: 1, repoId,
    routes, workspace}` (`application.mjs:12001-12009`); `deployment.doctor` is the MCP
    quota-free readiness port (`application.mjs:12094-12099`). The CLI parses
    `baton doctor [--check] [--depth <depth>]` — depth is a `--depth` FLAG, not a positional —
    with depths `outline|connection|profile|evidence`
    (`impl/src/application-cli.mjs:1253-1259`). The connection handshake already verifies a
    registry digest — `doctor.application.agentExperience.registryDigest ===
    APPLICATION_SEMANTIC_REGISTRY.digest`, refusing `cli_connection_incompatible` on mismatch
    (`application-cli.mjs:1965-1978`) — and `card()` publishes
    `agentExperience.{registryVersion, registryDigest}` (`application.mjs:12011-12018`). A
    second, static, digest-able registry slots into machinery that already exists.

12. **Shared-module precedent.** The wire layer already imports a shared pure module —
    `claude-session.mjs:17` imports `createDecisionRequest, ValidationError` from
    `./messages.mjs`. A frozen data registry follows the same dependency direction.

## Contract question

Where do per-lane frame limits live so that validation, refusal text, doctor output, and
spillover all read ONE declaration; how does every size refusal coach `{cap, actual,
gracefulPath}`; and how does oversize spill to a durable artifact with a digest citation —
while scanners stay shape-only forever?

## Decisions

### 1. One declared module: `impl/src/limits.mjs` — NOT a coordination-store section

A new pure data module exports `FRAME_LIMITS`: one deep-frozen registry, plus
`FRAME_LIMITS_VERSION` and `FRAME_LIMITS_DIGEST` (sha256 of the canonical serialization of the
DECLARED rows — never effective values; the derivation rule is pinned in Decision 7). Every
consumer imports it: admission validation (`coordinator.mjs`, `application.mjs`,
`wave-driver.mjs`, and **`coordination-store.mjs`** — the store enforces the cataloged
`decision.need` / `decision.rationale`, `scratchpad.entry.body`, `context_pack.body`, and
`board.title` / `board.detail` bounds today and is a first-class registry consumer, ground
truth 7/9), refusal text builders, the CLI/doctor projections, and the scanner module's doc
posture.

**Rationale over a store section.** (a) The consumers span four modules that have no store
handle at validation time — the wire scanner (`claude-session.mjs`) and CLI composition
(`application-cli.mjs`) would need a store instance threaded INTO the wire layer, inverting
the dependency direction that `messages.mjs` already establishes (ground truth 12).
(b) These limits are code-fixed product decisions — the issue's whole point is naming them as
product decisions once — not per-deployment mutable data; a store section implies deployment
mutability and would need its own authority/replay story. (c) Doctor surfacing needs a static,
digest-able declaration, and the handshake already verifies exactly one such digest
(`application-cli.mjs:1970`); a second registry reuses that machinery instead of inventing a
store-read path. (d) The one legitimately deployment-injected byte policy —
`_reuseDecisionPolicy.maxNeedBytes/maxRationaleBytes` (`coordinator.mjs:948-957`) — becomes a
registry CONSUMER: the registry declares the lane, unit, class, and default; the deployment
override is validated against the registry row at injection — an override ABOVE the registry
value REFUSES AT INJECTION with a typed error naming the ceiling and the attempted value (the
provider-read hard-ceiling precedent: deployment ceilings capped by hard ceilings,
`coordinator.mjs:885`), never a silent `min()`, which would be the silent-cap sin in
deployment clothing — and doctor reports the EFFECTIVE value (Decision 7). The registry's
declared values are the store's current literals (2,048 / 8,192,
`coordination-store.mjs:3471`): the hidden floor becomes the declared ceiling-of-ceilings
(Open question 4, resolved).

### 2. The registry row schema, the byte law, and three classes

Every row: `{lane, class, value, unit, graceful, enforcedAt, refusalCode}`. (v1.0's `bound`
field is dropped at the fold — it was never independently defined; `class` + `graceful` +
`refusalCode` already carry the enforcement semantics, and an undefined field is drift bait.)

- `lane` — dotted, stable: `message.send.body`, `message.reply.body`, `run.objective`,
  `wave.member.objective`, `decision.question`, `decision.need`, `decision.rationale`,
  `orientation.note`, `steering.focus`, `board.title`, `board.detail`, `scratchpad.entry.body`,
  `decision.option.label`, `decision.option.summary`, `decision.text`, plus the substrate and
  view lanes cataloged in Acceptance. (`board.report.body` is deliberately NOT an admission
  lane in v1 — it is substrate-bounded; see below.)
- `class` — `admission` | `substrate` | `view`.
- `value` + `unit` — **the byte law: every admission bound is measured in UTF-8 BYTES via
  `Buffer.byteLength`**, never `.length`. This fixes the wave-member character check
  (`application.mjs:1854-1855`) and aligns with the existing send-lane and validText checks
  (`coordinator.mjs:6609`; `application.mjs:289-290`). **Scope of the law (fold):** every
  cataloged *text* lane. Identity lanes (`actor.length > 256`), array counts, and the
  id-class regexes (`SAFE_OPTION_ID` `{1,128}` and kin) count UTF-16 code units by design and
  are NOT cataloged lanes — the law neither "fixes" them nor newly relies on char semantics
  elsewhere.
- `graceful` — `spill-digest-citation` (message bodies, run/wave objectives in v1),
  `shed-flagged` (view lanes, the existing precedent of ground truth 8), or `null` (hard
  bound — the refusal itself is the surface; `decision.question` is hard in v1, Open
  question 3).
- `enforcedAt` / `refusalCode` — name the seam and the typed code, so refusal text and doctor
  output cite the lane by name rather than embedding magic constants.

Substrate rows (`scanner.window.decision` 8,192; `scanner.window.scratchpad`,
`scanner.window.context_read`, `scanner.window.message_send`, `scanner.window.board_claim`,
`scanner.window.board_report` 20,480; `wire.frame` 1MiB; `credential.file` 16KiB;
`context_pack.body` 8,192; `spill.body` 1MiB — ground truth 4, 9, Decision 4) are DECLARED in
the registry with `class: 'substrate'` so doctor shows the real de-facto input bounds — but
they mint no refusals and carry no `graceful`; they are resource guards, per position 4. The
one exception is `spill.body`: a substrate ceiling enforced AT ADMISSION, so it carries a
`refusalCode` (`spill_body_exceeded`) and draws the hard coaching refusal — it is a resource
ceiling on a durable write, not a scanner window (Decision 4). View rows (ground truth 8) are
declared with `class: 'view'`, `graceful: 'shed-flagged'`.

**`board.report.body` is substrate-bounded in v1 (fold, blocker 8).** The only live bound on
the lane today is the 20,480 scanner window (scanner shape-only,
`claude-session.mjs:195-216`; admission `coordinator.mjs:11815-11824`; store body check
shape-only, `coordination-store.mjs:14423-14425`) — the 4,096 in the dead `createBoardReport`
factory (`messages.mjs:315, 378`) is NOT a live bound, and cataloging it as one would smuggle
in a NEW restriction as "consolidation" (the move this epic exists to eliminate, and a quiet
violation of Decision 8's no-value-change law). v1 therefore declares the lane
substrate-bounded — doctor shows the real 20,480 de-facto input bound — and adding an
admission bound is an operator-visible follow-up decision, pinned as a behavior change when
it lands. `board.title` / `board.detail` ARE live-bounded — in the store
(`coordination-store.mjs:414-415`, enforced `:14064-14066`), not in the dead factory — and
are cataloged as admission rows at those live values (160 / 4,096), no behavior change.

**The store is a registry consumer; its byte literals, enumerated (fold, blocker 6).**
`coordination-store.mjs` hardcodes byte literals on cataloged lanes and on deliberate-local
lanes. Per-cap disposition:

- `:3471` — `boundedText(p.need, 2_048)` / `boundedText(p.rationale, 8_192)` → **registry
  rows** `decision.need` / `decision.rationale`: the declared defaults AND the
  ceiling-of-ceilings for the deployment override (Decision 1(d)); the store imports them.
- `:484` — `MAX_SCRATCHPAD_ENTRY_BYTES = 8_192` (enforced `:649-651`) → **registry row**
  `scratchpad.entry.body` 8,192, admission class, hard with the Decision-3 coaching shape
  (today's refusal is typed but numberless: `'scratchpad canonical content exceeds its
  ceiling'` / `scratchpad_entry_invalid`); the store imports it.
- `:487` — `MAX_CONTEXT_PACK_BODY_BYTES = 8_192` (enforced `:13042`) → already-cataloged
  substrate row `context_pack.body`; the store imports the registry value (no value change).
- `:414-415` — `MAX_STORE_BOARD_TITLE_BYTES` 160 / `MAX_STORE_BOARD_DETAIL_BYTES` 4_096
  (enforced `:14064-14066`) → **registry rows** `board.title` / `board.detail`; the store
  imports them.
- `:586, :611, :620, :623` — scratchpad field-level 2_048s (`note.text`, `link.context`,
  link target url/href) and the `:643` label 256 → **deliberate local**: field-shape
  partitions INSIDE the registry-capped 8,192-byte entry; the entry cap is the lane bound a
  worker is coached against, not the sub-fields. Named here so Acceptance F exempts them by
  name.
- `:2678, :2945, :11071` — attribution model/effort/routeKey 8_192 (harness 512) →
  **deliberate local**: hub/deployment-authored provenance-metadata shape bounds, not worker
  frame economics.
- `:3512` — reuse SBOM `lockfile` 2_048 → **deliberate local**: evidence-projection shape
  bound.
- `:15851, :15860` — knowledge contradiction/invalidation `reason` 8_192 → **deliberate
  local**: operator maintenance-lane reason strings, not the worker frame economy.

### 3. The coaching refusal shape: `{cap, actual, unit, gracefulPath}` in payload AND message

Every size refusal on an admission lane carries BOTH:

- a structured payload `{reason|code, cap, actual, unit: 'bytes', gracefulPath}` — for the
  message lane, spread through the existing `refuse(reason, extra)` seam into
  `message.rejected` on the worker's durable stream (`coordinator.mjs:11835-11840`); for the
  application/driver lanes, on the typed error (`applicationError` /
  `wave_driver_objective_oversize` shape);
- a human message naming BOTH numbers: e.g.
  `message body is 2611 bytes (cap 2048); over-cap bodies spill to a durable artifact — resend with a digest-citable head`
  — never the bare `'message body is required (non-empty, <=2048 bytes)'`
  (`coordinator.mjs:6610`), never `'run intent is invalid'` with no number
  (`application.mjs:1406`).

The wave-driver precheck (`wave-driver.mjs:304-312`) is the behavioral floor — it already
names bytes and limit — and is generalized, not duplicated: its constant moves to the
registry and its text gains the graceful path. When a lane is graceful, oversize does NOT
refuse at all (Decision 4); the coaching payload shape governs the hard-bound lanes and any
spill-failure path (e.g. store unavailable, or a body beyond the `spill.body` ceiling), where
`gracefulPath` says what the caller should do instead.

**Numbers, never content (fold, AS-4 hardening pin).** Refusal payloads and texts carry
numbers only — `cap`, `actual`, `unit`, `gracefulPath` — never body content, not even a head
snippet: a "helpful" quote would put worker prose into `authority.rejected` driver-visible
records and doctor surfaces. `actual` is self-disclosure to the payload's own author (the
worker's own durable stream for `message.rejected`; the driver/operator for application
lanes), not a leak — no bucketing. Today's refusal machinery is already clean on this (the
`errors` lists are factory strings, no content); this pin keeps it a law, not an accident,
and Acceptance B asserts it.

### 4. The spillover lane: a NEW coordination-store section, message bodies + run objectives first

Oversize on a `graceful: 'spill-digest-citation'` lane is ADMITTED with spill, never refused
— up to the spill ceiling (item 5):

1. The admission seam mints a **spill artifact** in a new store section — digest-addressed
   `spill:sha256:<digest>` (mirroring the `art:sha256:` handle convention,
   `coordinator.mjs:523-529`), appended as a durable event (`payload.spilled`), idempotent by
   auth key, with a `materializeSpill(handle)` read that serves the full body — the
   context-pack machinery's shape (`coordination-store.mjs:13056-13096`) minus family-head
   chaining, expiry, and the 8,192 cap (ground truth 10).
2. The lane carries inline: the UTF-8-safe head (first `cap` bytes via the existing
   `capBytes`, `messages.mjs:436-445`) plus the citation fields
   `{spilled: true, bytes, digest, spill}`.
3. Receipts carry the digest: `message.sent` / `message.delivered` and the coordinator's
   `messageReceipt` record `{body: head, bytes, digest, spill}`; a run intent stores
   `objective` head + citation with the digest riding the intent record. **Envelope
   co-amendment (fold, blocker 11):** this decision explicitly amends BD3-C v2.0's CLOSED
   reply envelope `{messageId, inReplyTo, from, body}` (frozen at
   `coordinator.mjs:11864-11866`) to `{messageId, inReplyTo, from, body, spilled?, bytes?,
   digest?, spill?}` — the citation keys are present only when spilled, and ONLY those four
   keys are added, so C1b's smuggled-fields guarantee stays intact.
4. Readers resolve transparently: message views, run views, and CLI/MCP projections call
   `materializeSpill` before display, so a routine reader never sees the citation — the same
   rendered-object-for-receipt-and-delivery doctrine as BD3-A (`coordinator.mjs:10418-10419`).
5. **The spill ceiling (fold, blocker 3): `spill.body` = 1 MiB (1,048,576 bytes), declared as
   a substrate row.** Worker-origin bodies are de-facto bounded by the scanner windows
   (20,480), but orchestrator-direct lanes are not: `sendMessage` is called in-process and run
   objectives arrive over MCP/CLI — no wire frame bounds them, and post-spill an unbounded
   body would be ADMITTED into the durable event log, persisted forever and replayed at every
   open. The value aligns with `wire.frame` (`DEFAULT_MAX_WIRE_FRAME_BYTES`,
   `claude-session.mjs:19`) because the durable-log frame economics demand exactly three
   properties: (a) it out-caps every inline admission bound (≤4,096), so spill never caps
   below the payloads it exists to serve; (b) it equals the largest frame the transport
   already admits, so a spilled body can always be served back to a worker through the
   resolution lane (item 6) with no paging protocol in v1; (c) the durable log's worst-case
   single-event payload stays in the same class as the transport's existing worst-case frame —
   durable-log growth asymptotics are unchanged (what makes Open question 1 safely
   deferrable). A body BEYOND the ceiling is not admitted and mints no spill: it draws the
   hard coaching refusal (Decision 3 shape) with refusal code `spill_body_exceeded` — on the
   message lane a `message.rejected {reason: 'spill_body_exceeded', cap, actual, unit,
   gracefulPath}` on the worker's durable stream; on the objective lanes the typed
   application/driver error of the same shape.
6. **The worker-bound frame for a spilled send (fold, blocker 4) carries EXACTLY the head +
   the citation** `{spilled: true, bytes, digest, spill}` — never the full materialized body
   (a full-body frame voids the 2,048 cap's purpose for the worker's frame budget, the epic's
   namesake economics) and never head-only without a resolution lane (that strands the data).
   The worker resolves the body through a NEW closed `spill` query kind on the existing read
   port — `CONTEXT_READ {kind: 'spill', spill: 'spill:sha256:<digest>'}` — served by
   `materializeSpill` and rendered through `_renderContextRead` like every read answer
   (UNTRUSTED-framed; the delivered frame and the `context.read_result` receipt share the same
   rendered object, the BD3-A doctrine, `coordinator.mjs:10418-10419`). The worker can verify
   the resolved body against the citation digest it already holds. The 1 MiB ceiling equals
   the `wire.frame` substrate guard, so the resolution frame always fits the transport.

**Artifact home rationale.** The coordination store — not the worktree, not task artifacts,
not context packs verbatim. Worktree capture is commit-sha-bound task work product
(`coordinator.mjs:4609-4621`): a message body has no commit, and coupling messaging to VCS
leaks into worker-visible work. `registerArtifact`'s gates are task-terminal and
provenance-bearing (`coordination-store.mjs:12573-12595`) — semantically wrong for an
admission-time payload. Context packs are the right MACHINERY (digest-addressed, idempotent,
durable, replay-safe — exactly the properties re-drive needs) but the wrong semantics
(expiry under a live message is data loss; head chaining is meaningless here; 8,192 would cap
spill below the payloads it exists to serve). A spill artifact lives exactly as long as its
referencing receipt; reaping is Open question 1 — deferred, safe under the ceiling.

**Why the store and not "inline anyway":** position 1 forbids silent loss and position 3
forbids the bare wall; the store event log is the durable, replay-visible home both
satisfy.

### 5. Scanner posture PIN: shape-only forever, all SIX grammars, one suite row each

- The shape-only law sentence (already shipped for `MESSAGE_SEND`, `claude-session.mjs:136-143`)
  is extended verbatim-adapted to the `DECISION_REQUEST`, `SCRATCHPAD_WRITE`, and
  `CONTEXT_READ` doc comments (`:69-74`, `:95-96`, `:114-117`) and to the two #78 board
  grammars: `scanForBoardClaim`'s doc comment (`:160-168`) already carries a shape-only
  sentence and gains the law sentence for uniformity; `scanForBoardReport`'s (`:190-194`)
  does NOT carry it — **adding the law sentence to that doc comment is a named edit of this
  rung**, pinned by the new suite row. The law: the scan window is the parser's resource
  guard; size policy lives at admission; `null` means prose.
- One red-first suite row PER GRAMMAR — six rows — pins a large-but-parseable payload
  ADMITTED shape-only: C0b is the `MESSAGE_SEND` row (`bidirectional-v3-red.test.mjs:434-455`);
  the `DECISION_REQUEST`, `SCRATCHPAD_WRITE`, `CONTEXT_READ`, `BOARD_CLAIM`, and
  `BOARD_REPORT` rows are added beside it (`:414-455`).
- **The decision-question split (the consequence that makes this honest):**
  `createDecisionRequest`'s size check (`messages.mjs:229-230`) is separated from shape
  validation — the scanner path validates shape only, so an oversize question PARSES and
  travels; the admission seam (`coordinator.mjs:11974-11989`) applies the registry bound and
  issues the typed, coaching refusal (Decision 3) instead of today's scanner-`null` silence
  (ground truth 5). The `ValidationError` errors list gains the actual byte count. The same
  split applies wherever a shape factory doubles as a size gate on a scanner path; both board
  scanners are already inline shape-only (no factory, no `ValidationError` swallow,
  `claude-session.mjs:169-188, 195-216`), so no board split is needed.
- **Replay neutrality (fold).** Registry bounds apply at LIVE admission only: the
  replay/reconstruction switch (`coordinator.mjs:13129` region) rebuilds pending-interaction
  state from durable events and never re-validates sizes, and no size check may be added to
  the replay path — a future retune cannot fork replay.
- **The residual silence band, owned honestly (fold).** A question over the 8,192 scan window
  is still scanner-`null` (prose) — that is position 4 (windows are substrate guards), not a
  bug: the split removes the IN-WINDOW silent cap; beyond the window there was never a frame
  at all.

### 6. Reply-lane parity

The reply direction of the message lane gains the registry's `message.reply.body` row —
declared at the same 2,048 bytes as `message.send.body` in v1 (one lane, one economy;
retuning is a Non-goal) — enforced at the existing admission case
(`coordinator.mjs:11841-11844`) with spill per Decision 4, so an oversize reply degrades to
head + digest citation on `message.delivered` exactly like an oversize send. This deletes the
asymmetry the issue names: today send is capped with a bare TypeError and reply is uncapped
(ground truth 1, 2).

### 7. Doctor surfacing: orchestrators READ the bounds before composing

- **The digest's derivation rule (fold, blocker 5):** `FRAME_LIMITS_DIGEST` is computed over
  the DECLARED registry rows ONLY — sha256 of the canonical serialization of the declared
  rows (lane, class, value, unit, graceful, enforcedAt, refusalCode, with declared defaults),
  the same derivation as `canonicalDigest` (`coordinator.mjs:312`). Deployment-injected
  effective values NEVER enter the digest: the `_reuseDecisionPolicy` override rides a
  separate channel — the doctor projection reports it per-lane as `effective` — so a
  deployment that overrides `decision.need` / `decision.rationale` cannot change its
  server-side digest and cannot break the CLI handshake between identical code (pinned in
  Acceptance E).
- `doctorReadiness()` gains a frozen `limits` projection:
  `{version: FRAME_LIMITS_VERSION, digest: FRAME_LIMITS_DIGEST, lanes: [{lane, class, value,
  unit, graceful, effective?}]}` — `effective` present only where a deployment override
  exists (`decision.need` / `decision.rationale`, `coordinator.mjs:948-957`)
  (`application.mjs:12001-12009`).
- `card()` publishes `agentExperience.limitsRegistryDigest` beside the existing
  `registryDigest` (`application.mjs:12011-12018`), and the connection handshake verifies it
  exactly as it verifies the semantic registry's (`application-cli.mjs:1965-1978`).
- `baton doctor --check` at `evidence` depth prints the lane table (name, class, value,
  graceful); `outline` depth stays concise per the doctor-depth cascade and names only the
  registry digest (`application-cli.mjs:1253-1259`).
- MCP parity: `deployment.doctor` returns the same projection (`application.mjs:12094-12099`).

### 8. Consolidation, not re-shaping, for substrate and view classes

No substrate guard and no view ceiling changes VALUE or behavior in this epic. They are moved
into the registry as declarations (Decision 2) so there is exactly one place that knows every
number; the shed-flagged view loops (`application.mjs:552-554, 595-597, 714-715`), the
ellipsis truncation markers (`:305-306, 339-341`), the knowledge-slice break
(`messages.mjs:531-533`), and the wire/credential guards (`claude-session.mjs:911, 955, 980,
315, 329`) keep their verified behavior. The registry is the only source: no module
re-declares a byte literal for a cataloged lane (pinned in Acceptance). **Widened scope
(fold, blockers 6/7):** "no module re-declares" reaches the store too — the
`coordination-store.mjs` lane literals (`:3471`, `:484`, `:487`, `:414-415`) move to or
import from the registry — and the duplicated exported `MAX_ATTENTION_TEXT_BYTES`
(`application.mjs:53` + `messages.mjs:424`) collapses to the one registry value both modules
import. The only byte literals left outside the registry are Decision 2's NAMED deliberate
locals — named, not discovered.

### 9. Refusal-text provenance

Refusal strings are COMPOSED from the registry row (lane name, value, unit, gracefulPath) by
one helper in `limits.mjs` — so the suite pins text against the registry, and a future value
change updates refusals, doctor output, and tests in one move. No refusal embeds a hand-typed
number (the `'<=2048 bytes'` prose at `coordinator.mjs:6610` and the `<=${MAX} bytes`
pattern at `messages.mjs:230` both become helper output). The helper's contract names which
lanes can ever EMIT refusal text: hard-bound lanes at admission, and graceful lanes ONLY on
spill-failure or beyond the `spill.body` ceiling (oversize on a graceful lane admits, so the
graceful-path phrasing — "over-cap bodies spill to a durable artifact — resend with a
digest-citable head" — appears only in spill-failure/beyond-ceiling refusals and doctor
output; hard lanes get a distinct `gracefulPath` phrasing naming the retry bound). **The
helper does not self-certify (fold, blocker 10):** the suite pins at least one HARDCODED
golden refusal string per refusal class (Acceptance B), so changing a value or the wording
forces an intentional test edit — the helper's text is pinned by the goldens, not by itself.

## Non-goals

- **Retuning any cap value.** This epic names, consolidates, coaches, and spills; it does not
  relitigate 2,048 / 4,096 / 20,480.
- **Spill beyond the two first lanes.** Decision-question text, reuse need/rationale, board
  bodies, orientation notes keep hard bounds with coaching refusals in v1; promoting any of
  them to `spill-digest-citation` is a follow-up per lane. (`board.report.body` gains NO
  admission bound at all in v1 — it is substrate-bounded, Decision 2; adding one later is an
  operator-visible behavior change, not consolidation.)
- **A wire-level content cap of any kind.** Explicitly rejected by position 1; the scan
  windows stay resource guards and shrink nothing.
- **Spill reaping / TTL policy.** Deferred with the ceiling in place (Open question 1); needs
  its own lifecycle decision.
- **Turn limits, TTLs, or clock windows as enforcement** — the campaign control law
  (controls are eval-able, constructive, or conversational) binds here as it did in #78.
- **Migrating historical messages/objectives.** The registry and spill apply at admission;
  stored records are untouched (replay never re-validates sizes, Decision 5).

## Red-first acceptance

Suite placement: the scanner/message-lane rows extend `impl/test/bidirectional-v3-red.test.mjs`
beside C0/C0b (`:414-455`); the registry, spill, refusal-text, and doctor rows mint
`impl/test/frame-economics-red.test.mjs` (per-feature suite precedent:
`impl/test/wave-driver-policy-red.test.mjs`, cited at `docs/37-wave-driver.md:96`).

**A. Registry pins.** `limits.mjs` exports one frozen `FRAME_LIMITS`; EVERY cataloged lane
below is present with `{lane, class, value, unit, graceful}` (+ `enforcedAt`/`refusalCode`
where the class mints refusals); `FRAME_LIMITS_DIGEST` is byte-stable across processes.
Catalog — admission class: `message.send.body` 2,048 spill; `message.reply.body` 2,048 spill;
`run.objective` 4,096 spill; `wave.member.objective` 4,096 spill; `decision.question` 2,048
hard (Open question 3); `decision.need` 2,048 / `decision.rationale` 8,192 hard — declared
defaults AND ceiling-of-ceilings for the deployment override (from
`coordination-store.mjs:3471`, Decision 1(d)); `orientation.note` 2,048 hard;
`steering.focus` 2,048 hard; `board.title` 160 / `board.detail` 4,096 hard (LIVE store
values, `coordination-store.mjs:414-415`, enforced `:14064-14066` — NOT the dead
`messages.mjs:313-314` factory constants); `decision.option.label` 160 /
`decision.option.summary` 512 / `decision.text` 4,096 hard (`messages.mjs:214-216`, enforced
`:250-252, 294-295`); `scratchpad.entry.body` 8,192 hard (`coordination-store.mjs:484`,
enforced `:649-651` — gains the Decision-3 coaching shape). Substrate class: the six scanner
windows `scanner.window.decision` 8,192 / `scanner.window.scratchpad` /
`scanner.window.context_read` / `scanner.window.message_send` / `scanner.window.board_claim`
/ `scanner.window.board_report` 20,480 (`claude-session.mjs:27-38`), `wire.frame` 1MiB
(`:19`), `credential.file` 16KiB (`:250`), `context_pack.body` 8,192
(`coordination-store.mjs:487`), `spill.body` 1MiB (Decision 4 — the one substrate row with a
`refusalCode`). `board.report.body` carries NO admission row in v1: it is declared
substrate-bounded by `scanner.window.board_report` (Decision 2, blocker 8). View class:
`MAX_BOARD_VIEW_BYTES` 256KiB, `MAX_BOARD_ITEMS` 512, `MAX_REPL_VIEW_BYTES` 256KiB,
`MAX_SCRATCHPAD_VIEW_BYTES` 32,768, `MAX_SCRATCHPAD_VIEW_ITEMS` 64,
`MAX_SCRATCHPAD_VIEW_CACHE_KEYS` 256, `MAX_PROFILE_BYTES` 256KiB, `MAX_RUN_VIEW_BYTES`
512KiB, `MAX_REVIEW_SOURCE_BYTES` 4MiB, `MAX_ATTENTION_TEXT_BYTES` 4,096 (one registry value
subsuming `application.mjs:53` and the `messages.mjs:424` duplicate),
`MAX_BLOCKED_INTERACTION_SUMMARY_BYTES` 160 (`application.mjs:39-74`), knowledge slice
8/2,048 (`coordinator.mjs:10147`), context-read items 8/64 (`coordinator.mjs:10427`),
`inspectCapturedFile` 4MiB (`coordinator.mjs:4610`).

**B. Refusal coaching (one row per admission lane).** For each: drive an oversize input;
assert the typed refusal's PAYLOAD carries `{cap, actual, unit: 'bytes', gracefulPath}` AND
its message names both numbers; assert the worker-lane refusals land on the durable stream as
`message.rejected` (`coordinator.mjs:11835-11840`). Includes the previously-silent cases:
`run.objective` (replacing `application_intent_invalid` with no number,
`application.mjs:1406`) and `message.send.body` (replacing the bare TypeError,
`coordinator.mjs:6609-6610`). **De-tautologized (fold, blocker 10):** at least one HARDCODED
golden refusal string per refusal class is pinned verbatim in the suite — a value change or a
helper-wording change fails the golden row until someone deliberately edits it;
helper-composed exact-text pins (Decision 9) cover the remaining lanes. Every row also
asserts the refusal carries numbers only, never body content (Decision 3's pin).

**C. Spillover round-trip (message bodies + run objectives FIRST).** Oversize send → admitted;
receipt carries `{bytes, digest, spill}`; `materializeSpill(spill)` returns byte-identical
full body; inline head ≤ cap and ends on a UTF-8 scalar boundary (`messages.mjs:436-445`);
readers' projections show full text with no citation visible. Same row for `run.objective`,
for the reply lane (parity, Decision 6), and for an oversize WAVE-MEMBER objective (the
driver advisory passes it through — Open question 5, resolved). Idempotent re-drive replays
the same `spill:sha256:` id (the `_byKey` pattern, `coordination-store.mjs:13068-13075`).
**Worker-frame row (fold, blocker 4):** for a spilled orchestrator→worker send, the
provider-bound frame carries EXACTLY head + `{spilled: true, bytes, digest, spill}` — NEVER
the full materialized body (that reading voids the cap) — and the worker's
`CONTEXT_READ {kind: 'spill', spill}` resolution returns the byte-identical body,
UNTRUSTED-framed through `_renderContextRead` (head-only-with-no-resolution fails this row).
**Ceiling row (fold, blocker 3):** a body beyond `spill.body` (1 MiB) is NOT admitted and
mints NO spill — it draws the hard coaching refusal `spill_body_exceeded` carrying
`{cap: 1048576, actual, unit: 'bytes', gracefulPath}`.

**D. Scanner posture (one row per grammar — SIX).** Large-but-parseable payload admitted
shape-only for `DECISION_REQUEST`, `SCRATCHPAD_WRITE`, `CONTEXT_READ`, `BOARD_CLAIM`, and
`BOARD_REPORT` (C0b already pins `MESSAGE_SEND`, `bidirectional-v3-red.test.mjs:452-454`).
Plus the split row: an oversize-question `DECISION_REQUEST` is NOT scanner-null — it reaches
admission and draws the typed refusal carrying the COACHING payload (`{cap, actual, unit,
gracefulPath}`, not merely `malformed_request` strings) at the decision seam
(`coordinator.mjs:11974-11989`), closing the ground-truth-5 leak.

**E. Doctor surfacing.** `doctorReadiness()` and `deployment.doctor` carry the `limits`
projection with the registry digest and every lane row; `card()` publishes
`limitsRegistryDigest`; the handshake rejects a digest mismatch (the
`application-cli.mjs:1965-1978` pattern, digest check at `:1970`); `baton doctor --check`
evidence depth prints the lane table and outline stays concise. **Digest stability under
override (fold, blocker 5):** injecting a `_reuseDecisionPolicy` override (changing the
EFFECTIVE `decision.need` / `decision.rationale` values) leaves the published
`limitsRegistryDigest` byte-identical and the handshake green — the digest covers declared
rows only; the projection's per-lane `effective` field carries the override.

**F. Single-source pin.** A static suite row scans `impl/src/` for the registry's VALUE SET
across spellings — `2048`, `2_048`, `0x800`, `2 * 1024`, and kin for every cataloged value —
outside `limits.mjs`, the substrate/view constants it deliberately re-exports, and the NAMED
deliberate-local list (Decision 2's store enumeration); it also greps hand-typed byte prose
(`<=\d+ bytes`, `limit \d+`) outside `limits.mjs`; any hit fails the row. `wave-driver.mjs:27`
and `coordinator.mjs:6609` are the first two literals this row retires; the store's lane
literals (`coordination-store.mjs:3471, 484, 487, 414-415`) retire with them.

## Open questions — fold verdicts

1. **Spill lifecycle — DEFERRED, unblocked by the spill ceiling (blocker 3).** What reaps a
   spill artifact when its referencing message/run goes terminal — a `reapRunSpills(runId)`
   sibling of `reapRunScratchpads`, or reference-counted reaping at message settlement — is a
   legitimate follow-up either way. With `spill.body` 1 MiB, per-spill bytes are bounded and
   durable-log growth is the same asymptotic class as today's full-body `message.delivered`
   payloads, so v1 ships without reaping. (Context packs have `reapExpiredContextPacks`,
   `coordination-store.mjs:13098-13101`, but spill has no expiry by design.) WITHOUT the
   ceiling this question was fold-blocking — an unbounded, never-reaped durable section is
   minting garbage by design; the ceiling is what makes deferral honest.
2. **`boundedAttentionText` drops the truncated flag — FOLDED (fixed in this epic).**
   `messages.mjs:449-455` returns `capBytes(...).text` and discards `truncated`, inside the
   BD3-A rows (`coordinator.mjs:10433-10440`) — silent truncation in the renderer that
   inspired this epic's graceful class: same sin class, one marker + one suite row, nearly
   free. The marker precedent exists (`[briefing truncated]`, `messages.mjs:533`); the typed
   truncation-marker sibling prior art is `board_oversize_item`
   (`coordination-store.mjs:14845-14851`).
3. **`decision.question` graceful or hard — DEFERRED: declared hard in v1.** A question is
   interactive — the orchestrator must read it to answer — so the declared hard bound with a
   coaching refusal is coherent; promoting to `spill-digest-citation` later is additive (one
   registry row's `graceful` flips, plus one suite row).
4. **Ceiling-of-ceilings for deployment-injected ceilings — RESOLVED in the fold (blocker
   6).** The ceiling already existed, hidden: the store's hardcoded need 2,048 / rationale
   8,192 (`coordination-store.mjs:3471`) silently floored every deployment override. The
   registry now declares those values as the `decision.need` / `decision.rationale` defaults
   AND the ceiling-of-ceilings; a deployment override above the registry value REFUSES AT
   INJECTION with a typed error naming the ceiling and the attempted value — the provider-read
   precedent (deployment ceilings capped by hard ceilings, `maxBytes > 16 * 1024 * 1024` at
   `coordinator.mjs:885`) — never a silent `min()` (Decision 1(d)).
5. **Wave-driver precheck retention — RESOLVED in the fold (blocker 9): downgraded to a
   spill-aware advisory.** The precheck (`wave-driver.mjs:304-312`) today REFUSES oversize at
   4,096 before the machinery ever sees it — a wall in front of a spill lane, recreating for
   wave members the exact asymmetry the epic deletes elsewhere (direct `run.start` spills). In
   v1 the driver reads the same registry row and, on oversize, emits the early-ergonomics
   advisory (naming the bytes and the coming spill) but PASSES the objective through: the
   machinery admits and spills exactly like `run.objective`, pinned by the oversize-wave-member
   row in Acceptance C. (Deleting the precheck was the alternative; the advisory keeps the
   driver's error-quality value without the refusal.)
