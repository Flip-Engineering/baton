# CONTRACT-MEMBER-LANES v1 — the member-facing lane surface (package ⑤, row row-member-lanes)

[attempt: 5262cdfa-7068-4a59-8ad5-f80446d710a7 row-member-lanes]

Issue set: #206 (member message origination) · #205 (decision ledgering) · #174 (member-side
sibling visibility). Base: this worktree at `5ae2c7e5` (`impl/src` identical to the foundry's
campaign base — docs-only commits between). Ring-2 form: ground truths → decisions → refusal
vocabulary → red-first acceptance pins at named stages → open questions. Every anchor below was
re-verified this session with `grep -an`/`sed -n` (NUL discipline on `application.mjs` +
`coordination-store.mjs`; plain grep elsewhere); line numbers are HEAD numbers. No clocks
anywhere (the DECISION_REQUEST grammar's own `deadlineMs` is quoted wire shape, never a contract
mechanism). Sorted-key literals in ACTUAL order. The lane-proof wave's captures
(`lane-proof-2026-08-13/lane-messages.md`, `lane-decision.md`) and the channel-audit landing note
are the incident record; every code claim below was re-grounded at HEAD before pinning.

**Path judgment call (recorded):** my row brief's deliverable line names
`…/redrive2/contract-member-lanes.md`, but the redrive2 and redrive3 row briefs are
byte-identical (diff verified) and BOTH the wavefile (`redrive3/collab-contracts.wavefile:15` —
`report "…/redrive3/contract-member-lanes.md"`) and the dispatch's hard scope constraint
(`redrive3/**` only) name redrive3. The brief's `redrive2` is a stale copy artifact; this
contract lands at the wavefile's path. A reviewer enforcing the brief's literal string will not
find it there — flagged here rather than silently duplicated into an out-of-scope directory.

