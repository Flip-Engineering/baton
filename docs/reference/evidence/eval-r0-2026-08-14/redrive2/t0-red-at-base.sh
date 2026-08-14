#!/usr/bin/env bash
# EVAL-R0 redrive2 t0 evidence — red-at-base splits per pre-registration §2/§6
# (eval-r0-preregistration.md). Offline/deterministic: red suites use ScriptableAdapter
# + fake worktrees (no providers).
# Modes:
#   raw      — suite predates impl in git (#64, #63): run the suite AT the base commit.
#   planted  — suite born in the impl commit (S-1, DG-1, M5): checkout base, plant the
#              final suite verbatim from the impl commit, run. Zero weakening.
# Method note: real detached git worktrees. `git archive`/bare `git ls-tree` are
# pathspec-filtered to EMPTY trees in baton worktrees (core.excludesfile projection) and
# would produce module-load errors dressed as "red splits" — do not trust them here.
# Usage: bash t0-red-at-base.sh   (writes t0-results/<rung>.txt in this directory)
set -u
cd "$(dirname "$0")"
OUT=t0-results
mkdir -p "$OUT"
ROOT=$(git rev-parse --show-toplevel)

run_split () { # $1=rung  $2=base  $3=suite  $4=mode  $5=impl
  local rung=$1 base=$2 suite=$3 mode=$4 impl=$5
  local tmp="/tmp/eval-r0-rd2-${rung}"
  rm -rf "$tmp"
  git -C "$ROOT" worktree add --detach "$tmp" "$base" >/dev/null 2>&1 || {
    echo "$rung: WORKTREE-ADD-FAILED" > "${OUT}/${rung}.txt"; return; }
  # Suites import optional deps (@ast-grep/napi etc.); node_modules is untracked, so
  # symlink the CURRENT impl/node_modules into the era tree (caveat recorded in report §4.3).
  ln -s "$ROOT/impl/node_modules" "$tmp/impl/node_modules"
  if [ "$mode" = planted ]; then
    git -C "$ROOT" show "${impl}:impl/test/${suite}" > "$tmp/impl/test/${suite}"
  fi
  ( cd "$tmp" && node --test "impl/test/${suite}" ) > "${OUT}/${rung}.txt" 2>&1
  local rc=$?
  printf '%s exit=%s (%s, base %s' "$rung" "$rc" "$mode" "$base"
  [ "$mode" = planted ] && printf ', suite planted verbatim from %s' "$impl"
  printf ')\n'
  git -C "$ROOT" worktree remove --force "$tmp" >/dev/null 2>&1
}

# Rung, base, suite, mode, impl-commit (pre-registration §2 table, verified 2026-08-14)
run_split trust-gate   2f2d23b trust-gate-steering-red.test.mjs raw ""
run_split kg-settle    2e22197 kg-settlement-red.test.mjs       raw ""
run_split wave-grammar 3733096 wave-grammar-red.test.mjs         planted 480154a
run_split diagnostics  47993f7 diagnostics-red.test.mjs          planted 6d0ca11
run_split alias-m5     bbf6791 grammar-m5-red.test.mjs           planted bb85e35
git -C "$ROOT" worktree prune
