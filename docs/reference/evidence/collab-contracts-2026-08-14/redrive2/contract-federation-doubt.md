# CONTRACT — federation-doubt (package ⑤ collaboration) v1.0

[attempt: b5ea1fae-f410-442d-8cc2-f66154efc193 row-federation-doubt]

- **Row:** `row-federation-doubt` — issue set **#70** (cross-deployment knowledge federation,
  contract-only) + **#66** (the doubt lane) + **#192** (impact projection, advisory).
- **Verification HEAD:** `09200e97c1be113946459d901c8fab56034d8a1f` (this worktree's base). Every
  citation below was re-verified this session with `grep -an`/`sed -n` on `application.mjs` +
  `coordination-store.mjs` (NUL discipline — both files measure **3 NUL bytes** each this session;
  never read whole) and plain `grep -rn` elsewhere. Both seed red suites were **re-run at this
  HEAD** (commands and splits recorded in the acceptance section).
- **Form:** Ring-2 — ground truths → decisions → closed refusal vocabulary → red-first acceptance
  pins at named stages → open questions. No clocks anywhere. Sorted-key literals in ACTUAL byte
  order (never `localeCompare`).

## 0. What this contract is (and is not)

Two of the three issues already carry verdict-grade folded contracts with red suites at HEAD:
#70 (`docs/reference/evidence/cross-deployment-knowledge-2026-08-07/
cross-deployment-knowledge-contract.md` v1.2 + `impl/test/cross-deployment-knowledge-red.test.mjs`)
and #66 (`docs/reference/evidence/doubt-review-2026-08-12/doubt-review-contract.md` v1.1 +
`impl/test/doubt-review-red.test.mjs`). **This contract does not re-specify either.** It binds the
SEAM between them — which doubt records cross deployment roots, under whose authority, and with
what framing — and specifies #192 for the first time under the red-team's conditions (advisory,
DAG-derived, never an operator scalar, never a throttle). Where a seam rule would contradict a
folded decision, the folded decision wins and the contradiction is recorded here as a finding,
never silently resolved.

**Scope of the rung, in one sentence:** the project tier of the doubt surface federates exactly the
carried tier — a non-primary deployment's project doubt read serves the primary's `carried` records
as event-seq-anchored, `UNTRUSTED`-framed projections naming `{sourceRoot, epochLag}` while every
mint/resolve authority stays local-root; nothing about the impact projection is ever an input to
authority, ordering, or admission — it is a read.

## 1. Ground truths (code-verified at the verification HEAD, this session)

**GT1 — Zero federation surface in `impl/src`.** `grep -rn "primaryRoot" impl/src/` returns
nothing (the only matches in the whole tree are `impl/test/cross-deployment-knowledge-red.test.mjs`).
`grep -an "knowledge" impl/src/mcp-descriptor.mjs` returns nothing — the D4 descriptor field does
not exist. The channel-audit row already recorded this state
(`channel-audit-2026-08-13/audit-qa.md:92` — "zero `primaryRoot`/federation matches in `impl/src` →
the #70 project-tier-across-roots rung is contract-only"), and it still holds. The #70 suite is the
pinned contract for that gap (22 RED / 9 PIN; re-run split below).

**GT2 — Zero doubt-lane surface in `impl/src`.** `grep -an "doubt"` over the store shows the doubt
kind exists ONLY as scratchpad machinery: `SCRATCHPAD_KINDS` includes `'doubt'`
(`coordination-store.mjs:535`), the write validation accepts `{kind, question, context}`
(`:612`, `:645-650`), and the projections render it `model-authored`/`untrusted`
(`coordinator.mjs:399-400`, `application.mjs:754-756`). There is **no** `knowledge.doubt_*` event
kind (`grep -an "knowledge.doubt"` over `impl/src` returns nothing), no `resolveDoubt`, no
`knowledge.doubts` row, no `openDoubts` field, and no `view.open_doubts.*` / `doubt.resolution.bytes`
rows in `FRAME_LIMITS` (`grep` over `impl/src/limits.mjs` returns nothing). The settle ritual
selects `note`+`plan` only (`coordinator.mjs:12031`), scans the shared partition for `note` only
(`:12041-12043`), materializes on notes only (`:12049`), posts board candidacy for notes only
(`:12089`), and returns `candidatesAwaitingAdmission: elevatedNotes.length` (`:12098`); the wave
receipt folds the same four knowledge fields with no doubt field (`wave-driver.mjs:861-864`,
`:879-884`). The #66 suite is the pinned contract for this gap (30 RED / 5 PIN; re-run split
below).

**GT3 — The elevation/promotion machinery the doubt lane rides.** `elevateTaskScratchpad`
(`coordination-store.mjs:14356`) mints a `scratch.fact_posted` bridge only for `source.kind ===
'note'` (`:14441-14457`) and carries `scratchFactId: factPayload?.id ?? null` for everything else;
unselected rows disposition `not_elevated` with `reasonCode: steering ? 'orchestrator_skipped' :
'no_driver'` (`:14475-14489`). `_deriveKnowledgePromotion` (`:16049`) re-derives candidates from
scratch facts — a doubt has no bridge fact, so it cannot auto-candidate (structural, unchanged from
the #66 GT5). `sweepSettlementLeases` is at `:12618`; `settleWorkflowScratchpad` dispositions
`type_ineligible` for every non-note shared row (`:14546`).

**GT4 — The knowledge read lanes both contracts ride.** `run.knowledge.seed` dispatches at
`application.mjs:12658`; the MCP lane exposes `knowledge.recall` / `knowledge.horizon`
(`mcp-northbound.mjs:861-862`, tools at `:1187-1191`, `:2199-2204`). `coordinator.projectHorizon`
is at `coordinator.mjs:12273` and returns the plain HEAD shape (`edges, fenceTuple, nodes, repoId` —
the #70 suite's G1 pin). The store's read/recall verbs and their refusal codes
(`temporal_incoherence`, `knowledge_read_conflict`, `causal_recall_*`, `coordination_writer_busy`)
are pinned by the #70 suite's K-P1 row — re-verified green in this session's re-run.

**GT5 — The deployment identity seam federation rides.** `stableDeploymentId` reads/writes
`resident/deployment.json` as the exact closed `{schemaVersion, repoId, deploymentId}` triple
(`resident-authority.mjs:115-130`); the repoId mint rejects NUL-bearing repo paths in
`application-deployment.mjs` (`repositoryAuthority`, `:177-183` this session). These are the
coordinates the #70 projection's `sourceRoot` (the primary's `deploymentId`) derives from — no new
identity surface is needed for the seam.

**GT6 — The task DAG the impact projection derives from.** Tasks carry a closed `deps` field in the
task/goal-plan schemas (`coordination-store.mjs:2626-2631`) with digest-pinned dependency
resolution (`:2343`, `:2606`, `:2638`); task state is event-derived (`task.created` →
`task.transitioned`/`task.acceptance_revoked` set the status map in `_deriveKnowledgePromotion`'s
prefix walk, `:16056-16059` — the same event-derived pattern any projection must use). The
campaign-state tier is replay-derived from `wave.closed` records (`:8846-8847`, `:13364-13381`) and
the orchestrator briefing's closed top-level field set is frozen
(`BRIEFING_TOP_LEVEL_FIELDS`, `:515-518`). **There is no impact surface anywhere in `impl/src`**
(`grep -rln "impact" impl/src/` matches only the atlas CPG files — `atlas-cpg-delta.mjs` etc., the
phase-19 code-analysis delta surface, unrelated to portfolio impact).

**GT7 — The red-team conditions on #192 are already adjudicated campaign evidence.** The
pm-comparison merge ruled impact propagation **ADAPT — "wave-level portfolio projection only;
never a throttle"** (`pm-comparison-2026-08-13/pm-qa.md` §3 row D2; rubric §4: "only as projection
(never throttle — else Q8 ornament)") and the DAG row ruled it "**read-side advisory only,
structurally derived, never a focus-window driver** … downstream-blocked-count is structural
(event-derived), pm's operator-assigned `impact` scalar is not"
(`pm-comparison-2026-08-13/pm-dag.md` C2). pm's own landed code is the counter-example this
contract forbids: `next_phases` sorts by the operator-assigned bare `impact` number
(`pm-dag.md:30-31`, `:126-128`).

**GT8 — The `shared` publish lane is unreachable (the #158 posture).** `writeScratchpad` hardcodes
the worker scope (`const scope = \`worker:${fields.workerId}\`` at `coordination-store.mjs:14169`
and again at `:14366`); there is no shared-scope write verb. Same recorded refusal the
pm-comparison and contract-foundry coordinators made — the durable file is the publish.

