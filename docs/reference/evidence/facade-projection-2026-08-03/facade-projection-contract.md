# Epic #87 — Facade projection of the BD3-C/D message and attention lanes (v1.0)

Status: implementation contract, pre-red-team. This epic specifies behavior; it does not amend
implementation in this artifact. It is an L2 surfacing epic over the landed BD3-C/D coordinator
lanes (726e34a), sibling to #78 (board worker-half) and #86 (worker reply wire grammar, landed).

## Seed

Issue #87 (gh issue view 87, 2026-08-03): `coordinator.sendMessage`,
`coordinator.messageReceipt`, and `coordinator.attentionFollow` (BD3-C/D, landed 726e34a) exist
only at the coordinator level. The application facade's named-command surface
(`impl/src/application.mjs:1674-1883` validation, `:11985-12100+` dispatch) has NO message or
attention lane, and the MCP tool surface (post-5bda319) therefore cannot reach them either. An
orchestrator driving through the facade/MCP — the primary agent-facing surface per the MCP-first
direction — cannot message a worker, read a receipt, or follow an attention item without dropping
to the embedded `createDriver` stack. The issue's fix shape: facade commands `run.message.send`
({runId|workerId, kind, body} → {messageId, delivered, targetCount}), `run.message.receipt`
({messageId} → {delivered, read, actedOn, reply}), `run.attention.follow` ({runId, kind, cursor?}
→ page), same auth/validation idiom as `run.steer`, ordinary-plane, then MCP tool projections
with the wave-tools' envelope shape. Related: #86 (reply wire grammar), #89 (frame-economics
honesty), #75 (BD3 spine), #10 (AX spine), #92 (messageId in the delivery frame).

One naming correction to the issue's example spelling is forced by evidence and taken in
Decision 2: `follow` is a banned canonical surface verb, so the attention command lands as
`run.attention.watch`.

The behaviors being projected are pinned by the BD3 v2.0 contract's C/D sections
(`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:54-103`) and
by the landed red suite (`impl/test/bidirectional-v3-red.test.mjs` — C0:C0b 414/434, C1 457,
C1b 487, C2 502, C3 526, C4 590, C5 603, C3b 618, C6 632, D1 646, D2 668, D3 692, D4 724,
D5 747). The campaign control law is binding
(`bidirectional-v3-decisions.md:134-144`): this epic adds no clocks, turn limits, or cadence
controls; the projected long-poll question is resolved honestly in Decision 5.

## Code-verified ground truth

The anchors below were checked in this worktree on 2026-08-03. `impl/src/application.mjs`
contains NUL bytes and was inspected with NUL-safe `grep -an` + targeted `sed -n` only.

