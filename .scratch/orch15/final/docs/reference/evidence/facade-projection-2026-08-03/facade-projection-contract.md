# Epic #87+#48 — The workflow-surface rung: facade/MCP projection of the message, attention, and shared-layer lanes (v2.2)

Status: implementation contract, red-team fold COMPLETE. v2.0 folded issue #48 (the
shared-layer surface) into issue #87 (the BD3-C/D projection) per the operator directive of
2026-08-03: this rung unifies every orchestrator-facing lane a scripted dynamic workflow needs
onto the application facade and its MCP/CLI projections. This epic specifies behavior; it does
not amend implementation in this artifact.

**v2.1 fold note (2026-08-04).** The pre-implementation red-team (`contract-redteam.md` in this
directory) returned **NOT FOLD-READY, 7 blockers**. All seven are folded: (1) the elevation
lane's non-steering selection discard was misread — ground truth 9 and Decision 7 now state
the true steering-registered semantics and name the run-creation registration ceremony (the
kernel amendment is deliberately NOT spent; Decision 7 says why); (2) the elevation retry law
is rewritten to the fence-bound truth — a wrapper-driven exact retry returns the `empty`
receipt, never `idempotent`, and `scratchpad_settlement_conflict` is a store-direct posture;
(3) the knowledge evidence codes are corrected (`temporal_incoherence` for a stale
`coordinationSeq`, `missing_evidence` for an unknown `artifactId`) and Decision 10's
`stateFailureCode` amendment re-enumerated against the live mapping; (4) the MCP acceptance is
re-staged onto what is reachable — per-lane principal/capability preconditions named, board
rows ride the combined surface with the S-2 lease ceremony named, and the #93 discovery note
recorded (this rung RIDES the combined reality; it does not fix default visibility); (5)
scratchpad read pages gain a 256 KiB serialized budget with digest-citation truncation per the
renderer doctrine; (6) WS-01's static assertion now also bans `.driver`/`.coordinator`/
`.coordination` field-reach — closing the PUBLIC `BatonApplication.driver` field is a
composition-law change filed as a separate issue at fold time, deliberately not widened into
this rung; (7) the five wrong-at-authoring anchors are corrected (`KNOWLEDGE_NODE_TYPES` is 19
types at `:141`; the demo import is `impl/demo.mjs:14`; `mcp-descriptor.mjs:47-48` carries no
settlement logic — enforcement is `mcp-northbound.mjs:104` + `_authority`; the board replay
envelope is the seam's `:14221-14226`, not the fresh-post branch; the `waves.attach` resume
prose is `impl/MCP.md:74-82`). Citation frame: every citation in a v2.1-amended section was
re-verified TWICE against the live 2026-08-04 worktree (post-`0eae749` + `5fb3425` + in-flight
readiness work — `coordination-store.mjs` and `coordinator.mjs` moved under the fold and were
re-checked until stable). The blocker→change
map is `contract-fold.md` in this directory. Sections v2.1 does not amend keep their earlier
anchors — exact at the contract's 2026-08-03 verification AND at the red-team's 2026-08-04
pass; the in-flight readiness work moved `coordinator.mjs`/`coordination-store.mjs` again
during the fold, so those stretches cite the red-team-era frame (the drift is worktree
movement, never a misread — the red-team's §1.2 exoneration covers it).

**v2.2 fold note (2026-08-04).** The pre-implementation blue-team (`suite-blueteam.md` in this
directory) returned **NOT-READY, 4 blockers** against the red suite. The suite-side blockers
are folded in the suite (WS-01's facade plan-approval drive and full-objective attach
identity; the FP-05 dead-handle leg); the contract-side amendments land here: (1) Decision 6's
response shape now NAMES the `frame` and `digest` fields — the renderer's own field names
(`impl/src/coordinator.mjs:10474-10499`) — so a contract-literal implementation no longer
invents divergent names and goes false-red on FP-09 (blue-team BLOCKER 3, the recommended
disposition: amend the contract, keep the suite's exact asserts); (2) Decision 4's accessor
name is pinned as `coordinator.messageRunId(messageId)` — the "e.g." hedge dropped, the suite
is the pin (blue-team D2); (3) the refusal vocabulary records that the new ordinary
`baton_run_scratchpad_elevate` guard SHARES the `invalid_scratchpad_elevate` string the
existing settlement guard already returns — lawful same-class reuse, no invented distinct
code (blue-team D3). The blocker→change map is `suite-fold.md` in this directory.

**The operator's law (binding):** *"Composition v2.1 acceptance law (operator): no new
orchestration wave may require a new script file"* (`docs/PROGRESS.md:391`). Dynamic workflows
must be composable THROUGH the baton surface (facade/MCP) with ZERO kernel reaches — no more
bespoke drivers importing `createDriver`/coordination-store to orchestrate (the anti-pattern is
the shipped demo's shape, `impl/demo.mjs:14`: `import { createDriver, MockAdapter } from
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
2026-08-03; v2.1 re-verified the citations in its amended sections against the 2026-08-04
worktree (the header fold note names the frame). #86 (worker reply wire grammar) and #92 (the delivery frame carries the messageId,
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
   (`impl/src/coordinator.mjs:6733-6772`) validates scope as exactly `{runId}` with a
   null-or-id-shaped value (`attention_scope_invalid`, `:6735-6739`) — a BARE deployment scope
   (`scope.runId == null`) is VALID at the lane (`:6741`) — authorizes the caller's parent
   scope FIRST (`attention_scope_forbidden`, `:6746-6748` via `_attentionScopeAuthorized`,
   `:6774-6778`), then normalizes targets server-side: a `{runId}` target outside the scope
   refuses `attention_scope_forbidden` IDENTICALLY to an unknown one — before any existence
   check (D1, `bidirectional-v3-red.test.mjs:646`); a malformed target refuses
   `attention_target_invalid`. String targets ARE admitted as wake kinds (`targetKinds.add(
   target)`, `:6753-6754`). It returns `{reasons, throughCursor, afterCursor, runId}`
   (`:6766-6772`). `timeoutMs` is destructured but NEVER referenced in the body (`:6733-6772`):
   the landed lane is an immediate cursor page, not a long-poll.

4. **The attention authority model is principal-shaped and lane-resident.** The deployment's
   orchestrator principal (`principalId === 'wave-owner'`) is the viewer of record
   (`impl/src/coordinator.mjs:6774-6778`); a run-scoped follow also admits a live
   run-orchestrator lease holder whose session belongs to the caller (`_isReviewAuthority`,
   `:6782-6793`, consulting `activeRunOrchestratorLeaseForSession(runId, sessionId)`). A bare
   deployment scope admits ANY authenticated principal (`:6776`) — vacuously, since
   `_attentionPage` filters `reason.runId !== runId` (`:6801`), so a null scope pages nothing.
   `wave-owner` appears NOWHERE in `impl/src` except `coordinator.mjs` itself (verified by
   `grep -rn` on 2026-08-04): no production caller self-names it — it is the embedded/test-
   fixture principal (Decision 5's transport-authority paragraph carries the consequence).
   `candidacy_review` is disclosed ONLY to the review authority, derived live from the candidacy
   queue (`_attentionPage`, `:6796-6812`; D2, `bidirectional-v3-red.test.mjs:668`). Storm
   coalescing emits an explicit `count` + `perPhase` distribution and drops singular member
   identity (`_mintMemberTerminal`, `:6834`, window `ATTENTION_COALESCE_WINDOW_MS = 500`,
   `:45`; D3, `:692`). Wake reasons minted after a member's terminal transition carry
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
   13650-13656`) returns `{runId, scope, observedSeq, scratchpadFence, fenceTuple, entries}`;
   the batch form (`:13632-13647`) validates scopes against `SCRATCHPAD_SCOPE` =
   `^(?:shared|worker:[A-Za-z0-9._:-]{1,256})$` (`:500`) with `scratchpad_read_invalid`
   (`:13633-13637`) and offers an `expectedFenceTuple` CAS refusing `scratchpad_cursor_stale`
   (`:13638-13641`). The snapshot is NON-EVENTED, and an unknown run returns an EMPTY snapshot
   (the `validRunId` check is shape-only, `:13633`). Partition ceilings:
   `MAX_SCRATCHPAD_WORKER_ENTRIES = 128`, `MAX_SCRATCHPAD_SHARED_ENTRIES = 512` (`:491-492`);
   entry ids are `scratchpad-entry:<64 hex>` (`:498`). A reap bumps the scope's fence
   (`:8264`, `:8306`; replay derives `observedFence + 1`, `:8330`). The BD3-A worker read lane
   renders the shared partition bounded ≤64 items with `UNTRUSTED_SCRATCHPAD` framing and
   per-leaf text bounding (`_renderContextRead`, `impl/src/coordinator.mjs:10472-10500` —
   `maxItems = kind === 'knowledge' ? 8 : 64` at `:10480`, the frame map at `:10474-10479`,
   and the overflow doctrine `truncated` + a digest over the full id set at `:10496-10499`).

9. **Elevation is landed with its fence discipline — and its steering-registered selection
   semantics (v2.1: this entry replaces v2.0's misread).** The coordinator wrapper
   `elevateTaskScratchpad(taskId, entryIds)` (`impl/src/coordinator.mjs:11083-11085`) rides
   `_settleTerminalScratchpad` (`:10292-10308`): a non-terminal task returns
   `{ok: false, result: 'scratchpad_settlement_not_ready'}` (`:10295-10297`); a task with no
   worker returns `{ok: true, result: 'empty'}` (`:10299`); otherwise the wrapper derives
   workerId and `expectedScratchpadFence` from LIVE state on EVERY call (`:10305`) and calls
   the store with `{actor: 'orchestrator', key: 'scratchpad.task_settlement:<taskId>'}`
   (`:10307`). The store (`impl/src/coordination-store.mjs:13775-13920`) requires
   `auth.actor === 'orchestrator'` and a closed shape (`scratchpad_settlement_invalid`,
   `:13776-13785`). Its dedup is FENCE-BOUND: the replay key is
   `scratchpad.partition_reaped:<runId>:<taskId>:<expectedScratchpadFence>` (`:13786`), so the
   prior-hit branch — refuse a changed selection with `scratchpad_settlement_conflict`
   (`:13797`), else return the prior receipt as `idempotent` (`:13799-13805`) — fires ONLY for
   a caller re-pinning the SAME fence. The wrapper's `scratchpad.task_settlement:<taskId>` key
   is NEVER consulted by the store: the lane validates `auth.actor` and never reads `auth.key`,
   and no event is appended under that key (the reap event is keyed by the fence-bound
   `reapKey`, `:13902-13910`). Since every reap bumps the fence (`:8264`, `:8306`), a
   wrapper-driven retry derives a FRESH fence → prior miss → fence check passes
   (`stale_scratchpad_fence`, `:13807-13809`) → the partition is already reaped →
   `{ok: true, result: 'empty', reapEventSeq: null, dispositionDigest: null, elevated: []}`
   (`:13812-13815`). The `idempotent`/`conflict` pair is reachable ONLY for direct store
   callers pinning a fence — exactly how the landed test drives it
   (`impl/test/scratchpad-33-red.test.mjs:600-604` calls the store twice with the same request
   object). Selections outside the task partition refuse (`:13818-13821`); the shared partition
   is bounded (`scratchpad_partition_exhausted`, `:13834-13837`). **The landed selection
   distinction is NOT "terminal-task vs mid-flight": a STEERING-REGISTERED run honors
   `entryIds` at any time (mid-flight included); EVERY other run discards the selection
   ALWAYS** — `const selected = steering ? [...fields.entryIds].sort(...) : [];` (`:13833`,
   gate and comment `:13822-13832`). A terminal task in a non-steering run therefore settles
   with every entry dispositioned `not_elevated`/`no_driver` (`:13894-13901`), the partition
   reaped (entries deleted, fence bumped), and `{ok: true, result: 'settled', elevated: [],
   dispositionDigest, …}` returned (`:13913-13919`) — a SUCCESS receipt for an act that
   elevated nothing. Steering registration is a RUN-CREATION ceremony: the facade records
   `steering.registered` ONCE, at genuine run creation, when `run.start` carries `driverKind`
   (`impl/src/application.mjs:4424-4433`, idempotency key `run.steering_registered:<runId>`);
   `waves.start` starts every member with `driverKind: 'wave'` (`impl/src/wave.mjs:203`), so
   wave runs are steering-registered by construction. Elevation mints shared entries with
   content digests and, for notes, a `scratch-fact` payload (`:13838-13877`).

10. **The board binding law is landed and replay-derived.** `boardSnapshot(board)` carries the
    binding's runId (null when unbound) in its PUBLIC projection
    (`impl/src/coordination-store.mjs:14514`). The law, verbatim: a board bound to a DIFFERENT
    run refuses (the S-2 seam's `board_session_mismatch`, `:14172`; the BD3-A read check's
    `context_scope_forbidden`, `impl/src/coordinator.mjs:10450`); an unbound-and-empty read is
    unknown (`context_not_found`, `:10453`); an unbound board WITH items serves, and a first
    admitted write ADOPTS it into the run (`adopting = !binding && items > 0`, `:14229`, result
    `boardRunBinding: {runId, result: 'adopted'|'bound'}`, `:14259-14262`). Bindings are
    replay-derived from the event payload's `boardAdmission` record — `{runId, adopted,
    boundEvent, requestDigest}`; no lease field is read at replay (`:8362`, `:8375`).
    `postBoardItem(fields, auth, appendGate = null, boardAdmission = null)` (`:14265`) validates
    title ≤160 bytes / detail ≤4,096 / evidence ≤8 refs (`:411`, `:414-417`), mints
    `board-item:<digest>` ids hub-side, and replays on `auth.key` with
    `{ok: true, result: 'idempotent', event, item}` — a return that carries the prior event but
    NO `boardRunBinding` (`:14266-14267`); the SEAM's replay branch derives the envelope's
    `boardRunBinding` from `prior.payload.boardAdmission?.adopted` (`:14221-14226`). The seam's
    atomicity contract is explicit: "The final fence/parent compare is repeated by the append's
    before-write gate, so no adapter-side check-then-write window exists" (`:14084-14087`) —
    the seam builds an `appendGate` that re-runs its checks at append time (`:14236-14241`).
    The facade already owns the bounded orchestrator board renderer: `projectBoardView`
    (`impl/src/application.mjs:488`), non-evented, dual-fence cached (boardFence +
    projectionInputFence post-#78), UNTRUSTED-framed, bounded `MAX_BOARD_ITEMS = 512` /
    `MAX_BOARD_VIEW_BYTES = 256 KiB` (`:60-61`) with explicit truncation — the exact renderer
    the MCP board read uses (`impl/src/mcp-northbound.mjs:1728`).

11. **Board registry rows exist; the facade dispatch does not.** `board.post`/`board.retitle`/
    `board.reorder`/`board.close`/`board.drop`/`board.read` are canonical operations with the
    S-2 `sessionAuthority` IN their schemas and `surfaces: ['embedded', 'mcp']`
    (`impl/src/application-semantics.mjs:1351-1409`); `board.claim`/`board.report` are
    worker-profile rows (`:1410-1428`, landed #78). The MCP `baton_board_*` tools ride the S-2
    envelope via `_boardAuthorityContext(principal).sessionAuthority`
    (`impl/src/mcp-northbound.mjs:1677-1743`, `:1808-1810`) and are served on the COMBINED
    surface, NOT the ordinary application surface (verified live 2026-08-04:
    `mcpApplicationToolNames()` = 27 tools, no `baton_board_*`; `mcpCombinedToolNames()` = 78
    including all six — issue #93). The family is ALSO S-2-LEASE-GATED: `admitBoardCommand`
    fails `board_lease_required` when `envelope.sessionAuthority == null`
    (`impl/src/coordination-store.mjs:14144`), and a descriptor-driven MCP principal carries no
    `sessionAuthority` — it maps from `principal.sessionAuthority ?? null`
    (`impl/src/mcp-northbound.mjs:1808-1810`) while the descriptor principal shape is exactly
    `{userId, sessionId, capabilities, repoIds}` (`impl/src/mcp-descriptor.mjs:185-189`). A
    stock MCP client can therefore neither see (default surface) nor drive (no lease) the board
    family; "MCP board coverage exists" is true ONLY for lease-holding combined-surface hosts
    (Decision 10 re-stages the acceptance accordingly). #48's "board writes are MCP-only" is
    exactly this: an embedded `openBaton` orchestrator without a run-orchestrator lease has no
    board surface at all.

12. **Knowledge seeding is a one-call store lane with content-addressed identity.**
    `coordination-store.addKnowledgeNode(fields, auth)` (`impl/src/coordination-store.mjs:
    15867-15876`) validates type ∈ `KNOWLEDGE_NODE_TYPES` (19 types, `:141`), grounding ∈
    `KNOWLEDGE_GROUNDINGS` (`{verified, observed, derived, asserted}`, `:143`), id uniqueness
    (`duplicate_node`, `:15407`), evidence refs of exactly `{coordinationSeq}` or
    `{artifactId}` (`_validateKnowledgeEvidence`, `:15386-15395`), valid times, and
    type-specific rules (a Decision requires evidence + `informedBy` —
    `causal_orphan`/`missing_endpoint`, `:15409-15413`; a verified FINDING requires evidence —
    `causal_orphan`, `:15414`, a rule the lane scopes to Finding ONLY). The evidence refusal
    vocabulary is THREE codes, named exactly: a future/missing `coordinationSeq` throws
    `temporal_incoherence` (`:15391`); an unknown `artifactId` throws `missing_evidence`
    (`:15393`); `invalid_evidence` covers only MALFORMED refs (a non-array, or a ref naming
    neither key, `:15387`, `:15394`). `_knowledgeFailure` passes codes through unchanged
    (`:15367-15369`). Lifecycle-owned projection fields are rejected
    (`reserved_knowledge_field`, `:15372`). The default id is content-addressed
    `knowledge:<type>:<digest>` (`:15881`); exact retries replay `idempotent` on `auth.key`
    (`:15869-15872`, a digest mismatch under a reused key `knowledge_node_conflict`, `:15871`).
    The fresh-add return is `{ok: true, event, node}` — it carries NO `result` field
    (`:15874-15875`). A node belongs to a run's horizon by construction when it carries `runId`
    (or a run-task `taskId`, or evidence citing the run's events) — `_runHorizonNodeIds`
    (`impl/src/coordinator.mjs:10791-10800`, runId membership `:10796`).

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
    (`:116-135`). Tool errors map through `stateFailureCode` (`:187-240`):
    `application_unauthorized` → `forbidden` (`:189`), `application_*` codes pass through
    (`:192`), a bare TypeError → `invalid_command` (`:237`), unmapped codes →
    `command_outcome_unknown` (`:239`). NOT mapped today (re-verified against the full mapping
    on 2026-08-04): the `attention_*` codes; the scratchpad family (`scratchpad_settlement_*`,
    `stale_scratchpad_fence`, `scratchpad_read_invalid`, and `scratchpad_cursor_stale` — the
    last not projected by this rung); and the knowledge-seed codes (`temporal_incoherence`,
    `missing_evidence`, `invalid_evidence`, `causal_orphan`, `missing_endpoint`,
    `duplicate_node`, `knowledge_node_conflict`, `reserved_knowledge_field`).

15. **The settlement envelope is a different plane and stays untouched.** The four settlement
    tools ride the S-2 `sessionAuthority` envelope (`baton_knowledge_promote` refuses
    `board_lease_required` without it, `impl/src/mcp-northbound.mjs:1603-1615`;
    `baton_knowledge_settlement_lease` requires an explicit `settlement` capability class — the
    `CAPABILITY` registration `['settlement']`, `:104`, enforced through `_authority` — never
    defaulted, `impl/MCP.md:97-105`; `mcp-descriptor.mjs` carries NO settlement logic — the
    string occurs nowhere in that file, verified 2026-08-04). Every lane in
    this rung is ordinary-plane: no `sessionAuthority`, no lease, no settlement capability
    anywhere in their schemas or dispatch. (The pre-existing `baton_scratchpad_elevate`/
    `baton_scratchpad_settle` settlement tools, `:524-550`, are untouched — the new
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

**Projected-domain carve-out (v2.1, red-team Decision 1 amendment).** The two absolute clauses
are scoped by their own evidence, so the VERBATIM claims and the FP oracles pin the same
things the law says: (a) "never narrower" governs the PROJECTED request shape — within it,
refusal semantics are the lane's, and the documented subtractions are recorded non-projections,
not violations: Decision 5 projects run-scoped watches only (the lane's bare deployment scope
is valid but vacuous — ground truth 4 — so the narrowing refuses nothing the lane would
serve), and Decision 9 subtracts `Decision` from the lane-closed type enum (a Decision is
unseedable through the closed shape; the facade refuses at validation what the lane would
refuse as `causal_orphan`). (b) "no response-field invention" permits exactly the envelope
marker (`schemaVersion: 1`) and these per-decision ENVELOPE COMPLETIONS, each a lawful
projection enumerated here so review can check the list: the `messageId` echo (Decision 4);
offset paging `nextCursor`/`truncated` over the lane's live snapshot (Decision 6); the
replay-branch `boardRunBinding` derived from the returned prior event's
`payload.boardAdmission` (Decision 8 — the lane's own replay return lacks it); and
`result: 'added'` synthesized on a fresh knowledge add (Decision 9 — the lane's fresh return
has no `result` field, ground truth 12). Any addition beyond this list IS a semantics
invention and fails FP-18.

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
possession of a digest is never authority): a new READ-ONLY coordinator accessor pinned as
`coordinator.messageRunId(messageId)` (v2.2: the name is the pin, not an example — the
one coordinator-side addition this rung permits; Decision 1) resolves the message's target
run for authorization ONLY, never projecting it. An
unknown messageId resolves to no run, so unknown ≡ foreign ≡ the constant
`application_unauthorized` — no existence leak on message ids, and the lane's `null`-for-
unknown return (`impl/src/coordinator.mjs:6709-6710`) is UNREACHABLE through the facade. The
accessor resolves through DURABLE records (the message record carries its target,
`:6711-6716`): a worker-targeted message whose worker handle is gone resolves to NO run —
resolve-to-null ≡ unknown ≡ `application_unauthorized`, never a leak (FP-05 pins the row).

On authorization the facade returns the receipt VERBATIM plus the envelope marker:
`{schemaVersion: 1, messageId, delivered, read, actedOn, reply}` with the lane's exact state
machine (`:6717-6723`): `delivered`/`read` ∈ {true, null}, `actedOn` always null, `reply` the
closed `{messageId, inReplyTo, from, body}` or null. The facade never upgrades, infers, or
annotates receipt state; process-scoping (C3/C3b) is the lane's, projected as-is. (The
`messageId` echo is a Decision 1 envelope completion.)

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
`attention_target_invalid`, `impl/src/coordinator.mjs:6735-6764`) is the sole authority seam —
the `_settlementCommand` precedent, where the lane's own authority governs and the facade adds
no `_authorize` (`impl/src/application.mjs:12244-12264`). A facade `_authorize` on the requested
runId would introduce an existence check the embedded path lacks (for the orchestrator
principal, an unknown scope runId pages EMPTY at the lane — it does not refuse) and would break
the D1 constant. The coded refusals propagate byte-identically; the page returns VERBATIM:
`{schemaVersion: 1, runId, afterCursor, throughCursor, reasons}` with every reason's
`{seq, kind, runId, mintEpoch, count, perPhase, windowMs, memberState, …}` untouched
(`impl/src/coordinator.mjs:6766-6772`, `:6834`).

**Transport authority (v2.1, red-team blocker #4).** The lane admits exactly two viewers for a
run scope: `principalId === 'wave-owner'` or a live run-orchestrator lease holder whose
session's principalId matches (`impl/src/coordinator.mjs:6774-6793`). Who can satisfy that
through each transport is part of this contract: (a) EMBEDDED — the orchestrating driver
self-names `principalId: 'wave-owner'`; that is the established embedded model (the embedder
is trusted code). (b) MCP — the connection principal is the descriptor's `principal.userId`
(default `'descriptor-host'`, observe-only, `impl/src/mcp-descriptor.mjs:185-189`), and
`wave-owner` is a test-fixture id no production caller names (ground truth 4). A stock
`baton_run_attention_watch` on a run scope therefore refuses `attention_scope_forbidden` for
every default MCP deployment. The precondition is deployment configuration, not a code change:
the descriptor sets `principal.userId` to the orchestrator id the lane recognizes, or the
connection holds a run-orchestrator lease whose session matches. FP-15 pins a descriptor row
with the orchestrator-named principal so the attention codes actually reach the wire. The
facade's run-scoped request shape also deliberately does NOT project the lane's bare
deployment scope (`scope.runId == null` is valid but vacuous at the lane — ground truth 4):
recorded as a non-projection under the Decision 1 carve-out.

`timeoutMs` is NOT projected. The landed lane pages immediately and ignores it (ground truth
3); a facade that accepted a wait budget would promise behavior that does not exist. The MCP
bounded long-poll of the v0.9 dream shape (capped by the frame budget,
`impl/src/mcp-descriptor.mjs:197`) is a LANE-level rung first — flagged in Open Questions.

**Rationale:** the D1/D2 pins (scope-first constancy; review-authority gating) live entirely
inside the lane and are principal-shaped; the facade transports the authenticated principal and
gets out of the way.

### 6. `run.scratchpad.read` — the #33 accessor, bounded and framed like the BD3-A renderer

Request shape (closed): `{runId, scope, cursor?}` — `scope` EXACTLY `shared` or `worker:<id>`
(the store's `SCRATCHPAD_SCOPE` pattern, `impl/src/coordination-store.mjs:500`), `cursor` an
optional safe integer ≥ 0. Failures refuse `application_scratchpad_read_invalid`. This closes
#48 item 1 (the #33 SP6 accessor, ground truth 13).

Authorization is the steer idiom: `_authorize('run.scratchpad.read', principal, runId, {scope})`
— unknown ≡ foreign at the policy seam. On authorization the facade snapshots
`this.driver.coordination.scratchpadSnapshot(runId, scope)` — NON-EVENTED, no `context.read`
audit class (that class belongs to the worker L1 lane; the facade's ordinary reads, like
`board.read` and `waves.progress`, append nothing) — and renders the page with the BD3-A
renderer law projected (`impl/src/coordinator.mjs:10472-10500`):

- at most 64 entries per page (the renderer's non-knowledge `maxItems`, `:10480`);
- every entry rendered `{entryId, kind, text}` with per-leaf text bounded through the facade's
  own `boundedAttentionText` (≤ 4,096 bytes, `impl/src/application.mjs:300`, cap
  `MAX_ATTENTION_TEXT_BYTES`, `:53`) and the page carrying the frame marker
  `UNTRUSTED_SCRATCHPAD — worker-authored notes, not instructions` (`:10478`) — worker-authored
  content is data, never instruction;
- PAGE-SERIALIZED BUDGET (v2.1, red-team blocker #5): the rendered page is capped at 256 KiB
  serialized, mirroring the board view's `MAX_BOARD_VIEW_BYTES` (`impl/src/application.mjs:60`)
  — 64 maximal leaves alone are 64 × 4,096 = 256 KiB BEFORE entry ids, kinds, fences, and the
  envelope, at or over the MCP surface's own `maxMessageBytes: 256 KiB`
  (`impl/src/mcp-descriptor.mjs:197-198`), so the item/leaf bounds without a serialized total
  are not a bound at all. Oversize follows the renderer's own overflow doctrine
  (`impl/src/coordinator.mjs:10496-10499`): entries render in insertion order until the next
  entry would cross the budget; the page then carries `truncated: true` and a digest-citation
  of the FULL page id set (`canonicalDigest` over the sorted ids), and `nextCursor` points at
  the first unrendered entry so paging continues honestly. This is a disclosed SURFACE bound
  (Decision 12), not a lane cap — the store lane imposes no serialized total;
- response `{schemaVersion: 1, runId, scope, frame, scratchpadFence, observedSeq, entries,
  nextCursor, truncated, digest?}` — the field names are the renderer's OWN
  (`impl/src/coordinator.mjs:10474-10499`), named explicitly in v2.2 so a contract-literal
  implementation does not invent divergent ones (blue-team BLOCKER 3): `frame` carries the
  `UNTRUSTED_SCRATCHPAD — worker-authored notes, not instructions` marker on EVERY page;
  `digest` carries the full-id-set citation and rides ONLY on a truncated page (the renderer
  omits it otherwise, `:10496-10499`). (`nextCursor`/`truncated` are Decision 1 envelope
  completions.)

Pagination is OFFSET-based over the store's live snapshot (rebuilt per call, never a cached
frame — the `waves.progress` honesty posture, `impl/MCP.md:74-77`): `nextCursor` is an offset
or null; `scratchpadFence` + `observedSeq` are carried verbatim so a caller detects drift
(elevation reaps a worker partition) and re-reads. v1 pins NO stale-cursor refusal and does NOT
project the store's `expectedFenceTuple` CAS (`impl/src/coordination-store.mjs:13638-13641`) —
offset paging with a carried fence is the honest minimum; a fence-pinned cursor is a later rung
(Open Questions).

**Rationale:** the store read machinery is complete (ground truth 8); the rung's work is the
bounded, framed, authorized projection — and every bound cited already exists.

### 7. `run.scratchpad.elevate` — the kernel elevation with its fence discipline, verbatim

Request shape (closed): `{runId, taskId, entryIds}` — `entryIds` an array of ≤128 unique
`scratchpad-entry:<64 hex>` ids (the store's closed shape, `impl/src/coordination-store.mjs:
13776-13784`, `:498`, `:491`). Failures refuse `application_scratchpad_elevate_invalid`. This
closes #48 item 2 for the ordinary end-of-task path.

Authorization is resolve-then-authorize: the facade resolves the task's run SERVER-SIDE (the
store's delegated `task` accessor, `impl/src/coordinator.mjs:752-756`) and calls
`_authorize('run.scratchpad.elevate', principal, resolvedRunId, {taskId, entryCount})`. An
unknown task, or a task whose runId does not equal `args.runId`, authorizes against a null
scope: unknown ≡ cross-run ≡ foreign ≡ the constant `application_unauthorized` — the entry
ids a caller names are never existence-oracles. On authorization the facade delegates to
`coordinator.elevateTaskScratchpad(taskId, entryIds)` (`impl/src/coordinator.mjs:11083-11085`)
and returns the outcome VERBATIM plus `schemaVersion: 1`:

- non-terminal task: `{schemaVersion: 1, ok: false, result: 'scratchpad_settlement_not_ready'}`
  (`:10295-10297`) — a typed OUTCOME, never a throw;
- no worker / nothing to elevate: `{schemaVersion: 1, ok: true, result: 'empty', …}`;
- success: the store's receipt verbatim — `{schemaVersion: 1, ok: true, result: 'settled',
  runId, taskId, workerId, scope, observedFence, scratchpadFence, reapEventSeq,
  dispositionDigest, elevated}` (`impl/src/coordination-store.mjs:13913-13919`).

**The steering-registered precondition (v2.1, red-team blocker #1).** The store honors
`entryIds` ONLY for steering-registered runs; for every other run the selection is discarded
and the settle returns `ok: true, result: 'settled', elevated: []` with every entry
dispositioned `not_elevated`/`no_driver` (ground truth 9, `impl/src/coordination-store.mjs:
13822-13833`, `:13900`). This contract projects that truth VERBATIM and names it, rather than
inventing a refusal the embedded path lacks: refusal constancy is the rung's law (Decision 1),
and the lane's receipt IS honest about what happened — an empty `elevated` array plus durable
`no_driver` dispositions. The dishonesty was this contract's prior misdescription, not the
lane's receipt. The precondition is discharged by a CEREMONY AT RUN CREATION, not at elevation
time: steering registers once, when `run.start` carries `driverKind`
(`impl/src/application.mjs:4424-4433`, key `run.steering_registered:<runId>`), and
`waves.start` starts every member with `driverKind: 'wave'` (`impl/src/wave.mjs:203`) — so the
Decision 13 workflow's member tasks are steering-registered by construction and their
elevations elevate. The alternative — a kernel amendment making the ordinary (non-steering)
path honor selections — is explicitly NOT spent: the red-team confirms no kernel-lane change
is required, the ceremony already makes the projected path honest for the workflows this rung
exists to serve, and the amendment would rewrite landed lane semantics for every existing
caller (the #33 suites pin them) for zero acceptance gain. Acceptance pins the ceremony
instead: FP-10 and WS-01 require `elevated ≥ 1` on the happy path, so a silently-discarded
selection greens nothing. (Whether the ordinary path should EVER honor a selection is Open
Question 8 — a kernel rung, honestly deferred.)

**The retry law, fence-bound (v2.1, red-team blocker #2).** The store's dedup key embeds the
caller-pinned fence (`impl/src/coordination-store.mjs:13786`); the coordinator wrapper
re-derives `expectedScratchpadFence` LIVE on every call (`impl/src/coordinator.mjs:10305`);
and the wrapper's deterministic `scratchpad.task_settlement:<taskId>` key (`:10307`) is never
consulted by the store (ground truth 9). Through the projected path, therefore:

- an EXACT retry returns the prior receipt's EMPTY successor shape — `{schemaVersion: 1,
  ok: true, result: 'empty', runId, taskId, workerId, scope, observedFence, scratchpadFence,
  reapEventSeq: null, dispositionDigest: null, elevated: []}`
  (`impl/src/coordination-store.mjs:13812-13815`): the first call reaped the partition and
  bumped the fence, so the retry's fresh fence finds no prior and nothing left to settle.
  This is the honest never-double-elevate posture — a SUCCESS receipt with an empty effect —
  and FP-10 pins it as such;
- `idempotent` replay and `scratchpad_settlement_conflict` are a STORE-DIRECT posture,
  documented as such and unreachable through the wrapper: an exact replay under the SAME
  pinned fence returns the prior receipt's shape `{ok: true, result: 'idempotent', …,
  reapEventSeq: <prior seq>, dispositionDigest, elevated}` (`:13799-13805`), and a CHANGED
  selection (a DIFFERENT payload) under the same fence-pinned key refuses
  `scratchpad_settlement_conflict` (`:13793-13797`) — exactly how the landed store test drives
  it (`impl/test/scratchpad-33-red.test.mjs:600-604`). No facade/MCP row may pin either;
- a race between the wrapper's live fence read and a concurrent reap surfaces
  `stale_scratchpad_fence` (`:13807-13809`) — honest, propagated byte-identically.

Ordering hazard, pinned: `releaseTerminalTaskResources` auto-settles with `entryIds: []`
(`impl/src/coordinator.mjs:1886`, reached from the context-call settlement cleanup at
`impl/src/application.mjs:8685`), and any reap that precedes the elevate call degrades it to
the same `empty` receipt. WS-01 elevates BEFORE any settlement/cleanup reap and asserts
`elevated ≥ 1`.

The remaining coded refusals propagate byte-identically: `scratchpad_settlement_invalid`
(selection outside the task partition — state-dependent, `impl/src/coordination-store.mjs:
13818-13821`) and `scratchpad_partition_exhausted` (shared partition full, `:13834-13837`).
The facade's shape pre-validation makes the store's shape-level
`scratchpad_settlement_invalid` unreachable (Decision 1).

The facade projects the coordinator WRAPPER (terminal-task discipline): mid-flight elevation —
which the store admits for steering-registered runs — remains a kernel capability this rung
does not surface (Open Questions).

**Rationale:** #48 asked for the kernel elevation projected "with its fence discipline"
(ground truth 9); the wrapper is the documented registered-orchestrator end-of-task path, and
the honesty the rung owes is the TRUE semantics — steering-registered selection honor,
fence-bound dedup — not a friendlier fiction.

### 8. `run.board.post` / `run.board.read` — the binding law verbatim, orchestrator posture

These close #48 item 3 for the embedded/CLI orchestrator (MCP board coverage already exists —
ground truth 11 — and stays the S-2 family; Decision 10). Request shapes (closed):

- `run.board.post`: `{runId, board, title, detail?, owner?, evidence?}` — `board` matching
  `SAFE_BOARD_ID` (`impl/src/coordination-store.mjs:411`), `title` ≤160 bytes non-empty,
  `detail` null-or-≤4,096, `owner` null-or-safe-id, `evidence` ≤8 valid refs (`:414-417`; the
  registry `board.post` schema's exact bounds, `impl/src/application-semantics.mjs:1351-1362`).
  Failures refuse `application_board_post_invalid` (oversize names cap+actual, Decision 12).
- `run.board.read`: `{runId, board}` — same `board` shape. Failures refuse
  `application_board_read_invalid`.

`board` is REQUIRED in v1 (a deviation from the issue's `board?` sketch, with evidence: no
public run→boards projection exists to derive a default from — the only naming convention in
the tree is the settlement board `wave-settlement:<waveId>`, `impl/src/coordinator.mjs:11133`;
Open Questions).

Authorization is the steer idiom against `args.runId` (`_authorize('run.board.post' |
'run.board.read', principal, runId, {board, …})`) — unknown ≡ foreign at the policy seam. The
binding law is then enforced VERBATIM (ground truth 10), derived from the PUBLIC
`boardSnapshot(board).runId` (`impl/src/coordination-store.mjs:14514` — never a private-map
reach):

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
(`impl/src/coordination-store.mjs:14265`), so replay derives `{runId, adopted, boundEvent,
requestDigest}` byte-identically (`:8362-8375`) — no lease exists in this posture and none is
fabricated (`leaseId: null`; replay reads no lease field). A post to a stopped/sealed run
refuses `application_board_run_closed` — the projection of the seam's `board_run_closed` law
(`:14176`), derived through the store's PUBLIC `snapshot()` (the coordinator's delegated read,
`impl/src/coordinator.mjs:752-756`) — the named accessor; the facade never reads private run
maps.

**Append-time re-validation (v2.1, red-team Decision 8 amendment).** The S-2 seam's atomicity
law is explicit: "the final fence/parent compare is repeated by the append's before-write
gate, so no adapter-side check-then-write window exists"
(`impl/src/coordination-store.mjs:14084-14087`), and `postBoardItem` accepts an `appendGate`
for exactly this (`:14265`; the seam's own gate re-runs its checks at append time,
`:14236-14241`). The facade therefore does NOT check-then-write against a snapshot: it derives
binding + run-open as above, then calls `postBoardItem` WITH an `appendGate` that RE-VALIDATES
binding and run-open at append time — a post that loses the race refuses at the gate and
never writes. FP-11 carries the race row.

Outcomes are verbatim plus the envelope marker, mirroring the seam's result envelope
(`:14259-14262`): post → `{schemaVersion: 1, ok, result: 'posted'|'idempotent', item,
boardRunBinding: {runId, result: 'adopted'|'bound'}}` with the hub-minted
`{itemId, itemVersion, itemDigest, ordinal}`; the facade mints the idempotency key
`run.board.post:<runId>:<board>:<digest({title, detail, owner, evidence})>` so an exact retry
replays `idempotent` and a retry never double-posts. The lane's replay return carries the
prior event but NO `boardRunBinding` (`:14266-14267`), so on the replay branch the facade
DERIVES it from the returned prior event's `payload.boardAdmission` —
`{runId, result: boardAdmission?.adopted ? 'adopted' : 'bound'}` — mirroring the seam's replay
derivation (`:14221-14226`); a Decision 1 envelope completion. Read → `{schemaVersion: 1,
board, boardRunId, view}` where `view` is `projectBoardView(snapshot, {role: 'orchestrator',
workerId: null})` — the facade's own bounded, dual-fence-cached, UNTRUSTED-framed renderer
(`impl/src/application.mjs:488`, bounds `:60-61`), the exact projection the MCP board read
serves (`impl/src/mcp-northbound.mjs:1728`), NON-EVENTED.

**Rationale:** the deployment orchestrator's kernel posture IS `actor: 'orchestrator'` direct
post (the settlement candidacy precedent, `impl/src/coordinator.mjs:11205-11208`); the rung
surfaces it with the binding law and the closed renderer, instead of forcing every embedded
orchestrator through a lease it does not hold.

### 9. `run.knowledge.seed` — content-addressed seeding inside the run's horizon

Request shape (closed): `{runId, type, grounding, body, evidence?}` — `type` ∈
`KNOWLEDGE_NODE_TYPES` MINUS `{Decision}` (a Decision requires `informedBy` graph sources the
closed shape does not carry, so seeding one is impossible through this lane — the facade
refuses it at validation rather than delegating to a certain `causal_orphan`,
`impl/src/coordination-store.mjs:15409-15413`; a Decision 1 recorded subtraction), `grounding`
∈ `{verified, observed, derived, asserted}` (`:143`) with the store's shape-checkable rule
enforced at the facade EXACTLY AS THE LANE SCOPES IT: a `verified` FINDING seed REQUIRES a
non-empty `evidence` (`:15414` — the rule is Finding-specific; a verified Constraint without
evidence is lane-legal, and the facade does not narrow it), `body` a non-empty string ≤ 4,096
bytes (the facade's ordinary text bound `validText`, `impl/src/application.mjs:289-291` — a
disclosed SURFACE cap on an uncapped lane, not a lane cap; Decision 12, Open Questions),
`evidence` optional refs of exactly `{coordinationSeq: <int>}` or `{artifactId: <id>}` (the
store's evidence law, `:15386-15395`). Failures refuse `application_knowledge_seed_invalid`
(oversize names cap+actual, Decision 12).

Authorization is the steer idiom against `args.runId` (`_authorize('run.knowledge.seed',
principal, runId, {type, grounding, bodyDigest})`). On authorization the facade calls
`this.driver.coordination.addKnowledgeNode({type, grounding, body, runId, evidence},
{actor: principal.actor, key: 'run.knowledge.seed:<runId>:<digest({type, grounding, body,
evidence})>'})`:

- the node carries `runId`, so it lands INSIDE the run's horizon by construction
  (`impl/src/coordinator.mjs:10796`) — seeding is horizon-scoped, never ambient;
- the server-derived key is content-addressed: an exact retry replays `idempotent`
  (`impl/src/coordination-store.mjs:15869-15872`); different content is honestly a different
  seed, never a silent overwrite;
- the lane's state-dependent refusals propagate byte-identically with their TRUE codes
  (ground truth 12): `temporal_incoherence` (a future/missing `coordinationSeq`, `:15391`)
  and `missing_evidence` (an unknown `artifactId`, `:15393`). `causal_orphan` is reachable
  only where the facade's own validation already fired (the Finding rule is mirrored at the
  facade). The remaining listed codes are DEFENSE-IN-DEPTH — unreachable through the closed
  shape, mapped at the wire anyway (Decision 10) so they can never degrade to
  `command_outcome_unknown`: `invalid_evidence` (malformed refs only — the facade's ref shape
  validation pre-empts it), `reserved_knowledge_field` (the closed shape carries no
  lifecycle-owned fields), `missing_endpoint` (fires only for `Decision.informedBy`
  non-liveness or a promotion trigger — the facade refuses `Decision` at validation and
  carries no `promotion`, `:15409-15415`), and the digest-adjudication pair
  `knowledge_node_conflict`/`duplicate_node` — under the content-derived key, identical
  content is an `idempotent` replay and distinct content a distinct node, so the pair is not
  reachable through ordinary use and MUST stay that way.

Response: `{schemaVersion: 1, ok: true, result: 'added'|'idempotent', nodeId}` — the node's
content-addressed id, never a facade-minted one. (`result: 'added'` is a Decision 1 envelope
completion: the lane's fresh-add return is `{ok: true, event, node}` with no `result` field,
`:15874-15875`.)

**Rationale:** orchestrator knowledge seeding under a run's horizon is the first move of the
acceptance workflow (Decision 13); the store lane is complete (ground truth 12) and the
projection wires it with the facade's authority and idempotency idioms.

### 10. MCP projections — ordinary plane, wave-tools envelope, refusal constancy to the wire

Six NEW tools join `ORDINARY_APPLICATION_TOOL_DEFINITIONS` (closed `schema()` schemas with
`additionalProperties: false`, `impl/src/mcp-northbound.mjs:246-248`; `_meta` registry-digest
stamp, `:558-561`), each with a `CAPABILITY` registration (`:77-104` idiom), a hand-rolled
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
joins `STATEFUL`/`RECONCILABLE` (`:116-135` posture) — a `run.message.send` retry mints a NEW
message honestly (`impl/src/coordinator.mjs:6651`'s seq-bound digest), while elevate/seed
replay safety lives server-side in the deterministic keys (Decisions 7 and 9), not in wire
fields. Per-call quota rides `handle()` unchanged (ground truth 20).

**Who may drive what (v2.1, red-team blocker #4).** The descriptor's default principal is
observe-only (`{userId: 'descriptor-host', capabilities: ['observe']}`,
`impl/src/mcp-descriptor.mjs:185-189`), so the capability classes and lane authorities below
are DEPLOYMENT PRECONDITIONS the contract names and FP-14/FP-15 pin — not behavior the tools
invent:

| MCP tool | Required deployment posture |
| --- | --- |
| `baton_run_message_send` / `baton_run_scratchpad_elevate` / `baton_run_knowledge_seed` | `control` capability on the descriptor principal + the host facade's authorization policy admitting the run |
| `baton_run_message_receipt` / `baton_run_scratchpad_read` | `observe` capability + the host facade's policy |
| `baton_run_attention_watch` | `observe` capability AND the lane's viewer authority (Decision 5): descriptor `principal.userId` set to the orchestrator id the lane recognizes, or a live run-orchestrator lease |
| `baton_decision_answer` (existing) | `approve` capability (`:90`) |
| `baton_board_*` (existing, combined surface) | combined surface AND the S-2 lease (below) |

**Boards are deliberately NOT new ordinary tools — and the existing MCP board path is narrower
than v2.0 claimed (v2.1, red-team blocker #4).** MCP board coverage exists ONLY as the S-2
`baton_board_*` family on the COMBINED surface (ground truth 11) AND ONLY for lease-holding
hosts: `admitBoardCommand` refuses `board_lease_required` without `envelope.sessionAuthority`
(`impl/src/coordination-store.mjs:14144`), the sessionAuthority maps from
`principal.sessionAuthority ?? null` (`impl/src/mcp-northbound.mjs:1808-1810`), and the
descriptor principal shape carries no such field (`impl/src/mcp-descriptor.mjs:185-189`). A
stock MCP client can neither see the family (default surface — #93) nor drive it (no lease).
The deferral STANDS on the red-team's verdict: an ordinary-plane duplicate of the S-2 seam is
a red-team magnet with zero compositional gain, and the MCP packaging epic owns the
ordinary-surface board question. What changes is the TEXT: facade-driven workflows use
`run.board.post`/`run.board.read`; MCP-driven workflows use `baton_board_post`/
`baton_board_read` ONLY when the host rides the combined surface AND holds the S-2 lease —
the lease ceremony being the settlement plane's: the host mints a settlement lease
(`baton_knowledge_settlement_lease`, explicit `settlement` capability, never defaulted,
`:104`) and presents the lease proof as the connection's `sessionAuthority`. No acceptance
row below claims an MCP equivalent for a board step. (Open Questions records the
ordinary-surface board question for the MCP packaging epic.)

**#93 discovery note (v2.1).** This rung RIDES the combined-surface reality; it does not fix
default visibility. The six new ordinary tools land on the DEFAULT application surface
(27 → 33 of 78, verified live 2026-08-04) — a partial answer to #93, whose own sibling note
named exactly these projections as gated on the default-visibility question. #93's fix choice
(default-to-combined, tiered listing, or `instructions` naming the surface modes) stays with
the MCP packaging epic: nothing here changes `surface` selection
(`impl/src/mcp-northbound.mjs:1085-1086`), and the acceptance text never claims an MCP
equivalent a stock deployment cannot reach.

Refusal constancy to the wire REQUIRES one `stateFailureCode` amendment
(`impl/src/mcp-northbound.mjs:187-240`) — every code below currently collapses to
`command_outcome_unknown` (`:239`; re-verified against the full mapping on 2026-08-04, ground
truth 14):

- the attention family: `attention_scope_forbidden`, `attention_scope_invalid`,
  `attention_target_invalid`;
- the scratchpad family: `scratchpad_settlement_invalid`, `scratchpad_settlement_conflict`,
  `scratchpad_settlement_not_ready`, `stale_scratchpad_fence`,
  `scratchpad_partition_exhausted`, `scratchpad_read_invalid` (`scratchpad_cursor_stale` is
  deliberately NOT mapped — v1 does not project the CAS, Decision 6);
- the knowledge-seed family, with the codes the lane ACTUALLY throws (ground truth 12):
  `temporal_incoherence` (a stale/future `coordinationSeq`), `missing_evidence` (an unknown
  `artifactId`), `invalid_evidence` (malformed refs), `causal_orphan`, `missing_endpoint`,
  `duplicate_node`, `knowledge_node_conflict`, `reserved_knowledge_field` — the last five are
  defense-in-depth through the closed facade shape (Decision 9) and are mapped anyway so they
  can never degrade to `command_outcome_unknown`.

The facade's `application_*` codes already pass through (`:192`); the board family
(`board_admission_invalid`, `stale_board_fence`, `board_item_*`, `invalid_board*`) is already
mapped (`:229-236`); the lanes' bare TypeErrors are unreachable through facade validation
(Decision 1). All six tools are ORDINARY-PLANE: no `sessionAuthority`, no lease argument, no
`settlement` capability class (ground truth 15). The wave-tools section of `impl/MCP.md:61-89`
gains a short prose paragraph per lane, NAMING the capability class and principal precondition
of the "Who may drive what" table (inventory-table rows are generated — Decision 11;
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

Two coexistence notes (v2.1): (a) legacy `baton run send` survives as an S-1 `semantic-action`
(`impl/src/application-cli.mjs:1514-1530`; registry rows `impl/src/application-semantics.mjs:
809`, `:871`, `:1274`) — two send spellings with different arg shapes and different
parse-result kinds coexist; the CLI.md prose says so in one sentence. (b) The registry's
pre-existing UNWIRED `run.scratchpad` row (`impl/src/application-semantics.mjs:1330-1340` —
no facade dispatch today) stays untouched; the new `run.scratchpad.read`/
`run.scratchpad.elevate` keys do not collide with it.

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
| message body | 2,048 bytes | `impl/src/coordinator.mjs:6633-6635` |
| scratchpad entryIds | ≤128 unique `scratchpad-entry:<64 hex>` | `impl/src/coordination-store.mjs:13776-13784`, `:498`, `:491` |
| scratchpad read page | ≤64 entries; ≤4,096 bytes per rendered leaf | `impl/src/coordinator.mjs:10480`; `impl/src/application.mjs:300`, `:53` |
| scratchpad read page serialized total | 256 KiB, digest-citation truncation (Decision 6 — a disclosed SURFACE bound, not a lane cap) | `impl/src/application.mjs:60` (the mirrored board-view ceiling); `impl/src/coordinator.mjs:10496-10499` (the renderer doctrine) |
| board title / detail / evidence | 160 / 4,096 bytes / ≤8 refs | `impl/src/coordination-store.mjs:414-417` |
| board read view | 512 items / 256 KiB, explicit truncation | `impl/src/application.mjs:60-61` |
| knowledge seed body | 4,096 bytes (a disclosed SURFACE cap on an uncapped lane — Open Question 7) | `impl/src/application.mjs:289-291` |

No new LANE caps are invented; TWO disclosed SURFACE caps are — the scratchpad read page
serialized total (Decision 6) and the knowledge seed body (Open Question 7) — both named here
per #89's honesty law.
`MAX_ATTENTION_TEXT_BYTES = 4_096` (`:53`) remains the STEER lane's
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
script contains no `createDriver` / `coordinator.mjs` / `coordination-store.mjs` import —
INCLUDING a dynamic `import()` of those path strings (the assertion greps path strings, and
this is pinned) — AND no `.driver` / `.coordinator` / `.coordination` member access
(`impl/demo.mjs:14`'s anti-pattern, inverted, and extended to field-reach in v2.1, red-team
blocker #6): `BatonApplication.driver` is a PUBLIC field (`impl/src/application.mjs:2326`), so
a script importing only the facade could otherwise reach `application.driver.coordination` /
`.coordinator` with zero imports and pass an import-only ban. (The `baton.recipes` path is
data-driven through the facade and is not a backdoor; driving through `BatonDeployment` —
whose `#application`/`#driver` are private, `impl/src/application-deployment.mjs:1215`,
`:1223` — or MCP is the clean posture.) CLOSING the public field is a composition-law change
bigger than this rung: it is FILED AS A SEPARATE ISSUE at fold time (the fold summary records
the disposition), this rung pins the assertion that catches the reach, and the rung is
deliberately NOT widened into kernel/application refactors (Non-goals). The verb sequence,
each mapped to its surface:

1. **Seed board + knowledge** — `run.knowledge.seed` (spec decomposition + constraints nodes
   inside the run's horizon) and `run.board.post` (the swarm's task board, adopted on first
   post). MCP equivalent: `baton_run_knowledge_seed` (with the Decision 10 preconditions); the
   board post is facade/CLI — MCP boards ride the combined surface + S-2 lease (ground truth
   11, Decision 10).
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
   (`impl/src/mcp-northbound.mjs:512-523`, `approve` capability `:90`) — both facade/MCP
   commands; the synthesis itself is
   the orchestrator's own logic, not a baton command. (The landed wake vocabulary carries no
   `decision_pending` kind — ground truth 4; the gate is answered, not awaited.)
6. **Elevate findings** — `run.scratchpad.elevate` per terminal member task /
   `baton_run_scratchpad_elevate`. The members are steering-registered by construction
   (`waves.start` carries `driverKind: 'wave'` — ground truth 9), the step elevates BEFORE any
   settlement/cleanup reap, and `elevated ≥ 1` is asserted (Decision 7).
7. **Shared reads** — `run.scratchpad.read` `{scope: 'shared'}` and `run.board.read` /
   `baton_run_scratchpad_read`: the swarm's elevated findings and the triaged board, bounded
   and framed. The board read is facade/CLI; the MCP board read is combined-surface + S-2
   lease (Decision 10).
8. **Harvest** — `waves.attach` / `baton_waves_attach` (the existing resume path,
   `impl/MCP.md:74-82`).

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
  `scratchpad_settlement_invalid` (state-dependent), `scratchpad_partition_exhausted`,
  `temporal_incoherence` (stale/future `coordinationSeq`), `missing_evidence` (unknown
  `artifactId`), `causal_orphan` — plus the DEFENSE-IN-DEPTH listings (unreachable through the
  closed shapes, Decision 9): `invalid_evidence` (malformed refs only), `missing_endpoint`,
  `duplicate_node`, `knowledge_node_conflict`, `reserved_knowledge_field`.
  `scratchpad_settlement_conflict` is STORE-DIRECT ONLY (same-fence retry — Decision 7); it
  never fires through the projected path and no facade row pins it.
- Lane OUTCOMES (never throws), verbatim: `{ok: false, result: 'worker_not_active' |
  'run_not_active' | 'scratchpad_settlement_not_ready'}`, `{ok: true, result: 'sent' |
  'empty' | 'settled' | 'posted' | 'idempotent' | 'added', …}` — `empty` covers the elevation
  never-double-elevate retry (Decision 7); elevation `idempotent` is store-direct only.
- `application_command_unavailable` — unchanged descriptor-facade posture for unserved
  commands (`impl/src/mcp-descriptor.mjs:159`).

MCP wire (via `stateFailureCode`, `impl/src/mcp-northbound.mjs:187-240`):

- `forbidden` — capability-class refusal (`_authority`, `:1141-1152`) or mapped
  `application_unauthorized` (`:189`).
- `invalid_message_send` / `invalid_message_receipt` / `invalid_attention_watch` /
  `invalid_scratchpad_read` / `invalid_scratchpad_elevate` / `invalid_knowledge_seed` —
  hand-rolled shape guards (`:976-1020` idiom). A malformed DECLARED field earns the tool's
  own guard code; a forged UNDECLARED field dies earlier at the generic key-closure
  (`unknown_argument_field`, `:813-816`). `invalid_scratchpad_elevate` is SHARED with the
  existing settlement `baton_scratchpad_elevate` guard
  (`impl/src/mcp-northbound.mjs:1004-1008`) — same refusal class, lawful reuse; implementers
  must NOT invent a distinct code for the ordinary tool (v2.2, blue-team D3).
- All `application_*` facade codes — pass-through (`:192`).
- The attention, scratchpad-settlement, and knowledge-seed families — NEW pass-through entries
  (Decision 10; the knowledge family enumerates `temporal_incoherence`, `missing_evidence`,
  `invalid_evidence`, `causal_orphan`, `missing_endpoint`, `duplicate_node`,
  `knowledge_node_conflict`, `reserved_knowledge_field`); they must NEVER surface as
  `command_outcome_unknown` (`:239`) or `invalid_command` (`:237`).

CLI: parse failures keep the `cli_invalid` / `cli_command_unavailable` vocabulary
(`impl/src/application-cli.mjs:42`, `:1792`); dispatch failures are the facade codes above.

## Non-goals

- No changes to the kernel lanes' logic — the single permitted kernel-side addition is the
  read-only authorization accessor of Decision 4. The BD3-C/D, #78 board, S-2, settlement,
  grammar-m3, MCP-packaging, wave, and conformance suites are not touched, weakened, or
  re-pinned.
- No closure of `BatonApplication.driver`'s PUBLIC visibility (`impl/src/application.mjs:2326`)
  — a composition-law change bigger than this rung, filed as a separate issue at v2.1 fold
  time (Decision 13); this rung's static assertion pins the reach instead.
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
| FP-03 | Send target refusals could leak or re-code. | With a policy refusing the run, unknown-workerId ≡ foreign-target ≡ `application_unauthorized`; with the permissive stub, unknown worker → `{ok: false, result: 'worker_not_active'}` and empty run → `{ok: false, result: 'run_not_active'}` — byte-identical to the embedded lane. The refusing-policy stub refuses BOTH `runId === R` AND `runId === null` (an unresolvable worker authorizes against the null scope — a run-only stub would see `worker_not_active`, not `application_unauthorized`, staging the row wrong against a correct implementation). |
| FP-04 | Receipt states could diverge between paths. | THE IDENTITY ROW: one message driven through BOTH paths — `coordinator.messageReceipt(id)` and facade `run.message.receipt` return DEEP-EQUAL `{delivered, read, actedOn, reply}` at every transition: at send, after same-generation `turn_started`, after process death (C3), after respawn (C3b), and with a reply (closed shape, smuggled fields absent — C1b). |
| FP-05 | A receipt read could leak message existence. | Unknown messageId ≡ foreign messageId ≡ `application_unauthorized` (resolve-then-authorize); the lane's `null` return is unreachable through the facade; no receipt field crosses before authorization. |
| FP-06 | Scope constancy could break through projection. | The D1 row through `application.command`: out-of-scope target ≡ unknown target ≡ `attention_scope_forbidden`, byte-identical with no facade wrapper; malformed scope/target refuse `attention_scope_invalid` / `attention_target_invalid` identically to the embedded lane. |
| FP-07 | Candidacy disclosure could widen through projection. | The D2 row through the facade: a non-review-authority principal receives zero `candidacy_review` reasons even when one exists; the `wave-owner` principal receives it with `count ≥ 1`. |
| FP-08 | Page content could be re-shaped by the projection. | The D3/D4 rows through the facade: storm coalescing carries explicit `count` + `perPhase` (+`windowMs`) with no singular `{role, phase}`; post-terminal reasons carry `memberState: 'terminal-at-mint'`; `throughCursor` chains pages byte-identically. |
| FP-09 | Scratchpad reads could leak, spill, or instruct. | `run.scratchpad.read` on `shared` and `worker:<id>` serves ≤64-entry pages with `UNTRUSTED_SCRATCHPAD` framing and ≤4,096-byte leaves; `nextCursor` pages the remainder; `scratchpadFence`/`observedSeq` ride verbatim; a foreign run refuses `application_unauthorized` identically to an unknown one; the read appends no event and mints no audit class. The page's SERIALIZED TOTAL honors the 256 KiB budget: a page that would cross it truncates with `truncated: true`, the digest-citation of the full id set, and a continuing `nextCursor` (Decision 6). |
| FP-10 | Elevation could bypass its fence discipline — or no-op silently. | `run.scratchpad.elevate` on a terminal task of a STEERING-REGISTERED run returns the verbatim store receipt (`elevated`, `dispositionDigest`, both fences) with **`elevated ≥ 1`** — the selection is honored, and a silent discard greens nothing; a non-terminal task returns `{ok: false, result: 'scratchpad_settlement_not_ready'}`; an exact retry THROUGH THE WRAPPER returns `{ok: true, result: 'empty', reapEventSeq: null, dispositionDigest: null, elevated: []}` — never `idempotent`, and `scratchpad_settlement_conflict` never fires through the projected path (both are pinned separately as STORE-DIRECT postures against the store lane: same-fence replay → `idempotent`, changed selection under the same fence → conflict — the `scratchpad-33-red.test.mjs:600-604` shape); an elevate driven AFTER a cleanup reap (the `releaseTerminalTaskResources` auto-settle) degrades to `empty` — the ordering row asserts elevate-first; an unknown/cross-run/foreign task ≡ `application_unauthorized`; a selection outside the partition surfaces the lane's `scratchpad_settlement_invalid`. |
| FP-11 | Board binding semantics could drift. | `run.board.read` of a foreign-bound board ≡ `application_board_scope_forbidden` (post identical); unbound+empty read ≡ `application_board_not_found`; unbound-with-items read SERVES; a first post to an unbound board returns `boardRunBinding.result: 'adopted'` and replay derives the binding byte-identically; a post to a stopped/sealed run refuses `application_board_run_closed`; an exact retry replays `idempotent` (never a double post) with the replay `boardRunBinding` DERIVED from the returned prior event's `payload.boardAdmission` (byte-equal to the seam's derivation, Decision 8). THE RACE ROW: the facade passes an `appendGate` re-validating binding + run-open at append time — a post raced against a binding change or run close refuses at the gate and never writes (the S-2 no-check-then-write-window law, ground truth 10). |
| FP-12 | The board read could serve raw or stale views. | The read view is `projectBoardView`'s exact output (≤512 items / ≤256 KiB, truncation-marked, UNTRUSTED-framed, dual-fence cache — a claim/report/expiry invalidates it, the #78 BW-14 law) and appends no event. |
| FP-13 | Seeds could escape the horizon or the idempotency law. | `run.knowledge.seed` returns the content-addressed `nodeId`; the node is inside the run's horizon (`_runHorizonNodeIds` membership); an exact retry returns `idempotent` with the same id; distinct content seeds a distinct node (never a silent overwrite); a `verified` FINDING seed without evidence refuses `application_knowledge_seed_invalid` (the Finding-scoped rule, mirrored); type `Decision` refuses at validation; a stale `coordinationSeq` surfaces the lane's `temporal_incoherence`; an unknown `artifactId` surfaces `missing_evidence`; `knowledge_node_conflict`/`duplicate_node` stay unreachable through the content-derived key (defense-in-depth, asserted by a key-derivation row). |
| FP-14 | The tools could be absent, open-shaped, or self-naming. | MCP descriptor rows: the six tools appear in `mcpApplicationToolNames()` with `additionalProperties: false` schemas, `_meta` registry digest, the pinned capability classes, `invalid_*` guards, and dispatch to the right `application.command` names with the CONNECTION-derived principal (a tool-arg `principalId`/`sessionId`/`sessionAuthority` is schema-refused); no `baton_run_board_*` tool exists. The rows also pin the Decision 10 preconditions: the DEFAULT observe-only principal reaches the two read tools; send/elevate/seed require a `control`-capable descriptor principal. |
| FP-15 | Refusals could degrade at the wire. | Through a descriptor-driven `McpFleetServer`: the `application_*` codes and every newly mapped lane family (attention/scratchpad-settlement/knowledge-seed) surface AS THEMSELVES — never `command_outcome_unknown`, never `invalid_command`; the six tools are in `ORDINARY_EXPLICIT_TOOLS`; none is in `STATEFUL`/`RECONCILABLE`; no wire schema carries `idempotencyKey`. The knowledge rows drive a stale `coordinationSeq` → `temporal_incoherence` and an unknown `artifactId` → `missing_evidence` AS THEMSELVES (the rung's headline property at the exact point v2.0 staged wrong). A descriptor row with `principal.userId: 'wave-owner'` proves the attention lane's codes reach the wire through MCP — the default principal refuses `attention_scope_forbidden` on a run scope (Decision 5). |
| FP-16 | Docs could drift from the served surface. | CLI rows: the nine spellings parse to the pinned `{kind: 'command', name, args}` dispatches (unknown sub-verb → parse error, not a run-start objective); after the Decision 11 regeneration, `checkSurfaceDocs() === []`, `node impl/scripts/surface-conformance.mjs` prints `surface-conformance: ok` with the regenerated CS-4 artifact, and the three pinning suites stay green. |
| FP-17 | Size refusals could stay silent or invent caps. | For EACH row of the Decision 12 table: at-cap admitted, cap+1 refused with the pinned `application_*_invalid` code whose text names BOTH numbers; a static assertion shows the new validators contain ONLY the cited constants; at MCP the refusals surface as `application_` codes, never `invalid_command`. |
| FP-18 | The projection could smuggle semantics. | Static pins: `Object.keys(APPLICATION_COMMAND_DEFINITIONS)` unchanged (grammar-m3 green); `wave-driver.mjs` still free of `attentionFollow` (the D5 pin, `impl/test/bidirectional-v3-red.test.mjs:747`); the new tool schemas carry no `sessionAuthority`/lease/settlement fields; the kernel diff contains ONLY the read-only authorization accessor; the eight commands dispatch ahead of the recursive-session gate (a live run-orchestrator lease holder retains the lane-admitted review authority). |
| FP-19 | The settlement plane could be perturbed. | A descriptor-driven server whose principal lacks the `settlement` capability serves all six new tools; the settlement tools' envelope requirements (`board_lease_required`, settlement capability) are byte-identical before and after; the combined-surface `baton_board_*` family is untouched. |
| WS-01 | The demo still needs a bespoke driver. | THE SCRIPTED-WORKFLOW ROW (live acceptance): one scripted driver runs the Decision 13 sequence end-to-end — seed → `waves.start` (4) → message queries → reply receipts → attention pages + decision answer → elevate → shared/board reads → `waves.attach` harvest — importing ONLY the facade (or talking MCP). A static assertion proves the script contains no `createDriver`/`coordinator.mjs`/`coordination-store.mjs` import — INCLUDING dynamic `import()` of those path strings (the grep form is pinned) — AND no `.driver`/`.coordinator`/`.coordination` member access (the public-field reach, Decision 13). The elevation step runs BEFORE any settlement/cleanup reap and asserts `elevated ≥ 1` (Decision 7). Every effect is receipted on durable events/ids (message ids, board item ids, node ids, elevation receipts, attach outcome), never sleep durations or turn counts. The "or talks MCP" disjunction is SCOPED: through MCP the six ordinary lanes are driven with the Decision 10 preconditions (`control`/`approve` capabilities, the orchestrator-named principal for attention); the board steps are facade/CLI. |
| WS-02 | A step could silently require kernel reach. | The demo's step→command map is asserted mechanically: each of the eight sequence steps resolves to a served facade command or MCP tool in the regenerated inventories (CLI.md/MCP.md generated blocks + the CS-4 artifact). The board steps (1, 7) resolve to FACADE commands explicitly — the facade-or-MCP disjunction cannot green them on an MCP surface that cannot serve boards (ground truth 11, Decision 10). |

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
8. **Fence-pinned scratchpad cursors and ordinary-path selection honor (reframed in v2.1).**
   v1 pages scratchpad reads by offset with a carried fence (Decision 6) and projects only the
   terminal-task elevation wrapper (Decision 7). The store's `expectedFenceTuple` CAS
   (`impl/src/coordination-store.mjs:13638-13641`) is one named candidate for a later rung. The
   other is the elevation SELECTION question, reframed by the fold: the landed distinction is
   not "terminal-task vs mid-flight" — it is "steering-registered runs honor the selection at
   any time; all other runs discard it, always" (`:13822-13833`). The open question is whether
   the ORDINARY (non-wave) elevation path should EVER honor a selection — a kernel amendment
   this rung deliberately does not spend (Decision 7) — not only whether mid-flight elevation
   should surface.
