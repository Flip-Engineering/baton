# Issue #89 — Frame-economics contract (v1.0)

Status: implementation contract. This specifies behavior; it does not amend implementation in
this artifact. Structure mirrors the L2 contracts of
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
`impl/src/wave-driver.mjs:304-311`). Refs: #86 (the exchange that spawned this), #10 (AX spine
— error quality is its item 5), #88.

## Code-verified ground truth

The anchors below were checked in this worktree with NUL-safe `grep -an` searches and targeted
`sed -n` reads on 2026-08-03. `impl/src/coordinator.mjs` contains NUL bytes and was never read
whole.

1. **The send-lane sin.** `sendMessage` validates
   `Buffer.byteLength(body) > 2_048` and throws
   `new TypeError('message body is required (non-empty, <=2048 bytes)')`
   (`impl/src/coordinator.mjs:6582-6583`). The cap appears in prose, the actual size does not,
   there is no payload carrying either number, and there is no spillover path. The lane's doc
   comment promises durable-stream receipts (`coordinator.mjs:6572-6576`).

2. **The reply lane has no body bound.** The `message.send` admission case checks only that
   `frameBody` is a non-empty string (`coordinator.mjs:11610-11613`). Its refusal helper
   `refuse(reason, extra)` appends `message.rejected` with payload `{reason, inReplyTo,
   ...extra}` (`coordinator.mjs:11604-11609`) — the spread seam a coaching payload needs
   already exists. Existing reasons: `message_frame_invalid`, `message_target_caller_named`,
   `message_parent_not_found`, `message_depth_exceeded` (`coordinator.mjs:11610-11628`).
   Delivered replies mint `message:<digest>` ids and append `message.delivered`
   (`coordinator.mjs:11631-11647`).

3. **The BD3-A oversize pattern (the model to generalize).** `_renderContextRead` is the
   closed read-port renderer: bounded per kind (`maxItems` 8 for knowledge, 64 otherwise),
   every model-authored leaf UNTRUSTED-framed, and an oversize result degrades to
   `{truncated: true, digest: canonicalDigest(sorted ids)}` — a digest citation, never raw
   overflow (`coordinator.mjs:10349-10384`; citation at `:10376-10379`). The delivered frame
   and the `context.read_result` receipt share the SAME rendered object
   (`coordinator.mjs:10349-10352`), and the doctrine comment declares this renderer the ONLY
   path (`coordinator.mjs:10231-10235`). `canonicalDigest` is the sha256-of-canonical-JSON
   helper (`coordinator.mjs:302`).

4. **The scanner posture and its pin.** All four grammars scan assistant text only, with byte
   scan windows as resource guards: `DECISION_REQUEST` 8,192 (`impl/src/claude-session.mjs:27-28`),
   `SCRATCHPAD_WRITE` 20,480 (`:29-30`), `CONTEXT_READ` 20,480 (`:31-32`), `MESSAGE_SEND`
   20,480 (`:33-34`); `extractFirstBalancedJsonObject` returns `null` over the window
   (`:40-41`). The `MESSAGE_SEND` doc comment ALREADY carries the shape-only law: "The body is
   shape-checked only (non-empty string): the 20,480-byte scan window is the parser's resource
   guard; any frame-economics policy belongs at admission with a graceful spillover path,
   never as a silent wire cap" (`claude-session.mjs:131-138`). The other three doc comments
   carry the weaker "malformed = prose" posture only (`:64-69`, `:90-91`, `:109-112`). The C0b
   row pins a 2,049-byte body ADMITTED shape-only with the campaign-law comment
   (`impl/test/bidirectional-v3-red.test.mjs:434-458`; PIN comment `:450-455`).