## 2. Decisions

### D1 — The federation × doubt boundary: carried-only, one direction, local authority

The #66 doubt record family is deployment-local for every state EXCEPT `carried`. Composition
rules, each pinned:

- **(i) What federates:** exactly the `carried` tier. A `carried` doubt is project-persistent by
  the #66 D2 state machine, and project-persistent records are the #70 projection's payload class.
  `reviewed`/`answered`/`dismissed` are wave/run-scoped review states — they never cross roots.
  Consequently **no doubt resolution prose ever federates in v1** (a carried doubt is by
  definition unresolved; see OQ1).
- **(ii) Direction and authority:** mint and resolve authority stays **local-root**, always. The
  settle ritual on ANY deployment (primary or not) mints its own `knowledge.doubt_*` events for its
  own waves — the #70 D3 primary-only promotion law extends to the **project KG promotion paths**
  (`addKnowledgeNode` / `promoteKnowledgeNode` / `admitWorkflowFinding`), NOT to the doubt verbs.
  A non-primary root refusing to mint its own doubts would be an over-reach (and FD3 below pins
  that it must not happen). Resolving a doubt is likewise local: `knowledge.promote_doubt` on a
  record that resolves to a **projected** (primary-sourced) row refuses `knowledge_cross_root_denied`.
- **(iii) Read shape:** a non-primary deployment's project doubt read (`knowledge.doubts`,
  `waveId` absent) composes its OWN `reviewed`/`answered`/`dismissed` records with the primary's
  **projected `carried`** rows; every projected row carries `{sourceRoot, epochLag}` (the #70 D5
  vocabulary — `sourceRoot` = the primary's `deploymentId` from `resident/deployment.json`
  (GT5), `epochLag` = primary `ledgerHeadSeq − observedSeq`, both primary seqs, never wall time),
  renders under the #66/#79 frame family (`wrapProse` for the doubting worker's question/context,
  `provenance: 'model-authored', untrusted: true`), and appends **nothing** to the consumer's
  ledger (the #70 A6 law). A strict read composes with the #70 D5 postures verbatim:
  `knowledge_projection_stale` past the deployment-owned ceiling, `knowledge_primary_unreachable`
  for an unreadable/ahead-of-primary replay position.
- **(iv) Two primaries stay honest:** each self-declared primary's project doubt read names its OWN
  `sourceRoot` (mirrors the #70 S-R2 rule) — a reconciling reader can see the split; there is no
  merge, ever.

### D2 — The seam reuses both refusal families verbatim; zero new codes

This contract adds **no** refusal code. The seam's refusals are exactly:

- The #70 federation family (frozen, ACTUAL sorted order — the K-R1 constant):
  `knowledge_cross_root_denied`, `knowledge_primary_conflict`, `knowledge_primary_unreachable`,
  `knowledge_projection_stale`.
- The #66 doubt family (the 9-code `DOUBT_REFUSAL_CODES` constant, ACTUAL sorted order):
  `doubt_carry_conflict`, `doubt_dismissal_invalid`, `doubt_promote_conflict`,
  `doubt_promote_invalid`, `doubt_promote_not_authorized`, `doubt_promote_stale`,
  `doubt_promote_unknown`, `doubt_resolution_exceeded`, `doubt_surface_unavailable`.
- The seam's one new firing rule is a **reuse**: a resolve aimed at a projected doubt row fires
  `knowledge_cross_root_denied` (already in the federation family for exactly this
  cross-root-denial class — the #70 K-R2 row). Surface-constant, closed, typed.

### D3 — #192: the impact projection is a read, structurally derived, with a closed input

The impact projection is an **advisory read-side projection** over the task DAG (GT6): for each
open task, the structurally derived count of transitively downstream tasks blocked on it (deps +
event-derived task states — the GT6 derivation class), surfaced next to the campaign tier for the
orchestrator's portfolio view. Under the red-team conditions (GT7), pinned as laws, not preferences:

- **Never an operator scalar:** the surface's input schema contains NO numeric weight/rank/impact
  field. The only inputs are scope selectors (`runId?`/`waveId?`/`repoId`) and pagination. Any
  "impact" number in the output is computed, never assigned.
- **Never a throttle:** no admission, lease, claim, dispatch, or elevate path reads the projection.
  It gates nothing, orders nothing the hub executes, and its absence is behavior-neutral (a refusal
  from it can never block a wave — the #103 D9 advisory-window pattern is the precedent:
  `wave-driver.mjs:871-875`).
- **DAG-derived only:** the derivation touches task `deps` and event-derived task states — never
  effort fields, model policy, wall time, or prose.

**Landing zone — DECISION_REQUEST (see §5, DR-1).** My recommended option is (a) a new
embedded-only observe row (`run.impact`) on the application-semantics registry, because the
closed `BRIEFING_TOP_LEVEL_FIELDS` (GT6) forbids adding a field to the #103 briefing schema and a
new state-carrying surface would violate advisory-only. The pins in §4 (FD6a-c) are written
landing-zone-independent — they hold under any of DR-1's options.

### D4 — The composed seam's red suite is a NEW file; the folded splits stay untouched

Extending `cross-deployment-knowledge-red.test.mjs` or `doubt-review-red.test.mjs` with seam rows
would re-open their recorded two-run verified splits (the fold's own law). The seam pins go in a
new `impl/test/federation-doubt-red.test.mjs` with the same suite-law hygiene both seed suites
record (hermetic, mkdtemp, fixed-clock stores, sorted-key literals ACTUAL order, no
`localeCompare`, no NUL-whole-file reads of `application.mjs`/`coordination-store.mjs`). The two
seed suites remain the acceptance authority for #70 and #66 respectively; this suite owns only the
seam and the #192 red lines.

### D5 — No clocks, anywhere in the seam

`epochLag` is the #70 definition (primary `ledgerHeadSeq − observedSeq`, both primary seqs). Doubt
state is the latest event for the `doubtId` (#66 D2). The impact projection is event-derived (GT6).
Nothing in this contract introduces or requires a timer, TTL, or timestamp comparison.

## 3. Refusal vocabulary (closed)

The full closed set for the federation-doubt surface is the union of the two frozen families
(D2) — 13 codes, ACTUAL sorted order:

```
doubt_carry_conflict
doubt_dismissal_invalid
doubt_promote_conflict
doubt_promote_invalid
doubt_promote_not_authorized
doubt_promote_stale
doubt_promote_unknown
doubt_resolution_exceeded
doubt_surface_unavailable
knowledge_cross_root_denied
knowledge_primary_conflict
knowledge_primary_unreachable
knowledge_projection_stale
```

Plus the reused store-family codes both seed suites already pin verbatim (`temporal_incoherence`,
`knowledge_read_conflict`, `knowledge_recall_conflict`, `causal_recall_invalid`,
`causal_recall_oversize`, `coordination_writer_busy`, `descriptor_invalid`, `invalid_query`,
`application_command_unavailable`). Nothing else may fire on this surface; a new condition gets a
folded contract amendment, never an ad-hoc string.

## 4. Red-first acceptance pins (every pin RED at HEAD at a named stage)

### The seed rungs — re-verified this session at HEAD `09200e9`

- **P-70.** `node --test impl/test/cross-deployment-knowledge-red.test.mjs` →
  **tests 31 · pass 9 · fail 22 · cancelled 0 · skipped 0 · todo 0** (verbatim this session).
  The 22 RED rows fail at their named stages per the suite header; the 9 PIN rows stay green.
  Green only for a correct #70 impl.
- **P-66.** `node --test impl/test/doubt-review-red.test.mjs` →
  **tests 35 · pass 5 · fail 30 · cancelled 0 · skipped 0 · todo 0** (verbatim this session). The
  30 RED rows fail at their named stages; the 5 PIN rows (A2, G1-G4) stay green. Green only for a
  correct #66 impl. *(The row brief's "5/35 RED" reads as this split — 5 green of 35, i.e. 30 RED;
  judgment call J-2.)*

### The seam rung — new rows in `impl/test/federation-doubt-red.test.mjs` (D4)

Each row's first assertion is a behavior assertion, so it fails at the NAMED stage, never vacuously.
Fixtures reuse the seed suites' harness shapes (deployment roots with
`resident/deployment.json` + `state/coordination`, fixed-clock stores, the #63 candidate fixture
where a lease is needed).

- **FD1 — the projected carried tier (RED).** A primary holds a `carried` doubt (its wave's
  settlement lease revoked with the doubt `reviewed`); a non-primary replica declaring that primary
  reads the project doubt surface and is served the primary's carried record with
  `{sourceRoot: '<primary deploymentId>', epochLag: 0}`, question/context `UNTRUSTED`-framed, and
  the replica's `ledgerHeadSeq()` unchanged by the read. **Stage: `application_command_unavailable`
  — `knowledge.doubts` does not exist at HEAD** (GT2); the row stays RED through the #66 landing
  (local-only surface) until the seam composes.
- **FD2 — cross-root resolve refuses (RED).** `knowledge.promote_doubt` aimed at a doubtId that
  resolves to a projected row refuses `knowledge_cross_root_denied` — never a local mint on the
  replica, never a silent no-op. **Stage: `coordinator.resolveDoubt` missing (GT2); then, post-#66,
  the stage is the absence of the projected-row discriminator** until the seam lands.
- **FD3 — local authority survives federation (RED, discriminating).** A non-primary deployment
  mints `knowledge.doubt_raised` at its own settle ritual and resolves its OWN doubt normally —
  `knowledge_primary_conflict` must NOT fire on the doubt verbs (D1-ii; the #70 D3 refusal set is
  the promotion paths, pinned by that suite's A2-R1..R3, not the doubt verbs). **Stage: the ritual
  is note-only at HEAD (`coordinator.mjs:12031`) — RED with the whole #66 rung; this row's
  discriminating half (a wrong impl wiring the primary check onto the doubt verbs fails it) is
  unobservable until both contracts land — recorded, not hidden.**
- **FD4 — projection appends nothing (RED).** After FD1's read, the replica's event stream holds
  zero `knowledge.doubt_*` events and zero `knowledge.read`-class events for the projected rows;
  re-reading replays identically (replay-exact, the #70 R-R2 discipline). **Stage: no projection
  exists at HEAD (GT1) — the assertion on the empty stream is unreachable until FD1 composes.**
- **FD5 — two-primaries honesty (RED).** Two self-declared primaries each carry a distinct carried
  doubt; each one's project doubt read names its OWN `sourceRoot` (its resident `deploymentId`),
  `epochLag: 0`, and a reconciling reader can see the split — no merge, no cross-contamination of
  records. **Stage: no `sourceRoot`/`epochLag` vocabulary exists at HEAD (GT1).**
- **FD6 — the #192 red lines (RED, landing-zone-independent per D3).**
  - **FD6a (never an operator scalar):** the advisory surface's accepted input contains no numeric
    impact/weight/rank field — pinned by closed-schema discipline (an unknown numeric key refuses
    the schema, the A1-R2 pattern) AND by source-scan: zero occurrences in `impl/src` of an
    operator-assigned impact assignment into the projection. **Stage: the surface is absent at HEAD
    (GT6).**
  - **FD6b (never a throttle):** source-scan pin — no admission/lease/claim/dispatch/elevate path
    references the projection or its output (zero call-sites outside the read row and its tests);
    behavior pin — a refusal/failure of the projection never blocks or reorders a wave (advisory
    window, the `wave-driver.mjs:871-875` pattern). **Stage: absent at HEAD (GT6).**
  - **FD6c (DAG-derived):** with scope fixed, changing a task's `deps` changes the derived
    downstream-blocked counts; changing effort/model/prose fields does not; no timestamp input
    participates. **Stage: absent at HEAD (GT6).**
- **FD7 — vocabulary hygiene (RED).** The seam's refusal family constants exist frozen in ACTUAL
  sorted order (`coordinatorNs.DOUBT_REFUSAL_CODES`, `coordinatorNs.KNOWLEDGE_FEDERATION_REFUSAL_CODES`)
  and the union §3 is exactly what the surfaces can fire; `grep -rn "localeCompare" impl/src`
  stays empty. **Stage: the constants are absent at HEAD (GT1/GT2).**

**Shallow-greenability check (the verdict-grade law):** every FD row's first assertion is a
behavior assertion at a named stage; the seed suites' PIN rows (9 + 5) are the must-not-change
backbone and were green in this session's re-runs. An impl that lands #66 without the seam greens
P-66 and FD3's first half but leaves FD1/FD2/FD4/FD5 RED; an impl that lands #70 with a
primary-check over-reach greens P-70 but fails FD3; only the composed correct impl greens all.

## 5. DECISION_REQUEST

**DR-1 — the #192 landing zone (authority-class ambiguity, escalated with options).** The
pm-comparison rulings (GT7) leave the hosting surface open, and the two natural homes sit in
different contract domains: the campaign/wave tier is package ③'s surface (the lifecycle rows),
while this row holds #192. Options:

- **(a) RECOMMENDED — a new embedded-only observe row (`run.impact`) on the
  application-semantics registry** (the `board.claim`/`board.report` embedded-only precedent the
  #66 D3 row cites). Advisory-only by construction; the #103 briefing schema stays frozen; the
  read composes with the campaign tier without writing to it.
- **(b) A block on the `wave.closed` campaign-state record + a receipt fold** — closest to
  pm-qa's "wave-level portfolio projection" phrasing, but it makes an advisory read into durable
  state (a replay-derived record is fine; the risk is the receipt growing a field the lifecycle
  contract froze) and crosses into package ③'s boundary map.
- **(c) Defer the landing to the lifecycle wave** with only the §4 FD6 red-line pins held here.
  Honest about the boundary cost: #192 then has no acceptance row until package ③ contracts it.

This contract's #192 pins (FD6a-c) hold under all three; the DECISION_REQUEST settles only where
the green row lands. Until settled, (a) is the working assumption and is NOT pinned as green-anywhere.

## 6. Judgment calls (recorded)

- **J-1 — the foundry-brief frame mismatch.** `redrive2/foundry-brief.md` is the
  LIFECYCLE-CONTRACT frame: its row assignments name the `row-lc-*` rows (package ③) and do not
  name `row-federation-doubt`, though its header sentence names the COLLABORATION package (⑤). The
  wavefile, the row brief, and the Baton dispatch all name my deliverable unambiguously
  (`contract-federation-doubt.md`, this dir), and the brief's laws (attempt-echo, red-first,
  no clocks, NUL discipline, publish-or-refuse) are package-generic — so I proceeded on the row
  brief + wavefile and treated the laws as binding. Not escalated: the deliverable path is not
  ambiguous. Flagged for the coordinator's cross-check: the redrive2 seed copied a lifecycle
  foundry-brief into a collab wave dir.
- **J-2 — reading "5/35 RED".** The row brief's "doubt-review-red 5/35 RED" matches the suite's
  recorded split as *5 pass of 35 tests* (30 RED). My re-run at HEAD reproduces exactly that.
  Recorded rather than silently paraphrased.
- **J-3 — D1-ii (doubt minting stays local on non-primary roots) is a seam ruling, not a re-opened
  #70 decision.** The #70 D3 law covers the three promotion paths its suite pins by name; the doubt
  verbs are new surface owned by #66, and this contract assigns them local authority because their
  records are wave/run-scoped except the carried tier, which federates read-only. FD3 pins the
  boundary so a wrong impl cannot blur it either direction.
- **J-4 — v1 honesty on resolution prose.** No resolution text ever crosses a root in v1 (D1-i).
  A future "answer a carried doubt from the primary" surface is a named follow-up (OQ1), not a
  claim this contract makes.
- **J-5 — the shared publish (foundry law 3).** Publishing to `shared` is not executable from this
  session: the write seam hardcodes the worker scope (GT8, `coordination-store.mjs:14169`/`:14366`)
  and the #158 append verb is unlanded. The refusal is recorded here with fresh citations; this
  file is the durable artifact. (Same posture the pm-comparison coordinator recorded, `pm-qa.md`
  §1.)

## 7. Open questions

- **OQ1 — answering a carried doubt from the primary.** v1: carried doubts federate read-only; an
  answer surface for them would need a primary-side resolve authority + a projected-state refresh
  discipline (epochLag visibility for the resolving root). Named follow-up; not claimed here.
- **OQ2 — does the projected carried tier ride `knowledge.doubts` only, or also a wave-scoped
  read?** A `waveId`-named read is run-scoped (the #66 D3 gate) and waves do not cross roots, so
  the projected tier composes only with the project surface (`waveId` absent). Held as the honest
  split; re-open only if a cross-root wave surface ever lands (none is contracted).
- **OQ3 — strict-mode composition order.** When both `knowledge_projection_stale` and
  `knowledge_primary_unreachable` conditions hold, which fires first? Recommendation (not pinned):
  unreachable before stale — you cannot honestly judge the lag of a ledger you cannot read. The
  seed #70 suite's R-R3/K-R4 rows do not overlap the conditions, so the order is unpinned; the
  composed suite should pin it when the seam lands.
- **OQ4 — FD6's green home.** Settled by DR-1; recorded here so the fold record can point at the
  settling decision.

## 8. Fold-record-ready pin list (for the next fold)

| Pin | Rung | Stage (RED at HEAD `09200e9`) | Green when |
|---|---|---|---|
| P-70 | #70 suite as-is | 22 rows at their named stages (re-run this session) | #70 impl correct |
| P-66 | #66 suite as-is | 30 rows at their named stages (re-run this session) | #66 impl correct |
| FD1 | seam: projected carried tier | `application_command_unavailable` (no `knowledge.doubts`) | seam composes |
| FD2 | seam: cross-root resolve | `coordinator.resolveDoubt` missing → projected-row discriminator absent | seam composes |
| FD3 | seam: local mint authority | ritual note-only (`coordinator.mjs:12031`) | both landed, no primary-check over-reach |
| FD4 | seam: no consumer-ledger writes | no projection exists | seam composes |
| FD5 | seam: two-primaries honesty | no `sourceRoot`/`epochLag` vocabulary | seam composes |
| FD6a | #192 never-operator-scalar | surface absent (`impl/src` grep clean) | DR-1 settled + landed |
| FD6b | #192 never-throttle | surface absent | DR-1 settled + landed |
| FD6c | #192 DAG-derived | surface absent | DR-1 settled + landed |
| FD7 | vocabulary hygiene | constants absent | both families exported frozen, sorted |
