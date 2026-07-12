# Phase 26 structured integration evidence — 2026-07-11

## Outcome

Phase 26 adds explicit `structured` integration while preserving `ff-only` as the default. Baton
never uses main as a merge workspace. It pins clean main and the accepted worker result, creates a
detached stage under `.baton/integrate/`, performs a real Git three-way merge, and invokes an
injected Mergiraf-class resolver only for unresolved regular text paths. Each resolver call sees
one bounded temporary conflict file in an isolated directory rather than the staging repository.

Missing tools, non-success or unknown status, parse fallback, unsupported paths, oversized input
or output, timeout, invalid UTF-8, remaining conflict markers, unmerged index entries, and
`git diff --check` failure refuse. A candidate must have the exact main/result parents. Baton then
runs the immutable pinned primary command in a distinct fresh worktree at that candidate. Only an
observed pass may guard a final main fast-forward, which rechecks that main is still clean and at
the pinned SHA.

The integration record pins before/result/merge-base/stage/after identities, per-path classes,
resolver evidence, and the fresh verdict. Refusal retains the accepted result ref. Post-effect
coordination failure poisons; restart replay does not invent success. Startup reconciliation
removes orphan stages because an old candidate without a live fresh verdict has no authority.

## Validation

- Numbered contract: `spec/phase26/structured-merge.md` (SM1–SM10).
- Focused gate: 14/14.
- Existing acceptance/worktree plus Phase 26 gate: 69/69.
- Canonical owned suite: 766/766; suite root reaped.
- Reds cover unavailable resolver, marker retention, parse fallback, deployment file ceiling,
  resolver isolation, clean divergent three-way merge, false-clean syntax failure, dirty main,
  main-advance race, post-main authority failure/replay, and orphan-stage reconciliation.
- The external `mergiraf` binary is absent on this host. Production invocation is implemented
  with fixed no-shell `mergiraf solve <path>` argv, bounded time/output, and a minimal environment;
  tests use an injected executor and do not claim a live external-tool pass.

## Recursive Baton scope review

Exact `grok-4.5` and `grok-composer-2.5-fast` independently reviewed the scope concurrently through
Baton before implementation. Both provider identities were observed on distinct overlapping PIDs,
both reports were freshly verified, both workers were normally killed, and every process,
worktree, runtime, and branch was reaped. Both converged on isolated staging, an injected external
resolver, mandatory fresh verification, and an explicit ban on CPG/fingerprint merge authority.
The reports and lifecycle ledger are under
`docs/reference/evidence/phase26-structured-merge-scope-grok-review-2026-07-11/`.

A second concurrent exact-model pass reviewed the committed implementation. Grok 4.5 found that
NUL-containing Git-binary conflicts could reach a cooperative resolver; Composer found a
delimiter-free marker evasion and ambient `GIT_*` control of local Git subprocesses. All three now
have reds. Binary conflicts refuse before resolver invocation, marker scanning rejects any run of
seven or more diff3 marker characters at line start, and local worktree Git strips ambient Git
variables, disables system/global configuration, and disables hooks for merge/commit. The initial
implementation reports and complete kill/reap ledger are under
`docs/reference/evidence/phase26-structured-merge-implementation-grok-review-2026-07-11/`.

The first concurrent final retry also exposed an operator-cleanup hazard: while recovering disk
headroom, an overbroad stale-log pattern deleted the active runner log directory. Baton poisoned
immediately, made no review claim, and reaped all provider and Git ownership. The runner now marks
its active log root `ACTIVE_DO_NOT_REAP` and supports exact single-model closure runs for bounded
disk environments. That failed evidence is retained under
`docs/reference/evidence/phase26-structured-merge-final-grok-review-2026-07-11/`.

Sequential exact-model closure was then used without weakening model identity or lifecycle gates.
Grok 4.5 found no remaining actionable defect after the first correction set. Composer found one
adjacent asymmetry: binary NUL was rejected before resolver invocation but not if injected into
the resolver output. Output bytes now receive the same `structured_binary_conflict` gate before
UTF-8/marker acceptance, and one red exercises both pre- and post-resolver binary refusal. The
pre-correction reports are retained under
`docs/reference/evidence/phase26-structured-merge-closure-grok45-2026-07-11/` and
`docs/reference/evidence/phase26-structured-merge-closure-composer-2026-07-11/`.

Composer's next exact-model pass found that lexical conflict-path confinement was not sufficient
against a parent directory swapped to an escaping symlink between the pre-resolver read and the
post-resolver write. Baton now canonical-realpath confines the conflict before reading and requires
the path to retain that exact canonical identity immediately before writing. A hostile timed swap
refuses `structured_unsupported_path`, leaves main pinned, and leaves the external sentinel
untouched. That report and lifecycle proof are under
`docs/reference/evidence/phase26-structured-merge-definitive-composer-2026-07-11/`.

The next closure attempt showed that even a single reviewer could exhaust the host while the trust
gate checked out every historical evidence ledger merely to verify one report. Baton still killed
and reaped the provider, but the report could not be trusted. `freshVerifySandbox` now supports an
explicit list of safe relative literal paths, creates a no-checkout detached worktree, applies a
non-cone exact sparse projection, and then verifies the same full commit identity. The recursive
review runner selects only its exact report paths; ordinary product verification stays full by
default. A worktree red proves the report is present, unrelated files are absent, the exact commit
is checked out, and traversal is refused. The failed full-checkout evidence is retained under
`docs/reference/evidence/phase26-structured-merge-sparse-red-composer-2026-07-11/`.

The first sparse retry then exposed an unrelated but live Baton control seam: an approval raced a
closed Grok stdin and Node emitted an unhandled asynchronous `EPIPE`. `_writeRaw` is now an owned
promise-based delivery, stdin has an error consumer, request RPCs reject their exact pending call,
and steer/interrupt/approval return refused delivery instead of emitting false success. Approval
waits are consumed only after the response enters the wire. The 32/32 Grok adapter gate includes a
closed-pipe red and the canonical suite remains green.

## Honest boundary

This is syntax-aware structured integration, not semantic merge. Mergiraf can reduce textual
conflicts but cannot prove behavior. Baton's fresh pinned check can still be weak. CPG deltas and
behavioral fingerprints may later escalate review or refusal, but there is deliberately no hook by
which either can advance main or skip verification. True data/control-flow merge remains a
catalogued research bet pending an adoptable external engine, measured residual demand after this
rung, and an evidence-backed false-clean advantage.
