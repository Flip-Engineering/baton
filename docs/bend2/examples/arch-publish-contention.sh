#!/bin/sh
# arch-publish-contention.sh — two attempts publishing to one declared ref.
#
# The composition's final gap table (arch-publish-bind.evidence.md) names destination substitution, a
# lost response and an ambiguous outcome, and it does not name the case the external review lists
# alongside them: target contention, where two attempts publish to the same declared ref. This script
# measures it:
#
#   stage 1  attempt A publishes its squashed commit;
#   stage 2  attempt B publishes to the same ref without reading it first, and the transport refuses
#            the update because the ref it names is not a descendant of what is there;
#   stage 3  attempt B reads the ref, rebases its change onto it and publishes;
#   stage 4  attempt A's completion claim is re-read afterwards: the ref no longer names A's commit,
#            and A's commit is still reachable from the ref it was superseded by.
#
# The last stage is the distinction the table did not name: "the destination holds the commit I
# published" and "the destination still preserves the commit I published" are different claims, and a
# completion record must say which one it makes.
#
# Run from the worktree root:
#
#   export PATH="$PWD/.bend/bin:$PATH" BEND_NO_TELEMETRY=1
#   sh docs/bend2/examples/arch-publish-contention.sh
#
# All state is under .scratch/arch-publish-contention/, which the repository ignores. Output is
# recorded verbatim in arch-publish-contention.evidence.md.
set -eu

ROOT=$(pwd)
REF=refs/heads/main
WORK="$ROOT/.scratch/arch-publish-contention"
DECLARED=$WORK/declared.git

rm -rf "$WORK"
mkdir -p "$WORK"
git init -q --bare "$DECLARED"
export GIT_AUTHOR_DATE='2026-09-23T00:00:00Z'
export GIT_COMMITTER_DATE='2026-09-23T00:00:00Z'
head_of() { git ls-remote "$DECLARED" "$REF" | cut -f1; }

echo "### the base"
git init -q "$WORK/seed"
cd "$WORK/seed"
git config user.email fixture@local
git config user.name fixture
printf 'base\n' > base.txt
git add -A
git commit -qm base
git branch -M main
git remote add declared "$DECLARED"
git push -q declared main
git --git-dir="$DECLARED" symbolic-ref HEAD "$REF"
echo "base=$(git rev-parse main)"

echo "### two attempts clone the declared destination"
git clone -q "$DECLARED" "$WORK/a"
git clone -q "$DECLARED" "$WORK/b"
cd "$WORK/a" && git remote rename origin declared
cd "$WORK/b" && git remote rename origin declared
cd "$WORK/a" && git config user.email fixture@local && git config user.name fixture
cd "$WORK/b" && git config user.email fixture@local && git config user.name fixture

cd "$WORK/a"
printf 'landing A\n' > a.txt
git add -A
git commit -qm 'landing A'
SQUASH_A=$(git rev-parse HEAD)
cd "$WORK/b"
printf 'landing B\n' > b.txt
git add -A
git commit -qm 'landing B'
SQUASH_B=$(git rev-parse HEAD)
echo "squash_a=$SQUASH_A"
echo "squash_b=$SQUASH_B"

echo "### stage 1: attempt A publishes to the declared ref"
cd "$WORK/a"
git push -q declared "$SQUASH_A:$REF"
echo "declared_ref=$(head_of)"

echo "### stage 2: attempt B publishes to the same ref without reading it first"
cd "$WORK/b"
if git push -q declared "$SQUASH_B:$REF" 2>/dev/null; then
  echo "b_push=accepted"
else
  echo "b_push=rejected_non_fast_forward"
fi
echo "declared_ref=$(head_of)"
echo "b_publication=not_established"

echo "### stage 3: attempt B reads the ref, rebases onto it and publishes"
cd "$WORK/b"
git fetch -q declared "$REF:refs/remotes/declared/main"
git rebase refs/remotes/declared/main >/dev/null 2>&1
SQUASH_B2=$(git rev-parse HEAD)
git push -q declared "$SQUASH_B2:$REF"
echo "squash_b_rebased=$SQUASH_B2"
echo "declared_ref=$(head_of)"

echo "### stage 4: attempt A's completion claim, re-read after B's publication"
cd "$WORK/a"
git fetch -q declared "$REF:refs/remotes/declared/main"
echo "a_record=$SQUASH_A"
if test "$SQUASH_A" = "$(head_of)"; then
  echo "a_completion=holds_the_ref"
else
  echo "a_completion=superseded"
fi
if git merge-base --is-ancestor "$SQUASH_A" refs/remotes/declared/main; then
  echo "a_commit_preserved=yes"
else
  echo "a_commit_preserved=no"
fi
echo "declared_ref=$(head_of)"
echo "supersession_is_distinct_from_loss=true"
