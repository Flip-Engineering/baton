# arch-publish-contention — two attempts publishing to one declared ref

## Claim

Target contention is a step the composition's final gap table did not name, and it has a disposition at
the pin: an attempt that publishes without reading the declared ref first is refused by the transport
because the update is not a fast-forward, a later attempt serialises by reading the ref and rebasing
onto it, and an earlier attempt's completion claim must then say what became of its commit — the ref no
longer names it, and it is still preserved as an ancestor of the commit that replaced it.

This is the case the external review lists beside destination substitution and a lost response
(`../reviews/codex/codex-architecture-review.md`, finding 2: "target contention"). The composition's
table named the other two; this corpus names this one and measures it.

## Files

| File | Holds |
|---|---|
| `arch-publish-contention.sh` | the four stages: A publishes, B publishes blind, B serialises, A's claim is re-read |
| `arch-publish-contention.evidence.md` | this record |

## Host and toolchain

- Host: Darwin 27.0.0, arm64 (Apple M4); git 2.50.1.
- All state is under `.scratch/arch-publish-contention/`, which the repository ignores. Fixed commit
  dates and identity make every sha identical on every run; the base is the same `aa573951…` the other
  publication fixtures produce.

## Command and output

```sh
export PATH="$PWD/.bend/bin:$PATH" BEND_NO_TELEMETRY=1
sh docs/bend2/examples/arch-publish-contention.sh
```

```text
### the base
base=aa573951a310e1a0679461b42bb44b79c60f9d60
### two attempts clone the declared destination
squash_a=087f98660bfab8f7b4e9fba30a6a9e2df6aa465d
squash_b=9a92c5d57cac6662e0714feaf8f6491f19e97d85
### stage 1: attempt A publishes to the declared ref
declared_ref=087f98660bfab8f7b4e9fba30a6a9e2df6aa465d
### stage 2: attempt B publishes to the same ref without reading it first
b_push=rejected_non_fast_forward
declared_ref=087f98660bfab8f7b4e9fba30a6a9e2df6aa465d
b_publication=not_established
### stage 3: attempt B reads the ref, rebases onto it and publishes
squash_b_rebased=f5c9dc1a8520d035e10d4eac9bfc52fed9fda9bd
declared_ref=f5c9dc1a8520d035e10d4eac9bfc52fed9fda9bd
### stage 4: attempt A's completion claim, re-read after B's publication
a_record=087f98660bfab8f7b4e9fba30a6a9e2df6aa465d
a_completion=superseded
a_commit_preserved=yes
declared_ref=f5c9dc1a8520d035e10d4eac9bfc52fed9fda9bd
supersession_is_distinct_from_loss=true
```

Exit code 0, and two clean runs are byte-identical.

## What each stage establishes

| Stage | Evidence |
|---|---|
| 1 | Attempt A's squashed commit is at the declared ref: `declared_ref=087f9866…`. |
| 2 | Attempt B, publishing without reading the ref, is refused: `b_push=rejected_non_fast_forward`, `b_publication=not_established`, and the declared ref still names A's commit. The transport's own rule is what serialises the two attempts; no local check was needed to keep B from overwriting A. |
| 3 | B reads the ref, rebases its change onto A's commit and publishes: the ref advances to `f5c9dc1a…`, a descendant of A's commit. Both landings are on the destination in landing order. |
| 4 | A's record, re-read, reports `a_completion=superseded` rather than a match, and `a_commit_preserved=yes`, because A's commit is an ancestor of the ref that replaced it. |

## Why the last stage is the finding

A completion record that stores only "the destination held my commit when I looked" is wrong the moment
another attempt publishes: the claim was true and is no longer the state. The distinction the table did
not name is three-valued, and a receipt has to carry which value it asserts:

- **holds the ref** — the declared ref names this attempt's commit (the other corpora's
  `observed_match`);
- **superseded, preserved** — the ref names a descendant of this attempt's commit, so this attempt's
  artifact is part of the destination's history and its work is not lost (`a_completion=superseded`,
  `a_commit_preserved=yes` here);
- **absent** — the ref names neither this commit nor a descendant of it, which is the case a rewritten
  or rolled-back destination produces and the one that needs the loudest record.

The third value is not produced by this fixture: producing it needs a force-push or a rewind, and the
deployment's own landing refuses neither by policy at this pin — that policy is a decision the operator
owns, not a gap in the composition.

## What this does not establish

- **Two processes are simulated by two clones.** They are separate repositories and separate git
  invocations, but one shell drives both.
- **No crash is injected between a push and its observation**, so the interleaving where a push
  succeeds and the observing process dies is still `arch-publish-target.sh` stage 4's case.
- **The local compare-and-swap on the target ref is not exercised**, only the destination's
  fast-forward rule. `integrate_target_moved` in the plan names the local half.

## Verdict

The claim holds, and the gap table now has this step: target contention is refused by the transport,
resolved by reading and rebasing, and a completion record must distinguish holding the ref from being
superseded-but-preserved.

## Related

- `arch-publish-bind.evidence.md`: the final gap table this corpus extends.
- `arch-publish-target.evidence.md`, `arch-publish-content.evidence.md`: the publication and content
  halves.
- `controlled-remote.evidence.md` (bend2-orchestrator5): the publication mechanism.
- `../rewrite-plan.md`: `integrate_target_moved` and the Phase 4 case list.
