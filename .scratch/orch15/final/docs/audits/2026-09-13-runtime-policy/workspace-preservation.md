# Workspace content preservation

2026-09-13. DeepSeek Flash implemented and revised this change through Baton; root reviewed the revisions and integrated capacity settlement.

`reap` and startup `reconcile` previously force-removed owned worktrees even if their controller had died before capturing uncommitted work. A dead controller, stopped session or `force` option does not prove that a checkout is disposable.

The destructive boundary now observes tracked changes, staged content, untracked files and Git-ignored files. Unknown or unreadable content retains the checkout with a typed `WorkspacePreservationError` and a useful content observation. A foreign repository at the same path is retained. Reconciliation reports retained owners separately from removals and preserves their capacity reservations.

Only copied dependencies and toolchain targets attested by the workspace metadata are excluded from the untracked walk. An independent tracked-file observation prevents those exclusions from hiding force-added or modified source. Exclusions are literal paths. No generic discard-authorization API, caller-declared disposable-path API or arbitrary input-size caps were added.

The facade removes a clean checkout while retaining its common-Git owner receipt, then settles capacity, then releases the receipt. A content-preservation refusal leaves every resource intact. A later capacity failure retains the exact receipt and reservation for retry even though the checkout is already absent. Coordinator cleanup exposes the preservation refusal code instead of flattening it into a generic cleanup error.

## Evidence and limits

The first DeepSeek contribution `7db48f8380437cdfb8af51ef3efa324a5c7d27e2` passed its initial Baton check. Root rejected its unnecessary discard API and incomplete ignored-file coverage. Revision `900c4a0cded86c1f7c6e660f9f765346685f4a8d` addressed those concerns but failed Baton's independent check on a `/tmp` versus `/private/tmp` assertion. Root corrected that assertion and the tracked-path exclusion gap, then added facade capacity-retention and cleanup-retry tests.

Tests use real Git worktrees: staged, unstaged, deleted, untracked and ignored content; generated dependency directories; force-added source within those directories; foreign active controllers and foreign repositories; startup reconciliation; exact removal; and capacity failures/retries. Test output, rather than the worker's own reported pass count, is the acceptance evidence.

This change preserves uncommitted content by retaining its checkout. It does not yet implement shared multi-holder custody or automatically publish orphaned work. Retaining ignored content is deliberately separate from including it in a contribution. Already-committed but unpinned orphan branches and invisible index flags need further custody review before the shared-workspace feature is complete.
