# Issue #45 contract — startup reconciliation self-heals proof-complete owner residue

Status: implementation-grade contract v2, 2026-07-24. Ground truth: issue #45 (peer-filed,
acceptance fixture included there) plus the dogfood diagnosis from the grammar-M0 launch.

**v2:** adversarial red-team R45R (explore seat; verdict SOUND-WITH-FOLDS) folded: R45R-1 the
open-refusal set is now enumerated explicitly (rule 2) and the rule 2/4 conflict resolved
(live-foreign PROCEEDS; expected-owner retentions never throw — issue5 pin); R45R-2 R45-5
re-specified to the reachable `workspace_owner_dead_foreign_checkout` shape; R45R-3 facade
log-forwarding named as part of rule 1 (the reconciled events have never fired in production
without it); R45R-4 R45-6 scoped to reconcile-emitted effects (phantom-orphan replay behavior
acknowledged, unchanged); R45R-5 refusal message composition and BOTH swallow sites named;
R45R-6 `'stopped'` receipt state added to the self-heal set; R45R-7 diagnostic list made
illustrative; R45R-8 no-branch event payload pinned; R45R-9 publication temps declared out of
scope.

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
   supersedes `requireAllocated`. The gate is dropped ONLY at the reconcile call site
   (worktree.mjs:1853); the publication-path callers keep `requireAllocated` untouched. All
   three receipt states self-heal: `'allocated'`, `'ready'`, and `'stopped'` (the closed state
   set, worktree.mjs:344). The removal emits exactly one event per removed record, attributed
   to the record's own id: the existing `worktree.branch_residue_reconciled` when a branch was
   present, or a new sibling `worktree.owner_residue_reconciled` when none remained — both
   carrying `{branch, baseSha, logicalTaskId, processGeneration}` from the receipt (the no-branch
   variant still has receipt.branch/baseSha to report). Event-kind minting is safe: log append
   is structural (log.mjs:147-163) and replay folds unknown kinds via `default: break`
   (coordinator.mjs:11824). REQUIRED ENABLER (R45R-3): the facade reconcile call
   (impl/src/index.mjs:960-968) currently forwards no `log`, so these events have never fired
   in production (logEvent no-ops, worktree.mjs:753-755); the implementation MUST add
   `...(opts.log ? { log: opts.log } : {})` there, matching the existing forwarding pattern
   (index.mjs:322, :878). Publication temp files (`ws-*.json.tmp-*`) are OUT OF SCOPE — they
   take the loop-1 candidate path untouched (R45R-9).

2. **Ambiguous residue is retained — the open-refusal set is enumerated, and the refusal
   names subjects and remedy.** REFUSAL SET (the open refuses): records in the receipt-only
   loop that are NOT expected-active owners and are retained as ambiguous — authority
   `ambiguous_foreign`, `workspace_owner_branch_mismatch`, `workspace_owner_receipt_invalid`,
   or `workspace_owner_capacity_settlement_*`. This is a deliberate diagnostics→refusal
   promotion for those four shapes, named here so no implementer infers it. PROCEED SET (the
   open succeeds, record retained with its diagnostic): `live_foreign` records,
   `workspace_owner_dead_foreign_checkout`, every checkout-present/registered shape, and ALL
   expected-owner/binding retentions — expected-owner retention NEVER throws
   (issue5-cross-controller-lifecycle-recovery.test.mjs:543-547 pins startupReady succeeding
   with a malformed EXPECTED receipt; phase92.2-physical-workspace-owner-red.test.mjs:281-336
   pins live-foreign second opens succeeding). Diagnostic codes are preserved illustratively
   (`workspace_owner_ambiguous`, `workspace_owner_dead_foreign_checkout`,
   `workspace_owner_checkout_missing`, `workspace_owner_foreign_checkout_retained`,
   `workspace_owner_live_foreign`, `workspace_owner_ambiguous_foreign`,
   `workspace_owner_branch_mismatch`, `workspace_owner_receipt_invalid`,
   `workspace_owner_capacity_settlement_*` — the closed set as it exists, not a new taxonomy).
   The thrown `worktree_cleanup_failed` is no longer swallowed: the coordinator's startup
   error MUST carry it as `cause` at BOTH swallow sites (coordinator.mjs:1406 sync and :1415
   async — `_trackStartupCleanup` is defined at :1402; the v1 citation of :1343 was stale),
   and its message MUST name exactly the refusal-set records — diagnostic rows where
   `retained === true` PLUS any physicalOwnerId appearing in `report.errors` strings (a record
   that fails mid-removal, e.g. `git branch -D` refusing at worktree.mjs:1852, has no
   diagnostic row and MUST NOT be omitted) — and the remedy: "delete the named records under
   .git/baton/workspace-owners/ after proving their controllers dead, or restore their
   worktrees". This closes the #10 AX finding (coordinator_cleanup_incomplete swallows its
   cause) in the same change; CLI/MCP rendering needs no change (CLI renders code+message,
   scripts/baton.mjs:124; MCP the code, mcp-northbound.mjs:1143).

