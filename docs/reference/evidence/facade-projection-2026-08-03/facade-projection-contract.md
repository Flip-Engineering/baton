# Epic #87+#48 — The workflow-surface rung: facade/MCP projection of the message, attention, and shared-layer lanes (v2.0)

Status: implementation contract, pre-red-team. v2.0 folds issue #48 (the shared-layer surface)
into issue #87 (the BD3-C/D projection) per the operator directive of 2026-08-03: this rung
unifies every orchestrator-facing lane a scripted dynamic workflow needs onto the application
facade and its MCP/CLI projections. This epic specifies behavior; it does not amend
implementation in this artifact.

**The operator's law (binding):** *"Composition v2.1 acceptance law (operator): no new
orchestration wave may require a new script file"* (`docs/PROGRESS.md:391`). Dynamic workflows
must be composable THROUGH the baton surface (facade/MCP) with ZERO kernel reaches — no more
bespoke drivers importing `createDriver`/coordination-store to orchestrate (the anti-pattern is
the shipped demo's shape, `impl/demo.mjs:1-13`: `import { createDriver, MockAdapter } from
'./src/index.mjs'`). The rung's live acceptance is a scripted dynamic workflow driven entirely
through facade/MCP commands (Decision 13).

## Seed

**Issue #87** (gh issue view 87): `coordinator.sendMessage`, `coordinator.messageReceipt`, and
`coordinator.attentionFollow` (BD3-C/D, landed 726e34a) exist only at the coordinator level.
The application facade's named-command surface has no message or attention lane, so an
orchestrator driving through the facade/MCP — the primary agent-facing surface — cannot message
a worker, read a receipt, or follow an attention item without dropping to the embedded
`createDriver` stack. Fix shape: facade commands `run.message.send` / `run.message.receipt` /
`run.attention.follow` (same auth/validation idiom as `run.steer`, ordinary-plane), then MCP
tool projections with the wave-tools' envelope shape.

**Issue #48** (gh issue view 48): the embedded orchestrator facade lacks the shared-layer
surface — `run.scratchpad` unwired (named by the #33 contract v2 SP6, never given an accessor),
scratchpad elevation (`elevateTaskScratchpad`/`settleWorkflowScratchpad`) kernel-only, board
writes MCP-only, REPL binding orchestration kernel-only. Consequence per the issue: the
reflexive-orchestration bloc's write side composes only for kernel-embedded drivers and MCP
principals, not for the `openBaton` embedding the evidence drivers use — "two implementers of
the same dynamic workflow would build different plumbing."

**Landed since the rung was drafted:** #78 (board worker-half) landed 9ec8e97 — board
claim/report/grants exist in coordination-store/coordinator with the `{read,claim,report}`
grant-permission law, in-kernel digest adjudication, and close/drop in-batch claim expiry. All
file:line citations in this contract were re-verified against the post-9ec8e97 worktree on
2026-08-03. #86 (worker reply wire grammar) and #92 (the delivery frame carries the messageId,
a9f6598) are likewise landed. Related: #89 (frame-economics honesty), #75 (BD3 spine), #10 (AX
spine). #48's fourth gap — REPL binding orchestration — is NOT in this rung (Non-goals, Open
Question 6).

One naming correction to both issues' example spellings is forced by evidence (Decision 2):
`follow` is a banned canonical surface verb, so the attention command lands as
`run.attention.watch`.

The behaviors being projected are pinned by the BD3 v2.0 contract's C/D sections
(`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:54-103`)
and the landed red suite (`impl/test/bidirectional-v3-red.test.mjs` — C0 414, C0b 434, C1 457,
C1b 487, C2 502, C3 526, C4 590, C5 603, C3b 618, C6 632, A5 557, D1 646, D2 668, D3 692,
D4 724, D5 747). The campaign control law is binding (`bidirectional-v3-decisions.md:134-144`):
this rung adds no clocks, turn limits, or cadence controls.

## Code-verified ground truth

The anchors below were checked in this worktree on 2026-08-03, AFTER the #78 landing (9ec8e97).
`impl/src/application.mjs` contains NUL bytes and was inspected with NUL-safe `grep -an` +
targeted `sed -n` only.

### The BD3-C/D lanes (the #87 scope)

1. **The message lane (BD3-C) is landed and closed.** `coordinator.sendMessage({kind, to,
   body}, auth)` (`impl/src/coordinator.mjs:6592-6662`) admits kind ∈ {inform, query, steer}
   (`:6594-6596`), a non-empty body of at most 2,048 BYTES (`Buffer.byteLength(body) > 2_048`,
   `:6597-6599`), and a target of exactly `{workerId}` XOR `{runId}` (`:6600-6604`). Validation
   failures throw BARE TypeErrors (no `.code`). An inactive worker target returns
   `{ok: false, result: 'worker_not_active'}` (`:6608`) and an empty run target returns
   `{ok: false, result: 'run_not_active'}` (`:6613`) — typed OUTCOMES, not throws. A send mints
   `message:<64 lowercase hex>` (`:6615`; pinned by C1, `bidirectional-v3-red.test.mjs:457`),
   writes best-effort durable `message.sent`/`message.delivered` audit events (`:6621-6649`),
   delivers at most one copy per member (C5, `:603`), and frames the body
   ``[MESSAGE <kind> <messageId> — UNTRUSTED]`` carrying the messageId (`:6633`; C6/#92,
   `:632`). It returns `{ok: true, result: 'sent', messageId, delivered, targetCount}`
   (`:6658-6662`). The `auth` argument is attribution only — the lane performs no authorization
   of its own (`void auth`, `:6657`).

2. **The receipt state machine (BD3-C) is landed and honest.** `coordinator.messageReceipt
   (messageId)` (`impl/src/coordinator.mjs:6669-6690`) returns `null` for an unknown id
   (`:6670-6671`) and otherwise exactly `{delivered, read, actedOn, reply}` (`:6682-6690`):
   `delivered` = written to the worker's durable stream (true|null); `read` = the worker's first
   `turn_started` in the SAME process generation (a respawned worker does NOT inherit reads —
   C3b, `bidirectional-v3-red.test.mjs:618`); `actedOn` is always `null`; `reply` carries the
   worker's closed `{messageId, inReplyTo, from, body}` when admitted (C1/C1b: smuggled fields
   never reach the receipt). Death between delivered and read leaves `read: null` forever (C3,
   `:526`). Reply depth is 1 (C2, `:502`).

3. **The attention inbox (BD3-D) is landed, scope-first, and additive.**
   `coordinator.attentionFollow({scope, targets, afterCursor, timeoutMs}, principal)`
   (`impl/src/coordinator.mjs:6694-6732`) validates scope as exactly `{runId}` with an id-shaped
   value (`attention_scope_invalid`, `:6696-6702`), authorizes the caller's parent scope FIRST
   (`attention_scope_forbidden`, `:6707` via `_attentionScopeAuthorized`, `:6735-6741`), then
   normalizes targets server-side: a `{runId}` target outside the scope refuses
   `attention_scope_forbidden` IDENTICALLY to an unknown one — before any existence check
   (D1, `bidirectional-v3-red.test.mjs:646`); a malformed target refuses
   `attention_target_invalid`. It returns `{reasons, throughCursor, afterCursor, runId}`
   (`:6726-6732`). `timeoutMs` is destructured but NEVER referenced in the body (`:6694-6732`):
   the landed lane is an immediate cursor page, not a long-poll.

4. **The attention authority model is principal-shaped and lane-resident.** The deployment's
   orchestrator principal (`principalId === 'wave-owner'`) is the viewer of record
   (`impl/src/coordinator.mjs:6735-6741`); a run-scoped follow also admits a live
   run-orchestrator lease holder whose session belongs to the caller (`_isReviewAuthority`,
   `:6743-6755`, consulting `activeRunOrchestratorLeaseForSession(runId, sessionId)`).
   `candidacy_review` is disclosed ONLY to the review authority, derived live from the candidacy
   queue (`_attentionPage`, `:6757-6788`; D2, `bidirectional-v3-red.test.mjs:668`). Storm
   coalescing emits an explicit `count` + `perPhase` distribution and drops singular member
   identity (`_mintMemberTerminal`, `:6795-6822`, window `ATTENTION_COALESCE_WINDOW_MS = 500`,
   `:44`; D3, `:692`). Wake reasons minted after a member's terminal transition carry
   `memberState: 'terminal-at-mint'` (D4, `:724`). The landed wake vocabulary is exactly two
   kinds — `member_terminal` and `candidacy_review`; `grep -an` finds no `decision_pending` /
   `blocked_interaction` / `deadline_approaching` mint sites. The wave driver's stall machinery
   is deliberately NOT a consumer (D5 pin: `wave-driver.mjs` stays free of `attentionFollow`,
   `:747`).

### The facade idiom (the projection target)

5. **The facade's named-command surface has none of these lanes.** The `command(name, args,
   principal, context)` entry point (`impl/src/application.mjs:12055`; the issues' "invoke"
   phrasing maps to this method — facade-level suites drive `f.application.command(...)`, e.g.
   `impl/test/phase77-recursive-application-red.test.mjs:416`) dispatches the byte-stable
   command table plus direct ports; `grep -an "name === '"` finds no message/attention/
   scratchpad/board-post/knowledge-seed dispatch anywhere in the file. The descriptor-driven
   facade's card advertises only command-table keys + `waves.attach`
   (`impl/src/mcp-descriptor.mjs:148`).

6. **The command table is byte-stable; new commands must be direct ports.**
   `APPLICATION_COMMAND_DEFINITIONS` (`impl/src/application.mjs:149`) is pinned byte-stable —
   `grammar-m3-red` pins `Object.keys(APPLICATION_COMMAND_DEFINITIONS)` (`:192`). The
   established pattern for post-table commands is the DIRECT PORT, dispatched inside `command()`
   BEFORE `validateApplicationCommandArgs` and before the recursive-session gate: `run.debug`
   (`:12071-12073`), `run.steer` (`:12077-12079`), the four settlement commands
   (`:12081-12089`, embedded-only), and the wave-ergonomics ports
   `waves.start/progress/send/stop` + `deployment.doctor` (`:12092-12100` — "NOT
   APPLICATION_COMMAND_DEFINITIONS entries, so the byte-stable command-table key set is
   unchanged"). The recursive-session gate (`run_orchestrator_command_forbidden`,
   `:12101-12110`) applies only to command-table commands.

7. **The facade validation/authorization idiom.** `applicationError(message, code)` (`:222-224`);
   closed-arg validation via `exactObject` (`:281-285`) or the allowed-set pattern
   (`:1837-1840` and the wave-port normalizers `_normalizeWaveStart`/`_normalizeWaveMemberAction`,
   `:11494`, `:11536`); `validId` = `^[A-Za-z0-9._:-]{1,256}$` (`:288`); `validText(value,
   maxBytes = 4096)` byte- and NUL-bounded (`:289-291`); `normalizePrincipal` requires exactly
   `{actor, principalId, sessionId}` (`:986-992`). `run.steer` is the model: `normalizeSteer`
   closes the shape with `application_steer_invalid` (`:912-919`); `steer()` then awaits the
   host-injected policy `this._authorize('run.steer', principal, runId, subject)` with
   digest-bound subject fields (`:12267-12292`; `_authorize` throws `application_unauthorized`,
   `:3048-3057`; `options.authorize` is a REQUIRED constructor injection, `:2318-2320`, assigned
   at `:2328`, and facade-level suites stub it as `authorize: async () => true`, e.g.
   `impl/test/mcp-packaging-red.test.mjs:556`). Target resolution is server-side via
   `coordinator.list()` with the constant `application_worker_not_found` refusal
   (`:12279-12281`; same pattern in `sendWaveMember`, `:11427-11443`). The facade already
   reaches `this.driver.coordination` for ordinary commands (e.g. `run.stop`'s
   `runStop`/`admitRunStop`) — the coordination store is the facade's established lower layer,
   not a "kernel reach" for the facade itself.

### The shared-layer kernel lanes (the #48 scope)

8. **Scratchpad reads exist at the store, fenced and scope-closed.**
   `coordination-store.scratchpadSnapshot(runId, scope)` (`impl/src/coordination-store.mjs:
   13413-13420`) returns `{runId, scope, observedSeq, scratchpadFence, fenceTuple, entries}`;
   the batch form (`:13395-13410`) validates scopes against `SCRATCHPAD_SCOPE` =
   `^(?:shared|worker:[A-Za-z0-9._:-]{1,256})$` (`:482`) with `scratchpad_read_invalid` and
   offers an `expectedFenceTuple` CAS refusing `scratchpad_cursor_stale` (`:13401-13405`). The
   snapshot is NON-EVENTED. Partition ceilings: `MAX_SCRATCHPAD_WORKER_ENTRIES = 128`,
   `MAX_SCRATCHPAD_SHARED_ENTRIES = 512` (`:473-474`); entry ids are
   `scratchpad-entry:<64 hex>` (`:480`). The BD3-A worker read lane renders the shared partition
   bounded ≤64 items with `UNTRUSTED_SCRATCHPAD` framing and per-leaf text bounding
   (`_renderContextRead`, `impl/src/coordinator.mjs:10394-10426`).

9. **Elevation is landed with its fence discipline.** The coordinator wrapper
   `elevateTaskScratchpad(taskId, entryIds)` (`impl/src/coordinator.mjs:10725-10728`) rides
   `_settleTerminalScratchpad` (`:10225-10242`): a non-terminal task returns
   `{ok: false, result: 'scratchpad_settlement_not_ready'}` (`:10229-10231`); the wrapper derives
   workerId and `expectedScratchpadFence` from LIVE state and calls the store with
   `{actor: 'orchestrator', key: 'scratchpad.task_settlement:<taskId>'}` (`:10235-10240`). The
   store (`impl/src/coordination-store.mjs:13538-…`) requires `auth.actor === 'orchestrator'`
   and a closed shape (`scratchpad_settlement_invalid`, `:13539-13547`), replays the
   deterministic key idempotently and refuses a changed selection on retry with
   `scratchpad_settlement_conflict` (`:13550-13569`), re-checks the fence
   (`stale_scratchpad_fence`, `:13570-13573`), refuses selections outside the task partition
   (`:13583-13586`), admits mid-flight elevation only for steering-registered runs (defense-in-
   depth terminal gate, `:13587-13597`), and bounds the shared partition
   (`scratchpad_partition_exhausted`, `:13599-13602`). Elevation mints shared entries with
   content digests and, for notes, a `scratch-fact` payload (`:13603-13640`).

10. **The board binding law is landed and replay-derived.** `boardSnapshot(board)` carries the
    binding's runId (null when unbound) in its PUBLIC projection
    (`impl/src/coordination-store.mjs:14258-14270`). The law, verbatim: a board bound to a
    DIFFERENT run refuses (the S-2 seam's `board_session_mismatch`, `:13933-13936`; the BD3-A
    read check's `context_scope_forbidden`, `impl/src/coordinator.mjs:10370-10373`); an
    unbound-and-empty read is unknown (`context_not_found`, `:10374-10376`); an unbound board
    WITH items serves, and a first admitted write ADOPTS it into the run
    (`adopting = !binding && items > 0`, `:13987`, result `boardRunBinding: {runId, result:
    'adopted'|'bound'}`, `:14022-14024`). Bindings are replay-derived from the event payload's
    `boardAdmission` record — `{runId, adopted, boundEvent, requestDigest}`; no lease field is
    read at replay (`:8330-8334`, `:8343-8346`). `postBoardItem` (`:14028-14050`) validates
    title ≤160 bytes / detail ≤4,096 / evidence ≤8 refs (`:393-399`), mints
    `board-item:<digest>` ids hub-side, and replays on `auth.key`. The facade already owns the
    bounded orchestrator board renderer: `projectBoardView` (`impl/src/application.mjs:488`),
    non-evented, dual-fence cached (boardFence + projectionInputFence post-#78), UNTRUSTED-
    framed, bounded `MAX_BOARD_ITEMS = 512` / `MAX_BOARD_VIEW_BYTES = 256 KiB` (`:60-61`) with
    explicit truncation — the exact renderer the MCP board read uses
    (`impl/src/mcp-northbound.mjs:1721-1728`).

11. **Board registry rows exist; the facade dispatch does not.** `board.post`/`board.retitle`/
    `board.reorder`/`board.close`/`board.drop`/`board.read` are canonical operations with the
    S-2 `sessionAuthority` IN their schemas and `surfaces: ['embedded', 'mcp']`
    (`impl/src/application-semantics.mjs:1351-1409`); `board.claim`/`board.report` are
    worker-profile rows (`:1410-1428`, landed #78). The MCP `baton_board_*` tools ride the S-2
    envelope via `_boardAuthorityContext(principal).sessionAuthority`
    (`impl/src/mcp-northbound.mjs:1676-1730`, `:1808-1810`) and are served on the COMBINED
    surface, NOT the ordinary application surface (verified in this worktree:
    `mcpApplicationToolNames()` = 27 tools, no `baton_board_*`; `mcpCombinedToolNames()` = 78
    including all six). #48's "board writes are MCP-only" is exactly this: an embedded
    `openBaton` orchestrator without a run-orchestrator lease has no board surface at all.

12. **Knowledge seeding is a one-call store lane with content-addressed identity.**
    `coordination-store.addKnowledgeNode(fields, auth)` (`impl/src/coordination-store.mjs:
    15623-15632`) validates type ∈ `KNOWLEDGE_NODE_TYPES` (20 types, `:140`), grounding ∈
    `KNOWLEDGE_GROUNDINGS` (`{verified, observed, derived, asserted}`, `:142`), id uniqueness
    (`duplicate_node`), evidence refs of exactly `{coordinationSeq}` or `{artifactId}`
    (`:15144-15152`), valid times, and type-specific rules (Decision requires evidence +
    `informedBy`; a verified Finding requires evidence — `causal_orphan`, `:15159-15173`).
    Lifecycle-owned projection fields are rejected (`reserved_knowledge_field`, `:15127-15131`).
    The default id is content-addressed `knowledge:<type>:<digest>` (`:15634-15638`); exact
    retries replay `idempotent` on `auth.key` (`:15625-15628`). A node belongs to a run's
    horizon by construction when it carries `runId` (or a run-task `taskId`, or evidence citing
    the run's events) — `_runHorizonNodeIds` (`impl/src/coordinator.mjs:10431-10453`).

13. **#48's scratchpad accessor gap is real at the facade.** The #33-contracted
    `run.scratchpad({workerId})` has no facade accessor; orchestrators read member scratchpads
    only through wave progress rows and run-outline additive fields (issue #48 item 1). The
    store read machinery (ground truth 8) is complete — the gap is purely the surface.

### The projection machinery (MCP/CLI/conformance)

14. **The MCP tool-projection shape (post-5bda319).** Ordinary-surface tools are entries in
    `ORDINARY_APPLICATION_TOOL_DEFINITIONS` with CLOSED schemas — the `schema()` helper emits
    `additionalProperties: false` (`impl/src/mcp-northbound.mjs:246-248`) — and a `_meta`
    registry-digest stamp (`:558-561`). Each tool needs: a `CAPABILITY` registration
    (`baton_waves_send: ['control', 'observe']` etc., `:96-99`) — an unregistered tool refuses
    `forbidden` in `_authority` (`:86-89`, `:1141-1152`); a hand-rolled shape guard returning
    `invalid_*` (`:976-1020`); an explicit `_dispatch` branch calling `application.command(...)`
    with the CONNECTION-derived principal, never tool arguments (`:1536-1573`); and membership
    in `ORDINARY_EXPLICIT_TOOLS` so failures reach the typed `stateFailureCode` lane
    (`:699-705`). Tools without a wire `idempotencyKey` stay OUT of `STATEFUL`/`RECONCILABLE`
    (`:120-127`). Tool errors map through `stateFailureCode` (`:187-240`):
    `application_unauthorized` → `forbidden` (`:189`), `application_*` codes pass through
    (`:193`), a bare TypeError → `invalid_command` (`:238`), unmapped codes →
    `command_outcome_unknown` (`:239`). NOT mapped today: the `attention_*` codes, the
    `scratchpad_settlement_*`/`stale_scratchpad_fence`/`scratchpad_read_invalid` family, and
    the knowledge-seed codes (`duplicate_node`, `invalid_evidence`, `missing_endpoint`,
    `causal_orphan`, `knowledge_node_conflict`) — verified by reading the full mapping.

15. **The settlement envelope is a different plane and stays untouched.** The four settlement
    tools ride the S-2 `sessionAuthority` envelope (`baton_knowledge_promote` refuses
    `board_lease_required` without it, `impl/src/mcp-northbound.mjs:1600-1615`;
    `baton_knowledge_settlement_lease` requires an explicit `settlement` capability class, never
    defaulted, `:104`; `impl/src/mcp-descriptor.mjs:47-48`; `impl/MCP.md:97-108`). Every lane in
    this rung is ordinary-plane: no `sessionAuthority`, no lease, no settlement capability
    anywhere in their schemas or dispatch. (The pre-existing `baton_scratchpad_elevate`/
    `baton_scratchpad_settle` settlement tools, `:524-543`, are untouched — the new
    `run.scratchpad.elevate` is the ORDINARY end-of-task elevation of ground truth 9, a
    different lane.)

16. **The CLI verb idiom supports the verbs, with one mechanism note.** `parseBatonCli` handles
    `baton run <action>` via a single-token `lifecycleActions` set
    (`impl/src/application-cli.mjs:1357-1360`; unknown actions fall through to `parseStart`),
    with early pre-`runId` branches for special shapes (`start`, `:1354-1356`) and positional
    sub-arguments after `runId` (`episode [TOPIC]`, `:1364-1370`). `{kind: 'command', name,
    args}` parse results dispatch through the web-client whitelist gate `CLI_WEB_COMMANDS`
    (`:15-25`, enforced at `:1792`). The CLI help/render model is DERIVED from registry
    canonical operations with the `cli` surface (`canonicalCliRenderModel`, `:835-850`), and
    surface spellings derive mechanically: `cli: baton ${parts.join(' ')}`, `mcp:
    baton_${parts.join('_')}` (`impl/src/application-semantics.mjs:1135-1140`). Registry rows
    for the wave ports show the required shape (`:1565-1613`; `buildCanonicalOperation`,
    `:1834-1876`).

17. **Generated-inventory conformance is executable and pinned.** `servedCliOrdinaryKeys()`
    renders the served CLI inventory from the whitelist→canonical mapping
    (`impl/scripts/render-surface-docs.mjs:34-75`); `renderMcpToolInventory()` renders from the
    REAL tool table (`:95-119`). `node impl/scripts/render-surface-docs.mjs` rewrites the CLI.md
    (`impl/CLI.md:18-46`) and MCP.md (`impl/MCP.md:110-142`) generated blocks; `--check` fails
    on drift (`render-surface-docs.mjs:145-165`). `checkSurfaceDocs() === []` is pinned by three
    suites (`impl/test/control-surface-truth-red.test.mjs:163`,
    `impl/test/grammar-m4b-red.test.mjs:193`, `impl/test/run-debug-surface-red.test.mjs:230`),
    and `node impl/scripts/surface-conformance.mjs` must print `surface-conformance: ok`
    (pinned at `control-surface-truth-red.test.mjs:65-73`; verified green in this worktree).
    The conformance main also enforces the CS-4 checked inventory artifact
    (`impl/scripts/surface-conformance.mjs:652-678` — counts include `canonicalOperations`,
    `cliWebCommands`, `mcpApplicationTools`; regenerate via `--write-inventory`) and the C4
    banned-surface-verb lint.

18. **`follow` is a BANNED canonical surface verb.** `BANNED_SURFACE_VERBS` includes `follow`,
    `steer`, `progress`, `wait`, and nine others
    (`impl/scripts/surface-conformance.mjs:196-199`); the lint scans every canonical operation's
    key and ALL derived surface names (`:710-718`), with exactly one documented exception
    (`waves.progress`). The canonical verb for following is `watch` (`run.watch` is the
    canonical of legacy `run.follow`, `impl/src/application-semantics.mjs:1253-1258`,
    `:1775-1780`). All verbs this rung introduces (`send`, `receipt`, `watch`, `read`,
    `elevate`, `post`, `seed`) are C4-clean.

19. **#89 frame-economics is binding** (gh issue view 89): scanners detect frames only; policy
    bounds live at ADMISSION as typed refusals that NAME THE CAP AND THE ACTUAL size; spillover
    is lane-level work; parser scan windows (the 20,480 grammar window pinned at
    `bidirectional-v3-red.test.mjs:448-455`) are substrate guards, not policy. #89 explicitly
    names `coordinator.sendMessage`'s bare TypeError over 2,048 bytes as a current sin — this
    rung does NOT fix the lane's refusal quality (that is #89's limits-registry rung), but its
    facade validation must already speak cap+actual, and it must NOT invent new caps.

20. **Quota and plane posture need no invention.** Ordinary MCP tools ride the standard
    per-call quota in `handle()` (`impl/src/mcp-northbound.mjs:1534-1535` comment; descriptor
    defaults `maxWaitMs: 25_000`, `maxMessageBytes: 256 KiB`,
    `impl/src/mcp-descriptor.mjs:197-198`), and the descriptor principal carries explicit
    capability classes (`impl/src/mcp-descriptor.mjs:103-109`, `:179-183`).

## Contract question

Can an orchestrator compose an entire dynamic workflow — seed a board and the knowledge graph,
start a wave, message its members, read honest receipts, page the attention inbox, answer the
decision gate, elevate findings, and read the shared layer back — using ONLY application-facade
commands and their MCP/CLI projections, with zero `createDriver`/coordination-store imports,
every refusal the kernel lanes define arriving byte-identically, no existence leak introduced
by any projection, and no new semantics, caps, clocks, or authority envelopes — and can the
conformance machinery prove the new surface is what the docs say it is?

## Decisions

### 1. The projection law: reach, never semantics — and zero kernel reaches for callers

Every command in this rung is a PROJECTION of a landed kernel lane. The projection adds no
semantics: no new refusal classes the embedded path lacks, no existence checks the lane does
not perform, no pre-assertions (the facade does NOT call `_assertRunMutable` for these lanes —
contrast `steer()`, `impl/src/application.mjs:12278`), no closed vocabularies the lane does not
close (the attention lane accepts arbitrary target-kind strings and filters, so the facade
validates kind shape only; the store's type/grounding enums ARE lane-closed, so the seed
validator closes them identically), no long-poll behavior the lane does not implement, and no
response-field invention. Lane outcomes pass through VERBATIM: kernel return values are
returned with only the facade's envelope marker (`schemaVersion: 1`, the wave-port envelope
shape) added; kernel-thrown coded refusals propagate with their `.code` untouched. Facade-side
validation is EXACTLY as permissive as the lane's — never narrower (a facade refusal the lane
would not produce is a semantics change), never wider (an uncoded kernel error reaching a
caller is an honesty failure). The ONLY kernel-side additions this rung permits are read-only
authorization accessors (Decision 4); lane logic is untouched.

The caller-side law is the operator's: an orchestrator composes workflows through
`application.command` (embedded facade), MCP tools, or CLI verbs — NEVER by importing
`createDriver`, `coordinator.mjs`, or `coordination-store.mjs`. The facade's own internal reach
to `this.driver.coordinator` / `this.driver.coordination` is the application layer using its
established lower layer (ground truth 7), not a caller kernel reach.

**Rationale:** refusal constancy through projection is the rung's reason to exist; the
blue-team re-verifies it row by row.

### 2. Eight direct-port commands; the attention verb is `watch`, not `follow`

Eight new facade commands dispatch as DIRECT PORTS inside `command()` at the wave-ports
position — BEFORE `validateApplicationCommandArgs` and before the recursive-session gate
(`impl/src/application.mjs:12092-12110` is the insertion neighborhood; the byte-stable
`APPLICATION_COMMAND_DEFINITIONS` table is untouched, `:149`, `:192`):

| Facade command | Lane projected | Decision |
| --- | --- | --- |
| `run.message.send` | `coordinator.sendMessage` | 3 |
| `run.message.receipt` | `coordinator.messageReceipt` | 4 |
| `run.attention.watch` | `coordinator.attentionFollow` | 5 |
| `run.scratchpad.read` | `coordination-store.scratchpadSnapshot` | 6 |
| `run.scratchpad.elevate` | `coordinator.elevateTaskScratchpad` | 7 |
| `run.board.post` | store post + binding law | 8 |
| `run.board.read` | `boardSnapshot` + `projectBoardView` | 8 |
| `run.knowledge.seed` | `coordination-store.addKnowledgeNode` | 9 |

The issues' example spelling `run.attention.follow` is corrected: `follow` is a banned
canonical surface verb (ground truth 18), so the canonical key — and therefore the derived CLI
spelling `baton run attention watch` and MCP tool `baton_run_attention_watch`
(`impl/src/application-semantics.mjs:1135-1140`) — uses `watch`, exactly as `run.watch` is the
canonical of legacy `run.follow`. The coordinator method keeps its landed name
(`attentionFollow`); only the surface key changes.

Dispatch position is a refusal-constancy decision, not convenience: the recursive-session gate
(`run_orchestrator_command_forbidden`, `impl/src/application.mjs:12101-12110`) would refuse a
run-orchestrator lease holder BEFORE the lanes' own authorization runs — but BD3-D deliberately
admits a live run-orchestrator lease holder as review authority
(`impl/src/coordinator.mjs:6743-6755`). Placing the ports behind the gate would add a refusal
the embedded path lacks.

Each command validates through its own closed normalizer in the wave-port idiom (allowed-set
closure, `:1837-1840`, `:11494-11535`), throws the facade's `application_*` vocabulary, then
normalizes the principal (`normalizePrincipal`, `:986-992`). Wire arguments NEVER carry
principal, `sessionAuthority`, or lease fields; the principal comes from the authenticated
connection/context.

**Rationale:** direct ports preserve the grammar-m3 byte-stable pin (ground truth 6) and match
the wave-ergonomics precedent both issues name.

### 3. `run.message.send` — steer-idiom authorization, verbatim lane outcomes

Request shape (closed): `{runId?, workerId?, kind, body}` — exactly one of `runId`/`workerId`
(the lane's XOR, `impl/src/coordinator.mjs:6600-6604`), `kind` ∈ {inform, query, steer}
(`:6594-6596`), `body` non-empty and ≤ 2,048 BYTES (`:6597-6599`). Failures refuse
`application_message_send_invalid`; the oversize refusal names cap and actual (Decision 12).

Authorization follows the `steer()` idiom (`impl/src/application.mjs:12267-12292`): the facade
resolves the target run SERVER-SIDE — directly for a `runId` target; via `coordinator.list()`
for a `workerId` target — and calls `_authorize('run.message.send', principal, resolvedRunId,
{kind, targetKind, bodyDigest: digest(body)})`. An unresolvable `workerId` authorizes against a
null run scope so an UNKNOWN worker and a FOREIGN worker refuse identically
(`application_unauthorized`); possession of a worker id is never authority. The facade performs
NO existence pre-checks of its own: on authorization it delegates to
`coordinator.sendMessage({kind, to: {workerId}|{runId}, body}, {actor: principal.actor})` and
returns the lane outcome VERBATIM plus `schemaVersion: 1`:

- success: `{schemaVersion: 1, ok: true, result: 'sent', messageId, delivered, targetCount}`
  (the lane's return, `impl/src/coordinator.mjs:6658-6662`);
- inactive target: `{schemaVersion: 1, ok: false, result: 'worker_not_active'}` or
  `{schemaVersion: 1, ok: false, result: 'run_not_active'}` — the lane's exact outcome object
  (`:6608`, `:6613`), never re-coded, never padded with fabricated fields.

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
`coordinator.messageRunId(messageId)` — the one coordinator-side addition this rung permits;
Decision 1) resolves the message's target run for authorization ONLY, never projecting it. An
unknown messageId resolves to no run, so unknown ≡ foreign ≡ the constant
`application_unauthorized` — no existence leak on message ids, and the lane's `null`-for-
unknown return (`impl/src/coordinator.mjs:6670-6671`) is UNREACHABLE through the facade.

On authorization the facade returns the receipt VERBATIM plus the envelope marker:
`{schemaVersion: 1, messageId, delivered, read, actedOn, reply}` with the lane's exact state
machine (`:6682-6690`): `delivered`/`read` ∈ {true, null}, `actedOn` always null, `reply` the
closed `{messageId, inReplyTo, from, body}` or null. The facade never upgrades, infers, or
annotates receipt state; process-scoping (C3/C3b) is the lane's, projected as-is.

**Rationale:** the receipt is the lane's honesty artifact; the facade's only added decision is
WHO may read it, decided with the system's established digest-is-not-authority law.

### 5. `run.attention.watch` — the lane's own scope authority is the sole seam

Request shape (closed): `{runId, kind?, cursor?}` — `runId` id-shaped (`validId`,
`impl/src/application.mjs:288`), `kind` an optional id-shaped string validated SHAPE-ONLY (the
lane closes no wake-kind vocabulary; ground truth 3 and Decision 1), `cursor` an optional safe
integer ≥ 0 (the `run.follow` cursor discipline, `:1872-1876`). Shape failures refuse
`application_attention_watch_invalid`.

The facade delegates with NO authorization pre-check of its own: `coordinator.attentionFollow(
{scope: {runId}, targets: kind === undefined ? [] : [kind], afterCursor: cursor ?? 0,
timeoutMs: undefined}, {principalId: principal.principalId, sessionId: principal.sessionId})`.
The lane's scope-first authorization (`attention_scope_invalid` / `attention_scope_forbidden` /
`attention_target_invalid`, `impl/src/coordinator.mjs:6696-6725`) is the sole authority seam —
the `_settlementCommand` precedent, where the lane's own authority governs and the facade adds
no `_authorize` (`impl/src/application.mjs:12244-12264`). A facade `_authorize` on the requested
runId would introduce an existence check the embedded path lacks (for the orchestrator
principal, an unknown scope runId pages EMPTY at the lane — it does not refuse) and would break
the D1 constant. The coded refusals propagate byte-identically; the page returns VERBATIM:
`{schemaVersion: 1, runId, afterCursor, throughCursor, reasons}` with every reason's
`{seq, kind, runId, mintEpoch, count, perPhase, windowMs, memberState, …}` untouched
(`impl/src/coordinator.mjs:6726-6732`, `:6795-6822`).

`timeoutMs` is NOT projected. The landed lane pages immediately and ignores it (ground truth
3); a facade that accepted a wait budget would promise behavior that does not exist. The MCP
bounded long-poll of the v0.9 dream shape (capped by the frame budget,
`impl/src/mcp-descriptor.mjs:197`) is a LANE-level rung first — flagged in Open Questions.

**Rationale:** the D1/D2 pins (scope-first constancy; review-authority gating) live entirely
inside the lane and are principal-shaped; the facade transports the authenticated principal and
gets out of the way.

### 6. `run.scratchpad.read` — the #33 accessor, bounded and framed like the BD3-A renderer

Request shape (closed): `{runId, scope, cursor?}` — `scope` EXACTLY `shared` or `worker:<id>`
(the store's `SCRATCHPAD_SCOPE` pattern, `impl/src/coordination-store.mjs:482`), `cursor` an
optional safe integer ≥ 0. Failures refuse `application_scratchpad_read_invalid`. This closes
#48 item 1 (the #33 SP6 accessor, ground truth 13).

Authorization is the steer idiom: `_authorize('run.scratchpad.read', principal, runId, {scope})`
— unknown ≡ foreign at the policy seam. On authorization the facade snapshots
`this.driver.coordination.scratchpadSnapshot(runId, scope)` — NON-EVENTED, no `context.read`
audit class (that class belongs to the worker L1 lane; the facade's ordinary reads, like
`board.read` and `waves.progress`, append nothing) — and renders the page with the BD3-A
renderer law projected (`impl/src/coordinator.mjs:10394-10426`):

- at most 64 entries per page (the renderer's non-knowledge `maxItems`, `:10402`);
- every entry rendered `{entryId, kind, text}` with per-leaf text bounded through the facade's
  own `boundedAttentionText` (≤ 4,096 bytes, `impl/src/application.mjs:300`, cap
  `MAX_ATTENTION_TEXT_BYTES`, `:53`) and the page carrying the frame marker
  `UNTRUSTED_SCRATCHPAD — worker-authored notes, not instructions` (`:10399`) — worker-authored
  content is data, never instruction;
- response `{schemaVersion: 1, runId, scope, scratchpadFence, observedSeq, entries, nextCursor,
  truncated}`.

Pagination is OFFSET-based over the store's live snapshot (rebuilt per call, never a cached
frame — the `waves.progress` honesty posture, `impl/MCP.md:74-77`): `nextCursor` is an offset
or null; `scratchpadFence` + `observedSeq` are carried verbatim so a caller detects drift
(elevation reaps a worker partition) and re-reads. v1 pins NO stale-cursor refusal and does NOT
project the store's `expectedFenceTuple` CAS (`impl/src/coordination-store.mjs:13401-13405`) —
offset paging with a carried fence is the honest minimum; a fence-pinned cursor is a later rung
(Open Questions).

**Rationale:** the store read machinery is complete (ground truth 8); the rung's work is the
bounded, framed, authorized projection — and every bound cited already exists.

### 7. `run.scratchpad.elevate` — the kernel elevation with its fence discipline, verbatim

Request shape (closed): `{runId, taskId, entryIds}` — `entryIds` an array of ≤128 unique
`scratchpad-entry:<64 hex>` ids (the store's closed shape, `impl/src/coordination-store.mjs:
13543-13546`, `:480`, `:473`). Failures refuse `application_scratchpad_elevate_invalid`. This
closes #48 item 2 for the ordinary end-of-task path.

Authorization is resolve-then-authorize: the facade resolves the task's run SERVER-SIDE (the
store's delegated `task` accessor, `impl/src/coordinator.mjs:754`) and calls
`_authorize('run.scratchpad.elevate', principal, resolvedRunId, {taskId, entryCount})`. An
unknown task, or a task whose runId does not equal `args.runId`, authorizes against a null
scope: unknown ≡ cross-run ≡ foreign ≡ the constant `application_unauthorized` — the entry
ids a caller names are never existence-oracles. On authorization the facade delegates to
`coordinator.elevateTaskScratchpad(taskId, entryIds)` (`impl/src/coordinator.mjs:10725-10728`)
and returns the outcome VERBATIM plus `schemaVersion: 1`:

- non-terminal task: `{schemaVersion: 1, ok: false, result: 'scratchpad_settlement_not_ready'}`
  (`:10229-10231`) — a typed OUTCOME, never a throw;
- no worker / nothing to elevate: `{schemaVersion: 1, ok: true, result: 'empty', …}`;
- success/replay: the store's receipt verbatim — `{schemaVersion: 1, ok: true, result,
  runId, taskId, workerId, scope, observedFence, scratchpadFence, reapEventSeq,
  dispositionDigest, elevated}` (ground truth 9).

The lane's coded refusals propagate byte-identically: `stale_scratchpad_fence` (fence raced the
wrapper's live read), `scratchpad_settlement_conflict` (retry of the same task with a CHANGED
selection — the deterministic key `scratchpad.task_settlement:<taskId>`,
`impl/src/coordinator.mjs:10239`, makes this reachable and it MUST reach the caller),
`scratchpad_settlement_invalid` (selection outside the task partition — state-dependent,
`impl/src/coordination-store.mjs:13583-13586`), `scratchpad_partition_exhausted` (shared
partition full, `:13599-13602`). The facade's shape pre-validation makes the store's
shape-level `scratchpad_settlement_invalid` unreachable (Decision 1).

The facade projects the coordinator WRAPPER (terminal-task discipline), not the store's
steering-registered mid-flight relaxation (`:13587-13597`): mid-flight elevation remains a
kernel capability this rung does not surface (Open Questions).

**Rationale:** #48 asked for the kernel elevation projected "with its fence discipline"
(ground truth 9); the wrapper is the documented registered-orchestrator end-of-task path.

### 8. `run.board.post` / `run.board.read` — the binding law verbatim, orchestrator posture

These close #48 item 3 for the embedded/CLI orchestrator (MCP board coverage already exists —
ground truth 11 — and stays the S-2 family; Decision 10). Request shapes (closed):

- `run.board.post`: `{runId, board, title, detail?, owner?, evidence?}` — `board` matching
  `SAFE_BOARD_ID` (`impl/src/coordination-store.mjs:393`), `title` ≤160 bytes non-empty,
  `detail` null-or-≤4,096, `owner` null-or-safe-id, `evidence` ≤8 valid refs (`:396-399`; the
  registry `board.post` schema's exact bounds, `impl/src/application-semantics.mjs:1351-1362`).
  Failures refuse `application_board_post_invalid` (oversize names cap+actual, Decision 12).
- `run.board.read`: `{runId, board}` — same `board` shape. Failures refuse
  `application_board_read_invalid`.

`board` is REQUIRED in v1 (a deviation from the issue's `board?` sketch, with evidence: no
public run→boards projection exists to derive a default from — the only naming convention in
the tree is the settlement board `wave-settlement:<waveId>`, `impl/src/coordinator.mjs:10775`;
Open Questions).

Authorization is the steer idiom against `args.runId` (`_authorize('run.board.post' |
'run.board.read', principal, runId, {board, …})`) — unknown ≡ foreign at the policy seam. The
binding law is then enforced VERBATIM (ground truth 10), derived from the PUBLIC
`boardSnapshot(board).runId` (never a private-map reach, `impl/src/coordinator.mjs:10366-10369`):

- bound to a DIFFERENT run: the constant `application_board_scope_forbidden`, identical for
  post and read, decided BEFORE any item existence or write — a foreign-bound board is
  indistinguishable from any other forbidden scope;
- unbound and EMPTY: read refuses `application_board_not_found` (the BD3-A `context_not_found`
  law); post ADMITS and ADOPTS (below);
- unbound WITH items: read SERVES (the "unbound-with-items serves" law); post adopts;
- bound to THIS run: both serve.

A `run.board.post` to an unbound board records the adoption exactly as the S-2 seam does: the
post carries a `boardAdmission` record `{schemaVersion: 1, runId, requestDigest, adopted:
<items existed>, leaseId: null}` through `postBoardItem`'s admission parameter
(`impl/src/coordination-store.mjs:14028`), so replay derives `{runId, adopted, boundEvent,
requestDigest}` byte-identically (`:8330-8345`) — no lease exists in this posture and none is
fabricated (`leaseId: null`; replay reads no lease field). A post to a stopped/sealed run
refuses `application_board_run_closed` — the projection of the seam's `board_run_closed` law
(`:13937-13940`), derived from the store's own run state.

Outcomes are verbatim plus the envelope marker, mirroring the seam's result envelope
(`:14022-14024`): post → `{schemaVersion: 1, ok, result: 'posted'|'idempotent', item,
boardRunBinding: {runId, result: 'adopted'|'bound'}}` with the hub-minted
`{itemId, itemVersion, itemDigest, ordinal}`; the facade mints the idempotency key
`run.board.post:<runId>:<board>:<digest({title, detail, owner, evidence})>` so an exact retry
replays `idempotent` (`:14029-14030`) and a retry never double-posts. Read → `{schemaVersion: 1,
board, boardRunId, view}` where `view` is `projectBoardView(snapshot, {role: 'orchestrator',
workerId: null})` — the facade's own bounded, dual-fence-cached, UNTRUSTED-framed renderer
(`impl/src/application.mjs:488`, bounds `:60-61`), the exact projection the MCP board read
serves (`impl/src/mcp-northbound.mjs:1721-1728`), NON-EVENTED.

**Rationale:** the deployment orchestrator's kernel posture IS `actor: 'orchestrator'` direct
post (the settlement candidacy precedent, `impl/src/coordinator.mjs:10847-10850`); the rung
surfaces it with the binding law and the closed renderer, instead of forcing every embedded
orchestrator through a lease it does not hold.

### 9. `run.knowledge.seed` — content-addressed seeding inside the run's horizon

Request shape (closed): `{runId, type, grounding, body, evidence?}` — `type` ∈
`KNOWLEDGE_NODE_TYPES` MINUS `{Decision}` (a Decision requires `informedBy` graph sources the
closed shape does not carry, so seeding one is impossible through this lane — the facade
refuses it at validation rather than delegating to a certain `causal_orphan`,
`impl/src/coordination-store.mjs:15165-15170`), `grounding` ∈ `{verified, observed, derived,
asserted}` (`:142`) with the store's shape-checkable rule enforced at the facade (a `verified`
seed REQUIRES a non-empty `evidence`, `:15171-15172`), `body` a non-empty string ≤ 4,096 bytes
(the facade's ordinary text bound `validText`, `impl/src/application.mjs:289-291` — named as
the facade idiom, not a new lane cap; Open Questions), `evidence` optional refs of exactly
`{coordinationSeq: <int>}` or `{artifactId: <id>}` (the store's evidence law, `:15144-15152`).
Failures refuse `application_knowledge_seed_invalid` (oversize names cap+actual, Decision 12).

Authorization is the steer idiom against `args.runId` (`_authorize('run.knowledge.seed',
principal, runId, {type, grounding, bodyDigest})`). On authorization the facade calls
`this.driver.coordination.addKnowledgeNode({type, grounding, body, runId, evidence},
{actor: principal.actor, key: 'run.knowledge.seed:<runId>:<digest({type, grounding, body,
evidence})>'})`:

- the node carries `runId`, so it lands INSIDE the run's horizon by construction
  (`impl/src/coordinator.mjs:10436-10437`) — seeding is horizon-scoped, never ambient;
- the server-derived key is content-addressed: an exact retry replays `idempotent`
  (`impl/src/coordination-store.mjs:15625-15628`); different content is honestly a different
  seed, never a silent overwrite;
- the lane's state-dependent refusals propagate byte-identically: `invalid_evidence` (a
  future/missing `coordinationSeq` or unknown `artifactId`), `missing_endpoint`,
  `causal_orphan`, `knowledge_node_conflict`, `duplicate_node` (ground truth 12). Under the
  content-derived key the digest-adjudication pair (`knowledge_node_conflict`,
  `duplicate_node`) is defense-in-depth — the content-addressed identity makes identical
  content an `idempotent` replay and distinct content a distinct node, so the pair is not
  reachable through ordinary use and MUST stay that way.

