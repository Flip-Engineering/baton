#!/bin/bash
# Issue #686 measurement queue for logging-measure-ds-20261007.
#
#   QUEUE_SOURCE=351|31f W=<workdir> ./queue.sh
#
# Each run writes result.json into its own directory and stdout into
# logs-<name>.txt. A run with a valid result.json is skipped, so a restart
# resumes at the first incomplete run.
set -u
W=${W:-/home/atari2036/baton-measure-work}
SRC_351=351c9aba85c69f4e4aab1f86cc31fb0f415fe327
SRC_31F=31f261ff1dd9535ac0fda9cf60e9940d14ae3b52
BASE=fca7af876c8260c32d17f95f3e19bc68ee1bf561
BEFORE=/home/atari2036/baton-logging-686/baseline/.scratch/bend2/baton2
PY=python3
COUNT=400
COMMON="--task-frames $W/inputs/frames-task.jsonl --omp-window $W/inputs/frames-omp-window.jsonl --count $COUNT --step 51"
cd $W

run() {
  name=$1; shift
  for candidate in $W/$name/result.json $W/$name/inventory.json; do
    if [ -s "$candidate" ] && $PY -c "import json,sys;json.load(open(sys.argv[1]))" "$candidate" 2>/dev/null; then
      echo "SKIP $name (already complete)"
      return 0
    fi
  done
  echo "START $name $(date -Is)"
  if "$@" > $W/logs-$name.txt 2>&1; then echo "OK $name"; else echo "FAIL $name"; fi
  echo "END $name $(date -Is)"
}

case ${QUEUE_SOURCE:-351} in
  351)
    AFTER=$W/bin/baton2-after-351c9aba
    SRC=$SRC_351
    run run1-before-default $PY $W/measure.py batches --exe $BEFORE --out $W/run1-before-default \
        --source-revision $BASE $COMMON &
    run run2-after-default $PY $W/measure.py batches --exe $AFTER --out $W/run2-after-default \
        --source-revision $SRC --level default $COMMON &
    run run4-after-diagnostic $PY $W/measure.py batches --exe $AFTER --out $W/run4-after-diagnostic \
        --source-revision $SRC --level diagnostic $COMMON &
    run run3-after-segments $PY $W/measure.py batches --exe $AFTER --out $W/run3-after-segments \
        --source-revision $SRC --level default --budget 65536 --segments 2 --count 150 --step 51 &
    run run5-replay-omp-window $PY $W/measure.py replay --exe $AFTER --out $W/run5-replay-omp-window \
        --source-revision $SRC --harness omp --level default --frames $W/inputs/frames-omp-window.jsonl &
    run run6-replay-codex-a-default $PY $W/measure.py replay --exe $AFTER \
        --out $W/run6-replay-codex-a-default --source-revision $SRC --harness codex --level default \
        --frames $W/inputs/codex-trace-a.jsonl &
    run run7-replay-codex-b-default $PY $W/measure.py replay --exe $AFTER \
        --out $W/run7-replay-codex-b-default --source-revision $SRC --harness codex --level default \
        --frames $W/inputs/codex-trace-b.jsonl &
    run run8-replay-codex-a-diagnostic $PY $W/measure.py replay --exe $AFTER \
        --out $W/run8-replay-codex-a-diagnostic --source-revision $SRC --harness codex \
        --level diagnostic --frames $W/inputs/codex-trace-a.jsonl &
    run run9-incomplete $PY $W/measure.py incomplete --exe $AFTER --out $W/run9-incomplete \
        --source-revision $SRC --level default &
    wait
    for r in run1-before-default run2-after-default run3-after-segments run4-after-diagnostic; do
      run inventory-$r $PY $W/measure.py inventory --exe $AFTER --db $W/$r/state.db --out $W/$r
    done
    ;;
  31f)
    AFTER=$W/bin/baton2-after-31f261ff
    SRC=$SRC_31F
    run b31-default $PY $W/measure.py batches --exe $AFTER --out $W/b31-default \
        --source-revision $SRC --level default $COMMON &
    run b31-diagnostic $PY $W/measure.py batches --exe $AFTER --out $W/b31-diagnostic \
        --source-revision $SRC --level diagnostic $COMMON &
    run b31-accumulate $PY $W/measure.py batches --exe $AFTER --out $W/b31-accumulate \
        --source-revision $SRC --level default --accumulate 20000 --accumulate-frames 200 \
        --repeat 10 --stderr-bytes 65536 &
    run b31-replay-omp-window $PY $W/measure.py replay --exe $AFTER --out $W/b31-replay-omp-window \
        --source-revision $SRC --harness omp --level default --frames $W/inputs/frames-omp-window.jsonl &
    run b31-replay-codex-a-default $PY $W/measure.py replay --exe $AFTER \
        --out $W/b31-replay-codex-a-default --source-revision $SRC --harness codex --level default \
        --frames $W/inputs/codex-trace-a.jsonl &
    run b31-replay-codex-b-default $PY $W/measure.py replay --exe $AFTER \
        --out $W/b31-replay-codex-b-default --source-revision $SRC --harness codex --level default \
        --frames $W/inputs/codex-trace-b.jsonl &
    run b31-replay-codex-a-diagnostic $PY $W/measure.py replay --exe $AFTER \
        --out $W/b31-replay-codex-a-diagnostic --source-revision $SRC --harness codex \
        --level diagnostic --frames $W/inputs/codex-trace-a.jsonl &
    run b31-incomplete $PY $W/measure.py incomplete --exe $AFTER --out $W/b31-incomplete \
        --source-revision $SRC --level default &
    wait
    for r in b31-default b31-diagnostic b31-accumulate; do
      run inventory-$r $PY $W/measure.py inventory --exe $AFTER --db $W/$r/state.db --out $W/$r
    done
    ;;
esac
echo ALL_DONE $(date -Is)
