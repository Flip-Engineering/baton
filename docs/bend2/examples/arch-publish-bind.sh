#!/bin/sh
# arch-publish-bind.sh — binding a landing's acceptance record to the commit it published.
#
# arch-publish-target.sh composes the acceptance half with the publication half and settles completion
# by reading the declared remote. It leaves one gap open: the journal's accept intent names an operation
# and the publication sends a commit, and nothing derives one from the other. This script closes that
# binding and measures what the binding costs at the pin.
#
# The record is one line beside the accept intent:
#
#   publish:<operation>:<commit>:<destination>
#
# The completion claim then requires the record's commit to equal the declared remote's ref. Two cases
# are run: a record naming the commit that was published, and a record naming a different commit while
# the remote holds the published one. The second must not claim completion.
#
# The line is written by this script, not by the Bend2 program, and that is the finding: the native
# half cannot compute a digest of the commit (B2-CRYPTO is open) and the deployment cannot run the
# publication itself (B2-PROCESS is open), so the binding here is a sha the shell read.
#
# Run from the worktree root:
#
#   sh docs/bend2/examples/arch-publish-bind.sh
#
# All state is under .scratch/arch-publish-bind/, which the repository ignores. Output is recorded
# verbatim in arch-publish-bind.evidence.md.
set -eu

ROOT=$(pwd)
export PATH="$ROOT/.bend/bin:$PATH"
export BEND_NO_TELEMETRY=1

REF=refs/heads/main
WORK="$ROOT/.scratch/arch-publish-bind"
DECLARED=$WORK/declared.git
SRC=$WORK/src
JOURNAL=$WORK/journal.log
PROGRAM=docs/bend2/examples/arch-effect-publication.bend

rm -rf "$WORK"
mkdir -p "$WORK" "$WORK/target"
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
git push -q declared main
BASE=$(git rev-parse main)
printf 'landed\n' > landed.txt
git add -A
git commit -qm 'one squashed landing'
SQUASH=$(git rev-parse HEAD)
head_of() { git ls-remote "$DECLARED" "$REF" | cut -f1; }

echo "### stage 1: the acceptance half, in a Bend2 process"
cd "$ROOT"
rm -rf .scratch/arch-effect
mkdir -p .scratch/arch-effect/target
printf 'target-A' > .scratch/arch-effect/target/identity
ACCEPT=$(ARCH_EFFECT_MODE=publish bend "$PROGRAM")
echo "$ACCEPT"

echo "### stage 2: the record binds the operation to the commit and the destination"
printf 'publish:op-1:%s:%s\n' "$SQUASH" "$DECLARED" >> "$JOURNAL"
record_commit() { cut -d: -f3 "$JOURNAL" | tail -1; }
echo "record=$(tail -1 "$JOURNAL")"
echo "record_commit=$(record_commit)"
echo "squash=$SQUASH"

echo "### stage 3: publish to the declared destination"
cd "$SRC"
git push -q declared "$SQUASH:$REF"
echo "declared_remote_head=$(head_of)"

echo "### stage 4: completion requires the record's commit to be the observed ref"
completion_of() { test "$1" = "$(head_of)" && echo observed_match || echo mismatch; }
echo "completion_with_the_recorded_commit=$(completion_of "$(record_commit)")"

echo "### stage 5: a record naming another commit must not claim completion"
printf 'publish:op-1:%s:%s\n' "$BASE" "$DECLARED" >> "$JOURNAL"
echo "record=$(tail -1 "$JOURNAL")"
echo "completion_with_a_base_commit=$(completion_of "$(record_commit)")"
echo "observed_head=$(head_of)"
echo "binding_is_string_equality=true"
echo "digest_bound_record=none"
