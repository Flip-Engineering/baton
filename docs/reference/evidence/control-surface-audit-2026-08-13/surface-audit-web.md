SURFACE-AUDIT-ROW v1
# Row-web: resident bus / web northbound surface audit (issue #147)

Surface audited: the unix-socket HTTP command endpoint (`POST /v1/commands`) that `baton serve`
publishes, its connection profiles/tokens, the SSE/follow machinery, and the envelope grammar.
All citations are to files read this session (`web-northbound.mjs`, `web-stream.mjs`,
`application-cli.mjs`, `resident-authority.mjs` read fully; `application.mjs` and
`coordination-store.mjs` read under the NUL discipline — `grep -an`/`sed -n` only).

---

## 1. Parity table

What an orchestrator can do on the web/resident bus. `web-northbound.mjs:87-105` builds
`COMMAND_CAPABILITY` from the legacy bus verbs plus every `web:true` entry of
`APPLICATION_COMMAND_DEFINITIONS` (`application.mjs:168-206`) plus the wave direct ports
(`web-northbound.mjs:37-49`). Capability classes are in parentheses. "CLI/MCP" marks parity only
where the code makes it obvious (the coordinator owns the full cross-surface matrix).

| Capability (transport name) | Web | CLI | MCP | Notes |
|---|---|---|---|---|
| `spawn` (control) | ✅ | ✅ | ✅ | legacy worker-plane verb |
| `scratch_oracle` (control) | ✅ | ✅ | ✅ | |
| `send` / `interrupt` / `kill` / `drain` (control/emergency_stop) | ✅ | ✅ | ✅ | `kill`/`drain` need `expectedFence` (`FENCE_REQUIRED`, web-northbound.mjs:93) |
| `respond` (approve) | ✅ | ✅ | ✅ | |
| `list` / `result` / `wait` / `capabilities` / `provider_status` (observe) | ✅ | ✅ | ✅ | |
| `capability_invoke` / `reuse_decide` / `reuse_recheck` (control) | ✅ | ✅ | ✅ | |
| `goal_define` / `plan_propose` / `plan_approve` / `goal_plan_status` | ✅ | ✅ | ✅ | goal/plan plane, reconcilable |
| `application_help` / `runs_list` (observe) | ✅ | ✅ | ✅ | |
| `run_start` (control) | ✅ | ✅ | ✅ | reconcilable; objective spill/ceiling below |
| `run_inspect` / `run_episode` / `run_workstreams` (observe) | ✅ | ✅ | ✅ | cursor continuation present |
| `run_status` (observe) | ✅ | ✅ | ✅ | |
| `run_follow` / `run_wait` (observe) | ✅ | ✅ | ✅ | web ceiling 30_000ms (web-northbound.mjs:417) |
| `run_act` (semantic) | ✅ | ✅ | ✅ | actionId digest-keyed, preflight `/v1/action-authority` |
| `run_approve` / `run_answer` (approve) | ✅ | ✅ | ✅ | |
| `run_feedback` / `run_workstream_notify` (control) | ✅ | ✅ | ✅ | |
| `run_stop` / `run_workstream_stop` (emergency_stop) | ✅ | ✅ | ✅ | |
| `run_evidence` / `run_adopt` / `run_retry_verification` / `run_resume_work` / `run_review` / `run_integrate` / `run_export` / `run_recover` | ✅ | ✅ | ✅ | |
| `waves_attach` (observe) | ✅ | ✅ | ✅ | S-1 v2 attach-and-harvest |
| `waves_start` / `waves_progress` / `waves_send` / `waves_stop` / `waves_list` / `waves_run` | ✅ | ✅ | ✅ | direct ports, not in command table (web-northbound.mjs:30-49) |
| 8 workflow facade ports: `run.message.send`, `run.message.receipt`, `run.attention.watch`, `run.scratchpad.read`, `run.scratchpad.elevate`, `run.board.post`, `run.board.read`, `run.knowledge.seed` | ❌ **refused** | ✅ CLI whitelist | ✅ MCP | **parity gap** — CLI_WEB_COMMANDS lists them (application-cli.mjs:16-32); the web refuses with `unsupported command` (see §5) |
| `run.debug`, `run.steer`, settlement ports (`scratchpad.elevate`/`settle`, `knowledge.promote`, `knowledge.settlement_lease`), `context.briefing`, `_wave.closed`, `_briefing.mint` | ❌ | ❌ | ❌ | embedded/orchestrator-only direct ports (application.mjs:12464-12529) |