5. **The decision-question leak (a live wire-level cap).** `createDecisionRequest` enforces
   `MAX_DECISION_QUESTION_BYTES = 2_048` via `boundedNonEmpty` (`impl/src/messages.mjs:197,
   202-204, 213-214`) and raises `ValidationError`. The scanner swallows `ValidationError` to
   `null` (`claude-session.mjs:82-87`) — so an oversize question never reaches the admission
   refusal at `coordinator.mjs:11742-11757` (`control.malformed_interaction_rejected` +
   `authority.rejected {reason:'malformed_request'}`); the worker believes it asked and nothing
   arrives. This is position-1's silent data loss, shipping today. Sibling factories carry the
   same pattern: option label/summary (`messages.mjs:234-235`), decision text (`:278`), board
   title/detail (`:318-319`), board report body (`:362`).

6. **The run-objective class.** Run intent validates `validText(value.objective)` whose
   default ceiling is 4,096 BYTES (`impl/src/application.mjs:289-290, 1380`) and throws
   `applicationError('run intent is invalid', 'application_intent_invalid')`
   (`application.mjs:1383`) — no cap, no actual. The empty-objective client error is
   `'Run objective is required'` (`impl/src/application-client.mjs:113`). Wave members are
   checked in CHARACTERS (`member.objective.length > 4096`, `application.mjs:1831-1832`) — a
   byte/char inconsistency for the same logical lane. The wave driver works around the silence
   with `OBJECTIVE_MAX_BYTES = 4096` and a precheck error naming bytes and limit, code
   `wave_driver_objective_oversize` (`impl/src/wave-driver.mjs:27, 304-311`), receipted at
   `docs/37-wave-driver.md:90-94`.

7. **Other admission-side caps.** Orientation push note ≤2,048, bare TypeError 'orientation
   push note is invalid' (`coordinator.mjs:6866`); its internal scope-refresh caller already
   degrades gracefully by shrinking the observed path until the note fits
   (`coordinator.mjs:8435-8440`). Steering policy focus ≤2,048 (`coordinator.mjs:990`). Reuse
   decision need/rationale ceilings are DEPLOYMENT-INJECTED
   (`_reuseDecisionPolicy.maxNeedBytes/maxRationaleBytes`, `coordinator.mjs:941-946`) and
   applied through `normalizedDecisionText` (`coordinator.mjs:507-508, 9952-9953`).

8. **View-side ceilings already degrade gracefully with a flag — the precedent class.** Board
   view sheds trailing items and re-flags until under `MAX_BOARD_VIEW_BYTES` "never silent"
   (`application.mjs:60, 529-530`); same shape for REPL (`:64, 572-573`) and scratchpad
   (`:66, 691`; `MAX_SCRATCHPAD_VIEW_BYTES = 32_768` is an EXPORTED constant — the export
   precedent). Attention text truncates with an ellipsis marker (`application.mjs:53,
   305-306`), blocked-interaction summaries at 160 (`:54, 339-341`). Knowledge slices break at
   the byte boundary (`messages.mjs:500, 525-526`; served with defaults maxFindings 8 /
   maxBytes 2,048 at `coordinator.mjs:10101, 10113`). Remaining view ceilings:
   `MAX_PROFILE_BYTES` 256KiB (`application.mjs:39`), `MAX_RUN_VIEW_BYTES` 512KiB (`:49`),
   `MAX_REVIEW_SOURCE_BYTES` 4MiB (`:74`), `inspectCapturedFile` 4MiB
   (`coordinator.mjs:4583, 4593`). NOTE: `boundedAttentionText` caps text but DROPS
   `capBytes`'s `truncated` flag (`messages.mjs:419-430, 432-438`) — silent truncation inside
   the BD3-A renderer's rows (`coordinator.mjs:10365-10372`); see Open questions.

9. **Substrate guards (not policy).** `DEFAULT_MAX_WIRE_FRAME_BYTES` 1MiB
   (`claude-session.mjs:19`), configured at `:402-403` and enforced on the transport
   (`:849, 893, 918`); `CREDENTIAL_MAX_BYTES` 16KiB (`:188, 253, 267`); context-pack bodies
   ≤8,192 (`impl/src/coordination-store.mjs:442, 12926`).

