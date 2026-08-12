# AX findings #108–#112 — triage & disposition (2026-08-12)

The AX-review wave (2026-08-06, two deepseek reviewers on the Ring 2 landings) produced 19
frictions across two reports. Five were filed as issues **#108–#112**. This is their disposition
table: each restated against its receipt, checked against the current HEAD tree, assigned a lane,
and the survivors ranked by orchestrator-AX impact.

## Provenance & an honesty note on the issue bodies

`gh` is unauthenticated in this seat and `wahargis/baton` is **private** (the REST API returns
`404` for `GET /repos/wahargis/baton` and every issue). So the issue *bodies* could not be read
directly. Per the brief's law ("If a receipt file can't be found, say so and work from the issue
bodies + the friction ledger"), the **issue→finding map is reconstructed from the authoritative
landing commit** `c00acdd` (`docs: AX-review wave reports …` — the commit that landed the reports
and filed the five issues) and **Appendix B of the orchestrator friction ledger**
(`docs/reference/evidence/frontier-sweep-2026-08-03/orchestrator-friction-ledger.md:92`), then
cross-checked against the two AX-review report receipts:

- `docs/reference/evidence/ax-review-2026-08-06/workflow-surface-ax-report.md` (11 frictions)
- `docs/reference/evidence/ax-review-2026-08-06/frame-economics-ax-report.md` (F1–F8)

`c00acdd` names the mapping explicitly:

> workflow-surface: attention.watch silently dead for the documented MCP principal (HIGH, **#108**),
> the docs/discovery cluster (**#112**) · frame-economics: the coaching shape dropped by both
> northbound transports (**#109**), spill-lane doctrine violations (silent cap-void + no horizon
> auth — **#110**), the refusalPath contradiction + generic nudges + doctor/refusal disagreement
> (**#111**)

Every code claim below is cited to **file:line read at the current HEAD of this worktree** (the
2026-08-06 citations drifted ±40–250 lines as #10/#103/#132 etc. landed; content-grep, not the
stale line numbers, was used to re-pin). `application.mjs` / `coordination-store.mjs` carry literal
NUL bytes (the AX F8 finding), so `grep -an` was used for those two.

## The five findings

---

### #108 — attention.watch is silently dead for the documented MCP principal (HIGH)

**Restated.** `baton_run_attention_watch {runId, kind}` under the principal MCP.md documents
(`{userId:'operator', capabilities:['control','observe','approve','emergency_stop','settlement']}`,
`impl/MCP.md:28-30`) throws `attention_scope_forbidden`: the lane admits only `wave-owner` or a
live run-orchestrator lease (`impl/src/coordinator.mjs:7088-7092` → `_isReviewAuthority`
`impl/src/coordinator.mjs:7096-7108`; leases mint only in settlement, never at run/wave start), and
the MCP northbound catch converts the throw into a silent empty page
(`impl/src/mcp-northbound.mjs:1892-1894`) that rewinds the cursor to 0 regardless of the requested
cursor. An agent watches a completed member and forever sees "no news"; the report's WS-01 pin
passes only because its principal is literally named `wave-owner`.

**Current truth — PARTIALLY-FIXED.** A partial fix ("Decision 5's transport authority",
`impl/src/mcp-northbound.mjs:1887-1898`) landed since the filing: the catch now swallows the refusal
for **control-capable** principals (returns the empty page) and re-throws it for observe-only
principals — and observe-only refusals are now surfaced typed via the `stateFailureCode` allowlist
(`impl/src/mcp-northbound.mjs:257`). **But the defect as filed persists:** the documented operator
principal *is* control-capable, so it hits the catch and still pages empty — because the coordinator
still refuses it as review authority without a live lease (`impl/src/coordinator.mjs:7096-7108`), the
catch returns `{reasons:[]}` even when reasons exist. The cursor-rewind-to-0 sub-bug is byte-identical
(`impl/src/mcp-northbound.mjs:1894` hardcodes `afterCursor:0, throughCursor:0`; the requested cursor
read at `:1882` is ignored on the catch path). MCP.md still lists the tool (`impl/MCP.md:155`)
without disclosing the principal requirement or the silent-empty behavior. Net: the *failure mode*
changed (no raw refusal thrown to the documented principal) but the *observable* result — silent
"no news" + cursor rewind — did not.

**Disposition.** Fold into the **AX spine post-#10 (the waiting-on / attention-surface vocabulary)**.
This is the canonical "blocked vs working is indistinguishable" case the ledger's meta-lesson names;
`#71` (wake) is adjacent (the inbox itself is #71/#75, `impl/src/coordinator.mjs:7041`). The closer
has three prongs: (a) admit control-capable as review authority at the coordinator *or* have the MCP
catch page the real reasons instead of a stub; (b) echo the requested cursor, don't rewind to 0;
(c) disclose the principal requirement in MCP.md. The observe-only half is already done.

---

### #109 — the coaching shape is dropped by both northbound transports

**Restated.** Every frame-economics admission refusal carries `{code, cap, actual, unit,
gracefulPath}` (`impl/src/coordinator.mjs:318-323` `coachingError`;
`impl/src/application.mjs:240-244` `coachingApplicationError`; codes like `spill_body_exceeded`
`impl/src/limits.mjs:54`, `:86`). But web `dispatchFailure` maps every unmapped code to
`{code:'temporarily_unavailable', message:'command dispatch failed'}` (`impl/src/web-northbound.mjs:278`)
and MCP `stateFailureCode` maps it to `command_outcome_unknown` (`impl/src/mcp-northbound.mjs:278`) —
the cap/actual/unit/gracefulPath are stripped on the wire. Only in-process callers and the durable
`message.rejected` stream keep the numbers.

**Current truth — STILL-PRESENT.** Both transports grew large typed-refusal allowlists since
`f33c24e` (MCP: `application_*`/`worker_policy_*`/`run_orchestrator_*` prefixes + `workflow_*`
`impl/src/mcp-northbound.mjs:206-213`, `wave_*` `:218`, `message_budget_invalid` `:224`, the
capability/proposal/advisory/oracle/causal/reuse/board-admission families `:225-275`, `attention_*`
`:257`, `scratchpad_settlement_*` `:260-261`, `knowledge_*` `:265-266`; web mirrors in
`impl/src/web-northbound.mjs:182-277`). **But the frame-economics coaching codes are none of these:**
they are bare (`spill_body_exceeded`, `board_report_exceeded`, `decision_question_exceeded`,
`scratchpad_entry_exceeded`, … `impl/src/limits.mjs:54-71`), not `application_*`-prefixed, and absent
from every allowlist → they fall through to the generic mapping. The MCP dispatch feeds the bare
cause straight to `stateFailureCode` (`impl/src/mcp-northbound.mjs:1460-1463`); no facade re-wraps a
bare coaching code into `application_*`. B3 still covers the in-process error only.

**Disposition.** **Its own new contract** — "frame-economics coaching on the wire." Seed: add the
`FRAME_LIMITS` `refusalCode`s to both allowlists (or, more robustly, pass through any error carrying
`{cap, actual, unit, gracefulPath}`), plus a transport-level B3 golden over `/v1/commands` and the
MCP tool. The pattern is already established by **#132 D5** (`wave_member_invalid` typed on both
transports, `impl/src/web-northbound.mjs:267-277`).

---

### #110 — spill-lane doctrine violations (silent cap-void + no horizon auth)

**Restated (F5).** When `_coordination.mintSpill` is absent, the **send** lane throws
(`impl/src/coordinator.mjs:6862`, `:6866`) but the **reply** lane silently stores the FULL over-cap
body with no `spilled` flag (`impl/src/coordinator.mjs:12608-12621` → envelope at `:12637-12648`) and
the **objective** lane does the same (`impl/src/application.mjs:4502-4514`) — the 2048/4096-byte cap
is silently voided, unmarked. **Restated (F6).** The `spill` context-read kind resolves a spill by
global handle with no run-horizon check (`impl/src/coordinator.mjs:10800-10813`, validation of shape
only), so `materializeSpill` is a bare `this._spills.get(spillId)`
(`impl/src/coordination-store.mjs:13506-13510`) — any worker holding a digest materializes any run's
spill, contradicting the `finding` kind's resolve-then-authorize doctrine.

**Current truth — STILL-PRESENT (both).** F5: reply lane (`impl/src/coordinator.mjs:12608-12621`) and
objective lane (`impl/src/application.mjs:4502-4514`) still admit the full body unspilled when
`mintSpill` is absent; only the send lane throws (`impl/src/coordinator.mjs:6862`). F6:
`materializeSpill` (`impl/src/coordination-store.mjs:13506-13510`) is still a bare
`this._spills.get(spillId)` with no run-scope/possession check; the spill query kind
(`impl/src/coordinator.mjs:10805-10813`) validates only the handle shape.

**Disposition.** **Its own new contract** — "the spill-doctrine closer." Seed: F5 — throw
`coachingError` on the `mintSpill`-absent fallback in the reply and objective lanes (parity with the
send lane, ~3 lines each); F6 — scope `materializeSpill`/the spill query to the requesting run's
horizon, like the `finding` kind. Highest correctness+authority weight of the five (see ranking).

---

### #111 — refusalPath contradiction + generic nudges + doctor/refusal disagreement

**Restated (F1).** `refusalPath` is two-way — it picks the spill phrase for any graceful row
(`impl/src/limits.mjs:32-36`), so a body over the 1 MiB spill ceiling (which does NOT spill —
`impl/src/application.mjs:4499-4500` throws) is still told to "resend with a digest-citable head," an
unsupported input. **Restated (F3).** The `claim_premature_liveness` corrective nudge is the generic
`completionMessage` `'Continue the current turn.'` (`impl/src/wave-driver.mjs:37`, fired at `:425-427`
via `correctiveNudge`→`:385`), while the refusal reason is third-person driver guidance
(`impl/src/coordinator.mjs:2670-2677`) — the worker gets no liveness counts and no "you need an
in-scope diff." **Restated (F4).** The doctor projection shows the registry value (2048,
`impl/src/limits.mjs:54`) while the beyond-ceiling refusal cites `cap: 1048576` (the spill ceiling,
`impl/src/coordinator.mjs:6857`, `:6862`) — three numbers for one lane; the two-tier envelope
(≤2048 plain, 2048–1 MiB spilled, >1 MiB refused) isn't coherently projected.

**Current truth — STILL-PRESENT (all three).** F1: `refusalPath` still two-way
(`impl/src/limits.mjs:32-36`); beyond-ceiling still throws the spill-phrase message
(`impl/src/application.mjs:4500` via `composeFrameLimitRefusal` on the graceful `run.objective` row).
F3: `completionMessage` still `'Continue the current turn.'` (`impl/src/wave-driver.mjs:37`);
`claim_premature_liveness` still fires it (`impl/src/wave-driver.mjs:425-427`); reason still
third-person (`impl/src/coordinator.mjs:2670-2677`). F4: the registry-2048-vs-refusal-1048576
disagreement is unchanged; the precise doctor-projection row wasn't re-pinned in this pass (declined
to over-cite a drifted line), but the structural disagreement holds from the registry and refusal
sides.

**Disposition.** Split. **F4 folds into #72 (the prescriptive doctor)** — project each graceful
lane's *effective* admission ceiling (the `spill.body` value, `impl/src/limits.mjs:86`) per lane and
make the refusal `cap` agree with it. **F1 + F3 ride the frame-economics coaching contract** (with
#109): F1 is a three-way `refusalPath` (spill-admitted / beyond-ceiling "resend within N bytes" /
hard) plus a beyond-ceiling golden beside B3; F3 delivers sanitized `{liveness counts, reason: no
in-scope diff}` in the corrective nudge (or addresses the worker directly when it issued
`claim_turn`).

---

### #112 — the docs/discovery cluster (workflow-surface frictions #2–#11)

**Restated.** A cluster of agent-facing documentation/schema-discovery gaps: `knowledge_seed`
evidence items are opaque `{type:'object'}` on MCP (`impl/src/mcp-northbound.mjs:677`) while the
registry knows `evidenceRef.oneOf {coordinationSeq:int≥1}|{artifactId}`
(`impl/src/application-semantics.mjs:159-162`); the CLI wire grammars (`message:<64hex>`,
`scratchpad-entry:`, worker-scope) are undocumented and the refusal is the unteaching `'<label> is
invalid'` (`impl/src/application-cli.mjs:101`, `:105`); `run.message.send` soft-fail states
(`run_not_active`/`worker_not_active`) are undocumented; `board.read` truncates at 512 items / 256 KiB
with `boardViewTruncated` and **no cursor** (`impl/src/application.mjs:632`, `:670`, `:676`) so the
remainder is unreadable through any surfaced verb; the verified-Finding-requires-evidence rule is
code-only; and boards have **no MCP surface** (`impl/src/application-semantics.mjs:1296`, `:1339`
`surfaces:['embedded','cli']`, though `ALL_SURFACES` includes `'mcp'` at `:1153`).

**Current truth — STILL-PRESENT (all).** Every cited gap verified at HEAD above. "Story" comments
were added (`impl/src/application.mjs:70`, `:608` — "never silent"), but the cursor still isn't
exposed and the schema/docs still don't teach.

**Disposition.** Fold the doc/schema gaps into **#103 (the orchestrator briefing pack) / #104
(symbol-cited briefs)** — the fix is to make the agent-facing surface self-describing (carry
`evidenceRef.oneOf` into the MCP schema; add `message:<64hex>` / `scratchpad-entry:` examples and
soft-fail-state prose to CLI.md/MCP.md; document the verified-Finding-evidence rule). The
`board.read` cursor and boards-in-MCP are small surface decisions that could be a mini-contract or a
#132-style follow-up.

---

## Disposition table

| Issue | Finding (one line) | Current truth | Lane |
|---|---|---|---|
| **#108** | attention.watch pages empty for the documented control-capable principal; cursor rewinds to 0 | **PARTIALLY-FIXED** — observe-only refusal now typed (`mcp-northbound.mjs:257`); control-capable catch (`mcp-northbound.mjs:1887-1898`) still returns silent empty because coordinator still won't admit it (`coordinator.mjs:7096-7108`); cursor-0 rewind + MCP.md gap unchanged | **AX spine post-#10** (waiting-on/attention surface); #71 adjacent |
| **#109** | coaching `{cap,actual,unit,gracefulPath}` stripped to generic 503 / `command_outcome_unknown` on both transports | **STILL-PRESENT** — both allowlists grew but the bare coaching codes (`limits.mjs:54-71`) are absent (`web-northbound.mjs:278`, `mcp-northbound.mjs:278`) | **new contract** (frame-economics coaching on the wire; pattern from #132 D5) |
| **#110** | silent cap-void when `mintSpill` absent (F5); spill resolvable cross-run by digest (F6) | **STILL-PRESENT (both)** — reply `coordinator.mjs:12608-12621` + objective `application.mjs:4502-4514` store full body; `materializeSpill` `coordination-store.mjs:13506-13510` has no run-horizon check | **new contract** (spill-doctrine closer) |
| **#111** | refusalPath tells beyond-ceiling to spill (F1); claim nudge is generic (F3); doctor 2048 vs refusal 1048576 (F4) | **STILL-PRESENT (all)** — `limits.mjs:32-36` two-way; `wave-driver.mjs:37`/`:425-427` generic; registry/refusal cap disagree | **F4 → #72** (doctor); **F1+F3 → coaching contract** (with #109) |
| **#112** | docs/discovery cluster: opaque schemas, unteaching refusals, no board cursor, no boards-in-MCP | **STILL-PRESENT (all)** — `mcp-northbound.mjs:677`, `application-cli.mjs:101/105`, `application.mjs:670/676`, `application-semantics.mjs:1296/1339` | **#103 / #104** (briefing pack); board cursor + boards-in-MCP as mini-contract |

## Survivors ranked by orchestrator-AX impact

None of the five are closeable — all survive at HEAD. Ranked by impact on an orchestrating agent's
ability to *see state and self-correct* (the campaign's convergent diagnosis: the kernel learned to
work; the surfaces haven't learned to say what's happening):

1. **#110 — spill-lane doctrine.** The only one that is *correctness + authority*, not just
   visibility. F5 silently voids the 2048-byte admission cap (an unbounded reply/objective admitted
   whole, unmarked) whenever `mintSpill` is absent; F6 breaks run isolation (any worker holding a
   digest materializes any run's spill). Both are silent and doctrine-violating.
2. **#108 — attention.watch silent-empty.** The orchestrator's *primary* liveness signal returns
   empty for the principal the docs tell it to use — the direct cause of "blocked vs working is
   indistinguishable." A visibility defect (not correctness), but it sits at the root of the
   meta-lesson.
3. **#109 — coaching dropped on transports.** The orchestrator's *only* signal for an oversize
   refusal is a generic 503 / `command_outcome_unknown` on MCP and web — blind to cap/actual/
   gracefulPath, so it cannot self-correct without re-diving the source. High frequency; mitigated
   only in that same-process callers still see the numbers.
4. **#111 — refusalPath + nudge + doctor.** Coaching-*message* quality. The beyond-ceiling refusal
   actively misdirects (tells the agent to do an unsupported spill); the claim nudge is generic.
   Confusing and wasteful, but not correctness-breaking.
5. **#112 — docs/discovery cluster.** Documentation/schema gaps. Lowest per-incident severity but
   *highest frequency* — every docs-first caller re-derives or hits an unteaching refusal. The
   long-tail friction behind #103/#104.

## Receipts read

- `docs/reference/evidence/ax-review-2026-08-06/workflow-surface-ax-report.md`
- `docs/reference/evidence/ax-review-2026-08-06/frame-economics-ax-report.md`
- `docs/reference/evidence/ax-review-2026-08-06/ax-review-receipt.json`
- `docs/reference/evidence/frontier-sweep-2026-08-03/orchestrator-friction-ledger.md` (Appendix B, `:92`)
- `git show c00acdd` (the issue→finding mapping — the AX-review wave's landing commit)