3. **No quarantine-open.** Fail-closed for ambiguous residue is retained deliberately: an
   ambiguous record may belong to a live foreign controller, and two controllers must never
   claim the same physical resources. Self-heal applies only to the proof-complete shape of
   rule 1. (Issue #45 direction 3 is answered: steer-don't-gate does not apply where the gate
   is the only thing preventing a double-claim; the remedy is naming, which rule 2 delivers.)

4. **No behavior change for live, expected, or checkout-present records.** Expected-active
   owners, live-foreign records (which PROCEED — the open succeeds, rule 2's proceed set), and
   records whose worktrees exist follow the current paths byte-identically
   (`workspace_owner_checkout_missing`, `workspace_owner_foreign_checkout_retained`,
   `workspace_owner_dead_foreign_checkout`, `workspace_owner_live_foreign` diagnostics
   unchanged).

## Red-first tests — `impl/test/issue45-startup-reconcile-red.test.mjs`

1. **R45-1 self-heal**: mint two owner receipts — one proof-complete (`state:'ready'`, dead
   pid with mismatched pidStart, absent worktree, branch present at baseSha) and one
   live-controller record beside it — open a deployment; open succeeds, the dead record is
   terminalized+removed (receipt file gone, branch gone, exactly one reconciled event
   appended, capacity reservation settled), the live record untouched byte-identically.
2. **R45-2 all three states self-heal**: R45-1's dead receipt MUST be in state `'ready'`
   (the exact shape that bricked opens); further rows pin `'allocated'` and `'stopped'`
   (worktree.mjs:344's closed set — `'stopped'` is equally bricked by the gate today, R45R-6)
   self-healing identically.
3. **R45-3 ambiguous retained + named refusal**: a receipt with dead pid but branch sha ≠
   baseSha is retained; the open refuses; the error's message names the physicalOwnerId and
   the remedy sentence, and `error.cause.report.diagnostics` carries
   `workspace_owner_branch_mismatch` for that id.
4. **R45-4 live-foreign retained**: a receipt whose controller pid is alive (pidStart matches)
   is retained with `workspace_owner_live_foreign`; no release attempted.
5. **R45-5 foreign dead-pid with worktree present** (R45R-2 re-spec): a FOREIGN-deployment
   receipt whose controller pid is dead and whose worktree path EXISTS is claimed by loop 1
   and retained as `workspace_owner_dead_foreign_checkout` (worktree.mjs:1637-1646) — the
   only reachable code for this shape; no release attempted, open proceeds (proceed set).
6. **R45-6 idempotence, scoped** (R45R-4): a second open after R45-1's heal performs no
   further removals and appends no further RECONCILE-EMITTED events (no additional
   `worktree.branch_residue_reconciled`/`worktree.owner_residue_reconciled`). Acknowledged and
   unchanged: the healed ws-keyed event log replays on the next open into exactly one
   `control.recovery_terminalized` plus a phantom `orphaned` worker registration
   (coordinator.mjs:11866-11877, :11968-12046) — the pre-existing tolerated behavior for
   ws-keyed logs, out of scope for this contract.
7. **R45-7 unparseable receipt** is retained with `workspace_owner_receipt_invalid` and named
   in the refusal.

Every test uses fixed clocks and temp dirs; no live providers; deterministic.

## Verification

```text
node --test impl/test/issue45-startup-reconcile-red.test.mjs
```

then the canonical suite (`node impl/scripts/run-suite.mjs` from the repo root) fully green.