10. **The artifact machinery — and why none of it fits spillover verbatim.**
    `registerArtifact` is idempotent by auth key (`coordination-store.mjs:12437-12443`) but
    `_prepareArtifact` requires a known task (`:12458-12459`) and `accepted` requires a
    COMPLETED task plus hub-verification provenance (`:12471-12484`) — task-terminal work
    product, the wrong lifecycle for a message body or run objective. `artifact(id)` is the
    digest reader (`:12540`). Worktree capture reads commit files by sha
    (`coordinator.mjs:4583-4593`) — VCS-bound, and a message has no commit. The closest model
    is the context-pack section: digest-addressed `context-pack:<canonicalDigest(...)>` ids
    (`coordination-store.mjs:12941-12944`), idempotent mint on the event log
    (`:12950-12961`), head tracking (`:12967-12971`), and a materialize read that serves the
    body (`:12973-12980`) — but packs carry family-head chaining, validity expiry
    (`:12921-12948, 12976-12978`), reaping (`:12982-12989`), and the 8,192 body cap
    (`:442`) — all wrong for spill, which must out-cap the inline lane and live exactly as
    long as its referencing receipt.

11. **The doctor surfaces.** `doctorReadiness()` returns a frozen `{schemaVersion: 1, repoId,
    routes, workspace}` (`application.mjs:11931-11939`); `deployment.doctor` is the MCP
    quota-free readiness port (`application.mjs:12029`). The CLI parses
    `baton doctor [--check] [depth]` with depths `outline|connection|profile|evidence`
    (`impl/src/application-cli.mjs:1253-1259`). The connection handshake already verifies a
    registry digest — `doctor.application.agentExperience.registryDigest ===
    APPLICATION_SEMANTIC_REGISTRY.digest` (`application-cli.mjs:1965-1975`) — and `card()`
    publishes `agentExperience.{registryVersion, registryDigest}`
    (`application.mjs:11946-11948`). A second, static, digest-able registry slots into
    machinery that already exists.

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
`FRAME_LIMITS_VERSION` and `FRAME_LIMITS_DIGEST` (sha256 of the canonical serialization, the
same derivation as `canonicalDigest`, `coordinator.mjs:302`). Every consumer imports it:
admission validation (`coordinator.mjs`, `application.mjs`, `wave-driver.mjs`), refusal text
builders, the CLI/doctor projections, and the scanner module's doc posture.

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
`_reuseDecisionPolicy.maxNeedBytes/maxRationaleBytes` (`coordinator.mjs:941-946`) — becomes a
registry CONSUMER: the registry declares the lane, unit, class, and default; the deployment
override is validated against the registry row at injection, and doctor reports the EFFECTIVE
value (Decision 7).

### 2. The registry row schema, the byte law, and three classes

Every row: `{lane, class, bound, value, unit, graceful, enforcedAt, refusalCode}`.

- `lane` — dotted, stable: `message.send.body`, `message.reply.body`, `run.objective`,
  `wave.member.objective`, `decision.question`, `decision.need`, `decision.rationale`,
  `orientation.note`, `steering.focus`, `board.title`, `board.detail`, `board.report.body`,
  `decision.option.label`, `decision.option.summary`, `decision.text`, plus the substrate and
  view lanes cataloged in Acceptance.
- `class` — `admission` | `substrate` | `view`.
- `value` + `unit` — **the byte law: every admission bound is measured in UTF-8 BYTES via
  `Buffer.byteLength`**, never `.length`. This fixes the wave-member character check
  (`application.mjs:1831-1832`) and aligns with the existing send-lane and validText checks
  (`coordinator.mjs:6582`; `application.mjs:289-290`).
- `graceful` — `spill-digest-citation` (message bodies, run/wave objectives in v1),
  `shed-flagged` (view lanes, the existing precedent of ground truth 8), or `null` (hard
  bound — the refusal itself is the surface; see Open questions for `decision.question`).
