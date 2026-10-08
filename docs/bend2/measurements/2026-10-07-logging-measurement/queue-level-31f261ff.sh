#!/bin/bash
# Level-only policy runs, cheapest first so a reboot costs the least.
#   W=<workdir> ./queue31f.sh
set -u
W=${W:-/home/atari2036/baton-measure-work}
A=$W/bin/baton2-after-31f261ff
S=31f261ff1dd9535ac0fda9cf60e9940d14ae3b52
cd $W

run() {
  name=$1; shift
  for candidate in $W/$name/result.json $W/$name/inventory.json; do
    if [ -s "$candidate" ] && python3 -c "import json,sys;json.load(open(sys.argv[1]))" "$candidate" 2>/dev/null; then
      echo "SKIP $name (already complete)"
      return 0
    fi
  done
  echo "START $name $(date -Is)"
  if "$@" > $W/logs-$name.txt 2>&1; then echo "OK $name"; else echo "FAIL $name"; fi
  echo "END $name $(date -Is)"
}

run b31-replay-omp-window python3 $W/measure.py replay --exe $A --out $W/b31-replay-omp-window \
    --source-revision $S --harness omp --level default --frames $W/inputs/frames-omp-window.jsonl
run b31-replay-codex-a-default python3 $W/measure.py replay --exe $A \
    --out $W/b31-replay-codex-a-default --source-revision $S --harness codex --level default \
    --frames $W/inputs/codex-trace-a.jsonl
run b31-replay-codex-b-default python3 $W/measure.py replay --exe $A \
    --out $W/b31-replay-codex-b-default --source-revision $S --harness codex --level default \
    --frames $W/inputs/codex-trace-b.jsonl
run b31-replay-codex-a-diagnostic python3 $W/measure.py replay --exe $A \
    --out $W/b31-replay-codex-a-diagnostic --source-revision $S --harness codex \
    --level diagnostic --frames $W/inputs/codex-trace-a.jsonl
run b31-incomplete python3 $W/measure.py incomplete --exe $A --out $W/b31-incomplete \
    --source-revision $S --level default
run b31-default python3 $W/measure.py batches --exe $A --out $W/b31-default \
    --source-revision $S --level default --task-frames $W/inputs/frames-task.jsonl \
    --omp-window $W/inputs/frames-omp-window.jsonl --count 400 --step 51
run b31-accumulate python3 $W/measure.py batches --exe $A --out $W/b31-accumulate \
    --source-revision $S --level default --accumulate 20000 --accumulate-frames 200 \
    --repeat 4 --stderr-bytes 65536
for r in b31-default b31-diagnostic b31-accumulate; do
  run inventory-$r python3 $W/measure.py inventory --exe $A --db $W/$r/state.db --out $W/$r
done
echo ALL_DONE $(date -Is)
