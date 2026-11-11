# #161 row-sf161 — blue-team NEEDS-FOLD folded into the orchestrator-plan-object red-first suite

[attempt: c8f618f9-2f2a-4a1d-a367-eda8fd71da5c row-sf161]

Authority: `blue-team-2026-08-13-a/blueteam-161.md` (NEEDS-FOLD — the whole-suite in-memory wrong
impl flips 47/47 green; S3 + Q2 BROKEN) via the foundry-brief fold law. Suite:
`impl/test/orchestrator-plan-object-red.test.mjs` — folded **in place**, staying **47 rows
(5 PIN / 42 RED)**. The fold adds no rows; it rebuilds the `task()` fixture to the canonical
sorted literal (§3), re-drives Q2 on the interpreter gate (the BROKEN row), re-triggers W1's
wave.closed hook, re-pins the authority matrix on H2.1/H2.2 (capability seats + wave-registry
roster), asserts the durable projection on M1–M3/F1–F3, adds the same-wave/different-run subtree
case (L1 leg B) and the deployment `planPolicy` read (L6), and lands regeneration/conformance
gates on X4/X5/X6/X7. Contract: `orchestrator-plan-object-contract.md` v2.0 (unchanged — the fold
is rows/seams in the suite, not contract text).

## The blue-team findings → resolution

Legend: **FOLDED** = the suite now bites the described wrong impl · **STRUCK** = already sound
(no cheap wrong impl passes; the finding needed no fold) · **ESCALATED** = cannot fold in scope
(none — every finding resolved in the suite file).

### §3 decisive defect (construction-order vs sorted-order)

| Finding | Severity | Folded seam | Row(s) | RED/PIN at HEAD | What the fold pins |
|---|---|---|---|---|---|
| **S3** the sorted-order pin contradicts the suite's own construction-order fixtures — a correct sorted-only fold refuses every valid mint | TOP-TIER (BROKEN) | `task()` rebuilt to emit the canonical sorted literal `['blockedBy','evidence','id','ownedBy','schemaVersion','status','taskVersion','title']` (ownedBy `['role','run','wave']`), in ACTUAL sorted order | **S3** + every fixture-driven mint | RED at `plan-write-port-missing` (as before) | the fixtures and S3 stop contradicting: a correct sorted-only fold accepts every fixture mint, and S3's construction-order reordered literal is the honest non-closed counterexample — it still refuses `plan_task_invalid` (D1). The wrong impl that accepted BOTH orders now fails S3's refusal against a canonical fixture set. |

### §P1 mint + update + idempotency (M1–M5)

| Row | Verdict | Resolution | Folded seam |
|---|---|---|---|
| M1 | SHALLOW | **FOLDED** | durable projection asserted: the mint lands a `plan.minted` ledger event (`host.driver.coordination.events()`) AND a `snapshot().planObjects?.plans` row — an in-memory `Map` mint leaves no durable event/snapshot row and fails. |
| M2 | SHALLOW | **FOLDED** | `events.length === 1` after the mint retry — exactly-once on the STORE ledger, not the in-memory `byKey` outcome. |
| M3 | SHALLOW | **FOLDED** | the replay-conflict refusal appends nothing — the ledger length is unchanged after the refused write. |
| M4 | SOUND | **STRUCK** | the row already requires a real versioned upsert (v1 → v2 with `expectedTaskVersion=2`). |
| M5 | SOUND | **STRUCK** | the row already requires the real version-CAS (`plan_stale_version`). |

### §P2 replay / fold seam (F1–F3 RED + F4 pin)

