# CONTRACT — member-lanes (package ⑤ collaboration) — #206 · #205 · #174

[attempt: b5ea1fae-f410-442d-8cc2-f66154efc193 row-member-lanes]

- **Row:** `row-member-lanes` — issue set **#206** (member message origination — the members
  have NO reachable working message path) + **#205** (decision ledgering — the first answered
  DECISION_REQUEST left zero store events; `decision.requested`/`decision.settled`/
  `decision.deferred` as durable kinds) + **#174** (member-side sibling visibility —
  coordinators verdict-blind, three incidents).
- **Verification HEAD:** `09200e97c1be113946459d901c8fab56034d8a1f` (this worktree's base).
  Every citation below was re-verified this session with `grep -an`/`sed -n` on
  `application.mjs` + `coordination-store.mjs` (NUL discipline — both files measure exactly
  **3 NUL bytes** each this session, `LC_ALL=C tr -d -c '\000' | wc -c`; never read whole) and
  plain `grep` elsewhere. The live coordination store was scanned this session (GT-8); the
  #158 red suite was re-run at this HEAD (§5); the resident web bus was probed (§5, recorded
  with its limits).
- **Form:** Ring-2 — ground truths → decisions → closed refusal vocabulary → red-first
  acceptance pins at named stages → open questions. No clocks anywhere in the pins (ordering
  is event/seq-anchored). Sorted-key literals in ACTUAL byte order.

## 0. What this contract is (and is not)

