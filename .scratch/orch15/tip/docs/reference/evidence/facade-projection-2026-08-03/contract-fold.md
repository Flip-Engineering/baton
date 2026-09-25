# Fold summary: facade-projection contract v2.0 → v2.1 (2026-08-04)

Authority: `contract-redteam.md` (verdict **NOT FOLD-READY, 7 blockers**). Target:
`facade-projection-contract.md`. Every anchor cited below was re-verified with `grep -an` +
`sed -n` (NUL-safe discipline for `coordinator.mjs`, `application.mjs`,
`coordination-store.mjs`) TWICE against the live 2026-08-04 worktree — post-`0eae749`,
post-`5fb3425`, WITH uncommitted in-flight readiness work that moved
`coordination-store.mjs` (~+206 below `:13652`) and `coordinator.mjs` (~+36..+41) during the
fold; the tree was re-checked until two consecutive passes agreed. Diff: 507 insertions,
197 deletions; 145 distinct line anchors added or re-anchored across ~80 amended lines.

## Blocker → change map

### Blocker 1 — the elevation lane misread (Decision 7 / ground truth 9 / FP-10 / WS-01) — FOLDED

Truth verified: `coordination-store.mjs:13833` — `const selected = steering ?
[...fields.entryIds].sort(...) : [];` (gate + comment `:13822-13832`). A non-steering run
settles with `no_driver` dispositions (`:13900`), a reaped partition, and
`{ok: true, result: 'settled', elevated: []}` (`:13913-13919`).

- Ground truth 9 rewritten: the landed distinction is "steering-registered runs honor the
  selection at any time; all other runs discard it always" — not "terminal vs mid-flight".