- `enforcedAt` / `refusalCode` — name the seam and the typed code, so refusal text and doctor
  output cite the lane by name rather than embedding magic constants.

Substrate rows (`scanner.window.decision` 8,192; `scanner.window.scratchpad`,
`scanner.window.context_read`, `scanner.window.message_send` 20,480; `wire.frame` 1MiB;
`credential.file` 16KiB; `context_pack.body` 8,192 — ground truth 4, 9) are DECLARED in the
registry with `class: 'substrate'` so doctor shows the real de-facto input bounds — but they
mint no refusals and carry no `graceful`; they are resource guards, per position 4. View rows
(ground truth 8) are declared with `class: 'view'`, `graceful: 'shed-flagged'`.

### 3. The coaching refusal shape: `{cap, actual, unit, gracefulPath}` in payload AND message

Every size refusal on an admission lane carries BOTH:

- a structured payload `{reason|code, cap, actual, unit: 'bytes', gracefulPath}` — for the
  message lane, spread through the existing `refuse(reason, extra)` seam into
  `message.rejected` on the worker's durable stream (`coordinator.mjs:11604-11609`); for the
  application/driver lanes, on the typed error (`applicationError` /
  `wave_driver_objective_oversize` shape);
- a human message naming BOTH numbers: e.g.
  `message body is 2611 bytes (cap 2048); over-cap bodies spill to a durable artifact — resend with a digest-citable head`
  — never the bare `'message body is required (non-empty, <=2048 bytes)'`
  (`coordinator.mjs:6583`), never `'run intent is invalid'` with no number
  (`application.mjs:1383`).

The wave-driver precheck (`wave-driver.mjs:304-311`) is the behavioral floor — it already
names bytes and limit — and is generalized, not duplicated: its constant moves to the
registry and its text gains the graceful path. When a lane is graceful, oversize does NOT
refuse at all (Decision 4); the coaching payload shape governs the hard-bound lanes and any
spill-failure path (e.g. store unavailable), where `gracefulPath` says what the caller should
do instead.

### 4. The spillover lane: a NEW coordination-store section, message bodies + run objectives first

Oversize on a `graceful: 'spill-digest-citation'` lane is ADMITTED with spill, never refused:

1. The admission seam mints a **spill artifact** in a new store section — digest-addressed
   `spill:sha256:<digest>` (mirroring the `art:sha256:` handle convention,
   `coordinator.mjs:514-518`), appended as a durable event (`payload.spilled`), idempotent by
   auth key, with a `materializeSpill(handle)` read that serves the full body — the
   context-pack machinery's shape (`coordination-store.mjs:12941-12980`) minus family-head
   chaining, expiry, and the 8,192 cap (ground truth 10).
2. The lane carries inline: the UTF-8-safe head (first `cap` bytes via the existing
   `capBytes`, `messages.mjs:419-430`) plus the citation fields
   `{spilled: true, bytes, digest, spill}`.
3. Receipts carry the digest: `message.sent` / `message.delivered` and the coordinator's
   `messageReceipt` record `{body: head, bytes, digest, spill}`; a run intent stores
   `objective` head + citation with the digest riding the intent record.
4. Readers resolve transparently: message views, run views, and CLI/MCP projections call
   `materializeSpill` before display, so a routine reader never sees the citation — the same
   rendered-object-for-receipt-and-delivery doctrine as BD3-A (`coordinator.mjs:10349-10352`).

