#!/bin/bash
# Final pass: the runs affected by the stderr-marker fix, plus every inventory.
# A run with a valid result.json is skipped.
set -u
W=/home/atari2036/baton-measure-work
A351=$W/bin/baton2-after-351c9aba
A31=$W/bin/baton2-after-31f261ff
S351=351c9aba85c69f4e4aab1f86cc31fb0f415fe327
S31=31f261ff1dd9535ac0fda9cf60e9940d14ae3b52
cd $W

run() {
  name=$1; shift
  if [ -s "$W/$name/result.json" ] && python3 -c "import json,sys;json.load(open(sys.argv[1]))" "$W/$name/result.json" 2>/dev/null; then
    echo "SKIP $name (already complete)"
    return 0
  fi
  echo "START $name $(date -Is)"
  if "$@" > $W/logs-$name.txt 2>&1; then echo "OK $name"; else echo "FAIL $name"; fi
  echo "END $name $(date -Is)"
}

inventory() {
  name=$1; exe=$2
  [ -s "$W/$name/result.json" ] || return 0
  python3 $W/measure.py inventory --exe $exe --db $W/$name/state.db --out $W/$name \
    > $W/logs-inventory-$name.txt 2>&1 && echo "OK inventory-$name" || echo "FAIL inventory-$name"
}

run b31-replay-codex-a-default python3 $W/measure.py replay --exe $A31 \
    --out $W/b31-replay-codex-a-default --source-revision $S31 --harness codex --level default \
    --frames $W/inputs/codex-trace-a.jsonl
run b31-incomplete python3 $W/measure.py incomplete --exe $A31 --out $W/b31-incomplete \
    --source-revision $S31 --level default
run run9-incomplete python3 $W/measure.py incomplete --exe $A351 --out $W/run9-incomplete \
    --source-revision $S351 --level default
run b31-accumulate python3 $W/measure.py batches --exe $A31 --out $W/b31-accumulate \
    --source-revision $S31 --level default --accumulate 20000 --accumulate-frames 200 \
    --repeat 4 --stderr-bytes 65536
for r in run1-before-default run2-after-default run3-after-segments run4-after-diagnostic; do
  inventory $r $A351
done
for r in b31-default b31-diagnostic b31-accumulate; do
  inventory $r $A31
done
echo FINAL_ALL_DONE $(date -Is)