1. **The message lane (BD3-C) is landed and closed.** `coordinator.sendMessage({kind, to, body},
   auth)` (`impl/src/coordinator.mjs:6577-6647`) admits kind ∈ {inform, query, steer}
   (`:6579-6581`), a non-empty body of at most 2,048 BYTES (`Buffer.byteLength(body) > 2_048`,
   `:6582-6584`), and a target of exactly `{workerId}` XOR `{runId}` (`:6585-6589`). Validation
   failures throw BARE TypeErrors (no `.code`). An inactive worker target returns
   `{ok: false, result: 'worker_not_active'}` and an empty run target returns
   `{ok: false, result: 'run_not_active'}` — typed OUTCOMES, not throws (`:6590-6598`). A send
   mints `message:<64 lowercase hex>` (`:6599`; the shape is pinned by C1 at
   `bidirectional-v3-red.test.mjs:457`), writes best-effort durable `message.sent` /
   `message.delivered` audit events (`:6605-6638`), delivers at most one copy per member (C5,
   `bidirectional-v3-red.test.mjs:603`), and frames the body `[MESSAGE <kind> — UNTRUSTED]`
   carrying the messageId (`:6618`; C6/#92, `bidirectional-v3-red.test.mjs:632`). It returns
   `{ok: true, result: 'sent', messageId, delivered, targetCount}` (`:6643-6647`). The `auth`
   argument is attribution only — the lane performs no authorization of its own (`void auth`,
   `:6642`).

2. **The receipt state machine (BD3-C) is landed and honest.** `coordinator.messageReceipt
   (messageId)` (`impl/src/coordinator.mjs:6652-6673`) returns `null` for an unknown id
   (`:6653-6654`) and otherwise exactly `{delivered, read, actedOn, reply}` (`:6665-6673`):
   `delivered` = written to the worker's durable stream (true|null), `read` = the worker's first
   `turn_started` in the SAME process generation (true|null; a respawned worker does NOT inherit
   its predecessor's reads — C3b, `bidirectional-v3-red.test.mjs:618`), `actedOn` is always
   `null` (never claimed), `reply` carries the worker's closed `{messageId, inReplyTo, from,
   body}` when admitted (C1/C1b: smuggled fields never reach the receipt). Death between
   delivered and read leaves `read: null` forever (C3, `:526`). Reply depth is 1 (C2, `:502`).

3. **The attention inbox (BD3-D) is landed, scope-first, and additive.**
   `coordinator.attentionFollow({scope, targets, afterCursor, timeoutMs}, principal)`
   (`impl/src/coordinator.mjs:6677-6718`) validates scope as exactly `{runId}` with an id-shaped
   value (`attention_scope_invalid`, `:6679-6685`), authorizes the caller's parent scope FIRST
   (`attention_scope_forbidden`, `:6690-6693` via `_attentionScopeAuthorized`,
   `:6720-6726`), then normalizes targets server-side: a `{runId}` target outside the scope
   refuses `attention_scope_forbidden` IDENTICALLY to an unknown one — before any existence
   check (`:6699-6705`; D1, `bidirectional-v3-red.test.mjs:646`); a malformed target refuses
   `attention_target_invalid` (`:6706-6709`). It returns `{reasons, throughCursor, afterCursor,
   runId}` (`:6711-6717`). `timeoutMs` is destructured but NEVER referenced in the body
   (`:6677-6718`): the landed lane is an immediate cursor page, not a long-poll.

4. **The attention authority model is principal-shaped and lane-resident.** The deployment's
   orchestrator principal (`principalId === 'wave-owner'`) is the viewer of record
   (`impl/src/coordinator.mjs:6723-6724`); a run-scoped follow also admits a live
   run-orchestrator lease holder whose session belongs to the caller
   (`_isReviewAuthority`, `:6728-6740`, consulting
   `activeRunOrchestratorLeaseForSession(runId, sessionId)`). `candidacy_review` is disclosed
   ONLY to the review authority, derived live from the candidacy queue
   (`_attentionPage`, `:6742-6773`; D2, `bidirectional-v3-red.test.mjs:668`). Storm coalescing
   emits an explicit `count` + `perPhase` distribution and drops singular member identity
   (`_mintMemberTerminal`, `:6780-6807`, window `ATTENTION_COALESCE_WINDOW_MS = 500`,
   `:44`; D3, `:692`). Wake reasons minted after a member's terminal transition carry
   `memberState: 'terminal-at-mint'` (D4, `:724`). The landed wake vocabulary is exactly two
   kinds — `member_terminal` (`impl/src/coordinator.mjs:6785`) and `candidacy_review` (`:6763`);
   `grep -an` finds no `decision_pending` / `blocked_interaction` / `deadline_approaching` mint
   sites. The wave driver's stall machinery is deliberately NOT a consumer (D5 pin:
   `wave-driver.mjs` must stay free of `attentionFollow`, `bidirectional-v3-red.test.mjs:747`).

5. **The facade's named-command surface has no message or attention lane.** The `command(name,
   args, principal, context)` entry point (`impl/src/application.mjs:11985`; the issue's
   "application.invoke" phrasing maps to this method — facade-level suites drive
   `f.application.command(...)`, e.g. `impl/test/phase77-recursive-application-red.test.mjs:416`)
   dispatches the byte-stable command table plus direct ports; `grep -an "name === '"` finds no
   message/attention dispatch anywhere in the file. The descriptor-driven facade's card likewise
   advertises only command-table keys + `waves.attach` (`impl/src/mcp-descriptor.mjs:148`).

6. **The command table is byte-stable; new commands must be direct ports.**
   `APPLICATION_COMMAND_DEFINITIONS` (`impl/src/application.mjs:149`) is pinned byte-stable —
   `grammar-m3-red` pins `Object.keys(APPLICATION_COMMAND_DEFINITIONS)` (`:191-192`). The
   established pattern for post-table commands is the DIRECT PORT, dispatched inside `command()`
   BEFORE `validateApplicationCommandArgs` and before the recursive-session gate: `run.debug`
   (`:12001-12003`), `run.steer` (`:12005-12009`, itself deleted from every surface at docs/36
   §9 M5), the four settlement commands (`:12011-12018`, embedded-only), and the wave-ergonomics
   ports `waves.start/progress/send/stop` + `deployment.doctor` (`:12020-12029` — "NOT
   APPLICATION_COMMAND_DEFINITIONS entries, so the byte-stable command-table key set is
   unchanged"). The recursive-session gate (`run_orchestrator_command_forbidden`,
   `:12031-12038`) applies only to command-table commands.

7. **The facade validation/authorization idiom.** `applicationError(message, code)` (`:222-224`);
   closed-arg validation via `exactObject` (exact key set, `:281-285`) or the allowed-set
   pattern (`Object.keys(args).some((key) => !allowed.has(key))`, `:1815-1817`, and the wave
   direct-port normalizers `_normalizeWaveStart`/`_normalizeWaveMemberAction`, `:11434`,
   `:11476`); `validId` = `^[A-Za-z0-9._:-]{1,256}$` (`:288`); `validText(value, maxBytes)` byte-
   and NUL-bounded (`:289-291`); `normalizePrincipal` requires exactly `{actor, principalId,
   sessionId}` (`:963-969`). `run.steer` is the model: `normalizeSteer` closes the shape with
   `application_steer_invalid` and scans for secret-shaped text (`:889-896`); `steer()` then
   awaits the host-injected policy `this._authorize('run.steer', principal, runId, subject)`
   with digest-bound subject fields (`:12197-12222`; `_authorize` throws
   `application_unauthorized`, `:3025-3034`; `options.authorize` is a REQUIRED constructor
   injection, `:2295-2305`, and facade-level suites stub it as `authorize: async () => true`,
   e.g. `impl/test/mcp-packaging-red.test.mjs:556`). Target resolution is server-side via
   `coordinator.list()` with the constant `application_worker_not_found` refusal
   (`:12211-12212`; same pattern in `sendWaveMember`, `:11404-11420`).

8. **The MCP tool-projection shape (post-5bda319).** Ordinary-surface tools are entries in
   `ORDINARY_APPLICATION_TOOL_DEFINITIONS` with CLOSED schemas — the `schema()` helper emits
   `additionalProperties: false` (`impl/src/mcp-northbound.mjs:246-248`) — and a `_meta`
   registry-digest stamp (`:558-561`). The wave tools are the envelope model
   (`baton_waves_start` `:456-472`, `baton_waves_progress` `:473-481`, `baton_waves_send`
   `:482-489`, `baton_waves_stop` `:490-496`). Each tool needs: a `CAPABILITY` registration
   (`baton_waves_send: ['control', 'observe']` etc., `:96-99`) — an unregistered tool computes
   `[undefined]` and refuses `forbidden` in `_authority` (`:86-89`, `:1141-1152`); a hand-rolled
   shape guard returning `invalid_*` (`:976-1020` — "no schema evaluator, hand-rolled validation
   stays the authority"); an explicit `_dispatch` branch calling `application.command('waves.*',
   …)` with the CONNECTION-derived principal (`{actor, principalId, sessionId}`), never tool
   arguments (`:1536-1573`); and membership in `ORDINARY_EXPLICIT_TOOLS` so failures reach the
   typed `stateFailureCode` lane, never generic `command_failed` (`:699-705`).
   `waves.send`/`waves.stop` deliberately carry NO `idempotencyKey` and stay OUT of
   `STATEFUL`/`RECONCILABLE` (`:120-127`). Tool errors map through `stateFailureCode`
   (`:187-240`): `application_unauthorized` → `forbidden` (`:189`), `application_*` codes pass
   through (`:193`), a bare TypeError → `invalid_command` (`:238`), and any unmapped code falls
   to `command_outcome_unknown` (`:239`). The `attention_*` codes are NOT mapped today.

9. **The settlement envelope is a different plane and stays untouched.** The four settlement
   tools ride the S-2 `sessionAuthority` envelope: `baton_knowledge_promote` requires
   `_boardAuthorityContext(principal).sessionAuthority`, refusing `board_lease_required`
   (`impl/src/mcp-northbound.mjs:1600-1615`), and `baton_knowledge_settlement_lease` requires an
   explicit `settlement` capability class on the descriptor principal (never defaulted,
   `:104`, `:1616-1624`; `impl/src/mcp-descriptor.mjs:47-48`; `impl/MCP.md:97-108`). The new
   lanes are ordinary-plane: no `sessionAuthority`, no lease, no settlement capability anywhere
   in their schemas or dispatch.

10. **The CLI verb idiom supports the verbs, with one mechanism note.** `parseBatonCli` handles
    `baton run <action>` via a single-token `lifecycleActions` set
    (`impl/src/application-cli.mjs:1358-1361`; unknown actions fall through to `parseStart`),
    with early pre-`runId` branches for special shapes (`start`, `:1354-1356`) and positional
    sub-arguments after `runId` (`episode [TOPIC]`, `:1364-1370`; `workstreams [ROLE]`,
    `:1371-1388`). Parse results of `{kind: 'command', name, args, idempotencyKey}` dispatch
    through the web-client whitelist gate `CLI_WEB_COMMANDS` (`:15-25`, enforced at `:1792` —
    `cli_command_unavailable` otherwise). The CLI help/render model is DERIVED from registry
    canonical operations with the `cli` surface (`canonicalCliRenderModel`, `:835-850`), and
    surface spellings derive mechanically: `cli: baton ${parts.join(' ')}`,
    `mcp: baton_${parts.join('_')}` (`impl/src/application-semantics.mjs:1135-1140`). Registry
    rows for the wave ports show the required shape (`profile: 'ordinary'`,
    `surfaces: ['embedded', 'mcp', 'cli']`, `capabilities`, `inputSchema`, `example`,
    `:1556-1600`; `buildCanonicalOperation`, `:1819-1861`).

11. **Generated-inventory conformance is executable and pinned.** `servedCliOrdinaryKeys()`
    renders the served CLI inventory from the whitelist→canonical mapping
    (`impl/scripts/render-surface-docs.mjs:34-75`); `renderMcpToolInventory()` renders from the
    REAL tool table (`mcpApplicationToolNames()`, `:95-119`, backed by
    `impl/src/mcp-northbound.mjs:1921-1923`). `node impl/scripts/render-surface-docs.mjs`
    rewrites the CLI.md (`impl/CLI.md:18-46`) and MCP.md (`impl/MCP.md:110-142`) generated
    blocks in place; `--check` fails on drift (`render-surface-docs.mjs:145-165`).
    `checkSurfaceDocs() === []` is pinned by three suites
    (`impl/test/control-surface-truth-red.test.mjs:163`, `impl/test/grammar-m4b-red.test.mjs:193`,
    `impl/test/run-debug-surface-red.test.mjs:230`), and
    `node impl/scripts/surface-conformance.mjs` must print `surface-conformance: ok`
    (pinned at `control-surface-truth-red.test.mjs:65-73`; verified green in this worktree
    2026-08-03). The conformance main also enforces the CS-4 checked inventory artifact
    (`impl/scripts/surface-conformance.mjs:652-678` — counts include `canonicalOperations`,
    `cliWebCommands`, `mcpApplicationTools`; regenerate via `--write-inventory`) and the C4
    banned-surface-verb lint.

12. **`follow` is a BANNED canonical surface verb.** `BANNED_SURFACE_VERBS` includes `follow`,
    `steer`, `progress`, `wait`, and nine others (`impl/scripts/surface-conformance.mjs:196-199`);
    the lint scans every canonical operation's key and ALL derived surface names
    (`:710-718`), with exactly one documented exception (`waves.progress`). The canonical verb
    for following is `watch`: `run.watch` is the canonical operation whose
    `application.commands` alias is the legacy `run.follow`
    (`impl/src/application-semantics.mjs:1253-1258`, `:1760-1765`). A canonical
    `run.attention.follow` key would trip the C4 lint on every derived name.

13. **#89 frame-economics is binding** (gh issue view 89, 2026-08-03): scanners detect frames
    only; policy bounds live at ADMISSION as typed refusals that NAME THE CAP AND THE ACTUAL
    size; oversize degrades via spillover (lane-level work); parser scan windows (the 20,480
    grammar window pinned at `bidirectional-v3-red.test.mjs:448-455`) are substrate guards, not
    policy. #89 explicitly names `coordinator.sendMessage`'s bare TypeError over 2,048 bytes as
    a current sin — this epic does NOT fix the lane's refusal quality (that is #89's limits-
    registry rung), but its facade validation must already speak cap+actual, and it must NOT
    invent new caps.

14. **Quota and plane posture need no invention.** Ordinary MCP tools ride the standard per-call
    quota in `handle()` (`impl/src/mcp-northbound.mjs:1534-1535` comment; descriptor default
    `maxWaitMs: 25_000`, `maxMessageBytes: 256 KiB`, `impl/src/mcp-descriptor.mjs:197-198`), and
    the descriptor principal carries explicit capability classes
    (`impl/src/mcp-descriptor.mjs:103-109`, `:179-183`).

## Contract question

Can an orchestrator driving ONLY the application facade (and its MCP/CLI projections) send a
typed message to one worker or a whole run, read the honest receipt for that message, and page
the run's attention inbox — with every refusal the embedded lanes define arriving byte-
identically, no existence leak introduced by the projection, no new semantics, caps, clocks, or
authority envelopes — and can the conformance machinery prove the new surface is what the docs
say it is?

## Decisions

### 1. The projection law: reach, never semantics

The facade commands are PROJECTIONS of the landed coordinator lanes. The projection adds no
semantics: no new refusal classes the embedded path lacks, no existence checks the lane does
not perform, no pre-assertions (the facade does NOT call `_assertRunMutable` for these lanes —
contrast `steer()` at `impl/src/application.mjs:12209`), no closed wake-kind vocabulary (the
lane accepts arbitrary target-kind strings and filters, `impl/src/coordinator.mjs:6695-6709`,
so the facade validates shape only), no long-poll behavior the lane does not implement, and no
response-field invention. Lane outcomes pass through VERBATIM: coordinator return values are
returned with only the facade's envelope marker (`schemaVersion: 1`, the wave-port envelope
shape, `:11359`, `:11420`) added; coordinator-thrown coded refusals propagate with their
`.code` untouched. Facade-side validation is EXACTLY as permissive as the lane's — never
narrower (a facade refusal the lane would not produce is a semantics change), never wider (a
bare coordinator TypeError reaching a facade caller is an honesty failure: those throws carry
no code, `impl/src/coordinator.mjs:6579-6589`, and would map to `invalid_command` at MCP,
`impl/src/mcp-northbound.mjs:238`). The only coordinator-side change this epic permits is a
read-only authorization accessor (Decision 3); lane logic is untouched.

**Rationale:** requirement 2 of this contract (refusal constancy through projection) is the
epic's reason to exist; the blue-team re-verifies it row by row.

### 2. Three direct-port commands; the attention verb is `watch`, not `follow`

Three new facade commands dispatch as DIRECT PORTS inside `command()` at the wave-ports
position — BEFORE `validateApplicationCommandArgs` and before the recursive-session gate
(`impl/src/application.mjs:12020-12038` is the insertion neighborhood; the byte-stable
`APPLICATION_COMMAND_DEFINITIONS` table is untouched, `:149`, `:191-192`):

- `run.message.send`
- `run.message.receipt`
- `run.attention.watch`

The issue's example spelling `run.attention.follow` is corrected: `follow` is a banned
canonical surface verb (ground truth 12), so the canonical key — and therefore the derived CLI
spelling `baton run attention watch` and MCP tool `baton_run_attention_watch`
(`impl/src/application-semantics.mjs:1135-1140`) — uses `watch`, exactly as `run.watch` is the
canonical of legacy `run.follow` (`:1253-1258`, `:1760-1765`). The coordinator method keeps its
landed name (`attentionFollow`); only the surface key changes.

Dispatch position is a refusal-constancy decision, not convenience: the recursive-session gate
(`run_orchestrator_command_forbidden`, `impl/src/application.mjs:12031-12038`) would refuse a
run-orchestrator lease holder BEFORE the lane's own authorization runs — but BD3-D deliberately
admits a live run-orchestrator lease holder as review authority (`impl/src/coordinator.mjs:
6728-6740`). Placing the ports behind the gate would add a refusal the embedded path lacks.

Each command validates through its own closed normalizer in the wave-port idiom (allowed-set
closure, `:1815-1817`, `:11434-11444`), throws the facade's `application_*` vocabulary, then
normalizes the principal (`normalizePrincipal`, `:963-969`). Wire arguments NEVER carry
principal fields; the principal comes from the authenticated connection/context.

**Rationale:** direct ports preserve the grammar-m3 byte-stable pin (ground truth 6) and match
the wave-ergonomics precedent the issue names.

### 3. `run.message.send` — steer-idiom authorization, verbatim lane outcomes

Request shape (closed): `{runId?, workerId?, kind, body}` — exactly one of `runId`/`workerId`
(the lane's XOR, `impl/src/coordinator.mjs:6585-6589`), `kind` ∈ {inform, query, steer}
(`:6579-6581`), `body` non-empty and ≤ 2,048 BYTES (`:6582-6584`). Failures refuse
`application_message_send_invalid`; the oversize refusal names cap and actual (Decision 8).

Authorization follows the `steer()` idiom (`impl/src/application.mjs:12197-12222`): the facade
resolves the target run SERVER-SIDE — directly for a `runId` target; via `coordinator.list()`
(`:11410` precedent) for a `workerId` target — and calls `_authorize('run.message.send',
principal, resolvedRunId, {kind, targetKind, bodyDigest: digest(body)})`. An unresolvable
`workerId` authorizes against a null run scope so an UNKNOWN worker and a FOREIGN worker refuse
identically (`application_unauthorized`) under any policy that distinguishes them; possession
of a worker id is never authority. The facade performs NO existence pre-checks of its own: on
authorization it delegates to `coordinator.sendMessage({kind, to: {workerId}|{runId}, body},
{actor: principal.actor})` and returns the lane outcome VERBATIM plus `schemaVersion: 1`:

- success: `{schemaVersion: 1, ok: true, result: 'sent', messageId, delivered, targetCount}`
  (the lane's return, `impl/src/coordinator.mjs:6643-6647`);
- inactive target: `{schemaVersion: 1, ok: false, result: 'worker_not_active'}` or
  `{schemaVersion: 1, ok: false, result: 'run_not_active'}` — the lane's exact outcome object
  (`:6590-6598`), never re-coded, never padded with fabricated fields.

**Rationale:** the lane's outcome vocabulary is already typed and honest (ground truth 1); the
facade's job is the transported authority boundary (host policy, same as steer), not new
semantics.

### 4. `run.message.receipt` — resolve-then-authorize, then a verbatim receipt

Request shape (closed): `{messageId}` matching `^message:[a-f0-9]{64}$` (the minted shape,
pinned at `impl/test/bidirectional-v3-red.test.mjs:457`); shape failures refuse
`application_message_receipt_invalid`.

Authorization is RESOLVE-THEN-AUTHORIZE, the BD3-A finding-by-id law
(`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:19-21` —
possession of a digest is never authority): a new READ-ONLY coordinator accessor (e.g.
`coordinator.messageRunId(messageId)` — the one coordinator-side change this epic permits;
Decision 1) resolves the message's target run for authorization ONLY, never projecting it. An
unknown messageId resolves to no run, so unknown ≡ foreign ≡ the constant
`application_unauthorized` — no existence leak on message ids, and the lane's `null`-for-
unknown return (`impl/src/coordinator.mjs:6653-6654`) is UNREACHABLE through the facade.

On authorization the facade returns the receipt VERBATIM plus the envelope marker:
`{schemaVersion: 1, messageId, delivered, read, actedOn, reply}` with the lane's exact state
machine (`:6665-6673`): `delivered`/`read` ∈ {true, null}, `actedOn` always null, `reply` the
closed `{messageId, inReplyTo, from, body}` or null. The facade never upgrades, infers, or
annotates receipt state; process-scoping (C3/C3b) is the lane's, projected as-is.

**Rationale:** the receipt is the lane's honesty artifact; the facade's only added decision is
WHO may read it, decided with the system's established digest-is-not-authority law.

### 5. `run.attention.watch` — the lane's own scope authority is the sole seam

Request shape (closed): `{runId, kind?, cursor?}` — `runId` id-shaped (`validId`,
`impl/src/application.mjs:288`), `kind` an optional id-shaped string validated SHAPE-ONLY (the
lane closes no wake-kind vocabulary; ground truth 3 and Decision 1), `cursor` an optional safe
integer ≥ 0 (the `run.follow` cursor discipline, `:1849-1853`). Shape failures refuse
`application_attention_watch_invalid`.

The facade delegates with NO authorization pre-check of its own: `coordinator.attentionFollow(
{scope: {runId}, targets: kind === undefined ? [] : [kind], afterCursor: cursor ?? 0,
timeoutMs: undefined}, {principalId: principal.principalId, sessionId: principal.sessionId})`.
The lane's scope-first authorization (`attention_scope_invalid` / `attention_scope_forbidden` /
`attention_target_invalid`, `impl/src/coordinator.mjs:6679-6709`) is the sole authority seam —
the `_settlementCommand` precedent, where the lane's own authority governs and the facade adds
no `_authorize` (`impl/src/application.mjs:12174-12194`). A facade `_authorize` on the requested
runId would introduce an existence check the embedded path lacks (for the orchestrator
principal, an unknown scope runId pages EMPTY at the lane — it does not refuse) and would break
the D1 constant. The coded refusals propagate byte-identically; the page returns VERBATIM:
`{schemaVersion: 1, runId, afterCursor, throughCursor, reasons}` with every reason's
`{seq, kind, runId, mintEpoch, count, perPhase, windowMs, memberState, …}` untouched
(`impl/src/coordinator.mjs:6711-6717`, `:6780-6807`).

`timeoutMs` is NOT projected. The landed lane pages immediately and ignores it (ground truth
3); a facade that accepted a wait budget would promise behavior that does not exist. The MCP
bounded long-poll of the v0.9 dream shape (capped by the frame budget,
`impl/src/mcp-descriptor.mjs:197`) is a LANE-level rung first (it must exist in
`attentionFollow` before any surface projects it) — flagged in Open Questions.

**Rationale:** the D1/D2 pins (scope-first constancy; review-authority gating) live entirely
inside the lane and are principal-shaped; the facade transports the authenticated principal and
gets out of the way.

### 6. MCP projections — ordinary plane, wave-tools envelope, refusal constancy to the wire

Three new tools in `ORDINARY_APPLICATION_TOOL_DEFINITIONS` (closed `schema()` schemas with
`additionalProperties: false`, `impl/src/mcp-northbound.mjs:246-248`; `_meta` registry-digest
stamp, `:558-561`):

- `baton_run_message_send` — schema `{repoId, runId?, workerId?, kind: enum [inform, query,
  steer], body: string 1..2048}`, required `[repoId, kind, body]`; the runId/workerId XOR and
  the BYTE cap are the hand-rolled guard's and the facade's job (JSON-schema `maxLength` counts
  chars, not bytes — the authoritative bound is admission-side). Annotations
  `{readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false}`
  — a retry mints a NEW message (`impl/src/coordinator.mjs:6599` seq-bound digest); there is no
  wire `idempotencyKey` and no false exactly-once claim (the `waves.send` posture, `:120-127`,
  `:482-489`).
- `baton_run_message_receipt` — schema `{repoId, messageId: pattern ^message:[a-f0-9]{64}$}`,
  required `[repoId, messageId]`; annotations read-only + idempotent.
- `baton_run_attention_watch` — schema `{repoId, runId, kind?, cursor? integer ≥ 0}`, required
  `[repoId, runId]`; annotations read-only + idempotent.

Each tool registers: `CAPABILITY` (`baton_run_message_send: ['control', 'observe']`; the two
reads `['observe']` — the wave-tools classes, `:96-99`; unregistered tools refuse `forbidden`,
`:86-89`); a hand-rolled shape guard (`invalid_message_send` / `invalid_message_receipt` /
`invalid_attention_watch`, the `:976-1020` idiom); an explicit `_dispatch` branch calling
`application.command(<name>, {…}, {actor, principalId, sessionId}, dispatchContext)` with the
CONNECTION-derived principal — tool arguments never carry principal or authority fields
(`:1536-1573` idiom); and `ORDINARY_EXPLICIT_TOOLS` membership (`:699-705`). None of the three
joins `STATEFUL` or `RECONCILABLE` (no wire idempotencyKey, `:120-127`); per-call quota rides
`handle()` unchanged (ground truth 14).

Refusal constancy to the wire REQUIRES one `stateFailureCode` amendment
(`impl/src/mcp-northbound.mjs:187-240`): add `attention_scope_forbidden`,
`attention_scope_invalid`, and `attention_target_invalid` to the pass-through vocabulary.
Today they would collapse to `command_outcome_unknown` (`:239`) — a constancy break at exactly
the seam this epic exists to project. The `application_*` codes already pass through (`:193`),
and the lane's bare TypeErrors are unreachable through the facade (Decision 1).

These tools are ORDINARY-PLANE: no `sessionAuthority`, no lease argument, no `settlement`
capability class (the settlement-envelope contrast, ground truth 9). The wave-tools section of
`impl/MCP.md:61-89` gains a short prose paragraph (inventory-table rows are generated — see
Decision 7; hand-written inventory prose is linted red,
`impl/test/control-surface-truth-red.test.mjs:148-159`).

**Rationale:** mirrors the wave-tools projection one-for-one (ground truth 8) so the MCP-first
orchestrator reaches the lanes with the envelope shape it already speaks.

### 7. CLI verbs + registry rows + the conformance regeneration step

The CLI verb idiom supports the verbs (ground truth 10), via the `start`-precedent early
branch (the sub-verb must shift BEFORE the generic `runId` shift,
`impl/src/application-cli.mjs:1354-1362`):

- `baton run message send RUN_ID --kind inform|query|steer --body TEXT`
- `baton run message send --worker WORKER_ID --kind KIND --body TEXT` (exactly one target form)
- `baton run message receipt MESSAGE_ID`
- `baton run attention watch RUN_ID [--kind KIND] [--cursor N]`

Parse results are `{kind: 'command', name: 'run.message.send' | 'run.message.receipt' |
'run.attention.watch', args, idempotencyKey}` (the run-table command idiom, `:1500-1514`);
`CLI_WEB_COMMANDS` gains the three names (the dispatch gate, `:15-25`, `:1792`). Three registry
rows join `CANONICAL_OPERATION_SPECS` in the wave-rows shape
(`impl/src/application-semantics.mjs:1556-1600`): `profile: 'ordinary'`,
`surfaces: ['embedded', 'mcp', 'cli']`, capabilities `['control', 'observe']` (send) /
`['observe']` (reads), `idempotent: false` for send (default true stands for the reads),
closed `inputSchema`s matching Decision 6, and the `example` spellings above. Derived names are
mechanically C4-clean (`watch`, `send`, `receipt`, `message`, `attention` are not banned
verbs; ground truth 12), and `servedCliOrdinaryKeys()` picks the keys up through the
whitelist→canonical mapping (`impl/scripts/render-surface-docs.mjs:34-75`).

The conformance-doc regeneration step is MANDATORY and ordered:

1. `node impl/scripts/render-surface-docs.mjs` — rewrites the CLI.md and MCP.md generated
   inventory blocks in place (`render-surface-docs.mjs:156-165`).
2. `node impl/scripts/surface-conformance.mjs --write-inventory` — regenerates the CS-4 checked
   artifact (counts change: canonicalOperations +3, cliWebCommands +3, mcpApplicationTools +3,
   `impl/scripts/surface-conformance.mjs:652-678`).
3. Verify: `node impl/scripts/render-surface-docs.mjs --check` clean,
   `node impl/scripts/surface-conformance.mjs` prints `surface-conformance: ok`, and the three
   pinning suites stay green (ground truth 11).

**Rationale:** the inventory blocks are executable projections of the served surface, not
prose; landing tools without regenerating them fails the committed-block pins by construction.

### 8. Frame-economics honesty (#89) — project the existing cap, name cap+actual

The ONLY size bound this epic projects is the lane's existing 2,048-byte body cap
(`impl/src/coordinator.mjs:6582-6584`). The facade validator enforces it byte-exact
(`Buffer.byteLength`) and the refusal TEXT names cap and actual — e.g.
`applicationError('Run message body exceeds the 2048-byte message cap (actual 2049 bytes)',
'application_message_send_invalid')` — per #89's admitted-refusal law (ground truth 13). No new
caps are invented: the facade's `MAX_ATTENTION_TEXT_BYTES = 4_096` (`impl/src/application.mjs:53`)
is the STEER lane's cap and does NOT apply here; the MCP schema's char-level `maxLength` is a
shape hint, never the authority; the 20,480 scanner window (pinned shape-only at
`impl/test/bidirectional-v3-red.test.mjs:448-455`) is a substrate guard, untouched; and the
reply lane's admission bound is #89's lane-level work, not this epic's (Open Questions).
Spillover (artifact + digest citation) is likewise #89's lane rung — the projection inherits
whatever the lane does, never its own variant.

**Rationale:** contract requirement 5; the C0b pin already guards the wire side, and this epic
must not widen the sin #89 catalogued (bare cap-less refusals).

## Refusal vocabulary (complete, per surface)

Facade (embedded `application.command`):

- `application_message_send_invalid` — closed-shape failure: unknown/missing fields, bad
  kind, target not exactly one of {runId, workerId}, empty or oversize body (text names
  cap+actual). Thrown BEFORE any state lookup.
- `application_message_receipt_invalid` — messageId missing or not `message:<64 hex>`.
- `application_attention_watch_invalid` — runId/kind/cursor shape failure.
- `application_unauthorized` — host-policy refusal. For `run.message.send` with a `workerId`
  target: unknown ≡ foreign (resolved server-side, null-scope authorization). For
  `run.message.receipt`: unknown ≡ foreign (resolve-then-authorize; no receipt field leaks
  before authorization).
- `attention_scope_invalid` / `attention_scope_forbidden` / `attention_target_invalid` —
  coordinator-thrown, propagated byte-identically; `attention_scope_forbidden` is CONSTANT for
  unknown and out-of-scope targets (D1).
- `{ok: false, result: 'worker_not_active' | 'run_not_active'}` — lane OUTCOMES (not throws),
  verbatim, never re-coded.
- `application_command_unavailable` — unchanged descriptor-facade posture for unserved
  commands (`impl/src/mcp-descriptor.mjs:159`).

MCP wire (via `stateFailureCode`, `impl/src/mcp-northbound.mjs:187-240`):

- `forbidden` — capability-class refusal (`_authority`, `:1141-1152`) or mapped
  `application_unauthorized` (`:189`).
- `invalid_message_send` / `invalid_message_receipt` / `invalid_attention_watch` — hand-rolled
  shape guards (`:976-1020` idiom).
- `application_message_send_invalid` / `application_message_receipt_invalid` /
  `application_attention_watch_invalid` — facade validation pass-through (`:193`).
- `attention_scope_forbidden` / `attention_scope_invalid` / `attention_target_invalid` —
  NEW pass-through entries (Decision 6); they must NEVER surface as
  `command_outcome_unknown` (`:239`) or `invalid_command` (`:238`).

CLI: parse failures keep the `cli_invalid` / `cli_command_unavailable` vocabulary
(`impl/src/application-cli.mjs:42`, `:1792`); dispatch failures are the facade codes above.

## Non-goals

- No changes to the coordinator lanes' logic — the single permitted coordinator-side addition
  is the read-only authorization accessor of Decision 4. C0-C6/D1-D5 suite rows are not
  touched, weakened, or re-pinned.
- No addition to `APPLICATION_COMMAND_DEFINITIONS` (byte-stable pin), no new surface aliases,
  no changes to the settlement envelope, the S-2 authority model, or the recursive-session
  gate's command-table coverage.
- No long-poll/wait behavior, no timers, no wake-storm policy, no new wake kinds, no worker-
  side wire grammar (that is #86, landed), no reply-lane admission bound (that is #89's rung).
- No MCP projection of anything beyond the three tools (no worker-profile rows, no embedded-
  only exposures); no Web-surface work beyond the CLI whitelist the CLI rides.
- No limits registry (#89's declared home); the cap+actual refusal text here names the one
  projected cap inline, as the steer validators already do.
- No implementation edits in this contract-authoring epic; implementation and the red-first
  suite are subsequent rungs.

## Red-first acceptance

Implementation begins by adding a focused red suite (suggested home:
`impl/test/facade-projection-red.test.mjs`) whose positive rows fail against the current
facade/MCP/CLI (the commands and tools do not exist today — ground truth 5). The BD3-C/D,
grammar-m3, MCP-packaging, wave, and conformance suites remain unchanged and green; no existing
assertion is weakened. Facade rows drive `application.command(name, args, principal, context)`
(`impl/src/application.mjs:11985`) with the established `authorize: async () => true` stub and
a policy stub that refuses named runs for the constancy rows
(`impl/test/mcp-packaging-red.test.mjs:556` idiom).

| ID | Red state to prove first | Green acceptance oracle |
| --- | --- | --- |
| FP-01 | The three commands do not dispatch. | `run.message.send`, `run.message.receipt`, `run.attention.watch` dispatch through `application.command`; extra/missing fields, bad kind, non-XOR target, malformed messageId/cursor refuse `application_message_send_invalid` / `application_message_receipt_invalid` / `application_attention_watch_invalid` BEFORE any state lookup; no bare TypeError reaches the caller. |
| FP-02 | No facade send reaches the lane. | Facade send to a spawned worker (the C1 fixture shape) mints `message:<64 hex>`, delivers, and returns `{schemaVersion: 1, ok: true, result: 'sent', messageId, delivered, targetCount}` identical to the embedded `coordinator.sendMessage` outcome for the same fixture. |
| FP-03 | Target/authorization refusals could leak existence or be re-coded. | With a policy refusing the run, unknown-workerId ≡ foreign-target ≡ `application_unauthorized`; with the permissive stub, unknown worker → `{ok: false, result: 'worker_not_active'}` and empty run → `{ok: false, result: 'run_not_active'}` — strings byte-identical to the embedded lane, never wrapped. |
| FP-04 | Receipt states could diverge between paths. | THE IDENTITY ROW: one message driven through BOTH paths — `coordinator.messageReceipt(id)` and facade `run.message.receipt({messageId})` return DEEP-EQUAL `{delivered, read, actedOn, reply}` at every transition: at send (true/null/null), after same-generation `turn_started` (read true), after process death (read stays null — C3), after respawn (no inheritance — C3b), and with a reply (closed `{messageId, inReplyTo, from, body}`; smuggled fields absent — C1b). |
| FP-05 | A receipt read could leak message existence. | Unknown messageId ≡ foreign messageId ≡ `application_unauthorized` (resolve-then-authorize); the lane's `null` return is unreachable through the facade; no receipt field crosses before authorization. |
| FP-06 | Scope constancy could break through projection. | The D1 row through `application.command`: out-of-scope target ≡ unknown target ≡ `attention_scope_forbidden`, byte-identical code with no facade wrapper; malformed scope/target refuse `attention_scope_invalid` / `attention_target_invalid` identically to the embedded lane. |
| FP-07 | Candidacy disclosure could widen through projection. | The D2 row through the facade: a non-review-authority principal receives zero `candidacy_review` reasons even when a candidacy exists; the `wave-owner` principal receives it with `count ≥ 1`. |
| FP-08 | Page content could be re-shaped by the projection. | The D3/D4 rows through the facade: storm coalescing carries explicit `count` + `perPhase` (+`windowMs`) with no singular `{role, phase}`; post-terminal reasons carry `memberState: 'terminal-at-mint'`; `throughCursor` chains pages (afterCursor → throughCursor → next call) byte-identically to the embedded lane. |
| FP-09 | The tools could be absent, open-shaped, or self-naming. | MCP descriptor rows: the three tools appear in `mcpApplicationToolNames()` with `additionalProperties: false` schemas, `_meta` registry digest, the pinned capability classes, `invalid_*` shape guards, and dispatch to the right `application.command` names with the CONNECTION-derived principal (a tool-arg `principalId`/`sessionId`/`sessionAuthority` is schema-refused). |
| FP-10 | Refusals could degrade at the wire. | Through a descriptor-driven `McpFleetServer`: facade `application_*` codes and the three `attention_*` codes surface AS THEMSELVES (never `command_outcome_unknown`, never `invalid_command`); the three tools are in `ORDINARY_EXPLICIT_TOOLS`; none is in `STATEFUL`/`RECONCILABLE`; the send tool advertises no `idempotencyKey`. |
| FP-11 | Docs could drift from the served surface. | CLI rows: the four spellings parse to the pinned `{kind: 'command', name, args}` dispatches (unknown sub-verb → parse error, not a run-start objective); after the Decision 7 regeneration, `checkSurfaceDocs() === []`, `node impl/scripts/surface-conformance.mjs` prints `surface-conformance: ok` with the regenerated CS-4 artifact, and the three pinning suites stay green. |
| FP-12 | Size refusals could stay silent or invent caps. | A 2,048-byte body is admitted; a 2,049-byte body refuses `application_message_send_invalid` whose text names BOTH 2048 and 2049; a static assertion shows 2,048 is the only byte bound in the new validators (matching `impl/src/coordinator.mjs:6582-6584`); at MCP the oversize refusal surfaces as the `application_` code, never `invalid_command`. |
| FP-13 | The projection could smuggle semantics. | Static pins: `Object.keys(APPLICATION_COMMAND_DEFINITIONS)` unchanged (grammar-m3 green); `wave-driver.mjs` still free of `attentionFollow` (the D5 pin, `impl/test/bidirectional-v3-red.test.mjs:747`); the new tool schemas carry no `sessionAuthority`/lease/settlement fields; the coordinator diff contains ONLY the read-only authorization accessor; the new commands are dispatched ahead of the recursive-session gate (a live run-orchestrator lease holder retains the lane-admitted review authority). |
| FP-14 | The new tools could drift onto the settlement plane. | A descriptor-driven server whose principal lacks the `settlement` capability serves all three tools; the settlement tools' envelope requirements (`board_lease_required`, settlement capability) are byte-identical before and after. |

The end-to-end oracle (FP-04 + FP-06…FP-08) keys on durable ids, codes, and state predicates —
never sleep duration, turn count, or polling cadence (the campaign control law).

## Open questions

1. **The `follow` → `watch` rename.** The issue body examples `run.attention.follow`; the C4
   banned-verb lint forces the canonical key to `run.attention.watch` (Decision 2, ground truth
   12). If the epic owner wants the literal `follow` spelling on any surface, it requires a
   documented lint exception (the `waves.progress` carve-out pattern,
   `impl/scripts/surface-conformance.mjs:710-718`) — this contract deliberately does not spend
   that capital.
2. **Long-poll `timeoutMs`.** The landed `attentionFollow` ignores `timeoutMs` and pages
   immediately (ground truth 3), so no surface projects a wait budget. If a bounded long-poll
   (capped by the MCP frame budget, `impl/src/mcp-descriptor.mjs:197`) is wanted, it must land
   in the lane first (#75 territory), then project — never the reverse.
3. **Sealed-run sends.** The facade deliberately adds no mutability pre-assertion (Decision 1);
   whether the LANE should refuse message sends to sealed runs (today it answers
   `worker_not_active`/`run_not_active` via liveness) is a lane-contract question for #75/#89.
4. **Reply-lane admission bound.** #89 notes the worker→orchestrator reply direction has no
   body bound at admission while the send direction caps at 2,048 — a lane-level inconsistency
   this projection inherits honestly and does not paper over.
