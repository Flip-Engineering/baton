# Phase 26 — syntax-aware structured integration

Phase 26 adopts an external Mergiraf-class resolver as a lower R6 rung. It does not implement a
parser, subtree matcher, CPG merge, or behavioral-equivalence engine. `ff-only` remains the
default integration strategy. `structured` is explicit and local-only.

## SM1 — injected external resolver

The production resolver invokes `mergiraf solve <conflicted-path>` with fixed arguments, bounded
time/output, and no shell. Tests inject the executor. A missing, failed, timed-out, or unknown
resolver outcome refuses typed; Baton never relabels textual fallback as structured success.

## SM2 — main is never the staging workspace

Baton checks main cleanliness and pins its HEAD, then creates a detached integration worktree
under `.baton/integrate/`. The three-way merge, conflict resolution, index updates, and merge
commit occur only there. Any pre-finalize failure leaves main HEAD, index, and worktree unchanged.

## SM3 — exact Git identities

The stage pins `beforeSha`, accepted `resultSha`, their merge base, a two-parent `stageSha`, and the
conflicted paths. Invalid commits, an already-integrated result, dirty main, or a main advance
between staging and finalize refuses without rewriting history.

## SM4 — fail-closed conflict classification

A clean Git three-way merge is `clean_textual`. Each unresolved regular text path is passed to the
external resolver and may become `structured_resolved`. Binary/deleted/unsupported paths,
resolver parse fallback, non-success, remaining unmerged index entries, or any diff3 conflict
marker refuse. Conflict classification is syntax/tool evidence, not a semantic-safety claim.

## SM5 — immutable candidate commit

Only a fully resolved and `git diff --check`-clean stage becomes a merge commit with exact left and
right parents. The candidate is not main and conveys no acceptance by existing alone.

## SM6 — fresh post-merge verification

Before main moves, Baton creates a distinct fresh verification worktree at `stageSha` and runs the
task's immutable pinned primary verification command. The hub must observe its expected exit.
Failure is `structured_verification_failed`; the stage is reaped, the accepted result remains
pinned, and main is unchanged. Existing result-level red/green, coverage, mutation, and oracle
evidence remain attached; Phase 26 does not fabricate a second red baseline for the combined tree.

## SM7 — one guarded main update

Only after SM6 passes may Baton require main still clean and exactly at `beforeSha`, then
fast-forward it to `stageSha`. Success records before/result/base/stage/after SHAs, per-path
classes, resolver identity, and the fresh verdict. No push or deploy is implied.

## SM8 — replay and authority

Operational success plus the coordination integration batch remains the only replayable success.
An asymmetric decision, candidate commit, resolver report, CPG delta, or behavioral fingerprint
cannot reconstruct integration. Post-effect authority failure poisons and requires reconciliation;
Baton never silently hard-resets user state.

## SM9 — cleanup and retention

Integration and verification worktrees are reaped on success, refusal, timeout, and thrown error.
Successful main retains the result and releases its result pin. Refusal retains
`refs/baton/results/<sha>` for recovery. No stage branch is created.

## SM10 — honest semantic boundary

CPG overlap and behavioral fingerprints are advisory only and may increase review or refuse; they
cannot skip SM6 or advance main. True semantic merge means resolving incompatible data/control-flow
edge mutations with sound source round-trip. It remains catalogued research until an adoptable
external engine and measured false-clean advantage exist. Redirect to structured merge plus fresh
verification when that evidence is absent; retain a tombstone if evaluation retires the bet.
