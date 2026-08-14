#!/usr/bin/env bash
# EVAL-R0 t1 evidence — grader-ceiling check: each rung's grading suite must be GREEN at its
# pinned IMPL commit (pre-registration §2's "grading suite" column). A suite that cannot pass
# on the landed implementation is not a valid grader for the arms. Offline/deterministic.
# Method mirrors t0-red-at-base.sh (real detached worktrees — NOT `git archive`, which is
# pathspec-filtered to empty trees in baton worktrees; see the report §4.2).
# Usage: bash t1-grader-ceiling.sh   (writes t1-results/<rung>.txt in this directory)
set -u
cd "$(dirname "$0")"
OUT=t1-results
mkdir -p "$OUT"
ROOT=$(git rev-parse --show-toplevel)

run_ceiling () { # $1=rung  $2=impl  $3=suite
  local rung=$1 impl=$2 suite=$3
  local tmp="/tmp/eval-r0-t1-${rung}"
  rm -rf "$tmp"
  git -C "$ROOT" worktree add --detach "$tmp" "$impl" >/dev/null 2>&1 || {
    echo "$rung: WORKTREE-ADD-FAILED" > "${OUT}/${rung}.txt"; return; }
  ln -s "$ROOT/impl/node_modules" "$tmp/impl/node_modules"   # same caveat as t0 (report §4.3)
  ( cd "$tmp" && node --test "impl/test/${suite}" ) > "${OUT}/${rung}.txt" 2>&1
  printf '%s exit=%s (impl %s, suite as landed)\n' "$rung" "$?" "$impl"
  git -C "$ROOT" worktree remove --force "$tmp" >/dev/null 2>&1
}

# Rung, impl commit, grading suite as landed (pre-registration §2 table, verified 2026-08-14)
run_ceiling trust-gate   ac5bd80 trust-gate-steering-red.test.mjs
run_ceiling kg-settle    e0f9d57 kg-settlement-red.test.mjs
run_ceiling wave-grammar 480154a wave-grammar-red.test.mjs
run_ceiling diagnostics  6d0ca11 diagnostics-red.test.mjs
run_ceiling alias-m5     bb85e35 grammar-m5-red.test.mjs
git -C "$ROOT" worktree prune