The member-facing lane surface as ONE contract: the lanes a MEMBER (a wave-spawned worker
seat) can use to (a) originate a message to its coordinator or siblings (#206), (b) have its
decision round-trip ledgered durably (#205), and (c) observe sibling member state without
walking worktrees (#174). It does NOT re-specify: the message lane's delivery economics
(#105, folded), the reply chain (BD3-C, folded and PROVEN — lane-messages seq 75985), the
doubt lane (#66 — `row-federation-doubt` binds it), the context-injection lane (#195 —
`row-context-lanes`), or the scratchpad append verb (#158 — its own red suite,
`impl/test/scratchpad-write-red.test.mjs`, re-run this session as publish evidence, §5).

**The one-sentence scope:** the three lanes already exist as code at HEAD; what is missing is
(a) member REACHABILITY (web admission + dispatch for `run.message.send`), (b) origination
TRUTH (`from` is hardcoded `'orchestrator'`), and (c) DURABILITY of exactly three decision
kinds and one member-terminal kind — this contract closes those four gaps additively and adds
ZERO new refusal codes.

## 1. Ground truths (code-verified this session)

**GT-1 — `run.message.send` is a complete embedded direct port with a closed normalizer, and
is deliberately absent from the byte-stable command table.** Pre-gate dispatch:
`if (name === 'run.message.send') return this.messageSend(args, principal);`
(application.mjs:12651) — dispatched BEFORE `normalizeCommandContext` and the recursive gate,
like its seven sibling workflow-surface verbs (:12651-12658). `messageSend` normalizes through
`_normalizeMessageSend` (closed key set `['runId', 'workerId', 'kind', 'body', 'budget']`,
exactly-one-target law, `application_message_send_invalid`, application.mjs:12968-12988),
authorizes steer-idiom (`this._authorize('run.message.send', principal, resolvedRunId,
{kind, targetKind, bodyDigest})`, application.mjs:13178-13182 — an unresolvable worker
authorizes against the null scope so UNKNOWN ≡ FOREIGN), then delegates to
`coordinator.sendMessage` with the lane outcome verbatim (application.mjs:13183-13190). The
verb is NOT an `APPLICATION_COMMAND_DEFINITIONS` key (the table spans application.mjs:170-209
and ends at `'application.shutdown'` at :208; the table's byte-stability law — grammar-m3-red
pins the key set — is stated in the comment at :212-215).

**GT-2 — the web bus refuses the verb at the capability table: `invalid_command`.** Web
admission is the four-table composition `COMMAND_CAPABILITY` (web-northbound.mjs:95-104):
the legacy literals + `WEB_APPLICATION_ENTRIES` (derived from definitions with `web: true`,
:15-19) + `CANONICAL_WEB_ENTRIES` (:20-23 — same filter, so it cannot rescue a
non-definition) + `WAVE_WEB_ENTRIES` (:37-55, the direct-port admission array that carries
`waves_*` and `run_scratchpad_append`). `run_message_send` appears in NONE of the four, so
`validateEnvelope` returns `'unsupported command'` at web-northbound.mjs:530
(`if (!Object.hasOwn(COMMAND_CAPABILITY, envelope.command)) return 'unsupported command';`),
which serves as `{ok:false,error:{code:'invalid_command',message:'unsupported command'}}` —
the lane-proof verbatim refusal (three kinds, one code). The semantic registry agrees it is
not a web verb: `surfaces: ['embedded', 'mcp', 'cli']` (application-semantics.mjs:1672).

**GT-3 — the CLI parses the verb but transports it over the SAME refused web envelope.**
`CLI_WEB_COMMANDS` includes `'run.message.send'` (application-cli.mjs:29-31) and the parser
resolves it into a command envelope (application-cli.mjs:1536-1545), but `command()` mangles the name
(`name.replaceAll('.', '_')`, application-cli.mjs:2125) and POSTs `/v1/commands`
(application-cli.mjs:2131) — the exact envelope of GT-2. The worktree handshake failure class
is `cli_transport_failed` "Baton Web connection failed; check your network and retry"
(application-cli.mjs:2034). So web and CLI share ONE root gap, not two.

**GT-4 — the MCP surface is the only code-complete path, and it is unreachable from member
seats in the campaign.** The tool `baton_run_message_send` is advertised with capabilities
`['control', 'observe']` (mcp-northbound.mjs:113, tool def :693-703), declared-arg validation
refuses `invalid_message_send` (mcp-northbound.mjs:1262-1270), and `_dispatch` routes to
`this.application.command('run.message.send', …)` (mcp-northbound.mjs:1987-1993) — the arm
exists at HEAD. The campaign evidence is environmental, and is recorded as such: the member
baton MCP (homecloud-collab) timed out at session start (lane-messages, lane-proof), and this
session's bounded probes of the resident web bus (unix socket
`/private/tmp/baton-501/4421cf2925043322-3be3b5213d39.sock`, 4 read-only attempts, ≤15 s)
connected but received ZERO bytes — the serve was concurrently driving this very wave, so
busy-vs-gated is indistinguishable from the seat (recorded, not smoothed). The contract's pins
are therefore code-anchored (GT-2/GT-3); the environmental refusals motivate, never pin.

**GT-5 — origination is MISATTRIBUTED at the mint: `from` is hardcoded `'orchestrator'`.**
`coordinator.sendMessage` accepts `auth` (application.mjs:13190 passes
`{ actor: principal.actor }`) but ignores it for identity: the in-memory record mints
`from: 'orchestrator'` (coordinator.mjs:7237) and the durable row mints
`from: 'orchestrator'` (coordinator.mjs:7246, inside `recordMessage('message.sent', {…
messageId, kind, from, to, depth, budget, remaining…})`, :7245-7251). Even if a member
reached the verb, the durable audit would record the member's message as the orchestrator's.
The REPLY lane does it right — a worker reply's durable `message.delivered` row carries
`from: workerId` with `actor: workerId` (coordinator.mjs:13191-13196) — so the asymmetry is
the root-send path alone. The store's `recordMessage` is closed to exactly the
`message.sent`/`message.delivered` kinds (coordination-store.mjs:13789-13792).

**GT-6 — the kind sets disagree between the facade and every advertised surface.** The facade
normalizer admits `['inform', 'query', 'steer', 'brief', 'result']` (application.mjs:12973)
and so does the lane (coordinator.mjs:7162), but the registry schema
(application-semantics.mjs:1676) and the MCP tool (enum + `invalid_message_send`,
mcp-northbound.mjs:695, :1263) admit only `['inform', 'query', 'steer']`. `brief`/`result`
are the orchestrator's spawn-briefing and result kinds (the store histogram: 3,742
`message.sent` rows, all campaign traffic `brief`/`result` from the orchestrator).

**GT-7 — the decision round-trip is real, worker-log-audited, and store-SILENT.** Mint: the
session adapter scans worker assistant text for the `DECISION_REQUEST:` grammar, admits at
most one live request, mints `requestId = "<worker>:decision:<seq>"`, and emits
`decision.requested` on the WORKER event stream (claude-session.mjs:1132-1141). Admission:
the coordinator's `case 'decision.requested'` (coordinator.mjs:13297-13402) validates the
closed shape (typed coaching refusals: `control.malformed_interaction_rejected` :13312,
`control.drain_interaction_discarded` :13333, `control.duplicate_interaction_rejected`
:13340, `control.decision_already_pending_rejected` :13359 — the last backed by a durable
`authority.rejected` row, `reason: 'decision_already_pending'`), then appends `askedEvent` to the
WORKER log (`appendAttributed`, coordinator.mjs:13374 — `this._log.append`, :12747) and writes
EXACTLY ONE durable effect: the task transition
`this._coordTransition(task, 'input_required', …)` (coordinator.mjs:13395). Settle: `case
'decision.settled'` (coordinator.mjs:13406-13416) appends `resolvedEvent` to the worker log
and transitions the task back to `working`; the delivery path mints the worker-log
`decision.settled` with `disposition: 'delivered'` (coordinator.mjs:10403). The worker
receives the answer as a `DECISION_ANSWER:` user frame and clears
`pendingDecisionRequestId` (claude-session.mjs:1471-1480). Defer: the steering policy's
non-match branch records `{trigger: 'answerDecisions', role, requestId, deferred: true,
outcome: 'deferred'}` on the IN-DRIVE steering trail ONLY (workflow-interpreter.mjs:859-862)
— surfaced in the wave receipt, never in the store. The store's generic envelopes would
swallow any new kind: `recordDriver` wraps everything as `driver.recorded` with the kind in
the payload (coordination-store.mjs:13240-13246); `mapOperationalEvent` lands worker events
as `evidence.mapped` (coordination-store.mjs:12757-12774).

**GT-8 — live store verification (this session): zero top-level `decision.*` kinds, ever.**
Scan of `.git/baton/application-v3/state/coordination/events.jsonl` (the resident
deployment's durable store): **99,131 events; 0 events whose `kind` starts with `decision`**.
The grep hits for `"kind":"decision` are all NESTED `payload.kind: 'decision'` values inside
`evidence.mapped`, `task.transitioned`, and `driver.recorded` envelopes — exactly 2 such
envelopes carry `payload.kind === 'decision'` as their interaction class. The lane-proof
wave's answered DECISION_REQUEST (question 1, answered `opt-shared`) and its deferred
question 2 both left ZERO durable decision rows — the round-trip is real but unrecorded.

**GT-9 — sibling terminal state is volatile, and the member-observable projections are not
member-admitted.** A member's terminal settle mints an attention reason
`{kind: 'member_terminal', runId, workerId, memberState: 'terminal-at-mint', count, status}`
in `this._attentionReasons` — an IN-MEMORY array initialized `[]` at construction
(coordinator.mjs:1227, mint :7471-7502, storm coalescing :7490-7500) — never replayed from
the durable log; a coordinator restart wipes every sibling verdict signal (the #204
restart-dance adjacency). The bounded per-member projection EXISTS —
`waves.progress` serves `{role, phase, progressClass, attention, knowledge}` paged ≤16 per
member run (application.mjs:11802-11838) — but it is an orchestrator-surface verb: the
observe verb `run.attention.watch` carries registry surfaces `['embedded', 'mcp', 'cli']`
(application-semantics.mjs:1686-1689) with no web admission, and the lane-proof member's
control probe drew `{"ok":false,"error":{"code":"forbidden","message":"forbidden"}}` on
`waves_list` (envelope valid, authorization refused at the web capability seam,
web-northbound.mjs:969-976). The working discipline is therefore MANUAL: verify sibling
worktrees at `../../wt/ws-*/` — "silence is not death" — which blue-team-qa.md names
"the load-bearing discipline" and which misfired THREE times in the lane-proof wave: (i) the
coordinator QA's on-disk check ran before the seat-deferred row spawned and wrongly declared
"row-lane-messages never landed"; (ii) the correctly-addressed `signalOnMembersDone` arrived
after the coordinator's turn had ended — nothing was consulted, the verdict was blind; (iii)
the row's report had to be rescued from the main tree because no member-reachable surface
said where it landed. Applied this session per the law: 2 of 4 sibling contracts are on disk
(`contract-context-lanes.md` ← ws-afcb593, `contract-federation-doubt.md` ← ws-6dd7db4);
`row-knowledge-activation` was silent at check time and is NOT declared dead.

## 2. Decisions

**D1 — reach: land `run.message.send` as a web-admitted direct port (the #158 pattern).**
Add `['run_message_send', 'run.message.send', Object.freeze(['control', 'observe'])]` to
`WAVE_WEB_ENTRIES` with `WAVE_ARG_FIELDS.run_message_send = {body, budget, kind, runId,
workerId}` (the normalizer's own closed key set, GT-1). The byte-stable
`APPLICATION_COMMAND_DEFINITIONS` key set is untouched (the direct-port admission exists
precisely for this); `WEB_DIRECT_PORT_COMMANDS` derivation (web-northbound.mjs:70) then makes
the append-style closed normalizer the argument authority. `invalid_command` for
`run_message_send` disappears from every surface that shares the envelope (web AND CLI,
GT-3). The registry's surface list gains `'web'` (application-semantics.mjs:1672).

**D2 — origination truth: `from` is the authenticated actor, server-derived, never a
literal.** `sendMessage` threads its `auth.actor` into BOTH the in-memory record and the
durable `message.sent` row (replacing the two `'orchestrator'` literals, coordinator.mjs:7237
and :7246). An orchestrator-driven send still records `from: 'orchestrator'` (that IS its
actor); a member-originated send records the member's server-derived identity. The two rows
(in-memory, durable) MUST agree — one source of truth. The reply lane is the precedent
(GT-5).

**D3 — member admission law: wave-scoped origination.** A member principal may originate
messages only to runs of ITS OWN wave (the wave linkage is durable — `wave.started` rides
`driver.recorded`, application.mjs:136-138); a send to any other run refuses the reply lane's
own code `message_target_not_member` (coordinator.mjs:13098 — the same law, the send
direction). Run-membership alone would be WRONG for this lane: a member's query-up targets
the COORDINATOR's run, a different run in the same wave — the scope is the wave, not the run
(judgment call JC-3; OQ-1 keeps the cross-check open).

**D4 — kind set: the member surface is exactly `{inform, query, steer}`; `{brief, result}`
stay orchestrator-mint kinds.** The advertised schema becomes TRUE for members: a
member-originated send of `brief`/`result` refuses typed at the admission seam with the
closed member set named (the #160 field-naming law shape). The embedded facade's 5-kind
admission stays for the orchestrator path — the facade is never narrower than the lane
(application.mjs:12966-12968's own law) — so the divergence becomes a PRINCIPAL-CLASS
boundary, not a surface accident (OQ-3 tracks the alternative).

**D5 — decision ledgering: three TOP-LEVEL durable kinds, additive-only.**
`decision.requested`, `decision.settled`, `decision.deferred` land as store kinds in their
own right (NOT `driver.recorded` envelopes — GT-7's wrapper would hide them from every
kind-scoped consumer, exactly as `payload.kind: 'decision'` is invisible today). Closed
payloads, sorted-key ACTUAL order:
- `decision.requested` — `{requestId, runId, taskId, workerId}`; minted at the admission seam
  (beside `askedEvent`, coordinator.mjs:13374), key `decision.requested:<requestId>`.
- `decision.settled` — `{actor, disposition, requestId, runId, taskId, workerId}`; minted at
  the settle seam (the `decision.settled` case, coordinator.mjs:13406, carries the actor and
  `disposition: 'delivered'`), key `decision.settled:<requestId>`.
- `decision.deferred` — `{reason, requestId, runId, taskId, workerId}`; minted where the
  defer is DECIDED — the interpreter's defer branch (workflow-interpreter.mjs:859-862) must
  call a coordination seam (a `handle.defer`-class method), not only `steering.push`; the
  steering trail row stays as the drive's own record. Key
  `decision.deferred:<requestId>`.
The worker-log events, the `task.input_required`/`task.working` transitions, and
`evidence.mapped` rows are ALL unchanged (additive law — ML-B4 pins this).

**D6 — sibling visibility: make the terminal signal durable, then admit member observe.**
(a) `_mintMemberTerminal` (coordinator.mjs:7471) additionally records a durable
`member.terminal` row — closed payload `{count, memberState, runId, status, workerId}`
(sorted ACTUAL order; the storm-coalesced row drops `workerId` exactly as the in-memory
reason does) — so a restart no longer wipes sibling verdict state. (b) `waves.list` and
`waves.progress` admit member principals SCOPED to their own wave (D3's wave-membership
predicate at the authorize seam); a foreign wave refuses `forbidden` (the existing code,
web-northbound.mjs:975). The manual `#174` discipline (verify on disk; silence is not death)
remains the named operator fallback until ML-C1/ML-C2 go green — this contract does not
declare it retired.

## 3. Closed refusal vocabulary (surface-constant; this contract adds ZERO new codes)

- Message lane (existing, byte-pinned): `application_message_send_invalid` (facade shape +
  closed key/kind shape, application.mjs:12975), `message_budget_invalid` (lane,
  coordinator.mjs:7159), the coaching `spill_body_exceeded` family (limits.mjs:54-55, the
  2048-byte `message.send.body` admission with spill-digest-citation graceful, enforced at
  `coordinator.sendMessage`), the `ok:false` lane outcomes `worker_spawning`/`worker_not_active`/
  `run_not_active` (coordinator.mjs:7202/:7222/:7230), `message_frame_invalid`,
  `message_target_caller_named`, `message_parent_not_found`, `message_target_not_member`
  (:13098), `message_depth_exceeded` (:13112-13113) — the reply-lane family,
  coordinator.mjs:13075-13113 — and `application_unauthorized` (resolve-to-null ≡ unknown ≡
  foreign, application.mjs:13292-13297).
- Member-surface wrappers (existing): `invalid_message_send` (MCP,
  mcp-northbound.mjs:1263), `cli_command_unavailable`/`cli_transport_failed` (CLI,
  application-cli.mjs:2122/:2034), `invalid_command`/`forbidden` (web admission/authority,
  web-northbound.mjs:530/:975).
- Decision lane (existing): `control.malformed_interaction_rejected`,
  `control.drain_interaction_discarded`, `control.duplicate_interaction_rejected`,
  `control.decision_already_pending_rejected` + the durable `authority.rejected`/
  `authority.cancelled` records (coordinator.mjs:13312-13366).
- The gaps this contract closes are ADMISSION and DURABILITY gaps; every refusal above keeps
  its code, its surface, and its firing order. A fold that needs a NEW code to make a pin
  green has misread this section.

## 4. Red-first acceptance pins (named stages; RED at HEAD unless marked GREEN)

**#206 — member message origination**

- **ML-A1 stage[web-send-unadmitted] (RED).** A valid, authenticated `run_message_send`
  envelope over `POST /v1/commands` dispatches to `messageSend` and returns the lane outcome.
  At HEAD it draws 400 `{"ok":false,"error":{"code":"invalid_command","message":"unsupported
  command"}}` — `run_message_send` is absent from all four admission tables
  (web-northbound.mjs:95-104; the refusal at :530). Kills an impl that fixes only the CLI
  parse or only the registry surface list.
- **ML-A2 stage[cli-send-shares-gate] (RED).** The CLI web client's `command()` envelope for
  `run.message.send` (application-cli.mjs:2122-2135) dispatches — at HEAD the parse succeeds
  (application-cli.mjs:1538-1545) and the resident refuses exactly as ML-A1 (GT-3: one root,
  two surfaces; a fold that lands only the web table and leaves the CLI parse drifting fails).
- **ML-A3 stage[mcp-send-dispatch-arm] (GREEN substrate pin).** `tools/call
  baton_run_message_send` routes to `application.command('run.message.send', …)`
  (mcp-northbound.mjs:1987-1993) and the tool stays advertised with the
  `invalid_message_send` declared-arg refusal (:1262-1270). GREEN at HEAD — kills a fold that
  regresses the one working arm while opening the others.
- **ML-A4 stage[send-origination-misattributed] (RED).** An admitted root send whose
  authenticated actor is a member records `message.sent` with `from` = that member's
  server-derived identity, and the in-memory record and the durable row AGREE. At HEAD both
  mint `from: 'orchestrator'` unconditionally (coordinator.mjs:7237/:7246) — the durable
  audit would forge the orchestrator's authorship of a member's message. An impl that fixes
  only the durable row (or only the record) fails the agreement clause.
- **ML-A5 stage[member-send-nonmember-unrefused] (RED).** A member principal's send into a
  run of a FOREIGN wave refuses `message_target_not_member` (D3). At HEAD no member
  admission exists, so the refusal CANNOT fire — the pin is red by absence, and it kills an
  impl that opens the lane without the scope law (an unscoped fold admits cross-wave
  injection and this pin stays red in the other direction).
- **ML-A6 stage[kind-enum-divergence] (RED).** A member-originated send of kind `brief` (and
  `result`) refuses typed naming the closed member set `{inform, query, steer}` on EVERY
  member-admitted surface, while the embedded orchestrator path still admits all five kinds.
  At HEAD the surfaces disagree: MCP refuses `invalid_message_send` (3-kind enum,
  mcp-northbound.mjs:695/:1263) but the embedded facade admits `brief`
  (application.mjs:12973) with no principal-class boundary anywhere.

**#205 — decision ledgering**

- **ML-B1 stage[decision-requested-not-durable] (RED).** An admitted, well-formed
  `DECISION_REQUEST` grammar mint from a worker leaves a TOP-LEVEL `decision.requested` store
  event `{requestId, runId, taskId, workerId}`. At HEAD the admission writes only the
  worker-log `askedEvent` (coordinator.mjs:13374) and one `task.input_required` transition
  (:13395) — the live store holds 0 `decision.*` kinds across 99,131 events (GT-8).
- **ML-B2 stage[decision-settled-not-durable] (RED).** A delivered answer leaves a TOP-LEVEL
  `decision.settled` `{actor, disposition, requestId, runId, taskId, workerId}`. At HEAD
  settle writes only the worker-log event (coordinator.mjs:10403, :13407) and the
  `task.working` transition (:13410-13412).
- **ML-B3 stage[decision-deferred-not-durable] (RED).** A steering-policy defer (no match)
  leaves a TOP-LEVEL `decision.deferred` `{reason, requestId, runId, taskId, workerId}`. At
  HEAD the defer is steering-trail-only (workflow-interpreter.mjs:859-862) — the honest
  defer-park the lane-proof wave PROVED is exactly the record the store never sees.
- **ML-B4 (GREEN pin — additive-only law).** The existing durable discipline is unchanged:
  the `task.input_required`/`task.working` transitions with their embedded interaction
  evidence (coordinator.mjs:13395/:13410), the `evidence.mapped` rows, and the worker-log
  appends all still fire. GREEN at HEAD and must STAY green — kills an impl that "lands" the
  new kinds by replacing the transition/evidence discipline instead of adding to it.
- **ML-B5 (GREEN pin — idempotency substrate).** Each new kind rides the store's `_byKey`
  law: a same-key replay returns the prior event and mints nothing (coordination-store.mjs,
  `_append` prior-return), and a same-key different-payload replay refuses the store's
  conflict code. GREEN at HEAD as the substrate; the pins for D5 must not introduce a second
  idempotency regime.

**#174 — member-side sibling visibility**

- **ML-C1 stage[member-terminal-volatile] (RED).** A member's terminal settle leaves a
  durable `member.terminal` row `{count, memberState, runId, status, workerId}`. At HEAD the
  signal exists only in `this._attentionReasons` — memory, `[]` at construction, never
  replayed (coordinator.mjs:1227/:7471-7502) — so a restart silently erases every sibling
  verdict signal.
- **ML-C2 stage[member-observe-unadmitted] (RED).** A member principal reads
  `waves_progress` (and `waves_list`) for ITS OWN wave over the member-reachable web lane and
  receives the bounded per-member projection. At HEAD member seats draw `invalid_command`
  (observe verbs not member-admitted through the four-table composition) or `forbidden` at
  the capability seam (the lane-proof `waves_list` control, verbatim in GT-9) — and
  `run.attention.watch` has no web admission at all (application-semantics.mjs:1687).
- **ML-C3 (GREEN pin — bounded projection).** `waves.progress` keeps serving exactly the
  closed per-member shape `{role, phase, progressClass, attention, knowledge}`, paged ≤16,
  attention reduced to `{kind, summary}` (application.mjs:11816-11838). GREEN at HEAD —
  kills a fold that "fixes" member observe by swapping in unbounded live reads or new fields.

### Fold-record-ready pin list

| Pin | Stage | Issue | HEAD |
|---|---|---|---|
| ML-A1 | web-send-unadmitted | #206 | RED |
| ML-A2 | cli-send-shares-gate | #206 | RED |
| ML-A3 | mcp-send-dispatch-arm | #206 | GREEN (substrate) |
| ML-A4 | send-origination-misattributed | #206 | RED |
| ML-A5 | member-send-nonmember-unrefused | #206 | RED |
| ML-A6 | kind-enum-divergence | #206 | RED |
| ML-B1 | decision-requested-not-durable | #205 | RED |
| ML-B2 | decision-settled-not-durable | #205 | RED |
| ML-B3 | decision-deferred-not-durable | #205 | RED |
| ML-B4 | additive-only transitions+evidence | #205 | GREEN (must stay) |
| ML-B5 | store idempotency substrate | #205 | GREEN (must stay) |
| ML-C1 | member-terminal-volatile | #174 | RED |
| ML-C2 | member-observe-unadmitted | #174 | RED |
| ML-C3 | bounded waves.progress shape | #174 | GREEN (must stay) |

## 5. Publish record (the `shared` publish — attempted, refused, evidence below)

Per the foundry law ("publish to `shared` when complete — or record the exact refusal,
#158"), the publish was ATTEMPTED and REFUSED from this seat; the refusal is the evidence:

1. **Code (re-verified this session by re-running `impl/test/scratchpad-write-red.test.mjs`
   at HEAD — commands and splits recorded in the run):** the `run.scratchpad.append` surface
   is admitted on the web four-table (A3-2 ✔) but DEAD at every dispatch stage —
   ✖ A1-1 `cli-append-branch-missing` (the CLI parser throws on the append subverb), ✖ A2-2
   `mcp-append-dispatch-branch-missing`, ✖ A3-1 `web-append-dispatch-missing` (a valid
   envelope never dispatches to a receipt). The kernel worker-write path hardcodes the scope:
   `const scope = \`worker:${fields.workerId}\`` (coordination-store.mjs:14169) — no
   `shared` write from a member seat, silently.
2. **Live probes (this session):** four bounded read-only probes of the resident web bus
   (§GT-4) connected and received zero bytes — no client path from this seat.
3. **Fallback:** the findings summary is published through the one PROVEN member write lane —
   the `SCRATCHPAD_WRITE` worker up-channel grammar (closed shape, worker-scoped by
   construction) — emitted with this report; expected landing `worker:w-422`, kind `note`,
   idempotencyKey `row-member-lanes.shared-publish.refusal-record`. The landing scope is the
   #158 refusal made durable.

## 6. Judgment calls

- **JC-1 — environmental vs. code evidence.** The MCP timeout and the CLI worktree handshake
  failure are recorded as ENVIRONMENTAL reachability evidence (motivation), never as pins;
  every RED pin is anchored to a code seam verifiable at any HEAD. My own session's bus
  probes timed out and are recorded WITH their epistemic limit (the serve was driving this
  wave; busy ≡ gated from the seat).
- **JC-2 — closure by admission, not vocabulary.** Zero new refusal codes (§3): the member
  lane's refusals all exist at HEAD; the lanes are unreachable, not under-specified.
- **JC-3 — wave-scope, not run-scope, for member origination (D3).** The query-up case (a
  member messaging the coordinator's run) is the lane's raison d'être and crosses run
  boundaries by construction; run-membership would forbid exactly it.
- **JC-4 — member kind set stays three (D4).** `brief`/`result` are orchestrator mint kinds
  with campaign scale (3,742 rows); admitting them for members would let a member forge
  spawn-briefing-shaped traffic. The alternative (grow every enum to five, refuse by
  principal class everywhere) is tracked as OQ-3.
- **JC-5 — top-level kinds, not envelopes (D5).** A `driver.recorded`-wrapped decision kind
  would repeat today's invisibility (GT-8's two `payload.kind: 'decision'` envelopes prove
  the wrapper hides kinds from kind-scoped consumers).

## 7. Escalation — DECISION_REQUEST (authority-class: member observe scope, D6b)

The member-observe admission (ML-C2) grants a principal class read authority it does not
hold today; that is an authority-class boundary change and is escalated UP with options
(this mint is itself #205 evidence — whatever the answer, at HEAD it will leave zero store
events):

```
DECISION_REQUEST: {"question":"May a member principal observe sibling member state (waves.list/waves.progress) for its own wave, per contract-member-lanes D6b/ML-C2?","options":[{"id":"opt-wave-scoped","label":"yes — wave-membership-scoped observe, foreign waves refuse forbidden"},{"id":"opt-operator-only","label":"no — observe stays operator/coordinator-only; #174 stays the manual on-disk law"},{"id":"opt-phase-only","label":"yes but phase/progressClass only — no attention or knowledge fields for members"}],"allowFreeResponse":true,"deadlineMs":60000}
```

Recommended: `opt-wave-scoped` (matches D3's symmetry; the projection is already bounded,
ML-C3).

## 8. Open questions

- **OQ-1 — does a member query-up need a wake?** A message to the coordinator's run lands in
  its inbox; the driver polls on its own cycle. Should a member `query` arm an attention wake
  for the coordinator seat (the `member_terminal` mint's mirror), or does polling suffice?
  No clock is proposed — the pin, if any, will be event-ordered.
- **OQ-2 — `decision.requested` payload depth.** Minimal `{requestId, runId, taskId,
  workerId}` (D5) vs. carrying the question digest (the full question already lives in the
  worker-log `askedEvent` and the `input_required` transition evidence). Minimal is pinned;
  the digest is an additive option for the fold.
- **OQ-3 — enum growth vs. principal-class refusal (D4/OQ of ML-A6).** If the fold prefers
  one 5-kind schema everywhere, ML-A6 must be re-expressed as a principal-class refusal pin
  before landing; as written it pins the 3-kind member surface.
- **OQ-4 — `member.terminal` consumer.** Who reads the durable row first — the restart
  rebuild of `_attentionReasons` (making the wake lane replay-derived), or only
  `waves.progress` hydration? Either satisfies ML-C1; the choice affects the #181-class
  turn-ended blindness (GT-9 incident ii) and belongs to the fold.

---

*Evidence trail: lane-proof-2026-08-13 (lane-decision.md, lane-messages.md, lane-qa.md,
landing-note.md, workflow.json) · blue-team-2026-08-13-a/blueteam-qa.md (§ #174 law) ·
impl/test/scratchpad-write-red.test.mjs (re-run this session) · live store scan §GT-8 ·
sibling worktree check §GT-9. Verification HEAD `09200e97c1be113946459d901c8fab56034d8a1f`.*
