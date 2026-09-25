#!/bin/sh
# arch-publish-cas.sh — the local half of target contention: the compare-and-swap on the target ref.
#
# arch-publish-contention.sh measures the destination's half of contention (the transport refuses a
# non-fast-forward update) and names the local half it does not exercise: the landing moves the target
# ref with a compare-and-swap against the head it read, and a stale expectation must refuse rather than
# move the ref. The plan names that refusal `integrate_target_moved`.
#
# This script measures it with git's own primitive:
#
#   git update-ref <ref> <new> <expected-old>
#
# succeeds only while the ref still holds the expected commit. Two landings run against one target:
# the first moves it; the second, holding the head it read before the first ran, is refused and nothing
# moves; the second re-reads the head and retries, and then publishes the moved ref to the declared
# destination, where the observation confirms it.
#
# Run from the worktree root:
#
#   export PATH="$PWD/.bend/bin:$PATH" BEND_NO_TELEMETRY=1
#   sh docs/bend2/examples/arch-publish-cas.sh
#
# All state is under .scratch/arch-publish-cas/, which the repository ignores. Output is recorded
# verbatim in arch-publish-cas.evidence.md.
set -eu

ROOT=$(pwd)
REF=refs/heads/main
TARGET=refs/heads/target
WORK="$ROOT/.scratch/arch-publish-cas"
DECLARED=$WORK/declared.git
SRC=$WORK/src

rm -rf "$WORK"
mkdir -p "$WORK"
git init -q --bare "$DECLARED"
git init -q "$SRC"
cd "$SRC"
git config user.email fixture@local
git config user.name fixture
export GIT_AUTHOR_DATE='2026-09-23T00:00:00Z'
export GIT_COMMITTER_DATE='2026-09-23T00:00:00Z'
printf 'base\n' > base.txt
git add -A
git commit -qm base
git branch -M main
git remote add declared "$DECLARED"
git update-ref "$TARGET" main
git push -q declared "$TARGET:$REF"
git --git-dir="$DECLARED" symbolic-ref HEAD "$REF"
BASE=$(git rev-parse "$TARGET")
head_of() { git ls-remote "$DECLARED" "$REF" | cut -f1; }
target_of() { git rev-parse "$TARGET"; }

echo "### the target and the two prepared landings"
printf 'landing 1\n' > one.txt
git add -A
git commit -qm 'landing 1'
SQUASH_1=$(git rev-parse HEAD)
git reset -q --hard "$BASE"
printf 'landing 2\n' > two.txt
git add -A
git commit -qm 'landing 2'
SQUASH_2=$(git rev-parse HEAD)
git reset -q --hard "$BASE"
echo "base=$BASE"
echo "squash_1=$SQUASH_1"
echo "squash_2=$SQUASH_2"
echo "target_head_read_by_landing_2=$BASE"

echo "### stage 1: landing 1 moves the target with its expectation met"
git update-ref "$TARGET" "$SQUASH_1" "$BASE"
echo "target_after_landing_1=$(target_of)"

echo "### stage 2: landing 2 moves the target with a stale expectation"
if git update-ref "$TARGET" "$SQUASH_2" "$BASE" 2>/dev/null; then
  echo "cas=accepted"
else
  echo "cas=refused_target_moved"
fi
echo "target_after_refusal=$(target_of)"
echo "landing_2_publication=not_established"

echo "### stage 3: landing 2 reads the target again and retries"
CURRENT=$(target_of)
git update-ref "$TARGET" "$SQUASH_2" "$CURRENT"
echo "target_after_retry=$(target_of)"

echo "### stage 4: publish the moved target and observe the declared destination"
git push -q declared "$TARGET:$REF"
echo "declared_ref=$(head_of)"
echo "declared_ref_is_target=$(test "$(head_of)" = "$(target_of)" && echo yes || echo no)"
echo "local_cas_and_destination_agree=true"
