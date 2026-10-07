# FOLD-161 — blocker→resolution map (#161 orchestrator-plan-object, v1 → v2)

`[attempt: f3425277-ad18-4234-b694-6044e4283c89 row-fold161]`

- **Date:** 2026-08-13
- **Contract:** `orchestrator-plan-object-contract.md` (same dir) — FOLDED v2.0, in place.
- **Binding inputs (read fully):** `redteam-161.md` (same dir; NOT FOLD-READY) and
  `docs/reference/evidence/review-foundry-2026-08-13/review-qa.md` §3 (§3.3 H1/H2, §3.4 fold
  instruction set) + §5 DR-2/DR-3. The shared frame is
  `docs/reference/evidence/fold-2026-08-13/foundry-brief.md` (read first; binds every member).
- **Verification HEAD:** `e371f70` — every citation the fold touches was re-verified at this
  worktree HEAD this session (`grep -an`/`sed -n`, NUL discipline on `application.mjs` and
  `coordination-store.mjs`). The v1 verification HEAD `6ca4ec7` is not reachable from
  `e371f70` (red-team §1).
- **Fold method:** FOLDED (contract text changed — section cited) / STRUCK (false alarm —
  source cited) / ESCALATED (deferred — why). No silent drops. Every red-team blocker/amendment
  and every QA instruction is resolved below.
- **Deliverable note:** the shared-scratchpad publish is unreachable from this worktree (no
  publish channel — matching red-team §10 and QA §0); this durable file is the runtime handoff.

---

## Top-orchestrator decisions applied (law)

- **DR-2 (OQ1 — surface prefix): APPLIED.** Option (a) — `plan.read`/`plan.write` ride the
  existing `plan:*` capability class; the goal-plan overload is documented as a store-internal
  non-collision; no new prefix, no new capability class. Landed: D1 ID-namespace non-collision
  section (H1.2, structural disjointness of `plan:<hex32>` vs the goal-plan `plan:<hex64>`
  planRef), D3 verbs unchanged, OQ1 marked RESOLVED, D3 `(The campaign.* alternative…)`
  parenthetical updated.
- **DR-3 (OQ2 — exactly-one-in-progress scope): APPLIED.** The uniqueness law binds **per wave
  subtree**, not per plan; the plan level carries an explicit bounded `focusTaskIds` set
  (bounded by `planPolicy.maxFocusTasks`, deployment-owned default 4) instead of a singleton;
  auto-demote + `plan_parallel_progress` apply within a wave subtree. Rationale recorded (D4,
  deployment bounds): observed campaign orchestration runs multiple waves concurrently — a
  per-plan singleton is false to practice; it is a **law**, not a tunable. Landed: D1 schema
  (`focusTaskIds`), `plan.focus_upserted` mutation kind, D4 law rewrite, `planPolicy.maxFocusTasks`,
  P4/P9, `plan_parallel_progress` payload `{waveSubtree, currentDoingTaskId}`, `plan_focus_invalid`
  refusal, OQ2 marked RESOLVED.

## QA fold instruction set (§3.4) — resolution

| QA instruction | Resolution |
|---|---|
| 1. Correct the idempotency scheme (H1, H2) before fold — contract-text change, because pins P1/P4 would otherwise assert an unrepresentable state | **FOLDED** — D1 mutation table: `plan.task_upserted:${planId}:${taskId}:v${expectedTaskVersion}`, `plan.task_transitioned:${planId}:${taskId}:${toStatus}:v${expectedTaskVersion}`, `plan.task_evidence_linked:...:${evidenceDigest}:v${expectedTaskVersion}`; D1 idempotency discipline rewritten as the `(identity, version)` rule (the QA root fix; the board `(itemVersion, itemDigest)` template, G3). `plan.focus_upserted` joins with `:v${expectedPlanVersion}`. |
| 2. Pin P1 to assert *update* explicitly (upsert v1 then upsert v2 with `expectedTaskVersion=2` green; v2 with `expectedTaskVersion=1` refuses `plan_stale_version`) | **FOLDED** — P1 rewritten (pins table). |
| 3. Keep the shape/authority/surface decisions as written; they are sound | **FOLDED as a no-change guard** — the object shape, authority matrix, three-surface admission, and #74 gating are unchanged in decision; the fold pins only the enforcement seams the red-team proved under-specified (H2.1/H2.2/H2.3, H3.1/H3.2/H3.3/H3.4) and the elevation reject path (H4.2). |
| 4. Escalate the naming/scope authority questions (§5) via DECISION_REQUEST | **APPLIED by the top orchestrator** — DR-2 (naming) and DR-3 (scope) are the DECISION_REQUEST outcomes (review-qa §5), quoted into the row brief as law; both applied (above). |

### QA §3.3 missed holes — resolution (no silent drops)

