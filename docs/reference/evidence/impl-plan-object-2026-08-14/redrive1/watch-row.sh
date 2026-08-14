#!/usr/bin/env bash
# Coordinator poller — wait for row-plan-object to settle on disk (#174 law).
# Detects the row's deliverable in ANY sibling worktree:
#   1. redrive1/notes-row-plan-object.md present, OR
#   2. impl/src/orchestrator-plan.mjs present, OR
#   3. impl/src/coordination-store.mjs modified
# Exits 0 when found, 3 on timeout. Silence is not death — the row may simply be slow.
WT_ROOT="/Users/wahargis/Development/Experiments/baton/.baton/wt"
DEADLINE=$(( $(date +%s) + 2400 ))   # 40-minute ceiling
while :; do
  for d in "$WT_ROOT"/ws-*/; do
    n="${d%/}"
    [ -d "$n" ] || continue
    notes="$n/docs/reference/evidence/impl-plan-object-2026-08-14/redrive1/notes-row-plan-object.md"
    if [ -f "$notes" ]; then
      echo "ROW NOTES FOUND in $n"
      exit 0
    fi
    if [ -f "$n/impl/src/orchestrator-plan.mjs" ]; then
      echo "ORCHESTRATOR-PLAN FOUND in $n"
      exit 0
    fi
    if git -C "$n" status --short 2>/dev/null | grep -q 'impl/src/coordination-store.mjs'; then
      echo "STORE MODIFIED in $n"
      exit 0
    fi
  done
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    echo "TIMEOUT: row-plan-object did not settle within 40 minutes"
    exit 3
  fi
  sleep 20
done
