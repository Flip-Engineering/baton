#!/bin/sh
# arch-publish-compose.sh — the composed durable-acceptance-to-canonical-publication path, run as
# four separate processes of docs/bend2/examples/arch-effect-publication.bend over one fixture tree.
#
# The stages are the path's steps, and each one is a process boundary: a restarted process holds no
# in-memory state from the one before it, so every step has to re-derive what it needs from the
# journal and the destination. Run from the worktree root:
#
#   sh docs/bend2/examples/arch-publish-compose.sh
#
# Output is recorded verbatim in arch-publish-compose.evidence.md.
set -eu

export PATH="$PWD/.bend/bin:$PATH"
export BEND_NO_TELEMETRY=1
WORK=.scratch/arch-effect
PROGRAM=docs/bend2/examples/arch-effect-publication.bend

rm -rf "$WORK"
mkdir -p "$WORK"

echo "### stage 1: an attempt whose destination is absent"
ARCH_EFFECT_MODE=ambiguous bend "$PROGRAM"
echo "fixture after stage 1:"
ls "$WORK"

echo "### stage 2: admit and dispatch to a destination that is reachable"
mkdir -p "$WORK/target"
printf 'target-A' > "$WORK/target/identity"
ARCH_EFFECT_MODE=publish bend "$PROGRAM"
echo "journal after stage 2:"
cat "$WORK/journal.log"

echo "### stage 3: settle the attempt from the destination, in a fresh process"
ARCH_EFFECT_MODE=recover bend "$PROGRAM"

echo "### stage 4: ask a fresh process what the destination holds"
echo "destination after stage 4:"
ls "$WORK/target"
cat "$WORK/target/dispatches.log"
cat "$WORK/target/artifact.op-1"
echo