**Canonical alias transports** (`run_view`, `run_watch`, `run_do`, `run_list`, `run_member_view`,
`run_member_send`, `run_member_stop`, `run_member_interrupt`, `run_resume`, `run_retry`) are
admitted on the wire alongside the legacy names (`web-northbound.mjs:16-24`,
`CANONICAL_WEB_ENTRIES`), but **never appear in the card** (§3 F1).

---

## 2. Discoverability findings

### D1. The card teaches dot-spelled names; the wire admits only underscores. The refusal teaches nothing. (CORE FINDING)

- The card route serves `commands: [...WEB_APPLICATION_ENTRIES, ...WAVE_WEB_ENTRIES].map(([, name]) => name)`
  (`web-northbound.mjs:1521`). `WEB_APPLICATION_ENTRIES` is built from the **dot-spelled**
  `APPLICATION_COMMAND_DEFINITIONS` keys (`web-northbound.mjs:15`), so the card advertises
  `run.inspect`, `run.act`, `waves.start`, … — never the transports.
- The wire admits only the **underscore** transports: `COMMAND_CAPABILITY` keys are
  `run_inspect`, `run_act`, `waves_start`, … (`web-northbound.mjs:87-105`), and
  `validateEnvelope` refuses any command not in that map with `'unsupported command'`
  (`web-northbound.mjs:405`).
- A fresh agent following the card literally sends `command: "run.inspect"` → `400 invalid_command:
  "unsupported command"` (`web-northbound.mjs:762`). The body names neither the underscore rule nor
  the admitted set.
- The dot→underscore rule lives **only** in client code: `application-cli.mjs:2015`
  (`const command = name.replaceAll('.', '_')`) and code comments. No surface text states it.
- **Worst instance — the surface's own continuation teaches the refused spelling.** The run.view
  continuation descriptor is `{ operation: 'run.inspect', arguments: { runId, depth, …, cursor } }`
  (`application.mjs:10035-10057`, `application-semantics.mjs:281-282`). An agent that follows the
  continuation literally sends `command: 'run.inspect'` → refused. The part of the surface designed
  to tell the agent what to do next gives it a command the surface refuses.

### D2. The first-call connection dance is a 3-file journey the surface never teaches.

- Resolution order (`application-cli.mjs:230-285`): `<repo>/.git/commondir` →
  `<commonDir>/baton/connection.json` (schemaVersion 2, names the profile + repoId +
  deploymentId + incarnation + transport) → `~/.config/baton/connections/<profile>.json`
  (owner-only, carries `url`, `origin`, `tokenFile`, and for resident profiles `socketPath`) →
  the token file (owner-only).
- On this machine `~/.config/baton/connections/` does **not** exist — no deployment has run
  `setup` here; the shape is knowable only from code (`resident-authority.mjs` publishes the
  selector at `<commonDir>/baton/connection.json`, profile at config root, socket at
  `/tmp/baton-<uid>/<digest(repoId).slice(0,16)>-<digest(incarnation).slice(0,12)>.sock`,
  owner-only 0o600/0o700).
- Nothing on the surface (card, `/healthz`, `/readyz`) points at any of these files. Token
  existence/permissions/discovery ergonomics are the CLI's concern; the web surface just requires
  whatever the auth middleware accepts.

### D3. The envelope grammar is not taught by the surface.

