CONTRACT-QA v1

# LIFECYCLE-CONTRACT COORDINATOR QA — the four wave-lifecycle contracts (filesystem · launch/receipt · member-creation · ledger invariant)

[attempt: a8f2584a-3282-4825-b1d0-5aa4a6b69067 coordinator]

Coordinator: v4-pro seat, `lifecycle-contracts-2026-08-14-wave-a` (redrive dispatch). Cross-check
of the four package-③ contract rows against the shared frame `foundry-brief.md` (this dir).

## Signal state

`signalOnMembersDone` has **NOT fired**. On-disk verification per the #174 law (sibling
worktrees at `../../wt/ws-*/`; silence is not death) confirms the four contracts have not
landed anywhere. A bounded poll of every sibling worktree's
`docs/reference/evidence/lifecycle-contracts-2026-08-14/` for
`contract-filesystem.md` / `contract-launch.md` / `contract-members.md` /
`contract-ledger.md` returned **absent** on every tick (~9 minutes, 20 s cadence), and all
sibling worktrees have clean git status with no files modified since spawn. A second bounded
re-poll after the checkpoint nudge (~5 minutes, 20 s cadence) returned the same result — still
absent, no new worktree seats. The rows are not dead-and-committed; they are **un-landed** —
no contract text exists to cross-check. This QA therefore records the gap per contract and
does **not** fabricate contract content, per the foundry law "Cited evidence, no fabrication".

## On-disk verification record (#174 law)

| Deliverable (wavefile `report`) | my worktree | 3 sibling worktrees | Verdict basis |
|---|---|---|---|
| `contract-filesystem.md` (row-lc-fs) | absent | absent | no text to audit |
| `contract-launch.md` (row-lc-launch) | absent | absent | no text to audit |
| `contract-members.md` (row-lc-members) | absent | absent | no text to audit |
| `contract-ledger.md` (row-lc-ledger) | absent | absent | no text to audit |

Sibling worktrees observed under `../../wt/`: `ws-5d55156a…`, `ws-d64e3539f…`,
`ws-e171ae04…` (plus this coordinator worktree `ws-497ecf2b…`). All clean, no
`contract-*.md`, no `notes-*.md`, no partial writes. One of the five member seats has no
worktree at all as of this check.

## Seed-anchor citation audit (the ground truths the contracts must cite)

Because the contracts are absent, their citations cannot be audited directly. I instead
spot-checked the row briefs' cited code anchors — the seed each contract must ground in —
against the real code (`impl/src/`). A wrong seed citation is a finding the contract rows
must not inherit:

