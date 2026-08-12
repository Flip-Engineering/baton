# AX findings #108–#112 — triage / disposition table

Triage of the five findings the AX-review wave (2026-08-06) filed as #108–#112. Each is restated,
checked against HEAD, given a disposition, and the survivors are ranked by orchestrator-AX impact.

## Sources & method

`gh` is **not authenticated in this seat** (`gh auth status` → "not logged into any GitHub hosts";
`GH_TOKEN` unset), so the issue **bodies could not be read directly** — per the brief's fallback, I
worked from the AX-review wave's own receipts and the code at HEAD, which is stronger ground than the
issue text anyway. Sources actually read:

- `docs/reference/evidence/ax-review-2026-08-06/workflow-surface-ax-report.md` (11 findings)
- `docs/reference/evidence/ax-review-2026-08-06/frame-economics-ax-report.md` (8 findings, F1–F8)
- `docs/reference/evidence/frontier-sweep-2026-08-03/orchestrator-friction-ledger.md` (Appendix B
  names "AX-review wave (#108-112)")
- commit `c00acdd` message — the **issue→finding map** (the only place the five numbers are bound to
  their findings; reproduced below)

Issue→finding map (from `c00acdd`):

| Issue | Finding | AX-report anchor |
|---|---|---|
| #108 | WF-1: `attention.watch` silently dead for the documented MCP principal (HIGH) | `workflow-surface-ax-report.md:26` |
| #109 | FE-F2: the `{cap,actual,unit,gracefulPath}` coaching shape dropped by both northbound transports | `frame-economics-ax-report.md:31` |
| #110 | FE-F5+F6: spill-lane doctrine violations — silent cap-void (F5) + no run-horizon auth on the spill query (F6) | `frame-economics-ax-report.md:50` (F5), `:55` (F6) |
| #111 | FE-F1+F3+F4: `refusalPath` self-contradiction (F1) + generic liveness nudge (F3) + doctor/refusal cap disagreement (F4) | `frame-economics-ax-report.md:25` (F1), `:38` (F3), `:44` (F4) |
| #112 | WF docs/discovery cluster: WF-2,3,5,6,8,9,10,11 | `workflow-surface-ax-report.md:35`–`:66` |

Current-truth was verified by grepping the current tree (`grep -an` on the NUL-bearing
`application.mjs` + `coordination-store.mjs`; plain grep elsewhere) — not by trusting the reports'
line numbers, which are from `f33c24e`/`07d9ddd` and have drifted. Every claim below cites the
file:line it was read from at HEAD.

## Disposition table (scan summary)

| # | Finding (one line) | Current truth | Disposition | Impact |
|---|---|---|---|---|
| **#108** | `attention.watch` returns a silent empty page (cursor rewound to 0) for the documented `control` principal | **STILL-PRESENT** (a comment was added explaining intent; behavior + doc unchanged) | **Fold into the AX spine / #10** (waiting-on vocabulary) | **HIGH** |
| **#109** | spill/board/decision coaching codes degrade to `temporarily_unavailable` / `command_outcome_unknown` on both transports | **STILL-PRESENT** (other lanes — wave/workflow/message-budget — were taught passthrough meanwhile; the cited codes were not) | **New contract** — generalize the #132 D5 passthrough to every `{cap,actual,unit,gracefulPath}`-carrying refusal | **HIGH** |
| **#110** | spill lane: reply/objective store the full over-cap body when `mintSpill` is absent (F5); the spill query resolves by digest with no run-horizon check (F6) | **STILL-PRESENT** (both) | **New contract** — spill-lane doctrine (F5 + F6) | **CRITICAL** (F6) |
| **#111** | `refusalPath` tells a beyond-ceiling body to spill (F1); the liveness nudge is generic (F3); the doctor projection hides the effective spill ceiling (F4) | **STILL-PRESENT** (all three) | **Fold F4→#72** (prescriptive doctor); **F1→frame-economics-truth**; **F3→#106** (declarative steering) | **MEDIUM** |
| **#112** | docs/discovery cluster (8 sub-findings) | **PARTIALLY-FIXED**: WF-11 (boards on MCP) FIXED; WF-2,3,5,6,8,9,10 STILL-PRESENT | **Fold the 7 survivors→AX spine / #103** (briefing pack); **CLOSE WF-11** (proof below) | **MEDIUM** |

---

## #108 — `attention.watch` is silently dead for the documented MCP principal

