CONTRACT-QA v1
[attempt: b5ea1fae-f410-442d-8cc2-f66154efc193 coordinator]

Coordinator cross-check of the wave-b-rd2 contract rows (package ⑤ collaboration), per the
coordinator brief's four-part duty: citation audit, shallow-greenability, refusal vocabulary,
cross-contract coherence. Verification HEAD `09200e97c1be113946459d901c8fab56034d8a1f` (every
row worktree inspected sits on this exact base — re-verified with `git rev-parse` per
worktree). All code anchors below were re-checked by THIS session with `sed -n`/`grep -an`
against the row worktrees; both seed red suites were re-run by this session; the live
coordination store was scanned. No clocks: every timestamp cited is copied verbatim from a
durable store event, never from this session's wall time.

## 0. The brief-vs-wave mismatch (found before any verdict — judgment call QA-J1)

The `coordinator-brief.md` in THIS directory is a stale copy from the lifecycle wave: it is
**byte-identical** to `lifecycle-contracts-2026-08-14/redrive3/coordinator-brief.md`
(diff-verified this session) and names the package-③ rows (`row-lc-fs`/`row-lc-launch`/
`row-lc-members`/`row-lc-ledger` → `contract-filesystem/launch/members/ledger.md`). The
foundry-brief's headline was patched to "COLLABORATION package (⑤)" but its row-assignment
list was left as the lifecycle rows (diff shows the headline line is the ONLY difference from
the lifecycle foundry-brief). None of the four `contract-{filesystem,launch,members,ledger}.md`
files exists in any worktree or committed branch of this repo — the lifecycle rows live in a
different evidence tree (`lifecycle-contracts-2026-08-14/redrive3/`, a separate wave with its
own coordinator). The authority stack that IS unambiguous — this wave's
`collab-contracts.wavefile` (member list + report paths), the four `row-*.md` briefs, and the
harvest gates (`contract-member-lanes.md`, `contract-knowledge-activation.md`,
`contract-context-lanes.md`, `contract-federation-doubt.md`, each mustContain "contract") —
names MY four contracts as the package-⑤ rows. QA proceeded on the wavefile set; the mismatch
is escalated as QA-DR-1 (§6). One row (federation-doubt) independently flagged the same defect
(its J-1) — the rows were not confused by it.

## 1. Settlement verification (the #174 law: verify on disk; silence is not death)

Swept all sibling worktrees `../../wt/ws-*/` and every `baton/ws-*` branch, plus the live
coordination store. Settlement state at the time of this QA (store seq 101013):

| Row | Deliverable | On disk at | State |
|---|---|---|---|
| row-member-lanes | `contract-member-lanes.md` | `ws-9adb0b142ecc668b4a072e5922b4ea76` | settled (31,727 bytes) |
| row-context-lanes | `contract-context-lanes.md` | `ws-afcb59361bc59da5299f532390905ff0` | settled (28,998 bytes) |
| row-federation-doubt | `contract-federation-doubt.md` | `ws-6dd7db40dd0e2a471e991759d15bd13e` | settled (29,462 bytes) |
| row-knowledge-activation | `contract-knowledge-activation.md` | — | **FAILED** — see §4 |