| Anchor (row brief) | Real code | Result |
|---|---|---|
| `workflow-interpreter.mjs:39` — objectiveRef admission 64 KiB (#207) | `const OBJECTIVE_REF_MAX_BYTES = 64 * 1024; // D5 …` | ✓ exact |
| `limits.mjs:56` — 4096-byte `run.objective` cap (#207) | `'run.objective': { … value: 4096, unit: 'bytes', graceful: 'spill-digest-citation', enforcedAt: 'application run.start admission', refusalCode: 'spill_body_exceeded' }` | ✓ exact |
| `workflow-interpreter.mjs:525` — the base-commit line (#168) | line 525 is `objective: renderObjective(repoRoot, member, salt),`; the base commit `git … commit -q -m 'baton workflow base …'` is at **:540** | ✗ **finding — off by 15 lines** |
| `application.mjs:11631-11646` — `runWorkflow` synchronous entry (#173) | `async runWorkflow(rawRequest, rawPrincipal) { … return runWorkflow(baton, specOrPath, { repoRoot, driver: … }); }` delegates the full drive to the interpreter's `runWorkflow` | ✓ (the "full drive" await lives in the interpreter, cited separately at 534-609) |
| `wave.mjs` — `createWave` captured `startError` (#207) | `createWave` at :189; `startError` captured at :235/:250, surfaced at :353/:472 | ✓ |

**Finding 1 (citation):** row-lc-fs's seed cites the base-commit line at
`workflow-interpreter.mjs:525`; the commit is at `:540`. The contract row must pin the
correct anchor or its #168 ground truth will cite the objective-rendering line, not the
side-effect commit.

## Per-contract QA

### row-lc-fs — filesystem lifecycle (#168 / #172 / #185)

- **VERDICT: GAP — needs-fold (un-landed).** Named gap: `contract-filesystem.md` does not
  exist in any worktree, so its ground truths, D-decisions, refusal vocabulary, and red-first
  acceptance pins cannot be checked.
- **(a) citation audit:** un-runnable on the contract; seed anchors spot-checked above
  (Finding 1: `:525` → `:540`).
- **(b) acceptance pins:** un-runnable — no pins landed; shallow-greenability cannot be
  tested against absent pins. The fold stage must ensure each #168/#172/#185 pin is RED at
  HEAD at a named stage and green only for a correct impl.
- **(c) refusal vocabulary:** un-runnable — no closed, typed, surface-constant vocabulary
  landed.
- **Fold instruction:** re-dispatch row-lc-fs; require the corrected base-commit anchor
  (`:540`) and re-run the coordinator.

### row-lc-launch — launch/receipt honesty (#173 / #202 / #207)

- **VERDICT: GAP — needs-fold (un-landed).** Named gap: `contract-launch.md` absent.
- **(a) citation audit:** un-runnable on the contract; seed anchors `:39`, `limits.mjs:56`,
  `application.mjs:11631-11646`, `wave.mjs` verified ✓ (no seed-citation defect).
- **(b)/(c):** un-runnable — no pins, no refusal vocabulary landed.
- **Fold instruction:** re-dispatch; the #207 admission-alignment pin (64 KiB brief vs
  4096-byte `run.objective`) and the `startError`-on-the-receipt pin are the load-bearing
  rows; keep the `spill-digest-citation` graceful path in scope.

### row-lc-members — member-creation honesty (#199 / #200 / #204)

- **VERDICT: GAP — needs-fold (un-landed).** Named gap: `contract-members.md` absent.
- **(a)/(b)/(c):** un-runnable — no contract text landed.
- **Fold instruction:** re-dispatch; the #199 typed-event pin (creation failure emits typed
  events, never phantom) and the #200 task-id namespacing pin must both land. Note the
  cross-contract coupling with row-lc-launch's #207 below.

### row-lc-ledger — logged-invariant (#194 / #205)

- **VERDICT: GAP — needs-fold (un-landed).** Named gap: `contract-ledger.md` absent.
- **(a)/(b)/(c):** un-runnable — no contract text landed.
- **Fold instruction:** re-dispatch; the #194 model-visible-means-logged pin and the #205
  decision-lane-ledgers pin must land. Note the event-schema coupling with row-lc-members
  below.

## Boundary map (cross-contract coherence)

The four contracts share the wave lifecycle; their intended boundaries (from the row briefs)
are disjoint by seam but coupled at two points that the fold stage must pin explicitly, or
the four will overlap/gap:

1. **filesystem ↔ launch — run.start adjacency.** #168 (base commit captures dirty state)
   and #173 (synchronous full-drive blocking) both describe the run.start lifetime. No
   conflict, but the contracts must agree the git side-effect (#168) is filesystem's and the
   blocking/receipt behavior (#173) is launch's.
2. **launch ↔ members — the #207/#199 root-cause split (the critical coupling).** #207 (the
   64 KiB brief vs 4096-byte `run.objective` cap) is the *admission* root cause; #199
   (creation failures emit typed events) is the *event-emission* consequence. If members pins
   "no phantom failure" without naming that the cap mismatch is launch's fix, the two
   contracts gap on the same failure path. **Fold must state: #207 owns admission+`startError`
   wiring; #199 owns the typed-event guarantee the receipt consumes.**
3. **members ↔ ledger — the event-schema coupling.** #199 (failures must emit events) and
   #194 (model-visible means logged) are complementary halves of one store-completeness
   invariant. A creation-failure event that is emitted but carries insufficient payload to be
   reconstructable would satisfy #199 while violating #194. **Fold must pin one event schema
   both contracts cite.**
4. **launch — internal #202/#207 distinction.** #202 (bare-text `'Command executed
   successfully.'` response) and #207 (startError never reaches the receipt) are both
   receipt-shape honesty but distinct: #202 is response-shape, #207 is admission-alignment.
   A launch contract that merges them loses the refusal-vocabulary distinction.
5. **filesystem ↔ members — #185/#204.** #185 (member raw-fs escape) is write-scope
   confinement; #204 (resident drain-restart) is process lifecycle. Adjacent but disjoint
   seams — no overlap expected, no gap identified.

## Fold instruction set (concrete)

1. Re-dispatch all four rows (`row-lc-fs`, `row-lc-launch`, `row-lc-members`, `row-lc-ledger`)
   — their contracts are un-landed; there is nothing to fold.
2. Before re-dispatch, correct row-lc-fs's seed citation: base-commit anchor
   `workflow-interpreter.mjs:525` → `:540` (Finding 1).
3. Pin the #207/#199 boundary and the #199/#194 event schema at the fold stage (boundary map
   items 2–3) so the re-dispatched rows write coherent contracts.
4. Re-run the coordinator only after all four `contract-*.md` files land on disk (the #174
   law: verify, do not trust a missing `signalOnMembersDone`).
5. This QA is the coordinator's gap record, not a pass — no `sound` verdict is possible until
   the four contracts exist.

## Escalations

Two authority-class ambiguities are recorded with options (no DECISION_REQUEST bus is exposed
in this harness, so they are recorded here for the orchestrator rather than emitted):

- **DISPATCH-scope vs wavefile-harvest path.** This redrive dispatch scopes writes to
  `docs/reference/evidence/lifecycle-contracts-2026-08-14/redrive/**`, while the wavefile
  `harvest` reads `contract-qa.md` at the parent
  `docs/reference/evidence/lifecycle-contracts-2026-08-14/` path. **Options:** (a) the fold
  stage reads this redrive deliverable from `redrive/`; (b) the orchestrator re-routes the
  harvest to `redrive/contract-qa.md`; (c) a later, in-scope fold step copies it to the
  canonical path. This QA is written to `redrive/` and published to `redrive/shared/` because
  the dispatch constraint is the operative scope.
- **One member seat has no worktree.** Four worktrees exist for a five-seat wave
  (coordinator + four rows). **Options:** (a) a row is still queued to spawn; (b) one row
  seat was never dispatched. Either way the signal cannot fire until all four rows settle.

## Publish

Deliverable written to
`docs/reference/evidence/lifecycle-contracts-2026-08-14/redrive/contract-qa.md`; full text
published to `redrive/shared/contract-qa.md` (the `shared` publish, confined to the redrive
scope). Recorded here because the canonical `contract-qa.md` and `shared/` paths named by the
brief sit outside this dispatch's `redrive/**` write scope.
