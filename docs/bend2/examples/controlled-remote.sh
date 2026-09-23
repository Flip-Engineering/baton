#!/bin/sh
# controlled-remote.sh — the publication half of a landing, run against a controlled remote.
#
# The deployment publishes a landed ref with one command, taken from impl/src/worktree.mjs's
# landContribution (master 65c913f0, line 2374):
#
#   git push <advanced.integration.publishRemote> <squashSha>:<ref>
#
# The destination is the declared value itself, never a remote name, and the local target ref moves
# before the push: on a failed push the local move is rolled back and the landing refuses
# integrate_publish_failed. A deployment that declares no remote refuses integrate_publish_undeclared
# before anything moves (worktree.mjs lines 2351-2356).
#
# This fixture stands up the two repositories those halves talk about — a bare declared remote and a
# second, wrong destination — and runs the four cases the external review names: no publication,
# wrong destination, publication to the declared remote, and an attempt whose response is lost and
# whose outcome is reconciled by observation. Run from the worktree root:
#
#   sh docs/bend2/examples/controlled-remote.sh
#
# All state is under .scratch/controlled-remote/, which the repository ignores. Output is recorded
# verbatim in controlled-remote.evidence.md.
set -eu

REF=refs/heads/main
DISPLAY_WORK=.scratch/controlled-remote
WORK=$(pwd)/$DISPLAY_WORK
REMOTE=$WORK/remote.git
WRONG=$WORK/wrong.git
SRC=$WORK/src

rm -rf "$WORK"
mkdir -p "$WORK"
git init -q --bare "$REMOTE"
git init -q --bare "$WRONG"
git init -q "$SRC"
git config user.email fixture@local
git config user.name fixture
# Fixed identity and dates so the fixture's shas are the same on every run.
export GIT_AUTHOR_DATE='2026-09-23T00:00:00Z'
export GIT_COMMITTER_DATE='2026-09-23T00:00:00Z'
printf 'base\n' > base.txt
git add -A
git commit -qm base
git branch -M main
git remote add shared "$REMOTE"
git remote add wrong "$WRONG"
git push -q shared main
BASE=$(git rev-parse main)
head() { git ls-remote "$1" "$REF" | cut -f1; }

echo "declared_remote=$DISPLAY_WORK/remote.git"
echo "base_head=$BASE"

# The landing's artifact: one squashed commit over the target's base, the shape landContribution
# prepares before its compare-and-swap and its push.
printf 'landed\n' > landed.txt
git add -A
git commit -qm 'one squashed landing'
SQUASH=$(git rev-parse HEAD)
echo "squash=$SQUASH"

echo "### case 1: a local completion with no publication"
git update-ref "$REF" "$SQUASH"
echo "local_target=$(git rev-parse "$REF")"
echo "declared_remote_head=$(head shared)"
git update-ref "$REF" "$BASE"

echo "### case 2: publication to a wrong destination"
git push -q wrong "$SQUASH:$REF"
echo "wrong_destination_head=$(head wrong)"
echo "declared_remote_head=$(head shared)"
echo "### case 3: publication to the declared remote"
git push -q shared "$SQUASH:$REF"
echo "declared_remote_head=$(head shared)"

echo "### case 4: an attempt whose response is lost, reconciled by observation"
git --git-dir="$REMOTE" update-ref "$REF" "$BASE"
git push -q shared "$SQUASH:$REF" >/dev/null 2>&1 || true
echo "observed_head_after_lost_response=$(head shared)"
echo "reconciliation=observed_convergence_not_this_attempts_effect"