| Row | Verdict | Resolution | Folded seam |
|---|---|---|---|
| F1 | SHALLOW | **FOLDED** | asserts the `snapshot().planObjects` row for the raw `plan.minted` AND byte-identical close/reopen replay (`replay.snapshot().planObjects` deepEqual `live.planObjects`) — a 2-line no-op `_apply` branch builds no projection and fails the snapshot read-back. |
| F2 | SHALLOW | **FOLDED** | fixture now mints alpha first (a real `plan.minted`), then appends the raw `plan.task_transitioned`; the projection must read `done` — the no-op fold accepts the kind but folds nothing, so the read-back fails. |
| F3 | SHALLOW | **FOLDED** | the `plan_auto_demote` batch is now EXERCISED, not merely registered: mint alpha `doing` v1, append the demote batch, assert the projection reads `todo` — adding the batch-kind alone without folding fails the projection assertion. |
| F4 PIN | SOUND | **STRUCK** | already bites a fold that loses facts across checkpoint/replay (byte-identical snapshot on close/reopen). |

### §P3 closed shape + topology (S1–S8, N1, N2)

| Row | Verdict | Resolution | Folded seam |
|---|---|---|---|
| S1, S2, S4–S8, N1, N2 | SOUND | **STRUCK** | each already requires the real closed-key/topology/existence validation. |
| S3 | **BROKEN** | **FOLDED** | see §3 — the canonical `task()` fixture is the fold; S3's reordered literal is the non-closed counterexample. |

### §P4 status law / exactly-one-in-progress (L1–L7)

| Row | Verdict | Resolution | Folded seam |
|---|---|---|---|
| L1 | SHALLOW | **FOLDED** | new **leg B**: a same-wave DIFFERENT-run task (`gamma`, `wave:w1`/`run:r3`) minted beside the conflict pair transitions to `doing` and is ADMITTED — a wave-only doing-check (ignoring run) refuses here, pinning the composite `ownedBy.wave/run` subtree key (DR-3). |
| L2 | SHALLOW | **FOLDED** | the same-wave/different-run case landed in L1 leg B; L2 keeps the diff-wave/diff-run admission — the composite key is now pinned by the two rows together. |
| L3 | SOUND | **STRUCK** | immediate done marking + version bump + stale re-transition refusal asserted directly. |
| L4 | SHALLOW | **FOLDED** | the review boundary is no longer the `'orchestrator'` string: the H2.1 capability seam is exercised by A5/L5/W2 (the capability-carrying review seat under `planAuthorize`); L4 pins the lane-level denial flip-side unchanged. |
| L5 | SHALLOW | **FOLDED** | the reviewed-reject re-open (done → todo, H4.2) is now driven by `principal('plan-review')` under the restricting `planAuthorize` — the plan:* review seat (H2.1), which the string-seat facade (recognizing only `'orchestrator'`) cannot admit. |
| L6 | SHALLOW | **FOLDED** | the focus bound is read from the deployment `planPolicy`: the fixture hosts `{ planPolicy: { maxFocusTasks: 3 } }` and asserts the refusal carries `{ focusCount: maxFocusTasks + 1, maxFocusTasks }` — a hardcoded `4` ceiling fails the row. |
| L7 | SOUND | **STRUCK** | focus version-CAS + stale refusal asserted directly (1 → 2 bump). |

### §P5 authority matrix (A1–A5)

