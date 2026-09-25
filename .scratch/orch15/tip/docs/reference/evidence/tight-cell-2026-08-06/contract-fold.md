# Fold summary — tight-cell contract v1.0 → v1.1 (red-team fold)

Date: 2026-08-06
Authority: `contract-redteam.md` (verdict NOT FOLD-READY — 9 blockers, 7 major, 2 minor)
Edit target: `tight-cell-contract.md` (now v1.1)
Method: every load-bearing anchor re-verified this session with NUL-safe `grep -an` /
`sed -n` against the working tree before being written into v1.1 (the red team's anchor
discipline confirmed — no fabrications found; two anchor addresses corrected, see "cosmetics"
below). No implementation files were modified.

## Blocker → change map

### Blocker 1 [D6, MAJOR] — quorum has no substrate → FOLDED

- New ground truth 13: the run-view builders (`application.mjs:7393-7430`,
  `_historicalProfileView` `application.mjs:5680-5700`) derive phase/terminal/result/
  terminalCause from `projection.nodes[0]` only — verified at 7393 (`const node =
  projection.nodes[0]`) and 5680.
- Decision 6 rewritten: **"The substrate amendment — named as kernel work"** — the run-status
  builder is amended to aggregate over ALL plan nodes. The derivation is exact:
  - cell members = the run's task set per runId (same predicate as `runWorkerOwnership`
    `application.mjs:2269-2284` and `runTaskIds` `coordinator.mjs:11063`), one member per
    plan node `cell:<waveRole>:<index>`;
  - per-member state = today's single-node logic applied per node;
  - `survived` ∈ work-rest `{completed, result_ready}` only; `lost` = every terminal
    non-survivor with receipted cause; `live` = non-terminal.
- Terminal law: ok terminal ⟺ `survived >= quorum` (completed at `== size`, degraded below);
  failed ONLY when below-quorum-terminal (`lost > size - quorum`, minted at the tip event);
  `group.strict` + any loss → `cell_exact_breach`; otherwise waits on events.
- `wave-driver.mjs:535` for a cell member reads the aggregate, never `nodes[0]`.
- D6's surface list now includes `application.mjs:7393-7430` and `5680-5700`.
- New red row TC-20 ("worker#1 terminal does not settle the cell"); TC-11/TC-12 oracles now
  name the aggregate.

### Blocker 2 [D6+D1, MAJOR] — `group.exact === true` self-contradiction → FOLDED

- ONE representation chosen (the recommended nested closed object, no boolean overloading):
  `group: {editing?, quorum?, seat, size, strict?}` — `seat` is the closed route object
  `{harness, model, effort}` and ONLY that; the exact-size discipline is the separate boolean
  `group.strict` (default `false`; `strict: true` with `quorum < size` refuses
  `wave_group_invalid`).
- Every reference rewritten: D1 shape + vocabulary (`wave_group_seat_missing` replaces
  `wave_group_exact_missing`), D6 terminal law, TC-13 (`group.strict: true`), D8 table,
  non-goals. OQ1 marked RESOLVED.

### Blocker 3 [D7, MAJOR] — collective-result provenance → FOLDED

- Ground truth 11 rewritten: "shared across the run's workers" was false — the run result is
  the FIRST worker's capture (`application.mjs:7393-7404`, verified: `workerId` at 7395,
  `coordinator.result(workerId)` at 7403), and per-task worktrees
  (`coordinator.mjs:3573`, verified) give N divergent trees.
- Decision 7 rewritten as the **designated-collector law** (option (a), per recommendation):
  member index 0 (`cell:<waveRole>:0`) harvests; siblings' captures are checkpoint-only and
  receipted in the cell receipt (`cell.captures: [{workerId, taskId, captureDigest}]`,
  sorted by member index). Rationale recorded: a merge authority would be new kernel
  machinery with a conflict story; the collector law reuses the existing capture /
  result-section / adoption seams.
- Collector-lost-but-quorum-held edge pinned: `resultSha: null`, receipt digests are the
  provenance, and the EXISTING operator adoption seam (`application.mjs:956-960`, handler
  5045; projected per nodeKey at 7414) is the recovery lane.
- TC-15 rewritten to fail the shallow behavior: distinct per-worker content; `resultSha`
  must equal the collector's digest; the receipt must carry all `size` digests; `degraded`
  names covered survivors.

### Blocker 4 [D2, MAJOR] — spawn mechanism unpinned → FOLDED

- Decision 2 rewritten: a NEW named **cell branch** of the run-start plan mint — composition
  is explicitly NOT reused (it drags the role catalog / `attempts` / strategy/workspace/join /
  v3 workflow record `application.mjs:4551-4583` and the `workflowNodeBudget` division
  `4487-4489`, all forsworn). Verified: nodeFields map at 4481-4491, record mint at
  4551-4583, budget helper at 1586.