**Restate.** A `control`-capable MCP principal (exactly MCP.md's example block) watching a run's
attention inbox gets a silent empty page — indistinguishable from "no news" — because the lane only
admits `wave-owner` or a live run-orchestrator lease, and the MCP catch converts the refusal to an
empty result with the cursor rewound to 0. (`workflow-surface-ax-report.md:26`–`:34`)

**Current truth — STILL-PRESENT.** The lane still throws `attention_scope_forbidden`
(`impl/src/coordinator.mjs:7061`); `_attentionScopeAuthorized` admits `wave-owner` unconditionally and
otherwise requires `_isReviewAuthority`, which needs a live run-orchestrator lease for the session
(`coordinator.mjs:7089`–`7091`, `:7096`–`7104`). Leases still mint only at settlement/prep
(`coordinator.mjs:11492` — "members absent … always mints a lease"), never at run/wave start. The MCP
catch is unchanged in behavior: on `attention_scope_forbidden` for a `control` principal it returns
`{schemaVersion:1, runId, afterCursor:0, throughCursor:0, reasons:[]}` (`impl/src/mcp-northbound.mjs:1887`–`1898`,
the empty value at `:1894`) — **the cursor is reset to 0 regardless of `args.cursor`**. What did
change since the review: a comment was added (`mcp-northbound.mjs:1888`–`1891`) framing the empty
fallback as "Decision 5's transport authority … page the run (empty for unknown/unauthorized scopes)."
That documents the *intent* but the agent-observable behavior (silent "no news" + cursor rewind) and
the **MCP.md non-disclosure** are unchanged — MCP.md still shows only the example principal
(`impl/MCP.md:30`) and the lane table (`:155`); it never states the `wave-owner`/live-lease
requirement nor that an unauthorized scope reads as empty.

**Disposition — fold into the AX spine / #10 (waiting-on vocabulary).** This is the canonical
blocked-state-is-invisible problem #10 exists to fix: "blocked vs working is indistinguishable." A
forbidden scope must not be byte-identical to an empty inbox. Seed: surface a typed marker on the
empty fallback (e.g. `{empty:true, reason:'scope_unauthorized'}`) or let `attention_scope_forbidden`
ride as a typed refusal (it is already allowlisted on MCP — `mcp-northbound.mjs:257`), and echo the
requested `afterCursor` instead of rewinding to 0. The MCP.md disclosure rides the #112 doc cluster.

---

## #109 — the coaching shape is dropped by both northbound transports

**Restate.** The frame-economy size refusals carry `{cap, actual, unit, gracefulPath}` and a typed
`refusalCode` (`spill_body_exceeded`, `board_report_exceeded`, `decision_question_exceeded`, …) on the
durable stream and for in-process callers, but both northbound transports collapse them to a generic
code with no numbers — web to `{code:'temporarily_unavailable', message:'command dispatch failed'}`,
MCP to `command_outcome_unknown`. (`frame-economics-ax-report.md:31`–`:37`)

**Current truth — STILL-PRESENT (for the cited codes).** The coaching codes are still declared
(`impl/src/limits.mjs:54`–`66`, `:86`) and still thrown (e.g. `impl/src/coordinator.mjs:12600`
`refuse('spill_body_exceeded', …)`). Neither transport special-cases them:

- web `dispatchFailure` has no branch matching the `*_exceeded` coaching codes; they fall through
  every prefix check (`worker_policy_*`/`run_orchestrator_*`/`application_*`/…) to the generic
  `{code:'temporarily_unavailable', message:'command dispatch failed'}` at
  `impl/src/web-northbound.mjs:278`.
- MCP `stateFailureCode` has no allowlist entry for them; they fall through to `command_outcome_unknown`
  at `impl/src/mcp-northbound.mjs:278`.

What did change since the review: **other lanes were taught the passthrough** — the wave lane
(`wave_member_invalid`/`wave_not_found`, web `:270`–`277` / MCP `:214`–`218`, tagged "#132 D5"), the
workflow lane (`workflow_*`, MCP `:209`–`213`, "#114 B3"), and the message-budget refusal
(`message_budget_invalid`, web `:229` / MCP `:224`, "#105 D3"). The originally-cited spill/board/decision
coaching codes were simply not on that list.

**Disposition — new contract: "northbound coaching-code passthrough."** Generalize the #132 D5 pattern
(which already works for the wave lane) to *any* error carrying `{cap, actual, unit, gracefulPath}`
(or equivalently any `*_exceeded` code). Seed: (a) add the `*_exceeded` codes (or a
"carries cap/actual" predicate) to both `dispatchFailure` and `stateFailureCode`, passing the payload
through byte-identically like the wave lane does; (b) a transport-level golden over `/v1/commands` for
an oversize `run.start` objective (the AX report's recommendation 2 — currently "B3 tests the
in-process error only").

---

## #110 — spill-lane doctrine violations (F5 silent cap-void + F6 no horizon auth)

**Restate.** *(F5)* If `mintSpill` is absent/returns null, the reply (and objective) lane stores the
**full** over-cap body with no `spilled` flag — voiding the 2048-byte cap unmarked — while the send
lane *throws* on the same condition. *(F6)* The `spill` context-read kind resolves a body by digest
with no run-horizon check, unlike the `finding` kind which resolve-then-authorizes — so a spill from
another run is materializable by any holder of the digest. (`frame-economics-ax-report.md:50`–`:58`)

**Current truth — STILL-PRESENT (both).**

- **F5:** the send lane still throws when `mintSpill` is absent (`coordinator.mjs:6862`), but the
  reply lane still does not — `const minted = this._coordination.mintSpill ? … : null`
  (`coordinator.mjs:12610`–`12613`); when `minted` is null, `replySpillRecord` stays null
  (`:12608`,`:12614`–`12615`) and the full `frameBody` is stored in the message map with no `spilled`
  flag (`coordinator.mjs:12649`,`:12652`). The asymmetry the AX reviewer flagged is intact: send
  refuses, reply admits whole.
- **F6:** the `spill` kind still resolves by digest only — `materializeSpill(query.spill)`
  (`coordinator.mjs:10809`), taking just the digest handle (`:10805`–`10806`), with no runId/horizon
  passed in; `context_not_found` fires only on an *unknown* spill (`:10810`–`10811`), not on a
  *foreign-run* spill. Contrast the `finding` kind's explicit "resolve-then-authorize … possession of
  a digest is never authority … authorized against the run horizon" (`coordinator.mjs:10744`–`10752`).
  The spill kind's own comment (`:10801`–`10804`) frames it as "digest-addressed handle" with no
  horizon mention — the doctrine gap is preserved in the prose.

**Disposition — new contract: "spill-lane doctrine."** Two independent fixes: (F5) throw
`coachingError` on the `mintSpill`-absent fallback in the reply and objective lanes, matching the send
lane (`coordinator.mjs:6862`) — the AX report's recommendation 5; (F6) scope `materializeSpill`/the
spill query to the requesting run's horizon the way the `finding` kind does — recommendation 6.

---

## #111 — refusalPath contradiction (F1) + generic liveness nudge (F3) + doctor/refusal disagreement (F4)

**Restate.** *(F1)* `refusalPath` tells any graceful lane to "spill to a durable artifact" regardless
of size, so a body *over* the 1 MiB spill ceiling (which does NOT spill) is told to spill — a
self-contradiction. *(F3)* the `claim_premature_liveness` corrective nudge is the generic
"Continue the current turn." with no liveness counts / no "you need an in-scope diff". *(F4)* the
doctor projection shows `message.send.body` value 2048 while the beyond-ceiling refusal names
`cap: 1048576` — three numbers for one lane, and the projection omits `refusalCode`/`gracefulPath`.
(`frame-economics-ax-report.md:25`–`:49`)

**Current truth — STILL-PRESENT (all three).**

- **F1:** `refusalPath` is still two-way — `row.graceful === 'spill-digest-citation'` → spill phrase,
  else the hard "resend within the {cap}-byte cap" (`impl/src/limits.mjs:32`–`36`). It is still the
  ONE composer every size refusal uses (`composeFrameLimitRefusal`, `:40`–`42`). The beyond-ceiling
  branches were added but still compose through it: the send lane throws
  `coachingError(FRAME_LIMITS['message.send.body'], bodyBytes, spillCeiling)` for `bodyBytes > spillCeiling`
  (`coordinator.mjs:6856`–`6857`) and the reply lane refuses with
  `composeFrameLimitRefusal(…, replyBytes, replySpillCeiling)` (`coordinator.mjs:12600`–`12604`) — both
  emit the spill phrase for a body that is, by construction, over the spill ceiling. The three-way
  selection the AX report recommended (spill-admitted / beyond-ceiling "resend within N bytes" / hard)
  was not implemented.
- **F3:** the corrective nudge is still the generic `completionMessage: 'Continue the current turn.'`
  (`impl/src/wave-driver.mjs:37`), sent verbatim on `nudge_turn` (`wave-driver.mjs:385`,`:703`). No
  liveness counts, no "no in-scope diff"; the contract's "nudge MAY carry TG4's sanitized
  `{gate, detail}` shape" is still unimplemented.
- **F4:** the doctor projection still emits `{lane, class, value, unit, graceful}` per lane
  (`impl/src/application.mjs:12385`–`12391`) and populates `effective` **only** for `decision.need` /
  `decision.rationale` overrides (`:12388`–`12389`) — never the effective spill ceiling for graceful
  lanes, never `refusalCode`/`gracefulPath`. So `message.send.body` projects at value 2048 while its
  beyond-ceiling refusal names cap 1048576 (`coordinator.mjs:6857`): the three-numbers problem is
  intact, and an orchestrator still can't derive the ≤2048 plain / 2048–1 MiB spilled / >1 MiB refused
  envelope from the projection.

**Disposition — split across three homes (they are three different surfaces):**

- **F4 → fold into #72 (prescriptive doctor).** The doctor projection *is* the prescriptive-doctor
  surface; F4 is exactly its defect. Seed: project each graceful lane's effective admission ceiling
  (the `spill.body` value) plus `refusalCode`/`gracefulPath`, and make the refusal `cap` agree with
  the projection (AX recommendation 4).
- **F1 → fold into the frame-economics-truth contract** (the limits-registry consolidation the
  friction ledger's Appendix B tracks — "a policy value must exist ONCE … the construction site should
  derive, never repeat a literal"). Seed: make `refusalPath` three-way, selected by
  `(graceful, actual vs spillCeiling)`; add a beyond-ceiling golden beside B3 (AX recommendation 1).
  This is the same family as #109/#110 — they share the registry/composer.
- **F3 → fold into #106 (declarative steering policy lanes).** The corrective nudge is steering; #106
  is where declarative steering lives. Seed: deliver sanitized `{liveness counts, reason:'no in-scope
  diff'}` in the `claim_premature_liveness` nudge, or address the worker directly in the reason when a
  worker issues `claim_turn` (AX recommendation 3).

---

## #112 — the docs/discovery cluster (8 sub-findings)

**Restate.** A cluster of documentation/schema-discovery gaps an agent hits docs-first on the
workflow-surface epic: opaque `knowledge_seed` evidence schema (WF-2), undocumented CLI wire grammars
(WF-3), two undocumented refusal namespaces per tool (WF-5), receipt fields that never advance (WF-6),
undocumented `--worker` flag (WF-8), no discovery path for `scratchpad.elevate`'s taskId (WF-9), the
verified-Finding-requires-evidence rule expressed only in code (WF-10), and boards absent from the MCP
surface (WF-11). (`workflow-surface-ax-report.md:35`–`:66`)

**Current truth — PARTIALLY-FIXED.** Seven STILL-PRESENT, one FIXED:

- **WF-2 — STILL-PRESENT.** `baton_run_knowledge_seed`'s schema still declares
  `evidence: { type:'array', maxItems:32, items:{ type:'object' } }` — bare `object`, no `oneOf`
  (`impl/src/mcp-northbound.mjs`, the knowledge_seed `inputSchema`). The registry's
  `oneOf {coordinationSeq:int≥1}|{artifactId}` shape is not carried; a malformed ref still dies at the
  facade as generic `application_knowledge_seed_invalid`.
- **WF-3 — STILL-PRESENT.** CLI.md still shows the bare `MESSAGE_ID` form
  (`impl/CLI.md:39`); the refusal is still `message ID is invalid` with no format hint
  (`impl/src/application-cli.mjs:1386`). No `message:<64hex>` / `scratchpad-entry:` / `worker:<id>`
  grammar is documented.
- **WF-5 — STILL-PRESENT.** Neither refusal family (`invalid_message_send` guard code vs
  `application_message_send_invalid` facade code) appears in CLI.md or MCP.md (grep empty).
- **WF-6 — STILL-PRESENT (by design; the gap is the doc).** `actedOn` is still "never claimed"
  (`coordinator.mjs:6978`–`6980`, initialized `actedOn:false` at `:6915`); `read` is tri-state
  (`:6994`–`6995`). The behavior is the honest-receipt state machine by design — the defect is that
  the description never tells a poller which fields may ever advance.
- **WF-8 — STILL-PRESENT.** CLI.md shows only the `MESSAGE_ID` form (`CLI.md:39`); the `--worker`
  target flag (`application-cli.mjs:1369`) and its XOR rule are still undocumented.
- **WF-9 — STILL-PRESENT.** CLI.md shows `--task TASK_ID` (`CLI.md:45`) and MCP.md lists the tool
  (`impl/MCP.md:128`,`:165`,`:172`) but neither says where an agent obtains the taskId.
- **WF-10 — STILL-PRESENT.** The `grounding` enum still includes `'verified'` with no schema
  conditional expressing "verified requires evidence" (knowledge_seed schema + `application-semantics.mjs:1718`);
  the rule is still code-only at the facade.
- **WF-11 — FIXED-BY-OTHER-WORK.** Boards are now on the MCP surface: `board.post` and `board.read`
  are `APPLICATION_COMMAND_DEFINITIONS` entries (`impl/src/application-semantics.mjs:1359`,`:1410`)
  dispatched as `baton_board_post` / `baton_board_read`
  (`impl/src/mcp-northbound.mjs:1049`,`:1076`,`:1977`,`:2022`). The "two of eight epic ports have no
  MCP tool" gap is closed.

**Disposition.**

- **CLOSE WF-11** — proof above (board.post/board.read are MCP tools at HEAD).
- **Fold the seven survivors → AX spine post-#10 / #103 (orchestrator briefing pack).** All seven are
  doc/schema-discovery gaps, not behavioral defects; #103 (the briefing-pack epic, already landing —
  see `mcp-northbound.mjs:1362`–`1368` "Epic #103 D6a") and #104 (symbol-cited briefs) are the
  doc-truth lane. Split the seed by surface: WF-2/WF-10 → MCP schema-truth (carry the registry `oneOf`
  and the verified-requires-evidence conditional into the knowledge_seed schema); WF-3/WF-8/WF-9 →
  CLI.md grammar/flag/discovery cluster; WF-5 → refusal-code family documentation; WF-6 → MCP.md steer
  prose naming the permanent-null fields.

---

## Ranking the survivors by orchestrator-AX impact

1. **#110-F6 (spill query has no run-horizon auth) — CRITICAL.** A cross-run authorization bypass:
   any worker holding a spill digest materializes that body regardless of run, contradicting the
   lane's own stated doctrine ("possession of a digest is never authority," `coordinator.mjs:10744`).
   Unguessable in practice, but it is the one item that is a *correctness/security* defect rather than
   a visibility defect, and the doctrine gap is preserved in the code's own prose. Fix is localized
   (pass runId to `materializeSpill`, intersect like the `finding` kind).
2. **#108 (attention.watch silent empty + cursor rewind) — HIGH.** The orchestrator's *primary*
   observation lane silently lies: a forbidden scope is byte-identical to "no news," and the cursor
   rewinds to 0 on every such poll. An orchestrator watching a completed member for a terminal reason
   waits forever without signal. This is the #10 waiting-on problem in its purest form.
3. **#109 (coaching codes dropped on both transports) — HIGH.** The orchestrator's *only* path to the
   size numbers is the northbound transport, and for the spill/board/decision refusals it returns an
   opaque 503 / `command_outcome_unknown` with no cap, no actual, no gracefulPath. The orchestrator
   cannot self-correct an oversize send; the fix (generalize the #132 D5 passthrough that already
   works for the wave lane) is mechanical.
4. **#111 (F1+F3+F4 frame-economics coaching truth) — MEDIUM.** Three paper cuts on one surface:
   F4 (doctor hides the effective ceiling) is the most orchestrator-impactful — it breaks budget
   enumeration; F1 (self-contradictory "spill it" refusal) actively teaches the wrong fix; F3 (generic
   nudge) leaves an analysis-only worker unable to learn *why* it was refused. None blocks the
   orchestrator outright; together they erode trust in the frame-economy surface.
5. **#112 (7 surviving doc/discovery gaps) — MEDIUM.** No behavioral defect — each costs one source
   dive the first time an agent hits it docs-first. The long tail; batch into the #103/#104 doc-truth
   lane. (WF-11 is closed.)

## The pattern (unchanged from the friction ledger's meta-lesson)

Every survivor is a *surface not saying what it knows* — the same diagnosis as the ledger's Appendix B
entry that begat this wave ("Landed epics carried live-surface bugs their suites didn't pin"). The
machinery had the numbers (limits registry), the authority (run horizon), and the reason (no in-scope
diff) the whole time; the transports, the projection, the nudge, and the docs simply didn't carry them
to the agent. The fixes are almost all *passthrough/echo* fixes, not new capability — which is why
#109's "generalize the D5 passthrough" and #110-F6's "intersect the run horizon like `finding` does"
are the highest-leverage: they extend patterns the codebase has already proven once.