**Artifact home rationale.** The coordination store — not the worktree, not task artifacts,
not context packs verbatim. Worktree capture is commit-sha-bound task work product
(`coordinator.mjs:4583-4593`): a message body has no commit, and coupling messaging to VCS
leaks into worker-visible work. `registerArtifact`'s gates are task-terminal and
provenance-bearing (`coordination-store.mjs:12458-12484`) — semantically wrong for an
admission-time payload. Context packs are the right MACHINERY (digest-addressed, idempotent,
durable, replay-safe — exactly the properties re-drive needs) but the wrong semantics
(expiry under a live message is data loss; head chaining is meaningless here; 8,192 would cap
spill below the payloads it exists to serve). A spill artifact lives exactly as long as its
referencing receipt; reaping is an Open question, not guessed here.

**Why the store and not "inline anyway":** position 1 forbids silent loss and position 3
forbids the bare wall; the store event log is the durable, replay-visible home both
satisfy.

### 5. Scanner posture PIN: shape-only forever, all four grammars, one suite row each

- The shape-only law sentence (already shipped for `MESSAGE_SEND`, `claude-session.mjs:131-138`)
  is extended verbatim-adapted to the `DECISION_REQUEST`, `SCRATCHPAD_WRITE`, and
  `CONTEXT_READ` doc comments (`:64-69`, `:90-91`, `:109-112`): the scan window is the
  parser's resource guard; size policy lives at admission; `null` means prose.
- One red-first suite row PER GRAMMAR pins a large-but-parseable payload ADMITTED
  shape-only — C0b is the `MESSAGE_SEND` row (`bidirectional-v3-red.test.mjs:434-458`); the
  other three rows are added beside it.
- **The decision-question split (the consequence that makes this honest):**
  `createDecisionRequest`'s size check (`messages.mjs:213-214`) is separated from shape
  validation — the scanner path validates shape only, so an oversize question PARSES and
  travels; the admission seam (`coordinator.mjs:11742-11757`) applies the registry bound and
  issues the typed, coaching refusal (Decision 3) instead of today's scanner-`null` silence
  (ground truth 5). The `ValidationError` errors list gains the actual byte count. The same
  split applies wherever a shape factory doubles as a size gate on a scanner path.

### 6. Reply-lane parity

The reply direction of the message lane gains the registry's `message.reply.body` row —
declared at the same 2,048 bytes as `message.send.body` in v1 (one lane, one economy;
retuning is a Non-goal) — enforced at the existing admission case
(`coordinator.mjs:11610-11613`) with spill per Decision 4, so an oversize reply degrades to
head + digest citation on `message.delivered` exactly like an oversize send. This deletes the
asymmetry the issue names: today send is capped with a bare TypeError and reply is uncapped
(ground truth 1, 2).

### 7. Doctor surfacing: orchestrators READ the bounds before composing

- `doctorReadiness()` gains a frozen `limits` projection:
  `{version: FRAME_LIMITS_VERSION, digest: FRAME_LIMITS_DIGEST, lanes: [{lane, class, bound,
  value, unit, graceful}]}` — effective values where a deployment override exists
  (`decision.need` / `decision.rationale`, `coordinator.mjs:941-946`)
  (`application.mjs:11931-11939`).
- `card()` publishes `agentExperience.limitsRegistryDigest` beside the existing
  `registryDigest` (`application.mjs:11946-11948`), and the connection handshake verifies it
  exactly as it verifies the semantic registry's (`application-cli.mjs:1965-1975`).
- `baton doctor --check` at `evidence` depth prints the lane table (name, class, bound,
  graceful); `outline` depth stays concise per the doctor-depth cascade and names only the
  registry digest (`application-cli.mjs:1253-1259`).
- MCP parity: `deployment.doctor` returns the same projection (`application.mjs:12029`).

### 8. Consolidation, not re-shaping, for substrate and view classes

No substrate guard and no view ceiling changes VALUE or behavior in this epic. They are moved
into the registry as declarations (Decision 2) so there is exactly one place that knows every
number; the shed-flagged view loops (`application.mjs:529-530, 572-573, 691`), the ellipsis
truncation markers (`:305-306, 339-341`), the knowledge-slice break (`messages.mjs:525-526`),
and the wire/credential guards (`claude-session.mjs:849, 893, 918, 253, 267`) keep their
verified behavior. The registry is the only source: no module re-declares a byte literal for
a cataloged lane (pinned in Acceptance).