- Missing intake seam added to the surface: run-start intent normalization
  (`application.mjs:1399-1462`, allowed keys at 1399-1404 — verified) admits a new closed
  `cell` intent field.
- Per-node rules pinned: keys `cell:<waveRole>:<index>` (0-based), SAME objective on every
  node, identical `routes: exactPlanRoutes(group.seat)`, NO workflow record, NO budget
  division (cell nodes funded as single-node runs).
- TC-04 extended: pins node keys, identical routes/objective, and the ABSENCE of any
  workflow record / role catalog / attempts / budget division. OQ2 marked RESOLVED.

### Blocker 5 [D4, MAJOR] — grant-mint idempotency collision + broadcast composition → FOLDED

- Ground truth 15 added: `_boardGrantMints` is raw-caller-key indexed
  (`coordination-store.mjs:8755-8768` replay, `14992-14995` check, `14979-14984` effective
  key — all verified).
- Decision 4 pins **per-member grant keys**: caller key `<sendKey>:<workerId>` per mint, the
  worker-op lane's own namespacing idiom (`<op>:<grantDigest>:<callerKey>`,
  `coordination-store.mjs:14795`, idiom comment 14734 — verified). Replay semantics preserved
  verbatim (same member + same key replays; changed content for the same member refuses
  `board_replay_conflict`).
- Broadcast composition pinned (option: one body, N blocks): `size` `[BOARD_GRANT]` blocks
  labeled by workerId ride the ONE C5 broadcast; foreign grant material is inert because
  every board lane rebinds coordinates (`boardGrantPage` `15037-15062`; mint proof
  `14949-14951`) — stated as the intent.
- TC-08 kept; new TC-22 pins the key derivation.

### Blocker 6 [D5, MAJOR] — reply collapse + silent guarantee loss → FOLDED

- Ground truth 14 added: one reply slot per message (`coordinator.mjs:12467-12470`,
  `parent.reply = replyEnvelope` at 12511, `from: workerId` at 12508-12511 — verified).
- Decision 5 pins the **cell-broadcast reply law**: each delivered member's FIRST reply is
  admitted against the broadcast's per-member delivery record (`record.deliveries`, 6841);
  replies keyed by workerId; depth stays 1 per member (second reply / reply-to-reply refuse
  `message_depth_exceeded`); single-worker targets unchanged (TC-18).
- Fence CAS: honestly acknowledged and bounded — cell sends carry no fence
  (`application.mjs:11554-11555` vs `coordinator.mjs:7256-7257` — verified); freshness story
  named (receipt + per-worker delivery records + durable `message.delivered` events;
  orchestrator sequences sends by awaiting receipts); listed as a non-goal for v1.
- Honest delivery modes: cell targets admit `delivery: 'nudge'` ONLY (broadcast hardcodes
  `'nudge'`, `coordinator.mjs:6868` — verified); `now`/`turn` refuse the new admission code
  `wave_cell_delivery_unsupported`; non-cell targets keep all three modes
  (`application.mjs:11550,11559` — verified).
- New red rows TC-21 (reply law) and TC-24 (delivery modes / fence).

### Blocker 7 [trust gate, MAJOR] — `required_effect` vs division of labor → FOLDED

- Ground truth 16 added: gate verdict per claim (`coordinator.mjs:12839-12849` →
  `policy_failure` `13719-13723`), `analysis: true` is the existing TG5 hatch, and the #88
  preflight (`coordinator.mjs:2615-2623`) mirrors the would-fire test verbatim at 2618-2620 —
  all verified (note: the red team's 2551-2606 preflight range sits just above the function;
  the contract cites the exact lines).
- Mechanism chosen **with the #88 preflight in mind**: brief-level division, not a union
  verdict — `group.editing` (sorted array of member indexes, default ALL); non-listed members'
  task briefs carry `analysis: true`, so the gate and the preflight compose UNCHANGED and
  per-worker. The union capture satisfies the effect through the editing members; an idle
  EDITING member is still policy-killed (safe direction preserved). Union/dynamic verdicts
  are a named non-goal.
- New red row TC-23; D6 counts a policy-killed member as `lost` with its `policy_failure`
  cause receipted.

### Blocker 8 [D1, MINOR — automatic] — schema citation mis-stated → FOLDED

- Ground truth 3 rewritten: `objectSchema`'s second argument is the REQUIRED array
  (`application-semantics.mjs:145-147` — verified); the member item
  (`application-semantics.mjs:1572-1579` — verified) declares FOUR properties with
  `required: ['role','objective','exact']`; `scope` is admitted; member `exact` is required
  at both transport seams (`application.mjs:11601-11603` — verified).