| Row | Verdict | Resolution | Folded seam |
|---|---|---|---|
| A1 | SHALLOW | **FOLDED** | the row task is now PRE-DECOMPOSED (`ownedBy('alpha', null, 'wave:w1')`) and the lane must resolve `ownedBy.run` at claim/transition time from a `steering.registered` wave-registry roster record — the read-back asserts `ownedBy.run === 'run:r1'`, which a principalId-string authority (never consulting the roster) cannot fake (H2.2). |
| A2 | SHALLOW | **FOLDED** | sibling-task refusal stays lane-level (`plan_authority_forbidden`) under the permissive default; the authority matrix is now pinned by the A1 roster resolution and the A5/L5/W2 capability seats — a string-seat facade passes A2's denial but fails A1's roster read-back. |
| A3 | SHALLOW | **FOLDED** | coordinator subtree admission stays lane-level; pinned by the matrix as a whole. |
| A4 | SHALLOW | **FOLDED** | outside-subtree refusal stays lane-level (`coordinator_authority_forbidden`). |
| A5 | SHALLOW | **FOLDED** | the plan:* power is now exercised by the capability-carrying review seat under the restricting `planAuthorize` (the #74 `restrictingReadAuthorize` shape): `principal('plan-review')` mints and transitions — the string-seat facade recognizes no `'plan-review'` string and fails (H2.1). |

### §P6 elevation at wave close (W1, W2)

| Row | Verdict | Resolution | Folded seam |
|---|---|---|---|
| W1 | SHALLOW | **FOLDED** | the wave closes through the DEDICATED `appendWaveClosed` API (the closed 8-key shape) — never `recordDriver` (which wraps in `driver.recorded` and can never trigger the plan lane's close hook) and never a gated-record try/catch tolerance. The row asserts a DURABLE `plan.task_evidence_linked` event on the store ledger for the completed task and mints the incomplete task `doing` so the close review must DEMOTE it to `todo` — read-time evidence synthesis and a never-run hook both fail. |
| W2 | SHALLOW | **FOLDED** | the review re-open (H4.2) is driven by `principal('plan-review')` under `planAuthorize` — the review authority's power, not the `'orchestrator'` string. |

### §P7 three-surface admission (X1–X7)

| Row | Verdict | Resolution | Folded seam |
|---|---|---|---|
| X1, X2, X3 | SOUND | **STRUCK** | the parser must actually compile the plan verbs / refuse a malformed body / admit both whitelist names. |
| X4 | SHALLOW | **FOLDED** | regeneration/conformance gate: the ledgered rows must be EXACTLY the two plan verbs and each must cross-check against the ACTUAL web envelope refusal (no advertise-but-dead) AND have a registry row (no hand-edited ghost row) — a ledger-only hand-edit fails the registry cross-check. |
| X5 | SHALLOW | **FOLDED** | dispatch gate: a `tools/call` for `baton_plan_read` AND `baton_plan_write` must reach the application port — at HEAD the tools are unregistered and `tools/call` returns a protocol error (`-32602`); a listed-but-undispatchable (advertise-but-dead) tool fails the row. |
| X6 | SHALLOW | **FOLDED** | parsed-registry LIVE gate: `APPLICATION_SEMANTIC_REGISTRY.canonicalOperations` must actually register `plan.read`/`plan.write` — a comment in the OPERATION_ROWS region (the wrong impl's literal trick) cannot produce a canonicalOperations row. |
| X7 | SHALLOW | **FOLDED** | regeneration gate: the docs must carry the registry-DERIVED surface names (`deriveSurfaceNames`/`op.names.cli|mcp`) — a doc-only hand-edit (docs claim the rows while the registry has none) fails the registry gate. |

### §P8 #74 integration (Q1, Q2)

| Row | Verdict | Resolution | Folded seam |
|---|---|---|---|
| Q1 | SHALLOW | **FOLDED** | the decomposed row task is PRE-DECOMPOSED (`ownedBy.run` null); the coordinator upserts it into the (empty) plan, the member claims it, and the read-back asserts `ownedBy.run === 'run:r1'` resolved from a `steering.registered` roster record at claim time (H2.2) — a string wave-match + ownedBy pass-through never consults the roster and fails the read-back. |
| Q2 | **BROKEN** | **FOLDED** | the interpreter gate is now ASSERTED, not admission-only: the blocked member's `→ done` REFUSES `plan_blocked {blockedByUnmet:[depId]}` (the `dispatch_pending` projection over the closed five, H3.4) BEFORE the dependency completes; only after the dep transitions `done` is the member's `→ done` admitted with the next `taskVersion` (settleable). The old duplicate-of-A1 body is gone. |

### §P9 orchestrator practice migration (O1)

| Row | Verdict | Resolution | Folded seam |
|---|---|---|---|
| O1 | SHALLOW | **STRUCK** | not in the §8 fold instruction set; the per-wave-subtree exactly-one-in-progress ENFORCEMENT is pinned by L1 (leg A + leg B), so O1 keeps the campaign-todo read. |

### Pins (F4, R1–R4)

| Pin | Verdict | Resolution |
|---|---|---|
| F4, R1–R4 | SOUND (each, bite-tested by the blue team) | **STRUCK** — no fold needed; all five stay green and kill their named wrong impl. R1's fixture was re-threaded to the new `openHost(..., { authorize })` options shape so the pin still mounts the strict deny. |

## Before / after

```
BEFORE (blue-team review HEAD f14cf69):  tests 47 · pass 5 · fail 42   (F4, R1, R2, R3, R4 green)
AFTER  (fold verification HEAD e371f70): tests 47 · pass 5 · fail 42   (F4, R1, R2, R3, R4 green)
```

The fold is to the SUITE FILE ONLY — the tree the suite runs against is unchanged, so the split
is deliberately identical (the pre-implementation tree still lacks the plan lane). What changed is
the bite: the blue-team's whole-suite wrong impl (in-memory lane + no-op fold + string-seat
authority + hand-edited surfaces) flipped the OLD suite 47/47 green; the folded rows cannot be
satisfied by that wrong impl (each new seam is one of the wrong impl's shortcuts).

Verified at the fold HEAD (two consecutive runs from `impl/`, both stable):

```
Run 1: 47 tests — 5 pass (F4, R1, R2, R3, R4) / 42 fail (the RED rows at their named stages)
Run 2: 47 tests — 5 pass / 42 fail. STABLE.
```

Every RED row still fails at its NAMED first stage (`plan-write-port-missing`,
`plan-status-law-missing`, `plan-authority-matrix-missing`, `plan-wave-close-elevation-missing`,
`web-plan-ledger-missing`, `registry-plan-rows-missing`, `plan-gated-dispatch-missing`, …). No
existing stage string moved; the new fold seams name the stage in their assertion messages
(`mcp-plan-dispatch-missing` for X5's dispatch gate, `plan-blocked` detail for Q2).

## Per-finding seam notes

- **S3 — fixtures canonical, S3's literal the counterexample.** `task()` now emits the closed
  sorted literal in ACTUAL sorted order. The blue-team's contradiction is dissolved by making the
  FIXTURES canonical (the contract's D1 ordering), so S3's construction-order reordered literal is
  the honest non-closed input and still refuses `plan_task_invalid`. A wrong impl that accepts both
  orders passes the fixtures but fails S3's refusal.
- **Q2 — the gate is the refusal.** Driving the full `waves.run` interpreter is out of proportion
  for a red-first row; the lane-boundary pin is the blocked task's `→ done` refusing
  `plan_blocked {blockedByUnmet:[depId]}` — the interpreter gate's `dispatch_pending` projection —
  followed by the dep's completion making the member settleable. A wrong impl that only admits two
  transitions (the old body) now fails the refusal.
- **W1 — the hook, not a tolerated gate.** The wave closes through `appendWaveClosed` (the closed
  8-key shape — waveId, blockedOn, lanes, parked, rings, knowledge, receiptDigest,
  settlementErrors); the row asserts the durable `plan.task_evidence_linked` event AND the
  'doing'→'todo' demotion. `recordDriver` (which wraps in `driver.recorded`) and the old gated
  try/catch both fail.
- **Authority — H2.1 seats, H2.2 roster.** The restricting `planAuthorize` is applied ONLY to the
  rows that pin the plan:* power (A5, L5, W1, W2 — driven by `principal('plan-review')`); the
  default host authorize stays permissive so the lane-level refusals (A2/A4/L4/Q2) reach their
  typed codes instead of being pre-empted by `application_unauthorized`. H2.2 is pinned by A1/Q1
  with run-null pre-decomposed tasks + `steering.registered` roster records + read-back run
  resolution.
- **Durable projection — ledger + snapshot.** M1–M3 assert the store ledger (`events()`) and the
  `snapshot().planObjects` row; F1–F3 assert projection read-backs (and byte-identical replay for
  F1). The in-memory lane and the no-op fold leave no durable event and build no projection.
- **X4/X5/X6/X7 — regeneration/conformance.** X4's ledger rows must match the actual web refusal
  AND the registry; X5 dispatches `tools/call` to the application port; X6 requires the parsed
  registry to register the verbs (a source comment can't); X7 requires the docs to carry the
  registry-derived names. Hand-edit, advertise-but-dead, and comment shortcuts all fail one of
  these gates.

## Judgment calls

1. **`snapshot.planObjects` key name.** The contract names the store projections `_plans` /
   `_planTasks` but not their snapshot surface. The fold exposes them as
   `snapshot().planObjects = { plans, tasks }`; F1 asserts it. (Alternative — surface them under
   `_plans`/`_planTasks` directly — rejected: the snapshot's public convention is a single
   `planObjects` block, and the fold seam is one line in `snapshot()`.)
2. **Q2 pins the gate at the lane boundary, not the interpreter.** The contract's P8 interpreter
   gate lives in the `waves.run` driver; asserting the full interpreter in a red-first row would
   couple the suite to the #74 driver lifecycle. The `plan_blocked {blockedByUnmet}` refusal is the
   gate's waitingOn projection — same law, assertable at the plan lane.
3. **Default authorize stays permissive.** The restricting `planAuthorize` is scoped to the H2.1
   rows. An all-rows-restricting authorize would route every worker's `plan.write` through the
   facade denial and break the lane-level refusal rows (A2/A4/L4/Q2), which assert typed codes the
   facade never reaches. The capability seam is pinned where it belongs (the review seat), and the
   roster seam pins H2.2.
4. **F2/F3 mint-first fixtures.** The raw-event rows now mint a real `plan.minted` first so the raw
   transition / `plan_auto_demote` batch folds against a live plan. This makes the no-op fold
   observable (the projection read-back) instead of merely registering the kind.
5. **W1 mints the incomplete task `doing`.** The blue-team's "trivially the minted `todo`" shortcut
   is closed by minting beta `doing` — only a running wave-close review can demote it.
6. **L5/W2 drive the review seat, not the `'orchestrator'` string.** The H4.2 re-open is the
   plan:* review authority's power; the capability-carrying `plan-review` principal under
   `planAuthorize` is the H2.1 admission, and the string-seat facade cannot admit it.
7. **R1's `openHost` signature threading.** The fixture's 4th arg became an options object
   (`{ authorize, planPolicy }`); R1's strict-deny mount updated to `{ authorize: async () => false }`
   so the facade-denial pin stays GREEN under the new helper.

## Suite-law hygiene (unchanged, re-verified)

- **Red-first at named stages**: 42 RED / 5 PIN; every RED row's first failing assertion is the
  named-stage failure; the sacred header attempt line is byte-untouched.
- **Hermetic**: every fixture world is mkdtemp'd under `os.tmpdir()` and reaped by `test.after`;
  `MockAdapter` local; no network/providers.
- **No clocks as controls**: the only timestamps are the fixed `NOW` passed to the surfaces'
  clock/now hooks; `watchdog.stallMs: 60_000` + the one-line comment in `createDriverFor`;
  store-only rows use a bare `CoordinationStore` with no watchdog.
- **Namespace imports**: invented surfaces ride `../src/index.mjs` namespaced bindings and the
  plan-object suite's own `planAuthorize` fixture (a test helper, never an imported module).
- **Sorted-key literals ACTUAL order**: `TASK_KEY_ORDER` / `OWNED_BY_KEY_ORDER` and the rebuilt
  `task()` literal are alphabetical; `localeCompare` never used.
- **No absolute line-window anchors**: X6 is content-anchored (`indexOf` region); no `:line` window
  anchors were introduced.
- **NUL discipline**: `application.mjs` / `coordination-store.mjs` are only touched through the
  imported surface exports and `grep -an`/`sed -n`; no NUL-bearing file is read whole.
