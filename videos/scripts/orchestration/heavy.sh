#!/bin/bash
# heavy.sh (the orchestrator, 16 Oct): run a CPU/memory-heavy command (a node build or solve) under the studio's slot limit, so swarms of
# agents cannot overload this 4-core, 15 GB box (an OOM killed a bake on 16 Oct). At most $HEAVY_SLOTS (default 2) run at once across all
# lanes; a caller waits for a free slot and for >= $HEAVY_MIN_MB (default 2500) MB of available memory, then runs niced.
#   bash videos/scripts/orchestration/heavy.sh node videos/web/labs/.../probe.mjs --people L08
K=${HEAVY_SLOTS:-2}; MIN=${HEAVY_MIN_MB:-2500}; D=/tmp/acp_heavy_slots; mkdir -p "$D"
while true; do
  avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
  if [ "${avail:-0}" -ge "$MIN" ]; then
    for i in $(seq 1 "$K"); do
      exec 9>"$D/slot$i"
      if flock -n 9; then nice -n 10 "$@"; rc=$?; exec 9>&-; exit $rc; fi
      exec 9>&-
    done
  fi
  sleep 10
done