- Decision 1 gains **"The schema inversion the refusal codes depend on"**: the schema row
  drops `exact` from `required`, the exact-XOR (`group` present ⟺ member `exact` absent) is
  enforced in `_normalizeWaveStart` + `validateMember`, and seam ownership for
  `wave_group_route_conflict` is pinned (member `exact`: both seams; bare
  `harness`/`model`/`effort`: unknown-key refusals at transport, the named code at the
  `createWave`/`validateMember` library seam, `wave.mjs:98-103`). TC-03 rewritten to pin the
  seam split.

### Blocker 9 [D8, MINOR] — vocabulary not closed → FOLDED

- Decision 8's table regenerated from the composed code paths: adds
  `wave_cell_delivery_unsupported`; renames `wave_group_exact_missing` →
  `wave_group_seat_missing`; keys `cell_exact_breach` on `group.strict`; fixes the
  code/phase skew — `'degraded'` is listed as a terminal phase VALUE, not a code; and the
  composed-machinery list now includes the report owner-CAS codes
  (`board_report_no_active_claim`, `board_report_stale_claim_version`,
  `coordination-store.mjs:14854-14860` — verified) and the full #78 admission set
  (`board_grant_invalid`, `board_lease_required`, `board_session_mismatch`,
  `board_run_closed`, `board_worker_command_invalid`, `board_claim_invalid`,
  `board_report_invalid`), plus `board_item_not_open`, `conflict`, `stale_board_fence`,
  `message_depth_exceeded`, `application_wave_start_invalid`,
  `application_run_view_oversize`.

### Automatic tail (§1a/§1b cosmetics + D3 note + OQ verdicts) → FOLDED

- Frame anchor: messageId mint `coordinator.mjs:6838`; the `[MESSAGE … — UNTRUSTED]` wrap is
  `6865-6866` with the #92 comment at `6855-6857` (verified; red team's "~6858" corrected).
- `mintBoardGrant`'s own `_boardRunBindings` check cited at `coordination-store.mjs:14940`
  (14293/14783 noted as the sibling paths).
- docs/34 paraphrase fixed: the tier is run-scoped ("…for one run") and the doc's own scope
  noun ("for a wave") is quoted, not inverted (`docs/34-knowledge-horizons.md:51-52`).
- Off-by-ones corrected: `wave.mjs:504-507` (runs getter — independently re-verified at 504),
  `_taskByRun` `coordination-store.mjs:15011-15016`, `_normalizeWaveStart`
  `application.mjs:11583-11630`, `startWave` `application.mjs:11437-11472`,
  `permissionsForWaveRole` `coordinator.mjs:71-74`.
- D3 documentation note: "cells" collides with package content units
  (`docs/34-knowledge-horizons.md:51,73-74` — verified); docs sweep must disambiguate
  ("tight cell" / "wave cell" in prose).
- OQ1, OQ2 marked RESOLVED with the chosen readings; OQ3 RESOLVED-SOUND with the survivor-set
  correction; OQ4/OQ5 remain deferred (not blocking).

## Rejected / deferred

- **Rejected:** nothing in the red-team report was rejected; all 9 blockers folded.
- **Deferred (carried, not blockers):** OQ4 (`waves.progress` projection shape) and OQ5
  (`MAX_CELL_SIZE` re-derivation trigger) remain deferred per the red team's own verdicts;
  the docs-term rename executes in the docs sweep rung, not this contract.
- **Named v1 losses (deliberate, pinned in non-goals):** no fence CAS and no `now`/`turn`
  delivery for cell-targeted sends; no merge authority for results; no union/dynamic
  trust-gate verdicts. Each is stated as a bounded loss with its compensating truth named.

## Citation count

The red team re-derived ~40 distinct anchors in its §1 sweep of v1.0. v1.1 carries **115**
distinct `file:line(-line)` anchors (counted mechanically — `grep -oE
'[a-z0-9./_-]+\.(mjs|md):[0-9]+(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*'` over the amended contract,
deduplicated). The growth over v1.0 is the fold itself: new ground truths 13-16 (the
first-node substrate, the reply slot, the mint idempotency index, the trust gate/preflight)
plus the new surface pins in Decisions 2, 4, 5, 6, and 7. Five v1.0 addresses were corrected:
the frame wrap (`coordinator.mjs:6865-6866`, mint at 6838), the mint's own binding check
(`coordination-store.mjs:14940`), the runs getter (`wave.mjs:504-507`), `_taskByRun`
(`coordination-store.mjs:15011-15016`), and the #88 preflight (`coordinator.mjs:2615-2623`,
arm-check 2618-2620). Every new or changed anchor was re-verified against the working tree
during this fold.