Response: `{schemaVersion: 1, ok: true, result: 'added'|'idempotent', nodeId}` — the node's
content-addressed id, never a facade-minted one.

**Rationale:** orchestrator knowledge seeding under a run's horizon is the first move of the
acceptance workflow (Decision 13); the store lane is complete (ground truth 12) and the
projection wires it with the facade's authority and idempotency idioms.

### 10. MCP projections — ordinary plane, wave-tools envelope, refusal constancy to the wire

Six NEW tools join `ORDINARY_APPLICATION_TOOL_DEFINITIONS` (closed `schema()` schemas with
`additionalProperties: false`, `impl/src/mcp-northbound.mjs:246-248`; `_meta` registry-digest
stamp, `:558-561`), each with a `CAPABILITY` registration (`:96-99` idiom), a hand-rolled
`invalid_*` shape guard (`:976-1020` idiom), an explicit `_dispatch` branch calling
`application.command(<name>, …)` with the CONNECTION-derived principal (`:1536-1573` idiom),
and `ORDINARY_EXPLICIT_TOOLS` membership (`:699-705`):

| MCP tool | Facade command | Capabilities | Annotations |
| --- | --- | --- | --- |
| `baton_run_message_send` | `run.message.send` | `['control', 'observe']` | effectful, NOT idempotent |
| `baton_run_message_receipt` | `run.message.receipt` | `['observe']` | read-only, idempotent |
| `baton_run_attention_watch` | `run.attention.watch` | `['observe']` | read-only, idempotent |
| `baton_run_scratchpad_read` | `run.scratchpad.read` | `['observe']` | read-only, idempotent |
| `baton_run_scratchpad_elevate` | `run.scratchpad.elevate` | `['control', 'observe']` | effectful, NOT idempotent on the wire |
| `baton_run_knowledge_seed` | `run.knowledge.seed` | `['control', 'observe']` | effectful, idempotent via server-derived key |