| Missed hole | Resolution |
|---|---|
| H1 (blocker) — `plan.task_upserted`'s fixed per-task key makes "create or update" unrepresentable | **FOLDED** — version-bearing key `plan.task_upserted:${planId}:${taskId}:v${expectedTaskVersion}` (D1 mutation table; subsumed by QA §3.4 #1). |
| H2 (blocker) — `plan.task_transitioned`'s key embeds `toStatus`, so a repeat transition to the same status collides | **FOLDED** — version-bearing key `plan.task_transitioned:${planId}:${taskId}:${toStatus}:v${expectedTaskVersion}` (D1 mutation table; subsumed by QA §3.4 #1). |
| Root of H1/H2 — mutation keys keyed on identity, not (identity, version) | **FOLDED** — stated as the discipline (D1 idempotency discipline: the `(identity, version)` rule; the board lane's `(itemVersion, itemDigest)` adjudication, G3, as the working template). |

## Red-team blockers → resolution

| Blocker | Resolution |
|---|---|
| **1. H1.1 — deterministic key templates make task update and re-transition unreachable** | **FOLDED** — version-bearing keys (D1 mutation table + idempotency discipline). Update/re-transition are distinct versioned keys; `plan_stale_version` fires on a stale `expectedTaskVersion`. |
| **2. H1.2 — `plan:<hex32>` ID namespace collides with the goal-plan `plan:<hex64>` planRef** | **FOLDED per DR-2** — documented store-internal non-collision with structural disjointness: the goal-plan validates `^plan:[a-f0-9]{64}$` (`mcp-northbound.mjs:303,343,715,995`; `web-northbound.mjs:354,457`) and mints `plan:${goalPlanDigest(...)}` (`coordination-store.mjs:10725`, replay check `:7681`); the plan-object ID is `plan:<hex32>` with its own closed validator `^plan:[a-f0-9]{32}$`. No ID crosses projections; no valid plan-object ID is a valid goal-plan planRef or vice versa (D1 Identity). |
| **3. H2.2 — ownership resolution for row members and pre-decomposed row tasks unpinned** | **FOLDED** — member→run mapping pinned (the calling command's own runId === `ownedBy.run`; `ownedBy.role` matches the member role); pre-decomposed row tasks bind `ownedBy.wave` + `ownedBy.role` at decomposition and resolve `ownedBy.run` at claim/transition from the wave registry roster (D2 Enforcement seam). |
| **4. H2.1 — the `plan:*` powers class has no facade enforcement seam** | **FOLDED** — the deployment-authorize composition pinned: own task / own subtree / `plan:*` power → allow; else `plan_authority_forbidden`. `_authorize` is capability-based and never consults the goal-plan powers entry, so the `plan:*` gate is the deployment authorize (the #74 `restrictingReadAuthorize` shape) (D2 Enforcement seam). |
| **5. P2 — shallow-green pin** | **FOLDED** — P2 re-labeled RED with the honest restatement: the plan fold is unlanded (a `plan.*` event crashes `_apply` at `unsupported_event_kind`, `coordination-store.mjs:8862`); the fold/replay machinery that WILL carry plan events is green (pins table, replay-behavior note). |
| H1.3 — `ownedBy` closed-key order unspecified | **FOLDED** — canonical (sorted) orders stated for `ownedBy` (`['role','run','wave']`) and the task object; non-canonical order refuses `plan_task_invalid` (D1). |
| H1.4 — new `plan.*` event kinds share the `plan.` prefix with goal-plan events | **FOLDED per DR-2** — documented non-collision; distinct closed `_apply` kinds, no hard collision (D1 Identity, OQ1). |
| H2.3 — "the store-side fold resolves ownership" is a layer error | **FOLDED** — rephrased: the plan lane (command path) resolves ownership against the projection; folds never authorize (D2 Enforcement seam). |
| H3.1 — MCP admission omits the `_dispatch` branch | **FOLDED** — `_dispatch` branches specified for `baton_plan_read`/`baton_plan_write` (D3 step 3; landed facade dispatch branches at `mcp-northbound.mjs:1898-1912`). |
| H3.2 — the CLI `plan write` generic mutation envelope is underspecified | **FOLDED** — `plan write` takes a JSON mutation body parsed to the closed `plan.*` shapes; malformed/unknown refuses `cli_invalid` naming the expected shape (D3 step 2). |
| H3.3 — surface rows' `capabilities` do not carry the `plan:*` gate | **FOLDED** — the gate is the deployment-authorize composition (H2.1), not a registry-row field (D3 step 1). |
| H3.4 — P8's waiting-on kind unnamed | **FOLDED** — named `dispatch_pending` (`plan_approval` is the goal-plan approval state, not a plan-task `blockedBy` block) (D3 wire 2, P8). |
| H4.1 — the auto-demote batch is unrepresentable under H1.1, and its batch kind is unregistered | **FOLDED** — representable under the versioned keys (H1.1 fold); the plan batch kind is registered in the closed `_appendBatch` batch-kind list (`coordination-store.mjs:1526-1533`) (D4). |
| H4.2 — P4's "a `done` task cannot re-open" conflicts with D2's reviewed elevation | **FOLDED** — explicit review-authority re-open path: reviewed-rejected `done` → `todo` via `plan.task_transitioned`; non-review `done → todo` refuses the new `plan_reopen_forbidden` (D2 elevation, P4, refusal table). |
| H4.3 — the `done`-at-once marking path conflicts with `plan_blocked` | **FOLDED** — lane check order pinned: closed shape → version-CAS (`plan_stale_version`) → `blockedBy` closure for `→ done` (`plan_blocked`) → status law (D4). |
| §6 overlap nit — two authority codes for structurally identical scope violations | **FOLDED** — boundary stated as a rule (seat class): `coordinator_authority_forbidden` = the #74 seat-boundary code (coordinator seat outside its subtree); `plan_authority_forbidden` = the plan-scope code (every other principal without the right) (refusal table). |
| §1 citation-hygiene off-by-ones (six) | **FOLDED** — the six nits corrected where the fold touches them (`application.mjs:3221-3222`, `application.mjs:12501`, `facade-projection-contract.md:637`, `application-semantics.mjs:59-61`, `contract-fold.md` §D1.2 item 2, the `OPERATION_ROWS` region anchor); substance unchanged. |
| §8 "missing OQ" — the idempotency-key re-transition problem not surfaced | **FOLDED** — no longer an open question: H1.1's version-bearing keys close it, and the D1 idempotency discipline states it as the discipline's rationale. |

### Pin verdicts → fold action (red-team §7 sweep)

| Pin | Red-team verdict | Fold action |
|---|---|---|
| P1 | RED ✓ / GREEN ⚠ (inherits H1.1) | **FOLDED** — P1 now asserts update explicitly (QA §3.4 #2); the H1.1 half is resolved by the version-bearing keys. |
| P2 | RED ✘ / GREEN ⚠ SHALLOW | **FOLDED** — P2 re-labeled RED with the honest restatement (plan fold unlanded; the fold machinery is the green half). |
| P3 | RED ✓ / GREEN ⚠ | **FOLDED** — GREEN tightened to the closed `{id, title, status, blockedBy, ownedBy, evidence, taskVersion}` + canonical key order (H1.3). |
| P4 | RED ✓ / GREEN ✘ (H4.1, H4.2) | **FOLDED** — per-wave-subtree scope (DR-3), registered plan batch kind (H4.1), review re-open carve-out + `plan_reopen_forbidden` (H4.2). |
| P5 | RED ✓ / GREEN ✘ (H2.1, H2.2) | **FOLDED** — ownership resolution (H2.2) and the deployment-authorize composition (H2.1) pinned. |
| P6 | RED ✓ / GREEN ✘ (H4.2) | **FOLDED** — reviewed-reject re-open path added (H4.2); the reject makes the reviewed-admission claim real. |
| P7 | RED ✓ / GREEN ⚠ (H3.1) | **FOLDED** — MCP `_dispatch` branches added (H3.1). |
| P8 | RED ✓ / GREEN ⚠ (H3.4) | **FOLDED** — waiting-on kind named `dispatch_pending` (H3.4). |
| P9 | RED ✓ / GREEN ✓ | **FOLDED (DR-3)** — per-wave-subtree exactly-one-in-progress stated in the GREEN. |
| P10 | GREEN ✓ | **FOLDED (citation)** — `WAITING_ON_KINDS` cite corrected to `application-semantics.mjs:59-61`; substance byte-unchanged. |

## Open-question verdicts

- **OQ1** — RESOLVED by DR-2 (`plan.read`/`plan.write`; documented non-collision; no new
  prefix/capability).
- **OQ2** — RESOLVED by DR-3 (per wave subtree; `focusTaskIds` bounded by
  `planPolicy.maxFocusTasks`, default 4; auto-demote + `plan_parallel_progress` within a
  subtree).
- **OQ3** — stays open; both options safe under the pinned H2.2 ownership resolution.
- **OQ4** — stays open; fold leans the surfaced write (the H4.2 reviewed-reject re-open is an
  auditable `plan.task_transitioned`).
- **OQ5** — stays open; the shared `plan:` prefix seam is now the documented store-internal
  non-collision (D1, H1.2 per DR-2).

## STRUCK

None. No red-team blocker or QA instruction was a false alarm this fold.

## ESCALATED

None. Every blocker/amendment and every QA instruction resolved honestly in-contract without
deferral. The only authority-class questions (naming, scope) were the two DECISION_REQUESTs the
top orchestrator answered (DR-2/DR-3) and are applied.

---

## Deployment verification

Per the execution contract: executable `true`, args `[]`, cwd `.`, expected exit code `0` —
the fold changes no code; the work is the contract text and this map. Git status: the only
edited/new files are `orchestrator-plan-object-contract.md` (folded) and `fold-161.md` (this
map), both in `docs/reference/evidence/orchestrator-plan-object-2026-08-13/`.
