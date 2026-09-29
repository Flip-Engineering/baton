# arch-publish-cas — the local half of target contention

## Claim

The landing's move of its own target ref is a compare-and-swap, and a stale expectation refuses without
moving anything: a second landing that read the target's head before the first landing moved it is
refused, nothing moves, and after re-reading the head it retries and publishes, with the declared
destination agreeing with the local target.

This closes the limit `arch-publish-contention.sh` named for itself: that corpus measures the
destination's half of contention (the transport refusing a non-fast-forward update) and does not
exercise the local half. The plan names the local refusal `integrate_target_moved`.

## Files

| File | Holds |
|---|---|
| `arch-publish-cas.sh` | the four stages: landing 1's move, landing 2's stale move, its retry, and publication |
| `arch-publish-cas.evidence.md` | this record |

## Host and toolchain

- Host: Darwin 27.0.0, arm64 (Apple M4); git 2.50.1.
- All state is under `.scratch/arch-publish-cas/`, which the repository ignores. Fixed commit dates and
  identity make every sha identical on every run; the base is the same `aa573951…` the other
  publication fixtures produce.

## Command and output

```sh
export PATH="$PWD/.bend/bin:$PATH" BEND_NO_TELEMETRY=1
sh docs/bend2/examples/arch-publish-cas.sh
```

```text
### the target and the two prepared landings
base=aa573951a310e1a0679461b42bb44b79c60f9d60
squash_1=78cc684d9c030f177bc97aa160351bd13128a569
squash_2=6588d6f5e4296e6f8b04d9db19eac5d69e39c67d
target_head_read_by_landing_2=aa573951a310e1a0679461b42bb44b79c60f9d60
### stage 1: landing 1 moves the target with its expectation met
target_after_landing_1=78cc684d9c030f177bc97aa160351bd13128a569
### stage 2: landing 2 moves the target with a stale expectation
cas=refused_target_moved
target_after_refusal=78cc684d9c030f177bc97aa160351bd13128a569
landing_2_publication=not_established
### stage 3: landing 2 reads the target again and retries
target_after_retry=6588d6f5e4296e6f8b04d9db19eac5d69e39c67d
### stage 4: publish the moved target and observe the declared destination
declared_ref=6588d6f5e4296e6f8b04d9db19eac5d69e39c67d
declared_ref_is_target=yes
local_cas_and_destination_agree=true
```

Exit code 0, and two clean runs are byte-identical.

## What each stage establishes

| Stage | Evidence |
|---|---|
| 1 | Landing 1's expectation is met, so its move of the target succeeds: `target_after_landing_1=78cc684d…`. |
| 2 | Landing 2's expectation is the head it read before landing 1 ran, so the move is refused: `cas=refused_target_moved`, and the target is exactly where landing 1 left it. A refused move is not a partial move. |
| 3 | Landing 2 reads the target again and retries against the current head: the target advances to its commit. |
| 4 | The moved target is published to the declared destination and the ref read back equals the local target: `local_cas_and_destination_agree=true`. |

## The two halves of contention, side by side

| Half | Mechanism | Refusal | Corpus |
|---|---|---|---|
| Local target move | `git update-ref <ref> <new> <expected-old>` | the update is refused and nothing moves (`integrate_target_moved`) | this one, stage 2 |
| Destination update | `git push <declared> <squash>:<ref>` | the transport refuses a non-fast-forward update | `arch-publish-contention.sh`, stage 2 |

Both are refusals rather than resolutions: neither mechanism merges, rebases or retries on its own. The
serialisation in both corpora is done by the attempt that lost, reading again and re-preparing — which
is why a landing's record needs the three-valued completion claim the contention corpus names.

## What this does not establish

- **Both landings run in one repository and one shell.** Two concurrent processes contending for the
  same ref are not run; the compare-and-swap's atomicity is git's, and the fixture exercises the stale
  case rather than a true race.
- **The real landing's local ref is a branch in a scratch checkout**, not this fixture's; the primitive
  is the same (`impl/src/worktree.mjs` moves the target with an expected-head check).
- **No crash is injected between the retry and the publication.**

## Verdict

The claim holds. With this corpus the contention step is measured on both halves: the local
compare-and-swap refuses a stale move, the destination refuses a non-fast-forward update, and the
attempt that lost serialises by reading again.

## Related

- `arch-publish-contention.evidence.md`: the destination's half and the three-valued completion claim.
- `arch-publish-bind.evidence.md`: the final gap table.
- `../rewrite-plan.md`: CL-13's `integrate_target_moved` and the Phase 4 case list.
