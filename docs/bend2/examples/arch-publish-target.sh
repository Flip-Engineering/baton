#!/bin/sh
# arch-publish-target.sh — the acceptance half and the publication half of one landing, composed, with
# the completion claim resting on the actual shared destination.
#
# The acceptance half is docs/bend2/examples/arch-effect-publication.bend, run in a Bend2 process: it
# journals the accept intent and reports that Base gives it no durability receipt.
#
# The publication half is the deployment's own mechanism, established by
# docs/bend2/examples/controlled-remote.sh (bend2-orchestrator5's fixture, reproduced in this lane):
#
#   git push <advanced.integration.publishRemote> <squashSha>:<ref>
#
# The destination is the declared value itself, never a remote name. This script composes the two
# halves and asks the question M-18 turns on: what evidence establishes that the intended commit
# reached the declared destination? Its answer is a read of that destination's ref, never the push's
# own output.
#
# Run from the worktree root:
#
#   sh docs/bend2/examples/arch-publish-target.sh
#
# All state is under .scratch/arch-publish-target/, which the repository ignores. Output is recorded
# verbatim in arch-publish-target.evidence.md.
set -eu

ROOT=$(pwd)
export PATH="$ROOT/.bend/bin:$PATH"
export BEND_NO_TELEMETRY=1

REF=refs/heads/main
DISPLAY=../.scratch/arch-publish-target
WORK="$ROOT/.scratch/arch-publish-target"
DECLARED=$WORK/declared.git
WRONG=$WORK/wrong.git
SRC=$WORK/src
PROGRAM=docs/bend2/examples/arch-effect-publication.bend

rm -rf "$WORK"
mkdir -p "$WORK"
git init -q --bare "$DECLARED"
git init -q --bare "$WRONG"
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
git remote add wrong "$WRONG"
git push -q declared main
BASE=$(git rev-parse main)
head_of() { git ls-remote "$1" "$REF" | cut -f1; }

echo "### stage 1: the acceptance half, in a Bend2 process"
cd "$ROOT"
rm -rf .scratch/arch-effect
mkdir -p .scratch/arch-effect/target
printf 'target-A' > .scratch/arch-effect/target/identity
ARCH_EFFECT_MODE=publish bend "$PROGRAM"
echo "journal_lines=$(wc -l < .scratch/arch-effect/journal.log | tr -d ' ')"

cd "$SRC"
echo "### stage 2: the publication half, and the observation that claims completion"
printf 'landed\n' > landed.txt
git add -A
git commit -qm 'one squashed landing'
SQUASH=$(git rev-parse HEAD)
echo "squash=$SQUASH"
git push -q declared "$SQUASH:$REF"
echo "declared_remote_head=$(head_of "$DECLARED")"
echo "completion_evidence=$(test "$(head_of "$DECLARED")" = "$SQUASH" && echo observed_match || echo mismatch)"

echo "### stage 3: a wrong destination is not completion"
git --git-dir="$DECLARED" update-ref "$REF" "$BASE"
git push -q wrong "$SQUASH:$REF"
echo "wrong_destination_head=$(head_of "$WRONG")"
echo "declared_remote_head=$(head_of "$DECLARED")"
echo "completion_evidence=$(test "$(head_of "$DECLARED")" = "$SQUASH" && echo observed_match || echo no_evidence)"

echo "### stage 4: a lost response, reconciled by observation"
git --git-dir="$DECLARED" update-ref "$REF" "$BASE"
git push -q declared "$SQUASH:$REF" >/dev/null 2>&1 || true
echo "pushes_this_stage=1"
echo "declared_remote_head=$(head_of "$DECLARED")"
echo "reconciliation=$(test "$(head_of "$DECLARED")" = "$SQUASH" && echo observed_convergence || echo unresolved)"
echo "this_attempt_is_proven=false"

echo "### stage 5: a deployment with no declared destination publishes nothing"
if git push -q "" "$SQUASH:$REF" 2>/dev/null; then
  echo "no_declared_destination=pushed"
else
  echo "no_declared_destination=fatal_empty_destination"
fi
echo "declared_remote_head=$(head_of "$DECLARED")"
