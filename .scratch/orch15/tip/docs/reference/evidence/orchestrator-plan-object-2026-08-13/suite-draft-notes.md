# suite-draft-notes — row-suite-161 (orchestrator-plan-object v2.0 FOLDED)

[attempt: 08d0dac7-8ad0-4e7c-a13e-9d7a3bb855bc row-suite-161]

Row: **row-suite-161** — red-first acceptance suite for the folded #161 contract v2.0.
Source of truth read in FULL before authoring: `orchestrator-plan-object-contract.md` (v2.0 FOLDED,
61,138 bytes — this row's binding text), `redteam-161.md`, `fold-161.md`, and the suite law
`docs/reference/evidence/suite-foundry-2026-08-13-b/foundry-brief.md`.

> Worktree note: the worktree copies `orchestrator-plan-object-contract.md` at the v1.0 draft
> (41,086 bytes). The v2.0 FOLDED text is the parent-repo version; every acceptance pin quoted here
> is pinned against the v2.0 text. The two deliverables (this notes file + the suite) are written
> into the worktree per the row scope.

---

## 1. Deliverables & execution contract

| Deliverable | Path |
|---|---|
| Red-first suite | `impl/test/orchestrator-plan-object-red.test.mjs` |
| This notes file | `docs/reference/evidence/orchestrator-plan-object-2026-08-13/suite-draft-notes.md` |

Execution contract (unchanged by this row — enforced by the reviewer):
executable `true`, argv `[]`, cwd `.`, expected exit `0`. The suite's own fixture profile mirrors
this exactly (see §6).

---

## 2. Row inventory — 47 rows (42 red + 5 pins), mapped to P1–P10

Each red row fails for a NAMED stage at HEAD; the stage is the `stage:` token inside the first
failing assertion's message. Pin rows are green at HEAD and under the correct implementation, but
fail a plausible wrong one (each pin's wrong-impl target is named in §4). Every pin is ALSO a row
at its named stage — the pin rows carry `stage:` tokens (`replay-fact-loss-pin`,
`facade-denial-pin`, `waiting-kind-constancy-pin`, `step-state-constancy-pin`,
`plan-namespace-pin`) in their assertion messages, so the suite is uniform: every test is a row
with a named stage.

> **Incremental continuation (this revision):** the original 44-row draft (39 red + 5 pins) was
> continued per the row instruction — every contract pin exercised at a named stage, including the
> two refusal codes the draft listed but never exercised (`plan_not_found`, `plan_task_not_found`)
> and the `plan.focus_upserted` mutation the draft left to a judgment call. +3 red rows: N1, N2,
> L7. See §7 and the incremental log in §9.

| Row | Capability | Stage at HEAD | Pin map |
|---|---|---|---|
| M1 | plan.write mints; plan.read round-trips | `plan-write-port-missing` | P1 |
| M2 | same-key retry returns prior event (exactly-once) | `plan-write-port-missing` | P1 |
| M3 | changed content under same mint key → `plan_replay_conflict` | `plan-write-port-missing` | P1 |
| M4 | update asserted: upsert v1→v2 (expectedTaskVersion=2) green, taskVersion=2 | `plan-write-port-missing` | P1 |
| M5 | stale upsert (expectedTaskVersion=1) → `plan_stale_version` | `plan-write-port-missing` | P1 |
| F1 | raw `plan.minted` appends + folds | `plan-fold-unlanded` | P2 (red half) |
| F2 | raw `plan.task_transitioned` appends + folds | `plan-fold-unlanded` | P2 (red half) |
| F3 | auto-demote plan batch kind registered in `_appendBatch` closed list | `plan-batch-kind-unregistered` | P2 (red half) |
| **F4** | **PIN** — close/reopen replay reproduces identical projection | green | P2 (green half) |
| S1 | missing closed field → `plan_task_invalid` | `plan-write-port-missing` | P3 |
| S2 | unknown field → `plan_task_invalid` | `plan-write-port-missing` | P3 |
| S3 | non-canonical key order → `plan_task_invalid` | `plan-write-port-missing` | P3 |
| S4 | blockedBy self-edge → `plan_topology_invalid` | `plan-write-port-missing` | P3 |
| S5 | blockedBy dangling edge → `plan_topology_invalid` | `plan-write-port-missing` | P3 |
| S6 | blockedBy cycle → `plan_topology_invalid` | `plan-write-port-missing` | P3 |
| S7 | non-closed status → `plan_task_invalid` | `plan-write-port-missing` | P3 |
| N2 | mutation naming absent task → `plan_task_not_found` `{planId, taskId}` | `plan-write-port-missing` | P3 |
| S8 | plan.read emits canonical sorted key order | `plan-read-port-missing` | P3 |
| N1 | plan.read naming unminted plan → `plan_not_found` `{planId}` | `plan-read-port-missing` | P3 |
| L1 | second doing in same wave subtree refused/auto-demoted | `plan-status-law-missing` | P4 |
| L2 | doing in different wave subtrees admitted | `plan-write-port-missing` | P4 |
| L3 | verified task done immediately and stays done | `plan-status-law-missing` | P4 |
| L4 | non-review re-open → `plan_reopen_forbidden` | `plan-status-law-missing` | P4 |
| L5 | review authority re-open admitted (H4.2) | `plan-write-port-missing` | P4 |
| L6 | focusTaskIds > planPolicy.maxFocusTasks → `plan_focus_invalid` | `plan-status-law-missing` | P4 |
| L7 | `plan.focus_upserted` version-CAS — matching bumps plan version; stale → `plan_stale_version` | `plan-write-port-missing` / `plan-status-law-missing` | P4 |
| A1 | row member reads/writes OWN task | `plan-write-port-missing` | P5 |
| A2 | row member writes sibling → `plan_authority_forbidden` | `plan-authority-matrix-missing` | P5 |
| A3 | coordinator writes subtree | `plan-write-port-missing` | P5 |
| A4 | coordinator outside subtree → `coordinator_authority_forbidden` | `plan-authority-matrix-missing` | P5 |
| A5 | orchestrator (plan:*) mints/upserts/transitions any task | `plan-write-port-missing` | P5 |
| W1 | wave.closed review: completed→done+evidence, incomplete→todo | `plan-wave-close-elevation-missing` | P6 |
| W2 | reviewed-reject done→todo (H4.2); no silent auto-promotion | `plan-wave-close-elevation-missing` | P6 |
| X1 | CLI `plan read PLAN_ID` → plan.read | `cli-plan-verbs-missing` | P7 |
| X2 | CLI `plan write PLAN_ID --mutation JSON` → plan.write; malformed → cli_invalid | `cli-plan-verbs-missing` | P7 |
| X3 | CLI_WEB_COMMANDS admits plan.read/plan.write | `cli-plan-verbs-missing` | P7 |
| X4 | web refusal ledgered in surface-divergence-ledger.json | `web-plan-ledger-missing` | P7 |
| X5 | MCP baton_plan_read/write, repoId leading required | `mcp-plan-tool-missing` | P7 |
| X6 | OPERATION_ROWS registry rows (canonical specs region) | `registry-plan-rows-missing` | P7 |
| X7 | generated CLI.md/MCP.md plan rows | `docs-plan-rows-missing` | P7 |
| Q1 | #74 coordinator decomposition lands with ownedBy binding | `plan-gated-dispatch-missing` | P8 |
| Q2 | interpreter gates member on plan-task state (dispatch_pending/settleable) | `plan-gated-dispatch-missing` | P8 |
| O1 | plan.read at orchestrator = campaign todo projection | `plan-read-at-orchestrator-missing` | P9 |
| **R1** | **PIN** — `application_unauthorized` stays facade denial | green | P10 |
| **R2** | **PIN** — WAITING_ON_KINDS closed five byte-unchanged | green | P10 |
| **R3** | **PIN** — SCRATCHPAD_STEP_STATES closed three byte-unchanged | green | P10 |
| **R4** | **PIN** — goal-plan validator still refuses plan:<hex32> | green | P10 |

**P0 note (invented refusal codes):** `plan_replay_conflict`, `plan_stale_version`,
`plan_task_invalid`, `plan_topology_invalid`, `plan_parallel_progress`, `plan_reopen_forbidden`,
`plan_focus_invalid`, `plan_authority_forbidden`, `coordinator_authority_forbidden`,
`plan_not_found`, `plan_task_not_found` are the contract's refusal vocabulary (D2/D3). At HEAD the
plan.write port is absent, so none of them can fire — every refusal row rides
`application_command_unavailable` today and asserts its typed code after the fold.

---

## 3. Stage table (measured HEAD seams, not presumed)

All seams below were verified by direct probe at HEAD before the suite was written, and are
re-confirmed by the run output (each red failure carries the exact code):

| Stage | HEAD seam (verbatim) | Anchor |
|---|---|---|
| `plan-write-port-missing` | `application.command('plan.write')` throws `application_command_unavailable` | application.mjs:12590 `validateApplicationCommandArgs` |
| `plan-read-port-missing` | `application.command('plan.read')` throws `application_command_unavailable` | application.mjs:12590 |
| `plan-fold-unlanded` | `store._append('plan.minted'|'plan.task_transitioned')` throws `coordination_projection_poisoned`; `cause.code` = `unsupported_event_kind` | coordination-store.mjs:8862 |
| `plan-batch-kind-unregistered` | `store._appendBatch(entries, 'plan_auto_demote')` throws `TypeError: coordination batch kind is invalid` | coordination-store.mjs:1526–1533 |
| `plan-status-law-missing` | refusal rows: HEAD fires `application_command_unavailable`; fold must fire `plan_parallel_progress` / `plan_reopen_forbidden` / `plan_focus_invalid` (L1/L3/L4/L6) | — |
| `plan-authority-matrix-missing` | refusal rows: HEAD fires `application_command_unavailable`; fold must fire `plan_authority_forbidden` (A2) / `coordinator_authority_forbidden` (A4) | D2 |
| `plan-wave-close-elevation-missing` | positive rows: HEAD fires `application_command_unavailable` on plan.write (W1/W2) | D2 |
| `cli-plan-verbs-missing` | `parseBatonCli(['plan',...])` throws `cli_invalid` 'expected credentials, setup, doctor, route, explore, review, context, waves, or run'; CLI_WEB_COMMANDS has no plan verbs | application-cli.mjs:1417–1418, :16–32 |
| `web-plan-ledger-missing` | web `plan_read`/`plan_write` refused ('unsupported command' 400); ledger `entries` is `[]` | web-northbound.mjs:405, surface-divergence-ledger.json |
| `mcp-plan-tool-missing` | MCP ordinary tool list (35 tools) lacks baton_plan_read/baton_plan_write | mcp-northbound.mjs tool registry |
| `registry-plan-rows-missing` | `CANONICAL_OPERATION_SPECS`…`SURFACE_ALIAS_ROWS` region contains no plan.read/plan.write | application-semantics.mjs:1225–1731 |
| `docs-plan-rows-missing` | CLI.md / MCP.md have no `baton plan read|write` / `baton_plan_read|write` rows | impl/CLI.md, impl/MCP.md |
| `plan-gated-dispatch-missing` | positive rows: HEAD fires `application_command_unavailable` on plan.write (Q1/Q2) | D3 #74 |
| `plan-read-at-orchestrator-missing` | `plan.read` absent; HEAD fires `application_command_unavailable` (O1) | D4 |

The one seam that does NOT hold is the M1 principal-argument copy error: an early draft passed the
idempotency-key string as the `who` argument, so M1 failed at principal validation
(`application_authority_invalid`, application.mjs:1115) instead of the port. Fixed before the
measured runs — M1 now fails at `application_command_unavailable` like every other positive row.

The three rows added in the incremental continuation use NO new stages: N2 rides
`plan-write-port-missing`, N1 rides `plan-read-port-missing`, L7 rides `plan-write-port-missing`
(positive leg) and `plan-status-law-missing` (its `plan_stale_version` refusal leg, which extends
that stage's fold-must-fire list with the plan-version CAS).

The pin rows carry their own named stages — `replay-fact-loss-pin` (F4), `facade-denial-pin` (R1),
`waiting-kind-constancy-pin` (R2), `step-state-constancy-pin` (R3), `plan-namespace-pin` (R4) — so
every test in the suite, red or pin, is a row at a named stage.

---

## 4. PIN list — green at HEAD AND under the correct implementation

Every pin is a row at its named stage: the `stage:` token in the pin's assertion messages is the
stage a plausible WRONG implementation breaks (if a pin fails, the failure names the stage).

| Pin | Stage token | Kills (plausible wrong impl) |
|---|---|---|
| F4 close/reopen replay reproduces the identical projection (byte-identical snapshot, same event count) | `replay-fact-loss-pin` | a fold that loses facts across checkpoint/replay |
| R1 `application_unauthorized` stays the facade denial (runs.list with deny-all authorize) | `facade-denial-pin` | a plan-scope fold that routes the facade denial through a plan code |
| R2 WAITING_ON_KINDS closed five byte-unchanged and sorted | `waiting-kind-constancy-pin` | an impl that renames/removes/reorders a kind to make room for plan-approval |
| R3 SCRATCHPAD_STEP_STATES closed three byte-unchanged | `step-state-constancy-pin` | an impl that renames todo/doing/done for the plan task status |
| R4 goal-plan `^plan:[a-f0-9]{64}$` validator still refuses a plan:<hex32> object id, and still admits a plan:<hex64> goal-plan ref | `plan-namespace-pin` | an impl that collapses the two `plan:` namespaces |

---

## 5. Measured splits (split-twice law)

Both runs executed from the repo root with the identical command:

```
node --test impl/test/orchestrator-plan-object-red.test.mjs
```

| Run | PASS | FAIL | Pins passing |
|---|---|---|---|
| Run 1 (2026-08-13, 44 rows) | 5 | 39 | F4, R1, R2, R3, R4 |
| Run 2 (2026-08-13, 44 rows) | 5 | 39 | F4, R1, R2, R3, R4 |
| Run 3 (2026-08-13, 47 rows, +N1/N2/L7) | 5 | 42 | F4, R1, R2, R3, R4 |
| Run 4 (2026-08-13, 47 rows, +N1/N2/L7) | 5 | 42 | F4, R1, R2, R3, R4 |

Stable across two runs at each inventory size. Every red failure carries its named `stage:` in the
first assertion's message; none is a fixture/construction error. Exit code 1 (expected — red suite
at HEAD).

---

## 6. Suite mechanics & law compliance

- **Fixture idiom**: `openHost` (real `createDriver` + `BatonApplication` + `bindBaton`,
  `markerAdapter`, `driverEvents`), mirroring `wave-observability-red.test.mjs`; bare
  `CoordinationStore` rows mirroring `phase75-task-topology.test.mjs` (F1–F4, R3); `McpFleetServer`
  `tools/list` from the mcp-reflex idiom (X5); `validateWebCommandEnvelope` + `WebNorthbound` from
  the phase12 web-card idiom (X4, R4); `parseBatonCli`/`CLI_WEB_COMMANDS` direct (X1–X3).
- **Hermetic**: every fixture roots in `mkdtempSync` (git-initialized for the createDriver path,
  plain for store-only rows); `test.after` shuts down the application, releases the writer lease,
  and `rmSync`s both roots; no network or host state.
- **No clocks as controls**: the fixed `NOW` constant feeds every surface `clock`/`now` hook;
  assertions ride event seqs only.
- **Namespace imports**: the invented `plan.read`/`plan.write` direct ports, plan event kinds, the
  plan batch kind, the plan refusal codes, and the two MCP tools are absent from HEAD's surface
  exports and are probed only through real entry points — no invented module is imported.
- **Sorted-key literals**: `TASK_KEY_ORDER` = `['blockedBy','evidence','id','ownedBy',
  'schemaVersion','status','taskVersion','title']` and `OWNED_BY_KEY_ORDER` = `['role','run','wave']`
  are emitted in ACTUAL sorted order; `localeCompare` never used.
- **watchdog.stallMs**: the only armed Coordinator is inside `createDriverFor`, threaded with
  `watchdog: { stallMs: 60_000 }` (valid positive integer, below the deployment wall). Store-only
  rows construct a bare `CoordinationStore` which owns no watchdog.
- **Static anchors**: source pins are ORDER/EXISTENCE/byte-string only — the X6 registry region is
  content-anchored (`CANONICAL_OPERATION_SPECS`…`SURFACE_ALIAS_ROWS`), never an absolute
  line-window; R3 greps the exact `new Set(['todo', 'doing', 'done'])` literal; R2 deep-equals the
  frozen array. #166 respected.
- **NUL-byte discipline**: `application.mjs` and `coordination-store.mjs` are never read whole —
  touched only through the imported surface exports / `grep -an` (R3). This suite file contains 0
  NUL bytes.
- **Deployment verification (execution contract)**: executable `true`, argv `[]`, cwd `.`,
  expected exit `0` — unchanged. The suite's own profile uses the identical verification object.

---

## 7. Judgment calls (recorded per the foundry law)

1. **Auto-demote batch kind name.** The v2.0 fold and contract pin the batch-kind registration
   seam (H4.1 — the `_appendBatch` closed list at coordination-store.mjs:1526–1533) but never name
   the literal. This suite adopts **`plan_auto_demote`** as the plan batch kind (F3). If the fold
   ships a different literal, F3 must be renamed to match — the requirement it pins is "a plan batch
   kind is registered and folds the demote atomically," not the exact token.
2. **F3 batch content.** The batch carries exactly one `plan.task_transitioned` doing→todo demote.
   This matches DR-3's "auto-demote the earlier doing task" branch of exactly-one-in-progress. An
   implementation that always refuses `plan_parallel_progress` instead still passes L1 (dual-path
   assertion) but fails F3 — by design, F3 demands the batch surface exists.
3. **L1 dual-path acceptance.** The status law admits either enforcement (batch auto-demote OR
   strict-DAG `plan_parallel_progress`). The row asserts whichever the implementation ships:
   a resolved write → the earlier task reads `todo`; a refused write → `plan_parallel_progress`.
   This keeps the row green for a valid fold without hard-pinning the mechanism.
4. **Identity derivation.** `planId = plan:<hex32>` digest of `{idempotencyKey, campaignId}`;
   `taskId = task:<hex32>` digest of `{planId, title, ownedBy}` — taken from D1's exact text.
5. **Version-bearing idempotency keys.** Keys `plan.task_upserted:…:v${expectedTaskVersion}` and
   `plan.task_transitioned:…:${toStatus}:v${expectedTaskVersion}` carry the version per H1.1/QA
   fold; the version is the CAS basis for `plan_stale_version` (M5).
6. **`plan.focus_upserted` now exercised (L7).** The D1 table's focus-upsert mutation kind was
   originally left to judgment call #6 as "not separately exercised" — the incremental continuation
   RESOLVES that by adding L7: a matching `expectedPlanVersion` updates the bounded focus window
   and bumps the plan version, a stale one refuses `plan_stale_version`. L6 (mint-time focus bound)
   and L7 (post-mint focus mutation) now cover both faces of the DR-3 focus law.
7. **W1 wave.closed staging.** The elevation row stages a `wave.closed` record via
   `recordDriver` with a fixture-shaped body, then asserts the plan elevation through plan.read.
   The exact wave.closed record shape is a fixture judgment; the row's assertion is about the
   elevation outcome, not the record schema.
8. **M1 principal-argument copy error (fixed).** Noted in §3 — the measured runs use the corrected
   call so every positive row fails at the true port seam.
9. **N1/N2 refusal-detail assertions.** N1 asserts the `plan_not_found` detail `{planId}` and N2 the
   `plan_task_not_found` detail `{planId, taskId}` — both taken from the D2 refusal table. If the
   fold ships the codes without the typed details, these legs will fail and force the detail to be
   added.
10. **L7 outcome shape.** The focus-upsert outcome is asserted as `{status: 'plan_updated',
    planVersion: 2}` and the read-back as `{focusTaskIds, version}` — the plan-level version-CAS
    (D-table + G3 mirror). The exact outcome field name (`planVersion` vs `version`) is a fold
    judgment; the row's requirement is that the CAS bumps the plan version and the window reads
    back.
11. **N2 mint-empty arrangement.** N2 mints the plan with an EMPTY task set so the ghost task is
    unambiguously absent — a mint-with-tasks arrangement would risk the ghost colliding with a
    legitimately-minted task id.

---

## 8. Handoff / process evidence

- **Mid-turn brief instruction**: "publish notes to `shared` scratchpad as you go; a failed publish
  is evidence — record the refusal." This worktree exposes no `shared` scratchpad channel
  (no publish/annex surface is reachable from the row sandbox), so the publish is **refused** and
  this refusal is recorded here as evidence. The durable handoff is these two deliverables; the
  full pre-compaction context (HEAD probes, seam mapping, fixture decisions) is in the session
  transcript at
  `…/runtime/w-237/config/…/ac741f99-4f8b-4b24-8091-eea56536c9ac.jsonl`.
- The v2.0 FOLDED contract, `redteam-161.md`, and `fold-161.md` live in the PARENT repo; the
  worktree carries the v1.0 draft. All acceptance text cited here is pinned to the v2.0 parent
  text.

---

## 9. Incremental continuation log (write suite + notes incrementally)

The continuation instruction: "every pin becomes a row at its named stage; write the suite AND the
notes incrementally; run it twice and record both splits." Executed as four visible increments,
each followed by a run and a notes update:

| Step | Suite change | Notes change | Measured split |
|---|---|---|---|
| 0 | 44-row draft (39 red + 5 pins) landed and verified | §1–§8 written | 5 · 39 ×2 |
| 1 | PIN rows F4/R1/R2/R3/R4 each carry a named `stage:` token (`replay-fact-loss-pin`, `facade-denial-pin`, `waiting-kind-constancy-pin`, `step-state-constancy-pin`, `plan-namespace-pin`) | §2 header note + §4 stage-token column | 5 · 39 (unchanged — pins still green) |
| 2 | +N1 (`plan_not_found`), +N2 (`plan_task_not_found`), +L7 (`plan.focus_upserted` version-CAS); header inventory 44→47 | §2 rows, §3 stage note, §7 #6 resolved + #9–#11 | 5 · 42 |
| 3 | VERIFIED SPLIT header updated to 5 · 42 | §5 split table (runs 1–4) + this §9 | 5 · 42 ×2 |

Both continuation splits were measured from the repo root with
`node --test impl/test/orchestrator-plan-object-red.test.mjs` and are recorded in §5. The suite
remains 47 tests: 42 red rows (each failing at its named stage at HEAD) + 5 green pin rows (each a
row at its named stage). Attempt-echo, execution contract, and NUL discipline are unchanged.
