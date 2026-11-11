# AX findings #108–#112 — triage / disposition table

Triage of the five issues filed from the AX-review wave (2026-08-06). Each issue is restated,
truth-checked against the current tree, assigned a disposition lane, and the survivors are
ranked by orchestrator-AX impact.

- **HEAD truth-checked:** `ad636d0` (2026-08-13). Every code citation below is a line read at HEAD.
- **Receipt provenance:** `gh` was unauthenticated in this worktree, so the issue *bodies* were
  not fetchable. The issue→finding mapping is reconstructed from (a) the two AX-review receipts —
  `ax-review-2026-08-06/workflow-surface-ax-report.md` and `…/frame-economics-ax-report.md` — and
  (b) the wave's own commit message `c00acdd`, which names each issue number against its finding
  cluster, cross-checked against the orchestrator friction ledger
  (`frontier-sweep-2026-08-03/orchestrator-friction-ledger.md`, Appendix B row "AX-review wave
  (#108-112)"). The mapping is unambiguous; if any issue body diverges from this mapping it should
  be re-checked once `gh` is authenticated.
- **Method:** symbol-anchored greps (line numbers drifted ±tens-to-hundreds since the 2026-08-06
  reports). `application.mjs` and `coordination-store.mjs` are NUL-laden (see cross-cutting note);
  those two were grepped with `grep -anP "\x00"` / `grep -an`, the rest plain.

## Issue → finding cluster (from commit `c00acdd`)

| Issue | Report | Finding cluster |
|---|---|---|
| **#108** | workflow-surface | friction 1 — `attention.watch` silently dead for the documented MCP principal (HIGH) |
| **#109** | frame-economics | F2 — the `{cap,actual,unit,gracefulPath}` coaching shape dropped by both northbound transports |
| **#110** | frame-economics | F5 (silent cap-void when `mintSpill` absent) + F6 (spill query kind lacks run-horizon authorization) |
| **#111** | frame-economics | F1 (refusalPath contradiction) + F3 (generic premature-liveness nudge) + F4 (doctor projection vs refusal disagree) |
| **#112** | workflow-surface | frictions 2–11 — the docs/discovery cluster (opaque evidenceRef, undocumented wire grammars / soft-fail states / receipt-null fields, boards absent from MCP, …) |

---

## #108 — `attention.watch` silently dead for the documented MCP principal

**Restate.** Under MCP.md's example principal `{userId:'operator', capabilities:[…,'control']}`
(`impl/MCP.md:28-29`), `baton_run_attention_watch` on a completed member throws
`attention_scope_forbidden` because the lane admits only `wave-owner` or a live run-orchestrator
lease, and the MCP catch swallows that into a silent empty page — so an agent watches a finished
member and forever sees "no news". (`workflow-surface-ax-report.md:26-34`.)

**Current truth — STILL-PRESENT.** The gate is unchanged in substance:
- `_attentionScopeAuthorized` → `_isReviewAuthority` admits **only** `principalId === 'wave-owner'`
  or a live run-orchestrator lease whose session matches (`coordinator.mjs:7086-7090`,
  `:7096-7112`). There is **no** branch that recognizes the documented `operator` principal by its
  `control` capability — so a run-scoped watch by that principal still throws
  `attention_scope_forbidden` (`coordinator.mjs:7061`).
- The MCP catch still converts that throw, for any `control`-capable principal, into the silent
  empty page with the cursor **hardcoded to 0 regardless of the requested cursor**
  (`mcp-northbound.mjs:1891-1896`, the `afterCursor:0, throughCursor:0, reasons:[]` at `:1894`).
  The surrounding comment now frames the swallow as deliberate ("Decision 5's transport authority …
  page the run, empty for unauthorized scopes") and observe-only principals keep the refusal — but
  the *outcome for the documented control principal* is identical to the original finding: silent
  "no news".
- MCP.md still lists `run.attention.watch` as an ordinary idempotent tool (`impl/MCP.md:155`) and
  discloses neither the `wave-owner`/lease requirement nor the silent-empty behavior.

**Disposition — fold into the AX spine post-#10.** This is the canonical "the surface doesn't say
what it knows" defect: a primary blocked-state visibility lane returns an untruthful empty page
rather than a typed signal. It belongs on the truthful-steering-trail / blocked-state-vocabulary
spine (the lane the recent `docs(#74)` "truthful steering trail" and read-authorization-law work
extends). The fix is one of: (a) make the control-principal empty return a *typed* refusal so the
agent knows the scope is unauthorized (truthfulness), and/or (b) mint a run-orchestrator lease for
the descriptor operator at `waves.start` so the documented principal can actually page — the
capability alternative, which would route the work to #71 wake / #132 follow-ups. Either way the
silent hardcoded-0 fallback at `mcp-northbound.mjs:1894` must stop lying.

---

## #109 — the coaching shape is dropped by both northbound transports

**Restate.** `web-northbound` `dispatchFailure` and MCP `stateFailureCode` map every unrecognized
code — including all frame-economics coaching codes (`spill_body_exceeded`,
`board_report_exceeded`, `decision_question_exceeded`, …) — to a generic code, so the
`{cap,actual,unit,gracefulPath}` payload an oversize `run.start`/send produces is lost on the wire;
only in-process callers and the durable `message.rejected` stream keep the numbers.
(`frame-economics-ax-report.md:31-37`.)

**Current truth — STILL-PRESENT (for the frame-economics coaching family specifically).** Both
transports grew large allowlists for *other* epics since the finding, but the frame-economics
coaching codes were never added:
- The coaching codes appear in **neither** transport (`grep -c` of `spill_body_exceeded`,
  `board_report_exceeded`, `decision_question_exceeded`, `message_send_invalid` → 0 in both
  `web-northbound.mjs` and `mcp-northbound.mjs`) and match **no** passthrough prefix
  (`application_` / `worker_policy_` / `run_orchestrator_` / `workflow_` / `wave_` …).
- So MCP `stateFailureCode` still falls through to `return 'command_outcome_unknown'`
  (`mcp-northbound.mjs:278`) and web `dispatchFailure` still ends at
  `{code:'temporarily_unavailable', message:'command dispatch failed'}` (`web-northbound.mjs:278`).
- The codes are still thrown with these exact names (registry `refusalCode` values,
  `limits.mjs:54-57,84-86`; throw sites `coordinator.mjs:12600`, `coordination-store.mjs:710`), and
  no detail-passthrough equivalent of the `wave_member_invalid` `{actual,cap,cause,role}` handling
  exists for them — so the `{cap,actual,…}` detail is dropped too, not just the code.
- What *did* land: `application_run_lookup_oversize`/`…_view_oversize` are now named on web
  (`web-northbound.mjs:196`) and an `application_*`/`workflow_*`/`wave_*`/scratchpad/knowledge/board
  allowlist exists on MCP (`mcp-northbound.mjs:205-277`) — partial progress that confirms the
  pattern is understood, just not extended to the frame-economics family.

**Disposition — its own new contract** (seed: "coaching-payload passthrough on both northbounds").
The honest fix is structural, not enumerative: any error carrying
`{cap,actual,unit,gracefulPath}` passes through typed on both transports with its detail intact,
plus a transport-level B3 red row over `/v1/commands` and the MCP tool-error path. The friction
ledger's discipline fold demands exactly this — "surface suites must pin both transport levels
(in-process + MCP/web)" — which needs its own red rows that no existing in-flight lane owns. The
limits-projection half of the coaching story rides #72 (prescriptive doctor); the transport-mapping
half is the new contract.

---

## #110 — spill-lane doctrine: silent cap-void (F5) + no run-horizon auth (F6)

**Restate.** (F5) if `mintSpill` returns null the reply/objective lanes store the full over-cap
body unmarked, unlike the send lane which throws (`frame-economics-ax-report.md:50-54`). (F6) the
`spill` context-read kind resolves a spilled body by digest with no run-scope check, contradicting
the `finding` kind's "possession of a digest is never authority" doctrine
(`frame-economics-ax-report.md:55-58`).

**Current truth — PARTIALLY-FIXED.**
- **F5 — realistic path CLOSED, defensive guard still missing.** The beyond-ceiling case now draws
  a hard coaching refusal on all three lanes: send (`coordinator.mjs:6857-6859`,
  `throw coachingError`), reply (`coordinator.mjs:12598-12604`, `refuse('spill_body_exceeded', …)`),
  and substrate (`coordination-store.mjs:13484-13486`). The *live* cap-void (an over-cap body
  admitted whole) is therefore closed. The *residual* is the original report's other half: the
  send lane guards `if (!this._coordination.mintSpill) throw coachingError`
  (`coordinator.mjs:6862`), but the reply lane (`coordinator.mjs:12604-12611`) and objective lane
  still fall through to "store unmarked" when `mintSpill` is absent — a latent misconfiguration
  guard, not a live bug (every real coordinator constructs a store with `mintSpill`).
- **F6 — STILL-PRESENT.** The `spill` kind resolver passes **no runId** to materialization
  (`coordinator.mjs:10800-10813`, `materializeSpill(query.spill)`), and `materializeSpill` is a
  pure `this._spills.get(spillId)` lookup with no run-scoping (`coordination-store.mjs:13506-13510`).
  The `finding` kind, by contrast, resolves-then-authorizes and throws `context_scope_forbidden`
  for out-of-horizon nodes (`coordinator.mjs:10740-10752`). The doctrine asymmetry stands;
  practically unguessable (64-hex content-addressed digest), but it contradicts the established law.

**Disposition — its own new contract** (seed: "spill query kind run-horizon authorization — parity
with the `finding` kind"). Scope `materializeSpill` and the spill query kind to the requesting
run's horizon, mirroring `finding`; the F5 residual guard (`if (!mintSpill) throw` on reply +
objective lanes) rides the same small contract. Too cross-cutting (frame-economics × context-read
doctrine) to fold into any one listed in-flight lane; F6 is a security/doctrine defect worth its
own scoped contract.

---

## #111 — refusalPath contradiction (F1) + generic premature-liveness nudge (F3) + doctor/refusal disagreement (F4)

**Restate.** (F1) `refusalPath` picks the spill phrase for any graceful row, so a body over the
1 MiB spill ceiling — which does *not* spill — is told to spill
(`frame-economics-ax-report.md:25-30`). (F3) the `claim_premature_liveness` reason is third-person
driver guidance and the worker-side nudge is the generic "Continue the current turn.", so an
analysis-only worker can't learn *why* it was refused (`frame-economics-ax-report.md:38-43`). (F4)
doctor's projection shows `message.send.body value: 2048` while the refusal names `cap: 1048576` —
three numbers for one lane, projection omits `refusalCode`/`gracefulPath`
(`frame-economics-ax-report.md:44-49`).

**Current truth — MIXED (F1 FIXED, F3 STILL-PRESENT, F4 PARTIALLY-FIXED); the issue splits three ways.**
- **F1 — FIXED** (by the frame-economics limits-registry consolidation, #89 / contract v1.2).
  `refusalPath` is now keyed on `row.graceful` (`limits.mjs:32-36`), and the `spill.body` substrate
  row carries `graceful: null` (`limits.mjs:84-86`); the beyond-ceiling throw composes from that
  row (`coordination-store.mjs:13486` → `coachingRefusal` at `:710`), so the message is now
  "resend within the 1048576-byte cap", not "spill to a durable artifact". **Sub-finding closes.**
- **F3 — STILL-PRESENT.** The corrective nudge is still the literal
  `completionMessage: 'Continue the current turn.'` (`wave-driver.mjs:37`) and the
  `claim_premature_liveness` reason is still third-person ("nudge the worker to continue…",
  `coordinator.mjs:2677`). The contract's "nudge MAY carry TG4's sanitized `{gate, detail}`
  shape" remains unimplemented; a refused analysis-only worker still gets no liveness counts / no
  "you need an in-scope diff".
- **F4 — PARTIALLY-FIXED.** The doctor projection now tabulates **every** registry lane — including
  `spill.body` — with `{lane, class, value, unit, graceful}` (`application.mjs:12381-12394`), so an
  orchestrator *can* now derive the two-tier envelope (admission `message.send.body` 2048 graceful
  `spill-digest-citation` + substrate `spill.body` 1048576). Residual: the projection still omits
  `refusalCode`/`gracefulPath`, and the per-refusal `cap` (1048576) still numerically disagrees with
  the per-lane projection `value` (2048) — inherent, but undocumented.

**Disposition — split.** F1 → **close** (proof above). F3 → **fold into #79 (delivery push)**: it is
a worker-side coaching defect (the worker cannot self-correct a refused turn), squarely the
delivery-push lane's worker-coaching remit; deliver sanitized `{liveness counts, reason: no in-scope
diff}` in the corrective nudge. F4 → **fold into #72 (prescriptive doctor)**: the limits projection
is doctor's surface; finish it by emitting `refusalCode`/`gracefulPath` per lane and documenting the
two-tier cap relationship.

---

## #112 — workflow-surface docs/discovery cluster (frictions 2–11)

**Restate.** The non-`attention.watch` workflow-surface frictions: `knowledge_seed` evidence refs
are opaque on the MCP wire (schema `items:{type:'object'}` while the registry knows a `oneOf`);
CLI wire grammars (`message:<64hex>`, `scratchpad-entry:`, worker scope) are undocumented and the
refusals don't teach them; `run.message.send` soft-fail states (`run_not_active`,
`worker_not_active`) are undocumented; `message_receipt`'s permanent-null `actedOn` field is
undisclosed; `board.read` truncates with no continuation; the CLI `--worker` flag and
`scratchpad.elevate` taskId discovery are undocumented; the verified-Finding-needs-evidence rule
is code-only; and boards were absent from the MCP surface. (`workflow-surface-ax-report.md:35-66`.)

**Current truth — PARTIALLY-FIXED (one sub-item fixed, the cluster largely still present).**
- **FIXED — boards are now on MCP.** `board.post` and `board.read` carry
  `surfaces: ['embedded', 'mcp']` (`application-semantics.mjs:1359-1361`, `:1410-1412`); only the
  CLI spellings `run.board.post`/`run.board.read` stay `['embedded','cli']` (`:1696-1697`,
  `:1705-1706`). Friction 11 closes.
- **STILL-PRESENT — the rest of the cluster.** The `knowledge_seed` evidence schema is still
  generic `items: { type: 'object' }` (`mcp-northbound.mjs:677`), not the registry's oneOf. And
  the docs disclose essentially none of what the cluster asked for: `impl/MCP.md` contains no
  `run_not_active`/`worker_not_active` soft-fail states, no `message:<64hex>`/`scratchpad-entry:`
  wire grammars, no `actedOn`-null disclosure; `impl/CLI.md:39` still shows the bare
  `baton run message receipt MESSAGE_ID` with no format hint. MCP.md still calls MCP "the primary
  agent-facing surface" (`impl/MCP.md:188-189`) without documenting these edges.

**Disposition — its own new contract** (seed: "workflow-surface docs disclosure + evidenceRef
schema"). Carry the registry's `evidenceRef` `oneOf` into the MCP `knowledge_seed` schema
(`mcp-northbound.mjs:677`), and add to MCP.md/CLI.md the wire grammars, send soft-fail states,
receipt permanent-null fields, board.read truncation ceiling, `--worker` XOR rule, and
`scratchpad.elevate` taskId source. This is a documentation/contract lane; among the in-flight
lanes it is adjacent to the symbol-cited-briefs work (#104, not in the listed set), so it wants its
own contract rather than a fold. The boards-on-MCP sub-item is already closeable.

---

## Survivor ranking — by orchestrator-AX impact

Only the still-live defects are ranked; closed/fixed sub-findings (F1, F5's realistic path,
boards-on-MCP) are dropped.

| Rank | Issue / survivor | Why it bites the orchestrator | Severity |
|---|---|---|---|
| 1 | **#108** silent `attention.watch` | A primary blocked-state visibility lane returns an untruthful empty page (hardcoded cursor 0) for the documented principal — the orchestrator's "is this member alive?" surface silently lies. Directly defeats the #10 waitingOn / AX-spine mission. | HIGH |
| 2 | **#109** coaching dropped on both transports | Every frame-economics size refusal loses its `{cap,actual,gracefulPath}` coaching on MCP *and* web — an orchestrator driving oversize sends/objectives through either northbound cannot self-correct; it gets a generic 503/`command_outcome_unknown`. Cross-cutting across the whole spill lane. | HIGH |
| 3 | **#111 / F3** generic premature-liveness nudge | A worker refused for analysis-only output is nudged "Continue the current turn." with no reason — it cannot learn it needs an in-scope diff, so the turn stalls/retries blind. A direct throughput tax on the delivery push. | MEDIUM |
| 4 | **#110 / F6** spill kind no horizon auth | The `spill` context-read kind ignores the resolve-then-authorize doctrine — any holder of a digest can materialize a spill regardless of run. Latent (unguessable digest) but a real doctrine/security asymmetry vs the `finding` kind. | MEDIUM |
| 5 | **#112** docs/discovery cluster | Every new MCP/CLI caller re-dives the source for wire grammars / soft-fail states / receipt shapes; the opaque `evidenceRef` schema produces generic `application_knowledge_seed_invalid` refusals that don't teach. A standing discoverability tax. | MEDIUM |
| 6 | **#111 / F4** doctor projection residual | The two-tier envelope is now derivable; only `refusalCode`/`gracefulPath` fields and the cap-relationship doc are missing. Low marginal AX cost. | LOW |
| 7 | **#110 / F5** residual `mintSpill`-absent guard | Latent misconfiguration guard on the reply/objective lanes; not reachable in any real coordinator (the send lane already guards). | LOW |

## Cross-cutting note — the NUL-byte defect (frame-economics F8) is still present

`application.mjs` and `coordination-store.mjs` each still carry **3 literal NUL bytes** as
delimiters in cache-key template literals: `application.mjs:619`
(`${board}\0${role}:…\0${boardFence}\0${projectionInputFence}`) and a **second** instance at
`coordination-store.mjs:16604` (`${repoId}\0${projectFence}\0…\0…`) — the original report cited only
`application.mjs:523`; the defect has since propagated to a second file. Verified by
`tr -cd '\000'` (3 in each) and located by `grep -anP "\x00"`. Effect: `file` reports the sources as
`data`, and plain `grep` silently misses matches in those files — exactly the trap that hit the
original reviewer mid-review. This is not one of #108–#112 (it was frame-economics F8, folded into
no filed issue) but it materially degrades the reliability of *every* agent grep over two of the
largest source files, so it should be stripped (one-line fix per file) on whichever lane next
touches either file — nominally the #110 spill contract (`coordination-store.mjs`) and the #109/#72
coaching work (`application.mjs`).

## The discipline fold (carries forward verbatim)

From the friction ledger (Appendix B, the #108-112 row): **surface suites must pin every documented
principal's path (not just `wave-owner`) and both transport levels (in-process + MCP/web), or the
lane is suite-green and surface-dead.** #108 and #109 are precisely the lanes that were
suite-green and surface-dead; the red rows that close them must exercise the `operator` principal
(not `wave-owner`) and assert the typed coaching survives on MCP *and* `/v1/commands`, not just the
in-process error.