### 9. Refusal-text provenance

Refusal strings are COMPOSED from the registry row (lane name, value, unit, gracefulPath) by
one helper in `limits.mjs` — so the suite pins text against the registry, and a future value
change updates refusals, doctor output, and tests in one move. No refusal embeds a hand-typed
number (the `'<=2048 bytes'` prose at `coordinator.mjs:6583` and the `<=${MAX} bytes` pattern
at `messages.mjs:214` both become helper output).

## Non-goals

- **Retuning any cap value.** This epic names, consolidates, coaches, and spills; it does not
  relitigate 2,048 / 4,096 / 20,480.
- **Spill beyond the two first lanes.** Decision-question text, reuse need/rationale, board
  bodies, orientation notes keep hard bounds with coaching refusals in v1; promoting any of
  them to `spill-digest-citation` is a follow-up per lane.
- **A wire-level content cap of any kind.** Explicitly rejected by position 1; the scan
  windows stay resource guards and shrink nothing.
- **Spill reaping / TTL policy.** Needs its own lifecycle decision (Open questions).
- **Turn limits, TTLs, or clock windows as enforcement** — the campaign control law
  (controls are eval-able, constructive, or conversational) binds here as it did in #78.
- **Migrating historical messages/objectives.** The registry and spill apply at admission;
  stored records are untouched.

## Red-first acceptance

Suite placement: the scanner/message-lane rows extend `impl/test/bidirectional-v3-red.test.mjs`
beside C0/C0b (`:414-458`); the registry, spill, refusal-text, and doctor rows mint
`impl/test/frame-economics-red.test.mjs` (per-feature suite precedent:
`impl/test/wave-driver-policy-red.test.mjs`, cited at `docs/37-wave-driver.md:96`).

**A. Registry pins.** `limits.mjs` exports one frozen `FRAME_LIMITS`; EVERY cataloged lane
below is present with `{lane, class, bound, value, unit, graceful}`; `FRAME_LIMITS_DIGEST` is
byte-stable across processes. Catalog — admission class: `message.send.body` 2,048 spill;
`message.reply.body` 2,048 spill; `run.objective` 4,096 spill; `wave.member.objective` 4,096
spill; `decision.question` 2,048 hard (Open question); `decision.need` / `decision.rationale`
deployment-default hard; `orientation.note` 2,048 hard; `steering.focus` 2,048 hard;
`board.title` / `board.detail` / `board.report.body` (values as in `messages.mjs:318-319, 362`)
hard; `decision.option.label` / `decision.option.summary` / `decision.text`
(`messages.mjs:234-235, 278`) hard. Substrate class: the four scanner windows 8,192/20,480
(`claude-session.mjs:28-34`), `wire.frame` 1MiB (`:19`), `credential.file` 16KiB (`:188`),
`context_pack.body` 8,192 (`coordination-store.mjs:442`). View class: `MAX_BOARD_VIEW_BYTES`,
`MAX_REPL_VIEW_BYTES` 256KiB, `MAX_SCRATCHPAD_VIEW_BYTES` 32,768, `MAX_PROFILE_BYTES` 256KiB,
`MAX_RUN_VIEW_BYTES` 512KiB, `MAX_REVIEW_SOURCE_BYTES` 4MiB, `MAX_ATTENTION_TEXT_BYTES` 4,096,
`MAX_BLOCKED_INTERACTION_SUMMARY_BYTES` 160 (`application.mjs:39-74`), knowledge slice 8/2,048
(`coordinator.mjs:10101`), context-read items 8/64 (`coordinator.mjs:10359`),
`inspectCapturedFile` 4MiB (`coordinator.mjs:4583`).

