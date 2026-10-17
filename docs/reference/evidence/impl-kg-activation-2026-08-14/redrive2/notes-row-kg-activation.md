# NOTES — row-kg-activation (impl-kg-activation-2026-08-14, redrive2)

[attempt: 50e5a38f-3f45-4a1c-9ff8-1d079ce53c14 row-kg-activation]

Deliverable: verification + per-pin audit of the KG-activation READ path (KG-A1..A5), acceptance
`impl/test/kg-activation-red.test.mjs` — **GREEN 6/6 at this redrive's HEAD** (see JC-1: the brief's
"RED at HEAD" describes the pre-impl base, not this tree). The implementation is present in the
tree as commit `3c9f33d4` (wave-a's landed impl, "implement KG activation v1"); it is an ancestor
of this HEAD. This redrive makes **no source edits**: the impl already satisfies every pin, the
suite is unedited, and the working tree is clean (`git status` empty). Churn on NUL-bearing
machinery buys nothing (the lsp-pool redrive's DR-1 option (b) warning, applied).

## Measured counts (all runs from the repo root)

Acceptance suite `impl/test/kg-activation-red.test.mjs` (6 tests: KG-A1, KG-A2, KG-A3, KG-A4,
KG-A5, KG-A3/A4 wave surfacing):

| Run | tests | pass | fail |
|---|---|---|---|
| run 1 | 6 | 6 | 0 |
| run 2 | 6 | 6 | 0 |
| run 3 | 6 | 6 | 0 |

- **KG-A1..KG-A5 green at their named stages.** All five pins + the wave-surfacing ergonomics
  test pass. Stability verified across three consecutive runs (deterministic fixtures, fixed
  clocks, MockAdapter briefs — no live providers).

Named adjacents (the two the brief allows RED-by-design — **named, not absorbed**):

| Suite | pass | fail | status at this HEAD |
|---|---|---|---|
| `impl/test/cross-deployment-knowledge-red.test.mjs` | 9 | 22 | RED-by-design — 22 capability rows absent from this tree (its own header: "Every capability row below is RED at HEAD"). PIN rows 9/9 green. Unchanged by this row. |
| `impl/test/orchestrator-plan-object-red.test.mjs` | 5 | 42 | RED-by-design — 42 red rows, the #161 fold unlanded (its own header: 42 red + 5 pins). PIN rows 5/5 green. Unchanged by this row. |

`coordinator` suite (the brief's green-unchanged gate):

| Suite | tests | pass | fail |
|---|---|---|---|
| `impl/test/coordinator.test.mjs` | 57 | 57 | 0 |

## Implementation audit (green earned by impl, never suite edits)

- **KG-A1 — ambient serving.** `buildKnowledgeSlice` (`impl/src/messages.mjs:737`) is pure and
  deterministic given the recalled nodes and a fixed `now`: filters expired-validity nodes at
  serve time (rule 5, `validTo <= at` drops — suite asserts `finding:expired` never serves),
  bounds by BOTH count and byte caps (`FRAME_LIMITS['view.knowledge_slice.items']=8`,
  `['view.knowledge_slice.bytes']=2048`, `impl/src/limits.mjs:106-107`), wraps every item
  `{provenance:'knowledge', untrusted:true}` with `ref`, `groundingDigest` (sha256), and validity
  dates, and reports `honestEmpty:true` for an empty graph (`truncated:false`). Byte-cap-binds-
  independently is honored (`maxFindings:100, maxBytes:600` → <20 items, `truncated:true`).
  `renderBrief` (`impl/src/adapter.mjs:155-169`) is the serving seam: a `brief.knowledge` slice
  renders `## Ambient knowledge` with per-item grounding ref + validity window and an honest
  `(none — ...)` marker for the empty slice; a brief with no `knowledge` renders no section
  (back-compatible, no fabrication). `Coordinator.serveKnowledge` (`impl/src/coordinator.mjs:
  11031`) recalls keyword-matched Findings via `queryKnowledge` (a pure read — no
  `knowledge.read` event, no assessment feed; verified `readsBefore == readsAfter`), and serves
  the same bounded slice; an objective with no match is honest-empty.
- **KG-A2 — first-class candidacy queue.** `knowledgeCandidateQueue` (`impl/src/coordination-
  store.mjs:17229`) is a live derivation over the store's candidate Findings (never stored twice):
  source kind mapped via `KNOWLEDGE_CANDIDATE_TRIGGERS` (board.item_closed→board_close,
  package.admitted→package_admit, scratch.cited_observed→scratchpad_settle,
  verified_task_outcome→verification), each row `{id, type, source, ageMs, groundingDigest}`,
  stable minting order (observedSeq), bounded ≤ 16. Admit removes exactly that candidate: an
  admitted finding gets a `DerivedFrom` edge from a `workflow.admitted` node, which the queue's
  `admittedIds` set excludes; the removed id is recorded in `admittedIds` (never double-counted).
  Two reads of the same projection are id-identical (no cross-view duplicates).
- **KG-A3 — ritual hooks.** `knowledgeRitual` (`impl/src/coordination-store.mjs:17267`) returns
  `{candidates, admittedThisRun}` where zero is surfaced as `0`, never a missing field
  (a zero-candidate store deep-equals `{candidates:0, admittedThisRun:0}`). `admittedThisRun` is
  run-scoped (counts `knowledge.workflow_admitted` events with `payload.runId === runId`).
  Wave close receipt: `impl/src/wave-driver.mjs:863-889` folds the member knowledge blocks into
  `knowledge:{candidates, admittedThisRun, candidatesAwaitingAdmission, settlementRunId}`; the
  KG-A3/A4 surfacing test asserts the receipt carries the block and a zero-candidate wave
  surfaces `0` (via the driver's `?? 0` defaults).
- **KG-A4 — horizon digests.** `workflowHorizon` carries `knowledgeDigest`
  (`impl/src/coordinator.mjs:12267`) = `knowledgeContentDigest()` (`impl/src/coordination-
  store.mjs:17214`), a content-addressed sha256 over the live knowledge graph (nodes+edges,
  canonical-sorted). Cache-correct: the fence-tuple cache recomputes on a fence miss, but the
  digest is byte-identical when knowledge content is unchanged (suite: `_bumpDecisionSettleCount`
  and a repeated read both leave `d1 == d0`); admitting a finding mints a new verified Finding +
  DerivedFrom edge → digest moves (`d2 != d0`). Wave member rows carry `knowledgeDigest`
  (`impl/src/wave.mjs:353,366`).
- **KG-A5 — gate honesty.** Source-scan: the active-lease binding + all five refusal codes
  (`workflow_admit_invalid|lease_invalid|conflict|oversize|ineligible`) are present unchanged in
  the store gate (`impl/src/coordination-store.mjs:16390`); exactly ONE store definition and
  exactly ONE coordinator call expression (the wrapper at `impl/src/coordinator.mjs:11946`, which
  calls the gate once). No other `impl/src/*.mjs` surface references `admitWorkflowFinding`
  (source-scan over the src dir — zero offenders). Runtime refusal rows: bad actor →
  `workflow_admit_invalid`, digest-mismatched lease → `workflow_admit_lease_invalid`,
  non-candidate → `workflow_admit_ineligible`; same-key retry replays (`replayed:true`, never
  re-mints); a second differently-keyed admit of an admitted candidate is refused ineligible.
  **There is no auto-admit call site** — the orchestrator-admit gate is the only promotion path.

## Hard bounds audit

- **No new commands, no registry entries, no MCP/CLI/web surfaces.** The pre-existing impl adds
  projections (`knowledgeCandidateQueue`, `knowledgeRitual`, `knowledgeContentDigest`,
  `buildKnowledgeSlice`, `serveKnowledge`, horizon/wave fields) and brief serving only. Grep over
  the store for knowledge-adjacent `registry|MCP|CLI_WEB|application_command|cli_` touchpoints:
  nothing but a doc comment (`coordination-store.mjs:11691`). No new event kinds minted by the
  read path (`serveKnowledge` is a pure `queryKnowledge` read — no `knowledge.read` event).
- **NUL discipline.** `impl/src/coordination-store.mjs` carries NUL bytes (17432 `\x00` per
  `grep -c`, 3 per `od -c`); this redrive touched neither source file (`git diff --stat`
  empty; `git status` clean), so the bytes are byte-identical to HEAD.
- **Never edited the acceptance suite.** `git diff HEAD -- impl/test/kg-activation-red.test.mjs`
  is empty; the suite is the unmodified `3c9f33d4` original.

## Judgment calls (recorded)

1. **JC-1 — the brief's "RED at HEAD" is stale for this redrive; the suite is GREEN at dispatch.**
   `impl/test/kg-activation-red.test.mjs` passes 6/6 at this HEAD because the impl landed as
   commit `3c9f33d4` (ancestor of HEAD). The row's work is therefore verification + the
   deliverable, not a fresh implementation. I did NOT fabricate a red→green narrative or force
   churn onto correct machinery; the honest record is "already implemented, verified green,
   unchanged by this redrive."
2. **JC-2 — redrive path discrepancy.** The wavefile/wave-b put the row report at
   `impl-kg-activation-2026-08-14/redrive1/notes-row-kg-activation.md`; this dispatch's binding
   constraint puts the work partition at `.../redrive2/**` (the lsp-pool redrive2 precedent:
   report at `redrive2/notes-row-lsp-pool.md`). I wrote this deliverable to
   `redrive2/notes-row-kg-activation.md` per the binding constraint + convention. If the
   dispatching wavefile harvests at a different path, that is a coordinator/baton-harness
   question, not an implementation one. (Authority-class note only; no DECISION_REQUEST needed —
   the acceptance is met and no authority is moved.)
3. **JC-3 — no source edit this redrive.** The five pins are met by the existing impl; any edit
   would be cosmetic churn on NUL-bearing shared machinery (coordination-store.mjs is also shared
   with the plan-object wave this window). Additive-disjoint hunk discipline is trivially
   satisfied by writing zero hunks.

## Hermetic discipline

All suites use CoordinationStore/Coordinator fixtures, MockAdapter briefs, fixed clocks, no live
providers, no network. The wave-surfacing test creates a real temp git repo + one MockAdapter
member under `createWave` (deterministic, cleaned up in `test.after`). No real provider is
contacted.

## Verification / deployment command

- Reviewer execution contract: executable `true`, argv `[]`, cwd `.`, expected exit 0 —
  verified: `true` → exit 0.
- Acceptance: `node --test impl/test/kg-activation-red.test.mjs` → 6/6 green (×3).
- Named adjacents RED-by-design (not absorbed): cross-deployment 9/31, orchestrator-plan-object
  5/47. Coordinator suite 57/57.