- `TOP_LEVEL = {schemaVersion, commandId, idempotencyKey, command, args, repoId, runId,
  expectedFence, origin, clientObservedCursor}` (`web-northbound.mjs:109`). The card/help never
  list these fields. The refusals name the *class* of the mistake (`unknown_top_level_field`) but
  not the offending key (§4/E1) and never show the required set.
- `origin` is duplicated: the caller must send an `Origin` header **and** an `envelope.origin`
  field that equals it, and both must be in the deployment's `allowedOrigins`
  (`web-northbound.mjs:666-668`). No refusal states that the two must match.
- `runId` is duplicated for application commands: `envelope.runId` must equal `args.runId` or the
  envelope is refused `application_run_id_mismatch` (`web-northbound.mjs:420-424`). The
  redundancy is never explained.

### D4. SSE exists and is complete, but is completely unadvertised.

- `POST /v1/stream-tickets` (`web-northbound.mjs:1270`) → `GET /v1/events?ticket=…`
  (`web-northbound.mjs:1431`). Tickets are single-use, 15s TTL (`web-stream.mjs:210`,
  `web-stream.mjs:289`), bound to principal+origin+repoId (+ runId/channel/recipient/cursor for
  run scope). Channels `progress` / `events` / `output`.
- No surface text (card, help, `application.help`) mentions stream-tickets or `/v1/events`. An
  orchestrator that wants to subscribe must read `web-stream.mjs` to learn the two-step dance and
  the `last-event-id` resume header (`web-northbound.mjs:1434`).
- **Subscribe ≠ zero-poll.** The server-side pump calls `run.inspect` under the hood at
  `pollMs = 100` (`web-stream.mjs:218`), one `depth:'content'` read per channel per tick
  (`web-stream.mjs:585-630`). SSE moves the poll server-side; it does not remove it.

### D5. run_view/run_act ergonomics are genuinely good — the rest of the surface is the problem.

- `run.act` self-describes: each view action carries `actionId`, `kind`, `do.action`,
  `do.inputs` (server-derived), `inputSchema` (server-tightened enums/defaults), `serverDerived`,
  `effect`, `requiredCapabilities`, `destructive/irreversible/idempotent`, and a `freshness`
  object with `viewDigest` (`application.mjs:9997-10033`). A fresh agent can drive a run blind
  from the view alone — **if** it already knows the underscore spelling and envelope shape.
- `actionId`s are digest-keyed and view-freshness-bound (`_semanticActionId`,
  `application.mjs:8367-8376`; freshness `application.mjs:10016-10018`). They cannot be guessed or
  pre-minted; they must be read from the current view. Preflight exists (`/v1/action-authority`,
  `web-northbound.mjs:1357-1429`) and is used by the CLI client (`application-cli.mjs:2055-2057`),
  but nothing advertises it on the card/help.
- `run.answer` needs `requestId` (an attention entry id) — discoverable from the view, fine.

---

## 3. Error-quality sweep

`execute()` wraps every `validateEnvelope` failure as `400 invalid_command` with the validator's
string as the only message (`web-northbound.mjs:762`). Dispatch-time failures go through
`dispatchFailure` (`web-northbound.mjs:185-284`).