- Decision 7 gains **The steering-registered precondition**: the truth is projected VERBATIM
  with an honesty note (no invented refusal — refusal constancy is Decision 1's law, and the
  lane's receipt is honest), and the CEREMONY is named: steering registers once at genuine run
  creation when `run.start` carries `driverKind` (`application.mjs:4424-4433`, key
  `run.steering_registered:<runId>`); `waves.start` members get `driverKind: 'wave'`
  (`wave.mjs:203`). **Kernel amendment considered and rejected**: the red-team confirms none is
  required; the amendment would rewrite landed lane semantics for every existing caller (the
  #33 suites pin them) for zero acceptance gain; the ceremony makes the projected path honest
  for the workflows the rung serves. Recorded against OQ-8 (reframed).
- FP-10 pins `elevated ≥ 1` on a steering-registered run; WS-01 asserts it live.

### Blocker 2 — the elevation retry law staged-wrong (Decision 7 / FP-10) — FOLDED

Truth verified: store dedup is fence-bound (`reapKey =
scratchpad.partition_reaped:<runId>:<taskId>:<expectedScratchpadFence>`, `:13786`); the
wrapper re-derives the fence live (`coordinator.mjs:10305`); the wrapper's
`scratchpad.task_settlement:<taskId>` key (`:10307`) is never consulted (the store validates
`auth.actor`, never reads `auth.key`; the reap event is keyed by `reapKey`, `:13902-13910`);
every reap bumps the fence (`:8264`, `:8306`; replay `:8330`).

- Decision 7 gains **The retry law, fence-bound** with the row shapes: exact wrapper retry →
  `{ok: true, result: 'empty', reapEventSeq: null, dispositionDigest: null, elevated: []}`
  (`:13812-13815`) — the honest never-double-elevate posture; store-direct same-fence replay →
  `idempotent` with the prior receipt (`:13799-13805`); conflict requires a DIFFERENT payload
  under the same fence-pinned key (`:13793-13797`) — store-direct only, unreachable through
  the wrapper, exactly as `scratchpad-33-red.test.mjs:600-604` drives it.
- FP-10 rewritten accordingly (wrapper retry → `empty`; idempotent/conflict pinned separately
  as store-direct postures; the ordering row — elevate before the
  `releaseTerminalTaskResources` auto-settle, `coordinator.mjs:1886`, reached from
  `application.mjs:8685`).
- Refusal vocabulary marks `scratchpad_settlement_conflict` store-direct-only.

### Blocker 3 — wrong evidence codes + incomplete wire mapping (Decision 9 / Decision 10 / FP-13) — FOLDED

Truth verified: stale/future `coordinationSeq` → `temporal_incoherence` (`:15391`); unknown
`artifactId` → `missing_evidence` (`:15393`); `invalid_evidence` covers only malformed refs
(`:15387`, `:15394`); `_knowledgeFailure` passes codes through (`:15367-15369`); the
verified-requires-evidence rule is Finding-specific (`:15414`).

- Ground truth 12 rewritten (19 types at `:141`; the three-code vocabulary named exactly;
  fresh-add return has no `result` field, `:15874-15875`).
- Decision 9: the Finding-scoped rule mirrored identically; the defense-in-depth listings
  named (`invalid_evidence`, `reserved_knowledge_field`, `missing_endpoint`,
  `knowledge_node_conflict`/`duplicate_node`); `result: 'added'` recorded as a Decision 1
  envelope completion.
- Decision 10's `stateFailureCode` amendment re-enumerated against the live mapping
  (`mcp-northbound.mjs:187-240`, read in full): attention ×3, scratchpad ×6
  (`scratchpad_cursor_stale` deliberately excluded — CAS not projected), knowledge ×8
  (`temporal_incoherence`, `missing_evidence`, `invalid_evidence`, `causal_orphan`,
  `missing_endpoint`, `duplicate_node`, `knowledge_node_conflict`, `reserved_knowledge_field`).
- FP-13 pins the true codes; FP-15 drives both to the wire AS THEMSELVES.

### Blocker 4 — the MCP path unsatisfiable as written (Decision 5 / Decision 10 / Decision 13 / FP-14 / FP-15 / WS-01 / WS-02) — FOLDED

Truth verified live: `mcpApplicationToolNames()` = 27, `mcpCombinedToolNames()` = 78, no
`baton_board_*` on the default surface (executed 2026-08-04); boards are also lease-gated
(`board_lease_required`, `:14144`; `sessionAuthority` from `principal.sessionAuthority ??
 null`, `mcp-northbound.mjs:1808-1810`; descriptor principal shape `{userId, sessionId,
capabilities, repoIds}`, `mcp-descriptor.mjs:185-189`). Attention admits only `wave-owner` or
a run-orchestrator lease (`coordinator.mjs:6774-6793`); `wave-owner` appears nowhere else in
`impl/src` (grep-verified); the default principal is observe-only.

- Decision 5 gains **Transport authority**: the embedded model (self-named `wave-owner`), the
  MCP precondition (descriptor `principal.userId` = the orchestrator id, or a run-orchestrator
  lease), the bare-deployment-scope narrowing recorded as a non-projection.
- Decision 10 gains the **Who may drive what** table (per-lane descriptor
  capability/principal preconditions: `control` for send/elevate/seed, `observe` for reads,
  orchestrator-named principal for attention, `approve` for `baton_decision_answer` `:90`,
  combined+lease for boards); the board carve-out rewritten (deferral STANDS on the red-team
  verdict — the text was fold-blocking, not the posture) with the lease ceremony named
  (settlement lease via `baton_knowledge_settlement_lease`, `:104`, presented as
  `sessionAuthority`); the **#93 discovery note** answering the fold question: this rung
  RIDES the combined reality — six ordinary tools take the default surface 27→33, a partial
  answer; #93's default-visibility fix stays with the packaging epic; nothing changes
  `surface` selection (`mcp-northbound.mjs:1085-1086`).
- Decision 13 steps 1/7: board steps facade/CLI-pinned, no "MCP equivalent" claims; step 5
  re-anchored (`:512-523`, `:90`).
- FP-14 pins the capability preconditions; FP-15 pins the orchestrator-named descriptor row;
  WS-01's "or talks MCP" disjunction scoped; WS-02's board steps facade-explicit.

### Blocker 5 — the scratchpad read page has no serialized budget (Decision 6 / Decision 12 / FP-09) — FOLDED

Budget chosen: **256 KiB serialized**, mirroring the board view's `MAX_BOARD_VIEW_BYTES`
(`application.mjs:60`) — rationale: 64 maximal leaves are 64 × 4,096 = 256 KiB before ids,
kinds, fences, and envelope, at or over the MCP frame (`maxMessageBytes: 256 KiB`,
`mcp-descriptor.mjs:197-198`), so per-item/leaf bounds without a serialized total are not a
bound; reusing the existing ceiling invents no new number. Oversize behavior: the renderer
doctrine (`coordinator.mjs:10496-10499`) — stop before the budget, `truncated: true`, a
digest-citation of the full id set, `nextCursor` continuing at the first unrendered entry.
Disclosed as a SURFACE bound, not a lane cap: Decision 12 gains the cap-table row and the
reworded honesty sentence ("No new LANE caps; TWO disclosed SURFACE caps"); FP-09 pins it.

### Blocker 6 — WS-01 gameable via the public `driver` field (Decision 13 / WS-01 / Non-goals) — FOLDED (assertion) + DEFERRED (field closure)

Truth verified: `this.driver = options.driver;` is a PUBLIC field (`application.mjs:2326`) —
`application.driver.coordination` / `.coordinator` is a zero-import kernel reach;
`BatonDeployment`'s `#application`/`#driver` are private
(`application-deployment.mjs:1215`, `:1223`).

- Decision 13's static assertion now bans: static AND dynamic (`import()` path-string grep,
  pinned) kernel imports AND `.driver`/`.coordinator`/`.coordination` member access in the
  orchestrating script. WS-01 carries the same.
- **Deferred, per the fold directive**: closing the public field is a composition-law change
  bigger than this rung — FILED AS A SEPARATE ISSUE (to be opened by the operator; the
  contract's Non-goals and Decision 13 record the disposition). The rung pins the assertion
  that catches the reach and is deliberately not widened.

### Blocker 7 — citation hygiene (5 wrong-at-authoring anchors + re-verification) — FOLDED

1. `KNOWLEDGE_NODE_TYPES` is 19 types — fixed in ground truth 12 (`:141`).
2. The demo import is `impl/demo.mjs:14` — fixed in the operator's-law paragraph, Decision 13,
   and the fold note.
3. `mcp-descriptor.mjs:47-48` carries no settlement logic (`resolveCredentialRef`; the string
   "settlement" is absent from the file — grep-verified) — ground truth 15 now cites the real
   enforcement (`CAPABILITY` `['settlement']`, `mcp-northbound.mjs:104`, via `_authority`) and
   `impl/MCP.md:97-105`.
4. Decision 8's replay-envelope citation pointed at the fresh-post branch — corrected: the
   seam's replay derivation is `:14221-14226`; `postBoardItem`'s own replay return
   (`:14266-14267`) carries no `boardRunBinding`; the fresh-post envelope is `:14259-14262`.
5. `impl/MCP.md:83-89` → `:74-82` for the `waves.attach` resume prose (Decision 13 step 8).

Plus: every citation in every v2.1-amended section re-verified twice against the moving tree
(145 distinct anchors touched). The `0eae749`/readiness drift in unamended sections is
frame-noted in the header, per the red-team's §1.2 exoneration.

## Required amendments (red-team §8, non-blocking) — all folded

- **Decision 1 carve-out** (projected-domain + envelope completions): added verbatim, listing
  the `messageId` echo (D4), `nextCursor`/`truncated` (D6), replay `boardRunBinding` (D8),
  `result: 'added'` (D9), and the two recorded subtractions (D5 deployment scope, D9
  `Decision`).
- **Decision 8 appendGate**: the facade passes an `appendGate` re-validating binding +
  run-open at append time (the S-2 no-check-then-write-window law, `:14084-14087`;
  `postBoardItem(fields, auth, appendGate, boardAdmission)`, `:14265`; the seam's own gate
  `:14236-14241`); FP-11 gains the race row; the replay `boardRunBinding` derivation is
  specified; the run-closed accessor named (the store's public `snapshot()`, delegated at
  `coordinator.mjs:752-756`).
- **FP-03**: the refusing stub refuses `runId === R` AND `runId === null`.
- **Decision 11**: legacy `baton run send` coexistence sentence (`application-cli.mjs:
  1514-1530`; registry `:809`/`:871`/`:1274`) + the unwired `run.scratchpad` row
  acknowledgment (`application-semantics.mjs:1330-1340`).
- **Decision 12**: "no new LANE caps; TWO disclosed SURFACE caps" rewording.
- **`missing_endpoint`**: de-listed to defense-in-depth (Decision 9).
- **Decision 4 note (b)**: the `messageRunId` accessor's dead-handle behavior pinned
  (resolve-to-null ≡ forbidden; FP-05 carries the row); D4 re-anchored (`:6709-6710`,
  `:6717-6723`).
- **OQ-8**: reframed per blocker 1.

## Rejected / deferred

- **Kernel amendment for ordinary-path selection honor** (blocker 1 alternative): REJECTED
  for this rung — reasons in Decision 7; recorded as OQ-8's question.
- **An `application_*` refusal for non-steering elevation** (red-team option c): REJECTED —
  a facade refusal the lane lacks is a Decision 1 violation; the verbatim `elevated: []` +
  `no_driver` receipt plus the ceremony plus the `elevated ≥ 1` pins is the honest minimum.
- **Closing `BatonApplication.driver`** (blocker 6): DEFERRED to a separate issue — the
  composition-law hole is bigger than this rung; the assertion pins the reach now.
- **Board deferral to the packaging epic** (blocker 4): STANDS per the red-team verdict —
  only the acceptance text was fold-blocking.
- **#93 default-visibility fix**: NOT this rung — it rides the combined reality (27→33 is
  its partial answer); the fix choice stays with the packaging epic.

## Verification

- Anchors: two full `grep -an`/`sed -n` passes over `coordination-store.mjs`,
  `coordinator.mjs`, `application.mjs` (NUL-safe), plus `mcp-northbound.mjs`,
  `mcp-descriptor.mjs`, `application-deployment.mjs`, `application-cli.mjs`,
  `application-semantics.mjs`, `wave.mjs`, `demo.mjs`, `MCP.md`, and
  `scratchpad-33-red.test.mjs`; the second pass confirmed the first after the tree stopped
  moving.
- Live counts executed: `mcpApplicationToolNames()` = 27, `mcpCombinedToolNames()` = 78, zero
  `baton_board_*` on the application surface (node, 2026-08-04).
- `stateFailureCode` (`mcp-northbound.mjs:187-240`) read in full; the amendment list contains
  every unmapped lane code the rung's lanes can throw.
- No code files were modified; only `facade-projection-contract.md` (v2.1) and this summary.
