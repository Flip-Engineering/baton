# Issue #45 contract — startup reconciliation self-heals proof-complete owner residue

Status: implementation-grade contract v1, 2026-07-24. Ground truth: issue #45 (peer-filed,
acceptance fixture included there) plus the dogfood diagnosis from the grammar-M0 launch.

## The defect (reproduced exactly once, diagnosed twice)

A worktree owner receipt in `.git/baton/workspace-owners/<ws-id>.json` whose controller pid is
provably dead AND whose `worktree` path is absent makes EVERY later `openBaton` in the repo
fail at construction with `coordinator_cleanup_incomplete`, regardless of which controller or
deployment root opens. Mechanism: `reconcile()` (impl/src/worktree.mjs:1790-1860) reaches the
release step for such a receipt (authority `local_dead`/`dead_foreign` proven, branch handled,
capacity settled), then `releasePhysicalWorkspaceOwner(repoRoot, id, { requireAllocated: true })`
(worktree.mjs:723+) returns false because the receipt state is `'ready'` (session-bound receipts
leave `allocated`) — the guard exists for the publication path, not for reconcile, which has
already made the stronger proof. The error is then swallowed by `_trackStartupCleanup`
(coordinator.mjs:1343) and rethrown as the causeless `coordinator_cleanup_incomplete`.

## Rules

1. **Proof-complete residue self-heals at startup reconciliation.** A receipt is proof-complete
   residue when ALL of: the receipt parses and validates; its controller pid is dead under the
   pidStart-guarded identity check (`local_dead` or `dead_foreign` authority — the same check
   already applied at worktree.mjs:1816); its `worktree` path is absent (canonical
   including-missing-leaf comparison, no registered worktree at that path); and its branch, if
   present, carries exactly `baseSha` (a differing sha remains ambiguous, retained).
   Reconcile MUST remove such a receipt: branch deletion (when present), capacity settlement
   via `beforeOwnerCleanup`, then release with NO allocated-state gate — reconcile's own proof
   supersedes `requireAllocated`. The release emits the existing
   `worktree.branch_residue_reconciled` event (with the receipt's branch/baseSha/logicalTaskId/
   processGeneration) or a sibling `worktree.owner_residue_reconciled` when no branch remained;
   exactly one event per removed record, attributed to the record's own id.

2. **Ambiguous residue stays fail-closed — but the refusal names subjects and remedy.** Any
   receipt failing the proof-complete predicate (unparseable, authority `live_foreign` or
   ambiguous, worktree present or registered, branch sha mismatch, capacity settlement refused)
   is retained exactly as today, with its per-owner diagnostic code preserved
   (`workspace_owner_live_foreign`, `workspace_owner_ambiguous_foreign`,
   `workspace_owner_branch_mismatch`, `workspace_owner_receipt_invalid`,
   `workspace_owner_capacity_settlement_*`). The thrown `worktree_cleanup_failed` report is no
   longer swallowed: the coordinator's startup error MUST carry it as `cause` (with the
   per-owner diagnostics array) and its message MUST name each retained physicalOwnerId and the
   remedy: "delete the named records under .git/baton/workspace-owners/ after proving their
   controllers dead, or restore their worktrees". This closes the #10 AX finding
   (coordinator_cleanup_incomplete swallows its cause) in the same change.

3. **No quarantine-open.** Fail-closed for ambiguous residue is retained deliberately: an
   ambiguous record may belong to a live foreign controller, and two controllers must never
   claim the same physical resources. Self-heal applies only to the proof-complete shape of
   rule 1. (Issue #45 direction 3 is answered: steer-don't-gate does not apply where the gate
   is the only thing preventing a double-claim; the remedy is naming, which rule 2 delivers.)

4. **No behavior change for live or expected records.** Expected-active owners, live-foreign
   records, and records whose worktrees exist follow the current paths byte-identically
   (`workspace_owner_checkout_missing`, `workspace_owner_foreign_checkout_retained`,
   `workspace_owner_live_foreign` diagnostics unchanged).

## Red-first tests — `impl/test/issue45-startup-reconcile-red.test.mjs`

1. **R45-1 self-heal**: mint two owner receipts — one proof-complete (`state:'ready'`, dead
   pid with mismatched pidStart, absent worktree, branch present at baseSha) and one
   live-controller record beside it — open a deployment; open succeeds, the dead record is
   terminalized+removed (receipt file gone, branch gone, exactly one reconciled event
   appended, capacity reservation settled), the live record untouched byte-identically.
2. **R45-2 ready-state is the pinned shape**: R45-1's dead receipt MUST be in state `'ready'`
   (the exact shape that bricked opens); a second row pins `'allocated'` also self-healing.
3. **R45-3 ambiguous retained + named refusal**: a receipt with dead pid but branch sha ≠
   baseSha is retained; the open refuses; the error's message names the physicalOwnerId and
   the remedy sentence, and `error.cause.report.diagnostics` carries
   `workspace_owner_branch_mismatch` for that id.
4. **R45-4 live-foreign retained**: a receipt whose controller pid is alive (pidStart matches)
   is retained with `workspace_owner_live_foreign`; no release attempted.
5. **R45-5 worktree-present retained**: dead pid but worktree path exists →
   `workspace_owner_foreign_checkout_retained`, no release.
6. **R45-6 idempotence**: a second open after R45-1's heal performs no removals and appends no
   events.
7. **R45-7 unparseable receipt** is retained with `workspace_owner_receipt_invalid` and named
   in the refusal.

Every test uses fixed clocks and temp dirs; no live providers; deterministic.

## Verification

```text
node --test impl/test/issue45-startup-reconcile-red.test.mjs
```

then the canonical suite (`node impl/scripts/run-suite.mjs` from the repo root) fully green.