| Site | What the caller sees | Actionability |
|---|---|---|
| `validateEnvelope` unknown top-level field (`web-northbound.mjs:400`) | `unknown_top_level_field` | ❌ does **not** name the offending key. The validator *knows* it (`Object.keys(envelope).find(...)`); it discards the key. |
| `validateEnvelope` unknown arg field (`web-northbound.mjs:412`) | `unknown_argument_field` | ❌ does **not** name the offending arg key (same discard). |
| `validateEnvelope` unknown command (`web-northbound.mjs:405`) | `unsupported command` | ❌ no hint of the underscore rule or the admitted set (§D1). |
| `validateEnvelope` arg-shape failure (`web-northbound.mjs:416`) | `application_command_arguments_invalid` | ❌ swallows the **named** validator refusal. `validateApplicationCommandArgs` throws specific messages (e.g. run.act `exactObject(['runId','actionId','inputs'], …)` at `application.mjs:1988-1992`); the web reduces them to one code. |
| `validateEnvelope` run_wait ceiling (`web-northbound.mjs:417`) | `application_wait_timeout_exceeds_web_ceiling` | ❌ names a ceiling but not its value (30_000). |
| `_authorize` origin/CSRF/repoId/capability (`web-northbound.mjs:666-682`) | `403 forbidden` | ❌ four distinct preconditions collapse to one code; an agent cannot tell whether the Origin header, `envelope.origin`, `repoId`, or a capability is wrong. |
| `dispatchFailure` fallback (`web-northbound.mjs:283`) | `503 temporarily_unavailable: command dispatch failed` | ❌ catches **everything** not explicitly mapped, including coaching refusals (§E1). |
| `GET /v1/commands/:commandId` ownership (`web-northbound.mjs:1553` / `:1562`) | `403 forbidden` / `404 not_found` | ⚠️ not-found-vs-forbidden deliberately merged (no existence oracle) — correct security posture, but the caller cannot distinguish "wrong id" from "wrong session". |

### E1. Coaching refusals are destroyed at the web edge.