**Headline:** the member-facing lane surface at HEAD is a REPLY-ONLY world. A wave member can
answer what it was given (the `MESSAGE_SEND: {body, inReplyTo}` reply grammar, the
`DECISION_REQUEST` escalation grammar) but cannot ORIGINATE: the one origination verb
(`run.message.send`) is refused by the web admission table the CLI rides, refused by the
deployment authorizer for every worker seat even where the surface is reachable, and its MCP leg
timed out in the field. The decision lifecycle round-trips but never ledgers — `decision.*`
exists in NO coordination-store kind (zero matches at HEAD), and the steering DEFER outcome is
in-memory until settle. And a member cannot see a single sibling: every waves.* observe verb
refuses the session-authority context (#176), the board is per-run walled, and the
`signalOnMembersDone` delivery loop swallows per-recipient failure with no record — the exact
shape of the three blind-coordinator incidents.

## 1. Ground truths (each verified at HEAD this session)

### The origination seam (#206)

- **GT-M1 — `run.message.send` exists as a facade direct port, embedded-only by table.** The
  dispatch at `application.mjs:12704` (`if (name === 'run.message.send') return
  this.messageSend(args, principal);`) is one of the eight facade-projection direct ports,
  deliberately NOT an `APPLICATION_COMMAND_DEFINITIONS` key (`application.mjs:173-225` — no
  `run.message.send` entry; the comment at `:13010-13018` names the law: "never
  APPLICATION_COMMAND_DEFINITIONS keys, so the byte-stable command-table key set is unchanged").
  The lane itself is real and closed: `_normalizeMessageSend` (`application.mjs:13020-13047`)
  admits exactly one target (`runId` XOR `workerId`), kinds `inform|query|steer|brief|result`,
  non-empty NUL-free body under the 2,048-byte `message.send.body` cap; `messageSend`
  (`application.mjs:13220-13247`) resolves the target server-side, authorizes, and returns the
  lane outcome verbatim under `{schemaVersion: 1, …}`.
- **GT-M2 — the web surface refuses the command key ('invalid_command').** The web admission
  table `COMMAND_CAPABILITY` (`web-northbound.mjs:95-105`) is built from the base transport set +
  web-true command-table entries + canonical entries + `WAVE_WEB_ENTRIES` (`:39-55` — the seven
  waves.* direct ports plus `run_scratchpad_append`). `run_message_send` is in NONE of them, so
  `validateEnvelope`'s membership check (`web-northbound.mjs:530` — `if
  (!Object.hasOwn(COMMAND_CAPABILITY, envelope.command)) return 'unsupported command';`) refuses
  it, and the string maps to the 400 wire shape `error(400, 'invalid_command', validation)` at
  `:926`. This is the lane-proof capture verbatim:
  `{"ok":false,"error":{"code":"invalid_command","message":"unsupported command"}}` — the
  envelope-valid control (`waves_list` → `forbidden`) proving the refusal is the capability
  table, not the envelope.
- **GT-M3 — the CLI advertises the verb its own transport refuses.** `CLI_WEB_COMMANDS`
  (`application-cli.mjs:16-36`) explicitly whitelists `'run.message.send'` (the facade-projection
  comment names the eight verbs); the parser fully supports `baton run message send` with
  `--kind inform|query|steer` and exactly one target (`application-cli.mjs:1535-1546`); and
  `client.command` (`:2122-2136`) maps the dotted name to `run_message_send` and POSTs
  `/v1/commands`. That POST hits GT-M2's gate: an envelope the CLI itself constructed draws
  `invalid_command` back. The CLI is web-bound with no in-process mode — every command rides
  `BatonWebClient` (`connectBaton`, `:2249-2300`), and when no resident connection is
  discoverable the doctor/session handshake dies in the fetch-catch at `:2034`:
  `'Baton Web connection failed; check your network and retry'` (`cli_transport_failed`) — the
  worktree incident from the lane-proof wave. So the CLI's message lane is doubly dead from a
  member seat: transport-unreachable in worktrees, and command-refused even where reachable.
- **GT-M4 — even a reachable surface refuses member origination at the authority seam.** The
  deployment's facade authorizer (`application-deployment.mjs:2082-2086`) is four lines:
  `if (principalId.startsWith('worker:')) return false; return true;` — a worker-seat principal
  is refused EVERY facade `_authorize`, including `messageSend`'s
  (`application.mjs:13231-13235`) → `application_unauthorized`. The lane's authority idiom is
  orchestrator-steers-worker (the MCP tool's own description: "Send one orchestrator message to
  a worker or run target", `mcp-northbound.mjs:694`). There is NO authority class anywhere at
  HEAD under which a member originates a message.
- **GT-M5 — the only member-writable origination grammars are closed and reply/escalation
  shaped.** The session adapter scans the worker's own assistant text for three up-channel
  grammars (`claude-session.mjs:1132-1160`): `MESSAGE_SEND: {body, inReplyTo}` — closed to
  EXACTLY those two keys, `inReplyTo` must match `message:<64 hex>`, "a caller-named target is
  never surfaced (the Coordinator derives the sole target from the parent message)"
  (`claude-session.mjs:144-166`) — reply-only by construction; `DECISION_REQUEST: <json>` —
  one live per session (`:1132-1141`), answered by a `DECISION_ANSWER:` user frame
  (`:1463-1480`); and `SCRATCHPAD_WRITE` (worker-scoped only, #158). A member with no parent
  message in hand has NO text-grammar path to any recipient.
- **GT-M6 — the MCP leg exists but is unreachable from the member seat in the field.**
  `baton_run_message_send` is a fully specified ordinary tool (`mcp-northbound.mjs:693-701`,
  validation `:1262-1268`, dispatch through `application.command('run.message.send')`
  `:1987-1995`). The lane-proof wave's member MCP session timed out at start — environmental,
  but structural too: even a live connection authenticates as its own principal (never the
  member's worker seat, GT-M4), so a member reaching its own MCP leg still speaks as a foreign
  principal to its own run.

### The decision-ledger seam (#205)

- **GT-M7 — the decision lifecycle is durable in the per-worker log and NOWHERE else.** The
  coordinator appends `decision.requested` to the worker's operational log at admission
  (`coordinator.mjs:13374` — `appendAttributed({… kind, actor, payload: { requestId, request }})`
  inside the `decision.requested` case, `:13297+`) and `decision.settled` on a delivered answer
  (`coordinator.mjs:10403-10408`, disposition `'delivered'`). That log is the per-worker
  `<workerId>.jsonl` Log (`log.mjs:24-31` — "one JSONL file per worker"). The COORDINATION STORE
  — the cross-run ledger every wave surface reads — has NO `decision.*` kind: `grep -an
  'decision' impl/src/coordination-store.mjs` returns only the supply-chain reuse-decision rows
  (`:3550-3623`); the message lane has a dedicated store recorder (`recordMessage`, closed on
  `message.sent`/`message.delivered`, `coordination-store.mjs:13789-13805`) and the decision lane
  has none. The store's only decision trace is indirect: the task transitions
  `task.input_required`/`task.working` carrying `interaction: {kind: 'decision', requestId}`
  evidence (`coordinator.mjs:13396-13400`, `:13410-13416`) — reconstructable only by knowing
  where to look. This is the channel-audit row-chan census: 580 `message.sent` events in range,
  **no `decision.*` event in the store at all**
  (`channel-audit-2026-08-13/landing-note.md:32-35`).
- **GT-M8 — the DEFER outcome records nothing durable at decision time.** The steering defer
  branch (`workflow-interpreter.mjs:1026-1029`) adds the key to the in-memory
  `s.handledDecisionKeys` and pushes `{trigger: 'answerDecisions', role, requestId, deferred:
  true, outcome: 'deferred'}` onto the in-memory `steering` array (`:605`). That array reaches a
  caller only inside the synchronous seven-key receipt (`{basis, harvest, manifestDigest,
  outcomes, steering, verdict, waveId}` — `workflow-interpreter.mjs:719-727`, sorted actual
  order) and reaches the STORE only nested as `receipt` inside the `wave.settled`
  driver-recorded payload minted at settle (`application.mjs:11700-11710`). A deferred decision
  in a wave that never settles (the drive is killed, the bus detached and never attached) leaves
  ZERO durable record that the question was ever asked or passed on. The answered/denied/refused
  outcomes (`:1030-1068`) share the trail-only fate at decision time; only the coordinator-side
  log rows of GT-M7 exist for requested/settled.
- **GT-M9 — a DECISION_REQUEST without an `answerDecisions` policy parks forever.** The mint
  path (GT-M5) parks the task at `input_required` (`coordinator.mjs:13393-13400`); nothing but a
  steering policy match, a human `run.answer`, or the deadline moves it. Row-chan's finding
  (landing-note :35): "a DECISION_REQUEST in a wave without an `answerDecisions` policy parks
  forever, never routed up." The escalation lane has no wave-visible surface: `waves.progress`
  projects attention only as `{kind, summary}` pairs (`application.mjs:11870-11874`), so a
  coordinator polling the wave CAN see an `answer_decision` attention row (`application.mjs:11869-11873`)
  but cannot tell from the store whether anyone ever answered, deferred, or saw it.

### The sibling-visibility seam (#174)

- **GT-M10 — every waves.* observe verb refuses the member's own session context.** The #176
  closure (`application.mjs:12713-12728`): any `rawContext?.sessionAuthority` marker on
  `waves.start|run|stop|send|progress|list|compile` refuses
  `run_orchestrator_command_forbidden` (sole exception: a `claimGrant`-carrying `waves.send`).
  A wave member driving the embedded facade IS a session-authority context — the member is
  locked out of `waves.progress`/`waves.list`, the only verbs that project sibling state
  (`waveProgress` member rows: `{role, phase, progressClass, attention, knowledge}`,
  `application.mjs:11843-11880`). The worker-seat coaching wrapper
  (`_refuseCoordinatorAuthority`, `application.mjs:3231-3243`, refused for
  `waves.start|run|stop` at `:12763-12764`) explicitly spares the observe verbs — but the
  session-authority gate above them does not.
- **GT-M11 — every remaining member read lane is own-run scoped.** `run.attention.watch` pages
  the caller's own run inbox (`application.mjs:13260-13276`, scope `{runId: request.runId}`);
  `run.board.read` refuses a board bound to another run (`application_board_scope_forbidden`,
  `application.mjs:13430-13446` — "board is bound to another run"); `run.scratchpad.read`
  admits scope `shared|worker:<id>` (`application.mjs:13076-13088`) — the ONE cross-member read,
  but members cannot WRITE `shared` (#158: `writeScratchpad` hardcodes `worker:<id>` —
  `coordination-store.mjs:14130`, the scope hardcode at `:14169`; verified by the lane-proof
  capture — seq 76159 landed `worker:w-264`, no refusal), so the shared partition carries only what the top
  orchestrator elevates. A member has no verb that returns any sibling's phase, report, or
  verdict.
- **GT-M12 — the done-signal's delivery truth is swallowed, and its recipient set excludes the
  named roles.** `signalOnMembersDone` (`workflow-interpreter.mjs:918-929`): when every named
  role is done, `recipients = […handles.keys()].filter((role) => !signalRoles.has(role))`
  (`:922`) — everyone EXCEPT the roles the spec names — and each send is `try { … } catch { /*
  the recipient may already be terminal — the signal is best-effort */ }` (`:924-926`): a
  failed delivery records NOTHING (no steering note, no retry, no messageId). The steering entry
  (`:928`) lists `recipients` as bare role strings with no per-recipient delivery outcome —
  contrast `messageOnSpawn`'s pump, which bounds attempts at 3 and records each undelivered
  attempt with its messageId (`:985-1017`). The channel-audit incidents are this seam live:
  across three foundry waves the coordinator never received the signal it was briefed to wait
  for, and the QA's verdict sections were written blind while all four row reports existed
  (18–32 KB each) — `landing-note.md:7-11, 13-21`. (In THIS wave's roster the coordinator is
  itself a member, so it sits inside the recipient filter — the workaround is the wavefile's,
  not the system's.)

## 2. Decisions (judgment calls recorded; options where the call is arguable)

- **D1 — the surfaces must stop lying before origination is granted.** Whatever is decided on
  member origination authority (OQ-M1's DECISION_REQUEST), the CLI/web contradiction is a defect
  under EITHER answer: the web surface gains `run_message_send` as a WAVE_WEB_ENTRIES-class
  direct port (capability classes `['control', 'observe']`, matching the MCP capability map at
  `mcp-northbound.mjs:113`) so the CLI's already-whitelisted, already-parsed verb reaches the
  lane's own closed normalizer — exactly the admission shape `run_scratchpad_append` already
  rides (`web-northbound.mjs:50-55`). Options: (a) admit the port on web (CHOSEN — the lane
  exists, is closed, and the CLI already ships it); (b) delete the verb from
  `CLI_WEB_COMMANDS` (rejected: it removes the only CLI message lane to paper over a gate gap;
  the harvest contract's anti-de-advertising law). This decision is transport truth only — it
  does NOT grant worker seats anything (GT-M4 still refuses them).
- **D2 — member origination is an authority-class question, escalated (see OQ-M1).** The
  contract's recommendation: a member-scoped origination lane — the worker seat gains
  `run.message.send` authority ONLY for targets resolved within its own waveId (the
  steering-registered roster, `application.mjs:11611-11628`), kinds `inform|query` only (never
  `steer` — steer stays orchestrator-idiom), budget 1 — with the deployment authorizer gaining
  the wave-membership check (it already holds the store). The reply grammar stays closed
  `{body, inReplyTo}` (GT-M5's spoof-safety law is not a gap). NOT decided here: this is the
  DECISION_REQUEST.
- **D3 — the decision lifecycle ledgers as first-class store kinds, closed on three.** The
  coordination store gains `recordDecision(kind, fields, auth)` mirroring `recordMessage`
  (`coordination-store.mjs:13789-13805` — same idempotency-keyed `_append`), closed on exactly
  `decision.requested` / `decision.settled` / `decision.deferred`. Mint points: `requested` at
  the admission hop that already mints the log row (`coordinator.mjs:13374`); `settled` at every
  terminal disposition of the pending record — delivered (`coordinator.mjs:10403`), expired,
  discarded-stale (`:10368-10386`), applied-to-dead-worker (`:10357-10364`) — carrying
  `{requestId, disposition, actor}`; `deferred` at the interpreter's defer branch
  (`workflow-interpreter.mjs:1026-1029`) via the driver-record channel `wave.settled` already
  rides (`application.mjs:11700-11710`) — key `decision.deferred:<runId>:<requestId>`. The
  per-worker log rows stay (they are the adapter-facing truth); the store rows are the
  wave-visible ledger. Options: (a) three first-class kinds (CHOSEN — greppable, projectable,
  matches the issue's named set); (b) reuse the generic `driver.recorded` envelope (rejected:
  the same nesting opacity that made #205 invisible — GT-M8); (c) task-transition evidence only
  (rejected: that IS the HEAD gap).
- **D4 — the done-signal records per-recipient delivery truth.** The `signalOnMembersDone`
  steering entry's `recipients` becomes `[{role, messageId, delivered}]` — the message lane
  already mints durable `message.sent`/`message.delivered` receipts (GT-M7's recorder), so the
  signal's sends are auditable exactly like `messageOnSpawn`'s; a recipient whose send threw
  carries `messageId: null, delivered: 0` and the thrown code, never silence. The empty-catch at
  `workflow-interpreter.mjs:925` ends. The recipient SET (everyone except the named roles) is
  correct for a member-roster wave (the named roles are the done ones) — kept, with the
  wavefile-level workaround (coordinator-as-member) documented as the only way a non-member
  coordinator hears anything today.
- **D5 — sibling visibility rides the shared partition and a wave-scoped observe read.**
  (a) `run.scratchpad.read` scope `shared` is the member-facing sibling surface and stays; the
  WRITE half is the #158 contract's, not this one's (boundary note below). (b) The #176 gate
  narrows: `waves.progress` admits a session-authority caller whose `waveId` equals the wave the
  caller's run is steering-registered to (the store already answers this —
  `application.mjs:11611-11621`); every other waveId keeps the typed refusal. Options: admit the
  observe exemption (CHOSEN — read-only, store-derived, no new verb); a new member verb
  (rejected: verb-table growth for one projection); no change (rejected: that is the three
  incidents). This is arguably authority-class adjacent — folded into OQ-M1's options.

## 3. Refusal vocabulary (closed, typed, surface-constant)

Existing codes this contract depends on, unchanged (each verified at HEAD):

| Code | Minted at | Anchor |
|---|---|---|
| `application_message_send_invalid` | facade shape/size refusal (closed kinds, exactly-one target, 2,048-byte body cap) | `application.mjs:13028`, `:13033-13037` |
| `invalid_command` / `'unsupported command'` | web admission-table miss → 400 | `web-northbound.mjs:530`, `:926` |
| `cli_transport_failed` | CLI fetch failure (worktree handshake) | `application-cli.mjs:2034` |
| `application_unauthorized` | the facade `_authorize` deny (worker seats: everything) | `application.mjs:3220-3223`, `application-deployment.mjs:2082-2086` |
| `run_orchestrator_command_forbidden` | session-authority closure on all seven waves.* verbs (sole exception: claimGrant `waves.send`) | `application.mjs:12713-12728` |
| `coordinator_authority_forbidden` | worker seat reaching `waves.start/run/stop` | `application.mjs:3231-3243`, `:12763-12764` |
| `application_board_scope_forbidden` / `application_board_not_found` | board bound to another run / unknown board | `application.mjs:13440-13446` |
| `message_lane_invalid` | store recorder closed on `message.sent`/`message.delivered` | `coordination-store.mjs:13789-13793` |
| `invalid_message_send` | MCP argument guard for `baton_run_message_send` | `mcp-northbound.mjs:1262-1268` |

NEW codes this contract adds (closed set of one; surface-constant across embedded/MCP/CLI/web —
the MCP stateFailureCode allowlist must admit it):

| Code | Meaning | Refusal shape |
|---|---|---|
| `decision_lane_invalid` | the store's decision recorder called with a kind outside the closed three (mirrors `message_lane_invalid`) | `{actual: <kind>}` |

No prose-string refusals; no new numeric limits; no clocks. D2/D5 grant authority through
EXISTING typed seams (`application_unauthorized` becomes reachable-then-allowed for the
wave-scoped lanes; no new denial code is needed — admission is a grant, refusal stays the
closure's own code).

## 4. Red-first acceptance pins

Each pin names its stage (where the pin test hooks), is RED at HEAD `5ae2c7e5`, and greens ONLY
for a correct impl (a shallow greening is itself a defect).

- **PIN-M1 — the web surface admits the facade message port.**
  Stage: web command admission (`web-northbound.mjs:503-560` validateEnvelope; the
  `COMMAND_CAPABILITY` table `:95-105`). RED at HEAD (GT-M2): an envelope-valid,
  deployment-token-authenticated `POST /v1/commands` with `command: 'run_message_send'` and a
  well-formed body draws 400 `{"error":{"code":"invalid_command","message":"unsupported
  command"}}` — the lane-proof capture verbatim. Green: the same envelope returns the lane
  outcome verbatim under `{schemaVersion: 1, …}` (surface-constant with the embedded dispatch
  `application.mjs:12704` and the MCP dispatch `mcp-northbound.mjs:1987`); the orchestrator
  principal's send mints durable `message.sent` + `message.delivered` store rows via
  `recordMessage`. Shallow-green trap: admitting a RENAMED transport (e.g. a new
  `run_message` verb with its own normalizer) greens nothing — the pin asserts the exact
  transport string the CLI already sends (GT-M3) round-trips.
- **PIN-M2 — the CLI's advertised message verb round-trips.**
  Stage: CLI parse + client dispatch (`application-cli.mjs:1535-1546`, `:2122-2136`). RED at
  HEAD (GT-M3): `baton run message send --kind query --body <text> <RUN_ID>` parses cleanly and
  then draws `invalid_command` from the web gate — a CLI-whitelisted verb its own transport
  refuses. Green: the round-trip returns the lane outcome (a hex `messageId`, `delivered ≥ 1`
  for a live recipient); with no discoverable resident the refusal remains the typed
  `cli_transport_failed` naming the transport class and next action (`:2034`). Shallow-green
  trap: deleting `'run.message.send'` from `CLI_WEB_COMMANDS` greens nothing — the pin asserts a
  SUCCESSFUL send, not a quieter refusal.
- **PIN-M3 — a member seat can originate query/inform to its own wave (the D2 grant).**
  Stage: facade authorization (`application.mjs:13231-13235` + the deployment authorizer
  `application-deployment.mjs:2082-2086`). RED at HEAD (GT-M4): a `worker:`-seat principal
  sending `run.message.send` to ANY target — including its own wave's coordinator run — draws
  `application_unauthorized`; the member's only origination-capable grammar is reply-constrained
  (GT-M5). Green: a worker seat whose run is steering-registered to waveId W may send kinds
  `inform|query` to targets resolved inside W (coordinator or sibling member runs), and the send
  mints the same durable store receipts an orchestrator send mints; kind `steer` from a worker
  seat still refuses `application_unauthorized` (the idiom boundary); any target outside W
  refuses `application_unauthorized` identically (no existence leak — the resolve-then-authorize
  law at `application.mjs:13225-13230`). Shallow-green trap: granting the worker seat blanket
  `run.message.send` (dropping the `worker:` deny without the wave-scope check) fails the
  out-of-wave target clause. *(This pin is CONDITIONAL on OQ-M1's DECISION_REQUEST — if the
  ruling is "no member origination," the pin inverts to assert the typed refusal is
  surface-constant across all four surfaces and the grammars stay the only member lanes.)*
- **PIN-M4 — every decision hop ledgers a first-class store kind.**
  Stage: coordinator decision admission/settlement (`coordinator.mjs:13374`, `:10403`) and the
  store recorder (new `recordDecision`, mirroring `coordination-store.mjs:13789`). RED at HEAD
  (GT-M7): after a full DECISION_REQUEST → policy-match → DECISION_ANSWER round-trip (the
  lane-decision Q1 replay), the coordination store's event log contains ZERO `decision.*` rows —
  `grep` over the store stream finds only the task-transition evidence pairs; the requested and
  settled rows exist solely in the per-worker `<workerId>.jsonl`. Green: the store carries
  `decision.requested` (at admission, keyed `<requestId>`) and `decision.settled` (at every
  terminal disposition, carrying `{requestId, disposition, actor}`) — greppable from the wave
  surface without knowing the worker's log path; the per-worker log rows remain unchanged.
  Shallow-green trap: recording `driver.recorded` envelope rows whose payload merely CONTAINS
  the word "decision" fails — the pin asserts first-class `decision.*` kinds in the event stream.
- **PIN-M5 — a deferred decision leaves a durable record at decision time.**
  Stage: the interpreter's defer branch (`workflow-interpreter.mjs:1026-1029`) + the store.
  RED at HEAD (GT-M8): a wave WITH an `answerDecisions` policy whose patterns do NOT match the
  member's question produces zero durable bytes at defer time — the outcome lives in the
  in-memory `steering` array until settle, and in a killed/detached-never-attached wave it is
  lost entirely. Green: the defer mints a store `decision.deferred` row
  `{requestId, runId, waveId, actor}` at the defer hop (D3's driver-record channel), BEFORE any
  settle; a wave killed mid-drive still shows the row. Shallow-green trap: an impl that waits
  for `wave.settled` to carry the steering array (the HEAD shape) fails the killed-wave clause.
- **PIN-M6 — the done-signal's steering entry carries per-recipient delivery truth.**
  Stage: the signal loop (`workflow-interpreter.mjs:918-929`). RED at HEAD (GT-M12): the
  `signalOnMembersDone` steering entry lists `recipients` as bare role strings; a send that
  throws is swallowed by the empty catch and leaves no trace — the pin drives a signal to a
  recipient whose run is terminal and asserts NO delivery record exists anywhere. Green: the
  entry carries `recipients: [{role, messageId, delivered}]` with `messageId: null,
  delivered: 0` (and the thrown code) for the failed recipient, and real `messageId` +
  `delivered ≥ 1` for the live one — matching the durable `message.sent`/`message.delivered`
  receipts. Shallow-green trap: recording only the ATTEMPTED role list (the HEAD shape plus a
  `signaled: true` flag) fails the failed-recipient clause.
- **PIN-M7 — a member can read its own wave's sibling projection, and only its own.**
  Stage: the #176 gate (`application.mjs:12713-12728`) + `waveProgress` (`:11843-11880`).
  RED at HEAD (GT-M10): a session-authority member context calling `waves.progress` with its
  OWN waveId draws `run_orchestrator_command_forbidden` — the member is locked out of the only
  sibling-projection verb. Green: the same call returns the paged member projections for exactly
  its own wave; the same context asking a FOREIGN waveId keeps the identical typed refusal
  (never an empty page — the launch row's GT-L4b law); `waves.start/run/stop` stay refused for
  the member context (write verbs unchanged). Shallow-green trap: lifting the gate for ALL
  waves.* observe calls (unscoped) fails the foreign-waveId clause. *(Conditional on OQ-M1 —
  if D5 is overruled, the pin inverts to assert the refusal with the shared-partition read as
  the only member visibility.)*

## 5. Open questions

- **OQ-M1 (authority-class — DECISION_REQUEST minted below).** Should the worker seat hold
  message-origination authority (D2) and wave-scoped sibling observe (D5), or should the member
  lanes stay grammar-borne (reply + escalation + worker-scratchpad) with only the transport lies
  fixed (D1)? This is a genuine authority-class call — the G9 seat class was closed by #74's
  boundary precisely to keep worker seats out of steering. Minted for the top orchestrator:
  ```
  DECISION_REQUEST: {"question":"Should a wave member (worker seat) hold message-origination and wave-scoped sibling-observe authority, or stay grammar-borne (reply/escalation only) with only the surface lies fixed?","options":[{"id":"opt-grant","label":"grant wave-scoped origination (inform/query) + own-wave waves.progress (D2/D5, pins M3/M7 as written)"},{"id":"opt-grammar","label":"keep seats closed; fix only D1 (pins M3/M7 invert to refusal-constancy)"},{"id":"opt-hybrid","label":"grant sibling-observe only; origination stays reply/escalation-borne"}],"allowFreeResponse":true,"deadlineMs":60000}
  ```
  (The `deadlineMs` is the grammar's own required wire field, quoted verbatim — not a contract
  clock.) **Procedural note, recorded honestly:** this row did NOT mint the grammar live in its
  session text: this wave's spec carries no `answerDecisions` policy, and GT-M9 says an
  unanswered DECISION_REQUEST parks the minting task at `input_required` forever — minting it
  live would have wedged this deliverable on the very gap (#205) it reports. The escalation
  rides this document to the coordinator's cross-check instead. That trade is itself the
  clearest evidence for D3.
- **OQ-M2 (fold boundary with the ledger row):** the lifecycle wave's ledger row
  (`row-lc-ledger`) also carries #205 ("decision ledgering rides here" — its foundry brief). Its
  redrive3 QA already graded the store-side zero as consistent. Whichever row's fold lands
  first owns `recordDecision`; the other cites. The kinds MUST close at the same three
  (`requested/settled/deferred`) in both — a fourth kind from either fold is a finding.
- **OQ-M3 (delivery-state durability):** the message receipt state machine
  (`delivered/read/actedOn/reply`) is "process-scoped coordinator state"
  (`coordination-store.mjs:13787-13788` comment) while the audit receipts are durable — after a
  resident restart the receipts replay but the state machine resets. No incident cited by my
  three issues; recorded for the ledger/launch rows whose receipts this rides.
- **OQ-M4 (non-member coordinators):** a coordinator NOT in the wave roster has no lane to
  receive any signal (D4's recipients are roster handles only; `run.message.send` targets runs,
  not principals). The wavefile workaround (coordinator-as-member) is the current answer; a
  principal-addressed signal surface is a registry question above this contract's row.

## 6. Publish to `shared` — the refusal, recorded (#158 law)

Instructed to publish to `shared` on completion. The member write path refuses with NO typed
code because the refusal is a silent admission into `worker:<id>`: `writeScratchpad` hardcodes
the scope (`coordination-store.mjs` `writeScratchpad` — `const scope = \`worker:${fields.workerId}\``),
and only the orchestrator-actor settlement path writes `shared`. This exact landing was captured
by the lane-proof wave (seq 76159, scope `worker:w-264`, no refusal — `lane-messages.md` §Lane 4)
and re-verified at HEAD this session. There is no refusal string to quote. This contract is
therefore published ON DISK (here) and the shared-lane refusal is recorded verbatim above for
the fold to carry; fabricating a shared-scope publish was not an option.

## 7. Cross-contract boundary notes (for the coordinator's coherence check)

- **row-lc-launch (launch/receipt honesty):** its PIN-L3 (settlement readability on
  waves.progress) composes with this row's PIN-M7 (member wave-scoped waves.progress) — if both
  fold, the member's projection carries the settlement key too; the two folds must not fight
  over the waves.progress response shape (additive keys both, one schemaVersion).
- **row-lc-ledger (logged-invariant):** owns #194's reconstructability law and (per OQ-M2) may
  co-own #205. Its "model-visible-means-logged" invariant is the GENERAL of which D3 is the
  decision-lane instance — one shape, both seams.
- **row-lc-members (member-creation honesty):** its #199/#204 events are the member LIFECYCLE
  kinds; this contract's `decision.*` kinds are the member INTERACTION kinds — the store's kind
  set grows by both folds' closed sets, and neither may mint the other's.
- **row-knowledge-activation / row-context-lanes (this wave's siblings):** the shared-partition
  WRITE lane (#158) is theirs to contract if their briefs name it; this row only READS `shared`
  (GT-M11) and records the publish refusal (§6). The scratchpad-write fold must keep the member
  READ of `shared` (`application.mjs:13076-13088`) intact while opening the write.

---

## Fold-record-ready pin list (compact)

| Pin | Stage (file:line) | RED clause at HEAD `5ae2c7e5` | Green clause |
|---|---|---|---|
| PIN-M1 | web admission — `web-northbound.mjs:95-105`, `:530`, `:926` | `run_message_send` → 400 `invalid_command`/'unsupported command' (GT-M2, lane-proof verbatim) | lane outcome verbatim, `{schemaVersion: 1}`; durable message.sent/delivered |
| PIN-M2 | CLI dispatch — `application-cli.mjs:16-36`, `:1535-1546`, `:2122-2136`, `:2034` | parses, then `invalid_command`; worktree → `cli_transport_failed` (GT-M3) | successful send round-trip; typed transport refusal where unreachable |
| PIN-M3 | facade authority — `application.mjs:13231-13235`, `application-deployment.mjs:2082-2086` | worker seat → `application_unauthorized` for every target (GT-M4) | wave-scoped inform/query grants; steer + out-of-wave still refuse (conditional OQ-M1) |
| PIN-M4 | decision ledger — `coordinator.mjs:13374`, `:10403`; store recorder | full round-trip, ZERO `decision.*` store rows (GT-M7; row-chan census) | first-class decision.requested/settled store kinds, every terminal disposition |
| PIN-M5 | defer ledger — `workflow-interpreter.mjs:1026-1029` | defer records nothing durable at decision time (GT-M8) | durable decision.deferred at the defer hop, survives a killed wave |
| PIN-M6 | signal truth — `workflow-interpreter.mjs:918-929` | empty-catch swallow; bare role-string recipients (GT-M12; three incidents) | `recipients: [{role, messageId, delivered}]` incl. the failed recipient |
| PIN-M7 | sibling observe — `application.mjs:12713-12728`, `:11843-11880` | own-wave waves.progress refuses `run_orchestrator_command_forbidden` (GT-M10) | own-wave admits, foreign waveId keeps the typed refusal (conditional OQ-M1) |