The `signalOnMembersDone` message had not been delivered to this seat when this QA was
written; per the #174 law the coordinator verified on disk directly instead of waiting on the
signal (the exact discipline member-lanes GT-9 incident (ii) proves necessary). Each settled
contract carries its `[attempt: b5ea1fae-f410-442d-8cc2-f66154efc193 <role>]` line verbatim in
its first five lines (the #171 attempt-echo law — verified in all three).

## 2. Per-contract audits

### 2a. contract-member-lanes.md — VERDICT: **sound**

**Citation spot-check record (25 anchors checked, 0 wrong).** GT-1:
`application.mjs:12651` pre-gate dispatch (verified — the eight-verb direct-port block
`:12644-12660`); `_normalizeMessageSend` closed key set + exactly-one-target + 5-kind enum at
`:12968-12976`; body-cap refusal `:12982-12984`; `_authorize` + delegate `:13178-13190`;
definitions table `:170-213` with the byte-stability comment `:211-213`. GT-2: the four-table
`COMMAND_CAPABILITY` composition `web-northbound.mjs:95-104`; `WAVE_WEB_ENTRIES :37-55`
carries `waves_*` + `run_scratchpad_append` only; `grep run_message_send web-northbound.mjs`
→ 0 matches (verified — the absence claim is exact); refusal line `:530`; registry surfaces
`['embedded','mcp','cli']` at `application-semantics.mjs:1672` and the 3-kind enum `:1676`.
GT-3: `CLI_WEB_COMMANDS` `application-cli.mjs:29-31`; parser `:1538-1545` (3-kind CLI check);
`replaceAll('.', '_')` + `POST /v1/commands` `:2125-2131`; `cli_transport_failed` `:2034`.
GT-5: `from: 'orchestrator'` hardcoded at BOTH `coordinator.mjs:7237` (in-memory) and `:7246`
(durable `message.sent` row) — the misattribution claim is exact; the reply-lane counter-
example carries `from: workerId, actor: workerId` at `:13191-13196`; `recordMessage` closed to
the two kinds at `coordination-store.mjs:13789-13792`. GT-6: facade 5-kind
`application.mjs:12973` vs lane 5-kind `coordinator.mjs:7162` vs registry/MCP 3-kind —
verified divergence. GT-7: `claude-session.mjs:1132-1141` (one-live-request admission,
`<worker>:decision:<seq>` id); the `decision.requested` case `coordinator.mjs:13297+` with
askedEvent `:13374`, `input_required` transition `:13395`; `decision.settled` `:13406-13416`;
delivered disposition `:10403`; defer steering-trail-only `workflow-interpreter.mjs:859-862`.
GT-8: **independently reproduced** — this session's scan of the live store finds 0 top-level
`decision.*` kinds (regex `^{"schemaVersion":1,"seq":…,"kind":"decision` → 0 matches); the
nested `payload.kind` hits confirmed as envelopes. GT-9: `_attentionReasons = []` at
`coordinator.mjs:1227`; `_mintMemberTerminal :7471+`; `waves.progress` paged 16 at
`application.mjs:11802-11838`; `forbidden` seam `web-northbound.mjs:969-976`.

**Shallow-greenability.** Every RED pin fails at a NAMED, code-anchored stage this QA
re-verified as absent at HEAD: ML-A1/A2 (no `run_message_send` anywhere in the web admission
tables — my grep), ML-A4 (the two `'orchestrator'` literals), ML-A5 (no member admission
exists for the refusal to fire — red by absence, honestly labeled), ML-A6 (the verified
3-vs-5 kind divergence), ML-B1-B3 (0 durable decision kinds over the whole live store),
ML-C1 (attention reasons volatile), ML-C2 (observe verbs not member-admitted). The GREEN
substrate pins (ML-A3 MCP arm, ML-B4 additive law, ML-B5 store idempotency, ML-C3 bounded
projection) are the must-not-change backbone — a fold that greens the RED rows by regressing
these fails. ML-A4's agreement clause (in-memory row ≡ durable row) kills a one-sided fix.
Sound.

**Refusal vocabulary.** Zero new codes; every listed code re-verified at its cited seam.
Closed, typed, surface-constant.

### 2b. contract-context-lanes.md — VERDICT: **sound**

**Citation spot-check record (28 anchors checked, 0 wrong).** GT-1:
`mintContextPack :13317`; `BRIEFING_FAMILY :520`; orchestrator-only refusal `:13321-13324`;
stale predecessor `:13302-13305`; idempotent/conflict pair `:13328-13339`;
`recordContextRead :13595-13606` with `context_read_conflict`. GT-2:
`_admitContextPackCitations coordinator.mjs:3796-3812` (invalid/stale at spawn);
`_providerBrief :3814`; `UNTRUSTED_CONTEXT_PACK` frame verbatim `:3840`;
`recovery_refinement_conflict` digest-pin `coordination-store.mjs:3038-3044`. GT-3: attention
attach `:3856-3867`; "delivered means COMPOSED" `:3865-3880`; the `swf:` id pattern `:3982`
(the `ctxinj:` derivation precedent); serving guard `:4117-4160`; bounds `limits.mjs:86`
(`spill.body` 1 MiB, `spill_body_exceeded`) and `:103-104` (items 8 / bytes 4096) — all three
rows verified byte-for-byte. GT-4: derived kinds and the closed guard set verified; the RED
basis **reproduced by grep this session**: `context_injection` → 0/0/0 across
coordinator/application/coordination-store; `'pack'` in coordinator.mjs → 0; `ctxinj` →
0/0/0. GT-5: the eight direct ports `application.mjs:12644-12660`; `context.briefing`
dispatch `:12731` and `_briefing.mint :12736`; `resolveBriefing :12909-12922` (no `_authorize`
call — the DR-3 posture finding verified); `CONTEXT_READ` grammar `claude-session.mjs:31-32`;
closing refusal `context_read_invalid` at `coordinator.mjs:11333`;
`application_command_unavailable` at `application.mjs:1848-1849`. GT-6: member
`{role, route, scope}` shape `application.mjs:1537-1544`; `wave_scope_invalid` glob law
`wave.mjs:65-87`. GT-7: the env scrubber regexes `runtime-isolation.mjs:7-9` (GITHUB_ and
GIT_CONFIG dropped), `HOME` rewrite `:74`, credential projection `:117/:133`; **live repro
reproduced in this seat**: `gh auth status` → "not logged into any GitHub hosts";
`environment.md:76-82` exists as cited.

**Shallow-greenability.** Each pin carries a named stage plus an explicit shallow-green
guard (PIN-1 rehydration arm kills in-memory-only derivation; PIN-2's store-state assertion
kills mint-then-refuse; PIN-4's digest arm kills brief-splicing; PIN-8's sibling-arm kills an
unscoped read). The RED basis is verified absence, not assertion. Sound.

**Refusal vocabulary.** Exactly 2 new codes (`context_injection_invalid`,
`context_injection_scope_forbidden`), each minted at ONE named seam, each with a closed
firing condition; all reused codes verified at their cited seams. Closed, typed,
surface-constant.

### 2c. contract-federation-doubt.md — VERDICT: **sound**

**Citation spot-check record (22 anchors + 2 suite re-runs, 0 wrong).** GT1: `grep
primaryRoot impl/src` → 0 (reproduced; only the #70 red test file matches tree-wide);
`mcp-descriptor.mjs` no `knowledge`; `audit-qa.md:92` quote present verbatim. GT2:
`SCRATCHPAD_KINDS` with `'doubt'` at `coordination-store.mjs:535`; `{kind, question, context}`
validation `:612`/`:645-650`; doubt projections `coordinator.mjs:399-400` and
`application.mjs:754-756`; the note+plan-only settle selection `coordinator.mjs:12031`;
note-only scan `:12041-12043`; materialize `:12049`; candidacy `:12089`;
`candidatesAwaitingAdmission :12098`; the receipt's four knowledge fields
`wave-driver.mjs:861-864` (verified — no doubt field). GT3: `elevateTaskScratchpad :14356`;
note-only fact bridge `:14441-14457`; `scratchFactId ?? null :14475-14489`;
`_deriveKnowledgePromotion :16049`; `sweepSettlementLeases :12618`; `type_ineligible`
reasonCode `:14546`. GT4: `run.knowledge.seed` dispatch `application.mjs:12658`; MCP lanes
`mcp-northbound.mjs:861-862`/`:1187-1191`/`:2199-2204`; `projectHorizon coordinator.mjs:12273`.
GT5: `stableDeploymentId` closed triple `resident-authority.mjs:115-130`; NUL-bearing repo
path rejection `application-deployment.mjs:177-183`. GT6: closed `deps` field
`coordination-store.mjs:2626-2631`; event-derived task states `:16056-16059`;
`wave.closed` replay fold `:8846-8847`; `BRIEFING_TOP_LEVEL_FIELDS :515-518`; no portfolio
`impact` surface (`grep impact impl/src` → atlas files only, verified). GT7: pm-qa D2/§4 and
pm-dag C2 + `:30-31`/`:126-128` (operator-scalar `impact` sort) — all present as quoted. GT8:
the worker-scope hardcode at `coordination-store.mjs:14169` AND `:14366` — both verified (the
double citation is correct; there are two sites).

**Seed-suite re-runs (this session, at the same HEAD):** 
`node --test impl/test/cross-deployment-knowledge-red.test.mjs` → tests 31 · pass 9 ·
**fail 22**; `node --test impl/test/doubt-review-red.test.mjs` → tests 35 · pass 5 ·
**fail 30**. Both match the contract's recorded splits EXACTLY (P-70, P-66, and J-2's
reading of "5/35" as 5-pass-of-35). The NUL-discipline claim also reproduces: both files
measure exactly 3 NUL bytes.

**Shallow-greenability.** The FD rows stage on verified absences (`knowledge.doubts`
missing, no `sourceRoot`/`epochLag`, constants absent) and the contract's own composed-impl
analysis (greens P-66 alone leaves FD1/2/4/5 red; a #70 over-reach fails FD3) is coherent
with the anchors this QA checked. FD3's honest labeling — its discriminating half is
unobservable until both seed contracts land — is recorded, not hidden. Sound.

**Refusal vocabulary.** Zero new codes; the union list (13) is correctly the ACTUAL-sorted
merge of the two frozen families; the one new firing rule reuses an existing code.

### 2d. contract-knowledge-activation.md — VERDICT: **not deliverable — row failed** (§4)

No contract exists to audit. This is NOT a silence-death declaration (the #174 law); it is a
positive store-evidence failure record.

## 3. Cross-contract boundary map (coherence)

The three settled contracts compose one package surface (member ⇄ coordinator ⇄ knowledge
lanes). Boundaries as written, verified against each contract's own scope declarations:

- **member-lanes ⊗ federation-doubt — CLEAN DELEGATION.** member-lanes §0 explicitly does
  not spec the doubt lane ("`row-federation-doubt` binds it"); federation-doubt contracts the
  seam and credits #66's state machine. No overlap; no gap: #66's surface is owned exactly
  once.
- **member-lanes ⊗ context-lanes — AGREED SEMANTIC SEPARATION.** Both draw the same line:
  a WAKING correction is the message lane's `steer` (member-lanes D4 keeps the member kind
  set at `{inform, query, steer}`; context-lanes JC-3 keeps inject no-wake, "deliver content
  ≠ wake the turn"). The two pins cannot contradict: a fold that makes inject wake a member
  fails context-lanes PIN-3(a) without touching member-lanes.
- **context-lanes ⊗ federation-doubt — DISJOINT READ SURFACES.** The knowledge read lanes
  (`knowledge.recall`/`knowledge.horizon`, federation GT4) and the worker context read lane
  (`CONTEXT_READ`, context-lanes GT5) share no verb, kind, or refusal code. No conflict.
- **SHARED SUBSTRATE, NAMED, BENIGN OVERLAP.** Both member-lanes (D6a `member.terminal`
  durability) and context-lanes (D1 derived attention item) ride the attention/push
  machinery — different structures (`_attentionReasons` vs `_derivePendingAttentionItems`),
  no shared vocabulary. The overlap is real but additive; a fold touching both should land
  them against the same `limits.mjs` rows, which both already cite identically (verified).
- **PARALLEL AUTHORITY WIDENING — CONSISTENCY REQUIREMENT (the one coherence risk).**
  member-lanes D6b/ML-C2 widens member observe (`waves.list`/`waves.progress`, ESCALATED —
  its §7 DECISION_REQUEST) and context-lanes D6 widens worker pack reads (worker-own-scope,
  un-escalated). Both widen member read authority in the same wave. They are not in conflict
  (different surfaces, different scope predicates), but the two grants should be settled
  under ONE authority posture; if the operator answers member-lanes' escalation
  "operator-only," context-lanes D6's pack read needs a second look at the same seam.
  Recorded as the cross-contract note for the fold.
- **CROSS-PACKAGE GAP (correctly deferred, named here).** context-lanes D6(c) and
  federation-doubt GT2/GT7 both lean on the #194 model-visible-means-logged doctrine and
  explicitly do not re-specify it — it belongs to the lifecycle package (③). On disk, the
  lifecycle wave's own `contract-ledger.md` does not exist in any worktree (its other three
  contracts + its QA do, under `lifecycle-contracts-2026-08-14/redrive3/`). The #194
  invariant is therefore currently contracted NOWHERE. Not this wave's defect to fix;
  recorded so the gap is visible at fold time.
- **PUBLISH REFUSALS — COHERENT.** All three rows recorded the same `shared`-publish refusal
  with the same root cause (worker-scope write hardcode, `coordination-store.mjs:14169`/
  `:14366` — this QA verified both sites), each with fresh citations. No contradiction.

## 4. row-knowledge-activation — failure record (cited store evidence, no clocks)

- Task `baton-bffe7740e9580c4e7fcd627f-work` created by the wave-b-rd2 dispatch
  (`task.created`, store seq 96620, ts `2026-08-14T13:34:11.068Z`, objective carrying
  `[attempt: b5ea1fae-… row-knowledge-activation]`).
- Claimed by worker `w-423` (`task.claimed`, seq 96621, harness glm).
- Transitioned `working → failed` (`task.transitioned`, seq 98718, ts
  `2026-08-14T13:44:43.399Z`, idempotencyKey `task.failed:…:provider_result:98717`, evidence
  `lifecycle.turn_completed` workerSeq 123).
- No re-dispatch of this row exists in the store as of seq 101013; no
  `contract-knowledge-activation.md` exists in any sibling worktree or branch; the wave has
  not closed (no `wave.closed` for `wave:4863b423…`). Silence-since-failure is not being read
  as death — the row may still be re-driven by the orchestrator; this QA records the state it
  found and does not gate on a rescue.
- Consequence: the wavefile's harvest gate
  `contract-knowledge-activation.md mustContain "contract"` is unsatisfiable at the time of
  this QA. Escalated as QA-DR-2 (§6).

## 5. Judgment calls (recorded)

- **QA-J1** — proceeded on the wavefile's row set over the stale coordinator-brief's
  (§0). The wavefile + row briefs + harvest gates are mutually consistent and name this
  QA's own report path; the brief's laws (attempt-echo, red-first, no clocks, NUL
  discipline, publish-or-refuse) are package-generic and were applied throughout.
- **QA-J2** — audited each settled contract against ITS OWN verification HEAD claims but
  only after `git rev-parse` confirmed every row worktree sits on `09200e9…` (all do), so
  anchor line numbers are comparable across worktrees.
- **QA-J3** — the spot-check bar (≥3 anchors/contract) was exceeded ~7-9× per contract
  because the anchor density is the contracts' load-bearing property; both seed suites were
  re-run rather than trusted, and the live-store and grep-absence claims were independently
  reproduced before being credited.
- **QA-J4** — no fold instruction set is issued for the three sound contracts: each carries
  its own fold-record-ready pin table (verified present and stage-named in all three). The
  only fold-blocking instruction this QA issues is QA-DR-2's re-drive/descope decision for
  the failed row.

## 6. DECISION_REQUEST escalations (authority-class, with options)

**QA-DR-1 — which brief is authoritative for THIS wave's coordinator (the §0 mismatch).**
Options: (a) **RECOMMENDED** — the wavefile/row-brief/harvest set governs; accept this QA's
scope and amend `redrive2/coordinator-brief.md` + the foundry-brief's row-assignment list in
a doc fold so future re-drives don't inherit the lifecycle text; (b) re-issue a corrected
coordinator brief and re-drive the coordinator seat against it; (c) treat the mismatch as a
wave-defect and void this QA. Whatever the answer, this QA's per-contract audits are
row-brief-scoped and stand on their own evidence.

**QA-DR-2 — the failed knowledge-activation row.** Options: (a) **RECOMMENDED** — re-drive
`row-knowledge-activation` (the wave is not closed; its harvest gate cannot pass without the
file); (b) descope the row's harvest gate and record the issue set as uncovered in this
wave; (c) fold the row's issue set into a follow-up wave and close this one three-quarters
settled with this QA as the record. Recommended because the failure was provider-level
(`provider_result` after one completed turn), not a contract-form defect.

## 7. Publish record

The store-side `shared` publish is refused for this seat by the same code the rows cited
(worker-scope write hardcode `coordination-store.mjs:14169`/`:14366`, re-verified this
session; no shared-scope write verb exists — the #158 gap). Following the filesystem
convention the lifecycle wave's rows established (`lifecycle-contracts-…/redrive3/shared/`),
this QA is published to `docs/reference/evidence/collab-contracts-2026-08-14/redrive2/shared/
coordinator-contract-qa-published.md` — a verbatim copy of this file. The durable artifact of
record is this file itself.

## 8. Addendum — checkpoint continuation (second verification round)

Written at the wavefile's `nudgeOnCheckpoint`. Two increments, neither changing a verdict:

**(a) knowledge-activation re-check.** `contract-knowledge-activation.md` is still absent
from every sibling worktree; the store's trailing window (through seq 101448, latest event
`2026-08-14T14:43:58.487Z`) contains no new `task.created`/`task.claimed` for the row and no
re-drive of task `baton-bffe7740e9580c4e7fcd627f-work` beyond the §4 failure record. QA-DR-2
stands unchanged: the row is failed-without-re-drive, not dead-by-silence.

**(b) second-round citation audit — 20 further anchors, 0 wrong.** The first pass sampled
each contract's load-bearing anchors; this round closed the remainder. member-lanes:
`mcp-northbound.mjs:113` (`baton_run_message_send: ['control','observe']`), `:692-703` (tool
def, 3-kind enum), `:1262-1270` (`invalid_message_send`), `:1987-1993` (the ML-A3 dispatch
arm); `coordinator.mjs:13092-13102` (`message_target_not_member` — the reply-lane law D3
reuses); `limits.mjs:54-55` (the `spill_body_exceeded` pair);
`application.mjs:12966-12968` (`_normalizeMessageSend` head), `:13439`
(`application_worker_not_found`), `:12710-12712` (`_refuseCoordinatorAuthority` — also the
posture context-lanes D4 cites), `:13212-13217` (receipt resolve). context-lanes:
`coordinator.mjs:3906` (`_gateVerdictItemForWorker`), `:4028-4042` (`_mintAttentionSpill`),
`:4044-4076` (`_pendingAttentionPush` cap wiring), `:4099-4112` (`_attentionReceipt` —
`delivered`=composed, respawn shows `read: null`), `:11316-11331` (the `spill` CONTEXT_READ
arm PIN-5 rides, `context_not_found` on unknown), `:3540`/`:5831` (spawn/recovery compose
through `_providerBrief`); `coordination-store.mjs:13539` (`mintSpill`);
`application.mjs:12946-12955` (`mintCampaignBriefingInternal` — DR-2's precedent);
`claude-session.mjs:1471-1480` (DECISION_ANSWER delivery, pending-request cleared).
federation-doubt: `coordination-store.mjs:2343`/`:2606`/`:2638` (digest-pinned dependency
resolution) and `:13364-13381` (the `wave.closed` closed-8-key-shape replay fold — GT6's
campaign-state tier).

Cumulative audit standing after both rounds: ~95 code anchors verified across the three
settled contracts, 0 wrong citations; 2 seed suites re-run with exact split reproduction; all
grep-absence and live-store claims independently reproduced; the NUL-discipline claim (3 NUL
bytes per file) reproduced in this seat. Verdicts in §2 unchanged: member-lanes **sound**,
context-lanes **sound**, federation-doubt **sound**, knowledge-activation **not deliverable**
(§4, escalated QA-DR-2).

---
*Evidence trail: row worktrees `ws-9adb0b14…` (member-lanes), `ws-afcb5936…`
(context-lanes), `ws-6dd7db40…` (federation-doubt), all at `09200e97c1be113946459d901c8fab56034d8a1f`;
live coordination store `.git/baton/application-v3/state/coordination/events.jsonl`
(seqs 96617-101448); lifecycle-wave comparison tree
`lifecycle-contracts-2026-08-14/redrive3/`; suite re-runs and grep reproductions as recorded
per contract above.*