`coachingApplicationError` throws `{ code: 'size_exceeded', cap, actual, unit: 'bytes',
gracefulPath }` with a composed message (`application.mjs:241-251`). Two web-reachable sites:
`run.workstream.notify` message ceiling (`application.mjs:1957`) and `run.start` oversize
objective past the spill ceiling (`application.mjs:4507`). `size_exceeded` is **not** handled in
`dispatchFailure` (grep for `size_exceeded` in `web-northbound.mjs` returns nothing), so both
collapse to the generic `503 command dispatch failed` — the `{cap, actual, unit, gracefulPath}`
payload and the composed coaching message are dropped. The CLI/MCP surfaces preserve them. (#129,
#139 territory.)

### E2. Typed refusal coverage that DOES work (for contrast).

`worker_policy_*` → 400/409, `application_unauthorized` → 403, `application_profile_not_found`
→ 404 with a fix hint, `application_run_view_oversize` → 503 projection-unavailable,
goal/plan code families → 400/409/403 (`web-northbound.mjs:186-280`), wave lane refusals
`wave_member_invalid` / `wave_not_found` carry the lane's own message byte-identically
(`web-northbound.mjs:278-282`). The typed map is broad; the gaps are the unmapped tail and the
validator's field-discarding refusals.

---

## 4. Grammar findings

### G1. Dot (advertised) vs underscore (admitted) — the core divergence.

The card, `application.help` examples, `defaultOperations`, and the continuation descriptor all
use dot-spelled names; the wire admits underscore transports only. This is the single highest-cost
grammar inconsistency on the surface (§D1). The admission identity records `envelope.command`
verbatim (`web-northbound.mjs:775` scopeKey; M4B-1), so spelling is identity — a change to accept
dots is an admission-identity decision (see DECISION_REQUEST below).

### G2. CLI_WEB_COMMANDS is a superset of the web admission list.

`CLI_WEB_COMMANDS` (`application-cli.mjs:16-32`) whitelists the 8 workflow facade ports
(`run.message.send`, `run.board.post`, …) plus `waves.attach/start/list/progress/run` — but the
web refuses the 8 facade ports because they are not in `APPLICATION_COMMAND_DEFINITIONS` and not
in `COMMAND_CAPABILITY` (they are direct ports dispatched pre-table, `application.mjs:12464-12470`).
A CLI client driving a web deployment happily POSTs `run_message_send` (`application-cli.mjs:2013`
whitelist passes, `:2015` underscores it) and always gets `400 unsupported command`. The CLI's
web-client whitelist and the web's admission list are maintained separately and diverge.

### G3. Three spellings per operation; canonical aliases never advertised.

`run.view` (canonical, dot) / `run.inspect` (legacy, dot, what the card and continuation use) /
`run_view` (canonical, underscore, admitted) / `run_inspect` (legacy, underscore, admitted) all
name one operation (`application-semantics.mjs:742-780`, `web-northbound.mjs:16-24`). The card
lists `run.inspect`; the canonical registry calls it `run.view`; the wire admits `run_view` and
`run_inspect`. An agent cross-reading surfaces sees three spellings and no map.

### G4. Consistent conventions worth keeping.

Idempotency is uniform: `scopeKey = hash(userId, command, repoId, idempotencyKey)` +
`requestDigest` (`web-northbound.mjs:775-777`), replays return `replayed: true` with 202
`status:'admitted'` while in-flight (`web-northbound.mjs:912`). READ_ONLY commands observe
through a bounded cache. Envelope versioning is single (`schemaVersion: 1`). Wave pagination is
uniform `{cursor, nextCursor}` (`application.mjs` waveProgress/waveList). These are the parts to
keep.

---

## 5. Steering-fitness gaps

An orchestrator CAN observe and steer end-to-end through the bus today:

- **Observe**: `run_inspect` / `run_status` (phase, progressClass, attention), `waves_list` /
  `waves_progress` (member roster, per-member phase/attention), `run_follow` (push-poll), and the
  full SSE machine (§D4) for subscription.
- **Steer**: `run_act` (semantic actions, server-derived inputs), `run_answer` (attention
  replies), `run_feedback`, `run_workstream_notify`, `run_approve`, `waves_send`, and the stop
  family (`run_stop`, `run_workstream_stop`, `waves_stop`).

Gaps:

1. **SSE is unadvertised and is still a poll underneath** (§D4). An orchestrator that wants
   subscribe-must-read-code; and even subscribed, the bus is a `run.inspect` pump at 100ms, not a
   native event bus. The honest ask for #132 follow-ups is to advertise the routes on the card and
   document the ticket/resume contract.
2. **The continuation descriptor teaches a refused spelling** (§D1 worst instance) — the steering
   loop's own "next cursor" handshake costs a 400 per fresh driver.
3. **The origin/repoId/capability footgun** is a first-call cost for every new orchestrator
   (§D3, E1 `_authorize`).
4. **Preflight (`/v1/action-authority`) exists but is unadvertised** — a capable orchestrator that
   wants to validate an action before dispatch cannot learn the endpoint exists.
5. **Cursor continuation is present but the resume story is scattered**: `run.inspect` returns
   `cursor`; the continuation descriptor names `cursorArgument` (`application-semantics.mjs:281-282`);
   `clientObservedCursor` exists in `TOP_LEVEL` (`web-northbound.mjs:109`) but nothing explains when
   to send it. This is the #136-class surface the row brief asks about — the machinery is complete,
   the teaching is absent.

---

## 6. Ranked friction list

Ranked by orchestrator cost (hours lost, mistakes induced). Evidence → cost → concrete fix →
issue cross-ref.

### F1. Card/help/continuation teach dot names the wire refuses; the refusal teaches nothing
- **Evidence**: card dot names `web-northbound.mjs:1521` + `:15`; wire underscore-only
  `web-northbound.mjs:87-105`, refusal `:405`; client-only rule `application-cli.mjs:2015`;
  continuation dot-spelled `application.mjs:10035-10057`, `application-semantics.mjs:281-282`.
- **Cost**: every first integration burns a `400 unsupported command` and a source dive; the
  surface's own continuation actively misleads.
- **Fix**: (surface) the card must advertise the **admitted transports verbatim**, and should carry
  the `{advertised → admitted}` map (§D1). (transport) Optionally accept dot spellings by resolving
  to the underscore transport exactly as the CLI client does — an admission-identity decision
  (the scopeKey records `envelope.command` verbatim, `web-northbound.mjs:775`), see DECISION_REQUEST.
- **Issue**: #139 (envelope error quality, #41-pattern) + NEW for the transport question.

### F2. Unknown-field refusals don't name the field
- **Evidence**: `web-northbound.mjs:400` (`unknown_top_level_field`), `:412`
  (`unknown_argument_field`) — the validator finds the key and discards it.
- **Cost**: `TOP_LEVEL` is exact (any extra field refuses), so every typo/extra field costs a
  round-trip with zero diagnostic.
- **Fix**: return the key in the body, e.g. `{ ok:false, error:{ code, message, field: <key> } }`.
  The validator already holds it.
- **Issue**: #139.

### F3. `application_command_arguments_invalid` swallows the named validator refusal
- **Evidence**: `web-northbound.mjs:416` catch → generic code; the underlying messages are specific
  (`application.mjs:1988-1992` run.act `exactObject`; run.start intent validation).
- **Cost**: an agent that sent a malformed `run_act` cannot see *which* of runId/actionId/inputs is
  wrong and cannot see the required shape.
- **Fix**: surface the validator message as `detail` (never leak values — the validator messages
  name fields and shapes, not content).
- **Issue**: #139.

### F4. Coaching `size_exceeded` refusals collapse to a generic 503
- **Evidence**: `application.mjs:1957`, `:4507` throw `size_exceeded` with
  `{cap, actual, unit, gracefulPath}`; `dispatchFailure` has no `size_exceeded` arm →
  fallback `503 command dispatch failed` (`web-northbound.mjs:283`); grep confirms no handler.
- **Cost**: an agent that oversizes a `run.workstream.notify` message or a `run.start` objective
  hits an opaque 503 and cannot learn the cap or the graceful spill path; it retries blind.
- **Fix**: map `size_exceeded` (and `spill_body_exceeded`) to a 400/413 with the coaching payload
  preserved, mirroring the CLI/MCP surfaces.
- **Issue**: #129 (silent oversize refusal), #139.

### F5. SSE routes unadvertised; subscribe is still a 100ms run.inspect poll
- **Evidence**: routes `web-northbound.mjs:1270` (tickets), `:1431` (`/v1/events`); no surface text
  mentions them; pump polls `run.inspect` at `pollMs=100` (`web-stream.mjs:218`), per-channel reads
  `web-stream.mjs:585-630`.
- **Cost**: an orchestrator that wants subscribe-must-read-code; a caller who assumes SSE is a
  native bus over-invests in client machinery that is really just a server-side poll relay.
- **Fix**: card advertises a `streams` capability + ticket shape; help documents the two-step dance,
  the 15s single-use TTL, the channels, and the `last-event-id` resume header.
- **Issue**: #132 follow-ups / NEW.

### F6. run_wait ceiling refusal doesn't state the ceiling
- **Evidence**: `web-northbound.mjs:417` → `application_wait_timeout_exceeds_web_ceiling`; the
  30_000 value appears only in the code, never in the message.
- **Cost**: an agent sends `timeoutMs: 60000`, gets a code naming a ceiling but not its value; it
  must binary-search or read source.
- **Fix**: include the ceiling in the message (e.g. `…(max 30000ms)`).
- **Issue**: #139.

### F7. CLI_WEB_COMMANDS whitelist advertises 8 ports the web refuses
- **Evidence**: `application-cli.mjs:16-32` includes `run.message.send`, `run.board.post`, …
  `:2013` gates on it; web admission has no such entries (`web-northbound.mjs:87-105`); direct
  ports `application.mjs:12464-12470`.
- **Cost**: a CLI client pointed at a web deployment can dispatch a command that is guaranteed to
  `400 unsupported command` — a silent parity trap that only manifests at runtime.
- **Fix**: split `CLI_WEB_COMMANDS` into host-local vs web-admitted; derive the web client's gate
  from the same admission table the web surface uses.
- **Issue**: NEW.

### F8. `_authorize` collapses four failure classes into one `403 forbidden`
- **Evidence**: `web-northbound.mjs:666-682` (origin mismatch, CSRF, repoId, capability → all
  `forbidden`).
- **Cost**: origin vs capability vs repoId mistakes are indistinguishable; a first-call agent that
  gets the origin wrong is told nothing useful.
- **Fix**: distinct codes (or a `detail.precondition` field) naming the failed check.
- **Issue**: #139.

### F9. Three spellings per operation with no surface map
- **Evidence**: `application-semantics.mjs:742-780` (aliases), `web-northbound.mjs:16-24`
  (canonical transports admitted), card `:1521` (dot names only).
- **Cost**: cross-reading surfaces induces spelling confusion; the canonical alias story is
  knowable only from code.
- **Fix**: card advertises the canonical operation with the transport each surface admits, or
  carries an alias table.
- **Issue**: NEW (grammar-verdict territory for the coordinator).

---

## 7. Authority-class escalations

### DECISION_REQUEST 1 — where does the dot/underscore fix live?

The audit's sharpest finding (F1) has two incompatible fixes with different blast radii, and the
choice changes what "done" means:

- **Option A — advertise what the wire admits (surface-only).** Card, `application.help`, and the
  continuation descriptor switch to (or additionally carry) the admitted underscore transports and
  the `{advertised → admitted}` map. Zero admission-identity change; M4B-1 scope keys unchanged;
  no replay/reconciliation risk. Cost: the card reads uglier (underscore transports) unless the map
  is additive.
- **Option B — admit what the surfaces advertise (transport change).** `validateEnvelope` resolves
  dot-spelled commands to their underscore transport (mirroring `application-cli.mjs:2015`)
  **before** the scopeKey is computed, so the admission identity is the resolved transport.
  Requires an explicit M4B-1 decision: the scope key currently records `envelope.command` verbatim
  (`web-northbound.mjs:775`), so naive dot-acceptance would create parallel admission identities
  and break reconciliation across spellings. Fixing that is an admission-identity change.
- **Option C — keep the wire, add a taught map.** Surface-only, plus the card carries the
  `{advertised → admitted}` mapping table (each dot name next to its transport) so the rule is
  learnable from the surface without reading source.

My recommendation: **A or C** (surface-level, no admission-identity change), with the map in the
card. B is only worth it if the coordinator wants the wire to be spelling-agnostic across all
surfaces — that is a grammar-verdict decision, not a row decision.

Free response: which surfaces should own the canonical spelling after this audit? (The MCP row and
CLI row are auditing their own dot/underscore handling; the unified grammar verdict in
`control-surface-audit.md` may supersede any single-surface fix.)

---

## 8. Style calls recorded

- **Cross-ref policy**: existing issues cited where the ledger/PROGRESS.md names them (#129, #132,
  #136, #139); NEW where no issue covers the finding. I did not locate a documented #146 beyond the
  brief's cross-ref list — none of my findings map to it with confidence, so I mark NEW rather than
  guess.
- **Citation discipline**: `application.mjs`/`coordination-store.mjs` cited via `grep -an`/`sed -n`
  (NUL files). Every claim carries `file:line` read this session.
- **Token files**: noted existence/permissions/discovery ergonomics only; no token contents printed.
- **No clocks**: no wall-clock claims.
- **Read-only posture**: no files modified outside `docs/reference/evidence/control-surface-audit-2026-08-13/**`.
- **Scratchpad**: this report is posted to the `shared` partition per the shared-layer law; the file
  above is the durable artifact.

---

## 9. One-line verdict for the coordinator

The web/resident bus has the most complete capability surface of the three, the best
self-describing run/act ergonomics, and the worst self-teaching: the single dot/underscore
spelling gap (F1) plus the field-naming refusals (F2/F3/F8) force every fresh orchestrator to read
source for what the surface could say in one error body — and the coaching refusals (F4) that the
CLI/MCP preserve are destroyed at this edge.