**B. Refusal coaching (one row per admission lane).** For each: drive an oversize input;
assert the typed refusal's PAYLOAD carries `{cap, actual, unit: 'bytes', gracefulPath}` AND
its message names both numbers (exact-text pins composed by the Decision-9 helper); assert
the worker-lane refusals land on the durable stream as `message.rejected`
(`coordinator.mjs:11604-11609`). Includes the previously-silent cases: `run.objective`
(replacing `application_intent_invalid` with no number, `application.mjs:1383`) and
`message.send.body` (replacing the bare TypeError, `coordinator.mjs:6582-6583`).

**C. Spillover round-trip (message bodies + run objectives FIRST).** Oversize send → admitted;
receipt carries `{bytes, digest, spill}`; `materializeSpill(spill)` returns byte-identical
full body; inline head ≤ cap and ends on a UTF-8 scalar boundary (`messages.mjs:419-430`);
readers' projections show full text with no citation visible. Same row for `run.objective`
and for the reply lane (parity, Decision 6). Idempotent re-drive replays the same
`spill:sha256:` id (the `_byKey` pattern, `coordination-store.mjs:12952-12959`).

**D. Scanner posture (one row per grammar).** Large-but-parseable payload admitted
shape-only for `DECISION_REQUEST`, `SCRATCHPAD_WRITE`, `CONTEXT_READ` (C0b already pins
`MESSAGE_SEND`, `bidirectional-v3-red.test.mjs:456-458`). Plus the split row: an
oversize-question `DECISION_REQUEST` is NOT scanner-null — it reaches admission and draws the
typed coaching refusal (`coordinator.mjs:11742-11757`), closing the ground-truth-5 leak.

**E. Doctor surfacing.** `doctorReadiness()` and `deployment.doctor` carry the `limits`
projection with the registry digest and every lane row; `card()` publishes
`limitsRegistryDigest`; the handshake rejects a digest mismatch (`application-cli.mjs:1970`
pattern); `baton doctor --check` evidence depth prints the lane table and outline stays
concise.

**F. Single-source pin.** A static suite row greps `impl/src/` for re-declared byte literals
on cataloged lanes (the `2_048`/`4_096` class outside `limits.mjs` and the substrate/view
constants it deliberately re-exports) and fails on drift; `wave-driver.mjs:27` and
`coordinator.mjs:6582` are the first two literals this row retires.

## Open questions

1. **Spill lifecycle.** What reaps a spill artifact when its referencing message/run goes
   terminal — a `reapRunSpills(runId)` sibling of `reapRunScratchpads`, or reference-counted
   reaping at message settlement? Context packs have `reapExpiredContextPacks`
   (`coordination-store.mjs:12982-12989`) but spill has no expiry; guessing here would mint
   either garbage or data loss.
2. **`boundedAttentionText` drops the truncated flag** (`messages.mjs:432-438`) inside BD3-A
   rows (`coordinator.mjs:10365-10372`) — silent truncation in the renderer that inspired this
   epic's graceful class. Fix here (add the marker, as `renderBriefing` does at
   `messages.mjs:446-465`) or file a sibling issue?
3. **`decision.question` graceful or hard?** A question is interactive — the orchestrator must
   read it to answer — so spilling may be wrong; this contract declares it `graceful: null`
   with a coaching refusal, but the operator may want spill parity with messages.
4. **Effective-value reporting for deployment-injected ceilings**
   (`_reuseDecisionPolicy`, `coordinator.mjs:941-946`): the registry carries defaults, the
   deployment overrides, doctor reports effective — but should the OVERRIDE also be bounded by
   a registry-declared ceiling-of-ceilings (as provider reads are, `coordinator.mjs:873-875`)?
5. **Wave-driver precheck retention.** With registry-sourced coaching at the machinery seam,
   the driver precheck (`wave-driver.mjs:304-311`) becomes a courtesy duplicate; keep it as an
   early-ergonomics layer reading the same registry row, or delete it once the machinery
   coaches?