Schemas mirror the facade shapes plus `repoId` (e.g. send: `{repoId, runId?, workerId?, kind:
enum, body: string 1..2048}` with the XOR and BYTE cap guard- and facade-side — JSON-schema
`maxLength` counts chars, never the authority). None carries a wire `idempotencyKey`; none
joins `STATEFUL`/`RECONCILABLE` (`:120-127` posture) — a `run.message.send` retry mints a NEW
message honestly (`impl/src/coordinator.mjs:6615`'s seq-bound digest), while elevate/seed
replay safety lives server-side in the deterministic keys (Decisions 7 and 9), not in wire
fields. Per-call quota rides `handle()` unchanged (ground truth 20).

**Boards are deliberately NOT new ordinary tools.** MCP board coverage already exists as the
S-2 `baton_board_*` family on the combined surface (ground truth 11). Adding a second,
lease-free ordinary MCP path to the same seam would duplicate authority postures on one
transport — a red-team magnet with zero compositional gain: facade-driven workflows use
`run.board.post`/`run.board.read`; MCP-driven workflows use `baton_board_post`/
`baton_board_read`. (Open Questions records the ordinary-surface board question for the MCP
packaging epic.)

Refusal constancy to the wire REQUIRES one `stateFailureCode` amendment
(`impl/src/mcp-northbound.mjs:187-240`) — every code below currently collapses to
`command_outcome_unknown` (`:239`; verified against the full mapping, ground truth 14):

- the attention family: `attention_scope_forbidden`, `attention_scope_invalid`,
  `attention_target_invalid`;
- the scratchpad family: `scratchpad_settlement_invalid`, `scratchpad_settlement_conflict`,
  `scratchpad_settlement_not_ready`, `stale_scratchpad_fence`,
  `scratchpad_partition_exhausted`, `scratchpad_read_invalid`;
- the knowledge-seed family: `duplicate_node`, `invalid_evidence`, `missing_endpoint`,
  `causal_orphan`, `knowledge_node_conflict`.

The facade's `application_*` codes already pass through (`:193`); the board family
(`board_admission_invalid`, `stale_board_fence`, `board_item_*`, `invalid_board*`) is already
mapped (`:223-231`); the lanes' bare TypeErrors are unreachable through facade validation
(Decision 1). All six tools are ORDINARY-PLANE: no `sessionAuthority`, no lease argument, no
`settlement` capability class (ground truth 15). The wave-tools section of `impl/MCP.md:61-89`
gains a short prose paragraph per lane (inventory-table rows are generated — Decision 11;
hand-written inventory prose is linted red, `impl/test/control-surface-truth-red.test.mjs:
148-159`).

**Rationale:** mirrors the wave-tools projection one-for-one (ground truth 14) so the
MCP-first orchestrator reaches every lane with the envelope shape it already speaks.

### 11. CLI verbs + registry rows + the conformance regeneration step

The CLI verb idiom supports the verbs (ground truth 16), via the `start`-precedent early
branch per noun (the sub-verb must shift BEFORE the generic `runId` shift,
`impl/src/application-cli.mjs:1354-1362`):

- `baton run message send RUN_ID --kind inform|query|steer --body TEXT`
- `baton run message send --worker WORKER_ID --kind KIND --body TEXT` (exactly one target form)
- `baton run message receipt MESSAGE_ID`
- `baton run attention watch RUN_ID [--kind KIND] [--cursor N]`
- `baton run scratchpad read RUN_ID --scope shared|worker:ID [--cursor N]`
- `baton run scratchpad elevate RUN_ID --task TASK_ID --entries JSON`
- `baton run board post RUN_ID --board BOARD --title TEXT [--detail TEXT] [--owner ID]
  [--evidence JSON]`
- `baton run board read RUN_ID --board BOARD`
- `baton run knowledge seed RUN_ID --type TYPE --grounding G --body TEXT [--evidence JSON]`

Parse results are `{kind: 'command', name: <facade command>, args, idempotencyKey}` (the
run-table command idiom, `:1500-1514`); `CLI_WEB_COMMANDS` gains all eight facade command names
(the dispatch gate, `:15-25`, `:1792`). Eight registry rows join `CANONICAL_OPERATION_SPECS` in
the wave-rows shape (`impl/src/application-semantics.mjs:1565-1613`): `profile: 'ordinary'`;
`surfaces: ['embedded', 'mcp', 'cli']` for the six MCP-projected lanes and
`surfaces: ['embedded', 'cli']` for `run.board.post`/`run.board.read` (Decision 10 — no
ordinary MCP board tools); capabilities `['control', 'observe']` (send/elevate/post/seed) /
`['observe']` (reads); `idempotent: false` for `run.message.send` (default true stands for the
reads and the server-keyed lanes); closed `inputSchema`s matching Decisions 3-9; the `example`
spellings above. Derived names are mechanically C4-clean (ground truth 18), and
`servedCliOrdinaryKeys()` picks the keys up through the whitelist→canonical mapping
(`impl/scripts/render-surface-docs.mjs:34-75`).

The conformance-doc regeneration step is MANDATORY and ordered:

1. `node impl/scripts/render-surface-docs.mjs` — rewrites the CLI.md and MCP.md generated
   inventory blocks in place (`render-surface-docs.mjs:156-165`).
2. `node impl/scripts/surface-conformance.mjs --write-inventory` — regenerates the CS-4 checked
   artifact (counts change: canonicalOperations +8, cliWebCommands +8, mcpApplicationTools +6,
   `impl/scripts/surface-conformance.mjs:652-678`).
3. Verify: `node impl/scripts/render-surface-docs.mjs --check` clean,
   `node impl/scripts/surface-conformance.mjs` prints `surface-conformance: ok`, and the three
   pinning suites stay green (ground truth 17).

**Rationale:** the inventory blocks are executable projections of the served surface, not
prose; landing tools without regenerating them fails the committed-block pins by construction.

### 12. Frame-economics honesty (#89) — project existing caps, name cap+actual

Every size bound this rung refuses on ALREADY EXISTS; the refusal TEXT names cap and actual per
#89's admitted-refusal law (ground truth 19). The complete projected-cap table:

| Lane | Bound | Authority |
| --- | --- | --- |
| message body | 2,048 bytes | `impl/src/coordinator.mjs:6597-6599` |
| scratchpad entryIds | ≤128 unique `scratchpad-entry:<64 hex>` | `impl/src/coordination-store.mjs:13543-13546`, `:480`, `:473` |
| scratchpad read page | ≤64 entries; ≤4,096 bytes per rendered leaf | `impl/src/coordinator.mjs:10402`; `impl/src/application.mjs:300`, `:53` |
| board title / detail / evidence | 160 / 4,096 bytes / ≤8 refs | `impl/src/coordination-store.mjs:396-399` |
| board read view | 512 items / 256 KiB, explicit truncation | `impl/src/application.mjs:60-61` |
| knowledge seed body | 4,096 bytes (the facade's ordinary `validText` idiom — named as such, Open Questions) | `impl/src/application.mjs:289-291` |

No new caps are invented: `MAX_ATTENTION_TEXT_BYTES = 4_096` (`:53`) remains the STEER lane's
cap and applies elsewhere only where cited as the facade's existing text idiom; MCP schema
`maxLength` is a char-level shape hint, never the authority; the 20,480 scanner window (pinned
shape-only at `impl/test/bidirectional-v3-red.test.mjs:448-455`) is a substrate guard,
untouched; the reply lane's admission bound and spillover (artifact + digest citation) are
#89's lane rung, inherited never varied. Each lane gets ONE invalid code whose oversize text
carries `{cap, actual}` (e.g. `applicationError('Run message body exceeds the 2048-byte message
cap (actual 2049 bytes)', 'application_message_send_invalid')`).

**Rationale:** contract requirement 5; the C0b pin already guards the wire side, and this rung
must not widen the sin #89 catalogued (bare cap-less refusals).

### 13. The scripted-workflow property — the rung's live acceptance

A dynamic workflow (seed → wave → steer → gate → elevate → synthesize) is composable through
these commands ALONE. The acceptance is the control-surface audit demo, driven end-to-end by
ONE scripted driver that imports ONLY the facade (or talks MCP) — a static assertion proves the
script contains no `createDriver` / `coordinator.mjs` / `coordination-store.mjs` import (the
`impl/demo.mjs:1-13` anti-pattern, inverted). The verb sequence, each mapped to its surface:

1. **Seed board + knowledge** — `run.knowledge.seed` (spec decomposition + constraints nodes
   inside the run's horizon) and `run.board.post` (the swarm's task board, adopted on first
   post). MCP equivalent: `baton_run_knowledge_seed`, `baton_board_post`.
2. **`waves.start` (4 members)** — the existing facade direct port /
   `baton_waves_start` (`impl/src/application.mjs:12095`; `impl/src/mcp-northbound.mjs:
   456-472`); each member's brief cites the seeded board and horizon.
3. **Message status queries** — `run.message.send` `{kind: 'query'}` to each member /
   `baton_run_message_send`.
4. **MESSAGE_SEND replies** — the worker wire grammar (#86, landed;
   `impl/test/bidirectional-v3-red.test.mjs:414-455`); the orchestrator reads each reply
   through `run.message.receipt` / `baton_run_message_receipt` (the reply rides the parent
   message's receipt, C1).
5. **Decision-gate synthesis** — the orchestrator pages `run.attention.watch` /
   `baton_run_attention_watch` (member_terminal/coalescing, candidacy_review where authorized)
   and answers the gate through the EXISTING `run.answer` / `baton_decision_answer`
   (`impl/src/mcp-northbound.mjs:507-518`) — both facade/MCP commands; the synthesis itself is
   the orchestrator's own logic, not a baton command. (The landed wake vocabulary carries no
   `decision_pending` kind — ground truth 4; the gate is answered, not awaited.)
6. **Elevate findings** — `run.scratchpad.elevate` per terminal member task /
   `baton_run_scratchpad_elevate`.
7. **Shared reads** — `run.scratchpad.read` `{scope: 'shared'}` and `run.board.read` /
   `baton_run_scratchpad_read`, `baton_board_read`: the swarm's elevated findings and the
   triaged board, bounded and framed.
8. **Harvest** — `waves.attach` / `baton_waves_attach` (the existing resume path,
   `impl/MCP.md:83-89`).

The pin is TOTAL: every step above is a facade command or an MCP tool — none is a kernel
reach. A workflow step that cannot be expressed this way is a rung bug, not a driver license.

**Rationale:** the operator's law (`docs/PROGRESS.md:391`) is the rung's reason to exist;
Decision 1's zero-kernel-reach rule is its enforcement.

## Refusal vocabulary (complete, per surface)

Facade (embedded `application.command`):

- `application_message_send_invalid` / `application_message_receipt_invalid` /
  `application_attention_watch_invalid` / `application_scratchpad_read_invalid` /
  `application_scratchpad_elevate_invalid` / `application_board_post_invalid` /
  `application_board_read_invalid` / `application_knowledge_seed_invalid` — closed-shape
  failures, thrown BEFORE any state lookup; oversize text names cap+actual (Decision 12).
- `application_unauthorized` — host-policy refusal; CONSTANT for unknown ≡ foreign at every
  resolve-then-authorize seam (message targets, message receipts, elevation tasks) and every
  run-scoped `_authorize` (scratchpad read, board post/read, knowledge seed).
- `attention_scope_invalid` / `attention_scope_forbidden` / `attention_target_invalid` —
  lane-thrown, propagated byte-identically; `attention_scope_forbidden` is CONSTANT for unknown
  and out-of-scope targets (D1).
- `application_board_scope_forbidden` — the facade's binding-law constant (foreign-bound
  board), identical for post and read, decided before any item existence or write;
  `application_board_not_found` (unbound-and-empty read); `application_board_run_closed`
  (post to a stopped/sealed run).
- Lane-thrown codes propagated byte-identically: `stale_scratchpad_fence`,
  `scratchpad_settlement_conflict`, `scratchpad_settlement_invalid` (state-dependent),
  `scratchpad_partition_exhausted`, `duplicate_node`, `invalid_evidence`, `missing_endpoint`,
  `causal_orphan`, `knowledge_node_conflict`.
- Lane OUTCOMES (never throws), verbatim: `{ok: false, result: 'worker_not_active' |
  'run_not_active' | 'scratchpad_settlement_not_ready'}`, `{ok: true, result: 'sent' |
  'empty' | 'posted' | 'idempotent' | 'added', …}`.
- `application_command_unavailable` — unchanged descriptor-facade posture for unserved
  commands (`impl/src/mcp-descriptor.mjs:159`).

MCP wire (via `stateFailureCode`, `impl/src/mcp-northbound.mjs:187-240`):

- `forbidden` — capability-class refusal (`_authority`, `:1141-1152`) or mapped
  `application_unauthorized` (`:189`).
- `invalid_message_send` / `invalid_message_receipt` / `invalid_attention_watch` /
  `invalid_scratchpad_read` / `invalid_scratchpad_elevate` / `invalid_knowledge_seed` —
  hand-rolled shape guards (`:976-1020` idiom).
- All `application_*` facade codes — pass-through (`:193`).
- The attention, scratchpad-settlement, and knowledge-seed families — NEW pass-through entries
  (Decision 10); they must NEVER surface as `command_outcome_unknown` (`:239`) or
  `invalid_command` (`:238`).

CLI: parse failures keep the `cli_invalid` / `cli_command_unavailable` vocabulary
(`impl/src/application-cli.mjs:42`, `:1792`); dispatch failures are the facade codes above.

## Non-goals

- No changes to the kernel lanes' logic — the single permitted kernel-side addition is the
  read-only authorization accessor of Decision 4. The BD3-C/D, #78 board, S-2, settlement,
  grammar-m3, MCP-packaging, wave, and conformance suites are not touched, weakened, or
  re-pinned.
- No addition to `APPLICATION_COMMAND_DEFINITIONS` (byte-stable pin), no new surface aliases,
  no changes to the settlement envelope (`baton_scratchpad_elevate`/`baton_scratchpad_settle`/
  `baton_knowledge_*` stay exactly as landed), the S-2 authority model, the board grant
  machinery (#78), or the recursive-session gate's command-table coverage.
- No ordinary MCP board tools (Decision 10); no REPL binding surface (#48's fourth gap — Open
  Question 6); no mid-flight elevation surface (Decision 7); no long-poll/wait behavior, wake
  kinds beyond the landed two, fence-pinned scratchpad cursors, or default-board convention.
- No limits registry (#89's declared home); cap+actual refusal text names the projected caps
  inline, as the steer validators already do.
- No worker-side wire grammar (#86, landed) and no worker-profile rows on any ordinary surface.
- No implementation edits in this contract-authoring epic; implementation and the red-first
  suite are subsequent rungs.

## Red-first acceptance

Implementation begins by adding a focused red suite (suggested home:
`impl/test/workflow-surface-red.test.mjs`) whose positive rows fail against the current
facade/MCP/CLI (the commands and tools do not exist today — ground truth 5). Existing suites
remain unchanged and green; no existing assertion is weakened. Facade rows drive
`application.command(name, args, principal, context)` (`impl/src/application.mjs:12055`) with
the established `authorize: async () => true` stub and a policy stub refusing named runs for
the constancy rows (`impl/test/mcp-packaging-red.test.mjs:556` idiom).

| ID | Red state to prove first | Green acceptance oracle |
| --- | --- | --- |
| FP-01 | The eight commands do not dispatch. | All eight dispatch through `application.command`; extra/missing fields, bad enums, non-XOR targets, malformed ids/cursors/scopes refuse the pinned `application_*_invalid` codes BEFORE any state lookup; no bare TypeError reaches the caller. |
| FP-02 | No facade send reaches the lane. | Facade send to a spawned worker (the C1 fixture shape) mints `message:<64 hex>`, delivers, and returns `{schemaVersion: 1, ok: true, result: 'sent', messageId, delivered, targetCount}` identical to the embedded outcome for the same fixture. |
| FP-03 | Send target refusals could leak or re-code. | With a policy refusing the run, unknown-workerId ≡ foreign-target ≡ `application_unauthorized`; with the permissive stub, unknown worker → `{ok: false, result: 'worker_not_active'}` and empty run → `{ok: false, result: 'run_not_active'}` — byte-identical to the embedded lane. |
| FP-04 | Receipt states could diverge between paths. | THE IDENTITY ROW: one message driven through BOTH paths — `coordinator.messageReceipt(id)` and facade `run.message.receipt` return DEEP-EQUAL `{delivered, read, actedOn, reply}` at every transition: at send, after same-generation `turn_started`, after process death (C3), after respawn (C3b), and with a reply (closed shape, smuggled fields absent — C1b). |
| FP-05 | A receipt read could leak message existence. | Unknown messageId ≡ foreign messageId ≡ `application_unauthorized` (resolve-then-authorize); the lane's `null` return is unreachable through the facade; no receipt field crosses before authorization. |
| FP-06 | Scope constancy could break through projection. | The D1 row through `application.command`: out-of-scope target ≡ unknown target ≡ `attention_scope_forbidden`, byte-identical with no facade wrapper; malformed scope/target refuse `attention_scope_invalid` / `attention_target_invalid` identically to the embedded lane. |
| FP-07 | Candidacy disclosure could widen through projection. | The D2 row through the facade: a non-review-authority principal receives zero `candidacy_review` reasons even when one exists; the `wave-owner` principal receives it with `count ≥ 1`. |
| FP-08 | Page content could be re-shaped by the projection. | The D3/D4 rows through the facade: storm coalescing carries explicit `count` + `perPhase` (+`windowMs`) with no singular `{role, phase}`; post-terminal reasons carry `memberState: 'terminal-at-mint'`; `throughCursor` chains pages byte-identically. |
| FP-09 | Scratchpad reads could leak, spill, or instruct. | `run.scratchpad.read` on `shared` and `worker:<id>` serves ≤64-entry pages with `UNTRUSTED_SCRATCHPAD` framing and ≤4,096-byte leaves; `nextCursor` pages the remainder; `scratchpadFence`/`observedSeq` ride verbatim; a foreign run refuses `application_unauthorized` identically to an unknown one; the read appends no event and mints no audit class. |
| FP-10 | Elevation could bypass its fence discipline. | `run.scratchpad.elevate` on a terminal task returns the verbatim store receipt (`elevated`, `dispositionDigest`, both fences); a non-terminal task returns `{ok: false, result: 'scratchpad_settlement_not_ready'}`; an exact retry replays `idempotent`; a changed selection on retry refuses `scratchpad_settlement_conflict`; an unknown/cross-run/foreign task ≡ `application_unauthorized`; a selection outside the partition surfaces the lane's `scratchpad_settlement_invalid`. |
| FP-11 | Board binding semantics could drift. | `run.board.read` of a foreign-bound board ≡ `application_board_scope_forbidden` (post identical); unbound+empty read ≡ `application_board_not_found`; unbound-with-items read SERVES; a first post to an unbound board returns `boardRunBinding.result: 'adopted'` and replay derives the binding byte-identically; a post to a stopped/sealed run refuses `application_board_run_closed`; an exact retry replays `idempotent` (never a double post). |
| FP-12 | The board read could serve raw or stale views. | The read view is `projectBoardView`'s exact output (≤512 items / ≤256 KiB, truncation-marked, UNTRUSTED-framed, dual-fence cache — a claim/report/expiry invalidates it, the #78 BW-14 law) and appends no event. |
| FP-13 | Seeds could escape the horizon or the idempotency law. | `run.knowledge.seed` returns the content-addressed `nodeId`; the node is inside the run's horizon (`_runHorizonNodeIds` membership); an exact retry returns `idempotent` with the same id; distinct content seeds a distinct node (never a silent overwrite); a `verified` seed without evidence refuses `application_knowledge_seed_invalid`; type `Decision` refuses at validation; a stale `coordinationSeq`/unknown `artifactId` surfaces the lane's `invalid_evidence`; `knowledge_node_conflict`/`duplicate_node` stay unreachable through the content-derived key (defense-in-depth, asserted by a key-derivation row). |
| FP-14 | The tools could be absent, open-shaped, or self-naming. | MCP descriptor rows: the six tools appear in `mcpApplicationToolNames()` with `additionalProperties: false` schemas, `_meta` registry digest, the pinned capability classes, `invalid_*` guards, and dispatch to the right `application.command` names with the CONNECTION-derived principal (a tool-arg `principalId`/`sessionId`/`sessionAuthority` is schema-refused); no `baton_run_board_*` tool exists. |
| FP-15 | Refusals could degrade at the wire. | Through a descriptor-driven `McpFleetServer`: the `application_*` codes and every newly mapped lane family (attention/scratchpad-settlement/knowledge-seed) surface AS THEMSELVES — never `command_outcome_unknown`, never `invalid_command`; the six tools are in `ORDINARY_EXPLICIT_TOOLS`; none is in `STATEFUL`/`RECONCILABLE`; no wire schema carries `idempotencyKey`. |
| FP-16 | Docs could drift from the served surface. | CLI rows: the nine spellings parse to the pinned `{kind: 'command', name, args}` dispatches (unknown sub-verb → parse error, not a run-start objective); after the Decision 11 regeneration, `checkSurfaceDocs() === []`, `node impl/scripts/surface-conformance.mjs` prints `surface-conformance: ok` with the regenerated CS-4 artifact, and the three pinning suites stay green. |
| FP-17 | Size refusals could stay silent or invent caps. | For EACH row of the Decision 12 table: at-cap admitted, cap+1 refused with the pinned `application_*_invalid` code whose text names BOTH numbers; a static assertion shows the new validators contain ONLY the cited constants; at MCP the refusals surface as `application_` codes, never `invalid_command`. |
| FP-18 | The projection could smuggle semantics. | Static pins: `Object.keys(APPLICATION_COMMAND_DEFINITIONS)` unchanged (grammar-m3 green); `wave-driver.mjs` still free of `attentionFollow` (the D5 pin, `impl/test/bidirectional-v3-red.test.mjs:747`); the new tool schemas carry no `sessionAuthority`/lease/settlement fields; the kernel diff contains ONLY the read-only authorization accessor; the eight commands dispatch ahead of the recursive-session gate (a live run-orchestrator lease holder retains the lane-admitted review authority). |
| FP-19 | The settlement plane could be perturbed. | A descriptor-driven server whose principal lacks the `settlement` capability serves all six new tools; the settlement tools' envelope requirements (`board_lease_required`, settlement capability) are byte-identical before and after; the combined-surface `baton_board_*` family is untouched. |
| WS-01 | The demo still needs a bespoke driver. | THE SCRIPTED-WORKFLOW ROW (live acceptance): one scripted driver runs the Decision 13 sequence end-to-end — seed → `waves.start` (4) → message queries → reply receipts → attention pages + decision answer → elevate → shared/board reads → `waves.attach` harvest — importing ONLY the facade (or talking MCP). A static assertion proves the script contains no `createDriver`/`coordinator.mjs`/`coordination-store.mjs` import; every effect is receipted on durable events/ids (message ids, board item ids, node ids, elevation receipts, attach outcome), never sleep durations or turn counts. |
| WS-02 | A step could silently require kernel reach. | The demo's step→command map is asserted mechanically: each of the eight sequence steps resolves to a served facade command or MCP tool in the regenerated inventories (CLI.md/MCP.md generated blocks + the CS-4 artifact). |

The end-to-end oracles (FP-04, FP-06…FP-08, WS-01) key on durable ids, codes, and state
predicates — never sleep duration, turn count, or polling cadence (the campaign control law).

## Open questions

1. **The `follow` → `watch` rename.** Both issues example `follow`-named spellings; the C4
   banned-verb lint forces the canonical key to `run.attention.watch` (Decision 2, ground truth
   18). A literal `follow` spelling on any surface requires a documented lint exception (the
   `waves.progress` carve-out pattern, `impl/scripts/surface-conformance.mjs:710-718`) — this
   contract deliberately does not spend that capital.
2. **Long-poll `timeoutMs`.** The landed `attentionFollow` ignores `timeoutMs` and pages
   immediately (ground truth 3), so no surface projects a wait budget. If a bounded long-poll
   (capped by the MCP frame budget, `impl/src/mcp-descriptor.mjs:197`) is wanted, it must land
   in the lane first (#75 territory), then project — never the reverse.
3. **Sealed-run message sends.** The facade adds no mutability pre-assertion (Decision 1);
   whether the LANE should refuse sends to sealed runs (today it answers `worker_not_active`/
   `run_not_active` via liveness) is a lane-contract question for #75/#89.
4. **Reply-lane admission bound.** #89 notes the worker→orchestrator reply direction has no
   body bound at admission while the send direction caps at 2,048 — a lane-level inconsistency
   this projection inherits honestly and does not paper over.
5. **The optional `board` default.** Both the issue sketch and the operator's expansion write
   `board?`. No public run→boards projection exists to derive a default from (the only naming
   convention in the tree is the settlement board, `impl/src/coordinator.mjs:10775`), so v1
   requires `board` explicitly (Decision 8). If a default is wanted, the store needs a
   run→boards public projection first — a kernel rung, then a one-line facade relaxation.
6. **REPL binding orchestration (#48's fourth gap).** Not in this rung: no facade command or
   MCP tool for minting/updating shared bindings is specified here. The gap stands; its owner
   should be named before #48 can close (the REPL epic that owns the manifest/binding/cite
   machinery, per the #69 evidence).
7. **Knowledge seed body bound.** The facade applies its ordinary 4,096-byte `validText` idiom
   to seed bodies (Decision 9/12); the KG itself imposes no body cap. If real seeds outgrow it,
   the answer is citation chains (evidence refs / Supersedes edges), not a bigger inline body —
   but the bound is recorded here as a facade-idiom choice the red-team may challenge.
8. **Fence-pinned scratchpad cursors and mid-flight elevation.** v1 pages scratchpad reads by
   offset with a carried fence (Decision 6) and projects only the terminal-task elevation
   wrapper (Decision 7). The store's `expectedFenceTuple` CAS
   (`impl/src/coordination-store.mjs:13401-13405`) and the steering-registered mid-flight
   relaxation (`:13587-13597`) are the named candidates for a later rung.
